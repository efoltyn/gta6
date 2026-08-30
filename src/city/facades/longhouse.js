/* ============================================================
   city/facades/longhouse.js — "Neolithic Longhouse": Danubian / LBK.

   THE ROOF IS THE BUILDING. That is the whole grammar. A longhouse is a
   thatch mountain standing on the ground with a strip of daub wall showing
   underneath it, and the failure mode — the one thing this file spends its
   budget avoiding — is a SHED: a normal wall with a normal pitched roof on
   top. The two numbers that decide it are both here at the top of build():

     eave  as low as the door head allows, so the wall barely shows.
     RH    tall enough that the two slopes actually MEET in a ridge instead
           of leaving a flat deck. F.thatch narrows at h/0.9 per metre of
           run, so the roof height is solved BACKWARDS from the span it has
           to close — the same move colonnade makes for an entablature. On
           the preview house that is ~8.5 m of thatch over 2.5 m of wall:
           roughly 75% of the silhouette is straw, which is the read.

   THE RIDGE RUNS PERPENDICULAR TO THE DOOR FACE, always. A longhouse has one
   door and it is in a gable end; the shell decides which face the door is on
   and a facade cannot move it, so the ROOF turns instead. That also keeps the
   sweeping eaves — the deep low overhangs — on the two blank flanks where
   nothing has to get past them, and it is why no thatch course ever hangs
   into the doorway.

   CROSSED RIDGE POLES at both apexes are the other half of the silhouette:
   the paired rafters carried past the ridge and lashed, which every
   reconstruction has and nothing else in the kit does. They are drawn as
   stepped runs of small boxes, because a rotated box is a lie you can see
   from any other angle.

   WALL MODE "own": no windows at all. A longhouse has one opening.

   SOLIDITY: the gable posts, the porch posts and the stone footing are the
   load-bearing mass and go through F.boxShaft(solid)/F.sBox. The thatch, the
   ridge poles and the wall plate are up in the air and stay free.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  CBZ.registerFacade("longhouse", {
    label: "Neolithic Longhouse",
    era: "neolithic",
    // city/collapse.js MATERIALS — split-oak posts and wattle infill. It
    // folds and burns; there is no masonry in it anywhere.
    structure: "timber",
    wall: "own",
    crownsRoof: true,
    maxStoreys: 2,
    build: function (ctx, F, spec) {
      spec = spec || {};
      const rTop = ctx.rTop, FH = ctx.FH, unit = Math.min(ctx.w, ctx.d);
      const h = function (s) { return ctx.hash(s); };
      const P = F.palette(ctx, "thatch", { pull: 0.92, grain: 0.30 });
      const T = F.palette(ctx, "timber", { pull: 0.92, grain: 0.26 });
      const DAUB = F.mix(P.light, 0xcdbb98, 0.55);

      // ---- A. THE ROOF, SOLVED FIRST ------------------------------
      const along = ctx.w >= ctx.d ? "x" : "z";         // the ridge is the LONG axis
      const over = clamp(unit * 0.20, 1.1, 2.8);
      const eave = Math.max(F.DOOR_H + 0.60, rTop * 0.30);

      /* A1. THE SPROCKETED EAVE. The lower run of a thatch roof is far
         steeper than the upper — that is what lets the eave reach the ground
         without the ridge ending up in orbit — and here it has a second job:
         it must SWALLOW THE SHELL'S OWN ROOF DECK, which sits at rTop. A roof
         that had already narrowed past the footprint by that height leaves
         the shell's slab and its rail poking out through the straw, which is
         exactly how the first version of this failed. So this run loses only
         a little overhang and holds full width until it is clear of rTop. */
      const nS = Math.max(4, Math.round((rTop + 0.3 - eave) / 0.42));
      const skirt = rTop + 0.30 - eave;
      for (let k = 0; k < nS; k++) {
        const u = (k + 0.5) / nS, y = eave + skirt * u, o2 = over * (1 - u * 0.45);
        const sw = ctx.w + ((along === "z") ? o2 : over) * 2;
        const sd = ctx.d + ((along === "z") ? over : o2) * 2;
        ctx.dbox(0, y, 0, sw, skirt / nS + 0.06, sd, P.course(k + 12));
        if (k === 0) {                                  // the thick shaggy cut lip
          ctx.dbox(0, eave + skirt / nS * 0.30, 0, sw + 0.18, skirt / nS * 1.5, sd + 0.18, F.shade(P.roof, 0.88));
          ctx.dbox(0, eave - 0.12, 0, sw + 0.04, 0.26, sd + 0.04, F.shade(P.roof, 0.46));
        }
      }
      // A2. the upper slopes, which close to a real ridge: F.thatch narrows at
      // h/0.9 per metre of run, so the height is solved BACKWARDS from the
      // span it has to shut — the move colonnade makes for an entablature.
      const halfRun = (along === "z" ? ctx.w : ctx.d) / 2 + over * 0.55;
      const RH = Math.max(halfRun * 0.96, unit * 0.55);
      F.thatch(ctx, { pal: P, y0: rTop + 0.20, h: RH, over: over * 0.55,
        gable: true, axis: along, courses: 20 });
      const ridgeY = rTop + 0.20 + RH;

      // ---- B. THE STRIP OF WALL THAT STILL SHOWS ------------------
      // Split planks on a stone footing, dark, in permanent eave shadow. It is
      // deliberately NOT a panelled daub wall: bright infill between dark
      // studs reads as a shopfront, and this building has no windows at all.
      const foot = clamp(FH * 0.14, 0.32, 0.55);
      const wallTop = eave - 0.12;
      for (const f of F.faces(ctx)) {
        F.sBox(ctx, f, 0, foot / 2, f.span + 0.60, foot, 0.38, T.shadow, 0);
        F.band(ctx, f, (foot + wallTop) / 2, wallTop - foot, 0.20, F.shade(DAUB, 0.72), 0.24, 0);
        const n = Math.max(4, Math.round(f.span / clamp(unit * 0.10, 0.42, 0.80)));
        for (let i = 0; i <= n; i++) {
          const t = -f.span / 2 + i * (f.span / n);
          F.rib(ctx, f, t, foot, wallTop + 0.10, (f.span / n) * 0.62, 0.29,
            F.shade(T.course(i + f.s * 5), 0.86));
        }
        // the wall plate the rafter feet land on
        F.band(ctx, f, wallTop + 0.14, 0.24, 0.40, T.dark, 0.30, 0);
      }

      // ---- C. THE GABLE FRAME -------------------------------------
      // Heavy hewn posts standing PROUD OF THE GABLE PLANE — not tucked under
      // the overhang, where they come out looking like columns embedded in
      // straw — each rising to the underside of the slope above it.
      const pr = clamp(unit * 0.058, 0.22, 0.48);
      const hRun = (along === "z" ? ctx.w : ctx.d) / 2 + over;
      for (const f of F.faces(ctx)) {
        if ((along === "z") !== f.horiz) continue;      // gable ends only
        for (let i = -1; i <= 1; i++) {
          const t = i * f.span * 0.32, dn = f.halfN + over + pr * 0.8;
          if (!F.clearsDoor(ctx, f, t, pr * 4)) continue;   // never in the doorway
          const topY = eave + (ridgeY - eave) * Math.pow(1 - Math.abs(t) / hRun, 0.85) * 0.92;
          F.boxShaft(ctx, f.horiz ? t : f.out * dn, 0, f.horiz ? f.out * dn : t,
            topY, pr, T.base, F.mix(T.base, 0xffffff, 0.14), true);
        }
      }

      // ---- D. THE CROSSED RIDGE POLES -----------------------------
      // Paired rafters carried past the apex and lashed. Stepped boxes: a
      // rotated box is a lie you can see from any other angle.
      const halfLen = (along === "z" ? ctx.d : ctx.w) / 2 + over * 0.55;
      const pl = clamp(unit * 0.34, 1.3, 3.4);
      const put = function (a, y, s, c, n) {           // a = across the gable
        if (along === "z") ctx.dbox(a, y, n, s, s * 0.9, s, c); else ctx.dbox(n, y, a, s, s * 0.9, s, c);
      };
      for (const sg of [-1, 1]) {
        const n = sg * (halfLen - pl * 0.12);
        for (const sx of [-1, 1]) for (let k = 0; k < 8; k++) {
          const u = (k + 0.5) / 8;
          put(sx * pl * (0.80 - 1.14 * u), ridgeY + pl * (-0.62 + 1.40 * u),
            pl * 0.155 * (1 - u * 0.25), T.course(k + 3), n);
        }
        put(0, ridgeY + pl * 0.20, pl * 0.34, T.dark, n);       // the lashing
      }

      // ---- E. THE ONE DOOR ----------------------------------------
      const e = F.entrance(ctx), fe = e.f;
      const dp = clamp(unit * 0.16, 1.0, 2.2), dh = F.DOOR_H + 0.85;
      for (const sg of [-1, 1]) {
        const t = sg * (e.gap / 2 + pr * 1.5), dn = fe.halfN + dp;
        F.boxShaft(ctx, fe.horiz ? t : fe.out * dn, 0, fe.horiz ? fe.out * dn : t,
          dh, pr * 1.15, T.light, F.mix(T.light, 0xffffff, 0.18), true);
      }
      F.obox(ctx, fe, 0, dh + 0.20, e.gap + pr * 5.0, 0.36, dp + pr * 2.6, fe.halfN + dp + pr * 1.3, T.dark);
      // a little thatch hood, so the entrance breaks the eave and you can see
      // from 30 m which end of a hundred feet of straw the door is at
      for (let k = 0; k < 4; k++) {
        const u = (k + 0.5) / 4;
        F.obox(ctx, fe, 0, dh + 0.44 + u * 0.66, (e.gap + pr * 6) * (1 - u * 0.22), 0.24,
          (dp + pr * 3.4) * (1 - u * 0.42), fe.halfN + dp + pr * 1.9 - u * 0.25, P.course(k + 7));
      }
      // the daub cheeks of the doorway: laid across it so the kit's carve
      // turns them into a real reveal in a real wall
      F.box(ctx, fe, 0, F.DOOR_H / 2 + 0.08, e.gap * 0.92, F.DOOR_H + 0.16, 0.30, F.shade(DAUB, 0.66));
    },
  });
})();
