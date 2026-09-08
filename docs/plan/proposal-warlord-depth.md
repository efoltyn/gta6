# PROPOSAL: WHY DESERT WARLORD FEELS SURFACE LEVEL, AND WHAT TO BUILD

*2026-09-08. Owner's question: "look online aggressively research bannerlord game
and then look at the exact logic of desert warlord. why does our game feel so
surface level. propose improvement to game logic and also look at multiplayer
for our game versus multiplayer for openfront.io which is super fun."*

*Nothing in here is built. Four reports underneath this one carry the receipts;
read them for any number you want to argue with:*

| report | what it is |
|---|---|
| `docs/plan/audit-warlord-logic.md` | the exact loop, state, AI, cards, economy of our campaign — file:line on every claim |
| `docs/plan/audit-warlord-battle-net.md` | our battle layer and our multiplayer, read off the code |
| `docs/plan/research-bannerlord-systems.md` | Bannerlord's formulas from the decompiled 1.3.15 assemblies, 25 consequence chains, what its players call shallow |
| `docs/plan/research-openfront-multiplayer.md` | OpenFront's loop, alliance/traitor rules, lobby machinery and its lockstep netcode read from its GitHub source |

The owner's brief for this game has never changed and every proposal below is
checked against it: *"ultra simple mechanics, made for multiplayer — openfront.io
met Bannerlord"*, *"the big thing is battle logic improving"*. Nothing here adds a
tech tree, a building, a crafting bench or a dialogue tree. It adds MEMORY and
CONSEQUENCE to systems that already exist.

---

## 1. The diagnosis in one paragraph

The game has a real world model (land raises levies, levies are power, power
takes land, plus a solved economy and an off-screen war between 442 parties) and
a real moment-to-moment loop (ride, meet a party, press a verb, fight in first
person). **The two never touch.** The world model ticks once per dawn, and a dawn
is 18 real minutes away; the loop is one-press transactions against strangers
who do not know you and will not remember you. In Bannerlord every verb is owed
back to you later by a named person; in OpenFront every verb is instantly
legible to fifty strangers who will act on it. Ours is neither. Nothing the
player does is owed back to him, by anybody, at any point.

---

## 2. Seven root causes, each with the mechanic that fixes it elsewhere

### 2.1 The strategic layer is invisible for the whole first session

- `HOUR_SECS = 45` (campaign.js:173): a day is **18 real minutes**. The game
  starts at hour 7; dawn fires at hour 6. **The first dawn is 17¼ minutes
  away.** Wages, levies, the province war, loyalty drift, weather, warlord
  diplomacy, mutiny and the victory check are ALL on `W.dawn()`.
- A garrison takes `SETTLE_DAWNS = 6` to become defensible (territory.js:938):
  **108 real minutes** for one province to stop being brittle. A run to 32
  provinces is an evening, and nothing in the first ten minutes of it moves but
  442 parties walking to shops.
- OpenFront: a whole 40-to-125-player war is **20-36 minutes**, the win bar
  sinks 2 points a minute after minute 30, and nothing ever waits. Bannerlord's
  day is about 3 real minutes at 1× and the map is legible every second of it.

### 2.2 Men are individuals in the data and a count in the experience

- A soldier IS a person in core.js: `{id,name,tier,wid,armour,hp,maxHp,kills,
  battles,wounded}`; battle.js writes kills back; promotion at 3/6/9 battles.
- The player never sees any of it. The roster starts closed, AUTO-ARM is the
  intended button, the off-screen resolver kills by **array index**
  (`loser.men.splice(0, lost)`, campaign.js:3543), and the "ringleader" is a
  query re-run every time it is asked, not a man.
- Bannerlord's cheapest attachment trick: **one named person's skill decides
  one thing you feel** — the surgeon decides wounded-vs-dead (`0.0015 ×
  Medicine`), the scout decides speed, the quartermaster decides party size.
  Players talk about their surgeon by name. That is 50 lines.

### 2.3 Nobody remembers you

