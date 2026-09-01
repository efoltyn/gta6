/* DESERT WARLORD — SHOW DON'T TELL, THE SECOND PASS.

   THE REPORT (owner): "SHOW DONT TELL for warlord … death isn't shown …
   completely violates show don't tell as does a ton of the app."

   warlord/deaths.js answered the death. This preset photographs the rest of
   it, and "the rest of it" turned out to be one bug wearing four costumes: a
   dramatic mechanic was an array mutation plus a string.

     THE MUTINY. N men were removed from S.army — so they vanished out of the
       drawn column between two frames — and the band they became was built at
       {x: S.you.x, z: S.you.z}, which is INSIDE YOU, geometrically. It was
       then never pushed onto S.bands at all, so it was not drawn, had no
       banner, and was on no map. There was no frame of this game on which a
       mutiny existed. A card then described a campfire and two sides, and
       none of the three were anywhere. `mutinyDist` is that bug as a number:
       it is structurally 0 on the before side and cannot be anything else.

     EVERY RECRUITMENT was W.toast("+" + men(n)) — six cards, and the column
       riding behind you is the entire premise of campaign.js. Joiners were
       told three times (the HUD count, the toast, the log) and shown zero.

     AN AMBUSH WARBAND was placed on a land point 60-90 m from the camera —
       a distance chosen so you would SEE them, which is exactly why you saw
       them appear — and then a sentence was typed about it.

     THE CLAIM ANIMATION, and this one is the cheapest fix in the wave because
       the animation already existed and was already good. territory.js's
       startClaimAnim opens with `if (FLAG_NOANIM || !open) { paint it and
       return }`, where `open` means THE 2D MAP SCREEN IS UP. You take a
       province by winning a fight ON THE ISLAND — map shut, every time — so
       the one animation this file owns for that moment has never once played
       at the moment it is about. `spreading` counts the regions with a live
       wave crossing them at the instant you take ground: structurally 0.

   THE A/B IS ONE FLAG. ?shown=off, read by both warlord/events.js and
   warlord/territory.js, reverts the PICTURE and nothing else: identical
   rosters, identical rolls, identical state changes, and the sentences back.

   HOW THE SUBJECTS ARE REACHED. events.js publishes a debug door — ?event=id
   stages a 34-man column and fires any card — so every moment here is reached
   through the game's own code paths (E.fire, a real click on the real button)
   rather than by poking state. The clock is NOT frozen: unlike the death
   preset, every subject here is about a thing that moves across the ground
   over several seconds, so the page runs at its own rate and the preset waits
   in wall time. That makes the exact pixel position of a walking party vary
   by a metre between runs, which is why nothing here is gated on a position —
   the metrics are counts and distances with a floor of ZERO on the old side.
*/

