/* PUNCH WEIGHT — what a fist is worth against the body it actually lands on.

   OWNER, verbatim: "consider how punches work... men's punches work the same
   against a man as against a girl. Gorilla and other animals now. One simple
   or a couple simple statistics could fix this."

   He is describing one line repeated in four files. Every melee site in this
   game reads a number off the ATTACKER and hands it to the target untouched —
   `hurtMan(tgt, m.punch * roll)` here, `attack.dmg` in the prison, `land(t,
   dmg, tier)` in the street — so a civilian's fist took the same bite out of a
   190 kg silverback as out of another man. That is not a difficulty setting;
   it is the one thing a punch is actually about.

   IT IS A FLAG A/B, NOT A DEPLOY DIFF. Both columns are THIS checkout and the
   only difference is `?mass=old`, the page's own one-switch revert for the
   wave (CBZ.CONFIG.BODY_MASS = false). Nothing else can move between them.

   WHY THIS MATCHUP AND NOT A GALLERY OF PUNCHES. Damage is a number and a
   number does not photograph. What photographs is the CONSEQUENCE: a hundred
   unarmed civilians against one silverback is the fight where the missing
   statistic did all its damage, because it let a fist be worth as much against
   two hundred kilos of gorilla as against the man standing next to it. So both
   columns run that war, from the same seed, frozen, and advanced to the same
   simulated second — and the picture is simply what is still standing.

   WHAT TO LOOK FOR is in each subject's `focus`. The numbers underneath come
   from the page's own probe at the same frozen moment, so the pictures and the
   measurements describe one frame:

     apes      silverbacks still alive. BEFORE this is 0 long before the war
               ends; AFTER it is 1 for most of the fight.
     red       men still standing out of a hundred.
     mass/soak what bodymass.js thinks the two bodies weigh and how much of a
               punch the gorilla's mass and hide absorb. Printed because the
               whole wave is two derived statistics and they should be legible
               rather than trusted.

   THE CONTROL IS THE POINT AS MUCH AS THE CHANGE. Man on man resolves to
   exactly 1.0 by construction, so a battle of riflemen is byte-identical with
   the flag either way — this preset can only move because the two bodies in it
   are genuinely different. If the BEFORE and AFTER columns ever agree here,
   the statistic stopped being applied.
*/

const ROSTER = "map=arena&red=100&blue=1&ru=men&bu=gorilla&rw=fists&rt=civ";

const subjects = [
  {
    id: "contact",
    label: "The ring closes",
    run: 16.5,
    focus:
      "The moment the crowd reaches the animal. Both columns should look broadly alike here — the " +
      "difference is not how the fight starts, it is what a fist is worth once it starts landing.",
    shot: { dist: 26, pitch: 0.5, yaw: 2.2 },
  },
  {
    id: "trading",
    label: "Four seconds of trading",
    run: 20.5,
    focus:
      "BEFORE: the silverback is already dead or on its last few points, because a hundred civilian " +
      "fists were each worth their full face value against it. AFTER: it is still up and there are " +
      "bodies on the ground around it — the same fists, the same men, a target that no longer " +
      "absorbs a punch like a 78 kg human.",
    shot: { dist: 22, pitch: 0.55, yaw: 2.2 },
  },
  {
    id: "result",
    label: "How it ends",
    run: 27,
    focus:
      "The outcome must NOT flip — a hundred men still win, and if this column ever shows a living " +
      "gorilla at the end the statistic has been overtuned into a different game. What changes is " +
      "the cost: the men left standing, and how much of the field is lying down.",
    shot: { dist: 34, pitch: 0.62, yaw: 2.2 },
  },
];

const readyExpression = "window.__battle && window.__battle.audit && window.__battle.audit().started";

