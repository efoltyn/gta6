/* ============================================================
   city/facades/sunburst.js — "Radiator Crown", 1930: the Chrysler idea.

   REFERENCES (2026-10 rewrite)
     Chrysler Building (William Van Alen, 1930): a white-brick shaft striped
       with grey brick at the window lines, nickel-chrome steel spandrels at
       the setbacks, radiator-cap eagles at the 61st-floor corners, and the
       crown: seven tiers of radiating stainless arches, each perforated by
       triangular windows, under a needle.
       https://www.cnn.com/2025/04/28/style/chrysler-building-art-deco-centennial
       https://www.dezeen.com/2025/03/04/chrysler-building-art-deco-centenary/
       https://en.wikipedia.org/wiki/Art_Deco_in_the_United_States

   THE BARGAIN. The shaft is an ordinary pale brick office building and the
   money is spent in the last fifth: so the shaft here is disciplined and
   cheap, and the crown is the event.

   THE PROPORTIONS (metres; nothing scales off the building)
     bay               2.9 m: a white brick pier 0.66 m wide, 0.28 m proud,
                       and a pair of steel casements ~2.2 m between them
     grey bands        the spandrel at every floor line in dark grey brick,
                       0.12 m proud, behind the piers: the horizontal stripe
                       you see on the real shaft is the spandrel showing
                       between white piers
     base              2 storeys of polished black granite (3 on a 30+
                       storey tower): piers 0.9 m, tall lobby glass, a nickel
                       cornice 0.5 m proud, a radiating fan over the entrance
                       (the crown's motif brought down to the door)
     belt              one nickel frieze two-thirds up the shaft, 0.45 m proud
     shoulder          a 0.55 m nickel ring at the roof line, the four corner
                       eagles thrusting 0.85 m out of the corners — kept
                       inside the 1 m the lot allows (they reached 3 m)
     crown             24 % of the building in all: fans 62 % of it, the
                       needle 38 %. Seven tiers, each narrower and taller,
                       each springing INSIDE the last: that overlap is what
                       makes a sunburst and not a wedding cake.

   COST. Piers one box per line for the whole height, one grey band per floor
   line per face, ornament only at the base, the belt and the crown.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

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
  function boxCut(ctx, F, f, cy, h, proj, col, cut) {
    if (!(cut > 0)) { F.band(ctx, f, cy, h, proj, col, proj * 2); return; }
    const a = f.span / 2 + proj, len = a - cut;
    if (len > 0.02) for (const sg of [-1, 1]) F.box(ctx, f, sg * (cut + len / 2), cy, len, h, proj, col);
  }

  CBZ.registerFacade("sunburst", {
    label: "Radiator Crown",
    // WHAT IT IS MADE OF (city/collapse.js MATERIALS) — a radiator-crown tower is a riveted steel frame.
    structure: "steel",
    crownsRoof: true,
    minStoreys: 14,
    window: "deco",
    build: function (ctx, F, spec) {
      const FH = ctx.FH, H = ctx.rTop, ST = Math.max(1, ctx.storeys | 0);
      const W2 = ctx.w / 2, D2 = ctx.d / 2;
      const faces = F.faces(ctx);
      const e = F.entrance(ctx);

      // ---------------- palette ----------------
      // white brick off the street's own colour, grey brick bands, nickel
      const BRICK = F.mix(ctx.color, 0xe4e0d6, 0.55);
      const PIER = BRICK;
      const BAND = F.mix(ctx.color, ctx.hash(0x5b1) < 0.5 ? 0x5a5c60 : 0x6a5f55, 0.78);
      const NICK = ctx.hash(0x5b2) < 0.7 ? 0xb9c3cb : 0xc8a13c;    // nickel, or a brass variant
      const NLIT = F.shade(NICK, 1.08);
      const NDRK = F.shade(NICK, 0.62);
      const GRAN = 0x2a2a2c, GLINT = 0x55575c;
      const VOID = F.glass(ctx, 0x161a20);
      F.windowFrame(ctx, ctx.hash(0x5b3) < 0.5 ? 0x1e2124 : 0x3a3f45);

      const PITCH = 2.9, PW = 0.66, PP = 0.28, CW = 1.2, SP = 0.12;
      const sillOff = FH >= 3.6 ? 0.85 : 0.75;
      const sill = (k) => k * FH + sillOff, head = (k) => (k + 1) * FH - 0.46;

      // ================================================================
      //  0. THE VERTICAL SPLIT
      // ================================================================
      const CH = clamp(H * 0.24, FH * 3, 60);         // crown: fans + needle
      const nb = ST >= 30 ? 3 : 2;                    // granite base storeys
      const yBase = nb * FH;
      const portalHalf = (!ctx.noDoor && !e.driveIn) ? 1.6 : 0;
      const pTop = clamp(yBase - 1.6, 3.2, 6.4);
      const cut = portalHalf > 0 ? portalHalf + 0.95 : 0;

      // ================================================================
      //  1. BASE + SHAFT, every face
      // ================================================================
      for (const f of faces) {
        const isDoor = f.s === ctx.doorSide;
        const g = bayGrid(F, f, PITCH, CW, PW);
        const c = isDoor ? cut : 0;
        for (let k = 0; k < nb; k++) F.windowStyle(ctx, f.s, k, "lobby");

        // corner piers: granite in the base, brick above
        for (const sg of [-1, 1]) {
          const t = sg * (f.span / 2 - CW / 2);
          F.rib(ctx, f, t, 0, yBase, CW + 0.04, PP + 0.08, GRAN);
          F.rib(ctx, f, t, yBase, H, CW, PP, PIER);
        }
        for (const t of g.lines) {
          const inPortal = c && Math.abs(t) < c + PW / 2;
          if (!inPortal) {
            F.rib(ctx, f, t, 0, yBase, PW + 0.2, PP + 0.08, GRAN);
            F.rib(ctx, f, t, 0, yBase, 0.1, PP + 0.12, GLINT);            // polished arris
          }
          F.rib(ctx, f, t, inPortal ? pTop + 1.4 : yBase, H, PW, PP, PIER);
        }
        // the granite plinth and the base's mezzanine bands
        boxCut(ctx, F, f, 0.28, 0.56, 0.18, GRAN, c);
        for (let k = 1; k <= ST; k++) {
          const y0 = head(k - 1), y1 = k === ST ? H : sill(k);
          if (y1 - y0 < 0.05) continue;
          const base = k < nb;
          boxCut(ctx, F, f, (y0 + y1) / 2, y1 - y0, base ? SP + 0.04 : SP, base ? GRAN : BAND, (c && y0 < pTop + 1.4) ? c : 0);
          // a nickel panel in each bay over the base and at the shoulder
          if ((k === nb || k === ST - 1) && y1 - y0 > 0.7) {
            for (const b of g.bays) {
              if (c && y0 < pTop + 1.4 && Math.abs(b.t) < c + b.w / 2) continue;
              F.box(ctx, f, b.t, (y0 + y1) / 2, b.w - 0.3, y1 - y0 - 0.3, SP + 0.03, NICK);
            }
          }
        }
        // the base cornice: granite, then nickel
        const by = yBase - 0.46;
        const bc = c && pTop + 1.4 > by ? c : 0;
        boxCut(ctx, F, f, by + 0.2, 0.4, PP + 0.22, GRAN, bc);
        boxCut(ctx, F, f, by + 0.47, 0.14, PP + 0.3, NICK, bc);
      }

      // ---- THE ENTRANCE: stepped granite reveals and a radiating fan ----
      if (portalHalf > 0) {
        const f = e.f;
        for (let i = 0; i < 2; i++) {
          const hw = portalHalf + 0.15 + 0.3 * i, top = pTop + 0.3 * i, pj = 0.36 + 0.2 * i;
          for (const sg of [-1, 1]) F.rib(ctx, f, sg * hw, 0, top, 0.3, pj, i ? GRAN : NDRK);
          F.box(ctx, f, 0, top + 0.15, hw * 2 + 0.3, 0.3, pj, i ? GRAN : NDRK);
        }
        // the fan: rays of a half sunburst between the door head and the
        // portal head, nickel on a black granite tympanum
        const y0 = 2.95, fr = Math.min(portalHalf * 0.95, pTop - y0);
        if (fr > 0.3) {
          F.box(ctx, f, 0, (y0 + pTop) / 2, portalHalf * 2, pTop - y0, 0.08, GRAN);
          const rays = 9;
          for (let i = 0; i < rays; i++) {
            const a = Math.PI * (i + 0.5) / rays;
            const t = Math.cos(a) * fr * 0.9, hy = Math.sin(a) * fr;
            F.box(ctx, f, t, y0 + hy / 2, 0.12, Math.max(0.15, hy), 0.16, i % 2 ? NICK : NLIT);
          }
        }
        // a nickel crest over the portal
        F.box(ctx, f, 0, pTop + 0.95, (portalHalf + 0.9) * 2, 0.2, 0.7, NLIT);
      }

      // ---- THE BELT: one nickel frieze two-thirds up the shaft ----------
      {
        const kb = Math.round(nb + (ST - nb) * 0.66);
        const y0 = head(kb - 1), y1 = sill(kb);
        if (kb > nb && kb < ST - 1 && y1 - y0 > 0.6) {
          const bh = y1 - y0;
          F.ring(ctx, (y0 + y1) / 2, bh, PP + 0.12, F.shade(BAND, 0.9), 0.5);
          F.ring(ctx, y0 + 0.06, 0.12, PP + 0.18, NICK, 0.6);
          F.ring(ctx, y1 - 0.06, 0.12, PP + 0.18, NICK, 0.6);
          for (const f of faces) {
            const n = Math.max(4, Math.round(f.span / 1.8));
            F.merlons(ctx, f, (y0 + y1) / 2, n, 0.5, bh * 0.4, PP + 0.16, NLIT);
          }
        }
      }

      // ================================================================
      //  2. THE SHOULDER AND THE CORNER EAGLES
      // ================================================================
      F.ring(ctx, H + 0.12, 0.24, 0.45, NDRK, 0.6);
      F.ring(ctx, H + 0.40, 0.32, 0.55, NICK, 0.7);
      F.ring(ctx, H + 0.62, 0.12, 0.45, NLIT, 0.6);
      {
        const steps = 5, reach = 0.55, rise = clamp(FH * 1.6, 2.4, 6), len = 1.2;
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          for (let i = 0; i < steps; i++) {
            const u = (i + 0.5) / steps;
            const out = reach * Math.pow(u, 0.7);
            const l = len * (1 - u * 0.4);
            const th = rise / steps + 0.03, cy = H + 0.7 + u * rise;
            const col = i % 2 ? NICK : NLIT;
            ctx.dbox(sx * (W2 + out - l / 2), cy, sz * (D2 + out * 0.6 - l * 0.375), l, th, l * 0.75, col);
            ctx.dbox(sx * (W2 + out * 0.6 - l * 0.375), cy, sz * (D2 + out - l / 2), l * 0.75, th, l, col);
          }
          ctx.dbox(sx * (W2 + reach - 0.3), H + 0.7 + rise * 1.05, sz * (D2 + reach - 0.3), 0.6, rise * 0.18, 0.6, NLIT);
        }
      }

      // ================================================================
      //  3. THE CROWN — nested fans of radiating arches
      // ================================================================
      const TIERS = 7, COURSES = 8;
      const HT = CH * 0.62, HS = CH - HT;
      const yC = H + 0.7;
      // a fan whose rise is less than its own half-span is a dome: the
      // crown's plan is capped by its own height
      const CS = Math.min(1, (HT * 0.95) / (Math.max(W2, D2) * 0.95));
      function cface(horiz, sgn, t, cy, len, h, proj, col, plane) {
        const n = plane + proj / 2;
        if (horiz) ctx.dbox(t, cy, sgn * n, len, h, proj, col);
        else ctx.dbox(sgn * n, cy, t, proj, h, len, col);
      }
      function triLight(horiz, sgn, t, y, wid, h, plane) {
        for (let i = 0; i < 3; i++) {
          const u = (i + 0.5) / 3;
          cface(horiz, sgn, t, y + u * h, wid * (1 - u * 0.86), h / 3 + 0.02, 0.2, VOID, plane);
        }
      }
      for (let i = 0; i < TIERS; i++) {
        const k = 1 - 0.125 * i;
        const hx = W2 * k * CS, hz = D2 * k * CS;
        const y0 = yC + HT * 0.30 * (i / (TIERS - 1));
        const apex = yC + HT * (0.30 + 0.70 * (i + 1) / TIERS);
        const span = apex - y0;
        if (span < 0.4) continue;
        for (let j = 0; j < COURSES; j++) {
          const u = (j + 0.5) / COURSES;
          const frac = Math.sqrt(Math.max(0.02, 1 - u * u));
          const ch = span / COURSES + 0.03, cy = y0 + u * span;
          const lx = hx * frac * 2, lz = hz * frac * 2;
          ctx.dbox(0, cy, 0, lx, ch, lz, j % 2 ? NICK : NDRK);
          ctx.dbox(0, cy + ch * 0.42, 0, lx + 0.1, ch * 0.16, lz + 0.1, NLIT);   // the bright arris
        }
        // TRIANGULAR LIGHTS: one radiating row per tier, all four faces
        const nL = Math.max(2, 6 - i);
        const row = 0.34, frac = Math.sqrt(1 - row * row), y = y0 + row * span;
        const lh = Math.min(span * 0.24, 2.4);
        for (const horiz of [true, false]) {
          const halfT = (horiz ? hx : hz) * frac, plane = (horiz ? hz : hx) * frac;
          const step = (halfT * 2 * 0.82) / nL;
          if (step < 0.6) continue;
          for (const sgn of [-1, 1]) for (let m = 0; m < nL; m++) {
            const t = -halfT * 0.82 + (m + 0.5) * step;
            triLight(horiz, sgn, t, y, Math.min(step * 0.5, lh * 0.8), lh, plane);
          }
        }
      }

      // ---- THE NEEDLE ----
      {
        const segs = 10, yS = yC + HT;
        const r0 = clamp(Math.min(W2, D2) * CS * 0.16, 0.4, 1.6);
        for (let i = 0; i < segs; i++) {
          const u = i / segs, u1 = (i + 1) / segs;
          const r = r0 * (1 - u1 * 0.86), sh = (HS * 0.9) / segs;
          ctx.dbox(0, yS + (u + u1) / 2 * HS * 0.9, 0, r * 2, sh + 0.02, r * 2, i % 2 ? NICK : NLIT);
          if (i % 3 === 1) ctx.dbox(0, yS + u1 * HS * 0.9, 0, r * 2.8, sh * 0.2, r * 2.8, NLIT);
        }
        const yK = yS + HS * 0.9, knob = Math.max(0.25, r0 * 0.35);
        ctx.ball(0, yK + knob, 0, knob, NLIT);
        ctx.cone(0, yK + knob * 1.6, 0, knob * 0.5, HS * 0.1, NLIT);
      }
    },
  });
})();