async function stageShown(input) {
  const CBZ = window.CBZ;
  if (!CBZ) return { ok: false, err: "no CBZ" };
  /* HARNESS TRAP: the stage function is serialised on its own and evaluated
     inside the page, so it closes over NOTHING in this module. A helper
     declared at module scope — `const wait = ...` above the function, which is
     the obvious place for it — is a ReferenceError on every subject, on both
     sides, with a stack that points at the first line that uses it rather than
     at the declaration. warlord-death.mjs declares its helpers inside for this
     reason and does not say so. */
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 200);
    }
    return false;
  };

  const S = window.__wlShown || (window.__wlShown = { booted: false, toasts: 0, toastText: [] });
  if (!S.booted) {
    if (!await until(() => window.__warlordReady === true, 300000)) return { ok: false, err: "warlord never booted" };
    if (!await until(() => CBZ.warlord && CBZ.warlord.phase() === "campaign", 120000)) return { ok: false, err: "never reached the campaign" };
    await wait(3500);
    S.booted = true;
    /* THE WORDS THE GAME TYPES AT YOU, COUNTED. This is the metric the owner's
       complaint is actually about, and it is the only one whose direction is
       obvious without reading the picture: a moment that is shown does not
       also need to be narrated, so fewer is better. Counted off core's own
       bus, so it catches every toast from every module, not only this file's. */
    CBZ.warlord.on("toast", function (t) {
      S.toasts++;
      if (t && t.text) S.toastText.push(String(t.text).slice(0, 28));
    });
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  const W = CBZ.warlord;
  const E = W.events;
  const sub = input.subject;

  /* THE SEAT. campaign.js owns the lens (C.camDist / C.camYaw are the only
     levers in the warlord namespace) and it damps toward what it is asked
     for, so the ask is repeated rather than set once. 34 m over the shoulder:
     the whole staged camp — you, the fire, and the men on the far side of it
     — measures about 10 m across, and the mutineers' own banner stands about
     14 m tall at nineteen men (campaign.js:2902, 5 + 2.6*log2(n+1)). */
  const seat = async (dist) => {
    for (let i = 0; i < 14; i++) {
      try { W.campaign.camDist(dist); } catch (_) {}
      await wait(120);
    }
  };

  const click = (re) => {
    const bs = document.querySelectorAll("#stage .wl-pick");
    for (let i = 0; i < bs.length; i++) if (re.test(bs[i].textContent)) { bs[i].click(); return true; }
    return false;
  };

  if (sub.id === "recruit-walking") {
    /* SEAT THE LENS BEFORE THE CLICK, NOT AFTER IT. campaign.js damps camDist
       toward what it is asked for, so the ask has to be repeated over about a
       second and a half — and the first version spent that second and a half
       AFTER taking the men, by which time they had walked the whole twenty-five
       metres and folded in. The men were photographed as an empty road. */
    await seat(34);
    /* the card the URL fired: twelve-odd deserters, and the button that takes
       them. Same click a player makes. */
    if (!click(/^TAKE THEM ALL/)) {
      try { E.fire("deserters"); } catch (_) {}
      await wait(700);
      click(/^TAKE THEM ALL/);
    }
    await wait(1500);
  } else if (sub.id === "recruit-fallen-in") {
    /* they are in the roster now, at the tail of the drawn column. */
    await until(() => (E.shown().joiningParties === 0), 40000, 400);
    await seat(52);
    await wait(1200);
  } else if (sub.id === "mutiny-walkout") {
    try { E.close(); } catch (_) {}
    await wait(300);
    await seat(30);
    try { W.state.flags.ev.loy = 8; E.mutiny(); } catch (_) {}
    /* MID-WALK, MEASURED RATHER THAN TIMED. The walk is about 1.7 s of game
       time and this page renders at one to three frames a second under a
       software rasteriser, so a fixed wait photographs a different point of
       the walk on every machine — the first run caught them 2.1 m out of a
       ~10 m crossing, i.e. still inside the camp. They start at the edge of
       your own column and stop on their mark, so "past the fire" is "further
       than twice where they started". */
    const d0 = (E.shown().mutinyDist || 1);
    await until(() => (E.shown().mutinyDist || 0) > d0 * 2.5, 20000, 80);
    await wait(250);
  } else if (sub.id === "mutiny-card") {
    /* THE MUTINY CARD, BY NAME. `#stage .wl-h` matches any headline this game
       puts up, and on the first run it matched army.js's ENCOUNTER card
       instead — which is how the encounter-on-your-own-mutineers bug was
       found, but it is not this subject. */
    await until(() => /MUTINY/.test((document.querySelector("#stage .wl-h") || {}).textContent || ""), 40000, 250);
    await wait(500);
  } else if (sub.id === "ambush") {
    try { E.close(); } catch (_) {}
    await wait(400);
    try { E.fire("toll"); } catch (_) {}
    await wait(800);
    await seat(220);
    click(/^GO THROUGH THEM/);
    await wait(2600);
  } else if (sub.id === "claim") {
    try { E.close(); } catch (_) {}
    await wait(400);
    /* WIN THE GROUND YOU ARE STANDING ON, through territory.js's one door,
       and then walk the phase out to `aftermath` and back the way a finished
       battle does. That is the exact sequence in which the animation was
       being thrown away. */
    try {
      /* GROUND THAT IS NOT ALREADY YOURS, and taken ACROSS A BORDER YOU HOLD
         when there is one — startClaimAnim starts its wave at the attacker's
         side of the frontier, so a claim with no `fromRegion` blooms out of
         the middle instead and the picture loses the one thing it carries for
         free: which way the war is moving. */
      const T = W.territory;
      let r = T.at(W.state.you.x, W.state.you.z);
      if (!r || T.owner(r.id) === "you") {
        const rs = T.regions;
        let bd = 1e18;
        for (let i = 0; i < rs.length; i++) {
          if (T.owner(rs[i].id) === "you") continue;
          const d = Math.hypot(rs[i].lx - W.state.you.x, rs[i].lz - W.state.you.z);
          if (d < bd) { bd = d; r = rs[i]; }
        }
      }
      let from = null;
      const nb = T.neighboursOf(r.id) || [];
      for (let i = 0; i < nb.length; i++) {
        const id = nb[i] && nb[i].id ? nb[i].id : nb[i];
        if (T.owner(id) === "you") { from = id; break; }
      }
      T.claim(r.id, "you", from ? { fromRegion: from } : undefined);
    } catch (_) {}
    W.setPhase("aftermath");
    await wait(300);
    W.setPhase("campaign");
    /* the spread is 900 ms long and the map opens ~420 ms after the island
       comes back, so this lands inside the wave rather than after it. */
    await until(() => W.territory.isOpen(), 20000, 150);
    await wait(430);
  }

  let shown = {}, terr = {};
  try { shown = E.shown(); } catch (_) {}
  try { terr = W.territory.audit(); } catch (_) {}
  const stage = document.getElementById("stage");
  const cardOn = !!(stage && stage.classList.contains("on"));
  const bodyEl = document.querySelector("#stage .wl-card .body");
  const cardChars = bodyEl ? (bodyEl.innerText || "").replace(/\s+/g, " ").trim().length : 0;

  /* ONLY WHAT THIS SUBJECT CLAIMS. warlord-death.mjs learned this the hard
     way and wrote it down: "a metric a change does not claim must not be gated
     on". The first run of this preset reported the mutineers' distance on the
     AMBUSH subject — the band is still standing out there and the player has
     ridden, so the number moves — and the claim wave on the recruitment
     subject, where there is no claim. Omitted, not zeroed, so the row simply
     does not appear rather than appearing as a fake zero. */
  const all = {
    mutinyDist: shown.mutinyDist || 0,
    mutinyOnMap: shown.mutinyOnMap || 0,
    joiningMen: shown.joiningMen || 0,
    army: shown.army || 0,
    fires: shown.fires || 0,
    roads: shown.churnTiles || 0,
    dust: shown.dust || 0,
    spawnDist: shown.spawnDist || 0,
    spawnHidden: shown.spawnHidden || 0,
    spreading: terr.spreading || 0,
    autoShown: terr.autoShown || 0,
    toasts: S.toasts,
    cardChars: cardOn ? cardChars : 0,
  };
  const m = {};
  const keys = sub.report || [];
  for (let i = 0; i < keys.length; i++) m[keys[i]] = all[keys[i]];
  return { ok: true, metrics: m, note: S.toastText.join(" · ").slice(0, 180) };
}

