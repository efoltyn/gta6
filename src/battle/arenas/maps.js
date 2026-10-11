"use strict";
/* src/battle/arenas/maps.js — NPC War: THE GROUND: the MAPS table (every arena the page can raise).
   Split out of games/battle.html (docs/npcwar/ARCHITECTURE.md). Every
   src/battle file shares ONE script scope: top-level names here are visible
   to the other battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in. */

/* ============================================================ THE GROUND
   FOUR OF THESE ARE PLACES IN GANG CITY, AT THEIR OWN COORDINATES.

   The first build fought its wars in a procedural desert: 200 box towers on a
   grid standing in for a city this repo already ships, whole. That is the
   exact mistake games/bomb-survivor.html deleted a wave earlier, and the note
   at the top of that page is the whole argument — the studio can RAISE the
   real map, so a stage flat is a choice nobody has to make.

     city    CBZ.studio.town()  — the real fabric: marked streets, sidewalks,
             crosswalks, shops with lit signs, and a cluster of the enterable
             instanced-glass towers the mainland is made of. A man takes cover
             behind a REAL doorway and a rocket brings down a REAL floor.
     island  CBZ.studio.raise("militaryisland") — the base at its authored
             place (-620,-700): fence, airstrip, parked fighters, motor pool.
     field   CBZ.studio.raise("airport") — Halloran Field: terminal, aprons,
             the airliners on their stands.
     dunes   the desert erg, out where the dunes measure as dunes: an open
             firing line is a different game and worth having, and here the
             sight lines live and die on the crests.
     arena   the kill box, kept, because it is the control: no world at all,
             so anything that goes wrong there is the men, not the map. */
const TOWN_AT = { x: 0, z: -700 };       // the mainland coordinates bomb-survivor stands on
/* THE VENUES.

   Gang City is already built. Every entry with a `raise` list is a real place
   from the map — the same geometry the mainland uses — and costs exactly this
   one row, because studio.raise() runs the builders the file already
   registered and studio.heightfield() measures the ground they left behind.
   Nothing below authors a wall, a floor or a height function.

   raise:  studio packs to RAISE as the ground (order is the build order)
   packs:  what must LOAD for that to work (raise packs plus anything the
           venue's own props need); studio resolves each pack's `needs`
   sea:    lay the deep sea plate under it, for a venue that reads as coastal */
const MAPS = {
  city:     { label: "GANG CITY", note: "the real downtown. streets, glass, doors", packs: ["citycore"] },
  island:   { label: "MILITARY ISLAND", note: "the real base. fence, strip, jets", packs: ["militaryisland", "airbase"], raise: ["militaryisland"], sea: true },
  field:    { label: "HALLORAN FIELD", note: "the real airport. aprons, terminal", packs: ["airport"], raise: ["airport"], sea: true },
  gov:      { label: "THE SEAT OF STATE", note: "the real complex. wings, strongrooms", packs: ["govcomplex"], raise: ["govcomplex"] },
  harbor:   { label: "CAPE HARBOR", note: "the coastal strip. apron, helipads", packs: ["capeharbor"], raise: ["capeharbor"], sea: true },
  marina:   { label: "THE MARINA", note: "basin, pontoons, moored boats", packs: ["marina"], raise: ["marina"], sea: true },
  speedway: { label: "THE SPEEDWAY", note: "banked oval. a ground that is NOT flat", packs: ["speedway"], raise: ["speedway"], sea: true },
  dunes:    { label: "OPEN DUNES", note: "rolling sand. crests hide men", packs: ["desert"], featured: true, erg: "sand" },
  /* THE SAME ERG, TWO MORE SKINS. The honest ground is a height function and
     nothing else, so snow and grass are the same crests under a different
     surface and sky: the snowfield the north's wars are fought on, and the
     rolling fields of the farmland and forest country (softer folds). Both
     exist because Gang City's wars are fought where the front IS. */
  snow:     { label: "OPEN SNOW", note: "the same ground, frozen. crests hide men", packs: ["desert"], erg: "snow" },
  grass:    { label: "OPEN FIELDS", note: "rolling grass. the folds hide men", packs: ["desert"], erg: "grass" },
  /* OPEN WATER — the one venue with NO GROUND IN IT.

     Every other row above raises a place. This one raises nothing, on purpose:
     the owner asked for "a lightweight test arena, great for animation", and
     the cheapest venue in the file is the one that builds a swell function, a
     seabed, one reef and stops. `packs: []` is the whole cost statement — no
     citycore, no towers, no roads, no heightfield raycast — which is why it is
     also the map you boot when you want to WATCH one animal rather than count
     three hundred. The sea itself is under THE SEA below.

     `sea` is deliberately FALSE here even though this is the ocean: that flag
     lays the flat -9 m deep plate the raised island venues sit in, and this map
     builds its own seabed forty metres further down. Two plates would fight for
     the depth buffer, which is the exact bug the seaPlate comment records. */
  water:    { label: "OPEN WATER", note: "real ocean. swell, depth, no land", packs: [], ocean: true, featured: true },
  arena:    { label: "KILL BOX", note: "container yard. block walls", packs: [] },
};
if (!MAPS[SET.map]) SET.map = "dunes";
