/* ============================================================
   warlord/wardrobe.js — WHAT YOU WEAR, and what it costs to be allowed to.

   OWNER, verbatim: "make a bunch of outfits for this game, generals, and take
   the suits too — those are good for this game. Player should pick army
   uniform, and black suit like fucking secret service should be an option,
   and player sets their own outfit."

   So this file owns exactly one fact — `W.state.you.fit` — and everything
   that reads it: a full-screen picker, the paint that puts the fit on a body,
   the rank ladder that decides which fits you are allowed to touch yet, and
   the officer version your own veterans wear so an army reads as YOURS.

   ------------------------------------------------------------------
   WHERE THE CLOTHES COME FROM, AND WHY THERE IS NO SECOND PAINTER

   Two files already do this job well and neither of them is mine.

   `warlord/outfits.js` (sibling wave) dresses every army on the island, and
   it solved every hard part: the hand-off to the painted-garment atlas, the
   camo materials camo.js makes, `readable()` — which pushes any cloth colour
   off the sand's own luminance so a khaki uniform is not invisible at 200 m —
   weathering, webbing, a badge, and the whole headwear ladder (bare / rag /
   shemagh / cap / beret / helmet). Its header names the player's wardrobe as
   a consumer and it ships `player(spec)` for exactly this file. So the
   wardrobe hands it a record and it does the painting: `W.outfits.apply`.

   `city/clothes.js` is the atlas underneath that — one 128x256 canvas per
   outfit KEY, one CanvasTexture, one shared MeshLambertMaterial, and lapels,
   plackets, cargo pockets, a tie with a knot in it and camo blots come free
   at the same draw-call cost as a flat box. outfits.js pulls it in already;
   `ready()` below only waits for the exported NAME and appends its own script
   tag if nobody else did, so the picker is never blocked on a sibling.

   city/outfits.js is deliberately NOT pulled in — the same judgement
   warlord/outfits.js states at length: it opens `const g = CBZ.game`, owns a
   disguise/heat/economy model, installs save wraps and runs a per-frame
   integrity sweep over CBZ.npcs, none of which means anything on a page whose
   people are warband rosters. What this file wants from it is the CATALOGUE,
   and a catalogue is data: the colour sets below are cited by their
   city/outfits.js record id and copied verbatim.

   The first draft of this file wrote its own flat painter over five body
   regions. That was wrong twice: a black suit painted as five flat colours
   reads as a black bin bag (it is in the first contact sheet), and it would
   have been the fifth copy of the clone-on-write bug city/outfits.js
   explicitly named a function to stop anybody writing again.

   THE SUITS ARE TAKEN ACROSS BY NAME, not by copying hexes: SUIT_LOOKS below
   names Charcoal / Navy / Black / Navy Pinstripe / Charcoal Pinstripe /
   Navy Double-Breasted / Charcoal 3-Piece / Burgundy 3-Piece / Tan / Olive /
   Powder-Blue / All-White / Brown Glen-Check / Grey Windowpane / Black Shawl
   Tuxedo / Midnight-Blue Tuxedo / White Dinner Jacket out of
   `CBZ.citySuitStyles`, resolved by NAME at boot so the city can reorder or
   extend that table without silently redressing this game (its own comment
   says the indices are a contract — resolving by name means we never rely on
   one).

   THE ONES THIS WORLD NEEDS AND THE CITY NEVER HAD are APPENDED to that same
   table (`WL_STYLES`), which is the extension point city/clothes.js documents
   in its own words: "Append new styles to the END only; never reorder." That
   buys, through the shipped suit painter and with no new code:
     · a true SECRET-SERVICE BLACK SUIT — near-black jacket, white shirt,
       BLACK tie. The city's "Black Suit" wears a light-grey tie, which is a
       banker, not a detail. This is the fit the owner asked for by name.
     · the DRESS TUNICS every general in this file wears. A service dress
       coat IS a suit — a body colour, a lapel, a shirt and a tie — so a sand
       double-breasted peak-lapel coat is one table row, not a new painter.

   ------------------------------------------------------------------
   HOW A GENERAL IS EARNED — and why the numbers are not invented

   core.js already answers "what is this many men": W.BAND_CLASSES names a
   crew (2-9), a band (10-40), a company (40-120) and an army (120-320). That
   table is the game's own opinion about scale, so the wardrobe rides it
   rather than inventing a second ladder. Five rungs, read live off
   BAND_CLASSES so this file follows if that table is ever retuned:

     RIDER      standing 0    what you rode out in, the field kit, THE SUIT
     CAPTAIN    standing 10   (band.lo)     line uniforms with rank on them
     COMMANDER  standing 40   (company.lo)  officer's field dress
     GENERAL    standing 120  (army.lo)     the dress coat, braid, medals
     WARLORD    standing 320  (army.hi)     bigger than anything the island
                                            fields — greatcoat, sash, cape

   `standing = W.armySize() + floor(fame/8)`. Fame is a second road to the
   same place and not a replacement for one: core caps its own reputation
   term at fame/900, and 900/8 = 112 ~= one company — so at maximum renown
   your name is worth a company of men, and you STILL have to raise an army
   to put on a general's coat. Men are the rank; fame is a discount.

   THE BLACK SUIT IS RANK 0 ON PURPOSE. It is the joke and the flex, and a
   joke you unlock at 120 men is a joke nobody ever sees.

   ------------------------------------------------------------------
   YOUR OFFICERS TOO. Every fit names a `family` and a `role`
   (line/nco/officer/general). `W.wardrobe.fitForSoldier(s)` maps a soldier's
   tier onto the same family you are wearing — veterans get the officer
   version, soldiers the NCO version, levies and raiders the line version —
   so battle.js/outfits.js can dress your roster and the whole army reads as
   one force instead of forty strangers. That is the hook they call.

   FLAGS
     ?wardrobe=old   full revert: no fit applied, no cast wrap, no chip.
     ?wardrobe=1     open the picker straight away (never blocked on siblings)

   OWNED EVENTS
     wardrobe:changed  {id, fit}   the worn fit changed
     wardrobe:open  wardrobe:close
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.warlord) return;
  const W = CBZ.warlord;

  let ctx = null, THREE = null, Q = null;
  let OFF = false;                      // ?wardrobe=old

  /* ============================================================ THE CITY
     WARDROBE, LOADED LATE.

     Two files, appended once, resolved through one promise. Everything in
     this module that paints goes through `ready()`, so a rig that asks to be
     dressed before the painter lands is REMEMBERED and repainted the moment
     it does — that is the only reason `pending` exists. A page where both
     fetches fail still runs: `paintFlat` below is the honest degrade (region
     colours, no atlas), and it is never the normal path. */
  let clothesP = null;
  function inDoc(rel) {
    const tags = document.getElementsByTagName("script");
    for (let i = 0; i < tags.length; i++) {
      const src = tags[i].getAttribute("src");
      if (src && src.indexOf(rel) >= 0) return true;
    }
    return false;
  }
  function ready() {
    if (clothesP) return clothesP;
    clothesP = new Promise(function (res) {
      if (CBZ.cityApplyClothes) return res(true);
      /* WAIT ON THE NAME, NOT ON THE TAG. The first draft resolved as soon as
         a matching <script src> existed in the document — and outfits.js has
         already appended exactly that tag, so this resolved BEFORE clothes.js
         had executed. CBZ.citySuitStyles was still undefined, installStyles()
         bailed, every suit fell back to style index 0, and the black suit came
         out charcoal-going-on-olive. Poll the exported name, the way
         outfits.js's own gallery waits for it. */
      if (!inDoc("city/clothes.js") && CBZ.studio && CBZ.studio.root) {
        const t = document.createElement("script");
        t.src = CBZ.studio.root + "city/clothes.js";
        t.async = false;
        t.onerror = function () { console.warn("[wardrobe] city/clothes.js absent — flat fits only"); };
        document.head.appendChild(t);
      }
      let n = 0;
      const iv = setInterval(function () {
        if (CBZ.cityApplyClothes || ++n > 240) { clearInterval(iv); res(!!CBZ.cityApplyClothes); }
      }, 25);
    }).then(function (ok) { installStyles(); flushPending(); return ok; });
    return clothesP;
  }

  /* ============================================================ SUIT STYLES
     The city's table, extended. `installStyles` runs exactly once, after
     clothes.js is up, and does two things: resolves the city's own styles by
     NAME into SUIT_IDX, then appends this game's own.

     Appending is the documented contract in city/clothes.js ("Append new
     styles to the END only"): a suit's texture cache key is "suit|<index>",
     so a new row at the end is a new atlas and cannot disturb an existing
     one. Nothing else in this game reads those indices by number. */
  const WL_STYLES = [
    /* THE ONE THE OWNER ASKED FOR. The city's "Black Suit" ships a light-grey
       tie (0x9a9da3) — that is a banker at a funeral. A detail wears a black
       tie on a white shirt, and the body is lifted off true black by the same
       0x06 the tuxedo's own comment argues for, so shading reads at all. */
    { name: "Detail Black",        body: 0x121318, tie: 0x08090c, pattern: "solid", legs: 0x101115 },
    { name: "Detail Charcoal",     body: 0x262a31, tie: 0x101216, pattern: "solid", legs: 0x22252b },
    { name: "Detail Midnight",     body: 0x151b2c, tie: 0x0b0e18, pattern: "solid", legs: 0x131826 },
    /* SERVICE DRESS. A tunic is a suit with a military palette: the shirt and
       tie under an open coat is exactly what a class-A uniform looks like. */
    { name: "Sand Service Tunic",  body: 0xae9670, tie: 0x33291b, pattern: "solid", legs: 0xa28a64 },
    { name: "Olive Service Tunic", body: 0x565c3a, tie: 0x1d2016, pattern: "solid", legs: 0x4b5131 },
    { name: "Legion Dress Tunic",  body: 0x8d7930, tie: 0x241f10, pattern: "solid", legs: 0x7d6b2a, vest: 0x6d5c23 },
    /* GENERALS. Double-breasted + peak lapel is the whole silhouette read at
       this poly count: the front fastens FLAT (clothes.js cuts a narrower V
       for db) and the peak wedges widen the shoulder. Braid, sash and medals
       are meshes this file adds on top. */
    { name: "Sand Dress Coat",     body: 0xa08862, tie: 0x241d13, pattern: "solid", legs: 0x957e59, db: true, lapel: "peak" },
    { name: "Olive Dress Coat",    body: 0x505630, tie: 0x191c12, pattern: "solid", legs: 0x464b29, db: true, lapel: "peak" },
    { name: "Slate Dress Coat",    body: 0x3a414c, tie: 0x13161b, pattern: "solid", legs: 0x333944, db: true, lapel: "peak" },
    { name: "Night Staff Coat",    body: 0x191c23, tie: 0x0c0e12, pattern: "solid", legs: 0x16181e, db: true, lapel: "peak" },
    { name: "Oxblood Marshal Coat", body: 0x50202a, tie: 0x14161a, pattern: "solid", legs: 0x421922, db: true, lapel: "peak" },
    { name: "Bone Parade Coat",    body: 0xc2b89e, tie: 0x22201a, pattern: "solid", legs: 0xb6ac92, db: true, lapel: "peak" },
  ];
  /* The city styles this game takes across, by name. A name that is not in
     the table (an older engine build) simply produces no tile — never a
     wrong suit, and never a crash. */
  const SUIT_LOOKS = [
    "Charcoal Suit", "Navy Suit", "Mid-Grey Suit", "Black Suit",
    "Navy Pinstripe Suit", "Charcoal Pinstripe Suit",
    "Navy Double-Breasted Suit", "Charcoal Double-Breasted Suit",
    "Charcoal 3-Piece Suit", "Burgundy 3-Piece Suit",
    "Tan Suit", "Olive Suit", "Powder-Blue Suit", "All-White Suit",
    "Brown Glen-Check Suit", "Grey Windowpane Suit",
    "Black Shawl Tuxedo", "Midnight-Blue Tuxedo", "White Dinner Jacket",
    "Double-Breasted Peak Tuxedo",
  ];
  const SUIT_IDX = {};                  // style name -> index into citySuitStyles
  let stylesIn = false;
  function installStyles() {
    if (stylesIn) return;
    const tbl = CBZ.citySuitStyles;
    if (!tbl || !tbl.length) return;
    stylesIn = true;
    for (let i = 0; i < tbl.length; i++) if (tbl[i] && tbl[i].name) SUIT_IDX[tbl[i].name] = i;
    for (let i = 0; i < WL_STYLES.length; i++) {
      const s = WL_STYLES[i];
      if (SUIT_IDX[s.name] != null) continue;      // a reload must not double-append
      SUIT_IDX[s.name] = tbl.length;
      tbl.push(s);
    }
    /* AND RE-RESOLVE THE SWATCHES. The catalogue is built at module eval, when
       clothes.js has not run and CBZ.citySuitStyles does not exist yet — so
       every fit that names a CITY suit got the generic navy fallback for its
       colours and the whole suits tab drew the same navy tile. The atlas was
       always right (it reads the style, not the record), but the swatch, the
       flat pelvis and the boots were not. One pass, the moment the table is
       real. */
    for (let i = 0; i < ORDER.length; i++) {
      const f = FIT[ORDER[i]];
      if (f && f.style != null) f.colors = styleColors(f.style);
    }
  }
  // the body/leg hexes for a style, so a tile swatch and the flat fallback
  // describe the same garment the atlas will paint.
  function styleColors(name) {
    const tbl = CBZ.citySuitStyles;
    let s = null;
    if (tbl && SUIT_IDX[name] != null) s = tbl[SUIT_IDX[name]];
    if (!s) for (let i = 0; i < WL_STYLES.length; i++) if (WL_STYLES[i].name === name) s = WL_STYLES[i];
    if (!s) s = { body: 0x1c2030, legs: 0x14161c };
    const body = s.body != null ? s.body : 0x1c2030;
    const legs = s.legs != null ? s.legs : shade(body, -0.08);
    return { legs: legs, torso: body, collar: shade(body, 0.14), arms: body,
             shoes: s.tux ? 0x08090c : 0x0c0d10, gloss: !!s.tux };
  }
  function shade(n, amt) {
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (amt > 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
    else { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
    return ((r | 0) << 16) | ((g | 0) << 8) | (b | 0);
  }
  function hex6(n) { return "#" + ("000000" + ((n | 0) >>> 0).toString(16)).slice(-6); }

  /* ============================================================ THE LADDER
     Read off core's own BAND_CLASSES so there is exactly one opinion in this
     game about what a number of men means. The literals are the fallback for
     a core.js that predates the table, and they are that table's values. */
  function classes() {
    const B = W.BAND_CLASSES;
    if (B && B.length >= 4) return B;
    return [{ lo: 2, hi: 9 }, { lo: 10, hi: 40 }, { lo: 40, hi: 120 }, { lo: 120, hi: 320 }];
  }
  function rungs() {
    const B = classes();
    return [
      { at: 0,          label: "RIDER",   note: "you and a pistol" },
      { at: B[1].lo,    label: "CAPTAIN", note: "a band behind you" },
      { at: B[2].lo,    label: "COMMANDER", note: "a company behind you" },
      { at: B[3].lo,    label: "GENERAL", note: "an army behind you" },
      { at: B[3].hi,    label: "WARLORD", note: "more men than the island fields" },
    ];
  }
  /* MEN ARE THE RANK; FAME IS A DISCOUNT. /8 because core caps its own
     reputation term at fame/900 and 900/8 = 112, one company — the most
     renown alone can ever be worth is the rung below a general's. */
  function standing() {
    const S = W.state;
    const men = W.armySize ? W.armySize() : ((S.army && S.army.length) || 0) + 1;
    return men + Math.floor(((S && S.fame) || 0) / 8);
  }
  function rankOf(n) {
    const R = rungs();
    let out = R[0];
    for (let i = 0; i < R.length; i++) if (n >= R[i].at) out = R[i];
    return out;
  }

  /* ============================================================ THE KIT
     The meshes that make cloth read as RANK. A dress coat painted onto a
     torso is a dark box; braid, a sash, a medal block and a peaked cap are
     what a person actually reads as "general" at 40 px tall, and none of them
     exists in the city atlas because a city has no generals in it.

     Everything here is a cached box (CBZ.boxGeom) with a cached material
     (CBZ.cmat) parented to a rig node that already animates, so the whole
     kit costs no update code: a sash on the chest swings with the chest.

     One group per rig (`rig._wlKit`), thrown away and rebuilt on every
     dress, because a re-dress that leaves yesterday's medals on today's
     fatigues is the exact failure city/outfits.js's bandana clear exists to
     stop. */
  /* WHY EVERY KIT COLOUR IS GAMMA-DECODED BEFORE IT REACHES A MATERIAL.

     Authored 0xd9b64a gold rendered CREAM and an authored 0x8d2c33 deep red
     sash rendered PINK. Both are in the first contact sheet, and the first
     attempt at fixing them — scale the hex down by 0.42 — barely moved them,
     which is the clue that this is not an exposure problem.

     It is the missing half of a colour pipeline. microboot's renderer sets
     outputEncoding = sRGB (this file's preview copies it, and so does the
     game), but r128 has no ColorManagement: a material colour is taken as-is
     and treated as LINEAR, and only the final frame is encoded to sRGB. So an
     authored sRGB hex goes into the render one gamma step too bright and
     comes out lifted — worked through for the sash, 0x8d2c33 lands on screen
     at about rgb(148,92,97), which is exactly the pink in the plate.

     Decoding the author's hex on the way in is what colour management would
     do, so `lin()` does it: pow(c, 2.2). After it, an ornament renders at
     roughly the hex it was written as, which is the only way a palette can be
     reasoned about at all. `enc()` is the inverse and exists for the one
     colour that arrives from the OTHER side of the pipeline — a hex read back
     off a painted atlas is already a linear-space value that renders true, so
     it is encoded first and then decoded, i.e. left alone.

     The painted garments do not need this: clothes.js authored and shaded
     those canvases against this same pipeline, which is why a black suit was
     already black while a black coat panel beside it was slate. */
  function lin(n) {
    const f = function (v) { return Math.round(255 * Math.pow(v / 255, 2.2)); };
    return (f((n >> 16) & 255) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255);
  }
  function enc(n) {
    const f = function (v) { return Math.round(255 * Math.pow(v / 255, 1 / 2.2)); };
    return (f((n >> 16) & 255) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255);
  }
  function box(w, h, d, hex) {
    const g = CBZ.boxGeom ? CBZ.boxGeom(w, h, d) : new THREE.BoxGeometry(w, h, d);
    const c = lin(hex);
    const m = CBZ.cmat ? CBZ.cmat(c) : new THREE.MeshLambertMaterial({ color: c });
    return new THREE.Mesh(g, m);
  }
  function clearKit(rig) {
    const k = rig && rig._wlKit;
    if (!k) return;
    for (let i = 0; i < k.length; i++) {
      const n = k[i];
      if (n && n.parent) n.parent.remove(n);
    }
    rig._wlKit = null;
  }
  // how far in front of the chest an ornament has to sit to clear whatever is
  // being worn. A painted jacket is a real inflated shell (clothes.js builds
  // it at profile.jacketD ~= torsoD + 0.10) and a medal pinned at torsoD/2
  // sinks INTO it — that was the first draft's "generals with no medals".
  function chestZ(rig) {
    const P = rig.profile || {};
    const tD = P.torsoD || 0.5;
    let d = tD;
    const jm = rig._jacketMesh;
    if (jm && jm.visible) {
      const gp = jm.geometry && jm.geometry.parameters;
      d = (gp && gp.depth) || P.jacketD || (tD + 0.12);
    }
    return d / 2 + 0.018;
  }
  function chestBox(rig) {
    const P = rig.profile || {};
    const waistH = (P.torsoH || 0.95) * (P.waistShare || 0);
    return { w: P.torsoW || 0.92, h: (P.torsoH || 0.95) - waistH, d: P.torsoD || 0.5 };
  }

  function buildKit(rig, fit) {
    clearKit(rig);
    const K = fit.kit || {};
    const out = [];
    const add = function (parent, mesh) { if (parent && mesh) { parent.add(mesh); out.push(mesh); } };
    const neck = rig.neck, chest = rig.skinSlots && rig.skinSlots.torso && rig.skinSlots.torso[0];
    const yoke = rig.skinSlots && rig.skinSlots.collar && rig.skinSlots.collar[0];
    const P = rig.profile || {};
    const hs = P.headSize || 0.6, k = hs / 0.6;
    const cb = chestBox(rig), zF = chestZ(rig);

    /* HEADWEAR. studio.cast("officer") builds the rig with a cap, and
       character.js's `if (c.cap) {...} else {hair}` means such a rig has NO
       HAIR MESH AT ALL. So the engine cap is always hidden here and this file
       draws every hat itself (the engine one is a crown box plus a slab brim
       — it cannot be a beret or a shemagh), and a bare-headed fit on a
       cap-built rig gets a cropped hair shell so the warlord is not bald in a
       suit and haired in the preview. */
    if (rig.skinSlots) {
      const caps = rig.skinSlots.cap || [];
      for (let i = 0; i < caps.length; i++) if (caps[i]) caps[i].visible = false;
      /* A BARE HEAD ON A CAP-BUILT RIG IS A BALD HEAD. character.js branches
         `if (c.cap) {...} else {hair}` at BUILD time, and studio.cast's
         `officer` row passes a cap — so the player's rig has two cap boxes
         and no hair mesh at all, and hiding the cap for the black suit leaves
         a bald man. outfits.js's headwear only toggles the hair it finds, so
         when there is none this draws a cropped shell: two boxes, cached
         geometry, and the warlord keeps his head. */
      const hair = rig.skinSlots.hair || [];
      const bare = !K.head;
      for (let i = 0; i < hair.length; i++) if (hair[i]) hair[i].visible = bare;
      if (bare && !hair.length && neck) {
        const hairHex = K.hair != null ? K.hair : 0x1b1712;
        const sh = box(hs * 1.03, hs * 0.30, hs * 1.02, hairHex);
        sh.position.set(0, hs * 0.90, -hs * 0.02);
        add(neck, sh);
        const nape = box(hs * 0.95, hs * 0.34, hs * 0.18, hairHex);
        nape.position.set(0, hs * 0.60, -hs * 0.45);
        add(neck, nape);
      }
    }
    const hcol = K.headColor != null ? K.headColor : (fit.colors && fit.colors.torso) || 0x2b3223;
    const trim = K.trim != null ? K.trim : shade(hcol, -0.3);
    /* EVERY HAT EXCEPT THE PEAKED CAP IS outfits.js'S — see SIB_HEAD. This
       branch draws the one it does not have, and it is four parts, all of
       which matter: a crown that flares forward, a dark band, a HARD VISOR
       set below the band, and one gold badge. Drop any of them and a general
       is wearing a baseball cap. */
    if (K.head === "peaked") {
      /* PROPORTION IS THE WHOLE HAT. The first cut made the band 0.72 wide
         against a 0.60 head — 6 cm of overhang each side — and it read as a
         mortarboard, a flat plate the man was balancing. A service cap's band
         is HEAD WIDTH and only the crown flares over it; the visor is
         narrower still and tilts down hard enough to shade the eyes. */
      const band = box(0.63 * k, 0.075 * k, 0.63 * k, trim);
      band.position.set(0, hs + 0.020 * k, 0); add(neck, band);
      const crown = box(0.69 * k, 0.20 * k, 0.63 * k, hcol);
      crown.position.set(0, hs + 0.145 * k, 0.020 * k); add(neck, crown);
      const visor = box(0.56 * k, 0.040 * k, 0.26 * k, shade(trim, -0.3));
      visor.position.set(0, hs - 0.012 * k, 0.40 * k); visor.rotation.x = 0.30; add(neck, visor);
      const badge = box(0.09 * k, 0.10 * k, 0.03 * k, K.badgeColor != null ? K.badgeColor : 0xe8c454);
      badge.position.set(0, hs + 0.135 * k, 0.325 * k); add(neck, badge);
    }
    /* SUNGLASSES AND AN EARPIECE — the two details that turn a black suit
       into a DETAIL. The wire matters more than the bud: a coiled clear lead
       running from the ear down behind the collar is the single most
       recognisable thing about close protection, and it is one thin box. */
    if (K.shades && neck) {
      const g1 = box(0.52 * k, 0.10 * k, 0.05 * k, 0x0c0d11);
      g1.position.set(0, hs * 0.60, hs * 0.50); add(neck, g1);
      const arm = box(0.60 * k, 0.03 * k, 0.03 * k, 0x14161b);
      arm.position.set(0, hs * 0.61, hs * 0.30); add(neck, arm);
    }
    if (K.earpiece && neck) {
      const bud = box(0.06 * k, 0.08 * k, 0.06 * k, 0xdcd8cf);
      bud.position.set(hs * 0.46, hs * 0.56, hs * 0.06); add(neck, bud);
      const wire = box(0.022 * k, 0.30 * k, 0.022 * k, 0xd2cec5);
      wire.position.set(hs * 0.44, hs * 0.28, -hs * 0.06); wire.rotation.z = 0.14; add(neck, wire);
    }
    /* EPAULETTES ride the SHOULDER YOKE, which is the slab character.js calls
       `collar` — it is the top of the torso column and it is exactly where a
       board sits on a real tunic. */
    if (K.epaulettes && yoke) {
      /* A SHOULDER BOARD HAS TO CLEAR THE COAT. The yoke slab is 0.52 deep
         and clothes.js's jacket shell is 0.62, so the first boards were built
         INSIDE the coat and no general had any. Sized off the shell's own
         depth plus a margin, and lifted clear of the slab's top face. */
      const cw = P.collarW || 0.94, chh = P.collarH || 0.18;
      const dep = ((P.jacketD || (P.torsoD || 0.5) + 0.12)) + 0.06;
      const ex = cw / 2 - 0.12;
      for (let s2 = -1; s2 <= 1; s2 += 2) {
        const ep = box(0.21, 0.05, dep, K.epauletteColor != null ? K.epauletteColor : trim);
        ep.position.set(s2 * ex, chh / 2 + 0.008, 0);
        add(yoke, ep);
        if (K.pips) {
          for (let p2 = 0; p2 < K.pips; p2++) {
            const pip = box(0.034, 0.020, 0.034, 0xf0dc9a);
            pip.position.set(s2 * ex, chh / 2 + 0.040, dep * 0.5 - 0.09 - p2 * 0.062);
            add(yoke, pip);
          }
        }
      }
    }
    if (chest) {
      /* THE SASH. One long thin box rotated across the chest, plus a lighter
         edge strip so it does not read as a painted stripe. Right shoulder to
         left hip is the way it is worn nearly everywhere. */
      if (K.sash != null) {
        /* LENGTH IS MEASURED, NOT GUESSED. At 1.5x the chest the sash
           overshot the shoulder by 11 cm and left a floating red stub in the
           air above it. Rotated by A, a bar of length L covers L*cos(A)
           vertically, so L = chestH / cos(0.6) is exactly shoulder-to-hip and
           nothing hangs off the top. */
        const L = cb.h / Math.cos(0.6);
        const s1 = box(0.155, L, 0.030, K.sash);
        s1.position.set(0, 0, zF); s1.rotation.z = 0.60; add(chest, s1);
        const s2 = box(0.032, L, 0.032, shade(K.sash, 0.35));
        s2.position.set(0.078, 0, zF + 0.001); s2.rotation.z = 0.60; add(chest, s2);
      }
      /* MEDALS ARE A BLOCK, NOT MEDALS. Eight ribbons in two rows on the left
         chest: at this scale the individual award is invisible and the BLOCK
         is the whole read. Colours are a fixed ribbon palette walked in order
         — deterministic, because two players in the same multiplayer match
         must see the same chest. */
      if (K.medals) {
        const RIB = [0x8f2c2c, 0x2d4f8f, 0x5c7d34, 0xc8a53a, 0x6b3a7d, 0x2f7d78, 0xb8632a, 0x8a8f97];
        const n = Math.min(8, K.medals | 0 || 6);
        for (let i = 0; i < n; i++) {
          const col = i % 4, row = (i / 4) | 0;
          const rib = box(0.062, 0.050, 0.016, RIB[i % RIB.length]);
          rib.position.set(-0.31 + col * 0.067, cb.h * 0.20 - row * 0.056, zF);
          add(chest, rib);
        }
        const bar = box(0.275, 0.011, 0.018, 0xc9a83c);
        bar.position.set(-0.209, cb.h * 0.20 + 0.033, zF); add(chest, bar);
      }
      /* AIGUILLETTE. A shoulder cord and two loops off the right shoulder —
         the thing that says "staff officer" faster than any amount of braid
         painted flat on a texture. */
      if (K.braid) {
        /* WHAT ACTUALLY READS AS GOLD RANK ON A BOX MAN.
           Two attempts at an aiguillette failed for the same reason: a cord is
           a few millimetres of braid, and anything a few millimetres wide on
           this rig is either invisible or — at 26 mm, where it finally showed
           up — a giant gold CHECKMARK and then a giant gold EXCLAMATION MARK
           painted on a general's chest. Both are in the contact sheet. The
           lesson is that a shape only reads here if it follows an edge of the
           body, so the braid moved to the two places rank braid actually
           lives on a real dress uniform AND that this geometry can carry:
             CUFF RINGS — a band right round each forearm. This is the naval
               officer read, it survives being 40 px tall, and the sleeve is a
               box so the ring is a box.
             GORGET PATCHES — two small tabs either side of the throat, on the
               yoke, where a collar's rank flash sits.
           Nothing floats on the chest any more. */
        const gold = K.braidColor != null ? K.braidColor : 0xd9b64a;
        const low = rig.skinSlots && rig.skinSlots.armsLower;
        if (low) {
          for (let i = 0; i < low.length; i++) {
            const a = low[i];
            if (!a) continue;
            const gp = (a.geometry && a.geometry.parameters) || {};
            const aw = (gp.width || 0.3) * 1.06, ad = (gp.depth || 0.3) * 1.06;
            const ah = gp.height || 0.46;
            const ring = box(aw, 0.038, ad, gold);
            ring.position.set(0, -ah * 0.5 + 0.075, 0);
            add(a, ring);
            const ring2 = box(aw, 0.026, ad, gold);
            ring2.position.set(0, -ah * 0.5 + 0.135, 0);
            add(a, ring2);
          }
        }
        if (yoke) {
          const cd = (P.collarD || 0.52) / 2 + 0.055;
          for (let s3 = -1; s3 <= 1; s3 += 2) {
            const tab = box(0.085, 0.055, 0.03, gold);
            tab.position.set(s3 * 0.11, 0.005, cd);
            add(yoke, tab);
          }
        }
      }
      /* THE GREATCOAT. Three panels, not one skirt box: a hip flare that owns
         the silhouette, and separate front/back tails that the legs swing
         BETWEEN. The first draft used one solid box to mid-thigh and the
         thighs walked straight through the front of it every stride. */
      if (K.coat != null) {
        /* TWO THINGS THE FIRST GREATCOAT GOT WRONG, both visible in the
           contact sheet as a light-grey TABLETOP hanging off a black coat.

           (a) A SOLID BOX HAS A TOP FACE. An up-facing plane under a 1.12 sun
               and a 0xcfe0f2 sky is two stops brighter than the sides, and
               clothes.js's jacket shell CLEARS its own cap row (an open
               jacket has no lid), so there was nothing above it to hide it.
               The skirt is four panels now — front, back and two sides — and
               an open-topped shell has no plane pointing at the sun.
           (b) A FLAT LAMBERT DOES NOT MATCH PAINTED CLOTH AT THE SAME HEX.
               Measured side by side: the Night Staff Coat's atlas body
               (0x191c23) renders near-black while a cmat box at 0x171a20
               beside it renders about 0x5a5f68 — this build has no colour
               management, so a texel and a material colour do not travel the
               same path to the screen. Typing a second darker number would
               only have to be retyped when the coat changes, so `coat: true`
               DERIVES the skirt from whatever the garment actually painted
               (cityPaintedBodyHex reads the atlas back) and steps it down.
               An explicit hex still wins, for a coat in a colour of its own.
               HALF A STEP DARKER than the garment, not equal to it: the first
               try matched the coat body exactly and the Marshal's oxblood
               skirt came out MAUVE against a maroon coat. A skirt hanging
               below the waist is shaded by the body above it, so darker is
               both what the picture wants and what a coat actually does. */
        let coatHex = K.coat;
        if (coatHex === true) {
          let base = null;
          if (CBZ.cityPaintedBodyHex) {
            try { base = CBZ.cityPaintedBodyHex({ id: fit.paint, style: fit.style != null ? styleIndex(fit.style) : null, colors: fit.colors }, rig); } catch (e) {}
          }
          coatHex = enc(shade(base != null ? base : (fit.colors.torso || 0x1a1c22), -0.55));
        }
        const jw = (P.jacketW || cb.w + 0.06), jd = (P.jacketD || cb.d + 0.12);
        const top = -cb.h / 2 - 0.10, skirtH = 0.34, tailH = 0.48;
        const side = shade(coatHex, -0.12);
        const mk = function (w, h, d, hex, x, y, z) {
          const m2 = box(w, h, d, hex); m2.position.set(x, y, z); add(chest, m2); return m2;
        };
        // the flare: four panels, open top and bottom
        mk(jw - 0.03, skirtH, 0.05, coatHex, 0, top - skirtH / 2, jd / 2 - 0.025);
        mk(jw - 0.03, skirtH, 0.05, side,    0, top - skirtH / 2, -jd / 2 + 0.025);
        mk(0.05, skirtH, jd - 0.05, side, (jw - 0.03) / 2 - 0.025, top - skirtH / 2, 0);
        mk(0.05, skirtH, jd - 0.05, side, -(jw - 0.03) / 2 + 0.025, top - skirtH / 2, 0);
        // the tails, front and back, with the legs swinging between them
        mk(jw - 0.14, tailH, 0.05, coatHex, 0, top - skirtH - tailH / 2 + 0.02, cb.d / 2 + 0.03);
        mk(jw - 0.09, tailH + 0.04, 0.05, side, 0, top - skirtH - tailH / 2, -cb.d / 2 - 0.03);
        // one hem line so the skirt has an edge instead of ending in the air
        mk(jw - 0.02, 0.03, jd + 0.005, shade(coatHex, -0.35), 0, top - skirtH + 0.015, 0);
      }
      /* A CAPE hangs off the YOKE, not the chest: it has to clear the
         shoulders or it reads as a backpack. */
      if (K.cape != null && yoke) {
        const cw = P.collarW || 0.94;
        const cp = box(cw + 0.10, 1.02, 0.05, K.cape);
        cp.position.set(0, -0.50, -(P.collarD || 0.52) / 2 - 0.03);
        cp.rotation.x = -0.05; add(yoke, cp);
        const collarRoll = box(cw + 0.14, 0.11, 0.16, K.capeTrim != null ? K.capeTrim : shade(K.cape, 0.3));
        collarRoll.position.set(0, 0.03, -(P.collarD || 0.52) / 2 - 0.02); add(yoke, collarRoll);
      }
      if (K.plate != null) {
        // a slab carrier over the chest: the one silhouette change that makes
        // a fighting man read differently from a walking one.
        const pl = box(cb.w * 0.86, cb.h * 0.62, 0.09, K.plate);
        pl.position.set(0, cb.h * 0.02, zF - 0.02); add(chest, pl);
        for (let i = 0; i < 3; i++) {
          const pouch = box(0.16, 0.13, 0.09, shade(K.plate, -0.18));
          pouch.position.set(-0.20 + i * 0.20, -cb.h * 0.20, zF + 0.005); add(chest, pouch);
        }
      }
      if (K.scarf != null) {
        const sc = box(cb.w * 0.80, 0.10, cb.d + 0.06, K.scarf);
        sc.position.set(0, cb.h / 2 - 0.035, 0.01); add(chest, sc);
      }
    }
    rig._wlKit = out;
    return out.length;
  }

  /* ============================================================ THE PAINT
     ONE PAINTER, AND IT IS THE SIBLING'S.

     warlord/outfits.js exists to dress every army on the island, and it
     already solved every hard part of that: the painted-atlas hand-off to
     city/clothes.js, camo.js's shared camo materials, `readable()` (which
     pushes any cloth colour off the sand's own luminance so a khaki uniform
     is not invisible at 200 m), weathering, webbing, a badge and the whole
     headwear ladder — bare / rag / shemagh / cap / beret / helmet. Its own
     header names the wardrobe as a consumer and it ships `player(spec)` for
     exactly this file.

     So the wardrobe writes NO painter. It builds the record shape that file
     eats — `{rec:{id,paint,style,colors,belt,badge,camo,camoTint},
     det:{accent,boots,head,wear,rank}}` — hands it to `W.outfits.apply`, and
     then adds the ONE thing an army uniform module has no reason to own: the
     ornament that marks a GENERAL. Braid, a sash, a chest of ribbons, a
     peaked cap, a greatcoat, a cape, and — for the black suit — sunglasses
     and an earpiece.

     Fallbacks, in order, and each is a real degrade rather than a copy:
       2. `CBZ.cityRecolorRig` — the city's own dresser, if some page has it
          (outfits.js publishes its own under that name too).
       3. `paintFlat` — region colours, clone-on-write. For a page where
          outfits.js was reverted with ?outfits=old AND clothes.js 404'd.

     `?outfits=old` turns outfits.js's apply() into a no-op returning false,
     which lands here on step 2 and still dresses you. That is deliberate:
     the owner asked to pick an outfit, and one sibling's revert flag must not
     take the wardrobe with it. */
  const pending = [];                     // rigs asked for before the painter landed
  function flushPending() {
    const q = pending.splice(0, pending.length);
    for (let i = 0; i < q.length; i++) {
      try { applyNow(q[i].rig, q[i].id); } catch (e) {}
    }
  }
  function rigOf(x) {
    if (!x) return null;
    if (x.skinSlots) return x;
    if (x.userData && x.userData.charRig) return x.userData.charRig;
    if (x.char && x.char.skinSlots) return x.char;
    if (x.group && x.group.userData && x.group.userData.charRig) return x.group.userData.charRig;
    return null;
  }
  function paintFlat(rig, c) {
    const s = rig.skinSlots;
    const put = function (list, hex) {
      if (!list || hex == null) return;
      for (let i = 0; i < list.length; i++) {
        const m = list[i];
        if (!m || !m.material || !m.material.color) continue;
        if (m.userData && m.userData._cbzPart) continue;   // painted cloth: a tint would darken the art
        if (m.material._shared) m.material = m.material.clone();   // the cmat pool is SHARED — clone or repaint the world
        m.material.color.setHex(hex);
      }
    };
    put(s.legs, c.legs); put(s.legsLower, c.legs); put(s.pelvis, c.legs);
    put(s.torso, c.torso); put(s.collar, c.collar != null ? c.collar : c.torso);
    put(s.arms, c.arms != null ? c.arms : c.torso); put(s.armsLower, c.arms != null ? c.arms : c.torso);
    put(s.shoes, c.shoes != null ? c.shoes : 0x2b2b2b);
  }
  /* Which hats outfits.js owns and which this file owns. Its ladder is the
     army's ladder (a rag, a shemagh, a ball cap, a beret, a helmet) and there
     is no reason to draw a second shemagh. A PEAKED CAP is the one hat it has
     no use for — no army issues a service cap to a levy — and it is exactly
     the hat that says "officer", so this file draws that one and tells
     outfits.js to leave the head alone. */
  const SIB_HEAD = { cap: 1, rag: 1, shemagh: 1, beret: 1, helmet: 1 };
  function styleIndex(name) {
    const i = SUIT_IDX[name];
    return i != null ? i : 0;
  }
  function outfitSpec(fit) {
    const K = fit.kit || {};
    const c = fit.colors;
    const rec = {
      id: "wl:" + fit.id, name: fit.name, paint: fit.paint,
      // the belt hex rides `colors.belt`, which is where outfits.js's webbing
      // reads it; a fit that names one in its kit but not its colours would
      // otherwise get the generic darkened-trouser band.
      colors: (K.belt != null && c.belt == null) ? Object.assign({}, c, { belt: K.belt }) : c,
      belt: K.belt != null, badge: !!K.badge,
      // forcePaint: clothes.js's plain-civvie switch resolves hoodie/basics to
      // "no painted look" for a city crowd. There is no crowd here and the
      // painted hoodie is one of the fits — outfits.js turns the switch off
      // page-wide, this says it again per record so the order cannot matter.
      force: 1,
    };
    if (fit.style != null) rec.style = styleIndex(fit.style);
    if (fit.camo) { rec.camo = fit.camo; if (fit.camoTint != null) rec.camoTint = fit.camoTint; }
    /* WHAT THE ACCENT IS FOR, and the bug the first contact sheet caught.
       outfits.js reads det.accent two ways: on a rag or a shemagh it IS the
       cloth (you tied it on), and on a cap/beret/helmet it is the BAND round
       issue kit. One default cannot serve both — the flat gold this used
       painted every shemagh in the game bright yellow, which is in the
       camo-line plate. So a wrap takes the fit's own head colour and a hat
       takes the metal. */
    const wrap = (K.head === "shemagh" || K.head === "rag");
    const det = {
      accent: fit.accent != null ? fit.accent
        : wrap ? (K.headColor != null ? K.headColor : (c.collar != null ? c.collar : c.torso))
        : (K.badgeColor != null ? K.badgeColor : 0xd9b64a),
      boots: c.shoes,
      head: SIB_HEAD[K.head] ? K.head : "none",
      // WEAR IS A STATEMENT ABOUT THE FIT, not about the man — outfits.js
      // reads it as sun-bleach. Field kit and rags live outdoors; a dress
      // coat comes out of a trunk and a suit was pressed this morning, so
      // those stay at 0. 0.22 was picked by looking: at 0.4 the desert
      // fatigues went the same value as the sand behind them.
      wear: fit.wear != null ? fit.wear : (fit.group === "field" || fit.group === "rag" ? 0.22 : 0),
      rank: fit.role === "general" ? 3 : (fit.role === "officer" ? 2 : 1),
    };
    return { rec: rec, det: det };
  }
  function applyNow(rig, id) {
    const fit = FIT[id] || FIT[DEFAULT_FIT];
    if (!rig || !rig.skinSlots || !fit) return false;
    /* A TILE THAT CAME OUT OF outfits.js GOES BACK TO outfits.js. Its
       `player({fit})` builds the record AND the detail block (accent,
       headwear, weathering) that its own catalogue rows expect, including the
       camo pattern camo.js made for that faction. Rebuilding any of that here
       would be a second, worse copy of a uniform that already exists. */
    if (fit.armyFit && W.outfits && W.outfits.player && W.outfits.apply) {
      let ok = false;
      try {
        const sp = W.outfits.player({ fit: fit.armyFit });
        ok = !!sp && W.outfits.apply(rig, sp) === true;
      } catch (e) { ok = false; }
      if (ok) { buildKit(rig, fit); rig._wlWardrobeFit = id; return true; }
    }
    const spec = outfitSpec(fit);
    let done = false;
    if (W.outfits && typeof W.outfits.apply === "function") {
      try { done = W.outfits.apply(rig, spec) === true; } catch (e) { done = false; }
    }
    if (!done && CBZ.cityRecolorRig) {
      try {
        const r = Object.assign({}, spec.rec, { id: spec.rec.paint });
        CBZ.cityRecolorRig(rig, spec.rec.colors, r);
        done = true;
      } catch (e) { done = false; }
    }
    if (!done) {
      paintFlat(rig, spec.rec.colors);
      if (!CBZ.cityApplyClothes && pending.length < 8) pending.push({ rig: rig, id: id });
    }
    buildKit(rig, fit);
    rig._wlWardrobeFit = id;
    return true;
  }

  /* ============================================================ CATALOGUE
     A fit is: what the painter draws (`paint` + `colors`, and `style` when
     the painter is the suit), what this file bolts on (`kit`), which rung of
     the ladder opens it (`rank`), and where it sits in the officer ladder
     (`family` + `role`).

     WHAT WAS TAKEN AND WHAT IS NEW:
       · every `colors:` set on a work/law/street fit below is city/outfits.js's
         own record for that garment, copied unchanged, because those palettes
         are what clothes.js's painters were tuned against — the two files
         drifting is a documented bug class in outfits.js's own comments.
       · every `style:` naming a city suit is that suit, straight across.
       · the DESERT and DETAIL palettes, the WL_STYLES tunics and dress coats,
         and every `kit:` block are new: this island has generals and a desert
         and the city had neither. */
  const FIT = {};
  const ORDER = [];
  function F(id, o) { o.id = id; FIT[id] = o; ORDER.push(id); return o; }

  const B = classes();
  const R_RIDER = 0, R_CAPT = B[1].lo, R_CMD = B[2].lo, R_GEN = B[3].lo, R_LORD = B[3].hi;

  /* ---- SUITS. The owner asked for them by name and they are the reason
          this file loads the city wardrobe at all. ---- */
  F("detail_black", { name: "The Black Suit", group: "suit", rank: R_RIDER,
    note: "black on white on black. an earpiece and no expression.",
    paint: "suit", style: "Detail Black", family: "detail", role: "officer",
    colors: styleColors("Detail Black"),
    kit: { shades: 1, earpiece: 1, hair: 0x14110e } });
  F("detail_charcoal", { name: "Charcoal Detail", group: "suit", rank: R_RIDER,
    note: "the second man in the car.",
    paint: "suit", style: "Detail Charcoal", family: "detail", role: "nco",
    colors: styleColors("Detail Charcoal"), kit: { shades: 1, earpiece: 1 } });
  F("detail_midnight", { name: "Midnight Detail", group: "suit", rank: R_CAPT,
    note: "navy so dark it reads black until the sun hits it.",
    paint: "suit", style: "Detail Midnight", family: "detail", role: "line",
    colors: styleColors("Detail Midnight"), kit: { shades: 1, earpiece: 1 } });
  const CITY_SUITS = [
    ["suit_black",     "Black Suit",                   "Black Two-Piece",     R_RIDER, "a funeral, or a meeting."],
    ["suit_charcoal",  "Charcoal Suit",                "Charcoal Suit",       R_RIDER, "the city's own. still the best one."],
    ["suit_navy",      "Navy Suit",                    "Navy Suit",           R_RIDER, "somebody's lawyer."],
    ["suit_grey",      "Mid-Grey Suit",                "Mid-Grey Suit",       R_RIDER, "forgettable, which is the point."],
    ["suit_tan",       "Tan Suit",                     "Tan Suit",            R_RIDER, "the only suit that belongs in this heat."],
    ["suit_olive",     "Olive Suit",                   "Olive Suit",          R_RIDER, "half a uniform. reads as either."],
    ["suit_pin",       "Navy Pinstripe Suit",          "Navy Pinstripe",      R_CAPT,  "money that wants you to know."],
    ["suit_pin_char",  "Charcoal Pinstripe Suit",      "Charcoal Pinstripe",  R_CAPT,  "the quieter half of the same idea."],
    ["suit_powder",    "Powder-Blue Suit",             "Powder Blue",         R_CAPT,  "a man who has never been shot at."],
    ["suit_glen",      "Brown Glen-Check Suit",        "Glen Check",          R_CAPT,  "checks that survive being dusty."],
    ["suit_window",    "Grey Windowpane Suit",         "Grey Windowpane",     R_CAPT,  "loud tailoring, quiet colour."],
    ["suit_db",        "Navy Double-Breasted Suit",    "Navy Double-Breasted", R_CMD,  "six buttons and an opinion."],
    ["suit_db_char",   "Charcoal Double-Breasted Suit","Charcoal DB",         R_CMD,   "shoulders, mostly."],
    ["suit_3p",        "Charcoal 3-Piece Suit",        "Charcoal Three-Piece", R_CMD,  "a waistcoat in the desert. that IS the flex."],
    ["suit_burg",      "Burgundy 3-Piece Suit",        "Burgundy Three-Piece", R_CMD,  "the man who owns the depot."],
    ["suit_white",     "All-White Suit",               "The White Suit",      R_CMD,   "you will not be hiding."],
    ["suit_tux",       "Black Shawl Tuxedo",           "Midnight Tuxedo",     R_GEN,   "the apex fit, worn on sand."],
    ["suit_tux_blue",  "Midnight-Blue Tuxedo",         "Midnight-Blue Tux",   R_GEN,   "black tie, but bluer."],
    ["suit_dinner",    "White Dinner Jacket",          "White Dinner Jacket", R_GEN,   "for the surrender you host."],
    ["suit_tux_db",    "Double-Breasted Peak Tuxedo",  "Peak-Lapel Tuxedo",   R_LORD,  "nobody left to impress. wear it anyway."],
  ];
  for (let i = 0; i < CITY_SUITS.length; i++) {
    const row = CITY_SUITS[i];
    F(row[0], { name: row[2], group: "suit", rank: row[3], note: row[4],
      paint: "suit", style: row[1], family: "suit", role: i < 6 ? "line" : (i < 11 ? "nco" : "officer"),
      colors: styleColors(row[1]), kit: {} });
  }

  /* ---- FIELD. What an army on this island actually wears. ---- */
  F("field_desert", { name: "Desert Fatigues", group: "field", rank: R_RIDER,
    note: "sand camo, cargo pockets, a cap. the line.",
    paint: "soldier", family: "desert", role: "line",
    /* PAINT.soldier scatters its camo blots off the BASE colour, so a tan
       base gives desert camo for free — the city shipped it olive because a
       city has no desert in it. Its cache key is just "soldier" (one atlas
       per painter id), which is why this game gets ONE fatigue colour and
       every other field look is a different painter. */
    colors: { legs: 0x9d8862, torso: 0xa8926a, collar: 0x8a7654, arms: 0xa8926a, shoes: 0x453a2a },
    kit: { head: "cap", headColor: 0x8f7b58, belt: 0x3d3427 } });
  F("field_desert_wrap", { name: "Desert Fatigues · Shemagh", group: "field", rank: R_RIDER,
    note: "same fatigues, head wrapped. how you survive the afternoon.",
    paint: "soldier", family: "desert", role: "line",
    colors: { legs: 0x9d8862, torso: 0xa8926a, collar: 0x8a7654, arms: 0xa8926a, shoes: 0x453a2a },
    kit: { head: "shemagh", headColor: 0xd6c9a8, trim: 0x8d7b56, belt: 0x3d3427 } });
  /* swat_unmarked, NOT swat. clothes.js's PAINT.swat stencils the word SWAT
     across the carrier, and there is no SWAT on this island — the unmarked
     variant is the same plate carrier, pouches and radio with the tape left
     off, which is exactly a warband's rig. The marked one still earns a slot
     below, as loot, where the stencil is the point. */
  F("field_carrier", { name: "Assault Carrier", group: "field", rank: R_CAPT,
    note: "coyote plates over fatigues. the man who goes in first.",
    paint: "swat_unmarked", family: "desert", role: "nco",
    // city/outfits.js's SWAT record, desert-shifted: its own comment says
    // torso drives the CARRIER and legs the fatigues, so only those move.
    colors: { legs: 0x6a6248, torso: 0x7c7154, collar: 0x4e4835, arms: 0x6f6650, shoes: 0x201c15, belt: 0x1a1710 },
    kit: { head: "helmet", headColor: 0x6c6349, belt: 0x2a2419 } });
  F("field_night", { name: "Looted Riot Kit", group: "field", rank: R_CMD,
    note: "somebody's tactical squad, stencil and all. you kept the stencil.",
    paint: "swat", family: "night", role: "nco",
    colors: { legs: 0x1a1c1e, torso: 0x212427, collar: 0x121416, arms: 0x1d2022, shoes: 0x0d0f11, belt: 0x0b0d0f },
    kit: { head: "helmet", headColor: 0x1b1e21, shades: 1, belt: 0x0e1013 } });
  F("field_tactical", { name: "All Black Tactical", group: "field", rank: R_CAPT,
    note: "taken straight off the city's professionals.",
    paint: "tactical", family: "night", role: "line",
    colors: { legs: 0x121418, torso: 0x121418, collar: 0x0b0c0f, arms: 0x121418, shoes: 0x0b0c0f },
    // the ONLY fit that gets the geometric carrier: clothes.js's swat painters
    // already draw one, and two carriers on one chest is a shelf.
    kit: { shades: 1, plate: 0x1a1d21, belt: 0x0a0b0e } });
  F("field_khaki", { name: "Militia Khakis", group: "field", rank: R_RIDER,
    note: "county khaki over brown. epaulettes and a star.",
    paint: "sheriff", family: "militia", role: "line",
    colors: { legs: 0x5a4632, torso: 0xb8a070, collar: 0x7a6a4a, arms: 0xb8a070, shoes: 0x2b241c, belt: 0x1a140c },
    kit: { head: "cap", headColor: 0x8a7752, belt: 0x2a2015 } });
  F("field_ranger", { name: "Ranger Greens", group: "field", rank: R_RIDER,
    note: "khaki shirt, green trousers, a hat that means it.",
    paint: "ranger", family: "militia", role: "nco",
    colors: { legs: 0x3f4b2e, torso: 0xb19a6a, collar: 0x4a5835, arms: 0xb19a6a, shoes: 0x352a1d },
    kit: { head: "peaked", headColor: 0x3f4b2e, trim: 0x2b3320, badgeColor: 0xc8a53a } });
  F("field_scout", { name: "Scout Field Gear", group: "field", rank: R_RIDER,
    note: "somebody's hunting kit, still the best thing in the cart.",
    paint: "hunter", family: "militia", role: "line",
    colors: { legs: 0x4a4d32, torso: 0x465038, collar: 0x6d5f34, arms: 0x465038, shoes: 0x2b241c },
    kit: { head: "shemagh", headColor: 0x8d8355, trim: 0x5e5637 } });
  F("field_dune", { name: "Dune Runner", group: "field", rank: R_RIDER,
    note: "layers, a shell and no armour at all.",
    paint: "hiker", family: "irregular", role: "line",
    colors: { legs: 0x3d4650, torso: 0xb94f2f, collar: 0x27313a, arms: 0xb94f2f, shoes: 0x3a2e20 },
    kit: { head: "cap", headColor: 0x27313a } });
  F("field_oilskin", { name: "Coast Oilskins", group: "field", rank: R_RIDER,
    note: "for the shore, where it actually rains.",
    paint: "fisherman", family: "irregular", role: "line",
    colors: { legs: 0xc99928, torso: 0x283d50, collar: 0xe1bd45, arms: 0x283d50, shoes: 0x1d2924 },
    kit: { head: "cap", headColor: 0xc99928 } });
  F("field_sapper", { name: "Sapper's Turnout", group: "field", rank: R_CAPT,
    note: "tan turnout with the yellow trim. mines and doors.",
    paint: "firefighter", family: "engineer", role: "nco",
    colors: { legs: 0xb09a6e, torso: 0xb09a6e, collar: 0xe8d44a, arms: 0xb09a6e, shoes: 0x16110d },
    kit: { head: "helmet", headColor: 0xe0c53a, belt: 0x2a2118 } });
  F("field_engineer", { name: "Engineer Hi-Vis", group: "field", rank: R_RIDER,
    note: "the man who builds the outpost you are standing in.",
    paint: "construction", family: "engineer", role: "line",
    colors: { legs: 0x2e4a6b, torso: 0xff5f08, collar: 0xbfc6c5, arms: 0x1d3352, shoes: 0x4a3a26 },
    kit: { head: "helmet", headColor: 0xf0c51b } });
  F("field_quarter", { name: "Quartermaster Hi-Vis", group: "field", rank: R_RIDER,
    note: "counts crates, never misses one.",
    paint: "hivis", family: "engineer", role: "line",
    colors: { legs: 0x2f4f8a, torso: 0xffb43a, collar: 0xfff06b, arms: 0xffb43a, shoes: 0x4a3a26 },
    kit: { head: "cap", headColor: 0x2f4f8a } });
  F("field_guard", { name: "Guard Blacks", group: "field", rank: R_CAPT,
    note: "gold tape and epaulettes. reads as authority for free.",
    paint: "security", family: "guard", role: "line",
    colors: { legs: 0x1c1f26, torso: 0x1c1f26, collar: 0xe8e8e8, arms: 0x1c1f26, shoes: 0x101216 },
    kit: { head: "cap", headColor: 0x1c1f26, belt: 0x0d0f13 } });
  F("field_provost", { name: "Provost's Blues", group: "field", rank: R_CAPT,
    note: "somebody has to police your own camp.",
    paint: "corrections", family: "guard", role: "nco",
    colors: { legs: 0x202936, torso: 0x34475d, collar: 0xaab7c2, arms: 0x34475d, shoes: 0x111419, belt: 0x111419 },
    kit: { head: "peaked", headColor: 0x202b3b, trim: 0x121722, belt: 0x111419 } });
  F("field_police", { name: "Constabulary Blues", group: "field", rank: R_CAPT,
    note: "taken off a body at the first outpost you burned.",
    paint: "police", family: "guard", role: "line",
    colors: { legs: 0x1b2a44, torso: 0x24407a, collar: 0x16264a, arms: 0x24407a, shoes: 0x101216, belt: 0x0d111c },
    kit: { head: "peaked", headColor: 0x16223a, trim: 0x0d1424, belt: 0x0d111c } });
  F("field_surgeon", { name: "Surgeon's Whites", group: "field", rank: R_CAPT,
    note: "the most valuable man in your column, and he knows it.",
    paint: "doctor", family: "medical", role: "line",
    colors: { legs: 0x39414f, torso: 0xe9e9e9, collar: 0x9ab8d0, arms: 0xe9e9e9, shoes: 0x2b2b2b },
    kit: {} });
  F("field_ambulance", { name: "Field Ambulance Blues", group: "field", rank: R_RIDER,
    note: "navy with the reflective band. drags men off the sand.",
    paint: "ems", family: "medical", role: "line",
    colors: { legs: 0x24304a, torso: 0x24304a, collar: 0xc6d435, arms: 0x24304a, shoes: 0x101216 },
    kit: { head: "cap", headColor: 0x24304a, belt: 0x141a28 } });

  /* ---- DRESS. Rank you can see from the far dune. ---- */
  F("dress_sand_field", { name: "Officer's Field Dress", group: "dress", rank: R_CMD,
    note: "sand tunic, shirt and tie, a peaked cap and a belt.",
    paint: "suit", style: "Sand Service Tunic", family: "desert", role: "officer",
    colors: styleColors("Sand Service Tunic"),
    kit: { head: "peaked", headColor: 0xa89065, trim: 0x5d4c33, epaulettes: 1, epauletteColor: 0xd9b64a, pips: 2, belt: 0x4a3a26 } });
  F("dress_olive_field", { name: "Legion Field Dress", group: "dress", rank: R_CMD,
    note: "the Desert Legion's own cut, in your colours.",
    paint: "suit", style: "Olive Service Tunic", family: "militia", role: "officer",
    colors: styleColors("Olive Service Tunic"),
    kit: { head: "peaked", headColor: 0x454a2c, trim: 0x272b18, epaulettes: 1, epauletteColor: 0xc8a53a, pips: 2, belt: 0x2b2b18 } });
  F("dress_legion", { name: "Legion Dress Tunic", group: "dress", rank: R_CMD,
    note: "gold on gold, with a waistcoat under it.",
    paint: "suit", style: "Legion Dress Tunic", family: "militia", role: "officer",
    colors: styleColors("Legion Dress Tunic"),
    kit: { head: "peaked", headColor: 0x6d5c23, trim: 0x3b3113, epaulettes: 1, pips: 3, braid: 1, belt: 0x3b3113 } });
  F("dress_air", { name: "Air Officer's Whites", group: "dress", rank: R_CMD,
    note: "white shirt, black tie, gold on the shoulder.",
    paint: "pilot", family: "guard", role: "officer",
    colors: { legs: 0x1a1c24, torso: 0xeef0f2, collar: 0xd6d9dd, arms: 0xeef0f2, shoes: 0x101216 },
    kit: { head: "peaked", headColor: 0x151c2e, trim: 0x0c1120, epaulettes: 1, epauletteColor: 0xd9b64a, pips: 3, belt: 0x11141c } });
  F("dress_coast", { name: "Coastal Command Whites", group: "dress", rank: R_CMD,
    note: "harbour whites over navy. the fleet you do not have yet.",
    paint: "mariner", family: "guard", role: "officer",
    colors: { legs: 0x19283d, torso: 0xf0f1ed, collar: 0x213a5a, arms: 0xf0f1ed, shoes: 0x10151d },
    kit: { head: "peaked", headColor: 0xf0f1ed, trim: 0x14243a, badgeColor: 0xd9b64a, epaulettes: 1, epauletteColor: 0x14243a, pips: 3 } });
  F("dress_provost_general", { name: "Provost Marshal", group: "dress", rank: R_CMD,
    note: "the warden's own dress blacks, badge and all.",
    paint: "warden", family: "guard", role: "general",
    colors: { legs: 0x171c28, torso: 0x222b3d, collar: 0xe8e3d8, arms: 0x222b3d, shoes: 0x090b0f, belt: 0x111419 },
    kit: { head: "peaked", headColor: 0x171d29, trim: 0x0a0d14, epaulettes: 1, pips: 2, medals: 4, belt: 0x111419 } });

  F("gen_sand", { name: "General's Dress Coat", group: "dress", rank: R_GEN,
    note: "sand, double-breasted, braid, a sash and eight ribbons.",
    paint: "suit", style: "Sand Dress Coat", family: "desert", role: "general",
    colors: styleColors("Sand Dress Coat"),
    kit: { head: "peaked", headColor: 0xa89065, trim: 0x4c3d26, badgeColor: 0xe8c454,
           epaulettes: 1, epauletteColor: 0xd9b64a, pips: 3, braid: 1, medals: 8,
           sash: 0x8d2c33, belt: 0x3f321f } });
  F("gen_olive", { name: "Legion General", group: "dress", rank: R_GEN,
    note: "olive dress coat with the gold cord.",
    paint: "suit", style: "Olive Dress Coat", family: "militia", role: "general",
    colors: styleColors("Olive Dress Coat"),
    kit: { head: "peaked", headColor: 0x3c421f, trim: 0x22260f, epaulettes: 1, pips: 3,
           braid: 1, medals: 8, sash: 0xb99a2e, belt: 0x24280f } });
  F("gen_slate", { name: "Staff General", group: "dress", rank: R_GEN,
    note: "slate grey. the one who moves other people's armies.",
    paint: "suit", style: "Slate Dress Coat", family: "guard", role: "general",
    colors: styleColors("Slate Dress Coat"),
    kit: { head: "peaked", headColor: 0x2f353f, trim: 0x191d24, epaulettes: 1, pips: 3,
           braid: 1, medals: 6, sash: 0x2f5a8d, belt: 0x191d24 } });
  F("gen_night", { name: "Night Staff Coat", group: "dress", rank: R_GEN,
    note: "black on black with gold. dressed for the execution.",
    paint: "suit", style: "Night Staff Coat", family: "night", role: "general",
    colors: styleColors("Night Staff Coat"),
    kit: { head: "peaked", headColor: 0x14171d, trim: 0x090b0e, badgeColor: 0xd9b64a,
           epaulettes: 1, epauletteColor: 0xd9b64a, pips: 3, braid: 1, medals: 8,
           sash: 0xb8992e, belt: 0x0b0d10, shades: 1 } });

  F("lord_oxblood", { name: "Marshal of the Sands", group: "dress", rank: R_LORD,
    note: "oxblood, greatcoat, sash, medals. the whole island knows.",
    paint: "suit", style: "Oxblood Marshal Coat", family: "desert", role: "general",
    colors: styleColors("Oxblood Marshal Coat"),
    kit: { head: "peaked", headColor: 0x3d1a20, trim: 0x1e0d11, badgeColor: 0xe8c454,
           epaulettes: 1, epauletteColor: 0xd9b64a, pips: 4, braid: 1, medals: 8,
           sash: 0xd8c65a, coat: true, belt: 0x1e0d11 } });
  F("lord_parade", { name: "Parade Whites", group: "dress", rank: R_LORD,
    note: "bone white, a cape, and nothing left to prove.",
    paint: "suit", style: "Bone Parade Coat", family: "militia", role: "general",
    colors: styleColors("Bone Parade Coat"),
    kit: { head: "peaked", headColor: 0xd8ceb4, trim: 0x8d8474, badgeColor: 0xc9a83c,
           epaulettes: 1, epauletteColor: 0xc9a83c, pips: 4, braid: 1, medals: 8,
           sash: 0x8d2c33, cape: 0x8d2c33, capeTrim: 0xd8ceb4, belt: 0x6f6754 } });
  F("lord_greatcoat", { name: "The Warlord's Greatcoat", group: "dress", rank: R_LORD,
    note: "a coat to the knee, a sash, and a cape that costs nothing to wear.",
    paint: "suit", style: "Night Staff Coat", family: "night", role: "general",
    colors: styleColors("Night Staff Coat"),
    kit: { head: "peaked", headColor: 0x14171d, trim: 0x090b0e, badgeColor: 0xd9b64a,
           epaulettes: 1, epauletteColor: 0xd9b64a, pips: 4, braid: 1, medals: 8,
           sash: 0x8d2c33, coat: true, cape: 0x101216, capeTrim: 0x8d2c33, belt: 0x0b0d10 } });

  /* ---- CREW. Vehicles, camp, depot. ---- */
  F("crew_coveralls", { name: "Technical Crew", group: "crew", rank: R_RIDER,
    note: "grease, coveralls, and the gun-truck that eats your payroll.",
    paint: "coveralls", family: "engineer", role: "line",
    colors: { legs: 0x3a4150, torso: 0x3a4150, collar: 0x2a2f3a, arms: 0x3a4150, shoes: 0x2b241c },
    kit: { head: "cap", headColor: 0x2a2f3a, belt: 0x22262f } });
  F("crew_gun_truck", { name: "Gun-Truck Crew", group: "crew", rank: R_CAPT,
    note: "pit-crew coveralls with the red collar. fast hands.",
    paint: "pitcrew", family: "engineer", role: "nco",
    colors: { legs: 0x17253a, torso: 0x17253a, collar: 0xc93632, arms: 0x17253a, shoes: 0x11151b },
    kit: { head: "cap", headColor: 0x17253a, belt: 0x0f1521 } });
  F("crew_convoy", { name: "Convoy Marshal", group: "crew", rank: R_RIDER,
    note: "orange, because a column that cannot see you runs you over.",
    paint: "marshal", family: "engineer", role: "line",
    colors: { legs: 0x26313e, torso: 0xe36f22, collar: 0xf0e44c, arms: 0x26313e, shoes: 0x151a20 },
    kit: { head: "cap", headColor: 0xe36f22 } });
  F("crew_driver", { name: "The Warlord's Driver", group: "crew", rank: R_CAPT,
    note: "grey tunic, peaked cap. drives, waits, says nothing.",
    paint: "driver", family: "detail", role: "line",
    colors: { legs: 0x202733, torso: 0xc9d3dc, collar: 0x27354a, arms: 0xc9d3dc, shoes: 0x101216 },
    kit: { head: "peaked", headColor: 0x202733, trim: 0x11161f, epaulettes: 1, epauletteColor: 0x27354a } });
  F("crew_airstrip", { name: "Airstrip Crew", group: "crew", rank: R_RIDER,
    note: "airside yellow. one strip, one plane, no tower.",
    paint: "groundcrew", family: "engineer", role: "line",
    colors: { legs: 0x24344d, torso: 0xd8ca2f, collar: 0x24344d, arms: 0x24344d, shoes: 0x171b22 },
    kit: { head: "cap", headColor: 0xe2cf31 } });
  F("crew_racer", { name: "Runner's Suit", group: "crew", rank: R_CAPT,
    note: "a racing suit. the fastest thing you own that isn't a horse.",
    paint: "racer", family: "irregular", role: "line",
    colors: { legs: 0xb52d32, torso: 0xb52d32, collar: 0xf1eee7, arms: 0xb52d32, shoes: 0x15171b },
    kit: { head: "helmet", headColor: 0xb52d32 } });

  /* ---- IRREGULAR. What you rode out in, and what you looted since. ---- */
  F("rag_rags", { name: "What You Rode Out In", group: "rag", rank: R_RIDER,
    note: "layered, mismatched, dirty. day one, before any of this.",
    paint: "homeless", family: "irregular", role: "line",
    // outfits.js's own vagrant palette (its RAGS table), not a new one.
    colors: { legs: 0x3e3a33, torso: 0x4a4438, collar: 0x6b5d4a, arms: 0x4a4438, shoes: 0x2b241c },
    kit: { head: "shemagh", headColor: 0x6b5d4a, trim: 0x4a4438 } });
  F("rag_tank", { name: "Ribbed Tank", group: "rag", rank: R_RIDER,
    note: "bare arms, fatigue trousers, a wrap against the sun.",
    paint: "wifebeater", family: "irregular", role: "line",
    colors: { legs: 0x4a4d38, torso: 0xe6e3d9, collar: 0xe6e3d9, arms: 0xcf9a72, shoes: 0x3a3227 },
    kit: { head: "shemagh", headColor: 0xc8b891, trim: 0x8a7c5c, belt: 0x2f2a1e } });
  F("rag_hoodie_sand", { name: "Sand Hoodie", group: "rag", rank: R_RIDER,
    note: "a hood is shade. that is the whole argument.",
    paint: "hoodie", family: "irregular", role: "line",
    colors: { legs: 0x3a3527, torso: 0xa08a62, collar: 0x7c6b4a, arms: 0xa08a62, shoes: 0x2b241c }, kit: {} });
  F("rag_hoodie_black", { name: "Black Hoodie", group: "rag", rank: R_RIDER,
    note: "the same fit the corner kids wear, on a man with an army.",
    paint: "hoodie", family: "irregular", role: "line",
    colors: { legs: 0x23262e, torso: 0x24272e, collar: 0x15171c, arms: 0x24272e, shoes: 0x191b20 }, kit: {} });
  F("rag_hoodie_green", { name: "Olive Hoodie", group: "rag", rank: R_RIDER,
    note: "half a uniform, which is most of one.",
    paint: "hoodie", family: "irregular", role: "line",
    colors: { legs: 0x2b3024, torso: 0x4a5238, collar: 0x333a27, arms: 0x4a5238, shoes: 0x22261c }, kit: {} });
  F("rag_leather", { name: "Leather Jacket", group: "rag", rank: R_RIDER,
    note: "the city's own. it survives sand better than it should.",
    paint: "leather", family: "irregular", role: "line",
    colors: { legs: 0x23262e, torso: 0x241c18, collar: 0x100c0a, arms: 0x241c18, shoes: 0x16110d },
    kit: { shades: 1 } });
  F("rag_denim", { name: "Denim Jacket", group: "rag", rank: R_RIDER,
    note: "blue on blue. nobody's soldier.",
    paint: "denim_jacket", family: "irregular", role: "line",
    colors: { legs: 0x2c3340, torso: 0x3a536e, collar: 0x2c4156, arms: 0x3a536e, shoes: 0x2b2b2b }, kit: {} });
  F("rag_track", { name: "Corner Tracksuit", group: "rag", rank: R_RIDER,
    note: "the hustler fit, on an island with no corners.",
    paint: "tracksuit", family: "irregular", role: "line",
    colors: { legs: 0x20242c, torso: 0x2bb673, collar: 0xeef3f7, arms: 0x2bb673, shoes: 0xf2f2f2 }, kit: {} });
  F("rag_track2", { name: "Sand Tracksuit", group: "rag", rank: R_RIDER,
    note: "second stripe, second colourway.",
    paint: "tracksuit2", family: "irregular", role: "line",
    colors: { legs: 0x2a2418, torso: 0xb08a3c, collar: 0xefe6cd, arms: 0xb08a3c, shoes: 0xe8e2cf }, kit: {} });
  F("rag_puffer", { name: "Block Puffer", group: "rag", rank: R_RIDER,
    note: "for the night, which out here is genuinely cold.",
    paint: "puffer", family: "irregular", role: "line",
    colors: { legs: 0x20242c, torso: 0x1d1f26, collar: 0x14161b, arms: 0x1d1f26, shoes: 0x101216 }, kit: {} });
  F("rag_varsity", { name: "Varsity Jacket", group: "rag", rank: R_CAPT,
    note: "somebody's son's, taken at an outpost.",
    paint: "varsity", family: "irregular", role: "line",
    colors: { legs: 0x23262e, torso: 0x6e1f2b, collar: 0xe9eaec, arms: 0x1d1f26, shoes: 0xe9eaec }, kit: {} });
  F("rag_athletic", { name: "Warm-Up Kit", group: "rag", rank: R_RIDER,
    note: "you still train. that is why you are still alive.",
    paint: "athletic", family: "irregular", role: "line",
    colors: { legs: 0x1f2936, torso: 0x315f9b, collar: 0xe6e7e3, arms: 0x315f9b, shoes: 0xe8e8e3 }, kit: {} });
  F("rag_designer", { name: "Designer Drip", group: "rag", rank: R_CMD,
    note: "the city's loudest fit, on the man who took the island.",
    paint: "designer", family: "irregular", role: "line",
    colors: { legs: 0xe9e4da, torso: 0x7a3df0, collar: 0xffd451, arms: 0x7a3df0, shoes: 0xffffff },
    kit: { shades: 1 } });
  F("rag_office", { name: "Staff Shirt & Tie", group: "rag", rank: R_CAPT,
    note: "shirt sleeves and a tie. the man doing the arithmetic.",
    paint: "office", family: "guard", role: "nco",
    colors: { legs: 0x39414f, torso: 0x9ab4c8, collar: 0x7d97ab, arms: 0x9ab4c8, shoes: 0x23262b },
    kit: { belt: 0x22262d } });

  const DEFAULT_FIT = "field_desert";

  /* THE OFFICER LADDER. Your fit names a family; your men wear that family's
     rung for their tier. Built once by scanning the catalogue so adding a fit
     with role:"officer" enrols it automatically. */
  const FAMILY = {};
  function buildFamilies() {
    for (let i = 0; i < ORDER.length; i++) {
      const f = FIT[ORDER[i]];
      if (!f.family) continue;
      const fam = FAMILY[f.family] || (FAMILY[f.family] = {});
      if (!fam[f.role]) fam[f.role] = f.id;
    }
    // every family must answer every rung; fall UP the ladder, then to the
    // desert line, so a lookup can never return nothing.
    for (const k in FAMILY) {
      const fam = FAMILY[k];
      fam.line = fam.line || fam.nco || fam.officer || DEFAULT_FIT;
      fam.nco = fam.nco || fam.line;
      fam.officer = fam.officer || fam.nco;
      fam.general = fam.general || fam.officer;
    }
  }
  buildFamilies();

  /* ============================================================ WORN STATE */
  function currentId() {
    const S = W.state;
    const id = S && S.you && S.you.fit;
    return (id && FIT[id]) ? id : DEFAULT_FIT;
  }
  function unlocked(fit) {
    return standing() >= (fit.rank || 0);
  }
  function wear(id, quiet) {
    const fit = FIT[id];
    if (!fit) return false;
    if (!unlocked(fit)) {
      W.toast(fit.rank + " men before you can wear that", "bad");
      return false;
    }
    W.state.you.fit = id;
    redressAll();
    if (!quiet) W.toast(fit.name.toUpperCase(), "good");
    W.emit("wardrobe:changed", { id: id, fit: fit });
    return true;
  }

  /* ============================================================ THE HOOK
     WHAT PUTS THE FIT ON THE MAN.

     `dressYou(rig)` is the call campaign.js and battle.js owe this module,
     one line after their `CBZ.studio.cast("officer", ...)`. Neither file
     calls it yet and neither is mine to edit, so until they do there is a
     lazy idempotent wrap on `CBZ.studio.cast` — bling.js's pattern — that
     does it for them.

     The wrap is precise rather than clever: `"officer"` is cast in EXACTLY
     two places in this whole game (campaign.js:381 youRig and
     battle.js:436 makeYou) and both of them are YOU. Every other body goes
     through CAST_OF (civilian/thug/guard/soldier) or mounts.js's "soldier".
     Grepped, not assumed. The moment those two files call dressYou the wrap
     can be deleted and nothing changes. `?wardrobe=old` removes it. */
  const worn = [];                        // rigs currently wearing your fit
  function trackRig(rig) {
    for (let i = worn.length - 1; i >= 0; i--) {
      const r = worn[i];
      if (!r || !r.group || !r.group.parent) worn.splice(i, 1);
    }
    if (worn.indexOf(rig) < 0) worn.push(rig);
  }
  function dressYou(x) {
    if (OFF) return false;
    const rig = rigOf(x);
    if (!rig) return false;
    trackRig(rig);
    ready();
    return applyNow(rig, currentId());
  }
  function dress(x, id) {
    const rig = rigOf(x);
    if (!rig) return false;
    ready();
    return applyNow(rig, FIT[id] ? id : currentId());
  }
  function redressAll() {
    if (OFF) return;
    for (let i = worn.length - 1; i >= 0; i--) {
      const rig = worn[i];
      if (!rig || !rig.group || !rig.group.parent) { worn.splice(i, 1); continue; }
      try { applyNow(rig, currentId()); } catch (e) {}
    }
  }
  /* YOUR OFFICERS TOO. battle.js dresses a roster; this is the one call it
     needs so your veterans read as YOUR veterans. A levy in your colours and
     a veteran in your colours must not be the same picture. */
  function fitForSoldier(s) {
    const me = FIT[currentId()];
    const fam = FAMILY[me.family] || FAMILY.desert || {};
    const t = (s && s.tier) || "levy";
    if (t === "veteran") return fam.officer || DEFAULT_FIT;
    if (t === "soldier") return fam.nco || fam.line || DEFAULT_FIT;
    return fam.line || DEFAULT_FIT;
  }
  function dressSoldier(x, s) {
    if (OFF) return false;
    const rig = rigOf(x);
    if (!rig) return false;
    ready();
    return applyNow(rig, fitForSoldier(s));
  }
  function wrapCast() {
    if (OFF || !CBZ.studio || typeof CBZ.studio.cast !== "function" || CBZ.studio.cast._wlWrapped) return;
    const base = CBZ.studio.cast;
    const wrapped = function (role, opts) {
      const g = base.apply(this, arguments);
      if (g && role === "officer" && !(opts && opts.noFit)) {
        try { dressYou(g); } catch (e) {}
      }
      return g;
    };
    wrapped._wlWrapped = true;
    CBZ.studio.cast = wrapped;
  }

  /* ============================================================ PREVIEW
     A wardrobe you read is a list; a wardrobe you SEE is a wardrobe.

     ONE extra WebGL context, alive only while the picker is open, disposed
     on close (forceContextLoss + dispose). It cannot share micro's renderer:
     #stage is an opaque full-screen DOM layer and micro draws the island
     behind it, so there is nothing to render the mannequin INTO except a
     canvas of our own.

     The same canvas also stamps every tile's portrait: on open it is sized
     down to thumbnail, walked over the catalogue two fits a frame with
     toDataURL after each render, then resized up for the live view. That
     also warms clothes.js's atlas cache for every fit in the game, which is
     why the first battle after opening the wardrobe does not hitch. */
  let PV = null;
  const THUMB = {};                       // fit id -> data URL, cached for the session
  const TQ = [];                          // tile ids waiting for a portrait
  const TW = 132, TH = 176;               // the tile's own 3:4, at the size it is drawn
  function makePreview() {
    if (PV) return PV;
    if (!THREE || !CBZ.studio || !CBZ.studio.cast) return null;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch (e) { return null; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    /* THE PREVIEW MUST BE THE SAME PIPELINE AS THE GAME, or it lies about the
       clothes. The first pass set outputEncoding = sRGB and no tone mapping,
       which is half of microboot's renderer — and the missing half is exactly
       the half that holds dark values down. The black suit photographed as
       MID-GREY next to a charcoal one and the two were indistinguishable in
       the grid: a linear->sRGB transfer with no ACES roll-off lifts 0x121318
       to roughly 0x4a4d55. microboot.js sets outputEncoding sRGB AND
       ACESFilmicToneMapping at exposure 1; copying both is what makes a black
       suit render black here and black on the sand. */
    if (THREE.sRGBEncoding != null) renderer.outputEncoding = THREE.sRGBEncoding;   // r128 spelling
    if (THREE.ACESFilmicToneMapping != null) renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 40);
    /* AND THE SAME LIGHT. These are games/warlord.html's own micro.lights
       arguments (sky 0xcfe0f2, ground 0xbf9a5e, sun 0xfff1cf at 1.12) with
       microboot's default hemi of 0.62 — so a fit that reads on the dune
       reads in the picker. The rim is the one addition and it is small: a
       portrait needs an edge or the silhouette dies against the card. */
    scene.add(new THREE.HemisphereLight(0xcfe0f2, 0xbf9a5e, 0.62));
    const sun = new THREE.DirectionalLight(0xfff1cf, 1.12);
    sun.position.set(2.4, 3.4, 2.4); scene.add(sun);
    const rim = new THREE.DirectionalLight(0x9fc0e8, 0.3);
    rim.position.set(-2.6, 1.6, -2.4); scene.add(rim);
    PV = { renderer: renderer, scene: scene, cam: cam, men: [], yaw: -0.62, raf: 0,
           dpr: Math.min(window.devicePixelRatio || 1, 2), canvas: renderer.domElement };
    return PV;
  }
  function pvMan(i, colour) {
    const p = PV;
    if (p.men[i]) return p.men[i];
    const g = CBZ.studio.cast("officer", { variant: 3 + i * 2, noFit: true, color: colour });
    if (!g) return null;
    p.scene.add(g);
    const m = { group: g, rig: g.userData.charRig };
    /* A SOFT CONTACT SHADOW. Without it a mannequin floats over nothing and
       every fit reads as a sticker rather than a man standing up. One
       transparent disc, no shadow map, no light cost. */
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 20),
      new THREE.MeshBasicMaterial({ color: 0x120e09, transparent: true, opacity: 0.34, depthWrite: false })
    );
    disc.rotation.x = -Math.PI / 2; disc.position.y = 0.005;
    g.add(disc);
    p.men[i] = m;
    return m;
  }
  /* FRAME THE MEN, NOT THE SCENE. Distance is solved from the body height and
     the row width, so one portrait and a six-man line are both full in frame
     without a hand-tuned camera number per plate. */
  function pvFrame(w, h, show, spread, yaw) {
    const p = PV;
    p.renderer.setPixelRatio(p.dpr);
    p.renderer.setSize(w, h, false);
    p.cam.aspect = w / h;
    pvFrame0(show, yaw, spread);
  }
  function pvFrame0(show, yaw, spread) {
    const p = PV;
    spread = spread || 0.98;
    const n = show.length;
    const width = (n - 1) * spread;
    for (let i = 0; i < p.men.length; i++) if (p.men[i]) p.men[i].group.visible = false;
    for (let i = 0; i < n; i++) {
      const m = p.men[show[i]];
      if (!m) continue;
      m.group.visible = true;
      m.group.position.set(-width / 2 + i * spread, 0, 0);
      m.group.rotation.y = yaw != null ? yaw : p.yaw;
    }
    const tall = 1.86;
    const vfov = p.cam.fov * Math.PI / 180;
    const dV = (tall * 0.62) / Math.tan(vfov / 2);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * p.cam.aspect);
    const dH = (width / 2 + 0.62) / Math.tan(hfov / 2);
    const d = Math.max(dV, dH);
    p.cam.position.set(0, 1.02, d);
    p.cam.lookAt(0, 0.94, 0);
    p.cam.updateProjectionMatrix();
    p.renderer.render(p.scene, p.cam);
  }
  /* ONE PORTRAIT, ON A MANNEQUIN OF ITS OWN.
     Man 0 is the big preview and man 1 is the thumbnail stand-in, so a
     portrait pass never has to undress and redress the fit you are looking
     at. Measured on this box's software GL: dressing is 1.3 ms warm,
     rendering 4 ms, and toDataURL is 40-60 ms — readback is the whole cost.
     That is why portraits are ONE PER FRAME and only for tiles that are
     actually on screen (see the observer below); a 74-fit up-front pass took
     5 s here and would have been a stall on a phone. */
  function renderThumb(id) {
    const p = PV;
    const m = pvMan(1);
    if (!m) return null;
    try { applyNow(m.rig, id); } catch (e) { return null; }
    /* PORTRAITS RENDER AT DPR 1, and that is the difference between a grid
       that fills in and one that does not. toDataURL reads the whole
       framebuffer back through the CPU and the cost is quadratic in pixel
       ratio: at the preview's own dpr 2 a 132x176 tile is a 264x352 readback
       and measured about 1 s each on this box's software GL — nine portraits
       in nine seconds. At dpr 1 it is a quarter of the pixels, and 132x176 is
       already more than the ~110 px the tile is drawn at. */
    p.renderer.setPixelRatio(1);
    p.renderer.setSize(TW, TH, false);
    p.cam.aspect = TW / TH;
    pvFrame0([1], -0.62);
    let url = null;
    try { url = p.renderer.domElement.toDataURL("image/png"); } catch (e) { url = null; }
    return url;
  }
  function pumpOne() {
    if (!TQ.length || !PV) return false;
    const id = TQ.shift();
    if (!id || THUMB[id]) return true;
    const url = renderThumb(id);
    THUMB[id] = url || "";
    if (!url) return true;
    const grid = document.getElementById("wlWdGrid");
    const tile = grid && grid.querySelector('[data-fit="' + id + '"] img');
    if (tile) { tile.src = url; tile.hidden = false; }
    return true;
  }
  /* THE PORTRAIT PUMP IS NOT ON rAF, and that was worth finding. Sharing the
     animation frame with the live preview meant it also shared it with
     micro's own render of a 14 km island behind this screen — the clock never
     pauses in this game, so the page was drawing the desert at full size
     every frame and rAF was running at one or two a second. One portrait per
     frame is then one portrait per second, and the grid never filled: six
     tiles in nine seconds, measured. A setTimeout chain with its own time
     slice runs between frames instead of inside them, and a slice rather than
     a count means a fast device finishes the visible row in one go and a slow
     one still hands the frame back. */
  let pumping = false;
  function startPump() {
    if (pumping || !TQ.length) return;
    pumping = true;
    const step = function () {
      if (!PV || !document.getElementById("wlWdGrid")) { pumping = false; return; }
      const t0 = (performance && performance.now) ? performance.now() : Date.now();
      while (TQ.length) {
        pumpOne();
        const t1 = (performance && performance.now) ? performance.now() : Date.now();
        if (t1 - t0 > 55) break;
      }
      if (!TQ.length) { pumping = false; return; }
      setTimeout(step, 0);
    };
    setTimeout(step, 0);
  }
  /* WHAT IS ON SCREEN GETS A PORTRAIT. An IntersectionObserver on the grid
     queues a tile the moment it scrolls into view and never queues it twice —
     so opening the wardrobe costs the dozen tiles you can see, not seventy. */
  let TOBS = null;
  function observeTiles() {
    const grid = document.getElementById("wlWdGrid");
    if (!grid) return;
    if (TOBS) TOBS.disconnect();
    if (!window.IntersectionObserver) {                    // no observer: queue the lot, still one a frame
      const kids = grid.children;
      for (let i = 0; i < kids.length; i++) queueTile(kids[i].getAttribute("data-fit"));
      return;
    }
    TOBS = new IntersectionObserver(function (entries) {
      for (let i = 0; i < entries.length; i++) {
        if (!entries[i].isIntersecting) continue;
        queueTile(entries[i].target.getAttribute("data-fit"));
        TOBS.unobserve(entries[i].target);
      }
    }, { root: document.getElementById("stage"), rootMargin: "420px 0px" });
    const kids = grid.children;
    for (let i = 0; i < kids.length; i++) TOBS.observe(kids[i]);
  }
  function queueTile(id) {
    if (!id || THUMB[id] != null || TQ.indexOf(id) >= 0) return;
    TQ.push(id);
    startPump();
  }

  /* ============================================================ THE SCREEN
     A DOCUMENT, NOT A DECISION — so it is ctx.screen, not the verb rail
     (games/warlord.html's own rule). It hands the screen straight back to
     whoever opened it and never takes a phase: loadout.js owns `armoury` and
     two modules fighting over one phase is the bug the router exists to stop.

     ULTRA SIMPLE CONTROLS, which is a hard rule of this whole game: the grid
     is looks you TAP. One tap wears it and the preview shows you wearing it.
     There is no colour picker, no slider, no confirm step and no second
     screen. A locked fit still shows — the ladder is the aspiration and
     hiding it makes the wardrobe look empty on day one. */
  let styled = false;
  function styleOnce() {
    if (styled) return;
    styled = true;
    const s = document.createElement("style");
    s.id = "wlWardrobeCss";
    s.textContent =
      '#wlWardBtn{position:fixed;z-index:46;left:calc(env(safe-area-inset-left,0px) + 14px);' +
        'top:calc(env(safe-area-inset-top,0px) + 52px);display:none;align-items:center;gap:7px;' +
        'appearance:none;cursor:pointer;border:1px solid rgba(255,255,255,.2);border-radius:12px;' +
        'background:rgba(12,9,5,.62);color:#f4ecd8;padding:9px 12px;' +
        'font:700 12px/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.16em}' +
      '#wlWardBtn.on{display:flex}' +
      '#wlWardBtn .sw{display:flex;height:14px;width:14px;border-radius:4px;overflow:hidden;' +
        'box-shadow:0 0 0 1px rgba(0,0,0,.5)}' +
      '#wlWardBtn .sw i{flex:1}' +
      '.wl-wd-stage{position:relative;display:flex;gap:14px;align-items:stretch;margin:0 0 12px}' +
      '.wl-wd-view{position:relative;flex:0 0 41%;min-height:250px;border-radius:14px;overflow:hidden;' +
        'border:1px solid rgba(255,255,255,.12);' +
        'background:radial-gradient(120% 90% at 50% 18%,#48331c,#191207 78%)}' +
      '.wl-wd-view canvas{position:absolute;inset:0;width:100%!important;height:100%!important;' +
        'touch-action:none;cursor:grab}' +
      '.wl-wd-view .spin{position:absolute;right:9px;top:8px;font-size:9px;' +
        'letter-spacing:.2em;opacity:.35}' +
      '.wl-wd-side{flex:1 1 auto;display:flex;flex-direction:column;justify-content:center;gap:7px;min-width:0}' +
      '.wl-wd-nm{font-size:clamp(19px,4.4vw,27px);letter-spacing:-.01em;line-height:1.04;margin:0}' +
      '.wl-wd-nt{font-size:12px;opacity:.62;line-height:1.4;margin:0}' +
      '.wl-wd-rk{display:inline-flex;align-items:center;gap:6px;align-self:flex-start;' +
        'border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:4px 10px;' +
        'font-size:10px;letter-spacing:.2em;opacity:.85}' +
      '.wl-wd-rk b{color:var(--hot)}' +
      '.wl-wd-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:2px 0 11px}' +
      '.wl-wd-tab{appearance:none;cursor:pointer;border:1px solid rgba(255,255,255,.14);' +
        'border-radius:999px;background:rgba(255,255,255,.04);color:inherit;' +
        'padding:8px 13px;font-size:11px;letter-spacing:.18em}' +
      '.wl-wd-tab.on{border-color:var(--hot);background:rgba(255,138,61,.16);color:#ffd7bd}' +
      '.wl-wd-grid{display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(104px,1fr))}' +
      '.wl-wd-t{appearance:none;cursor:pointer;text-align:left;padding:0;overflow:hidden;' +
        'border:1px solid rgba(255,255,255,.13);border-radius:13px;background:rgba(255,255,255,.035);' +
        'color:inherit;display:flex;flex-direction:column}' +
      '.wl-wd-t:active{transform:translateY(1px)}' +
      '.wl-wd-t.on{border-color:var(--hot);background:rgba(255,138,61,.15)}' +
      '.wl-wd-t.lock{opacity:.42}' +
      '.wl-wd-t .pic{position:relative;aspect-ratio:3/4;display:flex;' +
        'background:radial-gradient(120% 95% at 50% 12%,#4a3620,#171008 80%)}' +
      '.wl-wd-t .pic img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}' +
      '.wl-wd-t .pic .fig{position:absolute;inset:0;display:flex;flex-direction:column;' +
        'align-items:center;justify-content:flex-end;padding:11% 0 7%}' +
      '.wl-wd-t .pic .fig i{display:block;border-radius:2px}' +
      '.wl-wd-t .pic .fig .hd{width:22%;padding-top:22%;border-radius:4px;margin-bottom:3%}' +
      '.wl-wd-t .pic .fig .to{width:52%;height:31%;border-radius:4px 4px 2px 2px}' +
      '.wl-wd-t .pic .fig .lg{width:40%;height:29%;filter:brightness(.8)}' +
      '.wl-wd-t .pic .fig .sh{width:44%;height:5%}' +
      '.wl-wd-t .pic .tag{position:absolute;left:5px;top:5px;padding:2px 6px;border-radius:6px;' +
        'font-size:8.5px;letter-spacing:.14em;background:rgba(10,8,5,.78);border:1px solid rgba(255,255,255,.2)}' +
      '.wl-wd-t .pic .tag.worn{border-color:var(--hot);color:#ffd7bd}' +
      '.wl-wd-t .cap{padding:7px 8px 8px;display:flex;flex-direction:column;gap:2px;min-height:44px}' +
      '.wl-wd-t .cap b{font-size:11px;letter-spacing:.04em;line-height:1.2}' +
      '.wl-wd-t .cap span{font-size:9px;letter-spacing:.14em;opacity:.5}' +
      '.wl-wd-t.lock .cap span{opacity:.85;color:#ffb15a}' +
      /* PHONE: THE GRID HAS TO BE ON SCREEN. The first pass stacked a 300px
         preview, a rank pill, a name, two notes and a WRAPPED two-row tab bar
         above the tiles — measured at 375x667 the first tile row started at
         y=1290 of a 667pt viewport, so a player opening the wardrobe on a
         phone saw no looks at all until they scrolled. The picker is meant to
         be a grid you tap. So on a narrow screen the caption moves ON TOP of
         the preview under a scrim (it is a photo caption, and it costs nothing
         there), the third line goes (the rank pill already says it), and the
         tabs become one horizontally scrolling row. That is ~150px back, which
         is a whole tile row. */
      '@media (max-width:560px){' +
        '.wl-wd-stage{flex-direction:column;gap:0}' +
        '.wl-wd-view{flex:none;min-height:0;height:min(44vh,300px)}' +
        '.wl-wd-side{position:absolute;left:0;right:0;bottom:0;gap:2px;' +
          'padding:28px 13px 10px;border-radius:0 0 14px 14px;' +
          'background:linear-gradient(to top,rgba(14,10,6,.95) 48%,rgba(14,10,6,0))}' +
        '.wl-wd-sub2{display:none}' +
        '.wl-wd-nm{font-size:20px}' +
        '.wl-wd-nt{font-size:11px}' +
        '.wl-wd-rk{padding:3px 9px;font-size:9.5px}' +
        '.wl-wd-tabs{flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;' +
          'margin:10px 0 9px;padding-bottom:2px;scrollbar-width:none}' +
        '.wl-wd-tabs::-webkit-scrollbar{display:none}' +
        '.wl-wd-tab{flex:0 0 auto;padding:7px 12px}' +
        '.wl-h{margin:0 0 2px;font-size:26px}' +
        '.wl-sub{margin:0 0 9px}' +
        '.wl-wd-grid{grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:7px}' +
        '.wl-wd-t .cap{padding:6px 6px 7px;min-height:40px}' +
        '.wl-wd-t .cap b{font-size:10px}}' +
      '@media (max-width:340px){.wl-wd-grid{grid-template-columns:repeat(2,1fr)}}';
    document.head.appendChild(s);
  }

  const TABS = [
    { id: "all", label: "ALL" },
    { id: "field", label: "FIELD" },
    { id: "dress", label: "DRESS" },
    { id: "suit", label: "SUITS" },
    { id: "crew", label: "CREW" },
    { id: "rag", label: "IRREGULAR" },
  ];
  let TAB = "all";
  let BACK = null;

  function armyTiles() {
    /* THE SIBLING'S CATALOGUE, IF IT SHIPPED. warlord/outfits.js owns every
       faction's uniform, its camo and its tier ladder; a player who wants to
       ride in the Desert Legion's own kit — or in the fatigues he pulled off
       a dead Free Company sergeant — should get the real record from the file
       that owns it rather than a hand-copied approximation here. Absent
       sibling, or ?outfits=old, and there are simply no tiles.

       RANK COMES OFF THE TIER THE UNIFORM BELONGS TO, because that is what it
       costs to be seen in it: a levy's shirt is loot anyone can wear, a
       veteran's kit reads as somebody who commands and is gated like the rest
       of the ladder. */
    const out = [];
    if (!W.outfits || typeof W.outfits.catalogue !== "function") return out;
    let cat = null;
    try { cat = W.outfits.catalogue(); } catch (e) { return out; }
    if (!cat || !cat.length) return out;
    const RANK_OF = { levy: R_RIDER, raider: R_RIDER, soldier: R_CAPT, veteran: R_CMD };
    const ROLE_OF = { levy: "line", raider: "line", soldier: "nco", veteran: "officer" };
    for (let i = 0; i < cat.length; i++) {
      const c = cat[i];
      if (!c || !c.id || FIT["army_" + c.id]) continue;
      const col = c.colors || {};
      F("army_" + c.id, {
        name: c.name || String(c.id).toUpperCase(),
        group: "field", rank: RANK_OF[c.tier] != null ? RANK_OF[c.tier] : R_RIDER,
        note: c.note || ((c.faction ? c.faction : "somebody") + "'s own kit, taken off the sand."),
        paint: c.paint || "soldier", armyFit: c.id,
        family: "army:" + (c.faction || "x"), role: ROLE_OF[c.tier] || "line",
        accent: c.accent, wear: 0.2,
        colors: {
          legs: col.legs != null ? col.legs : 0x9d8862,
          torso: col.torso != null ? col.torso : 0xa8926a,
          collar: col.collar != null ? col.collar : 0x8a7654,
          arms: col.arms != null ? col.arms : (col.torso != null ? col.torso : 0xa8926a),
          shoes: col.shoes != null ? col.shoes : 0x453a2a,
          belt: col.belt,
        },
        kit: {},
      });
      out.push("army_" + c.id);
    }
    /* the officer ladder has to learn the new families, or a player wearing a
       looted Legion coat would have his own veterans in desert fatigues. */
    buildFamilies();
    return out;
  }

  function visible() {
    const out = [];
    for (let i = 0; i < ORDER.length; i++) {
      const f = FIT[ORDER[i]];
      if (TAB !== "all" && f.group !== TAB) continue;
      out.push(f);
    }
    /* THE ORDER IS THE LADDER. Inside a tab, what you can wear now comes
       first and the rungs above it follow in the order you will earn them —
       so the grid reads as a career and the locked fits are the reason to
       keep riding rather than dead rows in the middle of the list. */
    const st = standing();
    out.sort(function (a, b) {
      const la = st >= (a.rank || 0) ? 0 : 1, lb = st >= (b.rank || 0) ? 0 : 1;
      if (la !== lb) return la - lb;
      if ((a.rank || 0) !== (b.rank || 0)) return (a.rank || 0) - (b.rank || 0);
      return ORDER.indexOf(a.id) - ORDER.indexOf(b.id);
    });
    return out;
  }

  function tileHtml(f, curId, st) {
    const lock = st < (f.rank || 0);
    const c = f.colors || {};
    const K = f.kit || {};
    /* THE FALLBACK IS A FIGURE, NOT A SWATCH. Four colour bands looked like
       four colour bands: a grid of black suits was seven identical dark
       rectangles and you could not tell one from another. A head, a torso and
       two legs in the fit's own colours reads as a PERSON in a garment at
       88 px wide, which is the size these tiles are on a phone — and it is
       what the tile shows for the half second before its portrait renders. */
    const hat = K.head ? (K.headColor != null ? K.headColor : c.torso) : null;
    const fig = '<span class="fig">' +
      '<i class="hd" style="background:' + hex6(hat != null ? hat : 0xc9a07a) + '"></i>' +
      '<i class="to" style="background:' + hex6(c.torso) + '"></i>' +
      '<i class="lg" style="background:' + hex6(c.legs) + '"></i>' +
      '<i class="sh" style="background:' + hex6(c.shoes != null ? c.shoes : 0x201c15) + '"></i>' +
      '</span>';
    const url = THUMB[f.id];
    const img = '<img alt=""' + (url ? ' src="' + url + '"' : ' hidden') + '>';
    const tag = f.id === curId ? '<span class="tag worn">WORN</span>'
      : (lock ? '<span class="tag">' + f.rank + '</span>' : '');
    return '<button class="wl-wd-t' + (f.id === curId ? ' on' : '') + (lock ? ' lock' : '') +
      '" data-fit="' + f.id + '"' + (lock ? ' disabled' : '') + '>' +
      '<span class="pic">' + fig + img + tag + '</span>' +
      '<span class="cap"><b>' + f.name + '</b><span>' +
        (lock ? f.rank + " MEN" : (f.role === "general" ? "GENERAL" : f.group.toUpperCase())) +
      '</span></span></button>';
  }
  function paintScreen() {
    const cur = FIT[currentId()];
    const st = standing();
    const rank = rankOf(st);
    const list = visible();
    let h = '<h1 class="wl-h">THE <em>WARDROBE</em></h1>' +
      '<p class="wl-sub">WHAT THEY SEE COMING</p>' +
      '<div class="wl-wd-stage">' +
        '<div class="wl-wd-view" id="wlWdView"><div class="spin">DRAG TO TURN</div></div>' +
        '<div class="wl-wd-side">' +
          '<span class="wl-wd-rk">' + rank.label + ' &middot; <b>' + st + '</b> STANDING</span>' +
          '<h2 class="wl-wd-nm" id="wlWdName">' + cur.name + '</h2>' +
          '<p class="wl-wd-nt" id="wlWdNote">' + cur.note + '</p>' +
          '<p class="wl-wd-nt wl-dim wl-wd-sub2">' + rank.note + ' &middot; ' + W.armySize() + ' men, ' +
            ((W.state.fame | 0)) + ' fame' + '</p>' +
        '</div>' +
      '</div>';
    h += '<div class="wl-wd-tabs">';
    for (let i = 0; i < TABS.length; i++) {
      h += '<button class="wl-wd-tab' + (TAB === TABS[i].id ? ' on' : '') + '" data-tab="' + TABS[i].id + '">' +
        TABS[i].label + '</button>';
    }
    h += '</div>';
    h += '<div class="wl-wd-grid" id="wlWdGrid">';
    for (let i = 0; i < list.length; i++) h += tileHtml(list[i], cur.id, st);
    h += '</div>';
    h += '<div class="wl-btns" style="margin-top:18px">' +
      '<button class="wl-btn hot" id="wlWdDone">DONE</button></div>';
    const node = ctx.screen('<div class="wl-hudpad">' + h + '</div>');
    if (ctx.paintHud) ctx.paintHud();
    wireScreen(node);
    mountPreview();
    return node;
  }
  function repaintGrid() {
    const grid = document.getElementById("wlWdGrid");
    if (!grid) return;
    const cur = currentId(), st = standing(), list = visible();
    let h = "";
    for (let i = 0; i < list.length; i++) h += tileHtml(list[i], cur, st);
    grid.innerHTML = h;
    observeTiles();
  }
  function wireScreen(node) {
    node.onclick = function (e) {
      const t = e.target && e.target.closest ? e.target.closest("button") : null;
      if (!t) return;
      if (t.id === "wlWdDone") { close(); return; }
      if (t.hasAttribute("data-tab")) { TAB = t.getAttribute("data-tab"); paintScreen(); return; }
      const id = t.getAttribute("data-fit");
      if (id) {
        // ONE TAP IS THE WHOLE INTERACTION. No confirm, no second screen.
        wear(id);
        const f = FIT[id];
        const nm = document.getElementById("wlWdName"), nt = document.getElementById("wlWdNote");
        if (nm) nm.textContent = f.name;
        if (nt) nt.textContent = f.note;
        showFit(id);
        repaintGrid();
      }
    };
  }

  function mountPreview() {
    const host = document.getElementById("wlWdView");
    if (!host) return;
    const p = makePreview();
    if (!p) { host.innerHTML = '<div class="spin" style="position:static;padding:24px">NO PREVIEW ON THIS DEVICE</div>'; return; }
    host.insertBefore(p.canvas, host.firstChild);
    bindDrag(p, host);
    showFit(currentId());
    observeTiles();
    loop();
    // the atlas may still be in flight: repaint the man the moment it lands.
    ready().then(function () { showFit(currentId()); });
  }
  function bindDrag(p, host) {
    let down = false, lx = 0;
    host.onpointerdown = function (e) { down = true; lx = e.clientX; if (host.setPointerCapture) host.setPointerCapture(e.pointerId); };
    host.onpointermove = function (e) { if (!down) return; p.yaw -= (e.clientX - lx) * 0.012; lx = e.clientX; e.preventDefault(); };
    host.onpointerup = host.onpointercancel = function () { down = false; };
  }
  function showFit(id) {
    const p = PV;
    if (!p) return;
    const m = pvMan(0);
    if (!m) return;
    try { applyNow(m.rig, id); } catch (e) {}
    p.showing = id;
  }
  /* ONE rAF FOR BOTH JOBS: a portrait first (at most one, and only if a tile
     asked for it), then the live view at its real size. Doing them in
     separate loops meant two callbacks fighting over one canvas's dimensions
     and the preview flickering to thumbnail size. */
  function loop() {
    const p = PV;
    if (!p || !p.canvas || !p.canvas.parentNode) { if (p) p.raf = 0; return; }
    const host = p.canvas.parentNode;
    const w = Math.max(80, host.clientWidth | 0), h = Math.max(80, host.clientHeight | 0);
    pvFrame(w, h, [0]);
    p.raf = requestAnimationFrame(loop);
  }

  function open(opts) {
    /* ?wardrobe=old MEANS THERE IS NO WARDROBE. The revert has to remove the
       feature, not just the automatic dressing — otherwise the before side of
       a flag A/B photographs the picker it is supposed to be the absence of. */
    if (OFF) { W.toast("the wardrobe is off (?wardrobe=old)", "bad"); return; }
    opts = opts || {};
    BACK = opts.back || null;
    if (opts.tab && FIT) TAB = opts.tab;
    styleOnce();
    ready();
    armyTiles();
    hideWorldHud(true);
    paintScreen();
    W.emit("wardrobe:open");
  }
  /* CAMPAIGN'S OWN HUD SITS ABOVE THE STAGE. #wlCampHud is z-index 45 and
     #stage is 40, so the MAP button, the zoom pair and the name plates drew
     straight over the wardrobe — the first contact sheet has a MAP button
     sitting in the grid. It is not mine to restructure and it does not need
     restructuring: a screen that takes the world hides the world's furniture
     and puts it back on the way out. The fixed MEN/$/DAY strip stays, because
     every other full screen in this game keeps it and standing is the number
     this screen is about. */
  let campHudWas = null;
  function hideWorldHud(on) {
    const n = document.getElementById("wlCampHud");
    if (n) {
      /* RESTORE WHAT WAS THERE, not the empty string. campaign.js drives that
         node's own inline display, so blanking it on the way out would
         un-hide a HUD the campaign had deliberately put away. */
      if (on) { if (campHudWas === null) campHudWas = n.style.display; n.style.display = "none"; }
      else { n.style.display = campHudWas === null ? "" : campHudWas; campHudWas = null; }
    }
    if (chip) chip.classList.toggle("on", !on && chipPhase());
  }
  function close() {
    disposePreview();
    W.emit("wardrobe:close");
    const back = BACK; BACK = null;
    if (back) back();
    else {
      if (ctx && ctx.closeScreen) ctx.closeScreen();
      const p = W.phase && W.phase();
      if (p === "menu" || p == null) { if (W.campaign && W.campaign.enter) W.campaign.enter(); }
    }
    /* PUT THE WORLD'S FURNITURE BACK AFTER the screen has gone, not before:
       the chip decides whether to show by asking whether the grid is still in
       the document, and doing this first left the chip hidden until the next
       phase event. */
    hideWorldHud(false);
    paintChip();
  }
  function disposePreview() {
    const p = PV;
    TQ.length = 0;
    pumping = false;
    if (TOBS) { TOBS.disconnect(); TOBS = null; }
    if (!p) return;
    if (p.raf) cancelAnimationFrame(p.raf);
    /* A SECOND WEBGL CONTEXT MUST DIE WITH THE SCREEN. Browsers cap live
       contexts (16 on desktop, as few as 8 on a phone) and the one that gets
       killed to make room is the OLDEST — which would be micro's, i.e. the
       game. forceContextLoss is the only reliable release in r128. */
    try { p.renderer.forceContextLoss(); } catch (e) {}
    try { p.renderer.dispose(); } catch (e) {}
    if (p.canvas && p.canvas.parentNode) p.canvas.parentNode.removeChild(p.canvas);
    PV = null;
  }

  /* ============================================================ THE CHIP
     The one-tap way in. loadout.js owns the armoury screen and redraws it on
     every click, so injecting a button into it would be a fight; a chip of my
     own on the free LEFT edge (campaign.js's MAP and zoom own the right) is
     honest, always in the same place, and thumb-sized. It shows the fit you
     are wearing as three colour bars, which is also the fastest possible
     answer to "what am I wearing". */
  let chip = null;
  function buildChip() {
    if (chip || OFF) return;
    styleOnce();
    const b = document.createElement("button");
    b.id = "wlWardBtn";
    b.onclick = function () {
      const p = W.phase();
      open({ back: p === "armoury" ? function () { if (W.loadout && W.loadout.open) W.loadout.open(); } : null });
    };
    document.body.appendChild(b);
    chip = b;
    paintChip();
  }
  function chipPhase() {
    const p = W.phase();
    return p === "campaign" || p === "outpost" || p === "armoury";
  }
  function paintChip() {
    if (!chip) return;
    const on = chipPhase() && !document.getElementById("wlWdGrid");
    chip.classList.toggle("on", on);
    if (!on) return;
    const c = (FIT[currentId()] || {}).colors || {};
    chip.innerHTML = '<span class="sw">' +
      '<i style="background:' + hex6(c.torso) + '"></i>' +
      '<i style="background:' + hex6(c.legs) + '"></i></span>FIT';
  }

  /* ============================================================ MODULE */
  W.module("wardrobe", {
    needs: [],
    boot: function (c) {
      ctx = c;
      THREE = c.THREE || window.THREE;
      Q = c.Q;
      OFF = Q && Q.get("wardrobe") === "old";
      if (OFF) { console.log("[wardrobe] off (?wardrobe=old)"); return; }
      styleOnce();
      /* THE WRAP IS GONE, because the two files it stood in for now call
         dressYou() themselves — campaign.js at the youRig cast and battle.js
         at makeYou. It was correct and it was guarded to role "officer", so
         it never touched a soldier; it was still a monkeypatch on the engine
         entry point every man in the game is cast through, kept alive only
         because this module could not edit its callers. It can go now.
         wrapCast() is retained below and reachable via ?wardrobe=wrap for a
         page that somehow casts an officer neither file knows about. */
      if (Q && Q.get("wardrobe") === "wrap") wrapCast();
      buildChip();
      W.on("phase", paintChip);
      W.on("army", paintChip);
      W.on("wardrobe:changed", paintChip);
      /* A LOADED SAVE AND A NEW GAME BOTH REDRESS. `newGame` rebuilds
         `state.you` from scratch (no `fit` on it), which is correct — a new
         warlord starts in the fatigues he rode out in — but any rig already
         standing has to be told. */
      W.on("loaded", redressAll);
      W.on("newgame", redressAll);
      /* THE FIT GOES OVER THE WIRE. warnet's per-player packet is droppable
         4 Hz state, which is exactly the right lane for a costume: if it is
         late nobody dies, and every other warlord on the island eventually
         sees what you are wearing. */
      if (W.warnet && W.warnet.selfExtra) {
        try { W.warnet.selfExtra(function () { return { fit: currentId() }; }); } catch (e) {}
      }
      /* NOTHING HEAVY HERE. The two city files are fetched on idle so the
         picker is warm by the time anybody opens it, and the fetch is a
         script tag: it costs this boot nothing but a request. */
      const kick = function () { ready(); };
      if (window.requestIdleCallback) window.requestIdleCallback(kick, { timeout: 3000 });
      else setTimeout(kick, 600);
      /* ?wardrobe=1 — straight in, with an army to have earned something,
         so the picker is never blocked on campaign.js or a sibling module. */
      if (Q.get("wardrobe") === "1" || Q.get("wardrobe") === "open") {
        setTimeout(function () {
          if (!W.state.army.length && W.state.day === 1) {
            W.newGame({ seed: parseInt(Q.get("seed") || "", 10) || 1337 });
            if (W.loadout && W.loadout.demo) W.loadout.demo();
          }
          open();
        }, 0);
      }
    },

    // ---- the public surface ----
    open: open,
    close: close,
    list: function () { armyTiles(); return ORDER.map(function (id) { return FIT[id]; }); },
    fit: function (id) { return FIT[id] || null; },
    current: function () { return FIT[currentId()]; },
    currentId: currentId,
    wear: wear,
    unlocked: function (id) { const f = FIT[id]; return !!f && unlocked(f); },
    standing: standing,
    rank: function () { return rankOf(standing()); },
    rungs: rungs,
    families: function () { return FAMILY; },

    // ---- what campaign.js / battle.js / outfits.js call ----
    dressYou: dressYou,        // (rigOrGroup) -> paint YOUR chosen fit on him
    dress: dress,              // (rigOrGroup, fitId)
    dressSoldier: dressSoldier,// (rigOrGroup, soldier) -> the family's rank fit
    fitForSoldier: fitForSoldier,
    ready: ready,

    /* ---- the photography hook: a row of fits, side by side, in one shot.
            Used by tools/visual-presets/warlord-wardrobe.mjs and by anybody
            who wants to see the black suit standing in a camo line. ---- */
    lineup: function (ids, opts) {
      opts = opts || {};
      return ready().then(function () {
        const p = makePreview();
        if (!p) return null;
        const list = (ids || []).filter(function (i) { return FIT[i]; });
        const show = [];
        for (let i = 0; i < list.length; i++) {
          // men 0 and 1 are the preview and the portrait stand-in; a lineup
          // starts at 2 so opening the picker afterwards is not confusing.
          /* UNDER ?wardrobe=old THE MEN ARE NOT DRESSED, and that is the point:
             the before side of the flag A/B has to be what the player actually
             was without this file — campaign.js's studio.cast("officer",
             {color:0xc46a33}), one flat orange body, in the same lens and the
             same light. A "before" that quietly ran the new painter would be a
             picture of nothing. */
          const m = pvMan(2 + i, OFF ? 0xc46a33 : undefined);
          if (m) { if (!OFF) applyNow(m.rig, list[i]); show.push(2 + i); }
        }
        pvFrame(opts.width || 900, opts.height || 560, show,
                opts.spread || 0.98, opts.yaw != null ? opts.yaw : -0.34);
        return p.renderer.domElement.toDataURL("image/png");
      });
    },
    preview: function () { return PV; },
    off: function () { return OFF; },

    /* warmTiles(n) — render the first n tile portraits NOW and resolve when
       they are on the page. The picker itself never needs this: the
       IntersectionObserver fills the visible row on its own. It exists for
       photography, because "wait four seconds and hope" is the thing
       tools/visual-presets/README.md tells you not to write — on this box's
       software GL a portrait costs about a second and four seconds is six
       tiles, while on real hardware the same four seconds is the whole
       catalogue. Await a condition, not a clock. */
    warmTiles: function (n) {
      return ready().then(function () {
        return new Promise(function (res) {
          if (!PV) { res(0); return; }
          const list = visible().slice(0, n || 12).map(function (f) { return f.id; });
          let i = 0;
          const step = function () {
            const t0 = (performance && performance.now) ? performance.now() : Date.now();
            while (i < list.length) {
              const id = list[i++];
              if (THUMB[id] == null) THUMB[id] = renderThumb(id) || "";
              const t1 = (performance && performance.now) ? performance.now() : Date.now();
              if (t1 - t0 > 55) break;
            }
            if (i >= list.length) { repaintGrid(); showFit(currentId()); res(list.length); return; }
            setTimeout(step, 0);
          };
          setTimeout(step, 0);
        });
      });
    },
  });
})();
