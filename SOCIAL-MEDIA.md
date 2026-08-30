# SOCIAL-MEDIA.md — THE FEED, and the man who farms it

*A someday note, not a wave. Nothing here is scheduled. It is written down because the
idea is good and because **most of it is already built** — the point of this file is to
say exactly which parts are already in the repo, so the day this gets picked up nobody
rebuilds a phone, a nuke, a detonator or a suit.*

---

## 1. THE IDEA (owner, 2026-08-30, verbatim)

> "for gang city someday I want to have social media and a villain who posts a joker like
> plant a bunch of c4 and blow it up behind them and they say if it gets 100m likes they
> will do a Nuke next, and the phone shows jr has close to that and phone nuke suit is all
> built that's the cool part and gang city has so much of this already built"

The shape of it:

- Gang City gets a **social feed** — an app on the phone you already carry.
- A **villain** posts to it. Not a mission-giver, not a boss on a marker: a *poster*.
- His first post is the Joker beat: he stands calm in frame, C4 goes up behind him, he
  does not turn around. The ask is the punchline — **100M likes and the next one is a
  nuke.**
- You open your phone at some point later and the counter is **already close.**
- The dread is not a cutscene. It is a **number on your own phone that goes up whether
  you look at it or not.**

That last line is the whole design. Everything below serves it.

---

## 2. WHAT IS ALREADY BUILT (this is the cool part)

Every row here is real code in this repo today. The feed is not a new game; it is a new
*card* on a phone that already exists, reading numbers that already move.

| The beat | Already built | Where |
|---|---|---|
| The handset | `[P]` opens a modal of app cards; feature-detected reads so a card can never throw | `src/city/phone.js:1`, `src/city/phone.js:1086` |
| Push notifications | Canonical sink `CBZ.cityPhoneNotify({from, app, text})`, unread badge, 40-deep log | `src/city/phone.js:77` |
| A phone you **raise in world** | Diegetic handset with real glass; banners drop *inside* the glass when raised, buzz + LED when stowed (owner rule) | `src/city/campaign_ui.js:556`, `:748` |
| Phone is an inventory slot | `CAMPAIGN_PHONE_IN_HOTBAR` — the phone sits on the hotbar like a gun | `src/city/campaign_ui.js:23` |
| **Plant C4, walk away, blow it** | Tap `[B]` to plant on ground/wall/car/person, hold to detonate; sticks to a car and rides | `src/city/explosives.js:1` |
| **The detonator is already a phone app** | DEMOLITION card: pounds out, bricks left, what the nearest breachable thing costs, DETONATE button | `src/city/phone.js:606` |
| **The nuke** | Full Glasstone/Dolan beat table — whiteout, white dome on the Taylor–Sedov `R ∝ t^(2/5)` law, double flash, cloud | `src/city/nukefx.js:1` (5,445 lines) |
| Nuke as one line | `CBZ.detonate(x, y, z, "nuke")` — ordnance is a table row, not a file | `src/systems/impactbus.js:411`, `:676` |
| **The suit** | `SUIT_STYLES`, a parameterized painted-suit catalog with a stable index contract; a purple/green three-piece is one appended row | `src/city/clothes.js:2405`; catalog wiring `src/city/outfits.js:376` |
| A crowd that **gawks instead of running** | `cityevents.js` already splits the crowd: the closest bolt, fear ripples by contagion, the brave/nosy **stop and face the event** | `src/city/cityevents.js:10`, `:28` |
| Word of mouth | `CBZ.cityGossip(x, z, topic, weight)` and `citySocialWitnessKill` push events through a real social graph | `src/city/social.js:1033`, `:1075` |
| Clout as a currency | Ad boards pay in RESPECT when you have no business to advertise — "clout is the currency before money is" | `src/city/adboard.js:1`, `:171` |
| A board of who matters | Live power board: turf, crews, who'd inherit the throne | `src/city/leaderboard.js:1` |
| Heat/stars/bounty/body count | Wanted state the feed can read *and* feed | `src/city/wanted.js:1411` |

**Not built yet, and honestly that's all:** the feed card itself, the like counter, the
villain as a persistent poster, and the one clip surface that plays his post.

---

## 3. THE DESIGN

### 3.1 The feed is a phone card, nothing more

A `FEED` card in `phone.js`, same grammar as MARKETS or DEMOLITION: a header, rows, a
click delegate. Each post is `{ author, body, clip, likes, t, kind }`. No new modal, no
new key, no second UI. It renders in the raised glass too, because that surface already
exists — which is what makes "you pull out your phone in the street and the number is
higher" free.

