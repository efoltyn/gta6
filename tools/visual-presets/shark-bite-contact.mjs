/* Production Shark Sim bite-contact proof.

   This preset deliberately reuses shark-flesh's real-game boot/strike driver,
   but releases its staging pins at the first landed hit. From that instant the
   mounted controller, target movement and authored jaw are the only writers.
   The short strip therefore exposes exactly whether the shark drives through
   the body or keeps the contacted surface seated lower between the tooth rows. */

import { stageSharkFlesh } from "./shark-flesh.mjs";

const subjects = [
  {
    id: "lower-mouth-contact",
    ch: 0,
    contactProof: true,
    targetSpecies: "tuna",
    strip: { frames: 7, stepSec: 0.08 },
    label: "A Real Bite — Tuna Seated In The Lower Mouth",
    focus:
      "The same intact tuna, the same bull shark, and the same first landed production bite. Watch the contacted flank—not the blood. BEFORE, damage resolves at the broad attack radius and the mounted root keeps travelling, carrying the rostrum through the prey. AFTER, damage waits for tooth-surface contact; the shark loses way there, and that exact material point is held one row deeper and lower while the jaws compress, then released back to body physics.",
  },
];

export default {
  id: "shark-bite-contact",
  title: "Shark Sim — The Prey Belongs Inside The Mouth",
  description:
    "A locked production Shark Sim bite, followed for six tenths of a second from a close side tripod. The instrument records the target-local surface touched on the hit frame, releases every harness pin, and measures that same material point against the authored lower mouth seat on both builds. This isolates the reported failure: prey riding over the shark's top nose because a broad damage radius fired early and the mounted movement path—unlike wild predator lunges—had no body-surface stop or contact hold.",
  beforeLabel: "BEFORE · deployed main",
  afterLabel: "AFTER · working tree",
  pairNote: "Same island · seed 90210 · bull shark · intact tuna · real auto-bite · matched tripod and sim frames",
  method:
    "Both columns boot the actual index.html into Shark Sim and call CBZ.cityMountedAnimalAttack, the production auto-bite seam. The tuna is pinned only until the hit counter advances. At that edge the preset stores the clamped contact point in target-local coordinates and removes its pin; every subsequent frame is owned by gameplay. Gore and splash drawing are muted only in the probe so mouth and prey anatomy remain visible. The lower-seat error is the distance from that same piece of contacted flank to the mouth contract's grip point. The film strip advances the live match by 0.08 s per frame through gape, compression and release.",
  beforeParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  afterParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0", cfg_MARINE_BITE_SEAT: "1" },
  stageTimeoutMs: 360000,
  metrics: {
    surfaceToSeatM: { label: "Contacted surface error from authored lower-mouth seat", unit: "m", better: "lower" },
    surfaceBehindTeethM: { label: "Contacted surface carried deeper behind leading teeth", unit: "m", better: "higher" },
    toothPenetrationAtHitM: { label: "Tooth penetration at the actual hit edge", unit: "m", better: "lower" },
    surfaceStops: { label: "Mounted body-surface stops observed", better: "higher" },
    heldFrames: { label: "Frames the contacted surface stayed in the mouth", better: "higher" },
  },
  metricsNote:
    "surfaceToSeatM is the core invariant: it tracks the identical target-local material point from first contact, after all staging pins are gone. It should collapse to nearly zero. surfaceBehindTeethM proves the correction carries that surface deeper rather than merely stopping nearby. toothPenetrationAtHitM must stay within a tooth depth, while surfaceStops and heldFrames prove the movement and one-owner hold actually ran. Vertical seating is kept in debug geometry and the focused browser contract because world pitch can invert a naive world-Y comparison.",
  viewport: { width: 1280, height: 720 },
  readyExpression:
    "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && CBZ.surv && CBZ.bots && CBZ.cityMountedAnimalAttack && CBZ.citySeaHeightAt && document.getElementById('playBtn')",
  subjects,
  stage: stageSharkFlesh,
};
