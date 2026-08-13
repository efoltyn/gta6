# Doctrine — the WHY constitution, hard rules, the Block Law

> Extracted verbatim from the old giant CLAUDE.md (split 2026-08-02). Binding.

## THE WHY CONSTITUTION (owner, 2026-07-28) — read this before designing anything

The owner's own words, and they outrank every system doctrine below. **A game is a
why-machine.** Everything here exists to answer "why am I doing this", and a thing
that cannot answer it is noise however polished.

**LAW 1 — THE WHY IS DISCOVERED, NOT ASSIGNED.** The keycard story is the whole
theory. In the jail minigame the owner ran for the keycard hundreds of times with
nothing new to test — and NOT for the designed whys (escape, cigarettes). He ran
because the keycard opened a door to a bigger room, and that room had another door,
and behind it was THE GUN ROOM. Verbatim: *"the jail is dumb but I ran to get the
keycard relentlessly… that's what makes it a game."* So: **build gradients of
visible access and power, not objectives.** A player chases the strongest gradient
he can SEE. Doors beat markers. It does not matter if the thing you are doing is
dumb if it answers why.

**THE GUN-ROOM GRAMMAR — why that room worked, and the pattern to repeat:**
(a) **it was LOCKED** — a key is a promise, and a locked door with something visible
behind it out-motivates any quest marker; (b) **it was the best-made room in the
game** and the owner noticed ("better interior than anything in my GTA game") —
**craft is a signal; polish spread evenly creates no gradient, so nothing pulls.
Spend polish ASYMMETRICALLY on the rooms that matter**; (c) **the reward changed his
CATEGORY, not his number** — "the only character with a gun in the jail." Categorical
asymmetry is the reward that works. The bunker vault (blast door inside a blast door,
THE DEVICE on a cradle, one per world) is this game's one existing instance of the
grammar. It should be the SPINE, not a one-off: **a ladder of gun rooms**, each
loyalty rung unlocking a crafted, locked PLACE holding the tools of the next rung.
Corollary the owner named: glowing floor pickups make it "Subway Surfers" — physical,
crafted, locked things make the gradient.

**LAW 2 — THE WHY IS PEOPLE. The atom is LOYALTY + WEAPONS.** Money → people →
power. A gang, a prison gang, election supporters, a CIA cell, a corporation's
security, an army unit: *"anytime you have a ton of people loyal to you with weapons
could be a gang"* — Haiti is the owner's cited proof. Every endgame is that atom
spent: buy the city and build the tallest tower and fill it with your people; run for
mayor→governor→president; coup with the military or an agency; rob the armory to arm
a crew; take a hostage whose family is rich; dominate as racer or fighter, convert
fame into office into dictatorship. **We have already built the organs without naming
the creature** (factions/ranks-as-verbs, power details, elections + officeholders,
prison gangs, the armory, standing/wages/succession). What is missing is ONE spine:
the ledger that counts who is loyal to YOU and how armed they are, plus the threshold
verbs it unlocks. That block outranks the rest of the roadmap; a 10x city matters
because it is more to OWN.

**LAW 3 — THE ROME TEST (this is a game ENGINE).** Owner: *"I don't want to make
Roman-age Bannerlord, but I could easier than from scratch using my current code…
future Claudes don't need to draw and animate an NPC — that alone is worth my code —
they just draw the outfit and add animations and interactions."* So judge every block:
**does it survive a total setting change, or is it welded to modern-day gangs?** The
walking/fighting/sitting/ranked/covered/dying NPC is the asset. Scenarios are costumes.

**THE ITEM EXISTENCE TEST (falls out of the three laws).** *"Everything in inventory
is a physical asset."* An item must (1) have a physical asset, and (2) sit on a chain
you can walk to a why. Minecraft's inventory IS its game; ours must shrink until the
WORLD is the inventory. Guns and clothes are worn. Trade goods are CARGO in trunks,
not pocket abstractions — which answers the animal: the carcass is the item you carry
and sell, so the skin-popup and 13 abstract meat names both die. The pocket keeps
only what a person pockets: cash, phone, keys/keycards, medkit, grenades, bricks.
**An item that cannot produce an icon from its own asset fails the existence test —
refusing to draw an icon IS the reversible soft-cut.** Full analysis and the family
verdicts: `docs/plan/doctrine-items.md`.

**STANDING OWNER MANDATES (2026-07-12, older than the laws above, still
binding):** FIRST PERSON IS SACRED — "first person is amazing as is"; polish
third-person freely, never rework first-person feel. NO CRAFTING — "kill
crafting"; acquisition is buy/steal/loot in the world, never a recipe UI.
PERMADEATH is the design — brutal deaths (headshot/explosion/fall/execution)
are GAME OVER + save wipe (`CITY_PERMADEATH`, `city/death.js`; scripted kills
pass `imp.fatal`), survivable hits hospital-respawn.

