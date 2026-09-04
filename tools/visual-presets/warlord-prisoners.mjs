/* DESERT WARLORD — THE THINGS THAT HAPPEN TO MEN, PHOTOGRAPHED.

   THE REPORT (owner): "SHOW DONT TELL for warlord ... death isn't shown ...
   completely violates show don't tell as does a ton of the app."

   warlord/deaths.js answered the death. This is the rest of what warlord/army.js
   does, and every one of them was the same bug in a different costume: THE
   MOST DRAMATIC ACT IN THE GAME WAS AN ARRAY MUTATION AND A STRING.

     EXECUTING PRISONERS  `takePrisoner(id)` in a loop and nothing else — no
       sound, no pixel, no beat. The dread mechanic hangs off this act (events.js
       says outright "they watched you do it") and there was no THEY and no DO.
       bulk() ran the whole prisoner list through it in ONE FRAME.
     A BAND SURRENDERING  `band.men.length = 0` + toast("THEY SURRENDER"), which
       is sixty men leaving the screen between two frames. army.js's own comment
       calls this "the single best outcome in the game".
     A BAND JOINING YOU   addSoldier() in a loop + toast("N MEN JOIN YOU").
     A PRISONER REFUSING  a 2 600 ms toast about a fact that lasts forever.

   AND THE BUG UNDER ALL FOUR, which is why the first three could not be fixed
   where they stood: campaign.js's engage() calls W.setPhase("encounter"), core
   fires phase:leave:campaign, and campaign.js answers that with `live = false;
   showAll(false)` — its root hidden, W.desert.hide(), the controls hidden. THE
   MEETING RAIL, the screen this game shows most often and the one whose entire
   design argument is "the world keeps running behind it", was a strip of text
   over an empty sky dome. The band you were deciding whether to fight was not
   on screen at all. Subject 1 is that, and it is a picture of nothing.

   (outpost.js found the identical chain from the identical cause and fixed it
   in two lines — "RN WE HAVE BARREN DESERT AND MAN WITH A CRATE POPUP WITH NO
   MAN THERE". army.js's encounter() now hands the phase back the same way.)

   THE A/B IS ONE FLAG. Both sides are this checkout, same seed, same island,
   same band rolled from the same stream, the same buttons pressed in the same
   order. The before side boots ?show=old — army.js's own revert of everything
   in this wave: the meeting keeps the phase (so the island is dark), and every
   act is the mutation and the toast again. It lives inside army.js rather than
   as a second code path so the game carries ONE way of doing each of these.

   HOW A BEAT IS CHOSEN RATHER THAN SAMPLED. A tableau takes its time from the
   always-chain, and the page's own rAF keeps turning while a capture tool waits
   between polls — so "0.30 s after the volley" would be "whatever the load
   average left", which on this machine is a different picture every run.
   army.js grew two drive-only verbs for this and nothing in the game calls
   them: showFreeze() cuts the chain, showAdvance(sec) becomes the only clock.
   Same seam and same argument as battle.js's execute()/shotAudit().
*/

