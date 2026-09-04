/*
  warlord-events.mjs — the fourteen kilometres start doing something.

  THE CLAIM THIS PROVES. Before this wave games/warlord.html had exactly one
  thing that could happen on it: you rode, a band walked into you, you fought
  it. The island was enormous and empty, the army's opinion of you was not a
  thing that existed, the weather was a fixed haze, and the game could not be
  won or lost — which means nothing in it meant anything. src/warlord/events.js
  adds the rest: a library of twenty road cards that read your state and charge
  you for every answer, a LOYALTY number that grows a faction inside your own
  army and eventually fights you, a sandstorm that halves what you can see, and
  an endgame — four named warlords, and a run summary with your dead on it.

  THE HONEST A/B. Both sides serve THIS checkout and differ by one query
  param, ?events=off, which is events.js's own whole-wave revert: with it set
  the file adds NOTHING to the page — no cards, no chips in the strip, no
  loyalty, no weather, no warlords, no end. So the BEFORE side is genuinely the
  pre-wave island answering the same six moments, and the answer it gives is
  the empty desert, which is the finding.

    node tools/before-after.mjs warlord-events --no-open

  STAGING FACTS (static read 2026-08-30):
  - warlord.html boots on ?go=1 straight onto the island, skipping the title
    card, and sets window.__warlordReady when the modules are up.
  - events.js publishes a debug door: ?event=<id> fires any card, panel or end
    screen once campaign:ready lands, and stages a 34-man column first so the
    cards that read the roster ("give me a third of your men") have a roster to
    read. ?stage=0 turns that off. That door obeys ?events=off, deliberately.
  - the screens live in #stage (.wl-h headline, .wl-pick choice buttons); the
    persistent strip is #hud and events.js appends .wl-evchip spans to it.
  - the phone frame is where this breaks, and it already has, three times:
    (1) #stage is z-index 40 and sits UNDER both the shell's strip (50) and
    campaign.js's map/zoom furniture (45), so the first phone frame had "35 MEN
    $1240 DAY 1" printed through the middle of the headline — events.js now
    lifts its own screen to 55 while a card is up; (2) the shell's .wl-grid is
    minmax(180px,1fr), which collapses to one column at 393pt and turned three
    numbers into three full-width slabs — events.js ships its own 112px stat
    grid; (3) the storm's particle cloud photographed as confetti and was cut.
    None of those three is a metric anybody would have thought to declare.

  WHY THE SUBJECTS ARE THESE SEVEN. One card that shows the SHAPE (a headline,
  four lines, three priced buttons), one that proves the cards read state (the
  schism names a man out of your actual roster and counts a third of your
  actual army), the loyalty panel, the storm as a picture of the WORLD, the
  storm as a decision, the endgame's progress screen, the chronicle and the run
  summary. Six of those are full-screen DOM panels, so the camera is the
  viewport and the framing IS the layout — which is why this shoots a phone
  frame as well as a laptop one, and why the phone frame is the one that has
  found every bug so far.
*/

// laptop for the shape the thing was designed at, iPhone 16 because a wl-pick
// with a price line under it is the element most likely to break at 393pt.
const FRAMES = ["iphone-16", "laptop"];

