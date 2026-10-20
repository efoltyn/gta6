/* ============================================================
   city/facades/artdeco.js — "Deco Tower": the 1928-32 setback skyscraper,
   and, under seven storeys, the moderne shop block of the same years.

   REFERENCES (2026-10 rewrite)
     Chanin Building (Sloan & Robertson, 1929): continuous buff piers, the
       terracotta frieze over the shop storeys, zigzag storefronts, bronze.
       https://en.wikipedia.org/wiki/Chanin_Building
       https://www.nycstylelittlecannoli.com/2014/04/chanin-building.html
     Chrysler Building: setbacks dressed at each ledge, aluminium/nickel
       spandrels, white brick piers, grey brick bands.
       https://www.dezeen.com/2025/03/04/chrysler-building-art-deco-centenary/
     Setback form under the 1916 Zoning Resolution, ornament built into the
       wall (terracotta, cast stone, decorative brick), not applied:
       https://en.wikipedia.org/wiki/Art_Deco_in_the_United_States
       https://awedeco.com/stepped-forms-in-art-deco-architecture/

   THE PROPORTIONS, in metres (none of them scale with the building)
     bay pitch         2.9 m: a pier 0.70 m wide, 0.30 m proud, then a pair of
                       steel casements ~2.2 m between the pier faces (the host
                       glazes it as "deco": two lights, horizontal bars)
     corner pier       1.3 m, so the corner reads solid, not as a card edge
     spandrel          the wall between one storey's head and the next sill,
                       0.12 m proud: 0.18 m BEHIND the pier face, so the piers
                       read as one unbroken run of verticals with shadow
                       between them. Nothing horizontal crosses a pier.
     window            sill 0.75-0.85 m over the floor, head 0.46 m under the
                       next floor: ~2.0 m tall at a 3.2 m storey, 2.6 m at 3.9
     base              1 storey (2 on a 20+ storey tower): black granite
                       plinth 0.56 m, the piers coming straight down to it,
                       tall lobby glass between, a cast-stone belt over it
     portal            three stepped reveals 0.30 m wide, 0.30 / 0.48 / 0.66 m
                       proud, a bronze transom grille over the door
     ornament          concentrated where the eye is: metal spandrel panels
                       with a chevron on the storey over the base and on the
                       top three storeys of the shaft, a zigzag frieze on the
                       parapet. The middle of the shaft is plain on purpose.
     crown             setback stages above the roof, at most ~20 % of the
                       height, plus a needle of ~4 %: 24 % in all (it was 42 %
                       of the building on a 45-storey tower: a second tower
                       standing on the first)

   THE SHOP BLOCK (2-6 storeys): the commercial storefront (F.storefront) on
   the door face, the same pier-and-spandrel wall above, and a deco attic: a
   parapet with a stepped central pylon and pier finials. No setbacks — a
   four-storey building with a wedding cake on it is a toy.

   PALETTE. The wall is the street's own colour (ctx.color; Midtown's cream)
   and three seeded variants pick the trim: Chanin (terracotta spandrels,
   bronze), Chrysler (grey brick bands, nickel) and black-and-brass.

   COST. Piers are one box per bay line for the full height; spandrels are
   one box per floor line per face, laid BEHIND the piers. Ornament is per
   bay on four storeys only. Fewer boxes than the 2026-09 grammar at every
   size it is built at.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // the bay lines of a face: interior pier lines + the two corner piers.
  // F.bayCount / F.bayLines are grid-aware (a metro hands in its own bays).
  function bayGrid(F, f, pitch, cornerW, pierW) {
    const n = F.bayCount(f, pitch, 1, 18);
    const L = F.bayLines(f, n, cornerW / 2);
    const inner = L.slice(1, L.length - 1);
    const bays = [];
    for (let i = 0; i < n; i++) {
      const a = i === 0 ? -f.span / 2 + cornerW : L[i] + pierW / 2;
      const b = i === n - 1 ? f.span / 2 - cornerW : L[i + 1] - pierW / 2;
      if (b - a > 0.5) bays.push({ t0: a, t1: b, t: (a + b) / 2, w: b - a });
    }
    return { lines: inner, bays: bays };
  }

  // a box on face f laid in two pieces either side of |t| < cut (a portal)
  function boxCut(ctx, F, f, cy, h, proj, col, cut) {
    if (!(cut > 0)) { F.band(ctx, f, cy, h, proj, col, proj * 2); return; }
    const a = f.span / 2 + proj;
    const len = a - cut;
    if (len > 0.02) for (const sg of [-1, 1]) F.box(ctx, f, sg * (cut + len / 2), cy, len, h, proj, col);
  }

  CBZ.registerFacade("artdeco", {
    label: "Deco Tower",
    // WHAT IT IS MADE OF (city/collapse.js MATERIALS) — a 1920s deco tower is a riveted steel frame behind masonry cladding.
    structure: "steel",
    crownsRoof: true,
    // the steel casement of 1925-40: slim black steel, horizontal bars
    window: "deco",
    build: function (ctx, F, spec) {
      const FH = ctx.FH, ST = Math.max(1, ctx.storeys | 0), H = ctx.rTop;
      const tower = ST >= 7;
      const faces = F.faces(ctx);

      // ---- palette --------------------------------------------------
      const v = (ctx.hash(0x0dec) * 3) | 0;
      const body = ctx.color;
      const pier = F.shade(body, 1.05);
      const fillet = F.shade(body, 1.12);
      const VAR = [
        // Chanin: buff piers, terracotta spandrels, bronze
        { spand: F.mix(body, 0x9a6448, 0.55), metal: 0x9a7a44, frame: 0x4a3a28, base: 0x3a3430 },
        // Chrysler: white piers, grey-brick bands, nickel
        { spand: F.mix(body, 0x55575b, 0.72), metal: 0xb9c3cb, frame: 0x1e2124, base: 0x2a2a2c },
        // black and brass
        { spand: F.mix(body, 0x2e2c2a, 0.80), metal: 0xc8a13c, frame: 0x1e2124, base: 0x242424 },
      ][v];
      const spand = VAR.spand, metal = VAR.metal, metalD = F.shade(metal, 0.62);
      const granite = VAR.base, graniteL = F.shade(granite, 1.6);
      F.windowFrame(ctx, VAR.frame);

      // ---- the ruling numbers (metres) -------------------------------
      const PITCH = 2.9, PW = 0.70, PP = 0.30, CW = 1.3, SP = 0.12;
      const sillOff = FH >= 3.6 ? 0.85 : 0.75;
      const sill = (k) => k * FH + sillOff;
      const head = (k) => (k + 1) * FH - 0.46;

      const nb = !tower ? 1 : (ST >= 20 ? 2 : 1);   // base storeys
      const yBase = nb * FH;
      const e = F.entrance(ctx);
      const df = e.f;

      // ---- the street front: storefront (shop block) or portal (tower)
      let sfTop = 0;                                 // door face: wall starts here
      let portalHalf = 0, pTop = 0;
      if (!tower && ST >= 2) {
        const sf = F.storefront(ctx, df, { pierW: CW, pierCol: pier, frame: VAR.frame, bulk: granite,
          sign: metalD, cornCol: pier, proj: 0.16, awning: ctx.hash(0x0a3) < 0.4 ? F.mix(spand, 0x203040, 0.4) : null });
        sfTop = sf.top;
      } else if (!ctx.noDoor && !e.driveIn) {
        portalHalf = 1.62;
        pTop = clamp(yBase - 0.6, 3.3, 6.2);
      }

      // ================================================================
      //  1. PIERS, SPANDRELS, BASE — every face
      // ================================================================
      for (const f of faces) {
        const isDoor = f.s === ctx.doorSide;
        const g = bayGrid(F, f, PITCH, CW, PW);
        const cut = isDoor && portalHalf > 0 ? portalHalf + 0.9 : 0;  // the portal's outer jamb edge
        const wall0 = isDoor ? sfTop : 0;           // where the masonry wall starts

        // base storeys glaze as lobby glass
        if (tower) for (let k = 0; k < nb; k++) F.windowStyle(ctx, f.s, k, "lobby");

        // --- the corner piers, full height
        for (const sg of [-1, 1]) {
          F.rib(ctx, f, sg * (f.span / 2 - CW / 2), wall0, H + 0.9, CW, PP, pier);
          F.rib(ctx, f, sg * (f.span / 2 - CW / 2), wall0, H + 0.9, 0.18, PP + 0.05, fillet);
        }
        // --- the interior piers: one box per line, sidewalk to parapet,
        // with a fillet down the centre (the flute that gives it width)
        for (const t of g.lines) {
          let y0 = wall0;
          if (cut && Math.abs(t) < cut + PW / 2) y0 = pTop + 0.65;
          F.rib(ctx, f, t, y0, H + 0.9, PW, PP, pier);
          F.rib(ctx, f, t, y0, H + 0.9, 0.16, PP + 0.05, fillet);
          // pier finial: a stepped cap standing on the parapet
          F.rib(ctx, f, t, H + 0.9, H + 1.35, PW - 0.16, PP - 0.06, pier);
        }

        // --- the plinth (tower, and shop-block flanks): black granite to sill
        if (!(isDoor && sfTop > 0)) {
          boxCut(ctx, F, f, 0.28, 0.56, 0.16, granite, isDoor ? Math.max(cut, e.gap / 2) : 0);
          boxCut(ctx, F, f, 0.58, 0.05, 0.19, graniteL, isDoor ? Math.max(cut, e.gap / 2) : 0);
        }

        // --- the spandrels: the wall between each head and the next sill.
        // One box per floor line, full face width, BEHIND the piers.
        for (let k = 0; k <= ST; k++) {
          let y0 = k === 0 ? 0.56 : head(k - 1);
          let y1 = k === ST ? H + 0.9 : sill(k);
          if (k === 0) continue;                    // the plinth is storey 0's
          if (isDoor && sfTop > 0 && k === 1) y0 = sfTop;
          if (y1 - y0 < 0.05) continue;
          const c = (isDoor && y0 < pTop + 0.65) ? cut : 0;
          // the storeys over a tower's base are the mezzanine: metal panels
          const col = (tower && k < nb) ? metalD : spand;
          boxCut(ctx, F, f, (y0 + y1) / 2, y1 - y0, SP, col, c);
          // ORNAMENT, on the storey over the base and the top three: a
          // metal panel in each bay with a stepped chevron on it
          const orn = k < ST && (k === nb || k >= ST - 3) && (y1 - y0) > 0.7;
          if (orn) {
            for (const b of g.bays) {
              if (c && Math.abs(b.t) < c + b.w / 2) continue;
              const ph = (y1 - y0) - 0.36, pw = b.w - 0.36;
              F.box(ctx, f, b.t, (y0 + y1) / 2, pw, ph, SP + 0.03, metal);
              chevron(ctx, F, f, b.t, (y0 + y1) / 2, pw, ph, SP + 0.06, metalD);
            }
          }
        }

        // --- the base belt over a tower's lobby storeys: a cast-stone
        // course 0.5 m tall standing proud of the piers, a metal lip on it
        if (tower) {
          const by = yBase - 0.46;
          boxCut(ctx, F, f, by + 0.25, 0.5, PP + 0.16, pier, isDoor && pTop + 0.6 > by ? cut + 0.35 : 0);
          boxCut(ctx, F, f, by + 0.54, 0.08, PP + 0.22, metal, isDoor && pTop + 0.6 > by ? cut + 0.35 : 0);
        }
      }

      // ================================================================
      //  2. THE PORTAL (towers): stepped reveals, a transom grille
      // ================================================================
      if (portalHalf > 0) {
        const f = df;
        for (let i = 0; i < 3; i++) {
          const hw = portalHalf + 0.3 * i + 0.15;
          const top = pTop + 0.3 * i;
          const pj = 0.30 + 0.18 * i;
          const col = i === 1 ? metal : (i === 0 ? F.shade(pier, 0.92) : pier);
          for (const sg of [-1, 1]) F.rib(ctx, f, sg * hw, 0, top, 0.3, pj, col);
          F.box(ctx, f, 0, top + 0.15, hw * 2 + 0.3, 0.3, pj, col);
        }
        // the grille over the door: a bronze panel, vertical bars, two
        // stepped chevron rails. Starts above the door head (2.9 m).
        const g0 = 2.95, g1 = pTop;
        if (g1 - g0 > 0.3) {
          F.box(ctx, f, 0, (g0 + g1) / 2, portalHalf * 2, g1 - g0, 0.06, F.shade(VAR.frame, 0.9));
          const nbar = 7;
          for (let i = 1; i < nbar; i++) {
            const t = -portalHalf + (portalHalf * 2) * i / nbar;
            F.rib(ctx, f, t, g0, g1, 0.05, 0.12, metal);
          }
          for (const fr of [0.35, 0.7]) {
            const y = g0 + (g1 - g0) * fr;
            F.box(ctx, f, 0, y, portalHalf * 2 * (1 - fr * 0.5), 0.06, 0.13, metal);
          }
        }
        // a stepped crest over the portal
        for (let i = 0; i < 3; i++) {
          F.box(ctx, f, 0, pTop + 1.05 + i * 0.22, (portalHalf + 0.9) * 2 * (1 - i * 0.28), 0.22, 0.62 - i * 0.08, i % 2 ? metal : pier);
        }
      }

      // ================================================================
      //  3. THE PARAPET — a deco attic band with a zigzag frieze
      // ================================================================
      {
        const ph = 0.9;
        for (const f of faces) {
          F.band(ctx, f, H + 0.10, 0.20, PP + 0.06, F.shade(pier, 0.9), 0.4);   // the drip at the roof line
          // the zigzag: a run of small stepped teeth in metal along the frieze
          const n = Math.max(6, Math.round(f.span / 0.9));
          F.merlons(ctx, f, H + 0.48, n, 0.28, 0.22, SP + 0.08, metal);
        }
        F.ring(ctx, H + ph + 0.06, 0.12, PP + 0.02, F.shade(pier, 1.04), 0.4);  // coping
      }

      if (!tower) {
        // ---- THE SHOP BLOCK'S ATTIC: a stepped pylon over the entrance
        const f = df;
        const w0 = Math.min(f.span * 0.42, 9);
        let y = H + 0.96;
        for (let i = 0; i < 3; i++) {
          const w = w0 * (1 - i * 0.3), h = 0.42;
          F.box(ctx, f, 0, y + h / 2, w, h, PP - 0.02, i === 1 ? metal : pier, -0.25);
          y += h;
        }
        return;
      }

      // ================================================================
      //  4. THE SETBACK CROWN — two or three stages, then a needle
      // ================================================================
      const crownB = H * 0.155;                      // all the stages
      const mastB = Math.min(H * 0.035, 7);
      const nS = ST >= 20 ? 3 : ST >= 12 ? 2 : 1;
      const split = nS === 3 ? [0.46, 0.32, 0.22] : nS === 2 ? [0.6, 0.4] : [1];
      const plan = nS === 3 ? [0.78, 0.58, 0.40] : nS === 2 ? [0.74, 0.50] : [0.62];
      const glassD = F.mix(VAR.frame, 0x1a1e24, 0.6);
      let sy = H + 1.02;
      let sw = ctx.slabW, sd = ctx.slabD;
      for (let i = 0; i < nS; i++) {
        const nw = ctx.slabW * (plan[i] + (ctx.hash(0x1a00 + i) - 0.5) * 0.06);
        const nd = ctx.slabD * (plan[i] + (ctx.hash(0x1b00 + i) - 0.5) * 0.06);
        if (nw < 2.2 || nd < 2.2) break;
        // whole storeys
        const nst = Math.max(1, Math.floor(crownB * split[i] / FH + 0.35));
        const sh = nst * FH;
        const cx = ctx.slabCx, cz = ctx.slabCz;
        // the stage's glazed core, then its piers and floor bands standing on it
        ctx.dbox(cx, sy + sh / 2, cz, nw, sh, nd, glassD);
        const px = Math.max(2, Math.round(nw / PITCH)), pz = Math.max(2, Math.round(nd / PITCH));
        for (let k = 0; k <= px; k++) {
          const x = cx - nw / 2 + nw * k / px;
          const pw = (k === 0 || k === px) ? 1.0 : PW;
          for (const sg of [-1, 1]) ctx.dbox(x, sy + sh / 2, cz + sg * (nd / 2 + PP / 2), pw, sh, PP, pier);
        }
        for (let k = 0; k <= pz; k++) {
          const z = cz - nd / 2 + nd * k / pz;
          const pw = (k === 0 || k === pz) ? 1.0 : PW;
          for (const sg of [-1, 1]) ctx.dbox(cx + sg * (nw / 2 + PP / 2), sy + sh / 2, z, PP, sh, pw, pier);
        }
        for (let k = 0; k < nst; k++) {
          const y0 = sy + k * FH - (k === 0 ? 0 : 0.46), y1 = sy + k * FH + sillOff;
          ctx.dbox(cx, (y0 + y1) / 2, cz, nw + SP * 2, y1 - y0, nd + SP * 2, spand);
        }
        // the stage's own parapet: a band, a metal zigzag, a coping
        const ty = sy + sh;
        ctx.dbox(cx, ty + 0.35, cz, nw + SP * 2, 0.7, nd + SP * 2, spand);
        ctx.dbox(cx, ty + 0.76, cz, nw + PP * 2 + 0.08, 0.12, nd + PP * 2 + 0.08, F.shade(pier, 1.04));
        if (i === nS - 1 && nS === 3) {
          // the top stage's corners step up in three courses: the lantern
          for (let s2 = 0; s2 < 3; s2++) {
            const f2 = 1 - s2 * 0.24;
            ctx.dbox(cx, ty + 0.82 + s2 * 0.5 + 0.25, cz, nw * f2 * 0.8, 0.5, nd * f2 * 0.8, s2 === 1 ? metal : pier);
          }
          sy = ty + 0.82 + 1.5;
        } else sy = ty + 0.82;
        sw = nw; sd = nd;
      }
      // ---- the needle: three stepped segments and a beacon ---------
      {
        const base = clamp(Math.min(sw, sd) * 0.18, 0.5, 1.4);
        let my = sy, mw = base;
        const seg = mastB / 3;
        for (let i = 0; i < 3; i++) {
          ctx.dbox(ctx.slabCx, my + seg / 2, ctx.slabCz, mw, seg, mw, i % 2 ? metal : pier);
          my += seg; mw *= 0.58;
        }
        ctx.lamp(ctx.slabCx, my + 0.2, ctx.slabCz, Math.max(0.12, base * 0.14), 0xffd08a);
      }
    },
  });

  // A stepped chevron on one spandrel panel: two courses of two arms
  // meeting at the bay centre — the zigzag of every 1930 lobby, in four boxes.
  function chevron(ctx, F, f, t, cy, pw, ph, proj, col) {
    if (pw < 0.8 || ph < 0.3) return;
    const arm = pw * 0.22, th = Math.min(0.1, ph * 0.18);
    for (let i = 0; i < 2; i++) {
      const y = cy - ph * 0.15 + i * ph * 0.3;
      const off = arm * (0.55 + i * 0.5);
      for (const sg of [-1, 1]) F.box(ctx, f, t + sg * off, y, arm, th, proj, col);
    }
  }
})();
