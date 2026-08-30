/* ============================================================
   city/facades/baroque.js — "Baroque Church Front": Il Gesù, Santa Susanna.

   THE READ. A Counter-Reformation church is a NAVE WITH A BILLBOARD BOLTED TO
   ITS WEST END. The body behind is an ordinary aisled hall; the front is a
   two-storey stone screen, wider and taller than the thing it fronts, built to
   be seen from one point on one piazza. So this file spends almost everything
   on ONE face and gives the other three a plain pilastered nave wall — which
   is exactly what the real buildings do, and it is why the silhouette reads:
   from 200 m you see a big blank box with a tall stepped screen on its front.

   THE THREE THINGS THAT MAKE IT BAROQUE AND NOT CLASSICAL.

     1. THE VOLUTES. The lower storey is wide (the aisles) and the upper storey
        is narrow (the nave clerestory), and the gap between them is stitched
        by an enormous S-curved SCROLL WALL each side. Nothing else in the kit
        makes that shape. It is drawn as stepped columns of wall whose top
        edge follows a cyma — 0.5 + 0.5cos(pi u) — flat at both ends and
        steepest in the middle. Get that curve wrong (a straight ramp, or a
        quarter circle) and the whole front collapses into "a temple with
        buttresses"; the double curvature IS the style.
     2. THE WALL SWELLS. A Renaissance front is a flat sheet with ornament on
        it. A Baroque front is a wall under pressure, thickening toward the
        door: here the plane steps forward in THREE layers — outer wall, then
        the central pavilion, then the doubled pilasters flanking the entrance
        standing proudest of all — and the entablature above it breaks forward
        over the centre (the ressaut) instead of running straight through.
     3. THE BROKEN PEDIMENT. A segmental arc over the door with its crown
        MISSING and a cartouche pushed up through the gap. A pediment that
        does not close is the period's whole argument about rules.

   Statue niches with figures in them fill the flanking bays on both storeys —
   a Baroque front is populated, and four saints cost twelve merged boxes.

   WALL MODE "own": a church has no office glazing and its windows are few,
   tall and round-headed. The shell hands over solid wall (and carries the
   collider that the glass pane used to) and F.openingGrid cuts the nave
   lights into the three flanks only; the front screen is deliberately blind
   except for the one great window over the door.

   SOLVED BACKWARDS. The apex of the crowning pediment is fixed first as a
   fraction of ctx.rTop, then the pediment, the upper entablature and the
   upper storey are subtracted from it, and the lower order gets what is left.
   Size the lower order first and the screen grows a second storey through
   its own skyline.

   SOLIDITY: the lower pilasters, the pavilion mass and the door jambs are what
   a player walks into and go out solid. Volutes, entablatures, statues,
   pediments and the whole upper screen are up in the air and stay free.
   COST: zero minted meshes.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  CBZ.registerFacade("baroque", {
    label: "Baroque Church Front",
    era: "renaissance",
    structure: "masonry",
    wall: "own",
    crownsRoof: true,
    build: function (ctx, F, spec) {
      const FH = ctx.FH, H = ctx.rTop, unit = Math.min(ctx.w, ctx.d);
      const P = F.palette(ctx, "lime", { pull: 0.84, grain: 0.07 });
      const LT = F.mix(P.light, 0xfffaea, 0.30), DK = F.shade(P.shadow, 0.66);
      const e = F.entrance(ctx), ff = e.f, span = ff.span, half = span / 2;

      // ---- SOLVED BACKWARDS FROM THE APEX -------------------------
      const TOP = H + clamp(H * 0.30, 2.4, 6.5);
      const pedH = clamp(span * 0.12, 0.9, 2.6), ent2 = clamp(FH * 0.42, 0.6, 1.3);
      const ent1 = clamp(FH * 0.55, 0.8, 1.7), y1 = clamp(H * 0.56, FH * 1.25, H - 1.4);
      const y2 = y1 + ent1;                                     // the upper storey's floor
      const hUp = Math.max(1.4, TOP - pedH - ent2 - y2);
      const wUp = span * 0.56, marg = clamp(span * 0.055, 0.5, 1.4);
      const tIn = clamp(e.gap / 2 + 1.1, 1.6, span * 0.20), tOut = half - marg;
      const tMid = (tIn + tOut) / 2, PW = clamp(span * 0.055, 0.45, 1.05);
      const P0 = clamp(unit * 0.020, 0.18, 0.38);               // the outermost wall layer

      // an entablature, and a stepped pediment. Both are wanted four times.
      const entab = function (y, h, wid, dep) {
        F.box(ctx, ff, 0, y + h * 0.18, wid, h * 0.36, dep, LT);
        F.box(ctx, ff, 0, y + h * 0.55, wid - 0.18, h * 0.38, dep - 0.07, F.shade(LT, 0.90));
        F.box(ctx, ff, 0, y + h * 0.88, wid + 0.55, h * 0.30, dep + 0.34, LT);
      };
      const pediment = function (y, wid, h, dep) {
        for (let k = 0; k < 5; k++) {
          const u = (k + 0.5) / 5;
          F.box(ctx, ff, 0, y + (k + 0.5) * (h / 5), wid * (1 - u * 0.94), h / 5 + 0.04, dep, k % 2 ? F.shade(LT, 0.94) : LT);
        }
      };

      // ---- A. THE NAVE BEHIND -------------------------------------
      const flanks = [0, 1, 2, 3].filter((s) => s !== ctx.doorSide).map((s) => F.face(ctx, s));
      F.pierBay(ctx, { pal: P, faces: flanks, y1: H - 0.85, head: null, spandrel: false, per: FH * 1.5 });
      F.openingGrid(ctx, { pal: P, faces: flanks, shape: "arch", hFrac: 0.46, wFrac: 0.26, sillFrac: 0.40, hi: 5 });
      F.cornice(ctx, { pal: P, faces: flanks, y: H + 0.30, kind: "bracket", col: LT });
      F.parapetWalk(ctx, { pal: P, h: clamp(FH * 0.22, 0.4, 0.8), col: P.base, capCol: LT });

      // ---- B. THE FRONT, IN THREE LAYERS OF DEPTH -----------------
      F.sBox(ctx, ff, 0, y2 / 2, span + 0.2, y2, P0 * 0.7, P.base);                       // outer wall
      F.sBox(ctx, ff, 0, y2 / 2, (tMid + PW) * 2, y2, P0 * 1.5, P.light);                 // the pavilion
      for (const sg of [-1, 1]) for (const q of [[tOut, P0 * 1.0], [tMid, P0 * 1.7], [tIn, P0 * 2.6], [tIn + PW * 1.16, P0 * 2.3]]) {
        F.sRib(ctx, ff, sg * q[0], 0, y1, PW, q[1], LT);                                   // giant pilaster
        F.box(ctx, ff, sg * q[0], y1 - 0.22, PW * 1.28, 0.30, q[1] + 0.12, LT);            // its capital
        F.box(ctx, ff, sg * q[0], 0.26, PW * 1.20, 0.52, q[1] + 0.10, LT);                 // and its base
      }
      entab(y1, ent1, span + 0.3, P0 * 1.3);
      entab(y1, ent1, (tMid + PW) * 2 + 0.4, P0 * 2.4);                                    // the ressaut

      // ---- C. NICHES, AND THE SAINTS IN THEM ----------------------
      for (const sg of [-1, 1]) for (const q of [[(tIn + PW * 1.16 + tMid) / 2, y1 * 0.34, y1 * 0.44, P0 * 1.5],
        [(tMid + tOut) / 2, y1 * 0.34, y1 * 0.40, P0 * 1.1], [wUp * 0.29, y2 + hUp * 0.24, hUp * 0.44, P0 * 1.1]]) {
        const t = sg * q[0], y0 = q[1], nh = q[2], np = q[3], nw = Math.min(nh * 0.44, PW * 1.5);
        F.box(ctx, ff, t, y0 + nh / 2, nw, nh, 0.10, DK, np - 0.10);                        // the recess
        F.arch(ctx, ff, t, y0 + nh, nw, nw * 0.52, 0.14, np + 0.06, LT, "round");
        for (const s2 of [-1, 1]) F.rib(ctx, ff, t + s2 * (nw / 2 + 0.15), y0 - 0.06, y0 + nh + 0.06, 0.26, np + 0.10, LT);
        F.box(ctx, ff, t, y0 - 0.15, nw + 0.66, 0.20, np + 0.18, LT);                       // the shelf
        F.box(ctx, ff, t, y0 + nh * 0.32, nw * 0.44, nh * 0.58, np - 0.02, P.trim);         // the figure
        F.box(ctx, ff, t, y0 + nh * 0.68, nw * 0.30, nh * 0.16, np, P.trim);
      }

      // ---- D. THE DOOR, UNDER A BROKEN SEGMENTAL PEDIMENT ---------
      const dy = clamp(e.head + 0.6, 2.6, y1 - 1.6), dw = e.gap + 1.4, dp = P0 * 2.6 + 0.16;
      F.box(ctx, ff, 0, dy * 0.5, dw + 0.3, dy, dp - 0.12, DK);
      for (const sg of [-1, 1]) F.sRib(ctx, ff, sg * (dw / 2 + 0.45), 0, dy + 0.1, 0.88, dp, LT);
      F.box(ctx, ff, 0, dy + 0.28, dw + 2.1, 0.46, dp + 0.14, LT);                          // the lintel
      const Wp = (dw + 2.1) * 0.5, Rp = Math.min(1.15, Wp * 0.38);
      for (let k = 0; k < 6; k++) {
        const u = 0.32 + ((k + 0.5) / 6) * 0.68;                                            // BROKEN: no crown
        const yy = dy + 0.60 + Rp * Math.sqrt(Math.max(0, 1 - u * u));
        for (const sg of [-1, 1]) {
          F.box(ctx, ff, sg * Wp * u, yy, Wp * 0.16, 0.32, dp + 0.20, LT);
          F.box(ctx, ff, sg * Wp * u, yy + 0.24, Wp * 0.17, 0.18, dp + 0.28, F.shade(LT, 0.90));
        }
      }
      for (let k = 0; k < 3; k++) {                                                          // the cartouche in the gap
        F.box(ctx, ff, 0, dy + 0.95 + k * 0.30, Wp * (0.44 - k * 0.10), 0.34, dp + 0.26 + k * 0.06, k === 1 ? P.accent : LT);
      }

      // ---- E. THE VOLUTES -----------------------------------------
      const vH = hUp * 0.66, vL = tOut + PW - wUp / 2, vN = 13, vw = vL / vN + 0.05;
      for (const sg of [-1, 1]) {
        for (let i = 0; i < vN; i++) {
          const u = (i + 0.5) / vN, hh = vH * (0.5 + 0.5 * Math.cos(Math.PI * u));
          const t = sg * (wUp / 2 + u * vL);
          F.box(ctx, ff, t, y2 + hh / 2, vw, hh, P0 * 1.1, P.base);
          F.box(ctx, ff, t, y2 + hh, vw, 0.28, P0 * 1.5, LT);                               // the moulded edge
        }
        for (let k = 0; k < 3; k++) {                                                        // the eye of the scroll
          F.box(ctx, ff, sg * (wUp / 2 + vL * 0.90), y2 + 0.62, 0.95 - k * 0.28, 0.95 - k * 0.28, P0 * (1.5 + k * 0.34), k === 1 ? DK : LT);
        }
        F.box(ctx, ff, sg * (wUp / 2 - 0.20), y2 + vH * 0.5, 0.42, vH, P0 * 1.9, LT);        // the stop against the screen
      }

      // ---- F. THE UPPER STOREY AND THE CROWN ----------------------
      F.box(ctx, ff, 0, y2 + hUp / 2, wUp, hUp, P0 * 1.0, P.base);
      for (const sg of [-1, 1]) for (const q of [[wUp * 0.44, P0 * 1.4], [wUp * 0.15, P0 * 2.0]]) {
        F.rib(ctx, ff, sg * q[0], y2, y2 + hUp - 0.24, PW * 0.86, q[1], LT);
        F.box(ctx, ff, sg * q[0], y2 + hUp - 0.20, PW * 1.10, 0.26, q[1] + 0.12, LT);
      }
      const gw = Math.min(wUp * 0.20, hUp * 0.42);                                           // the great window
      F.box(ctx, ff, 0, y2 + hUp * 0.44, gw, hUp * 0.50, 0.12, DK, P0 * 1.0 - 0.12);
      F.arch(ctx, ff, 0, y2 + hUp * 0.69, gw, gw * 0.5, 0.16, P0 * 1.6, LT, "round");
      entab(y2 + hUp, ent2, wUp + 0.3, P0 * 1.6);
      pediment(y2 + hUp + ent2, wUp * 0.52, pedH, P0 * 2.0);
      F.box(ctx, ff, 0, y2 + hUp + ent2 + pedH + 0.55, 0.34, 1.10, P0 * 2.0, LT);            // apex finial
      for (const sg of [-1, 1]) {                                                            // flame finials on the volutes
        F.box(ctx, ff, sg * (wUp / 2 + vL * 0.90), y2 + 1.35, 0.52, 0.90, P0 * 2.0, LT);
        F.box(ctx, ff, sg * (wUp / 2 + vL * 0.90), y2 + 2.05, 0.26, 0.60, P0 * 1.8, LT);
      }
    },
  });
})();
