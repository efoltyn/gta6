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

  // shared formal-wear front: white shirt V + studs/tie + open jacket shell
  function formalTorso(T, J, jacketHex, lapelCss, opts) {
    const jc = hx(jacketHex), shirt = "#f1f2ec", shirtLow = "#dddfd6";
    T.fill(jc);
    // the shirt panel the open jacket reveals (full front — the gap crops it)
    T.rect("front", 0.3, 0, 0.4, 0.84, shirt);
    T.rect("front", 0.47, 0.02, 0.06, 0.82, shirtLow);            // placket seam
    if (opts.bow) {                                                // black bow tie at the collar line
      T.rect("front", 0.38, 0.025, 0.24, 0.085, "#0b0c10");
      T.rect("front", 0.465, 0.035, 0.07, 0.065, "#15161c");      // knot
      T.dot("front", 0.5, 0.21, 0.018, "#15161a");                // stud dots
      T.dot("front", 0.5, 0.33, 0.018, "#15161a");
      T.dot("front", 0.5, 0.45, 0.018, "#15161a");
    } else if (opts.tie) {                                         // suit: colored tie
      T.poly("front", [[0.44, 0.02], [0.56, 0.02], [0.53, 0.1], [0.47, 0.1]], tone(opts.tie, -0.25)); // knot
      T.rect("front", 0.465, 0.1, 0.07, 0.5, hx(opts.tie));
      T.poly("front", [[0.465, 0.6], [0.535, 0.6], [0.5, 0.68]], hx(opts.tie));
    }
    if (opts.belt) {                                               // suit belt line at the waist
      T.rect("front", 0.3, 0.84, 0.4, 0.08, "#17181d");
      T.rect("front", 0.475, 0.85, 0.05, 0.06, "#b9a05a");        // buckle
    } else T.rect("front", 0.3, 0.78, 0.4, 0.1, "#0d0e12");       // tux cummerbund break
    T.shade();
    // ---- the OPEN JACKET shell: alpha-cut V gap + satin lapel wedges ----
    J.fill(jc);
    J.clear("cap", 0, 0, 1, 1);                                    // open top/bottom — see the shirt inside
    const g = opts.gap || 0.13;                                    // half-width of the gap at the hem
    J.clearPoly("front", [[0.5 - 0.035, 0], [0.5 + 0.035, 0], [0.5 + g, 1], [0.5 - g, 1]]);
    // lapels: two angled satin facets meeting at the V
    const lw = opts.lapel || 0.13;                                 // lapel width at the shoulder
    J.poly("front", [[0.5 - 0.035 - lw, 0], [0.5 - 0.034, 0], [0.5 - g + 0.005, 0.46], [0.5 - g - 0.05, 0.4]], lapelCss);
    J.poly("front", [[0.5 + 0.034, 0], [0.5 + 0.035 + lw, 0], [0.5 + g + 0.05, 0.4], [0.5 + g - 0.005, 0.46]], lapelCss);
    J.rect("back", 0.47, 0.55, 0.06, 0.45, tone(jacketHex, -0.25)); // back vent
    if (opts.square) J.rect("front", 0.16, 0.18, 0.1, 0.045, "#f1f2ec"); // pocket square
    J.shade();
  }
  function formalLimbs(A, L, jacketHex, legHex, cuff) {
    const jc = hx(jacketHex);
    A.fill(jc);
    if (cuff) { A.rect("front", 0, 0.86, 1, 0.07, "#f1f2ec"); A.rect("side", 0, 0.86, 1, 0.07, "#f1f2ec"); A.rect("back", 0, 0.86, 1, 0.07, "#e3e4dc"); }
    A.dot("front", 0.78, 0.8, 0.05, tone(jacketHex, -0.35));       // sleeve button
    A.shade();
    L.fill(hx(legHex));
    L.rect("front", 0.46, 0, 0.08, 0.94, tone(legHex, 0.18));      // sharp crease line
    L.rect("front", 0, 0.94, 1, 0.06, tone(legHex, -0.3));         // gloss shoe break
    L.rect("side", 0, 0.94, 1, 0.06, tone(legHex, -0.3));
    L.shade();
  }

  PAINT.tuxedo = function (P, c) {
    const body = 0x16171c;                                         // lifted off true black so shading reads
    formalTorso(P.T, P.J, body, "rgb(46,48,58)", { bow: true, square: true, gap: 0.12, lapel: 0.15 });
    formalLimbs(P.A, P.L, body, 0x14151a, true);
    return { torso: 1, arms: 1, legs: 1, jacket: 1 };
  };
  PAINT.suit = function (P, c, tie) {
    const body = c && c.torso != null ? c.torso : 0x1c2030;
    formalTorso(P.T, P.J, body, tone(body, 0.16), { tie: tie || 0x7a1f2b, belt: true, gap: 0.1, lapel: 0.09 });
    formalLimbs(P.A, P.L, body, (c && c.legs != null) ? c.legs : 0x14161c, false);
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
  //  THE CACHE — one set per outfit key, shared by every wearer.
  // ============================================================
  const sets = {};                                  // key → {mat, tex, parts}
  const SUIT_TIES = [0x7a1f2b, 0x1f4e7a];           // burgundy / steel blue

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
    if (CIVVIE_IDS[id]) {                            // the street nobody
      // PLAIN by default — let recolorRig paint flat shirt + jean legs + shoes.
      if (plainCivvies()) return null;
      return "basics|" + (c.torso != null ? c.torso | 0 : 0x8a939c);
    }
    if (id === "suit") return "suit|" + (ch && ch.group ? ch.group.id % SUIT_TIES.length : 0);
    if (id === "construction") return "hivis|" + (c.torso != null ? c.torso | 0 : 0xffb43a); // same painter, site-orange default
    if (PAINT[id]) return id;
    return null;                                    // leather/tactical/designer… stay flat
  }

  function buildSet(key, rec) {
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");
    const P = { T: rowPainter(ctx, "torso"), J: rowPainter(ctx, "jacket"), A: rowPainter(ctx, "arm"), L: rowPainter(ctx, "leg") };
    const c = (rec && rec.colors) || {};
    const kind = key.split("|")[0];
    // pre-fill the WHOLE atlas opaque (base cloth color) so rows a painter
    // skips can never mip-blend transparency into a used row at distance
    // (alphaTest would eat the edge texels). Painters overdraw their rows;
    // the jacket's gap/cap clears cut through this layer too.
    ctx.fillStyle = hx(c.torso != null ? c.torso : (key.split("|")[1] | 0) || 0x444444);
    ctx.fillRect(0, 0, W, H);
    let parts = null;
    if (kind === "suit") parts = PAINT.suit(P, c, SUIT_TIES[key.split("|")[1] | 0]);
    else if (kind === "basics") parts = PAINT.basics(P, { torso: key.split("|")[1] | 0 });
    else if (kind === "hivis") parts = PAINT.hivis(P, { torso: key.split("|")[1] | 0, legs: c.legs, arms: c.arms }); // shared by construction key
    else if (kind === "gang") { const seg = key.split("|"); parts = PAINT.gang(P, { torso: seg[1] | 0, collar: seg[2] | 0, legs: c.legs }); }
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
  function clothGeom(part) {
    let g = geoms[part];
    if (g) return g;
    const d = DIMS[part], row = part === "jacket" ? "jacket" : part;
    g = new THREE.BoxGeometry(d[0], d[1], d[2]);
    const uv = g.attributes.uv, ry0 = ROWS[row][0], ry1 = ROWS[row][1];
    for (let f = 0; f < 6; f++) {
      const col = COLS[FACE_COL[f]];
      for (let v = 0; v < 4; v++) {
        const i = f * 4 + v, u = uv.getX(i), vv = uv.getY(i);
        uv.setXY(i, (col[0] + u * (col[1] - col[0])) / W, 1 - (ry1 - vv * (ry1 - ry0)) / H);
      }
    }
    uv.needsUpdate = true;
    g._shared = true;
    geoms[part] = g;
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
      mesh.geometry = clothGeom(part);
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
        if (ch._jacketMesh) ch._jacketMesh.visible = false;
        ch._clothesKey = null;
      }
      return null;
    }
    const m = (opts && opts.iso) ? isoMat(ch, key, set.mat) : set.mat;
    if (ch._clothesKey === key && ch._clothesMat === m) return set.parts;   // already wearing it
    const s = ch.skinSlots;
    dress(s.torso, "torso", m);
    if (set.parts.arms) dress(s.arms, "arm", m); else restore(s.arms);
    if (set.parts.legs) dress(s.legs, "leg", m); else restore(s.legs);
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
    // a fully-painted special (tuxedo) short-circuits the whole stack
    let painted = null, shell = null;
    for (let i = 0; i < items.length; i++) {
      const sp = COMP[items[i]];
      if (!sp) continue;
      if (sp.painted) painted = sp.painted;
      if (sp.shell) shell = items[i];
      if (sp.legsHex != null) legs = sp.legsHex;
    }
    clearComposite(ch);
    if (painted) {                                   // e.g. tuxedo → the painted look
      applyClothes(ch, { id: painted });
      return true;
    }
    // PLAIN base: strip any painted look, then flat-tint via recolorRig if the
    // city look API is present (keeps shoes/collar consistent); else paint here.
    applyClothes(ch, null);
    if (CBZ.cityRecolorRig) {
      CBZ.cityRecolorRig(ch, { torso: shirt, arms: shirt, legs, collar: shirt, shoes: 0x2b2b2b }, null);
    } else {
      const s = ch.skinSlots, setHex = (list, hex) => { if (list) for (const m of list) if (m && m.material && m.material.color) { if (m.material._shared) m.material = m.material.clone(); m.material.color.setHex(hex); } };
      setHex(s.torso, shirt); setHex(s.arms, shirt); setHex(s.legs, legs); setHex(s.collar, shirt);
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
