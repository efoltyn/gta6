/* ============================================================
   city/facades/techhouse.js — "Modern House": the contemporary house,
   2005-today.

   WHAT IT IS (the references: renderahouse.com "Modern House Design",
   houzz.co.uk "House Exterior with Wood Cladding and a Flat Roof",
   familyhomeinspo.com "Modern House Exterior Flat Roof Designs"):
     • FLAT roofs with a thin metal coping, or a roof plate that oversails
       one side as a canopy
     • a TWO-MATERIAL facade: a heavy base (white render / dark brick) and a
       light, warm top (vertical TIMBER battens / dark standing-seam metal)
     • big FLOOR-TO-CEILING glass in slim dark frames, narrow vertical slots
       on the private sides
     • a deep PICTURE-FRAME box (a projecting surround) round the main upper
       window, a cantilevered entrance canopy
     • a neutral palette — white, grey, charcoal, cedar — and flush
       garage doors

   Built with the one carpentry in city/facades/house_parts.js.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  const RENDER = [0xe8e8e4, 0xdedbd4, 0xd2d0cb, 0x3a3c3f];
  const TIMBER = [0x8a6a4a, 0x9c7b56, 0x6e5640, 0x7d6650];
  const METAL = [0x2c2f33, 0x3a3d40, 0x4a4c4e];

  CBZ.registerFacade("techhouse", {
    label: "Modern House",
    structure: "glassbox",
    crownsRoof: true,
    ownDoor: true,
    maxStoreys: 3,
    build: function (ctx, F, spec) {
      const HP = CBZ.HOUSE_PARTS;
      if (!HP) return;
      const H = HP.begin(ctx, F);
      const FH = H.FH, ST = H.ST, rTop = H.rTop, df = H.df, S = df.span;
      const render = H.pick(0x7e01, RENDER), dark = render < 0x808080;
      const timber = spec && spec.timberHex != null ? spec.timberHex : H.pick(0x7e02, TIMBER);
      const metal = H.pick(0x7e03, METAL);
      const topMetal = H.hash(0x7e04) < 0.35;                 // dark metal top instead of timber
      const top = topMetal ? metal : timber, topD = HP.shade(top, 0.78);
      const SK = 0.06;
      const split = ST >= 2 ? FH : -1;                         // the material change

      H.publish({ body: render, trim: metal, roof: metal, flat: true });

      // ---- THE OPENINGS: wide glass to the street, slots elsewhere ------------------
      const holes = [];
      const dh = H.doorHole();
      if (dh) holes.push(dh);
      const frameT = H.sign(0x7e05) * Math.min(S * 0.18, Math.max(0, S / 2 - 2.6));
      for (const f of H.faces) {
        const front = f.s === df.s;
        for (let k = 0; k < ST; k++) {
          if (front && k >= 1 && k === ST - 1) {
            holes.push(H.win(f, k, frameT, HP.clamp(S * 0.38, 2.4, 4.6), 0.6, 2.7));
            continue;
          }
          const row = H.row(f, k, front ? { per: 4.0, w: 2.4, sill: 0.6, head: 2.7, margin: 1.0 } : { per: 2.6, w: 0.7, sill: 0.6, head: 2.7, margin: 0.9 });
          for (const op of row) holes.push(op);
        }
      }

      // ---- THE WALLS: render below, battens or metal above, a parapet coping ---------
      const parTop = rTop + H.PP + 0.18;
      const yS = split > 0 ? split : parTop;
      H.skinAll(0.15, yS, holes, render, SK);
      if (split > 0) {
        H.skinAll(yS, parTop, holes, HP.shade(top, 0.9), SK);
        for (const f of H.faces) {
          const ext = f.horiz ? SK : 0;
          const pitch = topMetal ? 0.45 : 0.13;
          for (let t = -f.span / 2 - ext + pitch / 2; t < f.span / 2 + ext; t += pitch) {
            const cuts = [];
            for (const h of holes) if (h.s === f.s && h.k >= 1 && t + 0.04 > h.t0 - 0.02 && t - 0.04 < h.t1 + 0.02) cuts.push([h.y0 - 0.02, h.y1 + 0.02]);
            for (const rr of HP.spans(yS, parTop - 0.02, cuts)) H.fb(f, t - (topMetal ? 0.015 : 0.035), t + (topMetal ? 0.015 : 0.035), rr[0], rr[1], SK - 0.01, SK + (topMetal ? 0.025 : 0.035), topMetal ? HP.shade(metal, 1.25) : top);
          }
        }
        H.belt(yS - 0.06, yS + 0.04, holes, SK + 0.05, metal);           // a shadow-gap reveal at the change
      }
      H.belt(-0.3, 0.15, holes, SK + 0.02, 0x5a5a58);
      H.belt(parTop, parTop + 0.06, [], SK + 0.08, metal);                // the coping
      // the roof deck the coping rings, and a solar array on it
      H.ab(-H.W / 2 + 0.2, H.W / 2 - 0.2, rTop + 0.02, rTop + 0.12, -H.D / 2 + 0.2, H.D / 2 - 0.2, 0x6c6e6c);
      if ((spec && spec.solar) || H.hash(0x7e06) < 0.55) {
        const n = Math.max(1, Math.floor((H.W - 2) / 1.8));
        for (let i = 0; i < n && !ctx.grid; i++) {
          const x = -H.W / 2 + 1.0 + 0.85 + i * 1.8;
          for (let j = 0; j < 4; j++) H.ab(x - 0.8, x + 0.8, rTop + 0.35 + j * 0.06, rTop + 0.41 + j * 0.06, -0.9 + j * 0.45, -0.45 + j * 0.45, 0x1c2632);
        }
      }

      // ---- THE PICTURE FRAME round the big upper window -------------------------------
      for (const op of holes) {
        if (op.door) continue;
        const f = op.f, big = op.t1 - op.t0 > 2.2 && op.k >= 1;
        if (big) {
          const fw = 0.26, d0 = SK - 0.01, d1 = SK + 0.7;
          H.fb(f, op.t0 - fw, op.t0 - 0.015, op.y0 - fw, op.y1 + fw, d0, d1, dark ? 0xd8d6d0 : metal);
          H.fb(f, op.t1 + 0.015, op.t1 + fw, op.y0 - fw, op.y1 + fw, d0, d1, dark ? 0xd8d6d0 : metal);
          H.fb(f, op.t0 - fw, op.t1 + fw, op.y1 + 0.015, op.y1 + fw, d0, d1, dark ? 0xd8d6d0 : metal);
          H.fb(f, op.t0 - fw, op.t1 + fw, op.y0 - fw, op.y0 - 0.015, d0, d1, dark ? 0xd8d6d0 : metal);
        } else {
          // a flush steel sill, nothing else: the glass is the ornament
          H.fb(f, op.t0 - 0.03, op.t1 + 0.03, op.y0 - 0.06, op.y0 - 0.015, SK - 0.01, SK + 0.05, metal);
        }
      }

      // ---- THE ENTRANCE: a cantilevered canopy, a flush pivot door, a timber soffit ----
      H.doorColour(dark ? timber : metal);
      if (!H.noDoor && !H.driveIn) {
        const cy = Math.min(FH - 0.25, 2.95), cw = Math.max(H.doorW + 2.2, 3.4), cd = 1.6;
        H.fb(df, -cw / 2, cw / 2, cy, cy + 0.22, 0, cd, render === 0x3a3c3f ? 0xd8d6d0 : HP.shade(render, 0.95));
        H.fb(df, -cw / 2 + 0.04, cw / 2 - 0.04, cy - 0.03, cy, 0.02, cd - 0.04, timber);
        H.lamp(df, -0.6, cy - 0.06, cd * 0.55, 0.06, 0xfff0d0);
        H.lamp(df, 0.6, cy - 0.06, cd * 0.55, 0.06, 0xfff0d0);
        H.fb(df, -H.doorW / 2 - 0.5, H.doorW / 2 + 0.5, -0.3, H.DECK, 0, 1.2, 0x8a8a86);    // a concrete threshold slab
        H.platF(df, -H.doorW / 2 - 0.5, H.doorW / 2 + 0.5, 0, 1.2, H.DECK);
        H.fb(df, -H.doorW / 2 - 0.06, -H.doorW / 2 - 0.01, 0.1, H.doorH + 0.06, SK - 0.02, SK + 0.03, metal);
        H.fb(df, H.doorW / 2 + 0.01, H.doorW / 2 + 0.06, 0.1, H.doorH + 0.06, SK - 0.02, SK + 0.03, metal);
        H.fb(df, -H.doorW / 2 - 0.06, H.doorW / 2 + 0.06, H.doorH + 0.02, H.doorH + 0.07, SK - 0.02, SK + 0.03, metal);
      }
    },
  });
})();
