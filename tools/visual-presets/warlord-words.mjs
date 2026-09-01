/* WARLORD WORDS — the five screens the player answers, before and after the
   words came off them.

   THE OWNER, 2026-09-01, playing Desert Warlord:

       "And I have to do way too much scrolling, I should almost never have to
        scroll in reality a ton of the word slop needs to be removed.
        Unnecessary 4th wall breaking words all over ux just too much talking
        of the ui."
       "SHOW DONT TELL for warlord ... as does a ton of the app"

   Three complaints, one cause. Every screen in this game had grown a layer of
   English on top of the picture it was already drawing: an odds bar with the
   odds written underneath it in a sentence, a stacked composition bar with the
   composition spelled out in a paragraph above it, four stat tiles under a
   casualty list that named the same men, a loyalty screen with a 372-character
   explanation of the loyalty formula printed under the three tiles that
   measure it. None of it was wrong. All of it was second.

   WHAT THIS PRESET PHOTOGRAPHS. The five screens a warlord actually answers
   over and over in a run — the meeting rail, the roster behind INSPECT, the
   aftermath, an event card, and the armoury — staged identically on both
   sides through the game's own public calls. Not a mock: W.army.encounter,
   W.army.aftermath with the same plain report object battle.js hands over,
   W.events.fire, W.loadout.open.

   THE A/B IS TWO CHECKOUTS, NOT A FLAG. This wave is flagless — git is the
   undo — so the BEFORE column is a worktree pinned to a901daf served on its
   own port:

       git worktree add --detach /tmp/wl-before a901daf
       (cd /tmp/wl-before && PORT=8770 python3 tools/devserver.py &)
       ba --preset warlord-words --before http://127.0.0.1:8770/ --no-open --gate

   PIN THE SHA, NEVER SAY "HEAD~1". Four other agents were committing to this
   repo while this wave was written; a run that resolves its own baseline at
   capture time will happily photograph somebody else's work as the before.
   a901daf is the commit this file's territory was untouched at, verified with
   `git diff a901daf..HEAD -- src/warlord/army.js …` coming back empty.

   THE NUMBERS. uiChars is this repo's hudTextChars convention — the rendered,
   whitespace-stripped text the player has to read on that screen right now,
   measured off innerText so a collapsed section does not count against a
   screen that is not showing it. belowFoldPx is the other half and the one
   the owner actually complained about: how far the screen's own scroller
   runs past its box. A screen can lose half its characters and still not
   fit, and it can fit while still being a wall of prose; both numbers or
   neither. controls is a guard rail — a screen that got shorter by deleting
   a button did not get better, and this catches it.

   The phone frame is not optional. A screen that does not fit hurts on a
   phone and nowhere else, and every one of these five was between 26 and
   3 331 px past the fold on an iPhone at the start of this wave. */

/* ---- ONE STAGING PATH, RUN ON BOTH CHECKOUTS ---------------------------
   Every line of this is a call the game already exports. The before side is
   four months of a different UI behind the same five function names, which is
   the entire reason the comparison is honest. */
const SUBJECTS = [
  {
    id: "encounter",
    label: "The meeting — 210 men riding at you",
    focus:
      "THE SCREEN SEEN MOST OFTEN IN THE GAME, and therefore the one that earns the fewest words. Before: a split " +
      "power bar, then the odds written out as a number AND an English verdict, then a caption THEIR MEN over a " +
      "stacked bar, then a caption CARRYING over a row of chips that each already read '14 AK-47', plus a line " +
      "explaining the ROB button that only appears when robbing is possible. After: the bars, the chips, and the " +
      "odds moved onto the ATTACK button — which is also now BLOOD RED when the odds are bad, so the control you " +
      "are about to press is itself the warning.",
  },
  {
    id: "inspect",
    label: "INSPECT — every stack in the company",
    focus:
      "THE WORST SCROLL IN THE GAME: 2 053 px of content in a 667 px box on an iPhone SE. It opened with a prose " +
      "card describing the same grouping the table under it drew ('120 soldiers with ak-47s (+6 other guns), …'), " +
      "then one full-width 34 px row per stack. After: the same stacked bar the rail uses, so the screen you tapped " +
      "from and the screen you landed on are one picture at two zooms, and the stacks as wrapped chips with the " +
      "tier carried by the left edge's colour.",
  },
  {
    id: "aftermath",
    label: "The aftermath — 9 dead, 14 prisoners",
    focus:
      "THE PAYOFF, and the screen where the telling was thickest: four stat tiles, then a titled section for the " +
      "dead, a titled section for the wounded ('THEY FIGHT AT 60% UNTIL THEY REST'), a titled section for the men " +
      "who ran ('BROKE AND RAN — THEY CAME BACK'), a loot table printing each gun's worth beside it, a CARD PER " +
      "PRISONER with four buttons in it, and a 250-character paragraph explaining what executing them does. Look " +
      "for two casualty bars carrying six numbers where four tiles carried four, and the prisoner decision as four " +
      "bulk verbs with their own prices on them.",
  },
  {
    id: "event-card",
    label: "An event card — the wounded rival",
    focus:
      "AN EVENT IS A HEADLINE, PROSE AND TWO OR THREE BUTTONS, and the prose is the game's actual writing — it is " +
      "not what got cut. What got cut is the third sentence, which was always either the card reading its own menu " +
      "aloud or a consequence that is already a meter, and the hints, which said 'you do not have $520' on a " +
      "button that is disabled and dimmed beside a gold counter. Nine choices carried the caption 'nothing " +
      "changes'.",
  },
  {
    id: "armoury",
    label: "The armoury — who carries what",
    focus:
      "A SUBTITLE READING 'WHO CARRIES WHAT' under a heading reading THE ARMOURY, a caption reading 'the cart and " +
      "their hands, best gun to best man' under a button reading AUTO-ARM EVERYONE, and a report card that " +
      "finished with '9 men have nothing but their hands — buy guns at a depot.' Look for the armed bar, which is " +
      "that last sentence drawn.",
  },
];

