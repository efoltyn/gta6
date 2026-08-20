/* ============================================================
   city/facades/artdeco.js — "Deco Tower": the 1930 setback skyscraper.

   WHAT IS BEING MODELLED. The American zoning-envelope tower of 1928-1932
   (Barclay-Vesey, Chanin, Chrysler, Cincinnati's Carew): a masonry shell whose
   whole expressive idea is VERTICAL CONTINUITY. The structural bay is
   expressed as a pier of cast stone that leaves the plinth and does not stop
   until the crown; the floor spandrels between the piers are pushed BACK, so
   the eye reads an unbroken run of light-catching verticals with shadow
   between them. Nothing horizontal may cross a pier. That one rule is the
   entire style; a "deco" building with a string course cutting its piers is a
   Victorian block wearing a chevron, and it looks it.

   WHY EACH ELEMENT IS HERE.
     PLINTH      a dark ground course, so the piers have something to spring
                 from instead of growing out of the pavement.
     PIERS       one per bay line, full height, projecting proud. The load
                 bearing fiction, and the silhouette-maker: they carry past the
                 roofline as fins into the first setback.
     FLUTES      2-3 slim reveals of a lighter/darker shade cut into each pier
                 face. Cheap, but it is what stops a pier reading as a plank -
                 at 100 m the flute shadow is the only thing giving it width.
     SPANDRELS   recessed panels between piers at every floor line, dark, so
                 the wall behind the glass line reads as a void.
     CHEVRONS    nested stepped triangles in metal on each spandrel: the deco
                 ornament that is pure geometry rather than acanthus. Kept to a
                 few percent of surface so it stays jewellery.
     PORTAL      a stepped ziggurat opening at the door: three diminishing
                 reveals, low relief pilasters, and a stylised sunburst fan in
                 the head. The one place the building is allowed to be loud.
     SETBACKS    3-4 rectangular, deliberately off-centre stages, each edged
                 with a stepped metal-lined cap. Asymmetry is what separates a
                 zoning envelope from a wedding cake.
     MAST        a tapering spire with a warm beacon: the terminal accent, and
                 the reason you can name this building from across the city.

   Every dimension derives from ctx.w / ctx.d / ctx.storeys / ctx.FH / ctx.rTop
   or a face span, so a 10 m one-storey shop gets a squat two-stage crown with
   three piers, and a 40 m eight-storey block gets nine piers and four stages.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  CBZ.registerFacade("artdeco", {
    label: "Deco Tower",
    // WHAT IT IS MADE OF (city/collapse.js MATERIALS) — a 1920s deco tower is a riveted steel frame behind masonry cladding.
    structure: "steel",
    crownsRoof: true,
    build: function (ctx, F, spec) {
      const W = ctx.w, D = ctx.d, FH = ctx.FH, ST = Math.max(1, ctx.storeys);
      const unit = Math.min(W, D);            // the building's own scale ruler
      const H = ctx.rTop;                     // wall height this facade must dress

      // ---- palette: cast stone + ONE metal ------------------------
      // ANCHORED IN THE MIDDLE, deliberately. This renderer clips above about
      // 0x99, so a facade derived by lightening a near-white host colour has no
      // range left to model with: pier faces, flutes, chevrons and metal all
      // land on the same white and every bit of relief stops reading. The body
      // is therefore driven DOWN to a real warm cast-stone value first, and the
      // whole remaining range is spent on relief instead of on being pale.
      const body = F.mix(F.shade(ctx.color, 0.62), 0x8a8474, 0.55);
      const stone = body;
      const pier = F.shade(body, 1.16);             // pier faces catch the light
      const flute = F.shade(body, 0.94);            // and each flute steps off them
      const recess = F.shade(body, 0.50);           // spandrel void: a real shadow
      const plinth = F.shade(body, 0.34);
      // brass or nickel, chosen by position hash. Pulled only slightly toward
      // the stone — enough to sit in the same daylight, not so much that the
      // reveal stops being a different material.
      const metalPure = ctx.hash(0x0dec) < 0.5 ? 0xc8a13c : 0xb9c3cb;
      const metal = F.mix(metalPure, body, 0.10);
      const metalD = F.shade(metal, 0.66);

      // ---- the ruling grid ---------------------------------------
      // depth of relief scales with the building, never a constant
      const PJ = clamp(unit * 0.026, 0.16, 0.55);     // pier projection
      const PJs = PJ * 0.34;                          // spandrel plane (behind)
      const PJo = PJ * 1.22;                          // ornament, proud of the pier
      const plinthH = clamp(FH * 0.30, 0.5, 1.6);
      const pierY0 = plinthH;                          // piers spring from here
      const e = F.entrance(ctx);
      // the portal, sized off the door requirement and the ground storey
      const portW = clamp(e.gap * 1.75, unit * 0.24, Math.min(W, D) * 0.62);
      const jw = clamp(portW * 0.10, 0.22, 0.7);      // one portal reveal
      // The portal head, and the CEILING it may not pass. On a one-storey shop
      // the door-clearance minimum alone is taller than the parapet, so the
      // stepped reveals and their pilasters would shoot past the roofline like
      // aerials — cap the whole assembly against the wall it is cut into.
      const portCap = H - jw * 4.6 - 0.1;
      const portH = Math.min(clamp(FH * (ST > 1 ? 1.55 : 1.15), e.head + 0.7, H * 0.8), portCap);

      // ============================================================
      //  1. PLINTH — a dark ground course under everything
      // ============================================================
      F.ring(ctx, plinthH / 2, plinthH, PJ * 1.15, plinth, 0.24);
      F.ring(ctx, plinthH + 0.06, 0.12, PJ * 1.30, metal, 0.30);   // one metal line at grade

      // ============================================================
      //  2. PIERS + RECESSED SPANDRELS on all four faces
      // ============================================================
      const faces = F.faces(ctx);
      for (const f of faces) {
        const n = F.bayCount(f, clamp(unit * 0.22, 2.6, 4.6), 2, 9);
        const marg = clamp(f.span * 0.075, 0.35, 1.2);
        const lines = F.bayLines(f, n, marg);
        const step = lines.length > 1 ? (lines[1] - lines[0]) : f.span;
        const pw = clamp(step * 0.38, 0.34, step * 0.5);

        // --- the recessed field first, so piers sit in front of it ---
        // one dark panel per bay, full height: this IS the shadow the piers
        // are read against.
        for (const b of F.bays(f, n, marg)) {
          const bw = Math.max(0.2, b.w - pw);
          F.rib(ctx, f, b.t, pierY0, H, bw, PJs, recess);
        }
        // --- spandrels: a deeper-recessed band at each floor line ---
        for (let s = 1; s < ST; s++) {
          const y = s * FH;
          const sh = clamp(FH * 0.26, 0.4, 1.5);
          for (const b of F.bays(f, n, marg)) {
            const bw = Math.max(0.2, b.w - pw);
            if (y - sh / 2 < portH + 0.2 && !F.clearsDoor(ctx, f, b.t, bw)) continue;
            F.box(ctx, f, b.t, y, bw, sh, PJs * 1.55, F.shade(recess, 1.35));
            chevron(ctx, F, f, b.t, y, bw, sh, PJo * 0.9, metal, metalD);
          }
        }

        // --- the piers themselves: floor to crown, nothing crosses ---
        for (let i = 0; i < lines.length; i++) {
          const t = lines[i];
          // a pier that would land on the doorway starts above the portal head
          const y0 = F.clearsDoor(ctx, f, t, pw) ? pierY0 : (portH + 0.35);
          if (H - y0 < FH * 0.3) continue;
          F.rib(ctx, f, t, y0, H, pw, PJ, pier);
          // FLUTING: slim reveals down the pier face, alternating shade, plus
          // one metal thread dead centre running the full height.
          const nf = pw > 0.85 ? 3 : 2;
          const fw = pw / (nf * 2 + 1);
          for (let k = 0; k < nf; k++) {
            const ft = t - pw / 2 + fw * (1 + k * 2) + fw / 2;
            F.rib(ctx, f, ft, y0, H, fw, PJ * 1.14, flute);
          }
          F.rib(ctx, f, t, y0, H, fw * 0.34, PJ * 1.30, metal);
        }
      }
      // corner piers: the corner must read solid or the tower looks like a card
      const cw = clamp(unit * 0.10, 0.7, 2.2);
      F.corners(ctx, (pierY0 + H) / 2, H - pierY0, cw, PJ * 0.92, pier);

      // ============================================================
      //  3. THE PORTAL — stepped ziggurat opening over the door
      // ============================================================
      if (portH >= 1.2) {                              // else: no wall to cut it into
        const f = e.f;
        for (let i = 0; i < 3; i++) {
          const hw = portW / 2 + jw * i;               // each reveal steps outward
          const top = portH + jw * (2 - i) * 0.9;
          const pj = PJ * (1.5 - i * 0.34);
          const col = i === 1 ? metalD : F.shade(stone, 1 - i * 0.10);
          for (const sg of [-1, 1]) F.rib(ctx, f, sg * (hw + jw / 2), 0, top, jw, pj, col);
          F.box(ctx, f, 0, top + jw / 2, hw * 2 + jw * 2, jw, pj, col);
        }
        // low relief pilasters flanking the whole portal
        const px = portW / 2 + jw * 3.6;
        for (const sg of [-1, 1]) {
          F.rib(ctx, f, sg * px, 0, portH + jw * 3.2, jw * 1.5, PJ * 0.9, pier);
          F.rib(ctx, f, sg * px, portH + jw * 3.2, portH + jw * 4.4, jw * 2.1, PJ * 1.1, metal);
        }
        // SUNBURST FAN in the head: rays of graded height above the opening,
        // tallest at the centre. Pure geometry, which is the deco point.
        const rays = 9, rw = portW / (rays * 1.5);
        const fanY = portH * 0.80, fanH = portH * 0.16;
        for (let i = 0; i < rays; i++) {
          const u = (i - (rays - 1) / 2) / ((rays - 1) / 2);      // -1..1
          const rh = fanH * (1 - Math.abs(u) * 0.62);
          F.box(ctx, f, u * (portW / 2 - rw), fanY + rh / 2, rw, rh,
            PJ * (i % 2 ? 1.35 : 1.05), i % 2 ? metal : F.shade(stone, 1.08));
        }
        F.box(ctx, f, 0, fanY - 0.08, portW * 0.98, 0.14, PJ * 1.4, metal);   // fan springing
      }

      // ============================================================
      //  4. THE SETBACK CROWN — 3-4 rectangular, off-centre stages
      // ============================================================
      // THE CROWN BUDGET. The whole assembly — every setback stage, the shaft
      // and the mast — is a fixed FRACTION OF ctx.rTop, never storeys times a
      // constant. A crown that terminates a building is 30-45% of it; anything
      // more is a second skyscraper that landed on an office block, which is
      // exactly what a per-storey height rule produces on a tall block.
      const crownBudget = H * (0.36 + ctx.hash(0x1d00) * 0.09);
      // floor the stack at half a storey so even a one-storey shop gets a
      // stepped attic instead of a bald parapet
      const stackBudget = Math.max(crownBudget * 0.58, FH * 0.55);
      const mastBudget = Math.max(crownBudget * 0.42, FH * 0.35); // slender accent

      // How many stages the budget can actually AFFORD. Splitting a 3 m stack
      // four ways gives four 40 cm trays that read as noise, not as setbacks —
      // the stage count follows the height available, never the storey count.
      const stages = Math.round(clamp(stackBudget / (FH * 0.62), 2, 4));
      let sy = H, sw = ctx.slabW, sd = ctx.slabD;
      let sx = ctx.slabCx, sz = ctx.slabCz;
      let capMetal = metal;
      // diminishing stage heights that sum to stackBudget: the lowest stage is
      // the thickest course, so the eye reads a taper and not a stack of trays.
      let wsum = 0; for (let i = 0; i < stages; i++) wsum += 1 - i * 0.16;
      for (let i = 0; i < stages; i++) {
        // Both plan axes step in, by DIFFERENT amounts, and the remainder is
        // shoved off-centre: a zoning envelope steps where the lot lines are.
        // The FIRST stage barely steps in — it is the tower shoulder standing
        // on the roof edge, and if it starts small the roof reads as a bare
        // deck with a lid dropped on it. Everything above bites hard.
        const k0 = i === 0 ? 0.86 : 0.62, kr = i === 0 ? 0.09 : 0.16;
        const kx = k0 + ctx.hash(0x1a00 + i) * kr;
        const kz = k0 + ctx.hash(0x1b00 + i) * kr;
        const nw = sw * kx, nd = sd * kz;
        if (nw < 1.0 || nd < 1.0) break;
        const bias = (ctx.hash(0x1c00 + i) - 0.5) * (i === 0 ? 0.4 : 0.9);
        const nx = sx + (sw - nw) / 2 * bias, nz = sz + (sd - nd) / 2 * bias;
        const sh = stackBudget * ((1 - i * 0.16) / wsum) - 0.32;   // 0.32 = its own cap
        if (sh < 0.35) break;
        ctx.dbox(nx, sy + sh / 2, nz, nw, sh, nd, F.shade(stone, 1 - i * 0.02));
        // the stage's own piers, so verticality survives into the crown
        const pn = Math.max(2, Math.round(nw / clamp(unit * 0.24, 2.4, 4.4)));
        const ppw = clamp(nw / (pn * 3), 0.20, 0.9);
        for (let k = 0; k <= pn; k++) {
          const t = -nw / 2 + (nw / pn) * k;
          ctx.dbox(nx + t, sy + sh / 2, nz - nd / 2 - PJ * 0.4, ppw, sh, PJ * 0.8, pier);
          ctx.dbox(nx + t, sy + sh / 2, nz + nd / 2 + PJ * 0.4, ppw, sh, PJ * 0.8, pier);
        }
        const dn = Math.max(2, Math.round(nd / clamp(unit * 0.24, 2.4, 4.4)));
        const dpw = clamp(nd / (dn * 3), 0.20, 0.9);
        for (let k = 0; k <= dn; k++) {
          const t = -nd / 2 + (nd / dn) * k;
          ctx.dbox(nx - nw / 2 - PJ * 0.4, sy + sh / 2, nz + t, PJ * 0.8, sh, dpw, pier);
          ctx.dbox(nx + nw / 2 + PJ * 0.4, sy + sh / 2, nz + t, PJ * 0.8, sh, dpw, pier);
        }
        // the setback shelf: a thin dark reveal at the step, then a metal line.
        // Kept tight to the wall — a wide coping here reads as a temple eave.
        const cy = sy + sh;
        ctx.dbox(nx, cy + 0.09, nz, nw + PJ * 1.1, 0.18, nd + PJ * 1.1, F.shade(stone, 0.80));
        ctx.dbox(nx, cy + 0.25, nz, nw + PJ * 0.5, 0.14, nd + PJ * 0.5, capMetal);
        capMetal = metalD;
        sy = cy + 0.32; sw = nw; sd = nd; sx = nx; sz = nz;
      }

      // ============================================================
      //  5. MAST + BEACON — the slender accent, inside the crown budget
      // ============================================================
      {
        const base = Math.max(0.35, Math.min(sw, sd) * 0.40);
        const shaft = mastBudget * 0.62, spike = mastBudget * 0.38;
        const seg = 3, sh = shaft / seg;
        let my = sy, mw = base;
        for (let i = 0; i < seg; i++) {
          ctx.dbox(sx, my + sh / 2, sz, mw, sh, mw, i % 2 ? metal : F.shade(stone, 1.05));
          my += sh; mw *= 0.62;
        }
        const tip = Math.max(0.10, mw * 0.55);
        ctx.dbox(sx, my + spike / 2, sz, tip, spike, tip, metal);
        ctx.lamp(sx, my + spike + tip * 0.9, sz, Math.max(0.11, base * 0.15), 0xffd08a);
      }
    },
  });

  // A nested stepped chevron, drawn inside one spandrel panel. Three courses,
  // each narrower and higher than the last, mirrored about the panel centre —
  // the zigzag every 1930 elevator lobby has, in the cheapest honest form.
  function chevron(ctx, F, f, t, y, bw, sh, pj, metal, metalD) {
    const courses = 3;
    const cw = Math.min(bw * 0.62, sh * 2.2);
    if (cw < 0.35) return;
    const ch = sh * 0.20;
    for (let i = 0; i < courses; i++) {
      const u = i / courses;
      const halfw = (cw / 2) * (1 - u * 0.62);
      const seg = Math.max(0.12, halfw * 0.62);
      const cy = y - sh * 0.22 + i * ch * 1.05;
      for (const sg of [-1, 1]) {
        F.box(ctx, f, t + sg * (halfw - seg / 2), cy, seg, ch * 0.55, pj, i === 1 ? metalD : metal);
      }
    }
  }
})();
