/* BEAST DEATHS IN THE NPC WAR — the pose, the persistence, and the bite.

   OWNER, verbatim: "look at NPC war game and read code of beasts and how they
   currently bite and attack and how NPC war game shows dead beasts and sitting
   up on back and then they disappear. They should be real ragdoll and not
   disappear, and also real biting — look at blood from punching in the natural
   disaster game to see how biting blood might want to look, it's a good
   reference."

   Three claims, three sets of frames, one page: games/battle.html.

   IT IS A FLAG A/B, NOT A DEPLOY DIFF. Both sides are THIS checkout and the
   only difference is `?death=old`, the page's own one-switch revert for the
   whole wave (the canned rotation.z topple, the hard corpse FIFO, and bites
   that land at centre range and draw no blood). Nothing else can move between
   the two columns — no "well, forty other commits also changed".

   IT IS A STUDIO, NOT A GALLERY. The battle boots for real, then the rAF clock
   is FROZEN (`__battle.freeze()`) and the only time that passes is
   `__battle.advance(seconds)`, which runs the page's own frame through
   microboot's headless stepSim in fixed steps. So "eleven seconds into a war
   between ten lions and ten wolves" means the same eleven seconds on both
   sides, and the camera is parked on a body the page can point at rather than
   on wherever the director happened to swing.

   WHAT TO LOOK FOR, per subject, is in `focus`. The measurements underneath
   come from the page's own probe (__battle.audit()), so the pictures and the
   numbers describe the same frozen moment:

     noseUp     carcasses SITTING UP, nose at the sky — the reported pose. The
                whole wave exists to make this zero.
     noseWorst  the worst nose-height on the field, 0 = level, 1 = straight up.
     flank      carcasses lying on their side, which is what a dead animal does.
     ragdoll    deaths resolved by the 14-point verlet solver rather than by a
                canned rotation.
     bloodPools blood actually on the ground behind the bites.
     bitesLanded/bitesMissed  strikes that connected vs strikes whose jaws
                closed short — a bite ledger that never records a miss is the
                tell that damage is still landing at click range.
*/

const ROSTER = "map=arena&red=10&blue=10&ru=lion&bu=gray_wolf";

const subjects = [
  {
    id: "field-after-first-blood",
    label: "The field, eleven seconds in",
    run: 11,
    shot: { kind: "field", dist: 21, pitch: 0.42, yaw: 0.85 },
    focus: "The whole engagement from above. Count the carcasses that are SITTING UP with their heads in the air — that pose is the report. Then look at the ground for blood: a war fought entirely with teeth left none of it before.",
    state: "10 LIONS vs 10 WOLVES · t+11s",
  },
  {
    id: "carcass-close",
    label: "One carcass, close",
    run: 15,
    shot: { kind: "corpse", pick: "central", dist: 12, pitch: 0.30 },
    focus: "A single dead animal at eye level. Before: the body is hinged up onto its hindquarters with the nose pointing at the sky and the legs still in their walking pose, because the topple wrote model-local PITCH and called it roll. After: it is on its flank, the legs have splayed where gravity took them and the head has lolled — a 14-point verlet solve, not a rotation.",
    state: "CARCASS · EYE LEVEL",
  },
  {
    id: "carcass-second",
    label: "A second carcass",
    run: 15,
    shot: { kind: "corpse", pick: "outlying", dist: 10, pitch: 0.26 },
    focus: "The same read on a different body, because one corpse could be luck. Two animals killed seconds apart must not land in the same pose either — the solver's roll is seeded per body.",
    state: "CARCASS · SECOND BODY",
  },
  {
    id: "kill-ground",
    label: "The ground where they died",
    run: 15,
    shot: { kind: "corpse", pick: "central", dist: 15, pitch: 0.82 },
    focus: "Looking down at the killing ground. This is the bite blood: a directional spray thrown from the attacker's own jaw point along the bite line, staining the ground only where the skin was genuinely opened. The reference is the disaster island's beating blood (systems/trauma.js → CBZ.goreImpact) and it is the same call.",
    state: "BLOOD · FROM THE TEETH",
  },
  {
    id: "battlefield-late",
    label: "The battlefield, long after the fighting",
    run: 45,
    shot: { kind: "field", dist: 24, pitch: 0.55, yaw: 1.5 },
    focus: "Long after the fighting stopped. Every body that fell is still lying where it fell — the corpse budget now retires the oldest body OUT OF SHOT by sinking it, instead of deleting it from the world in front of you.",
    state: "AFTER THE WAR · t+45s",
  },
];