export default {
  id: "warlord-shown",
  title: "Desert Warlord: Shown, Not Said",
  description:
    "A mutiny, a recruitment, an ambush and a province, before and after. Both sides are this " +
    "checkout at seed 1337 with the same rosters and the same rolls; ?shown=off is the only " +
    "variable, and it reverts the picture and nothing else.",
  page: "games/warlord.html",
  defaultBefore: "local",
  beforeParams: { shown: "off" },
  beforeLabel: "BEFORE · ?shown=off — the array mutation and the sentence",
  afterLabel: "AFTER · men walk, a fire is lit, ground changes hands where you can see it",
  viewport: { width: 1180, height: 700 },
  /* the debug door stages a 34-man column so the cards that read the roster
     have one to read, and fires the deserters card at boot — subject 1 is
     then a real click on a real button rather than a poked state. */
  /* ?weather=off ON BOTH SIDES. A rolled sandstorm halves what the camera can
     see (events.js drives the fog far plane down to 1500 m) and the first run
     photographed a mutiny through brown air. The weather is not what is under
     test and it is identical on both sides, so it is turned off rather than
     hoped about. */
  urlParams: { go: 1, seed: 1337, sound: "off", weather: "off", event: "deserters", stage: 34 },
  readyExpression: "!!(window.CBZ && window.CBZ.warlord)",
  stageTimeoutMs: 600000,
  pairNote:
    "Same checkout · seed 1337 · same 34-man column · same cards · same clicks — ?shown=off is the only variable",
  defaultFocus: "When something happens to your army, do you watch it happen or read about it?",
  method:
    "games/warlord.html boots ?go=1 straight onto the island. events.js's own debug door stages a " +
    "34-man column and fires a card; every moment after that is reached the way a player reaches " +
    "it — E.fire for the card, a real click on the real .wl-pick button, territory.claim through " +
    "its one door, and the phase walked out to `aftermath` and back the way a finished battle does. " +
    "The clock is not frozen: every subject here is about something crossing ground over several " +
    "seconds, so the page runs at its own rate and the preset waits in wall time. Numbers are read " +
    "back through W.events.shown() (positions measured off the world, not off intentions) and " +
    "W.territory.audit().",
  metricsNote:
    "mutinyDist is the headline and it is a structural zero on the before side, not a small number: " +
    "the mutineer band was constructed at the player's own coordinates and never pushed onto S.bands, " +
    "so there was no distance to measure and nothing to draw. spreading counts regions with a live " +
    "claim wave crossing them at the instant you take ground — also structurally zero before, because " +
    "startClaimAnim refuses to animate unless the 2D map screen is already open and you take ground " +
    "with it shut. toasts is the running count of sentences the game has typed at you across the " +
    "whole sequence; every one this pass deleted was the third telling of something now on the screen. " +
    "cardChars is the mutiny card's prose: the old body described the fire, the rifles and which side " +
    "of the fire each half of the army was on, all three of which are now drawn behind it.",
  metrics: {
    mutinyDist: { label: "How far the mutineers are standing from you", unit: "m", better: "higher" },
    mutinyOnMap: { label: "The mutineers exist as a party on the island", unit: "0/1", better: "higher" },
    joiningMen: { label: "Men walking in, not yet on the roster", unit: "men", better: "higher" },
    army: { label: "Men on the roster", unit: "men" },
    fires: { label: "Fires this file has lit", unit: "props", better: "higher" },
    roads: { label: "Trampled road laid by a party", unit: "tiles", better: "higher" },
    dust: { label: "Sand in the air", unit: "motes", better: "higher" },
    spawnDist: { label: "Where the ambush landed", unit: "m", better: "higher" },
    spawnHidden: { label: "…and the ground hid it from you", unit: "0/1", better: "higher" },
    spreading: { label: "Provinces with a claim wave crossing them", unit: "regions", better: "higher" },
    autoShown: { label: "Claims played at the moment they were earned", unit: "count", better: "higher" },
    toasts: { label: "Sentences the game has typed at you", unit: "toasts", better: "lower" },
    cardChars: { label: "Prose on the card in front of you", unit: "chars", better: "lower" },
  },
  subjects: [
    { id: "recruit-walking", report: ["joiningMen", "army", "roads", "dust"], label: "Twelve men who said yes, walking in",
      focus:
        "AFTER: they are a party on the sand, one contact radius out (campaign.js's own 26 m — the " +
        "distance at which the game already decides a party is AT you), walking in at the island's " +
        "own band speed with a trampled road and dust behind them. join() batches the men of ONE " +
        "answer into ONE party, so twelve men are a group arriving and not a queue. BEFORE: they " +
        "were spliced onto the end of an array and a toast said +12 men — a sentence about the one " +
        "thing campaign.js exists to draw." },
    { id: "recruit-fallen-in", report: ["joiningMen", "army", "roads"], label: "…and fallen in",
      focus:
        "The same men a few seconds later: off S.bands, onto S.army, drawn in the column behind you, " +
        "with their road running into yours at your feet. `joiningMen` has gone to zero and `army` " +
        "has gone up by the same number — the fold-in is the only thing that ever moves them, and it " +
        "happens on arrival, on a phase change, on a save and on a deadline, so no man is ever owed." },
    { id: "mutiny-walkout", report: ["mutinyOnMap", "mutinyDist", "fires", "roads", "dust"], label: "Nineteen of your own, walking out",
      focus:
        "THE WORST ONE. AFTER: they are out of the camp and crossing to their own side of a fire this " +
        "file lit between the two halves of your army — and their banner is over them, because a band " +
        "on S.bands gets campaign.js's own party() pole and flag scaled by log2 of its head count, " +
        "which is what putting them on the map buys for free. The ground between the two sides is " +
        "measured, not chosen: sand.js's bandWidth for each party, one man's width of clear ground, " +
        "and props.js's own fire radius. BEFORE: nothing. Nineteen men left the drawn column between " +
        "two frames and the band that replaced them was built at your own coordinates and never put " +
        "on the island." },
    { id: "mutiny-card", report: ["mutinyOnMap", "mutinyDist", "fires", "cardChars"], label: "Then the card, and it is one line shorter",
      focus:
        "The card comes up AFTER the walk, and its body has lost the three things now behind it: the " +
        "fire, the rifles, and which side of the fire each half of your army is standing on. What is " +
        "left is the only thing the picture cannot say — that losing this one is the death there is no " +
        "waking up from." },
    { id: "ambush", report: ["spawnDist", "spawnHidden", "roads", "dust"], label: "An ambush that comes from somewhere",
      focus:
        "AFTER: they are put where the ground hides them — a straight line between two men's heads, " +
        "one probe per 40 m, and the nearest candidate the terrain stands in front of — and a dust " +
        "road is laid ahead of them, so the first thing you get is dust on a rise and the second is " +
        "men. BEFORE: a warband on a land point 60 m away, in plain sight, and a toast reading THEY " +
        "ARE COMING DOWN OFF THE ROCK about men who were already standing in front of you." },
    { id: "claim", report: ["spreading", "autoShown", "toasts"], label: "A province changing hands, at the moment you earn it",
      focus:
        "AFTER: the map opens on the ground you just took, the colour is put back to what it was, and " +
        "your orange SPREADS across it from the frontier you came over — then it closes itself, unless " +
        "you touched it. BEFORE: the same wave, armed and thrown away, because startClaimAnim refuses " +
        "to animate while the map screen is shut and the map screen is always shut when you win a " +
        "fight. What the player got instead was the name of the province three times: a toast, a log " +
        "line, and a headline painted onto a map nobody was looking at." },
  ],
  stage: stageShown,
};
