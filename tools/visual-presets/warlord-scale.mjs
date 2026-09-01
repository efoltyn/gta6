/* DESERT WARLORD — FIVE HUNDRED MEN, AND WHETHER THEY ARE AN ARMY OR A CROWD.

   THE OWNER'S ASK, verbatim: "Multiplayer is way not dense enough add way way
   more total armies, and find max soldiers In a battle on this machine and then
   consider why and how to cheapen while improving and deepening logic not by
   simplifying."

   THE LAST CLAUSE IS THE WHOLE BRIEF AND IT IS WHAT THIS PRESET PHOTOGRAPHS.
   Making a battle cheaper by making the men dumber, fewer or lower-detail is
   the easy answer and it is the one that was refused. What changed instead is
   WHAT IS BEING SIMULATED: a section of ten men out of contact is now ONE agent
   with ten rigid slots hanging off it, not ten individuals who happen to share
   a number. One goal, one march, one obstacle probe, one contact test, ten slot
   writes — and out of that falls the thing the game did not have, which is a
   FORMATION.

   SO THE PICTURE IS THE PROOF. The saving and the depth are the same change,
   and if the change were only a saving these two columns would look identical:

     BEFORE (?squads=old&field=old) — ten men per section pathing individually
     at the same goal, separated by a crowd solver, arriving as a clump. That
     is what this game has always looked like when it moved.
     AFTER — sections in LINE under HOLD, in COLUMN under FLANK, in WEDGE under
     CHARGE. The four order buttons now change the silhouette of your army.

   THE FLAG REVERTS BOTH HALVES AT ONCE and that is deliberate: the height
   field (?field=old) is what made a sight line cheap enough for a section to
   test contact with, so a column that reverted one of them would be a build
   nobody ever shipped.

   WHAT IS NOT IN THE FLAG, and must not be, is the spawn frontage. Both
   columns draw their armies up the same way, because the old layout —
   ten men abreast and a new rank behind for every extra ten — put 480 of 500
   men in a 155 m queue, and an A/B where the two sides are fighting differently
   shaped battles measures nothing. MEASURED before that was fixed: 601 bodies
   fired 91 rounds in the first 45 seconds where 301 bodies fired 464. More men
   made the battle quieter.
*/

const subjects = [
  { id: "the-advance", label: "The advance, at 250 a side",
    focus: "TWO ARMIES CROSSING THE SAND UNDER HOLD. Neither side is in contact yet — the lines start 176 m apart and a section deploys at its own longest gun — so this is the beat where every man on the field is a formation slot. AFTER: sections abreast in line, each holding its own frontage, the army reading as a body of troops. BEFORE: the same five hundred men as five hundred independent pathfinders converging on one point, which the crowd solver then spends the whole advance pushing apart. `formed` is the number under the picture: it is how many men are currently a slot rather than an individual, and it is structurally zero on the before side.",
    at: 8, cam: { mode: "cmd", pitch: 0.30, yaw: 1.55 } },

  { id: "the-column", label: "FLANK — sections in column",
    focus: "THE ORDER CHANGES THE SHAPE. FLANK forms COLUMN: two files, narrow and fast, because a wing is a march past a front rather than into it. The wing is also the SECTION's now and not the man's — flankAnchor() used to hang the left/right choice off each man's own index, so half a squad could go left and half right, ten men splitting down the middle of their own unit. One wing per section is what makes a flank read as a wing.",
    at: 18, order: "flank", cam: { mode: "cmd", pitch: 0.36, yaw: 1.55 } },

  { id: "the-wedge", label: "CHARGE — sections in wedge",
    focus: "WEDGE, and the point of it is the man at the point. CHARGE forms a V with slot 0 at the tip and every step outward a step back, so the man who arrives first is the man who takes the fire — which is what a wedge IS. Compare to the before column, where CHARGE produced the same amorphous crowd as HOLD did, because there was no unit to have a shape.",
    at: 27, order: "charge", cam: { mode: "cmd", pitch: 0.33, yaw: 1.55 } },

  { id: "contact", label: "Contact — every man an individual again",
    focus: "AND HERE THE TWO COLUMNS MUST AGREE. Once a section is in contact it deploys and every man in it is exactly the man he was: stepMan, think(), combat_iq's posture, cover, shot ladder, morale — untouched, no second brain, no simplified enemy. `formed` falls to near zero on both sides and the two builds are running the identical fight. If this frame showed a difference in how the fight itself works, the saving would have been bought by making the game worse, which is the one thing that was not allowed.",
    at: 46, order: "hold", cam: { mode: "cmd", pitch: 0.40, yaw: 1.55 } },
];

