/* Shark Sim — THE ORCA'S FACE. OWNER (2026-09-08), Frédérique Lucas's
   "Namu the Orca" head-on painting against ours: "our orca face is not good,
   it also has the white/black issue, white being pointy, and the orca just
   doesn't look as real as it can."

   What the painting has, head-on: a jet black dome over a broad white chin
   that is a wide, soft-cornered U; the black comes down over the whole melon
   and meets the white in a line that runs low across the face just above the
   mouth, curving up under the eyes; two white post-ocular patches like
   teardrops above and behind the eyes; a long mouth line running back past
   the eye. Same studio stage and part map as shark-face; the subjects are
   the orca's head seen the ways the painting sees it. The ruler is the same
   one as shark-countershade: the top of the white on the centre line and to
   either side, as a share of the way from the mouth up to the eye.
     ba orca-face --before http://127.0.0.1:<HEAD worktree>/ */
import cs from './shark-countershade.mjs';

const ORCA = 'orca';
const subjects = [
  { id: 'orca-head-on', label: 'Orca — Closed, Head-On', species: ORCA, open: 0,
    frame: 4.4, target: [4.2, 1.45, 0], cameraOffset: [12, 0.15, 0.05], whiteTop: true,
    focus: 'The painting\'s angle. Black dome over a wide white chin; the boundary a low line just above the mouth that curves up under the eyes; teardrop eye patches.',
    state: 'REST · HEAD-ON', metric: 'A wide white U, not a spike' },
  { id: 'orca-head-on-open', label: 'Orca — Opening, Head-On', species: ORCA, open: 0.5,
    frame: 4.6, target: [4.2, 1.30, 0], cameraOffset: [12, 0.35, 0.05],
    focus: 'The jaw drops: the white chin goes with it.',
    state: 'OPENING · HEAD-ON', metric: 'Chin is the jaw' },
  { id: 'orca-gape-head-on', label: 'Orca — Full Gape, Head-On', species: ORCA, open: 1,
    frame: 4.8, target: [4.2, 1.10, 0], cameraOffset: [12, 0.45, 0.05],
    focus: 'Reference frames 8-9: pink gums along both jaws with conical ivory teeth standing in them, a pink tongue on the floor, a ridged palate, black only down the throat.',
    state: 'FULL GAPE · HEAD-ON', metric: 'Tissue, teeth, throat' },
  { id: 'orca-gape-three-quarter', label: 'Orca — Full Gape, Low Three-Quarter', species: ORCA, open: 1,
    frame: 4.6, target: [3.9, 1.05, 0], cameraOffset: [4.6, -0.6, 7.0],
    focus: 'The prey\'s view of the open mouth: teeth in gum, tongue, throat.',
    state: 'FULL GAPE · PREY VIEW', metric: 'Teeth in gum' },
  { id: 'orca-gape-probe', label: 'Orca — Full Gape, Head-On, Probe', species: ORCA, open: 1,
    frame: 4.8, target: [4.2, 1.10, 0], cameraOffset: [12, 0.45, 0.05],
    probe: [[0.427, 0.618], [0.44, 0.612], [0.415, 0.625], [0.572, 0.618], [0.56, 0.612], [0.585, 0.625], [0.50, 0.62], [0.50, 0.60], [0.45, 0.60], [0.55, 0.60]],
    focus: 'Rays through the two red streaks either side of the chin tip: which mesh, which material group.',
    state: 'FULL GAPE · PROBE', metric: 'probe' },
  { id: 'orca-gape-parts', label: 'Orca — Full Gape, Head-On, Part Map', species: ORCA, open: 1, parts: true,
    frame: 4.8, target: [4.2, 1.10, 0], cameraOffset: [12, 0.45, 0.05],
    focus: 'Every mesh its own colour.', state: 'FULL GAPE · PART MAP', metric: 'Names, not guesses' },
  { id: 'orca-three-quarter', label: 'Orca — Closed, Three-Quarter', species: ORCA, open: 0,
    frame: 4.4, target: [3.9, 1.35, 0], cameraOffset: [5.0, 1.6, 7.0],
    focus: 'The eye patch above and behind the eye, the black cap, the white chin wrapping under the head.',
    state: 'REST · THREE-QUARTER', metric: 'Eye patch reads' },
  { id: 'orca-profile', label: 'Orca — Closed, Profile', species: ORCA, open: 0,
    frame: 4.8, target: [3.5, 1.40, 0], cameraOffset: [0.4, 0.4, 10],
    focus: 'The mouth line runs back past the eye; the white chin and throat under it; the flank flare behind the pectoral.',
    state: 'REST · PROFILE', metric: 'Mouth past the eye' },
  { id: 'orca-low', label: 'Orca — Closed, Low Three-Quarter', species: ORCA, open: 0,
    frame: 4.4, target: [3.9, 1.20, 0], cameraOffset: [4.5, -1.6, 7.0],
    focus: 'From below and ahead: the chin and throat are one white surface to the mouth line.',
    state: 'REST · LOW VIEW', metric: 'White chin, one piece' },
  { id: 'orca-parts', label: 'Orca — Closed, Head-On, Part Map', species: ORCA, open: 0, parts: true,
    frame: 4.4, target: [4.2, 1.45, 0], cameraOffset: [12, 0.15, 0.05],
    focus: 'Every mesh its own colour.', state: 'REST · PART MAP', metric: 'Names, not guesses' },
];

export default {
  ...cs,
  id: 'orca-face',
  title: 'The Orca\'s Face — a black dome over a wide white chin',
  description: 'The orca photographed the way the owner\'s reference painting sees it: head-on closed and opening, three-quarter, profile, low, and a part map. BEFORE is HEAD.',
  beforeLabel: 'BEFORE · HEAD', afterLabel: 'AFTER',
  readyExpression: 'window.THREE && window.CBZ && CBZ.buildSwimRig && CBZ.swimJaw && CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES.orca && CBZ.orcaBrain',
  subjects,
};
