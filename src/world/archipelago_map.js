/* ============================================================
   world/archipelago_map.js — THE ISLANDS, AS DATA.

   This file is the whole map of the archipelago game. Nothing here is code
   that builds anything: it is a list world/archipelago.js reads. Edit it,
   reload, and the sea is laid out differently. A custom map is another
   object of the same shape assigned to CBZ.ARCHIPELAGO_MAP before
   world/archipelago.js builds (or ?isles=<id> to start on another island).

   THE SHAPE
     name      what the map is called
     origin    {x, z} world metres the whole map is shifted by. The game's
               other worlds share one coordinate plane (prison z~0, disaster
               island z~600, Gang City z~-700 and the continent round it), so
               the archipelago is laid out far from all of them.
     spawn     the id of the island you start on
     view      the haze: fogNear / fogFar (m). Islands closer than fogFar
               can be seen; one closer than build m (from its shore) is
               built for real, and dropped again past drop m.
     islands   one row per island:
       id      a short name (tools, ?isles=)
       name    what it is called
       x, z    its centre, metres from the origin
       R       its radius (m); the town plan scales with it (200..280)
       style   which town it is (world/island_plan.js STYLES):
                 harbour   the disaster island's harbour town
                 downtown  towers wherever a frontage faces its street
                 estates   villas and houses, no towers
                 works     sheds and yards, a port
       seed    the placement salt: same style, a different town
       airstrip  true: a runway on reclaimed land off the east coast, with
                 a jet waiting on it
   Every island also has its harbour, a speedboat on the quay, and (if the
   plan gave it a tower with an open roof) a helicopter on a rooftop pad.

   Islands must stand at least 6 km apart (two full islands at a time is the
   budget: the one you leave and the one you reach).
============================================================ */
(function () {
  "use strict";
  const CBZ = (window.CBZ = window.CBZ || {});
  if (CBZ.ARCHIPELAGO_MAP) return;     // a page or a tool already chose a map
  CBZ.ARCHIPELAGO_MAP = {
    name: "The Windward Isles",
    origin: { x: 0, z: 30000 },
    spawn: "port-royal",
    view: { fogNear: 420, fogFar: 5600, build: 2100, drop: 3300 },
    islands: [
      { id: "port-royal", name: "Port Royal", x: 0, z: 0, R: 240, style: "harbour", seed: 0, airstrip: true },
      { id: "highgate", name: "Highgate", x: 6400, z: -2300, R: 250, style: "downtown", seed: 11, airstrip: true },
      { id: "palm-cay", name: "Palm Cay", x: -5900, z: -3600, R: 220, style: "estates", seed: 23, airstrip: true },
      { id: "ironworks", name: "Ironworks", x: 2300, z: 7000, R: 230, style: "works", seed: 37, airstrip: true },
      { id: "saint-anne", name: "Saint Anne", x: -6900, z: 4300, R: 260, style: "harbour", seed: 51, airstrip: true },
    ],
  };
})();
