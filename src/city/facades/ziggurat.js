/* ============================================================
   city/facades/ziggurat.js — "Zoning Setback Tower", New York 1916-1931.

   REFERENCES (2026-10 rewrite)
     The 1916 Zoning Resolution and the setback skyscraper it legislated:
       https://en.wikipedia.org/wiki/Art_Deco_in_the_United_States
       https://awedeco.com/stepped-forms-in-art-deco-architecture/
     The limestone-and-terracotta setback towers of the late 1920s (Chanin,
     Barclay-Vesey, Fuller), their heavy rusticated bases and temple tops:
       https://en.wikipedia.org/wiki/Chanin_Building
     Beaux-Arts base vocabulary (rusticated stone, arched openings, a
     dentilled cornice cutting the base from the shaft):
       https://www.ontarioarchitecture.com/Beauxarts.htm

   THE SHELL IS FIXED, SO THE SETBACKS ARE ON THE ROOF. The 2026-09 grammar
   faked the envelope with cladding collars standing up to 6.7 m proud of the
   walls: it spilled onto the footway (the lot allows 1 m) and it covered
   every window, so the host stamped all of them back in by force (525 of
   525 on a 12-storey tower). Now the shell is the shaft, the base is a real
   stone collar 0.5 m proud with real arched openings, and the wedding cake
   is three true stages above the roof line plus a temple.

   THE PROPORTIONS (metres)
     base              2 storeys (3 on a 16+ storey tower) of rusticated
                       limestone, 0.5 m proud, horizontal joints, one arched
                       opening per bay ~2.3 m wide, a dentilled cornice 0.9 m
                       tall / 0.75 m proud over it
     shaft             limestone piers 0.75 m wide, 0.24 m proud, on a 3.2 m
                       bay; a terracotta-toned spandrel 0.10 m proud behind
                       them at every floor line; windows a pair of steel
                       casements ~2.4 m wide, sill 0.75-0.85 m
     setbacks          three stages above the roof, 80 / 62 / 46 % of the
                       plan, heights 45 / 33 / 22 % of the crown: they arrive
                       faster as they rise, which is what reads as a building
                       obeying a rule and not a cake. Every step has a
                       parapet and a coping: a terrace, not a raw edge.
     temple            a stepped pyramidal cap (copper or stone) on the last
                       stage and a short mast. Crown total <= 25 % of height.

   PALETTE. The street colour, pulled toward Indiana limestone; terracotta
   panels; the temple roof copper verdigris or stone by seed.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function bayGrid(F, f, pitch, cornerW, pierW) {
    const n = F.bayCount(f, pitch, 1, 16);
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

  CBZ.registerFacade("ziggurat", {
    label: "Zoning Setback Tower",
    // WHAT IT IS MADE OF (city/collapse.js MATERIALS) — a setback tower is a reinforced-concrete frame.
    structure: "concrete",
    crownsRoof: true,
    minStoreys: 12,
    window: "deco",
    build: function (ctx, F, spec) {
      const FH = ctx.FH, H = ctx.rTop, ST = Math.max(1, ctx.storeys | 0);
      const faces = F.faces(ctx);
      const e = F.entrance(ctx);

      // ---------------- palette ----------------
      const STONE = F.mix(ctx.color, 0xc2b394, 0.5);
      const PIER = F.shade(STONE, 1.04);
      const BASEC = F.shade(STONE, 0.86);
      const JOINT = F.shade(STONE, 0.62);
      const TERRA = F.mix(STONE, 0xa0664a, 0.42);
      const ROOF = ctx.hash(0x2a1) < 0.55 ? 0x6f9a86 : F.shade(STONE, 0.92);   // copper, or stone
      const GLASSD = 0x232a30;
      F.windowFrame(ctx, ctx.hash(0x2a2) < 0.5 ? 0x2b3a34 : 0x1e2124);

      const PITCH = 3.2, PW = 0.75, PP = 0.24, CW = 1.3, SP = 0.10;
      // the collar's depth: none on a host that paints its own wall (a metro
      // hands in ctx.grid and F.cladAround lays nothing there), so the
      // lintels and sills sit on that wall instead of floating 0.5 m off it
      const BP = ctx.grid ? 0 : 0.5;
      const sillOff = FH >= 3.6 ? 0.85 : 0.75;
      const sill = (k) => k * FH + sillOff, head = (k) => (k + 1) * FH - 0.46;
      const nb = ST >= 16 ? 3 : 2;
      const yBase = nb * FH;

      for (const f of faces) {
        const isDoor = f.s === ctx.doorSide;
        const g = bayGrid(F, f, PITCH, CW, PW);

        // ================= 1. THE BASE COLLAR ======================
        for (let k = 0; k < nb; k++) {
          const y0 = k * FH, y1 = k === nb - 1 ? head(k) : (k + 1) * FH;
          const sl = k === 0 ? 0.62 : sill(k);
          const holes = [];
          for (const b of g.bays) {
            if (k === 0 && isDoor && !F.clearsDoor(ctx, f, b.t, b.w)) continue;
            const ww = Math.min(2.3, b.w - 0.3);
            holes.push({ t0: b.t - ww / 2, t1: b.t + ww / 2, y0: sl, y1: head(k) - 0.3 });
          }
          // the stone skin of the storey, round its openings
          F.cladAround(ctx, f, y0, y1, holes, BP, BASEC);
          // rustication: one channelled joint at the storey line, a recessed
          // course 2 cm behind the skin (one box per face per storey)
          if (k > 0 && BP > 0) F.band(ctx, f, y0 + 0.04, 0.05, BP + 0.012, JOINT, BP);
          // a lintel with a keystone over each opening, a stone sill (the skin is the jamb)
          for (const h of holes) {
            F.surround(ctx, f, h.t0, h.t1, h.y0, h.y1, { w: 0.2, proj: BP + 0.07, col: PIER, head: "key", jambs: false,
              headH: 0.26, keyCol: F.shade(PIER, 1.06), sill: { h: 0.12, proj: BP + 0.1, over: 0.12, col: PIER } });
          }
        }
        // the base cornice, dentilled, in the spandrel over the base
        F.cornice(ctx, head(nb - 1), { h: 0.9, proj: 0.75, col: PIER, dark: JOINT, teeth: "modillion", frieze: 0.2, faces: [f.s] });

        // ================= 2. THE SHAFT ============================
        for (const sg of [-1, 1]) F.rib(ctx, f, sg * (f.span / 2 - CW / 2), yBase, H + 1.0, CW, PP, PIER);
        for (const t of g.lines) F.rib(ctx, f, t, yBase, H + 1.0, PW, PP, PIER);
        for (let k = nb + 1; k <= ST; k++) {
          const y0 = head(k - 1), y1 = k === ST ? H + 1.0 : sill(k);
          if (y1 - y0 < 0.05) continue;
          F.band(ctx, f, (y0 + y1) / 2, y1 - y0, SP, TERRA, SP * 2);
          // terracotta panels over the base and under the roof
          if ((k === nb + 1 || k === ST - 1) && y1 - y0 > 0.7) {
            for (const b of g.bays) {
              F.box(ctx, f, b.t, (y0 + y1) / 2, b.w - 0.4, y1 - y0 - 0.32, SP + 0.04, F.shade(TERRA, 1.12));
              F.box(ctx, f, b.t, (y0 + y1) / 2, (b.w - 0.4) * 0.36, (y1 - y0 - 0.32) * 0.5, SP + 0.07, F.shade(TERRA, 0.85));
            }
          }
        }
        // the lowest shaft band sits on the cornice
        F.band(ctx, f, (head(nb - 1) + 0.9 + sill(nb)) / 2, Math.max(0.05, sill(nb) - head(nb - 1) - 0.9), SP, TERRA, SP * 2);
      }

      // ---- THE ENTRANCE: an arched stone doorcase in the collar ------------
      if (!ctx.noDoor && !e.driveIn) {
        const f = e.f, hw = 1.25, top = Math.min(head(0) + 0.1, 3.4);
        for (const sg of [-1, 1]) F.rib(ctx, f, sg * (hw + 0.2), 0, top, 0.4, BP + 0.22, PIER);
        F.arch(ctx, f, 0, top, hw * 2, 0.5, 0.3, BP + 0.22, PIER, "segmental");
        F.box(ctx, f, 0, top + 0.42, 0.36, 0.62, BP + 0.28, F.shade(PIER, 1.06));
      }

      // ================= 3. THE PARAPET AT THE ROOF =================
      F.ring(ctx, H + 1.06, 0.14, PP + 0.06, F.shade(PIER, 1.05), 0.4);

      // ================= 4. THE SETBACKS + TEMPLE ===================
      // the budget: 25 % of the height for stages + temple + mast
      const roofH0 = Math.min(H * 0.035, 6), mh = Math.min(H * 0.012 + 1.2, 3.5);
      let budget = H * 0.25 - 1.13 - roofH0 - mh;
      const plan = [0.80, 0.62, 0.46], split = [0.45, 0.33, 0.22];
      const B = Math.max(0, budget);
      let sy = H + 1.13;
      let lastW = ctx.slabW, lastD = ctx.slabD;
      const cx = ctx.slabCx, cz = ctx.slabCz;
      for (let i = 0; i < 3; i++) {
        const nw = ctx.slabW * plan[i], nd = ctx.slabD * plan[i];
        if (nw < 2.2 || nd < 2.2) break;
        let nst = Math.max(1, Math.floor(B * split[i] / FH + 0.4));
        while (nst > 1 && nst * FH + 1.02 > budget) nst--;
        if (nst * FH + 1.02 > budget + 0.5) break;
        budget -= nst * FH + 1.02;
        const sh = nst * FH;
        // the glazed stage, its piers, its floor bands
        ctx.dbox(cx, sy + sh / 2, cz, nw, sh, nd, GLASSD);
        const px = Math.max(2, Math.round(nw / PITCH)), pz = Math.max(2, Math.round(nd / PITCH));
        for (let k = 0; k <= px; k++) {
          const x = cx - nw / 2 + nw * k / px, pw = (k === 0 || k === px) ? 1.0 : PW;
          for (const sg of [-1, 1]) ctx.dbox(x, sy + sh / 2, cz + sg * (nd / 2 + PP / 2), pw, sh, PP, PIER);
        }
        for (let k = 0; k <= pz; k++) {
          const z = cz - nd / 2 + nd * k / pz, pw = (k === 0 || k === pz) ? 1.0 : PW;
          for (const sg of [-1, 1]) ctx.dbox(cx + sg * (nw / 2 + PP / 2), sy + sh / 2, z, PP, sh, pw, PIER);
        }
        for (let k = 0; k < nst; k++) {
          const y0 = sy + k * FH - (k ? 0.46 : 0), y1 = sy + k * FH + sillOff;
          ctx.dbox(cx, (y0 + y1) / 2, cz, nw + SP * 2, y1 - y0, nd + SP * 2, TERRA);
        }
        // its parapet and coping: the terrace edge of the next step up
        const ty = sy + sh;
        ctx.dbox(cx, ty + 0.45, cz, nw + SP * 2, 0.9, nd + SP * 2, PIER);
        ctx.dbox(cx, ty + 0.95, cz, nw + PP * 2 + 0.1, 0.14, nd + PP * 2 + 0.1, F.shade(PIER, 1.05));
        // a cornice band oversailing the step: the shadow line under it
        ctx.dbox(cx, ty - 0.12, cz, nw + PP * 2 + 0.3, 0.24, nd + PP * 2 + 0.3, F.shade(PIER, 0.9));
        sy = ty + 1.02; lastW = nw; lastD = nd;
      }
      // the temple: a stepped pyramidal roof on the last stage
      const roofH = Math.min(roofH0, Math.max(lastW, lastD) * 0.45);
      const top = F.ziggurat(ctx, cx, cz, sy, lastW * 0.92, lastD * 0.92, roofH, 5, ROOF, 0.78, 0.03);
      ctx.dbox(cx, top + mh / 2, cz, 0.3, mh, 0.3, F.shade(PIER, 0.8));
      ctx.lamp(cx, top + mh + 0.15, cz, 0.16, 0xffd08a);
    },
  });
})();
