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
