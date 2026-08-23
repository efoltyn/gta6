/* Shark bite cadence + lip seating — matched elapsed-time acceptance.

   Every timeline frame is posed from a REAL elapsed second, not a convenient
   normalized gape. The deployed side executes the exact 0.56/0.72 s mounted
   attack formula copied from its production owner; the current side reads
   CBZ.biteTimeline, CBZ.aquaticBiteDuration and CBZ.biteCurve — the same APIs
   wild predators, mounts, Shark Sim and pod combat now use. Production species
   builders and CBZ.swimJaw own every visible vertex on both sides. */

import { stagePredatorMouth } from "./shark-bites.mjs";

const tuna = { targetSpecies: "tuna", targetAt: [3.25, 0.70, 0], targetYaw: Math.PI / 2 };

const subjects = [
  {
    id: "great-white-rest-profile", label: "Great White — Lips At Rest", species: "great_white_shark", elapsedS: 0,
    frame: 2.65, target: [2.38, 0.76, 0], cameraOffset: [0.35, 0.30, 6.5],
    focus: "The closed mouth must end inside the blunt head silhouette: no pink upper tab, white lower beak, or box extending past the oral arc.",
    state: "REST · PROFILE", metric: "Recessed curved seal · zero lip tissue proud of arc",
  },
  {
    id: "great-white-rest-head-on", label: "Great White — Rest Head-On", species: "great_white_shark", elapsedS: 0,
    frame: 2.85, target: [2.42, 0.68, 0], cameraOffset: [7.2, 0.30, 0.08],
    focus: "The front seam should follow the mouth's curve and disappear into both cheeks, not read as a rectangular bumper across the face.",
    state: "REST · PREY VIEW", metric: "Arc follows head width · corners remain connected",
  },
  {
    id: "great-white-tell-010", label: "Great White — The Tell", species: "great_white_shark", elapsedS: 0.10,
    frame: 2.85, target: [2.43, 0.64, 0], cameraOffset: [0.55, 0.36, 6.8],
    focus: "At the same tenth of a second, the new bite should still be a readable preparatory tell instead of already flashing most of the mouth open.",
    state: "T + 0.10 s · PREPARATION", metric: "Expansion begins visibly · no instant gape",
  },
  {
    id: "great-white-expand-020", label: "Great White — Expansion", species: "great_white_shark", elapsedS: 0.20,
    frame: 2.90, target: [2.43, 0.59, 0], cameraOffset: [0.62, 0.42, 6.9],
    focus: "Crown and chin should be visibly travelling through mid-gape at 0.20 s; deployed is already at full extension by this instant.",
    state: "T + 0.20 s · EXPANSION", metric: "A distinct opening phase, not an on/off mouth",
  },
  {
    id: "great-white-contact-034", label: "Great White — Contact At 0.34 s", species: "great_white_shark", elapsedS: 0.34, contact: true,
    frame: 3.65, target: [2.60, 0.53, 0], cameraOffset: [1.8, 0.70, 7.2], ...tuna,
    focus: "At real prey contact the body envelopes should still frame the tuna at full gape. The deployed hit has already collapsed to its minimum clamp.",
    state: "T + 0.34 s · CONTACT", metric: "Prey enters during the held gape",
  },
  {
    id: "great-white-compress-060", label: "Great White — Compression", species: "great_white_shark", elapsedS: 0.60, contact: true,
    frame: 3.55, target: [2.60, 0.50, 0], cameraOffset: [1.65, 0.68, 7.0], ...tuna,
    focus: "The bite now starts a visible compression phase around the tuna; deployed completed both contact and clench before this frame existed.",
    state: "T + 0.60 s · COMPRESSION", metric: "Jaw closure has screen time",
  },
  {
    id: "great-white-clench-068", label: "Great White — Clench", species: "great_white_shark", elapsedS: 0.68, contact: true,
    frame: 3.35, target: [2.60, 0.57, 0], cameraOffset: [1.45, 0.62, 6.8], ...tuna,
    focus: "The lips and real chin should be closing around prey—not teleporting from full gape to a shut face—while the target remains at the authored socket.",
    state: "T + 0.68 s · CLENCH", metric: "Readable compression · tissue stays seated",
  },
  {
    id: "great-white-recovery-090", label: "Great White — Recovery", species: "great_white_shark", elapsedS: 0.90,
    frame: 2.65, target: [2.38, 0.76, 0], cameraOffset: [0.35, 0.30, 6.5],
    focus: "The mouth must return exactly to its recessed rest seam, followed by a real cooldown beat before Shark Sim may trigger another bite.",
    state: "T + 0.90 s · RECOVERY", metric: "Exact reset · deliberate space between bites",
  },
  {
    id: "bull-rest", label: "Bull Shark — Shared Rest Seal", species: "bull_shark", elapsedS: 0,
    frame: 2.45, target: [1.96, 0.68, 0], cameraOffset: [0.40, 0.32, 5.8],
    focus: "The blunt bull shark inherits the same recessed arc seal without a species-specific lip correction.",
    state: "REST · SHARED GRAMMAR", metric: "No protruding tab on the shorter jaw",
  },
  {
    id: "bull-contact", label: "Bull Shark — Contact Cadence", species: "bull_shark", elapsedS: 0.34, contact: true,
    frame: 2.85, target: [2.00, 0.52, 0], cameraOffset: [1.65, 0.60, 5.9],
    targetSpecies: "tuna", targetAt: [2.68, 0.62, 0], targetYaw: Math.PI / 2,
    focus: "The inshore shark must share the slower held-contact beat and keep its subtle lips inside the moving body envelope.",
    state: "T + 0.34 s · SHARED CONTACT", metric: "One cadence owner · one lip grammar",
  },
  {
    id: "hammerhead-compress-060", label: "Hammerhead — Compression", species: "hammerhead_shark", elapsedS: 0.60, contact: true,
    frame: 3.00, target: [1.88, 0.48, 0], cameraOffset: [1.85, 0.65, 6.2],
    targetSpecies: "tuna", targetAt: [2.48, 0.56, 0], targetYaw: Math.PI / 2,
    focus: "The cephalofoil stays fixed while the underside mouth receives the same readable compression phase and recessed seal.",
    state: "T + 0.60 s · HAMMERHEAD", metric: "Different head plan · same bite phases",
  },
  {
    id: "megalodon-contact", label: "Megalodon — Mass At Contact", species: "megalodon", elapsedS: 0.42, contact: true,
    animal: [0, -1.6, 0], frame: 7.6, target: [9.45, -0.05, 0], cameraOffset: [5.2, 2.0, 15.5],
    targetSpecies: "tuna", targetAt: [10.25, -0.05, 0], targetYaw: Math.PI / 2,
    focus: "At legendary scale the shared duration adds restrained mass: the mouth is still holding contact where deployed has already snapped shut.",
    state: "T + 0.42 s · APEX CONTACT", metric: "Scale adds weight, never machine-gun speed",
  },
];

