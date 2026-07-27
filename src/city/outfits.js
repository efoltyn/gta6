/* ============================================================
   city/outfits.js — THE WARDROBE: clothing stops being random color
   noise and becomes IDENTITY, STATUS and DISGUISE.

   WHY (make money + show off):
     • STATUS — the tuxedo is the apex drip purchase: thousands of
       dollars worn on your back, and the Velvet's rope opens for the
       cloth alone (drip clears CLUB_DRIP by itself).
     • IDENTITY — every named outfit says WHO wears it (vendor apron,
       dock hi-vis, gang colors, the badge), so the same casting truth
       can dress the whole street: CBZ.cityOutfitFor(spec) is the
       casting hook peds.js adopts with a one-liner.
     • DISGUISE — clothes are the AFFILIATION axis (the [T] mask is the
       ID axis; they compose): a police uniform makes beat cops read
       you as one of theirs at low heat (until one gets close enough to
       clock your face); a crew's colors make their corners read you as
       kin — and their rivals read you as THEM.

   THE LOOK API: a rig built by entities/character.js exposes
   skinSlots (lists of meshes per cloth region). We recolor with the
   clone-on-write paint pattern from entities/player.js — cmat-cached
   materials are cloned before the first tint so a recolor NEVER bleeds
   onto every NPC sharing that cached color.

   STATE (all on CBZ.game, owned here):
     g.cityWornOutfit  — the worn outfit RECORD {id,name,colors,drip,cop,gang}
     g.cityOutfitId    — its id (cheap read for other systems)
     g.cityOutfitsOwned— {id:true} fits you own (re-wear free at the boutique)
     g.cityOutfitBlownT— ms timestamp until which the cop uniform is BLOWN
     g.cityOutfitChanging — seconds left in the corpse-swap change (exposed beat)

   NOTE: g.cityOutfit (no suffix) is economy.js's SLOT→item map for
   wearable PIECES (chains/watches) — a different, composable axis.
   This module's whole-body color fit adds its drip into the same
   CBZ.cityPlayerDrip read via a lazy idempotent wrap (bling.js pattern).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  // ============================================================
  //  THE CATALOG — every named fit: a color set + drip + WHO wears it.
  //  price = sold at the boutique fitting room (a status purchase);
  //  cop/gang flags = what the street READS off the cloth.
  // ============================================================
  const CAT = {
    // ---- street basics (the floor — what a nobody wears) ----
    street:    { id: "street",    name: "Street Basics",    tier: "street", who: "everybody",        price: 60,   drip: 0,
                 colors: { legs: 0x39414f, torso: 0x8a939c, collar: 0x6d7682, arms: 0x8a939c, shoes: 0x2b2b2b } },
    hoodie:    { id: "hoodie",    name: "Goon Hoodie",      tier: "street", who: "corner kids",      price: 120,  drip: 2,
                 colors: { legs: 0x23262e, torso: 0x3a3f4a, collar: 0x2a2e36, arms: 0x3a3f4a, shoes: 0x191b20 } },
    tracksuit: { id: "tracksuit", name: "Corner Tracksuit", tier: "street", who: "hustlers",         price: 180,  drip: 3,
                 colors: { legs: 0x20242c, torso: 0x2bb673, collar: 0xeef3f7, arms: 0x2bb673, shoes: 0xf2f2f2 } },
    // ---- NEW STREETWEAR (painted ids in clothes.js; feature-detected — a
    //      missing painter falls back to the flat colors below, never a crash) ----
    // The tank keeps the arms bare, but the structural collar stays fabric.
    // Painting that wide collar box skin-coloured made it read as a rigid slab
    // wrapped around the character's neck (especially in the portrait card).
    // The atlas owns the small neckline cutout; only the actual arms use skin.
    wifebeater: { id: "wifebeater", name: "Ribbed Tank",   tier: "street", who: "corner regulars",   price: 8,    drip: 1,
                 colors: { legs: 0x35383f, torso: 0xe6e3d9, collar: 0xe6e3d9, arms: 0xcf9a72, shoes: 0x2b2b2b } },
    puffer:    { id: "puffer",    name: "Block Puffer",     tier: "street", who: "corner crews",     price: 220,  drip: 4,
                 colors: { legs: 0x20242c, torso: 0x1d1f26, collar: 0x14161b, arms: 0x1d1f26, shoes: 0x101216 } },
    denim_jacket: { id: "denim_jacket", name: "Denim Jacket", tier: "street", who: "the block",      price: 160,  drip: 3,
                 colors: { legs: 0x2c3340, torso: 0x3a536e, collar: 0x2c4156, arms: 0x3a536e, shoes: 0x2b2b2b } },
    varsity:   { id: "varsity",   name: "Varsity Jacket",   tier: "street", who: "young money",      price: 280,  drip: 5,
                 colors: { legs: 0x23262e, torso: 0x6e1f2b, collar: 0xe9eaec, arms: 0x1d1f26, shoes: 0xe9eaec } },
    // ---- NEW WORK UNIFORMS (jobFit casts these; painted in clothes.js when
    //      present, else flat fallback) ----
    chef:      { id: "chef",      name: "Chef Whites",      tier: "work",   who: "line cooks",       price: 0,    drip: 0,
                 colors: { legs: 0x2b2f36, torso: 0xf0ead8, collar: 0xe2dcc8, arms: 0xf0ead8, shoes: 0xd8d8d8 } },
    waiter:    { id: "waiter",    name: "Waiter Blacks",    tier: "work",   who: "wait staff",       price: 0,    drip: 1,
                 colors: { legs: 0x141519, torso: 0x16171c, collar: 0xe9eaec, arms: 0x16171c, shoes: 0x101216 } },
    mailman:   { id: "mailman",   name: "Mail Carrier Blues", tier: "work", who: "mail carriers",    price: 0,    drip: 0,
                 colors: { legs: 0x2f4a6b, torso: 0x3a6a96, collar: 0x274056, arms: 0x3a6a96, shoes: 0x2b241c } },
    pilot:     { id: "pilot",     name: "Captain's Stripes", tier: "work",  who: "pilots",           price: 0,    drip: 2,
                 colors: { legs: 0x141826, torso: 0x16203a, collar: 0xe9eaec, arms: 0x16203a, shoes: 0x101216 } },
    janitor:   { id: "janitor",   name: "Custodian Greys",  tier: "work",   who: "custodians",       price: 0,    drip: 0,
                 colors: { legs: 0x3a3f46, torso: 0x4a5560, collar: 0x363b42, arms: 0x4a5560, shoes: 0x2b2b2b } },
    valet:     { id: "valet",     name: "Valet Vest",       tier: "work",   who: "valets",           price: 0,    drip: 1,
                 colors: { legs: 0x16171c, torso: 0x8a1f24, collar: 0xe9eaec, arms: 0x16171c, shoes: 0x101216 } },
    busdriver: { id: "busdriver", name: "Transit Uniform",  tier: "work",   who: "bus drivers",      price: 0,    drip: 0,
                 colors: { legs: 0x24304a, torso: 0x2f5a6b, collar: 0x1c3a44, arms: 0x2f5a6b, shoes: 0x101216 } },
    coveralls: { id: "coveralls", name: "Work Coveralls",   tier: "work",   who: "grease monkeys",   price: 0,    drip: 0,
                 colors: { legs: 0x3a4150, torso: 0x3a4150, collar: 0x2a2f3a, arms: 0x3a4150, shoes: 0x2b241c } },
    // ---- NIGHTLIFE / DRESSES (sprinkled onto a fraction of civilians near the
    //      club; painted dress/sundress in clothes.js when present) ----
    dress:     { id: "dress",     name: "Evening Dress",    tier: "fit",    who: "the night crowd",  price: 640,  drip: 8,
                 colors: { legs: 0x16171c, torso: 0x6e1f2b, collar: 0x4a141d, arms: 0x6e1f2b, shoes: 0x16171c } },
    sundress:  { id: "sundress",  name: "Summer Dress",     tier: "fit",    who: "day strollers",    price: 240,  drip: 4,
                 colors: { legs: 0xe9d8c8, torso: 0xd98aa6, collar: 0xe2b2c2, arms: 0xd98aa6, shoes: 0xf2f2f2 } },
    // The everyday womenswear the rack never had: before this row the ONLY
    // female-read garments in the whole catalog were two dresses, so a woman
    // who wasn't dressed for a party had nothing but a man's shirt. The
    // painter (clothes.js PAINT.blouse) darts to the waist BOX the rig now
    // actually has — cloth reinforcing the body, not faking it.
    // price 0 ON PURPOSE: shops.js's boutique rack is the NINE CHEAPEST priced
    // fits, so a $90 blouse would silently push the Leather Jacket off a rack
    // I don't own. The player buys blouses as composables (clothes.js ships
    // blouse_white/blush/navy/olive) once economy.js racks them — see report.
    blouse:    { id: "blouse",    name: "Blouse",           tier: "fit",    who: "the everyday",     price: 0,    drip: 2,
                 colors: { legs: 0x39414f, torso: 0xeceef0, collar: 0xeceef0, arms: 0xeceef0, shoes: 0x2b2b2b } },
    // ---- CHILDREN — never sold, never cast on an adult. The age gate in
    //      cityOutfitFor routes every non-adult band here BEFORE the cop /
    //      gang / job / archetype ladder can put a badge, a hi-vis vest,
    //      crew colors or a tailored suit on a four-year-old. These rows are
    //      TEMPLATES: kidFit clones each one with a per-body palette, so a
    //      playground isn't six identical children. ----
    onesie:    { id: "onesie",    name: "Babygrow",         tier: "kid",    who: "babies",           price: 0,    drip: 0, kid: 1,
                 colors: { legs: 0xbfd8e8, torso: 0xbfd8e8, collar: 0x8aa8c8, arms: 0xbfd8e8, shoes: 0xbfd8e8 } },
    pyjamas:   { id: "pyjamas",   name: "Stripey Pyjamas",  tier: "kid",    who: "the very young",   price: 0,    drip: 0, kid: 1,
                 colors: { legs: 0xe8e2f0, torso: 0xe8e2f0, collar: 0x6a7ac0, arms: 0xe8e2f0, shoes: 0xe8e4dc } },
    romper:    { id: "romper",    name: "Dungaree Romper",  tier: "kid",    who: "toddlers",         price: 0,    drip: 0, kid: 1,
                 colors: { legs: 0x4a6a92, torso: 0x4a6a92, collar: 0xf0e9dc, arms: 0xf0e9dc, shoes: 0xd84a4a } },
    kidtee:    { id: "kidtee",    name: "Tee & Shorts",     tier: "kid",    who: "kids",             price: 0,    drip: 0, kid: 1,
                 colors: { legs: 0x39414f, torso: 0x4aa8d8, collar: 0xf2c53d, arms: 0x4aa8d8, shoes: 0xe8e8e8 } },
    kidhoodie: { id: "kidhoodie", name: "Kid's Hoodie",     tier: "kid",    who: "kids",             price: 0,    drip: 0, kid: 1,
                 colors: { legs: 0x39414f, torso: 0x3a8fd0, collar: 0x2f6ea8, arms: 0x3a8fd0, shoes: 0x2b2b2b } },
    school:    { id: "school",    name: "School Uniform",   tier: "kid",    who: "schoolkids",       price: 0,    drip: 0, kid: 1,
                 colors: { legs: 0x23283a, torso: 0x2b3a5a, collar: 0xeceee8, arms: 0x2b3a5a, shoes: 0x1c1c20 } },
    schoolgirl:{ id: "schoolgirl", name: "School Uniform",  tier: "kid",    who: "schoolkids",       price: 0,    drip: 0, kid: 1,
                 colors: { legs: 0x23283a, torso: 0x2b3a5a, collar: 0xeceee8, arms: 0x2b3a5a, shoes: 0x1c1c20 } },
    pinafore:  { id: "pinafore",  name: "Pinafore Dress",   tier: "kid",    who: "little girls",     price: 0,    drip: 0, kid: 1,
                 colors: { legs: 0xe2a2b8, torso: 0xe2a2b8, collar: 0xf4efe4, arms: 0xf4efe4, shoes: 0xf2f2f2 } },
    // ---- work uniforms (a JOB on your back — casting wears these) ----
    vendor:    { id: "vendor",    name: "Vendor Apron",     tier: "work",   who: "counter clerks",   price: 0,    drip: 0,
                 colors: { legs: 0x2e3138, torso: 0xc8553a, collar: 0xf0ead8, arms: 0xf0ead8, shoes: 0x2b2b2b } },
    hivis:     { id: "hivis",     name: "Dock Hi-Vis",      tier: "work",   who: "dock crews",       price: 0,    drip: 0,
                 colors: { legs: 0x2f4f8a, torso: 0xffb43a, collar: 0xfff06b, arms: 0xffb43a, shoes: 0x4a3a26 } },
    // ---- uniforms everybody KNOWS ON SIGHT (price 0 — never racked; the
    //      casting sprinkles them through the crowd so the street reads like
    //      a working city, not a costume party). Each is the real-world
    //      color grammar: safety orange over jeans, teal scrubs, navy EMS
    //      with the reflective band at the collar, tan turnout with the
    //      yellow trim, county khaki-over-brown. sheriff carries NO cop
    //      flag on purpose: the trust/impersonation machinery stays city
    //      PD's — khaki off a corpse is a look, not a skeleton key. ----
    construction: { id: "construction", name: "Site Hi-Vis", tier: "work",  who: "construction crews", price: 0, drip: 0,
                 colors: { legs: 0x2e4a6b, torso: 0xe8821a, collar: 0xfff06b, arms: 0x8a939c, shoes: 0x4a3a26 } },
    scrubs:    { id: "scrubs",    name: "Hospital Scrubs",  tier: "work",   who: "nurses",           price: 0,    drip: 0,
                 colors: { legs: 0x3d8a86, torso: 0x3d8a86, collar: 0x2e6b68, arms: 0x3d8a86, shoes: 0xd8d8d8 } },
    doctor:    { id: "doctor",    name: "White Coat",       tier: "work",   who: "doctors",          price: 0,    drip: 1,
                 colors: { legs: 0x39414f, torso: 0xe9e9e9, collar: 0x9ab8d0, arms: 0xe9e9e9, shoes: 0x2b2b2b } },
    ems:       { id: "ems",       name: "Paramedic Blues",  tier: "work",   who: "EMS crews",        price: 0,    drip: 0,
                 colors: { legs: 0x24304a, torso: 0x24304a, collar: 0xc6d435, arms: 0x24304a, shoes: 0x101216 } },
    firefighter: { id: "firefighter", name: "Turnout Gear", tier: "work",   who: "firefighters",     price: 0,    drip: 0,
                 colors: { legs: 0xb09a6e, torso: 0xb09a6e, collar: 0xe8d44a, arms: 0xb09a6e, shoes: 0x16110d } },
    security:  { id: "security",  name: "Guard Blacks",     tier: "work",   who: "security guards",  price: 0,    drip: 0,
                 colors: { legs: 0x1c1f26, torso: 0x1c1f26, collar: 0xe8e8e8, arms: 0x1c1f26, shoes: 0x101216 } },
    sheriff:   { id: "sheriff",   name: "Sheriff Khakis",   tier: "law",    who: "county deputies",  price: 0,    drip: 0,
                 colors: { legs: 0x5a4632, torso: 0xb8a070, collar: 0x7a6a4a, arms: 0xb8a070, shoes: 0x2b241c, belt: 0x1a140c } },
    soldier:   { id: "soldier",   name: "Olive Fatigues",   tier: "work",   who: "soldiers",         price: 0,    drip: 0,
                 colors: { legs: 0x4a5238, torso: 0x4a5238, collar: 0x3a4030, arms: 0x4a5238, shoes: 0x2b2a22 } },
    office:    { id: "office",    name: "Office Slacks",    tier: "work",   who: "accountants",      price: 0,    drip: 1,
                 colors: { legs: 0x39414f, torso: 0x9ab4c8, collar: 0x7d97ab, arms: 0x9ab4c8, shoes: 0x23262b } },
    // ---- the LAW (never sold — taken off a body; the street reads the badge) ----
    police:    { id: "police",    name: "Police Uniform",   tier: "law",    who: "beat cops",        price: 0,    drip: 1, cop: true,
                 colors: { legs: 0x1b2a44, torso: 0x24407a, collar: 0x16264a, arms: 0x24407a, shoes: 0x101216, belt: 0x0d111c } },
    // SWAT redesign: dark-olive carrier over graphite-olive fatigues (torso
    // drives the CARRIER, legs the fatigues — clothes.js PAINT.swat reads both).
    swat:      { id: "swat",      name: "SWAT Fatigues",    tier: "law",    who: "heavy units",      price: 0,    drip: 1, cop: true,
                 colors: { legs: 0x2e332b, torso: 0x3a4034, collar: 0x22261f, arms: 0x33382e, shoes: 0x101216, belt: 0x0d111c } },
    // ---- money fits (boutique racks → the apex tuxedo) ----
    leather:   { id: "leather",   name: "Leather Jacket",   tier: "fit",    who: "the night crowd",  price: 520,  drip: 6,
                 colors: { legs: 0x23262e, torso: 0x241c18, collar: 0x100c0a, arms: 0x241c18, shoes: 0x16110d } },
    tactical:  { id: "tactical",  name: "All Black Tactical", tier: "fit",  who: "professionals",    price: 700,  drip: 7,
                 colors: { legs: 0x121418, torso: 0x121418, collar: 0x0b0c0f, arms: 0x121418, shoes: 0x0b0c0f } },
    // formal: "suit"/"tux" — bling.js attaches the FORMAL KIT for the read:
    // suit = a modest white shirt-front sliver on a navy/charcoal body;
    // tux = the full black-tie set (white shirt-front panel + bow-tie +
    // pocket square). colors.gloss puts a patent-leather sheen on the shoes.
    suit:      { id: "suit",      name: "Two-Piece Suit",   tier: "money",  who: "made men",         price: 1200, drip: 9, formal: "suit",
                 colors: { legs: 0x14161c, torso: 0x1c2030, collar: 0x2a3047, arms: 0x1c2030, shoes: 0x0c0d10 } },
    designer:  { id: "designer",  name: "Designer Drip",    tier: "money",  who: "ballers",          price: 1600, drip: 12,
                 colors: { legs: 0xe9e4da, torso: 0x7a3df0, collar: 0xffd451, arms: 0x7a3df0, shoes: 0xffffff } },
    // THE APEX: priced like a car, and the rope opens for the cloth alone
    // (drip 28 + BASE_DRIP 4 = 32 ≥ CLUB_DRIP 30 — the tuxedo IS entry).
    // True-black jacket, CHARCOAL-SATIN collar (lapel read, not a priest's
    // band), gloss shoes; the white lives in the SHIRT-FRONT panel + square
    // (formal kit meshes), never the collar — that was the priest look.
    tuxedo:    { id: "tuxedo",    name: "Midnight Tuxedo",  tier: "apex",   who: "old money",        price: 7500, drip: 28, formal: "tux",
                 colors: { legs: 0x0a0b0e, torso: 0x0a0b0e, collar: 0x24262e, arms: 0x0a0b0e, shoes: 0x08090c, gloss: true } },
  };

  // per-gang colors, generated off the live config so every crew's flag exists
  // exactly once (id: "gang:<gangId>"). Built lazily — config may load later.
  let _gangBuilt = false;
  function buildGangOutfits() {
    if (_gangBuilt) return;
    const defs = (CBZ.CITY && CBZ.CITY.gangs) || [];
    if (!defs.length) return;
    for (const d of defs) {
      const id = "gang:" + d.id;
      if (CAT[id]) continue;
      CAT[id] = {
        id, name: (d.name || d.id) + " Colors", tier: "gang", who: d.name || d.id,
        price: 0, drip: 2, gang: d.id,
        colors: { legs: 0x23262c, torso: d.color != null ? d.color : 0xb079ea, collar: d.accent != null ? d.accent : 0x141820, arms: d.color != null ? d.color : 0xb079ea, shoes: 0x191b20 },
      };
    }
    _gangBuilt = true;
  }

  // ---- worn state ------------------------------------------------------------
  function ownedMap() { if (!g.cityOutfitsOwned) g.cityOutfitsOwned = { street: true }; return g.cityOutfitsOwned; }
  function worn() {
    if (!g.cityWornOutfit) {
      g.cityWornOutfit = CAT.street; g.cityOutfitId = "street"; ownedMap().street = true;
    }
    return g.cityWornOutfit;
  }
  function wornDrip() { const w = g.cityWornOutfit; return (w && w.drip) || 0; }

  // ============================================================
  //  PLAIN-CIVVIE switch + COMPOSITE wiring (clothes.js contract [A]/[B]).
  //  When CBZ.CONFIG.CITY_PLAIN_CIVVIES is on (default — undefined reads ON),
  //  ordinary people render PLAIN: a solid shirt color over blue-jean legs and
  //  shoes, NO painted canvas. ROLE templates (cops/medics/trades/soldiers),
  //  the apex tuxedo, gang colors (solid + bandana mesh) and the business
  //  composite (blazer+shirt+tie) are the deliberate exceptions.
  // ============================================================
  function plainCivvies() {
    const C = CBZ.CONFIG;
    return !C || C.CITY_PLAIN_CIVVIES == null || !!C.CITY_PLAIN_CIVVIES;
  }
  const JEAN = 0x39414f;                              // the default blue-jean leg color
  // a realistic everyday SHIRT palette (websearch: the everyday spread is black/
  // white/heather grey/blues/olive — staples, not costume brights). Used to give
  // plain civilians varied-but-believable shirts without any painted atlas.
  const CIV_SHIRTS = [
    0x202327, 0x2b2f36, 0x3a3f4a,                     // black / charcoal / slate
    0xe9eaec, 0xd6d8db, 0xbfc3c8,                     // white / off-white / light grey
    0x8a939c, 0x6d7682,                               // heather greys
    0x2f4a6b, 0x39557d, 0x4a6a96,                     // navy / blue / mid-blue
    0x3f5a3a, 0x556b3c, 0x6e7a4a,                     // forest / olive / khaki-green
    0x7a3b3b, 0x9c5a3c, 0x5a4a6b,                     // muted brick / rust / dusty purple
  ];
  // a per-spec deterministic-ish shirt pick (uses the rng when given, else the
  // body's existing outfit hex, else a mid grey) — variety without RNG churn.
  function civShirtFor(spec) {
    if (spec && spec.outfit != null) return spec.outfit;       // caster-chosen / spawn tee wins
    const rng = spec && spec.rng;
    if (typeof rng === "function") return CIV_SHIRTS[(rng() * CIV_SHIRTS.length) | 0];
    return 0x8a939c;
  }

  // ---- BUSINESS COMPOSITE: a composed blazer + collared shirt + tie (NOT a
  //      painted suit). Websearch-grounded pairings: navy blazer / white or
  //      light-blue shirt / burgundy tie; charcoal blazer / light-blue shirt /
  //      burgundy or navy tie. The visualIds match clothes.js's COMP table.
  const BIZ_COMPOSITES = [
    { blazer: "blazer_navy",     shirt: "shirt_white_collar",    tie: "tie_burgundy", shirtHex: 0xf2f2f2 },
    { blazer: "blazer_charcoal", shirt: "shirt_white_collar",    tie: "tie_navy",     shirtHex: 0xe9eaec },
    { blazer: "blazer_charcoal", shirt: "shirt_navy_collar",     tie: "tie_burgundy", shirtHex: 0x1c2030 },
    { blazer: "blazer_navy",     shirt: "shirt_charcoal_collar", tie: "tie_silver",   shirtHex: 0x2a2d34 },
    { blazer: "blazer_burgundy", shirt: "shirt_white_collar",    tie: "tie_navy",     shirtHex: 0xf2f2f2 },
    { blazer: "blazer_navy",     shirt: "shirt_white_collar",    tie: "tie_silver",   shirtHex: 0xf2f2f2 },
    { blazer: "blazer_charcoal", shirt: "shirt_white_collar",    tie: "tie_red",      shirtHex: 0xe9eaec },
    { blazer: "blazer_charcoal", shirt: "shirt_charcoal_collar", tie: "tie_burgundy", shirtHex: 0x2a2d34 },
    { blazer: "blazer_navy",     shirt: "shirt_navy_collar",     tie: "tie_royal",    shirtHex: 0x1c2030 },
    { blazer: "blazer_forest",   shirt: "shirt_white_collar",    tie: "tie_forest",   shirtHex: 0xf2f2f2 },
    { blazer: "blazer_burgundy", shirt: "shirt_charcoal_collar", tie: "tie_silver",   shirtHex: 0x2a2d34 },
    { blazer: "blazer_black",    shirt: "shirt_white_collar",    tie: "tie_charcoal", shirtHex: 0xf2f2f2 },
    { blazer: "blazer_navy",     shirt: "shirt_royal_collar",    tie: "tie_navy",     shirtHex: 0x274690 },
    { blazer: "blazer_charcoal", shirt: "shirt_burgundy_collar", tie: "tie_pink",     shirtHex: 0x6e1f2b },
  ];
  // build a business RECORD that carries a composite item list. recolorRig
  // honors rec.composite via CBZ.cityApplyComposite, so the body wears a real
  // composed blazer/shirt/tie instead of the old painted `suit`. We keep the
  // suit's drip/formal flags so the club rope + perception reads are unchanged.
  function bizRecord(spec) {
    const idx = pickBizIdx(spec);
    const c = BIZ_COMPOSITES[idx];
    const base = CAT.suit;
    return {
      id: "biz:" + idx, name: "Business Suit", tier: "money", who: "professionals",
      price: 0, drip: base.drip, formal: "suit",
      colors: { legs: JEAN, torso: c.shirtHex, collar: c.shirtHex, arms: c.shirtHex, shoes: 0x14161c },
      // feature-detect every composable id: a clothes.js that doesn't ship a
      // given blazer/shirt/tie just drops it from the list (cityApplyComposite
      // ignores unknown ids anyway, but a clean list keeps the drip honest).
      composite: { shirt: c.shirtHex, legs: JEAN, items: compFilter([c.blazer, c.shirt, c.tie]) },
    };
  }
  // keep only composable ids clothes.js actually knows (graceful when the
  // sibling clothes.js wave hasn't landed a particular garment yet).
  function compFilter(ids) {
    if (!CBZ.cityComposableSpec) return ids.slice();   // can't check → trust the list
    const out = [];
    for (let i = 0; i < ids.length; i++) if (CBZ.cityComposableSpec(ids[i])) out.push(ids[i]);
    return out;
  }
  function pickBizIdx(spec) {
    const rng = spec && spec.rng;
    if (typeof rng === "function") return (rng() * BIZ_COMPOSITES.length) | 0;
    // stable-ish fallback so the same body keeps one look across re-dresses
    const seed = (spec && (spec.seed | 0)) || 0;
    return Math.abs(seed) % BIZ_COMPOSITES.length;
  }

  // ============================================================
  //  PAINTED SUITS — the "suit|N" look (SUIT_STYLES in clothes.js). Higher
  //  archetypes wear a VARIED painted suit instead of the composed blazer so
  //  the rich crowd reads as bespoke, not off-the-rack. We pick a STYLE INDEX
  //  deterministically off the body and hand it to clothes.js two ways for
  //  forward-compat:
  //    • id:"suit"     — the CURRENT clothes.js painted-suit path (keyOf reads
  //      id==="suit"); fires today.
  //    • suitStyle:N   — the parameterized SUIT_STYLES selector the sibling
  //      wave reads; ignored harmlessly by today's clothes.js.
  //  Either way recolorRig's flat fallback still tints a believable suit if no
  //  painter exists, so this never crashes on a partial clothes.js.
  //
  //  STYLE FAMILIES (indices are advisory — clothes.js owns the real table; we
  //  only steer ARCHETYPE→family so the look READS right):
  //    pinstripe (mob), tux/3-piece (old money), colored/DB (socialite),
  //    charcoal/navy notch (generic exec).
  // ============================================================
  // a guess at how many styles clothes.js ships (read it if exposed, else a
  // safe default that the modulo keeps in-range for any real table size).
  function suitStyleCount() {
    const n = CBZ.citySuitStyleCount && (CBZ.citySuitStyleCount() | 0);
    return n > 0 ? n : 20;
  }
  // archetype → a small set of preferred style indices (deterministic pick
  // within the set via the seed). Conservative, table-agnostic mapping: the
  // sibling wave's SUIT_STYLES is ordered notch→pinstripe→DB→3-piece→color→tux,
  // so these ranges aim at the right families and degrade to a modulo if the
  // real table is shorter.
  const SUIT_FAMILIES = {
    mobster:   [4, 5, 6, 7],        // pinstripe band
    made:      [4, 5, 6, 7],        // pinstripe band
    tycoon:    [12, 13, 18, 19],    // 3-piece / tux band
    billionaire:[12, 13, 18, 19],
    oldmoney:  [12, 13, 18, 19],
    socialite: [8, 9, 10, 11, 14],  // double-breasted / colored band
    boss:      [0, 1, 2, 3],        // charcoal/navy notch
    exec:      [0, 1, 2, 3],
  };
  function suitStyleFor(spec) {
    const a = (spec && spec.archetype) || "";
    const fam = SUIT_FAMILIES[a];
    const seed = Math.abs((spec && (spec.seed | 0)) || 0);
    const n = suitStyleCount();
    if (fam && fam.length) {
      // walk the family for the first in-range index (shorter tables degrade
      // gracefully); if none fit, fall through to a plain modulo.
      for (let k = 0; k < fam.length; k++) {
        const idx = fam[(seed + k) % fam.length];
        if (idx < n) return idx;
      }
    }
    return seed % n;
  }
  // build the painted-suit RECORD. colors give the flat fallback its body tint
  // so a missing painter still reads as that suit family (pinstripe→charcoal,
  // colored→tan, etc.); the formal flag + drip keep perception/rope reads.
  const SUIT_FALLBACK_HEX = {
    mobster: 0x23262e, made: 0x23262e,              // dark charcoal pinstripe body
    tycoon: 0x0a0b0e, billionaire: 0x0a0b0e, oldmoney: 0x14161c,  // near-black tux/3-piece
    socialite: 0x3a4a6b, boss: 0x1c2030, exec: 0x1c2030,
  };
  function suitRecord(spec) {
    const style = suitStyleFor(spec);
    const a = (spec && spec.archetype) || "";
    const body = SUIT_FALLBACK_HEX[a] != null ? SUIT_FALLBACK_HEX[a] : 0x1c2030;
    const tux = a === "tycoon" || a === "billionaire" || a === "oldmoney";
    return {
      id: "suit", name: "Tailored Suit", tier: "money", who: "professionals",
      price: 0, drip: tux ? CAT.tuxedo.drip : CAT.suit.drip,
      formal: tux ? "tux" : "suit", suitStyle: style,
      colors: { legs: body, torso: body, collar: tone(body, 0.12), arms: body, shoes: 0x0c0d10, gloss: tux },
    };
  }
  // tiny hex tone helper (lighten/darken) for the suit collar/lapel read.
  function tone(n, amt) {
    let r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255;
    if (amt > 0) { r += (255 - r) * amt; gg += (255 - gg) * amt; b += (255 - b) * amt; }
    else { r *= 1 + amt; gg *= 1 + amt; b *= 1 + amt; }
    return ((r | 0) << 16) | ((gg | 0) << 8) | (b | 0);
  }

  // ============================================================
  //  THE LOOK API — recolor a built rig (player or NPC) in place.
  //  Clone-on-write: cmat materials are SHARED caches; clone before the
  //  first tint so recoloring one body never repaints the whole street.
  // ============================================================
  function paint(list, color, visible) {
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (!m) continue;
      if (color != null && m.material && m.material.color && m.material.color.setHex) {
        if (m.material._shared) m.material = m.material.clone();
        m.material.color.setHex(color);
      }
      if (visible != null) m.visible = visible;
    }
  }
  // GLOSS (the tux's patent-leather shoes): a faint cool sheen via the Lambert
  // emissive. Clone-on-write like paint(), and always RESET when the fit has no
  // gloss — a cloned material persists across re-wears, so a tux→hoodie change
  // must walk the shine back off.
  function sheen(list, on) {
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (!m || !m.material || !m.material.emissive || !m.material.emissive.setHex) continue;
      if (m.material._shared) {
        if (!on) continue;                     // shared cache mats are already matte
        m.material = m.material.clone();
      }
      m.material.emissive.setHex(on ? 0x3a3f4c : 0x000000);
      m.material.emissiveIntensity = on ? 0.4 : 1;
    }
  }
  // recolor any character rig's CLOTH to an outfit's colors (skin/face untouched).
  // SAME part mapping as sampleRigColors below — paint(legs/torso/collar/arms/
  // shoes) ↔ sample(legs/torso/collar/arms/shoes) — so a corpse swap is exact:
  // what you sample off them is precisely what painting puts on you.
  //
  // PAINTED CLOTHING (city/clothes.js): when the optional `rec` (the outfit
  // RECORD, not just its colors) is passed and clothes.js knows a painted look
  // for it, the parts it paints get the canvas-textured garment (lapels, badge,
  // apron…) instead of a flat tint; everything it doesn't paint — and the whole
  // rig when clothes.js is absent — falls back to the exact flat-color path.
  // opts.iso isolates the textured material per rig (crowd.js pooled bodies).
  function recolorRig(ch, c, rec, opts) {
    if (!ch || !ch.skinSlots || !c) return false;
    const s = ch.skinSlots;
    // COMPOSITE (business fits): a composed blazer + collared shirt + tie layered
    // on the PLAIN base. cityApplyComposite is idempotent (strips any painted
    // look, flat-tints the base, then layers), so a re-dress never accumulates.
    if (rec && rec.composite && CBZ.cityApplyComposite) {
      CBZ.cityApplyComposite(ch, rec.composite);
      sheen(s.shoes, !!c.gloss);
      // a composite is never a gang fit → make sure no stale bandana lingers
      if (ch._bandana && CBZ.cityAttachBandana) CBZ.cityAttachBandana(ch, null);
      return true;
    }
    const pp = CBZ.cityApplyClothes ? CBZ.cityApplyClothes(ch, rec || null, opts) : null;
    if (!pp || !pp.legs) { paint(s.legs, c.legs); paint(s.legsLower, c.legs); }
    if (!pp || !pp.torso) paint(s.torso, c.torso);
    if (!pp || !pp.arms) { const ah = c.arms != null ? c.arms : c.torso; paint(s.arms, ah); paint(s.armsLower, ah); }
    paint(s.collar, c.collar != null ? c.collar : c.torso);
    paint(s.shoes, c.shoes != null ? c.shoes : 0x2b2b2b);
    sheen(s.shoes, !!c.gloss);
    // GANG colors = a SOLID shirt (painted above by the flat path) + a small
    // BANDANA mesh in the crew's bold FLAG color (the torso color, not the dark
    // accent). clothes.js owns the mesh; any non-gang fit clears a stale bandana
    // so a corpse-swap / re-dress can't leave one on the wrong body.
    if (CBZ.cityAttachBandana) {
      if (rec && rec.gang) CBZ.cityAttachBandana(ch, c.torso != null ? c.torso : 0xb079ea);
      else if (ch._bandana) CBZ.cityAttachBandana(ch, null);
    }
    return true;
  }
  CBZ.cityRecolorRig = recolorRig;

  // ============================================================
  //  CBZ.cityPaintSlot(meshes, color, visible) — THE ONLY SAFE WAY TO TINT
  //  A BODY.
  //
  //  WHY THIS IS EXPORTED, and why it is not optional:
  //  CBZ.cmat() is a GLOBAL material cache keyed on colour, and every material
  //  it hands out is flagged _shared — one object reused by every mesh in the
  //  world that asked for that colour. character.js builds a rig's HANDS (and
  //  shoes, and forearm caps) through cmat, but builds the HEAD through mat(),
  //  which allocates a private material.
  //
  //  So a painter that calls `m.material.color.setHex(h)` with no clone-on-
  //  write does not recolour one actor. It reaches into the shared pool and
  //  repaints that colour EVERYWHERE — on strangers across the map, on the
  //  hands of people who have nothing to do with the fit being applied. Their
  //  heads keep their own private material and do not follow.
  //
  //  That is the bug the owner reported as "HANDS AND FACES ARE DIFFERENT
  //  COLORS AND RACES". It is not a casting bug and there is nothing wrong
  //  with the skin-tone tables: it is one missing clone, copied into four
  //  files. This is that one line, given a name so the fifth copy is never
  //  written.
  //
  //  Adoption is a straight swap for the local `paint` closure every dresser
  //  had already written, and it is degrade-safe:
  //      const paint = CBZ.cityPaintSlot || function (a, h) { ...old... };
  // ============================================================
  CBZ.cityPaintSlot = paint;

  // ---- VISUAL TRUTH: sample what a body is ACTUALLY rendering -------------
  // Peds are painted at spawn from district wardrobes / tourist brights /
  // vagrant rags, and repainted by crowd promotion + vips drafting — so a
  // derived catalog record often looks NOTHING like the body. Read the live
  // color off whatever material each part currently has (shared or cloned —
  // getHex is read-only, we NEVER mutate here).
  function readColor(list) {
    if (!list) return null;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      // a PAINTED part (canvas-textured, clothes.js) has no meaningful flat
      // color — skip it so sampling falls back to the catalog record, which
      // carries the painted identity through a corpse swap intact.
      if (m && m.material && m.material.map) continue;
      if (m && m.material && m.material.color && m.material.color.getHex) return m.material.color.getHex();
    }
    return null;
  }
  function sampleRigColors(ch) {
    if (!ch || !ch.skinSlots) return null;
    const s = ch.skinSlots;
    const torso = readColor(s.torso);
    if (torso == null) return null;            // harness stub rigs — no sample
    const legs = readColor(s.legs), collar = readColor(s.collar);
    const arms = readColor(s.arms), shoes = readColor(s.shoes);
    return {
      legs: legs != null ? legs : torso,
      torso,
      collar: collar != null ? collar : torso,
      arms: arms != null ? arms : torso,
      shoes: shoes != null ? shoes : 0x2b2b2b,
    };
  }

  // ============================================================
  //  PLAYER WARDROBE (contract [B]) — g.cityFit is the COMPOSITE the player
  //  builds at the clothing store / closet: a base shirt + legs color and a
  //  list of owned visualIds (blazer/tie/collared-shirt/…). The plain default
  //  (white tee, jean legs, no items) IS a valid look. A bought CATALOG fit
  //  (tuxedo, a uniform, gang colors) overrides the composite while worn; the
  //  composite is what the player returns to when they take a catalog fit off.
  // ============================================================
  const FIT_DEFAULT = { shirt: 0xf2f2f2, legs: JEAN, items: [] };
  function fit() {
    if (!g.cityFit || typeof g.cityFit !== "object") g.cityFit = { shirt: FIT_DEFAULT.shirt, legs: FIT_DEFAULT.legs, items: [] };
    if (!Array.isArray(g.cityFit.items)) g.cityFit.items = [];
    if (g.cityFit.shirt == null) g.cityFit.shirt = FIT_DEFAULT.shirt;
    if (g.cityFit.legs == null) g.cityFit.legs = FIT_DEFAULT.legs;
    return g.cityFit;
  }
  function itemsOwned() { if (!g.cityItemsOwned) g.cityItemsOwned = {}; return g.cityItemsOwned; }
  // the composable drip for a visualId (clothes.js owns the value); guarded.
  function compDrip(id) { const sp = CBZ.cityComposableSpec && CBZ.cityComposableSpec(id); return (sp && sp.drip) || 0; }
  function compSlot(id) { const sp = CBZ.cityComposableSpec && CBZ.cityComposableSpec(id); return (sp && sp.slot) || null; }
  // is this composite a fully-painted special (tuxedo)? then it reads as that
  // catalog fit for perception/drip (the rope opens for the cloth alone).
  function paintedSpecialOf(items) {
    for (let i = 0; i < items.length; i++) { const sp = CBZ.cityComposableSpec && CBZ.cityComposableSpec(items[i]); if (sp && sp.painted) return sp.painted; }
    return null;
  }
  // build the synthetic WORN RECORD for the player's composite. id "civvies"
  // so the perception machinery reads a plain civilian; drip = BASE + the sum
  // of the composable drips, so the closet build can clear the club rope.
  function fitRecord() {
    const f = fit();
    const special = paintedSpecialOf(f.items);
    if (special && CAT[special]) return CAT[special];   // a tuxedo composite IS the catalog tux (formal kit + drip)
    let drip = 0; for (let i = 0; i < f.items.length; i++) drip += compDrip(f.items[i]);
    return {
      id: "civvies", name: f.items.length ? "Custom Fit" : "Street Clothes",
      tier: "fit", who: "you", price: 0, drip: drip,
      colors: { legs: f.legs, torso: f.shirt, collar: f.shirt, arms: f.shirt, shoes: 0x2b2b2b },
      composite: { shirt: f.shirt, legs: f.legs, items: f.items.slice() },
    };
  }

  // dress the PLAYER rig in the worn outfit (extends recolorRig with the
  // player-only kit: jail stripes hidden, the cop cap/badge ride the uniform —
  // mirrors entities/player.js applyPlayerRole so the two never fight: that
  // one owns jail roles, this one owns the city look, re-applied on re-entry).
  let _appliedId = null;
  function applyPlayer() {
    const ch = CBZ.playerChar;
    // OUTFIT REVISION: bump on every application so consumers that cache a
    // "look signature" (the charpanel portrait) redraw even when a change
    // isn't visible in the record fields they hash (patterns, swiped fits,
    // same-id re-dresses). Owner bug: the corner portrait showed a flat
    // blue/tan suit while the body wore pinstripe.
    CBZ.cityOutfitRev = (CBZ.cityOutfitRev || 0) + 1;
    let w = worn();
    // a plain-civvie base record means "wear the COMPOSITE" — dress from
    // g.cityFit via cityApplyComposite (recolorRig routes rec.composite there).
    // Catalog fits (uniforms/tux/gang/biz) carry their own record and win. A
    // SWIPED fit (clothes taken off a body) carries real sampled colors — honor
    // them, don't revert to your own composite.
    if (PLAIN_BASE[w.id] && plainCivvies() && !w.swiped) w = fitRecord();
    if (!ch || !ch.skinSlots || !recolorRig(ch, w.colors, w)) return;
    const s = ch.skinSlots;
    paint(s.stripes, null, false);                                   // no city fit has jail stripes
    paint(s.belt, w.colors.belt != null ? w.colors.belt : 0x17191f, true);
    paint(s.badge, null, !!w.cop);                                   // the badge rides the uniform
    paint(s.cap, null, !!w.cop);
    paint(s.hair, null, !w.cop);
    _appliedId = w.id;
    if (CBZ.cityBlingPlayerDirty) CBZ.cityBlingPlayerDirty();        // chains re-seat over the new fit
  }
  // the catalog ids that mean "no real catalog fit chosen — use the composite"
  const PLAIN_BASE = { street: 1, civvies: 1, basics: 1, hoodie: 1 };

  // ---- equip / remove a composable on the PLAYER (contract [B]) --------------
  function cityOwnsItem(id) {
    if (!id) return false;
    // a painted-special composite (tuxedo) is owned via the catalog outfit set
    const sp = CBZ.cityComposableSpec && CBZ.cityComposableSpec(id);
    if (sp && sp.painted) return !!(ownedMap()[sp.painted]);
    return !!itemsOwned()[id];
  }
  CBZ.cityOwnsItem = cityOwnsItem;
  function cityGrantItem(id) {
    if (!id) return false;
    const sp = CBZ.cityComposableSpec && CBZ.cityComposableSpec(id);
    if (sp && sp.painted) { ownedMap()[sp.painted] = true; return true; }  // tux → the catalog owned set
    itemsOwned()[id] = true;
    return true;
  }
  CBZ.cityGrantItem = cityGrantItem;
  // wear an OWNED composable: slot-replace (one blazer, one neck, one shirt …),
  // rebuild g.cityFit, re-dress + persist. A painted special (tuxedo) routes to
  // the catalog wear path so it keeps its formal kit + drip.
  function cityWear(id) {
    if (!id) return false;
    if (!cityOwnsItem(id)) { CBZ.city && CBZ.city.note("You don't own that yet.", 1.4); return false; }
    const sp = CBZ.cityComposableSpec && CBZ.cityComposableSpec(id);
    if (sp && sp.painted && CAT[sp.painted]) return wearRecord(CAT[sp.painted]);  // tuxedo
    const f = fit();
    const slot = compSlot(id);
    // slot-replace: drop any existing item in the same slot, then add this one
    f.items = f.items.filter(function (it) { return compSlot(it) !== slot; });
    f.items.push(id);
    // a white-pants item sets the legs color; reset legs to jean otherwise so
    // taking the white pants off restores the default leg color.
    f.legs = JEAN;
    for (let i = 0; i < f.items.length; i++) { const s2 = CBZ.cityComposableSpec && CBZ.cityComposableSpec(f.items[i]); if (s2 && s2.legsHex != null) f.legs = s2.legsHex; }
    return wearFitAndPersist();
  }
  CBZ.cityWear = cityWear;
  // take OFF an item (by visualId) or everything in a slot name (e.g. "neck").
  function cityUnwear(slotOrId) {
    const f = fit();
    const before = f.items.length;
    if (CBZ.cityComposableSpec && CBZ.cityComposableSpec(slotOrId)) {
      f.items = f.items.filter(function (it) { return it !== slotOrId; });
    } else {
      f.items = f.items.filter(function (it) { return compSlot(it) !== slotOrId; });
    }
    f.legs = JEAN;
    for (let i = 0; i < f.items.length; i++) { const s2 = CBZ.cityComposableSpec && CBZ.cityComposableSpec(f.items[i]); if (s2 && s2.legsHex != null) f.legs = s2.legsHex; }
    if (f.items.length === before) return false;
    return wearFitAndPersist();
  }
  CBZ.cityUnwear = cityUnwear;
  // set the base shirt color of the composite (the closet color picker).
  CBZ.citySetFitShirt = function (hex) { if (hex == null) return false; fit().shirt = hex | 0; return wearFitAndPersist(); };
  function wearFitAndPersist() {
    const ok = wearRecord(fitRecord());
    if (CBZ.cityWorldCommit) CBZ.cityWorldCommit();   // ride the existing save hook
    return ok;
  }
  CBZ.cityFitGet = function () { return fit(); };

  // ---- wear: set the record, repaint, surface the status change --------------
  function wearRecord(rec, opts) {
    if (!rec || !rec.colors) return false;
    opts = opts || {};
    const before = CBZ.cityPlayerDrip ? (CBZ.cityPlayerDrip() | 0) : 0;
    g.cityWornOutfit = rec;
    g.cityOutfitId = rec.id;
    applyPlayer();
    const after = CBZ.cityPlayerDrip ? (CBZ.cityPlayerDrip() | 0) : 0;
    // respect lands ONCE per fit you first put on (re-wears aren't a flex)
    g.cityOutfitRespected = g.cityOutfitRespected || {};
    if (!g.cityOutfitRespected[rec.id] && rec.drip > 0 && CBZ.city && CBZ.city.addRespect) {
      g.cityOutfitRespected[rec.id] = true;
      CBZ.city.addRespect(Math.max(1, Math.round(rec.drip / 2)));
    }
    if (!opts.silent && CBZ.city) {
      const CLUB = (CBZ.CITY && CBZ.CITY.CLUB_DRIP) || 30, VIP = (CBZ.CITY && CBZ.CITY.VIP_DRIP) || 70;
      if (rec.cop) CBZ.city.note("The uniform's on — at a distance, the city reads a cop.", 2.6);
      else if (rec.gang) CBZ.city.note("" + rec.name + " on your back — their corners read kin, their rivals read TARGET.", 3);
      else if (before < CLUB && after >= CLUB && CBZ.city.big) CBZ.city.big("" + rec.name + " — cloth like this opens velvet ropes.");
      else if (before < VIP && after >= VIP && CBZ.city.big) CBZ.city.big("✦ " + rec.name + " — dressed like money; the elite lounge waves you up.");
      else CBZ.city.note("Now wearing " + rec.name + ".", 1.8);
    }
    if (CBZ.cityLook) { CBZ.cityLook().outfit = rec.name; }          // legacy style read stays true
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  }

  // ---- boutique purchase: pay once, own it, wear it (re-wear free) -----------
  function buyOutfit(id) {
    buildGangOutfits();
    const rec = CAT[id];
    if (!rec || !rec.price) return false;
    if (g.cityOutfitId === id) { CBZ.city && CBZ.city.note("You're already rocking the " + rec.name + ".", 1.4); return false; }
    const owned = ownedMap();
    if (!owned[id]) {
      if (!CBZ.city || !CBZ.city.spend || !CBZ.city.spend(rec.price)) {
        CBZ.city && CBZ.city.note("The " + rec.name + " runs $" + rec.price + ".", 1.8);
        if (CBZ.sfx) CBZ.sfx("glass");
        return false;
      }
      owned[id] = true;
      if (CBZ.sfx) CBZ.sfx("coin");
    }
    return wearRecord(rec);
  }

  // ============================================================
  //  PERCEPTION READS — what the street makes of your cloth.
  //  (police.js / gangs.js / wanted.js call these as tiny guarded reads.)
  // ============================================================
  function isCopFit() { const w = g.cityWornOutfit; return !!(w && w.cop); }
  // does the uniform currently BUY trust? Only at minor heat (0-1★ — a manhunt
  // outranks a costume) and only until an officer has clocked your face.
  function copTrust() {
    if (!isCopFit()) return false;
    if ((g.wanted | 0) >= 2) return false;
    if (g.cityOutfitBlownT && CBZ.now < g.cityOutfitBlownT) return false;
    return true;
  }
  // an officer got close enough to see the face under the cap — the uniform
  // stops working for a while (they radio the description around).
  function blowCover(byCop) {
    if (!isCopFit()) return;
    const fresh = !(g.cityOutfitBlownT && CBZ.now < g.cityOutfitBlownT);
    g.cityOutfitBlownT = CBZ.now + 60000;
    if (fresh && CBZ.city) CBZ.city.note("“Wait — you're no cop!” " + ((byCop && byCop.name) || "An officer") + " clocks your face.", 2.6);
  }
  // the crew whose colors you're flying (gang id), or null
  function gangFit() { const w = g.cityWornOutfit; return (w && w.gang) || null; }
  // crimes committed IN UNIFORM burn hotter (impersonating an officer makes
  // every charge worse) — wanted.js multiplies its heat charge by this.
  function heatMult() { return isCopFit() ? 1.5 : 1; }

  CBZ.cityOutfitIsCop = isCopFit;
  CBZ.cityOutfitCopTrust = copTrust;
  CBZ.cityOutfitBlow = blowCover;
  CBZ.cityOutfitGangId = gangFit;
  CBZ.cityOutfitHeatMult = heatMult;
  CBZ.cityOutfitDrip = wornDrip;
  CBZ.cityOutfitGet = function () { return worn(); };
  // the EFFECTIVE worn record actually PAINTED on the player rig — mirrors
  // applyPlayer's PLAIN_BASE->composite substitution, so charpanel.js's portrait
  // dresses IDENTICALLY to the live body (a default player reads the composite
  // fit, not the raw grey 'street' base record). Falls back to the raw record.
  CBZ.cityOutfitGetEffective = function () {
    let w = worn();
    if (w && PLAIN_BASE[w.id] && plainCivvies() && !w.swiped) w = fitRecord();
    return w;
  };
  CBZ.cityOutfitCatalog = function () { buildGangOutfits(); return CAT; };
  CBZ.cityWearOutfit = function (id, opts) { buildGangOutfits(); return CAT[id] ? wearRecord(CAT[id], opts) : false; };
  CBZ.cityBuyOutfit = buyOutfit;

  // ============================================================
  //  AGE + SEX AXES OF THE WARDROBE
  //
  //  entities/character.js builds a REAL body now: a profile per (build, age)
  //  with bands baby/toddler/child/preteen/teen/adult. The wardrobe has to
  //  answer to that, because the casting ladder below is otherwise blind: a
  //  six-year-old standing on a construction lot got the hi-vis vest, a kid
  //  cast "mobster" got the pinstripe suit, and every child in the city was a
  //  small adult in adult cloth.
  //
  //  DEGRADE-SAFE: absent band/age reads ADULT, which is exactly the behavior
  //  every existing caller had before these fields existed.
  //  DETERMINISM: no rng() draws are taken here — appearance rides seed
  //  ARITHMETIC only (CBZ.hashN off spec.seed). Adding a draw to the shared
  //  ped stream would re-deal every later appearance roll (CLAUDE.md), and
  //  taking one only on SOME paths is exactly how that stream gets reordered.
  //  Flags: CITY_CHILD_WARDROBE / CITY_FEM_WARDROBE / CITY_HAIR_CASTING —
  //  each a one-line revert to the pre-change casting.
  // ============================================================
  const CFG = CBZ.CONFIG || (CBZ.CONFIG = {});
  if (CFG.CITY_CHILD_WARDROBE == null) CFG.CITY_CHILD_WARDROBE = true;
  if (CFG.CITY_FEM_WARDROBE == null) CFG.CITY_FEM_WARDROBE = true;
  if (CFG.CITY_HAIR_CASTING == null) CFG.CITY_HAIR_CASTING = true;
  const on = (k) => { const C = CBZ.CONFIG; return !C || C[k] == null || !!C[k]; };

  // deterministic per-body channels off spec.seed. hashN is the repo's own
  // position hash (core/seed.js); the inline fallback keeps this working in a
  // harness that loads outfits.js without seed.js.
  function h32(seed, salt) {
    if (CBZ.hashN) return CBZ.hashN(seed | 0, salt | 0, 0) >>> 0;
    let h = ((seed | 0) ^ Math.imul(salt | 0, 0x9e3779b1)) | 0;
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) | 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) | 0;
    return (h ^ (h >>> 16)) >>> 0;
  }
  function pickBy(list, seed, salt) { return list[h32(seed, salt) % list.length]; }
  function rollBy(seed, salt) { return h32(seed, salt) % 100; }        // 0..99

  // The band thresholds MIRROR entities/character.js's bandOf() — spec.band is
  // the rig's own answer and always wins; age is only the fallback for callers
  // that have a number but no rig yet.
  const KID_BANDS = { baby: 1, toddler: 1, child: 1, preteen: 1, teen: 1 };
  function bandOf(spec) {
    const b = spec && spec.band;
    if (b && KID_BANDS[b]) return b;
    if (b === "adult") return "adult";
    const a = spec && spec.age;
    if (a == null || !isFinite(a) || a >= 18) return "adult";
    if (a < 1.1) return "baby";
    if (a < 4) return "toddler";
    if (a < 10) return "child";
    if (a < 13) return "preteen";
    return "teen";
  }
  function isFem(spec) {
    const s = spec && (spec.sex || spec.gender);
    return s === "f" || s === "female" || !!(spec && spec.fem);
  }

  // ---- CHILDREN --------------------------------------------------------
  // Palettes, not garments: every kid record is a CAT template cloned with a
  // per-body color set, so the same eight rows dress a whole school without
  // repeating. Kids' clothing is SATURATED and high-contrast in life — that
  // is most of why a child reads as a child from across the street.
  //
  // COLOR PAIRS, NOT TWO INDEPENDENT PICKS: clothes.js caches one painted
  // atlas per (torso, collar) — independent picks would multiply a handful of
  // children into a hundred 128x256 textures. A pair table is one atlas per
  // LOOK, and it lets the accent be CHOSEN to go with the base instead of
  // rolled against it. Anything NOT in the cache key (legs on a garment whose
  // painter doesn't touch the leg row, shoes) is free to vary per body.
  const KID_TEE_PAIRS = [                                    // [tee, motif]
    [0xe0574a, 0xf2c53d], [0x3a8fd0, 0xf0ece2], [0x5aa85a, 0xf2c53d], [0xef8f3a, 0x2f3a4a],
    [0x6f5ad0, 0x35bfb0], [0xd86aa8, 0xf0ece2], [0xf2c53d, 0xe0574a], [0x35bfb0, 0x2f3a4a],
  ];
  const KID_SOFT_PAIRS = [                                   // [pastel ground, binding/stripe]
    [0xbfd8e8, 0x3a6aa0], [0xe8d8ea, 0xb05a90], [0xd8e8c8, 0x4a8a3a],
    [0xf0dcc0, 0xc07a3a], [0xe6e2f0, 0x6a5ad0], [0xcfe6e2, 0x2f8a80],
  ];
  const KID_HOODIE_HUES = [0xe0574a, 0x3a8fd0, 0x5aa85a, 0xef8f3a, 0x6f5ad0, 0x35bfb0, 0x4a4d54, 0x2f3a4a];
  const ROMPER_HUES = [0x4a6a92, 0x8a5a3a, 0x5a7a4a, 0x9a4a5a, 0x6a5a8a, 0x3a6a72];
  const PINAFORE_HUES = [0xe2a2b8, 0x9ac0d8, 0xd8c070, 0x8ab88a, 0xc0a0d0, 0xe0a080, 0xd05a6a, 0x70a8b0];
  const SCHOOL_KNITS = [0x2b3a5a, 0x4a1c28, 0x24402f, 0x2f3238];        // navy / maroon / bottle / charcoal
  const KID_LEGS = [0x39414f, 0x2f3a4a, 0x4a3f36, 0x2b2f36, 0x5a6b7a, 0x6a5a48];
  const KID_SHOES = [0xe8e8e8, 0x2b2b2b, 0xd84a4a, 0x3a6ad0, 0xf0c040];
  const CREAM = 0xf0e9dc;
  function kidColors(id, seed) {
    const legs = pickBy(KID_LEGS, seed, 43), shoes = pickBy(KID_SHOES, seed, 57);
    // NOTE on `collar`: recolorRig flat-tints the NECK BOX with it and the
    // painter reads it as the garment's accent — so every value below has to
    // make sense as a neckline (a tee's contrast rib, a shirt collar, the
    // binding on a babygrow), never as a floating colored ring.
    switch (id) {
      case "onesie": case "pyjamas": {
        const p = pickBy(KID_SOFT_PAIRS, seed, 31);
        return { legs: p[0], torso: p[0], collar: p[1], arms: p[0], shoes: id === "onesie" ? p[0] : 0xe8e4dc };
      }
      case "romper":   { const h = pickBy(ROMPER_HUES, seed, 37);
        return { legs: h, torso: h, collar: CREAM, arms: CREAM, shoes: shoes }; }
      case "kidtee":   { const p = pickBy(KID_TEE_PAIRS, seed, 11);
        // legs is the FLAT fallback only — PAINT.kidtee derives the shorts from
        // the tee color, because c.legs is not part of the cache key.
        return { legs: tone(p[0], -0.6), torso: p[0], collar: p[1], arms: p[0], shoes: shoes }; }
      case "kidhoodie": { const h = pickBy(KID_HOODIE_HUES, seed, 23);
        return { legs: legs, torso: h, collar: tone(h, -0.22), arms: h, shoes: shoes }; }   // hoodie paints no legs → free
      case "school": case "schoolgirl": {
        const knit = pickBy(SCHOOL_KNITS, seed, 67);
        // legs is FIXED for the school fit (PAINT.school paints the leg row from
        // it and it is not in the key) — one grey short/skirt for the uniform.
        return { legs: 0x23283a, torso: knit, collar: 0xeceee8, arms: knit, shoes: 0x1c1c20 };
      }
      case "pinafore": { const h = pickBy(PINAFORE_HUES, seed, 47);
        return { legs: h, torso: h, collar: 0xf4efe4, arms: 0xf4efe4, shoes: shoes }; }
    }
    return null;
  }
  // clone a catalog template with a fresh color set (catalog rows are SHARED —
  // never mutate one; the whole street would change clothes).
  function recolored(base, colors, extra) {
    if (!base) return null;
    const r = Object.assign({}, base, extra || null);
    r.colors = Object.assign({}, base.colors, colors || null);
    return r;
  }
  // Which garments each band actually wears. Before puberty the BODY carries no
  // sex signal at all (character.js: dimorphism fades in from ~11), so for a
  // child the clothes and the hair ARE the read — which is why the pools split
  // by sex earlier and harder than the adult ones do.
  const KID_POOL = {
    baby:    { m: ["onesie", "onesie", "pyjamas"],                 f: ["onesie", "onesie", "pyjamas"] },
    toddler: { m: ["romper", "kidtee", "romper", "pyjamas"],       f: ["romper", "pinafore", "kidtee", "pyjamas"] },
    child:   { m: ["kidtee", "kidtee", "school", "kidhoodie"],     f: ["kidtee", "pinafore", "schoolgirl", "kidhoodie"] },
    preteen: { m: ["kidtee", "school", "kidhoodie", "kidhoodie"],  f: ["kidtee", "schoolgirl", "kidhoodie", "pinafore"] },
  };
  function kidFit(spec, band, seed) {
    const pool = KID_POOL[band];
    if (!pool) return null;
    const list = (isFem(spec) ? pool.f : pool.m).filter(function (id) { return !!CAT[id]; });
    if (!list.length) return null;
    const id = list[h32(seed, 7) % list.length];
    // NOTE: hair is deliberately NOT stamped on the record. A fit record is
    // null for every plain civilian, so a `fit.hairStyle` read would silently
    // give hair to some bodies and not others — CBZ.cityHairStyleFor(spec) is
    // the ONE total answer, and it is what a spawner should call.
    return recolored(CAT[id], kidColors(id, seed));
  }

  // ---- TEENAGERS -------------------------------------------------------
  // A teen is old enough for the street's own clothes, so the adult ladder
  // runs first and only its RESULT is vetoed: a 15-year-old can wear the
  // hoodie, the tracksuit, a summer dress, an apron at a counter job — but
  // never a badge, crew colors, turnout gear or a $7500 tuxedo.
  const MINOR_BAN_ID = {
    police: 1, swat: 1, sheriff: 1, soldier: 1, security: 1, firefighter: 1, ems: 1,
    doctor: 1, scrubs: 1, hivis: 1, construction: 1, coveralls: 1, janitor: 1, valet: 1,
    busdriver: 1, mailman: 1, pilot: 1, office: 1, chef: 1, dress: 1,
    leather: 1, tactical: 1, designer: 1, suit: 1, tuxedo: 1,
  };
  function minorBanned(rec) {
    if (!rec) return false;                      // null = plain civvies, always fine
    if (rec.cop || rec.gang || rec.formal) return true;
    const t = rec.tier;
    if (t === "law" || t === "money" || t === "apex") return true;
    return !!MINOR_BAN_ID[rec.id];
  }
  // RATCHET (CLAUDE.md law #5) — a pure, live-state-free sweep of the ONE
  // invariant this whole age axis exists to hold: no non-adult band may ever
  // be cast into adult cloth, no matter what job/gang/cop flags the spawner
  // hands it. Returns the number of VIOLATIONS; it may only ever be ZERO.
  // (`CBZ.cityWardrobeAudit()` — pin it at 0 in tools/math-gate.mjs.)
  CBZ.cityWardrobeAudit = function () {
    buildGangOutfits();
    let bad = 0;
    const bands = [["baby", 0.5], ["toddler", 3], ["child", 7], ["preteen", 11], ["teen", 15]];
    const jobs = [null, "construction worker", "police officer", "nurse", "banker", "dock laborer", "lawyer"];
    const gang = (CBZ.CITY && CBZ.CITY.gangs && CBZ.CITY.gangs[0] && CBZ.CITY.gangs[0].id) || "x";
    for (let bi = 0; bi < bands.length; bi++) for (const sex of ["m", "f"]) for (let ji = 0; ji < jobs.length; ji++) {
      for (let s = 0; s < 64; s++) {
        const rec = CBZ.cityOutfitFor({
          band: bands[bi][0], age: bands[bi][1], sex: sex, job: jobs[ji], archetype: "resident",
          gang: gang, vendor: true, kind: "cop", cop: true, swat: !!(s & 1), seed: s,
        });
        if (minorBanned(rec)) bad++;
      }
    }
    return bad;
  };
  function teenFit(spec, seed) {
    const roll = rollBy(seed, 73);
    if (isFem(spec)) {
      if (roll < 20) return femGarment("sundress", seed);
      if (roll < 40) return femGarment("blouse", seed);
      if (roll < 56) return CAT.hoodie || null;
      if (roll < 70) return CAT.denim_jacket || null;
      if (roll < 82) return CAT.varsity || null;
      return null;                               // plain tee + jeans
    }
    if (roll < 22) return CAT.hoodie || null;
    if (roll < 40) return CAT.tracksuit || null;
    if (roll < 56) return CAT.denim_jacket || null;
    if (roll < 68) return CAT.varsity || null;
    return null;
  }

  // ---- WOMEN -----------------------------------------------------------
  // The body does the heavy lifting now (narrow shoulders, real hips, a waist
  // box, a shorter stature, a different gait), so clothing's job is to
  // REINFORCE the read rather than carry it — and to stop being three hex
  // values away from the man standing next to her. Two things were wrong:
  // the old branch fired for ~34% of women (seed%5 / seed%7) and always in
  // the SAME pink sundress / same wine dress, and it was reachable from only
  // four archetype strings.
  const SUNDRESS_HUES = [
    [0xf0d9a0, 0xd86a8a], [0xbcd6ea, 0x3a6aa0], [0xe8c6d8, 0xb04a7a],
    [0xd8e8c8, 0x5a8a3a], [0xf2dcd0, 0xc06a4a], [0xe4e0f0, 0x6a5ad0],
    [0xeae4d4, 0x3a8a80], [0xf0c8b8, 0x8a3a4a],
  ];
  const DRESS_HUES = [0x8a2050, 0x1c2438, 0x1d5a44, 0x6e1f2b, 0x2b2f36, 0x7a3a6a, 0xa03a3a, 0x3a4a7a];
  const BLOUSE_HUES = [0xeceef0, 0xe8c6cc, 0x2b3a5a, 0x6a7050, 0xd8dce4, 0xc8a8d0, 0xe8d8b8, 0x4a6a7a];
  const FEM_LEGS = [0x39414f, 0x2b3038, 0x4a4a56, 0x2f3a4a, 0x6a5a48, 0x1c1d22];
  const FEM_SHOES = [0xf2f2f2, 0x2b2b2b, 0xc8a08a, 0x8a3a4a, 0xe0d8c8];
  function femGarment(id, seed) {
    const base = CAT[id];
    if (!base) return null;
    if (id === "sundress") {
      const h = pickBy(SUNDRESS_HUES, seed, 83);
      return recolored(base, { torso: h[0], collar: h[1], arms: h[0], legs: h[0], shoes: pickBy(FEM_SHOES, seed, 84) });
    }
    if (id === "dress") {
      const h = pickBy(DRESS_HUES, seed, 89);
      return recolored(base, { torso: h, collar: tone(h, -0.22), arms: h, legs: h, shoes: 0x16171c });
    }
    if (id === "blouse") {
      const h = pickBy(BLOUSE_HUES, seed, 97);
      return recolored(base, { torso: h, collar: h, arms: h, legs: pickBy(FEM_LEGS, seed, 101), shoes: pickBy(FEM_SHOES, seed, 103) });
    }
    return base;
  }
  // the ordinary-woman roll. ~55% wear something explicitly female, the rest
  // stay PLAIN (a solid shirt + jeans is what most people wear, and a street
  // where every woman is in a dress is its own kind of wrong).
  function femCivvieFit(spec, seed) {
    const roll = rollBy(seed, 109);
    if (roll < 24) return femGarment("sundress", seed);      // 24% summer dress
    if (roll < 46) return femGarment("blouse", seed);        // 22% blouse over jeans
    if (roll < 52) return femGarment("dress", seed);         //  6% a day dress
    return null;                                             // 48% plain
  }
  // archetypes that are "an ordinary person on the street" — the old list had
  // four entries and missed every crowd/tourist/shopper label a spawner uses.
  const CIVVIE_ARCH = {
    "": 1, civilian: 1, resident: 1, tourist: 1, shopper: 1, student: 1,
    pedestrian: 1, local: 1, worker: 1, crowd: 1, beachgoer: 1, jogger: 1,
  };

  // ---- HAIR ------------------------------------------------------------
  // At 30m the back-of-head hair MASS is the single strongest and cheapest sex
  // cue there is — it reads from behind, which no garment detail does. This is
  // the natural place to pick it: the caster already knows sex, age and job,
  // and character.js takes `hairStyle` but deliberately owns no RNG.
  //   CBZ.cityHairStyleFor(spec) → one of character.js's HAIR_STYLES keys.
  // Jobs that legally tie hair back (kitchen, medical, uniformed services) get
  // a bun or a ponytail — free realism, and it keeps long hair off a fry cook.
  const TIED_BACK = /chef|line cook|cook\b|kitchen|nurse|scrubs|doctor|surgeon|paramedic|ambulance|\bems\b|waiter|waitress|server|barista|soldier|military|firefight/i;
  const SHORN = /police|officer|soldier|military|marine|swat/i;
  function hairStyleFor(spec) {
    if (!on("CITY_HAIR_CASTING")) return null;
    spec = spec || {};
    const seed = Math.abs((spec.seed | 0) || 0), band = bandOf(spec), fem = isFem(spec);
    const job = spec.job || "";
    if (band === "baby") return "buzz";                       // barely any hair yet
    if (fem) {
      if (band === "toddler") return pickBy(["pigtail", "bob", "bob"], seed, 131);
      if (band === "child" || band === "preteen") return pickBy(["pigtail", "bob", "pony", "bun", "pony"], seed, 137);
      if (TIED_BACK.test(job) || (spec.kind === "cop" || spec.cop)) return pickBy(["bun", "pony"], seed, 139);
      // adults + teens: long/pony/bun dominate — the silhouette cue — with a
      // bob for variety and a rare crop so short-haired women exist too.
      return pickBy(["long", "long", "pony", "bun", "bob", "pony", "long", "crop"], seed, 141);
    }
    if (band !== "adult") return pickBy(["crop", "crop", "short", "buzz"], seed, 143);
    if (SHORN.test(job) || spec.cop || spec.kind === "cop" || spec.swat) return "buzz";
    return pickBy(["short", "short", "crop", "buzz"], seed, 149);
  }
  CBZ.cityHairStyleFor = hairStyleFor;

  // ============================================================
  //  CASTING HOOK — what should THIS person be wearing? peds.js (and any
  //  spawner) can adopt the canonical wardrobe with one line:
  //    const fit = CBZ.cityOutfitFor(opts);            // in makePed
  //    if (fit && opts.outfit == null) opts.outfit = fit.colors.torso;
  //  (or pass fit.colors straight into makeCharacter for the full set).
  // ============================================================
  // a JOB you can read at a glance → its uniform. Only trades EVERYBODY
  // recognizes get a fit (the user's rule: paint what you KNOW); every other
  // job stays in street clothes. Specific trades match BEFORE the generic
  // laborer line — the old bare /worker/ regex put office workers in dock
  // hi-vis, which is exactly the "weird clothes" this table retires.
  function jobFit(job) {
    if (!job) return null;
    // specific new uniforms first (they'd otherwise be eaten by broader lines)
    if (/\bchef\b|line cook|cook\b|kitchen/i.test(job)) return CAT.chef || CAT.vendor;
    if (/waiter|waitress|server|wait staff|barista/i.test(job)) return CAT.waiter || CAT.vendor;
    if (/mail\s?man|mail carrier|postal|postman|letter carrier/i.test(job)) return CAT.mailman || CAT.hivis;
    if (/pilot|aviator|first officer|flight crew|captain/i.test(job)) return CAT.pilot || CAT.office;
    if (/janitor|custodian|cleaner|sanitation/i.test(job)) return CAT.janitor || CAT.security;
    if (/\bvalet\b|parking attendant/i.test(job)) return CAT.valet || CAT.security;
    if (/bus driver|transit|trolley|tram driver/i.test(job)) return CAT.busdriver || CAT.security;
    // casino floor: croupiers/card dealers wear the black-and-whites (the waiter
    // template reads as the classic vest-and-collar dealer). Specific casino
    // terms only, so a street "dealer" (drugs) never trips this. (pit boss keeps
    // the suit via the archetype path — no jobFit here.)
    if (/croupier|card dealer|casino dealer|blackjack dealer|casino floor/i.test(job)) return CAT.waiter || CAT.vendor;
    if (/clerk|cashier|vendor|barber/i.test(job)) return CAT.vendor;
    if (/construction|builder|hardhat|roadwork/i.test(job)) return CAT.construction;
    if (/mechanic|auto shop|garage/i.test(job)) return CAT.coveralls || CAT.construction;
    if (/dock|warehouse|laborer|courier|delivery/i.test(job)) return CAT.hivis;
    if (/paramedic|ambulance|\bems\b/i.test(job)) return CAT.ems;
    if (/nurse|scrubs/i.test(job)) return CAT.scrubs;
    if (/doctor|surgeon|physician/i.test(job)) return CAT.doctor;
    if (/firefight/i.test(job)) return CAT.firefighter;
    if (/sheriff|deputy/i.test(job)) return CAT.sheriff;
    if (/soldier|military/i.test(job)) return CAT.soldier;
    if (/security|guard|bouncer/i.test(job)) return CAT.security;
    if (/accountant|office|banker|analyst|lawyer/i.test(job)) return CAT.office;
    return null;
  }
  // THE GATE: age first, everything else after. A child must never reach the
  // cop/gang/job/archetype ladder at all — the ladder has no idea how old
  // anybody is, and that is exactly how a four-year-old ends up in a hi-vis
  // vest. Teens DO run the ladder; their result is vetoed (see minorBanned).
  CBZ.cityOutfitFor = function (spec) {
    buildGangOutfits();
    spec = spec || {};
    const band = bandOf(spec);
    if (band !== "adult" && on("CITY_CHILD_WARDROBE")) {
      const seed = Math.abs((spec.seed | 0) || 0);
      if (band === "teen") {
        const cast = adultFitFor(spec);
        if (cast && !minorBanned(cast)) return cast;   // a teen-appropriate cast stands
        return teenFit(spec, seed);                    // banned, or nothing cast → the teen pool
      }
      const kf = kidFit(spec, band, seed);
      if (kf) return kf;
      // no template available (a stripped catalog) → PLAIN, never an adult fit
      return null;
    }
    return adultFitFor(spec);
  };
  function adultFitFor(spec) {
    if (spec.kind === "cop" || spec.cop) return spec.swat ? CAT.swat : CAT.police;
    if (spec.gang && CAT["gang:" + spec.gang]) return CAT["gang:" + spec.gang];
    if (spec.vendor || spec.job === "vendor") return CAT.vendor;
    const jf = jobFit(spec.job);
    if (jf) {
      // office/banker/lawyer/analyst is a BUSINESS read — a composed
      // blazer/shirt/tie, not the painted "Office Slacks" slab. Every other
      // job keeps its painted uniform template.
      if (jf === CAT.office) return bizRecord(spec);
      return jf;
    }
    const a = spec.archetype || "";
    const seed = Math.abs((spec.seed | 0) || 0);
    // ---- THE SUITED CROWD: higher archetypes wear VARIED painted suits
    //      (suit|N) so the rich read as bespoke, each one different. The mapping:
    //        mobster/made          → pinstripe
    //        tycoon/old-money      → tux or 3-piece
    //        socialite             → colored / double-breasted
    //        generic boss/exec     → charcoal/navy notch
    //      Desk workers keep the composed blazer+shirt+tie (bizRecord) path. ----
    if (a === "tycoon" || a === "billionaire" || a === "oldmoney") {
      // half wear the apex catalog tux (formal kit), half a varied 3-piece/tux
      // painted suit — so old money isn't a row of identical tuxedos.
      return (seed & 1) ? CAT.tuxedo : suitRecord(spec);
    }
    if (a === "mobster" || a === "made") return suitRecord(spec);    // pinstripe family
    // a SOCIALITE is as often a woman in a gown as a man in a coloured DB suit
    // — the old line put every one of them in a men's tailored suit.
    if (a === "socialite") {
      if (isFem(spec) && on("CITY_FEM_WARDROBE") && CAT.dress) return femGarment("dress", seed);
      return suitRecord(spec);                                       // colored / DB family
    }
    if (a === "boss" || a === "exec") return suitRecord(spec);       // charcoal/navy notch
    // generic desk workers → the COMPOSED suit (blazer + collared shirt + tie).
    if (a === "office" || a === "professional" || a === "businessman" || a === "suit") return bizRecord(spec);
    // ---- STREETWEAR: hustle archetypes cycle through the new painted street
    //      garments so corners aren't all the same tracksuit. Feature-detected —
    //      a missing painter falls back to the flat CAT colors. ----
    if (a === "dealer" || a === "hustler" || a === "cornerkid" || a === "corner") {
      const street = streetwearFor(seed);
      if (street) return street;
    }
    // ---- NIGHTLIFE: the club crowd. The old line handed CAT.dress to
    //      EVERYBODY with a nightlife archetype — men included, which is how a
    //      bouncer's queue filled up with men in wine-red cocktail dresses.
    //      Women get a varied evening dress; men get the night's own uniform. ----
    if (a === "nightlife" || a === "clubber" || a === "partygoer") {
      if (isFem(spec)) {
        if (rollBy(seed, 61) < 78 && CAT.dress) return femGarment("dress", seed);
        return CAT.blouse ? femGarment("blouse", seed) : null;
      }
      const night = [CAT.leather, CAT.tactical, CAT.varsity, CAT.denim_jacket].filter(Boolean);
      if (rollBy(seed, 62) < 45) return suitRecord(spec);            // half the room is suited
      if (night.length) return night[h32(seed, 63) % night.length];
    }
    // ---- ORDINARY WOMEN. The body reads female on its own now (waist box,
    //      hips, stature, gait), so this is REINFORCEMENT: a wider civilian
    //      archetype set, real color variety, and a garment mix that isn't
    //      "everyone in the same pink sundress". ~55% wear something
    //      explicitly female; the rest stay plain, which is also true to life. ----
    if (isFem(spec) && on("CITY_FEM_WARDROBE") && CIVVIE_ARCH[a]) {
      const f = femCivvieFit(spec, seed);
      if (f) return f;
    }
    return null;                                                     // ORDINARY civilians → PLAIN (peds.js paints a solid shirt + jeans)
  }
  // deterministic streetwear pick for the corner archetypes — cycles the new
  // painted ids (and the old tracksuit) so the block reads varied. compFilter
  // logic via CAT presence keeps it crash-proof if an id is absent.
  function streetwearFor(seed) {
    const pool = [CAT.tracksuit, CAT.hoodie, CAT.puffer, CAT.denim_jacket, CAT.varsity]
      .filter(function (r) { return !!r; });
    if (!pool.length) return null;
    return pool[seed % pool.length];
  }

  // ============================================================
  //  RE-DRESS — keep a body's CLOTH true to WHO IT IS RIGHT NOW.
  //
  //  THE GREY-TYCOON BUG: makePed paints the wardrobe exactly once, at
  //  spawn — but a ped's IDENTITY is rewritten after spawn by (a) crowd.js
  //  promotion, whose setLook() repaints the rig in the instanced body's
  //  flat shirt color, then (b) CBZ.cityPedDeal, which can land a BANKED
  //  tycoon/socialite identity on that body, and (c) CBZ.cityRecastForHour,
  //  whose night cast mints socialites. None of those repainted — so a
  //  remembered tycoon walked back in wearing the crowd's flat grey shirt.
  //  Fix: wrap both identity chokepoints (the established wrap pattern —
  //  no edits in crowd.js/schedule.js) and re-dress the body afterwards.
  // ============================================================
  // the body's CURRENT shirt tint, read even off a painted material —
  // crowd.js's setLook writes the instanced shirt hex onto whatever material
  // the torso carries, so this is the color the player just SAW walking.
  // Pure white = a painted material's untouched base → spawn-time outfit hex.
  function liveTorsoHex(ped) {
    const s = ped.char && ped.char.skinSlots, list = s && s.torso;
    if (list) for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (m && m.material && m.material.color && m.material.color.getHex) {
        const h = m.material.color.getHex();
        if (h !== 0xffffff) return h;
      }
    }
    return ped.outfit != null ? ped.outfit : 0x8a939c;
  }
  // a small stable integer per body so a re-dress picks the SAME business
  // composite every time (no blazer-color flicker across promotion/recast).
  function pedSeed(ped) {
    if (ped._fitSeed == null) {
      const nm = ped.name || "";
      let h = 0; for (let i = 0; i < nm.length; i++) h = (h * 31 + nm.charCodeAt(i)) | 0;
      ped._fitSeed = (h ^ (ped.slice | 0) ^ ((ped.outfit | 0) >> 4)) | 0;
    }
    return ped._fitSeed;
  }
  // WHO the body is, age/sex-wise — read off the ped, then off the rig it was
  // actually built from (character.js stamps band/ageYears/profile on it), so
  // a re-dress can never lose a child's age and put them back in adult cloth.
  function pedBand(p) {
    if (!p) return "adult";
    if (p.band) return p.band;
    if (p.char && p.char.band) return p.char.band;
    return bandOf({ age: pedAge(p) });
  }
  function pedAge(p) {
    if (!p) return null;
    if (p.ageYears != null) return p.ageYears;
    return (p.char && p.char.ageYears != null) ? p.char.ageYears : null;
  }
  function pedSex(p) {
    if (!p) return null;
    if (p.gender) return p.gender;
    const pf = p.char && p.char.profile;
    return pf ? (pf.fem ? "f" : "m") : null;
  }
  function redressPed(ped) {
    if (!ped || ped.isPlayer || ped.dead || !ped.char || !ped.char.skinSlots) return;
    const opts = ped._crowd ? { iso: true } : null;   // pooled rigs get isolated materials (setLook tints in place)
    if (ped._wornOutfit) { recolorRig(ped.char, ped._wornOutfit.colors, ped._wornOutfit, opts); return; }
    const fit = CBZ.cityOutfitFor({
      archetype: ped.archetype, job: ped.job, gang: ped.gang, vendor: ped.vendor,
      kind: ped.kind, cop: ped.kind === "cop", swat: ped.swat, seed: pedSeed(ped),
      // the age/sex axes ride along on EVERY re-dress too (crowd promotion, the
      // hour recast, a schedule deal-in) — the grey-tycoon bug's age twin.
      sex: pedSex(ped), age: pedAge(ped), band: pedBand(ped),
    });
    if (fit && fit.colors) { recolorRig(ped.char, fit.colors, fit, opts); ped._castFit = fit.id; return; }
    if (ped._castFit || ped._crowd) {
      // back to an ordinary person: strip any cast paint, keep the shirt the
      // body is visibly wearing (seamless against the instanced crowd swap).
      const torso = liveTorsoHex(ped);
      let legs = readColor(ped.char.skinSlots.legs);
      if (legs == null) legs = 0x363b46;
      // ARMS CONTINUITY: the instanced crowd renders bare (skin-tinted) arms, and
      // crowd.js's setLook just painted this rig's arms to that same skin tone — so
      // a plain promoted body must KEEP its live arm color, not slam it to the shirt
      // color (which would pop skin sleeves → cloth sleeves the instant you walk up).
      // Sample what the rig is wearing on the arms right now; only fall back to the
      // torso color when it can't be read (no skinSlots / harness stub).
      let arms = readColor(ped.char.skinSlots.arms);
      if (arms == null) arms = torso;
      const colors = { legs, torso, collar: torso, arms, shoes: 0x2b2b2b };
      recolorRig(ped.char, colors, { id: "basics", colors }, opts);
      ped._castFit = null;
    }
  }
  CBZ.cityRedressPed = redressPed;
  function ensureCastWraps() {
    const rc = CBZ.cityRecastForHour;
    if (typeof rc === "function" && !rc._fitWrap) {
      const w = function (ped, r) { const changed = rc(ped, r); if (changed) redressPed(ped); return changed; };
      w._fitWrap = true; CBZ.cityRecastForHour = w;
    }
    const dl = CBZ.cityPedDeal;
    if (typeof dl === "function" && !dl._fitWrap) {
      const w2 = function (ped) { const out = dl(ped); redressPed(ped); return out; };
      w2._fitWrap = true; CBZ.cityPedDeal = w2;
    }
  }

  // WHO is this body, wardrobe-wise? The named-identity ladder (kept for the
  // PERCEPTION flags: cop/gang/drip/formal have mechanical meaning). A corpse
  // that's been through a swap wears whatever was left on it — that stamped
  // record (p._wornOutfit, set in finishSwap) outranks identity.
  function baseRecordOf(p) {
    if (!p) return null;
    if (p._wornOutfit) return p._wornOutfit;
    // AGE FIRST, same law as the casting hook: what a child is wearing is a
    // child's clothes, so the corpse-swap NAME and the formal-kit read can
    // never resolve to a badge, a tux or crew colors on a nine-year-old.
    const band = pedBand(p);
    if (band !== "adult" && on("CITY_CHILD_WARDROBE")) {
      return CBZ.cityOutfitFor({
        archetype: p.archetype, job: p.job, seed: pedSeed(p),
        sex: pedSex(p), age: pedAge(p), band: band,
      });
    }
    if (p.kind === "cop") return p.swat ? CAT.swat : CAT.police;
    if (p.gang && CAT["gang:" + p.gang]) return CAT["gang:" + p.gang];
    if (p.vendor) return CAT.vendor;
    // uniformed trades: the corpse-swap record carries the NAME of what you
    // saw (you take "Hospital Scrubs", not "their street clothes")
    const jf = jobFit(p.job);
    if (jf) return jf;
    const a = p.archetype || "";
    const seed = pedSeed(p);
    if (a === "tycoon" || a === "billionaire" || a === "oldmoney") return (Math.abs(seed) & 1) ? CAT.tuxedo : suitRecord({ archetype: a, seed });
    if (a === "mobster" || a === "made" || a === "socialite" || a === "boss" || a === "exec") return suitRecord({ archetype: a, seed });
    return null;
  }

  // what is THIS body wearing? (corpse-swap + interact's "Take their X").
  // Identity decides the RECORD (name + cop/gang/drip/formal flags), but the
  // COLOR PAYLOAD is SAMPLED off the live rig — visual truth always wins, so
  // the fit you take is exactly the fit you saw (district wardrobe, tourist
  // brights, a vips repaint and all). Catalog records are never mutated: a
  // sampled result is a fresh copy.
  CBZ.cityOutfitOf = function (p) {
    buildGangOutfits();
    if (!p) return null;
    const rec = baseRecordOf(p);
    const sampled = sampleRigColors(p.char);
    if (rec) {
      if (!sampled) return rec;                // no rig to read — catalog truth
      const copy = Object.assign({}, rec);     // flags (cop/gang/drip/formal) ride along
      copy.colors = Object.assign({}, rec.colors, sampled);  // belt/gloss kept, cloth sampled
      // a COMPOSITE fit (business blazer/shirt/tie): keep the item list so the
      // swap re-renders the real garment, but let the SAMPLED shirt color travel
      // (visual truth) — you take the blazer + tie you saw, in the shirt you saw.
      if (rec.composite) {
        copy.composite = Object.assign({}, rec.composite,
          { shirt: sampled.torso != null ? sampled.torso : rec.composite.shirt });
      }
      return copy;
    }
    // plain civvies: their actual rendered set travels with the swap. swiped:true
    // marks this as an EXPLICIT sampled fit so the plain-base→your-composite
    // substitution (applyPlayer / cityOutfitGetEffective) does NOT fire and
    // overwrite the stolen colors with your default white tee — taking a body's
    // clothes must actually re-dress you (and the portrait) in THEIR colors.
    const torso = sampled ? sampled.torso : (p.outfit != null ? p.outfit : 0x8a939c);
    const colors = sampled || { legs: 0x363b46, torso, collar: torso, arms: torso, shoes: 0x2b2b2b };
    return { id: "civvies", name: "their street clothes", tier: "street", who: "them", price: 0, drip: 0, colors, swiped: true };
  };

  // FORMAL KIT reads (bling.js attaches the meshes off these — its pooled,
  // despawn-safe rig-attachment pipeline): "tux" = white shirt-front panel +
  // bow-tie + pocket square; "suit" = the modest shirt-front sliver.
  CBZ.cityOutfitFormal = function () { const w = g.cityWornOutfit; return (w && w.formal) || null; };
  CBZ.cityOutfitFormalOf = function (p) {
    buildGangOutfits();
    const rec = baseRecordOf(p);
    return (rec && rec.formal) || null;
  };

  // ============================================================
  //  CORPSE SWAP — "Take their clothes" (interact.js). Stripping a body and
  //  changing is a BEAT of vulnerability: ~2.4s where you can't shoot
  //  (CBZ.cityMenuOpen is the engine's existing fire-block chokepoint).
  //  The trade is literal: the corpse is left wearing YOUR old fit.
  // ============================================================
  let _pendingSwap = null, _heldMenu = false, _copDressT = 0;
  CBZ.cityOutfitSwapWithCorpse = function (body) {
    if (!body || !body.dead || body._clothesTaken) return false;
    if (_pendingSwap || (g.cityOutfitChanging || 0) > 0) return false;
    if (CBZ.player && (CBZ.player.dead || CBZ.player.driving)) return false;
    const theirs = CBZ.cityOutfitOf(body);
    if (!theirs) return false;
    body._clothesTaken = true;
    _pendingSwap = { body, theirs, mine: worn() };
    g.cityOutfitChanging = 2.4;
    if (!CBZ.cityMenuOpen) { CBZ.cityMenuOpen = true; _heldMenu = true; }   // hands full — can't shoot
    if (CBZ.sfx) CBZ.sfx("door");
    CBZ.city && CBZ.city.note("Stripping the " + theirs.name + " off the body — you're exposed…", 2.2);
    return true;
  };
  function finishSwap() {
    const sw = _pendingSwap; _pendingSwap = null;
    if (!sw) return;
    // the corpse is left in YOUR old fit (colors literally trade bodies —
    // sw.mine is the worn record, and the player rig is always painted from
    // the worn record, so the corpse gets your exact previous visible set).
    if (sw.body) {
      sw.body._wornOutfit = sw.mine;             // identity reads now see the traded cloth
      if (sw.body.char) {
        // the record rides along so the corpse inherits the PAINTED look too
        // (your old tux lands on them with its lapels, not a flat black tint)
        recolorRig(sw.body.char, sw.mine.colors, sw.mine);
        sw.body.outfit = sw.mine.colors.torso;   // gore/cloth reads stay true
      }
      // re-mirror the corpse's attachments NOW: a magnate stripped of his tux
      // loses the shirt-front/bow on the spot (or gains yours, if you had one).
      if (CBZ.cityBlingResyncPed) CBZ.cityBlingResyncPed(sw.body);
    }
    wearRecord(sw.theirs);
  }
  function cancelSwap() {
    _pendingSwap = null;
    g.cityOutfitChanging = 0;
    if (_heldMenu) { CBZ.cityMenuOpen = false; _heldMenu = false; }
  }

  // ============================================================
  //  PER-FRAME (cheap): keep the player painted, run the change beat, and
  //  lazily wrap CBZ.cityPlayerDrip so the worn FIT counts at every rope/
  //  counter (idempotent, load-order-proof — the bling.js wrap pattern).
  // ============================================================
  // bought JEWELRY (tag:"jewelry": watches/chains/ring/grill) is neither a clothing
  // composite nor a legacy-equipped wearable, so neither playerDrip nor wornDrip
  // counts it. Sum the BEST owned piece per slot (the same pick bling renders) so a
  // sick watch/chain actually moves your club status. Owned == worn (no equip step).
  function jewelryDrip() {
    const e = CBZ.cityEcon; if (!e || !e.ITEMS) return 0;
    const best = {};
    for (const name in e.ITEMS) {
      const it = e.ITEMS[name];
      if (!it || it.tag !== "jewelry" || !it.drip) continue;
      if ((e.count ? e.count(name) : 0) <= 0) continue;
      const sl = it.slot || "_";
      if (!best[sl] || it.drip > best[sl]) best[sl] = it.drip;
    }
    let s = 0; for (const k in best) s += best[k];
    return s;
  }
  function ensureDripWrap() {
    const cur = CBZ.cityPlayerDrip;
    if (typeof cur !== "function" || cur._outfitWrap) return;
    const wrapped = function () { return (cur() | 0) + wornDrip() + jewelryDrip(); };
    wrapped._outfitWrap = true;
    CBZ.cityPlayerDrip = wrapped;
  }

  // ---- PERSIST the player wardrobe via the EXISTING save hook (contract [B]):
  //      g.cityFit + the owned composable set ride into the same world ledger
  //      that worldstate.js writes to localStorage AND netpersist.js syncs to
  //      the server — one collector, no new store. Idempotent lazy wraps
  //      (the bling.js pattern): worldstate.js may load after us.
  //
  //      STAMP BEFORE COMMIT: worldstate's commit() calls save() internally, so
  //      the fields must already be on the live ledger (g.cityWorld) when the
  //      inner commit runs — we stamp first, then delegate, so the very same
  //      save() that writes cash/bank also writes the wardrobe.
  function stampFit() {
    const ledger = g.cityWorld;
    if (!ledger || typeof ledger !== "object") return;
    ledger.cityFit = { shirt: fit().shirt, legs: fit().legs, items: fit().items.slice() };
    ledger.cityItemsOwned = Object.assign({}, itemsOwned());
    ledger.cityOutfitsOwned = Object.assign({}, ownedMap());   // catalog fits (tux etc.) too
    // LEDGER GAP fix: the actual WORN record (a catalog fit — tux/uniform/gang
    // colors — can override the composite while worn) never round-tripped at
    // all before. Without this, switching to a DIFFERENT character kept
    // whatever the outgoing character had g.cityWornOutfit set to (worn()'s
    // "only initialize if falsy" guard never resets it), so the newcomer would
    // visibly wear the last character's tux/uniform until they changed
    // clothes themselves. Plain data (catalog literal or the fitRecord()
    // synthetic record) — safe to structuredClone/JSON-copy whole.
    try { ledger.cityWornOutfit = JSON.parse(JSON.stringify(g.cityWornOutfit || null)); } catch (e) { ledger.cityWornOutfit = null; }
  }
  let _ensureSaveWraps_done = false;
  function ensureSaveWraps() {
    // ONE-SHOT INSTALL (chain-growth fix): the old guard checked the
    // module flag on the CURRENT top-of-chain function, so once any
    // later module wrapped above us the flag vanished from the top and
    // we re-wrapped EVERY tick - ~20 such modules made the commit chain
    // grow unboundedly (stack overflow on save; found by the P5 full-
    // stack harness). A module-local boolean wraps exactly once, ever.
    if (_ensureSaveWraps_done) return;
    _ensureSaveWraps_done = true;
    const commit = CBZ.cityWorldCommit;
    if (typeof commit === "function" && !commit._fitWrap) {
      const w = function () { stampFit(); return commit.apply(this, arguments); };
      w._fitWrap = true; CBZ.cityWorldCommit = w;
      // cityWorldCollect (the MP/persistence collector) points at the same inner
      // commit in worldstate.js — re-point it to the stamping wrap so the server
      // blob carries the wardrobe too.
      if (CBZ.cityWorldCollect && !CBZ.cityWorldCollect._fitWrap) {
        const col = CBZ.cityWorldCollect;
        const wc = function () { stampFit(); return col.apply(this, arguments); };
        wc._fitWrap = true; CBZ.cityWorldCollect = wc;
      }
    }
  }
  // RESTORE side: worldstate.js's beginRun/adopt populate g.cityWorld BEFORE our
  // first city tick (worldstate.js loads after us, so a load-time begin-run wrap
  // would miss the very first entry). Instead hydrate from the live ledger
  // whenever its object REFERENCE changes — covers fresh load, respawn, AND a
  // multiplayer adopt (which swaps the whole g.cityWorld object).
  let _hydratedLedger = null;
  function hydrateFitFromLedger() {
    const ledger = g.cityWorld;
    if (!ledger || ledger === _hydratedLedger) return;
    _hydratedLedger = ledger;
    if (ledger.cityItemsOwned) g.cityItemsOwned = Object.assign({}, ledger.cityItemsOwned);
    // FIX (found during the ledger-gap audit): this used to Object.assign INTO
    // the current ownedMap() (merge), so a fit bought by the OUTGOING
    // character stayed "owned" after switching to a different one — a real
    // cross-character bleed, not just a display bug (cityOwnsItem/cityWear
    // would let the newcomer wear it). REPLACE the set instead — every
    // ledger always at least has "street" seeded by ownedMap()'s own default.
    g.cityOutfitsOwned = Object.assign({ street: true }, ledger.cityOutfitsOwned || {});
    if (ledger.cityFit && typeof ledger.cityFit === "object") {
      g.cityFit = { shirt: ledger.cityFit.shirt, legs: ledger.cityFit.legs, items: Array.isArray(ledger.cityFit.items) ? ledger.cityFit.items.slice() : [] };
    } else {
      g.cityFit = { shirt: FIT_DEFAULT.shirt, legs: FIT_DEFAULT.legs, items: [] };
    }
    // LEDGER GAP fix: restore the actual WORN record too (not just the
    // composite) — a catalog fit (tux/uniform/gang colors) worn by the
    // OUTGOING character must not bleed onto the incoming one. Falls back to
    // null (worn()'s own lazy-init then defaults to Street Basics) when the
    // incoming ledger never wore anything.
    g.cityWornOutfit = (ledger.cityWornOutfit && typeof ledger.cityWornOutfit === "object") ? ledger.cityWornOutfit : null;
    g.cityOutfitId = g.cityWornOutfit ? g.cityWornOutfit.id : null;
    // always redress (body) here — a ledger swap changed SOMETHING (composite,
    // owned set, or the worn record itself), whether or not the current base
    // happens to be a "plain" one.
    applyPlayer();
  }
  // exposed so worldstate.js's applyToGame() can force a SYNCHRONOUS
  // hydrate+redress right after a ledger swap/load — this onUpdate(34.8) tick
  // only fires on the NEXT frame, which is late enough that a corner portrait
  // drawn this same frame would flash the pre-restore look (the reported
  // "resets to a white shirt after reload" symptom).
  CBZ.cityWardrobeHydrate = hydrateFitFromLedger;
  CBZ.cityOutfitApplyPlayer = applyPlayer;
  CBZ.onUpdate(34.8, function (dt) {
    if (g.mode !== "city") {
      if (_appliedId !== null) {
        // leaving the city in PAINTED cloth: strip it (restores the rig's flat
        // geometry+materials) and hand the look back to the mode that owns it —
        // applyPlayerRole would otherwise tint a canvas texture (orange tux).
        if (CBZ.cityApplyClothes && CBZ.playerChar && CBZ.playerChar._clothesKey != null) {
          CBZ.cityApplyClothes(CBZ.playerChar, null);
          if (CBZ.applyPlayerRole && CBZ.player) CBZ.applyPlayerRole(CBZ.player.role);
        }
        _appliedId = null;                        // jail roles own the rig now; repaint on re-entry
      }
      if (_pendingSwap) cancelSwap();
      return;
    }
    ensureDripWrap();
    ensureCastWraps();
    ensureSaveWraps();
    hydrateFitFromLedger();
    buildGangOutfits();
    const w = worn();
    if (_appliedId !== w.id) applyPlayer();
    // COPS wear the painted uniform too (badge/belt/patches) — makeCop lives
    // in police.js, which we don't edit: a cheap throttled sweep dresses any
    // not-yet-painted cop rig through the same API. One pass per cop, ever
    // (the painted key sticks on the rig), and only when clothes.js is loaded.
    if (CBZ.cityApplyClothes) {
      _copDressT -= dt;
      if (_copDressT <= 0) {
        _copDressT = 0.8;
        const cops = CBZ.cityCops;
        if (cops) for (let i = 0; i < cops.length; i++) {
          const c = cops[i];
          if (c && !c.dead && c.char && c.char.skinSlots && c.char._clothesKey === undefined) redressPed(c);
        }
      }
    }
    // the change beat: count it down, then the swap lands
    if ((g.cityOutfitChanging || 0) > 0) {
      if (CBZ.player && CBZ.player.dead) { cancelSwap(); return; }
      g.cityOutfitChanging -= dt;
      if (g.cityOutfitChanging <= 0) {
        g.cityOutfitChanging = 0;
        if (_heldMenu) { CBZ.cityMenuOpen = false; _heldMenu = false; }
        finishSwap();
      }
    }
  });
})();
