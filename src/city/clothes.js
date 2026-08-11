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
  // COMPOSITE items (collar/tie/bow meshes) are authored in the adult-male
  // torso frame (a 0.92 x 0.95 x 0.50 box centred on the origin). On a female
  // or child chest that frame is both smaller AND shifted up, so a tie would
  // float above the collarbone. One scale+offset node puts the authored
  // coordinates back on the body. Adult male → 1,1,1 / 0 (identity).
  function compFrame(ch) {
    const P = ch && ch.profile;
    if (!P || !bodyFit()) return null;
    const sp = torsoSplit(P);
    return {
      sx: P.torsoW / 0.92, sy: sp.colH / 0.95, sz: P.torsoD / 0.50,
      y: -sp.waistH / 2,
    };
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

  // shared formal-wear front: white shirt V + studs/tie + open jacket shell.
  // opts may carry: bow, tie(hex), belt, square, gap, lapel(width), lapelType
  // ('notch'|'peak'|'shawl'), pattern, db(double-breasted), vest(hex|true),
  // vTop (V2 half-opening at the collar), ctx (canvas ctx for pattern
  // overlays). Under CLOTH_FORMAL_NECK_V2 it RETURNS the neckwear record the
  // yoke atlas must draw ({tie,w} / {bow}) — the caller attaches it to its
  // parts return; null (and the exact old paint) when the flag is off.
  function formalTorso(T, J, jacketHex, lapelCss, opts) {
    const jc = hx(jacketHex), shirt = "#f1f2ec", shirtLow = "#dddfd6";
    const ctx = opts.ctx, lt = opts.lapelType || "notch";
    const v2 = neckV2(), db = !!opts.db;
    T.fill(jc);
    // 3-PIECE: the open jacket reveals a buttoned WAISTCOAT, not bare shirt.
    if (opts.vest) {
      const vhex = opts.vest === true ? jacketHex : opts.vest;
      const vest = hx(vhex);
      if (v2) {
        // the reference three-piece: shirt V at the collar, and the TIE runs
        // DOWN THE WAISTCOAT (drawn later, over the buttons) instead of the
        // old jacket-colour wedge that severed it at the chest.
        T.rect("front", 0.28, 0, 0.44, 0.9, vest);                 // vest panel
        T.poly("front", [[0.35, 0], [0.5, 0.32], [0.65, 0]], shirt); // shirt V above the vest
        T.rect("front", 0.49, 0.34, 0.02, 0.5, tone(vhex, -0.25)); // vest button placket
        for (let i = 0; i < 4; i++) T.dot("front", 0.5, 0.4 + i * 0.12, 0.012, tone(vhex, 0.25));
      } else {
        T.rect("front", 0.28, 0, 0.44, 0.9, vest);                 // vest panel
        // narrow shirt sliver + collar above the vest
        T.rect("front", 0.42, 0, 0.16, 0.18, shirt);
        T.rect("front", 0.49, 0.5, 0.02, 0.4, tone(vhex, -0.25)); // vest button placket
        for (let i = 0; i < 4; i++) T.dot("front", 0.5, 0.34 + i * 0.13, 0.012, tone(vhex, 0.25)); // buttons
        T.poly("front", [[0.34, 0], [0.5, 0.34], [0.66, 0]], jc);  // vest V opening (jacket-color gap above buttons)
        T.rect("front", 0.42, 0, 0.16, 0.16, shirt);               // shirt at the very top
      }
    } else {
      // the shirt panel the open jacket reveals (full front — the gap crops it)
      T.rect("front", 0.3, 0, 0.4, 0.84, shirt);
      T.rect("front", 0.47, 0.02, 0.06, 0.82, shirtLow);          // placket seam
    }
    // THE COLLAR LEAVES. A shirt front with no collar is a white strip; two
    // small angled facets at the throat are what make it read as a SHIRT at
    // three metres. Under V2 the collar a camera can SEE lives on the yoke
    // slab (these chest rows hide behind it on every body) — the facets stay
    // for any rig without a yoke slot, and they cost nothing.
    T.poly("front", [[0.395, 0], [0.5, 0.105], [0.452, 0.012]], shirtLow);
    T.poly("front", [[0.605, 0], [0.5, 0.105], [0.548, 0.012]], shirtLow);
    if (opts.bow) {
      if (!v2) {                                                   // black bow tie at the collar line
        T.rect("front", 0.38, 0.025, 0.24, 0.085, "#0b0c10");      // (V2 draws the bow on the yoke —
        T.rect("front", 0.465, 0.035, 0.07, 0.065, "#15161c");     //  this chest bow was behind the slab)
      }
      T.dot("front", 0.5, 0.21, 0.018, "#15161a");                // stud dots
      T.dot("front", 0.5, 0.33, 0.018, "#15161a");
      T.dot("front", 0.5, 0.45, 0.018, "#15161a");
    } else if (opts.tie && !opts.vest) {
      if (v2) {
        // BLADE ONLY — the knot lives on the yoke (the slab IS the collar
        // zone). Starting at row 0 keeps the blade continuous under the slab
        // on every body profile, so it emerges below the seam with no gap.
        T.rect("front", 0.455, 0, 0.09, 0.58, hx(opts.tie));
        T.poly("front", [[0.455, 0.58], [0.545, 0.58], [0.5, 0.68]], hx(opts.tie)); // pointed tip at the button stance
      } else {
        // THE KNOT IS THE READ. It is wider than the blade and a shade darker,
        // with a dimple under it: three flat values, no gradient, still a tie
        // when the body is 3 m away and 40 px tall.
        T.poly("front", [[0.43, 0.015], [0.57, 0.015], [0.545, 0.115], [0.455, 0.115]], tone(opts.tie, -0.3));
        T.rect("front", 0.487, 0.052, 0.026, 0.05, tone(opts.tie, -0.5));   // the dimple
        T.rect("front", 0.455, 0.11, 0.09, 0.5, hx(opts.tie));              // blade
        T.rect("front", 0.455, 0.11, 0.09, 0.02, tone(opts.tie, 0.2));      // fold catches the light
        T.poly("front", [[0.455, 0.61], [0.545, 0.61], [0.5, 0.7]], hx(opts.tie));  // pointed tip
      }
    } else if (opts.tie && opts.vest) {
      if (v2) {                                                    // the tie lies ON the waistcoat (ref look)
        T.rect("front", 0.455, 0, 0.09, 0.4, hx(opts.tie));
        T.poly("front", [[0.455, 0.4], [0.545, 0.4], [0.5, 0.48]], hx(opts.tie));
      } else T.rect("front", 0.47, 0.04, 0.06, 0.22, hx(opts.tie)); // a glimpse of tie at the vest V
    }
    if (!opts.belt && !opts.vest) T.rect("front", 0.3, 0.78, 0.4, 0.1, "#0d0e12"); // tux cummerbund break
    if (ctx) patternRow(T, ctx, jacketHex, opts.pattern);
    T.shade();
    // ---- the OPEN JACKET shell: alpha-cut V gap + satin lapel wedges ----
    J.fill(jc);
    J.clear("cap", 0, 0, 1, 1);                                    // open top/bottom — see the shirt inside
    if (v2) {
      // THE REFERENCE V: wide open at the collar, converging to the fastened
      // button — the reverse of the old cut, and the whole reason a collar
      // and a knot can now read through it. Single-breasted keeps a relaxed
      // slit below the button; a double-breasted front fastens FLAT.
      const tw = opts.vTop != null ? opts.vTop : 0.115;             // half-opening at the collar
      const bw = db ? 0.012 : 0.03;                                 // half-opening at the button stance
      const yb = db ? 0.52 : (opts.bow || opts.vest ? 0.68 : 0.62); // where the front fastens
      const hw = 0.05;                                              // the relaxed slit below (sb only)
      if (db) J.clearPoly("front", [[0.5 - tw, 0], [0.5 + tw, 0], [0.5 + bw, yb], [0.5 - bw, yb]]);
      else J.clearPoly("front", [[0.5 - tw, 0], [0.5 + tw, 0], [0.5 + bw, yb], [0.5 + hw, 1], [0.5 - hw, 1], [0.5 - bw, yb]]);
      // lapels run ALONGSIDE the V from the shoulder line to the fastening,
      // with a rolled kink just above the button.
      const lwT = lt === "notch" ? 0.12 : lt === "peak" ? 0.14 : 0.15;
      const lwB = 0.05;
      const xit = 0.5 - tw, xot = xit - lwT, xib = 0.5 - bw, xob = xib - lwB, yk = yb - 0.12;
      const mirror = (pts) => pts.map((p) => [1 - p[0], p[1]]);
      if (lt === "shawl") {
        // one continuous facet, outer edge bowed outward, and NO notch at all
        // — which is exactly what makes a shawl read as a shawl.
        const shl = [[xot, 0], [xit, 0], [xib, yb], [xob - 0.012, yk - 0.03], [xot - 0.014, 0.34]];
        J.poly("front", shl, lapelCss);
        J.poly("front", mirror(shl), lapelCss);
      } else {
        const lap = [[xot, 0], [xit, 0], [xib, yb], [xob, yk]];
        J.poly("front", lap, lapelCss);
        J.poly("front", mirror(lap), lapelCss);
        if (lt === "peak") {
          // the peak sweeps UP AND OUT past the collar line
          const pk = [[xit - lwT * 0.25, 0.055], [xot - 0.055, 0.02], [xot - 0.02, 0.16]];
          J.poly("front", pk, lapelCss);
          J.poly("front", mirror(pk), lapelCss);
        } else {
          // THE NOTCH — the step where collar meets lapel, cut back out in
          // jacket colour, high on the chest where a real gorge sits.
          const ny = 0.11, xe = xot + (xob - xot) * (ny / yk);
          const nc = [[xe - 0.014, ny - 0.065], [xe + lwT * 0.5, ny + 0.005], [xe - 0.014, ny + 0.075]];
          J.poly("front", nc, jc);
          J.poly("front", mirror(nc), jc);
        }
      }
      if (opts.satin) {
        // SATIN FACING — one lighter strip down the fold of the lapel; still
        // the only distance-read difference between a tuxedo and a black suit.
        const sc = tone(jacketHex, 0.34);
        const st = [[xit - lwT * 0.45, 0], [xit, 0], [xib, yb], [xob + lwB * 0.45, yk - 0.02]];
        J.poly("front", st, sc);
        J.poly("front", mirror(st), sc);
      }
      if (db) {                                                    // six buttons on the flat wrap + its edge seam
        for (let i = 0; i < 3; i++) {
          J.dot("front", 0.4, 0.4 + i * 0.16, 0.018, lapelCss);
          J.dot("front", 0.6, 0.4 + i * 0.16, 0.018, lapelCss);
        }
        J.rect("front", 0.615, yb, 0.012, 1 - yb, tone(jacketHex, -0.2));
      } else if (opts.bow) {                                       // dinner jacket: the one-button stance
        J.dot("front", 0.5 + hw + 0.028, yb + 0.06, 0.02, tone(jacketHex, -0.45));
      } else {                                                     // the two-button stance, below the V point
        J.dot("front", 0.5 + hw + 0.028, yb + 0.05, 0.02, tone(jacketHex, -0.45));
        J.dot("front", 0.5 + hw + 0.028, yb + 0.17, 0.02, tone(jacketHex, -0.45));
      }
    } else {
    const g = opts.gap || 0.13;                                    // half-width of the gap at the hem
    const overlap = db ? 0.07 : 0.035;                             // double-breasted = wider overlap
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
    if (opts.satin) {
      // SATIN FACING — one lighter strip down the fold of the lapel. At any
      // distance the game actually shows a person at, this strip IS the only
      // difference between a tuxedo and a black suit, so it is worth 2 polys.
      const sc = tone(jacketHex, 0.34);
      J.poly("front", [[0.5 - overlap - lw * 0.5, 0], [0.5 - overlap, 0], [0.5 - g + 0.008, 0.47], [0.5 - g - 0.03, 0.43]], sc);
      J.poly("front", [[0.5 + overlap, 0], [0.5 + overlap + lw * 0.5, 0], [0.5 + g + 0.03, 0.43], [0.5 + g - 0.008, 0.47]], sc);
    }
    // THE NOTCH is the whole reason a notch lapel is called one: the STEP where
    // the collar ends and the lapel begins. Cut it back out of the wedge in
    // jacket colour. A peak carries the same cut higher and sharper; a shawl
    // has none at all, which is exactly what makes a shawl read as a shawl.
    if (lt !== "shawl") {
      const ny = lt === "peak" ? 0.1 : 0.17, ox = 0.5 - overlap - lw, oy = 0.09;
      J.poly("front", [[ox - 0.012, ny - oy], [ox + lw * 0.6, ny], [ox - 0.012, ny + oy]], jc);
      J.poly("front", [[1 - ox + 0.012, ny - oy], [1 - ox - lw * 0.6, ny], [1 - ox + 0.012, ny + oy]], jc);
    }
    if (db) {                                                      // a second column of buttons
      for (let i = 0; i < 3; i++) { J.dot("front", 0.5 - g + 0.03, 0.4 + i * 0.16, 0.018, lapelCss); J.dot("front", 0.5 + g - 0.03, 0.4 + i * 0.16, 0.018, lapelCss); }
    } else {                                                       // single-breasted: the two-button stance
      J.dot("front", 0.5 + g - 0.025, 0.5, 0.02, tone(jacketHex, -0.45));
      J.dot("front", 0.5 + g - 0.025, 0.66, 0.02, tone(jacketHex, -0.45));
    }
    }
    // A JACKET HAS POCKETS, and a welt is one dark line — the cheapest possible
    // structure and the one that survives mipping. Breast welt high on the
    // chest, two hip welts at the hem, both clear of the alpha-cut gap.
    J.rect("front", 0.15, 0.26, 0.15, 0.035, tone(jacketHex, -0.34));
    J.rect("front", 0.08, 0.7, 0.2, 0.04, tone(jacketHex, -0.34));
    J.rect("front", 0.72, 0.7, 0.2, 0.04, tone(jacketHex, -0.34));
    J.rect("side", 0, 0, 1, 0.07, tone(jacketHex, -0.16));         // shoulder seam
    J.rect("back", 0, 0, 1, 0.09, tone(jacketHex, -0.16));         // back collar band
    J.rect("back", 0.2, 0.42, 0.6, 0.025, tone(jacketHex, -0.12)); // back yoke seam
    // VENTS: a double-breasted coat is side-vented, everything else centre.
    if (db) {
      J.rect("back", 0.24, 0.55, 0.05, 0.45, tone(jacketHex, -0.25));
      J.rect("back", 0.71, 0.55, 0.05, 0.45, tone(jacketHex, -0.25));
    } else J.rect("back", 0.47, 0.55, 0.06, 0.45, tone(jacketHex, -0.25));
    if (opts.square) J.rect("front", 0.16, 0.21, 0.12, 0.04, "#f1f2ec"); // square sits ON the welt
    if (ctx) patternRow(J, ctx, jacketHex, opts.pattern);
    J.shade();
    // V2: hand the caller the neckwear the YOKE must now draw (the collar zone
    // is the slab's, not the chest's). Flag off → null → old yoke, old paint.
    if (!v2) return null;
    if (opts.bow) return { bow: 0x0b0c10 };
    return opts.tie != null ? { tie: opts.tie | 0, w: 0.09 } : null;
  }
  function formalLimbs(A, L, jacketHex, legHex, cuff, opts) {
    opts = opts || {};
    const jc = hx(jacketHex), ctx = opts.ctx;
    A.fill(jc);
    A.rect("front", 0, 0, 1, 0.07, tone(jacketHex, -0.16));        // the shoulder seam runs onto the sleeve head
    A.rect("side", 0, 0, 1, 0.07, tone(jacketHex, -0.16));
    if (cuff) { A.rect("front", 0, 0.86, 1, 0.07, "#f1f2ec"); A.rect("side", 0, 0.86, 1, 0.07, "#f1f2ec"); A.rect("back", 0, 0.86, 1, 0.07, "#e3e4dc"); }
    // surgeon's cuff: three buttons, not one. Three small marks in a column is
    // a tailoring signal a single dot cannot carry.
    for (let i = 0; i < 3; i++) A.dot("front", 0.8, 0.74 + i * 0.06, 0.028, tone(jacketHex, -0.4));
    if (ctx) patternRow(A, ctx, jacketHex, opts.pattern);
    A.shade();
    L.fill(hx(legHex));
    L.rect("front", 0.46, 0, 0.08, 0.94, tone(legHex, 0.18));      // sharp crease line
    if (opts.stripe) {                                             // the tuxedo's satin braid down the outseam
      L.rect("side", 0.4, 0, 0.2, 0.94, tone(legHex, 0.32));
      L.rect("side", 0.46, 0, 0.08, 0.94, tone(legHex, 0.5));
    }
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
    const nk = formalTorso(P.T, P.J, body, lapel, { bow: true, square: true, satin: st.satin !== false, gap: 0.12, lapel: 0.15, lapelType: st.lapel || "shawl", db: !!st.db, ctx: P.ctx, pattern: st.pattern });
    formalLimbs(P.A, P.L, body, st.legs != null ? st.legs : 0x14151a, true, { ctx: P.ctx, pattern: st.pattern, stripe: true });
    const parts = { torso: 1, arms: 1, legs: 1, jacket: 1 };
    if (nk) parts.neck = nk;
    return parts;
  };
  // suit accepts a STYLE record (SUIT_STYLES entry) OR a raw colors record. The
  // style drives pattern/db/vest/lapel/tie; raw {torso,legs} still works.
  PAINT.suit = function (P, c, st) {
    if (typeof st === "number") st = { tie: st };                  // legacy: a bare tie hex
    st = st || {};
    const body = st.body != null ? st.body : (c && c.torso != null ? c.torso : 0x1c2030);
    const legs = st.legs != null ? st.legs : ((c && c.legs != null) ? c.legs : tone2(body, -0.08));
    const lapelCss = st.lapelCss || tone(body, st.pattern && st.pattern !== "solid" ? 0.1 : 0.16);
    const nk = formalTorso(P.T, P.J, body, lapelCss, {
      tie: st.tie != null ? st.tie : 0x7a1f2b, belt: !st.vest && !st.db, gap: st.db ? 0.13 : 0.1,
      lapel: st.lapel === "peak" ? 0.12 : 0.09, lapelType: st.lapel || "notch",
      pattern: st.pattern, db: !!st.db, vest: st.vest, ctx: P.ctx,
      // a pocket square is a DRESSIER stance, so the styles that already carry
      // one (waistcoat, double-breasted, shawl dinner jacket) get it without
      // twenty-two table edits; an explicit st.square still wins either way.
      square: st.square != null ? !!st.square : (!!st.vest || !!st.db || st.lapel === "shawl"),
    });
    formalLimbs(P.A, P.L, body, legs, false, { ctx: P.ctx, pattern: st.pattern });
    const parts = { torso: 1, arms: 1, legs: 1, jacket: 1 };
    if (nk) parts.neck = nk;
    return parts;
  };

  PAINT.police = function (P, c) {
    const uni = (c && c.torso != null) ? c.torso : 0x24407a, uc = hx(uni);
    const shirt = tone(uni, 0.3), T = P.T, J = P.J, A = P.A, L = P.L;
    // torso = the SHIRT layer (shows through the duty jacket's open front)
    T.fill(uc);
    T.rect("front", 0.3, 0, 0.4, 0.86, shirt);
    if (neckV2()) T.rect("front", 0.47, 0, 0.06, 0.62, hx(0x16264a)); // dark tie — blade from row 0, knot on the yoke
    else T.rect("front", 0.47, 0.02, 0.06, 0.6, hx(0x16264a));     // dark tie
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
    J.rect("side", 0.15, 0.78, 0.7, 0.2, "#15181f");               // holster block at the hip
    J.shade();
    A.fill(uc);
    A.rect("front", 0.2, 0.05, 0.6, 0.2, tone(uni, -0.3));         // shoulder patch
    A.rect("front", 0.2, 0.05, 0.6, 0.035, "#e8c454");             //   gold border
    A.rect("side", 0.2, 0.05, 0.6, 0.2, tone(uni, -0.3));
    A.shade();
    L.fill(hx((c && c.legs != null) ? c.legs : 0x1b2a44));
    L.rect("side", 0.35, 0, 0.3, 1, tone(uni, -0.35));             // trouser side stripe
    L.shade();
    const parts = { torso: 1, arms: 1, legs: 1, jacket: 1 };
    if (neckV2()) parts.neck = { tie: 0x16264a, w: 0.06 };
    return parts;
  };

  PAINT.swat = function (P, c) {
    // SWAT REDESIGN — police-parity detail. Two-tone: graphite fatigues under a
    // dark-OLIVE plate carrier painted on the inflated JACKET shell (the same
    // silhouette trick the police duty jacket uses), so a SWAT reads as a
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
    // ---- torso = the uniform SHIRT + duty belt under the carrier ----
    T.fill(fc);
    T.rect("front", 0.46, 0, 0.08, 0.3, tone(fat, -0.35));          // zip placket
    T.rect("back", 0, 0.84, 1, 0.16, "#101218");
    T.rect("side", 0, 0.84, 1, 0.16, "#101218");
    T.rect("side", 0.15, 0.76, 0.7, 0.22, "#15181f");               // holster block at the hip
    T.rect("front", 0.08, 0.86, 0.14, 0.11, "#1a1d24");             // cuff case
    T.rect("front", 0.74, 0.86, 0.15, 0.11, "#1a1d24");             // spare-mag case
    T.shade();
    // ---- the PLATE CARRIER rides the jacket shell (real bulk) ----
    J.fill(cc);
    J.clear("cap", 0, 0, 1, 1);
    J.clear("front", 0, 0.76, 1, 0.24);                             // carrier hem — shirt + belt show below
    J.clear("back", 0, 0.76, 1, 0.24);
    J.clear("side", 0, 0.76, 1, 0.24);
    J.rect("front", 0.18, 0.14, 0.64, 0.48, plate);                 // chest plate bag (raised tone)
    J.rect("front", 0.18, 0.14, 0.64, 0.035, strap);                //   plate-bag top seam
    J.rect("front", 0.3, 0.045, 0.4, 0.085, "#e9e7db");             // "SWAT" placard (front)
    J.rect("back", 0.24, 0.08, 0.52, 0.13, "#e9e7db");              // "SWAT" placard (back)
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
    if (ctx && ctx.fillText) {
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
    // ---- legs: subtle camo tone break + knee-pad blocks + thigh rig ----
    L.fill(fc);
    L.rect("front", 0, 0.1, 1, 0.14, tone(fat, 0.08));              // camo-ish tone break
    L.rect("front", 0.42, 0.26, 0.58, 0.1, tone(fat, -0.14));
    L.rect("back", 0, 0.14, 1, 0.16, tone(fat, 0.08));
    L.rect("side", 0, 0.18, 1, 0.12, tone(fat, -0.14));
    L.rect("side", 0.2, 0.36, 0.6, 0.26, "#1d2026");                // thigh rig
    L.rect("side", 0.2, 0.36, 0.6, 0.05, strap);
    L.rect("front", 0.14, 0.46, 0.72, 0.2, "#23262c");              // knee-pad block
    L.rect("front", 0.22, 0.5, 0.56, 0.11, "#31353d");              //   pad face
    L.rect("front", 0, 0.92, 1, 0.08, tone(fat, -0.35));            // boot break
    L.rect("side", 0, 0.92, 1, 0.08, tone(fat, -0.35));
    L.shade();
    return { torso: 1, arms: 1, legs: 1, jacket: 1 };
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

  // Construction has its own vest grammar. It used to borrow PAINT.hivis,
  // whose two short shoulder tabs read like white chest buttons when site
  // orange was substituted for dock yellow. Keep the dock outfit intact and
  // paint the familiar Class 2 vest over a navy work shirt: long shoulder
  // reflectors joined by two uninterrupted waist bands.
  PAINT.construction = function (P, c) {
    const vest = (c && c.torso != null) ? c.torso : 0xff5f08;
    const shirt = (c && c.arms != null) ? c.arms : 0x1d3352;
    const denim = (c && c.legs != null) ? c.legs : 0x2e4a6b;
    const silver = (c && c.collar != null) ? hx(c.collar) : "#bfc6c5";
    const bright = "#e5e9e6", seam = tone(vest, -0.30);
    const T = P.T, A = P.A, L = P.L;

    T.fill(hx(vest));
    // Deep front opening exposes the navy polo instead of a pair of square
    // tabs. The back stays fully orange like the reference vest.
    T.poly("front", [[0.29, 0], [0.71, 0], [0.5, 0.34]], hx(shirt));
    T.poly("front", [[0.36, 0], [0.64, 0], [0.5, 0.20]], tone(shirt, -0.18));

    // Two continuous shoulder reflectors. A brighter inset gives the broad
    // bands a reflective centre without breaking them into little patches.
    for (const col of ["front", "back"]) {
      for (const x of [0.12, 0.76]) {
        T.rect(col, x, 0.03, 0.12, 0.54, silver);
        T.rect(col, x + 0.025, 0.03, 0.07, 0.54, bright);
      }
    }
    // The two waist bands run around every face as one unbroken safety read.
    for (const y of [0.52, 0.72]) for (const col of ["front", "back", "side"]) {
      T.rect(col, 0, y, 1, 0.11, silver);
      T.rect(col, 0, y + 0.025, 1, 0.06, bright);
    }
    T.rect("front", 0.487, 0.30, 0.026, 0.70, seam);               // vest zip
    T.rect("front", 0.10, 0.86, 0.30, 0.10, tone(vest, -0.14));    // low pockets
    T.rect("front", 0.60, 0.86, 0.30, 0.10, tone(vest, -0.14));
    T.shade();

    A.fill(hx(shirt));
    A.rect("front", 0, 0.84, 1, 0.08, tone(shirt, -0.24));
    A.rect("side", 0, 0.84, 1, 0.08, tone(shirt, -0.24));
    A.shade();

    L.fill(hx(denim));
    L.rect("side", 0.44, 0, 0.12, 1, tone(denim, -0.20));
    L.rect("front", 0.16, 0.45, 0.68, 0.13, tone(denim, -0.12));
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
    if (neckV2()) {
      // knot on the yoke (the visible collar zone); the blade starts at row 0
      // so it runs continuously under the slab and out below it.
      T.rect("front", 0.47, 0, 0.06, 0.66, hx(tieHex));
      T.poly("front", [[0.47, 0.66], [0.53, 0.66], [0.5, 0.74]], hx(tieHex));
    } else {
      T.poly("front", [[0.45, 0.02], [0.55, 0.02], [0.53, 0.1], [0.47, 0.1]], tone(tieHex, -0.2)); // tie knot
      T.rect("front", 0.47, 0.1, 0.06, 0.56, hx(tieHex));                      // tie body
      T.poly("front", [[0.47, 0.66], [0.53, 0.66], [0.5, 0.74]], hx(tieHex));
    }
    T.shade();
    A.fill(sc); A.rect("front", 0, 0.88, 1, 0.06, tone(shirt, -0.18)); A.rect("side", 0, 0.88, 1, 0.06, tone(shirt, -0.18)); A.shade();
    const parts = { torso: 1, arms: 1 };
    if (neckV2()) parts.neck = { tie: tieHex, w: 0.06 };
    return parts;
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
    // The torso is one rectangular solid; exposing its entire top band as skin
    // creates a broad flesh-coloured shelf around the neck. Keep that solid
    // fabric and cut only a compact neckline into the front/back. Bare skin is
    // already represented by the actual arm geometry below.
    T.fill(wc);
    T.poly("front", [[0.36, 0], [0.64, 0], [0.5, 0.22]], sk);
    T.poly("back", [[0.39, 0], [0.61, 0], [0.5, 0.14]], sk);
    // ribbed texture: thin vertical lines through the fabric only
    for (const col of ["front", "back", "side"]) for (let x = 0.08; x < 1; x += 0.11) T.rect(col, x, 0.24, 0.014, 0.66, rib);
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

  // ============================================================
  //  MONEY FITS — the three boutique looks that had NO painter at all and so
  //  rendered as one flat tint per region: leather, designer, tactical. A $520
  //  jacket drawn as a solid brown box is the same failure as the collar slab —
  //  geometry with no garment on it. Every colour is read from the CAT record
  //  (city/outfits.js) so the record and the paint keep ONE source; nothing
  //  here invents a hex the wardrobe cannot see.
  // ============================================================

  // LEATHER — a moto jacket with real bulk. The SHELL carries the asymmetric
  // zip, the revers and the panel seams; the torso beneath is the tee it hangs
  // open over, so the alpha-cut front shows cloth and never a hole.
  PAINT.leather = function (P, c) {
    const hide = (c && c.torso != null) ? c.torso : 0x241c18;
    const trim = (c && c.collar != null) ? c.collar : tone2(hide, -0.4);
    const T = P.T, J = P.J, A = P.A, L = P.L;
    const hc = hx(hide), seam = tone(hide, -0.36), edge = tone(hide, 0.2), zip = "#b9bdc4";
    const tee = tone2(hide, 0.52);                                  // the shirt under it, derived off the hide
    T.fill(hx(tee));
    T.poly("front", [[0.36, 0], [0.64, 0], [0.5, 0.12]], tone(tee, -0.24));   // crew neck
    T.rect("front", 0, 0.93, 1, 0.07, tone(tee, -0.2));             // tee hem
    T.shade();
    J.fill(hc);
    J.clear("cap", 0, 0, 1, 1);
    J.clearPoly("front", [[0.47, 0], [0.53, 0], [0.56, 1], [0.44, 1]]);       // it hangs a little open
    J.rect("front", 0, 0, 1, 0.1, hx(trim));                        // stand collar, all the way round
    J.rect("back", 0, 0, 1, 0.1, hx(trim));
    J.rect("side", 0, 0, 1, 0.1, hx(trim));
    // THE ASYMMETRIC ZIP is the moto read: the storm flap runs OFF centre.
    J.rect("front", 0.57, 0.08, 0.1, 0.86, tone(hide, 0.12));
    J.rect("front", 0.598, 0.1, 0.035, 0.82, zip);
    J.dot("front", 0.615, 0.13, 0.03, "#e2e6ea");                   // zip pull
    J.poly("front", [[0.26, 0], [0.42, 0], [0.44, 0.34], [0.22, 0.28]], edge);  // revers L
    J.poly("front", [[0.68, 0], [0.82, 0], [0.84, 0.28], [0.66, 0.34]], edge);  // revers R
    J.rect("front", 0.12, 0.6, 0.2, 0.045, seam);                   // slanted zip pockets
    J.rect("front", 0.74, 0.6, 0.18, 0.045, seam);
    for (const col of ["front", "back", "side"]) J.rect(col, 0, 0.84, 1, 0.07, tone(hide, -0.2)); // waist band
    J.rect("back", 0.15, 0.28, 0.7, 0.03, seam);                    // back yoke seam
    J.shade();
    A.fill(hc);
    A.rect("front", 0, 0.4, 1, 0.03, seam); A.rect("side", 0, 0.4, 1, 0.03, seam);   // elbow panel seam
    A.rect("front", 0, 0.56, 1, 0.03, seam); A.rect("side", 0, 0.56, 1, 0.03, seam);
    A.rect("front", 0, 0.88, 1, 0.08, tone(hide, -0.22));           // cuff
    A.rect("front", 0.7, 0.88, 0.14, 0.08, zip);                    // cuff zip
    A.shade();
    L.fill(hx((c && c.legs != null) ? c.legs : 0x23262e));
    L.rect("front", 0, 0.92, 1, 0.08, tone((c && c.legs != null) ? c.legs : 0x23262e, -0.32)); // boot break
    L.shade();
    return { torso: 1, arms: 1, legs: 1, jacket: 1 };
  };

  // DESIGNER — the statement piece. A two-tone luxe jacket: the house colour on
  // the body, a METAL trim running the collar, the placket and the hem, cream
  // trousers with the same braid down the outseam. No logo anywhere — the read
  // is the colour block and the trim line, which is what actually survives a
  // 128px canvas (a wordmark would be four grey pixels).
  PAINT.designer = function (P, c) {
    const body = (c && c.torso != null) ? c.torso : 0x7a3df0;
    const gold = (c && c.collar != null) ? c.collar : 0xffd451;
    const legHex = (c && c.legs != null) ? c.legs : 0xe9e4da;
    const T = P.T, J = P.J, A = P.A, L = P.L;
    const bc = hx(body), gc = hx(gold), lo = tone(body, -0.3), hi = tone(body, 0.22);
    const shirt = tone2(legHex, 0.1);                               // the shirt matches the trouser cream
    T.fill(hx(shirt));
    T.poly("front", [[0.34, 0], [0.5, 0.2], [0.66, 0]], tone(shirt, -0.22));  // deep open neckline
    T.rect("front", 0.49, 0.18, 0.02, 0.62, tone(shirt, -0.16));    // placket seam
    T.rect("front", 0, 0.92, 1, 0.08, tone(shirt, -0.2));
    T.shade();
    J.fill(bc);
    J.clear("cap", 0, 0, 1, 1);
    J.clearPoly("front", [[0.45, 0], [0.55, 0], [0.62, 1], [0.38, 1]]);       // worn open
    // the two-tone break: the lower third of the coat is the deeper tone, and
    // the trim line rides the seam between them all the way round.
    for (const col of ["front", "back", "side"]) {
      J.rect(col, 0, 0.6, 1, 0.4, lo);
      J.rect(col, 0, 0.585, 1, 0.03, gc);
      J.rect(col, 0, 0, 1, 0.08, hi);                               // shoulder highlight
    }
    J.poly("front", [[0.3, 0], [0.45, 0], [0.5, 0.5], [0.28, 0.42]], gc);     // metal-trim lapel L
    J.poly("front", [[0.55, 0], [0.7, 0], [0.72, 0.42], [0.5, 0.5]], gc);     // metal-trim lapel R
    J.rect("front", 0.1, 0.66, 0.18, 0.05, gc);                     // trimmed pocket welts
    J.rect("front", 0.72, 0.66, 0.18, 0.05, gc);
    J.rect("back", 0, 0, 1, 0.09, gc);                              // trimmed back collar
    J.shade();
    A.fill(bc);
    A.rect("front", 0, 0, 1, 0.08, hi); A.rect("side", 0, 0, 1, 0.08, hi);
    A.rect("front", 0, 0.6, 1, 0.4, lo); A.rect("side", 0, 0.6, 1, 0.4, lo);
    A.rect("front", 0, 0.585, 1, 0.03, gc); A.rect("side", 0, 0.585, 1, 0.03, gc);
    A.rect("front", 0, 0.9, 1, 0.06, gc); A.rect("side", 0, 0.9, 1, 0.06, gc);   // gold cuff
    A.shade();
    L.fill(hx(legHex));
    L.rect("side", 0.44, 0, 0.12, 0.94, gc);                        // the braid down the outseam
    L.rect("front", 0.46, 0, 0.08, 0.9, tone(legHex, 0.16));        // crease
    L.rect("front", 0, 0.94, 1, 0.06, tone(legHex, -0.28));
    L.shade();
    return { torso: 1, arms: 1, legs: 1, jacket: 1 };
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
    T.rect("front", 0, 0, 1, 0.09, lo);                             // stand collar
    T.rect("back", 0, 0, 1, 0.09, lo);
    T.rect("front", 0.485, 0.08, 0.03, 0.84, tone(body, 0.3));      // centre zip
    T.dot("front", 0.5, 0.12, 0.022, metal);                        // zip pull
    // the harness: two narrow shoulder runs meeting a chest strap, plus one
    // waist run — webbing reads as a HARNESS only if the lines actually meet.
    T.poly("front", [[0.2, 0.02], [0.3, 0.02], [0.46, 0.5], [0.38, 0.52]], web);
    T.poly("front", [[0.8, 0.02], [0.7, 0.02], [0.54, 0.5], [0.62, 0.52]], web);
    T.rect("front", 0.36, 0.48, 0.28, 0.06, web);
    T.dot("front", 0.5, 0.51, 0.03, metal);                         // the buckle
    for (const col of ["front", "back", "side"]) T.rect(col, 0, 0.8, 1, 0.07, web);  // waist run
    T.rect("back", 0.2, 0.02, 0.6, 0.06, web);                      // the runs cross at the back
    T.rect("front", 0.1, 0.62, 0.18, 0.12, lo);                     // low utility pocket
    T.rect("front", 0.72, 0.62, 0.18, 0.12, lo);
    T.shade();
    A.fill(bc);
    A.rect("front", 0.2, 0.08, 0.6, 0.14, lo);                      // sleeve pocket
    A.rect("front", 0.2, 0.08, 0.6, 0.03, web);
    A.rect("front", 0, 0.56, 1, 0.1, lo); A.rect("side", 0, 0.56, 1, 0.1, lo);      // elbow panel
    A.rect("front", 0, 0.9, 1, 0.06, web); A.rect("side", 0, 0.9, 1, 0.06, web);    // cuff tab
    A.shade();
    L.fill(hx((c && c.legs != null) ? c.legs : body));
    L.rect("side", 0.24, 0.34, 0.52, 0.2, lo);                      // thigh pocket
    L.rect("side", 0.24, 0.34, 0.52, 0.04, web);
    L.rect("front", 0.16, 0.46, 0.68, 0.16, lo);                    // knee panel
    for (const col of ["front", "side"]) L.rect(col, 0, 0.9, 1, 0.1, tone(body, -0.3)); // boot break
    L.shade();
    return { torso: 1, arms: 1, legs: 1 };
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
    // vTop keeps the server's front BUTTONED-UP: a slimmer collar opening than
    // the tailored suits, the V2 sibling of the old narrow gap 0.05.
    const nk = formalTorso(P.T, P.J, 0x16171c, "rgb(30,31,37)", { bow: true, gap: 0.05, lapel: 0.07, lapelType: "notch", vest: 0x141519, vTop: 0.085, ctx: P.ctx });
    formalLimbs(P.A, P.L, 0x16171c, 0x141519, false, { ctx: P.ctx });
    const parts = { torso: 1, arms: 1, legs: 1, jacket: 1 };
    if (nk) parts.neck = nk;
    return parts;
  };

  // PILOT — crisp white shirt, black tie, gold EPAULETTES + wings.
  PAINT.pilot = function (P, c) {
    const white = "#eef0f2", lo = "#d6d9dd";
    const T = P.T, A = P.A, L = P.L;
    T.fill(white);
    T.rect("front", 0.49, 0, 0.02, 0.9, lo);                       // placket
    if (neckV2()) T.rect("front", 0.47, 0, 0.06, 0.6, "#15161c"); // tie — blade from row 0, knot on the yoke
    else {
      T.poly("front", [[0.42, 0.02], [0.58, 0.02], [0.55, 0.1], [0.45, 0.1]], "#15161c"); // tie knot
      T.rect("front", 0.47, 0.1, 0.06, 0.5, "#15161c");           // tie
    }
    T.rect("front", 0.06, 0, 0.18, 0.1, lo); T.rect("front", 0.76, 0, 0.18, 0.1, lo); // epaulette base
    for (const x of [0.08, 0.14, 0.2]) T.rect("front", x, 0.02, 0.03, 0.06, "#e8c454"); // gold bars L
    for (const x of [0.78, 0.84, 0.9]) T.rect("front", x, 0.02, 0.03, 0.06, "#e8c454"); // gold bars R
    T.rect("front", 0.62, 0.2, 0.1, 0.04, "#e8c454");            // gold wings
    T.shade();
    A.fill(white); A.rect("front", 0, 0.86, 1, 0.06, lo); A.rect("side", 0, 0.86, 1, 0.06, lo); A.shade();
    L.fill(hx((c && c.legs != null) ? c.legs : 0x1a1c24)); L.rect("side", 0.4, 0, 0.2, 1, "#0d0e12"); L.shade(); // black slacks w/ stripe
    const parts = { torso: 1, arms: 1, legs: 1 };
    if (neckV2()) parts.neck = { tie: 0x15161c, w: 0.06 };
    return parts;
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
    T.rect("front", 0.49, 0, 0.025, 1, dark);
    T.rect("front", 0.12, 0.25, 0.22, 0.14, dark); T.rect("front", 0.66, 0.25, 0.22, 0.14, dark);
    T.poly("front", [[0.1, 0], [0.2, 0], [0.82, 1], [0.7, 1]], "#6b4c2d"); // mailbag strap
    T.rect("front", 0.68, 0.1, 0.18, 0.055, "#e5e0cf"); T.shade();
    A.fill(hx(blue)); A.rect("front", 0.22, 0.12, 0.56, 0.16, dark); A.shade();
    L.fill(hx((c && c.legs != null) ? c.legs : 0x2f4a6b)); L.rect("side", 0.4, 0, 0.2, 1, dark); L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  };

  PAINT.janitor = function (P, c) {
    const grey = (c && c.torso != null) ? c.torso : 0x4a5560, lo = tone(grey, -0.25);
    const T = P.T, A = P.A, L = P.L;
    T.fill(hx(grey)); T.rect("front", 0.48, 0, 0.04, 1, lo);
    T.rect("front", 0.12, 0.24, 0.23, 0.15, lo); T.rect("front", 0.66, 0.24, 0.22, 0.15, lo);
    T.rect("front", 0.14, 0.27, 0.18, 0.045, "#d9d5c8"); T.shade();
    A.fill(hx(grey)); A.rect("front", 0, 0.84, 1, 0.08, lo); A.shade();
    L.fill(hx((c && c.legs != null) ? c.legs : 0x3a3f46)); L.rect("front", 0.18, 0.47, 0.64, 0.14, lo); L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  };

  PAINT.valet = function (P, c) {
    const red = (c && c.torso != null) ? c.torso : 0x8a1f24;
    const T = P.T, A = P.A, L = P.L;
    T.fill("#eceae4");
    T.poly("front", [[0.08, 0], [0.42, 0], [0.48, 0.28], [0.4, 1], [0.08, 1]], hx(red));
    T.poly("front", [[0.92, 0], [0.58, 0], [0.52, 0.28], [0.6, 1], [0.92, 1]], hx(red));
    T.rect("front", 0.47, 0.02, 0.06, 0.58, "#17191f");
    for (let y = 0.34; y < 0.8; y += 0.18) T.dot("front", 0.5, y, 0.018, "#e8c454");
    T.shade(); A.fill("#eceae4"); A.shade();
    L.fill(hx((c && c.legs != null) ? c.legs : 0x16171c)); L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  };

  PAINT.busdriver = function (P, c) {
    const teal = (c && c.torso != null) ? c.torso : 0x2f5a6b, lo = tone(teal, -0.3);
    const T = P.T, A = P.A, L = P.L;
    T.fill(hx(teal)); T.rect("front", 0.49, 0, 0.02, 1, lo);
    T.rect("front", 0.06, 0, 0.18, 0.11, tone(teal, 0.18)); T.rect("front", 0.76, 0, 0.18, 0.11, tone(teal, 0.18));
    T.rect("front", 0.14, 0.24, 0.2, 0.13, lo); T.rect("front", 0.66, 0.24, 0.2, 0.13, lo);
    T.rect("front", 0.62, 0.12, 0.2, 0.045, "#d7d9d4"); T.shade();
    A.fill(hx(teal)); A.rect("front", 0.16, 0.08, 0.68, 0.16, lo); A.shade();
    L.fill(hx((c && c.legs != null) ? c.legs : 0x24304a)); L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  };

  PAINT.hunter = function (P, c) {
    const field = (c && c.torso != null) ? c.torso : 0x465038, orange = (c && c.collar != null) ? c.collar : 0xe86d16;
    const T = P.T, A = P.A, L = P.L, chips = [0x303a28, 0x5c6344, 0x756447, 0x3b432e];
    function camo(R, n, base) {
      R.fill(hx(base)); let s = 0x51f15e ^ base;
      const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296; };
      for (const col of ["front", "back", "side"]) for (let i = 0; i < n; i++) R.rect(col, rnd(), rnd(), 0.1 + rnd() * 0.16, 0.05 + rnd() * 0.1, hx(chips[(rnd() * chips.length) | 0]));
      R.shade();
    }
    camo(T, 15, field);
    for (const col of ["front", "back", "side"]) T.rect(col, 0.08, 0.08, 0.84, 0.86, hx(orange));
    T.rect("front", 0.47, 0.08, 0.06, 0.86, tone(orange, -0.3));
    T.rect("front", 0.14, 0.57, 0.28, 0.23, tone(orange, -0.13)); T.rect("front", 0.58, 0.57, 0.28, 0.23, tone(orange, -0.13));
    T.rect("front", 0.14, 0.57, 0.28, 0.04, tone(orange, -0.35)); T.rect("front", 0.58, 0.57, 0.28, 0.04, tone(orange, -0.35)); T.shade();
    camo(A, 8, field); camo(L, 10, (c && c.legs != null) ? c.legs : 0x4a4d32);
    L.rect("side", 0.18, 0.34, 0.64, 0.22, tone(field, -0.28));
    return { torso: 1, arms: 1, legs: 1 };
  };

  PAINT.ranger = function (P, c) {
    const khaki = (c && c.torso != null) ? c.torso : 0xb19a6a, green = (c && c.collar != null) ? c.collar : 0x4a5835;
    const T = P.T, A = P.A, L = P.L;
    T.fill(hx(khaki)); T.rect("front", 0.49, 0, 0.02, 1, tone(khaki, -0.25));
    T.rect("front", 0.06, 0, 0.18, 0.11, hx(green)); T.rect("front", 0.76, 0, 0.18, 0.11, hx(green));
    T.rect("front", 0.13, 0.26, 0.23, 0.14, tone(khaki, -0.15)); T.rect("front", 0.64, 0.26, 0.23, 0.14, tone(khaki, -0.15));
    T.dot("front", 0.26, 0.17, 0.03, "#d9b94f"); T.rect("front", 0.66, 0.15, 0.18, 0.045, hx(green)); T.shade();
    A.fill(hx(khaki)); A.rect("front", 0.2, 0.07, 0.6, 0.18, hx(green)); A.shade();
    L.fill(hx((c && c.legs != null) ? c.legs : 0x3f4b2e)); L.rect("side", 0.36, 0, 0.28, 1, tone(green, -0.24)); L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  };

  PAINT.hiker = function (P, c) {
    const shell = (c && c.torso != null) ? c.torso : 0xb94f2f, dark = (c && c.collar != null) ? c.collar : 0x27313a;
    const T = P.T, A = P.A, L = P.L;
    T.fill(hx(shell));
    for (const col of ["front", "back", "side"]) T.rect(col, 0, 0, 1, 0.22, hx(dark));
    T.rect("front", 0.48, 0, 0.04, 1, tone(shell, -0.38));
    T.rect("front", 0.1, 0.52, 0.28, 0.18, tone(shell, -0.2)); T.rect("front", 0.62, 0.52, 0.28, 0.18, tone(shell, -0.2)); T.shade();
    A.fill(hx(shell)); A.rect("front", 0, 0, 1, 0.28, hx(dark)); A.rect("front", 0, 0.88, 1, 0.08, hx(dark)); A.shade();
    L.fill(hx((c && c.legs != null) ? c.legs : 0x3d4650)); L.rect("side", 0.18, 0.34, 0.64, 0.22, hx(dark)); L.rect("front", 0.14, 0.48, 0.72, 0.14, tone(dark, 0.12)); L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  };

  PAINT.farmer = function (P, c) {
    const shirt = (c && c.torso != null) ? c.torso : 0x76543a, denim = (c && c.legs != null) ? c.legs : 0x3d5872;
    const T = P.T, A = P.A, L = P.L;
    T.fill(hx(shirt));
    for (const x of [0.2, 0.5, 0.8]) for (const col of ["front", "back", "side"]) T.rect(col, x, 0, 0.035, 1, tone(shirt, -0.22));
    for (const y of [0.22, 0.5, 0.78]) for (const col of ["front", "back", "side"]) T.rect(col, 0, y, 1, 0.03, tone(shirt, 0.18));
    T.rect("front", 0.2, 0.26, 0.6, 0.74, hx(denim)); T.rect("front", 0.18, 0, 0.12, 0.42, hx(denim)); T.rect("front", 0.7, 0, 0.12, 0.42, hx(denim));
    T.rect("front", 0.34, 0.42, 0.32, 0.2, tone(denim, -0.16)); T.shade();
    A.fill(hx(shirt)); A.rect("front", 0, 0.76, 1, 0.06, tone(shirt, -0.2)); A.shade();
    L.fill(hx(denim)); L.rect("front", 0.16, 0.46, 0.68, 0.15, tone(denim, -0.2)); L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  };

  PAINT.fisherman = function (P, c) {
    const knit = (c && c.torso != null) ? c.torso : 0x283d50, oil = (c && c.collar != null) ? c.collar : 0xe1bd45;
    const T = P.T, A = P.A, L = P.L;
    T.fill(hx(knit));
    T.rect("front", 0.2, 0.3, 0.6, 0.7, hx(oil)); T.rect("front", 0.18, 0, 0.13, 0.5, hx(oil)); T.rect("front", 0.69, 0, 0.13, 0.5, hx(oil));
    T.rect("front", 0.32, 0.48, 0.36, 0.2, tone(oil, -0.15)); T.rect("back", 0.18, 0.3, 0.64, 0.7, hx(oil)); T.shade();
    A.fill(hx(knit)); A.rect("front", 0, 0.85, 1, 0.08, tone(knit, -0.25)); A.shade();
    L.fill(hx((c && c.legs != null) ? c.legs : 0xc99928)); L.rect("front", 0, 0.88, 1, 0.12, "#1d2924"); L.rect("side", 0, 0.88, 1, 0.12, "#1d2924"); L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  };

  PAINT.mariner = function (P, c) {
    const white = (c && c.torso != null) ? c.torso : 0xf0f1ed, navy = (c && c.collar != null) ? c.collar : 0x213a5a;
    const T = P.T, A = P.A, L = P.L;
    T.fill(hx(white)); T.rect("front", 0.49, 0, 0.02, 0.9, tone(white, -0.18));
    T.rect("front", 0.05, 0, 0.2, 0.12, hx(navy)); T.rect("front", 0.75, 0, 0.2, 0.12, hx(navy));
    for (const x of [0.08, 0.14]) { T.rect("front", x, 0.03, 0.03, 0.055, "#d5b24a"); T.rect("front", 0.78 + (x - 0.08), 0.03, 0.03, 0.055, "#d5b24a"); }
    T.rect("front", 0.65, 0.19, 0.16, 0.045, "#d5b24a"); T.shade();
    A.fill(hx(white)); A.rect("front", 0, 0.86, 1, 0.06, hx(navy)); A.shade();
    L.fill(hx((c && c.legs != null) ? c.legs : 0x19283d)); L.rect("side", 0.4, 0, 0.2, 1, tone(navy, -0.3)); L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  };

  PAINT.lifeguard = function (P, c) {
    const red = (c && c.collar != null) ? c.collar : 0xc8342f, white = (c && c.torso != null) ? c.torso : 0xf1eee7;
    const T = P.T, A = P.A, L = P.L, ctx = P.ctx;
    T.fill(hx(white));
    for (const col of ["front", "back", "side"]) T.rect(col, 0, 0, 1, 0.2, hx(red));
    T.rect("front", 0.47, 0.3, 0.06, 0.26, hx(red)); T.rect("front", 0.39, 0.39, 0.22, 0.07, hx(red));
    T.rect("back", 0.46, 0.26, 0.08, 0.32, hx(red)); T.rect("back", 0.36, 0.38, 0.28, 0.08, hx(red)); T.shade();
    if (ctx && ctx.fillText) { ctx.save(); ctx.fillStyle = "#c8342f"; ctx.font = "bold 7px Arial"; ctx.textAlign = "center"; ctx.fillText("GUARD", 16, ROWS.torso[0] + 31); ctx.restore(); }
    A.fill(hx(red)); A.rect("front", 0, 0.5, 1, 0.5, hx(white)); A.shade();
    L.fill(hx((c && c.legs != null) ? c.legs : 0xc8342f)); L.rect("side", 0.38, 0, 0.24, 1, hx(white)); L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  };

  function skiShell(P, c, patrol) {
    const body = (c && c.torso != null) ? c.torso : (patrol ? 0xc83232 : 0x286ba6), accent = (c && c.collar != null) ? c.collar : (patrol ? 0xf2f0e8 : 0xe67925);
    const T = P.T, A = P.A, L = P.L;
    T.fill(hx(body)); T.rect("front", 0.48, 0, 0.04, 1, tone(body, -0.35));
    for (const col of ["front", "back", "side"]) { T.rect(col, 0, 0, 1, 0.22, hx(accent)); T.rect(col, 0, 0.84, 1, 0.09, tone(body, -0.28)); }
    T.rect("front", 0.1, 0.55, 0.27, 0.16, tone(body, -0.18)); T.rect("front", 0.63, 0.55, 0.27, 0.16, tone(body, -0.18));
    if (patrol) { T.rect("front", 0.47, 0.32, 0.06, 0.25, "#f2f0e8"); T.rect("front", 0.39, 0.4, 0.22, 0.07, "#f2f0e8"); }
    T.shade();
    A.fill(hx(body)); A.rect("front", 0, 0, 1, 0.25, hx(accent)); A.rect("front", 0, 0.84, 1, 0.1, tone(body, -0.3)); A.shade();
    L.fill(hx((c && c.legs != null) ? c.legs : 0x202936)); L.rect("front", 0.12, 0.44, 0.76, 0.17, tone(0x202936, 0.12)); L.rect("side", 0, 0.88, 1, 0.12, "#171b22"); L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  }
  PAINT.ski = function (P, c) { return skiShell(P, c, false); };
  PAINT.ski_patrol = function (P, c) { return skiShell(P, c, true); };

  PAINT.groundcrew = function (P, c) {
    const hi = (c && c.torso != null) ? c.torso : 0xd8ca2f, navy = (c && c.arms != null) ? c.arms : 0x24344d;
    const T = P.T, A = P.A, L = P.L;
    T.fill(hx(navy));
    for (const col of ["front", "back", "side"]) { T.rect(col, 0.08, 0.05, 0.84, 0.9, hx(hi)); T.rect(col, 0.08, 0.38, 0.84, 0.09, "#eef0e9"); T.rect(col, 0.08, 0.42, 0.84, 0.025, "#afb7bd"); }
    T.poly("back", [[0.08, 0.52], [0.5, 0.8], [0.92, 0.52], [0.92, 0.64], [0.5, 0.92], [0.08, 0.64]], "#eef0e9");
    T.rect("front", 0.47, 0.05, 0.06, 0.9, tone(hi, -0.3)); T.shade();
    A.fill(hx(navy)); A.rect("front", 0, 0.3, 1, 0.09, "#eef0e9"); A.shade();
    L.fill(hx((c && c.legs != null) ? c.legs : 0x24344d)); L.rect("side", 0.2, 0.35, 0.6, 0.2, tone(navy, -0.22)); L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  };

  PAINT.cabincrew = function (P, c) {
    const navy = (c && c.torso != null) ? c.torso : 0x223552, scarf = (c && c.collar != null) ? c.collar : 0xb52d3c;
    const T = P.T, A = P.A, L = P.L;
    T.fill(hx(navy)); T.poly("front", [[0.28, 0], [0.5, 0.24], [0.72, 0]], "#eef0ec");
    T.poly("front", [[0.3, 0], [0.44, 0], [0.57, 0.32], [0.49, 0.38]], hx(scarf));
    T.rect("front", 0.13, 0.31, 0.2, 0.13, tone(navy, -0.18)); T.rect("front", 0.67, 0.31, 0.2, 0.13, tone(navy, -0.18));
    T.rect("front", 0.66, 0.18, 0.16, 0.045, "#d5b24a"); T.shade();
    A.fill(hx(navy)); A.rect("front", 0, 0.86, 1, 0.06, hx(scarf)); A.shade();
    L.fill(hx((c && c.legs != null) ? c.legs : 0x18243a)); L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  };

  PAINT.bartender = function (P, c) {
    const black = (c && c.torso != null) ? c.torso : 0x24282d, cloth = (c && c.collar != null) ? c.collar : 0xd9d7cf;
    const T = P.T, A = P.A, L = P.L;
    T.fill(hx(black)); T.poly("front", [[0.38, 0], [0.5, 0.13], [0.62, 0]], hx(cloth));
    for (const col of ["front", "back", "side"]) T.rect(col, 0, 0.55, 1, 0.45, "#15181d");
    T.rect("front", 0.3, 0.68, 0.4, 0.22, tone(0x15181d, 0.2)); T.rect("front", 0.8, 0.56, 0.12, 0.36, hx(cloth)); T.shade();
    A.fill(hx(black)); A.rect("front", 0, 0.62, 1, 0.06, hx(cloth)); A.shade();
    L.fill(hx((c && c.legs != null) ? c.legs : 0x15181d)); L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  };

  PAINT.driver = function (P, c) {
    const shirt = (c && c.torso != null) ? c.torso : 0xc9d3dc, vest = (c && c.collar != null) ? c.collar : 0x27354a;
    const T = P.T, A = P.A, L = P.L;
    T.fill(hx(shirt)); T.poly("front", [[0.08, 0], [0.42, 0], [0.48, 0.25], [0.4, 1], [0.08, 1]], hx(vest));
    T.poly("front", [[0.92, 0], [0.58, 0], [0.52, 0.25], [0.6, 1], [0.92, 1]], hx(vest));
    T.rect("front", 0.47, 0, 0.06, 0.64, tone(vest, -0.2)); T.rect("front", 0.64, 0.17, 0.18, 0.045, "#d1b14d"); T.shade();
    A.fill(hx(shirt)); A.rect("front", 0, 0.84, 1, 0.07, tone(shirt, -0.18)); A.shade();
    L.fill(hx((c && c.legs != null) ? c.legs : 0x202733)); L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  };

  PAINT.housekeeping = function (P, c) {
    const teal = (c && c.torso != null) ? c.torso : 0x71939a, cream = (c && c.collar != null) ? c.collar : 0xe5e2d9;
    const T = P.T, A = P.A, L = P.L;
    T.fill(hx(teal)); T.poly("front", [[0.36, 0], [0.5, 0.16], [0.64, 0]], hx(cream));
    T.rect("front", 0.18, 0.34, 0.64, 0.66, hx(cream)); T.rect("front", 0.18, 0.34, 0.64, 0.05, tone(cream, -0.18));
    T.rect("front", 0.3, 0.65, 0.4, 0.2, tone(cream, -0.1)); T.shade();
    A.fill(hx(teal)); A.rect("front", 0, 0.82, 1, 0.07, hx(cream)); A.shade();
    L.fill(hx((c && c.legs != null) ? c.legs : 0x34434b)); L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  };

  PAINT.athletic = function (P, c) {
    const blue = (c && c.torso != null) ? c.torso : 0x315f9b, white = (c && c.collar != null) ? c.collar : 0xe6e7e3;
    const T = P.T, A = P.A, L = P.L;
    T.fill(hx(blue)); T.rect("front", 0.48, 0, 0.04, 1, tone(blue, -0.32));
    for (const col of ["front", "back", "side"]) T.rect(col, 0, 0.86, 1, 0.1, hx(white));
    T.poly("front", [[0.12, 0], [0.28, 0], [0.46, 0.48], [0.38, 0.55]], hx(white)); T.poly("front", [[0.88, 0], [0.72, 0], [0.54, 0.48], [0.62, 0.55]], hx(white)); T.shade();
    A.fill(hx(blue)); A.rect("front", 0.08, 0, 0.1, 1, hx(white)); A.rect("side", 0.08, 0, 0.1, 1, hx(white)); A.shade();
    L.fill(hx((c && c.legs != null) ? c.legs : 0x1f2936)); L.rect("side", 0.12, 0, 0.13, 1, hx(white)); L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  };

  function raceWork(P, c, kind) {
    const body = (c && c.torso != null) ? c.torso : 0x17253a, accent = (c && c.collar != null) ? c.collar : 0xc93632;
    const T = P.T, A = P.A, L = P.L, hi = kind === "marshal" ? 0xf0e44c : 0xf1eee7;
    T.fill(hx(body)); T.rect("front", 0.48, 0, 0.04, 1, tone(body, -0.35));
    if (kind === "marshal") {
      for (const col of ["front", "back", "side"]) { T.rect(col, 0.07, 0.08, 0.86, 0.84, hx(accent)); T.rect(col, 0.07, 0.38, 0.86, 0.1, hx(hi)); }
      T.rect("front", 0.47, 0.08, 0.06, 0.84, tone(accent, -0.3));
    } else {
      for (const col of ["front", "back", "side"]) T.rect(col, 0, 0.28, 1, 0.16, hx(accent));
      T.rect("front", 0.12, 0.12, 0.22, 0.07, hx(hi)); T.rect("front", 0.66, 0.12, 0.22, 0.07, hx(hi));
      T.rect("front", 0, 0.76, 1, 0.08, "#11151b");
    }
    T.shade(); A.fill(hx(body)); A.rect("front", 0, 0.22, 1, 0.18, hx(accent)); A.shade();
    L.fill(hx((c && c.legs != null) ? c.legs : body)); L.rect("side", 0.1, 0, 0.14, 1, hx(accent)); L.rect("front", 0, 0.9, 1, 0.1, "#11151b"); L.shade();
    return { torso: 1, arms: 1, legs: 1 };
  }
  PAINT.pitcrew = function (P, c) { return raceWork(P, c, "pit"); };
  PAINT.marshal = function (P, c) { return raceWork(P, c, "marshal"); };
  PAINT.racer = function (P, c) { return raceWork(P, c, "racer"); };

  // DRESS — an A-line dress: fitted bodice, FLARED hem painted onto the LEG row
  // (the skirt sweeps out at the bottom). color via key/torso → many colors.
  PAINT.dress = function (P, c) {
    const body = (c && c.torso != null) ? c.torso : 0x8a2050, bc = hx(body);
    const T = P.T, A = P.A, L = P.L, hi = tone(body, 0.14), lo = tone(body, -0.2);
    T.fill(bc);
    T.poly("front", [[0.34, 0], [0.5, 0.18], [0.66, 0]], lo);      // scoop neckline
    // WAIST SEAM at 0.66: the female rig's waist BOX starts at row y ~0.675
    // (waistShare 0.325), so the bodice/skirt junction now lands on the body's
    // actual narrowest point instead of floating up the ribcage at 0.5.
    T.rect("front", 0.3, 0.66, 0.4, 0.04, lo);                    // waist seam (bodice meets skirt)
    T.rect("side", 0, 0.66, 1, 0.04, lo); T.rect("back", 0, 0.66, 1, 0.04, lo);  // …and all the way round
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
    const T = P.T, A = P.A, L = P.L, ctx = P.ctx;
    const trim = tone(body, -0.22);
    T.fill(bc);
    if (ctx) patternRow(T, ctx, body, "gingham", accent);
    T.poly("front", [[0.34, 0], [0.5, 0.16], [0.66, 0]], tone(body, -0.2)); // neckline
    T.rect("front", 0.26, 0, 0.1, 0.16, bc); T.rect("front", 0.64, 0, 0.1, 0.16, bc); // straps gap
    // the tie sits on the waist BOX seam (row y ~0.675), not mid-ribcage
    T.rect("front", 0.3, 0.66, 0.4, 0.035, trim);                 // waist tie
    T.rect("side", 0, 0.66, 1, 0.035, trim); T.rect("back", 0, 0.66, 1, 0.035, trim);
    T.shade();
    A.fill(bc); A.shade();                                        // plain shoulder/strap column, as before
    L.fill(bc);
    if (ctx) patternRow(L, ctx, body, "gingham", accent);         // the skirt carries the same check
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
    const WAIST = 0.67;                              // the waist-box seam, in row coords
    T.fill(bc);
    T.poly("front", [[0.37, 0], [0.5, 0.17], [0.63, 0]], lo2);       // open neckline
    T.poly("front", [[0.3, 0], [0.43, 0], [0.47, 0.13]], lo);        // collar leaf L
    T.poly("front", [[0.7, 0], [0.57, 0], [0.53, 0.13]], lo);        // collar leaf R
    T.rect("front", 0.49, 0.15, 0.02, 0.66, lo);                     // button placket
    for (let i = 0; i < 4; i++) T.dot("front", 0.5, 0.24 + i * 0.13, 0.012, hi);
    // princess/waist darts: shallow wedges pinching in toward the waist line
    T.poly("front", [[0.28, 0.26], [0.33, 0.26], [0.35, WAIST], [0.31, WAIST]], lo);
    T.poly("front", [[0.72, 0.26], [0.67, 0.26], [0.65, WAIST], [0.69, WAIST]], lo);
    T.poly("back", [[0.3, 0.28], [0.35, 0.28], [0.36, WAIST], [0.32, WAIST]], lo);
    T.poly("back", [[0.7, 0.28], [0.65, 0.28], [0.64, WAIST], [0.68, WAIST]], lo);
    // the garment CONTINUES past the seam and tucks in — a single shadow band
    // at the very hem, never a second belt line.
    for (const col of ["front", "back", "side"]) T.rect(col, 0, 0.93, 1, 0.07, lo2);
    T.shade();
    A.fill(bc);
    A.rect("front", 0, 0.52, 1, 0.04, lo); A.rect("side", 0, 0.52, 1, 0.04, lo);   // 3/4 sleeve seam
    A.rect("front", 0, 0.84, 1, 0.07, lo2); A.rect("side", 0, 0.84, 1, 0.07, lo2); // cuff
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
    T.rect("front", 0.49, 0.07, 0.02, 0.62, lo);                     // snap placket
    for (let i = 0; i < 4; i++) T.dot("front", 0.5, 0.16 + i * 0.15, 0.014, tc);
    T.dot("front", 0.32, 0.34, 0.06, tc);                            // a little chest motif
    T.dot("front", 0.32, 0.34, 0.03, "#fdfaf2");
    T.rect("front", 0.2, 0.86, 0.6, 0.05, lo);                       // crotch snap row
    for (const x of [0.3, 0.42, 0.54, 0.66]) T.dot("front", x, 0.885, 0.013, tc);
    T.shade();                                                        // NOTE: no hem — one piece
    A.fill(bc); A.rect("front", 0, 0.88, 1, 0.08, tc); A.rect("side", 0, 0.88, 1, 0.08, tc); A.shade();
    L.fill(bc);
    L.rect("front", 0, 0.86, 1, 0.14, tc);                           // the sewn-in FOOT
    L.rect("side", 0, 0.86, 1, 0.14, tc); L.rect("back", 0, 0.86, 1, 0.14, tc);
    L.shade();
    return { torso: 1, arms: 1, legs: 1 };
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
    T.rect("front", 0.14, 0.72, 0.2, 0.14, lo);                      // patch pocket
    T.shade();
    A.fill(bc); stripes(A, 0.16, 0.06); A.rect("front", 0, 0.88, 1, 0.08, lo); A.rect("side", 0, 0.88, 1, 0.08, lo); A.shade();
    L.fill(bc); stripes(L, 0.16, 0.06); L.rect("front", 0, 0.9, 1, 0.08, lo); L.rect("side", 0, 0.9, 1, 0.08, lo); L.shade();
    return { torso: 1, arms: 1, legs: 1 };
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
    A.fill(tc); A.rect("front", 0, 0.4, 1, 0.05, tone(tee, -0.2)); A.rect("side", 0, 0.4, 1, 0.05, tone(tee, -0.2)); // short sleeve seam
    for (const col of ["front", "back", "side"]) A.rect(col, 0, 0.45, 1, 0.55, sk);   // bare forearm
    A.shade();
    L.fill(dc);
    for (const col of ["front", "back", "side"]) {
      L.rect(col, 0, 0.34, 1, 0.05, stitch);                         // short-leg hem stitch
      L.rect(col, 0, 0.39, 1, 0.61, sk);                             // BARE SHINS
    }
    L.shade();
    return { torso: 1, arms: 1, legs: 1 };
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
    for (const col of ["front", "back", "side"]) T.rect(col, 0, 0.93, 1, 0.07, lo);   // hem (one line, at the bottom)
    T.shade();
    A.fill(bc);
    A.rect("front", 0, 0.36, 1, 0.04, lo); A.rect("side", 0, 0.36, 1, 0.04, lo);      // sleeve hem
    for (const col of ["front", "back", "side"]) A.rect(col, 0, 0.4, 1, 0.6, sk);     // bare arms
    A.shade();
    L.fill(lc);
    for (const col of ["front", "back", "side"]) {
      L.rect(col, 0, 0.36, 1, 0.04, tone(legHex, -0.3));             // shorts hem
      L.rect(col, 0, 0.4, 1, 0.6, sk);                               // bare shins
    }
    L.rect("front", 0.44, 0, 0.12, 0.36, tone(legHex, -0.18));       // shorts seam
    L.shade();
    return { torso: 1, arms: 1, legs: 1 };
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
    for (const col of ["front", "back", "side"]) T.rect(col, 0, 0.92, 1, 0.08, lo);  // ribbed jumper hem
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
  PAINT.schoolgirl = function (P, c) { return PAINT.school(P, c, true); };
  // kids' hoodie: the adult hoodie painter, cast in a child's colors. Nothing
  // about a hoodie changes with age — only the palette and the BODY do.
  PAINT.kidhoodie = function (P, c) { return PAINT.hoodie(P, c); };

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
    for (const col of ["front", "back", "side"]) T.rect(col, 0, 0.9, 1, 0.05, lo);   // gathered waist tie
    T.shade();
    A.fill(tc);
    A.rect("front", 0, 0.34, 1, 0.04, tone(tee, -0.2)); A.rect("side", 0, 0.34, 1, 0.04, tone(tee, -0.2));
    for (const col of ["front", "back", "side"]) A.rect(col, 0, 0.38, 1, 0.62, sk);  // bare arms
    A.shade();
    L.fill(bc);
    for (const col of ["front", "back", "side"]) {
      L.poly(col, [[0.28, 0], [0.72, 0], [1, 0.5], [0, 0.5]], hi);    // the skirt flares out
      L.rect(col, 0, 0.48, 1, 0.05, lo);                              // hem band
      L.rect(col, 0, 0.53, 1, 0.47, sk);                              // BARE SHINS below the knee
    }
    L.shade();
    return { torso: 1, arms: 1, legs: 1 };
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
  const YOKE_NO_LAPEL = { swat: 1 };
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
  // ONE UV-remapped box per yoke SIZE (adult male / female / the child bands —
  // a handful, ever), same shape as clothGeom's cache.
  const yokeGeoms = {};
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
  const SKIN_KEYED = { wifebeater: 1, romper: 1, kidtee: 1, pinafore: 1 };

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
      return id + "|" + (c.torso != null ? c.torso | 0 : 0) + "|" + sk;
    }
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
    else if (kind === "hivis") parts = PAINT.hivis(P, { torso: key.split("|")[1] | 0, legs: c.legs, arms: c.arms });
    else if (kind === "construction") parts = PAINT.construction(P, { torso: key.split("|")[1] | 0, collar: c.collar, legs: c.legs, arms: c.arms });
    else if (kind === "gang") { const seg = key.split("|"); parts = PAINT.gang(P, { torso: seg[1] | 0, collar: seg[2] | 0, legs: c.legs }); }
    // the WEARER's skin tone isn't in rec.colors (it comes off the rig), so it
    // rides the cache key and is handed back to the painter here. The garment
    // colors stay exactly where every other painter reads them: rec.colors.
    else if (SKIN_KEYED[kind]) parts = PAINT[kind](P, Object.assign({}, c, { skin: key.split("|")[2] | 0 }));
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
      const cv2 = yokeCanvas(bodyHex, neckHex, !!parts.jacket && !YOKE_NO_LAPEL[kind], neck);
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
        set.yoke = { mat: ym, tex: yt, hex: bodyHex };
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

  // ============================================================
  //  DRESS / STRIP — swap part materials+geometry in place; the original
  //  flat geometry+material is saved ONCE per mesh and restored on strip,
  //  so the jail/survival look survives any number of city outfit changes.
  // ============================================================
  function dress(list, part, m) {
    if (!list) return;
    if (outfitGuarantee() && !m) return;             // never hand a mesh a material it can't draw
    for (let i = 0; i < list.length; i++) {
      const mesh = list[i];
      if (!mesh) continue;
      if (!mesh.userData._cbzFlat) mesh.userData._cbzFlat = { g: mesh.geometry, m: mesh.material };
      // split-limb segments carry their own dims + row band (character.js tags)
      mesh.geometry = clothGeom(part, mesh.userData.clothDims, mesh.userData.clothBand);
      mesh.material = m;
      mesh.userData._cbzPart = part;                 // "this mesh is wearing painted cloth" (audit read)
    }
  }
  // THE YOKE IS DRESSED, NOT TINTED. Same save-once/restore contract as dress()
  // (restore() puts _cbzFlat back and clears _cbzPart), but the geometry comes
  // from the mesh's OWN box — character.js clamps collarW/collarD per profile,
  // so the size is read off the rig instead of copied here and left to drift.
  function dressYoke(list, m) {
    if (!list || !list.length || !m) return false;
    let any = false;
    for (let i = 0; i < list.length; i++) {
      const mesh = list[i];
      if (!mesh) continue;
      const b = boxOf(mesh);
      if (!b) continue;                              // stub rig / no box params → leave it flat
      if (!mesh.userData._cbzFlat) mesh.userData._cbzFlat = { g: mesh.geometry, m: mesh.material };
      mesh.geometry = yokeGeom([b.w, b.h, b.d]);
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
      if (!guard) { mesh.geometry = f.g; mesh.material = f.m; mesh.userData._cbzPart = null; continue; }
      // A FLAT ORIGINAL THAT DIED TAKES THE BODY WITH IT. `_cbzFlat` is captured
      // ONCE, at the very first dress, and then held for the whole life of the
      // rig — which is long enough for a teardown sweep to have disposed it, for
      // a graphics-tier swap to have orphaned its Lambert/Standard twin, or for
      // it simply never to have existed on a stub rig. Putting an unrenderable
      // material back on the body IS the owner's bug, so a dead stash falls
      // through to a live flat default instead of onto a person.
      if (geomOk(f.g)) mesh.geometry = f.g;
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

  function applyClothes(ch, rec, opts) {
    if (!ch || !ch.skinSlots) return null;
    fitTorso(ch);                                    // chest+waist → ONE garment column
    const set = rec ? getSet(rec, ch) : null;
    const key = set ? keyOf(typeof rec === "string" ? { id: rec } : rec, ch) : null;
    if (!set) {                                      // no painted look → strip back to flat
      if (ch._clothesKey != null) {
        const s = ch.skinSlots;
        restore(s.torso); restore(s.arms); restore(s.legs);
        restore(s.armsLower); restore(s.legsLower); restore(s.collar);
        if (ch._jacketMesh) ch._jacketMesh.visible = false;
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
    dress(s.torso, "torso", m);
    if (set.parts.arms) { dress(s.arms, "arm", m); dress(s.armsLower, "arm", m); }
    else { restore(s.arms); restore(s.armsLower); }
    if (set.parts.legs) { dress(s.legs, "leg", m); dress(s.legsLower, "leg", m); }
    else { restore(s.legs); restore(s.legsLower); }
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
      } else if (jf) jm.geometry = clothGeom("jacket", jf.dims);
      // torso[0] is only the chest on a body with a waist box, so the shell has
      // to drop half a waist to keep wrapping the whole column (0 for an adult
      // male — his chest IS the column).
      if (jf) jm.position.y = jf.y;
      jm.material = m;
      jm.visible = true;
    } else if (ch._jacketMesh) ch._jacketMesh.visible = false;
    // ---- the SHOULDER YOKE wears the garment too (see THE SHOULDER YOKE) ----
    // Dressed LAST so a look with no yoke atlas — or the flag turned off —
    // falls back through the ordinary strip path and outfits.js flat-tints it.
    let yoked = false;
    if (yokeOn) yoked = dressYoke(s.collar, (opts && opts.iso) ? isoMat(ch, key + "~yoke", set.yoke.mat) : set.yoke.mat);
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
  // The pelvis and the yoke are never dressed, so a wrong-sized box there would
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

  // Neckties are a silhouette, not a painted stripe or a stack of cuboids.
  // Build the knot/blade as shallow cloth prisms: they still match the game's
  // low-poly language, but have the real wide-at-the-bottom blade and pointed
  // tip. Geometries are shared by every outfit/rack preview.
  function clothPrism(points, depth) {
    const s = new THREE.Shape();
    s.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], points[i][1]);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, {
      depth: depth, steps: 1,
      bevelEnabled: true, bevelSegments: 1,
      bevelSize: 0.006, bevelThickness: 0.006,
    });
    g.translate(0, 0, -depth / 2);
    g.computeVertexNormals();
    g._shared = true;
    return g;
  }
  const TIE_KNOT_GEO = clothPrism([
    [-0.062, 0.46], [0.062, 0.46], [0.043, 0.34], [-0.043, 0.34],
  ], 0.04);
  const TIE_BLADE_GEO = clothPrism([
    [-0.034, 0.34], [0.034, 0.34], [0.062, -0.23], [0, -0.35], [-0.062, -0.23],
  ], 0.035);
  const BOW_GEO = clothPrism([
    [0, 0.395], [-0.075, 0.35], [-0.17, 0.365], [-0.18, 0.47],
    [-0.075, 0.49], [0, 0.445], [0.075, 0.49], [0.18, 0.47],
    [0.17, 0.365], [0.075, 0.35],
  ], 0.045);
  const BOW_KNOT_GEO = clothPrism([
    [-0.045, 0.465], [0.045, 0.465], [0.052, 0.375], [-0.052, 0.375],
  ], 0.052);
  function shapedPiece(group, geo, z, hex, name) {
    const m = new THREE.Mesh(geo, cmat(hex));
    m.position.z = z;
    m.castShadow = false; m.receiveShadow = false;
    m.name = name || "neckwear";
    m.userData.clothingPart = name || "neckwear";
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
        shapedPiece(group, TIE_KNOT_GEO, 0.278, tone2(c, -0.2), "tie-knot");
        shapedPiece(group, TIE_BLADE_GEO, 0.276, c, "tie-blade"); } };
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
      shapedPiece(group, BOW_GEO, 0.278, c, "bow-tie-wings");
      shapedPiece(group, BOW_KNOT_GEO, 0.284, tone2(c, 0.18), "bow-tie-knot"); } };
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
  function clearComposite(ch) {
    const bin = ch._compMeshes;
    if (bin) for (let i = 0; i < bin.length; i++) {
      const m = bin[i];
      if (m && m.parent) m.parent.remove(m);
      if (m && m.geometry && !m.geometry._shared && m.geometry.dispose) m.geometry.dispose();
    }
    ch._compMeshes = [];
  }
  CBZ.cityClearComposite = clearComposite;
  function cityApplyComposite(ch, comp) {
    if (!ch || !ch.skinSlots || !comp) return false;
    const items = comp.items || [];
    const shirt = comp.shirt != null ? comp.shirt : 0xf2f2f2;
    let legs = comp.legs != null ? comp.legs : 0x39414f;
    // a fully-painted special (tuxedo/suit/dress…) short-circuits the whole stack
    let painted = null, paintRec = null, shell = null, paintedHex = null;
    for (let i = 0; i < items.length; i++) {
      const sp = COMP[items[i]];
      if (!sp) continue;
      if (sp.painted) {
        painted = sp.painted; paintRec = sp.paintRec || null;
        paintedHex = (paintRec && paintRec.colors && paintRec.colors.torso != null)
          ? paintRec.colors.torso : (sp.color != null ? sp.color : null);
      }
      if (sp.shell) shell = items[i];
      if (sp.legsHex != null) legs = sp.legsHex;
    }
    clearComposite(ch);
    if (painted) {                                   // e.g. tuxedo → the painted look
      const rec = paintRec ? Object.assign({ id: painted }, paintRec) : { id: painted };
      const pp = applyClothes(ch, rec);
      // ONE SOURCE. paintedHex above is the composable's STATIC colour field —
      // for all 22 buyable suits that is the catalog navy, not the style's own
      // body, which is the owner's blue-collar-on-a-tan-suit exactly. Ask the
      // atlas what it painted; fall back to the static value if it cannot say.
      const derived = cityPaintedBodyHex(rec, ch);
      if (derived != null) paintedHex = derived;
      // …and when the wardrobe DRESSES the yoke, do not tint it: a colour on a
      // textured Lambert multiplies the map, which would darken the paint.
      if (pp && pp.collar) return true;
      // THE YOKE IS NOT A SECOND COLLAR (the long note in outfits.js's
      // recolorRig). skinSlots.collar is a flat slab at the top of the torso
      // column that no painted garment ever reaches — and this branch never
      // touched it AT ALL, so it kept whatever the LAST look left there. The
      // player's default composite is a white tee, which sets it to 0xf2f2f2;
      // switching into a black hoodie therefore left a white ring round his
      // neck that no outfit had asked for, and that is the owner's "my player
      // sometimes". Give it the garment's own cloth colour so it disappears
      // into the look. Revert: CBZ.CONFIG.CITY_YOKE_GARMENT = false.
      if (paintedHex != null && (!CBZ.CONFIG || CBZ.CONFIG.CITY_YOKE_GARMENT !== false)) {
        const yoke = ch.skinSlots.collar;
        if (CBZ.cityPaintSlot) CBZ.cityPaintSlot(yoke, paintedHex);
        else if (yoke) for (const m of yoke) {
          if (!m || !m.material || !m.material.color) continue;
          if (m.material._shared) m.material = m.material.clone();
          m.material.color.setHex(paintedHex);
        }
      }
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
    const cf = compFrame(ch);                        // adult-authored coords → this body
    if (host && host.add) {
      const bin = ch._compMeshes;
      for (let i = 0; i < items.length; i++) {
        const sp = COMP[items[i]];
        if (!sp || sp.shell || sp.painted || sp.legsHex != null) continue; // shells/legs handled above
        const grp = new THREE.Group();
        grp.name = "wearable-" + items[i];
        grp.userData.clothingSlot = sp.slot || "item";
        // a tie authored for a 0.95-tall male chest would sit ABOVE a woman's
        // collarbone (her chest box is shorter and higher) — one node fixes
        // every composable at once instead of re-authoring fourteen of them.
        if (cf) { grp.scale.set(cf.sx, cf.sy, cf.sz); grp.position.y = cf.y; }
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
