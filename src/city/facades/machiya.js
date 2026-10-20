/* ============================================================
   city/facades/machiya.js — "Machiya": the Kyoto merchant town house
   (kyo-machiya), Edo to Taisho.

   WHAT IT IS (the references: nippon.com "Recognizing Design Features in
   Kyoto's Machiya Townhouses", mykyotomachiya.com Kyomachiya, Wikipedia
   "Machiya", arrowsrealty.com "Kyo-Machiya Design: Exterior"):
     • a NARROW street front (4-6 m on a deep plot), two storeys, the upper
       one LOW (tsushi-nikai)
     • the ground storey screened by KOSHI: a fine timber lattice of close
       vertical slats standing in front of the openings
     • a TORI-BISASHI: a shallow tiled pent roof across the whole front over
       the ground storey
     • the upper storey in PLASTER with MUSHIKO-MADO: wide windows barred with
       thick plastered slats
     • a gabled roof, ridge PARALLEL to the street, of dark grey KAWARA tile,
       a deep eave, a straight unadorned eave line (ichimonji), a heavy ridge
     • INUYARAI: low curved bamboo guards at the foot of the wall
     • dark stained timber (or bengara red-brown), white or ochre plaster,
       a stone base

   Built with the one carpentry in city/facades/house_parts.js.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  const WOOD = [0x3b2a1e, 0x4a3424, 0x5a2e22, 0x33261c];
  const PLASTER = [0xe9e2d2, 0xd8cdb6, 0xcfc6b2, 0xe2d6bc];
  const TILE = [0x4a4e52, 0x3f4347, 0x55585b];

  CBZ.registerFacade("machiya", {
    label: "Machiya",
    structure: "timber",
    crownsRoof: true,
    ownDoor: true,
    maxStoreys: 3,
    build: function (ctx, F, spec) {
      const HP = CBZ.HOUSE_PARTS;
      if (!HP) return;
      const H = HP.begin(ctx, F);
      const FH = H.FH, ST = H.ST, df = H.df;
      const wood = H.pick(0x8c01, WOOD), woodL = HP.shade(wood, 1.25);
      const plaster = H.tint(H.pick(0x8c02, PLASTER), 0.04);
      const tile = spec && spec.tile ? spec.tile : H.pick(0x8c03, TILE);
      const stone = 0x8a8680, bamboo = 0x8a7448;
      const SK = 0.1;

      // ---- THE OPENINGS ---------------------------------------------------------------
      const holes = [];
      const dh = H.doorHole();
      if (dh) holes.push(dh);
      for (const f of H.faces) {
        const front = f.s === df.s;
        for (let k = 0; k < ST; k++) {
          const row = front
            ? H.row(f, k, { per: 3.2, w: k === 0 ? 1.9 : 2.2, sill: k === 0 ? 0.65 : 0.95, head: k === 0 ? 2.4 : 2.1, margin: 0.6 })
            : H.row(f, k, { per: 3.4, w: 1.1, sill: 0.95, head: 2.15, margin: 1.0 });
          for (const op of row) holes.push(op);
        }
      }

      // ---- THE ROOF -------------------------------------------------------------------------
      const pitch = 0.5, eave = 0.72;
      const base = H.eaveBase(pitch, eave);
      const ridgeX = df.horiz;

      // ---- THE WALLS: dark boards below, plaster above, a stone base ------------------------
      const split = Math.min(FH, base);
      H.skinAll(0.25, split, holes, wood, SK);
      for (const f of H.faces) {
        // vertical board joints on the lower storey
        const ext = f.horiz ? SK : 0;
        for (let t = -f.span / 2 - ext + 0.18; t < f.span / 2 + ext - 0.1; t += 0.3) {
          const cuts = [];
          for (const h of holes) if (h.s === f.s && t + 0.02 > h.t0 - 0.02 && t - 0.02 < h.t1 + 0.02) cuts.push([h.y0 - 0.03, h.y1 + 0.03]);
          for (const rr of HP.spans(0.25, split - 0.05, cuts)) H.fb(f, t - 0.015, t + 0.015, rr[0], rr[1], SK - 0.01, SK + 0.012, HP.shade(wood, 0.8));
        }
      }
      H.skinAll(split, base - 0.02, holes, plaster, SK);
      H.belt(-0.3, 0.25, holes, SK + 0.06, stone);
      // the exposed frame: posts at the corners and a beam at the floor line
      H.cornerBoards(0.25, base - 0.02, 0.16, SK + 0.04, wood);
      H.belt(split - 0.06, split + 0.16, holes, SK + 0.05, wood);
      H.belt(base - 0.22, base - 0.03, [], SK + 0.05, wood);

      // ---- KOSHI on the ground storey, MUSHIKO-MADO above --------------------------------------
      for (const op of holes) {
        if (op.door) continue;
        const f = op.f;
        const ground = op.k === 0;
        // the frame round the opening
        H.fb(f, op.t0 - 0.1, op.t0 - 0.015, op.y0 - 0.04, op.y1 + 0.04, SK - 0.01, SK + 0.05, wood);
        H.fb(f, op.t1 + 0.015, op.t1 + 0.1, op.y0 - 0.04, op.y1 + 0.04, SK - 0.01, SK + 0.05, wood);
        H.fb(f, op.t0 - 0.1, op.t1 + 0.1, op.y1 + 0.015, op.y1 + 0.12, SK - 0.01, SK + 0.05, wood);
        H.fb(f, op.t0 - 0.1, op.t1 + 0.1, op.y0 - 0.12, op.y0 - 0.015, SK - 0.01, SK + 0.06, wood);
        const lo = SK + 0.05, hi = SK + 0.09;
        if (ground && f.s === df.s) {
          // close vertical slats, a top and bottom rail, standing off the glass
          H.fb(f, op.t0 - 0.06, op.t1 + 0.06, op.y1 - 0.05, op.y1 + 0.02, lo, hi + 0.01, woodL);
          H.fb(f, op.t0 - 0.06, op.t1 + 0.06, op.y0 - 0.02, op.y0 + 0.05, lo, hi + 0.01, woodL);
          for (let t = op.t0 + 0.05; t < op.t1 - 0.03; t += 0.085) H.fb(f, t - 0.022, t + 0.022, op.y0 + 0.05, op.y1 - 0.05, lo, hi, woodL);
        } else if (f.s === df.s) {
          // thick plastered slats
          for (let t = op.t0 + 0.12; t < op.t1 - 0.06; t += 0.2) H.fb(f, t - 0.045, t + 0.045, op.y0, op.y1, lo, hi + 0.02, plaster);
        } else {
          H.fb(f, op.t0, op.t1, (op.y0 + op.y1) / 2 - 0.02, (op.y0 + op.y1) / 2 + 0.02, lo, hi, wood);
        }
      }

      // ---- THE TORI-BISASHI: the pent roof over the ground storey ---------------------------
      if (ST >= 2) {
        const pb = Math.min(FH - 0.42, 2.62);
        for (const f of [df]) {
          H.roofF(f, -f.span / 2 - 0.1, f.span / 2 + 0.1, 0, 0.85, { base: pb, kind: "shed", pitch: 0.42, step: 0.09, eave: 0.12, rake: 0.0,
            roof: tile, roof2: HP.shade(tile, 0.86), fascia: HP.shade(tile, 0.7), fasciaH: 0.16, v0clip: SK - 0.02 });
          // its little brackets
          for (let t = -f.span / 2 + 0.6; t < f.span / 2 - 0.3; t += 1.8) H.fb(f, t - 0.05, t + 0.05, pb - 0.3, pb, SK, 0.7, wood);
        }
      }

      // ---- THE ROOF: kawara tile, a straight eave, a heavy ridge ------------------------------
      const r = H.roof({ kind: "gable", axis: ridgeX ? "x" : "z", base: base, pitch: pitch, step: 0.11, eave: eave, rake: 0.42,
        roof: tile, roof2: HP.shade(tile, 0.86), core: plaster, soffit: wood, fascia: HP.shade(tile, 0.72), fasciaH: 0.18, rakeBoard: true });
      {
        const A = (ridgeX ? H.W : H.D) / 2 + 0.45;
        const ax = ridgeX;
        const rb = function (a, y0, y1, hw, col) { if (ax) H.ab(-a, a, y0, y1, -hw, hw, col); else H.ab(-hw, hw, y0, y1, -a, a, col); };
        rb(A, r.top - 0.04, r.top + 0.16, 0.24, HP.shade(tile, 0.7));
        rb(A - 0.05, r.top + 0.16, r.top + 0.3, 0.15, HP.shade(tile, 0.62));
        // onigawara: the ridge-end tiles stand up at each end
        for (const sg of [-1, 1]) {
          const a0 = sg * A;
          if (ax) H.ab(a0 - (sg > 0 ? 0.3 : 0), a0 + (sg > 0 ? 0 : 0.3), r.top + 0.16, r.top + 0.5, -0.18, 0.18, HP.shade(tile, 0.6));
          else H.ab(-0.18, 0.18, r.top + 0.16, r.top + 0.5, a0 - (sg > 0 ? 0.3 : 0), a0 + (sg > 0 ? 0 : 0.3), HP.shade(tile, 0.6));
        }
      }

      // ---- INUYARAI: low bamboo guards at the foot of the front ------------------------------
      if (!H.noDoor) for (const sg of [-1, 1]) {
        const a = sg < 0 ? -df.span / 2 + 0.2 : H.doorW / 2 + 0.35, b = sg < 0 ? -H.doorW / 2 - 0.35 : df.span / 2 - 0.2;
        if (b - a < 0.6) continue;
        H.fb(df, a, b, 0.0, 0.3, SK, SK + 0.42, bamboo);
        H.fb(df, a, b, 0.3, 0.6, SK, SK + 0.26, HP.shade(bamboo, 0.92));
        H.fb(df, a, b, 0.6, 0.85, SK, SK + 0.12, bamboo);
      }

      // ---- THE ENTRANCE -----------------------------------------------------------------------------
      H.doorColour(wood);
      H.doorcase("casing", { col: wood, skin: SK, w: 0.14, lamp: { col: 0xffd8a0, side: H.sign(0x8c04) }, step: { col: stone, w: H.doorW + 0.5, d: 0.4 } });
    },
  });
})();
