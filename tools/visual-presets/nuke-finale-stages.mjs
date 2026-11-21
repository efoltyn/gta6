/* tools/visual-presets/nuke-finale-stages.mjs — the survival island's nuclear
   finale as timed beats (it had no staged storyboard of its own). Same boot,
   clock and camera as disaster-sequence. */
import base from "./disaster-sequence.mjs";
const beats = (id, name, force, cam, secs) => secs.map((s, i) => ({
  id: `${id}-${i}`, hud: false,
  label: i === 0 ? `${name}: the warning` : `${name}: ${secs.slice(1, i + 1).reduce((a, b) => a + b, 0)} s in`,
  act: i === 0 ? { force, untilState: "warn", extraSecs: s } : i === 1 ? { untilState: "active", extraSecs: s } : { extraSecs: s },
  cam,
}));
export default Object.assign({}, base, {
  id: "nuke-finale-stages",
  title: "The nuclear finale",
  subjects: [
    ...beats("nuke", "The nuclear finale", "nuke", { x: 0, y: 60, z: 780, ax: 0, ay: 45, az: 600 }, [1.5, 1, 3, 6]),
  ],
});
