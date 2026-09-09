/* Shark Sim — THE FACE'S WHITE, HEAD-ON. OWNER (2026-09-08), a great white
   photographed from ahead next to our title-card breach: "look how the white
   and gray on the front of the shark face is not a pointy thing; on our shark
   the white is pointy like a triangle on the face."

   On the animal the grey cap comes down OVER the nose to about the nostrils,
   and the boundary is a soft arch across the face, lowest at the corners of
   the mouth. Ours was a diamond with its apex at the eyes: the snout painted
   its countershading by ANGLE on rings that shrink to a nose a tenth of the
   weld's depth, and the nose tip was one fan of triangles all meeting at a
   point on the ridge — so every white triangle of the fan ran up to the tip.

   Same studio stage and part map as shark-face; the subjects are the closed
   head seen the ways the white line is seen, plus the owner's own angle (the
   breach on the title card: from above and ahead). The ruler reads the top
   of the white on the snout by ray, on the centre line and either side of
   it, as a share of the way from the mouth up to the eye — 100 is the eye.
     ba shark-countershade --before http://127.0.0.1:<HEAD worktree>/ */
import face from './shark-face.mjs';

const HERO = 'great_white_shark';
const subjects = [
  { id: 'cs-head-on', label: 'Great White — Closed, Head-On', species: HERO, open: 0,
    frame: 2.6, target: [2.40, 0.82, 0], cameraOffset: [8.5, 0.10, 0.05], whiteTop: true,
    focus: 'The reference angle. BEFORE: a white diamond, apex at the eyes, straight edges to the mouth corners. AFTER: grey over the nose, the white a low arch across the face that is lowest at the corners of the mouth.',
    state: 'REST · HEAD-ON', metric: 'An arch, not a diamond' },
  { id: 'cs-title-card', label: 'Great White — From Above and Ahead (the title card)', species: HERO, open: 0.55,
    frame: 3.0, target: [2.30, 0.75, 0], cameraOffset: [6.5, 4.2, 0.4], whiteTop: true,
    focus: 'The owner\'s screenshot: the breach seen from above and ahead, jaws parting. The top of the snout is grey down to the nose; the white begins under it.',
    state: 'BREACH · JAW 55%', metric: 'The nose is grey' },
  { id: 'cs-three-quarter', label: 'Great White — Closed, High Three-Quarter', species: HERO, open: 0,
    frame: 2.6, target: [2.30, 0.80, 0], cameraOffset: [3.2, 1.6, 4.6],
    focus: 'From above and to the side: the boundary runs from the corner of the mouth forward and a little up, and wraps around under the nose without a spike.',
    state: 'REST · HIGH VIEW', metric: 'The line wraps the nose' },
  { id: 'cs-profile', label: 'Great White — Closed, Profile', species: HERO, open: 0,
    frame: 2.65, target: [2.38, 0.76, 0], cameraOffset: [0.35, 0.30, 6.5],
    focus: 'In profile the line leaves the corner of the mouth low, runs forward under the eye and ends on the nose front below the tip, which is grey.',
    state: 'REST · PROFILE', metric: 'Grey nose tip' },
  { id: 'cs-low', label: 'Great White — Closed, Low Three-Quarter', species: HERO, open: 0,
    frame: 2.4, target: [2.30, 0.70, 0], cameraOffset: [2.6, -0.9, 4.6],
    focus: 'From below the underside of the snout is white to the jaw line, as before; nothing about the mouth changes.',
    state: 'REST · LOW VIEW', metric: 'Mouth unchanged' },
  { id: 'cs-gape-head-on', label: 'Great White — Full Gape, Head-On', species: HERO, open: 1,
    frame: 2.9, target: [2.45, 0.62, 0], cameraOffset: [8.5, 0.35, 0.05],
    focus: 'The open mouth is untouched: gum, teeth and the dark roof are as the last wave left them.',
    state: 'FULL GAPE · HEAD-ON', metric: 'Mouth unchanged' },
  { id: 'cs-bull-head-on', label: 'Bull Shark — Closed, Head-On', species: 'bull_shark', open: 0,
    frame: 2.4, target: [1.95, 0.85, 0], cameraOffset: [8.0, 0.10, 0.05], whiteTop: true,
    focus: 'The same shell paints every split-body shark; the bull gets the same arch.',
    state: 'REST · HEAD-ON', metric: 'Same grammar' },
  { id: 'cs-meg-head-on', label: 'Megalodon — Closed, Head-On', species: 'megalodon', open: 0,
    animal: [0, -1.6, 0], frame: 6.4, target: [3.6, -0.6, 0], cameraOffset: [14, 0.2, 0.05], whiteTop: true,
    focus: 'And the megalodon.',
    state: 'REST · HEAD-ON', metric: 'Same grammar' },
];

