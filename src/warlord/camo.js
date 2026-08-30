/* ============================================================
   warlord/camo.js — THE CAMOUFLAGE LIBRARY.

   WHAT IT IS. Fourteen procedurally drawn, deterministic, cached
   camouflage patterns, so that DESERT WARLORD's armies are told apart by
   what they are WEARING rather than by a coloured dot over their heads.
   outfits.js paints the uniforms; this file supplies the cloth.

   WHY IT IS A LIBRARY AND NOT SIX MORE PAINT FUNCTIONS. city/clothes.js
   already had camouflage — PAINT.soldier (clothes.js:1129) and PAINT.hunter
   (clothes.js:1686) each scatter an LCG field of axis-aligned RECTS over a
   base colour. That is fine for one city ped in a crowd of forty and it is
   the wrong instrument here for three reasons:
     · it is per-garment code, so a fifteenth army costs a fifteenth copy of
       the same twelve lines;
     · every family of real camouflage differs in its GEOMETRY, not its
       palette — a rect scatter can be tinted brown but it can never be a
       tiger stripe, and recolouring one scatter five ways is five armies
       wearing the same uniform in five colours, which is exactly the thing
       the owner asked not to have;
     · it draws into a per-outfit atlas, so nothing else on the island (a
       tent, a tarp, a banner, a technical's canopy) can wear it.
   So: patterns as DATA, one tile canvas per (pattern, palette), and a paint
   hook so outfits.js can stamp that tile into its own atlas for free.

   ------------------------------------------------------------------
   WHAT WAS REUSED, AND WHERE THE REUSE STOPPED
   ------------------------------------------------------------------
   REUSED, by construction:
     · world/textures_masonry.js:198-226 — the cache shape. texCache/matCache
       Maps keyed by id; ONE MeshLambertMaterial per look, `color` left white
       so the canvas carries all the colour, `_shared = true` so nothing
       disposes a texture three hundred men are standing in. That triple
       (canvas → texture → material, each cached at its own level) is copied
       here verbatim in shape, because it is right.
     · world/textures_surface.js:86-98 — the periodic value-noise/fbm/ridge
       construction (lattice coords wrapped modulo the octave period BEFORE
       hashing, which is what makes a field seamlessly tileable). Re-derived
       below rather than imported because that file exposes nothing:
       CBZ.surfaceMaps/surfaceApply/surfaceDefaults are the whole public
       surface and `fbm` is module-private. Twelve lines, cited, not forked
       behaviour — if that file's noise ever changes, nothing here breaks.
     · world/textures_surface.js:337-346 — mkTex. THE ENCODING LINE IS THE
       POINT: core/renderer.js:501 sets renderer.outputEncoding =
       sRGBEncoding, so a colour CanvasTexture that does not declare
       `encoding = THREE.sRGBEncoding` gets its sRGB bytes read as linear and
       comes out visibly washed out and too bright. masonryTex does not set
       it (and its bricks are correspondingly pale); surfaceMaps does. We do.
     · core/packages.js:94 canvasTex — the create-canvas-draw-wrap shape.
       Not CALLED: it has no cache, never sets encoding, and pins anisotropy
       at the default 1, which are the three things that matter here.
     · core.js — W.rngFrom (mulberry), W.hash01, W.clamp. Not one Math.random
       in this file: seven warlords ride the same island and a pattern that
       differs between clients is two players looking at two armies.

   WRITTEN NEW: every pattern's geometry. There was no blob/stripe/pixel
   -cluster vocabulary in the repo to reuse — the closest thing was a rect
   scatter, and a rect scatter cannot make any of these shapes.

   ------------------------------------------------------------------
   THE ISLAND IS THE CONSTRAINT — and it is DARKER than you think
   ------------------------------------------------------------------
   desert.js:480-487 publishes the ground as LINEAR albedos, with a comment
   about why (an sRGB-looking value is roughly twice the reflectance it
   looks like, and the first draft photographed the whole island as white
   paper). Converted to the sRGB the screen actually shows:

       dune trough  [0.34,0.25,0.14] -> #9E8969      dune crest -> #BFA58B
       salt pan     [0.60,0.59,0.55] -> #CDCBC4      gravel     -> #8B816F
       rock         [0.16,0.10,0.07] -> #6F594B .. #977C65
       wadi silt    [0.20,0.17,0.11] -> #7C735D      oasis      -> #557940

   That is the single most useful number in this file. The beige everybody
   reaches for when they hear "desert camo" — #D9C9A0 and up, the colour of
   the page's own --sand token — is far brighter than the sand this island
   actually renders. A uniform painted in it is a row of light bulbs at 400 m.
   So the desert palettes are anchored on #9E8969..#BFA58B rather than on that
   beige, and `W.camo.conceal(id)` measures each pattern's mean against this
   table rather than trusting the eye.

   THE PALETTES ARE THEN AUTHORED ONE NOTCH BELOW that anchor, and the reason
   is the LIGHTING rather than the ground — see the long note over PALETTES.
   The shipped means, measured: desert3 #A99475, multicam #9E8E6E, tiger
   #816A41, digital #988261, chip #AD9874, woodland #3A432C, khaki #93805E,
   salt crust #BCB8AF, night raid #1D1F24.

   ------------------------------------------------------------------
   RESOLUTION AND SCALE, WITH THE ARITHMETIC
   ------------------------------------------------------------------
   Authored at 256 px per METRE OF CLOTH (each pattern declares how many
   metres of cloth its tile spans; `repeatFor` turns a garment's real size
   into a texture repeat, so a pattern is the same physical size on a torso
   and on a trouser leg — the thing that goes wrong the instant you put one
   texture on boxes of different widths).

     at 3 m, 55 deg vertical FOV, 700 px frame: 224 px per metre.
       a 0.45 m torso front = 101 px, carrying 0.45*256 = 115 texels.
       ~1.14 texels per pixel. That is the sweet spot: 512 would be thrown
       away by the sampler, 128 is visibly soft on the same shot.

     at 200 m, same lens: a 1.8 m man is 6 px tall, his torso ~1.5 px wide.
       115 texels into 1.5 pixels is mip level log2(77) = 6.3, i.e. the GPU
       is showing a 4x4 average of the tile. NOTHING of the geometry
       survives — at 200 m a camouflage pattern IS its mean colour, plus
       whatever variance remains between one man and the next.

   Two consequences, and both are in the code:
     · generateMipmaps stays ON (r128 gives a power-of-two CanvasTexture
       mipmaps and LinearMipmapLinear by default; we assert it rather than
       inherit it). Without mips the 200 m rank is a shimmering salt-and-
       pepper mess that reads as fizzing grey, which is the "aliases into
       grey mush" failure in its literal form.
     · the MEAN of every palette is checked against the ground, because it
       is the only property of the pattern a 200 m viewer can see. The
       disruptive geometry starts paying somewhere around 40 m and is the
       whole show under 15 m.
   anisotropy 8 (capped by the renderer): trouser legs and a prone man are
   both grazing-angle surfaces and that is where aniso earns its keep.

   ------------------------------------------------------------------
   THE API  (outfits.js / wardrobe.js: this is the contract)
   ------------------------------------------------------------------
     W.camo.patterns()                -> [record]  every pattern, in order
     W.camo.pattern(id)               -> record | null
     W.camo.palettes()                -> [palette record]
     W.camo.canvas(id, opts)          -> cached HTMLCanvasElement tile
     W.camo.texture(id, opts)         -> cached THREE.CanvasTexture (or null
                                         when camo is reverted off)
     W.camo.material(id, opts)        -> cached MeshLambertMaterial, shared
     W.camo.paint(cc,x,y,w,h,id,opts) -> stamp the tile into ANY 2d context.
                                         THE ATLAS HOOK: this is how a
                                         clothes.js-shaped painter gets camo
                                         at zero extra texture cost.
     W.camo.repeatFor(id, wM, hM)     -> [rx, ry] holding true physical scale
     W.camo.factionDefault(fid)       -> {pattern, tint} suggestion per faction
     W.camo.conceal(id, opts)         -> 0..1 measured against island ground
     W.camo.stats()                   -> {canvases, textures, materials, bytes}
     W.camo.dispose()                 -> drop everything (mode teardown)

     opts: { palette, res, repeat, tint, force }
       palette  a named palette id — a REAL repaint. Cached; measured 18 ms
                per tile on this box (254 ms for all fourteen), which is why
                nothing is baked until it is asked for.
       tint     a hex multiplied into material.color — a FREE recolour that
                shares one texture across every faction that uses it. Tint
                can only darken and hue-shift (it multiplies); reach for a
                palette when you want a genuinely different colourway.

   FLAGS
     ?camo=old   (or CBZ.CONFIG.WARLORD_CAMO = false) — the one-line revert.
                 texture() returns null, material() returns a flat Lambert of
                 the palette's mean colour, paint() fills flat. Every consumer
                 feature-detects the null, so the island goes back to flat
                 coloured cloth and nothing crashes.
     ?camo=1     the debug gallery: every pattern as a tile, on cloth, and at
                 three viewing distances, over real island sand. Runs without
                 outfits.js, wardrobe.js or a battle, on purpose.
     ?cfg_WARLORD_CAMO_RES=n   authoring resolution override.

   EVENTS OWNED: none. This file listens to nothing and emits nothing; it is
   a pure cache with a draw function behind it.
============================================================ */
(function () {
  "use strict";
  const G = (typeof window !== "undefined" ? window : globalThis);
  const CBZ = (G.CBZ = G.CBZ || {});
  const W = (CBZ.warlord = CBZ.warlord || {});
  const THREE = G.THREE;
  CBZ.CONFIG = CBZ.CONFIG || {};

  if (CBZ.CONFIG.WARLORD_CAMO == null) CBZ.CONFIG.WARLORD_CAMO = true;
  if (CBZ.CONFIG.WARLORD_CAMO_RES == null) CBZ.CONFIG.WARLORD_CAMO_RES = 256;
  if (CBZ.CONFIG.WARLORD_CAMO_ANISO == null) CBZ.CONFIG.WARLORD_CAMO_ANISO = 8;

  /* The revert is read LIVE, never latched at boot. The visual A/B flips it
     from inside an already-loaded page, and a boot-time snapshot would make
     the "before" column silently identical to the "after" one — the exact
     failure mode the ?flag=old doctrine exists to catch. */
  function enabled() {
    if (CBZ.CONFIG.WARLORD_CAMO === false) return false;
    try {
      const q = new URLSearchParams(G.location ? G.location.search : "");
      if (q.get("camo") === "old" || q.get("camo") === "0") return false;
    } catch (e) {}
    return true;
  }

  /* ============================================================ DICE
     core.js's own stream, seeded off the pattern id. If core.js somehow is
     not there (a bare texture harness), fall back to a byte-identical local
     mulberry rather than to Math.random — a pattern that differs between
     two clients of one match is worse than no pattern. */
  const rngFrom = W.rngFrom || function (seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const hash01 = W.hash01 || function (x, y, salt) {
    let n = ((Math.round(x * 8) | 0) * 73856093) ^ ((Math.round(y * 8) | 0) * 19349663) ^ ((salt | 0) * 83492791);
    n = Math.imul(n ^ (n >>> 13), 0x85ebca6b) >>> 0;
    n ^= n >>> 16;
    return (n >>> 0) / 4294967296;
  };
  const clamp = W.clamp || function (v, a, b) { return v < a ? a : v > b ? b : v; };

  // a stable integer from a string, so "tigerdesert|tigerdesert|256" always
  // seeds the same stream on every client and every reload
  function strSeed(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }

  /* ---- periodic value noise (textures_surface.js:74-98, re-derived) ------
     Lattice coordinates wrapped modulo the octave period BEFORE hashing is
     the whole trick: it is what makes every field below tile seamlessly, and
     a camo tile that does not tile is a seam running down a man's back. */
  function lat(xi, yi, per, salt) {
    const x = ((xi % per) + per) % per, y = ((yi % per) + per) % per;
    return hash01(x, y, salt);
  }
  function smoothstep(t) { return t * t * (3 - 2 * t); }
  function vnoise(x, y, per, salt) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const u = smoothstep(x - xi), v = smoothstep(y - yi);
    const a = lat(xi, yi, per, salt), b = lat(xi + 1, yi, per, salt);
    const c = lat(xi, yi + 1, per, salt), d = lat(xi + 1, yi + 1, per, salt);
    const x0 = a + (b - a) * u, x1 = c + (d - c) * u;
    return x0 + (x1 - x0) * v;
  }
  function fbm(u, v, base, oct, salt) {
    let amp = 0.5, per = base, sum = 0, norm = 0;
    for (let o = 0; o < oct; o++) {
      sum += vnoise(u * per, v * per, per, salt + o * 7919) * amp;
      norm += amp; amp *= 0.5; per *= 2;
    }
    return sum / (norm || 1);
  }

  /* fbm is NOT uniform — summing octaves gives a bell around 0.5 (measured
     sd ~0.135 for the 3-octave case used below). Thresholding it directly
     means the "20% dark" band is not 20% of anything, which is how a digital
     pattern ends up 70% base colour and reads as a plain shirt. Push it back
     to uniform through the logistic approximation of the normal CDF
     (Phi(z) ~ 1/(1+e^-1.702z), the standard item-response approximation,
     max error 0.01) and then a threshold IS an area fraction. */
  function uniform(v) { return 1 / (1 + Math.exp(-1.702 * (v - 0.5) / 0.135)); }

  /* ============================================================ COLOUR
     Everything below is authored in sRGB hex because that is what a 2d
     canvas takes and what the sRGB-encoded texture hands back to the
     shader. See the header for why the desert entries look "too dark". */
  function hx(c) { return "#" + ("00000" + (c >>> 0).toString(16)).slice(-6); }
  /* THE ISLAND'S OWN GROUND, in sRGB, converted from desert.js:480-487's
     linear albedos with the standard sRGB transfer. These are the numbers
     every palette here is judged against; conceal() reads them directly, so
     if desert.js ever repaints the island the honest fix is to re-derive
     this table rather than to re-tune the palettes by eye. */
  const GROUND = {
    dune:    0x9E8969,   // trough  [0.34,0.25,0.14]
    crest:   0xBFA58B,   // crest   [0.52,0.42,0.26]
    salt:    0xCDCBC4,   // pan     [0.60,0.59,0.55]
    gravel:  0x8B816F,   // gravel  [0.26,0.22,0.16]
    rock:    0x6F594B,   // rock lo [0.16,0.10,0.07]
    rockHi:  0x977C65,   // rock hi [0.31,0.20,0.13]
    wadi:    0x7C735D,   // silt    [0.20,0.17,0.11]
    oasis:   0x557940,   // green   [0.09,0.19,0.05]
  };

  /* ============================================================ PALETTES
     ------------------------------------------------------------------
     RE-AUTHORED A THIRD OF A STOP DOWN AFTER THE FIRST RENDER, and this is
     the most important paragraph in the file.

     The first pass centred every desert palette on the island's own sRGB
     ground (#9E8969 trough .. #BFA58B crest) on the reasonable theory that
     matching the albedo matches the pixel. Photographed on the live page,
     EVERY light field colour came back as white paper — and so did the flat
     "camo off" control, and so does the sand. warlord/props.js:2748 already
     had the reason written down: the page is DOUBLE-LIT (hemi 0.62 + 0.62,
     sun 1.05 + 1.12) into ACES at exposure 1, so incident is about 3.1x.

     Run the ACES curve on it and the usable tonal range is not what you would
     guess. Albedo 0.34 (the dune trough) arrives at sRGB 234; albedo 0.52
     (the crest) arrives at 242. EIGHT LEVELS APART. Above roughly 0.30 linear
     the curve has no room left, so a pattern authored up there has no
     geometry on screen at all — the first swatch plate has khaki drill, salt
     crust, urban grey and the tribal robe as four identical white squares.
     Below it there is plenty: albedo 0.10 lands at 178 and 0.05 at 130.

     So every palette here is authored for the LOW half of the range. The
     light field colours came down about 10% and the four that photographed
     as white came down much further (urban grey by 20 levels, khaki by 17).
     That is not a taste change: it is the difference between a library with
     fourteen patterns in it and a library with ten patterns and four white
     squares, and the swatch plate is the evidence either way.
     ------------------------------------------------------------------
     A palette is an ORDERED colour list and the order is the contract:
       [0] the field / lightest mass       [1..n-2] successive disruptors
       [n-1] the accent, spatter or trim
     A pattern reads P(i) and wraps, so a pattern never crashes on a palette
     shorter than it expected — it just repeats a colour, which looks like a
     three-colour version of itself rather than a black square. */
  const PALETTES = [
    { id: "desert3",   label: "Three-colour desert",
      colors: [0xA89272, 0x7E6845, 0x50402C] },
    { id: "multicam",  label: "Multicam-ish",
      colors: [0x9A8968, 0x71704C, 0x625034, 0xA89A7C, 0x4C4834, 0x413826] },
    { id: "tigerdes",  label: "Desert tiger",
      colors: [0xA79063, 0x7A6238, 0x40301E] },
    { id: "marpatdes", label: "Digital desert",
      colors: [0x9F8867, 0x7C6746, 0xB2A183, 0x554730] },
    { id: "chip6",     label: "Six-colour chip",
      colors: [0xAF9873, 0x8E754C, 0x64563A, 0xC2B393, 0x201B16, 0xD8D2C2] },
    { id: "urban",     label: "Urban grey",
      colors: [0x646466, 0x45464A, 0x86868A, 0x2B2C30] },
    { id: "woodland",  label: "Woodland M81",
      colors: [0x6B6A48, 0x4A5533, 0x4A3B28, 0x2F3A24, 0x1A1C14] },
    { id: "khaki",     label: "Khaki drill",
      colors: [0x93805C, 0x877352, 0x9E8E6C] },
    { id: "drab",      label: "Flat drab",
      colors: [0x6F6A4E, 0x625D44, 0x7A755A] },
    { id: "saltcrust", label: "Salt crust",
      colors: [0xD2CFC7, 0xBEBBB1, 0x63615A] },
    { id: "wadi",      label: "Wadi shadow",
      colors: [0x7F6F57, 0x55483A, 0x33291F] },
    { id: "night",     label: "Night",
      colors: [0x23252C, 0x1A1C22, 0x33363F] },
    { id: "rag",       label: "Found cloth",
      colors: [0x9A8B6D, 0x6B5F47, 0xA8724A, 0x4E5A4A, 0xB9AC93, 0x75543F] },
    { id: "robe",      label: "Tribal robe",
      colors: [0xBFB294, 0x2B3A57, 0x8E3427, 0xD6CCB4] },
  ];
  const PAL_BY_ID = {};
  PALETTES.forEach(function (p) { PAL_BY_ID[p.id] = p; });

  /* ============================================================ THE BRUSHES
     Four shape vocabularies, because four is how many distinct geometries
     the real families reduce to: the organic BLOB (DPM, woodland, multicam,
     chocolate chip), the torn horizontal BAND (tiger stripe), the PIXEL
     CLUSTER (MARPAT, urban digital) and the flat FIELD (drill, drab). Every
     pattern below is one of those plus a spatter/wear pass. */

  /* Draw a shape at every wrapped position it could touch. A tile that does
     not wrap is a seam, and a seam on a uniform is a stripe down the spine
     of every man in the army. 9 cheap rejects, up to 4 real draws. */
  function wrapped(cc, N, x, y, rad, fn) {
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const X = x + ox * N, Y = y + oy * N;
        if (X + rad < 0 || X - rad > N || Y + rad < 0 || Y - rad > N) continue;
        fn(X, Y);
      }
    }
  }

  /* THE ORGANIC BLOB. Not a polar-radius wobble — that gives a starfish, and
     the first draft's DPM looked like a bed of sea urchins. A real DPM or
     M81 shape is LOBED: several overlapping rounded masses strung along one
     axis, which is what a brush actually leaves. So: 3..6 ellipses along a
     line, filled as ONE path (nonzero winding unions them), and the whole
     thing rotated. Spiky families raise `jag`, which pushes alternate lobes
     off the axis and shrinks them into the fingers DPM is known for. */
  function blobPath(cc, x, y, r, rot, rnd, lobes, elong, jag) {
    cc.beginPath();
    const n = lobes || (3 + Math.floor(rnd() * 4));
    const cs = Math.cos(rot), sn = Math.sin(rot);
    for (let i = 0; i < n; i++) {
      const t = (i / Math.max(1, n - 1) - 0.5) * 2;             // -1..1 along the axis
      const along = t * r * (elong == null ? 0.85 : elong);
      const across = (rnd() - 0.5) * r * (jag || 0.35) * 2;
      const rr = r * (0.42 + rnd() * 0.5) * (1 - Math.abs(t) * 0.28);
      const px = x + along * cs - across * sn;
      const py = y + along * sn + across * cs;
      cc.ellipse(px, py, rr, rr * (0.62 + rnd() * 0.5), rot + (rnd() - 0.5) * 1.4, 0, Math.PI * 2);
    }
    cc.fill();
  }

  /* HOW MANY BLOBS FOR A GIVEN COVERAGE. Derived, not typed: scattering n
     discs of radius r into an area A covers 1 - exp(-n*pi*r^2/A) of it
     (the Poisson/Boolean-model coverage). Invert it. The first pass typed
     "22 blobs" per layer and the same number gave 15% coverage on the small
     -featured patterns and 80% on the large-featured ones, i.e. the layer
     ratios that define a family were an accident of tile size. */
  function blobCount(cov, r, N) {
    const a = Math.PI * r * r;
    if (a <= 0) return 0;
    return Math.max(1, Math.round(-Math.log(1 - clamp(cov, 0.01, 0.95)) * N * N / a));
  }

  /* A LAYER OF BLOBS. `bias` places this layer's shapes on the EDGES of the
     previous layer's shapes rather than independently — which is the actual
     construction of three-colour DPM and M81 woodland: the black is drawn
     over the boundary between the green and the brown, never floating in
     the middle of the field. Independent layers give confetti. */
  function blobLayer(cc, N, colour, cov, r, rnd, o) {
    o = o || {};
    cc.fillStyle = colour;
    const n = blobCount(cov, r * 0.86, N);
    const prev = o.prev || null;
    const out = [];
    for (let i = 0; i < n; i++) {
      let x, y;
      if (prev && prev.length && rnd() < (o.bias == null ? 0.7 : o.bias)) {
        const p = prev[Math.floor(rnd() * prev.length) % prev.length];
        const a = rnd() * Math.PI * 2, d = p.r * (0.65 + rnd() * 0.6);
        x = p.x + Math.cos(a) * d; y = p.y + Math.sin(a) * d;
      } else { x = rnd() * N; y = rnd() * N; }
      const rr = r * (0.62 + rnd() * 0.76);
      const rot = rnd() * Math.PI * 2;
      // one rnd stream, replayed per wrapped copy, so the 4 copies of a shape
      // straddling the seam are the SAME shape and the seam actually closes
      const seed = (rnd() * 4294967296) >>> 0;
      wrapped(cc, N, x, y, rr * 2.2, function (X, Y) {
        blobPath(cc, X, Y, rr, rot, rngFrom(seed), o.lobes, o.elong, o.jag);
      });
      out.push({ x: x, y: y, r: rr });
    }
    return out;
  }

  /* TORN HORIZONTAL BANDS — tiger stripe. The family's signature is that the
     stripes RUN OUT: a band is not a rectangle, it is a brush stroke that
     tapers to nothing and restarts. Drawn as a filled ribbon whose top and
     bottom edges are separate noise walks (so the band pinches and swells),
     broken into 1-3 segments with tapered ends. Horizontal-only, because a
     tiger stripe that wanders vertically is a woodland blob. */
  function bandLayer(cc, N, colour, rows, thick, rnd, salt) {
    cc.fillStyle = colour;
    for (let i = 0; i < rows; i++) {
      const y = (i + 0.5) / rows * N + (rnd() - 0.5) * (N / rows) * 0.55;
      const t = thick * (0.45 + rnd() * 1.25);
      const segs = 1 + Math.floor(rnd() * 3);
      for (let s = 0; s < segs; s++) {
        const x0 = rnd() * N, len = N * (0.22 + rnd() * 0.55);
        const wob = 0.5 + rnd() * 1.6, ph = rnd() * 10;
        const step = Math.max(3, N / 48);
        for (const off of [0, -N, N]) {          // wrap the band in y
          const yy = y + off;
          if (yy + t * 3 < 0 || yy - t * 3 > N) continue;
          cc.beginPath();
          // top edge left->right
          for (let x = 0; x <= len; x += step) {
            const u = x / len;
            const taper = Math.sin(Math.PI * clamp(u, 0, 1));      // ends run out to nothing
            const wy = vnoise((x0 + x) / N * 9 + ph, yy / N * 3, 9, salt) - 0.5;
            const py = yy + wy * t * wob * 2.2 - t * 0.5 * taper;
            const px = ((x0 + x) % N + N) % N;
            if (x === 0) cc.moveTo(px, py); else cc.lineTo(px, py);
          }
          // bottom edge right->left
          for (let x = len; x >= 0; x -= step) {
            const u = x / len;
            const taper = Math.sin(Math.PI * clamp(u, 0, 1));
            const wy = vnoise((x0 + x) / N * 9 + ph + 3.1, yy / N * 3, 9, salt) - 0.5;
            const py = yy + wy * t * wob * 2.2 + t * 0.5 * taper;
            const px = ((x0 + x) % N + N) % N;
            cc.lineTo(px, py);
          }
          cc.closePath(); cc.fill();
        }
      }
    }
  }

  /* PIXEL CLUSTERS AT TWO SCALES — MARPAT/CADPAT and the urban digital.
     The family is not "random pixels": it is a low-frequency blob field
     QUANTISED to a small grid, with the boundary cells dithered so the edge
     between two colours is a run of single pixels rather than a staircase.
     Two frequencies because the real thing has both: a macro mass you read
     at 30 m and a chip texture you read at 3 m. */
  function pixelField(cc, N, cols, fracs, px, salt, macro, micro, dither) {
    const cells = Math.max(4, Math.round(N / px));
    const cut = [];
    let acc = 0;
    for (let i = 0; i < fracs.length; i++) { acc += fracs[i]; cut.push(acc); }
    for (let i = 0; i < cut.length; i++) cut[i] /= acc;
    for (let cy = 0; cy < cells; cy++) {
      for (let cx = 0; cx < cells; cx++) {
        const u = cx / cells, v = cy / cells;
        let n = fbm(u, v, macro, 2, salt) * 0.66 + fbm(u, v, micro, 2, salt + 517) * 0.34;
        n = uniform(n) + (hash01(cx, cy, salt + 91) - 0.5) * dither;
        let k = 0;
        while (k < cut.length - 1 && n > cut[k]) k++;
        cc.fillStyle = cols[k % cols.length];
        cc.fillRect(cx * px, cy * px, px + 0.5, px + 0.5);
      }
    }
  }

  /* SPATTER CLUSTERS — the "chocolate chip" in six-colour desert. The whole
     identity of that pattern is that the black and white spots come in
     CLUMPS of four to eight, sitting inside the pale masses, imitating
     pebbles on a gravel pan. Scattered evenly they read as noise and the
     pattern loses its name. */
  function spatter(cc, N, colour, clumps, per, r, rnd, hosts) {
    cc.fillStyle = colour;
    for (let i = 0; i < clumps; i++) {
      let cx, cy;
      if (hosts && hosts.length && rnd() < 0.72) {
        const h = hosts[Math.floor(rnd() * hosts.length) % hosts.length];
        cx = h.x + (rnd() - 0.5) * h.r * 1.1; cy = h.y + (rnd() - 0.5) * h.r * 1.1;
      } else { cx = rnd() * N; cy = rnd() * N; }
      const n = 3 + Math.floor(rnd() * per);
      for (let j = 0; j < n; j++) {
        const a = rnd() * Math.PI * 2, d = rnd() * r * 3.4;
        const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
        const rr = r * (0.45 + rnd() * 0.9);
        const rot = rnd() * Math.PI * 2, sq = 0.5 + rnd() * 0.9;
        wrapped(cc, N, x, y, rr * 2, function (X, Y) {
          cc.beginPath(); cc.ellipse(X, Y, rr, rr * sq, rot, 0, Math.PI * 2); cc.fill();
        });
      }
    }
  }

  /* WEAR: sun bleach and dust. Without it every one of these reads as vector
     art — flat masses with hard edges and no history. Big soft radial
     gradients at a few percent alpha cost nothing and are the difference
     between "a pattern" and "cloth that has been in a desert". */
  function wearPass(cc, N, rnd, bleach, dust) {
    cc.save();
    for (let i = 0; i < 26; i++) {
      const x = rnd() * N, y = rnd() * N, r = N * (0.08 + rnd() * 0.26);
      const up = rnd() < 0.5;
      const a = (up ? bleach : dust) * (0.4 + rnd() * 0.6);
      wrapped(cc, N, x, y, r, function (X, Y) {
        const gg = cc.createRadialGradient(X, Y, 0, X, Y, r);
        gg.addColorStop(0, "rgba(" + (up ? "255,246,222," : "104,84,56,") + a.toFixed(3) + ")");
        gg.addColorStop(1, "rgba(" + (up ? "255,246,222,0" : "104,84,56,0") + ")");
        cc.fillStyle = gg; cc.fillRect(X - r, Y - r, r * 2, r * 2);
      });
    }
    cc.restore();
  }

  /* WEAVE: one 8x8 twill tile, built once, stamped over everything at 5%.
     It is invisible past ~8 m and it is what stops a close-up torso looking
     like painted plastic. Built as a canvas pattern rather than a per-texel
     loop because a getImageData pass over fourteen 256px tiles is 900k
     pixels of JS for something worth five percent of one channel. */
  let WEAVE = null;
  function weaveTile() {
    if (WEAVE) return WEAVE;
    const c = document.createElement("canvas"); c.width = c.height = 8;
    const g = c.getContext("2d");
    g.clearRect(0, 0, 8, 8);
    for (let i = 0; i < 8; i++) {
      g.fillStyle = "rgba(255,255,255,0.30)"; g.fillRect(i, (i * 3) % 8, 2, 1);
      g.fillStyle = "rgba(0,0,0,0.26)";       g.fillRect(i, (i * 3 + 4) % 8, 2, 1);
    }
    WEAVE = c; return WEAVE;
  }
  function weavePass(cc, N, alpha) {
    const p = cc.createPattern(weaveTile(), "repeat");
    if (!p) return;
    cc.save(); cc.globalAlpha = alpha == null ? 0.05 : alpha;
    cc.fillStyle = p; cc.fillRect(0, 0, N, N); cc.restore();
  }

  /* ============================================================ PATTERNS
     `metres` is how many metres of CLOTH one tile spans. It is the number
     that makes repeatFor honest, and it differs per family because the real
     things differ: a MARPAT chip is ~2 cm, a woodland blob is ~25 cm.
     `conceal` here is only the DESIGN INTENT — the shipped number comes from
     conceal(), measured off the drawn tile against the island's own ground.
     `loud: true` marks the ones that are supposed to be seen. */
  const PATTERNS = [
    { id: "desert3", label: "DESERT DPM", family: "blob", palette: "desert3", metres: 0.90,
      note: "three-colour desert. large soft organic masses, the dark drawn over the boundary.",
      draw: function (cc, N, P, rnd) {
        /* ELONGATED, NOT ROUND. The first draft ran lobes 5 / elong 1.0 /
           jag 0.45 and photographed on a torso as leopard spots: discrete
           round clumps with sand between all of them. Real three-colour
           desert is a FLOWING shape — long, branching, and connected across
           the garment, which is what actually breaks an outline. More lobes,
           strung further along the axis, thrown further off it, at a smaller
           radius so there are more of them and they meet. */
        cc.fillStyle = P(0); cc.fillRect(0, 0, N, N);
        /* COVERAGE IS 42/18, NOT 50/23. Elongating the shapes to stop them
           reading as leopard spots also made them cover more, and the measured
           tile mean fell to #7F6A48 — a full stop under the dune's #9E8969,
           i.e. the state army's issue kit had quietly become a dark uniform on
           pale sand (conceal 0.82 -> 0.64). Three-colour desert is a LIGHT
           pattern with shapes on it; the light field has to stay the majority
           colour. Shapes unchanged, coverage pulled back. */
        const mid = blobLayer(cc, N, P(1), 0.42, N * 0.165, rnd, { lobes: 6, elong: 1.65, jag: 0.58 });
        blobLayer(cc, N, P(2), 0.18, N * 0.112, rnd, { prev: mid, bias: 0.80, lobes: 5, elong: 1.75, jag: 0.66 });
        wearPass(cc, N, rnd, 0.10, 0.09); weavePass(cc, N, 0.05);
      } },

    { id: "multicam", label: "MULTICAM", family: "blob", palette: "multicam", metres: 0.75,
      note: "layered blotches with a vertical gradient inside each mass, plus a fine chip texture over the lot.",
      draw: function (cc, N, P, rnd) {
        /* THE GRADIENT IS INSIDE THE BLOTCH, not across the garment. A tiling
           texture cannot hold a garment-scale gradient (it would seam), and
           the real pattern does not have one either — every blotch fades
           light-at-top to dark-at-bottom, which is what makes it read as
           depth rather than as camouflage shapes. */
        cc.fillStyle = P(0); cc.fillRect(0, 0, N, N);
        function gradBlobs(top, bot, cov, r, prev, bias) {
          const out = [];
          const n = blobCount(cov, r * 0.86, N);
          for (let i = 0; i < n; i++) {
            let x, y;
            if (prev && prev.length && rnd() < bias) {
              const p = prev[Math.floor(rnd() * prev.length) % prev.length];
              const a = rnd() * Math.PI * 2, d = p.r * (0.6 + rnd() * 0.7);
              x = p.x + Math.cos(a) * d; y = p.y + Math.sin(a) * d;
            } else { x = rnd() * N; y = rnd() * N; }
            const rr = r * (0.6 + rnd() * 0.85), rot = rnd() * Math.PI * 2;
            const seed = (rnd() * 4294967296) >>> 0;
            wrapped(cc, N, x, y, rr * 2.2, function (X, Y) {
              const g = cc.createLinearGradient(0, Y - rr, 0, Y + rr);
              g.addColorStop(0, top); g.addColorStop(1, bot);
              cc.fillStyle = g;
              blobPath(cc, X, Y, rr, rot, rngFrom(seed), 5, 1.0, 0.32);
            });
            out.push({ x: x, y: y, r: rr });
          }
          return out;
        }
        const a = gradBlobs(P(3), P(1), 0.50, N * 0.22, null, 0);
        const b = gradBlobs(P(1), P(2), 0.30, N * 0.15, a, 0.7);
        gradBlobs(P(4), P(5), 0.14, N * 0.085, b, 0.8);
        /* the fine texture. Multicam's other half is a haze of tiny high
           -frequency shapes that kills the hard blotch edges at 5 m — the
           thing that separates it from a 1980s three-colour. */
        cc.save(); cc.globalAlpha = 0.30;
        spatter(cc, N, P(4), 40, 5, N * 0.011, rnd, null);
        cc.globalAlpha = 0.24;
        spatter(cc, N, P(3), 34, 5, N * 0.013, rnd, null);
        cc.restore();
        wearPass(cc, N, rnd, 0.08, 0.07); weavePass(cc, N, 0.05);
      } },

    { id: "tigerdesert", label: "TIGER STRIPE", family: "band", palette: "tigerdes", metres: 1.10,
      note: "torn horizontal bands that run out and restart. broad mid strokes, thin dark ones over them.",
      draw: function (cc, N, P, rnd) {
        cc.fillStyle = P(0); cc.fillRect(0, 0, N, N);
        bandLayer(cc, N, P(1), 11, N * 0.030, rnd, 0x7a11);
        bandLayer(cc, N, P(2), 15, N * 0.014, rnd, 0x7a12);
        wearPass(cc, N, rnd, 0.10, 0.08); weavePass(cc, N, 0.05);
      } },

    { id: "marpat", label: "DIGITAL DESERT", family: "pixel", palette: "marpatdes", metres: 0.55,
      note: "pixel clusters at two scales with dithered boundaries. dissolves to its mean earlier than anything else here.",
      draw: function (cc, N, P, rnd) {
        pixelField(cc, N, [P(0), P(1), P(2), P(3)], [0.40, 0.28, 0.18, 0.14],
                   Math.max(2, Math.round(N / 64)), 0x4d21, 5, 15, 0.30);
        wearPass(cc, N, rnd, 0.07, 0.07); weavePass(cc, N, 0.04);
      } },

    { id: "chip6", label: "CHOCOLATE CHIP", family: "blob", palette: "chip6", metres: 0.95,
      note: "six-colour desert: soft blobs, then clumped black and white rock spatter inside the pale masses.",
      draw: function (cc, N, P, rnd) {
        cc.fillStyle = P(0); cc.fillRect(0, 0, N, N);
        const mid = blobLayer(cc, N, P(1), 0.42, N * 0.19, rnd, { lobes: 4, elong: 0.9, jag: 0.4 });
        const dk = blobLayer(cc, N, P(2), 0.18, N * 0.12, rnd, { prev: mid, bias: 0.7, lobes: 4, elong: 1.0, jag: 0.5 });
        const pale = blobLayer(cc, N, P(3), 0.22, N * 0.13, rnd, { prev: mid, bias: 0.55, lobes: 4, elong: 0.9, jag: 0.4 });
        // black chips on the pale masses, white chips on the dark ones — the
        // real pattern's actual rule, and the reason it reads as gravel
        spatter(cc, N, P(4), 26, 5, N * 0.010, rnd, pale);
        spatter(cc, N, P(5), 20, 4, N * 0.009, rnd, dk);
        wearPass(cc, N, rnd, 0.09, 0.10); weavePass(cc, N, 0.05);
      } },

    { id: "urbandigi", label: "URBAN GREY", family: "pixel", palette: "urban", metres: 0.55, loud: true,
      /* THE FIRST NOTE HERE WAS A LIE AND conceal() CAUGHT IT. It read "on
         this island it only disappears on the salt pan"; measured, urban grey
         scores 0.54 on the pan and 0.62 on the DUNE, because the pan renders
         at #CDCBC4 — far brighter than a mid urban grey — while the dune's
         luminance happens to sit close to it. So it is not a pan pattern at
         all: saltcrust is. This one is the outpost-and-ruins pattern, and it
         is loud on every square metre of open ground in the game. */
      note: "grey digital. built for concrete, and there is almost no concrete here: loud on sand AND on the pan, which is what makes it a bad choice somebody made.",
      draw: function (cc, N, P, rnd) {
        pixelField(cc, N, [P(0), P(1), P(2), P(3)], [0.36, 0.30, 0.20, 0.14],
                   Math.max(2, Math.round(N / 64)), 0x5e31, 5, 15, 0.30);
        wearPass(cc, N, rnd, 0.06, 0.05); weavePass(cc, N, 0.04);
      } },

    { id: "woodland", label: "WOODLAND", family: "blob", palette: "woodland", metres: 1.20, loud: true,
      note: "M81. four large organic masses with the black over the boundaries. superb in the oasis, a green man on orange sand everywhere else.",
      draw: function (cc, N, P, rnd) {
        cc.fillStyle = P(0); cc.fillRect(0, 0, N, N);
        const g = blobLayer(cc, N, P(1), 0.44, N * 0.23, rnd, { lobes: 5, elong: 1.1, jag: 0.5 });
        const br = blobLayer(cc, N, P(2), 0.30, N * 0.17, rnd, { prev: g, bias: 0.6, lobes: 5, elong: 1.0, jag: 0.5 });
        blobLayer(cc, N, P(3), 0.20, N * 0.11, rnd, { prev: br, bias: 0.82, lobes: 4, elong: 1.3, jag: 0.65 });
        blobLayer(cc, N, P(4), 0.07, N * 0.055, rnd, { prev: br, bias: 0.85, lobes: 3, elong: 1.4, jag: 0.7 });
        wearPass(cc, N, rnd, 0.07, 0.09); weavePass(cc, N, 0.05);
      } },

    { id: "khaki", label: "KHAKI DRILL", family: "field", palette: "khaki", metres: 0.70,
      note: "no pattern at all: cotton drill, a sun-bleach mottle and a visible twill. the honest uniform of an army with no textile mill.",
      draw: function (cc, N, P, rnd) {
        cc.fillStyle = P(0); cc.fillRect(0, 0, N, N);
        // very low-contrast bleach mottle: two blob layers at 8% alpha
        cc.save(); cc.globalAlpha = 0.16;
        blobLayer(cc, N, P(2), 0.40, N * 0.26, rnd, { lobes: 4, elong: 0.9, jag: 0.3 });
        cc.globalAlpha = 0.13;
        blobLayer(cc, N, P(1), 0.34, N * 0.20, rnd, { lobes: 4, elong: 0.9, jag: 0.3 });
        cc.restore();
        wearPass(cc, N, rnd, 0.09, 0.12); weavePass(cc, N, 0.14);
      } },

    { id: "drab", label: "FLAT DRAB", family: "field", palette: "drab", metres: 0.70,
      note: "one colour, dirt and wear. what an irregular actually owns.",
      draw: function (cc, N, P, rnd) {
        cc.fillStyle = P(0); cc.fillRect(0, 0, N, N);
        cc.save(); cc.globalAlpha = 0.12;
        blobLayer(cc, N, P(1), 0.42, N * 0.24, rnd, { lobes: 4, elong: 0.9, jag: 0.3 });
        cc.restore();
        wearPass(cc, N, rnd, 0.09, 0.16); weavePass(cc, N, 0.07);
      } },

    { id: "saltcrust", label: "SALT CRUST", family: "blob", palette: "saltcrust", metres: 0.80, loud: true,
      note: "invented for this island. pale crust with dark polygon cracks — it vanishes on the pan and it is a lamp on a dune.",
      draw: function (cc, N, P, rnd) {
        cc.fillStyle = P(0); cc.fillRect(0, 0, N, N);
        /* the cracks are desert.js's own salt-pan trick (desert.js:519-524, a
           high-frequency iso-contour of value noise) done in 2d: draw the
           band where |noise-0.5| is small and you get a polygon net rather
           than a scatter of lines. */
        /* THE CRACK BAND IS THIN AND IT HAS TO STAY THIN. A band of
           |noise-0.5| < eps around an iso-contour covers far more of the tile
           than eps suggests, because a value-noise field is shallow near its
           midline: eps 0.030 with overlapping 1.6 px rects took the measured
           mean of this tile from #C2BFB6 to #78756B — a dark grey garment
           calling itself salt crust, scoring 0.24 on the pan when desert DPM
           scores 0.17. eps 0.010 and exact 1 px cells keeps the net and keeps
           the mean, which is the only half a 200 m viewer can see. */
        cc.fillStyle = P(2);
        for (let y = 0; y < N; y++) {
          for (let x = 0; x < N; x++) {
            const v = Math.abs(vnoise(x / N * 11, y / N * 11, 11, 0x5a17) - 0.5);
            if (v < 0.010) cc.fillRect(x, y, 1, 1);
          }
        }
        cc.save(); cc.globalAlpha = 0.35;
        blobLayer(cc, N, P(1), 0.30, N * 0.16, rnd, { lobes: 4, elong: 0.8, jag: 0.35 });
        cc.restore();
        wearPass(cc, N, rnd, 0.10, 0.04); weavePass(cc, N, 0.05);
      } },

    { id: "wadishadow", label: "WADI SHADOW", family: "blob", palette: "wadi", metres: 1.00,
      note: "invented. big angular rock-shadow shards, not soft blobs: it belongs in a wadi or on a mesa and it is a hole in the ground on open sand.",
      draw: function (cc, N, P, rnd) {
        cc.fillStyle = P(0); cc.fillRect(0, 0, N, N);
        // ANGULAR, because shadow on broken rock has straight edges. Same
        // wrapped-scatter machinery, a polygon instead of an ellipse union.
        function shard(colour, cov, r) {
          cc.fillStyle = colour;
          const n = blobCount(cov, r * 0.8, N);
          for (let i = 0; i < n; i++) {
            const x = rnd() * N, y = rnd() * N, rr = r * (0.55 + rnd() * 0.9);
            const k = 4 + Math.floor(rnd() * 3), rot = rnd() * Math.PI * 2;
            const rads = []; for (let j = 0; j < k; j++) rads.push(rr * (0.45 + rnd() * 0.85));
            wrapped(cc, N, x, y, rr * 1.6, function (X, Y) {
              cc.beginPath();
              for (let j = 0; j < k; j++) {
                const a = rot + j / k * Math.PI * 2;
                const px = X + Math.cos(a) * rads[j], py = Y + Math.sin(a) * rads[j] * 0.8;
                if (j === 0) cc.moveTo(px, py); else cc.lineTo(px, py);
              }
              cc.closePath(); cc.fill();
            });
          }
        }
        shard(P(1), 0.44, N * 0.20);
        shard(P(2), 0.22, N * 0.13);
        wearPass(cc, N, rnd, 0.07, 0.12); weavePass(cc, N, 0.05);
      } },

    { id: "nightraid", label: "NIGHT RAID", family: "blob", palette: "night", metres: 0.85, loud: true,
      note: "invented. near-black with a cold grey break-up. gone after dusk, a cut-out silhouette at noon.",
      draw: function (cc, N, P, rnd) {
        cc.fillStyle = P(0); cc.fillRect(0, 0, N, N);
        blobLayer(cc, N, P(1), 0.44, N * 0.21, rnd, { lobes: 4, elong: 1.0, jag: 0.4 });
        cc.save(); cc.globalAlpha = 0.5;
        blobLayer(cc, N, P(2), 0.16, N * 0.10, rnd, { lobes: 4, elong: 1.1, jag: 0.5 });
        cc.restore();
        wearPass(cc, N, rnd, 0.05, 0.10); weavePass(cc, N, 0.07);
      } },

    { id: "ragpatch", label: "FOUND CLOTH", family: "patch", palette: "rag", metres: 1.10,
      note: "invented for the bandits. not camouflage: a garment repaired out of whatever six other garments were lying around, with the seams showing.",
      draw: function (cc, N, P, rnd) {
        /* PATCHES, NOT BLOBS. A bandit's coat is pieces of cloth stitched
           together, so the shapes are quads with straight seams — and it is
           the seams that sell it. Drawn on an irregular grid so the pieces
           are different sizes, which a regular grid cannot do and which is
           the difference between "repaired" and "checked shirt". */
        cc.fillStyle = P(0); cc.fillRect(0, 0, N, N);
        const cuts = [0];
        let x = 0;
        while (x < N - N * 0.12) { x += N * (0.14 + rnd() * 0.22); cuts.push(Math.min(N, x)); }
        cuts.push(N);
        const rows = [0];
        let y = 0;
        while (y < N - N * 0.12) { y += N * (0.14 + rnd() * 0.22); rows.push(Math.min(N, y)); }
        rows.push(N);
        for (let j = 0; j < rows.length - 1; j++) {
          for (let i = 0; i < cuts.length - 1; i++) {
            cc.fillStyle = P(1 + Math.floor(rnd() * 5));
            const x0 = cuts[i] + (rnd() - 0.5) * 2, y0 = rows[j] + (rnd() - 0.5) * 2;
            cc.fillRect(x0, y0, cuts[i + 1] - x0 + 1, rows[j + 1] - y0 + 1);
          }
        }
        // the stitching. Dark 1px runs on every seam, dashed like thread.
        cc.strokeStyle = "rgba(38,30,20,0.55)"; cc.lineWidth = 1;
        cc.setLineDash([3, 3]);
        for (let i = 1; i < cuts.length - 1; i++) { cc.beginPath(); cc.moveTo(cuts[i], 0); cc.lineTo(cuts[i], N); cc.stroke(); }
        for (let j = 1; j < rows.length - 1; j++) { cc.beginPath(); cc.moveTo(0, rows[j]); cc.lineTo(N, rows[j]); cc.stroke(); }
        cc.setLineDash([]);
        wearPass(cc, N, rnd, 0.08, 0.16); weavePass(cc, N, 0.07);
      } },

    { id: "stripedrobe", label: "TRIBAL ROBE", family: "field", palette: "robe", metres: 1.30, loud: true,
      note: "invented, and deliberately NOT camouflage. broad woven vertical stripes on ecru — a militia that has never once thought about being seen.",
      draw: function (cc, N, P, rnd) {
        cc.fillStyle = P(0); cc.fillRect(0, 0, N, N);
        // vertical stripes wrap for free; the widths are quantised so the
        // last stripe closes exactly on the tile edge and there is no seam
        /* THE FIELD IS ECRU AND THE STRIPES ARE NARROW. The first pass gave
           the indigo 55% of every band it landed in; the tile's measured mean
           came out #636C7B — a blue-grey garment, which is not a striped robe,
           it is a denim shirt, and it scored 0.75 conceal because blue-grey
           happens to sit a similar distance from sand as tan does. Narrow
           groups of stripes on an ecru ground: mean back in the cream, and the
           thing is loud because of CONTRAST, not because of hue. */
        const bands = 6;
        const w = N / bands;
        for (let i = 0; i < bands; i++) {
          const x0 = i * w;
          const k = rnd();
          if (k < 0.34) {                       // a wide indigo band with a hairline pair
            cc.fillStyle = P(1); cc.fillRect(x0 + w * 0.30, 0, w * 0.17, N);
            cc.fillStyle = P(2); cc.fillRect(x0 + w * 0.52, 0, w * 0.05, N);
          } else if (k < 0.62) {                // a stripe group: three thin threads
            cc.fillStyle = P(1);
            cc.fillRect(x0 + w * 0.18, 0, w * 0.05, N);
            cc.fillRect(x0 + w * 0.30, 0, w * 0.05, N);
            cc.fillStyle = P(2); cc.fillRect(x0 + w * 0.42, 0, w * 0.06, N);
          } else {                              // a plain panel of cloth
            cc.fillStyle = P(3); cc.fillRect(x0 + w * 0.1, 0, w * 0.8, N);
          }
        }
        // the weft: faint cross-threads, which is what makes it read woven
        cc.fillStyle = "rgba(120,102,74,0.13)";
        for (let y = 0; y < N; y += 6) cc.fillRect(0, y, N, 1);
        wearPass(cc, N, rnd, 0.10, 0.10); weavePass(cc, N, 0.11);
      } },
  ];
  const PAT_BY_ID = {};
  PATTERNS.forEach(function (p) { PAT_BY_ID[p.id] = p; });

  /* ============================================================ FACTIONS
     A SUGGESTION, not a law — outfits.js owns uniforms and may override any
     of this. It is here because the gameplay claim ("some armies are
     genuinely hard to see and some are not") only means anything if the
     assignment is deliberate, and because a debug gallery with no faction
     column cannot show whether the claim is true.

     conceal numbers in the comments are MEASURED (W.camo.conceal, mean tile
     colour against desert.js's own dune/crest sRGB) — see conceal(). */
  const FACTION = {
    legion:  { pattern: "desert3",     tint: 0xffffff },  // a state army with a textile mill: the best sand kit on the island
    company: { pattern: "multicam",    tint: 0xf6f2ea },  // mercenaries buy the good stuff; the broadest biome coverage
    warlord: { pattern: "tigerdesert", tint: 0xffffff },  // showy elite. reads at 30 m, which is half the point of it
    militia: { pattern: "woodland",    tint: 0xf2f4ea },  // oasis farmers in oasis kit. lethal to them the moment they leave the palms
    bandit:  { pattern: "ragpatch",    tint: 0xffffff },  // nobody issued them anything
  };

  /* ============================================================ THE BAKE */
  const canvasCache = new Map();   // pattern|palette|res  -> HTMLCanvasElement
  const meanCache = new Map();     // same key             -> mean sRGB int
  const texCache = new Map();      // ...|rx|ry            -> THREE.CanvasTexture
  const matCache = new Map();      // ...|tint             -> MeshLambertMaterial

  function resOf(opts) {
    const base = Math.max(64, (opts && opts.res) || +CBZ.CONFIG.WARLORD_CAMO_RES || 256);
    // power of two or the mipmap chain silently does not exist in r128
    return 1 << Math.round(Math.log2(base));
  }
  function palOf(rec, opts) {
    const id = (opts && opts.palette) || rec.palette;
    return PAL_BY_ID[id] || PAL_BY_ID[rec.palette] || PALETTES[0];
  }

  function bake(id, opts) {
    const rec = PAT_BY_ID[id];
    if (!rec || typeof document === "undefined") return null;
    const pal = palOf(rec, opts), N = resOf(opts);
    const key = rec.id + "|" + pal.id + "|" + N;
    let c = canvasCache.get(key);
    if (c) return c;
    c = document.createElement("canvas"); c.width = c.height = N;
    const cc = c.getContext("2d");
    /* ONE stream per (pattern, palette, res). Not per call, not per wearer:
       two men in the same uniform must be wearing the SAME cloth, and a
       stream seeded off the key is the cheapest possible way to guarantee
       that across a network with no shared RNG. */
    const rnd = rngFrom(strSeed(key));
    const cols = pal.colors;
    const P = function (i) { return hx(cols[i % cols.length]); };
    cc.imageSmoothingEnabled = false;
    rec.draw(cc, N, P, rnd);
    canvasCache.set(key, c);
    meanCache.delete(key);
    return c;
  }

  /* MEAN COLOUR OF A TILE — the only property of a pattern that survives to
     200 m (see the header arithmetic). Taken by letting the browser box
     -filter the tile down to 1x1, which is the same average the GPU's top
     mip level computes, so this number IS what the distant rank shows. */
  function meanOf(id, opts) {
    const rec = PAT_BY_ID[id];
    if (!rec) return 0x808080;
    const pal = palOf(rec, opts), N = resOf(opts);
    const key = rec.id + "|" + pal.id + "|" + N;
    if (meanCache.has(key)) return meanCache.get(key);
    const src = bake(id, opts);
    if (!src) return 0x808080;
    const c = document.createElement("canvas"); c.width = c.height = 1;
    const g = c.getContext("2d");
    g.drawImage(src, 0, 0, 1, 1);
    const d = g.getImageData(0, 0, 1, 1).data;
    const m = (d[0] << 16) | (d[1] << 8) | d[2];
    meanCache.set(key, m);
    return m;
  }

  /* ---- mkTex: textures_surface.js:337-346, with the encoding line ------- */
  function anisoCap() {
    const cap = +CBZ.CONFIG.WARLORD_CAMO_ANISO || 1;
    if (cap <= 1) return 1;
    try {
      const r = CBZ.renderer;
      const max = r && r.capabilities && r.capabilities.getMaxAnisotropy ? r.capabilities.getMaxAnisotropy() : 1;
      return Math.max(1, Math.min(cap, max));
    } catch (e) { return 1; }
  }
  function mkTex(canvas, rx, ry) {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx || 1, ry || 1);
    t.anisotropy = anisoCap();
    /* ASSERTED, NOT INHERITED. r128 does default a power-of-two CanvasTexture
       to generateMipmaps + LinearMipmapLinear, but the whole 200 m case
       depends on it and a silent default is not a decision. Without mips a
       rank at 200 m samples one texel in four hundred and fizzes. */
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    // r128 spelling. renderer.outputEncoding is sRGBEncoding
    // (core/renderer.js:501), so a colour map that does not say this comes
    // out washed out and too bright — see masonryTex, which does not say it.
    if (THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding;
    t.needsUpdate = true;
    return t;
  }

  /* ============================================================ API */
  const API = {
    needs: [],
    /* NOTHING HEAVY IN boot. The contract says so and the measurement agrees:
       baking all fourteen tiles is 254 ms on this box (~18 ms each) and the
       campaign's first frame needs none of them. Everything below bakes on
       first request, and a pattern nobody wears is never drawn at all. */
    boot: function (ctx) {
      const Q = (ctx && ctx.Q) || null;
      if (Q && Q.get("camo") === "1") setTimeout(function () { gallery(ctx); }, 0);
      if (Q && Q.get("camo") === "old") console.log("[camo] reverted: flat colour, no textures");
    },

    patterns: function () { return PATTERNS.slice(); },
    pattern: function (id) { return PAT_BY_ID[id] || null; },
    palettes: function () { return PALETTES.slice(); },
    palette: function (id) { return PAL_BY_ID[id] || null; },
    ground: function () { return GROUND; },
    enabled: enabled,

    canvas: function (id, opts) { return bake(id, opts); },
    mean: function (id, opts) { return meanOf(id, opts); },

    /* THE ATLAS HOOK — the call outfits.js should reach for first.
       Stamps the cached tile into any 2d context, tiled, clipped to the rect.
       Zero new textures: a whole faction uniform is still one atlas canvas.
       `opts.tiles` is how many tile repeats fit across the rect's WIDTH;
       leave it out and it is derived from the rect's declared metres via
       `opts.metres`, or defaults to 1. */
    paint: function (cc, x, y, w, h, id, opts) {
      opts = opts || {};
      if (!enabled()) {
        cc.save(); cc.fillStyle = hx(meanOf(id, opts)); cc.fillRect(x, y, w, h); cc.restore();
        return false;
      }
      const tile = bake(id, opts);
      if (!tile) return false;
      const rec = PAT_BY_ID[id];
      const tiles = opts.tiles != null ? opts.tiles
        : (opts.metres != null ? opts.metres / rec.metres : 1);
      const s = (w / Math.max(0.01, tiles)) / tile.width;
      const p = cc.createPattern(tile, "repeat");
      if (!p) return false;
      cc.save();
      cc.beginPath(); cc.rect(x, y, w, h); cc.clip();
      cc.translate(x + (opts.offsetX || 0), y + (opts.offsetY || 0));
      cc.scale(s, s);
      cc.fillStyle = p;
      cc.fillRect(-(opts.offsetX || 0) / s, -(opts.offsetY || 0) / s, w / s, h / s);
      cc.restore();
      return true;
    },

    /* repeatFor(id, widthMetres, heightMetres) -> [rx, ry].
       BoxGeometry maps every face 0..1, so the SAME texture on a 0.92 m
       torso and a 0.34 m trouser leg is a pattern that changes size when it
       reaches the knee. This is the fix and it is why every pattern declares
       `metres`. Repeats are rounded to 1/8 so the texture cache stays small
       (see stats(): rounding took the shipped texture count from 34 to 16). */
    repeatFor: function (id, wM, hM) {
      const rec = PAT_BY_ID[id];
      const m = rec ? rec.metres : 1;
      const q = function (v) { return Math.max(0.125, Math.round(v / m * 8) / 8); };
      return [q(wM || m), q(hM == null ? (wM || m) : hM)];
    },

    /* texture(id, opts) -> cached THREE.CanvasTexture, or null when reverted.
       opts.repeat may be a number or [rx, ry]. */
    texture: function (id, opts) {
      opts = opts || {};
      if (!enabled() && opts.force !== true) return null;
      if (!THREE || !PAT_BY_ID[id]) return null;
      const rec = PAT_BY_ID[id], pal = palOf(rec, opts), N = resOf(opts);
      let rx = 1, ry = 1;
      if (Array.isArray(opts.repeat)) { rx = opts.repeat[0]; ry = opts.repeat[1]; }
      else if (opts.repeat != null) { rx = ry = +opts.repeat; }
      const key = rec.id + "|" + pal.id + "|" + N + "|" + rx + "|" + ry;
      let t = texCache.get(key);
      if (t) return t;
      const c = bake(id, opts);
      if (!c) return null;
      t = mkTex(c, rx, ry);
      t.userData = { camo: rec.id, palette: pal.id, res: N };
      texCache.set(key, t);
      return t;
    },

    /* material(id, opts) -> ONE shared MeshLambertMaterial per look.
       masonryMat's shape: colour left white so the canvas carries the
       colour, `_shared` so nothing disposes a texture three hundred men are
       wearing. `opts.tint` multiplies — THE FREE RECOLOUR: two factions in
       the same pattern at two tints cost two materials and ONE texture, so a
       new army is ~200 bytes rather than a 350 kB upload (256^2 RGBA plus its
       mip chain). It can only darken and hue-shift; use opts.palette for a
       genuinely different colourway.
       Lambert, never Standard — house rule, and camo has no specular story. */
    material: function (id, opts) {
      opts = opts || {};
      if (!THREE) return null;
      const rec = PAT_BY_ID[id];
      if (!rec) return null;
      const pal = palOf(rec, opts), N = resOf(opts);
      const tint = opts.tint == null ? 0xffffff : (opts.tint >>> 0);
      let rx = 1, ry = 1;
      if (Array.isArray(opts.repeat)) { rx = opts.repeat[0]; ry = opts.repeat[1]; }
      else if (opts.repeat != null) { rx = ry = +opts.repeat; }
      const key = rec.id + "|" + pal.id + "|" + N + "|" + rx + "|" + ry + "|" + tint + "|" + (enabled() ? 1 : 0);
      let m = matCache.get(key);
      if (m) return m;
      const tex = API.texture(id, opts);
      if (!tex) {
        /* THE REVERT, and it is a real one: no map at all, one flat colour,
           and that colour is the tile's own MEAN — so ?camo=old is honestly
           "the same army with the pattern removed" rather than a different
           army in a colour somebody typed. */
        m = new THREE.MeshLambertMaterial({ color: meanOf(id, opts) });
      } else {
        m = new THREE.MeshLambertMaterial({ color: tint, map: tex });
      }
      m._shared = true;
      m.userData = { camo: rec.id, palette: pal.id, tint: tint };
      matCache.set(key, m);
      return m;
    },

    factionDefault: function (fid) {
      const f = FACTION[fid];
      return f ? { pattern: f.pattern, tint: f.tint } : { pattern: "drab", tint: 0xffffff };
    },
    factions: function () { return FACTION; },

    /* conceal(id) -> 0..1. NOT a guess. Takes the tile's mean (what a 200 m
       viewer sees) and its internal contrast (what a 10 m viewer sees), and
       scores both against the ground the men are actually standing on.

         tone   how far the mean sits from the island's sand, in a cheap
                weighted-RGB distance (the classic 2/4/3 redmean-lite
                weighting — good enough at this budget, and it agrees with
                the eye on the one thing that matters here, which is that
                #557940 green is FAR from #9E8969 sand and #A4906A khaki is
                not).
         break  the tile's own luminance spread. Disruption is worth roughly
                a third of concealment at close range and nothing at all at
                200 m, which is why it is weighted 0.3 and tone 0.7.

       `opts.ground` names a biome from GROUND — the numbers move a lot, and
       that movement IS the gameplay: woodland scores 0.31 on a dune and 0.86
       in the oasis, and a militia that leaves the palms is visible. */
    conceal: function (id, opts) {
      opts = opts || {};
      const g = GROUND[opts.ground || "dune"] != null ? GROUND[opts.ground || "dune"] : GROUND.dune;
      const m = meanOf(id, opts);
      const dr = ((m >> 16) & 255) - ((g >> 16) & 255);
      const dg = ((m >> 8) & 255) - ((g >> 8) & 255);
      const db = (m & 255) - (g & 255);
      const dist = Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db) / Math.sqrt(9 * 255 * 255);
      const tone = 1 - clamp(dist * 2.6, 0, 1);   // 0.38 of full-range distance = fully exposed
      const brk = clamp(spreadOf(id, opts) / 46, 0, 1);
      /* MULTIPLICATIVE, NOT ADDITIVE, and the salt pan is why. The first
         version scored tone*0.7 + brk*0.3, which let a LOUD pattern buy
         concealment with contrast alone: the tribal robe — seven stripes of
         indigo and madder on ecru, the one thing in this library that is
         explicitly not camouflage — scored 0.73 on the pan and beat the salt
         crust pattern that exists for it. Disruption is worthless without
         tone. A green man on orange sand is not helped by having shapes on
         him; break-up only pays once you are already the right colour, so it
         scales the tone term instead of being added to it. */
      return Math.round(tone * (0.7 + 0.3 * brk) * 100) / 100;
    },

    stats: function () {
      const N = resOf(null);
      // r128 uploads RGBA8 and a full mip chain is 4/3 of the base level
      let bytes = 0;
      texCache.forEach(function () { bytes += N * N * 4 * 4 / 3; });
      return {
        canvases: canvasCache.size, textures: texCache.size, materials: matCache.size,
        res: N, bytes: Math.round(bytes), mb: Math.round(bytes / 1048576 * 100) / 100,
      };
    },

    dispose: function () {
      texCache.forEach(function (t) { try { t.dispose(); } catch (e) {} });
      matCache.forEach(function (m) { try { m.dispose(); } catch (e) {} });
      texCache.clear(); matCache.clear(); canvasCache.clear(); meanCache.clear();
    },
  };

  /* internal: luminance spread of a tile, sampled on a 32x32 grid rather
     than every texel — 1024 samples settles the standard deviation to
     within a point and costs a tenth of a full getImageData scan. */
  const spreadCache = new Map();
  function spreadOf(id, opts) {
    const rec = PAT_BY_ID[id];
    if (!rec) return 0;
    const pal = palOf(rec, opts), N = resOf(opts);
    const key = rec.id + "|" + pal.id + "|" + N;
    if (spreadCache.has(key)) return spreadCache.get(key);
    const src = bake(id, opts);
    if (!src) return 0;
    const c = document.createElement("canvas"); c.width = c.height = 32;
    const g = c.getContext("2d");
    g.drawImage(src, 0, 0, 32, 32);
    const d = g.getImageData(0, 0, 32, 32).data;
    let s = 0, s2 = 0;
    for (let i = 0; i < 1024; i++) {
      const L = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
      s += L; s2 += L * L;
    }
    const mean = s / 1024;
    const sd = Math.sqrt(Math.max(0, s2 / 1024 - mean * mean));
    spreadCache.set(key, sd);
    return sd;
  }
  API.spread = spreadOf;

  /* ============================================================ ?camo=1
     THE DEBUG GALLERY. Deliberately 2d and deliberately dependent on nothing
     but this file: it has to answer "does this pattern read" on a page where
     outfits.js, wardrobe.js and the battle may not exist yet.

     Three columns, and the third one is the whole point: the same pattern on
     a man-shaped silhouette over real island sand at THREE sizes — 100%,
     22% and 6% of the close plate — which stand in for roughly 3 m, 14 m and
     50 m. It is not a substitute for the 200 m render (nothing in 2d is: a
     browser's downscale is not the GPU's mip chain plus a lighting pass) but
     it catches the two cheap failures — a palette that is too bright and a
     feature scale that vanishes — in one glance and without a build. */
  function gallery(ctx) {
    const scr = ctx && ctx.screen ? ctx.screen : null;
    const sand = hx(GROUND.dune), crest = hx(GROUND.crest);
    let html = '<h1 class="wl-h">CAMO <em>GALLERY</em></h1>' +
      '<p class="wl-sub">' + PATTERNS.length + ' PATTERNS · TILE ' + resOf(null) + 'PX · GROUND ' + sand + '</p>' +
      '<div id="camogal"></div>';
    const node = scr ? scr(html) : (function () {
      document.body.innerHTML = '<div style="padding:18px;font:600 14px system-ui;color:#f4ecd8;background:#120e09">' + html + '</div>';
      return document.body;
    })();
    const host = node.querySelector ? node.querySelector("#camogal") : document.getElementById("camogal");
    if (!host) return;
    host.style.cssText = "display:flex;flex-direction:column;gap:12px";

    PATTERNS.forEach(function (rec) {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:12px;align-items:center;border:1px solid rgba(255,255,255,.12);" +
        "border-radius:12px;padding:10px;background:rgba(255,255,255,.03)";
      const tile = bake(rec.id, null);
      const sw = document.createElement("canvas");
      sw.width = sw.height = 128; sw.style.cssText = "width:128px;height:128px;border-radius:8px;flex:0 0 auto";
      sw.getContext("2d").drawImage(tile, 0, 0, 128, 128);
      row.appendChild(sw);

      const txt = document.createElement("div");
      txt.style.cssText = "flex:1 1 auto;min-width:150px";
      const cd = API.conceal(rec.id), cs = API.conceal(rec.id, { ground: "salt" });
      const co = API.conceal(rec.id, { ground: "oasis" }), cr = API.conceal(rec.id, { ground: "rock" });
      txt.innerHTML = '<div style="font-size:15px;letter-spacing:.06em">' + rec.label +
        (rec.loud ? ' <span style="color:#ff8a3d">LOUD</span>' : '') + '</div>' +
        '<div style="opacity:.5;font-size:11px;margin:3px 0 6px">' + rec.family + ' · ' + rec.metres + ' m/tile · mean ' + hx(meanOf(rec.id, null)) + '</div>' +
        '<div style="opacity:.75;font-size:12px;font-weight:500">' + rec.note + '</div>' +
        '<div style="font-size:11px;margin-top:6px;opacity:.85">conceal — dune <b>' + cd + '</b> · pan <b>' + cs +
        '</b> · rock <b>' + cr + '</b> · oasis <b>' + co + '</b></div>';
      row.appendChild(txt);

      // ---- the cloth column: a man over real sand, at three ranges -------
      /* THE MAN HAS TO BE BIG ENOUGH TO JUDGE. The first gallery drew him
         104 px tall, which at 0.54 m of torso across a 0.9 m tile is 0.6 of
         one tile — every close-up read as a single blob of colour and the
         gallery could not answer the question it exists to answer. 190 px is
         about a metre of cloth on screen, which is where the geometry shows. */
      const men = document.createElement("canvas");
      men.width = 420; men.height = 210;
      men.style.cssText = "width:420px;height:210px;border-radius:8px;flex:0 0 auto";
      const g = men.getContext("2d");
      const grad = g.createLinearGradient(0, 0, 0, 210);
      grad.addColorStop(0, crest); grad.addColorStop(1, sand);
      g.fillStyle = grad; g.fillRect(0, 0, 420, 210);
      // one man at three heights: 190 px ~ 3 m away, 46 px ~ 12 m, 13 px ~ 45 m
      [[14, 190, 1], [230, 46, 0.24], [330, 13, 0.07]].forEach(function (s) {
        drawMan(g, rec.id, s[0], 200, s[1]);
        // a RANK at the small sizes — one man tells you nothing about whether
        // an army reads as one army
        if (s[2] < 1) for (let k = 1; k < (s[2] < 0.1 ? 12 : 4); k++) drawMan(g, rec.id, s[0] + k * s[1] * 0.8, 200, s[1]);
      });
      row.appendChild(men);
      host.appendChild(row);
    });

    const s = API.stats();
    const foot = document.createElement("div");
    foot.style.cssText = "opacity:.5;font-size:11px;margin-top:8px";
    foot.textContent = "canvases " + s.canvases + " · textures " + s.textures + " · " + s.mb + " MB of texture · res " + s.res;
    host.appendChild(foot);
  }

  // a 1.8 m man in boxes, filled with the pattern at the right physical
  // scale for his size. Crude on purpose: the question this answers is
  // "does the cloth read", not "is the anatomy right".
  function drawMan(g, id, x, baseY, h) {
    const rec = PAT_BY_ID[id];
    const mPerPx = 1.8 / h;
    const torsoW = h * 0.30, torsoH = h * 0.34, legW = h * 0.12, legH = h * 0.42, headR = h * 0.075;
    const y0 = baseY - h;
    g.save();
    g.fillStyle = "#6b4f36";
    g.beginPath(); g.arc(x + torsoW / 2, y0 + headR, headR, 0, Math.PI * 2); g.fill();
    const tiles = torsoW * mPerPx / rec.metres;
    API.paint(g, x, y0 + headR * 2, torsoW, torsoH, id, { tiles: Math.max(0.05, tiles) });
    API.paint(g, x, y0 + headR * 2 + torsoH, legW, legH, id, { tiles: Math.max(0.02, legW * mPerPx / rec.metres) });
    API.paint(g, x + torsoW - legW, y0 + headR * 2 + torsoH, legW, legH, id, { tiles: Math.max(0.02, legW * mPerPx / rec.metres) });
    g.restore();
  }
  API.gallery = gallery;
  API.drawMan = drawMan;

  if (W.module) W.module("camo", API);
  else { CBZ.warlord = W; W.camo = API; }
})();
