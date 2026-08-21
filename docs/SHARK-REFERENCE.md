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
`great-white-anatomy`, `shark-from-deck`. Each declares metrics so the run
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
A shark bite is not a slow symmetric hinge. In order: the snout LIFTS and the
upper jaw slides forward and down (§1), the gape opens FAST, it holds open for
a beat at full extension, then the jaws SNAP shut hard and fast — the closing
is much quicker than the opening — and the head shakes on contact. Equal-speed
open and close reads as a puppet's mouth. Asymmetric timing is most of what
makes it read as a bite.

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
  body pries open. §1's palatoquadrate slide is unchanged on top (the tooth
  ring still travels out past the rostrum tip); snout lift is 0.30 rad.
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
  as the old ram, but the jaws ride `biteCurve` (fast open, held through
  contact, hard snap, the worry after), and the pass only scores when
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
