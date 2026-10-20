/* ============================================================
   city/facades/queenanne.js — "Queen Anne": the American Queen Anne house,
   1880-1910.

   WHAT A QUEEN ANNE IS (the references: phmc.state.pa.us Queen Anne
   1880-1910, architecturestyles.org/queen-anne, buffaloah.com Queen Anne,
   Wikipedia "New World Queen Anne Revival architecture"):
     • ASYMMETRY on principle: nothing is centred but the door
     • a steep (40-50 deg) HIPPED main roof broken by CROSS GABLES, the front
       one over a projecting BAY WINDOW
     • a round or polygonal corner TOWER with a conical "candle-snuffer" roof
     • a deep PORCH (2-2.5 m) on turned posts with sawn brackets and a
       SPINDLE FRIEZE, a balustrade, a low hipped porch roof
     • MULTI-TEXTURED walls: clapboard below, FISH-SCALE SHINGLES on the
       upper storey and in the gables, split by a belt
     • tall narrow 1-over-1 windows in wide casings with moulded caps
     • three-colour paint: a mid-tone body, a light trim, a darker shingle
       accent, a deep door
     • a tall corbelled brick chimney off the ridge

   Built with the one carpentry in city/facades/house_parts.js.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  // [body, trim, shingle, door, roof] — period paint, not candy
  const SETS = [
    [0x6e7a5c, 0xe3dcc6, 0x8a5a3e, 0x5b2421, 0x3a3634],
    [0x5d6f78, 0xe8e2d2, 0x44535c, 0x7e3527, 0x33363a],
    [0x9a8661, 0xece5d3, 0x6b4a33, 0x2a3a30, 0x3c3530],
    [0x7a4b3c, 0xe6dcc0, 0x56634a, 0x2c2a26, 0x35322f],
    [0xa59b84, 0xf0ebdc, 0x6e5a62, 0x3e2f3e, 0x37343a],
  ];

  CBZ.registerFacade("queenanne", {
    label: "Queen Anne",
    structure: "timber",
    crownsRoof: true,
    ownDoor: true,
    maxStoreys: 4,
    build: function (ctx, F, spec) {
      const HP = CBZ.HOUSE_PARTS;
      if (!HP) return;
      const H = HP.begin(ctx, F);
      const FH = H.FH, ST = H.ST, rTop = H.rTop, df = H.df, S = df.span;
      const set = H.pick(0x9a01, SETS);
      const body = H.tint(set[0], 0.06), trim = set[1], shin = H.tint(set[2], 0.04), door = set[3], roof = set[4];
      const bodyD = HP.shade(body, 0.84), shinD = HP.shade(shin, 0.86), trimD = HP.shade(trim, 0.9);
      const glass = F.glass(ctx, 0x1d252d);
      const SK = 0.05;

      H.publish({ body: body, trim: trim, roof: roof, flat: false });

      // ---- THE PARTI: which corner gets the tower, which half the bay -------
      let sT = H.sign(0x9a02);
      if (spec && spec.turret === "left") sT = -1;
      if (spec && spec.turret === "right") sT = 1;
      const rT = HP.clamp(H.unit * 0.12, 1.0, 1.45);
      const towerOn = !H.noDoor && S >= 8 && !ctx.grid;
      const tC = sT * (S / 2 - 0.35 * rT);                         // tower centre along the door face
      const tp = H.pt(df, tC, 0.35 * rT);                           // ... in local coords
      const sideS = df.horiz ? (sT > 0 ? 3 : 2) : (sT > 0 ? 1 : 0);
      const sideF = H.face(sideS);
      const tSide = sideF.horiz ? tp.x : tp.z;
      const bayW = S / 2 - 2.35;
      const bayOn = !H.noDoor && bayW >= 2.0;
      const tB = -sT * (1.85 + bayW / 2);                           // bay centre
      const pitch = 0.95, eave = 0.45;
      const base = H.eaveBase(pitch, eave);
      const belt = ST >= 2 ? (ST - 1) * FH : -1;                    // shingles from here up

      // ---- THE OPENINGS --------------------------------------------------------
      const holes = [];
      const dh = H.doorHole();
      if (dh) holes.push(dh);
      for (const f of H.faces) {
        for (let k = 0; k < ST; k++) {
          const row = H.row(f, k, { per: 2.8, w: 0.85, sill: 0.75, head: 2.45, margin: 1.0,
            skip: function (t, w) {
              if (towerOn && f.s === df.s && Math.abs(t - tC) < rT * 1.05 + w / 2 + 0.2) return true;
              if (towerOn && f.s === sideS && Math.abs(t - tSide) < rT * 1.05 + w / 2 + 0.2) return true;
              if (bayOn && f.s === df.s && k < 2 && Math.abs(t - tB) < bayW / 2 + w / 2 + 0.15) return true;
              return false;
            } });
          for (const op of row) holes.push(op);
        }
      }

      // ---- THE WALLS: clapboard below the belt, fish-scale shingle above -------
      const yBelt = belt > 0 ? belt : base;
      H.skinAll(0.3, yBelt, holes, body, SK);
      for (const f of H.faces) H.courses(f, 0.3, yBelt, holes, 0.24, 0.03, SK + 0.018, bodyD);
      if (belt > 0) {
        H.skinAll(yBelt, base - 0.02, holes, shin, SK);
        for (const f of H.faces) H.courses(f, yBelt + 0.1, base - 0.2, holes, 0.2, 0.05, SK + 0.02, shinD, { alt: HP.shade(shin, 1.08) });
        H.belt(yBelt - 0.1, yBelt + 0.12, holes, SK + 0.05, trim);
        H.belt(yBelt - 0.2, yBelt - 0.1, holes, SK + 0.03, trimD);
      }
      H.belt(-0.3, 0.32, holes, SK + 0.05, HP.mix(0x8a5a46, body, 0.2));    // a brick foundation
      H.belt(0.3, 0.42, holes, SK + 0.06, trim);                          // the water table
      H.cornerBoards(0.42, base - 0.02, 0.15, SK + 0.03, trim);
      // the frieze board under the eave, on all four faces
      H.belt(base - 0.3, base - 0.03, [], SK + 0.04, trim);

      // ---- WINDOW TRIM -------------------------------------------------------------
      for (const op of holes) {
        if (op.door) continue;
        H.trim(op, { skin: SK, cw: 0.12, cp: 0.03, col: trim, head: op.s === df.s && op.k === 0 ? "ped" : "cap",
          sill: { h: 0.07, proj: 0.07, over: 0.05, col: trim }, apron: op.k === 0 });
      }

      // ---- THE ROOF: a steep hip broken by cross gables --------------------------
      const roofO = { pitch: pitch, step: 0.14, eave: eave, rake: 0.32, roof: roof, roof2: HP.shade(roof, 0.88),
        soffit: trimD, fascia: trim, gutter: null, ridge: HP.shade(roof, 0.78), rakeBoard: true };
      const r = H.roof(Object.assign({ kind: "hip", axis: df.horiz ? "x" : "z", base: base, hipCaps: true }, roofO));
      // the front cross gable over the bay, shingled in its gable
      const gables = [];
      if (bayOn) gables.push({ f: df, tc: tB, w: bayW + 0.7 });
      const oppS = df.horiz ? (sT > 0 ? 2 : 3) : (sT > 0 ? 0 : 1);
      const oppF = H.face(oppS);
      gables.push({ f: oppF, tc: oppF.span * 0.12 * H.sign(0x9a03), w: HP.clamp(oppF.span * 0.42, 3.0, 5.5) });
      for (const g of gables) {
        const cg = H.crossGable(g.f, g.tc, g.w, g.f.halfN * 0.85, Object.assign({ base: base, core: shin, coreAlt: HP.shade(shin, 1.1), coreProj: 0.11 }, roofO, { pitch: 1.1 }));
        // the gable's attic window and the collar band across its foot
        const yA = base + 0.55, hA = Math.min(1.1, (g.w / 2) * 1.1 - 1.0);
        if (hA > 0.5) {
          H.fb(g.f, g.tc - 0.4, g.tc + 0.4, yA, yA + hA, 0.11, 0.15, glass);
          H.fb(g.f, g.tc - 0.52, g.tc - 0.4, yA - 0.05, yA + hA + 0.05, 0.11, 0.17, trim);
          H.fb(g.f, g.tc + 0.4, g.tc + 0.52, yA - 0.05, yA + hA + 0.05, 0.11, 0.17, trim);
          H.fb(g.f, g.tc - 0.55, g.tc + 0.55, yA + hA + 0.05, yA + hA + 0.15, 0.11, 0.19, trim);
          H.fb(g.f, g.tc - 0.6, g.tc + 0.6, yA - 0.12, yA - 0.05, 0.11, 0.2, trim);
        }
        H.fb(g.f, g.tc - g.w / 2, g.tc + g.w / 2, base + 0.0, base + 0.14, 0.11, 0.2, trim);
        void cg;
      }

      // ---- THE BAY WINDOW under the front gable -----------------------------------
      if (bayOn) {
        const yTop = Math.min(2, ST) * FH - 0.25;
        const facets = [
          { t0: tB - bayW * 0.28, t1: tB + bayW * 0.28, d: 0.75 },
          { t0: tB - bayW / 2, t1: tB - bayW * 0.28, d: 0.42 },
          { t0: tB + bayW * 0.28, t1: tB + bayW / 2, d: 0.42 },
        ];
        for (const fc of facets) {
          H.fb(df, fc.t0, fc.t1, 0.3, yTop, 0.06, fc.d, body);
          H.fb(df, fc.t0 - 0.02, fc.t1 + 0.02, 0.3, 0.75, 0.06, fc.d + 0.03, bodyD);
          for (let k = 0; k < Math.min(2, ST); k++) {
            const y0 = k * FH + 0.8, y1 = k * FH + 2.4;
            if (y1 > yTop - 0.15) break;
            const iw = (fc.t1 - fc.t0) - 0.26;
            if (iw < 0.3) continue;
            H.fb(df, fc.t0 + 0.13, fc.t1 - 0.13, y0, y1, fc.d, fc.d + 0.02, glass);
            H.fb(df, fc.t0 + 0.02, fc.t0 + 0.13, y0 - 0.05, y1 + 0.05, fc.d, fc.d + 0.04, trim);
            H.fb(df, fc.t1 - 0.13, fc.t1 - 0.02, y0 - 0.05, y1 + 0.05, fc.d, fc.d + 0.04, trim);
            H.fb(df, fc.t0, fc.t1, y1 + 0.05, y1 + 0.17, fc.d, fc.d + 0.05, trim);
            H.fb(df, fc.t0, fc.t1, y0 - 0.12, y0 - 0.04, fc.d, fc.d + 0.07, trim);
          }
          H.fb(df, fc.t0 - 0.05, fc.t1 + 0.05, yTop, yTop + 0.16, 0.06, fc.d + 0.12, trim);
        }
      }

      // ---- THE CORNER TOWER: an octagonal drum, a candle-snuffer cone -------------
      if (towerOn) {
        const tTop = base + 0.9;
        ctx.column(tp.x, 0.3, tp.z, rT, yBelt - 0.3, body, 12);
        if (belt > 0) ctx.column(tp.x, yBelt, tp.z, rT * 1.004, tTop - yBelt, shin, 12);
        ctx.column(tp.x, -0.2, tp.z, rT * 1.05, 0.62, HP.mix(0x8a5a46, body, 0.2), 12);
        for (let k = 1; k < ST; k++) ctx.column(tp.x, k * FH - 0.12, tp.z, rT * 1.05, 0.24, trim, 12);
        ctx.column(tp.x, tTop - 0.32, tp.z, rT * 1.09, 0.36, trim, 12);
        ctx.column(tp.x, tTop + 0.04, tp.z, rT * 1.16, 0.12, trimD, 12);
        if (ctx.cone) ctx.cone(tp.x, tTop + 0.16, tp.z, rT * 1.18, rT * 2.7, roof);
        if (ctx.ball) ctx.ball(tp.x, tTop + 0.16 + rT * 2.7 + 0.12, tp.z, 0.14, 0x3a3a38);
        // its windows: on the two street-facing quarters, every storey and one more
        const dirs = [];
        const nD = df.horiz ? { x: 0, z: df.out } : { x: df.out, z: 0 };
        const nS = sideF.horiz ? { x: 0, z: sideF.out } : { x: sideF.out, z: 0 };
        dirs.push(nD, nS);
        for (let k = 0; k <= ST; k++) {
          const y0 = k * FH + 0.85, y1 = Math.min(k * FH + 2.35, tTop - 0.45);
          if (y1 - y0 < 0.6) break;
          for (const n of dirs) {
            const gx = tp.x + n.x * (rT - 0.02), gz = tp.z + n.z * (rT - 0.02);
            const along = n.x === 0;
            const bw = 0.62;
            H.ab(gx - (along ? bw / 2 : 0.05), gx + (along ? bw / 2 : 0.05), y0, y1, gz - (along ? 0.05 : bw / 2), gz + (along ? 0.05 : bw / 2), glass);
            const tx = tp.x + n.x * (rT + 0.02), tz = tp.z + n.z * (rT + 0.02);
            H.ab(tx - (along ? 0.42 : 0.05), tx + (along ? 0.42 : 0.05), y1, y1 + 0.12, tz - (along ? 0.05 : 0.42), tz + (along ? 0.05 : 0.42), trim);
            H.ab(tx - (along ? 0.42 : 0.06), tx + (along ? 0.42 : 0.06), y0 - 0.1, y0, tz - (along ? 0.06 : 0.42), tz + (along ? 0.06 : 0.42), trim);
          }
        }
        // the scan's blocker (the drum is a round mesh it cannot see) and a body
        H.ab(tp.x - rT * 0.6, tp.x + rT * 0.6, 0.3, rTop - 0.2, tp.z - rT * 0.6, tp.z + rT * 0.6, body);
        if (ctx.solid) try { ctx.solid(tp.x, (tTop + 0.3) / 2, tp.z, rT * 1.5, tTop - 0.3, rT * 1.5); } catch (e) {}
      }

      // ---- THE PORCH: turned posts, sawn brackets, a spindle frieze -------------
      if (!H.noDoor && !H.driveIn) {
        const a = bayOn ? -sT * 1.62 : -sT * (S / 2 - 0.05);
        const b = towerOn ? sT * (S / 2 - 1.4 * rT) : sT * (S / 2 - 0.05);
        const t0 = Math.min(a, b), t1 = Math.max(a, b);
        if (t1 - t0 >= H.doorW + 1.0) {
          const dep = HP.clamp(H.unit * 0.17, 1.6, 2.3);
          const p = H.porch(df, t0, t1, dep, { deckCol: HP.mix(0x8a7a62, body, 0.2), postCol: trim, beamCol: trim, post: 0.15,
            bay: 2.2, beamB: Math.min(FH - 0.42, 2.72), beamH: 0.22, railCol: trim, ceilCol: HP.mix(0x8fb0b4, trim, 0.4),
            brackets: trim, frieze: trim, skirtCol: HP.shade(body, 0.55) });
          H.porchHip(df, t0, t1, dep, p.top, { pitch: 0.38, step: 0.12, eave: 0.25, roof: roof, roof2: HP.shade(roof, 0.88),
            soffit: trimD, fascia: trim, ridge: HP.shade(roof, 0.78) });
        }
      }

      // ---- THE DOOR -------------------------------------------------------------------
      H.doorColour(door);
      H.doorcase("casing", { col: trim, skin: SK, w: 0.16, lamp: { col: 0xffd79a, side: -sT } });

      // ---- THE CHIMNEY: a tall corbelled stack off the ridge, away from the tower ------
      const cp = H.pt(oppF, oppF.span * 0.18 * -H.sign(0x9a03), -Math.min(2.2, oppF.halfN * 0.5));
      H.chimney({ x: cp.x, z: cp.z, w: 0.95, dp: 0.62, top: r.top + 0.7, brick: HP.mix(0x8a4a36, body, 0.08),
        cap: HP.mix(0x8a4a36, 0x000000, 0.25), pots: 2 });
    },
  });
})();
