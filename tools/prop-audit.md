# PROP AUDIT — "every prop matters and is interactable or gone"

Read-only audit, 2026-07-18. No code was changed. Scope: every distinct prop/furnishing a
player can walk up to, in city mode and the prison/survival modes. Verdicts:
**WIRED** (hooked to a real system — named), **WIRE-IT** (one obvious mechanic earns its
place — specified), **CUT** (no plausible job — delete).

## What "interactable" means in this codebase (the bar to clear)

- `src/city/interactions.js` — THE registry: sources/zones/options, E+IJKL, canShow gates.
- `src/city/interact.js` — every street verb: mug/rob/recruit/talk, vendor counters
  (26 trade verbs, `VERB` table interact.js:916), corpse loot/clothes/armor, cars,
  club rope (659), gang stash (671), **street-prop search zone (682: bins+newsboxes)**,
  seats (696), beds (701), wanted posters (710), gig handoffs (1056).
- `src/city/interactions_rich.js` — social layer: compliment/insult/intimidate/
  directions/leads/smoke/handout/fan-photo (registrations 351-411).
- `src/city/propuse.js` — PROPS_PURPOSE anchor registry: `propRegisterSeat` (73),
  `propRegisterBed` (85), `propRegisterWantedPoster` (100); sit/sleep/wake verbs.
- `src/systems/interact.js` (prison social verbs), `src/systems/survival_interact.js`
  (grapple verbs), `src/systems/proptypes.js` (spawn→animate→proximity registry).

Precedents already set IN the code: the interior wall clock was cut (buildings.js:3430),
rooftop AC/vent/dish clutter was cut (props.js:1777-1799), the fake stair-hut was cut
(props.js:1801-1807), floating price sprites were cut (gunstore.js:74-78). This audit
extends that doctrine to what's left.

---

## (a) Executive summary

**Counts (distinct prop classes in the tables below): WIRED 64 · WIRE-IT 25 · CUT 11
(kill-list entries).**

The city is far healthier than the owner's "99 percent is dumb" fear — seats, beds,
counters, cases, stashes, posters, ad boards and even trash cans already answer WHY.
The remaining rot concentrates in three places: (1) **shop shelf stock** — every trade's
walls are stacked with goods you can only buy through the counter menu, never touch;
(2) **flagship-only wiring** — gun wall / jewelry cases / clothing racks are real at ONE
lot each, decor everywhere else; (3) **pure garnish** — ficus plants, bike racks, a
redundant sandwich board, double-dressed casino felt.

**Top 10 WIRE-ITs, ranked by payoff-per-effort:**

1. **Propane cage → it EXPLODES when shot** (props.js:1421). One `hitProp` branch routing
   to `cityExplosion` (explosives.js). The shootables registry already sees every tracer.
   Maximum juice, ~an afternoon.
2. **Shop shelves/gondolas → SHOPLIFT** (buildings.js:3384, 3875). Grab one item when the
   clerk can't see you — jewelry.js's clerk-LOS + pry logic already written; pays via
   `econ.add` + `cityCrime("theft")`. One mechanic retires "decor stock" in ~15 trades.
3. **Bank vault → the heist surface** (buildings.js:3624 door, 3922 vault room). Drill or
   charge it via heists.js/explosives.js; alarm + wanted + a real score. Today a vault
   with a wheel handle answers no question at all.
4. **Parking meter → smash for coins** (props.js:1250). `tipProp` already animates the
   knock; pay $5-20 once per meter on first topple + `cityCrime("vandalism")`. ~20 lines.
5. **Mailbox → "Check the mail"** (props.js:1212). searchStreetProp pattern verbatim
   (interact.js:354): cash envelope or an intel tip (marks a rich ped/lot), theft heat.
6. **Casino slot bank → "Pull the handle"** (casino.js:137, buildings.js:3577). Per-slot
   one-spin wager, small stakes, instant — the casino-table zone pattern (casino.js:166).
7. **Home kitchen/fridge → "Raid the fridge"** (buildings.js:3246 setKitchen, 3297 break
   fridge). Feeds hunger.js at your owned home (or a burgled one — petty theft). Gives
   every dressed kitchen in every flat a job.
