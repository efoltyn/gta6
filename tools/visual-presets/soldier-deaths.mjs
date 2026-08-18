/* SOLDIERS DIE LIKE BODIES — the NPC War's men, before and after.

   The animals on this page got a real corpse solver a wave ago. The MEN
   standing next to them kept a plank: `group.rotation.x` eased to ninety
   degrees over four tenths of a second, one axis, the whole body rigid, the
   legs frozen mid-stride, every man in the army falling the same way.

   city/ragdoll.js has solved this properly since it shipped — 13 mass points,
   Jakobsen sticks, joint limits, ground friction, a whisper of bounce, written
   back onto the SAME rig meshes so the wounds and the dropped rifle ride along
   — and the only reason it never ran here is that it tested
   `CBZ.game.mode === "city"`. Thirteen points and a ground clamp have no
   opinion about which mode is running; that gate is now a capability the page
   opts into. (systems/quadruped_ragdoll.js, the animals' solver, is a copy of
   THIS file's method — the men were the ones left behind.)

   FLAG A/B, NOT A DEPLOY DIFF. Both sides are this same checkout; the only
   difference is `?death=old`, the page's own one-switch revert. STUDIO, NOT
   GALLERY: the war boots for real, the rAF clock is frozen, and the only time
   that passes is `__battle.advance(seconds)` through microboot's headless
   stepSim — so both columns photograph the same simulated seconds.

   `?blood=1` on both sides: a rifle war does not load the 2.5k-line gore pack
   by default (gunfx has drawn the men's impacts since it shipped), and this
   preset wants to show what a kill looks like when it does.
*/

const subjects = [
  {
    id: "first-bodies",
    label: "The first men down",
    run: 14,
    shot: { kind: "corpse", pick: "central", dist: 11, pitch: 0.26 },
    focus: "A body at eye level, seconds after it fell. Before: a rigid plank, rotated ninety degrees about one axis — arms, legs and spine all still in the pose he was walking in. After: 13 solved points. The limbs have gone where the ground and the round put them, the head has lolled off the shoulders, and the body is lying on whatever it landed on.",
    state: "FIRST CASUALTIES · t+14s",
  },
  {
    id: "a-body-close",
    label: "One body, close",
    run: 24,
    shot: { kind: "corpse", pick: "second", dist: 9, pitch: 0.22 },
    focus: "The same read on a second man, because one corpse could be luck — and because the plank's real tell is REPETITION. Every man in the before column fell into the same silhouette; no two in the after column did.",
    state: "SECOND BODY · t+24s",
  },
  {
    id: "the-ground",
    label: "The ground they fell on",
    run: 24,
    shot: { kind: "corpse", pick: "central", dist: 15, pitch: 0.80 },
    focus: "Looking down at the killing ground. Blood is priced off what actually killed the man — a shotgun mists and pools, a pistol round does not, a fist barely marks him — rather than one flat burst per death.",
    state: "BLOOD · PRICED BY THE ROUND",
  },
  {
    id: "the-field",
    label: "The field",
    run: 40,
    shot: { kind: "field", dist: 26, pitch: 0.50, yaw: 0.9 },
    focus: "The whole engagement. Read the silhouettes: a field of identical planks all lying at the same angle, against a field of bodies that each folded differently on the ground they happened to be standing on.",
    state: "40 MEN · t+40s",
  },
];

const readyExpression = "window.__battle && window.__battle.audit && window.__battle.audit().started";

