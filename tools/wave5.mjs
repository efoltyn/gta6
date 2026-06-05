export const meta = {
  name: 'gang-life-wave5-economy',
  description: 'Overhaul Zillow property + car-resale: declutter/no-scroll menus, deeper flipping economy, tie into gang takeover, fix bugs',
  phases: [{ title: 'Build' }],
}

const ROOT = '/Users/elifoltyn/Downloads/game'

const base = [
  'CELL BLOCK Z / "Gang Life" at ' + ROOT + ': no-build Three.js r128, vanilla JS, ~145 IIFE modules on window.CBZ, ordered <script> tags in index.html. CITY mode (g.mode==="city") is a GTA-style open world; the GAME is gang TAKEOVER of the map. Per-frame work via CBZ.onUpdate(order,fn) (plays-only); gate with if(CBZ.game.mode!=="city")return;.',
  '',
  'OWNER DIRECTIVE for your system (all four apply): (1) DECLUTTER — fewer words, the menu must fit ONE screen with NO scrolling at any size (paginate, compact rows, or summarize "+N more"); the player should never scroll. (2) DEEPER ECONOMY — make it a real, FUN money loop: dynamic prices, buy-low/sell-high FLIPPING with actual profit, supply/demand + market swings, sensible taxes/fees so cash stays meaningful. (3) TIE INTO GANG TAKEOVER — wealth feeds the turf war and vice-versa. (4) FIX BUGS — audit your system for broken prices (NaN/negative), bad edge cases, menu errors, and fix what you find.',
  '',
  'HARD RULES: ONLY edit your assigned file(s). index.html + src/config.js are OFF LIMITS. src/city/economy.js is READ-ONLY (layer your own dynamics in YOUR file on top of its base prices) — do NOT edit it. PRESERVE every public CBZ.* function + saved state; extend surgically. After EVERY edit run `node --check <file>` and fix errors. Cheap (phones). 1-2 quick WebSearches only where design helps (e.g. "GTA property income", "car flipping game economy"), then ship. End with a 3-4 sentence plain-text summary + confirm node --check passed.',
  '',
  'KEY CONTRACTS: CBZ.game(=g){cash,cityBank,respect,wanted,heat,playerGang,cityCarBiz,cityRealtyOwned}. CBZ.city.note(msg,s)/.big/.addCash(n)/.spend(n)/.canAfford(n)/.addRespect. CBZ.cityHudDirty(). CBZ.cityEcon{ITEMS,CARS,propIndex(),buyPrice,sellPrice,streetPrice,recordSale} (READ-ONLY). CBZ.city.arena{lots,shopLots,abandonedLots,homeLots}. lot{cx,cz,kind,building{name,home,...}}. CBZ.cityOwnsLot(lot). GANG-TAKEOVER HOOKS (from wave 4): CBZ.cityZones() -> [{id,name,owner,strength,cx,cz}]; CBZ.cityZoneOwner(x,z) -> gangId|null; CBZ.cityZoneAt(x,z); CBZ.cityGangOf(x,z); CBZ.cityGangById(id); g.playerGang (the player gang id, if founded). Money-laundering may already exist in wealth.js — feature-detect (CBZ.cityLaunder / a dirty-cash field) and COORDINATE, do not duplicate. CBZ.cityCars[] (ambient + player cars). Menus: reuse the existing overlay/keys these modules already use; do NOT add new global keys.',
].join('\n')

const DOMAINS = [

  { key: 'property', files: 'src/city/zillow.js, src/city/realestate.js', task:
    'Overhaul PROPERTY — the [Z] Zillow marketplace (zillow.js) + the [H] realtor/homes menu (realestate.js).\n' +
    '- DECLUTTER: zillow.js is literally a "scrollable marketplace" — kill the scroll. Make the [Z] market fit ONE screen: compact listing rows, paginate (e.g. page through with a key it already handles) or show the best N + "+N more", trim verbose text, clean columns (name · district · price · yield). Same one-screen treatment for the [H] homes menu. Readable at a glance.\n' +
    '- DEEPER ECONOMY: build on CBZ.cityEcon.propIndex() but make values genuinely move — a live market that drifts + swings, neighborhood/tier effects, and REAL FLIPPING: buy a property, its value rises or falls with the market + the district\'s heat/control, sell for profit or loss. Rent yields and property tax tuned so owning is a real decision (cash sink + income faucet), businesses pay profit per cycle.\n' +
    '- GANG TIE: property in a district YOUR gang controls (CBZ.cityZoneOwner / cityZones, g.playerGang) is cheaper to buy and yields MORE; property in a rival\'s district costs more / earns less / can be seized when you take the zone. Buying up a district\'s property should help you CONTROL it (and the takeover meta should reward holding property). Surface the district + its controlling gang in each listing.\n' +
    '- FIX BUGS: audit value/rent/tax/eviction/mortgage math for NaN/negative/runaway numbers + menu errors; fix them.\n' +
    'PRESERVE cityOpenZillow/cityZillow/cityZillowReset + the realestate exports + g.cityRealtyOwned saved state. node --check both.' },

  { key: 'cars', files: 'src/city/empire.js', task:
    'Overhaul the CAR-RESALE yard (empire.js) — you drive cars into the lot to stock it, then resell.\n' +
    '- DECLUTTER: the car-biz menu fits ONE screen, no scroll — compact stock rows (model · condition · resale · hot?), trim words, summarize if the stock is long.\n' +
    '- DEEPER ECONOMY: real car FLIPPING — per-model DEMAND + a moving market so some cars are worth more now, CONDITION/damage affects resale, buy-low/sell-high timing, and a meaningful spread between street value and resale. Make running the yard a genuine profit loop, not a flat 70/82% cut.\n' +
    '- GANG TIE + LAUNDERING: the yard doubles as a money-LAUNDERING FRONT — clean dirty cash from crime through it (feature-detect wealth.js laundering / a dirty-cash field and COORDINATE; if none exists, add a simple, fair launder-at-a-fee that ties resale volume to how much you can clean). Yard income/throughput scales with how much TURF your gang controls (cityZones/g.playerGang). Police RAIDS scale with your notoriety + wanted level; your crew defends (keep that system).\n' +
    '- FIX BUGS: audit intake/resale/stock-cap/raid math + the menu for bugs; fix.\n' +
    'PRESERVE cityOpenCarBiz/cityCarBizMenu/cityEmpireReset + intake-by-driving + the raid/crew-defense system + g.cityCarBiz saved state. node --check.' },
]

log('Wave 5: ' + DOMAINS.length + ' agents — property (Zillow+homes) + car-resale overhaul: declutter/no-scroll, deeper flipping economy, gang-takeover tie, bug fixes.')

const summaries = await parallel(DOMAINS.map((d) => () =>
  agent(base + '\n\n=== YOUR DOMAIN (' + d.key + ') — edit ONLY: ' + d.files + ' ===\n' + d.task,
    { label: d.key, phase: 'Build' })
    .then((text) => ({ key: d.key, files: d.files, summary: text }))
))

return summaries.filter(Boolean)