8. **Club dance floor → "Hit the floor"** (buildings.js:3533-3546). A dance beat that
   ticks respect/club standing while inside — club.js already pays bottle service
   (club.js bottleCD); this is the floor's version.
9. **Showroom pads → "Buy THIS car"** (buildings.js:4626-4682). The placard already shows
   name+price; a per-pad zone sells the displayed model instead of the generic
   "$1,500" menu car (shops.js:440). The fantasy is pointing at the one you want.
10. **Back-of-house stockrooms → after-hours burglary** (buildings.js:3440, setBackroom
    3302). Crate pry via roofloot.js's crackOpen pattern; burglary crime; fenceable loot.
    Every partitioned shop back-room becomes a night job.

Honorable mentions: Spire deck cars → real boostable cars (buildings.js:4690 — fake
un-stealable cars in a GTA game are a decoy); pool loungers → register as seats
(buildings.js:4555, one line each); DJ booth → tip the DJ / request a track
(buildings.js:3560, systems/music.js exists); security CCTV wall → shows live heat/marks
for the security career (buildings.js:3794).

---

## (b) Verdict tables

### src/city/props.js — street furniture

| Prop | file:line | Verdict | Why / mechanic |
|---|---|---|---|
| Traffic signal heads | props.js:930 | WIRED | traffic.js drives phases; red-light tickets |
| Street lamps | props.js:1048 | WIRED | shoot the head → block goes dark; collider; light pool |
| Fire hydrant | props.js:1196 | WIRED | shot pops a 20s water geyser (props.js:329) |
| Mailbox | props.js:1212 | WIRE-IT | "Check the mail" — cash/intel envelope, theft heat; reuse searchStreetProp (interact.js:354) |
| Trash can | props.js:1231 | WIRED | "Check the trash can" search zone (interact.js:682) + car/bullet knockdown |
| Parking meter | props.js:1250 | WIRE-IT | smash/topple pays coins once + vandalism heat; tipProp anim exists |
| News box | props.js:1272 | WIRED | search zone + knockable |
| Traffic cone | props.js:1293 | WIRED | physics toy — bullets and bumpers send it flying (carKnockables) |
| Planter / street tree | props.js:1314 | WIRED | collider + cover; streetscape structure, not walk-up decor |
| Generic A-frame ad board | props.js:1348, placed 1636 | CUT | redundant third ad surface; shelters+billboards are already rentable |
| Per-shop sandwich board | props.js:1443 | WIRED | wayfinding — promo keyed to a real counter you can use |
| Patio set | props.js:1372 | WIRED | 2 registered seats (1393-1397) |
| Bike rack | props.js:1405 | CUT | there are no bikes in this game |
| Propane cage | props.js:1421 | WIRE-IT | shoot → cityExplosion; add a hitProp branch (props.js:307) |
| Bus shelter | props.js:1464 | WIRED | 3 bench seats (1480) + rentable ad panel (1495, adboard.js) |
| Billboards (street/roof) | props.js:1510, 1832 | WIRED | rentable faces (CBZ.cityAdBoards), live WANTED poster → readable bounty (propuse.js:162), market ticker |
| Roof parapet rails | props.js:1812 | WIRED | fall-prevention; the decorative roof clutter was already cut (1777) |
| Camp tents + fire barrel | props.js:1919-1966 | WIRED | camp anchors (1983) drive vagrant peds + cop rousts; hearth is the camp's read |
| Camp cardboard bedrolls | props.js:1970-1978 | WIRED | registered sleepable bedrolls |
| Camp shopping cart | props.js:1900 | WIRE-IT | "Rifle the cart" — searchStreetProp w/ cooldown; petty theft if a vagrant sees |

### src/city/buildings.js — shared interior dresser (furnishInterior 3323)

