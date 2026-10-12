"use strict";
/* src/battle/death.js — NPC War: A BEAST DIES + A MAN DIES.
   Split out of games/battle.html (docs/npcwar/ARCHITECTURE.md). Every
   src/battle file shares ONE script scope: top-level names here are visible
   to the other battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in. */

/* ============================================================ A BEAST DIES
   OWNER, on this page: "it shows dead beasts sitting up on back and then
   they disappear — they should be real ragdoll and not disappear."

   BOTH HALVES WERE ONE LINE EACH, AND BOTH WERE WRONG THE SAME WAY: they
   invented a death instead of asking the engine for one.

   SITTING UP. stepMan's dead branch eased `group.rotation.z` to ±1.45 rad
   with the comment "a four-legged body falls ONTO ITS SIDE — the roll axis
   is the honest one for a quadruped". The intent is right and the axis is
   not. Every animal asset is authored nose toward +X, THREE.Euler's default
   order 'XYZ' composes R = Rx·Ry·Rz, and Rz therefore applies FIRST, in
   model space — so rotation.z on one of these bodies is the model-local
   PITCH and +1.45 rad is a NOSE 83° INTO THE AIR. The page was not laying
   the animal down; it was sitting it up and pointing its head at the sky,
   which is the picture in the report, verbatim. (systems/predator_anim.js
   states the same rule in its r128 note; systems/quadruped_ragdoll.js's
   header quotes the owner's original complaint about it in the city.)

   So this page stops authoring deaths. quadruped_ragdoll.js is a real
   14-point verlet solver — legs that splay, a head that lolls, a body that
   drapes over the terrain it fell on and cannot come to rest on its feet —
   and it now rides in the `beasts` pack this page already loads. It is asked
   first, with the killing round's own direction and energy so the body goes
   over AWAY from what shot it. When it declines (a snake, a body past the
   range gate, the budget full) we fall through to CBZ.wildlifeDeathTumble
   when the mainland is loaded, and otherwise to the same tumble's shape
   inline — on rotation.order 'YXZ', where rotation.x IS the long-axis roll,
   which is the corrected version of the line this replaces. */
const _kdir = { x: 0, y: 0, z: 0 };
const _kpt = { x: 0, y: 0, z: 0 };
function beastDeathPhysics(m, imp) {
  const grp = m.group;
  if (!grp) return "none";
  if (DEATH_OLD) { m.dieT = 0.0001; return "topple"; }
  if (HOST.water && floatCorpse(m)) return "float";
  // WHICH WAY IT GOES OVER. A body does not fall over its own facing, it
  // falls away from whatever hit it: the way the killing blow pushed it if
  // that is known (a charge, a hull, a blast), the shooter's line if we have
  // one, the blast centre if we have that, else the way it was going.
  let dx = 0, dz = 0;
  const by = imp && imp.by;
  if (imp && (imp.dvx || imp.dvz)) { dx = imp.dvx; dz = imp.dvz; }
  else if (by && by.pos) { dx = m.pos.x - by.pos.x; dz = m.pos.z - by.pos.z; }
  else if (imp && imp.fromX != null) { dx = m.pos.x - imp.fromX; dz = m.pos.z - imp.fromZ; }
  const dl = Math.hypot(dx, dz);
  if (dl > 0.01) { dx /= dl; dz /= dl; }
  else { const a = lcg() * Math.PI * 2; dx = Math.cos(a); dz = Math.sin(a); }
  _kdir.x = dx; _kdir.y = 0; _kdir.z = dz;
  // the impact point: the shooter's side of the body, so the solver's roll
  // couple picks the flank the round actually crossed.
  _kpt.x = m.pos.x - dx * (m.rad || 0.5);
  _kpt.y = m.pos.y + (m.eyeH || 1) * 0.6;
  _kpt.z = m.pos.z - dz * (m.rad || 0.5);
  // ENERGY. A rocket throws a wolf; a pistol round folds it where it stands.
  // The solver's band is 1..30 (~6 a pistol, ~14 a shotgun, 20+ a blast).
  const cause = imp && imp.cause;
  let energy = cause === "bomb" ? 24 : (by && by.beast) ? 9 : 11;
  /* AND HOW HARD IS MOMENTUM, when the blow had any: the solver divides its
     kick by the square root of its own mass proxy (scale² x 1.7), so the
     speed the blow left the body with comes back out of it as that speed. A
     bull a tank hit at 12 m/s goes over hard; a rabbit a grenade lifted
     flies; a rifle round still folds an elk where it stands. */
  const dv = deathDv(m, imp);
  if (dv > 1) {
    const sc = (grp.scale && grp.scale.x > 0.05) ? grp.scale.x : 1;
    energy = Math.max(energy, Math.min(30, dv / 0.12) * Math.sqrt(Math.max(0.6, sc * sc * 1.7)));
  }
  if (CBZ.quadRagdoll) {
    try {
      if (CBZ.quadRagdoll(m, { point: _kpt, dir: _kdir, imp: energy })) {
        m.ragdoll = true; m.dieT = 0;      // the solver owns the transform now
        deadSolving++;
        return "ragdoll";
      }
    } catch (e) {}
  }
  if (CBZ.wildlifeDeathTumble) {
    try {
      if (CBZ.wildlifeDeathTumble(m, _kdir, 3.2 + energy * 0.28, _kpt)) {
        m.tumble = true; m.dieT = 0;
        return "tumble";
      }
    } catch (e) {}
  }
  // THE LAST RESORT, and the honest version of the line it replaces: roll
  // about the body's own long axis, which under 'YXZ' is rotation.x.
  grp.rotation.order = "YXZ";
  m.dieT = 0.0001;
  return "topple";
}