### 3.2 Likes are a simulation, not a script

The counter must not be a timer dressed as a number, or the dread is fake. Likes tick
from things the world already computes:

- **Reach** — how many peds witnessed it (`cityevents.js` already buckets subjects inside
  an event radius; gawkers count double, they're the ones filming).
- **Spread** — `cityGossip` weight through the social graph, decayed per in-game day.
- **Spectacle** — the ordnance row's own `power`/`radius` off the impact bus. A nuke is
  not a bigger number because someone typed one; it's a bigger number because the blast
  reached further.
- **Notoriety** — the poster's standing (`notoriety` already exists across empire,
  factions, careers, leaderboard).

Same formula for the villain and for **you**. If the player plants C4 in a crowd, that
posts too. The feed is a mirror, and a player who works out that the crowd is the
audience has discovered the mechanic without being told.

### 3.3 The villain

A persistent NPC with a name, a face, a suit, and exactly one behaviour: **he posts.**
He is not fought, not chased, not marked on the map for most of the arc. What he has is a
schedule and an escalation ladder, and the game's job is to let you *see* the ladder from
the outside — through your phone, through billboards, through peds in the street holding
their phones up.

His arc runs on the counter, not on your missions:

1. **The C4 post.** Calm to camera, the block goes up behind him, he does not flinch.
   The line: *100 million and the next one's a nuke.*
2. **The climb.** Every few in-game days the counter moves on its own — the world keeps
   watching even when you don't. Push notifications fire from the feed's sender at
   thresholds (10M, 50M, 90M). They arrive as a **buzz** when the phone is stowed. That's
   already the rule in `campaign_ui.js` and it is perfect here: the dread is a vibration
   in your pocket.
3. **The number the player controls.** Chaos the player causes raises the ambient appetite
   for chaos. You are not neutral. If you spend the arc blowing up the docks, you helped.
4. **The last stretch.** At 99M the city changes: ad boards start carrying the clip
   (`adboard.js` already owns every billboard face), peds gawk at their own phones,
   gossip topics converge. `CBZ.detonate(x, y, z, "nuke")` is one call away and the game
   makes damn sure you know it.

### 3.4 The clip

Do not build a video player. The post's "clip" is a **still frame + a fake scrub bar**
inside the card, and the payoff plays *in the world* — the same nuke sequence the engine
already draws. A pre-rendered loop is a fallback, not the goal. The one visual worth
authoring is the villain's frame: shoulders, suit, the blast behind him, no reaction.

### 3.5 The suit

`SUIT_STYLES` takes an appended row and the whole clothing pipeline dresses him — the
formal collar, the tie blade, the bling formal kit, NPC casting by `"suit|N"`. **Append
only; never reorder** (`clothes.js:2401` — the indices are a contract). One row, one
villain silhouette, zero new art code.

---

## 4. THE ONE THING THAT COULD RUIN IT

Making the villain a mission-giver. The moment he texts you objectives he is Every Other
Game's antagonist and the counter becomes a progress bar. He must be *someone else's
problem that you can read about on your phone* until the moment he isn't. The player
should be able to ignore him for hours, and the ignoring should be what makes the
notification at 90M land.

Second-order risk: a like counter that only goes up when the player does something. If
the number is a reward, it's a score. It has to be weather.

---

## 5. IF THIS GETS PICKED UP — build order

Each step is shippable alone and makes the next one cheaper.

1. **`src/city/feed.js`** — post store, like model, `CBZ.cityPost({...})`. Headless. No UI.
   Reads `cityevents` witnesses + `cityGossip` weight + the impact-bus ordnance row.
2. **FEED card in `phone.js`** — read-only render of the store. Now the player's own C4
   already posts, and the whole loop is playable before the villain exists.
3. **The villain** — one persistent NPC, one appended `SUIT_STYLES` row, one authored post,
   one escalation schedule bound to the counter.
4. **Thresholds → `cityPhoneNotify`** — buzz in the pocket at 10M / 50M / 90M.
5. **99M city dressing** — the clip on the ad boards (`adboard.js` already rents and
   renders every face), gawk bias toward phones.
6. **The nuke** — the row is already defined. Point it at a district and let
   `nukefx.js` do what it was built to do.

Steps 1–2 are the ones with real value; the villain is what they're *for*.