| Prop | file:line | Verdict | Why / mechanic |
|---|---|---|---|
| Counter register + screen | buildings.js:3375-3379 | WIRED | vendor menu + "Rob the register" (interact.js:973, robRegister 382) |
| Wall shelves + stock rows | buildings.js:3384, 3406 | WIRE-IT | SHOPLIFT one item when clerk LOS-blind (jewelry.js pry logic) → econ.add + theft crime |
| Gondola aisles (default shops) | buildings.js:3875-3883 | WIRE-IT | same shoplift hook |
| Back-of-house wall + stockroom | buildings.js:3440, setBackroom 3302 | WIRE-IT | crate pry after hours (roofloot crackOpen) → burglary |
| Entry stools / waiting chairs | buildings.js:3432-3436 | WIRED | registered seats |
| Potted plant (every shop) | buildings.js:3425-3426 | CUT | the literal random ficus |
| Interior waste bin | buildings.js:3428-3429 | CUT | wall-clock precedent (3430) — no job indoors |
| Mood ceiling fixtures / floor tint | buildings.js:3353-3373 | WIRED | lighting/trade-read, not a walk-up prop |

### buildings.js — per-trade dressers

| Prop | file:line | Verdict | Why / mechanic |
|---|---|---|---|
| Gun racks + pistol cases + ammo crates (dresser) | buildings.js:3477-3505 | WIRE-IT | flagship lot uses gunstore.js's REAL buyable wall; extend it (or jewelry-style smash+alarm) to every `guns` lot |
| Jewelry/pawn lit cases (dresser) | buildings.js:3507-3513 | WIRE-IT | same: jewelry.js smash/pry/buy exists at ONE lot; town jewelers are paste |
| Pawn junk-pile island | buildings.js:3512 | WIRED | set for pawnshop.js's live sell/pawn desks |
| Bar bottle wall + neon | buildings.js:3518-3523 | WIRED | set for "Buy a round" → drinking.js drunk sim (shops.js:454) |
| Bar stools | buildings.js:3525 | WIRED | seats facing a live counter — load-bearing |
| Club dance floor + mirror ball | buildings.js:3533-3546 | WIRE-IT | "Hit the floor" dance beat → respect/standing while admitted (club.js pays bottle service already) |
| Club VIP booths + cocktail tables | buildings.js:3549-3557 | WIRED | booth seats inside the earned rope |
| Club DJ booth | buildings.js:3558-3565 | WIRE-IT | tip the DJ / request a track (systems/music.js) |
| Club interior cordon | buildings.js:3566-3569 | WIRED | reads the VIP tier — club is the status system |
| Casino dresser felt tables + slots | buildings.js:3570-3583 | CUT | double-dressing — casino.js builds the REAL tables+seats+zone on the same lots |
| Diner booths + benches | buildings.js:3591-3601 | WIRED | booth seats; food counter heals (hunger.js) |
| Diner menu board | buildings.js:3602-3607 | WIRED | set for a live food counter |
| Bank teller desks + glass | buildings.js:3613-3620 | WIRED | bank.js branch: teller line, ATM, loans, shatterable glass |
| Bank queue rope | buildings.js:3621-3623 | CUT | decor rope with no queue system behind it |
| Bank vault door + vault room | buildings.js:3624-3634, 3922-3931 | WIRE-IT | THE heist target — drill/charge via heists.js + explosives.js |
| Gym benches/dumbbells/mirror/mats | buildings.js:3637-3654 | WIRE-IT | "Work out" at the rack = the $100 train() service in-world (shops.js:439) |
| Gym locker room | buildings.js:3942-3951 | WIRE-IT | lockers lootable (petty theft) or stash-your-heat locker |
| Clothing rounders + shelf stacks | buildings.js:3660-3670 | WIRE-IT | flagship uses clothingstore.js real racks; extend or shoplift-hook the rest |
| Clothing mannequins (dresser) | buildings.js:3671-3678 | WIRE-IT | clothingstore.js mannequins sell the outfit; dresser ones should too or go |
| Fitting booths | buildings.js:3905-3914 | WIRED | set for the FITTING ROOM closet (shops.js:352) |
| Barber chairs + mirrors | buildings.js:3680-3688 | WIRED | seats + HAIRCUTS service (shops.js:404) |
| Trap-house couch + baggie table | buildings.js:3692-3704 | WIRED | couch seats; counter sells product + dealer career |
| Electronics screen walls + gadget island | buildings.js:3707-3717 | WIRE-IT | covered by the shoplift hook (steal a phone → fence) |
| Hardware racks/lumber/pegboard | buildings.js:3720-3729 | WIRE-IT | covered by the shoplift hook |
| Hospital beds + curtains | buildings.js:3732-3743 | WIRED | beds registered sleepable (3739); desk heals |
| Hospital exam rooms | buildings.js:3932-3941 | WIRED | set for the heal trade |
| Gas cooler/endcap/coffee machine | buildings.js:3746-3756 | WIRE-IT | covered by the shoplift hook |
| Realtor desks/listings/scale model | buildings.js:3762-3778 | WIRED | realtyoffice.js live listings wall + agent desks |
| Security CCTV monitor wall | buildings.js:3792-3797 | WIRE-IT | "Check the feeds" — shows heat/marks for the security career (careers.js) |
| Raceway windows/odds board/track map/trophies | buildings.js:3800-3866 | WIRED | island_speedway "raceway-book" zone + Racing board (shops.js:456) |
| Showroom pads + placards + real cars | buildings.js:4626-4682 | WIRE-IT | "Buy THIS car" per pad at placard price |
| Spire deck cars (static) | buildings.js:4690-4709 | WIRE-IT | replace with real boostable parked cars — fake cars are decoys |

