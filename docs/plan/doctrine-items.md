# ITEM DOCTRINE — do these 284 things need to exist?

*Decision document. No code changed, nothing deleted. Written 2026-07-28 against the live
source, not against GAMEPLAN's summary — where I recount, I say so.*

OWNER'S FRAMING, verbatim: *"its NOT 50 drawings — its evaluating if those things need be in
game if not physical. dont delete yet, just think and tell me. really considering my idea of
making the cities significantly bigger, more super tall buildings, adding parking lots parks etc
— what items matter? how does this game compare to minecraft (ik we dont craft) and rust, and i
want to eventually have a bannerlord feel. look at items in all those games and the purpose of
them, and think about ours. icons should never be these default things with no logic and no
physical asset."*

---

## 0. THE ANSWER IN SEVEN LINES

1. **The icon census and the ground-drop census are the same census, and nobody ran the second
   one.** `city/inventory.js:378` `makePhysicalDrop()` gives guns a gun, melee a knife/bat, cash a
   briefcase — **and every other item in the game a generic backpack.** So ~250 items are generic
   in the bag *and* generic on the pavement. One mini-model fixes both. That doubles the return on
   every drawing and it is the single strongest argument for drawing rather than cutting.
2. **The real disease is not missing icons, it is missing VERBS.** The entire city item-use switch
   is three branches (`systems/fpsmode.js:2898-2905`): food→eat, throwable→throw, drug→"not for
   using". Tools, valuables, pelts, meat, materials cannot be used at all. An item with no verb
   would still be noise with a beautiful icon.
3. **Only ~70 of the 284 fail the existence test.** The rest either have a physical asset already
   (apparel, pelts, jewellery, guns) or have a real loop (drugs, food, valuables) or both.
4. **The Bannerlord economy is ~80% built and pointed at the wrong scope.** `city/economy.js` has a
   full Chinatown-Wars regional arbitrage engine — per-district demand profiles, supply flooding,
   scarcity, hot-tip spikes, turf margins — and it is wired to **four drug names** through a
   `districtAt(x,z)` that maps the entire planet into five mainland quadrants. Keshtown and Mbeya
   City read as the same market.
5. **The production map already exists and is called `baseTemplate`.** Every settlement in the
   world already declares its economy: `harvestmarket` (Farm County), `capeharbor` (Port City),
   `pinecrest` (Alpine Resort), `goldspire` (Finance District), `foundry` (Factory Town),
   `village` (subsistence) — plus four countries with authored `wealthLevel` 0.85/0.6/0.35/0.25.
   Nobody has to author a trade map. It is sitting in `city/citytemplates.js` and `city/countries.js`.
6. **The 41 Pristine pelts should be a FIELD, not 41 names.** Minecraft, Rust and Bannerlord all
   drew the same line independently: *a name is spent only on new geometry.* Minecraft has already
   run this exact migration — 29 hardcoded potion variants deleted for one item + a field.
7. **But the long tail is not where the damage is.** Rust ships 161 food IDs and **5 medical**, and
   medical is what players actually think about. Our `Medkit` costs $150, declares `medkit: 40`, and
   is read by **nothing in the repo.** Wiring it is three lines and changes every firefight; cutting
   41 pelt names changes nothing a player feels. **Do the small families first.**

---

## 1. WHAT IS ACTUALLY TRUE TODAY (measured, with file:line)

### 1.1 The second census — the ground drop
`city/inventory.js:341-388`. `makePhysicalDrop(payload)`:

```
if (payload.weaponId)  → makeWeapon()   → CBZ.buildActorWeapon  (a real gun)
else if (payload.melee) → makeMelee()   → knife or bat          (a real object)
else if (cash / "Briefcase of Cash" / "Cash Stack" / "Wallet") → makeBriefcase()
else                    → makeBackpack()                        ← EVERYTHING ELSE
```
`makeBackpack` is five boxes. Drop a Patek Philippe, a Polar Bear Pelt, a Tuxedo, a nuclear device
and a burger and the world puts five identical backpacks on the ground. **This is the icon bug with
depth added**, and it is the same fix.

### 1.2 The use switch is three branches
`systems/fpsmode.js:2898-2905` (`useHotbarItem`) is the *complete* set of things an item can do
when you press its number key:
- `tag === "food"` → `CBZ.cityEat` ✔
- `tag === "throwable"` → `CBZ.cityThrowFromInventory` ✔
- `tag === "drug"` → a note saying "Sell this to a dealer — not for using" ✔ (honest)
- anything else → `return false`, silently.

The hotbar chip for every usable item draws `▣` (`city/hud.js:1162`).

### 1.3 Dead fields — declared, never read
| field | declared | readers |
|---|---|---|
| `medkit: 40` on Medkit | `economy.js:131` | **0** (`grep "\.medkit"` → nothing) |
| `dogfeed: true` on Bone / Dog Treat | `dogs.js:274-275` | **0** |
| `pelt` / `pristine` / `meat` | `wildlife.js:114-138` | 1 each, and it is **the icon audit itself** |
| Crowbar | `economy.js:129` | 1 — `shops.js` stock. No use path. |
| Lockpick | `economy.js:128` | shops + the prison bag. **No city use path.** |
| Laptop | `economy.js:102` | **0 references outside the catalog** |
So `Medkit` is a $150 item whose only function is to be resold, and `Body Armor` works — but only
as a **purchase-time effect** at the counter (`shops.js:556` applies `+armor` on buy), never from
the bag.

### 1.4 The arbitrage engine exists, and it is world-blind
`city/economy.js:545-760`. It is genuinely good: per-district demand profiles per drug, a live
price level that **floods down when you sell into it** and lifts when you drain it, mean-reversion,
scarcity, a rolling "hot tip" premium window, a heat risk-premium curve that inverts past 3★, and
turf multipliers (`turfSellMult` 1.22 home / 0.82 rival) so **taking territory is a trade edge**.

Its scope is `districtAt(x,z)` at `economy.js:558-570`:
```
island  = inside the annex circle
uptown  = dx>=0 && dz<0     … four quadrants around CBZ.city.center, unbounded
```
Veridia City sits at ≈(2000, −1200) — it returns `"uptown"`. Mbeya City at ≈(−2200, −1200) returns
`"downtown"`. **Ten authored settlements across four countries collapse into five mainland
quadrants.** The engine is not missing. The map is.

