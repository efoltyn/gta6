/* ============================================================
   city/economy.js — money, items, the city inventory, the buy/sell
   layer, and the REALISTIC market: most people carry little cash, drug
   prices float by supply/demand + heat, stolen goods fence at a haircut,
   and cars have real values you cash out at the chop shop.

   Money is g.cash ($). The city inventory is g.cityInv ({ item: count }).
   ITEMS are tagged so each shop pulls the right stock:
     food / weapon / ammo / drug / wearable / valuable / tool.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const g = CBZ.game;
  const E = (CBZ.CITY && CBZ.CITY.econ) || {};

  // value = base $ price. heal = hunger restored. dmg/rof/ammo = gun stats.
  const ITEMS = {
    // --- food ---
    Burger:        { value: 9,   tag: "food", heal: 42 },
    Hotdog:        { value: 6,   tag: "food", heal: 28 },
    "Pizza Slice": { value: 7,   tag: "food", heal: 34 },
    Soda:          { value: 3,   tag: "food", heal: 12 },
    "Energy Drink":{ value: 5,   tag: "food", heal: 18, boost: true },
    Fries:         { value: 4,   tag: "food", heal: 20 },
    // --- weapons ---
    Pistol:        { value: 350,  tag: "weapon", gun: "pistol",  dmg: 34, rof: 0.32, ammo: 17 },
    Revolver:      { value: 700,  tag: "weapon", gun: "revolver",dmg: 64, rof: 0.5,  ammo: 6 },
    "Desert Eagle":{ value: 1500, tag: "weapon", gun: "deagle",  dmg: 75, rof: 0.4,  ammo: 7 },
    SMG:           { value: 1200, tag: "weapon", gun: "smg",     dmg: 22, rof: 0.09, ammo: 30 },
    Uzi:           { value: 1600, tag: "weapon", gun: "uzi",     dmg: 16, rof: 0.05, ammo: 25 },
    Shotgun:       { value: 900,  tag: "weapon", gun: "shotgun", dmg: 80, rof: 0.85, ammo: 8 },
    Rifle:         { value: 2600, tag: "weapon", gun: "rifle",   dmg: 48, rof: 0.13, ammo: 30 },
    "AK-47":       { value: 3200, tag: "weapon", gun: "ak47",    dmg: 34, rof: 0.097,ammo: 30 },
    LMG:           { value: 6500, tag: "weapon", gun: "lmg",     dmg: 27, rof: 0.075,ammo: 100 },
    Sniper:        { value: 5200, tag: "weapon", gun: "sniper",  dmg: 130,rof: 1.25, ammo: 5 },
    Bazooka:       { value: 9000, tag: "weapon", gun: "bazooka", dmg: 1,  rof: 1.4,  ammo: 1 },
    // "Rocket Launcher" is the same engine launcher as the Bazooka (gun:'bazooka'
    // → fpsmode explosive shoot()), surfaced under the name players asked for so it
    // shows up & buys/equips/fires/explodes through the exact same RPG chain.
    "Rocket Launcher": { value: 9500, tag: "weapon", gun: "bazooka", dmg: 1, rof: 1.4, ammo: 1 },
    Bat:           { value: 80,   tag: "weapon", melee: true, dmg: 26 },
    Knife:         { value: 120,  tag: "weapon", melee: true, dmg: 40 },
    // --- throwables (lobbed, arcing — see city/combat.js grenade system) ---
    // a real area weapon: power/radius a bit under the RPG. Carried as a COUNT in
    // g.cityGrenades; thrown with [T]. tag:'throwable' so shops stock/sell it.
    Grenade:       { value: 250,  tag: "throwable", throwable: "grenade", blastPower: 1.0, blastRadius: 5.5 },
    // --- ammo ---
    "Ammo Box":    { value: 60,   tag: "ammo", rounds: 60 },
    // AIRPOWER resupply: a crate of air-to-ground missiles that rearms your F-22
    // / attack chopper (playeraircraft.js spends this to top up its salvo). Priced
    // as a serious munition — owning airpower means paying to keep it armed.
    "Air-to-Ground Missile": { value: 25000, tag: "ammo", missiles: 4, airmunition: true },
    // --- drugs (float per the street market below) ---
    Weed:          { value: 30,   tag: "drug" },
    Coke:          { value: 120,  tag: "drug" },
    Meth:          { value: 90,   tag: "drug" },
    Pills:         { value: 45,   tag: "drug" },
    // --- wearables → DRIP (your visible STATUS; the club's gate). Each has a
    //   'slot' so an outfit is one item per slot (hat/top/outer/bottom/shoes/
    //   glasses/chain/watch/ring) and 'drip' the status it adds when WORN. Three
    //   tiers: cheap STREETWEAR (1-4), mid DESIGNER (5-10), LUXURY (12-30). Money
    //   → clothes → drip → past the rope. Existing pieces kept, now slotted. ----
    //   STREETWEAR — cheap, low drip (a broke fit stays well under CLUB_DRIP):
    Snapback:        { value: 45,   tag: "wearable", slot: "hat",     drip: 1 },
    "Beanie":        { value: 35,   tag: "wearable", slot: "hat",     drip: 1 },
    Hoodie:          { value: 90,   tag: "wearable", slot: "top",     drip: 2 },
    Tee:             { value: 40,   tag: "wearable", slot: "top",     drip: 1 },
    Tracksuit:       { value: 180,  tag: "wearable", slot: "outer",   drip: 3 },
    "Cargo Pants":   { value: 70,   tag: "wearable", slot: "bottom",  drip: 2 },
    "Ripped Jeans":  { value: 80,   tag: "wearable", slot: "bottom",  drip: 2 },
    Sneakers:      { value: 220,  tag: "wearable", slot: "shoes",   drip: 3 },
    Jordans:         { value: 280,  tag: "wearable", slot: "shoes",   drip: 4 },
    Sunglasses:    { value: 140,  tag: "wearable", slot: "glasses", drip: 2 },
    Earrings:      { value: 320,  tag: "wearable", slot: "chain",   drip: 3 },
    //   DESIGNER — mid drip (a full designer fit clears CLUB_DRIP, not VIP):
    "Bomber Jacket": { value: 650,  tag: "wearable", slot: "outer",   drip: 6 },
    "Silk Shirt":    { value: 520,  tag: "wearable", slot: "top",     drip: 6 },
    "Designer Jeans":{ value: 480,  tag: "wearable", slot: "bottom",  drip: 5 },
    Loafers:         { value: 560,  tag: "wearable", slot: "shoes",   drip: 6 },
    "Designer Shades":{ value: 420, tag: "wearable", slot: "glasses", drip: 5 },
    "Fedora":        { value: 380,  tag: "wearable", slot: "hat",     drip: 5 },
    "Designer Jacket": { value: 450, tag: "wearable", slot: "outer", drip: 5 },
    "Gold Chain":  { value: 600,  tag: "wearable", slot: "chain",   drip: 7 },
    "Diamond Ring":{ value: 1500, tag: "wearable", slot: "ring",    drip: 10 },
    //   LUXURY — high drip (only a luxury fit reaches VIP_DRIP):
    "Tailored Suit": { value: 4200, tag: "wearable", slot: "outer",   drip: 18 },
    "Velvet Blazer": { value: 3200, tag: "wearable", slot: "outer",   drip: 15 },
    "Dress Shoes":   { value: 1100, tag: "wearable", slot: "shoes",   drip: 9 },
    Rolex:         { value: 2200, tag: "wearable", slot: "watch",   drip: 14 },
    "Iced Watch":    { value: 12000,tag: "wearable", slot: "watch",   drip: 24 },
    "Iced Chain":    { value: 8500, tag: "wearable", slot: "chain",   drip: 22 },
    "Diamond Grill": { value: 1800, tag: "wearable", slot: "glasses",drip: 12 },
    "Diamond Pinky": { value: 9000, tag: "wearable", slot: "ring",    drip: 20 },
    Fur:             { value: 6000, tag: "wearable", slot: "outer",   drip: 16 },
    // --- valuables (loot → fence at pawn) ---
    Wallet:        { value: 40,   tag: "valuable" },
    Phone:         { value: 110,  tag: "valuable" },
    Laptop:        { value: 380,  tag: "valuable" },
    "Cash Stack":  { value: 500,  tag: "valuable" },
    "Gold Bar":    { value: 3000, tag: "valuable" },
    // --- LUXURY VALUABLES (the wealth catalog: the jackpot fences) ----------
    // tag:"valuable" with a real pawn `value`. `luxe:true` marks the >=$90k
    // mega-items so other systems can gate their rarity + flag them as jackpots.
    // Watches climb from the everyday Omega up to the obscene Richard Mille.
    "Designer Bag":      { value: 6000,    tag: "valuable" },
    Omega:               { value: 4000,    tag: "valuable" },
    // (note: "Rolex" also exists as a wearable wristpiece; this valuable is the
    // lifted-loot version that fences at the pawn for its pawn value.)
    "Audemars Piguet":   { value: 90000,   tag: "valuable", luxe: true },
    "Patek Philippe":    { value: 350000,  tag: "valuable", luxe: true },
    "Richard Mille":     { value: 900000,  tag: "valuable", luxe: true },
    "Tennis Bracelet":   { value: 60000,   tag: "valuable" },
    "Diamond Necklace":  { value: 250000,  tag: "valuable", luxe: true },
    // a tiara only a mob wife / heiress wears — part of her seven-figure set.
    // Kept RARE in rollValuables so it stays a jackpot, not a common drop.
    "Diamond Tiara":     { value: 1200000, tag: "valuable", luxe: true },
    // the crown jewel: a rare ring is a life-changing score. The truly absurd
    // 5,000,000 stone is gated even rarer in rollValuables.
    "Engagement Ring":   { value: 5000000, tag: "valuable", luxe: true },
    "Briefcase of Cash": { value: 80000,   tag: "valuable" },
    "Bearer Bonds":      { value: 500000,  tag: "valuable", luxe: true },
    "Art Piece":         { value: 200000,  tag: "valuable", luxe: true },
    // --- tools ---
    Lockpick:      { value: 90,   tag: "tool" },
    Crowbar:       { value: 70,   tag: "tool" },
    "Burner Phone":{ value: 60,   tag: "tool" },
    Medkit:        { value: 150,  tag: "tool", medkit: 40 },
    "Body Armor":  { value: 400,  tag: "tool", armor: 60 },
  };

  // ============================================================
  //  COMPOSABLE WARDROBE CATALOG — the NEW buy/wear pipeline (contract C)
  // ------------------------------------------------------------
  //  These entries are addressed by a canonical `visualId` (NOT by their map
  //  key) so the storefront modules (clothingstore.js / jewelry.js / pawnshop.js)
  //  and the rig painter (clothes.js: cityComposableSpec / cityApplyComposite)
  //  all reference the EXACT same string. They layer onto a PLAIN civilian base
  //  one item per slot, so dressing up is composable instead of a single canned
  //  outfit. tag:"clothing" / tag:"jewelry" keep them OUT of the legacy
  //  "wearable" shop stock + fence paths (those filter tag==="wearable"); the new
  //  modules pull them via cityEcon.itemsByTag(). Prices are research-grounded:
  //  a plain tee ~$40, a collared shirt $60–120, a real (non-fused) blazer
  //  $200–600, ties $40–90, a bowtie ~$50, white trousers ~$80, a bomber ~$300,
  //  a tuxedo ~$2,500; watches climb from an everyday steel piece up through a
  //  diver, a gold case, to a fully iced-out diamond watch.
  //
  //  visualId vocabulary (MUST equal clothes.js / contract [A]):
  //    shirt_white, shirt_<c>_collar, blazer_<c>, tie_<c>, bowtie_black,
  //    pants_white, jacket_bomber, tuxedo   (<c> ∈ a sensible subset of
  //    navy/charcoal/burgundy/forest/white/black/red/silver/royal/pink/tan)
  //  jewelry visualIds map to bling.js looks where one exists; gaps noted.
  // ------------------------------------------------------------
  // colors carried so the catalog can tint the rack sample + the rig without a
  // second lookup. hex matches the sensible tailoring palette.
  const FIT_HEX = {
    navy: 0x27324a, charcoal: 0x3a3f47, burgundy: 0x5d2230, forest: 0x27432f,
    white: 0xf2f2f2, black: 0x1b1d22, red: 0xb23030, silver: 0xb9c0c8,
    royal: 0x2f5fd0, pink: 0xe4a7bd, tan: 0xc3a373,
  };
  function clothing(visualId, slot, drip, price, label, hex) {
    ITEMS[label] = { value: price, tag: "clothing", slot: slot, drip: drip, visualId: visualId, label: label, hex: hex };
  }
  function jewel(visualId, slot, drip, price, label, look) {
    ITEMS[label] = { value: price, tag: "jewelry", slot: slot, drip: drip, visualId: visualId, label: label, blingLook: look };
  }

  // ---- CLOTHING (composable, layered on the plain base) --------------------
  // shirts (slot top). white tee is the cheap default everyone can afford.
  clothing("shirt_white", "top", 1, 40, "White Tee", FIT_HEX.white);
  // collared dress shirts in a tailoring palette ($60–120 by color/finish).
  clothing("shirt_white_collar",    "top", 3, 80,  "White Collared Shirt",    FIT_HEX.white);
  clothing("shirt_navy_collar",     "top", 3, 75,  "Navy Collared Shirt",     FIT_HEX.navy);
  clothing("shirt_charcoal_collar", "top", 3, 70,  "Charcoal Collared Shirt", FIT_HEX.charcoal);
  clothing("shirt_burgundy_collar", "top", 4, 95,  "Burgundy Collared Shirt", FIT_HEX.burgundy);
  clothing("shirt_pink_collar",     "top", 4, 110, "Pink Collared Shirt",     FIT_HEX.pink);
  clothing("shirt_royal_collar",    "top", 3, 65,  "Royal Collared Shirt",    FIT_HEX.royal);
  // blazers (slot outer). a real half-canvas blazer, not a fused $80 slab.
  clothing("blazer_navy",     "outer", 8,  280, "Navy Blazer",     FIT_HEX.navy);
  clothing("blazer_charcoal", "outer", 8,  300, "Charcoal Blazer", FIT_HEX.charcoal);
  clothing("blazer_burgundy", "outer", 9,  420, "Burgundy Blazer", FIT_HEX.burgundy);
  clothing("blazer_forest",   "outer", 9,  380, "Forest Blazer",   FIT_HEX.forest);
  clothing("blazer_black",    "outer", 10, 600, "Black Blazer",    FIT_HEX.black);
  clothing("blazer_tan",      "outer", 8,  260, "Tan Blazer",      FIT_HEX.tan);
  // ties (slot tie — a thin chest strip layered over the shirt) $40–90.
  clothing("tie_navy",     "tie", 2, 50, "Navy Tie",     FIT_HEX.navy);
  clothing("tie_charcoal", "tie", 2, 45, "Charcoal Tie", FIT_HEX.charcoal);
  clothing("tie_burgundy", "tie", 3, 70, "Burgundy Tie", FIT_HEX.burgundy);
  clothing("tie_forest",   "tie", 2, 60, "Forest Tie",   FIT_HEX.forest);
  clothing("tie_red",      "tie", 3, 90, "Red Power Tie", FIT_HEX.red);
  clothing("tie_silver",   "tie", 3, 75, "Silver Tie",   FIT_HEX.silver);
  // bowtie (slot tie — the formal alternative, at the collar).
  clothing("bowtie_black", "tie", 4, 50, "Black Bow Tie", FIT_HEX.black);
  // white trousers (slot bottom) — the summer/formal bottom.
  clothing("pants_white", "bottom", 4, 80, "White Trousers", FIT_HEX.white);
  // bomber (slot outer) — solid shell w/ ribbed hem, a streetwear staple.
  clothing("jacket_bomber", "outer", 6, 300, "Bomber Jacket (Composable)", FIT_HEX.black);
  // tuxedo (slot outer) — the painted formal special; the apex of the rack.
  clothing("tuxedo", "outer", 20, 2500, "Tuxedo (Composable)", FIT_HEX.black);

  // ---- PAINTED FULL-LOOK SUITS (visualId "suit_N" ↔ clothes.js SUIT_STYLES[N]) ----
  // These are the apex of the rack: complete painted tailoring (jacket+shirt+
  // trousers in one look), each a distinct SUIT_STYLES index. Slot "suit" so
  // they occupy the dedicated suit slot (one suit at a time). Prices climb with
  // tailoring: 2-piece business < pinstripe/3-piece/DB < color/pattern < tux.
  const SUIT_CAT = [
    // [index, label, price]  — index MUST match clothes.js SUIT_STYLES order
    [0, "Charcoal Suit", 900], [1, "Navy Suit", 900], [2, "Mid-Grey Suit", 850], [3, "Black Suit", 950],
    [4, "Navy Pinstripe Suit", 1300], [5, "Charcoal Pinstripe Suit", 1300],
    [6, "Navy Double-Breasted Suit", 1600], [7, "Charcoal Double-Breasted Suit", 1600],
    [8, "Charcoal 3-Piece Suit", 1900], [9, "Navy 3-Piece Suit", 1900], [10, "Burgundy 3-Piece Suit", 2100],
    [11, "Tan Suit", 1100], [12, "Olive Suit", 1150], [13, "Burgundy Dinner Suit", 2400],
    [14, "Powder-Blue Suit", 1250], [15, "All-White Suit", 1800],
    [16, "Brown Glen-Check Suit", 1700], [17, "Grey Windowpane Suit", 1700],
    [18, "Black Shawl Tuxedo", 2600], [19, "Midnight-Blue Tuxedo", 2900],
    [20, "White Dinner Jacket", 3200], [21, "Double-Breasted Peak Tuxedo", 3400],
  ];
  const SUIT_HEX = [0x2c2f36, 0x1c2438, 0x53585f, 0x191a1f, 0x1b2236, 0x2b2e35, 0x1a2236, 0x2a2d34,
    0x2c2f36, 0x1c2438, 0x4a1c28, 0xae9468, 0x55582f, 0x5a1f2c, 0x7d9bb8, 0xe9e7df,
    0x6e5c44, 0x595d63, 0x16171c, 0x141a2e, 0xeae8e0, 0x16171c];
  SUIT_CAT.forEach(function (s) {
    clothing("suit_" + s[0], "suit", s[0] >= 18 ? 26 : (s[0] >= 8 && s[0] <= 10 ? 18 : 14), s[2], s[1], SUIT_HEX[s[0]]);
  });

  // ---- STREETWEAR / CASUAL full-looks (painted; slot outer/top) ----
  clothing("hoodie",        "outer", 4,  90,  "Hoodie",          0x7a4a3a);
  clothing("hoodie_grey",   "outer", 4,  90,  "Grey Hoodie",     0x4a4d54);
  clothing("hoodie_black",  "outer", 5,  120, "Black Hoodie",    0x1c1d22);
  clothing("puffer",        "outer", 7,  240, "Puffer Jacket",   0x223a55);
  clothing("denim_jacket",  "outer", 6,  160, "Denim Jacket",    0x3c5a7a);
  clothing("varsity",       "outer", 8,  320, "Varsity Jacket",  0x6e1f2b);
  clothing("graphic_tee",   "top",   2,  45,  "Graphic Tee",     0x1c1d22);
  clothing("tracksuit",     "outer", 5,  180, "Tracksuit",       0x2bb673);
  clothing("tracksuit_red", "outer", 5,  180, "Red Tracksuit",   0xb22a2a);
  clothing("tracksuit_navy","outer", 5,  180, "Navy Tracksuit",  0x1c2440);

  // ---- WORK / SERVICE full-looks (painted uniforms anyone can buy) ----
  clothing("coveralls",     "outer", 4,  110, "Coveralls",       0x394a5a);
  clothing("chef",          "outer", 6,  150, "Chef Whites",     0xf0efe9);
  clothing("waiter",        "outer", 7,  200, "Waiter Set",      0x16171c);
  clothing("pilot",         "outer", 9,  420, "Pilot Uniform",   0xeef0f2);

  // ---- DRESSES (painted A-line; slot outer — a full look) ----
  clothing("dress_black",   "outer", 9,  260, "Black Dress",     0x1c1d22);
  clothing("dress_red",     "outer", 9,  290, "Red Dress",       0x8a1f28);
  clothing("dress_navy",    "outer", 9,  250, "Navy Dress",      0x1c2438);
  clothing("dress_emerald", "outer", 10, 340, "Emerald Dress",   0x1d5a44);
  clothing("dress_white",   "outer", 10, 380, "White Dress",     0xe9e7df);
  clothing("sundress",      "outer", 6,  140, "Floral Sundress", 0xf0d9a0);
  clothing("sundress_blue", "outer", 6,  140, "Blue Sundress",   0xbcd6ea);

  // ---- JEWELRY (composable; renders via bling.js real meshes) --------------
  // watches (slot watch). steel = everyday case; diver = sport tool watch; gold
  // = a precious-metal case; iced = a fully diamond-paved bust-down. bling.js
  // has watchSilver/watchGold/watchIced looks — steel+diver share the silver
  // look, gold the gold look, iced the iced look (see deviations).
  jewel("watch_steel", "watch", 6,  1200,  "Steel Watch",        "watchSilver");
  jewel("watch_diver", "watch", 9,  8000,  "Diver Watch",        "watchSilver");
  jewel("watch_gold",  "watch", 14, 18000, "Gold Watch",         "watchGold");
  jewel("watch_iced",  "watch", 26, 45000, "Iced-Out Watch",     "watchIced");
  // chains (slot chain). bling.js chainGold / chainIced looks map 1:1.
  jewel("chain_gold",  "chain", 7,  600,   "Gold Chain (Composable)",  "chainGold");
  jewel("chain_iced",  "chain", 22, 8500,  "Iced Chain (Composable)",  "chainIced");
  // ring (slot ring). bling.js `ring` glint-dot look.
  jewel("ring_diamond", "ring", 10, 1500,  "Diamond Ring (Composable)", "ring");
  // grill (slot glasses — the mouth piece rides the face slot like the legacy
  // Diamond Grill). bling.js has NO grill look (see deviations) → falls back to
  // the `ring` glint until clothes.js/bling.js add a dedicated grill mesh.
  jewel("grill_diamond", "glasses", 12, 4000, "Diamond Grill (Composable)", "ring");

  const SHOP_STOCK = {
    guns:        ["Pistol", "Revolver", "Desert Eagle", "SMG", "Uzi", "Shotgun", "Rifle", "AK-47", "LMG", "Sniper", "Bazooka", "Rocket Launcher", "Grenade", "Ammo Box", "Body Armor", "Knife", "Bat"],
    jewelry:     ["Gold Chain", "Diamond Ring", "Rolex", "Diamond Grill", "Earrings", "Iced Chain", "Iced Watch", "Diamond Pinky"],
    pawn:        ["Lockpick", "Crowbar", "Burner Phone", "Knife"],
    // the boutique: streetwear → designer → luxury, every wearable slot covered.
    clothing:    ["Snapback", "Beanie", "Hoodie", "Tee", "Tracksuit", "Cargo Pants", "Ripped Jeans", "Sneakers", "Jordans", "Sunglasses",
                  "Bomber Jacket", "Silk Shirt", "Designer Jeans", "Loafers", "Designer Shades", "Fedora", "Designer Jacket",
                  "Tailored Suit", "Velvet Blazer", "Dress Shoes", "Fur"],
    boutique:    ["Silk Shirt", "Designer Jeans", "Bomber Jacket", "Loafers", "Designer Shades", "Fedora",
                  "Tailored Suit", "Velvet Blazer", "Dress Shoes", "Fur"],
    food:        ["Burger", "Hotdog", "Pizza Slice", "Soda", "Fries", "Energy Drink"],
    gas:         ["Soda", "Energy Drink", "Hotdog", "Ammo Box", "Burner Phone"],
    drugs:       ["Weed", "Pills"],
    hardware:    ["Crowbar", "Lockpick", "Bat", "Medkit"],
    electronics: ["Phone", "Laptop", "Burner Phone"],
    gym:         ["Energy Drink", "Medkit"],
    barber:      ["Sunglasses", "Earrings", "Snapback", "Beanie", "Fedora", "Designer Shades"],
    security:    ["Body Armor", "Ammo Box", "Pistol"],
    bank:        [],
    hospital:    ["Medkit", "Body Armor"],
    realtor:     [],
    chop:        [],
    casino:      [],
    raceway:     ["Energy Drink", "Medkit"],
    arena:       ["Energy Drink", "Medkit", "Body Armor"],
    paintball:   ["Energy Drink", "Medkit"],
    transit:     ["Soda", "Hotdog", "Burner Phone"],
    cityhall:    [],
    airfield:    ["Body Armor", "Medkit", "Air-to-Ground Missile"],
    racepark:    [],
  };

  // ---- car models with real values (chop-shop payouts + spawning) ----------
  // rarity 0 = everywhere, 1 = exotic. `s` = body length scale (visual variety).
  // The NAME tells you the tier (a Prius is clearly a shitbox, a Ferrari clearly
  // isn't) — the actual $ value stays HIDDEN until you chop it at the shop.
  const CARS = [
    { name: "Toyota Prius",   value: 1200,  rarity: 0.0,  color: 0x6b6f78, s: 1.0,  body: "hatch",  detailStyle: "hatch", designStyle: "prius" },
    { name: "Honda Civic",    value: 2800,  rarity: 0.0,  color: 0x4caf6e, s: 0.92, body: "hatch",  detailStyle: "hatch", designStyle: "civic" },
    { name: "Yellow Cab",     value: 3000,  rarity: 0.05, color: 0xf2c43d, s: 1.0,  body: "sedan",  livery: "taxi", designStyle: "cab" },
    { name: "Chevy Malibu",   value: 3800,  rarity: 0.0,  color: 0x3c6fd6, s: 1.05, body: "sedan",  designStyle: "malibu" },
    { name: "Dodge Caravan",  value: 4600,  rarity: 0.1,  color: 0xe8e8ee, s: 1.12, body: "van",    detailStyle: "van", designStyle: "caravan" },
    { name: "Ford F-150",     value: 5400,  rarity: 0.15, color: 0xe24b4b, s: 1.15, body: "pickup", designStyle: "f150" },
    { name: "Nissan 370Z",    value: 9500,  rarity: 0.4,  color: 0x2a2d33, s: 0.98, body: "coupe",  detailStyle: "porsche", designStyle: "370z" },
    { name: "Jeep Cherokee",  value: 12000, rarity: 0.45, color: 0x44505e, s: 1.18, body: "suv",    detailStyle: "suv", designStyle: "cherokee" },
    { name: "Dodge Charger",  value: 17000, rarity: 0.6,  color: 0xe88a3c, s: 1.08, body: "muscle", detailStyle: "muscle", designStyle: "charger" },
    { name: "Chevy Corvette", value: 26000, rarity: 0.78, color: 0xd03b3b, s: 0.96, body: "coupe",  detailStyle: "porsche", designStyle: "corvette" },
    { name: "Mercedes S-Class", value: 44000, rarity: 0.88, color: 0x1c2230, s: 1.1, body: "sedan", detailStyle: "tesla-s", designStyle: "sclass" },
    { name: "Tesla Model 3",  value: 31000, rarity: 0.72, color: 0x67717b, s: 1.0,  body: "sedan", detailStyle: "tesla-3", designStyle: "model3" },
    { name: "Tesla Model Y",  value: 39000, rarity: 0.78, color: 0x1470e3, s: 1.04, body: "suv",   detailStyle: "tesla-y", designStyle: "modely" },
    { name: "Tesla Model S",  value: 54000, rarity: 0.86, color: 0xd1262f, s: 1.06, body: "sedan", detailStyle: "tesla-s", designStyle: "models" },
    { name: "Tesla Model X",  value: 61000, rarity: 0.9,  color: 0x185bd6, s: 1.12, body: "suv",   detailStyle: "tesla-x", designStyle: "modelx" },
    { name: "Cybertruck",     value: 68000, rarity: 0.91, color: 0xa8afb2, s: 1.18, body: "pickup", detailStyle: "cybertruck", designStyle: "cybertruck" },
    { name: "Porsche 911 Turbo", value: 69000, rarity: 0.93, color: 0xf3cf39, s: 0.94, body: "coupe", detailStyle: "porsche", designStyle: "porsche" },
    { name: "Lamborghini Aventador", value: 71000, rarity: 0.95, color: 0xf28c28, s: 0.98, body: "coupe", detailStyle: "aventador", designStyle: "aventador" },
    { name: "Ferrari 488",    value: 72000, rarity: 0.96, color: 0xffd451, s: 0.94, body: "coupe", detailStyle: "ferrari", designStyle: "ferrari" },
    { name: "Ferrari Enzo",   value: 86000, rarity: 0.975, color: 0xe02025, s: 0.96, body: "coupe", detailStyle: "enzo", designStyle: "enzo" },
    { name: "Bugatti Veyron", value: 99000, rarity: 0.99, color: 0x202225, s: 0.97, body: "coupe", detailStyle: "veyron", designStyle: "veyron" },
  ];

  // ---- NO-DECOY FIX: motorcycles + a boat — playercars.js already has full
  // makeBoat()/makeMotorcycle() rigs (V-hull/console/seats/animated prop;
  // clip-ons/tank/tail-cowl/rider) that were reachable ONLY via the player's
  // [C] style-cycler on a car already being driven, never as a real world
  // spawn. These entries make them real, discoverable ambient vehicles.
  // `body`/`detailStyle: "motorcycle"|"boat"` route straight through
  // cityInferCarStyle (playercars.js) to the matching rig — the SAME visual,
  // no parallel geometry.
  //   Kept OUT of the `CARS` array (a SEPARATE catalog, same shape) rather
  // than appended to it: CARS feeds every generic "pick a car" caller
  // (pickCar/street traffic, empire.js's flip market, island_speedway's
  // showroom floor, buildings.js car lots) AND tools/harness.js's named-
  // vehicle audit, which asserts every CARS entry builds through the
  // standard 4-wheel car-hull pipeline (body in a fixed sedan/hatch/van/
  // pickup/coupe/suv/muscle set, dims.width>1.5, dims.length>3.5, a merged
  // car-hull mesh budget) — assumptions a 2-wheeled bike or an open boat
  // hull can never satisfy (and rightly shouldn't be asked to: the harness
  // is validating car BODIES, not the whole vehicle roster). Splitting them
  // out keeps that contract intact while still giving carByName() one
  // combined namespace to resolve either catalog by name.
  const SPECIAL_VEHICLES = [
    { name: "Street Bike",      value: 4200,  rarity: 0.2, color: 0x2a2d33, s: 1.0, body: "motorcycle", detailStyle: "motorcycle", designStyle: "streetbike" },
    { name: "Ducati Superbike", value: 21000, rarity: 0.7, color: 0x16a0e0, s: 1.0, body: "motorcycle", detailStyle: "motorcycle", designStyle: "superbike" },
    { name: "Speedboat",        value: 15000, rarity: 0.5, color: 0xeceff2, s: 1.0, body: "boat",       detailStyle: "boat",       designStyle: "speedboat" },
  ];

  let _seed = 1357913 & 0x7fffffff;
  function rng() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }

  // All catalog entries carrying a given tag, as an array of records. Each record
  // is the ITEMS value augmented with its map `name` (so callers get the display
  // key alongside value/slot/drip/visualId). Used by the storefront modules
  // (clothingstore.js / jewelry.js / pawnshop.js) to build their racks. Cached
  // (the catalog is static after load) keyed by tag.
  const _byTag = {};
  function itemsByTag(tag) {
    if (_byTag[tag]) return _byTag[tag].slice();
    const out = [];
    for (const name in ITEMS) { const it = ITEMS[name]; if (it && it.tag === tag) out.push(Object.assign({ name: name }, it)); }
    _byTag[tag] = out;
    return out.slice();
  }

  function add(name, n) { n = n || 1; g.cityInv = g.cityInv || {}; g.cityInv[name] = (g.cityInv[name] || 0) + n; if (CBZ.cityHudDirty) CBZ.cityHudDirty(); }
  function has(name) { return ((g.cityInv && g.cityInv[name]) || 0) > 0; }
  function count(name) { return (g.cityInv && g.cityInv[name]) || 0; }
  function take(name, n) { n = n || 1; if (count(name) < n) return false; g.cityInv[name] -= n; if (g.cityInv[name] <= 0) delete g.cityInv[name]; if (CBZ.cityHudDirty) CBZ.cityHudDirty(); return true; }

  // LEGACY whole-inventory drip: sums drip across everything you OWN. Kept so any
  // older caller keeps working — but the PLAYER's club status now comes from the
  // equipped outfit (cityPlayerDrip), not from owning a pile of chains.
  function drip() { let s = 0; const inv = g.cityInv || {}; for (const k in inv) { const it = ITEMS[k]; if (it && it.drip) s += it.drip; } return s; }

  // ============================================================
  //  THE OUTFIT — what you're WEARING (distinct from what you OWN).
  // ------------------------------------------------------------
  //  g.cityOutfit maps a clothing SLOT -> the item name worn there. You can only
  //  ever wear ONE item per slot, so dressing up is a real choice (the iced
  //  chain or the gold one). cityPlayerDrip() sums the drip of the worn pieces +
  //  a baseline; THAT number is your visible STATUS — the club's bouncer reads it
  //  against CBZ.CITY.CLUB_DRIP / VIP_DRIP. Equipping doesn't consume the item
  //  (it's worn, still owned); you must OWN it (in g.cityInv) to put it on.
  // ============================================================
  const SLOTS = ["hat", "top", "outer", "bottom", "shoes", "glasses", "chain", "watch", "ring"];
  function outfit() { if (!g.cityOutfit) g.cityOutfit = {}; return g.cityOutfit; }
  function resetOutfit() { g.cityOutfit = {}; if (CBZ.cityHudDirty) CBZ.cityHudDirty(); }
  function slotOf(name) { const it = ITEMS[name]; return it && it.tag === "wearable" ? (it.slot || null) : null; }
  // Equip a wearable into its slot (replaces whatever was there). Must own it.
  function equip(name) {
    const it = ITEMS[name];
    if (!it || it.tag !== "wearable" || !it.slot) return false;
    if (count(name) <= 0) return false;                 // you have to OWN it to wear it
    outfit()[it.slot] = name;                            // worn, not consumed
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  }
  // Take off whatever is in a slot (or a named item's slot).
  function unequip(slotOrName) {
    const o = outfit();
    let slot = slotOrName;
    if (!SLOTS.includes(slotOrName)) { const s = slotOf(slotOrName); if (s) slot = s; }
    if (slot && o[slot]) { delete o[slot]; if (CBZ.cityHudDirty) CBZ.cityHudDirty(); return true; }
    return false;
  }
  function isEquipped(name) { const o = g.cityOutfit; if (!o) return false; for (const s in o) if (o[s] === name) return true; return false; }
  // The player's STATUS number = baseline + sum of drip over the WORN outfit.
  // A worn piece you no longer own (impossible normally — equipping requires
  // ownership) is skipped defensively. This REPLACES "sum all inventory" as the
  // club's read on the player.
  function playerDrip() {
    const base = (CBZ.CITY && CBZ.CITY.BASE_DRIP) || 0;
    let s = base;
    const o = g.cityOutfit || {};
    for (const slot in o) {
      const name = o[slot];
      const it = ITEMS[name];
      if (it && it.drip && count(name) > 0) s += it.drip;
    }
    return Math.round(s);
  }

  function buyPrice(name) {
    const it = ITEMS[name]; if (!it) return 0;
    // Drugs you buy at the trap house track the wholesale market: when product
    // is OVERSUPPLIED (a district dumped, or a glut event) it's cheap to stock
    // up — buy low. Everything else is flat retail.
    if (it.tag === "drug") return wholesalePrice(name);
    return Math.round(it.value * 1.0);
  }
  function sellPrice(name, kind) {
    const it = ITEMS[name]; if (!it) return 0;
    let mul = 0.45;
    if (kind === "pawn") mul = it.tag === "valuable" ? 0.65 : 0.5;
    if (kind === "jewelry" && it.tag === "wearable") mul = 0.6;
    if (kind === "electronics" && it.tag === "valuable") mul = 0.62;
    // LUXE valuables (Patek, Engagement Ring, Bearer Bonds, Art…) fence FAT at a
    // proper jeweller/pawn: a fence who can move a $350k watch takes a thinner
    // cut, so pawning one nets a real fortune (a jackpot, not a haircut to dust).
    if (it.luxe && (kind === "pawn" || kind === "jewelry")) mul = Math.max(mul, 0.80);
    // a fenced item is worth more when you've built a rep with the fences
    // (a real money sink to chase): higher Fence Rep = a smaller haircut.
    const fence = fenceBonus();
    if (it.tag === "valuable" || it.tag === "wearable") {
      // luxe goods earn the rep bonus on top of their already-fat base, capped
      // a touch higher so a maxed-rep fence on a Patek pays close to clean value.
      const cap = it.luxe ? 0.95 : 0.92;
      mul = Math.min(cap, mul + fence);
    }
    return Math.max(1, Math.round(it.value * mul));
  }
  // Pawn/fence loyalty: each fence sale nudges a hidden rep up; it bumps your
  // resale multiplier (capped). This rewards the buy-low/sell-high loop without
  // ever paying more than the item's clean value.
  function fenceBonus() { return Math.min(0.18, (g.cityFenceRep || 0) * 0.012); }
  function bumpFenceRep(n) { g.cityFenceRep = Math.min(40, (g.cityFenceRep || 0) + (n || 1)); }

  // ============================================================
  //  THE LIVING STREET DRUG MARKET  (supply & demand, per district)
  // ------------------------------------------------------------
  //  Real economics, GTA:Chinatown-Wars style. Each of the city's DISTRICTS
  //  has its own price level per drug that mean-reverts to a baseline "demand"
  //  that varies by neighbourhood (the projects love cheap highs; downtown
  //  pays top dollar for coke). Selling FLOODS that district's price down;
  //  buying (you draining stock, or NPC demand) lifts it. Scarcity + a hot
  //  "tip" event spike prices for a short window — sell into the spike. Heat
  //  scares buyers everywhere. Prices recover toward baseline over time.
  // ============================================================
  const DRUGS = ["Weed", "Coke", "Meth", "Pills"];

  // Districts are derived from world position (see districtAt). Each has a
  // demand profile: a per-drug baseline multiplier. >1 = pays a premium here,
  // <1 = saturated / low demand. Tuned so a smart dealer arbitrages between
  // them (buy coke cheap uptown, sell it downtown).
  const DISTRICTS = {
    downtown:  { name: "Downtown",   tier: 1.00, demand: { Weed: 0.9, Coke: 1.45, Meth: 0.8,  Pills: 1.25 } },
    projects:  { name: "The Projects", tier: 0.78, demand: { Weed: 1.3, Coke: 0.85, Meth: 1.5, Pills: 1.05 } },
    waterfront:{ name: "Waterfront", tier: 0.92, demand: { Weed: 1.1, Coke: 1.2,  Meth: 1.15, Pills: 0.9 } },
    uptown:    { name: "Uptown",     tier: 1.15, demand: { Weed: 0.8, Coke: 1.6,  Meth: 0.7,  Pills: 1.4 } },
    island:    { name: "The Island", tier: 1.30, demand: { Weed: 1.0, Coke: 1.7,  Meth: 0.9,  Pills: 1.55 } },
  };
  const DISTRICT_KEYS = Object.keys(DISTRICTS);

  // figure out which district a world (x,z) sits in. Mainland is split into
  // quadrants around the city centre; the connected annex is "island".
  function districtAt(x, z) {
    const A = CBZ.city && CBZ.city.annex;
    if (A && Math.hypot(x - A.cx, z - A.cz) <= A.radius + 6) return "island";
    const c = CBZ.city && CBZ.city.center;
    if (!c) return "downtown";
    const dx = x - c.x, dz = z - c.z;
    // NE = uptown (rich), SW = projects (poor), NW = downtown, SE = waterfront
    if (dx >= 0 && dz < 0) return "uptown";
    if (dx < 0 && dz >= 0) return "projects";
    if (dx >= 0 && dz >= 0) return "waterfront";
    return "downtown";
  }
  function districtAtPos(p) { p = p || (CBZ.player && CBZ.player.pos) || { x: 0, z: 0 }; return districtAt(p.x, p.z); }
  function districtName(key) { const d = DISTRICTS[key || playerDistrict()]; return d ? d.name : "the city"; }
  function playerDistrict() { return districtAtPos(CBZ.player && CBZ.player.pos); }

  // ---- TERRITORY → MARGINS (Chinatown-Wars inter-gang arbitrage) ------------
  // Each district maps to a representative world point so we can ask the turf
  // system who CONTROLS the ground there. Dealing on turf you (or an ally) own
  // is safer and FATTER; dealing on a rival's block is hostile, low-margin
  // ground. The classic play: source product cheap on one crew's turf, haul it
  // to a rival district that pays a premium. We cache the (x,z) anchor once.
  function districtAnchor(dk) {
    const c = (CBZ.city && CBZ.city.center) || { x: 0, z: 0 };
    const A = CBZ.city && CBZ.city.annex;
    const R = 70;   // step out from centre into the quadrant
    switch (dk) {
      case "uptown":     return { x: c.x + R, z: c.z - R };
      case "projects":   return { x: c.x - R, z: c.z + R };
      case "waterfront": return { x: c.x + R, z: c.z + R };
      case "island":     return A ? { x: A.cx, z: A.cz } : { x: c.x, z: c.z };
      default:           return { x: c.x - R, z: c.z - R };   // downtown
    }
  }
  // Who owns the player's current crew? (turf uses the string id "player".)
  function playerGangId() {
    const pg = g.playerGang;
    if (pg && pg.founded) return pg.id || "player";
    return g.playerGangId || null;
  }
  // Turf relationship of a district to the player: "home" (you own it),
  // "allied", "rival" (an enemy crew holds it), or "neutral".
  function turfStanding(dk) {
    if (!CBZ.cityZoneOwner) return "neutral";
    const a = districtAnchor(dk);
    const owner = CBZ.cityZoneOwner(a.x, a.z);
    if (!owner) return "neutral";
    const me = playerGangId();
    if (me && owner === me) return "home";
    if (me && CBZ.cityAreAllied && CBZ.cityAreAllied(me, owner)) return "allied";
    if (me && CBZ.cityAtWar && CBZ.cityAtWar(me, owner)) return "rival";
    // any non-player owner with no explicit relation: mildly hostile ground
    return owner === "player" ? "home" : "rival";
  }
  // Sell-side margin multiplier for a district given who controls it. Home turf
  // pays you the best (your protection, your prices, no tax to a rival); a rival
  // block skims you. This is the real reward for TAKING territory.
  function turfSellMult(dk) {
    switch (turfStanding(dk)) {
      case "home":   return 1.22;   // your block, your cut
      case "allied": return 1.08;   // friendly ground
      case "rival":  return 0.82;   // they tax outsiders / squeeze you
      default:       return 1.0;
    }
  }
  // Buy-side: sourcing wholesale on turf you control is cheaper (your supplier,
  // your terms); a rival's connect gouges you. Inverse-ish of the sell side, so
  // owning supply districts cheap + selling on demand districts is the loop.
  function turfBuyMult(dk) {
    switch (turfStanding(dk)) {
      case "home":   return 0.86;   // friends-and-family wholesale
      case "allied": return 0.94;
      case "rival":  return 1.18;   // rival connect taxes you hard
      default:       return 1.0;
    }
  }
  // bust-risk multiplier other modules (careers.js) can fold in: rival ground is
  // dangerous, your own block is covered.
  function turfRiskMult(dk) {
    switch (turfStanding(dk || playerDistrict())) {
      case "home":   return 0.5;
      case "allied": return 0.8;
      case "rival":  return 1.9;
      default:       return 1.0;
    }
  }

  // Per-district, per-drug live price-level state (mean-reverts to baseline).
  function initMarket() {
    g.cityDrugMkt = { Weed: 1, Coke: 1, Meth: 1, Pills: 1 };   // legacy global (kept for compat)
    g.cityDrugNoise = 1;
    const lvl = {};
    for (const dk of DISTRICT_KEYS) { lvl[dk] = {}; for (const d of DRUGS) lvl[dk][d] = 1; }
    g.cityDrugDist = lvl;
    // a rolling "hot tip": one district pays a big premium for one drug for a
    // limited window (Chinatown-Wars dealer tip-offs). null until first event.
    g.cityDrugTip = null;
    g.cityMktClock = 0;
  }
  function distLevels(dk) {
    if (!g.cityDrugDist) initMarket();
    if (!g.cityDrugDist[dk]) { g.cityDrugDist[dk] = {}; for (const d of DRUGS) g.cityDrugDist[dk][d] = 1; }
    return g.cityDrugDist[dk];
  }

  // The wholesale (buy) price you pay the trap house — also district-aware and
  // supply-driven, so a glutted district is cheap to source from. Baseline is
  // 0.8× value; oversupply (level<1) drops it, scarcity (level>1) raises it.
  function wholesalePrice(drug, dk) {
    const it = ITEMS[drug]; if (!it || it.tag !== "drug") return it ? Math.round(it.value * 0.8) : 0;
    dk = dk || playerDistrict();
    const lv = distLevels(dk)[drug] != null ? distLevels(dk)[drug] : 1;
    // wholesale tracks the level but is dampened (the supplier keeps a margin):
    // a GLUTTED block (lv<1) dumps cheap, a DRY block (lv>1) charges scarcity.
    const supply = 0.6 + 0.4 * lv;
    // Territory: your own supply connect is cheap, a rival's gouges you. This is
    // half the arbitrage — buy where you control, sell where they pay.
    const turf = turfBuyMult(dk);
    return Math.max(1, Math.round(it.value * 0.8 * supply * turf));
  }

  // What a street buyer pays you for one unit, here & now. Combines:
  //   value × retail markup × district demand × live level × heat × tip × noise
  function streetPrice(drug, dk) {
    const it = ITEMS[drug]; if (!it || it.tag !== "drug") return 0;
    dk = dk || playerDistrict();
    const D = DISTRICTS[dk] || DISTRICTS.downtown;
    const lv = distLevels(dk)[drug] != null ? distLevels(dk)[drug] : 1;
    const demand = (D.demand[drug] || 1) * D.tier;             // neighbourhood appetite + wealth
    // HEAT as a RISK PREMIUM: a hot block has fewer dealers willing to work it,
    // so product on the street gets SCARCER and pricier — up to a point. Past a
    // few stars the buyers themselves get spooked and it caves. Net: a gentle
    // bump (risk premium) then a fall (panic), so working hot is a real gamble.
    const w = g.wanted | 0;
    const risk = w <= 3 ? (1 + 0.06 * w) : (1.18 - 0.10 * (w - 3));
    const noise = 0.86 + rng() * 0.42;                         // per-deal haggling
    const retail = 2.15;                                       // street markup over wholesale
    const turf = turfSellMult(dk);                             // your block pays best
    let tip = 1;
    const t = g.cityDrugTip;
    if (t && t.dk === dk && t.drug === drug && (CBZ.now == null || CBZ.now < t.until)) tip = t.mult;
    const p = it.value * retail * demand * lv * Math.max(0.45, risk) * turf * tip * noise;
    return Math.max(1, Math.round(p));
  }

  // Selling DUMPS product into the local district: price level drops (more so
  // for bigger dumps — diminishing the deeper you flood). Recovers over time.
  function recordSale(drug, n, dk) {
    if (!g.cityDrugDist) initMarket();
    dk = dk || playerDistrict();
    n = n || 1;
    const lvl = distLevels(dk);
    const cur = lvl[drug] != null ? lvl[drug] : 1;
    const flood = (E.drugFlood || 0.14) * n * (0.5 + 0.5 * cur);   // bites harder near baseline
    lvl[drug] = Math.max(0.32, cur - flood);
    // a small ripple to neighbouring districts (regional glut)
    for (const k of DISTRICT_KEYS) if (k !== dk) { const v = distLevels(k); v[drug] = Math.max(0.4, (v[drug] != null ? v[drug] : 1) - flood * 0.18); }
    // dumping a big load with heat on you risks a bust tip-off (handled by
    // careers.js); record demand satisfaction so prices sag here.
    g.cityDrugMkt[drug] = Math.max(0.35, (g.cityDrugMkt[drug] != null ? g.cityDrugMkt[drug] : 1) - (E.drugFlood || 0.14) * n);
  }
  // Buying wholesale DRAINS supply here → local scarcity lifts the level a bit
  // (so panic-buying a district's whole stock pushes prices up).
  function recordBuy(drug, n, dk) {
    if (!g.cityDrugDist) initMarket();
    dk = dk || playerDistrict();
    n = n || 1;
    const lvl = distLevels(dk);
    const cur = lvl[drug] != null ? lvl[drug] : 1;
    lvl[drug] = Math.min(2.4, cur + (E.drugFlood || 0.14) * 0.5 * n);
  }

  // The best place to OFF-LOAD a drug right now (for HUD hints / tips).
  function bestMarket(drug) {
    let best = null, bp = -1;
    for (const dk of DISTRICT_KEYS) { const p = streetPriceNoNoise(drug, dk); if (p > bp) { bp = p; best = dk; } }
    return { dk: best, name: districtName(best), price: bp };
  }
  function streetPriceNoNoise(drug, dk) {
    const it = ITEMS[drug]; if (!it || it.tag !== "drug") return 0;
    const D = DISTRICTS[dk] || DISTRICTS.downtown;
    const lv = distLevels(dk)[drug] != null ? distLevels(dk)[drug] : 1;
    const demand = (D.demand[drug] || 1) * D.tier;
    const turf = turfSellMult(dk);
    let tip = 1; const t = g.cityDrugTip;
    if (t && t.dk === dk && t.drug === drug && (CBZ.now == null || CBZ.now < t.until)) tip = t.mult;
    return Math.round(it.value * 2.15 * demand * lv * turf * tip);
  }
  // current tip-off, if active (careers/HUD can surface it as "word on the street")
  function activeTip() {
    const t = g.cityDrugTip;
    if (t && (CBZ.now == null || CBZ.now < t.until)) return t;
    return null;
  }

  // ---- market drift: recovery + boom/bust events + rolling hot tips --------
  CBZ.onUpdate(30, function (dt) {
    if (g.mode !== "city") return;
    if (!g.cityDrugDist) return;
    const drift = (E.drugDrift || 0.05) * dt;
    // every district recovers toward its demand-shaped fair level (≈1)
    for (const dk of DISTRICT_KEYS) {
      const lvl = g.cityDrugDist[dk];
      for (const d of DRUGS) lvl[d] += (1 - lvl[d]) * drift;
    }
    // keep the legacy global level alive too (other code may read it)
    for (const k in g.cityDrugMkt) g.cityDrugMkt[k] += (1 - g.cityDrugMkt[k]) * drift;

    // expire / roll a hot tip-off. A new one fires every ~35–70s: one district
    // suddenly pays a premium for one drug for ~20–40s. Sell into the spike.
    g.cityMktClock = (g.cityMktClock || 0) + dt;
    const tip = g.cityDrugTip;
    const expired = !tip || (CBZ.now != null && CBZ.now >= tip.until);
    if (expired && g.cityMktClock > (tip ? 12 : 8)) {
      if (rng() < dt * 0.06) {            // sparse: a real "word on the street" moment
        const dk = DISTRICT_KEYS[(rng() * DISTRICT_KEYS.length) | 0];
        const drug = DRUGS[(rng() * DRUGS.length) | 0];
        const mult = 1.6 + rng() * 1.1;   // 1.6×–2.7× premium
        const dur = (20 + rng() * 22) * 1000;   // CBZ.now is in ms
        g.cityDrugTip = { dk, drug, mult, until: (CBZ.now || 0) + dur, started: CBZ.now || 0 };
        g.cityMktClock = 0;
        // also create the scarcity that justifies the premium
        const lvl = distLevels(dk); lvl[drug] = Math.min(2.6, lvl[drug] + 0.6);
        if (CBZ.city && CBZ.city.note) {
          CBZ.city.note("Word on the street: " + DISTRICTS[dk].name + " is paying big for " + drug + ".", 2.6);
        }
      }
    }
  });

  // ---- realistic cash on a person, by wealth tier (0 poor .. 1 rich) -------
  function rollCash(wealth) {
    wealth = wealth == null ? rng() : wealth;
    // most people carry < $60; the wealthy carry a few hundred; a rare WHALE
    // is walking around with an insane wad — you just can't tell until you rob them.
    if (wealth > 0.985) return 1500 + ((rng() * 8500) | 0);    // whale ($1.5k–$10k)
    if (wealth < 0.15) return (rng() * 12) | 0;                 // broke
    if (wealth < 0.6) return 8 + ((rng() * 55) | 0);            // average
    if (wealth < 0.88) return 40 + ((rng() * 180) | 0);         // comfortable
    return 120 + ((rng() * 520) | 0);                          // wealthy
  }

  // ============================================================
  //  THE WEALTH CATALOG — realistic cash + carried valuables BY WHO YOU ARE
  // ------------------------------------------------------------
  //  Two helpers peds.js calls when it spawns a person: rollCashFor (loose cash
  //  in their pocket, keyed to their archetype) and rollValuables (the array of
  //  jewellery/loot they're carrying). The whole point: most people are broke
  //  and carry nothing worth fencing — but a rare tycoon is walking around with
  //  a Richard Mille, and a socialite with a ring you could retire on. The MEGA
  //  items stay RARE so getting insanely rich is a JACKPOT, not the norm.
  // ------------------------------------------------------------
  //  Both accept an optional `rng` (a function returning [0,1)) so a caller can
  //  drive them off its own deterministic stream; otherwise they use ours.
  // ============================================================
  function archKey(archetype) { return ("" + (archetype || "")).toLowerCase(); }
  function randIn(R, lo, hi) { return lo + ((R() * (hi - lo + 1)) | 0); }

  // Cash on a person, by who they are. Archetype wins when it implies wealth;
  // otherwise we fall back to the wealth tier (0 poor .. 1 rich). Ranges follow
  // the contract: poor $5–40, normal $20–200, well-off $300–2000, dealer
  // $1.5k–15k, mobster/made $5k–40k, boss/tycoon $10k–90k.
  function rollCashFor(archetype, wealth, rng2) {
    const R = (typeof rng2 === "function") ? rng2 : rng;
    const a = archKey(archetype);
    // a boss's / tycoon's WIFE carries head-of-household money too (fat clutch of
    // cash on top of the seven-figure jewellery), so she's boss-tier to rob.
    if (a === "mobwife" || a === "mob-wife" || a === "bosswife" || a === "kingpinwife" || a === "tycoonwife")
      return randIn(R, 8000, 60000);
    if (a === "tycoon" || a === "billionaire" || a === "boss" || a === "kingpin")
      return randIn(R, 10000, 90000);
    if (a === "mobster" || a === "made" || a === "underboss" || a === "capo")
      return randIn(R, 5000, 40000);
    if (a === "dealer" || a === "kingpin" || a === "trapper")
      return randIn(R, 1500, 15000);
    if (a === "socialite" || a === "tourist" || a === "merchant" || a === "watcher")
      return randIn(R, 300, 2000);           // well-off
    if (a === "panhandler" || a === "junkie" || a === "homeless")
      return randIn(R, 5, 40);               // poor
    // generic resident/jogger/busker etc.: let wealth decide the tier.
    if (wealth != null) {
      if (wealth >= 0.97) return randIn(R, 10000, 90000);   // a hidden whale
      if (wealth >= 0.88) return randIn(R, 300, 2000);      // well-off
      if (wealth >= 0.6)  return randIn(R, 40, 300);        // comfortable
      if (wealth < 0.15)  return randIn(R, 5, 40);          // broke
    }
    return randIn(R, 20, 200);               // normal
  }

  // The array of VALUABLE item NAMES a ped is carrying. Most people: none, or a
  // Phone/Wallet at low wealth. The luxury archetypes carry the catalog's crown
  // jewels — but the mega-items (Patek/RM/Engagement Ring/Bearer Bonds) are RARE
  // rolls so they stay a jackpot. Returns [] for the broke majority.
  function rollValuables(archetype, wealth, rng2) {
    const R = (typeof rng2 === "function") ? rng2 : rng;
    const a = archKey(archetype);
    const out = [];
    const w = wealth == null ? 0.4 : wealth;

    // TYCOON / BILLIONAIRE → a luxury WATCH. Omega common, AP rarer, Patek rare,
    // Richard Mille the rarest of all (a true once-in-a-run jackpot). Plus a
    // chance at a Briefcase of Cash, and a slim shot at Bearer Bonds / Art.
    if (a === "tycoon" || a === "billionaire") {
      const r = R();
      if (r < 0.015) out.push("Richard Mille");        // 1.5% — the unicorn
      else if (r < 0.07) out.push("Patek Philippe");   // ~5.5%
      else if (r < 0.27) out.push("Audemars Piguet");  // ~20%
      else out.push("Omega");                          // the rest: still a $4k watch
      if (R() < 0.12) out.push("Briefcase of Cash");
      if (R() < 0.03) out.push("Bearer Bonds");        // rare mega
      if (R() < 0.04) out.push("Art Piece");
      return out;
    }

    // MOB WIFE / KINGPIN'S WIFE → the JACKPOT target. The wife of a mob boss (or a
    // tycoon's spouse) is a walking vault: she carries the $5M Engagement Ring, a
    // Diamond Necklace AND a Tennis Bracelet for certain, plus a strong shot at a
    // $1.2M Diamond Tiara and a Designer Bag. Clipping/robbing her is several
    // million in ice in one go — but (see social.js) the whole crew hunts you for
    // it. Her wealth is proportional to her husband: she's loaded BECAUSE he is.
    if (a === "mobwife" || a === "mob-wife" || a === "bosswife" || a === "kingpinwife") {
      out.push("Engagement Ring");                     // the $5M rock — guaranteed
      out.push("Diamond Necklace");                    // +$250k
      out.push("Tennis Bracelet");                     // +$60k
      if (R() < 0.5) out.push("Diamond Tiara");        // +$1.2M, half the time
      if (R() < 0.7) out.push("Designer Bag");         // +$6k
      return out;
    }

    // SOCIALITE / RICH WOMAN → an Engagement Ring (mega, kept RARE) + sometimes a
    // Designer Bag and a Diamond Necklace. A tycoon's WIFE rolls richer than a
    // street socialite — she's far likelier to be carrying the ring + the tiara.
    if (a === "socialite" || a === "richwoman" || a === "rich woman" || a === "heiress" || a === "tycoonwife") {
      const wife = (a === "tycoonwife");
      if (R() < (wife ? 0.55 : 0.06)) out.push("Engagement Ring");     // tycoon's wife: usually carries the rock
      else if (R() < 0.30) out.push("Diamond Necklace");
      else if (R() < 0.50) out.push("Tennis Bracelet");
      if (wife && R() < 0.30) out.push("Diamond Tiara");
      if (R() < 0.45) out.push("Designer Bag");
      return out;
    }

    // DEALER / MOBSTER / MADE / BOSS → street ice: a Gold Chain, maybe a Rolex,
    // and the bosses sometimes a Briefcase of Cash.
    if (a === "dealer" || a === "mobster" || a === "made" || a === "boss" ||
        a === "underboss" || a === "capo" || a === "trapper" || a === "kingpin") {
      if (R() < 0.7) out.push("Gold Chain");
      if (R() < 0.35) out.push("Rolex");
      const bossish = (a === "boss" || a === "underboss" || a === "kingpin" || a === "made");
      if (bossish && R() < 0.18) out.push("Briefcase of Cash");
      if (bossish && R() < 0.04) out.push("Diamond Necklace");
      return out;
    }

    // WELL-OFF generic (high wealth, ordinary archetype) → maybe a Rolex or a
    // Diamond Necklace, occasionally a Tennis Bracelet. Rarely a hidden whale's
    // Audemars.
    if (w >= 0.88 || a === "merchant" || a === "tourist") {
      const r = R();
      if (r < 0.03 && w >= 0.95) out.push("Audemars Piguet");  // hidden whale
      else if (r < 0.10) out.push("Diamond Necklace");
      else if (r < 0.22) out.push("Rolex");
      else if (r < 0.34) out.push("Tennis Bracelet");
      if (R() < 0.30) out.push("Phone");
      return out;
    }

    // EVERYONE ELSE: mostly nothing. A Phone is the common "score"; the broke
    // sometimes have a Wallet (the truly poor have neither).
    if (w >= 0.4 && R() < 0.35) out.push("Phone");
    else if (R() < 0.18) out.push(w < 0.2 ? "Wallet" : "Phone");
    return out;
  }

  // ============================================================
  //  WEALTH TIERS, FAUCETS & SINKS — make money MEANINGFUL
  // ------------------------------------------------------------
  //  A player's total NET WORTH (cash + bank + property + cars + worn ice)
  //  places them in a tier: broke → hustler → comfortable → rich → KINGPIN.
  //  Tiers gate flavour, drive the cost of luxury sinks (which scale with how
  //  rich you are, the elastic-sink trick that keeps high earners spending),
  //  and let other modules react ("the kingpin walks in"). NET WORTH is the
  //  scoreboard, not raw cash.
  // ============================================================
  const TIERS = [
    { id: "broke",       name: "Broke",        min: 0,        color: "#8a93a3" },
    { id: "hustler",     name: "Hustler",      min: 2500,     color: "#9fd07e" },
    { id: "comfortable", name: "Comfortable",  min: 25000,    color: "#7fd0ff" },
    { id: "rich",        name: "Rich",         min: 150000,   color: "#ffd166" },
    { id: "baller",      name: "Baller",       min: 600000,   color: "#ff9e6b" },
    { id: "kingpin",     name: "KINGPIN",      min: 2500000,  color: "#ff5d7e" },
  ];
  // total value of items the player is carrying (jewellery, valuables, drugs)
  function invWorth() {
    const inv = g.cityInv || {}; let s = 0;
    for (const k in inv) { const it = ITEMS[k]; if (it && it.value) s += it.value * inv[k] * (it.tag === "drug" ? 1.5 : 1); }
    return s | 0;
  }
  // property + business equity, asked from zillow/empire if present
  function holdingsWorth() {
    let s = 0;
    if (CBZ.cityZillow && CBZ.cityZillow.portfolioValue) s += CBZ.cityZillow.portfolioValue() | 0;
    else if (g.cityProps) { for (const p of g.cityProps) s += (p.equity || p.value || 0); }
    if (CBZ.cityEmpire && CBZ.cityEmpire.bizValue) s += CBZ.cityEmpire.bizValue() | 0;
    if (g.cityGarage) { for (const c of g.cityGarage) { const car = carByName(c.name || c); if (car) s += (car.value * 0.85) | 0; } }
    return s | 0;
  }
  function netWorth() {
    return ((g.cash || 0) + (g.cityBank || 0) + invWorth() + holdingsWorth()) | 0;
  }
  function wealthTier(nw) {
    nw = nw == null ? netWorth() : nw;
    let t = TIERS[0];
    for (const x of TIERS) if (nw >= x.min) t = x;
    return t;
  }
  // 0..1 progress toward the NEXT tier (for a HUD bar)
  function tierProgress(nw) {
    nw = nw == null ? netWorth() : nw;
    let cur = TIERS[0], next = null;
    for (let i = 0; i < TIERS.length; i++) { if (nw >= TIERS[i].min) { cur = TIERS[i]; next = TIERS[i + 1] || null; } }
    if (!next) return 1;
    return Math.max(0, Math.min(1, (nw - cur.min) / (next.min - cur.min)));
  }

  // ============================================================
  //  TURF INCOME — protection / taxes off the blocks you CONTROL
  // ------------------------------------------------------------
  //  Every zone your crew holds pays a daily street tax: shops kick up
  //  protection, dealers pay rent on the corner, residents pay "insurance".
  //  Per-zone take scales with the DISTRICT'S WEALTH (uptown/island blocks are
  //  worth far more than the projects), your CREW SIZE (more soldiers = more
  //  collectors working the doors), your GANG RANK (a boss skims the whole
  //  operation; a soldier just gets a cut), and HEAT (a hot block earns less —
  //  people lie low, cops sniff around). This is the backbone faucet that makes
  //  TAKING TERRITORY the point of the game. Other modules read turfIncome().
  // ------------------------------------------------------------
  //  Map a zone's centre to the richest-matching district tier so its tax tracks
  //  neighbourhood wealth even though zones are finer-grained than districts.
  function zoneWealthMul(cx, cz) {
    const D = DISTRICTS[districtAt(cx, cz)] || DISTRICTS.downtown;
    return D.tier;                          // 0.78 (projects) .. 1.30 (island)
  }
  // crew multiplier: 1 soldier ~ base; it scales sub-linearly so a huge crew
  // doesn't print infinite money (diminishing collectors).
  function crewMul() {
    let n = 0;
    if (CBZ.cityPlayerGangMembers) { const m = CBZ.cityPlayerGangMembers(); n = (m && m.length) || 0; }
    else n = (g.cityCrew | 0);
    return 1 + 0.5 * Math.sqrt(Math.max(0, n));   // 0 crew→1×, 4→2×, 16→3×
  }
  // rank multiplier: a member of an NPC crew skims less than a boss of their own.
  function rankMul() {
    const pg = g.playerGang;
    if (pg && pg.founded) return 1.0;             // you ARE the boss → full take
    const mem = g.cityMembership;
    if (mem) {
      const r = mem.rank;
      if (r === "boss" || r === "underboss") return 0.85;
      if (r === "lt" || r === "lieutenant" || r === "capo") return 0.45;
      return 0.22;                                // soldier's cut of the street tax
    }
    return 0;                                      // no crew → no turf income
  }
  // $/sec the player earns right now from every zone their crew controls.
  function turfIncome() {
    if (!CBZ.cityZoneControl || !CBZ.cityZones) return 0;
    const me = playerGangId();
    if (!me) return 0;
    const ctrl = CBZ.cityZoneControl();
    const owned = (ctrl.byGang && ctrl.byGang[me]) || 0;
    if (owned <= 0) return 0;
    const rank = rankMul(); if (rank <= 0) return 0;
    const base = (E.turfTaxPerZone || 4.5);       // $/sec per held zone, baseline
    const crew = crewMul();
    const heatPenalty = Math.max(0.4, 1 - 0.06 * (g.wanted | 0));
    // weight each held zone by its neighbourhood wealth
    let wealthSum = 0, n = 0;
    for (const z of CBZ.cityZones()) {
      if (z.owner === me) { wealthSum += zoneWealthMul(z.cx, z.cz); n++; }
    }
    const wealthAvg = n > 0 ? wealthSum / n : 1;
    // wealth-TIER perk: a tighter, more feared operation skims more off the
    // blocks (a kingpin's tax collectors don't get shorted). Feature-detected
    // from wealth.js so economy.js stays standalone.
    const perk = (CBZ.cityWealth && CBZ.cityWealth.tierPerk) ? (CBZ.cityWealth.tierPerk("turfMul") || 1) : 1;
    return base * owned * wealthAvg * crew * rank * heatPenalty * perk;
  }
  // a HUD-friendly breakdown of where the turf money comes from
  function turfIncomeInfo() {
    const me = playerGangId();
    const ctrl = (me && CBZ.cityZoneControl) ? CBZ.cityZoneControl() : { byGang: {}, total: 0 };
    const owned = (ctrl.byGang && ctrl.byGang[me]) || 0;
    return { zones: owned, total: ctrl.total || 0, perSec: Math.round(turfIncome()), crewMul: crewMul(), rankMul: rankMul() };
  }

  // ---- HIGH-VALUE FAUCETS (let a hustler actually get filthy rich) ---------
  // A risk-scaled cash drop for big scores (heist, robbery, kill bounty). The
  // payout scales with how RISKY it was (heat) and your respect (rep = access
  // to bigger jobs), so a kingpin's scores dwarf a rookie's. This is the faucet
  // that funds the climb — other modules call it for their reward amounts.
  function scoreReward(base, opts) {
    opts = opts || {};
    const heatMul = 1 + 0.10 * (g.wanted | 0);                 // riskier = richer
    const repMul = 1 + Math.min(1.4, (g.respect || 0) / 400);  // rep unlocks bigger paydays
    const luck = 0.85 + rng() * 0.4;
    let v = base * heatMul * repMul * luck;
    if (opts.tier) v *= (1 + 0.25 * (wealthTier().min > 0 ? TIERS.indexOf(wealthTier()) : 0));
    return Math.max(1, Math.round(v));
  }

  // ---- SERIOUS MONEY SINKS (so wealth stays meaningful) --------------------
  // Luxury / vanity sinks PRICE UP with your net worth (an elastic sink — the
  // richer you are, the more it costs to flex), which keeps draining whales so
  // money never becomes infinite & worthless. Other modules query these.
  const SINKS = {
    // a night out / bottle service / flexing — pure vanity drain
    bottleService(nw) { nw = nw == null ? netWorth() : nw; return Math.max(250, Math.round(250 + nw * 0.01)); },
    // daily property TAX as a fraction of holdings (recurring drain on the rich)
    propertyTaxRate: 0.00008,  // light background upkeep; Zillow owns property cashflow
    // bribing the cops scales with how much you're worth (they smell money) —
    // but your wealth-TIER perk (bribeDisc, from wealth.js) shaves it down: a
    // kingpin has cops on payroll, so money literally talks.
    bribeCost(stars, nw) {
      nw = nw == null ? netWorth() : nw;
      const base = (E.bribeBase || 150) * Math.max(1, stars || 1);
      let cost = base * (1 + Math.min(3, nw / 400000));
      const disc = (CBZ.cityWealth && CBZ.cityWealth.tierPerk) ? (CBZ.cityWealth.tierPerk("bribeDisc") || 0) : 0;
      cost *= (1 - Math.min(0.6, disc));
      return Math.max(1, Math.round(cost));
    },
    // hospital / repair / re-arm after a death — a sink that bites the careless
    medicalBill(nw) { nw = nw == null ? netWorth() : nw; return Math.max(200, Math.round(200 + nw * 0.004)); },
    // launder dirty cash: you lose a cut but it becomes safe (bank). The cut
    // SHRINKS as you build laundering infrastructure (businesses) — a real sink
    // that also rewards investing in the empire.
    launderCut() {
      let cut = 0.25;
      if (CBZ.cityEmpire && CBZ.cityEmpire.laundromats) cut -= 0.03 * (CBZ.cityEmpire.laundromats() | 0);
      return Math.max(0.06, cut);
    },
  };
  // Recurring tax/upkeep drain on the wealthy — called by the wage/income tick
  // (careers.js). Returns the $ to deduct this tick; keeps the rich spending.
  function upkeepDue() {
    const h = holdingsWorth();
    if (h <= 0) return 0;
    return Math.round(h * SINKS.propertyTaxRate);
  }
  // Convert dirty street cash to safe banked cash, minus a laundering haircut.
  // Returns { banked, lost } and applies it. A core sink for drug profits.
  function launder(amount) {
    amount = Math.max(0, amount | 0);
    if (amount <= 0) return { banked: 0, lost: 0 };
    const cut = SINKS.launderCut();
    const lost = Math.round(amount * cut);
    const banked = amount - lost;
    if (CBZ.city && CBZ.city.spend) CBZ.city.spend(amount); else g.cash = Math.max(0, (g.cash || 0) - amount);
    g.cityBank = (g.cityBank || 0) + banked;
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return { banked, lost };
  }
  // a wallet/phone you might lift in addition to loose cash
  function rollWallet(wealth) {
    const cash = rollCash(wealth);
    let item = null;
    const r = rng();
    if (wealth > 0.8 && r < 0.5) item = ["Phone", "Cash Stack", "Rolex", "Laptop"][(rng() * 4) | 0];
    else if (r < 0.3) item = ["Wallet", "Phone", "Sunglasses"][(rng() * 3) | 0];
    return { cash, item };
  }

  // ---- car helpers ----------------------------------------------------------
  function pickCar(rare) {
    // rarity-weighted: bias toward common unless `rare` asks for the good stuff
    // (deliberately CARS-only, never SPECIAL_VEHICLES — a boat has no business
    // rolling up as random street traffic or a random garage pull; see the
    // SPECIAL_VEHICLES comment above)
    const r = rare ? Math.pow(rng(), 0.4) : Math.pow(rng(), 2.2);  // skew
    // map r∈[0,1] onto the rarity-sorted list
    let best = CARS[0], bd = 9;
    for (const c of CARS) { const d = Math.abs(c.rarity - r); if (d < bd) { bd = d; best = c; } }
    return best;
  }
  // Resolve a model by name across BOTH catalogs — ordinary cars first (the
  // common case), then the special (motorcycle/boat) roster, so callers like
  // world.js's harbor (carByName("Speedboat")) and any future named-motorcycle
  // spawn get one lookup function regardless of which array actually holds it.
  function carByName(name) {
    return CARS.find((c) => c.name === name) || SPECIAL_VEHICLES.find((c) => c.name === name) || CARS[0];
  }

  // ---- the city PROPERTY market index --------------------------------------
  // A single macro index that drifts slowly around 1.0. Zillow multiplies every
  // listing's base estimate by this index so values can move over a run without
  // twitching every frame.
  const MKT = {
    floor: 0.90, ceil: 1.14,     // housing should drift, not arcade-pulse
    sample: 18,                  // seconds between market samples
    revert: 0.018,               // pull back toward fair value per sample
    vol: 0.004,                  // small sample impulse
    momentumDecay: 0.62,
  };
  function initPropMarket() {
    g.cityPropMkt = { index: 1, momentum: 0, trend: "steady", sampleT: 0, shockT: 240 + rng() * 180, history: [1] };
  }
  function propMarket() { if (!g.cityPropMkt) initPropMarket(); return g.cityPropMkt; }
  // current macro multiplier applied to every property's base value
  function propIndex() { return propMarket().index; }
  function stepPropMarket(dt) {
    const m = propMarket();
    m.sampleT = (m.sampleT || 0) + dt;
    if (m.sampleT < MKT.sample) return;
    const elapsed = Math.min(90, m.sampleT);
    m.sampleT = 0;
    const scale = Math.max(0.25, Math.min(2, elapsed / 60));
    // mean reversion toward 1.0
    let v = (1 - m.index) * MKT.revert * scale;
    m.momentum = m.momentum * MKT.momentumDecay + (rng() - 0.5) * MKT.vol * scale;
    v += m.momentum;
    // rare, mild neighborhood headline. No boom/bust slot-machine swings.
    m.shockT -= elapsed;
    if (m.shockT <= 0) {
      m.shockT = 240 + rng() * 240;
      const shock = (rng() - 0.5) * 0.018;
      m.momentum += shock;
    }
    m.index = Math.max(MKT.floor, Math.min(MKT.ceil, m.index + v));
    m.trend = m.momentum > 0.0015 ? "rising" : m.momentum < -0.0015 ? "falling" : "steady";
    if (CBZ.now != null) {
      const h = m.history;
      if (!h._t || CBZ.now - h._t > 30000) { h._t = CBZ.now; h.push(m.index); if (h.length > 40) h.shift(); }
    }
  }
  // mortgage / finance terms (used by zillow.js for financed buys)
  const FINANCE = {
    minDownFrac: 0.20,    // smallest down payment on a financed purchase
    rate: 0.06,           // periodic interest charged on the outstanding balance
    minPaymentFrac: 0.04, // minimum principal+interest payment per finance tick
    maxLTV: 0.80,         // most you can borrow vs. value (1 - minDown)
  };

  CBZ.onUpdate(30.2, function (dt) {
    if (g.mode !== "city") return;
    stepPropMarket(dt);
  });

  // ---- recurring upkeep/tax drain on the wealthy (a real money SINK) -------
  // Once you own property/business, you owe upkeep + tax every payTick. This
  // keeps the rich from sitting on a static pile — money must keep MOVING.
  CBZ.onUpdate(30.4, function (dt) {
    if (g.mode !== "city") return;
    g._upkeepClock = (g._upkeepClock || 0) + dt;
    const tick = (E.payTick || 6);
    if (g._upkeepClock < tick) return;
    g._upkeepClock -= tick;
    const due = upkeepDue();
    if (due > 0) {
      const bank = g.cityBank || 0;
      if (bank >= due) { g.cityBank = bank - due; }
      else { g.cityBank = 0; if (CBZ.city && CBZ.city.spend) CBZ.city.spend(due - bank); }
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    }
  });

  // ---- TURF INCOME PAYOUT (the protection/tax faucet) ----------------------
  // Pay out the held-turf street tax every payTick. Accumulates fractional cash
  // so even a one-zone crew eventually gets paid, and surfaces a one-line note
  // on the first collection so the player learns the loop. CHEAP: one timer,
  // gated to city mode + actually holding turf.
  let _turfShown = false;
  CBZ.onUpdate(30.6, function (dt) {
    if (g.mode !== "city") return;
    const rate = turfIncome();
    if (rate <= 0) { g._turfAcc = 0; return; }
    g._turfClock = (g._turfClock || 0) + dt;
    const tick = (E.payTick || 6);
    if (g._turfClock < tick) return;
    g._turfClock -= tick;
    g._turfAcc = (g._turfAcc || 0) + rate * tick;
    const pay = Math.floor(g._turfAcc);
    if (pay >= 1) {
      g._turfAcc -= pay;
      if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(pay);
      g.cityTurfEarned = (g.cityTurfEarned || 0) + pay;
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
      if (!_turfShown && CBZ.city && CBZ.city.note) {
        _turfShown = true;
        const info = turfIncomeInfo();
        CBZ.city.note("💰 Street tax from your " + info.zones + " block" + (info.zones === 1 ? "" : "s") + ": +$" + pay + ".", 3);
      }
    }
  });

  // ---- H4: THE CITY-WIDE RENT TICK (the WHY behind every job) --------------
  // housing.js leases EVERY resident a real micro-unit; this is the faucet/sink
  // side of that lease. Once per ~45s we sum the rent owed by all OCCUPIED
  // units in CBZ.cityHousing and move the money the way a real city does:
  //   • a unit in a building the PLAYER owns → that rent is INCOME (your
  //     tenants pay you): credited via CBZ.city.addCash with a throttled note.
  //   • every OTHER unit → a pure world SINK: the cash leaves the NPC's pocket
  //     to an off-screen landlord and never touches g.cash. This is the
  //     Cities:Skylines money sink that stops NPC wallets ballooning, and it's
  //     what makes "rent is due" a felt pressure rather than a UI number.
  // SCOPE: strictly cityHousing units — it never double-collects against
  // zillow's portfolio faucet (that pays off g.cityTenants[rec.id] LISTING
  // records, a separate player rent-out layer; zillow already skips the player's
  // own residence, and these per-floor micro-units are not zillow recs at all).
  // CHEAP: one accumulator, the units array walked once per cycle, early-out
  // when housing is absent. WHY (codebase voice): a corner is worth holding
  // because the 1st of the month always comes.
  const RENT_TICK = 45;          // seconds between city-wide rent cycles
  let _rentNoteShown = false;    // throttle the player "rent collected" note
  CBZ.cityRentTick = function (dt) {
    if (g.mode !== "city") return;
    const H = CBZ.cityHousing;
    if (!H || !H.units) return;                  // housing layer absent → no-op
    g._cityRentClock = (g._cityRentClock || 0) + (dt || 0);
    if (g._cityRentClock < RENT_TICK) return;
    g._cityRentClock -= RENT_TICK;
    let units;
    try { units = H.units(); } catch (e) { return; }
    if (!units || !units.length) return;
    let ownerIncome = 0;                          // rent owed to the PLAYER
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      const occ = u.occupant;
      if (!occ || occ.dead) continue;             // empty/dead → no rent flows
      const rent = u.rent || 0;
      if (rent <= 0) continue;
      // does the PLAYER own this building? (home.owned flag set by realestate/
      // zillow, or an explicit player owner record). Their tenants pay them.
      const b = u.lot && u.lot.building;
      const home = b && b.home;
      const owner = b && b.owner;
      const playerOwned = !!(home && home.owned) || !!(owner && owner.type === "player");
      if (playerOwned) {
        ownerIncome += rent;
      }
      // OPTIONAL flavour (guarded HARD): nick the rent off the NPC's own wallet
      // so a broke ped reads as 'behind on rent'. Only when a numeric wallet
      // already exists (most peds carry ped.cash) — we never invent one, never
      // let an NPC go negative, and it's a modest debit so it's a pressure not a
      // wipe. This is the sink made personal: the money left their pocket.
      if (typeof occ.cash === "number" && occ.cash > 0) {
        const pay = Math.min(occ.cash, Math.max(1, Math.round(rent * 0.5)));
        occ.cash -= pay;
        occ._rentDue = Math.max(0, (occ._rentDue | 0) + (rent - pay));   // shortfall = how far behind
      } else if (typeof occ.cash === "number") {
        // already broke → the arrears climb (read elsewhere as 'behind').
        occ._rentDue = (occ._rentDue | 0) + rent;
      }
    }
    if (ownerIncome > 0 && CBZ.city && CBZ.city.addCash) {
      const credited = Math.round(ownerIncome);
      CBZ.city.addCash(credited);
      if (!_rentNoteShown && CBZ.city.note) {
        _rentNoteShown = true;                    // one-time teach, then the HUD carries it
        CBZ.city.note("Rent collected from your tenants: +$" + credited + ".", 3);
      }
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    }
  };
  // drive the rent tick from the city onUpdate (own slot, after the other
  // money ticks). Gated to city mode inside the function above.
  CBZ.onUpdate(30.8, function (dt) { CBZ.cityRentTick(dt); });

  // --- the EQUIPPED-OUTFIT / DRIP API (the foundation everything else reads) --
  // Top-level globals so club.js (bouncer), shops.js (boutique equips on buy),
  // and hud.js (DRIP stat) can call them directly. cityPlayerDrip is the
  // PLAYER's status (equipped outfit); econ.drip stays the legacy whole-inv sum.
  CBZ.cityEquip = function (name) { return equip(name); };
  CBZ.cityUnequip = function (slotOrName) { return unequip(slotOrName); };
  CBZ.cityPlayerDrip = function () { return playerDrip(); };
  CBZ.cityIsEquipped = function (name) { return isEquipped(name); };
  CBZ.cityOutfitSlots = function () { return SLOTS.slice(); };
  // Reset hook for a new run (mode.js / worldstate reset should call this so the
  // worn outfit clears with the rest of city state — see "issues").
  CBZ.cityResetOutfit = function () { resetOutfit(); };

  // ============================================================
  //  AIRPOWER PRICES — the apex of the empire.
  // ------------------------------------------------------------
  //  The F-22 RAPTOR is the most expensive thing in the game: a $3M jet you can
  //  only base once you own the penthouse + its HANGAR. The actual purchase
  //  charge lives in playeraircraft.js / realestate (they read JET_PRICE here);
  //  economy.js just owns the number so the price is consistent everywhere.
  //  MISSILE_RESUPPLY is the cost to rearm one "Air-to-Ground Missile" crate.
  // ============================================================
  const JET_PRICE = 3000000;                              // $3,000,000 — the F-22 Raptor
  const MISSILE_RESUPPLY = ITEMS["Air-to-Ground Missile"].value;   // $/crate to rearm airpower

  CBZ.cityEcon = {
    ITEMS, SHOP_STOCK, CARS, SPECIAL_VEHICLES, rng,
    // --- airpower prices (the F-22 + its rearm) ---
    JET_PRICE, MISSILE_RESUPPLY,
    add, has, count, take, drip, buyPrice, sellPrice, wholesalePrice,
    // composable wardrobe catalog (contract C): tag-filtered item records
    itemsByTag,
    // equipped-outfit drip model
    SLOTS, equip, unequip, slotOf, isEquipped, outfit, resetOutfit, playerDrip,
    stockFor(kind) { return SHOP_STOCK[kind] || []; },
    streetPrice, recordSale, recordBuy, initMarket,
    rollCash, rollCashFor, rollValuables, rollWallet, pickCar, carByName,
    // --- living street market (supply & demand, per district) ---
    DISTRICTS, districtAt, districtAtPos, districtName, playerDistrict,
    bestMarket, activeTip, fenceBonus, bumpFenceRep,
    // --- territory → margins + risk + the turf-tax faucet ---
    turfStanding, turfSellMult, turfBuyMult, turfRiskMult, playerGangId,
    turfIncome, turfIncomeInfo,
    // --- wealth tiers, faucets & sinks ---
    TIERS, netWorth, invWorth, holdingsWorth, wealthTier, tierProgress,
    scoreReward, SINKS, upkeepDue, launder,
    // property market: a drifting macro index Zillow multiplies prices by
    propIndex, propMarket, initPropMarket, FINANCE,
    propTrend() { return propMarket().trend; },
    propHistory() { return propMarket().history.slice(); },
    randomLoot(rich) {
      const pool = rich
        ? ["Phone", "Wallet", "Cash Stack", "Gold Chain", "Rolex", "Laptop", "Diamond Ring"]
        : ["Wallet", "Phone", "Sunglasses", "Sneakers"];
      return pool[(rng() * pool.length) | 0];
    },
  };
})();