const readyExpression = "window.__battle && window.__battle.audit && window.__battle.audit().started";

async function stageBeastDeaths(input) {
  const subject = input.subject;
  const B = window.__battle;
  const CBZ = window.CBZ;
  if (!B || !CBZ || !CBZ.camera) return { ok: false, missing: "__battle probe" };

  // ---- FIRST SUBJECT OWNS THE CLOCK. Subjects run in declaration order in one
  // page per side, so the war is advanced ONCE, monotonically, and each subject
  // simply asks for the moment it wants. Re-running it per subject would fight
  // itself (you cannot rewind a battle) and would also make every later shot a
  // different war.
  if (!window.__beastStage) {
    B.freeze();
    B.speed(1);
    window.__beastStage = { at: 0 };
    /* THE SUBJECT IS THE BODIES, so the page's own chrome comes off. The
       scoreboard matters most: a ten-a-side war is over in about thirteen
       seconds and the result panel is a full-screen scrim — every frame after
       it appears was a photograph of a dimmed menu with a battlefield behind
       it. Hidden on BOTH sides by the same line, so nothing about the
       comparison is affected except being able to see it. */
    const chrome = document.createElement("style");
    chrome.textContent =
      "#end,#top,#ctl,#who,#banner,#hint,#nflash,#menu,.sHud{display:none !important;opacity:0 !important}";
    document.head.appendChild(chrome);
    // deterministic step: the same fixed dt on both sides, so the two columns
    // photograph the same simulated seconds and not the same wall seconds.
    window.__cbzVisualCompare = window.__cbzVisualCompare || {};
    window.__cbzVisualCompare.render = function () { B.render(); };
    window.__cbzVisualCompare.advance = function (sec) { B.advance(sec, 1 / 60); B.render(); };
  }
  const st = window.__beastStage;
  const want = Math.max(0, +subject.run || 0);
  if (want > st.at) { B.advance(want - st.at, 1 / 60); st.at = want; }

  // ---- the camera. A corpse shot is pointed at a BODY the page hands us; a
  // field shot is pointed at the centre of the dead, which is where the war
  // actually happened rather than where the map's origin is.
  const dead = B.corpsesOf(true);
  const shot = subject.shot || {};
  let mark = null;
  if (shot.kind === "corpse" && dead.length) {
    /* WHICH BODY. Not `dead[0]` — the two sides fight different battles the
       moment the flag changes them, so an index picks an arbitrary and
       differently-placed animal in each column and the composition stops being
       comparable. Both picks below are defined by the SHAPE of the field
       (nearest to / furthest from the centre of the dead), which is stable
       across two runs of the same war and gives the two columns the same kind
       of shot even when the corpse itself is a different animal. */
    let cx0 = 0, cz0 = 0;
    for (let i = 0; i < dead.length; i++) { cx0 += dead[i].x; cz0 += dead[i].z; }
    cx0 /= dead.length; cz0 /= dead.length;
    const far = shot.pick === "outlying";
    let best = null, bestD = far ? -1 : Infinity;
    for (let i = 0; i < dead.length; i++) {
      const d2 = (dead[i].x - cx0) ** 2 + (dead[i].z - cz0) ** 2;
      if (far ? d2 > bestD : d2 < bestD) { bestD = d2; best = dead[i]; }
    }
    mark = best || dead[0];
    // face the body from a fixed bearing so the two sides see the same side of
    // it; the pose is the subject, so the angle must not be a free variable.
    B.lookAt({ x: mark.x, y: mark.y, z: mark.z, h: (mark.h || 1) * 0.55, yaw: 0.7 },
      shot.dist, shot.pitch);
  } else {
    let cx = 0, cz = 0;
    for (let i = 0; i < dead.length; i++) { cx += dead[i].x; cz += dead[i].z; }
    if (dead.length) { cx /= dead.length; cz /= dead.length; }
    mark = { x: cx, y: 0, z: cz, h: 1 };
    B.lookAt({ x: cx, y: 0, z: cz, h: 1.2, yaw: shot.yaw }, shot.dist, shot.pitch);
  }
  // one frame for the camera arm to take the target it was just handed, then
  // draw. (camApply eases, and both targets were snapped by lookAt, so this is
  // a single step and not a settle.)
  B.advance(1 / 60, 1 / 60);
  st.at += 1 / 60;
  B.render();

  const a = B.audit();
  const d = (a && a.deaths) || {};
  const bites = (a && a.bites) || {};
  const blood = (a && a.blood) || {};
  return {
    ok: true,
    stage: {
      simT: a && a.simT,
      mode: a && a.deathMode,
      corpses: a && a.corpses,
      mark,
      camera: {
        x: CBZ.camera.position.x, y: CBZ.camera.position.y, z: CBZ.camera.position.z,
      },
    },
    metrics: {
      noseUp: d.noseUp || 0,
      noseWorst: d.noseWorst || 0,
      flank: d.flank || 0,
      ragdoll: d.ragdoll || 0,
      corpses: (a && a.corpses) || 0,
      bloodPools: blood.pools || 0,
      bitesLanded: bites.landed || 0,
      bitesMissed: bites.missed || 0,
    },
  };
}

