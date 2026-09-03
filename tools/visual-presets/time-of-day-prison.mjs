/* The prison around the clock — the same true-dark night, in the yard.

   Escape mode has its own night machine (systems/prisonnight.js: floods at
   dusk, cell strips dying at lights-out, a rig floor) sitting ON TOP of the
   shared day cycle. This preset photographs the yard, a bare patch in it and
   the cell wing's outer wall through the same eight beats as the city, on the
   same flag A/B, so the two night machines can be seen agreeing.

   Run:
     npm run ba -- time-of-day-prison
*/
import { stageTimeOfDay, subjectsFor, METRICS, METRICS_NOTE } from "../lib/timeofday-stage.mjs";

const PLACES = [
  { place: "yard", label: "The yard from the wire",
    focus: "Flood masts and searchlight sweeps are the light; the concrete between them is the dark." },
  { place: "probe", label: "A bare patch in the yard · eye level",
    focus: "prisonnight's own audit probe stands here. What a man on the ground actually sees at each hour." },
  { place: "wing", label: "The cell wing · outer wall",
    focus: "Barred windows lit through the evening, dead at lights-out but for the night strips." },
];

export default {
  id: "time-of-day-prison",
  title: "Prison Escape: the yard goes black",
  description: "Three real places in the prison × eight beats of the clock, BEFORE (blue night) against AFTER (true dark).",
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
  method: "Escape mode boots twice on one local checkout. Each plate pins CBZ.dayPhase to the beat, parks the player at the place, settles 190 ticks (the prison's fixture rig runs on its own 0.2 s tick), locks the tripod and reads the framebuffer.",
  metricsNote: METRICS_NOTE,
  metrics: METRICS,
  subjects: subjectsFor("escape", PLACES),
  stage: stageTimeOfDay,
};