/* ============================================================ A MAN DIES
   The animals got a real corpse solver and the men standing next to them
   kept a plank: `group.rotation.x` eased to 90 degrees over 0.4s, one axis,
   the whole body rigid, the legs frozen mid-stride. city/ragdoll.js has
   solved this properly since it shipped — 13 mass points, Jakobsen sticks,
   joint limits, ground friction, a whisper of bounce, writing back onto the
   SAME rig meshes so the wounds and the blood soak ride along — and it
   refused to run here for one reason: it tested `game.mode === "city"`.
   That gate was never about the solver, and it is now a capability the page
   opts into (RAGDOLL_ANY_MODE, declared at the top of this file).

   Same shape as beastDeathPhysics: the killing round decides which way the
   body goes over, the solver is asked first, and the canned topple is what
   is left when it declines (budget full, too far, no rig). */
function manDeathPhysics(m, imp) {
  if (DEATH_OLD || !m.group || !m.char) { m.dieT = 0.0001; return "topple"; }
  if (HOST.water && floatCorpse(m)) return "float";
  let dx = 0, dz = 0;
  const by = imp && imp.by;
  if (imp && (imp.dvx || imp.dvz)) { dx = imp.dvx; dz = imp.dvz; }
  else if (by && by.pos) { dx = m.pos.x - by.pos.x; dz = m.pos.z - by.pos.z; }
  else if (imp && imp.fromX != null) { dx = m.pos.x - imp.fromX; dz = m.pos.z - imp.fromZ; }
  const dl = Math.hypot(dx, dz);
  if (dl > 0.01) { dx /= dl; dz /= dl; }
  else { const a = lcg() * Math.PI * 2; dx = Math.cos(a); dz = Math.sin(a); }
  _kdir.x = dx; _kdir.y = 0; _kdir.z = dz;
  // the entry point: chest height on the shooter's side, so the solver's
  // topple bias throws the high mass over AWAY from the gun.
  _kpt.x = m.pos.x - dx * 0.28;
  _kpt.y = m.pos.y + 1.28;
  _kpt.z = m.pos.z - dz * 0.28;
  /* HOW HARD. The solver's band is the human one it was tuned on: ~6 a
     pistol, ~14 a shotgun, 20+ a blast. A punch is not a bullet and must not
     throw a body across the street, which is exactly the read the survival
     brawl's own "land on real fist contact" wave was about. */
  const cause = imp && imp.cause;
  const w = (by && by.wid) ? CBZ.weaponById(by.wid) : null;
  let energy = 7;
  if (cause === "bomb") energy = 22;
  else if (by && by.beast) energy = 9;                    // teeth: a maul, not a round
  else if (by && by.fists) energy = 4;                    // a fist drops you where you stand
  else if (w) energy = w.pellets ? 15 : Math.max(5, Math.min(13, (w.damage || 20) * 0.35));
  // momentum, when the blow had any: the solver gives ~0.12 m/s per unit
  // (city/ragdoll.js kick), so a man a tank or a blast left at 9 m/s is
  // thrown at 9 m/s and not at a pistol's 0.5
  const dv = deathDv(m, imp);
  if (dv > 1) energy = Math.max(energy, Math.min(34, dv / 0.12));
  if (CBZ.cityRagdoll) {
    try {
      if (CBZ.cityRagdoll(m, _kpt, _kdir, energy)) {
        m.ragdoll = true; m.dieT = 0;      // the solver owns the transform now
        deadSolving++;
        manDeathGore(m, _kdir, energy);
        return "ragdoll";
      }
    } catch (e) {}
  }
  m.dieT = 0.0001;
  manDeathGore(m, _kdir, energy);
  return "topple";
}

