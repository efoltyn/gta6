/* ============================================================
   city/clothes.js — PAINTED CLOTHING: garment structure is PAINTED
   onto small shared CanvasTextures (the Minecraft-skin technique)
   instead of bolted-on geometry, so a tuxedo has real lapels, a cop
   has a badge and a duty belt, and even street basics stop being a
   single flat slab — at the SAME draw-call cost as flat colors.

   HOW (the makeLabelSprite caching pattern, applied to cloth):
     • ONE 128×256 atlas canvas per OUTFIT KEY → one CanvasTexture →
       ONE MeshLambertMaterial shared by EVERY wearer of that outfit.
       Atlas rows: torso / jacket-shell / arm / leg; columns within a
       row: front (64px) / back / side / cap — so each box face shows
       the right panel of the garment (lapels never wrap onto backs).
     • Geometry: BoxGeometry maps every face 0-1, so we keep ONE
       UV-remapped clone per PART TYPE (4 total, _shared, cached) that
       points each face into its atlas region. Swapping a part is
       `mesh.geometry = clothGeom(...); mesh.material = set.mat` —
       no new geometry/material per character, ever.
     • JACKET SHELL: tux/suit/police get one ~6%-inflated torso shell
       (pooled per rig, castShadow false) whose texture is the OPEN
       jacket — an alpha-cut front gap shows the painted shirt on the
       torso beneath. Silhouette from geometry, structure from paint.

   API:
     CBZ.cityClothesTex(recOrId)        → cached {mat, tex, parts} set
     CBZ.applyClothes(ch, rec, opts)    → dress/strip a character rig;
       returns the painted parts map ({torso,arms,legs,jacket}) or
       null when the outfit has no painted look (caller falls back to
       flat colors). opts.iso clones the material per-rig (crowd.js's
       pooled bodies tint materials in place — isolation stops bleed).
     Also exported as CBZ.cityApplyClothes (city-side name).

   SAFETY: character.js's default path is untouched — a rig only gets
   painted when something explicitly applies an outfit. Stripping
   restores the original geometry+material saved on first dress, so
   jail/survival rigs can never be left wearing city paint.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const THREE = window.THREE;   // bind locally so the bare-THREE refs resolve (browser always has it; harness stubs it). clothes.js stays defined even headless — outfits.js/peds.js consume its API unconditionally.

  // ---- the atlas layout (one canvas per outfit) ----------------------------
  const W = 128, H = 256;
  const COLS = { front: [0, 64], back: [64, 96], side: [96, 112], cap: [112, 128] };
  const ROWS = { torso: [0, 96], jacket: [96, 176], arm: [176, 216], leg: [216, 256] };
  // part dims MUST match entities/character.js boxes; jacket = inflated torso
  const DIMS = { torso: [0.92, 0.95, 0.5], jacket: [0.98, 1.0, 0.6], arm: [0.3, 0.92, 0.3], leg: [0.34, 0.95, 0.34] };

  // ---- the PLAIN-CIVVIE switch (owner's "plain civilians" rule) -------------
  // When CBZ.CONFIG.CITY_PLAIN_CIVVIES is on (and it is by default — undefined
  // reads as ON), ordinary civilians render PLAIN: a solid shirt color on the
  // torso+arms, blue-jean legs and shoes, with NO painted canvas/atlas at all.
  // Only deliberate ROLE templates (tuxedo, the uniforms, gang via a bandana
  // mesh) and explicitly-cast money fits keep the painted look. The generic
  // street ids (basics/hoodie/street/civvies) therefore resolve to no painted
  // look in this mode → recolorRig falls back to its exact flat-color path.
  // Reversible: flip the flag false to bring the painted street-basics seams
  // (collar/placket/waistband) back for every nobody.
  function plainCivvies() {
    const C = CBZ.CONFIG;
    return !C || C.CITY_PLAIN_CIVVIES == null || !!C.CITY_PLAIN_CIVVIES;
  }
  // ids that are "just a civilian in a shirt" — gated to PLAIN by the switch.
  const CIVVIE_IDS = { basics: 1, civvies: 1, street: 1, hoodie: 1 };

  // ---- color helpers --------------------------------------------------------
  function hx(n) { return "#" + ("00000" + ((n | 0) & 0xffffff).toString(16)).slice(-6); }
  // lighten (amt>0) / darken (amt<0) a hex int, returns css string
  function tone(n, amt) {
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (amt > 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
    else { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
    return "rgb(" + (r | 0) + "," + (g | 0) + "," + (b | 0) + ")";
  }

  // ---- per-row painter: draws in 0-1 coords of a column region --------------
  function rowPainter(ctx, rowName) {
    const ry0 = ROWS[rowName][0], ry1 = ROWS[rowName][1], rh = ry1 - ry0;
    function rect(col, x, y, w, h, color) {
      const c = COLS[col], cw = c[1] - c[0];
      ctx.fillStyle = color;
      ctx.fillRect(c[0] + x * cw, ry0 + y * rh, Math.max(1, w * cw), Math.max(1, h * rh));
    }
    function poly(col, pts, color) {
      const c = COLS[col], cw = c[1] - c[0];
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const px = c[0] + pts[i][0] * cw, py = ry0 + pts[i][1] * rh;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill();
    }
    function dot(col, x, y, r, color) {
      const c = COLS[col], cw = c[1] - c[0];
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(c[0] + x * cw, ry0 + y * rh, Math.max(1, r * cw), 0, 6.2832); ctx.fill();
    }
    function clear(col, x, y, w, h) {
      const c = COLS[col], cw = c[1] - c[0];
      ctx.clearRect(c[0] + x * cw, ry0 + y * rh, w * cw, h * rh);
    }
    function clearPoly(col, pts) {
      ctx.save(); ctx.globalCompositeOperation = "destination-out";
      poly(col, pts, "#fff"); ctx.restore();
    }
    // fill every column of the row (cap included — alphaTest would cut blanks)
    function fill(color) { for (const k in COLS) rect(k, 0, 0, 1, 1, color); }
    // the FABRIC read: subtle vertical gradient (top lighter, bottom darker).
    // source-atop keeps the shade off the jacket's transparent gap/cap.
    function shade() {
      ctx.save(); ctx.globalCompositeOperation = "source-atop";
      const g1 = ctx.createLinearGradient(0, ry0, 0, ry1);
      g1.addColorStop(0, "rgba(255,255,255,0.09)");
      g1.addColorStop(0.3, "rgba(255,255,255,0)");
      g1.addColorStop(0.6, "rgba(0,0,0,0)");
      g1.addColorStop(1, "rgba(0,0,0,0.12)");
      ctx.fillStyle = g1; ctx.fillRect(0, ry0, COLS.side[1], rh);  // cap stays flat-lit
      ctx.restore();
    }
    return { rect, poly, dot, clear, clearPoly, fill, shade };
  }

  // ============================================================
  //  GARMENT PAINTERS — each gets {T,J,A,L} row painters + the outfit's
  //  base colors, and returns which parts it painted (the rest of the
  //  rig keeps its flat colors so e.g. random civvies keep their jeans).
  // ============================================================
  const PAINT = {};

  // ---- suit FABRIC overlays (drawn source-atop, like shade()) --------------
  // pinstripe: thin vertical light lines; windowpane: a wide grid; glen: a
  // small dense check. All clipped to existing paint so they never bleed onto
  // the jacket gap/cap. line color is a quiet tone of the body.
  // a generic source-atop pattern stamper that works through a rowPainter's
  // rect() (so it respects the row/column atlas regions automatically).
  function patternRow(R, ctx, bodyHex, kind) {
    if (kind === "solid" || !kind) return;
    ctx.save(); ctx.globalCompositeOperation = "source-atop";
    const light = tone(bodyHex, 0.22), dark = tone(bodyHex, -0.18);
    if (kind === "pinstripe") {
      for (const col of ["front", "back", "side"])
        for (let x = 0.06; x < 1; x += 0.12) R.rect(col, x, 0, 0.012, 1, light);
    } else if (kind === "windowpane") {
      for (const col of ["front", "back", "side"]) {
        for (let x = 0.12; x < 1; x += 0.26) R.rect(col, x, 0, 0.016, 1, light);
        for (let y = 0.1; y < 1; y += 0.26) R.rect(col, 0, y, 1, 0.016, light);
      }
    } else if (kind === "glen") {                                  // dense small houndstooth-ish check
      for (const col of ["front", "back", "side"]) {
        for (let y = 0; y < 1; y += 0.1)
          for (let x = 0; x < 1; x += 0.1)
            R.rect(col, x, y, 0.05, 0.05, ((x * 10 + y * 10) & 1) ? dark : light);
        for (let x = 0.06; x < 1; x += 0.18) R.rect(col, x, 0, 0.01, 1, dark);  // faint windowpane over-check
      }
    }
    ctx.restore();
  }

  // shared formal-wear front: white shirt V + studs/tie + open jacket shell.
  // opts may carry: bow, tie(hex), belt, square, gap, lapel(width), lapelType
  // ('notch'|'peak'|'shawl'), pattern, db(double-breasted), vest(hex|true),
  // ctx (canvas ctx for pattern overlays).
  function formalTorso(T, J, jacketHex, lapelCss, opts) {
    const jc = hx(jacketHex), shirt = "#f1f2ec", shirtLow = "#dddfd6";
    const ctx = opts.ctx, lt = opts.lapelType || "notch";
    T.fill(jc);
    // 3-PIECE: the open jacket reveals a buttoned WAISTCOAT, not bare shirt.
    if (opts.vest) {
      const vest = hx(opts.vest === true ? jacketHex : opts.vest);
      T.rect("front", 0.28, 0, 0.44, 0.9, vest);                   // vest panel
      // narrow shirt sliver + collar above the vest
      T.rect("front", 0.42, 0, 0.16, 0.18, shirt);
      T.rect("front", 0.49, 0.5, 0.02, 0.4, tone(opts.vest === true ? jacketHex : opts.vest, -0.25)); // vest button placket
      for (let i = 0; i < 4; i++) T.dot("front", 0.5, 0.34 + i * 0.13, 0.012, tone(opts.vest === true ? jacketHex : opts.vest, 0.25)); // buttons
      T.poly("front", [[0.34, 0], [0.5, 0.34], [0.66, 0]], jc);    // vest V opening (jacket-color gap above buttons)
      T.rect("front", 0.42, 0, 0.16, 0.16, shirt);                 // shirt at the very top
    } else {
      // the shirt panel the open jacket reveals (full front — the gap crops it)
      T.rect("front", 0.3, 0, 0.4, 0.84, shirt);
      T.rect("front", 0.47, 0.02, 0.06, 0.82, shirtLow);          // placket seam
    }
    if (opts.bow) {                                                // black bow tie at the collar line
      T.rect("front", 0.38, 0.025, 0.24, 0.085, "#0b0c10");
      T.rect("front", 0.465, 0.035, 0.07, 0.065, "#15161c");      // knot
      T.dot("front", 0.5, 0.21, 0.018, "#15161a");                // stud dots
      T.dot("front", 0.5, 0.33, 0.018, "#15161a");
      T.dot("front", 0.5, 0.45, 0.018, "#15161a");
    } else if (opts.tie && !opts.vest) {                           // suit: colored tie (vest hides most of it)
      T.poly("front", [[0.44, 0.02], [0.56, 0.02], [0.53, 0.1], [0.47, 0.1]], tone(opts.tie, -0.25)); // knot
      T.rect("front", 0.465, 0.1, 0.07, 0.5, hx(opts.tie));
      T.poly("front", [[0.465, 0.6], [0.535, 0.6], [0.5, 0.68]], hx(opts.tie));
    } else if (opts.tie && opts.vest) {                            // a glimpse of tie at the vest V
      T.rect("front", 0.47, 0.04, 0.06, 0.22, hx(opts.tie));
    }
    if (opts.belt && !opts.vest) {                                 // suit belt line at the waist
      T.rect("front", 0.3, 0.84, 0.4, 0.08, "#17181d");
      T.rect("front", 0.475, 0.85, 0.05, 0.06, "#b9a05a");        // buckle
    } else if (!opts.vest) T.rect("front", 0.3, 0.78, 0.4, 0.1, "#0d0e12"); // tux cummerbund break
    if (ctx) patternRow(T, ctx, jacketHex, opts.pattern);
    T.shade();
    // ---- the OPEN JACKET shell: alpha-cut V gap + satin lapel wedges ----
    J.fill(jc);
    J.clear("cap", 0, 0, 1, 1);                                    // open top/bottom — see the shirt inside
    const g = opts.gap || 0.13;                                    // half-width of the gap at the hem
    const db = !!opts.db, overlap = db ? 0.07 : 0.035;            // double-breasted = wider overlap
    J.clearPoly("front", [[0.5 - overlap, 0], [0.5 + overlap, 0], [0.5 + g, 1], [0.5 - g, 1]]);
    // lapels: notch (default angled wedge), peak (an upswept point), shawl
    // (one smooth continuous curve-ish facet, tux). width at the shoulder.
    const lw = opts.lapel || 0.13;
    if (lt === "shawl") {
      J.poly("front", [[0.5 - overlap - lw, 0], [0.5 - overlap, 0], [0.5 - g + 0.01, 0.5], [0.5 - g - 0.07, 0.46]], lapelCss);
      J.poly("front", [[0.5 + overlap, 0], [0.5 + overlap + lw, 0], [0.5 + g + 0.07, 0.46], [0.5 + g - 0.01, 0.5]], lapelCss);
    } else if (lt === "peak") {
      J.poly("front", [[0.5 - overlap - lw, 0.06], [0.5 - overlap, 0], [0.5 - g, 0.44], [0.5 - g - 0.04, 0.34], [0.5 - overlap - lw - 0.04, 0.16]], lapelCss);
      J.poly("front", [[0.5 + overlap, 0], [0.5 + overlap + lw, 0.06], [0.5 + overlap + lw + 0.04, 0.16], [0.5 + g + 0.04, 0.34], [0.5 + g, 0.44]], lapelCss);
    } else {                                                       // notch
      J.poly("front", [[0.5 - overlap - lw, 0], [0.5 - overlap + 0.001, 0], [0.5 - g + 0.005, 0.46], [0.5 - g - 0.05, 0.4]], lapelCss);
      J.poly("front", [[0.5 + overlap - 0.001, 0], [0.5 + overlap + lw, 0], [0.5 + g + 0.05, 0.4], [0.5 + g - 0.005, 0.46]], lapelCss);
    }
    if (db) {                                                      // a second column of buttons
      for (let i = 0; i < 3; i++) { J.dot("front", 0.5 - g + 0.03, 0.4 + i * 0.16, 0.018, lapelCss); J.dot("front", 0.5 + g - 0.03, 0.4 + i * 0.16, 0.018, lapelCss); }
    }
    J.rect("back", 0.47, 0.55, 0.06, 0.45, tone(jacketHex, -0.25)); // back vent
    if (opts.square) J.rect("front", 0.16, 0.18, 0.1, 0.045, "#f1f2ec"); // pocket square
    if (ctx) patternRow(J, ctx, jacketHex, opts.pattern);
    J.shade();
  }
  function formalLimbs(A, L, jacketHex, legHex, cuff, opts) {
    opts = opts || {};
    const jc = hx(jacketHex), ctx = opts.ctx;
    A.fill(jc);
    if (cuff) { A.rect("front", 0, 0.86, 1, 0.07, "#f1f2ec"); A.rect("side", 0, 0.86, 1, 0.07, "#f1f2ec"); A.rect("back", 0, 0.86, 1, 0.07, "#e3e4dc"); }
    A.dot("front", 0.78, 0.8, 0.05, tone(jacketHex, -0.35));       // sleeve button
    if (ctx) patternRow(A, ctx, jacketHex, opts.pattern);
    A.shade();
    L.fill(hx(legHex));
    L.rect("front", 0.46, 0, 0.08, 0.94, tone(legHex, 0.18));      // sharp crease line
    L.rect("front", 0, 0.94, 1, 0.06, tone(legHex, -0.3));         // gloss shoe break
    L.rect("side", 0, 0.94, 1, 0.06, tone(legHex, -0.3));
    if (ctx) patternRow(L, ctx, legHex, opts.pattern);
    L.shade();
  }

  // tuxedo accepts an optional style record so the SUIT_STYLES table can ship
  // tux variants (shawl satin, midnight-blue, white dinner jacket, DB peak).
  PAINT.tuxedo = function (P, c, st) {
    st = st || {};
    const body = st.body != null ? st.body : 0x16171c;            // lifted off true black so shading reads
    const lapel = st.lapelCss || tone(body, 0.16);
    formalTorso(P.T, P.J, body, lapel, { bow: true, square: true, gap: 0.12, lapel: 0.15, lapelType: st.lapel || "shawl", db: !!st.db, ctx: P.ctx, pattern: st.pattern });
    formalLimbs(P.A, P.L, body, st.legs != null ? st.legs : 0x14151a, true, { ctx: P.ctx, pattern: st.pattern });
    return { torso: 1, arms: 1, legs: 1, jacket: 1 };
  };
  // suit accepts a STYLE record (SUIT_STYLES entry) OR a raw colors record. The
  // style drives pattern/db/vest/lapel/tie; raw {torso,legs} still works.
  PAINT.suit = function (P, c, st) {
    if (typeof st === "number") st = { tie: st };                  // legacy: a bare tie hex
    st = st || {};
    const body = st.body != null ? st.body : (c && c.torso != null ? c.torso : 0x1c2030);
    const legs = st.legs != null ? st.legs : ((c && c.legs != null) ? c.legs : tone2(body, -0.08));
    const lapelCss = st.lapelCss || tone(body, st.pattern && st.pattern !== "solid" ? 0.1 : 0.16);
    formalTorso(P.T, P.J, body, lapelCss, {
      tie: st.tie != null ? st.tie : 0x7a1f2b, belt: !st.vest && !st.db, gap: st.db ? 0.13 : 0.1,
      lapel: st.lapel === "peak" ? 0.12 : 0.09, lapelType: st.lapel || "notch",
      pattern: st.pattern, db: !!st.db, vest: st.vest, ctx: P.ctx, square: !!st.square,
    });
    formalLimbs(P.A, P.L, body, legs, false, { ctx: P.ctx, pattern: st.pattern });
    return { torso: 1, arms: 1, legs: 1, jacket: 1 };
  };

  PAINT.police = function (P, c) {
    const uni = (c && c.torso != null) ? c.torso : 0x24407a, uc = hx(uni);
    const shirt = tone(uni, 0.3), T = P.T, J = P.J, A = P.A, L = P.L;
    // torso = the SHIRT layer (shows through the duty jacket's open front)
    T.fill(uc);
    T.rect("front", 0.3, 0, 0.4, 0.86, shirt);
    T.rect("front", 0.47, 0.02, 0.06, 0.6, hx(0x16264a));          // dark tie
    T.rect("front", 0.3, 0.86, 0.4, 0.14, "#101218");              // belt under the hem
    T.shade();
    // duty jacket: badge, breast pockets w/ flap lines, belt + holster block
    J.fill(uc);
    J.clear("cap", 0, 0, 1, 1);
    J.clearPoly("front", [[0.5 - 0.03, 0], [0.5 + 0.03, 0], [0.5 + 0.08, 1], [0.5 - 0.08, 1]]);
    J.rect("front", 0.12, 0.26, 0.26, 0.13, tone(uni, -0.18));     // pocket bodies
    J.rect("front", 0.62, 0.26, 0.26, 0.13, tone(uni, -0.18));
    J.rect("front", 0.12, 0.26, 0.26, 0.045, tone(uni, -0.4));     // flap lines
    J.rect("front", 0.62, 0.26, 0.26, 0.045, tone(uni, -0.4));
    J.poly("front", [[0.21, 0.1], [0.29, 0.1], [0.29, 0.17], [0.25, 0.21], [0.21, 0.17]], "#e8c454"); // badge shield
    J.dot("front", 0.25, 0.135, 0.028, "#fadf8e");                 // badge dot
    J.rect("front", 0.66, 0.13, 0.16, 0.04, "#cfd6e2");            // name tape
    const beltY = 0.84;                                            // duty belt rides the jacket hem
    J.rect("front", 0, beltY, 1, 0.16, "#0d1016");
    J.rect("back", 0, beltY, 1, 0.16, "#0d1016");
    J.rect("side", 0, beltY, 1, 0.16, "#0d1016");
    J.rect("side", 0.15, 0.78, 0.7, 0.2, "#15181f");               // holster block at the hip
    J.rect("front", 0.46, 0.86, 0.08, 0.1, "#c9a23f");             // buckle
    J.shade();
    A.fill(uc);
    A.rect("front", 0.2, 0.05, 0.6, 0.2, tone(uni, -0.3));         // shoulder patch
    A.rect("front", 0.2, 0.05, 0.6, 0.035, "#e8c454");             //   gold border
    A.rect("side", 0.2, 0.05, 0.6, 0.2, tone(uni, -0.3));
    A.shade();
    L.fill(hx((c && c.legs != null) ? c.legs : 0x1b2a44));
    L.rect("side", 0.35, 0, 0.3, 1, tone(uni, -0.35));             // trouser side stripe
    L.shade();
    return { torso: 1, arms: 1, legs: 1, jacket: 1 };
  };

  PAINT.swat = function (P, c) {
    const base = (c && c.torso != null) ? c.torso : 0x2b2f36, bc = hx(base);
    const T = P.T, A = P.A, L = P.L;
    T.fill(bc);
    T.rect("front", 0.08, 0.06, 0.84, 0.66, "#1d2026");            // plate vest
    T.rect("back", 0, 0.06, 1, 0.66, "#1d2026");
    T.rect("front", 0.16, 0.42, 0.2, 0.18, "#14161b");             // mag pouches
    T.rect("front", 0.4, 0.42, 0.2, 0.18, "#14161b");
    T.rect("front", 0.64, 0.42, 0.2, 0.18, "#14161b");
    T.rect("front", 0.3, 0.14, 0.4, 0.08, "#cfd6e2");              // chest tape
    T.rect("front", 0, 0.86, 1, 0.14, "#0d1016");                  // duty belt
    T.rect("side", 0, 0.86, 1, 0.14, "#0d1016");
    T.rect("back", 0, 0.86, 1, 0.14, "#0d1016");
    T.shade();
    A.fill(bc); A.rect("front", 0.2, 0.06, 0.6, 0.18, "#1d2026"); A.shade();
    L.fill(hx((c && c.legs != null) ? c.legs : 0x23262c));
    L.rect("side", 0.2, 0.45, 0.6, 0.3, "#1d2026");                // thigh rig
    L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  };

  PAINT.gang = function (P, c) {
    const hue = (c && c.torso != null) ? c.torso : 0xb079ea;
    const acc = (c && c.collar != null) ? c.collar : 0x141820;
    const T = P.T, A = P.A, L = P.L, hc = hx(hue), ac = hx(acc);
    T.fill(hc);
    // a single bandana SASH worn across the chest (the crew read) — one clean
    // diagonal band of the accent color, not a full hoop + polka dots + a
    // floating diamond. Reads instantly as "flying colors", looks intentional.
    T.poly("front", [[0, 0.18], [0.18, 0.1], [1, 0.46], [1, 0.58], [0.82, 0.62], [0, 0.3]], ac);
    T.rect("back", 0, 0.18, 1, 0.1, ac);                            // band continues round the back
    T.rect("side", 0, 0.2, 1, 0.1, ac);
    T.rect("front", 0.49, 0, 0.02, 0.18, tone(hue, -0.15));         // collar placket above the sash
    T.rect("front", 0, 0.91, 1, 0.09, tone(hue, -0.4));             // waistband
    T.rect("side", 0, 0.91, 1, 0.09, tone(hue, -0.4));
    T.rect("back", 0, 0.91, 1, 0.09, tone(hue, -0.4));
    T.shade();
    A.fill(hc); A.rect("front", 0, 0.3, 1, 0.09, ac); A.rect("side", 0, 0.3, 1, 0.09, ac); A.shade();
    L.fill(hx((c && c.legs != null) ? c.legs : 0x23262c));
    L.rect("side", 0.38, 0, 0.24, 1, ac);
    L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  };

  PAINT.hivis = function (P, c) {
    const vest = (c && c.torso != null) ? c.torso : 0xffb43a, drab = 0x5d6052;
    const T = P.T, A = P.A, L = P.L, vc = hx(vest), refl = "#f4f6ef";
    T.fill(vc);
    // TWO reflective stripes, all the way round
    for (const y of [0.36, 0.62]) for (const col of ["front", "back", "side"]) {
      T.rect(col, 0, y, 1, 0.1, refl);
      T.rect(col, 0, y + 0.035, 1, 0.03, "#cdd3d8");                // the silver core line
    }
    // shoulder straps over the drab shirt at the neckline
    T.rect("front", 0.06, 0, 0.16, 0.3, refl);
    T.rect("front", 0.78, 0, 0.16, 0.3, refl);
    T.rect("back", 0.06, 0, 0.16, 0.3, refl);
    T.rect("back", 0.78, 0, 0.16, 0.3, refl);
    T.rect("front", 0.3, 0, 0.4, 0.07, tone(drab, 0));              // shirt at the collar
    T.shade();
    A.fill(hx(drab)); A.rect("front", 0, 0.84, 1, 0.08, tone(drab, -0.25)); A.shade(); // drab work shirt
    L.fill(hx((c && c.legs != null) ? c.legs : 0x2f4f8a));
    L.rect("front", 0, 0.5, 1, 0.07, refl);                         // knee band
    L.rect("side", 0, 0.5, 1, 0.07, refl);
    L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  };

  PAINT.vendor = function (P, c) {
    const shirt = (c && c.torso != null) ? c.torso : 0xc8553a, apron = 0xf0ead8;
    const T = P.T, A = P.A, sc = hx(shirt), apc = hx(apron);
    T.fill(sc);
    T.rect("front", 0.16, 0.16, 0.68, 0.84, apc);                   // apron front panel
    T.rect("front", 0.28, 0, 0.09, 0.16, apc);                      // straps
    T.rect("front", 0.63, 0, 0.09, 0.16, apc);
    T.rect("front", 0.16, 0.52, 0.68, 0.035, tone(apron, -0.25));   // waist tie line
    T.rect("front", 0.3, 0.62, 0.4, 0.22, tone(apron, -0.12));      // pouch pocket
    T.rect("front", 0.3, 0.62, 0.4, 0.03, tone(apron, -0.3));
    T.rect("back", 0.3, 0.5, 0.4, 0.05, tone(apron, -0.1));         // tie knot at the back
    T.shade();
    A.fill(hx((c && c.arms != null) ? c.arms : 0xf0ead8));
    A.rect("front", 0, 0.5, 1, 0.05, tone(shirt, -0.2));            // rolled-sleeve line
    A.shade();
    return { torso: 1, arms: 1 };
  };

  // ---- HOSPITAL: teal scrubs (nurse) — the simple V-neck top + drawstring -
  PAINT.scrubs = function (P, c) {
    const teal = (c && c.torso != null) ? c.torso : 0x3d8a86, tc = hx(teal);
    const T = P.T, A = P.A, L = P.L;
    T.fill(tc);
    T.poly("front", [[0.34, 0], [0.5, 0.2], [0.66, 0]], tone(teal, -0.28));   // V-neck
    T.rect("front", 0.5 - 0.07, 0.54, 0.14, 0.18, tone(teal, -0.12));         // chest pocket
    T.rect("front", 0.5 - 0.07, 0.54, 0.14, 0.03, tone(teal, -0.28));        // pocket lip
    T.rect("front", 0, 0.9, 1, 0.05, tone(teal, -0.22));                      // hem
    T.shade();
    A.fill(tc); A.rect("front", 0, 0.62, 1, 0.05, tone(teal, -0.22)); A.rect("side", 0, 0.62, 1, 0.05, tone(teal, -0.22)); A.shade(); // short-sleeve cuff
    L.fill(hx((c && c.legs != null) ? c.legs : 0x3d8a86));
    L.rect("front", 0.3, 0, 0.4, 0.05, tone(teal, -0.3));                     // drawstring waist
    L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  };

  // ---- HOSPITAL: doctor — open WHITE COAT over teal scrub front + steth ----
  // (websearch: white coat has lapels + a chest pocket, worn over teal scrubs,
  // stethoscope draped round the neck). The coat is the jacket SHELL; the
  // torso beneath is the scrub top the open front reveals.
  PAINT.doctor = function (P, c) {
    const coat = "#eef0f0", coatLow = "#d7dadb", scrub = (c && c.collar != null) ? c.collar : 0x3f8f8b;
    const T = P.T, J = P.J, A = P.A, L = P.L, sc = hx(scrub);
    // torso = the scrub top showing through the open coat
    T.fill(sc);
    T.poly("front", [[0.36, 0], [0.5, 0.18], [0.64, 0]], tone(scrub, -0.28));  // scrub V-neck
    // the stethoscope: a dark tube looping the neck, ear-pieces over the shoulders
    T.rect("front", 0.3, 0, 0.06, 0.5, "#1c2024");
    T.rect("front", 0.64, 0, 0.06, 0.42, "#1c2024");
    T.dot("front", 0.66, 0.46, 0.035, "#9aa0a6");                               // chest piece
    T.shade();
    // the WHITE COAT shell — open front, lapels, breast pocket, two hip pockets
    J.fill(coat);
    J.clear("cap", 0, 0, 1, 1);
    J.clearPoly("front", [[0.5 - 0.05, 0], [0.5 + 0.05, 0], [0.5 + 0.18, 1], [0.5 - 0.18, 1]]); // open front
    J.poly("front", [[0.5 - 0.05 - 0.12, 0], [0.5 - 0.05, 0], [0.5 - 0.17, 0.4], [0.5 - 0.05 - 0.16, 0.34]], coatLow); // lapels
    J.poly("front", [[0.5 + 0.05, 0], [0.5 + 0.05 + 0.12, 0], [0.5 + 0.05 + 0.16, 0.34], [0.5 + 0.17, 0.4]], coatLow);
    J.rect("front", 0.14, 0.2, 0.16, 0.1, coatLow); J.rect("front", 0.14, 0.2, 0.16, 0.025, "#c4c8c9"); // breast pocket + lip
    J.rect("front", 0.1, 0.56, 0.22, 0.16, coatLow); J.rect("front", 0.68, 0.56, 0.22, 0.16, coatLow);  // hip pockets
    J.shade();
    A.fill(coat); A.rect("front", 0, 0.86, 1, 0.07, coatLow); A.rect("side", 0, 0.86, 1, 0.07, coatLow); A.shade(); // coat cuff
    L.fill(hx((c && c.legs != null) ? c.legs : 0x39414f));
    L.shade();
    return { torso: 1, arms: 1, legs: 1, jacket: 1 };
  };

  // ---- EMS: navy paramedic blues + reflective stripe + Star-of-Life patch --
  // (websearch: navy shirt/pants, reflective stripe across the chest, a
  // shoulder Star-of-Life patch + a name tape).
  PAINT.ems = function (P, c) {
    const navy = (c && c.torso != null) ? c.torso : 0x24304a, nc = hx(navy);
    const refl = "#d7e24a", silver = "#cdd3d8";
    const T = P.T, A = P.A, L = P.L;
    T.fill(nc);
    T.rect("front", 0.49, 0, 0.02, 1, tone(navy, -0.3));                       // zip placket
    // reflective chest stripe all the way round
    for (const col of ["front", "back", "side"]) {
      T.rect(col, 0, 0.5, 1, 0.09, refl);
      T.rect(col, 0, 0.535, 1, 0.025, silver);
    }
    T.rect("front", 0.12, 0.16, 0.16, 0.04, "#c6d0dc");                        // EMS name tape
    T.poly("front", [[0.7, 0.12], [0.78, 0.16], [0.74, 0.24], [0.66, 0.24], [0.62, 0.16]], refl); // shoulder patch
    T.dot("front", 0.7, 0.18, 0.02, "#2f6bb0");                                // Star-of-Life dot
    T.rect("front", 0, 0.88, 1, 0.12, "#101218");                             // belt at the hem
    T.shade();
    A.fill(nc);
    A.rect("front", 0, 0.34, 1, 0.07, refl); A.rect("side", 0, 0.34, 1, 0.07, refl);   // sleeve reflective band
    A.shade();
    L.fill(hx((c && c.legs != null) ? c.legs : 0x24304a));
    L.rect("side", 0.36, 0, 0.28, 1, tone(navy, -0.28));                       // cargo side seam
    L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  };

  // ---- FIREFIGHTER: tan turnout + yellow reflective bands (NFPA layout) ----
  // (websearch: one band at the hem encircling the coat, one at the chest line,
  // one at each sleeve — tan coat, fluorescent-yellow trim).
  PAINT.firefighter = function (P, c) {
    const tan = (c && c.torso != null) ? c.torso : 0xb09a6e, tc = hx(tan);
    const trim = "#f1e24a", trimLo = "#c9bd3a";
    const T = P.T, A = P.A, L = P.L;
    T.fill(tc);
    T.rect("front", 0.46, 0, 0.08, 1, tone(tan, -0.22));                       // storm-flap front
    // chest-line band + hem band, all the way round
    for (const col of ["front", "back", "side"]) {
      T.rect(col, 0, 0.28, 1, 0.1, trim); T.rect(col, 0, 0.31, 1, 0.04, trimLo);
      T.rect(col, 0, 0.78, 1, 0.1, trim);  T.rect(col, 0, 0.81, 1, 0.04, trimLo);
    }
    T.rect("front", 0.16, 0.5, 0.14, 0.18, tone(tan, -0.18));                  // bellows pocket L
    T.rect("front", 0.7, 0.5, 0.14, 0.18, tone(tan, -0.18));                   // bellows pocket R
    T.rect("front", 0.3, 0.04, 0.4, 0.08, "#3a342a");                         // dark storm collar
    T.shade();
    A.fill(tc);
    A.rect("front", 0, 0.6, 1, 0.1, trim); A.rect("side", 0, 0.6, 1, 0.1, trim);   // sleeve band
    A.rect("front", 0, 0.63, 1, 0.04, trimLo); A.rect("side", 0, 0.63, 1, 0.04, trimLo);
    A.shade();
    L.fill(hx((c && c.legs != null) ? c.legs : 0xb09a6e));
    L.rect("front", 0, 0.42, 1, 0.08, trim); L.rect("side", 0, 0.42, 1, 0.08, trim); // cuff band
    L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  };

  // ---- SOLDIER: digital UCP camo — mottled gray/tan/sage pixel blocks ------
  // (websearch: ~50% gray, 25% tan, 25% sage green, a pixelated/blocky mix).
  PAINT.soldier = function (P, c) {
    const base = (c && c.torso != null) ? c.torso : 0x4a5238, bc = hx(base);
    // a tiny deterministic blot field (no per-frame RNG; the canvas is built
    // once and cached) — gray/tan/sage chips scattered over the base.
    const CHIPS = ["#6f7264", "#8a8470", "#5b6347", "#9a9482", "#454b38"];
    function camo(R, n) {
      R.fill(bc);
      let seed = (base & 0xffff) ^ 0x9e37;
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      for (const col of ["front", "back", "side", "cap"]) {
        for (let i = 0; i < n; i++) {
          const x = rnd(), y = rnd(), w = 0.08 + rnd() * 0.1, h = 0.05 + rnd() * 0.07;
          R.rect(col, x, y, w, h, CHIPS[(rnd() * CHIPS.length) | 0]);
        }
      }
      R.shade();
    }
    camo(P.T, 22);
    P.T.rect("front", 0.46, 0, 0.08, 1, tone(base, -0.25));                    // button placket
    P.T.rect("front", 0.14, 0.34, 0.18, 0.12, tone(base, -0.12));             // chest pocket flap L
    P.T.rect("front", 0.68, 0.34, 0.18, 0.12, tone(base, -0.12));             // chest pocket flap R
    camo(P.A, 8);
    P.A.rect("front", 0.2, 0.06, 0.6, 0.16, tone(base, -0.12));               // shoulder pocket
    camo(P.L, 12);
    P.L.rect("side", 0.2, 0.4, 0.6, 0.18, tone(base, -0.12));                 // cargo thigh pocket
    return { torso: 1, arms: 1, legs: 1 };
  };

  // ---- SECURITY: plain guard blacks + a chest "SECURITY" tape + epaulettes -
  PAINT.security = function (P, c) {
    const body = (c && c.torso != null) ? c.torso : 0x1c1f26, bc = hx(body);
    const T = P.T, A = P.A, L = P.L;
    T.fill(bc);
    T.rect("front", 0.49, 0, 0.02, 1, tone(body, 0.18));                       // placket
    T.rect("front", 0.06, 0, 0.18, 0.12, tone(body, 0.22)); T.rect("front", 0.76, 0, 0.18, 0.12, tone(body, 0.22)); // epaulettes
    T.rect("front", 0.28, 0.2, 0.44, 0.06, "#d8b73a");                        // gold SECURITY tape
    T.rect("front", 0, 0.9, 1, 0.1, "#0d0f14");                              // belt
    T.shade();
    A.fill(bc); A.rect("front", 0, 0.88, 1, 0.06, tone(body, 0.15)); A.shade();
    L.fill(hx((c && c.legs != null) ? c.legs : 0x1c1f26)); L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  };

  // ---- OFFICE: a dress shirt + visible tie (no jacket — desk worker) -------
  PAINT.office = function (P, c) {
    const shirt = (c && c.torso != null) ? c.torso : 0x9ab4c8, tieHex = 0x223247;
    const T = P.T, A = P.A, sc = hx(shirt);
    T.fill(sc);
    T.poly("front", [[0.4, 0], [0.5, 0.1], [0.46, 0.02]], tone(shirt, -0.2));  // collar L
    T.poly("front", [[0.6, 0], [0.5, 0.1], [0.54, 0.02]], tone(shirt, -0.2));  // collar R
    T.rect("front", 0.49, 0.06, 0.02, 0.86, tone(shirt, -0.12));             // button placket
    T.poly("front", [[0.45, 0.02], [0.55, 0.02], [0.53, 0.1], [0.47, 0.1]], tone(tieHex, -0.2)); // tie knot
    T.rect("front", 0.47, 0.1, 0.06, 0.56, hx(tieHex));                        // tie body
    T.poly("front", [[0.47, 0.66], [0.53, 0.66], [0.5, 0.74]], hx(tieHex));
    T.shade();
    A.fill(sc); A.rect("front", 0, 0.88, 1, 0.06, tone(shirt, -0.18)); A.rect("side", 0, 0.88, 1, 0.06, tone(shirt, -0.18)); A.shade();
    return { torso: 1, arms: 1 };
  };

  // ---- SHERIFF: county khaki shirt over brown, with a star badge ----------
  PAINT.sheriff = function (P, c) {
    const khaki = (c && c.torso != null) ? c.torso : 0xb8a070, kc = hx(khaki);
    const T = P.T, A = P.A, L = P.L;
    T.fill(kc);
    T.rect("front", 0.49, 0, 0.02, 1, tone(khaki, -0.22));                     // placket
    T.rect("front", 0.14, 0.26, 0.22, 0.13, tone(khaki, -0.16)); T.rect("front", 0.64, 0.26, 0.22, 0.13, tone(khaki, -0.16)); // flap pockets
    T.rect("front", 0.14, 0.26, 0.22, 0.04, tone(khaki, -0.32)); T.rect("front", 0.64, 0.26, 0.22, 0.04, tone(khaki, -0.32));
    T.rect("front", 0.06, 0, 0.16, 0.12, tone(khaki, -0.12)); T.rect("front", 0.78, 0, 0.16, 0.12, tone(khaki, -0.12)); // epaulettes
    // five-point star badge (a small ring of dots reads as a star at distance)
    T.dot("front", 0.26, 0.16, 0.03, "#e8c454");
    T.rect("front", 0, 0.88, 1, 0.12, "#1a140c");                            // brown duty belt
    T.shade();
    A.fill(kc); A.rect("front", 0, 0.86, 1, 0.06, tone(khaki, -0.2)); A.shade();
    L.fill(hx((c && c.legs != null) ? c.legs : 0x5a4632));
    L.rect("side", 0.36, 0, 0.28, 1, tone(0x5a4632, -0.25));                   // trouser stripe
    L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  };

  // ---- HOMELESS: layered, mismatched, dirty, frayed (websearch: an open
  //      ragged outer coat over a different-colored under-layer, distressed,
  //      oversized; warmth-by-layering). The OUTER coat = the jacket shell
  //      (open, tattered hem); the torso beneath = a mismatched under-shirt.
  PAINT.homeless = function (P, c) {
    const coat = (c && c.torso != null) ? c.torso : 0x4a4236, under = (c && c.collar != null) ? c.collar : 0x6b5a48;
    const cc = hx(coat), uc = hx(under), grime = "rgba(38,30,20,0.4)";
    const T = P.T, J = P.J, A = P.A, L = P.L;
    // torso = a grubby mismatched under-shirt/hoodie the open coat reveals
    T.fill(uc);
    T.poly("front", [[0.36, 0], [0.5, 0.16], [0.64, 0]], tone(under, -0.3));   // ragged neckline
    T.rect("front", 0.2, 0.6, 0.3, 0.14, grime);                              // a dirt smear
    T.rect("front", 0.55, 0.35, 0.18, 0.1, grime);
    T.rect("front", 0.4, 0.78, 0.22, 0.06, tone(under, -0.4));                // a frayed tear line
    T.shade();
    // the OUTER coat shell — open, uneven tattered hem, a patch, grime
    J.fill(cc);
    J.clear("cap", 0, 0, 1, 1);
    J.clearPoly("front", [[0.5 - 0.06, 0], [0.5 + 0.06, 0], [0.5 + 0.2, 1], [0.5 - 0.2, 1]]); // hangs open
    // a ragged, uneven bottom hem (clear small notches out of the coat edge)
    J.clear("front", 0.1, 0.92, 0.08, 0.08); J.clear("front", 0.3, 0.95, 0.1, 0.05);
    J.clear("front", 0.62, 0.93, 0.08, 0.07); J.clear("front", 0.82, 0.95, 0.1, 0.05);
    J.clear("back", 0.2, 0.94, 0.12, 0.06); J.clear("back", 0.55, 0.95, 0.14, 0.05);
    J.rect("front", 0.16, 0.4, 0.14, 0.12, tone(coat, 0.18));                  // a mismatched patch
    J.rect("front", 0.16, 0.4, 0.14, 0.12, grime);
    J.rect("back", 0.3, 0.3, 0.3, 0.2, grime);                                // back grime
    J.poly("front", [[0.32, 0], [0.44, 0], [0.4, 0.22]], tone(coat, -0.22));   // sloppy lapels
    J.poly("front", [[0.56, 0], [0.68, 0], [0.6, 0.22]], tone(coat, -0.22));
    J.shade();
    A.fill(cc);
    A.rect("front", 0, 0.82, 1, 0.1, tone(coat, -0.3));                        // rolled/frayed cuff
    A.rect("front", 0.3, 0.45, 0.4, 0.1, grime);
    A.shade();
    L.fill(hx((c && c.legs != null) ? c.legs : 0x3a3026));
    L.rect("front", 0.2, 0.5, 0.3, 0.08, tone(0x3a3026, -0.4));               // knee tear
    L.rect("front", 0.1, 0.86, 0.8, 0.06, grime);                            // dirty cuffs
    L.shade();
    return { torso: 1, arms: 1, legs: 1, jacket: 1 };
  };

  PAINT.tracksuit = function (P, c) {
    const body = (c && c.torso != null) ? c.torso : 0x2bb673, white = "#eef3f7";
    const T = P.T, A = P.A, L = P.L, bc = hx(body);
    T.fill(bc);
    T.rect("front", 0.48, 0, 0.04, 1, white);                       // zipper line
    T.dot("front", 0.5, 0.07, 0.02, "#aab4ba");                     // zip pull
    T.rect("front", 0.3, 0, 0.4, 0.05, tone(body, -0.3));           // zip collar
    T.rect("side", 0.36, 0, 0.28, 1, white);                        // white side stripes
    T.rect("front", 0, 0.92, 1, 0.08, tone(body, -0.35));           // elastic hem
    T.shade();
    A.fill(bc); A.rect("side", 0.36, 0, 0.28, 1, white); A.rect("front", 0, 0.88, 1, 0.08, tone(body, -0.3)); A.shade();
    L.fill(hx((c && c.legs != null) ? c.legs : 0x20242c));
    L.rect("side", 0.36, 0, 0.28, 1, white);
    L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  };

  // STREET BASICS — the floor: collar line + tiny chest print + waistband,
  // tinted to the wearer's own shirt color (cached per hex — the civvie
  // palette is small, so a dozen shared sets dress the whole street).
  // A PLAIN SHIRT reads as a shirt because of its SEAMS, not a billboard:
  // a soft crew collar, a centre placket, a low hem — all subtle tones of
  // the body color (no high-contrast print, which on a tan body read as a
  // random dark patch). Structure from quiet seams; the rest is the gradient.
  PAINT.basics = function (P, c) {
    const body = (c && c.torso != null) ? c.torso : 0x8a939c;
    const T = P.T, A = P.A, bc = hx(body);
    T.fill(bc);
    T.poly("front", [[0.36, 0], [0.64, 0], [0.5, 0.12]], tone(body, -0.22)); // crew neckline (soft V)
    T.rect("front", 0.49, 0.1, 0.02, 0.5, tone(body, -0.13));       // centre placket seam (thin, subtle)
    T.rect("back", 0.34, 0, 0.32, 0.05, tone(body, -0.2));          // back collar band
    T.rect("front", 0, 0.93, 1, 0.07, tone(body, -0.2));            // hem
    T.rect("side", 0, 0.93, 1, 0.07, tone(body, -0.2));
    T.rect("back", 0, 0.93, 1, 0.07, tone(body, -0.2));
    T.shade();
    A.fill(bc); A.rect("front", 0, 0.9, 1, 0.06, tone(body, -0.18)); A.rect("side", 0, 0.9, 1, 0.06, tone(body, -0.18)); A.shade(); // sleeve cuff
    return { torso: 1, arms: 1 };                                   // legs keep their own flat color
  };

  // ============================================================
  //  STREETWEAR / WORKWEAR / SERVICE / DRESSES — the new garment painters.
  //  Each follows the scrubs/ems structure: fill base, paint the structure,
  //  shade(), return which parts it painted. colors.torso overrides the base.
  // ============================================================

  // HOODIE — kangaroo pocket + drawstrings + a hood lump at the neck.
  PAINT.hoodie = function (P, c) {
    const body = (c && c.torso != null) ? c.torso : 0x7a4a3a, bc = hx(body);
    const T = P.T, A = P.A, hoodLo = tone(body, -0.22);
    T.fill(bc);
    T.rect("front", 0.18, 0, 0.64, 0.14, hoodLo);                  // hood gathered at the neck (front)
    T.rect("back", 0.14, 0, 0.72, 0.34, hoodLo);                   // the hood lump down the back
    T.dot("front", 0.42, 0.13, 0.018, "#e9e4d8");                  // drawstring tips
    T.dot("front", 0.58, 0.13, 0.018, "#e9e4d8");
    T.rect("front", 0.42, 0.12, 0.02, 0.16, "#d9d3c4");           // strings hang
    T.rect("front", 0.58, 0.12, 0.02, 0.16, "#d9d3c4");
    T.rect("front", 0.26, 0.6, 0.48, 0.26, hoodLo);               // kangaroo pocket
    T.rect("front", 0.26, 0.6, 0.48, 0.03, tone(body, -0.34));    // pocket top seam
    T.rect("front", 0, 0.92, 1, 0.08, tone(body, -0.3));         // ribbed hem
    T.rect("side", 0, 0.92, 1, 0.08, tone(body, -0.3));
    T.shade();
    A.fill(bc); A.rect("front", 0, 0.9, 1, 0.08, tone(body, -0.3)); A.rect("side", 0, 0.9, 1, 0.08, tone(body, -0.3)); A.shade(); // ribbed cuff
    return { torso: 1, arms: 1 };
  };

  // WIFEBEATER — a ribbed white tank/undershirt: wide shoulder straps, a low
  // scoop neckline, and open armholes so the SHOULDERS AND ARMS READ AS BARE
  // SKIN, not sleeves. Every other garment here paints the arm ROW the same
  // hex as the torso (a sleeve matching the shirt) — that's exactly wrong for
  // a tank top, and simply NOT painting the arm row wouldn't give skin either
  // (an unpainted arm falls back to whatever flat "arms" color the wearer's
  // rig was first built/dressed with, e.g. a prior outfit's sleeve color —
  // see clothes.js's dress()/restore() pair). So this is the one painter that
  // deliberately fills the ARM row with a skin tone. The atlas is SHARED by
  // every wearer of this outfit (one canvas → one material, the whole point
  // of the atlas cache), so it can't know any individual wearer's own skin
  // tone — this paints one plausible mid tone as the closest the shared-atlas
  // architecture allows; outfits.js's flat-fallback path also carries the
  // same tone in colors.arms in case this painter is ever unavailable.
  PAINT.wifebeater = function (P, c) {
    const white = (c && c.torso != null) ? c.torso : 0xe6e3d9;   // slightly grimy off-white ribbed cotton
    const skin = (c && c.skin != null) ? c.skin : 0xcf9a72;      // shared-atlas approximation — see note above
    const T = P.T, A = P.A;
    const wc = hx(white), sk = hx(skin), rib = tone(white, -0.09), grime = "rgba(40,34,24,0.16)";
    // base the whole torso row in skin — the low neckline + open armholes
    // (both left unpainted below) show straight through to this.
    T.fill(sk);
    // FRONT: wide straps over the shoulders, a low scoop neckline dips a
    // triangular notch of bare skin into the top of the panel below them.
    T.rect("front", 0.12, 0, 0.18, 0.2, wc);
    T.rect("front", 0.70, 0, 0.18, 0.2, wc);
    T.rect("front", 0.12, 0.16, 0.76, 0.8, wc);                    // the tank body
    T.poly("front", [[0.30, 0.16], [0.70, 0.16], [0.5, 0.36]], sk); // scoop cut back to skin
    // BACK: straps + a modest scoop of its own (bare shoulder blades)
    T.rect("back", 0.12, 0, 0.18, 0.22, wc);
    T.rect("back", 0.70, 0, 0.18, 0.22, wc);
    T.rect("back", 0.12, 0.2, 0.76, 0.76, wc);
    T.poly("back", [[0.32, 0.2], [0.68, 0.2], [0.5, 0.34]], sk);
    // SIDE: the open armhole — bare up top, fabric only from the waist down
    T.rect("side", 0, 0.3, 1, 0.66, wc);
    // ribbed texture: thin vertical lines through the fabric only
    for (const col of ["front", "back", "side"]) for (let x = 0.08; x < 1; x += 0.11) T.rect(col, x, 0.34, 0.014, 0.56, rib);
    T.rect("front", 0.2, 0.5, 0.16, 0.1, grime); T.rect("back", 0.5, 0.55, 0.2, 0.1, grime);   // a couple of grubby smudges
    T.rect("front", 0, 0.92, 1, 0.08, tone(white, -0.18));         // hem
    T.rect("back", 0, 0.92, 1, 0.08, tone(white, -0.18));
    T.shade();
    A.fill(sk); A.shade();                                          // bare arms, full length — no sleeve at all
    return { torso: 1, arms: 1 };                                   // legs keep the catalog's flat sweatpant color
  };

  // PUFFER — horizontal quilted channels + a zip; warm color default.
  PAINT.puffer = function (P, c) {
    const body = (c && c.torso != null) ? c.torso : 0x223a55, bc = hx(body);
    const T = P.T, A = P.A, seam = tone(body, -0.3), hi = tone(body, 0.16);
    T.fill(bc);
    for (const col of ["front", "back", "side"]) {
      for (let y = 0.08; y < 0.95; y += 0.16) { T.rect(col, 0, y, 1, 0.02, seam); T.rect(col, 0, y + 0.03, 1, 0.04, hi); } // quilt channels + puffed highlight
    }
    T.rect("front", 0.48, 0, 0.04, 1, seam);                       // centre zip
    T.dot("front", 0.5, 0.06, 0.02, "#cdd3d8");                    // zip pull
    T.rect("front", 0.3, 0, 0.4, 0.08, tone(body, -0.2));        // stand collar
    T.shade();
    A.fill(bc);
    for (let y = 0.1; y < 0.95; y += 0.18) A.rect("front", 0, y, 1, 0.02, seam);
    for (let y = 0.1; y < 0.95; y += 0.18) A.rect("side", 0, y, 1, 0.02, seam);
    A.shade();
    return { torso: 1, arms: 1 };
  };

  // DENIM JACKET — button placket, chest flap pockets, contrast stitch seams.
  PAINT.denim_jacket = function (P, c) {
    const body = (c && c.torso != null) ? c.torso : 0x3c5a7a, bc = hx(body);
    const T = P.T, A = P.A, stitch = "#d8b87a", dk = tone(body, -0.22);
    T.fill(bc);
    T.rect("front", 0.49, 0, 0.02, 1, dk);                         // button placket
    for (let i = 0; i < 5; i++) T.dot("front", 0.5, 0.12 + i * 0.18, 0.013, "#c9cdd2"); // buttons
    T.rect("front", 0.16, 0.22, 0.18, 0.14, dk); T.rect("front", 0.66, 0.22, 0.18, 0.14, dk); // chest flap pockets
    T.rect("front", 0.16, 0.22, 0.18, 0.02, stitch); T.rect("front", 0.66, 0.22, 0.18, 0.02, stitch); // stitch lines
    T.rect("front", 0.3, 0, 0.4, 0.06, dk);                       // collar
    T.rect("front", 0, 0.9, 1, 0.05, stitch);                     // hem stitch band
    T.shade();
    A.fill(bc); A.rect("front", 0, 0.84, 1, 0.1, dk); A.rect("front", 0, 0.84, 1, 0.02, stitch); A.rect("side", 0, 0.84, 1, 0.1, dk); A.shade(); // buttoned cuff
    return { torso: 1, arms: 1 };
  };

  // VARSITY — body color torso, CONTRAST sleeves, a chest letter + stripe trim.
  PAINT.varsity = function (P, c) {
    const body = (c && c.torso != null) ? c.torso : 0x6e1f2b, sleeve = (c && c.collar != null) ? c.collar : 0xeae6dc;
    const T = P.T, A = P.A, bc = hx(body), sc = hx(sleeve), trim = tone(body, -0.3);
    T.fill(bc);
    T.rect("front", 0.48, 0, 0.04, 1, "#d8c98a");                  // snap placket
    T.rect("front", 0.18, 0.18, 0.26, 0.34, sc);                  // chest patch (felt block)
    T.rect("front", 0.22, 0.22, 0.18, 0.26, bc);                  // the letter field
    T.poly("front", [[0.25, 0.45], [0.31, 0.24], [0.37, 0.45], [0.34, 0.45], [0.31, 0.34], [0.28, 0.45]], "#d8c98a"); // a chunky "A"
    T.rect("front", 0.3, 0, 0.4, 0.06, sc);                       // collar in sleeve color
    T.rect("front", 0, 0.9, 1, 0.07, sc); T.rect("front", 0, 0.9, 1, 0.02, trim); // ribbed striped hem
    T.shade();
    A.fill(sc); A.rect("front", 0, 0.88, 1, 0.08, hx(tone2(sleeve, -0.2))); A.rect("side", 0, 0.88, 1, 0.08, hx(tone2(sleeve, -0.2))); A.shade(); // contrast leather sleeves + ribbed cuff
    return { torso: 1, arms: 1 };
  };

  // GRAPHIC TEE — solid tee + a bold centered graphic block (color via collar).
  PAINT.graphic_tee = function (P, c) {
    const body = (c && c.torso != null) ? c.torso : 0x1c1d22, gfx = (c && c.collar != null) ? c.collar : 0xd84a3a;
    const T = P.T, A = P.A, bc = hx(body), gc = hx(gfx);
    T.fill(bc);
    T.poly("front", [[0.38, 0], [0.62, 0], [0.5, 0.1]], tone(body, -0.25)); // crew neck
    T.rect("front", 0.3, 0.28, 0.4, 0.36, gc);                    // graphic field
    T.poly("front", [[0.5, 0.3], [0.66, 0.5], [0.5, 0.62], [0.34, 0.5]], tone(gfx, 0.3)); // a diamond motif
    T.dot("front", 0.5, 0.46, 0.05, bc);                          // negative-space center
    T.rect("front", 0, 0.94, 1, 0.04, tone(body, -0.2));        // hem
    T.shade();
    A.fill(bc); A.rect("front", 0, 0.86, 1, 0.05, tone(body, -0.2)); A.rect("side", 0, 0.86, 1, 0.05, tone(body, -0.2)); A.shade();
    return { torso: 1, arms: 1 };
  };

  // COVERALLS — a mechanic ONE-PIECE: zip, chest patch, hip pockets, leg seams.
  PAINT.coveralls = function (P, c) {
    const body = (c && c.torso != null) ? c.torso : 0x394a5a, bc = hx(body);
    const T = P.T, A = P.A, L = P.L, dk = tone(body, -0.25);
    T.fill(bc);
    T.rect("front", 0.48, 0, 0.04, 1, dk);                         // full-length zip
    T.rect("front", 0.16, 0.18, 0.2, 0.04, "#e6e2d6");            // oval name patch
    T.rect("front", 0.16, 0.16, 0.2, 0.1, dk); T.rect("front", 0.16, 0.18, 0.2, 0.04, "#e6e2d6");
    T.rect("front", 0.62, 0.16, 0.22, 0.13, dk);                  // chest pocket
    T.rect("front", 0.1, 0.68, 0.24, 0.16, dk); T.rect("front", 0.66, 0.68, 0.24, 0.16, dk); // hip pockets
    T.rect("front", 0.2, 0.5, 0.6, 0.05, dk);                     // waist seam
    T.shade();
    A.fill(bc); A.rect("front", 0, 0.86, 1, 0.06, dk); A.rect("side", 0, 0.86, 1, 0.06, dk); A.shade();
    L.fill(bc); L.rect("side", 0.38, 0, 0.24, 1, dk); L.rect("front", 0.2, 0.4, 0.6, 0.12, dk); L.shade(); // leg seam + knee pocket
    return { torso: 1, arms: 1, legs: 1 };
  };

  // CHEF — white double-breasted jacket + a colored neckerchief.
  PAINT.chef = function (P, c) {
    const white = "#f0efe9", lo = "#dcdbd2";
    const T = P.T, A = P.A, kerch = (c && c.collar != null) ? c.collar : 0x9a2a2a;
    T.fill(white);
    // two columns of cloth knot buttons (double-breasted)
    T.rect("front", 0.4, 0.1, 0.2, 0.78, lo);                     // the overlap panel shadow
    T.rect("front", 0.42, 0.1, 0.16, 0.78, white);                // overlap panel face
    for (let i = 0; i < 4; i++) { T.dot("front", 0.42, 0.16 + i * 0.18, 0.018, lo); T.dot("front", 0.58, 0.16 + i * 0.18, 0.018, lo); }
    T.poly("front", [[0.34, 0], [0.5, 0.12], [0.66, 0]], hx(kerch)); // neckerchief at the throat
    T.rect("front", 0, 0.92, 1, 0.05, lo);                        // hem
    T.shade();
    A.fill(white); A.rect("front", 0, 0.86, 1, 0.08, lo); A.rect("side", 0, 0.86, 1, 0.08, lo); A.shade();
    return { torso: 1, arms: 1 };
  };

  // WAITER — black vest + white shirt + black bow tie (reuses formal helpers).
  PAINT.waiter = function (P, c) {
    formalTorso(P.T, P.J, 0x16171c, "rgb(30,31,37)", { bow: true, gap: 0.05, lapel: 0.07, lapelType: "notch", vest: 0x141519, ctx: P.ctx });
    formalLimbs(P.A, P.L, 0x16171c, 0x141519, false, { ctx: P.ctx });
    return { torso: 1, arms: 1, legs: 1, jacket: 1 };
  };

  // PILOT — crisp white shirt, black tie, gold EPAULETTES + wings.
  PAINT.pilot = function (P, c) {
    const white = "#eef0f2", lo = "#d6d9dd";
    const T = P.T, A = P.A, L = P.L;
    T.fill(white);
    T.rect("front", 0.49, 0, 0.02, 0.9, lo);                       // placket
    T.poly("front", [[0.42, 0.02], [0.58, 0.02], [0.55, 0.1], [0.45, 0.1]], "#15161c"); // tie knot
    T.rect("front", 0.47, 0.1, 0.06, 0.5, "#15161c");             // tie
    T.rect("front", 0.06, 0, 0.18, 0.1, lo); T.rect("front", 0.76, 0, 0.18, 0.1, lo); // epaulette base
    for (const x of [0.08, 0.14, 0.2]) T.rect("front", x, 0.02, 0.03, 0.06, "#e8c454"); // gold bars L
    for (const x of [0.78, 0.84, 0.9]) T.rect("front", x, 0.02, 0.03, 0.06, "#e8c454"); // gold bars R
    T.rect("front", 0.62, 0.2, 0.1, 0.04, "#e8c454");            // gold wings
    T.shade();
    A.fill(white); A.rect("front", 0, 0.86, 1, 0.06, lo); A.rect("side", 0, 0.86, 1, 0.06, lo); A.shade();
    L.fill(hx((c && c.legs != null) ? c.legs : 0x1a1c24)); L.rect("side", 0.4, 0, 0.2, 1, "#0d0e12"); L.shade(); // black slacks w/ stripe
    return { torso: 1, arms: 1, legs: 1 };
  };

  // DRESS — an A-line dress: fitted bodice, FLARED hem painted onto the LEG row
  // (the skirt sweeps out at the bottom). color via key/torso → many colors.
  PAINT.dress = function (P, c) {
    const body = (c && c.torso != null) ? c.torso : 0x8a2050, bc = hx(body);
    const T = P.T, A = P.A, L = P.L, hi = tone(body, 0.14), lo = tone(body, -0.2);
    T.fill(bc);
    T.poly("front", [[0.34, 0], [0.5, 0.18], [0.66, 0]], lo);      // scoop neckline
    T.rect("front", 0.3, 0.5, 0.4, 0.04, lo);                     // waist seam (bodice meets skirt)
    T.rect("front", 0, 0.86, 1, 0.14, hi);                        // the skirt begins flaring (lighter sweep)
    T.shade();
    A.fill(bc); A.rect("front", 0, 0.42, 1, 0.05, lo); A.rect("side", 0, 0.42, 1, 0.05, lo); A.shade(); // cap-sleeve cuff
    // the LEG row carries the A-line skirt: flared (wider light wedge low),
    // hem sweep, so the legs read as a skirt, not trousers.
    L.fill(bc);
    for (const col of ["front", "back", "side"]) {
      L.poly(col, [[0.3, 0], [0.7, 0], [1, 1], [0, 1]], hi);       // flare outward to the hem
      L.rect(col, 0, 0.92, 1, 0.06, lo);                          // hem band
    }
    L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  };

  // SUNDRESS — light dress + a FLORAL dot pattern (deterministic blot field).
  PAINT.sundress = function (P, c) {
    const body = (c && c.torso != null) ? c.torso : 0xf0d9a0, bc = hx(body);
    const flo1 = (c && c.collar != null) ? c.collar : 0xd86a8a, flo2 = tone(body, -0.3);
    const T = P.T, A = P.A, L = P.L;
    let seed = (body & 0xffff) ^ 0x5a5a;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    function flowers(R, n) {
      R.fill(bc);
      for (const col of ["front", "back", "side"]) for (let i = 0; i < n; i++) {
        const x = rnd(), y = rnd(), r = 0.025 + rnd() * 0.02, fc = rnd() < 0.5 ? hx(flo1) : hx(flo2);
        R.dot(col, x, y, r, fc); R.dot(col, x, y, r * 0.4, "#fff7e2");
      }
    }
    flowers(T, 14);
    T.poly("front", [[0.34, 0], [0.5, 0.16], [0.66, 0]], tone(body, -0.2)); // neckline
    T.rect("front", 0.26, 0, 0.1, 0.16, bc); T.rect("front", 0.64, 0, 0.1, 0.16, bc); // straps gap
    T.rect("front", 0.3, 0.5, 0.4, 0.03, tone(body, -0.22));      // waist tie
    T.shade();
    A.fill(bc); A.shade();
    flowers(L, 12);
    for (const col of ["front", "back", "side"]) L.rect(col, 0, 0.92, 1, 0.05, tone(body, -0.2)); // hem
    L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  };

  // TRACKSUIT VARIANTS — color/stripe themes. PAINT.tracksuit already exists;
  // these are thin wrappers selecting palette via the color record so the cache
  // keys stay distinct (tracksuit2/tracksuit3) without duplicating the painter.
  PAINT.tracksuit2 = function (P, c) {                            // red w/ white stripes
    return PAINT.tracksuit(P, c && c.torso != null ? c : { torso: 0xb22a2a, legs: 0x161616 });
  };
  PAINT.tracksuit3 = function (P, c) {                            // navy w/ gold stripes (re-tints the stripe via collar handled below)
    return PAINT.tracksuit(P, c && c.torso != null ? c : { torso: 0x1c2440, legs: 0x14161c });
  };

  // ============================================================
  //  THE CACHE — one set per outfit key, shared by every wearer.
  // ============================================================
  const sets = {};                                  // key → {mat, tex, parts}

  // ============================================================
  //  SUIT_STYLES — the parameterized suit catalog. A suit's cache key is
  //  "suit|"+index, so these INDICES ARE A STABLE CONTRACT (outfits.js / NPC
  //  casting references "suit|N"). Append new styles to the END only; never
  //  reorder. Each: {body, tie, pattern, db, vest, lapel, legs, name}.
  //  tux:true routes through PAINT.tuxedo instead of PAINT.suit.
  // ============================================================
  const SUIT_STYLES = [
    // 0-3: the bread-and-butter 2-piece notch business suits
    { name: "Charcoal Suit",            body: 0x2c2f36, tie: 0x7a1f2b, pattern: "solid" },
    { name: "Navy Suit",                body: 0x1c2438, tie: 0x8a1f2b, pattern: "solid" },
    { name: "Mid-Grey Suit",            body: 0x53585f, tie: 0x274690, pattern: "solid" },
    { name: "Black Suit",               body: 0x191a1f, tie: 0x9a9da3, pattern: "solid" },
    // 4-5: pinstripe
    { name: "Navy Pinstripe Suit",      body: 0x1b2236, tie: 0x6e1f2b, pattern: "pinstripe" },
    { name: "Charcoal Pinstripe Suit",  body: 0x2b2e35, tie: 0x274690, pattern: "pinstripe" },
    // 6-7: double-breasted peak
    { name: "Navy Double-Breasted Suit",     body: 0x1a2236, tie: 0x8a1f2b, pattern: "solid", db: true, lapel: "peak" },
    { name: "Charcoal Double-Breasted Suit", body: 0x2a2d34, tie: 0x1c1d22, pattern: "solid", db: true, lapel: "peak" },
    // 8-10: 3-piece (waistcoat)
    { name: "Charcoal 3-Piece Suit",    body: 0x2c2f36, tie: 0x7a1f2b, pattern: "solid", vest: true },
    { name: "Navy 3-Piece Suit",        body: 0x1c2438, tie: 0x274690, pattern: "solid", vest: true },
    { name: "Burgundy 3-Piece Suit",    body: 0x4a1c28, tie: 0x1c1d22, pattern: "solid", vest: 0x3a1620 },
    // 11-14: color/seasonal suits
    { name: "Tan Suit",                 body: 0xae9468, tie: 0x4a3422, pattern: "solid", legs: 0xa68d62 },
    { name: "Olive Suit",              body: 0x55582f, tie: 0x2c2c20, pattern: "solid", legs: 0x4d5029 },
    { name: "Burgundy Dinner Suit",     body: 0x5a1f2c, tie: 0x141519, pattern: "solid", lapel: "shawl" },
    { name: "Powder-Blue Suit",         body: 0x7d9bb8, tie: 0x24405e, pattern: "solid", legs: 0x6f8da8 },
    { name: "All-White Suit",           body: 0xe9e7df, tie: 0x9a9d9a, pattern: "solid", legs: 0xe2e0d6 },
    // 15-16: patterned tailoring
    { name: "Brown Glen-Check Suit",    body: 0x6e5c44, tie: 0x3a2c1e, pattern: "glen", legs: 0x655439 },
    { name: "Grey Windowpane Suit",     body: 0x595d63, tie: 0x6e1f2b, pattern: "windowpane" },
    // 17-20: TUXEDOS (tux:true)
    { name: "Black Shawl Tuxedo",       tux: true, body: 0x16171c, lapel: "shawl" },
    { name: "Midnight-Blue Tuxedo",     tux: true, body: 0x141a2e, lapel: "shawl" },
    { name: "White Dinner Jacket",      tux: true, body: 0xeae8e0, lapel: "shawl", legs: 0x16171c, lapelCss: "rgb(225,222,212)" },
    { name: "Double-Breasted Peak Tuxedo", tux: true, body: 0x16171c, lapel: "peak", db: true },
  ];
  CBZ.citySuitStyles = SUIT_STYLES;                 // outfits.js reads names/indices

  // resolve an outfit record/id to a cache key (null = no painted look)
  function keyOf(rec, ch) {
    if (!rec) return null;
    const id = rec.id || (typeof rec === "string" ? rec : null);
    if (!id) return null;
    const c = rec.colors || {};
    if (id.indexOf("gang:") === 0) {
      // gang = a SOLID shirt + a bandana MESH accessory (cityAttachBandana),
      // never a painted sash. The wiring agent attaches the bandana and lets
      // the flat shirt color stand → no painted canvas for a gang body.
      if (plainCivvies()) return null;
      return "gang|" + (c.torso | 0) + "|" + (c.collar | 0);
    }
    if (CIVVIE_IDS[id] && !rec.forcePaint) {         // the street nobody
      // PLAIN by default — let recolorRig paint flat shirt + jean legs + shoes.
      // (a BOUGHT hoodie sets rec.forcePaint so the painted look still applies.)
      if (plainCivvies()) return null;
      return "basics|" + (c.torso != null ? c.torso | 0 : 0x8a939c);
    }
    // color-keyed garments: same painter, distinct cache per color so the store
    // can sell a dozen dress colors without collapsing them to one texture.
    if (id === "dress" || id === "sundress") {
      return id + "|" + (c.torso != null ? c.torso | 0 : 0) + "|" + (c.collar != null ? c.collar | 0 : 0);
    }
    if (id === "suit") {
      // style index: explicit rec.style wins; else derive a stable per-rig pick.
      let si = (rec.style != null) ? (rec.style | 0)
        : (ch && ch.group && ch.group.id != null ? (ch.group.id % SUIT_STYLES.length) : 0);
      if (si < 0 || si >= SUIT_STYLES.length) si = 0;
      return "suit|" + si;
    }
    if (id === "construction") return "hivis|" + (c.torso != null ? c.torso | 0 : 0xffb43a); // same painter, site-orange default
    // skin-showing garments: the bare shoulders/arms in the atlas must match
    // the WEARER's actual skin, so the tone joins the cache key (one atlas per
    // tone actually seen — a handful, not per-rig).
    if (id === "wifebeater") {
      const sk = (c.skin != null) ? c.skin | 0 : (ch && ch.skinTone != null ? ch.skinTone | 0 : 0xcf9a72);
      return "wifebeater|" + sk;
    }
    if (PAINT[id]) return id;
    return null;                                    // leather/tactical/designer… stay flat
  }

  function buildSet(key, rec) {
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");
    const P = { T: rowPainter(ctx, "torso"), J: rowPainter(ctx, "jacket"), A: rowPainter(ctx, "arm"), L: rowPainter(ctx, "leg"), ctx: ctx };
    const c = (rec && rec.colors) || {};
    const kind = key.split("|")[0];
    // pre-fill the WHOLE atlas opaque (base cloth color) so rows a painter
    // skips can never mip-blend transparency into a used row at distance
    // (alphaTest would eat the edge texels). Painters overdraw their rows;
    // the jacket's gap/cap clears cut through this layer too.
    ctx.fillStyle = hx(c.torso != null ? c.torso : (key.split("|")[1] | 0) || 0x444444);
    ctx.fillRect(0, 0, W, H);
    let parts = null;
    if (kind === "suit") {
      const st = SUIT_STYLES[(key.split("|")[1] | 0)] || SUIT_STYLES[0];
      parts = st.tux ? PAINT.tuxedo(P, c, st) : PAINT.suit(P, c, st);
    }
    else if (kind === "basics") parts = PAINT.basics(P, { torso: key.split("|")[1] | 0 });
    else if (kind === "hivis") parts = PAINT.hivis(P, { torso: key.split("|")[1] | 0, legs: c.legs, arms: c.arms }); // shared by construction key
    else if (kind === "gang") { const seg = key.split("|"); parts = PAINT.gang(P, { torso: seg[1] | 0, collar: seg[2] | 0, legs: c.legs }); }
    else if (kind === "wifebeater") parts = PAINT.wifebeater(P, { torso: c.torso, skin: key.split("|")[1] | 0 });   // tone rides the key (see keyOf)
    else if (PAINT[kind]) parts = PAINT[kind](P, c);
    if (!parts) return null;
    const tex = new THREE.CanvasTexture(cv);
    tex.magFilter = THREE.LinearFilter;
    const m = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5 });
    m._shared = true;                               // clearCityPeds must never dispose it
    return { mat: m, tex, parts };
  }

  function getSet(recOrId, ch) {
    const rec = typeof recOrId === "string" ? { id: recOrId } : recOrId;
    const key = keyOf(rec, ch);
    if (!key) return null;
    let s = sets[key];
    if (s === undefined) { s = sets[key] = buildSet(key, rec); }
    return s;
  }
  CBZ.cityClothesTex = getSet;

  // ---- UV-remapped part geometries: ONE per part type, shared ---------------
  const geoms = {};
  const FACE_COL = ["side", "side", "cap", "cap", "front", "back"]; // +x -x +y -y +z -z
  // dims/band are optional overrides: two-segment limbs (entities/character.js)
  // tag each segment mesh with its own box size + the vertical BAND of the
  // garment row that segment shows (band [0,1] = whole row = legacy). An upper
  // arm shows ~the top half of the sleeve row; the forearm shows the bottom —
  // so a cuff painted low in the row still lands on the actual wrist.
  function clothGeom(part, dims, band) {
    const d = dims || DIMS[part];
    const b0 = band ? band[0] : 0, b1 = band ? band[1] : 1;
    const key = band || dims ? part + "|" + d.join(",") + "|" + b0.toFixed(3) + "," + b1.toFixed(3) : part;
    let g = geoms[key];
    if (g) return g;
    const row = part === "jacket" ? "jacket" : part;
    g = new THREE.BoxGeometry(d[0], d[1], d[2]);
    const uv = g.attributes.uv, ry0 = ROWS[row][0], ry1 = ROWS[row][1];
    for (let f = 0; f < 6; f++) {
      const col = COLS[FACE_COL[f]];
      for (let v = 0; v < 4; v++) {
        const i = f * 4 + v, u = uv.getX(i), vv0 = uv.getY(i);
        const vv = b0 + vv0 * (b1 - b0);            // this segment's slice of the row
        uv.setXY(i, (col[0] + u * (col[1] - col[0])) / W, 1 - (ry1 - vv * (ry1 - ry0)) / H);
      }
    }
    uv.needsUpdate = true;
    g._shared = true;
    geoms[key] = g;
    return g;
  }

  // ============================================================
  //  DRESS / STRIP — swap part materials+geometry in place; the original
  //  flat geometry+material is saved ONCE per mesh and restored on strip,
  //  so the jail/survival look survives any number of city outfit changes.
  // ============================================================
  function dress(list, part, m) {
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      const mesh = list[i];
      if (!mesh) continue;
      if (!mesh.userData._cbzFlat) mesh.userData._cbzFlat = { g: mesh.geometry, m: mesh.material };
      // split-limb segments carry their own dims + row band (character.js tags)
      mesh.geometry = clothGeom(part, mesh.userData.clothDims, mesh.userData.clothBand);
      mesh.material = m;
    }
  }
  function restore(list) {
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      const mesh = list[i], f = mesh && mesh.userData._cbzFlat;
      if (f) { mesh.geometry = f.g; mesh.material = f.m; }
    }
  }
  // per-rig isolated clone of a shared set material (crowd.js's pooled rigs
  // tint materials in place — give them their OWN instance so a setHex can
  // never bleed onto every other wearer of the outfit). Cached per rig+key.
  function isoMat(ch, key, m) {
    const bank = ch._clothesIso || (ch._clothesIso = {});
    if (!bank[key]) bank[key] = m.clone();          // clone shares the texture; _shared not copied → disposable
    return bank[key];
  }

  function applyClothes(ch, rec, opts) {
    if (!ch || !ch.skinSlots) return null;
    const set = rec ? getSet(rec, ch) : null;
    const key = set ? keyOf(typeof rec === "string" ? { id: rec } : rec, ch) : null;
    if (!set) {                                      // no painted look → strip back to flat
      if (ch._clothesKey != null) {
        const s = ch.skinSlots;
        restore(s.torso); restore(s.arms); restore(s.legs);
        restore(s.armsLower); restore(s.legsLower);
        if (ch._jacketMesh) ch._jacketMesh.visible = false;
        ch._clothesKey = null;
      }
      return null;
    }
    const m = (opts && opts.iso) ? isoMat(ch, key, set.mat) : set.mat;
    if (ch._clothesKey === key && ch._clothesMat === m) return set.parts;   // already wearing it
    const s = ch.skinSlots;
    dress(s.torso, "torso", m);
    if (set.parts.arms) { dress(s.arms, "arm", m); dress(s.armsLower, "arm", m); }
    else { restore(s.arms); restore(s.armsLower); }
    if (set.parts.legs) { dress(s.legs, "leg", m); dress(s.legsLower, "leg", m); }
    else { restore(s.legs); restore(s.legsLower); }
    // ---- the JACKET SHELL (tux/suit/police): silhouette via one inflated
    //      torso shell, structure via the alpha-cut open-jacket paint ----
    if (set.parts.jacket) {
      let jm = ch._jacketMesh;
      if (!jm) {
        jm = new THREE.Mesh(clothGeom("jacket"), m);
        jm.castShadow = false; jm.receiveShadow = false;
        const t = s.torso && s.torso[0];
        if (t) t.add(jm);                            // rides the torso — animates for free
        ch._jacketMesh = jm;
      }
      jm.material = m;
      jm.visible = true;
    } else if (ch._jacketMesh) ch._jacketMesh.visible = false;
    ch._clothesKey = key;
    ch._clothesMat = m;
    return set.parts;
  }

  CBZ.applyClothes = applyClothes;       // the character.js opt-in seam
  CBZ.cityApplyClothes = applyClothes;   // city-side name (outfits.js routes here)

  // ============================================================
  //  GANG BANDANA — a small MESH accessory (NOT painted canvas), worn at the
  //  neck/forehead in the crew color. Pooled per rig (one mesh, reused) so
  //  attaching it is draw-call-cheap and re-dressing never leaks materials.
  //  CBZ.cityAttachBandana(ch, hex) — pass null/undefined hex to remove it.
  // ============================================================
  const bandanaGeo = (function () {              // built lazily (THREE may load late)
    let g = null;
    return function () {
      if (!g && window.THREE) { g = new THREE.BoxGeometry(0.64, 0.13, 0.66); g._shared = true; }
      return g;
    };
  })();
  function cmat(hex) { return CBZ.cmat ? CBZ.cmat(hex) : new THREE.MeshLambertMaterial({ color: hex }); }
  function cityAttachBandana(ch, hex) {
    if (!ch || !window.THREE) return null;
    let b = ch._bandana;
    if (hex == null) { if (b) b.visible = false; return b; }
    const geo = bandanaGeo();
    if (!b) {
      // tied just below the hairline at the back of the head — rides the neck
      // so it animates with the head turn for free. Its own cloned material so
      // a per-rig recolor never bleeds onto the shared cache.
      b = new THREE.Mesh(geo, cmat(hex).clone());
      b.castShadow = false; b.receiveShadow = false;
      b.position.set(0, 0.46, 0);                  // a forehead band wrapping the upper head
      const host = ch.neck || ch.head || (ch.skinSlots && ch.skinSlots.head && ch.skinSlots.head[0]);
      if (host && host.add) host.add(b); else if (ch.group) ch.group.add(b);
      // a small knot tail trailing at the back
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.1), b.material);
      tail.position.set(0.18, -0.04, -0.34); tail.rotation.z = 0.4; b.add(tail);
      ch._bandana = b;
    }
    if (b.material && b.material.color && b.material.color.setHex) {
      if (b.material._shared) b.material = b.material.clone();
      b.material.color.setHex(hex);
    }
    b.visible = true;
    return b;
  }
  CBZ.cityAttachBandana = cityAttachBandana;

  // ============================================================
  //  COMPOSABLES — simple buyable items layered onto the PLAIN base. Each is
  //  drawn with cheap shared geometry (collar mesh, tinted jacket shell, a tie
  //  strip, a bow) so the closet/store racks and the rig use ONE code path.
  //
  //  CBZ.cityComposableSpec(visualId) → { slot, drip, color, label, draw(group,ctx) }
  //  CBZ.cityApplyComposite(ch, { shirt, legs, items:[visualId,...] })
  //    — idempotent: restores the rig to PLAIN (shirt torso+arms, jean legs,
  //      shoes), then layers each item's meshes. Calling it again with a
  //      different recipe never accumulates stale meshes (a per-rig bin is
  //      cleared first).
  // ============================================================
  const NAMED = {                                  // the composable color palette
    navy: 0x1c2030, charcoal: 0x2a2d34, burgundy: 0x6e1f2b, forest: 0x244031,
    white: 0xf2f2f2, black: 0x141519, red: 0x8a1f24, silver: 0xb9bdc4,
    royal: 0x274690, pink: 0xd98aa6, tan: 0xb8a070,
  };
  // tiny helper to build a thin box mesh in a group with a shared/cloned mat
  function piece(group, w, h, d, x, y, z, hex, opts) {
    const m = new THREE.Mesh(CBZ.boxGeom ? CBZ.boxGeom(w, h, d) : new THREE.BoxGeometry(w, h, d), cmat(hex));
    m.position.set(x, y, z);
    m.castShadow = false; m.receiveShadow = false;
    if (opts && opts.rotZ) m.rotation.z = opts.rotZ;
    group.add(m);
    return m;
  }

  // visualId → spec. draw(group, ctx) places sample meshes at the chest-front
  // origin (group is expected to sit at the torso); ctx.hex overrides color.
  const COMP = {};
  function mkCollar(hex) {
    return { slot: "shirt", drip: 1, color: hex, label: "Collared Shirt",
      draw(group, ctx) { const c = (ctx && ctx.hex != null) ? ctx.hex : hex;
        piece(group, 0.16, 0.1, 0.06, -0.12, 0.42, 0.24, tone2(c, -0.22), { rotZ: 0.5 });
        piece(group, 0.16, 0.1, 0.06, 0.12, 0.42, 0.24, tone2(c, -0.22), { rotZ: -0.5 });
        piece(group, 0.04, 0.5, 0.04, 0, 0.18, 0.26, tone2(c, -0.12)); } };
  }
  function mkBlazer(hex) {
    return { slot: "jacket", drip: 5, color: hex, label: "Blazer",
      // the blazer reuses the painted jacket SHELL look: a tinted open-front
      // jacket. On a rig it routes through applyClothes(suit-style); on a rack
      // it draws a simple open jacket box pair.
      shell: "suit",
      draw(group, ctx) { const c = (ctx && ctx.hex != null) ? ctx.hex : hex;
        piece(group, 0.26, 0.9, 0.62, -0.34, 0, 0, c);            // left front panel
        piece(group, 0.26, 0.9, 0.62, 0.34, 0, 0, c);             // right front panel
        piece(group, 0.92, 0.9, 0.2, 0, 0, -0.24, c);             // back
        piece(group, 0.12, 0.5, 0.04, -0.16, 0.2, 0.3, tone2(c, 0.16), { rotZ: 0.2 }); // lapel L
        piece(group, 0.12, 0.5, 0.04, 0.16, 0.2, 0.3, tone2(c, 0.16), { rotZ: -0.2 }); } }; // lapel R
  }
  function mkTie(hex) {
    return { slot: "neck", drip: 2, color: hex, label: "Tie",
      draw(group, ctx) { const c = (ctx && ctx.hex != null) ? ctx.hex : hex;
        piece(group, 0.1, 0.1, 0.04, 0, 0.42, 0.26, tone2(c, -0.2));   // knot
        piece(group, 0.08, 0.5, 0.04, 0, 0.12, 0.27, c); } };          // body
  }
  function tone2(n, amt) {                          // hex-int → hex-int tone (for cmat keys)
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (amt > 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
    else { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
    return ((r | 0) << 16) | ((g | 0) << 8) | (b | 0);
  }
  // collared shirts in a sensible subset of colors
  ["white", "navy", "charcoal", "burgundy", "forest", "black", "pink", "royal"].forEach(function (cn) {
    COMP["shirt_" + cn + "_collar"] = mkCollar(NAMED[cn]);
  });
  COMP.shirt_white = { slot: "shirt", drip: 0, color: NAMED.white, label: "White Tee",
    draw(group, ctx) { const c = (ctx && ctx.hex != null) ? ctx.hex : NAMED.white;
      piece(group, 0.5, 0.04, 0.04, 0, 0.46, 0.26, tone2(c, -0.18)); } }; // collar band
  ["navy", "charcoal", "burgundy", "forest", "black", "tan", "royal"].forEach(function (cn) {
    COMP["blazer_" + cn] = mkBlazer(NAMED[cn]);
  });
  ["navy", "burgundy", "red", "forest", "silver", "royal", "pink", "charcoal"].forEach(function (cn) {
    COMP["tie_" + cn] = mkTie(NAMED[cn]);
  });
  COMP.bowtie_black = { slot: "neck", drip: 2, color: NAMED.black, label: "Bow Tie",
    draw(group, ctx) { const c = (ctx && ctx.hex != null) ? ctx.hex : NAMED.black;
      piece(group, 0.1, 0.12, 0.05, -0.08, 0.42, 0.26, c, { rotZ: 0.35 });
      piece(group, 0.1, 0.12, 0.05, 0.08, 0.42, 0.26, c, { rotZ: -0.35 });
      piece(group, 0.05, 0.07, 0.06, 0, 0.42, 0.27, tone2(c, 0.2)); } };  // knot
  COMP.pants_white = { slot: "legs", drip: 1, color: NAMED.white, label: "White Pants",
    legsHex: NAMED.white,                          // applied as a flat legs color
    draw(group, ctx) { const c = (ctx && ctx.hex != null) ? ctx.hex : NAMED.white;
      piece(group, 0.18, 0.9, 0.18, -0.12, -0.5, 0, c);
      piece(group, 0.18, 0.9, 0.18, 0.12, -0.5, 0, c); } };
  COMP.jacket_bomber = { slot: "jacket", drip: 6, color: 0x2b3a4a, label: "Bomber Jacket",
    shell: "suit",                                  // a solid shell on the rig
    bomberHex: 0x2b3a4a,
    // (websearch: hip-length, ribbed knit collar + cuffs + waistband, front zip)
    draw(group, ctx) { const c = (ctx && ctx.hex != null) ? ctx.hex : 0x2b3a4a;
      piece(group, 0.96, 0.78, 0.64, 0, 0.05, 0, c);              // body
      piece(group, 0.96, 0.12, 0.66, 0, -0.4, 0, tone2(c, -0.25)); // ribbed waistband hem
      piece(group, 0.5, 0.1, 0.66, 0, 0.46, 0, tone2(c, -0.25));  // ribbed collar
      piece(group, 0.04, 0.78, 0.04, 0, 0.05, 0.33, tone2(c, -0.4)); } }; // front zip
  COMP.tuxedo = { slot: "outfit", drip: 28, color: 0x16171c, label: "Tuxedo", painted: "tuxedo",
    draw(group) {                                   // the rack sample: black jacket + white shirt V
      piece(group, 0.9, 0.9, 0.6, 0, 0, 0, 0x16171c);
      piece(group, 0.3, 0.7, 0.04, 0, 0.05, 0.31, 0xf1f2ec);     // shirt front
      piece(group, 0.2, 0.07, 0.05, 0, 0.34, 0.33, 0x0b0c10); } }; // bow tie

  // ============================================================
  //  NEW BUYABLE FULL-LOOKS — each is a PAINTED outfit (painted:"<id>" short-
  //  circuits straight to PAINT.<id>, like the tuxedo). The rack sample draws a
  //  cheap representative box. paintRec carries colors/style to applyClothes.
  // ============================================================
  function paintedLook(visualId, paintId, label, drip, color, paintRec, drawHex2) {
    COMP[visualId] = {
      slot: "outfit", drip: drip, color: color, label: label, painted: paintId, paintRec: paintRec || null,
      draw(group, ctx) {
        const c = (ctx && ctx.hex != null) ? ctx.hex : color;
        piece(group, 0.9, 0.9, 0.6, 0, 0, 0, c);
        if (drawHex2 != null) piece(group, 0.36, 0.7, 0.06, 0, 0.02, 0.31, drawHex2);
      },
    };
  }
  // SUITS: one buyable look per SUIT_STYLES index → painted:"suit", style:N.
  SUIT_STYLES.forEach(function (st, i) {
    paintedLook("suit_" + i, "suit", st.name, st.tux ? 26 : (st.vest ? 18 : 14), st.body,
      { style: i, forcePaint: 1 }, "#f1f2ec");
  });
  // STREETWEAR / SERVICE / WORKWEAR full-looks
  paintedLook("hoodie",       "hoodie",       "Hoodie",          4,  0x7a4a3a, { forcePaint: 1, colors: { torso: 0x7a4a3a } });
  paintedLook("hoodie_grey",  "hoodie",       "Grey Hoodie",     4,  0x4a4d54, { forcePaint: 1, colors: { torso: 0x4a4d54 } });
  paintedLook("hoodie_black", "hoodie",       "Black Hoodie",    5,  0x1c1d22, { forcePaint: 1, colors: { torso: 0x1c1d22 } });
  paintedLook("puffer",       "puffer",       "Puffer Jacket",   7,  0x223a55, { colors: { torso: 0x223a55 } });
  paintedLook("denim_jacket", "denim_jacket", "Denim Jacket",    6,  0x3c5a7a, { colors: { torso: 0x3c5a7a } });
  paintedLook("varsity",      "varsity",      "Varsity Jacket",  8,  0x6e1f2b, { colors: { torso: 0x6e1f2b, collar: 0xeae6dc } });
  paintedLook("graphic_tee",  "graphic_tee",  "Graphic Tee",     2,  0x1c1d22, { colors: { torso: 0x1c1d22, collar: 0xd84a3a } });
  paintedLook("coveralls",    "coveralls",    "Coveralls",       4,  0x394a5a, { colors: { torso: 0x394a5a } });
  paintedLook("chef",         "chef",         "Chef Whites",     6,  0xf0efe9, { colors: { collar: 0x9a2a2a } });
  paintedLook("waiter",       "waiter",       "Waiter Set",      7,  0x16171c, null, "#f1f2ec");
  paintedLook("pilot",        "pilot",        "Pilot Uniform",   9,  0xeef0f2, { colors: { legs: 0x1a1c24 } });
  paintedLook("tracksuit",    "tracksuit",    "Tracksuit",       5,  0x2bb673, { colors: { torso: 0x2bb673 } });
  paintedLook("tracksuit_red","tracksuit2",   "Red Tracksuit",   5,  0xb22a2a, null);
  paintedLook("tracksuit_navy","tracksuit3",  "Navy Tracksuit",  5,  0x1c2440, null);
  // DRESSES (color-keyed cache via paintRec.colors.torso)
  [["dress_black", 0x1c1d22, "Black Dress"], ["dress_red", 0x8a1f28, "Red Dress"],
   ["dress_navy", 0x1c2438, "Navy Dress"], ["dress_emerald", 0x1d5a44, "Emerald Dress"],
   ["dress_white", 0xe9e7df, "White Dress"]].forEach(function (d) {
    paintedLook(d[0], "dress", d[2], 9, d[1], { colors: { torso: d[1] } });
  });
  paintedLook("sundress",     "sundress",     "Floral Sundress", 6,  0xf0d9a0, { colors: { torso: 0xf0d9a0, collar: 0xd86a8a } });
  paintedLook("sundress_blue","sundress",     "Blue Sundress",   6,  0xbcd6ea, { colors: { torso: 0xbcd6ea, collar: 0x3a6aa0 } });

  function cityComposableSpec(visualId) { return COMP[visualId] || null; }
  CBZ.cityComposableSpec = cityComposableSpec;

  // ---- apply a composite recipe to a rig (idempotent) ----------------------
  function clearComposite(ch) {
    const bin = ch._compMeshes;
    if (bin) for (let i = 0; i < bin.length; i++) {
      const m = bin[i];
      if (m && m.parent) m.parent.remove(m);
      if (m && m.geometry && !m.geometry._shared && m.geometry.dispose) m.geometry.dispose();
    }
    ch._compMeshes = [];
  }
  function cityApplyComposite(ch, comp) {
    if (!ch || !ch.skinSlots || !comp) return false;
    const items = comp.items || [];
    const shirt = comp.shirt != null ? comp.shirt : 0xf2f2f2;
    let legs = comp.legs != null ? comp.legs : 0x39414f;
    // a fully-painted special (tuxedo/suit/dress…) short-circuits the whole stack
    let painted = null, paintRec = null, shell = null;
    for (let i = 0; i < items.length; i++) {
      const sp = COMP[items[i]];
      if (!sp) continue;
      if (sp.painted) { painted = sp.painted; paintRec = sp.paintRec || null; }
      if (sp.shell) shell = items[i];
      if (sp.legsHex != null) legs = sp.legsHex;
    }
    clearComposite(ch);
    if (painted) {                                   // e.g. tuxedo → the painted look
      const rec = paintRec ? Object.assign({ id: painted }, paintRec) : { id: painted };
      applyClothes(ch, rec);
      return true;
    }
    // PLAIN base: strip any painted look, then flat-tint via recolorRig if the
    // city look API is present (keeps shoes/collar consistent); else paint here.
    applyClothes(ch, null);
    if (CBZ.cityRecolorRig) {
      CBZ.cityRecolorRig(ch, { torso: shirt, arms: shirt, legs, collar: shirt, shoes: 0x2b2b2b }, null);
    } else {
      const s = ch.skinSlots, setHex = (list, hex) => { if (list) for (const m of list) if (m && m.material && m.material.color) { if (m.material._shared) m.material = m.material.clone(); m.material.color.setHex(hex); } };
      setHex(s.torso, shirt); setHex(s.arms, shirt); setHex(s.armsLower, shirt); setHex(s.legs, legs); setHex(s.legsLower, legs); setHex(s.collar, shirt);
    }
    // a blazer/bomber shell rides through the painted jacket shell (silhouette
    // + open front) so it reads as a real jacket, tinted to the item color.
    if (shell) {
      const sp = COMP[shell], hex = sp.bomberHex != null ? sp.bomberHex : (sp.color != null ? sp.color : 0x1c2030);
      applyClothes(ch, { id: "suit", colors: { torso: hex, legs, arms: hex } });
    }
    // layer the small attached meshes (collar/tie/bow) onto the torso
    const host = (ch.skinSlots.torso && ch.skinSlots.torso[0]) || ch.body || ch.group;
    if (host && host.add) {
      const bin = ch._compMeshes;
      for (let i = 0; i < items.length; i++) {
        const sp = COMP[items[i]];
        if (!sp || sp.shell || sp.painted || sp.legsHex != null) continue; // shells/legs handled above
        const grp = new THREE.Group();
        sp.draw(grp, {});
        grp.children.forEach((m) => bin.push(m));
        host.add(grp);
        bin.push(grp);
      }
    }
    ch._compRecipe = items.slice();
    return true;
  }
  CBZ.cityApplyComposite = cityApplyComposite;
})();
