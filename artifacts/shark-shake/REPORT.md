# Why the shark game felt like an earthquake

Measured with `tools/shark-shake-check.mjs` (new): boots `index.html?mode=sharksim`,
wraps `CBZ.shake` with a caller-attributing spy, samples the lens (and the seat, the
body and the body's pitch channel) at four points in the frame, and advances game time
through `CBZ.stepSim` in one uninterrupted burst.

**No disaster fires in Shark Sim.** `systems/disasters.js`'s whole director is gated on
`CBZ.game.mode === "survival"`; the mode is `sharksim`. Over 120 game-seconds, zero
shake calls came from any disaster. The earthquake was not an earthquake — it was the
game's own core loop.

## What was actually shaking the camera

The player's only verb is biting, a fed shark lands a mouthful every 1–3 seconds, and
`camera.js`'s shake envelope runs ~0.4 s. **One mouthful fired up to four shakes:**

| source | per bite | note |
|---|---|---|
| `city/wildlife_tame.js` mounted bite | `min(0.85, 0.18 + scale*0.18)` | grew with the body — **0.83 on every megalodon bite** |
| `systems/gore.js` death beat | `0.26*amt` (0.39 measured) | the same event, shaking the lens a second time |
| `systems/grapple.js` ragdoll bounce + landing | 0.18 + up to 0.4 | the corpse you just threw, landing next to you |
| `systems/humancontact.js` `hardPlayerContact` | 0.10, re-armed per person every 0.75 s | see below — should not have been running at all |

Measured on a stocked beach (`--feast`): **88 shake calls in 90 s, 0.98/s, total
amplitude 37.7, lens jittering on 21 % of ticks.**

Two more, neither of which is a `CBZ.shake` call at all — with shake stubbed out
entirely the lens still jittered on 14.5 % of ticks:

- **A 0.20 rad step in the lunge animation.** `tickAquaticAttack` ramps the nose to
  `-0.20` by `p = 0.42`, then the strike branch restarts from `sin(0)*0.34 = 0`. Eleven
  degrees in one frame, every bite. `aquaticSeatY` multiplies that pitch by the seat's
  forward arm (metres, on a big body) before the camera sees it — a ~0.95 m lens jump
  per meal.
- **Hit-stop / slow-mo hold the shake at full amplitude.** `shakeAmt *= pow(0.0006, fdt)`
  decayed on `feelDt`, which loop.js multiplies by the time dilation. Under `doSlowmo`
  (×0.32) or a hit-stop (×0.06) the decay all but stops — so the evolution beat's
  `shake(1.0) + doSlowmo(0.42)` pinned the lens for the whole ceremony.

## The one that was not cosmetic

`entities/survivorbot.js` pushed `CBZ.player.pos` into the island crowd-separation list
even while mounted. But a rider has no body — that position is a *seat* the mount
republishes every tick. The crowd therefore saw an invisible 0.55 m pedestrian moving at
shark speed, and `humancontact.js`'s on-foot charge rule (`speed >= 6.2 && sprint`,
which a swimming shark always satisfies) **ran every swimmer over by touch**: knockdown,
"run-over" reaction, KO sound, camera shake.

It was also eating the game. Same tool, same staged beach, 120 game-seconds:

| | meals | ladder |
|---|---|---|
| before | **0** | bull shark |
| after (this one-line change alone) | **41** | megalodon |

The phantom body was body-checking the food out of the shark's mouth before it could
bite it.

## What changed

- `entities/survivorbot.js` — a mounted player is not a pedestrian; keep the seat out of
  the crowd separation pass.
- `city/wildlife_tame.js` — the bite's lens jolt no longer scales with the body; a nibble
  gets nothing, a kill gets 0.20 with a 1.1 s refractory. The lunge pitch curve is
  continuous at the hand-over. `P.pos.y` (the point the camera frames) is solved from the
  swim pose only, so the strike animation plays on the shark and the rider without
  riding the lens. No per-kill hit-stop (tried, measured, removed — the release frame
  lurched the camera ~0.95 m, once per kill).
- `systems/gore.js` + `systems/trauma.js` — `opts.lens === false`: a caller that already
  jolted the lens for this event suppresses gore's duplicate.
- `systems/grapple.js` — a ragdoll landing does not jolt the lens while you are riding
  the thing that threw it.
- `systems/camera.js` — the shake envelope decays in wall time, as its own comment always
  claimed. Slowing the world no longer lengthens a lens effect.

## Result

Same tool, same staged beach, shake enabled, 120 game-seconds:

| | meals | shake calls | total amplitude | lens-jitter duty | mean jitter/tick |
|---|---|---|---|---|---|
| before | 41 | — | — | 18.3 % | 0.032 m |
| after | 51 | 57 (0.47/s) | 14.1 | **11.5 %** | **0.0138 m** |

Per mouthful: shake calls −62 %, total shake amplitude −78 %, peak single jolt 0.83 →
0.20, mean lens jitter −65 %. `tools/shark-sim-check.mjs` passes all 6 stages;
`tools/smoke-play.mjs` boots the city clean.

## Left standing

The swim integrator still puts 5–15 cm second-differences into the body/seat while
cruising at 15 m/s (`0b_body` in the tool's output). It is below everything removed here
and the camera smooths most of it, but it is the next thing in this territory.