async function stageWarlordScale(input) {
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.warlord) return { ok: false, err: "no CBZ.warlord" };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 250);
    }
    return false;
  };

  let S = window.__warlordScaleStudio;
  if (!S) {
    const up = await until(() => window.__warlordBattle && window.__warlordBattle.live &&
      window.__warlordBattle.live(), 900000);
    if (!up) return { ok: false, err: "battle never started" };
    const B = window.__warlordBattle;
    B.freeze();
    S = window.__warlordScaleStudio = { B: B, t: 0, last: null };
    window.__cbzVisualCompare = {
      render() { try { S.B.render(); } catch (_) {} },
      advance(sec) { try { S.B.advance(sec); S.t += sec; } catch (_) {} },
      metrics() { return S.last || {}; },
    };
  }
  const B = S.B;
  const subject = input.subject;

  if (subject.order) B.order(subject.order);
  const want = Math.max(0, (subject.at || 0) - S.t);
  /* THE ADVANCE STEP IS 1/30 AND THE MEASUREMENT STEP IS 1/60, for the same
     reason tools/warlord-scale-check.mjs splits them: battle.js sub-steps at
     0.055 s internally, so both are one sub-step and the integration is
     identical — only the wall-clock cost of getting there differs, and getting
     there under a software rasteriser at five hundred bodies is the expensive
     part of this preset. */
  if (want > 0) B.advance(want, 1 / 30), S.t += want;

  /* THE FRAME COST, MEASURED HERE RATHER THAN READ OFF a.fps. The rAF clock is
     frozen, so audit().fps is the frame rate of a page that is not running —
     it would report whatever it last saw before freeze() and be the same
     meaningless number in both columns. Twenty hand-driven simulated frames,
     median, is a statement about THIS build at THIS head count. */
  const t = [];
  for (let i = 0; i < 21; i++) {
    const a0 = performance.now();
    B.advance(1 / 60, 1 / 60);
    t.push(performance.now() - a0);
  }
  S.t += 21 / 60;
  t.sort((a, b) => a - b);

  const cam = subject.cam || { mode: "cmd" };
  B.camera(cam.mode);
  if (cam.mode === "cmd") B.look({ dist: cam.dist, pitch: cam.pitch, yaw: cam.yaw });
  B.render();

  let a = null;
  try { a = B.audit(); } catch (_) {}
  const sq = (a && a.squads) || {};
  S.last = {
    battleT: a ? a.simT : 0,
    bodies: a ? a.bodies : 0,
    formed: sq.formed || 0,
    unitsEngaged: sq.engaged || 0,
    simMs: Math.round(t[t.length >> 1] * 100) / 100,
    shots: a ? (a.mine.shots + a.them.shots) : 0,
    dead: a ? (a.mine.dead + a.them.dead) : 0,
    minePower: a ? a.mine.morale : 0,
    corpsesSolved: a ? a.solving : 0,
    relief: a ? a.field.relief : 0,
  };
  return { ok: true, metrics: S.last, simT: S.t };
}

export default {
  id: "warlord-scale",
  title: "Desert Warlord: Five Hundred Men, and Whether They Are an Army or a Crowd",
  description:
    "Both columns are this checkout, same seed, same 250-a-side rosters, same sand, same simulated seconds, with the rAF clock frozen so advance() is the only time that passes. The before column boots ?squads=old&field=old — battle.js's own reverts for the formation/relevance layer and the cached battlefield height field. The spawn frontage is deliberately NOT reverted, so both sides fight the same shaped battle and the only variable is whether a section is a unit.",
  page: "games/warlord.html",
  defaultBefore: "local",
  beforeParams: { squads: "old", field: "old" },
  beforeLabel: "BEFORE · every man an individual, every frame",
  afterLabel: "AFTER · sections as units out of contact",
  viewport: { width: 1180, height: 700 },
  /* 250 A SIDE, NOT 300 AND NOT 900. The shipped cap is what this preset is
     about, so it has to be at or above it, and every extra body is paid for
     twice under a software rasteriser (once in the before column and once in
     the after). 250 a side is 501 bodies — the shipped 300-a-side cap's own
     neighbourhood, comfortably past the 96-man skirmishes the campaign
     actually generates, and it finishes. The NUMBER lives in
     tools/warlord-scale-check.mjs, which measures head counts this preset
     could never photograph in a reasonable wall clock. */
  urlParams: { battle: 1, frozen: 1, mine: 250, them: 250, men: 250, seed: 1337,
    gun: "ak47", faction: "militia", myfaction: "legion", weather: "off", sound: "off" },
  readyExpression: "!!(window.CBZ && window.CBZ.warlord)",
  stageTimeoutMs: 1500000,
  pairNote: "Same checkout · seed · rosters · ground · frontage · cameras · simulated seconds — ?squads=old&field=old is the only variable",
  method:
    "games/warlord.html boots with ?battle=1&men=250, battle.js's own debug entry, at the shipped field cap's own scale. freeze() stops requestAnimationFrame and advance(sec, step) runs exactly that many seconds of the page's own frame() through microboot's headless stepSim, so both builds walk the identical simulated seconds whatever the rasteriser under them is doing. simMs is measured in the page across 21 hand-driven 1/60 s frames and reported as the median, because audit().fps is meaningless on a frozen clock. Orders go through W.battle.order(), the same call the four HUD buttons make; the cameras are battle.js's own command seat.",
  metricsNote:
    "formed is the number of men who are currently a formation slot rather than an individual — the whole saving in one integer, and structurally zero on the before column because the layer does not exist there. simMs is the median cost of one simulated frame at this beat: it is CPU-side and it transfers to a real machine, unlike anything involving the software rasteriser. shots and dead are there to prove the two columns are fighting the SAME battle and not a cheaper one — a formation layer that quietly stopped men from firing would show up here immediately.",
  metrics: {
    battleT: { label: "Simulated time at this beat", unit: "s" },
    bodies: { label: "Bodies on the field", unit: "men" },
    formed: { label: "Men held as formation slots", unit: "men", better: "higher" },
    unitsEngaged: { label: "Sections in contact", unit: "sections" },
    simMs: { label: "Cost of one simulated frame", unit: "ms", better: "lower" },
    shots: { label: "Rounds fired so far", unit: "rounds" },
    dead: { label: "Dead on both sides", unit: "men" },
    corpsesSolved: { label: "Corpses on the ragdoll solver", unit: "bodies" },
    relief: { label: "Ground relief across the field", unit: "m" },
  },
  subjects,
  stage: stageWarlordScale,
};
