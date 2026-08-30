/* ============================================================
   city/facades/arcology.js — "Arcology Terrace": the vertical district.

   THE READ, AND WHAT IT MUST NOT BE MISTAKEN FOR. ziggurat.js is already a
   tower that steps back, so a set of setbacks alone is not a new grammar —
   it is that one repainted. What makes an arcology a different BUILDING is
   that it is not an office block at all: it is a piece of city stood on end,
   and the three things that say so are all silhouette, not surface.

     1. PLANTED TERRACES on EVERY face at a fixed storey interval, each with a
        deep soil parapet and greenery SPILLING over the edge — the plants
        hang below the deck line, which is the half nobody draws and the half
        that reads as growth rather than as a green stripe. The terraces get
        shallower as they rise (proj() below), so the mass genuinely steps
        back instead of wearing four identical shelves.
     2. A SEPARATED MASS with SKY-BRIDGES. A district has more than one
        building in it. A slim garden shaft stands off one flank with real air
        between it and the tower, and bridges cross that air at three terrace
        levels. Those gaps are HOLES IN THE SILHOUETTE at 200 m, which is the
        only way a single shell box can read as more than one mass.
     3. THE WIND-SCOOP VOID. The crown is split into two legs with a cap slab
        over them and a vertical-axis turbine standing in the gap — a hole cut
        clean through the top of the building. Nothing else in the kit has one,
        because below rTop the shell is a solid given and a facade cannot cut
        it; ABOVE rTop the facade owns the volume outright, so that is where
        the hole is honest. crownsRoof, so the host does not also grow a water
        tank through the scoop.

   WALL "keep" ON PURPOSE. The shell's glazing and its furnished lit rooms are
   the whole point here: the terraces have to read as INHABITED floors with
   people behind them, so the shaft is left as glass between slim piers and
   floor lines and this file never clads over a window.

   SOLIDITY: the podium and the double-height lobby piers are what a player on
   foot actually meets, and the satellite's ground mass, so those go through
   F.podium / F.sRib / F.solid. Everything above the lobby is out of reach and
   sbox would refuse it anyway.

   COST: no meshes at all. The turbine is a box cage — a real cylinder at that
   distance is indistinguishable and costs a draw call.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  CBZ.registerFacade("arcology", {
    label: "Arcology Terrace",
    era: "future",
    // city/collapse.js MATERIALS — a cast concrete frame with heavy planted
    // slabs hung off it. It pancakes; it does not shear.
    structure: "concrete",
    wall: "keep",
    crownsRoof: true,
    minStoreys: 14,
    build: function (ctx, F, spec) {
      spec = spec || {};
      const FH = ctx.FH, H = ctx.rTop, unit = Math.min(ctx.w, ctx.d);
      const h = function (s) { return ctx.hash(s); };
      const P = F.palette(ctx, "concrete", { pull: 0.70, grain: 0.05 });
      const leaf = F.mix(0x2f6b34, P.base, 0.12);      // planting, two tones so
      const leafL = F.mix(0x74b04a, P.base, 0.14);     // a terrace is not a hedge
      const soil = F.mix(P.dark, 0x3b2c1e, 0.55);
      const S = F.solid(ctx);

      // ---- A. THE GROUND AND THE SHAFT. A double-height lobby behind heavy
      // piers — the only part of a 130 m tower a player ever touches — and
      // above it slim piers, a floor line per storey, and NOTHING over the
      // glass: the lit rooms behind it are what make the terraces read as
      // floors of a district instead of as planted shelves.
      const pod = F.podium(ctx, { pal: P, over: clamp(unit * 0.05, 0.7, 1.8) });
      const gTop = FH * 2, gProj = clamp(unit * 0.055, 0.62, 1.4);
      const pw = clamp(unit * 0.026, 0.28, 0.60);
      for (const f of F.faces(ctx)) {
        for (const t of F.bayLines(f, F.bayCount(f, FH * 1.7, 3, 8), clamp(f.span * 0.05, 0.6, 1.6))) {
          if (F.clearsDoor(ctx, f, t, 1.3)) F.sRib(ctx, f, t, pod.top, gTop, clamp(unit * 0.05, 0.55, 1.2), gProj, P.light, 0);
          F.rib(ctx, f, t, gTop, H, pw, 0.30, P.light, 0);
        }
        F.band(ctx, f, gTop + 0.3, 0.6, gProj + 0.28, P.base, 0.4, 0);   // the lobby head
        for (let k = Math.ceil(gTop / FH); k * FH < H - 0.4; k++) F.band(ctx, f, k * FH, 0.20, 0.22, P.trim, 0.2, 0);
      }

      // ---- B. THE PLANTED TERRACES, on every face, stepping back as they
      // rise. proj() is the whole massing rule: deep at the bottom, a third of
      // that at the top, so the tower tapers without the shell changing size.
      const K = clamp(Math.round(ctx.storeys / 6), 3, 6);        // storeys per tier
      const D0 = clamp(unit * 0.12, 1.4, 3.0), tiers = [];
      for (let y = gTop + K * FH; y < H - FH * 1.1; y += K * FH) tiers.push(y);
      const proj = function (y) { return D0 * (1 - 0.62 * (y / H)); };
      for (let i = 0; i < tiers.length; i++) {
        const y = tiers[i], p = proj(y), par = clamp(FH * 0.30, 0.60, 1.10), pt = clamp(p * 0.26, 0.28, 0.55);
        for (const f of F.faces(ctx)) {
          F.band(ctx, f, y + 0.18, 0.36, p, P.light, 0.3, 0);                       // the deck slab
          F.band(ctx, f, y + 0.36 + par / 2, par, pt, soil, 0.3, p - pt);           // the soil parapet, at the OUTER edge
          const n = Math.max(3, Math.round(f.span / clamp(unit * 0.15, 1.4, 2.6)));
          for (let k = 0; k < n; k++) {
            const t = -f.span / 2 + (k + 0.5) * (f.span / n), s = 0xa1c0 + f.s * 13 + i * 7 + k;
            const bh = par * (0.55 + h(s) * 1.45), col = h(s + 1) < 0.4 ? leafL : leaf;
            F.box(ctx, f, t, y + 0.36 + par + bh / 2, (f.span / n) * 0.82, bh, pt * 0.92, col, p - pt);
            F.box(ctx, f, t, y + 0.10 - bh * 0.5, (f.span / n) * 0.70, bh, pt * 0.55, col, p - pt);  // SPILLING over the lip
          }
          const a = f.out * f.halfN, b = f.out * (f.halfN + p);   // the deck is somewhere you can stand
          if (f.horiz) ctx.plat(-ctx.w / 2, ctx.w / 2, Math.min(a, b), Math.max(a, b), y + 0.36);
          else ctx.plat(Math.min(a, b), Math.max(a, b), -ctx.d / 2, ctx.d / 2, y + 0.36);
        }
      }

      // ---- C. THE SEPARATED MASS. A slim garden shaft standing off one
      // FLANK (never the door face) with real air between it and the tower,
      // and sky-bridges crossing that air at alternate terrace levels. The
      // gaps between the bridges are the holes that make one shell read as
      // two buildings from a kilometre away.
      const fl = F.flanks(ctx), sf = fl[(h(0x71a0) * fl.length) | 0];
      const gap = D0 + clamp(unit * 0.03, 0.6, 1.1), bw = clamp(unit * 0.11, 1.6, 3.0);
      const sLen = sf.span * 0.44, sH = H * (0.52 + h(0x71a1) * 0.16), n0 = sf.halfN + gap;
      const sCol = F.shade(P.base, 0.88);   // its own tone: a NEIGHBOUR, not a wing of the tower
      // put/platN carry the four-face bookkeeping once, so the massing below
      // stays readable instead of being a wall of horiz ternaries.
      const put = function (E, cN, y, ln, hh, wd, col) {
        if (sf.horiz) E(0, y, sf.out * cN, ln, hh, wd, col); else E(sf.out * cN, y, 0, wd, hh, ln, col);
      };
      const platN = function (cN, wd, ln, top) { const c = sf.out * cN;
        if (sf.horiz) ctx.plat(-ln / 2, ln / 2, c - wd / 2, c + wd / 2, top);
        else ctx.plat(c - wd / 2, c + wd / 2, -ln / 2, ln / 2, top);
      };
      for (let i = 0; i < 3; i++) {
        const sh = sH / 3, wd = bw * (1 - i * 0.14), ln = sLen * (1 - i * 0.12), cN = n0 + wd / 2, y = i * sh;
        put(i === 0 ? S : ctx.dbox, cN, y + sh / 2, ln, sh, wd, i % 2 ? sCol : P.base);
        for (let k = 1; k * FH < sh; k++) put(ctx.dbox, cN, y + k * FH, ln * 0.66, FH * 0.34, wd + 0.20, P.glass);
        put(ctx.dbox, cN, y + sh + 0.2, ln + 0.5, 0.4, wd + 0.5, soil);             // a garden on every step
        platN(cN, wd, ln, y + sh + 0.4);
      }
      for (let i = 1; i < tiers.length; i += 2) {
        const y = tiers[i]; if (y > sH - FH) break;
        const bl = gap + proj(y) + 0.5, cN = sf.halfN + bl / 2 - 0.25, dw = clamp(sLen * 0.5, 2.0, 4.5);
        put(ctx.dbox, cN, y + 0.55, dw, 0.34, bl, P.light);
        put(ctx.dbox, cN, y + 1.45, dw * 0.9, 1.5, bl * 0.94, P.glass);
        platN(cN, bl, dw, y + 0.72);
      }

      // ---- D. THE WIND-SCOOP VOID: two legs, a cap slab over them, and a
      // hole between. The void is kept WIDER than the crown is deep, or the
      // far leg fills it and the hole reads as two dark windows instead of as
      // sky. The turbine standing in the draught says the hole is a machine
      // and not a missing floor.
      const R = F.roof(ctx);
      ctx.dbox(R.cx, H + ctx.pp * 0.5, R.cz, R.w, Math.max(0.06, ctx.pp), R.d, F.shade(P.base, 0.92));
      ctx.plat(R.cx - R.w / 2, R.cx + R.w / 2, R.cz - R.d / 2, R.cz + R.d / 2, H + ctx.pp);
      const Hc = clamp(H * 0.28, FH * 3.4, FH * 11), legH = Hc * 0.74, capH = Hc - legH;
      const fw = R.w * 0.26, fd = R.d * 0.52;
      for (const sg of [-1, 1]) {
        const cx = R.cx + sg * (R.w / 2 - fw / 2);
        ctx.dbox(cx, H + legH / 2, R.cz, fw, legH, fd, P.base);
        ctx.dbox(cx, H + legH * 0.5, R.cz, fw + 0.22, legH * 0.86, fd * 0.64, P.glass);
        ctx.dbox(cx, H + legH + 0.1, R.cz, fw + 0.7, 0.36, fd + 0.7, P.light);
      }
      ctx.dbox(R.cx, H + legH + capH / 2, R.cz, R.w, capH, fd, P.light);
      ctx.dbox(R.cx, H + legH + capH + 0.3, R.cz, R.w + 0.9, 0.5, fd + 0.9, P.base);
      ctx.dbox(R.cx, H + legH + capH + 0.9, R.cz, R.w * 0.9, 0.7, fd * 0.9, leaf);   // the roof garden, up top
      const tr = Math.min(R.w * 0.13, legH * 0.20), ty = H + legH * 0.28, th = legH * 0.54;
      F.boxShaft(ctx, R.cx, ty, R.cz, th, tr * 0.30, P.trim, null, false);
      for (let i = 0; i < 3; i++) {   // a vertical-axis turbine: three blades on a ring
        const a = (i / 3) * Math.PI * 2 + 0.4, bx = R.cx + Math.cos(a) * tr, bz = R.cz + Math.sin(a) * tr;
        ctx.dbox(bx, ty + th / 2, bz, tr * 0.30, th * 0.92, tr * 0.30, P.light);
        for (const e of [0, th]) ctx.dbox((R.cx + bx) / 2, ty + e, (R.cz + bz) / 2, Math.abs(bx - R.cx) + 0.2, 0.16, Math.abs(bz - R.cz) + 0.2, P.trim);
      }
    },
  });
})();
