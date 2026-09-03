/* Gang City around the clock — the true-dark night, photographed.

   Three real places in the seeded city, eight beats of one day each, on a
   same-checkout flag A/B: BEFORE is ?cfg_NIGHT_TRUE_DARK=0 (the "blue night"
   that stayed fully legible with no lamp in sight), AFTER is the shared
   night-depth curve in core/lights.js. The lit street should still read by
   lamplight; the outskirts should go BLACK; the skyline should become windows
   and neon on nothing.

   Run:
     npm run ba -- time-of-day-city
     npm run ba -- time-of-day-city --subjects outskirts-midnight,street-midnight
*/
import { stageTimeOfDay, subjectsFor, METRICS, METRICS_NOTE } from "../lib/timeofday-stage.mjs";

const PLACES = [
  { place: "street", label: "Lit cross-street · under a real cobra head",
    focus: "The lamp pool and the car lights are allowed to be the only light here after dark; the asphalt between fixtures is not." },
  { place: "drive", label: "At the wheel · the same street from the driver's seat",
    focus: "The player is driving a real car. After dark the road ahead is lit by its own headlights and the lamps it passes, nothing else." },
  { place: "outskirts", label: "Outskirts · past the last avenue, no fixture in reach",
    focus: "Nothing man-made lights this ground. After astronomical dusk it should be a silhouette line against the sky and nothing else." },
  { place: "skyline", label: "Skyline · the whole grid from the south",
    focus: "By day a city; by night the windows, the ad boards and the lamp strings carry the shape of it on a black ground." },
];

export default {
  id: "time-of-day-city",
  title: "Gang City: a real night is black",
  description: "Three real places × eight beats of the clock. BEFORE keeps the film-blue night; AFTER lets the sky stop lighting the ground once the sun is 18° under, so only fixtures light the city after dark.",
  beforeLabel: "BEFORE · BLUE NIGHT",
  afterLabel: "AFTER · TRUE DARK",
  defaultBefore: "local",
  beforeParams: { cfg_NIGHT_TRUE_DARK: 0 },
  afterParams: { cfg_NIGHT_TRUE_DARK: 1 },
  viewport: { width: 1180, height: 700 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90326, cfg_BOOT_METER: 0 },
  stageTimeoutMs: 600000,
  pairNote: "Same checkout · seed · place · clock · quality · viewport · BEFORE camera reused by AFTER",
  method: "The registered Gang Life mode boots twice on one local checkout. Each plate pins CBZ.dayPhase to the beat, parks the player at the place so the real lamp pool and LOD bind there, settles 190 ticks, then locks the tripod and reads the framebuffer. Nothing is lit or dimmed by the stage.",
  metricsNote: METRICS_NOTE,
  metrics: METRICS,
  subjects: subjectsFor("city", PLACES),
  stage: stageTimeOfDay,
};
