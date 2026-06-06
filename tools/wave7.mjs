export const meta = {
  name: 'gang-life-wave7-depth',
  description: 'Deep gang join/initiation/promotion/hierarchy, real NPC relationships, researched punching feel, deeper living economy, richer emergent AI goals',
  phases: [{ title: 'Build' }],
}

const ROOT = '/Users/elifoltyn/Downloads/game'

const base = [
  'CELL BLOCK Z / "Gang Life" at ' + ROOT + ': no-build Three.js r128, vanilla JS, ~145 IIFE modules on window.CBZ, ordered <script> tags in index.html. CITY mode (g.mode==="city") = the game: gang TAKEOVER of the map. Per-frame work via CBZ.onUpdate(order,fn) (plays-only); gate with if(CBZ.game.mode!=="city")return;.',
  '',
  'OWNER DIRECTIVE: make it AWESOME + FUN with REAL, DETAILED LOGIC — not hardcoded. Systems should emerge from stats/needs/actions, not scripted constants. Gang joining, promotion, hierarchy, and personal relationships must be DEEP, analyzed, and believable. Research freely ("websearch to cheat") — do 1-3 WebSearches for your topic and steal real mechanics, then implement richly.',
  '',
  'HARD RULES: ONLY edit your assigned file(s). index.html + src/config.js are OFF LIMITS (lazy-init g.x = g.x || ...). The CITY PED BRAIN (src/city/peds.js) is being edited by another job RIGHT NOW — do NOT edit it; drive ped behavior by setting STATE/FLAGS on peds + your own CBZ.onUpdate loop + exposing APIs peds.js already reads (ped.finalGoal/target/rage, ped.rank, ped.surrender, etc.). PRESERVE every public CBZ.* function + saved state; extend surgically. node --check after EVERY edit. Cheap (phones): time-slice, cap, pool, no per-frame allocations. End with a 3-4 sentence plain-text summary + confirm node --check passed.',
  '',
  'KEY CONTRACTS: CBZ.game(=g){cash,cityBank,respect,wanted,heat,playerGang,cityCrew,cityInv}. CBZ.player.pos/.dead. CBZ.city.note(msg,s)/.big/.addCash(n)/.spend(n)/.canAfford(n)/.addRespect(n). CBZ.cityHudDirty(). CBZ.cityPeds[] ped{pos,name,kind,archetype,aggr,wealth,hp,maxHp,dead,ko,state,rank,gang,faction,companion,recruited,surrender,fear,mem,relPlayer}. CBZ.cityGangs[] gang{id,name,color,nation,ethnicity,turf,center,members,boss,treasury,warWith}. CBZ.cityGangOf(x,z)/cityGangById(id). Gang/turf hooks (wave 4): CBZ.cityZones()/cityZoneOwner(x,z)/cityZoneControl()/cityAlliances()/cityTakeoverLeader()/g.playerGang. CBZ.cityRecruit(ped)/cityStartCareer(kind). CBZ.cityEcon{ITEMS,SHOP_STOCK,CARS,propIndex(),buyPrice,sellPrice,streetPrice,recordSale,rollCash}. CBZ.cityCrime(amt,{x,z,type}). CBZ.sfx(name) real names only (punch,hit,ko,headshot,coin,door,win,...). CBZ.shake/doHitstop/doSlowmo. CBZ.body{hit,knockdown,fling,busy} (ragdoll). CBZ.cityRecentDeaths (kill feed).',
].join('\n')

