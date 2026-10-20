/* ============================================================
   city/facades/desertmod.js — "Desert Modern": the Palm Springs house,
   1946-1970.

   WHAT IT IS (the references: visitpalmsprings.com "Exploring Desert
   Modernism", Wikipedia "Palm Springs School of Architecture",
   out.com "3 Houses in Palm Springs That Perfectly Define Desert
   Modernism", perchplans.com Palm Springs Desert Modernism):
     • a FLAT roof on a thin, deep FASCIA that CANTILEVERS well past the
       walls to shade the glass — or a BUTTERFLY roof (two slopes falling
       inward to a valley)
     • WALLS OF GLASS on slim dark steel/aluminium, CLERESTORY bands under the
       roof on the private faces
     • BREEZE-BLOCK (shadow block) screen walls in front of the glass
     • a feature wall of STACKED STONE or slump block
     • a white / sand palette and ONE bold accent: an orange, turquoise or
       yellow front door
     • a deep flat entry canopy, a low planter wall

   Built with the one carpentry in city/facades/house_parts.js.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  const WHITE = [0xece9e2, 0xe3ded2, 0xd9d4c8, 0xe8e0cf];
  const STONE = [0x9a8f80, 0x8a7f72, 0xa89c88];
  const ACCENT = [0xd07a32, 0x2f7f86, 0xd9b23a, 0xc4573a, 0x5f8a4a];
  const STEEL = 0x2a2c2e;

  CBZ.registerFacade("desertmod", {
    label: "Desert Modern",
    structure: "steel",
    crownsRoof: true,
    ownDoor: true,
    maxStoreys: 3,
    build: function (ctx, F, spec) {
      const HP = CBZ.HOUSE_PARTS;
      if (!HP) return;
      const H = HP.begin(ctx, F);
      const FH = H.FH, ST = H.ST, rTop = H.rTop, df = H.df, S = df.span;
      const white = H.pick(0xde01, WHITE), whiteD = HP.shade(white, 0.86);
      const stone = H.pick(0xde02, STONE);
      const accent = spec && spec.accent != null ? spec.accent : H.pick(0xde03, ACCENT);
      const butterfly = spec && spec.roof ? spec.roof === "butterfly" : H.hash(0xde04) < 0.4;
      const SK = 0.05;
      const sS = H.sign(0xde05);
      const stoneT0 = sS > 0 ? H.DOOR_CLEAR - 0.2 : -S / 2 - SK, stoneT1 = sS > 0 ? S / 2 + SK : -H.DOOR_CLEAR + 0.2;
      const screenOn = !ctx.grid && !H.noDoor && S >= 9;

      H.publish({ body: white, trim: white, roof: white, flat: true });

      // ---- THE OPENINGS: glass walls to the street (on the non-stone side), clerestories elsewhere
      const holes = [];
      const dh = H.doorHole();
      if (dh) holes.push(dh);
      for (const f of H.faces) {
        const front = f.s === df.s;
        for (let k = 0; k < ST; k++) {
          const topK = k === ST - 1;
          const row = front
            ? H.row(f, k, { per: 3.2, w: 2.6, sill: 0.6, head: 2.72, margin: 0.6,
                skip: function (t, w) { return k === 0 && t + w / 2 > stoneT0 && t - w / 2 < stoneT1; } })
            : (topK && f.s !== (df.s ^ 1)
              ? H.row(f, k, { per: 4.0, w: 3.0, sill: 2.05, head: 2.72, margin: 0.6 })
              : H.row(f, k, { per: 3.2, w: 2.2, sill: 0.6, head: 2.72, margin: 0.8 }));
          for (const op of row) holes.push(op);
        }
      }
      // the stone feature wall's own clerestory, so the face still has its glass
      holes.push(H.win(df, 0, (stoneT0 + stoneT1) / 2, Math.max(0.8, (stoneT1 - stoneT0) - 1.4), 2.1, 2.72));

      // ---- THE WALLS ----------------------------------------------------------------------------
      const roofY = rTop + H.PP + 0.3;                         // the fascia's top
      const fT = 0.36;                                          // the fascia's depth
      H.skinAll(0.12, roofY - fT, holes, white, SK);
      H.belt(-0.3, 0.12, holes, SK + 0.02, 0xbab4a6);
      // stacked stone on part of the street face: coursed in three tones
      {
        const cuts = holes.filter(function (h) { return h.s === df.s; });
        let i = 0;
        for (let y = 0.12; y < roofY - fT - 0.05; y += 0.14, i++) {
          const yc = Math.min(y + 0.14, roofY - fT);
          const cc = cuts.filter(function (h) { return yc > h.y0 && y < h.y1; }).map(function (h) { return [h.t0 - 0.02, h.t1 + 0.02]; });
          const col = [stone, HP.shade(stone, 0.88), HP.shade(stone, 1.1)][i % 3];
          for (const rr of HP.spans(stoneT0, stoneT1, cc)) H.fb(df, rr[0], rr[1], y + 0.01, yc - 0.01, SK, SK + 0.07 + (i % 2) * 0.02, col);
        }
      }

      // ---- WINDOWS: no trim, just a steel sill; the frames are the host's slim ones -----------
      for (const op of holes) {
        if (op.door) continue;
        H.fb(op.f, op.t0 - 0.02, op.t1 + 0.02, op.y0 - 0.05, op.y0 - 0.015, SK - 0.01, SK + 0.04, STEEL);
      }

      // ---- THE ROOF: a thin cantilevered plate, or a butterfly ------------------------------------
      const ov = HP.clamp(H.unit * 0.075, 0.7, 1.1);
      if (!butterfly) {
        H.slab(roofY, fT, ov, white, null, whiteD);
        H.ab(-H.W / 2 - ov + 0.05, H.W / 2 + ov - 0.05, roofY, roofY + 0.04, -H.D / 2 - ov + 0.05, H.D / 2 + ov - 0.05, 0xcdc8bd);
      } else {
        // two sheds falling to a valley over the centre line, ridge parallel to the street
        const axis = df.horiz ? "x" : "z";
        const C = (axis === "x" ? H.D : H.W) / 2;
        const half = function (sg) {
          const rect = axis === "x" ? { x0: -H.W / 2, x1: H.W / 2, z0: sg < 0 ? -C : 0, z1: sg < 0 ? 0 : C }
                                    : { x0: sg < 0 ? -C : 0, x1: sg < 0 ? 0 : C, z0: -H.D / 2, z1: H.D / 2 };
          H.roof({ kind: "shed", axis: axis, rect: rect, base: roofY - fT, pitch: 0.12, step: 0.08, eave: 0.0, rake: ov * 0.6, back: ov,
            roof: white, roof2: HP.shade(white, 0.95), soffit: null, fascia: null, flipShed: sg > 0 });
          // the soffit under the high, oversailing edge
          const so = axis === "x" ? { x0: -H.W / 2 - ov * 0.6, x1: H.W / 2 + ov * 0.6, z0: sg < 0 ? -C - ov : C, z1: sg < 0 ? -C : C + ov } : { x0: sg < 0 ? -C - ov : C, x1: sg < 0 ? -C : C + ov, z0: -H.D / 2 - ov * 0.6, z1: H.D / 2 + ov * 0.6 };
          H.ab(so.x0, so.x1, roofY - fT - 0.03, roofY - fT, so.z0, so.z1, whiteD);
        };
        half(-1); half(1);
        // the valley's scupper at each gable end
        for (const f of H.faces) if ((axis === "x") !== f.horiz) H.fb(f, -0.2, 0.2, roofY - fT - 0.25, roofY - fT, 0, ov + 0.3, STEEL);
        H.skinAll(roofY - fT, roofY - fT + 0.02, [], white, SK);
      }

      // ---- THE BREEZE-BLOCK SCREEN in front of the glass on the far side of the door ------------
      if (screenOn) {
        const a = sS > 0 ? -S / 2 + 0.6 : H.DOOR_CLEAR + 0.4, b = sS > 0 ? -H.DOOR_CLEAR - 0.4 : S / 2 - 0.6;
        if (b - a > 1.6) {
          const o0 = 1.0, o1 = 1.2, y1 = Math.min(2.4, FH - 0.6), cell = 0.3;
          H.fb(df, a, b, -0.3, 0.1, o0 - 0.05, o1 + 0.05, whiteD);
          for (let t = a; t <= b + 0.001; t += cell) H.fb(df, t - 0.03, t + 0.03, 0.1, y1, o0, o1, white);
          for (let y = 0.1 + cell; y <= y1 + 0.001; y += cell) H.fb(df, a - 0.03, b + 0.03, y - 0.03, y + 0.03, o0, o1, white);
          H.solidF(df, a, b, 0.1, y1, o0, o1);
        }
      }

      // ---- THE ENTRANCE: an accent door under a deep flat canopy ---------------------------------
      H.doorColour(accent);
      if (!H.noDoor && !H.driveIn) {
        const cy = Math.min(FH - 0.3, 2.85), cw = H.doorW + 2.4, cd = 2.0;
        H.fb(df, -cw / 2, cw / 2, cy, cy + 0.2, 0, cd, white);
        H.fb(df, -cw / 2 + 0.25, -cw / 2 + 0.33, H.DECK, cy, cd - 0.3, cd - 0.22, STEEL);
        H.solidF(df, -cw / 2 + 0.25, -cw / 2 + 0.33, H.DECK, cy, cd - 0.3, cd - 0.22);
        H.lamp(df, 0, cy - 0.06, cd * 0.5, 0.07, 0xfff0d0);
        H.fb(df, -cw / 2, cw / 2, -0.3, H.DECK, 0, cd, 0xb8b2a4);
        H.platF(df, -cw / 2, cw / 2, 0, cd, H.DECK);
        // a low planter wall off the canopy, with something green in it
        H.fb(df, cw / 2 + 0.2, cw / 2 + 2.4, -0.3, 0.55, 1.4, 1.75, stone);
        H.fb(df, cw / 2 + 0.3, cw / 2 + 2.3, 0.55, 0.85, 1.45, 1.7, 0x5d6b3a);
      }
    },
  });
})();
