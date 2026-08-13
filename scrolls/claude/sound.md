# SOUND — what may make a noise, how loud, and why

Owner report, 2026-08-09: *"The prison game spams annoying sounds. One very
annoying sound… make the sounds much more intentional."* Then, on being shown a
first pass: *"He hears punches from any distance at the same volume. It's the
fact that you can hear it. It's not muting it."* Then: *"Compare the decibel
level in real life of a gumdrop versus a punch."* Then: *"The spamming of
punches is not a sign of the audio being as much of a problem, but also maybe
the NPCs."*

Four statements, four different bugs, all real. This file is the answer to all
four, and every number in it was measured, not guessed.

## The tools — never eyeball a mix

| tool | question it answers |
|---|---|
| `node tools/sound-census.mjs [--mode escape] [--at x,z] [--seconds n]` | which cue is repeating, who asked for it, and **what the world was doing while it did** |
| `node tools/sound-census.mjs --gate` | ratchet: idle prison must not repeat a cue above 20/min, and every idle sound must carry a distance |
| `node tools/sound-loudness.mjs` | every cue's measured level beside the real-world dB SPL of the thing it depicts |
| `node tools/sound-loudness.mjs --gate` | ratchet: every cue within 2 dB of its scheme target, every cue priced |

**Headless codec fact.** The bank is `.m4a` (AAC) and Playwright's Chromium is
the OSS build with no proprietary decoder, so nothing actually *plays* headless
and the F8 playback feed stays near-empty. That is a property of the browser,
not of the game. Both ratchets are therefore pinned on numbers stamped *before*
the decoder is involved: `CBZ.soundAudit()` counters, and the `.ogg`/`.wav`
twins that 59 of the 61 bank files ship.

## 1. A sound must have a place — `CBZ.worldSfx`

`CBZ.sfx("punch")` inside an NPC-vs-NPC brawl is a sound with no place: it
plays at full volume no matter where in the world it happened. Measured in mode
`escape`, player standing still in a cell: **90 punch requests per minute, 100%
of them global.**

Three surfaces now, and the choice is mechanical:

| you are voicing | use | what it does |
|---|---|---|
| something **you** did | `CBZ.sfx(name)` | global — you are where the listener is |
| something that happened **to you** | `CBZ.sfxAt(name, x, z)` | attenuated on the shared (gun) curve |
| something **someone else** did | `CBZ.worldSfx(name, x, z)` | near-field rolloff, one voice per cue, nearest wins |

`worldSfx` does not reuse the shared distance curve, because **a body is not a
gunshot**. That curve is the gun curve — still 84% volume at 42 m — and it is
right, because a rifle report really does carry across a city. A fist landing on
a rib does not. World foley gets its own inverse-square rolloff (half volume at
8 m, a fifth at 16 m) *on top of* the shared curve, and below 6% it is not
requested at all — an inaudible sound that still holds the cue's one voice is
worse than silence, because it is silence that also mutes the punch you should
hear.

Also in `worldSfx`: one cue is one voice across the whole world (a 0.3 s gap),
so ten brawlers make a brawl instead of a machine gun — **unless** the new
emitter is meaningfully closer, in which case it takes the voice, because the
nearest source is the one that means something.

## 2. A sound must be worth its loudness — the dB scheme

`tools/sound-loudness.mjs` decoded all 61 bank files and measured them. The
bank said:

```
a dropped coin   -6.7 dBFS          a punch to a body   -17.7 dBFS
```

**Eleven decibels the wrong way.** In the world those events are about 50 and
80 dB SPL at a metre — the punch is thirty decibels *louder*, roughly thirty
times the pressure. And **26 of 33 cues landed above the master compressor's
-12 dBFS threshold**, where a 5:1 ratio squashed them into each other: a
gunshot and a coin left that stage within a couple of dB. Nothing sounded
important because at the output nothing was.

So gains are now derived. Each cue names the real-world SPL of the thing it
depicts, and:

```
target dBFS = -0.2 + (dB SPL - 170) x 0.2        [clamped at -0.2]
```

A fifth of a decibel per decibel: 145 dB of world into a 27 dB window, the same
order as Wwise HDR's recommended window and DICE's Frostbite mapping, both of
which also treat authored loudness as *priority*, not just volume. Anchored at
the **loud** end — a grenade keeps the level it already had — so the game's
perceived volume does not move and no makeup gain is needed.

Result: cues above the compressor threshold went **26 → 3**. The compressor now
does the job it was built for (stopping auto fire from clipping) instead of
flattening the entire game.

### Where the real-world numbers come from

