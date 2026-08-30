/* ============================================================
   city/facades/stupa.js — "Stupa & Pyatthat": the Theravada masonry temple.
   Bagan, Sagaing, Bangkok. Whitewashed brick and gold leaf.

   THE TWO SHAPES THIS FILE EXISTS TO DRAW, and neither is a pagoda.
   pagoda.js owns the East Asian answer to the same brief and it is the
   opposite building in every structural respect: a TIMBER FRAME under wide
   horizontal eaves that reach out past the wall and curl up at the corners.
   Here nothing reaches out and nothing curls. This is a solid MASONRY MASS
   that narrows as it rises and ends in a needle — the whole silhouette is
   vertical, and any horizontal overhang wider than its own moulding is this
   file failing and becoming that one.

     BELL       the anda. Round, springing off moulded bands, SWELLING to a
                touch over its base radius a quarter of the way up and only
                then falling away — the ogee section of a Burmese zedi. A
                plain hemisphere reads Indian; a cone reads European. It is
                stacked octagonal courses (three boxes each, free) because a
                real curved surface is a mesh and a mesh is a budget.
     TERRACES   three receding square platforms under it, each with a moulded
                lip and a miniature stupa pinning every corner. Without them
                the bell sits on the roof like a dropped egg: the terraces are
                what make it a temple-mountain rather than an ornament.
     HTI        the crown umbrella: a mast carrying MANY diminishing gilt
                rings, ending in a fine point. It is the single most
                recognisable Burmese feature and it is SINGULAR — one per
                building, at the centre, whatever the size. Rings multiply
                with height; htis never do.
     PYATTHAT   the tiered spired roof over the entrance hall. Each tier is a
                thin roof plate, a gilt lip, four corner flame licks, and then
                a SHORT VERTICAL BAND before the next — that band is what
                separates a pyatthat from a pagoda's stacked eaves, which have
                no vertical between them and project three times as far.
     PEDIMENT   flame-shaped hoods over the openings, with licks curling off
                both sides. Multiplies with the bays, on every storey.
     PILASTER   solid whitewashed piers on the bay lines, ground to cornice:
                the mass you actually bump into, and the vertical rhythm the
                flame pediments hang between.

   SOLID: podium, wall pilasters, opening jambs, porch posts. Everything from
   the roofline up is out of reach and free. Meshes: at most 2, for the tip of
   the hti — the bell and every ring are boxes.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;
  const cl = function (v, a, b) { return v < a ? a : (v > b ? b : v); };

  CBZ.registerFacade("stupa", {
    label: "Stupa & Pyatthat",
    era: "southasia",
    // WHAT IT IS MADE OF (city/collapse.js MATERIALS) — solid fired brick
    // under plaster: it crumbles, it does not fold.
    structure: "masonry",
    // A temple wall is solid brick with one doorway and blind arched niches.
    // An office glazing band on a zedi is the failure this flag fixes.
    wall: "own",
    crownsRoof: true,
    // A bell needs a broad base. Above six storeys the terraces are a hat on
    // a tower and the hti is a lightning rod.
    maxStoreys: 6,
    build: function (ctx, F) {
      const w = ctx.w, d = ctx.d, u = Math.min(w, d), rTop = ctx.rTop, FH = ctx.FH;
      const ST = Math.max(1, ctx.storeys | 0);
      // Every load-bearing mass here (podium, pilasters, opening jambs, porch
      // posts) is emitted through F.solid / F.sRib, which resolve ctx.sbox
      // once for us — nothing in this file may call ctx.sbox directly.
      const P = F.palette(ctx, "whitewash");
      const gold = F.mix(0xd8ab3e, P.base, 0.12), goldD = F.shade(gold, 0.80);
      // one call for a round course: three concentric boxes read as a circle
      // from every angle a player stands, and cost no mesh.
      const ring = function (y0, h, r, c) { F.boxShaft(ctx, 0, y0, 0, h, r, c); };

      // ---- 1. THE PLINTH -----------------------------------------------
      const pod = F.podium(ctx, { pal: P, over: cl(u * 0.10, 0.8, 2.4) });
      F.waterTable(ctx, { y: pod.top, pal: P });

      // ---- 2. THE WALL: plaster courses, pilasters, flame-hooded openings
      // Under wall:"own" the shell hands us bare host colour; unclad, a white
      // temple comes out office grey.
      const mg = cl(u * 0.14, 1.0, 2.4), og = { shape: "lancet", per: 4.6, lo: 2, hi: 5, margin: mg,
        wFrac: 0.30, hFrac: 0.44, sillFrac: 0.34, blind: 0.22, proj: 0.26, jambProj: 0.34, pal: P, trim: gold };
      for (const f of F.faces(ctx)) {
        for (let k = 0; k < ST; k++) F.band(ctx, f, k * FH + FH * 0.5, FH, 0.16, P.course(k * 3 + f.s), 0.3);
        for (const t of F.bayLines(f, F.bayCount(f, 4.6, 2, 5), mg))
          F.sRib(ctx, f, t, pod.top, rTop - 0.1, cl(u * 0.055, 0.38, 0.8), 0.34, P.light);
      }
      F.openingGrid(ctx, og);
      for (const f of F.faces(ctx)) {
        for (const b of F.bays(f, F.bayCount(f, 4.6, 2, 5), mg)) {
          const ww = cl(b.w * 0.30, 0.28, 1.6), wh = cl(FH * 0.44, 0.5, FH * 0.7);
          if (!F.clearsDoor(ctx, f, b.t, ww + 1.6)) continue;
          for (let k = 0; k < ST; k++) {
            // THE FLAME PEDIMENT: a stepped hood over the opening head with
            // licks curling off both sides. Flat-topped is a Roman aedicule.
            const y = k * FH + FH * 0.34 + wh + ww * 0.92;
            for (let j = 0; j < 4; j++) F.box(ctx, f, b.t, y + j * ww * 0.34, (ww + 0.8) * (1 - j * 0.22), ww * 0.34, 0.30 + j * 0.04, j % 2 ? gold : P.light);
            for (const sg of [-1, 1]) for (let j = 0; j < 3; j++)
              F.box(ctx, f, b.t + sg * ww * (0.62 + j * 0.15), y + ww * (0.18 + j * 0.40), ww * 0.18, ww * (0.52 - j * 0.11), 0.36, gold);
          }
        }
      }
      F.cornice(ctx, { y: rTop, kind: "dentil", pal: P, col: P.light, dark: gold });

      // ---- 3. THE TERRACES ---------------------------------------------
      // Square, receding, each with a moulded lip and a stupika on every
      // corner. Three of them whatever the plan: the count is liturgical, the
      // SIZE is the host's.
      let ty = rTop + 0.05, tw = Math.min(w, d) * 0.92;
      ctx.dbox(0, rTop + 0.14, 0, w * 0.99, 0.28, d * 0.99, P.dark);   // the paved roof platform this all stands on
      for (let i = 0; i < 3; i++) {
        const th = cl(u * 0.06, 0.40, 1.0);
        ctx.dbox(0, ty + th / 2, 0, tw, th, tw, P.course(20 + i));
        ctx.dbox(0, ty + th + 0.09, 0, tw + 0.34, 0.18, tw + 0.34, P.light);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (let k = 0; k < 3; k++)
          ctx.dbox(sx * tw * 0.45, ty + th + 0.18 + tw * k * 0.055, sz * tw * 0.45,
            tw * (0.09 - k * 0.026), tw * (0.07 - k * 0.012), tw * (0.09 - k * 0.026), k === 2 ? gold : P.light);
        ty += th + 0.18; tw *= 0.86;
      }

      // ---- 4. THE BELL --------------------------------------------------
      // THE BELL MUST STAND INSIDE ITS TERRACE. Springing bands wider than the
      // platform under them is what turns terraces + bell + hti into one cone.
      const R = tw * 0.49, BH = R * 1.85, N = cl(Math.round(BH / cl(u * 0.035, 0.22, 0.55)), 12, 28), bh = BH / N;
      for (let k = 0; k < 3; k++) ring(ty + k * bh * 0.75, bh * 0.80, R * (1.15 - k * 0.06), k === 1 ? gold : P.dark);
      const by = ty + bh * 2.25;
      for (let i = 0; i < N; i++) {
        const t = (i + 0.5) / N;
        // THE PROFILE. Swells to 1.04 of the base radius a quarter of the way
        // up, then falls to 0.36 at the throat. Drop the sine and it is a
        // dome; drop the power and it is a cone. Both are other cultures.
        const fr = Math.pow(1 - t * t * 0.94, 0.36) * (1 + 0.09 * Math.sin(Math.PI * t));
        ring(by + bh * i, bh + 0.02, R * fr, P.course(30 + i));
      }

      // ---- 5. THE HTI ---------------------------------------------------
      // ONE per building. A mast through many diminishing gilt rings, ending
      // in a point fine enough to read as a needle against the sky. If it is
      // missing the bell just stops, and a stupa that stops is a silo.
      let hy = by + BH;
      ring(hy - bh * 0.6, bh * 1.1, R * 0.42, gold);                             // the gilt throat band
      ctx.dbox(0, hy + R * 0.18, 0, R * 0.86, R * 0.36, R * 0.86, P.light);      // the harmika
      ctx.dbox(0, hy + R * 0.40, 0, R * 0.62, R * 0.14, R * 0.62, gold);
      hy += R * 0.48;
      const hH = cl(R * 1.9, 1.8, 8.0), nR = cl(Math.round(hH / cl(u * 0.035, 0.26, 0.6)), 9, 20);
      ctx.dbox(0, hy + hH * 0.5, 0, R * 0.16, hH, R * 0.16, goldD);              // the mast
      for (let i = 0; i < nR; i++) {
        const t = i / nR;
        ring(hy + hH * t, (hH / nR) * 0.60, R * 0.50 * (1 - 0.86 * t), i % 2 ? gold : goldD);
      }
      if (F.mesh(ctx, 2) >= 2) { ctx.cone(0, hy + hH, 0, R * 0.09, R * 0.75, gold); ctx.ball(0, hy + hH + R * 0.80, 0, R * 0.07, gold); }
      else for (let k = 0; k < 4; k++) ctx.dbox(0, hy + hH + R * k * 0.22, 0, R * (0.12 - k * 0.025), R * 0.24, R * (0.12 - k * 0.025), gold);

      // ---- 6. THE PYATTHAT over the entrance hall -----------------------
      const e = F.entrance(ctx), fd = e.f, pD = cl(u * 0.32, 1.6, 4.2);
      const pW = Math.min(fd.span * 0.52, e.gap + cl(fd.span * 0.30, 2.4, 6.0));
      const por = F.porch(ctx, { face: fd, pal: P, depth: pD, width: pW, roof: "flat", posts: 2,
        deckTop: Math.min(pod.top, F.STEP_RISE), roofCol: F.shade(P.roof, 0.72),
        eave: cl(FH * 1.15 + 0.4, e.head + 0.7, rTop - 0.8) });
      const cx = fd.horiz ? 0 : fd.out * (fd.halfN + pD / 2), cz = fd.horiz ? fd.out * (fd.halfN + pD / 2) : 0;
      // the pyatthat is the SECOND spire and must stay the smaller one: tied to
      // the bell's own radius, or on a small host it out-tops the stupa.
      let py = por.eave + 0.22, pw = Math.min(pW * 0.98, pD * 2.1, R * 1.9);
      for (let i = 0, nT = cl(Math.round(3 + u * 0.10), 4, 7); i < nT; i++) {
        const rh = Math.max(0.12, pw * 0.10), bd = Math.max(0.18, pw * 0.17);
        ctx.dbox(cx, py + rh / 2, cz, pw, rh, pw, F.shade(P.roof, 0.72));         // the tier plate
        ctx.dbox(cx, py + rh + 0.03, cz, pw * 0.94, rh * 0.45, pw * 0.94, gold);  // its gilt lip
        for (const sx of [-1, 1]) for (const sz of [-1, 1])                        // corner flame licks
          ctx.dbox(cx + sx * pw * 0.47, py + rh * 1.9, cz + sz * pw * 0.47, pw * 0.07, rh * 2.6, pw * 0.07, gold);
        ctx.dbox(cx, py + rh + bd / 2, cz, pw * 0.70, bd, pw * 0.70, P.light);    // THE VERTICAL BAND
        py += rh + bd; pw *= 0.80;
      }
      for (let k = 0; k < 5; k++) ctx.dbox(cx, py + pw * k * 0.34, cz, pw * (0.34 - k * 0.06), pw * 0.36, pw * (0.34 - k * 0.06), k % 2 ? gold : goldD);
    },
  });
})();