const subjects = [
  { id: "the-meeting", label: "The meeting — 34 men, and where they are",
    focus:
      "THE SCREEN THIS GAME SHOWS MOST OFTEN, WITH THE WORLD SWITCHED OFF BEHIND IT. BEFORE: campaign.js sets the " +
      "\"encounter\" phase to open this rail; core fires phase:leave:campaign; campaign.js answers it with " +
      "`live = false; showAll(false)`, which hides its own root, hides the controls and calls W.desert.hide(). What " +
      "is left behind the strip is the sky dome. `drawnMen` is 0 — not few, ZERO — so the thirty-four men the rail " +
      "is asking you to fight, your own column, and the island they are standing on are all absent from the frame " +
      "you are deciding in. AFTER: the rail hands the phase straight back (outpost.js's own two-line fix for the " +
      "identical chain) and the meeting happens in front of the men." },

  { id: "they-surrender", label: "THEY SURRENDER — 1.4 s in",
    focus:
      "THE SINGLE BEST OUTCOME IN THE GAME, which army.js's own comment calls it. BEFORE: `band.men.length = 0` and " +
      "a toast — thirty-four men stop existing between two frames, and the frame they stop existing in is the dark " +
      "one above. AFTER: their arms go on the sand as real stacks (props.js's own armStack, built out of the real " +
      "weapon model for the gun they were actually carrying — a factory nothing in this game had ever called with a " +
      "reason), dust comes off each one, feel.js's break shout fires (built for battle:break, never once fired by a " +
      "real game), and the party walks in on campaign.js's own goal-walk with its own gait. `armsOnSand` is the " +
      "picture as a number; it is structurally 0 before. The guns go into your stash, because a stack of rifles on " +
      "the sand in front of a party that keeps its rifles would be a tell contradicting a show." },

  { id: "they-cross", label: "TAKE ALL — the men who turned, and the men who did not",
    focus:
      "MEN CHANGING SIDES, WHICH WAS A push() AND A TOAST. BEFORE: the roster moves and the screen repaints; there " +
      "is no moment at which anybody crosses anything. AFTER: the whole prisoner list stands in a rank on the sand, " +
      "the men who took the money WALK ACROSS to your line, and the men who refused stand exactly where they were. " +
      "That is both halves of the mechanic in one picture — `walking` and `standing` are the two groups — and it is " +
      "what a toast can never be, because the refusal is permanent and the toast lasted 2 600 ms." },

  { id: "he-will-not-turn", label: "A man who will not turn, an hour later",
    focus:
      "PERMANENT STATE NEEDS A PERMANENT PICTURE. `_willing === false` lasts until he is decided about — it is what stops the " +
      "conscript button being a slot machine you pull until it pays — and it was rendered as a 2 600 ms toast that " +
      "said HE REFUSES once and then left no trace on any screen in the game. AFTER: the refusers are their own " +
      "HATCHED block inside their own tier's colour on the prisoner bar that was already there, so the screen " +
      "answers \"how many of these will never ride with me\" for as long as they are yours, at a cost of zero " +
      "characters of new copy. `refused` is the count the hatch is drawn from; `screenChars` is what it cost." },

  { id: "the-rank", label: "EXECUTE — the rank, before the volley",
    focus:
      "THE MOST MORALLY WEIGHTED ACTION IN THE GAME, WHICH WAS A SILENT LIST MUTATION. BEFORE: the button removes " +
      "every prisoner from an array in one frame and repaints the panel — this is that frame, and there is nothing " +
      "in it. AFTER: they are men standing on sand, in ranks, facing you, wearing the fits W.outfits.marks() paints " +
      "them in — the same public painter campaign.js uses, so a man executed here wears what he wore standing in " +
      "his band. `onSand` is how many bodies army.js is drawing this frame." },

  { id: "the-volley", label: "0.30 s after the volley",
    focus:
      "ONE VOLLEY FOR ANY NUMBER OF MEN, which is what \"bulk stays bulk\" has to mean: a firing party, not forty " +
      "executions the player sits through one at a time. The whole rank goes down together, each man on his own " +
      "stagger window, folding AWAY from the line that shot him — deaths.js's own beats and deaths.js's own " +
      "constants, because a man folding in front of your line and a man folding in a battle must not be two " +
      "different lengths of time. Blood for the nearest few, spent against gore.js's own 70 m gate and ranked " +
      "nearest-first; the lens tail is off for every one of them and there is ONE camera shake for the volley, " +
      "because THE LENS IS FOR WHAT IS DONE TO YOU." },

  { id: "on-the-sand", label: "What is left on the sand",
    focus:
      "THE EVIDENCE, and the reason the act is worth three and a half seconds once instead of nothing at all: you " +
      "are standing on the island looking at what you did, and the screen you left comes back with the dread " +
      "already on the EXECUTE button. BEFORE: an interface, unchanged except that a bar got shorter." },
];

