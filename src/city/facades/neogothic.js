/* ============================================================
   city/facades/neogothic.js — "Cathedral of Commerce": the gothic
   SKYSCRAPER (Cass Gilbert's Woolworth Building, 1913; the Tribune Tower).

   REFERENCES:
     Woolworth Building (Wikipedia: limestone base, cream terracotta above,
       piers running base to top, a copper crown)
       https://en.wikipedia.org/wiki/Woolworth_Building
     NYC Urbanism, "Woolworth's 7,500 tons of ornamental terra cotta"
       https://www.nycurbanism.com/blog/2020/5/30/woolworths-7500-tons-of-ornamental-terra-cotta
     AD Classics: Woolworth Building / Cass Gilbert
       https://www.archdaily.com/477187/ad-classics-woolworth-building-cass-gilbert
     NYC architecture images, the Woolworth Building
       https://www.nyc-architecture.com/scc/scc019.html

   THE READ: piers that run from the podium to the crown "with few
   interruptions from cornices or the window spandrels", the floors existing
   only as recessed spandrel panels between them, a richer podium a player
   touches, and a crown of setbacks, turrets and a copper spire.

   THE NUMBERS.
     podium      3 storeys (2 on a low tower) of limestone, a lobby storey of
                 tall plate glass behind 0.9 m piers, a pointed portal of three
                 orders, a crocketed cornice 0.7 m proud.
     bays        4.2-4.8 m, a MAIN PIER on every bay line (0.8 m wide, 0.36 m
                 proud) and a slim MULLION PIER at mid-bay (0.32 m, 0.18 m
                 proud): two windows per bay, each ~1.4-1.6 m wide.
     spandrels   0.06 m skin, one band per storey per face, a shade darker
                 than the piers so the piers stay in front; a thin terracotta
                 sill line in each.
     transition  a corbelled band and a cornice under the crown.
     crown       <= 22% of the tower's height: two setback stages with corner
                 turrets and pinnacles, then a stepped copper (verdigris
                 0x5f8a78) pyramid and a finial. Kept on the lift's deck logic
                 (the kit probes it).
     colour      cream terracotta 0xd8cdb4 mixed off the street colour,
                 graduated paler in three zones up the shaft (Gilbert made the
                 top lighter so it looks further away), limestone podium.

   VARIATION BY SEED: verdigris or slate crown; three pier tones; crown
   stage proportions; the window frames.

   COST. Piers and mullion piers are ONE box each for the whole shaft; a
   storey costs two boxes per face (spandrel band + sill line). Colours are
   three zones, not one per storey (each colour is a merged mesh).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  function point(ctx, F, f, t, y, W, rise, proj, col) {
    for (let i = 0; i < 3; i++) {
      const u = (i + 0.5) / 3;
      F.box(ctx, f, t, y + u * rise, Math.max(0.1, W * (1 - u * 0.82)), rise / 3 + 0.02, proj, col);
    }
  }

  CBZ.registerFacade("neogothic", {
    label: "Cathedral of Commerce",
    // WHAT IT IS MADE OF (city/collapse.js MATERIALS) — a steel frame in terracotta fancy dress.
    structure: "steel",
    crownsRoof: true,
    minStoreys: 18,
    window: "sash",
    build: function (ctx, F, spec) {
      const FH = ctx.FH, ST = Math.max(1, ctx.storeys | 0), H = ctx.rTop;
      const grid = !!ctx.grid;
      const df = F.face(ctx, ctx.doorSide);

      // ---- palette ----------------------------------------------------
      const TERRA = F.mix(ctx.color, 0xd8cdb4, 0.6);
      const ZONE = [F.shade(TERRA, 0.94), TERRA, F.mix(TERRA, 0xeee8da, 0.35)];
      const zoneOf = (y) => ZONE[Math.min(2, Math.max(0, Math.floor((y / H) * 3)))];
      const SPAN = F.shade(TERRA, 0.8);              // spandrel panels, held back
      const LIME = F.mix(ctx.color, 0xc4bba5, 0.5);  // the podium
      const DARK = F.shade(LIME, 0.55);
      const copper = ctx.hash(0x4e06) < 0.65;
      const ROOF = copper ? 0x5f8a78 : 0x4a4f55;
      F.windowFrame(ctx, [0x2f3a33, 0x3b2a22, 0x2a2724][(ctx.hash(0x4e07) * 3) | 0]);
      for (let s = 0; s < 4; s++) F.windowStyle(ctx, s, 0, "lobby");

      const podST = ST >= 24 ? 3 : 2;
      const podY = podST * FH;
      const crownH = Math.min(H * 0.22, 44);
      const transY = H - 0.44;                       // the transition band sits on the last window head
      const SKIN = 0.06, PIER = 0.36, PW = 0.8, MP = 0.18, MW = 0.32;
      const BAY = 4.5;

      // ============================================================
      //  1. THE FACES: podium, piers, spandrels
      // ============================================================
      const plan = [];
      for (const f of F.faces(ctx)) {
        const n = F.bayCount(f, BAY, 2, 12);
        const margin = Math.max(0.9, Math.min(1.6, f.span * 0.05));
        const bays = F.bays(f, n, margin);
        const lines = F.bayLines(f, n, margin);
        const step = bays.length ? bays[0].w : f.span;
        const isDoor = f.s === ctx.doorSide;
        plan.push({ f: f, lines: lines });
        // the two windows of every bay: the strips of wall between them
        const cols = [];
        for (const b of bays) {
          const half = (step - PW - MW) / 2;
          cols.push([b.t - MW / 2 - half, b.t - MW / 2], [b.t + MW / 2, b.t + MW / 2 + half]);
        }

        // ---- the shaft skin: wall strips between the windows, full height,
        // plus one spandrel band per storey (the openings are what is left)
        if (!grid) {
          let a = -f.span / 2 - SKIN;
          const y0 = podY, y1 = transY;
          for (const c of cols) {
            if (c[0] - a > 0.02) F.box(ctx, f, (a + c[0]) / 2, (y0 + y1) / 2, c[0] - a, y1 - y0, SKIN, SPAN);
            a = c[1];
          }
          if (f.span / 2 + SKIN - a > 0.02) F.box(ctx, f, (a + f.span / 2 + SKIN) / 2, (y0 + y1) / 2, f.span / 2 + SKIN - a, y1 - y0, SKIN, SPAN);
          let prev = y0;
          for (let k = podST; k < ST; k++) {
            const S = F.storey(ctx, k);
            if (S.head > transY) break;
            if (S.sill - prev > 0.02) F.band(ctx, f, (prev + S.sill) / 2, S.sill - prev, SKIN, SPAN, SKIN * 2);
            F.band(ctx, f, S.sill - 0.05, 0.1, SKIN + 0.05, ZONE[1], 0.1);       // the terracotta sill line
            prev = S.head;
          }
          if (transY - prev > 0.02) F.band(ctx, f, (prev + transY) / 2, transY - prev, SKIN, SPAN, SKIN * 2);
        }

        // ---- the piers: podium to the transition, one box per zone ----
        for (let z = 0; z < 3; z++) {
          const za = Math.max(podY, (H * z) / 3), zb = Math.min(transY, (H * (z + 1)) / 3);
          if (zb - za < 0.2) continue;
          for (const t of lines) F.rib(ctx, f, t, za, zb, PW, PIER, ZONE[z]);
          for (const b of bays) F.rib(ctx, f, b.t, za, zb, MW, MP, ZONE[z]);
        }

        // ---- the podium -------------------------------------------------
        // the lobby: tall glazing between podium piers, a pointed head over
        // each opening of the first upper storey, a limestone skin
        const ph = [];
        for (let k = 0; k < podST; k++) {
          const S = F.storey(ctx, k, k === 0 ? 0.6 : undefined);
          for (const b of bays) {
            if (k === 0 && isDoor && !F.clearsDoor(ctx, f, b.t, 3.2)) continue;
            const w = k === 0 ? step - PW - 0.5 : Math.min(2.0, step - PW - 1.0);
            ph.push({ t0: b.t - w / 2, t1: b.t + w / 2, y0: S.sill, y1: S.head, k: k, t: b.t });
          }
        }
        F.cladAround(ctx, f, 0.7, podY, ph, SKIN + 0.02, LIME);
        for (const t of lines) {
          if (isDoor && !F.clearsDoor(ctx, f, t, PW + 2.4)) continue;
          F.rib(ctx, f, t, 0, podY, PW + 0.1, PIER + 0.06, LIME);
        }
        for (const h of ph) {
          if (h.k === podST - 1) point(ctx, F, f, h.t, h.y1, h.t1 - h.t0 + 0.2, Math.min(0.42, (FH - 0.46 - 0.3)), SKIN + 0.08, F.shade(LIME, 1.08));
          F.box(ctx, f, h.t, h.y0 - 0.06, h.t1 - h.t0 + 0.24, 0.12, SKIN + 0.1, F.shade(LIME, 1.08));
        }
      }
      // podium plinth and the crocketed podium cornice
      F.ring(ctx, 0.35, 0.7, SKIN + 0.14, F.shade(LIME, 0.78), 0.3);
      F.cornice(ctx, podY - 0.55, { h: 0.85, proj: 0.7, col: F.shade(LIME, 1.08), dark: DARK, frieze: 0.25, teeth: "corbel" });
      for (const p of plan) F.merlons(ctx, p.f, podY + 0.5, Math.max(6, Math.round(p.f.span / 1.1)), 0.18, 0.36, 0.5, F.shade(LIME, 1.08));

      // ---- the portal: three receding pointed orders and a gable -------
      {
        const DW = ctx.doorW || F.DOOR_W, DH = ctx.doorH || F.DOOR_H;
        const spring = DH + 0.1, rise = Math.min(1.6, FH * 0.5);
        for (let i = 0; i < 3; i++) {
          const hw = DW / 2 + 0.2 + i * 0.3, pj = 0.25 + i * 0.14;
          const col = i === 1 ? DARK : F.shade(LIME, 1.04);
          for (const sg of [-1, 1]) F.rib(ctx, df, sg * (hw + 0.15), 0, spring, 0.3, pj, col);
          point(ctx, F, df, 0, spring, hw * 2 + 0.6, rise + i * 0.2, pj, col);
        }
        point(ctx, F, df, 0, spring, DW + 0.4, rise - 0.1, 0.16, DARK);
        const gw = DW + 2.0, gy = spring + rise * 0.6, gh = rise + 0.5;
        for (let s = 0; s < 4; s++) {
          const u = (s + 0.5) / 4;
          F.box(ctx, df, 0, gy + u * gh, gw * (1 - u * 0.85), gh / 4 + 0.02, 0.7, F.shade(LIME, 1.08));
        }
        F.box(ctx, df, 0, gy + gh + 0.3, 0.24, 0.6, 0.74, F.shade(LIME, 1.08));
      }

      // ============================================================
      //  2. THE TRANSITION: corbels, a cornice, pier pinnacles
      // ============================================================
      F.cornice(ctx, transY, { h: 1.5, proj: 0.6, col: ZONE[2], dark: F.shade(ZONE[2], 0.62), frieze: 0.3, teeth: "corbel" });
      if (!grid) for (const p of plan) for (const t of p.lines) {
        F.box(ctx, p.f, t, H + 0.9, 0.5, 1.4, 0.3, ZONE[2], 0);
        for (let s = 0; s < 3; s++) F.box(ctx, p.f, t, H + 1.75 + s * 0.3, 0.38 - s * 0.1, 0.32, 0.24 - s * 0.05, ZONE[2], 0.02 + s * 0.03);
      }

      // ============================================================
      //  3. THE CROWN: two setback stages, turrets, a copper spire
      // ============================================================
      {
        const R = F.roof(ctx);
        let sw = ctx.slabW, sd = ctx.slabD, y = H;
        const stages = [[0.8 + ctx.hash(0x4e08) * 0.06, 0.38], [0.58 + ctx.hash(0x4e09) * 0.06, 0.32]];
        for (const [k, frac] of stages) {
          const w = sw * k, d = sd * k, h = crownH * frac;
          if (w < 3 || d < 3) break;
          ctx.dbox(R.cx, y + h / 2, R.cz, w, h, d, ZONE[2]);
          // its piers, one box each face
          const np = Math.max(2, Math.round(w / 3.2)), nd = Math.max(2, Math.round(d / 3.2));
          for (let i = 0; i <= np; i++) for (const sg of [-1, 1]) ctx.dbox(R.cx - w / 2 + (w / np) * i, y + h / 2, R.cz + sg * (d / 2 + 0.15), 0.5, h, 0.3, F.shade(ZONE[2], 1.04));
          for (let i = 0; i <= nd; i++) for (const sg of [-1, 1]) ctx.dbox(R.cx + sg * (w / 2 + 0.15), y + h / 2, R.cz - d / 2 + (d / nd) * i, 0.3, h, 0.5, F.shade(ZONE[2], 1.04));
          // dark lancet slots on each face of the stage
          const lh = h * 0.55;
          for (const sg of [-1, 1]) {
            ctx.dbox(R.cx, y + h * 0.5, R.cz + sg * (d / 2 + 0.02), w * 0.5, lh, 0.06, F.shade(ZONE[2], 0.45));
            ctx.dbox(R.cx + sg * (w / 2 + 0.02), y + h * 0.5, R.cz, 0.06, lh, d * 0.5, F.shade(ZONE[2], 0.45));
          }
          // corner turrets with pinnacles
          const tw = Math.min(1.8, w * 0.12);
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
            const tx = R.cx + sx * (w / 2 - tw / 2), tz = R.cz + sz * (d / 2 - tw / 2);
            ctx.dbox(tx, y + h / 2 + 0.6, tz, tw, h + 1.2, tw, ZONE[2]);
            let py = y + h + 1.2, pw = tw * 0.8;
            for (let s = 0; s < 4; s++) { ctx.dbox(tx, py + 0.5, tz, pw, 1.0, pw, s % 2 ? ROOF : ZONE[2]); py += 1.0; pw *= 0.68; }
          }
          ctx.dbox(R.cx, y + h + 0.15, R.cz, w + 0.5, 0.3, d + 0.5, F.shade(ZONE[2], 0.86));
          y += h + 0.3; sw = w; sd = d;
        }
        // the copper pyramid, stepped, and a finial
        const top = F.ziggurat(ctx, R.cx, R.cz, y, sw * 0.9, sd * 0.9, crownH * 0.26, 7, ROOF, 0.8, 0);
        ctx.dbox(R.cx, top + 1.2, R.cz, 0.3, 2.4, 0.3, 0xb89a4a);
        ctx.lamp(R.cx, top + 2.5, R.cz, 0.18, 0xffd08a);
      }
    },
  });
})();
