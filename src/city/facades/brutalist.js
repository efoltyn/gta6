/* ============================================================
   city/facades/brutalist.js — "Beton Brut", 1962-1975.

   REFERENCES
     Boston City Hall (Kallmann McKinnell & Knowles, 1968): cast-in-place and
       precast concrete, ~22,000 precast pieces; the upper storeys are a
       standard window pattern separated by PAIRS of precast fins; the top
       tiers cantilever out over the lower ones; the ground is recessed.
       https://en.wikipedia.org/wiki/Boston_City_Hall
       https://www.boston.gov/sites/default/files/file/2024/11/224.07%20Boston%20City%20Hall%20final%20report%20November%202024.pdf
       https://www.docomomo-us.org/register/boston-city-hall
     Barbican / the 1970 municipal office block: the same vocabulary at
       street scale — a floor-edge beam on every slab, deep reveals, a heavy
       roof fascia, a service tower expressed on the roof.

   THE PROPORTIONS USED (metres, never scaled off the building)
     bay pitch          2.4 m (+-0.15 by seed): one tall window per bay
     window             bay - 0.95 m wide (~1.45), sill 0.8 m, head FH-0.48
     fin pair           two 0.26 m blades, 0.22 m apart, on every bay line,
                        standing 0.82 m off the wall (0.48 m past the skin)
     reveal             the wall skin is 0.34 m thick round every window,
                        plus the shell's own 0.34 m frame set-back: ~0.7 m of
                        concrete between the street and the glass
     floor-edge beam    0.32 m deep band at every floor line, 0.42 m proud
     ground storey      thin skin, storey-high lobby glass behind 0.55 m
                        piers standing 0.72 m proud: the mass above reads as
                        carried, the base as recessed
     attic              the top 1-2 storeys: skin 0.62 m thick (it
                        cantilevers 0.28 m past the shaft), slot windows
                        0.8 m on a 1.5 m pitch — City Hall's dense top tiers
     fascia + parapet   a 0.6 m concrete fascia 0.72 m proud, a 0.9 m parapet
     service tower      a blind concrete block on the roof, ~3.2 m tall

   COLOUR: raw concrete from the street's own colour (Southside / Dockyard
   hand in 0x8c8983 / 0x77746c), pulled toward one of three real mixes:
   grey Portland, warm buff aggregate, cool blue-grey. Fins catch the light a
   shade up, the floor beams and soffits a shade down.

   COST: the skin is one F.cladAround per band (spandrel + piers per storey),
   the fins and corner piers are single full-height runs, the floor beams one
   ring per storey. No real meshes. Fewer boxes than the 2025 version at
   every size.

   METROS (ctx.grid): the skin is not laid (the fabric paints its own wall
   and windows); the fins, beams, piers, attic ribs and fascia still land on
   the fabric's own bay lines, which is the whole brutalist read.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  CBZ.registerFacade("brutalist", {
    label: "Beton Brut",
    // WHAT IT IS MADE OF (city/collapse.js MATERIALS)
    structure: "concrete",
    crownsRoof: true,
    // the window: a dark anodised frame deep in a concrete reveal, no sill
    window: "deep",
    build: function (ctx, F, spec) {
      const FH = ctx.FH, ST = Math.max(1, ctx.storeys | 0), H = ctx.rTop;
      const mixes = [0x8e8a83, 0x9b9484, 0x858a8e];
      const C = F.mix(ctx.color, mixes[(ctx.hash(0xb701) * 3) | 0], 0.45);
      const CL = F.shade(C, 1.08);           // fin faces
      const CD = F.shade(C, 0.84);           // floor beams, ground skin
      const CS = F.shade(C, 0.62);           // soffits, shadow lines
      F.windowFrame(ctx, [0x26231f, 0x3a3631, 0x5b5c5a][(ctx.hash(0xb702) * 3) | 0]);

      const CLAD = 0.34, FIN = 0.82, ATT = 0.62, PIER = 0.72;
      const MARG = 0.7;
      const PITCH = 2.4 + (ctx.hash(0xb703) - 0.5) * 0.3;
      const ground = ST >= 2 ? 1 : 0;        // storeys in the recessed base
      const attic = ST >= 6 ? 2 : ST >= 3 ? 1 : 0;
      const kAt = ST - attic;                // first attic storey
      const yUp = ground * FH, yAt = kAt * FH;
      const ent = F.entrance(ctx);

      for (const f of F.faces(ctx)) {
        const n = F.bayCount(f, PITCH, 2, 30);
        const lines = F.bayLines(f, n, MARG);
        const bays = F.bays(f, n, MARG);
        const step = bays.length ? bays[0].w : f.span;
        const door = f.s === ctx.doorSide;

        // ---- 1. THE RECESSED BASE: lobby glass behind heavy piers --------
        if (ground) {
          const S = F.storey(ctx, 0, 0.56);
          const row = F.openRow(ctx, f, n, step - 0.8, MARG, 0);
          F.windowStyle(ctx, f.s, 0, "lobby");
          F.cladAround(ctx, f, 0, FH, row.map((r) => ({ t0: r.t0, t1: r.t1, y0: S.sill, y1: S.head })), 0.06, CD);
          for (const t of lines) {
            if (!F.clearsDoor(ctx, f, t, 0.55 + 0.5)) continue;
            F.rib(ctx, f, t, 0, yUp, 0.55, PIER, C);
          }
        }

        // ---- 2. THE SHAFT: deep reveals between fin pairs ---------------
        if (yAt > yUp) {
          const holes = [];
          for (let k = ground; k < kAt; k++) {
            const S = F.storey(ctx, k, 0.8);
            for (const r of F.openRow(ctx, f, n, step - 0.95, MARG, k)) holes.push({ t0: r.t0, t1: r.t1, y0: S.sill, y1: S.head });
          }
          F.cladAround(ctx, f, yUp, yAt, holes, CLAD, C);
          // the fin pairs, one full-height run per blade
          for (let i = 1; i < lines.length - 1; i++) {
            const t = lines[i];
            const y0 = (ground === 0 && !F.clearsDoor(ctx, f, t, 0.8)) ? ent.head + 0.4 : yUp;
            for (const sg of [-1, 1]) F.rib(ctx, f, t + sg * 0.24, y0, yAt, 0.26, FIN, CL);
          }
          // floor-edge beams: the slab shown at the face, every storey
          for (let k = ground; k < kAt; k++) {
            if (k === 0) continue;
            F.band(ctx, f, k * FH + 0.12, 0.32, CLAD + 0.08, CD, CLAD + 0.08);
          }
        }

        // ---- 3. THE CORNER PIERS: the mass reads as solid at the arris ---
        for (const sg of [-1, 1]) {
          const t = sg * (f.span / 2 - MARG / 2);
          F.rib(ctx, f, t, 0, yAt, MARG, ground ? PIER : FIN, C);
        }

        // ---- 4. THE ATTIC: the heavier cantilevered mass ----------------
        if (attic) {
          const nA = F.bayCount(f, 1.5, 3, 60);
          const holes = [];
          for (let k = kAt; k < ST; k++) {
            const S = F.storey(ctx, k, 0.9);
            for (const r of F.openRow(ctx, f, nA, 0.8, MARG, k)) holes.push({ t0: r.t0, t1: r.t1, y0: S.sill, y1: S.head });
          }
          F.cladAround(ctx, f, yAt, H, holes, ATT, CL);
          if (ctx.grid) for (const t of F.bayLines(f, nA, MARG)) F.rib(ctx, f, t, yAt, H, 0.5, ATT, CL);
          // the shadow line where it oversails the shaft
          F.band(ctx, f, yAt + 0.07, 0.14, ATT + 0.03, CS, ATT + 0.03);
        }

        // ---- 5. THE ENTRANCE: a deep concrete portal ---------------------
        if (door && !ent.driveIn && ST >= 2) {
          const hw = 2.25;
          for (const sg of [-1, 1]) F.rib(ctx, f, sg * hw, 0, FH, 0.5, 1.15, C);
          F.box(ctx, f, 0, FH + 0.12, hw * 2 + 0.5, 0.62, 1.15, CD);
          F.box(ctx, f, 0, FH - 0.24, hw * 2 - 0.5, 0.1, 1.05, CS);
        }
      }

      // ---- 6. FASCIA, PARAPET, SERVICE TOWER ------------------------------
      F.ring(ctx, H - 0.1, 0.6, ATT + 0.1, C, ATT + 0.1);
      F.parapet(ctx, 0.9, 0.3, C, CD);
      if (ST >= 3) {
        const R = F.roof(ctx);
        const bw = Math.min(6.5, Math.max(2.4, R.w * 0.28)), bd = Math.min(5.0, Math.max(2.4, R.d * 0.26));
        const sx = ctx.hash(0xb704) < 0.5 ? -1 : 1, sz = ctx.hash(0xb705) < 0.5 ? -1 : 1;
        const x = R.cx + sx * (R.w / 2 - bw / 2 - 0.9), z = R.cz + sz * (R.d / 2 - bd / 2 - 0.9);
        const th = 3.2;
        ctx.dbox(x, H + th / 2, z, bw, th, bd, C);
        ctx.dbox(x, H + th - 0.25, z, bw + 0.3, 0.5, bd + 0.3, CD);
        // a louvre slot on the street side
        ctx.dbox(x, H + th * 0.55, z + sz * -0.01, bw * 0.7, 0.8, bd + 0.06, CS);
      }
    },
  });
})();
