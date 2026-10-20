/* ============================================================
   city/facades/spanish.js — "Spanish Colonial": the hacienda / Spanish
   Colonial Revival house, 1915-1940.

   WHAT IT IS (the references: maverickframe.com Spanish Colonial Revival
   Architecture: 1920s Guide, maverickframe.com Spanish Colonial
   Architecture, build-construct.com Spanish Colonial Revival Homes of the
   1920s, NPS National Register nominations at npgallery.nps.gov):
     • THICK smooth STUCCO walls in white / cream / warm sand — the openings
       are small and set DEEP (a 20-30 cm reveal is the style)
     • a LOW-PITCHED (3:12-4:12) roof of RED CLAY BARREL TILE, a shallow eave
       with EXPOSED RAFTER TAILS, or tile laid straight over the wall
     • an ARCADE / loggia of round arches on square piers along the front
     • WROUGHT IRON: window grilles (rejas), balcony rails, lanterns
     • a cantilevered timber BALCONY on carved corbels (the Monterey front)
     • a heavy plank door in a round-arched surround, often a squat corner
       TOWER (mirador) with its own tiled pyramid
     • a stucco chimney with a tiled cap

   Built with the one carpentry in city/facades/house_parts.js.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  const STUCCO = [0xe6dccb, 0xdfd0b4, 0xe8dfcf, 0xd9c7a6, 0xefe7da];
  const TILE = [0x9c4a2e, 0xa8573a, 0x8e4a33, 0xab5f3f];
  const WOOD = [0x4a3020, 0x5a3a24, 0x3e2a1c];
  const IRON = 0x1e1e1f;

  CBZ.registerFacade("spanish", {
    label: "Spanish Colonial",
    structure: "adobe",
    crownsRoof: true,
    ownDoor: true,
    maxStoreys: 4,
    build: function (ctx, F, spec) {
      const HP = CBZ.HOUSE_PARTS;
      if (!HP) return;
      const H = HP.begin(ctx, F);
      const FH = H.FH, ST = H.ST, rTop = H.rTop, df = H.df, S = df.span;
      const stucco = H.tint(H.pick(0x5a01, STUCCO), 0.05), stuccoD = HP.shade(stucco, 0.9);
      const tile = H.pick(0x5a02, TILE), tile2 = HP.mix(tile, 0x6a3a2a, 0.3);
      const wood = H.pick(0x5a03, WOOD);
      const SK = 0.2;                                              // the thick wall
      const hipped = H.hash(0x5a04) < 0.4;
      let towerSide = H.hash(0x5a05) < 0.45 ? H.sign(0x5a06) : 0;
      if (spec && spec.towerSide === "left") towerSide = -1;
      if (spec && spec.towerSide === "right") towerSide = 1;
      if (ctx.grid || S < 10 || H.noDoor) towerSide = 0;
      const towW = HP.clamp(S * 0.26, 3.0, 4.2);
      const towT = towerSide * (S / 2 - towW / 2);
      const arcOn = !H.noDoor && !H.driveIn && S >= 9 && !ctx.grid;
      const arcT0 = towerSide < 0 ? -S / 2 + towW + 0.1 : -S / 2 + 0.3, arcT1 = towerSide > 0 ? S / 2 - towW - 0.1 : S / 2 - 0.3;
      const arcDep = HP.clamp(H.unit * 0.17, 1.8, 2.4);

      // ---- THE OPENINGS: small and deep ------------------------------------------
      const holes = [];
      const dh = H.doorHole();
      if (dh) holes.push(dh);
      for (const f of H.faces) {
        for (let k = 0; k < ST; k++) {
          const row = H.row(f, k, { per: 3.0, w: k === 0 ? 1.0 : 0.95, sill: k === 0 ? 0.8 : 0.9, head: 2.3, margin: 1.1 });
          for (const op of row) holes.push(op);
        }
      }

      // ---- THE ROOF -----------------------------------------------------------------
      const pitch = 0.34 + H.hash(0x5a07) * 0.06, eave = 0.42;
      const base = H.eaveBase(pitch, eave);
      const ridgeX = df.horiz;

      // ---- THE WALLS: thick stucco, a plinth, nothing else on the wall ------------
      H.skinAll(0.35, base - 0.02, holes, stucco, SK);
      H.belt(-0.3, 0.35, holes, SK + 0.05, stuccoD);
      for (const op of holes) {
        if (op.door) continue;
        const f = op.f;
        // the deep reveal gets a tiled sill and a timber lintel
        H.fb(f, op.t0 - 0.12, op.t1 + 0.12, op.y0 - 0.1, op.y0 - 0.02, SK - 0.05, SK + 0.06, tile2);
        H.fb(f, op.t0 - 0.18, op.t1 + 0.18, op.y1 + 0.02, op.y1 + 0.2, SK - 0.03, SK + 0.04, wood);
        // REJAS on the ground floor: a wrought-iron grille standing off the wall
        if (op.k === 0) {
          const go = SK + 0.08;
          H.fb(f, op.t0 - 0.04, op.t1 + 0.04, op.y0 - 0.02, op.y0 + 0.02, go - 0.02, go + 0.02, IRON);
          H.fb(f, op.t0 - 0.04, op.t1 + 0.04, op.y1 - 0.02, op.y1 + 0.02, go - 0.02, go + 0.02, IRON);
          H.fb(f, op.t0 - 0.04, op.t1 + 0.04, (op.y0 + op.y1) / 2 - 0.015, (op.y0 + op.y1) / 2 + 0.015, go - 0.015, go + 0.015, IRON);
          const n = Math.max(3, Math.round((op.t1 - op.t0) / 0.13));
          for (let i = 0; i <= n; i++) {
            const t = op.t0 + (op.t1 - op.t0) * i / n;
            H.fb(f, t - 0.012, t + 0.012, op.y0 - 0.02, op.y1 + 0.06, go - 0.012, go + 0.012, IRON);
          }
        } else if (H.hash(0x5a08 + op.t * 7 + op.k) < 0.5) {
          // timber shutters on an upper window
          for (const sg of [-1, 1]) {
            const ta = sg < 0 ? op.t0 - 0.03 - (op.t1 - op.t0) / 2 : op.t1 + 0.03;
            H.fb(f, ta, ta + (op.t1 - op.t0) / 2, op.y0, op.y1, SK, SK + 0.04, HP.mix(0x3f5a4a, wood, 0.3));
          }
        }
      }

      // ---- THE ROOF: barrel tile on exposed rafter tails -----------------------------
      const r = H.roof({ kind: hipped ? "hip" : "gable", axis: ridgeX ? "x" : "z", base: base, pitch: pitch, step: 0.12, eave: eave, rake: 0.25,
        roof: tile, roof2: tile2, core: stucco, coreProj: SK + 0.02, soffit: wood, fascia: null, ridge: HP.shade(tile, 0.85), hipCaps: true });
      // rafter tails under the eave on the eave faces
      for (const f of H.faces) {
        if (!hipped && f.horiz !== ridgeX) continue;
        const n = Math.max(3, Math.round(f.span / 0.6));
        for (let i = 0; i <= n; i++) {
          const t = -f.span / 2 + 0.1 + (f.span - 0.2) * i / n;
          H.fb(f, t - 0.05, t + 0.05, base - 0.16, base - 0.03, SK - 0.02, eave - 0.02, wood);
        }
      }

      // ---- THE ARCADE: round arches on square piers, a tile shed over it ------------
      const arcTop = Math.min(FH - 0.3, 2.95);
      if (arcOn && arcT1 - arcT0 >= 4) {
        const span = arcT1 - arcT0, n = Math.max(2, Math.round(span / 2.6));
        const pw = 0.42, bw = (span - pw) / n;
        const o0 = arcDep - 0.4, o1 = arcDep;
        H.fb(df, arcT0, arcT1, -0.3, H.DECK, 0, arcDep, 0xb07a5a);                          // a terracotta paved floor
        H.platF(df, arcT0, arcT1, 0, arcDep, H.DECK);
        const springY = arcTop - 0.42 - (bw - pw) / 2;
        for (let i = 0; i <= n; i++) {
          const t = arcT0 + pw / 2 + bw * i;
          H.fb(df, t - pw / 2, t + pw / 2, H.DECK, springY, o0, o1, stucco);
          H.fb(df, t - pw / 2 - 0.05, t + pw / 2 + 0.05, springY - 0.12, springY, o0 - 0.04, o1 + 0.04, stuccoD);
          H.solidF(df, t - pw / 2, t + pw / 2, H.DECK, springY, o0, o1);
        }
        // the arch spandrels: a semicircle stepped in 6 courses, then the wall over it
        for (let i = 0; i < n; i++) {
          const a = arcT0 + pw + bw * i, b = a + bw - pw, R = (b - a) / 2, m = (a + b) / 2;
          const steps = 6;
          for (let j = 0; j < steps; j++) {
            const u = (j + 0.5) / steps, half = R * Math.sqrt(Math.max(0, 1 - u * u));
            const y0 = springY + R * j / steps, y1 = springY + R * (j + 1) / steps;
            H.fb(df, a - 0.01, m - half, y0, y1, o0, o1, stucco);
            H.fb(df, m + half, b + 0.01, y0, y1, o0, o1, stucco);
          }
        }
        H.fb(df, arcT0, arcT1, springY + (bw - pw) / 2, arcTop, o0, o1, stucco);
        H.fb(df, arcT0 - 0.05, arcT1 + 0.05, arcTop, arcTop + 0.12, o0 - 0.05, o1 + 0.06, stuccoD);
        H.roofF(df, arcT0, arcT1, 0, arcDep, { base: arcTop + 0.12, kind: "shed", pitch: 0.32, step: 0.1, eave: 0.3, rake: 0.1,
          roof: tile, roof2: tile2, soffit: wood });
      }

      // ---- A MONTEREY BALCONY across the upper front ----------------------------------
      if (ST >= 2 && !ctx.grid && !H.noDoor) {
        const bw = HP.clamp(S * 0.42, 3.0, 6.0), y = FH + 0.02, bd = 0.85;
        const bt0 = towerSide > 0 ? -bw / 2 - 0.6 : -bw / 2, bt1 = bt0 + bw;
        H.fb(df, bt0, bt1, y - 0.12, y + 0.06, SK, SK + bd, wood);
        H.platF(df, bt0, bt1, SK, SK + bd, y + 0.06);
        for (let t = bt0 + 0.2; t < bt1; t += 0.9) H.fb(df, t - 0.07, t + 0.07, y - 0.42, y - 0.12, SK, SK + bd * 0.8, wood);   // corbels
        H.rail(df, bt0 + 0.05, bt1 - 0.05, SK + bd - 0.05, y + 0.06, 0.95, IRON, 0.12, 0.05);
        H.railOut(df, bt0 + 0.06, SK + 0.05, SK + bd - 0.05, y + 0.06, 0.95, IRON, 0.12);
        H.railOut(df, bt1 - 0.06, SK + 0.05, SK + bd - 0.05, y + 0.06, 0.95, IRON, 0.12);
      }

      // ---- THE MIRADOR: a squat corner tower with its own tiled pyramid --------------
      let topY = r.top;
      if (towerSide) {
        const tw = towW, tp0 = towT - tw / 2, tp1 = towT + tw / 2;
        const tTop = r.top + 0.4, tDep = Math.min(df.halfN * 0.6, 4.0);
        // the tower is the house's corner, carried up past the roof
        H.fb(df, tp0, tp1, base - 0.1, tTop, -tDep, SK + 0.02, stucco);
        for (let k = 0; k < 2; k++) {
          const wy = base + 0.4 + k * 0;
          if (k) break;
          H.fb(df, towT - 0.45, towT + 0.45, wy, wy + 1.0, SK + 0.02, SK + 0.05, F.glass(ctx, 0x1c242a));
          H.fb(df, towT - 0.55, towT + 0.55, wy + 1.0, wy + 1.16, SK + 0.02, SK + 0.08, wood);
          for (let t = towT - 0.4; t <= towT + 0.41; t += 0.2) H.fb(df, t - 0.012, t + 0.012, wy, wy + 1.0, SK + 0.06, SK + 0.085, IRON);
        }
        const put = function (u0, u1, v0, v1, y0, y1, col) { H.fb(df, u0, u1, y0, y1, v0, v1, col); };
        H.stack(put, { u0: tp0, u1: tp1, v0: -tDep, v1: SK + 0.02 }, { kind: "hip", base: tTop, pitch: 0.42, step: 0.11, eave: 0.32,
          roof: tile, roof2: tile2, soffit: wood, ridge: HP.shade(tile, 0.85), hipCaps: true });
        topY = Math.max(topY, tTop + 1.2);
      }

      // ---- THE ENTRANCE: a plank door in a round-arched stone surround ---------------
      H.doorColour(wood);
      H.doorcase("arch", { col: HP.mix(0xcbbd9f, stucco, 0.3), skin: SK, w: 0.22,
        lamp: { col: 0xffcf8a, side: H.sign(0x5a09) }, step: arcOn ? null : { col: 0xb07a5a, w: H.doorW + 1.0, d: 0.5 } });

      // ---- THE CHIMNEY: stucco, with a tiled cap -------------------------------------------
      if (!ctx.grid) {
        const cf = H.face(ridgeX ? (towerSide > 0 ? 2 : 3) : (towerSide > 0 ? 0 : 1));
        const cpt = H.pt(cf, cf.span * 0.25, -0.8);
        H.chimney({ x: cpt.x, z: cpt.z, w: 0.9, dp: 0.7, top: r.top + 0.55, brick: stucco, cap: tile, pot: tile2, pots: 1 });
      }
      void topY;
    },
  });
})();