- A rival warlord is `{id,idx,name,colour,home,alive,betrayals,peer}` plus
  `grudge` — eight fields, three of which ever change (match.js:329-350). He has
  no body on the map, no card, no memory that you destroyed his columns, took
  his provinces or shot his men. His columns open the same bandit rail as a
  looter crew with HIRE greyed out (army.js:160).
- Diplomacy is one bit per pair: allied or not. No tribute, no truce, no joint
  war, no way to talk to him except OFFER ALLIANCE from a map card.
- Bannerlord's #1 mechanic by leverage: **relation with a named person gates a
  concrete resource.** A village elder's opinion (0..100) unlocks recruit slots
  on a step table. Every consequence chain in that game routes through it.

### 2.4 No verb has a cost that comes due later

- 13 of 20 road cards settle on the press (audit §5.2). Only `village`+`paid`,
  `cache`, `rival`, `summons` create a future. Loyalty, the one scalar every
  card moves, drifts back to its ceiling at 0.3/dawn, so the choice is erased in
  a fortnight anyway.
- Exceptions worth protecting: PRESS EVERY MAN (per-dawn desertion), SHOOT THE
  UNWILLING (permanent fear + dread), breaking an alliance (permanent
  `betrayals`). These three feel deep for exactly this reason.
- Bannerlord's 25 chains (research §8) all have the shape *reward now → problem
  later*: prisoners slow you, wounded slow you, raiding closes recruit slots,
  executing a lord poisons a whole clan forever, conquering a foreign-culture
  town gives you a −3 loyalty/day problem you did not have before.

### 2.5 The only resources are men, gold, guns, and two abstract scalars

- No food, no water stock, no ammunition, no fatigue, no supply, no campaign
  morale. Riding 14 km costs nothing but clock. Fame saturates at ~150 and
  then does nothing forever (core.js:966, army.js:1822).
- Bannerlord's party morale is ONE visible number that a dozen systems write
  (food variety −2..+10, unpaid wages ×−20, starvation −30, recent win/loss)
  and five systems read (power ×0.7 below 30, speed, desertion, prisoner
  conformity, cohesion). It is the game's bus. Any new system plugs in with one
  line and immediately feels connected. And the player can read the breakdown.

### 2.6 The off-screen world is silent and the on-screen world has no tempo

- ~600 `resolveOneBandFight` rolls per ten minutes, almost none logged; the
  400+ parties out of your 1100 m bubble have no behaviour but walking to a
  shop; a band's memory is `scared ∈ {0,1,2}`.
- Nothing schedules a threat. One win condition, three ways to die, no clock,
  no escalation, no mid-term goal. The LAST WAR arms only when 13 of 14 rivals
  are already gone.
- Bannerlord's army cohesion (`−2 − nParties − …` per day, disband below 30)
  manufactures tempo: you must commit within about a week of forming an army.
  OpenFront's alliance timer (5 minutes, mutual re-vote) and Overtime do the
  same job: the game forces a fresh decision on a clock.

### 2.7 Multiplayer is not a shared world

- `C.setSimHost(on)` has **zero callers** (campaign.js:3713). `C.simHost =
  !FLAG_GUEST` from `?guest=1` only, so **every connected client believes it is
  the sim host**, independently rolling band goals, band-vs-band fights and
  respawns. territory.js has no host gate at all. `W.warnet.snapshot` exists and
  is called by nobody; `T.setOwners` exists "for warnet" and is called by nobody.
  **Two players share a seed and diverge into two islands within seconds.**
- The day clock is handshaked once and never resynced; the `d` field sent 4×/s
  is read by nobody. The only periodic traffic is a ~100-byte player dot at 4 Hz.
