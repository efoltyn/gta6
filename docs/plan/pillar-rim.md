# PILLAR: THE RIM WORLD — the edge of the map IS the wilderness

Design doc. No game code here. Every number was read out of the repo on 2026-07-28 and is cited
`file:line`; every design claim that came from outside is cited to the source that supplied it.
Where I could not verify something I say so and tell the wave planner to MEASURE before writing
the literal. This document **extends** `pillar-scale.md` and `GAMEPLAN.md §3.2` — §5 reconciles
them line by line and names exactly what changes.

OWNER, verbatim: *"the entire RIM of the map — instead of the center — should be the mountains
and snow, instead of right near the city. the entire rim of map: one corner a MASSIVE version of
our desert biome, one corner a massive mountain range and ice like we have, and one corner ice
too, and BIG FOREST. make the terrain feel massive. this goes with the big airport gameplan we
made for making many more airports."*

---

## 0. THE VERDICT — twelve findings, and the first one is the whole pillar

1. **THE RIM ALREADY EXISTS, IT IS ENORMOUS, AND IT IS BLANK.** `continent.js:431-433` pads the
   plate `CONTINENT_COUNTRY_MARGIN = 2200` u (`continent.js:61-62`) past the union of every
   registered region. Measured off the stage-4 numbers in the file's own comment
   (`continent.js:444-448`): union **9,496 × 8,245**, plate **13,896 × 12,645**. That is
   **97.4 km² of already-built, already-walkable, already-drawn backcountry against 78.3 km² of
   settled world — 55% of the map is ALREADY rim.** One corner of that belt (2,200 × 2,200 =
   4.8 km²) is **2.3× the entire Saltlands** footprint and **4.5× Redhollow Woods**. The owner is
   not asking for a bigger world first. He is asking for the world we already own to stop being
   green nothing.
2. **AND IT IS BLANK BY LAW, NOT BY ACCIDENT.** `RIM_CEIL = 23` (`continent.js:702`) is a hard
   ceiling on every metre of that belt, set *"strictly under the 25 u doctrine line"* so a
   mountains-outside-snow cell is impossible **by construction** (`continent.js:692-697`). The
   rim is flat because flat is the only thing the current gate can prove is safe. **The rim world
   is therefore a GATE problem before it is a terrain problem**, and §4 is where it is solved.
3. **NOTHING HAS TO MOVE.** This is the single best property of the design and the reason to
   prefer it over a re-lay: **`SPREAD_V5` can be `SPREAD_V4` verbatim.** Every strait, every
   causeway, every pinned axis in `layout.js:311-357`, the seven free-country lane literals in
   `highwaynet.js:175-181`, `worldLayoutAudit()`'s minimum strait, and GOLDEN's lots/shops/roads
   all stay exactly where they are. A world re-lay is the most expensive thing in this repo's
   history (read `layout.js:215-357` — every entry carries the strait it is answerable for). **The
   rim world does not need one.**
4. **THE FRONTIER ROAD IS ALREADY BUILT.** `continent.js:1575-1631` draws a world-spanning
   `frontier-loop` 190 m inside the plate's coast, with four named navigation beacons, and it
   **pushes real `city.roads` records** (`city.frontierRoads`, `:1631`). It derives from the plate
   rect, so it grows with the world for free. Today it is a 51.6 km ring road through nothing.
   After this pillar it is a 67.6 km ring road through four frontier biomes.
5. **THE RIM'S GEOMETRY IS ALREADY DRAWN — the wave changes what the plate's vertices SAY, not
   how many there are.** The continent plate covers every metre of the belt at 38 m cells
   (`PLATE_CELL = 38`, `continent.js:731`) and already bakes per-vertex land cover off
   `biomeBlendDominantAt` (`continent.js:1825`). A rim sector that declares an organic blend spec
   (`worldmap.js:111`) gets its colour, its `cityBiomeAt` answer, its map fill, its weather, its
   traction and its wildlife share **with no new mesh**. **The rim costs almost no new geometry.
   The one genuine draw-call bill in the whole pillar is trees** (§6.4).
