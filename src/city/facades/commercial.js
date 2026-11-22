/* ============================================================
   city/facades/commercial.js — the low-rise commercial buildings the kit
   did not have: the car SHOWROOM and the service GARAGE.

   WHY. Every drive-in trade (the car dealer, the chop shop, a town's gas
   shop) was built as `dress: false`: the bare shell, a flat wall in one
   colour round a run of glass, a parapet of the same box, an empty roof.
   From across the road it read as a cardboard pavilion. These two grammars
   are what those buildings are in a real city.

   SHOWROOM ("Auto Showroom", a 1995-2020 franchise dealership)
     * the street front is the host's: floor-to-head glazing, the drive-in
       bay with its roller wound up, the glazed personnel door (makeBuilding
       keeps the ground storey of the door face clear for it, shellKeepClear)
     * over it: a flat steel CANOPY 1.6 m deep on the head of the glazing,
       a dark soffit under it, an aluminium edge on its lip
     * the ENTRY PORTAL: the franchise's raised brand wall, an aluminium
       composite (ACM) panel frame round the middle third of the front,
       standing 2.4 m over the roof in the trade colour, its panel joints cut
       0.6 m x 1.2 m; the trade's sign lives on the fascia under the canopy
     * flanks and back: insulated metal panel, a rib every 1.2 m, on a
       0.5 m concrete upstand; a clerestory ribbon of glass high on each
       flank (the host frames it as a real window); a closed service roller
       shutter in the back wall with its hood box, guides and bollards
     * roof: a metal-capped parapet, two packaged rooftop units on curbs with
       their fan grilles, a roof hatch

   GARAGE ("Service Garage", the independent repair / body shop)
     * painted concrete-block walls (a coursing joint every 0.4 m: the read
       of CMU from the street), a steel lintel over the drive-in bay
     * the parapet carries a painted sign band in the trade colour
     * small barred windows high in the flanks, a closed roller shutter on
       the back, downpipes at the corners, a mesh-fenced compressor pad
     * roof: an exhaust stack and a ventilator

   spec: { style: "showroom" | "garage", accent: hex (the trade's colour) }

   COST. Merged deco boxes like every grammar: a showroom is ~260 boxes,
   a garage ~200, all in the host's colour buckets (draw calls unchanged).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  // a closed roller shutter on face f centred at t: curtain, slats, guides,
  // hood box, two yellow bollards. Drawn standing on the wall (the wall is
  // solid behind it: a shut door is flat, which is exactly what it is).
  function shutter(ctx, F, f, t, W, H) {
    const SH = 0x8a9097, SL = 0x6c727a, HOOD = 0x5c6168;
    F.box(ctx, f, t, H / 2 + 0.05, W, H - 0.1, 0.06, SH);
    const n = Math.max(6, Math.round(H / 0.24));
    for (let i = 1; i < n; i++) F.box(ctx, f, t, 0.05 + (H - 0.1) * i / n, W - 0.04, 0.025, 0.08, SL);
    for (const sg of [-1, 1]) F.box(ctx, f, t + sg * (W / 2 + 0.06), H / 2, 0.12, H, 0.12, HOOD);
    F.box(ctx, f, t, H + 0.22, W + 0.4, 0.44, 0.4, HOOD);
    for (const sg of [-1, 1]) F.box(ctx, f, t + sg * (W / 2 + 0.45), 0.5, 0.18, 1.0, 0.18, 0xe0b81e, 0.25);
  }

  // a packaged rooftop unit on its curb: casing, condenser fan grilles
  function rtu(ctx, F, x, z, y, alongX, col) {
    const L = 2.4, Wd = 1.3, H = 1.1;
    const lx = alongX ? L : Wd, lz = alongX ? Wd : L;
    ctx.dbox(x, y + 0.15, z, lx + 0.2, 0.3, lz + 0.2, 0x5a5e63);             // curb
    ctx.dbox(x, y + 0.3 + H / 2, z, lx, H, lz, col);                          // casing
    for (const s of [-0.5, 0.5]) {
      const fx = alongX ? x + s * L * 0.45 : x, fz = alongX ? z : z + s * L * 0.45;
      ctx.dbox(fx, y + 0.3 + H + 0.04, fz, 0.8, 0.08, 0.8, 0x2b2e33);        // fan grille
    }
    ctx.dbox(alongX ? x : x + Wd / 2 + 0.02, y + 0.3 + H * 0.45, alongX ? z + Wd / 2 + 0.02 : z,
      alongX ? L * 0.7 : 0.04, H * 0.5, alongX ? 0.04 : L * 0.7, 0x7d8288);   // louvre panel
  }

  // where plant may stand on the roof: the back half of the slab, clear of
  // the middle (the host's lift / stair head lands near the slab centre)
  function roofSpots(ctx) {
    const R = { cx: ctx.slabCx || 0, cz: ctx.slabCz || 0, w: ctx.slabW || ctx.w - 0.6, d: ctx.slabD || ctx.d - 0.6 };
    const back = ctx.doorSide === 0 ? 1 : ctx.doorSide === 1 ? -1 : ctx.doorSide === 2 ? 1 : -1;
    const zAxis = ctx.doorSide === 0 || ctx.doorSide === 1;
    const out = [];
    const along = zAxis ? R.w : R.d, deep = zAxis ? R.d : R.w;
    const n = along > 20 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n - 0.5;
      const a = u * along * 0.8, b = back * deep * 0.27;
      out.push(zAxis ? { x: R.cx + a, z: R.cz + b, alongX: true } : { x: R.cx + b, z: R.cz + a, alongX: false });
    }
    return out;
  }

  CBZ.registerFacade("showroom", {
    label: "Auto Showroom",
    structure: "steel",
    crownsRoof: true,
    maxStoreys: 3,
    window: "steel",
    build: function (ctx, F, spec) {
      const FH = ctx.FH, ST = Math.max(1, ctx.storeys | 0), rTop = ctx.rTop;
      const accent = (spec && spec.accent != null) ? spec.accent : 0x2f5fa8;
      const PANEL = 0xc6cacd, PANEL_D = 0xa9aeb2, JOINT = 0x6f757b;
      const ALU = 0xd5d8da, DARK = 0x2b2f35, CONC = 0x9d9a93;
      F.windowFrame(ctx, 0x30353b);
      const GL = F.glass(ctx, 0x34404a);
      const df = F.face(ctx, ctx.doorSide);
      const SKIN = 0.05, BASEH = 0.7;
      // the parapet stands clear over the shell's own (ctx.pp tall + coping)
      const parTop = rTop + Math.max(1.0, (ctx.pp || 0.8) + 0.25);

      // ---- 1. the flanks and the back: ribbed metal panel on a concrete upstand
      for (const f of F.flanks(ctx)) {
        const back = (f.s ^ 1) === ctx.doorSide;
        const holes = [];
        // a clerestory ribbon high on each storey of a side wall
        if (!back) {
          for (let k = 0; k < ST; k++) {
            const y0 = k * FH + (k === 0 ? 1.9 : 1.0), y1 = k * FH + FH - 0.5;
            if (y1 - y0 < 0.5) continue;
            const n = Math.max(1, Math.floor((f.span - 3) / 3.6));
            for (const b of F.bays(f, n, 1.5)) holes.push({ t0: b.t - 1.35, t1: b.t + 1.35, y0: y0, y1: y1 });
          }
        }
        F.cladAround(ctx, f, BASEH, rTop, holes, SKIN, PANEL);
        for (const h of holes) F.box(ctx, f, (h.t0 + h.t1) / 2, (h.y0 + h.y1) / 2, h.t1 - h.t0, h.y1 - h.y0, 0.02, GL, -0.06);
        // ribs every 1.2 m, broken round the ribbon glass (every 3.6 m on a phone)
        const nR = Math.max(2, Math.round(f.span / (ctx.lite ? 3.6 : 1.2)));
        for (let i = 1; i < nR; i++) {
          const t = -f.span / 2 + i * f.span / nR;
          let y = BASEH;
          const cuts = holes.filter((h) => t > h.t0 - 0.05 && t < h.t1 + 0.05).sort((a, b) => a.y0 - b.y0);
          for (const h of cuts) { if (h.y0 - y > 0.1) F.rib(ctx, f, t, y, h.y0, 0.06, SKIN + 0.035, PANEL_D); y = h.y1; }
          if (rTop - y > 0.1) F.rib(ctx, f, t, y, rTop, 0.06, SKIN + 0.035, PANEL_D);
        }
        if (back && f.span > 8) shutter(ctx, F, f, f.span * 0.22, Math.min(4.2, f.span * 0.3), Math.min(FH - 0.3, 3.4));
      }
      F.ring(ctx, BASEH / 2, BASEH, 0.09, CONC, 0.18);              // the upstand / kerb
      for (const f of F.flanks(ctx)) for (let k = 1; k < ST; k++) F.band(ctx, f, k * FH, 0.14, SKIN + 0.05, PANEL_D, 0.1);

      // ---- 2. the street front over the glazing ------------------------
      // the upper storeys of a two-storey showroom: a ribbon of glass in panel
      for (let k = 1; k < ST; k++) {
        const y0 = k * FH + 0.7, y1 = k * FH + FH - 0.45;
        const holes = [{ t0: -df.span / 2 + 1.2, t1: df.span / 2 - 1.2, y0: y0, y1: y1 }];
        F.cladAround(ctx, df, k * FH, (k + 1) * FH, holes, SKIN, PANEL);
        F.box(ctx, df, 0, (y0 + y1) / 2, df.span - 2.4, y1 - y0, 0.02, GL, -0.06);
      }
      // the canopy: a steel blade on the head of the ground-storey glazing
      const cY = FH + 0.12, cD = 1.6;
      F.box(ctx, df, 0, cY, df.span + 0.2, 0.24, cD, ALU);
      F.box(ctx, df, 0, cY - 0.13, df.span + 0.1, 0.02, cD - 0.06, DARK);           // soffit
      F.box(ctx, df, 0, cY + 0.02, df.span + 0.26, 0.3, 0.06, F.shade(ALU, 0.82), cD - 0.02);   // lip
      // the fascia over the canopy, to the parapet top: panel with joints (on a
      // two-storey showroom it starts at the roof, over the upper ribbon)
      const fas0 = ST > 1 ? rTop : cY + 0.12;
      F.box(ctx, df, 0, (fas0 + parTop) / 2, df.span + 0.12, parTop - fas0, SKIN + 0.04, PANEL);
      // the entry portal: the brand wall round the middle third, over the roof
      const PW = Math.min(df.span * 0.42, 11), PH = parTop + 1.6, PP = 0.55;
      F.box(ctx, df, 0, (cY + 0.12 + PH) / 2, PW, PH - cY - 0.12, PP, accent);
      F.box(ctx, df, 0, PH + 0.06, PW + 0.12, 0.12, PP + 0.06, ALU);             // its coping
      // the dealer's name, upper half of the brand wall
      const sH = Math.min(1.3, (PH - cY) * 0.4);
      F.signPanel(ctx, df, PH - 0.35 - sH / 2, sH, PW - 1.4, PP + 0.03);
      for (const sg of [-1, 1]) F.rib(ctx, df, sg * (PW / 2 - 0.25), cY + 0.12, PH, 0.5, PP + 0.04, F.shade(accent, 0.8));
      // the ACM joints on the brand wall: horizontal every 0.6 m, vertical 1.2 m
      if (!ctx.lite) for (let y = cY + 0.12 + 0.6; y < PH - 0.2; y += 0.6) F.box(ctx, df, 0, y, PW - 1.0, 0.025, PP + 0.012, F.shade(accent, 0.62));
      const nV = Math.max(2, Math.round((PW - 1) / 1.2));
      if (!ctx.lite) for (let i = 1; i < nV; i++) F.rib(ctx, df, -(PW - 1) / 2 + i * (PW - 1) / nV, cY + 0.12, PH - 0.05, 0.025, PP + 0.012, F.shade(accent, 0.62));
      // the panel joints on the plain fascia either side of the portal
      if (!ctx.lite) for (const sg of [-1, 1]) {
        const a = PW / 2, b = df.span / 2;
        const n = Math.max(1, Math.round((b - a) / 1.2));
        for (let i = 1; i < n; i++) F.rib(ctx, df, sg * (a + i * (b - a) / n), fas0, parTop, 0.025, SKIN + 0.052, JOINT);
      }
      F.box(ctx, df, 0, (fas0 + parTop) / 2, df.span + 0.12, 0.025, SKIN + 0.052, JOINT);

      // ---- 3. the roof ---------------------------------------------------
      for (const f of F.flanks(ctx)) F.box(ctx, f, 0, (rTop + parTop) / 2, f.span + 0.24, parTop - rTop, 0.3, PANEL, -0.15);
      for (const f of F.faces(ctx)) F.box(ctx, f, 0, parTop + 0.05, f.span + 0.4, 0.1, 0.46, ALU, -0.2);
      for (const p of roofSpots(ctx)) rtu(ctx, F, p.x, p.z, rTop, p.alongX, 0xb9bcbf);
      // the corners finished in a dark aluminium angle, grade to coping
      F.corners(ctx, (parTop + BASEH) / 2, parTop - BASEH, 0.18, 0.1, DARK);
    },
  });

  CBZ.registerFacade("garage", {
    label: "Service Garage",
    structure: "masonry",
    crownsRoof: true,
    maxStoreys: 2,
    window: "industrial",
    build: function (ctx, F, spec) {
      const FH = ctx.FH, ST = Math.max(1, ctx.storeys | 0), rTop = ctx.rTop;
      const accent = (spec && spec.accent != null) ? spec.accent : 0xd0a23c;
      // the block is painted the street's wall colour: the host's own wall
      // between the bays at grade is that colour, and the two must be one wall
      const block = (ctx.pal && ctx.pal.wall) || ctx.color;
      const JOINT = F.shade(block, 0.8), STEEL = 0x3a3d40, DIRT = F.shade(block, 0.72);
      F.windowFrame(ctx, 0x2e3236);
      const GL = F.glass(ctx, 0x3a4248);
      const df = F.face(ctx, ctx.doorSide);
      const SKIN = 0.05, parH = Math.max(1.1, (ctx.pp || 0.8) + 0.3), parTop = rTop + parH;

      // ---- 1. block walls: flanks and back, barred windows high up -------
      for (const f of F.flanks(ctx)) {
        const back = (f.s ^ 1) === ctx.doorSide;
        const holes = [];
        if (!back) {
          const n = Math.max(1, Math.floor(f.span / 6));
          for (const b of F.bays(f, n, 2)) for (let k = 0; k < ST; k++) holes.push({ t0: b.t - 0.8, t1: b.t + 0.8, y0: k * FH + 1.9, y1: k * FH + FH - 0.45 });
        }
        F.cladAround(ctx, f, 0, parTop, holes, SKIN, block);
        for (const h of holes) {
          F.box(ctx, f, (h.t0 + h.t1) / 2, (h.y0 + h.y1) / 2, h.t1 - h.t0, h.y1 - h.y0, 0.02, GL, -0.06);
          if (!ctx.lite) for (let i = 1; i < 5; i++) F.rib(ctx, f, h.t0 + i * (h.t1 - h.t0) / 5, h.y0, h.y1, 0.03, SKIN + 0.04, STEEL);
          F.box(ctx, f, (h.t0 + h.t1) / 2, h.y0 - 0.06, h.t1 - h.t0 + 0.2, 0.12, SKIN + 0.07, F.shade(block, 0.9));
        }
        // coursing: a bed joint every 0.4 m, broken round the windows
        for (let y = 0.4; !ctx.lite && y < parTop - 0.15; y += 0.4) {
          const cuts = holes.filter((h) => y > h.y0 - 0.02 && y < h.y1 + 0.02).map((h) => [h.t0 - 0.02, h.t1 + 0.02]).sort((a, b) => a[0] - b[0]);
          let a = -f.span / 2;
          for (const c of cuts) { if (c[0] - a > 0.1) F.box(ctx, f, (a + c[0]) / 2, y, c[0] - a, 0.02, SKIN + 0.008, JOINT); a = c[1]; }
          if (f.span / 2 - a > 0.1) F.box(ctx, f, (a + f.span / 2) / 2, y, f.span / 2 - a, 0.02, SKIN + 0.008, JOINT);
        }
        if (back && f.span > 8) shutter(ctx, F, f, -f.span * 0.2, Math.min(3.6, f.span * 0.3), Math.min(FH - 0.3, 3.2));
        // the grime line at the foot of the wall
        F.box(ctx, f, 0, 0.35, f.span + 0.1, 0.7, 0.09, DIRT);
      }
      // ---- 2. the street front over the bay ------------------------------
      for (let k = 1; k < ST; k++) {
        const holes = F.openRow(ctx, df, F.bayCount(df, 3.2, 2, 8), 1.6, 1.2, k).map((o) => ({ t0: o.t0, t1: o.t1, y0: k * FH + 0.95, y1: k * FH + FH - 0.5 }));
        F.cladAround(ctx, df, k * FH, (k + 1) * FH, holes, SKIN, block);
        for (const h of holes) F.box(ctx, df, (h.t0 + h.t1) / 2, (h.y0 + h.y1) / 2, h.t1 - h.t0, h.y1 - h.y0, 0.02, GL, -0.06);
      }
      // a steel lintel over the whole ground storey front, the block over it
      F.box(ctx, df, 0, FH + 0.12, df.span + 0.1, 0.3, SKIN + 0.08, STEEL);
      F.box(ctx, df, 0, (rTop + parTop) / 2, df.span + 0.1, parH, SKIN, block);
      // the painted sign band on the parapet, in the trade's colour, the name on it
      F.box(ctx, df, 0, rTop + parH * 0.48, Math.min(df.span - 1.2, 16), parH * 0.7, SKIN + 0.02, accent);
      F.signPanel(ctx, df, rTop + parH * 0.48, parH * 0.6, Math.min(df.span - 1.2, 16) - 0.6, SKIN + 0.03);
      F.box(ctx, df, 0, rTop + parH * 0.48 - parH * 0.36, Math.min(df.span - 1.2, 16) + 0.1, 0.06, SKIN + 0.04, 0xe8e4da);
      F.box(ctx, df, 0, rTop + parH * 0.48 + parH * 0.36, Math.min(df.span - 1.2, 16) + 0.1, 0.06, SKIN + 0.04, 0xe8e4da);
      // ---- 3. parapet coping, downpipes, roof plant ----------------------
      for (const f of F.faces(ctx)) F.box(ctx, f, 0, parTop + 0.05, f.span + 0.3, 0.1, 0.36, F.shade(block, 0.78), -0.18);
      for (const f of F.flanks(ctx)) {
        for (const sg of [-1, 1]) {
          const t = sg * (f.span / 2 - 0.35);
          F.rib(ctx, f, t, 0.1, rTop + 0.2, 0.11, SKIN + 0.12, 0x5d6266);
          F.box(ctx, f, t, rTop + 0.28, 0.32, 0.22, SKIN + 0.3, 0x5d6266);     // the hopper head
        }
      }
      const sp = roofSpots(ctx);
      if (sp[0]) {
        const p = sp[0];
        ctx.dbox(p.x, rTop + 0.2, p.z, 1.2, 0.4, 1.2, 0x5a5e63);
        ctx.dbox(p.x, rTop + 1.6, p.z, 0.36, 2.8, 0.36, 0x6d7176);           // exhaust stack
        ctx.dbox(p.x, rTop + 3.05, p.z, 0.56, 0.1, 0.56, 0x45484c);           // its rain cap
      }
      if (sp[sp.length - 1] && sp.length > 1) {
        const p = sp[sp.length - 1];
        ctx.dbox(p.x, rTop + 0.35, p.z, 1.3, 0.7, 1.3, 0x8a8e93);              // ventilator
        ctx.dbox(p.x, rTop + 0.78, p.z, 1.5, 0.12, 1.5, 0x6d7176);
      }
    },
  });
})();
