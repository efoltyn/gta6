# Backlog, 2026-11-02 (owner stopped every agent; nothing is running)

## three.js r187 (r187 on WebGL is LIVE; the WebGPU parts below are not)
1. **[partial, unmerged]** WebGPU water: GPU flood/tsunami/flash-flood sim, lava flow, boats/fleet riding the wave. 6 commits on branch `worktree-agent-a52f5e0317f5f9faa`; not reviewed.
2. **[partial, parked]** WebGPU looks too dark / shaders to TSL: helper ports of ~80 files (trees, islands, prison, ground, vehicles, crowd, FX, other games) parked as a WIP commit on branch `worktree-agent-a2d3cd34ba47c765a`, unreviewed. Known blocker: escape and city render black on WebGPU (null attribute arrays on batched geometry; fxwarm compileAsync throws).
3. Port the core/world shaders (terrain, facades, ground, sky) and the engine's raw-WebGL calls to WebGPU, then make WebGPU the default where the device has it.
4. three.js bundle grew 0.75 -> 1.7 MB on every page: split it (WebGL core vs WebGPU/TSL/meshlets).
5. Lava shows stripes under WebGPU.
6. Destruction/explosions on the new particle engine: car/plane/building shot until it blows, crashes, plane into building, missiles (stopped, nothing committed).
7. The other ~160 custom shaders to TSL (systems, entities, battle, warlord, race, units).
8. Meshlets for the static world.
9. Final load-time A/B vs r128 commit 5ff46092 (baseline in ~/harness/out/gta6/r187/).

## Load time (the real cost is game code, not three.js)
10. Desert Warlord: clothes.js takes 8.8 s at load (after the people rework settles).
11. Bomb Survivor: hull.js takes 5.6 s at load.
12. Gang City: 58 s world build.

## Phone crashes (fixes LIVE, not yet confirmed on a real phone)
13. Confirm the Isles / jail / disaster crashes and the F-35 missile crash are gone on the phone.
14. Disaster: last match's crowd records (~99) kept one match too long; shaders +2-3 per match.
15. Helicopter weapons and the stick-turning on helis are untested.

## Stick City
16. Far crowd has hats but no jewellery; rings read as glints, not shapes.

## TikTok
17. Re-render the disaster videos with an on-screen x/100 alive and the "Simulating a X in a web browser using three.js. How many survive?" voiceover.
18. US vs 1,000 IRGC video: camera that shows both lines meeting.

## Other
19. Character bumping/contact (shoulders clipping, no stumble/pushback): our own code, not three.js; after the people rework.
20. Pre-existing error: `[park batch pruned] ... bakeMergeV2` (also on r128).

---

# Backlog: everything still to do (2026-10-12)

Everything was stopped on the owner's order. Nothing below is running.
Items marked **[partial]** have unmerged work sitting in a stopped builder's worktree.

## A. Unfinished from today (half-done in a stopped builder)
1. **[partial]** NPC War soldiers' feet/bodies sink when the ground rises. Simple fix: battle `groundAt` must return the height of the DRAWN terrain triangles (erg/snow/fields/forest/island), and MID-tier men must not use a coarser grid. Worktree `agent-aa008268fb0ff181a`.
2. **[partial]** Jacket: front hem clips the thigh mid-stride (5.1 mm), and there's a seated waist flicker on teens. Cut the front open below the button. Worktree `agent-a26e82537f99110f0`.
3. Check that the pres-boot3 merge (taxi teleport deleted, character vault in sqlite, Play asks for pointer-lock and audio first) is actually published to the site. It's on main and GitHub at 66f3620a.

