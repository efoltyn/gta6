# CLAUDE.md

Browser GTA-style game. Three.js r128 (vendored), plain script tags in
`index.html`, one global `CBZ`, ~264k LOC. No build step — GitHub Pages serves
the repo root of `main`, so **pushing to main IS the deploy** and anything in
`src/`/`assets/` ships.

**Read `docs/claude/` before working — all of it is binding:**

- `doctrine.md` — WHY constitution, hard rules (determinism, flags), Block Law + ratchets
- `verification.md` — math gate, probes, builders-vs-orchestrator, headless facts
- `engine-systems.md` — shared systems: REUSE, never re-invent
- `sessions.md` — dated wave reports and measured ratchets
- `gpt-handoffs.md` — GPT diagnostics, open issues 28–121
- `sound.md` — what may make a noise, how loud, and why (the dB scheme + ratchets)
- `project.md` — deploy details, doc map

Also `GAMEPLAN.md`, `docs/plan/`, `PROCGEN.md`.

## THE STUDIO — `src/core/studio.js`, one script tag

**GANG CITY IS THE BACK END; THE HTML IS ADDITION** (owner, 2026-08-07). A
one-shot page should spend its lines on what is new, never on redrawing a body,
an aeroplane, a camera, a HUD or an explosion this repo already ships.

`index.html` carries 471 tags, so every mode pays for every other mode and the
cheapest thing to add has always been another dressed room. A `games/` page pays
only for what it names, and until now it could not NAME anything: bomb
survivor's seventeen tags were found by failure, and the one it needed most
(`systems/modecaps.js`) was missing, so its `registerMode` call was a no-op.

```html
<script src="../src/core/studio.js"></script>
<script>CBZ.studio.need("people","desert","air").then(function(){ /* your game */ });</script>
```

**18 packs.** `three` · `seed` · `boot` · `look` · `green` · `people` · `caps` ·
`military` · `desert` · `airbase` · `air` · `ordnance` · `nukefx` · `fx` ·
`damage` · `sound` · `radar` · `match`. The manifest owns dependencies, the load
ORDER measured to work, and what each publishes. `src/` is derived from
studio.js's own URL. Files a page lists by hand are never re-injected.

**The verbs, all routes to what exists.** `join()` declare and become a mode ·
`world(name)` · `cast(role)` the shipped 1.82 m rig · `crowd(n, role)` ·
`model(name)` / `fly(kind)` shipped geometry, asking `airbase.js` first because
its factories fall back and seat wheels · `boom(pos)` fireball + damage +
collapse + attenuated sound · `bombsight()` the impact mark off the SHARED
integrator · `chase()` a smoothed, ground-clamped camera · `controls(kind)` one
surface for keyboard, mouse and touch · `hud()`.

**THE HUD RULES LIVE IN `hud()` NOW**, so the next one-shot cannot get them
wrong: health is always top left and is one meter; no emoji in HUD space; and a
touchscreen is NEVER shown a keyboard key, because `controls()`/`hud()` decide
that once from pointer coarseness rather than in every page by whoever forgot.

**THERE IS EXACTLY ONE `registerMode`.** A second definition of that name
replaced `config.js`'s, `city/mode.js`'s descriptor stopped landing in
`CBZ.modes`, and the city built with no arena. The math gate caught it.

**`CBZ.colliders` and `CBZ.shake` are published by microboot**, both under the
names the engine already reads. Colliders were private, so every
building-damage verb saw an empty world. `CBZ.shake` lives in city-coupled
`systems/camera.js` while `crashfx.js` calls it on every blast, so slice-page
explosions were silent and still.

**`tools/api-lint.mjs`** answers "does this page call things that exist" without
running anything: it collects every `CBZ.<name>` and `CBZ.<ns>.<member>` a page
mentions and asks whether the engine ever assigns it. `CBZ.radarScope` for
`CBZ.radar` is not a syntax error, so `node --check` is blind to it, and that
exact one shipped. Proven to bite by injecting three typos.