async function stageWarlordPrisoners(input) {
  const CBZ = window.CBZ;
  const W = CBZ && CBZ.warlord;
  if (!W) return { ok: false, err: "no CBZ.warlord" };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, budgetMs, stepMs) => {
    const end = Date.now() + budgetMs;
    while (Date.now() < end) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 120);
    }
    return false;
  };

  /* THE ONE THING THIS PRESET READS THAT IS NOT A PUBLISHED AUDIT: the
     characters on screen. It is the repo's own hudTextChars convention
     (tools/warlord-fits.mjs measures exactly these three surfaces) and it is
     here because the claim is that these acts MOVED OFF THE PANEL — a picture
     that adds a paragraph has not replaced anything. */
  const screenChars = () => {
    let n = 0;
    ["stage", "verbs", "hud"].forEach(function (id) {
      const el = document.getElementById(id);
      if (el && getComputedStyle(el).display !== "none") n += (el.innerText || "").replace(/\s+/g, "").length;
    });
    return n;
  };

  const snap = (chars) => {
    let a = {}, c = {};
    try { a = W.army.showAudit(); } catch (_) {}
    try { c = W.campaign.audit(); } catch (_) {}
    return {
      worldLit: a.worldLit ? 1 : 0,
      /* ZEROED WHEN THE ROOT IS HIDDEN, and that is not a thumb on the scale.
         campaign.js's step() opens `if (!live) return`, so menBody.count is
         whatever the LAST drawn frame left in it — a stale buffer on a
         THREE.Group whose .visible is false. Nothing in that count reaches a
         pixel while the encounter phase owns the world, so reporting it would
         be reporting bookkeeping instead of bodies. */
      drawnMen: (a.worldLit && c && c.men) ? (c.men.impostors | 0) + (c.men.rigs | 0) : 0,
      onSand: a.drawn | 0,
      standing: a.standing | 0,
      fallen: a.fallen | 0,
      walking: a.walking | 0,
      armsOnSand: a.arms | 0,
      bloodEvents: a.bloodEvents | 0,
      prisoners: a.prisoners | 0,
      refused: a.unwilling | 0,
      executed: a.executed | 0,
      army: a.army | 0,
      /* ONLY WHERE BOTH SIDES ARE LOOKING AT THE SAME KIND OF SURFACE. On a
         tableau subject the before side is a panel and the after side is the
         world with the persistent strip over it, and comparing those two
         character counts is comparing a paragraph with a HUD — a metric the
         change does not claim. Omitted (not zeroed) so the row does not
         appear at all rather than appearing as a fake number. */
      screenChars: chars ? screenChars() : undefined,
    };
  };
  const measure = (chars) => { S.last = snap(chars); return S.last; };

  const draw = () => {
    /* AND NOTHING ELSE MAY OWN THE SCREEN. ?terr=off already takes the
       strategic map out of the run; this is the belt to that brace, because a
       screen this preset did not open is a screen it cannot interpret. */
    try { if (W.territory && W.territory.isOpen && W.territory.isOpen() && W.territory.toggle) W.territory.toggle(); } catch (_) {}
    try { if (CBZ.renderer && CBZ.camera) CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {}
  };

  let S = window.__wlPrisoners;
  if (!S) {
    const up = await until(() => W.phase && W.phase() === "campaign", 300000);
    if (!up) return { ok: false, err: "never reached the campaign (" + W.phase() + ")" };
    S = window.__wlPrisoners = { band: null };
    /* THE CLOCK IS THE TOOL'S FROM HERE. Every tableau beat is reached through
       W.army.showAdvance(); the world behind it still runs on its own rAF,
       which is correct — a tableau is not a cutscene and the island is not
       supposed to stop. On the before side there is nothing to freeze and the
       call is a harmless no-op. */
    try { W.army.showFreeze(true); } catch (_) {}
    /* ba renders and reads metrics AFTER the stage returns, so both of these
       see whatever state the subject left the page in. `last` is what the
       subject itself measured, so the table and the picture describe the same
       instant. */
    window.__cbzVisualCompare = { render() { draw(); }, metrics() { return S.last || {}; } };

    /* A FLAT ENOUGH PIECE OF GROUND, FOUND THE SAME WAY ON BOTH SIDES. A rank
       of men in a trough behind a dune crest is a photograph of a dune. Seeded
       spiral off the player's own position, scored on the height spread over
       three rings, same candidates in the same order on both columns. */
    const D = W.desert, y = W.state.you;
    let best = null, bestSpread = 1e9;
    for (let i = 0; i < 40; i++) {
      const a = i * 2.39996323, r = 60 + i * 26;
      const px = y.x + Math.cos(a) * r, pz = y.z + Math.sin(a) * r;
      if (!D.onLand(px, pz)) continue;
      let lo = 1e9, hi = -1e9;
      for (let k = 0; k < 12; k++) {
        const t = k / 12 * Math.PI * 2, rr = 12 + (k % 3) * 14;
        const h = D.heightAt(px + Math.cos(t) * rr, pz + Math.sin(t) * rr);
        if (h < lo) lo = h; if (h > hi) hi = h;
      }
      if (hi - lo < bestSpread) { bestSpread = hi - lo; best = { x: px, z: pz }; }
    }
    if (best) { y.x = best.x; y.z = best.z; y.placed = true; }
    /* NOTHING ELSE RIDES INTO THE SHOT. Every other party on the island is
       given a cooldown it cannot outlive, on both sides, so a warband walking
       into frame cannot be the difference between two columns. */
    for (let i = 0; i < W.state.bands.length; i++) { W.state.bands[i].cooldown = 1e9; W.state.bands[i].mood = "roam"; }
    W.state.gold = 12000;
    for (let i = W.state.army.length; i < 46; i++) {
      W.addSoldier(W.makeSoldier(i % 7 === 0 ? "veteran" : i % 3 === 0 ? "soldier" : "levy", i % 2 ? "carbine" : "ak47"));
    }
    await wait(400);
  }

  const id = input.subject.id;

  /* ---- 1. THE MEETING ---------------------------------------------------- */
  if (id === "the-meeting") {
    const y = W.state.you, yaw = W.campaign.camYaw();
    const b = W.makeBand({ size: 34, faction: "militia",
      x: y.x + Math.sin(yaw) * 24, z: y.z + Math.cos(yaw) * 24 });
    b.y = W.desert.heightAt(b.x, b.z);
    b.yaw = yaw + Math.PI;
    b.scared = 0; b.think = 1e9; b.pause = 0; b.cooldown = 0;
    b.goal = { x: b.x, z: b.z, why: "" };          // it stands still and is looked at
    W.state.bands.push(b);
    S.band = b;
    W.campaign.camDist(16);   // the closest campaign.js lets this lens come
    W.army.encounter(b);
    await wait(1200);
    draw();
    return { ok: true, metrics: measure(true) };
  }
  if (!S.band) return { ok: false, err: "no band — the meeting subject must run first" };

  /* ---- 2. THE SURRENDER -------------------------------------------------- */
  if (id === "they-surrender") {
    /* THE ROLL IS FORCED, IDENTICALLY, ON BOTH SIDES. surrenderChance is a
       real probability and this preset is about what a surrender LOOKS like,
       not how often one happens; leaving it to the dice would photograph two
       different events. W.chance is put back on the next line. */
    const oldChance = W.chance;
    W.chance = function () { return true; };
    const btn = Array.prototype.slice.call(document.querySelectorAll("#verbs .vbtn"))
      .filter(function (n) { return /DEMAND/.test(n.textContent); })[0];
    if (!btn) { W.chance = oldChance; return { ok: false, err: "no DEMAND verb on the rail" }; }
    btn.click();
    W.chance = oldChance;
    /* THE TABLEAU IS LEFT STANDING AT THE BEAT. ba renders and reads metrics
       AFTER the stage returns, so a subject that finishes what it started
       photographs the frame after the event instead of the event. The next
       subject runs it out. The wall wait is for the CAMERA, which is not
       frozen (campaign.js lerps camDist on its own frame hook) and must not
       be — a tableau is not a cutscene. */
    try { W.army.showAdvance(1.4); } catch (_) {}
    await wait(900);
    draw();
    return { ok: true, metrics: measure(false) };
  }

  /* ---- 3. THE TURN ------------------------------------------------------- */
  if (id === "they-cross") {
    try { W.army.showAdvance(5); } catch (_) {}          // run the surrender out
    await until(() => W.phase() === "aftermath", 30000, 100);
    await wait(400);
    /* PRESS EVERY MAN, which is where TAKE ALL went. The aftermath's four
       priced bulk verbs became three unpriced ones on 2026-09-04 (army.js, THE
       PRISONERS): every man now decides WILLING or UNWILLING before you decide
       anything, so "all of them cross" is PRESS EVERY MAN and this subject is
       still exactly the picture it always was — the men walking over. */
    const b = document.getElementById("pPress") || document.getElementById("pWilling");
    if (!b) return { ok: false, err: "no PRESS verb (prisoners: " + W.state.prisoners.length + ")" };
    b.click();
    try { W.army.showAdvance(1.9); } catch (_) {}
    await wait(900);
    draw();
    return { ok: true, metrics: measure(false) };
  }

  /* ---- 4. THE HATCH ------------------------------------------------------ */
  if (id === "he-will-not-turn") {
    try { W.army.showAdvance(5); } catch (_) {}          // run the turn out
    await until(() => W.phase() === "aftermath", 30000, 100);
    await wait(500);
    draw();
    return { ok: true, metrics: measure(true) };
  }

  /* ---- 5-7. THE EXECUTION ------------------------------------------------ */
  if (id === "the-rank") {
    /* A RANK BIG ENOUGH TO BE A RANK. The turn above took most of the
       prisoners into the army, so the list is topped back up from a band
       rolled off the same seeded stream — the same men, in the same order, on
       both sides, because W.makeBand is deterministic under the seed. */
    const top = W.makeBand({ size: 30, faction: "bandit", x: W.state.you.x, z: W.state.you.z });
    for (let i = 0; i < top.men.length; i++) W.state.prisoners.push(top.men[i]);
    W.army.aftermath({
      band: top, outcome: "won", duration: 70, ratio: 1.5, gold: 260,
      yourDead: [], yourSurvivors: W.state.army.slice(), yourFled: [],
      theirDead: [], theirSurvivors: [],
      loot: {}, armourLoot: {}, alreadyBanked: true,
    });
    await wait(350);
    /* SHOOT THE UNWILLING, which is where EXECUTE went. The rank is the men
       who said no rather than every prisoner, so the staged band above is
       topped up big enough that the roll leaves a rank worth photographing. */
    const b = document.getElementById("pShoot");
    if (!b) return { ok: false, err: "no SHOOT THE UNWILLING verb" };
    b.click();
    try { W.army.showAdvance(0.9); } catch (_) {}
    await wait(800);
    draw();
    return { ok: true, metrics: measure(false) };
  }
  if (id === "the-volley") {
    try { W.army.showAdvance(0.45); } catch (_) {}   // 1.05 fires the volley; +0.30
    await wait(300);
    draw();
    return { ok: true, metrics: measure(false) };
  }
  if (id === "on-the-sand") {
    try { W.army.showAdvance(1.6); } catch (_) {}
    await wait(400);
    draw();
    return { ok: true, metrics: measure(false) };
  }

  return { ok: false, err: "unknown subject " + id };
}

