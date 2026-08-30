# THE GREAT WHITE REFERENCE SHEET

Owner supplied photo reference (2026-08-20) and said: **"Great white is most
important — focus on it and then generalize."** Everything below is read off
those photographs. It is the acceptance criteria for `src/city/wildlife/aquatic.js`,
`src/city/wildlife_shark.js` and every before/after preset that stages a shark.

Every other shark in the catalogue (megalodon, hammerhead, bull, tiger…) is a
DEVIATION FROM THIS SHEET, not an independent design. Build the great white
right, factor the grammar, then dial the numbers per species.

---

## 1. THE OPEN MOUTH, CLOSE UP (the money shot)

Ref: underwater three-quarter, jaws fully open, prey's-eye view.

- **THE UPPER JAW PROTRUDES.** This is the single most-missed fact. A great
  white does not hinge its lower jaw down like a box lid — the whole
  palatoquadrate SLIDES FORWARD AND DOWN out from under the snout, and the
  snout itself LIFTS. At full gape the upper tooth row is *in front of* the
  tip of the closed-mouth rostrum. If the mouth opens and the snout stays put,
  it reads as a puppet.
- **The gape is nearly circular**, not a wedge. Corner of the jaw pulls back
  and the whole opening rounds out.
- **Gums are thick, wet, and DARK RED-PINK** (~`0x8e3b42` deepening to
  `0x5e2229` in the corners) — they are a big visible band, not a hairline.
- **The mouth interior is dark PINK/RED, not black.** A black void reads as a
  hole in the mesh. Deep throat can go to `0x3a1418`, never to `0x100710`.
- **Teeth are large white triangles with SERRATED edges, in MULTIPLE ROWS.**
  A second (and hint of a third) row sits behind and below the functional row,
  angled further back. Front teeth are broad; teeth get smaller and more raked
  toward the jaw corners. Tooth colour is warm off-white (`0xf2ead6`), pinkish
  where it meets the gum.
- **Long horizontal WRINKLE FOLDS** run along the flank behind the head when
  the head is raised/flexed. Cheap and enormously effective.
- **Eye is a small, pure-black sphere** set HIGH on the head, no visible sclera,
  no iris. Small relative to the head — an oversized eye instantly reads cartoon.

## 2. THE HEAD, HEAD-ON, AT THE SURFACE

Ref: head-on with prey in the jaws.

- The head is a **WIDE DOME** — markedly wider than it is tall, rounded across
  the top, tapering to a blunt, slightly UPTURNED snout tip.
- **The countershading boundary is a hard, RAGGED, high-contrast line** — not a
  soft gradient and not a straight line. Dark grey-brown above, bright white
  below. It runs low across the cheek and kicks UP behind the pectoral fin and
  above the gills.
- **Ampullae of Lorenzini**: dark speckled pores across the white underside of
  the snout and the lower jaw. Dozens of tiny dark dots.
- **Nostrils** are two short dark CURVED SLITS on the underside of the rostrum,
  well forward, not spheres.
- **Scars.** Pale linear rake marks and scratches scattered over the dark
  dorsal skin. An unscarred great white looks fake.
- Skin is **matte** — dermal denticles scatter light. High specular is wrong.

## 3. THE BREACH / HEAD OUT OF WATER

Ref: shark angled ~45° up out of the water, mouth open.

- Body pitched up 40–55°, head and pectorals clear, water **sheeting off the
  back** and dripping from the jaw.
- **Five vertical gill slits**, pale, angled slightly back, sitting ON the
  countershading transition — visible against the white as light slashes.
- **Dorsal fin: broad triangle, ROUNDED apex, CONCAVE trailing edge.** Dark
  outside, paler at the base.
- **Pectoral fin: broad and swept back**, dark on top with a DARK TIP, white
  underneath. A flat box with no sweep and no taper is the current bug.
- The whole silhouette is a **teardrop** — max girth just behind the head at
  the pectoral line, then a long taper to a narrow peduncle.

## 4. FROM DIRECTLY ABOVE (drone) — WHAT YOU SEE FROM A SHIP

