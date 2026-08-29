/* ============================================================
   city/facades/queenanne.js — "Queen Anne Painted Lady": the San Francisco
   Victorian HOUSE, c. 1890.

   WHAT IS BEING MODELLED. Not a block and not a storefront — a detached HOUSE,
   and specifically the one built by the thousand on the sand hills west of Van
   Ness: balloon-framed, milled to a catalogue, then painted in three colours so
   that every last piece of the millwork is legible from the far pavement. Its
   governing conviction is the exact opposite of victorian.js's Second Empire
   block: that building is HORIZONTALLY LAYERED, SYMMETRICAL and wears a
   mansard, and this one is VERTICALLY RESTLESS, DELIBERATELY LOPSIDED and wears
   a steep cross-gabled roof with a tower growing out of one corner. If the two
   ever read as the same drawing, this file has failed.

   ASYMMETRY IS THE SUBJECT, so it is decided first and everything else solves
   around it. One CORNER — picked by position hash, never the middle — takes the
   turret. The flank opposite the turret takes the cross gable and, under it,
   the bay window. The porch wraps two faces instead of sitting politely on one.
   Nothing here is centred except the door.

   WHY EACH ELEMENT IS HERE.
     TURRET      a round corner tower from the porch deck clear past the main
                 ridge, capped by a tall CANDLE-SNUFFER cone and a finial. This
                 is the whole silhouette argument: at 200 m the house is a steep
                 triangle with a cone through one shoulder, and nothing else in
                 the city makes that shape. Hence crownsRoof.
     CROSS       the main ridge runs at right angles to the street, so the door
     GABLES      face is a full GABLE END; a second gable crosses it on one
                 flank. Both are stepped axis-aligned courses narrowing on ONE
                 axis — the mansard's no-rotation trick, made a gable.
     GABLE FACE  the street gable is the billboard: fish-scale shingling, a
                 carved sunburst fan in the apex, an attic sash, stickwork, a
                 pendant, a finial. A plain gable is a barn.
     WRAPAROUND  turned posts on a raised deck, spindlework hung between them,
     PORCH       sawn brackets at every post head, a turned balustrade and a low
                 shingled shed roof, wrapping the door face AND the turret flank
                 so the tower is gathered into the house instead of applied.
     ENTRY       the porch frieze BREAKS over the doorway and a small gabled
     GABLE       canopy takes over there — the only honest way to give the door
                 a taller opening than a domestic porch beam allows.
     BAY WINDOW  a canted three-facet bay, ground to eave, on the cross-gable
                 flank: the second plane-breaking move.
     SHINGLES    the upper storey is FISH-SCALE and the lower storeys are
                 CLAPBOARD, split by a bracketed belt. Two textures on one wall
                 is the period signature and it costs only dbox.
     BRACKETS    under every eave, gable return, post head, bay cap and the
                 turret cornice. This carpentry never lets a soffit meet a wall
                 without a bracket in the corner.
     CRESTING    iron spikes along the ridge; finials on every apex.
     CHIMNEY     a corbelled brick stack breaking the slope on the opposite
                 quarter from the turret. Asymmetry again.

   COLOUR — THE THREE-COLOUR SCHEME. A painted lady is a BODY, a much LIGHTER
   TRIM for every piece of millwork, and a DARK SASH ACCENT for frames and
   reveals, plus a shingle tone between body and roof so the shingled storey
   separates from the clapboard one. The sets are authored outright and only
   lightly mixed with ctx.color, for the reason stone.js's header gives: the
   host colour arrives near-white in a pale district, and a facade whose whole
   subject is millwork shadow cannot afford to be one cream blur.

   THE HOST'S OWN WINDOWS STAY VISIBLE. The shell glazes a continuous band per
   storey (k*FH+0.55 … (k+1)*FH-0.45). Every horizontal run here — water table,
   belts, clapboard laps, shingle aprons, eave frieze, porch beam — is solved to
   land inside a SILL or HEADER zone, or is held clear of the wall as an
   overhang. What crosses the glass is VERTICAL: corner boards, window casings,
   sash stiles, shingled stiles, porch posts, bracket drops. That is how the
   ribbon becomes a row of punched sash, and it is why this house has casings.

   OPTIONAL SPEC FIELDS (complete with {style:"queenanne"} and nothing else):
     spec.turret  "left" | "right" — force the turret corner instead of hashing.
     spec.scheme  integer — force one paint scheme.

   MESH BUDGET. All dbox except the turret (2 drums, 3 rings, 1 cone, 1 orb),
   up to 6 real turned porch posts and 2 lamps: 15 real meshes worst case.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // THE PAINT SCHEMES: [body, trim (LIGHTER), sash accent (DARKER), roof]. Four
  // real colours, not four shades of one — that separation is what makes the
  // millwork read at gameplay distance.
  const SETS = [
    [0x6f7a56, 0xe9e2c6, 0x6d2a24, 0x2f3630],   // sage / cream / oxblood / slate-green
    [0xa8746a, 0xf2e8dc, 0x4a2a3c, 0x322c30],   // dusty rose / ivory / plum / charcoal
    [0xb4913f, 0xf6efdc, 0x1f4a44, 0x362d24],   // ochre / ivory / teal / brown-black
    [0x6d8494, 0xeceee2, 0x5d2130, 0x2a303a],   // powder blue / cream / burgundy / blue-black
    [0x8a7f95, 0xefe9ee, 0x27402c, 0x2d2a33],   // lavender grey / ivory / forest / graphite
    [0xa9613c, 0xefdfc2, 0x2f3a2a, 0x352b25],   // terracotta / buff / bronze green / umber
  ];

  CBZ.registerFacade("queenanne", {
    label: "Queen Anne Painted Lady",
    // WHAT IT IS MADE OF (city/collapse.js MATERIALS) — a painted lady is balloon-framed softwood.
    structure: "timber",
    crownsRoof: true,
    maxStoreys: 4,
    build: function (ctx, F, spec) {
      const W = ctx.w, D = ctx.d, FH = ctx.FH, ST = Math.max(1, ctx.storeys | 0);
      const H = ctx.rTop;                          // top of the walls
      const unit = Math.min(W, D);                 // the house's own ruler
      const e = F.entrance(ctx);
      const faces = F.faces(ctx);

      // ============================================================
      //  1. PALETTE + THE ASYMMETRY DECISIONS
      // ============================================================
      let si = (ctx.hash(0x9a11) * SETS.length) | 0;
      if (spec && spec.scheme != null) si = spec.scheme | 0;
      const set = SETS[Math.abs(si) % SETS.length];
      const body = F.shade(F.mix(set[0], ctx.color, 0.16), 0.95);
      const trim = F.mix(set[1], ctx.color, 0.08);      // ALL millwork
      const trimD = F.shade(trim, 0.87);
      const sash = F.shade(F.mix(set[2], ctx.color, 0.06), 0.94);
      const shin = F.mix(body, set[3], 0.34);           // the shingled storey
      const shinL = F.shade(shin, 1.13);
      // The city renders under a very bright ambient which lifts darks hard, so
      // the roof value is driven well past where it "should" sit on a swatch.
      const roofC = F.shade(set[3], 0.62);
      const roofL = F.mix(roofC, 0xffffff, 0.07);
      const iron = F.mix(roofC, trim, 0.16);
      const glass = F.mix(F.shade(ctx.color, 0.26), 0x1a2029, 0.66);
      const brick = F.shade(F.mix(0x8a4433, ctx.color, 0.14), 0.88);

      // THE RIDGE runs at right angles to the street so the door face is a full
      // gable end — the narrow-lot habit that makes these houses a row of
      // triangles. u = along the ridge, v = across it (the gable span).
      const ridgeAlongZ = (ctx.doorSide === 0 || ctx.doorSide === 1);
      const spanU = ridgeAlongZ ? D : W, spanV = ridgeAlongZ ? W : D;
      const halfU = spanU / 2, halfV = spanV / 2;
      const uSign = e.f.out;                            // outward, toward the street
      let vSign = ctx.hash(0x9a27) < 0.5 ? -1 : 1;      // WHICH CORNER TAKES THE TURRET
      if (spec && spec.turret === "left") vSign = -1;
      if (spec && spec.turret === "right") vSign = 1;

      function faceU(sg) { return F.face(ctx, ridgeAlongZ ? (sg < 0 ? 0 : 1) : (sg < 0 ? 2 : 3)); }
      function faceV(sg) { return F.face(ctx, ridgeAlongZ ? (sg < 0 ? 2 : 3) : (sg < 0 ? 0 : 1)); }
      function wx(u, v) { return ridgeAlongZ ? v : u; }
      function wz(u, v) { return ridgeAlongZ ? u : v; }
      // one dbox in (u, v) terms, so no roof code has to know which way round
      // the house sits on its lot
      function UV(u, y, v, lu, h, lv, col) {
        if (ridgeAlongZ) ctx.dbox(v, y, u, lv, h, lu, col);
        else ctx.dbox(u, y, v, lu, h, lv, col);
      }
      function rectUV(ua, ub, va, vb) {
        const uL = Math.min(ua, ub), uH = Math.max(ua, ub);
        const vL = Math.min(va, vb), vH = Math.max(va, vb);
        return ridgeAlongZ ? [vL, vH, uL, uH] : [uL, uH, vL, vH];
      }
      function slabUV(ua, ub, va, vb, cy, h, col) {
        const r = rectUV(ua, ub, va, vb);
        ctx.dbox((r[0] + r[1]) / 2, cy, (r[2] + r[3]) / 2, r[1] - r[0], h, r[3] - r[2], col);
      }

      // ---- the roof envelope, solved BEFORE the walls, because the eave
      // frieze, the belt courses and the turret all measure from it. Steep is
      // the style, but three caps keep it sane: half the span it covers (that
      // IS a 45-degree gable), the building's own ruler, and the wall height —
      // a cottage may not wear a mansion's roof.
      const ov = clamp(unit * 0.075, 0.38, 0.95);       // eave overhang
      const roofH = Math.min(spanV * 0.50, clamp(unit * 0.62, 2.6, 7.5), Math.max(2.6, H * 1.15));
      const ridgeT = clamp(unit * 0.05, 0.28, 0.62);
      const nC = clamp(Math.round(roofH / clamp(unit * 0.055, 0.30, 0.62)), 8, 18);
      const ridgeY = H + roofH;
      const PJ = clamp(unit * 0.028, 0.16, 0.50);       // standard trim relief
      function lvAt(u) { return lerp(spanV + ov * 2, ridgeT, u); }          // roof width
      function wallHalfAt(u) { return Math.max(0.20, (lvAt(u) - 2 * ov * (1 - u)) / 2); }

      // ---- FISH-SCALE SHINGLES. Rows of half-round butts, every other row
      // offset half a scale and every other scale a shade lighter. The scale
      // SIZE is held near-constant and the COUNT capped, so a 22 m gable gets
      // bigger shingles rather than three hundred of them.
      function fish(f, t0, t1, y0, y1, proj, inset, nMax) {
        const len = t1 - t0, hgt = y1 - y0;
        if (len < 0.16 || hgt < 0.14) return;
        const n = Math.min(nMax || 18, Math.max(1, Math.ceil(len / clamp(unit * 0.062, 0.30, 0.54))));
        const sw = len / n, rows = Math.max(1, Math.min(8, Math.round(hgt / (sw * 0.80))));
        const rh = hgt / rows;
        for (let r = 0; r < rows; r++) {
          // the course line under each row: what makes a row read as a row
          F.box(ctx, f, (t0 + t1) / 2, y0 + r * rh + rh * 0.16, len, rh * 0.34,
            proj * 0.70, F.shade(shin, 0.70), inset);
          const off = (r % 2) ? sw * 0.5 : 0;
          for (let i = 0; i <= n; i++) {
            const t = t0 + off + i * sw;
            if (t - sw * 0.44 < t0 - 0.03 || t + sw * 0.44 > t1 + 0.03) continue;
            F.box(ctx, f, t, y0 + (r + 0.5) * rh, sw * 0.86, rh * 0.80, proj,
              ((i + r) % 2) ? shin : shinL, inset);
          }
        }
      }
      // A SAWN BRACKET: three blocks growing as they rise, which is the shadow
      // profile of a jigsawn scroll. Used everywhere on this house.
      function bracket(f, t, yTop, h, wid, proj, inset) {
        for (let k = 0; k < 3; k++) {
          const u = (k + 1) / 3;
          F.box(ctx, f, t, yTop - h + h * (k + 0.5) / 3, wid, h / 3 + 0.02,
            Math.max(0.05, proj * (0.28 + u * 0.66)), k === 1 ? trimD : trim, inset);
        }
      }

      // ============================================================
      //  2. THE WALL — water table, clapboard, fish-scale, belts, corners
      // ============================================================
      const shinFrom = ST >= 3 ? ST - 2 : 1;            // first shingled storey
      F.ring(ctx, 0.24, 0.42, PJ * 1.35, trimD, 0.34);            // water table
      F.ring(ctx, 0.48, 0.13, PJ * 1.60, trim, 0.40);             // its drip cap
      for (const f of faces) {
        for (let k = 0; k < ST; k++) {
          const shingled = (k >= shinFrom), y0 = k * FH, y1 = (k + 1) * FH;
          // SILL ZONE: the apron under the windows.
          if (shingled) fish(f, -f.span / 2 - 0.08, f.span / 2 + 0.08, y0 + 0.06, y0 + 0.53, PJ * 0.62, 0, 20);
          else {
            F.band(ctx, f, y0 + 0.30, 0.46, PJ * 0.22, body, 0.18);
            for (let i = 0; i < 3; i++)
              F.band(ctx, f, y0 + 0.13 + i * 0.155, 0.06, PJ * 0.40, F.shade(body, 0.84), 0.20);
          }
          // HEADER ZONE frieze. The topmost one is the eave and is dressed in §6.
          if (k === ST - 1) continue;
          F.band(ctx, f, y1 - 0.24, 0.38, PJ * 0.24, shingled ? shin : body, 0.18);
          for (let i = 0; i < 2; i++)
            F.band(ctx, f, y1 - 0.38 + i * 0.155, 0.06, PJ * 0.42, F.shade(body, 0.84), 0.20);
        }
      }
      // BELT COURSES on the floor lines. A belt centred on k*FH lies inside the
      // header zone below plus the sill zone above, so up to a metre of
      // moulding is safe there — which is exactly where a Victorian puts its
      // heaviest line. The belt at the clapboard/shingle change gets brackets.
      for (let k = 1; k < ST; k++) {
        const y = k * FH, heavy = (k === shinFrom);
        F.ring(ctx, y - 0.16, 0.16, PJ * 0.95, trimD, 0.26);
        F.ring(ctx, y + 0.02, 0.20, PJ * (heavy ? 1.45 : 1.15), trim, 0.34);
        F.ring(ctx, y + 0.19, 0.11, PJ * 0.80, trimD, 0.24);
        if (!heavy) continue;
        for (const f of faces) {
          const nb = Math.max(4, Math.min(22, Math.round(f.span / clamp(unit * 0.11, 0.7, 1.5))));
          for (let i = 0; i <= nb; i++)
            bracket(f, -f.span / 2 + (f.span / nb) * i, y - 0.16, 0.28,
              clamp((f.span / nb) * 0.22, 0.11, 0.30), PJ * 1.5, 0);
        }
      }
      // CORNER BOARDS: the vertical that ties the four faces together, and the
      // cheapest thing on the house that crosses the glass legitimately.
      {
        const cbW = clamp(unit * 0.048, 0.32, 0.85);
        F.corners(ctx, H / 2, H, cbW, PJ * 0.95, trim);
        F.corners(ctx, H / 2, H, cbW * 0.42, PJ * 1.25, trimD);
      }

      // ============================================================
      //  3. WINDOW CASINGS — the verticals that punch the host's ribbon
      // ============================================================
      // A cased opening per bay per storey: two jamb casings crossing the glass,
      // a dark sash stile inside each, a meeting rail across the sash ONLY, a
      // bracketed sill in the sill zone and a moulded head in the header zone.
      // On the shingled storeys the bay LINES become wide shingled stiles, which
      // separates the upper wall without one horizontal run over the glass.
      for (const f of faces) {
        const nb = F.bayCount(f, clamp(unit * 0.24, 2.6, 4.2), 2, 6);
        const marg = clamp(f.span * 0.09, 0.5, 1.5);
        const bays = F.bays(f, nb, marg), lines = F.bayLines(f, nb, marg);
        const step = bays.length ? bays[0].w : f.span;
        const cw = clamp(step * 0.15, 0.16, 0.42);
        for (let k = 0; k < ST; k++) {
          const shingled = (k >= shinFrom);
          const gy0 = k * FH + 0.50, gy1 = (k + 1) * FH - 0.42;
          if (gy1 - gy0 < 0.5) continue;
          for (const t of lines) {
            if (k === 0 && !F.clearsDoor(ctx, f, t, cw * 2.4)) continue;
            if (shingled) {
              const sw2 = clamp(step * 0.21, 0.34, 0.86);
              fish(f, t - sw2 / 2, t + sw2 / 2, gy0, gy1, PJ * 0.70, 0, 3);
              F.rib(ctx, f, t, gy0, gy1, sw2 * 0.30, PJ * 0.92, trim);
            } else F.rib(ctx, f, t, gy0, gy1, cw * 1.25, PJ * 0.85, trim);
          }
          for (const b of bays) {
            const wid = Math.min(step * 0.60, clamp(unit * 0.22, 1.0, 2.2));
            if (k === 0 && !F.clearsDoor(ctx, f, b.t, wid + 0.9)) continue;
            for (const sg of [-1, 1]) {   // jamb casing + the dark sash stile in it
              F.rib(ctx, f, b.t + sg * (wid / 2 + cw / 2), gy0, gy1, cw, PJ * 0.80, trim);
              F.rib(ctx, f, b.t + sg * (wid / 2 - cw * 0.30), gy0 + 0.04, gy1 - 0.04, cw * 0.55, PJ * 0.44, sash);
            }
            // the meeting rail of a two-over-two sash: the WINDOW's width, never
            // the face's — a rail that runs corner to corner is a band.
            F.box(ctx, f, b.t, (gy0 + gy1) / 2, wid - cw * 0.4, 0.11, PJ * 0.40, sash);
            F.box(ctx, f, b.t, (gy0 + gy1) / 2, cw * 0.4, gy1 - gy0 - 0.1, PJ * 0.36, sash);
            F.box(ctx, f, b.t, k * FH + 0.50, wid + cw * 3.2, 0.15, PJ * 1.55, trim);      // sill
            F.box(ctx, f, b.t, k * FH + 0.38, wid + cw * 2.0, 0.11, PJ * 1.10, trimD);
            for (const sg of [-1, 1])                                                     // its consoles
              F.box(ctx, f, b.t + sg * (wid / 2 - cw * 0.2), k * FH + 0.24, cw * 0.8, 0.26, PJ * 1.15, trim);
            const hy = (k + 1) * FH - 0.40;                                               // moulded head
            F.box(ctx, f, b.t, hy, wid + cw * 2.6, 0.16, PJ * 1.25, trim);
            F.box(ctx, f, b.t, hy + 0.15, wid + cw * 3.6, 0.13, PJ * 1.70, trim);
            F.box(ctx, f, b.t, hy + 0.27, wid + cw * 2.4, 0.10, PJ * 1.30, trimD);
          }
        }
      }

      // ============================================================
      //  4. THE PROJECTING BAY WINDOW (cross-gable flank, ground to eave)
      // ============================================================
      // A canted bay faked honestly: a wide centre facet at full projection and
      // stepped-back returns, which from any street angle reads as a splayed bay
      // and merges for free. It carries its own sash, so it replaces the host's
      // glass across its width rather than blanking it.
      const cgU = -uSign * spanU * 0.13;                // the cross gable's centre
      const bayF = faceV(-vSign);
      {
        const BW = clamp(bayF.span * 0.32, 2.0, bayF.span * 0.44);
        const BP = clamp(unit * 0.115, 0.75, 1.85);
        const y1 = H - 0.62, cwid = BW * 0.52, rwid = BW * 0.24;
        const facets = [
          { t: 0, w: cwid, p: BP },
          { t: -(cwid + rwid) / 2, w: rwid, p: BP * 0.60 },
          { t: (cwid + rwid) / 2, w: rwid, p: BP * 0.60 },
          { t: -(cwid / 2 + rwid * 0.95), w: rwid * 0.5, p: BP * 0.26 },
          { t: (cwid / 2 + rwid * 0.95), w: rwid * 0.5, p: BP * 0.26 },
        ];
        if (y1 > FH * 0.8) for (const fc of facets) {
          const t = cgU + fc.t;
          F.rib(ctx, bayF, t, 0.10, y1, fc.w, fc.p, fc.p > BP * 0.8 ? body : F.shade(body, 0.93));
          F.box(ctx, bayF, t, 0.30, fc.w + 0.16, 0.46, fc.p * 1.06, trimD);       // its own plinth
          for (let k = 0; k < ST; k++) {
            const gy = k * FH + 0.55, gh = Math.min(FH * 0.52, y1 - 0.42 - gy);
            if (gh < 0.5) break;
            fish(bayF, t - fc.w * 0.44, t + fc.w * 0.44, k * FH + 0.08, gy - 0.06, fc.p * 1.04, 0, 4);
            F.box(ctx, bayF, t, gy + gh / 2, fc.w * 0.74, gh, fc.p * 1.06, glass);
            for (const sg of [-1, 1])
              F.rib(ctx, bayF, t + sg * fc.w * 0.40, gy, gy + gh, fc.w * 0.12, fc.p * 1.12, trim);
            F.box(ctx, bayF, t, gy - 0.10, fc.w * 1.04, 0.15, fc.p * 1.16, trim);
            F.box(ctx, bayF, t, gy + gh + 0.12, fc.w * 1.04, 0.16, fc.p * 1.18, trim);
          }
          F.box(ctx, bayF, t, y1 + 0.12, fc.w + 0.26, 0.20, fc.p * 1.20, trim);   // its hipped cap
          F.box(ctx, bayF, t, y1 + 0.30, fc.w + 0.06, 0.18, fc.p * 1.02, roofC);
          F.box(ctx, bayF, t, y1 + 0.46, fc.w * 0.82, 0.18, fc.p * 0.72, roofL);
          bracket(bayF, t, y1 + 0.02, 0.42, fc.w * 0.16, fc.p * 1.25, 0);
        }
      }

      // ============================================================
      //  5. THE WRAPAROUND PORCH
      // ============================================================
      const pD = clamp(unit * 0.165, 1.3, 2.7);
      const DECK = 0.34;                                // one rise, under STEP_UP
      const postR = clamp(pD * 0.115, 0.10, 0.22);
      const beamBot = FH - 0.42, beamTop = FH - 0.02;   // the ground HEADER zone
      const pEave = FH - 0.06, pWall = FH + 0.40;       // shed roof, eave → wall
      const ebW = clamp(e.gap + pD * 0.9, 3.2, 5.4);    // the entry bay
      const uIn = uSign * halfU, uOut = uSign * (halfU + pD);
      const vIn = vSign * halfV, vOut = vSign * (halfV + pD);
      const vA0 = -vSign * (halfV * 0.86), uB0 = -uSign * (halfU * 0.32);
      const rT = clamp(unit * 0.175, 0.95, 2.4);        // turret radius
      const turX = wx(uIn, vIn), turZ = wz(uIn, vIn);   // turret centre: THE corner

      // THE DECK, as an L, registered with ctx.plat so it is genuinely walkable
      // and can never seal the door. One 0.34 rise, so the treads outside are
      // cosmetic and the platform under them is a single continuous ramp.
      const legs = [[uIn, uOut, vA0, vOut], [uB0, uIn, vIn, vOut]];
      for (const g of legs) {
        slabUV(g[0], g[1], g[2], g[3], DECK - 0.08, 0.30, F.shade(trim, 0.94));
        slabUV(g[0], g[1], g[2], g[3], DECK - 0.24, 0.14, trimD);
        const r = rectUV(g[0], g[1], g[2], g[3]);
        ctx.plat(r[0], r[1], r[2], r[3], DECK, null);
        // the skirt: a crosshatch lattice closing the crawl space, drawn only
        // where there is actually deck above it
        const alongV = (g === legs[0]);
        const a = alongV ? g[2] : g[0], b = alongV ? g[3] : g[1];
        const nl = Math.min(30, Math.max(3, Math.round(Math.abs(b - a) / clamp(unit * 0.055, 0.26, 0.45))));
        for (let i = 0; i <= nl; i++) {
          const t = a + (b - a) * (i / nl);
          if (alongV) UV(uOut - uSign * 0.06, DECK * 0.5, t, 0.14, DECK - 0.06, 0.07, trimD);
          else UV(t, DECK * 0.5, vOut - vSign * 0.06, 0.07, DECK - 0.06, 0.14, trimD);
        }
        if (alongV) UV(uOut - uSign * 0.05, DECK * 0.5, (a + b) / 2, 0.16, 0.06, Math.abs(b - a), trimD);
        else UV((a + b) / 2, DECK * 0.5, vOut - vSign * 0.05, Math.abs(b - a), 0.06, 0.16, trimD);
      }
      // THE STEPS at the door: two cosmetic treads over one ramped platform.
      if (!e.driveIn) {
        const sw2 = e.gap + clamp(unit * 0.07, 0.55, 1.3), sD = clamp(pD * 0.62, 0.6, 1.4);
        for (let i = 0; i < 2; i++)
          slabUV(uSign * (halfU + pD + sD * i / 2), uSign * (halfU + pD + sD * (i + 1) / 2),
            -sw2 / 2, sw2 / 2, DECK * (2 - i) / 4, DECK * (2 - i) / 2, F.shade(trim, 0.90 + i * 0.04));
        const oA = halfU + pD, oB = halfU + pD + sD;
        const r = rectUV(uSign * oA, uSign * oB, -sw2 / 2, sw2 / 2);
        ctx.plat(r[0], r[1], r[2], r[3], DECK, ridgeAlongZ
          ? { z0: ctx.oz + uSign * oB, z1: ctx.oz + uSign * oA, y0: 0, y1: DECK }
          : { axis: "x", x0: ctx.ox + uSign * oB, x1: ctx.ox + uSign * oA, y0: 0, y1: DECK });
        for (const sg of [-1, 1]) {   // cheek walls with a newel block
          slabUV(uSign * oA, uSign * oB, sg * (sw2 / 2 + 0.20), sg * (sw2 / 2 + 0.46), DECK * 0.9, DECK * 1.8, trim);
          slabUV(uSign * (oA - 0.10), uSign * (oA + 0.34), sg * (sw2 / 2 + 0.14), sg * (sw2 / 2 + 0.52),
            DECK + 0.42, 1.0, trim);
        }
      }

      // ---- TURNED POSTS. Positions land ON the entry bay's edges and never
      // inside it, and any post the turret stands in is dropped rather than
      // nudged — a shifted post reads as a mistake, a missing one as a bay.
      const spots = [];
      function postRun(a, b, mk) {
        const n = Math.max(1, Math.round(Math.abs(b - a) / clamp(unit * 0.19, 1.7, 2.9)));
        for (let i = 0; i <= n; i++) mk(a + (b - a) * (i / n));
      }
      {
        const uE = uOut - uSign * postR * 1.5, vE = vOut - vSign * postR * 1.5;
        const vLo = Math.min(vA0, vOut), vHi = Math.max(vA0, vOut);
        postRun(vLo, -ebW / 2, function (v) { spots.push({ u: uE, v: v, a: 0 }); });
        postRun(ebW / 2, vHi, function (v) { spots.push({ u: uE, v: v, a: 0 }); });
        postRun(uB0, uIn, function (u) { spots.push({ u: u, v: vE, a: 1 }); });
      }
      let realPosts = 6;
      const shY = DECK + 0.30, shH = beamBot - shY;
      for (const p of spots) {
        const px = wx(p.u, p.v), pz = wz(p.u, p.v);
        const dx = px - turX, dz = pz - turZ;
        if (shH < 0.6) break;
        if (Math.sqrt(dx * dx + dz * dz) < rT + postR * 1.3) continue;   // the tower is here
        ctx.dbox(px, DECK + 0.15, pz, postR * 3.1, 0.30, postR * 3.1, trim);          // plinth
        if (realPosts > 0) { realPosts--; ctx.column(px, shY, pz, postR, shH, trim, 9); }
        else ctx.dbox(px, shY + shH / 2, pz, postR * 1.7, shH, postR * 1.7, trim);
        for (const u2 of [0.22, 0.60])                                               // lathe rings
          ctx.dbox(px, shY + shH * u2, pz, postR * 2.5, postR * 0.65, postR * 2.5, trimD);
        ctx.dbox(px, beamBot - 0.13, pz, postR * 3.0, 0.26, postR * 3.0, trim);      // cap
        for (const sg of [-1, 1]) for (let k = 0; k < 3; k++) {   // sawn head brackets
          const gu = postR * (1.2 + k * 0.55), h2 = 0.40 - k * 0.11;
          UV(p.a ? p.u + sg * gu : p.u, beamBot - 0.26 - h2 / 2, p.a ? p.v : p.v + sg * gu,
            p.a ? postR : postR * 1.5, h2, p.a ? postR * 1.5 : postR, k === 1 ? trimD : trim);
        }
      }

      // ---- BEAM, SPINDLEWORK, BALUSTRADE, SHED ROOF, run by run.
      // legA true → the run goes along v at fixed u; false → along u at fixed v.
      function porchRun(legA, r0, r1) {
        const cr = (r0 + r1) / 2, lr = Math.abs(r1 - r0);
        if (lr < 0.5) return;
        const fu = legA ? uOut - uSign * postR * 1.5 : cr;
        const fv = legA ? cr : vOut - vSign * postR * 1.5;
        const th = postR * 2.3;
        function run(y, h, t, col) {
          if (legA) UV(fu, y, cr, t, h, lr, col); else UV(cr, y, fv, lr, h, t, col);
        }
        run(beamTop - 0.20, 0.40, th, trim);                        // the beam
        run(beamTop + 0.04, 0.13, th * 1.30, trimD);                // its crown
        run(beamBot - 0.07, 0.14, th * 0.85, trim);                 // spindle rail
        const ns = Math.min(48, Math.max(2, Math.round(lr / clamp(unit * 0.028, 0.15, 0.26))));
        const nb2 = Math.min(44, Math.max(2, Math.round(lr / clamp(unit * 0.030, 0.17, 0.28))));
        const bl = DECK + 0.16, bh = DECK + 0.92;
        for (let i = 0; i <= ns; i++) {   // SPINDLEWORK hung under the beam
          const t = r0 + (r1 - r0) * (i / ns), su = legA ? fu : t, sv = legA ? t : fv;
          UV(su, beamBot - 0.30, sv, postR * 0.55, 0.30, postR * 0.55, trim);
          if (i % 3 === 0) UV(su, beamBot - 0.50, sv, postR * 0.75, 0.16, postR * 0.75, trimD);
        }
        run(bl, 0.13, th * 0.80, trim);                             // TURNED BALUSTRADE
        run(bh, 0.15, th * 1.05, trim);
        for (let i = 0; i <= nb2; i++) {
          const t = r0 + (r1 - r0) * (i / nb2), su = legA ? fu : t, sv = legA ? t : fv;
          UV(su, (bl + bh) / 2, sv, postR * 0.52, bh - bl, postR * 0.52, trim);
          UV(su, bl + (bh - bl) * 0.34, sv, postR * 0.80, (bh - bl) * 0.22, postR * 0.80, trimD);
        }
        // THE SHED ROOF: four courses stepping up from the eave to the wall.
        // Both ends sit inside a solid zone, so it never crosses host glass.
        const nR = 4, ch2 = (pWall - pEave) / nR + 0.10;
        for (let i = 0; i < nR; i++) {
          const y = pEave + (pWall - pEave) * (i + 0.5) / nR;
          const oB2 = pD * (1 - i / nR) + (i === 0 ? 0.30 : 0.04), oA2 = pD * (1 - (i + 1) / nR);
          const mid = (oA2 + oB2) / 2, dep = oB2 - oA2, col = i % 2 ? roofL : roofC;
          if (legA) UV(uSign * (halfU + mid), y, cr, dep, ch2, lr, col);
          else UV(cr, y, vSign * (halfV + mid), lr, ch2, dep, col);
        }
        // fascia + gutter at the eave, held clear of the wall by construction
        if (legA) {
          UV(uSign * (halfU + pD + 0.18), pEave + 0.10, cr, 0.22, 0.34, lr + 0.08, trim);
          UV(uSign * (halfU + pD + 0.20), pEave - 0.16, cr, 0.28, 0.12, lr + 0.08, trimD);
        } else {
          UV(cr, pEave + 0.10, vSign * (halfV + pD + 0.18), lr + 0.08, 0.34, 0.22, trim);
          UV(cr, pEave - 0.16, vSign * (halfV + pD + 0.20), lr + 0.08, 0.12, 0.28, trimD);
        }
      }
      porchRun(true, Math.min(vA0, vOut), -ebW / 2);
      porchRun(true, ebW / 2, Math.max(vA0, vOut));
      porchRun(false, uB0, uIn);

      // ---- THE ENTRY GABLE. The porch beam lives in the ground header zone at
      // FH-0.42, which no domestic porch can lift to F.entrance's monumental
      // 3.6 m head. So over the doorway the frieze BREAKS: a gabled canopy takes
      // over with its soffit AT e.head, and its mass is carried out at the porch
      // edge where there is no wall to brick up. Wall contact is capped at
      // FH+0.55 — the exact top of the sill zone — so nothing hangs below
      // e.head across the doorway and nothing crosses the glass above it. A
      // drive-in host (e.head = FH+0.9) fails that test and simply gets an open
      // carriage break in the porch instead, which is also period-correct.
      const sofTop = FH + 0.55, sofBot = e.head + 0.02;
      if (sofTop - sofBot >= 0.10) {
        const egH = clamp(ebW * 0.30, 0.60, 1.60);
        const u0 = halfU + pD * 0.30, u1 = halfU + pD + 0.30, nE = 5;
        slabUV(uIn, uSign * u1, -ebW / 2 - 0.18, ebW / 2 + 0.18, (sofBot + sofTop) / 2, sofTop - sofBot, roofC);
        slabUV(uIn, uSign * u1, -ebW / 2 - 0.24, ebW / 2 + 0.24, sofBot + 0.05, 0.12, trim);
        for (let i = 0; i < nE; i++) {
          const lv = lerp(ebW + 0.42, 0.30, (i + 1) / nE);
          slabUV(uSign * u0, uSign * u1, -lv / 2, lv / 2, sofTop + egH * (i + 0.5) / nE,
            egH / nE + 0.03, i % 2 ? roofL : roofC);
        }
        // the pediment face at the porch edge: raking trim, shingles, a finial
        const pf = faceU(uSign), ins = pD + 0.30;
        for (let i = 0; i < nE; i++)
          F.box(ctx, pf, 0, sofTop + egH * (i + 0.5) / nE, lerp(ebW + 0.42, 0.30, (i + 1) / nE) + 0.26,
            egH / nE + 0.03, 0.16, trim, ins);
        fish(pf, -ebW * 0.32, ebW * 0.32, sofTop + 0.10, sofTop + egH * 0.60, 0.13, ins - 0.02, 8);
        UV(uSign * (u1 + 0.16), sofTop + egH + 0.24, 0, 0.20, 0.48, 0.20, trim);
        UV(uSign * (u1 + 0.16), sofTop + egH + 0.50, 0, 0.32, 0.14, 0.32, trimD);
      }
      // two gas lamps flanking the door — the only lit thing on the house
      if (!e.driveIn) for (const sg of [-1, 1]) {
        const lt = sg * (e.gap / 2 + clamp(unit * 0.035, 0.30, 0.7)), nrm = uSign * (halfU + PJ * 2.4);
        F.box(ctx, faceU(uSign), lt, 2.30, 0.14, 0.44, PJ * 1.6, iron);
        ctx.lamp(wx(nrm, lt), 2.02, wz(nrm, lt), clamp(unit * 0.017, 0.12, 0.22), 0xffd7a2);
      }

      // ============================================================
      //  6. THE EAVE — brackets, frieze, fascia, gable returns
      // ============================================================
      // On the two V faces this is a real overhanging eave: a frieze in the
      // header zone, deep brackets rising to the soffit, a fascia and gutter
      // held out at the overhang line. The two U faces have no eave — they are
      // the gable ends — so they get the frieze plus a GABLE RETURN, the little
      // stub of eave that turns the corner and stops.
      {
        const braH = clamp(FH * 0.19, 0.42, 0.68);
        for (const f of faces) {
          const gableEnd = (f.horiz === faceU(1).horiz);
          F.band(ctx, f, H - 0.24, 0.40, PJ * 0.90, trim, 0.24);
          F.band(ctx, f, H - 0.06, 0.12, PJ * 1.25, trimD, 0.30);
          const nb = Math.max(3, Math.min(24, Math.round(f.span / clamp(unit * 0.105, 0.62, 1.45))));
          for (let i = 0; i <= nb; i++) {
            if (gableEnd && i > 1 && i < nb - 1) continue;   // a gable end brackets only its returns
            bracket(f, -f.span / 2 + (f.span / nb) * i, H - 0.02, braH,
              clamp((f.span / nb) * 0.20, 0.12, 0.32), ov * 0.80, 0);
          }
          if (gableEnd) {
            for (const sg of [-1, 1]) {
              F.box(ctx, f, sg * (f.span / 2 - ov * 0.5), H + 0.14, ov * 1.5, 0.28, ov * 0.95, trim);
              F.box(ctx, f, sg * (f.span / 2 - ov * 0.5), H - 0.06, ov * 1.7, 0.16, ov * 1.05, trimD);
            }
            continue;
          }
          F.band(ctx, f, H + 0.16, 0.32, ov * 1.02, trim, 0.34, ov * 0.02);      // fascia
          F.band(ctx, f, H - 0.02, 0.14, ov * 1.10, trimD, 0.38, ov * 0.02);     // gutter
        }
      }

      // ============================================================
      //  7. THE ROOF — steep cross gables, verge, ridge, cresting
      // ============================================================
      // Stepped axis-aligned courses narrowing on ONE axis. From the gable end
      // the stack IS the filled triangle; from the flank the stagger IS the
      // slope. Nothing is rotated and the whole roof merges for free. The
      // courses are held flush at the gable ends (lu = spanU + 0.10) and the
      // rake overhang is a separate VERGE board, so the gable wall stays in the
      // plane of the wall below it instead of being pushed out by the eaves.
      for (let i = 0; i < nC; i++) {
        const t0 = i / nC, t1 = (i + 1) / nC;
        const lv = lvAt(t1), cy = H + roofH * (t0 + t1) / 2;
        const col = (i % 3 === 1) ? roofL : (i % 3 === 2 ? F.shade(roofC, 0.88) : roofC);
        UV(0, cy, 0, spanU + 0.10, roofH / nC + 0.02, lv, col);
        if (i % 3 === 0)                                        // the shingle lap line
          UV(0, H + roofH * t0 + 0.03, 0, spanU + 0.18, 0.07, lv + 0.10, F.shade(roofC, 0.70));
        for (const sg of [-1, 1]) {                             // the raking VERGE
          UV(sg * (halfU + ov * 0.42), cy, 0, ov * 0.32, roofH / nC + 0.02, lv + 0.36, trim);
          UV(sg * (halfU + ov * 0.42), cy - (roofH / nC) * 0.34, 0, ov * 0.44, 0.10, lv + 0.24, trimD);
        }
      }
      UV(0, ridgeY + 0.11, 0, spanU + 0.26, 0.22, ridgeT + 0.24, trimD);
      UV(0, ridgeY + 0.27, 0, spanU + 0.12, 0.10, ridgeT + 0.10, trim);
      {   // IRON CRESTING: a dotted line against the sky, which nothing else has
        const nn = Math.min(26, Math.max(3, Math.round(spanU / clamp(unit * 0.085, 0.48, 1.15))));
        const ch2 = clamp(roofH * 0.085, 0.26, 0.62);
        for (let i = 0; i <= nn; i++) {
          const u = -spanU / 2 + (spanU / nn) * i;
          UV(u, ridgeY + 0.32 + ch2 / 2, 0, 0.09, ch2, 0.09, iron);
          UV(u, ridgeY + 0.32 + ch2 * 0.70, 0, 0.17, 0.09, 0.17, iron);
        }
        UV(0, ridgeY + 0.32 + ch2 * 0.32, 0, spanU, 0.06, 0.06, iron);
      }

      // ---- THE GABLE FACES. The street gable gets everything; the back gable
      // gets shingles and a finial, because ornament nobody can see is just
      // triangles. No rotation is available, so the SUNBURST is nine rays of
      // three small blocks stepped along their own directions — which is exactly
      // what a carved fan reads as at street range.
      function sunburst(f, t, y, rr, ins) {
        for (let j = 0; j < 9; j++) {
          const a = Math.PI * (0.08 + 0.84 * (j / 8));
          for (let k = 1; k <= 3; k++)
            F.box(ctx, f, t + Math.cos(a) * rr * (k / 3.4), y + Math.sin(a) * rr * (k / 3.4),
              rr * 0.16, rr * 0.16, 0.13, k === 3 ? trim : trimD, ins);
        }
        F.box(ctx, f, t, y, rr * 0.36, rr * 0.36, 0.17, trim, ins);          // the hub
        F.box(ctx, f, t, y - rr * 0.12, rr * 2.1, 0.12, 0.15, trim, ins);    // the chord
      }
      for (const sg of [-1, 1]) {
        const f = faceU(sg), ins = 0.05;
        const rows = clamp(Math.round(roofH / clamp(unit * 0.058, 0.32, 0.58)), 4, 11);
        for (let r = 0; r < rows; r++) {
          const half = wallHalfAt((r + 0.5) / rows) - 0.10;
          if (half < 0.20) continue;
          fish(f, -half, half, H + roofH * (r / rows) + 0.03, H + roofH * ((r + 1) / rows) - 0.02, 0.15, ins, 16);
        }
        UV(sg * (halfU + 0.08), ridgeY - 0.10, 0, 0.22, 0.60, 0.30, trim);   // apex pendant
        UV(sg * (halfU + 0.08), ridgeY + 0.34, 0, 0.30, 0.30, 0.42, trimD);
        UV(sg * (halfU + 0.08), ridgeY + 0.74, 0, 0.16, 0.55, 0.16, iron);   // and its spike
        if (sg !== uSign) continue;
        // STICKWORK across the attic floor line, an ATTIC SASH, then the FAN.
        const sy = H + roofH * 0.10, shalf = Math.max(0.5, wallHalfAt(0.10) - 0.18);
        F.box(ctx, f, 0, sy, shalf * 2, 0.16, 0.18, trim, ins);
        F.box(ctx, f, 0, sy + 0.62, shalf * 1.5, 0.14, 0.18, trim, ins);
        const nst = Math.min(26, Math.max(3, Math.round(shalf * 2 / clamp(unit * 0.035, 0.20, 0.34))));
        for (let i = 0; i <= nst; i++)
          F.box(ctx, f, -shalf + (shalf * 2 / nst) * i, sy + 0.34, 0.09, 0.50, 0.19, trim, ins);
        const aw = Math.min(wallHalfAt(0.30) * 1.1, clamp(unit * 0.14, 0.85, 1.9));
        const ah = aw * 1.25, ay = H + roofH * 0.30;
        F.box(ctx, f, 0, ay + ah / 2, aw, ah, 0.14, glass, ins);
        F.box(ctx, f, 0, ay + ah / 2, 0.11, ah, 0.17, sash, ins);
        for (const s2 of [-1, 1]) F.rib(ctx, f, s2 * (aw / 2 + 0.11), ay, ay + ah, 0.22, 0.20, trim, ins);
        F.box(ctx, f, 0, ay - 0.11, aw + 0.62, 0.17, 0.26, trim, ins);
        F.box(ctx, f, 0, ay + ah + 0.12, aw + 0.50, 0.18, 0.26, trim, ins);
        F.box(ctx, f, 0, ay + ah + 0.28, aw + 0.72, 0.14, 0.32, trimD, ins);
        sunburst(f, 0, H + roofH * 0.68, Math.max(0.5, wallHalfAt(0.68) * 0.92), ins);
      }

      // ---- THE CROSS GABLE, on the flank opposite the turret and over the bay.
      // Same construction turned ninety degrees: it narrows on U and rides out
      // along V, so its own gable faces the flank and its ridge dies into the
      // main roof at the centre line.
      {
        const cgW = clamp(spanU * 0.42, 2.4, spanU * 0.58), cgH = roofH * 0.80;
        const cgV = -vSign * (halfV + 0.06);
        const nG = clamp(Math.round(cgH / clamp(unit * 0.055, 0.30, 0.62)), 6, 14);
        for (let i = 0; i < nG; i++) {
          const t0 = i / nG, t1 = (i + 1) / nG, ch3 = cgH / nG + 0.02;
          const lu = lerp(cgW + ov * 2, ridgeT, t1), cy = H + cgH * (t0 + t1) / 2;
          UV(cgU, cy, cgV / 2, lu, ch3, Math.abs(cgV),
            (i % 3 === 1) ? roofL : (i % 3 === 2 ? F.shade(roofC, 0.88) : roofC));
          UV(cgU, cy, -vSign * (halfV + ov * 0.45), lu + 0.36, ch3, ov * 0.32, trim);
          UV(cgU, cy - (cgH / nG) * 0.34, -vSign * (halfV + ov * 0.45), lu + 0.24, 0.10, ov * 0.44, trimD);
        }
        UV(cgU, H + cgH + 0.11, cgV / 2, ridgeT + 0.24, 0.22, Math.abs(cgV) + 0.2, trimD);
        const f = faceV(-vSign), ins = 0.06;
        const rows = clamp(Math.round(cgH / clamp(unit * 0.058, 0.32, 0.58)), 4, 10);
        for (let r = 0; r < rows; r++) {
          const half = lerp(cgW, ridgeT, (r + 0.5) / rows) / 2 - 0.10;
          if (half < 0.20) continue;
          fish(f, cgU - half, cgU + half, H + cgH * (r / rows) + 0.03,
            H + cgH * ((r + 1) / rows) - 0.02, 0.15, ins, 14);
        }
        const aw = Math.min(cgW * 0.30, clamp(unit * 0.12, 0.7, 1.6)), ah = aw * 1.2;
        const ay = H + cgH * 0.24;
        F.box(ctx, f, cgU, ay + ah / 2, aw, ah, 0.14, glass, ins);
        F.box(ctx, f, cgU, ay + ah / 2, 0.10, ah, 0.17, sash, ins);
        for (const s2 of [-1, 1]) F.rib(ctx, f, cgU + s2 * (aw / 2 + 0.10), ay, ay + ah, 0.20, 0.19, trim, ins);
        F.box(ctx, f, cgU, ay - 0.10, aw + 0.52, 0.16, 0.24, trim, ins);
        F.box(ctx, f, cgU, ay + ah + 0.13, aw + 0.62, 0.16, 0.28, trim, ins);
        for (const s2 of [-1, 1]) bracket(f, cgU + s2 * (cgW / 2 - 0.30), H + 0.02, 0.50, 0.16, ov * 0.9, ins);
        UV(cgU, H + cgH - 0.10, -vSign * (halfV + 0.14), 0.30, 0.58, 0.22, trim);
        UV(cgU, H + cgH + 0.32, -vSign * (halfV + 0.14), 0.42, 0.28, 0.30, trimD);
        UV(cgU, H + cgH + 0.70, -vSign * (halfV + 0.14), 0.16, 0.52, 0.16, iron);
      }

      // ============================================================
      //  8. THE CORNER TURRET + CANDLE-SNUFFER ROOF
      // ============================================================
      // The element that makes this house identifiable as a black shape. Its
      // cone height is the LARGER of a candle-snuffer proportion and whatever
      // it takes to clear the main ridge, so the tower can never sink into the
      // roof on a squat cottage or a tall mansion. Sash goes on the two
      // cardinal directions that actually face the street: axis-aligned boxes
      // tangent to the drum read as facets, which a polygonal turret has anyway.
      {
        const tTop = H + roofH * 0.40, bandY = ST >= 2 ? (ST - 1) * FH : H * 0.62;
        const coneH = Math.max(clamp(rT * 2.4, 1.8, 8.0),
          (ridgeY + clamp(unit * 0.06, 0.8, 1.7)) - tTop);
        ctx.column(turX, 0, turZ, rT, bandY, body, 12);                     // clapboard drum
        ctx.column(turX, bandY, turZ, rT * 1.01, tTop - bandY, shin, 12);   // shingled drum
        ctx.column(turX, 0.20, turZ, rT * 1.09, 0.34, trimD, 12);           // water table
        ctx.column(turX, bandY - 0.20, turZ, rT * 1.10, 0.44, trim, 12);    // the belt
        ctx.column(turX, tTop - 0.34, turZ, rT * 1.16, 0.40, trim, 12);     // the cornice
        for (let j = 0; j < 8; j++) {   // a bracket ring under that cornice
          const a = Math.PI * 2 * (j / 8);
          const bx = turX + Math.cos(a) * rT * 1.02, bz = turZ + Math.sin(a) * rT * 1.02;
          for (let k = 0; k < 3; k++)
            ctx.dbox(bx, tTop - 0.88 + 0.14 * (k + 0.5), bz, rT * (0.15 + k * 0.05), 0.16,
              rT * (0.15 + k * 0.05), k === 1 ? trimD : trim);
        }
        const nS = Math.min(4, Math.max(1, Math.round((tTop - 0.4) / FH)));
        for (let k = 0; k < nS; k++) {
          const gy = k * FH + 0.62, gh = Math.min(FH * 0.54, tTop - 0.7 - gy), gw = rT * 0.72;
          if (gh < 0.5) break;
          for (const ax of [0, 1]) {
            const cx2 = turX + (ax ? 0 : uSign * rT * 0.90), cz2 = turZ + (ax ? vSign * rT * 0.90 : 0);
            ctx.dbox(cx2, gy + gh / 2, cz2, ax ? gw : 0.16, gh, ax ? 0.16 : gw, glass);
            ctx.dbox(cx2, gy + gh / 2, cz2, ax ? 0.10 : 0.20, gh, ax ? 0.20 : 0.10, sash);
            for (const s2 of [-1, 1])
              ctx.dbox(cx2 + (ax ? s2 * gw * 0.56 : 0), gy + gh / 2, cz2 + (ax ? 0 : s2 * gw * 0.56),
                ax ? gw * 0.14 : 0.22, gh + 0.10, ax ? 0.22 : gw * 0.14, trim);
            ctx.dbox(cx2, gy - 0.11, cz2, ax ? gw * 1.3 : 0.30, 0.16, ax ? 0.30 : gw * 1.3, trim);
            ctx.dbox(cx2, gy + gh + 0.13, cz2, ax ? gw * 1.3 : 0.30, 0.17, ax ? 0.30 : gw * 1.3, trim);
          }
        }
        ctx.cone(turX, tTop + 0.06, turZ, rT * 1.14, coneH, roofC);
        for (let j = 0; j < 8; j++) {   // the flared skirt at the cone's foot
          const a = Math.PI * 2 * (j / 8);
          ctx.dbox(turX + Math.cos(a) * rT * 1.10, tTop + 0.18, turZ + Math.sin(a) * rT * 1.10,
            rT * 0.34, 0.22, rT * 0.34, roofL);
        }
        const apex = tTop + 0.06 + coneH;
        ctx.dbox(turX, apex + 0.16, turZ, 0.24, 0.34, 0.24, iron);
        ctx.ball(turX, apex + 0.52, turZ, clamp(rT * 0.16, 0.16, 0.36), iron);
        ctx.dbox(turX, apex + 1.10, turZ, 0.10, 0.80, 0.10, iron);
      }

      // ============================================================
      //  9. THE CHIMNEY — corbelled brick, off the ridge, off the turret
      // ============================================================
      // Placed on the opposite quarter from the turret and inboard of both
      // faces, so it is invisible below the roof and asymmetric above it.
      {
        const cw = clamp(unit * 0.095, 0.70, 1.75), cd = cw * 0.74;
        const cu = -uSign * spanU * 0.20, cv = vSign * spanV * 0.24, y0 = H - 0.7;
        const cTop = H + roofH * 0.94 + clamp(unit * 0.06, 0.65, 1.5);
        const nch = Math.max(6, Math.min(30, Math.round((cTop - y0) / clamp(cw * 0.26, 0.22, 0.42))));
        const chh = (cTop - y0) / nch;
        for (let i = 0; i < nch; i++)
          UV(cu, y0 + (i + 0.5) * chh, cv, cw, chh + 0.02, cd, (i % 2) ? F.shade(brick, 0.90) : brick);
        for (let k = 0; k < 3; k++)   // the corbelled cap
          UV(cu, cTop + 0.10 + k * 0.17, cv, cw + 0.14 + k * 0.10, 0.17, cd + 0.14 + k * 0.10,
            k === 1 ? F.shade(brick, 0.82) : trimD);
        for (const sg of [-1, 1])     // and its pots
          UV(cu + sg * cw * 0.24, cTop + 0.72, cv, cw * 0.30, 0.62, cd * 0.42, F.shade(brick, 0.72));
      }
    },
  });
})();
