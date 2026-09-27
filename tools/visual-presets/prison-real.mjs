/* prison-real.mjs — THE CELL HOUSE, AS A STRANGER SEES IT IN THE FIRST
   MINUTE. Before/after for the 2026-09-27 "make it real" wave
   (world/prisonlook.js: lamp-lit wing + block/concrete surfaces; the
   stainless combi, soft bunks and steel stool in world/cellblock.js).

   Same staging machine as prison-product.mjs (its stage function is reused
   verbatim — act "view" is a plain pinned-hour lens; `bare` drops the title),
   so every frame is the shipped escape mode booted from its own title.

     ba prison-real --before <HEAD url> */
import product from "./prison-product.mjs";

const subjects = [
  { id: "cell-door", label: "Your cell, looking out", act: "view", bare: true, hour: 10,
    cam: { x: -11.7, y: 1.62, z: -41.6 }, aim: { x: -10.4, y: 1.35, z: -34 }, fov: 72,
    focus: "Spawn. The first thing you see: your bunk, the bars, the hall beyond." },
  { id: "cell-back", label: "Your cell, the back wall", act: "view", bare: true, hour: 10,
    cam: { x: -10.1, y: 1.66, z: -37.4 }, aim: { x: -11.9, y: 1.0, z: -42.6 }, fov: 72,
    focus: "Bunk, toilet, window: what a real cell is made of." },
  { id: "hall", label: "The cell house from the north landing", act: "view", bare: true, hour: 10,
    cam: { x: 0, y: 5.7, z: -36.3 }, aim: { x: 0, y: 1, z: -8 }, fov: 70,
    focus: "Two tiers, gallery rails, pendants off the trusses." },
  { id: "hall-eye", label: "The hall at eye height", act: "view", bare: true, hour: 10,
    cam: { x: 2.2, y: 1.6, z: -12.5 }, aim: { x: -2.5, y: 2.6, z: -38 }, fov: 68,
    focus: "Walking in from the yard door: floor, cell fronts, the tier over them." },
  { id: "lights-out", label: "Lights out", act: "view", bare: true, hour: 23.5, settle: 150,
    cam: { x: 0, y: 5.7, z: -36.3 }, aim: { x: 0, y: 1, z: -8 }, fov: 70,
    focus: "23:30. The pendants die, the night fittings burn blue." },
  { id: "fight", label: "A fight in the block", act: "fight", bare: true, hour: 10,
    focus: "Over the shoulder in the centre hall, the tier watching." },
];

export default {
  ...product,
  id: "prison-real",
  title: "Prison Escape — the cell house made real",
  description: "The first minute of Prison Escape: the player's cell, the two-tier hall by day and at lights out, and a fight in the block, before and after the lamp-lit wing and real materials.",
  beforeLabel: "BEFORE", afterLabel: "AFTER",
  pairNote: "Same seed, same hour, same lens; engine frames only",
  viewport: { width: 1280, height: 720 },
  subjects,
};
