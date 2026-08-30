/* ============================================================
   city/facades/palladian.js — "Palladian Villa": the Rotonda and its children.

   THE ONE FACADE IT MUST NOT BE MISTAKEN FOR. greekrev.js is already a temple
   front bolted to a house, so a second one would be a repaint. Every choice
   below is the Palladian answer to a Greek Revival question, and the two read
   as different buildings from 200 m:

       Greek Revival          Palladian
       grounded on a stylobate | RAISED on a rusticated basement, and the
                                 broad flight of steps up to the piano nobile
                                 is half the composition
       a gabled roof behind    | a low hipped roof with a SHALLOW DOME on a
         the pediment            drum in the middle of it — the silhouette
       trabeated: everything   | ARCHED: an arcaded loggia along each flank
         is a post and a beam    and a SERLIANA (the Venetian window: an arch
                                 between two flat-headed lights) at the centre
                                 of the piano nobile
       one block               | a block with low flanking arcades, and rigid
                                 bilateral symmetry about the entrance axis
       Doric, painted pine     | Ionic, stone and stucco

   SOLVED BACKWARDS. The entablature is subtracted from ctx.rTop first, then
   the roof springs off the cornice, then the dome sits in the roof, and the
   portico shaft gets whatever is left between the podium and the architrave.
   Size the columns first and the beam grows through the roofline; stone.js
   and greekrev.js both say so, and this is the third proof.

   THE PODIUM IS WALKABLE AND THE DOOR STAYS REACHABLE. The villa stands on a
   0.42 m plinth — one stride, under physics STEP_UP — with the portico floor
   carried out in front of it as another ctx.plat and one continuous ramped
   flight down to the pavement. A monumental stair that seals the front door
   is the known failure here, so nothing under the portico is a collider
   except the columns themselves.

   WALL MODE "frame": punched openings with a real lit room behind, which is
   what a villa's windows are. The opening rhythm is recomputed from
   buildings.js's own punched rule so the architraves, sills and consoles land
   on the actual holes.

   MESH BUDGET: the portico columns (the one place round geometry is worth
   minting — you walk between them) plus the dome and its drum. Everything
   else, including the flank loggias, the serlianas and the whole roof, is
   merged boxes.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  CBZ.registerFacade("palladian", {
    label: "Palladian Villa",
    era: "renaissance",
    structure: "masonry",
    wall: "frame",
    maxStoreys: 3,
    crownsRoof: true,
    build: function (ctx, F, spec) {
      const FH = ctx.FH, H = ctx.rTop, unit = Math.min(ctx.w, ctx.d);
      const P = F.palette(ctx, "lime", { pull: 0.80, grain: 0.06 });
      const LT = F.mix(P.light, 0xfff8ec, 0.34), DK = F.shade(P.shadow, 0.70);
      // lead, not terracotta: the lime palette's roof is a Mediterranean tile and
      // a Veneto villa is grey pantile over a grey-lead dome. Get this wrong and
      // the crown reads as a mosque.
      const LEAD = F.mix(F.shade(P.base, 0.62), 0x8e969a, 0.55);
      const e = F.entrance(ctx), ff = e.f;
      const pod = F.STEP_RISE, yB = Math.min(FH * 0.92, H * 0.34), nob = Math.min(ctx.storeys - 1, 1);

      // the shell's own punched openings (buildings.js:4144), so the dressing
      // lands on the real holes rather than beside them
      const wins = function (f) { const us = f.span - 1.4, n = Math.max(1, Math.round(us / 2.6)), c = us / n;
        return Array.from({ length: n }, (_, i) => ({ t: -us / 2 + (i + 0.5) * c, w: Math.min(2.0, c * 0.68), i: i })); };

      // ---- A. THE BASE ---------------------------------------------
      F.podium(ctx, { pal: P, top: pod, over: clamp(unit * 0.055, 0.55, 1.4), capCol: LT });
      F.rustication(ctx, { pal: P, y0: pod, y1: yB, col: P.base, dark: DK, proj: clamp(unit * 0.020, 0.16, 0.34), courseH: clamp(FH / 5.2, 0.38, 0.72) });
      F.ring(ctx, yB + 0.12, 0.24, clamp(unit * 0.020, 0.16, 0.34) + 0.16, LT, 0.4);

      // ---- B. THE STUCCO WALL AND ITS WINDOWS ----------------------
      // Smooth render above the basement, laid in segments so the punched
      // holes stay holes, plus the aedicule each opening wears. The piano
      // nobile is the storey the villa is FOR, so it alone gets consoles and
      // a cornice head; a house where every floor is important has none.
      for (const f of F.faces(ctx)) {
        const ws = wins(f), hs = ws.map((wd) => [wd.t - wd.w / 2 - 0.05, wd.t + wd.w / 2 + 0.05]);
        for (let k = 0; k < ctx.storeys; k++) {
          const a = k * FH + 1.05, b = (k + 1) * FH - 0.70, lo = Math.max(yB, k * FH);
          if (a - lo > 0.05) F.band(ctx, f, (lo + a) / 2, a - lo, 0.10, P.light, 0.2);   // spandrel
          F.band(ctx, f, (b + (k + 1) * FH) / 2, (k + 1) * FH - b, 0.10, P.light, 0.2);   // and header
          F.segBand(ctx, f, (a + b) / 2, b - a, 0.10, P.light, hs, 0.12, 0);
          for (const wd of ws) {
            if (k === 0 && !F.clearsDoor(ctx, f, wd.t, wd.w + 1.0)) continue;
            F.box(ctx, f, wd.t, a - 0.17, wd.w + 0.58, 0.22, 0.30, LT);   // sill, then the architrave jambs
            for (const sg of [-1, 1]) F.rib(ctx, f, wd.t + sg * (wd.w / 2 + 0.14), a - 0.05, b + 0.05, 0.26, 0.22, LT);
            F.box(ctx, f, wd.t, b + 0.17, wd.w + 0.60, 0.24, 0.26, LT);                       // architrave head
            if (k !== nob) continue;
            for (const sg of [-1, 1]) F.box(ctx, f, wd.t + sg * (wd.w / 2 + 0.16), b - 0.12, 0.22, 0.56, 0.36, LT);   // consoles
            F.box(ctx, f, wd.t, b + 0.40, wd.w + 1.05, 0.22, 0.44, LT);                       // and the cornice on them
          }
        }
      }

      // ---- C. THE FLANKING LOGGIAS ---------------------------------
      // Palladio's barchesse: a low arcade running the length of each flank,
      // capped with a balustrade. This is the ARCHED half of the argument
      // against greekrev.js, and it is why the villa reads wide and low.
      const sides = [2, 3].map((s) => F.face(ctx, s));
      const logTop = Math.min(yB + FH * 0.78, H - 1.2);
      for (const f of sides) {
        F.arcade(ctx, f, { pal: P, y0: pod, spring: pod + (logTop - pod) * 0.62, proj: clamp(unit * 0.075, 0.55, 1.5), top: logTop, col: LT, wallCol: P.base });
        F.band(ctx, f, logTop + 0.16, 0.28, clamp(unit * 0.075, 0.55, 1.5) + 0.20, LT, 0.3);   // its cornice
        const bn = Math.max(6, Math.round(f.span / 0.75));   // the balustrade on top of it
        for (let i = 0; i < bn; i++) F.box(ctx, f, -f.span / 2 + (i + 0.5) * (f.span / bn), logTop + 0.62, 0.20, 0.62, clamp(unit * 0.075, 0.55, 1.5) * 0.75, LT);
        F.band(ctx, f, logTop + 1.02, 0.20, clamp(unit * 0.075, 0.55, 1.5) + 0.14, LT, 0.3);
      }

      // ---- D. THE SERLIANA -----------------------------------------
      // An arched centre light between two flat-headed ones, divided by paired
      // colonnettes carrying a little entablature. Centred on the piano nobile
      // of each flank, which is where a villa puts its best room.
      for (const f of sides) {
        const sy = nob * FH + 0.55, sh = Math.min(FH * 0.64, H - sy - 1.30);
        const cw = clamp(f.span * 0.16, 1.0, 2.4), lw = cw * 0.52, rise = Math.min(cw * 0.5, H - 0.80 - sy - sh);
        if (sh < 1.0 || rise < 0.3 || f.span < 6) continue;
        F.box(ctx, f, 0, sy + sh * 0.5 + 0.15, cw + lw * 2 + 1.6, sh + rise + 1.0, 0.16, P.light, -0.02);
        F.box(ctx, f, 0, sy + sh * 0.5, cw, sh, 0.10, DK, 0.06);   F.arch(ctx, f, 0, sy + sh, cw, rise, 0.16, 0.28, LT, "round");   // the arched centre light
        for (const sg of [-1, 1]) {
          F.box(ctx, f, sg * (cw / 2 + 0.30 + lw / 2), sy + sh * 0.38, lw, sh * 0.76, 0.10, DK, 0.06);   F.box(ctx, f, sg * (cw / 2 + 0.30 + lw / 2), sy + sh * 0.80, lw + 0.95, 0.24, 0.34, LT);
          F.rib(ctx, f, sg * (cw / 2 + 0.24), sy - 0.10, sy + sh + 0.05, 0.28, 0.30, LT);   F.rib(ctx, f, sg * (cw / 2 + 0.36 + lw), sy - 0.10, sy + sh + 0.05, 0.28, 0.30, LT);   // paired colonnettes
        }
        F.box(ctx, f, 0, sy - 0.20, cw + lw * 2 + 1.5, 0.24, 0.36, LT);                         // the common sill
      }

      // ---- E. THE TEMPLE FRONT -------------------------------------
      // Ionic, freestanding, standing on the podium and solved back from the
      // cornice. The colonnade widens its own centre intercolumniation until
      // the doorway fits, so no column ever has to be dropped in front of it.
      /* THE PORTICO IS NARROWER THAN THE HOUSE. F.colonnade spreads its outer
         columns to the face's own margins, which on a 15 m villa puts the
         temple front across the entire elevation and leaves no wall beside it
         — and a Palladian portico that touches both corners reads as a
         warehouse canopy. Hand it a NARROWED view of the same face (same s,
         same halfN, 64% of the span) and every number it solves comes out
         over the centre instead. */
      const pf = { s: ff.s, horiz: ff.horiz, out: ff.out, halfN: ff.halfN, span: ff.span * 0.64 };
      const co = F.colonnade(ctx, { pal: P, face: pf, order: "ionic", base: pod,
        clear: H + 0.95, entH: clamp(FH * 0.55, 0.75, 1.55), col: LT, trim: P.light });
      const pw = Math.abs(co.t.length ? co.t[co.t.length - 1] : pf.span * 0.4) * 2 + co.r * 4;
      const pedH = clamp(pw * 0.20, 1.0, 3.4), pdep = co.depth + 0.34, tw = clamp(pw * 0.10, 0.35, 0.85);
      /* A RAKING CORNICE WITH A SHADOWED FIELD BEHIND IT, not a stack of solid
         slabs: draw the triangle as solid courses and the tympanum you put
         behind them is invisible, which is exactly how the first render came
         out. The dark field is one course-wide box per step, set 0.3 m back. */
      for (let k = 0; k < 7; k++) {
        const hw = (pw + 0.9) * 0.5 * (1 - ((k + 0.5) / 7) * 0.94), cy = co.entTop + (k + 0.5) * (pedH / 7);
        F.box(ctx, ff, 0, cy, hw * 2, pedH / 7 + 0.06, pdep - 0.30, DK);   // the shadowed field
        for (const sg of [-1, 1]) F.box(ctx, ff, sg * hw, cy, tw, pedH / 7 + 0.06, pdep, LT);   // the raking cornice
      }
      F.box(ctx, ff, 0, co.entTop + 0.15, pw + 1.1, 0.30, pdep + 0.12, LT);   F.box(ctx, ff, 0, co.entTop + pedH + 0.14, tw * 1.3, 0.38, pdep + 0.04, LT);   // bed cornice, apex
      // the portico floor, walkable, and one continuous flight down to the kerb
      const dOut = ff.halfN + co.depth + 0.35, pwk = pw + 0.6;
      F.obox(ctx, ff, 0, pod / 2, pwk, pod, co.depth + 0.35, dOut, F.shade(LT, 0.96), true);
      const n0 = ff.out * ff.halfN, n1 = ff.out * dOut, nA = Math.min(n0, n1), nB2 = Math.max(n0, n1);
      if (ff.horiz) ctx.plat(-pwk / 2, pwk / 2, nA, nB2, pod); else ctx.plat(nA, nB2, -pwk / 2, pwk / 2, pod);
      F.steps(ctx, { face: ff, pal: P, top: pod, width: Math.min(pw, ff.span * 0.82), out: co.depth + 0.35,
        depth: clamp(unit * 0.14, 1.0, 2.6), treads: 5, col: LT, capCol: P.base });

      // ---- F. THE HIPPED ROOF AND THE DOME -------------------------
      F.cornice(ctx, { pal: P, y: H + 0.55, kind: "dentil", h: 0.42, col: LT, depth: clamp(unit * 0.05, 0.30, 0.85) });
      const rf = F.hipRoof(ctx, { pal: P, y0: H + 0.95, h: clamp(unit * 0.14, 0.8, 1.9), ribs: false, col: LEAD });
      F.domeOnDrum(ctx, { pal: P, y: rf.top - 0.35, r: clamp(unit * 0.26, 1.1, 4.2), drumH: clamp(FH * 0.52, 1.0, 2.2),
        semis: false, turrets: false, col: LT, shellCol: LEAD, accent: F.shade(LT, 0.90), trim: LT });
    },
  });
})();
