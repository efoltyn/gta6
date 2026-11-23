# Backlog, 2026-11-22: left over from the open-items round (Shark Sim, swimming, animals, bites)

The animals pass's eleven items are done: the phone island page loads the shark hunt and the bite marks; crows land and forage and gulls fly clear lines; flocks cast shadows; the crow has its sheen; dogs and wolves rest on the ground and swim; bite gapes, dug craters, flaps and bite cost are fixed; the three overlays keep the canvas alpha; break-free works and the shark runs on sim time; bubbles; whales dive and fluke; bots float; the old swim rig is deleted. Swimmers no longer sink. Not started; pick what you want.
1. The first bite of a session still hitches about 20-25 ms (the bite code isn't compiled yet); every later bite is about 2 ms a frame. Fix: compile it before play starts.
2. Rocks are circles to the ridden shark: lumps stick out up to about 2 m beyond them, so the shark can graze into one (the lens can't). Fix: per-rock outlines in world/sea_scene.js.
3. Holding W in Shark Sim lets a stranded shark crawl up the dry beach to the crowd (the aground branch drops the shore fence, city/wildlife_tame.js:3399-3405); shark_sim.js treats that as intended. Your call.
4. Shark Sim bites for you whenever prey is in front of the mouth (shark_sim.js:1648-1656), with no click. Your call whether that stays.
5. On a phone held upright, the megalodon overflows the frame in hard turns and chases (44-55% framed).
6. A lying shepherd's elbows sit about 12 mm into the ground after settling; the side, sit and dead rests are within 3 mm.
7. The ragdoll often rolls dead canids onto their backs; crows climb over tall towers instead of flying round them.
8. Wound textures are painted slowly at the start of play, so a bite in the first few seconds may show its marks late.
9. Bites bleed on screen (sprays, pools, a water cloud from real litres) but do not drain the victim's blood in systems/vitals.js, so a bitten man does not weaken or collapse from blood loss. A gameplay change: your call.
10. The blood film on the water's surface still uses a grey-to-red filter; under a cloud the red covers it, but a film alone over turquoise reads grey-brown.
11. Land holds: a wolf's foreleg can touch the held man's free arm (up to 6.6 cm) and a coyote's the held foot (about 6 cm) for a frame or two; the knockdown fall is fast (up to 7 m/s at the chest); a bear that lets go mid-rear snaps level in one frame.
12. The sea near the lens: a bed deeper than about 3.5 m seen steeply down within a few metres reads grey-green instead of deep teal (the water is kept clear there so swimmers stay visible); the fix is the seabed darkening itself by its own depth.

---

# Backlog, 2026-11-22: left over from the water rework (waves, wakes, boats, swimmers, tsunami, impacts)

Not started; pick what you want.
1. Tsunami at sea is still staged: the director walks the wave front and sets its level and current. The flood on land is a real solver; extend that solver out over the shelf so drawdown, the wave growing as it shoals, the bore and the run-up are one simulation. The drawdown's hard-edged boundary on the sea goes with it.
2. Never run on a phone or tablet. The ripple field's fallback texture format (for devices without half-float targets) has never executed. No speed measurement was taken; the tsunami storyboard read sim ticks 0.3 to 0.7 ms slower and up to 90 more draw calls.
3. Only the disaster island and Shark Sim were photographed. Gang City's sea and The Isles run the same code but nobody has looked at them.
4. The smallest chop (2 to 6 m waves) is drawn but boats do not feel it: hulls respond to waves of 6 m and longer.
5. The ripple field has one wave speed, so a wake's angle depends on boat speed instead of the fixed angle real deep-water wakes have.
6. NPC War's water arena loads the ripple field but nothing writes into it.
7. A meteor blast front that starts over land still draws its ring where it crosses onto the sea.
8. Flood mud does not brown or flatten the grass under it.
9. Still approximated, not simulated: surf (bands along depth lines), whitecaps (a steepness threshold scaled to wind), shore run-up (sum of sines), stranded fish (a scripted flop).
10. systems/flashflood.js paints its own colour over the water shading; systems/disasters.js still hands harbour boats to the debris field, which may fight the new hull physics.
11. A person's entry splash still reads a little like cut shapes at 20 m.

---

# Backlog, 2026-11-22: left over from the anatomy pass (people rebuilt to real proportions)

Not started; pick what you want.
1. Look at the new body in motion: sitting in cars and on chairs, aiming every gun, prone, ladders, cuffed. Legs are 11% longer and forearms 8 cm longer; the code reads those lengths, but nobody has watched those poses yet.
2. Warlord kit (webbing, chest pouches) is laid out in fixed numbers for the old wide chest: the webbing sits 27 mm into the forearm.
3. Suit jackets on a seated teenager: the sleeve head sits 9 mm into the jacket body at the armpit.
4. Girls' dresses (age ~11): the skirt sits 2 cm into the hanging forearm (it did before too).
5. Afro on a woman touches the collar by 1 cm on a walking turn.
6. Kid's hoodie: the hood lies exactly on the upper back in a few spots and may shimmer.
7. Natural Disaster: the other 99 survivors still wear flat bright colours; only the player wears real clothes.
8. Toddlers (age 3): shoulder joint check still fails in a few arm poses (it did before too).
9. Protective-detail suits: the earpiece wire touches the collar (18 mm) when the head tips; the ear now sits almost over the collar's edge.

---

# Backlog, 2026-11-02 (owner stopped every agent; nothing is running)

## Backlog, 2026-11-22 night: left over from arms and long guns

1. A painted tee (most city people) still draws the upper arm with the smooth sleeve shape below the hem; only flat-coloured and bare arms show the new muscle.
2. The shotgun at the shoulder holds its firing elbow high and its off arm almost straight on the pump.
3. Nobody watched the new holds in motion (walking, crouched, prone, the player in third person) or in first person with the longer carbine stock.
4. Women and untrained men share one arm shape; a woman's could be slimmer at the forearm.
5. Arm muscle is silhouette only (one loft): no groove between biceps and triceps.

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

## I. Guns, arms and hands leftovers (2026-11-22, after eb7a4cd2)
69. Colour wash, game-wide: hex colours go in as linear and the tone map washes fair skin toward cream and the orange jumpsuit toward yellow. Only the player's skin was re-picked (0xde8b52). The real fix decodes skin and cloth colours where their materials are made (character.js, outfits.js, heritage.js, clothes.js) and re-picks the dark heritage tones at the same time.
70. Shotgun, third person low ready: the butt sits 8-9 cm off the shoulder (the stock's toe pushes the gun out when pitched down). Presenting is seated.
71. Shotgun, first person: trigger finger pad about 2 cm short of the trigger; the support arm at the hip is 3-11% past its reach.
72. Sniper: the ring and little fingers float 1.5-2.5 cm off the stock; the stock's grip needs reshaping under them.
73. Pistol two-hand grip: the support index sits about half a finger low, and the support thumb rides the bottom edge of the slide.
74. Hands are one size for a given gun: a woman's first-person hands are not smaller.
75. Unarmed punch pose tables were not re-tuned for the longer (real) first-person arms.
76. tools/visual-presets/gunpoint-studio.mjs is rotted (cast never reacts, armed men show no gun); gun-hold-reload sometimes stages a subject in first person; gun-hold-check / fp-hands-check / ads-check still expect the old fixed hand poses and pistol distances.

## J. Prison day and disguise leftovers (2026-11-22, after 8bbecbe6 and ab9cd119)
77. Prison yard move: inmates still dawdling when the move window closes spend that yard in the wing hall. The walk out through the gate rides the existing wander/nav logic.
78. Prison at the High and Ultra security levels: the evening count is already a lock-in, so no guard comes to fetch you; only the count and guard sight catch you.
79. Prison blackout: small equipment lights stay lit on purpose (door-reader and camera LEDs, monitors, the lounge TV, kitchen pilots, forge coals, watch lume). A lightning flash during the blackout does not light the world.
80. Prison cell check: the full sequence (count short, PA, search outward from the cell, found, walked back, resist into the hole) is built but was not watched end to end.
81. Disguise at the gang house: the close look by the boss and lieutenants was not cleanly measured (the boss sits upstairs).
82. Fort Brandt: city/basewatch.js has its own 36 m look that runs alongside the disguise's close look. Its owner may want to drop the close-range part of it.
83. A punch thrown in a police or army uniform is still waved off as "police work" in wanted.js.
84. Soldiers from the army battle system (CBZ.cityArmy, the alarm squads at the base) cannot be stripped for their uniform.
85. Capture tooling: `--cams at:x,y,z:...` is split on its commas, and the city now boots with a default slice, so far places (Fort Brandt, the minicities) stream in on approach. A shot or probe of them must go there and build them first.
