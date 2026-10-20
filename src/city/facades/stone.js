/* ============================================================
   city/facades/stone.js — "Ashlar Bank": the Beaux-Arts commercial palace,
   c. 1895-1930 (the bank, the exchange, the head office).

   REFERENCES:
     Bank of Nova Scotia, Moose Jaw (rusticated granite base, limestone
       entrance, entablature with dentils)
       http://moosejaw.ca/heritage_properties/bank-of-nova-scotia/
     Pioneer Trust & Savings Bank, Chicago landmark report (giant order,
       continuous architrave + frieze, dentilled cornice)
       https://www.chicago.gov/content/dam/city/depts/zlup/Historic_Preservation/Publications/Pioneer_Trust_Savings_Bank_Bldg.pdf
     West Loop-LaSalle Street NR nomination (the LaSalle St. bank palaces:
       two-storey rusticated base, plain shaft, attic over a cornice)
       https://www.chicago.gov/content/dam/city/depts/zlup/Historic_Preservation/Publications/WestLoopLaSalleHD_NR_nom_WO_photos_and_map_FINAL.pdf
     Ontario Architecture, "Beaux Arts"
       https://www.ontarioarchitecture.com/Beauxarts.htm

   THE NUMBERS.
     tripartite   BASE (1 storey, 2 on 6+) rusticated: courses ~0.5 m tall
                  standing 0.14 m proud with 0.06 m channel joints between;
                  SHAFT of smooth ashlar; a CORNICE 0.9-1.6 m tall
                  projecting 0.75-0.95 m with modillions (dentils on a small
                  building); a BALUSTRADE over it (0.9 m, 0.15 m balusters
                  at 0.3 m centres, pedestals at the bay lines).
     windows      1.25-1.45 m wide in 3.2-3.6 m bays (shaft), in plain
                  ashlar reveals; the PIANO NOBILE (first floor over the
                  base) gets a full architrave (0.16 m, 0.08 m proud) and
                  heads alternating triangular pediment / cornice hood; the
                  top storey gets plain architraves with keystones.
     order        flat pilasters 0.7 m wide, 0.18 m proud, on the entrance
                  face from the base to the cornice — merged boxes, not
                  cylinders (a real round column is a mesh and a draw call).
     quoins       long and short alternate blocks at every corner, 0.1 m
                  proud, two per storey.
     entrance     a stone landing 1.2 m deep and 0.16 m up (a walk
                  platform), a doorcase with a cornice hood on consoles.
     colour       Indiana limestone 0xc9c0a8 off the street colour, a paler
                  dressing tone, a granite base on some (seeded).

   VARIATION BY SEED: banking-hall base (tall rusticated base with keystoned
   openings) or a commercial palace with an F.storefront on the door face;
   granite or limestone base; pediment phase; modillion or dentil cornice.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  CBZ.registerFacade("stone", {
    label: "Ashlar Bank",
    // WHAT IT IS MADE OF (city/collapse.js MATERIALS) — an ashlar bank is exactly what it says.
    structure: "stone",
    crownsRoof: true,
    window: "civic",
    build: function (ctx, F, spec) {
      const FH = ctx.FH, H = ctx.rTop, ST = Math.max(1, ctx.storeys | 0);
      const grid = !!ctx.grid;
      const df = F.face(ctx, ctx.doorSide);

      // ---- palette ----------------------------------------------------
      const LIME = F.mix(ctx.color, 0xc9c0a8, 0.55);
      const PALE = F.mix(LIME, 0xe8e2d2, 0.35);       // dressings catch the light
      const JOINT = F.shade(LIME, 0.66);              // the rustication channel
      const granite = ctx.hash(0x5702) < 0.35;
      const BASEC = granite ? F.mix(0x8d8f8e, ctx.color, 0.15) : F.shade(LIME, 0.93);
      const pedPhase = ctx.hash(0x5701) < 0.5 ? 0 : 1;
      const shopFront = ST >= 2 && ctx.hash(0x5703) < 0.5;
      F.windowFrame(ctx, [0x3a3428, 0x2c3238, 0x4a3b2a][(ctx.hash(0x5704) * 3) | 0]);

      // ---- the tripartite split ----------------------------------------
      const nBase = ST >= 6 ? 2 : 1;
      const yBase = ST >= 2 ? nBase * FH : 0;         // top of rustication
      const CORN = Math.max(0.9, Math.min(1.6, FH * 0.38 + ST * 0.02));
      const cornY = H - CORN * 0.7;                   // the cornice's foot
      const SKIN = 0.07, RUST = 0.14;
      const BAY = 3.4, WIN = 1.35;
      const plan = [];

      // ============================================================
      //  1. THE WALL — per face: base courses, shaft skin, windows
      // ============================================================
      for (const f of F.faces(ctx)) {
        const n = F.bayCount(f, BAY, 2, 16);
        const margin = Math.max(0.9, Math.min(1.5, f.span * 0.07));   // room for the quoins
        const bays = F.bays(f, n, margin);
        const step = bays.length ? bays[0].w : f.span;
        const ww = Math.min(WIN, step * 0.5);
        const isDoor = f.s === ctx.doorSide;
        const sf = isDoor && shopFront;
        plan.push({ f: f, bays: bays, ww: ww, lines: F.bayLines(f, n, margin) });

        // the openings of the BASE: tall, keystoned, one per bay
        const baseHoles = [];
        if (yBase > 0) {
          for (let k = sf ? 1 : 0; k < nBase; k++) {
            const S = F.storey(ctx, k, 0.75);
            for (const b of bays) {
              if (k === 0 && !F.clearsDoor(ctx, f, b.t, ww + 0.8)) continue;
              baseHoles.push({ t0: b.t - ww / 2, t1: b.t + ww / 2, y0: S.sill, y1: S.head, k: k });
            }
          }
        }
        // ---- the rustication: courses with channel joints --------------
        if (yBase > 0) {
          const y0 = sf ? (FH + 0.7) : 0;
          if (yBase - y0 > 0.4) {
            const nc = Math.max(2, Math.round((yBase - y0) / 0.52));
            const ch = (yBase - y0) / nc;
            F.cladAround(ctx, f, y0, yBase, baseHoles, SKIN, JOINT);
            for (let c = 0; c < nc; c++) {
              const ya = y0 + c * ch + 0.03, yb = y0 + (c + 1) * ch - 0.03;
              const hs = baseHoles.filter((h) => h.y1 > ya && h.y0 < yb);
              F.cladAround(ctx, f, ya, yb, hs, RUST, BASEC, { over: RUST });
            }
            // voussoirs + keystone over each base opening
            for (const h of baseHoles) {
              F.box(ctx, f, (h.t0 + h.t1) / 2, h.y1 + 0.22, h.t1 - h.t0 + 0.5, 0.44, RUST + 0.02, BASEC);
              F.box(ctx, f, (h.t0 + h.t1) / 2, h.y1 + 0.26, 0.32, 0.56, RUST + 0.08, PALE);
              F.box(ctx, f, (h.t0 + h.t1) / 2, h.y0 - 0.07, h.t1 - h.t0 + 0.3, 0.14, RUST + 0.06, PALE);
            }
          }
          // the base's crowning band: a plain course with a moulded lip
          F.ring(ctx, yBase - 0.12, 0.24, RUST + 0.06, PALE, RUST + 0.06);
        }

        // ---- the shaft: smooth ashlar between the openings ------------
        const s0 = Math.max(yBase, 0);
        const k0 = yBase > 0 ? nBase : 0;
        if (!grid && cornY - s0 > 0.5) {
          let a = -f.span / 2 - SKIN;
          const cut = [];
          for (const b of bays) cut.push([b.t - ww / 2, b.t + ww / 2]);
          for (const c of cut) {
            if (c[0] - a > 0.02) F.box(ctx, f, (a + c[0]) / 2, (s0 + cornY) / 2, c[0] - a, cornY - s0, SKIN, LIME);
            a = c[1];
          }
          if (f.span / 2 + SKIN - a > 0.02) F.box(ctx, f, (a + f.span / 2 + SKIN) / 2, (s0 + cornY) / 2, f.span / 2 + SKIN - a, cornY - s0, SKIN, LIME);
          let prev = s0;
          for (let k = k0; k < ST; k++) {
            const S = F.storey(ctx, k);
            // the door face's first storey over a storefront: the wall starts
            // over the signband
            if (k === k0 && sf && S.sill < FH + 0.75) continue;
            if (S.sill - prev > 0.02) F.band(ctx, f, (prev + S.sill) / 2, S.sill - prev, SKIN, LIME, SKIN * 2);
            prev = S.head;
          }
          if (cornY - prev > 0.02) F.band(ctx, f, (prev + cornY) / 2, cornY - prev, SKIN, LIME, SKIN * 2);
        }

        // ---- window dressings: piano nobile + top storey + sills -------
        for (let k = k0; k < ST; k++) {
          const S = F.storey(ctx, k);
          if (k === k0 && sf && S.sill < FH + 0.75) continue;
          const nobile = k === k0 && ST >= 3;
          const top = k === ST - 1 && ST >= 4;
          if (nobile || top) {
            bays.forEach((b, i) => {
              const head = nobile ? ((i + pedPhase) % 2 ? "pediment" : "cornice") : "key";
              F.surround(ctx, f, b.t - ww / 2, b.t + ww / 2, S.sill, S.head, { col: PALE, w: 0.16, proj: SKIN + 0.08,
                head: head, headH: 0.24, keyCol: PALE, sill: { h: 0.12, proj: SKIN + 0.12, over: 0.24, col: PALE } });
            });
          } else {
            // a continuous sill course: one box per storey per face
            F.band(ctx, f, S.sill - 0.06, 0.12, SKIN + 0.07, PALE, 0.2);
          }
        }
      }

      // ---- quoins: long and short, base top to cornice ----------------
      {
        const q0 = Math.max(yBase, 0), q1 = cornY;
        const nq = Math.max(2, Math.round((q1 - q0) / (FH / 2)));
        const qh = (q1 - q0) / nq;
        for (let i = 0; i < nq; i++) {
          const long = i % 2 === 0;
          F.corners(ctx, q0 + (i + 0.5) * qh, qh - 0.06, long ? 1.1 : 0.7, SKIN + 0.08, PALE);
        }
      }

      // ============================================================
      //  2. THE ENTRANCE FACE: pilaster order, storefront or doorcase
      // ============================================================
      if (shopFront) {
        F.storefront(ctx, df, { frame: [0x2a2620, 0x3a2e24, 0x2d3b33][(ctx.hash(0x5705) * 3) | 0],
          pierCol: BASEC, cornCol: PALE, sign: F.shade(PALE, 0.55), bayW: 2.6 });
      } else if (!grid) {
        // a doorcase: pilaster strips, a frieze and a cornice hood on consoles
        const W = (ctx.doorW || F.DOOR_W) + 0.5, top = Math.min(FH - 0.2, (ctx.doorH || F.DOOR_H) + 0.35);
        for (const sg of [-1, 1]) F.rib(ctx, df, sg * (W / 2 + 0.14), 0.16, top, 0.28, RUST + 0.1, PALE);
        F.box(ctx, df, 0, top + 0.18, W + 0.7, 0.36, RUST + 0.1, PALE);
        F.box(ctx, df, 0, top + 0.42, W + 1.0, 0.14, RUST + 0.32, PALE);
        for (const sg of [-1, 1]) F.box(ctx, df, sg * (W / 2 + 0.3), top + 0.14, 0.16, 0.4, RUST + 0.26, F.shade(PALE, 0.92));
      }
      // THE LANDING: one broad stone step, a real walk surface, never past
      // 1.2 m off the wall (the old terrace and flight stood 4.1 m into
      // the street)
      if (!grid && df.span > 6) {
        const LW = Math.min(df.span * 0.42, 6.5), LD = 1.2, TOP = 0.16;
        F.box(ctx, df, 0, TOP / 2, LW, TOP, LD, F.shade(BASEC, 0.95));
        const n0 = df.halfN, n1 = df.halfN + LD;
        if (df.horiz) {
          const za = df.out * n0, zb = df.out * n1;
          ctx.plat(-LW / 2, LW / 2, Math.min(za, zb), Math.max(za, zb), TOP, null);
        } else {
          const xa = df.out * n0, xb = df.out * n1;
          ctx.plat(Math.min(xa, xb), Math.max(xa, xb), -LW / 2, LW / 2, TOP, null);
        }
      }
      // the order: flat pilasters on the bay lines of the entrance face
      if (ST >= 3) {
        const p = plan[ctx.doorSide] || plan.find((q) => q.f.s === ctx.doorSide);
        const y0 = Math.max(yBase, FH), y1 = cornY;
        if (p && y1 - y0 > FH * 1.2) {
          for (const t of p.lines.slice(1, -1)) {
            F.rib(ctx, df, t, y0 + 0.4, y1 - 0.36, 0.62, SKIN + 0.16, PALE);
            F.box(ctx, df, t, y0 + 0.2, 0.86, 0.4, SKIN + 0.2, PALE);       // pedestal
            F.box(ctx, df, t, y1 - 0.22, 0.84, 0.3, SKIN + 0.22, PALE);     // capital
            F.box(ctx, df, t, y1 - 0.42, 0.7, 0.1, SKIN + 0.19, F.shade(PALE, 0.9));   // necking
          }
        }
      }

      // ============================================================
      //  3. CORNICE + BALUSTRADE
      // ============================================================
      F.cornice(ctx, cornY, { h: CORN, proj: Math.min(0.95, 0.6 + CORN * 0.22), col: PALE,
        dark: F.shade(LIME, 0.6), frieze: CORN * 0.38, friezeCol: LIME, friezeProj: SKIN + 0.04,
        teeth: CORN > 1.1 ? "modillion" : "dentil" });
      {
        const BH = 0.9, y = H + CORN * 0.3;           // over the cornice top
        for (const f of F.faces(ctx)) {
          const inset = -0.12;
          F.box(ctx, f, 0, y + 0.1, f.span + 0.1, 0.2, 0.3, PALE, inset);             // plinth
          F.box(ctx, f, 0, y + BH - 0.07, f.span + 0.16, 0.14, 0.36, PALE, inset);    // rail
          const nb = Math.max(6, Math.round(f.span / 0.32));
          F.merlons(ctx, f, y + BH / 2, nb, 0.14, BH - 0.34, 0.16, LIME);
          const p = plan[f.s];
          if (p) for (const t of p.lines) F.box(ctx, f, t, y + BH / 2 + 0.05, 0.42, BH + 0.1, 0.36, PALE, inset);
        }
      }
    },
  });
})();
