/* Shark Sim — THE FACE, HEAD-ON. The owner's reference is a sixteen-frame
   approach of a great white: a deep rounded snout, a wide low crescent of a
   mouth set INTO its underside, then the jaws drop as pink gum bands full of
   teeth around a dark interior. These frames photograph ours the same way:
   closed, half, full, from ahead and from below. Same studio stage and part
   map as shark-mouth-real; only the subjects differ.
     ba shark-face --before http://127.0.0.1:<HEAD worktree>/ */
import mouth from './shark-mouth-real.mjs';

const HERO = 'great_white_shark';
const subjects = [
  { id: 'face-closed-head-on', label: 'Great White — Closed, Head-On', species: HERO, open: 0,
    frame: 2.6, target: [2.40, 0.82, 0], cameraOffset: [8.5, 0.10, 0.05],
    focus: 'Reference frames 4-6: a domed snout, the mouth a low crescent set into its underside. Nothing pink, nothing dark, no teeth on a closed head.',
    state: 'REST · HEAD-ON', metric: 'A closed mouth is a crease' },
  { id: 'face-half-head-on', label: 'Great White — Opening, Head-On', species: HERO, open: 0.5,
    frame: 2.7, target: [2.40, 0.72, 0], cameraOffset: [8.5, 0.25, 0.05],
    focus: 'Reference frame 7: the jaws part, the upper gum band drops out of the snout with its teeth, the lower jaw drops as a U.',
    state: 'HALF · HEAD-ON', metric: 'Jaws out of the head, not a slot in it' },
  { id: 'face-gape-head-on', label: 'Great White — Full Gape, Head-On', species: HERO, open: 1,
    frame: 2.9, target: [2.45, 0.62, 0], cameraOffset: [8.5, 0.35, 0.05],
    focus: 'Reference frames 8-9: a wide oval of gum and teeth around a dark throat. No black bar under the lower teeth, no dark wedge at the nose.',
    state: 'FULL GAPE · HEAD-ON', metric: 'Tissue, teeth, dark' },
  { id: 'face-closed-low', label: 'Great White — Closed, Low Three-Quarter', species: HERO, open: 0,
    frame: 2.4, target: [2.30, 0.70, 0], cameraOffset: [2.6, -0.9, 4.6],
    focus: 'The closed mouth from below and ahead: the snout overhangs the jaw, the chin tucks under it, the mouth line runs back under the cheek.',
    state: 'REST · LOW VIEW', metric: 'No beak, no slot' },
  { id: 'face-closed-profile', label: 'Great White — Closed, Profile', species: HERO, open: 0,
    frame: 2.65, target: [2.38, 0.76, 0], cameraOffset: [0.35, 0.30, 6.5],
    focus: 'The mouth ends well behind the nose; the snout is deep to the jaw line.',
    state: 'REST · PROFILE', metric: 'Mouth behind the nose' },
  { id: 'face-gape-three-quarter', label: 'Great White — Full Gape, Three-Quarter', species: HERO, open: 1,
    frame: 2.85, target: [2.45, 0.60, 0], cameraOffset: [3.6, 0.9, 5.2],
    focus: 'The prey\'s view of the open mouth.', state: 'FULL GAPE · PREY VIEW', metric: 'Teeth in tissue' },
  { id: 'face-gape-parts', label: 'Great White — Full Gape, Head-On, Part Map', species: HERO, open: 1, parts: true,
    frame: 2.9, target: [2.45, 0.62, 0], cameraOffset: [8.5, 0.35, 0.05],
    focus: 'Same head-on gape, every mesh its own colour: what is standing under the lower teeth, by name.', state: 'FULL GAPE · PART MAP', metric: 'Names, not guesses' },
  { id: 'face-gape-probe', label: 'Great White — Full Gape, Head-On, Probe', species: HERO, open: 1,
    frame: 2.9, target: [2.45, 0.62, 0], cameraOffset: [8.5, 0.35, 0.05],
    probe: [[0.50, 0.68], [0.50, 0.70], [0.50, 0.72], [0.50, 0.74], [0.44, 0.69], [0.44, 0.71], [0.56, 0.69], [0.56, 0.71], [0.47, 0.73], [0.53, 0.73]],
    focus: 'Rays through the strip under the lower teeth: which mesh, which material group, and where in jaw space.', state: 'FULL GAPE · PROBE', metric: 'probe' },
  { id: 'face-closed-parts', label: 'Great White — Closed, Part Map', species: HERO, open: 0, parts: true,
    frame: 2.4, target: [2.30, 0.70, 0], cameraOffset: [2.6, -0.9, 4.6],
    focus: 'Same frame, every mesh its own colour.', state: 'REST · PART MAP', metric: 'Names, not guesses' },
];

export default {
  ...mouth,
  id: 'shark-face',
  title: 'The Face — a snout the mouth lives inside',
  description: 'The great white photographed the way the reference storyboard photographs it: head-on, closed, opening and open, plus the low and profile views of the closed mouth. BEFORE is HEAD; AFTER brings the snout\'s underside down to the jaw line so the mouth is inside the head, ends the mouth a quarter of a snout behind the nose instead of at it, paints the nose fan as skin instead of cavity, and makes the mouth floor tissue instead of a black bar.',
  beforeLabel: 'BEFORE · HEAD', afterLabel: 'AFTER · THE MOUTH INSIDE THE HEAD',
  subjects,
};