### buildings.js — homes, offices, apex floors

| Prop | file:line | Verdict | Why / mechanic |
|---|---|---|---|
| Beds (home/flat/penthouse/squat) | buildings.js:3223, 4073, 4222, 4399, 4848 | WIRED | registered sleepable → time-skip, rested |
| Sofas/dining/kitchen stools | buildings.js:3236-3300, 4105-4142 | WIRED | registered seats throughout |
| Kitchens (every tier) | buildings.js:3246, 4087-4091 | WIRE-IT | "Raid the fridge" → hunger.js feed at owned/burgled homes |
| TVs, rugs, bookshelves, art, wardrobes | buildings.js:3230-3244, 4118-4158 | WIRED | home-tier read; the home itself is the wired asset (zillow buy/rent, safehouse sleepHeal) |
| Office desks + chairs + monitors | buildings.js:4258-4365 | WIRED | officejobs.js: desk registry, seated AI workers, payroll, barge-in panic |
| Reception/meeting/break sets | buildings.js:3276-3300, 4311-4337 | WIRED | seats registered; the bullpen is live |
| Penthouse king/sectional/stools/dining | buildings.js:4393-4425 | WIRED | sleep + seats on the apex floor |
| Penthouse grand piano | buildings.js:4426-4429 | WIRE-IT | "Play" — a one-key flavor beat (+respect at a party, citySay) or cut |
| Penthouse wine wall / billiards / home gym / library / closet | buildings.js:4450-4501 | WIRED | apex-status set behind a MEGA-TOWER climb — but see burglary note in (c) |
| Pool floor: basin/spa/wet bar | buildings.js:4529-4577 | WIRED | destination floor (owner-asked); water decorative by design |
| Pool loungers | buildings.js:4555-4562 | WIRE-IT | register as seats — one `propRegisterSeat` line each |
| Derelict squat couch + mattress + drum fire | buildings.js (abandonDecor):4833-4859 | WIRED | seat + bedroll registered; gang hideout set |

### Rich walk-in modules (all WIRED — the gold standard)

| Module | File | What's wired |
|---|---|---|
| Gun wall | src/city/gunstore.js | real AK/pistol models, [E] buy off the wall, SOLD gaps, restock |
| Jewelry cases | src/city/jewelry.js | buy / smash-alarm / night-pry, restock, wearable assets |
| Clothing racks | src/city/clothingstore.js | rails, mannequin fits, fitting mirror → wardrobe |
| Pawn window | src/city/pawnshop.js | sell at a haircut, collateral loans, forfeit tickets |
| Bank branch | src/city/bank.js | tellers, ATM, loan engine, pawn loans, shatterable glass |
| Realty office | src/city/realtyoffice.js | listings wall, agent pre-approval, scale model set |
| Mod garage | src/city/modshop.js | drive-in bay: armor/booster/turret/rockets/wedge |
| Casino | src/city/casino.js | felt tables + 4 seats each + "Sit at the table" zone (166) |
| Club | src/city/club.js | rope, bouncer, drip gate, line NPCs, safe haven, bottle service |
| Roof stashes | src/city/roofloot.js | climb-earned duffels, pry-beat, gang provoke, restock |
| Beach | src/city/beach.js | towels/coolers/bags rifleable ([E], theft), pier bench, climbable containers |
| Ad boards | src/city/adboard.js | rent any face; your creative on the skyline |
| Worn bling | src/city/bling.js | valuables visible on bodies; robbing strips it live |
| Window interiors | src/city/interiormap.js, interiorlight.js | rendering fakes, not walk-up props — correctly non-interactive |

