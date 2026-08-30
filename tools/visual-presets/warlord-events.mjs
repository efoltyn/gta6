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
  - the phone frame is where this can break: a choice button carries a label
    AND a price line, and .wl-btns is a flex-wrap row. The picks are forced to
    display:block/width:100% in events.js's own CSS for exactly that reason,
    and this preset exists partly to keep checking it at 393pt.

  WHY THE SUBJECTS ARE THESE SIX. One card that shows the SHAPE (a headline,
  four lines, three priced buttons), one card that proves the cards read state
  (the schism names a man out of your actual roster and counts a third of your
  actual army), the loyalty panel, the storm, the endgame's progress screen and
  the run summary. If a picture of any of those cannot be judged by eye, the
  camera is in the wrong place — every one of them is a full-screen DOM panel,
  so the camera is the viewport and the framing is the layout.
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
  frameList: FRAMES,
  urlParams: { go: 1, seed: 1337 },
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
      label: "A sandstorm, and the choice it puts in front of you",
      focus:
        "AFTER: fog pulled to a fifth of its range, ochre air, airborne grit, a SANDSTORM chip in the " +
        "strip, and a card whose two answers are 'lose the day' or 'lose men'. BEFORE: the same fixed haze " +
        "the island has always had." },
    { id: "four", event: "war",
      label: "The endgame has a progress bar",
      focus:
        "AFTER: four named warlords, how big each is, how far away, and the odds core.js gives you against " +
        "each one. This is the long arc made visible. BEFORE: the game cannot be won." },
    { id: "summary", event: "over",
      label: "The run summary",
      focus:
        "AFTER: what you became, the numbers, the fate of the four, and YOUR DEAD BY NAME — the reason " +
        "core.js gives every soldier a name. BEFORE: the run cannot end." },
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
      if (want === "storm") {
        try {
          const ev = W.state.flags && W.state.flags.ev;
          if (ev) { ev.wea = "storm"; ev.weaP = 1; ev.camped = 0; }
          if (CBZ.warlordCtx && CBZ.warlordCtx.paintHud) CBZ.warlordCtx.paintHud();
        } catch (_) {}
        // let the fog and the grit ease in — driveWeather lerps rather than
        // snapping, on purpose, so a storm has to be given its seconds
        await wait(2600);
      }
      if (want === "loyalty") { try { E.loyaltyScreen(); fired = true; } catch (_) {} }
      else if (want === "war") { try { E.war(); fired = true; } catch (_) {} }
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
        warlords: audit && audit.four ? audit.four.length : 0,
        library: audit ? audit.events || 0 : 0,
      },
    };
  },
};
