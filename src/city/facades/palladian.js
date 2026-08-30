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
      const e = F.entrance(ctx), ff = e.f;
      const pod = F.STEP_RISE, yB = Math.min(FH * 0.92, H * 0.34);   // the rusticated basement

      // the shell's own punched openings (buildings.js:4144), so the dressing
      // lands on the real holes rather than beside them
      const wins = function (f) {
        const us = f.span - 1.4, n = Math.max(1, Math.round(us / 2.6)), cell = us / n, out = [];
        for (let i = 0; i < n; i++) out.push({ t: -us / 2 + (i + 0.5) * cell, w: Math.min(2.0, cell * 0.68), i: i });
        return out;
      };

      // ---- A. THE BASE ---------------------------------------------
      F.podium(ctx, { pal: P, top: pod, over: clamp(unit * 0.055, 0.55, 1.4), capCol: LT });
      F.rustication(ctx, { pal: P, y0: pod, y1: yB, col: P.base, dark: DK,
        proj: clamp(unit * 0.020, 0.16, 0.34), courseH: clamp(FH / 5.2, 0.38, 0.72) });
      F.band && F.ring(ctx, yB + 0.12, 0.24, clamp(unit * 0.020, 0.16, 0.34) + 0.16, LT, 0.4);

      // ---- B. THE STUCCO WALL AND ITS WINDOWS ----------------------
      // Smooth render above the basement, laid in segments so the punched
      // holes stay holes, plus the aedicule each opening wears. The piano
      // nobile is the storey the villa is FOR, so it alone gets consoles and
      // a cornice head; a house where every floor is important has none.
      const nob = Math.min(ctx.storeys - 1, 1);
      for (const f of F.faces(ctx)) {
        const ws = wins(f), hs = ws.map((wd) => [wd.t - wd.w / 2 - 0.05, wd.t + wd.w / 2 + 0.05]);
        for (let k = 0; k < ctx.storeys; k++) {
          const a = k * FH + 1.05, b = (k + 1) * FH - 0.70, lo = Math.max(yB, k * FH);
          if (a - lo > 0.05) F.band(ctx, f, (lo + a) / 2, a - lo, 0.10, P.light, 0.2);
          F.band(ctx, f, (b + (k + 1) * FH) / 2, (k + 1) * FH - b, 0.10, P.light, 0.2);
          F.segBand(ctx, f, (a + b) / 2, b - a, 0.10, P.light, hs, 0.12, 0);
          for (const wd of ws) {
            if (k === 0 && !F.clearsDoor(ctx, f, wd.t, wd.w + 1.0)) continue;
            F.box(ctx, f, wd.t, a - 0.17, wd.w + 0.58, 0.22, 0.30, LT);                       // sill
            for (const sg of [-1, 1]) F.rib(ctx, f, wd.t + sg * (wd.w / 2 + 0.14), a - 0.05, b + 0.05, 0.26, 0.22, LT);
            F.box(ctx, f, wd.t, b + 0.17, wd.w + 0.60, 0.24, 0.26, LT);                       // architrave head
            if (k !== nob) continue;
            for (const sg of [-1, 1]) F.box(ctx, f, wd.t + sg * (wd.w / 2 + 0.16), b - 0.12, 0.22, 0.56, 0.36, LT);
            F.box(ctx, f, wd.t, b + 0.40, wd.w + 1.05, 0.22, 0.44, LT);                       // cornice on consoles
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
        F.arcade(ctx, f, { pal: P, y0: pod, spring: pod + (logTop - pod) * 0.62,
          proj: clamp(unit * 0.075, 0.55, 1.5), top: logTop, col: LT, wallCol: P.base });
        F.band(ctx, f, logTop + 0.16, 0.28, clamp(unit * 0.075, 0.55, 1.5) + 0.20, LT, 0.3);
        const bn = Math.max(6, Math.round(f.span / 0.75));
        for (let i = 0; i < bn; i++) {                                                        // the balustrade on top
          F.box(ctx, f, -f.span / 2 + (i + 0.5) * (f.span / bn), logTop + 0.62, 0.20, 0.62,
            clamp(unit * 0.075, 0.55, 1.5) * 0.75, LT);
        }
        F.band(ctx, f, logTop + 1.02, 0.20, clamp(unit * 0.075, 0.55, 1.5) + 0.14, LT, 0.3);
      }

      // ---- D. THE SERLIANA -----------------------------------------
      // An arched centre light between two flat-headed ones, divided by paired
      // colonnettes carrying a little entablature. Centred on the piano nobile
      // of each flank, which is where a villa puts its best room.
      for (const f of sides) {
        const sy = nob * FH + 0.95, sh = Math.min(FH * 0.66, H - sy - 1.0);
        const cw = clamp(f.span * 0.16, 1.0, 2.4), lw = cw * 0.52;
        if (sh < 1.2 || f.span < 6) continue;
        F.box(ctx, f, 0, sy + sh / 2, cw + lw * 2 + 1.5, sh + 1.2, 0.16, P.light, -0.02);      // the panel it sits in
        F.box(ctx, f, 0, sy + sh * 0.55, cw, sh * 1.1, 0.10, DK, 0.06);
        F.arch(ctx, f, f.s * 0 + 0, sy + sh * 1.10, cw, cw * 0.5, 0.16, 0.26, LT, "round");
        for (const sg of [-1, 1]) {
          F.box(ctx, f, sg * (cw / 2 + 0.30 + lw / 2), sy + sh * 0.40, lw, sh * 0.80, 0.10, DK, 0.06);
          F.rib(ctx, f, sg * (cw / 2 + 0.24), sy - 0.10, sy + sh * 0.85, 0.28, 0.30, LT);      // colonnette
          F.rib(ctx, f, sg * (cw / 2 + 0.36 + lw), sy - 0.10, sy + sh * 0.85, 0.28, 0.30, LT);
          F.box(ctx, f, sg * (cw / 2 + 0.30 + lw / 2), sy + sh * 0.86, lw + 0.9, 0.24, 0.34, LT);
        }
        F.box(ctx, f, 0, sy - 0.20, cw + lw * 2 + 1.4, 0.24, 0.36, LT);                        // the common sill
      }

      // ---- E. THE TEMPLE FRONT -------------------------------------
      // Ionic, freestanding, standing on the podium and solved back from the
      // cornice. The colonnade widens its own centre intercolumniation until
      // the doorway fits, so no column ever has to be dropped in front of it.
      const co = F.colonnade(ctx, { pal: P, face: ff, order: "ionic", base: pod,
        clear: H - 0.15, entH: clamp(FH * 0.55, 0.75, 1.55), col: LT, trim: P.light });
      const pw = Math.abs(co.t.length ? co.t[co.t.length - 1] : ff.span * 0.4) * 2 + co.r * 4;
      const pedH = clamp(pw * 0.145, 0.8, 2.4), pdep = co.depth + 0.34;
      for (let k = 0; k < 6; k++) {                                                            // the pediment
        const u = (k + 0.5) / 6;
        F.box(ctx, ff, 0, co.entTop + (k + 0.5) * (pedH / 6), (pw + 0.9) * (1 - u * 0.94),
          pedH / 6 + 0.05, pdep, k % 2 ? F.shade(LT, 0.94) : LT);
      }
      F.box(ctx, ff, 0, co.entTop + pedH * 0.34, pw * 0.72, pedH * 0.60, pdep - 0.18, F.shade(P.shadow, 0.86));
      // the portico floor, walkable, and one continuous flight down to the kerb
      const dOut = ff.halfN + co.depth + 0.35, pwk = pw + 0.6;
      F.obox(ctx, ff, 0, pod / 2, pwk, pod, co.depth + 0.35, dOut, F.shade(LT, 0.96), true);
      const n0 = ff.out * ff.halfN, n1 = ff.out * dOut;
      if (ff.horiz) ctx.plat(-pwk / 2, pwk / 2, Math.min(n0, n1), Math.max(n0, n1), pod);
      else ctx.plat(Math.min(n0, n1), Math.max(n0, n1), -pwk / 2, pwk / 2, pod);
      F.steps(ctx, { face: ff, pal: P, top: pod, width: Math.min(pw, ff.span * 0.82),
        out: co.depth + 0.35, depth: clamp(unit * 0.14, 1.0, 2.6), treads: 5, col: LT, capCol: P.base });

      // ---- F. THE HIPPED ROOF AND THE DOME -------------------------
      F.cornice(ctx, { pal: P, y: H + 0.55, kind: "dentil", h: 0.42, col: LT,
        depth: clamp(unit * 0.05, 0.30, 0.85) });
      const rf = F.hipRoof(ctx, { pal: P, y0: H + 0.95, h: clamp(unit * 0.19, 0.9, 2.4), ribs: true });
      F.domeOnDrum(ctx, { pal: P, y: rf.top - 0.35, r: clamp(unit * 0.26, 1.1, 4.2),
        drumH: clamp(FH * 0.52, 1.0, 2.2), semis: false, turrets: false, col: LT, shellCol: P.roof });
    },
  });
})();
