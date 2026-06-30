/* ============================================================
   city/citytemplates.js — SIX MINI-CITY RECIPES (pure data).

   WHY THIS EXISTS (owner's why-first law + SimCity question "what does
   this place NEED?"): the archipelago has big EMPTY map bands between the
   dense mainland core and the far biomes. Dropping random box-towns there
   would read as filler. Instead, each recipe below is an ECONOMY with a
   felt reason to exist — a port that has to MOVE CARGO, a finance district
   that has to BANK the money, a strip that takes your money for FUN, a
   factory that MAKES things, a farm-market that sells the HARVEST, an
   alpine resort that HOSTS visitors. Palette + name + zoning make each one
   read DIFFERENT at a glance, and every prefab's shopKind is a REAL trade
   the existing Zillow/shops/jobs pipeline already prices & staffs (so the
   T1/T2 wiring turns each shop into a buyable, walk-in, staffed business).

   THIS FILE IS PURE DATA — no THREE, no geometry, cannot break the build.
   minicities.js (T4) drops the 4 standalone recipes into empty map space;
   biome_farmland.js (T7) + biome_snow.js (T8) drop the 2 biome-tied ones.

   A recipe is a CBZ.buildTown(root, cfg) PRESET (cols/rows/blockW/.../
   pattern/density/palette/prefabs) plus a `skyline` block the placer reads
   to grow the central towers. Every prefab field maps 1:1 to the towngen
   prefab shape: { name, storeys, color, shopKind, lotKind, opts }.

   HEIGHT HIERARCHY (CH3/CH6): each recipe's skyline.maxStoreys stays WELL
   under the mainland core (Midtown towers 20+); a mini-city's tallest lot
   tops out mid-rise so the main downtown always reads as THE downtown.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  // ---- shared shop OPTS (retail = clear see-through storefront glass) -------
  const RET = { retail: true };

  // Each template:
  //   id, name, biome, pattern, density, cols, rows, blockW, blockD, roadW,
  //   palette{ ground, sidewalk, road, line, wood, accent, stone, sign,
  //            signBoard, plaza, lamp },
  //   skyline{ minStoreys, maxStoreys, towerFrac, megaChance, townMax },
  //   squarePrefab, prefabs{ civic, commercial, residential, default }.
  //
  // skyline.townMax is forwarded to towngen's TOWN_MAX_STOREYS (CH6 cap), so
  // even after the placer's tower pass the *town-grown* shells obey the cap;
  // the placer's hand-placed skyline towers are the only taller silhouettes.
  CBZ.CITY_TEMPLATES = {

    // (1) PORT CITY — needs to MOVE CARGO. Dockside warehouses, a customs bank
    //     to clear the money, fuel for the ships/trucks, a seafood diner for the
    //     crews, a chandlery (pawn/ship-supply) to outfit a boat. Mid-rise; the
    //     skyline is cranes + low warehouses, not towers (towerFrac low).
    capeharbor: {
      id: "capeharbor", name: "Cape Harbor", subtitle: "Port City", biome: "capeharbor",
      pattern: "grid", density: 0.66, cols: 4, rows: 3, blockW: 50, blockD: 44, roadW: 13,
      minFrontage: 14, minLotArea: 200, squarePrefab: "flagpole",
      palette: { ground: 0x7d8794, sidewalk: 0x9aa3ad, road: 0x42474d, line: 0xc9bf8e,
        wood: 0x5a6b78, accent: 0x37607a, stone: 0x8a929b, sign: "#dfeaff",
        signBoard: 0x1f2730, plaza: 0x8f99a3, lamp: 0xbfe0ff },
      skyline: { minStoreys: 3, maxStoreys: 8, towerFrac: 0.18, megaChance: false, townMax: 4 },
      prefabs: {
        civic: [
          { name: "HARBOR CUSTOMS", storeys: 3, color: 0x46586a, shopKind: "bank", opts: { retail: true, facade: "office" }, lotKind: "shop" },
          { name: "PORT AUTHORITY", storeys: 3, color: 0x4a5a6a, shopKind: "security", opts: { retail: true, facade: "office" }, lotKind: "shop" },
        ],
        commercial: [
          { name: "DOCKSIDE HARDWARE", storeys: 1, color: 0x6b5a44, shopKind: "hardware", opts: RET, lotKind: "shop", w: 3 },
          { name: "FUEL DEPOT", storeys: 1, color: 0x8a6b3a, shopKind: "gas", opts: { showroom: true }, lotKind: "shop", w: 2 },
          { name: "THE WHARF DINER", storeys: 1, color: 0xa05a3a, shopKind: "food", opts: RET, lotKind: "shop", w: 3 },
          { name: "CHANDLERY & PAWN", storeys: 2, color: 0x5a6b54, shopKind: "pawn", opts: RET, lotKind: "shop", w: 2 },
          { name: "SAILORS' TAVERN", storeys: 2, color: 0x7a5a3a, shopKind: "bar", opts: RET, lotKind: "shop", w: 2 },
        ],
        residential: [
          { name: "Dock Row Flats", storeys: 2, color: 0x6a7480, lotKind: "home", rent: 80, w: 2 },
          { name: "Harbor Cottage", storeys: 1, color: 0x76808c, lotKind: "home", rent: 70, w: 1 },
        ],
        default: [
          { name: "Quay Flats", storeys: 1, color: 0x6a7480, lotKind: "home", rent: 65 },
        ],
      },
    },

    // (2) FINANCE DISTRICT — needs to BANK the money. Bank towers, a jeweler for
    //     the bonus cheques, a security firm to guard the vaults, an electronics
    //     house, a gym for the suits. HIGH storeys (the tallest mini-city) with a
    //     central mega-ish lot — but still under the mainland core.
    goldspire: {
      id: "goldspire", name: "Goldspire", subtitle: "Finance District", biome: "goldspire",
      pattern: "grid", density: 0.82, cols: 3, rows: 3, blockW: 44, blockD: 40, roadW: 14,
      minFrontage: 13, minLotArea: 170, squarePrefab: "flagpole",
      palette: { ground: 0x6f7480, sidewalk: 0x9498a2, road: 0x3c3f46, line: 0xd8c98a,
        wood: 0x556070, accent: 0xc9a44a, stone: 0xb8bcc6, sign: "#ffe9a8",
        signBoard: 0x232838, plaza: 0xa6aab4, lamp: 0xffe9a8 },
      // tallest mini-city, but maxStoreys 16 < Midtown's 20+ so downtown wins
      skyline: { minStoreys: 8, maxStoreys: 16, towerFrac: 0.6, megaChance: true, townMax: 4 },
      prefabs: {
        civic: [
          { name: "FIRST CAPITAL BANK", storeys: 4, color: 0x3c4658, shopKind: "bank", opts: { retail: true, facade: "office", glassKind: "reflective" }, lotKind: "shop" },
          { name: "GOLDSPIRE TRUST", storeys: 4, color: 0x46506a, shopKind: "bank", opts: { retail: true, facade: "office", glassKind: "reflective" }, lotKind: "shop" },
        ],
        commercial: [
          { name: "BULLION JEWELERS", storeys: 2, color: 0x7a6a3a, shopKind: "jewelry", opts: RET, lotKind: "shop", w: 2 },
          { name: "SENTINEL SECURITY", storeys: 3, color: 0x4a5260, shopKind: "security", opts: { retail: true, facade: "office" }, lotKind: "shop", w: 2 },
          { name: "TICKER ELECTRONICS", storeys: 2, color: 0x40566a, shopKind: "electronics", opts: RET, lotKind: "shop", w: 2 },
          { name: "EXCHANGE FITNESS", storeys: 2, color: 0x4a5a52, shopKind: "gym", opts: RET, lotKind: "shop", w: 1 },
          { name: "THE BOARDROOM BAR", storeys: 2, color: 0x5a4636, shopKind: "bar", opts: RET, lotKind: "shop", w: 1 },
        ],
        residential: [
          { name: "Spire Residences", storeys: 4, color: 0x5a6474, lotKind: "home", rent: 140, w: 2 },
          { name: "Penthouse Lofts", storeys: 3, color: 0x646e7e, lotKind: "home", rent: 120, w: 1 },
        ],
        default: [
          { name: "Exchange Flats", storeys: 2, color: 0x5a6474, lotKind: "home", rent: 110 },
        ],
      },
    },

    // (3) CASINO STRIP — needs to TAKE your money for fun. Casino + nightclub
    //     (both 'bar'-trade so the existing nightlife/careers hook in), a pawn
    //     (cash out fast), a jeweler (for the high rollers), a flophouse to crash.
    //     Mid-high glittering towers, a single bright MAIN STREET spine.
    neonreef: {
      id: "neonreef", name: "Neon Reef", subtitle: "Casino Strip", biome: "neonreef",
      pattern: "mainstreet", density: 0.78, cols: 4, rows: 2, blockW: 52, blockD: 42, roadW: 14,
      minFrontage: 14, minLotArea: 190, squarePrefab: "flagpole",
      palette: { ground: 0x2a2440, sidewalk: 0x3a3358, road: 0x201a30, line: 0xff5ab0,
        wood: 0x6a3a78, accent: 0xff36c0, stone: 0x4a4068, sign: "#ff8ae0",
        signBoard: 0x140f22, plaza: 0x3a3358, lamp: 0xff66cc },
      skyline: { minStoreys: 5, maxStoreys: 12, towerFrac: 0.5, megaChance: true, townMax: 4 },
      prefabs: {
        civic: [
          { name: "ROYAL FLUSH CASINO", storeys: 5, color: 0x7a2a6a, shopKind: "casino", opts: { retail: true, facade: "office" }, lotKind: "shop" },
          { name: "JACKPOT TOWER", storeys: 5, color: 0x6a2a7a, shopKind: "casino", opts: { retail: true, facade: "office" }, lotKind: "shop" },
        ],
        commercial: [
          { name: "AFTERGLOW NIGHTCLUB", storeys: 2, color: 0x8a2a8a, shopKind: "bar", opts: RET, lotKind: "shop", w: 2 },
          { name: "QUICK CASH PAWN", storeys: 1, color: 0x5a3a6a, shopKind: "pawn", opts: RET, lotKind: "shop", w: 2 },
          { name: "DIAMOND LOUNGE", storeys: 2, color: 0x7a3a5a, shopKind: "jewelry", opts: RET, lotKind: "shop", w: 1 },
          { name: "THE LUCKY BAR", storeys: 1, color: 0x6a3a4a, shopKind: "bar", opts: RET, lotKind: "shop", w: 2 },
        ],
        residential: [
          { name: "Neon Flophouse", storeys: 3, color: 0x4a3a5a, lotKind: "home", rent: 60, w: 2 },
          { name: "Strip Motel", storeys: 2, color: 0x5a4060, lotKind: "home", rent: 55, w: 1 },
        ],
        default: [
          { name: "Strip Rooms", storeys: 1, color: 0x4a3a5a, lotKind: "home", rent: 50 },
        ],
      },
    },

    // (4) FACTORY TOWN — needs to MAKE things. Hardware/parts, a chop shop, a car
    //     lot to sell what rolls off the line, a gun works, a workers' bar. LOW
    //     squat storeys, WIDE blocks, organic (unplanned industrial) pattern.
    foundry: {
      id: "foundry", name: "Foundry Flats", subtitle: "Factory Town", biome: "foundry",
      pattern: "organic", density: 0.62, cols: 3, rows: 3, blockW: 58, blockD: 52, roadW: 13,
      minFrontage: 16, minLotArea: 260, squarePrefab: "flagpole",
      palette: { ground: 0x55514a, sidewalk: 0x6a655c, road: 0x3a3833, line: 0xd0a850,
        wood: 0x6a5a44, accent: 0xb5662a, stone: 0x736d63, sign: "#f0c060",
        signBoard: 0x201d18, plaza: 0x6a655c, lamp: 0xffb060 },
      skyline: { minStoreys: 2, maxStoreys: 5, towerFrac: 0.12, megaChance: false, townMax: 4 },
      prefabs: {
        civic: [
          { name: "FOUNDRY HARDWARE", storeys: 1, color: 0x6b5a44, shopKind: "hardware", opts: RET, lotKind: "shop", w: 3 },
          { name: "IRONWORKS SUPPLY", storeys: 2, color: 0x5a5248, shopKind: "hardware", opts: RET, lotKind: "shop", w: 2 },
        ],
        commercial: [
          { name: "CHOP SHOP", storeys: 1, color: 0x4a4842, shopKind: "chop", opts: { showroom: true }, lotKind: "shop", w: 2 },
          { name: "FLATS MOTORS", storeys: 1, color: 0x5a544a, shopKind: "carlot", opts: { showroom: true }, lotKind: "shop", w: 2 },
          { name: "GUN WORKS", storeys: 1, color: 0x504a40, shopKind: "guns", opts: RET, lotKind: "shop", w: 2 },
          { name: "THE FORGE BAR", storeys: 1, color: 0x6a4a32, shopKind: "bar", opts: RET, lotKind: "shop", w: 2 },
        ],
        residential: [
          { name: "Worker Rowhouse", storeys: 2, color: 0x5a544a, lotKind: "home", rent: 55, w: 2 },
          { name: "Foundry Cottage", storeys: 1, color: 0x645c50, lotKind: "home", rent: 48, w: 1 },
        ],
        default: [
          { name: "Mill Flats", storeys: 1, color: 0x5a544a, lotKind: "home", rent: 45 },
        ],
      },
    },

    // (5) FARM-MARKET TOWN — needs to SELL the harvest. A grocer (food), a feed &
    //     seed (hardware), a co-op bank, a country diner, a dry-goods/clothing.
    //     SHORT 1-3 storeys, BIG lots. Biome-tied → placed by biome_farmland (T7).
    harvestmarket: {
      id: "harvestmarket", name: "Harvest Market", subtitle: "Farm County", biome: "farmland",
      pattern: "mainstreet", density: 0.55, cols: 3, rows: 2, blockW: 60, blockD: 46, roadW: 12,
      minFrontage: 16, minLotArea: 260, squarePrefab: "well",
      palette: { ground: 0xb59a66, sidewalk: 0xc2ad7e, road: 0x6a5a40, line: 0xcdb98a,
        wood: 0x8a6b3a, accent: 0x7a5a30, stone: 0x9a8d72, sign: "#f4e7c2",
        signBoard: 0x2a2418, plaza: 0xc6b079, lamp: 0xf3d68a },
      skyline: { minStoreys: 1, maxStoreys: 3, towerFrac: 0.08, megaChance: false, townMax: 3 },
      prefabs: {
        civic: [
          { name: "FARMERS CO-OP BANK", storeys: 2, color: 0xb7a279, shopKind: "bank", opts: { retail: true, facade: "office" }, lotKind: "shop" },
          { name: "GRANGE HALL", storeys: 2, color: 0xa9895c, shopKind: "bar", opts: RET, lotKind: "shop" },
        ],
        commercial: [
          { name: "VALLEY GROCER", storeys: 1, color: 0xae8a55, shopKind: "food", opts: RET, lotKind: "shop", w: 3 },
          { name: "FEED & SEED", storeys: 1, color: 0x9c7b4e, shopKind: "hardware", opts: RET, lotKind: "shop", w: 3 },
          { name: "COUNTRY DINER", storeys: 1, color: 0xc06a3a, shopKind: "food", opts: RET, lotKind: "shop", w: 2 },
          { name: "DRY GOODS & WEAR", storeys: 1, color: 0x8a7a4a, shopKind: "clothing", opts: RET, lotKind: "shop", w: 2 },
        ],
        residential: [
          { name: "Market Cottage", storeys: 1, color: 0xb09464, lotKind: "home", rent: 55, w: 2 },
          { name: "Farmhand Quarters", storeys: 1, color: 0xa3895a, lotKind: "home", rent: 45, w: 1 },
        ],
        default: [
          { name: "Market Rooms", storeys: 1, color: 0xb09464, lotKind: "home", rent: 45 },
        ],
      },
    },

    // (6) ALPINE RESORT — needs to HOST visitors. A lodge (bar), an outfitter
    //     (clothing/gear), a clinic (hospital) for the slope spills, a gear pawn,
    //     a spa (gym). Chalet-scale 2-5 storeys. Biome-tied → placed by biome_snow (T8).
    pinecrest: {
      id: "pinecrest", name: "Pinecrest", subtitle: "Alpine Resort", biome: "snow",
      pattern: "mainstreet", density: 0.6, cols: 3, rows: 2, blockW: 52, blockD: 44, roadW: 12,
      minFrontage: 14, minLotArea: 210, squarePrefab: "flagpole",
      palette: { ground: 0xdde6ef, sidewalk: 0xc7d2dc, road: 0x3b3f45, line: 0xeaf2ff,
        wood: 0x7a5638, accent: 0x5e4129, stone: 0x9aa6b2, sign: "#eaf2ff",
        signBoard: 0x2a2018, plaza: 0xcdd8e2, lamp: 0xfff0d0 },
      skyline: { minStoreys: 2, maxStoreys: 5, towerFrac: 0.1, megaChance: false, townMax: 4 },
      prefabs: {
        civic: [
          { name: "GRAND LODGE", storeys: 3, color: 0x7a5638, shopKind: "bar", opts: RET, lotKind: "shop" },
          { name: "SUMMIT CLINIC", storeys: 2, color: 0xc7d2dc, shopKind: "hospital", opts: { retail: true, facade: "office" }, lotKind: "shop" },
        ],
        commercial: [
          { name: "PEAK OUTFITTERS", storeys: 1, color: 0x6e5132, shopKind: "clothing", opts: RET, lotKind: "shop", w: 2 },
          { name: "GEAR EXCHANGE PAWN", storeys: 1, color: 0x5e4129, shopKind: "pawn", opts: RET, lotKind: "shop", w: 2 },
          { name: "ALPINE SPA", storeys: 2, color: 0x8aa0b2, shopKind: "gym", opts: RET, lotKind: "shop", w: 1 },
          { name: "THE SKI BAR", storeys: 1, color: 0x6a4a32, shopKind: "bar", opts: RET, lotKind: "shop", w: 1 },
        ],
        residential: [
          { name: "Chalet", storeys: 2, color: 0x8a6b48, lotKind: "home", rent: 95, w: 2 },
          { name: "Bunk Lodge", storeys: 2, color: 0x7a6048, lotKind: "home", rent: 70, w: 1 },
        ],
        default: [
          { name: "Resort Rooms", storeys: 1, color: 0x8a6b48, lotKind: "home", rent: 65 },
        ],
      },
    },
  };

  // tiny convenience: a CLONE of a template (so a placer can override cx/cz/
  // rng/region without mutating the shared recipe). Shallow-clones the prefab
  // arrays one level deep (the per-prefab objects are read-only to towngen).
  CBZ.cityTemplate = function (id, over) {
    const t = CBZ.CITY_TEMPLATES[id];
    if (!t) return null;
    const out = Object.assign({}, t, over || {});
    out.palette = Object.assign({}, t.palette, (over && over.palette) || {});
    out.skyline = Object.assign({}, t.skyline, (over && over.skyline) || {});
    return out;
  };
})();
