export const meta = {
  name: 'gang-life-wave6-polish',
  description: 'Zillow tabs overhaul, car crashing + car models overhaul, jail-grade NPC hands-up/cower arms in city, fix broken doors',
  phases: [{ title: 'Build' }],
}

const ROOT = '/Users/elifoltyn/Downloads/game'

const base = [
  'CELL BLOCK Z / "Gang Life" at ' + ROOT + ': no-build Three.js r128, vanilla JS, ~145 IIFE modules on window.CBZ, ordered <script> tags in index.html. CITY mode (g.mode==="city") is a GTA-style open world. Per-frame work via CBZ.onUpdate(order,fn) (plays-only); gate with if(CBZ.game.mode!=="city")return;.',
  '',
  'HARD RULES: ONLY edit your assigned file(s). index.html + src/config.js are OFF LIMITS. PRESERVE every public CBZ.* function + saved state; extend surgically, do NOT rewrite whole files. After EVERY edit run `node --check <file>` and fix errors. Cheap (phones): shared geom/material, time-slicing, pooling. 1-2 quick WebSearches only where design helps, then ship. End with a 3-4 sentence plain-text summary + confirm node --check passed.',
  '',
  'KEY CONTRACTS: CBZ.game(=g){cash,wanted,mode,state,cityWeapon}. CBZ.player.pos/.driving/.dead/.aim/._vehicle. CBZ.camera / CBZ.cam (yaw/pitch). CBZ.city.note/.big/.arena{lots,shopLots,root}. CBZ.cityPeds[] ped{pos,name,kind,state,aggr,fear,surrender,surrenderT,char,group,armed,weapon,rank,gang}. ped.char = makeCharacter rig with .parts{la,ra,...}, .surrender, .handsUp; CBZ.animChar(char,speed,dt) drives walk + (character.js) applies the hands-up pose when char.surrender||char.handsUp. CBZ.collide(pos,r,y0,y1) / CBZ.colliders[] / CBZ.losBlockers[]. CBZ.cityCars[]. CBZ.shake/doHitstop/doSlowmo. CBZ.sfx(name) real names only.',
].join('\n')

const DOMAINS = [

  { key: 'zillow', files: 'src/city/zillow.js', task:
    'The [Z] ZILLOW marketplace TABS / UI are still fucked up — overhaul them. Make the category navigation real + clean: clear TABS or a filter row for the listing categories (residence / commercial / land / illegal ops / OWNED / RENTING) that actually switch the visible list, with the active tab highlighted; the whole panel must fit ONE screen with NO scrolling (the pagination already exists — keep listings ≤ one page and page through). Fix any broken/overflowing layout, mislabeled or dead buttons, and make buy / finance / rent / sell / payoff actions clearly readable and working from the tabbed view. Keep it compact + legible. PRESERVE cityOpenZillow / cityZillow / cityZillowReset + the wave-5 district-pricing + g.cityRealtyOwned saved state + portfolioValue export. node --check.' },

  { key: 'cars', files: 'src/city/vehicles.js, src/city/crashfx.js, src/city/playercars.js', task:
    'Overhaul CAR CRASHING and the CARS themselves.\n' +
    '- CRASHING (vehicles.js + crashfx.js): make collisions feel weighty + realistic — speed-scaled crumple/deformation, real momentum transfer (the struck car gets shoved + spun, not a dead stop), spinouts, the driver jolted, and punchy impact FX (sparks, glass, debris, shake/hitstop). Build ON the existing CRASH tune (carHard/carCatastrophic), asymmetric damage, wreck/crumple, and the catastrophic→explosion path — TUNE + deepen, do NOT undo them.\n' +
    '- CARS (playercars.js + vehicles.js makeCar): the vehicles need a visual + handling overhaul — more intentional, better-proportioned low-poly car models (distinct silhouettes: sedan, coupe, SUV, muscle, van, etc.) and handling that feels good (accel/grip/steering/braking, weight). \n' +
    'PRESERVE makeCar + grp.userData.body/cabin, runOver / resolveCars / wreckCar / crumpleCar, the traffic + red-light logic, companion hooks, cityPromotePlayerCar / cityCyclePlayerCarStyle, and g.cityCarBiz. Research GTA car handling/damage briefly. node --check all three.' },

  { key: 'npc-arms', files: 'src/city/peds.js, src/systems/reactions.js', task:
    'Give CITY NPCs the same expressive ARM reactions the JAIL game does well — especially HANDS UP when a gun is pointed at them. CURRENT STATE: city peds use CBZ.animChar (character.js applies a hands-up pose when ped.char.handsUp||surrender), but the rich reaction layer in reactions.js (hands-up, cower, flinch, aim-back) runs ONLY for jail/survival CBZ.npcs — NOT city peds — and city only triggers surrender via the explicit "rob" menu, not from merely AIMING.\n' +
    '- GUNPOINT → HANDS UP: when the player has a gun out and is aiming at / near a ped (use CBZ.player.aim + facing + a cone/distance test, or whatever the city aim signal is), that ped should raise its hands (set ped.poseHandsUp / ped.char.handsUp + a surrender/freeze state) and hold it while covered, then relax when you look away — not only when you open the rob menu. Armed tough peds may instead aim back (keep that option for high-aggression/armed).\n' +
    '- COWER / FLINCH: nearby peds flinch + cower at gunfire and explosions, like jail.\n' +
    '- BEST APPROACH: extend reactions.js so it ALSO drives CBZ.cityPeds while in city mode (preserving the existing jail/survival CBZ.npcs behavior exactly — additive, mode-gated), reusing its hands-up/cower/flinch logic; set the trigger flags from peds.js. If that is not clean, replicate the hands-up/cower in peds.js using the existing char.handsUp pose. Keep the existing city surrender/rob path (peds.js cityRobPed) working.\n' +
    'PRESERVE companionThink, the witness-report machine, npcAttack, _stuck avoidance, aigoals hooks, the promotion system, and the jail/survival reactions behavior. peds.js is large + central — be surgical. node --check both.' },

  { key: 'doors', files: 'src/city/buildings.js', task:
    'The CITY DOORS are fucked up — fix them. The hinged auto-open door system exists (around buildings.js:478-496: makeDoorPanel, the cityDoors registry, an auto-opener that swings the leaf + pulls the collider when someone is near, then closes). AUDIT why doors feel broken and FIX it: most likely the doorway is an invisible WALL (the collider is not actually pulled when the door opens, so you can see it swing but still can\'t walk through), or the leaf does not swing / clips the frame / opens the wrong way, or the auto-open never triggers for the player. The result must be: walk up to a shop door → it reliably SWINGS open AND the doorway is genuinely PASSABLE (you can walk inside), then it closes a beat after you leave; NPCs use them too. Verify the collider is removed/re-added in sync with the open/closed state. PRESERVE the interiors, windows, platforms, the rest of the collider system, bullet holes, helipad, and cityDamageBuilding. node --check.' },
]

log('Wave 6: ' + DOMAINS.length + ' agents — Zillow tabs, car crashing + models, jail-grade NPC hands-up/cower arms, fix doors.')

const summaries = await parallel(DOMAINS.map((d) => () =>
  agent(base + '\n\n=== YOUR DOMAIN (' + d.key + ') — edit ONLY: ' + d.files + ' ===\n' + d.task,
    { label: d.key, phase: 'Build' })
    .then((text) => ({ key: d.key, files: d.files, summary: text }))
))

return summaries.filter(Boolean)