Measured, from [3M's Noise Navigator database][nn] (1700+ measurements) and
[sengpielaudio's SPL table][sp]:

| event | dB SPL | source |
|---|---|---|
| breathing | 10 | Noise Navigator, *Personal* |
| bedroom at night / library | 30 / 38-40 | Noise Navigator, *Household*, *Public* |
| speech at 1 m | 60 | Noise Navigator, *Personal* (12 concurring entries) |
| car door slamming | 65 @ 10 m = **85 @ 1 m** | Noise Navigator, *Transportation* |
| loud shout | 90 | Noise Navigator, *Personal* |
| car horn | 100 | Noise Navigator, *Warning* |
| ambulance siren | 120 | Noise Navigator, *Warning* |
| police siren | 100 @ 30 m ≈ 130 @ 1 m | Noise Navigator, *Warning* |
| 9 mm pistol | 157-160 (shooter's ear) | Noise Navigator, *Firearms* |
| 12-gauge shotgun / .30-06 rifle | 156 / 163 | Noise Navigator, *Firearms* |
| conversation / vacuum / chainsaw @ 1 m | 60 / 70 / 110 | sengpielaudio |

Anchored between measured neighbours where no published measurement exists —
these are the honest estimates, and they are labelled as such:

- **punch to a body, 80 dB.** No SPL measurement of a punch exists in the
  literature (boxing science measures force in newtons, not sound). It is a
  damped low-frequency impact: quieter than a hand clap, below a loud shout at
  90 dB, well above speech at 60.
- **footstep on concrete, 60 dB** · **dropped brass/coin, 50-60 dB** ·
  **cloth/sleeve, 35-40 dB** · **latch, keys, buckle, 45-55 dB** — all placed
  under speech, in the order they occur in a quiet room.
- **glass, 95 dB** · **collapse, 110** · **thunder, 120** · **grenade, 170.**

### The three exceptions

An exception is a decision someone made, never a cue nobody got round to. Each
is named in `tools/sound-loudness.mjs` and again at the cue in `audio.js`:

- **`siren`** — the table would raise it 6 dB. Refused: the owner's ruling that
  the siren must not dominate ("the real cue is the cop you can see") outranks
  the table.
- **`nuclear_shock`** — the table would raise it 5.5 dB. Refused: scale there is
  produced by the pressure stage ducking the whole world, which is how you say
  "too loud to hear" without asking the speakers to be too loud to hear.
- **`lockdown`** — the one bank file with no `.ogg`/`.wav` twin, so it cannot be
  measured without an AAC decoder. Set from the scheme on an assumption, and
  labelled `ESTIMATED` in the bank until a twin exists.

## 3. A sound must be told the truth — the cue must exist

`CBZ.sfx("door")` was still being called from three places, including the
prison intake, after the generic `door` cue was split into `door_open` /
`door_close`. An unmapped cue is a `console.warn` and **silence** — so the bars
racking shut on you at booking, the single most important sound in the escape
game's opening, had not played at all. `tools/sound-census.mjs` reports unmapped
requests as their own table for exactly this reason.

The fix is *not* a corrected cue name at those three lines.
`tools/test-sound-source-contracts.mjs` has always held that a physical door cue
may only be requested by the moving hardware — and a state change ("you are now
booked") is not hardware. So the leaf speaks: `world/cellblock.js`'s `setDoor`
and `games/jail.js`'s `setDoor` voice it through `CBZ.worldSfx` at the door's
own coordinates, only when a leaf actually moved. Every caller gets it free —
intake, release, recapture, a facility lockdown racking the whole wing (which
`worldSfx` collapses to the one nearest leaf).

That contract was **red on `main`** before this wave, with 8 violations, five of
which were never violations at all: `city/boarding.js` (the car-door arc) and
`city/vehicle_hold.js` (a cargo ramp) are movers that shipped after the
allowlist was written. A permanently red gate is a gate nobody reads, which is
precisely why the two real violations sat in it unnoticed. It is green now.

## 4. A sound repeating is usually the world repeating — not the mixer

The census samples what the world is doing beside what it is playing, because a
cue firing 90 times a minute is normally the audible half of a simulation bug,
and counting only the sound gets you a quieter bug.

Measured, mode `escape`, player idle: **124 inmates alive and 7.3 of them in
`fight` at any instant** — three and a half brawls running continuously,
forever. See `docs/claude/sessions.md` and the BEEF block in
`src/entities/ai.js`: violence needed no cause, so the yard never stopped.
Fixing the audio alone would have produced a well-mixed permanent riot.

[nn]: https://multimedia.3m.com/mws/media/888553O/noise-navigator-sound-level-hearing-protection-database.pdf
[sp]: https://sengpielaudio.com/TableOfSoundPressureLevels.htm
