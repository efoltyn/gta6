# DESERT WARLORD: THE WAR LAYER (HOI4 meets OpenFront, on real maps)

Owner, 2026-09-27: "like HOI4 meets OpenFront. I don't want some fake
factories, I don't want fake bullshit." And: "how different maps could be
really easy to do... more like maps of actual places."

## The rules nobody breaks

1. **Every number on screen is a thing on the map.** People = the population
   of the towns and countryside you hold. Soldiers = the sum of your army
   counters standing on the map. Land = tiles painted your colour. No
   factories, no abstract resource counters, no "production points".
2. **Territory is painted tile by tile** and moves at the border because armies
   push it (OpenFront). Readable at a glance: whose colour is where.
3. **Cities are the atom.** A town's garrison marches out to meet you; beat it,
   it surrenders, the town and the land it feeds are yours. Fronts are where
   two owners' land meets. Terrain matters
   (rivers, mountains, desert, coast). **Supply is literal**: an army standing
   on tiles not connected through its owner's land to one of its owner's towns
   is cut off and weakens. Encirclement emerges from that.
4. **The real-time 3D battle (battle.js) is the zoom-in** when armies clash.
   Optional to watch. Its result moves the front.
5. **AI factions use exactly the player's order API.** Nothing scripted.
6. **A map is one data file.** Adding a map = adding one file under
   `src/warlord/war/maps/` + one line in the page's load list.

## Files and owners (territories are disjoint)

| file | what | owner |
|---|---|---|
| `src/warlord/war/mapkit.js` | map format loader, TERRAIN table, rasteriser, runtime map | MAPS |
| `src/warlord/war/maps/mediterranean.js` | 218 BC Mediterranean, real geography | MAPS |
| `src/warlord/war/maps/island.js` | the desert island, BAKED from desert.js | MAPS |
| `tools/warlord-bake-island.mjs` | Node baker that writes maps/island.js | MAPS |
| `src/warlord/war/sim.js` | the war simulation (pure JS, Node-runnable) | SIM |
| `src/warlord/war/ai.js` | faction AI, only calls sim's order API | SIM |
| `tools/warlord-war-sim.mjs` | headless Node test/benchmark of sim+ai on real maps | SIM |
| `src/warlord/war/view.js` | three.js 3D map: relief, sea, rivers, paint, towns, armies, camera | VIEW |
| `src/warlord/war/ui.js` | HUD, selection, orders, diplomacy, menus, end screens | VIEW |
| `src/warlord/war/bridge.js` | battle zoom-in: sim battle -> battle.js fight -> result back | VIEW |
| `games/warlord.html` | load list + menu entry for the war layer | VIEW |

Everything is a classic-script IIFE (no ES modules; three.js is r128 global
`THREE`), attaching to `CBZ.warlord.war` (alias `W.war`). `mapkit.js`,
`sim.js`, `ai.js` and every map file MUST run in Node with no DOM and no THREE
(`globalThis.CBZ`), so tools can test them.

