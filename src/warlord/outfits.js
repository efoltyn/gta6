/* ============================================================
   warlord/outfits.js — EVERY ARMY ON THE ISLAND GETS ITS OWN UNIFORM.

   THE FAULT THIS FILE EXISTS TO FIX. battle.js built every man with
   `CBZ.studio.cast(role, { color: side.colour })`, which paints the torso,
   the yoke and nothing else. So a hundred-man fight was two solid blocks of
   flat tint, one amber and one whatever the band's hex happened to be, and
   the only thing you could read off the sand was WHICH SIDE a speck was on.
   Not who they were, not who was worth shooting first. A battle that reads as
   noise is a battle with no decisions in it, and "who gets the good rifle" —
   the one decision this whole game is built around — was invisible the moment
   the men were on the ground.

   WHAT A UNIFORM IS HERE, and it is not a colour:
     base cloth   the shirt/coat the army issued or scavenged
     webbing      belt, carrier, pouches — the thing that says "kitted"
     headwear     bare / rag / shemagh / cap / beret / helmet, the LADDER
     boots        dark, always: the one thing that never reads as sand
     accent       the faction's flag colour, carried on the head where the
                  silhouette is highest and a 200 m read still has it

   TIER IS VISIBLE INSIDE A FACTION. A levy and a veteran of the same army
   differ on all five axes at once, which is the only way it survives haze:
   the levy is washed out, bare-headed and beltless; the veteran is deep,
   helmeted, carrying webbing and wearing the accent twice.

   ---------------------------------------------------------------
   WHAT WAS TAKEN FROM city/outfits.js AND WHY (the owner asked for the
   suits, and the rest of that catalogue is 2492 lines of colour work nobody
   should retype).

   TAKEN VERBATIM — the colour SETS, cited by their catalogue id:
     suit / tuxedo   the whole point. A Free Company contract officer and a
                     Rival Warlord's lieutenants wear tailoring in a desert
                     because that is exactly what money looks like out here.
                     We do not copy the colours: clothes.js's SUIT_STYLES is
                     the real table (22 styles) and we name INDICES into it,
                     so a suit added there is a suit available here.
     leather         bandit veteran — a jacket taken off somebody.
     tactical        bandit veteran — all-black kit, looted, ill-fitting.
     sheriff         militia veteran — khaki over brown with a star: this
                     game's "the town elected him" NCO, unchanged.
     hunter/ranger/hiker/farmer/fisherman   the Oasis Militia entire. These
                     are the clothes of people who work water and land, which
                     is what a militia IS before it is a militia.
     security/driver/corrections/police     the Free Company. A private army
                     dresses like private security because it IS private
                     security with rifles.
     swat            the plate carrier, pouches, radio and helmet. Nobody
                     should draw a second one.
     denim_jacket / varsity / puffer / coveralls / tracksuit / hoodie /
     wifebeater / homeless / graphic_tee / basics
                     the Sand Bandits. "Mismatched scavenged civilian
                     clothes" is not a thing to invent — it is that list.

   TAKEN AND SHIFTED (each shift is commented at its site): the city's tans
   and khakis (ranger 0xb19a6a, sheriff 0xb8a070) are correct against forest
   and pavement and INVISIBLE against 0xd9b979 sand. Anything within a hair
   of the ground's own luminance is pushed off it — see readable().

   NOT TAKEN: the kids' rack, the dresses, the nightlife fits, the whole
   drip/heat/disguise economy. There is no club on this island.

   ---------------------------------------------------------------
   WHY THIS FILE PULLS city/clothes.js IN.

   The painted-garment atlas (city/clothes.js) is the engine's answer to
   "structure without geometry": one 128x256 canvas per outfit KEY, one
   CanvasTexture, ONE MeshLambertMaterial shared by every wearer, and lapels /
   duty belts / plate carriers / pocket flaps come free at the same draw-call
   cost as a flat box. It has no dependency on the city — no CBZ.game, no
   per-frame hook, no world — it needs THREE, CBZ.cmat and CBZ.boxGeom, all of
   which this page already has. So it is loaded here, unmodified, exactly the
   way games/warlord.html routes queryCollidersNear/floorAt/collide: reach the
   engine by NAME, never fork the file.

   city/outfits.js itself is NOT pulled in, and that is a judgement, not an
   oversight: it opens `const g = CBZ.game`, owns a disguise/heat/economy
   model, installs save wraps and runs a per-frame integrity sweep over
   CBZ.npcs. None of that has meaning on a page whose people are warband
   rosters. What this file wants from it is the CATALOGUE and the RECOLOUR,
   so it asks for the catalogue by name (CBZ.cityOutfitCatalog) and uses it
   when a page has it, transcribes the ~20 records it actually needs when a
   page does not, and publishes the recolour under the city's own exported
   name (CBZ.cityRecolorRig) only when nothing else has claimed it.

   ---------------------------------------------------------------
   WHAT THIS FILE USES OUT OF camo.js (sibling wave; consumed if present,
   never required). It landed while this was being written and its contract
   is POSITIONAL, not the object form the first draft here guessed at — that
   guess silently returned null for every call and cost eight dead cache
   entries before the audit caught it. What is actually used:

     W.camo.material(patternId, { tint, repeat })  -> ONE shared Lambert per
       look. This is the call that matters: two factions in one pattern at
       two tints cost two materials and share the texture.
     W.camo.repeatFor(patternId, widthM, heightM)  -> [rx, ry]. A torso box
       is 0.92 m across and a trouser leg 0.34 m, and BoxGeometry maps every
       face 0..1 — without this the pattern changes size at the knee. camo.js
       rounds the repeat to 1/8, which is why the whole army needs two
       textures per pattern rather than one per garment.
     W.camo.mean(patternId, opts)     -> the tile's mean colour. Used for the
       CAMPAIGN column, where men are instanced boxes: at strategic zoom a
       camouflage pattern IS its mean, which is camo.js's own finding.
     W.camo.pattern(id)               -> presence check before either.
     W.camo.factionDefault(fid)       -> the fallback when a fit names a
       pattern this build of camo.js does not ship.

   Absent, or reverted with ?camo=old, every camo fit falls back to its own
   flat base colour — a complete uniform on its own. Camo is seasoning here,
   never structure, and no record in this file depends on it existing.

   ---------------------------------------------------------------
   FLAGS (repo doctrine: every behaviour change reverts from the URL)
     ?outfits=old    this module does nothing. battle.js/campaign.js fall
                     back to the flat team tint, byte for byte.
     ?outfits=flat   uniforms, but no painted atlas and no camo map. The
                     honest floor: proves the colour work stands alone.
     ?outfits=1      THE GALLERY. Every faction x tier on a flat pad, no
                     campaign, no battle, no siblings needed.

   EVENTS: none owned. Nothing here emits.
============================================================ */
(function () {
  "use strict";
  const G = (typeof window !== "undefined" ? window : globalThis);
  const CBZ = (G.CBZ = G.CBZ || {});
  const W = (CBZ.warlord = CBZ.warlord || {});
  if (!W.module) return;                     // core.js did not load; nothing to attach to

  let CTX = null, MODE = "on", THREE = null;

  /* ============================================================ COLOUR
     Four helpers, and every one of them earns its place by being used in the
     tables below rather than by being general. tone() is city/outfits.js's
     own lighten/darken, copied because it is six lines and importing 2492 to
     get it would be the joke. */
  function tone(n, amt) {
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (amt > 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
    else { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
    return ((r | 0) << 16) | ((g | 0) << 8) | (b | 0);
  }
  function mix(a, b, t) {
    const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
    const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
    return ((((ar + (br - ar) * t) | 0) << 16) | (((ag + (bg - ag) * t) | 0) << 8) | (((ab + (bb - ab) * t) | 0)));
  }
  function lum(n) {
    // Rec.601 luma — the cheap one, and the right one here: we are asking
    // "will this separate from the ground for an eye", not colour science.
    return (((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) / 255;
  }
  /* THE SAND EATS EVERYTHING NEAR IT. The first draft of the Desert Legion
     was authentic sand-khaki and photographed as an empty dune with rifles in
     it: a uniform inside about a seventh of the ground's luminance has no
     edge left at range. So any cloth colour that lands in the ground's band
     is pushed OFF it — down, always down for anything at or below the ground,
     because a darker-than-sand army reads as men and a lighter one reads as
     glare. The hue is untouched; only the value moves.

     THE REFERENCE IS MEASURED, NOT TYPED, and it moved once already. The
     first version compared against 0xd9b979, the number a person means by
     "sand" — but what matters is what the ISLAND RENDERS, and that changed
     under the page's exposure fix (games/warlord.html used to raise two suns
     and two skies; another agent found and fixed it mid-wave). Photographed
     off the live campaign at seed 1337 after the fix, the island's dune faces
     come back at rgb(156,140,113). That is the number. It is compared against
     AUTHORED cloth values rather than rendered ones, which is not sloppiness:
     a vertical torso catches roughly two thirds of what a horizontal dune
     does, so an authored hex lands about a seventh of a stop below its own
     value on a body, and folding that into the guard is one constant instead
     of a lighting model in a wardrobe file. */
  const SAND_LUM = lum(0x9c8c71);            // measured off the live island, ~0.56
  const SAND_GUARD = 0.12;
  function readable(hex, isCamo) {
    /* CAMOUFLAGE IS EXEMPT AND THAT IS THE WHOLE POINT OF IT. Pushing the
       Desert Legion's cloth off the ground's value would be undoing camo.js's
       entire job — it scores its own patterns for concealment against this
       exact ground. A camouflaged army is SUPPOSED to be quiet; its read
       comes off the oxblood, the webbing and the headgear instead, which is
       what the glass-legion photograph is there to check. */
    if (isCamo) return hex;
    const L = lum(hex);
    if (Math.abs(L - SAND_LUM) >= SAND_GUARD) return hex;
    /* DIRECTION IS NOT SYMMETRIC and the first pass got it wrong in a way the
       gallery showed immediately: pushing everything DOWN turned the bandits'
       dirty-white singlet into a grey singlet, because 0xe6e3d9 is brighter
       than sand and was never in danger. Anything clearly lighter than the
       ground gets lifted further off it; everything at or below it — which is
       every khaki in this file — gets sunk, because a darker-than-sand army
       reads as men and a lighter one reads as glare. */
    const up = L > SAND_LUM + 0.04;
    const target = up ? SAND_LUM + SAND_GUARD : SAND_LUM - SAND_GUARD;
    if (up) return mix(hex, 0xffffff, Math.min(0.8, (target - L) / Math.max(0.001, 1 - L)));
    return mix(hex, 0x000000, Math.min(0.7, (L - target) / Math.max(0.001, L)));
  }
  /* ============================================================ THE COLOUR
     SPACE, and this is the single largest thing the first gallery run taught
     me. Every uniform photographed washed out — a rust hoodie came back
     salmon, black leather came back grey-brown, and the sand pad came back
     white paper.

     It is not the palette. `core/microboot.js:1234` sets
     `renderer.outputEncoding = THREE.sRGBEncoding`, so r128 hands
     `material.color` to the shader AS LINEAR and applies the sRGB transfer
     once at output. An sRGB-looking hex therefore carries roughly twice the
     reflectance it looks like, and comes back off the screen a long way
     lighter than the number you typed.

     THIS IS NOT A NEW FINDING ON THIS PAGE. warlord/desert.js:472-479 has the
     same paragraph, in the same words, about the same bug: its first draft
     used paint-program numbers for sand and "the whole island photographed as
     white paper", so its ground palette is stated as measured LINEAR albedos.
     warlord/camo.js:45 says it again from the texture side. The ground and
     the camouflage are both in linear; the CLOTH was the only thing left in
     sRGB, which is exactly why the men floated off the world they stand on.

     So every flat colour this file sets goes through toLinear() on its way to
     a material. The tables above stay authored in sRGB, because sRGB is what
     a hex means to a person and what city/outfits.js's catalogue is written
     in — the conversion belongs at the seam, not in the data.

     NOT converted, and each for a reason: the clothes.js atlas (its canvas is
     sRGB bytes and is tagged sRGBEncoding below, so three does the transfer),
     camo.js's textures (it tags its own), and skin/hair (entities/character.js
     owns those and a half-converted body is worse than an unconverted one).

     Revert: ?outfits=srgb, or CBZ.CONFIG.WARLORD_OUTFIT_LINEAR = false. */
  let LINEAR = true;
  const linCache = new Map();
  function lin1(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  /* AND BACK, for sample() only. The flat path stores linear on the
     material while a clothes.js atlas and camo.js both store sRGB, so a
     sampler that reported material.color raw would be comparing two colour
     spaces and every metric built on it would be nonsense — flat uniforms
     would score as darker than painted ones by construction. Everything
     sample() reports comes back in the space the tables are AUTHORED in. */
  const unlinCache = new Map();
  function unlin1(c) { return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }
  function fromLinear(hex) {
    if (!LINEAR || hex == null) return hex;
    const k = hex | 0;
    let v = unlinCache.get(k);
    if (v !== undefined) return v;
    const r = unlin1(((k >> 16) & 255) / 255), g = unlin1(((k >> 8) & 255) / 255), b = unlin1((k & 255) / 255);
    v = (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
    unlinCache.set(k, v);
    return v;
  }
  function toLinear(hex) {
    if (!LINEAR || hex == null) return hex;
    const k = hex | 0;
    let v = linCache.get(k);
    if (v !== undefined) return v;
    const r = lin1(((k >> 16) & 255) / 255), g = lin1(((k >> 8) & 255) / 255), b = lin1((k & 255) / 255);
    v = (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
    linCache.set(k, v);
    return v;
  }

  /* A DESERT BLEACHES CLOTH AND THEN DIRTIES IT. Two moves, opposite
     directions, and applying only one is what made the first pass look like a
     paint chart: sun lifts the mid-tones toward the sand, dust drops the
     highlights toward it. Both pull toward the SAME hex, which is why an army
     that has been out here a month hangs together no matter what it started
     as. `wear` 0 = straight out of the crate, 1 = a year on the island. */
  const DUST = 0xbca57e;
  function weathered(hex, wear) {
    if (!(wear > 0)) return hex;
    const L = lum(hex);
    // pale cloth dirties, dark cloth fades: same pull, different strength
    const t = wear * (L > 0.55 ? 0.22 : 0.13);
    return mix(hex, DUST, t);
  }

  /* ============================================================ THE DICE
     Deterministic, always: the same man must look the same in the campaign
     column, on the battlefield, in the aftermath list and after a save. Every
     roll below is W.hash01 off the soldier's id — never Math.random, never
     the campaign's own RNG stream (which advances, so reading it here would
     make a man's face depend on how many bands had spawned before him). */
  function h(id, salt) { return W.hash01(id | 0, 7, salt | 0); }
  function pickBy(list, id, salt) { return list[Math.floor(h(id, salt) * list.length) % list.length]; }

  /* ============================================================ WHAT WE
     BORROWED, AS DATA. Prefer the live city catalogue when a page has it —
     then these two tables can never drift — and fall back to the transcribed
     records on a slice page like this one. Only the fits this game actually
     wears are transcribed; the citation is the catalogue id itself. */
  const BORROWED = {
    // ---- the bandits: city/outfits.js street + money racks ----
    homeless:     { legs: 0x3a3026, torso: 0x4a4236, collar: 0x6b5a48, arms: 0x4a4236, shoes: 0x2b241c },
    wifebeater:   { legs: 0x35383f, torso: 0xe6e3d9, collar: 0xe6e3d9, arms: 0xcf9a72, shoes: 0x2b2b2b },
    basics:       { legs: 0x39414f, torso: 0x8a939c, collar: 0x6d7682, arms: 0x8a939c, shoes: 0x2b2b2b },
    hoodie:       { legs: 0x23262e, torso: 0x3a3f4a, collar: 0x2a2e36, arms: 0x3a3f4a, shoes: 0x191b20 },
    graphic_tee:  { legs: 0x39414f, torso: 0x7a3b3b, collar: 0xe9eaec, arms: 0x7a3b3b, shoes: 0x2b2b2b },
    tracksuit:    { legs: 0x20242c, torso: 0x2bb673, collar: 0xeef3f7, arms: 0x2bb673, shoes: 0xf2f2f2 },
    denim_jacket: { legs: 0x2c3340, torso: 0x3a536e, collar: 0x2c4156, arms: 0x3a536e, shoes: 0x2b2b2b },
    varsity:      { legs: 0x23262e, torso: 0x6e1f2b, collar: 0xe9eaec, arms: 0x1d1f26, shoes: 0xe9eaec },
    coveralls:    { legs: 0x3a4150, torso: 0x3a4150, collar: 0x2a2f3a, arms: 0x3a4150, shoes: 0x2b241c },
    puffer:       { legs: 0x20242c, torso: 0x1d1f26, collar: 0x14161b, arms: 0x1d1f26, shoes: 0x101216 },
    leather:      { legs: 0x23262e, torso: 0x241c18, collar: 0x100c0a, arms: 0x241c18, shoes: 0x16110d },
    tactical:     { legs: 0x121418, torso: 0x121418, collar: 0x0b0c0f, arms: 0x121418, shoes: 0x0b0c0f },
    // ---- the militia: the working-outdoors rows ----
    farmer:       { legs: 0x3d5872, torso: 0x76543a, collar: 0xd2b58b, arms: 0x76543a, shoes: 0x3b2c1d },
    fisherman:    { legs: 0xc99928, torso: 0x283d50, collar: 0xe1bd45, arms: 0x283d50, shoes: 0x1d2924 },
    hiker:        { legs: 0x3d4650, torso: 0xb94f2f, collar: 0x27313a, arms: 0xb94f2f, shoes: 0x3a2e20 },
    hunter:       { legs: 0x4a4d32, torso: 0x465038, collar: 0xe86d16, arms: 0x465038, shoes: 0x2b241c },
    busdriver:    { legs: 0x24304a, torso: 0x2f5a6b, collar: 0x1c3a44, arms: 0x2f5a6b, shoes: 0x101216 },
    ranger:       { legs: 0x3f4b2e, torso: 0xb19a6a, collar: 0x4a5835, arms: 0xb19a6a, shoes: 0x352a1d },
    janitor:      { legs: 0x3a3f46, torso: 0x4a5560, collar: 0x363b42, arms: 0x4a5560, shoes: 0x2b2b2b },
    mailman:      { legs: 0x2f4a6b, torso: 0x3a6a96, collar: 0x274056, arms: 0x3a6a96, shoes: 0x2b241c },
    sheriff:      { legs: 0x5a4632, torso: 0xb8a070, collar: 0x7a6a4a, arms: 0xb8a070, shoes: 0x2b241c, belt: 0x1a140c },
    firefighter:  { legs: 0xb09a6e, torso: 0xb09a6e, collar: 0xe8d44a, arms: 0xb09a6e, shoes: 0x16110d },
    // ---- the company: the private-security rows ----
    security:     { legs: 0x1c1f26, torso: 0x1c1f26, collar: 0xe8e8e8, arms: 0x1c1f26, shoes: 0x101216 },
    driver:       { legs: 0x202733, torso: 0xc9d3dc, collar: 0x27354a, arms: 0xc9d3dc, shoes: 0x101216 },
    cabincrew:    { legs: 0x18243a, torso: 0x223552, collar: 0xb52d3c, arms: 0x223552, shoes: 0x10151d },
    police:       { legs: 0x1b2a44, torso: 0x24407a, collar: 0x16264a, arms: 0x24407a, shoes: 0x101216, belt: 0x0d111c },
    pitcrew:      { legs: 0x17253a, torso: 0x17253a, collar: 0xc93632, arms: 0x17253a, shoes: 0x11151b },
    corrections:  { legs: 0x202936, torso: 0x34475d, collar: 0xaab7c2, arms: 0x34475d, shoes: 0x111419, belt: 0x111419 },
    swat:         { legs: 0x2e332b, torso: 0x3a4034, collar: 0x22261f, arms: 0x33382e, shoes: 0x101216, belt: 0x0d111c },
    // ---- the legion: the two military rows ----
    soldier:      { legs: 0x4a5238, torso: 0x4a5238, collar: 0x3a4030, arms: 0x4a5238, shoes: 0x2b2a22 },
    mariner:      { legs: 0x19283d, torso: 0xf0f1ed, collar: 0x213a5a, arms: 0xf0f1ed, shoes: 0x10151d },
    warden:       { legs: 0x171c28, torso: 0x222b3d, collar: 0xe8e3d8, arms: 0x222b3d, shoes: 0x090b0f, belt: 0x111419 },
    // ---- money ----
    suit:         { legs: 0x14161c, torso: 0x1c2030, collar: 0x2a3047, arms: 0x1c2030, shoes: 0x0c0d10 },
    tuxedo:       { legs: 0x14151a, torso: 0x16171c, collar: 0x24262e, arms: 0x16171c, shoes: 0x08090c, gloss: true },
  };
  function borrowed(id) {
    // the live city wardrobe wins when a page has one, so the two tables can
    // never disagree about what "sheriff khaki" is.
    try {
      const cat = CBZ.cityOutfitCatalog && CBZ.cityOutfitCatalog();
      if (cat && cat[id] && cat[id].colors) return cat[id].colors;
    } catch (e) {}
    return BORROWED[id] || null;
  }

  /* ============================================================ FACTION KIT
     Five armies, and each one is a SENTENCE before it is a palette. The
     sentence is in `reads`, and if a fit below cannot be justified by it the
     fit is wrong, not the sentence.

     `accent` is the flag colour core.js already declared in W.FACTIONS —
     read from there rather than retyped, because a faction that changes
     colour in one file and not the other is a bug you find in a screenshot
     six weeks later. */
  const KIT = {
    bandit: {
      reads: "mismatched scavenged civilian clothes, nothing matches, nothing fits",
      boots: [0x2b241c, 0x3a2e22, 0x1f1a14, 0x453629],
      wear: 0.85,                            // filthiest army on the island
      head: { levy: ["none", "rag"], raider: ["rag", "shemagh"], soldier: ["shemagh", "cap"], veteran: ["helmet", "shemagh"] },
    },
    militia: {
      reads: "farmers and well-crews who all tied the same green cloth on this morning",
      boots: [0x3b2c1d, 0x33291e, 0x2b241c],
      wear: 0.55,
      /* THE GREEN IS ON EVERY HEAD OR THE FACTION HAS NO IDEA. The first pass
         let hard headgear take the uniform's own darkest tone (right for an
         army that ISSUES caps) and a militiaman in the hiker's blue-grey
         trousers ended up in a navy cap — which is a man in his own clothes,
         not a militia. `headAccent` says: whatever this man is wearing, the
         cloth on his head is the one thing everybody agreed on this morning. */
      headAccent: true,
      head: { levy: ["rag", "rag"], raider: ["rag", "cap"], soldier: ["cap", "cap"], veteran: ["cap", "helmet"] },
    },
    company: {
      reads: "professional, matched, bought as a lot — the tiers differ by KIT, never by cloth",
      boots: [0x101216, 0x14171d],
      wear: 0.18,                            // they have a laundry
      head: { levy: ["cap", "none"], raider: ["cap", "beret"], soldier: ["beret", "cap"], veteran: ["helmet", "beret"] },
    },
    legion: {
      /* THE ONE FACTION WHOSE UNIFORM ACCENT IS NOT ITS BANNER COLOUR, and it
         is a deliberate split. core.js gives the Legion 0xb9a13f, a gold that
         is within a few points of the island's own sand — perfect on a banner
         against sky, and the exact colour a head disappears in against a
         dune. So the FLAG stays gold (territory.js and the campaign banners
         read core), the uniform's accent is a deeper gold that survives the
         ground, and RANK is oxblood: the only saturated thing this army
         wears, on a cap band, a collar and a shoulder flash. */
      accent: 0xa8862c, rank: 0x8e2f2a,
      reads: "a real army: issued cloth, camo above levy, rank on the shoulder and the cap band",
      boots: [0x3a2018, 0x2b1a14],
      wear: 0.4,
      head: { levy: ["shemagh", "none"], raider: ["cap", "shemagh"], soldier: ["cap", "beret"], veteran: ["helmet", "cap"] },
    },
    warlord: {
      reads: "his colours, deliberately, on every man — and his lieutenants are in tailoring",
      boots: [0x14121a, 0x0f0d14],
      wear: 0.25,
      head: { levy: ["none", "rag"], raider: ["rag", "shemagh"], soldier: ["beret", "cap"], veteran: ["beret", "helmet"] },
    },
    /* YOUR WARBAND IS THE SIXTH ARMY AND IT IS THE ONLY ONE THAT LOOKS LIKE
       ITS OWN HISTORY. You do not issue uniforms; you take men. So one of
       yours wears whatever he was wearing when you beat him — his ORIGIN
       faction's fit, hashed off his id and stable forever — with one thing
       added: your amber on his head. That is a mechanic you can see. An army
       of forty is forty different men with one colour in common, and it looks
       progressively more like an army as veterans accumulate. */
    you: {
      reads: "everyone you ever beat, wearing your amber and nothing else of yours",
      boots: [0x2b241c, 0x1f1a14],
      wear: 0.6,
      headAccent: true,        // your amber is the ONLY thing your army shares
      head: { levy: ["rag", "none"], raider: ["rag", "shemagh"], soldier: ["shemagh", "cap"], veteran: ["helmet", "shemagh"] },
    },
  };

  const YOUR_COLOUR = 0xffb347;              // battle.js's SIDES.mine colour; one source of truth
  function accentOf(fid) {
    if (fid === "you") return YOUR_COLOUR;
    const K = KIT[fid];
    if (K && K.accent != null) return K.accent;
    const F = W.faction ? W.faction(fid) : null;
    return (F && F.colour) || 0xc4593a;
  }
  function rankColourOf(fid) {
    const K = KIT[fid];
    return (K && K.rank != null) ? K.rank : accentOf(fid);
  }

  /* ============================================================ THE FITS
     ~60 records. Each one is (faction, tier, variant) and each names at most
     one PAINTED look plus the flat colours underneath it.

     THE ATLAS-KEY TRAP, and it cost the first draft an afternoon. clothes.js
     caches one canvas per painted KEY, and for an ordinary painter the key is
     the BARE ID — colours are NOT part of it. So two records that both say
     `paint:"soldier"` with different colours silently share whichever atlas
     was built first. The rule that falls out is absolute: EACH PAINTER ID
     APPEARS EXACTLY ONCE IN THIS TABLE. Where a look is genuinely wanted
     twice, use the colour-keyed families instead, which clothes.js does key
     on colour: `basics|hex`, `hoodie|hex|hex`, `gang|hex|hex`, `suit|index`.
     audit() below fails loudly if this table ever breaks the rule. */
  function C(id, over) {
    const b = borrowed(id) || {};
    const o = {};
    for (const k in b) o[k] = b[k];
    if (over) for (const k in over) o[k] = over[k];
    return o;
  }

  const FITS = [
    // ================= SAND BANDITS =================================
    { f: "bandit", t: "levy", id: "bd_rags", name: "Ragged Layers", paint: "homeless",
      colors: C("homeless", { torso: 0x5a4030, collar: 0x7d6448 }), note: "the city's homeless painter is an open tattered coat over a mismatched under-shirt. That is a bandit levy exactly; nothing about it needed changing but the dust." },
    { f: "bandit", t: "levy", id: "bd_vest", name: "Sun Vest", paint: "wifebeater",
      colors: C("wifebeater", { legs: 0x4a4034 }), note: "bare arms because it is 44 degrees. SKIN-keyed atlas: the shoulders match the man's own tone, which is why we never pass colors.skin." },
    { f: "bandit", t: "levy", id: "bd_dust", name: "Dust Shirt", paint: "basics",
      colors: C("basics", { torso: 0x9a6b45, arms: 0x9a6b45, collar: 0x745034, legs: 0x4a4438 }),
      note: "basics is colour-keyed, so three armies can wear it in three colours off three atlases." },
    { f: "bandit", t: "raider", id: "bd_hood", name: "Rust Hood", paint: "hoodie", force: 1,
      colors: C("hoodie", { torso: 0x8a4b30, arms: 0x8a4b30, collar: 0x5e3220, legs: 0x39332a }) },
    { f: "bandit", t: "raider", id: "bd_tee", name: "Bandit Colours", paint: "graphic_tee",
      colors: C("graphic_tee", { torso: 0x7a3b3b, arms: 0x7a3b3b, collar: 0xd8cdb4, legs: 0x3d4148 }) },
    { f: "bandit", t: "raider", id: "bd_track", name: "Stripe Track Top", paint: "tracksuit",
      colors: C("tracksuit", { torso: 0x6e2f30, arms: 0x6e2f30, legs: 0x24222a, shoes: 0xd8cdb4 }),
      note: "the city's tracksuit is emerald; a bandit's is whatever the shop had. Same painter, one colour set, no second atlas." },
    { f: "bandit", t: "soldier", id: "bd_denim", name: "Cut Denim", paint: "denim_jacket", belt: 1,
      colors: C("denim_jacket", { legs: 0x33384a }) },
    { f: "bandit", t: "soldier", id: "bd_varsity", name: "Chapter Jacket", paint: "varsity", belt: 1,
      colors: C("varsity", { torso: 0x5e2a26, shoes: 0x24262e }) },
    { f: "bandit", t: "soldier", id: "bd_overall", name: "Scav Coveralls", paint: "coveralls", belt: 1,
      colors: C("coveralls", { torso: 0x6a5a3e, arms: 0x6a5a3e, legs: 0x6a5a3e, collar: 0x50432c }) },
    { f: "bandit", t: "veteran", id: "bd_leather", name: "Looted Leather", paint: "leather", belt: 1,
      colors: C("leather"), note: "taken off somebody. The city's colours, untouched — black leather is black leather." },
    { f: "bandit", t: "veteran", id: "bd_puffer", name: "Padded Coat", paint: "puffer", belt: 1,
      colors: C("puffer", { torso: 0x2e2320, arms: 0x2e2320, collar: 0x1d1512, legs: 0x24232a }),
      note: "the city's puffer is 0x1d1f26, and stacked next to the looted leather and the looted tactical kit it made a veteran rank of three identical black boxes. Warmed into a dirty oxblood-black so the three read as three coats." },
    { f: "bandit", t: "veteran", id: "bd_black", name: "Looted Black Kit", paint: "tactical", belt: 1,
      colors: C("tactical"), note: "he took it off a Company veteran and it does not fit him. City record verbatim." },

    // ================= OASIS MILITIA ================================
    { f: "militia", t: "levy", id: "ml_farm", name: "Farm Overalls", paint: "farmer",
      colors: C("farmer") },
    { f: "militia", t: "levy", id: "ml_oil", name: "Well Oilskins", paint: "fisherman",
      colors: C("fisherman"), note: "the oilskin yellow is the loudest thing either side fields and it stays: a militia that reads INSTANTLY as not-an-army is the point of the faction." },
    { f: "militia", t: "levy", id: "ml_green", name: "Green Shirt", paint: "basics", green: 1,
      colors: C("basics", { torso: 0x4a7a52, arms: 0x4a7a52, collar: 0x3a5f40, legs: 0x3f4436 }),
      note: "improvised uniformity: it is not a uniform, it is everyone having dyed a shirt in the same bucket." },
    { f: "militia", t: "raider", id: "ml_trail", name: "Trail Layers", paint: "hiker",
      colors: C("hiker") },
    { f: "militia", t: "raider", id: "ml_hunt", name: "Field Gear", paint: "hunter", belt: 1,
      colors: C("hunter") },
    { f: "militia", t: "raider", id: "ml_canal", name: "Canal Crew", paint: "busdriver",
      colors: C("busdriver") },
    { f: "militia", t: "soldier", id: "ml_ranger", name: "Ranger Uniform", paint: "ranger", belt: 1,
      colors: C("ranger", { torso: 0x6d7a4a, arms: 0x6d7a4a }),
      note: "the ONE shift on this record: the city's ranger torso is 0xb19a6a, a tan tuned against forest. Against 0xd9b979 sand it has no edge at all, so the tunic goes green-khaki and the trousers stay." },
    { f: "militia", t: "soldier", id: "ml_grey", name: "Militia Greys", paint: "janitor", belt: 1,
      colors: C("janitor") },
    { f: "militia", t: "soldier", id: "ml_drill", name: "Oasis Drill", camo: "woodland", belt: 1,
      colors: { legs: 0x33402c, torso: 0x3f6b45, arms: 0x3f6b45, collar: 0x2c4a30, shoes: 0x33291e },
      note: "no painted atlas on purpose — this is the record camo.js gets to prove itself on, and with camo.js absent it is still a complete green drill uniform." },
    { f: "militia", t: "veteran", id: "ml_star", name: "Sheriff Khakis", paint: "sheriff", belt: 1, badge: 1,
      colors: C("sheriff", { torso: 0x9a8452, arms: 0x9a8452, legs: 0x4a3826 }),
      note: "kept whole for the star and the trouser stripe — this is the man the town elected. Torso dropped two steps off the city's 0xb8a070 for the same sand-luma reason as the ranger." },
    { f: "militia", t: "veteran", id: "ml_pump", name: "Pump Crew Turnout", paint: "firefighter", belt: 1,
      colors: C("firefighter", { torso: 0x3f5a3e, arms: 0x3f5a3e, legs: 0x3f5a3e }),
      note: "turnout gear, green. A militia veteran wearing the fire station's coat is the most honest sentence in this whole table." },
    { f: "militia", t: "veteran", id: "ml_post", name: "Oasis Drill Blues", paint: "mailman", belt: 1, badge: 1,
      colors: C("mailman", { torso: 0x3c6b4a, arms: 0x3c6b4a, legs: 0x2c4a38, collar: 0x244032 }) },

    // ================= FREE COMPANY =================================
    // Every man is the same slate. The LADDER is webbing and headgear, which
    // is what "professional" actually looks like from 200 m: not five
    // uniforms, one uniform and visibly different amounts of kit on it.
    { f: "company", t: "levy", id: "co_black", name: "Company Blacks", paint: "security",
      colors: C("security", { torso: 0x243447, arms: 0x243447, collar: 0x31465e, legs: 0x1b2531 }),
      note: "TWO FIXES ON ONE RECORD. The city puts 0xe8e8e8 on the yoke and its own file calls that the white-neck-roll bug. And the city's guard blacks are 0x1c1f26, which at 60 m on a dune is the same silhouette as the Rival Warlord's black-and-violet — the line-of-battle shot had two armies reading as one dark block. The Company's cloth is now unmistakably BLUE slate: still sober, still professional, and no longer confusable at range." },
    { f: "company", t: "levy", id: "co_grey", name: "Duty Shirt", paint: "driver",
      colors: C("driver") },
    { f: "company", t: "levy", id: "co_plain", name: "Company Fatigues",
      colors: { legs: 0x1e2836, torso: 0x33465e, arms: 0x33465e, collar: 0x2a3a4e, shoes: 0x101216 } },
    { f: "company", t: "raider", id: "co_patrol", name: "Patrol Jacket", paint: "police", belt: 1,
      colors: C("police", { torso: 0x2e4560, arms: 0x2e4560, legs: 0x1e2a3c, collar: 0x1a2537 }),
      note: "police carries the jacket shell, the duty belt and the badge — three structures for free. Retinted off the city's 0x24407a beat blue so nobody mistakes a contractor for a cop." },
    { f: "company", t: "raider", id: "co_nav", name: "Contract Navy", paint: "cabincrew", belt: 1,
      colors: C("cabincrew", { collar: 0x3f7fb8 }) },
    { f: "company", t: "raider", id: "co_field", name: "Company Field", camo: "urbandigi", camoTint: 0xa8b2bd, belt: 1,
      colors: { legs: 0x1c2532, torso: 0x2d3e54, arms: 0x2d3e54, collar: 0x243244, shoes: 0x101216 } },
    { f: "company", t: "soldier", id: "co_slate", name: "Slate Uniform", paint: "corrections", belt: 1, badge: 1,
      colors: C("corrections", { collar: 0x5d6b7a }),
      note: "collar dragged down off the city's 0xaab7c2: a near-white yoke on a slate uniform is the priest look the wardrobe's own comments keep warning about." },
    { f: "company", t: "soldier", id: "co_pit", name: "Vehicle Crew", paint: "pitcrew", belt: 1,
      colors: C("pitcrew", { collar: 0x3f7fb8 }) },
    { f: "company", t: "soldier", id: "co_line", name: "Line Kit", camo: "multicam", camoTint: 0xb9c2cc, belt: 1, badge: 1,
      colors: { legs: 0x1f2b3a, torso: 0x36495f, arms: 0x36495f, collar: 0x3f7fb8, shoes: 0x101216 } },
    { f: "company", t: "veteran", id: "co_plate", name: "Carrier and Helmet", paint: "swat_unmarked", belt: 1,
      colors: C("swat", { torso: 0x35485e, arms: 0x2e3f52, legs: 0x232f3d, collar: 0x1e2833 }),
      note: "the engine's plate carrier: pouches, radio, cummerbund, knee pads. UNMARKED, because the marked painter stamps the word SWAT into the atlas and a mercenary company on a desert island is not a police tactical team." },
    { f: "company", t: "veteran", id: "co_suit", name: "Contract Officer", paint: "suit", style: 0, belt: 1,
      colors: C("suit"), note: "THE SUIT, and this is the argument for it: a Free Company is a business. The man who signs is on the field in a charcoal two-piece with two hundred rifles behind him, and you can pick him out of the line at a glance." },
    { f: "company", t: "veteran", id: "co_suit2", name: "Company Broker", paint: "suit", style: 2,
      colors: C("suit"), note: "SUIT_STYLES[2], Mid-Grey. Indices, not colours: clothes.js owns the table and a suit added there is a suit available here." },

    // ================= DESERT LEGION ================================
    // The only army with a real supply chain, so it is the only one whose
    // tiers step through ISSUE: no camo, camo, camo + rank, plate + rank.
    { f: "legion", t: "levy", id: "lg_con", name: "Conscript Drab",
      colors: { legs: 0x4d4630, torso: 0x6a6142, arms: 0x6a6142, collar: 0x555030, shoes: 0x3a2018 },
      note: "a conscript gets cloth, not camo. That absence IS the tier read." },
    { f: "legion", t: "levy", id: "lg_con2", name: "Depot Issue",
      colors: { legs: 0x453f2c, torso: 0x5d5638, arms: 0x5d5638, collar: 0x4a442c, shoes: 0x3a2018 } },
    { f: "legion", t: "levy", id: "lg_con3", name: "Second-Hand Drab", camo: "khaki",
      colors: { legs: 0x4a4430, torso: 0x635b3c, arms: 0x635b3c, collar: 0x4f492f, shoes: 0x2b1a14 },
      note: "one levy in three has a camo shirt off a dead man, which is where camo.js first appears in the ladder." },
    { f: "legion", t: "raider", id: "lg_camo", name: "Camo Fatigues", paint: "soldier", belt: 1,
      colors: C("soldier", { torso: 0x7f7048, arms: 0x7f7048, legs: 0x574c31, collar: 0x8e2f2a }),
      note: "OLIVE FIRST, AND IT PHOTOGRAPHED AS A JUNGLE ARMY. The city's soldier record is 0x4a5238 — correct for a green war and wrong on a dune, and the painter's own blot chips (grey, tan, sage) are neutral enough to carry a khaki base straight into a three-colour desert. The city's `soldier` painter scatters its own deterministic blot field off the base colour — a desert camo for free, cached once, at the same draw call as a flat box." },
    { f: "legion", t: "raider", id: "lg_field", name: "Field Fatigues", camo: "desert3", belt: 1,
      colors: { legs: 0x4a4630, torso: 0x655e3c, arms: 0x655e3c, collar: 0x514b30, shoes: 0x3a2018 } },
    { f: "legion", t: "raider", id: "lg_field2", name: "Line Fatigues", camo: "chip6", belt: 1,
      colors: { legs: 0x3f4230, torso: 0x555a38, arms: 0x555a38, collar: 0x44482e, shoes: 0x3a2018 } },
    { f: "legion", t: "soldier", id: "lg_tunic", name: "Service Tunic", paint: "mariner", belt: 1, badge: 1,
      colors: C("mariner", { torso: 0x7a7150, arms: 0x7a7150, legs: 0x45402a, collar: 0x8e2f2a }),
      note: "the mariner painter is a tunic with a collar band and a chest rank block. Retinted drab with an OXBLOOD collar, which is the Legion's rank colour and the only saturated thing it wears." },
    { f: "legion", t: "soldier", id: "lg_line", name: "Marked Fatigues", camo: "desert3", belt: 1, badge: 1,
      colors: { legs: 0x45402a, torso: 0x6a6242, arms: 0x6a6242, collar: 0x8e2f2a, shoes: 0x3a2018 },
      note: "oxblood on the yoke: a rank flash where a flat fit still owns its collar." },
    { f: "legion", t: "soldier", id: "lg_line2", name: "Section Fatigues", camo: "marpat", belt: 1,
      colors: { legs: 0x413d2a, torso: 0x625b3c, arms: 0x625b3c, collar: 0x8e2f2a, shoes: 0x2b1a14 } },
    { f: "legion", t: "veteran", id: "lg_plate", name: "Legion Carrier", camo: "desert3", camoTint: 0xcfc4ae, belt: 1, badge: 1,
      colors: { legs: 0x3e3a28, torso: 0x585236, arms: 0x585236, collar: 0x8e2f2a, shoes: 0x2b1a14 },
      note: "no painted atlas because the one plate carrier in the engine is already spoken for by the Company, and two armies sharing one atlas key is the trap at the top of this table." },
    { f: "legion", t: "veteran", id: "lg_dress", name: "Officer's Coat", paint: "warden", belt: 1, badge: 1,
      colors: C("warden", { torso: 0x4a4530, arms: 0x4a4530, legs: 0x3a3624, collar: 0x8e2f2a }),
      note: "braid, epaulettes, a badge and a peaked cap. THE RANK SHOWING — this is the record that makes the brief's sentence about the Legion true." },
    { f: "legion", t: "veteran", id: "lg_vet", name: "Old Hand", camo: "wadishadow", belt: 1, badge: 1,
      colors: { legs: 0x3a3726, torso: 0x504b32, arms: 0x504b32, collar: 0x8e2f2a, shoes: 0x2b1a14 } },

    // ================= RIVAL WARLORD ================================
    // One painter, four atlases, because `gang|torso|collar` is colour-keyed:
    // a diagonal SASH across the chest in the accent, a band round the back
    // and a leg stripe. It is the single best thing in city/clothes.js for
    // this game — "his colours, deliberately" drawn as a literal sash.
    { f: "warlord", t: "levy", id: "wl_press", name: "Pressed Man", paint: "basics",
      colors: C("basics", { torso: 0x6a5570, arms: 0x6a5570, collar: 0x4a3a52, legs: 0x2b2836 }),
      note: "a levy has the colour and not the sash: he has been given a shirt, not made one of them." },
    { f: "warlord", t: "levy", id: "wl_press2", name: "Conscript Violet", paint: "hoodie", force: 1,
      colors: C("hoodie", { torso: 0x5b4668, arms: 0x5b4668, collar: 0x352a40, legs: 0x26232f }) },
    { f: "warlord", t: "raider", id: "wl_sash", name: "Sash and Stripe", paint: "gang", gang: "wl_raider",
      colors: { torso: 0x6b3f8a, arms: 0x6b3f8a, collar: 0x2a1c38, legs: 0x2c2838, shoes: 0x14121a } },
    { f: "warlord", t: "raider", id: "wl_sash2", name: "Colours Worn Low", paint: "gang", gang: "wl_raider2",
      colors: { torso: 0x7a4a96, arms: 0x7a4a96, collar: 0x1c1622, legs: 0x26232f, shoes: 0x14121a } },
    { f: "warlord", t: "soldier", id: "wl_gold", name: "Gold Sash", paint: "gang", gang: "wl_soldier",
      colors: { torso: 0x8f4fb8, arms: 0x8f4fb8, collar: 0xd8b73a, legs: 0x282434, shoes: 0x14121a }, belt: 1,
      note: "the sash goes gold at soldier. It is the cheapest tier read in the game and it survives 200 m of haze better than anything else in this file." },
    { f: "warlord", t: "soldier", id: "wl_gold2", name: "House Livery", camo: "tigerdesert", camoTint: 0xbfa8d0, belt: 1,
      colors: { torso: 0x5e3a78, arms: 0x5e3a78, collar: 0xd8b73a, legs: 0x282434, shoes: 0x14121a } },
    { f: "warlord", t: "veteran", id: "wl_black", name: "Black and Violet", paint: "gang", gang: "wl_vet", belt: 1, badge: 1,
      colors: { torso: 0x3a2a4c, arms: 0x3a2a4c, collar: 0x8f4fb8, legs: 0x2a2338, shoes: 0x14101c },
      note: "NOT ACTUALLY BLACK, and the line-of-battle shot is why. A true-black veteran block beside the Free Company's dark slate read as one army at 60 m; leaning it into aubergine keeps the 'his best men wear black' idea and keeps the hue that says whose they are." },
    { f: "warlord", t: "veteran", id: "wl_suit", name: "Lieutenant's Suit", paint: "suit", style: 3, belt: 1, badge: 1,
      colors: C("suit"), note: "SUIT_STYLES[3], Black. His lieutenants dress like his money, and against a dune a black suit is the highest-contrast object either army owns." },
    { f: "warlord", t: "veteran", id: "wl_suit2", name: "Enforcer's Pinstripe", paint: "suit", style: 4, badge: 1,
      colors: C("suit"), note: "SUIT_STYLES[4], Navy Pinstripe." },
    { f: "warlord", t: "veteran", id: "wl_suit3", name: "The Warlord's Own", paint: "suit", style: 10, badge: 1,
      colors: C("suit"), note: "SUIT_STYLES[10], Burgundy 3-Piece — the waistcoat reads at portrait range and the shape reads at 200 m." },

    // ================= YOUR WARBAND (the sixth army) ================
    // Only the top of your ladder is yours; everything below it is borrowed
    // from whoever you took the man off (see forSoldier). These three are
    // what a man looks like once he has been with you long enough.
    { f: "you", t: "veteran", id: "yo_own", name: "Warlord's Own", belt: 1, badge: 1,
      colors: { legs: 0x1c1814, torso: 0x241e19, arms: 0x241e19, collar: 0xffb347, shoes: 0x120f0c },
      note: "amber on the yoke and the head. The first genuinely YOURS kit, and it only ever appears on men who have survived three fights." },
    { f: "you", t: "veteran", id: "yo_plate", name: "Household Carrier", camo: "wadishadow", camoTint: 0xd8c39a, belt: 1, badge: 1,
      colors: { legs: 0x2b2620, torso: 0x453b30, arms: 0x453b30, collar: 0xffb347, shoes: 0x16120e } },
    { f: "you", t: "soldier", id: "yo_line", name: "Amber Band", belt: 1,
      colors: { legs: 0x3d352c, torso: 0x6b5c48, arms: 0x6b5c48, collar: 0xffb347, shoes: 0x2b241c },
      note: "a soldier of yours is issued canvas; a veteran of yours is issued black. The two used to be one brown apart and photographed as the same man twice." },
  ];

  /* THE WARLORD'S LIVERY CREW HAS NO PAINTED ATLAS ON PURPOSE. `pitcrew` —
     the obvious painter for a house livery — already belongs to the Free
     Company one block up, and one atlas key cannot serve two colour sets
     (see THE ATLAS-KEY TRAP). So that record takes camo.js's TIGER STRIPE
     tinted violet instead, which is a better answer anyway: camo.js's own
     note calls tiger stripe "showy elite, reads at 30 m", which is exactly
     what a warlord dresses his people in. */

  /* ============================================================ INDEX */
  let INDEX = null;                          // "faction|tier" -> [fit]
  let BY_ID = null;
  function index() {
    if (INDEX) return INDEX;
    INDEX = {}; BY_ID = {};
    for (let i = 0; i < FITS.length; i++) {
      const f = FITS[i];
      f.faction = f.f; f.tier = f.t;
      f.accent = f.accent == null ? accentOf(f.f) : f.accent;
      const k = f.f + "|" + f.t;
      (INDEX[k] = INDEX[k] || []).push(f);
      BY_ID[f.id] = f;
    }
    return INDEX;
  }

  /* ============================================================ forSoldier
     THE ONE ENTRY POINT. Deterministic, cheap, no allocation on the hot path
     (the record is shared; the per-man variation is the three small numbers
     returned alongside it). */
  function factionOf(band) {
    if (!band) return "you";
    if (band.mine || band.you) return "you";
    return band.faction || "bandit";
  }
  /* A MAN IN YOUR ARMY IS STILL WEARING THE ARMY HE CAME FROM. Hashed off his
     id, so the same man is the same ex-legionary forever — through a save,
     through a network hop, through the aftermath list. Only a veteran (he has
     been with you long enough for you to have kitted him) gets one of YOUR
     records, and even then only two thirds of the time. */
  const ORIGINS = ["bandit", "militia", "company", "legion", "warlord"];
  function forSoldier(s, band) {
    index();
    if (!s) return FITS[0];
    const id = s.id | 0;
    let fid = factionOf(band);
    const tier = s.tier || "levy";
    if (fid === "you") {
      const own = INDEX["you|" + tier];
      if (!own || !own.length || h(id, 91) > 0.66) fid = ORIGINS[Math.floor(h(id, 17) * 5) % 5];
    }
    let list = INDEX[fid + "|" + tier];
    if (!list || !list.length) list = INDEX[fid + "|soldier"] || INDEX["bandit|levy"];
    const rec = list[Math.floor(h(id, 23) * list.length) % list.length];
    return rec;
  }

  /* Per-man dressing numbers that are NOT worth a record each: which boot
     colour, which headwear off the tier's two, how dusty, whether the accent
     rag is on. Sixty records times four boots times two hats is 480 looks out
     of a table you can still read. */
  function detail(s, band, rec) {
    const id = (s && s.id) | 0;
    const fid = factionOf(band);
    const K = KIT[fid] || KIT.bandit;
    const tier = (s && s.tier) || "levy";
    const heads = (K.head[tier] || ["none", "rag"]);
    return {
      faction: fid,
      accent: fid === "you" ? YOUR_COLOUR : (rec.accent != null ? rec.accent : accentOf(fid)),
      rankHex: fid === "you" ? YOUR_COLOUR : rankColourOf(fid),
      headAccent: !!K.headAccent,
      boots: pickBy(K.boots, id, 41),
      head: heads[Math.floor(h(id, 53) * heads.length) % heads.length],
      /* WEAR IS QUANTISED TO FOUR STEPS, and the measurement is the argument.
         A continuous roll gives every man his own slightly-different dusty
         brown, and since paintSlot resolves colours through CBZ.cmat — a
         cache keyed on the exact hex — a continuous roll means a NEW SHARED
         MATERIAL PER MAN PER CLOTH REGION. Casting 300 legionaries produced
         449 distinct materials where twelve fits should need a few dozen.
         Four steps of grime is more variation than an eye can find at
         battle range and it collapses the cache to what the catalogue
         actually contains. Measured: 449 -> see audit(). */
      wear: K.wear * (0.55 + Math.round(h(id, 67) * 3) / 3 * 0.75),
      rank: W.tierIndex ? W.tierIndex(tier) : 0,
    };
  }

  /* ============================================================ PAINTING
     paintSlot is the clone-on-write pattern city/outfits.js documents, with
     ONE deliberate difference, and the difference is measured.

     The city clones the shared cmat material before its first setHex, because
     a city player recolours ONE body and must not repaint the shared pool.
     That is right there and wrong here: we recolour three hundred bodies at
     once and never mutate a colour afterwards, so cloning would allocate
     roughly six materials per man — about 1800 MeshLambertMaterials and 1800
     uniform blocks for one battle, where every one of them is a duplicate of
     one of about forty distinct colours in this whole file.

     So we ASSIGN out of CBZ.cmat's cache instead of cloning-and-setting. Same
     visual result, no allocation, no bleed (we never touch a material's
     colour — we swap which shared material the mesh points at), and the army
     collapses to ~40 materials. The guard against painted cloth is kept
     verbatim from the city: a mesh clothes.js dressed carries
     userData._cbzPart and a Lambert colour on a mapped material MULTIPLIES
     the map, which darkens the artwork instead of recolouring the garment. */
  function paintSlot(list, hex, visible) {
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (!m) continue;
      if (hex != null && !(m.userData && m.userData._cbzPart)) {
        const h = toLinear(hex);
        if (CBZ.cmat) m.material = CBZ.cmat(h);
        else if (m.material && m.material.color && m.material.color.setHex) {
          if (m.material._shared) m.material = m.material.clone();
          m.material.color.setHex(h);
        }
      }
      if (visible != null) m.visible = visible;
    }
  }

  /* THE CAMO MATERIAL CACHE — one entry per (pattern, tint, part), because
     camo.js's own material() is already cached on exactly those and asking
     it twice is a Map lookup. What this layer adds is the PART SIZE: the
     repeat has to come from the box the cloth is stretched over, or the
     pattern is one size on a chest and another on a shin. Three part sizes,
     read off the rig's own profile where it has one. */
  const PART_M = { torso: [0.92, 0.95], arms: [0.30, 0.92], legs: [0.34, 0.95] };
  function camoPattern(rec, det) {
    const camo = W.camo;
    if (!camo || typeof camo.material !== "function") return null;
    let id = rec.camo;
    // a pattern this build of camo.js does not ship falls back to the
    // faction's own default rather than to nothing.
    if (id && camo.pattern && !camo.pattern(id)) id = null;
    if (!id && camo.factionDefault) {
      const d = camo.factionDefault(det.faction === "you" ? "bandit" : det.faction);
      id = d && d.pattern;
    }
    return id || null;
  }
  function camoMaterial(pattern, part, tint) {
    const camo = W.camo;
    if (MODE === "flat" || !camo || typeof camo.material !== "function") return null;
    try {
      const m = PART_M[part] || PART_M.torso;
      const rep = camo.repeatFor ? camo.repeatFor(pattern, m[0], m[1]) : 1;
      return camo.material(pattern, { repeat: rep, tint: tint == null ? 0xffffff : tint });
    } catch (e) { return null; }
  }
  function paintCamo(list, mat) {
    if (!list || !mat) return;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (!m || (m.userData && m.userData._cbzPart)) continue;
      m.material = mat;
    }
  }

  /* HALF A BODY IN ONE COLOUR SPACE IS WORSE THAN NONE OF IT. The first run
     with linear cloth photographed men in properly-weighted uniforms with
     BONE-WHITE FACES and hands: entities/character.js builds skin, hair and
     the hand caps from ordinary sRGB hexes (0xc9a07a is the default tone),
     and against cloth that had been moved into linear they read as ghosts.

     So the skin comes across too — once per rig, off whatever tone the rig
     was actually BUILT with rather than a number typed here, so a cast that
     rolls six skin tones keeps all six. The head is the one mesh that must
     not be handed a shared material: character.js allocates it through mat()
     rather than cmat() precisely because systems/reactions.js flashes its
     emissive per actor, and putting it on the shared cache would make one
     man's hit light up every man with his complexion. Its colour is set in
     place instead. */
  function relin(list, inPlace) {
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (!m || !m.material || !m.material.color || !m.material.color.getHex) continue;
      if (m.userData && m.userData._cbzPart) continue;
      const l = toLinear(m.material.color.getHex());
      if (inPlace && !m.material._shared) m.material.color.setHex(l);
      else if (CBZ.cmat) m.material = CBZ.cmat(l);
      else { if (m.material._shared) m.material = m.material.clone(); m.material.color.setHex(l); }
    }
  }
  function relinearSkin(ch) {
    if (!LINEAR || !ch || ch._wlSkinLin) return;
    ch._wlSkinLin = 1;
    const s = ch.skinSlots;
    relin(s.head, true);
    relin(s.hands, false);
    relin(s.hair, false);
    const f = ch.face;
    if (f) relin([f.eyeL, f.eyeR, f.brow, f.mouth], true);
  }

  /* THE ATLAS IS sRGB BYTES AND NEVER SAID SO. city/clothes.js paints its
     garments into a 2d canvas in ordinary sRGB hex — "#8a4b30" means what it
     looks like — and then builds a CanvasTexture WITHOUT setting
     `encoding = THREE.sRGBEncoding`. On a renderer with outputEncoding sRGB
     (this page, microboot.js:1234) three reads those bytes as linear and the
     transfer is applied a second time on the way out, so every painted
     uniform in the engine renders roughly a stop and a half over. It is the
     same class of bug warlord/camo.js:45 calls out and the same one
     warlord/desert.js fixed for the ground; clothes.js is simply the last
     surface still in the wrong space.

     Fixed HERE, at the consumer, once per atlas, because forking an engine
     file is not allowed and is not the right answer anyway: the texture is
     shared, the flag is a declaration rather than a behaviour, and the city
     would want the same correction the day anybody looks. Worth pushing
     upstream — noted in the report. Revert with the same flag as the flat
     path, since the two have to agree or the atlas and the trousers fight.

     r128 spelling throughout: `encoding` / `THREE.sRGBEncoding`, never
     `colorSpace` (that is r152+ and does not exist here). */
  function tagAtlasSRGB(pr, ch) {
    if (!LINEAR || !THREE || !THREE.sRGBEncoding || !CBZ.cityClothesTex) return;
    let set = null;
    try { set = CBZ.cityClothesTex(pr, ch); } catch (e) { return; }
    if (!set) return;
    const fix = function (t, m) {
      if (!t || t.encoding === THREE.sRGBEncoding) return;
      t.encoding = THREE.sRGBEncoding;
      t.needsUpdate = true;
      if (m) m.needsUpdate = true;
    };
    fix(set.tex, set.mat);
    if (set.yoke) fix(set.yoke.tex, set.yoke.mat);
  }

  /* ============================================================ HEADWEAR
     THE ONE THING THIS FILE DRAWS, and it draws it because the engine cannot
     add one after the fact: entities/character.js builds its cap at
     construction time off `c.cap` and there is no seam to add one later, and
     studio.cast does not forward a cap for most roles anyway. The bandana in
     city/clothes.js is the closest thing and it CLONES its material per rig —
     correct for one player changing colours, wrong for three hundred men who
     share four.

     Geometry comes out of CBZ.boxGeom (cached, shared, `_shared`) and every
     material out of CBZ.cmat, so a whole army's headwear is a handful of
     objects. Sizes are derived from the rig's own profile.headSize, never
     typed, which is why they land right on a smaller body too.

     WHY HEADWEAR AND NOT A CHEST FLASH. At 200 m through fog the only part of
     a voxel man with clean sky behind it is his head. A shoulder patch is
     gone by 80 m; a pale wrap on a dark man is still there at 300. */
  const HEAD_TYPES = ["none", "rag", "shemagh", "cap", "beret", "helmet"];
  function headSizeOf(ch) {
    if (ch && ch.profile && ch.profile.headSize > 0) return ch.profile.headSize;
    const hd = ch && ch.skinSlots && ch.skinSlots.head && ch.skinSlots.head[0];
    const p = hd && hd.geometry && hd.geometry.parameters;
    return (p && p.width) || 0.6;
  }
  function box(w, hh, d, hex) {
    const g = CBZ.boxGeom ? CBZ.boxGeom(w, hh, d) : new THREE.BoxGeometry(w, hh, d);
    const lh = toLinear(hex);
    const m = CBZ.cmat ? CBZ.cmat(lh) : new THREE.MeshLambertMaterial({ color: lh });
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = false;                 // a hat's shadow is inside the head's
    mesh.receiveShadow = false;
    return mesh;
  }
  function headwear(ch, type, hex, band) {
    if (!ch || !THREE) return null;
    const host = ch.neck || ch.head || (ch.skinSlots && ch.skinSlots.head && ch.skinSlots.head[0]);
    if (!host || !host.add) return null;
    let g = ch._wlHead;
    if (g && g.userData.wl === type + "|" + hex + "|" + band) { g.visible = type !== "none"; return g; }
    if (g) { host.remove(g); ch._wlHead = null; g = null; }
    if (type === "none") { paintSlot(ch.skinSlots && ch.skinSlots.hair, null, true); return null; }
    const H = headSizeOf(ch), k = H / 0.6;
    g = new THREE.Group();
    g.name = "warlord-headwear";
    if (type === "rag") {
      // a band tied round the forehead with a knot tail — the cheapest read,
      // and the only one a levy gets.
      const b = box(H * 1.06, H * 0.2, H * 1.06, hex); b.position.y = H * 0.74; g.add(b);
      const tail = box(H * 0.16, H * 0.3, H * 0.1, hex); tail.position.set(H * 0.26, H * 0.6, -H * 0.55); tail.rotation.z = 0.35; g.add(tail);
    } else if (type === "shemagh") {
      // wrap + a drape down the back and over the shoulders. The desert's own
      // silhouette, and the widest one in the ladder.
      const crown = box(H * 1.1, H * 0.5, H * 1.1, hex); crown.position.y = H * 0.72; g.add(crown);
      const drape = box(H * 1.16, H * 0.62, H * 0.24, hex); drape.position.set(0, H * 0.26, -H * 0.52); g.add(drape);
      // the pulled-up face cloth is a detail, not the silhouette: only the
      // men who get an accent band get it, which keeps the mesh count down
      // and reads as "he covered up" rather than "everybody covered up".
      if (band != null) { const face = box(H * 0.72, H * 0.26, H * 0.12, tone(hex, -0.18)); face.position.set(0, H * 0.3, H * 0.52); g.add(face); }
      if (band != null) { const cord = box(H * 1.12, H * 0.07, H * 1.12, band); cord.position.y = H * 0.94; g.add(cord); }
    } else if (type === "cap") {
      // character.js's own cap numbers (0.66/0.22 crown, 0.66/0.1/0.3 brim,
      // y = headSize + 0.07k) so an attached cap and a built-in cap are the
      // same hat. If those ever change, this follows by construction.
      const crown = box(0.66 * k, 0.22 * k, 0.66 * k, hex); crown.position.y = H + 0.07 * k; g.add(crown);
      const brim = box(0.66 * k, 0.1 * k, 0.3 * k, hex); brim.position.set(0, H - 0.02 * k, 0.42 * k); g.add(brim);
      if (band != null) { const bnd = box(0.68 * k, 0.07 * k, 0.68 * k, band); bnd.position.y = H - 0.01 * k; g.add(bnd); }
    } else if (type === "beret") {
      const crown = box(H * 1.02, H * 0.24, H * 1.02, hex); crown.position.y = H * 0.86; crown.rotation.z = 0.12; g.add(crown);
      const lip = box(H * 1.1, H * 0.09, H * 1.1, tone(hex, -0.25)); lip.position.y = H * 0.74; g.add(lip);
      if (band != null) { const flash = box(H * 0.2, H * 0.16, H * 0.06, band); flash.position.set(-H * 0.34, H * 0.88, H * 0.36); g.add(flash); }
    } else if (type === "helmet") {
      const dome = box(H * 1.14, H * 0.66, H * 1.14, hex); dome.position.y = H * 0.72; g.add(dome);
      const lip = box(H * 1.2, H * 0.1, H * 1.2, tone(hex, -0.3)); lip.position.y = H * 0.44; g.add(lip);
      if (band != null) { const flash = box(H * 0.24, H * 0.12, H * 0.06, band); flash.position.set(H * 0.32, H * 0.72, H * 0.58); g.add(flash); }
    }
    g.userData.wl = type + "|" + hex + "|" + band;
    host.add(g);
    ch._wlHead = g;
    // hair under a full wrap or a helmet is a mohawk poking through a hat
    const covers = (type === "shemagh" || type === "helmet" || type === "cap");
    paintSlot(ch.skinSlots && ch.skinSlots.hair, null, !covers);
    return g;
  }

  /* WEBBING. A belt band round the waist, on the rig's body, for anyone the
     record says is kitted. character.js builds one only when the rig was
     CONSTRUCTED with c.belt, and battle.js's rigs are not — so the same
     "the engine has no post-build seam" argument as the headwear, and the
     same shared geometry and material. */
  function webbing(ch, on, hex, pouches) {
    if (!ch || !THREE) return null;
    const chest = ch.skinSlots && ch.skinSlots.torso && ch.skinSlots.torso[0];
    if (!chest || !chest.add) return null;
    let b = ch._wlBelt;
    if (!on) { if (b) b.visible = false; return b; }
    /* SIZED AND PLACED OFF THE CHEST BOX ITSELF, exactly the way clothes.js
       sizes its jacket shell — read the mesh's own BoxGeometry parameters
       rather than typing an adult male's numbers, so this lands on the
       waistline of a smaller body too. It rides the chest mesh, so it
       animates with the torso for free and costs no update hook. */
    const par = (chest.geometry && chest.geometry.parameters) || {};
    const w = (par.width || 0.92) * 1.04;
    const d = (par.depth || 0.5) * 1.12;
    const y = -(par.height || 0.95) * 0.5 + 0.06;
    if (!b) {
      b = new THREE.Group();
      b.name = "warlord-webbing";
      b.add(box(w, 0.15, d, hex));
      /* POUCHES ONLY ON THE MEN WHO WOULD CARRY THEM. Three meshes per belt
         over three hundred men is nine hundred draw calls for a detail a
         levy has no business having anyway; a veteran gets the pouches and
         everyone else gets the band. Measured cost of the whole wardrobe is
         in the report. */
      if (pouches) {
        const pl = box(w * 0.22, 0.18, d * 0.36, tone(hex, -0.24)); pl.position.set(-w * 0.27, -0.02, d * 0.4); b.add(pl);
        const pr = box(w * 0.22, 0.18, d * 0.36, tone(hex, -0.24)); pr.position.set(w * 0.27, -0.02, d * 0.4); b.add(pr);
      }
      chest.add(b);
      ch._wlBelt = b;
    }
    b.position.y = y;
    b.visible = true;
    if (b.userData.hex !== hex && CBZ.cmat) {
      b.userData.hex = hex;
      for (let i = 0; i < b.children.length; i++) {
        b.children[i].material = CBZ.cmat(toLinear(i === 0 ? hex : tone(hex, -0.24)));
      }
    }
    return b;
  }

  /* ============================================================ apply
     Dress a built rig. Accepts a THREE.Group from studio.cast, the charRig
     itself, or an actor-shaped {char}. Returns true when something changed.

     ORDER MATTERS AND IT IS THE CITY'S ORDER: the painted atlas goes on
     FIRST and reports which regions it claimed, then everything it did not
     claim gets a flat colour, then the accessories. Doing the flat pass first
     would tint a mapped material and darken the garment. */
  function rigOf(x) {
    if (!x) return null;
    if (x.skinSlots) return x;
    if (x.userData && x.userData.charRig) return x.userData.charRig;
    if (x.char && x.char.skinSlots) return x.char;
    return null;
  }

  function paintRecord(rec) {
    // what clothes.js is handed. `id` is the PAINTER key, so a gang fit
    // becomes "gang:<name>" (the colour-keyed family) and a suit carries its
    // style index. forcePaint is the hoodie/basics escape from the city's
    // plain-civvie switch.
    if (!rec.paint) return null;
    const id = rec.gang ? ("gang:" + rec.gang) : rec.paint;
    const out = { id: id, colors: rec.colors };
    if (rec.style != null) out.style = rec.style;
    if (rec.force) out.forcePaint = 1;
    if (rec.gang) out.gang = rec.gang;
    return out;
  }

  function apply(target, fit, opts) {
    if (MODE === "off") return false;
    const ch = rigOf(target);
    if (!ch || !ch.skinSlots) return false;
    const rec = fit && fit.rec ? fit.rec : fit;
    if (!rec || !rec.colors) return false;
    const det = (fit && fit.det) || { accent: rec.accent != null ? rec.accent : 0xc4593a,
                                      rankHex: rec.accent != null ? rec.accent : 0xc4593a,
                                      boots: rec.colors.shoes, head: "none", wear: 0, rank: 0 };
    const s = ch.skinSlots;
    const wear = det.wear || 0;
    const c = rec.colors;
    const cam = !!rec.camo;
    const torso = readable(weathered(c.torso != null ? c.torso : 0x8a939c, wear), cam);
    const arms = readable(weathered(c.arms != null ? c.arms : c.torso, wear), cam);
    const legs = readable(weathered(c.legs != null ? c.legs : torso, wear), cam);
    const collar = c.collar != null ? weathered(c.collar, wear * 0.5) : torso;
    const shoes = det.boots != null ? det.boots : (c.shoes != null ? c.shoes : 0x2b241c);

    // ---- 1. the painted atlas, if the page has one and the fit names one
    let pp = null;
    if (MODE !== "flat" && CBZ.cityApplyClothes) {
      const pr = paintRecord(rec);
      try { pp = CBZ.cityApplyClothes(ch, pr, null); }
      catch (e) { pp = null; }
      if (pp) tagAtlasSRGB(pr, ch);
      // no painted look for this record → make sure a previous one is stripped
      if (!pp && ch._clothesKey != null) { try { CBZ.cityApplyClothes(ch, null); } catch (e) {} }
    }

    /* ---- 2. camo, for the flat records that ask for it. Three materials,
       one per part size, and the TINT is how a faction owns a shared
       pattern: camo.js multiplies it into the map, so the Legion's desert3
       and a looted bandit's desert3 are two ~200-byte materials over one
       texture rather than two textures. */
    const pat = (!pp && rec.camo) ? camoPattern(rec, det) : null;
    const tint = rec.camoTint == null ? 0xffffff : rec.camoTint;
    const cmT = pat ? camoMaterial(pat, "torso", tint) : null;
    const cmA = pat ? camoMaterial(pat, "arms", tint) : null;
    const cmL = pat ? camoMaterial(pat, "legs", tint) : null;

    // ---- 3. flat cloth for everything the atlas did not claim
    paintSlot(s.pelvis, legs);
    if (!pp || !pp.legs) {
      if (cmL) { paintCamo(s.legs, cmL); paintCamo(s.legsLower, cmL); }
      else { paintSlot(s.legs, legs); paintSlot(s.legsLower, legs); }
    }
    if (!pp || !pp.torso) { if (cmT) paintCamo(s.torso, cmT); else paintSlot(s.torso, torso); }
    if (!pp || !pp.arms) {
      if (cmA) { paintCamo(s.arms, cmA); paintCamo(s.armsLower, cmA); }
      else { paintSlot(s.arms, arms); paintSlot(s.armsLower, arms); }
    }
    /* THE YOKE IS THE ACCENT'S HOME ON A FLAT FIT and it is left alone on a
       painted one. city/outfits.js's own long note: skinSlots.collar is the
       shoulder yoke, a slab no painted garment reaches, and stamping a
       contrasting band round the neck of a painted uniform is the white
       neck-roll bug. So: painted → the garment's own cloth; flat → the
       record's collar, which is where every rank flash in this file lives. */
    if (!pp || !pp.collar) {
      let yoke = collar;
      if (pp && pp.torso && CBZ.cityPaintedBodyHex) {
        const painted = CBZ.cityPaintedBodyHex(paintRecord(rec), ch);
        if (painted != null) yoke = painted;
      }
      paintSlot(s.collar, yoke);
    }
    paintSlot(s.shoes, shoes);

    // ---- 4. the kit: webbing, badge, headwear
    const beltHex = c.belt != null ? c.belt : tone(legs, -0.35);
    webbing(ch, !!rec.belt, beltHex, det.rank >= 3);
    paintSlot(s.belt, beltHex, !!rec.belt);
    paintSlot(s.badge, det.rankHex != null ? det.rankHex : det.accent, !!rec.badge);
    /* THE HEAD CARRIES THE FLAG. A levy's accent is on a rag or nowhere; a
       veteran's is a band on a helmet AND the yoke under it. That is the
       whole 200 m tier read and it is two lines. */
    const headHex = headColour(rec, det);
    /* THE BAND GOES ON EVERY ISSUED HAT, not just a veteran's. It was
       rank>=2 in the first pass and the line-of-battle shot showed why that
       was wrong: the Legion and the Free Company carry their colour ONLY in
       the cloth, and their cloth is deliberately quiet, so two thirds of both
       armies had nothing on them that said whose they were. A cap band is
       one cached box on a man who already has a hat, and it is the highest-
       value pixel in this file — it sits at the top of the silhouette, which
       is the last part of a man with clean sky behind it at range. */
    headwear(ch, det.head, headHex, det.rank >= 1 ? (det.rankHex != null ? det.rankHex : det.accent) : null);

    relinearSkin(ch);
    ch._wlFit = rec.id;
    ch._wlRec = rec;
    ch._wlDet = det;
    return true;
  }

  /* The hat's own colour: a rag or a shemagh IS the accent (cloth you tied
     on); a cap, beret or helmet is issue kit in the uniform's darkest tone
     with the accent as a band, because an army that issues helmets does not
     issue them in the flag colour. */
  function headColour(rec, det) {
    /* A BERET IS A UNIT COLOUR. That is what a beret IS — no army on earth
       issues one in the same drab as the trousers — and the metric caught the
       consequence of not knowing it: the Free Company scored ZERO men flying
       their own colour on the head, because its whole ladder is caps and
       helmets in the uniform's own dark tone with a thin accent band. Half a
       professional army in a steel-blue beret is both more correct and the
       thing that makes the Company findable in the line-of-battle shot. */
    if (det.head === "rag" || det.head === "shemagh" || det.head === "beret" || det.headAccent) {
      // a levy's cloth is faded and second-hand; from raider up it is the
      // real colour, because by then somebody handed it to him on purpose
      return det.rank <= 0 ? mix(det.accent, DUST, 0.42) : det.accent;
    }
    const c = rec.colors;
    return tone(c.legs != null ? c.legs : (c.torso || 0x333333), -0.18);
  }

  /* ============================================================ dress/cast */
  function dress(target, soldier, band) {
    const rec = forSoldier(soldier, band);
    const det = detail(soldier, band, rec);
    apply(target, { rec: rec, det: det });
    return { rec: rec, det: det };
  }

  /* THE CALL battle.js MAKES. It replaces
       CBZ.studio.cast(CAST_OF[T.cq], { color: side.colour, variant: v })
     with
       W.outfits.cast(s, band, { variant: v, role: CAST_OF[T.cq] })
     and gets back the same THREE.Group with the same userData contract —
     charRig, role, hp, weapon — dressed. The role still comes from the
     caller because CASTING carries hp and a default weapon and those are
     battle.js's business, not the wardrobe's. */
  function cast(soldier, band, opts) {
    opts = opts || {};
    if (!CBZ.studio || !CBZ.studio.cast) return null;
    const role = opts.role || "civilian";
    const rec = forSoldier(soldier, band);
    const det = detail(soldier, band, rec);
    /* `color` is still passed, and it still matters: it is what the rig is
       BUILT with, so on the one frame before apply() runs — and on any page
       where this module was reverted with ?outfits=old — the man is at least
       the right side's colour rather than the casting table's olive. */
    const g = CBZ.studio.cast(role, {
      color: MODE === "off" ? (opts.color != null ? opts.color : det.accent) : (rec.colors.torso != null ? rec.colors.torso : det.accent),
      variant: opts.variant | 0,
      scale: opts.scale,
    });
    if (!g) return null;
    if (MODE !== "off") apply(g, { rec: rec, det: det });
    g.userData.warlordFit = rec.id;
    return g;
  }

  /* ============================================================ campaign
     THE COLUMN IS INSTANCED — two draw calls for every man on the island —
     so it gets colours, not rigs. Returns the two hexes campaign.js's
     InstancedMesh setColorAt wants, derived from the SAME record the battle
     will dress him in, so the man who rides beside you is the man who lines
     up on the sand. Its old TIER_COLOUR table is what this replaces. */
  function marks(soldier, band) {
    const rec = forSoldier(soldier, band);
    const det = detail(soldier, band, rec);
    const c = rec.colors;
    let body = readable(weathered(c.torso != null ? c.torso : 0x8a939c, det.wear), !!rec.camo);
    /* A CAMOUFLAGED MAN AT STRATEGIC ZOOM IS HIS PATTERN'S MEAN COLOUR — not
       the base colour the record happens to name, which for desert3 is a
       full step lighter than the tile actually averages. camo.js measures it;
       ask it rather than eyeballing a second number. */
    if (rec.camo && W.camo && W.camo.mean) {
      const pat = camoPattern(rec, det);
      try { if (pat) { const mn = W.camo.mean(pat); if (mn != null) body = mn; } } catch (e) {}
    }
    // the head instance is the HAT when he has one, and skin-ish when he does
    // not: at strategic zoom the head speck is the tier read.
    const head = det.head === "none" ? mix(0xc9a07a, DUST, 0.25) : headColour(rec, det);
    return { body: body, head: head, accent: det.accent, fit: rec.id, tier: det.rank };
  }

  /* ============================================================ wardrobe.js
     What the player's own picker needs to reuse this painter rather than
     grow a second one. `player(spec)` builds a record out of either a
     catalogue id, a suit style index, or explicit colours, and hands back
     something apply() eats. */
  function fitById(id) { index(); return BY_ID[id] || null; }
  function suits() {
    const t = CBZ.citySuitStyles;
    if (t && t.length) return t;
    // clothes.js absent: the four this file actually names, so wardrobe.js
    // still has a menu rather than an empty list.
    return [{ name: "Charcoal Suit" }, { name: "Navy Suit" }, { name: "Mid-Grey Suit" }, { name: "Black Suit" }];
  }
  function player(spec) {
    spec = spec || {};
    index();
    if (typeof spec === "string") spec = { fit: spec };
    let rec = spec.fit ? BY_ID[spec.fit] : null;
    if (!rec && spec.suit != null) {
      rec = { id: "player_suit_" + spec.suit, name: (suits()[spec.suit] || {}).name || "Suit",
              paint: "suit", style: spec.suit | 0, colors: C("suit"), belt: 0, badge: 0, f: "you", t: "veteran" };
    }
    if (!rec && spec.tuxedo) {
      rec = { id: "player_tux", name: "Midnight Tuxedo", paint: "tuxedo", colors: C("tuxedo"), f: "you", t: "veteran" };
    }
    if (!rec) rec = BY_ID.yo_own;
    if (spec.colors) { rec = Object.assign({}, rec, { colors: Object.assign({}, rec.colors, spec.colors) }); }
    const det = {
      accent: spec.accent != null ? spec.accent : YOUR_COLOUR,
      boots: spec.boots != null ? spec.boots : rec.colors.shoes,
      head: spec.head != null ? spec.head : "shemagh",
      wear: spec.wear != null ? spec.wear : 0.2,
      rank: 3,
    };
    return { rec: rec, det: det };
  }

  /* ============================================================ catalogue */
  function catalogue() {
    index();
    const out = [];
    for (let i = 0; i < FITS.length; i++) {
      const f = FITS[i];
      out.push({
        id: f.id, name: f.name, faction: f.f, tier: f.t,
        paint: f.gang ? ("gang:" + f.gang) : (f.paint || null),
        style: f.style == null ? null : f.style,
        camo: f.camo || null, belt: !!f.belt, badge: !!f.badge,
        colors: f.colors, accent: f.accent, note: f.note || "",
      });
    }
    return out;
  }

  /* audit() — the atlas-key rule from the top of the FITS table, checked
     rather than trusted, plus a count of what actually reached the page. */
  function audit() {
    index();
    const seen = {}, dup = [];
    for (let i = 0; i < FITS.length; i++) {
      const f = FITS[i];
      if (!f.paint || f.paint === "gang" || f.paint === "suit" ||
          f.paint === "basics" || f.paint === "hoodie") continue;   // colour-keyed families
      if (seen[f.paint]) dup.push(f.paint + " (" + seen[f.paint] + " / " + f.id + ")");
      seen[f.paint] = f.id;
    }
    const cells = {};
    for (const k in INDEX) cells[k] = INDEX[k].length;
    return {
      ok: dup.length === 0, fits: FITS.length, duplicatePainters: dup, cells: cells,
      painter: !!CBZ.cityApplyClothes,
      camo: !!(W.camo && typeof W.camo.material === "function"),
      camoStats: (W.camo && W.camo.stats) ? W.camo.stats() : null,
      mode: MODE,
    };
  }

  /* ============================================================ THE PAINTER
     ROUTE THE NAME. If a page ever loads the real city wardrobe this is a
     no-op and the city's own recolorRig keeps the job. If nothing has claimed
     the name — every slice page, this one included — publish ours, so
     anything in the engine that reaches for CBZ.cityRecolorRig (armor.js's
     lazy wrap, prisonoutfits.js's adapter, clothes.js's own plain-base
     fallback) finds a working answer instead of falling through. Same move
     games/warlord.html makes for queryCollidersNear / floorAt / collide. */
  function publishNames() {
    if (!CBZ.cityPaintSlot) CBZ.cityPaintSlot = paintSlot;
    if (!CBZ.cityRecolorRig) {
      CBZ.cityRecolorRig = function (ch, colors, rec) {
        if (!ch || !ch.skinSlots || !colors) return false;
        return apply(ch, { rec: { id: (rec && rec.id) || "adhoc", colors: colors,
                                  paint: rec && rec.id, style: rec && rec.style,
                                  belt: !!(rec && rec.belt), badge: !!(rec && (rec.badge || rec.cop)) },
                           det: { accent: colors.collar != null ? colors.collar : 0xffffff,
                                  boots: colors.shoes, head: (rec && (rec.cap || rec.cop)) ? "cap" : "none",
                                  wear: 0, rank: 0 } });
      };
    }
  }

  /* ============================================================ THE ATLAS
     One script tag, appended once, for the reason argued at the top of the
     file. Nothing is BUILT by loading it — clothes.js only declares — so this
     is cheap enough for boot, and everything downstream feature-detects
     CBZ.cityApplyClothes so a 404 costs the painted structure and nothing
     else. */
  let asked = false;
  function ensurePainter() {
    if (asked || MODE === "off" || MODE === "flat") return;
    asked = true;
    if (CBZ.cityApplyClothes) return;
    if (typeof document === "undefined" || !CBZ.studio || !CBZ.studio.root) return;
    /* clothes.js's default is PLAIN CIVILIANS: the street ids (basics /
       street / hoodie) and the gang sash all resolve to "no painted look" so
       a city crowd stays flat. This page has no crowd — it has five armies —
       and those two colour-keyed families are worth six atlases to us, so the
       switch goes off here. It is a CBZ.CONFIG flag, revertible from the URL
       as ?cfg_CITY_PLAIN_CIVVIES=1 like every other one. */
    CBZ.CONFIG = CBZ.CONFIG || {};
    if (CBZ.CONFIG.CITY_PLAIN_CIVVIES == null) CBZ.CONFIG.CITY_PLAIN_CIVVIES = false;
    const s = document.createElement("script");
    s.src = CBZ.studio.root + "city/clothes.js";
    s.async = false;
    s.onerror = function () { console.warn("[warlord/outfits] city/clothes.js absent — flat uniforms only"); };
    document.head.appendChild(s);
  }

  /* ============================================================ WHAT IS
     ACTUALLY ON THE BODY. The pictures are the deliverable, but a number that
     can be gated needs the colour a mesh is RENDERING, not the colour a
     record names — and three of the four paths here render something the
     record does not say. A clothes.js atlas leaves the material white and
     puts the colour in the canvas; a camo material leaves it at the tint and
     puts the colour in the map; only the flat path has its colour where you
     would look for it. So each path is asked in its own language. */
  function readHex(list, ch) {
    if (!list) return null;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (!m || !m.material) continue;
      const mat = m.material;
      if (mat.map) {
        const ud = mat.userData;
        if (ud && ud.camo && W.camo && W.camo.mean) {
          try { const mn = W.camo.mean(ud.camo); if (mn != null) return mn; } catch (e) {}
        }
        if (ch && ch._wlRec && CBZ.cityPaintedBodyHex) {
          try { const px = CBZ.cityPaintedBodyHex(paintRecord(ch._wlRec), ch); if (px != null) return px; }
          catch (e) {}
        }
        if (ch && ch._wlRec && ch._wlRec.colors && ch._wlRec.colors.torso != null) return ch._wlRec.colors.torso;
      }
      if (mat.color && mat.color.getHex) return fromLinear(mat.color.getHex());
    }
    return null;
  }
  function sample(target) {
    const ch = rigOf(target);
    if (!ch || !ch.skinSlots) return null;
    const s = ch.skinSlots;
    let head = null;
    const hw = ch._wlHead;
    if (hw && hw.visible && hw.children[0] && hw.children[0].material && hw.children[0].material.color) {
      head = fromLinear(hw.children[0].material.color.getHex());
    } else head = readHex(s.head, ch);
    return {
      fit: ch._wlFit || null,
      torso: readHex(s.torso, ch), legs: readHex(s.legs, ch),
      shoes: readHex(s.shoes, ch), head: head,
      hat: !!(hw && hw.visible), belt: !!(ch._wlBelt && ch._wlBelt.visible),
    };
  }

  /* ============================================================ THE GALLERY
     ?outfits=1 (for a person) or ?gallery=outfits (for the visual tool, which
     needs it to compose with ?outfits=old so the BEFORE side of an A/B has
     something to photograph). Three layouts, built one at a time into one
     root that is torn down between them — the whole island, the campaign, the
     battle and every sibling module stay out of it, which is the point:
     nothing here can be blocked by somebody else's wave.

       portrait  one faction, its four tiers left to right, close enough to
                 read a pocket flap. The "does a levy look like a veteran"
                 question, asked as a picture.
       census    one faction: every tier down the screen, every variant across
                 it. The whole catalogue, cell by cell.
       line      a line of battle at a stated range. The 200 m question. */
  let galleryRoot = null;
  function gallery(opts) {
    opts = opts || {};
    const ctx = CTX;
    if (!ctx || !THREE) return null;
    index();
    ensurePainter();
    const scene = ctx.scene || CBZ.scene;
    if (galleryRoot) { scene.remove(galleryRoot); galleryRoot = null; }
    const root = new THREE.Group();
    root.name = "warlordOutfitGallery";
    scene.add(root);
    galleryRoot = root;

    /* THE PAD IS THE ISLAND'S OWN SAND, and it is not decoration: a uniform
       is only as readable as the ground behind it. The number is desert.js's
       OWN linear albedo — the midpoint of its C_SAND_LO/C_SAND_HI dune ramp
       (desert.js:480) — and not the sRGB 0xd9b979 the first pass used, which
       rendered as literal white paper and would have passed any uniform in
       this file. A gallery whose ground is brighter than the game's ground is
       a gallery that cannot fail a colour. */
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(2200, 2200),
      new THREE.MeshLambertMaterial({ color: 0x6e5733 }));
    pad.rotation.x = -Math.PI / 2;
    pad.receiveShadow = true;
    root.add(pad);

    const layout = opts.layout || "portrait";
    const tiers = opts.tiers || ["levy", "raider", "soldier", "veteran"];
    const men = [];
    let uid = (opts.seed || 4000) | 0;
    function put(fid, tier, variantHint, x, z, yaw) {
      const band = fid === "you" ? null : { faction: fid, colour: accentOf(fid) };
      /* A SYNTHETIC MAN, BUILT BY core.js's OWN CONSTRUCTOR. The id is walked
         rather than random so a cell shows its variants instead of the same
         one three times, and so both sides of an A/B photograph the identical
         roster. */
      let s = null, tries = 0;
      const want = INDEX[fid + "|" + tier];
      do {
        s = W.makeSoldier ? W.makeSoldier(tier, "carbine", { id: uid++ }) : { id: uid++, tier: tier };
        if (variantHint == null || !want || !want.length) break;
        if (forSoldier(s, band) === want[variantHint % want.length]) break;
      } while (++tries < 64);
      const g = cast(s, band, { role: opts.role || "civilian", variant: (uid * 3) % 6 });
      if (!g) return null;
      g.position.set(x, 0, z);
      g.rotation.y = yaw == null ? 0 : yaw;
      root.add(g);
      const rec = forSoldier(s, band);
      men.push({ group: g, soldier: s, faction: fid, tier: tier, fit: rec.id, name: rec.name });
      return g;
    }

    if (layout === "portrait") {
      const fid = opts.faction || "bandit";
      const gap = opts.spacing || 1.75;
      for (let t = 0; t < tiers.length; t++) put(fid, tiers[t], opts.variant == null ? 0 : opts.variant, (t - (tiers.length - 1) / 2) * gap, 0, 0);
    } else if (layout === "census") {
      /* THE WHOLE CELL, in rows of six. The first census laid tiers down the
         Z axis and it photographed as four men and eight specks — the far
         rank was 17 m from a camera that had to hold the near one. Rows in X,
         one shallow step in Z, so every variant is inside 4 m of the same
         focal plane. */
      const fid = opts.faction || "bandit";
      const per = opts.perCell || 3;
      const cols = opts.cols || 4;
      const all = [];
      for (let t = 0; t < tiers.length; t++) {
        const list = INDEX[fid + "|" + tiers[t]] || [];
        const n = Math.min(per, Math.max(1, list.length));
        for (let v = 0; v < n; v++) all.push([tiers[t], v]);
      }
      const rows = Math.ceil(all.length / cols);
      for (let i = 0; i < all.length; i++) {
        const r = Math.floor(i / cols), c = i % cols;
        const inRow = Math.min(cols, all.length - r * cols);
        /* ALTERNATE ROWS ARE OFFSET HALF A STEP. The first census put the
           rows on the same X and the camera behind them, so the back rank
           stood exactly behind the front one and three of twelve records were
           invisible. Half a step sideways and 3.6 m of depth, and every man
           in the cell has clean sky or sand behind his own silhouette. */
        put(fid, all[i][0], all[i][1],
            (c - (inRow - 1) / 2) * 2.0 + (r % 2 ? 1.0 : 0),
            ((rows - 1) / 2 - r) * -3.6, 0);
      }
    } else if (layout === "line") {
      /* A LINE OF BATTLE, not a rank of mannequins: the tier mix is the one
         W.FACTIONS declares for that faction, so what you are looking at is
         the composition the campaign would actually field. */
      const facs = opts.factions || ["bandit", "militia", "company", "legion", "warlord"];
      const per = opts.perFaction || 5;
      let x = -((facs.length * per - 1) / 2) * 1.15;
      for (let f = 0; f < facs.length; f++) {
        const F = W.faction ? W.faction(facs[f]) : null;
        const mix = (F && F.tiers) || ["levy", "raider", "soldier"];
        for (let i = 0; i < per; i++) {
          const tier = mix[i % mix.length];
          const zj = ((i % 3) - 1) * 0.9;                 // two ragged ranks, not a parade
          put(facs[f], tier, null, x, zj, 0);
          x += 1.15;
        }
        x += 2.2;                                        // a gap between armies
      }
    }

    /* EVERY MAN IS POSED ONCE AND FROZEN. A gallery photographed mid-gait
       compares two different poses side by side and every difference reads as
       a costume change. animChar at t=0 puts the whole cast in one stance. */
    for (let i = 0; i < men.length; i++) {
      const ch = rigOf(men[i].group);
      if (ch && CBZ.animChar) { try { CBZ.animChar(ch, 0, 1 / 60); } catch (e) {} }
    }
    /* THE GALLERY DOES NOT RAISE A SKY, and that is a correction, not an
       omission. It used to call micro.sky() to get the battle's haze — and
       micro.sky() UNCONDITIONALLY ADDS A DOME (microboot.js:221), which is
       precisely the fault the page itself was just fixed for: boot() already
       raises one, so calling sky() again nests a second inside it. Two agents
       hand-darkened their palettes around that before anybody found it. A
       debug scaffold has no business re-opening it.

       What the range shots actually need is the BATTLE's fog distances rather
       than the campaign's, and that is two numbers written into the fog the
       page already owns. (Finding, while we are here: battle.js's fog is
       420-2900, so at 200 m there is no haze in this game at all — range is
       purely angular size, and the preset says so.) */
    if (scene.fog && layout === "line") { scene.fog.near = 420; scene.fog.far = 2900; }

    /* NOTHING ELSE IN THE SCENE. A stray prop left over from another
       module's boot photographs as a green cylinder in the middle of a
       uniform census, and on an A/B it is indistinguishable from a change.
       The sky, the lights and this root; everything else is hidden for the
       life of the gallery and never removed, so a page that leaves the
       gallery still has its world. */
    if (scene && scene.children) {
      for (let i = 0; i < scene.children.length; i++) {
        const c = scene.children[i];
        if (c === root || c.isLight || c === CBZ.skyDome) continue;
        if (c.name && /sky|fog|light/i.test(c.name)) continue;
        if (c.children && c.children.length && c.children[0] && c.children[0].isLight) continue;
        if (c.userData && c.userData.sky) continue;
        if (c.type === "Group" && c.children.some(function (k) { return k.isLight || (k.name && /sky/i.test(k.name)); })) continue;
        if (c.geometry && c.geometry.type === "SphereGeometry") continue;   // the sky dome
        c.visible = false;
      }
      root.visible = true;
    }
    G.__warlordOutfitGallery = { root: root, men: men, layout: layout, api: API };
    return G.__warlordOutfitGallery;
  }

  /* ============================================================ API */
  const API = {
    forSoldier: forSoldier,
    detail: detail,
    apply: apply,
    dress: dress,
    cast: cast,
    marks: marks,
    catalogue: catalogue,
    fit: fitById,
    suits: suits,
    player: player,
    audit: audit,
    gallery: gallery,
    sample: sample,
    paintSlot: paintSlot,
    headwear: headwear,
    readable: readable,
    weathered: weathered,
    mode: function () { return MODE; },
    needs: [],
    boot: function (ctx) {
      CTX = ctx;
      THREE = ctx.THREE || G.THREE;
      const Q = ctx.Q;
      const q = Q && Q.get("outfits");
      MODE = q === "old" ? "off" : (q === "flat" ? "flat" : "on");
      CBZ.CONFIG = CBZ.CONFIG || {};
      if (q === "srgb" || CBZ.CONFIG.WARLORD_OUTFIT_LINEAR === false) LINEAR = false;
      /* THE GALLERY RUNS IN EVERY MODE, INCLUDING THE REVERT, and that is not
         a detail — it is the only way the before/after tool can photograph
         this wave honestly. `?outfits=old` turns the uniforms off; if it also
         turned the gallery off there would be nothing on the BEFORE side to
         compare against, and the A/B would quietly become a picture of the
         new code beside a blank page. So the tool asks for the scaffold with
         its own switch (?gallery=outfits) and the revert flag composes with
         it: the before side is this same pad, this same roster, in the flat
         team tint battle.js used to hand out. */
      const wantGallery = q === "1" || q === "gallery" || (Q && Q.get("gallery") === "outfits");
      if (MODE !== "off") { publishNames(); ensurePainter(); }
      if (!wantGallery) { G.__warlordOutfitsReady = true; return; }
      /* Wait on the NAME rather than on a number of milliseconds — the atlas
         script was requested one line ago and a fixed delay is the bug that
         makes a tool flaky on a loaded box. In the reverted mode there is no
         atlas to wait for, so it goes straight through. */
      let tries = 0;
      const go = function () {
        if (MODE !== "off" && !CBZ.cityApplyClothes && tries++ < 160) { setTimeout(go, 25); return; }
        if (ctx.closeScreen) ctx.closeScreen();
        if (W.setPhase) W.setPhase("menu");
        const hud = ctx.el && ctx.el("hud"); if (hud) hud.classList.remove("on");
        gallery({ layout: "portrait", faction: "bandit" });
        if (CBZ.camera) { CBZ.camera.position.set(0, 1.5, 5.6); CBZ.camera.lookAt(0, 1.0, 0); }
        G.__warlordOutfitsReady = true;
      };
      setTimeout(go, 20);
    },
  };

  W.module("outfits", API);
})();