export default {
  id: "warlord-events",
  title: "Desert Warlord — road events, loyalty, weather, an ending",
  description:
    "Six moments of everything that can now happen on the island besides a fight. " +
    "Both sides are this checkout; only ?events=off differs.",
  page: "games/warlord.html",
  frameList: FRAMES,
  /* ?event= RIDES THE URL because the debug door only reads it at boot, and
     the door is also what stages the 34-man column every state-reading card
     needs. Later subjects re-fire through E.fire against that same column. */
  urlParams: { go: 1, seed: 1337, event: "rival", stage: 34 },
  defaultBefore: "local",
  /* AN OBJECT, NOT A STRING — visual-compare.mjs does Object.entries on this,
     while the CLI's --before-params takes the "k=v" string form. Handing the
     string shape here spreads it character by character into the query and
     does not error. (Noted in prison-contracts.mjs; it cost somebody a run.) */
  beforeParams: { events: "off" },
  beforeLabel: "BEFORE · ?events=off",
  afterLabel: "AFTER · events.js live",
  stageTimeoutMs: 420000,
  readyExpression: "window.CBZ && window.CBZ.studio",
  pairNote:
    "Same checkout, same seed 1337, same six moments — ?events=off is the only variable, " +
    "and with it set events.js adds nothing to the page at all",
  defaultFocus:
    "Does anything happen out here besides a fight, and can you see it coming?",

  subjects: [
    { id: "road-card", event: "rival",
      label: "A road event: the wounded rival",
      focus:
        "AFTER: a headline, four lines of prose and THREE big buttons, each carrying its own price on " +
        "a second line — take his army and he comes back, or kill him and every band fights harder. " +
        "BEFORE: the empty island, which is the whole finding." },
    { id: "reads-state", event: "schism",
      label: "The cards read the roster",
      focus:
        "AFTER: this card names a man out of your ACTUAL army (the highest-tier lowest-bond one), counts " +
        "a third of your ACTUAL roster, and prices the bribe off W.payroll(). It is not a fixed string." },
    { id: "loyalty", event: "loyalty",
      label: "The army's opinion of you",
      focus:
        "AFTER: a meter, the ceiling composition sets, how many of these men were pressed rather than " +
        "paid, and the men who are thinking about leaving BY NAME. Also the LOYAL chip in the top strip — " +
        "that chip is the whole 'visible before it kills you' requirement." },
    { id: "storm", event: "storm",
      label: "A sandstorm over the island",
      focus:
        "The one subject that is a PICTURE OF THE WORLD rather than a panel, so the card is deliberately " +
        "left closed. AFTER: the whole sky goes brown, the far shore stops existing (fog far-plane 11000 m " +
        "-> 1500 m), and a SANDSTORM chip appears in the strip. BEFORE: the fixed blue-and-cream haze the " +
        "island has always had, and a horizon you can see all the way to." },
    { id: "storm-card", event: "storm-card",
      label: "...and the choice it puts in front of you",
      focus:
        "AFTER: two answers and both of them cost. MAKE CAMP prices the lost day in real wages off " +
        "W.payroll(); RIDE INTO IT names how many men and guns the sand takes. There is no free option." },
    { id: "chronicle", event: "chronicle",
      label: "The chronicle",
      focus:
        "AFTER: W.state.log read back as a history — grouped by day, coloured by kind, under the run's " +
        "numbers. In a game where every man has a name the log is the save file's soul; before this it " +
        "was a strip that scrolled past you once." },
    { id: "four", event: "war",
      label: "The endgame is a leaderboard and the win is land",
      focus:
        "AFTER: THE ISLAND — every contender on the map ranked by provinces held then men out, your own row " +
        "marked, the odds core.js gives you against each rival, over one bar: how much of the island you hold " +
        "against how much of it wins the run (32 of 40, derived from T.winTarget). This replaced THE FOUR, which " +
        "was four names frozen at boot in a world of twenty-one and which ended runs on day one. BEFORE: the " +
        "game cannot be won." },
    { id: "summary", event: "over",
      label: "The run summary",
      focus:
        "AFTER: what you became, the run as nine numbers (DAYS / PROVINCES HELD / BIGGEST COLUMN / BATTLES / " +
        "THEY LOST / YOU LOST / PRESSED / EXECUTED / FAME), THE ISLAND's final standings, and YOUR DEAD BY NAME " +
        "— the reason core.js gives every soldier a name. BEFORE: the run cannot end." },
    { id: "prisoners", event: "aftermath",
      label: "They decide, then you decide",
      focus:
        "AFTER: the aftermath's prisoner block. One line — how many of the men you took will march for you and " +
        "how many will not, rolled once before you touch anything — over a tier bar with the unwilling hatched, " +
        "and AT MOST THREE VERBS: TAKE THE WILLING, PRESS EVERY MAN, SHOOT THE UNWILLING. What was here was four " +
        "priced bulk buttons plus four more per man behind a triangle, and a roll that could refuse you after you " +
        "had paid. BEFORE: events.js is off, so this is the same screen this checkout draws without it." },
  ],

  metrics: {
    choices: { label: "Priced choices on screen", unit: "buttons", better: "higher" },
    cardChars: { label: "Prose the moment is written in", unit: "chars", better: "higher" },
    loyaltyVisible: { label: "Loyalty readable in the top strip", unit: "1=yes", better: "higher" },
    visibility: { label: "How far you can see", unit: "m", better: "lower" },
    warlords: { label: "Endgame targets tracked", unit: "count", better: "higher" },
    library: { label: "Road events in the library", unit: "cards", better: "higher" },
  },
  metricsNote:
    "visibility is the fog far-plane events.js writes for the day's weather — 11000 m clear, " +
    "1500 m in a full sandstorm — so LOWER is the storm actually arriving. Every other metric " +
    "scores 0 on the BEFORE side by construction, because with ?events=off none of it exists.",

  stage: async function stageWarlordEvents(input) {
    const CBZ = window.CBZ;
    if (!CBZ) return { ok: false, err: "no CBZ" };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (test, budgetMs, stepMs) => {
      const deadline = Date.now() + budgetMs;
      while (Date.now() < deadline) {
        try { if (test()) return true; } catch (_) {}
        await wait(stepMs || 200);
      }
      return false;
    };

    /* ONE PAGE PER SIDE, SIX SUBJECTS. The runner drives subjects in
       declaration order inside a single page load, and the debug door only
       reads ?event= once at boot. So the FIRST subject rides the URL and every
       later one is re-fired through the published API — which is the same code
       path the door itself takes (E.fire), so nothing here is a mock. */
    const S = window.__wlEvSeq || (window.__wlEvSeq = { booted: false });

    if (!S.booted) {
      const up = await until(() => window.__warlordReady === true, 300000);
      if (!up) return { ok: false, err: "warlord never booted" };
      // the island is raised by campaign.enter(); give it the frames it needs
      // to place the bands and the outposts before anything is photographed
      await until(() => CBZ.warlord && CBZ.warlord.phase() === "campaign", 120000);
      await wait(3500);
      S.booted = true;
      window.__cbzVisualCompare = {
        render() { try { CBZ.renderer && CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
      };
    }

    const W = CBZ.warlord;
    const E = W && W.events;
    const want = input.subject.event;

    /* PUT THE SCREEN BACK FIRST. Subjects share one page, so the previous
       subject's panel is still up; closing it before firing is what stops
       subject four being photographed with subject three's card behind it. */
    try { if (CBZ.warlordCtx && CBZ.warlordCtx.closeScreen) CBZ.warlordCtx.closeScreen(); } catch (_) {}
    await wait(120);

    let fired = false;
    if (E) {
      /* the storm subject has to assert the WEATHER as well as the card — the
         card is the decision, the fog and the grit are the thing it is about,
         and they are driven off the day's rolled weather rather than by the
         card. Same two lines events.js's own ?event=storm door runs. */
      if (want === "storm" || want === "storm-card") {
        try {
          const ev = W.state.flags && W.state.flags.ev;
          if (ev) { ev.wea = "storm"; ev.weaP = 1; ev.camped = 0; }
          if (CBZ.warlordCtx && CBZ.warlordCtx.paintHud) CBZ.warlordCtx.paintHud();
        } catch (_) {}
        // let the fog and the grit ease in — driveWeather lerps rather than
        // snapping, on purpose, so a storm has to be given its seconds
        await wait(4500);
      }
      if (want === "storm") {
        /* the card is deliberately NOT fired for this one: the claim is the
           air, and an opaque full-screen card is a picture of a card. */
        fired = true;
      }
      else if (want === "storm-card") { try { fired = !!E.fire("storm"); } catch (_) {} }
      else if (want === "chronicle") { try { E.chronicle(); fired = true; } catch (_) {} }
      else if (want === "loyalty") { try { E.loyaltyScreen(); fired = true; } catch (_) {} }
      else if (want === "war") { try { E.war(); fired = true; } catch (_) {} }
      else if (want === "aftermath") {
        /* THE PRISONER SCREEN NEEDS PRISONERS, and the ?event= door does not
           stage any — it stages an ARMY. A band off the same seeded stream is
           the honest source: the same men, in the same order, on both sides. */
        try {
          const b = W.makeBand({ size: 22, faction: "bandit", x: W.state.you.x, z: W.state.you.z });
          for (let i = 0; i < b.men.length; i++) W.state.prisoners.push(b.men[i]);
          W.army.aftermath({
            band: b, outcome: "won", duration: 74, ratio: 1.9, gold: 240,
            yourDead: W.state.army.slice(0, 3), yourSurvivors: W.state.army.slice(3), yourFled: [],
            theirDead: [], theirSurvivors: W.state.prisoners.slice(),
            loot: { ak47: 9, "12g": 4 }, armourLoot: { vest: 3 }, alreadyBanked: true,
          });
          fired = true;
        } catch (_) {}
      }
      else if (want === "over") {
        try {
          E.over("killed", "You went down at the salt pan and there was nobody left standing to pick you up.");
          fired = true;
        } catch (_) {}
      } else {
        try { fired = !!E.fire(want); } catch (_) {}
      }
    }
    await wait(600);

    // ---- measure -------------------------------------------------------------
    const stage = document.getElementById("stage");
    const on = !!(stage && stage.classList.contains("on"));
    const vis = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2;
    };
    const picks = Array.from(document.querySelectorAll("#stage .wl-pick")).filter(vis);
    const btns = Array.from(document.querySelectorAll("#stage .wl-btn")).filter(vis);
    const headline = (document.querySelector("#stage .wl-h") || {}).textContent || "";
    const bodyEl = document.querySelector("#stage .wl-card .body") ||
                   document.querySelector("#stage .wl-card");
    const bodyText = bodyEl ? (bodyEl.innerText || "").replace(/\s+/g, " ").trim() : "";
    const hud = document.getElementById("hud");
    const hudText = hud ? (hud.innerText || "").replace(/\s+/g, " ").trim() : "";
    const loyaltyVisible = /LOYAL\s*\d/.test(hudText) ? 1 : 0;

    /* THE LAYOUT TEST, MEASURED RATHER THAN EYEBALLED. A choice button that
       has wrapped into a second column, or that runs off the right edge of a
       393pt phone, is the failure this preset is watching for — so the widest
       pick's right edge is published as a number alongside the picture. */
    let widest = 0, narrowest = 1e9, offRight = 0;
    for (const b of picks) {
      const r = b.getBoundingClientRect();
      widest = Math.max(widest, r.width);
      narrowest = Math.min(narrowest, r.width);
      if (r.right > window.innerWidth + 1) offRight++;
    }
    const bodyScrollsWide = document.documentElement.scrollWidth > window.innerWidth + 1;

    const audit = E && E.audit ? (() => { try { return E.audit(); } catch (_) { return null; } })() : null;
    const fogFar = (() => { try { return Math.round(CBZ.scene.fog.far); } catch (_) { return 0; } })();

    return {
      ok: true,
      frame: input.frame ? input.frame.id : null,
      subject: input.subject.id,
      fired,
      screenUp: on,
      headline: headline.trim(),
      hud: hudText,
      audit,
      picks: picks.map((b) => (b.innerText || "").replace(/\s+/g, " ").trim().slice(0, 90)),
      layout: {
        viewport: window.innerWidth + "x" + window.innerHeight,
        widestPick: Math.round(widest),
        narrowestPick: picks.length ? Math.round(narrowest) : 0,
        picksOffRight: offRight,
        pageScrollsSideways: bodyScrollsWide,
      },
      metrics: {
        choices: picks.length || (on ? btns.length : 0),
        cardChars: bodyText.length,
        loyaltyVisible,
        visibility: fogFar,
        warlords: audit && audit.board ? audit.board.length : 0,
        library: audit ? audit.events || 0 : 0,
      },
    };
  },
};
