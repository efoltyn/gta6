/* ============================================================
   city/facades/desertmod.js — "Desert Modern House", Palm Springs, 1962.

   THE READ. The other desert facade in this kit is adobe.js, and it is earth
   architecture: battered mud walls, vigas, a stepped hand-made mass. This is
   the exact opposite building standing in the same sand. It is MACHINED. Steel
   posts, plate glass, a roof like a sheet of paper, and a single argument that
   runs through every element in the file:

        IN THE DESERT, ARCHITECTURE IS THE MANAGEMENT OF SUN AND SHADE.

   Nothing here is decoration. Every part exists because of the sun:

     1. THE ROOF PLANE. One thin blade — 2 to 6 m of overhang, 25 cm thick —
        floating past all four walls, so the whole elevation stands in its
        shadow. It is the silhouette (hence crownsRoof): at 200 m this house is
        a horizontal line with a dark slot under it, and nothing else in the
        city makes that shape. Optionally a BUTTERFLY, pitched UP toward both
        eaves off a valley over the middle of the house. Built the way
        victorian.js builds its mansard — stepped axis-aligned ribbons, no
        rotation — with the y step held under half the plate thickness so
        consecutive boxes overlap and the blade reads as one sheet.
     2. THE CLERESTORY WEDGE. The host's own parapet zone is clad as dark glass
        and then run UP to meet the plane's underside. Flat roof → a level
        slot. Butterfly → a triangle of glass growing toward each eave, which
        is what a butterfly roof is FOR; and it closes the gap the tilt opens
        over the wall head, so the roof never floats away from the building.
        One mechanism, both roofs.
     3. THE POST RING. The plane cannot land on the walls, so it stands on slim
        steel posts solved off the plate's own plan rectangle — each one asking
        the roof how high it is above that exact point, which is why on a
        butterfly the posts are visibly different lengths. Two ANGLED feature
        posts rake outward at the entry, because in 1962 somebody always did.
     4. BREEZE BLOCK. Pierced concrete screens standing half a metre OFF the
        glass on a stone kerb: a lattice of webs with a small block in the
        middle of every cell. A screen, not a wall — you see the host's own
        glazing through the holes — and the only fine-grained shadow on a
        building otherwise made of very large plain pieces.
     5. THE CARPORT. A deep shaded slot on the flank where the overhang is
        grown to a car's length, floored with a low slab (ctx.plat at 0.14 m,
        well under physics STEP_UP) and screened at one end by slump block.
     6. HORIZONTALITY. Low stone garden walls run OUT past the house into the
        yard, one pair forming a walled entry court, so the building's lines do
        not stop where its walls do. On the elevation the same idea is a 1 m
        fascia band at every floor line — and that band lives ENTIRELY in the
        host shell's own solid zones (the 0.45 header below a floor line plus
        the 0.55 sill above it), so the strongest horizontal in the design
        never covers a single pane of the building's own glass.
     7. THE FIREPLACE. One coursed warm-stone mass from the ground straight
        through the roof plane: the only vertical event in a composition of
        horizontals, and what stops the house reading as a stack of trays.

   WHERE THE GLASS IS. Everything solid here is either a VERTICAL (mullions,
   stone piers, the fireplace, posts, door jambs — allowed to cross the window
   band, and precisely what turns a ribbon into separate panes), or a
   horizontal inside a solid zone, or something held clear of the wall as an
   overhang or a free-standing screen. No band crosses mid-storey.

   COLOUR. Bone plane, warm desert stone, dark steel, and ONE hot accent on the
   front door — tangerine, magenta, turquoise or marigold by position hash.
   Values are anchored mid-dark deliberately: intl.js measured that this
   renderer's key multiplies a source hex by roughly three and a half, so a
   "bone white" of 0xd0 arrives as blown-out paper, and a facade whose whole
   subject is the shadow under a white plane cannot afford that.

   BUDGET. Zero real meshes — everything is ctx.dbox, so this house costs the
   same draw calls as a bare box. The posts are square steel tube, which is
   both correct and free; ctx.column would have made them round AND expensive.

   maxStoreys 3, because this grammar is low and horizontal by definition and a
   four-storey block of it would be a lie. An explicit dress spec is still
   obeyed, and still re-proportions: every number comes from w, d, storeys, FH,
   rTop or a face span.

   SPEC (optional, all defaulted): roof:"flat"|"butterfly", accent:<hex>.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  CBZ.registerFacade("desertmod", {
    label: "Desert Modern House",
    crownsRoof: true,
    maxStoreys: 3,
    build: function (ctx, F, spec) {
      spec = spec || {};
      const W = ctx.w, D = ctx.d, FH = ctx.FH, H = ctx.rTop, PP = ctx.pp;
      const ST = Math.max(1, ctx.storeys | 0);
      const small = Math.min(W, D), big = Math.max(W, D);
      const h = function (s) { return ctx.hash(s); };
      const faces = F.faces(ctx);
      const e = F.entrance(ctx);
      const df = e.f;                       // the entrance face
      // a point on face f, `t` along it, Dd out from the wall plane → [x,z]
      const pt = function (f, t, Dd) { return f.horiz ? [t, f.out * (f.halfN + Dd)] : [f.out * (f.halfN + Dd), t]; };
      // A ground slab lying OUTSIDE face f — n0 to n1 out of its wall plane,
      // `tw` wide about tangent `tc` — emitted AND registered as a walk
      // platform. The carport deck, the entry terrace and its apron are all
      // this shape, so the horiz/vertical split is written once.
      const outSlab = function (f, tc, tw, n0, n1, top, col, ramp) {
        if (n1 - n0 <= 0.05 || tw <= 0.05) return;
        F.box(ctx, f, tc, top / 2, tw, top, n1 - n0, col, n0);
        const a = f.out * (f.halfN + n0), b = f.out * (f.halfN + n1);
        const lo = Math.min(a, b), hi = Math.max(a, b);
        if (f.horiz) ctx.plat(tc - tw / 2, tc + tw / 2, lo, hi, top,
          ramp ? { z0: ctx.oz + b, z1: ctx.oz + a, y0: 0, y1: top } : null);
        else ctx.plat(lo, hi, tc - tw / 2, tc + tw / 2, top,
          ramp ? { axis: "x", x0: ctx.ox + b, x1: ctx.ox + a, y0: 0, y1: top } : null);
      };

      // The host shell's own solid zones, per storey k: k*FH … k*FH+SILL and
      // (k+1)*FH-HDR … (k+1)*FH. Every horizontal here is checked against them.
      const SILL = 0.55, HDR = 0.45;

      // ============================================================
      //  0. PALETTE
      // ============================================================
      const base = (ctx.pal && ctx.pal.wall) || ctx.color;
      const BONE = F.shade(F.mix(base, 0xd8d2c4, 0.62), 0.88);   // the plane, the fascias
      const BONE_L = F.shade(BONE, 1.14);                        // lit arris on the blade edge
      const SOFF = F.shade(BONE, 0.32);                          // the underside of the plane
      const STONE = F.shade(F.mix(base, 0x9a6d42, 0.84), 0.84);  // warm desert stone
      const STONE_L = F.mix(STONE, 0xc7a678, 0.30);              // coping, sunlit course
      const STONE_D = F.shade(STONE, 0.60);                      // mortar shadow
      const STEEL = F.mix(0x1d2126, base, 0.08);                 // posts, mullions, beams
      const STEEL_L = F.shade(STEEL, 2.05);                      // the one lit edge of a tube
      const CLER = F.mix(0x101820, base, 0.06);                  // clerestory glass, deep shade
      const BLOCK = F.shade(BONE, 1.06);                         // painted breeze block
      const CONC = F.shade(F.mix(base, 0xa8a094, 0.55), 0.58);   // paving: up-facing, so darker
      // ONE hot colour, on the door and nowhere else.
      const ACC_SET = [0x8f3208, 0x82184a, 0x0b5257, 0x8a6104];
      const ACCENT = spec.accent != null ? spec.accent
        : ACC_SET[Math.min(ACC_SET.length - 1, (h(0xd104) * ACC_SET.length) | 0)];

      // projection hierarchy — stone in front of the fascia, fascia in front of
      // the glazing, mullions barely proud of it. This ordering is what makes
      // the house read as horizontal: the strongest shadow line is the fascia.
      const SP = clamp(small * 0.040, 0.34, 0.62);    // stone piers / plinth
      const FP = clamp(small * 0.026, 0.22, 0.40);    // floor-line fascia
      const MP = FP * 0.55;                           // steel mullions

      // ============================================================
      //  1. SOLVING THE ROOF PLANE (numbers only — it is emitted last)
      // ============================================================
      // Solved FIRST because everything tall here measures itself against the
      // plane's underside: the post ring, the rakers, the clerestory wedge and
      // the fireplace all ask soffitAt() how high the roof is above them.
      const OV_F = clamp(small * 0.36, 1.8, 5.0);     // entry side: enormous
      const OV_C = clamp(small * 0.48, 2.6, 6.0);     // carport side: a car deep
      const OV_S = clamp(small * 0.20, 1.1, 2.8);     // the quiet flank
      const OV_B = clamp(small * 0.15, 0.85, 2.2);    // the back
      const PT = clamp(small * 0.022, 0.20, 0.34);    // plate thickness: a blade

      // which flank gets the carport, which gets the fireplace
      const flankS = df.horiz ? [2, 3] : [0, 1];
      const cpS = flankS[h(0xd105) < 0.5 ? 0 : 1];
      const fpS = flankS[cpS === flankS[0] ? 1 : 0];
      const backS = df.s === 0 ? 1 : (df.s === 1 ? 0 : (df.s === 2 ? 3 : 2));

      const ov = [OV_S, OV_S, OV_S, OV_S];
      ov[df.s] = OV_F; ov[cpS] = OV_C; ov[fpS] = OV_S; ov[backS] = OV_B;

      // the plate's plan rectangle
      const px0 = -(W / 2 + ov[2]), px1 = W / 2 + ov[3];
      const pz0 = -(D / 2 + ov[0]), pz1 = D / 2 + ov[1];

      // Terrace depth belongs with the rest of the plan: the entry-court wall
      // in §10 must stand OUTSIDE it, and §10 runs before §11 builds it.
      const TERR_D = clamp(Math.min(ov[df.s] * 0.50, small * 0.17), 1.10, 2.60);
      const TERR_A = clamp(TERR_D * 0.55, 0.60, 1.40);       // the half-rise apron

      // BUTTERFLY OR FLAT. The valley runs parallel to the entrance face, so
      // the wings rise toward the entry and toward the back — the deep entry
      // eave is the one that lifts, which is the whole point of the shape.
      const butterfly = spec.roof ? (spec.roof === "butterfly") : (h(0xd101) < 0.62);
      const tiltZ = df.horiz;                          // true → plate tilts across z
      const tMin = tiltZ ? pz0 : px0, tMax = tiltZ ? pz1 : px1;
      const crossC = tiltZ ? (px0 + px1) / 2 : (pz0 + pz1) / 2;
      const crossLen = tiltZ ? (px1 - px0) : (pz1 - pz0);
      const RISE = butterfly ? clamp(small * 0.16, 0.90, 2.60) : 0;
      const SLOPE = butterfly ? RISE / Math.max(tMax, -tMin) : 0;
      // the underside sits directly on the host's parapet head, so the dark
      // clerestory slot below reads as glass carrying the roof.
      const ySoff = H + PP + 0.04;
      const soffitAt = function (x, z) {
        return ySoff + SLOPE * Math.abs(tiltZ ? z : x);
      };

      // ============================================================
      //  2. THE HORIZONTAL DATUM — plinth, floor-line fascias, wall head
      // ============================================================
      // The three bands that make the house horizontal. Every one of them is
      // wholly inside a solid zone of the host shell (see §0's SILL/HDR).
      const PLINTH = Math.min(0.50, FH * 0.16);        // inside storey 0's sill zone
      F.ring(ctx, PLINTH / 2, PLINTH, SP, STONE, SP * 2.1, 0);
      F.ring(ctx, PLINTH - 0.02, 0.10, SP + 0.10, STONE_L, SP * 2.2, 0);
      F.ring(ctx, 0.06, 0.12, SP + 0.16, STONE_D, SP * 2.3, 0);   // the ground shadow line

      // FLOOR LINES: one band per intermediate floor, spanning the header zone
      // below the line and the sill zone above it — a continuous metre of bone
      // stucco that never touches glass.
      for (let k = 1; k < ST; k++) {
        const y = k * FH;
        F.ring(ctx, y + (SILL - HDR) / 2, SILL + HDR, FP, BONE, FP * 2.1, 0);
        F.ring(ctx, y - HDR + 0.07, 0.12, FP + 0.14, SOFF, FP * 2.3, 0);      // drip shadow
        F.ring(ctx, y + SILL - 0.06, 0.10, FP + 0.07, BONE_L, FP * 2.1, 0);   // lit top lip
      }
      // THE WALL HEAD: the last bone band, in the top storey's header zone,
      // immediately under the clerestory.
      F.ring(ctx, H - HDR / 2, HDR, FP, BONE, FP * 2.1, 0);
      F.ring(ctx, H - HDR + 0.06, 0.11, FP + 0.14, SOFF, FP * 2.3, 0);

      // ============================================================
      //  3. THE POST-AND-BEAM GRID — steel mullions, stone corner piers
      // ============================================================
      // Verticals, which is the one thing allowed to cross the host's window
      // band, and the reason the glazing reads as separate panes of a glass
      // wall instead of as a ribbon. Module ~2.5 m: a post-and-beam bay.
      const MPITCH = clamp(FH * 0.80, 2.1, 2.9);
      const MW = clamp(small * 0.016, 0.11, 0.20);
      for (const f of faces) {
        const n = Math.max(2, Math.round(f.span / MPITCH));
        const lines = F.bayLines(f, n, SILL);      // ends land on the host's own jamb
        for (let i = 0; i < lines.length; i++) {
          const t = lines[i];
          if (!F.clearsDoor(ctx, f, t, MW + 1.0)) continue;
          const end = (i === 0 || i === lines.length - 1);
          const wid = end ? MW * 1.7 : MW;
          F.rib(ctx, f, t, PLINTH, H - HDR, wid, MP, STEEL, 0);
          // one lit edge, so a flat dark strip still reads as a steel section
          F.rib(ctx, f, t + wid * 0.34, PLINTH, H - HDR, wid * 0.30, MP + 0.03, STEEL_L, 0);
        }
      }
      // STONE CORNER PIERS. F.bayLines keeps the end mullion off the arris, so
      // without these the four faces would meet in nothing. Emitted with
      // F.corners so each pier is present on both faces it turns.
      const pierL = clamp(small * 0.075, 0.55, 1.30);
      F.corners(ctx, (H - HDR) / 2, H - HDR, pierL, SP, STONE);
      F.corners(ctx, PLINTH * 0.5, PLINTH + 0.12, pierL + 0.18, SP + 0.14, STONE_D);
      F.corners(ctx, H - HDR - 0.10, 0.16, pierL + 0.16, SP + 0.10, STONE_L);
      // Slump-block coursing on the piers: horizontal, but never wider than the
      // pier, so it cannot reach the glass between them. Held to the lower
      // storey — F.corners costs eight boxes a course, and stone texture only
      // reads at the height a person stands at anyway.
      {
        const cs = clamp(FH * 0.15, 0.40, 0.62);
        const cTop = Math.min(H - HDR - 0.20, PLINTH + FH * 1.05);
        const nc = Math.max(2, Math.min(8, Math.floor((cTop - PLINTH) / cs)));
        for (let i = 1; i <= nc; i++) {
          F.corners(ctx, PLINTH + i * cs, 0.07, pierL - 0.06, SP + 0.05,
            F.shade(STONE, 0.60 + h(0xd110 + i) * 0.16));
        }
      }

      // ============================================================
      //  4. THE FIREPLACE MASS — the one vertical, straight through the roof
      // ============================================================
      const ff = F.face(ctx, fpS);
      const fpT = df.out * ff.span * 0.20;             // pushed toward the street corner
      const fpW = clamp(ff.span * 0.16, 1.10, 2.80);
      const fpP = clamp(small * 0.062, 0.45, 1.15);
      {
        const p = pt(ff, fpT, fpP);
        const top = soffitAt(p[0], p[1]) + PT + clamp(FH * 0.42, 1.00, 2.10);
        F.rib(ctx, ff, fpT, 0, top, fpW, fpP, STONE, 0);
        F.rib(ctx, ff, fpT - fpW * 0.5, 0, top, 0.14, fpP + 0.05, STONE_D, 0);   // the two arrises
        F.rib(ctx, ff, fpT + fpW * 0.5, 0, top, 0.14, fpP + 0.05, STONE_L, 0);
        const cs = clamp(FH * 0.15, 0.40, 0.62);
        const nc = Math.max(3, Math.min(26, Math.floor(top / cs)));
        for (let i = 1; i <= nc; i++) {
          F.box(ctx, ff, fpT, i * cs, fpW + 0.05, 0.07, fpP + 0.04,
            F.shade(STONE, 0.58 + h(0xd120 + i) * 0.18), 0);
        }
        // bone cap and a steel flue: the chimney has to terminate or the mass
        // reads as an unfinished wall poking out of the roof.
        F.box(ctx, ff, fpT, top + 0.13, fpW + 0.34, 0.26, fpP + 0.24, BONE, 0);
        F.box(ctx, ff, fpT, top + 0.28, fpW + 0.14, 0.10, fpP + 0.12, SOFF, 0);
        F.box(ctx, ff, fpT, top + 0.62, fpW * 0.30, 0.62, fpP * 0.50, STEEL, fpP * 0.24);
        F.box(ctx, ff, fpT, top + 0.98, fpW * 0.44, 0.12, fpP * 0.70, STEEL_L, fpP * 0.14);
      }

      // ============================================================
      //  5. THE CLERESTORY WEDGE — dark glass running up to the plane
      // ============================================================
      // The host's parapet zone clad as glass, then continued UP to meet the
      // roof's underside at whatever height the roof is over that point. Flat →
      // a level slot; butterfly → a wedge growing toward each eave. Emitted in
      // segments so its top can follow the tilt.
      const CLP = clamp(FP * 0.55, 0.12, 0.22);
      for (const f of faces) {
        const nSeg = clamp(Math.round(f.span / 1.5), 4, 16);
        const step = (f.span + 0.24) / nSeg;
        for (let i = 0; i < nSeg; i++) {
          const t = -(f.span + 0.24) / 2 + (i + 0.5) * step;
          const p = pt(f, t, 0);
          const top = soffitAt(p[0], p[1]) - 0.04;
          if (top - H < 0.14) continue;
          F.box(ctx, f, t, (H + top) / 2, step + 0.06, top - H, CLP, CLER, -0.03);
        }
        // the mullions crossing the slot, on the same module as the wall below,
        // so the glass wall and the clerestory are visibly one system
        const n = Math.max(2, Math.round(f.span / MPITCH));
        const lines = F.bayLines(f, n, SILL);
        for (let i = 0; i < lines.length; i++) {
          const p = pt(f, lines[i], 0);
          const top = soffitAt(p[0], p[1]) - 0.05;
          F.rib(ctx, f, lines[i], H - HDR * 0.6, top, MW * 1.2, CLP + 0.06, STEEL, -0.02);
        }
      }

      // ============================================================
      //  6. BREEZE-BLOCK SCREENS — pierced, standing OFF the glass
      // ============================================================
      // A lattice of thin webs with a small block in the middle of every cell.
      // It stands half a metre in front of the host's own glazing on a stone
      // kerb, so you look THROUGH it to the glass behind: that is the whole
      // difference between a screen and a wall, and it is the only fine-grained
      // shadow on the building.
      const SO = clamp(small * 0.050, 0.34, 0.72);      // stand-off from the wall
      const BTH = clamp(small * 0.024, 0.20, 0.32);     // block depth
      const breeze = function (f, tc, wid, y0, y1, salt) {
        if (wid < 1.30 || y1 - y0 < 1.00) return;
        const cell = clamp(FH * 0.24, 0.56, 0.86);
        const nx = Math.max(2, Math.round(wid / cell));
        const ny = Math.max(2, Math.round((y1 - y0) / cell));
        const cw = wid / nx, ch = (y1 - y0) / ny;
        const web = clamp(cell * 0.17, 0.10, 0.19);
        // the kerb it stands on (out in front of the wall, not against it)
        F.box(ctx, f, tc, y0 - 0.17, wid + 0.36, 0.34, BTH + 0.26, STONE, SO - 0.12);
        F.box(ctx, f, tc, y0 - 0.02, wid + 0.20, 0.09, BTH + 0.30, STONE_L, SO - 0.14);
        for (let i = 0; i <= nx; i++) {                 // vertical webs
          const t = tc - wid / 2 + i * cw;
          const ww = (i === 0 || i === nx) ? web * 1.55 : web;
          F.rib(ctx, f, t, y0, y1, ww, BTH, BLOCK, SO);
        }
        for (let j = 0; j <= ny; j++) {                 // horizontal webs
          const y = y0 + j * ch;
          const hh = (j === 0 || j === ny) ? web * 1.55 : web;
          F.box(ctx, f, tc, y, wid + web, hh, BTH, BLOCK, SO);
        }
        for (let i = 0; i < nx; i++) {                  // the pip in each cell
          for (let j = 0; j < ny; j++) {
            const jitter = 0.92 + h(salt + i * 7 + j * 3) * 0.16;
            F.box(ctx, f, tc - wid / 2 + (i + 0.5) * cw, y0 + (j + 0.5) * ch,
              cw * 0.30 * jitter, ch * 0.30 * jitter, BTH * 0.86, F.shade(BLOCK, 0.90), SO);
          }
        }
        // a slim lit cap: a screen needs a top edge or it reads as a texture
        F.box(ctx, f, tc, y1 + 0.11, wid + 0.44, 0.16, BTH + 0.18, BONE_L, SO - 0.06);
      };
      // How tall a screen may be: one storey, and never up into the clerestory.
      const scrY0 = PLINTH + 0.20;
      const scrY1 = (ST > 1) ? (FH - 0.14) : Math.min(H - HDR - 0.30, scrY0 + FH * 0.94);
      {
        // ONE on the entrance face, beside the door on the roomier side.
        const room = df.span / 2 - e.gap / 2 - 0.70;
        if (room > 1.6) {
          const sg = h(0xd108) < 0.5 ? -1 : 1;
          const wid = clamp(room * 0.86, 1.4, 5.6);
          breeze(df, sg * (e.gap / 2 + room / 2 + 0.20), wid, scrY0, scrY1, 0xd200);
        }
        // ONE on the fireplace flank, on the far side of the mass from it, so
        // the two do not fight over the same stretch of wall.
        const st = -df.out * ff.span * 0.22;
        const swid = clamp(ff.span * 0.40, 1.4, ff.span * 0.48);
        breeze(ff, st, swid, scrY0, scrY1, 0xd240);
      }

      // ============================================================
      //  7. THE CARPORT — the deep shaded slot on one flank
      // ============================================================
      const cf = F.face(ctx, cpS);
      const CARY = 0.14;                                // < physics STEP_UP (0.45)
      {
        const cw = clamp(cf.span * 0.62, 3.4, cf.span - 1.10);
        const ct = -df.out * cf.span * 0.10;            // shifted off the entry end
        const cd = ov[cpS] - 0.15;
        outSlab(cf, ct, cw, 0, cd, CARY, CONC, null);
        // the poured strip down the middle of the deck: a carport is not a room
        F.box(ctx, cf, ct, CARY + 0.02, cw * 0.32, 0.05, cd, F.shade(CONC, 1.18), 0);
        // the SCREEN WALL at the far end (a slump-block privacy wall, chest to
        // head high) and a low kerb at the near end. Asymmetric on purpose: one
        // end of a carport is the storage wall, the other is where you walk in.
        const swH = clamp(FH * 0.62, 1.7, 2.5);
        const kbH = clamp(FH * 0.26, 0.70, 1.05);
        const wallT = clamp(small * 0.036, 0.30, 0.50);
        const ends = [{ t: ct - cw / 2 - wallT * 0.5, hgt: df.out > 0 ? swH : kbH },
          { t: ct + cw / 2 + wallT * 0.5, hgt: df.out > 0 ? kbH : swH }];
        for (let i = 0; i < ends.length; i++) {
          const y = ends[i].hgt;
          const lifts = 3;
          for (let k = 0; k < lifts; k++) {
            const a = y * k / lifts, b = y * (k + 1) / lifts;
            F.box(ctx, cf, ends[i].t, (a + b) / 2, wallT, b - a - 0.03, cd - 0.20,
              F.shade(STONE, 0.90 + h(0xd260 + i * 5 + k) * 0.20), 0.10);
          }
          F.box(ctx, cf, ends[i].t, y + 0.07, wallT + 0.16, 0.13, cd - 0.10, STONE_L, 0.06);
        }
      }

      // ============================================================
      //  8. THE POST RING — what the roof plane actually stands on
      // ============================================================
      // Solved from the PLATE's plan rectangle rather than face by face, so the
      // four corners get exactly one post each instead of two arguing about the
      // same spot. Every post asks soffitAt() for its own top: on a butterfly
      // the posts along the sloping edges are visibly different lengths, which
      // is the honest expression of the roof and half of what sells the shape.
      const PSEC = clamp(small * 0.021, 0.15, 0.28);
      const pin = clamp(Math.min(OV_S, OV_B) * 0.22, 0.20, 0.60);   // post line inset
      const qx0 = px0 + pin, qx1 = px1 - pin, qz0 = pz0 + pin, qz1 = pz1 - pin;
      const PPITCH = clamp(FH * 1.05, 2.6, 3.9);
      // the doorway keep-out, in plan: tangent along the door face, normal out
      const dKeep = (e.gap + PSEC + 1.2) / 2;
      const foulsDoor = function (x, z) {
        const tan = df.horiz ? x : z;
        const nrm = df.horiz ? z : x;
        return Math.abs(tan) < dKeep && nrm * df.out > df.halfN * 0.4;
      };
      const post = function (x, z) {
        if (foulsDoor(x, z)) return;
        const top = soffitAt(x, z) - 0.02;
        if (top < 1.4) return;
        ctx.dbox(x, top / 2, z, PSEC, top, PSEC, STEEL);
        ctx.dbox(x, top / 2, z, PSEC * 1.04, top, PSEC * 0.30, STEEL_L);   // lit edge
        ctx.dbox(x, 0.07, z, PSEC * 2.1, 0.14, PSEC * 2.1, CONC);          // footing pad
      };
      const BEAMH = clamp(small * 0.026, 0.24, 0.42);
      const nqx = Math.max(2, Math.round((qx1 - qx0) / PPITCH));
      const nqz = Math.max(2, Math.round((qz1 - qz0) / PPITCH));
      for (let i = 0; i <= nqx; i++) {                  // the two x-running edges
        const x = qx0 + (qx1 - qx0) * i / nqx;
        post(x, qz0); post(x, qz1);
        if (i === nqx) continue;
        const xb = qx0 + (qx1 - qx0) * (i + 1) / nqx, xm = (x + xb) / 2;
        for (const z of [qz0, qz1]) {
          const y = soffitAt(xm, z) - 0.03 - BEAMH / 2;
          ctx.dbox(xm, y, z, xb - x + PSEC, BEAMH, PSEC * 1.15, STEEL);
          ctx.dbox(xm, y + BEAMH * 0.40, z, xb - x + PSEC, BEAMH * 0.22, PSEC * 1.30, STEEL_L);
        }
      }
      for (let j = 0; j < nqz; j++) {                   // the two z-running edges
        const za = qz0 + (qz1 - qz0) * j / nqz, zb = qz0 + (qz1 - qz0) * (j + 1) / nqz;
        const zm = (za + zb) / 2;
        if (j > 0) { post(qx0, za); post(qx1, za); }    // corners belong to the x edges
        for (const x of [qx0, qx1]) {
          const y = soffitAt(x, zm) - 0.03 - BEAMH / 2;
          ctx.dbox(x, y, zm, PSEC * 1.15, BEAMH, zb - za + PSEC, STEEL);
          ctx.dbox(x, y + BEAMH * 0.40, zm, PSEC * 1.30, BEAMH * 0.22, zb - za + PSEC, STEEL_L);
        }
      }

      // TWO ANGLED FEATURE POSTS at the entry, raking outward as they rise.
      // ctx.column is Y-axis only and would cost real meshes, so a rake is
      // built the same way a mansard is: stacked boxes, each stepped sideways,
      // each a little taller than its step so the joints close.
      {
        const tR = clamp(df.span * 0.30, 1.5, df.span * 0.42);
        const Dp = ov[df.s] - pin + 0.42;
        for (const sg of [-1, 1]) {
          const pA = pt(df, sg * tR, Dp);
          const top = soffitAt(pA[0], pA[1]) - 0.04;
          if (top < 1.6) continue;
          const rake = clamp(top * 0.17, 0.5, 1.4);     // how far the head leans out
          const nS = 10;
          for (let i = 0; i < nS; i++) {
            const u = (i + 0.5) / nS;
            const p = pt(df, sg * (tR + rake * u), Dp);
            ctx.dbox(p[0], top * u, p[1], PSEC * 0.92, top / nS * 1.5, PSEC * 0.92, STEEL);
          }
          const pF = pt(df, sg * tR, Dp);
          ctx.dbox(pF[0], 0.08, pF[1], PSEC * 2.3, 0.16, PSEC * 2.3, CONC);
        }
      }

      // ============================================================
      //  9. THE ROOF PLANE — one thin blade, floating past every wall
      // ============================================================
      // Ribbons across the tilt axis. For a flat roof there is exactly one.
      // For a butterfly the y step per ribbon is held under half the plate
      // thickness, so consecutive ribbons overlap and the staircase reads as a
      // continuous sheet rather than as a flight of trays.
      {
        const ribs = [];
        if (butterfly) {
          for (const sg of [-1, 1]) {
            const L = sg > 0 ? tMax : -tMin;
            const n = clamp(Math.ceil(L * SLOPE / (PT * 0.48)), 4, 16);
            for (let i = 0; i < n; i++) ribs.push([sg * L * i / n, sg * L * (i + 1) / n]);
          }
        } else {
          ribs.push([tMin, tMax]);
        }
        // place a box in plate coordinates: `tc` along the tilt axis, the full
        // cross span (optionally shrunk) across it
        const lay = function (tc, y, hgt, tlen, shrink, col) {
          const cl = crossLen - (shrink || 0);
          if (cl <= 0.1) return;
          if (tiltZ) ctx.dbox(crossC, y, tc, cl, hgt, tlen, col);
          else ctx.dbox(tc, y, crossC, tlen, hgt, cl, col);
        };
        const edge = function (tc, y, tlen, sgn, hgt, wid, col) {
          const cp = crossC + sgn * (crossLen / 2 - wid / 2);
          if (tiltZ) ctx.dbox(cp, y, tc, wid, hgt, tlen, col);
          else ctx.dbox(tc, y, cp, tlen, hgt, wid, col);
        };
        for (let i = 0; i < ribs.length; i++) {
          const a = ribs[i][0], b = ribs[i][1];
          const tc = (a + b) / 2, tlen = Math.abs(b - a) + 0.03;
          const yb = soffitAt(tiltZ ? 0 : tc, tiltZ ? tc : 0);
          // the dark underside, held in from the edge so the blade's own rim
          // stays bone all the way round
          lay(tc, yb + 0.05, 0.10, tlen, 0.18, SOFF);
          lay(tc, yb + 0.10 + (PT - 0.10) / 2, PT - 0.10, tlen, 0, BONE);
          // Gravel deck: what the aerial camera sees, inside a bone gravel stop.
          // A butterfly's ribbons are already narrow, so only the single flat
          // ribbon may be shortened along the tilt axis — shrinking a 0.5 m
          // ribbon by 0.5 m would emit an inverted box.
          const gvT = (ribs.length === 1) ? Math.max(0.30, tlen - 0.9) : tlen;
          lay(tc, yb + PT + 0.02, 0.05, gvT, 1.6, F.shade(CONC, 0.92));
          // the lit rim along the two sloping edges
          for (const sgn of [-1, 1]) {
            edge(tc, yb + PT + 0.03, tlen, sgn, 0.09, 0.20, BONE_L);
            edge(tc, yb - 0.02, tlen, sgn, 0.07, 0.26, SOFF);
          }
        }
        // the two EAVES at the ends of the tilt axis: the thin lines that carry
        // the whole silhouette, so they get a lit lip and a dark drip.
        for (const sgn of [-1, 1]) {
          const te = sgn > 0 ? tMax : tMin;
          const yb = soffitAt(tiltZ ? 0 : te, tiltZ ? te : 0);
          lay(te - sgn * 0.11, yb + PT + 0.03, 0.09, 0.22, 0, BONE_L);
          lay(te - sgn * 0.13, yb - 0.02, 0.07, 0.26, 0.10, SOFF);
        }
        // BUTTERFLY VALLEY: the gutter over the middle of the house. Without it
        // the two wings just meet in a crease and the roof loses its logic.
        if (butterfly) {
          lay(0, ySoff + PT * 0.55, PT * 0.55, clamp(small * 0.06, 0.45, 0.85), 0.6, STEEL);
          lay(0, ySoff + PT + 0.02, 0.06, clamp(small * 0.06, 0.45, 0.85) + 0.20, 0.9, SOFF);
        }
      }

      // ============================================================
      //  10. GARDEN WALLS — the horizontal, continued out into the yard
      // ============================================================
      // Low slump-block walls running OUT past the building. They are the
      // reason the house reads as long and low from any angle: the eye follows
      // a line that starts inside the plan and ends 8 m away in the sand.
      const GWH = clamp(FH * 0.28, 0.72, 1.15);
      const GWT = clamp(small * 0.036, 0.30, 0.50);
      const gwall = function (x0, x1, z0, z1, hgt, salt) {
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, sx = x1 - x0, sz = z1 - z0;
        if (sx <= 0.05 || sz <= 0.05) return;
        const lifts = 3;
        for (let i = 0; i < lifts; i++) {
          const a = hgt * i / lifts, b = hgt * (i + 1) / lifts;
          ctx.dbox(cx, (a + b) / 2, cz, sx, b - a - 0.03, sz,
            F.shade(STONE, 0.88 + h(salt + i) * 0.22));
        }
        ctx.dbox(cx, hgt + 0.07, cz, sx + 0.17, 0.13, sz + 0.17, STONE_L);
        ctx.dbox(cx, 0.07, cz, sx + 0.10, 0.14, sz + 0.10, STONE_D);
      };
      {
        // two long walls running out from the back corners of the flanks
        const run = clamp(big * 0.42, 3.0, 11.0);
        const bs = df.out > 0 ? -1 : 1;          // "away from the entrance face"
        for (const sg of [-1, 1]) {
          if (df.horiz) {
            const x = sg * (W / 2 - GWT * 0.5);
            const z0 = bs > 0 ? D / 2 - 0.4 : -(D / 2 + run);
            const z1 = bs > 0 ? D / 2 + run : -(D / 2 - 0.4);
            gwall(x - GWT / 2, x + GWT / 2, z0, z1, GWH * (sg < 0 ? 1 : 0.86), 0xd300 + sg * 7);
          } else {
            const z = sg * (D / 2 - GWT * 0.5);
            const x0 = bs > 0 ? W / 2 - 0.4 : -(W / 2 + run);
            const x1 = bs > 0 ? W / 2 + run : -(W / 2 - 0.4);
            gwall(x0, x1, z - GWT / 2, z + GWT / 2, GWH * (sg < 0 ? 1 : 0.86), 0xd310 + sg * 7);
          }
        }
        // THE ENTRY COURT: a wall parallel to the entrance face, in two pieces
        // with the path between them, each piece running out past the plate
        // corner. Emitted in segments around the doorway — the same rule that
        // governs a string course also governs a garden wall.
        const cdst = TERR_D + TERR_A + 0.55;           // clear of the terrace apron
        const gapH = e.gap / 2 + 1.10;
        const outr = df.span / 2 + clamp(small * 0.16, 0.8, 2.6);
        for (const sg of [-1, 1]) {
          const t0 = sg > 0 ? gapH : -outr, t1 = sg > 0 ? outr : -gapH;
          const n0 = df.halfN + cdst, n1 = n0 + GWT;
          if (df.horiz) {
            const z = df.out > 0 ? n0 : -n1;
            gwall(t0, t1, z, z + GWT, GWH * 0.92, 0xd320 + sg * 11);
          } else {
            const x = df.out > 0 ? n0 : -n1;
            gwall(x, x + GWT, t0, t1, GWH * 0.92, 0xd330 + sg * 11);
          }
        }
      }

      // ============================================================
      //  11. THE ENTRY — the terrace, and the one hot colour in the house
      // ============================================================
      {
        // ONE low float at 0.26 and an apron at half that, both under physics
        // STEP_UP (0.45), so there is no flight of steps to bounce off and the
        // apron carries a ramp — a sprinting player never samples the seam.
        const TOP = 0.26, TD = TERR_D, AD = TERR_A;
        const TW = Math.min(df.span - 0.5, e.gap + clamp(df.span * 0.42, 2.6, 7.0));
        outSlab(df, 0, TW, 0, TD, TOP, CONC, null);
        F.box(ctx, df, 0, TOP - 0.02, TW - 0.5, 0.06, TD - 0.4, F.shade(CONC, 1.14), 0.2);
        outSlab(df, 0, TW - 0.8, TD, TD + AD, TOP / 2, F.shade(CONC, 0.92), true);
        // THE DOOR. The accent lives on VERTICALS only: two jambs and one tall
        // panel beside the opening. There is deliberately no lintel over the
        // door — between the ground storey's header zone and F.entrance's head
        // clearance there is no legal height for one, and a coloured board
        // hanging in the doorway is the exact bug the kit warns about.
        const jT = Math.min(H - HDR - 0.15, e.head - 0.05);
        const jw = clamp(small * 0.020, 0.16, 0.30);
        for (const sg of [-1, 1]) {
          F.rib(ctx, df, sg * (e.gap / 2 + jw * 0.7), TOP, jT, jw, SP + 0.08, ACCENT, 0);
          F.rib(ctx, df, sg * (e.gap / 2 + jw * 0.7), TOP, jT, jw * 0.34, SP + 0.13,
            F.shade(ACCENT, 1.30), 0);
        }
        // the coloured panel: the second half of every mid-century front door
        const room = df.span / 2 - e.gap / 2 - 0.70;
        if (room > 1.1) {
          const sgP = h(0xd108) < 0.5 ? 1 : -1;         // opposite side to the breeze screen
          const pw = clamp(room * 0.30, 0.5, 1.15);
          const pT = Math.min(H - HDR - 0.15, e.head + 0.30);
          F.rib(ctx, df, sgP * (e.gap / 2 + jw * 1.4 + pw / 2), TOP, pT, pw, SP + 0.05, ACCENT, 0);
          F.rib(ctx, df, sgP * (e.gap / 2 + jw * 1.4 + pw / 2), pT - 0.10, pT, pw + 0.10, 0.12,
            F.shade(ACCENT, 0.62), SP + 0.02);
          // house numbers: four small accent pips up the panel edge
          for (let i = 0; i < 4; i++) {
            F.box(ctx, df, sgP * (e.gap / 2 + jw * 1.4 + pw + 0.26), pT - 0.45 - i * 0.32,
              0.15, 0.15, SP + 0.14, F.shade(ACCENT, 1.35), 0);
          }
        }
        // a planter box each side on the terrace: low, stone, one more line
        const plW = clamp(TW * 0.24, 0.7, 2.2), plH = clamp(FH * 0.09, 0.22, 0.36);
        const plT = (e.gap / 2 + TW / 2) / 2;
        if (TW / 2 - e.gap / 2 >= plW + 0.4) for (const sg of [-1, 1]) {
          F.box(ctx, df, sg * plT, TOP + plH / 2 + 0.02, plW, plH, TD * 0.55, STONE, 0.10);
          F.box(ctx, df, sg * plT, TOP + plH + 0.04, plW + 0.14, 0.09, TD * 0.55 + 0.12, STONE_L, 0.05);
        }
      }
    },
  });
})();