export default {
  id: "warlord-prisoners",
  title: "Desert Warlord: What Happens To Men, Shown",
  description:
    "Executing prisoners, a band surrendering, a band changing sides and a man refusing to — four mechanics that were an array mutation and a toast, photographed as they happen on the sand. Plus the bug under all four: the meeting rail took the phase, and taking the phase switched the island off behind it. The before side boots ?show=old, army.js's own revert.",
  page: "games/warlord.html",
  defaultBefore: "local",
  beforeParams: { show: "old" },
  beforeLabel: "BEFORE · ?show=old (the mutation, the toast, and a dark island behind the rail)",
  afterLabel: "AFTER · on the sand",
  viewport: { width: 1180, height: 700 },
  /* ?terr=off AND ?events=off ON BOTH SIDES, and both are the same rule: a
     control has to be a constant. territory.js's claim animation opens the
     strategic map over the campaign on its own, which on the first run of this
     preset put a full-screen 2D map over the after column's volley and left the
     before column looking at a panel — a difference between the columns that
     has nothing to do with what is under test. events.js's cards do the same
     with a headline. Neither is silenced on one side only. */
  urlParams: { go: 1, seed: 1337, weather: "off", sound: "off", events: "off", smalls: 0, terr: "off" },
  readyExpression: "!!(window.CBZ && window.CBZ.warlord)",
  stageTimeoutMs: 600000,
  pairNote:
    "Same checkout · seed 1337 · same island · same ground, found by the same seeded search · the same band rolled off the same stream · the same buttons pressed in the same order · every other party on the island frozen on both sides — ?show=old is the only variable",
  method:
    "One boot per side. The player is moved to the flattest pan a seeded spiral can find within 1 km (a rank of men in a trough behind a dune is a photograph of a dune), every other party on the island is given a cooldown it cannot outlive so nothing walks into frame, and a 34-man militia band is rolled and parked 24 m in front of him. Then the game is played through its own buttons: the encounter rail opens, DEMAND is pressed with W.chance forced true on both sides (a surrender's odds are not what is under test), TAKE ALL is pressed on the prisoners it yields, and EXECUTE is pressed on a rank topped back up from the same seeded stream. Every beat inside a tableau is reached through W.army.showAdvance() with the always-chain cut by showFreeze() — the drive-only seam army.js grew for this, which nothing in the game calls — because the page's own rAF keeps turning while a tool waits between polls and 0.30 s after the volley would otherwise be whatever the machine's load average left. The world behind a tableau is NOT frozen, and deliberately: a tableau is not a cutscene and the campaign clock never stops in this game.",
  metricsNote:
    "drawnMen is the headline of subject 1 and it is structurally 0 on the before side, not small: campaign.js's step() opens with `if (!live) return`, and `live` is false for the whole life of the encounter phase — so no man on the island, yours or theirs, is drawn in any frame the meeting rail is up, and W.desert.hide() has taken the ground out from under them too. onSand / standing / fallen / walking are counts of BODIES army.js is drawing this frame, read off the rank itself rather than off the bookkeeping that produced it, so a tableau that is recorded and not rendered reads as zero — which is the exact failure this whole wave is about. armsOnSand is props.js armStack groups actually in the scene. bloodEvents is gore() calls the volley spent, ranked nearest-first against gore.js's own 70 m gate and capped, because forty simultaneous blood events is a hang and not a feature. refused is how many prisoners will never turn — permanent state that used to live only in a 2 600 ms toast and now has a hatched block on a bar that stays on screen. screenChars is the repo's own hudTextChars convention over the same three surfaces tools/warlord-fits.mjs measures: the claim is that these acts moved OFF the panel, and a picture that also adds a paragraph has not replaced anything.",
  metrics: {
    worldLit: { label: "The island is on screen", unit: "0/1", better: "higher" },
    drawnMen: { label: "Men campaign.js is drawing", unit: "bodies", better: "higher" },
    onSand: { label: "Men army.js is drawing", unit: "bodies", better: "higher" },
    standing: { label: "…still standing", unit: "men" },
    fallen: { label: "…on the ground", unit: "men", better: "higher" },
    walking: { label: "…crossing to your line", unit: "men", better: "higher" },
    armsOnSand: { label: "Arms stacked on the sand", unit: "stacks", better: "higher" },
    bloodEvents: { label: "Blood events fired", unit: "deaths", better: "higher" },
    prisoners: { label: "Prisoners held", unit: "men" },
    refused: { label: "Men who will not turn", unit: "men" },
    executed: { label: "Prisoners executed, all run", unit: "men" },
    army: { label: "Your army", unit: "men" },
    screenChars: { label: "Characters on screen to read", unit: "chars", better: "lower" },
  },
  subjects,
  stage: stageWarlordPrisoners,
};
