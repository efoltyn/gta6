/* ============================================================
   city/facades/swahili.js — "Swahili Coral-Stone": Lamu, Zanzibar, Kilwa.

   THE READ. A Swahili stone town house is the quietest building in this era
   and the most concentrated: a low white block, flat-topped, almost blank —
   and then ONE enormous carved door. Everything the household could spend on
   display went into the entrance, so the whole grammar is weighted that way.
   Get the balance wrong (a busy wall, a modest door) and this is a Greek
   island villa. Four things, in order of how much of the budget they get:

     1. THE DOOR, and it is the entrance CEREMONY, not a doorway. A frame of
        carved mangrove and teak far wider and taller than the opening needs:
        two deep chip-carved jambs, a lintel with a carved frieze over it, and
        a stone surround standing outside all of it. ownDoor is declared, so
        the kit's automatic reveal is skipped and this file owns every part of
        it. The shell's real hinged leaf is left showing in the middle of it —
        a facade that draws a picture of a door over the working one is the
        commonest failure in the kit, and this one has the most to lose.

     2. THE BARAZA. The stone bench running along the street front either side
        of the door: where the household sits, trades and receives, and the
        reason the ground floor of a Swahili street is public. It is SOLID and
        it is a ctx.plat — a bench you can genuinely sit and stand on — and
        its cap is deliberately under F.STEP_RISE, because a seat you cannot
        step onto is not a seat, it is a kerb wall around the front door.

     3. CORAL RAG UNDER LIME. The wall is rubble coral set in lime and skimmed
        by hand: flat white, thick, and never quite plane. Built as panels of
        hashed projection and tint rather than one extruded box — the wander
        in the surface is the whole material read, and it costs nothing. No
        batter: this is a plumb town wall between two neighbours, not a mass.

     4. ZIDAKA. The rows of arched plaster niches. They are what a Swahili
        wall has instead of windows: the openings are few, small and high,
        because a 60 cm coral wall is built for shade.

   The roof is a flat terrace behind a LOW parapet, pierced with small square
   holes rather than crenellated — low and blunt being the point. Beside
   sahelian's spiked mass and zimbabwe's curved wall this one has to read as
   the small white block with the deep doorway.

   SOLIDITY: door jambs, lintel, stone surround, baraza and its end piers are
   the mass a player meets, so they go through sbox. Plaster panels, niches,
   parapet and its holes are surface and stay free — sbox would refuse them
   anyway, none of them stands 0.30 m proud of the wall.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  CBZ.registerFacade("swahili", {
    label: "Swahili Coral-Stone",
    era: "africa",
    // city/collapse.js MATERIALS — coral rag rubble in lime mortar: heavy,
    // brittle, no frame. It collapses as stone, not as the plaster you see.
    structure: "stone",
    wall: "own",
    maxStoreys: 3,
    ownDoor: true,
    crownsRoof: true,
    build: function (ctx, F, spec) {
      const rTop = ctx.rTop, FH = ctx.FH, unit = Math.min(ctx.w, ctx.d);
      const P = F.palette(ctx, "coral", { pull: 0.90, grain: 0.13 });
      const wood = F.mix(P.trim, 0x3b2a1a, 0.72);      // carved mangrove and teak
      const brass = F.mix(wood, 0xc9a23e, 0.70);       // the door bosses
      const ent = F.entrance(ctx), df = ent.f;

      // ---- A. THE PLASTERED MASS -----------------------------------------
      // Panels, not one box: a hand-skimmed lime wall wanders, and a facade
      // that renders it flat comes out as painted cardboard.
      // The wander is SMALL on purpose: deep panels read as plasterboard
      // sheets, and they would bury the zidaka, which sit on the wall plane.
      const PJ = clamp(unit * 0.007, 0.035, 0.065);
      for (const f of F.faces(ctx)) {
        const n = Math.max(3, Math.round(f.span / clamp(unit * 0.30, 1.7, 3.2)));
        for (let k = 0; k < ctx.storeys; k++) for (let i = 0; i < n; i++) {
          F.box(ctx, f, -f.span / 2 + (i + 0.5) * (f.span / n), k * FH + FH / 2,
            f.span / n + 0.05, FH + 0.03, PJ * (0.66 + ctx.hash(0x5710 + f.s * 37 + k * 11 + i) * 0.62),
            P.course(k * 5 + i), 0);
        }
      }
      F.waterTable(ctx, { pal: P, h: clamp(FH * 0.11, 0.24, 0.40), col: F.shade(P.base, 0.90) });
      for (let k = 1; k < ctx.storeys; k++)                     // the floor-line course
        F.ring(ctx, k * FH, clamp(FH * 0.07, 0.14, 0.22), PJ + 0.12, P.light, 0.16, 0);

      // ---- B. ZIDAKA — the rows of arched niches --------------------------
      // Skipped on the ground of the door face: that wall belongs to the
      // baraza and the doorcase, and a niche behind a bench is a niche nobody
      // will ever see.
      for (const f of F.faces(ctx)) {
        for (const b of F.bays(f, F.bayCount(f, clamp(f.span / 4, 2.2, 3.2), 2, 6),
          clamp(f.span * 0.13, 0.9, 2.2))) {
          for (let k = 0; k < ctx.storeys; k++) {
            if (f.s === ctx.doorSide && k === 0) continue;
            F.blindNiche(ctx, f, { pal: P, t: b.t, y0: k * FH + FH * 0.32, h: FH * 0.46,
              wid: clamp(b.w * 0.34, 0.38, 0.86), kind: "round", col: P.light,
              dark: F.shade(P.shadow, 0.72), recess: clamp(unit * 0.022, 0.14, 0.26), sill: false });
          }
        }
      }
      // the few windows: small, high, shuttered in the same dark timber
      F.openingGrid(ctx, { pal: P, shape: "rect", blind: 0.46, hi: 4, hFrac: 0.30,
        wFrac: 0.22, sillFrac: 0.56, lintel: false, sillOut: false, glass: F.shade(wood, 0.62),
        reveal: F.shade(P.shadow, 0.60), y0: FH * (ctx.storeys > 1 ? 1 : 0) });

      // ---- C. THE FLAT TERRACE ROOF ---------------------------------------
      const ph = clamp(FH * 0.24, 0.48, 0.80), pt = clamp(unit * 0.045, 0.26, 0.50);
      F.parapetWalk(ctx, { pal: P, h: ph, thick: pt, col: P.light, capCol: P.base });
      // PIERCED, not crenellated. The kit's reflex at a roofline is merlons,
      // and merlons put this house in Europe; a Lamu parapet is a plain low
      // wall with a run of small square holes punched through it.
      for (const f of F.faces(ctx)) {
        const n = Math.max(4, Math.round(f.span / clamp(unit * 0.16, 0.85, 1.5))), sq = clamp(ph * 0.32, 0.14, 0.26);
        for (let i = 0; i < n; i++) F.box(ctx, f, -f.span / 2 + (i + 0.5) * (f.span / n), rTop + ph * 0.46, sq, sq, pt * 1.15, P.shadow, -pt * 0.5);
      }

      // ---- D. THE BARAZA — the street bench ------------------------------
      const bY = 0.40, bD = clamp(unit * 0.090, 0.62, 1.15), bIn = ent.gap / 2 + 0.60, eH = clamp(FH * 0.34, 0.85, 1.25);
      for (const sg of [-1, 1]) {
        const t0 = sg * bIn, t1 = sg * (df.span / 2 - 0.30), len = Math.abs(t1 - t0);
        if (len < 0.9) continue;   const tc = (t0 + t1) / 2;
        F.sBox(ctx, df, tc, bY / 2, len, bY, bD, P.base, 0);                    // the seat mass
        F.box(ctx, df, tc, bY - 0.06, len + 0.10, 0.13, bD + 0.07, P.light, 0); // its moulded cap
        // the end pier that stops the run and carries the household's water jar
        F.sBox(ctx, df, t1 - sg * 0.30, eH / 2, 0.60, eH, bD * 0.94, P.light, 0);
        F.box(ctx, df, t1 - sg * 0.30, eH + 0.07, 0.72, 0.14, bD + 0.04, P.base, 0);
        // SIT ON IT, STAND ON IT: solid below, walkable on top.
        const a = df.out * df.halfN, b = df.out * (df.halfN + bD);
        if (df.horiz) ctx.plat(Math.min(t0, t1), Math.max(t0, t1), Math.min(a, b), Math.max(a, b), bY);
        else ctx.plat(Math.min(a, b), Math.max(a, b), Math.min(t0, t1), Math.max(t0, t1), bY);
      }

      // ---- E. THE DOOR ---------------------------------------------------
      // Solved outward from the shell's real opening: the recess is left on
      // the wall plane so the kit's carve turns it into a hole round the live
      // leaf, and every carved thing stands proud of that.
      const FW = clamp(Math.max(ent.gap + 1.7, df.span * 0.32), 3.0, df.span * 0.60);
      const JW = clamp(FW * 0.18, 0.42, 0.85), DP = clamp(unit * 0.05, 0.36, 0.62);
      const OW = FW - JW * 2, LY = clamp(FH * 0.88, 2.55, 3.20);
      F.box(ctx, df, 0, LY / 2, OW, LY, 0.10, F.shade(P.shadow, 0.58), 0.01);
      const nb = Math.max(5, Math.round(LY / clamp(FH * 0.15, 0.28, 0.44)));
      for (const sg of [-1, 1]) {
        F.sRib(ctx, df, sg * (OW + JW) / 2, 0, LY + JW * 0.5, JW, DP, wood, 0);
        // CHIP CARVING. A Swahili jamb is a relief panel end to end; a plain
        // post here reads as a shop doorframe and throws away the building.
        for (let i = 0; i < nb; i++) {
          F.box(ctx, df, sg * (OW + JW) / 2, (i + 0.5) * (LY / nb), JW * 0.66,
            (LY / nb) * 0.60, DP + (i % 2 ? 0.11 : 0.05),
            F.shade(wood, i % 2 ? 1.30 : 0.78), 0);
        }
      }
      F.sBox(ctx, df, 0, LY + JW * 0.45, FW, JW * 0.90, DP, wood, 0);           // the lintel
      const nl = Math.max(6, Math.round(FW / clamp(FH * 0.17, 0.30, 0.52)));
      for (let i = 0; i < nl; i++) {
        F.box(ctx, df, -FW / 2 + (i + 0.5) * (FW / nl), LY + JW * 0.45, (FW / nl) * 0.62,
          JW * 0.58, DP + 0.10, i % 2 ? brass : F.shade(wood, 0.82), 0);
      }
      // THE STONE SURROUND, wider and taller than anything inside it — the
      // ceremony. Drawn as jambs and a head, never as a slab, or it would
      // bury the recess and the leaf standing in it.
      const SW = clamp(JW * 0.75, 0.30, 0.62), ST = LY + JW * 1.5;
      for (const sg of [-1, 1]) F.sRib(ctx, df, sg * (FW + SW) / 2, 0, ST + SW, SW, DP * 0.62, P.light, 0);
      F.box(ctx, df, 0, ST + SW / 2, FW + SW * 3, SW, DP * 0.62, P.light, 0);
      F.steps(ctx, { pal: P, top: clamp(FH * 0.09, 0.18, 0.30), width: OW + 0.5,
        out: 0.02, col: P.light, capCol: P.base });
    },
  });
})();
