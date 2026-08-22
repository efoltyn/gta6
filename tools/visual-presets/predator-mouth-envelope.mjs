/* Predator mouth envelopes — the focused acceptance sheet for the shared
   authored-mouth contract.

   BEFORE is the deployed build that prompted this repair.  AFTER is the local
   checkout.  Both sides execute the same staging function, production species
   builders, CBZ.buildSwimRig and CBZ.swimJaw; the runner copies the deployed
   camera into the local capture byte-for-byte.

   This sheet deliberately photographs the states broad marine galleries miss:
   a sealed rest profile, partial opening, full side/three-quarter/head-on gape,
   and prey contact.  Great white and orca receive the complete state set.  Bull
   shark and megalodon prove the shark envelope remains a shared grammar rather
   than a great-white-only sculpture. */

import { stagePredatorMouth } from "./shark-bites.mjs";

const subjects = [
  {
    id: "great-white-rest-profile", label: "Great White — Sealed Profile", species: "great_white_shark", open: 0,
    frame: 2.65, target: [2.38, 0.76, 0], cameraOffset: [0.35, 0.30, 6.5],
    focus: "The upper teeth and gums must disappear into the real rostrum envelope; the white chin must close the same body silhouette below it.",
    state: "REST · BODY SEALED", metric: "No white denture rail · no static chin behind jaw",
  },
  {
    id: "great-white-partial-profile", label: "Great White — Opening Profile", species: "great_white_shark", open: 0.42,
    frame: 2.85, target: [2.43, 0.62, 0], cameraOffset: [0.55, 0.35, 6.8],
    focus: "At wind-up, real crown vertices lift and advance with the tooth-bearing upper jaw; the teeth remain rooted inside that tissue-bounded envelope.",
    state: "WIND-UP · 42%", metric: "Upper body envelope advances · teeth stay embedded",
  },
  {
    id: "great-white-gape-profile", label: "Great White — Full Gape Profile", species: "great_white_shark", open: 1,
    frame: 3.05, target: [2.42, 0.48, 0], cameraOffset: [0.70, 0.55, 7.0],
    focus: "The top half of the actual head and the body-shaped white chin must separate around a receding cavity; no independent U-shaped prosthesis.",
    state: "FULL GAPE · PROFILE", metric: "Actual rostrum travels · actual chin travels",
  },
  {
    id: "great-white-gape-three-quarter", label: "Great White — Full Gape Three-Quarter", species: "great_white_shark", open: 1,
    frame: 3.15, target: [2.40, 0.50, 0], cameraOffset: [2.55, 0.80, 5.9],
    focus: "The mouth roof must meet the crown above it and the tooth rows must emerge from thick gum inside the head, not float in front of it.",
    state: "FULL GAPE · PREY VIEW", metric: "Roof-to-gum continuity · dark depth behind tooth ring",
  },
  {
    id: "great-white-contact", label: "Great White — Tuna Inside the Gape", species: "great_white_shark", open: 0.82,
    frame: 3.65, target: [2.60, 0.53, 0], cameraOffset: [1.8, 0.70, 7.2],
    targetSpecies: "tuna", targetAt: [3.25, 0.70, 0], targetYaw: Math.PI / 2,
    focus: "The real tuna must enter between upper and lower body envelopes at the same authored bite socket used for damage.",
    state: "CONTACT · PREY BETWEEN TEETH", metric: "Target inside mouth, not overlapped by a closed face",
  },
  {
    id: "orca-rest-profile", label: "Orca — Sealed Profile", species: "orca", open: 0,
    frame: 3.45, target: [4.05, 1.35, 0], cameraOffset: [0.45, 0.35, 8.5],
    focus: "The white chin must complete the whale's lower-body silhouette and hide the recessed gum roots; only a narrow dark mouth seam remains.",
    state: "REST · CHIN IS BODY", metric: "Two-thirds of each tooth embedded · no pink stripe",
  },
  {
    id: "orca-partial-profile", label: "Orca — Opening Profile", species: "orca", open: 0.45,
    frame: 3.75, target: [4.00, 1.18, 0], cameraOffset: [0.60, 0.45, 8.8],
    focus: "An orca does not protrude its upper jaw: the fixed rostrum becomes the roof while the actual white chin rotates from its body hinge.",
    state: "OPENING · 45%", metric: "Upper travel 0 · lower envelope travels",
  },
  {
    id: "orca-gape-profile", label: "Orca — Full Gape Profile", species: "orca", open: 1,
    frame: 4.05, target: [3.95, 0.95, 0], cameraOffset: [0.80, 0.55, 9.0],
    focus: "The intact lower face must be gone from behind the jaw. The mouth is the black upper body separating from its own white chin.",
    state: "FULL GAPE · PROFILE", metric: "Zero static chin depth · one physical mandible",
  },
  {
    id: "orca-gape-three-quarter", label: "Orca — Full Gape Three-Quarter", species: "orca", open: 1,
    frame: 4.15, target: [3.92, 1.00, 0], cameraOffset: [3.25, 0.85, 7.5],
    focus: "Interlocking conical crowns should rise out of recessed gum inside the blunt rostrum and body-shaped mandible, around a dark cavity.",
    state: "FULL GAPE · PREY VIEW", metric: "Embedded roots · mouth volume inside head",
  },
  {
    id: "orca-gape-head-on", label: "Orca — Full Gape Head-On", species: "orca", open: 1,
    frame: 4.30, target: [4.00, 1.00, 0], cameraOffset: [9.0, 0.55, 0.08],
    focus: "The opening must be bounded above by the real rounded head and below by the real white chin, with no full static face crossing the centre.",
    state: "FULL GAPE · HEAD-ON", metric: "Body envelope surrounds teeth on all sides",
  },
  {
    id: "bull-shark-gape", label: "Bull Shark — Shared Envelope", species: "bull_shark", open: 1,
    frame: 2.75, target: [1.95, 0.52, 0], cameraOffset: [1.85, 0.60, 5.6],
    focus: "The blunt inshore shark inherits the same articulated crown/chin/dentition hierarchy without species-specific runtime animation.",
    state: "FULL GAPE · SHARED SHARK GRAMMAR", metric: "Contract v4 · real upper and lower shell",
  },
  {
    id: "megalodon-gape", label: "Megalodon — Shared Envelope at Scale", species: "megalodon", open: 1,
    animal: [0, -1.6, 0], frame: 7.6, target: [9.45, -0.05, 0], cameraOffset: [5.2, 2.0, 15.5],
    focus: "At legendary scale the same mouth hierarchy must remain joined at the cheek and keep every tooth rooted inside moving body geometry.",
    state: "FULL GAPE · 2.6× SCALE", metric: "No scale-amplified denture gap · hinge remains embedded",
  },
];

