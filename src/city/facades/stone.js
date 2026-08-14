/* ============================================================
   city/facades/stone.js — "Ashlar Bank": the Beaux-Arts commercial palace.

   THE READ. A dressed-limestone institution that means to outlive you. The
   1900s bank, exchange or head office: a building whose entire argument is
   that your money is safe because the walls are two feet of cut stone.

   THE COMPOSITION IS THE STYLE. Everything here exists to state one idea in
   three horizontal parts, and every part is solved from the host's own
   numbers so a 10 m corner shop and a 40 m block both read correctly:

     1. RUSTICATED BASE — the lower one or two storeys (from ctx.storeys) laid
        in alternating proud and recessed courses. The deep joint shadow is
        what says "stone" instead of "painted box", and it is the only place
        the eye can measure the wall's thickness. Course height derives from
        ctx.FH so the coursing never becomes stripes on a tall block or a
        single slab on a short one.
     2. THE SHAFT — deliberately plain wall, because the base and the crown
        cannot read as heavy unless something between them is quiet. Its one
        event is the PIANO NOBILE: the first shaft floor gets pedimented
        window heads on console brackets, alternating triangular and
        segmental bay by bay, which is the classical way of saying "the
        important room is behind this window".
     3. ENTABLATURE + ATTIC — a full architrave / frieze / dentilled cornice
        with a deep projection. This is the strongest horizontal in the
        design and the thing that makes the building look expensive from
        200 m. It is solved BACKWARDS from ctx.rTop: the attic and the
        entablature are subtracted from the roofline first, and only what is
        left over becomes the giant order's height. That ordering is the
        whole trick — size the columns first and the cornice grows through
        the parapet.

   THE GIANT ORDER stands on the entrance face only, engaged (about 70 percent
   proud) so it belongs to the wall rather than sitting in front of it. It runs
   two-plus storeys from a pedestal on the base to a capital under the
   architrave, and any column position that would foul the doorway is dropped
   via F.clearsDoor rather than nudged — a shifted column reads as a mistake,
   a missing one reads as an intercolumniation. Flutes are drawn as thin dark
   slivers on the shaft front (free, merged) instead of real geometry.

   QUOINS at the corners alternate long and short courses all the way to the
   cornice, which is what ties the four faces into one block.

   THE BALUSTRADE replaces a plain parapet: short balusters between piers,
   urn finials on the piers. This is the silhouette element — from a distance
   a balustrade is a dotted line against the sky and nothing else in the city
   makes that shape, which is exactly the "identify it as a black shape"
   test the kit is built around. Hence crownsRoof.

   THE STEPS are a low broad flight with cheek walls. They are registered with
   ctx.plat and topped out under physics STEP_UP (0.45) so the player walks up
   and straight in; the treads are cosmetic and the platform is one continuous
   ramp, so a sprinting rider can never sample a seam between tread boxes.

   MESH BUDGET. Everything is ctx.dbox (merged, free) except the engaged
   columns (capped at 8, two cylinders' worth of silhouette each is not worth
   it, so one cylinder each) and the urns (capped at 6). Well under the ~40
   real-mesh ceiling.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  // ---- a horizontal band on one face, interrupted by "holes" -------------
  // holes is a list of [t0,t1] tangent intervals the band must not cross —
  // the doorway, a window reveal. Emitting a band in segments is the only way
  // an opening can exist in merged axis-aligned boxes: you do not cut a hole,
  // you decline to draw over it.
  function runBand(ctx, F, f, cy, h, proj, col, holes, over) {
    const L = -f.span / 2 - (over == null ? 0.12 : over);
    const R = -L;
    let x = L;
    const hs = (holes || []).slice().sort(function (a, b) { return a[0] - b[0]; });
    for (let i = 0; i < hs.length; i++) {
      const a = Math.max(L, hs[i][0]), b = Math.min(R, hs[i][1]);
      if (b <= x) continue;
      if (a - x > 0.05) F.box(ctx, f, (x + a) / 2, cy, a - x, h, proj, col);
      x = b;
    }
    if (R - x > 0.05) F.box(ctx, f, (x + R) / 2, cy, R - x, h, proj, col);
  }

  CBZ.registerFacade("stone", {
    label: "Ashlar Bank",
    crownsRoof: true,
    build: function (ctx, F, spec) {
      const FH = ctx.FH, H = ctx.rTop;
      const e = F.entrance(ctx);
      // The ONLY source of variation in this facade: which parity of bay gets
      // the triangular pediment. Position-hashed, so two banks on one street
      // are not the same drawing and one bank is the same on every boot.
      const pedPhase = ctx.hash(0x5701) < 0.5 ? 0 : 1;

      // ---------------- palette ----------------
      // Pale limestone off the host colour, with two darker tones: one for the
      // recessed rustication courses (the joint shadow), one for the window
      // reveals, which must be the darkest thing on the building or the
      // openings stop reading as openings.
      // The first render came back almost pure white: mixing hard to 0xffffff
      // and then brightening again flattened every course into one value, and a
      // facade whose whole subject is joint shadow cannot afford that. These
      // mixes are deliberately restrained, and PALE is only a little lighter
      // than LIME so the cornice reads as a highlight rather than a different
      // material.
      const LIME = F.mix(ctx.color, 0xf2ece0, 0.55);
      const PALE = F.mix(LIME, 0xfffaf0, 0.22);      // cornice / capitals catch light
      const DEEP = F.shade(LIME, 0.58);              // rustication grooves
      const GLASS = F.mix(0x161c24, LIME, 0.10);     // reveals: the darkest thing here

      // ---------------- the three-part split ----------------
      // Solved top-down from the roofline, per the header. Nothing below is a
      // magic number: each cap is a fraction of the building's own height.
      const nBaseStorey = ctx.storeys >= 3 ? 2 : 1;
      // The 0.32 cap is load-bearing, not taste: the base, the entablature and
      // the attic are all subtracted from rTop before the giant order gets what
      // is left, so a base allowed to reach 42 percent of the height left a
      // 3 m stub on the standard 4-storey subject and the order silently
      // dropped out (the first render proved it). 32 percent keeps two real
      // storeys of column on anything 3 storeys or taller.
      const yBase = Math.min(H * 0.32, nBaseStorey * FH);      // top of rustication
      const entH = Math.max(0.45, Math.min(H * 0.17, FH * 0.85));   // full entablature
      const atticH = ctx.storeys >= 3 ? Math.min(FH * 0.75, H * 0.13) : 0;
      const yEnt = H - atticH - entH;                           // underside of architrave
      const shaftH = yEnt - yBase;

      const courseH = Math.max(0.34, Math.min(FH / 5, yBase / 2));
      const nCourse = Math.max(2, Math.round(yBase / courseH));
      const cH = yBase / nCourse;

      const PB = Math.max(0.14, ctx.WT ? ctx.WT * 1.1 : 0.18);  // base course projection
      const PR = PB * 0.45;                                     // recessed course

      const doorHole = [-(e.gap / 2 + 0.9), (e.gap / 2 + 0.9)];
      function holesFor(f, extra) {
        const out = (extra || []).slice();
        if (f.s === ctx.doorSide) out.push(doorHole);
        return out;
      }

      // ================= 1. THE RUSTICATED BASE =================
      // Alternating proud/recessed courses. Window openings are cut out of the
      // coursing (not drawn over) so the arch heads below read as real voids.
      const faces = F.faces(ctx);
      const baseWin = [];      // per face: the opening rects we must not course over
      for (let fi = 0; fi < faces.length; fi++) {
        const f = faces[fi];
        // Tall arched openings, one per bay, roughly one bay per 4 m of face.
        const nb = F.bayCount(f, 4.0, 2, 8);
        const bays = F.bays(f, nb, Math.max(0.9, f.span * 0.07));
        const y0 = cH * 1.15;                                   // sill height
        const headY = yBase - cH * 1.25;                        // springing line
        const rise = Math.min(headY * 0.42, (headY - y0) * 0.45);
        const list = [];
        if (headY - y0 > 0.9 && rise > 0.22) {
          for (let i = 0; i < bays.length; i++) {
            const b = bays[i];
            const bw = Math.min(b.w * 0.56, headY - y0);
            if (!F.clearsDoor(ctx, f, b.t, bw + 1.2)) continue;
            list.push({ t: b.t, w: bw, y0: y0, y1: headY, rise: rise });
          }
        }
        baseWin.push(list);
      }

      for (let fi = 0; fi < faces.length; fi++) {
        const f = faces[fi];
        const wins = baseWin[fi];
        for (let c = 0; c < nCourse; c++) {
          const cy = c * cH + cH / 2;
          const proud = (c % 2) === 0;
          const holes = holesFor(f);
          for (let i = 0; i < wins.length; i++) {
            const wnd = wins[i];
            // this course only steps aside where the opening actually is
            if (cy + cH / 2 > wnd.y0 && cy - cH / 2 < wnd.y1 + wnd.rise) {
              const halfW = wnd.w / 2 + 0.16;
              holes.push([wnd.t - halfW, wnd.t + halfW]);
            }
          }
          runBand(ctx, F, f, cy, cH * 0.94, proud ? PB : PR, proud ? LIME : DEEP, holes, 0.10);
          // the joint itself: a thin dark line under every proud course, which
          // is what actually makes rustication read at gameplay distance.
          if (proud && c > 0) runBand(ctx, F, f, c * cH, 0.07, PB + 0.02, F.shade(DEEP, 0.7), holes, 0.10);
        }
        // the openings themselves: a dark reveal, a round arch head with a
        // keystone, and a sill that stands proud of the coursing.
        for (let i = 0; i < wins.length; i++) {
          const wnd = wins[i];
          F.box(ctx, F.face(ctx, f.s), wnd.t, (wnd.y0 + wnd.y1) / 2, wnd.w, wnd.y1 - wnd.y0, PR * 0.6, GLASS);
          F.box(ctx, f, wnd.t, wnd.y1 + wnd.rise * 0.45, wnd.w, wnd.rise * 0.9, PR * 0.6, GLASS);
          F.arch(ctx, f, wnd.t, wnd.y1, wnd.w, wnd.rise, 0.16, PB + 0.06, PALE, "round");
          // keystone: the wedge at the crown, taller than the arch ring so it
          // breaks the line — the single detail that says "carved", not "cut".
          F.box(ctx, f, wnd.t, wnd.y1 + wnd.rise * 0.9, wnd.w * 0.22, wnd.rise * 0.72, PB + 0.16, PALE);
          F.box(ctx, f, wnd.t, wnd.y0 - 0.12, wnd.w + 0.5, 0.2, PB + 0.14, PALE);
        }
      }
      // THE DOOR ITSELF gets the same treatment the base windows get, one size
      // up: a round arch head with an oversized keystone, springing just clear
      // of the door head so nothing hangs into the opening. This is the one
      // place a bank is allowed to shout.
      {
        const df = e.f;
        // a shadowed portal behind the door, so the entrance is a hole in a
        // thick wall rather than a door leaf stuck to a flat plane
        const pTop = Math.min(yBase - 0.25, e.head + 0.25);
        if (pTop > 0.6) F.box(ctx, df, 0, pTop / 2, e.gap + 1.1, pTop, 0.05, F.shade(LIME, 0.62));
        const dRise = Math.min(Math.max(0, yBase - pTop - 0.10), (e.gap + 1.6) * 0.45);
        if (dRise > 0.22) {
          F.arch(ctx, df, 0, pTop, e.gap + 1.6, dRise, 0.22, PB + 0.10, PALE, "round");
          F.box(ctx, df, 0, pTop + dRise * 0.92, (e.gap + 1.6) * 0.20, dRise * 0.8, PB + 0.22, PALE);
        }
        // jambs: the two blocks that make the doorway an opening in a wall
        for (const sg of [-1, 1]) {
          F.rib(ctx, df, sg * (e.gap / 2 + 0.55), 0.2, Math.min(yBase, e.head + 0.2), 0.9, PB + 0.08, PALE);
        }
      }
      // the plinth the whole thing stands on, and the string course that ends
      // the base — the two lines that make the base a separate storey.
      F.ring(ctx, 0.16, 0.32, PB + 0.20, F.shade(LIME, 0.86), 0.5);
      F.ring(ctx, yBase + 0.10, 0.22, PB + 0.22, PALE, 0.5);
      F.ring(ctx, yBase + 0.26, 0.10, PB + 0.12, F.shade(PALE, 0.8), 0.4);

      // ---------- THE GIANT ORDER, SOLVED BEFORE THE WALL ----------
      // Its column positions have to exist before the shaft is clad and before
      // the shaft windows are laid out, because on the entrance face the
      // windows belong in the INTERCOLUMNIATIONS. Laying windows on their own
      // rhythm and columns on another is what made the first render's entrance
      // face read as two unrelated drawings on one wall.
      const ef = e.f;
      const colY = yBase + 0.36;
      const colH = yEnt - 0.34 - colY;
      const wantOrder = colH > FH * 1.15 && ef.span > 8;
      const ordLines = [];
      let ordR = 0, ordHalf = 0;
      if (wantOrder) {
        let nc = Math.max(3, Math.min(7, Math.round(ef.span / 4.6)));
        if (nc % 2 === 0) nc += 1;          // odd gaps → nothing lands on the door axis
        const all = F.bayLines(ef, nc, Math.max(1.0, ef.span * 0.08));
        // Slenderness is a real number in this style: a classical shaft runs
        // 8-10 diameters tall. colH/13 is a stocky 6.5 diameters — heavy enough
        // to read as bank, and it keeps a 25 m block from growing 1.5 m-radius
        // tree trunks the way colH/8.6 did.
        ordR = Math.min(colH / 13, (ef.span / (nc + 1)) * 0.34);
        for (let i = 0; i < all.length; i++) {
          if (ordLines.length >= 8) break;
          if (F.clearsDoor(ctx, ef, all[i], ordR * 2.6)) ordLines.push(all[i]);
        }
        if (ordLines.length > 1) ordHalf = Math.abs(ordLines[0]) + ordR * 1.7;
      }

      // ================= 2. THE SHAFT =================
      // Plain wall, one window row per storey. The FIRST row is the piano
      // nobile and gets pediments on consoles; the rest get plain lintels,
      // because a building where every floor is important has no important
      // floor.
      // CLAD IT FIRST. The render showed a dark ribbon across the middle of
      // every face: the base and the crown were dressed but the shaft was
      // still the host's raw wall colour, so the trim looked like white tape
      // stuck on a grey box. One ashlar plane, slightly proud, makes the whole
      // elevation one material — and it is safe to run it edge to edge because
      // yBase already clears the door head on anything this order fits.
      // On a one-storey shop the shaft starts below the door head, so the
      // cladding still has to step around the opening.
      if (shaftH > 0.6) {
        for (let fi = 0; fi < faces.length; fi++) {
          const f = faces[fi];
          const low = yBase < e.head;
          const yMid = low ? Math.min(yEnt, e.head) : yBase;
          // behind the colonnade the cladding steps aside for a RECESSED plane,
          // so the columns have a shadow to stand against instead of vanishing
          // into a wall of their own colour.
          const ordHole = (f.s === ctx.doorSide && ordHalf > 0) ? [[-ordHalf, ordHalf]] : [];
          if (low && yMid > yBase + 0.05) {
            runBand(ctx, F, f, (yBase + yMid) / 2, yMid - yBase, 0.10, LIME,
              holesFor(f, ordHole), 0.14);
          }
          if (yEnt - yMid > 0.05) {
            runBand(ctx, F, f, (yMid + yEnt) / 2, yEnt - yMid, 0.10, LIME, ordHole, 0.2);
          }
        }
        if (ordHalf > 0) {
          F.box(ctx, ef, 0, (yBase + yEnt) / 2, ordHalf * 2, yEnt - yBase, 0.05, F.shade(LIME, 0.76));
        }
      }
      const rows = Math.max(1, Math.round(shaftH / FH));
      const rowH = shaftH / rows;
      for (let fi = 0; fi < faces.length; fi++) {
        const f = faces[fi];
        const nb = F.bayCount(f, 4.0, 2, 8);
        let bays = F.bays(f, nb, Math.max(0.9, f.span * 0.07));
        // ENTRANCE FACE: one window per intercolumniation, centred between the
        // columns that already exist. This is why the order was solved first.
        if (f.s === ctx.doorSide && ordLines.length > 1) {
          bays = [];
          for (let i = 0; i + 1 < ordLines.length; i++) {
            const gapW = ordLines[i + 1] - ordLines[i] - ordR * 2.2;
            if (gapW > 1.0) bays.push({ t: (ordLines[i] + ordLines[i + 1]) / 2, w: gapW, i: i });
          }
        }
        for (let r = 0; r < rows; r++) {
          const ry = yBase + r * rowH;
          const noble = (r === 0);
          const wh = rowH * (noble ? 0.56 : 0.48);
          const wy0 = ry + rowH * (noble ? 0.20 : 0.24);
          for (let i = 0; i < bays.length; i++) {
            const b = bays[i];
            // the intercolumniations on the entrance face are much wider than
            // an ordinary bay, so the aspect cap has to relax there or the
            // centre window reads as a postage stamp on a blank panel.
            const wide = (f.s === ctx.doorSide && ordLines.length > 1);
            const bw = Math.min(b.w * (wide ? 0.62 : 0.50), wh * (wide ? 1.5 : 0.85));
            // a window whose sill is already above the door head cannot foul
            // it — the centre bay over the entrance is the one that most wants
            // a window, and refusing it left a blank panel above the door.
            if (wy0 < e.head && !F.clearsDoor(ctx, f, b.t, bw + 1.2)) continue;
            const cy = wy0 + wh / 2;
            // reveal + surround
            // reveal first, then a moulded surround built as FOUR edge pieces.
            // A single box the size of the opening plus a margin does not frame
            // a window, it plugs it — the surround has to be a ring or the
            // reveal it is supposed to shadow disappears behind it.
            F.box(ctx, f, b.t, cy, bw, wh, 0.10, GLASS);
            const jw = 0.26;
            for (const sg of [-1, 1]) {
              F.rib(ctx, f, b.t + sg * (bw / 2 + jw / 2), cy - wh / 2, cy + wh / 2, jw, 0.20, PALE, -0.02);
            }
            F.box(ctx, f, b.t, cy + wh / 2 + jw / 2, bw + jw * 2, jw, 0.22, PALE, -0.02);
            F.box(ctx, f, b.t, cy - wh / 2 - jw / 2, bw + jw * 2, jw, 0.20, PALE, -0.02);
            // sill
            F.box(ctx, f, b.t, wy0 - 0.14, bw + 0.66, 0.18, 0.30, PALE);
            if (!noble) continue;
            // consoles: the two brackets that carry the pediment. Without them
            // a pediment looks glued on, which is the usual tell.
            for (const sg of [-1, 1]) {
              F.box(ctx, f, b.t + sg * (bw / 2 + 0.20), cy + wh / 2 - 0.28, 0.24, 0.72, 0.34, PALE);
              F.box(ctx, f, b.t + sg * (bw / 2 + 0.20), cy + wh / 2 + 0.10, 0.24, 0.16, 0.44, PALE);
            }
            const py = wy0 + wh + 0.16;
            const pw = bw + 0.90;
            F.box(ctx, f, b.t, py, pw, 0.20, 0.42, PALE);       // the cap the pediment sits on
            if (((i + pedPhase) % 2) === 0) {
              // TRIANGULAR: stepped courses shrinking to an apex.
              const ph = Math.min(rowH * 0.26, pw * 0.34);
              const st = 4;
              for (let k = 0; k < st; k++) {
                const u = (k + 0.5) / st;
                F.box(ctx, f, b.t, py + 0.10 + (k + 0.5) * (ph / st), pw * (1 - u * 0.92), ph / st + 0.02, 0.38, PALE);
              }
            } else {
              // SEGMENTAL: a shallow arc of the same footprint.
              F.arch(ctx, f, b.t, py + 0.12, pw * 0.5, Math.min(rowH * 0.22, pw * 0.30), 0.14, 0.38, PALE, "segmental");
            }
          }
        }
      }

      // ================= QUOINS =================
      // Alternating long/short courses up the full height to the cornice. This
      // is cheap (dbox) and it is most of what "dressed stone" looks like.
      const qH = Math.max(0.42, FH / 4.2);
      const qN = Math.max(3, Math.floor((yEnt - 0.2) / qH));
      const qProj = Math.max(0.16, PB * 1.1);
      for (let i = 0; i < qN; i++) {
        const cy = 0.14 + (i + 0.5) * qH;
        const long = (i % 2) === 0;
        F.corners(ctx, cy, qH * 0.93, long ? qH * 2.1 : qH * 1.25, qProj, long ? PALE : F.shade(LIME, 0.90));
      }

      // ================= 3. THE GIANT ORDER =================
      // Engaged columns on the entrance face, from a pedestal on the base to a
      // capital under the architrave. Height is whatever the entablature left
      // over; if that is less than a storey and a half the order would be a
      // stump, so the facade simply does without it (a small shop gets pilaster
      // strips instead, below).
      if (wantOrder && ordLines.length) {
        const r = ordR;
        const n = ef.halfN + r * 0.72;                 // engaged: 70 percent proud
        for (let i = 0; i < ordLines.length; i++) {
          const t = ordLines[i];
          const lx = ef.horiz ? t : ef.out * n;
          const lz = ef.horiz ? ef.out * n : t;
          // pedestal + base mouldings (dbox — square under a round shaft is
          // correct, and it is what stops the column looking like a pipe)
          F.box(ctx, ef, t, colY - 0.30, r * 2.9, 0.60, r * 1.55, PALE);
          F.box(ctx, ef, t, colY + 0.09, r * 2.5, 0.18, r * 1.50, PALE);
          ctx.column(lx, colY + 0.18, lz, r, colH - 0.18, PALE, 14);
          // fluting: thin dark slivers down the shaft front. Free, and it
          // reads as vertical grooving at any distance a player will stand.
          for (const u of [-0.62, -0.21, 0.21, 0.62]) {
            F.box(ctx, ef, t + u * r, colY + 0.18 + (colH - 0.18) / 2, r * 0.17, colH - 0.9, r * 0.55, F.shade(LIME, 0.72));
          }
          // capital: echinus then abacus
          const capY = colY + colH;
          F.box(ctx, ef, t, capY - 0.20, r * 2.3, 0.34, r * 1.5, PALE);
          F.box(ctx, ef, t, capY + 0.06, r * 2.8, 0.20, r * 1.75, PALE);
        }
      } else {
        // small building: flat pilaster strips carry the entablature instead
        const nc = Math.max(2, Math.min(6, Math.round(ef.span / 3.2)));
        const lines = F.bayLines(ef, nc, Math.max(0.7, ef.span * 0.08));
        for (let i = 0; i < lines.length; i++) {
          const t = lines[i];
          if (!F.clearsDoor(ctx, ef, t, 1.0)) continue;
          F.rib(ctx, ef, t, yBase + 0.3, yEnt - 0.28, 0.62, 0.20, PALE);
          F.box(ctx, ef, t, yEnt - 0.34, 0.86, 0.20, 0.28, PALE);
        }
      }

      // ================= THE ENTABLATURE =================
      // architrave (thin, closest to the wall) · frieze (tallest, plain) ·
      // dentils · cornice (the deep one). Continuous on all four faces and
      // never interrupted by the doorway — a cornice with a gap in it is the
      // fastest way to make a stone building look like a stage flat.
      const aH = entH * 0.24, frH = entH * 0.40, coH = entH * 0.24;
      const CP = Math.max(0.34, Math.min(entH * 0.95, FH * 0.30));   // cornice projection
      F.ring(ctx, yEnt + aH / 2, aH, CP * 0.42, PALE, 0.5);
      F.ring(ctx, yEnt + aH + frH / 2, frH, CP * 0.34, F.shade(LIME, 0.98), 0.44);
      // dentils: a row of small blocks under the corona. Count from the face's
      // own span so they stay square-ish on any building.
      const dY = yEnt + aH + frH + entH * 0.055;
      for (let fi = 0; fi < faces.length; fi++) {
        const f = faces[fi];
        const dn = Math.max(6, Math.min(64, Math.round(f.span / 0.62)));
        const step = (f.span + 0.3) / dn;
        for (let i = 0; i < dn; i++) {
          F.box(ctx, f, -(f.span + 0.3) / 2 + (i + 0.5) * step, dY, step * 0.48, entH * 0.11, CP * 0.62, PALE);
        }
      }
      F.ring(ctx, yEnt + aH + frH + entH * 0.145, entH * 0.06, CP * 0.70, F.shade(PALE, 0.86), 0.5);
      F.ring(ctx, yEnt + entH - coH * 0.42, coH * 0.62, CP, PALE, 0.6);          // the corona
      F.ring(ctx, yEnt + entH - 0.05, 0.16, CP * 0.86, F.shade(PALE, 0.92), 0.6); // cyma above it

      // ================= THE ATTIC =================
      if (atticH > 0.5) {
        const ay = yEnt + entH;
        const af = faces;
        for (let fi = 0; fi < af.length; fi++) {
          const f = af[fi];
          const nb = F.bayCount(f, 4.0, 2, 8);
          const bays = F.bays(f, nb, Math.max(0.9, f.span * 0.07));
          F.band(ctx, f, ay + atticH / 2, atticH, 0.12, F.shade(LIME, 0.94), 0.16);
          for (let i = 0; i < bays.length; i++) {
            const s = Math.min(bays[i].w * 0.34, atticH * 0.46);
            F.box(ctx, f, bays[i].t, ay + atticH * 0.5, s, s, 0.16, GLASS);
            F.box(ctx, f, bays[i].t, ay + atticH * 0.5, s + 0.28, s + 0.28, 0.13, PALE);
          }
        }
        F.ring(ctx, H - 0.10, 0.24, 0.30, PALE, 0.4);
      }

      // ================= THE BALUSTRADE =================
      // Piers on the bay lines, short balusters between them, urns on the
      // outer piers. From the street this is a dotted stone line against the
      // sky; from 200 m it is the building's signature.
      const balH = Math.max(0.85, Math.min(FH * 0.32, H * 0.10));
      const pierW = Math.max(0.55, balH * 0.62);
      const bt = Math.max(0.24, (ctx.WT || 0.2) * 1.4);
      F.ring(ctx, H + 0.10, 0.20, bt + 0.26, PALE, 0.42, -bt * 0.4);        // the plinth run
      const urnSpots = [];
      for (let fi = 0; fi < faces.length; fi++) {
        const f = faces[fi];
        const np = Math.max(2, Math.min(8, Math.round(f.span / 3.6)));
        const lines = F.bayLines(f, np, 0.0);
        const inner = -bt * 0.4;
        for (let i = 0; i < lines.length; i++) {
          F.box(ctx, f, lines[i], H + 0.20 + balH / 2, pierW, balH, bt + 0.10, PALE, inner);
          F.box(ctx, f, lines[i], H + 0.24 + balH, pierW + 0.24, 0.18, bt + 0.30, PALE, inner);
          if ((f.s === 0 || f.s === 1) && (i === 0 || i === lines.length - 1)) {
            urnSpots.push({ f: f, t: lines[i] });
          }
        }
        // the balusters: a slim shaft with a fat belly, three boxes each.
        // spacing wide enough that the gaps survive at distance — a balustrade
        // whose balusters touch is just a low wall, which is what the first
        // render's roofline looked like.
        const step = 0.58 + balH * 0.16;
        const runs = F.bays(f, np, 0.0);
        for (let i = 0; i < runs.length; i++) {
          const b = runs[i];
          const usable = b.w - pierW - 0.10;
          const cnt = Math.max(1, Math.floor(usable / step));
          const sp = usable / cnt;
          for (let k = 0; k < cnt; k++) {
            const t = b.t - usable / 2 + (k + 0.5) * sp;
            F.box(ctx, f, t, H + 0.24 + balH * 0.5, sp * 0.26, balH * 0.72, bt * 0.7, PALE, inner);
            F.box(ctx, f, t, H + 0.24 + balH * 0.34, sp * 0.44, balH * 0.24, bt * 0.8, PALE, inner);
          }
        }
        // top rail: what turns a row of sticks into a balustrade
        F.band(ctx, f, H + 0.30 + balH, 0.20, bt + 0.22, PALE, 0.42, inner);
      }
      // urns on the front and back corner piers only — real meshes, capped.
      for (let i = 0; i < urnSpots.length && i < 6; i++) {
        const u = urnSpots[i];
        const ur = Math.max(0.22, pierW * 0.42);
        const uy = H + 0.34 + balH;
        F.box(ctx, u.f, u.t, uy + ur * 0.35, ur * 1.15, ur * 0.7, bt + 0.10, PALE, -bt * 0.4);
        const lx = u.f.horiz ? u.t : u.f.out * (u.f.halfN - bt * 0.4 + (bt + 0.10) / 2);
        const lz = u.f.horiz ? u.f.out * (u.f.halfN - bt * 0.4 + (bt + 0.10) / 2) : u.t;
        ctx.ball(lx, uy + ur * 1.25, lz, ur, PALE);
        F.box(ctx, u.f, u.t, uy + ur * 2.2, ur * 0.34, ur * 0.7, bt + 0.10, PALE, -bt * 0.4);
      }

      // ================= THE ENTRY STEPS =================
      // A low broad flight. TOP = 0.34, under physics STEP_UP (0.45), so the
      // terrace is walk-on-able from the pavement and the doorway is never
      // sealed. Registered as a PLATFORM with one continuous ramp, no collider.
      if (!e.driveIn) {
        const TOP = 0.34;
        const terrD = Math.max(1.4, Math.min(2.4, ctx.d * 0.12));
        const stepD = Math.max(0.8, terrD * 0.6);
        const halfN = ef.halfN;
        const terrW = Math.min(ef.span - 0.4, e.gap + Math.max(4.0, ef.span * 0.40));
        const sw = terrW - 1.1;
        if (ef.horiz) {
          ctx.dbox(0, TOP / 2, ef.out * (halfN + terrD / 2), terrW, TOP, terrD, F.shade(PALE, 0.95));
          ctx.plat(-terrW / 2, terrW / 2, ef.out > 0 ? halfN : -(halfN + terrD),
            ef.out > 0 ? halfN + terrD : -halfN, TOP, null);
        } else {
          ctx.dbox(ef.out * (halfN + terrD / 2), TOP / 2, 0, terrD, TOP, terrW, F.shade(PALE, 0.95));
          ctx.plat(ef.out > 0 ? halfN : -(halfN + terrD), ef.out > 0 ? halfN + terrD : -halfN,
            -terrW / 2, terrW / 2, TOP, null);
        }
        const nStep = 3;
        for (let i = 0; i < nStep; i++) {
          const th = TOP * (nStep - i) / nStep;
          const off = terrD + (i + 0.5) * (stepD / nStep);
          const td = stepD / nStep + 0.02;
          if (ef.horiz) ctx.dbox(0, th / 2, ef.out * (halfN + off), sw, th, td, F.shade(PALE, 0.90 + i * 0.03));
          else ctx.dbox(ef.out * (halfN + off), th / 2, 0, td, th, sw, F.shade(PALE, 0.90 + i * 0.03));
        }
        const o0 = halfN + terrD, o1 = halfN + terrD + stepD;
        if (ef.horiz) {
          const z0 = ef.out * o0, z1 = ef.out * o1;
          ctx.plat(-sw / 2, sw / 2, Math.min(z0, z1), Math.max(z0, z1), TOP,
            { z0: ctx.oz + z1, z1: ctx.oz + z0, y0: 0, y1: TOP });
        } else {
          const x0 = ef.out * o0, x1 = ef.out * o1;
          ctx.plat(Math.min(x0, x1), Math.max(x0, x1), -sw / 2, sw / 2, TOP,
            { axis: "x", x0: ctx.ox + x1, x1: ctx.ox + x0, y0: 0, y1: TOP });
        }
        // cheek walls: the flight needs sides or it reads as a puddle of slabs
        const chD = terrD + stepD;
        for (const sg of [-1, 1]) {
          const t = sg * (sw / 2 + 0.42);
          const chH = TOP + Math.max(0.5, TOP * 2.0);
          if (ef.horiz) {
            ctx.dbox(t, chH / 2, ef.out * (halfN + chD / 2), 0.72, chH, chD, PALE);
            ctx.dbox(t, chH + 0.09, ef.out * (halfN + chD / 2), 0.94, 0.18, chD + 0.16, F.shade(PALE, 0.94));
          } else {
            ctx.dbox(ef.out * (halfN + chD / 2), chH / 2, t, chD, chH, 0.72, PALE);
            ctx.dbox(ef.out * (halfN + chD / 2), chH + 0.09, t, chD + 0.16, 0.18, 0.94, F.shade(PALE, 0.94));
          }
        }
      }

      // A carved name in the frieze, if the call site cared to give one. The
      // spec is written where the building is placed — that is the whole point.
      if (spec && spec.motto && ctx.plaque) {
        ctx.plaque(ef, yEnt + aH + frH * 0.55, Math.min(ef.span * 0.72, 16), frH * 0.66, spec.motto, PALE);
      }
    },
  });
})();
