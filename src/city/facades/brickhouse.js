/* ============================================================
   city/facades/brickhouse.js — "Georgian": the red-brick Georgian / Federal
   house, c. 1720-1820.

   WHAT A GEORGIAN IS (the references: phmc.state.pa.us Georgian 1700-1800,
   theplancollection "What Architectural Features Define a Georgian Style
   House", ontarioarchitecture.com/georgian):
     • strict SYMMETRY about a centred door: an odd number of bays, 5 on a
       full house, 3 on a narrow one, every opening the same width
     • multi-pane SASH windows (6 over 6), tall on the principal floors and
       shorter on the top one; window-to-wall about 20-25%
     • flat brick JACK ARCHES (or stone lintels) with a keystone over every
       window, a projecting stone SILL under it
     • a panelled door in a PEDIMENTED or entablature DOORCASE on pilasters,
       a transom light over it, one stone step
     • a BELT COURSE at each floor, a WATER TABLE at the base, often stone
       QUOINS at the corners
     • a medium side-gabled (30-35 deg) or low hipped roof in slate, a deep
       MODILLION CORNICE at the eave with returns on the gables, chimneys at
       BOTH ends, often pedimented dormers
     • red / brown brick, white trim, dark green / black / oxblood door,
       black-green louvred shutters on American examples

   Built with the one carpentry in city/facades/house_parts.js.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  // brick, mortar-joint shade, trim, door, roof — real Georgian tones
  const BRICK = [0x8a3f2c, 0x7d3a2a, 0x93503a, 0x74402f, 0x9a5a42];
  const TRIM = [0xebe7dc, 0xe4ddca, 0xefeee8];
  const DOOR = [0x1f2b24, 0x26282e, 0x55201e, 0x1e2a3a];
  const SLATE = [0x3a3e44, 0x43403d, 0x34383d];

  CBZ.registerFacade("brickhouse", {
    label: "Georgian",
    structure: "brick",
    crownsRoof: true,
    ownDoor: true,
    maxStoreys: 4,
    build: function (ctx, F) {
      const HP = CBZ.HOUSE_PARTS;
      if (!HP) return;
      const H = HP.begin(ctx, F);
      const FH = H.FH, ST = H.ST, rTop = H.rTop;

      const brick = H.tint(H.pick(0xb101, BRICK), 0.06);
      const brickD = HP.shade(brick, 0.84);
      const rubbed = HP.mix(brick, 0xc98a6a, 0.35);       // rubbed-brick arches
      const trim = H.pick(0xb102, TRIM);
      const stone = HP.mix(0xd6cfbf, H.base, 0.08);
      const door = H.pick(0xb103, DOOR);
      const slate = H.pick(0xb104, SLATE);
      const shutCol = H.hash(0xb105) < 0.5 ? 0x22302a : 0x24262a;
      const hasShut = H.hash(0xb106) < 0.5;
      const hasQuoin = H.hash(0xb107) < 0.6;
      const stoneHead = H.hash(0xb108) < 0.45;          // stone lintels vs brick jack arches
      const hipped = H.hash(0xb109) < 0.3;
      const SK = 0.05;                                   // the brick skin's depth

      // ---- THE OPENINGS ------------------------------------------------------
      const holes = [];
      const dh = H.doorHole();
      if (dh) holes.push(dh);
      for (const f of H.faces) {
        const front = f.s === H.doorSide;
        for (let k = 0; k < ST; k++) {
          const top = k === ST - 1 && ST >= 3;           // the attic diminution
          const sill = k === 0 ? 0.72 : (top ? 0.95 : 0.8);
          const head = k === 0 ? 2.5 : (top ? 2.35 : 2.55);
          const row = H.row(f, k, { per: front ? 2.4 : 3.0, w: front ? 0.95 : 0.9, sill: sill, head: head,
            odd: front, margin: Math.min(1.1, f.span * 0.09) });
          for (const op of row) holes.push(op);
        }
      }

      // ---- THE ROOF (solved first: the walls run up to its eave) -------------
      const pitch = hipped ? 0.5 : 0.62 + H.hash(0xb10a) * 0.08;
      const eave = 0.32;
      const base = H.eaveBase(pitch, eave);
      const ridgeX = H.df.horiz;                         // the ridge parallels the street

      // ---- THE WALLS -----------------------------------------------------------
      H.skinAll(0.52, base - 0.02, holes, brick, SK);
      // the water table: a dark brick plinth with a stone chamfer cap
      H.belt(-0.3, 0.46, holes, SK + 0.06, brickD);
      H.belt(0.46, 0.54, holes, SK + 0.09, stone);
      // a stone belt course at every floor line
      for (let k = 1; k < ST; k++) H.belt(k * FH - 0.02, k * FH + 0.15, holes, SK + 0.05, stone);
      if (hasQuoin) H.quoins(0.54, base - 0.36, 0.62, 0.3, SK + 0.04, stone, HP.shade(stone, 0.95));

      // ---- WINDOW TRIM -----------------------------------------------------------
      for (const op of holes) {
        if (op.door) continue;
        H.trim(op, { skin: SK, cw: 0, col: stone, head: stoneHead ? "cap" : "jack", headCol: stoneHead ? stone : rubbed,
          key: stoneHead ? null : stone, archH: 0.26, sill: { h: 0.08, proj: 0.08, over: 0.07, col: stone },
          shut: hasShut ? { col: shutCol, w: 0.5, louvre: true } : null });
      }

      // ---- THE DOORCASE: pilasters, entablature, a pediment on a wide front ----
      H.doorColour(door);
      H.doorcase(H.df.span >= 9 ? "ped" : "pilaster", { col: trim, skin: SK, w: 0.2, cap: trim,
        lamp: { col: 0xffd9a0, side: H.sign(0xb10b) }, step: { col: stone, w: H.doorW + 1.0, d: 0.45 } });

      // ---- THE CORNICE: a modillion cornice at the eave, returns on the gables --
      const corFaces = hipped ? H.faces : H.faces.filter(function (f) { return f.horiz === ridgeX; });
      H.belt(base - 0.42, base - 0.26, [], SK + 0.05, trim, { faces: corFaces });
      H.belt(base - 0.26, base - 0.12, [], SK + 0.1, trim, { faces: corFaces });
      H.belt(base - 0.12, base - 0.03, [], SK + 0.2, HP.shade(trim, 0.96), { faces: corFaces });
      for (const f of corFaces) {
        const n = Math.max(4, Math.round(f.span / 0.45));
        for (let i = 0; i <= n; i++) {
          const t = -f.span / 2 + 0.1 + (f.span - 0.2) * i / n;
          H.fb(f, t - 0.05, t + 0.05, base - 0.2, base - 0.12, SK + 0.1, SK + 0.27, trim);
        }
      }
      if (!hipped) {
        // the gable's foot: a corbelled brick course where the wall meets the
        // gable (the gable stands proud of the coping)
        H.belt(base - 0.1, base + 0.02, [], 0.13, brickD, { faces: H.faces.filter(function (f) { return f.horiz !== ridgeX; }) });
        for (const f of H.faces) {
          if (f.horiz === ridgeX) continue;
          for (const sg of [-1, 1]) {
            const e = f.span / 2;
            H.fb(f, sg < 0 ? -e : e - 0.9, sg < 0 ? -e + 0.9 : e, base - 0.42, base - 0.03, SK, SK + 0.2, trim);
            H.fb(f, sg < 0 ? -e : e - 1.0, sg < 0 ? -e + 1.0 : e, base - 0.03, base + 0.12, SK, SK + 0.26, slate);
          }
        }
      }

      // ---- THE ROOF ----------------------------------------------------------------
      // A metro row (ctx.grid) is roofed by the fabric itself: a kit roof there
      // would only be clipped into a slab over the terrace. Its wall relief stays.
      if (ctx.grid) return;
      const r = H.roof({ kind: hipped ? "hip" : "gable", axis: ridgeX ? "x" : "z", base: base, pitch: pitch, step: 0.14,
        eave: eave, rake: 0.18, roof: slate, roof2: HP.shade(slate, 0.9), core: brick,
        soffit: trim, fascia: trim, gutter: null, ridge: HP.shade(slate, 0.8), rakeBoard: true, hipCaps: true });

      // ---- CHIMNEYS AT BOTH ENDS -----------------------------------------------------
      const A = (ridgeX ? H.W : H.D) / 2;
      const chTop = r.top + 0.8;
      for (const sg of [-1, 1]) {
        const u = sg * (hipped ? A * 0.55 : A - 0.55);
        H.chimney({ x: ridgeX ? u : 0, z: ridgeX ? 0 : u, w: 1.3, dp: 0.62, top: chTop, brick: brick, cap: stone,
          pots: 3, alongX: !ridgeX, y0: rTop });
      }

      // ---- PEDIMENTED DORMERS on a low house's front slope -----------------------------
      if (!hipped && ST <= 2 && H.hash(0xb10c) < 0.6) {
        const side = H.df.out;                            // the slope over the door face
        const n = H.df.span >= 10 ? 3 : 2;
        for (let i = 0; i < n; i++) {
          const u = (i - (n - 1) / 2) * Math.min(3.2, (2 * A - 2.4) / Math.max(1, n - 1));
          H.dormer(r, ridgeX ? "x" : "z", side, u, 0.8, 1.0,
            { cheek: trim, trim: trim, roof: slate, roof2: HP.shade(slate, 0.9), glass: F.glass(ctx, 0x1c242c) },
            { pitch: pitch, set: 0.45, dPitch: 0.9 });
        }
      }
    },
  });
})();
