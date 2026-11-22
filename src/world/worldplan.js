/* ============================================================
   world/worldplan.js — THE WORLD PLAN. Gang City's country, stated once.

   OWNER: "the layout is dumb, houses too close to highway etc, it's just
   unrealistic and dumb layout ... I love the big barren desert, I love long
   highway stretches through farmland and huge oceans and mountain areas, but
   also cities that aren't slop."

   This file replaces world/layout.js (the "layout dial"). That file slid and
   scaled rectangles four times and the world stayed a board of tiles, because
   a table of offsets cannot say WHY anything is where it is. This one states
   the geography first, and everything that builds the world takes its
   position from it:

     THE COAST      one outline with a shape (continent.js cuts the land to
                    it): open ocean west, north and east; the GULF OF MERCY
                    cut 5.5 km up from the south coast to the Inner Harbour
                    at Gang City; Kings Harbour at the Kings River mouth;
                    Mbeya Bay and Lowport Bay; fjords under the range; the
                    Solara Keys trailing south off Cape Solara.
     THE RANGE      the Mercy Range runs coast to coast across the north.
                    Greater Mercy (the authored snow massif) is its heart;
                    Mercy Pass (west of it) and the Capitol Gap (east) are the
                    two low saddles a road can use; foothills fall south.
     THE BASIN      the Saltlands: a dry basin south-east of the range, in
                    its rain shadow, open to the gulf on the west and the
                    ocean on the south, walled from the east coast by the
                    Salt Hills. The Karvel River dies in it (the salt).
     THE VALLEYS    Mercy Valley (range to harbour, north of Gang City) and
                    the Coyle Plain round Karvel: flat, fields, grain towns.
     THE WOODS      the wet north-west: the west coast, the Redhollow Hills,
                    the range's north slope. Fort Brandt stands out in them.
     THE RIVERS     rise in the range and run to the sea: the Mercy to the
                    head of the gulf, the Redhollow to Mbeya Bay, the Kings
                    through Kingsport to Kings Harbour.
     THE PLACES     Gang City (the downtown never moves: the coast was
                    brought to it) wraps the Inner Harbour: downtown on the
                    north shore, Halloran Field on the flat west shore, the
                    speedway on the east, Goldspire on the south bank, Cape
                    Harbor down the gulf's west shore. Kingsport is the great
                    port on the south coast at the Kings River mouth. Karvel,
                    the planned capital, stands inland in the Coyle Plain
                    where the valley meets the basin. Mbeya is fishing
                    villages on its bay, Veridia a harbour on the east coast,
                    Kesh a hill kingdom under the range's east end, Solara a
                    town on the last key.
     THE ROUTES     highways that go from somewhere to somewhere
                    (city/highwaynet.js builds them from `routes` below).

   WHAT READS IT
     city/continent.js    the plate's bounds, the coastline (landAt), the
                          relief (reliefAt: range, foothills, plain, basin),
                          the land use (coverAt: fields, woods, scrub)
     city/river.js        the authored river courses
     the four biomes      their ground (CBZ.worldFoot) and their real,
                          irregular extent (lobes -> registerBiomeBlend)
     city/metro.js        Kingsport and Karvel's sites
     city/highwaynet.js   the route table
     every builder that used the old dial keeps its two calls:
       CBZ.worldOff(id)   -> { dx, dz }: how far the plan stands this place
                             from where its file authored it
       CBZ.worldFoot(id)  -> a biome's ground rect, in world coordinates

   Pure data and closed-form math: no THREE, no DOM, no rng. It runs in node
   (tools/citymap/plan.mjs draws the plan alone in two seconds, so the
   geography can be designed without booting the game).
   x is east, z is south, metres.
============================================================ */
(function () {
  "use strict";
  const root = (typeof window !== "undefined") ? window : globalThis;
  const CBZ = (root.CBZ = root.CBZ || {});
  CBZ.CONFIG = CBZ.CONFIG || {};

  // ------------------------------------------------------------------
  //  THE SHEET: what the continent plate covers (land + its near sea).
  // ------------------------------------------------------------------
  const BOUNDS = { minX: -7400, maxX: 10950, minZ: -8800, maxZ: 8850 };

  // ------------------------------------------------------------------
  //  THE COAST. Control points of the mainland outline, clockwise from the
  //  north-west cape; a closed Catmull-Rom curve is drawn through them.
  //  continent.js adds the small coves and the ragged edge (noise, +-60 m);
  //  the SHAPE is here.
  // ------------------------------------------------------------------
  const COAST = [
    // --- north coast, west to east: cold, steep, two fjords under the range
    [-6500, -6600], [-5600, -7500], [-4500, -7700], [-3950, -7200], [-3640, -6650], [-3520, -6220],   // Sorrow Fjord (head)
    [-3200, -6700], [-2950, -7250], [-2300, -7900], [-900, -8150], [300, -7800], [1300, -8200], [2250, -7850],
    [2650, -7250], [2880, -6700],                                                      // Capitol Sound (head)
    [3250, -7200], [3700, -7650], [4700, -7900], [6100, -7600], [7400, -7300], [9050, -6750],        // Cape North-East
    // --- east coast, north to south: open ocean, one harbour bay
    [9480, -5600], [8950, -4900], [8800, -4350],                                       // Kesh Bight
    [9300, -3850], [9900, -3450], [9650, -2400], [9080, -1380],                        // Cape Kesh: the range runs out into the sea
    [8800, -640],                                                                      // Lowport Bay (head)
    [9350, -40], [9850, 900], [9650, 2100], [9250, 3200], [9450, 4300], [9150, 5450],  // Cape Finca
    // --- south coast, east to west: the desert meets the ocean; Cape Solara
    [7700, 5650], [6750, 5550], [6250, 5950], [5930, 6420], [5560, 6050], [4600, 5650], [3750, 5800],
    [3250, 5350],                                                                      // Salt Point: the gulf's east head
    // --- the Gulf of Mercy, east shore, going north (desert coast)
    [3080, 4300], [3180, 3200], [3020, 2200], [3160, 1200], [3040, 480], [2550, 60],
    [1750, 40],                                                                        // the Mercy's mouth, head of the gulf
    // --- the Narrows and the Inner Harbour (north shore, then the basin).
    //     The speedway's bowl stands 100 m back from both: the Saltlands
    //     Highway runs down that strip and along the head of the gulf.
    [1180, 20], [680, 12], [572, -160], [560, -455], [300, -470], [218, -400], [218, 290], [270, 425],
    [700, 405], [1140, 385],
    // --- the gulf's west shore, going south: Goldspire, Cape Harbor, Kings Point
    [1190, 1250], [1160, 2350], [1270, 2900], [1500, 3420], [1520, 3920], [1260, 4520], [800, 5020],
    [300, 5320],                                                                       // Kings Point: the gulf's west head
    // --- south coast, west part: Kingsport's shore and Kings Harbour
    //     The harbour comes right up to the city: its head is inside
    //     Kingsport's south edge, where the river runs out past the docks.
    [-320, 5380], [-1300, 5060], [-2200, 4890], [-2950, 4810], [-3210, 4700],
    [-3480, 4610],                                                                     // Kings Harbour (the river mouth)
    [-3760, 4720], [-4000, 4860], [-4900, 4960], [-5500, 5160], [-6350, 5850],          // Cape Kings
    // --- west coast, south to north: open ocean, Mbeya Bay
    [-6650, 4900], [-6250, 3900], [-5800, 3100], [-5850, 2300], [-6450, 1700], [-6650, 800],  // the West Bight, Cape Tende
    [-6000, -100], [-5500, -650], [-5180, -1250],
    [-5110, -1760],                                                                    // Mbeya Bay (head: the Redhollow's mouth)
    [-5280, -2230], [-5750, -2750], [-6700, -3900], [-6550, -5200],
  ];
  // Land that stands off the mainland. The Keys are a chain the Overseas
  // Highway hops; the rest are rocks and one wooded barrier island.
  const ISLANDS = [
    { id: "gullkey", name: "Gull Key", pts: [[5640, 6760], [5860, 6670], [6080, 6720], [6210, 6900], [6120, 7090], [5900, 7170], [5720, 7120], [5600, 6950]] },
    { id: "longkey", name: "Long Key", pts: [[5760, 7310], [5960, 7290], [6090, 7420], [6140, 7620], [6040, 7800], [5850, 7830], [5700, 7720], [5650, 7500]] },
    { id: "solarakey", name: "Solara Key", pts: [[5420, 8000], [5700, 7890], [6000, 7870], [6330, 7950], [6520, 8150], [6480, 8380], [6230, 8520], [5880, 8560], [5560, 8500], [5370, 8300]] },
    { id: "tende", name: "Tende Island", pts: [[-6750, -2350], [-6400, -2250], [-6280, -1800], [-6450, -1350], [-6800, -1500], [-6900, -1950]] },
    { id: "sisters1", name: "The Sisters", pts: [[2050, 5650], [2260, 5600], [2330, 5800], [2120, 5880]] },
    { id: "sisters2", name: "The Sisters", pts: [[1700, 6050], [1860, 6020], [1900, 6180], [1730, 6220]] },
    { id: "sealrock", name: "Seal Rocks", pts: [[-7050, 1100], [-6900, 1040], [-6850, 1230], [-7010, 1290]] },
    { id: "widow", name: "Widow Rock", pts: [[10200, -3700], [10380, -3760], [10430, -3560], [10250, -3500]] },
  ];

  // ------------------------------------------------------------------
  //  THE RANGE. Spine vertices west to east: [x, z, crest height, half
  //  width]. Height is what the continent's relief rises to along the spine
  //  (the Greater Mercy massif between x -1450 and 1750 is its own authored
  //  heightfield, city/biome_snow.js: the spine only shoulders it there).
  //  A low vertex is a PASS.
  // ------------------------------------------------------------------
  const RANGE = [
    { name: "Mercy Range", pts: [
      [-5950, -5300, 70, 800], [-5050, -5500, 165, 1050], [-3900, -5650, 205, 1150], [-2750, -5500, 160, 950],
      [-1950, -5380, 34, 620],                       // MERCY PASS
      [-1350, -5400, 95, 800], [1650, -5400, 95, 800],
      [2300, -5450, 40, 640],                        // CAPITOL GAP
      [3200, -5600, 180, 1050], [4600, -5700, 215, 1200], [6000, -5400, 180, 1100], [7200, -4700, 135, 950],
      [8100, -3950, 85, 750],
    ] },
    // the Redhollow Hills: a wooded spur running south off the west range
    { name: "Redhollow Hills", pts: [[-4500, -5300, 110, 700], [-4750, -4000, 95, 720], [-4450, -2750, 60, 620]] },
    // the Salt Hills: the basin's east rim, between the desert and the ocean
    { name: "Salt Hills", pts: [[8350, 300, 55, 560], [8500, 1700, 80, 640], [8300, 3100, 70, 620], [8050, 4350, 45, 520]] },
  ];
  const PASSES = [
    { name: "Mercy Pass", x: -1950, z: -5380 },
    { name: "Capitol Gap", x: 2300, z: -5450 },
  ];

  // ------------------------------------------------------------------
  //  LAND COVER. Each is a union of lobes {x, z, rx, rz} (the same shape
  //  city/worldmap.js's registerBiomeBlend takes as `sources`, so the ground
  //  the map colours, the biome the game reports and the land use the
  //  continent paints are one shape).
  // ------------------------------------------------------------------
  const LOBES = {
    // the Saltlands basin: dunes in the middle, scrub at the rim
    desert: [
      { x: 4750, z: 1650, rx: 1500, rz: 1450 }, { x: 6350, z: 1850, rx: 1600, rz: 1600 },
      { x: 5250, z: 3500, rx: 2050, rz: 1500 }, { x: 6950, z: 3650, rx: 1250, rz: 1450 },
      { x: 4150, z: 2850, rx: 900, rz: 1350 }, { x: 5650, z: 5250, rx: 900, rz: 750 },
      { x: 7550, z: 2500, rx: 650, rz: 1100 },
    ],
    // the valleys: where the fields are
    farmland: [
      { x: 950, z: -2500, rx: 1500, rz: 1150 },                       // Mercy Valley
      { x: 2560, z: -1930, rx: 1250, rz: 1250 },                      // Coyle county (the authored farms)
      { x: 5000, z: -2050, rx: 2700, rz: 2050 },                      // the Coyle Plain round Karvel
      { x: 7500, z: -1100, rx: 1250, rz: 1150 },                      // east, toward Veridia
    ],
    // the wet north-west and the range's north slope
    forest: [
      { x: -3200, z: -3300, rx: 1900, rz: 1500 }, { x: -5050, z: -3700, rx: 1250, rz: 1700 },
      { x: -4500, z: -550, rx: 1500, rz: 800 }, { x: -2350, z: -2050, rx: 850, rz: 700 },
      { x: -3000, z: -6700, rx: 2500, rz: 800 }, { x: 900, z: -7400, rx: 2800, rz: 650 },
      { x: 5200, z: -6900, rx: 2500, rz: 700 }, { x: -6000, z: 900, rx: 650, rz: 1500 }, { x: -5700, z: 4100, rx: 700, rz: 1100 },
    ],
    // the snow up top: the high spine either side of Greater Mercy
    snow: [
      { x: -3900, z: -5650, rx: 1450, rz: 520 }, { x: -5000, z: -5520, rx: 800, rz: 420 },
      { x: 4500, z: -5700, rx: 1700, rz: 540 }, { x: 6050, z: -5420, rx: 900, rz: 450 },
    ],
  };

  // ------------------------------------------------------------------
  //  THE RIVERS: source to mouth, [x, z] control points; `half` is the half
  //  width at the source and at the mouth. city/river.js smooths them, lets
  //  them wander a little, carves them and bridges every road that crosses.
  // ------------------------------------------------------------------
  const RIVERS = [
    { id: "mercy", name: "The Mercy River", half: [30, 64], harbour: true,
      pts: [[1560, -4180], [1500, -3500], [1260, -2650], [1440, -1750], [1340, -950], [1500, -420], [1590, 60]] },
    { id: "redhollow", name: "The Redhollow River", half: [26, 54],
      pts: [[-2900, -4900], [-3350, -4150], [-3900, -3550], [-4250, -2700], [-4650, -2080], [-5120, -1780]] },
    { id: "upperkings", name: "The Kings River", half: [24, 46], into: "kingsport",
      pts: [[-3700, -700], [-3350, -150], [-3520, 500], [-3450, 1010]] },
    { id: "upperkarvel", name: "The Karvel River", half: [24, 44], into: "karvel",
      pts: [[4750, -5250], [4480, -4450], [4330, -3750], [4330, -3210]] },
  ];

  // ------------------------------------------------------------------
  //  THE PLACES. `at` is where the plan stands it (world coordinates);
  //  `authored` is the anchor its own file was written at, so
  //  CBZ.worldOff(id) = at - authored and the file needs no other change.
  //  A biome also states its ground: hx, hz (half extents of the floor its
  //  file lays) and the authored half extents the file scales from.
  // ------------------------------------------------------------------
  const PLACES = {
    // --- the four authored biome grounds
    snow:     { at: [350, -3850], authored: [350, -1450], hx: 546, hz: 429, ahx: 420, ahz: 330, why: "Mount Mercy and the ski town, on the range's south face above Mercy Valley" },
    desert:   { at: [5575, 2577], authored: [1120, 150], hx: 2226.4, hz: 2378.2, ahx: 440, ahz: 470, why: "the Saltlands basin, in the rain shadow, between the gulf and the Salt Hills" },
    farmland: { at: [2560, -1930], authored: [1180, -880], hx: 640, hz: 640, ahx: 400, ahz: 400, why: "Coyle county, the valley floor between Gang City and Karvel" },
    forest:   { at: [-3100, -3350], authored: [-560, -1350], hx: 565.5, hz: 478.5, ahx: 390, ahz: 330, why: "Redhollow Woods, in the hills under Mercy Pass" },
    // --- Gang City's own pieces (the downtown and its annex are the origin and never move)
    speedway: { at: [890, -350], authored: [490, -350], why: "LIVE BUILD ZONE (rigid): the east shore of the Inner Harbour" },
    airport:  { at: [-525, -120], authored: [-305, -120], why: "Halloran Field: flat land on the harbour's west shore, one causeway from downtown" },
    military: { at: [-3160, -2350], authored: [-620, -700], why: "Fort Brandt, out in the woods south of Redhollow, 3 km from town (dz is a multiple of 50)" },
    // --- the towns round the harbour and the gulf
    goldspire:  { at: [150, 1370], authored: [150, 470], why: "the finance city on the harbour's south bank" },
    capeharbor: { at: [490, 3095], authored: [430, 175], why: "the port town down the gulf's west shore, its airfield on the water" },
    neonreef:   { at: [-2110, -260], authored: [-1080, -260], why: "the strip west of the airport, on the coast highway" },
    foundry:    { at: [-2110, 765], authored: [-1080, 225], why: "the factory flats between Gang City and Kingsport" },
    // --- the nations
    veridia: { at: [8500, -250], authored: [2000, -400], why: "Veridia City and Lowport: the east-coast harbour at the end of the Valley Highway" },
    kesh:    { at: [7900, -2475], authored: [1900, -1600], why: "Keshtown and its villages: the hill kingdom in the foothills of the range's east end" },
    solara:  { at: [5900, 8150], authored: [2200, 600], why: "the island city-state, on the last of the Keys, at the end of the Overseas Highway" },
    mbeya:   { at: [-4440, -1600], authored: [-2200, -1200], why: "Mbeya's villages: fishing harbours on Mbeya Bay at the Redhollow's mouth" },
  };
  // The two metros (city/metro.js siteTable reads these: centre, reach, the
  // land they may use). Their rivers, lakes and rail stay in metro.js, which
  // authored them against these same numbers.
  const METROS = {
    kingsport: { cx: -3705, cz: 3000, rx: 2500, rz: 1650, bounds: { minX: -5080, maxX: -330, minZ: 950, maxZ: 4660 },
      why: "the port: docks at the Kings River mouth on Kings Harbour, downtown on the river behind them" },
    // (Karvel is planned as a copy in Kingsport's frame and moved by `frame`;
    //  `clip` is the part of that frame it keeps: city/metro.js)
    karvel: { of: "kingsport", frame: { dx: 7780, dz: -4400 }, clip: { minX: -4530, maxX: -1030, minZ: 950, maxZ: 4130 }, why: "the planned capital, inland on the Coyle Plain where the valley meets the basin" },
  };
  // Where a government compound belongs (city/govcomplex.js tries this spot
  // first, then its own search). Estates sit at the foot of the range.
  const SITES = {
    capitol:     { x: 2306, z: -4461, why: "the Capitol, at the foot of the range under the Capitol Gap" },
    execmansion: { x: -2175, z: -4416, why: "the Executive Mansion, on the road up to Mercy Pass" },
    governor:    { x: -4760, z: -4366, why: "the Governor's Residence, in the Redhollow Hills" },
    cliffhouse:  { x: -1680, z: -7330, why: "the Cliff House: over the pass, on the north coast" },
    defence:     { x: 120, z: 4720, why: "Defence Headquarters on Kings Point, watching the gulf's mouth" },
    agency:      { x: -5420, z: 700, why: "the Bureau, in the open country north-west of Kingsport, on its own road" },
    freeport:    { x: -1850, z: 4700, why: "the bonded freight yard, on the shore of Kings Harbour beside the port" },
    compound:    { x: 8130, z: 2600, why: "the Compound, where the desert road gives out under the Salt Hills" },
    finca:       { x: 9020, z: 3650, why: "La Finca, an estate on the empty east coast behind the Salt Hills" },
  };

  // ------------------------------------------------------------------
  //  THE ROUTES (city/highwaynet.js builds them; every leg that carries
  //  traffic is axis-aligned, the corners sweep, long legs get S-bends).
  //  kind "freeway" = 3+3 divided, "road" = a two-lane country road.
  // ------------------------------------------------------------------
  //  `pts` are CENTRELINE points, junction to junction. `trimA` / `trimB` is
  //  how far short of its first / last point the DECK stops: the half width
  //  of the deck it tees into (15.3 a network freeway, 14.4 a 24 m causeway
  //  deck, 5.5 a country road) or the distance from a town street's
  //  centreline to its kerb. The drivable record runs on to the point
  //  itself, so traffic hops the junction. No trim = a free end.
  const at = function (id) { return PLACES[id].at; };
  const BRANDT_Z = at("military")[1];     // Fort Brandt's deck runs east along the fort's own centreline (city/island_military.js)...
  const BRANDT_EAST_X = -133;             // ...and ends here, north of Gang City
  const MERCY_X = at("snow")[0] + 120;    // the Mercy Valley road: city/biome_snow.js's lane, straight down from Mount Mercy
  const SPINE_Z = at("desert")[1] - 40;   // the Saltlands spine through Dry Gulch (city/biome_desert.js HWY_Z)
  const GULCH_WEST_X = at("desert")[0] - 90;                       // Dry Gulch's first street: where the town takes the road over
  const SALT_X = at("desert")[0] - PLACES.desert.hx + 30;          // down the basin's gulf shore
  const SALT_Z = -100;                                             // along the head of the gulf, between the speedway's bowl and the water
  const SPEEDWAY_ROAD_Z = at("speedway")[1] - 190;                 // the speedway's own access road off the annex (city/island_speedway.js ACCESS_Z)
  const V = at("veridia"), KS = at("kesh"), SO = at("solara"), MB = at("mbeya");
  const ROUTES = [
    // THE COAST FREEWAY: from Kingsport's port north through the city, past
    // Neon Reef, up to Fort Brandt's road. The settled west hangs off it.
    { id: "R1", name: "Coast Freeway", kind: "freeway", sweep: true,
      pts: [[-2380, 4250], [-2380, BRANDT_Z]], trimB: 14.4 },
    // off the Coast Freeway to the airport and the downtown causeway
    { id: "R5", name: "West Shore Highway", kind: "freeway",
      pts: [[-2380, -700], [-1500, -700], [-1500, -420], [0, -420]], trimA: 15.3, trimB: 14.4 },
    // across Gang City's north side to the Mercy Valley road
    { id: "R9", name: "Crosstown Freeway", kind: "freeway",
      pts: [[-2380, -1180], [MERCY_X, -1180]], trimA: 15.3, trimB: 14.4 },
    // THE VALLEY HIGHWAY: from the head of Mercy Valley east through the
    // fields, along Karvel's north edge, south across the Coyle Plain to the
    // east coast at Veridia. The long farmland stretch.
    { id: "R3", name: "Valley Highway", kind: "freeway", sweep: true,
      pts: [[MERCY_X, -3250], [7050, -3250], [7050, V[1]], [V[0] - 128, V[1]]], trimA: 14.4, trimB: 7 },
    // Gang City's south bank: the finance city to the downtown causeway
    { id: "R2", name: "Goldspire Run", kind: "freeway",
      pts: [[150, 470], [150, -420], [0, -420]], trimB: 14.4 },
    { id: "R4", name: "Foundry Row", kind: "freeway",
      pts: [[-380, 765], [150, 765]], trimB: 14.4 },
    { id: "R6", name: "Southgate Road", kind: "freeway",
      pts: [[-280, 765], [-280, 2650]], trimA: 15.3, trimB: 15.3 },
    // Kingsport's cross-town freeway, out to the gulf shore above Cape Harbor
    { id: "R8", name: "Gulf Freeway", kind: "freeway",
      pts: [[-2380, 2650], [520, 2650]], trimA: 15.3 },
    // Fort Brandt's road, from the end of its deck to the valley road
    { id: "R7", name: "Brandt Road", kind: "freeway",
      pts: [[BRANDT_EAST_X, BRANDT_Z], [MERCY_X, BRANDT_Z]], trimB: 14.4 },
    // THE SALTLANDS HIGHWAY: the long empty one. Off the speedway's access
    // road, down the harbour's east shore, along the head of the gulf, down
    // the desert's gulf shore and east along the basin's spine into Dry
    // Gulch, the one gas-station town. (The spine runs on east of the town
    // until it gives out under the Salt Hills.)
    { id: "C0", name: "Saltlands Highway", kind: "road", sweep: true,
      pts: [[620, SPEEDWAY_ROAD_Z], [620, SALT_Z], [SALT_X, SALT_Z], [SALT_X, SPINE_Z], [GULCH_WEST_X, SPINE_Z]], trimA: 14.4 },
    // OVER THE PASS: off the fort road, up through Mercy Pass and down to
    // the north coast. A country road, and the only way north.
    { id: "C1", name: "Mercy Pass Road", kind: "road", sweep: true,
      pts: [[-1950, BRANDT_Z], [-1950, -7100]], trimA: 14.4 },
    // THE OVERSEAS HIGHWAY: out of Dry Gulch dead straight down the desert,
    // off Cape Solara and across the Keys to the island city.
    { id: "C2", name: "Overseas Highway", kind: "road",
      pts: [[5900, SPINE_Z], [5900, SO[1] - 106]], trimA: 5.5, trimB: 6.5 },
    // the towns hung on the big roads, each on its own main street
    { id: "C3", name: "Kesh Road", kind: "road",
      pts: [[7050, KS[1] - 25.5], [KS[0] - 82.5, KS[1] - 25.5]], trimA: 15.3, trimB: 6.5 },
    { id: "C4", name: "Mbeya Road", kind: "road",
      pts: [[-2380, MB[1] + 41.5], [MB[0] + 304.3, MB[1] + 41.5]], trimA: 15.3, trimB: 5.5 },
    { id: "C5", name: "Lowport Lane", kind: "road", pts: [[V[0], V[1] - 230], [V[0], V[1] - 116]], trimA: 6, trimB: 7 },
    { id: "C6", name: "Nur Hollow Lane", kind: "road", pts: [[KS[0] + 1.5, KS[1] + 76.5], [KS[0] + 1.5, KS[1] + 176.5]], trimA: 6.5, trimB: 5.5 },
    { id: "C7", name: "Adar's Well Lane", kind: "road", pts: [[KS[0] + 82.5, KS[1] + 1.5], [KS[0] + 211.1, KS[1] + 1.5]], trimA: 6.5, trimB: 5.5 },
    { id: "C8", name: "Ruvu Lane", kind: "road", pts: [[MB[0] + 78, MB[1] + 24], [MB[0] + 213.6, MB[1] + 24]], trimA: 6, trimB: 5.5 },
    { id: "C9", name: "Kolo Lane", kind: "road", pts: [[MB[0] - 213.9, MB[1] + 24], [MB[0] - 78, MB[1] + 24]], trimA: 5.5, trimB: 6 },
    { id: "C10", name: "Tende Lane", kind: "road", pts: [[MB[0] + 0.1, MB[1] - 177.3], [MB[0] + 0.1, MB[1] - 72]], trimA: 5.5, trimB: 6 },
  ];

  // ------------------------------------------------------------------
  //  NAMES ON THE MAP
  // ------------------------------------------------------------------
  const LABELS = [
    { kind: "sea", n: "Western Ocean", x: -6950, z: 3900 },
    { kind: "sea", n: "Eastern Ocean", x: 10350, z: 1500 },
    { kind: "sea", n: "North Sea", x: 4200, z: -8450 },
    { kind: "sea", n: "Gulf of Mercy", x: 2200, z: 2700 },
    { kind: "water", n: "Inner Harbour", x: 440, z: 30 },
    { kind: "water", n: "Kings Harbour", x: -3500, z: 5150 },
    { kind: "water", n: "Mbeya Bay", x: -5750, z: -1900 },
    { kind: "water", n: "Lowport Bay", x: 9500, z: -900 },
    { kind: "water", n: "Kesh Bight", x: 9450, z: -4700 },
    { kind: "water", n: "The West Bight", x: -6450, z: 2800 },
    { kind: "land", n: "Cape Kesh", x: 9350, z: -3250 },
    { kind: "water", n: "Sorrow Fjord", x: -3650, z: -7350 },
    { kind: "water", n: "Capitol Sound", x: 2880, z: -7700 },
    { kind: "range", n: "MERCY RANGE", x: -3900, z: -5900 },
    { kind: "range", n: "MERCY RANGE", x: 4700, z: -5950 },
    { kind: "land", n: "Mercy Pass", x: -1950, z: -5750 },
    { kind: "land", n: "Capitol Gap", x: 2300, z: -5850 },
    { kind: "land", n: "Redhollow Hills", x: -4900, z: -3400 },
    { kind: "land", n: "Salt Hills", x: 8650, z: 2300 },
    { kind: "land", n: "Mercy Valley", x: 700, z: -2900 },
    { kind: "land", n: "Coyle Plain", x: 6000, z: -3950 },
    { kind: "land", n: "Kings Point", x: 650, z: 5080 },
    { kind: "land", n: "Salt Point", x: 3650, z: 5450 },
    { kind: "land", n: "Cape Solara", x: 6250, z: 6250 },
    { kind: "land", n: "Cape Kings", x: -5900, z: 5350 },
    { kind: "land", n: "The Solara Keys", x: 6500, z: 7400 },
    // a town that stands inside a biome's ground has no region of its own
    // for the map tool to name (the in-game map letters it from the town)
    { kind: "town", n: "Dry Gulch", x: PLACES.desert.at[0] + 30, z: PLACES.desert.at[1] - 110 },
  ];

  // ==================================================================
  //  THE MATH
  // ==================================================================
  function sm01(v) { v = v < 0 ? 0 : (v > 1 ? 1 : v); return v * v * (3 - 2 * v); }

  // closed centripetal Catmull-Rom through the control points, sampled so no
  // chord is longer than `step`
  function smoothClosed(ctrl, step) {
    const n = ctrl.length, out = [];
    function tj(ti, a, b) { return ti + Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5); }
    for (let i = 0; i < n; i++) {
      const p0 = ctrl[(i + n - 1) % n], p1 = ctrl[i], p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
      const t0 = 0, t1 = tj(t0, p0, p1), t2 = tj(t1, p1, p2), t3 = tj(t2, p2, p3);
      const m = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
      for (let k = 0; k < m; k++) {
        const t = t1 + (t2 - t1) * k / m, q = [0, 0];
        for (let c = 0; c < 2; c++) {
          const A1 = (t1 - t) / (t1 - t0) * p0[c] + (t - t0) / (t1 - t0) * p1[c];
          const A2 = (t2 - t) / (t2 - t1) * p1[c] + (t - t1) / (t2 - t1) * p2[c];
          const A3 = (t3 - t) / (t3 - t2) * p2[c] + (t - t2) / (t3 - t2) * p3[c];
          const B1 = (t2 - t) / (t2 - t0) * A1 + (t - t0) / (t2 - t0) * A2;
          const B2 = (t3 - t) / (t3 - t1) * A2 + (t - t1) / (t3 - t1) * A3;
          q[c] = (t2 - t) / (t2 - t1) * B1 + (t - t1) / (t2 - t1) * B2;
        }
        out.push(q);
      }
    }
    return out;
  }

  /* THE LAND FIELD: metres of land between a point and the nearest sea
     (negative: metres of sea to the nearest land), as a 50 m grid built the
     first time it is asked for and read bilinearly after that. Exact out to
     LAND_REACH from the coast and clamped beyond it: nothing downstream
     reads a shore distance further than the coastal lowland is wide. */
  const LAND_CELL = 50, LAND_REACH = 1700;
  let _land = null;
  function buildLand() {
    const polys = [smoothClosed(COAST, 70)];
    for (const isl of ISLANDS) polys.push(smoothClosed(isl.pts, 40));
    const nx = Math.ceil((BOUNDS.maxX - BOUNDS.minX) / LAND_CELL) + 1, nz = Math.ceil((BOUNDS.maxZ - BOUNDS.minZ) / LAND_CELL) + 1;
    const inside = new Uint8Array(nx * nz);
    // even-odd fill, one polygon at a time, a row at a time
    for (const P of polys) {
      for (let j = 0; j < nz; j++) {
        const z = BOUNDS.minZ + j * LAND_CELL + 0.013, xs = [];
        for (let i = 0, n = P.length; i < n; i++) {
          const a = P[i], b = P[(i + 1) % n];
          if ((a[1] > z) !== (b[1] > z)) xs.push(a[0] + (z - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
        }
        xs.sort(function (p, q) { return p - q; });
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const i0 = Math.max(0, Math.ceil((xs[k] - BOUNDS.minX) / LAND_CELL)), i1 = Math.min(nx - 1, Math.floor((xs[k + 1] - BOUNDS.minX) / LAND_CELL));
          for (let i = i0; i <= i1; i++) inside[j * nx + i] = 1;
        }
      }
    }
    // coast segments, bucketed
    const BK = 425, bnx = Math.ceil((BOUNDS.maxX - BOUNDS.minX) / BK) + 1, bnz = Math.ceil((BOUNDS.maxZ - BOUNDS.minZ) / BK) + 1;
    const buckets = new Array(bnx * bnz);
    const segs = [];
    for (const P of polys) for (let i = 0, n = P.length; i < n; i++) {
      const a = P[i], b = P[(i + 1) % n], id = segs.length / 4;
      segs.push(a[0], a[1], b[0], b[1]);
      const bi = Math.min(bnx - 1, Math.max(0, Math.floor(((a[0] + b[0]) / 2 - BOUNDS.minX) / BK))), bj = Math.min(bnz - 1, Math.max(0, Math.floor(((a[1] + b[1]) / 2 - BOUNDS.minZ) / BK)));
      (buckets[bj * bnx + bi] || (buckets[bj * bnx + bi] = [])).push(id);
    }
    const RB = Math.ceil(LAND_REACH / BK) + 1;
    const d = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) {
      const z = BOUNDS.minZ + j * LAND_CELL, bj = Math.floor((z - BOUNDS.minZ) / BK);
      for (let i = 0; i < nx; i++) {
        const x = BOUNDS.minX + i * LAND_CELL, bi = Math.floor((x - BOUNDS.minX) / BK);
        let best = LAND_REACH * LAND_REACH;
        for (let r = 0; r <= RB; r++) {
          // a ring of buckets r away cannot hold anything nearer than (r-1) cells
          if (r > 1 && (r - 1) * BK * (r - 1) * BK > best) break;
          for (let v = bj - r; v <= bj + r; v++) {
            if (v < 0 || v >= bnz) continue;
            const edge = (v === bj - r || v === bj + r);
            for (let u = bi - r; u <= bi + r; u += (edge ? 1 : 2 * r || 1)) {
              if (u < 0 || u >= bnx) continue;
              const L = buckets[v * bnx + u]; if (!L) continue;
              for (let k = 0; k < L.length; k++) {
                const o = L[k] * 4, ax = segs[o], az = segs[o + 1], vx = segs[o + 2] - ax, vz = segs[o + 3] - az;
                const L2 = vx * vx + vz * vz;
                let t = L2 > 0 ? ((x - ax) * vx + (z - az) * vz) / L2 : 0; t = t < 0 ? 0 : (t > 1 ? 1 : t);
                const dx = x - (ax + vx * t), dz = z - (az + vz * t), dd = dx * dx + dz * dz;
                if (dd < best) best = dd;
              }
            }
          }
        }
        const dist = Math.sqrt(best);
        d[j * nx + i] = inside[j * nx + i] ? dist : -dist;
      }
    }
    _land = { nx: nx, nz: nz, d: d };
    return _land;
  }
  function landAt(x, z) {
    const G = _land || buildLand();
    let fx = (x - BOUNDS.minX) / LAND_CELL, fz = (z - BOUNDS.minZ) / LAND_CELL;
    if (fx < 0 || fz < 0 || fx > G.nx - 1 || fz > G.nz - 1) return -LAND_REACH;          // off the sheet: open sea
    if (fx > G.nx - 1.001) fx = G.nx - 1.001; if (fz > G.nz - 1.001) fz = G.nz - 1.001;
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, k = j * G.nx + i, D = G.d;
    const a = D[k] + (D[k + 1] - D[k]) * tx, c = D[k + G.nx] + (D[k + G.nx + 1] - D[k + G.nx]) * tx;
    return a + (c - a) * tz;
  }

  /* THE RANGE FIELD. For each spine the nearest point gives a crest height
     and a half width (both interpolated along the spine); the mountain is a
     bell across it and the foothills an apron 2.6 half-widths out.
       reliefAt(x, z) -> { h, alp, foot }
         h     metres the land is lifted here (crest + apron), before noise
         alp   0..1 how far up the mountain proper this is (rock, snow)
         foot  0..1 inside the foothill apron                                */
  const _rl = { h: 0, alp: 0, foot: 0 };
  function reliefAt(x, z) {
    let h = 0, alp = 0, foot = 0;
    for (let s = 0; s < RANGE.length; s++) {
      const P = RANGE[s].pts;
      let bd = 1e18, bh = 0, bw = 1;
      for (let i = 0; i + 1 < P.length; i++) {
        const a = P[i], b = P[i + 1], vx = b[0] - a[0], vz = b[1] - a[1], L2 = vx * vx + vz * vz;
        let t = L2 > 0 ? ((x - a[0]) * vx + (z - a[1]) * vz) / L2 : 0; t = t < 0 ? 0 : (t > 1 ? 1 : t);
        const dx = x - (a[0] + vx * t), dz = z - (a[1] + vz * t), dd = dx * dx + dz * dz;
        if (dd < bd) { bd = dd; const u = sm01(t); bh = a[2] + (b[2] - a[2]) * u; bw = a[3] + (b[3] - a[3]) * u; }
      }
      const d = Math.sqrt(bd);
      if (d >= bw * 2.6) continue;
      const q = d / bw;
      const crest = q < 1 ? (1 - q * q) * (1 - q * q) : 0;
      const apron = 1 - sm01(d / (bw * 2.6));
      const hh = bh * (0.74 * crest + 0.26 * apron);
      if (hh > h) h = hh;
      const a2 = crest * sm01((bh - 70) / 70);
      if (a2 > alp) alp = a2;
      if (apron > foot) foot = apron;
    }
    _rl.h = h; _rl.alp = alp; _rl.foot = foot;
    return _rl;
  }

  /* LAND COVER WEIGHTS, 0..1, smooth: the union of a cover's lobes, soft at
     the rim (the same superellipse city/worldmap.js blends with, without its
     noise: the continent adds its own). */
  function lobeWeight(L, x, z) {
    let sum = 0;
    for (let i = 0; i < L.length; i++) {
      const s = L[i], dx = Math.abs((x - s.x) / s.rx), dz = Math.abs((z - s.z) / s.rz);
      if (dx > 1.2 || dz > 1.2) continue;
      const q = Math.pow(Math.pow(dx, 3.35) + Math.pow(dz, 3.35), 1 / 3.35);
      const v = 1.16 - q;
      if (v > 0) sum += v * v * v;
    }
    if (sum <= 0) return 0;
    return sm01((Math.pow(sum, 1 / 3) - 0.16 + 0.2) / 0.4);
  }
  /* Read through a 100 m grid per cover, built the first time it is asked
     for: the lobes are kilometres across, so the grid is the field to within
     a percent, and a lookup is four array reads where the exact form is
     four Math.pow per lobe (the continent asks three covers for every one of
     its 230k plate vertices). */
  const COVER_CELL = 100, _cover = {};
  function coverGrid(kind) {
    const L = LOBES[kind]; if (!L) return null;
    const nx = Math.ceil((BOUNDS.maxX - BOUNDS.minX) / COVER_CELL) + 1, nz = Math.ceil((BOUNDS.maxZ - BOUNDS.minZ) / COVER_CELL) + 1;
    const g = new Float32Array(nx * nz);
    // only the cells a lobe can reach
    for (let q = 0; q < L.length; q++) {
      const s = L[q];
      const i0 = Math.max(0, Math.floor((s.x - s.rx * 1.2 - BOUNDS.minX) / COVER_CELL)), i1 = Math.min(nx - 1, Math.ceil((s.x + s.rx * 1.2 - BOUNDS.minX) / COVER_CELL));
      const j0 = Math.max(0, Math.floor((s.z - s.rz * 1.2 - BOUNDS.minZ) / COVER_CELL)), j1 = Math.min(nz - 1, Math.ceil((s.z + s.rz * 1.2 - BOUNDS.minZ) / COVER_CELL));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        if (g[j * nx + i] === 0) g[j * nx + i] = lobeWeight(L, BOUNDS.minX + i * COVER_CELL, BOUNDS.minZ + j * COVER_CELL) || -1;
      }
    }
    for (let k = 0; k < g.length; k++) if (g[k] < 0) g[k] = 0;
    return (_cover[kind] = { nx: nx, nz: nz, g: g });
  }
  function coverAt(x, z, kind) {
    const G = _cover[kind] || coverGrid(kind);
    if (!G) return 0;
    let fx = (x - BOUNDS.minX) / COVER_CELL, fz = (z - BOUNDS.minZ) / COVER_CELL;
    if (fx < 0 || fz < 0 || fx > G.nx - 1 || fz > G.nz - 1) return 0;
    if (fx > G.nx - 1.001) fx = G.nx - 1.001; if (fz > G.nz - 1.001) fz = G.nz - 1.001;
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, k = j * G.nx + i, g = G.g;
    const a = g[k] + (g[k + 1] - g[k]) * tx, c = g[k + G.nx] + (g[k + G.nx + 1] - g[k + G.nx]) * tx;
    return a + (c - a) * tz;
  }

  // metres from a point to the nearest authored river's bank (negative: in
  // the channel, by the plan's own widths; river.js lets a course wander up
  // to 70 m, so a builder keeping clear of a river allows for that)
  function riverDist(x, z) {
    let best = 1e9;
    for (let r = 0; r < RIVERS.length; r++) {
      const P = RIVERS[r].pts, h0 = RIVERS[r].half[0], h1 = RIVERS[r].half[1];
      for (let i = 0; i + 1 < P.length; i++) {
        const a = P[i], b = P[i + 1], vx = b[0] - a[0], vz = b[1] - a[1], L2 = vx * vx + vz * vz;
        let t = L2 > 0 ? ((x - a[0]) * vx + (z - a[1]) * vz) / L2 : 0; t = t < 0 ? 0 : (t > 1 ? 1 : t);
        const d = Math.hypot(x - (a[0] + vx * t), z - (a[1] + vz * t)) - (h0 + (h1 - h0) * (i + t) / (P.length - 1));
        if (d < best) best = d;
      }
    }
    return best;
  }
  // the land each metro may use, as rects (a builder that runs before the
  // metros plan asks here what ground is spoken for)
  function metroBounds() {
    const out = [];
    for (const id in METROS) {
      const m = METROS[id];
      if (m.bounds) out.push({ id: id, minX: m.bounds.minX, maxX: m.bounds.maxX, minZ: m.bounds.minZ, maxZ: m.bounds.maxZ });
      else if (m.frame && m.of && METROS[m.of] && m.clip) out.push({ id: id, minX: m.clip.minX + m.frame.dx, maxX: m.clip.maxX + m.frame.dx, minZ: m.clip.minZ + m.frame.dz, maxZ: m.clip.maxZ + m.frame.dz });
    }
    return out;
  }

  // ==================================================================
  //  WHAT THE BUILDERS READ
  // ==================================================================
  const ZERO = { dx: 0, dz: 0 };
  const OFF = {}, FOOT = {};
  for (const id in PLACES) {
    const p = PLACES[id];
    OFF[id] = { dx: p.at[0] - p.authored[0], dz: p.at[1] - p.authored[1] };
    if (p.hx) {
      FOOT[id] = { scale: p.hx / p.ahx, cx: p.at[0], cz: p.at[1], hx: p.hx, hz: p.hz,
        minX: p.at[0] - p.hx, maxX: p.at[0] + p.hx, minZ: p.at[1] - p.hz, maxZ: p.at[1] + p.hz };
    }
  }
  CBZ.worldOff = function (id) { return OFF[id] || ZERO; };
  CBZ.worldFoot = function (id) { return FOOT[id] || null; };
  // linear scale of a biome's ground against the size its file authored (a
  // generator re-rates a grid pitch or a scatter count by it)
  CBZ.worldFootScale = function (id) { const f = FOOT[id]; return f ? f.scale : 1; };
  CBZ.WORLD_FOOTPRINTS = FOOT;

  // THE SETTLED BOX: every place the plan stands, with a little slack.
  // world/terrain.js seeds its FLAT rect from it (and then grows that rect
  // over every region as it registers): the far backdrop relief stands clear
  // of it, and the north edge is deliberately the snow ground's own north
  // edge, because world/terrain_overhaul.js hangs the backdrop range behind
  // the white country off that line.
  const SETTLED = (function () {
    let x0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (const id in PLACES) {
      const p = PLACES[id], hx = p.hx || 350, hz = p.hz || 350;
      if (p.at[0] - hx < x0) x0 = p.at[0] - hx; if (p.at[0] + hx > x1) x1 = p.at[0] + hx;
      if (p.at[1] + hz > z1) z1 = p.at[1] + hz;
    }
    for (const id in METROS) { const b = METROS[id].bounds; if (b) { if (b.minX < x0) x0 = b.minX; if (b.maxX > x1) x1 = b.maxX; if (b.maxZ > z1) z1 = b.maxZ; } }
    return { minX: Math.floor(x0) - 40, maxX: Math.ceil(x1) + 40, minZ: Math.round(FOOT.snow.minZ) - 40, maxZ: Math.ceil(z1) + 40 };
  })();
  CBZ.WORLD_ENLARGE_FLAT = SETTLED;
  /* "How far out is this place, as a fraction of the INHABITED world?"
     (city/minicities.js bends a town's skyline by it). Pinned to the rect
     that question was tuned against: the country growing an empty quadrant
     does not vote on how tall the casino is. */
  CBZ.WORLD_RIM_REF = { minX: -4800, maxX: 4770, minZ: -4319, maxZ: 1790 };
  /* The published sea: 108 km across, centred on the city. The drawn ocean
     is a camera-centred disc (world/water_spec.js); this is the record every
     "is this open sea" question agrees on, and the flyable airspace. */
  CBZ.WORLD_SEA_SPAN = 108000;

  CBZ.worldPlan = {
    bounds: BOUNDS, settled: SETTLED,
    coast: COAST, islands: ISLANDS, range: RANGE, passes: PASSES, lobes: LOBES, rivers: RIVERS,
    places: PLACES, metros: METROS, sites: SITES, routes: ROUTES, labels: LABELS,
    brandt: { z: BRANDT_Z, eastX: BRANDT_EAST_X }, mercyX: MERCY_X, spineZ: SPINE_Z, saltlandsHighwayZ: SALT_Z,
    landAt: landAt, reliefAt: reliefAt, coverAt: coverAt, riverDist: riverDist, metroBounds: metroBounds, smoothClosed: smoothClosed,
    LAND_REACH: LAND_REACH,
    // a short string that changes when the geography does (cache keys)
    signature: function () {
      let h = 2166136261;
      const s = JSON.stringify([BOUNDS, COAST, ISLANDS, RANGE, LOBES, RIVERS, PLACES, METROS, SITES, ROUTES]);
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
      return (h >>> 0).toString(36);
    },
    // for the map tools: the names, and the outlines as drawn
    mapData: function () {
      return { labels: LABELS, bounds: BOUNDS, passes: PASSES,
        rivers: RIVERS.map(function (r) { return { n: r.name, pts: r.pts }; }) };
    },
  };
})();