6. **A COARSE MESH IS THE *CORRECT* MESH FOR A SAND SEA.** `biome_desert.js:560-561` caps
   `GSEG` at 264 to hold ~5 m cells; at rim scale that cap yields ~19 m cells and
   `pillar-scale.md §2.3` correctly warns dune crests read as ramps past ~12 m. But the interior
   Saltlands keeps its fine bake and the RIM erg is a different landform: **a 4 km sand sea's
   dunes are megadunes** (Rub' al Khali star dunes run 1–3 km wavelength), and a 38 m plate cell
   resolves those with room to spare. The rim desert is not a compromised dune field; it is the
   **sand sea** the dune field sits inside.
7. **THE FOUR CORNERS ARE EXPLAINED BY ONE WIND, AND THAT MAKES EVERY ADJACENCY DEFENSIBLE.**
   Prevailing west-northwesterlies off the western ocean → drench the western coast (temperate
   rainforest: the BIG FOREST) → lift over the northern wall (glaciated crest, ice cap) → pool as
   cold *dry* air on the northeast (the ice SHIELD — the Gobi-Altai case, where glaciers *shrank*
   during the ice age because aridity, not cold, gates ice) → descend hot and dry into the
   southeast lee (the ERG). The settled interior sits in the partial shadow and is prairie — the
   Great Plains gradient (>1,270 mm/yr east to <380 mm/yr west, no hard line). **No corner is
   arbitrary; they are one rain shadow read clockwise.**
8. **A RING OF MOUNTAINS IS THE WRONG ANSWER AND SHIPPED GAMES PROVE IT.** Skyrim is walled by
   the Jerall, Velothi and Druadach ranges on all three land sides with the tallest peak
   (Throat of the World) dead CENTRE — the exact inversion of this ask — and players describe the
   result as *"fenced in"*, *"abrupt, jagged walls"*, sky *"consumed by the towering rock"*
   ([GamesRadar on the Reach](https://www.gamesradar.com/why-skyrims-most-barren-environment-makes-bountiful-world/)).
   **A continuous mountain rim reads as a BOWL — interior focus — which is the opposite
   psychological effect from wilderness pulling the eye outward.** The owner's corner scheme is
   right and the research says so: relief on ONE side, ice on the next, sand on the third, forest
   on the fourth.
9. **THE CORNER PROBLEM HAS EXACTLY TWO SHIPPED ANSWERS AND WE USE BOTH.** BOTW never lets the
   Gerudo Desert touch Hebra's snow: between them sit the **Gerudo Highlands**, a genuine hybrid
   (snowcapped peaks *with* desert flora at elevation), backed by **Tanagar Canyon**, a hard
   geological seam with ONE authored route. Just Cause 4 refuses the problem entirely — four
   extreme-weather biomes, each a bounded volume that never crosses into a neighbour, with the
   alpine region at the CENTRE as a hub so **no two extremes ever share a corner by construction**
   ([PCGamesN](https://www.pcgamesn.com/just-cause-4/just-cause-4-weather-biome-constrained)).
   Our four seams use one or the other, and §2 assigns each.
10. **DESERT CAN MEET ICE, AND THE ANSWER IS A SANDUR.** Skeiðarársandur is the largest glacial
    outwash plain on Earth — **1,300 km², 20–30 km from the Skeiðarárjökull snout to the sea** —
    flat braided grey-black volcanic sand, vegetation-free, used as a Mars/Moon film analogue.
    Geomorphologically it **is** a desert surface; only the water source differs. That is the one
    authored hybrid this world needs, it is the cheapest biome in the game (it is *flat, and
    painted this colour*), and it is a real landform rather than a blend hack.
11. **THE SIZE THE ARITHMETIC SUPPORTS IS A PLATE OF 17,896 × 16,645 (297.9 km²), AND IT LANDS
    INSIDE THE ONLY PUBLISHED TOLERANCE BAND.** Full-map ground crossings that are remembered
    fondly cluster at **8–20 minutes**; at that plate a fast car crosses in **7.5 min** and runs
    the diagonal in **10.2 min**, and a realistic 25 m/s average puts the diagonal at **16.3 min**.
    GTA V is 75.84 km² with an 8-minute best-route crossing and a 17:52 scenic traverse. **We
    would be ~3.9× GTA V's area at ~1.3× its crossing time**, and the whole difference is bought
    by the airport network: the longest airliner leg is **~3–4 min gate to gate**, *half* GTA V's
    cross-map DRIVE.
12. **THE ONE THING THAT CAN KILL THIS PILLAR IS NAMED, MEASURED, AND RATCHETED.** Elden Ring's
    Mountaintops of the Giants and Consecrated Snowfield — its literal rim regions — are widely
    held to be its weakest: the escalation in danger and vista **was not matched by escalation in
    content density**, so arriving reads as anticlimax. FUEL (2009) holds the Guinness record at
    14,400 km² and was panned for *"incredibly long and boring road trips"* with *"zero point to
    exploration"*. The counter-measure is a number, not a promise: **`rimAudit().poiGapMax`, the
    largest gap between consecutive points of interest along the frontier loop, pinned at
    ≤ 4,200 u** (§7). Everything else in this document is terrain; that one line is whether the
    terrain is worth crossing.

---

## 1. THE RING LAYOUT

### 1.1 The measured world, today

| quantity | value | source |
|---|---|---|
| region union | 9,496 × 8,245 u | `continent.js:444-448` (the file's own stage-4 derivation) |
| country belt `PAD` | 2,200 u | `continent.js:61-62`, clamped ≤ 2,400 at `:431-432` |
| plate | 13,896 × 12,645 u — x ±6,966, z −8,700..3,945 | `layout.js:488-490`, published `CBZ.CONTINENT_PLATE` (`continent.js:1352`) |
| `W_ROOF` | **15,500 — and past it the build `return`s, i.e. silently deletes the continent** | `continent.js:449-450` |
| `PLATE_SEG` | 368 (cells 37.8 × 34.4 m), cap **448** | `continent.js:731-734` |
| `RIM_CEIL` | 23 u hard ceiling over the whole belt | `continent.js:702` |
| rim band | `RIM_IN 0.42` → `RIM_OUT 0.88` of a Chebyshev box metric on the PLATE | `continent.js:698-712` |
| seed `FLAT` | 9,570 × 6,109, grown live over every region | `layout.js:459-469`, `terrain.js:152` |
| frontier loop | plate inset 190 m, 4 real road records | `continent.js:1575-1631` |
| biome footprints | desert 1,408×1,504 · farmland 1,280×1,280 · forest 1,131×957 · snow core 1,092×858 | `layout.js:402-425` (`FOOT_SCALE` × `FOOT_AUTHORED`) |
| nation towns | veridia (4,400, −400) · kesh (4,300, −2,240) · solara (4,600, 1,620) · mbeya (−4,440, −1,600), **hx ≤ 145** | `countries.js:189-296` × `layout.js:353-356` |

**Two diagnoses fall straight out of that table.**

**(a) The four nations are already marooned in the rim.** They are 290 m-wide towns sitting
2,200–4,400 u outside every biome, in blank green country. The owner's earlier direction, quoted
in CLAUDE.md — *"mountains … on the edges of the map with just small cities"* — describes what
they should be and are not. **This pillar does not move them. It wraps them in biome**, and each
becomes what a rim town is in reality: Askole (3,048 m), the last village before the Baltoro
Glacier, where the route runs terrace → orchard → meadow → ice in a single day's walk.

**(b) The rim metric is not keyed to where people live.** `rimT` (`continent.js:705-708`)
normalises against the **plate** rect, whose centre is `(minX+maxX)/2, (minZ+maxZ)/2` = **(0,
−2,377)** — because the Greater Mercy Range envelope reaches ~2.2 km further north than `FLAT`
does (`terrain_overhaul.js:217-221` documents exactly this overhang). The settled world's centre
of mass is around z ≈ −700. **So the rim law's "interior" is offset ~1,700 u north of where
anybody lives**, which is why `RIM_IN 0.42` puts the rim's inner edge at z = +278 while Goldspire
sits at z = 1,370 and Cape Harbor at 995 — **the two southern mini-cities are already inside the
rim band.** Today that is invisible because the band is capped at 23 u. Under a rim world it is a
mountain wall 300 m south of Goldspire. **Fix in §3.1; it is a live defect, not a new risk.**

### 1.2 The proposed plate, and the arithmetic that sizes it

**`RIM_BELT`: 2,200 → 4,200 u.** Nothing else changes shape.

```
plate.W = union.W + 2 × RIM_BELT = 9,496 + 8,400 = 17,896      (was 13,896)
plate.D = union.D + 2 × RIM_BELT = 8,245 + 8,400 = 16,645      (was 12,645)
plate   = x [−8,966, 8,930] · z [−10,700, 5,945]                area 297.9 km²  (was 175.7)
rim ring area = 297.9 − 78.3 = 219.6 km² = 73.7% of the world   (was 55.4%)
one corner    = 4,200 × 4,200 = 17.6 km²                        = 8.3× today's Saltlands
```

**Which ceilings must rise, cross-checked against `recon-scale.md §4` and `pillar-scale.md §2.2`:**

| ceiling | today | needed | verdict |
|---|---|---|---|
| `W_ROOF` `continent.js:449` | 15,500, then **`return`** | ≥ 18,000 | **HARD BLOCKER.** 17,896 > 15,500, so on today's code the rim world **silently deletes the continent.** `pillar-scale.md §2.2` already rules the fix: never `return` — clamp `PAD` down, `console.error`, continue. Do that FIRST and this pillar cannot brick a build. Propose **20,000** (2,104 u of headroom, the same ~1.6 k the stage-3 and stage-4 roofs each kept). |
| `PLATE_SEG` `continent.js:732-734` | 368, cap 448 | 471 to hold 38 m cells | **BLOCKED by the cap → plate tiling required.** `pillar-scale.md §2.2` already owns it. 2×2 tiles: 8,948/38 = **236 seg per tile**, four tiles = 4 × 237² = **225 k verts** vs 136 k today. Four draws instead of one — **and that is a net WIN**, because today the continent is ONE draw with ONE bounding sphere and is therefore *never frustum-culled*; tiled, one or two are typically submitted. |
| `CONTINENT_COUNTRY_MARGIN` clamp `continent.js:431-432` | clamp ≤ 2,400 | 4,200 | Raise the clamp. See §5 change 1 — the derivation `pillar-scale` proposes is the wrong shape for this pillar. |
| `RIM_CEIL` `continent.js:702` | 23 u | per-sector (0 → 1,400) | **The whole pillar.** §4. |
| `PLATE_G` / `TERRAIN_PLATE_CLEAR` `terrain.js:110-115` | `PAD + 120` = 2,320 | 4,320 | **Derives already.** No edit. |
| `plateClear()` `terrain_overhaul.js:238-246` | measured off the built plate + 260 | ~4,460 | **Derives already, and it is the fix that found 4,410 m where 2,320 was assumed.** No edit — but **re-measure `backdropAudit().onPlate`**, do not assume. |
| `terrainRingRadii` k `terrain.js:130-146` | half 7,068 → near 7,448 → k **3.92** | half 9,068 → near 9,448 → k **4.97** | Derives already. **But the amplitude does not follow k** — that is `pillar-scale §2.2`'s `TERRAIN_RING_AMP → 4.5 × k` and the exact multiplier this pillar needs is **4.97/3.92 = ×1.27**, or the backdrop shrinks by a quarter as the world grows. |
| `WORLD_SEA_SPAN` `layout.js:492-500` | 25,000 | `(5,110 + 4,200) × 1.7 × 2` = 31,654 → **32,000** | Derives already from `PAD`. No edit; it is a bounds record plus one plane's bounding box. |
| desert `GSEG` `biome_desert.js:560-561` | cap 264 (5.3 m cells) | unchanged | **Deliberately unchanged.** The interior Saltlands keeps its fine bake; the rim erg is megadunes on the plate (§0.6). `DESERT_BAKE_TILES` stays available for the interior and is not this pillar's dependency. |

### 1.3 What stays INSIDE the ring — and it is everything that exists today

**The interior is the settled union, unchanged**: the mainland grid (`world.js:54-66`) with
`pillar-scale` wave 1's growth, all four mini-cities (`minicities.js:69-79`), the speedway,
Halloran Field, the military base, the commerce annex, the govcomplexes
(`govcomplex.js`'s nine own-land rectangles), the arena/venue zones, all 17 registered
settlements (`towngen.js:946`), and **all four existing biome cores** — the Saltlands, Coyle
Valley, Redhollow Woods and Mount Mercy stay exactly where and how big they are.

**That is the design, not a concession.** BOTW's triangle rule makes contrast load-bearing:
*small* foreground hills exist specifically so the *large* background triangle reads as huge
([Nintendo Life on the CEDEC 2017 talk](https://www.nintendolife.com/news/2017/10/zelda_breath_of_the_wilds_ingenious_design_is_all_about_triangles_apparently)).
Today's biomes stop being "the wilderness" and become the **medium triangles** — the middle
ground that obstructs the sightline, hides what is behind it, and by comparison makes the rim
read enormous. Mount Mercy at 3.2 km stops being the mountain and becomes the foothill in front
of the mountain. **Not one of them shrinks; they are re-cast.**

**And the highway ring is already the frontier line.** `highwaynet.js:175-181`'s free-country
loop runs `westX −2,380 / southZ 1,650 / eastX 3,700 / foothillZ −3,400` — a ring road that
sits, by accident, almost exactly on the settled/frontier boundary. After this pillar it is the
LAST ring of the settled world, with the frontier loop 4 km further out as the FIRST ring of the
wilderness. Two concentric rings, one interior, one frontier. **Nobody has to build either.**

### 1.4 The five rim sectors — proposed rects

All derived from the plate rect and a bearing, **never authored** (§3.2). Numbers below are the
values that fall out at `RIM_BELT = 4,200`; the wave writes the derivation and prints these.

| sector | rect (x, z) | size | area | regime | crest |
|---|---|---|---|---|---|
| **THE MERCY WALL** (N/NW) — the massive range + its ice cap | [−6,800, 3,200] × [−10,200, −6,600] | 10,000 × 3,600 | 36.0 km² | `range` | 900–1,400 u |
| **THE KESH SHIELD** (NE) — the second ice, and it is a *sheet*, not peaks | [3,200, 8,930] × [−10,700, −3,000] | 5,730 × 7,700 | 44.1 km² | `shield` | 200–400 u + nunataks to 900 |
| **THE SANDUR** (E) — the one authored hybrid | [3,200, 8,930] × [−3,000, −1,000] | 5,730 × 2,000 | 11.5 km² | `outwash` | 0–40 u |
| **THE GREAT SAND SEA** (SE) — the MASSIVE desert | [3,200, 8,930] × [−1,000, 5,945] | 5,730 × 6,945 | 39.8 km² | `erg` | 60–260 u megadunes, rock massifs to 600 |
| **THE REDHOLLOW REACH** (W/SW) — the BIG FOREST | [−8,966, −3,400] × [−6,600, 2,800] | 5,566 × 9,400 | 52.3 km² | `taiga` | 40–300 u |
| **THE SOUTH BELT** (S) — *the mandated transition, not a corner* | [−3,400, 3,200] × [2,000, 5,945] | 6,600 × 3,945 | 26.0 km² | `steppe` | 0–60 u |

**Total rim sector area 209.7 km² of a 297.9 km² world.** The owner's "make the terrain feel
massive", as a number: **70% of the map becomes frontier.**

Each sector swallows the rim towns already standing in it and gives them a reason to exist:
Kesh (4,300, −2,240) is the last town before the shield — Askole, exactly; Veridia (4,400, −400)
and Solara (4,600, 1,620) become desert cities inside the sand sea; Mbeya (−4,440, −1,600)
becomes a timber town inside the great forest. **Four settlements gain an identity and cost zero
lines.**

**Why the ranges are where they are, checked against the wind (§0.7):** the Mercy Wall runs
across the north and sends its spur down the northwest — so the forest sits on its **windward**
flank (wet, PNW/Chile/NZ-west-coast) and the shield and erg sit in its **lee** (dry). Rain shadow
is always leeward of the moisture-bearing wind, in every real example without exception. That
single fact is what makes the assignment defensible rather than a taste call.

---

## 2. THE TRANSITION GRAMMAR — four seams, four sanctioned answers

The research gives no citable universal blend ratio and says so plainly: hard biome lines read
artificial, real edges are gradients, and blend width should **vary locally** rather than use one
uniform number. So this pillar does not invent a percentage. It picks, for each of the four
seams, the transition that is **legitimately sharp or legitimately gradual in reality**, and
builds that one.

**The scale factor that makes this tractable.** Our world is ~18 km across where a real
continent is ~3,000 km — roughly **1:170**. Real transition widths compress by the same factor,
which is exactly why some real transitions are usable and others are not:

| real transition | real width | at 1:170 | usable? |
|---|---|---|---|
| rain shadow across an alpine crest (Southern Alps: **15,000 mm/yr at the crest → 1,000 mm/yr 30 km east**; Sierra: **3,293 m of relief over 21 km horizontal**) | 20–30 km | **120–175 u** | **YES — sharp is CORRECT here** |
| glacier front → outwash plain → sea (Skeiðarársandur, snout to coast) | 20–30 km | **120–175 u** | **YES**, and we deliberately give it 2,000 u because it is a *landform*, not a blend |
| treeline ecotone (krummholz band) | 0.1–0.5 km | 1–3 u | **too sharp — use the fraction law instead (§2.1)** |
| taiga → tundra (**the longest vegetation transition on Earth, 13,400 km around the Arctic**) | 20–200 km | 120–1,200 u | **YES — gradual, and our forest/range seam wants exactly this** |
| forest → desert with no mountain (**the Sahel: 200–1,000 km wide, commonly 300–500**) | 300–500 km | **1,800–3,000 u** | **UNAFFORDABLE as a seam — so we refuse to place that pair adjacent at all** |

### 2.1 FOREST ↔ RANGE (west → north) — **GRADIENT, by the treeline fraction**

The wet windward flank. The transition is forest → krummholz → bare rock → snow, and it happens
by *altitude*, which means it is already a function this repo owns.

`pillar-scale.md §3.2` promotes `snowCover` (`terrain.js:337-351`) and makes the snowline a
**fraction of the local crest** — `SNOW_WARM = 0.42 C`, `SNOW_COLD = 0.80 C`, derived from
`380/900` and `720/900` against `peakAmp 900` (`terrain.js:549`), returning today's numbers
byte-identically. **This pillar adds the sibling that is missing and it is the same shape.**

Real treelines, read off latitude: tropics >4,500 m · Himalaya ~4,400 m · **Alps (46°N)
1,800–2,400 m** · Rockies 2,500–3,500 m · arctic 60°N+ below 500 m. Against Alpine peaks of
~4,000 m that is **0.45–0.60 of crest**, and the snowline sits above it. Our current ramp
(`terrain.js:344-350`'s `bandColor`) puts vegetation up to `y < 150` on a 900 u peak — **0.167 of
crest, about 3× too low**, and the file's own comment already knows the class of bug ("*a
treeline at 30 on a mountain this tall is a green skirt on a bare cone*").

> **`RIM_TREELINE_FRAC = 0.30`** — the elevation, as a fraction of the local crest, at which
> forest stops and krummholz begins; bare rock from there to `SNOW_WARM = 0.42 C`. At a
> 1,200 u Mercy Wall crest: **trees to 360 u · bare 360–504 u · snow from 504 u · full cover by
> 960 u.** Derived, one dial, and byte-identical at today's crest if seeded at today's ratio.

**No seam object. No blend spec. The mountain's own height is the transition.**

### 2.2 RANGE ↔ ICE (north → northeast) — **GRADIENT, by the Vatnajökull grammar**

Same climate, different landform. Vatnajökull is an ice cap **draped over a 600–800 m plateau**,
with the range's high point (Hvannadalshnjúkur, 2,110 m) rising from its rim, **~30 outlet
glaciers** radiating down valleys to lowland sandurs, and hundreds of **nunataks** — peaks
piercing the ice, 6 m to 300+ m of exposed relief — poking through.

So the seam is: the Mercy Wall's crest carries the cap → the cap spills east as outlet lobes →
the lobes flatten into the shield. **In implementation that is one thing: the `range` regime's
amplitude decays eastward into the `shield` regime's, and `snowCover` paints both.** Nunataks are
the *shield's* peaks, not a separate feature — a handful of 600–900 u spikes on an otherwise
200–400 u dome, which is the Patagonian Ice Field silhouette (granite summits to 4,032 m stabbing
out of the ice with **zero foothills** — the sharpest rock-on-ice contrast in nature, and the
cheapest to draw).

**The shield is the flattest and cheapest corner in the world, and that is correct rather than
lazy.** Greenland's interior is domed ice to the horizon and the mountains reappear only as
nunataks at the margin. The owner asked for "one corner ice too"; a *second range* would have
been the wrong answer twice over — Skyrim's bowl (§0.8) and double the draw cost.

### 2.3 ICE ↔ DESERT (the east edge) — **THE SANDUR: the one authored hybrid**

This is the only place two extremes share an edge, and it gets BOTW's Gerudo-Highlands treatment
executed with a real landform instead of an invented one.

**Skeiðarársandur: 1,300 km², 20–30 km from glacier snout to sea along a 56 km coastline, built
by meltwater plus catastrophic jökulhlaup outburst floods.** Flat. Vegetation-free. Braided grey
and black volcanic sand and gravel. Geomorphologically a desert surface — the same braided/sorted
sediment textures used as Mars and Moon film-set analogues; the only difference from a climatic
desert is that the water came from ice rather than never came at all.

**Ours: 5,730 × 2,000 u = 11.5 km², about a tenth of the real one — proportionate at 1:170 in
one axis and deliberately generous in the other**, because it is doing a second job: it is the
*hard geological seam* Tanagar Canyon does in BOTW, and a seam you can drive across needs width.

Cost, and this is the point: **a sandur is "flat, and painted this colour."** One blend spec
(`worldmap.js:111`), one relief regime that clamps to 0–40 u, one grey-black colour ramp,
braiding from the existing river-bank term (`terrain_overhaul.js:876`'s `rivBank`). **~30 lines.**
It is the cheapest biome in the game and the most defensible.

Second-order payoff, free: **`waterfield.js`/`shoreAt` already answers depth and
`CBZ.fishSpotRegister` self-validates against `cityWaterAt`** — a braided meltwater plain is a
legal fishing environment with zero new code.

### 2.4 DESERT ↔ FOREST — **THEY NEVER TOUCH. This is Just Cause 4's answer.**

Forest→desert with no intervening mountain **requires a belt**, and the belt is 300–500 km wide
in reality (the Sahel; the Great Plains gradient; the Mediterranean maquis→garigue→steppe→Sahara
ladder). At 1:170 that is 1,800–3,000 u of pure transition, which is a whole sector's budget spent
on being neither thing. 2022 PNAS work on abrupt dryland shifts confirms hard forest/desert edges
are real but **always** tied to a specific non-climatic driver — the Nile's irrigation reach
(*Kemet*, "black land", against *Deshret*, "red land", with an essentially instantaneous edge), or
an alternative-stable-state fire feedback (Australian spinifex vs. mulga). **We have neither
driver, so we do not get the hard edge, so we do not place the pair.**

Instead, JC4's construction: route the pair through the hub. Our hub is **the settled interior
plus the SOUTH BELT** (§1.4) — prairie grading to dry steppe as it runs east, which is the Great
Plains gradient by construction and **is where the frontier loop's south leg already runs.** It is
also the cheapest place in the world to put rim settlements and airfields: flat, roadable, warm.

**Consequence for the wave brief, stated as a rule:** *the four corner masses are separated by
gradient, by landform, or by the interior. No two of them share a hard edge. If a future sector
is proposed that would break this, it needs its own §2 entry with its own real-world driver.*

### 2.5 What the seams inherit for free

`BIOME_ORGANIC_EDGES` is already on (`worldmap.js:434`) and already solves the "square biomes"
complaint: a domain-warped superellipse per biome, deterministic off `hash01`, deciding both the
baked land cover **and** the functional `cityBiomeAt` answer, with a seam band of
`clamp(90, s×0.24 + 40, 260)` u (`worldmap.js:454-458`). A rim sector registering a blend spec
gets an irregular, warped, deterministic boundary with **no new code**, and the seam band scales
with the sector's own size up to the 260 u clamp.

**One thing the wave must check:** that 260 u ceiling was chosen when *"the closest two biomes in
this world are 600 u apart"* (`worldmap.js:456-458`). Rim sectors are **adjacent**, so the clamp
is now the binding constraint on seam width. `RIM_SEAM_MAX` should be raised for sectors
specifically — propose **600 u** — and the reason written in the comment, exactly as the original
was.

---

## 3. MOUNTAINS, SNOW, AND WHAT STOPS YOU AT THE EDGE

### 3.1 `rimT` re-keys off the SETTLED union — the live defect from §1.1(b)

Today (`continent.js:705-708`) `rimT` is Chebyshev in the **plate's** normalised half-extents,
so the rim band's inner edge sits at |x| = 0.42 × 6,966 = 2,926 u but |z − (−2,377)| = 0.42 ×
6,322 = 2,655 u — **different absolute distances on different axes, and neither is the distance
from the settled edge.** The band is not a belt; it is an aspect-scaled box around a centre
dragged 1,700 u north by a backdrop envelope.

> **`RIM_METRIC_SETTLED`** — `rimT` normalises against the **settled union** (every registered
> region **except** `underlay` bands and backdrop envelopes), and the rim profile keys on
> **distance beyond the settled edge in metres**, not on a normalised plate coordinate. The belt
> becomes a constant width all round, which is what a belt is.

Separately revertible, because it changes rim relief everywhere in the existing world. Off → the
plate metric returns byte-identically. **Land this before any sector carries amplitude**, or the
south sector's wall lands 1.8 km from Goldspire.

### 3.2 A SECTOR IS DERIVED, NEVER AUTHORED — the block

Directly in the `roadJunctions` / `predatorKit` / `airfieldKit` lineage: *ship the thing that
writes the bundle, or the block sits at one consumer forever.*

```
CBZ.rimSector(id, { bearing, arc, regime, biome, tone })
```

A sector declares **which way it faces and what kind of place it is.** Everything else derives
from the live plate rect and the settled union: the rect, the reach, the seam band, the ceiling,
the amplitude, the treeline, the cover ramp. **No sector types a coordinate.** Adoption is one
line; a fifth corner is a ROW.

What it registers, all through mechanisms that already exist:
- **an organic blend spec** → `CBZ.registerBiomeBlend` (`worldmap.js:111`) → cover colour on the
  plate (`continent.js:1825`), `cityBiomeAt`, map fill, weather, wildlife share, traction. Free.
- **a region record with `underlay: true`** → and that ONE word buys two pinned invariants at
  once: `roadrules.js:902` skips underlay regions, so `roadClearanceAudit().violations` stays 0
  and the frontier loop is not clamped out of the sectors it is supposed to cross; and the math
  gate's overlap sweep filters `!r.underlay` (`math-gate.mjs:183`), so `regionOverlaps` stays 0
  with six new adjacent rects. **Exactly how `continent.js:2079` already registers its wilds
  bands.**
- **a relief regime** → the per-sector replacement for `RIM_CEIL` (§3.3).

**Three consumers migrated in the same change** (Block Law #3): `continent.js`'s uniform
`RIM_CEIL` band becomes the `wilds` regime · `terrain_overhaul.js`'s `snowSector`
(`:447-455`) — today a hardcoded "north of the snow country" window — becomes the `range`
regime's own bearing gate · `biome_desert.js`'s outward feather becomes the `erg` regime. All
three are *deletions of a special case*, which is what proves the API.

### 3.3 The relief story — `RIM_CEIL` becomes a per-sector ceiling

| regime | ceiling | field | why |
|---|---|---|---|
| `wilds` (undeclared belt) | **23 u — unchanged** | today's `rimGain` × `HILL_AMP` | The proof at `continent.js:692-697` survives untouched everywhere no sector claims. **This is what keeps the change surgical.** |
| `range` | 1,400 u | `terrain_overhaul.js`'s existing ridged-lobe field (`RIDGE_AMP 320`, `:393`) un-gated from `snowSector`, + `biome_snow.js`'s `TERRAIN_PEAKS_V2` hierarchy law | The peak-hierarchy law (shoulder share capped at 0.168, strictly under `1/5.754`) **already guarantees one dominant summit** — which is the "weenie" landmark §3.5 needs, for free. |
| `shield` | 400 u dome + nunataks to 900 | one broad dome + a handful of discrete spikes | Greenland/Patagonia. Flattest field in the world. |
| `erg` | 260 u megadunes + rock massifs to 600 | a coarse dune term on the plate's own vertices | 38 m cells resolve 1–3 km megadune wavelengths with room to spare (§0.6). |
| `taiga` | 300 u | today's `rimGain` at raised amplitude | Rolling forested hill country; the wet windward flank. |
| `outwash` | 40 u | near-flat + braiding off `rivBank` | A sandur is flat. That is the whole spec. |
| `steppe` | 60 u | today's `rimGain`, unchanged amplitude | The mandated belt; it should read as *nothing between two somethings*. |

**Snow across the whole rim, under the promoted law.** `pillar-scale.md §3.2`'s `CBZ.hasSnowCover(x,z)`
is the prerequisite and this pillar is its largest consumer: snow appears **wherever a rim crest
is high enough and the slope shallow enough to hold it**, which is the owner's model
(`terrain.js:337-351`: altitude band × angle-of-repose shedding at 0.42/0.74 ≈ 25°→45° × sun-aspect
melt × `hash01` patchiness) applied to ground it has never been allowed to touch. The Mercy Wall
gets a snow *apron* rather than a snow *rectangle*; the shield is snow at 300 u because it is a
polar dome; the erg's 600 u rock massifs get **none** because a hot desert massif is bare, and that
is a correct answer the current gate cannot express (§4).

### 3.4 The backdrop rings' new role — they retreat, and they should

`terrain_overhaul.js:206-246` made the offshore skyline ranges unreachable by **measuring**
`plateClear()` off the built plate (the fix that found 4,410 m where 2,320 had been assumed), and
`backdropAudit().onPlate` is pinned **0**. That machinery derives, so a 2,000 u wider plate pushes
the rings 2,000 u further out with **no edit** — the tile SPAN is literally
`liveSpan + 4400 + 2 × plateClear()` (`:230-232`).

**But `snowSector` (`:447-455`) must relax, and the reason it was there is satisfied differently
now.** The gate exists because the owner said mountains should be *"only on the snow island's
side, far from every city, from any angle."* Under a rim world **the cities are interior and the
relief is the rim** — so "far from every city" is satisfied by geography rather than by a bearing
window. The generalisation is: **the backdrop carries relief on any bearing that has a `range` or
`shield` sector in front of it, and open sea on every other.** Same rule, sector-driven.

**Re-measure `backdropAudit().onPlate`. Do not assume.** It is the invariant most likely to break
and the last person who assumed was wrong by 2.1 km.

### 3.5 THE EDGE FICTION — what actually stops you, per side

The most repeated finding across every game researched: **pair the cosmetic edge with a real
diegetic cost.** JC4's weather cylinders, GTA V's engine damage + instant-kill shark, BOTW's cold
without warm gear, Skyrim's fall hazard on the Seven Thousand Steps. *"The world defeats you here"*
is the fiction players tolerate; *"the world stops you here"* is not.

| side | what stops you | cost to build |
|---|---|---|
| **South, East, West outer edges** | **THE SEA — and GTA V's exact answer is already shipped in this repo.** Open water past the plate, and `wildlife_shark.js` + `predatorHunt`/`predatorSeize` (`systems/predator.js`) is a great white that stalks, commits and takes you. `swim.js`'s `SWIM_SINK` gives a 28 s breath meter and a real drown through `cityHurtPlayer(..,"drowned",..)`. | **ZERO.** Every line exists. |
| **North outer edge (the Mercy Wall)** | **THE TERRAIN REFUSES.** `snowCover`'s shed law means nothing lies above slope 0.74 (~45°), so the high wall is bare rock and ice; the ridge simply gets steeper than a vehicle or a climb can take. Skyrim's Throat-of-the-World answer: no invisible wall, a real fall. | **ZERO** — it is a consequence of the amplitude. |
| **The soft fade past everything** | JC3's trick, already ours: the rendered ocean is a **camera-centred radial disc** (`world/water_spec.js`), so open sea extends indefinitely in appearance past a `WORLD_SEA_SPAN` of 32,000 u. | **ZERO.** |
| *candidate, not required* | **COLD as the Mercy Wall's and the shield's diegetic cost** (BOTW's answer). No exposure/temperature system exists in the repo today. Named here so a future wave can claim it; **this pillar does not depend on it.** | a wave of its own |

**Explicitly refused: an invisible wall anywhere.** Every side already has a real answer.

---

## 4. THE GATE — the invariant has to be redefined a THIRD time, and here is why

`math-gate.mjs:170,177` fails when `mtnOutSnow > 60`: any cell with `max(terrainHeight,
snowTerrainHeightAt) > 25` whose `cityBiomeAt` is not `"snow"`. A rim world with a 1,400 u range
in the north, a 900 u nunatak in the northeast and a 600 u rock massif in the southeast produces
**thousands** of those cells, every one of them intentional.

`pillar-scale.md §3.4` already saw half of this and proposed **`mtnUncovered`** — cells above MTN
where `hasSnowCover < 0.15` — pinned 0, stricter than today. **That is right for a snow range and
WRONG for this pillar**, because it would fail a legitimate bare desert massif and a bare
sun-facing rock face, which are the two most realistic things on the rim.

> **THE THIRD FORM. `mtnUnclaimed`** = cells with `h > MTN` that lie inside **no declared rim
> sector whose regime permits relief**, and carry no snow cover. **Pinned 0.**
> `mtnUncovered` and `mtnOutSnow` are **computed and PRINTED beside it forever**, so a "fix" that
> merely declares a bigger sector cannot hide anything and the two older numbers stay visible as a
> census.

**Why this is stricter, not weaker, and put this in the commit message:** the original intent was
never *"mountains live in a rectangle"* — it was ***"you never see a bare green mountain."*** The
old gate could pass a mountain inside the snow rect that is drawn bare (it never looked at the
ground) and could pass a hill in green country as long as it sat in the right rectangle. The new
one asks the only question that matters: **is this height DECLARED, and does its cover match what
was declared?** Every cell the old gate accepted for the right reason the new one accepts. Every
cell it accepted for the wrong reason the new one rejects. The accepted set shrinks on the failure
axis and grows only where the owner explicitly asked.

**Sequencing, and it is not negotiable:** `hasSnowCover` + `mtnUnclaimed` land **before one sector
carries one metre of amplitude.** A ceiling lift under a containment invariant is exactly how you
get a green mountain, and `pillar-scale.md §3.4` already says so.

### 4.1 The three other invariants at risk, each with its answer

1. **`cityOnMountain` 0 — the one that can actually fail.** Kesh, Veridia, Solara and Mbeya sit
   *inside* rim sectors by design, and three of the four match the gate's `/city|urban|downtown|
   commerce/i` test (`math-gate.mjs:171`) via "veridiacity"/"solaracity"/"mbeyacity".
   `TERRAIN_FLATTEN_UNDER_BUILT` (`continent.js:713-737`) zeroes country relief under a built slab
   for one whole plate cell plus a 110 m fade — **but the gate takes `max(terrainHeight,
   snowTerrainHeightAt)` and `snowTerrainHeightAt` is `terrain_overhaul.js`'s separate V3 oracle,
   which the built-ground gate does not run through.** **HARD REQUIREMENT: every rim regime's field
   must pass through the same built-ground gate, or the first seed with a nation town near a crest
   fails the gate.** This is the single most likely way the wave breaks and it is arithmetic, not
   luck.
2. **`backdropAudit().onPlate` 0** — §3.4. Derives, but **re-measure**.
3. **`groundMatchAudit()` `maxErr` / `ungated`** — `pillar-scale.md §2.2` warns plate tiling
   changes how the physics floor samples the drawn plate. This pillar makes that worse in one
   specific way and better in another: worse, because rim relief means the plate is no longer
   near-flat out there, so the *"sample the plate's OWN vertices across the plate's OWN
   triangles"* law (CLAUDE.md's `TERRAIN_PHYSICS_MATCH`) now matters over 70% of the world instead
   of 30%; better, because that law is already exact (0.0002 m mean) and 45× cheaper than the old
   analytic path. **Measure per tile.**

### 4.2 The gate's own cost, which nobody has budgeted

`math-gate.mjs:150-154` sweeps `STEP = 50` over `FLAT ± 400`. `FLAT` is grown live over every
registered region (`terrain.js:152`), so registering six rim sectors grows it to roughly the
plate: span 5,185 → ~9,348, cells **43 k → ~140 k, a 3.2× rise in the gate's terrain sweep**, on
the gate that is supposed to be 1–2 minutes for two seeds.

**Fix in the same wave, and it is a one-liner: make `STEP` derive so the CELL COUNT is constant**
(`STEP = max(50, span / 104)`), and report the effective step. A rim world sampled at 50 m and a
compact world sampled at 50 m are not measuring the same thing anyway — they are measuring
different *fractions* of the world.

---

## 5. RECONCILIATION WITH `pillar-scale.md` — what changes, what survives

**SURVIVES ENTIRELY, and this pillar depends on it:** §1 (the `cityGridStamp` unification, the
height table, `cityDetailBudget`, the draw-call budget law) · §2.1's derivation discipline · §2.2's
`W_ROOF` clamp-instead-of-return, `PLATE_SEG` tiling, `TERRAIN_RING_AMP × k` · §2.4's
`roadCorridorMid` and the death of the seven highwaynet literals · §3.1–3.3's `hasSnowCover`
promotion and fractional snowline · §5 wave 1 in full · §5's "what I am deliberately NOT doing"
list.

**CHANGE 1 — the country margin's derivation is the wrong SHAPE for a rim world.**
`pillar-scale §2.2` proposes `margin = clamp(1200, 0.46 × halfExtent, 6000)`, justified because
`2200 / 4748 = 0.463` — today's value already *is* that fraction. Correct arithmetic, wrong
consequence: it pins the rim at a **constant fraction of the interior**, so growing the city grows
the frontier and nothing else can. This pillar needs the belt to grow *independently*.
**RULING: `RIM_BELT` becomes a first-class dial (default 0.463 × halfExtent = today's 2,200,
byte-identical; this pillar sets 4,200), and the fraction survives as the FLOOR, not the target.**
`clamp(1200, max(RIM_BELT, 0.463 × halfExtent), 6000)`, with the clamp roof at
`continent.js:431-432` raised from 2,400 to 6,000 to match `pillar-scale`'s own ceiling.

**CHANGE 2 — `RIM_CEIL` is not "selectively lifted"; it is replaced by a per-sector ceiling.**
`pillar-scale §3.5` lifts the single ceiling gated on snow cover — right for an alpine rim, wrong
for an erg (a hot massif is bare by definition) and for a shield (flat by definition, and
snow-covered at 300 u where a 23 u hill would be bare). **RULING: `RIM_CEIL` becomes
`sector.ceil`; the undeclared belt keeps 23 u and keeps its by-construction proof
(`continent.js:692-697`) untouched.** `pillar-scale §2.2`'s "HILL_AMP DOES NOT SCALE" row survives
verbatim — hills still do not scale; **sectors do.**

**CHANGE 3 — the gate invariant needs the third form.** `mtnUncovered` pinned 0 would fail a
legitimate bare desert massif. **RULING: `mtnUnclaimed`, per §4**, with `mtnUncovered` and
`mtnOutSnow` printed beside it forever. `pillar-scale`'s sequencing rule (redefine before lifting)
is adopted unchanged and is *more* load-bearing here.

**CHANGE 4 — `rimT` re-keys off the settled union.** New; `pillar-scale` did not touch it. §3.1.

**CHANGE 5 — `pillar-scale` wave 4 ("more than one city") stops being optional polish and becomes
the rim's POI-fill wave.** It is now the wave that decides whether the frontier is Blaine County or
Mountaintops of the Giants. It gets a ratchet (`poiGapMax`) and it gets promoted in priority.

**CHANGE 6 — the desert's foot scale does NOT go to 2.6–3.0.** `pillar-scale §2.3` proposes
scaling `worldFoot("desert")` 1.60 → ~2.6–3.0 and tiling the bake. **RULING: the interior
Saltlands keeps its scale and its 5.3 m bake, and the MASSIVE desert is the rim `erg` sector
instead** — because (a) growing the foot grows the region union, which grows the plate, which
costs `W_ROOF` *twice*, and (b) a 4 km sand sea's landform is megadunes, which the plate already
resolves. `DESERT_BAKE_TILES` stays a good idea for the interior and stops being this pillar's
dependency. **This is the change that saves the most work.**

**THE PROPERTY WORTH REPEATING BECAUSE IT IS WHY THIS PILLAR IS CHEAP:** `SPREAD_V5` is a **no-op
on every existing landmass**. `pillar-scale` wave 1's +130 u radial walk (to absorb the bigger
mainland) still stands; beyond that, **not one biome, mini-city, nation, causeway or pinned axis
moves.** Every "was / is" strait number in `layout.js:215-357` stays true. The seven highwaynet
literals are not re-measured a third time by this pillar (though §2.4 should still kill them, for
its own reasons). **The rim world buys a 70%-frontier map without a world re-lay, and that is the
argument for doing it this way rather than by moving biomes into corners.**

---

## 6. TRAVEL-TIME ARITHMETIC — and why the airports are the enabling condition

### 6.1 The speed table, measured off this repo

`vehicles.js:2313-2321` — coupe **top 44 m/s** · muscle 41 · sedan 35 · default 33 · suv 31 ·
pickup 32 · hatch 31 · van 29. `playeraircraft.js:154,179` — airliner `vmax` **240 m/s** under
`WING_V2` (105 stock); `JET_MIN = 38`. `config.js:169` — walk 2.0 m/s, sprint 6.4.
`aircraft.js` search-posture helicopter 26 m/s (`GAMEPLAN §3.3`).

### 6.2 The budget

| journey | distance | fast car 40 m/s | realistic 25 m/s | airliner 240 m/s |
|---|---|---|---|---|
| **today's plate**, long axis | 13,896 u | 5.8 min | 9.3 min | 58 s |
| **rim plate**, long axis | 17,896 u | **7.5 min** | 11.9 min | 75 s |
| **rim plate**, short axis | 16,645 u | 6.9 min | 11.1 min | 69 s |
| **rim plate**, diagonal | 24,437 u | **10.2 min** | **16.3 min** | 102 s (**~3–4 min gate to gate** with taxi, climb, descent) |
| downtown → far plate corner | 11,145–13,419 u | 4.6–5.6 min | 7.4–8.9 min | ~2.5 min |
| **the settled interior alone** (unchanged) | 9,496 u | **4.0 min** | 6.3 min | 40 s |
| frontier loop, one full lap | 67,562 u | 28 min | 45 min | 4.7 min |

**Read against the only published tolerance band there is:** crossings that are remembered fondly
cluster at **8–20 minutes**. GTA V: **8 min** best-route highway, **17:52** full scenic traverse,
Paleto Bay → Los Santos under 8 min, on **75.84 km²**. RDR2: **16 min** at full gallop, ~21 with
detours. BOTW: **28 min** jogging north–south, ~33 east–west. The Crew 2: 1 hr 6 min coast to
coast on ~5,000–7,000 km² — the outer edge of anybody's patience. FUEL: **14,400 km²**, a Guinness
record, panned as *"incredibly long and boring road trips."*

**Our 7.5–16.3 min sits inside the band, at ~3.9× GTA V's area.** That is the arithmetic answer to
"is 297.9 km² too big": no, and the reason is the next paragraph.

### 6.3 The finding that decides how we spend the difference

**Game cars are slower than their real analogues, on purpose.** The fan-derived GTA V conversion
against the real Suzuki Hayabusa lands near an **8:10 ratio**, and GTA's flagship hypercar tops out
near 120 mph against a real one's 250+. Multiple sources call this deliberate: **Rockstar compresses
the MAP far more than it compresses VEHICLE SPEED, so a smaller-than-real world still takes a
real-feeling number of minutes to cross.** GTA V's *effective* cross-map speed — ~10 km in 8 min —
is about **21 m/s**, against top speeds more than double that.

Our coupe at 44 m/s = 158 km/h is roughly a real car, and on a long straight frontier road it will
actually hold that. **RULING: do not slow the cars.** Slow the *frontier*, which is what a frontier
is: the rim carries **unpaved track, not highway** (`roadrules.js`'s `roadSpeedLimit` and the road
record's own `district` weighting already express this), the loop bends around sectors instead of
running arrow-straight, and terrain pitch/roll through `seatCar` makes 44 m/s on a dune field a
choice with consequences. **The fast way across the rim is a plane. That is the design, and it is
the owner's own sentence: "this goes with the big airport gameplan."**

### 6.4 What the airports actually buy, in numbers

`GAMEPLAN §3.3` sizes the airfield stamp: **17 registered settlements, 2 runways** today; the kit
puts a tier-0 strip at ~5 draws and a tier-1 regional field at ~34, sited `D = max(hx,hz) + 160`
on the side facing **away from map centre** — *which, in a rim world, means every new field points
at the frontier*. That placement rule was written for a different reason and it happens to be
exactly right here.

- **The longest possible flight in the rim world (~3–4 min gate to gate) is half of GTA V's
  cross-map DRIVE.** A world 3.9× GTA V's size where the worst journey is 4 minutes.
- Just Cause 3's playtesters, chaining wingsuit and grapple, stayed airborne **2–3 minutes** before
  landing — the closest thing to a sourced sweet spot for skill-driven aerial traversal. Our
  3–4 min sits just past it, which is exactly why `GAMEPLAN §3.3`'s optional **`SLEEP THE LEG`**
  verb exists and why the leg must have a **window**.
- **Menu warps erase scale; diegetic fast travel compresses it while keeping it visible.** Far
  Cry 6 routes even its fast-travel command through a skydive flythrough for precisely this
  reason. GTA V shipped with no fast travel at all because *the vehicles are the fast-travel
  system* — and then added a menu warp to GTA Online seven years later under player pressure.
  **We are the GTA V case and we should stay there:** the plane is the fast travel, the rim is
  what you see out of the window, and there is no map warp.

### 6.5 The one thing altitude takes away, and how the rim gives it back

**A compressed world seen from high enough becomes legible as small** — its edges enter a single
view. WoW's flying mounts are the standing example: revelatory in 2007, now broadly understood to
shrink a world's *felt* size once traversal is frictionless from the air. The horizon formula is
`d(km) ≈ 3.57 √h(m)`: at our airliner cruise of **900 m** (`GAMEPLAN §3.3`: `ALT = 900 + 120 ×
legIndex`) the horizon is **107 km** — our entire 18 km world, six times over.

**The counter is not distance. It is that the rim range's crest reaches the cruise band.** A wall
at 900–1,400 u against a cruise at 900–1,400 u means you fly **beside** it, not over it, and a
world you fly beside is not a tabletop. That is not something to engineer: `terrain.js:549-553`
already runs `peakAmp 900/1250`, and the measured tops of the backdrop range in the
`TERRAIN_BACKDROP_CLEAR` bug report were **1,441 m and 1,270 m**. **The numbers already agree; the
rim wave's job is to put them on the plate instead of past it, and to leave the cruise altitude
alone.**

### 6.6 THE ANTI-EMPTINESS BUDGET — the number this pillar lives or dies on

Empty wilderness is a feature when there is a traversal verb worth doing (RDR2's slow ride,
Death Stranding's route planning, Just Cause's grapple) and a bug when there is not (JC3's filler
criticism, FUEL's record-holding boredom, No Man's Sky's *"procedural generation in search of a
game"*).

The cadence numbers that exist: **The Witcher 3's "40-second rule"** — CD Projekt Red living-world
designer Bartosz Ochman, on record, targeting something new for the player to see and focus on
roughly every 40 seconds. A circulating design-blog consensus (flag it as consensus, not primary)
puts POI spacing at **60–120 s** at default movement speed. The floor is known too: Far Cry 2's
~30 s checkpoint cadence is one of the most-hated decisions of its generation.

At a rim traversal speed of 35 m/s:

```
40 s  → 1,400 u   (the ideal)
120 s → 4,200 u   (the ceiling)
frontier loop 67,562 u  ⇒  16 POIs minimum on the ring, 48 at the ideal
```

> **`rimAudit().poiGapMax` ≤ 4,200 u**, measured along the frontier loop and along every radial
> approach road. **This is the anti-Mountaintops-of-the-Giants ratchet and it is the most
> important number in this document.**

**Sixteen is reachable from generators that already exist or are already planned, with zero new
content types:** a rim settlement (`cityGridStamp`) · an airfield (`airfieldKit`) · the four
nation towns (they are already there) · a fuel stop / roadhouse (`towngen` template) · a named
summit or nunatak · a `venueSite` fenced compound · a fishing spot (`fishSpotRegister`, and the
sandur is a legal one) · a legendary animal's range (`wildlife.js`) · a `contracts.js` giver bound
to any of the above. **Nothing on that list is new work in this pillar. It is scheduling.**

---

## 7. WAVE SEQUENCING, FLAGS, RATCHETS

Disjoint file territories, one owner per file per wave. Builders build and read; **the
orchestrator runs the gate once on the merged state.** Every wave names what it RECALIBRATES and
what it PRESERVES.

### PREREQUISITES — not this pillar's waves, but this pillar cannot start without them
`pillar-scale` wave 2's **`W_ROOF` clamp-instead-of-return** (without it the rim world silently
deletes the continent) and **`TERRAIN_PLATE_TILES`**; `pillar-scale` wave 3's **`hasSnowCover`
promotion + fractional snowline**. **If only one of the three ships first, make it the `W_ROOF`
clamp** — it is three lines, it converts a silent world-deletion into a loud non-fatal error, and
it is worth more permanently than any number.

### RIM R1 — THE LAW *(no amplitude anywhere; the world must come out byte-identical)*
**Territory:** NEW `src/world/rim.js` · `city/continent.js` (`rimT` re-key, the per-sector ceiling
hook, the `RIM_BELT` clamp) · `city/worldmap.js` (`RIM_SEAM_MAX`) · `config.js` · `index.html`.
**Ships:** `CBZ.rimSector`, the derived-rect law, the six sector declarations **all at `wilds`
regime and 23 u**, the underlay region records, the blend specs, `RIM_METRIC_SETTLED`, and
`CBZ.rimAudit()` reporting.
**Flags:** `WORLD_RIM_V1` (master) · `RIM_BELT` 2200 (**unchanged in R1**) · `RIM_METRIC_SETTLED`
(separately revertible) · `RIM_SEAM_MAX` 600.
**RECALIBRATE:** nothing. **PRESERVE: everything, including the biome histogram** — R1's whole
proof is that declaring six sectors at today's ceiling produces today's world. If the histogram
moves, a blend spec is claiming ground it should not.

### RIM R2 — THE BELT AND THE GATE *(the world gets bigger; still no amplitude)*
**Territory:** `city/continent.js` (`RIM_BELT` → 4200, `W_ROOF` → 20000 as a clamp) ·
`world/terrain.js` · `world/terrain_overhaul.js` (`TERRAIN_RING_AMP × k`, `snowSector` →
sector-driven) · `tools/math-gate.mjs` (`mtnUnclaimed`, the derived `STEP`).
**Flags:** `RIM_BELT` 4200 · `TERRAIN_RING_AMP_K` (`pillar-scale`'s) · `MTN_UNCLAIMED_GATE`.
**RECALIBRATE deliberately:** the biome histogram and cell counts (the sweep area changes) ·
`MTN_OUT_SNOW_MAX` stops being the failing condition and becomes a printed census.
**PRESERVE — the two most at risk:** `backdropAudit().onPlate` **0** (*re-measure the plate's true
reach; never assume*) and `groundMatchAudit()` `maxErr`/`ungated` (**measure per tile**). Plus
`cityOnMountain` 0, region overlaps 0, `roadClearanceAudit().violations` 0, determinism.

### RIM R3 — THE AMPLITUDE *(the wave the owner will see)*
**Territory:** `src/world/rim.js` (the regime fields) · `world/terrain_overhaul.js` (the range
field un-gated) · `city/biome_desert.js` (the erg's megadune term) · `city/biome_forest.js` (the
tree grid extended over the taiga sector) · `world/terrain.js` (`RIM_TREELINE_FRAC`).
**Flags:** `RIM_SECTORS` · `RIM_RANGE_AMP` · `RIM_TREELINE_FRAC` 0.30 · `RIM_SANDUR` ·
`RIM_ERG_MEGADUNE` · `RIM_TAIGA_TREES` (**separately revertible — it is the only real draw-call
cost in the pillar**).
**The draw-call bill, stated honestly:** `biome_forest.js:367` re-rates its grid pitch
`STEP = 11 × √FSC` so tree COUNT grows linearly with footprint. A 5,566 × 9,400 taiga sector at
that law is roughly **4× today's tree count**. That must land under
`drawBudgetAudit().predictedCalls` (`pillar-scale §1.5`, the CEILING ratchet) or ride the fauna
pillar's instanced proxy. **This is the one number in this pillar that can regress the frame, and
it has its own flag so it can be turned off alone.**
**RECALIBRATE deliberately:** the biome histogram · GOLDEN if any sector adds a settlement region.
**PRESERVE:** `mtnUnclaimed` 0 · `cityOnMountain` 0 (**the hard one — §4.1(1): the regime fields
MUST run through `TERRAIN_FLATTEN_UNDER_BUILT`, or a nation town near a crest fails**) ·
determinism (every regime field uses `hash01`/`seedStream`, never `Math.random`).

### RIM R4 — THE FILL *(this is the wave that decides whether the pillar worked)*
**Territory:** `city/minicities.js` / `city/citytemplates.js` (`pillar-scale` wave 4's territory,
promoted) · `city/airfield.js` (`airfieldKit` per rim settlement) · `city/contracts.js` (rows bound
to rim places) · `city/wildlife.js` (rim species shares).
**Flags:** `RIM_POI_FILL` · `RIM_SETTLEMENTS`.
**Ratchet: `rimAudit().poiGapMax` ≤ 4,200 u — pinned, and this wave exists to satisfy it.**
**Binding rule, inherited from `contracts.js`:** *the generator picks the verb, the WORLD supplies
the specifics.* A rim contract binds to the ped, lot, vehicle or officeholder the simulation was
already running, and is not offered at all if the frontier cannot supply one.

### The ratchet
> **`CBZ.rimAudit()`** → `{ sectors, beltW, plateW, plateD, rimAreaFrac, poiCount, poiGapMax,
> mtnUnclaimed, mtnUncovered, mtnOutSnow, sectorOverlaps, roadsInSector, crestRatio,
> settledSpan, sweepStep }`
>
> - **`poiGapMax` ≤ 4,200 u** — the anti-emptiness gate (§6.6).
> - **`mtnUnclaimed` 0** and **`sectorOverlaps` 0** — hard.
> - `mtnUncovered` and `mtnOutSnow` **printed beside them forever**, so a "fix" that declares a
>   bigger sector cannot hide a real violation.
> - `rimAreaFrac` printed — it is the owner-facing "how much of the world is frontier" number.
> - `crestRatio` printed — max sector relief ÷ distance to the nearest settled edge. **Target
>   inside 1:6 … 1:25**, the envelope measured from three real vantages: Owens Valley → Sierra
>   escarpment **1:6.3** (3,293 m over 21 km), Denver → Front Range **1:18.5**, the Gangetic Plain
>   → Himalaya **1:23–25**. All three read as unmistakably monumental, and all three put a **flat,
>   uncluttered foreground** in front of the range — which our settled plains already are. At the
>   proposed Mercy Wall (crest z ≈ −8,400, 1,200 u of relief, 7,700 m from downtown) the ratio is
>   **1:6.4 — the Owens Valley number.**
> - **NOT YET MEASURED.** Ships REPORTING, not failing, until somebody runs it and writes the
>   numbers in. The `propUseAudit` law: an audit nobody has executed is not a measurement.

---

## 8. THE HONEST COST LINE

**What is genuinely cheap, and why:** the rim's *geometry is already drawn.* The continent plate
covers every metre of the belt and already bakes land cover off the blend field
(`continent.js:1825`); the frontier loop already exists and already pushes road records
(`:1575-1631`); `plateClear`, `PLATE_G`, `terrainRingRadii`, `WORLD_SEA_SPAN` and
`TERRAIN_FLATTEN_UNDER_BUILT`'s band **all derive from the plate and need no edit at all**; the
edge fiction on three sides is a shark and a breath meter that both shipped; the hero-peak
hierarchy is guaranteed by `TERRAIN_PEAKS_V2`'s existing 0.168 shoulder cap; the sandur is thirty
lines because a sandur is flat. **No landmass moves.** The whole pillar is roughly
**`rim.js` ~350 lines + ~80 changed in `continent.js` + ~60 in `terrain_overhaul.js` + ~60 in
`biome_desert.js` + ~40 in `biome_forest.js` + ~30 for the sandur + the gate.**

**What is genuinely expensive, named without softening:**
1. **R4, the fill.** Terrain is one wave; *sixteen reasons to go there* is another, and it is the
   one that has no shortcut. Elden Ring shipped its rim regions with the vista and without the
   density and they are the weakest thing in the game.
2. **The taiga's trees** — ~4× today's count, the only real draw-call cost, on a renderer whose
   own 2026-07-10 measurement said *"safe headroom is mostly exhausted"* at 2,668 calls. Own flag,
   own measurement, may have to wait for the instanced proxy.
3. **Three prerequisite waves from `pillar-scale`** that must land first, and one of them
   (`W_ROOF`) is a hard blocker that silently deletes the continent if skipped.
4. **The gate's sweep cost**, 3.2× at STEP 50, fixed by deriving STEP — cheap to fix, expensive to
   discover at 2 a.m.
5. **`cityOnMountain` through `snowTerrainHeightAt`** (§4.1.1) — the one failure mode that is
   arithmetic rather than bad luck, and the wave brief must state it as a hard requirement rather
   than a risk.

**What this pillar refuses:** an invisible wall (every side has a real answer) · a continuous
mountain ring (Skyrim's bowl) · moving any existing landmass (a re-lay is the most expensive thing
in this repo's history and this design does not need one) · a second town generator, population
system, water system or LOD path · scaling the desert's *footprint* when the rim erg is the
cheaper and more correct answer · **pinning a single unmeasured ratchet.**

**The sentence for the owner:** *the map already has 97 km² of empty rim you have never had a
reason to drive to; this makes it 220, gives each corner a climate that explains the one next to
it, and puts the far edge four minutes away by air instead of sixteen by road.*
