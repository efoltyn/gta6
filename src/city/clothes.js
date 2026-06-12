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

  // ---- the atlas layout (one canvas per outfit) ----------------------------
  const W = 128, H = 256;
  const COLS = { front: [0, 64], back: [64, 96], side: [96, 112], cap: [112, 128] };
  const ROWS = { torso: [0, 96], jacket: [96, 176], arm: [176, 216], leg: [216, 256] };
  // part dims MUST match entities/character.js boxes; jacket = inflated torso
  const DIMS = { torso: [0.92, 0.95, 0.5], jacket: [0.98, 1.0, 0.6], arm: [0.3, 0.92, 0.3], leg: [0.34, 0.95, 0.34] };

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
    T.rect("front", 0, 0.16, 1, 0.12, ac);                          // bandana-print band
    T.rect("back", 0, 0.16, 1, 0.12, ac);
    T.rect("side", 0, 0.16, 1, 0.12, ac);
    for (let i = 0; i < 5; i++) T.dot("front", 0.1 + i * 0.2, 0.22, 0.022, tone(hue, 0.35)); // paisley dots
    T.poly("front", [[0.5, 0.42], [0.62, 0.55], [0.5, 0.68], [0.38, 0.55]], tone(acc, 0.2)); // chest logo blot
    T.rect("front", 0, 0.9, 1, 0.1, "#15171c");                     // waistband
    T.rect("side", 0, 0.9, 1, 0.1, "#15171c");
    T.rect("back", 0, 0.9, 1, 0.1, "#15171c");
    T.rect("front", 0, 0.9, 1, 0.03, ac);                           //   accent line
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
  PAINT.basics = function (P, c) {
    const body = (c && c.torso != null) ? c.torso : 0x8a939c;
    const T = P.T, A = P.A, bc = hx(body);
    T.fill(bc);
    T.rect("front", 0.3, 0, 0.4, 0.06, tone(body, -0.28));          // collar line
    T.rect("back", 0.3, 0, 0.4, 0.04, tone(body, -0.28));
    T.rect("front", 0.36, 0.24, 0.28, 0.2, tone(body, 0.3));        // tiny chest print
    T.rect("front", 0.4, 0.28, 0.2, 0.12, tone(body, -0.35));
    T.rect("front", 0, 0.92, 1, 0.08, tone(body, -0.3));            // waistband
    T.rect("side", 0, 0.92, 1, 0.08, tone(body, -0.3));
    T.rect("back", 0, 0.92, 1, 0.08, tone(body, -0.3));
    T.shade();
    A.fill(bc); A.rect("front", 0, 0.9, 1, 0.06, tone(body, -0.25)); A.shade();
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
    if (id.indexOf("gang:") === 0) return "gang|" + (c.torso | 0) + "|" + (c.collar | 0);
    if (id === "street" || id === "hoodie" || id === "basics" || id === "civvies")
      return "basics|" + (c.torso != null ? c.torso | 0 : 0x8a939c);
    if (id === "suit") return "suit|" + (ch && ch.group ? ch.group.id % SUIT_TIES.length : 0);
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
})();
