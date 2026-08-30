/* ============================================================
   city/facades/mayatemple.js — "Maya Temple-Pyramid": Tikal I, Palenque.

   THE READ, AND THE ONE THING THAT MAKES IT. Every culture that piled stone
   built a step pyramid, so a stepped bank alone identifies nothing — ziggurat.js
   is a zoning tower and pyramid.js is a Transamerica cone, and a generic stack
   of trays would be a third of the same idea. Two things separate Tikal from
   all of them and this file spends its whole budget on them:

     1. THE PITCH. The bank is STEEP — rTop of rise over about 0.30 of the plan
        as run, near 70°, where a ziggurat's setbacks lean back a few degrees a
        stage. Steepness is what makes the thing read as a mountain with a
        building on it instead of a wedding cake, and it is why the stair reads
        as a ladder: 0.4 m risers on 0.2 m treads, which is what those stairs
        actually are.
     2. THE ROOF COMB. A tall PIERCED stone crest standing on the BACK wall of
        the summit cella, taller than the cella itself, doing no structural
        work at all — it exists to make the temple visible over the canopy,
        which is exactly what a silhouette element is for. Without it this is a
        generic step pyramid; with it, the black shape at 200 m is a spike with
        a comb on top and nothing else in the kit looks like it.

   HOW THE BANK IS BUILT. ctx.w/ctx.d are the shell's fixed footprint and a
   facade cannot shrink the shell, so — the ziggurat.js trick, upside down —
   the shell wall is the INNERMOST plane and every tier is a collar standing
   proud of it, the bottom one proudest, dying to zero at the roofline. Each
   tier top is a real terrace: an apron moulding, a shadow course under it, and
   four ctx.plat strips so a player can stand on the ledge.

   WHY THE STAIR IS ON THE BACK. buildings.js hangs the real door at the centre
   of ctx.doorSide, at plaza level. A monumental stair on that face would climb
   straight over it, and a pyramid that seals its own doorway is the bug this
   grammar is most likely to have. So the great stair takes the face OPPOSITE
   the door, where it can be central, full height and as broad as it likes, and
   the door face gets what the real substructures also have: a recessed
   processional passage cut through the bottom tier, jambs each side.

   SOLIDITY. Tier collars, stair cheeks, doorway jambs and the cella are
   F.sBox/F.solid — the mass a player runs into. Apron mouldings, treads above
   the first two, and the whole comb are ctx.dbox: sbox would refuse their
   colliders anyway (over head height, or moulding-thin). The stair itself is
   ONE ctx.plat ramp, never a collider, so it can never wall the door off.

   WALL MODE "own": there is no glass anywhere in Mesoamerica. The shell hands
   over solid wall and the only openings this grammar draws are the passage at
   the plaza and the cella's single dark doorway at the summit.

   BUDGET: zero meshes. Everything is a merged box.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  CBZ.registerFacade("mayatemple", {
    label: "Maya Temple-Pyramid",
    era: "meso",
    structure: "stone",
    wall: "own",
    crownsRoof: true,
    maxStoreys: 8,          // a 40-storey Tikal is a joke, not a temple
    build: function (ctx, F, spec) {
      const rTop = ctx.rTop, FH = ctx.FH, unit = Math.min(ctx.w, ctx.d);
      const S = F.solid(ctx);
      const P = F.palette(ctx, "ashlar", { pull: 0.88, grain: 0.18 });
      const red = F.mix(P.dark, 0x9c3222, 0.66);          // the stucco was painted
      const pl = function (a, b, c, e, y) { ctx.plat(Math.min(a, b), Math.max(a, b), Math.min(c, e), Math.max(c, e), y); };

      // ---- A. THE STEEP BANK --------------------------------------
      const n = clamp(Math.round(rTop / 2.4), 4, 9);      // tiers
      const th = rTop / n;
      const p0 = clamp(unit * 0.22, 1.4, 3.8);            // the run of the WHOLE slope: rTop of rise over this, ~74°
      for (let k = 0; k < n; k++) {
        const y0 = k * th, p = p0 * (1 - k / n), pu = p0 * (1 - (k + 1) / n);
        for (const f of F.faces(ctx)) {
          // the bottom tier is the only one low enough to bury the door, and
          // it is opened for the passage rather than left for the kit to carve
          const holes = (k === 0) ? F.doorHoles(ctx, f, 0.9) : [];
          F.segBand(ctx, f, y0 + th / 2, th, p, P.course(k * 3 + f.s), holes, p * 1.02, 0, true);
          // the apron moulding + its shadow: what keeps the bank reading as
          // built courses instead of one poured ramp
          F.box(ctx, f, 0, y0 + th - 0.18, f.span + p * 2.05 + 0.26, 0.34, p + 0.18, P.light);
          F.box(ctx, f, 0, y0 + th - 0.46, f.span + p * 2.05, 0.14, p + 0.06, P.shadow);
        }
        const W = ctx.w / 2 + p, D = ctx.d / 2 + p, Wu = ctx.w / 2 + pu, Du = ctx.d / 2 + pu;
        for (const sg of [-1, 1]) {                        // the terrace you stand on
          pl(-W, W, sg * Du, sg * D, y0 + th);
          pl(sg * Wu, sg * W, -Du, Du, y0 + th);
        }
      }
      // the passage jambs at plaza level
      const df = F.face(ctx, ctx.doorSide), hw = F.entrance(ctx).gap / 2 + 0.9;
      for (const sg of [-1, 1]) F.sRib(ctx, df, sg * hw, 0, th, 0.55, p0, P.light, 0);

      // ---- B. THE GREAT STAIR (the back face — never the door's) ---
      const sf = F.face(ctx, ctx.doorSide ^ 1);
      const sw = clamp(sf.span * 0.42, 3.0, 9.0);
      const run = p0 * 1.35;                               // ~70°: a ladder, on purpose
      const nS = Math.max(8, Math.ceil(rTop / 0.40));
      for (let i = 0; i < nS; i++) {
        const u = (i + 1) / nS, r = rTop / nS;
        F.obox(ctx, sf, 0, u * rTop - r / 2, sw, r, run / nS + 0.10,
          sf.halfN + run * (1 - u) + run / nS, i % 2 ? P.base : P.light, i < 2);
      }
      const cw2 = clamp(unit * 0.055, 0.45, 1.10);         // the balustrade cheeks
      for (const sg of [-1, 1]) for (let i = 0; i < 8; i++) {
        const u = (i + 0.5) / 8;
        F.obox(ctx, sf, sg * (sw / 2 + cw2 * 0.6), u * rTop + 0.55, cw2, rTop / 8 + 1.1,
          run / 8 + 0.35, sf.halfN + run * (1 - u) + run / 8, P.dark, i < 2);
      }
      // ONE ramp platform under the whole flight, so it is climbable and the
      // treads above are pure decoration (see F.steps for the same discipline)
      const o0 = sf.out * sf.halfN, o1 = sf.out * (sf.halfN + run);
      const rmp = sf.horiz ? { z0: ctx.oz + o1, z1: ctx.oz + o0, y0: 0, y1: rTop }
        : { axis: "x", x0: ctx.ox + o1, x1: ctx.ox + o0, y0: 0, y1: rTop };
      if (sf.horiz) ctx.plat(-sw / 2, sw / 2, Math.min(o0, o1), Math.max(o0, o1), rTop, rmp);
      else ctx.plat(Math.min(o0, o1), Math.max(o0, o1), -sw / 2, sw / 2, rTop, rmp);

      // ---- C. THE SUMMIT AND ITS CELLA ----------------------------
      const R = F.roof(ctx), deck = rTop + ctx.pp;
      // the deck is laid to the WALL line, not the slab line: the shell's own
      // roof slab is a cold blue-grey and a sliver of it showing round the
      // summit is the one colour on the building that is not this temple's
      ctx.dbox(0, rTop + ctx.pp * 0.5, 0, ctx.w - 0.1, Math.max(0.06, ctx.pp), ctx.d - 0.1, F.shade(P.base, 0.92));
      pl(R.cx - R.w / 2, R.cx + R.w / 2, R.cz - R.d / 2, R.cz + R.d / 2, deck);
      const cw = ctx.w * 0.38, cd = ctx.d * 0.42, ch = clamp(FH * 1.45, 3.2, 5.6);
      // the shell's own roof parapet is a cold blue-grey lbox ring (buildings.js
      // builds it long before any facade runs and no flag turns it off), so it is
      // clad over here: the summit rim has to be this temple's stone, not the office's
      F.ring(ctx, rTop + (ctx.pp + 0.18) / 2, ctx.pp + 0.18, 0.62, P.light, 0.3, -0.45);
      S(0, deck + ch / 2, 0, cw, ch, cd, P.base);
      ctx.dbox(0, deck + ch + 0.24, 0, cw + 0.90, 0.48, cd + 0.90, P.light);   // the flaring cornice
      // its one doorway, facing down the stair
      const nx = sf.horiz ? 0 : sf.out, nz = sf.horiz ? sf.out : 0;
      const dw = clamp(Math.min(cw, cd) * 0.34, 0.9, 2.2), dh = clamp(ch * 0.58, 1.8, 3.0);
      ctx.dbox(nx * cw * 0.5, deck + dh / 2, nz * cd * 0.5, nx ? 0.34 : dw, dh, nz ? 0.34 : dw,
        F.shade(P.shadow, 0.34));

      // ---- D. THE ROOF COMB (the whole silhouette) ----------------
      const hz = sf.horiz, len = hz ? cw : cd;
      const t0 = clamp(unit * 0.055, 0.40, 0.95);          // the crest is a thin wall
      const combH = ch * 1.95;                             // taller than the cella. Always.
      const bx = -nx * (cw / 2 - t0 * 0.8), bz = -nz * (cd / 2 - t0 * 0.8);
      const put = function (t, y, L, h, thk, col) { ctx.dbox(bx + (hz ? t : 0), y, bz + (hz ? 0 : t), hz ? L : thk, h, hz ? thk : L, col); };
      const rows = 6, rh = combH / rows;
      for (let r = 0; r < rows; r++) {
        const u = (r + 0.5) / rows, L = len * (1 - u * 0.46), thk = t0 * (1 - u * 0.34);
        const y = deck + ch + r * rh;
        put(0, y + rh * 0.16, L + 0.30, rh * 0.32, thk + 0.12, r % 2 ? P.light : P.base);
        const m = Math.max(2, Math.round(L / clamp(unit * 0.075, 0.55, 1.20)));
        for (let i = 0; i < m; i++) {                      // the piercing: pier, hole, pier
          const t = -L / 2 + (i + 0.5) * (L / m);
          put(t, y + rh * 0.62, (L / m) * 0.54, rh * 0.68, thk, P.course(r * 5 + i));
          if (r < 2) put(t, y + rh * 0.62, (L / m) * 0.30, rh * 0.34, thk + 0.10, red);
        }
      }
      // the crest blocks that finish it, so the comb terminates instead of just stopping
      const cn = Math.max(3, Math.round(len / clamp(unit * 0.13, 0.9, 2.0))), cs = len * 0.60 / cn;
      for (let i = 0; i < cn; i++) put(-len * 0.30 + (i + 0.5) * cs, deck + ch + combH + 0.30, cs * 0.60, 0.60, t0 * 0.72, P.light);
    },
  });
})();
