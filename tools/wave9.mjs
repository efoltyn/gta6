export const meta = {
  name: 'gang-life-wave9-getrich',
  description: 'Planned heists/big-scores, gang contracts that give the rank-climb meaning, ownable income businesses for the rich',
  phases: [{ title: 'Build' }],
}

const ROOT = '/Users/elifoltyn/Downloads/game'

const base = [
  'CELL BLOCK Z / "Gang Life" at ' + ROOT + ': no-build Three.js r128, vanilla JS, ~146 IIFE modules on window.CBZ. CITY mode (g.mode==="city") = gang TAKEOVER open world; the meta is climbing from broke nobody to kingpin who owns the map. Per-frame work via CBZ.onUpdate(order,fn) (plays-only); gate with if(CBZ.game.mode!=="city")return;.',
  '',
  'GOAL: make getting rich + running a crew FUN, deep, and REAL (logic-driven, not hardcoded). Research your topic (1-3 WebSearches, e.g. "GTA heist design", "GTA businesses passive income") and steal real mechanics. Reuse the deep systems already built: gang ranks/membership (CBZ.cityMembership/cityRankName/cityGangRankUp/cityMemberPutInWork/cityMemberStats), relationships (CBZ.cityRel), turf control + income (CBZ.cityZones/cityZoneOwner/g.playerGang/turfIncome), the wanted heat (CBZ.cityCrime(amt,{x,z,type}) — 5★ is intentionally HARD now), crew (g.cityCrew / companions), wealth tiers (CBZ.cityWealthTier if present).',
  '',
  'HARD RULES: ONLY edit your assigned file(s). index.html + config.js OFF LIMITS. Do NOT edit peds.js. Feature-detect every cross-module CBZ.*. PRESERVE all existing public APIs + saved state; extend surgically; lazy-init new g.* state (g.x = g.x || ...). node --check after EVERY edit. Cheap (phones): time-slice, pool, cap. Reuse the existing city overlay/menu + interaction (I/J/K/L) plumbing rather than new global keys. End with a 3-4 sentence plain-text summary + confirm node --check passed.',
  '',
  'KEY CONTRACTS: CBZ.game(=g){cash,cityBank,respect,wanted,heat,playerGang,cityCrew,cityInv}. CBZ.city.note(msg,s)/.big/.addCash(n)/.spend(n)/.canAfford(n)/.addRespect(n). CBZ.cityHudDirty(). CBZ.player.pos/.driving. CBZ.cityPeds[]/cityCops[]. CBZ.city.arena{lots,shopLots,abandonedLots,root}. lot{cx,cz,kind,building{name,kind,shop}}. CBZ.cityEcon{ITEMS,buyPrice,sellPrice,streetPrice,rollCash}. CBZ.cityCrime/cityForceStars. CBZ.cityOpenActivities (the [Y] hub) / cityCarBiz / cityRecruit. CBZ.sfx(coin/win/door/explosion/...). CBZ.doSlowmo/shake.',
].join('\n')

const DOMAINS = [

  { key: 'heists', files: 'src/city/heists.js', task:
    'BUILD the planned-ROBBERY / big-score system in heists.js (stub — fill it; own CBZ.onUpdate loop, gated to city). Research GTA heist + robbery design. A ladder of scores by risk/reward: CORNER-STORE stickup (quick, low take, 1-2★) -> LIQUOR/JEWELRY smash-and-grab -> ARMORED TRUCK -> BANK JOB (big take, heavy heat + cops). Each score is a real little arc: START it (walk into / case a target shop or truck via the interaction or a planning prompt), an EXECUTE phase (grab the cash over a few seconds while heat builds — tie to CBZ.cityCrime so witnesses/cops respond and stars ramp; the harder targets pull more heat), then ESCAPE (get clear / lose the cops to bank the take). PAYOUT scales with target tier + a CREW bonus (g.cityCrew/companions help + raise the cut) + a risk premium, and feeds respect + gang contribution. Failing (busted/downed) loses the take. Make it the marquee get-rich loop that funds the climb. Expose CBZ.cityStartHeist / cityHeistState for HUD/interaction. Lazy-init g.cityHeist state. node --check.' },

  { key: 'gang-contracts', files: 'src/city/careers.js', task:
    'Give the gang rank-climb real CONTENT via a CONTRACT/JOB board in careers.js: the gang you belong to (CBZ.cityMembership — joined OR your own founded crew) offers jobs that earn CASH + RANK progress (route them through CBZ.cityMemberPutInWork / cityGangRankUp / cityMemberStats so doing work actually promotes you). A rotating set of believable contracts: HIT a rival member/lieutenant, TAKE/hold a rival block, COLLECT a debt (shake down a marked ped), RUN PRODUCT (deliver drugs across town), DEFEND your turf from a raid. Each has a target/location, a payout + rank/respect reward scaled to risk, a time window, and a clear success/fail. Surface it where the player can pick one up (reuse the [Y] activities hub via CBZ.cityOpenActivities, or an interaction with a gang member) — feature-detect. This is what makes joining a gang and climbing feel meaningful. PRESERVE the existing careers (jobs/dealing loop, companion payroll, cityStartCareer, cityStoryReset chain) + the wave-7 NPC need-AI hooks. node --check.' },

  { key: 'businesses', files: 'src/city/wealth.js', task:
    'Give the RICH things to DO + real money sinks/faucets in wealth.js: ownable BUSINESSES the player buys with serious cash that generate SCALING passive income — e.g. nightclub, car wash (laundering front), auto dealership, weed dispensary, strip club, parking garage. Each: a buy price (a real money SINK), a passive $/cycle income (a faucet) that scales with upgrades + the turf you control (CBZ.cityZoneOwner/g.playerGang) + your wealth tier, simple MANAGEMENT (collect earnings, buy upgrades, some can LAUNDER dirty cash — coordinate with the existing wave-5/7 laundering, do not duplicate), and a RAID/robbery risk when your heat is high (crew can defend). Tie ownership into net worth + the wealth-tier perks already here. This is the endgame so the super-rich aren\'t bored. Surface via the existing Empire/Status overlay this file already has. PRESERVE every existing wealth.js public API + the wave-7 tiers/turf-income + the ms-fixed op cooldowns. node --check.' },
]

log('Wave 9: heists/big-scores + gang contracts (rank content) + ownable businesses (rich endgame).')

const summaries = await parallel(DOMAINS.map((d) => () =>
  agent(base + '\n\n=== YOUR DOMAIN (' + d.key + ') — edit ONLY: ' + d.files + ' ===\n' + d.task,
    { label: d.key, phase: 'Build' })
    .then((text) => ({ key: d.key, files: d.files, summary: text }))
))

return summaries.filter(Boolean)