export default {
  id: "shark-bite-cadence",
  title: "Shark Bites — Readable Expansion, Contact, Compression, Recovery",
  description: "Twelve locked frames compare the deployed fast chomp and protruding box lips with a shared aquatic bite clock and recessed curved lip seal. Great white covers rest, prey-view, tell, expansion, contact, compression, clench and recovery at identical elapsed seconds; bull shark, hammerhead and megalodon prove the same grammar survives different heads and scales.",
  beforeLabel: "BEFORE · DEPLOYED 0.56 s CHOMP / BOX LIPS",
  afterLabel: "AFTER · SHARED CADENCE / RECESSED ARC SEAL",
  pairNote: "Same elapsed second · species · scale · target · camera · light · viewport",
  method: "Both columns build registered production sharks and pose CBZ.swimJaw. Each subject declares a real elapsed second. The current side reads production CBZ.biteTimeline, CBZ.aquaticBiteDuration and CBZ.biteCurve—the same clock used by wild combat, mounts and Shark Sim. Because those APIs do not exist in the deployed build, the before side executes the exact deployed mounted formula (0.56/0.72 s duration, full at p=.30, contact clamp across p=.38→.54). The runner carries each deployed camera into the local capture.",
  viewport: { width: 1200, height: 760 },
  readyExpression: "window.THREE && window.CBZ && CBZ.buildSwimRig && CBZ.swimJaw && CBZ.biteCurve && CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES.great_white_shark && CBZ.WILDLIFE_SPECIES.bull_shark && CBZ.WILDLIFE_SPECIES.hammerhead_shark && CBZ.WILDLIFE_SPECIES.megalodon",
  subjects,
  stage: stagePredatorMouth,
  metricsWhitelist: true,
  metrics: {
    lipProudM: { label: "Lip tissue beyond the authored oral arc", unit: "m", better: "lower" },
    biteCycleS: { label: "Aquatic bite animation duration", unit: "s", better: "higher" },
    fullGapeAtS: { label: "Elapsed time to full gape", unit: "s", better: "higher" },
    compressionS: { label: "Visible contact-to-clench compression", unit: "s", better: "higher" },
    recoveryGapS: { label: "Rest beat before another bite may start", unit: "s", better: "higher" },
  },
  metricsNote: "Higher timing values here mean more readable phases, not input lag: target probing still triggers immediately, while mouth geometry takes time to expand, hold, compress and recover. Lip protrusion is measured at rest on every page and should reach zero.",
};