### Prison / survival (src/world/*, src/systems/*)

| Prop | file:line | Verdict | Why / mechanic |
|---|---|---|---|
| Breaker box | world/props.js:151, systems/interactions.js:58 | WIRED | 20s power sabotage (cameras+lights) |
| Security cameras | systems/interactions.js:96 | WIRED | detection cones; punch to smash |
| Vent grates | systems/interactions.js:138 | WIRED | crouch-crawl secret routes |
| Armory racks | world/gunroom.js:117 | WIRED | physical weapon slots → unlockWeapon |
| Yard crates | world/crates.js | WIRED | pry-open for cigs + LOS cover (NO-DECOY fix) |
| Oil barrels | world/props.js:178 | WIRED | solid cover + LOS blockers |
| Picnic table | world/props.js:47 | WIRED | walkable platform (walkTop) |
| Yard benches / clutter | world/clutter.js | WIRED | cover + light colliders (NO-DECOY fix); puddles are decals |
| Basketball hoop | world/props.js:38-42 | CUT | zero interaction, no ball exists |
| Laundry line + cloth | world/clutter.js (east wall) | CUT | pure garnish |
| Lounge cig packs | world/lounge.js:37-38 | WIRED | steal-bait pickups (proptypes "coin") |
| Lounge TV / coffee machine / mug | world/lounge.js:30-36 | CUT | the couch (cover) and packs carry the room |
| Cafeteria trays / hot-food glow | world/cafeteria.js:26-39 | CUT | tables anchor inmate milling; the trays answer nothing |

Pure-data / non-prop files checked: citytemplates.js (town recipes — every prefab
shopKind is a real staffed trade), towngen.js:553-561 + villagekit.js:134 (every town
home auto-furnished → beds/seats registered — the Minecraft rule, verbatim).

---

## (c) Interior by interior — what question does this room answer twice?