Ref: top-down in blue water.

- From above the shark is a **narrow torpedo**; the widest point is the
  pectoral line and the body is far narrower than the side view implies.
- **Pectorals sweep back ~30°** from the body axis and are long.
- **The tail is a tall crescent, upper lobe clearly longer** than the lower.
- The dorsal fin from directly overhead is a **thin sliver**, almost nothing.
- **The body casts a soft dark SHADOW offset onto the water below it.** The
  animal reads as a pale grey-brown shape plus a separate darker shadow. That
  double-read is what sells depth from a boat deck.

## 5. THE FIN AT THE SURFACE (the Jaws shot)

Ref: lone dorsal cutting a calm sea.

- The above-water dorsal is a **triangle with a distinctly CONCAVE, scythe-like
  trailing edge**, apex leaning BACK. Not an isoceles triangle. Not a cone.
- **Mottled grey-brown, LIGHTER and slightly translucent along the trailing
  edge**, with visible skin texture.
- **The wake is SMALL** — a low bow-disturbance at the fin's leading edge and a
  short trailing ripple. A big white V is wrong for a cruising shark; save the
  heavy wake for the rush.
- A **subtle darker mass under the surface** trails just behind and below the
  fin. That hint of body is what makes the fin frightening rather than a prop.

---

## HOW TO VERIFY

`node tools/before-after.mjs <preset>` — never "it looks better to me".
Presets that stage these facts: `shark-bites`, `marine-surface`,
`great-white-anatomy`, `shark-from-deck`, `predator-mouth-envelope`. Each declares metrics so the run
prints a table instead of asking you to open a PDF.

---

## 6. THE OPEN MOUTH IS A HOLE, NOT A LUMP (owner, 2026-08-20)

Owner, looking at the shipped gape: **"it's like there's a pink rock in the
mouth when they open it. It doesn't look like biting."**

That is exactly right and it is the last big thing wrong with the hero shot.
The mouth cavity is built as a convex ellipsoid, so opening the jaws reveals a
BULGING PINK OBJECT filling the gape. Every reference photograph shows the
opposite: an opening that RECEDES.

Read the photographs from the outside in — this is the whole grammar, and it
is four concentric bands, not one blob:

1. **Pale outer jaw skin.** Off-white, slightly pink where it meets the gum.
2. **The GUM RIM** — a bright, wet, saturated pink-red band following the U of
   each jaw. This is where all the strong pink belongs, and only here. It is a
   RIM, a few centimetres deep, not a mass.
3. **The TOOTH RING** — white triangles standing on that rim, raked inward and
   back, ringing the opening on both jaws.
4. **THE CAVITY** — and it is DARK. Deep brownish-red / maroon at the front,
   falling away to near-black down the throat. It reads as depth. In the
   wide-gape photograph the whole centre of the frame is a dark hole; there is
   nothing convex in it at all.

So the fix is not a colour tweak. **The cavity must be concave** — an inward-
facing surface (back faces, or a genuine receding tube/funnel) that darkens
with depth, with the pink confined to the rim behind the teeth.

**AND THE BITE MUST READ AS A BITE.** Owner: "it doesn't look like biting."
A shark bite is not a symmetric hinge and it is not an on/off flash. In order:
the snout LIFTS and the upper jaw slides forward and down (§1), the gape has a
readable expansion, holds through prey contact, visibly compresses, returns to
the exact closed seam, then leaves a recovery beat before another attack. The
close is decisive, but it must have screen time; the former 0.56 s mounted
chomp reduced contact-to-clench to roughly 90 ms and felt machine-gunned.

---

## 7. THE MOUTH IS THE BODY SPLITTING, NOT A CLAMP (owner, 2026-08-21)

Owner, with an open-mouthed orca photograph on the table: the shark's mouth
"is a clamp detached from the shape of the shark … the orca is a great one
where it's really animating the shape … we just need those black white parts
to separate like this image and make a real mouth." And: **no tongue** — "the
tongue for sharks was dumb af."