async function stagePunchWeight(input) {
  const subject = input.subject;
  const B = window.__battle;
  const CBZ = window.CBZ;
  if (!B || !CBZ || !CBZ.camera) return { ok: false, missing: "__battle probe" };

  /* FIRST SUBJECT OWNS THE CLOCK. Subjects run in declaration order in one page
     per side, so the war is advanced ONCE, monotonically, and each subject asks
     for the moment it wants — you cannot rewind a battle, and re-running it per
     subject would make every later shot a different war. */
  if (!window.__punchStage) {
    B.freeze();
    B.speed(1);
    window.__punchStage = { at: 0 };
    // the subject is the field, so the page's chrome comes off — on BOTH sides
    // by the same line, so nothing about the comparison changes except being
    // able to see it. The result scrim matters most: it is full-screen.
    const chrome = document.createElement("style");
    chrome.textContent =
      "#end,#top,#ctl,#who,#banner,#hint,#nflash,#menu,.sHud{display:none !important;opacity:0 !important}";
    document.head.appendChild(chrome);
    window.__cbzVisualCompare = window.__cbzVisualCompare || {};
    window.__cbzVisualCompare.render = function () { B.render(); };
    window.__cbzVisualCompare.advance = function (sec) { B.advance(sec, 1 / 60); B.render(); };
  }
  const st = window.__punchStage;
  const want = Math.max(0, +subject.run || 0);
  if (want > st.at) { B.advance(want - st.at, 1 / 60); st.at = want; }

  /* THE CAMERA GOES WHERE THE ANIMAL IS — or, once it is dead, where it fell.
     Not the map centre and not the director's hotspot: the subject of every
     frame here is one body and the crowd on top of it, and a shot that drifts
     between the two columns is not a comparison. */
  const men = (B.roster && B.roster()) || [];
  let ape = null;
  for (let i = 0; i < men.length; i++) if (men[i].beast) { ape = men[i]; break; }
  const shot = subject.shot || {};
  const at = ape ? { x: ape.pos.x, y: 0, z: ape.pos.z } : { x: 0, y: 0, z: 0 };
  B.lookAt({ x: at.x, y: 0, z: at.z, h: 1.4, yaw: shot.yaw }, shot.dist, shot.pitch);

  // one frame for the camera arm to take the target it was handed, then draw
  B.advance(1 / 60, 1 / 60);
  st.at += 1 / 60;
  B.render();

  const a = B.audit();
  let man = null;
  for (let i = 0; i < men.length; i++) if (!men[i].beast && !men[i].dead) { man = men[i]; break; }
  const mass = (CBZ.bodyMass && ape && man)
    ? { man: Math.round(CBZ.bodyMass(man)), gorilla: Math.round(CBZ.bodyMass(ape)) } : null;
  const soak = (CBZ.meleeScale && ape && man)
    ? Math.round(CBZ.meleeScale(man, ape) * 100) / 100 : null;

  return {
    ok: true,
    stage: {
      simT: a && a.simT,
      apesAlive: a && a.beasts,
      menStanding: a && a.red,
      corpses: a && a.corpses,
      massOn: !!(CBZ.CONFIG && CBZ.CONFIG.BODY_MASS !== false),
      mass,
      // what a civilian's fist is worth against the animal, at this instant
      punchVsGorilla: soak,
    },
  };
}

export default {
  id: "punch-weight",
  title: "Punches weigh what the body they land on weighs",
  description:
    "games/battle.html, a hundred unarmed civilians against one silverback, photographed against the " +
    "page's own one-switch revert (?mass=old). BEFORE: every melee number in the game is read off the " +
    "attacker and handed to the target untouched, so a civilian fist is worth as much against 190 kg " +
    "of gorilla as against the man beside it and the animal is arithmetic'd down before it can fight. " +
    "AFTER: systems/bodymass.js makes the pair a ratio out of the anthropometric profile the rig " +
    "already carries and the species row's own scale — man on man stays exactly 1.0, so nothing that " +
    "exists moves, and only the mismatches start reading as mismatches.",
  page: "games/battle.html",
  defaultBefore: "local",
  beforeLabel: "BEFORE — ?mass=old (this checkout, wave reverted)",
  afterLabel: "AFTER — this checkout",
  urlParams: Object.fromEntries(
    ROSTER.split("&").map((p) => p.split("=")).concat([["auto", "1"], ["probe", "1"], ["settle", "0"]])),
  beforeParams: { mass: "old" },
  viewport: { width: 1100, height: 700 },
  stageTimeoutMs: 180000,
  subjects,
  readyExpression,
  stage: stagePunchWeight,
};
