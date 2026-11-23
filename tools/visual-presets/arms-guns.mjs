/* Arms, and arms on a long gun, for ba.

   OWNER (2026-11-22): "Fix arms when holding long guns rn they contort
   unrealistically and also make arms look more real with muscles."

   The studio of people-anatomy.mjs (same boot, same wall, same lens), with
   bare-armed bodies standing, flexing, and holding the game's long guns
   through the game's own hold solve (CBZ.gunHold: low ready, shouldered,
   aimed up and down). */
import base from "./people-anatomy.mjs";

const M = (physique, skin, extra) => Object.assign({ build: "m", physique, skin, hair: 0x1a1410, hairStyle: "short" }, extra || {});
const F = (physique, skin, extra) => Object.assign({ build: "f", physique, skin, hair: 0x3a2416, hairStyle: "pony" }, extra || {});
const BODIES = [M("average", 0xd9a47a), M("athletic", 0x8a5a3a), M("muscular", 0xc08a5a), F("average", 0xe6b48c)];
const armed = (guns) => BODIES.map((b, i) => Object.assign({}, b, { gun: guns[i] }));
const GUNS = ["AK-47", "Shotgun", "Carbine", "Carbine"];
const GUNS2 = ["Sniper", "LMG", "SMG", "Shotgun"];

const subjects = [
  { id: "arms-front", label: "Bare arms: front", studio: true, view: "front", frame: "torso", fit: "gym", who: BODIES,
    focus: "Average, athletic and muscular men and a woman. The shoulder cap, the upper arm, the elbow, the forearm into the wrist." },
  { id: "arms-side", label: "Bare arms: side", studio: true, view: "side", frame: "torso", fit: "gym", who: BODIES,
    focus: "In profile: the bicep in front, the triceps behind, the forearm's belly below the elbow." },
  { id: "arms-back", label: "Bare arms: back", studio: true, view: "back", frame: "torso", fit: "gym", who: BODIES,
    focus: "From behind: the triceps and the elbow." },
  { id: "arms-flex", label: "Bare arms: bent", studio: true, view: "front", frame: "torso", fit: "gym", pose: "flex", who: BODIES,
    focus: "One arm out and bent up, one bent across: the joint closed, the muscle on the right side of the bend." },
  { id: "low-front", label: "Long gun, low ready: front", studio: true, view: "front", frame: "torso", fit: "gym", hold: "low", who: armed(GUNS),
    focus: "AK, shotgun, carbine, carbine carried muzzle down. Both hands on the gun, elbows bent the way elbows bend, shoulders in their sockets." },
  { id: "low-threeq", label: "Long gun, low ready: three-quarter", studio: true, view: "threeq", frame: "torso", fit: "gym", hold: "low", who: armed(GUNS),
    focus: "The same from 40 degrees." },
  { id: "low-side", label: "Long gun, low ready: support side", studio: true, view: "sidel", frame: "torso", fit: "gym", hold: "low", who: armed(GUNS),
    focus: "From the support-hand side." },
  { id: "aim-front", label: "Long gun, shouldered: front", studio: true, view: "front", frame: "torso", fit: "gym", hold: "aim", who: armed(GUNS),
    focus: "Stock in the shoulder, off hand under the handguard, the firing elbow down and out, not folded through the chest." },
  { id: "aim-threeq", label: "Long gun, shouldered: three-quarter", studio: true, view: "threeq", frame: "torso", fit: "gym", hold: "aim", who: armed(GUNS),
    focus: "The same from the firing side." },
  { id: "aim-threeql", label: "Long gun, shouldered: support side", studio: true, view: "threeql", frame: "torso", fit: "gym", hold: "aim", who: armed(GUNS),
    focus: "From the support side: the off arm's elbow and wrist." },
  { id: "aim-back", label: "Long gun, shouldered: from behind", studio: true, view: "back", frame: "torso", fit: "gym", hold: "aim", who: armed(GUNS),
    focus: "What the play camera sees." },
  { id: "aim-up", label: "Long gun, aimed up", studio: true, view: "threeq", frame: "torso", fit: "gym", hold: "up", who: armed(GUNS),
    focus: "Barrel 26 degrees up." },
  { id: "aim-down", label: "Long gun, aimed down", studio: true, view: "threeq", frame: "torso", fit: "gym", hold: "down", who: armed(GUNS),
    focus: "Barrel 26 degrees down (a tower guard)." },
  { id: "big-aim", label: "Sniper, LMG, SMG, shotgun: shouldered", studio: true, view: "threeq", frame: "torso", fit: "gym", hold: "aim", who: armed(GUNS2),
    focus: "The long and heavy guns." },
  { id: "big-low", label: "Sniper, LMG, SMG, shotgun: low ready", studio: true, view: "threeql", frame: "torso", fit: "gym", hold: "low", who: armed(GUNS2),
    focus: "The same carried." },
  { id: "dressed-aim", label: "Dressed: a guard, a cop, an inmate, a woman in a suit", studio: true, view: "threeq", frame: "torso", hold: "aim",
    who: [M("average", 0xd9a47a, { wear: "police", gun: "Shotgun" }), M("heavy", 0x8a5a3a, { wear: "police", gun: "Carbine" }), { build: "m", heritage: "latino", wear: "inmate", gun: "AK-47" }, F("average", 0xe6b48c, { wear: "suit", gun: "Carbine" })],
    focus: "In sleeves, as the games dress them." },
];

export default Object.assign({}, base, {
  id: "arms-guns",
  title: "Arms: muscle, and both hands on a long gun",
  description: "Bare arms on four bodies, and the same bodies holding the game's long guns through the game's own hold solve.",
  metrics: {},
  subjects,
});
