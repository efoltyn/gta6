/* lab ingredient "island": THE disaster island, built by the game's own
   builder, with its machines.

   WHAT IS REAL
     the island   world/disaster_arena.js CBZ.buildDisasterArena (towers with
                  their lifts and facades, the street grid, the parked cars,
                  the harbour, the volcano) through modes/survival.js's own
                  build() (registers the ground base, so CBZ.floorAt is the
                  island's ground)
     machines     world/island_vehicles.js: the real cars, the rooftop
                  helipad and its helicopter, exactly as a match sets them up
                  (the ingredient hands it a match: surv.stats)

   WHAT IS THE LAB'S
     no bots, no director (systems/disasters.js is not loaded unless a kit
     names it): the island stands still until a kit does something to it.
     The kit runs in mode "survival" (the island's own mode, so every
     islandModeOn / vehicleModeOn gate is the game's).

   handle: arena, machines() (CBZ.islandVehicles), state() */
CBZ.lab.ingredient("island", {
  // BufferGeometryUtils is THREE's, not a CBZ symbol: the tracer cannot see it
  files: ["src/vendor/BufferGeometryUtils.js", "src/world/island_roads.js", "src/world/island_building.js", "src/world/disaster_arena.js", "src/world/island_dressing.js",
    "src/systems/interactions.js", "src/modes/survival.js", "src/systems/stairs.js", "src/systems/liftcore.js",
    "src/city/airframe_kit.js", "src/city/airframes.js", "src/city/aircraftphysics.js",
    "src/world/carfx.js", "src/city/economy.js", "src/city/carbody.js", "src/city/carwheels.js", "src/city/carparts.js",
    "src/city/carseats.js", "src/city/playercars.js", "src/city/cardyn.js", "src/city/vehicles.js",
    "src/city/playeraircraft.js", "src/city/aircraft_doors.js", "src/systems/seat_exit.js",
    "src/world/island_vehicles.js", "src/city/facades/*.js"],
  /* what the island builder reaches through aliases (const VKIT =
     CBZ.vegetationKit ...), which the tracer does not follow: the island has
     to be the island, palms, facades and all, or the tower it crowns is not
     the tower the game crowns */
  symbols: ["vegetationKit", "treeTrunkGeo", "facadeList", "facadeDef", "dressFacade", "facadeOpenings",
    "surfaceMaps", "groundSkin", "furnish", "propRegisterSeat", "debris", "waterSurge", "waterClock",
    "FUEL", "FITOUT", "SURV", "addBox", "liftCore", "islandRoadKit", "islandDressing", "movingPlatform"],
  make: function (W, o) {
    const S = CBZ.surv;
    if (!S || !CBZ.modes || !CBZ.modes.survival) throw new Error("modes/survival.js did not load (no CBZ.surv)");
    if (!CBZ.buildDisasterArena) throw new Error("world/disaster_arena.js did not load");
    const t0 = performance.now();
    CBZ.modes.survival.build();
    const A = S.arena;
    if (!A) throw new Error("the island builder returned nothing");
    A.root.visible = true;
    // a match: island_vehicles.js sets its machines up on the next frame
    S.stats = { total: 1, placement: 0, disastersSurvived: 0 };
    // NO ROUND TO WIN. survival.js decides the round the frame nobody else is
    // alive ("last one standing" -> CBZ.winGame -> state "won", and every
    // verb stands down). A lab island has no crowd, so its round never ends:
    // the win card is not what an island kit measures.
    CBZ.winGame = function () { return false; };
    W.islandBuildMs = Math.round(performance.now() - t0);
    const h = {
      arena: A, obj: A.root, noFrame: true,
      machines: function () { return CBZ.islandVehicles; },
      state: function () {
        const V = CBZ.islandVehicles;
        return { buildMs: W.islandBuildMs, radius: A.radius, towers: (A.elevators || []).length, propCars: (A.cars || []).length,
          machines: V ? V.state() : null };
      },
    };
    return h;
  },
});