export default {
  id: "predator-mouth-envelope",
  title: "Predator Mouths — Teeth Inside Animated Body Geometry",
  description: "Twelve locked comparisons repair the exact dentures failure: sharks now lift and advance an actual upper-head envelope containing the tooth-bearing jaw, while the orca's fixed rostrum opens against a white chin cut from its real hull. Great white and orca cover rest, partial, full profile, prey-view and contact/head-on states; bull shark and megalodon prove the shared contract generalizes.",
  beforeLabel: "BEFORE · DEPLOYED DENTURE / STATIC-FACE GEOMETRY",
  afterLabel: "AFTER · ARTICULATED BODY ENVELOPES",
  pairNote: "Same species · scale · gape · target · camera · light · viewport",
  method: "Both columns execute the same local staging recipe through registered production species builders, CBZ.buildSwimRig and CBZ.swimJaw. The before source is the deployed build; the runner copies each deployed camera into the local after capture. No model is reconstructed in this preset.",
  viewport: { width: 1200, height: 760 },
  readyExpression: "window.THREE && window.CBZ && CBZ.buildSwimRig && CBZ.swimJaw && CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES.great_white_shark && CBZ.WILDLIFE_SPECIES.bull_shark && CBZ.WILDLIFE_SPECIES.megalodon && CBZ.WILDLIFE_SPECIES.orca",
  subjects,
  stage: stagePredatorMouth,
  // The stage publishes extra diagnostics into metadata for later audits, but
  // the PDF evidence page should carry only the three declared envelope
  // measurements.  Without this filter the raw helper metrics overflow A4 and
  // silently clip the final orca/generalization rows.
  metricsWhitelist: true,
  metrics: {
    staticChinDepthM: { label: "Static body left below the moving jaw (dentures failure)", unit: "m", better: "lower" },
    upperEnvelopeTravelM: { label: "Actual upper body-envelope travel", unit: "m" },
    lowerEnvelopeTravelM: { label: "Actual lower body-envelope travel", unit: "m" },
  },
  metricsNote: "Species anatomy decides upper travel: sharks lift/protrude the upper envelope; an orca correctly leaves its rostrum fixed. Static chin depth is the failure metric and should reach zero; lower-envelope travel proves body geometry, not loose teeth, opens.",
};
