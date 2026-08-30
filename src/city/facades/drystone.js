/* ============================================================
   city/facades/drystone.js — "Dry-Stone Broch": Skara Brae / broch / nuraghe.

   THE READ, IN ONE SENTENCE: a drum of unmortared rubble that visibly LEANS
   IN, closed at the top by a corbel that spirals shut around a smoke hole,
   entered through a hole punched in a wall you can see is a metre thick.

   THE FAILURE MODE is a grey box with a stone texture on it. Three things
   are spent to avoid it, in this order of importance:

     1. THE DRUM. The shell's plan is a rectangle and no facade can change
        that, so the plan is made to READ round the only way merged axis-
        aligned boxes allow: the middle of each face BELLIES OUT and the
        corners stay nearly flush. drum() below is that profile — a cosine
        across the face times a batter down the height — and every single
        thing on this building (course, slit, jamb, lintel) measures its
        projection off it, so the whole facade re-proportions with w, d and
        storeys instead of being pinned to constants. It leans in as well as
        bulging out: the foot is a metre proud, the wall head barely a third
        of that. A wall of stacked dry stone that stood plumb fell over.

     2. THE CORBEL. Not a roof laid ON the building — the wall CONTINUES,
        each ring stepping inward over the one below until the rings meet
        over a smoke hole about a metre across. It is drawn as a RING of four
        bands per course, not a solid slab, so the hole is a real hole you
        can see the sky through and the thing reads as a dome closing rather
        than as a ziggurat stacking.

     3. THE CREEP ENTRANCE. Two monolithic jambs standing well proud of the
        fattest course, ONE massive lintel across them, a relieving stone
        over that, and a dark passage lining that the kit's own doorway carve
        turns into two deep reveals. That is what makes the opening read as a
        hole bored through a mass instead of a door stuck on a surface.

   WALL MODE "own": the Neolithic has no glazing. The shell hands over solid
   wall and the only openings here are the few small slits an unmortared wall
   can carry without the lintel course coming down — most of the wall is
   blind, which is the point.

   SOLIDITY: every course of the drum and both entrance jambs go through
   F.sRib/F.sBox, so the mass you can see is the mass you run into. The
   corbel is above head height and stays free — sbox would refuse its
   colliders anyway.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  CBZ.registerFacade("drystone", {
    label: "Dry-Stone Broch",
    era: "neolithic",
    // city/collapse.js MATERIALS — unmortared rubble. It has no frame and no
    // binder: it does not pancake or topple, it sloughs into a mound.
    structure: "stone",
    wall: "own",
    crownsRoof: true,      // the corbel IS the roof; the host must not add one
    maxStoreys: 2,
    build: function (ctx, F, spec) {
      spec = spec || {};
      const rTop = ctx.rTop, FH = ctx.FH, unit = Math.min(ctx.w, ctx.d);
      const h = function (s) { return ctx.hash(s); };
      const P = F.palette(ctx, "granite", { pull: 0.96, grain: 0.46 });

      // ---- THE DRUM PROFILE ---------------------------------------
      // How far the wall stands proud at tangent `t` on a face of `span`, at
      // height `y`. Cosine across (round plan) × batter up (the lean).
      const R = clamp(unit * 0.130, 0.60, 1.60);
      const drum = function (t, span, y) {
        const c = Math.cos(clamp(t / (span / 2), -1, 1) * Math.PI / 2);
        return 0.12 + R * (1 - clamp(y, 0, rTop) / rTop * 0.68) * (0.18 + 0.82 * c * c);
      };

      // ---- A. THE COURSED, LEANING MASS ---------------------------
      // Laid in RUNNING BOND — every other course offset half a stone — and
      // every stone set a little proud or a little shy of its neighbours. Both
      // are what stops a hand-laid wall reading as painted-on horizontal
      // stripes, which is exactly how the first version of this failed.
      const K = clamp(Math.round(rTop / 0.82), 5, 11);     // lifts of rubble
      const cH = rTop / K;
      for (const f of F.faces(ctx)) {
        const N = Math.max(4, Math.round(f.span / clamp(unit * 0.20, 0.85, 1.70)));
        const step = f.span / N;
        for (let k = 0; k < K; k++) {
          const y0 = k * cH, bond = (k % 2) * step * 0.5;
          for (let i = 0; i <= N; i++) {
            const t = clamp(-f.span / 2 + i * step + bond, -f.span / 2, f.span / 2);
            const s = 0x7d10 + f.s * 37 + k * 11 + i;
            const jit = 0.87 + h(s) * 0.30;                // no two stones sit alike
            const p = drum(t, f.span, y0) * jit;
            // always wider than the gap to its neighbour — a stone that left a
            // hole would show the shell's own pale wall through the rubble —
            // but never so far past the corner that it becomes a shelf
            const len = Math.min(step * (1.04 + h(s + 1) * 0.52),
              (f.span / 2 + 0.22 - Math.abs(t)) * 2);
            F.sRib(ctx, f, t, y0, y0 + cH, len, p, P.course(k * 5 + i + f.s * 3));
            // the bed joint, drawn ON this stone's own face rather than as a
            // band round the building: a band is struck at the mid-face
            // projection and therefore juts out past the corners as a shelf,
            // which is what turned the first version's corners into a comb
            F.box(ctx, f, t, y0 + 0.07, len, 0.13, p + 0.02, F.shade(P.shadow, 0.60));
          }
        }
      }

      // ---- B. THE CORBELLED ROOF ----------------------------------
      // Rings, not slabs: the smoke hole at the top has to be a hole.
      const CN = clamp(Math.round(unit * 0.62), 6, 12);
      const RH = clamp(unit * 0.48, FH * 0.75, FH * 1.8);
      const th = clamp(unit * 0.115, 0.40, 0.90);
      for (let k = 0; k < CN; k++) {
        const u = (k + 0.5) / CN, y = rTop + RH * u;
        const fr = 1 - Math.pow(u, 1.30) * 0.90;
        const hw = (ctx.w / 2 + 0.32) * fr, hd = (ctx.d / 2 + 0.32) * fr;
        const t2 = th * (1 - u * 0.40), ch = RH / CN + 0.04;
        const col = P.course(k * 3 + 41);
        for (const sg of [-1, 1]) {
          ctx.dbox(0, y, sg * (hd - t2 / 2), hw * 2, ch, t2, col);
          ctx.dbox(sg * (hw - t2 / 2), y, 0, t2, ch, Math.max(0.2, hd * 2 - t2 * 2), col);
          // the proud arris of each corbel, which is what makes the dome
          // read as stones stepping in and not as a smooth funnel
          ctx.dbox(0, y - ch * 0.34, sg * (hd - t2 * 0.15), hw * 1.94, ch * 0.34, t2 * 0.5, F.shade(col, 1.14));
          ctx.dbox(sg * (hw - t2 * 0.15), y - ch * 0.34, 0, t2 * 0.5, ch * 0.34, Math.max(0.2, hd * 1.9 - t2 * 2), F.shade(col, 1.14));
        }
      }
      // the rim of the smoke hole, where the hearth's smoke gets out
      const rimW = (ctx.w / 2 + 0.32) * 0.10, rimD = (ctx.d / 2 + 0.32) * 0.10;
      for (const sg of [-1, 1]) {
        ctx.dbox(0, rTop + RH + 0.10, sg * rimD, rimW * 2.4, 0.22, th * 0.5, P.light);
        ctx.dbox(sg * rimW, rTop + RH + 0.10, 0, th * 0.5, 0.22, rimD * 2.0, P.light);
      }

      // ---- C. THE CREEP ENTRANCE ----------------------------------
      const e = F.entrance(ctx), fe = e.f;
      const jw = clamp(unit * 0.16, 0.75, 1.60);            // monolithic jambs
      const jp = drum(0, fe.span, 0) + 0.32;                // proud of the fattest course
      const soffit = F.DOOR_H + 0.30;                       // clear of the kit's carve
      for (const sg of [-1, 1]) {
        F.sRib(ctx, fe, sg * (e.gap / 2 + jw / 2), 0, soffit, jw, jp, P.light);
      }
      F.box(ctx, fe, 0, soffit + 0.33, e.gap + jw * 2.2, 0.64, jp + 0.14, P.light);          // ONE lintel
      F.box(ctx, fe, 0, soffit + 0.98, e.gap * 0.80, 0.50, jp * 0.70, P.course(9));          // relieving stone
      // the passage lining: laid ACROSS the doorway on purpose, so the kit's
      // carve turns it into two deep dark reveals and a soffit — the wall
      // going round a corner into a hole a metre deep.
      F.box(ctx, fe, 0, soffit / 2, e.gap, soffit, jp * 0.62, P.shadow);

      // ---- D. THE FEW SLITS AN UNMORTARED WALL CAN CARRY ----------
      for (const f of F.faces(ctx)) {
        const ns = Math.max(1, Math.round(f.span / clamp(unit * 0.55, 3.0, 6.0)));
        for (let i = 0; i < ns; i++) {
          const t = -f.span / 2 + (i + 0.5) * (f.span / ns);
          if (!F.clearsDoor(ctx, f, t, 1.8)) continue;
          if (h(0x7d80 + f.s * 13 + i) < 0.42) continue;    // most of the wall is blind
          const y = rTop * (0.40 + h(0x7d90 + f.s * 7 + i) * 0.24);
          const sh = clamp(FH * 0.30, 0.5, 1.0), sw = clamp(unit * 0.024, 0.16, 0.32);
          const p = drum(t, f.span, y);
          F.box(ctx, f, t, y, sw, sh, p + 0.06, P.glass);                        // the slot itself
          F.box(ctx, f, t, y + sh / 2 + 0.16, sw * 5.5, 0.28, p + 0.15, P.light); // its lintel stone
        }
      }
    },
  });
})();
