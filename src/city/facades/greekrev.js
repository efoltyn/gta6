/* ============================================================
   city/facades/greekrev.js — "Greek Revival Mansion": the 1840s
   American temple-front house.

   WHAT IS BEING MODELLED. Not a classical building with columns on it — a
   TEMPLE BOLTED TO A HOUSE. Between about 1830 and 1860 every ambitious
   American builder took the one plate he had of the Parthenon and built it
   out of pine boards, then painted the whole thing dead white so it would
   pass for marble. The result is unlike anything else on a street: an
   ordinary two-storey box with a gable end turned to face the road, a
   full-height colonnade standing in front of that gable, and a real
   triangular PEDIMENT with a deep cornice and a shadowed tympanum sitting on
   top of the columns. That silhouette — a broad low triangle on a row of
   posts — is the whole identity, and it is legible as a black shape from
   200 m, which is the test this kit is built around.

   WHY EACH ELEMENT IS HERE.

     THE GABLE      The ridge runs FRONT TO BACK, so the gable end faces the
     FACES FRONT    street and the pediment IS that gable rather than a
                    signboard stuck in front of one. Built as stepped
                    axis-aligned courses narrowing on ONE axis only (the
                    entrance face's tangent), full depth along the ridge — a
                    gable is victorian.js's mansard with one axis frozen.
                    Pitch is 0.30 rise per half-span, about 3.6:12: a real
                    Greek pediment is a BROAD triangle, and anything steeper
                    reads as Gothic Revival instead.
     THE ORDER      Doric by default (Ionic on request). Its height is solved
     SOLVED         BACKWARDS, exactly as stone.js solves its giant order:
     BACKWARDS      the entablature is subtracted from ctx.rTop FIRST, the
                    roof springs from the top of that entablature, and only
                    what is left between the stylobate and the architrave
                    becomes shaft. Size the columns first and the beam grows
                    through the roofline.
     WIDE CENTRE    The doorway sits in the middle intercolumniation, so the
     INTERCOLUM-    column count is always EVEN and the central gap is
     NIATION        widened until it clears F.entrance's door gap. A column
                    nudged sideways reads as a mistake; a widened centre bay
                    is a documented classical licence, and it is what a real
                    Greek Revival porch does to get a front door under it.
     ENTABLATURE    A heavy ring on all four faces — architrave, taenia, a
     RING           deliberately PLAIN frieze (the period ran a single wide
                    painted board there and nothing else), bed mould, then a
                    deep corona that doubles as the eaves the roof overhangs.
                    Its underside sits at rTop - 0.40, inside the host's own
                    solid header zone, so it never crosses glass.
     PILASTERS      Corner pilasters with Doric caps tie the four faces into
     AND RESPONDS   one block; slimmer strips on every bay line answer the
                    columns. These are VERTICAL, so they are allowed to cross
                    the host's continuous window band — and crossing it is
                    exactly what turns a glass ribbon into punched windows.
     WINDOWS        Flat trim, a projecting sill, a flat head, a 6/6 muntin
     AND SHUTTERS   grid, and a pair of louvred shutters FLANKING the host
                    glass on either side. The wall between the openings is
                    filled by a pale skin emitted with runBand, so the whole
                    elevation is solid painted board except where a window
                    actually is.
     THE STEPS      A full-width crepidoma: one 0.40 m stylobate rise (under
                    physics STEP_UP 0.45) carrying the porch floor and the
                    columns, with three cosmetic treads in front of it and a
                    single continuous ramp platform underneath, so a
                    sprinting player never samples a seam. No cheek walls —
                    a temple's steps run open to both ends.
     CHIMNEYS       Ridge stacks toward the rear, painted to match the walls
                    and capped in slate. A house is not a monument; the
                    chimneys are what say somebody lives here.

   COLOUR. The point of this style is that it is BLINDINGLY PALE. The wall
   goes 80 percent of the way to a warm off-white, the trim a little further,
   and the roof is driven hard down to a near-black slate — the city's ambient
   is bright enough that a nominal charcoal comes back mid grey, which is the
   lesson victorian.js paid for. The only saturated thing on the building is
   the shutter green, and it is the one element allowed to vary by position
   hash so a street of these is not one drawing repeated.

   SPEC (all optional; the facade is complete with {style:"greekrev"}):
     order:    "doric" (default) | "ionic"  — capital and shaft slenderness
     columns:  2..8, overrides the solved column count
     shutters: false to omit the shutter pairs

   Every dimension comes from ctx.w / ctx.d / ctx.storeys / ctx.FH / ctx.rTop
   or a face span. Real meshes: the colonnade (<= 8) plus two door lanterns.
   Everything else is ctx.dbox and therefore free.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // ---- a horizontal band on one face, interrupted by "holes" -------------
  // Lifted from stone.js, plus an `inset`. holes is a list of [t0,t1] tangent
  // intervals the band must not cross. You do not cut a hole in merged
  // axis-aligned boxes; you decline to draw over it.
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

  // The one saturated note on the building, position-hashed. All four are the
  // period's own colours: bottle green, near-black, Prussian blue-grey, oxblood.
  const SHUTTERS = [0x1d3327, 0x191d24, 0x233143, 0x33201d];

  CBZ.registerFacade("greekrev", {
    label: "Greek Revival Mansion",
    crownsRoof: true,
    // This grammar builds its own doorcase — pilasters, sidelights, a transom
    // and a pair of panelled leaves — so the kit must not stack its generic
    // surround on top of it.
    ownDoor: true,
    maxStoreys: 4,
    build: function (ctx, F, spec) {
      const FH = ctx.FH, ST = Math.max(1, ctx.storeys | 0), H = ctx.rTop;
      const unit = Math.min(ctx.w, ctx.d);
      const faces = F.faces(ctx);
      const e = F.entrance(ctx);
      const ef = e.f;                       // the temple front
      const halfT = ef.span / 2;            // half the front — the gable narrows on this axis
      const halfQ = ef.halfN;               // half the depth — the ridge runs on this axis
      const ionic = !!(spec && spec.order === "ionic");
      const wantShut = !(spec && spec.shutters === false);

      // ============================================================
      //  1. PALETTE
      // ============================================================
      const base = (ctx.pal && ctx.pal.wall) || ctx.color;
      const PALE = F.mix(base, 0xf4efe2, 0.80);        // painted board / stucco
      const TRIM = F.mix(PALE, 0xfffdf5, 0.40);        // cornices, columns, casings
      const DIM = F.shade(PALE, 0.86);                 // porch wall, tympanum field
      const DARK = F.shade(PALE, 0.58);                // reveals — the darkest pale tone
      const FLUT = F.shade(PALE, 0.70);                // the shadow inside a flute
      const ROOF = F.shade(F.mix(base, 0x2c3331, 0.90), 0.60);
      const ROOFL = F.shade(ROOF, 1.26);
      const SHUT = F.shade(F.mix(SHUTTERS[Math.min(SHUTTERS.length - 1,
        (ctx.hash(0x67a1) * SHUTTERS.length) | 0)], base, 0.10), 0.88);
      const SHUTD = F.shade(SHUT, 0.66);               // the louvre shadows
      const GLAZ = F.mix(0x131922, PALE, 0.07);        // sidelights, transom, oculus

      // ============================================================
      //  2. THE SECTION, SOLVED TOP-DOWN FROM ctx.rTop
      // ============================================================
      // Order matters: entablature first, then the roof springs off IT, and
      // the shaft gets whatever is left. Doing this the other way round is how
      // an order grows through its own roofline.
      const entH = Math.max(0.80, Math.min(FH * 0.72, H * 0.22));
      const yEnt = H - 0.40;                       // architrave underside
      const CP = clamp(unit * 0.055, 0.40, 1.15);  // corona projection = eaves fly
      const yCorn = yEnt + entH;                   // top of the cornice = roof spring
      const aH = entH * 0.22, frH = entH * 0.46, coH = entH * 0.32;
      // A GREEK pitch: 0.30 of the half-span. Capped against the wall height so
      // an 11 m cottage does not wear a roof taller than its own storey.
      const eaveOv = CP;
      const halfT0 = halfT + eaveOv;
      const rise = Math.min(halfT0 * 0.30, H * 0.50);
      const ridge = yCorn + rise;
      // THE STYLOBATE. One rise, 0.40 < physics STEP_UP (0.45), so the porch is
      // walk-on-able straight off the pavement and the doorway is never sealed.
      // A drive-in bay gets no crepidoma at all — a car cannot climb a temple.
      const porch = !e.driveIn;
      const TOP = porch ? 0.40 : 0.0;
      const plinthTop = 0.46;                      // water table, inside the 0.55 sill zone
      const WP = 0.13;                             // the pale wall skin's projection
      // THE DOORCASE, sized here because the elevation above it has to know
      // where its cap lands: the window over the front door must sit ON that
      // cap, not be cut in half by it.
      const doorTop = Math.min(e.head + 0.15, yEnt - 0.45);
      const antT = e.gap / 2 + 0.44;               // the flanking antae
      const capTop = doorTop + 0.42;               // top of the doorcase entablature
      const capHalf = antT + 0.47;

      // ============================================================
      //  3. THE COLONNADE'S TANGENTS — solved before anything is drawn
      // ============================================================
      // Everything on the entrance face keys off these: the wall responds, the
      // window bays and the pediment all have to agree with the columns or the
      // front reads as two unrelated drawings on one elevation.
      const colY = TOP;
      const colH = Math.max(0.9, yEnt - colY - 0.02);
      let nCol = (spec && spec.columns) ? clamp(spec.columns | 0, 2, 8) : (ef.span >= 16.5 ? 6 : 4);
      if (nCol % 2) nCol += 1;                     // EVEN: nothing lands on the door axis
      // Slenderness is a real number: Greek Doric runs 5.5-7 diameters, Ionic
      // about 9. The second cap keeps a wide front from growing tree trunks.
      const cr = Math.max(0.20, Math.min(colH / (ionic ? 15.5 : 13.5), ef.span / (nCol * 3.0)));
      const capH = cr * (ionic ? 1.00 : 1.15);     // a Doric capital is ~half a diameter
      const cMarg = Math.max(0.80, ef.span * 0.055);
      const outer = Math.max(cr + 0.4, halfT - cMarg);
      // A = half the CENTRAL intercolumniation. It is widened until the door
      // gap plus a column radius fits, which is the classical answer and the
      // reason no column ever has to be dropped or nudged here.
      const A0 = e.gap / 2 + cr + 0.30;
      let m = Math.max(1, nCol >> 1);
      let A = Math.max(A0, outer / (2 * m - 1));
      // if the outer columns would end up closer than 2.6 diameters, take a
      // pair out rather than build a solid wall of stone.
      while (m > 1 && (outer - A) / (m - 1) < cr * 2.6) {
        m--; A = Math.max(A0, outer / (2 * m - 1));
      }
      const cs = m > 1 ? (outer - A) / (m - 1) : 0;
      const colT = [];
      for (let i = 0; i < m; i++) { colT.push(-(A + cs * i)); colT.push(A + cs * i); }
      colT.sort(function (a, b) { return a - b; });
      // Portico depth: deep enough for a column and its shadow, shallow enough
      // that the pediment stays a pediment and not a canopy.
      const PD = Math.max(2 * cr + 0.75,
        clamp(Math.min(halfQ * 0.55, ef.span * 0.17), 1.5, 3.8));
      const cq = PD - cr - 0.28;                   // column centre, out from the wall

      // ---- entrance-face axes: t narrows with the gable, q runs along the ridge
      function gbox(t, cy, q, lt, h, lq, col) {
        if (!(lt > 0) || !(h > 0) || !(lq > 0)) return;
        if (ef.horiz) ctx.dbox(t, cy, q, lt, h, lq, col);
        else ctx.dbox(q, cy, t, lq, h, lt, col);
      }
      // the same, with q given as an OUTWARD OFFSET RANGE from the front wall
      // plane — how every part of the portico and pediment is positioned.
      function pbox(t, cy, lt, h, o0, o1, col) {
        if (o1 <= o0) return;
        gbox(t, cy, ef.out * (halfQ + (o0 + o1) / 2), lt, h, o1 - o0, col);
      }

      // ============================================================
      //  4. PER-FACE LAYOUT: pilaster lines and window slots
      // ============================================================
      // On the entrance face a window goes in each intercolumniation except the
      // one over the door, and a pilaster respond goes behind each column. That
      // yields the canonical 3-bay (tetrastyle) or 5-bay (hexastyle) temple
      // front without a single hardcoded count.
      // The CENTRE intercolumniation is kept in the list even though the door is
      // in it: upstairs it wants a window like every other bay, and refusing it
      // is what leaves a blank panel over the front door (the bug stone.js's
      // header calls out). Whether it gets one is decided per storey, below.
      // All front slots are then cut to the NARROWEST of them, so the upper
      // floor reads as one uniform row of sash rather than a widening fan.
      const frontSlots = [], frontLines = colT.slice();
      let minFrontW = Infinity;
      for (let i = 0; i + 1 < colT.length; i++) {
        const wid = colT[i + 1] - colT[i] - cr * 2.2;
        if (wid > 1.0) minFrontW = Math.min(minFrontW, wid);
      }
      for (let i = 0; i + 1 < colT.length; i++) {
        const wid = colT[i + 1] - colT[i] - cr * 2.2;
        if (wid > 1.0) frontSlots.push({ t: (colT[i] + colT[i + 1]) / 2, w: minFrontW });
      }
      function layout(f) {
        if (f.s === ctx.doorSide) return { lines: frontLines, slots: frontSlots };
        const n = F.bayCount(f, 3.4, 2, 7);
        const marg = Math.max(0.62, f.span * 0.055);
        const bays = F.bays(f, n, marg);
        const slots = [];
        for (let i = 0; i < bays.length; i++) slots.push({ t: bays[i].t, w: bays[i].w });
        return { lines: F.bayLines(f, n, marg), slots: slots };
      }
      // one window's parts, derived from the slot it has to live in
      const glassH = FH - 1.0;                     // host glass: k*FH+0.55 .. (k+1)*FH-0.45
      function winOf(slot) {
        const cw = clamp(slot.w * 0.075, 0.12, 0.30);          // flat casing
        const inner = slot.w - cw * 2 - 0.10;
        const ow = Math.max(0.52, Math.min(inner * 0.56, glassH * 0.62));
        const shW = Math.max(0.16, Math.min((inner - ow) / 2, ow * 0.52));
        return { t: slot.t, ow: ow, cw: cw, shW: shW,
          h: Math.min(glassH, ow * 2.6) };
      }
      const plans = [];                            // per face, in `faces` order
      for (let i = 0; i < faces.length; i++) {
        const lay = layout(faces[i]);
        const ws = [];
        for (let k = 0; k < lay.slots.length; k++) ws.push(winOf(lay.slots[k]));
        plans.push({ lines: lay.lines, wins: ws });
      }

      // The doorway's keep-out interval on the entrance face. Any band whose
      // bottom lands inside the doorcase is emitted in SEGMENTS around this,
      // never over it — the runBand rule, and the reason nothing here can grow
      // a kerb across the front door.
      const doorHole = [-(e.gap / 2 + 0.55), e.gap / 2 + 0.55];
      function holesFor(f, yBot) {
        return (f.s === ctx.doorSide && yBot < capTop - 0.25) ? [doorHole] : [];
      }
      function ring(cy, h, proj, col, over, inset) {
        for (let i = 0; i < faces.length; i++) {
          runBand(ctx, F, faces[i], cy, h, proj, col, holesFor(faces[i], cy - h / 2), over, inset);
        }
      }
      // A run of wall between two heights, stepping around the window openings
      // and — where it is low enough to matter — around the doorcase too. A band
      // that STRADDLES the top of the doorcase is split in two first, so the
      // doorway's keep-out never punches a hole in wall that is well above it.
      function skin(f, y0, y1, proj, col, wh, over) {
        if (y1 - y0 < 0.03) return;
        if (f.s === ctx.doorSide && y0 < capTop - 0.03 && y1 > capTop + 0.03) {
          skin(f, y0, capTop, proj, col, wh, over);
          skin(f, capTop, y1, proj, col, wh, over);
          return;
        }
        const holes = holesFor(f, y0).concat(wh);
        runBand(ctx, F, f, (y0 + y1) / 2, y1 - y0, proj, col, holes, over);
      }
      // WHERE ONE WINDOW ACTUALLY LANDS, or null if it cannot. Shared by the
      // wall skin (which needs the holes) and the window pass (which needs the
      // frames), so the two can never disagree about a single opening.
      function placeWin(f, wn, k) {
        let y0 = k * FH + 0.55, wh = wn.h;
        if (f.s === ctx.doorSide) {
          // the ground centre bay belongs to the doorway
          if (y0 < e.head && !F.clearsDoor(ctx, f, wn.t, wn.ow + 1.0)) return null;
          // the sash over the front door stands ON the doorcase cap
          if (Math.abs(wn.t) < capHalf + wn.ow / 2 && y0 < capTop) {
            const lift = capTop - y0;
            y0 = capTop; wh = Math.min(wh, glassH - lift - 0.10);
          }
        }
        if (wh < 0.85) return null;
        return { y0: y0, h: wh, lift: y0 - (k * FH + 0.55) };
      }

      // ============================================================
      //  5. THE PAINTED WALL — a pale skin with the windows punched out
      // ============================================================
      // The host glazes ONE continuous band per storey on every face. Rather
      // than brick that up, the skin is emitted with runBand AROUND the window
      // openings, so every square metre of wall is painted board and the only
      // glass left showing is glass we have framed as a window. That is the
      // whole difference between a punched-window elevation and a bricked-up one.
      for (let i = 0; i < faces.length; i++) {
        const f = faces[i], wins = plans[i].wins;
        const shaded = (f.s === ctx.doorSide) ? DIM : PALE;   // the porch is in shadow
        for (let k = 0; k < ST; k++) {
          const openings = [];
          for (let j = 0; j < wins.length; j++) {
            const p = placeWin(f, wins[j], k);
            if (p) openings.push([wins[j].t - wins[j].ow / 2, wins[j].t + wins[j].ow / 2]);
          }
          skin(f, k * FH + 0.52, (k + 1) * FH - 0.42, WP, shaded, openings, 0.14);
          // the two SOLID zones the host leaves us — the sill run and the
          // header run — are painted edge to edge, which is legal because there
          // is no glass there and it is what makes the elevation one material.
          skin(f, k * FH + 0.02, k * FH + 0.52, WP, shaded, [], 0.14);
          if (k < ST - 1) skin(f, (k + 1) * FH - 0.43, (k + 1) * FH - 0.01, WP, shaded, [], 0.28);
        }
      }
      // a floor-line course at every storey, in the sill zone where a horizontal
      // is allowed to be, and stepped around the doorcase where it must be.
      for (let k = 1; k < ST; k++) ring(k * FH + 0.10, 0.16, WP + 0.10, TRIM, 0.30);
      // WATER TABLE: the plinth the temple stands on. Stepped around the
      // doorway — a 0.46 m lip across a front door is a wall, not a moulding.
      ring(plinthTop * 0.5, plinthTop, WP + 0.14, PALE, 0.34);
      ring(plinthTop + 0.09, 0.18, WP + 0.24, TRIM, 0.40);

      // ============================================================
      //  6. WINDOWS: flat trim, sill, head, muntins, flanking shutters
      // ============================================================
      for (let i = 0; i < faces.length; i++) {
        const f = faces[i], wins = plans[i].wins;
        for (let k = 0; k < ST; k++) {
          for (let j = 0; j < wins.length; j++) {
            const wn = wins[j], ow = wn.ow;
            const p = placeWin(f, wn, k);
            if (!p) continue;
            const y0 = p.y0, wh = p.h, cy = y0 + wh / 2;
            // the reveal, so the opening reads as a hole in a thick wall
            F.box(ctx, f, wn.t, cy, ow, wh, WP - 0.05, DARK);
            // The runBand skin left this whole tangent interval open. Anything
            // the sash does not fill — the head panel above it, and the apron
            // below a sash that was lifted clear of the doorcase — is plugged
            // with a painted board the WINDOW's width, never the face's.
            const top0 = k * FH + 0.55 + glassH;
            if (top0 - (y0 + wh) > 0.10) {
              F.box(ctx, f, wn.t, (y0 + wh + top0) / 2 + 0.03,
                ow + wn.cw * 2, top0 - y0 - wh + 0.06, WP + 0.01, PALE);
            }
            if (p.lift > 0.10) {
              F.box(ctx, f, wn.t, (k * FH + 0.52 + y0) / 2, ow + wn.cw * 2,
                y0 - k * FH - 0.52 + 0.04, WP + 0.01, PALE);
            }
            // flat casing each side, and a flat head — Greek Revival trim is
            // BOARDS, square-edged, with no mouldings to speak of
            for (const sg of [-1, 1]) {
              F.rib(ctx, f, wn.t + sg * (ow / 2 + wn.cw / 2), y0 - 0.10, y0 + wh + 0.10,
                wn.cw, WP + 0.06, TRIM);
            }
            F.box(ctx, f, wn.t, y0 + wh + 0.13, ow + wn.cw * 2 + 0.22, 0.20, WP + 0.13, TRIM);
            F.box(ctx, f, wn.t, y0 + wh + 0.28, ow + wn.cw * 2 + 0.40, 0.14, WP + 0.20, TRIM);
            // the sill, standing proud — it lives in the host's sill zone
            F.box(ctx, f, wn.t, y0 - 0.13, ow + wn.cw * 2 + 0.34, 0.18, WP + 0.19, TRIM);
            // 6/6 SASH: two slim muntins and a meeting rail. Thin, and never
            // wider than the opening, so it frames the host glass, not covers it.
            for (const u of [-1 / 6, 1 / 6]) {
              F.rib(ctx, f, wn.t + u * ow * 2, y0 + 0.04, y0 + wh - 0.04, 0.055, WP + 0.03, TRIM);
            }
            F.box(ctx, f, wn.t, y0 + wh * 0.52, ow, 0.09, WP + 0.03, TRIM);
            // SHUTTERS, flanking the glass. Louvred panel, a stile each edge,
            // and four slat shadows — the one saturated colour on the house.
            if (!wantShut || wn.shW < 0.17) continue;
            for (const sg of [-1, 1]) {
              const st = wn.t + sg * (ow / 2 + wn.cw + wn.shW / 2);
              F.box(ctx, f, st, cy, wn.shW, wh, WP + 0.10, SHUT);
              for (const eg of [-1, 1]) {
                F.rib(ctx, f, st + eg * (wn.shW / 2 - 0.045), y0, y0 + wh, 0.09, WP + 0.14, SHUTD);
              }
              const nl = Math.max(2, Math.min(5, Math.round(wh / 0.62)));
              for (let l = 1; l < nl; l++) {
                F.box(ctx, f, st, y0 + (wh / nl) * l, wn.shW * 0.80, 0.06, WP + 0.13, SHUTD);
              }
            }
          }
        }
      }

      // ============================================================
      //  7. PILASTERS — corner antae, and a respond on every bay line
      // ============================================================
      // Vertical members are the one thing the kit positively wants crossing
      // the host's window band: they are what stop it reading as a ribbon.
      const cLen = clamp(unit * 0.075, 0.55, 1.30);
      F.corners(ctx, (plinthTop + yEnt) / 2, yEnt - plinthTop, cLen, WP + 0.06, PALE);
      F.corners(ctx, yEnt - 0.34, 0.30, cLen + 0.16, WP + 0.13, TRIM);   // echinus
      F.corners(ctx, yEnt - 0.10, 0.20, cLen + 0.34, WP + 0.20, TRIM);   // abacus
      F.corners(ctx, plinthTop + 0.22, 0.44, cLen + 0.10, WP + 0.12, TRIM);
      for (let i = 0; i < faces.length; i++) {
        const f = faces[i], lines = plans[i].lines;
        const pw = clamp(f.span / Math.max(2, lines.length) * 0.17, 0.28, 0.80);
        for (let j = 0; j < lines.length; j++) {
          const t = lines[j];
          // a respond that lands inside the corner board is already drawn
          if (Math.abs(t) > f.span / 2 - cLen * 0.55) continue;
          if (!F.clearsDoor(ctx, f, t, pw + 0.3)) continue;
          F.rib(ctx, f, t, plinthTop, yEnt - 0.30, pw, WP + 0.05, PALE);
          F.box(ctx, f, t, yEnt - 0.28, pw * 1.30, 0.26, WP + 0.11, TRIM);
          F.box(ctx, f, t, yEnt - 0.09, pw * 1.55, 0.18, WP + 0.17, TRIM);
        }
      }

      // ============================================================
      //  8. THE ENTABLATURE RING — the strongest horizontal on the house
      // ============================================================
      // Its underside sits at rTop - 0.40, inside the host's solid header zone,
      // so a band this deep never crosses a pane. Everything above rTop is the
      // eaves the roof lands on. Never interrupted: a cornice with a gap in it
      // is the fastest way to make a house look like a stage flat.
      ring(yEnt + aH * 0.5, aH, CP * 0.34, TRIM, 0.5);                       // architrave
      ring(yEnt + aH - 0.04, 0.12, CP * 0.44, F.shade(TRIM, 0.90), 0.5);     // taenia
      ring(yEnt + aH + frH / 2, frH, CP * 0.27, PALE, 0.44);                 // the PLAIN frieze
      ring(yEnt + aH + frH + coH * 0.14, coH * 0.28, CP * 0.54, TRIM, 0.5);  // bed mould
      ring(yCorn - coH * 0.34, coH * 0.56, CP, TRIM, 0.6);                   // the corona
      ring(yCorn - 0.07, 0.17, CP * 0.84, F.shade(TRIM, 0.94), 0.6);         // cyma
      // The period's own trick for lighting an attic: little cast-iron grilles
      // let into the frieze board. Skipped on the front, where the pediment
      // stands in front of the frieze anyway.
      for (let i = 0; i < faces.length; i++) {
        const f = faces[i];
        if (f.s === ctx.doorSide || frH < 0.5) continue;
        const wins = plans[i].wins;
        for (let j = 0; j < wins.length; j++) {
          const gw = Math.min(wins[j].ow * 1.15, frH * 2.4), gh = frH * 0.54;
          F.box(ctx, f, wins[j].t, yEnt + aH + frH / 2, gw + 0.22, gh + 0.22, CP * 0.32, TRIM);
          F.box(ctx, f, wins[j].t, yEnt + aH + frH / 2, gw, gh, CP * 0.36, GLAZ);
          for (const u of [-0.25, 0, 0.25]) {
            F.rib(ctx, f, wins[j].t + u * gw, yEnt + aH + frH / 2 - gh / 2,
              yEnt + aH + frH / 2 + gh / 2, 0.06, CP * 0.40, TRIM);
          }
        }
      }

      // ============================================================
      //  9. THE LOW GABLE ROOF — stepped courses, narrowing on ONE axis
      // ============================================================
      const nR = clamp(Math.round(rise / 0.30), 7, 18);
      const rcH = rise / nR;
      const roofQ = 2 * (halfQ + eaveOv);
      for (let i = 0; i < nR; i++) {
        const u = (i + 0.5) / nR;
        const ht = Math.max(0.24, halfT0 * (1 - u));
        const y = yCorn + (i + 0.5) * rcH;
        gbox(0, y, 0, ht * 2, rcH + 0.02, roofQ,
          i % 3 === 1 ? ROOFL : (i % 3 === 2 ? F.shade(ROOF, 0.88) : ROOF));
        // the lap line on every other course: what makes a staircase of boxes
        // read as a slope of slate instead of as stripes
        if (i % 2 === 0) {
          gbox(0, yCorn + i * rcH + 0.04, 0, ht * 2 + 0.12, 0.07, roofQ + 0.08, F.shade(ROOF, 0.72));
        }
      }
      const ridgeW = clamp(halfT0 * 0.07, 0.30, 0.90);
      gbox(0, ridge + 0.10, 0, ridgeW * 2, 0.20, roofQ + 0.10, ROOFL);
      // THE REAR GABLE. The front's triangle is the pediment; the back gets the
      // same rake in plain trim boards plus one round-headed attic light, so the
      // house has a back and not just a front.
      {
        const rq = -ef.out * (halfQ + eaveOv - 0.14);
        const RBW = clamp(CP * 0.55, 0.28, 0.70);
        for (let i = 0; i < nR; i++) {
          const u = (i + 0.5) / nR;
          const ht = Math.max(0.24, halfT0 * (1 - u));
          const y = yCorn + (i + 0.5) * rcH;
          for (const sg of [-1, 1]) {
            gbox(sg * (ht - RBW * 0.5), y, rq, RBW, rcH + 0.02, 0.36, TRIM);
          }
        }
        const lw = Math.min(halfT0 * 0.34, rise * 0.72);
        if (lw > 0.7) {
          gbox(0, yCorn + rise * 0.30, rq, lw + 0.30, lw * 0.62 + 0.30, 0.30, TRIM);
          gbox(0, yCorn + rise * 0.30, rq, lw, lw * 0.62, 0.34, GLAZ);
        }
      }
      // CHIMNEYS on the ridge, toward the rear, painted to match and slate-capped.
      {
        const nCh = (ST >= 2 || halfQ > 5) ? 2 : 1;
        const chQ = clamp(unit * 0.12, 0.80, 2.00);      // wider along the ridge
        const chT = chQ * 0.62;
        const chTop = ridge + clamp(FH * 0.60, 1.00, 2.80);
        const chY0 = ridge - rise * 0.30;
        for (let i = 0; i < nCh; i++) {
          const fr = (nCh === 1) ? -0.34 : (i === 0 ? -0.16 : -0.66);
          const q = ef.out * halfQ * fr;
          gbox(0, (chY0 + chTop) / 2, q, chT, chTop - chY0, chQ, PALE);
          gbox(0, chTop - 0.42, q, chT + 0.10, 0.16, chQ + 0.10, TRIM);
          gbox(0, chTop + 0.11, q, chT + 0.28, 0.24, chQ + 0.28, TRIM);   // corbelled cap
          for (const sg of [-1, 1]) {
            gbox(0, chTop + 0.48, q + sg * chQ * 0.26, chT * 0.44, 0.44, chQ * 0.30, ROOF);
          }
        }
      }

      // ============================================================
      //  10. THE PORTICO — stylobate, steps, colonnade, portico beam
      // ============================================================
      // A full-width crepidoma. The terrace is one continuous ramp platform, so
      // the whole flight is walkable in a sprint and no collider can ever seal
      // the front door.
      const terrW = Math.min(ef.span - 0.20, 2 * (outer + cr) + 1.20);
      const sw = Math.max(1.2, terrW - 0.90);
      const stepD = clamp(PD * 0.55, 0.90, 2.00);
      if (porch) {
        pbox(0, TOP / 2, terrW, TOP, 0, PD, F.shade(TRIM, 0.96));
        pbox(0, TOP + 0.05, terrW + 0.10, 0.10, -0.05, PD + 0.06, TRIM);   // stylobate edge
        if (ef.horiz) {
          ctx.plat(-terrW / 2, terrW / 2, ef.out > 0 ? halfQ : -(halfQ + PD),
            ef.out > 0 ? halfQ + PD : -halfQ, TOP, null);
        } else {
          ctx.plat(ef.out > 0 ? halfQ : -(halfQ + PD), ef.out > 0 ? halfQ + PD : -halfQ,
            -terrW / 2, terrW / 2, TOP, null);
        }
        const nS = 3;
        for (let i = 0; i < nS; i++) {
          const th = TOP * (nS - i) / nS;
          const o0 = PD + i * (stepD / nS);
          pbox(0, th / 2, sw, th, o0, o0 + stepD / nS + 0.02, F.shade(TRIM, 0.92 + i * 0.03));
        }
        const o0 = halfQ + PD, o1 = halfQ + PD + stepD;
        if (ef.horiz) {
          const z0 = ef.out * o0, z1 = ef.out * o1;
          ctx.plat(-sw / 2, sw / 2, Math.min(z0, z1), Math.max(z0, z1), TOP,
            { z0: ctx.oz + z1, z1: ctx.oz + z0, y0: 0, y1: TOP });
        } else {
          const x0 = ef.out * o0, x1 = ef.out * o1;
          ctx.plat(Math.min(x0, x1), Math.max(x0, x1), -sw / 2, sw / 2, TOP,
            { axis: "x", x0: ctx.ox + x1, x1: ctx.ox + x0, y0: 0, y1: TOP });
        }
      }
      // THE COLUMNS. The only real meshes here, capped at 8 by construction.
      const qOut = ef.out * (halfQ + cq);
      for (let i = 0; i < colT.length && i < 8; i++) {
        const t = colT[i];
        const lx = ef.horiz ? t : qOut, lz = ef.horiz ? qOut : t;
        let sy = colY, sh = colH - capH;
        if (ionic) {
          // Ionic stands on a base; Greek Doric lands straight on the pavement.
          gbox(t, colY + 0.11, qOut, cr * 2.5, 0.22, cr * 2.5, TRIM);
          gbox(t, colY + 0.29, qOut, cr * 2.2, 0.16, cr * 2.2, PALE);
          sy = colY + 0.37; sh = colH - capH - 0.37;
        }
        ctx.column(lx, sy, lz, cr, Math.max(0.4, sh), PALE, 14);
        // FLUTING: dark slivers around the visible arc of the shaft. Free,
        // merged, and at any distance a player stands it reads as grooving.
        const nf = 7;
        for (let k = 0; k < nf; k++) {
          const a = (-1 + 2 * (k + 0.5) / nf) * 1.15;      // +/- 66 degrees of arc
          const tq = cq + Math.cos(a) * cr * 0.94;
          gbox(t + Math.sin(a) * cr * 0.94, sy + sh * 0.5, ef.out * (halfQ + tq),
            cr * 0.20, sh * 0.94, cr * 0.20, FLUT);
        }
        // NECKING + CAPITAL. Doric: annulets, a flaring echinus, a square
        // abacus. Ionic: the same abacus over two volute blocks.
        const cy0 = sy + sh;
        gbox(t, cy0 - 0.07, qOut, cr * 2.02, 0.09, cr * 2.02, DIM);
        if (ionic) {
          for (const sg of [-1, 1]) {
            gbox(t + sg * cr * 0.92, cy0 + capH * 0.38, qOut, cr * 0.80, capH * 0.62, cr * 1.7, TRIM);
            gbox(t + sg * cr * 0.92, cy0 + capH * 0.30, qOut, cr * 0.44, capH * 0.28, cr * 1.9, PALE);
          }
          gbox(t, cy0 + capH * 0.30, qOut, cr * 1.9, capH * 0.44, cr * 1.9, PALE);
        } else {
          gbox(t, cy0 + capH * 0.26, qOut, cr * 2.14, capH * 0.46, cr * 2.14, PALE);
          gbox(t, cy0 + capH * 0.60, qOut, cr * 2.46, capH * 0.28, cr * 2.46, PALE);
        }
        gbox(t, cy0 + capH * 0.88, qOut, cr * 2.76, capH * 0.26, cr * 2.76, TRIM);   // abacus
      }
      // THE PORTICO BEAM. One slab over the whole porch plan doubles as the
      // architrave you see from the street and the porch ceiling you see from
      // under it, and its underside is the highest thing that has to clear the
      // doorway — which it does, because yEnt was solved off rTop.
      pbox(0, yEnt + aH * 0.5, terrW + 0.30, aH, -0.10, PD + 0.10, TRIM);
      pbox(0, yEnt + aH - 0.04, terrW + 0.44, 0.13, -0.10, PD + 0.20, F.shade(TRIM, 0.90));
      pbox(0, yEnt + aH + frH / 2, terrW + 0.20, frH, -0.10, PD + 0.02, PALE);

      // ============================================================
      //  11. THE PEDIMENT — the whole point of the building
      // ============================================================
      // A real triangle: a heavy horizontal geison, two raking cornices that
      // stand 0.4 m proud of the wall behind them, and a genuinely RECESSED
      // tympanum in shadow between them. Same pitch and the same apex height as
      // the roof behind it, because this triangle IS that roof's gable end.
      {
        const pedHalf0 = halfT0 + 0.16;
        const nP = clamp(Math.round(rise / 0.28), 7, 18);
        const pH = rise / nP;
        const RB = clamp(CP * 0.78, 0.36, 1.10);         // raking cornice, horizontal width
        const tq0 = -0.32, tq1 = PD - 0.24;              // tympanum: set back
        const rq0 = -0.32, rq1 = PD + 0.16;              // rake: proud of it

        // THE GEISON — the horizontal cornice the triangle stands on. This is
        // the heaviest single line in the design and what makes the front read
        // as a temple rather than as a gable with trim.
        pbox(0, yCorn - coH * 0.30, pedHalf0 * 2 + 0.50, coH * 0.60, -0.38, PD + 0.34, TRIM);
        pbox(0, yCorn + 0.09, pedHalf0 * 2 + 0.24, 0.18, -0.38, PD + 0.22, F.shade(TRIM, 0.92));

        for (let i = 0; i < nP; i++) {
          const u = (i + 0.5) / nP;
          const hw = pedHalf0 * (1 - u);
          const y = yCorn + (i + 0.5) * pH;
          if (hw - RB > 0.22) pbox(0, y, (hw - RB) * 2, pH + 0.02, tq0, tq1, DIM);
          for (const sg of [-1, 1]) {
            pbox(sg * (hw - RB / 2), y, RB, pH + 0.02, rq0, rq1, TRIM);
            // a lit lip on the outer end of every course — the thing that turns
            // a stack of boxes into a slope
            pbox(sg * (hw - RB * 0.20), y + pH * 0.32, RB * 0.44, pH * 0.30,
              rq0, rq1 + 0.09, F.mix(TRIM, 0xfffdf5, 0.35));
          }
        }
        // the apex stone, then a stepped ACROTERION standing on it, plus the
        // two corner acroteria — three notches in the skyline, all free dboxes.
        pbox(0, ridge - pH * 0.45, RB * 2.3, pH * 1.5, rq0, rq1, TRIM);
        const acH = clamp(rise * 0.20, 0.40, 1.20);
        for (let k = 0; k < 3; k++) {
          const v = (k + 1) / 3;
          pbox(0, ridge + acH * (k + 0.5) / 3, RB * 1.5 * (1 - v * 0.52), acH / 3 + 0.02,
            tq1 - 0.34, rq1 - 0.04, k === 1 ? F.shade(TRIM, 0.92) : TRIM);
        }
        for (const sg of [-1, 1]) {
          pbox(sg * (pedHalf0 - RB * 0.5), yCorn + acH * 0.34, RB * 1.15, acH * 0.68,
            tq1 - 0.30, rq1 + 0.04, TRIM);
        }

        // THE TYMPANUM'S ORNAMENT. Position-hashed between the two things a
        // Greek Revival gable ever actually carries: a semicircular fanlight,
        // or a plain field with a raised date tablet.
        const oR = Math.min(rise * 0.36, pedHalf0 * 0.24);
        if (oR > 0.34 && ctx.hash(0x21c7) < 0.6) {
          // a fanlight, drawn as stacked slices — the honest way to make a
          // circle out of merged axis-aligned boxes
          const oy = yCorn + rise * 0.34;
          const sl = 6;
          for (let k = 0; k < sl; k++) {
            const v = (k + 0.5) / sl;
            const hwv = oR * Math.sqrt(Math.max(0, 1 - (v * 2 - 1) * (v * 2 - 1)));
            pbox(0, oy - oR + v * oR * 2, hwv * 2 + 0.26, (oR * 2) / sl + 0.02,
              tq1 - 0.16, tq1 + 0.08, TRIM);
            pbox(0, oy - oR + v * oR * 2, hwv * 2, (oR * 2) / sl + 0.02,
              tq1 - 0.06, tq1 + 0.12, GLAZ);
          }
          for (const u of [-0.42, 0, 0.42]) {
            pbox(u * oR * 1.5, oy, 0.08, oR * 1.7, tq1 - 0.02, tq1 + 0.16, TRIM);
          }
        } else if (rise > 1.1) {
          const tw = Math.min(pedHalf0 * 0.44, rise * 1.1);
          pbox(0, yCorn + rise * 0.30, tw, rise * 0.26, tq1 - 0.10, tq1 + 0.12, TRIM);
          pbox(0, yCorn + rise * 0.30, tw - 0.34, rise * 0.26 - 0.24, tq1 - 0.04, tq1 + 0.16, DIM);
        }
      }

      // ============================================================
      //  12. THE ENTRANCE — antae, sidelights, transom, flat cap
      // ============================================================
      // The canonical Greek Revival front door: a wide rectangular opening with
      // narrow sidelights, a rectangular transom (never a fanlight — that is
      // Federal), flanking pilasters, and a flat entablature cap.
      {
        // On a ONE-STOREY shell the wall top is below the kit's nominal 3.6 m
        // door head, so doorTop is clamped under yEnt and a full-width cap over
        // the opening would be forced below e.head. In that case the cap is
        // emitted in SEGMENTS around the doorway instead, so nothing at all
        // hangs into the opening either way — the flight of steps and the porch
        // beam above still leave well over two metres of clear headroom.
        const capOK = doorTop >= e.head - 0.02;
        const dW = Math.min(e.gap - 0.85, 2.05);
        const slW = clamp(e.gap * 0.15, 0.22, 0.50);
        // the transom eats a fixed slice of the head; on an unusually short
        // storey it gives that back rather than inverting the leaf below it
        const leafTop = Math.max(TOP + 1.0, doorTop - Math.min(0.62, (doorTop - TOP) * 0.22));
        // the shadowed reveal the whole thing is cut into
        F.box(ctx, ef, 0, (TOP + doorTop) / 2, e.gap + 0.42, doorTop - TOP, 0.05, DARK);
        // the leaf pair, with a meeting stile and two raised panels each
        F.box(ctx, ef, 0, (TOP + leafTop) / 2, dW, leafTop - TOP, 0.10, SHUTD);
        F.rib(ctx, ef, 0, TOP, leafTop, 0.10, 0.16, SHUT);
        for (const sg of [-1, 1]) for (const v of [0.30, 0.70]) {
          F.box(ctx, ef, sg * dW * 0.25, TOP + (leafTop - TOP) * v, dW * 0.32,
            (leafTop - TOP) * 0.26, 0.14, SHUT);
        }
        // sidelights: tall narrow glass, on a panelled base
        for (const sg of [-1, 1]) {
          const st = sg * (dW / 2 + slW / 2 + 0.16);
          F.box(ctx, ef, st, (TOP + leafTop) / 2, slW, leafTop - TOP, 0.09, TRIM);
          if (leafTop - TOP > 0.9) {
            F.box(ctx, ef, st, (TOP + 0.55 + leafTop) / 2, slW * 0.72, leafTop - TOP - 0.55, 0.13, GLAZ);
          }
          F.rib(ctx, ef, sg * (dW / 2 + 0.08), TOP, doorTop, 0.14, 0.17, TRIM);
        }
        // the transom over door and sidelights, divided by three muntins
        const trW = dW + slW * 2 + 0.5;
        F.box(ctx, ef, 0, doorTop - 0.32, trW, 0.42, 0.11, GLAZ);
        for (const u of [-0.3, 0, 0.3]) F.rib(ctx, ef, u * trW, doorTop - 0.53, doorTop - 0.11, 0.07, 0.15, TRIM);
        F.box(ctx, ef, 0, leafTop + 0.08, trW + 0.16, 0.16, 0.17, TRIM);
        // THE ANTAE flanking the opening, with their own little caps
        for (const sg of [-1, 1]) {
          F.rib(ctx, ef, sg * antT, TOP, doorTop, 0.46, 0.22, TRIM);
          F.box(ctx, ef, sg * antT, doorTop - 0.16, 0.62, 0.18, 0.28, TRIM);
        }
        // THE CAP. Above e.head when the shell allows it, otherwise segmented
        // around the doorway per the rule about bands and openings.
        const capW = antT * 2 + 0.9;
        const holes = capOK ? [] : [doorHole];
        const cf = { s: ef.s, horiz: ef.horiz, out: ef.out, span: capW, halfN: ef.halfN };
        runBand(ctx, F, cf, doorTop + 0.14, 0.26, 0.34, TRIM, holes, 0.0);
        runBand(ctx, F, cf, doorTop + 0.33, 0.16, 0.44, TRIM, holes, 0.10);
        // a pair of lanterns on the antae — the only lit thing on the house
        if (ctx.lamp && doorTop - 0.95 > TOP) {
          const nrm = ef.halfN + 0.34;
          for (const sg of [-1, 1]) {
            const t = sg * antT;
            const lx = ef.horiz ? t : ef.out * nrm, lz = ef.horiz ? ef.out * nrm : t;
            F.box(ctx, ef, t, doorTop - 0.62, 0.14, 0.34, 0.30, SHUTD);
            ctx.lamp(lx, doorTop - 0.90, lz, clamp(unit * 0.016, 0.12, 0.22), 0xffe0a8);
          }
        }
      }
    },
  });
})();
