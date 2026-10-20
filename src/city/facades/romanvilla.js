/* ============================================================
   city/facades/romanvilla.js — "Roman Villa": the Mediterranean villa of
   the Roman tradition (the villa urbana / the Italian country villa).

   WHAT IT IS (the references: Wikipedia "Cavaedium" and "Villa of Trajan",
   vroma.org "Peristylium", Yale HSAR 252 lecture 5 "Houses and Villas at
   Pompeii", brewminate.com "Roman Domestic Architecture"):
     • a LOW-PITCHED (18-22 deg) roof of terracotta TILE with a modest eave
     • stucco walls in OCHRE / sand, a dark POMPEIAN-RED DADO round the base
       under a stone band
     • the street face is mostly WALL: few, small, high windows with heavy
       stone surrounds — the house looks inward
     • a PORTICUS: a colonnade of plain Tuscan columns carrying a tiled lean-to
       along the front, a stone-framed central entrance
     • a squat TOWER (the later Italian villa's belvedere) on some
     • stone cornice, a terracotta chimney

   Built with the one carpentry in city/facades/house_parts.js.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  const STUCCO = [0xd8c7a6, 0xc9a77c, 0xe2d6bd, 0xd4b48a, 0xcbb79a];
  const DADO = [0x8f3e2c, 0x7a3a2c, 0x6e4a3a];
  const TILE = [0xa5583a, 0x9a5236, 0xb0663f];

  CBZ.registerFacade("romanvilla", {
    label: "Roman Villa",
    structure: "stone",
    crownsRoof: true,
    ownDoor: true,
    maxStoreys: 3,
    build: function (ctx, F) {
      const HP = CBZ.HOUSE_PARTS;
      if (!HP) return;
      const H = HP.begin(ctx, F);
      const FH = H.FH, ST = H.ST, df = H.df, S = df.span;
      const stucco = H.tint(H.pick(0x4e01, STUCCO), 0.05), stuccoD = HP.shade(stucco, 0.88);
      const dado = H.pick(0x4e02, DADO), tile = H.pick(0x4e03, TILE), tile2 = HP.mix(tile, 0x5a3424, 0.3);
      const stone = HP.mix(0xd9d0bc, stucco, 0.2);
      const SK = 0.12;
      const porOn = !H.noDoor && !H.driveIn && !ctx.grid && S >= 9;
      const dep = HP.clamp(H.unit * 0.18, 2.0, 2.6);
      const towOn = !ctx.grid && S >= 12 && H.hash(0x4e04) < 0.5;
      const towS = H.sign(0x4e05), towW = HP.clamp(H.unit * 0.3, 3.2, 4.4);

      // ---- THE OPENINGS: few, small, high on the street; fuller elsewhere -------
      const holes = [];
      const dh = H.doorHole();
      if (dh) holes.push(dh);
      for (const f of H.faces) {
        for (let k = 0; k < ST; k++) {
          const front = f.s === df.s;
          const row = H.row(f, k, { per: 3.1, w: front ? 0.85 : 1.0, sill: front && k === 0 ? 1.15 : 0.85, head: 2.3, odd: front, margin: 1.2 });
          for (const op of row) holes.push(op);
        }
      }

      // ---- THE WALLS --------------------------------------------------------------------
      const pitch = 0.36, eave = 0.4;
      const base = H.eaveBase(pitch, eave);
      H.skinAll(1.05, base - 0.02, holes, stucco, SK);
      H.skinAll(0.2, 1.05, holes, dado, SK + 0.02);                                // the red dado
      H.belt(1.0, 1.12, holes, SK + 0.06, stone);
      H.belt(-0.3, 0.2, holes, SK + 0.06, HP.shade(stone, 0.8));
      for (let k = 1; k < ST; k++) H.belt(k * FH - 0.05, k * FH + 0.1, holes, SK + 0.05, stone);
      // the stone cornice under the eave
      H.belt(base - 0.32, base - 0.18, [], SK + 0.06, stone);
      H.belt(base - 0.18, base - 0.03, [], SK + 0.16, stone);
      for (const op of holes) {
        if (op.door) continue;
        H.trim(op, { skin: SK, cw: 0.14, cp: 0.04, col: stone, head: "cap", sill: { h: 0.1, proj: 0.09, over: 0.06, col: stone } });
      }

      // ---- THE ROOF: low terracotta ---------------------------------------------------------
      const axis = df.horiz ? "x" : "z";
      const hipped = H.hash(0x4e06) < 0.6;
      const r = H.roof({ kind: hipped ? "hip" : "gable", axis: axis, base: base, pitch: pitch, step: 0.11, eave: eave, rake: 0.3,
        roof: tile, roof2: tile2, core: stucco, coreProj: SK + 0.02, soffit: HP.shade(stucco, 0.8), fascia: tile2,
        ridge: HP.shade(tile, 0.8), hipCaps: true, rakeBoard: !hipped });

      // ---- THE PORTICUS -------------------------------------------------------------------------
      if (porOn) {
        const t0 = towOn && towS < 0 ? -S / 2 + towW + 0.15 : -S / 2 + 0.25;
        const t1 = towOn && towS > 0 ? S / 2 - towW - 0.15 : S / 2 - 0.25;
        if (t1 - t0 >= 4) {
          H.fb(df, t0, t1, -0.3, H.DECK - 0.03, 0, dep, HP.shade(stone, 0.85));
          H.fb(df, t0 - 0.03, t1 + 0.03, H.DECK - 0.03, H.DECK, 0, dep + 0.03, stone);
          H.platF(df, t0, t1, 0, dep, H.DECK);
          const beamB = Math.min(FH - 0.4, 2.8);
          const cr = 0.2, n = Math.max(2, Math.round((t1 - t0) / 2.4)), po = dep - cr - 0.08;
          for (let i = 0; i <= n; i++) {
            const t = t0 + cr + 0.1 + (t1 - t0 - 2 * cr - 0.2) * i / n;
            if (Math.abs(t) < H.doorW / 2 + cr + 0.2) continue;
            H.fb(df, t - cr - 0.07, t + cr + 0.07, H.DECK, H.DECK + 0.16, po - cr - 0.07, po + cr + 0.07, stone);
            H.columnF(df, t, po, H.DECK + 0.16, cr, beamB - H.DECK - 0.16 - 0.16, stucco, 14);
            H.fb(df, t - cr - 0.08, t + cr + 0.08, beamB - 0.16, beamB, po - cr - 0.08, po + cr + 0.08, stone);
            H.solidF(df, t - cr, t + cr, H.DECK, beamB, po - cr, po + cr);
          }
          H.fb(df, t0 - 0.05, t1 + 0.05, beamB, beamB + 0.32, po - cr - 0.1, dep + 0.02, stone);
          H.roofF(df, t0, t1, 0, dep, { base: beamB + 0.32, kind: "shed", pitch: 0.3, step: 0.1, eave: 0.3, rake: 0.12,
            roof: tile, roof2: tile2, fascia: tile2, soffit: HP.shade(stucco, 0.8), rakeBoard: true });
        }
      }

      // ---- THE TOWER: a belvedere at one end of the front ---------------------------------------
      if (towOn) {
        const tc = towS * (S / 2 - towW / 2), back = Math.min(towW, df.halfN * 0.8);
        const tTop = r.top + 1.6;
        H.fb(df, tc - towW / 2, tc + towW / 2, base - 0.2, tTop, -back, SK + 0.02, stucco);
        // an arcaded loggia of three openings at its top
        const ly0 = tTop - 1.7, ly1 = tTop - 0.35;
        for (let i = 0; i < 3; i++) {
          const a = tc - towW / 2 + 0.3 + (towW - 0.6) * i / 3, b = a + (towW - 0.6) / 3 - 0.25;
          H.fb(df, a + 0.12, b + 0.12, ly0, ly1, SK + 0.02, SK + 0.05, F.glass(ctx, 0x20262a));
        }
        H.fb(df, tc - towW / 2 - 0.1, tc + towW / 2 + 0.1, ly0 - 0.14, ly0, SK, SK + 0.1, stone);
        H.fb(df, tc - towW / 2 - 0.1, tc + towW / 2 + 0.1, tTop - 0.22, tTop, SK, SK + 0.18, stone);
        const put = function (u0, u1, v0, v1, y0, y1, col) { H.fb(df, u0, u1, y0, y1, v0, v1, col); };
        H.stack(put, { u0: tc - towW / 2, u1: tc + towW / 2, v0: -back, v1: SK + 0.02 }, { kind: "hip", base: tTop, pitch: 0.34, step: 0.1, eave: 0.45,
          roof: tile, roof2: tile2, soffit: HP.shade(stucco, 0.8), fascia: tile2, ridge: HP.shade(tile, 0.8), hipCaps: true });
      }

      // ---- THE ENTRANCE: a stone frame with a pediment --------------------------------------------
      H.doorColour(0x4a3020);
      H.doorcase("ped", { col: stone, skin: SK, w: 0.24, cap: stone, step: porOn ? null : { col: stone, w: H.doorW + 1.0, d: 0.5 },
        lamp: { col: 0xffcf8a, side: -towS } });

      // ---- THE CHIMNEY: rendered, with a tiled cap -------------------------------------------------
      if (!ctx.grid) {
        const A = (axis === "x" ? H.W : H.D) / 2;
        H.chimney({ x: axis === "x" ? -towS * A * 0.5 : -df.out * 1.0, z: axis === "x" ? -df.out * 1.0 : -towS * A * 0.5, w: 0.85, dp: 0.65, top: r.top + 0.5,
          brick: stucco, cap: tile, pot: tile2, pots: 1 });
      }
      void stuccoD;
    },
  });
})();
