/* ============================================================
   city/facades/greekrev.js — "Greek Revival": the temple-front house,
   1820-1860.

   WHAT IT IS (the references: phmc.state.pa.us Early Classical Revival /
   Greek Revival 1820-1860, architecturecourses.org Greek Revival
   Architecture, antiquehomesmagazine.com Greek Revival style guide,
   theoldhouselife.com "What are the Features of a Greek Revival House?"):
     • the GABLE TURNED TO THE STREET as a PEDIMENT over a full-height
       PORTICO of columns (4 or 6, an even number so the door sits on the
       centre bay)
     • a low pitch (the pediment is 15-25 deg), a raking cornice up both
       verges and a horizontal cornice closing the pediment
     • a wide, plain ENTABLATURE (architrave, frieze, cornice) running round
       the whole house under the eaves
     • corner PILASTERS, 6-over-6 SASH windows, a door with sidelights and a
       transom in a pilastered surround
     • white (painted to read as marble), black-green shutters

   Built with the one carpentry in city/facades/house_parts.js.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  const WHITE = [0xefece4, 0xe9e4d6, 0xe9dfb8, 0xe4e1da];
  const ROOF = [0x3c4046, 0x47443f, 0x3a3d40];

  CBZ.registerFacade("greekrev", {
    label: "Greek Revival",
    structure: "masonry",
    crownsRoof: true,
    ownDoor: true,
    maxStoreys: 4,
    build: function (ctx, F, spec) {
      const HP = CBZ.HOUSE_PARTS;
      if (!HP) return;
      const H = HP.begin(ctx, F);
      const FH = H.FH, ST = H.ST, df = H.df, S = df.span;
      const white = H.pick(0x6e01, WHITE), whiteD = HP.shade(white, 0.88), roof = H.pick(0x6e02, ROOF);
      const shutOn = spec && spec.shutters != null ? !!spec.shutters : H.hash(0x6e03) < 0.55;
      const shut = 0x23302a;
      const SK = 0.05;
      const porOn = !H.noDoor && !H.driveIn && !ctx.grid && S >= 7;
      const dep = HP.clamp(H.unit * 0.21, 2.2, 3.0);
      const axis = df.horiz ? "z" : "x";                     // the ridge runs back from the street

      H.publish({ body: white, trim: white, roof: roof, flat: false });

      // ---- THE OPENINGS -------------------------------------------------------------
      const holes = [];
      const dh = H.doorHole();
      if (dh) holes.push(dh);
      for (const f of H.faces) {
        for (let k = 0; k < ST; k++) {
          const row = H.row(f, k, { per: 2.7, w: 0.95, sill: k === 0 ? 0.65 : 0.75, head: k === 0 ? 2.65 : 2.55, odd: f.s === df.s, margin: 1.2 });
          for (const op of row) holes.push(op);
        }
      }

      // ---- THE ROOF and the walls up to its entablature --------------------------------
      const across = (axis === "x" ? H.D : H.W) / 2 + 0.35;
      const pitch = Math.min(0.42, 4.2 / across), eave = 0.35;
      const base = H.eaveBase(pitch, eave);
      const entH = HP.clamp(FH * 0.24, 0.65, 0.95);           // the entablature's height
      H.skinAll(0.45, base - 0.02, holes, white, SK);
      for (const f of H.faces) H.courses(f, 0.45, base - entH - 0.1, holes, 0.22, 0.025, SK + 0.016, whiteD);
      H.belt(-0.3, 0.45, holes, SK + 0.1, HP.shade(white, 0.82));                     // the stylobate
      H.belt(0.45, 0.55, holes, SK + 0.12, white);
      // the entablature, round the whole house
      H.belt(base - entH, base - entH * 0.62, [], SK + 0.05, white);                    // architrave
      H.belt(base - entH * 0.62, base - entH * 0.16, [], SK + 0.03, HP.shade(white, 0.97)); // frieze
      H.belt(base - entH * 0.16, base - 0.03, [], SK + 0.16, white);                    // cornice
      H.cornerBoards(0.55, base - entH, 0.42, SK + 0.08, white);                        // corner pilasters
      for (const f of H.faces) for (const sg of [-1, 1]) {                                // their capitals
        const e = f.span / 2 + (f.horiz ? SK + 0.08 : 0);
        H.fb(f, sg < 0 ? -e - 0.04 : e - 0.46, sg < 0 ? -e + 0.46 : e + 0.04, base - entH - 0.18, base - entH, 0, SK + 0.13, white);
      }
      for (const op of holes) {
        if (op.door) continue;
        H.trim(op, { skin: SK, cw: 0.13, cp: 0.035, col: white, head: "cap", sill: { h: 0.07, proj: 0.07, over: 0.05, col: white },
          shut: shutOn ? { col: shut, w: 0.5, louvre: true } : null });
      }

      // ---- THE PORTICO: a temple front ---------------------------------------------------------
      const rect = { x0: -H.W / 2, x1: H.W / 2, z0: -H.D / 2, z1: H.D / 2 };
      if (porOn) {
        if (df.s === 0) rect.z0 -= dep; else if (df.s === 1) rect.z1 += dep; else if (df.s === 2) rect.x0 -= dep; else rect.x1 += dep;
        const t0 = -S / 2 - 0.03, t1 = S / 2 + 0.03;
        H.fb(df, t0 - 0.2, t1 + 0.2, -0.3, H.DECK - 0.04, 0, dep + 0.2, HP.shade(white, 0.86));        // the stylobate
        H.fb(df, t0 - 0.24, t1 + 0.24, H.DECK - 0.04, H.DECK, 0, dep + 0.24, HP.shade(white, 0.92));
        H.platF(df, t0 - 0.2, t1 + 0.2, 0, dep + 0.2, H.DECK);
        const sw = H.doorW + 2.0;
        H.fb(df, -sw / 2, sw / 2, -0.3, H.DECK * 0.5, dep + 0.2, dep + 0.55, HP.shade(white, 0.86));
        H.platF(df, -sw / 2, sw / 2, dep + 0.2, dep + 0.55, H.DECK * 0.5);
        const nC = (spec && spec.columns) || (S >= 13 ? 6 : 4);
        const cr = HP.clamp(S * 0.022, 0.22, 0.34);
        const colTop = base - entH;
        const po = dep - cr - 0.1;
        for (let i = 0; i < nC; i++) {
          const t = t0 + cr + 0.15 + (t1 - t0 - 2 * cr - 0.3) * i / (nC - 1);
          H.fb(df, t - cr - 0.1, t + cr + 0.1, H.DECK, H.DECK + 0.22, po - cr - 0.1, po + cr + 0.1, white);           // base / plinth
          H.columnF(df, t, po, H.DECK + 0.22, cr, colTop - H.DECK - 0.22 - 0.3, white, 16);
          H.fb(df, t - cr - 0.04, t + cr + 0.04, colTop - 0.3, colTop - 0.18, po - cr - 0.04, po + cr + 0.04, white); // echinus
          H.fb(df, t - cr - 0.12, t + cr + 0.12, colTop - 0.18, colTop, po - cr - 0.12, po + cr + 0.12, white);       // abacus
          H.solidF(df, t - cr, t + cr, H.DECK, colTop, po - cr, po + cr);
        }
        // the portico's entablature across the front and back along its sides
        H.fb(df, t0 - 0.12, t1 + 0.12, colTop, base - 0.03, po - cr - 0.12, dep + 0.05, white);
        H.fb(df, t0 - 0.12, t1 + 0.12, base - entH * 0.16, base - 0.03, po - cr - 0.12, dep + 0.2, white);
        for (const tt of [t0 - 0.12, t1 - 0.3]) H.fb(df, tt, tt + 0.42, colTop, base - 0.03, 0, dep, white);
        H.fb(df, t0, t1, base - 0.06, base - 0.03, 0.02, po - cr - 0.12, HP.mix(0xb8c6c8, white, 0.5));            // the ceiling
        // the pediment's horizontal cornice
        H.fb(df, t0 - 0.3, t1 + 0.3, base - 0.03, base + 0.12, dep - 0.2, dep + 0.36, white);
        if (ctx.lamp) H.lamp(df, 0, base - entH - 0.5, dep * 0.45, 0.13, 0xffdca6);
      }

      // ---- THE ROOF: the pediment is its gable --------------------------------------------------
      const r = H.roof({ kind: "gable", axis: axis, rect: rect, base: base, pitch: pitch, step: 0.12, eave: eave, rake: 0.36,
        roof: roof, roof2: HP.shade(roof, 0.9), core: white, coreProj: 0.11, soffit: white, fascia: white, fasciaH: 0.3,
        ridge: HP.shade(roof, 0.8), rakeBoard: true });
      // the raking cornice's bed: a second board under the verge, so it reads as a moulded cornice
      // an oculus in the tympanum
      const tyH = (S / 2) * pitch;
      if (porOn && tyH > 1.0) {
        const oy = base + tyH * 0.38, orad = Math.min(0.45, tyH * 0.25);
        H.fb(df, -orad, orad, oy - orad, oy + orad, dep + 0.11, dep + 0.15, F.glass(ctx, 0x1c242c));
        H.fb(df, -orad - 0.1, orad + 0.1, oy + orad, oy + orad + 0.1, dep + 0.11, dep + 0.19, whiteD);
        H.fb(df, -orad - 0.1, orad + 0.1, oy - orad - 0.1, oy - orad, dep + 0.11, dep + 0.19, whiteD);
        H.fb(df, -orad - 0.1, -orad, oy - orad, oy + orad, dep + 0.11, dep + 0.19, whiteD);
        H.fb(df, orad, orad + 0.1, oy - orad, oy + orad, dep + 0.11, dep + 0.19, whiteD);
      }
      // two chimneys on the ridge
      const A = (axis === "x" ? H.W : H.D) / 2;
      for (const sg of [-1, 1]) {
        const u = sg * A * 0.45 - (porOn ? 0 : 0);
        H.chimney({ x: axis === "x" ? u : 0, z: axis === "x" ? 0 : u, w: 0.9, dp: 0.6, top: r.top + 0.6, brick: HP.mix(0x8a4a36, white, 0.12), cap: white, pots: 1 });
      }

      // ---- THE ENTRANCE: pilasters, a transom-height entablature, sidelight panels -----
      H.doorColour(0x26302a);
      H.doorcase("pilaster", { col: white, skin: SK, w: 0.24, cap: whiteD, step: porOn ? null : { col: HP.shade(white, 0.86), w: H.doorW + 1.2, d: 0.5 },
        lamp: porOn ? null : { col: 0xffd9a0, side: 1 } });
    },
  });
})();