**WHERE THE THINKING LIVES.** `GAMEPLAN.md` is the master plan (witness · scale ·
airline network · fauna · mantle · flag purge · §10 rim world · Step 0.5 icon purge).
`docs/plan/` holds every recon and pillar document behind it, including
`doctrine-items.md` (item purpose vs Minecraft/Rust/Bannerlord; the ~80%-built
arbitrage engine pointed at the wrong scope) and `doctrine-globe.md` (**true sphere
REFUSED on arithmetic** — a sphere with our area gives a 129 m horizon, one big
enough to keep a horizon gives 6 m of sag; staged answer is biome science → visual
globe → rim → maybe a one-axis ocean wrap; plus the 9-step Köppen/orography rule
table that VALIDATES eight of our shipped biome placements).


## Hard rules that keep the game correct

- **Determinism**: world builds must be byte-identical per seed across
  clients (multiplayer). In any build/generation path use `CBZ.hash01(x, z,
  salt)` / `CBZ.hashN(...)` (position-hash) or `CBZ.seedStream(name)` —
  NEVER `Math.random`, and NEVER add/remove draws on a shared `rng()`
  stream (order-fragile). Runtime-only FX may use `Math.random`.
- `?seed=N` in the URL selects the world; tools accept a seed where relevant.
- Batching: `core/batch.js` merges static geometry once at load. Meshes with
  colliders/LOS refs or non-empty `userData` are spared. Per-building
  removal goes through `CBZ.batchHideGroup/batchShowGroup` — never dispose
  merged buffers.
