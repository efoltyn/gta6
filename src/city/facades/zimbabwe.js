/* ============================================================
   city/facades/zimbabwe.js — "Great Zimbabwe Dry-Stone": the Great Enclosure.

   THE READ, AND THE ONE THING IT MUST NOT BE MISTAKEN FOR. The failure mode
   here is A CASTLE. Every instinct the kit has — merlons, arrow slits, a gate
   tower, a machicolated head — is WRONG for this building, and any one of them
   turns Great Zimbabwe into a Norman keep with the wrong palette. There are no
   battlements. There are no openings. There is no gate. What there is:

     1. A WALL, NOT A FACADE. Coursed granite laid dry — no mortar, so the mass
        holds itself up by being enormous: 5 m thick at the foot, half that at
        the head, battering visibly inward the whole way. Everything on this
        building measures off pAt(y), the wall's thickness at that height, so
        an 11 m shop and a 34 m block both come out as one continuous mass
        instead of a stretched texture. Above the ground there are NO windows,
        no slits and no niches at all, which is only sayable now: wall:"own"
        means the shell hands over solid wall and the grammar draws the
        openings the culture has. This one has one, and it is the way in.

     2. IT READS CURVED. The Great Enclosure is a closed curve; the shell is a
        rectangle and no facade can bend it. So each course is drawn as a FLAT
        RUN between four ROUNDED CORNER DRUMS — a staircase of nested boxes
        under a quarter arc, tangent to both proud face planes. The drum radius
        is tied to the wall thickness (R ≤ 3.41·p, or the shell's own sharp
        corner pokes back out of the round one), so the corners swell at the
        base and tighten as the wall thins: a mass that is rounder where it is
        thicker, which is what a dry-stone wall actually does.

     3. THE CHEVRON COURSE. One band of stones set in a zigzag, high on the
        wall, and it is the ONLY ornament on the entire building. It stops at
        the drums because a chevron laid round a curve is a chevron you cannot
        see. Everything else you can point at is structure.

     4. THE CONICAL TOWER. Solid. No door, no window, no stair, no interior —
        it is a granary built at monumental scale and it has never been
        anything else. Stacked octagonal lifts (F.boxShaft) so it reads round
        at any distance and costs no mesh at all.

     5. THE NARROW PASSAGE. A second, lower wall standing parallel to the
        first with a body's width between them. Two masses and a slot: that is
        the whole plan of the site, and it is what makes the silhouette read
        as an enclosure rather than as a block.

   THE ENTRANCE is where the wall stops and turns its ends into drums, under
   one granite lintel. F.segBand cuts the courses around the gap so the hole
   is real, and the drums are F.boxShaft — a rounded wall end, not a jamb.

   SOLIDITY: the batter courses, the corner drums, the tower's lower lifts and
   the passage wall are the mass a player walks into, so they go through sbox
   up to reach height. Chevron, lintel band and wall-head cap stay free.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  CBZ.registerFacade("zimbabwe", {
    label: "Great Zimbabwe Dry-Stone",
    era: "africa",
    // city/collapse.js MATERIALS — unmortared coursed granite. It does not
    // pancake and it does not shear; it slumps into a heap of its own stones.
    structure: "stone",
    wall: "own",
    crownsRoof: true,
    build: function (ctx, F, spec) {
      const rTop = ctx.rTop, FH = ctx.FH, unit = Math.min(ctx.w, ctx.d);
      const P = F.palette(ctx, "granite", { pull: 1, dim: 0.74, grain: 0.22 });
      const sbox = ctx.sbox || ctx.dbox;
      const ent = F.entrance(ctx);

      // THE WALL'S THICKNESS AT HEIGHT y, and the corner radius that goes with
      // it. R <= 3.41*p is not a taste number: the shell's square corner sits
      // that far inside the drum, and a larger R leaves it sticking out of the
      // curve like a fin.
      const P0 = clamp(unit * 0.10, 0.65, 1.75), PT = clamp(unit * 0.035, 0.30, 0.60);
      const pAt = function (y) { return PT + P0 * Math.pow(1 - clamp(y / rTop, 0, 1), 1.35); };
      const rAt = function (p) { return Math.min(p * 2.9, unit * 0.34); };

      // A ROUNDED CORNER, axis-aligned: nested boxes anchored at the arc
      // centre, each reaching R*cos0 one way and R*sin0 the other. Their union
      // is the staircase under a quarter circle, and seven of them is enough
      // that nobody standing on the street can find the steps.
      const drum = function (cx, cz, sx, sz, R, cy, hh, col, solid) {
        const E = solid ? sbox : ctx.dbox;
        for (let i = 0; i < 7; i++) {
          const a = R * Math.cos((i + 0.5) * Math.PI / 14), b = R * Math.sin((i + 0.5) * Math.PI / 14);
          E(cx + sx * a / 2, cy, cz + sz * b / 2, a, hh, b, col);
        }
      };
      const corners = function (p, R, cy, hh, col, solid) {
        for (const sx of [-1, 1]) for (const sz of [-1, 1])
          drum(sx * (ctx.w / 2 + p - R), sz * (ctx.d / 2 + p - R), sx, sz, R, cy, hh, col, solid);
      };

      // ---- A. THE MASS: dry coursed granite, battering inward ------------
      // Solid only at the foot: the batter means the lowest course is the
      // proudest, so one collider band there is the whole mass's footprint.
      const nC = clamp(Math.round(rTop / clamp(FH * 0.16, 0.40, 0.62)), 6, 30);
      const cH = rTop / nC;
      const lint = clamp(FH * 0.82, 2.45, 3.10), gapH = ent.gap / 2 + 0.45;   // the way in
      for (let k = 0; k < nC; k++) {
        const y0 = k * cH, cy = y0 + cH / 2, p = pAt(cy), R = rAt(p);
        const col = P.course(k), sol = y0 < 1.30;
        for (const f of F.faces(ctx)) {
          if (f.s === ctx.doorSide && y0 < lint)
            F.segBand(ctx, f, cy, cH + 0.02, p, col, [[-gapH, gapH]], p - R, 0, sol);
          else (sol ? F.sBox : F.box)(ctx, f, 0, cy, f.span + p * 2 - R * 2, cH + 0.02, p, col, 0);
          // the bed joint, RECESSED: dry stone has no mortar, so every
          // horizontal you can see is one stone sitting back on another. Proud
          // of the wall it reads as a ledge and the elevation goes striped.
          if (k % 2) F.box(ctx, f, 0, y0 + 0.05, f.span + p * 2 - R * 2.6, 0.06, p - 0.05, P.dark, 0);
        }
        corners(p, R, cy, cH + 0.02, col, sol);
      }

      // ---- B. THE CHEVRON COURSE - the only ornament on the building -----
      const yC = rTop - clamp(FH * 0.78, 1.30, 2.60);
      const pC = pAt(yC), RC = rAt(pC), cw = clamp(FH * 0.14, 0.24, 0.44);
      for (const f of F.faces(ctx)) {
        const half = f.span / 2 + pC - RC;
        const n = Math.max(6, Math.round(half * 2 / (cw * 1.35))), st = half * 2 / n;
        F.box(ctx, f, 0, yC + cw * 1.6, half * 2, cw * 3.6, pC + 0.05, P.shadow, 0);
        for (let i = 0; i < n; i++) {            // 3,2,1,0,1,2 - the zigzag
          F.box(ctx, f, -half + (i + 0.5) * st, yC + cw * 0.75 + Math.abs((i % 6) - 3) * cw * 0.62,
            st * 0.92, cw, pC + 0.13, P.course(i + 3), 0);
        }
      }

      // ---- C. THE WALL HEAD. One rounded cap course and nothing else: no
      // coping, no parapet, and above all no merlons.
      const pT = pAt(rTop), RT = rAt(pT), RF = F.roof(ctx);
      for (const f of F.faces(ctx)) F.band(ctx, f, rTop - 0.06, 0.30, pT * 0.90, P.course(nC + 1), (pT - RT) * 2, 0);
      corners(pT * 0.90, RT, rTop - 0.06, 0.30, P.course(nC + 1), false);
      ctx.dbox(RF.cx, rTop + ctx.pp * 0.5, RF.cz, RF.w, Math.max(0.06, ctx.pp), RF.d, F.shade(P.base, 0.88));
      ctx.plat(RF.cx - RF.w / 2, RF.cx + RF.w / 2, RF.cz - RF.d / 2, RF.cz + RF.d / 2, rTop + ctx.pp);

      // ---- D. THE CONICAL TOWER. Solid granite, no door, no window, no
      // stair: a granary at monumental scale, and the failure mode is a
      // turret, so it gets no opening and no crenellation of any kind.
      const fl = F.flanks(ctx), fi = (ctx.hash(0x2b10) * fl.length) | 0, tf = fl[fi];
      const r0 = clamp(unit * 0.16, 1.00, 2.40), TH = rTop + clamp(FH * 0.6, 1.20, 2.60);
      const tt = (ctx.hash(0x2b11) < 0.5 ? -1 : 1) * tf.span * 0.17, NL = clamp(Math.round(TH / 0.38), 8, 34);
      const tD = tf.halfN + pAt(TH * 0.3) + r0 * 0.66;
      for (let j = 0; j < NL; j++) {
        const u = j / NL, band = (j === NL - 4);       // its own dentelle course
        F.boxShaft(ctx, tf.horiz ? tt : tf.out * tD, u * TH, tf.horiz ? tf.out * tD : tt,
          TH / NL + 0.02, r0 * (1 - Math.pow(u, 1.2) * 0.70) * (band ? 1.18 : 1),
          band ? P.light : P.course(j + 7), null, u * TH < 1.30);
      }

      // ---- E. THE NARROW PASSAGE. A second, lower wall standing one body's
      // width off the first. Two masses and a slot is the whole plan of the
      // site, and it is what stops the silhouette reading as a block.
      const pf = fl[(fi + 1) % fl.length];
      const G = clamp(unit * 0.09, 0.90, 1.60), PH = clamp(rTop * 0.42, FH * 0.9, 4.60);
      const TW = clamp(unit * 0.055, 0.45, 0.95);
      for (let i = 0; i < 3; i++) {
        const tw = TW * (1 - i * 0.17), lh = PH / 3;
        F.obox(ctx, pf, 0, i * lh + lh / 2, pf.span * 0.80 - i * tw * 1.4, lh + 0.02, tw,
          pf.halfN + pAt(0) + G + tw, P.course(i + 12), i === 0);
      }

      // ---- F. THE ENTRANCE. The wall stops, each end is turned into a drum,
      // and one granite lintel bridges them. No arch, no gate, no tower.
      const df = ent.f, pD = pAt(lint * 0.5), jr = clamp(pD * 0.85, 0.42, 1.05);
      const jn = df.halfN + pD - jr * 0.55;
      for (const sg of [-1, 1]) {
        const jt = sg * (gapH + jr * 0.55);
        F.boxShaft(ctx, df.horiz ? jt : df.out * jn, 0, df.horiz ? df.out * jn : jt,
          lint, jr, P.course(4), null, true);
      }
      F.box(ctx, df, 0, lint + 0.24, gapH * 2 + jr * 2.4, 0.44, pD + 0.16, P.dark, 0);
      F.box(ctx, df, 0, lint + 0.52, gapH * 2 + jr * 1.6, 0.16, pD + 0.06, P.course(2), 0);
    },
  });
})();
