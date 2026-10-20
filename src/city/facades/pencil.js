/* ============================================================
   city/facades/pencil.js — "Supertall Slim": the Billionaires' Row pencil.

   REFERENCES (2026-10 rewrite)
     432 Park Avenue (Rafael Viñoly, 2015): a plain square shaft, an exposed
       white concrete grid of 10 ft (3.05 m) square windows, the tower cut
       into 12-storey blocks by open double-height mechanical floors that
       let the wind through, no crown: the grid simply stops.
       https://en.wikipedia.org/wiki/432_Park_Avenue
       https://www.skyscraper.org/supertall/building/432-park-avenue/
       https://reinventny.com/blog/432-park-avenue

   THE PROPORTIONS (metres)
     grid              square openings: as tall as the storey allows (the
                       host's window band, FH - 1.02: 2.9 m at a 3.9 m
                       storey) and as wide, on a pitch of that + 0.9 m
     frame             concrete members 0.9 m wide (1.2 m at the corners),
                       0.35 m proud of the glass line; the floor beam is the
                       same member laid flat, so the face is ONE grid, not
                       piers with bands. The host glazes each square with a
                       single pane ("lobby": one light, dark frame, no sill)
     mechanical        every twelfth storey pair is plant: the same grid,
                       filled with horizontal louvre blades standing in the
                       frame's depth (the open floors of the real tower; a
                       shell cannot be open, so it is louvred)
     podium            the bottom two storeys: the grid lands on the ground
                       and the lobby glass is the frame's double height,
                       with no floor beam across it on the door face
     crown             none: the grid continues ~12 % of the height above the
                       roof as real volume, the top two storeys of it OPEN
                       (four corner members and a beam, sky through), then a
                       slim cap and two beacons

   COLOUR. 432's concrete is near white: the street colour pulled hard to a
   warm white concrete, near-black glass.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  CBZ.registerFacade("pencil", {
    label: "Supertall Slim",
    // WHAT IT IS MADE OF (city/collapse.js MATERIALS) — a pencil tower is a concrete exoskeleton.
    structure: "concrete",
    crownsRoof: true,
    minStoreys: 20,
    window: "lobby",
    build: function (ctx, F, spec) {
      const FH = ctx.FH, H = ctx.rTop, ST = Math.max(1, ctx.storeys | 0);
      const faces = F.faces(ctx);

      const CONC = F.mix(ctx.color, 0xe6e2da, 0.7);
      const CONC_D = F.shade(CONC, 0.82);
      const LOUV = F.shade(CONC, 0.62);
      const GLASSD = 0x161a1f;
      F.windowFrame(ctx, ctx.hash(0x7c1) < 0.5 ? 0x3a3c3e : 0x26282a);

      const PW = 0.9, CW = 1.2, PP = 0.35;
      const sillOff = 0.58;
      const sill = (k) => k * FH + sillOff, head = (k) => (k + 1) * FH - 0.46;
      const pitch = (FH - 0.46 - sillOff) + PW;
      // the mechanical storeys: the last two of every twelve
      const mech = (k) => k >= 10 && k < ST - 2 && (k % 12 === 10 || k % 12 === 11);

      F.windowStyle(ctx, ctx.doorSide, 0, "lobby");
      for (const f of faces) {
        const isDoor = f.s === ctx.doorSide;
        const n = F.bayCount(f, pitch, 2, 30);
        const L = F.bayLines(f, n, CW / 2);
        // the verticals: corners wider, every member sidewalk to parapet
        for (let i = 0; i < L.length; i++) {
          const end = i === 0 || i === L.length - 1;
          const t = end ? Math.sign(L[i]) * (f.span / 2 - CW / 2) : L[i];
          if (isDoor && !end && !F.clearsDoor(ctx, f, t, PW)) {
            F.rib(ctx, f, t, 2 * FH - 0.46, H + 0.8, PW, PP, CONC);
            continue;
          }
          F.rib(ctx, f, t, 0, H + 0.8, end ? CW : PW, PP, CONC);
        }
        // the horizontals: the floor beam between one head and the next sill
        for (let k = 1; k <= ST; k++) {
          if (isDoor && k === 1) continue;            // the double-height lobby
          const y0 = head(k - 1), y1 = k === ST ? H + 0.8 : sill(k);
          if (y1 - y0 < 0.05) continue;
          // between two plant storeys the beam is thinner: it reads double-height
          const thin = mech(k - 1) && mech(k);
          const yy0 = thin ? y0 + (y1 - y0) * 0.3 : y0, yy1 = thin ? y1 - (y1 - y0) * 0.3 : y1;
          F.band(ctx, f, (yy0 + yy1) / 2, yy1 - yy0, PP, CONC, PP * 2);
        }
        // a plinth line at grade
        F.band(ctx, f, 0.29, 0.58, PP, CONC_D, PP * 2);
        // the plant floors: louvre blades in the frame's depth
        for (let k = 0; k < ST; k++) {
          if (!mech(k)) continue;
          const y0 = sill(k), y1 = head(k);
          const nB = Math.max(3, Math.round((y1 - y0) / 0.36));
          for (let b = 0; b < nB; b++) {
            const y = y0 + (b + 0.5) * (y1 - y0) / nB;
            F.box(ctx, f, 0, y, f.span - 0.1, 0.09, 0.17, LOUV, 0.13);
          }
        }
      }

      // ---- the cap of the shell: a slim lip, set in 0.2 m
      F.ring(ctx, H + 0.86, 0.12, PP - 0.05, CONC_D, 0.4);

      // ================= THE OUT-RISING SHAFT AND ITS OPEN TOP =========
      {
        const nX = Math.max(1, Math.round(H * 0.12 / FH));
        const open = 2, solid = Math.max(1, nX - open);
        const cx = 0, cz = 0, w = ctx.w, d = ctx.d;
        const y0 = H + 0.92;
        const ys = y0 + solid * FH;
        // the glazed block: a dark core with the grid standing on it
        ctx.dbox(cx, (y0 + ys) / 2, cz, w - 0.2, ys - y0, d - 0.2, GLASSD);
        for (const horiz of [true, false]) {
          const span = horiz ? w : d, half = (horiz ? d : w) / 2;
          const n = Math.max(2, Math.round(span / pitch));
          for (let i = 0; i <= n; i++) {
            const t = -span / 2 + (span * i) / n;
            const end = i === 0 || i === n;
            const wid = end ? CW : PW;
            const tt = end ? Math.sign(t) * (span / 2 - CW / 2) : t;
            for (const sg of [-1, 1]) {
              if (horiz) ctx.dbox(tt, (y0 + ys) / 2, sg * (half - 0.1 + PP / 2), wid, ys - y0, PP, CONC);
              else ctx.dbox(sg * (half - 0.1 + PP / 2), (y0 + ys) / 2, tt, PP, ys - y0, wid, CONC);
            }
          }
        }
        for (let k = 0; k <= solid; k++) {
          const a = y0 + k * FH - (k ? 0.46 : 0), b = Math.min(ys, y0 + k * FH + sillOff);
          if (b - a > 0.05) ctx.dbox(cx, (a + b) / 2, cz, w - 0.2 + PP * 2, b - a, d - 0.2 + PP * 2, CONC);
        }
        // THE OPEN TOP: two storeys of sky between four corner members
        const yt = ys + open * FH;
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          ctx.dbox(sx * (w / 2 - CW / 2), (ys + yt) / 2, sz * (d / 2 - CW / 2), CW, yt - ys, CW, CONC);
        }
        // the core standing up through the void (the lift and stair), slim
        const core = clamp(Math.min(w, d) * 0.3, 3, 9);
        ctx.dbox(cx, (ys + yt) / 2, cz, core, yt - ys, core, CONC_D);
        // the roof beam and slab over the void, and the cap
        ctx.dbox(cx, yt + 0.45, cz, w, 0.9, d, CONC);
        ctx.dbox(cx, yt + 1.0, cz, w - 0.6, 0.2, d - 0.6, CONC_D);
        ctx.lamp(-w / 2 + 0.6, yt + 1.25, -d / 2 + 0.6, 0.16, 0xff4a2a);
        ctx.lamp(w / 2 - 0.6, yt + 1.25, d / 2 - 0.6, 0.16, 0xff4a2a);
      }
    },
  });
})();