const DOMAINS = [

  { key: 'gang-hierarchy', files: 'src/city/gangs.js, src/city/playergang.js', task:
    'Make GANG MEMBERSHIP deep + real (research real gang structure/initiation/ranks first). A member is not a flat label — model the LIFECYCLE:\n' +
    '- JOINING: the player can PROSPECT a gang (hang around its turf / do favors), then get INITIATED two real ways — "jumped in" (survive a beating from members) OR prove yourself by committing a crime/hit for them. On success you become a member with the lowest rank. AI gangs likewise recruit civilians + poach rivals (build on cityRecruit).\n' +
    '- RANKS + PROMOTION (earned, NOT hardcoded): a real ladder (Associate/Prospect -> Lookout -> Runner -> Soldier -> Enforcer -> Lieutenant -> OG/Boss). Promotion is driven by tracked STATS — cash contributed to the gang treasury, bodies/violence, loyalty, time, completed orders — so members (and the player) climb on merit. Higher rank = bigger cut of income, command of lower ranks, more respect, better gear.\n' +
    '- HIERARCHY + CHAIN OF COMMAND: boss commands lieutenants, lieutenants command soldiers; orders flow DOWN the chain; income is split by rank; a boss going down triggers a real SUCCESSION (top lieutenant rises or it fractures).\n' +
    '- LOYALTY + DISCIPLINE: members have loyalty that rises with pay/wins and falls with losses/disrespect; low loyalty -> they DEFECT (to a better-paying/stronger gang) or get clipped. Tie to the relationships system (CBZ.cityRel* if present) + the turf takeover meta.\n' +
    'Expose clean APIs (e.g. CBZ.cityJoinGang, CBZ.cityGangRankUp, CBZ.cityMemberLoyalty) for the HUD/other systems. PRESERVE the wave-1/3/4 player-gang + turf hooks (cityPlayerGang*, launchWar, bossDead/cityGangMemberDown, cityGangById/Of, the nation/ethnicity fields) + companion payroll. node --check both.' },

  { key: 'relationships', files: 'src/city/social.js', task:
    'Build a REAL personal-RELATIONSHIPS system in social.js (research game reputation/relationship sims first). Replace any binary like/dislike with a multi-axis CONTINUUM per NPC toward the player — e.g. respect, fear, loyalty, affection, and grudge — and have it actually DRIVE behavior:\n' +
    '- Actions shift it: helping/paying/gifting/defending someone raises respect+loyalty; robbing/attacking/killing them or their FRIENDS builds fear/grudge. Track it on the ped (e.g. ped.relPlayer = {respect,fear,loyalty,grudge}) lazily.\n' +
    '- Consequences (this is the point): high respect/loyalty -> NPCs greet you, give discounts, share tips, agree to be recruited, fight FOR you; fear -> they comply/flee/hand over cash; grudge -> they snitch, refuse, or ambush you later (DELAYED consequences are great). Surface a relationship read other systems can use (recruiting, witness/snitch decisions, shop prices).\n' +
    '- LIVING WEB: NPCs have a few friends/family/associates; hurting one angers their circle; gang members share loyalty to their gang. Romance/partner depth building on the existing cityPartner/cityFlirt/cityPropose.\n' +
    'Drive it from your own CBZ.onUpdate loop + event hooks; set flags peds.js can read (do NOT edit peds.js). Expose CBZ.cityRel(ped) / CBZ.cityRelShift(ped, kind, amt). PRESERVE existing social APIs (cityPartner/cityFlirt/cityPropose/cityIsRomance, witness tagging). node --check.' },

  { key: 'punching', files: 'src/city/combat.js', task:
    'Make MELEE / PUNCHING feel GREAT in city/combat.js (research melee game-feel first — hitstop, windup->follow-through, knockback, stagger/poise, parry, stamina). Upgrade the player\'s unarmed + melee combat:\n' +
    '- A real LIGHT/HEAVY + 3-hit COMBO with timing windows; each connect lands HITSTOP (CBZ.doHitstop ~0.05-0.09s), camera SHAKE, the right sfx (punch/hit/ko), and a directional KNOCKBACK on the target scaled to the blow (use CBZ.body.hit/knockdown for stagger + ragdoll on a KO).\n' +
    '- Defense: a BLOCK and a timed PARRY/counter (parry = brief stun + free heavy); tough/armed NPCs can block or counter you.\n' +
    '- STAMINA: attacks + blocks drain stamina; empty stamina = slow, weak, exposed — so melee is deliberate, not spam.\n' +
    '- Hit REACTIONS on victims: flinch/stagger/stumble, finishers on a downed foe, satisfying KO slow-mo.\n' +
    'Keep it readable on phones (tap = light, hold = heavy, or reuse existing inputs). PRESERVE all existing melee/punch/beat APIs + the combat the megawave added + the LOS no-shoot-through-walls for NPC fire. node --check.' },

  { key: 'economy', files: 'src/city/economy.js, src/city/wealth.js', task:
    'Make the ECONOMY deep + FUN (research game economy / drug-market sim first). In economy.js (backbone) + wealth.js (rich endgame):\n' +
    '- LIVING SUPPLY/DEMAND: drug + goods street prices move with what the player + world DO — dumping product floods + drops the price, scarcity raises it, prices recover toward a baseline, vary by DISTRICT and by who CONTROLS it (CBZ.cityZoneOwner / g.playerGang -> your turf = better margins), and heat/risk pushes drug prices up. Real buy-low/sell-high loops.\n' +
    '- SINKS + FAUCETS so cash stays meaningful: faucets (jobs, dealing, businesses, heists, turf income); sinks (payroll, rent, bribes, luxuries, gear, restocking). Tune so getting rich is a satisfying climb, not trivial or impossible.\n' +
    '- WEALTH TIERS in wealth.js (broke -> street -> made -> boss -> kingpin) with real PERKS per tier (better deals, VIP access, more crew, laundering capacity, status/respect), and big high-value money sinks for the rich (mansions, businesses, fronts) so the super-rich have things to chase. Tie income to controlled turf + gang rank.\n' +
    'PRESERVE existing exports (ITEMS/SHOP_STOCK/CARS/buyPrice/sellPrice/streetPrice/recordSale/rollCash/propIndex) + wealth.js public API + the wave-5 property/laundering coordination. Drift markets from an onUpdate at a FREE order. node --check both.' },

  { key: 'ai-goals', files: 'src/city/aigoals.js, src/city/careers.js', task:
    'Make NPCs feel ALIVE with real emergent GOALS (research NPC needs/utility-AI/daily-routine sims first). In aigoals.js (goal selection) + careers.js (jobs/dealing/crime systems):\n' +
    '- NEED-DRIVEN GOALS: each NPC pursues believable objectives from personality + needs — earn MONEY (go to work, deal drugs, rob someone, run a hustle), get/use DRUGS (addicts seek out dealers + pay up), climb the GANG (do work for rank — coordinate with the gang-hierarchy job), feud/REVENGE (act on grudges from the relationships system), survive/flee danger. A lightweight UTILITY pick (score each goal by need + opportunity) rather than scripted constants.\n' +
    '- This should make the streets a real economy of behavior: dealers post up + serve buyers, workers commute, hustlers target the rich, gang members patrol/expand turf, addicts roam. Cheap + time-sliced.\n' +
    '- Deepen careers.js: the player drug-dealing loop (buy supply, build a customer base that actually walks up, territory affects sales, busts), richer jobs/hustles, and the NPC side of the same economy.\n' +
    'CRITICAL: peds.js (the brain) is being edited by another job — do NOT edit it. Keep driving peds via the EXISTING hook contract (set ped.finalGoal/target/rage + a goal tag; peds.js consumes them). Coexist with companionThink + the witness machine. PRESERVE existing aigoals + careers public APIs (cityStartCareer, recruit/payroll, cityStoryReset chain). node --check both.' },
]

log('Wave 7: ' + DOMAINS.length + ' agents — gang join/rank/hierarchy, real relationships, punching feel, living economy, emergent AI goals.')

const summaries = await parallel(DOMAINS.map((d) => () =>
  agent(base + '\n\n=== YOUR DOMAIN (' + d.key + ') — edit ONLY: ' + d.files + ' ===\n' + d.task,
    { label: d.key, phase: 'Build' })
    .then((text) => ({ key: d.key, files: d.files, summary: text }))
))

return summaries.filter(Boolean)