async function stageWords(input) {
  /* HARNESS TRAP: `stage` is serialised into the page ON ITS OWN. A module
     scope helper — even a one-line `const sleep` sitting directly above this
     function — is NOT sent with it, and the failure is a ReferenceError inside
     the browser that ba reports as a failed subject rather than as a preset
     bug, which reads like the game broke. Every helper this function needs
     lives inside it. */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const W = window.CBZ && window.CBZ.warlord;
  if (!W) return { ok: false, error: "CBZ.warlord missing" };
  const id = input.subject.id;

  /* ONE BOOT, FIVE SUBJECTS, AND A REAL RESET BETWEEN THEM. The island costs
     ~9 s to raise and there are five subjects × two columns × two frames, so
     the page is booted once and re-seeded per subject rather than reloaded.
     newGame(seed) and not "top the roster up": the aftermath buries nine men,
     banks the loot and fills the prison, so a subject that merely added to
     whatever was left would photograph a different army than its pair on the
     other column — the pairs are the whole point of this file. */
  if (W.events && W.events.cardOpen && W.events.cardOpen()) W.events.close();
  if (W.territory && W.territory.isOpen && W.territory.isOpen()) W.territory.toggle();
  W.newGame({ seed: 1337 });
  if (W.campaign && W.campaign.enter) W.campaign.enter();
  await sleep(400);

  const stageColumn = function (n) {
    for (let i = W.state.army.length; i < n; i++) {
      W.addSoldier(W.makeSoldier(
        i % 7 === 0 ? "veteran" : i % 3 === 0 ? "soldier" : "levy",
        i % 2 ? "carbine" : "ak47"));
    }
    W.state.gold = 900;
  };

  if (id === "encounter" || id === "inspect") {
    stageColumn(24);
    const b = W.makeBand({ size: 210, faction: "merc", x: W.state.you.x + 30, z: W.state.you.z + 30 });
    W.state.bands.push(b);
    W.army.encounter(b);
    await sleep(220);
    if (id === "inspect") {
      /* BY LABEL, NOT BY INDEX. HIRE and ROB come and go with the band's
         faction and the power ratio, so the INSPECT verb is not at a fixed
         position — and it is at a DIFFERENT position on the two columns. */
      const btn = Array.prototype.slice.call(document.querySelectorAll("#verbs .vbtn"))
        .filter(function (n) { return /INSPECT/.test(n.textContent); })[0];
      if (!btn) return { ok: false, error: "no INSPECT verb on the rail" };
      btn.click();
      await sleep(260);
    }
  } else if (id === "aftermath") {
    stageColumn(40);
    W.state.prisoners.length = 0;
    const band = W.makeBand({ size: 60, faction: "bandit", x: W.state.you.x + 40, z: W.state.you.z });
    const mine = W.state.army.slice();
    const theirDead = band.men.slice(0, 31);
    const loot = {}, armourLoot = {};
    for (let i = 0; i < theirDead.length; i++) {
      const s = theirDead[i];
      if (s.wid) loot[s.wid] = (loot[s.wid] || 0) + 1;
      if (s.armour && s.armour !== "none") armourLoot[s.armour] = (armourLoot[s.armour] || 0) + 1;
    }
    W.army.aftermath({
      band: band, outcome: "won", duration: 84, ratio: 1.4, youKills: 6, gold: 420,
      yourDead: mine.slice(0, 9), yourSurvivors: mine.slice(9), yourFled: mine.slice(9, 13),
      theirDead: theirDead, theirSurvivors: band.men.slice(31, 45),
      loot: loot, armourLoot: armourLoot,
    });
    await sleep(300);
  } else if (id === "event-card") {
    stageColumn(34);
    W.state.fame = 58;
    if (!W.events || !W.events.fire) return { ok: false, error: "events.js missing" };
    W.events.fire("rival");
    await sleep(320);
  } else if (id === "armoury") {
    stageColumn(24);
    if (!W.loadout || !W.loadout.open) return { ok: false, error: "loadout.js missing" };
    W.loadout.open();
    await sleep(300);
  }

  await sleep(240);

  /* ---- THE NUMBERS, taken in the page, identically on both columns ----
     Inline rather than a shared helper because `stage` is serialised into
     each side separately: a helper that lived outside it would have to be
     serialised too, and the day one column got a stale copy is the day the
     comparison quietly stops being one. */
  let uiChars = 0;
  const surf = [];
  const st = document.getElementById("stage");
  if (st && getComputedStyle(st).display !== "none") surf.push(st);
  const vb = document.getElementById("verbs");
  if (vb && getComputedStyle(vb).display !== "none") surf.push(vb);
  const hd = document.getElementById("hud");
  if (hd && getComputedStyle(hd).display !== "none") surf.push(hd);
  for (let i = 0; i < surf.length; i++) {
    uiChars += (surf[i].innerText || "").replace(/\s+/g, "").length;
  }

  let belowFoldPx = 0;
  ["stage", "vBody"].forEach(function (nid) {
    const n = document.getElementById(nid);
    if (!n || getComputedStyle(n).display === "none") return;
    const r = n.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    belowFoldPx = Math.max(belowFoldPx, Math.max(0, n.scrollHeight - n.clientHeight));
  });

  let controls = 0;
  const nodes = document.querySelectorAll("#stage button, #verbs .vbtn, #verbs .vtoggle");
  for (let i = 0; i < nodes.length; i++) {
    const cs = getComputedStyle(nodes[i]);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    controls++;
  }

  return {
    ok: true,
    subject: id,
    frame: input.frame ? input.frame.id : null,
    metrics: { uiChars: uiChars, belowFoldPx: belowFoldPx, controls: controls },
  };
}

