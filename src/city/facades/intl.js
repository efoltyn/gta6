/* ============================================================
   city/facades/intl.js — "Seagram Curtain Wall": the International Style
   office tower, 1952-1965.

   REFERENCES
     Seagram Building (Mies, 1958):
       https://en.wikipedia.org/wiki/Seagram_Building
       https://www.macmetals.com/blog/extruded-bronze-curtain-wall-seagram-building/
       https://archeyes.com/seagram-building-new-york-mies-van-der-rohe/
     Lever House (SOM / Bunshaft, 1952):
       https://www.columbia.edu/cu/gsapp/BT/LEVER/report.html
       https://www.architecturelab.net/lever-house-som/

   THE PROPORTIONS, AS BUILT
     * Seagram: 30 ft (9.1 m) column bays, FIVE windows per bay, so the
       mullion module is ~1.4-1.5 m. Mullions are extruded bronze I-beams
       4.5 x 6 in (0.11 x 0.15 m) bolted to the outside of the frame: a web
       standing ~0.15 m proud and a flange capping it. They run unbroken
       from the lobby head to the roof.
     * Glass is storey-high in bronze frames; the opaque band at each floor
       (Muntz-metal spandrel at Seagram, dark blue-green wired glass at
       Lever) is ~0.9-1.1 m of the ~3.7-4 m storey.
     * The base is a DOUBLE-HEIGHT LOBBY: glass held back behind the
       bronze-clad columns (Seagram 7.3 m clear), pink-grey granite plaza.
       The shell wall here is fixed, so the lobby is the tall glazed ground
       storey(s) behind free-standing columns, a heavy fascia at its head.
     * The top is NOT a cornice. The grid stops at a louvred mechanical
       storey drawn in the same module, under a flush bronze band.

   WHAT THE GRAMMAR LAYS
     SPANDRELS   one opaque band per floor line, 1.07 m tall (0.45 m under
                 the floor, 0.62 m over it), flush (5 cm). The host's window
                 scan then finds exactly the vision zone of each storey, and
                 glazes it as one "ribbon" band per face with its own frame
                 mullions on the 1.5 m module (facade_openings.js).
     MULLIONS    web + flange, full shaft height, on the same module so the
                 host's frame mullions sit right behind them.
     CORNERS     the corner is a solid bronze column 0.75 m each way, the
                 detail that keeps the slab from reading as a card.
     LOBBY       "lobby" glazing on every face of the base storeys, columns
                 on every fifth module line, a 0.55 m granite base course.
     PLAZA       none. It was a 16 m granite plaza, which made fitShell
                 shrink the tower to make room for it and pushed the door
                 reveal out with it; the street's own footway is the plaza.
     MECHANICAL  storey ST-2 on towers of 14+: bronze louvre blades over the
                 whole band (deep, so no window is stamped behind them).
     CROWN       a flush bronze parapet band and a small set-back louvred
                 plant penthouse. Restraint is the style.

   PALETTES (ctx.hash): Seagram bronze / pink granite; Lever stainless /
   blue-green spandrel; 1960s black anodised / travertine. ctx.color is only
   a faint tint so two towers on one street are not the same metal.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  const PALETTES = [
    // Seagram: weathered bronze, Muntz-metal spandrel, pink-grey granite
    { metal: 0x5c4632, metalL: 0x7a5f43, spand: 0x463626, frame: 0x4a3a28, stone: 0x8a7a70, stoneD: 0x5e534c, louvre: 0x50402e },
    // Lever House: stainless, blue-green opaque spandrel glass, pale stone
    { metal: 0xa9b0b4, metalL: 0xc6ccd0, spand: 0x2f5a54, frame: 0x9aa1a6, stone: 0xb9b6ae, stoneD: 0x7f7d78, louvre: 0x8d9498 },
    // 1960s black anodised aluminium, charcoal spandrel, travertine
    { metal: 0x2c2f33, metalL: 0x45494e, spand: 0x34383c, frame: 0x1e2124, stone: 0xc9bfae, stoneD: 0x8f877a, louvre: 0x3a3e43 },
  ];

  CBZ.registerFacade("intl", {
    label: "Seagram Curtain Wall",
    // WHAT IT IS MADE OF (city/collapse.js MATERIALS) — a curtain wall on a steel frame.
    structure: "glassbox",
    crownsRoof: true,
    minStoreys: 10,
    window: "ribbon",
    build: function (ctx, F, spec) {
      const FH = ctx.FH, H = ctx.rTop, ST = Math.max(1, ctx.storeys | 0);
      const P0 = PALETTES[Math.min(PALETTES.length - 1, (ctx.hash(0x1e01) * PALETTES.length) | 0)];
      const tint = function (c) { return F.mix(c, ctx.color, 0.06); };
      const METAL = tint(P0.metal), METAL_L = tint(P0.metalL), SPAND = tint(P0.spand);
      const STONE = tint(P0.stone), STONE_D = tint(P0.stoneD), LOUVRE = tint(P0.louvre);
      F.windowFrame(ctx, P0.frame);
      const faces = F.faces(ctx);

      // ---- the module -------------------------------------------------
      const PITCH = 1.45 + (ctx.hash(0x1e02) - 0.5) * 0.08;
      const MARG = 0.72;                     // corner column zone, per face
      const WEB = 0.06, FLANGE = 0.16, MPROJ = 0.21;
      const SP_DN = 0.45, SP_UP = 0.62, SP_PROJ = 0.05;
      const pod = ST >= 12 ? 2 : 1, yPod = pod * FH;
      const mechK = ST >= 14 ? ST - 2 : -1;
      function lines(f) {
        const a = -f.span / 2 + MARG, b = f.span / 2 - MARG;
        const n = Math.max(2, Math.round((b - a) / PITCH));
        const out = [];
        for (let i = 0; i <= n; i++) out.push(a + (b - a) * i / n);
        return out;
      }

      // ================================================================
      //  2. THE LOBBY — tall glass behind free-standing bronze columns
      // ================================================================
      for (const f of faces) {
        for (let k = 0; k < pod; k++) F.windowStyle(ctx, f.s, k, "lobby");
        // granite base course: the glass lands on stone, not on the paving
        F.band(ctx, f, 0.275, 0.55, 0.07, STONE, 0.14);
        // the intermediate floor of a double-height lobby: a slim bronze rail
        for (let k = 1; k < pod; k++) F.band(ctx, f, k * FH - 0.1, 0.5, 0.06, METAL, 0.12);
        const L = lines(f);
        for (let i = 0; i < L.length; i += 5) {
          if (i === 0 || i === L.length - 1) continue;
          if (!F.clearsDoor(ctx, f, L[i], 1.6)) continue;
          F.rib(ctx, f, L[i], 0, yPod - SP_DN, 0.56, 0.52, METAL);
          F.rib(ctx, f, L[i], 0, 0.3, 0.72, 0.6, STONE_D);          // column shoe
        }
        // the lobby head: a deep bronze fascia on the first spandrel line
        F.band(ctx, f, yPod + (SP_UP - SP_DN) / 2, SP_UP + SP_DN, 0.24, METAL, 0.3);
        F.band(ctx, f, yPod - SP_DN - 0.04, 0.08, 0.30, METAL_L, 0.34);   // lit soffit lip
      }

      // ================================================================
      //  3. THE SHAFT — spandrels at every floor line
      // ================================================================
      for (const f of faces) {
        for (let k = pod + 1; k <= ST; k++) {
          const y = k * FH;
          const y0 = y - SP_DN, y1 = Math.min(y + SP_UP, H);
          if (y1 - y0 > 0.05) F.band(ctx, f, (y0 + y1) / 2, y1 - y0, SP_PROJ, SPAND, SP_PROJ);
        }
        // the louvred mechanical storey: blades over the whole band, deep
        // enough that the host stamps no window behind them
        if (mechK > pod) {
          const b0 = mechK * FH + SP_UP, b1 = (mechK + 1) * FH - SP_DN;
          F.band(ctx, f, (b0 + b1) / 2, b1 - b0, 0.04, F.shade(LOUVRE, 0.6), 0.04);
          for (let y = b0 + 0.1; y < b1 - 0.05; y += 0.24) F.box(ctx, f, 0, y, f.span + 0.08, 0.2, 0.30, LOUVRE, 0.07);
        }
      }

      // ================================================================
      //  4. MULLIONS — bronze I-sections, continuous, on the module
      // ================================================================
      for (const f of faces) {
        const L = lines(f);
        for (let i = 1; i < L.length - 1; i++) {
          F.rib(ctx, f, L[i], yPod + SP_UP, H, WEB, MPROJ - 0.04, METAL);
          F.box(ctx, f, L[i], (yPod + SP_UP + H) / 2, FLANGE, H - yPod - SP_UP, 0.04, METAL_L, MPROJ - 0.04);
        }
      }
      // the corner columns: solid metal both ways, full height
      F.corners(ctx, (yPod + H) / 2, H - yPod, MARG + 0.05, 0.12, METAL);
      F.corners(ctx, yPod / 2, yPod, MARG + 0.05, 0.10, STONE_D);

      // ================================================================
      //  5. THE CROWN — flush parapet band + a set-back plant penthouse
      // ================================================================
      {
        const parH = Math.max(1.1, Math.min(1.6, FH * 0.4));
        for (const f of faces) {
          F.band(ctx, f, H + parH / 2, parH, 0.36, METAL, 0.12, -0.26);
          F.band(ctx, f, H + parH + 0.05, 0.1, 0.42, METAL_L, 0.16, -0.28);
        }
        const R = F.roof(ctx);
        const pw = R.w * 0.5, pd = R.d * 0.46, ph = Math.max(2.6, Math.min(4.2, FH));
        if (pw > 3 && pd > 3) {
          const px = R.cx + (ctx.hash(0x1e05) - 0.5) * (R.w - pw) * 0.5;
          ctx.dbox(px, R.y + ph / 2, R.cz, pw, ph, pd, F.shade(LOUVRE, 0.7));
          for (let y = R.y + 0.4; y < R.y + ph - 0.3; y += 0.45) ctx.dbox(px, y, R.cz, pw + 0.16, 0.12, pd + 0.16, LOUVRE);
          ctx.dbox(px, R.y + ph + 0.08, R.cz, pw + 0.3, 0.16, pd + 0.3, METAL);
        }
      }
    },
  });
})();