/* AND HE BLEEDS — when this battle loaded the blood at all. `gore` rides in
   only when the roster earns it (a beast army, or ?blood=1), because 2.5k
   lines of it is a real cost and gunfx has drawn the men's impacts since it
   shipped. When it IS here, a kill is a kill: the same directional spray,
   mist and ground pool an animal's bite throws, priced off what killed him.
   Guarded end to end, so a battle without the pack is byte-identical. */
function manDeathGore(m, dir, energy) {
  if (typeof CBZ.goreImpact !== "function") return;
  const sev = Math.max(0.4, Math.min(1.8, energy * 0.09));
  _gore.dir = dir;
  _gore.amount = sev;
  _gore.mist = energy >= 13;            // only a real crunch atomises anything
  _gore.pool = energy >= 6;             // only an open wound stains the ground
  _gore.player = false;
  _gore.sfx = false;                    // gunfx already cracked; do not double it
  try { CBZ.goreImpact(m.pos.x, m.pos.y + 1.15, m.pos.z, _gore); } catch (e) {}
}
const _gore = { dir: null, amount: 0.8, mist: false, pool: true, player: false, sfx: false };

/* THE OLDEST BODY LEAVES THE FIELD — it is not deleted where it lies.

   `corpses` was a hard FIFO: past the cap the oldest was dropped from the
   scene in the same frame, so a carcass you were looking at vanished
   mid-shot. That is the second half of the report and it is not a budget
   problem, it is a PRESENTATION problem — the budget has to exist, but a
   body may not blink out in front of the camera. So the oldest corpse that
   is NOT the one you are looking at starts sinking through the ground and
   is dropped once it is genuinely out of sight. The list is walked from the
   oldest end for the first body far enough from the camera; if every corpse
   on the field is close (a small battle that has not filled the budget can
   never get here), the oldest goes anyway rather than let the list grow. */