Read the orca photograph: nothing is bolted on. The HEAD ITSELF is in two
halves — the black upper half (snout, eye, melon) rotated up, the white lower
half (chin, throat) dropped down — and both halves are continuations of the
body's own mass, teeth rimming each, a dark hole between them. The
countershading boundary IS the mouth line.

So the law, as implemented in `src/city/wildlife/aquatic.js`
(`SHARK_MOUTH_SPLIT`, revert with `?sharkmouth=off`). Owner, second pass:
"I want the mouth INSIDE the geometry and prying open the geometry — the
colors already show the part that needs to split — and this also will
improve the dumb shark nose tip." So the mouth is not parts attached to the
head any more; the head's front IS two jaws:

- **The hull hands over the whole head front.** For every species with a
  snout (`MOUTH.snoutShell`), the hull ends just past the jaw corner, closed
  by a cap painted as throat. Everything forward is the two jaw shells.
- **The upper jaw is the body's dark half** (`addSnoutShell`): each
  cross-section runs seam → crown → seam, cut from the same rings and
  painted with the same ragged countershade cut, closing underneath with a
  dark palate. The EYES, nostrils and ampullae ride it, so a bite rotates
  the whole dark top of the head — eye and all — like the photograph. And
  the nose finally tapers into a real, slightly upturned TIP point instead
  of the old sawn-off end cap.
- **The lower jaw IS the body's white half.** `sharkChin` is a hull-shaped
  wedge cut from the species' own rings — same belly line, same beam less a
  crease — hinged at the jaw corner inside the `sharkLowerJaw` group.
- **The teeth live INSIDE.** Gum bands and tooth rows sit between palate and
  chin deck, inside the closed head; they exist to the eye only when the
  body pries open. The outer crown now carries the shared protrusion and a
  0.16 rad lift, so the real rostrum advances with the tooth row. A species
  may add a small nested palatoquadrate slide, but the default is zero: the
  previous large dental-only slide was anatomically motivated but visually
  recreated the floating U-shaped prosthesis.
- **The hammerhead keeps its cephalofoil** as the static upper head (its
  famously small mouth opens beneath it): notch + chin, no snout shell.
- **Verified by** `node tools/before-after.mjs shark-bites` — a self A/B
  against `?sharkmouth=off`. Its `staticVsJawM` metric is the owner's
  complaint as a number: static underside minus moving-jaw underside at rest.
  Negative = a closed chin the bite cannot move (the clamp shipped at ‑0.07
  to ‑0.11); the split mouth scores +0.2 to +1.1.

---

## 8. AN ORCA ATTACK IS A BITE, NOT A HEADBUTT (owner, 2026-08-21)

Owner: "orca attack is legit just head butting and it overlaps instead of
colliding with shape of sharks."

Two laws, both in `city/creature_combat.js` and both reverted by
`?bitepass=off` / `CBZ.CONFIG.MARINE_BITE_PASS = false`:

- **The pod's flank pass is `bite_flank`**: same cross-the-beam silhouette
  as the old ram, but the jaws ride `biteCurve` (readable expansion, held
  contact, visible compression, the worry after), and the pass only scores when
  `jawReaches` says the teeth arrived. marine_predation and wildlife_orca's
  degrade mob both choose it; the roll-over hold now stations at the orca's
  own bite point plus the quarry's measured half-beam, jaws half-open on the
  pectoral.
- **The body stops at the body** (`setLungeCap` + the approach cap): the
  committed water styles (`lunge`, `ram_flank`, `bite_flank`) can no longer
  carry an attacker through its target — the drive is capped where the
  attacker's own jaw point meets the victim's surface (a tooth-grip of
  penetration is the hold). The surface is `opts.targetRad` when the caller
  measured it — marine_predation's `bodyBeam()` reads the named hull mesh,
  because the whole-group box counts pectoral fins and calls a megalodon
  13 m wide — else the old scale guess.