### 1.5 The production map already exists
- `city/countries.js:177-305` — Veridia (wealth .85, `goldspire` capital + `pinecrest` harbour
  town), Kesh (.35, `harvestmarket` capital + 2 `village`), Solara (.6, `capeharbor`),
  Mbeya (.25, `harvestmarket` + 3 `village`).
- `city/citytemplates.js` — every template carries a `subtitle` that IS its economy: Port City ·
  Finance District · Casino Strip · Factory Town · Farm County · Alpine Resort.
- Every settlement is furnished with real shops (`shopKind` census across templates: 8 bar, 4
  hardware, 4 food, 4 bank, 3 pawn, 2 jewelry, 2 clothing, 1 guns, 1 gas, 1 electronics…).
- `sellable(kind)` in `shops.js:487` already lets **pawn buy anything** and every shop buy
  `tag === "valuable"` — which is why pelts and meat already sell anywhere in the world.

**Nothing about "which town produces what" needs authoring.** It is declared, in two files, today.

### 1.6 The carry constraint exists
`city/inventory.js:63-78`: `MAIN_N = 27` slots, and `STACK_BY_TAG` = `{resource:64, drug:32,
ammo:16, food:16, tool:16, valuable:16, wearable:8, weapon:1}`. That is Bannerlord's carry capacity
in Minecraft clothing, already shipping. Chests (`CHEST_N = 27`, `CHEST_COST = 250`) are the
warehouse. Nothing needs building.

### 1.7 The price-discovery surface exists
`sim/market.js` runs six category price levels with a 48-sample hourly ring buffer, is persisted in
both SP and MP, and is **already rendered on the phone** (`city/phone.js:232-240,763-797` — the
MARKETS app, with sparklines). Its own header says the real design is per-jurisdiction and *"P1's
polity registry is expected to shard this by city/country once it lands (grep this file then)."*
The polity registry landed. Nobody grepped the file.

### 1.8 Crafting is off, by the owner's own call
`config.js:754-758`: `CRAFTING_ENABLED = false`, comment reads *"owner's call: crafting is dead."*
`systems/craft.js` has **two** recipes — Hatchet and Pickaxe — the two tools that gather the
resources you craft them from. A closed tautology. `Wood/Stone/Scrap` survive only as
`systems/buildmode.js` placement costs, which is the escape/survival base-building mode, not the city.

### 1.9 The doctrine this repo already wrote for ROLES
`city/roleverbs.js:1-40` is the exact precedent, and its law is the law items need:

> **"an effect must MOVE something the world already reads — cash, hp, maxHp, hunger, an econ item,
> a mission, respect, panic, heat, nameKnown, a relationship. A verb that writes a field nothing
> reads is a stat fiction."**

And its seam: `ROLE_VERBS` is one table keyed on strings the world already owns; **adding a trade is
a ROW, never a registration.** The item answer is the same shape and should be built the same way.
The cut precedent is `city/wealth.js:344-356`'s NO-FICTION NOTE — seven fake luxury "assets"
deleted with the reasoning left in the file. That is how a cut ships here.

---

## 2. THE THREE GAMES — what an item is FOR

*Researched this session. Sources at the foot of §2. The three findings that should change our
plan are marked ★.*

### 2.1 Minecraft — ~1,000+ IDs, ~40 carry the attention, and the icon pipeline explains why
The ID count is inflated almost entirely by **palette multiplication**: 16 dye colours ×
wool/concrete/terracotta/glass/beds/banners/candles/shulkers, and a full wood set (~18-20 IDs)
× ~10 wood types ≈ **180-200 IDs from wood alone.** Meanwhile the whole progression surface (6 tool
tiers × 5 tools, plus armour) is ~30 items.

★ **THE FINDING THAT MATTERS MOST TO US — Minecraft's icons are bifurcated, and the split predicts
which families were allowed to grow.** Block-form items are **derived**: the block's own 3D model is
rendered through a `display.gui` transform (rotation `[30, 225]`, 0.625 scale, orthographic,
per-face shading) — the icon *is* the geometry, so a model change updates it free. Non-block items
(tools, ingots, food, dyes) are **hand-painted flat 16×16 PNGs**. Net effect, stated by the
researcher and it is the whole design law:

> *"The item classes that are cheap to multiply (blocks) are exactly the ones with free icons; the
> classes that need authored art are exactly the ones that stayed numerically small."*

