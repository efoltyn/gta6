/* ============================================================
   city/facades/adobe.js — "Pueblo Adobe": the Pueblo Revival house,
   1905-1940 (Santa Fe, Albuquerque, Phoenix).

   WHAT IT IS (the references: Wikipedia "Pueblo Revival architecture" and
   "Viga (architecture)", historycolorado.org Pueblo Revival,
   periodstylehomes.com American Pueblo, adobepueblo.com "What Is Pueblo
   Revival Architecture?"):
     • THICK, slightly BATTERED earth-coloured stucco walls with SOFT ROUNDED
       CORNERS
     • a FLAT roof behind an IRREGULAR, rounded PARAPET
     • VIGAS: round roof-beam ends projecting from the wall just under the
       parapet
     • CANALES: wooden or tin rain spouts piercing the parapet
     • small, DEEP-SET straight-headed windows under timber lintels, often
       blue / turquoise painted frames or shutters
     • a PORTAL: a porch on round log posts with carved corbels (zapatas)
       carrying a viga roof
     • a kiva LADDER to the roof on some, a beehive / box chimney

   Built with the one carpentry in city/facades/house_parts.js.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  const EARTH = [0xb98a62, 0xc49a72, 0xa87a56, 0xcfa983, 0xb48e6a];
  const TRIM = [0x3f7f86, 0x2f5f8a, 0x5a4030, 0x4a6a5a];
  const VIGA = 0x5a4030;

  CBZ.registerFacade("adobe", {
    label: "Pueblo Adobe",
    structure: "adobe",
    crownsRoof: true,
    ownDoor: true,
    maxStoreys: 4,
    build: function (ctx, F) {
      const HP = CBZ.HOUSE_PARTS;
      if (!HP) return;
      const H = HP.begin(ctx, F);
      const FH = H.FH, ST = H.ST, rTop = H.rTop, df = H.df, S = df.span;
      const earth = H.tint(H.pick(0xad01, EARTH), 0.06), earthD = HP.shade(earth, 0.88), earthL = HP.shade(earth, 1.06);
      const paint = H.pick(0xad02, TRIM);
      const SK = 0.24;                                          // the earth wall's thickness proud of the shell
      const parTop = rTop + H.PP + 0.3;

      H.publish({ body: earth, trim: VIGA, roof: earthD, flat: true });

      // ---- THE OPENINGS: small and deep ----------------------------------------------
      const holes = [];
      const dh = H.doorHole();
      if (dh) holes.push(dh);
      for (const f of H.faces) {
        for (let k = 0; k < ST; k++) {
          const row = H.row(f, k, { per: 3.0, w: 0.9, sill: 0.9, head: 2.2, margin: 1.2 });
          for (const op of row) holes.push(op);
        }
      }

      // ---- THE WALLS: thick, battered, rounded --------------------------------------------
      H.skinAll(1.3, parTop - 0.25, holes, earth, SK);
      H.skinAll(-0.3, 1.1, holes, earthD, SK + 0.1);             // the batter at the foot
      H.skinAll(1.1, 1.3, holes, earthD, SK + 0.05);
      // the parapet: irregular, its tops rounded in two steps, higher at the corners and centre
      for (const f of H.faces) {
        const ext = f.horiz ? SK : 0;
        const segs = [[-f.span / 2 - ext, -f.span / 2 + 1.4, 0.35], [-f.span / 2 + 1.4, -0.9, 0.0], [-0.9, 0.9, 0.2], [0.9, f.span / 2 - 1.4, 0.0], [f.span / 2 - 1.4, f.span / 2 + ext, 0.35]];
        for (const sg of segs) {
          if (sg[1] - sg[0] < 0.1) continue;
          const yt = parTop + sg[2];
          H.fb(f, sg[0], sg[1], parTop - 0.25, yt - 0.12, 0, SK, earth);
          H.fb(f, sg[0] + 0.05, sg[1] - 0.05, yt - 0.12, yt, 0, SK - 0.07, earthL);
        }
      }
      // rounded corners: an earth drum on each one
      if (ctx.column) for (const sx of [-1, 1]) for (const sz of [-1, 1]) ctx.column(sx * (H.W / 2 + SK * 0.25), -0.3, sz * (H.D / 2 + SK * 0.25), SK + 0.18, parTop + 0.2, earth, 10);
      // the flat roof deck
      H.ab(-H.W / 2 + 0.3, H.W / 2 - 0.3, rTop + H.PP - 0.05, rTop + H.PP + 0.05, -H.D / 2 + 0.3, H.D / 2 - 0.3, HP.shade(earth, 0.8));

      // ---- VIGAS and CANALES -------------------------------------------------------------------
      for (const f of H.faces) {
        const n = Math.max(3, Math.round(f.span / 0.75));
        const vy = rTop + H.PP - 0.25;
        for (let i = 0; i <= n; i++) {
          const t = -f.span / 2 + 0.4 + (f.span - 0.8) * i / n;
          if (holes.some(function (h) { return h.s === f.s && h.y1 > vy - 0.4 && Math.abs(t - (h.t0 + h.t1) / 2) < 0.6; })) continue;
          H.fb(f, t - 0.1, t + 0.1, vy - 0.1, vy + 0.1, SK - 0.05, SK + 0.42, VIGA);
          H.fb(f, t - 0.07, t + 0.07, vy - 0.07, vy + 0.07, SK + 0.42, SK + 0.45, HP.shade(VIGA, 1.3));
        }
        for (const t of [-f.span * 0.32, f.span * 0.28]) {
          H.fb(f, t - 0.13, t + 0.13, parTop - 0.42, parTop - 0.28, SK - 0.05, SK + 0.75, VIGA);
          H.fb(f, t - 0.09, t + 0.09, parTop - 0.31, parTop - 0.27, SK + 0.05, SK + 0.75, HP.shade(VIGA, 0.6));
        }
      }

      // ---- WINDOWS: timber lintels, painted shutters on some -------------------------------------
      for (const op of holes) {
        if (op.door) continue;
        const f = op.f;
        H.fb(f, op.t0 - 0.25, op.t1 + 0.25, op.y1 + 0.02, op.y1 + 0.22, SK - 0.04, SK + 0.05, VIGA);
        H.fb(f, op.t0 - 0.05, op.t1 + 0.05, op.y0 - 0.08, op.y0 - 0.02, SK - 0.06, SK + 0.04, earthD);
        if (H.hash(0xad03 + op.k * 3 + op.t) < 0.4) for (const sg of [-1, 1]) {
          const ta = sg < 0 ? op.t0 - 0.03 - (op.t1 - op.t0) / 2 : op.t1 + 0.03;
          H.fb(f, ta, ta + (op.t1 - op.t0) / 2, op.y0, op.y1, SK, SK + 0.04, paint);
        }
      }

      // ---- THE PORTAL: log posts, zapatas, a viga roof --------------------------------------------
      if (!H.noDoor && !H.driveIn && !ctx.grid) {
        const pw = HP.clamp(S * 0.5, 3.6, 7.0), dep = 2.0, t0 = -pw / 2, t1 = pw / 2;
        const beamB = Math.min(FH - 0.4, 2.65);
        H.fb(df, t0, t1, -0.3, H.DECK, 0, dep, 0xa0785a);
        H.platF(df, t0, t1, 0, dep, H.DECK);
        const n = Math.max(2, Math.round(pw / 2.3));
        for (let i = 0; i <= n; i++) {
          const t = t0 + 0.2 + (pw - 0.4) * i / n;
          if (Math.abs(t) < H.doorW / 2 + 0.3) continue;
          H.columnF(df, t, dep - 0.22, H.DECK, 0.13, beamB - H.DECK - 0.2, VIGA, 10);
          H.fb(df, t - 0.4, t + 0.4, beamB - 0.2, beamB, dep - 0.32, dep - 0.12, VIGA);       // the zapata
          H.solidF(df, t - 0.13, t + 0.13, H.DECK, beamB, dep - 0.35, dep - 0.09);
        }
        H.fb(df, t0 - 0.1, t1 + 0.1, beamB, beamB + 0.26, dep - 0.36, dep - 0.08, VIGA);
        for (let t = t0; t <= t1 + 0.01; t += 0.6) H.fb(df, t - 0.08, t + 0.08, beamB + 0.26, beamB + 0.42, -0.05, dep + 0.3, VIGA);
        H.fb(df, t0 - 0.15, t1 + 0.15, beamB + 0.42, beamB + 0.6, -0.05, dep + 0.12, earth);
        H.fb(df, t0 - 0.15, t1 + 0.15, beamB + 0.6, beamB + 0.82, dep - 0.08, dep + 0.12, earthL);
      }

      // ---- A KIVA LADDER to the roof, and a box chimney ---------------------------------------------
      if (!ctx.grid) {
        const lf = H.face(df.horiz ? 3 : 1), lt = -lf.span * 0.25, ly1 = parTop + 1.3;
        for (const sg of [-1, 1]) H.fb(lf, lt + sg * 0.3 - 0.05, lt + sg * 0.3 + 0.05, 0.0, ly1, SK + 0.35, SK + 0.45, VIGA);
        for (let y = 0.35; y < ly1 - 0.4; y += 0.35) H.fb(lf, lt - 0.3, lt + 0.3, y, y + 0.05, SK + 0.37, SK + 0.43, VIGA);
        const cp = H.pt(H.face(df.horiz ? 2 : 0), 0.8, -1.0);
        H.chimney({ x: cp.x, z: cp.z, w: 0.8, dp: 0.8, top: parTop + 1.2, brick: earth, cap: earthL, pot: earthD, pots: 1, y0: rTop });
      }

      // ---- THE ENTRANCE: a plank door in a deep reveal under a viga lintel ---------------------------
      H.doorColour(H.hash(0xad04) < 0.5 ? paint : VIGA);
      if (!H.noDoor && !H.driveIn) H.fb(df, -H.doorW / 2 - 0.3, H.doorW / 2 + 0.3, H.doorH + 0.03, H.doorH + 0.28, SK - 0.04, SK + 0.06, VIGA);
      H.doorcase("none", { col: VIGA, skin: SK, lamp: { col: 0xffcf8a, side: 1 } });
    },
  });
})();
