/* THE WATER ARENA — the NPC War's ocean, its marine roster, and the cameras
   built to watch one animal in it.

   OWNER, verbatim: "when done with all this it should improve NPC war too —
   add water arena and water animal options, that's a lightweight test arena
   too and great for animation, but gang city too and nat disaster should all
   have these sharks."

   This preset photographs the first two clauses of that sentence on the page
   they landed on, games/battle.html:

     · OPEN WATER — a venue with no ground in it. A real swell (three sine
       trains on deep-water dispersion, seeded off sWorld), a seabed at -46 m,
       one reef and wreck for scale, and nothing else: no city, no towers, no
       heightfield raycast. It is the cheapest map in the file on purpose.
     · THE MARINE ROSTER — every species the live bestiary declares aquatic,
       read out of CBZ.WILDLIFE_SPECIES rather than copied into a list here.
     · THE STUDY DESK — the cameras the brief actually asked for. A lens
       LOCKED on one animal at a range taken off that animal's own measured
       body length; a seat BELOW the swell looking up; a lens riding AT wave
       height. None of the three cuts, which is the whole point of a test bed.

   IT IS A FLAG A/B, NOT A DEPLOY DIFF. Both sides are THIS checkout and the
   only difference is `?swim=old`, the page's own one-switch revert for the
   whole water wave. That switch is documented in battle.html and restores,
   all at once:
     · NO SWIM RIG   — every aquatic body a rigid mesh sliding through the sea
                       with its jaw welded shut;
     · NO DEPTH      — every body pinned to the surface plane, so a shark and
                       a bait ball fight in two dimensions and "dive" is a word;
     · NO UNDERWATER CAMERA — the lens stops at the waterline, so the shot from
                       below does not exist and the fog above it never changes.
   Nothing else can move between the two columns.

   IT IS A STUDIO, NOT A GALLERY. The battle boots for real, the rAF clock is
   FROZEN (`__battle.freeze()`), and the only time that passes is
   `__battle.advance(seconds)` — the page's own frame through microboot's
   headless stepSim, in fixed 1/60 steps. Both sides therefore photograph the
   same simulated seconds and not the same wall seconds.

   AND IT IS FOUR MATCHUPS IN ONE PAGE. `__battle.restage()` clears the field
   and streams a new roster onto the SAME ocean — same swell, same reef — so
   the empty arena, the shark line-up, the orca pod and the bait ball are four
   shots of one place instead of four page loads that happen to all be blue.

   WHAT TO LOOK FOR is in each subject's `focus`. The measurements underneath
   come from the page's own probe (__battle.audit()) at the exact frozen moment
   the frame was taken:

     rigged     aquatic bodies carrying a swim rig. This is the one that
                matters: a shark with no rig is the rigid-mesh-sliding-through-
                the-ocean bug, and it is invisible in a still at the wrong
                moment. BEFORE is 0 by construction.
     deepest    the deepest body in the water, in metres. BEFORE is 0 — every
                body is pinned to the plane.
     camY       where the lens actually ended up. The underwater subject's
                whole claim is that this number is BELOW the surface, which
                the before side cannot do at all (the pitch clamp stops at
                +0.12 rad, so the arm can never get under its own focus).
     underwater the sea's own read of whether the camera is below the swell.
     podNeeded  city/marine_predation.js's prediction of how many hunters it
                takes, solved off the two time-to-kills rather than typed into
                a file. Stated next to the roster actually in the water, so the
                model gets to be wrong in public.
     megAlive   is the megalodon still up. The owner's argument — enough orcas
                beat a megalodon — is this number going to zero.
     ttff       navigation start to first frame, in ms. The venue's whole claim
                is that it is CHEAP, and a claim about cost nobody measured is
                a claim about nothing.
*/

const READY = "window.__battle && window.__battle.audit && window.__battle.audit().started";

