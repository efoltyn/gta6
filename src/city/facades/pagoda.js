/* ============================================================
   city/facades/pagoda.js — "Tiered Eaves": the East Asian timber frame,
   a tiered hall / pagoda dressed on the host shell.

   REFERENCES
     Pagoda — "a tower-like structure with regularly diminishing
       proportions", each storey with its own projecting roof, capped by a
       mast and rings (the sorin).  https://www.britannica.com/technology/pagoda
     Dougong — interlocking bracket sets carrying the eave out past the
       wall.  https://www.britannica.com/topic/dougong
       https://en.wikipedia.org/wiki/Dougong
     Eaves — "an overhang to throw water clear of the walls ... highly
       decorated ... dougong".  https://en.wikipedia.org/wiki/Eaves
     Horyu-ji five-storey pagoda: successive tiers ~0.8-0.9 of the one below.

   THE PROPORTIONS USED (metres)
     podium        a stone platform 0.40 m high (walkable, < STEP_UP),
                   standing 0.6 m out all round, registered as walk ground
     frame         vermilion (or dark-stained) posts 0.3 m wide on a ~3 m
                   bay, 0.2 m proud, white plaster infill between them
     windows       one lattice window per bay, 1.4 m wide, sill 0.8 m, head
                   kept 0.95 m under the next eave (the brackets need it)
     brackets      two receding tiers of dougong blocks (0.28 / 0.36 m) on a
                   0.9 m pitch under every eave
     eaves         one per storey (every 2nd/3rd on a tall host, at most 9),
                   depth 0.85 m at the bottom tier diminishing by 0.88 per
                   tier (>= 0.45 m), stepped fascia -> tile skirt rising back
                   to the wall, and upturned corners (the reach limit keeps
                   flank pieces under 1.0 m; the real thing oversails ~1/3 of
                   the tier, which a box city cannot give it)
     roof          a hipped roof in five stepped courses over the whole plan
                   (+0.7 m oversail), ridge with end ornaments, and a sorin:
                   a bronze mast with nine rings and a jewel
     gate          an entrance porch on two posts 1.0 m out, its own small
                   roof over the door

   PALETTES (by seed): Chinese vermilion + grey tile; Japanese dark timber +
   grey tile; Chinese vermilion + green glazed tile with ochre trim.

   COST: dbox for everything but the two porch posts and the sorin
   (~6 round meshes, was 16).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // the skin of a regular window grid: strips between the columns, bands
  // between the rows (what F.cladAround lays, in cols + rows boxes)
  function gridClad(ctx, F, f, cols, rows, yA, yB, proj, col) {
    if (ctx.grid || !(yB - yA > 0.02)) return;
    const ed = [-f.span / 2 - proj];
    for (const c of cols) ed.push(c[0], c[1]);
    ed.push(f.span / 2 + proj);
    for (let i = 0; i < ed.length; i += 2) if (ed[i + 1] - ed[i] > 0.02) F.box(ctx, f, (ed[i] + ed[i + 1]) / 2, (yA + yB) / 2, ed[i + 1] - ed[i], yB - yA, proj, col);
    const ys = [yA];
    for (const r of rows) ys.push(r[0], r[1]);
    ys.push(yB);
    for (let i = 0; i < ys.length; i += 2) if (ys[i + 1] - ys[i] > 0.02) F.box(ctx, f, 0, (ys[i] + ys[i + 1]) / 2, f.span + proj * 2, ys[i + 1] - ys[i], proj, col);
  }

  const PALS = [
    { timber: 0xa63a2a, plaster: 0xe8e2d4, tile: 0x43474b, trim: 0xc9a24a, stone: 0x8e8a80, frame: 0x5a2a20 },
    { timber: 0x4a3426, plaster: 0xe6e0d0, tile: 0x383c40, trim: 0xb59a5a, stone: 0x86827a, frame: 0x2e221a },
    { timber: 0xa8402c, plaster: 0xeae3cf, tile: 0x456c52, trim: 0xd0a43c, stone: 0x928c80, frame: 0x5a2a20 },
  ];

  CBZ.registerFacade("pagoda", {
    label: "Tiered Eaves",
    // WHAT IT IS MADE OF (city/collapse.js MATERIALS) — a pagoda is interlocking timber with no nails.
    structure: "timber",
    crownsRoof: true,
    // the lattice: a mullion pair, a transom, a grid of small lights
    window: "lancet",
    build: function (ctx, F, spec) {
      const FH = ctx.FH, ST = Math.max(1, ctx.storeys | 0), H = ctx.rTop;
      const w = ctx.w, d = ctx.d;
      const P0 = PALS[(ctx.hash(0x6a01) * PALS.length) | 0];
      const TIM = P0.timber, TIM_D = F.shade(TIM, 0.72), PL = F.mix(P0.plaster, ctx.color, 0.06);
      const TILE = P0.tile, TILE_L = F.shade(TILE, 1.18), TRIM = P0.trim, STONE = P0.stone;
      F.windowFrame(ctx, P0.frame);
      const ent = F.entrance(ctx);

      // ---- 1. THE PODIUM: a stone platform you walk on ------------------
      {
        const T = 0.40, O = 0.6;
        const hw = w / 2, hd = d / 2;
        const rects = [
          [-hw - O, hw + O, -hd - O, -hd], [-hw - O, hw + O, hd, hd + O],
          [-hw - O, -hw, -hd, hd], [hw, hw + O, -hd, hd],
        ];
        for (const r of rects) {
          ctx.dbox((r[0] + r[1]) / 2, T / 2, (r[2] + r[3]) / 2, r[1] - r[0], T, r[3] - r[2], STONE);
          ctx.plat(r[0], r[1], r[2], r[3], T, null);
        }
        F.ring(ctx, T + 0.03, 0.06, O + 0.02, F.shade(STONE, 1.12), O + 0.02);
      }

      // ---- 2. EAVE SCHEDULE --------------------------------------------
      const every = Math.max(1, Math.ceil(ST / 9));
      const eaveAt = [];                         // storey index whose TOP carries an eave
      for (let k = every - 1; k < ST - 1; k += every) eaveAt.push(k);
      const depthOf = (i) => Math.max(0.45, 0.85 * Math.pow(0.88, i));

      // ---- 3. THE FRAME: posts, plaster, lattice windows ----------------
      for (const f of F.faces(ctx)) {
        const n = F.bayCount(f, 3.0, 2, 16);
        const lines = F.bayLines(f, n, 0.5);
        const bays = F.bays(f, n, 0.5);
        const ww = Math.min(1.4, (bays.length ? bays[0].w : f.span) - 0.9);
        const holes = [];
        for (let k = 0; k < ST; k++) {
          const S = F.storey(ctx, k, 0.8);
          const eaved = eaveAt.indexOf(k) >= 0 || k === ST - 1;
          const head = eaved ? Math.min(S.head, S.top - 0.95) : S.head;
          if (head - S.sill < 0.8 || ww < 0.6) continue;
          for (const r of F.openRow(ctx, f, n, ww, 0.5, k)) holes.push({ t0: r.t0, t1: r.t1, y0: S.sill, y1: head });
        }
        // the ground storey round its own openings (the door is there), the
        // storeys above as one regular grid skin
        F.cladAround(ctx, f, 0.4, Math.min(H, FH), holes.filter((h) => h.y1 <= FH), 0.05, PL);
        if (ST > 1) {
          const cols = [], rows = [];
          for (const h of holes) {
            if (h.y1 <= FH) continue;
            if (!cols.some((c) => Math.abs(c[0] - h.t0) < 0.01)) cols.push([h.t0, h.t1]);
            if (!rows.some((r) => Math.abs(r[0] - h.y0) < 0.01)) rows.push([h.y0, h.y1]);
          }
          cols.sort((a, b) => a[0] - b[0]); rows.sort((a, b) => a[0] - b[0]);
          gridClad(ctx, F, f, cols, rows, FH, H, 0.05, PL);
        }
        // posts on every bay line, full height (the frame IS the structure)
        for (const t of lines) {
          if (!F.clearsDoor(ctx, f, t, 0.3)) { F.rib(ctx, f, t, ent.head + 0.3, H, 0.3, 0.2, TIM); continue; }
          F.rib(ctx, f, t, 0.4, H, 0.3, 0.2, TIM);
        }
        // a head beam and a sill rail at every storey
        for (let k = 0; k < ST; k++) {
          F.band(ctx, f, (k + 1) * FH - 0.5, 0.22, 0.24, TIM, 0.24);
        }
        // the window casings, in the timber
        for (const h of holes) F.surround(ctx, f, h.t0, h.t1, h.y0, h.y1, { w: 0.08, proj: 0.12, col: TIM_D, head: "flat", headH: 0.1, sill: { h: 0.08, proj: 0.14, over: 0.08, col: TIM_D } });
      }

      // ---- 4. THE EAVES ------------------------------------------------------
      const eave = function (y, D, i) {
        // dougong: two receding tiers of blocks on a 0.9 m pitch
        for (const f of F.faces(ctx)) {
          const nb = Math.max(4, Math.round(f.span / 0.9));
          F.merlons(ctx, f, y - 0.42, nb, 0.26, 0.2, D * 0.32, TIM);
          F.merlons(ctx, f, y - 0.22, nb, 0.34, 0.2, D * 0.55, TRIM);
        }
        // the eave: fascia, tile lip, then a skirt of tile rising back to the wall
        F.ring(ctx, y - 0.04, 0.16, D * 0.82, TIM_D, D * 0.82);
        F.ring(ctx, y + 0.1, 0.14, D, TILE, D);
        for (let s = 0; s < 3; s++) {
          const u = (s + 1) / 4;
          F.ring(ctx, y + 0.17 + s * 0.13, 0.13, D * (1 - u), s % 2 ? TILE : TILE_L, D * (1 - u));
        }
        // upturned corners: two blocks stepping out along the diagonal and up
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          for (let c = 0; c < 2; c++) {
            const o = D * (0.6 + c * 0.28), lift = 0.1 + c * 0.16;
            ctx.dbox(sx * (w / 2 + o * 0.7), y + 0.12 + lift, sz * (d / 2 + o * 0.7), 0.42, 0.14, 0.42, c ? TRIM : TILE);
          }
        }
      };
      eaveAt.forEach(function (k, i) { eave((k + 1) * FH - 0.28, depthOf(i), i); });

      // ---- 5. THE ROOF + SORIN ---------------------------------------------
      {
        const R = F.roof(ctx);
        const Dt = depthOf(eaveAt.length);
        eave(H + 0.02, Dt, eaveAt.length);
        const rh = clamp(Math.min(w, d) * 0.3, 1.5, 8);
        const top = F.ziggurat(ctx, 0, 0, H + 0.6, w + Dt * 0.6, d + Dt * 0.6, rh, 5, TILE, 0.72, 0.03);
        // the ridge along the long axis, with an ornament at each end
        const long = w >= d, rl = (long ? w : d) * 0.72 * Math.pow(0.72, 4) + 1.2;
        ctx.dbox(0, top + 0.12, 0, long ? rl : 0.3, 0.24, long ? 0.3 : rl, TILE_L);
        for (const sg of [-1, 1]) ctx.dbox(long ? sg * rl / 2 : 0, top + 0.42, long ? 0 : sg * rl / 2, 0.3, 0.6, 0.3, TRIM);
        // the sorin: base jewel, mast, nine rings, a flame jewel
        const mh = clamp(rh * 1.3, 3, 12), mr = clamp(mh * 0.018, 0.08, 0.22);
        ctx.ball(0, top + 0.35, 0, mr * 3, TRIM);
        ctx.column(0, top + 0.3, 0, mr, mh, TRIM, 8);
        for (let j = 0; j < 9; j++) {
          const ry = top + 0.6 + mh * 0.18 + j * (mh * 0.55 / 9);
          const rr = mr * (3.4 - j * 0.12);
          ctx.dbox(0, ry, 0, rr * 2, 0.08, rr * 2, TRIM);
        }
        ctx.ball(0, top + 0.3 + mh + mr * 1.6, 0, mr * 2, TRIM);
        void R;
      }

      // ---- 6. THE GATE PORCH -------------------------------------------------
      if (!ent.driveIn) {
        const f = ent.f, out = 1.0, hw = 1.6;
        const ph = Math.min(FH - 0.35, 2.95);
        for (const sg of [-1, 1]) {
          const nC = f.halfN + out;
          const x = f.horiz ? sg * hw : f.out * nC, z = f.horiz ? f.out * nC : sg * hw;
          ctx.column(x, 0.4, z, 0.14, ph - 0.4, TIM, 10);
        }
        F.box(ctx, f, 0, ph + 0.08, hw * 2 + 0.6, 0.18, out + 0.12, TIM);
        F.box(ctx, f, 0, ph + 0.26, hw * 2 + 0.9, 0.16, out + 0.2, TILE);
        F.box(ctx, f, 0, ph + 0.4, hw * 2 + 0.5, 0.14, out, TILE_L);
        F.box(ctx, f, 0, ph + 0.52, hw * 2 - 0.2, 0.12, out * 0.6, TILE);
      }
    },
  });
})();
