/* ============================================================
   city/facades/faceted.js — "Faceted Prism", the sliced crystal tower.

   THE READ. Bank of China, 1990. The building is not a box with a pattern on
   it: it is a PRISM THAT HAS BEEN CUT. The plan is divided into quadrants,
   each quadrant rises to a DIFFERENT height, and the transition between one
   quadrant and the next is a single long diagonal running across many storeys.
   From a kilometre away you read four triangles terminating at four levels and
   nothing else in a skyline makes that shape. Everything in this file exists
   to serve that one idea, and the discipline is FEW BIG CUTS: four quadrant
   heights, three diagonals, two masses above the roof. A texture of small
   facets would be aliasing, not architecture.

   HOW THE CUT IS BUILT (and why it is built twice)
   ------------------------------------------------
   The host shell is a solid box to ctx.rTop, so a quadrant that terminates
   BELOW the roofline cannot be carved out of it. That half of the cut is
   therefore CLADDING: below the diagonal the wall is lit blue-silver glass,
   above it the wall is a dark recessive plate, and the boundary carries a
   bright structural rib. Read from the street the mass reads as sliced. The
   quadrants that terminate ABOVE the roofline are real volumes - stepped
   prisms that shrink toward their own outer corner, so each one comes to a
   knife edge instead of a shelf. Those are the silhouette, and the tallest
   one carries the mast.

   WHY EACH ELEMENT EXISTS
     QUADRANT HEIGHTS  Four multipliers of rTop, rotated by ctx.hash so two
                  towers on one street are cut differently. Two land under the
                  roof (cladding diagonals), two above it (real crystal tops).
     EDGE MEMBER  Every diagonal gets a continuous bright rib traced by a
                  stepped run of boxes sized so the steps overlap. Without it
                  a stepped slope reads as staircase noise; with it, it reads
                  as a designed cut. It is the single most important element.
     CROSS-BRACING  A handful of giant X frames on the shaft, each spanning
                  most of a face and eight-ish storeys, meeting at expressed
                  nodes. Structure echoing the facet geometry, not a pattern -
                  there are two per face, not forty.
     GLASS SKIN   Banded ONCE PER STOREY as two boxes per face: a vision band
                  and a spandrel under it, each trimmed to the tangent
                  interval that survives the diagonal. Two boxes a storey is
                  what lets a 40-storey tower stay near the bare shell's cost
                  while still having a floor rhythm. Slim mullions run up to
                  the cut, giving verticality for free.
     GRANITE PODIUM  The bottom fifteen metres are a different building: a
                  broad battered granite base whose courses step back as they
                  rise, so the prism lands on a plinth instead of meeting the
                  pavement at a hairline. The entrance is a deep recess under
                  a bright lintel, and the coursing declines to be drawn
                  across it rather than covering it.
     TERRACES     Low stepped slabs each side of the door, registered as walk
                  platforms under STEP_UP, standing in for the water gardens
                  the reference wraps its base in.
     ROOF RIDGES  Bright ribs along the two quadrant division lines on the
                  roof deck, so even the flat quarters admit where the cuts are.

   Every dimension comes from ctx.w / ctx.d / ctx.storeys / ctx.FH / ctx.rTop
   or a face span. Variation is ctx.hash only. Everything is ctx.dbox (merged,
   free) except the mast and its beacon - three real meshes in total.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  // A band on one face interrupted by tangent "holes" (the doorway). You do
  // not cut a hole in merged axis-aligned boxes; you decline to draw over it.
  function runBand(ctx, F, f, cy, h, proj, col, holes, over) {
    const L = -f.span / 2 - (over == null ? 0.1 : over);
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

  CBZ.registerFacade("faceted", {
    label: "Faceted Prism",
    crownsRoof: true,
    minStoreys: 18,
    build: function (ctx, F, spec) {
      const FH = ctx.FH, H = ctx.rTop, ST = ctx.storeys;
      const smallest = Math.min(ctx.w, ctx.d);
      const e = F.entrance(ctx);
      const faces = F.faces(ctx);

      // ---------------- palette ----------------
      // Anchored to real mid values, NOT derived by lightening the host: this
      // renderer clips above about 0x99 and a facade whose whole subject is a
      // bright rib against dark glass cannot afford a washed-out top end. The
      // host colour is admitted at 12 percent so a street of these is not one
      // paint chip, and no further.
      const tint = function (base) { return F.mix(base, ctx.color | 0, 0.12); };
      const GLASS = tint(0x46617d);            // cool blue-silver vision glass
      const GLASS_L = tint(0x5d7d9a);          // the lit band under each floor line
      const SPAND = tint(0x30435a);            // spandrel: the floor edge
      const VOIDC = tint(0x1c2a38);            // the cut-away plate above a diagonal
      const RIB = tint(0x93989f);              // bright silver structural member
      const RIB_D = F.shade(RIB, 0.62);        // its shaded return
      const MULL = tint(0x757c85);             // slim mullions
      const GRAN = tint(0x6b6864);             // grey granite podium
      const GRAN_L = tint(0x8c887f);
      const GRAN_D = F.shade(GRAN, 0.55);

      // ================================================================
      //  0. THE CUT — four quadrant heights
      // ================================================================
      // The whole grammar is these four numbers. Two below rTop so the shell
      // carries visible diagonals, two above it so the silhouette is sliced.
      const MULT = [0.60, 0.80, 1.05, 1.24];
      const rot = Math.min(3, (ctx.hash(0x5c11) * 4) | 0);
      const CY = [[-1, -1], [1, -1], [1, 1], [-1, 1]];   // quadrant cycle
      const QH = [];
      for (let i = 0; i < 4; i++) {
        QH.push({ sx: CY[i][0], sz: CY[i][1], h: H * MULT[(i + rot) % 4] });
      }
      const quadH = function (sx, sz) {
        for (let i = 0; i < 4; i++) if (QH[i].sx === sx && QH[i].sz === sz) return QH[i].h;
        return H;
      };
      // each face's diagonal: the terminal height at its two ends
      const endsFor = function (f) {
        if (f.horiz) return [quadH(-1, f.out), quadH(1, f.out)];
        return [quadH(f.out, -1), quadH(f.out, 1)];
      };

      // ================================================================
      //  A STEPPED DIAGONAL — the only way to draw a slope in merged boxes
      // ================================================================
      // Step count is solved so each step covers about `pitch` metres on the
      // longer axis; each box is then sized to cover its own run in BOTH axes
      // plus an overlap, so the run reads as one continuous member instead of
      // as a flight of shelves.
      function diag(f, t0, y0, t1, y1, wid, proj, col, inset) {
        const dt = t1 - t0, dy = y1 - y0;
        const pitch = Math.max(0.9, wid * 1.1);
        const n = Math.max(2, Math.min(48, Math.ceil(Math.max(Math.abs(dt), Math.abs(dy)) / pitch)));
        const st = Math.abs(dt) / n, sy = Math.abs(dy) / n;
        for (let i = 0; i < n; i++) {
          const u = (i + 0.5) / n;
          F.box(ctx, f, t0 + dt * u, y0 + dy * u,
            st + wid * 0.9, sy + wid * 0.9, proj, col, inset);
        }
      }

      // ================================================================
      //  1. THE PODIUM — a different building, the bottom ~15 m
      // ================================================================
      const podStoreys = Math.max(2, Math.min(5, Math.round(15 / FH)));
      const yPod = Math.min(H * 0.20, podStoreys * FH);
      const PMAX = Math.max(0.9, Math.min(2.2, smallest * 0.07));   // batter at grade
      const nCourse = Math.max(4, Math.min(9, Math.round(yPod / (FH * 0.55))));
      const cH = yPod / nCourse;
      const doorHole = [-(e.gap / 2 + 1.6), e.gap / 2 + 1.6];
      for (let fi = 0; fi < faces.length; fi++) {
        const f = faces[fi];
        for (let c = 0; c < nCourse; c++) {
          const cy = c * cH + cH / 2;
          // BATTERED: each course stands less proud than the one below, so the
          // podium slopes back into the shaft instead of being a bolted-on box.
          const pr = PMAX * (1 - 0.72 * (c / nCourse));
          const holes = (f.s === ctx.doorSide && cy - cH < e.head) ? [doorHole] : [];
          runBand(ctx, F, f, cy, cH * 0.96, pr, c % 2 ? GRAN : F.shade(GRAN, 1.1), holes, 0.12);
          // the joint line: the only thing that makes stone read as coursed
          if (c > 0) runBand(ctx, F, f, c * cH, 0.10, pr + 0.03, GRAN_D, holes, 0.12);
        }
        // the coping the prism lands on, and a shadow reveal under it
        F.band(ctx, f, yPod + 0.22, 0.44, PMAX * 0.40, GRAN_L, 0.5);
        F.band(ctx, f, yPod - 0.16, 0.22, PMAX * 0.34, GRAN_D, 0.4);
      }
      // THE ENTRANCE: a deep recess, a bright lintel, granite jambs. Nothing
      // is drawn inside the tangent gap or below the head.
      {
        const df = e.f;
        const openW = e.gap + 3.2;
        const headY = Math.min(yPod - 0.9, e.head + 1.6);
        if (headY > 2.2) {
          F.box(ctx, df, 0, headY / 2, openW, headY, 0.10, VOIDC);         // the void
          F.box(ctx, df, 0, headY * 0.5, openW * 0.86, headY * 0.78, 0.05, F.shade(VOIDC, 1.5));
          F.box(ctx, df, 0, headY + 0.45, openW + 2.4, 0.9, PMAX * 0.9, RIB);   // lintel
          F.box(ctx, df, 0, headY + 0.98, openW + 2.8, 0.22, PMAX * 1.0, RIB_D);
          for (const sg of [-1, 1]) {
            F.rib(ctx, df, sg * (openW / 2 + 0.75), 0, headY + 0.9, 1.5, PMAX * 0.9, GRAN_L);
          }
        }
        // the terraces: two low slabs each side of the door, walk-on-able.
        const TOP = 0.34;
        const tD = Math.max(1.6, Math.min(3.2, ctx.d * 0.10));
        const halfN = df.halfN;
        const tW = Math.max(3.0, (df.span - openW) * 0.34);
        for (const sg of [-1, 1]) {
          const t = sg * (openW / 2 + 1.6 + tW / 2);
          if (Math.abs(t) + tW / 2 > df.span / 2 + 1.5) continue;
          if (df.horiz) {
            ctx.dbox(t, TOP / 2, df.out * (halfN + tD / 2), tW, TOP, tD, GRAN_L);
            ctx.dbox(t, TOP + 0.16, df.out * (halfN + tD / 2), tW - 0.9, 0.24, tD - 0.9, F.shade(GRAN, 0.8));
            ctx.plat(t - tW / 2, t + tW / 2,
              df.out > 0 ? halfN : -(halfN + tD), df.out > 0 ? halfN + tD : -halfN, TOP, null);
          } else {
            ctx.dbox(df.out * (halfN + tD / 2), TOP / 2, t, tD, TOP, tW, GRAN_L);
            ctx.dbox(df.out * (halfN + tD / 2), TOP + 0.16, t, tD - 0.9, 0.24, tW - 0.9, F.shade(GRAN, 0.8));
            ctx.plat(df.out > 0 ? halfN : -(halfN + tD), df.out > 0 ? halfN + tD : -halfN,
              t - tW / 2, t + tW / 2, TOP, null);
          }
        }
      }

      // ================================================================
      //  2. THE SHAFT — glass banded per storey, trimmed by the diagonal
      // ================================================================
      // Two boxes per storey per face. The diagonal is a straight line in
      // (t, y), so the wall that survives at any height is ONE contiguous
      // tangent interval, which is why this costs nothing.
      const k0 = Math.max(1, Math.floor(yPod / FH));
      for (let fi = 0; fi < faces.length; fi++) {
        const f = faces[fi];
        const ends = endsFor(f);
        const hL = ends[0], hR = ends[1];
        const half = f.span / 2;
        // interval of t where the quadrant mass still exists at height y
        const alive = function (y) {
          if (Math.abs(hR - hL) < 0.01) return (hL > y) ? [-half, half] : null;
          let ts = ((y - hL) / (hR - hL)) * f.span - half;
          ts = Math.max(-half, Math.min(half, ts));
          const a = (hR > hL) ? ts : -half;
          const b = (hR > hL) ? half : ts;
          return (b - a > 0.6) ? [a, b] : null;
        };
        for (let k = k0; k < ST; k++) {
          const y0 = k * FH, ym = y0 + FH * 0.5;
          const iv = alive(ym);
          if (iv) {
            const c = (iv[0] + iv[1]) / 2, wid = iv[1] - iv[0];
            // spandrel (the floor edge) then the vision band above it, with a
            // lit line right under the floor so the storey rhythm reads.
            F.box(ctx, f, c, y0 + FH * 0.15, wid, FH * 0.30, 0.30, SPAND);
            F.box(ctx, f, c, y0 + FH * 0.63, wid, FH * 0.60, 0.16, GLASS);
            F.box(ctx, f, c, y0 + FH * 0.91, wid, FH * 0.10, 0.22, GLASS_L);
          }
          // the CUT-AWAY plate: everything the diagonal removed, dark and flat
          const rest = iv ? null : [-half, half];
          if (rest || (iv && (iv[0] > -half + 0.3 || iv[1] < half - 0.3))) {
            const a = iv ? (iv[0] > -half + 0.3 ? -half : iv[1]) : -half;
            const b = iv ? (iv[0] > -half + 0.3 ? iv[0] : half) : half;
            if (b - a > 0.4) F.box(ctx, f, (a + b) / 2, y0 + FH * 0.5, b - a, FH, 0.08, VOIDC);
          }
        }
        // MULLIONS: slim verticals from the podium coping up to the diagonal.
        const nm = F.bayCount(f, 3.2, 4, 10);
        for (const t of F.bayLines(f, nm, Math.max(0.6, f.span * 0.04))) {
          const yTop = Math.min(H, Math.abs(hR - hL) < 0.01 ? hL
            : hL + ((t + half) / f.span) * (hR - hL)) - 0.4;
          F.rib(ctx, f, t, yPod + 0.5, yTop, 0.30, 0.42, MULL);
        }

        // ---- THE EDGE MEMBER: the bright rib tracing the cut ----
        // Only where the diagonal is actually on the shell.
        const yA = Math.min(hL, H), yB = Math.min(hR, H);
        if (Math.abs(yA - yB) > FH * 0.8) {
          const RW = Math.max(0.75, Math.min(1.5, smallest * 0.045));
          diag(f, -half, yA, half, yB, RW, 0.62, RIB);
          diag(f, -half, yA - RW * 1.15, half, yB - RW * 1.15, RW * 0.42, 0.46, RIB_D);
        }

        // ================================================================
        //  3. CROSS-BRACING — a handful of giant X frames on the shaft
        // ================================================================
        // Confined to the part of the face that survives all the way across,
        // so a brace never floats in the cut-away plate.
        const bTop = Math.min(H * 0.94, Math.min(hL, hR) - FH * 1.4);
        const bBot = yPod + FH * 0.6;
        if (bTop - bBot > FH * 5) {
          const nX = Math.max(1, Math.min(2, Math.round((bTop - bBot) / (FH * 12))));
          const xh = (bTop - bBot) / nX;
          const BW = Math.max(0.55, Math.min(1.00, smallest * 0.028));
          const m = Math.max(0.5, f.span * 0.05);
          for (let i = 0; i < nX; i++) {
            const ya = bBot + i * xh, yb = ya + xh;
            diag(f, -half + m, ya, half - m, yb, BW, 0.52, RIB);
            diag(f, -half + m, yb, half - m, ya, BW, 0.52, RIB);
            // NODES: where the members meet is where a braced tube is welded,
            // and expressing them is what stops the X reading as painted-on.
            F.box(ctx, f, 0, (ya + yb) / 2, BW * 3.0, BW * 3.0, 0.66, RIB);
            for (const sg of [-1, 1]) {
              F.box(ctx, f, sg * (half - m), ya, BW * 2.4, BW * 2.4, 0.62, RIB);
              F.box(ctx, f, sg * (half - m), yb, BW * 2.4, BW * 2.4, 0.62, RIB);
            }
          }
        }
      }

      // ================================================================
      //  4. THE ROOF — the cuts admitted on the deck
      // ================================================================
      // Bright ribs along the two quadrant division lines, plus a low parapet
      // on the quarters that terminate at or below the roofline, each at its
      // own height so the roofline itself is stepped rather than flat.
      const RR = Math.max(0.6, smallest * 0.035);
      ctx.dbox(0, H + RR * 0.5, 0, RR, RR, ctx.d, RIB);
      ctx.dbox(0, H + RR * 0.5, 0, ctx.w, RR, RR, RIB);
      for (let i = 0; i < 4; i++) {
        const q = QH[i];
        if (q.h > H + 0.5) continue;
        const ph = Math.max(0.5, FH * (0.22 + 0.16 * (q.h / H)));
        const qw = ctx.w / 2, qd = ctx.d / 2;
        ctx.dbox(q.sx * qw / 2, H + ph / 2, q.sz * (qd - 0.35), qw, ph, 0.7, GRAN_L);
        ctx.dbox(q.sx * (qw - 0.35), H + ph / 2, q.sz * qd / 2, 0.7, ph, qd, GRAN_L);
        ctx.dbox(q.sx * qw / 2, H + ph + 0.08, q.sz * (qd - 0.35), qw + 0.2, 0.16, 0.9, RIB);
        ctx.dbox(q.sx * (qw - 0.35), H + ph + 0.08, q.sz * qd / 2, 0.9, 0.16, qd + 0.2, RIB);
      }

      // ================================================================
      //  5. THE CRYSTAL TOPS — the quadrants that outlive the roof
      // ================================================================
      // Each is a stepped prism whose plan shrinks toward its own OUTER
      // corner, so it terminates in a knife edge leaning away from the core
      // rather than in a flat shelf. This is the silhouette, and it is why
      // this facade claims crownsRoof.
      let tallest = null;
      for (let i = 0; i < 4; i++) {
        const q = QH[i];
        if (q.h <= H + 0.5) continue;
        if (!tallest || q.h > tallest.h) tallest = q;
        const rise = q.h - H;
        // Step count is solved on the LATERAL run as well as the vertical one:
        // a crystal that loses a metre and a half of plan per course reads as
        // a flight of stairs however fine its height steps are. The 14-storey
        // render proved it - the tops were a staircase until this line existed.
        const n = Math.max(12, Math.min(60, Math.round(Math.max(
          rise / (FH * 0.42), (Math.max(ctx.w, ctx.d) / 2) * 0.88 / 0.38))));
        const sh = rise / n;
        const cx = q.sx * ctx.w / 2, cz = q.sz * ctx.d / 2;   // the fixed outer corner
        for (let k = 0; k < n; k++) {
          const u = (k + 0.5) / n, shr = 1 - 0.94 * u;
          const qw = (ctx.w / 2) * shr, qd = (ctx.d / 2) * shr;
          const px = cx - q.sx * qw / 2, pz = cz - q.sz * qd / 2;
          const y = H + k * sh;
          // the glazed body of the crystal, dark-to-light as it climbs
          ctx.dbox(px, y + sh / 2, pz, qw, sh, qd, F.mix(GLASS, GLASS_L, u));
          // and the two sloping arrises, bright — the same edge member as the
          // shell diagonals, continued past the roof so the cut is one line.
          // The arris is sized to BRIDGE its own step: each course loses
          // latW/latD of plan, and a rib narrower than that leaves the shelf
          // exposed, which is what turns a slope into a flight of stairs.
          const ew = Math.max(0.5, RR * 1.1);
          const latW = (ctx.w / 2) * 0.88 / n, latD = (ctx.d / 2) * 0.88 / n;
          ctx.dbox(px - q.sx * (qw / 2 - (ew + latW) / 2), y + sh / 2, pz, ew + latW, sh + 0.08, qd, RIB);
          ctx.dbox(px, y + sh / 2, pz - q.sz * (qd / 2 - (ew + latD) / 2), qw, sh + 0.08, ew + latD, RIB);
          // a spandrel line every couple of steps keeps a floor scale on it
          if (k % 2 === 1) ctx.dbox(px, y + 0.06, pz, qw + 0.10, 0.16, qd + 0.10, SPAND);
        }
        // the cap: a small bright block sealing the knife edge
        const tw = (ctx.w / 2) * 0.08, td = (ctx.d / 2) * 0.08;
        ctx.dbox(cx - q.sx * tw / 2, q.h + 0.25, cz - q.sz * td / 2, tw + 0.6, 0.5, td + 0.6, RIB);
      }

      // THE MAST on the tallest quadrant. Three real meshes, and the only ones
      // this facade mints: a tower this size is identified by its needle.
      if (tallest) {
        const tw = (ctx.w / 2) * 0.08, td = (ctx.d / 2) * 0.08;
        const mx = tallest.sx * (ctx.w / 2 - tw / 2), mz = tallest.sz * (ctx.d / 2 - td / 2);
        const mastH = Math.max(FH * 2.0, Math.min(H * 0.09, FH * 4));
        const mr = Math.max(0.20, smallest * 0.014);
        ctx.dbox(mx, tallest.h + 1.1, mz, mr * 5.5, 1.4, mr * 5.5, RIB);
        ctx.column(mx, tallest.h + 1.6, mz, mr, mastH * 0.62, RIB, 8);
        ctx.column(mx, tallest.h + 1.6 + mastH * 0.62, mz, mr * 0.42, mastH * 0.38, RIB, 6);
        ctx.lamp(mx, tallest.h + 1.6 + mastH + 0.4, mz, mr * 1.5, 0xff5544);
      }
    },
  });
})();