/* THE STORYBOARD. Subjects run in declaration order in one page per side, and
   each one states the roster it needs; the stage restages only when the roster
   CHANGES, so the three orca-pod beats are three moments of one fight and not
   three fights. `run` is simulated seconds since that roster was staged —
   never wall seconds, and never a number that has to be re-derived when the
   sim changes speed, because the page is frozen and advanced by hand. */
const subjects = [
  {
    id: "arena-empty",
    label: "The arena, empty",
    roster: { id: "empty", ru: "orca", bu: "megalodon", rn: 0, bn: 0 },
    run: 2.5,
    /* THE REEF IS THE SUBJECT AND MUST NOT BE THE LENS CAP. Pointing the focus
       AT the pinnacle put the camera arm inside it: camApply shortens the arm
       until the line to the focus is clear, and a focus on a 46 m rock has no
       clear line at 150 m, so it snapped to 2.6 m and photographed one grey
       slab. The focus goes in the open water short of the reef and the bearing
       looks along the fight axis toward it (yaw = PI puts the lens on the -z
       side), so the pinnacle reads as scenery at scale instead of as a wall. */
    shot: { kind: "wide", dist: 170, pitch: 0.30, yaw: Math.PI, at: "approach" },
    focus:
      "The venue with nothing in it — which is the first thing a test bed has to be able to show. " +
      "Real swell (0.35-0.8 m at 40-95 m, deep-water dispersion), a horizon of ocean rather than the " +
      "inside of a sky dome, and one reef with a broken hull across its shoulder so the water has a " +
      "size. No land, no city, no towers: this map raises nothing on purpose.",
    state: "OPEN WATER · NOBODY IN IT",
  },
  {
    id: "lineup-phase-1",
    label: "The line-up — one great white, phase 1",
    roster: { id: "lineup", ru: "great_white_shark|hammerhead_shark|bull_shark|orca", rn: 8, bu: "sardine", bn: 120 },
    run: 8,
    shot: { kind: "study", species: "great_white_shark", yaw: 1.15 },
    focus:
      "THE TEST-BED SHOT. The STUDY camera locked on one great white at a range taken off THAT BODY'S " +
      "measured length, so the whole animal is in frame with room for the water it is moving through. " +
      "BEFORE: one rigid mesh translating through the sea — the tail does not beat, the jaw is welded " +
      "shut, and the body sits ON the surface plane. AFTER: the shared swim rig (buildSwimRig), the " +
      "same discovery pass the land gait uses, driving a real tail beat.",
    state: "GREAT WHITE · t+8.0s",
  },
  {
    id: "lineup-phase-2",
    label: "The line-up — phase 2",
    roster: { id: "lineup" },
    run: 8.3,
    shot: { kind: "study", species: "great_white_shark", yaw: 1.15 },
    focus:
      "The same animal, the same bearing, 0.30 s later. Two stills of one cycle: the tail should be " +
      "somewhere else. A still cannot show motion, so the only honest way to photograph an animation " +
      "is to photograph the same body twice from the same place and let the two frames disagree.",
    state: "GREAT WHITE · t+8.3s",
  },
  {
    id: "lineup-phase-3",
    label: "The line-up — phase 3",
    roster: { id: "lineup" },
    run: 8.6,
    shot: { kind: "study", species: "great_white_shark", yaw: 1.15 },
    focus:
      "A third point of the same cycle, 0.60 s from the first. Across the three the caudal fin should " +
      "sweep through a full beat and the body should yaw into it. On the before side all three frames " +
      "are the identical pose translated forward, which is exactly the bug.",
    state: "GREAT WHITE · t+8.6s",
  },
  {
    id: "lineup-under",
    label: "The line-up, from underneath",
    roster: { id: "lineup" },
    run: 10,
    shot: { kind: "under", species: "hammerhead_shark" },
    focus:
      "THE SEAT THAT DID NOT EXIST. Below the swell looking UP, the animal a silhouette against a lit " +
      "surface. This was not merely a shot nobody took: the camera arm clamped its pitch at +0.12 rad, " +
      "so the lens could never get below the thing it was pointing at, and the fog above the waterline " +
      "never changed. BEFORE is that clamp — a low shot from above the water. AFTER is under it, with " +
      "the sky dome off and the fog closed to 130 m of green-blue.",
    state: "HAMMERHEAD · FROM BELOW",
  },
  {
    id: "orca-pod-open",
    label: "8 orcas v 1 megalodon — the pod arrives",
    roster: { id: "orcas", ru: "orca", rn: 8, bu: "megalodon", bn: 1 },
    run: 7,
    shot: { kind: "study", species: "megalodon", yaw: 0.9, pull: 1.35 },
    focus:
      "The marquee matchup, one click from the war room. Eight orcas closing on one megalodon across " +
      "110 m of no-man's-land — measured, not guessed: closure in water is a straight line at the " +
      "animals' own charge speed, and an orca's works out at 6.7 m/s. Watch the SIZE difference; that " +
      "is what the reef is in this map for.",
    state: "8 ORCAS v MEGALODON · t+7s",
  },
  {
    id: "orca-pod-fight",
    label: "8 orcas v 1 megalodon — the mobbing",
    roster: { id: "orcas" },
    run: 24,
    shot: { kind: "study", species: "megalodon", yaw: 2.1, pull: 1.15 },
    focus:
      "Mid-fight. The pod should be AROUND the megalodon rather than queued behind it, and the bodies " +
      "should be at different depths — the whole argument is that numbers beat mass in three " +
      "dimensions. On the before side every body is on the same plane, so the same fight is a ring on " +
      "a sheet of glass.",
    state: "THE MOBBING · t+24s",
  },
  {
    id: "orca-pod-end",
    label: "8 orcas v 1 megalodon — the finish",
    roster: { id: "orcas" },
    run: 52,
    shot: { kind: "study", species: "megalodon", fallback: "orca", yaw: 3.4, pull: 1.2 },
    focus:
      "The end of it. `megAlive` underneath says whether the pod actually finished the job, and " +
      "`podNeeded` says how many the sea's own model predicted it would take — the page states the " +
      "prediction next to the roster that is genuinely in the water, so the model gets to be wrong in " +
      "public rather than in a comment.",
    state: "THE FINISH · t+52s",
  },
  {
    id: "bait-ball",
    label: "A great white in a bait ball",
    roster: { id: "bait", ru: "great_white_shark", rn: 1, bu: "sardine", bn: 400 },
    run: 16,
    shot: { kind: "under", species: "great_white_shark", pull: 1.6 },
    focus:
      "Four hundred sardines and one great white, photographed from under the ball. A shoal is not a " +
      "column — each side forms a golden-angle disc rather than the ranked grid a street fight uses — " +
      "and the shark has to CONVERGE on the fish's depth to reach them at all: a great white cruising " +
      "at 2.45 m and a sardine ball at 0.55 m would otherwise pass with two metres of clear water " +
      "between the teeth and the food, and every strike would be a miss the bite gate correctly " +
      "refused. BEFORE: one plane, no ball.",
    state: "BAIT BALL · 400 SARDINES",
  },
  {
    id: "sharks-swimmers",
    label: "Sharks v swimmers, at wave height",
    roster: { id: "swimmers", ru: "great_white_shark", rn: 4, bu: "men", bn: 30, bw: "fists", bt: "civ" },
    run: 18,
    shot: { kind: "wave", species: "great_white_shark" },
    focus:
      "THE LENS AT WAVE HEIGHT — y is the swell itself, read at the camera's own position, so crests " +
      "roll between you and the water and a dorsal fin cuts the frame at eye level. Four great whites " +
      "against thirty swimmers: a man in this map is a swimmer submerged to the shoulders and his " +
      "punch is worth a quarter of what it is on land, which is the honest answer to what a person can " +
      "do to a shark while treading water.",
    state: "4 GREAT WHITES v 30 SWIMMERS",
  },
];