- **The hunt FSM obeys the same law** (`systems/predator.js` §R): `bump` and
  `rush` closed on CENTRE distances, so predatorHunt's own commit parked an
  orca inside the megalodon before the swing even began — the last live
  headbutt path. Both states now floor their stop at the hunter's jaw
  distance plus the quarry's measured half-beam (and the fight hand-off's
  reach is floored to match, or the swing would deadlock in its own
  approach); a water hunter with an authored mouth no longer throws the
  shut-mouth investigatory bump at an ANIMAL at all — that beat is the
  player's dread cue, and against a quarry it commits (a bite) instead.
  Player hunts are untouched.

**Verified by** `node tools/before-after.mjs orca-bite` — the production
`creatureFight` loop frozen at matched swing phases, `?bitepass=off` as the
before column, plus a `commit-rush` subject that drives the REAL
`predatorCommit` + `predatorHunt` FSM end to end. `nosePenM` is the overlap
as a number (staged pass: 1.9 m rammed through → 0.7 m tooth grip; live FSM
commit: 2.15 m — the nose at the megalodon's centreline — → 1.3 m);
`jawOpenPct` is the headbutt as a number (0 → 100 at contact).

**THE ACCEPTANCE RULE, in the owner's words (2026-08-21): "the only overlap
form above should be when the thing is physically in the mouth."** From a
drone, two fighting bodies may overlap ONLY where a mouth encloses flesh:
the tooth-grip the lunge cap allows (jaw at the surface, ~half a metre of
head pressed into the flank), a seized prey riding the jaw point, the
roll-over's jaws on the pectoral. That overlap is correct — do not "fix" it
to zero, a bite that never encloses anything is a boop. Every other
silhouette overlap (a body inside a body, a nose past a centreline, a fin
emerging from a quarry's flank) is the bug this section exists to kill.

---

## 9. RESEARCH-DERIVED MOUTH ENVELOPE CONTRACT (2026-08-21)

The photo sheet remains the pixel reference; these sources decide what the
shared geometry and animation are allowed to do:

- [Motta et al., *Eating without hands or tongue*](https://pmc.ncbi.nlm.nih.gov/articles/PMC1617152/)
  identifies upper-jaw protrusion as fundamental to shark feeding and describes
  the palatoquadrate and Meckel's cartilage projecting during the bite. In code,
  that means a shark may translate/lift its upper envelope; it does **not** mean
  a naked tooth hoop may travel independently of visible head tissue.
- [Wroe et al., *Mechanics of biting in great white and sandtiger sharks*](https://pubmed.ncbi.nlm.nih.gov/21129747/)
  models the great white across gape angles and supports a mechanically capable
  bite throughout the opening arc. The production driver therefore owns one
  continuous 0→1 gape, with body shells, cavity and teeth following that same
  scalar instead of separate cosmetic animation paths.
- [NOAA Ocean Today, Killer Whale Anatomy](https://oceantoday.noaa.gov/killerwhaleanatomy/)
  places 40–56 interlocking conical teeth inside the rostrum. The orca keeps its
  upper rostrum fixed, rotates one hull-shaped white mandible, and uses paired
  converging gum rails rather than a solid centre capsule.
- [NOAA, *Status Review of Southern Resident Killer Whales*](https://repository.library.noaa.gov/view/noaa/3332/noaa_3332_DS1.pdf)
  records 10–12 teeth per row and roughly two-thirds of each tooth embedded in
  the alveolus. The builder exposes 22 short crowns per jaw, publishes
  `embeddedToothFraction: 0.67`, and hides the roots behind the sealed body seam.

The cross-species contract is `aquaticMouth.version === 4`:

1. `lowerShell` is visible body/chin geometry parented to the physical hinge.
2. Sharks with a rostrum publish a moving `upperShell`; cetaceans publish a
   fixed upper hull and zero protrusion.
3. Teeth and gum are descendants of their anatomical envelope, never parallel
   world-space animation.
4. The cavity is recessed and revealed by the same production `swimJaw` value.
5. Closing to zero restores one sealed silhouette and hides the dental roots.

Run `npm run visual:predator-mouth-envelope` for the locked 12-state sheet and
`npm run test:predator-mouth-envelope` for the real-Chrome hierarchy/motion
contract.

---

## 10. RECESSED LABIAL MARGIN + ONE READABLE BITE CLOCK (2026-08-22)

Owner: biting "feels fast" and the sharks' lips look "too protruding."

Two shared laws answer that observation rather than tuning one hero species:

- **The mouth margin is inside the face.** The old front lip cuboids were
  centred on the oral arc and put half their 13%-of-jaw depth in open water.
  `sharkUpperLip` and `sharkLowerLip` are now one short swept arc behind that
  line, joined into the cheek bands; the moving chin also terminates at the
  oral arc instead of extending another 7% into a white lower beak. The mouth
  contract publishes `lipProfile: "recessed-arc-seal"`, and tooling measures
  lip tissue proud of the arc directly.
- **Wild, mounted, Shark Sim and pod bites share one clock.** The canonical
  duration is 0.82–1.10 s with restrained scale/ship weight. Normalized phases
  are preparation through .08, expansion to .36, held gape to .56,
  compression to .82, then exact reset/recovery. A completed animal bite has
  another .42 s before the next attack; a hull bite has .55 s. Target probing
  still begins immediately, so readability does not add input lag.

The timing follows high-speed feeding studies rather than a cinematic guess:

- [McNeil et al., sixgill shark feeding kinematics](https://pmc.ncbi.nlm.nih.gov/articles/PMC4887027/)
  separates peak gape, prey seizure, full mandibular elevation, labial
  retraction and recovery into successive measured events.
- [Wilga et al., lemon shark feeding mechanism](https://pubmed.ncbi.nlm.nih.gov/9326502/)
  describes expansive, compressive and recovery phases and reports individual
  variation in duration rather than one instantaneous snap.
- [Klimpfinger and Kriwet, CT survey of shark labial cartilages](https://pmc.ncbi.nlm.nih.gov/articles/PMC10741050/)
  finds well-developed labial cartilages associated with suction feeding,
  while high-trophic ram/pure-biting sharks tend toward absent or small
  remnants. That supports a subtle recessed margin on this apex-shark family,
  not a conspicuous bumper.

Run `npm run visual:shark-bite-cadence -- --gate` for the locked real-time
rest/tell/expansion/contact/compression/clench/recovery sheet. Run
`npm run test:shark-bite-cadence`, `npm run test:aquatic-mount`, and
`node tools/shark-sim-check.mjs --quick` for geometry, mounted contact and
autonomous-hunt contracts.

---

## 11. THE ATTACK FROM UNDERNEATH (owner, 2026-08-30)

Owner, with a prey's-eye photograph of a great white coming up open-jawed:
**"you look around at surface and don't see any sharks but then dive and look
down and a megladon is attacking from under you."**

The engine could not do this, and the reason is worth writing down because it
is not the reason it looks like. It was not that the ambush was unimplemented.
It was that **the shark's whole hunt was solved in plan view.**

- `city/wildlife_shark.js` answered "how deep am I?" with `DIVE[state] * draft`
  — a per-state constant measured FROM THE WATERLINE. Nothing in the shark's
  brain had ever asked where its quarry was in the water column. So a
  megalodon (draft ~8 m) hunting you rode at ~7 m on the circle and ~15 m on
  the rush whether you were floating on the surface or hanging at forty metres.
- `systems/predator.js` closed its rush on `Math.hypot(dx, dz)`. Horizontal. A
  megalodon fifteen metres directly below a diver scored `dist ≈ 0` and bit,
  without ever needing to rise.
- The one place that DID read the quarry's depth was `strikeWants()`, the
  breach gate — and it read it only to REFUSE:
  `if (qs - qp.y > draft * 0.55 + 1.4) return false`. The attack-from-below was
  not missing, it was **specifically excluded for exactly the case above**.

And the capability was already in the building: `city/wildlife_orca.js` has set
`diveWant` from `surfaceAt(...) - qp.y` for as long as that file has existed.
The orca has matched its quarry's depth for years. It was never wired to the
shark — the animal whose signature kill this actually is.

### THE LAW

**A hunting shark's depth is measured FROM ITS QUARRY, not from the waterline.**
It wants to be `UNDER[state]` metres below whatever it is hunting.

Note what that does to everything already shipped: for a quarry AT the surface
(`quarryDepth == 0`) the expression evaluates to exactly `draft * DIVE[state]`
— the old number, to the bit. Every great-white-off-the-beach read in §4 and §5
is preserved unchanged, because for a surface swimmer the two formulations are
the same expression. What changes is only the case the old table could not
express at all: a quarry that is itself underwater. Then the shark goes under
IT. The megalodon gets its own column (`UNDER_MEG`) for the same reason
`vanish` already special-cases it: it is a 22 m open-ocean animal and staging
it seven metres under a diver puts the ambush in frame before it starts.

### THE ASCENT, AND IT IS SOLVED, NOT ANIMATED

`strikeWants` (breach) and `ascentWants` (ascent) now partition the space on
the same threshold, so no beat can claim both:

    prey shallower than draft*0.55 + 1.4  ->  THE BREACH  (leaves the water)
    prey deeper than that                 ->  THE ASCENT  (arrives at its depth)

The physics is the breach's, because it is the same climb — only the terminal
surface changes from the waterline to a diver. **The trigger is the range at
which the climb and the charge arrive together**, which `strikeWants` has always
claimed and which is here solved rather than typed:

    climb = v0*tc + ½*A*tc²   ->   A = 2*(climb - v0*tc) / tc²,   tc = gap / hv

re-evaluated EVERY FRAME against the climb remaining, the gap remaining and the
speed the body is really making. Far out the required `A` is negative (it has
time in hand) so it holds its staging depth and keeps coming; the ascent begins
at the first frame the solve turns positive, which is the longest, most visible
climb available; too close and the required peak exceeds what the body can do,
so it does not start and takes the pass as a miss. Body PITCH is
`atan2(vy, hv)` — derived from its own velocity, never authored, exactly as the
ballistic arc does it. The gape is written ON the climb (§1: the gape IS the
photograph) so the teeth arrive with the animal.

Three bugs found underneath it, none of them this feature's and all of them
older than it:

1. **`city/wildlife.js`'s wander hard-SETS aquatic `y`** to `surface - swimDepth`
   on every frame the shark brain declines the actor. One declined frame in the
   middle of an act teleports the body up the water column and the act carries
   on from there. The breach has always had this exposure too; it is just
   harder to catch over a short arc. Guarded on `air || asc || ascOut`.
2. **`city/creature_combat.js`'s `animateAttack` slammed every SWIMMING attacker
   to its nominal resting draft for the duration of a bite** (`restY()` answers
   `sea - swimDepth` for anything aquatic, and the write was absolute). On land
   that is right; in water it means **every deep bite in this game was fought
   at the resting draft** — the orca's deep takedowns included. Swimmers now
   contribute `yOff` as a DELTA, the same discipline the lunge beside it
   already used, and the depth stays owned by whatever solves it.
3. **The rush's contact test used the horizontal distance** (see above). It now
   also requires the vertical gap to be inside `reach + the hunter's own draft`
   — generous on purpose, so the ordinary surface bite is untouched, but enough
   that biting from eighteen metres underneath is no longer a thing that
   happens.

### HOW TO VERIFY

    node tools/before-after.mjs megalodon-from-below --gate
    node tools/megalodon-below-probe.mjs              # same staging, no PDF
    node tools/megalodon-below-probe.mjs --ascent-off # the shipped path
    node tools/megalodon-below-probe.mjs --trace-y    # the y-write trap

Measured on a diver at 10 m with the megalodon staged in the dark beneath him,
flag off vs flag on: peak climb **0.00 → 12.74 m/s**, peak nose-up
**0.0° → 34.9°**, solved ascents **0 → 4**, and the pass finishes with the
animal **above** the diver (`belowQuarryM` negative) versus arriving at his
depth and holding.

**`belowQuarryM` CARRIES NO DIRECTION AND THAT IS DELIBERATE.** It is the same
measurement at two opposite moments and it wants opposite things at each: while
STALKING, deeper under you is better (`stagedBelowM`); at the moment it ARRIVES
it should be near ZERO, because the whole point is that it came up to your
depth instead of biting you from the dark (`arrivalVerticalM`). Scoring the raw
number "higher is better" made a megalodon closing from 6.89 m under the diver
to 3.96 m read as a regression.

---

## 12. THE BLACK SQUARE IN THE MOUTH (owner, 2026-08-30)

Owner, on the prey's-eye shot from §11: **"find the black square in the mouth
it's retarded and make it smaller it's sticking out."**

### FINDING IT, RATHER THAN GUESSING

Worth recording the method, because two rounds of bounding-box arithmetic gave
two different answers and one of them confidently accused the animal's GILLS of
being in front of its teeth. (The bug was mine: taking a WORLD axis-aligned box
and transforming its corners back into body space re-bounds an already-inflated
box through a rotation. Measure with the mesh's own geometry bounds through the
relative matrix instead.)

What settled it was `tools/shark-mouth-paint.mjs`: tint every dark mesh in the
head a primary colour, open the jaws, photograph the mouth from the prey's eye,
and look. The answer is then a picture, not an inference.

It is **`sharkBuccalSack`** — one object filling most of the gape and standing
proud of the tooth arc with hard straight edges and sharp corners. It reads
DARK from in front (you are looking into an unlit interior) and PALE from
directly below (from there you see its lit outer wrap). One mesh, two readings;
"black square" describes both.

Three things about the staging cost a run each and are worth knowing before
using that tool:

- The animal must be IN WATER. Free play starts in the city, so spawning it at
  player+30 puts it on land and drops a below-the-mouth lens under the terrain
  — the frame comes back solid black.
- `applyGape` only drives the UPPER jaw; its own comment says it "leaves the
  mandible to whoever owns the hinge". Pose with it alone and you photograph a
  shark with its chin shut.
- `CBZ.swimJaw` owns the hinge, early-outs when handed the openness it last
  applied (clear `rig.jawK` first), and the shark's own brain re-zeroes the gape
  on any frame it is not committed — so the jaw must be opened on the last line
  before the shutter, after every stepSim.

### THE TRIM (`SHARK_MAW_TRIM`, `?sharkmaw=off` reverts)

§6's law is that the cavity must RECEDE. The sack was breaking it by starting
level with the tooth row, so the first thing the eye met looking into an open
mouth was a flat slab rather than an opening. **Protrusion is what is removed
here, not depth** — the roof still arches up into the head, which is where a
mouth's depth belongs.

| | before | after |
|---|---|---|
| front wall, behind the seal | 6% of a jaw | **16%** |
| plan half-width vs the mouth's | 0.78 | **0.68** |
| roof dome | `gap * 0.62` | **`gap * 0.48`** |
| floor dip | `gap * 0.30` | **`gap * 0.22`** |

Measured on a megalodon at full gape with `tools/shark-mouth-parts.mjs`, tooth
line identical (1.63) on both sides: sack width **0.86 → 0.76**, depth
**1.75 → 1.59**, and its front face moved from **0.13 to 0.29 behind the tooth
line** — more than twice the clearance. The mandible liner is cut from the same
`oralPlan` and narrows with it (0.86 → 0.75). The throat is untouched.

Both cache keys carry the flag (`buccalSack|v4|trim`, `mandibleLiner|v4|trim`):
`cachedGeom` hands back one geometry per key for the life of the page, so a key
that did not mention the trim would serve whichever shape was built first to
BOTH sides of an A/B.

### A PRE-EXISTING RED TEST, NOT CAUSED BY THIS

`npm run test:predator-mouth-envelope` fails `lower body-envelope gape contract`
for all four sharks, on `cavityReveal < 3`. That metric reads
`rig.jawCavity.scale.y`, which `swimJaw` only writes **when the builder does NOT
publish `applyGape`** — and every shark publishes one, deliberately ("a builder
that publishes applyGape owns its own bore"). So the assertion contradicts the
design it is testing and reports 1 forever. Verified red on the committed tree
with this change stashed. Left alone: it wants the test updated, not the code.
