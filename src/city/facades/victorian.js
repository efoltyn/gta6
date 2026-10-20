/* ============================================================
   city/facades/victorian.js — "Second Empire": the Italianate / Second
   Empire town house and block, 1855-1885.

   WHAT IT IS (the references: phmc.state.pa.us Second Empire/Mansard
   1860-1900, wentworthstudio.com Second Empire, architecturestyles.org
   second-empire, preservation.mhl.org Andover's styles — "Italianate is
   sometimes called the Bracketed Style"):
     • a MANSARD roof — a near-vertical lower slope (70-80 deg) in slate with
       DORMERS punched through it and a low upper slope behind iron CRESTING —
       or, on the Italianate sister, a low hipped roof on a huge eave
     • a deep BRACKETED CORNICE: paired scroll brackets, a frieze, a crown
     • tall narrow 2-over-2 SASH windows with heavy HOODS: segmental arched
       hoods and flat bracketed cornice hoods, sills on little consoles
     • QUOINS at the corners, a STRING COURSE at every floor, a RUSTICATED
       or channelled ground storey
     • a raised entrance with a bracketed HOOD over a transomed door
     • painted masonry in stone and earth tones with a pale or dark trim

   Used for town houses (Crownhill), painted rows (the metros), mansard
   blocks and offices up to any height, and the island's shops: everything
   scales off the storey count.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  // [body, trim, slate]
  const SETS = [
    [0x8c7a62, 0xe9e1cc, 0x2f3236],
    [0x6a6f5e, 0xe3dcc8, 0x2b2f33],
    [0x7a4c3a, 0xe6ddc8, 0x30302f],
    [0xb4a88e, 0x5a4a3a, 0x2e3033],
    [0x5f6a72, 0xe8e4da, 0x2a2d31],
    [0xa39274, 0x3f4636, 0x2d2f2c],
  ];
  const DOOR = [0x3a2418, 0x23262a, 0x2c3a2e, 0x4a2a20];

  CBZ.registerFacade("victorian", {
    label: "Second Empire",
    structure: "masonry",
    crownsRoof: true,
    ownDoor: true,
    build: function (ctx, F) {
      const HP = CBZ.HOUSE_PARTS;
      if (!HP) return;
      const H = HP.begin(ctx, F);
      const FH = H.FH, ST = H.ST, rTop = H.rTop, df = H.df;
      const set = H.pick(0x7c01, SETS);
      const body = H.tint(set[0], 0.08), trim = set[1], slate = set[2];
      const bodyD = HP.shade(body, 0.86), trimD = HP.shade(trim, 0.88);
      const iron = 0x26282a;
      const glass = F.glass(ctx, 0x1b232b);
      const mansard = ST >= 2 ? H.hash(0x7c02) < 0.72 : H.hash(0x7c02) < 0.4;
      const SK = 0.06;
      const tall = ST >= 6;

      H.publish({ body: body, trim: trim, roof: slate, flat: false });

      // ---- THE OPENINGS ---------------------------------------------------------
      const holes = [];
      const dh = H.doorHole();
      if (dh) holes.push(dh);
      for (const f of H.faces) {
        for (let k = 0; k < ST; k++) {
          const top = k === ST - 1 && ST >= 3;
          const row = H.row(f, k, { per: tall ? 2.6 : 2.4, w: 0.9, sill: k === 0 ? 0.62 : (top ? 0.85 : 0.72), head: k === 0 ? 2.6 : (top ? 2.4 : 2.6),
            odd: f.s === df.s, margin: Math.min(1.1, f.span * 0.085) });
          for (const op of row) holes.push(op);
        }
      }

      // ---- THE WALLS ----------------------------------------------------------------
      const corH = HP.clamp(FH * 0.24, 0.6, 1.0);            // the cornice's depth on the wall
      const wallTop = rTop + 0.05;
      H.skinAll(0.45, wallTop, holes, body, SK);
      // a channelled (rusticated) ground storey
      for (const f of H.faces) H.courses(f, 0.45, FH - 0.2, holes, 0.36, 0.05, SK + 0.015, bodyD, { o0: SK - 0.01 });
      H.belt(-0.3, 0.45, holes, SK + 0.07, HP.shade(body, 0.7));
      H.belt(0.45, 0.55, holes, SK + 0.09, trimD);
      for (let k = 1; k < ST; k++) {
        H.belt(k * FH - 0.05, k * FH + 0.13, holes, SK + 0.07, trim);
        H.belt(k * FH + 0.13, k * FH + 0.19, holes, SK + 0.04, trimD);
      }
      H.quoins(0.55, rTop - corH - 0.1, 0.6, 0.34, SK + 0.05, trim, trimD);

      // ---- WINDOW HOODS: segmental and bracketed cornice hoods, by floor ------------
      for (const op of holes) {
        if (op.door) continue;
        const f = op.f, seg = (op.k % 2) === 1;
        H.trim(op, { skin: SK, cw: 0.11, cp: 0.04, col: trim, head: seg ? "seg" : "cap", headCol: trim, key: seg ? trimD : null, archH: 0.22,
          sill: { h: 0.09, proj: 0.1, over: 0.06, col: trim } });
        if (!tall || op.k === 0) for (const sg of [-1, 1]) {             // the sill's consoles
          const t = sg < 0 ? op.t0 - 0.06 : op.t1 + 0.06;
          H.fb(f, t - 0.05, t + 0.05, op.y0 - 0.38, op.y0 - 0.13, SK - 0.01, SK + 0.08, trim);
        }
      }

      // ---- THE BRACKETED CORNICE ----------------------------------------------------
      const cd = HP.clamp(H.unit * 0.055, 0.45, 0.75);         // how far it flies
      const y0c = rTop - corH;
      H.belt(y0c, rTop - 0.22, [], SK + 0.04, HP.shade(body, 0.95));     // the frieze
      H.belt(y0c - 0.12, y0c, [], SK + 0.06, trim);
      for (const f of H.faces) {
        const n = Math.max(3, Math.round(f.span / 0.95));
        for (let i = 0; i <= n; i++) {
          const t = -f.span / 2 + 0.25 + (f.span - 0.5) * i / n;
          for (const sg of [-1, 1]) {
            const tt = t + sg * 0.11;
            H.fb(f, tt - 0.045, tt + 0.045, rTop - 0.22 - corH * 0.55, rTop - 0.22, SK, SK + 0.14, trim);
            H.fb(f, tt - 0.045, tt + 0.045, rTop - 0.22 - corH * 0.25, rTop - 0.22, SK, SK + cd * 0.75, trim);
          }
        }
      }
      H.belt(rTop - 0.22, rTop - 0.08, [], SK + cd * 0.82, trim);
      H.belt(rTop - 0.08, rTop + 0.06, [], SK + cd, trimD);
      H.belt(rTop + 0.06, rTop + 0.14, [], SK + cd * 0.9, trim);

      // ---- THE ROOF -------------------------------------------------------------------
      const axis = df.horiz ? "x" : "z";
      const rB = rTop + 0.14;
      let topY;
      // a metro row or block (ctx.grid) is roofed by the fabric; only its
      // entrance is left to dress
      if (ctx.grid) { entrance(); return; }
      if (mansard) {
        // the lower slope: near-vertical slate, bell-cast at the foot, sealing
        // the shell's parapet inside it
        const mh = HP.clamp(FH * 0.92, 2.5, 3.1);
        const lower = H.roof({ kind: "hip", axis: axis, base: rB, pitch: 3.4, step: 0.15, eave: cd * 0.35, maxH: mh,
          roof: slate, roof2: HP.shade(slate, 1.12), soffit: null, fascia: null, gutter: null, ridge: trimD, hipCaps: true });
        const ru = lower.huTop, rv = lower.hvTop;
        const rect = axis === "x" ? { x0: -ru, x1: ru, z0: -rv, z1: rv } : { x0: -rv, x1: rv, z0: -ru, z1: ru };
        const yU = rB + Math.round(mh / 0.15) * 0.15;
        H.ab(rect.x0 - 0.1, rect.x1 + 0.1, yU, yU + 0.14, rect.z0 - 0.1, rect.z1 + 0.1, trim);       // the curb moulding
        const up = H.roof({ kind: "hip", axis: axis, rect: rect, base: yU + 0.14, pitch: 0.3, step: 0.1, eave: 0.0,
          roof: HP.shade(slate, 0.92), roof2: HP.shade(slate, 0.85), ridge: iron });
        topY = up.top;
        // iron cresting round the curb
        for (const sx of [0, 1]) {
          const len = sx ? rect.z1 - rect.z0 : rect.x1 - rect.x0;
          const n = Math.max(2, Math.round(len / 0.3));
          for (const sg of [-1, 1]) {
            for (let i = 0; i <= n; i++) {
              const a = (sx ? rect.z0 : rect.x0) + len * i / n;
              const x = sx ? (sg < 0 ? rect.x0 : rect.x1) : a, z = sx ? a : (sg < 0 ? rect.z0 : rect.z1);
              H.ab(x - 0.02, x + 0.02, yU + 0.14, yU + (i % 2 ? 0.5 : 0.62), z - 0.02, z + 0.02, iron);
            }
            const x = sx ? (sg < 0 ? rect.x0 : rect.x1) : (rect.x0 + rect.x1) / 2, z = sx ? (rect.z0 + rect.z1) / 2 : (sg < 0 ? rect.z0 : rect.z1);
            H.ab(x - (sx ? 0.025 : len / 2), x + (sx ? 0.025 : len / 2), yU + 0.4, yU + 0.44, z - (sx ? len / 2 : 0.025), z + (sx ? len / 2 : 0.025), iron);
          }
        }
        // DORMERS punched through the slope, one over every other window bay
        for (const f of H.faces) {
          if (ctx.grid && f.s !== df.s) continue;
          const ops = holes.filter(function (h) { return h.s === f.s && h.k === ST - 1 && !h.door; });
          const along = f.horiz ? axis === "x" : axis === "z";
          const side = f.out;
          for (let i = 0; i < ops.length; i++) {
            if (ops.length > 2 && (i % 2) === 1 && f.s !== df.s) continue;
            H.dormer({ base: rB, eave: cd * 0.35 }, along ? axis : (axis === "x" ? "z" : "x"), side, ops[i].t, 0.8, 1.2,
              { cheek: trim, trim: trim, roof: slate, roof2: HP.shade(slate, 0.9), glass: glass },
              { pitch: 3.4, set: 0.12, dPitch: 0.75, kind: (i % 2) ? "hip" : "gable" });
          }
        }
      } else {
        // the Italianate: a low hip on the same deep bracketed eave
        const r = H.roof({ kind: "hip", axis: axis, base: rB, pitch: 0.36, step: 0.11, eave: cd + 0.05,
          roof: slate, roof2: HP.shade(slate, 0.88), soffit: trimD, fascia: trim, ridge: HP.shade(slate, 0.75), hipCaps: true });
        topY = r.top;
        // a belvedere on a big house
        if (!ctx.grid && H.unit >= 11) {
          const bw = HP.clamp(H.unit * 0.24, 2.6, 4.0), by = r.top - 0.6;
          H.ab(-bw / 2, bw / 2, by, by + 1.7, -bw / 2, bw / 2, body);
          for (const sx of [-1, 1]) {
            H.ab(sx * bw / 2 - 0.05, sx * bw / 2 + 0.05, by + 0.5, by + 1.4, -bw * 0.3, bw * 0.3, glass);
            H.ab(-bw * 0.3, bw * 0.3, by + 0.5, by + 1.4, sx * bw / 2 - 0.05, sx * bw / 2 + 0.05, glass);
          }
          H.roof({ kind: "pyr", axis: "x", rect: { x0: -bw / 2, x1: bw / 2, z0: -bw / 2, z1: bw / 2 }, base: by + 1.7, pitch: 0.4, step: 0.1, eave: 0.4,
            roof: slate, roof2: HP.shade(slate, 0.88), soffit: trimD, fascia: trim });
        }
      }

      // ---- CHIMNEYS: a pair of corbelled stacks on the roof ---------------------------
      if (!ctx.grid) {
        const A = (axis === "x" ? H.W : H.D) / 2, C = (axis === "x" ? H.D : H.W) / 2;
        for (const sg of [-1, 1]) {
          const u = sg * (A - 1.0), v = -df.out * Math.min(C * 0.45, 2.0) * (axis === (df.horiz ? "x" : "z") ? 1 : 0);
          H.chimney({ x: axis === "x" ? u : v, z: axis === "x" ? v : u, w: 0.85, dp: 0.55, top: topY + 0.75, brick: HP.mix(0x7e4532, body, 0.15), cap: trim, pots: 2 });
        }
      }

      entrance();
      function entrance() {
      // ---- THE ENTRANCE: pilasters, a bracketed hood, a stone stoop -------------------
      H.doorColour(H.pick(0x7c03, DOOR));
      H.doorcase("pilaster", { col: trim, skin: SK, w: 0.18, cap: trimD,
        lamp: { col: 0xffd9a0, side: H.sign(0x7c04) }, step: { col: HP.mix(0xbab2a0, body, 0.1), w: H.doorW + 1.2, d: 0.5 } });
      if (!H.noDoor && !H.driveIn) {
        const hy = H.doorH + 0.45, hw = H.doorW / 2 + 0.5;
        H.fb(df, -hw, hw, hy, hy + 0.16, SK, SK + 0.95, trim);
        H.fb(df, -hw - 0.05, hw + 0.05, hy + 0.16, hy + 0.26, SK, SK + 1.0, trimD);
        for (const sg of [-1, 1]) {
          const t = sg * (hw - 0.12);
          H.fb(df, t - 0.06, t + 0.06, hy - 0.55, hy, SK, SK + 0.2, trim);
          H.fb(df, t - 0.06, t + 0.06, hy - 0.2, hy, SK, SK + 0.75, trim);
        }
      }
      }
    },
  });
})();