Flags `STUDIO_V1`. Ratchet `CBZ.studio.audit().missing` pinned at 0 by
`tools/studio-check.mjs`; `--print` regenerates **`docs/ONE-SHOT.md`**, the ~150
line system prompt a new mini-game is written against. Regenerate it whenever a
pack or verb changes. Dogfood: `games/bomb-survivor.html` — ONE page now (the
A/B bet is settled: one tag, and the game stands on the real map via
`citycore`/`militaryisland`/`airport` packs, `studio.raise()`, `studio.town()`).

## THE MODE ENUM IS NOT A CAPABILITY CONTRACT — `CBZ.modeHas()`

**GANG CITY IS THE ENGINE AND THE ASSET FARM** (owner, 2026-08-06). Prison
(`escape`), Gun Game and Natural Disaster (`survival`) are SCENARIOS wearing it,
per the Rome Test. A shared engine verb must therefore never ask *which
scenario is running* — it asks for the capability:

```js
CBZ.modeHas ? CBZ.modeHas("traverse") : CBZ.game.mode === "city"   // adopt like this
```

`src/systems/modecaps.js` owns the table (`traverse` · `stepLedge` · `blast` ·
`blastActors` · `breach`), the mode's live actor roster (`CBZ.worldActors`), the
damage switchboard (`CBZ.hurtWorldActor` → `aiKill` / `gungame.hurt` /
`surv.hurt` / `cityKillPed`) and the shared blast coupling
(`CBZ.blastWorldActors`). Flag `MODE_CAPS_V1=false` restores the old city-only
answer at every site at once.

### A GAMES/ PAGE JOINS THE ENGINE IN ONE CALL — capabilities on `CBZ.modes`

