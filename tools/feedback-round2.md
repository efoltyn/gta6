# Gang Life — feedback round 2 (do at/after megawave integration)

The point: GTA was an EXAMPLE, not a clone. Make everything actually relevant to OUR game.

## Signage / decoration
- Freestanding signs IN FRONT of stores are dumb. Store signs go ON THE STORE (mounted on the facade above the door / on the wall), not on the sidewalk.
- Billboards are good — but the CONTENT is dumb/generic ("GPT" filler). Put real, relevant in-world content on them (this game's gangs, shops, brands, events, wanted posters, our own jokes) — not generic ad nonsense.

## The objective/story message (image): "Soldier · Build a crew — recruit 3 soldiers (aim a gun at a ped to recruit)"
- Reads dumb AND overlaps other UI. Reword it, and fix it so it does NOT overlap other HUD elements. (Likely story.js / wealth.js objective line vs hud.js / city.note positioning.) Tier label "Soldier" is fine as a concept but the whole line is corny + the layout collides.

## Death / bodies / explosions (explosions + deaths are GOOD now, just:)
- People still go UNDERGROUND partially when they die (NPC bodies sink — the player fall-through was fixed in physics.js; NPC ragdoll bodies in peds.js/grapple.js still sink). Fix NPC corpse rest-on-ground.
- Bodies should STAY LONGER before despawning.
- Explosions AFTER CRASHES are pretty good — make them LAST LONGER (fireball + smoke linger).

## Aircraft (heli is "fucking amazing" — keep it)
- Add a HELIPAD on top of one of the buildings.
- Police HELICOPTER gets MISSILES when player is 5 stars.
- Add FIGHTER JETS at high stars (5★) that strafe/missile you.
- Their MISSILES = the car-crash explosion but BIGGER and LONGER, and must DAMAGE BUILDINGS significantly, realistically, and CINEMATICALLY (real structural damage/chunks, not just a flash).

## Police / combat realism
- Cops shoot me THROUGH WALLS — guns stick through walls. Need line-of-sight: an actor can't shoot a target it has no LOS to (reuse CBZ.collide/losBlockers/a raycast). Also gun PROPS clip through walls — hide/avoid when against geometry.
- DOORS are literally walls right now — solid, don't move. Doors should open / be passable (walk through), not block you like a wall.

## NPC AI (the big one)
- NPCs STILL walk into walls (stuck-detect not enough — need real avoidance).
- NPCs don't generate FAR ENOUGH away and it's jarring when they pop in. They should spawn based on the DIRECTION THE PLAYER IS FACING (ahead of you), FARTHER away, and faster, so you never see them appear.
- Cops (when wanted) are WAY smarter/more reactive than every other NPC. EVERYONE should be that alive: depending on personality/context an NPC should be able to — try to KILL me, RUN from me, TRADE with me, STEAL from me, WORK for me, BEAT me up, IGNORE me, or just TALK / ask a FAVOR. The full reactive spectrum, not passive wandering. (Tie into aigoals.js + peds.js + the cop-grade brain.)

## (already queued separately)
- #16 witness-gated wanted (no instant; hood = no-snitch; per-NPC snitch trait; report must reach a cop; cop gun-stops with excuses/execute).
- #17 gang members get REAL names + rank shown as a tag/badge (not "<Gang> Soldier" as a surname); reword corny career text.