async function stageSoldierDeaths(input) {
  const subject = input.subject;
  const B = window.__battle;
  const CBZ = window.CBZ;
  if (!B || !CBZ || !CBZ.camera) return { ok: false, missing: "__battle probe" };

  // FIRST SUBJECT OWNS THE CLOCK: subjects run in declaration order in one page
  // per side, so the war advances ONCE, monotonically. You cannot rewind a
  // battle, and re-running it per subject would make every shot a different war.
  if (!window.__soldierStage) {
    B.freeze();
    B.speed(1);
    window.__soldierStage = { at: 0 };
    // the subject is the bodies: the page's own chrome comes off, on BOTH
    // sides, by the same line. The result panel matters most — it is a
    // full-screen scrim the moment a war ends.
    const chrome = document.createElement("style");
    chrome.textContent =
      "#end,#top,#ctl,#who,#banner,#hint,#nflash,#menu,.sHud{display:none !important;opacity:0 !important}";
    document.head.appendChild(chrome);
    window.__cbzVisualCompare = window.__cbzVisualCompare || {};
    window.__cbzVisualCompare.render = function () { B.render(); };
    window.__cbzVisualCompare.advance = function (sec) { B.advance(sec, 1 / 60); B.render(); };
  }
  const st = window.__soldierStage;
  const want = Math.max(0, +subject.run || 0);
  if (want > st.at) { B.advance(want - st.at, 1 / 60); st.at = want; }

  const dead = B.corpsesOf(false).filter((c) => !c.beast);
  const shot = subject.shot || {};
  let mark = null;
  if (shot.kind === "corpse" && dead.length) {
    /* WHICH BODY. Not an index — the two sides fight different battles the
       moment the flag changes them, so the same index is a differently-placed
       man in each column. Both picks are defined by the SHAPE of the field
       (nearest to / furthest from the centre of the dead), which gives the two
       columns the same KIND of shot even when the body is a different man. */
    let cx = 0, cz = 0;
    for (let i = 0; i < dead.length; i++) { cx += dead[i].x; cz += dead[i].z; }
    cx /= dead.length; cz /= dead.length;
    /* Sorted by distance from the centre of the dead, and the picks are RANKS
       in that order — never "the furthest out". The outlier is by definition
       the man who died alone, which on a map with cover is regularly a body
       lying behind a berm: the first cut of this preset photographed an empty
       patch of sand on the after side for exactly that reason. Rank 0 and
       rank 1 are both in the middle of the fighting, which is where a body
       you can actually see is. */
    const ranked = dead.slice().sort((a, b) =>
      ((a.x - cx) ** 2 + (a.z - cz) ** 2) - ((b.x - cx) ** 2 + (b.z - cz) ** 2));
    mark = ranked[shot.pick === "second" ? Math.min(1, ranked.length - 1) : 0];
    B.lookAt({ x: mark.x, y: mark.y, z: mark.z, h: 0.6, yaw: 0.7 }, shot.dist, shot.pitch);
  } else {
    let cx = 0, cz = 0;
    for (let i = 0; i < dead.length; i++) { cx += dead[i].x; cz += dead[i].z; }
    if (dead.length) { cx /= dead.length; cz /= dead.length; }
    mark = { x: cx, y: 0, z: cz };
    B.lookAt({ x: cx, y: 0, z: cz, h: 1.2, yaw: shot.yaw }, shot.dist, shot.pitch);
  }
  // one frame for the camera arm to take the target it was handed, then draw.
  B.advance(1 / 60, 1 / 60);
  st.at += 1 / 60;
  B.render();

  const a = B.audit();
  const d = (a && a.dead) || {};
  const blood = (a && a.blood) || {};
  return {
    ok: true,
    stage: { simT: a && a.simT, mode: d.mode, corpses: a && a.corpses, mark },
    metrics: {
      plank: d.plank || 0,
      ragdoll: d.ragdoll || 0,
      bodies: d.men || 0,
      solving: (d.solver && d.solver.solving) || 0,
      bloodPools: blood.pools || 0,
    },
  };
}

export default {
  id: "soldier-deaths",
  title: "NPC War — the men fall like bodies, not like planks",
  description:
    "games/battle.html, twenty a side with mixed rifles, photographed against its own one-switch revert " +
    "(?death=old). Before: every man rotates ninety degrees about a single axis and lands in the same " +
    "silhouette with his legs still mid-stride. After: city/ragdoll.js solves each body — 13 points, " +
    "sticks and joint limits — and each one folds differently on the ground it was standing on, and " +
    "bleeds in proportion to what killed it.",
  page: "games/battle.html",
  defaultBefore: "local",
  beforeLabel: "BEFORE — ?death=old (this checkout, wave reverted)",
  afterLabel: "AFTER — this checkout",
  urlParams: {
    auto: 1, probe: 1, settle: 0, blood: 1,
    map: "arena", red: 20, blue: 20, rw: "mixed", bw: "mixed", rt: "elite", bt: "pro",
  },
  beforeParams: { death: "old" },
  viewport: { width: 1100, height: 700 },
  stageTimeoutMs: 180000,
  subjects,
  readyExpression,
  stage: stageSoldierDeaths,
  metricsNote:
    "Measured on the page's own probe (__battle.audit().dead) at the exact frozen moment each frame was " +
    "taken. `plank` is a body that resolved to the canned single-axis topple instead of the solver — the " +
    "whole point of the wave is that it reaches zero.",
  metrics: {
    plank: { label: "Bodies that fell as rigid planks", unit: "bodies", better: "lower" },
    ragdoll: { label: "Bodies solved as ragdolls", unit: "bodies", better: "higher" },
    bodies: { label: "Men on the ground", unit: "bodies", better: "higher" },
    solving: { label: "Bodies still folding", unit: "bodies", better: "higher" },
    bloodPools: { label: "Blood on the ground", unit: "pools", better: "higher" },
  },
};
