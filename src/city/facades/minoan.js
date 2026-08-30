/* ============================================================
   city/facades/minoan.js — "Minoan Palace": Knossos, c. 1700 BC.

   THE SIGNATURE IS AN INVERTED COLUMN. Every other column in this kit — and
   in every other kit — is wider at the bottom than at the top, because that
   is what stone does. The Minoan column is a whole cypress trunk stood on its
   head so it would not re-root, so it is WIDER AT THE TOP: a red shaft
   swelling as it rises into a black cushion capital and a black square
   abacus, on a black base. F.colonnade cannot do it (it solves a classical
   order from a slenderness ratio and tapers the right way up), so the shaft
   is written locally out of two crossed boxes per lift — an octagonal section
   that reads round at any distance a player stands and costs no mesh. If the
   columns ever read as ordinary columns, this file has failed.

   WHERE THE COLUMNS ARE: the LIGHT-WELL. A Minoan palace is not a facade with
   a portico, it is a warren lit from vertical shafts, and the one a visitor
   sees is the colonnaded well over the entrance — two tiers of columns
   carrying a timber architrave and a balcony, with the rooms opening straight
   onto it. That is why this grammar declares wall:"frame" and not "own": the
   openings behind the balcony are the shell's REAL punched holes with the
   lit room behind them, and the balcony fronts them instead of covering
   them. Every band this file lays is parked in the solid spandrel or header
   zone between the floors, never across the glass.

   THE OTHER THREE READS
     ASHLAR AND TIMBER LACING. A gypsum orthostat course at the foot (kept
       below the window sill line on purpose), then a timber lacing beam at
       every floor line with a pale fillet over it. Knossos is a timber-framed
       building with stone panels, and the lacing is what says so.
     RED / BLACK / WHITE BANDING. The strongest horizontals on the elevation,
       alternating red and black at the floor lines against white plaster.
     HORNS OF CONSECRATION. Pairs of splayed horns standing on the parapet all
       round: the bull's-horn shrine emblem, and the only thing here that
       breaks the roofline. From 200 m this is a banded block with a balcony
       and a row of horns, which nothing else in the kit is.

   SOLIDITY: the column shafts and bases and the plinth are mass a player
   walks into, so they go through F.solid / F.waterTable. The bands, the
   architraves, the balustrade and the horns are moulding or are up in the
   air, and stay free.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  CBZ.registerFacade("minoan", {
    label: "Minoan Palace",
    era: "bronze",
    // city/collapse.js MATERIALS — rubble and ashlar laced with timber.
    structure: "masonry",
    wall: "frame",
    maxStoreys: 8,
    build: function (ctx, F, spec) {
      const FH = ctx.FH, H = ctx.rTop, unit = Math.min(ctx.w, ctx.d);
      const P = F.palette(ctx, "lime", { pull: 0.80 });
      const RED = F.mix(P.base, 0xa63523, 0.80), BLK = F.mix(P.dark, 0x171310, 0.84);
      const TMB = F.mix(P.trim, 0x5a3a24, 0.64);

      // ---- A. PLINTH, ORTHOSTATS, LACING, BANDING -----------------
      // Every course here is parked BELOW the sill (1.05 m) or inside the
      // header band under the floor above, so nothing is ever laid across one
      // of the shell's real punched openings.
      const wt = F.waterTable(ctx, { pal: P, h: clamp(FH * 0.24, 0.42, 0.9), col: P.dark });
      F.rustication(ctx, { pal: P, y0: wt.top, y1: Math.max(wt.top + 0.3, 1.0),
        courseH: 0.38, proj: 0.17, col: P.light, dark: P.shadow });
      for (let k = 0; k < ctx.storeys; k++) {
        const y = k * FH;
        F.ring(ctx, y + 0.58, 0.30, 0.22, TMB, 0.3, 0);              // the timber lacing beam
        F.ring(ctx, y + 0.86, 0.12, 0.15, P.light, 0.3, 0);
        F.ring(ctx, y + FH - 0.44, 0.34, 0.25, k % 2 ? RED : BLK, 0.3, 0);
        F.ring(ctx, y + FH - 0.12, 0.14, 0.31, P.light, 0.34, 0);
      }
      F.corners(ctx, H / 2, H, clamp(unit * 0.05, 0.5, 1.1), 0.24, P.light);   // ashlar quoins
      // THE MASONRY PIERS. The shell punches its holes on a fixed rhythm
      // (buildings.js: 0.7 m corner margin, one bay per ~2.6 m). Left
      // undressed, a wall of 2 m holes reads as an office glazing band, so
      // these ribs land exactly on the shell's OWN piers and the elevation
      // comes back as stone panels between real openings.
      for (const f of F.faces(ctx)) {
        const us = f.span - 1.4, nw = Math.max(1, Math.round(us / 2.6)), cell = us / nw;
        const pw2 = Math.max(0.34, cell - Math.min(2.0, cell * 0.68) - 0.12);
        for (let i = 0; i <= nw; i++) F.sRib(ctx, f, -us / 2 + i * cell, 0, H - 0.15, pw2, 0.15, P.light);
      }

      // ---- B. THE DOWNWARD-TAPERING COLUMN ------------------------
      // Wider at the head than the foot — the opposite of every other column
      // in the kit, and the whole reason this grammar is recognisable.
      const e = F.entrance(ctx), f0 = e.f;
      const dep = clamp(unit * 0.13, 1.3, 2.6);                      // how far the well stands out
      const r0 = clamp(unit * 0.019, 0.15, 0.30), r1 = r0 * 2.05;    // foot, then head
      const cq = dep - r1 * 1.25;                                    // the shaft axis, off the wall
      const taper = function (t, y0, top, sc) {       // y0 → top is the WHOLE post
        const ra = r0 * sc, rb = r1 * sc, sy = y0 + 0.22, sh = top - sy - rb * 1.15, lh = sh / 6;
        F.obox(ctx, f0, t, y0 + 0.11, rb * 2.3, 0.22, rb * 2.3, f0.halfN + cq + rb * 1.15, BLK, true);
        for (let k = 0; k < 6; k++) {                  // the shaft SWELLING as it rises
          const r = ra + (rb - ra) * ((k + 0.5) / 6), y = sy + lh * (k + 0.5);
          F.obox(ctx, f0, t, y, r * 1.98, lh + 0.02, r * 1.10, f0.halfN + cq + r * 0.55, RED, true);
          F.obox(ctx, f0, t, y, r * 1.10, lh + 0.02, r * 1.98, f0.halfN + cq + r * 0.99, RED, true);
        }
        F.obox(ctx, f0, t, top - rb * 0.80, rb * 2.7, rb * 0.64, rb * 2.7, f0.halfN + cq + rb * 1.35, BLK);
        F.obox(ctx, f0, t, top - rb * 0.30, rb * 3.2, rb * 0.36, rb * 3.2, f0.halfN + cq + rb * 1.60, BLK);
      };
      // the central intercolumniation is WIDENED to clear the door, which is
      // the same answer F.colonnade gives and the reason no post is dropped
      const half = clamp(f0.span * 0.30, 2.8, 6.4), inner = e.gap / 2 + r1 + 0.55;
      const m = Math.max(1, Math.round((half - inner) / clamp(unit * 0.15, 1.8, 3.2)) + 1);
      const st = m > 1 ? (half - inner) / (m - 1) : 0, ts = [];
      for (let i = 0; i < m; i++) { ts.push(-(inner + st * i)); ts.push(inner + st * i); }

      // ---- C. THE LIGHT-WELL AND ITS BALCONY ----------------------
      const dY = Math.max(FH, e.head + 0.40);            // the deck, clear of the door head
      for (const t of ts) taper(t, 0, dY - 0.50, 1);
      F.obox(ctx, f0, 0, dY - 0.30, half * 2 + r1 * 3, 0.36, dep + 0.18, f0.halfN + dep + 0.18, TMB);
      F.obox(ctx, f0, 0, dY - 0.05, half * 2 + r1 * 3.6, 0.22, dep + 0.36, f0.halfN + dep + 0.36, P.light);
      ctx.plat(f0.horiz ? -half : f0.out * f0.halfN, f0.horiz ? half : f0.out * (f0.halfN + dep),
        f0.horiz ? Math.min(f0.out * f0.halfN, f0.out * (f0.halfN + dep)) : -half,
        f0.horiz ? Math.max(f0.out * f0.halfN, f0.out * (f0.halfN + dep)) : half, dY);
      // THE UPPER TIER only when there is room for a real one: a squat
      // half-storey of posts behind the rail reads as a mistake, and a low
      // house wants the balcony and its parapet alone.
      const uH = Math.min(FH * 0.95, H - dY - 0.8);
      if (uH > 1.9) {
        for (const t of ts) taper(t, dY + 0.10, dY + uH - 0.48, 0.90);
        F.obox(ctx, f0, 0, dY + uH - 0.30, half * 2 + r1 * 3, 0.34, dep + 0.18, f0.halfN + dep + 0.18, TMB);
      }
      F.obox(ctx, f0, 0, dY + 0.60, half * 2, 0.80, 0.26, f0.halfN + dep + 0.30, RED);   // balustrade
      F.obox(ctx, f0, 0, dY + 1.06, half * 2 + 0.34, 0.18, 0.42, f0.halfN + dep + 0.38, P.light);

      // ---- D. THE PARAPET AND THE HORNS OF CONSECRATION -----------
      const pw = F.parapetWalk(ctx, { pal: P, h: clamp(FH * 0.30, 0.5, 1.1), col: P.light, capCol: RED });
      const hh = clamp(unit * 0.075, 0.55, 1.15);
      for (const f of F.faces(ctx)) {
        const n = Math.max(2, Math.round(f.span / clamp(unit * 0.42, 3.0, 6.0)));
        for (let i = 0; i < n; i++) {
          const t = -f.span / 2 + (i + 0.5) * (f.span / n);
          F.box(ctx, f, t, pw.parTop + hh * 0.22, hh * 2.0, hh * 0.44, 0.44, P.light, -0.32);
          for (const sg of [-1, 1]) for (let k = 0; k < 4; k++) {
            const u = (k + 0.5) / 4;      // the horns, splaying out as they rise
            F.box(ctx, f, t + sg * (hh * 0.60 + u * hh * 0.38), pw.parTop + hh * (0.44 + u * 0.95),
              hh * (0.52 - u * 0.30), hh * 0.30, 0.42, P.light, -0.32);
          }
        }
      }
    },
  });
})();