async function stageWaterArena(input) {
  const subject = input.subject;
  const B = window.__battle;
  const CBZ = window.CBZ;
  if (!B || !CBZ || !CBZ.camera) return { ok: false, missing: "__battle probe" };

  /* THE FIRST SUBJECT OWNS THE CLOCK AND THE CHROME. Subjects run in
     declaration order in one page per side, so the world is set up once. */
  if (!window.__waterStage) {
    B.freeze();
    B.speed(1);
    window.__waterStage = { roster: null, at: 0 };
    // The subject is the WATER and the bodies in it, so the page's own chrome
    // comes off — on both sides, by the same line, so nothing about the
    // comparison changes except being able to see it.
    const chrome = document.createElement("style");
    chrome.textContent =
      "#end,#top,#ctl,#who,#banner,#hint,#nflash,#menu,.sHud{display:none !important;opacity:0 !important}";
    document.head.appendChild(chrome);
    window.__cbzVisualCompare = window.__cbzVisualCompare || {};
    window.__cbzVisualCompare.render = function () { B.render(); };
    window.__cbzVisualCompare.advance = function (sec) { B.advance(sec, 1 / 60); B.render(); };
  }
  const st = window.__waterStage;
  const R = subject.roster || {};

  // ---- the roster. Restage only when it CHANGES, so consecutive beats of one
  // fight stay one fight (you cannot rewind a battle, and re-staging it would
  // silently make every later shot a different war).
  if (R.id && R.id !== st.roster) {
    B.restage(R);
    st.roster = R.id;
    st.at = 0;
  }

  // ---- the clock. Monotonic within a roster; `run` is simulated seconds
  // since that roster was staged.
  const want = Math.max(0, +subject.run || 0);
  if (want > st.at) { B.advance(want - st.at, 1 / 60); st.at = want; }

  // ---- the camera. Every shot below is a posture the PAGE owns, driven
  // through its own seam (__battle.camMode), so a person pressing V and a tool
  // taking this photograph are running the identical code.
  const shot = subject.shot || {};
  let locked = null;
  if (shot.kind === "study" || shot.kind === "under" || shot.kind === "wave") {
    const mode = shot.kind === "wave" ? "surface" : shot.kind;
    locked = B.camMode(mode, shot.species, shot.yaw == null ? 0.9 : shot.yaw);
    // the named species may already be dead (that is the point of the finish
    // shot); fall back to whatever is still swimming rather than to nothing
    if (!locked && shot.fallback) locked = B.camMode(mode, shot.fallback, shot.yaw);
    if (!locked) locked = B.camMode(mode, 0, shot.yaw);
    /* A WIDER READ OF THE SAME LOCKED BODY, when the composition wants the pod
       around the megalodon rather than the megalodon alone. lookAt (not look):
       look() puts the focus on the GROUND under a point, which on this map is
       the swell — and the whole subject of an underwater shot is a body that is
       not at the surface. lookAt honours the body's own y. */
    if (locked && shot.pull) {
      B.lookAt({ x: locked.x, y: locked.y, z: locked.z, h: 0.4, yaw: shot.yaw == null ? 0.9 : shot.yaw },
        locked.range * shot.pull, mode === "under" ? -0.42 : 0.2);
    }
  } else {
    const a0 = B.audit();
    const c = (a0 && a0.centre) || [0, 0];
    // the reef sits off the fight axis at +96 m in z (see seaReef); framing it
    // is what gives the empty ocean a scale
    const at = shot.at === "approach" ? { x: c[0], z: c[1] + 30 } : { x: c[0], z: c[1] };
    B.look(shot.dist || 120, shot.pitch == null ? 0.3 : shot.pitch, shot.yaw, at);
  }

  // one frame for the arm to take the target it was handed, then draw
  B.advance(1 / 60, 1 / 60);
  st.at += 1 / 60;
  B.render();

  const a = B.audit();
  const sea = (a && a.sea) || {};
  const alive = (a && a.alive) || {};
  const cam = (a && a.cam) || {};
  const need = sea.podNeeded;
  return {
    ok: true,
    stage: {
      simT: a && a.simT,
      roster: st.roster,
      swimMode: a && a.swimMode,
      locked,
      camera: { x: CBZ.camera.position.x, y: CBZ.camera.position.y, z: CBZ.camera.position.z },
      alive,
    },
    metrics: {
      rigged: sea.rigged || 0,
      deepest: sea.deepest || 0,
      camY: Math.round((CBZ.camera.position.y || 0) * 100) / 100,
      underwater: sea.underwater ? 1 : 0,
      bodies: (a && a.men) || 0,
      beasts: (a && a.beasts) || 0,
      megAlive: alive.megalodon || 0,
      podNeeded: (need && (need.need || need.n)) || 0,
      surfaceY: sea.surfaceY || 0,
      fps: (a && a.fps) || 0,
      calls: (a && a.calls) || 0,
      ttff: (a && a.ttff) || 0,
    },
  };
}