Load order on the page: mapkit.js, maps/*.js, sim.js, ai.js, view.js, ui.js, bridge.js.

## 1. Map data format (v1)

A map file does exactly one thing:

```js
(function () {
  const G = typeof window !== "undefined" ? window : globalThis;
  const W = ((G.CBZ = G.CBZ || {}).warlord = G.CBZ.warlord || {});
  const WAR = (W.war = W.war || {});
  (WAR.mapData = WAR.mapData || {})["mediterranean"] = { ...the data... };
})();
```

`mapkit.js` must NOT be required to load before a map file (hence
`WAR.mapData` is a plain object anyone can create).

Data fields:

```
id, name, blurb                         strings (blurb: one line for the menu)
projection:
  { kind: "lonlat", west, east, south, north }          vector maps, degrees
  { kind: "metres", west, east, south, north }          x = east, y = north... (island: world x/z metres)
grid: { w, h }                          tile raster the loader builds
-- VECTOR SOURCES (optional when raster given) --
land:    [ ring, ... ]                  ring = [[lon,lat], ...] outer coast rings (islands are separate rings)
water:   [ ring, ... ]                  lakes / inland seas cut back out of land
terrain: [ { kind, poly: ring } ... ]   painted over land in array order; unpainted land = "plains"
rivers:  [ { name, line: [[lon,lat],...] } ]
-- RASTER SOURCE (baked maps) --
raster: { w, h, terrain: "<base64 of Uint8 codes, row-major, north row first>",
          height: "<base64 of Uint8, metres = v * heightScale>", heightScale }
-- ALWAYS --
towns: [ { id, name, at: [lon,lat] | [x,y in projection units], pop, owner: factionId|null,
           capital?: true, port?: true } ]
factions: [ { id, name, adj?, colour: "#rrggbb", capital: townId, playable?: true,
              ai?: { aggression: 0..1, expand: 0..1 } } ]
startRadiusKm: number                   how far from its towns a faction's land starts
realms?: [ { owner, poly: ring } ]      optional explicit starting land (overrides radius rule)
wars: [[factionA, factionB], ...]       at war on day 0
alliances?: [[a,b], ...]
armies: [ { owner, at: townId | [lon,lat], men } ]
ruralPerKm2?: { plains, forest, hills, mountains, desert, marsh }   people per km2 of countryside
startDate?: { year, month, day, era: "BC"|"AD"|null }               for the date on the HUD
battle?: { biome: { plains: "gravel", desert: "dune", hills: "rock", mountains: "rock",
                    forest: "gravel", marsh: "wadi" } }             3D zoom-in ground per terrain
win?: { share: 0.7 }                    land share that wins (default 0.7)
```

Population numbers must be defensible real estimates (cite the order of
magnitude in a comment). Army sizes too.

## 2. Runtime map (what `W.war.mapkit.load(data)` returns)

```
M.id M.name M.blurb M.data
M.w M.h                         tiles
M.tileKm                        km per tile (mean)
M.TERRAIN                       = W.war.TERRAIN (see below)
M.terrain  Uint8Array(w*h)      terrain code per tile (0 = sea)
M.height   Float32Array(w*h)    metres; sea tiles <= 0 (synthesised from terrain + noise if the map has none)
M.river    Uint8Array(w*h)      1 where a river runs
M.coast    Uint8Array(w*h)      1 for a land tile 8-adjacent to sea
M.land     Uint8Array(w*h)      1 for land
M.rural    Float32Array(w*h)    people living on that tile's countryside (0 at sea)
M.towns    [ { id, i (index), name, x, y (tile coords, float), tile (int index), pop, capital, port, owner (faction index or 0) } ]
M.townAt   Int32Array(w*h)      town index + 1 standing on the tile, else 0
M.factions [ { id, i (1-based index), name, adj, colour (int 0xrrggbb), css ("#rrggbb"), capital (town index), playable, ai } ]
M.factionIndex(id) -> i         0 = nobody
M.startOwner Uint8Array(w*h)    faction index per tile on day 0
M.startArmies [ { owner (i), tile, men } ]
M.wars [[i,j]] M.alliances [[i,j]]
M.idx(x,y) -> x + y*w           M.xy(i) -> [x,y]
M.toTile(u,v) -> [x,y] floats   projection units -> tile coords   (lon,lat for lonlat maps)
M.fromTile(x,y) -> [u,v]
M.kmBetween(i,j)                great-circle (lonlat) or planar km between tile centres
M.worldOf(tile) -> {x,z}|null   island only: the desert.js world metres of the tile centre (for the 3D battle ground)
M.battleBiome(tile) -> string   biome name for the zoom-in ground
M.win.share
```

TERRAIN codes (in mapkit.js, shared by everyone):

```
0 sea       move: impassable on foot (ships only)     defence 1.0
1 plains    move 1.0   defence 1.0   rural default 25/km2
2 forest    move 1.6   defence 1.25  rural 8
3 hills     move 1.6   defence 1.35  rural 14
4 mountains move 3.0   defence 1.8   rural 3
5 desert    move 1.8   defence 1.0   rural 0.5, attrition for armies out of supply x2
6 marsh     move 2.2   defence 1.3   rural 5
7 lake      impassable, not sea for ports
river: crossing INTO or ALONG a river tile adds move +0.6 and gives the DEFENDER x1.25 when the attacker is across it
```

Each entry: `{ code, key, name, move, defence, rural, colour: [r,g,b] 0..1 (a real-looking ground albedo for the view) }`.

## 3. Sim (`W.war.sim`), the city loop

The owner's core loop, verbatim: "Not have production. Just have cities. You
go up to a city with your army. There's rogue armies walking around, but there
should also be armies protecting the city that come out to defend it. You take
that army, they surrender, you get the city." sim.js's header is the design;
this is the surface.

- Every land tile belongs to one town's CATCHMENT (cheapest march to it, up to
  `K.CATCH_KM`); the tile's owner is that town's owner. Territory moves town by
  town; the view spreads the colour outward (`G.catchTiles[ti]` is sorted by
  distance from the town).
- A town keeps a GARRISON (real men, refilled from its catchment's people up to
  `K.GARRISON_SHARE`). A hostile army inside `G.sallyR` tiles makes it MARCH
  OUT (an army with `home = ti`, order `sally`), leaving a WATCH. Beat it: it
  SURRENDERS (men go home to the town's people) and the town is yours.
  Walking into a town past its watch fights the watch on the walls.
- Soldiers are only ever men moved out of a garrison (`levy`, `raise`). Nothing
  creates men. Beaten field armies shed deserters into ROGUE warbands
  (faction index `G.ROGUE`, the extra last entry in `G.factions`).
- Supply: own/allied land or within `K.FORAGE_TILES` of it; otherwise the army
  bleeds men and order and fights at 60%.

```
G = sim.create(M, { player: factionIndex|0, seed })
G.day, G.date() -> {year, month, day, era}, G.ROGUE, G.sallyR, G.speed (tiles/day)
G.owner Uint8Array(w*h)         G.catchOf Int32Array(w*h) (town index | -1)   G.catchTiles[ti]
G.townOwner[ti] G.townPop[ti] G.townCatch[ti] G.garrison[ti] G.sallied[ti] (army id | 0)
G.factions[i] { i, id, name, adj, colour, css, alive, isPlayer, isRogue?, capital,
                towns, tiles, people, soldiers (field), garrisons, armies }
G.armies [ { id, owner (0 = a free town's own men), free?, rogue?, name, x, y, tile, prev, men, org,
             supplied, entrench, order, path, battle, home (town index | -1), walls? } ]
G.battles [ { id, tile, x, y, att[], def[], attOwner, defOwner, day0, attMen0, defMen0,
              attLoss, defLoss, watched, river, town (index | -1), walls } ]
G.events: town {town,from,to} battle {phase:start|end, id, tile, att, def, attArmy, defArmy, attMen, defMen,
          winner, side, attLoss, defLoss, surrendered, deserted, town} surrender {army,town,men,owner,to}
          sally {town,army,men,against,owner} raise {army,town,men,owner} levy {army,town,men,owner}
          deserters {army,men,tile} destroyed {army,owner,men,tile} cut {army,owner,tile} sacked {town,by}
          war {a,b} peace {a,b} ally {a,b} offer {from,to} dead {faction} win {faction} lose {faction}
sim.step(G, days)          sim.takeDirty(G) -> tiles whose owner changed
sim.order(G, ids, {kind: "move", to: tile} | {kind: "chase", target: armyId} | {kind: "hold"} | {kind: "raise", men?} | {kind: "idle"})
sim.levy(G, townIndex, men?) -> army    sim.raise(G, armyId, men?)    sim.raisable(G, ti)
sim.split(G, id, men)  sim.merge(G, ids)
sim.declareWar(G,a,b) sim.makePeace(G,a,b) sim.peaceAcceptable(G,a,b) (would b accept a's offer) sim.ally(G,a,b)
sim.relation(G,a,b) -> "self"|"war"|"peace"|"ally"    sim.hostile(G,a,b)
sim.path(G, armyId, tile)  sim.frontTiles(G,a,b)  sim.townsOf(G,f)  sim.nearestTownOf(G,f,tile)
sim.townDefence(G, ti) -> {garrison, watch, out}   sim.garrisonCap(G, ti)   sim.strength(G, army)
sim.battleById / battleAt / watch(G,id,on) / resolveExternal(G,id,{attLossFrac,defLossFrac,winner:"att"|"def"})
sim.stats(G,f) -> {people, soldiers, garrisons, tiles, towns, armies, share}
sim.army(G, id)  sim.armiesAt(G, tile)  sim.K (the knobs)
```

## 4. AI (`W.war.ai`)

`ai.think(G, f)`, called by the sim every `K.AI_EVERY` days per faction
(staggered). It uses only the public sim API: levy from the town with the most
spare men, march on the best town it can beat, chase armies marching on its
towns, raise men when home, go home when cut off, sail from a port when there
is no road, declare war on a weaker neighbour, sue for peace when losing (the
player gets an `offer` event).

## 5. View / UI / bridge

- `W.war.view.mount(M, G)`, `.unmount()`, `.frame(dt)`, `.pick(clientX, clientY) -> {tile, army, town}`,
  `.focus(tile)`, `.select(armyIds)`. Uses CBZ.scene / CBZ.camera / CBZ.renderer
  from microboot; hides the campaign root while mounted; phase is `"war"`.
- `W.war.ui.start({ map: id, faction: id })`, and the menus.
- `W.war.bridge.watch(G, battleId)` -> starts `W.battle.start({...})` with the
  armies scaled to figures, returns the result into `sim.resolveExternal`.
- On-screen text: no em dashes, no middle dots (house signage law).