export default {
  id: "beast-deaths",
  title: "NPC War — beast deaths, corpse persistence and the bite",
  description:
    "games/battle.html, ten lions against ten wolves, photographed against its own one-switch revert " +
    "(?death=old). Before: carcasses hinge up onto their hindquarters with their noses at the sky, the " +
    "corpse list deletes the oldest body where it lies, and a war fought entirely with teeth leaves no " +
    "blood at all. After: quadruped_ragdoll.js lays every body on its flank with its legs splayed, " +
    "retired carcasses sink out of shot instead of popping, and every bite that connects throws blood " +
    "from the attacker's own jaw.",
  page: "games/battle.html",
  defaultBefore: "local",
  beforeLabel: "BEFORE — ?death=old (this checkout, wave reverted)",
  afterLabel: "AFTER — this checkout",
  urlParams: Object.fromEntries(
    ROSTER.split("&").map((p) => p.split("=")).concat([["auto", "1"], ["probe", "1"], ["settle", "0"]])),
  beforeParams: { death: "old" },
  viewport: { width: 1100, height: 700 },
  stageTimeoutMs: 180000,
  subjects,
  readyExpression,
  stage: stageBeastDeaths,
  metricsNote:
    "Measured on the page's own probe (__battle.audit()) at the exact frozen moment each frame was " +
    "taken. `noseUp` is the reported pose — a carcass whose nose vector points at the sky — and " +
    "`noseWorst` is the worst of them on the field (0 = level, 1 = straight up).",
  metrics: {
    noseUp: { label: "Carcasses sitting up (nose at sky)", unit: "bodies", better: "lower" },
    noseWorst: { label: "Worst nose height on the field", unit: "0-1", better: "lower" },
    flank: { label: "Carcasses lying on their flank", unit: "bodies", better: "higher" },
    ragdoll: { label: "Deaths solved as ragdolls", unit: "bodies", better: "higher" },
    corpses: { label: "Bodies still on the field", unit: "bodies", better: "higher" },
    bloodPools: { label: "Blood on the ground", unit: "pools", better: "higher" },
    bitesLanded: { label: "Bites that connected", unit: "strikes", better: "higher" },
    bitesMissed: { label: "Bites whose jaws closed short", unit: "strikes", better: "higher" },
  },
};