## B. Distance / pop-in (GTA way: own-mesh LOD, crossfade, stream ahead)
4. **[partial]** People and animals still pop at their radius edge (peds' 95–110 m edge). Fade them with `CBZ.sightFade`, or only spawn and despawn unseen. Worktree `agent-a726cb6dd5f1b9b52`.
5. Wildlife's "unseen" test ignores walls and hills. Make it occlusion-aware like streetlife.
6. Redhollow trees aren't on the new tree LOD/impostor path.
7. Snow pines have bounding spheres the size of the whole region, so they're never culled.
8. No far copy for the military island, airport terminal, Harvest Market, bank and casino. Derive one from their plan data.
9. Night window light dots stay lit on demolished buildings.
10. Village far copies stop at the first hut (the RNG stream isn't consumed the same way).
11. Building shells don't dither. Only the far copy dissolves over them.
12. Measure the helicopter-view draw cost on iPad now that far trees, people and lights draw further.

## C. Army / war (NPC War core inside Gang City)
13. **[partial]** The army only targets the player. Make it fight cops, peds and other forces. Worktree `agent-a60111ab1014e8896` and its sub-builders.
14. Only one theatre at a time. Allow several concurrent forces.
15. Fort Brandt apron is ~1,300 draw calls. Batch the parked units (instancing/merging, never downgrade). **[partial]** sub-builder `a53e1b227cd736576`.
16. Fort Brandt resident troopers are still city peds. Make them army soldiers who still crew aircraft. **[partial]** sub-builder `a685b316bd2dc03e4`.
17. Gang City B-2 is still strategic.js's own model. Use the unitKit `b2_spirit`. **[partial]** same sub-builder.
18. AI-country coups are still a dice roll. Make them real army actions.
19. Crew deaths inside vehicles aren't counted.
20. Martial-law troops stop at the kerb. They should walk in through the door to their post.
21. War room: a real "send convoy" decision (pick target and forces). Convoy orders are URL-only today.
22. Riflemen in a far ambush don't fire at a convoy's soft targets. Dismounts don't engage at 200 m.
23. Wrecked parked machines in Gang City can still be boarded.
24. Hangars and merged base geometry only scorch. Give them real holes and collapse.
25. Drone jamming / EW unit (`droneLink()` hook). **[partial]** sub-builder `ab46f84d962ccfb92`.
26. Army vehicles far from the player aren't culled.

## D. Feel / controls / UI (Gang City)
27. **[partial]** Player pistol and SMG impacts appear before the flying streak arrives. Worktree `agent-a367e87e265cda23e`.
28. City misses land on a flat street plane, so they're off on raised terrain.
29. Prison guards and multiplayer puppets still end rounds at the target point. Move them to the shared flown-round path.
30. Your own-shot hitstop and headshot slow-mo may stutter flight when firing from aircraft or vehicles.
31. Open car doors aren't solid. You can't stand on a car's bonnet.
32. Campaign mode hides money and the objective. Boats have no speed readout.
33. Phone call screen still has "Threaten" and a fake "Offer a deal". Apply the button rules.
34. The President's speech-crowd walkers don't path around walls.
35. Crew "Rob" order code is dead. Wire it as a target verb or delete it.
36. Talk-ish verbs left for the owner's call: cop Bluff, official Petition / Win over / Lean on, VIP Lobby, Request, Help, Check in.
37. Real taxis: a cab that drives you on the roads, fare on arrival. The teleport was deleted and nothing replaced it.
38. Desktop has no walk key (run is the default now).
39. Survival/disaster mode still walks by default (predators are tuned against sprint).
40. Pre-existing broken checks: `touch-coverage-check` and `interact-name-check` (`interactions.js` harness), `test-jail-sprint` (`islandModeOn`), `human-shape-check` (`tintOf`), `breach-check` (facade code), `touch-keycap-check` cage case (`statecraft` garrison), `test-car-strike` at 40 km/h.

## E. President war plan (approved direction; phases not yet built)
41. Real coup end to end (pieces exist: the army coup takes the Mansion). Flee by motorcade or roof helicopter, hide in the bunker, fight, surrender. Endings: arrested → jail game, killed, exile.
42. Decision buttons: add Surrender (with terms), Demand surrender, Ceasefire, Alliance, real Sanctions (close crossings, ground flights), Open/close border, Recognise a government. Cut remaining word buttons (Address speeches, public-speech pairs, ambassador talk).
43. Orders layer everywhere (who/what/target/forces) so AI presidents and a future second human use the same path.
44. AI presidents launch real convoys and strikes at the player's city. Fort Brandt answers.
45. Captured cities change hands; police and army switch sides or flee.
46. Navy components: AAV-7/ACV, LCAC, landing ship, destroyer (Tomahawk), patrol boats. Swim, beach and unload behaviour.
47. Cargo planes with real limits: C-130 (20 t), A400M (37 t), C-17 (77 t). Size and mass check, load animations. Fix the Gang City hold that takes a 62 t Abrams.
48. Bunkers as real components that only bunker busters break. The President's bunker under the Mansion.
49. The base as a component with behaviour: sentries, gate checkpoint, jets taxi and take off, motor pool sends convoys, empty spots when losses happen, resupply by convoy or air.
50. Multiplayer later (rooms exist): two presidents, host-authoritative, the orders layer over the network.

## F. NPC War content
51. Animal full redraws, one Opus builder per species. Waits on the owner's go after the vehicle catalogue (he liked it).
52. Balance leftovers: 50 unarmed men v gorilla (20%, fists too weak, no grapple); tiger v 3 riflemen at 12 m; Stryker v 30 riflemen ends in draws; Abrams v RPG men needs more seeds.
53. Impacts catalogue rerun (`node tools/catalogue.mjs --kind impacts`) to show before/after of the weapons and debris fixes, plus a vehicle catalogue rerun with the drones (FPV, Switchblade 600/300, Shahed + launcher).
54. Animal catalogue (`--kind species` is wired but never run).
55. Two duplicate headless scenario numbers (two 10s, two 12s).

## G. Remake older systems (census: lowest Opus 5.5 share, focus on behaviour and animation)
56. County jail + a real police station building (arrests hide the person off-map today), using the jail game's cell kit.
57. Building facades (0.3% Opus 5.5, 15k lines).
58. Hospital / medics / morgue (9%).
59. Police / wanted / precinct (21%).
60. Boats / marina (19%).
61. Peds / crowds / street life behaviour (31%).
62. Shops / jobs / money / casino (21%).
63. Gangs / heists (27%).
64. Wildlife / dogs / hunting (16%).
65. HUD / map / touch, camera, sky, sound (10–17%).
66. Shark sim (18%) and Disaster (28%). Warlord is shelved by the owner.

## H. Housekeeping
67. Clean up stopped worktrees under `.claude/worktrees/` once their partial work has been salvaged or dropped.
68. Keep `docs/npcwar/ARCHITECTURE.md` vehicle and drone rows current.
