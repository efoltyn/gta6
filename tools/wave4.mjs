export const meta = {
  name: 'gang-life-wave4-takeover',
  description: 'Core loop: gang map-takeover meta, finite population, Fortnite kill-feed + one-screen HUD, exterior death-cam, no rain indoors',
  phases: [{ title: 'Build' }],
}

const ROOT = '/Users/elifoltyn/Downloads/game'

const base = [
  'CELL BLOCK Z / "Gang Life" at ' + ROOT + ': a no-build Three.js r128 browser game, vanilla JS, ~145 IIFE modules on window.CBZ, booted by ordered <script> tags in index.html. CITY mode (g.mode==="city") is the focus — a GTA-style open world. Per-frame work registers via CBZ.onUpdate(order,fn) (plays-only) or CBZ.onAlways(order,fn); gate every hook with: if (CBZ.game.mode!=="city") return;.',
  '',
  'THE BIG IDEA (owner directive — build toward this): Jail\'s game is ESCAPE; Gang City\'s game is TAKEOVER. Every gang is trying to own the whole map zone-by-zone. The population is FINITE and does NOT regenerate (no infinite respawns) — and the live total is shown like a battle-royale headcount (NEVER use the words "battle royale"). Gangs have shifting ALLIANCES (not constant war), members DEFECT, and zones flip by wiping / buying-out / out-recruiting the holders. The UI must fit ONE screen — the player should NEVER have to scroll — and show a real KILL FEED ("Dave Smith — airstrike", "— car crash", "— murder", "— fall"). Make it cohesive and real, not stubs.',
  '',
  'HARD RULES:',
  '- ONLY edit the file(s) assigned to you. index.html and src/config.js are OFF LIMITS (lazy-init new state as g.x = g.x || ...). Editing another file corrupts a parallel agent.',
  '- LIVE working game: PRESERVE every public CBZ.* function + existing behavior; extend SURGICALLY. Match code style.',
  '- After EVERY edit run `node --check <file>` and FIX errors before finishing. Your file MUST parse.',
  '- CHEAP (phones): shared geom/material, time-slicing, distance LOD, pooling, capped counts, no per-frame allocations in hot loops.',
  '- 1-2 quick WebSearches only where design guidance helps (e.g. "GTA gang territory"), then implement. Ship code.',
  '- End with a 3-4 sentence PLAIN-TEXT summary + confirm node --check passed.',
  '',
  'KEY CONTRACTS: CBZ.game(=g){cash,cityBank,respect,wanted,heat,cityKills,cityWeapon,cityCrew,playerGang,mode,state}. CBZ.player.pos/.dead/.driving. CBZ.city.note(msg,secs)/.big(msg)/.addCash/.addRespect. CBZ.cityHudDirty(). CBZ.cityPeds[] ped{pos,name,kind,aggr,hp,maxHp,dead,deadT,ko,state,rank,gang,group,char,recruited,companion,wealth}. CBZ.cityCops[]. CBZ.cityCars[]. CBZ.cityGangs[] gang{id,name,color,turf:[lots],center,members,boss,warWith,isPlayer}. CBZ.cityGangOf(x,z) -> gang controlling that spot (or null). CBZ.cityGangById(id). lot{cx,cz,w,d,kind,building}. CBZ.city.arena{shopLots,lots,abandonedLots,randomSidewalkPoint(),root}. CBZ.cityKillPed(ped,imp,cause) (cause string e.g. "explosion"/"gunfire"). CBZ.cityCrowdKill(i,opts) + CBZ.cityCrowdCircleKill (ambient instanced crowd; opts.byCar/.head/.noCrime). CBZ.cityExplosion / CBZ.cityAirstrikeExplosion. CBZ.cityCancelReport. CBZ.cityRecentDeaths (kill-feed array, populated by killfeed.js). CBZ.makeLabelSprite(text). CBZ.camera / CBZ.cam (yaw/pitch) / CBZ.scene. CBZ.collide / CBZ.colliders[] / CBZ.platforms[] / CBZ.losBlockers[]. CBZ.sfx(name) REAL recorded names only.',
].join('\n')