**Read that against our catalog and the plan validates itself.** Our two biggest families —
apparel (66) and wildlife goods (99) — are exactly the two with a derivable subject already
shipping (`buildHungGarment`/`drawSample`, and every species' `build()`). Our families that need
hand-drawing (food 9, tools 9, ordnance 6, drugs 4, materials 3) are exactly the small ones. **We
have accidentally already obeyed Minecraft's law. The 250 generic icons are a plumbing failure, not
a content failure.**

Minecraft also runs **four** answers to the variant question simultaneously: separate IDs for dye
colours (the mesh genuinely repaints), one item + a component field (leather colour, potion
contents), one item + a *map* of modifiers (enchantments — a sword carries Sharpness + Knockback +
Fire Aspect with zero new IDs), and a purely derived display tier (`Rarity` Common→Epic, tooltip
colour only, "no effect on gameplay whatsoever").

★ **And it has already run our exact migration.** Beta 1.9's cauldron brewing had **29 hardcoded,
separately-coloured potion variants**; when brewing stands shipped, **all 29 were deleted** in
favour of one `potion` item + effect data. A live N-IDs → one-item-plus-a-field conversion, by the
people who invented the inventory grammar we copied. It is the Pristine-pelt decision, already made.

*Their own noise complaint:* late single-purpose items (echo shards, goat horns) — *"adding way too
many single-use items… which just end up cluttering chests without adding interconnected
mechanics."* Golden tools and poisonous potatoes are the standing jokes: high on one stat, crippled
on another, with **no niche that makes the trade-off matter**. That is the sharpest available
definition of inventory noise, and it is exactly what a Crowbar with no verb is.

### 2.2 Rust — condition is a float, and 5 items can outweigh 161
Measured ID counts: Food **161**, Attire **124**, Electrical 80, Weapons 77, Components 52,
Construction 50, Ammo 39, Resources 36, Tools 30, Traps 9, **Medical 5.**

★ **ID count and player attention are DECOUPLED, not inversely correlated.** Food + Attire are ~30%
of all IDs and are mostly reskins that change no decision. **Medical is 5 IDs and is a constant live
PvP concern.** For us that reframes the whole cut question: *our Medkit doing nothing is a bigger
loss than all 41 Pristine pelts combined.* Cutting the long tail is housekeeping; a dead item in a
5-item family is a hole in the game.

**Condition is a float** (current HP / max HP), stored per stack instance. No "Rusty/Fine" naming
tier exists anywhere in Rust. **One honest caveat for our merge:** items at different condition
**do not stack**, so a float costs inventory slots the way named variants would. It saves item IDs,
icons and audit rows — not slots. Repair costs resources at a workbench proportional to the missing
fraction; it is never free.

**Facepunch's own postmortem (Devblog 134) is the best first-party material found in this whole
research pass.** Why the XP+blueprint system felt bad: it made players focus *"solely on how to
level up as quickly as you can,"* made every new item *"a never ending balance nightmare,"* and
*"eliminated Rust's unique emergent gameplay where players would adapt to whatever equipment they
found."* The fix — components: uncraftable-but-findable multi-use ingredients that force a live
trade-off (*"better axe versus sword, crossbow versus ladder hatch"*).

> **The operational definition of meaningful, from a shipping team: random ACCESS to an item class
> reads as noise; a shared ingredient whose every acquisition is a live decision reads as
> meaningful.**

Our `rollValuables` passes that test — the acquisition *is* a decision, because it is *who you
choose to rob*. Our 41 Pristine pelts fail it: the quality is a 15% dice roll on a kill you already
made.

*Cut history worth respecting:* Rust rewrote this subsystem **three times** — Devblog 72 (fragments
→ tiered pages/books, to kill *"hoping the 1-in-250 barrels is the AK47 you want"*), Devblog 134
(delete blueprints entirely), then Blueprints 3.0 (**partially reintroduce them**, because *"the
current progression meta has grown stale, moving too fast and becoming too easy"*). **Cut, then
un-cut, for the opposite reason.** That is a caution about deleting fast, and an argument for the
owner's instinct: *don't delete yet.*

### 2.3 Bannerlord — ~30 goods, an AUTHORED production map, and a warning
~30-33 core trade-good IDs, split RAW (grain, fish, olives, grapes, dates, salt, clay, cotton, flax,
wool, iron ore, silver ore, **fur**, **hides**, hardwood, butter, cheese, **meat**, spice) →
REFINED (beer, wine, oil, linen, velvet, leather, pottery, tools, jewelry).

★ **Production is AUTHORED, not simulated.** Each village carries a hand-set
`village_type="VillageType.fisherman"` field in `settlements.xml` and produces that good by design
fiat. There is no soil/climate layer under it. Villages are then *bound* to a market town. Modifiers
on top: +10% if bound to a castle, +25% Khuzait horses/cattle (culture), +20% from governor perks.

**This is our `baseTemplate`, exactly.** A per-settlement authored tag, plus a live local price
factor. We already have both halves.

**Price:** `finalPrice = baseValue × categoryFactor × merchantModifiers`, where `categoryFactor` is
tracked **per ItemCategory per settlement**, moves on local buy/sell volume, and **mean-reverts to
1.0** — which is `city/economy.js:640-700` line for line. Food demand carries a prosperity term with
a hard **luxury threshold at prosperity 3000**: past it a town develops appetite for an extra tier
of goods. Consumption spends a per-good budget that shrinks as price rises, so it self-throttles.

**Measured spread across ~26 goods** (community min/max tracking): min **2.3×** (Grapes), max
**8.8×** (Butter), **median 4.1×, mean 4.6×**. Iron Ore 5.7×, Linen 7.7×, Wine 6.0×, Salt 3.4×.

**Our engine is already in that band.** `DISTRICTS[dk].demand` spans 0.7→1.7 (2.4×), `tier` spans
0.78→1.30 (1.67×), `turfSellMult` spans 0.82→1.22 (1.49×) — and the live `lv` level floats on top.
Combined worst-to-best is ~4×, i.e. Bannerlord's median. **We did not under-tune it. We under-scoped
it.**

*Loops:* caravans cost **~15,000 denars** + a companion + ~29 guards, ramp from **−150/day** to
**+400-1000/day** over a month, and cost the full 15k again when captured. Workshops
**12,000-15,000** with **100-200 day** breakeven, ~11 fixed single-input→single-output chains, and
no workshop is universally good — profitability is entirely *"does this specific town have cheap
input and local demand for the output."*

★ **THE WARNING, and it is the most useful thing in this whole section.** Bannerlord's trade-goods
class is **mechanically complete and players report not valuing it**. Caravan trading is called
*"comically bad"* — margins killed by wage/food overhead; running a caravan grants trade XP to the
**companion, not the player**. And *"trade is a spreadsheet"* is literal: the most-used community
trading guide points players at an **external Google Sheet** of observed min/max prices per town,
because the in-game UI won't show it. The game hides distant prices for tension, but **the
production map is static and small enough to be documented once, community-wide**, after which
discovery collapses into a lookup.

**Bannerlord's icons are fully derived from the mesh, for every class** — the item XML exposes a
`mesh` attribute and no 2D icon field at all. That is the target state for us, and it is what
`weapon_thumbnails.js` already does for 13 items.

### 2.4 The cross-game synthesis — the line all three drew in the same place
> **Separate IDs are spent only where the variant is VISUALLY distinct** (Minecraft's 16 dyes
> genuinely repaint the mesh; Bannerlord's forged weapons genuinely reassemble geometry from parts).
> **Anything purely scalar** (Rust condition, Minecraft durability) **or a small curated set of
> named tiers with no new geometry** (Bannerlord's Rusty→Legendary, Minecraft's Common→Epic) **is a
> FIELD or a derived display value — never a new ID.**
>
> **And icon economics track the identical line**: every class whose icon is derived from a mesh
> scales to unlimited variants for free; every class that depends on hand-authored art stays
> numerically small, because each new ID carries a fixed authoring cost.

A `Pristine Wolf Pelt` is a small named tier with **no new geometry**. Three games, independently,
say it is a field.

### 2.5 The four meaningfulness tests, and our score
1. **It has a verb, or a counterparty who specifically wants it.**
2. **It is recognisable at a glance** — its icon is its object.
3. **Carrying it costs something**, so taking it is a decision.
4. **Its value is not flat** — worth more somewhere, to someone, or in some condition.

We pass (3) universally (27 slots + stack caps). We pass (2) for **13 of 284**. We pass (1) for
maybe 30. We pass (4) for **4** — the drugs. *That last number is the actual state of the economy.*

**Sources.** Minecraft Wiki (Data component format · Rarity · Item · removed items · Combat Tests) ·
Rust Devblog 72 · Rust Devblog 134 · Rustafied "Blueprints 3.0" · DeepWiki Bannerlord 1.3.2
decompile (economic system) · BannerlordModding.LT items docs · Bannerlord settlement modding docs ·
Steam guides #3123425890 / #2044831149 / #2052391201 · PCGamesN caravans · SegmentNext workshops ·
EVE University wiki (Trading).

---

## 3. THE EXISTENCE TEST — the doctrine, three laws

**LAW 1 — AN ITEM MUST MOVE SOMETHING THE WORLD ALREADY READS.**
Straight from `roleverbs.js`, unchanged. Cash · hp · hunger · an econ item · a mission · respect ·
heat · drip · a relationship · a price level. `medkit: 40` moves nothing. `dogfeed: true` moves
nothing. Those are not items; they are strings with a price.

**LAW 2 — AN ITEM'S ICON IS A RENDER OF ITS OWN PHYSICAL ASSET.**
The gun path is the whole pattern and it is 63 lines (`city/weapon_thumbnails.js`): one lazy
offscreen renderer, `CBZ.buildActorWeapon(id)`, an orthographic camera framed on the model's own
bounding box, `toDataURL` once per id, cached. **Never a glyph, never a letter, never a second
renderer.** The corollary is the existence test: *if an item cannot produce an icon from an asset,
it has no asset, and an item with no asset and no verb should not be in the game.*

**LAW 3 — A NAME IS SPENT ONLY ON NEW GEOMETRY. EVERYTHING ELSE IS A FIELD.**
This is the cross-game synthesis (§2.4) stated as our law. Minecraft spends 16 IDs on dye colours
because the mesh genuinely repaints, and spends **zero** on enchantments, durability or rarity.
Bannerlord spends IDs on forged weapons because the geometry really is reassembled from parts, and
**zero** on Rusty→Legendary. `Pristine Wolf Pelt` is the same mesh with a bigger number, so it is
`Wolf Pelt` with `q: 2` — and the field then generalises to every future gradeable thing (a damaged
watch, a hot vs. clean valuable, a fresh vs. day-old catch, which is what makes a perishable trade
good tense) for free.

---

## 4. THE DECISION TABLE

Verdicts: **① KEEP-CORE** (asset + loop both exist) · **② KEEP-BUT-WIRE** (asset exists, loop
missing — name the ONE mechanic) · **③ NO-ASSET-NO-ITEM** (cut candidate, listed not deleted) ·
**④ MERGE** (collapse to one name + a field).

| # | family | n | verdict | why | what it needs |
|---|---|---|---|---|---|
| 1 | **guns** | 13 | **①** | real mesh, real verb, real icon. The reference implementation. | nothing |
| 2 | **melee** (Bat, Knife) | 2 | **①** | `makeMelee()` already builds both as ground props; both equip through `cityGiveWeapon`. | route `makeMelee` into the thumbnail renderer — **zero new drawing** |
| 3 | **ordnance** (Grenade, C4, Ammo Box, AGM, Bunker Buster, Nuclear Device) | 6 | **①** | every one detonates or reloads something real. `blastAudit().handRolled` is pinned at 0. | 5 mini-models (Grenade may already exist in `buildActorWeapon`) |
| 4 | **drugs** | 4 | **①** | the ONLY family with all four meaningfulness tests. The whole regional market runs on them. | 1 model, tinted 4 ways (baggie/brick/crystal/pills is 4 shapes if you want them) |
| 5 | **food** | 9 | **①** *(low stakes)* | `cityEat` is real, hunger is real — but the city has a **mercy floor** (`hunger.js:33-40`, starvation cannot kill you here). So food is a nudge, not a pressure. | 5 models covers 9 items (burger · hotdog · pizza slice · cup · carton); `Fresh Produce`/`Fresh Cut` reuse a crate/steak |
| 6 | **composable clothing** | 66 | **①** | the wardrobe genuinely dresses the rig (`cityApplyComposite`), drip gates the club, the store racks already draw them. Real asset, real loop, real status. | icon path exists — see §6. **No new item design.** |
| 7 | **jewelry (composable)** | 8 | **①** | `bling.js` seats real meshes on the body and NPCs wear what they carry. | render `bling.js` LOOKS — **zero new drawing** |
| 8 | **valuables — the ice** (Omega · AP · Patek · Richard Mille · Tennis Bracelet · Diamond Necklace · Tiara · Engagement Ring · Designer Bag) | 9 | **①** | `rollValuables` (economy.js:848) is one of the best systems in the repo — the mob wife carries a $5M rock *because her husband is loaded*, and `bling.js` renders it on her. Killing the right person is the loop. | 3-4 models (`bling.js` covers watch/chain/ring; necklace/tiara/bracelet/bag need drawing) |
| 9 | **valuables — the tiers** (Wallet · Phone · Laptop · Cash Stack · Gold Bar · Briefcase of Cash · Bearer Bonds · Art Piece) | 8 | **②** | a clean Rust-style loot ladder with a fence that has REP (`fenceBonus`, capped 0.18). But `Laptop` has **zero references in the whole repo** and `sellAll` is one button with no per-item price. | ONE mechanic: **the fence pays by KIND and by PLACE.** An Art Piece should fence best at a jeweller in Goldspire and worst at a village pawn. That is one line in `sellPrice(name, kind)` — it already takes `kind`. |
| 10 | **pelts** | 44 | **②** | the best-supported family in the game and nobody has noticed: every species carries `build: function(ctx)` — **a complete mesh factory** — plus `color`, `furValue`, `rarity`. The hunt yields them, the fence buys them. | ONE mechanic: **pelts are the first regional trade good** (see §7). Icon: render the species. |
| 11 | **Pristine pelts** | 41 | **④** | 41 item names that differ from their base by a 2.1× multiplier and the word "Pristine". This is exactly what Bannerlord solved with modifiers. | collapse to `{name, q}`; one icon per species with a quality frame; `sellPrice` reads `q`. **−41 names, −41 icons, −0 gameplay.** |
| 12 | **meat & fish** | 13 | **②** | 13 names, tagged `valuable`, that do nothing but sell. `Fresh Fish` is the exception — `fishing.js` catches it and a fisherman buys it at 1.3×. | ONE mechanic: **meat is perishable regional produce.** Same trade-good lane as pelts; `Fresh Fish` already proves the counterparty. Consider merging the 13 into ~4 (Game Meat · Red Meat · Fish · Exotic) with a species field, same as the pelts. |
| 13 | **legacy wearables** | 27 | **② / ④** | these are the pre-composable wardrobe. Many are literally the same garment as a composable under a different name (Hoodie/`hoodie`, Tracksuit/`tracksuit`, Bomber Jacket/`jacket_bomber`, Gold Chain/`chain_gold`, Diamond Ring/`ring_diamond`, Rolex+Iced Watch/`watch_*`). | **MERGE the duplicates into their composable twin** (~15 of 27 vanish with no loss). The genuine gaps — hats (Snapback, Beanie, Fedora), shoes (Sneakers, Jordans, Loafers, Dress Shoes), glasses (Sunglasses, Designer Shades) — have **no composable and no mesh**: they are ②, and need ~6 new slot models. |
| 14 | **tools** | 9 | **③ mostly — but see the note** | Crowbar: 1 reference, no use. Lockpick: no city use path. Medkit: `medkit:40` read by nobody. Burner Phone: referenced but no city verb. Bone/Dog Treat: `dogfeed` read by nobody. Body Armor: works, but at the counter, not from the bag. Hatchet/Pickaxe: gate the OFF crafting system. | **CUT CANDIDATES: Crowbar, Bone, Dog Treat** unless a verb is chosen (`Laptop` is the same disease one family up, row 9). **Lockpick and Burner Phone are ② not ③** — a lockpick that opens a parked car and a burner that drops one wanted star are one-line verbs with obvious fiction. Body Armor: move the effect to the bag (3 lines; the field exists). **MEDKIT IS ② AND IS THE HIGHEST-PRIORITY ITEM IN THIS WHOLE DOCUMENT — see below.** |
| 15 | **materials** (Wood, Stone, Scrap) | 3 | **③** | they exist to feed a system the owner turned off. Their only live consumer is base-building in the *escape* mode. | keep as-is and out of the city catalog, or cut from `city/economy.js` and leave them in `systems/economy.js`. **Do not draw icons for them until crafting comes back.** |
| 16 | **prison/escape stash** | 34 | **③ / ①** split | This is a **different game** (cigarettes are the currency). Real loops: Shiv (6 files, combat), Ramen/Energy Bar/Painkillers/Pruno/Pills/Powder (consumables, `systems/inventory.js:151-171`), the 6 FENCEABLEs, Gun + Gun-Room Key. **Genuinely dead: Handcuff Key · Bedsheet Rope · Hacksaw Blade · Contraband Map · Tattoo Gun · Burner SIM · Phone Charger · Razor Blade · Soap** — each appears in exactly one place, the emptied ICON table. | 9 cut candidates. The rest need ~12 icons and 0 new mechanics. **This surface should be decided separately from the city** — do not let it drag the city census. |
| 17 | **Chest** | 1 | **①** | placeable storage, `CHEST_COST = 250`, real mesh. | 1 icon |

### ★ THE MEDKIT PARAGRAPH — why the small families matter more than the long tail
Rust ships **161 food IDs, 124 attire IDs — and 5 medical IDs**, and medical supply is a constant
live PvP concern while most of the food and attire changes no decision. **ID count and player
attention are decoupled.** We have a `Medkit` that costs $150, carries a `medkit: 40` field, sits in
the hardware shop's tool bag, and **is read by nothing in the entire repo.** The only way to heal in
this game outside a hospital is to walk up to a doctor (`roleverbs.js` ROW_MEDIC) — which is a lovely
system and does not help you bleeding out in an alley at 3 a.m.

Cutting 41 Pristine pelts changes nothing a player feels. **Wiring the Medkit changes every firefight
in the game.** If this document produces exactly one code change, it should be that one — and it is
three lines, because `cityEat`'s shape already exists and `sellPrice` already knows the item.

**Rollup.** Of 284:
- **① KEEP-CORE, needs only an icon:** ~120 (guns 13 · melee 2 · ordnance 6 · drugs 4 · food 9 ·
  clothing 66 · jewelry 8 · ice 9 · chest 1 · prison-live ~12)
- **② KEEP-BUT-WIRE, one named mechanic each:** ~73 (loot tiers 8 · pelts 44 · meat 13 · wardrobe
  gaps ~6 · **Medkit · Body Armor · Lockpick · Burner Phone**)
- **③ CUT CANDIDATES (listed, not deleted):** ~18 (Crowbar · Laptop · Bone · Dog Treat · materials 3
  · prison-dead 9 · Hatchet/Pickaxe while crafting is off)
- **④ MERGE:** ~56 names removed (41 pristine · ~15 legacy-wearable duplicates), possibly +9 more
  if meat collapses to 4.

**Net: the catalog goes from 284 names to roughly 210 that each earn their row — and the number of
things you have to DRAW is ~55, not 284.**

---

## 5. THE MERGE QUESTION, answered directly

The owner asked it as a question; the answer is not close.

**41 Pristine pelt names buy exactly one thing: a 2.1× price and the word "Pristine".** They cost 41
catalog rows, 41 icons, 41 `sellPrice` entries and 41 lines in every audit, forever.

**All three reference games converged on a field, independently**, and the synthesis rule from §2.4
is decisive: *separate IDs are spent only where the variant is visually distinct.* A Pristine Wolf
Pelt has **no new geometry**. Bannerlord ships this as a modifier on one ID (Rusty→Legendary,
templated display name, same mesh throughout); Rust ships it as a condition float; Minecraft ships
it as a data component — **and Minecraft has already run our exact migration**: 29 hardcoded potion
variants deleted wholesale, replaced by one `potion` item + effect data, the moment brewing stands
made the field possible.

`wildlife.js:1306` already computes it as a boolean (`a.cleanKill && Math.random() < 0.85`) and then
**throws the boolean away by concatenating a string**. Keeping the boolean is strictly less code
than building the string.

**The honest caveat, from Rust:** items at different quality **will not stack**, so the field saves
item IDs, icons, catalog rows and audit lines — **it does not save inventory slots.** Anyone selling
this as "frees up your bag" is wrong. The case is entirely about catalog weight and the field's
downstream reuse.

**The second honest caveat, from Rust's blueprint saga:** they cut this subsystem, then partially
un-cut it, for the opposite reason. A field is reversible (you can always re-expand names from a
field); forty-one deleted names are not. That asymmetry argues for the merge too.

**The field generalises immediately and that is the real payoff:** a quality/condition field on the
item entry gives you, for free — a damaged luxury watch that fences low, a fresh vs. day-old catch
(which is what makes a perishable trade good tense), a "clean" vs. "hot" valuable the fence prices
differently, and Bannerlord's whole weapon-modifier grammar the day you want it. **One field, four
future systems.** Forty-one names buy none of them.

**Same argument, weaker but still valid, for the 13 meats** → `Game Meat · Red Meat · Fish ·
Exotic` + a species field, since the species is already on the record.

---

## 6. THE ICON LAW — and an honest count of what must actually be drawn

**THE LAW.** *An icon is an orthographic render of the item's own world asset, produced by the
subject the game already builds, cached as one data URL per item. If no subject exists, the icon
cannot be produced — and that is the existence test firing, not a drawing task.*

This is **exactly Bannerlord's pipeline** (the item XML carries a `mesh` attribute and *no 2D icon
field at all*) and exactly Minecraft's block-item pipeline (`display.gui`: rotation `[30, 225]`,
0.625 scale, orthographic — the icon *is* the geometry). `weapon_thumbnails.js` already does it for
13 items in 63 lines. Nothing here is novel; it is a migration.

**And §2.1's law says the shape of the work is already right:** the families that grew large are
exactly the ones with a derivable subject. Below, that shows up as two families of 66 and 99 costing
**zero to one** new drawings between them, and every hand-drawn family being small by construction.
Generalising `weapon_thumbnails.js` means **authoring SUBJECTS, never a second renderer.** Here is
where each family's subject already lives, counted honestly:

| family | n | subject that exists TODAY | new drawing |
|---|---|---|---|
| guns | 13 | `CBZ.buildActorWeapon` | **0** |
| melee | 2 | `inventory.js makeMelee()` | **0** |
| jewelry | 8 | `bling.js` LOOKS (`chainGold`, `watchIced`, `ring`…) | **0** — except a real grill mesh (bling.js admits it falls back to the ring glint) |
| composable apparel | 66 | **`clothingstore.js buildHungGarment(host, slot, hex)` + `drawSample(host, visualId)`** — a wire hanger with trousers folded / a tie draped / sleeves on a jacket, in front of the composable's own `draw()`. This is *already a mannequin frame* and it already ships. | **0 for the 28 shape-differentiated garments** (8 collars via `mkCollar`, 7 blazers via `mkBlazer`, 8 ties via `mkTie`, + white tee, bow tie, white trousers, bomber, tuxedo) |
| composable apparel — the painted looks | 42 | **the honest problem.** `paintedLook()` (`clothes.js:1836-1846`) gives all 22 suits + 20 streetwear/service/dress looks the SAME rack sample: `piece(group, 0.9, 0.9, 0.6, …, c)` — one tinted box, optionally with a white shirt-V. Render those and you get **42 near-identical coloured squares.** Their real appearance is a **texture painted onto a body**. | **0 new meshes, but a second render path:** `CBZ.makeCharacter()` once → `cityApplyComposite(ch, {items:[visualId]})` → render the torso crop. One cached mannequin, one render per garment. That is ~40 lines, not 42 drawings. |
| legacy wearables | 27 | ~15 map to a composable twin; hats/shoes/glasses do not | **~6** (cap · beanie · brimmed hat · sneaker · dress shoe · sunglasses) |
| pelts | 44 | **`sp.build(ctx)` — every species is a complete mesh factory** (`wildlife/bears.js` etc.), plus `sp.color` | **0** if a pelt icon is the animal; **1** if you want a stretched-hide silhouette tinted by `sp.color` (I'd do the hide — it reads as *cargo*, which is what it will be) |
| pristine pelts | 41 | same as base + a quality frame | **0** (and after the merge, they aren't items) |
| meat & fish | 13 | none | **3-4** (a red cut · a poultry cut · a fish · a fillet) |
| valuables — ice | 9 | `bling.js` covers watch/chain/ring | **4** (necklace · bracelet · tiara · handbag) |
| valuables — tiers | 8 | `makeBriefcase()` covers cash/wallet/briefcase | **5** (phone · laptop · gold bar · bond bundle · framed canvas) |
| food | 9 | none | **5** (burger · hotdog · pizza slice · cup · fries carton) — soda/energy drink share the cup, produce/cut share a crate |
| ordnance | 6 | grenade may exist in `buildActorWeapon` | **5** (ammo box · missile crate · C4 brick · bunker buster · warhead case) |
| tools | 9 | none | **0-4** — *only for the ones that survive §4* |
| drugs | 4 | none | **1-4** (one baggie tinted 4 ways, or four honest shapes) |
| materials | 3 | none | **0** — do not draw for a disabled system |
| prison stash | 34 | none | **~12** for the ones with loops |

**HONEST TOTAL: ~40-45 new mini-models, plus one mannequin render path.** Not 284, not 250, and not
the "50 drawings" the owner was resisting — because the two biggest families (200 of the 250) are
**derived**, and because merging removes 56 names before anything is drawn.

**And every one of those ~45 models pays twice**, because `makePhysicalDrop` is waiting for exactly
the same subject. Draw a gold bar once; it is the bag icon *and* the thing lying on the pavement.

**One warning worth writing down:** the offscreen renderer is real WebGL. 284 `toDataURL` calls at
boot would stall. `weapon_thumbnails.js` is **lazy and cached per id** and must stay that way — icons
mint on first display, which for most of the catalog is never.

---

## 7. THE BANNERLORD BRIDGE — the minimal trade-good loop

**The thesis: we do not need a trade system. We need to point the one we have at the map we have.**

### The simulation ladder — how much is actually load-bearing
The research produced a clean four-tier answer to "what is the minimum," and **we are already at
Tier 1 with Tier 0's scope missing**, which is a very unusual place to be:

| tier | what it is | who does it | us |
|---|---|---|---|
| **0** | a static per-place production tag + a **hard carry cap** | **Bannerlord itself** (`village_type` is an authored tag, not a simulation), Patrician/Port Royale | **cap: DONE** (27 slots + stack caps). **tag: DONE but unread** (`baseTemplate`) |
| **1** | your own buy/sell nudges the local price a few % per unit, decaying back | Bannerlord's `categoryFactor`, Patrician's stock bar | **DONE, for drugs only** (`recordSale`/`recordBuy` + mean reversion, `economy.js:640-700`) |
| **2** | information asymmetry — you don't know a distant price until you go, or pay to learn | Bannerlord's Trade perks, EVE's opacity | **the phone MARKETS app is the surface; it shows one global number** |
| **3** | full production/consumption sim with competing AI traders | X4, EVE | **do not build. Not what makes the loop feel good.** |

The researcher's verdict, and it is the whole cost argument: *"Bannerlord proves a Tier-0/1 hybrid
is sufficient for that feeling. What Tier 3 buys is emergent narrative texture… valuable for a
persistent multiplayer economy, not necessary for a single good 'buy here sell there' fantasy."*

**Why the carry cap is the load-bearing piece and not the prices:** without a cap the player finds
the single best margin and repeats it infinitely. The cap forces a *portfolio* decision — spread
across goods or concentrate — and forces repeated trips. That is the loop. We already have the cap
and have never had anything worth putting in it.

### What exists (all of it, today)
| Bannerlord needs | we have | file |
|---|---|---|
| goods with a base value | 284 tagged items with `value` | `economy.js:18` |
| a production map | `baseTemplate` per settlement + `wealthLevel` per country | `citytemplates.js`, `countries.js` |
| regional price levels | per-district level, mean-reverting, flood/scarcity | `economy.js:640-700` |
| demand profiles | `DISTRICTS[dk].demand` per good | `economy.js:534-540` |
| buy surfaces | `SHOP_STOCK` × 26 shop kinds, in every settlement | `economy.js:286`, `citytemplates.js` |
| sell surfaces | `sellPrice(name, kind)` + `sellAll` + fence rep | `shops.js:487-527` |
| carry capacity | 27 slots + per-tag stack caps | `inventory.js:63-78` |
| a warehouse | placeable chests | `inventory.js` |
| price discovery UI | the phone MARKETS app + sparklines | `phone.js:232-240` |
| travel | driving now; **the airport network in GAMEPLAN waves A1-A3** | `airfield.js` (planned) |
| a persistence layer | market serialize/apply in both SP and MP | `sim/market.js` |

### What is missing — and it is genuinely three things
1. **`districtAt(x,z)` must answer a SETTLEMENT, not a mainland quadrant.** `CBZ.city.regions`
   already contains every settlement rect, `polity.js` already resolves a point to a city/state/
   country. This is a lookup, not a system. **The single highest-leverage change in this whole
   document.**
2. **A `trade` tag, and about 12-15 goods wearing it.** Not new items — a tag on items that already
   exist: `Wool · Cowhide · Hides · Pork · Beef · Game Meat · Fresh Produce · Fresh Fish · Fish
   Fillet · Wood · Stone · Scrap`, plus the pelts. **Bannerlord runs a far bigger world on ~30, and
   its own raw list is startlingly close to ours — grain, fish, wool, FUR, HIDES, MEAT, hardwood,
   clay.** We already produce most of a Bannerlord goods list; we just call them loot. Anything with
   the tag gets the drug engine's arbitrage for free.
3. **A per-settlement demand profile, DERIVED not authored.** `baseTemplate` → the profile:
   `harvestmarket` produces produce/meat cheap and pays dear for manufactured goods; `capeharbor`
   produces fish and pays for inland goods; `pinecrest` produces wood/pelts and pays for food;
   `goldspire` pays top price for everything and produces nothing but luxury demand; `foundry`
   consumes materials and produces tools; `village` produces raw and cannot afford anything.
   **Six rows keyed on a string the world already carries** — which is structurally identical to
   Bannerlord's `village_type` tag, and it is already written. Country `wealthLevel` multiplies the
   whole town's price tier — Veridia .85 pays, Mbeya .25 doesn't. That is Bannerlord's prosperity
   term, and its **luxury-demand threshold** (a rich town develops appetite for a whole extra tier)
   is one comparison against `wealthLevel`, not a simulation.

**Target spread: 3-5×, ~4× median.** That is Bannerlord's measured band (min 2.3×, max 8.8×,
median 4.1×) and — measured above — it is *already* what our multipliers produce when they are
allowed to differ. **Do not tune. Scope.**

### The loop that results, with no new UI
> A hunter in Pinecrest fills nine slots with Wolf Pelts. Goldspire pays ~1.6× for fur (finance
> district, luxury demand past the wealth threshold); Kolo Village pays ~0.4× (nobody there can
> afford a pelt). Round trip ≈ 4×, i.e. exactly Bannerlord's median good. It is a long drive or a
> $2,400 flight. **Selling nine pelts into Goldspire floods the level** — the tenth pays less than
> the first, so you cannot farm one route. That is Tier 1, it is the specific property that stops a
> trade economy degenerating into a button, and **we already wrote it for drugs.** The phone MARKETS
> app shows where the spread is; the 27 slots decide how much of it you can take; the rolling hot
> tip means the answer changes.

### Cost, honestly
- `districtAt` → settlement resolution: **small** (a rect lookup against `city.regions` + a fallback
  to the existing quadrants for the mainland). Half a day.
- `trade` tag + 6 demand-profile rows: **small.** A table.
- Extending `wholesalePrice`/`streetPrice`'s shape from `DRUGS[]` to `tradeGoods[]`: **medium** —
  the functions are drug-specific by name today, but the arithmetic is generic. A day.
- Phone MARKETS app shard: **small** — `CBZ.market.rows()` already exists; it needs a settlement
  argument.
- **The airport network (GAMEPLAN A1/A2/A3) is what makes the loop feel big**, and it is already
  planned and scheduled. Trade is the *reason* it should ship.

**Total: this is a wave, not a project.** And every part of it is a MIGRATION of code we already
run, which is exactly what CLAUDE.md's block law demands.

### ★ THE WARNING — copy Bannerlord's structure, not its outcome
Bannerlord's trade-goods class is **mechanically complete and its own players do not value it.** The
three named failure modes, and what protects us from each:

| their failure | why | our protection — and it already exists |
|---|---|---|
| *"Trade is a spreadsheet"* — the top community guide points players at an **external Google Sheet** of per-town min/max prices | the production map is **static** and small enough to document once, community-wide; after that, discovery is a lookup | **our prices are not static.** `g.cityDrugTip` is a rolling hot-tip premium window; the heat curve inverts past 3★; `turfSellMult` moves when territory changes hands. **A route that pays today may not pay next week — that is the one thing Bannerlord's economy cannot do**, and we already built it. Protect it deliberately: never let a trade good's price be fully derivable from a static table. |
| caravans *"comically bad"* — margins killed by wage/food overhead, and the trade XP goes to the **companion, not the player** | passive income competing with the active loop, badly tuned, with a reward that misses the person playing | **ship no caravans.** Not in the first wave, possibly never. The manual run is the game. |
| the trade skill grind is *"the worst way to play the game"* | XP-per-transaction falls off hard; the loop pays in a number | **do not add a trade skill.** Our rank doctrine already says it: *a rank is a verb, or it is nothing.* If trading unlocks anything it should unlock a **verb** (a fence who'll move hot goods, an airfield slot, a warehouse), never a multiplier. |

### What we should NOT build
- **No caravans.** See above. Their commonest complaint, and the thing that makes the active loop
  pointless.
- **No workshops.** They need refined goods, which need a production chain, which is crafting by
  another name — and crafting is off by owner's call.
- **No prosperity simulation.** `wealthLevel` is a static number per country and that is enough;
  Bannerlord's prosperity sim is largely invisible to the player (its one visible feature is the
  luxury-demand threshold, which we can get with one comparison against `wealthLevel`).
- **No consumption drain.** Tier-3-adjacent. It makes shortages feel real; it is not needed for the
  core loop and should wait until Tier 0/1 demonstrably works.
- **No second inventory, no cargo hold, no trade UI.** 27 slots and the phone.

---

## 8. HOW BIGGER CITIES CHANGE THE ANSWER

The owner's scale plan (10× buildings, taller towers, parking lots, parks) does not change which
items matter — **it changes how far apart the markets are, and that is the whole game.**

- **Distance is the trade constraint.** Bigger cities + more settlements + the airport network turns
  "which district pays more" from a 200 m walk into a real journey. The existing drug arbitrage is
  currently trivialised by the map being small; scale *fixes* it.
- **Parking lots and parks are not item content, and that is fine.** They are where the ground-drop
  system becomes visible — a duffel of pelts in a parking lot reads completely differently from a
  backpack.
- **Taller buildings raise the value of the loot ladder**, because `roofloot.js` already stashes
  duffels and crates on roofs and `occupy.js` already runs a floor ladder. More storeys = more
  ladder = more reason for the 8 loot tiers to be distinct objects.
- **The one scale risk to items:** more settlements means more shops means more `sellAll` buttons.
  If a shop's price is flat, scale makes the world *feel* flatter, not bigger. **Regional prices are
  what convert map size into economy size** — without them, 10 cities is 10 identical vending
  machines.

---

## 9. THE FIVE QUESTIONS FOR YOU

1. **Do we merge Pristine into a quality FIELD?** My recommendation is yes and it is not close —
   it removes 41 names, 41 icons and 41 audit rows, and buys a field that four future systems want.
   The only argument against is that "Pristine Wolf Pelt" reads nicely in the killfeed, and that is
   a display concern, solvable in the display.

2. **Which of the ~18 cut candidates actually go — and do we cut at all yet?** The list is *Crowbar ·
   Laptop · Bone · Dog Treat · Wood/Stone/Scrap (city catalog only) · Handcuff Key · Bedsheet Rope ·
   Hacksaw Blade · Contraband Map · Tattoo Gun · Burner SIM · Phone Charger · Razor Blade · Soap*.
   Each is a verb we write or a row we delete. **Rust cut its blueprint system, then un-cut it, for
   the opposite reason** — so the owner's "don't delete yet" is the right instinct and the cheapest
   move is to leave the rows and simply refuse to draw icons for them (an item with no icon and no
   verb is already effectively cut, and reversible). **Medkit is off this list** and is the highest-
   value ② in the document: give it a verb (heal from the bag, the `medkit: 40` field is already
   there). Body Armor should follow it out of the counter and into the bag.

3. **Is `districtAt` → settlement the next wave?** It is one lookup, and it is the difference
   between "we have a drug market" and "we have an economy". It also makes the airport network
   (already planned as A1-A3) *matter* instead of being scenery. My strong recommendation: yes, and
   it should ship **before** the icon purge, because it decides which items are trade goods and
   therefore which icons are worth drawing.

4. **Painted garments: mannequin render, or accept 42 tinted squares?** The mannequin path is ~40
   lines and one cached rig, and it is the only way a Tuxedo and a Hoodie look different in the bag.
   The cheap path ships in an hour and looks like a colour swatch. This is the one real
   cost/quality trade in the icon work and it is your call, not mine.

5. **Does the prison/escape stash get the same treatment, or get frozen?** It is 34 items in a
   separate game with a separate currency, 9 of which are provably dead. Fixing it properly is ~12
   icons and a handful of verbs. Freezing it means `bag.generic` stays at 34 forever and the ratchet
   only ever measures the city. **I'd freeze it and say so in the ratchet**, rather than let a side
   mode set the pace for the main one.

---

## APPENDIX — the numbers I recounted from source

GAMEPLAN's census was produced by a live audit (`CBZ.itemIconAudit()`); mine is a static recount and
agrees within ±2 on every family. Where they differ, **trust the audit** — a live catalog is read at
runtime and six files register into it.

| family | GAMEPLAN | my static recount | source of mine |
|---|---|---|---|
| composable clothing | 66 | 67 | `clothing()` ×45 + `SUIT_CAT` ×22 |
| pelts | 45 | 44 | distinct `fur:` names across 10 species files |
| pristine pelts | 41 | 40 | 44 − 4 legendary (`rarity !== "legendary"` gate) |
| legacy wearables | 27 | 29 | `tag: "wearable"` rows |
| valuables | 17 | 17 | `tag: "valuable"` non-pelt rows |
| meat & fish | 13 | 13 | distinct `meat:` names |
| tools | 9 | 8 | + Bone/Dog Treat from `dogs.js` |
| food | 9 | 9 | 6 + `Fresh Produce` + `Fresh Cut` + `Dog Treat` |
| jewelry | 8 | 8 | `jewel()` calls |
| ordnance | 6 | 6 | Grenade · Ammo Box · AGM · C4 · Bunker Buster · Nuclear Device |
| drugs | 4 | 4 | `DRUGS` |
| materials | 3 | 3 | Wood · Stone · Scrap |
| melee | 2 | 2 | Bat · Knife |
| **city total generic** | **250** | **251** | |
| **prison bag generic** | **34** | **34** | `systems/economy.js` ITEMS |

Also worth knowing: `clothes.js` defines **4 blouses** (`blouse_white/blush/navy/olive`) that
`economy.js` never sells — garments that exist in the wardrobe with no shop row. That is the
inverse of a stat fiction and probably a two-line fix.