/* whiteTopPct — on the head-on frames: a column of rays down the picture at
   three screen x positions (centre, and a third of the head's half-width to
   either side); the first hit that is the rostrum's belly-white slot is the
   top of the white there. Reported as a share of the distance from the front
   of the mouth seam up to the eye, in the animal's own frame. */
async function stageCountershade(input) {
  const out = await stageFace(input);
  if (!out || !out.ok || !input.subject.whiteTop) return out;
  const T = window.THREE, studio = window.__cbzVisualCompare;
  const scene = studio && studio.scene;
  if (!scene || !studio.camera) return out;
  let animal = null;
  scene.traverse(function (o) { if (!animal && o._aquaticMouth) animal = o; });
  if (!animal) return out;
  animal.updateMatrixWorld(true);
  let rostrum = null, eye = null;
  animal.traverse(function (o) {
    if (!o.isMesh) return;
    if (!rostrum && o.name === 'sharkRostrum') rostrum = o;
    if (!eye && /eye/i.test(o.name || '')) eye = o;
  });
  const metrics = out.metrics || (out.metrics = {});
  const inv = new T.Matrix4().copy(animal.matrixWorld).invert();
  const eyeY = eye ? eye.getWorldPosition(new T.Vector3()).applyMatrix4(inv).y : null;
  const mo = animal._aquaticMouth, c = mo && mo.contract;
  const seamY = c && c.bite ? c.bite.y : null;
  const pr = new T.Raycaster();
  // where the head is on screen: project the rostrum's bounding sphere
  rostrum.geometry.computeBoundingSphere();
  const centre = rostrum.geometry.boundingSphere.center.clone().applyMatrix4(rostrum.matrixWorld).project(studio.camera);
  const edge = new T.Vector3(0, 0, 0).setFromMatrixPosition(rostrum.matrixWorld);
  const cx = (centre.x + 1) / 2;
  const r = (rostrum.geometry.boundingSphere.radius * (animal.scale.x || 1)) / (studio.camera.right - studio.camera.left);
  const cols = [cx, cx - r * 0.45, cx + r * 0.45];
  const tops = cols.map(function (sx) {
    for (let j = 0; j <= 200; j++) {
      const sy = 0.05 + (j / 200) * 0.9;
      pr.setFromCamera({ x: sx * 2 - 1, y: 1 - sy * 2 }, studio.camera);
      const hit = pr.intersectObject(animal, true);
      if (!hit.length) continue;
      const h = hit[0];
      if (h.object !== rostrum) continue;
      const mi = h.face && h.face.materialIndex != null ? h.face.materialIndex : -1;
      if (mi !== 1) continue;
      return h.point.clone().applyMatrix4(inv).y;
    }
    return null;
  });
  function pct(y) {
    if (y == null || eyeY == null || seamY == null || eyeY === seamY) return null;
    return Number((((y - seamY) / (eyeY - seamY)) * 100).toFixed(0));
  }
  metrics.whiteTopCentrePct = pct(tops[0]);
  const sides = tops.slice(1).filter(function (y) { return y != null; });
  metrics.whiteTopSidePct = sides.length ? pct(sides.reduce(function (a, b) { return a + b; }, 0) / sides.length) : null;
  metrics.whiteArchM = (tops[0] != null && sides.length)
    ? Number(((tops[0] - sides.reduce(function (a, b) { return a + b; }, 0) / sides.length) * (animal.scale.x || 1)).toFixed(3)) : null;
  void edge;
  return out;
}

export default {
  ...face,
  id: 'shark-countershade',
  title: 'The Face\'s White — an arch under a grey nose, not a diamond to the eyes',
  description: 'The great white photographed the way the owner\'s reference photographs it: closed, head-on, plus the title-card angle, the high and low three-quarters and the profile, and the bull shark and megalodon head-on for the shared shell. BEFORE is HEAD. AFTER paints the snout\'s countershading against a line in metres instead of an angle per shrinking ring, closes the nose as three courses instead of one fan of triangles to a point, lowers the line across the cheek to the corners of the mouth and puts it on the nose front below a grey tip.',
  beforeLabel: 'BEFORE · HEAD', afterLabel: 'AFTER · THE ARCH',
  subjects,
  stage: new Function('input',
    `const stageFace = (${face.stage.toString()});\n` +
    `return (${stageCountershade.toString()})(input);`),
  metrics: {
    ...(face.metrics || {}),
    whiteTopCentrePct: { label: 'Head-on: top of the white on the centre line, from the mouth (0) up to the eye (100)', unit: '%', better: 'lower' },
    whiteTopSidePct: { label: 'Head-on: top of the white a third of the way out to the cheek, mouth 0 → eye 100', unit: '%' },
    whiteArchM: { label: 'Head-on: centre top minus side top (+ = an arch, big + = a spike)', unit: 'm', better: 'lower' },
  },
  metricsNote: 'The reference photograph puts the crest of the white arch about 40% of the way from the mouth up to the eye, and the corners of the arch at the mouth corners. A centre reading near 100 is a white point at eye level: the diamond.',
};