const DOMAINS = [

  { key: 'gang-meta', files: 'src/city/turf.js, src/city/gangs.js, src/city/playergang.js', task:
    'BUILD the gang TAKEOVER meta — the POINT of Gang City. Put the new map-control director in turf.js (currently a stub; it owns its own CBZ.onUpdate loop); wire gangs.js (rival gang AI) and playergang.js (the player\'s gang) into it.\n' +
    '- ZONES: derive a set of map zones from the existing turf/lots (group lots into ~6-10 named zones). Each zone has a controlling gang (or neutral). Expose CBZ.cityZones() -> [{id,name,owner(gangId|null),strength}], CBZ.cityZoneControl(), and CBZ.cityZoneOwner(x,z).\n' +
    '- TAKEOVER: a gang takes a zone three ways — WIPE (kill/drive out the holders\' members in that zone), BUY-OUT (spend cash to flip a weakly-held zone), or OUT-RECRUIT (poach the holders\' members by offering more than their current crew pay). Members DEFECT to a stronger/better-paying gang. When a zone\'s holders are gone/flipped, it changes owner (repaint turf color).\n' +
    '- ALLIANCES: gangs hold shifting alliances — it is NOT constant war. Maintain an alliance/relations graph (ally / neutral / at-war), drifting over time and in reaction to attacks; allies do not fight and may gang up on the leader. Expose CBZ.cityAlliances().\n' +
    '- AI GANGS pursue takeover (expand into weak/adjacent zones, defend turf, wage war on rivals not allies) — a lightweight director, time-sliced, cheap.\n' +
    '- THE PLAYER: through playergang.js the player\'s gang takes zones the same way (orders already exist: ATTACK/HOLD/CLAIM). Allow the player to switch/forge alliances and to defect/switch gangs. Owning every zone = WIN the city (a victory beat); expose CBZ.cityTakeoverLeader() + a win check.\n' +
    'PRESERVE the wave-1/3 player-gang hooks (cityPlayerGang*, launchWar skipping the player as attacker, bossDead/cityGangMemberDown, cityGangById, cityGangOf) and the existing spawn. Research GTA/gang territory-control design briefly. node --check all three.' },

  { key: 'population', files: 'src/city/crowd.js, src/city/peds.js', task:
    'TWO things.\n' +
    '(1) FINITE, NON-REGENERATING POPULATION. The city starts with a fixed headcount and it only goes DOWN as people die — no infinite respawning. Maintain a global roster: expose CBZ.cityPopulation() -> {alive, total, dead}. Hook the death paths (cityKillPed for named peds and cityCrowdKill for the ambient instanced crowd — keep their signatures + return values intact, just decrement the counter) so every death reduces the alive count and it NEVER refills past the remaining living. The ambient crowd density should THIN as the population is killed off (the streets get emptier after a massacre) instead of magically repopulating. Keep it cheap; do not break the promotion/pooling system (the pool may still RECYCLE rigs to show living people, but the total living count must not increase). Initialize total sensibly (e.g. a few hundred) lazy on first city spawn.\n' +
    '(2) SCREAM FREQUENCY — the new real "scream" sfx is ANNOYING because it fires too often. Make screams RARE and meaningful: only on genuine danger (gunfire/explosion/a death right next to them), with a long per-ped cooldown AND a city-wide cooldown of several seconds, and only a small chance even then. It should punctuate, not spam. (The sample/volume is already handled in audio.js — you only tune FREQUENCY here in peds.js.)\n' +
    'PRESERVE companionThink, the witness-report state machine, npcAttack, the _stuck avoidance, the aigoals hooks, the promotion system, and cityCrowdRayHit/Kill/CircleKill. node --check both.' },

  { key: 'killfeed', files: 'src/city/killfeed.js', task:
    'BUILD the kill feed in killfeed.js (stub exists; it already seeds CBZ.cityRecentDeaths = []). WRAP the existing kill functions so EVERY death logs an entry WITHOUT editing other files: monkey-patch CBZ.cityKillPed (named peds; signature (ped,imp,cause)) and CBZ.cityCrowdKill (ambient crowd; signature (i,opts)) by saving the originals, calling them, and on a confirmed kill pushing an entry; also hook the PLAYER death (read the player-death cause/killer the city death system records — feature-detect; do NOT edit death.js). Entry = {name, cause, t, you?, gang?}. NORMALIZE the cause into a clean human label: gunfire/shot -> "gunfire" (or "murder" if it was a deliberate player kill), explosion -> "airstrike" if a 5★ air attack is active (feature-detect the aircraft state) else "explosion", car/run-over (opts.byCar) -> "car crash", fall, "beaten" for melee KOs, "police" for cop kills, terrorist/bomb -> "terrorist attack". Pull the victim NAME from the ped (ped.name) or a generic crowd name for ambient bodies. Keep CBZ.cityRecentDeaths capped (~12 newest) and expose CBZ.cityLogDeath(name,cause,opts) for any explicit callers. The HUD agent renders this array — you only own the DATA + a tiny optional helper, not the panel layout. Cheap, no per-frame work beyond a light prune. node --check.' },

  { key: 'ui', files: 'src/city/hud.js, src/city/leaderboard.js', task:
    'ONE-SCREEN, NO-SCROLL UI (owner: "I should never have to scroll, everything fits on a page", Fortnite-clean).\n' +
    '- hud.js: add a compact, always-on info stack in a corner that does NOT overlap other HUD: the live TOTAL POPULATION count (CBZ.cityPopulation() -> alive/total, feature-detected), and a KILL FEED that renders the newest ~5 of CBZ.cityRecentDeaths as "<Name> — <cause>" lines (fade older ones). Tighten/space the existing HUD so money/stars/ammo/objective/minimap never collide with the new stack. Keep the reworded objective line readable.\n' +
    '- leaderboard.js (the Tab page): redesign so it ALWAYS fits one screen with NO scrolling at any population — show the GANG STANDINGS as a takeover board: each gang, its color, zones controlled (CBZ.cityZones()/cityZoneControl(), feature-detected), member count, and who is winning the city; plus the player\'s rank + the total population. Compact rows, scale font/rows to fit, cap visible rows and summarize the rest ("+N more") rather than overflow. No vertical scroll, ever.\n' +
    'PRESERVE the existing HUD elements + ENGINE_NAME weapon map + everything other systems write into the HUD; extend, do not break layout hooks. node --check both.' },

  { key: 'deathcam', files: 'src/city/death.js, src/city/camera.js', task:
    'CINEMATIC EXTERIOR DEATH CAM. When the player is killed by an EXPLOSION while INSIDE a building, the WASTED sequence should first cut to a dramatic EXTERIOR street-level camera that frames the building + the blast (pull the camera outside to the nearest street, look back at the explosion/your body), hold a beat, THEN do the existing fade-to-WASTED. For non-explosion or outdoor deaths, keep the current behavior. In death.js detect the cause (explosion/airstrike) + whether the player was indoors (under a roof — test CBZ.platforms / a short up-ray against CBZ.losBlockers, or an existing indoors signal). In camera.js add a temporary scripted cinematic camera pose (an exterior framing) that the city camera honors during this beat, then releases cleanly back to normal. Reuse the existing death-cam plumbing if present (CBZ.cityCam.death). Keep it from clipping into walls. PRESERVE the existing WASTED/respawn flow + all camera APIs used by FPS/shoulder views. node --check both.' },

  { key: 'rain', files: 'src/systems/weather.js', task:
    'FIX RAIN FALLING INDOORS. weather.js drives a camera-centered rain Points cloud that "never runs dry" — so it rains inside buildings too. Make rain NOT appear indoors: when the camera/player is UNDER A ROOF (inside a building), suppress the rain (hide the cloud or skip drawing drops above the player). Detect indoors cheaply — e.g. a short up-ray from the camera against CBZ.losBlockers/building meshes, or test the camera against building footprints (CBZ.colliders with a roof above) / CBZ.platforms overhead, or an existing city "indoors" signal if one exists. Re-show rain the instant you step back outside. Keep it cheap (do the indoor test a few times/sec, not per drop). PRESERVE the existing weather/fog/intensity behavior in all other modes. node --check.' },
]

log('Wave 4: ' + DOMAINS.length + ' agents — gang takeover meta, finite population, kill-feed + no-scroll HUD, exterior death-cam, no rain indoors.')

const summaries = await parallel(DOMAINS.map((d) => () =>
  agent(base + '\n\n=== YOUR DOMAIN (' + d.key + ') — edit ONLY: ' + d.files + ' ===\n' + d.task,
    { label: d.key, phase: 'Build' })
    .then((text) => ({ key: d.key, files: d.files, summary: text }))
))

return summaries.filter(Boolean)