const sinking = [];
const SINK_NEAR2 = 55 * 55;          // don't start a fade this close to the eye
function retireOldestCorpse() {
  if (DEATH_OLD) {                       // the FIFO that popped a body out of the world
    const gone = corpses.shift();
    if (!gone) return;
    const j = men.indexOf(gone);
    if (j >= 0) men.splice(j, 1);
    if (gone.group) STUDIO.drop(gone.group);
    return;
  }
  let pick = -1;
  for (let i = 0; i < corpses.length; i++) {
    if (camDist2(corpses[i].pos) > SINK_NEAR2) { pick = i; break; }
  }
  if (pick < 0) pick = 0;
  const old = corpses.splice(pick, 1)[0];
  if (!old) return;
  const k = men.indexOf(old);
  if (k >= 0) men.splice(k, 1);
  if (!old.group) return;
  // hand the solver its slot back before the body starts sinking, or a
  // frozen pose keeps a slot a live death could have used — and the solver
  // would go on writing this group's transform against the sink.
  if (old._wf) { try { old._wf.release(); } catch (e) {} old._wf = null; }
  if (CBZ.quadRagdollDrop) { try { CBZ.quadRagdollDrop(old); } catch (e) {} }
  if (CBZ.ragdollDrop) { try { CBZ.ragdollDrop(old); } catch (e) {} }
  if (old.ragdoll) { old.ragdoll = false; deadSolving = Math.max(0, deadSolving - 1); }
  /* BODIES AND WRECKS STAY. The budget is on LIVE rigs, not on the dead:
     the oldest corpse is baked where it lies (its last pose, its colours)
     into the ground's static remains batch (arenas/ground.js keepBody) and
     only its live rig leaves. Thousands of dead cost a handful of draws.
     ?remains=0 is the old sink. */
  if (Q.get("remains") !== "0" && CBZ.battleGround && CBZ.battleGround.keepBody) {
    let kept = false;
    try { kept = CBZ.battleGround.keepBody(old.group); } catch (e) { kept = false; }
    if (kept) { STUDIO.drop(old.group); return; }
  }
  sinking.push({ g: old.group, t: 0, h: Math.max(0.6, (old.eyeH || 1) * 1.4) });
}
// the sink itself: real time, because it is presentation and not simulation
// — a paused battle should still finish tidying up behind itself.
function stepSinking(dt) {
  for (let i = sinking.length - 1; i >= 0; i--) {
    const s = sinking[i];
    s.t += dt;
    s.g.position.y -= dt * s.h * 0.55;
    if (s.t > 2.2) { STUDIO.drop(s.g); sinking.splice(i, 1); }
  }
}

/* ============================================================ THE DEAD IN THE WATER
   On OPEN WATER a body that dies is not a ragdoll on a floor: the "floor"
   there is the swell, and a corpse rigidly lying ON a wave is a plank on a
   trampoline. It goes to world/water_float.js instead (the one float block
   every game's boats, wrecks and corpses ride), with its own buoyancy:

     a man          floats awash face down, waterlogs and goes under in ~40 s
                    (lungs: nearly neutral, slightly heavy)
     sharks         no swim bladder and no lungs: they sink straight away
     whales, orcas,
     dolphins,seals blubber: they float on their side and stay up
     other fish     the swim bladder: belly up at the surface
     land animals   lungs and fat: they float, and very slowly waterlog

   Returns false when the float block is not on the page (then the solver
   takes the body as before). */
const SINKERS = /shark|megalodon|ray|sawfish/;
const BLUBBER = /orca|whale|dolphin|porpoise|seal|sea_lion|walrus|manatee|dugong|otter/;
function floatCorpse(m) {
  if (!CBZ.waterFloat || !m.group) return false;
  // the float block asks three questions of the world; on this map the
  // answers are "everywhere", "the swell" and "the bed" (sea.js)
  if (!CBZ.cityWaterAt) CBZ.cityWaterAt = function () { return !!(HOST && HOST.water); };
  if (!CBZ.waterModeOn) CBZ.waterModeOn = function () { return !!(HOST && HOST.water); };
  if (!CBZ.cityWaterDepthAt) CBZ.cityWaterDepthAt = function () { return typeof SEA !== "undefined" && SEA.seabed != null ? -SEA.seabed : 14; };
  const id = (m.species && m.species.id) || "";
  let buoy = 1, log = 0, tilt = Math.PI / 2, ride = -0.1;
  if (!m.beast) { log = 0.02; }
  else if (SINKERS.test(id)) { buoy = 0.1; }
  else if (BLUBBER.test(id)) { buoy = 1.15; ride = -0.25; }
  else if (m.species && m.species.aquatic) { tilt = Math.PI; ride = -0.05; }
  else { log = 0.004; ride = -0.3; }
  let h = null;
  try {
    h = CBZ.waterFloat(m, { len: m.bodyL || 1.8, beam: Math.max(0.4, m.bodyW || 0.5), buoy: buoy, waterlog: log,
      ride: ride, baseTilt: tilt, keepDead: true, kind: "corpse",
      heading: m.beast ? function () { return -(m.heading || 0); } : null });
  } catch (e) { h = null; }
  if (!h) return false;
  m._wf = h;
  m.dieT = 0;
  return true;
}
