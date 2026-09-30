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
  /* A SHORT SLEEVE ENDS MID-UPPER-ARM. The arm row runs shoulder (0) to wrist
     crease (1); the upper arm shows the top ~0.64 of it (character.js tags its
     band from armUp / (armUp + forearm): 0.64 adult, ~0.67 child), so row 0.29
     is ~45% down the upper arm on every body. Hem band above, bare skin below. */
  const SLEEVE_HEM = 0.29;
  function shortSleeve(A, hem, skin) {
    for (const col of ["front", "back", "side"]) { A.rect(col, 0, SLEEVE_HEM - 0.035, 1, 0.035, hem); A.rect(col, 0, SLEEVE_HEM, 1, 1 - SLEEVE_HEM, skin); }
  }
  /* WHERE THE SHAPED BODY PUTS THINGS ON THE TORSO ROW (entities/character.js
     TORSO block). v still runs the old box span (row 0 = column top, 1 = the
     hip line), but the body under it is not a box any more. Measured off the
     real rigs (men, women, heavy, children 3-15):
       · the COLLAR BAND stands over the neck base down to ~0.11 (0.21 on a
         toddler): whatever is painted above that at the front centre is only
         seen through the band's own atlas (yokeCanvas samples it);
       · shoulder line ~0.12, pecs / bust ~0.45-0.49;
       · the natural WAIST (narrowest ring) ~0.79;
       · the shirt TUCKS INTO THE PELVIS from ~0.82 (0.77 at seven, 0.74 on a
         toddler). Every old hem at 0.86-1.0 was painted inside the trousers
         and never seen once — the box torso ran to the hip, this one doesn't.
     So a hem sits just above the tuck and a waist seam on the waist. A child's
     garment (kid atlases are only ever cast on children) hems higher still,
     above the toddler's 0.74. */
  const TORSO_ROW = { waist: 0.765, hem: 0.755, hemH: 0.07, kidHem: 0.685 };
  function hemBand(R, css, y, h) {
    for (const col of ["front", "back", "side"]) R.rect(col, 0, y != null ? y : TORSO_ROW.hem, 1, h != null ? h : TORSO_ROW.hemH, css);
  }
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

  // ============================================================
  //  BODY FIT — the painted atlas must land on the body it is DRESSING.
  //
  //  entities/character.js builds a real body from a profile now: an adult
  //  woman (and EVERY child) carries a WAIST BOX under the chest, so
  //  skinSlots.torso is [chest, waist] instead of [chest]. character.js tags
  //  the split LIMB segments with clothDims/clothBand, but the torso column
  //  is untagged — and left alone, dress() would stamp the adult-male
  //  DIMS.torso box (0.92 x 0.95 x 0.50) onto BOTH boxes:
  //    • the woman's silhouette snaps back to a man's the instant she gets
  //      dressed (the waist she was given is overwritten by a man's chest);
  //    • every horizontal feature in the garment row — hem, belt, waistband,
  //      reflective stripe — is painted TWICE, once on the chest and once on
  //      the waist, which is exactly the doubled belt line you would see.
  //  Fix: tag the torso meshes from the rig's OWN profile, once per rig. The
  //  chest takes the TOP slice of the garment row, the waist the bottom
  //  slice, so the two boxes read as ONE continuous garment column — a shirt
  //  cannot stop at the seam and show skin, because the texture is
  //  continuous across it.
  //
  //  IDENTITY GUARANTEE: ADULT_M's torso/jacket numbers ARE the DIMS literals
  //  (0.92/0.95/0.50 and 0.98/1.00/0.60) and its waistShare is 0, so an adult
  //  male — and any legacy rig with no .profile — comes out byte-identical to
  //  before this change. One-line revert: CBZ.CONFIG.CLOTHES_BODY_FIT=false.
  //  ONE EXCEPTION, added later and flagged separately: jacketFit() now holds
  //  the shell clear of the yoke's and the head's planes (CHAR_YOKE_CLEAR), so
  //  an adult male's shell is 0.62 deep rather than 0.60. Everything else here
  //  is still the literal. See the note in jacketFit for why 0.60 could not
  //  stay: it was EXACTLY the head's depth, and the head's bottom sits inside
  //  the shell — a z-fight band right under the chin on every jacketed fit.
  // ============================================================
  if (CBZ.CONFIG && CBZ.CONFIG.CLOTHES_BODY_FIT == null) CBZ.CONFIG.CLOTHES_BODY_FIT = true;
  function bodyFit() {
    const C = CBZ.CONFIG;
    return !C || C.CLOTHES_BODY_FIT == null || !!C.CLOTHES_BODY_FIT;
  }
  // Read from the rig that owns it, so the two files cannot drift apart; the
  // literal remains only as the fallback for a character.js that predates the
  // export. (character.js now also TAGS the chest/waist boxes itself, so the
  // recompute below is a degrade-safe backstop rather than the normal path.)
  const WAIST_TUCK = (CBZ.CHAR_WAIST_TUCK != null) ? CBZ.CHAR_WAIST_TUCK : 0.06;
  // the profile's torso column split, in row fractions: {colH, waistH, chestH}
  function torsoSplit(P) {
    const colH = (P && P.torsoH > 0) ? P.torsoH : 0.95;
    const waistH = (P && P.waistShare > 0) ? P.waistShare * colH : 0;
    return { colH: colH, waistH: waistH, chestH: colH - waistH };
  }
  // MEASURE, don't assume (the demolition-check doctrine): a THREE.BoxGeometry
  // keeps its .parameters, so the boxes the rig was actually built with are
  // readable — no constant of character.js's has to be copied here and can
  // therefore never drift out of sync. Profile arithmetic is the fallback for
  // an exotic/stub rig. Runs ONCE per rig, before the first dress() swaps the
  // geometry out (and reads the saved flat geometry if it already did).
  function boxOf(mesh) {
    if (!mesh || !mesh.position) return null;
    const g = (mesh.userData && mesh.userData._cbzFlat && mesh.userData._cbzFlat.g) || mesh.geometry;
    const p = g && g.parameters;
    if (!p || !(p.height > 0)) return null;
    return { w: p.width, h: p.height, d: p.depth, y: mesh.position.y || 0 };
  }
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  function tagCloth(mesh, dims, band) {
    // never overwrite an existing tag — if character.js starts tagging the
    // torso itself, its own numbers win and this becomes a no-op.
    if (!mesh || !mesh.userData || mesh.userData.clothDims) return;
    mesh.userData.clothDims = dims;
    mesh.userData.clothBand = [clamp01(band[0]), clamp01(band[1])];
  }
  function fitTorso(ch) {
    if (!ch || ch._clothFitDone) return;
    ch._clothFitDone = true;
    if (!bodyFit()) return;
    const s = ch.skinSlots;
    if (!s || !s.torso || !s.torso.length) return;
    const chest = s.torso[0], waist = s.torso[1] || null;
    const cb = boxOf(chest), wb = waist ? boxOf(waist) : null;
    if (cb && (!waist || wb)) {
      // the garment column spans the bottom of the LOWEST box to the top of the
      // chest; each box takes exactly the slice of the row it occupies, so the
      // texture runs continuously across the seam (the waist's tuck overlap
      // lands inside the chest, where nothing can see the doubled band).
      const top = cb.y + cb.h / 2;
      const bot = wb ? Math.min(cb.y - cb.h / 2, wb.y - wb.h / 2) : cb.y - cb.h / 2;
      const H = top - bot;
      if (!(H > 0)) return;
      tagCloth(chest, [cb.w, cb.h, cb.d], [(cb.y - cb.h / 2 - bot) / H, (cb.y + cb.h / 2 - bot) / H]);
      if (wb) tagCloth(waist, [wb.w, wb.h, wb.d], [(wb.y - wb.h / 2 - bot) / H, (wb.y + wb.h / 2 - bot) / H]);
      return;
    }
    const P = ch.profile;
    if (!P) return;                                  // nothing to go on → legacy behavior
    const sp = torsoSplit(P);
    tagCloth(chest, [P.torsoW, sp.chestH, P.torsoD], [sp.waistH / sp.colH, 1]);
    if (waist && sp.waistH > 0) {
      const wh = sp.waistH + WAIST_TUCK;             // the waist box tucks UP into the chest
      tagCloth(waist, [P.waistW, wh, P.waistD], [0, wh / sp.colH]);
    }
  }
  // the jacket SHELL rides skinSlots.torso[0] — which is now only the CHEST,
  // not the whole column. Size it off the profile and drop it by half the
  // waist height so it still wraps the whole torso instead of riding up.
  function jacketFit(ch) {
    const P = ch && ch.profile;
    if (!P || !bodyFit()) return null;
    let y = -torsoSplit(P).waistH / 2;
    let d = P.jacketD;
    /* THE SHELL MUST NOT SHARE A PLANE WITH ANYTHING IT OVERLAPS. Same fault
       as the shoulder yoke (see entities/character.js): this shell and the
       boxes it wraps are sized from independent profile fields, and two pairs
       came out EXACTLY equal on shipped bodies —
         • ADULT_F: the shell's TOP face and the yoke's TOP face both land at
           1.8650, two up-facing, both-visible surfaces, i.e. a stipple ring
           across the shoulders of every jacketed fit;
         • ADULT_M: jacketD 0.60 == headSize 0.60, and the head's bottom 0.04
           sits INSIDE the shell — so the head's front/back faces and the
           shell's share a plane in a band right under the chin.
       Both are cured by measuring what is actually on THIS rig and holding the
       shared CHAR_YOKE_CLEAR off it. The adult male comes out byte-identical
       (his shell top already cleared the yoke by exactly 0.01) except for the
       head clearance, which grows the shell 0.02 in depth — 7mm a side, buried
       under the jaw. One-line revert: CBZ.CONFIG.CHAR_YOKE_CLEAR = false. */
    const clear = (CBZ.CHAR_YOKE_CLEAR != null) ? CBZ.CHAR_YOKE_CLEAR : 0.01;
    if (!CBZ.CONFIG || CBZ.CONFIG.CHAR_YOKE_CLEAR !== false) {
      const s = ch.skinSlots || {};
      const cb = boxOf(s.torso && s.torso[0]);
      const yb = boxOf(s.collar && s.collar[0]);
      if (cb && yb) {
        const over = (cb.y + y + P.jacketH / 2) - (yb.y + yb.h / 2 - clear);
        if (over > 0) y -= over;                 // drop the shell just under the yoke
      }
      const head = P.headSize > 0 ? P.headSize : 0.60;
      if (Math.abs(d - head) < 2 * clear) d = head + 2 * clear;
    }
    return { dims: [P.jacketW, P.jacketH, d], y: y };
  }

  // ---- color helpers --------------------------------------------------------
  function hx(n) { return "#" + ("00000" + ((n | 0) & 0xffffff).toString(16)).slice(-6); }
  // lighten (amt>0) / darken (amt<0) a hex int, returns css string
  function tone(n, amt) {
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (amt > 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
    else { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
    return "rgb(" + (r | 0) + "," + (g | 0) + "," + (b | 0) + ")";
  }
  // a TRANSLUCENT wash of a hex — what a woven pattern needs, because the
  // colour a weave shows is the thread OVER the ground, and two washes that
  // cross must darken each other on their own rather than by a third literal.
  function rgba(n, a) {
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  }

  // ============================================================
  //  THE FORMAL NECK, V2 — the reference-suit collar and the top of the tie.
  //
  //  OWNER (2026-08-04, with reference images): "the issue rn is with the
  //  collar and top of tie." Two measured faults, both geometry, not taste:
  //   (1) the shoulder-yoke slab overlaps the chest box's top ~0.145 and sits
  //       ~1 cm PROUD of it (character.js: yoke centre neckY-0.04, H 0.18;
  //       chest top neckY+0.015) — so the knot/bow painted on the chest's top
  //       0.115 of the torso row has NEVER been visible. Every suit read as a
  //       knotless blade emerging from under a slab, and the tuxedo showed no
  //       bow tie at all (verified in outfit-gallery shots, 2026-08-04).
  //   (2) the painted jacket V pinched at the throat (±0.035) and swung OPEN
  //       toward the hem — the reverse of a worn suit, which is wide open at
  //       the collar and converges to the fastened button. Nothing at the
  //       collar could ever read through a 7%-wide slit.
  //  V2, in three moves that keep every piece on the box it is seen on:
  //   • the painter DECLARES its neckwear in its parts return (parts.neck =
  //     {tie:hex, w:bladeWidth} or {bow:hex}) — suit, tuxedo, waiter, office,
  //     police and pilot all declare in this change;
  //   • the yoke atlas draws the collar leaves and the KNOT/BOW (the slab IS
  //     the collar zone), the knot running to the slab's bottom edge;
  //   • the chest carries only the BLADE, from row 0, so it runs continuously
  //     under the slab on every body profile and emerges below the seam with
  //     no gap — alignment by construction, not by per-profile arithmetic.
  //  One-line revert: CBZ.CONFIG.CLOTH_FORMAL_NECK_V2 = false — every painter
  //  takes its exact old branch (evaluated when an atlas is built, like
  //  CLOTH_YOKE_PAINT). The yoke atlas keeps its 128x32 size either way: the
  //  same fractions paint the same look, just not on 3px-wide texels.
  // ============================================================
  if (CBZ.CONFIG && CBZ.CONFIG.CLOTH_FORMAL_NECK_V2 == null) CBZ.CONFIG.CLOTH_FORMAL_NECK_V2 = true;
  function neckV2() {
    const C = CBZ.CONFIG;
    return !C || C.CLOTH_FORMAL_NECK_V2 == null || !!C.CLOTH_FORMAL_NECK_V2;
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
  // THE PATTERN CLASSES OF THIS WARDROBE, AND THE ONE THAT IS BANNED.
  // Everything here is built from RECT — a stripe, a grid, a check. That is not
  // an accident of taste, it is the rule (owner, verbatim: "GET THIS OUTFIT WITH
  // DUMB DOTS ON IT LITTLE CIRCLES GET THIS SHIT OUT OF THE GAME"). A SCATTERED
  // MOTIF FIELD — a loop that stamps many small discs at pseudo-random positions
  // — is banned from this file. It read as speckle, not fabric, at every
  // distance the game actually shows a person at. `PAINT.sundress`'s old
  // `flowers()` was the only one that ever existed and it is deleted; the
  // remaining ~40 `dot()` calls in this file are each ONE hand-placed button,
  // stud, badge or motif on a known coordinate, which is a different thing.
  // If you want a new print, add a kind HERE and draw it with rect().
  function patternRow(R, ctx, bodyHex, kind, accentHex) {
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
    } else if (kind === "gingham") {
      // GINGHAM — the summer-dress check, and the replacement for the deleted
      // dot field. A real gingham is ONE dyed thread run in both directions
      // over a white ground, so it has exactly three tones and you never pick
      // the third: the warp wash, the weft wash, and the squares where they
      // CROSS, which darken by themselves because the alpha composites twice.
      // Half-cell bands so cloth and check are equal width, which is what makes
      // the check read as a check rather than as a grid drawn on cloth.
      const cell = 0.125, half = cell / 2;                 // ~8px of a 64px column ≈ 11 cm of real dress
      const wash = rgba(accentHex != null ? accentHex : bodyHex, 0.42);
      for (const col of ["front", "back", "side"]) {
        for (let x = 0; x < 0.999; x += cell) R.rect(col, x, 0, half, 1, wash);  // warp
        for (let y = 0; y < 0.999; y += cell) R.rect(col, 0, y, 1, half, wash);  // weft
      }
    }
    ctx.restore();
  }

  /* ==== TAILORING — one suit, cut for the SHAPED body ======================
     Every formal look is ONE garment in three layers that must agree: the
     shirt (torso row), the jacket SHELL (jacket row, an offset of the torso
     surface, alpha-cut at the V) and the collar band round the neck base (the
     yoke atlas: shirt collar + knot). All three declare parts.fp, so their
     FRONT columns are addressed in BODY units (see TAILORING at fpPainter):
     u = 0.5 + x / (2 XR), XR = the jacket's front half-width at the chest
     line, so X = u - 0.5 is "fraction of the chest", the same on a woman, a
     child and a heavy man. Rows are the old box span, whose landmarks were
     MEASURED on the real rig (tools/lib/rig-vm.mjs, every sex / physique /
     age, spread <= 0.03):
                  collarbone  shoulder  chest  nat.waist  trouser top  hip joint
       jacket row    0.09       0.14    0.45     0.775       0.84        0.97
       torso row     0.065      0.12    0.46     0.79        0.855       0.99
     Below the trouser top the torso tucks inside the pelvis, so a belt lives
     on the PELVIS (parts.hips: it wears the top sliver of the leg row). The
     neck opening is the collar band's width (X ~0.21 on every adult), so
     the shirt collar and the knot show through the jacket instead of behind
     a slit in its stand collar. Wearer's LEFT is +x (the weapon hand is the
     -x arm), which is where a breast pocket and its square go. */
  const TAILOR = { jNotch: 0.09, jChest: 0.45, jWaist: 0.775, tWaist: 0.79, tBelt: 0.855, tHem: 0.765, neck: 0.215 };
  const SHIRT_HEX = 0xf1f2ec;
  const fx = (x) => 0.5 + x;                                   // front column, body-centred units
  const fpts = (pts) => pts.map((p) => [fx(p[0]), p[1]]);
  const fmir = (pts) => pts.map((p) => [fx(-p[0]), p[1]]);
  function fboth(R, pts, css) { R.poly("front", fpts(pts), css); R.poly("front", fmir(pts), css); }
  // A TIE: the knot's lower half (its top is on the collar band, yokeTailored,
  // meeting it at the same width), 3.5 cm under the knot broadening down the
  // blade, the tip at the belt (or tucked into a waistcoat at its V).
  // A BOW TIE: its lower half on the chest (the collar band shows only its
  // top 2-3 cm above the collarbone notch; yokeTailored draws the top half)
  function paintBow(T, hex) {
    const wing = [[0.13, 0], [0.02, 0.03], [0.02, 0.085], [0.13, 0.115]];
    T.poly("front", fpts(wing), hx(hex)); T.poly("front", fmir(wing), hx(hex));
    T.poly("front", fpts([[-0.024, 0], [0.024, 0], [0.024, 0.09], [-0.024, 0.09]]), tone(hex, 0.2));
  }
  // buttons that read on any cloth: lighter on a dark suit, darker on a pale one
  function buttonTone(hex) {
    const l = 0.3 * ((hex >> 16) & 255) + 0.59 * ((hex >> 8) & 255) + 0.11 * (hex & 255);
    return l < 70 ? tone(hex, 0.3) : tone(hex, -0.45);
  }
  function paintTie(T, hex, y1, clipV) {
    const c = hx(hex), a = 0.032, b = 0.052, tipH = 0.05, kn = 0.105;
    T.poly("front", fpts([[-0.05, 0], [0.05, 0], [0.034, kn], [-0.034, kn]]), tone(hex, -0.16));
    T.poly("front", fpts([[-0.004, 0], [0.004, 0], [0.003, kn * 0.6], [-0.003, kn * 0.6]]), tone(hex, -0.45));   // the dimple runs out of the knot
    if (clipV) {                                               // tucked into a waistcoat at its V (apex y1, top half-width clipV)
      const yc = y1 * (1 - a / clipV);
      T.poly("front", fpts([[-a, kn], [a, kn], [a, yc], [0, y1], [-a, yc]]), c);
      return;
    }
    T.poly("front", fpts([[-a, kn], [a, kn], [b, y1 - tipH], [0, y1], [-b, y1 - tipH]]), c);
    T.poly("front", fpts([[a - 0.008, kn], [a, kn], [b, y1 - tipH], [b - 0.01, y1 - tipH]]), tone(hex, -0.25));   // one edge in shadow
  }

  // formalTorso(T, J, jacketHex, lapelCss, opts) — the shirt row and the open
  // jacket shell. opts: tie(hex) | bow, vest(hex|true), db, lapelType
  // ('notch'|'peak'|'shawl'), satin (tux facings), square, belt, close (a
  // server's higher gorge), pattern, ctx. Returns the neckwear the collar band
  // draws ({tie|bow, fp:1}).
  function formalTorso(T, J, jacketHex, lapelCss, opts) {
    const shirtHex = opts.shirt != null ? opts.shirt : SHIRT_HEX;           // white unless a closet recipe says
    const jc = hx(jacketHex), shirt = hx(shirtHex), shirtLo = tone(shirtHex, -0.1);
    const ctx = opts.ctx, lt = opts.lapelType || "notch", db = !!opts.db;
    const vhex = opts.vest ? (opts.vest === true ? jacketHex : opts.vest) : null;
    // ---- the SHIRT (torso row): shirt everywhere the shell covers, the
    //      jacket's skirt below its swept hem (THE SKIRT, below).
    T.fill(shirt);
    T.rect("front", fx(-0.012), 0.08, 0.024, TAILOR.tBelt - 0.08, shirtLo);   // placket
    if (vhex != null) {
      // THE WAISTCOAT: a deep V to mid-chest, five buttons, two welts, and
      // the points below the waist that a waistcoat is recognised by.
      const vc = hx(vhex), vV = 0.17, vY = 0.36;
      T.rect("front", 0, 0, 1, TAILOR.tBelt - 0.02, vc);
      T.poly("front", fpts([[-vV, 0], [vV, 0], [0, vY]]), shirt);
      T.poly("front", fpts([[-0.14, TAILOR.tBelt - 0.03], [0, TAILOR.tBelt - 0.03], [-0.05, TAILOR.tBelt + 0.045]]), vc);
      T.poly("front", fmir([[-0.14, TAILOR.tBelt - 0.03], [0, TAILOR.tBelt - 0.03], [-0.05, TAILOR.tBelt + 0.045]]), vc);
      T.rect("front", fx(-0.006), vY, 0.012, TAILOR.tBelt - vY - 0.02, tone(vhex, -0.3));
      for (let i = 0; i < 5; i++) T.dot("front", fx(0), vY + 0.06 + i * 0.085, 0.011, tone(vhex, 0.3));
      T.rect("front", fx(-0.3), 0.64, 0.13, 0.016, tone(vhex, -0.35));
      T.rect("front", fx(0.17), 0.64, 0.13, 0.016, tone(vhex, -0.35));
      if (opts.tie != null) paintTie(T, opts.tie, vY, vV);
      else if (opts.bow) { for (let i = 0; i < 2; i++) T.dot("front", fx(0), 0.17 + i * 0.09, 0.011, "#15161a"); paintBow(T, 0x0b0c10); }
    } else if (opts.bow) {
      // the dress shirt's pleated bib, three studs, and the cummerbund at the
      // natural waist (what the single button opens onto)
      for (const px of [-0.1, -0.06, 0.06, 0.1]) T.rect("front", fx(px) - 0.004, 0.1, 0.008, 0.5, shirtLo);
      for (let i = 0; i < 3; i++) T.dot("front", fx(0), 0.2 + i * 0.12, 0.012, "#15161a");
      paintBow(T, 0x0b0c10);
      const cb = "#0d0e12";
      T.rect("front", 0, TAILOR.tWaist - 0.05, 1, TAILOR.tBelt - TAILOR.tWaist + 0.05, cb);
      for (let i = 1; i < 4; i++) T.rect("front", 0, TAILOR.tWaist - 0.05 + i * 0.026, 1, 0.005, tone(0x0d0e12, 0.2));
    } else if (opts.tie != null) {
      paintTie(T, opts.tie, TAILOR.tBelt - 0.025, 0);
    }
    // THE SKIRT OF THE JACKET. The shell's front hem is swept up to the seated
    // lap line (entities/character.js partRings: hip joint + half a thigh),
    // which standing is the natural waist (torso row 0.77-0.81 on every body),
    // so a shell alone ends there and shows a band of shirt and the belt. What
    // a camera sees below that hem is the jacket's own lower front, so it is
    // painted on the body under it, down over the pelvis (which wears these
    // same rows): cloth all round, the quarters falling open below the button
    // over the fly and belt (a DB laps flat), the hip-pocket flaps (a dinner
    // jacket's are jetted). Seated, the thighs cover all of it.
    const h0 = TAILOR.tHem;
    // (sides and back from higher up: the swept hem lifts partway round the flank)
    T.rect("side", 0, 0.62, 1, 0.38, jc); T.rect("back", 0, 0.62, 1, 0.38, jc);
    T.rect("back", 0.494, TAILOR.tBelt + 0.04, 0.012, 1 - TAILOR.tBelt - 0.04, tone(jacketHex, -0.3));   // the vent
    if (db) {
      T.rect("front", 0, h0, 1, 1 - h0, jc);
      T.rect("front", fx(-0.07), h0, 0.008, 1 - h0, tone(jacketHex, -0.3));          // the lap's edge
    } else {
      const panel = [[-0.004, h0], [0.5, h0], [0.5, 1], [0.1, 1], [0.05, TAILOR.tBelt], [-0.004, h0 + 0.02]];
      T.poly("front", fpts(panel), jc);
      T.poly("front", fpts(panel.map((p) => [-p[0], p[1]])), jc);
    }
    for (const s of [1, -1]) {
      const x0 = s > 0 ? 0.1 : -0.34, fy = TAILOR.tBelt - 0.04;
      if (!opts.bow) T.rect("front", fx(x0), fy, 0.24, 0.034, tone(jacketHex, -0.08));   // the flap
      T.rect("front", fx(x0), fy, 0.24, 0.008, tone(jacketHex, -0.38));                   // the welt
      if (!opts.bow) T.rect("front", fx(x0), fy + 0.034, 0.24, 0.006, "rgba(0,0,0,0.3)");
    }
    T.shade();

    // ---- the JACKET SHELL (jacket row) ----
    J.fill(jc);
    if (ctx) patternRow(J, ctx, jacketHex, opts.pattern);    // cloth first: lapels/pockets draw over it
    const yb = db ? 0.66 : opts.bow ? 0.76 : vhex != null ? 0.72 : 0.74;   // the fastening (V apex)
    const g0 = opts.close ? 0.19 : TAILOR.neck, gy = 0.1;   // neck opening, straight down to the gorge
    const shadow = "rgba(0,0,0,0.28)", sheen = "rgba(255,255,255,0.12)";
    // THE COLLAR: jacket cloth round the neck and down to the gorge, a shade
    // darker than the chest (it stands off it) so the notch below reads.
    const collar = tone(jacketHex, -0.1);
    if (lt !== "shawl") fboth(J, [[g0 - 0.01, 0], [g0 + 0.09, 0], [0.36, 0.13], [0.31, 0.126], [g0 - 0.01, 0.07]], collar);
    // THE LAPEL (wearer's left, mirrored): from the gorge out to its point,
    // down the belly to the fastening; the inner edge is the V itself.
    let lap;
    if (lt === "peak") lap = [[g0 - 0.02, 0.06], [0.31, 0.126], [0.455, 0.08], [0.375, 0.27], [0.02, yb]];
    else if (lt === "shawl") lap = [[g0 - 0.02, 0], [g0 + 0.085, 0], [0.33, 0.14], [0.35, 0.26], [0.27, 0.44], [0.02, yb]];
    else lap = [[g0 - 0.02, 0.06], [0.31, 0.126], [0.3, 0.162], [0.385, 0.176], [0.335, 0.27], [0.02, yb]];
    fboth(J, lap, lapelCss);
    // the lapel stands proud: a shadow along its outer edge, a sheen along the ROLL
    const out = lap.slice(lt === "notch" ? 3 : 2);
    for (let i = 0; i < out.length - 1; i++) {
      const p = out[i], q = out[i + 1];
      fboth(J, [p, q, [q[0] + 0.012, q[1] + 0.004], [p[0] + 0.012, p[1] + 0.004]], shadow);
    }
    fboth(J, [[g0, gy], [g0 + 0.02, gy], [0.022, yb - 0.01], [0, yb]], sheen);
    if (lt !== "shawl") fboth(J, [[g0 - 0.01, 0.07], [0.31, 0.126], [0.31, 0.134], [g0 - 0.01, 0.078]], shadow);  // the gorge seam
    if (opts.satin) fboth(J, [[g0, gy], [g0 + 0.035, gy], [0.03, yb - 0.02], [0, yb]], "rgba(255,255,255,0.10)");  // satin catches light at the roll
    // THE BREAST POCKET: a welt high on the left chest, clear of the lapel
    // (the hip pockets are on the skirt, below the shell's swept hem)
    J.poly("front", fpts([[0.285, 0.375], [0.43, 0.36], [0.43, 0.382], [0.285, 0.397]]), tone(jacketHex, -0.32));
    if (opts.square) J.poly("front", fpts([[0.305, 0.377], [0.325, 0.343], [0.35, 0.366], [0.372, 0.346], [0.392, 0.369]]), hx(SHIRT_HEX));
    // BUTTONS: one fastened at the waist (the lower one of a two-button sits
    // under the swept hem, unbuttoned, where nobody sees it); a DB's 2x3
    const btn = buttonTone(jacketHex);
    if (db) {
      for (const y of [yb - 0.1, yb + 0.02]) { J.dot("front", fx(-0.13), y, 0.016, btn); J.dot("front", fx(0.13), y, 0.016, btn); }
      J.poly("front", fpts([[0, yb], [0.008, yb], [-0.062, yb + 0.07], [-0.062, 1], [-0.07, 1], [-0.07, yb + 0.066]]), tone(jacketHex, -0.3));  // the lap's edge
    } else J.dot("front", fx(0), yb + 0.02, 0.017, btn);
    // back and sides: the collar from behind, a centre seam, the vent(s), side seams
    J.rect("back", 0, 0, 1, 0.08, collar);
    J.rect("back", 0.494, 0.1, 0.012, 0.7, tone(jacketHex, -0.14));
    if (db || opts.bow) { J.rect("back", 0.2, 0.8, 0.012, 0.2, tone(jacketHex, -0.3)); J.rect("back", 0.788, 0.8, 0.012, 0.2, tone(jacketHex, -0.3)); }
    else J.rect("back", 0.494, 0.8, 0.012, 0.2, tone(jacketHex, -0.3));
    J.rect("side", 0.494, 0.2, 0.012, 0.8, tone(jacketHex, -0.14));
    // THE CUT: the open neck and the V to the fastening; single-breasted
    // quarters fall away below the button. Last, so nothing paints into it.
    J.clear("cap", 0, 0, 1, 1);
    J.clearPoly("front", fpts([[-g0, 0], [g0, 0], [g0, gy], [0, yb], [-g0, gy]]));
    if (!db) J.clearPoly("front", fpts([[0, yb + 0.045], [0.1, 1], [-0.1, 1]]));
    J.shade();
    return opts.bow ? { bow: 0x0b0c10, fp: 1 } : (opts.tie != null ? { tie: opts.tie | 0, fp: 1 } : { fp: 1 });
  }
  // formalLimbs: sleeves with a shirt cuff and surgeon's cuff buttons; creased
  // trousers that break on the shoe; a satin braid down a dinner suit's outseam;
  // the belt on the leg row's top sliver, which the pelvis wears (parts.hips).
  function formalLimbs(A, L, jacketHex, legHex, cuff, opts) {
    opts = opts || {};
    const jc = hx(jacketHex), ctx = opts.ctx;
    A.fill(jc);
    if (ctx) patternRow(A, ctx, jacketHex, opts.pattern);
    A.rect("front", 0, 0.03, 1, 0.012, tone(jacketHex, -0.2));     // the sleeve head seam
    A.rect("side", 0, 0.03, 1, 0.012, tone(jacketHex, -0.2));
    A.rect("side", 0.64, 0.86, 0.12, 0.09, tone(jacketHex, -0.4));   // the cuff vent and its buttons
    // a centimetre of shirt cuff past the sleeve, a satin-cuffed dinner shirt a touch more
    const cw = cuff ? 0.045 : 0.03;
    const sh = opts.shirt != null ? opts.shirt : SHIRT_HEX;
    for (const col of ["front", "side", "back"]) A.rect(col, 0, 1 - cw, 1, cw, col === "back" ? tone(sh, -0.06) : hx(sh));
    A.shade();
    L.fill(hx(legHex));
    if (ctx) patternRow(L, ctx, legHex, opts.pattern);
    L.rect("front", 0.49, 0.02, 0.02, 0.88, tone(legHex, 0.14));   // the pressed crease
    L.rect("back", 0.49, 0.02, 0.02, 0.88, tone(legHex, 0.08));
    if (opts.stripe) L.rect("side", 0.44, 0, 0.12, 1, tone(legHex, 0.22));   // the satin braid
    // THE BREAK: the crease dies in one soft fold where the hem meets the shoe
    for (const col of ["front", "side", "back"]) {
      L.rect(col, 0, 0.9, 1, 0.022, "rgba(0,0,0,0.22)");
      L.rect(col, 0, 0.922, 1, 0.012, "rgba(255,255,255,0.06)");
    }
    L.shade();
  }

  // tuxedo accepts an optional style record so the SUIT_STYLES table can ship
  // tux variants (shawl satin, midnight-blue, white dinner jacket, DB peak).
  PAINT.tuxedo = function (P, c, st) {
    st = st || {};
    const body = st.body != null ? st.body : 0x16171c;            // lifted off true black so shading reads
    const lapel = st.lapelCss || tone(body, 0.16);
    const legs = st.legs != null ? st.legs : 0x14151a;
    const neck = formalTorso(P.T, P.J, body, lapel, { bow: true, square: true, satin: st.satin !== false, lapelType: st.lapel || "shawl", db: !!st.db, ctx: P.ctx, pattern: st.pattern });
    formalLimbs(P.A, P.L, body, legs, true, { ctx: P.ctx, pattern: st.pattern, stripe: true });
    return { torso: 1, arms: 1, legs: 1, jacket: 1, fp: 1, neck: neck, skirt: { hex: body } };
  };
  // suit accepts a STYLE record (SUIT_STYLES entry) OR a raw colors record. The
  // style drives pattern/db/vest/lapel/tie; raw {torso,legs} still works.
  PAINT.suit = function (P, c, st) {
    if (typeof st === "number") st = { tie: st };                  // legacy: a bare tie hex
    st = st || {};
    const body = st.body != null ? st.body : (c && c.torso != null ? c.torso : 0x1c2030);
    const legs = st.legs != null ? st.legs : ((c && c.legs != null) ? c.legs : tone2(body, -0.08));
    const lapelCss = st.lapelCss || tone(body, st.pattern && st.pattern !== "solid" ? 0.1 : 0.16);
    const neck = formalTorso(P.T, P.J, body, lapelCss, {
      tie: st.tie != null ? st.tie : 0x7a1f2b, lapelType: st.lapel || "notch",
      pattern: st.pattern, db: !!st.db, vest: st.vest, ctx: P.ctx,
      // a pocket square is a DRESSIER stance, so the styles that already carry
      // one (waistcoat, double-breasted, shawl dinner jacket) get it without
      // twenty-two table edits; an explicit st.square still wins either way.
      square: st.square != null ? !!st.square : (!!st.vest || !!st.db || st.lapel === "shawl"),
    });
    formalLimbs(P.A, P.L, body, legs, false, { ctx: P.ctx, pattern: st.pattern });
    return { torso: 1, arms: 1, legs: 1, jacket: 1, fp: 1, neck: neck, skirt: { hex: body } };
  };

  // ============================================================
  //  THE DUTY UNIFORM — one garment on the shaped body.
  //
  //  Owner: "a weird mix of geometric and paint, made for the old body." A
  //  cop wore an OPEN duty-jacket shell over a lighter shirt (it read as a
  //  sports coat), a painted gold badge AND a gold cube, a painted "holster
  //  block" and a painted radio rectangle. Now each detail is ONE thing:
  //    • CLOTH is paint, here, laid out for the shaped torso (character.js
  //      TORSO block: u is a planar projection across each face, v the old box
  //      span, so a fraction here is a fraction of the real chest). Measured
  //      on the profiles: the pectoral / bust apex sits at row ~0.45-0.49 and
  //      |x| ~0.41 of the section, i.e. u ~0.245 / 0.755 on the front face —
  //      the breast pockets are centred there and hang from a flap at 0.30, so
  //      on a woman they sit on the upper slope of the bust, where a uniform
  //      shirt's pockets are cut. Pockets are SEAMS and FLAPS in the shirt's
  //      own cloth, not tone blocks: a real pocket is the same fabric.
  //    • everything HARD is entities/dutykit.js geometry: belt, buckle,
  //      holster + grip, pouches, radio, torch, cuff case, epaulette straps,
  //      the metal badge. Nothing here paints a belt, a holster or a radio.
  //    • no jacket shell: a duty shirt is worn tucked, under the belt.
  //  o: {shirt, legs, tie, open (undershirt hex), stripe [w, hex], cargo,
  //      patch [body, border, inner], tape (nameplate css), shade}
  // ============================================================
  function dutyShirt(P, o) {
    const T = P.T, A = P.A, L = P.L, sh = o.shirt, sc = hx(sh);
    const seam = tone(sh, -0.2), deep = tone(sh, -0.34);
    T.fill(sc);
    let placketTop = 0.1;
    if (o.tie != null) {
      // blade from row 0 (the knot is on the collar band, clothes.js yoke atlas)
      T.rect("front", 0.47, 0, 0.06, 0.62, hx(o.tie));
      T.poly("front", [[0.47, 0.62], [0.53, 0.62], [0.5, 0.68]], hx(o.tie));
      placketTop = 0.68;
    } else if (o.open != null) {
      // open collar: the undershirt V and the two collar points lying open
      T.poly("front", [[0.41, 0], [0.59, 0], [0.5, 0.13]], hx(o.open));
      T.poly("front", [[0.35, 0], [0.43, 0], [0.5, 0.135], [0.42, 0.1]], seam);
      T.poly("front", [[0.65, 0], [0.57, 0], [0.5, 0.135], [0.58, 0.1]], seam);
      placketTop = 0.13;
    }
    T.rect("front", 0.487, placketTop, 0.026, 0.95 - placketTop, tone(sh, -0.12));       // button placket
    for (let y = 0.2; y < 0.9; y += 0.13) if (y > placketTop + 0.02) T.dot("front", 0.5, y, 0.011, deep);
    for (const cx of [0.245, 0.755]) {                                                   // the breast pockets
      const x0 = cx - 0.11, x1 = cx + 0.11;
      T.rect("front", x0, 0.335, 0.012, 0.145, seam);
      T.rect("front", x1 - 0.012, 0.335, 0.012, 0.145, seam);
      T.rect("front", x0, 0.468, 0.22, 0.012, seam);
      T.rect("front", cx - 0.004, 0.36, 0.008, 0.11, tone(sh, -0.14));                  // box pleat
      T.poly("front", [[x0 - 0.005, 0.3], [x1 + 0.005, 0.3], [x1 + 0.005, 0.338], [cx, 0.36], [x0 - 0.005, 0.338]], tone(sh, -0.08));
      T.rect("front", x0 - 0.005, 0.3, 0.23, 0.008, seam);                               // flap top seam
      T.dot("front", cx, 0.342, 0.011, deep);                                           // flap button
    }
    // the nameplate over the RIGHT pocket (u < 0.5 is the wearer's right). Blank:
    // no invented names.
    if (o.tape) T.rect("front", 0.16, 0.262, 0.17, 0.026, o.tape);
    T.rect("back", 0, 0.12, 1, 0.012, seam);                                             // back yoke seam
    T.rect("back", 0.28, 0.13, 0.01, 0.4, tone(sh, -0.1));                               // back pleats
    T.rect("back", 0.71, 0.13, 0.01, 0.4, tone(sh, -0.1));
    T.rect("side", 0.49, 0.1, 0.02, 0.9, tone(sh, -0.12));                               // side seam
    T.shade();
    // SLEEVES: long, a shoulder seam at the sleeve head, the agency patch on
    // the outer upper arm, a buttoned cuff at the wrist
    A.fill(sc);
    for (const col of ["front", "back", "side"]) {
      A.rect(col, 0, 0, 1, 0.03, seam);
      A.rect(col, 0, 0.9, 1, 0.07, tone(sh, -0.07));
      A.rect(col, 0, 0.9, 1, 0.01, seam);
    }
    A.dot("front", 0.72, 0.935, 0.03, deep);
    if (o.patch) {
      const pb = o.patch;
      A.poly("side", [[0.22, 0.065], [0.78, 0.065], [0.78, 0.17], [0.5, 0.215], [0.22, 0.17]], pb[1]);  // border
      A.poly("side", [[0.27, 0.074], [0.73, 0.074], [0.73, 0.165], [0.5, 0.203], [0.27, 0.165]], pb[0]);
      A.poly("side", [[0.4, 0.1], [0.6, 0.1], [0.6, 0.15], [0.5, 0.17], [0.4, 0.15]], pb[2]);
    }
    A.shade();
    // TROUSERS: a pressed crease, the agency's stripe down the outseam, a
    // cargo pocket if the agency wears one, and the break over the boot
    const lg = o.legs;
    L.fill(hx(lg));
    L.rect("front", 0.494, 0, 0.012, 0.93, tone(lg, 0.12));
    L.rect("back", 0.494, 0, 0.012, 0.93, tone(lg, 0.06));
    if (o.stripe) L.rect("side", 0.5 - o.stripe[0] / 2, 0, o.stripe[0], 0.95, o.stripe[1]);
    else L.rect("side", 0.492, 0, 0.016, 0.95, tone(lg, -0.2));
    if (o.cargo) {
      L.rect("side", 0.2, 0.26, 0.6, 0.012, tone(lg, -0.25));
      L.rect("side", 0.2, 0.26, 0.012, 0.17, tone(lg, -0.25));
      L.rect("side", 0.788, 0.26, 0.012, 0.17, tone(lg, -0.25));
      L.rect("side", 0.2, 0.42, 0.6, 0.012, tone(lg, -0.25));
    }
    for (const col of ["front", "back", "side"]) L.rect(col, 0, 0.93, 1, 0.07, tone(lg, -0.22));
    L.shade();
    const parts = { torso: 1, arms: 1, legs: 1 };
    if (o.tie != null && neckV2()) parts.neck = { tie: o.tie, w: 0.06 };
    return parts;
  }

  // city patrol: navy long-sleeve shirt and tie, silver nameplate, a thin
  // dark stripe down the trousers (entities/dutykit.js: silver shield, pistol)
  PAINT.police = function (P, c) {
    const uni = (c && c.torso != null) ? c.torso : 0x24407a;
    return dutyShirt(P, {
      shirt: uni, legs: (c && c.legs != null) ? c.legs : 0x1b2a44, tie: 0x16264a,
      stripe: [0.07, tone((c && c.legs != null) ? c.legs : 0x1b2a44, -0.5)],
      patch: [tone(uni, -0.32), "#d4b04e", "#b9c6da"], tape: "#c4cad3",
    });
  };
  PAINT.precinct = PAINT.police;             // the desk officer's (non-cop) copy of the patrol uniform

  function paintSwat(P, c, wordmarks) {
    // SWAT REDESIGN — police-parity detail. Two-tone: graphite fatigues under a
    // dark-OLIVE plate carrier painted on the JACKET shell (a shell of the
    // body's own surface, character.js humanShellSpec), so a SWAT reads as a
    // bulked-up carrier over a working uniform instead of a near-black smudge.
    // Contrast trims (pale SWAT placards, differentiated pouches, silver
    // buckle) keep it READABLE while staying tactical-dark. This painter is
    // also the player's lootable disguise (outfits.js routes the corpse-swap
    // through it), so the detail pays twice.
    const fat = (c && c.legs != null) ? c.legs : 0x2e332b;          // graphite-olive fatigues
    const carr = (c && c.torso != null) ? c.torso : 0x3a4034;       // dark-olive carrier
    const fc = hx(fat), cc = hx(carr);
    const pouch = tone(carr, -0.26), strap = tone(carr, -0.45), plate = tone(carr, 0.09);
    const T = P.T, J = P.J, A = P.A, L = P.L, ctx = P.ctx;
    // ---- torso = the combat shirt under the carrier. The battle belt, the
    //      holster, the mag and cuff pouches are entities/dutykit.js geometry
    //      (they used to be painted blocks here, under a real belt nobody had) ----
    T.fill(fc);
    T.rect("front", 0.46, 0, 0.08, 0.3, tone(fat, -0.35));          // zip placket
    T.rect("side", 0.49, 0.1, 0.02, 0.9, tone(fat, -0.2));          // side seam
    T.shade();
    // ---- the PLATE CARRIER rides the jacket shell (real bulk) ----
    J.fill(cc);
    J.clear("cap", 0, 0, 1, 1);
    J.clear("front", 0, 0.76, 1, 0.24);                             // carrier hem — shirt + belt show below
    J.clear("back", 0, 0.76, 1, 0.24);
    J.clear("side", 0, 0.76, 1, 0.24);
    J.rect("front", 0.18, 0.14, 0.64, 0.48, plate);                 // chest plate bag (raised tone)
    J.rect("front", 0.18, 0.14, 0.64, 0.035, strap);                //   plate-bag top seam
    if (wordmarks !== false) {
      J.rect("front", 0.3, 0.045, 0.4, 0.085, "#e9e7db");           // "SWAT" placard (front)
      J.rect("back", 0.24, 0.08, 0.52, 0.13, "#e9e7db");            // "SWAT" placard (back)
    }
    J.rect("front", 0.24, 0.27, 0.26, 0.11, pouch);                 // admin pouch (wide, flapped)
    J.rect("front", 0.24, 0.27, 0.26, 0.032, strap);
    J.rect("front", 0.55, 0.38, 0.15, 0.21, pouch);                 // rifle-mag pouch (tall)
    J.rect("front", 0.55, 0.38, 0.15, 0.04, strap);
    J.rect("front", 0.73, 0.41, 0.11, 0.15, tone(carr, -0.12));     // pistol-mag pouch (smaller, lighter)
    J.dot("front", 0.625, 0.4, 0.02, strap);                        // bungee pulls
    J.dot("front", 0.785, 0.43, 0.016, strap);
    J.rect("front", 0.07, 0.06, 0.13, 0.2, "#14161a");              // radio block on the left shoulder strap
    J.rect("front", 0.09, 0.01, 0.035, 0.06, "#14161a");            //   antenna stub
    J.rect("side", 0.12, 0.28, 0.76, 0.34, plate);                  // cummerbund side plates
    J.rect("back", 0.28, 0.28, 0.44, 0.4, plate);                   // back plate bag
    J.shade();
    // block "SWAT" lettering stamped straight into the atlas (after shade so
    // the letters stay crisp) — guarded for stub canvases in the harness.
    if (wordmarks !== false && ctx && ctx.fillText) {
      ctx.save();
      ctx.fillStyle = "#1a1c22";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const jy0 = ROWS.jacket[0], jh = ROWS.jacket[1] - ROWS.jacket[0];
      const f = COLS.front, b = COLS.back;
      ctx.font = "bold 6px Arial, sans-serif";
      ctx.fillText("SWAT", f[0] + 0.5 * (f[1] - f[0]), jy0 + 0.09 * jh);
      ctx.font = "bold 8px Arial, sans-serif";
      ctx.fillText("SWAT", b[0] + 0.5 * (b[1] - b[0]), jy0 + 0.145 * jh);
      ctx.restore();
    }
    // ---- arms: fatigue sleeves, carrier shoulder cap + subdued patch ----
    A.fill(fc);
    A.rect("front", 0.14, 0.03, 0.72, 0.2, cc);                     // shoulder cap
    A.rect("side", 0.14, 0.03, 0.72, 0.2, cc);
    A.rect("back", 0.14, 0.03, 0.72, 0.2, cc);
    A.rect("front", 0.26, 0.08, 0.48, 0.11, tone(carr, -0.35));     // subdued unit patch
    A.rect("front", 0.14, 0.64, 0.72, 0.09, tone(fat, -0.3));       // elbow-pad strap
    A.shade();
    // ---- legs: subtle camo tone break + cargo pocket + knee pads (the
    //      holster is the belt kit's; no painted thigh rig beside it) ----
    L.fill(fc);
    L.rect("front", 0, 0.1, 1, 0.14, tone(fat, 0.08));              // camo-ish tone break
    L.rect("front", 0.42, 0.26, 0.58, 0.1, tone(fat, -0.14));
    L.rect("back", 0, 0.14, 1, 0.16, tone(fat, 0.08));
    L.rect("side", 0, 0.18, 1, 0.12, tone(fat, -0.14));
    L.rect("side", 0.2, 0.3, 0.6, 0.16, tone(fat, -0.1));           // cargo pocket
    L.rect("side", 0.2, 0.3, 0.6, 0.03, strap);                     //   its flap
    L.rect("front", 0.14, 0.46, 0.72, 0.2, "#23262c");              // knee-pad block
    L.rect("front", 0.22, 0.5, 0.56, 0.11, "#31353d");              //   pad face
    L.rect("front", 0, 0.92, 1, 0.08, tone(fat, -0.35));            // boot break
    L.rect("side", 0, 0.92, 1, 0.08, tone(fat, -0.35));
    L.shade();
    return { torso: 1, arms: 1, legs: 1, jacket: 1 };
  }
  PAINT.swat = function (P, c) { return paintSwat(P, c, true); };
  // Prison riot responders use Gang City's complete SWAT garment and armor
  // silhouette, but the owner rejected uniform wordmarks. This is one painter
  // with that cosmetic layer gated off, not a forked tactical outfit.
  PAINT.swat_unmarked = function (P, c) { return paintSwat(P, c, false); };

  // ---- PRISON ESCAPE: one painted-clothing language for both games --------
  // The direct prison used flat orange/navy boxes long after Gang City uniforms
  // had gained seams, pockets, patches, layered jackets and tactical carriers.
  // These painters deliberately use this atlas rather than adding geometry in
  // entities/player|guards|npc: one shared texture per fit, identical draw-call
  // cost, and the same yoke/body-fit guarantees as every City outfit.
  // ============================================================
  //  WORK-WEAR KIT on the shaped body. The landmarks are TORSO_ROW's (top of
  //  file) plus two more, measured the same way off men and women of every
  //  physique, children 7-15 and elders (all agree within 0.04):
  //    · the armpit ~0.25-0.31 on the torso row (side seams start there, and
  //      a vest's armhole ends there);
  //    · a man's pec peaks at 0.45, a woman's bust at 0.49 and is flat again
  //      by ~0.38 above it — so a CHEST POCKET at 0.24-0.38 sits on the upper
  //      chest of both, never across a bust;
  //    · arm row: elbow 0.64, wrist crease 1. Leg row: 0-0.12 is inside the
  //      pelvis, knee 0.505, ankle (the shoe) 1.
  //  Every band that goes round a body is painted on front, back AND side
  //  (TORSO_ROW's hemBand): a stripe on one face is a sticker, not a stripe.
  // ============================================================
  const WORK_ROW = { pocket: 0.24, pocketH: 0.14, armpit: 0.30 };
  // retroreflective trim: an edge colour with a silver core (NFPA triple trim /
  // the ANSI vest tape), round the body
  function tape(R, y, h, edge, core) { hemBand(R, edge, y, h); hemBand(R, core, y + h * 0.3, h * 0.4); }
  // a flapped patch pocket: bag, flap, and the flap's shadow line
  function flapPocket(R, col, x, y, w, h, body) {
    R.rect(col, x, y, w, h, tone(body, -0.1));
    R.rect(col, x, y, w, h * 0.3, tone(body, -0.2));
    R.rect(col, x, y + h * 0.3, w, 0.012, tone(body, -0.4));
  }
  // a cuff / trouser hem at the bottom of a limb row, with its stitch line
  function limbHem(R, y, body) { hemBand(R, tone(body, -0.12), y, 1 - y); hemBand(R, tone(body, -0.34), y, 0.012); }
  // trousers on the pelvis (THE SEAT): fly, slash pockets, seat pockets, seams
  function trouserSeat(J, legs) {
    J.fill(hx(legs));
    J.rect("front", 0.49, 0, 0.02, 0.62, tone(legs, -0.3));                     // fly
    J.poly("front", [[0.04, 0.04], [0.1, 0.04], [0.22, 0.4], [0.16, 0.4]], tone(legs, -0.24));   // slash pockets
    J.poly("front", [[0.96, 0.04], [0.9, 0.04], [0.78, 0.4], [0.84, 0.4]], tone(legs, -0.24));
    J.rect("back", 0.12, 0.1, 0.28, 0.34, tone(legs, -0.1)); J.rect("back", 0.6, 0.1, 0.28, 0.34, tone(legs, -0.1));
    J.rect("back", 0.49, 0, 0.02, 1, tone(legs, -0.22));                        // centre-back seam
    J.rect("side", 0.48, 0, 0.04, 1, tone(legs, -0.22));
    hemBand(J, tone(legs, -0.16), 0, 0.04);                                       // waistband
  }

  /* THE ONE-PIECE. A jumpsuit/coverall is one garment on four rows: the same
     cloth, one zip from the collarbone notch through the waist to the fork of
     the seat, chest pockets on the upper chest, an elastic waist at the real
     waist, seat pockets on the SEAT (the pelvis — they used to be painted on
     the small of the back), sleeves hemmed at the wrist crease, legs hemmed at
     the ankle. o.under: the tee in the open neck. o.panel: a racing suit's
     side panel colour, run shoulder to ankle. o.legStripe: a trustee's leg
     stripe, waistband to hem. */
  function jumpsuit(P, body, o) {
    o = o || {};
    const T = P.T, J = P.J, A = P.A, L = P.L, bc = hx(body);
    const seam = tone(body, -0.32), stitch = tone(body, -0.16);
    T.fill(bc);
    const zipTop = o.under != null ? 0.15 : 0.07;
    if (o.under != null) T.poly("front", [[0.40, 0], [0.60, 0], [0.5, zipTop]], hx(o.under));
    T.rect("front", 0.488, zipTop, 0.024, 1 - zipTop, seam);
    flapPocket(T, "front", 0.12, WORK_ROW.pocket, 0.24, WORK_ROW.pocketH, body);
    flapPocket(T, "front", 0.64, WORK_ROW.pocket, 0.24, WORK_ROW.pocketH, body);
    T.rect("back", 0, 0.19, 1, 0.012, stitch);                                  // back yoke seam
    T.rect("side", 0.48, WORK_ROW.armpit, 0.04, 1 - WORK_ROW.armpit, stitch);   // side seams
    const wy = TORSO_ROW.waist;                                                  // the elastic waist
    hemBand(T, tone(body, -0.08), wy - 0.02, 0.04);
    hemBand(T, seam, wy - 0.02, 0.01);
    hemBand(T, seam, wy + 0.01, 0.01);
    if (o.panel != null) T.rect("side", 0.22, WORK_ROW.armpit, 0.56, 1 - WORK_ROW.armpit, hx(o.panel));
    T.shade();
    J.fill(bc);
    J.rect("front", 0.488, 0, 0.024, 0.74, seam);                               // the zip runs to the fork
    J.poly("front", [[0.05, 0.03], [0.11, 0.03], [0.23, 0.42], [0.17, 0.42]], seam);    // slash hip pockets
    J.poly("front", [[0.95, 0.03], [0.89, 0.03], [0.77, 0.42], [0.83, 0.42]], seam);
    flapPocket(J, "back", 0.12, 0.1, 0.28, 0.36, body);                          // seat pockets
    flapPocket(J, "back", 0.6, 0.1, 0.28, 0.36, body);
    J.rect("back", 0.49, 0, 0.02, 1, stitch);
    J.rect("side", 0.48, 0, 0.04, 1, stitch);
    if (o.panel != null) J.rect("side", 0.22, 0, 0.56, 1, hx(o.panel));
    if (o.legStripe != null) J.rect("side", 0.36, 0, 0.28, 1, hx(o.legStripe));
    J.shade();
    A.fill(bc);
    hemBand(A, stitch, 0.03, 0.012);                                             // the set-in sleeve seam
    if (o.panel != null) A.rect("side", 0.3, 0, 0.4, 0.92, hx(o.panel));
    limbHem(A, 0.92, body);
    A.shade();
    L.fill(bc);
    L.rect("side", 0.48, 0, 0.04, 1, stitch);                                    // outside seam
    if (o.panel != null) L.rect("side", 0.22, 0, 0.56, 0.93, hx(o.panel));
    if (o.legStripe != null) L.rect("side", 0.36, 0, 0.28, 0.93, hx(o.legStripe));
    limbHem(L, 0.93, body);
    L.shade();
    return { torso: 1, arms: 1, legs: 1, seat: { hex: body } };
  }

  // the issue orange coverall — every inmate, and the player, wears this
  PAINT.inmate = function (P, c) {
    return jumpsuit(P, (c && c.torso != null) ? c.torso : 0xf27a1f, { under: 0xe8e2d4 });
  };
  PAINT.inmate_cap = PAINT.inmate;

  // THE JUMPSUIT TIED AT THE WAIST. The way half a real yard wears the issue
  // coverall: top peeled off, sleeves knotted round the waist, a ribbed tank
  // under it — and BARE ARMS, which is the only place arm ink is ever seen.
  // Skin-keyed (arms, neck scoop and armholes are the wearer's tone) and
  // ink-keyed (entities/heritage.js paints the sleeve set into the same row).
  // Below the knot it IS the coverall (jumpsuit): same seat, same legs.
  PAINT.inmate_tank = function (P, c) {
    const orange = (c && c.legs != null) ? c.legs : 0xf27a1f;
    const white = 0xe6e3d9, skin = (c && c.skin != null) ? c.skin : 0xcf9a72;
    const parts = jumpsuit(P, orange, {});
    const oc = hx(orange), seam = tone(orange, -0.32), wc = hx(white), sk = hx(skin), rib = tone(white, -0.09);
    const T = P.T, J = P.J, A = P.A;
    T.fill(wc);
    T.poly("front", [[0.30, 0], [0.70, 0], [0.64, 0.12], [0.5, 0.17], [0.36, 0.12]], sk);   // scoop neck
    T.poly("back", [[0.34, 0], [0.66, 0], [0.5, 0.08]], sk);
    // deep armholes: the outer shoulder is skin, the straps run over the trapezius
    for (const col of ["front", "back"]) {
      T.poly(col, [[0, 0], [0.22, 0], [0.13, 0.17], [0.03, 0.29], [0, 0.3]], sk);
      T.poly(col, [[1, 0], [0.78, 0], [0.87, 0.17], [0.97, 0.29], [1, 0.3]], sk);
    }
    T.rect("side", 0, 0, 1, 0.28, sk);
    T.poly("side", [[0, 0.28], [1, 0.28], [0.8, 0.32], [0.2, 0.32]], sk);
    for (const col of ["front", "back", "side"]) for (let x = 0.08; x < 1; x += 0.11) T.rect(col, x, 0.18, 0.014, 0.52, rib);
    // the peeled-down top bunched round the waist, the sleeves knotted in front
    hemBand(T, oc, 0.70, 0.30);
    hemBand(T, seam, 0.70, 0.012);
    hemBand(T, tone(orange, -0.14), 0.75, 0.01);
    T.poly("front", [[0.40, 0.69], [0.60, 0.69], [0.57, 0.82], [0.43, 0.82]], tone(orange, 0.10));   // the knot
    T.rect("front", 0.495, 0.69, 0.01, 0.13, seam);
    T.shade();
    // the two sleeve tails hang from the knot down the front of the seat
    J.poly("front", [[0.42, 0], [0.50, 0], [0.44, 0.64], [0.33, 0.58]], tone(orange, -0.10));
    J.poly("front", [[0.50, 0], [0.58, 0], [0.67, 0.56], [0.56, 0.62]], tone(orange, 0.06));
    J.rect("front", 0.33, 0.56, 0.11, 0.03, seam); J.rect("front", 0.56, 0.58, 0.11, 0.03, seam);   // hemmed cuffs
    A.fill(sk);
    A.shade();
    // BARE ARMS ARE THE WEARER'S OWN (`sleeves: "none"`): applyClothes hangs
    // flat skin on them, which is where his ink lives (entities/tattoo.js
    // paints a whole-arm chart at 320 px round the limb; this atlas's arm
    // row was 64 x 40 px for the entire arm). A tank has no collar: the
    // collar band is bare neck.
    delete parts.arms;
    return Object.assign(parts, { yoke: skin, sleeves: "none" });
  };

  // the infirmary orderly: a white pull-over scrub tunic over the issue orange
  // trousers, a red cross over the heart, sleeves to the wrist
  PAINT.inmate_orderly = function (P, c) {
    const top = (c && c.torso != null) ? c.torso : 0xe7edf0;
    const orange = (c && c.legs != null) ? c.legs : 0xe76518;
    const T = P.T, J = P.J, A = P.A, L = P.L, tc = hx(top);
    T.fill(tc);
    T.poly("front", [[0.35, 0], [0.50, 0.22], [0.65, 0]], tone(top, -0.2));         // V neck
    T.poly("front", [[0.38, 0], [0.50, 0.17], [0.62, 0]], tone(top, -0.06));
    T.rect("front", 0.18, 0.26, 0.12, 0.035, "#b73535");                         // red cross, left chest
    T.rect("front", 0.2225, 0.22, 0.035, 0.115, "#b73535");
    flapPocket(T, "front", 0.12, 0.56, 0.24, 0.16, top);                         // tunic hip pockets
    flapPocket(T, "front", 0.64, 0.56, 0.24, 0.16, top);
    T.rect("side", 0.48, WORK_ROW.armpit, 0.04, 1 - WORK_ROW.armpit, tone(top, -0.12));
    T.shade();
    A.fill(tc); hemBand(A, tone(top, -0.12), 0.03, 0.012); limbHem(A, 0.92, top); A.shade();
    trouserSeat(J, orange); J.shade();
    L.fill(hx(orange));
    L.rect("side", 0.48, 0, 0.04, 1, tone(orange, -0.22));
    limbHem(L, 0.93, orange);
    L.shade();
    return { torso: 1, arms: 1, legs: 1, seat: { hex: orange } };
  };

  // the chapel trustee: the same one-piece in grey, a white shirt collar in the
  // neck, and the orange trustee stripe down the outside of each leg
  PAINT.inmate_chapel = function (P, c) {
    return jumpsuit(P, (c && c.torso != null) ? c.torso : 0x505c6b, { under: 0xeee8dc, legStripe: 0xe77724 });
  };

  // prison officers: slate uniform shirt worn open over a black undershirt,
  // a light stripe and a cargo pocket on the trousers (entities/dutykit.js:
  // gold shield, radio, keys, a taser — no firearm inside the walls)
  PAINT.corrections = function (P, c) {
    const uni = (c && c.torso != null) ? c.torso : 0x34475d;
    const legs = (c && c.legs != null) ? c.legs : 0x202936;
    return dutyShirt(P, {
      shirt: uni, legs: legs, open: 0x15171b, stripe: [0.1, tone(uni, 0.22)], cargo: 1,
      patch: [tone(uni, -0.3), "#c9a94a", "#8ea596"], tape: "#c4cad3",
    });
  };

  PAINT.warden = function (P, c) {
    const body = (c && c.torso != null) ? c.torso : 0x222b3d;
    const legs = (c && c.legs != null) ? c.legs : 0x171c28;
    const gold = "#d8b44b", shirt = "#e8e3d8", tie = 0x6c2430;
    const T = P.T, J = P.J, A = P.A, L = P.L;
    T.fill(shirt);
    T.rect("front", 0.46, 0, 0.08, 0.72, hx(tie));
    T.poly("front", [[0.46, 0.70], [0.54, 0.70], [0.50, 0.80]], hx(tie));
    T.rect("front", 0, 0.84, 1, 0.16, "#111419");
    T.shade();
    J.fill(hx(body));
    J.clear("cap", 0, 0, 1, 1);
    J.clearPoly("front", [[0.47, 0], [0.53, 0], [0.59, 1], [0.41, 1]]);
    J.rect("front", 0.10, 0.27, 0.27, 0.14, tone(body, -0.13));
    J.rect("front", 0.63, 0.27, 0.27, 0.14, tone(body, -0.13));
    // (the badge is the rig's own fitted metal shield — character.js c.badge —
    // not a second one painted beside it)
    J.rect("front", 0.60, 0.12, 0.29, 0.055, gold);
    J.rect("front", 0.06, 0.02, 0.30, 0.055, gold);                 // rank bars
    J.rect("front", 0.64, 0.02, 0.30, 0.055, gold);
    J.shade();
    A.fill(hx(body));
    A.rect("front", 0.03, 0.03, 0.94, 0.13, gold);                  // dress epaulettes
    A.rect("side", 0.03, 0.03, 0.94, 0.13, gold);
    A.rect("front", 0, 0.90, 1, 0.08, gold);                       // cuff braid
    A.shade();
    L.fill(hx(legs)); L.rect("side", 0.44, 0, 0.12, 1, gold); L.shade();
    const parts = { torso: 1, arms: 1, legs: 1, jacket: 1 };
    if (neckV2()) parts.neck = { tie: tie, w: 0.08 };
    return parts;
  };

  PAINT.gang = function (P, c) {
    const hue = (c && c.torso != null) ? c.torso : 0xb079ea;
    const acc = (c && c.collar != null) ? c.collar : 0x141820;
    const T = P.T, A = P.A, L = P.L, hc = hx(hue), ac = hx(acc);
    T.fill(hc);
    // a single bandana SASH worn across the chest (the crew read) — one clean
    // diagonal band of the accent color, not a full hoop + polka dots + a
    // floating diamond. Reads instantly as "flying colors", looks intentional.
    // ONE BAND, LEFT SHOULDER TO RIGHT HIP AND BACK UP: the back used to carry
    // a level hoop at 0.18 and the flank another at 0.2, so the sash that left
    // the front at the right hip (0.46-0.62) met neither. The back column's u
    // runs +x -> -x, so the back is the front MIRRORED in u: it picks the band
    // up at the right hip and climbs to the left shoulder, and the flank
    // carries it level at the hip where the two meet.
    // (warlord/outfits.js's geometric sash over armour copies this angle.)
    T.poly("front", [[0, 0.18], [0.18, 0.1], [1, 0.46], [1, 0.58], [0.82, 0.62], [0, 0.3]], ac);
    T.poly("back", [[1, 0.18], [0.82, 0.1], [0, 0.46], [0, 0.58], [0.18, 0.62], [1, 0.3]], ac);
    T.rect("side", 0, 0.46, 1, 0.12, ac);
    T.rect("front", 0.49, 0.11, 0.02, 0.12, tone(hue, -0.15));      // collar placket, below the collar band
    hemBand(T, tone(hue, -0.4));                                    // waistband, above the tuck
    T.shade();
    // the crew ARMBAND, all the way round the upper arm (it had no back)
    A.fill(hc); for (const col of ["front", "back", "side"]) A.rect(col, 0, 0.3, 1, 0.09, ac); A.shade();
    L.fill(hx((c && c.legs != null) ? c.legs : 0x23262c));
    L.rect("side", 0.38, 0, 0.24, 1, ac);
    L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  };

  /* THE VEST OVER A SHIRT. A safety vest is a second garment: the shirt is the
     base layer (sleeves, collar, the armholes and the neck V), and the vest is
     painted OVER it with its own edges — cut away round the arm to the armpit,
     open in a V to where its zip starts, hemmed at the belt line so a sliver
     of shirt shows before the trousers. ANSI Class 2 tape: two bands round the
     body under the chest and two braces over the shoulders that meet the upper
     band, front and back (o.backX: crossed on the back, the airside pattern).
     o.tape null = a plain blaze vest (hunter). o.under(R): a patterned shirt
     (camo) instead of a solid one. Collar = the shirt's (parts.yoke). */
  function workVest(P, o) {
    const T = P.T, A = P.A, L = P.L, vc = hx(o.vest), sc = hx(o.shirt);
    const hem = TORSO_ROW.waist + 0.02, edge = tone(o.vest, -0.22);
    if (o.under) o.under(T); else T.fill(sc);
    // the vest panels, cut round the arms (to the armpit) and open at the neck
    const ap = WORK_ROW.armpit;
    T.poly("front", [[0.12, 0], [0.3, 0], [0.5, 0.34], [0.7, 0], [0.88, 0], [0.93, 0.18], [1, ap], [1, hem], [0, hem], [0, ap], [0.07, 0.18]], vc);
    T.poly("back", [[0.12, 0], [0.34, 0], [0.5, 0.06], [0.66, 0], [0.88, 0], [0.93, 0.18], [1, ap], [1, hem], [0, hem], [0, ap], [0.07, 0.18]], vc);
    T.rect("side", 0, ap, 1, hem - ap, vc);
    T.poly("front", [[0.3, 0], [0.34, 0], [0.5, 0.3], [0.5, 0.34]], edge);        // the vest's bound neck edge
    T.poly("front", [[0.7, 0], [0.66, 0], [0.5, 0.3], [0.5, 0.34]], edge);
    T.rect("front", 0.49, 0.34, 0.02, hem - 0.34, tone(o.vest, -0.32));          // zip
    T.rect("front", 0, hem - 0.018, 1, 0.018, edge); T.rect("back", 0, hem - 0.018, 1, 0.018, edge);
    T.rect("side", 0, hem - 0.018, 1, 0.018, edge);
    if (o.tape) {
      const t1 = 0.52, t2 = 0.66, th = 0.07;
      // braces first so the bands lie over their feet
      for (const x of [0.15, 0.74]) T.rect("front", x, 0, 0.11, t1, o.tape);
      if (o.backX) {
        T.poly("back", [[0.12, 0], [0.26, 0], [0.9, t1], [0.76, t1]], o.tape);
        T.poly("back", [[0.88, 0], [0.74, 0], [0.1, t1], [0.24, t1]], o.tape);
      } else for (const x of [0.15, 0.74]) T.rect("back", x, 0, 0.11, t1, o.tape);
      for (const col of ["front", "back"]) for (const x of [0.185, 0.775]) if (col === "front" || !o.backX) T.rect(col, x, 0, 0.035, t1, o.core);
      for (const y of [t1, t2]) {
        for (const col of ["front", "back"]) { T.rect(col, 0, y, 1, th, o.tape); T.rect(col, 0, y + th * 0.3, 1, th * 0.4, o.core); }
        T.rect("side", 0, y, 1, th, o.tape); T.rect("side", 0, y + th * 0.3, 1, th * 0.4, o.core);
      }
      T.rect("front", 0.49, 0.34, 0.02, hem - 0.34, tone(o.vest, -0.32));        // the zip runs through the tape
    }
    T.shade();
    if (o.under) o.under(A); else A.fill(sc);
    hemBand(A, tone(o.shirt, -0.16), 0.03, 0.012);
    limbHem(A, 0.92, o.shirt);
    A.shade();
    L.fill(hx(o.legs));
    L.rect("side", 0.46, 0, 0.08, 1, tone(o.legs, -0.2));                        // outseam
    if (o.knee) L.rect("front", 0.16, 0.44, 0.68, 0.13, tone(o.legs, -0.12));   // work-jean knee
    limbHem(L, 0.94, o.legs);
    L.shade();
    return { torso: 1, arms: 1, legs: 1, yoke: o.shirt };
  }
  const TAPE = "#c9ced0", TAPE_CORE = "#eef1ee";

  // Dock hi-vis: an amber vest over a drab long-sleeve work shirt and jeans.
  // (It used to paint its vest BLACK: buildSet read the vest colour out of a
  // "hivis|<torso>" key that keyOf never made, so the colour was always 0.)
  PAINT.hivis = function (P, c) {
    const vest = (c && c.torso != null) ? c.torso : 0xffb43a;
    const shirt = (c && c.arms != null && c.arms !== vest) ? c.arms : 0x5d6052;
    return workVest(P, { vest, shirt, legs: (c && c.legs != null) ? c.legs : 0x2f4f8a, tape: TAPE, core: TAPE_CORE });
  };

  // Construction: site orange over a navy work shirt, work denim, the tape
  // silver read off the record's collar.
  PAINT.construction = function (P, c) {
    const vest = (c && c.torso != null) ? c.torso : 0xff5f08;
    const shirt = (c && c.arms != null) ? c.arms : 0x1d3352;
    const silver = (c && c.collar != null) ? hx(c.collar) : TAPE;
    return workVest(P, { vest, shirt, legs: (c && c.legs != null) ? c.legs : 0x2e4a6b, tape: silver, core: TAPE_CORE, knee: true });
  };

  /* A BIB APRON is worn over the shirt AND the lap: neck strap, a bib on the
     chest, ties round the real waist knotted at the back, and the skirt with
     its pouch pocket over the front of the pelvis (THE SEAT) — not a pocket on
     the belly and a tie line across the ribs. */
  function bibApron(T, J, apron, top) {
    const apc = hx(apron), lo = tone(apron, -0.16);
    T.rect("front", 0.3, 0, 0.07, top, apc); T.rect("front", 0.63, 0, 0.07, top, apc);   // neck strap
    T.rect("front", 0.2, top, 0.6, 1 - top, apc);
    T.rect("front", 0.2, top, 0.6, 0.012, lo);
    hemBand(T, apc, TORSO_ROW.waist - 0.01, 0.022);                              // the ties round the waist
    T.rect("back", 0.42, TORSO_ROW.waist - 0.025, 0.16, 0.05, lo);                // knotted at the back
    J.rect("front", 0.16, 0, 0.68, 1, apc);                                        // the skirt over the lap
    J.rect("front", 0.28, 0.18, 0.44, 0.34, tone(apron, -0.08));                  // pouch pocket
    J.rect("front", 0.28, 0.18, 0.44, 0.03, lo);
    J.rect("front", 0.495, 0.18, 0.01, 0.34, lo);
  }
  PAINT.vendor = function (P, c) {
    const shirt = (c && c.torso != null) ? c.torso : 0xc8553a, apron = (c && c.collar != null) ? c.collar : 0xf0ead8;
    const legs = (c && c.legs != null) ? c.legs : 0x2e3138;
    const T = P.T, J = P.J, A = P.A;
    T.fill(hx(shirt));
    T.poly("front", [[0.38, 0], [0.62, 0], [0.5, 0.12]], tone(shirt, -0.2));      // open collar
    trouserSeat(J, legs);
    bibApron(T, J, apron, 0.18);
    T.shade(); J.shade();
    A.fill(hx(shirt));
    hemBand(A, tone(shirt, -0.16), 0.03, 0.012);
    limbHem(A, 0.92, shirt);
    A.shade();
    return { torso: 1, arms: 1, seat: 1 };
  };

  // ---- HOSPITAL: teal scrubs (nurse) — the simple V-neck top + drawstring -
  // a scrub top is SHORT-SLEEVED: the arms stay flat (`sleeves: "short"`,
  // applyClothes hangs the rig's own teal sleeve and the wearer's skin below)
  PAINT.scrubs = function (P, c) {
    const teal = (c && c.torso != null) ? c.torso : 0x3d8a86, tc = hx(teal), lo = tone(teal, -0.28);
    const T = P.T, L = P.L;
    T.fill(tc);
    T.poly("front", [[0.34, 0], [0.5, 0.24], [0.66, 0]], lo);                   // V-neck with its binding
    T.poly("front", [[0.38, 0], [0.5, 0.19], [0.62, 0]], tone(teal, -0.12));
    T.rect("front", 0.64, 0.26, 0.18, 0.12, tone(teal, -0.1));                  // left chest pocket
    T.rect("front", 0.64, 0.26, 0.18, 0.015, lo);
    T.rect("front", 0.7, 0.26, 0.012, 0.12, lo);                               //   pen slot
    T.rect("front", 0.12, 0.58, 0.22, 0.15, tone(teal, -0.1)); T.rect("front", 0.12, 0.58, 0.22, 0.015, lo);   // hip pockets
    T.rect("front", 0.66, 0.58, 0.22, 0.15, tone(teal, -0.1)); T.rect("front", 0.66, 0.58, 0.22, 0.015, lo);
    T.rect("side", 0.48, WORK_ROW.armpit, 0.04, 1 - WORK_ROW.armpit, tone(teal, -0.14));
    T.shade();
    L.fill(hx((c && c.legs != null) ? c.legs : teal));
    L.rect("side", 0.48, 0, 0.04, 1, tone(teal, -0.18));
    L.rect("side", 0.26, 0.22, 0.48, 0.16, tone(teal, -0.1));                  // cargo pocket
    limbHem(L, 0.94, (c && c.legs != null) ? c.legs : teal);
    L.shade();
    return { torso: 1, legs: 1, sleeves: "short" };
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
    T.poly("front", [[0.36, 0], [0.5, 0.2], [0.64, 0]], tone(scrub, -0.28));   // scrub V-neck
    T.shade();
    // the WHITE COAT shell — open front, lapels, breast pocket, two hip pockets
    J.fill(coat);
    J.clear("cap", 0, 0, 1, 1);
    J.clearPoly("front", [[0.5 - 0.05, 0], [0.5 + 0.05, 0], [0.5 + 0.18, 1], [0.5 - 0.18, 1]]); // open front
    J.poly("front", [[0.5 - 0.05 - 0.12, 0], [0.5 - 0.05, 0], [0.5 - 0.17, 0.4], [0.5 - 0.05 - 0.16, 0.34]], coatLow); // lapels
    J.poly("front", [[0.5 + 0.05, 0], [0.5 + 0.05 + 0.12, 0], [0.5 + 0.05 + 0.16, 0.34], [0.5 + 0.17, 0.4]], coatLow);
    J.rect("front", 0.14, 0.2, 0.16, 0.1, coatLow); J.rect("front", 0.14, 0.2, 0.16, 0.025, "#c4c8c9"); // breast pocket + lip
    J.rect("front", 0.1, 0.56, 0.22, 0.16, coatLow); J.rect("front", 0.68, 0.56, 0.22, 0.16, coatLow);  // hip pockets
    // THE STETHOSCOPE lies OVER the coat, round the collar and down both
    // lapels (it used to be painted on the scrub top, where the closed coat
    // front covered all but its two cut-off ends)
    J.poly("front", [[0.33, 0], [0.36, 0], [0.33, 0.36], [0.30, 0.36]], "#1c2024");
    J.poly("front", [[0.64, 0], [0.67, 0], [0.71, 0.30], [0.68, 0.30]], "#1c2024");
    J.dot("front", 0.695, 0.33, 0.035, "#9aa0a6");                               // chest piece
    J.rect("back", 0.2, 0, 0.6, 0.03, "#1c2024");                                // round the back of the collar
    J.shade();
    A.fill(coat); limbHem(A, 0.9, 0xeef0f0); A.shade();                          // coat cuff
    const slacks = (c && c.legs != null) ? c.legs : 0x39414f;
    L.fill(hx(slacks)); L.rect("front", 0.49, 0, 0.02, 0.9, tone(slacks, -0.14));  // pressed crease
    limbHem(L, 0.95, slacks);
    L.shade();
    return { torso: 1, arms: 1, legs: 1, jacket: 1 };
  };

  // ---- EMS: the navy paramedic duty jacket ----------------------------------
  // Two lime/silver/lime bands round the body (chest, under the pockets, and
  // at the hem), one round each upper arm and forearm, a band round each shin
  // on the cargo trousers; the Star of Life on the OUTSIDE of each sleeve at
  // the shoulder, where the patch really goes (it used to be a pentagon on
  // the chest). No invented name tape.
  PAINT.ems = function (P, c) {
    const navy = (c && c.torso != null) ? c.torso : 0x24304a, nc = hx(navy);
    const legs = (c && c.legs != null) ? c.legs : navy;
    const lime = "#d7e24a", silver = "#cfd5d9";
    const T = P.T, A = P.A, L = P.L;
    T.fill(nc);
    T.rect("front", 0.488, 0.07, 0.024, 0.93, tone(navy, -0.34));             // zip
    flapPocket(T, "front", 0.12, WORK_ROW.pocket, 0.24, 0.13, navy);
    flapPocket(T, "front", 0.64, WORK_ROW.pocket, 0.24, 0.13, navy);
    tape(T, 0.42, 0.065, lime, silver);
    tape(T, 0.68, 0.065, lime, silver);
    T.rect("side", 0.48, WORK_ROW.armpit, 0.04, 0.12, tone(navy, -0.16));
    T.shade();
    A.fill(nc);
    // the Star of Life: six blue arms on a white ground, outside of the sleeve
    const cx = 0.5, cy = 0.14, r = 0.3;
    A.dot("side", cx, cy, r * 1.15, "#e9eef2");
    for (let k = 0; k < 3; k++) {
      const a = k * Math.PI / 3, dx = Math.sin(a) * r, dy = Math.cos(a) * r * 0.42, wx = Math.cos(a) * 0.1, wy = -Math.sin(a) * 0.1 * 0.42;
      A.poly("side", [[cx - dx - wx, cy - dy - wy], [cx - dx + wx, cy - dy + wy], [cx + dx + wx, cy + dy + wy], [cx + dx - wx, cy + dy - wy]], "#2a62b0");
    }
    tape(A, 0.40, 0.06, lime, silver);
    tape(A, 0.80, 0.06, lime, silver);
    limbHem(A, 0.94, navy);
    A.shade();
    L.fill(hx(legs));
    L.rect("side", 0.48, 0, 0.04, 1, tone(legs, -0.2));
    flapPocket(L, "side", 0.18, 0.24, 0.64, 0.2, legs);                         // cargo pocket
    tape(L, 0.8, 0.05, lime, silver);
    limbHem(L, 0.94, legs);
    L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  };

  // ---- FIREFIGHTER: tan turnout, NFPA 1971 trim ------------------------------
  // Lime/silver/lime triple trim: one band round the coat at the chest (under
  // the arms), one round the hem, one round each sleeve between elbow and
  // wrist, one round each trouser leg between knee and ankle. Storm flap down
  // the front with its hook-and-dee closures, bellows pockets under the chest
  // band, black leather knee reinforcement, knit wristlets at the cuff. The
  // collar is the coat's own tan (the yoke atlas stands it round the neck).
  PAINT.firefighter = function (P, c) {
    const tan = (c && c.torso != null) ? c.torso : 0xb09a6e, tc = hx(tan);
    const legs = (c && c.legs != null) ? c.legs : tan;
    const lime = "#e5e54a", silver = "#cfd3cf";
    const T = P.T, A = P.A, L = P.L;
    T.fill(tc);
    T.rect("front", 0.44, 0.07, 0.12, 0.93, tone(tan, -0.14));                  // storm flap
    T.rect("front", 0.44, 0.07, 0.012, 0.93, tone(tan, -0.36));
    for (let y = 0.16; y < 0.8; y += 0.13) T.rect("front", 0.40, y, 0.05, 0.022, "#2b2620");   // hook-and-dee
    tape(T, 0.36, 0.075, lime, silver);                                         // chest band
    tape(T, 0.72, 0.075, lime, silver);                                         // hem band
    flapPocket(T, "front", 0.08, 0.47, 0.26, 0.2, tan);                          // bellows pockets
    flapPocket(T, "front", 0.66, 0.47, 0.26, 0.2, tan);
    T.shade();
    A.fill(tc);
    tape(A, 0.76, 0.08, lime, silver);                                          // sleeve band
    hemBand(A, "#2b2620", 0.95, 0.05);                                          // knit wristlet
    A.shade();
    L.fill(hx(legs));
    L.rect("front", 0.14, 0.42, 0.72, 0.17, "#2b2620");                         // leather knee
    L.rect("side", 0.48, 0, 0.04, 1, tone(legs, -0.2));
    flapPocket(L, "side", 0.14, 0.2, 0.72, 0.18, legs);                         // bellows thigh pocket
    tape(L, 0.78, 0.08, lime, silver);                                          // leg band
    limbHem(L, 0.94, legs);
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
    // the combat shirt: centre zip from the notch, two SLANTED chest pockets
    // on the upper chest (pocket-flap + edge in shade, not solid slabs, so the
    // camo still reads through), the sleeve pocket on the OUTSIDE of the upper
    // arm, elbow and knee patches where the joints bend, the cargo pocket on
    // the outside of the thigh, and the trousers bloused into the boots
    const T = P.T, A = P.A, L = P.L, sh = "rgba(0,0,0,0.22)", edge = "rgba(0,0,0,0.38)";
    camo(T, 22);
    T.rect("front", 0.49, 0.07, 0.02, 0.93, edge);
    for (const s of [-1, 1]) {
      const x0 = 0.5 + s * 0.08, x1 = 0.5 + s * 0.34;
      T.poly("front", [[x0, 0.25], [x1, 0.22], [x1, 0.36], [x0, 0.39]], sh);
      T.poly("front", [[x0, 0.25], [x1, 0.22], [x1, 0.24], [x0, 0.27]], edge);
    }
    camo(A, 8);
    A.rect("side", 0.14, 0.1, 0.72, 0.22, sh); A.rect("side", 0.14, 0.1, 0.72, 0.03, edge);   // sleeve pocket
    A.rect("back", 0.18, 0.56, 0.64, 0.16, sh);                                  // elbow patch
    hemBand(A, edge, 0.95, 0.05);
    camo(L, 12);
    L.rect("side", 0.16, 0.26, 0.68, 0.2, sh); L.rect("side", 0.16, 0.26, 0.68, 0.035, edge);  // cargo pocket
    L.rect("front", 0.18, 0.44, 0.64, 0.14, sh);                                 // knee patch
    hemBand(L, edge, 0.9, 0.012);                                                // bloused into the boot
    return { torso: 1, arms: 1, legs: 1 };
  };

  // ---- SECURITY: plain guard blacks, open collar, a silver-edged sleeve
  //      patch (entities/dutykit.js: silver shield, radio, torch, cuffs, no gun).
  //      The old gold chest bar stood in for a "SECURITY" wordmark nobody could
  //      read; the badge and the patch say guard without inventing text. ----
  PAINT.security = function (P, c) {
    const body = (c && c.torso != null) ? c.torso : 0x1c1f26;
    return dutyShirt(P, {
      shirt: body, legs: (c && c.legs != null) ? c.legs : 0x1c1f26, open: tone2(body, -0.35),
      patch: [tone(body, 0.1), "#9aa3ad", tone(body, 0.3)],
    });
  };

  // ---- OFFICE: a dress shirt + visible tie (no jacket — desk worker) -------
  PAINT.office = function (P, c) {
    const shirt = (c && c.torso != null) ? c.torso : 0x9ab4c8, tieHex = 0x223247;
    const T = P.T, A = P.A, sc = hx(shirt);
    // TAILORED (parts.fp): the collar and the knot's top on the collar band,
    // the rest of the knot and the tie on the shirt, in body units
    T.fill(sc);
    T.rect("front", fx(-0.012), 0.08, 0.024, TAILOR.tBelt - 0.08, tone(shirt, -0.12));   // button placket
    T.rect("front", fx(0.15), 0.27, 0.15, 0.13, tone(shirt, -0.05));           // the left chest pocket
    T.rect("front", fx(0.15), 0.27, 0.15, 0.012, tone(shirt, -0.2));
    paintTie(T, tieHex, TAILOR.tBelt - 0.025, 0);
    T.shade();
    A.fill(sc);
    for (const col of ["front", "side", "back"]) A.rect(col, 0, 0.93, 1, 0.07, tone(shirt, -0.1));   // the buttoned cuff at the wrist
    A.shade();
    return { torso: 1, arms: 1, fp: 1, neck: { tie: tieHex, fp: 1 } };
  };

  // ---- SHERIFF: county khaki shirt open over a white undershirt, brown
  //      trousers with the wide dark stripe, a gold nameplate (entities/
  //      dutykit.js: the gold six-point star, a brown basketweave belt) ----
  PAINT.sheriff = function (P, c) {
    const khaki = (c && c.torso != null) ? c.torso : 0xb8a070;
    const legs = (c && c.legs != null) ? c.legs : 0x5a4632;
    return dutyShirt(P, {
      shirt: khaki, legs: legs, open: 0xe8e6df, stripe: [0.2, tone(legs, -0.35)],
      patch: [hx(0x5a4632), "#cfae52", "#cdb784"], tape: "#cfae52",
    });
  };

  // ---- DETECTIVE: plain clothes, jacket off at the desk — a pale dress shirt
  //      and tie, pressed trousers. The gold shield clipped on the belt and the
  //      pancake holster on the hip are entities/dutykit.js geometry (a jacket
  //      shell would bury the holster, and the holster is the point). ----
  PAINT.detective = function (P, c) {
    const shirt = (c && c.torso != null) ? c.torso : 0xc9d6e6, sc = hx(shirt);
    const tie = (c && c.tie != null) ? c.tie : 0x6b1f2a;
    const legs = (c && c.legs != null) ? c.legs : 0x3b3935;
    const T = P.T, A = P.A, L = P.L, seam = tone(shirt, -0.16);
    T.fill(sc);
    T.rect("front", 0.47, 0, 0.06, 0.64, hx(tie));
    T.poly("front", [[0.47, 0.64], [0.53, 0.64], [0.5, 0.7]], hx(tie));
    T.rect("front", 0.488, 0.7, 0.024, 0.25, tone(shirt, -0.1));
    T.dot("front", 0.5, 0.8, 0.01, seam);
    T.rect("back", 0, 0.12, 1, 0.012, seam);
    T.rect("side", 0.49, 0.1, 0.02, 0.9, tone(shirt, -0.08));
    T.shade();
    A.fill(sc);
    for (const col of ["front", "back", "side"]) { A.rect(col, 0, 0, 1, 0.03, seam); A.rect(col, 0, 0.9, 1, 0.07, tone(shirt, -0.06)); A.rect(col, 0, 0.9, 1, 0.01, seam); }
    A.shade();
    L.fill(hx(legs));
    L.rect("front", 0.494, 0, 0.012, 0.93, tone(legs, 0.14));
    L.rect("side", 0.492, 0, 0.016, 0.95, tone(legs, -0.18));
    for (const col of ["front", "back", "side"]) L.rect(col, 0, 0.94, 1, 0.06, tone(legs, -0.2));
    L.shade();
    const parts = { torso: 1, arms: 1, legs: 1 };
    if (neckV2()) parts.neck = { tie: tie, w: 0.065 };
    return parts;
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
    T.rect("front", 0.4, 0.66, 0.2, 0.02, tone(under, -0.4));                 // a frayed tear line
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
    hemBand(A, tone(coat, -0.3), 0.84, 0.16);                                  // cuffs rolled back, frayed
    A.rect("front", 0.3, 0.45, 0.4, 0.1, grime);                               // (grime is where it wore:
    A.rect("back", 0.2, 0.6, 0.6, 0.12, grime);                                //  forearm and elbow)
    A.shade();
    const trou = (c && c.legs != null) ? c.legs : 0x3a3026;
    L.fill(hx(trou));
    L.rect("front", 0.2, 0.5, 0.3, 0.05, tone(trou, -0.4));                    // knee tear
    hemBand(L, grime, 0.86, 0.14);                                             // dirty, dragged hems
    L.shade();
    return { torso: 1, arms: 1, legs: 1, jacket: 1 };
  };

  // TRACK JACKET + TRACK PANTS. The stripe is ONE line: flank of the jacket,
  // the side of the sleeve (shoulder to cuff, both lofted segments read the
  // same column so it never breaks at the elbow) and the side of the leg.
  // The zip collar is the collar BAND itself (yokeCanvas samples the dark
  // collar at the throat); the zip pull hangs just below it where it is seen.
  PAINT.tracksuit = function (P, c) {
    const body = (c && c.torso != null) ? c.torso : 0x2bb673;
    const white = hx((c && c.stripe != null) ? c.stripe : 0xeef3f7);
    const T = P.T, A = P.A, L = P.L, bc = hx(body), rib = tone(body, -0.35);
    T.fill(bc);
    T.rect("front", 0.3, 0, 0.4, 0.06, tone(body, -0.3));           // zip collar (worn by the collar band)
    T.rect("front", 0.485, 0, 0.03, TORSO_ROW.hem, white);          // zipper line, collar to hem
    T.rect("front", 0.475, 0.12, 0.05, 0.05, "#aab4ba");            // zip pull, under the collar band
    T.rect("side", 0.38, 0, 0.24, 1, white);                        // side stripe down the flank
    hemBand(T, rib);                                                // elastic hem, above the tuck
    T.shade();
    A.fill(bc); A.rect("side", 0.38, 0, 0.24, 0.88, white);
    for (const col of ["front", "back", "side"]) A.rect(col, 0, 0.88, 1, 0.08, rib);   // elastic cuff, all round
    A.shade();
    L.fill(hx((c && c.legs != null) ? c.legs : 0x20242c));
    L.rect("side", 0.38, 0, 0.24, 1, white);
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
    // the crew rib is worn by the COLLAR BAND (yokeCanvas samples this tone at
    // the throat); no placket — a crew-neck shirt has none, and the old seam
    // down the sternum read as a zip on a tee.
    T.poly("front", [[0.36, 0], [0.64, 0], [0.5, 0.15]], tone(body, -0.22));
    hemBand(T, tone(body, -0.2));                                   // hem, above the tuck
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
    // ON THE SHAPED BODY. The old layout was a box's: a hood slab across the
    // whole top of the chest (under the collar band now, so all that showed
    // was a dark stripe), drawstring tips at the TOP of the strings, and a
    // pocket and ribbed hem at 0.6-1.0, half of which sat inside the trousers.
    const rib = tone(body, -0.3), seam = tone(body, -0.34);
    T.fill(bc);
    // the hood's two edges cross at the throat: a V of hood lining that the
    // collar band continues round the neck (it samples this tone at the top)
    T.poly("front", [[0.2, 0], [0.8, 0], [0.56, 0.22], [0.44, 0.22]], hoodLo);
    // the hood lying on the upper back, rounded, with its centre seam
    T.poly("back", [[0.14, 0], [0.86, 0], [0.82, 0.24], [0.64, 0.36], [0.36, 0.36], [0.18, 0.24]], hoodLo);
    T.rect("back", 0.49, 0, 0.02, 0.35, tone(body, -0.36));
    // drawstrings out of the hood eyelets, aglets at the ENDS
    T.rect("front", 0.43, 0.19, 0.018, 0.17, "#d9d3c4");
    T.rect("front", 0.552, 0.19, 0.018, 0.17, "#d9d3c4");
    T.rect("front", 0.426, 0.35, 0.026, 0.03, "#e9e4d8");
    T.rect("front", 0.548, 0.35, 0.026, 0.03, "#e9e4d8");
    // KANGAROO POCKET on the belly, just above the ribbed hem: one panel, a
    // top seam, and the two slanted hand openings that make it read
    const hem = (c && c.kid) ? TORSO_ROW.kidHem : TORSO_ROW.hem;     // a child's tucks in higher
    const pT = (c && c.kid) ? 0.46 : 0.52, pB = hem;
    T.poly("front", [[0.3, pT], [0.7, pT], [0.79, pB], [0.21, pB]], tone(body, -0.07));
    T.rect("front", 0.3, pT, 0.4, 0.02, seam);
    T.poly("front", [[0.3, pT], [0.33, pT], [0.24, pB], [0.21, pB]], seam);
    T.poly("front", [[0.7, pT], [0.67, pT], [0.76, pB], [0.79, pB]], seam);
    hemBand(T, rib, hem);                                          // ribbed hem, above the tuck
    T.shade();
    A.fill(bc); for (const col of ["front", "back", "side"]) A.rect(col, 0, 0.88, 1, 0.09, rib); A.shade(); // ribbed cuff, all round
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
    // A TANK IS STRAPS AND ARMHOLES. On the old box torso a skin top band was
    // a flat flesh shelf round the neck, so only a neckline was cut. The body
    // has a real trapezius and armpit now, so the tank is cut where a tank is:
    // a scoop at the front, a higher one behind, and deep ARMHOLES — the outer
    // top corners of front and back and the top of the flank — leaving two
    // straps over the shoulders. The collar band samples the scoop (skin) at
    // the throat, so its front reads as bare neck too.
    T.fill(wc);
    T.poly("front", [[0.34, 0], [0.66, 0], [0.5, 0.24]], sk);
    T.poly("back", [[0.38, 0], [0.62, 0], [0.5, 0.15]], sk);
    for (const col of ["front", "back"]) {
      T.poly(col, [[0, 0], [0.2, 0], [0.13, 0.18], [0, 0.3]], sk);
      T.poly(col, [[1, 0], [0.8, 0], [0.87, 0.18], [1, 0.3]], sk);
    }
    T.poly("side", [[0, 0], [1, 0], [1, 0.26], [0.5, 0.32], [0, 0.26]], sk);
    // ribbed texture: thin vertical lines through the fabric only
    for (const col of ["front", "back", "side"]) for (let x = 0.08; x < 1; x += 0.11) T.rect(col, x, 0.32, 0.014, TORSO_ROW.hem - 0.32, rib);
    T.rect("front", 0.2, 0.5, 0.16, 0.1, grime); T.rect("back", 0.5, 0.55, 0.2, 0.1, grime);   // a couple of grubby smudges
    hemBand(T, tone(white, -0.18));                                 // hem, above the tuck
    T.shade();
    // bare arms, full length: the wearer's OWN flat skin (sleeves "none"), so
    // his ink shows on them (entities/tattoo.js); legs keep the flat sweatpants
    return { torso: 1, sleeves: "none" };
  };

  // ---- STREET JACKETS, cut for the shaped body -----------------------------
  // All three are TAILORED (parts.fp: the front in body units, see TAILORING)
  // and hem where the body really stops showing: the torso tucks into the
  // pelvis from ~0.82, so the old hems at 0.9 were painted inside the
  // trousers. The hem sits on TORSO_ROW.hem; the collar is the COLLAR BAND's
  // (neck.band), which is the only place a collar can be seen now.
  // PUFFER — quilted channels that follow the body down to a ribbed hem, a zip.
  PAINT.puffer = function (P, c) {
    const body = (c && c.torso != null) ? c.torso : 0x223a55, bc = hx(body);
    const T = P.T, A = P.A, seam = tone(body, -0.3), hi = tone(body, 0.16);
    const hem = TORSO_ROW.hem;
    T.fill(bc);
    for (const col of ["front", "back", "side"])
      for (let y = 0.1; y < hem - 0.05; y += hem / 5) { T.rect(col, 0, y, 1, 0.018, seam); T.rect(col, 0, y + 0.03, 1, 0.045, hi); }  // channels + the puff between
    hemBand(T, tone(body, -0.16), hem, TORSO_ROW.hemH);            // the ribbed hem
    T.rect("front", fx(-0.012), 0, 0.024, hem + TORSO_ROW.hemH, seam);                // the zip
    T.shade();
    A.fill(bc);
    for (let y = 0.12; y < 0.9; y += 0.16) for (const col of ["front", "side", "back"]) A.rect(col, 0, y, 1, 0.018, seam);
    for (const col of ["front", "side", "back"]) A.rect(col, 0, 0.92, 1, 0.08, tone(body, -0.16));   // the cuff
    A.shade();
    return { torso: 1, arms: 1, fp: 1, neck: { fp: 1, band: tone2(body, -0.12) } };   // the stand collar
  };

  // DENIM JACKET — placket and shank buttons, the two chest flap pockets, the
  // pointed yoke seam, contrast stitching, a waistband hem.
  PAINT.denim_jacket = function (P, c) {
    const body = (c && c.torso != null) ? c.torso : 0x3c5a7a, bc = hx(body);
    const T = P.T, A = P.A, stitch = "#d8b87a", dk = tone(body, -0.22);
    const hem = TORSO_ROW.hem;
    T.fill(bc);
    T.poly("front", fpts([[-0.5, 0.2], [-0.05, 0.2], [0, 0.24], [0.05, 0.2], [0.5, 0.2], [0.5, 0.212], [0.05, 0.212], [0, 0.252], [-0.05, 0.212], [-0.5, 0.212]]), stitch);  // the yoke seam
    T.rect("front", fx(-0.018), 0.08, 0.036, hem - 0.08, dk);        // the placket
    for (let i = 0; i < 5; i++) T.dot("front", fx(0), 0.14 + i * (hem - 0.14) / 5, 0.012, "#c9cdd2");
    for (const s of [1, -1]) {                                       // chest pockets, flap + stitch
      const x0 = s > 0 ? 0.1 : -0.3;
      T.rect("front", fx(x0), 0.26, 0.2, 0.15, dk);
      T.poly("front", fpts([[x0, 0.26], [x0 + 0.2, 0.26], [x0 + 0.2, 0.3], [x0 + 0.1, 0.33], [x0, 0.3]]), tone(body, -0.1));
      T.rect("front", fx(x0), 0.26, 0.2, 0.01, stitch);
    }
    hemBand(T, dk, hem, TORSO_ROW.hemH);                             // the waistband
    hemBand(T, stitch, hem, 0.01);
    T.shade();
    A.fill(bc);
    for (const col of ["front", "side", "back"]) { A.rect(col, 0, 0.9, 1, 0.1, dk); A.rect(col, 0, 0.9, 1, 0.012, stitch); }   // the buttoned cuff
    A.shade();
    return { torso: 1, arms: 1, fp: 1, neck: { fp: 1, band: tone2(body, -0.18), open: 1 } };
  };

  // VARSITY — wool body, CONTRAST sleeves, snap placket, striped rib knit at
  // the collar, cuffs and hem. (No chest letter: that would be invented text.)
  PAINT.varsity = function (P, c) {
    const body = (c && c.torso != null) ? c.torso : 0x6e1f2b, sleeve = (c && c.collar != null) ? c.collar : 0xeae6dc;
    const T = P.T, A = P.A, bc = hx(body), sc = hx(sleeve), rib = tone(body, -0.2);
    const hem = TORSO_ROW.hem;
    T.fill(bc);
    T.rect("front", fx(-0.012), 0, 0.024, hem, "#d8c98a");         // the snap placket
    for (let i = 0; i < 5; i++) T.dot("front", fx(0), 0.12 + i * (hem - 0.12) / 5, 0.012, "#e6dcb0");
    hemBand(T, rib, hem, TORSO_ROW.hemH);                            // striped rib hem
    hemBand(T, sc, hem + 0.02, 0.012); hemBand(T, sc, hem + 0.042, 0.012);
    T.shade();
    A.fill(sc);
    for (const col of ["front", "side", "back"]) { A.rect(col, 0, 0.9, 1, 0.1, rib); A.rect(col, 0, 0.93, 1, 0.012, sc); }   // rib cuffs
    A.shade();
    return { torso: 1, arms: 1, fp: 1, neck: { fp: 1, band: tone2(body, -0.2) } };
  };

  // ============================================================
  //  MONEY FITS — the three boutique looks that had NO painter at all and so
  //  rendered as one flat tint per region: leather, designer, tactical. A $520
  //  jacket drawn as a solid brown box is the same failure as the collar slab —
  //  geometry with no garment on it. Every colour is read from the CAT record
  //  (city/outfits.js) so the record and the paint keep ONE source; nothing
  //  here invents a hex the wardrobe cannot see.
  // ============================================================

  // LEATHER — a waist-length moto jacket (its shell's swept front hem IS the
  // right length) hanging open over a tee. TAILORED (parts.fp): the shell's
  // front in body units — open at the neck so the tee's crew collar (the
  // collar band) shows, the asymmetric zip on the wearer's left, revers, slant
  // pockets, the waistband just above the hem. The pelvis wears the torso rows
  // below the trouser top (applyClothes), so the trousers are painted there.
  PAINT.leather = function (P, c) {
    const hide = (c && c.torso != null) ? c.torso : 0x241c18;
    const trim = (c && c.collar != null) ? c.collar : tone2(hide, -0.4);
    const legHex = (c && c.legs != null) ? c.legs : 0x23262e;
    const T = P.T, J = P.J, A = P.A, L = P.L;
    const hc = hx(hide), seam = tone(hide, -0.36), edge = tone(hide, 0.2), zip = "#b9bdc4";
    const tee = tone2(hide, 0.52);                                  // the tee under it, derived off the hide
    T.fill(hx(tee));
    T.shade();
    J.fill(hc);
    const gT = 0.11, gB = 0.07;                                      // the open front: at the neck, at the hem
    J.poly("front", fpts([[-0.26, 0], [0.26, 0], [0.24, 0.085], [-0.24, 0.085]]), hx(trim));   // the stand collar
    J.rect("back", 0, 0, 1, 0.09, hx(trim));
    fboth(J, [[gT - 0.01, 0.07], [0.3, 0.1], [0.27, 0.36], [gB + 0.04, 0.46], [gT - 0.01, 0.3]], edge);   // the revers
    J.rect("front", fx(0.1), 0.34, 0.06, 0.44, tone(hide, 0.12));   // storm flap, off centre
    J.rect("front", fx(0.118), 0.34, 0.022, 0.44, zip);
    J.dot("front", fx(0.13), 0.37, 0.022, "#e2e6ea");               // the pull
    J.poly("front", fpts([[-0.4, 0.56], [-0.2, 0.5], [-0.2, 0.52], [-0.4, 0.58]]), zip);   // slant zip pockets
    J.poly("front", fpts([[0.22, 0.5], [0.4, 0.56], [0.4, 0.58], [0.22, 0.52]]), zip);
    for (const col of ["front", "back", "side"]) J.rect(col, 0, 0.7, 1, 0.3, tone(hide, -0.2));   // the belted waistband
    J.rect("front", fx(-0.45), 0.72, 0.1, 0.05, zip);               // its buckle
    J.rect("back", 0.15, 0.28, 0.7, 0.03, seam);                    // back yoke seam
    J.clear("cap", 0, 0, 1, 1);
    J.clearPoly("front", fpts([[-gT, 0], [gT, 0], [gB, 1], [-gB, 1]]));   // it hangs open
    J.shade();
    A.fill(hc);
    for (const col of ["front", "side"]) { A.rect(col, 0, 0.4, 1, 0.025, seam); A.rect(col, 0, 0.56, 1, 0.025, seam); }   // elbow panel
    for (const col of ["front", "side", "back"]) A.rect(col, 0, 0.9, 1, 0.1, tone(hide, -0.22));   // the cuff
    A.rect("side", 0.6, 0.86, 0.1, 0.14, zip);                      // cuff zip
    A.shade();
    L.fill(hx(legHex));
    for (const col of ["front", "side", "back"]) L.rect(col, 0, 0.9, 1, 0.022, "rgba(0,0,0,0.22)");   // the break
    L.shade();
    return { torso: 1, arms: 1, legs: 1, jacket: 1, fp: 1, neck: { fp: 1, band: tone2(tee, -0.1) } };
  };

  // DESIGNER — the statement piece. A two-tone luxe jacket worn open: the
  // house colour on the body, a METAL trim on the lapels, the seam between the
  // tones and the pockets, cream trousers with the same braid down the
  // outseam. No logo anywhere. TAILORED (parts.fp) like the suits; its lower
  // tone continues on the body under the shell's swept hem (see THE SKIRT).
  PAINT.designer = function (P, c) {
    const body = (c && c.torso != null) ? c.torso : 0x7a3df0;
    const gold = (c && c.collar != null) ? c.collar : 0xffd451;
    const legHex = (c && c.legs != null) ? c.legs : 0xe9e4da;
    const T = P.T, J = P.J, A = P.A, L = P.L;
    const bc = hx(body), gc = hx(gold), lo = tone(body, -0.3), hi = tone(body, 0.22);
    const shirt = tone2(legHex, 0.1);                               // the shirt matches the trouser cream
    T.fill(hx(shirt));
    T.rect("front", fx(-0.008), 0.2, 0.016, 0.6, tone(shirt, -0.16));   // placket
    // the coat's lower tone under the swept hem, open over the shirt
    const h0 = TAILOR.tHem;
    for (const col of ["side", "back"]) T.rect(col, 0, 0.62, 1, 0.38, lo);
    for (const s of [1, -1]) T.poly("front", fpts([[s * 0.13, h0], [s * 0.5, h0], [s * 0.5, 1], [s * 0.17, 1]]), lo);
    T.shade();
    J.fill(bc);
    const gT = TAILOR.neck, gB = 0.13;                               // worn open: the neck, the hem
    for (const col of ["front", "back", "side"]) {
      J.rect(col, 0, 0.55, 1, 0.45, lo);
      J.rect(col, 0, 0.535, 1, 0.03, gc);
      J.rect(col, 0, 0, 1, 0.06, hi);                               // shoulder highlight
    }
    fboth(J, [[gT - 0.02, 0.05], [0.33, 0.12], [0.37, 0.2], [0.29, 0.34], [gB + 0.03, 0.5], [gB, 0.5]], gc);   // the metal-trim lapels
    for (const s of [1, -1]) J.rect("front", fx(s > 0 ? 0.2 : -0.38), 0.66, 0.18, 0.035, gc);                  // trimmed pocket welts
    J.rect("back", 0, 0, 1, 0.08, gc);                              // trimmed back collar
    J.clear("cap", 0, 0, 1, 1);
    J.clearPoly("front", fpts([[-gT, 0], [gT, 0], [gT, 0.1], [gB, 1], [-gB, 1], [-gT, 0.1]]));
    J.shade();
    A.fill(bc);
    A.rect("front", 0, 0, 1, 0.08, hi); A.rect("side", 0, 0, 1, 0.08, hi);
    for (const col of ["front", "side", "back"]) { A.rect(col, 0, 0.6, 1, 0.4, lo); A.rect(col, 0, 0.585, 1, 0.03, gc); A.rect(col, 0, 0.93, 1, 0.07, gc); }   // two-tone sleeve, gold cuff
    A.shade();
    L.fill(hx(legHex));
    L.rect("side", 0.44, 0, 0.12, 1, gc);                           // the braid down the outseam
    L.rect("front", 0.49, 0.02, 0.02, 0.88, tone(legHex, -0.1));    // crease
    for (const col of ["front", "side", "back"]) L.rect(col, 0, 0.9, 1, 0.022, "rgba(0,0,0,0.18)");   // the break
    L.shade();
    return { torso: 1, arms: 1, legs: 1, jacket: 1, fp: 1, neck: { fp: 1, open: 1, band: tone2(shirt, -0.06) } };
  };


  // TACTICAL — all-black professional kit. Deliberately NOT swat: no plate
  // carrier, no placards, no bulk shell. A slim softshell with a stand collar,
  // a chest harness of narrow webbing and gunmetal hardware, so the two read as
  // different jobs at a glance instead of two shades of the same dark smudge.
  PAINT.tactical = function (P, c) {
    const body = (c && c.torso != null) ? c.torso : 0x121418;
    const acc = (c && c.collar != null) ? c.collar : tone2(body, -0.35);
    const T = P.T, A = P.A, L = P.L;
    const bc = hx(body), web = tone(body, 0.22), lo = hx(acc), metal = "#7d858f";
    T.fill(bc);
    // (the stand collar is the yoke atlas round the neck; the painted collar
    //  band that sat here was under it)
    T.rect("front", 0.485, 0.07, 0.03, 0.93, tone(body, 0.3));      // centre zip
    T.dot("front", 0.5, 0.12, 0.022, metal);                        // zip pull
    // the harness: two narrow shoulder runs meeting a chest strap, plus one
    // waist run — webbing reads as a HARNESS only if the lines actually meet.
    T.poly("front", [[0.2, 0.02], [0.3, 0.02], [0.46, 0.5], [0.38, 0.52]], web);
    T.poly("front", [[0.8, 0.02], [0.7, 0.02], [0.54, 0.5], [0.62, 0.52]], web);
    T.rect("front", 0.36, 0.48, 0.28, 0.06, web);
    T.dot("front", 0.5, 0.51, 0.03, metal);                         // the buckle
    hemBand(T, web, TORSO_ROW.waist - 0.02, 0.05);                  // waist run, at the waist
    // the shoulder runs go over the top and down the back to the waist run
    T.poly("back", [[0.2, 0], [0.3, 0], [0.4, TORSO_ROW.waist], [0.32, TORSO_ROW.waist]], web);
    T.poly("back", [[0.8, 0], [0.7, 0], [0.6, TORSO_ROW.waist], [0.68, TORSO_ROW.waist]], web);
    T.rect("front", 0.1, 0.58, 0.18, 0.12, lo);                     // low utility pockets
    T.rect("front", 0.72, 0.58, 0.18, 0.12, lo);
    T.shade();
    A.fill(bc);
    A.rect("side", 0.16, 0.08, 0.68, 0.18, lo);                     // sleeve pocket, outside of the arm
    A.rect("side", 0.16, 0.08, 0.68, 0.03, web);
    A.rect("back", 0.16, 0.56, 0.68, 0.14, lo);                     // elbow panel, where it bends
    hemBand(A, web, 0.93, 0.05);                                    // cuff tab
    A.shade();
    const trou = (c && c.legs != null) ? c.legs : body;
    L.fill(hx(trou));
    L.rect("side", 0.24, 0.3, 0.52, 0.2, lo);                       // thigh pocket
    L.rect("side", 0.24, 0.3, 0.52, 0.04, web);
    L.rect("front", 0.16, 0.44, 0.68, 0.15, lo);                    // knee panel
    hemBand(L, tone(trou, -0.3), 0.92, 0.08);                       // into the boot
    L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  };

  // GRAPHIC TEE — solid tee + a bold centered graphic block (color via collar).
  PAINT.graphic_tee = function (P, c) {
    const body = (c && c.torso != null) ? c.torso : 0x1c1d22, gfx = (c && c.collar != null) ? c.collar : 0xd84a3a;
    // A TEE HAS SHORT SLEEVES. This one used to paint the whole arm row the
    // shirt colour with a cuff at the wrist, i.e. a long-sleeved "tee". The
    // skin below a sleeve is the WEARER's, which a shared atlas cannot know,
    // so the arms stay flat: `sleeves: "short"` has applyClothes hang the
    // rig's own flat short sleeve (garment colour to mid-bicep, own skin
    // below). The print sits on the CHEST (pecs ~0.45), not the belly, and
    // the hem above the tuck; the crew rib is worn by the collar band.
    const T = P.T, bc = hx(body), gc = hx(gfx);
    T.fill(bc);
    T.poly("front", [[0.37, 0], [0.63, 0], [0.5, 0.15]], tone(body, -0.25)); // crew neck
    T.rect("front", 0.3, 0.22, 0.4, 0.32, gc);                    // graphic field
    T.poly("front", [[0.5, 0.24], [0.66, 0.38], [0.5, 0.52], [0.34, 0.38]], tone(gfx, 0.3)); // a diamond motif
    T.dot("front", 0.5, 0.38, 0.05, bc);                          // negative-space center
    hemBand(T, tone(body, -0.2), TORSO_ROW.hem, 0.04);            // hem, above the tuck
    T.shade();
    return { torso: 1, sleeves: "short" };
  };

  // COVERALLS — the mechanic's one-piece (jumpsuit): the same garment grammar
  // as the prison issue, in shop blue-grey. (Its blank white "name patch" and
  // the waist seam painted across the middle of the ribs are gone.)
  PAINT.coveralls = function (P, c) {
    return jumpsuit(P, (c && c.torso != null) ? c.torso : 0x394a5a, {});
  };

  // CHEF — white double-breasted jacket + a colored neckerchief.
  PAINT.chef = function (P, c) {
    const white = "#f0efe9", lo = "#dcdbd2";
    const T = P.T, A = P.A, kerch = (c && c.collar != null) ? c.collar : 0x9a2a2a;
    T.fill(white);
    // the double-breasted front: the wrap panel crosses to the wearer's side,
    // two columns of cloth knot buttons down to the waist
    T.poly("front", [[0.36, 0.1], [0.62, 0.1], [0.62, 1], [0.36, 1]], lo);
    T.poly("front", [[0.37, 0.1], [0.62, 0.1], [0.62, 1], [0.38, 1]], white);
    T.rect("front", 0.36, 0.1, 0.012, 0.9, tone(0xf0efe9, -0.2));                 // the wrap edge
    for (let i = 0; i < 4; i++) { T.dot("front", 0.43, 0.2 + i * 0.16, 0.02, lo); T.dot("front", 0.57, 0.2 + i * 0.16, 0.02, lo); }
    T.poly("front", [[0.34, 0], [0.5, 0.12], [0.66, 0]], hx(kerch)); // neckerchief at the throat
    T.rect("front", 0.66, 0.26, 0.16, 0.015, lo);                    // thermometer / pen pocket slit
    T.shade();
    A.fill(white);
    hemBand(A, lo, 0.84, 0.03); hemBand(A, lo, 0.97, 0.03);          // turned-back cuffs
    A.shade();
    return { torso: 1, arms: 1 };
  };

  // WAITER — black jacket over a black waistcoat, white shirt, black bow tie:
  // the suit cut (formalTorso), buttoned higher at the neck (close).
  PAINT.waiter = function (P, c) {
    const legs = 0x141519;
    const neck = formalTorso(P.T, P.J, 0x16171c, "rgb(30,31,37)", { bow: true, close: true, lapelType: "notch", vest: 0x141519, ctx: P.ctx });
    formalLimbs(P.A, P.L, 0x16171c, legs, false, { ctx: P.ctx });
    return { torso: 1, arms: 1, legs: 1, jacket: 1, fp: 1, neck: neck, skirt: { hex: 0x16171c } };
  };

  // PILOT — crisp white shirt, black tie, gold-barred EPAULETTES on the
  // shoulder straps (the shoulder tops: the front column's top rows out past
  // the collar, and the side column's), the wings over the left pocket.
  PAINT.pilot = function (P, c) {
    const white = "#eef0f2", lo = "#d6d9dd", gold = "#e8c454", strap = "#1a1c24";
    const T = P.T, A = P.A, L = P.L;
    T.fill(white);
    T.rect("front", fx(-0.012), 0.08, 0.024, TAILOR.tBelt - 0.08, lo);      // placket
    for (const s of [1, -1]) {
      const x0 = s > 0 ? 0.25 : -0.45;
      T.rect("front", fx(x0), 0.02, 0.2, 0.085, strap);                       // the strap, seen from the front
      for (let i = 0; i < 4; i++) T.rect("front", fx(x0 + 0.03 + i * 0.04), 0.03, 0.018, 0.065, gold);   // four bars: captain
    }
    T.rect("side", 0.3, 0, 0.4, 0.1, strap);
    for (let i = 0; i < 4; i++) T.rect("side", 0.33, 0.012 + i * 0.022, 0.34, 0.01, gold);
    T.rect("front", fx(0.13), 0.33, 0.17, 0.12, lo);                        // the left pocket…
    T.poly("front", fpts([[0.12, 0.29], [0.215, 0.275], [0.31, 0.29], [0.215, 0.305]]), gold);   // …and the wings over it
    paintTie(T, 0x15161c, TAILOR.tBelt - 0.025, 0);
    T.shade();
    A.fill(white);
    for (const col of ["front", "side", "back"]) A.rect(col, 0, 0.93, 1, 0.07, lo);   // the cuff
    A.shade();
    const legHex = (c && c.legs != null) ? c.legs : 0x1a1c24;
    L.fill(hx(legHex)); L.rect("side", 0.46, 0, 0.08, 1, "#0d0e12");          // slacks with a braid
    L.rect("front", 0.49, 0.02, 0.02, 0.88, tone(legHex, 0.12));
    L.shade();
    return { torso: 1, arms: 1, legs: 1, fp: 1, neck: { tie: 0x15161c, fp: 1 } };
  };

  // ============================================================
  //  ROLE READS — compact uniforms for jobs that already exist in the world.
  //  They deliberately reuse the same four atlas rows and existing cap slot;
  //  no special rig, prop tree, or per-biome dresser is introduced here.
  // ============================================================
  PAINT.mailman = function (P, c) {
    const blue = (c && c.torso != null) ? c.torso : 0x3a6a96, dark = tone(blue, -0.3);
    const T = P.T, A = P.A, L = P.L;
    T.fill(hx(blue));
    T.rect("front", 0.49, 0.07, 0.02, 0.93, dark);                             // button placket
    flapPocket(T, "front", 0.12, WORK_ROW.pocket, 0.22, 0.14, blue);
    flapPocket(T, "front", 0.66, WORK_ROW.pocket, 0.22, 0.14, blue);
    // the satchel strap: over the left shoulder, across the chest to the right
    // hip, and down the back the same way (one strap, not a front sticker)
    T.poly("front", [[0.1, 0], [0.2, 0], [0.84, TORSO_ROW.waist + 0.04], [0.72, TORSO_ROW.waist + 0.04]], "#6b4c2d");
    T.poly("back", [[0.9, 0], [0.8, 0], [0.16, TORSO_ROW.waist + 0.04], [0.28, TORSO_ROW.waist + 0.04]], "#5e4328");
    T.shade();
    A.fill(hx(blue));
    A.rect("side", 0.2, 0.08, 0.6, 0.16, dark);                                // shoulder patch, outside of the sleeve
    limbHem(A, 0.92, blue);
    A.shade();
    const trou = (c && c.legs != null) ? c.legs : 0x2f4a6b;
    L.fill(hx(trou)); L.rect("side", 0.4, 0, 0.2, 0.94, dark); limbHem(L, 0.94, trou); L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  };

  PAINT.janitor = function (P, c) {
    const grey = (c && c.torso != null) ? c.torso : 0x4a5560, lo = tone(grey, -0.25);
    const T = P.T, A = P.A, L = P.L;
    T.fill(hx(grey)); T.rect("front", 0.485, 0.07, 0.03, 0.93, lo);
    flapPocket(T, "front", 0.12, WORK_ROW.pocket, 0.23, 0.15, grey);
    flapPocket(T, "front", 0.65, WORK_ROW.pocket, 0.23, 0.15, grey);
    T.shade();
    A.fill(hx(grey)); limbHem(A, 0.92, grey); A.shade();
    const trou = (c && c.legs != null) ? c.legs : 0x3a3f46;
    L.fill(hx(trou)); L.rect("front", 0.18, 0.44, 0.64, 0.14, tone(trou, -0.18)); limbHem(L, 0.94, trou); L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  };

  PAINT.valet = function (P, c) {
    const red = (c && c.torso != null) ? c.torso : 0x8a1f24;
    // TAILORED: a red waistcoat (V to mid-chest, brass buttons, points at the
    // hem) over a white shirt and black tie; shirt sleeves with a cuff
    const T = P.T, A = P.A, L = P.L, rc = hx(red), hem = TORSO_ROW.hem + 0.06;
    T.fill("#eceae4");
    paintTie(T, 0x17191f, 0.36, 0.17);
    for (const col of ["side", "back"]) T.rect(col, 0, 0.12, 1, hem - 0.12, col === "back" ? tone(red, -0.25) : rc);
    for (const s of [1, -1]) T.poly("front", fpts([[s * 0.17, 0], [s * 0.5, 0], [s * 0.5, hem], [s * 0.1, hem], [s * 0.05, hem + 0.05], [0, hem], [0, 0.36]]), rc);
    T.rect("front", fx(-0.004), 0.36, 0.008, hem - 0.36, tone(red, -0.35));
    for (let i = 0; i < 4; i++) T.dot("front", fx(0), 0.42 + i * (hem - 0.46) / 3, 0.013, "#e8c454");
    T.shade();
    A.fill("#eceae4");
    for (const col of ["front", "side", "back"]) A.rect(col, 0, 0.93, 1, 0.07, "#d6d4cc");
    A.shade();
    L.fill(hx((c && c.legs != null) ? c.legs : 0x16171c)); L.shade();
    return { torso: 1, arms: 1, legs: 1, fp: 1, neck: { tie: 0x17191f, fp: 1, band: 0xeceae4 } };
  };

  PAINT.busdriver = function (P, c) {
    const teal = (c && c.torso != null) ? c.torso : 0x2f5a6b, lo = tone(teal, -0.3);
    const T = P.T, A = P.A, L = P.L;
    T.fill(hx(teal)); T.rect("front", 0.49, 0.07, 0.02, 0.93, lo);             // button placket
    T.rect("front", 0.1, 0, 0.16, 0.1, tone(teal, 0.14)); T.rect("front", 0.74, 0, 0.16, 0.1, tone(teal, 0.14));   // epaulettes
    flapPocket(T, "front", 0.14, WORK_ROW.pocket, 0.2, 0.13, teal);
    flapPocket(T, "front", 0.66, WORK_ROW.pocket, 0.2, 0.13, teal);
    T.shade();
    A.fill(hx(teal)); A.rect("side", 0.16, 0.08, 0.68, 0.16, lo); limbHem(A, 0.92, teal); A.shade();   // transit patch, outside
    const trou = (c && c.legs != null) ? c.legs : 0x24304a;
    L.fill(hx(trou)); L.rect("front", 0.49, 0, 0.02, 0.92, tone(trou, -0.14)); limbHem(L, 0.95, trou); L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  };

  // blaze orange (no tape: a hunting vest) over a woodland camo shirt
  PAINT.hunter = function (P, c) {
    const field = (c && c.torso != null) ? c.torso : 0x465038, orange = (c && c.collar != null) ? c.collar : 0xe86d16;
    const chips = [0x303a28, 0x5c6344, 0x756447, 0x3b432e];
    function camo(R, n, base) {
      R.fill(hx(base)); let s = 0x51f15e ^ base;
      const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296; };
      for (const col of ["front", "back", "side", "cap"]) for (let i = 0; i < n; i++) R.rect(col, rnd(), rnd(), 0.1 + rnd() * 0.16, 0.05 + rnd() * 0.1, hx(chips[(rnd() * chips.length) | 0]));
    }
    const legs = (c && c.legs != null) ? c.legs : 0x4a4d32;
    const parts = workVest(P, { vest: orange, shirt: field, legs, under: function (R) { camo(R, R === P.T ? 15 : 8, field); } });
    const T = P.T, L = P.L;
    flapPocket(T, "front", 0.1, 0.5, 0.3, 0.2, orange); flapPocket(T, "front", 0.6, 0.5, 0.3, 0.2, orange);   // vest pockets
    camo(L, 10, legs);
    L.rect("side", 0.16, 0.26, 0.68, 0.2, "rgba(0,0,0,0.22)"); L.rect("side", 0.16, 0.26, 0.68, 0.035, "rgba(0,0,0,0.38)");   // cargo pocket
    hemBand(L, "rgba(0,0,0,0.3)", 0.92, 0.08);
    L.shade();
    return parts;
  };

  PAINT.ranger = function (P, c) {
    const khaki = (c && c.torso != null) ? c.torso : 0xb19a6a, green = (c && c.collar != null) ? c.collar : 0x4a5835;
    const T = P.T, A = P.A, L = P.L;
    T.fill(hx(khaki)); T.rect("front", 0.49, 0.07, 0.02, 0.93, tone(khaki, -0.25));
    T.rect("front", 0.1, 0, 0.16, 0.1, hx(green)); T.rect("front", 0.74, 0, 0.16, 0.1, hx(green));   // epaulettes
    flapPocket(T, "front", 0.13, WORK_ROW.pocket + 0.02, 0.23, 0.14, khaki);
    flapPocket(T, "front", 0.64, WORK_ROW.pocket + 0.02, 0.23, 0.14, khaki);
    T.poly("front", [[0.22, 0.13], [0.30, 0.13], [0.30, 0.19], [0.26, 0.225], [0.22, 0.19]], "#d9b94f");   // the badge over the pocket
    T.shade();
    A.fill(hx(khaki)); A.rect("side", 0.2, 0.07, 0.6, 0.18, hx(green)); limbHem(A, 0.92, khaki); A.shade();   // arm patch, outside
    const trou = (c && c.legs != null) ? c.legs : 0x3f4b2e;
    L.fill(hx(trou)); L.rect("side", 0.47, 0, 0.06, 1, tone(trou, -0.2)); limbHem(L, 0.95, trou); L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  };

  PAINT.hiker = function (P, c) {
    const shell = (c && c.torso != null) ? c.torso : 0xb94f2f, dark = (c && c.collar != null) ? c.collar : 0x27313a;
    const T = P.T, A = P.A, L = P.L;
    T.fill(hx(shell));
    hemBand(T, hx(dark), 0, 0.22);                                              // two-tone shoulders
    T.rect("front", 0.48, 0.07, 0.04, 0.93, tone(shell, -0.38));                // zip
    T.rect("front", 0.1, 0.5, 0.28, 0.18, tone(shell, -0.2)); T.rect("front", 0.62, 0.5, 0.28, 0.18, tone(shell, -0.2));   // hand pockets
    hemBand(T, tone(shell, -0.3), TORSO_ROW.waist - 0.01, 0.03);               // drawcord hem
    T.shade();
    A.fill(hx(shell)); hemBand(A, hx(dark), 0, 0.28); hemBand(A, hx(dark), 0.9, 0.1); A.shade();
    const trou = (c && c.legs != null) ? c.legs : 0x3d4650;
    L.fill(hx(trou)); L.rect("side", 0.18, 0.3, 0.64, 0.2, hx(dark)); L.rect("front", 0.14, 0.44, 0.72, 0.14, tone(dark, 0.12));
    limbHem(L, 0.94, trou); L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  };

  // plaid work shirt under denim bib overalls (straps crossed on the back)
  PAINT.farmer = function (P, c) {
    const shirt = (c && c.torso != null) ? c.torso : 0x76543a, denim = (c && c.legs != null) ? c.legs : 0x3d5872;
    const T = P.T, A = P.A, L = P.L, dc = hx(denim);
    T.fill(hx(shirt));
    for (const x of [0.2, 0.5, 0.8]) for (const col of ["front", "back", "side"]) T.rect(col, x, 0, 0.035, 1, tone(shirt, -0.22));
    for (const y of [0.22, 0.5, 0.78]) hemBand(T, tone(shirt, 0.18), y, 0.03);
    T.rect("front", 0.2, 0.34, 0.6, 0.66, dc);                                  // the bib
    T.rect("front", 0.19, 0, 0.1, 0.36, dc); T.rect("front", 0.71, 0, 0.1, 0.36, dc);   // straps
    T.rect("front", 0.2, 0.33, 0.07, 0.04, "#b9a26a"); T.rect("front", 0.73, 0.33, 0.07, 0.04, "#b9a26a");   // buckles
    T.rect("front", 0.36, 0.42, 0.28, 0.18, tone(denim, -0.16));               // bib pocket
    T.poly("back", [[0.2, 0], [0.32, 0], [0.62, 0.5], [0.5, 0.5]], dc);        // straps crossed behind
    T.poly("back", [[0.8, 0], [0.68, 0], [0.38, 0.5], [0.5, 0.5]], dc);
    T.rect("back", 0.28, 0.5, 0.44, 0.5, dc);
    T.rect("side", 0, 0.62, 1, 0.38, dc);                                       // the overall's sides under the arm
    T.shade();
    A.fill(hx(shirt)); hemBand(A, tone(shirt, -0.2), 0.72, 0.06); A.shade();    // sleeves rolled
    L.fill(dc); L.rect("front", 0.16, 0.44, 0.68, 0.15, tone(denim, -0.2)); limbHem(L, 0.94, denim); L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  };

  // oilskin bib trousers over a navy knit, straps crossed behind, sea boots
  PAINT.fisherman = function (P, c) {
    const knit = (c && c.torso != null) ? c.torso : 0x283d50, oil = (c && c.collar != null) ? c.collar : 0xe1bd45;
    const T = P.T, A = P.A, L = P.L, oc = hx(oil);
    T.fill(hx(knit));
    for (const col of ["front", "back", "side"]) for (let x = 0.1; x < 1; x += 0.2) T.rect(col, x, 0, 0.03, 1, tone(knit, -0.12));   // knit ribs
    T.rect("front", 0.2, 0.36, 0.6, 0.64, oc); T.rect("front", 0.19, 0, 0.1, 0.38, oc); T.rect("front", 0.71, 0, 0.1, 0.38, oc);
    T.rect("front", 0.32, 0.48, 0.36, 0.2, tone(oil, -0.15));
    T.poly("back", [[0.2, 0], [0.32, 0], [0.62, 0.5], [0.5, 0.5]], oc);
    T.poly("back", [[0.8, 0], [0.68, 0], [0.38, 0.5], [0.5, 0.5]], oc);
    T.rect("back", 0.24, 0.5, 0.52, 0.5, oc);
    T.rect("side", 0, 0.6, 1, 0.4, oc);
    T.shade();
    A.fill(hx(knit)); limbHem(A, 0.88, knit); A.shade();                        // rib-knit cuffs
    L.fill(hx((c && c.legs != null) ? c.legs : 0xc99928));
    hemBand(L, "#1d2924", 0.72, 0.28); hemBand(L, "#2d3a34", 0.72, 0.03);       // sea boots to the calf
    L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  };

  PAINT.mariner = function (P, c) {
    const white = (c && c.torso != null) ? c.torso : 0xf0f1ed, navy = (c && c.collar != null) ? c.collar : 0x213a5a;
    const T = P.T, A = P.A, L = P.L;
    T.fill(hx(white)); T.rect("front", 0.49, 0.07, 0.02, 0.93, tone(white, -0.18));
    T.rect("front", 0.08, 0, 0.18, 0.1, hx(navy)); T.rect("front", 0.74, 0, 0.18, 0.1, hx(navy));   // shoulder boards
    for (const x of [0.11, 0.17]) { T.rect("front", x, 0.03, 0.03, 0.05, "#d5b24a"); T.rect("front", 0.66 + x, 0.03, 0.03, 0.05, "#d5b24a"); }
    flapPocket(T, "front", 0.14, WORK_ROW.pocket, 0.2, 0.13, white);
    flapPocket(T, "front", 0.66, WORK_ROW.pocket, 0.2, 0.13, white);
    T.shade();
    A.fill(hx(white)); limbHem(A, 0.92, white); A.shade();
    const trou = (c && c.legs != null) ? c.legs : 0x19283d;
    L.fill(hx(trou)); L.rect("front", 0.49, 0, 0.02, 0.92, tone(trou, -0.16)); limbHem(L, 0.95, trou); L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  };

  // the lifeguard: a red top, the real "GUARD" across the chest, the white
  // cross on the back (the one wordmark this job actually wears)
  PAINT.lifeguard = function (P, c) {
    const red = (c && c.torso != null) ? c.torso : 0xc8342f, white = (c && c.collar != null) ? c.collar : 0xf1eee7;
    const T = P.T, L = P.L, ctx = P.ctx;
    T.fill(hx(red));
    T.poly("front", [[0.38, 0], [0.62, 0], [0.5, 0.1]], tone(red, -0.24));      // crew neck
    T.rect("back", 0.44, 0.26, 0.12, 0.32, hx(white)); T.rect("back", 0.3, 0.36, 0.4, 0.1, hx(white));
    T.shade();
    if (ctx && ctx.fillText) {
      ctx.save(); ctx.fillStyle = hx(white); ctx.font = "bold 9px Arial"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("GUARD", (COLS.front[0] + COLS.front[1]) / 2, ROWS.torso[0] + 0.32 * (ROWS.torso[1] - ROWS.torso[0]));
      ctx.restore();
    }
    const trunks = (c && c.legs != null) ? c.legs : red;
    L.fill(hx(trunks)); L.rect("side", 0.38, 0, 0.24, 0.95, hx(white)); limbHem(L, 0.95, trunks); L.shade();
    return { torso: 1, legs: 1, sleeves: "short" };                            // a tee: the wearer's own arms
  };

  function skiShell(P, c, patrol) {
    const body = (c && c.torso != null) ? c.torso : (patrol ? 0xc83232 : 0x286ba6), accent = (c && c.collar != null) ? c.collar : (patrol ? 0xf2f0e8 : 0xe67925);
    const T = P.T, A = P.A, L = P.L;
    T.fill(hx(body)); T.rect("front", 0.48, 0.07, 0.04, 0.93, tone(body, -0.35));
    hemBand(T, hx(accent), 0, 0.22);                                             // contrast shoulders
    hemBand(T, tone(body, -0.28), TORSO_ROW.waist - 0.03, 0.06);                 // the powder skirt at the hem
    T.rect("front", 0.1, 0.5, 0.27, 0.16, tone(body, -0.18)); T.rect("front", 0.63, 0.5, 0.27, 0.16, tone(body, -0.18));
    if (patrol) for (const col of ["front", "back"]) {                           // the patrol cross, front and back
      T.rect(col, 0.46, 0.28, 0.08, 0.2, "#f2f0e8"); T.rect(col, 0.38, 0.345, 0.24, 0.07, "#f2f0e8");
    }
    T.shade();
    A.fill(hx(body)); hemBand(A, hx(accent), 0, 0.25); limbHem(A, 0.88, body); A.shade();
    const pant = (c && c.legs != null) ? c.legs : 0x202936;
    L.fill(hx(pant)); L.rect("front", 0.12, 0.42, 0.76, 0.16, tone(pant, 0.12)); hemBand(L, "#171b22", 0.86, 0.14); L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  }
  PAINT.ski = function (P, c) { return skiShell(P, c, false); };
  PAINT.ski_patrol = function (P, c) { return skiShell(P, c, true); };

  // airside: a yellow vest with the tape crossed on the back, over navy
  PAINT.groundcrew = function (P, c) {
    const hi = (c && c.torso != null) ? c.torso : 0xd8ca2f, navy = (c && c.arms != null) ? c.arms : 0x24344d;
    const parts = workVest(P, { vest: hi, shirt: navy, legs: (c && c.legs != null) ? c.legs : 0x24344d, tape: TAPE, core: TAPE_CORE, backX: true });
    P.L.rect("side", 0.2, 0.3, 0.6, 0.2, tone(navy, -0.22));                    // cargo pocket
    return parts;
  };

  // CABIN CREW — a fitted navy jacket closed to the waist over a white blouse
  // V, the knotted scarf (round the neck on the collar band, its tail on the
  // blouse), the wings pin on the left breast, pocket welts, cuff stripe.
  PAINT.cabincrew = function (P, c) {
    const navy = (c && c.torso != null) ? c.torso : 0x223552, scarf = (c && c.collar != null) ? c.collar : 0xb52d3c;
    const T = P.T, A = P.A, L = P.L, hem = TORSO_ROW.hem;
    T.fill(hx(navy));
    T.poly("front", fpts([[-0.19, 0], [0.19, 0], [0, 0.3]]), "#eef0ec");             // the blouse V
    T.poly("front", fpts([[0.02, 0], [0.1, 0], [0.13, 0.2], [0.07, 0.22]]), hx(scarf));   // the scarf's tail
    T.poly("front", fpts([[-0.05, 0], [0.06, 0], [0.04, 0.06], [-0.03, 0.06]]), tone(scarf, -0.15));   // …its knot
    for (let i = 0; i < 3; i++) T.dot("front", fx(0), 0.38 + i * 0.13, 0.013, "#d5b24a");
    for (const s of [1, -1]) T.rect("front", fx(s > 0 ? 0.14 : -0.36), 0.6, 0.22, 0.014, tone(navy, -0.3));   // pocket welts
    T.poly("front", fpts([[0.18, 0.2], [0.26, 0.19], [0.34, 0.2], [0.26, 0.215]]), "#d5b24a");                // the wings pin
    hemBand(T, tone(navy, -0.12), hem, 0.02);
    T.shade();
    A.fill(hx(navy));
    for (const col of ["front", "side", "back"]) A.rect(col, 0, 0.9, 1, 0.025, "#d5b24a");   // the cuff stripe
    A.shade();
    L.fill(hx((c && c.legs != null) ? c.legs : 0x18243a)); L.shade();
    return { torso: 1, arms: 1, legs: 1, fp: 1, neck: { fp: 1, band: scarf } };
  };

  // BARTENDER — black shirt, a long bistro apron tied at the waist (on the
  // torso below the tie line, the pelvis and the thigh fronts to the knee),
  // a bar towel tucked at the right hip, sleeves rolled to the forearm.
  PAINT.bartender = function (P, c) {
    const black = (c && c.torso != null) ? c.torso : 0x24282d, cloth = (c && c.collar != null) ? c.collar : 0xd9d7cf;
    const legHex = (c && c.legs != null) ? c.legs : 0x15181d, apron = tone(legHex, 0.14);
    const T = P.T, A = P.A, L = P.L, tieY = TORSO_ROW.waist - 0.04;
    T.fill(hx(black));
    T.rect("front", fx(-0.008), 0.08, 0.016, tieY - 0.08, tone(black, 0.12));       // placket
    T.rect("front", 0, tieY, 1, 1 - tieY, apron);
    T.rect("side", 0, tieY, 1, 0.02, apron); T.rect("back", 0, tieY, 1, 0.02, apron);   // the ties round the waist
    T.rect("back", 0.44, tieY - 0.01, 0.12, 0.04, apron);                               // knotted behind
    T.rect("front", fx(-0.42), tieY, 0.1, 0.16, hx(cloth));                            // the towel at the right hip
    T.shade();
    A.fill(hx(black));
    for (const col of ["front", "side", "back"]) A.rect(col, 0, 0.6, 1, 0.07, tone(black, 0.1));   // the rolled cuff
    A.shade();
    L.fill(hx(legHex));
    L.rect("front", 0, 0, 1, 0.46, apron); L.rect("front", 0, 0.44, 1, 0.02, tone(legHex, -0.1));  // apron to the knee
    L.shade();
    return { torso: 1, arms: 1, legs: 1, fp: 1, neck: { fp: 1, band: tone2(black, 0.06), open: 1 } };
  };

  // DRIVER — a chauffeur: pale shirt, dark waistcoat, dark tie, a badge on the
  // left breast.
  PAINT.driver = function (P, c) {
    const shirt = (c && c.torso != null) ? c.torso : 0xc9d3dc, vest = (c && c.collar != null) ? c.collar : 0x27354a;
    const T = P.T, A = P.A, L = P.L, vc = hx(vest), hem = TORSO_ROW.hem + 0.06;
    const tieHex = tone2(vest, -0.2);
    T.fill(hx(shirt));
    paintTie(T, tieHex, 0.36, 0.17);
    for (const col of ["side", "back"]) T.rect(col, 0, 0.12, 1, hem - 0.12, vc);
    for (const s of [1, -1]) T.poly("front", fpts([[s * 0.17, 0], [s * 0.5, 0], [s * 0.5, hem], [s * 0.1, hem], [s * 0.05, hem + 0.05], [0, hem], [0, 0.36]]), vc);
    T.rect("front", fx(-0.004), 0.36, 0.008, hem - 0.36, tone(vest, -0.3));
    for (let i = 0; i < 4; i++) T.dot("front", fx(0), 0.42 + i * (hem - 0.46) / 3, 0.012, tone(vest, 0.3));
    T.rect("front", fx(0.18), 0.4, 0.12, 0.035, "#d1b14d");                         // the badge
    T.shade();
    A.fill(hx(shirt));
    for (const col of ["front", "side", "back"]) A.rect(col, 0, 0.93, 1, 0.07, tone(shirt, -0.12));
    A.shade();
    L.fill(hx((c && c.legs != null) ? c.legs : 0x202733)); L.shade();
    return { torso: 1, arms: 1, legs: 1, fp: 1, neck: { tie: tieHex, fp: 1 } };
  };


  PAINT.housekeeping = function (P, c) {
    const teal = (c && c.torso != null) ? c.torso : 0x71939a, cream = (c && c.collar != null) ? c.collar : 0xe5e2d9;
    const T = P.T, J = P.J, A = P.A, L = P.L, trou = (c && c.legs != null) ? c.legs : 0x34434b;
    T.fill(hx(teal)); T.poly("front", [[0.36, 0], [0.5, 0.16], [0.64, 0]], hx(cream));   // the cream collar V
    for (let y = 0.2; y < 0.34; y += 0.07) T.dot("front", 0.5, y, 0.018, tone(teal, -0.3));   // tunic buttons above the bib
    trouserSeat(J, trou);
    bibApron(T, J, cream, 0.34);
    T.shade(); J.shade();
    A.fill(hx(teal)); hemBand(A, hx(cream), 0.9, 0.05); limbHem(A, 0.95, teal); A.shade();   // cream-piped cuffs
    L.fill(hx(trou)); L.rect("front", 0.49, 0, 0.02, 0.92, tone(trou, -0.14)); limbHem(L, 0.95, trou); L.shade();
    return { torso: 1, arms: 1, legs: 1, seat: 1 };
  };

  PAINT.athletic = function (P, c) {
    const blue = (c && c.torso != null) ? c.torso : 0x315f9b, white = (c && c.collar != null) ? c.collar : 0xe6e7e3;
    const T = P.T, A = P.A, L = P.L;
    // warm-up jacket: zip to the hem, white chevron panels off the shoulders,
    // a white rib hem ABOVE the tuck (it was at 0.86-0.96, inside the
    // trousers). The piping was two stripes, one on the front face and one
    // on the side face of the arm; it is one line down the side of the
    // sleeve and the leg now, centred, like the tracksuit's.
    T.fill(hx(blue)); T.rect("front", 0.485, 0, 0.03, TORSO_ROW.hem, tone(blue, -0.32));
    hemBand(T, hx(white));
    T.poly("front", [[0.12, 0], [0.28, 0], [0.46, 0.48], [0.38, 0.55]], hx(white)); T.poly("front", [[0.88, 0], [0.72, 0], [0.54, 0.48], [0.62, 0.55]], hx(white)); T.shade();
    A.fill(hx(blue)); A.rect("side", 0.4, 0, 0.2, 1, hx(white)); A.shade();
    L.fill(hx((c && c.legs != null) ? c.legs : 0x1f2936)); L.rect("side", 0.4, 0, 0.2, 1, hx(white)); L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  };

  // the pit crew and the driver wear one-piece fire suits (jumpsuit) with the
  // team colour run down the side panels, shoulder to ankle; the driver's has
  // the shoulder epaulettes a rescuer grabs him by
  PAINT.pitcrew = function (P, c) {
    return jumpsuit(P, (c && c.torso != null) ? c.torso : 0x17253a, { panel: (c && c.collar != null) ? c.collar : 0xc93632 });
  };
  PAINT.racer = function (P, c) {
    const body = (c && c.torso != null) ? c.torso : 0xb52d32, accent = (c && c.collar != null) ? c.collar : 0xf1eee7;
    const parts = jumpsuit(P, body, { panel: accent });
    P.T.rect("front", 0.08, 0, 0.18, 0.08, hx(accent)); P.T.rect("front", 0.74, 0, 0.18, 0.08, hx(accent));   // epaulettes
    P.T.rect("back", 0.08, 0, 0.18, 0.08, hx(accent)); P.T.rect("back", 0.74, 0, 0.18, 0.08, hx(accent));
    return parts;
  };
  // the track marshal: an orange tabard with one yellow band over navy
  PAINT.marshal = function (P, c) {
    const band = (c && c.collar != null) ? hx(c.collar) : "#f0e44c";
    const parts = workVest(P, {
      vest: (c && c.torso != null) ? c.torso : 0xe36f22, shirt: (c && c.arms != null) ? c.arms : 0x26313e,
      legs: (c && c.legs != null) ? c.legs : 0x26313e,
    });
    hemBand(P.T, band, 0.5, 0.1);
    return parts;
  };

  // DRESS — an A-line dress: fitted bodice, FLARED hem painted onto the LEG row
  // (the skirt sweeps out at the bottom). color via key/torso → many colors.
  PAINT.dress = function (P, c) {
    const body = (c && c.torso != null) ? c.torso : 0x8a2050, bc = hx(body);
    const T = P.T, L = P.L, hi = tone(body, 0.14), lo = tone(body, -0.2);
    T.fill(bc);
    // a scoop deep enough to show BELOW the collar band (which wears its tone
    // round the neck), so the neckline reads instead of hiding under the band
    T.poly("front", [[0.33, 0], [0.5, 0.24], [0.67, 0]], lo);
    // WAIST SEAM ON THE WAIST. It sat at 0.66 because that is where the
    // female rig's waist BOX began — a mesh split, not anatomy: on the shaped
    // body 0.66 is the lower ribcage, and the narrowest ring is ~0.79. The
    // seam goes all the way round, just above the tuck, and the pelvis below
    // it wears the top of the skirt (hips), so bodice meets skirt at the waist.
    // (The old "skirt begins flaring" sweep at 0.86-1.0 was inside the pelvis.)
    hemBand(T, lo, TORSO_ROW.waist, 0.03);
    // two princess seams from the bust down to the waist: a fitted bodice
    T.poly("front", [[0.3, 0.3], [0.32, 0.3], [0.37, TORSO_ROW.waist], [0.35, TORSO_ROW.waist]], lo);
    T.poly("front", [[0.7, 0.3], [0.68, 0.3], [0.63, TORSO_ROW.waist], [0.65, TORSO_ROW.waist]], lo);
    T.shade();
    // SLEEVELESS. The arm row was the dress colour to the wrist with a "cap
    // sleeve cuff" two-thirds down the upper arm, i.e. a long sleeve with a
    // stripe. The bare arm is the wearer's own skin, which the shared atlas
    // cannot know, so the arms stay flat in it (applyClothes, `sleeves`).
    // the LEG row carries the A-line skirt: flared (wider light wedge low),
    // hem sweep, so the legs read as a skirt, not trousers.
    L.fill(bc);
    for (const col of ["front", "back", "side"]) {
      L.poly(col, [[0.3, 0], [0.7, 0], [1, 1], [0, 1]], hi);       // flare outward to the hem
      L.rect(col, 0, 0.92, 1, 0.06, lo);                          // hem band
    }
    L.shade();
    return { torso: 1, legs: 1, hips: 1, sleeves: "none" };
  };

  // SUNDRESS — a light summer dress in a woven GINGHAM check.
  //
  // WHAT USED TO BE HERE, AND WHY IT IS GONE. OWNER, verbatim: "GET THIS OUTFIT
  // WITH DUMB DOTS ON IT LITTLE CIRCLES GET THIS SHIT OUT OF THE GAME." This
  // painter ran a private `flowers()` blot field: an LCG scattering 14 discs
  // across each torso column and 12 across each skirt column, every disc a
  // coloured ring with a cream centre. That is 78 arcs on one dress, and the
  // ring-plus-centre construction is exactly the "dark rings + pink dots on
  // torso and legs" in the screenshot — the accent hue came straight off
  // `c.collar`, which `outfits.js`'s SUNDRESS_HUES fills with a rose, so the
  // whitish-pink variant was the loudest of the seven.
  //
  // It was the ONLY randomised motif field in the entire wardrobe. It is
  // DELETED, not flagged: a flag would keep a live code path that can put a
  // scattered circle on a person, and the owner asked for the class to leave
  // the game. `PAINT.soldier`'s camo scatters RECTS (that is camouflage and it
  // stays); every other `dot()` in this file is one hand-placed button, stud,
  // badge or chest motif at a known coordinate.
  //
  // The replacement is the shared `patternRow` stamper's `gingham` kind, so the
  // print belongs to the wardrobe rather than to this one garment and the next
  // checked shirt costs one argument. Rect-only by construction, and cheaper:
  // 24 fillRects a row against 78 arcs, on a canvas that is built once and
  // cached per colour key.
  PAINT.sundress = function (P, c) {
    const body = (c && c.torso != null) ? c.torso : 0xf0d9a0, bc = hx(body);
    // the SECOND hue of the dress. It was the flower colour; it is now the
    // thread the check is woven from, so the seven SUNDRESS_HUES pairs still
    // produce seven visibly different dresses off exactly the same records.
    const accent = (c && c.collar != null) ? c.collar : 0xd86a8a;
    const T = P.T, L = P.L, ctx = P.ctx;
    const trim = tone(body, -0.22);
    T.fill(bc);
    if (ctx) patternRow(T, ctx, body, "gingham", accent);
    T.poly("front", [[0.34, 0], [0.5, 0.22], [0.66, 0]], tone(body, -0.2)); // neckline, deep enough to clear the collar band
    // the tie sits ON THE WAIST (~0.77-0.79 on the shaped body), right above
    // the tuck where the skirt (the pelvis, `hips`) takes over. It was at
    // 0.66, the old waist BOX seam — which the shaped body puts on the ribs.
    // (Two plain "strap" patches at the top broke the check for nothing and
    // are gone: a SLEEVELESS dress's straps are its bare shoulders, below.)
    hemBand(T, trim, TORSO_ROW.waist, 0.035);
    T.shade();
    // SLEEVELESS: the arm row was the dress fabric shoulder to wrist (a long-
    // sleeved sundress). Bare arms are the wearer's own skin — flat, via
    // applyClothes `sleeves` — never a guess painted into a shared atlas.
    L.fill(bc);
    if (ctx) patternRow(L, ctx, body, "gingham", accent);         // the skirt carries the same check
    for (const col of ["front", "back", "side"]) L.rect(col, 0, 0.92, 1, 0.05, tone(body, -0.2)); // hem
    L.shade();
    return { torso: 1, legs: 1, hips: 1, sleeves: "none" };
  };

  // TRACKSUIT VARIANTS — color/stripe themes. PAINT.tracksuit already exists;
  // these are thin wrappers selecting palette via the color record so the cache
  // keys stay distinct (tracksuit2/tracksuit3) without duplicating the painter.
  PAINT.tracksuit2 = function (P, c) {                            // red w/ white stripes
    return PAINT.tracksuit(P, c && c.torso != null ? c : { torso: 0xb22a2a, legs: 0x161616 });
  };
  PAINT.tracksuit3 = function (P, c) {                            // navy w/ GOLD stripes (it said so and was white)
    return PAINT.tracksuit(P, c && c.torso != null ? c : { torso: 0x1c2440, legs: 0x14161c, stripe: 0xd8b04a });
  };

  // ============================================================
  //  WOMENSWEAR — the body carries the read now (real waist box), so the
  //  garment's job is to REINFORCE the taper, not to fake it with color.
  // ============================================================
  // BLOUSE — a fitted everyday top over jeans: soft open collar, front
  // placket, and DARTS that converge on the natural waist (row y ~0.67 —
  // exactly where the adult-female waist box starts, waistShare 0.325). The
  // hem runs to the bottom of the row so the shirt reads as ONE piece tucked
  // into the trousers: no bare-skin stripe can appear at the chest/waist seam.
  PAINT.blouse = function (P, c) {
    const body = (c && c.torso != null) ? c.torso : 0xd8dce4, bc = hx(body);
    const T = P.T, A = P.A;
    const lo = tone(body, -0.16), lo2 = tone(body, -0.3), hi = tone(body, 0.16);
    // THE WAIST IS THE WAIST: 0.67 was where the female rig's waist BOX began
    // (a mesh split). On the shaped body that is the lower ribs; the darts
    // now converge on the narrowest ring, just above the tuck.
    const WAIST = TORSO_ROW.waist;
    T.fill(bc);
    // the open collar: the collar band covers the neck base to ~0.11, so the
    // V and the collar leaves run far enough down to be SEEN below it (they
    // ended at 0.13-0.17, a sliver under the band)
    T.poly("front", [[0.37, 0], [0.5, 0.24], [0.63, 0]], lo2);       // open neckline
    T.poly("front", [[0.28, 0.04], [0.42, 0.04], [0.47, 0.2], [0.4, 0.2]], lo);   // collar leaf L
    T.poly("front", [[0.72, 0.04], [0.58, 0.04], [0.53, 0.2], [0.6, 0.2]], lo);   // collar leaf R
    T.rect("front", 0.49, 0.22, 0.02, TORSO_ROW.hem - 0.22, lo);     // button placket
    for (let i = 0; i < 4; i++) T.dot("front", 0.5, 0.3 + i * 0.13, 0.012, hi);
    // princess/waist darts: shallow wedges pinching in toward the waist line
    T.poly("front", [[0.28, 0.26], [0.33, 0.26], [0.35, WAIST], [0.31, WAIST]], lo);
    T.poly("front", [[0.72, 0.26], [0.67, 0.26], [0.65, WAIST], [0.69, WAIST]], lo);
    T.poly("back", [[0.3, 0.28], [0.35, 0.28], [0.36, WAIST], [0.32, WAIST]], lo);
    T.poly("back", [[0.7, 0.28], [0.65, 0.28], [0.64, WAIST], [0.68, WAIST]], lo);
    // the garment CONTINUES past the seam and tucks in — a single shadow band
    // where it meets the waistband (was at 0.93, inside the trousers)
    hemBand(T, lo2, 0.785, 0.05);
    T.shade();
    // a long sleeve with a buttoned cuff. The "3/4 seam" at 0.52 was a line
    // round the arm just above the elbow, which is no seam a blouse has.
    A.fill(bc);
    for (const col of ["front", "back", "side"]) A.rect(col, 0, 0.84, 1, 0.07, lo2); // cuff, all round
    A.shade();
    return { torso: 1, arms: 1 };                    // legs keep their flat jean color
  };

  // ============================================================
  //  CHILDRENSWEAR — the SAME painted grammar, nothing new invented. A child
  //  is not a small adult and must never be dressed as one: these are the
  //  garments the baby / toddler / child / preteen bands actually wear, and
  //  outfits.js's age gate is what casts them. The rig's own profile-driven
  //  clothDims/clothBand tags (see BODY FIT) mean a kid's tee lands on a kid's
  //  torso instead of running off the end of it.
  // ============================================================

  // ONESIE — a footed babygrow. ONE PIECE: no waist hem anywhere, the fabric
  // runs torso → legs → painted feet, which is the whole silhouette read.
  PAINT.onesie = function (P, c) {
    const body = (c && c.torso != null) ? c.torso : 0xbfd8e8, bc = hx(body);
    const trim = (c && c.collar != null) ? c.collar : tone2(body, -0.28);
    const T = P.T, A = P.A, L = P.L, tc = hx(trim), lo = tone(body, -0.16);
    T.fill(bc);
    T.rect("front", 0.3, 0, 0.4, 0.07, tc);                          // envelope neck binding
    T.rect("back", 0.3, 0, 0.4, 0.07, tc);
    // A BABY'S COLLAR BAND COVERS THE TOP QUARTER of this row (to ~0.27) and
    // the babygrow tucks into the pelvis from ~0.66, so the snaps run in the
    // strip actually seen between them. (A "crotch snap row" at 0.86-0.91
    // was painted inside the pelvis and never drawn once: deleted.)
    T.rect("front", 0.49, 0.2, 0.02, 0.48, lo);                      // snap placket
    for (let i = 0; i < 4; i++) T.dot("front", 0.5, 0.31 + i * 0.11, 0.014, tc);
    T.dot("front", 0.32, 0.38, 0.06, tc);                            // a little chest motif
    T.dot("front", 0.32, 0.38, 0.03, "#fdfaf2");
    T.shade();                                                        // NOTE: no hem — one piece
    A.fill(bc); A.rect("front", 0, 0.88, 1, 0.08, tc); A.rect("side", 0, 0.88, 1, 0.08, tc); A.shade();
    L.fill(bc);
    L.rect("front", 0, 0.86, 1, 0.14, tc);                           // the sewn-in FOOT
    L.rect("side", 0, 0.86, 1, 0.14, tc); L.rect("back", 0, 0.86, 1, 0.14, tc);
    L.shade();
    return { torso: 1, arms: 1, legs: 1, hips: 1 };
  };

  // PYJAMAS — horizontal stripes over a pastel ground, button placket, elastic
  // cuffs. Stripes run all the way round every row, so the two-box torso and
  // the split limbs read as one continuous striped suit.
  PAINT.pyjamas = function (P, c) {
    const body = (c && c.torso != null) ? c.torso : 0xe8e2f0, bc = hx(body);
    const stripe = (c && c.collar != null) ? c.collar : 0x6a7ac0;
    const T = P.T, A = P.A, L = P.L, sc = hx(stripe), lo = tone(body, -0.2);
    // NOTE the loop bound: rowPainter.rect() does not clamp, so a stripe that
    // ran past y=1 would spill into the NEXT atlas row (a pyjama stripe across
    // the top of the trousers). Stop a full stripe short of the row edge.
    function stripes(R, step, off) {
      const h = step * 0.42;
      for (const col of ["front", "back", "side"])
        for (let y = off; y <= 1 - h; y += step) R.rect(col, 0, y, 1, h, sc);
    }
    T.fill(bc); stripes(T, 0.14, 0.05);
    T.rect("front", 0.3, 0, 0.4, 0.06, sc);                          // collar band
    T.rect("front", 0.49, 0.06, 0.02, 0.86, lo);                     // placket
    for (let i = 0; i < 5; i++) T.dot("front", 0.5, 0.14 + i * 0.16, 0.012, "#f6f4ee");
    T.rect("front", 0.16, 0.34, 0.2, 0.13, lo);                      // chest patch pocket (was at 0.72-0.86: inside a child's pelvis)
    T.shade();
    A.fill(bc); stripes(A, 0.16, 0.06); A.rect("front", 0, 0.88, 1, 0.08, lo); A.rect("side", 0, 0.88, 1, 0.08, lo); A.shade();
    L.fill(bc); stripes(L, 0.16, 0.06); L.rect("front", 0, 0.9, 1, 0.08, lo); L.rect("side", 0, 0.9, 1, 0.08, lo); L.shade();
    return { torso: 1, arms: 1, legs: 1, hips: 1 };
  };

  // ROMPER — a toddler's dungaree romper: a bib-and-straps front in the romper
  // color over a plain tee, short legs, BARE SHINS (skin rides the cache key —
  // the wifebeater precedent, see keyOf/SKIN_KEYED).
  PAINT.romper = function (P, c) {
    const denim = (c && c.torso != null) ? c.torso : 0x4a6a92, dc = hx(denim);
    const tee = (c && c.collar != null) ? c.collar : 0xf0e9dc, tc = hx(tee);
    const skin = (c && c.skin != null) ? c.skin : 0xcf9a72, sk = hx(skin);
    const T = P.T, A = P.A, L = P.L, dk = tone(denim, -0.24), stitch = "#e2c98a";
    T.fill(tc);                                                       // the tee underneath
    T.poly("front", [[0.36, 0], [0.64, 0], [0.5, 0.12]], tone(tee, -0.22));  // crew neck
    T.rect("front", 0.2, 0.14, 0.14, 0.86, dc);                      // strap L
    T.rect("front", 0.66, 0.14, 0.14, 0.86, dc);                     // strap R
    T.rect("back", 0.2, 0.1, 0.14, 0.9, dc); T.rect("back", 0.66, 0.1, 0.14, 0.9, dc);
    T.rect("front", 0.24, 0.46, 0.52, 0.54, dc);                     // the BIB
    T.rect("front", 0.24, 0.46, 0.52, 0.03, stitch);                 // bib top stitch
    T.rect("front", 0.32, 0.56, 0.36, 0.2, dk);                      // bib pocket
    T.dot("front", 0.26, 0.44, 0.03, "#d8b04a"); T.dot("front", 0.74, 0.44, 0.03, "#d8b04a"); // strap buttons
    T.rect("side", 0, 0.5, 1, 0.5, dc); T.rect("back", 0, 0.5, 1, 0.5, dc);   // the romper body wraps round
    T.shade();
    A.fill(tc); shortSleeve(A, tone(tee, -0.2), sk);
    A.shade();
    L.fill(dc);
    for (const col of ["front", "back", "side"]) {
      L.rect(col, 0, 0.34, 1, 0.05, stitch);                         // short-leg hem stitch
      L.rect(col, 0, 0.39, 1, 0.61, sk);                             // BARE SHINS
    }
    L.shade();
    return { torso: 1, arms: 1, legs: 1, hips: 1 };
  };

  // KIDTEE — the everyday child fit: a bright tee with a chest motif and
  // shorts, bare arms below the sleeve and bare shins below the hem.
  PAINT.kidtee = function (P, c) {
    const body = (c && c.torso != null) ? c.torso : 0x4aa8d8, bc = hx(body);
    // The shorts are DERIVED from the tee, not read from c.legs: only torso and
    // skin ride this garment's cache key, so a c.legs read would silently give
    // every kid whichever shorts the first one to build the atlas happened to
    // have. A deep version of the tee color reads as denim/navy/khaki shorts.
    const legHex = tone2(body, -0.6), lc = hx(legHex);
    const skin = (c && c.skin != null) ? c.skin : 0xcf9a72, sk = hx(skin);
    const motif = (c && c.collar != null) ? c.collar : tone2(body, 0.4);
    const T = P.T, A = P.A, L = P.L, lo = tone(body, -0.22);
    T.fill(bc);
    T.poly("front", [[0.36, 0], [0.64, 0], [0.5, 0.13]], lo);        // crew neck
    T.rect("back", 0.34, 0, 0.32, 0.05, lo);
    T.dot("front", 0.5, 0.42, 0.16, hx(motif));                      // a big simple motif
    T.dot("front", 0.5, 0.42, 0.08, bc);
    hemBand(T, lo, TORSO_ROW.kidHem, 0.05);                          // hem (one line, above a child's tuck)
    T.shade();
    A.fill(bc);
    shortSleeve(A, lo, sk);
    A.shade();
    L.fill(lc);
    for (const col of ["front", "back", "side"]) {
      L.rect(col, 0, 0.36, 1, 0.04, tone(legHex, -0.3));             // shorts hem
      L.rect(col, 0, 0.4, 1, 0.6, sk);                               // bare shins
    }
    L.rect("front", 0.44, 0, 0.12, 0.36, tone(legHex, -0.18));       // shorts seam
    L.shade();
    return { torso: 1, arms: 1, legs: 1, hips: 1 };
  };

  // SCHOOL — a pale polo under a V-neck jumper, dark shorts and long socks.
  // No skin in this one (socks cover the shin), so it needs no skin key.
  PAINT.school = function (P, c, skirt) {
    const knit = (c && c.torso != null) ? c.torso : 0x2b3a5a, kc = hx(knit);
    const shirtHex = (c && c.collar != null) ? c.collar : 0xeceee8, shc = hx(shirtHex);
    const legHex = (c && c.legs != null) ? c.legs : 0x23283a, lc = hx(legHex);
    const T = P.T, A = P.A, L = P.L, lo = tone(knit, -0.22), sock = "#e8e9e4";
    T.fill(kc);
    T.poly("front", [[0.32, 0], [0.5, 0.3], [0.68, 0]], shc);        // the V of the jumper, shirt below
    T.poly("front", [[0.36, 0], [0.47, 0.1], [0.44, 0.02]], tone(shirtHex, -0.2)); // shirt collar L
    T.poly("front", [[0.64, 0], [0.53, 0.1], [0.56, 0.02]], tone(shirtHex, -0.2)); // shirt collar R
    T.rect("front", 0.47, 0.08, 0.06, 0.2, tone(knit, 0.35));        // a slip of school tie
    T.poly("front", [[0.32, 0], [0.5, 0.3], [0.68, 0], [0.72, 0], [0.5, 0.36], [0.28, 0]], lo); // V ribbing
    hemBand(T, lo, TORSO_ROW.kidHem, 0.06);                          // ribbed jumper hem, above a child's tuck
    T.shade();
    A.fill(kc); A.rect("front", 0, 0.88, 1, 0.08, lo); A.rect("side", 0, 0.88, 1, 0.08, lo); A.shade();
    L.fill(lc);
    if (skirt) {                                                      // pleated skirt
      for (const col of ["front", "back", "side"]) {
        for (let x = 0.08; x < 1; x += 0.16) L.rect(col, x, 0, 0.02, 0.46, tone(legHex, 0.22));
        L.rect(col, 0, 0.44, 1, 0.04, tone(legHex, -0.3));
      }
    } else {
      for (const col of ["front", "back", "side"]) L.rect(col, 0, 0.44, 1, 0.04, tone(legHex, -0.3)); // shorts hem
      L.rect("front", 0.44, 0, 0.12, 0.44, tone(legHex, -0.16));      // shorts seam
    }
    for (const col of ["front", "back", "side"]) {
      L.rect(col, 0, 0.62, 1, 0.38, sock);                            // long socks
      L.rect(col, 0, 0.62, 1, 0.035, "#c9cbc4");                      // sock welt
    }
    L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  };
  // the girls' variant is the SAME painter with the pleated skirt (the
  // tracksuit2/3 wrapper grammar — one painter, distinct cache keys).
  PAINT.schoolgirl = function (P, c) { return Object.assign(PAINT.school(P, c, true), { hips: 1 }); };
  // kids' hoodie: the adult hoodie painter, cast in a child's colors. Nothing
  // about a hoodie changes with age — only the palette and the BODY do.
  PAINT.kidhoodie = function (P, c) { return PAINT.hoodie(P, Object.assign({}, c, { kid: 1 })); };   // …hemmed above a child's tuck

  // PINAFORE — a little girl's sundress/pinafore: shoulder straps over a tee,
  // a gathered waist and a flared skirt to the knee, bare shins below.
  PAINT.pinafore = function (P, c) {
    const body = (c && c.torso != null) ? c.torso : 0xe2a2b8, bc = hx(body);
    const tee = (c && c.collar != null) ? c.collar : 0xf4efe4, tc = hx(tee);
    const skin = (c && c.skin != null) ? c.skin : 0xcf9a72, sk = hx(skin);
    const T = P.T, A = P.A, L = P.L, lo = tone(body, -0.22), hi = tone(body, 0.16);
    T.fill(tc);                                                       // the tee underneath
    T.poly("front", [[0.36, 0], [0.64, 0], [0.5, 0.12]], tone(tee, -0.2));
    T.rect("front", 0.22, 0.1, 0.13, 0.9, bc);                       // strap L
    T.rect("front", 0.65, 0.1, 0.13, 0.9, bc);                       // strap R
    T.rect("back", 0.22, 0.08, 0.13, 0.92, bc); T.rect("back", 0.65, 0.08, 0.13, 0.92, bc);
    T.rect("front", 0.26, 0.4, 0.48, 0.6, bc);                       // the pinafore bib
    T.rect("front", 0.34, 0.5, 0.32, 0.14, hi);                      // a little pocket
    T.rect("side", 0, 0.44, 1, 0.56, bc); T.rect("back", 0, 0.44, 1, 0.56, bc);
    hemBand(T, lo, TORSO_ROW.kidHem, 0.05);                          // gathered waist tie, above a child's tuck
    T.shade();
    A.fill(tc);
    shortSleeve(A, tone(tee, -0.2), sk);
    A.shade();
    L.fill(bc);
    for (const col of ["front", "back", "side"]) {
      L.poly(col, [[0.28, 0], [0.72, 0], [1, 0.5], [0, 0.5]], hi);    // the skirt flares out
      L.rect(col, 0, 0.48, 1, 0.05, lo);                              // hem band
      L.rect(col, 0, 0.53, 1, 0.47, sk);                              // BARE SHINS below the knee
    }
    L.shade();
    return { torso: 1, arms: 1, legs: 1, hips: 1 };
  };

  // ============================================================
  //  THE SHOULDER YOKE — ONE SOURCE FOR THE GARMENT'S BODY COLOUR, AND A
  //  GARMENT ON THE SLAB.
  //
  //  OWNER BUG (verbatim): "The collar of the player shirt is blue and
  //  geometric, not painted like the rest of the shirt — clearly a bug. And a
  //  weird neck."
  //
  //  He is describing entities/character.js's shoulder yoke (skinSlots.collar):
  //  a flat BoxGeometry at the top of the torso column that the painted atlas
  //  has never reached, tinted flat from the CATALOG RECORD's colors.torso. For
  //  most garments that is the same hex the painter fills with, which is
  //  exactly why the police uniform looks right — PAINT.police reads c.torso,
  //  so the slab and the cloth agree by accident.
  //
  //  A SUIT DOES NOT. PAINT.suit paints from SUIT_STYLES[style].body, and the
  //  suit record's colors.torso is a static navy (0x1c2030) nobody keeps in
  //  sync — so the Tan Suit, the Powder-Blue Suit and the All-White Suit all
  //  wear a navy slab across the shoulders. Same class of fault in the tuxedo
  //  and (before this change) the pilot, whose record said navy while the
  //  painter drew a white shirt.
  //
  //  TWO FIXES, both DERIVED so a 23rd suit style is right without being told:
  //   1. THE ATLAS ANSWERS THE QUESTION. After a set is painted we READ THE
  //      PIXEL — the modal colour of a patch of the garment's own shoulder, on
  //      the jacket row when the look has a shell and the torso row otherwise.
  //      That is not an approximation of the garment colour, it IS the garment
  //      colour, for every painter that exists or ever will. Exported as
  //      CBZ.cityPaintedBodyHex(rec) for outfits.js's flat fallback.
  //   2. THE YOKE WEARS CLOTH. A second tiny canvas (128x32, four columns, one
  //      per box face) gives the slab a collar stand, a neckline in the shirt's
  //      own sampled colour, lapel wedges when the look has an open jacket, and
  //      a darker top face so the shoulder line stops reading as a lit box.
  //      Under CLOTH_FORMAL_NECK_V2 it also carries the COLLAR LEAVES and the
  //      TIE KNOT / BOW the painter declared (see THE FORMAL NECK, V2 above) —
  //      the slab is the collar zone, and the chest rows it covers can't.
  //      One texture per outfit KEY, cached beside the atlas — never per wearer.
  //
  //  The sample points are chosen to sit where shade() is transparent (its
  //  gradient is fully clear between 0.3 and 0.6 of a row), so the answer is
  //  the painter's literal fill and the audit delta goes to zero rather than to
  //  "close". One-line revert: CBZ.CONFIG.CLOTH_YOKE_PAINT = false.
  // ============================================================
  if (CBZ.CONFIG && CBZ.CONFIG.CLOTH_YOKE_PAINT == null) CBZ.CONFIG.CLOTH_YOKE_PAINT = true;
  function yokePaint() {
    const C = CBZ.CONFIG;
    return !C || C.CLOTH_YOKE_PAINT == null || !!C.CLOTH_YOKE_PAINT;
  }
  // MEASURE THE CANVAS, DON'T RE-DERIVE THE PAINTER. Modal (most common) opaque
  // pixel over a small patch of one atlas region — modal, not mean, because a
  // mean of cloth-plus-seam is a colour neither of them is. Runs once per
  // outfit key, on the build path only.
  function modalHex(ctx, row, col, x0, x1, y0, y1) {
    if (!ctx || typeof ctx.getImageData !== "function") return null;
    const c = COLS[col], cw = c[1] - c[0], r = ROWS[row], rh = r[1] - r[0];
    const px = Math.floor(c[0] + x0 * cw), py = Math.floor(r[0] + y0 * rh);
    const pw = Math.max(1, Math.round((x1 - x0) * cw)), ph = Math.max(1, Math.round((y1 - y0) * rh));
    let d = null;
    try { d = ctx.getImageData(px, py, pw, ph); } catch (e) { return null; }
    const data = d && d.data;
    if (!data || !data.length) return null;
    const tally = {};
    let best = null, bestN = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 200) continue;              // the jacket's alpha-cut gap is not cloth
      const h = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      const n = (tally[h] = (tally[h] || 0) + 1);
      if (n > bestN) { bestN = n; best = h; }
    }
    return best;
  }
  // the yoke's own micro-atlas: four columns, one per box face. 128x32 (it was
  // 64x16): the slab now carries the collar leaves and the KNOT — the whole
  // formal-neck read — and at 24px a knot was 3px wide. Still a 16 KB texture,
  // no mips, sampled at level 0 forever.
  const YW = 128, YH = 32;
  const YCOLS = { front: [0, 48], back: [48, 80], side: [80, 104], cap: [104, 128] };
  const YFACE = ["side", "side", "cap", "cap", "front", "back"];   // +x -x +y -y +z -z
  // the ONE look that must not get lapels: a plate carrier has none, and a
  // shirt-notch on a SWAT yoke would read as a tie under body armour.
  const YOKE_NO_LAPEL = { swat: 1, swat_unmarked: 1 };
  function yokeCanvas(bodyHex, neckHex, lapels, neck) {
    if (typeof document === "undefined" || !document.createElement) return null;
    const cv = document.createElement("canvas");
    cv.width = YW; cv.height = YH;
    const ctx = cv.getContext("2d");
    if (!ctx) return null;
    function R(col, x, y, w, h, css) {
      const k = YCOLS[col], kw = k[1] - k[0];
      ctx.fillStyle = css;
      ctx.fillRect(k[0] + x * kw, y * YH, Math.max(1, w * kw), Math.max(1, h * YH));
    }
    function Q(col, pts, css) {
      const k = YCOLS[col], kw = k[1] - k[0];
      ctx.fillStyle = css;
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const x = k[0] + pts[i][0] * kw, y = pts[i][1] * YH;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fill();
    }
    if (neck && neck.fp) { yokeTailored(ctx, R, Q, neckHex, neck); return cv; }
    const hasNeck = !!(neck && (neck.tie != null || neck.bow != null));
    const bc = hx(bodyHex);
    ctx.fillStyle = bc; ctx.fillRect(0, 0, YW, YH);
    // TOP FACE. The whole complaint about this box is that it is flat-lit and
    // proud of the chest, so the face that catches the most light is the one
    // that must be DARKER than the cloth beside it — that single value break is
    // what turns a lit slab into a shoulder.
    R("cap", 0, 0, 1, 1, tone(bodyHex, -0.16));
    R("cap", 0.36, 0, 0.28, 1, tone(bodyHex, -0.34));              // the neck opening from above
    R("side", 0, 0, 1, 0.32, tone(bodyHex, 0.1));                  // shoulder roll
    R("side", 0, 0.82, 1, 0.18, tone(bodyHex, -0.24));             // armhole seam
    R("back", 0, 0, 1, 0.46, tone(bodyHex, 0.09));                 // standing collar, from behind
    R("back", 0, 0.9, 1, 0.1, tone(bodyHex, -0.18));
    R("front", 0, 0, 1, 0.3, tone(bodyHex, 0.1));                  // collar stand catches the light
    R("front", 0, 0.86, 1, 0.14, tone(bodyHex, -0.2));             // chest seam shadow
    // the neckline / shirt band — wider at its base under neckwear, so the
    // knot never meets a body-colour corner at the slab's bottom edge
    if (hasNeck) Q("front", [[0.33, 0], [0.67, 0], [0.615, 1], [0.385, 1]], hx(neckHex));
    else Q("front", [[0.34, 0], [0.66, 0], [0.6, 1], [0.4, 1]], hx(neckHex));
    // ---- NECKWEAR ON THE SLAB (CLOTH_FORMAL_NECK_V2) ----------------------
    // The slab IS the collar zone: it overlaps the chest's top ~0.145 and
    // sits proud of it, so nothing painted up there can ever be seen. The
    // collar leaves and the KNOT/BOW are drawn HERE, the knot running to the
    // slab's bottom edge where the chest's blade continues it.
    if (hasNeck && neck.tie != null) {
      const w = neck.w != null ? neck.w : 0.09;
      const kb = w / 2;                              // knot base = the blade's half-width
      const kt = Math.min(0.08, w * 0.78);           // knot top, ~1.55x the blade
      const leaf = tone(neckHex, -0.13);
      // collar leaves: two facets folding down-and-out around the knot — the
      // outer tips run under the jacket lapels, exactly where a collar goes.
      const lf = [[0.355, 0.05], [0.5 - kt + 0.015, 0.1], [0.5 - kt - 0.005, 0.44], [0.415, 0.68]];
      Q("front", lf, leaf);
      Q("front", lf.map((p) => [1 - p[0], p[1]]), leaf);
      // THE KNOT IS THE READ (the chest painter's own grammar, moved to the
      // box a camera can see): wider than the blade, a shade darker, dimpled.
      Q("front", [[0.5 - kt, 0.14], [0.5 + kt, 0.14], [0.5 + kb, 1], [0.5 - kb, 1]], tone(neck.tie, -0.28));
      R("front", 0.5 - kt + 0.01, 0.14, 2 * (kt - 0.01), 0.09, tone(neck.tie, -0.08)); // top fold catches the light
      R("front", 0.487, 0.78, 0.026, 0.2, tone(neck.tie, -0.5));   // the dimple
    } else if (hasNeck) {
      // BOW at the collar band: two wings + a lighter centre knot.
      const bw2 = hx(neck.bow);
      const wing = [[0.375, 0.26], [0.478, 0.42], [0.478, 0.7], [0.375, 0.88]];
      Q("front", wing, bw2);
      Q("front", wing.map((p) => [1 - p[0], p[1]]), bw2);
      R("front", 0.462, 0.36, 0.076, 0.38, tone(neck.bow, 0.22));
    }
    if (lapels) {
      const lc = tone(bodyHex, 0.16);
      if (hasNeck) {
        // pulled OUTBOARD so the collar + knot own the centre; through the V2
        // shell's wide collar opening these read as the jacket collar rolling
        // over the shirt collar's tips.
        Q("front", [[0.13, 0], [0.32, 0], [0.37, 1], [0.1, 1]], lc);
        Q("front", [[0.87, 0], [0.68, 0], [0.63, 1], [0.9, 1]], lc);
        Q("front", [[0.17, 0], [0.27, 0], [0.225, 0.42]], bc);     // the notch step, cut back out
        Q("front", [[0.83, 0], [0.73, 0], [0.775, 0.42]], bc);
      } else {
        Q("front", [[0.24, 0], [0.4, 0], [0.44, 1], [0.2, 1]], lc);
        Q("front", [[0.6, 0], [0.76, 0], [0.8, 1], [0.56, 1]], lc);
        Q("front", [[0.27, 0], [0.36, 0], [0.315, 0.46]], bc);     // the notch step, cut back out
        Q("front", [[0.64, 0], [0.73, 0], [0.685, 0.46]], bc);
      }
    }
    return cv;
  }
  /* THE TAILORED COLLAR BAND (parts.fp): the band round the neck base is the
     SHIRT collar (or the garment's own, neck.band), laid out in the same
     body units as the shirt and jacket fronts (fpYokePainter), magnified
     YOKE_FP_K x so the band's front, only ~a third of a chest wide, spends
     the whole 48 px column: the knot is 3.5 cm at its base to meet the blade
     on the chest exactly, 5.5 cm across the top, dimpled, with the collar
     points' edges running down and out from beside it. The jacket's own
     collar hides the band's sides and back; they wear the band colour. */
  const YOKE_FP_K = 2.5;
  function yokeTailored(ctx, R, Q, neckHex, neck) {
    const band = neck.band != null ? neck.band : neckHex, bc = hx(band);
    const F = (pts) => pts.map((p) => [0.5 + p[0] * YOKE_FP_K, p[1]]);
    const FM = (pts) => pts.map((p) => [0.5 - p[0] * YOKE_FP_K, p[1]]);
    ctx.fillStyle = bc; ctx.fillRect(0, 0, YW, YH);
    R("cap", 0, 0, 1, 1, tone(band, -0.3));                         // the inside of the collar, from above
    for (const col of ["front", "side", "back"]) R(col, 0, 0, 1, 0.1, tone(band, 0.1));   // the fold
    if (neck.tie != null || neck.bow != null || neck.collar) {
      // the collar points: stand darker outside their edges, leaf lighter inside
      const kt = 0.052, kb = 0.032;
      const edge = [[kt, 0.1], [kt + 0.012, 0.1], [0.172, 1], [0.158, 1]];
      const stand = [[kt + 0.012, 0.1], [0.5, 0.1], [0.5, 1], [0.172, 1]];
      Q("front", F(stand), tone(band, -0.06)); Q("front", FM(stand), tone(band, -0.06));
      Q("front", F(edge), tone(band, -0.2)); Q("front", FM(edge), tone(band, -0.2));
      if (neck.tie != null) {
        const t = neck.tie;
        Q("front", F([[-kt, 0.1], [kt, 0.1], [kb, 1], [-kb, 1]]), tone(t, -0.16));
        Q("front", F([[-kt + 0.006, 0.1], [kt - 0.006, 0.1], [kt - 0.01, 0.2], [-kt + 0.01, 0.2]]), tone(t, 0.02));   // the top fold
        Q("front", F([[-0.005, 0.72], [0.005, 0.72], [0.004, 1], [-0.004, 1]]), tone(t, -0.45));                      // the dimple
      } else if (neck.bow == null) {                                // an open collar: the top button undone
        Q("front", F([[-kt, 0.1], [kt, 0.1], [0, 1]]), tone(band, -0.3));
      } else {
        const b = neck.bow;
        // the top half of the bow (paintBow puts the rest on the chest below)
        const wing = [[0.13, 0.22], [0.02, 0.5], [0.02, 1], [0.13, 1]];
        Q("front", F(wing), hx(b)); Q("front", FM(wing), hx(b));
        Q("front", F([[-0.024, 0.45], [0.024, 0.45], [0.024, 1], [-0.024, 1]]), tone(b, 0.2));
      }
    } else if (neck.open) {
      Q("front", F([[-0.075, 0], [0.075, 0], [0, 0.95]]), tone(band, -0.32));   // the open neck
    }
  }

  // ONE UV-remapped box per yoke SIZE (adult male / female / the child bands —
  // a handful, ever), same shape as clothGeom's cache.
  const yokeGeoms = {};
  const YOKE_PAINTER = {
    key: "yoke",
    fn: function (face, u, v) { const col = YCOLS[face] || YCOLS.side; return [(col[0] + u * (col[1] - col[0])) / YW, v]; },
  };
  function yokeGeom(dims) {
    const key = dims[0].toFixed(3) + "," + dims[1].toFixed(3) + "," + dims[2].toFixed(3);
    let g = yokeGeoms[key];
    if (g) return g;
    g = new THREE.BoxGeometry(dims[0], dims[1], dims[2]);
    const uv = g.attributes.uv;
    for (let f = 0; f < 6; f++) {
      const col = YCOLS[YFACE[f]];
      for (let v = 0; v < 4; v++) {
        const i = f * 4 + v, u = uv.getX(i);
        uv.setXY(i, (col[0] + u * (col[1] - col[0])) / YW, uv.getY(i));
      }
    }
    uv.needsUpdate = true;
    g._shared = true;
    yokeGeoms[key] = g;
    return g;
  }

  // ============================================================
  //  THE CACHE — one set per outfit key, shared by every wearer.
  // ============================================================
  const sets = {};                                  // key → {mat, tex, parts}
  // ---- CACHE-KEY CLASSES (tables, not branches) ----------------------------
  // COLOR_KEYED: same painter, one atlas PER COLOR, so the wardrobe can cast a
  //   dozen dress/hoodie/pyjama colors without collapsing them to one texture.
  //   (`hoodie` is in here to fix a real collision: the buyable Grey Hoodie and
  //   Black Hoodie both resolved to the bare key "hoodie" and therefore SHARED
  //   whichever atlas was built first.)
  // SKIN_KEYED: garments that show bare skin in the atlas (a tank's arms, a
  //   child's shins). The shared atlas can't know a wearer's tone unless the
  //   tone is part of the key — a handful of atlases, never one per rig.
  const COLOR_KEYED = { dress: 1, sundress: 1, hoodie: 1, blouse: 1, onesie: 1, pyjamas: 1, school: 1, schoolgirl: 1, kidhoodie: 1 };
  const SKIN_KEYED = { wifebeater: 1, romper: 1, kidtee: 1, pinafore: 1, inmate_tank: 1 };

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
    // 22: the protective-detail uniform (outfits.js CAT.detail; warlord's black suit too):
    // near-black two-piece, white shirt, BLACK tie. "Black Suit" (3) wears a banker's grey tie.
    { name: "Detail Black",             body: 0x121318, tie: 0x08090c, pattern: "solid", legs: 0x101115 },
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
    if (COLOR_KEYED[id]) {
      return id + "|" + (c.torso != null ? c.torso | 0 : 0) + "|" + (c.collar != null ? c.collar | 0 : 0);
    }
    if (id === "suit") {
      // style index: explicit rec.style wins; else derive a stable per-rig pick.
      let si = (rec.style != null) ? (rec.style | 0)
        : (ch && ch.group && ch.group.id != null ? (ch.group.id % SUIT_STYLES.length) : 0);
      if (si < 0 || si >= SUIT_STYLES.length) si = 0;
      return "suit|" + si;
    }
    if (id === "construction") return "construction|" + (c.torso != null ? c.torso | 0 : 0xff5f08);
    // skin-showing garments: the bare shoulders/arms/shins in the atlas must
    // match the WEARER's actual skin, so the tone joins the cache key (one
    // atlas per tone actually seen — a handful, not per-rig). Garment color
    // rides too, so two kids in different tees don't share one texture.
    if (SKIN_KEYED[id]) {
      const sk = (c.skin != null) ? c.skin | 0 : (ch && ch.skinTone != null ? ch.skinTone | 0 : 0xcf9a72);
      // (ink is NOT part of the picture any more: bare arms are the wearer's
      // own flat skin and entities/tattoo.js inks them, so a yard of inked
      // men in tanks shares one atlas per skin tone)
      return id + "|" + (c.torso != null ? c.torso | 0 : 0) + "|" + sk;
    }
    // a closet recipe (cityApplyComposite): one atlas per recipe worn
    if (id === "comp") return "comp|" + COMP_FIELDS.map((k) => (c[k] != null ? c[k] | 0 : -1)).join("|");
    if (PAINT[id]) return id;
    // …and anything with no painter at all keeps the flat-colour path in
    // outfits.js recolorRig. (leather / designer / tactical used to land here —
    // the three most expensive fits in the catalog rendering as flat boxes.
    // They have painters now and resolve on the line above.)
    return null;
  }

  // ============================================================
  //  THE DEFAULT-LOOK GUARANTEE — a cloth region may never render NOTHING.
  //
  //  OWNER (2026-07-29, verbatim): "there's some weird NPCs that have no
  //  outfit, and it's like invisible where the outfit should be. It's dumb —
  //  instead of just having a default look."
  //
  //  The producer that shipped is named in entities/character.js (a rig never
  //  tagged itself `userData.dynamic`, so the build-time static passes merged
  //  its untagged chest / yoke / pelvis out of the scene graph). This block is
  //  the SECOND failure the same symptom has available to it, closed the same
  //  day, because it is the one no caller audit could ever prevent.
  //
  //  WHY THIS LIVES AT THE MATERIAL SEAM AND NOT AT THE CALLERS. Every painted
  //  garment in this game is ONE MeshLambertMaterial + ONE CanvasTexture per
  //  outfit KEY, shared by every wearer, and it wears `alphaTest: 0.5`. That
  //  combination has a failure mode nothing else in the engine has: if the
  //  texture ever stops sampling, EVERY texel fails the alpha test and the mesh
  //  is DISCARDED ENTIRELY — so torso/arms/legs vanish while the head, hands,
  //  hair and shoes (which are not on the atlas) keep drawing, for every wearer
  //  of that key at once. That is the owner's screenshot exactly, and a caller
  //  audit can never prevent it, because the caller did nothing wrong.
  //
  //  So the cache validates ITSELF (getSet below rebuilds a dead entry), the
  //  clone bank re-clones off the live entry, dress() refuses to install a
  //  degenerate box, and restore() refuses to hand a dead material back to a
  //  body. Whoever kills a texture, the next dress heals it — and outfits.js's
  //  sweep re-dresses the bodies that were already wearing the corpse.
  //
  //  Flag: CBZ.CONFIG.CITY_OUTFIT_GUARANTEE (declared in city/outfits.js, the
  //  file that owns the repair; undefined reads ON — the plainCivvies() shape).
  //  Off = this file behaves exactly as it did.
  // ============================================================
  function outfitGuarantee() {
    const C = CBZ.CONFIG;
    return !C || C.CITY_OUTFIT_GUARANTEE == null || !!C.CITY_OUTFIT_GUARANTEE;
  }
  const DEFAULT_CLOTH = 0x8a939c;                  // outfits.js's own civShirtFor fallback grey
  const DEFAULT_LEGS = 0x39414f;                   // == outfits.js JEAN
  // Is this material capable of putting pixels on the screen? A flat material
  // always is. A PAINTED one is only as good as its atlas: r128 leaves no
  // "disposed" flag on a Texture, so buildSet marks its own (below) and we also
  // read the canvas the texture actually samples — a zero-sized or detached
  // image is the other way a CanvasTexture goes quiet.
  function clothMatOk(mat) {
    if (!mat) return false;
    if (mat.visible === false) return false;
    if (mat.transparent && mat.opacity <= 0.02) return false;
    const map = mat.map;
    if (!map) return true;
    if (map._cbzDead) return false;
    const img = map.image;
    return !!(img && img.width > 0 && img.height > 0);
  }
  function geomOk(g) {
    if (!g) return false;
    const p = g.parameters;
    if (p && !(p.width > 0 && p.height > 0 && p.depth > 0)) return false;
    const pos = g.attributes && g.attributes.position;
    return !pos || pos.count > 0;
  }
  // "is this cloth mesh actually drawing?" — the ONE question the repair sweep
  // asks. Deliberately tests the MESH, never its ancestors: gore.js's
  // dismemberment hides the limb PIVOT (ch.parts.ll), so a severed leg is not a
  // bare leg and must never be repaired back on.
  function clothMeshRenders(mesh) {
    if (!mesh) return false;
    if (mesh.visible === false) return false;
    if (!mesh.parent) return false;
    if (!geomOk(mesh.geometry)) return false;
    if (!clothMatOk(mesh.material)) return false;
    /* THE THIRD WAY A GARMENT STOPS DRAWING, and the only one the four tests
       above cannot see. entities/pedinstance.js (default ON since 2026-08-03)
       stops a body part rendering by moving it to a private LAYER and drawing
       it from an InstancedMesh pool instead — deliberately NOT by touching
       `visible`, because `visible` on a rig part is gameplay state here. So a
       pooled part that lost its pool slot is `visible`, parented, geometrically
       sound and holding a live material, and every line above calls it healthy
       while the person has a hole in them. Ask the file that hid it; it is the
       only one that knows. Degrade-safe: absent, or a mesh it does not own,
       returns null and this line is a no-op. */
    if (CBZ.pedInstanceDraws && CBZ.pedInstanceDraws(mesh) === false) return false;
    return true;
  }
  CBZ.cityClothMatOk = clothMatOk;
  CBZ.cityClothMeshRenders = clothMeshRenders;

  let _deadCanvases = 0;
  function buildSet(key, rec) {
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    // willReadFrequently: modalHex reads pixels back off this atlas after
    // painting (cityPaintedBodyHex / yoke sampling). On an accelerated canvas
    // every getImageData is a full GPU pipeline flush — measured 60+ms/tick
    // during crowd-promotion prewarm when many outfit keys build in a burst.
    // The CPU-side canvas paints marginally slower and reads for free; the
    // texture upload path (texImage2D from canvas) is unchanged.
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    if (!ctx) { _deadCanvases++; return null; }
    const P = { T: rowPainter(ctx, "torso"), J: rowPainter(ctx, "jacket"), A: rowPainter(ctx, "arm"), L: rowPainter(ctx, "leg"), ctx: ctx };
    const c = (rec && rec.colors) || {};
    const kind = key.split("|")[0];
    // pre-fill the WHOLE atlas opaque (base cloth color) so rows a painter
    // skips can never mip-blend transparency into a used row at distance
    // (alphaTest would eat the edge texels). Painters overdraw their rows;
    // the jacket's gap/cap clears cut through this layer too.
    ctx.fillStyle = hx(c.torso != null ? c.torso : (key.split("|")[1] | 0) || 0x444444);
    ctx.fillRect(0, 0, W, H);
    // A DEAD CANVAS IS A BODY WITH NO CLOTHES. iOS WebKit caps the memory all
    // canvases may hold; a canvas made past the cap still hands out a context,
    // but it draws nothing and reads back transparent. Uploaded, that atlas is
    // alpha 0 everywhere and this material's alphaTest discards the whole
    // torso, arms and legs (owner, iPad: "the outfit is nil"). The opaque fill
    // just above cannot read back fully transparent; if it does, refuse: null is this
    // cache's "no painted look", so the body is flat-painted in rec.colors.
    try { if (ctx.getImageData(W >> 1, H >> 1, 1, 1).data[3] === 0) { _deadCanvases++; return null; } } catch (e) {}
    let parts = null;
    if (kind === "suit") {
      const st = SUIT_STYLES[(key.split("|")[1] | 0)] || SUIT_STYLES[0];
      parts = st.tux ? PAINT.tuxedo(P, c, st) : PAINT.suit(P, c, st);
    }
    else if (kind === "basics") parts = PAINT.basics(P, { torso: key.split("|")[1] | 0 });
    else if (kind === "construction") parts = PAINT.construction(P, { torso: key.split("|")[1] | 0, collar: c.collar, legs: c.legs, arms: c.arms });
    else if (kind === "gang") { const seg = key.split("|"); parts = PAINT.gang(P, { torso: seg[1] | 0, collar: seg[2] | 0, legs: c.legs }); }
    // the WEARER's skin tone isn't in rec.colors (it comes off the rig), so it
    // rides the cache key and is handed back to the painter here. The garment
    // colors stay exactly where every other painter reads them: rec.colors.
    else if (SKIN_KEYED[kind]) { const seg = key.split("|"); parts = PAINT[kind](P, Object.assign({}, c, { skin: seg[2] | 0 })); }
    else if (PAINT[kind]) parts = PAINT[kind](P, c);
    if (!parts) return null;
    const tex = new THREE.CanvasTexture(cv);
    tex.magFilter = THREE.LinearFilter;
    // THIS CACHE IS PERMANENT — but nothing else in the engine knows that. Two
    // teardown sweeps walk a whole rig and dispose every material/geometry they
    // find (peds.js clearCityPeds, entities/npclife.js destroyCity); both SKIP
    // `_shared`, and an iso CLONE is deliberately NOT _shared, so a clone is a
    // legal door into the shared texture behind it. r128 leaves no flag when a
    // Texture dies, so we leave our own: the death becomes OBSERVABLE (getSet
    // rebuilds, outfitIntegrityAudit counts it) instead of silently emptying
    // every body wearing this outfit key. One closure per outfit, ever.
    const _texDispose = tex.dispose;
    tex.dispose = function () { tex._cbzDead = true; return _texDispose.apply(this, arguments); };
    const m = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5 });
    m._shared = true;                               // clearCityPeds must never dispose it
    m._cbzClothKey = key;                           // the audit's "this is painted cloth" mark
    const set = { mat: m, tex, parts, bodyHex: null, neckHex: null, yoke: null, partsY: parts };
    // ---- READ BACK WHAT WAS ACTUALLY PAINTED (see THE SHOULDER YOKE) --------
    // shoulder patch, well clear of plackets/pockets/the alpha gap, at a row
    // height where shade() contributes nothing — so a suit answers exactly
    // SUIT_STYLES[n].body and the yoke delta is 0, not "close".
    const bodyRow = parts.jacket ? "jacket" : "torso";
    let bodyHex = modalHex(ctx, bodyRow, "front", 0.02, 0.22, 0.32, 0.6);
    if (bodyHex == null) bodyHex = (c.torso != null ? c.torso | 0 : (key.split("|")[1] | 0) || 0x444444);
    // …and the THROAT: whatever the painter put at the top-centre of the torso
    // column is the collar/neckline this garment shows — a white dress shirt, a
    // hood gathered at the neck, a scrub V, a crew band. When the painter
    // DECLARED neckwear (V2), the blade occupies the top-centre from row 0, so
    // the shirt sample steps LEFT of the placket/blade; painters with no
    // declared neckwear keep the exact centre sample (the chef's kerchief IS
    // the neckline and must stay what the yoke wears).
    const neck = neckV2() && parts.neck ? parts.neck : null;
    let neckHex = neck
      ? modalHex(ctx, "torso", "front", 0.3, 0.42, 0, 0.018)
      : modalHex(ctx, "torso", "front", 0.42, 0.58, 0, 0.018);
    if (neckHex == null) neckHex = bodyHex;
    set.bodyHex = bodyHex; set.neckHex = neckHex;
    if (yokePaint()) {
      // parts.yoke: the painter NAMES the collar's cloth when the modal body
      // sample would be the wrong layer (a vest's collar is the shirt under it,
      // a tank has no collar: the band is bare skin)
      const yokeHex = parts.yoke != null ? parts.yoke : bodyHex;
      const cv2 = yokeCanvas(yokeHex, neckHex, !!parts.jacket && !YOKE_NO_LAPEL[kind], neck);
      if (cv2) {
        const yt = new THREE.CanvasTexture(cv2);
        yt.magFilter = THREE.LinearFilter;
        // NO MIPS. The yoke is a 0.18-tall slab, so it is always deep in the mip
        // chain — and at 128x32 with four adjacent face columns, mipping blends
        // the front's neckline into the side and the back. A 16 KB texture costs
        // nothing to sample at level 0 forever.
        yt.generateMipmaps = false;
        yt.minFilter = THREE.LinearFilter;
        const _yd = yt.dispose;
        yt.dispose = function () { yt._cbzDead = true; return _yd.apply(this, arguments); };
        // NO alphaTest here, deliberately: the yoke atlas has no cut regions,
        // and a dead texture on an alphaTest material discards the whole mesh
        // (see THE DEFAULT-LOOK GUARANTEE). A yoke that goes white is a blemish;
        // a yoke that vanishes is a hole in a neck.
        const ym = new THREE.MeshLambertMaterial({ map: yt });
        ym._shared = true;
        ym._cbzClothKey = key + "~yoke";
        set.yoke = { mat: ym, tex: yt, hex: yokeHex };
        set.partsY = Object.assign({}, parts, { collar: 1 });
      }
    }
    return set;
  }

  // a cached set is only worth handing out while it can still paint pixels
  function setAlive(s) {
    if (!s) return true;                            // null = a deliberate "no painted look"
    if (!s.tex || s.tex._cbzDead) return false;
    const img = s.tex.image;
    if (!img || !(img.width > 0) || !(img.height > 0)) return false;
    return !!(s.mat && s.mat.map === s.tex && s.mat.visible !== false);
  }
  let _setsRebuilt = 0;
  CBZ.cityClothesSetsRebuilt = function () { return _setsRebuilt; };
  // atlases refused because their canvas came back dead (see buildSet)
  CBZ.cityClothesDeadCanvases = function () { return _deadCanvases; };
  function getSet(recOrId, ch) {
    const rec = typeof recOrId === "string" ? { id: recOrId } : recOrId;
    const key = keyOf(rec, ch);
    if (!key) return null;
    let s = sets[key];
    if (s === undefined) { s = sets[key] = buildSet(key, rec); }
    // SELF-HEALING CACHE (see THE DEFAULT-LOOK GUARANTEE above). An atlas that
    // stops sampling takes every wearer of its key with it, so the cache checks
    // its own entry rather than trusting that nobody ever disposed it. Two
    // property reads on a path that only runs when a body changes clothes.
    else if (s !== null && outfitGuarantee() && !setAlive(s)) {
      s = buildSet(key, rec); _setsRebuilt++;
      // A REBUILD THAT IS ALSO DEAD MUST NOT BE RETRIED FOREVER — that would
      // allocate a canvas + texture on every dress. Cache the refusal as null,
      // which is already a first-class state here: "this outfit has no painted
      // look", so recolorRig flat-paints the body. THE DEFAULT LOOK, by the
      // path the file already had. One canvas per key, ever, even pathological.
      sets[key] = setAlive(s) ? s : (s = null);
    }
    return s;
  }
  CBZ.cityClothesTex = getSet;

  // ============================================================
  //  CBZ.cityPaintedBodyHex(recOrId, ch) → the hex this record's garment
  //  ACTUALLY paints its torso with, or null when the outfit has no painted
  //  look (the caller keeps its flat colours — degrade-safe by construction).
  //
  //  THE ONE SOURCE. Not a lookup table of painter defaults, not a copy of
  //  SUIT_STYLES: the answer is read off the painted canvas, so it is right for
  //  a suit style that does not exist yet and for a painter nobody has written
  //  yet. Adoption is one line at any site that was reaching for
  //  rec.colors.torso to describe a painted garment:
  //      const hex = (CBZ.cityPaintedBodyHex && CBZ.cityPaintedBodyHex(rec)) || c.torso;
  // ============================================================
  function cityPaintedBodyHex(recOrId, ch) {
    const set = getSet(recOrId, ch);
    return set && set.bodyHex != null ? set.bodyHex : null;
  }
  CBZ.cityPaintedBodyHex = cityPaintedBodyHex;
  // the collar/neckline hex the same garment shows at the throat (what the yoke
  // paints its neck opening with). Same contract, same null.
  CBZ.cityPaintedNeckHex = function (recOrId, ch) {
    const set = getSet(recOrId, ch);
    return set && set.neckHex != null ? set.neckHex : null;
  };

  // ---- UV-remapped part geometries: ONE per part type, shared ---------------
  const geoms = {};
  const FACE_COL = ["side", "side", "cap", "cap", "front", "back"]; // +x -x +y -y +z -z
  // dims/band are optional overrides: two-segment limbs (entities/character.js)
  // tag each segment mesh with its own box size + the vertical BAND of the
  // garment row that segment shows (band [0,1] = whole row = legacy). An upper
  // arm shows ~the top half of the sleeve row; the forearm shows the bottom —
  // so a cuff painted low in the row still lands on the actual wrist.
  function clothGeom(part, dims, band) {
    let d = dims || DIMS[part];
    let b0 = band ? band[0] : 0, b1 = band ? band[1] : 1;
    // A DEGENERATE BOX IS AN INVISIBLE PERSON. clothDims/clothBand are tagged
    // off a PROFILE (character.js stamps every split segment from P.armW /
    // P.legW / P.armUp…, and fitTorso measures the real chest+waist), so a stub
    // rig, a hand-built rig or a profile field that came back 0/NaN hands us an
    // edge with no area — and the wearer loses that whole region while the rest
    // of the body draws. A shirt one size off beats a missing torso, so fall
    // back to the authored part dims and to the whole garment row. On every
    // healthy rig in the game this is a no-op (all four dims are positive and
    // both band ends land in [0,1]), which is why it is safe to leave in the
    // hot path. Gated with the guarantee so the revert is exact.
    if (outfitGuarantee()) {
      if (!d || d.length < 3 || !(d[0] > 0) || !(d[1] > 0) || !(d[2] > 0)) d = DIMS[part];
      if (!(b0 >= 0) || !(b1 > b0)) { b0 = 0; b1 = 1; }
    }
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

  // ---- LOFTED LIMBS (entities/character.js LIMBS) ---------------------------
  // A limb segment is a rounded loft now, not a box. It carries its own shape,
  // so the garment row is handed to it as a PAINTER — the same face column, u
  // direction and band slice clothGeom writes into a box's UVs — and the body
  // bakes (and caches) the painted loft. One painter per (row, band), shared.
  const painters = {};
  function limbPainter(part, band) {
    let b0 = band ? band[0] : 0, b1 = band ? band[1] : 1;
    if (!(b0 >= 0) || !(b1 > b0)) { b0 = 0; b1 = 1; }
    const key = part + "|" + b0.toFixed(3) + "," + b1.toFixed(3);
    let p = painters[key];
    if (p) return p;
    const row = ROWS[part === "jacket" ? "jacket" : part] || ROWS.arm, ry0 = row[0], ry1 = row[1];
    p = painters[key] = {
      key: "cloth:" + key,
      fn: function (face, u, v) {
        const col = COLS[face] || COLS.side, vv = b0 + v * (b1 - b0);
        return [(col[0] + u * (col[1] - col[0])) / W, 1 - (ry1 - vv * (ry1 - ry0)) / H];
      },
    };
    return p;
  }
  /* ---- TAILORING: the FRONT laid out in BODY units ------------------------
     A torso part's front face maps u ACROSS ITS OWN RING, and on the shaped
     body the ring width changes by 2.5x between the neck and the chest (the
     trapezius rings run from the collar out to the shoulder at almost the
     same height). A lapel painted "12% across the face" was 12% of the neck
     at the top and 12% of the chest lower down, and the whole shirt collar +
     tie knot sat behind a 6 cm slit in the jacket's stand collar. A garment
     that declares parts.fp gets its FRONT column addressed by the vertex's
     real body x instead: atlas u = 0.5 + x / (2 XR), XR = the jacket's front
     half-width at the chest line (0.8 (W + the shell offset)), so the front
     of the torso, the jacket shell and the collar band all read ONE
     front-projected layout in the same units, scaled to THIS body (a woman's,
     a child's, a heavy man's chest), and a V cut in it is the V the camera
     sees. Rows (v) stay the box span, whose landmarks measure the same on
     every profile (TAILOR below). Side/back/cap columns are untouched. One
     painter per (row, band, XR): the baked geometry is already one per body
     shape per painter, so the crowd pools do not grow. */
  function tailorXR(ch) {
    const S = ch && ch.torsoShape;
    return S && S.W > 0 ? 0.8 * (S.W + 0.03 * (S.vs || 1)) : 0;
  }
  const fpPainters = {};
  function fpPainter(part, band, xr) {
    let b0 = band ? band[0] : 0, b1 = band ? band[1] : 1;
    if (!(b0 >= 0) || !(b1 > b0)) { b0 = 0; b1 = 1; }
    const key = part + "|" + b0.toFixed(3) + "," + b1.toFixed(3) + "|" + xr.toFixed(4);
    let p = fpPainters[key];
    if (p) return p;
    const row = ROWS[part === "jacket" ? "jacket" : part] || ROWS.torso, ry0 = row[0], ry1 = row[1];
    p = fpPainters[key] = {
      key: "cloth-fp:" + key,
      fn: function (face, u, v, x) {
        if (face === "front" && x != null) u = Math.min(0.996, Math.max(0.004, 0.5 + x / (2 * xr)));
        const col = COLS[face] || COLS.side, vv = b0 + v * (b1 - b0);
        return [(col[0] + u * (col[1] - col[0])) / W, 1 - (ry1 - vv * (ry1 - ry0)) / H];
      },
    };
    return p;
  }
  // …and the collar band (the yoke atlas) in the same front units, magnified
  // YOKE_FP_K so the narrow band front spends its whole column (yokeTailored)
  const fpYokePainters = {};
  function fpYokePainter(xr) {
    const key = xr.toFixed(4);
    let p = fpYokePainters[key];
    if (p) return p;
    p = fpYokePainters[key] = {
      key: "yoke-fp:" + key,
      fn: function (face, u, v, x) {
        if (face === "front" && x != null) u = Math.min(0.996, Math.max(0.004, 0.5 + YOKE_FP_K * x / (2 * xr)));
        const col = YCOLS[face] || YCOLS.side;
        return [(col[0] + u * (col[1] - col[0])) / YW, v];
      },
    };
    return p;
  }

  // a SHAPED body part: a limb loft or a torso part (entities/character.js
  // TORSO block) — both bake the garment row onto their own surface
  function shaped(mesh) { return !!(mesh && mesh.userData && (mesh.userData.limb || mesh.userData.torsoPart)); }
  // the pelvis wears the top sliver of the leg row (where the skirt starts)
  const HIPS_PAINTER = limbPainter("leg", [0.94, 0.995]);
  /* THE SEAT. A garment that declares `seat` has a real pelvis to paint (a
     one-piece's fly and seat pockets, an apron's skirt over the lap), and the
     leg row's 6% sliver gives the pelvis ~2 texels of height: colour only. A
     garment with no jacket shell has the whole JACKET row free, so its pelvis
     wears that row instead, full height: row y 0 = the waistband (pTop), 0.40
     = 5 cm above the hip joint, 0.72 = the fullest point of the seat, 0.85+ =
     the crotch (entities/character.js TORSO block, pelvis box v span; the same
     fractions on every profile and age). One painter, one baked pelvis per
     body shape per atlas, shared like the legs. */
  const SEAT_PAINTER = limbPainter("jacket", null);
  /* THE SHARED PELVIS. A pelvis baked against an outfit's own atlas is one
     crowd pool per (body shape x outfit) — pedinstance keys pools on geometry
     + map, never colour — and dressing every suit's and every jumpsuit's
     pelvis that way pushed the crowd to its 1024-pool cap (half the city
     drew itself unpooled). Their pelvis detail is all ONE cloth in darker
     tones, so it is painted ONCE, in greys, on ONE shared mask atlas, and the
     garment's colour rides the material colour, which the instancer carries
     per instance: one pool per body shape per painter, whatever the outfit.
       jacket rows — THE SEAT's trousers (fly, slash and seat pockets, seams,
                     waistband), ring-relative (SEAT_PAINTER): jumpsuits;
       torso rows tBelt..1 — a tailored jacket's skirt over the pelvis in body
                     units (fpPainter): the quarters open over the fly and the
                     belt, the vent behind.
     A mask value v darkens exactly like tone(hex, v - 1). */
  let pelvisMaskTex;
  const pelvisMats = {};
  function pelvisMask() {
    if (pelvisMaskTex !== undefined) return pelvisMaskTex;
    if (typeof document === "undefined" || !document.createElement) return (pelvisMaskTex = null);
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");
    if (!ctx) return (pelvisMaskTex = null);
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
    const g = (v) => { const n = Math.round(255 * v); return "rgb(" + n + "," + n + "," + n + ")"; };
    const J = rowPainter(ctx, "jacket");
    J.rect("front", 0.49, 0, 0.02, 0.62, g(0.7));                                  // fly
    J.poly("front", [[0.04, 0.04], [0.1, 0.04], [0.22, 0.4], [0.16, 0.4]], g(0.76));   // slash pockets
    J.poly("front", [[0.96, 0.04], [0.9, 0.04], [0.78, 0.4], [0.84, 0.4]], g(0.76));
    J.rect("back", 0.12, 0.1, 0.28, 0.34, g(0.9)); J.rect("back", 0.6, 0.1, 0.28, 0.34, g(0.9));   // seat pockets
    J.rect("back", 0.12, 0.1, 0.28, 0.04, g(0.78)); J.rect("back", 0.6, 0.1, 0.28, 0.04, g(0.78));
    J.rect("back", 0.49, 0, 0.02, 1, g(0.78));                                     // centre-back seam
    J.rect("side", 0.48, 0, 0.04, 1, g(0.78));
    hemBand(J, g(0.84), 0, 0.04);                                                   // waistband
    const T = rowPainter(ctx, "torso"), y0 = TAILOR.tBelt;
    T.rect("back", 0.494, y0 + 0.04, 0.012, 1 - y0 - 0.04, g(0.7));               // the vent
    T.poly("front", fpts([[-0.05, y0], [0.05, y0], [0.1, 1], [-0.1, 1]]), g(0.82));   // the trousers between the quarters
    T.rect("front", fx(-0.004), y0, 0.008, 1 - y0, g(0.6));                         // the fly
    T.rect("front", fx(-0.06), y0, 0.12, 0.03, g(0.3));                             // the belt (or a waistband)
    T.rect("front", fx(-0.02), y0 + 0.006, 0.04, 0.018, g(0.75));
    const tex = new THREE.CanvasTexture(cv);
    tex.magFilter = THREE.LinearFilter;
    tex._shared = true;
    return (pelvisMaskTex = tex);
  }
  function pelvisMat(hex) {
    const key = hex | 0;
    let m = pelvisMats[key];
    if (m && clothMatOk(m)) return m;
    const tex = pelvisMask();
    if (!tex) return null;
    m = new THREE.MeshLambertMaterial({ map: tex, color: key });
    m._shared = true;
    m._cbzClothKey = "pelvis~" + key;
    return (pelvisMats[key] = m);
  }

  function dressHips(list, m, painter) {
    if (!list || !m || !CBZ.humanLimbGeometry) return;
    for (let i = 0; i < list.length; i++) {
      const mesh = list[i];
      if (!mesh || !shaped(mesh)) continue;          // a stub box pelvis keeps its flat tint
      if (!mesh.userData._cbzFlat) mesh.userData._cbzFlat = { g: mesh.geometry, m: mesh.material };
      mesh.geometry = CBZ.humanLimbGeometry(mesh, painter || HIPS_PAINTER);
      mesh.material = m;
      mesh.userData._cbzPart = "hips";
    }
  }
  function limbDressGeom(mesh, part, xr) {
    if (!shaped(mesh) || !CBZ.humanLimbGeometry) return null;
    const band = mesh.userData.clothBand;
    return CBZ.humanLimbGeometry(mesh, xr > 0 && mesh.userData.torsoPart ? fpPainter(part, band, xr) : limbPainter(part, band));
  }

  // ============================================================
  //  DRESS / STRIP — swap part materials+geometry in place; the original
  //  flat geometry+material is saved ONCE per mesh and restored on strip,
  //  so the jail/survival look survives any number of city outfit changes.
  // ============================================================
  function dress(list, part, m, xr) {
    if (!list) return;
    if (outfitGuarantee() && !m) return;             // never hand a mesh a material it can't draw
    for (let i = 0; i < list.length; i++) {
      const mesh = list[i];
      if (!mesh) continue;
      if (!mesh.userData._cbzFlat) mesh.userData._cbzFlat = { g: mesh.geometry, m: mesh.material };
      // split-limb segments carry their own dims + row band (character.js tags);
      // a lofted limb bakes the same row onto its own shape (xr: TAILORING)
      mesh.geometry = limbDressGeom(mesh, part, xr) || clothGeom(part, mesh.userData.clothDims, mesh.userData.clothBand);
      mesh.material = m;
      mesh.userData._cbzPart = part;                 // "this mesh is wearing painted cloth" (audit read)
    }
  }
  // THE YOKE IS DRESSED, NOT TINTED. Same save-once/restore contract as dress()
  // (restore() puts _cbzFlat back and clears _cbzPart), but the geometry comes
  // from the mesh's OWN box — character.js clamps collarW/collarD per profile,
  // so the size is read off the rig instead of copied here and left to drift.
  function dressYoke(list, m, xr) {
    if (!list || !list.length || !m) return false;
    let any = false;
    for (let i = 0; i < list.length; i++) {
      const mesh = list[i];
      if (!mesh) continue;
      // tailored: the band's front in body units, but scaled off the NECK (the
      // band is the neck's part, shared by every physique of a head form —
      // keying it on the chest would split one band geometry per physique and
      // one crowd pool with it). An average chest is 2.53 neck radii wide, so
      // the knot still meets the blade within a few percent on any build.
      const nS = mesh.userData.torsoPart && mesh.userData.torsoPart.S;
      const painter = xr > 0 ? fpYokePainter(nS && nS.nRx > 0 ? 2.53 * nS.nRx : xr) : YOKE_PAINTER;
      const b = boxOf(mesh);
      if (!b) continue;                              // stub rig / no box params → leave it flat
      if (!mesh.userData._cbzFlat) mesh.userData._cbzFlat = { g: mesh.geometry, m: mesh.material };
      // the COLLAR BAND (character.js TORSO block) wears the same four columns
      // round the neck: the knot lands at the throat, the collar stand behind
      mesh.geometry = (mesh.userData.torsoPart && CBZ.humanLimbGeometry && CBZ.humanLimbGeometry(mesh, painter)) || yokeGeom([b.w, b.h, b.d]);
      mesh.material = m;
      mesh.userData._cbzPart = "yoke";
      any = true;
    }
    return any;
  }
  function restore(list) {
    if (!list) return;
    const guard = outfitGuarantee();
    for (let i = 0; i < list.length; i++) {
      const mesh = list[i], f = mesh && mesh.userData._cbzFlat;
      if (!f) continue;
      // _cbzPart is cleared on BOTH paths: outfits.js's paint() now refuses to
      // tint a mesh that still claims to be wearing painted cloth, so a stale
      // tag on a restored (flat) mesh would leave it permanently uncolourable.
      // a lofted limb goes back to its FLAT loft at its CURRENT lod (the saved
      // original may be a different lod by now — character.js setLimbLod)
      const flatLimb = shaped(mesh) && CBZ.humanLimbGeometry ? CBZ.humanLimbGeometry(mesh, null) : null;
      if (!guard) { mesh.geometry = flatLimb || f.g; mesh.material = f.m; mesh.userData._cbzPart = null; continue; }
      // A FLAT ORIGINAL THAT DIED TAKES THE BODY WITH IT. `_cbzFlat` is captured
      // ONCE, at the very first dress, and then held for the whole life of the
      // rig — which is long enough for a teardown sweep to have disposed it, for
      // a graphics-tier swap to have orphaned its Lambert/Standard twin, or for
      // it simply never to have existed on a stub rig. Putting an unrenderable
      // material back on the body IS the owner's bug, so a dead stash falls
      // through to a live flat default instead of onto a person.
      if (flatLimb) mesh.geometry = flatLimb;
      else if (geomOk(f.g)) mesh.geometry = f.g;
      mesh.material = clothMatOk(f.m) ? f.m : defaultFlat(mesh);
      mesh.userData._cbzPart = null;
    }
  }
  // the last-resort cloth material: keep whatever colour the body was reading
  // if it can still be read, else the same mid grey outfits.js's civShirtFor
  // falls back to. Comes off the SHARED cmat cache — no per-rig allocation.
  function defaultFlat(mesh, hex) {
    let c = hex;
    if (c == null) {
      const m = mesh && mesh.material;
      c = (m && m.color && m.color.getHex) ? m.color.getHex() : DEFAULT_CLOTH;
      if (c === 0xffffff) c = DEFAULT_CLOTH;         // a painted material's untouched white base
    }
    return cmat(c);
  }
  // per-rig isolated clone of a shared set material (crowd.js's pooled rigs
  // tint materials in place — give them their OWN instance so a setHex can
  // never bleed onto every other wearer of the outfit). Cached per rig+key.
  function isoMat(ch, key, m) {
    const bank = ch._clothesIso || (ch._clothesIso = {});
    let c = bank[key];
    // A CLONE OUTLIVES THE CACHE ENTRY IT CAME FROM. This bank is per-rig and
    // never cleared, so a clone taken before getSet() rebuilt a dead set still
    // points at the corpse — and being a clone it is NOT `_shared`, which is
    // exactly why the teardown sweeps are allowed to dispose it in the first
    // place. Re-clone whenever it no longer matches the LIVE set material.
    if (!c || (outfitGuarantee() && (c.map !== m.map || !clothMatOk(c)))) {
      c = bank[key] = m.clone();                    // clone shares the texture; _shared not copied → disposable
      c._cbzClothKey = key;
    }
    return c;
  }

  /* FLAT SLEEVES — a painter that returns `sleeves` ("short" | "none") instead
     of `arms`. A tee or a sleeveless dress shows the WEARER's skin below the
     sleeve, and a shared atlas cannot know it (wifebeater/kidtee key their
     atlas on skin for that; a dress in eight colours x every skin tone would
     be dozens of atlases and crowd pools). The flat arm already knows how:
     character.js cuts a flat upper arm at its sleeve line and hangs a bare
     piece below it wearing the FOREARM's material. So: sleeve piece = the
     garment's own painted colour ("none": skin), forearm = this rig's skin.
     Shared cmat materials, pooled by the crowd instancer like any flat limb.
     outfits.js recolorRig leaves arms alone when `sleeves` is declared. */
  function rigSkin(ch) {
    // tattoo.js owns this question once it is loaded (it also reads a hand
    // that wears ink as the skin under it)
    if (CBZ.tattoo && CBZ.tattoo.rigSkin) return CBZ.tattoo.rigSkin(ch);
    const h = ch.skinSlots && ch.skinSlots.hands && ch.skinSlots.hands[0];
    const m = h && h.material;
    // the hands ARE the visible skin (crowd promotion repaints them with the
    // imposter's tone, which is not ch.skinTone) — unless gloved
    if (ch._gloved == null && m && !m.map && m.color && m.color.getHex) return m.color.getHex();
    return ch.skinTone != null ? ch.skinTone : 0xcf9a72;
  }
  function flatSleeves(ch, kind, hex) {
    const s = ch.skinSlots, skin = rigSkin(ch);
    const sleeve = kind === "none" || hex == null ? skin : hex;
    const put = function (list, c) {
      if (list) for (let i = 0; i < list.length; i++) { const m = list[i]; if (m && !m.userData._cbzPart) m.material = cmat(c); }
    };
    put(s.arms, sleeve); put(s.armsLower, skin);
  }

  function applyClothes(ch, rec, opts) {
    if (!ch || !ch.skinSlots) return null;
    fitTorso(ch);                                    // chest+waist → ONE garment column
    const set = rec ? getSet(rec, ch) : null;
    const key = set ? keyOf(typeof rec === "string" ? { id: rec } : rec, ch) : null;
    if (!set) {                                      // no painted look → strip back to flat
      if (ch._clothesKey != null) {
        const s = ch.skinSlots;
        restore(s.torso); restore(s.arms); restore(s.legs); restore(s.pelvis);
        restore(s.armsLower); restore(s.legsLower); restore(s.collar);
        if (ch._jacketMesh) ch._jacketMesh.visible = false;
        if (CBZ.humanSeatBadge && s.badge && s.badge.length) CBZ.humanSeatBadge(ch, 0);   // off the shell, back onto the shirt
        ch._clothesKey = null;
        // …and the MATERIAL memo with it. Behaviourally a no-op today (the
        // "already wearing it" early-out below needs BOTH to match and the key
        // is now null), but leaving a stripped rig pointing at the garment it
        // no longer wears is what lets a repair or a future caller believe a
        // bare body is dressed. The two fields are one fact; clear them together.
        ch._clothesMat = null;
      }
      return null;
    }
    const m = (opts && opts.iso) ? isoMat(ch, key, set.mat) : set.mat;
    const yokeOn = !!(set.yoke && yokePaint());
    const outParts = yokeOn ? set.partsY : set.parts;
    if (ch._clothesKey === key && ch._clothesMat === m) return outParts;    // already wearing it
    const s = ch.skinSlots;
    const xr = set.parts.fp ? tailorXR(ch) : 0;      // TAILORING: front laid out in body units
    dress(s.torso, "torso", m, xr);
    if (set.parts.arms) { dress(s.arms, "arm", m); dress(s.armsLower, "arm", m); }
    else { restore(s.arms); restore(s.armsLower); if (set.parts.sleeves) flatSleeves(ch, set.parts.sleeves, set.bodyHex); }
    if (set.parts.legs) { dress(s.legs, "leg", m); dress(s.legsLower, "leg", m); }
    else { restore(s.legs); restore(s.legsLower); }
    // THE HIPS WEAR THE SKIRT. A dress / one-piece / derived-shorts garment
    // paints its skirt on the leg row, but the pelvis between waist and thighs
    // is flat-tinted c.legs (the trouser colour) by outfits.js — a band of
    // jeans at the hips of every dress. A garment that declares `hips` dresses
    // the pelvis with the TOP of its own leg row, on its own atlas material:
    // no new material, no per-colour geometry (one painted pelvis per body
    // form, shared like the legs), so the crowd pools stay per atlas.
    // A TAILORED JACKET'S SKIRT (formalTorso, THE SKIRT) and a SEAT that names
    // its colour wear THE SHARED PELVIS: a grey mask tinted the garment's colour,
    // one crowd pool per body shape per painter. A seat without a colour (an
    // apron over the lap) still wears its own atlas's jacket row.
    const pv = xr > 0 && set.parts.skirt ? set.parts.skirt : (set.parts.seat && set.parts.seat.hex != null ? set.parts.seat : null);
    const pm = pv ? pelvisMat(pv.hex) : null;
    if (pm) dressHips(s.pelvis, (opts && opts.iso) ? isoMat(ch, "pelvis~" + (pv.hex | 0), pm) : pm,
      pv === set.parts.skirt ? fpPainter("torso", [0, 1 - TAILOR.tBelt], xr) : SEAT_PAINTER);
    else if (set.parts.seat && !set.parts.jacket) dressHips(s.pelvis, m, SEAT_PAINTER);
    else if (set.parts.hips && set.parts.legs) dressHips(s.pelvis, m);
    else restore(s.pelvis);
    // ---- the JACKET SHELL (tux/suit/police): silhouette via one inflated
    //      torso shell, structure via the alpha-cut open-jacket paint ----
    if (set.parts.jacket) {
      const jf = jacketFit(ch);                      // profile-sized shell (see BODY FIT)
      let jm = ch._jacketMesh;
      if (!jm) {
        jm = new THREE.Mesh(clothGeom("jacket", jf && jf.dims), m);
        jm.castShadow = false; jm.receiveShadow = false;
        const t = s.torso && s.torso[0];
        if (t) t.add(jm);                            // rides the CHEST — animates for free
        ch._jacketMesh = jm;
      }
      // torso[0] is only the chest on a body with a waist box, so the shell has
      // to drop half a waist to keep wrapping the whole column (0 for an adult
      // male — his chest IS the column).
      if (jf) jm.position.y = jf.y;
      // A SHELL OF THE BODY, not a box: on a shaped rig the jacket is the torso
      // surface held off it (shoulders, chest, a straight drape below), cut at
      // the old box's hem and open at the neck (character.js humanShellSpec).
      const chestM = s.torso && s.torso[0];
      const spec = jf && chestM && CBZ.humanShellSpec ? CBZ.humanShellSpec(ch, "jacket", {
        y0: chestM.position.y + jf.y - jf.dims[1] / 2, off: 0.03 * ((ch.profile && ch.profile.torsoH) || 0.95) / 0.95,
        box: { w: jf.dims[0], h: jf.dims[1], d: jf.dims[2], y: chestM.position.y + jf.y }, origin: chestM.position.y + jf.y,
      }) : null;
      if (spec) { jm.userData.torsoPart = spec; jm.geometry = CBZ.humanLimbGeometry(jm, xr > 0 ? fpPainter("jacket", null, xr) : limbPainter("jacket", null)); }
      else if (jf) jm.geometry = clothGeom("jacket", jf.dims);
      jm.material = m;
      jm.visible = true;
    } else if (ch._jacketMesh) ch._jacketMesh.visible = false;
    // a c.badge (character.js) sits on the OUTERMOST layer: on the shell when
    // one is on (its clearance), on the shirt when not
    if (CBZ.humanSeatBadge && s.badge && s.badge.length) {
      const P0 = ch.profile;
      CBZ.humanSeatBadge(ch, set.parts.jacket ? 0.03 * ((P0 && P0.torsoH) || 0.95) / 0.95 + 0.006 : 0);
    }
    // ---- the SHOULDER YOKE wears the garment too (see THE SHOULDER YOKE) ----
    // Dressed LAST so a look with no yoke atlas — or the flag turned off —
    // falls back through the ordinary strip path and outfits.js flat-tints it.
    let yoked = false;
    if (yokeOn) yoked = dressYoke(s.collar, (opts && opts.iso) ? isoMat(ch, key + "~yoke", set.yoke.mat) : set.yoke.mat, xr);
    if (!yoked) restore(s.collar);
    ch._clothesKey = key;
    ch._clothesMat = m;
    return yoked ? outParts : set.parts;
  }

  CBZ.applyClothes = applyClothes;       // the character.js opt-in seam
  CBZ.cityApplyClothes = applyClothes;   // city-side name (outfits.js routes here)

  // ============================================================
  //  CBZ.cityClothesRepairRig(ch, colors) → count of meshes rescued
  //
  //  THE FLOOR UNDER EVERY DRESSER. Walk this rig's cloth slots and give a
  //  LIVE flat material + a real box to anything that is currently drawing
  //  nothing. It authors no look and makes no wardrobe decision — it only
  //  guarantees that the region EXISTS, so the ordinary dressing path
  //  (outfits.js recolorRig → applyClothes) has a body to paint. Clearing
  //  `_clothesKey`/`_clothesMat` is what makes the re-dress that follows
  //  actually run: applyClothes short-circuits on "already wearing it", and a
  //  rig that lost its garment is still nominally wearing the key that broke.
  //
  //  `visible` is FORCED on a rescued mesh, and that is safe by census: the
  //  only `.visible=false` writes that touch a rig in this codebase are on the
  //  limb PIVOTS (gore.js severBody / peds.js's explosion dismemberment, both
  //  ch.parts.*) and on ch._jacketMesh — never on a skinSlots mesh. So a
  //  severed limb stays severed and only a genuinely orphaned garment is
  //  brought back.
  // ============================================================
  // [slot, cloth part, wears the LEG colour, may have its box re-synthesised]
  // Only a DRESSABLE slot gets a synthesised box: dress() itself would give
  // that mesh exactly this geometry, so the fallback is the file's own answer.
  // The pelvis and the yoke are only ever dressed on their own shaped parts
  // (dressHips / dressYoke, never a clothGeom box), so a wrong-sized box there would
  // be a worse lie than the broken one — those get their material back only.
  const REPAIR_SLOTS = [
    ["torso", "torso", 0, 1], ["collar", "torso", 0, 0],
    ["arms", "arm", 0, 1], ["armsLower", "arm", 0, 1],
    ["legs", "leg", 1, 1], ["legsLower", "leg", 1, 1], ["pelvis", "leg", 1, 0],
  ];
  // WHERE A GARMENT HANGS, derived from the rig instead of remembered. This is
  // what lets the repair put back a mesh that was taken clean OUT of the scene
  // graph (core/batch.js merges an untagged static mesh and removes the
  // original) — the mesh keeps its LOCAL transform through all of that, so
  // re-adding it to the node it was built under restores it exactly.
  const LIMB_OF = { arms: ["la", "ra"], armsLower: ["la", "ra"], legs: ["ll", "rl"], legsLower: ["ll", "rl"] };
  function repairHost(ch, slot, i) {
    const keys = LIMB_OF[slot];
    if (!keys) return ch.body || ch.group || null;   // torso / yoke / pelvis ride the hip-locked body
    const pivot = ch.parts && ch.parts[keys[i]];
    if (!pivot) return null;
    if (slot === "armsLower" || slot === "legsLower") return (pivot.userData && pivot.userData.low) || null;
    return pivot;
  }
  // ONE definition of "this body has a hole in its clothes", shared by the
  // repair below and by outfits.js's ratchet — so the number the audit reports
  // and the condition the sweep acts on can never disagree.
  function cityClothesBare(ch) {
    if (!ch || !ch.skinSlots) return 0;
    const s = ch.skinSlots;
    let n = 0;
    for (let k = 0; k < REPAIR_SLOTS.length; k++) {
      const list = s[REPAIR_SLOTS[k][0]];
      if (!list) continue;
      for (let i = 0; i < list.length; i++) if (list[i] && !clothMeshRenders(list[i])) n++;
    }
    const jm = ch._jacketMesh;
    if (jm && jm.visible && !clothMatOk(jm.material)) n++;
    return n;
  }
  CBZ.cityClothesBare = cityClothesBare;

  function cityClothesRepairRig(ch, colors) {
    if (!ch || !ch.skinSlots || !outfitGuarantee()) return 0;
    if (!cityClothesBare(ch)) return 0;              // healthy body → never touched
    // UNDRESS FIRST, THROUGH THE ONE STRIP PATH. A rig that lost ONE region is
    // still nominally wearing the outfit key that broke, and half its slots may
    // still carry a live atlas — leaving that state behind would hand the next
    // setLook a painted material to tint (the orange-tux bug). applyClothes(null)
    // is the sanctioned strip and, with the guarantee on, its restore() now
    // refuses to hand a dead flat original back, so this alone rescues most
    // bodies. It also clears _clothesKey, which is what lets the re-dress that
    // follows actually run instead of short-circuiting on "already wearing it".
    if (ch._clothesKey != null) applyClothes(ch, null);
    ch._clothesKey = null; ch._clothesMat = null;
    const s = ch.skinSlots, c = colors || {};
    const torsoHex = c.torso != null ? c.torso : DEFAULT_CLOTH;
    const legHex = c.legs != null ? c.legs : DEFAULT_LEGS;
    let n = 0;
    for (let k = 0; k < REPAIR_SLOTS.length; k++) {
      const row = REPAIR_SLOTS[k], list = s[row[0]];
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        const mesh = list[i];
        if (!mesh || clothMeshRenders(mesh)) continue;
        // BACK ONTO THE SKELETON FIRST — a garment merged out of the graph is
        // not a colour problem, it is a missing limb of the body.
        if (!mesh.parent) {
          const host = repairHost(ch, row[0], i);
          if (host && host.add) host.add(mesh);
        }
        // HAND THE MESH BACK FROM THE INSTANCER FIRST. If pedinstance.js is
        // holding this part on its hide layer, everything below — a live
        // material, a real box, visible=true — still draws nothing, because
        // the layer is what stopped it. Release (never just un-mask): the
        // record has to die with the mask or part()'s `if (!rec.hidden)` can
        // never re-hide the part, and the body would draw twice forever. It
        // re-binds on its own on a later frame, cleanly.
        if (CBZ.pedInstanceRelease) CBZ.pedInstanceRelease(mesh);
        const f = mesh.userData && mesh.userData._cbzFlat;
        if (f && geomOk(f.g)) mesh.geometry = f.g;
        if (shaped(mesh) && CBZ.humanLimbGeometry) mesh.geometry = CBZ.humanLimbGeometry(mesh, null) || mesh.geometry;
        if (row[3] && !geomOk(mesh.geometry)) {
          mesh.geometry = clothGeom(row[1], mesh.userData && mesh.userData.clothDims, mesh.userData && mesh.userData.clothBand);
        }
        if (!clothMatOk(mesh.material)) mesh.material = defaultFlat(mesh, row[2] ? legHex : torsoHex);
        mesh.visible = true;
        mesh.userData._cbzPart = null;
        n++;
      }
    }
    // the shell is a garment too — a dead atlas leaves an open jacket drawing
    // nothing at all, and no jacket is a better look than a hole in a chest.
    const jm = ch._jacketMesh;
    if (jm && jm.visible && !clothMatOk(jm.material)) { jm.visible = false; n++; }
    return n;
  }
  CBZ.cityClothesRepairRig = cityClothesRepairRig;

  // ============================================================
  //  GANG BANDANA — THE one gang headwear. A crew member wears a bandana
  //  tied over the head in the crew's flag colour: entities/headwear.js's
  //  "bandana" (a square fitted to the real skull, knot and two tails at the
  //  back) on the lowest owner, so a cap, a helmet or a warlord's headgear
  //  covers it and it shows again when they come off. bling.js used to draw
  //  a second rag (a 0.68 box ring) for the same crews; it now calls this.
  //  CBZ.cityAttachBandana(ch, hex) — pass null/undefined hex to remove it.
  //  ch._bandana is the worn group (null when bare) so callers can test it.
  // ============================================================
  function cmat(hex) { return CBZ.cmat ? CBZ.cmat(hex) : new THREE.MeshLambertMaterial({ color: hex }); }
  function cityAttachBandana(ch, hex) {
    const HW = CBZ.headwear;
    if (!ch || !HW) return null;
    if (hex == null) {
      HW.wear(ch, null, { owner: "bandana" });
      ch._bandana = null;
      return null;
    }
    ch._bandana = HW.wear(ch, "bandana", { owner: "bandana", color: hex }) || null;
    return ch._bandana;
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
  function tone2(n, amt) {                          // hex-int → hex-int tone (for cmat keys)
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (amt > 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
    else { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
    return ((r | 0) << 16) | ((g | 0) << 8) | (b | 0);
  }
  /* A COMPOSITE IS ONE GARMENT, PAINTED. The closet's pieces (a collared
     shirt, a tie, a bow, a blazer, a bomber) used to be separate box meshes
     parked at the old box chest's coordinates (collar slabs at z 0.24, a
     placket stick, a tie prism) and snapped towards the shaped chest after the
     fact — and a blazer went through a whole painted SUIT, so a "blazer + red
     tie" wore the suit style's own painted tie with the mesh tie on top of it.
     Now the recipe IS the outfit key: PAINT.comp paints the shirt, its collar
     and neckwear, the blazer shell (the suit cut) or the bomber, and the
     trousers, tailored like every formal look. No per-rig meshes, one atlas
     per recipe actually worn. `comp` on a spec says what it adds. */
  const COMP = {};
  function mkCollar(hex) { return { slot: "shirt", drip: 1, color: hex, label: "Collared Shirt", comp: { shirt: hex, collar: 1 } }; }
  function mkBlazer(hex) { return { slot: "jacket", drip: 5, color: hex, label: "Blazer", comp: { blazer: hex } }; }
  function mkTie(hex) { return { slot: "neck", drip: 2, color: hex, label: "Tie", comp: { tie: hex } }; }
  ["white", "navy", "charcoal", "burgundy", "forest", "black", "pink", "royal"].forEach(function (cn) {
    COMP["shirt_" + cn + "_collar"] = mkCollar(NAMED[cn]);
  });
  COMP.shirt_white = { slot: "shirt", drip: 0, color: NAMED.white, label: "White Tee", comp: { shirt: NAMED.white } };
  ["navy", "charcoal", "burgundy", "forest", "black", "tan", "royal"].forEach(function (cn) {
    COMP["blazer_" + cn] = mkBlazer(NAMED[cn]);
  });
  ["navy", "burgundy", "red", "forest", "silver", "royal", "pink", "charcoal"].forEach(function (cn) {
    COMP["tie_" + cn] = mkTie(NAMED[cn]);
  });
  COMP.bowtie_black = { slot: "neck", drip: 2, color: NAMED.black, label: "Bow Tie", comp: { bow: NAMED.black } };
  COMP.pants_white = { slot: "legs", drip: 1, color: NAMED.white, label: "White Pants", legsHex: NAMED.white };
  // (hip-length, ribbed knit collar + cuffs + waistband, front zip)
  COMP.jacket_bomber = { slot: "jacket", drip: 6, color: 0x2b3a4a, label: "Bomber Jacket", comp: { bomber: 0x2b3a4a } };
  COMP.tuxedo = { slot: "outfit", drip: 28, color: 0x16171c, label: "Tuxedo", painted: "tuxedo" };

  // PAINT.comp — the recipe as one tailored garment (see A COMPOSITE IS ONE
  // GARMENT). c: {shirt, legs, collar, tie, bow, blazer, bomber} (-1 = none).
  PAINT.comp = function (P, c) {
    const has = (v) => v != null && v >= 0;
    const shirt = has(c.shirt) ? c.shirt : NAMED.white, legs = has(c.legs) ? c.legs : 0x39414f;
    const tie = has(c.tie) ? c.tie : null, bow = has(c.bow), collar = !!c.collar || tie != null || bow;
    const T = P.T, A = P.A, L = P.L;
    if (has(c.blazer)) {                                            // the suit cut, in the recipe's cloth
      const neck = formalTorso(T, P.J, c.blazer, tone(c.blazer, 0.16), { tie: tie, bow: bow, shirt: shirt, lapelType: "notch", ctx: P.ctx });
      formalLimbs(A, L, c.blazer, legs, false, { ctx: P.ctx, shirt: shirt });
      if (!bow && tie == null) neck.collar = collar ? 1 : 0;
      return { torso: 1, arms: 1, legs: 1, jacket: 1, fp: 1, neck: neck, skirt: { hex: c.blazer } };
    }
    const sc = hx(shirt);
    let neck;
    if (has(c.bomber)) {                                            // zipped over whatever is under it
      const b = c.bomber, rib = tone(b, -0.25), hem = TORSO_ROW.hem;
      T.fill(hx(b));
      T.rect("front", fx(-0.01), 0, 0.02, hem, tone(b, -0.4));      // the zip
      T.poly("front", fpts([[0.12, 0.5], [0.16, 0.34], [0.19, 0.34], [0.15, 0.5]]), tone(b, -0.35));   // slash pockets
      T.poly("front", fpts([[-0.12, 0.5], [-0.16, 0.34], [-0.19, 0.34], [-0.15, 0.5]]), tone(b, -0.35));
      hemBand(T, rib, hem, TORSO_ROW.hemH);
      T.shade();
      A.fill(hx(b));
      for (const col of ["front", "side", "back"]) A.rect(col, 0, 0.9, 1, 0.1, rib);
      A.shade();
      neck = { fp: 1, band: tone2(b, -0.25) };
    } else {
      T.fill(sc);
      if (collar) T.rect("front", fx(-0.012), 0.08, 0.024, TAILOR.tBelt - 0.08, tone(shirt, -0.12));   // placket
      if (tie != null) paintTie(T, tie, TAILOR.tBelt - 0.025, 0);
      else if (bow) paintBow(T, c.bow);
      T.shade();
      A.fill(sc);
      if (collar) for (const col of ["front", "side", "back"]) A.rect(col, 0, 0.93, 1, 0.07, tone(shirt, -0.1));   // the cuff
      A.shade();
      neck = tie != null ? { tie: tie, fp: 1 } : bow ? { bow: c.bow, fp: 1 } : collar ? { fp: 1, collar: 1 } : { fp: 1, band: tone2(shirt, -0.08) };
    }
    L.fill(hx(legs)); L.shade();
    return { torso: 1, arms: 1, legs: 1, fp: 1, neck: neck };
  };
  // the recipe a list of composable ids adds up to (the last piece in a slot wins)
  function compRecipe(items, shirt, legs) {
    const r = { shirt: shirt, legs: legs, collar: 0, tie: -1, bow: -1, blazer: -1, bomber: -1 };
    for (let i = 0; i < items.length; i++) {
      const sp = COMP[items[i]];
      if (!sp) continue;
      if (sp.legsHex != null) r.legs = sp.legsHex;
      if (sp.comp) for (const k in sp.comp) r[k] = sp.comp[k];
    }
    return r;
  }
  const COMP_FIELDS = ["shirt", "legs", "collar", "tie", "bow", "blazer", "bomber"];

  // ============================================================
  //  NEW BUYABLE FULL-LOOKS — each is a PAINTED outfit (painted:"<id>" short-
  //  circuits straight to PAINT.<id>, like the tuxedo). paintRec carries
  //  colors/style to applyClothes.
  // ============================================================
  function paintedLook(visualId, paintId, label, drip, color, paintRec) {
    COMP[visualId] = { slot: "outfit", drip: drip, color: color, label: label, painted: paintId, paintRec: paintRec || null };
  }
  // SUITS: one buyable look per SUIT_STYLES index → painted:"suit", style:N.
  SUIT_STYLES.forEach(function (st, i) {
    paintedLook("suit_" + i, "suit", st.name, st.tux ? 26 : (st.vest ? 18 : 14), st.body,
      { style: i, forcePaint: 1 });
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
  paintedLook("waiter",       "waiter",       "Waiter Set",      7,  0x16171c, null);
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
  // "Floral" was the name of the deleted dot field — see PAINT.sundress. The
  // print is a gingham check now, so the label says so (economy.js:264 carries
  // the same string for the shop row and was renamed with it).
  paintedLook("sundress",     "sundress",     "Gingham Sundress", 6, 0xf0d9a0, { colors: { torso: 0xf0d9a0, collar: 0xd86a8a } });
  paintedLook("sundress_blue","sundress",     "Blue Sundress",   6,  0xbcd6ea, { colors: { torso: 0xbcd6ea, collar: 0x3a6aa0 } });
  // BLOUSES — the everyday womenswear the rack was missing entirely (the only
  // female-read garments on sale were dresses).
  [["blouse_white", 0xeceef0, "White Blouse"], ["blouse_blush", 0xe8c6cc, "Blush Blouse"],
   ["blouse_navy", 0x2b3a5a, "Navy Blouse"], ["blouse_olive", 0x6a7050, "Olive Blouse"]].forEach(function (b) {
    paintedLook(b[0], "blouse", b[2], 4, b[1], { colors: { torso: b[1] } });
  });

  function cityComposableSpec(visualId) { return COMP[visualId] || null; }
  CBZ.cityComposableSpec = cityComposableSpec;

  // ---- apply a composite recipe to a rig (idempotent) ----------------------
  // (a composite adds no meshes any more; the bin stays so a rig dressed by an
  // older build, or a caller that still clears it, is handled)
  function clearComposite(ch) {
    const bin = ch._compMeshes;
    if (bin) for (let i = 0; i < bin.length; i++) {
      const m = bin[i];
      if (m && m.parent) m.parent.remove(m);
    }
    ch._compMeshes = [];
  }
  CBZ.cityClearComposite = clearComposite;
  function cityApplyComposite(ch, comp) {
    if (!ch || !ch.skinSlots || !comp) return false;
    const items = comp.items || [];
    const shirt = comp.shirt != null ? comp.shirt : 0xf2f2f2;
    const legs0 = comp.legs != null ? comp.legs : 0x39414f;
    // a fully-painted special (tuxedo/suit/dress…) short-circuits the whole stack
    let painted = null, paintRec = null, paintedHex = null;
    for (let i = 0; i < items.length; i++) {
      const sp = COMP[items[i]];
      if (!sp || !sp.painted) continue;
      painted = sp.painted; paintRec = sp.paintRec || null;
      paintedHex = (paintRec && paintRec.colors && paintRec.colors.torso != null)
        ? paintRec.colors.torso : (sp.color != null ? sp.color : null);
    }
    clearComposite(ch);
    if (painted) {                                   // e.g. tuxedo → the painted look
      const rec = paintRec ? Object.assign({ id: painted }, paintRec) : { id: painted };
      const pp = applyClothes(ch, rec);
      // ONE SOURCE: ask the atlas what it painted (a suit's static colour field
      // is the catalog navy, not the style's own body).
      const derived = cityPaintedBodyHex(rec, ch);
      if (derived != null) paintedHex = derived;
      // when the wardrobe DRESSES the collar band, do not tint it (a colour on
      // a textured Lambert multiplies the map)
      if (pp && pp.collar) return true;
      // otherwise the band wears the garment's own cloth colour, never the
      // last look's (a white tee's band left round a black hoodie's neck)
      if (paintedHex != null && (!CBZ.CONFIG || CBZ.CONFIG.CITY_YOKE_GARMENT !== false)) {
        const yoke = ch.skinSlots.collar;
        if (CBZ.cityPaintSlot) CBZ.cityPaintSlot(yoke, paintedHex);
        else if (yoke) for (const m of yoke) if (m) CBZ.paintMesh(m, paintedHex);
      }
      return true;
    }
    // THE RECIPE: flat base first (shoes, hands, anything the atlas does not
    // cover), then the recipe as ONE painted garment (PAINT.comp).
    const r = compRecipe(items, shirt, legs0);
    applyClothes(ch, null);
    if (CBZ.cityRecolorRig) CBZ.cityRecolorRig(ch, { torso: r.shirt, arms: r.shirt, legs: r.legs, collar: r.shirt, shoes: 0x2b2b2b }, null);
    else {
      const s = ch.skinSlots, setHex = (list, hex) => { if (list) for (const m of list) if (m) CBZ.paintMesh(m, hex); };
      setHex(s.torso, r.shirt); setHex(s.arms, r.shirt); setHex(s.armsLower, r.shirt); setHex(s.legs, r.legs); setHex(s.legsLower, r.legs); setHex(s.collar, r.shirt);
    }
    applyClothes(ch, { id: "comp", colors: r });
    ch._compRecipe = items.slice();
    return true;
  }

  CBZ.cityApplyComposite = cityApplyComposite;
})();
