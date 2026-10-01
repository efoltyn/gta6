/* ============================================================
   city/arsenal_data.js — THE ARSENAL TABLE. Pure data, no behaviour.

   OWNER: "EVERY BOMB PAYLOAD NEEDS A SPECIFIC PLANE, AND THAT NEEDS TO BE
   BOUGHT IF NOT ALREADY HAD ... YOU CAN BECOME PRESIDENT OF A SMALLER
   COUNTRY, GET NUKES, AND GET A B2, AND THEN ORDER A NUKE STRIKE." and
   "NUKE CAN BE DROPPED MAYBE BY ANOTHER LESS EXPENSIVE BOMBER ... BUT THE
   BUNKER BUSTER ... GIVES B2 AND REAL BUNKER BUSTER PAYLOAD MEANING".

   Everything about who can carry what, what it costs and what each nation
   starts with lives HERE and nowhere else. city/warroom.js reads it to gate
   orders and sell hardware; city/polwar.js seeds each nation's counted
   military (mil.planes / .heavy / .b2 / .warheads / .mops) from `start` and
   charges `upkeep` daily. A new aircraft or payload is a new row.

   MONEY is the game's own: a country treasury is $25k-$100k at the start and
   earns its taxes daily (polwar.js), so the ratios are the real ones (a B-2
   costs ~9 strike jets, a warhead is a national programme) and the totals
   are sized so a small country has to save, tax or borrow for a long time.
   DAYS are PACE days (one in-game day, 150 real seconds).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  CBZ.ARSENAL = {
    // ---- AIRCRAFT: `field` is the mil-record count it lives in; `model` is
    // the airframe the air station parks (city/island_military.js
    // CBZ.milModels / city/strategic.js CBZ.strategicModels).
    aircraft: {
      jet:   { name: "strike jet", label: "Buy jet", field: "planes", model: "jet",
               price: 30000, days: 1, upkeep: 15 },
      heavy: { name: "B-52 bomber", label: "Buy B-52", field: "heavy", model: "bomber",
               price: 90000, days: 3, upkeep: 60, bomber: true },
      b2:    { name: "B-2 bomber", label: "Buy B-2", field: "b2", model: "b2",
               price: 260000, days: 4, upkeep: 150, bomber: true },
    },
    // ---- STORES: what a payload consumes. A warhead is the big move: the
    // world reacts to the purchase (relations, sanctions on a first bomb).
    stores: {
      warhead: { name: "nuclear warhead", label: "Buy warhead", field: "warheads",
                 price: 150000, days: 6, upkeep: 25,
                 relations: 15,        // every other nation sours this much, per warhead
                 firstRelations: 30,   // ...and this much more for a country going nuclear
                 sanctionDays: 8, sanctionPerDay: 0.04 },   // of the treasury, per day, going nuclear
      mop:     { name: "bunker buster", label: "Buy MOP", field: "mops",
                 price: 20000, days: 2, upkeep: 0 },
    },
    // ---- PAYLOADS: which aircraft may carry it (in order of preference),
    // how many fly, how many stores each drops, and what it consumes.
    //   flight: "jets"   -> city/playerair.js CBZ.cityStrikeFlight (spawned
    //                       strike jets, counted against mil.planes)
    //   flight: "bomber" -> city/strategic.js CBZ.strategicSortie (ONE parked
    //                       bomber takes off from its own pad)
    payloads: {
      strike: { name: "airstrike", carriers: ["jet"], flight: "jets", aircraft: 2, each: 3, kind: "bomb" },
      nuke:   { name: "nuclear strike", carriers: ["heavy", "b2"], flight: "bomber", aircraft: 1, each: 1, kind: "nuke", store: "warhead" },
      bunker: { name: "bunker strike", carriers: ["b2"], flight: "bomber", aircraft: 1, each: 2, kind: "buster", store: "mop" },
    },
    // ---- the one line a General says when an order cannot fly. Short.
    lines: {
      noCarrier: { strike: "We have no jets left, sir.", nuke: "We don't have a bomber, sir.", bunker: "Only a B-2 can carry that, sir." },
      noStore:   { nuke: "We have no warheads, sir.", bunker: "We have no bunker busters, sir." },
      busy: "Every bomber we have is in the air, sir.",
      broke: "The treasury can't cover that, sir.",
      noTarget: "Mark it on the map, sir.",
      noBunker: "We don't know where they're hiding, sir.",
    },
    // ---- what each nation owns on day one (any id not listed: the old
    // wealth-seeded jet count, nothing else). The republic's B-2 and B-52 are
    // the two parked at Fort Brandt.
    start: {
      republic: { jet: 12, heavy: 1, b2: 1, warhead: 6, mop: 4 },
      veridia:  { jet: 10, heavy: 1, b2: 0, warhead: 4, mop: 0 },
      solara:   { jet: 4,  heavy: 0, b2: 0, warhead: 0, mop: 0 },
      kesh:     { jet: 2,  heavy: 0, b2: 0, warhead: 0, mop: 0 },
      mbeya:    { jet: 0,  heavy: 0, b2: 0, warhead: 0, mop: 0 },
    },
    // ---- BUNKERS. roofCE = metres of concrete-equivalent over the room
    // (city/bunkers.js); a GBU-57 dropped by a B-2 from 600 m gets ~4.3 m, and
    // a second one in the same hole goes on from the bottom of the first. So a
    // head of state's bunker takes two, a terror cell's dug-out takes one.
    bunkers: {
      leader: { roofCE: 7.0, w: 24, d: 20, directR: 45 },   // a nuke this close kills even inside
      terror: { roofCE: 3.8, w: 18, d: 16, directR: 70 },
      build:  { label: "Build bunker", price: 80000, days: 4 },
      aiRebuildDays: 5,                                      // a breached bunker an AI leader can afford comes back
    },
    // ---- a leader outside his bunker dies to a bomb this close to where he lives
    leaderExposedR: { bomb: 45, nuke: 1100 },
    // ---- daily national revenue = taxRate x REVENUE x (0.4 + 1.2 x wealth)
    revenue: 60000,
  };
})();
