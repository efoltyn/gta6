/* ============================================================
   city/facades/plantation.js — "Antebellum": the Southern antebellum house,
   1820-1860.

   WHAT IT IS (the references: maverickframe.com Antebellum Architecture,
   hancockcountyhistoricalsociety.com "Double Gallery", Wikipedia "Oak Alley
   Plantation", todayshomeowner.com "Antebellum Architectural Style"):
     • strict SYMMETRY: a centred door, an equal number of evenly spaced
       windows each side
     • a broad DOUBLE GALLERY across the front — a deep (2.5-3 m) porch on
       both floors, the upper one railed — carried on COLOSSAL columns that
       run the full height to the entablature
     • a big HIPPED roof that sweeps out over the gallery, with DORMERS
     • TALL, floor-length double-hung windows with louvred SHUTTERS
     • white or cream, black-green shutters, slate or standing-seam roof,
       interior chimneys at the ends of the ridge

   Built with the one carpentry in city/facades/house_parts.js.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  const WHITE = [0xeceae2, 0xe8e0cc, 0xe6dcb4, 0xefece6];
  const SHUT = [0x26332b, 0x2a2f2c, 0x2f3a33];
  const ROOF = [0x4d5358, 0x3d4247, 0x5a5650];

  CBZ.registerFacade("plantation", {
    label: "Antebellum House",
    structure: "timber",
    crownsRoof: true,
    ownDoor: true,
    maxStoreys: 4,
    build: function (ctx, F, spec) {
      const HP = CBZ.HOUSE_PARTS;
      if (!HP) return;
      const H = HP.begin(ctx, F);
      const FH = H.FH, ST = H.ST, rTop = H.rTop, df = H.df, S = df.span;
      const white = H.pick(0x6b01, WHITE), whiteD = HP.shade(white, 0.88);
      const shut = H.pick(0x6b02, SHUT), roof = H.pick(0x6b03, ROOF);
      const shutOn = !(spec && spec.shutter === false);
      const SK = 0.05;
      const galOn = !H.noDoor && !H.driveIn && !ctx.grid && S >= 8;
      const dep = HP.clamp(H.unit * 0.2, 2.2, 3.0);
      const gST = Math.min(2, ST);                          // the gallery's storeys

      H.publish({ body: white, trim: white, roof: roof, flat: false });

      // ---- THE OPENINGS: tall, floor-length, symmetric ---------------------------
      const holes = [];
      const dh = H.doorHole();
      if (dh) holes.push(dh);
      for (const f of H.faces) {
        for (let k = 0; k < ST; k++) {
          const row = H.row(f, k, { per: f.s === df.s ? 2.5 : 3.0, w: 1.0, sill: 0.6, head: 2.72, odd: f.s === df.s, margin: Math.min(1.2, f.span * 0.09) });
          for (const op of row) holes.push(op);
        }
      }

      // ---- THE ROOF: a hip sweeping over the gallery ----------------------------
      const pitch = 0.55, eave = 0.5;
      const base = H.eaveBase(pitch, eave);
      const axis = df.horiz ? "x" : "z";
      const rect = { x0: -H.W / 2, x1: H.W / 2, z0: -H.D / 2, z1: H.D / 2 };
      if (galOn) {
        if (df.s === 0) rect.z0 -= dep; else if (df.s === 1) rect.z1 += dep;
        else if (df.s === 2) rect.x0 -= dep; else rect.x1 += dep;
      }

      // ---- THE WALLS: painted weatherboard -----------------------------------------
      H.skinAll(0.4, base - 0.02, holes, white, SK);
      for (const f of H.faces) H.courses(f, 0.4, base - 0.4, holes, 0.22, 0.025, SK + 0.016, whiteD);
      H.belt(-0.3, 0.4, holes, SK + 0.08, HP.mix(0x8a4a36, white, 0.15));        // brick piers' plinth
      H.cornerBoards(0.4, base - 0.02, 0.22, SK + 0.04, white);
      H.belt(base - 0.45, base - 0.03, [], SK + 0.05, white);                     // the frieze board
      for (let k = 1; k < ST; k++) H.belt(k * FH - 0.03, k * FH + 0.12, holes, SK + 0.035, white);

      for (const op of holes) {
        if (op.door) continue;
        H.trim(op, { skin: SK, cw: 0.13, cp: 0.03, col: white, head: "cap", sill: { h: 0.06, proj: 0.06, over: 0.04, col: white },
          shut: shutOn ? { col: shut, w: 0.5, louvre: true } : null });
      }

      // ---- THE DOUBLE GALLERY ----------------------------------------------------------
      if (galOn) {
        const t0 = -S / 2 - 0.02, t1 = S / 2 + 0.02;
        const colTop = base - 0.55;
        // the floors: a deck at grade and a railed gallery at each upper floor
        H.fb(df, t0, t1, -0.3, H.DECK - 0.03, 0, dep, HP.mix(0x8a4a36, white, 0.2));
        H.fb(df, t0, t1, H.DECK - 0.03, H.DECK, 0, dep + 0.03, 0x8f8a7e);
        H.platF(df, t0, t1, 0, dep, H.DECK);
        const n = Math.max(3, Math.round(S / 2.5) | 1);
        const cr = HP.clamp(H.unit * 0.022, 0.2, 0.3);
        const ts = [];
        for (let i = 0; i <= n; i++) {
          const t = t0 + cr + 0.1 + (t1 - t0 - 2 * cr - 0.2) * i / n;
          if (Math.abs(t) < H.doorW / 2 + cr + 0.2) continue;
          ts.push(t);
        }
        const po = dep - cr - 0.12;
        for (const t of ts) {
          H.columnF(df, t, po, H.DECK + 0.3, cr, colTop - H.DECK - 0.3 - 0.3, white, 14);
          H.fb(df, t - cr - 0.08, t + cr + 0.08, H.DECK, H.DECK + 0.3, po - cr - 0.08, po + cr + 0.08, white);
          H.fb(df, t - cr - 0.1, t + cr + 0.1, colTop - 0.3, colTop, po - cr - 0.1, po + cr + 0.1, white);
          H.solidF(df, t - cr, t + cr, H.DECK, colTop, po - cr, po + cr);
        }
        // the entablature across the front and down the gallery's ends
        H.fb(df, t0 - 0.1, t1 + 0.1, colTop, base - 0.03, dep - 0.42, dep + 0.06, white);
        H.fb(df, t0 - 0.14, t1 + 0.14, base - 0.2, base - 0.03, dep - 0.42, dep + 0.12, whiteD);
        for (const tt of [t0 - 0.1, t1 - 0.32]) H.fb(df, tt, tt + 0.42, colTop, base - 0.03, 0, dep, white);
        // upper gallery floors with their balustrades
        for (let k = 1; k < gST; k++) {
          const y = k * FH;
          H.fb(df, t0, t1, y - 0.25, y + 0.06, 0.0, dep - 0.12, white);
          H.platF(df, t0, t1, 0, dep - 0.12, y + 0.06);
          const all = [t0 + 0.05].concat(ts).concat([t1 - 0.05]);
          for (let i = 0; i < all.length - 1; i++) {
            const a = all[i] + cr + 0.04, b = all[i + 1] - cr - 0.04;
            if (b - a > 0.3) H.rail(df, a, b, po, y + 0.06, 0.95, white, 0.14);
          }
        }
        // the gallery's ceiling
        H.fb(df, t0, t1, base - 0.06, base - 0.03, 0.02, dep - 0.42, HP.mix(0x9cbcc0, white, 0.4));
      }

      // ---- THE ROOF ---------------------------------------------------------------------------
      const r = H.roof({ kind: "hip", axis: axis, rect: rect, base: base, pitch: pitch, step: 0.13, eave: eave,
        roof: roof, roof2: HP.shade(roof, 0.9), soffit: white, fascia: white, fasciaH: 0.24, ridge: HP.shade(roof, 0.8), hipCaps: true });
      // dormers on the front slope over the window bays
      if (galOn) {
        const front = holes.filter(function (h) { return h.s === df.s && h.k === ST - 1; });
        const vcL = axis === "x" ? (rect.z0 + rect.z1) / 2 : (rect.x0 + rect.x1) / 2;
        const Cr = (axis === "x" ? rect.z1 - rect.z0 : rect.x1 - rect.x0) / 2;
        const picks = front.length >= 4 ? [front[1], front[front.length - 2]] : front.slice(0, 1);
        if (front.length >= 5) picks.push(front[(front.length / 2) | 0]);
        for (const op of picks) {
          H.dormer(r, axis, df.out, (op.t0 + op.t1) / 2, 0.8, 1.05, { cheek: white, trim: white, roof: roof, roof2: HP.shade(roof, 0.9), glass: F.glass(ctx, 0x1c242c) },
            { pitch: pitch, set: dep * 0.0 + 1.2, C: Cr, vc: vcL, dPitch: 0.9 });
        }
      }
      // interior chimneys at the ends of the ridge
      const A = (axis === "x" ? H.W : H.D) / 2;
      for (const sg of [-1, 1]) {
        const u = sg * A * 0.5;
        H.chimney({ x: axis === "x" ? u : 0, z: axis === "x" ? 0 : u, w: 1.0, dp: 0.62, top: r.top + 0.7, brick: HP.mix(0x8a4a36, white, 0.1), cap: white, pots: 2 });
      }

      // ---- THE ENTRANCE ---------------------------------------------------------------------
      H.doorColour(shut);
      H.doorcase("pilaster", { col: white, skin: SK, w: 0.2, cap: whiteD, lamp: galOn ? null : { col: 0xffd9a0, side: 1 },
        step: galOn ? null : { col: 0x9a958a, w: H.doorW + 1.0, d: 0.45 } });
      if (galOn) {
        // the stair from the gallery down to the walk
        const sw = H.doorW + 1.4;
        H.fb(df, -sw / 2, sw / 2, -0.3, H.DECK * 0.5, dep, dep + 0.35, 0x9a958a);
        H.platF(df, -sw / 2, sw / 2, dep, dep + 0.35, H.DECK * 0.5);
        if (ctx.lamp) H.lamp(df, 0, base - 0.9, dep * 0.5, 0.14, 0xffd9a0);
      }
    },
  });
})();