- No lobby list, matchmaking, countdown, bots-to-fill, spectate, replay,
  reconnect, chat/ping/emoji (the chat stack exists and is tested; `netui.js`
  is not in warlord's script list). No shared win condition or match end —
  deleted with THE FOUR and never replaced. 8 players hard.
- `warlord-net-check.mjs` passes ten green assertions none of which ask
  whether any band or province agrees between the two Chromes.

---

## 3. What to build — game logic

Ranked by felt depth per line of code, respecting the owner's rule that the
mechanics stay ultra simple. Each item names the seam it lands on. Items marked
**[bus]** plug into the morale number in 3.2 and get most of their depth free.

### 3.1 Make time visible: a dawn every few minutes, and a MORNING REPORT

- `HOUR_SECS` 45 → **12** (a day ≈ 5 real minutes); start the run at **hour 4**
  so the first dawn lands about 25 s in, after the first ride. A 32-province run
  becomes a 35-50 minute match, which is the OpenFront length and the length a
  multiplayer room can hold. `SETTLE_DAWNS` stays 6 (now 30 min to harden).
- Dawn becomes an EVENT the player reads, not a chip that changes: a docked
  MORNING REPORT card, one line per system, in the ExplainedNumber spirit
  Bannerlord spent six years discovering: "PAID 41 MEN · $205 · 3 LEVIES RAISED
  AT SALT WELLS · HAMID'S COLUMN TOOK THE WADI FROM KESSLER · 2 PRESSED MEN
  WALKED". Every number the game already computes at dawn gets its sentence.
  Nothing new is simulated. This alone turns 18 minutes of silence into the
  game's heartbeat.
- Seam: `W.dawn()` already emits `dawn`; territory.js already logs `warDawn`
  results; events.js's `log` bucket already carries `{day,text,kind}`.

### 3.2 One campaign morale number, and it is a bus **[bus]**

Replace the single global `loy` drift with a **party morale** the player can
read as an itemised list. Writers (all existing signals, one line each):

| writer | value | already exists as |
|---|---|---|
| paid at dawn / not paid | +1.4 / −15 | events.js loyalty |
| won / lost a battle | ± | events.js |
| pressed men in the column | −0.5 each per dawn | pressed provenance |
| executions ever | −n (never decays) | `stats.executed` |
| **water** (3.3) | 0 at full skins, −8 dry | NEW, one field |
| lieutenant alive (3.4) | + | NEW |
| column oversize (3.7) | − per dawn above the cap | NEW |

Readers: battle nerve (`combat_iq ROLE[].nerve` × f(morale) — this is the
campaign finally touching the battle), desertion at dawn (cheapest tier first,
Bannerlord's rule), `W.surrenderChance` of parties facing you, ride speed ±5%.
Drift toward the bond ceiling stays, but executions and pressed men are
floors, not drift. The number and its breakdown live on the strip.

### 3.3 One supply: WATER, because the island already has wells

The one resource the desert asks for. Not food, not ammo, not fatigue — water.

- `S.water` = skins; a man drinks one per day; the cart holds `men × 3`. Wells
  and oases refill it (regions already carry `wells`, territory.js:514; `D.oases`
  exists). Holding a province with a well is worth something you feel: your
  column can cross the salt.
- Dry: morale −8 **[bus]** and the existing `water` card's "kills men" branch
  becomes what actually happens on a dry dawn (wounded first).
- Why this and nothing else: it makes ROUTE a decision (Bannerlord's speed and
  food do this together; one resource does it here), it gives provinces a
  second reason to exist beyond `supportOf`, and it is one integer on the state.

### 3.4 Lieutenants: three named men whose skill decides one thing you feel

Promote the survivors the game already tracks (`battles`, `kills`) into up to
three named seats, exactly Bannerlord's skill-routing table and nothing more:

| seat | decides | source of the number |
|---|---|---|
| **MEDIC** | wounded-vs-dead after a battle: `dead × (1 − 0.02 × his battles)` capped | battle report already lists dead; `wounded` flag already exists (core.js:177) |
| **SCOUT** | encounter radius and the off-screen fights you HEAR about (3.6) | `checkContacts` radius |
| **QUARTERMASTER** | wage discount / water cart size | `W.payroll()`, 3.3 |

A lieutenant is a real soldier who can die in a battle; when he does the seat
is empty and the number goes back to baseline. The strip shows his name. This
is the whole attachment mechanic and it is three lookups. The MEDIC also
converts "40 veterans gone" into "40 veterans out for two dawns", which is what
lets a player take a fight at even odds at all.

### 3.5 Headmen: a named person in front of the levy tap

Every province gets one **headman** (name from the existing pools) with one
**relation** integer, −100..100. It is Bannerlord's #1 mechanic on our own
`supportOf`:

- Levies raised per dawn = `supportOf(r) × step(relation)` on a 5-row table
  (0 / 0.5 / 1.0 / 1.25 / 1.5). Garrison defence and income unchanged.
- Writers: TAX THEM (−20), the village job done (+15), freeing his men from a
  slaver column (+10), executing men from his province (−15 each), a foreign
  warlord's column standing on him for a dawn (−5), your garrison at full
  (+2/dawn), standing on the province yourself at dawn (+1).
- Below −40 he raises a **rebel band** from his own levies (Bannerlord's
  loyalty <15 rebellion) that holds the province against everyone. Below −60
  he sends a runner to a rival: that warlord's next column targets you.
- He is where STORM's defenders come from and who you meet when you ride into
  the province (a cast rider, the existing `cast()` machinery): a rail with
  PAY HIS WELL / TAX / RIDE ON. That is the diplomacy surface for provinces and
  it costs no new phase.

### 3.6 Warlords who are people: traits, a ledger, and a parley

- Each of the 14 rivals gets **two traits** rolled from the seed
  (`vengeful | mercenary | cautious | proud`) that his AI already has the
  numbers to honour (camp/hunt/roam weights, alliance accept rate, tribute
  price). Warband's personality coefficients are the model; four adjectives
  is the whole content budget.
- A **ledger** per warlord: the last eight things you did to him, each with a
  weight (`took province`, `broke column`, `shot his men`, `paid tribute`,
  `broke alliance`, `freed his men`). Relation is the decayed sum. It drives
  alliance acceptance (replacing the coin), whether his columns hunt you, the
  tribute he demands, and what his rider says when the card comes up.
- **Parley.** A warlord rides WITH his largest column (`warlordId` already marks
  columns). Meeting it in campaign opens a rail that is not the bandit rail:
  TRUCE (3 dawns, OpenFront's expiring alliance, needs his yes) / TRIBUTE (pay
  or demand, priced by relation and odds) / JOIN ME AGAINST <name> (a joint
  target for 3 dawns) / RIDE AT HIM. Beating a column with the warlord in it
  puts him in `S.prisoners` and the aftermath grows a fourth line: RANSOM (his
  home province pays) / RELEASE (+relation with him, −fear) / SHOOT HIM
  (Bannerlord's −60/−30/−10: his allies' relation falls, every warlord's
  alliance acceptance with you halves for the run, fame +, morale floor −).
- Seam: match.js's alliance machine already treats AI and human alike through
  one code path; the ledger sits beside `grudge`.

### 3.7 Tempo and anti-snowball, both borrowed whole

- **Column cohesion** (Bannerlord): above `supportOf` of the provinces you hold
  plus a floor, the column costs morale per dawn **[bus]** unless it fought or
  took ground that day. A big army must be USED. This kills the "walk around
  with 300 men and never fight" endgame the audit found nothing preventing.
- **Overtime** (OpenFront): after day 12 the 80% bar drops 4 provinces a dawn.
  A match ends. The strip shows the bar moving.
- **Big holdings are cheaper to take** (OpenFront `largeTerritoryBonus`): a
  province owned by whoever holds the most land defends at 0.8× — the leader
  is the target, on purpose, for AI and humans alike.
- **Foreign ground costs**: a province whose `kind` differs from your home's
  drifts headman relation −2/dawn until garrison is full. Conquest is
  self-limiting without an overextension system.

### 3.8 Every card leaves an echo, and the off-screen war has names

- **The rule:** no road card ships without a scheduled consequence. The 13
  echo-less cards each get one line into `ev.contracts`/`owed` (events.js:211):
  deserters you took → their old captain hunts you within 3 dawns; a crate you
  robbed → the runner's buyer bans you at his outpost; a toll you fought
  through → the wadi is held against you next pass; slavers you cut loose →
  their headman +10 and the slavers' warlord −.
- **`resolveOneBandFight` stops killing by index.** It calls
  `W.battle.resolve()` (already pure, seeded, gate-F-guarded) for any fight
  involving a warlord column or a province, and kills weakest-first for the
  rest. Its report is what the SCOUT (3.4) hears: "KESSLER'S SECOND COLUMN
  BROKE AT THE SALT PAN, 14 DEAD".
- The war log names people, because 3.5 and 3.6 gave it people to name.

### 3.9 Battle: keep it, and close its three open holes

The battle layer is the genuinely good half and is the owner's stated
priority. It is one model with two presentations, morale derived from real
tables, real reverse-slope cover, six orders that measurably matter, a man who
is a persistent object. Do not touch the model. Close:

- **Cavalry never enters a battle.** mounts.js is 2,427 lines with a complete
  `M.battle` API and zero callers (audit A7). Wire it: a mounted man arrives on
  his mount, dismounts at the line or charges. Riders are the first thing the
  campaign feels in a fight.
- **The report names the dead.** `buildReport` already knows who died; the
  aftermath card gets a line of names (the lieutenant's in bold), the MEDIC's
  saves stated. Kill counts on named men are shown, because 3.4 makes them
  matter.
- **Wounded-vs-dead** through the MEDIC seat (3.4) and the `wounded` flag that
  already exists on a soldier.
- `move` gets its key; MULTIPLAYER.md:69-78 and warnet.js:975-987 stop
  describing a resolve() bug fixed in 838eb8f.

### 3.10 Explicitly not building

- No buildings, upgrades, tech, crafting (outpost.js:9-10 says why; agreed).
- No food variety, no ammunition, no fatigue: water is the one supply.
- No dialogue trees: every social act is a verb rail with a printed price.
- No lockstep rewrite of the campaign (see 4.3).
- No second battle engine. `src/battle/` unification (pillar-npc-war-sandbox
  §6) is a separate wave and this proposal does not depend on it.

---

## 4. Multiplayer: ours versus OpenFront

### 4.1 What makes OpenFront fun with strangers (research §7), sorted by what we can take

Pure design, portable to any netcode:

1. **Alliances expire on a 5-minute timer and need a mutual re-vote.** Every
   five minutes you judge a stranger again at the moment your positions changed.
2. **Betrayal is priced, public and global**: 30 s of half defence for everyone
   attacking you, a broken-shield icon, a permanent counter, −100 with the victim,
   −40 with every neighbour, and breaking with a traitor is free so a web can
   unravel. We already have `betrayals` and a durable cost; we lack the public
   mark and the contagion.
3. **A 30-second simultaneous spawn phase where placement is the first social
   act**, on a live board where you watch neighbours appear and re-pick.
4. **All communication is a fixed vocabulary**: 60 emoji, 58 canned phrases,
   target marks. No moderation surface, no language barrier, and the phrases
   ARE the design document ("Alliance?", "I trusted you...", "[P1] is
   snowballing too fast!").
5. **Attacking is one irreversible, immediately-costed act with a legible
   failure mode.** Troops leave the pool on commit; a hopeless attack stalls
   visibly rather than losing dramatically.
6. **The leader is cheaper to attack and the win bar sinks**: `largeTerritoryBonus`
   plus Overtime guarantee the game ends and the crown is a target.

Design the architecture made affordable:

7. **400 bots + up to 72 AI nations fill every lobby for free**, so a room of
   one is still a war and the map is dangerous from tick one.
8. **Public lobbies start on a wall-clock countdown (2 min), never on
   readiness**, three parallel queues six deep; measured median fill 17.8 s.

Lockstep-only:

9. The server relays intents and never simulates (a 125-player, 36-minute war
   is ~320 KB per client, ~150 kbit/s of egress for the whole match).
10. Reconnect, late join, spectate, replay and archive are one mechanism:
    `turns.slice(lastTurn)`.

### 4.2 Where we stand against each

| OpenFront property | Desert Warlord today | after this proposal |
|---|---|---|
| one shared simulation | **none** — every client is sim host, islands diverge in seconds | host-authoritative campaign, 2 Hz deltas |
| AI fills the board for free | 14 warlords + 442 parties **exist and are seeded**; the expensive half is done | host simulates, guests receive; AI stays free on the wire |
| match length 20-36 min | a day is 18 min; a run is an evening | 5-min days, Overtime → 35-50 min |
| shared win condition | none since THE FOUR was deleted | 80% land, same rule as OpenFront, per seat; standings screen at match end |
| spawn phase | golden-angle by relay id, no choice | 30 s "pick your beach" on the strategic map before RIDE OUT |
| expiring alliances | permanent until broken | TRUCE 3 dawns, mutual renewal (3.6) |
| priced public betrayal | durable cost, no mark, no contagion | broken-shield mark on the peer dot and map, 1-dawn 0.8× defence, free to break with a traitor |
| fixed-vocabulary talk | chat stack exists, unloaded | 20 phrases + 12 emoji + a target mark, over `rooms.js` `chat` (already relayed) |
| public lobby with countdown | a four-letter code read aloud | serverless public rooms (4.4) |
| spectate / replay / reconnect | none | reconnect via host resnapshot; spectate = a guest seat with no warlord; replay deferred |
| players | 8 hard | 8 → 16 (the star relay's real limit is host upload at 2 Hz deltas; measure) |

### 4.3 Architecture: host-authoritative deltas, not lockstep

The audit and the OpenFront read agree on this and it is worth being blunt
about, because lockstep is the seductive answer.

OpenFront can run lockstep because its whole sim is integer math on a Uint16
tile array at a fixed 100 ms tick, with `DetMath` reimplementing `exp/log/
pow/atan2` and a hash vote every 10 ticks to eject disagreeing clients. Our
campaign steps 442 bands on real `dt` with a distance-stepped far clock, uses
`Math.hypot`/`atan2`/trig throughout, and the 3D battle is frame-rate
dependent by design. Making that bit-identical across browsers is a rewrite of
campaign.js and a ban on the whole battle. warnet.js:68-75 already argues
against a synchronised 3D fight and the argument is correct.

What we have instead is the free half of lockstep already paid for: **the
world is 4 bytes.** Island, provinces, outposts, all 442 parties and their
named men derive from the seed on every client (asserted by warlord-net-check
#6). So:

1. **Wire the switch that exists.** `W.campaign.setSimHost(isHost())` in
   warnet's `welcome`/`host` handlers. One line. Guests immediately stop
   inventing bands; the island is frozen for them rather than divergent, which
   is the honest intermediate state.
2. **Send the delta the API already declares.** `warnet.snapshot()` and
   `T.setOwners()` exist uncalled. A full tick for 444 parties is ~15-20 KB, too
   much at 4 Hz; a **delta at 2 Hz** (bands that moved >1 m: id, x, z, size,
   mood; provinces that flipped; the day/hour epoch) is a few KB. The relay
   already enforces host authority on `t:"world"` (rooms.js:269-271) — the
   check is written and unused.
3. **Derive the day from a host-stamped epoch** instead of the `d` field nobody
   reads. Then the clock cannot drift.
4. **Fights stay as they are**: human-vs-human is `W.battle.resolve()` on the
   challenger, results by id (warnet.js:949-1015, correct and well-reasoned);
   human-vs-AI is the 3D battle on the human's machine, and its report is an
   intent the host applies (dead by id, province flip). The AI-vs-AI war runs
   on the host only. This is exactly Bannerlord's split: the fidelity layer is
   optional, the resolution layer is authoritative.
5. **Host migration** already elects a new sim host (rooms.js:141-155) for a
   role that drives nothing; after step 1 it drives everything, and the new
   host resumes from its own last-applied snapshot. Reconnect = rejoin + full
   snapshot from the host, which is the same message as late join.
6. Delete or implement `W.warnet.engage` (called at campaign.js:1895, never
   defined); load `netui.js` for the fixed-vocabulary chat.

Then make `warlord-net-check.mjs` ask the question it never asked: after 60 s,
do both Chromes agree on every band's position within 2 m and every province's
owner? Today it is green over two different islands.

### 4.4 A public lobby with no server: the wall-clock room

OpenFront's drop-in property is a countdown nobody waits for. We have no
server, and the PeerJS broker only knows ids. So derive the id from the clock:

- The public room code for the current window is `code(floor(now / 120 s))`.
  Every player who presses PLAY WITH STRANGERS in the same two-minute window
  computes the same code; the first to claim the PeerJS id is the host, the
  rest join it. When the window rolls over the next code is live and the
  current room rides out. Three windows staggered by 40 s give the "always a
  lobby counting down" feel with zero infrastructure.
- Room of one at the deadline is still a war: 14 seeded warlords ride against
  you, which is OpenFront's bots-fill lesson and we already have it.
- Failure modes stay the broker's (single point of failure, symmetric NAT
  without TURN). A $5 relay (`server/server.js` exists) upgrades the path when
  it matters; the code scheme is the same either way.

### 4.5 The spawn phase as the first social act

Before RIDE OUT the strategic map is up for 30 s with every seat's chosen
beach pip visible and re-pickable; the AI warlords' homes are shown. The
warlord you spawn next to is the first thing you know about the match, and
you chose it. Today `seatSpawn` picks for you in silence.

### 4.6 Ending a match

A seat wins at 80% land (same rule as solo, same rule as OpenFront). Overtime
(3.7) guarantees it ends. The end screen is the island standings, which
already exist (`W.warlords.audit()` and the LAST WAR screen), with each
human's line: provinces, men, betrayals, executed, the named lieutenant that
lived. A dead human becomes a spectator seat and can watch the rest.

---

## 5. Execution order, by file territory

Three builders in worktrees, one wave each, the repo's usual shape. Every wave
ends with a `ba` PDF or a probe that measures the claim. No flags; git is the
undo.

**Wave 1 — the clock and the bus (campaign.js, events.js, core.js, territory.js)**
3.1 dawn every 5 min + MORNING REPORT; 3.2 morale bus replacing `loy`; 3.3
water; 3.8 echoes on the 13 cards and resolve() in the off-screen war.
Measure: a seeded 12-minute idle run shows ≥2 dawns with a report each; morale
breakdown sums to the strip number; a dry column loses men at dawn.

**Wave 2 — people (match.js, army.js, events.js, loadout.js, battle.js report)**
3.4 lieutenants; 3.5 headmen and relation-gated levies with rebellion; 3.6
traits, ledger, parley, warlord capture; 3.7 cohesion, Overtime, leader
penalty, foreign ground; 3.9 named dead in the report. Measure: alliance
acceptance correlates with the ledger; a headman at −40 raises a rebel band;
a run with 300 idle men loses morale; Overtime ends a seeded run by day ~20.

**Wave 3 — the shared island (warnet.js, rooms.js, campaign.js host gate,
territory.js setOwners, netui.js, warlord.html lobby)**
4.3 steps 1-6; 4.4 wall-clock public rooms; 4.5 spawn phase; 4.6 match end;
fixed-vocabulary chat and the betrayal mark. Measure: warlord-net-check gains
the agreement assertion (bands within 2 m, provinces equal) and a third Chrome
joining late converges within 5 s; a host tab closed mid-match migrates and
the guests keep playing.

**Then** cavalry into battle (mounts.js `M.battle`, battle.js) as its own wave,
and the `src/battle/` unification when the owner says go.

---

## 6. What Bannerlord's own players call shallow, so we do not copy it

From the research (§9): diplomacy as a score nudge nobody can see (fixed in
vanilla only in 2025, five years after the Diplomacy mod, 807k downloads);
quests that are fetch loops; a late game that is a clickfest of identical
sieges; lords without personality (Warband's coefficients missed); garrisons
as food delivery. Every one of those is a system that exists but is not
LEGIBLE or not ATTACHED to a person. TaleWorlds' 2026 patches are all
presentation fixes for simulation that was already there: visible traits,
named blood feuds, hard rules replacing score nudges. That is the precise
shape of our problem too, which is why §3 is mostly names, ledgers and a
morning report over a simulation we already run.

And what OpenFront's players call broken (§5.2): the endgame is a game of
chicken because betrayal is always available, so nobody bites the crown;
dogpiles on whoever is attacked; a spawn phase nothing explains. Overtime and
the leader penalty (3.7) are their shipped answers and ours; the parley's
JOIN ME AGAINST <name> with a 3-dawn commitment is the one thing we can offer
that they cannot, because our alliances can carry a target.
