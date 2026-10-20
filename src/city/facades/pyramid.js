/* ============================================================
   city/facades/pyramid.js — "Tapered Spire": the Transamerica idea.

   REFERENCES (2026-10 rewrite)
     Transamerica Pyramid (William Pereira, 1972): white crushed-quartz
       precast panels, punched windows ~1.2 m wide on a ~1.75 m module, a
       base of splayed concrete legs with the lobby glass set back behind
       them, two "wings" (the lift bank and the stair) breaking out of the
       taper, a blind aluminium-clad spire.
       https://en.wikipedia.org/wiki/Transamerica_Pyramid
       https://sah-archipedia.org/  (Pereira's precast panel system)
     Precast window-wall proportions: deep reveals, a sill line every floor.
       https://en.wikipedia.org/wiki/Curtain_wall_(architecture)

   WHAT CHANGED AND WHY. The 2026-09 grammar built the taper as cladding
   standing up to 11.7 m proud of the shell at the pavement: on a lot that
   allows 1 m it ran over the footway, and it covered the windows. The shell
   is a straight box and a facade cannot lean it inward, so now the shaft is
   honest — a vertical precast grid with real punched windows — and the
   triangle is where this grammar owns the volume: above the roof.

   THE PROPORTIONS (metres)
     module            1.75 m: a precast mullion 0.55 m wide, 0.20 m proud,
                       a punched window 1.2 m wide (the host glazes it "deep":
                       a dark frame in a 0.34 m reveal + the panel's 0.2 m)
     sill / spandrel   one precast spandrel per floor line, 0.20 m proud, the
                       same plane as the mullions: a flat white grid
     base              2 storeys (3 at 24+): splayed legs 1.1 m wide, 0.9 m
                       proud at the ground stepping back to 0.45 m, lobby
                       glass between them on a 3.5 m bay
     wings             two blind shafts on the flanks, 22 % of the face wide,
                       0.9 m proud, rising out of the roof into the spire to
                       different heights — the lift bank and the stair
     spire             a stepped pyramid over the full plan, 25 % of the
                       building's height, glazed in bands on its lower 40 %
                       and blind above, then a mast of 3 % and two beacons
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  CBZ.registerFacade("pyramid", {
    label: "Tapered Spire",
    // WHAT IT IS MADE OF (city/collapse.js MATERIALS) — a tapered spire is a reinforced concrete core.
    structure: "concrete",
    crownsRoof: true,
    minStoreys: 16,
    window: "deep",
    build: function (ctx, F, spec) {
      const FH = ctx.FH, H = ctx.rTop, ST = Math.max(1, ctx.storeys | 0);
      const faces = F.faces(ctx);
      const e = F.entrance(ctx);

      // ---------------- palette: white quartz precast ----------------
      const CLAD = F.mix(ctx.color, 0xe2ded4, 0.6);
      const LIT = F.shade(CLAD, 1.06), MID = F.shade(CLAD, 0.86), DARK = F.shade(CLAD, 0.55);
      const SPIRE = ctx.hash(0x9a1) < 0.5 ? F.shade(CLAD, 0.94) : F.mix(CLAD, 0xa9b0b6, 0.5);
      const GLASSD = 0x20262c;
      F.windowFrame(ctx, ctx.hash(0x9a2) < 0.5 ? 0x26231f : 0x5b5c5a);

      const MOD = 1.75, MW = 0.55, MP = 0.20;
      const sillOff = FH >= 3.6 ? 0.85 : 0.8;
      const sill = (k) => k * FH + sillOff, head = (k) => (k + 1) * FH - 0.46;
      const nb = ST >= 24 ? 3 : 2;
      const yBase = nb * FH;

      // the wings: on the two faces that are not the door face's pair
      const wingFaces = (ctx.doorSide === 0 || ctx.doorSide === 1) ? [2, 3] : [0, 1];
      const wingTop = [H * 0.25 * 0.55, H * 0.25 * 0.36];

      for (const f of faces) {
        const isDoor = f.s === ctx.doorSide;
        for (let k = 0; k < nb; k++) F.windowStyle(ctx, f.s, k, "lobby");
        const wi = wingFaces.indexOf(f.s);
        const wingW = wi >= 0 ? clamp(f.span * 0.22, 3.0, 9.0) : 0;

        // ================= 1. THE BASE: splayed legs =================
        const nL = F.bayCount(f, 3.5, 2, 14);
        const legs = F.bayLines(f, nL, 0.55);
        for (const t of legs) {
          if (!F.clearsDoor(ctx, f, t, 1.6)) continue;
          // three courses: widest and proudest at the pavement
          for (let i = 0; i < 3; i++) {
            const y0 = yBase * i / 3, y1 = yBase * (i + 1) / 3;
            F.rib(ctx, f, t, y0, y1, 1.1 - i * 0.12, 0.9 - i * 0.2, i === 0 ? MID : CLAD);
          }
        }
        // the soffit over the lobby: a deep precast beam, the first floor line
        F.band(ctx, f, yBase - 0.23, 0.46, 0.55, LIT, 1.1);
        F.band(ctx, f, yBase - 0.5, 0.08, 0.45, DARK, 0.9);
        // the mezzanine floor line(s) inside the base
        for (let k = 1; k < nb; k++) {
          const y0 = head(k - 1), y1 = sill(k);
          const ok = !isDoor;
          if (ok) F.band(ctx, f, (y0 + y1) / 2, y1 - y0, 0.08, DARK, 0.1);
          else for (const sg of [-1, 1]) {
            const len = f.span / 2 - 1.8;
            if (len > 0.1) F.box(ctx, f, sg * (1.8 + len / 2), (y0 + y1) / 2, len, y1 - y0, 0.08, DARK);
          }
        }

        // ================= 2. THE SHAFT: the precast grid =============
        const n = F.bayCount(f, MOD, 2, 40);
        const L = F.bayLines(f, n, MW / 2);
        const wingY0 = yBase + FH * Math.round(ST * 0.25);
        for (let i = 0; i < L.length; i++) {
          const t = L[i];
          const end = i === 0 || i === L.length - 1;
          // a mullion behind a wing stops where the wing starts
          const top = (wingW && Math.abs(t) < wingW / 2) ? wingY0 : H + 0.6;
          F.rib(ctx, f, t, yBase, top, end ? MW * 1.6 : MW, MP, CLAD);
        }
        for (let k = nb; k <= ST; k++) {
          const y0 = k === nb ? yBase : head(k - 1), y1 = k === ST ? H + 0.6 : sill(k);
          if (y1 - y0 < 0.05) continue;
          F.band(ctx, f, (y0 + y1) / 2, y1 - y0, MP, CLAD, MP * 2);
          // the sill: a lit lip on the top of each spandrel
          if (k < ST) F.band(ctx, f, y1 - 0.04, 0.08, MP + 0.04, LIT, MP * 2);
        }

        // ================= 3. THE WINGS ===============================
        if (wingW) {
          const y0 = wingY0;
          const top = H + wingTop[wi];
          F.box(ctx, f, 0, (y0 + top) / 2, wingW, top - y0, 0.9, MID);
          // the wing's own shadow joints, a pair of slim reveals
          for (const sg of [-1, 1]) F.rib(ctx, f, sg * (wingW / 2 - 0.4), y0, top, 0.12, 0.94, DARK);
          // its depth into the roof (the lift bank stands on the slab)
          const hd = f.halfN;
          if (f.horiz) ctx.dbox(0, (H + top) / 2, f.out * (hd - 1.8), wingW, top - H, 3.6, MID);
          else ctx.dbox(f.out * (hd - 1.8), (H + top) / 2, 0, 3.6, top - H, wingW, MID);
          ctx.dbox(f.horiz ? 0 : f.out * (hd - 1.35), top + 0.12, f.horiz ? f.out * (hd - 1.35) : 0,
            f.horiz ? wingW + 0.2 : 4.6, 0.24, f.horiz ? 4.6 : wingW + 0.2, LIT);
        }
      }

      // ================= 4. THE SPIRE ==================================
      {
        const CH = H * 0.25;
        const N = 18;
        const cx = ctx.slabCx, cz = ctx.slabCz;
        const w0 = ctx.w - 0.1, d0 = ctx.d - 0.1;
        let y = H + 0.6;
        const step = (CH - 0.6) / N;
        for (let i = 0; i < N; i++) {
          // mostly straight, closing faster near the tip so it ends in a point
          const u = i / N, k = Math.max(0.06, 1 - u - u * u * 0.08);
          const sw = w0 * k, sd = d0 * k;
          const glazed = i < N * 0.4 && (i % 2 === 1);
          if (glazed) {
            ctx.dbox(cx, y + step / 2, cz, sw - 0.3, step, sd - 0.3, GLASSD);
            ctx.dbox(cx, y + step - 0.05, cz, sw, 0.1, sd, LIT);
          } else {
            ctx.dbox(cx, y + step / 2, cz, sw, step, sd, i % 4 === 0 ? SPIRE : F.shade(SPIRE, 0.95));
          }
          y += step;
        }
        // the mast and two beacons
        const mh = H * 0.03;
        ctx.dbox(cx, y + mh / 2, cz, 0.4, mh, 0.4, F.shade(SPIRE, 0.7));
        ctx.lamp(cx, y + mh + 0.2, cz, 0.2, 0xff4a2a);
        ctx.lamp(cx, y + mh * 0.5, cz, 0.16, 0xff4a2a);
      }

      // ================= 5. THE ENTRANCE ==============================
      if (!ctx.noDoor && !e.driveIn) {
        const f = e.f;
        // the two legs either side of the door, full base height, proudest
        for (const sg of [-1, 1]) F.rib(ctx, f, sg * 2.1, 0, yBase - 0.46, 0.9, 1.05, MID);
        F.box(ctx, f, 0, Math.min(yBase - 0.8, 3.6), 5.1, 0.3, 1.2, LIT);
      }
    },
  });
})();