**Bar / Velvet Club** — Answers: "am I somebody yet?" The rope gate reads your drip,
rejection teaches you to shop, admission pays respect + a cop-cooling safe haven +
bottle service. Second visits are built in (heat management, the VIP connect). One
change: make the dance floor DO something (WIRE-IT #8) so the room past the rope is a
verb, not a screensaver.

**Casino** — Answers: "can I beat the house?" Real tables with sit-zones open live
blackjack/roulette; the counter runs the sportsbook. Twice? Yes — gambling loops.
One change: per-slot handle pulls (#6) so the dominant floor feature isn't a menu alias;
also delete the older dresser felt (kill list) so the room isn't dressed twice.

**Gun store** — The best room in the game. "What can I afford to kill with?" — the wall
IS the menu, SOLD gaps + restock make stock a world fact. Twice: ammo, upgrades,
new unlocks. One change: extend the live wall (or a smash-and-grab variant) to town gun
shops, which currently fake it with the dresser's rifle decor.

**Clothing store** — "What do I look like?" Racks/mannequins/mirror sell composable
fits that gate the club and read on the street. Twice: drip ladder. One change: same
flagship-only problem — town boutiques get decor rounders; hook or shoplift them.

**Jewelry** — "Buy the ice or smash the case" is the purest loop in the city: retail
front, steal-only vault, night pry, insurance restock. Twice: restock timer invites you
back. One change: none needed at the flagship; clone to town jewelers.

**Pawn shop** — "I need cash NOW." Sell at a haircut or pawn for a collateral loan with
a forfeit clock. Twice: every haul ends here. Answered.

**Bank** — "Where does money live?" Deposit/withdraw/loans/ATM all live. The unanswered
half is the VAULT — a steel door drawn to be coveted with no way in. One change: wire
it to heists.js (#3) and the bank becomes the city's biggest twice-visit.

**Mod shop / chop shop** — "Why keep a car?" answered in full: sell vs weaponize.
Twice: ammo resupply, respray heat-shedding. One change: showrooms should sell the car
on the pad you're looking at (#9).

**Realty office** — "Where do I live next?" Listings wall + financing, tied to the same
Zillow data as the phone. Twice: the ladder. Answered.

**Offices** — "Who works in this tower?" Desks seat real scheduled AI; barging in armed
causes panic + heat; payroll is robbable. Twice: payroll days. Answered — meeting/break
rooms are staging for those AI, fine.

**Apartments / homes** — "Somewhere to sleep" is answered (beds everywhere, time-skip,
tiers read on the ladder). The missed second answer is FOOD: every tier draws a kitchen
that can't feed you (#7). A fridge that feeds hunger.js makes home the place you return
to daily — the Minecraft answer.

**Penthouse / pool floor** — "What does winning look like?" Status set at the top of a
30-storey climb; piano/billiards/wine are the trophy room. Twice is weak once you own
it. One change (bigger, worth logging): furnished homes as BURGLARY targets — the wine
wall, TVs and closets become loot when it's not YOUR penthouse. Also: register the pool
loungers as seats (one-liners).

**Gym** — "Get stronger" is a counter menu (+10 HP) and a fight card. The iron on the
floor is scenery. One change: train AT the rack/bench (#WIRE-IT), lockers lootable.

**Hospital** — "Get healed" (desk) + sleepable beds. Answered; exam rooms are staging.

**Diner / gas / hardware / electronics** — Buy-consumables rooms; booths seat you, food
heals. The shelves are the gap — the single shoplift mechanic (#2) makes every one of
these rooms answer "buy it or risk it," twice by nature.

**Trap house** — "Cop product / turn dealer" answered at the counter; couch seats.
Staging is appropriately grim. Fine.

**Security office** — "Get the guard job" is a menu line; the CCTV wall is the room's
face and does nothing. One change: monitors show live heat/mark intel for the career.

**Raceway parlor** — "Bet on the next race" — windows + odds board + island zone verbs.
Answered.

**Derelict squat** — "Somewhere to crash when you're nothing." Seat + bedroll + gang
stash adjacency. Bottom rung of the ladder, answered.

**Prison rooms** (cafeteria/lounge/armory) — armory answers (weapon slots), lounge
answers via steal-bait packs; cafeteria answers only as an AI mill area — its trays and
the lounge's TV/coffee machine are garnish (kill list).

---

## (d) Kill list — CUT items, ready to execute

- [ ] Generic sparse A-frame sandwich board — builder props.js:1348-1359, placement
      props.js:1636-1643 (keep the per-shop `shopBoard`, props.js:1443)
- [ ] Bike rack (gym sidewalk) — props.js:1405-1417 + its `place()` call at 1679
- [ ] Interior potted plant in every shop — buildings.js:3425-3426 (baseClutter)
- [ ] Interior waste bin in every shop — buildings.js:3428-3429 (wall-clock precedent)
- [ ] Home/penthouse planter cubes — buildings.js:4133-4134, 4143, 4432-4433
- [ ] Casino dresser felt tables + slot cabinets — buildings.js:3570-3583 (casino.js
      dresses the same lots with REAL seated tables + zone; delete the double)
- [ ] Bank queue rope — buildings.js:3621-3623
- [ ] Prison basketball hoop — world/props.js:38-42
- [ ] Prison laundry line + hung cloth — world/clutter.js (east-wall block)
- [ ] Prison lounge TV + coffee machine + mug — world/lounge.js:26-36 (keep couch/
      armchair as cover, keep cig packs at 37-38)
- [ ] Cafeteria tray/hot-food garnish — world/cafeteria.js:26-39 (keep tables/benches
      as the inmate mill area)

Notes for the executor: every CUT above is `cast:false` batched decor with no collider
refs and no userData (batch.js-safe to remove); the two placement-stream items
(A-frame at props.js:1636, bike rack at 1679) draw from the shared seeded `rng()` —
preserve the draw count (consume-and-discard, the props.js:1790-1799 idiom) or accept a
world-layout reroll. Verify per CLAUDE.md: `node --check`, `smoke-play.mjs 10`
(`invariants: ok`), `street-shot.mjs` + `city-atlas.mjs` on a few seeds.
