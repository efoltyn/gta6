/* ============================================================
   city/facades/mosque.js — "Grand Mosque", the congregational mosque
   (Ottoman classical, with a Cairene variant).

   REFERENCES
     Sultan Ahmed (Blue) Mosque: central dome on semi-domes, six minarets
       64 m, courtyard arcades.  https://en.wikipedia.org/wiki/Blue_Mosque,_Istanbul
     Uc Serefeli Mosque, Edirne: minarets to 67 m with three serefe
       balconies.  https://en.wikipedia.org/wiki/%C3%9C%C3%A7_%C5%9Eerefeli_Mosque
     Sokollu Mehmed Pasha Mosque (Sinan): a neighbourhood mosque — one
       minaret, a dome on an octagonal drum with arched windows, a domed
       portico (son cemaat yeri) on slim columns in front of the door.
       https://en.wikipedia.org/wiki/Sokollu_Mehmed_Pasha_Mosque,_Kad%C4%B1rga
     Umayyad Mosque: arcades (riwaq) of alternating columns and piers round
       the court.  https://en.wikipedia.org/wiki/Umayyad_Mosque

   THE PROPORTIONS USED (metres)
     prayer hall      the host shell; walls in cut stone or whitewash
     windows          two tiers, one per 3.0 m bay, 1.1 m wide, sill 0.9 m,
                      a pointed head rising 0.55 x width with a dark glazed
                      tympanum inside a stone voussoir ring
     riwaq            on the entrance face: slim columns 1.0 m out on a
                      ~3 m pitch, pointed arches between them, a flat
                      portico roof at ~3 m (Sokollu's son cemaat yeri)
     pishtaq          the portal frame round the door, 4.6-5.6 m wide,
                      standing 1.25 m out, rising past the portico roof to
                      ~1.8 storeys, a stepped (muqarnas-like) pointed recess
     dome             radius 0.32 of the roof's short side (2.5-9 m), on a
                      square base and a drum 0.45 R tall with arched windows,
                      two half-domes on the axis, four weight turrets
     minaret          total height 1.6 x the hall to the dome crown (Ottoman
                      practice runs 1.5-2.5x), shaft diameter 1/12 of its
                      height, a square base, one serefe balcony (two over
                      30 m) on stepped corbels, a tall lead cone ~6 shaft
                      radii, a finial
     cornice          a tile course (turquoise / cobalt) under a small
                      corbel cornice, stepped merlons on the parapet

   PALETTES (by seed): Ottoman grey limestone + lead domes; Cairene
   sandstone + ablaq striping + stone dome; whitewash + green dome.

   COST: dbox for the walls; round meshes only for the dome group and the
   minaret (~20, as before).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // the skin of a regular window grid: strips between the columns, bands
  // between the rows (what F.cladAround lays, in cols + rows boxes)
  function gridClad(ctx, F, f, cols, rows, yA, yB, proj, col) {
    if (ctx.grid || !(yB - yA > 0.02)) return;
    const ed = [-f.span / 2 - proj];
    for (const c of cols) ed.push(c[0], c[1]);
    ed.push(f.span / 2 + proj);
    for (let i = 0; i < ed.length; i += 2) if (ed[i + 1] - ed[i] > 0.02) F.box(ctx, f, (ed[i] + ed[i + 1]) / 2, (yA + yB) / 2, ed[i + 1] - ed[i], yB - yA, proj, col);
    const ys = [yA];
    for (const r of rows) ys.push(r[0], r[1]);
    ys.push(yB);
    for (let i = 0; i < ys.length; i += 2) if (ys[i + 1] - ys[i] > 0.02) F.box(ctx, f, 0, (ys[i] + ys[i + 1]) / 2, f.span + proj * 2, ys[i + 1] - ys[i], proj, col);
  }

  const PALS = [
    { wall: 0xcfc8b6, stone: 0xe0dacb, dome: 0x6f767c, tile: 0x2f8a8c, tile2: 0x2c4a8a, frame: 0x5d5a52, stripe: null },
    { wall: 0xc8a67b, stone: 0xdcc39c, dome: 0xb59a74, tile: 0x2f7a86, tile2: 0x8a4a32, frame: 0x4a3a2a, stripe: 0x8f6446 },
    { wall: 0xe3ded2, stone: 0xf0ece2, dome: 0x4f7c66, tile: 0x2f8a8c, tile2: 0x2c4a8a, frame: 0x3c4a44, stripe: null },
  ];

  CBZ.registerFacade("mosque", {
    label: "Grand Mosque",
    // WHAT IT IS MADE OF (city/collapse.js MATERIALS) — cut stone piers carrying masonry domes.
    structure: "stone",
    crownsRoof: true,
    window: "lancet",
    build: function (ctx, F, spec) {
      const FH = ctx.FH, ST = Math.max(1, ctx.storeys | 0), H = ctx.rTop;
      const P0 = PALS[(ctx.hash(0x3501) * PALS.length) | 0];
      const tint = (c) => F.mix(c, ctx.color, 0.10);
      const WALL = tint(P0.wall), STONE = tint(P0.stone), STONE_D = F.shade(WALL, 0.8);
      const DOME = P0.dome, TILE = P0.tile, TILE2 = P0.tile2;
      const GLASS = F.glass(ctx, 0x1a2228);
      F.windowFrame(ctx, P0.frame);
      const ent = F.entrance(ctx);
      const CLAD = 0.06;
      const tower = ST >= 8;
      const WW = tower ? 1.4 : 1.1, RISE = 1.1 * 0.55, PITCH = tower ? 2.6 : 3.0;

      const pointedHead = function (f, t, y, wid, ring) {
        const steps = 3;
        for (let i = 0; i < steps; i++) {
          const u = (i + 0.5) / steps;
          const hw = (wid / 2) * (1 - u * 0.92);
          F.box(ctx, f, t, y + u * RISE, hw * 2, RISE / steps + 0.01, 0.09, GLASS);
          for (const sg of [-1, 1]) F.box(ctx, f, t + sg * (hw + ring / 2), y + u * RISE, ring, RISE / steps + 0.02, 0.16, STONE);
        }
        F.box(ctx, f, t, y + RISE + 0.08, ring * 1.6, 0.18, 0.17, STONE);     // the apex stone
      };

      // ---- 1. THE WALLS: two tiers of pointed windows -------------------
      // The two prayer-hall tiers (and the top storey) carry the pointed
      // heads; a tall host's middle storeys are plain openings with a sill,
      // on the same columns, under a cheap grid skin.
      const portalHalf = clamp(ent.f.span * 0.14, 2.0, 2.8);
      for (const f of F.faces(ctx)) {
        const door = f.s === ctx.doorSide;
        const n = F.bayCount(f, PITCH, 2, 18);
        const fancy = [], plain = [];
        for (let k = 0; k < ST; k++) {
          const S = F.storey(ctx, k, k === ST - 1 ? 0.7 : 0.9);
          let head = S.head;
          const pointed = k < 2 || k === ST - 1;
          if (pointed) head = Math.min(head, k === ST - 1 ? H - 0.62 - RISE : (k + 1) * FH + 0.75 - RISE);
          if (head - S.sill < 1.0) continue;
          if (door && k < 2) {
            // either side of the pishtaq: the strip between it and the
            // corner, windows evenly in it
            const a = portalHalf + 0.3, b = f.span / 2 - 0.9, len = b - a;
            const m = Math.max(1, Math.floor(len / 1.9)), ww = Math.min(1.4, len / m - 0.5);
            if (ww >= 0.6) for (const sg of [-1, 1]) for (let i = 0; i < m; i++) {
              const t = sg * (a + (i + 0.5) * (len / m));
              (pointed ? fancy : plain).push({ t0: t - ww / 2, t1: t + ww / 2, y0: S.sill, y1: head, t: t, k: k });
            }
            continue;
          }
          for (const r of F.openRow(ctx, f, n, WW, 0.9, k)) {
            (pointed ? fancy : plain).push({ t0: r.t0, t1: r.t1, y0: S.sill, y1: head, t: r.t, k: k });
          }
        }
        const yMid0 = Math.min(ST, 2) * FH, yMid1 = Math.max(yMid0, (ST - 1) * FH);
        F.cladAround(ctx, f, 0, yMid0, fancy.filter((h) => h.k < 2), CLAD, WALL);
        F.cladAround(ctx, f, yMid1, H, fancy.filter((h) => h.k >= 2), CLAD, WALL);
        if (yMid1 > yMid0) {
          const cols = [], rows = [];
          for (const h of plain) {
            if (!cols.some((c) => Math.abs(c[0] - h.t0) < 0.01)) cols.push([h.t0, h.t1]);
            if (!rows.some((r) => Math.abs(r[0] - h.y0) < 0.01)) rows.push([h.y0, h.y1]);
          }
          cols.sort((a, b) => a[0] - b[0]); rows.sort((a, b) => a[0] - b[0]);
          gridClad(ctx, F, f, cols, rows, yMid0, yMid1, CLAD, WALL);
          for (const r of rows) F.band(ctx, f, r[0] - 0.05, 0.1, 0.14, STONE, 0.14);
        }
        for (const h of fancy) {
          F.surround(ctx, f, h.t0, h.t1, h.y0, h.y1, { jambs: false, head: "none", sill: { h: 0.1, proj: 0.16, over: 0.16, col: STONE } });
          pointedHead(f, h.t, h.y1, h.t1 - h.t0, 0.14);
        }
        // a dado and (Cairene) ablaq stripes
        F.band(ctx, f, 0.3, 0.6, 0.12, STONE_D, 0.12);
        // the ablaq courses run in the wall, round every opening
        if (P0.stripe != null && !ctx.grid && CBZ.facadeOpenings) {
          const hs = fancy.concat(plain).map((h) => ({ a0: h.t0 - 0.13, a1: h.t1 + 0.13, y0: h.y0 - 0.12, y1: h.y1 + RISE + 0.2 }));
          const e0 = f.span / 2 + CLAD + 0.02;
          for (let y = 1.2; y < Math.min(H - 1.0, 3 * FH); y += 1.2) {
            for (const r of CBZ.facadeOpenings.solidRects(-e0, e0, y - 0.11, y + 0.11, hs)) F.box(ctx, f, (r[0] + r[1]) / 2, (r[2] + r[3]) / 2, r[1] - r[0], r[3] - r[2], CLAD + 0.02, P0.stripe);
          }
        }
        // the tile course + corbel cornice + merlons
        F.band(ctx, f, H - 0.44, 0.26, 0.1, TILE, 0.1);
        F.band(ctx, f, H - 0.29, 0.05, 0.12, TILE2, 0.12);
        F.merlons(ctx, f, H + 0.52, Math.max(4, Math.round(f.span / 1.1)), 0.5, 0.65, 0.3, STONE);
      }
      F.cornice(ctx, H - 0.26, { h: 0.42, proj: 0.32, col: STONE, dark: STONE_D, teeth: "dentil", frieze: 0 });
      F.parapet(ctx, 0.25, 0.3, WALL, STONE);

      // ---- 2. THE RIWAQ + PISHTAQ (entrance face) -----------------------
      if (!ent.driveIn) {
        const f = ent.f;
        const roofY = Math.min(FH - 0.05, 3.3);
        const OUT = 1.0;
        const inner = f.span / 2 - 0.9;
        const nA = Math.max(2, Math.round((inner * 2) / 3.0));
        const pitch = (inner * 2) / nA;
        const spring = roofY - 0.95;
        // columns on the arcade line (rounds), skipping inside the portal
        for (let i = 0; i <= nA; i++) {
          const t = -inner + i * pitch;
          if (Math.abs(t) < portalHalf + 0.2) continue;
          const nC = f.halfN + OUT;
          const x = f.horiz ? t : f.out * nC, z = f.horiz ? f.out * nC : t;
          ctx.column(x, 0, z, 0.17, spring, STONE, 10);
          F.box(ctx, f, t, spring + 0.1, 0.5, 0.2, 0.42, STONE_D, OUT - 0.21);     // impost block
        }
        // the arcade front: pointed arches as stepped courses, in a plane
        // 0.85-1.15 m off the wall, and the portico roof over it
        for (let i = 0; i < nA; i++) {
          const tc = -inner + (i + 0.5) * pitch;
          if (Math.abs(tc) < portalHalf + pitch * 0.4) continue;
          const span = pitch - 0.4, rise = Math.min(roofY - spring - 0.2, span * 0.55);
          for (let s = 0; s < 4; s++) {
            const u = (s + 0.5) / 4, hw = (span / 2) * (1 - u * 0.9);
            for (const sg of [-1, 1]) F.box(ctx, f, tc + sg * (hw + (pitch / 2 - hw) / 2), spring + 0.2 + u * rise, pitch / 2 - hw, rise / 4 + 0.02, 0.3, STONE, OUT - 0.15);
          }
          F.box(ctx, f, tc, (spring + 0.2 + rise + roofY) / 2, pitch, roofY - spring - 0.2 - rise + 0.02, 0.3, STONE, OUT - 0.15);
        }
        F.box(ctx, f, 0, roofY + 0.14, inner * 2 + 0.6, 0.28, OUT + 0.18, STONE_D);
        F.box(ctx, f, 0, roofY + 0.32, inner * 2 + 0.7, 0.1, OUT + 0.22, TILE);
        // the PISHTAQ: a frame rising past the portico, a stepped pointed recess
        const pH = Math.min(H - 0.7, Math.max(roofY + 2.2, FH * 1.8));
        const PO = 1.25;
        for (const sg of [-1, 1]) F.rib(ctx, f, sg * (portalHalf - 0.4), 0, pH, 0.8, PO, STONE);
        F.box(ctx, f, 0, pH - 0.35, portalHalf * 2, 0.7, PO, STONE);
        F.box(ctx, f, 0, pH - 0.78, portalHalf * 2 - 1.6, 0.16, PO - 0.05, TILE);
        // the recess: three nested pointed hoods, each set further back
        const aw = portalHalf * 2 - 1.6, top = pH - 0.86;
        const spr = Math.max(ent.head + 0.2, top - aw * 0.75);
        for (let L = 0; L < 2; L++) {
          const wid = aw - L * 0.36, rise = top - spr;
          for (let s = 0; s < 5; s++) {
            const u = (s + 0.5) / 5, hw = (wid / 2) * (1 - u * 0.9);
            for (const sg of [-1, 1]) F.box(ctx, f, sg * (hw + (aw / 2 - hw) / 2), spr + u * rise, aw / 2 - hw, rise / 5 + 0.02, PO - 0.35 - L * 0.25, L === 1 ? TILE2 : STONE);
          }
        }
        for (const sg of [-1, 1]) F.rib(ctx, f, sg * (aw / 2 - 0.15), 0, spr, 0.3, PO - 0.35, STONE_D);
      }

      // ---- 3. THE DOME on its drum ------------------------------------------
      const R0 = F.roof(ctx);
      const R = clamp(Math.min(R0.w, R0.d) * 0.32, 2.5, 9);
      const ef = F.face(ctx, ctx.doorSide);
      // shifted toward the qibla wall (away from the door)
      const back = clamp((ef.horiz ? R0.d : R0.w) / 2 - R * 1.1, 0, 6) * 0.6;
      const dx = R0.cx + (ef.horiz ? 0 : -ef.out * back), dz = R0.cz + (ef.horiz ? -ef.out * back : 0);
      const baseH = 0.6, drumH = R * 0.45;
      ctx.dbox(dx, H + baseH / 2, dz, R * 2.12, baseH, R * 2.12, STONE_D);
      ctx.dbox(dx, H + baseH + 0.08, dz, R * 2.2, 0.16, R * 2.2, STONE);
      const drumY = H + baseH + 0.16;
      ctx.column(dx, drumY, dz, R * 1.0, drumH, WALL, 16);
      // drum windows on the four axes, and a cornice ring under the dome
      for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        ctx.dbox(dx + ax * R * 0.97, drumY + drumH * 0.5, dz + az * R * 0.97, az ? R * 0.34 : 0.14, drumH * 0.56, ax ? R * 0.34 : 0.14, GLASS);
      }
      ctx.column(dx, drumY + drumH, dz, R * 1.06, 0.18, STONE, 16);
      const domeY = drumY + drumH + 0.18;
      ctx.dome(dx, domeY, dz, R, DOME);
      ctx.column(dx, domeY + R - 0.05, dz, 0.07, R * 0.28 + 0.4, 0xc9a24a, 6);
      ctx.ball(dx, domeY + R + R * 0.18 + 0.2, dz, clamp(R * 0.06, 0.12, 0.35), 0xc9a24a);
      // half-domes on the door axis, and weight turrets on the diagonals
      for (const sg of [-1, 1]) {
        const hx = ef.horiz ? 0 : sg * R * 1.05, hz = ef.horiz ? sg * R * 1.05 : 0;
        if (Math.abs(dx + hx - R0.cx) + R * 0.5 < R0.w / 2 && Math.abs(dz + hz - R0.cz) + R * 0.5 < R0.d / 2) ctx.dome(dx + hx, H + baseH, dz + hz, R * 0.5, DOME);
      }
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const tx = dx + sx * R * 0.98, tz = dz + sz * R * 0.98, tr = clamp(R * 0.1, 0.25, 0.8);
        ctx.column(tx, H + baseH, tz, tr, drumH * 0.9, STONE, 8);
        ctx.cone(tx, H + baseH + drumH * 0.9, tz, tr * 1.25, tr * 2.4, DOME);
      }

      // ---- 4. THE MINARET, from a corner of the entrance face --------------
      {
        const hall = domeY + R;                                // the hall to its dome crown
        const Hm = clamp(hall * 1.6, H + 12, 62);
        const r = clamp(Hm / 24, 0.75, 2.4);
        const b = r * 2.5;                                     // the square base
        const sgT = ctx.hash(0x3502) < 0.5 ? -1 : 1;
        const cxT = sgT * ((ef.horiz ? ctx.w : ctx.d) / 2 - b / 2 - 0.15);
        const cnN = ef.out * ((ef.horiz ? ctx.d : ctx.w) / 2 - b / 2 - 0.15);
        const mx = ef.horiz ? cxT : cnN, mz = ef.horiz ? cnN : cxT;
        const baseTop = H + Math.max(2.2, r * 3);
        ctx.dbox(mx, (H + baseTop) / 2, mz, b, baseTop - H, b, WALL);
        ctx.dbox(mx, baseTop + 0.12, mz, b + 0.2, 0.24, b + 0.2, STONE);
        // the transition: a chamfered drum
        ctx.column(mx, baseTop + 0.24, mz, r * 1.15, 0.8, STONE, 12);
        const shaft0 = baseTop + 1.04;
        const balc = Hm > 30 ? [0.62, 0.82] : [0.78];
        let y = shaft0;
        for (let i = 0; i < balc.length; i++) {
          const by = Hm * balc[i];
          const sr = r * (1 - i * 0.12);
          ctx.column(mx, y, mz, sr, by - y, STONE, 12);
          // the serefe: corbel steps out, a deck, a parapet
          ctx.dbox(mx, by - 0.45, mz, sr * 2 + 0.3, 0.3, sr * 2 + 0.3, STONE_D);
          ctx.dbox(mx, by - 0.18, mz, sr * 2 + 0.75, 0.24, sr * 2 + 0.75, STONE);
          ctx.dbox(mx, by + 0.42, mz, sr * 2 + 0.75, 0.8, sr * 2 + 0.75, F.shade(STONE, 0.94));
          y = by + 0.82;
        }
        const ur = r * (balc.length > 1 ? 0.76 : 0.86);
        const capY = Hm - ur * 6;
        if (capY > y) ctx.column(mx, y, mz, ur, capY - y, STONE, 12);
        ctx.cone(mx, Math.max(capY, y), mz, ur * 1.12, ur * 6, DOME);
        ctx.ball(mx, Math.max(capY, y) + ur * 6 + 0.15, mz, clamp(ur * 0.3, 0.12, 0.4), 0xc9a24a);
      }
    },
  });
})();
