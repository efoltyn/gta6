/* ============================================================
   city/facades/ranch.js — "Ranch": the American ranch house, 1940-1975.

   WHAT A RANCH IS (the references: Wikipedia "Ranch-style house",
   maverickframe.com ranch-style house, homesandgardens.com "What is a
   ranch-style house", rigov.org Ranch):
     • LONG and LOW: one storey, the ridge parallel to the street, a LOW
       pitch (4:12-5:12, ~20 deg), a WIDE EAVE (0.6-0.8 m) with a deep fascia
     • a big PICTURE WINDOW in the living room beside the door, smaller
       bedroom windows set HIGH (ribbon windows), little ornament
     • an ATTACHED GARAGE at one end of the front
     • mixed cladding: a BRICK wainscot / base, siding or BOARD-AND-BATTEN
       above, decorative shutters on some
     • a small recessed or shed-roofed entry porch on simple posts
     • a broad low brick CHIMNEY
     • tract colours: beige, sage, grey-blue, taupe, barn red; white trim;
       grey-brown asphalt shingles

   On 2-4 storeys (a town's taller lots) it stays the same house stacked:
   the same skins, a belt at each floor, the same low roof.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  const BODY = [0xc2b8a3, 0x8f9a86, 0x93a0a6, 0xa89a88, 0xd9d3c4, 0x8a5446];
  const ROOF = [0x4a4a48, 0x5a5048, 0x3e4245, 0x55524c];
  const BRICK = [0x8b5a46, 0x9a6a54, 0x7a5040, 0x8f7768];
  const DOOR = [0x2e4a5a, 0x6b2a24, 0x2f3a2c, 0x7a5a2a, 0x2a2a2a];

  CBZ.registerFacade("ranch", {
    label: "Ranch House",
    structure: "timber",
    crownsRoof: true,
    ownDoor: true,
    maxStoreys: 4,
    build: function (ctx, F) {
      const HP = CBZ.HOUSE_PARTS;
      if (!HP) return;
      const H = HP.begin(ctx, F);
      const FH = H.FH, ST = H.ST, rTop = H.rTop, df = H.df, S = df.span;
      const body = H.tint(H.pick(0x7a01, BODY), 0.06), bodyD = HP.shade(body, 0.84);
      const trim = HP.mix(0xece8de, body, 0.06), trimD = HP.shade(trim, 0.9);
      const roof = H.pick(0x7a02, ROOF), brick = H.tint(H.pick(0x7a03, BRICK), 0.05);
      const door = H.pick(0x7a04, DOOR);
      const batten = H.hash(0x7a05) < 0.4;             // board-and-batten vs lap siding
      const shutters = H.hash(0x7a06) < 0.5;
      const hipped = H.hash(0x7a07) < 0.35;
      const SK = 0.05;
      const wains = 0.95;                               // the brick wainscot's top

      // ---- THE PARTI: garage at one end, picture window beside the door ------
      const gS = H.sign(0x7a08);
      const garW = S >= 15 ? 4.9 : 2.75;
      const garOn = !H.noDoor && !H.driveIn && !ctx.grid && S >= 11;
      const garT = gS * (S / 2 - 0.55 - garW / 2);
      const picOn = !H.noDoor && S >= 8;
      const picW = HP.clamp(S * 0.17, 1.8, 2.6);
      const picT = -gS * (H.DOOR_CLEAR + picW / 2 + 0.1);

      // ---- THE OPENINGS ------------------------------------------------------------
      const holes = [];
      const dh = H.doorHole();
      if (dh) holes.push(dh);
      if (picOn) holes.push(H.win(df, 0, picT, picW, 0.62, 2.3));
      for (const f of H.faces) {
        for (let k = 0; k < ST; k++) {
          const front = f.s === df.s;
          const row = H.row(f, k, { per: 3.2, w: front ? 1.2 : 1.35, sill: front || k > 0 ? 0.85 : 1.15, head: 2.25, margin: 1.0,
            skip: function (t, w) {
              if (front && k === 0 && garOn && Math.abs(t - garT) < garW / 2 + w / 2 + 0.3) return true;
              if (front && k === 0 && picOn && Math.abs(t - picT) < picW / 2 + w / 2 + 0.35) return true;
              return false;
            } });
          for (const op of row) holes.push(op);
        }
      }

      // ---- THE ROOF (low, wide-eaved) ---------------------------------------------
      const pitch = 0.38 + H.hash(0x7a09) * 0.06, eave = 0.68;
      const base = H.eaveBase(pitch, eave);
      const ridgeX = df.horiz;

      // ---- THE WALLS ---------------------------------------------------------------------
      // the brick wainscot (the whole ground storey on some), siding above
      const brickTop = H.hash(0x7a0a) < 0.3 ? Math.min(FH - 0.3, base) : wains;
      H.skinAll(0.2, brickTop, holes, brick, SK + 0.03);
      for (const f of H.faces) H.courses(f, 0.2, brickTop, holes, 0.3, 0.025, SK + 0.04, HP.shade(brick, 0.88));
      H.belt(brickTop, brickTop + 0.07, holes, SK + 0.07, HP.shade(brick, 1.1));       // the rowlock cap
      H.skinAll(brickTop + 0.07, base - 0.02, holes, body, SK);
      for (const f of H.faces) {
        if (batten) {
          // battens every 0.4 m, cut round the holes
          const ext = f.horiz ? SK : 0;
          for (let t = -f.span / 2 - ext + 0.2; t < f.span / 2 + ext - 0.1; t += 0.4) {
            const cuts = [];
            for (const h of holes) if (h.s === f.s && t + 0.03 > h.t0 - 0.03 && t - 0.03 < h.t1 + 0.03) cuts.push([h.y0 - 0.06, h.y1 + 0.06]);
            for (const r of HP.spans(brickTop + 0.07, base - 0.3, cuts)) H.fb(f, t - 0.03, t + 0.03, r[0], r[1], SK - 0.01, SK + 0.025, bodyD);
          }
        } else {
          H.courses(f, brickTop + 0.07, base - 0.3, holes, 0.2, 0.03, SK + 0.018, bodyD);
        }
      }
      for (let k = 1; k < ST; k++) H.belt(k * FH - 0.05, k * FH + 0.12, holes, SK + 0.04, trim);
      H.cornerBoards(brickTop + 0.07, base - 0.02, 0.14, SK + 0.03, trim);
      H.belt(-0.3, 0.2, holes, SK + 0.04, 0x9c998f);                                   // the slab edge

      // ---- WINDOW TRIM -------------------------------------------------------------------
      for (const op of holes) {
        if (op.door) continue;
        const big = op.t1 - op.t0 > 1.7;
        H.trim(op, { skin: SK, cw: 0.1, cp: 0.025, col: trim, head: "flat",
          sill: { h: 0.06, proj: 0.06, over: 0.04, col: trim },
          shut: shutters && !big && op.y0 < FH * (op.k + 1) - 2.0 ? { col: HP.shade(door, 0.9), w: 0.42, louvre: false } : null });
      }

      // ---- THE ATTACHED GARAGE: a sectional door under the eave -------------------------
      if (garOn) {
        const gh = 2.2, gt0 = garT - garW / 2, gt1 = garT + garW / 2;
        const gcol = HP.mix(0xe6e2d8, body, 0.15);
        H.fb(df, gt0 - 0.14, gt1 + 0.14, 0.0, gh + 0.14, SK - 0.01, SK + 0.04, trim);
        H.fb(df, gt0, gt1, 0.0, gh, SK + 0.04, SK + 0.08, gcol);
        for (let i = 1; i < 4; i++) H.fb(df, gt0, gt1, gh * i / 4 - 0.015, gh * i / 4 + 0.015, SK + 0.08, SK + 0.095, HP.shade(gcol, 0.85));
        const np = Math.round(garW / 0.7);
        for (let i = 1; i < np; i++) { const t = gt0 + garW * i / np; H.fb(df, t - 0.012, t + 0.012, 0.05, gh - 0.05, SK + 0.08, SK + 0.09, HP.shade(gcol, 0.88)); }
        // the apron the drive meets
        H.fb(df, gt0 - 0.2, gt1 + 0.2, -0.3, 0.06, 0, 1.2, 0xa8a59c);
        H.platF(df, gt0 - 0.2, gt1 + 0.2, 0, 1.2, 0.06);
        // a coach light each side
        for (const sg of [-1, 1]) {
          const t = sg < 0 ? gt0 - 0.4 : gt1 + 0.4;
          H.fb(df, t - 0.06, t + 0.06, 1.75, 2.05, SK, SK + 0.04, 0x2a2a2a);
          H.lamp(df, t, 1.85, SK + 0.12, 0.07, 0xffd79a);
        }
      }

      // ---- THE ROOF ----------------------------------------------------------------------------
      const r = H.roof({ kind: hipped ? "hip" : "gable", axis: ridgeX ? "x" : "z", base: base, pitch: pitch, step: 0.13, eave: eave, rake: 0.5,
        roof: roof, roof2: HP.shade(roof, 0.9), core: body, soffit: trim, fascia: trim, fasciaH: 0.26, gutter: HP.shade(trim, 0.86),
        ridge: HP.shade(roof, 0.8), rakeBoard: true, hipCaps: true });
      // gable vents
      if (!hipped) for (const f of H.faces) {
        if (f.horiz === ridgeX) continue;
        H.fb(f, -0.4, 0.4, base + 0.35, base + 0.85, 0.11, 0.15, trim);
        for (let y = base + 0.42; y < base + 0.8; y += 0.1) H.fb(f, -0.32, 0.32, y, y + 0.03, 0.15, 0.17, trimD);
      }

      // ---- THE ENTRY: a small shed-roofed stoop on two posts -----------------------------------
      H.doorColour(door);
      H.doorcase("casing", { col: trim, skin: SK, w: 0.14, lamp: { col: 0xffd79a, side: gS } });
      if (!H.noDoor && !H.driveIn) {
        const pw = HP.clamp(S * 0.22, 2.6, 3.6), dep = 1.5;
        const p = H.porch(df, -pw / 2, pw / 2, dep, { deckCol: 0xa8a59c, postCol: trim, post: 0.13, bay: pw, beamB: Math.min(2.6, base - 0.75), beamH: 0.2,
          ceilCol: trim, skirtCol: 0x8f8c84 });
        H.roofF(df, -pw / 2, pw / 2, 0, dep, { base: p.top, kind: "shed", pitch: 0.26, step: 0.1, eave: 0.2, rake: 0.15, roof: roof, roof2: HP.shade(roof, 0.9),
          soffit: trim, fascia: trim, rakeBoard: true });
      }

      // ---- THE CHIMNEY: broad and low, on a gable end -------------------------------------------
      const cf = H.face(ridgeX ? (gS > 0 ? 2 : 3) : (gS > 0 ? 0 : 1));
      if (!ctx.grid && !hipped) {
        const ct = HP.clamp(cf.span * 0.2, 0, cf.span / 2 - 1.2) * H.sign(0x7a0b);
        const clash = holes.some(function (h) { return h.s === cf.s && Math.abs((h.t0 + h.t1) / 2 - ct) < (h.t1 - h.t0) / 2 + 0.9; });
        if (!clash) H.chimney({ f: cf, t: ct, w: 1.25, dp: 0.65, top: r.top + 0.65, brick: brick, cap: HP.shade(brick, 1.1), pots: 1, shoulder: Math.min(rTop - 0.6, 2.4) });
        else H.chimney({ x: cf.horiz ? ct : cf.out * (cf.halfN - 1.2), z: cf.horiz ? cf.out * (cf.halfN - 1.2) : ct, w: 1.25, dp: 0.7, top: r.top + 0.6, brick: brick, pots: 1 });
      } else if (!ctx.grid) {
        H.chimney({ x: gS * H.W * 0.2, z: 0, w: 1.25, dp: 0.7, top: r.top + 0.6, brick: brick, pots: 1 });
      }
    },
  });
})();