export default {
  id: "water-arena",
  title: "NPC War — the open-water arena, the marine roster and the study cameras",
  description:
    "games/battle.html on its OPEN WATER map, photographed against its own one-switch revert " +
    "(?swim=old). Before: every aquatic body is a rigid mesh pinned to the surface plane with its jaw " +
    "welded shut, and the camera cannot get below the waterline at all. After: the shared swim rig " +
    "beats a real tail, bodies hold and converge on their own cruise depths, and the lens can sit " +
    "under the swell or ride on it. Four matchups on one ocean — the empty arena, a shark line-up " +
    "across its animation cycle, eight orcas against one megalodon, a bait ball and a shark against " +
    "swimmers.",
  page: "games/battle.html",
  defaultBefore: "local",
  beforeLabel: "BEFORE — ?swim=old (this checkout, water wave reverted)",
  afterLabel: "AFTER — this checkout",
  urlParams: {
    map: "water", ru: "orca", bu: "megalodon", red: "8", blue: "1",
    auto: "1", probe: "1", settle: "0", killcam: "0",
  },
  beforeParams: { swim: "old" },
  viewport: { width: 1180, height: 720 },
  stageTimeoutMs: 240000,
  subjects,
  readyExpression: READY,
  stage: stageWaterArena,
  metricsNote:
    "Measured on the page's own probe (__battle.audit()) at the exact frozen moment each frame was " +
    "taken. `rigged` is the claim that matters — aquatic bodies carrying a swim rig, 0 on the before " +
    "side by construction — and `camY` against `surfaceY` is whether the lens genuinely got under the " +
    "water. The kill cam is disabled for the run (?killcam=0): it changes the sim speed, and a " +
    "photograph taken during a directed beat is a photograph of the direction.",
  metrics: {
    rigged: { label: "Aquatic bodies with a swim rig", unit: "bodies", better: "higher" },
    deepest: { label: "Deepest body in the water", unit: "m", better: "higher" },
    camY: { label: "Camera height", unit: "m", better: "lower" },
    underwater: { label: "Lens below the swell", unit: "0/1", better: "higher" },
    bodies: { label: "Bodies staged", unit: "bodies", better: "higher" },
    beasts: { label: "Animals alive", unit: "bodies", better: "higher" },
    megAlive: { label: "Megalodon still alive", unit: "bodies", better: "lower" },
    podNeeded: { label: "Pod size the model predicts", unit: "hunters", better: "lower" },
    surfaceY: { label: "Swell height at the centre", unit: "m", better: "higher" },
    fps: { label: "Frame rate at the shot", unit: "fps", better: "higher" },
    calls: { label: "Draw calls", unit: "calls", better: "lower" },
    ttff: { label: "Navigation start to first frame", unit: "ms", better: "lower" },
  },
};