**A ONE-SHOT HTML GAME MUST NEVER HAVE TO EDIT ENGINE SOURCE TO BE REACHED**
(owner, 2026-08-07: "make it so next time there's a one shot of a new HTML
game, they can easily use Gang City like an engine"). The capability table
above answered from engine source, so a new page landed in no row, `modeHas`
said false at every gate, and the whole shared layer politely did nothing.
`games/bomb-survivor.html` is the measured case: two hundred towers, and a
blast could not reach a man, a vault, or a wall.

The registry was **already there** — `config.js:37` owns `CBZ.modes` and
`CBZ.registerMode(id, def)`, `state.js` delegates to it, and `city/mode.js`,
`modes/survival.js` and `modes/gungame.js` already call it. Capabilities are
now FIELDS ON THAT DESCRIPTOR, so declaring is one call the mode already makes:

```js
CBZ.registerMode("slice", { id: "slice", label: "Bomb Survivor",
  caps: { traverse:1, stepLedge:1, blast:1, blastActors:1, breach:1 },
  actors: (out) => { for (const m of myMen) if (!m.dead) out.push(m); },
  hurt: (a, dmg, imp) => { a.hp -= dmg; if (a.hp <= 0) myKill(a, imp); return true; },
  hurtPlayer: (dmg, x, z, cause) => myHurtPlayer(dmg, cause),
  route: "slice roster + myKill" });
```

A descriptor with no `caps` behaves exactly as before, which is why the three
shipped modes needed no edit. `caps` is an open string set: a future block
grants a capability by documenting a name, never by editing `modecaps.js`.
Flag `MODE_CAPS_DECL_V1=false`. Tool: `tools/mode-registry-check.mjs`.

**THERE IS EXACTLY ONE `registerMode`.** A second definition of that name
replaced config.js's, `city/mode.js`'s descriptor stopped landing in
`CBZ.modes`, and the city built with no arena and an empty biome set. The math
gate caught it. `modecaps.js` now creates the pair only when config.js is
absent (the slice-page case), yielding otherwise.

**`CBZ.colliders` IS THE WORLD, AND MICROBOOT NOW PUBLISHES IT.**
`core/microboot.js` kept its boxes at `micro.colliders` and nowhere else, so
every shared verb that reads `CBZ.colliders` — the vault probe, `carveHole`,
`cityWallRuin`, `cityAirstrikeCollapse`, camera occlusion — looked at a world
with two hundred towers in it and found `undefined`. The element shape was
already identical field for field. Same array, published under the name the
engine reads, yielding if anything defined it first.

**WALLS BREAK EVERYWHERE; THE PERIMETER DOESN'T.** `city/buildings.js`
`carveHole` opens real walk-through holes with sill/header/flank remnants and a
lit room behind; `city/fracture.js` owns the ledger (24 holes, plywood
eviction, coordinate-stable persistence, net broadcast) and `chewWall` (25
rifle rounds in a 1.2 m cell = a murder hole). None of it reads a city record.
A wall opts OUT with **`noBreach` on its collider** — that one flag on
`world/yard.js`'s `wall()` helper is the entire policy keeping the prison an
escape game rather than a jailbreak sandbox. A collider with no `y0`/`y1`
derives its band from `c.ref`'s bounds, so pre-contract walls are carvable
without editing the world files.

**The rule this file exists to enforce:** `mode === "city"` is legitimate when
it guards a CITY RECORD (`cityCars`, `city.arena`, the wanted ladder, the
world-state ledger, the fracture/structural chain) and is a BUG when it guards a
shared verb. Two shipped examples of the bug, both fixed 2026-08-06: an RPG
outside the city produced a camera shake and nothing else, and nobody outside
the city could vault a chair — while the prison's own mess tables already
registered exactly the `y0/y1` + `ref` colliders the vault probe wants.

**`CBZ.cityExplosion` is a WRAPPER CHAIN, not a function.** Six files hang city
couplings on it and they stay installed for the session. Detonate through
`CBZ.cityBlastCore` outside the city — same fireball, damage, sound and shake,
none of the city bookkeeping. Wrap `cityExplosion`; never wrap `cityBlastCore`.

Ratchet: `CBZ.modeCapsAudit().unrouted` — modes declared blast-capable whose
people a blast cannot reach. **Pinned at 0** in `tools/math-gate.mjs`.

## THE PRISON HOLDS WHO IT CAN SLEEP — `CBZ.prisonBeds()`

**"There's too many fucking people"** (owner, 2026-08-09) — the second time,
`MASS_CROWD` having already been cut 900 → 140 for the first. The headcount was
**five constants in four files** (`MASS_CROWD` · `JAIL_CROWD` · npc.js's 30-name
`ROSTER` · one resident per cell · 12 guard posts) and not one could see that
the wing has **thirteen cells**. Measured: ~207 bodies against **26 bunks** —
about 800% of the only housing in the world. Not overcrowded, impossible.

A prison is the one place where this ratio is litigated, so the number is not
taste: *Brown v. Plata* (563 U.S. 493, 2011) found California at ~185% of design
capacity and capped it at **137.5%**. `world/cellblock.js` publishes
`CBZ.prisonBeds()` — cells × bunks × occupancy — and both ANONYMOUS tiers are
now the REMAINDER of a subtraction against it (`entities/ambientstate.js`,
`entities/npc.js`), exact because of load order (cellblock 456 → guards 528 →
npc.js 535 → ambientstate 559). The NAMED cast is never trimmed: those men are
the game, and where they overshoot the answer is a bigger wing. An explicit
`CBZ.MASS_CROWD`/`JAIL_CROWD` still wins — overruling is a decision, not a drift.

    bodies in a 60° cone     69 → 20        ambient tier   140 → 0
    live inmates            124 → 50        occupancy     ~800% → 192%

**THE LEVER IS CELLS, NOT A CONSTANT.** Ratchet: `tools/prison-polish-check.mjs`
— capacity published, headcount derived not typed, no anonymous body added to a
prison that cannot sleep the men in it, occupancy ≤ 200%.

## A SOUND HAS A PLACE AND A DECIBEL — `docs/claude/sound.md`

**"He hears punches from any distance at the same volume"** (owner, 2026-08-09).
Measured, mode escape, player standing still: `punch` at **90 requests/minute,
100% of them global** — `exchangeBlows` voiced every NPC-vs-NPC blow with a bare
`CBZ.sfx()`, so a fight anywhere in an 84×110 m yard landed at full volume in
your skull. Three surfaces now, and the choice is mechanical:

| you are voicing | use |
|---|---|
| something **you** did | `CBZ.sfx(name)` — global, you are where the listener is |
| something that happened **to you** | `CBZ.sfxAt(name, x, z)` — the shared (gun) curve |
| something **someone else** did | `CBZ.worldSfx(name, x, z)` — near-field rolloff, one voice per cue, nearest wins |

`worldSfx` does NOT reuse the shared curve: that is the gun curve, still 84% at
42 m, right for a rifle and absurd for a fist. Foley gets its own inverse-square
rolloff (half at 8 m) and below 6% is not requested at all.

**EVERY BANK GAIN IS A REAL DECIBEL.** Measured, the bank had **a dropped coin
at −6.7 dBFS and a punch at −17.7** — eleven decibels the wrong way, against
thirty the other way in the real world — and 26 of 33 cues sat above the master
compressor's −12 dBFS threshold, where 5:1 flattened a gunshot and a coin to
within a couple of dB. Gains are now derived from measured real-world SPL (3M
Noise Navigator) through `target dBFS = −0.2 + (dB SPL − 170) × 0.2`. Cues above
the threshold: **26 → 3**. Three documented exceptions, each a decision.

**A REPEATING SOUND IS USUALLY A REPEATING WORLD.** The census samples what the
world is DOING beside what it plays, because the punch spam was the audible half
of 7.3 of 124 inmates fighting at every instant, forever — violence needed no
cause (`findFoe` = any rival within 8 m). Fixed at the root in `entities/ai.js`
(BEEF): a fight needs a REASON booked by things that already happen, and an
OPENING (`CBZ.guardWatching`). Not a cap — a cap is the same arbitrary violence
with a quota on it.

Tools: `tools/sound-census.mjs [--gate]` · `tools/sound-loudness.mjs [--gate]`.
Headless Chromium has no AAC decoder, so both ratchets are pinned on numbers
stamped before the decoder (engine counters, `.ogg` twins).

## THE CHARGE TABLE — real breaching math, shared by every game

`src/systems/breach.js` publishes US Army urban-breaching doctrine (FM 3-06.11
ch.8 · FM 90-10-1 app.M · ATP 3-21.8 app.H) as engine fact, so the prison door,
the bank vault and every wall price themselves in **one unit: pounds of C4**.

| charge | opening |
|---|---|
| 2 lb | mousehole — not walkable |
| **5 lb** | **one man moves through** (one C4 brick) |
| 7 lb | two abreast |
| 10 lb | wide breach |

**CONTACT vs STANDOFF is the law.** A charge STUCK to something opens it; a
rocket only wrecks it — a shaped charge penetrates (PG-7VR: 1.5 m of reinforced
concrete) while leaving a ~30 cm hole nobody walks through. Standoff banks
`STANDOFF_COUPLING` (0.35) of its mass. **Measured: 1 brick, or 7 rockets, or
2 bricks through a wall too thick for any single hit.**

**NOTHING FAKE-BLOWS-UP ANY MORE.** Every detonation banks mass into a world
cell (`CBZ.breachDeliver`) and the cell REMEMBERS — no decay, concrete does not
heal. A wall that refused the first hit is closer to opening than it was, and
crossing the 7 lb / 10 lb rows raises `carveHole`'s thickness ceiling so piers
go too. Do **not** zero the ledger on a hit: a facade is layers, and the reset
is what made a thick wall unopenable at sixty pounds.

A game declares a defeatable thing in one line and the charge never learns what
it is: `CBZ.registerBreachTarget({id, at, reach, lb, defeat})`. Live: the
prison's yard door (5 lb — a second answer beside the keycard) and every bank
vault (branch 5 / count 7 / reserve 10). Charges within 2.5 m fire together and
their masses ADD (det cord), which is how two bricks open a reserve vault.

The detonator is a **phone app** (`city/phone.js` DEMOLITION card), not a hand
prop — it shows pounds out, bricks left and what the nearest target costs.
Hold-[B] stays the fast path, and is the only one inside the wire: a man in a
prison yard does not have a phone. Flags `BREACH_TABLE_V1` · ratchet
`CBZ.breachAudit().unreachable` pinned at 0. Tool: `tools/breach-check.mjs`.