export default {
  id: "warlord-words",
  title: "Desert Warlord: the screens stopped talking",
  page: "games/warlord.html",
  description:
    "Five screens a warlord answers over and over — the meeting rail, the roster behind INSPECT, the aftermath, an " +
    "event card and the armoury — before and after the wave that deleted the copy narrating pictures the screen was " +
    "already drawing, and made every one of them fit without scrolling. BEFORE is a901daf served from its own " +
    "worktree; AFTER is this tree. Same seed, same island, same staging calls, same device frames.",
  beforeLabel: "BEFORE · a901daf",
  afterLabel: "AFTER · fewer words, no fold",
  urlParams: { go: 1, seed: 1337, weather: "off", sound: "off" },
  readyExpression:
    "window.__warlordReady === true && !!(window.CBZ && CBZ.warlord && CBZ.warlord.state && CBZ.warlord.army)",
  /* 9 s to raise a 14 km island, five subjects, two frames, and a loaded
     shared Mac. The default 60 s ceiling is a hang report, not a timeout. */
  stageTimeoutMs: 600000,
  /* A laptop for the shape these screens are designed at, and a real phone,
     because a screen that does not fit only hurts on the phone. */
  frameList: ["laptop", "iphone-16:portrait"],
  subjects: SUBJECTS,
  stage: stageWords,
  pairNote: "seed 1337 · the same 210-man company, the same 60-man band, the same battle report on both sides",
  method:
    "Two servers, two checkouts, one seed. Both columns boot games/warlord.html straight onto the island and stage " +
    "each screen through the game's own exports — W.army.encounter for the meeting, the rail's own INSPECT verb " +
    "found by LABEL (its index differs between the columns), W.army.aftermath with the same plain report object " +
    "battle.js hands over after a 40-against-60 win, W.events.fire('rival'), W.loadout.open. The roster is rebuilt " +
    "from scratch for every subject rather than accumulated, because the aftermath banks loot and buries men and a " +
    "later subject would otherwise be photographing a different army than its pair. The BEFORE checkout is a " +
    "detached worktree at a901daf — pinned by SHA, not by HEAD~1, because four other agents were committing to " +
    "this repo while the wave was written.",
  defaultFocus:
    "Is anything on this screen saying in words what the shape beside it already says — and does the screen end " +
    "before the bottom of the phone does?",
  metrics: {
    uiChars: { label: "Rendered UI text the player must read", unit: "chars", better: "lower" },
    belowFoldPx: { label: "Screen below the fold", unit: "px", better: "lower" },
    controls: { label: "Things you can press", unit: "controls" },
  },
  metricsNote:
    "uiChars is this repo's hudTextChars convention, scoped to the surface actually asking to be read (#stage if a " +
    "screen is up, #verbs if a rail is, plus the persistent MEN/$/DAY strip either way) and taken off innerText, " +
    "so a collapsed section does not count against a screen that is not showing it. belowFoldPx is scrollHeight " +
    "minus clientHeight on #stage and on the rail's #vBody, whichever is worse — the number the owner was " +
    "complaining about, in pixels. controls has no direction on purpose: it is a guard rail. A screen that got " +
    "shorter by deleting a button did not get better, and the prisoner block in particular went from 56 controls " +
    "to 5 by moving the per-man roll behind its heading rather than by removing the decision.",
};
