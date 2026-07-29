# RECON: FLAG CENSUS (scout report, 2026-07-27)

## Bottom line
**No hidden city exists.** Every place/venue system (SETTLEMENTS_V2's 17 settlements, CASINOS_V1, ARENA_FIGHTS/ARENA_SITE, MARINA, SPEEDWAY_SITE, GOV_COMPLEX's nine seats, HIGHWAY_NET_V2) defaults TRUE and is built. 549 unique CBZ.CONFIG flags across ~80 files; only 19 default OFF; the rest are live gates or numeric tunables.

## DORMANT CONTENT (real, complete, OFF)
- **CITY_HITMAN_CAMPAIGN** (config.js:667, redeclared campaign.js:40) — a complete 2,048-line authored narrative campaign: helicopter-arrest cold open, prison chapter with warden dialogue, spy-insertion branch, endless contract-loop end-state. Clean early-returns, zero waste when off. THE hidden-content headline. Product decision: default new-game experience vs menu choice.
- **DYNAMIC_WEATHER** (config.js:662, systems/weather.js:34) — full rain/storm/lightning/wet-grip system; off because of a HUD/jail-leak bug described in its comment. Bug-fix opportunity, not a permanent no.
- **BLD_EXTRAS** master cascade (config.js:820) → forces false: BLD_MASONRY_V1/_TEXTURE, DETAIL_BUILDING_DRESS, BLD_ROOF_CLUTTER_V1, BLD_WEATHERING_V1, DETAIL_GROUND_GRIME. A complete shelved art direction (brick/masonry facades + weathering); civic buildings exempted and live.
- **CITY_FLAVOR_FEED** (config.js:736) — world-narration prose lines, text-only.
- CBZ.CITY.playerSpawn (config.js:245, not a CONFIG flag) — defaults "story"; its comment records the one real hidden-content incident ("exactly what was hiding the nine stories"). Already fixed.

## CONFIRMED DEAD
- **GORE_HIT_FEEDBACK_V2** — duplicate contradictory declarations (config.js:1111 false "RETIRED/INERT" wins over :1158 true); ZERO consumers outside config.js. Hard-delete both blocks.
- **FX_EXPLOSION_RINGS** (crashfx.js:214, checked `=== true`) — no ON path exists anywhere. Wire or delete.

## FLICKER FINDINGS
- **WATER_REFLECT (default true)** — the one genuine per-frame `.visible` risk: waterfx.js onAlways(93.5) applyMode() every frame sets `reflect.visible = on; flatSea.visible = !on` where `on` includes the LIVE adaptive quality tier — if FPS hovers at the "Balanced" boundary, two sea meshes flip visibility per frame. A quality-governor hysteresis fix, not a purge target.
- WATER_WAKE_FX / CCTV_V1 / holsterprops read flags per-frame against .visible but only as defensive guards (meshes lazily built after first pass) — no steady-state flicker.
- **No default-false flag builds meshes/colliders while off** — every one sampled early-returns before geometry. The flag idiom is clean; the "waste" fear does not materialize.

## OWNER-VETOED (closed decisions — delete branch, keep behavior)
CRAFTING_ENABLED ("owner's call: crafting is dead"), FACADE_AC_UNITS, CITY_REFLECTIVE_GLASS, LOCKON_SQUARE_SPIN, DESERT_ROCK_SCATTER (note: its dead loop still draws rng ON PURPOSE for determinism), CAM_SPRINT_FOV.

## DO NOT PURGE — 2026-07-27 waves (hours old)
Evening: BIOME_ORGANIC_EDGES, DESERT_DUNES_V3, ARENA_SITE/SPEEDWAY_SITE, ROLE_VERBS/OBJECT_VERBS, WILDLIFE_FOODCHAIN/_CAR_IMPACT, VEHICLE_GLASS_V2, GOV_INTERIORS, INTERIOR_EMPTY_VARIETY/_LIGHT_DAY, BOMBS_DROP_STRAIGHT, MIL_MISSILE_HOMING. Night: ARREST_ARC, PRISON_PIPE, ORDNANCE_BUS_ALL, CAR_COOKOFF_V2, STRAT_B2_PLUME. Late-night: INTERACT_REACH_V2, AIM_CHILD_NO_ASSIST, PROPS_PURGE_V1/_KNOCK_PLAYER, INTERIOR_COHERENCE_V1/_LIFE_V1, AIR_TRAFFIC_CLEARANCE(false)/AIR_TRAFFIC_COLLIDE(true), TERRAIN_DARK_RANGE(false).

## KEEP AS KILL SWITCHES
Today's two false flags (mid-iteration); the WATER_V2/MOUNT_*/TERRAIN_*/GFX_*/RENDER_* quality families (protect weak hardware); STRAT_NUKE/_BUNKERS/_B2 (blast-radius content); PRIO_WARN/BUILD_FREE (dev toggles).

## PURGE SHORTLIST (delete flag, keep/promote behavior)
1. GORE_HIT_FEEDBACK_V2 (dead, both config blocks).
2. FX_EXPLOSION_RINGS (dead check).
3. CRAFTING_ENABLED + systems/craft.js gate/panel (owner-declared dead; itemStore stays — buildmode reads it).
4. The six owner-vetoed branches above.
5. Surface-or-decide: CITY_HITMAN_CAMPAIGN (product call), BLD_EXTRAS (shelved art direction), DYNAMIC_WEATHER (fix the leak bug then default on?).

## LIVE-ON note for designers
~530 live flags group into: world/terrain (WORLD_ENLARGE_V2→WORLD_SCALE_V4 chain, WATER_V2 family, TERRAIN_* family), buildings/venues (all TRUE), NPC sim (OCCUPY_V1, FACTION_V1, POWER_*, VENUE_STAFF), police/combat (CITY_ARREST_FIRST, PREDATOR_HORROR family), vehicles/flight (TRAFFIC_IDM, VEH_FUEL, AIR_*/COCKPIT_* families), rendering (GFX_*/RENDER_*, BATCH_V2, CITY_FAR_CULL, LOS_GRID, MATRIX_FREEZE), player/camera/touch (CAM_*, TOUCH_V2+9), games packages (PKG_* + GAME_PACKAGES master).
