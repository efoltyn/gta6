/* Matched rendering-only A/B for the wildfire.

   Both sides run the rebuilt V2 simulation in this exact checkout. The sole
   variable is WILDFIRE_RENDER_V3: the old PointsMaterial squares + stacked
   cone crowns on the left, the pooled shader point sprites on the right.
   Seeded fire outcomes are declared `equal` invariants so a prettier frame
   cannot quietly change spread, spotting, scars, plume, or escape. */

import wildfire from "./wildfire-stages.mjs";

const moving = new Map([
  ["ignition", { frames: 3, stepSec: 0.14 }],
  ["front", { frames: 4, stepSec: 0.12 }],
  ["spotting", { frames: 4, stepSec: 0.14 }],
]);

export default {
  ...wildfire,
  id: "wildfire-rendering",
  title: "Wildfire Rendering — Squares to Volume",
  description: "Rendering-only flag A/B in one checkout: identical seeded wildfire, timeline, solved camera, weather, and simulation. Before uses the former untextured square smoke points and three stacked cone flame layers. After uses pooled ShaderMaterial point sprites with per-particle size, opacity, heat, and wind shaping; soft ground light; and irregular persistent scars.",
  pairNote: "Same checkout · V2 simulation · seed 90210 · solved camera · weather · timeline; rendering flag is the variable",
  method: "Every pair runs the same rebuilt wildfire simulation in the same checkout. WILDFIRE_RENDER_V3 is disabled only for BEFORE and enabled only for AFTER. Cameras are solved from the live seed/front/wind/victim/scar state, and the invariant table requires the gameplay outcomes to match.",
  beforeLabel: "BEFORE · SQUARES + CONES",
  afterLabel: "AFTER · GPU FIRE V3",
  defaultBefore: "local",
  beforeParams: { cfg_WILDFIRE_V2: 1, cfg_WILDFIRE_RENDER_V3: 0 },
  afterParams: { cfg_WILDFIRE_V2: 1, cfg_WILDFIRE_RENDER_V3: 1 },
  metricsWhitelist: true,
  metricsNote: "The renderer flag must not alter the seeded fire model: spread, spotting, escape field, plume, and scar rows are equality invariants. Casualty totals remain visible as diagnostics, but are not gated because the ambient cast moves during Survival's wall-clock startup. The V3-active row proves the intended renderer was exercised.",
  metrics: {
    renderV3: { label: "V3 renderer active", unit: "1=yes", better: "higher" },
    treesBurnt: { label: "Trees consumed", better: "equal" },
    fireRunM: { label: "Fire run from origin", unit: "m", better: "equal" },
    spotFires: { label: "Spot fires", better: "equal" },
    spotMaxM: { label: "Longest spot jump", unit: "m", better: "equal" },
    smokeDamage: { label: "Choke damage (ambient cast)", unit: "hp" },
    smokeDeaths: { label: "Smoke deaths (ambient cast)" },
    deaths: { label: "All deaths (ambient cast)" },
    escapeAngleDeg: { label: "Escape angle vs wind", unit: "°", better: "equal" },
    scarM2: { label: "Ground left black", unit: "m²", better: "equal" },
    smokeAheadM: { label: "Plume reach ahead", unit: "m", better: "equal" },
  },
  subjects: wildfire.subjects.map((subject) => ({
    ...subject,
    ...(moving.has(subject.id) ? { strip: moving.get(subject.id) } : {}),
  })),
};
