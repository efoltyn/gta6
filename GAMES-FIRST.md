# GAMES-FIRST — venues are games, the city is the engine

The owner's design law, verbatim: *"99 percent of interiors is dumb look and
doesn't answer the question WHY. Everything in Minecraft answers why."* And:
*"every prop matters and is interactable or gone."*

This doc is the method for making every big venue — casino, raceway, fight
arena, precinct, city hall, airport, military base, the open water — a real
GAME with stakes and an arc, without ever again building one as a bolted-on
feature **or** as a from-scratch fork.

## The lesson (how we got here)

1. **Features rot.** The old casino was a dressed room + an HTML menu
   (activities.js). Decent math, zero place. Nobody asks WHY a room exists
   when the room is a menu.
2. **Standalone-first works for DESIGN.** This repo was born that way:
   `cell-block-z.original.html.bak` was jail as a complete single-file game
   before it became the city. `games/casino.html` (THE GOLDEN ACE) repeated
   that: full arc ($500 → $5,000 or the shark), real rules, every object
   load-bearing — gated end-to-end by `tools/casino-check.mjs`.
3. **Standalone-first fails for SHIPPING.** Build seven venues that way and
   you get seven renderers, seven input systems, seven NPC rigs, seven
   wallets. The fix is not seven better forks — it's ONE engine and games as
   **packages**.

## The architecture

- **Engine:** the city (~120k LOC of CBZ) plus `src/core/packages.js` — the
  registry + service facade. It owns rendering, input, collision (#1/#3),
  interactions (#14), money (#6b), HUD, the shared voxel NPC rig, seeded
  determinism, the update loop (#15), and venue mounting (order-88 lot claim,
  before interior dressers).
- **Package:** one file in `src/games/<id>.js`. It contains ONLY its domain:
  venue dressing, rules/AI (pure functions), panels, arc. It touches the
  world exclusively through `ctx` — if a package needs something generic that
  ctx lacks, the job is to **grow the engine facade**, never to fork a
  subsystem into the package.

```js
CBZ.games.register({
  id, title,
  venue: { lotKind: "casino" },       // or { site: ... } for open-world domains
  build(ctx, venue),                  // deterministic; LOCAL coords in venue.group
  update(ctx, dt),                    // GAMEPLAY band tick
  api,                                // probe surface at CBZ.games.api[id]
});
// ctx: THREE mat/pmat/emat box/cyl canvasTex · solid() light() · rig()/idle()
//      zone() · wallet.cash/spend/give · hud.feed/toast/panel/closePanel
//      rand()/stream() (determinism law) · anim() · state()/saveState()
```

Rules that keep it honest:
- `build()` deterministic per seed (position-hash only — multiplayer law).
- Venue groups carry `userData.gamePkg` → `core/batch.js` spares them.
- Claimed lots get `lot._gamePkg` → dressers skip the interior, keep the
  exterior (see `city/casino.js`).
- **The WHY rule is review law:** every prop a package builds is interactable
  or load-bearing to a mechanic. Decoration with no job gets cut.
- One flag per package (`CBZ.CONFIG.PKG_<ID>`) + the master
  `CBZ.CONFIG.GAME_PACKAGES` — every package is a one-line revert.

## The dev loop

```
PORT=8877 python3 tools/devserver.py
http://127.0.0.1:8877/games/dev.html?pkg=casino
```
`games/dev.html` replays index.html's real script list, presses PLAY, and
`CBZ.games.devMount(<pkg>)` mounts one package on a pad at the spawn. You
iterate on the LIVE engine — never in a fork. Standalone single-file games
(`games/*.html`) remain useful as *design references* — a complete arc proven
in isolation — but the package is what ships.

## Reference implementation: the casino

- `src/games/casino.js` — THE GOLDEN ACE as a package. Blackjack (6-deck,
  S17, 3:2, double/split with peek), European roulette (true wheel order,
  exact payout table), Lucky 7s slots (22-stop strip, 90.8% RTP by full
  enumeration). Chips are package state; **cash is real city money** through
  the cage (`CBZ.city.spend/addCash`). The shark fronts chips against a
  marker the cage collects first; hot streaks comp drinks; the pit boss
  watches. The flagship (largest casino lot) gets the full 3D floor — cards
  fly onto felt, the wheel physically lands the pre-rolled number, reels stop
  on the paid symbols. Every other town casino's `[E] Sit at the table`
  (`cityOpenCasino`) now opens these same engines — the old menu casino is
  retired (wrap marker: `_pkgWrapped`).
- `games/casino.html` + `tools/casino-check.mjs` — the standalone design
  reference and its gate (rules asserts, rigged rounds, RTP enumeration,
  arc endings, floating-geometry check). The package reuses its exact math.

## Domain roadmap (each = one package, one file, same contract)

| id | venue | the game (compressed brief) |
|---|---|---|
| racing | raceway lot | APEX NIGHT: qualifying → grid → 5 laps vs AI with slipstream + tire wear, purse + side bets at odds, 3-race championship night. Start-light gantry runs a real sequence; jumping it costs you. |
| boxing | arena lot | SOUTHPAW PALACE: timing combat (openings/counters/stamina), real 10-point-must scorecards held up by judge NPCs, cutman between rounds, undercard→title arc, belt in the case by the door. |
| ocean | open water | DEAD WATER: salvage dives with oxygen; the food chain plays out visibly — great whites hunt (circle→bump→strike), dolphin pods jump and repel sharks, orcas hunt the whites, the megalodon guards the trench payout. Boats you actually drive. |
| airport | island airport | REDEYE INTERNATIONAL: cargo runs legit vs hot, tower clearance, PAPI-guided night landings rated on touchdown, customs heat + bribes, pay off the plane or lose the license. |
| military | island base | FORT HALSTEAD: patrol routes + honest vision cones, alert ladder, generator sabotage kills the lights, keycards open the motor pool, brig-and-escape on capture (cell-block-z homage). |
| government | city hall | CITY HALL AFTER DARK: flip a 7-member council before the gavel — dirt from the records room, wants/fears traded, bribes leave a ledger the auditor can catch, press leaks raise scandal. |
| police | precinct lot | PRECINCT 13: walk in legally; bail vs charge-kicking via the corrupt desk sergeant, evidence-room chain-of-custody heist, K-9 smells the stash unless you brought the steak, out before shift change. |

## Killing the dumb props (existing city)

`tools/prop-audit.md` (read-only audit, verified file:line) found the rot
concentrates in three patterns: shop stock you can only buy via menu,
flagship-only wiring cloned as decor everywhere else, and pure garnish. It
ships 25 ranked WIRE-ITs (propane cages that explode, shopliftable shelves, a
bank-vault heist surface, smashable meters, searchable mailboxes) and an
11-item CUT checklist. Execute WIRE-ITs through the same ctx/interactions
surface packages use — same WHY rule, same review bar.
