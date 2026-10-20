/* ============================================================
   city/facades/manor.js — "Tudor Manor": the Tudor Revival house, 1890-1940.

   WHAT IT IS (the references: phmc.state.pa.us Tudor Revival 1890-1920,
   Wikipedia "Tudor Revival architecture", vancouverheritagefoundation.org
   Tudor Revival, architecturecourses.org "Tudor-Style Houses"):
     • STEEP roofs (45-55 deg), side-gabled, broken by one or two dominant
       FRONT-FACING CROSS GABLES, often a lower one nested beside a taller
     • HALF-TIMBERING: dark timber studs, rails and braces over pale stucco
       on the upper storey and in the gables; brick or stone below
     • the upper storey of a gable JETTIED a little over the one below
     • bands of narrow LEADED CASEMENTS grouped in twos and threes
     • a massive TALL CHIMNEY with clustered stacks and pots, often on the
       front
     • a round- or Tudor-ARCHED front door in a stone surround
     • brick / stone, cream stucco, near-black timber, slate or clay tile

   Built with the one carpentry in city/facades/house_parts.js.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  const BRICK = [0x7a4434, 0x6e3e30, 0x84503c];
  const STONE = [0x9a9282, 0x8a8478, 0xa59d8b];
  const STUCCO = [0xe2dccb, 0xd8cfb8, 0xe6e0d0];
  const TIMBER = [0x3a2a1f, 0x2e241c, 0x4a3426];
  const ROOF = [0x4a3f3a, 0x5a4034, 0x3a3836, 0x524640];

  CBZ.registerFacade("manor", {
    label: "Tudor Manor",
    structure: "masonry",
    crownsRoof: true,
    ownDoor: true,
    maxStoreys: 4,
    build: function (ctx, F, spec) {
      const HP = CBZ.HOUSE_PARTS;
      if (!HP) return;
      const H = HP.begin(ctx, F);
      const FH = H.FH, ST = H.ST, rTop = H.rTop, df = H.df, S = df.span;
      const stoneWalls = (spec && spec.walls === "stone") || (!(spec && spec.walls === "brick") && H.hash(0x3b01) < 0.35);
      const lower = H.tint(stoneWalls ? H.pick(0x3b02, STONE) : H.pick(0x3b02, BRICK), 0.05);
      const stucco = H.pick(0x3b03, STUCCO), timber = H.pick(0x3b04, TIMBER), roof = H.pick(0x3b05, ROOF);
      const stone = HP.mix(0xb3aa98, lower, 0.15);
      const glass = F.glass(ctx, 0x1d2328);
      const SK = 0.06;
      const upFrom = ST >= 2 ? FH : FH * 0.55;             // half-timbering from here up

      // ---- THE PARTI: a main cross gable and a smaller nested one ----------------
      const gS = H.sign(0x3b06);
      const g1w = HP.clamp(S * 0.36, 3.2, 5.6), g1t = gS * (S / 2 - g1w / 2 - 0.25);
      const g2w = HP.clamp(S * 0.22, 2.4, 3.6), g2t = -gS * (H.DOOR_CLEAR + g2w / 2 + 0.2);
      const g2On = S >= 13 && !ctx.grid;
      const chOn = !ctx.grid && S >= 10;
      const chT = gS * (H.doorW / 2 + 0.95);              // the front chimney, beside the door, opposite the nested gable

      // ---- THE OPENINGS: grouped casements --------------------------------------
      const holes = [];
      const dh = H.doorHole();
      if (dh) holes.push(dh);
      for (const f of H.faces) {
        for (let k = 0; k < ST; k++) {
          const front = f.s === df.s;
          const row = H.row(f, k, { per: 3.3, w: front ? 1.6 : 1.3, sill: 0.85, head: 2.3, margin: 1.0,
            skip: function (t, w) { return front && chOn && Math.abs(t - chT) < 0.75 + w / 2 + 0.15; } });
          for (const op of row) holes.push(op);
        }
      }

      // ---- THE ROOF ---------------------------------------------------------------
      // steep, but a deep plan would put a 9 m roof on it: the rise is capped
      const across = (df.horiz ? H.D : H.W) / 2 + 0.32;
      const pitch = Math.min(1.05 + H.hash(0x3b07) * 0.2, 6.0 / across), eave = 0.32;
      const base = H.eaveBase(pitch, eave);
      const ridgeX = df.horiz;

      // ---- THE WALLS: brick/stone below, stucco and timber above -----------------
      H.skinAll(0.3, Math.min(upFrom, base), holes, lower, SK);
      if (!stoneWalls) for (const f of H.faces) H.courses(f, 0.3, Math.min(upFrom, base), holes, 0.45, 0.03, SK + 0.015, HP.shade(lower, 0.86));
      else for (const f of H.faces) H.courses(f, 0.3, Math.min(upFrom, base), holes, 0.32, 0.04, SK + 0.02, HP.shade(lower, 0.88), { alt: HP.shade(lower, 1.08) });
      H.belt(-0.3, 0.3, holes, SK + 0.05, HP.shade(lower, 0.8));
      if (upFrom < base) {
        H.skinAll(upFrom + 0.12, base - 0.02, holes, stucco, SK + 0.02);
        // the jetty: the upper storey oversails the lower by a beam
        H.belt(upFrom - 0.08, upFrom + 0.14, holes, SK + 0.12, timber);
        timbering(upFrom + 0.14, base - 0.03);
      }
      if (stoneWalls || H.hash(0x3b08) < 0.5) H.quoins(0.3, Math.min(upFrom, base) - 0.1, 0.5, 0.3, SK + 0.04, stone);

      function timbering(y0, y1) {
        for (const f of H.faces) {
          const ext = f.horiz ? SK + 0.02 : 0;
          const t0 = -f.span / 2 - ext, t1 = f.span / 2 + ext;
          const oA = SK + 0.01, oB = SK + 0.06;
          // posts every ~0.55 m, cut round the holes
          for (let t = t0 + 0.09; t < t1 - 0.05; t += 0.55) {
            const cuts = [];
            for (const h of holes) if (h.s === f.s && t + 0.09 > h.t0 - 0.02 && t - 0.09 < h.t1 + 0.02) cuts.push([h.y0 - 0.02, h.y1 + 0.02]);
            for (const rr of HP.spans(y0, y1, cuts)) H.fb(f, t - 0.09, t + 0.09, rr[0], rr[1], oA, oB, timber);
          }
          // the sill / head rails, and a mid rail
          for (const y of [y0, (y0 + y1) / 2]) {
            const cuts = [];
            for (const h of holes) if (h.s === f.s && y + 0.16 > h.y0 && y < h.y1) cuts.push([h.t0 - 0.02, h.t1 + 0.02]);
            for (const rr of HP.spans(t0, t1, cuts)) H.fb(f, rr[0], rr[1], y, y + 0.16, oA, oB + 0.01, timber);
          }
          H.fb(f, t0, t1, y1 - 0.18, y1, oA, oB + 0.01, timber);
        }
      }

      // ---- WINDOW TRIM: a timber frame round each band, a stone sill below --------
      for (const op of holes) {
        if (op.door) continue;
        const up = op.y0 >= upFrom;
        H.trim(op, { skin: up ? SK + 0.02 : SK, cw: 0.1, cp: 0.04, col: up ? timber : stone, head: up ? "flat" : "cap", headCol: stone,
          sill: { h: 0.08, proj: 0.07, over: 0.05, col: up ? timber : stone } });
        // the stone mullion that splits a grouped casement
        if (op.t1 - op.t0 > 1.2 && !up) H.fb(op.f, (op.t0 + op.t1) / 2 - 0.06, (op.t0 + op.t1) / 2 + 0.06, op.y0, op.y1, -0.14, SK + 0.02, stone);
      }

      // ---- THE ROOF: a steep side gable, cross gables to the front ----------------
      const ro = { pitch: pitch, step: 0.14, eave: eave, rake: 0.32, roof: roof, roof2: HP.shade(roof, 0.88),
        soffit: timber, fascia: timber, ridge: HP.shade(roof, 0.8), rakeBoard: true };
      const r = H.roof(Object.assign({ kind: "gable", axis: ridgeX ? "x" : "z", base: base, core: stucco }, ro));
      const gl = [{ t: g1t, w: g1w, j: 0.18 }];
      if (g2On) gl.push({ t: g2t, w: g2w, j: 0.0 });
      for (const g of gl) {
        // the gable stands a jetty proud of the wall below; its half-timbering
        H.crossGable(df, g.t, g.w, df.halfN * 0.8, Object.assign({ base: base - (g.j ? 0.25 : 0), core: stucco, coreProj: 0.11 + g.j }, ro));
        const gy0 = base - (g.j ? 0.25 : 0), half = g.w / 2;
        for (let i = 0; i < 9; i++) {
          const u = (i + 0.5) / 9 * 2 - 1, t = g.t + u * half * 0.92;
          const yt = gy0 + (half - Math.abs(u) * half) * pitch - 0.2;
          if (yt - gy0 > 0.3) H.fb(df, t - 0.08, t + 0.08, gy0 + 0.12, yt, 0.11 + g.j, 0.16 + g.j, timber);
        }
        H.fb(df, g.t - half - 0.1, g.t + half + 0.1, gy0 - 0.05, gy0 + 0.14, 0.11 + g.j - 0.02, 0.2 + g.j, timber);
        // a leaded attic casement in the gable
        if (half * pitch > 1.6) {
          const ya = gy0 + 0.45;
          H.fb(df, g.t - 0.5, g.t + 0.5, ya, ya + 0.9, 0.16 + g.j, 0.19 + g.j, glass);
          for (const tt of [-0.5, 0, 0.5]) H.fb(df, g.t + tt - 0.05, g.t + tt + 0.05, ya, ya + 0.9, 0.16 + g.j, 0.22 + g.j, timber);
          H.fb(df, g.t - 0.6, g.t + 0.6, ya + 0.9, ya + 1.02, 0.16 + g.j, 0.24 + g.j, timber);
        }
        // the jetty's brackets
        if (g.j) for (const sg of [-1, 1]) H.fb(df, g.t + sg * (half - 0.2) - 0.07, g.t + sg * (half - 0.2) + 0.07, gy0 - 0.6, gy0 - 0.05, SK, SK + g.j + 0.08, timber);
      }

      // ---- THE CHIMNEY: a tall front stack with clustered flues -------------------
      if (chOn) {
        H.chimney({ f: df, t: chT, w: 1.1, dp: 0.62, top: r.top + 0.9, brick: lower, cap: stone, pots: 3, shoulder: Math.max(1.6, base - 1.2) });
      }

      // ---- THE ENTRANCE: an arched stone surround, a stone step -------------------
      H.doorColour(HP.mix(0x4a3020, timber, 0.4));
      H.doorcase("arch", { col: stone, skin: SK, w: 0.22, lamp: { col: 0xffcf8a, side: -gS }, step: { col: stone, w: H.doorW + 0.9, d: 0.45 } });
      // a small gabled hood over it on timber brackets
      if (!H.noDoor && !H.driveIn) {
        const hy = H.doorH + 0.95, hw = H.doorW / 2 + 0.45;
        H.roofF(df, -hw, hw, 0, 0.9, { base: hy, kind: "shed", pitch: 0.9, step: 0.12, eave: 0.12, rake: 0.08, roof: roof, roof2: HP.shade(roof, 0.88), fascia: timber, rakeBoard: true });
        for (const sg of [-1, 1]) H.fb(df, sg * (hw - 0.1) - 0.06, sg * (hw - 0.1) + 0.06, hy - 0.6, hy, SK, 0.85, timber);
      }
    },
  });
})();
