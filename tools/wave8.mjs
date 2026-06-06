export const meta = {
  name: 'gang-life-wave8-surface-review',
  description: 'Surface new depth (rank/relationships/posture/turf-income/join-gang) on HUD + interactions, and adversarially review waves 5-7 logic for real bugs',
  phases: [{ title: 'Build' }],
}

const ROOT = '/Users/elifoltyn/Downloads/game'

const base = [
  'CELL BLOCK Z / "Gang Life" at ' + ROOT + ': no-build Three.js r128, vanilla JS, ~145 IIFE modules on window.CBZ. CITY mode (g.mode==="city") = gang TAKEOVER open world. Recent waves added DEEP systems that are not yet visible/usable: gang JOIN + RANK lifecycle (CBZ.cityMembership/cityProspectGang/cityJoinGang/cityLeaveGang/cityMemberPutInWork/cityMemberStats/cityMemberLoyalty/cityRankName/cityRankLadder), multi-axis RELATIONSHIPS (CBZ.cityRel(ped)->{respect,fear,loyalty,affection,grudge}/cityRelLabel/cityBond/cityRelWillRecruit/cityRelPriceMod), Sekiro POSTURE melee (CBZ.cityPosture()), turf protection INCOME + wealth tiers (CBZ.turfIncome/turfIncomeInfo/turfStanding).',
  '',
  'HARD RULES: ONLY edit your assigned file(s) (review agents edit NOTHING). index.html + config.js OFF LIMITS. Feature-detect every CBZ.* (degrade gracefully if absent). PRESERVE existing behavior + public APIs; extend surgically. node --check after each edit. Cheap/phones. End with a 3-4 sentence plain-text summary.',
  '',
  'KEY CONTRACTS: CBZ.game(=g){cash,wanted,respect,playerGang,cityCrew,mode,state}. CBZ.player.pos. CBZ.cityPeds[] ped{name,kind,rank,gang,relPlayer,...}. CBZ.cityHudDirty(). CBZ.city.note/.big. The HUD owner HATES clutter — the screen must stay ONE page, minimal, no overlap; new readouts must be COMPACT + CONTEXTUAL (show only when relevant, hide otherwise). Interaction menu is the I/J/K/L 4-slot contextual menu (interact.js) with a cap of 4 options.',
].join('\n')

const DOMAINS = [

  { key: 'hud-surface', files: 'src/city/hud.js', task:
    'Surface the new depth on the CITY HUD — COMPACT + CONTEXTUAL, NOT cluttered (the owner hates a wordy HUD; it must stay one screen, hide anything not currently relevant):\n' +
    '- GANG MEMBERSHIP: when the player is in a gang (CBZ.cityMembership(), feature-detect), a small badge: gang name (its color) + your RANK (CBZ.cityRankName) + a thin promotion-progress sliver toward the next rank (from cityMemberStats vs cityRankLadder needs). Hidden entirely when unaffiliated.\n' +
    '- TURF INCOME: a tiny passive "+$x/min" tag near the money readout ONLY when you actually earn turf income (CBZ.turfIncomeInfo).\n' +
    '- RELATIONSHIP: when the player is aiming at / standing near ONE specific ped, a small read of THAT ped\'s standing toward you (CBZ.cityRelLabel/cityRel) — e.g. a colored "Respect ▲ / Grudge ▼" chip. Contextual to the targeted ped only; never a list; vanishes when not targeting anyone.\n' +
    '- MELEE POSTURE: while in a melee fight, a slim posture bar for YOU and your current target (CBZ.cityPosture()); shown only during melee, gone otherwise.\n' +
    'Tuck these into spare corners, reuse existing HUD styling, never overlap the money/stars/ammo/minimap/objective/kill-feed/population, throttle re-render (~4Hz). PRESERVE every existing HUD element + the decluttered wave-4 layout. node --check.' },

  { key: 'interact-surface', files: 'src/city/interact.js', task:
    'Wire the new gang + relationship systems into the I/J/K/L contextual interaction menu so the player can USE them (keep the strict 4-slot cap — use cap4 / the existing option-capping; do not exceed 4 options):\n' +
    '- GANG JOIN/RANK: when near a gang member or on a gang\'s turf and you are NOT in that gang, offer PROSPECT / JOIN it (CBZ.cityProspectGang / cityJoinGang, feature-detect) with the right context (prospect first, then the initiation the gang system runs). When you ARE in a gang: a PUT IN WORK option (CBZ.cityMemberPutInWork) to earn rank, and a LEAVE option. Show your current rank in the panel note where relevant.\n' +
    '- RELATIONSHIP-AWARE OPTIONS: bias the offered options by the ped\'s standing toward you (CBZ.cityRel) — a loyal/high-respect ped offers to run with you / share a tip / be recruited; a feared one will hand over cash; a grudge ped refuses friendly options. Keep it subtle + within 4 slots.\n' +
    'PRESERVE the existing interaction options, the cap4 4-slot logic, and all current I/J/K/L behavior (rob/talk/flirt/recruit/etc.). node --check.' },

  { key: 'review-gangsoc', files: '(READ-ONLY — edit nothing)', task:
    'READ-ONLY adversarial review. Read src/city/gangs.js, src/city/playergang.js, src/city/social.js (the wave-7 gang lifecycle + relationships) and hunt for REAL, CONFIRMED bugs only — not style. Focus: mutation-during-iteration (splicing members/peds while looping), NaN/negative/runaway stats (loyalty, contrib, rank), promotion/defection/SUCCESSION logic errors (e.g. a dead boss not replaced, a member promoted past Boss, division by zero in pay split), relationship-axis decay runaway or never-decaying grudges, monkey-patch wrappers that drop the return value or break the (ped,imp,cause) signature, infinite loops, and missing null/empty guards. For each: give file:line, a one-sentence why-it-breaks, and a one-line fix. Be concise — return a plain-text numbered list of only the bugs you are confident are real (or "no confirmed bugs"). Edit NOTHING.' },

  { key: 'review-econai', files: '(READ-ONLY — edit nothing)', task:
    'READ-ONLY adversarial review. Read src/city/economy.js, src/city/wealth.js, src/city/aigoals.js, src/city/careers.js, src/city/combat.js (wave-7 economy + utility-AI + posture melee) and hunt for REAL, CONFIRMED bugs only. Focus: price math going NaN / negative / runaway (supply-demand, streetPrice, turf multipliers), turf-income or wealth-tier income runaway / free-money exploit, utility-AI goal THRASHING (a ped flipping goals every tick / oscillating), a goal that never completes or strands a ped, melee POSTURE softlock (permastun, posture never recovering, finisher on an already-dead ped), drug-loop exploits, and missing guards / undefined reads (e.g. p._needs before aigoals sets it). For each: file:line, one-sentence why, one-line fix. Concise plain-text numbered list of only confirmed-real bugs (or "no confirmed bugs"). Edit NOTHING.' },
]

log('Wave 8: surface new depth (HUD + interactions) + adversarial review of waves 5-7 logic.')

const summaries = await parallel(DOMAINS.map((d) => () =>
  agent(base + '\n\n=== YOUR DOMAIN (' + d.key + ') — ' + (d.files.indexOf('READ-ONLY') >= 0 ? d.files : ('edit ONLY: ' + d.files)) + ' ===\n' + d.task,
    { label: d.key, phase: 'Build' })
    .then((text) => ({ key: d.key, files: d.files, summary: text }))
))

return summaries.filter(Boolean)
