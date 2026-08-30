/* ============================================================
   city/facades/sahelian.js — "Sahelian Mudbrick": Djenné / Agadez.

   THE READ, AND THE ONE FACADE IT MUST NOT BE MISTAKEN FOR. adobe.js is
   already earthen mass construction, so this file's whole job is to be a
   DIFFERENT CULTURE built out of the same mud. Pueblo is STEPPED and
   HORIZONTAL — terraces, ladders, a long low parapet. Sudano-Sahelian is
   VERTICAL and BRISTLING, and it is unmistakable because of exactly two
   things, both of which this file spends its whole budget on:

     1. ENGAGED BUTTRESS PIERS at close spacing on EVERY face, running the
        full height of the wall and NOT STOPPING at the roofline: each one
        carries on past the parapet and tapers into a CONE FINIAL. From 200 m
        the building is a black comb — a row of spikes against the sky, which
        is a silhouette nothing else in the kit makes. The piers batter as
        they rise (each of K lifts is narrower and less proud than the one
        below) because a mud pier that did not would have fallen down.

     2. TORON — the palm-wood beams left projecting from the wall in a regular
        grid over the whole elevation. They are permanent scaffolding: Djenné
        is re-plastered every year and the town climbs the building on them.
        They are also the instantly recognisable feature, so the grid runs on
        its own rhythm across the entire face, right through the piers, the
        way it actually does. Each beam is two crossed merged boxes, which
        reads round at any distance a player stands and costs nothing.

   THE MASS is F.batter — a mud wall is laid thick at the foot and thinned as
   it rises — and every projection on the building (pier root, beam root,
   finial base) measures off bat.projAt(y), so the whole facade re-proportions
   with w, d and storeys instead of being pinned to constants.

   OSTRICH EGGS on the tallest spikes: the corner piers get a real ball, which
   is the one place a mesh is worth minting here (eight of them, asked for
   through F.mesh so the budget can refuse). Everything else is merged boxes.

   WALL MODE "own": Djenné has essentially no glazing. The shell hands over a
   solid wall and the only openings are the small dark slits an earthen wall
   can actually carry, most of them blind.

   SOLIDITY: the pier lifts and the batter courses are the load-bearing mass a
   player runs into, so they go through F.sBox/F.sRib. The toron, the parapet
   and the finials are up in the air or moulding-sized and stay free — sbox
   would drop their colliders anyway.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  CBZ.registerFacade("sahelian", {
    label: "Sahelian Mudbrick",
    era: "africa",
    // city/collapse.js MATERIALS — puddled banco over a palm-beam armature,
    // no frame at all. It crumbles; it does not pancake.
    structure: "adobe",
    wall: "own",
    crownsRoof: true,
    build: function (ctx, F, spec) {
      spec = spec || {};
      const FH = ctx.FH, rTop = ctx.rTop, unit = Math.min(ctx.w, ctx.d);
      const h = function (s) { return ctx.hash(s); };
      const P = F.palette(ctx, "mud", { pull: 0.94, grain: 0.26 });
      const beam = F.mix(P.trim, 0x2a2118, 0.42);        // weathered palm timber

      // ---- A. THE BATTERED MUD MASS -------------------------------
      // No corner buttresses: those are adobe.js's move, and here the whole
      // wall is buttressed by the pier run instead.
      const bat = F.batter(ctx, { pal: P, buttress: false,
        n: clamp(ctx.storeys + 1, 3, 6), total: clamp(unit * 0.085, 0.5, 1.35) });

      // ---- B. THE PIERS AND THEIR CONE FINIALS --------------------
      const pProj = clamp(unit * 0.045, 0.34, 0.85);
      const K = clamp(Math.round(rTop / 2.0), 3, 7);      // batter lifts per pier
      const parH = clamp(FH * 0.20, 0.38, 0.80);          // parapet between piers
      const spike = clamp(FH * 0.52, 0.85, 2.30);
      const tips = [];                                    // corner spikes → eggs
      for (const f of F.faces(ctx)) {
        const n = Math.max(3, Math.round(f.span / clamp(FH * 0.70, 1.65, 2.70)));
        const lines = F.bayLines(f, n, clamp(f.span * 0.045, 0.25, 0.70));
        const pw = clamp((f.span / n) * 0.34, 0.42, 1.10);
        for (let i = 0; i < lines.length; i++) {
          const t = lines[i];
          const jit = 0.90 + h(0x5a10 + f.s * 31 + i) * 0.20;   // hand-laid, not milled
          for (let k = 0; k < K; k++) {
            const u = k / K;
            F.sRib(ctx, f, t, k * rTop / K, (k + 1) * rTop / K, pw * (1 - u * 0.26),
              bat.projAt(k * rTop / K + 0.2) + pProj * (1 - u * 0.42) * jit, P.course(k * 3 + f.s));
          }
          // the pier's upstand through the parapet, then the taper into a cone
          const root = bat.projAt(rTop - 0.3) + pProj * 0.58 * jit;
          const end = (i === 0 || i === lines.length - 1);
          F.box(ctx, f, t, rTop + parH * 0.62, pw * 0.90, parH * 1.24, root, P.light);
          const SH = spike * (end ? 1.40 : 0.82) * (0.88 + h(0x5a40 + f.s * 17 + i) * 0.24);
          for (let k = 0; k < 6; k++) {
            const u = (k + 0.5) / 6, sc = 1 - u * 0.88;
            F.box(ctx, f, t, rTop + parH * 1.24 + SH * u, pw * 0.74 * sc + 0.06,
              SH / 6 + 0.02, root * sc + 0.06, k % 2 ? P.base : P.light);
          }
          if (end) tips.push([f, t, rTop + parH * 1.24 + SH + 0.10, root * 0.14]);
        }
        // the low mud parapet the spikes rise out of
        F.band(ctx, f, rTop + parH * 0.5, parH, bat.projAt(rTop) + 0.10, P.course(f.s + 40), 0.2, 0);
      }

      // ---- C. THE TORON GRID --------------------------------------
      // Its own rhythm, deliberately not the piers': the beams run right
      // through them, which is what the real wall does and what stops the
      // elevation reading as tidy columns of dots between tidy columns.
      const tr = clamp(unit * 0.020, 0.085, 0.155);
      const tl = clamp(FH * 0.34, 0.55, 1.05);
      const rows = Math.max(3, Math.round(rTop / clamp(FH * 0.46, 1.10, 1.70)));
      for (const f of F.faces(ctx)) {
        const cn = Math.max(4, Math.round(f.span / clamp(unit * 0.090, 1.15, 1.75)));
        for (let r = 0; r < rows; r++) {
          const y = (r + 0.75) * (rTop / (rows + 0.45));
          if (y > rTop - 0.30) continue;
          const root = bat.projAt(y);
          for (let i = 0; i < cn; i++) {
            const s = 0x5a60 + f.s * 29 + r * 7 + i;
            const t = -f.span / 2 + (i + 0.5) * (f.span / cn);
            const L = tl * (0.70 + h(s) * 0.58);                 // ragged, unsawn ends
            const col = F.shade(beam, 0.86 + h(s + 1) * 0.28);
            F.box(ctx, f, t, y, tr * 2.00, tr * 1.05, L, col, root);
            F.box(ctx, f, t, y, tr * 1.05, tr * 2.00, L, col, root);
          }
        }
      }

      // ---- D. THE FEW OPENINGS AN EARTHEN WALL CAN CARRY ----------
      F.openingGrid(ctx, { pal: P, shape: "slit", blind: 0.52, hi: 4,
        hFrac: 0.30, wFrac: 0.11, sillFrac: 0.48, lintel: false, sillOut: false });

      // the flat mud roof behind the parapet, walkable
      const R = F.roof(ctx);
      ctx.dbox(R.cx, rTop + ctx.pp * 0.5, R.cz, R.w, Math.max(0.06, ctx.pp), R.d, F.shade(P.base, 0.90));
      ctx.plat(R.cx - R.w / 2, R.cx + R.w / 2, R.cz - R.d / 2, R.cz + R.d / 2, rTop + ctx.pp);

      // ---- E. OSTRICH EGGS on the tallest spikes ------------------
      // Fertility/purity finials, and the only meshes this grammar mints.
      const eggs = F.mesh(ctx, Math.min(tips.length, 8));
      const er = clamp(unit * 0.013, 0.10, 0.20);
      for (let i = 0; i < eggs; i++) {
        const f = tips[i][0], dn = f.halfN + tips[i][3];
        ctx.ball(f.horiz ? tips[i][1] : f.out * dn, tips[i][2] + er,
          f.horiz ? f.out * dn : tips[i][1], er, P.light);
      }
    },
  });
})();