- Explosion wrappers (`cityExplosion` et al.) are wrapped by several modules:
  copy EVERY `*Wrapped` marker forward when wrapping, and make handlers
  idempotent per blast (see demolition.js's `opts._demoSeen`).
- New feature flags: `CBZ.CONFIG.<AREA>_<BEHAVIOR>` in `src/config.js`,
  `if (CBZ.CONFIG.X == null) CBZ.CONFIG.X = default;` — every risky feature
  must be a one-line revert.
- New scripts load via a `<script>` tag in `index.html` — order matters
  (`config.js` → `seed.js` → world → systems).

## THE BLOCK LAW — how capability work must ship

OWNER DOCTRINE (2026-07-26): "every feature I came up with was built as an
add-on with all new code when really it just needed to reuse other shit and
draw some new shit and animate it." The repo is fat because features pile up
instead of compounding. Every change must IMPROVE a shared capability, not add
a parallel one. A new experience should author only what is genuinely new — an
asset, an animation, a payout rule — and get NPCs, interiors, prompts, money,
missions and damage for free.

This has been attempted once and it failed. July 1-2 built `core/prio.js`,
`systems/proptypes.js`, `core/interfaces.js`, `bootstrap.js`. Today:
interfaces.js has ZERO adopters, proptypes.js has ONE (bypassed the same day it
shipped, by the same author, for a competing system). Meanwhile `ctx`
(`core/packages.js`) got 10 adopters in two days and `interactions.js` has 18.
The difference is not quality. It is this:

> **A block must REPLACE code the caller writes anyway. A block that adds
> parallel bookkeeping dies within 24 hours.**

Therefore, any new shared capability MUST satisfy all five:

1. **One-line adoption, zero ceremony.** No schema to declare, no type to
   register, no call signature to change. If adopting costs more than the line
   it replaces, it will not be adopted. Copy the shape of `interactions.js`
   (`I.register("ped:civ", {id, slot, label, onSelect})`) or `ctx.*`.
2. **Degrade-safe fallback.** `CBZ.X ? CBZ.X.thing : <old inline value>` —
   adopting must never be able to break the caller. This is the ONLY reason
   prio.js survived at all where its siblings did not.
3. **Ship with ≥3 real consumers migrated in the SAME change.** A block with
   zero consumers is prose. Migrating the consumers is what proves the API and
   is 80% of the work — budget for it.
4. **Named in CLAUDE.md.** In-file "RULE FOR NEW CODE" comments demonstrably
   did nothing. If it is not law here, it does not exist.
5. **A ratchet counter in the math gate.** Export `CBZ.<name>Audit()` from the
   real game file (NOT a tool) returning the count of remaining legacy call
   sites, and pin it in `tools/math-gate.mjs`'s PASS block at its current
   value. The number may only ever go DOWN. `CBZ.treeAudit()` (commit d582a82,
   pinned at zero) is the working template — copy it exactly.

CURRENT RATCHET BASELINES (2026-07-26 RE-CENSUS; each is a duplication count
that may only DECREASE). The previous numbers here were guesses and every one
of them was too low — some by 8x. These were counted file-by-file. Do not
trust a number in this list without recounting; do not lower one without
showing the work:

| what | old claim | TRUE |
|---|---|---|
| raw `.hp -=` / health-field writes bypassing a bus | 19-20 | **52** |
| independent AI update loops | 18-25 (2 share) | **32** |
| buy/purchase transactions | 6 | **52** (77 incl. bribes/gambling) |
| ownership containers | 9 | **15** |
| NPC-in-building spawners | 9 | **18** (`occupyAudit()` sees only 9) |
| rank/tier ladders | 6 | **20** (gang ladder retyped 8x / 6 files) |
| reputation scalars | 9 | **34** |
| objective UIs | 5 | **6** live + 1 dead stub |
| buoyancy impls | 6 | **10** |
| mission systems | 7 | **12** (5 on `core/mission.js`, 7 private) |
| raw material constructions bypassing `CBZ.cmat`/`mat` | — | **566** |
| phone UIs | — | **2** (`phone.js` 984 + `campaign_ui.js` 1138) |
| furniture anchors NOTHING can walk to (`propUseAudit().blocked`) | 0 (claimed) | **487** of ~6000 |
| seat anchors with no declared cushion (`.noGeom`) | — | **4955** of 5993 |
| venue seats whose anchor declared no cushion (the arena bowl) | — | **0** (was every one) |
| rank/tier ladders (RE-COUNTED 2026-07-27, file-by-file) | 20 → ~28 | **~24** |
| ↳ copies of the GANG rank order alone | 8 | **7** (playergang · careers · leaderboard · level ×2 · gangs ×2 — `hud.js`'s copy is DELETED) |
| ↳ copies of the POLITICAL title ladder | — | **8 files** (officials · officialdom · contracts · civic · statecraft · candidacy · elections · games/government) |
| jobs the world casts that `aigoals.js` `CITY_JOBS` has never heard of | — | **~120** (no workplace, no shift, no wage) |

The rank-ladder row still dwarfs the old 20, and the political sub-row is why:
the political title ladder ("President"/"Governor"/"Mayor"/"Chief") is
hand-copied across EIGHT files, and `officialdom.js`'s own comment admits the
duplication while predicting it "is not going to be four" — it is eight. **That
one is the next migration owed.**

CORRECTED 2026-07-27 (this paragraph used to name three live faults; all three
are now fixed, and leaving the old text would be exactly the stale-claim
problem this file keeps catching itself in):
- `careers.js`'s `secco` was "three rungs of `wageMul` and nothing else". Senior
  Guard now issues a REAL sidearm through `CBZ.cityGiveWeapon`; Shift Manager
  survives one star instead of being fired on the spot. The multipliers stay —
  being the *only* difference was the fault, not existing.
- `level.js`'s `MIL_NAME` was "8 rungs that unlock nothing at all", with a top
  rung unreachable in practice (0.3% per body off the SEEDED stream). It is no
  longer a ladder at all: `militia.js` declares the ONE army ladder, three of
  those eight rungs (Captain · Major · Colonel) are DELETED for having no verb,
  and rank is assigned by roster slot so a General exists the moment a garrison
  does.
- "There is **no police rank ladder at all**: `police.js` has one boolean,
  `swat`." There is one now, it has six rungs, and five of them gate an order
  the force already knew how to give. See "A RANK IS A VERB, OR IT IS NOTHING".

The last two are the newest entry and the sharpest lesson in this table: both
numbers come from an audit that had existed for weeks with a header confidently
instructing the next person to "pin `blocked` at 0". The first build that ever
RAN it read 487. **An audit nobody has executed is not a measurement.** Run
yours before you write its baseline into this file.

Two counters moved the RIGHT way and are worth copying: the gang ladder is no
longer typed 3x inside one file (`playergang.js:651` is now a single
documented fallback), and `core/mission.js` genuinely took 5 adopters.

ALSO BANNED: **stat fictions** — a flag that claims something exists with no
world presence. Live examples, all verified this census:
- `g.cityPhoneTier` — `shops.js:464,704-712` sells four phone upgrades
  promising "better deals & street intel"; the value is read by NOTHING except
  the four lines that sell, cap and display it.
- `CBZ.forex.convert()` (`sim/forex.js`) — zero callers. The player can read
  four exchange rates on the phone and can never act on them.
- `"communism"` / `"fascism"` govTypes — 9 gates across `regimes.js`,
  `polwar.js:519`, `civilwar.js:600`, `militia.js:329,336,343`,
  `sim/centralbank.js:242` branch on them (police multipliers, tax rates,
  price controls). NO producer anywhere assigns either value. Full effect
  code behind a door that cannot open.
- `/me` `/do` `/ooc` chat modes — `net/netui.js:136-138` styles all three and
  the placeholder advertises them, but `net/net.js:71` never parses a slash
  command or sets `m.kind`. Permanently unreachable.
- `sim/hyperinflation.js` — 1045 lines (largest sim file). Its entire public
  API has zero callers outside `src/sim/` except save/load serialization.
  `counterfeit()` is a complete, tested cash-injection mechanic no button
  reaches.
(The old "$4M Superyacht" citation was stale — `wealth.js:344-354` already
deleted it with a NO-FICTION NOTE. That is the pattern to copy.)

