/* ============================================================
   warlord/events.js — EVERYTHING ELSE THAT CAN HAPPEN, AND THE END OF IT.

   THE PROBLEM THIS FILE EXISTS TO FIX. Before it, the island was fourteen
   kilometres wide and exactly one thing happened on it: you rode, you met a
   band, you fought it, you spent the loot, you rode. That is a good loop and
   it is also the ONLY loop, which makes the other thirteen kilometres a
   loading screen with dunes on it. A map is only big if the map surprises you.

   So this file owns the five things that were missing, and they are five
   answers to one question — WHAT ELSE IS THE DESERT DOING WHILE YOU RIDE:

     1. ROAD EVENTS   a library of short cards with two or three choices and
                      a real price on every one of them. Bannerlord's shape:
                      never a form, never a free lunch, always gated on state
                      so an army of three is never offered a siege.
     2. LOYALTY       core.js already makes unpaid men WALK. That is the
                      mechanical consequence. This is the dramatic one: a
                      warlord who executes prisoners, loses battles and
                      starves his men grows a faction inside his own army,
                      and at the bottom of that curve is a battle against it.
     3. THE WEATHER   the desert as an opponent. Sandstorms that halve the
                      distance you can see and put a decision in front of you,
                      heat that kills the men already hurt, night that hides
                      you from a band that wants you.
     4. THE ENDGAME   the game could not be won or lost, which means nothing
                      in it meant anything. It is LAND now, openfront's rule:
                      hold 80% of the island's provinces and it is yours, with
                      the fraction on the strip from the first frame. THE
                      ISLAND is the leaderboard everybody on the map is ranked
                      on. Die, or get killed by your own men, or go broke alone
                      in the salt, and the run is over and you read what it was.
                      (What was here was THE FOUR — four frozen names — and it
                      ended runs on day one. See THE ISLAND, below.)
     5. THE CHRONICLE core keeps W.state.log. In a game where every man has a
                      name, the log IS the save file's soul, so it gets a
                      screen worth reading back rather than a scrolling strip.

   WHAT IT REUSES RATHER THAN REBUILDS
     · systems/weather.js  — CBZ.weatherDrive is the ONE weather. The
       sandstorm asserts wind, fog colour and overcast through it exactly the
       way systems/blizzard.js asserts a whiteout (that file is the worked
       example; this one is the same call with a different colour). We do NOT
       ship a second wind field or a second fog tint. weather.js is not in any
       studio pack so it is injected on first use — injected, never forked.
     · systems/fx.js       — CBZ.fx.particleCloud was tried three ways for the
       airborne grit and CUT, with the measurements written down at the storm
       code below. The storm is carried by the air instead. No new particle
       system was written for this file, and none was left in at 5% opacity to
       prove something had been attempted.
     · core.js             — every number here comes off W.tier / W.gunPrice /
       W.payroll / W.power / W.surrenderChance / W.makeBand. There is no
       parallel economy in this file and no invented stat.
     · army.js / battle.js — a mutiny is a REAL battle against a REAL band
       built from your own roster, through W.battle.start, because a mutiny
       that resolves in a dialog box is a number pretending to be a betrayal.

   SCREEN OWNERSHIP. Per CONTRACT.md this file takes the screen WITHOUT owning
   a phase: an event card happens *over* the campaign. It uses ctx.screen /
   ctx.closeScreen and hands it straight back, and it refuses to open at all
   unless the phase is `campaign` and the stage is empty — one card at a time,
   never on top of the outpost or the encounter. The single exception is the
   END of the run, which takes the unclaimed `over` phase, because that is not
   a card over the campaign, it is the campaign being finished.

   OWNED EVENTS
     events:card      {id}            a card went up
     events:choice    {id, choice}    the player picked
     events:loyalty   {loy, delta, why}
     events:weather   {kind, day}
     events:mutiny    {men, band}
     events:warlord   {name, fallen}  a rival warlord went out
     events:over      {kind, why}

   WHAT THIS FILE NEEDS FROM campaign.js — all of it optional, all of it
   already has a fallback (see THE DRIVER at the bottom):
     · W.events.maybeFire()  called when the player has ridden a while.
       If campaign never calls it, an onAlways ticker in this file measures
       the distance itself and calls it. Wiring it is nicer, not required.
     · W.events.travelBlocked()  true while a sandstorm says stop. Campaign
       may read it to refuse a new destination; if it never does, the storm
       card's MAKE CAMP choice is still the whole decision.

   2026-09-01 — THE CARDS GOT SHORTER AND THE STORM STOPPED DEAFENING
   PARTIES. Two owner complaints landed here: the copy (see THE CARD, and the
   deleted loyalty-formula paragraph in openLoyalty) and, indirectly, "after
   interacting with an army you can't again" — hideMe() was re-stamping a
   cooldown on every band within 340 m EVERY TICK, which at ten metres is an
   indefinite silent lockout. See NOT AT ARM'S LENGTH.

   FLAGS (repo doctrine: every behaviour switch reverts in one param)
     ?events=off     no road events at all. The pre-wave loop, byte for byte.
     ?loyalty=off    loyalty never moves and nobody ever mutinies
     ?weather=off    no sandstorms, no heat, no night cover
     ?endgame=off    the run can never end — no victory, no death
     ?event=<id>     DEBUG: fire that card on demand. `?event=list` prints the
                     library to the console. Never be blocked on a random roll.
     ?shown=off      THE SHOW-DON'T-TELL REVERT, and it is the same word in
                     warlord/territory.js. Everything below happens as it used
                     to: nobody walks in or out, no fire is lit, an ambush
                     lands wherever the sand allowed and a sentence is typed
                     about it. The state changes are identical either way —
                     this flag reverts the PICTURE and nothing else.

   2026-09-01 — SHOW DON'T TELL, THE SECOND PASS (owner: "death isn't shown …
   as does a ton of the app"). warlord/deaths.js fixed the death; this is the
   same failure everywhere else in this file, and it had one shape: a dramatic
   mechanic was an array mutation plus a string.
     · THE MUTINY was the worst of it. N men vanished out of the drawn column,
       and the band they became was built at {x: S.you.x, z: S.you.z} — inside
       you, geometrically — AND WAS NEVER PUSHED ONTO S.bands AT ALL, so it was
       not on the map, had no banner, and could not be seen from any camera on
       any frame. A card then described a fire and two sides that did not
       exist. They walk out now, across ground, to their own side of a fire
       this file lights, and campaign.js's own party() raises their banner over
       them the moment they are on S.bands — which is the whole "raise their
       banner" for free.
     · EVERY RECRUITMENT was W.toast("+" + men(n)) — the column riding behind
       you is the premise of campaign.js, and joiners were told three times
       (HUD, toast, log) and shown none. They arrive now: join() batches the
       men of one decision into a real party standing one CONTACT radius out,
       it walks in at the island's own band speed, and it folds into the
       roster when its road meets yours.
     · AN AMBUSH MATERIALISED 60 m FROM THE CAMERA and the game typed a
       sentence about it. spawnBandNear({hidden:true}) now puts them where the
       ground hides them from your eye and lays a dust road ahead of them, so
       the first thing you get is dust and the second is men over a rise.
   The eight toasts those three used to fire are gone from the game and kept
   behind ?shown=off — a thing that is shown does not also need to be narrated,
   and the A/B has to be able to measure the sentence it replaced rather than
   measure a deletion. Same reason warlord/deaths.js keeps the old plank
   behind ?deaths=old instead of leaving it behind in battle.js: one path in
   the game, one switch between the two answers.
============================================================ */
(function () {
  "use strict";
  const G = (typeof window !== "undefined" ? window : globalThis);
  const CBZ = (G.CBZ = G.CBZ || {});
  const W = (CBZ.warlord = CBZ.warlord || {});
  const S = W.state;

  const QP = (function () {
    try { return new URLSearchParams(G.location ? G.location.search : ""); }
    catch (e) { return { get: function () { return null; } }; }
  })();
  /* ?events=off IS THE WHOLE WAVE'S REVERT and it has to actually revert the
     whole wave, not just stop the cards: with it on, this file adds nothing to
     the page — no cards, no chips in the strip, no loyalty, no weather, no
     no leaderboard, no way to win or lose. That is the pre-wave game byte for
     byte, and it is what tools/visual-presets/warlord-events.mjs photographs
     as its BEFORE side. The three narrower flags exist to isolate ONE system
     while the rest keeps running, which is a different job. */
  const FLAG_NOEVENTS = QP.get("events") === "off";
  const FLAG_NOLOYALTY = FLAG_NOEVENTS || QP.get("loyalty") === "off";
  const FLAG_NOWEATHER = FLAG_NOEVENTS || QP.get("weather") === "off";
  const FLAG_NOEND = FLAG_NOEVENTS || QP.get("endgame") === "off";
  /* ONE FLAG FOR THE WHOLE SHOW-DON'T-TELL PASS, and warlord/territory.js
     reads the same word. Two files fixing one failure want one switch. */
  const FLAG_NOSHOW = FLAG_NOEVENTS || QP.get("shown") === "off";

  const E = W.events = W.events || {};
  const clamp = W.clamp;
  let ctx = null;

  const esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  };
  function safe(fn) { try { return fn(); } catch (e) { console.error("[warlord/events]", e); return null; } }

  /* ============================================================ THE BUCKET
     EVERYTHING THIS FILE REMEMBERS LIVES IN W.state.flags.ev, and that is the
     whole persistence story. flags is already inside the one state object, so
     the loyalty number, the memorial, the fallen rivals and the weather all
     survive a save, a load and a network hop for free — and none of it needs
     a second serialiser that would rot the first time somebody adds a field.
     Rebuilt lazily rather than at newgame, because a load has to be able to
     find an OLD bucket and keep it. */
  const BASE_HIRED = 0.82;      // a man who took your money chose you
  const BASE_PRESSED = 0.26;    // a man you took off a battlefield did not
  const BASE_JOINED = 0.58;     // a man who walked up and asked is in between
  const BASE_UNKNOWN = 0.6;

  function ev() {
    if (!S.flags) S.flags = {};
    let v = S.flags.ev;
    if (!v) {
      v = S.flags.ev = {
        loy: 72,            // 0..100. Starts high: on day one the army is you.
        base: {},           // soldier id -> where he came from (see above)
        stat: null,         // last stats snapshot, for provenance diffing
        fallen: [],         // the memorial: {name,tier,day,how}
        fired: {},          // event id -> day it last fired
        seen: 0,            // total events fired
        unrest: 0,          // consecutive dawns under the mutiny line
        warned: 0,          // day the ringleader card last went up
        wea: "clear", weaP: 0, weaDay: 0, wx: 1, wz: 0,
        camped: 0,          // day the player last sat a storm out
        /* `four` IS GONE. It was a frozen list of four warlord ids raised once
           at boot, and the run's whole win condition hung off it. The standing
           is DERIVED now — W.warlords.leaderboard(), read off the map and off
           S.bands every time anybody asks — so there is nothing here to raise,
           nothing to keep in sync and nothing to go stale when a fifth warlord
           takes half the north. What survives is the MEMORY: who you have seen
           broken, and whether the last war has started. */
        fell: [],           // {id,name,day,held,men} — the warlords who went out
        last: null,         // the last rival standing, once everyone else is out
        peak: 1,            // biggest this army ever was
        broke: 0,           // consecutive dawns with nothing at all
        contracts: [],      // {bandId, kind, pay, men, from}
        owed: null,         // a caravan/village debt riding with you
        over: null,         // {kind, why, day} once the run is finished
      };
    }
    return v;
  }

  /* ============================================================ LOYALTY
     THE MOST IMPORTANT NUMBER IN THIS FILE, so it is derived rather than typed.

     A man's BOND is where he came from plus what he has been through. Core
     already counts `battles` on every soldier, so a pressed levy who has
     survived six fights for you genuinely becomes yours — the redemption path
     is real and costs nothing to store. Executions poison the whole roster and
     poison the pressed men worst, which is the sentence the brief asks for
     ("conscripted enemies are less loyal") expressed as one term rather than
     as a second loyalty system for prisoners.

     ARMY LOYALTY then drifts toward the average bond every dawn, and gets
     SHOCKED by events. The drift is what makes composition matter: an army of
     conscripts has a ceiling near 26 and lives permanently one bad week from
     mutiny, an army you paid for sits near 82 and can absorb a disaster. That
     ceiling is why "recruit every prisoner, always" is not the free win it
     looks like on the aftermath screen.

     THE FIRST DRAFT MADE LOYALTY A PURE EVENT COUNTER and it was unplayable
     in the other direction: nothing pulled it back, so any run long enough to
     lose two battles ended in a mutiny regardless of how the army was built,
     and the number stopped being a thing you could steer. The drift term IS
     the steering. */
  function bondOf(s) {
    const b = ev().base[s.id];
    const base = b == null ? BASE_UNKNOWN : b;
    const blooded = 0.055 * Math.min(6, s.battles || 0);
    // a man who is hurt and still marching is a man with an opinion
    const hurt = s.wounded ? 0.06 : 0;
    const executed = (S.stats && S.stats.executed) || 0;
    // the poison scales with how little he chose to be here: 1.6-base is ~1.34
    // for a pressed man and ~0.78 for a volunteer
    const dread = executed * 0.011 * (1.6 - base);
    return clamp(base + blooded - hurt - dread, 0.03, 0.96);
  }

  function avgBond() {
    if (!S.army.length) return 1;      // an army of one cannot mutiny against itself
    let n = 0;
    for (let i = 0; i < S.army.length; i++) n += bondOf(S.army[i]);
    return n / S.army.length;
  }

  /* PROVENANCE. Nothing else in the game tells this file where a new man came
     from, and adding a field to the soldier would put a second author on
     core's shape. So the roster is reconciled against core's own counters: if
     stats.conscripted went up by two since last look and two strangers are
     standing in the army, those two were pressed. Men this file adds itself
     stamp their own base before addSoldier, so they never reach this path. */
  function reconcile() {
    const v = ev();
    const st = S.stats || {};
    const prev = v.stat || {};
    let con = (st.conscripted || 0) - (prev.conscripted || 0);
    let rec = (st.recruited || 0) - (prev.recruited || 0);
    const live = {};
    for (let i = 0; i < S.army.length; i++) {
      const s = S.army[i];
      live[s.id] = 1;
      if (v.base[s.id] != null) continue;
      if (con > 0) { v.base[s.id] = BASE_PRESSED; con--; }
      else if (rec > 0) { v.base[s.id] = BASE_HIRED; rec--; }
      else v.base[s.id] = BASE_UNKNOWN;
    }
    // a man who left takes his row with him — otherwise a long run leaks a
    // map with every soldier who ever served in it
    const keys = Object.keys(v.base);
    if (keys.length > S.army.length + 40) {
      for (let i = 0; i < keys.length; i++) if (!live[keys[i]]) delete v.base[keys[i]];
    }
    v.stat = { conscripted: st.conscripted || 0, recruited: st.recruited || 0,
               executed: st.executed || 0, lost: st.lost || 0, battles: st.battles || 0 };
    if (W.armySize() > v.peak) v.peak = W.armySize();
  }

  /* DID CORE PAY THEM THIS MORNING. Reading S.gold after the fact does not
     answer it: core deducts the wage bill and a warlord who paid his last
     dollar ends the dawn on zero looking exactly like one who paid nothing.
     core.js logs the two cases in different words on its way through, and the
     "log" event fires BEFORE the "dawn" event, so the sentence itself is the
     signal — exact, and it costs one listener. */
  let unpaidToday = false;
  W.on("log", function (row) {
    if (row && typeof row.text === "string" && row.text.indexOf("could not pay") === 0) unpaidToday = true;
  });

  function loyalty() { return Math.round(ev().loy); }
  /* WHY YOUR ARMY CHANGED ITS MIND. Every caller in this file already hands
     one in — "they watched you do it yourself", "you paid another warlord",
     "the heat took the hurt" — thirty-odd authored lines, and every one of
     them was put into an event nobody listens to and thrown away. The number
     moved on a chip and the reason evaporated, which is the show-don't-tell
     failure the other way round: the CONSEQUENCE was visible and the CAUSE
     was not. So the reason is kept and rides on the chip that moved.

     AND A CROSSING IS AN EVENT. The threshold is not a taste number: the
     MOODS table above already divides 0..100 into six named states, so "did
     this matter" is answered by "does your army have a different name for
     itself now" rather than by a magnitude somebody picked. A crossing gets
     a cue and a pulse on the chip in the direction it went; a drift does not,
     because a warlord who is warned every time a number ticks stops reading
     the warnings. */
  function loyMove(delta, why) {
    if (FLAG_NOLOYALTY) return;
    const v = ev();
    const was = v.loy;
    const wasMood = mood().label;
    v.loy = clamp(v.loy + delta, 0, 100);
    if (Math.abs(v.loy - was) < 0.5) return;
    if (why) { v.why = why; v.whyDay = S.day; }
    const nowMood = mood().label;
    if (nowMood !== wasMood && !FLAG_NOSHOW) {
      v.pulse = v.loy > was ? 1 : -1;
      if (W.feel && W.feel.ui) safe(function () { W.feel.ui(v.loy > was ? "good" : "bad"); });
    }
    W.emit("events:loyalty", { loy: v.loy, delta: v.loy - was, why: why || "" });
    paintChips();
  }

  /* ============================================================ PUBLISHED
     TWO SEAMS army.js's aftermath acts through, because that screen makes
     decisions whose cost is denominated in this file's currency and the
     alternative is army.js keeping its own second opinion about loyalty.

     provenance() — WHERE A MAN CAME FROM, SAID OUT LOUD. reconcile() below
     infers it by diffing core's stat counters against the roster, which is
     exact while one kind of man arrives at a time and wrong the instant one
     screen adds nineteen volunteers and twelve pressed men in the same frame:
     the counters say "12 conscripted, 19 recruited" and the array says nothing
     about which is which, so the first twelve strangers get the pressed man's
     bond whoever they actually are. The aftermath is the only place in the
     game that does that, so it stamps each man as it adds him.

     settle() — A DECISION THAT CHANGED WHO THIS ARMY IS, PAID NOW INSTEAD OF
     OVER A FORTNIGHT. Both of the aftermath's costly verbs move the CEILING
     rather than the number: pressed men have a low bond, and every execution
     poisons every bond through bondOf's dread term. Loyalty drifts toward that
     ceiling at 0.3 a dawn, so without this the player presses a button, sees
     nothing happen, and mutinies two weeks later for reasons he cannot connect
     to anything. Nothing new is invented and NO MAGNITUDE IS TYPED: it is the
     ceiling that just moved, arriving when the decision does. */
  /* AND THE THREE BASES THEMSELVES, because army.js's willing/unwilling roll
     is asking the identical question these numbers already answer: how much of
     a man's own choice was it. BASE_JOINED — "a man who walked up and asked is
     in between", 0.58 — IS the odds that a captured man would rather march
     than walk, so the roll is centred on it rather than on a number picked to
     feel right. The first draft of that roll centred on 0.92 (the old PAID
     conscription's success odds, which is a different question with money in
     it) and photographed "27 WILL MARCH FOR YOU · 0 WILL NOT" — a decision
     screen with nothing on it to decide. */
  E.BASE = { hired: BASE_HIRED, pressed: BASE_PRESSED, joined: BASE_JOINED, unknown: BASE_UNKNOWN };
  E.provenance = function (s, kind) {
    if (!s) return null;
    const v = ev();
    v.base[s.id] = kind === "pressed" ? BASE_PRESSED : kind === "joined" ? BASE_JOINED : BASE_HIRED;
    return v.base[s.id];
  };
  E.settle = function (why) {
    reconcile();
    const v = ev();
    const ceiling = avgBond() * 100;
    if (ceiling < v.loy) loyMove(ceiling - v.loy, why || "");
    return Math.round(ceiling);
  };

  const MOODS = [
    { at: 82, label: "DEVOTED",  cls: "good", note: "they would follow you into the sea." },
    { at: 64, label: "SOLID",    cls: "",     note: "they grumble and they march." },
    { at: 46, label: "UNEASY",   cls: "",     note: "men are talking in the dark." },
    { at: 30, label: "SULLEN",   cls: "bad",  note: "nobody meets your eye." },
    { at: 18, label: "SEETHING", cls: "bad",  note: "there is a faction now, and it has a name." },
    { at: -1, label: "MUTINOUS", cls: "bad",  note: "they are deciding tonight." },
  ];
  function mood() {
    const l = loyalty();
    for (let i = 0; i < MOODS.length; i++) if (l >= MOODS[i].at) return MOODS[i];
    return MOODS[MOODS.length - 1];
  }

  /* THE RINGLEADER is the man with the most authority and the least reason to
     use it on your behalf: tier picks who the others would follow, bond picks
     who wants to. A levy with a grudge leads nobody. */
  function ringleader() {
    let best = null, bs = -1;
    for (let i = 0; i < S.army.length; i++) {
      const s = S.army[i];
      const score = (W.tierIndex(s.tier) + 1) * (1 - bondOf(s));
      if (score > bs) { bs = score; best = s; }
    }
    return best;
  }

  /* who would actually walk. Sorted worst-bond first so the faction is the
     men who have the least reason to stay, not a random slice. */
  function faction(frac) {
    const list = S.army.slice().sort(function (a, b) { return bondOf(a) - bondOf(b); });
    const n = Math.max(1, Math.round(list.length * clamp(frac, 0.05, 1)));
    return list.slice(0, n);
  }

  /* ============================================================ MEMORIAL
     The run summary's whole point is the list of names, so every way a man of
     yours can die writes one row. Capped, because a thousand-man campaign with
     four hundred dead is a save file made mostly of tombstones — the summary
     shows the first losses and the last, which is the shape you remember. */
  function bury(s, how) {
    const v = ev();
    v.fallen.push({ name: s.name, tier: s.tier, day: S.day, how: how || "battle",
                    battles: s.battles || 0, kills: s.kills || 0 });
    if (v.fallen.length > 400) v.fallen.splice(120, 1);
  }

  /* ============================================================ WEATHER
     THE DESERT IS AN OPPONENT, and it is the only opponent that does not care
     how many men you have.

     Rolled ONCE at dawn off a positional hash of the day and where you slept,
     so the same seed produces the same week — a weather system that rerolls
     per frame is a weather system you cannot plan around. The odds are biased
     by biome because that is the only way the map's own regions get to mean
     something: a salt pan cooks, a dune sea blows, an oasis is mild. */
  const WEATHER = {
    clear:  { label: "CLEAR",     note: "hard light, no wind." },
    heat:   { label: "KILLING HEAT", note: "the air over the pan is white. The hurt will not all make it." },
    storm:  { label: "SANDSTORM", note: "a brown wall on the horizon, and it is coming." },
    haze:   { label: "DUST HAZE", note: "the far shore is gone. So are you, to anyone looking." },
  };

  function rollWeather() {
    const v = ev();
    if (FLAG_NOWEATHER) { v.wea = "clear"; v.weaP = 0; return; }
    const D = W.desert;
    const b = (D && D.biomeAt) ? D.biomeAt(S.you.x, S.you.z) : "dune";
    const r = W.hash01(S.day * 13.7, (S.seed | 0) % 977, 4801);
    const r2 = W.hash01(S.day * 3.1, (S.seed | 0) % 613, 4813);
    // biome bias: how much of the roll goes to each antagonist
    let pStorm = 0.10, pHeat = 0.13, pHaze = 0.10;
    if (b === "salt") { pHeat = 0.34; pStorm = 0.12; }
    else if (b === "dune") { pStorm = 0.24; pHeat = 0.16; }
    else if (b === "gravel") { pStorm = 0.16; pHaze = 0.16; }
    else if (b === "oasis" || b === "wadi") { pHeat = 0.05; pStorm = 0.05; }
    else if (b === "shore" || b === "sea") { pStorm = 0.07; pHeat = 0.04; pHaze = 0.16; }
    let kind = "clear";
    if (r < pStorm) kind = "storm";
    else if (r < pStorm + pHeat) kind = "heat";
    else if (r < pStorm + pHeat + pHaze) kind = "haze";
    v.wea = kind;
    v.weaP = kind === "clear" ? 0 : clamp(0.45 + r2 * 0.55, 0.4, 1);
    v.weaDay = S.day;
    const ang = W.hash01(S.day * 7.3, 11, 4831) * Math.PI * 2;
    v.wx = Math.cos(ang); v.wz = Math.sin(ang);
    W.emit("events:weather", { kind: kind, p: v.weaP, day: S.day });
    if (kind !== "clear") W.log("dawn — " + WEATHER[kind].label.toLowerCase() + ".", kind === "clear" ? "" : "bad");
  }

  /* IS IT DARK. The clock is real (campaign advances S.hour with metres
     ridden), so night is a fact about the state and not a second timer. */
  function isNight() { return S.hour < 5.4 || S.hour > 20.4; }

  /* HOW FAR YOU CAN SEE, in metres, and it is the number the fog is set from
     rather than a mood. The campaign's own haze is fogFar 11000 (warlord.html);
     a full sandstorm takes that to a fifth of it, a haze to two thirds. Same
     shape blizzard.js uses (S.vis feeding ctx.env.fogFar) — that file is the
     model this one copies. */
  const FOG_CLEAR_NEAR = 1400, FOG_CLEAR_FAR = 11000;
  function visibility() {
    const v = ev();
    if (FLAG_NOWEATHER) return FOG_CLEAR_FAR;
    let f = FOG_CLEAR_FAR;
    if (v.wea === "storm") f = W.lerp(FOG_CLEAR_FAR, 1500, v.weaP);
    else if (v.wea === "haze") f = W.lerp(FOG_CLEAR_FAR, 5200, v.weaP);
    if (isNight()) f *= 0.62;
    return f;
  }

  /* ---- the sandstorm, drawn out of things that already exist ---- */
  let weatherInjected = false;
  function ensureWeatherFile() {
    if (weatherInjected) return;
    weatherInjected = true;
    // systems/weather.js is in no studio pack, so it is pulled directly. It
    // bails at load unless CBZ.scene and CBZ.camera exist, which they do by
    // the time any storm can run. NOT forked — injected and then driven.
    safe(function () {
      const root = (CBZ.studio && CBZ.studio.root) || "../src/";
      const s = document.createElement("script");
      s.src = root + "systems/weather.js";
      s.async = false;
      s.onerror = function () { console.warn("[warlord/events] weather.js unavailable — fog-only storm"); };
      document.head.appendChild(s);
    });
  }

  /* THERE IS NO PARTICLE CLOUD IN THIS SANDSTORM, AND THAT IS THE ANSWER
     RATHER THAN A GAP. Three drafts of one went in — CBZ.fx.particleCloud,
     the pooled Points every disaster in this repo throws rain and ash out of,
     which was the right thing to reach for and is still the right thing for a
     camera standing in the weather. Photographed at this camera it never once
     read as sand:

       draft 1  radius 42, size 0.42, no drift — a small ball of motes hanging
                around the lens 25 m above a valley you can see for kilometres
                across. On the phone frame: six white squares in the corner of
                the sky.
       draft 2  radius 170, drift 34 m/s — the arithmetic kills it. A mote
                spawned 120 m up falling at 4 m/s needs thirty seconds to reach
                eye level and the wind carries it out of the cloud in five, so
                every mote recycled while still high overhead.
       draft 3  radius 300, drift 9, 900 motes — the geometry finally worked
                and the LOOK still did not. Untextured Points are squares; at
                sand colour they are invisible against sand and visible only
                against the sky, so a storm rendered as pale confetti hanging
                over a clear desert. Worse than nothing, because it reads as a
                bug rather than as weather.

     What actually carries a sandstorm at a strategic camera is the AIR: the
     far shore stops existing (the fog far-plane, below) and the whole sky goes
     brown (tintStorm, below). Both of those are one line each and both are
     measurable. So the cloud is gone rather than left in at 5% opacity to
     prove something was attempted. If this game ever gets a ground-level
     camera — a battle fought inside a storm — fx.particleCloud is still the
     right call there, and drafts 1-3 above are the numbers not to use. */

  /* HOW BROWN THE AIR IS, 0..1 — one number, so the fog far-plane, the fog
     colour and the sky dome can never disagree about how bad it is. */
  function stormTint() {
    const v = ev();
    if (FLAG_NOWEATHER || W.phase() !== "campaign") return 0;
    return v.wea === "storm" ? v.weaP : v.wea === "haze" ? v.weaP * 0.4 : 0;
  }

  /* THE COLOUR OF THE AIR IS campaign.js's, AND THAT IS WHY THIS IS A FRAME
     HOOK AND NOT PART OF THE TICK ABOVE.

     campaign.js's tintDay() writes scene.fog.color, scene.background and the
     sky dome's two uniforms ABSOLUTELY every frame off its day-cycle
     keyframes — that is correct, it owns the clock. systems/weather.js does
     its own fog lerp from an `always` hook, and always hooks run BEFORE frame
     hooks, so on this page weather.js's ochre was being overwritten by the
     day tint sixty times a second and MEASURED as a 1-hex-digit change: the
     first sandstorm screenshot had a perfectly clear blue-and-cream sky in it.

     So the storm tint runs as a frame hook at order 20 — after campaign's -20
     — and LERPS what the day cycle just decided toward sand rather than
     replacing it. A sandstorm at dawn is still a dawn. weather.js keeps the
     job it can actually do here, which is the wind vector everything reads. */
  const _sand = { lo: 0xc2914f, hi: 0x9d7440 };
  let _cA = null, _cB = null;
  function tintStorm() {
    const k = stormTint();
    if (k < 0.004) return;
    const THREE = G.THREE;
    if (!THREE) return;
    if (!_cA) { _cA = new THREE.Color(); _cB = new THREE.Color(); }
    const scene = CBZ.scene;
    _cA.setHex(_sand.lo);
    const kk = Math.min(0.92, k);
    if (scene && scene.fog && scene.fog.color) scene.fog.color.lerp(_cA, kk);
    if (scene && scene.background && scene.background.isColor) scene.background.lerp(_cA, kk);
    const dome = CBZ.micro && CBZ.micro.skyDome;
    if (dome && dome.material && dome.material.uniforms) {
      const u = dome.material.uniforms;
      if (u.bottomColor && u.bottomColor.value) u.bottomColor.value.lerp(_cA, kk);
      if (u.topColor && u.topColor.value) { _cB.setHex(_sand.hi); u.topColor.value.lerp(_cB, Math.min(0.85, k)); }
    }
  }

  let fogSaved = null;
  function driveWeather(dt, rawDt) {
    rawDt = rawDt == null ? dt : rawDt;
    const v = ev();
    const scene = CBZ.scene;
    const live = !FLAG_NOWEATHER && W.phase() === "campaign" && (v.wea === "storm" || v.wea === "haze" || isNight());
    const stormK = stormTint();

    if (!live) {
      /* THE FOG IS SHARED AND battle.js SAVES IT. It stashes scene.fog on the
         way into a fight and puts it back on the way out — so a storm that was
         still easing its fog back while the battle started would have its
         half-restored numbers saved as "the campaign's fog" and written back
         permanently on teardown. The island would come out of one sandstorm
         wearing it forever. So leaving the campaign SNAPS the fog back in the
         same frame rather than easing; only an ongoing campaign gets the ease. */
      if (fogSaved && scene && scene.fog) {
        if (W.phase() !== "campaign") {
          scene.fog.far = fogSaved.far; scene.fog.near = fogSaved.near; fogSaved = null;
        } else {
          scene.fog.near += (fogSaved.near - scene.fog.near) * Math.min(1, dt * 1.2);
          scene.fog.far += (fogSaved.far - scene.fog.far) * Math.min(1, dt * 1.2);
          if (Math.abs(scene.fog.far - fogSaved.far) < 30) { scene.fog.far = fogSaved.far; scene.fog.near = fogSaved.near; fogSaved = null; }
        }
      }
      return;
    }

    if (!fogSaved && scene && scene.fog) fogSaved = { near: scene.fog.near, far: scene.fog.far };
    if (scene && scene.fog) {
      /* VISIBILITY IS THE MECHANIC, so it is written onto the fog rather than
         faked with a screen tint: the far shore genuinely stops existing, and
         the bands you could see from the dune stop being visible with it. */
      const wantFar = visibility();
      const wantNear = W.lerp(FOG_CLEAR_NEAR, 90, clamp(stormK, 0, 1));
      /* 1.6 rather than 0.9, and the dt is NOT the tick's clamped one: this
         page runs at two frames a second under SwiftShader, and clamping dt to
         0.1 there meant the storm needed thirty real seconds to close the
         horizon — measured, on the very screenshot that was supposed to show
         it arriving. A ramp has to be in SECONDS, not in frames. */
      const k = Math.min(1, Math.min(0.5, rawDt) * 1.6);
      scene.fog.far += (wantFar - scene.fog.far) * k;
      scene.fog.near += (wantNear - scene.fog.near) * k;
    }

    if (stormK > 0.02) {
      ensureWeatherFile();
      /* THE ONE WEATHER. Same adoption call systems/blizzard.js makes, with a
         desert's numbers instead of a whiteout's: no rain, no snow, the wind
         asserted every frame with a short hold so the release eases. This is
         why there is no wind field of our own anywhere in this file — anything
         else on this island that wants to know which way the sand is going
         (a banner, a mount, the mixer) reads CBZ.weatherWind() and gets the
         same vector the fog was built from.

         weather.js's OWN fog term is asserted here too and does not win on
         this page — campaign.js rewrites scene.fog.color absolutely every
         frame from its day cycle, which is correct and is why tintStorm exists
         below. It is left in the call because it costs nothing and it is the
         right thing on any page that does not have a day-tint of its own. */
      if (CBZ.weatherDrive) {
        CBZ.weatherDrive({
          rain: 0, snow: 0,
          wind: 9 + 16 * stormK, windDir: { x: v.wx, z: v.wz },
          fog: 0.35 + 0.5 * stormK, fogColor: 0xc59a5c,
        }, 0.6);
      }
    }

  }

  /* THE STORM AND THE DARK BOTH HIDE YOU, and that is a real mechanic rather
     than a caption: a band that cannot see you cannot start an encounter.

     THE COOLDOWN IS THE MECHANISM. campaign.js's contact test only fires the
     encounter when `b.cooldown <= 0`, so holding it above zero on everything
     within the cover radius genuinely means they ride past you — and it does
     it without this file reaching into campaign's contact test, which is not
     ours to edit. The mood nudge underneath is only a nudge: campaign's own AI
     re-decides hunt/flee off the power ratio about every 1.5 s and will happily
     put a strong band back on hunt. That is correct — a sandstorm should hide
     you, not delete somebody's intentions. */
  /* NOT AT ARM'S LENGTH, AND THIS WAS A SILENT SOFTLOCK.

     The rule above is right at range and was catastrophic at zero. The stamp
     is `cooldown = 2` and it was re-applied EVERY TICK to every band inside
     340-480 m — so it re-armed far faster than campaign.js drains it, and a
     party standing ten metres from your horse in a sandstorm could never be
     engaged, for as long as the storm lasted, with nothing on screen saying
     why. That is the owner's "you can't interact with an army again" bug in
     its worst form: not one to three minutes, but indefinite.

     It is also simply wrong about the world. Cover hides you from somebody
     who has to FIND you; it does not hide you from a man you could hand a
     canteen to. So the rule now starts at NEAR metres and does nothing
     inside it. 55 m is a little over twice campaign.js's own 26 m contact
     radius, so there is a real band of sand where a storm is still buying you
     a way past a column, and no band at all where a party you are standing in
     the middle of pretends not to see you. */
  const HIDE_NEAR = 55;
  function hideMe(dt) {
    if (FLAG_NOWEATHER) return;
    const v = ev();
    const cover = (v.wea === "storm" ? v.weaP : 0) + (isNight() ? 0.55 : 0) + (v.wea === "haze" ? v.weaP * 0.3 : 0);
    if (cover < 0.35) return;
    const r = 340 * clamp(cover, 0, 1.4);
    for (let i = 0; i < S.bands.length; i++) {
      const b = S.bands[i];
      const d = Math.hypot(b.x - S.you.x, b.z - S.you.z);
      if (d > r || d < HIDE_NEAR) continue;
      if (b.cooldown < 2) b.cooldown = 2;
      if (b.mood === "hunt" && cover > 0.7) b.mood = "roam";
    }
  }

  /* ============================================================ THE CARD
     ULTRA-SIMPLE CONTROLS IS THE WHOLE GAME'S HARD REQUIREMENT, so an event is
     a headline, two lines of prose and two or three big buttons. Never a form,
     never a slider, never a number you type. The button carries its own price
     on a second line, because "what does this cost me" is the only question
     the player is actually asking.

     TWO LINES, NOT FOUR — 2026-09-01, and the rule that got it there. Every
     body in the library had a third sentence and the third sentence was
     always one of two things:

       · THE CARD READING ITS OWN MENU. The sandstorm said "You can put the
         men down behind the trucks and let it pass, which costs you the day,
         or you can ride into it and keep the day" — directly above two
         buttons reading SIT IT OUT and RIDE INTO IT with those exact costs
         chipped on them. The old soldier's card ended "he says the second one
         is the better deal for you and he is right", which is the interface
         recommending a button. The duel printed "You would win this about 61
         times in a hundred" over a button chipped "61%".
       · A CONSEQUENCE THAT IS A METER. "they will not be loyal", "the rest
         remember you", "your men know what they just did" — all of them are
         loyMove() calls, and loyMove is a bar this file already draws.

     THE HINT IS A PRICE TAG, NOT A SENTENCE. Same pass: every
     `hint: gold >= p ? "-$" + p + " · …" : "you do not have $" + p` collapsed
     to the price alone. A button you cannot afford is already disabled and
     already dimmed, and the gold you have is in the strip at the top of the
     screen — three ways of saying it, one of which was a full clause that
     changed the card's height depending on your purse. And nine choices
     carried `hint: "nothing changes"`, which is a caption on the absence of a
     consequence: RIDE ON does not need to be told it is RIDE ON. */
  let CARD = null;

  function css() {
    if (document.getElementById("wlEvCss")) return;
    const s = document.createElement("style");
    s.id = "wlEvCss";
    s.textContent = [
      ".wl-ev{max-width:640px;margin:0 auto}",
      ".wl-ev .tag{font-size:10px;letter-spacing:.28em;opacity:.45;margin-bottom:6px}",
      ".wl-ev .body{opacity:.9;line-height:1.5;font-weight:500;margin:6px 0 2px}",
      /* the same card body, docked in the verb rail with the party behind it */
      ".wl-evrail{opacity:.92;line-height:1.45;font-weight:500;font-size:13px;max-width:560px}",
      ".wl-pick{display:block;width:100%;text-align:left;margin:9px 0 0;padding:13px 15px}",
      ".wl-pick i{display:block;font-style:normal;font-size:11px;letter-spacing:.1em;opacity:.55;margin-top:5px;font-weight:500}",
      ".wl-meter{height:7px;border-radius:5px;background:rgba(255,255,255,.09);overflow:hidden;margin:7px 0 2px}",
      ".wl-meter i{display:block;height:100%;background:var(--hot);transition:width .3s}",
      ".wl-meter.good i{background:#5aa86a}.wl-meter.bad i{background:var(--blood)}",
      ".wl-ch{max-width:760px;margin:0 auto}",
      ".wl-ch .day{font-size:10px;letter-spacing:.24em;opacity:.4;margin:14px 0 4px}",
      ".wl-ch .ln{padding:3px 0;font-weight:500;opacity:.86;line-height:1.4}",
      ".wl-ch .ln.bad{color:#ffc9c4}.wl-ch .ln.good{color:#c9ffd4}",
      ".wl-name{display:inline-block;margin:0 10px 4px 0;font-size:12px;opacity:.78;font-weight:500}",
      ".wl-name b{opacity:.45;font-size:10px;letter-spacing:.12em;font-weight:600}",
      /* AN EVENT CARD IS MODAL AND THE SHELL DOES NOT KNOW THAT. #stage is
         z-index 40, campaign.js's own furniture (the MAP button, the zoom
         pair, the compass, the nameplates) is 45 and warlord.html's strip is
         50 — so the first phone screenshot of this file came back with "35 MEN
         $1240 DAY 1" printed straight through the middle of the headline and
         a MAP button sitting on the card. Every OTHER screen in this game gets
         away with 40 because it changes PHASE, and campaign hides itself on
         the way out; this file deliberately does not change phase, so it has
         to lift its own screen instead. 55 clears the strip and the furniture
         and still sits UNDER the world map (60) and the toasts (70), which is
         right: the map is a bigger claim on the screen than a card is. */
      "body.wl-card-up #stage{z-index:55}",
      "#hud .chip.act{pointer-events:auto;cursor:pointer;opacity:.95}",
      "#hud .chip.act:hover{color:var(--hot)}",
      /* THE STAT TILES ARE THIS FILE'S, NOT THE SHELL'S. The shell's .wl-grid
         is minmax(180px,1fr), which is right for the outpost's stock rows and
         wrong here: at 393pt it collapses to ONE column, so the loyalty panel's
         three numbers became three full-width slabs and 500px of scrolling
         before the names — measured on the phone frame, which is the whole
         reason this preset shoots one. 112px puts three across on a phone and
         eight across on a laptop, which is what a row of numbers wants. */
      ".wl-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));gap:8px;margin-bottom:10px}",
      ".wl-stat{border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:9px 10px;background:rgba(255,255,255,.03)}",
      ".wl-stat b{display:block;font-size:19px;letter-spacing:-.01em;font-weight:700;margin-top:3px}",
      /* a man and his verdict, on one line that cannot wrap through itself:
         the first draft used the shell's .wl-row and "Ferro Mbeki VETERAN · 0
         FIGHTS" broke across the middle of the phrase with the verdict hanging
         off the right of the second line. */
      ".wl-man{display:flex;gap:10px;align-items:baseline;justify-content:space-between;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.06)}",
      ".wl-man:last-child{border-bottom:0}",
      ".wl-man .who{min-width:0}",
      ".wl-man .who i{display:block;font-style:normal;font-size:10px;letter-spacing:.16em;opacity:.45;margin-top:2px}",
      ".wl-man .st{font-size:10px;letter-spacing:.14em;opacity:.62;white-space:nowrap;text-align:right;flex:0 0 auto}",
      ".wl-four{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px}",
      ".wl-four .w{border:1px solid rgba(255,255,255,.12);border-radius:13px;padding:11px 12px;background:rgba(255,255,255,.03)}",
      ".wl-four .w.dead{opacity:.42;border-color:rgba(196,69,58,.4)}",
      ".wl-four .w b{display:block;font-size:14px;letter-spacing:.04em;margin-bottom:3px}",
      /* THE ARMY CHANGED ITS MIND ABOUT YOU. One second, once, on the chip
         that carries the number — the same "point at the thing that moved"
         deaths.js's rim tick is. No new element and no new text. */
      "@keyframes wlEvUp{0%{transform:translateY(4px);color:#9fe6ac}60%{color:#9fe6ac}100%{transform:none}}",
      "@keyframes wlEvDn{0%{transform:translateY(-4px);color:#ff8f86}60%{color:#ff8f86}100%{transform:none}}",
      "#hud .chip.wl-up{animation:wlEvUp 1s ease-out 1}",
      "#hud .chip.wl-dn{animation:wlEvDn 1s ease-out 1}",
      "@media (max-width:430px){.wl-h{font-size:24px}.wl-ev .body{font-size:14px}.wl-stat b{font-size:16px}}",
    ].join("\n");
    document.head.appendChild(s);
  }

  /* ONE DOOR IN AND ONE DOOR OUT for everything this file puts on screen, so
     the modal class can never be left on the body by a path that forgot it. */
  function takeScreen(html) {
    try { document.body.classList.add("wl-card-up"); } catch (e) {}
    return ctx.screen(html);
  }
  function giveBackScreen() {
    try { document.body.classList.remove("wl-card-up"); } catch (e) {}
    if (ctx && ctx.closeScreen) ctx.closeScreen();
    if (ctx && ctx.paintHud) ctx.paintHud();
  }

  function canOpen() {
    if (!ctx || !ctx.screen) return false;
    if (CARD) return false;
    if (W.phase() !== "campaign") return false;
    const st = ctx.el ? ctx.el("stage") : document.getElementById("stage");
    if (st && st.classList.contains("on")) return false;   // somebody else owns it
    /* AND NOT OVER THE WORLD MAP. campaign.js's #wlMap is z-index 60 — above
       the lift above — so a card fired while the player is reading the island
       would go up UNDERNEATH it and be answered blind. It is also simply rude:
       he is in the middle of deciding where to ride. */
    const map = document.getElementById("wlMap");
    if (map && getComputedStyle(map).display !== "none") return false;
    // and not over somebody else's rail — the encounter, an outpost's verbs
    if (ctx.verbsOpen && ctx.verbsOpen()) return false;
    return true;
  }

  /* the ride stops when a card goes up. campaign.js owns the destination, so
     it is asked to stand still rather than reached into — one call, and the
     game does not argue with a player who is reading. */
  function halt() {
    if (W.campaign && W.campaign.dest) safe(function () { W.campaign.dest(S.you.x, S.you.z); });
  }

  /* A CARD WITH PEOPLE BEHIND IT IS A RAIL. See THE CAST: the screen is an
     opaque panel, and a decision about men you can no longer see is the popup
     the owner reported. Same choices, same handlers, same events:card /
     events:choice on the bus — only the surface differs, and it is the page's
     own ctx.verbs, which halts nothing this file does not already halt and
     closes itself before a handler runs. */
  function showRail(card) {
    css();
    CARD = card;
    card.rail = true;
    railT = 0;
    halt();
    lensAt(card.band);
    const choices = (card.choices || []).filter(function (c) { return c && (c.show == null || c.show); });
    const opts = [];
    for (let i = 0; i < choices.length; i++) {
      (function (c) {
        opts.push({
          label: esc(c.label), note: c.hint ? esc(c.hint) : "",
          kind: c.cls === "hot" ? "hot" : c.cls === "bad" ? "bad" : "",
          disabled: c.enabled === false,
          on: function () {
            W.emit("events:choice", { id: card.id, choice: c.key || c.label });
            CARD = null;
            safe(function () { if (c.run) c.run(); });
            safe(function () { settleCast(card); });
            safe(paintChips);
            if (ctx.paintHud) ctx.paintHud();
          },
        });
      })(choices[i]);
    }
    /* the rail's head is one line; the tag ("ON THE ROAD") is the short
       half, and a long headline drops even that rather than truncate itself */
    const headline = plainText(card.title);
    ctx.verbs({
      title: esc(headline),
      sub: headline.length > 20 ? "" : esc(card.tag || card.sub || ""),
      body: '<div class="wl-evrail">' + card.body + '</div>',
      options: opts,
    });
    W.emit("events:card", { id: card.id });
    return CARD;
  }

  function showCard(card) {
    if (card.band && ctx && ctx.verbs) return showRail(card);
    css();
    CARD = card;
    halt();
    const choices = (card.choices || []).filter(function (c) { return c && (c.show == null || c.show); });
    let html =
      '<div class="wl-ev">' +
      (card.tag ? '<div class="tag">' + esc(card.tag) + '</div>' : '') +
      '<h1 class="wl-h">' + card.title + '</h1>' +
      (card.sub ? '<p class="wl-sub">' + esc(card.sub) + '</p>' : '') +
      '<div class="wl-card"><div class="body">' + card.body + '</div></div>';
    for (let i = 0; i < choices.length; i++) {
      const c = choices[i];
      html += '<button class="wl-btn wl-pick ' + (c.cls || "") + '" id="evP' + i + '"' +
        (c.enabled === false ? " disabled" : "") + '>' + esc(c.label) +
        (c.hint ? '<i>' + esc(c.hint) + '</i>' : '') + '</button>';
    }
    html += '</div>';
    takeScreen(html);
    for (let i = 0; i < choices.length; i++) {
      const c = choices[i];
      const b = ctx.el("evP" + i);
      if (!b || c.enabled === false) continue;
      b.onclick = function () {
        W.emit("events:choice", { id: card.id, choice: c.key || c.label });
        closeCard();
        safe(function () { if (c.run) c.run(); });
        if (ctx.paintHud) ctx.paintHud();
      };
    }
    W.emit("events:card", { id: card.id });
    return CARD;
  }

  function closeCard() {
    const was = CARD;
    CARD = null;
    if (was && was.rail) {
      if (ctx && ctx.closeVerbs) ctx.closeVerbs();
      safe(function () { settleCast(was); });
      if (ctx && ctx.paintHud) ctx.paintHud();
    } else giveBackScreen();
    paintChips();
  }
  E.cardOpen = function () { return !!CARD; };
  /* PUBLISHED so another module can take the screen back if it genuinely needs
     it (and so a headless test can put a card away without a click). Nobody
     should be calling this to jump the queue — canOpen() already refuses to
     open over somebody else's phase. */
  E.close = function () { if (CARD) closeCard(); };

  /* ============================================================ HELPERS
     Small sentences the library uses over and over. Every one of them reads a
     real core number — this is where "no stat fiction" is actually enforced,
     because if the price of a thing is not W.gunPrice or W.tier().hire then
     there is no price of that thing. */
  function size() { return W.armySize(); }
  function men(n) { return n === 1 ? "1 man" : n + " men"; }
  function guns(n) { return n === 1 ? "1 gun" : n + " guns"; }
  function biome() { const D = W.desert; return (D && D.biomeAt) ? D.biomeAt(S.you.x, S.you.z) : "dune"; }
  function place() {
    const b = biome();
    return ({ dune: "the dune sea", salt: "the salt pan", rock: "the rock country",
              wadi: "the wadi", gravel: "the gravel flats", oasis: "the palms",
              shore: "the shore", sea: "the shallows" })[b] || "the sand";
  }

  /* ============================================================ THE STAGE
     WHERE THINGS ARE SHOWN INSTEAD OF SAID.

     Nothing in here draws anything. Every picture below is made out of parts
     the island already owns, and the whole point of the section is that no
     second version of any of them was built:

       a party of men     S.bands + campaign.js's own draw. Push a band onto
                          S.bands and campaign draws its men at the right LOD
                          and raises a banner over it whose height is log2 of
                          the head count (campaign.js:2901 party()). That is
                          the mutineers' banner and the joiners' banner, free.
       a road             W.sand.churn(x, z, {men, yaw}) — sand.js's own
                          trampled band-width track, its comment: "this is the
                          road you see from a ridge". Nothing on this island
                          laid one for a PARTY before this file did; sand.js
                          lays them for the player's own column only.
       dust               W.sand.puff(x, y, z, {amt})
       a fire             W.props.fire({...}) — props.js:752, self-animating,
                          and its smoke is the part that reads at range
                          (props.js:747: "at a kilometre the tents are two
                          pixels and the smoke is forty").

     THE NUMBERS. Three of them are campaign.js's own constants, restated here
     with their line numbers because they are `const`s inside its IIFE with no
     reader. If they change there, these are the lines to change.

       BAND_SPEED  6.2 m/s   campaign.js:157. Every party on this island walks
                             at it. Men leaving your column and men joining it
                             are parties, so they walk at it too — a second
                             walking speed would be a second answer to a
                             question that already has one.
       CONTACT_M   26 m      campaign.js:170. The radius at which the game
                             already decides a party is AT you. Men who have
                             just agreed to join were standing just outside it,
                             which is both where the card said they were and a
                             four-second walk rather than a chore.
       HEAD_M      1.75 m    a standing man's head, off city/ragdoll.js:118-127
                             (hips at 0.95 for this exact rig). Ground has to
                             rise this far above the sight line to actually
                             hide a man, which is what "they came over a ridge"
                             has to mean if it is to mean anything.
       FIRE_R      0.9 m     props.js:757 — fire()'s own default ring radius.

     AND ONE THING THAT IS NOT A NUMBER: A BAND'S cooldown. campaign.js:3229
     refuses engage() while it is above zero and campaign.js:3033 ticks it down
     every frame, so every party this file stages is RE-STAMPED every frame it
     is held (see holdBand). Without that, a band standing nine metres away is
     army.js's ENCOUNTER card opening on your own mutineers.

     AND IT ALL SWITCHES OFF ABOVE 2x. warlord/feel.js:1160's rule, quoted by
     deaths.js: "a fast-forward has no room for a beat". Three seconds of men
     walking out is twenty-four seconds of world at 8x, so above 2x every
     staged moment resolves on the frame it is asked for, exactly as it used
     to. Same for a page with no desert and no props: the picture is optional,
     the state change never is. */
  const BAND_SPEED = 6.2;
  const CONTACT_M = 26;
  const HEAD_M = 1.75;
  const FIRE_R = 0.9;

  function fastForward() { return !!(W.clock && W.clock.scale && W.clock.scale() > 2); }
  let staging = false;         // the ?event= debug stager is not a moment
  function canStage() {
    if (FLAG_NOSHOW || staging || !ctx) return false;
    if (W.phase() !== "campaign") return false;
    if (fastForward()) return false;
    const D = W.desert;
    return !!(D && D.heightAt && D.onLand && W.makeBand && W.sand);
  }

  function groundAt(x, z) {
    if (W.sand && W.sand.groundY) { const y = W.sand.groundY(x, z); if (isFinite(y)) return y; }
    const D = W.desert;
    return (D && D.heightAt) ? D.heightAt(x, z) : 0;
  }
  function widthOf(n) { return (W.sand && W.sand.bandWidth) ? W.sand.bandWidth(Math.max(1, n)) : 3; }
  function churn(x, z, n, yaw) {
    if (W.sand && W.sand.churn) safe(function () { W.sand.churn(x, z, { men: Math.max(1, n), yaw: yaw }); });
  }
  function puff(x, z, amt) {
    if (W.sand && W.sand.puff) safe(function () { W.sand.puff(x, groundAt(x, z), z, { amt: amt }); });
  }

  /* ---- BEATS. There is no scheduler in this repo (feel.js has no after(),
     core has no queue) and the four places that already stage a sequence all
     use setTimeout. A wall-clock timer is wrong here for campaign.js's own
     reason: this game's clock is a SPEED SLIDER, so a beat measured in wall
     seconds is a different beat at 1x and at 2x. These run on the same dt the
     rest of this file runs on, and they are all flushed the instant the phase
     leaves the island — a promise this file made and then dropped on the way
     into a battle would be worse than no picture at all. */
  let beats = [];
  function after(sec, fn) {
    if (!(sec > 0)) { safe(fn); return; }
    beats.push({ t: sec, fn: fn });
  }
  function stepBeats(dt) {
    if (!beats.length) return;
    const due = [];
    for (let i = beats.length - 1; i >= 0; i--) {
      beats[i].t -= dt;
      if (beats[i].t <= 0) { due.push(beats[i].fn); beats.splice(i, 1); }
    }
    for (let i = due.length - 1; i >= 0; i--) safe(due[i]);
  }
  function flushBeats() { const b = beats; beats = []; for (let i = 0; i < b.length; i++) safe(b[i].fn); }

  /* ---- PROPS THIS FILE LIGHTS. Added to one group of our own so a teardown
     is one traversal, and NOT through P.place(): place() registers rotated
     AABB colliders into the collision grid and rebuilds it, which is right for
     an outpost that stands for a campaign and pure churn for a campfire that
     stands for forty seconds. props.js's own tickAll drops a fire from its
     live list the frame it loses its parent, so removing it is the whole
     disposal. */
  let stageRoot = null;
  let lit = [];
  function root3() {
    if (stageRoot && stageRoot.parent) return stageRoot;
    const THREE = ctx && ctx.THREE;
    const scene = (ctx && ctx.scene) || CBZ.scene;
    if (!THREE || !scene) return null;
    stageRoot = new THREE.Group();
    stageRoot.name = "wlEventStage";
    scene.add(stageRoot);
    return stageRoot;
  }
  function fireAt(x, z, life) {
    const P = W.props;
    const r = root3();
    if (!P || !P.fire || !r) return null;
    let g = null;
    safe(function () { g = P.fire({ seed: Math.round(x * 13 + z * 7), r: FIRE_R }); });
    if (!g) return null;
    g.position.set(x, groundAt(x, z), z);
    r.add(g);
    lit.push({ g: g, t: life });
    return g;
  }
  function stepProps(dt) {
    for (let i = lit.length - 1; i >= 0; i--) {
      lit[i].t -= dt;
      if (lit[i].t > 0) continue;
      const g = lit[i].g;
      lit.splice(i, 1);
      if (g.parent) g.parent.remove(g);
      if (W.props && W.props.forget) safe(function () { W.props.forget(g); });
    }
  }
  function darkenStage() {
    for (let i = 0; i < lit.length; i++) {
      const g = lit[i].g;
      if (g.parent) g.parent.remove(g);
      if (W.props && W.props.forget) safe(function () { W.props.forget(g); });
    }
    lit.length = 0;
  }

  /* ---- A PARTY WALKING SOMEWHERE. It is driven here rather than left to
     campaign.js's stepBands for one reason: a joiner has to CHASE you and a
     mutineer has to stop on an exact mark, and stepBands answers neither. So
     its AI is stood down (pause > 0 makes its own speed zero, campaign.js:
     3075) and the position is written straight, at campaign's own speed. */
  let marches = [];
  function march(b, o) {
    o = o || {};
    marches.push({ b: b, tx: o.x, tz: o.z, chase: !!o.chase,
                   arrive: o.arrive == null ? 1 : o.arrive,
                   t: o.budget == null ? 20 : o.budget,
                   laid: 0, done: o.done || null });
  }
  /* A STAGED PARTY IS NOT AN ENCOUNTER, AND THE MARCH ENDING IS NOT THE END
     OF THAT. The first build stamped the cooldown from inside stepMarch, which
     is right while they are walking and stops the moment they stop — and the
     mutineers stop nine metres from you, well inside campaign.js:170's 26 m
     CONTACT. Three seconds later stepBands had ticked the cooldown to zero,
     checkContacts found them, and army.js's ENCOUNTER card came up over the
     mutiny: ATTACK / DEMAND / HIRE / INSPECT, on your own men, with the mutiny
     card still queued behind it. It also changed phase, which struck the set
     and put the fire out. Photographed, in the first ba run of this pass.
     So the hold is a LIST with an explicit release, not a side effect of
     walking. */
  let held = [];
  /* `b.held` IS THE FLAG THE REST OF THE ISLAND READS. campaign.js's stepBands
     skips a held party entirely (no AI, no walk, no cooldown tick), its
     off-screen war (resolveOneBandFight) will not pick one, and army.js's
     unstick belt will not clear its cooldown — so a party this file is
     standing in front of you cannot be marched off, deleted, or have the
     encounter rail opened on it by anybody else. The cooldown/pause stamps
     stay as the belt to that brace, for a campaign.js that predates the flag. */
  function holdBand(b) {
    if (held.indexOf(b) < 0) held.push(b);
    b.held = true;
    b.cooldown = Math.max(b.cooldown || 0, 3);
    b.pause = Math.max(b.pause || 0, 3);
  }
  function releaseBand(b) {
    const i = held.indexOf(b);
    if (i >= 0) held.splice(i, 1);
    b.held = false;
  }
  function stepHeld() {
    for (let i = held.length - 1; i >= 0; i--) {
      const b = held[i];
      if (S.bands.indexOf(b) < 0) { held.splice(i, 1); continue; }
      b.held = true;
      b.cooldown = Math.max(b.cooldown || 0, 3);
      b.pause = Math.max(b.pause || 0, 3);
    }
  }
  function stepMarch(dt) {
    for (let i = marches.length - 1; i >= 0; i--) {
      const m = marches[i];
      const b = m.b;
      holdBand(b);
      const tx = m.chase ? S.you.x : m.tx;
      const tz = m.chase ? S.you.z : m.tz;
      const dx = tx - b.x, dz = tz - b.z;
      const d = Math.hypot(dx, dz);
      m.t -= dt;
      if (d > m.arrive) {
        const k = Math.min(1, (BAND_SPEED * dt) / Math.max(0.001, d));
        b.x += dx * k; b.z += dz * k;
        b.yaw = Math.atan2(dx, dz);
        const D = W.desert;
        if (D && D.heightAt) b.y = D.heightAt(b.x, b.z);
        /* ONE TILE PER BAND-WIDTH OF TRAVEL. sand.js tiles a churn into
           <= 4.6 m quads itself; laying one every frame writes the same quad
           forty times a second and burns the ring buffer in two seconds. */
        m.laid += BAND_SPEED * dt;
        const w = widthOf(b.men.length);
        if (m.laid >= w) { m.laid = 0; churn(b.x, b.z, b.men.length, b.yaw); puff(b.x, b.z, 0.45); }
      }
      if (d <= m.arrive || m.t <= 0) { marches.splice(i, 1); safe(m.done); }
    }
  }

  /* ---- A DUST ROAD BEHIND A BAND THIS FILE SPAWNED. campaign.js walks the
     island's hundred-odd parties and lays nothing behind any of them, and
     laying one behind all of them is a hundred churns a second — not this
     file's call to make. So only the parties this file conjures get a road,
     which is exactly the ones the player is owed a warning about. */
  let trails = [];
  function trailBehind(b, secs) { trails.push({ b: b, x: b.x, z: b.z, t: secs }); }
  /* THE SET COMES DOWN THE MOMENT THE ISLAND DOES. Every march is completed
     where it stands (the men fall in, the mutineers reach their mark), every
     beat fires, every fire is put out. A picture this file started and then
     dropped on the way into a battle would leave men owed to a roster that
     never got them — the one failure worse than no picture. */
  function strikeSet() {
    const m = marches;
    marches = [];
    for (let i = 0; i < m.length; i++) safe(m[i].done);
    trails.length = 0;
    /* a party waiting on the OUTCOME of the battle you are walking into (the
       challengers watching a duel) keeps its hold through it; everybody else
       is let go, flag and all */
    const keep = [];
    for (let i = 0; i < held.length; i++) { if (held[i].await) keep.push(held[i]); else held[i].held = false; }
    held = keep;
    dropCast();
    flushBeats();
    darkenStage();
  }
  function stepTrails(dt) {
    for (let i = trails.length - 1; i >= 0; i--) {
      const r = trails[i];
      r.t -= dt;
      const b = r.b;
      if (r.t <= 0 || S.bands.indexOf(b) < 0) { trails.splice(i, 1); continue; }
      const d = Math.hypot(b.x - r.x, b.z - r.z);
      if (d < widthOf(b.men.length)) continue;
      churn(b.x, b.z, b.men.length, b.yaw || 0);
      puff(b.x, b.z, 0.55);
      r.x = b.x; r.z = b.z;
    }
  }

  /* ---- CAN YOU SEE THAT POINT FROM WHERE YOU ARE STANDING. A straight line
     between two men's heads, one probe per 40 m of it; if the ground anywhere
     along it stands above the line, the ridge hides him. This is the entire
     mechanism behind "they came over a rise", and it is the difference between
     a warband that appears and a warband that arrives. */
  function blocked(ax, az, bx, bz) {
    const D = W.desert;
    if (!D || !D.heightAt) return false;
    const ay = D.heightAt(ax, az) + HEAD_M, by = D.heightAt(bx, bz) + HEAD_M;
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.max(6, Math.min(40, Math.round(d / 40)));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (D.heightAt(ax + (bx - ax) * t, az + (bz - az) * t) > ay + (by - ay) * t) return true;
    }
    return false;
  }
  /* the nearest point in the annulus that the ground hides — nearest because
     a band you cannot see and cannot reach for two minutes is not a threat,
     it is homework. Falls back to the FARTHEST candidate, which is the other
     honest way to be out of sight on a hazy island. */
  function hiddenPoint(maxR) {
    const D = W.desert;
    if (!D || !D.landPoint) return null;
    const lo = CONTACT_M * 2;
    let best = null, bd = 1e18, far = null, fd = -1;
    /* TWENTY CANDIDATES. Fourteen found a ridge about half the time on the
       dune sea at seed 1337 and fell through to the distance fallback the
       other half; the cost of a rejected candidate is one landPoint and about
       eight heightAt calls, and this runs once, when a card is answered. */
    for (let i = 0; i < 20; i++) {
      const q = D.landPoint(W.rnd, { near: { x: S.you.x, z: S.you.z }, nearR: maxR });
      if (!q) continue;
      const d = Math.hypot(q.x - S.you.x, q.z - S.you.z);
      if (d < lo) continue;
      if (d > fd) { fd = d; far = q; }
      if (d < bd && blocked(S.you.x, S.you.z, q.x, q.z)) { bd = d; best = q; }
    }
    return best || far;
  }

  /* a man built by this file stamps his own provenance before he joins, so
     reconcile() never has to guess about him. */
  function join(tierId, wid, base, opts) {
    const s = W.makeSoldier(tierId, wid, opts);
    ev().base[s.id] = base;
    /* THEY ARRIVE. Six cards in this library used to answer "twelve men just
       joined you" with W.toast("+12 men") — the third telling of a fact the
       HUD and the log had already printed, about the one thing campaign.js
       exists to draw. The men are BATCHED rather than added, because a card's
       run() calls this in a loop and twelve separate one-man parties walking
       in is a queue, not a decision; the timeout is 0, i.e. the end of the
       click that caused them, so every join inside one answer is one party.
       Every future card gets this without knowing about it, which is the
       reason it lives in join() and not at six call sites. */
    if (!canStage()) { W.addSoldier(s); return s; }
    batch.push(s);
    if (!batchT) batchT = setTimeout(function () { batchT = 0; safe(sendBatch); }, 0);
    return s;
  }

  let batch = [], batchT = 0;
  function addAll(list) {
    for (let i = 0; i < list.length; i++) W.addSoldier(list[i]);
    reconcile();
    safe(paintChips);
  }
  function sendBatch() {
    const list = batch;
    batch = [];
    if (!list.length) return;
    if (!canStage()) { addAll(list); return; }
    /* WHERE THEY WERE STANDING. In front of you, one contact radius plus their
       own road's width out — the distance at which the game already considers
       a party to be somewhere else, so this is the nearest they could have
       been while still being "over there". A fan of bearings around your own
       heading because the first candidate can be sea or a mesa wall, and men
       who joined you must not be standing in the water. */
    const you = S.you;
    const D = W.desert;
    const want = CONTACT_M + widthOf(list.length);
    let p = null;
    for (let i = 0; i < 7 && !p; i++) {
      const a = (you.yaw || 0) + (i % 2 ? 1 : -1) * 0.42 * Math.ceil(i / 2);
      const q = { x: you.x + Math.sin(a) * want, z: you.z + Math.cos(a) * want };
      if (D.onLand(q.x, q.z)) p = q;
    }
    if (!p) { addAll(list); return; }
    const b = W.makeBand({ size: 1, faction: "militia", x: p.x, z: p.z });
    b.men = list.slice();
    b.name = "COMING OVER";
    b.gold = 0;
    b.mood = "roam";
    b.hostile = 0;
    /* THE MARK THAT SURVIVES A SAVE. S.bands is serialised; a party half way
       through joining when the game is saved would come back as a stray
       friendly band and twelve men who never arrived. sweepJoiners() folds
       any band carrying this flag straight into the roster on load. */
    b.joining = 1;
    stampCampaignFields(b);
    holdBand(b);
    S.bands.push(b);
    /* they have arrived when their road meets yours — the two half-widths
       sand.js would draw for the two parties, touching. */
    const meet = (widthOf(list.length) + widthOf(S.army.length)) / 2;
    march(b, { chase: true, arrive: meet,
               /* three contact radii at the island's own walking speed. Longer
                  than the walk needs and short enough that a player who turns
                  and rides is not waiting on it: the men fall in wherever he
                  got to. */
               budget: (CONTACT_M * 3) / BAND_SPEED,
               done: function () { fallIn(b); } });
  }
  function fallIn(b) {
    releaseBand(b);
    const i = S.bands.indexOf(b);
    if (i >= 0) S.bands.splice(i, 1);
    const list = b.men || [];
    b.men = [];
    b.joining = 0;
    if (!list.length) return;
    /* their road running into yours, at your feet. This is the only frame in
       which the two columns are one, and it is what the toast was for. */
    churn(S.you.x, S.you.z, list.length, S.you.yaw || 0);
    puff(S.you.x, S.you.z, 0.8);
    addAll(list);
  }
  function sweepJoiners() {
    for (let i = S.bands.length - 1; i >= 0; i--) {
      const b = S.bands[i];
      if (!b) continue;
      if (b.joining) { safe(function () { fallIn(b); }); continue; }
      /* a cast or a leaving party saved mid-moment comes back as the ordinary
         party it is — the hold and the walk-off were this session's, not the
         island's */
      if (b.transient) { S.bands.splice(i, 1); continue; }
      if (b.cast || b.held || b.await) { b.cast = null; b.held = false; b.await = 0; b.cooldown = 20; }
    }
  }

  /* ============================================================ THE CAST
     A CARD ABOUT PEOPLE IS A MEETING WITH PEOPLE, AND THE PEOPLE COME FIRST.

     THE REPORT (owner, 2026-09-01): "I will get a popup saying there's a guy
     or a group of guys, but often that person isn't actually on the map."

     He was describing this library. Twelve of the twenty-one cards open with a
     man or a party standing in front of you — MEN WITH NO FLAG in the shade of
     a wrecked truck, A MAN WITH A CRATE, AN OLD SOLDIER at his fire, A TOLL AT
     THE NARROWS with a truck across the gap, A WARLORD WITH A HOLE IN HIM and
     his column, a rider under a white rag — and not one of them put anybody on
     the sand before the card went up. The card was a full-screen panel (the
     #stage, an opaque gradient) over an island with nobody new on it, and the
     people it described existed only as the count in its headline. The three
     cards that DID spawn a party (toll, duel, column) spawned it as a
     CONSEQUENCE of a choice — the men you were told were sitting on both sides
     of the narrows were instantiated after you chose to go through them. That
     is the exact bug CONTRACT.md quotes from outpost.js ("BARREN DESERT AND MAN
     WITH A CRATE POPUP WITH NO MAN THERE"), fixed there and in army.js and
     never here, the file that generates most of the popups in the game.

     THE SHAPE OF THE FIX, and it is one rule: a people-card CASTS before it
     fires. When the road roll picks one, the party it is about is built by
     core (real soldiers, real guns, the same makeBand every band on the island
     comes out of), pushed onto S.bands so campaign.js draws it and raises its
     banner and names it on the nameplate, and put down on the road AHEAD of
     you — on land, in sight, a few hundred metres out — held there. Nothing
     else happens. You ride on, you see a party on the road, the nameplate says
     DESERTERS 140m, and when you reach them the card comes up as a VERB RAIL
     docked at the bottom of the screen (the page's own ctx.verbs, the same
     strip the encounter uses) with the men standing behind it. A rider comes
     TO you — he starts further out and walks in, and the card is his arrival.

     Every choice then acts on THAT party. TAKE THEM ALL walks the deserters
     you are looking at into your column (the same men, the same rifles the
     rail counted). RIDE ON leaves them where they sit and they become a real
     small party on the island. GO THROUGH THEM is a battle against the men
     standing at the narrows. WALK OUT is a real one-on-one on the sand
     against their champion (battle.js's `solo` fight — see the duel card).
     PUT HIM DOWN starts a fight with his column. There is no longer a way for
     this file to tell you about a man it has not put on the map.

     WHAT HAPPENS IF YOU DO NOT GO. A cast party is a real party; if you ride
     the other way it is released after a while and lives on as whatever it
     was — deserters in the shade of a truck, a toll crew at the narrows — and
     the road roll resumes. A card that is never reached is simply a party you
     rode past, which is what riding past people is.

     WHY A RAIL AND NOT THE SCREEN. #stage is an opaque panel; the whole point
     of casting is that the party is behind the decision, and a decision you
     cannot see the subject of is the popup again with extra steps. The rail
     is the game's own answer to that (games/warlord.html: "you cannot be
     mid-popup and get attacked, and there are no popups in reality"), and it
     already halts the ride, binds 1-5, and closes itself before a handler
     runs. Cards that are not about people present (the storm, bad water, a
     cache, old bones, the schism, the mutiny's own screen) stay on the stage:
     nothing behind them is the subject.

     NUMBERS. CARD_REACH is 38 m: outside campaign.js's 26 m CONTACT (so the
     encounter rail never races this one) and inside nameplate range, close
     enough that the front rank fills the lower third of an over-the-shoulder
     frame. CAST_AHEAD is 150 m: past the 140 m where campaign.js draws a
     party at full strength (bandShow), so they are visible as men rather than
     a smudge for the whole approach, and about ten seconds of riding. A rider
     starts at CAST_RIDER, 240 m, which at BAND_SPEED is forty seconds — long
     enough to be seen coming, short enough not to be a wait. */
  const CARD_REACH = 38;
  const CAST_AHEAD = 150;
  const CAST_RIDER = 240;
  const CAST_DROP_M = 1400;      // ride this far off and the meeting is released
  const CAST_DROP_S = 300;       // or this long
  let CAST = null;               // {L, bands, t, arg} — a party on the road, card not yet up
  let leaving = [];              // transient parties riding off the map: [{b, t}]
  let railT = 0;
  let summonsFrom = null;        // which rival sent the rider being cast

  /* where the road goes: the destination you tapped, else the way you face */
  function heading() {
    const C = W.campaign;
    let d = null;
    if (C && C.destination) safe(function () { d = C.destination(); });
    if (d && d.x != null) {
      const dx = d.x - S.you.x, dz = d.z - S.you.z;
      if (Math.hypot(dx, dz) > 30) return Math.atan2(dx, dz);
    }
    return S.you.yaw || 0;
  }
  /* A POINT ON THE ROAD AHEAD. A fan of bearings around the heading, three
     distances, and the first candidate that is on land, not up a wall, and
     (when asked) in plain sight from where you are standing — the inverse of
     hiddenPoint's test, because a party you were told about should be a party
     you can see. Falls back to any land point in the fan. */
  function roadPoint(dist, wantVisible) {
    const D = W.desert;
    if (!D || !D.onLand) return null;
    const h = heading();
    const bear = [0, 0.22, -0.22, 0.45, -0.45, 0.8, -0.8, 1.2, -1.2, 1.8, -1.8, 2.6, -2.6];
    const scale = [1, 0.82, 1.2, 0.66];
    const y0 = D.heightAt(S.you.x, S.you.z);
    let any = null;
    for (let si = 0; si < scale.length; si++) {
      for (let bi = 0; bi < bear.length; bi++) {
        const a = h + bear[bi], r = dist * scale[si];
        const x = S.you.x + Math.sin(a) * r, z = S.you.z + Math.cos(a) * r;
        if (!D.onLand(x, z)) continue;
        const y = D.heightAt(x, z);
        if (Math.abs(y - y0) / Math.max(1, r) > 0.22) continue;             // not up a mesa face
        // a flat enough patch to stand a party on
        const sl = Math.abs(D.heightAt(x + 6, z) - y) + Math.abs(D.heightAt(x, z + 6) - y);
        if (sl > 4.2) continue;
        if (!any) any = { x: x, z: z };
        if (!wantVisible || !blocked(S.you.x, S.you.z, x, z)) return { x: x, z: z };
      }
    }
    return any;
  }
  /* a second party stands relative to the first, in the road's own frame:
     `along` metres further down the road (away from you), `side` to its left */
  function offsetFrom(p, along, side) {
    const D = W.desert;
    const fx = p.x - S.you.x, fz = p.z - S.you.z;
    const n = Math.hypot(fx, fz) || 1;
    const ux = fx / n, uz = fz / n;
    const x = p.x + ux * along + uz * side, z = p.z + uz * along - ux * side;
    if (D && D.onLand && !D.onLand(x, z)) return { x: p.x, z: p.z };
    return { x: x, z: z };
  }

  function buildCast(sp) {
    const b = W.makeBand({ size: Math.max(1, sp.size || 1), faction: sp.faction, name: sp.name,
                           kind: sp.kind || null, hostile: sp.hostile == null ? null : sp.hostile, x: 0, z: 0 });
    if (sp.men) { let list = null; safe(function () { list = sp.men(b); }); if (list && list.length) b.men = list; }
    if (sp.gold != null) b.gold = sp.gold;
    b.castBorn = 1;          // a party this file conjured, for clearStage — outlives `cast`
    return b;
  }

  /* PUT THE CARD'S PEOPLE ON THE ROAD. Returns the cast record or null (no
     desert, fast-forward, the ground refused every candidate). `near` is the
     debug door and the screenshot tool: the party is put down inside
     CARD_REACH so the card is up NOW with the men behind it. */
  function castCard(L, o) {
    o = o || {};
    if (!L.cast || !canStage() || CAST) return null;
    let spec = null;
    safe(function () { spec = L.cast(); });
    if (!spec) return null;
    const list = Array.isArray(spec) ? spec : [spec];
    const bands = [];
    let anchor = null;
    for (let i = 0; i < list.length; i++) {
      const sp = list[i];
      let p = null;
      /* a rider walks in from CAST_RIDER — unless the door asked for the card
         NOW, in which case he has already arrived: the debug door's first
         run fired "he rode in alone" with the man 223 m out on the road */
      const rider = sp.mode === "approach" && !o.near;
      if (i === 0) {
        p = roadPoint(rider ? CAST_RIDER : (o.near ? CARD_REACH * 0.78 : (sp.ahead || CAST_AHEAD)), !rider);
        anchor = p;
      } else if (anchor) p = offsetFrom(anchor, sp.along || 0, sp.side || 0);
      if (!p) { for (let k = 0; k < bands.length; k++) removeBand(bands[k]); return null; }
      const b = buildCast(sp);
      b.x = p.x; b.z = p.z;
      stampCampaignFields(b);
      b.yaw = Math.atan2(S.you.x - b.x, S.you.z - b.z);      // facing you
      b.cast = L.id;
      b.cooldown = 30;
      b.mood = sp.mode === "camp" ? "camp" : "roam";
      holdBand(b);
      S.bands.push(b);
      if (sp.fire) fireAt(b.x + Math.sin(b.yaw) * 2.2, b.z + Math.cos(b.yaw) * 2.2, 900);
      if (sp.wreck) wreckAt(sp.wreck, b.x - Math.cos(b.yaw) * 5, b.z + Math.sin(b.yaw) * 5, b.yaw + 1.1, 900);
      if (sp.crates) cratesAt(b.x + Math.cos(b.yaw) * 2.4, b.z - Math.sin(b.yaw) * 2.4, 900);
      if (rider) {
        march(b, { chase: true, arrive: CONTACT_M * 0.85, budget: 120,
                   done: function () { if (CAST && CAST.L === L && W.phase() === "campaign") fireCast(); } });
        trailBehind(b, (Math.hypot(b.x - S.you.x, b.z - S.you.z) / BAND_SPEED) * 1.4);
      }
      bands.push(b);
    }
    CAST = { L: L, bands: bands, t: 0, spec: list, rider: !!(list[0].mode === "approach" && !o.near),
             arg: Object.assign({}, o.arg || {}, { band: bands[0], bands: bands, cast: list[0] }) };
    return CAST;
  }
  function castOnMap(c) {
    return !!(c && c.bands.length && S.bands.indexOf(c.bands[0]) >= 0 && c.bands[0].men.length);
  }
  /* the card, now that you are standing in front of its people */
  function fireCast() {
    const c = CAST;
    if (!c) return false;
    if (!castOnMap(c)) { dropCast(); return false; }
    if (!canOpen()) return false;            // a screen is up; asked again next tick
    CAST = null;
    halt();
    lensAt(c.bands[0]);
    if (!fire(c.L, c.arg)) { for (let i = 0; i < c.bands.length; i++) letGo(c.bands[i], {}); return false; }
    return true;
  }
  /* released, not deleted: the men you never reached stay what they were */
  function dropCast() {
    const c = CAST;
    CAST = null;
    if (!c) return;
    for (let i = 0; i < c.bands.length; i++) if (S.bands.indexOf(c.bands[i]) >= 0) letGo(c.bands[i], { camp: c.spec[0].mode === "camp" });
  }
  function stepCast(dt) {
    if (!CAST) return;
    const c = CAST;
    c.t += dt;
    if (!castOnMap(c)) { dropCast(); return; }
    const b = c.bands[0];
    const d = Math.hypot(b.x - S.you.x, b.z - S.you.z);
    if (!c.rider && d < CARD_REACH) { fireCast(); return; }
    if (d > CAST_DROP_M || c.t > CAST_DROP_S) dropCast();
  }
  /* THE LENS TURNS TO THEM. campaign.js's camera orbits you and keeps the yaw
     the player last dragged, so a party met from the side or behind was a
     rail about men off the edge of the frame. Bearing plus a pull-back sized
     so the party fills the shot, through the two levers campaign publishes
     (a want, not a seizure — the player can still drag). */
  function lensAt(b) {
    const C = W.campaign;
    if (!C || !b) return;
    const d = Math.hypot(b.x - S.you.x, b.z - S.you.z);
    if (C.camYaw) safe(function () { C.camYaw(Math.atan2(b.x - S.you.x, b.z - S.you.z)); });
    /* 30 m out is a 32 m pull-back, not 44: the first storyboard had the
       party as specks under a rail — the campaign lens is high, and every
       metre of pull-back is a metre of altitude. */
    if (C.camDist) safe(function () { C.camDist(clamp(d * 0.9 + 5, 20, 40)); });
  }

  /* ---- WHAT A CHOICE DOES TO THE PEOPLE IN FRONT OF YOU. Five verbs, and
     every card's every choice is one of them, so a card cannot invent a sixth
     way for a party to stop existing. */
  /* A WALK IS CANCELLED BY WHATEVER HAPPENS TO THE WALKER. The rider's walk-in
     is a march with `chase`; if the card is answered before he arrives (the
     debug door fires it at once) and the answer is "ride off", the old march
     kept dragging him TOWARD you and re-holding him every tick — photographed
     on the first rider smoke as a man riding away at 168 m, then 113 m. Every
     verb below drops his march first. */
  function unmarch(b) {
    for (let i = marches.length - 1; i >= 0; i--) if (marches[i].b === b) marches.splice(i, 1);
  }
  function removeBand(b) {
    unmarch(b);
    releaseBand(b);
    const i = S.bands.indexOf(b);
    if (i >= 0) S.bands.splice(i, 1);
  }
  /* they walk over and fall in — the men you were looking at, not a fresh
     roll. `base` is the loyalty provenance join() would have stamped. HELD
     for the walk, not released: between this call and the first stepMarch,
     campaign.js's AI got one pass at an unheld eight-man party standing next
     to a thirty-four-man army and sent it to "flee" — its nameplate read
     RUNNING on men walking toward you. */
  function absorb(b, base) {
    if (!b || S.bands.indexOf(b) < 0) return 0;
    unmarch(b);
    holdBand(b);
    b.cast = null; b.hostile = 0; b.mood = "roam"; b.joining = 1;
    for (let i = 0; i < b.men.length; i++) ev().base[b.men[i].id] = base == null ? 0.5 : base;
    const n = b.men.length;
    const meet = (widthOf(n) + widthOf(Math.max(1, S.army.length))) / 2;
    march(b, { chase: true, arrive: meet, budget: 45, done: function () { fallIn(b); } });
    return n;
  }
  /* some of them come over; the rest stay where they are */
  function absorbSome(b, list, base) {
    if (!b || !list.length) return 0;
    const keep = [];
    for (let i = 0; i < b.men.length; i++) if (list.indexOf(b.men[i]) < 0) keep.push(b.men[i]);
    b.men = keep;
    const b2 = W.makeBand({ size: 1, faction: b.faction, x: b.x, z: b.z });
    b2.men = list.slice();
    b2.name = "COMING OVER"; b2.gold = 0; b2.colour = b.colour;
    stampCampaignFields(b2);
    S.bands.push(b2);
    const n = absorb(b2, base);
    if (!b.men.length) removeBand(b);
    return n;
  }
  /* they stay on the island as the party they are. `camp` keeps them sitting
     where you met them; otherwise campaign's own AI gives them somewhere to
     walk. The cooldown is the same beat army.js's break-off uses, so riding
     straight back into them is a meeting again, not a second card. */
  function letGo(b, o) {
    o = o || {};
    if (!b || S.bands.indexOf(b) < 0) return;
    unmarch(b);
    releaseBand(b);
    b.cast = null;
    b.cooldown = o.cooldown == null ? 20 : o.cooldown;
    if (o.hostile != null) b.hostile = o.hostile;
    if (o.camp) { b.mood = "camp"; b.pause = o.pause == null ? 600 : o.pause; }
    else { b.mood = "roam"; b.pause = 0; b.goal = null; }
  }
  /* they leave. A rider, a trader who has sold, a buyer with your prisoners
     in his trucks: a real party walking off along the road, and off the map
     once it is out of sight — nobody wants a one-man GUN RUNNER band roaming
     the island for the rest of the run. */
  function rideOff(b, o) {
    o = o || {};
    if (!b || S.bands.indexOf(b) < 0) return;
    unmarch(b);
    releaseBand(b);
    b.cast = null; b.transient = 1; b.hostile = 0; b.cooldown = 600;
    b.mood = "roam"; b.pause = 0;
    const D = W.desert;
    const ax = b.x - S.you.x, az = b.z - S.you.z;
    const an = Math.hypot(ax, az) || 1;
    let best = null, bs = -Infinity;
    for (let i = 0; i < 8 && D && D.landPoint; i++) {
      let p = null;
      safe(function () { p = D.landPoint(W.rnd, { near: { x: b.x, z: b.z }, nearR: 1400 }); });
      if (!p) continue;
      const dx = p.x - b.x, dz = p.z - b.z, n = Math.hypot(dx, dz) || 1;
      const sc = (dx * ax + dz * az) / (n * an) + n / 3000;
      if (sc > bs) { bs = sc; best = p; }
    }
    b.goal = best ? { x: best.x, z: best.z, why: "" } : { x: b.x + (ax / an) * 800, z: b.z + (az / an) * 800, why: "" };
    if (o.flee) b.mood = "flee";
    leaving.push({ b: b, t: 0 });
  }
  function stepLeaving(dt) {
    for (let i = leaving.length - 1; i >= 0; i--) {
      const r = leaving[i], b = r.b;
      r.t += dt;
      if (S.bands.indexOf(b) < 0) { leaving.splice(i, 1); continue; }
      const d = Math.hypot(b.x - S.you.x, b.z - S.you.z);
      if (d > 700 || r.t > 240) { leaving.splice(i, 1); removeBand(b); }
    }
  }
  /* they go for you, now. A real battle against the men standing there — no
     hidden spawn, no walk-in, because they are already in front of you. */
  function attack(b, o) {
    if (!b || S.bands.indexOf(b) < 0) return false;
    unmarch(b);
    releaseBand(b);
    b.cast = null; b.mood = "hunt"; b.hostile = 1; b.cooldown = 0;
    b.goal = { x: S.you.x, z: S.you.z, why: "" };
    if (W.battle && W.battle.start) { safe(function () { W.battle.start(Object.assign({ band: b }, o || {})); }); return true; }
    return false;
  }
  /* the men a card promised from somewhere else — a sergeant's column coming
     across tonight — arrive from out of sight rather than out of thin air */
  function arriveMen(list, base) {
    if (!list.length) return;
    if (!canStage()) { for (let i = 0; i < list.length; i++) { ev().base[list[i].id] = base; W.addSoldier(list[i]); } reconcile(); return; }
    const p = hiddenPoint(320) || roadPoint(200, false);
    if (!p) { for (let i = 0; i < list.length; i++) { ev().base[list[i].id] = base; W.addSoldier(list[i]); } reconcile(); return; }
    const b = W.makeBand({ size: 1, faction: "militia", x: p.x, z: p.z });
    b.men = list.slice(); b.name = "COMING OVER"; b.gold = 0;
    stampCampaignFields(b);
    S.bands.push(b);
    trailBehind(b, (Math.hypot(b.x - S.you.x, b.z - S.you.z) / BAND_SPEED) * 1.4);
    absorb(b, base);
  }
  /* whatever a choice did not dispose of is released — a card cannot leave a
     party held forever by forgetting one branch */
  function settleCast(card) {
    const bs = card.bands || (card.band ? [card.band] : []);
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i];
      if (S.bands.indexOf(b) < 0) continue;
      if (b.joining || b.transient || !b.held) continue;
      let marching = false;
      for (let k = 0; k < marches.length; k++) if (marches[k].b === b) marching = true;
      if (marching || b.await) continue;
      letGo(b, {});
    }
  }
  function wreckAt(kind, x, z, yaw, life) {
    const P = W.props, r = root3();
    if (!P || !P.wreck || !r) return null;
    let g = null;
    safe(function () { g = P.wreck(kind, { seed: Math.round(x * 7 + z * 13) }); });
    if (!g) return null;
    g.position.set(x, groundAt(x, z), z);
    g.rotation.y = yaw || 0;
    r.add(g);
    lit.push({ g: g, t: life });
    return g;
  }
  function cratesAt(x, z, life) {
    const P = W.props, r = root3();
    if (!P || !P.crates || !r) return null;
    let g = null;
    safe(function () { g = P.crates({ seed: Math.round(x * 3 + z * 5), n: 3, spread: 1.3 }); });
    if (!g) return null;
    g.position.set(x, groundAt(x, z), z);
    r.add(g);
    lit.push({ g: g, t: life });
    return g;
  }
  function powerOf(s) { let p = 0; safe(function () { p = W.soldierPower(s); }); return p; }
  function strongest(men, n) {
    return men.slice().sort(function (a, b) { return powerOf(b) - powerOf(a); }).slice(0, n);
  }
  function plainText(html) { return String(html || "").replace(/<[^>]*>/g, ""); }

  function bandById(id) {
    for (let i = 0; i < S.bands.length; i++) if (S.bands[i].id === id) return S.bands[i];
    return null;
  }
  /* what the duel was for. Won: his men come over, the same men who watched.
     Lost: you crawled back at a quarter health (battle.js set that), they take
     a third of the cart and leave. Nobody left to decide: the line goes home. */
  function resolveDuel() {
    const d = ev().duel;
    if (!d || !d.outcome) return;
    ev().duel = null;
    const line = bandById(d.line), champ = bandById(d.champ);
    if (line) { line.await = 0; releaseBand(line); }
    if (champ && champ.men.length) rideOff(champ);
    if (d.outcome === "won") {
      const n = line ? line.men.length : d.n;
      if (line) absorb(line, 0.5);
      S.fame += Math.round(6 + n * 0.4);
      W.log("killed their champion in front of both armies. " + n + " men came over.", "good");
      loyMove(+14, "they watched you do it yourself");
    } else {
      const bag = Object.keys(S.baggage);
      for (let i = 0; i < Math.ceil(bag.length / 3); i++) W.unstash(bag[i], S.baggage[bag[i]]);
      S.fame = Math.max(0, S.fame - 8);
      W.log("lost a duel. They took a third of the cart and let you crawl back.", "bad");
      loyMove(-11, "they watched that too");
      if (line) rideOff(line);
    }
    reconcile();
  }

  /* THE ROAD ROLL'S OWN PATH, CALLABLE: put a card's people on the road ahead
     at the natural distance and wait for the player to reach them — what
     maybeFire does when it draws a people-card, without the draw. For a tool
     that wants to photograph the approach rather than the meeting. */
  /* strike everything this file has on the road — cast parties, leavers,
     lit props — so a storyboard can photograph each card on clean sand */
  E.clearStage = function () {
    dropCast();
    for (let i = S.bands.length - 1; i >= 0; i--) {
      const b = S.bands[i];
      if (b && (b.cast || b.castBorn || b.transient || b.await || b.joining)) removeBand(b);
    }
    leaving.length = 0;
    darkenStage();
    return true;
  };
  E.stageCast = function (id) {
    if (FLAG_NOEVENTS) return null;
    const L = libById(id);
    if (!L || !L.cast) return null;
    dropCast();
    const c = castCard(L);
    if (!c) return null;
    return { id: L.id, bands: c.bands.map(function (b) { return { name: b.name, men: b.men.length, x: b.x, z: b.z,
             d: Math.round(Math.hypot(b.x - S.you.x, b.z - S.you.z)) }; }) };
  };
  /* WHAT IS ON THE ROAD, for tools/visual-presets/warlord-real.mjs and anybody
     else who needs to check that a card's people exist. Positions are read
     off S.bands and the camera, not off intentions. */
  E.cast = function () {
    const out = { pending: CAST ? CAST.L.id : null, rail: !!(CARD && CARD.rail), screen: !!(CARD && !CARD.rail),
                  card: CARD ? CARD.id : null, castBands: 0, castMen: 0, castDist: 0, inFrame: 0,
                  held: held.length, leaving: leaving.length, transient: 0 };
    for (let i = 0; i < S.bands.length; i++) if (S.bands[i].transient) out.transient++;
    const bs = (CARD && (CARD.bands || (CARD.band ? [CARD.band] : null))) || (CAST && CAST.bands) || null;
    if (!bs) return out;
    let bd = 1e9;
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i];
      if (S.bands.indexOf(b) < 0 || !b.men.length) continue;
      out.castBands++; out.castMen += b.men.length;
      const d = Math.hypot(b.x - S.you.x, b.z - S.you.z);
      if (d < bd) bd = d;
    }
    if (out.castBands) out.castDist = Math.round(bd * 10) / 10;
    const b0 = bs[0];
    const cam = CBZ.camera, THREE = ctx && ctx.THREE;
    if (b0 && cam && THREE && S.bands.indexOf(b0) >= 0) {
      const v = new THREE.Vector3(b0.x, groundAt(b0.x, b0.z) + 1.4, b0.z).project(cam);
      out.inFrame = (v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1) ? 1 : 0;
    }
    return out;
  };

  /* WHAT THIS BAND WOULD BE CARRYING. Never a hand-picked gun id: core's own
     bandGunFor decides, off the wealth the fiction implies, so an event's men
     are armed exactly the way the map's men are. */
  function gunFor(wealth) { return W.bandGunFor(clamp(wealth, 0.1, 1)); }

  /* PUT A REAL BAND ON THE REAL MAP. campaign.js has spawnBand() but it takes
     no faction, and the faction is the whole point of a card that says "the
     slavers" — so the band is built by core (which does take one) and then the
     four fields campaign.js ADDS to a band on top of core's shape are stamped
     here. Those four are not optional: campaign's AI does `b.think -= dt` every
     frame, and a band that arrived without a `think` field turns its own
     position into NaN and vanishes off the map, which is exactly the bug this
     comment exists to stop somebody re-introducing. */
  function stampCampaignFields(b) {
    const D = W.desert;
    if (D && D.heightAt) b.y = D.heightAt(b.x, b.z);
    if (b.yaw == null) b.yaw = W.rnd() * Math.PI * 2;
    if (b.scared == null) b.scared = 0;
    if (b.think == null) b.think = W.rnd() * 1.6;
    if (b.pause == null) b.pause = 0;
    if (!b.goal) b.goal = { x: b.x, z: b.z };
    return b;
  }

  let lastSpawn = null;
  function spawnBandNear(opts) {
    opts = opts || {};
    const D = W.desert;
    let p = { x: S.you.x + W.range(-900, 900), z: S.you.z + W.range(-900, 900) };
    /* THEY COME FROM SOMEWHERE. Three cards used to answer "go through them"
       by putting a warband on a land point 60-90 m away — a distance chosen so
       you would SEE them, which is precisely why you saw them appear. Nothing
       arrives on this island; things are instantiated on it, and then a
       sentence is typed about the thing that just happened silently in front
       of the camera.

       ?shown=off puts the old roll back, byte for byte. */
    const wantHidden = opts.hidden && !FLAG_NOSHOW && D && D.landPoint;
    if (wantHidden) {
      /* 260 m rather than the old 60: far enough that a ridge can stand
         between you, near enough that they are on you inside half a minute at
         campaign.js's own HUNT_SPEED. A hidden spawn that takes two minutes to
         walk in is not tension, it is a wait. */
      const q = hiddenPoint(opts.r && opts.r > CONTACT_M * 4 ? opts.r : 260);
      if (q) p = q;
    } else if (D && D.landPoint) {
      const q = D.landPoint(W.rnd, { near: { x: S.you.x, z: S.you.z }, nearR: opts.r || 900 });
      if (q) p = q;
    }
    const b = W.makeBand({ size: opts.size, faction: opts.faction, x: p.x, z: p.z });
    stampCampaignFields(b);
    S.bands.push(b);
    if (opts.name) b.name = opts.name;
    if (opts.mood) b.mood = opts.mood;
    if (opts.hunt) { b.mood = "hunt"; b.goal = { x: S.you.x, z: S.you.z }; }
    b.cooldown = opts.cooldown == null ? 6 : opts.cooldown;
    /* AND THE DUST GETS THERE FIRST. A road laid behind them for as long as
       the walk can take at the island's own band speed, so what you actually
       see is a dust column on a horizon and then men over a rise — which is
       the sentence the toast used to type, drawn instead. */
    const spawnD = Math.hypot(b.x - S.you.x, b.z - S.you.z);
    lastSpawn = { d: spawnD, hidden: !!wantHidden,
                  blocked: blocked(S.you.x, S.you.z, b.x, b.z) };
    if (wantHidden) trailBehind(b, (spawnD / BAND_SPEED) * 1.6);
    return b;
  }

  /* ============================================================ THE LIBRARY
     Every entry is {id, tag, weight, build}. `weight` returns 0 to mean NOT
     NOW — that is the gate, and it is the difference between a card library
     and a random-number generator. An army of three is never offered a siege
     because the siege-shaped cards weigh 0 under twenty men; a card about your
     prisoners cannot fire when you have none; a card about the salt pan only
     fires on the salt pan. Weights are relative and are read against the
     player's actual size/fame/loyalty, so the island's offer changes shape as
     the run does — which is the only reason a long session stays interesting. */
  const LIB = [];
  function add(o) { LIB.push(o); return o; }

  /* ---- 1. deserters. Free men, and free men are the most expensive kind. */
  add({
    id: "deserters", tag: "ON THE ROAD",
    weight: function () { return size() >= 3 && size() < 220 ? 1.15 : 0; },
    /* THE MEN COME FIRST (see THE CAST). Real deserters — core's own
       archetype, company colours, levies with the cheap guns the card always
       priced — sitting by a wrecked truck on the road ahead. The card is what
       happens when you reach them. */
    cast: function () {
      const n = W.irange(3, Math.max(4, Math.min(22, Math.round(size() * 0.35) + 3)));
      return { name: "DESERTERS", faction: "company", kind: "deserters", hostile: 0.45, size: n,
               mode: "camp", wreck: "truck", gold: 0,
               men: function () { const out = []; for (let i = 0; i < n; i++) out.push(W.makeSoldier("levy", gunFor(0.2))); return out; } };
    },
    build: function (arg) {
      const b = arg && arg.band;
      const n = b ? b.men.length : W.irange(3, Math.max(4, Math.min(22, Math.round(size() * 0.35) + 3)));
      const wage = n * W.tier("levy").wage;
      const guns = [];
      for (let i = 0; i < n; i++) guns.push(b ? b.men[i].wid : gunFor(0.2));
      return {
        title: 'MEN WITH NO <em>FLAG</em>',
        sub: place().toUpperCase(),
        body: n + ' men in the shade of a wrecked truck with their boots off. They deserted ' +
              'from something and will not say what. They will march for food and a share.',
        band: b, bands: arg && arg.bands,
        choices: [
          { key: "take", label: "TAKE THEM ALL", cls: "hot",
            hint: "+" + men(n) + " · +$" + wage + "/DAY IN WAGES",
            run: function () {
              if (b) absorb(b, 0.22);
              else for (let i = 0; i < n; i++) join("levy", guns[i], 0.22);
              W.log("took in " + n + " deserters at " + place() + ".", "");
              if (FLAG_NOSHOW) W.toast("+" + men(n), "good");
              loyMove(-4, "the army does not trust deserters");
              reconcile();
            } },
          { key: "pick", label: "TAKE THE BEST THREE", show: n >= 6,
            hint: "+3 MEN",
            run: function () {
              if (b) { absorbSome(b, strongest(b.men, 3), 0.45); letGo(b, { camp: true }); }
              else for (let i = 0; i < 3; i++) join("levy", guns[i], 0.45);
              W.log("took three of the deserters and left the rest.", "");
              loyMove(1, "you were choosy");
              reconcile();
            } },
          { key: "no", label: "RIDE ON", cls: "ghost",
            run: function () { if (b) letGo(b, { camp: true }); W.log("rode past the deserters.", ""); } },
        ],
      };
    },
  });

  /* ---- 2. the caravan. Gold for days, and days are the real currency. */
  add({
    id: "caravan", tag: "A CONTRACT",
    weight: function () { return size() >= 5 ? 1.0 : 0; },
    /* a real SALT CARAVAN — core's own archetype, so it is the same party you
       meet on the road without a card — parked on the road ahead */
    cast: function () {
      return { name: "SALT CARAVAN", faction: "militia", kind: "caravan", hostile: 0.1,
               size: W.irange(6, 10), mode: "camp", wreck: "caravan" };
    },
    build: function (arg) {
      const b = arg && arg.band;
      // the fee is priced off what it actually costs you: two days of wages
      // plus a margin that scales with how big an escort they are buying
      const days = W.irange(2, 3);
      const fee = Math.round(W.payroll() * days * 1.9 + size() * 6 + 60);
      return {
        title: 'A <em>CARAVAN</em> AT THE EDGE OF THE PAN',
        sub: "SALT CROSSING",
        body: 'Nine trucks and a man in a good coat. He wants your guns beside him across the ' +
              'pan — ' + days + ' days out of your way, paid on arrival.',
        band: b, bands: arg && arg.bands,
        choices: [
          { key: "escort", label: "TAKE THE CONTRACT", cls: "hot",
            hint: "+$" + fee + " · " + days + " DAYS · -$" + (W.payroll() * days) + " IN WAGES",
            run: function () {
              for (let i = 0; i < days; i++) W.dawn();
              if (S.army.length || S.gold >= 0) { W.earn(fee); W.log("escorted a caravan across the pan. +$" + fee + ".", "good"); }
              S.fame += 2;
              loyMove(2, "paid work is still work");
              if (b) rideOff(b);              // delivered: they go on across the pan
            } },
          { key: "rob", label: "TAKE THE TRUCKS INSTEAD", cls: "bad",
            hint: "+$" + Math.round(fee * 1.7) + " · FAME DOWN",
            run: function () {
              W.earn(Math.round(fee * 1.7));
              if (b) { W.earn(b.gold | 0); b.gold = 0; rideOff(b, { flee: true }); }
              S.fame = Math.max(0, S.fame - 6);
              S.stats.executed += 1;   // core's dread counter: this is that kind of act
              W.log("took a caravan on the salt pan. They will remember the colour of the banner.", "bad");
              loyMove(-6, "banditry");
            } },
          { key: "no", label: "WE ARE NOT GUARDS", cls: "ghost", run: function () { if (b) letGo(b, {}); } },
        ],
      };
    },
  });

  /* ---- 3. the village. Men for a job — the classic, and the reason contracts
       exist in this file at all: a promise you have to ride to collect. */
  add({
    id: "village", tag: "A CONTRACT",
    weight: function () { return size() >= 6 && size() < 260 ? 1.1 : 0; },
    build: function () {
      const pay = Math.max(4, Math.round(size() * 0.16) + W.irange(3, 7));
      const raiders = Math.max(6, Math.round(size() * 0.55) + W.irange(2, 9));
      return {
        title: 'THE <em>WELL</em> AT ADH-DHIB',
        sub: "A VILLAGE WITH A PROBLEM",
        body: 'Mud walls, forty families, one well. A bandit crew has taken a third of everything ' +
              'since the spring. The headman offers ' + pay + ' of his young men if it stops. ' +
              'About ' + raiders + ' of them.',
        choices: [
          { key: "take", label: "TAKE THE JOB", cls: "hot",
            hint: raiders + " BANDITS · +" + men(pay) + " AFTER",
            run: function () {
              const b = spawnBandNear({ size: raiders, faction: "bandit", name: "ADH-DHIB RAIDERS", hunt: false, r: 1400 });
              ev().contracts.push({ bandId: b.id, kind: "village", men: pay, from: "ADH-DHIB", day: S.day });
              W.log("promised Adh-Dhib its well back. " + raiders + " raiders, somewhere west.", "");
              W.toast("CONTRACT: ADH-DHIB RAIDERS", "");
            } },
          { key: "tax", label: "TAX THEM INSTEAD", cls: "bad",
            hint: "+$" + (pay * 22) + " · FAME DOWN",
            run: function () {
              W.earn(pay * 22);
              S.fame = Math.max(0, S.fame - 4);
              W.log("taxed Adh-Dhib. The bandits will be back on Tuesday.", "bad");
              loyMove(-3, "your men have villages too");
            } },
          { key: "no", label: "RIDE ON", cls: "ghost", run: function () {} },
        ],
      };
    },
  });

  /* ---- 4. the cache, and the men who buried it. */
  add({
    id: "cache", tag: "IN THE SAND",
    weight: function () { return 1.0; },
    build: function () {
      const n = W.irange(3, 9);
      const wealth = clamp(0.35 + S.fame / 400, 0.3, 0.9);
      const guns = [];
      let worth = 0;
      for (let i = 0; i < n; i++) { const g = gunFor(wealth); guns.push(g); worth += W.gunSell(g); }
      const owners = Math.max(5, n * 2 + W.irange(0, 8));
      const label = {};
      for (let i = 0; i < guns.length; i++) label[guns[i]] = (label[guns[i]] || 0) + 1;
      const list = Object.keys(label).map(function (k) { return label[k] + "× " + W.gunLabel(k); }).join(", ");
      return {
        title: 'SOMETHING <em>BURIED</em>',
        sub: place().toUpperCase(),
        body: 'A tarp under two inches of sand, weighted with rocks carried here. ' + n +
              ' guns: ' + esc(list) + '. The tyre tracks beside it are three days old and pointed ' +
              'at us — about ' + owners + ' of them.',
        choices: [
          { key: "take", label: "TAKE IT AND GO", cls: "hot",
            hint: "+" + n + " GUNS · ~$" + worth,
            run: function () {
              for (let i = 0; i < guns.length; i++) W.stash(guns[i], 1);
              spawnBandNear({ size: owners, faction: "company", name: "THE OWNERS", hunt: true, r: 1100, cooldown: 30, hidden: true });
              W.log("dug up a cache of " + n + " guns. Someone is coming for them.", "");
              W.toast("+" + n + " GUNS", "good");
            } },
          { key: "wait", label: "SIT ON IT AND WAIT FOR THEM", show: size() >= 8,
            hint: "+" + n + " GUNS · THEY COME TO YOU",
            run: function () {
              for (let i = 0; i < guns.length; i++) W.stash(guns[i], 1);
              const b = spawnBandNear({ size: Math.round(owners * 0.8), faction: "company", name: "THE OWNERS", r: 90, cooldown: 0, hidden: true });
              b.mood = "hunt"; b.goal = { x: S.you.x, z: S.you.z };
              W.log("took the cache and set up over it.", "");
              loyMove(2, "a warlord who picks the ground");
            } },
          { key: "no", label: "LEAVE IT BURIED", cls: "ghost",             run: function () { W.log("covered the cache back up and rode on.", ""); } },
        ],
      };
    },
  });

  /* ---- 5. the wounded rival. The brief's own example, and the best card in
       the library because BOTH answers are wrong in a different way. */
  add({
    id: "rival", tag: "A MAN ON THE GROUND",
    weight: function () { return size() >= 25 && S.fame >= 12 ? 1.25 : 0; },
    /* the wounded warlord is men[0] of a real column — a veteran at a third
       of his health — and the men around him are the ones the card offers */
    cast: function () {
      const n = Math.max(8, Math.round(size() * W.range(0.35, 0.75)));
      const tiers = ["raider", "soldier", "soldier", "veteran"];
      const wealth = clamp(0.4 + n / 160, 0.35, 0.95);
      return { name: "A BEATEN COLUMN", faction: "warlord", hostile: 0.3, size: n + 1, mode: "camp", wreck: "truck",
               men: function () {
                 const out = [W.makeSoldier("veteran", gunFor(wealth), { battles: 20 })];
                 out[0].wounded = true; out[0].hp = Math.max(1, Math.round(out[0].maxHp * 0.3));
                 for (let i = 0; i < n; i++) out.push(W.makeSoldier(tiers[Math.floor(W.rnd() * tiers.length)], gunFor(wealth)));
                 return out;
               } };
    },
    build: function (arg) {
      const b = arg && arg.band;
      const n = b ? Math.max(1, b.men.length - 1) : Math.max(8, Math.round(size() * W.range(0.35, 0.75)));
      const tiers = ["raider", "soldier", "soldier", "veteran"];
      const wealth = clamp(0.4 + n / 160, 0.35, 0.95);
      return {
        title: 'A <em>WARLORD</em> WITH A HOLE IN HIM',
        sub: "WHAT IS LEFT OF HIS COLUMN",
        body: 'He is against a wheel with his hand pressed into his side and ' + n + ' men around ' +
              'him who have not decided anything yet. Let him ride out alive and they are yours.',
        band: b, bands: arg && arg.bands,
        choices: [
          { key: "let", label: "LET HIM GO. TAKE HIS MEN.", cls: "hot",
            hint: "+" + men(n) + " · HE COMES BACK",
            run: function () {
              if (b) { absorbSome(b, b.men.slice(1), 0.34); rideOff(b); }   // his men cross; he rides out alone
              else for (let i = 0; i < n; i++) join(tiers[Math.floor(W.rnd() * tiers.length)], gunFor(wealth), 0.34);
              S.fame += Math.round(n * 0.3);
              W.log("let a rival warlord ride out. His " + n + " men came with us.", "good");
              if (FLAG_NOSHOW) W.toast("+" + men(n), "good");
              loyMove(-5, "his men are not your men yet");
              reconcile();
              // he rebuilds. That is the price, and it is a real band on the map.
              ev().contracts.push({ kind: "revenge", day: S.day + W.irange(6, 14), size: Math.round(n * 1.4) });
            } },
          { key: "kill", label: "PUT HIM DOWN", cls: "bad",
            hint: "+9 FAME · HIS MEN COME AT YOU",
            run: function () {
              S.fame += 9;
              S.stats.executed += 2;
              W.log("killed a wounded warlord in front of his own column.", "bad");
              loyMove(-8, "they watched you do it");
              /* "THEY FIGHT HARDER" used to be a hint with nothing behind it.
                 They are standing right there; they fight NOW. */
              if (b) { b.men.splice(0, 1); puff(b.x, b.z, 1); churn(b.x, b.z, b.men.length, b.yaw || 0); attack(b, { chased: true }); }
              else W.toast("THE ISLAND HEARD THAT", "bad");
            } },
          { key: "ride", label: "RIDE ON AND LEAVE HIM TO IT", cls: "ghost",
            hint: "HE LIVES ANYWAY",
            run: function () { if (b) letGo(b, { camp: true }); W.log("left a wounded warlord where he sat.", ""); } },
        ],
      };
    },
  });

  /* ---- 6. the schism. The brief's other example. This is the loyalty system
       poking its head above the surface before the mutiny does. */
  add({
    id: "schism", tag: "IN YOUR OWN CAMP",
    weight: function () {
      if (size() < 14) return 0;
      const l = loyalty();
      return l < 62 ? 0.9 + (62 - l) / 40 : 0.15;
    },
    build: function () {
      const lead = ringleader();
      const cut = faction(W.range(0.22, 0.38));
      const n = cut.length;
      const bribe = Math.round(n * 14 + W.payroll() * 3);
      const name = lead ? lead.name : "a veteran";
      return {
        title: 'HE WANTS A <em>THIRD</em> OF THE ARMY',
        sub: (lead ? W.tier(lead.tier).label + " " + name : "A VETERAN").toUpperCase(),
        body: esc(name) + ' has sat with the same twenty men every night for a week. This ' +
              'morning: give him ' + n + ' men and he goes south. They are already packed.',
        choices: [
          { key: "let", label: "LET THEM WALK", cls: "",
            hint: "-" + men(n),
            run: function () {
              for (let i = 0; i < cut.length; i++) W.removeSoldier(cut[i].id, false);
              W.log(esc(name) + " took " + n + " men south. Nobody stopped him.", "bad");
              loyMove(+10, "you let them go, and the rest saw it");
              ev().unrest = 0;
              reconcile();
            } },
          { key: "pay", label: "BUY HIM BACK", cls: "hot", enabled: S.gold >= bribe,
            hint: "-$" + bribe + " · LOYALTY UP",
            run: function () {
              if (!W.pay(bribe)) return;
              for (let i = 0; i < cut.length; i++) {
                const id = cut[i].id;
                ev().base[id] = clamp((ev().base[id] || BASE_UNKNOWN) + 0.2, 0, 0.95);
              }
              W.log("paid $" + bribe + " to keep " + n + " men and the man who was taking them.", "good");
              loyMove(+13, "money is an argument");
              ev().unrest = 0;
            } },
          { key: "kill", label: "SHOOT HIM IN FRONT OF THEM", cls: "bad",
            hint: "LOYALTY DOWN HARD",
            run: function () {
              if (lead) { W.removeSoldier(lead.id, true); bury(lead, "executed by you"); }
              S.stats.executed += 1;
              W.log("shot " + esc(name) + " in front of the column.", "bad");
              loyMove(-16, "you shot one of your own");
              ev().unrest = Math.max(0, ev().unrest - 1);
            } },
        ],
      };
    },
  });

  /* ---- 7. water. Heat is a real killer in this file and this is its price tag. */
  add({
    id: "water", tag: "THE WELL IS DRY",
    weight: function () {
      const b = biome();
      if (size() < 4) return 0;
      return (b === "salt" || b === "dune" || b === "gravel") ? 1.2 : 0.25;
    },
    build: function () {
      const price = Math.round(size() * 3.5 + 25);
      const hurt = S.army.filter(function (s) { return s.wounded; }).length;
      const risk = Math.max(1, Math.round(size() * 0.06) + hurt);
      return {
        title: 'THE <em>WELL</em> IS SAND',
        sub: place().toUpperCase(),
        body: 'The cistern marked on every map on this island has four inches of wet sand in it. ' +
              'A nomad with eleven camels is standing beside it with full skins and a price.' +
              (hurt ? ' Your ' + hurt + ' wounded drink first.' : ''),
        choices: [
          { key: "buy", label: "PAY THE NOMAD", cls: "hot", enabled: S.gold >= price,
            hint: "-$" + price + " · EVERYBODY DRINKS",
            run: function () {
              if (!W.pay(price)) return;
              W.log("paid $" + price + " for water at a dry cistern.", "");
              loyMove(+5, "you paid for their water");
              // a drink puts the wounded back on their feet — core's own flag
              let healed = 0;
              for (let i = 0; i < S.army.length; i++) if (S.army[i].wounded && W.chance(0.5)) { S.army[i].wounded = false; healed++; }
              if (healed) W.toast(healed + " WOUNDED BACK ON THEIR FEET", "good");
            } },
          { key: "take", label: "TAKE THE SKINS", cls: "bad", show: size() >= 6,
            hint: "FREE · FAME DOWN · LOYALTY DOWN",
            run: function () {
              S.fame = Math.max(0, S.fame - 3);
              W.log("took a nomad's water at gunpoint.", "bad");
              loyMove(-7, "you robbed a man with camels");
            } },
          { key: "push", label: "PUSH ON DRY", cls: "",
            hint: "FREE · -" + men(risk) + " ON THE WAY",
            run: function () {
              const dead = [];
              const order = S.army.slice().sort(function (a, b) { return (b.wounded ? 1 : 0) - (a.wounded ? 1 : 0); });
              for (let i = 0; i < order.length && dead.length < risk; i++) {
                if (order[i].wounded || W.chance(0.3)) dead.push(order[i]);
              }
              for (let i = 0; i < dead.length; i++) { bury(dead[i], "thirst"); W.removeSoldier(dead[i].id, true); }
              S.stats.lost += dead.length;
              W.log("pushed on dry. " + dead.length + " men did not make the next well.", "bad");
              loyMove(-4 - dead.length * 0.6, "you marched them into the sun");
              reconcile();
            } },
        ],
      };
    },
  });

  /* ---- 8. the storm on the horizon. The weather's own card. */
  add({
    id: "storm", tag: "THE HORIZON",
    weight: function () { return (ev().wea === "storm" && ev().camped !== S.day) ? 3.2 : 0; },
    build: function () {
      const loss = Math.max(1, Math.round(size() * 0.05 * ev().weaP));
      const gunsLost = Math.max(1, Math.round(size() * 0.04));
      return {
        title: 'A BROWN <em>WALL</em>',
        sub: "SANDSTORM",
        /* the third sentence described the two buttons underneath it — the
           interface reading its own menu aloud. The buttons say it. */
        body: 'It is not weather, it is a landscape moving. Half an hour out, maybe less.',
        choices: [
          { key: "camp", label: "MAKE CAMP AND LET IT PASS", cls: "hot",
            hint: "ONE DAY · -$" + W.payroll() + " IN WAGES",
            run: function () {
              ev().camped = S.day;
              W.dawn();
              W.log("sat out a sandstorm behind the trucks.", "");
              loyMove(+3, "you did not march them into it");
            } },
          { key: "push", label: "RIDE INTO IT", cls: "bad",
            hint: "KEEP THE DAY · -" + men(loss) + " · -" + guns(gunsLost),
            run: function () {
              const cut = faction(0.5).slice(0, loss);
              for (let i = 0; i < cut.length; i++) { bury(cut[i], "lost in a sandstorm"); W.removeSoldier(cut[i].id, false); }
              S.stats.lost += cut.length;
              const bag = Object.keys(S.baggage);
              for (let i = 0; i < gunsLost && bag.length; i++) W.unstash(bag[Math.floor(W.rnd() * bag.length)], 1);
              W.log("rode into the storm. " + cut.length + " men walked out of the column and were not found.", "bad");
              loyMove(-6, "you marched them into a sandstorm");
              reconcile();
            } },
        ],
      };
    },
  });

  /* ---- 9. the chained column. */
  add({
    id: "column", tag: "ON THE ROAD",
    weight: function () { return size() >= 8 ? 0.85 : 0; },
    /* TWO PARTIES: the guards with rifles, and nine metres behind them the
       chain — unarmed men, fists only, a party that cannot fight, which is
       what a chain gang is. "cut them loose" is a battle with the FIRST party
       standing there and the second one falling in. */
    cast: function () {
      const n = W.irange(6, Math.max(8, Math.min(30, Math.round(size() * 0.5))));
      const guards = Math.max(3, Math.round(n * 0.3));
      return [
        { name: "THE SLAVERS", faction: "bandit", kind: "raiders", hostile: 1, size: guards, mode: "camp" },
        { name: "THE CHAIN", faction: "militia", hostile: 0, size: n, mode: "camp", along: 9, gold: 0,
          men: function () { const out = []; for (let i = 0; i < n; i++) out.push(W.makeSoldier(W.chance(0.75) ? "levy" : "raider", "fists")); return out; } },
      ];
    },
    build: function (arg) {
      const slavers = arg && arg.bands ? arg.bands[0] : null;
      const chain = arg && arg.bands ? arg.bands[1] : null;
      const n = chain ? chain.men.length : W.irange(6, Math.max(8, Math.min(30, Math.round(size() * 0.5))));
      const guards = slavers ? slavers.men.length : Math.max(3, Math.round(n * 0.3));
      const price = n * 26;
      return {
        title: 'A COLUMN ON A <em>CHAIN</em>',
        sub: "SLAVERS, HEADING EAST",
        body: n + ' men walking in a line with their wrists wired together and ' + guards +
              ' men with rifles beside them. The chief wants to sell, and he is being very ' +
              'polite about it.',
        band: slavers, bands: arg && arg.bands,
        choices: [
          { key: "free", label: "CUT THEM LOOSE", cls: "hot",
            hint: guards + " GUARDS · +" + men(n) + " · FAME UP",
            run: function () {
              if (chain) { for (let i = 0; i < chain.men.length; i++) chain.men[i].wid = gunFor(0.18); absorb(chain, 0.68); }
              else for (let i = 0; i < n; i++) join(W.chance(0.75) ? "levy" : "raider", gunFor(0.18), 0.68);
              S.fame += Math.round(n * 0.5);
              W.log("cut a slave column loose. " + n + " men picked up rifles and stayed.", "good");
              if (FLAG_NOSHOW) W.toast("+" + men(n), "good");
              loyMove(+8, "the army liked that");
              if (slavers) attack(slavers);
              else spawnBandNear({ size: guards, faction: "bandit", name: "THE SLAVERS", hunt: true, r: 320, cooldown: 2 });
              reconcile();
            } },
          { key: "buy", label: "BUY THEM", cls: "", enabled: S.gold >= price,
            hint: "-$" + price + " · +" + men(n),
            run: function () {
              if (!W.pay(price)) return;
              if (chain) { for (let i = 0; i < chain.men.length; i++) chain.men[i].wid = gunFor(0.15); absorb(chain, 0.4); }
              else for (let i = 0; i < n; i++) join("levy", gunFor(0.15), 0.4);
              if (slavers) { slavers.gold += price; rideOff(slavers); }
              W.log("bought " + n + " men off a slaver for $" + price + ".", "");
              loyMove(-2, "you paid a slaver");
              reconcile();
            } },
          { key: "no", label: "RIDE ON", cls: "ghost",
            run: function () {
              // the column moves on east, the chain behind the rifles
              if (slavers) rideOff(slavers);
              if (chain) { rideOff(chain); if (slavers && slavers.goal) chain.goal = { x: slavers.goal.x, z: slavers.goal.z, why: "" }; }
              loyMove(-3, "you rode past the chain");
            } },
        ],
      };
    },
  });

  /* ---- 10. the gun runner. A real gun at a real price, out of the armoury. */
  add({
    id: "runner", tag: "A TRADER",
    weight: function () { return 1.0; },
    /* THE MAN WITH THE CRATE, WITH A CRATE, WITH A MAN. This is the card the
       owner quoted ("a man with a crate popup with no man there") and it was
       still true here: two men and a stack of crates now stand on the road. */
    cast: function () {
      return { name: "GUN RUNNER", faction: "militia", hostile: 0, size: 2, mode: "camp", crates: true,
               men: function () { return [W.makeSoldier("raider", gunFor(0.5)), W.makeSoldier("levy", "sidearm")]; } };
    },
    build: function (arg) {
      const b = arg && arg.band;
      // he is carrying something above what a band this size would normally
      // field — that is why the card exists at all
      const wealth = clamp(0.55 + S.fame / 300, 0.5, 0.98);
      const id = gunFor(wealth);
      const n = W.irange(2, 6);
      const list = W.gunPrice(id) * n;
      const ask = Math.round(list * 0.72 / 5) * 5;
      return {
        title: 'A MAN WITH A <em>CRATE</em>',
        sub: "GUN RUNNER",
        body: 'One truck, one crate, one nervous man. ' + n + '× ' + esc(W.gunLabel(id)) +
              ', still in grease, and he would like to be somewhere else by dark.',
        band: b, bands: arg && arg.bands,
        choices: [
          { key: "buy", label: "BUY THE CRATE", cls: "hot", enabled: S.gold >= ask,
            hint: "-$" + ask + " · +" + n + "× " + W.gunLabel(id) + " · LIST $" + list,
            run: function () {
              if (!W.pay(ask)) return;
              W.stash(id, n);
              W.log("bought " + n + "× " + W.gunLabel(id) + " off a runner for $" + ask + ".", "good");
              W.toast("+" + n + "× " + W.gunLabel(id), "good");
              if (b) { b.gold += ask; rideOff(b); }
            } },
          { key: "rob", label: "TAKE THE CRATE", cls: "bad", show: size() >= 5,
            hint: "FREE · +$" + Math.round(list * 0.2) + " · FAME DOWN",
            run: function () {
              W.stash(id, n);
              W.earn(Math.round(list * 0.2));
              S.fame = Math.max(0, S.fame - 5);
              W.log("robbed a gun runner on the " + biome() + ".", "bad");
              loyMove(-4, "you robbed a trader");
              if (b) rideOff(b, { flee: true });
            } },
          { key: "no", label: "RIDE ON", cls: "ghost", run: function () { if (b) rideOff(b); } },
        ],
      };
    },
  });

  /* ---- 11. the old soldier. */
  add({
    id: "oldman", tag: "A FIRE OFF THE ROAD",
    weight: function () { return size() >= 4 ? 0.8 : 0.4; },
    /* one veteran, his good rifle, and the fire the card has always mentioned
       — props.js's own fire, lit beside him */
    cast: function () {
      const wid = gunFor(0.8);
      return { name: "AN OLD SOLDIER", faction: "legion", hostile: 0, size: 1, mode: "camp", fire: true, gold: 0,
               men: function () { return [W.makeSoldier("veteran", wid, { battles: 8 })]; } };
    },
    build: function (arg) {
      const b = arg && arg.band;
      const price = W.tier("veteran").hire * 2;
      const wid = b ? b.men[0].wid : gunFor(0.8);
      return {
        title: 'AN OLD <em>SOLDIER</em>',
        sub: "ALONE, WITH A GOOD RIFLE",
        /* "and he says the second one is the better deal for you and he is
           right" was the card telling the player which button to press. */
        body: 'He has a fire, a ' + esc(W.gunLabel(wid)) + ' cleaned to a shine, and thirty years ' +
              'of somebody else\'s wars behind him. He will come — for money up front, or for a share.',
        band: b, bands: arg && arg.bands,
        choices: [
          { key: "pay", label: "PAY HIM", cls: "hot", enabled: S.gold >= price,
            hint: "-$" + price + " · +1 VETERAN · " + W.gunLabel(wid),
            run: function () {
              if (!W.pay(price)) return;
              const s = b ? b.men[0] : join("veteran", wid, BASE_HIRED, { battles: 8 });
              if (b) absorb(b, BASE_HIRED);
              W.log("hired " + s.name + ", veteran, for $" + price + ".", "good");
              W.toast("+1 VETERAN", "good");
              reconcile();
            } },
          { key: "share", label: "OFFER HIM A SHARE", cls: "",
            hint: "FREE · +1 VETERAN · LOYAL",
            run: function () {
              const s = b ? b.men[0] : join("veteran", wid, 0.95, { battles: 8 });
              if (b) absorb(b, 0.95);
              W.log(s.name + " came for a share and nothing else.", "good");
              loyMove(+4, "a veteran chose you in front of everyone");
              reconcile();
            } },
          { key: "no", label: "LEAVE HIM HIS FIRE", cls: "ghost", run: function () { if (b) letGo(b, { camp: true, pause: 3000 }); } },
        ],
      };
    },
  });

  /* ---- 12. somebody wants to buy your prisoners. */
  add({
    id: "buyer", tag: "A BUYER",
    weight: function () { return S.prisoners.length >= 4 ? 1.5 : 0; },
    /* the buyer and his drivers, on the road. Sold prisoners walk off in HIS
       column; freed ones become a real party of unarmed men on the island. */
    cast: function () {
      return { name: "A BUYER", faction: "company", hostile: 0, size: 4, mode: "camp" };
    },
    build: function (arg) {
      const b = arg && arg.band;
      const n = S.prisoners.length;
      // he pays roughly what a camp charges to hire a man of that tier, halved
      let worth = 0;
      for (let i = 0; i < S.prisoners.length; i++) worth += W.tier(S.prisoners[i].tier).hire * 0.45;
      worth = Math.round(worth / 5) * 5;
      return {
        title: 'HE WANTS YOUR <em>PRISONERS</em>',
        sub: n + " MEN IN THE WIRE",
        body: 'A quiet man with four trucks and a ledger. He will take all ' + n +
              ' off your hands at $' + worth + ' and does not want to discuss what for.',
        band: b, bands: arg && arg.bands,
        choices: [
          { key: "sell", label: "SELL THEM ALL", cls: "bad",
            hint: "+$" + worth + " · LOYALTY DOWN",
            run: function () {
              W.earn(worth);
              S.stats.executed += Math.ceil(n / 3);   // core's dread counter: this is that kind of act
              const taken = S.prisoners.slice();
              S.prisoners.length = 0;
              if (b) { for (let i = 0; i < taken.length; i++) { taken[i].wid = "fists"; b.men.push(taken[i]); } rideOff(b); }
              W.log("sold " + n + " prisoners for $" + worth + ".", "bad");
              loyMove(-9, "you sold men");
              W.emit("army", S.army.length);
            } },
          { key: "free", label: "TURN THEM ALL LOOSE INSTEAD", cls: "hot",
            hint: "+FAME · THEY SURRENDER MORE READILY",
            run: function () {
              S.fame += Math.round(2 + n * 0.6);
              const freed = S.prisoners.slice();
              S.prisoners.length = 0;
              if (b && freed.length && canStage()) {
                const p = offsetFrom({ x: b.x, z: b.z }, -4, 8);
                const f = W.makeBand({ size: 1, faction: "militia", x: p.x, z: p.z });
                for (let i = 0; i < freed.length; i++) freed[i].wid = "fists";
                f.men = freed; f.name = "FREED MEN"; f.gold = 0; f.hostile = 0;
                stampCampaignFields(f);
                S.bands.push(f);
                churn(p.x, p.z, freed.length, 0); puff(p.x, p.z, 0.8);
                letGo(f, { cooldown: 60 });
                rideOff(b);
              }
              W.log("turned " + n + " prisoners loose in front of a slaver.", "good");
              loyMove(+7, "mercy in front of witnesses");
              W.emit("army", S.army.length);
            } },
          { key: "no", label: "THEY STAY IN THE WIRE", cls: "ghost", run: function () { if (b) rideOff(b); } },
        ],
      };
    },
  });

  /* ---- 13. the toll. Small, mean, three real answers. */
  add({
    id: "toll", tag: "THE CROSSING",
    weight: function () { const b = biome(); return (b === "wadi" || b === "rock") ? 1.3 : 0.5; },
    /* the toll crew are on the road with their truck across it BEFORE you
       decide anything — "go through them" is a battle with the men you can
       see, not a warband conjured after the click */
    cast: function () {
      const n = Math.max(4, Math.round(size() * W.range(0.25, 0.6)));
      return { name: "THE TOLLMEN", faction: "bandit", kind: "raiders", hostile: 1, size: n, mode: "camp", wreck: "truck" };
    },
    build: function (arg) {
      const b = arg && arg.band;
      const n = b ? b.men.length : Math.max(4, Math.round(size() * W.range(0.25, 0.6)));
      const toll = Math.round(size() * 5 + 40);
      return {
        title: 'A <em>TOLL</em> AT THE NARROWS',
        sub: place().toUpperCase(),
        body: 'The only way through the rock for six kilometres, and ' + n + ' men are sitting on ' +
              'both sides of it with a truck across the gap. The price is $' + toll +
              ' and the man saying it is not the one holding the machine gun.',
        band: b, bands: arg && arg.bands,
        choices: [
          { key: "pay", label: "PAY THE TOLL", cls: "", enabled: S.gold >= toll,
            hint: "-$" + toll + " · STRAIGHT THROUGH",
            run: function () {
              if (!W.pay(toll)) return;
              // paid: they keep their narrows and leave you alone for the day
              if (b) { b.gold += toll; letGo(b, { camp: true, cooldown: 900 }); }
              W.log("paid $" + toll + " at the narrows.", "");
              loyMove(-2, "your men do not like paying bandits");
            } },
          { key: "fight", label: "GO THROUGH THEM", cls: "hot",
            hint: n + " MEN, NOW",
            run: function () {
              if (b) { attack(b); return; }
              const b2 = spawnBandNear({ size: n, faction: "bandit", name: "THE TOLLMEN", r: 60, cooldown: 0, hidden: true });
              b2.mood = "hunt"; b2.goal = { x: S.you.x, z: S.you.z };
              /* the toast said "THEY ARE COMING DOWN OFF THE ROCK" over a
                 warband that had just been placed 60 m away in plain sight.
                 They come down off the rock now — and the sentence is kept
                 behind the revert flag rather than deleted, so the A/B is
                 measuring the change and not measuring a deletion. */
              if (FLAG_NOSHOW) W.toast("THEY ARE COMING DOWN OFF THE ROCK", "bad");
            } },
          { key: "around", label: "GO AROUND", cls: "ghost",
            hint: "HALF A DAY · -$" + Math.round(W.payroll() / 2),
            run: function () {
              if (b) letGo(b, { camp: true, cooldown: 120 });
              S.hour += 8;
              if (S.hour >= 24) { S.hour -= 24; W.dawn(); }
              W.log("went around the narrows the long way.", "");
            } },
        ],
      };
    },
  });

  /* ---- 14. the old battlefield: free salvage, and a reminder. */
  add({
    id: "bones", tag: "OLD GROUND",
    weight: function () { return 0.7; },
    build: function () {
      const n = W.irange(2, 7);
      const guns = [];
      for (let i = 0; i < n; i++) guns.push(gunFor(0.3));
      const fallen = ev().fallen;
      const ghost = fallen.length ? fallen[Math.floor(W.rnd() * fallen.length)] : null;
      return {
        title: 'SOMEBODY ELSE\'S <em>WAR</em>',
        sub: "A FIELD OF OLD BONES",
        body: 'Two hundred men died here and nobody carried them off. The sand has taken most of ' +
              'it. There are ' + n + ' rifles still in it that will fire.' +
              (ghost ? ' One of your men stops and says he knew a ' + esc(ghost.name.split(" ")[1] || ghost.name) +
                       ' once. He did not, but you let him say it.' : ''),
        choices: [
          { key: "dig", label: "DIG", cls: "hot",
            hint: "+" + n + " GUNS · AN HOUR OR TWO",
            run: function () {
              for (let i = 0; i < guns.length; i++) W.stash(guns[i], 1);
              S.hour += 2;
              if (S.hour >= 24) { S.hour -= 24; W.dawn(); }
              W.toast("+" + n + " GUNS", "good");
              W.log("dug " + n + " working rifles out of an old field.", "");
            } },
          { key: "bury", label: "BURY WHAT IS LEFT OF THEM", cls: "",
            hint: "NO GUNS · HALF A DAY · LOYALTY UP",
            run: function () {
              S.hour += 9;
              if (S.hour >= 24) { S.hour -= 24; W.dawn(); }
              W.log("spent half a day burying strangers.", "");
              loyMove(+9, "you buried men who were nothing to you");
            } },
        ],
      };
    },
  });

  /* ---- 15. the duel. */
  add({
    id: "duel", tag: "A CHALLENGE",
    weight: function () { return size() >= 10 && size() < 140 ? 0.8 : 0; },
    /* THE DUEL IS A FIGHT NOW, NOT A COIN. The old WALK OUT rolled W.chance(p)
       and typed the result — in a game whose entire trigger is
       systems/fpsmode.js, the one fight that is explicitly YOU against ONE MAN
       was the one fight you did not get to shoot. Two parties on the road:
       the line, and their champion eighteen metres out in front of it. WALK
       OUT starts battle.js's `solo` fight — your army stays with the baggage,
       nobody routs, and the aftermath is his name on the ground or yours. The
       line waits (`await`) for the outcome and comes over or rides off. */
    cast: function () {
      const n = W.irange(8, Math.max(10, Math.round(size() * 0.8)));
      const wealth = clamp(0.3 + n / 150, 0.25, 0.8);
      return [
        { name: "THE CHALLENGERS", faction: "company", hostile: 0.7, size: n, mode: "camp", ahead: 90 },
        { name: "THEIR CHAMPION", faction: "company", hostile: 0.7, size: 1, mode: "camp", along: -18, gold: 0,
          men: function () { return [W.makeSoldier("veteran", gunFor(wealth), { battles: 14 })]; } },
      ];
    },
    build: function (arg) {
      const line = arg && arg.bands ? arg.bands[0] : null;
      const champ = arg && arg.bands ? arg.bands[1] : null;
      const n = line ? line.men.length : W.irange(8, Math.max(10, Math.round(size() * 0.8)));
      const wealth = clamp(0.3 + n / 150, 0.25, 0.8);
      // the odds are core's odds — you against one man, with your kit
      const mine = W.yourPower() - W.power(S.army);
      const his = W.soldierPower(champ ? champ.men[0] : W.makeSoldier("veteran", gunFor(wealth)));
      const p = W.odds(mine, his * 2.2);
      const lose = function () {
        S.you.hp = Math.max(1, Math.round(S.you.maxHp * 0.25));
        const bag = Object.keys(S.baggage);
        for (let i = 0; i < Math.ceil(bag.length / 3); i++) W.unstash(bag[i], S.baggage[bag[i]]);
        S.fame = Math.max(0, S.fame - 8);
        W.log("lost a duel. They took a third of the cart and let you crawl back.", "bad");
        loyMove(-11, "they watched that too");
      };
      return {
        title: 'HE WANTS <em>YOU</em>, NOT YOUR ARMY',
        sub: n + " MEN WATCHING",
        body: 'Their biggest man walks out ahead of the line, puts his rifle in the sand and ' +
              'shouts across the gap that if you beat him his ' + n +
              ' men are yours, and if he beats you they take what you are carrying. ' +
              /* "You would win this about 61 times in a hundred" was the odds
                 printed in English immediately above a button chipped "61%". */
              'Your men are already forming a circle.',
        band: champ || line, bands: arg && arg.bands,
        choices: [
          { key: "fight", label: "WALK OUT", cls: "hot",
            hint: Math.round(p * 100) + "% · WIN +" + men(n) + " · LOSE A THIRD OF THE CART",
            run: function () {
              if (champ && line && W.battle && W.battle.start) {
                line.await = 1;                                      // the line watches; strikeSet keeps its hold
                ev().duel = { line: line.id, champ: champ.id, n: n, wealth: wealth };
                attack(champ, { solo: true, duel: true });
                return;
              }
              if (W.chance(p)) {
                for (let i = 0; i < n; i++) join(W.chance(0.6) ? "raider" : "soldier", gunFor(wealth), 0.5);
                S.fame += Math.round(6 + n * 0.4);
                S.you.kills++;
                W.log("killed their champion in front of both armies. " + n + " men came over.", "good");
                if (FLAG_NOSHOW) W.toast("+" + men(n), "good");
                loyMove(+14, "they watched you do it yourself");
              } else lose();
              reconcile();
            } },
          { key: "line", label: "SEND THE LINE INSTEAD", cls: "",
            hint: n + " MEN · FAME DOWN",
            run: function () {
              if (line) {
                if (champ) { line.men.unshift(champ.men[0]); removeBand(champ); }
                attack(line);
              } else {
                const b = spawnBandNear({ size: n, faction: "company", name: "THE CHALLENGERS", r: 70, cooldown: 0, hidden: true });
                b.mood = "hunt"; b.goal = { x: S.you.x, z: S.you.z };
              }
              S.fame = Math.max(0, S.fame - 3);
              loyMove(-4, "you would not walk out");
            } },
          { key: "no", label: "RIDE AWAY", cls: "ghost", hint: "fame down · loyalty down",
            run: function () {
              if (line) { if (champ) { line.men.unshift(champ.men[0]); removeBand(champ); } letGo(line, { camp: true }); }
              S.fame = Math.max(0, S.fame - 5); loyMove(-7, "you rode away from a challenge");
            } },
        ],
      };
    },
  });

  /* ---- 16. bad water. The wounded are a resource you can lose. */
  add({
    id: "sick", tag: "IN THE COLUMN",
    weight: function () {
      const hurt = S.army.filter(function (s) { return s.wounded; }).length;
      return hurt >= 3 ? 1.1 : 0;
    },
    build: function () {
      const hurt = S.army.filter(function (s) { return s.wounded; });
      const price = Math.round(hurt.length * 32 + 40);
      return {
        title: 'SOMETHING IN THE <em>WATER</em>',
        sub: hurt.length + " MEN DOWN IN THE TRUCKS",
        body: 'The wounded got worse overnight and now it is not just the wounded. ' +
              'There is a woman two valleys over who sells the right powders and she knows ' +
              'exactly how much you need them.',
        choices: [
          { key: "buy", label: "BUY THE MEDICINE", cls: "hot", enabled: S.gold >= price,
            hint: "-$" + price + " · " + hurt.length + " BACK ON THEIR FEET",
            run: function () {
              if (!W.pay(price)) return;
              for (let i = 0; i < hurt.length; i++) { hurt[i].wounded = false; hurt[i].hp = hurt[i].maxHp; }
              W.log("paid $" + price + " for medicine. " + hurt.length + " men stood up.", "good");
              loyMove(+8, "you spent money on the hurt");
            } },
          { key: "leave", label: "LEAVE THEM AT THE NEXT WELL", cls: "",
            hint: "-" + men(hurt.length) + " · LOYALTY DOWN",
            run: function () {
              for (let i = 0; i < hurt.length; i++) { bury(hurt[i], "left behind sick"); W.removeSoldier(hurt[i].id, true); }
              W.log("left " + hurt.length + " sick men at a well.", "bad");
              loyMove(-12, "you left the hurt behind");
              reconcile();
            } },
          { key: "ride", label: "CARRY THEM AND RIDE", cls: "",
            hint: "FREE · HALF OF THEM DIE",
            run: function () {
              let d = 0;
              for (let i = 0; i < hurt.length; i++) if (W.chance(0.45)) { bury(hurt[i], "fever"); W.removeSoldier(hurt[i].id, true); d++; }
              S.stats.lost += d;
              W.log("carried the sick. " + d + " of them died in the trucks.", "bad");
              loyMove(-2, "at least you carried them");
              reconcile();
            } },
        ],
      };
    },
  });

  /* ---- 17. a defector out of a band you have already beaten. */
  add({
    id: "defector", tag: "A RIDER COMES IN",
    weight: function () { return S.fame >= 20 && size() >= 12 ? 0.9 : 0; },
    /* a rider COMES IN: one man, starting well out, walking to you with a dust
       line behind him. The card is his arrival. */
    cast: function () {
      return { name: "A RIDER", faction: "warlord", hostile: 0, size: 1, mode: "approach", gold: 0,
               men: function () { return [W.makeSoldier("soldier", gunFor(0.5), { battles: 5 })]; } };
    },
    build: function (arg) {
      const b = arg && arg.band;
      const n = W.irange(4, Math.max(6, Math.round(size() * 0.3)));
      const price = Math.round(n * W.tier("raider").hire * 0.55);
      return {
        title: 'HE HAS BEEN <em>WATCHING</em> YOU',
        sub: "A SERGEANT FROM SOMEBODY ELSE'S COLUMN",
        body: 'He rode in alone with his hands up. His warlord has not paid anyone in nine days ' +
              'and he can bring ' + n + ' men across tonight if there is money in it.',
        band: b, bands: arg && arg.bands,
        choices: [
          { key: "pay", label: "PAY HIM", cls: "hot", enabled: S.gold >= price,
            hint: "-$" + price + " · +" + men(n),
            run: function () {
              if (!W.pay(price)) return;
              const list = [];
              for (let i = 0; i < n; i++) list.push(W.makeSoldier(W.chance(0.5) ? "raider" : "soldier", gunFor(0.45)));
              if (b) { b.gold += price; rideOff(b); arriveMen(list, 0.5); }   // he rides back for them; they come over the rise
              else for (let i = 0; i < n; i++) join(list[i].tier, list[i].wid, 0.5);
              W.log("bought " + n + " men out of another warlord's column for $" + price + ".", "good");
              if (FLAG_NOSHOW) W.toast("+" + men(n), "good");
              reconcile();
            } },
          { key: "trap", label: "IT IS A TRAP. TAKE HIM PRISONER.", cls: "bad",
            hint: "+1 PRISONER",
            run: function () {
              if (b) { S.prisoners.push(b.men[0]); removeBand(b); }
              else S.prisoners.push(W.makeSoldier("soldier", gunFor(0.5)));
              W.log("put the defector in the wire instead.", "");
              loyMove(-3, "a man came to you and you chained him");
              W.emit("army", S.army.length);
            } },
          { key: "no", label: "SEND HIM BACK", cls: "ghost", run: function () { if (b) rideOff(b); } },
        ],
      };
    },
  });

  /* ---- 18. THE NAME AT THE TOP OF THE LEADERBOARD sends a rider. The
       endgame reaching into the road-event layer, which is how a player finds
       out there is one. It used to pick out of THE FOUR — a list frozen at
       boot — and it picks off the live standing now, so the man who sends for
       you is a man who is actually winning. */
  add({
    id: "summons", tag: "A RIDER UNDER A WHITE RAG",
    weight: function () {
      if (FLAG_NOEND) return 0;
      const alive = rivals();
      return (alive.length && size() >= 30 && S.fame >= 30) ? 1.4 : 0;
    },
    /* his rider, in his colours, walking in under the rag. The warlord is
       chosen here so the man and the card agree about whose he is. */
    cast: function () {
      const alive = rivals();
      if (!alive.length) return null;
      /* THE BIGGEST OF THE TOP THREE, not a flat roll over fourteen. A summons
         from the man in eleventh place is not the endgame reaching in, it is a
         stranger; the board is already sorted, so this is one slice. */
      const f = alive[Math.floor(W.rnd() * Math.min(3, alive.length))];
      summonsFrom = f;
      return { name: String(f.name).toUpperCase() + "'S RIDER", faction: "warlord", hostile: 0, size: 1,
               mode: "approach", gold: 0,
               men: function () { return [W.makeSoldier("soldier", gunFor(0.6), { battles: 6 })]; } };
    },
    build: function (arg) {
      const rider = arg && arg.band;
      const alive = rivals();
      if (!alive.length) return null;
      let f = alive[Math.floor(W.rnd() * Math.min(3, alive.length))];
      if (rider && summonsFrom) {
        for (let i = 0; i < alive.length; i++) if (alive[i].id === summonsFrom.id) f = alive[i];
      }
      summonsFrom = null;
      const name = f.name;
      /* HE ANSWERS WITH EVERY COLUMN HE HAS. The old card picked one band and
         turned that one band around, which is what "he comes with everything
         he has" meant when a warlord WAS one band. He is a man with holdings
         and columns now, so the answer reaches all of them. */
      const cols = (WL() && WL().columns) ? WL().columns(f.id) : [];
      const tribute = Math.round(W.payroll() * 6 + size() * 9);
      return {
        title: esc(name) + ' SENDS A <em>RIDER</em>',
        sub: f.men + " MEN UNDER HIS BANNER",
        body: 'The rider does not dismount. He says his warlord has been counting your column and ' +
              'has decided you are worth talking to once. Pay $' + tribute + ' a season and ride ' +
              'where you like. Refuse and he comes with everything he has.',
        band: rider, bands: arg && arg.bands,
        choices: [
          { key: "pay", label: "PAY THE TRIBUTE", cls: "", enabled: S.gold >= tribute,
            hint: "-$" + tribute + " · HE LEAVES YOU ALONE",
            run: function () {
              if (!W.pay(tribute)) return;
              for (let i = 0; i < cols.length; i++) { cols[i].cooldown = 600; cols[i].mood = "roam"; cols[i].hostile = 0; }
              W.log("paid tribute to " + name + ".", "bad");
              loyMove(-10, "you paid another warlord");
              S.fame = Math.max(0, S.fame - 8);
              if (rider) { rider.gold += tribute; rideOff(rider); }
            } },
          { key: "defy", label: "SEND HIM BACK ON FOOT", cls: "hot",
            hint: "+FAME · " + esc(name) + " HUNTS YOU",
            run: function () {
              for (let i = 0; i < cols.length; i++) {
                const c = cols[i];
                c.mood = "hunt"; c.goal = { x: S.you.x, z: S.you.z }; c.cooldown = 0; c.hostile = 1;
                /* the road in front of them. His nearest column is often a
                   kilometre out, which is exactly the range at which a dust
                   line on the sand is the only thing that can carry this. */
                trailBehind(c, (Math.hypot(c.x - S.you.x, c.z - S.you.z) / BAND_SPEED) * 1.2);
              }
              S.fame += 12;
              W.log("sent " + name + "'s rider back on foot.", "good");
              loyMove(+11, "they have been waiting for you to say that");
              W.toast(name.toUpperCase() + " IS COMING", "bad");
              if (rider) rideOff(rider);                 // on foot, as promised
            } },
        ],
      };
    },
  });

  /* ---- 19. the ringleader warning. NOT weighted — loyalty fires this one
       directly, because a mutiny you were not warned about is a bug report. */
  add({
    id: "ringleader", tag: "TONIGHT, IN THE CAMP", weight: function () { return 0; },
    build: function () {
      const lead = ringleader();
      const cut = faction(0.45);
      const bonus = Math.round(W.payroll() * 4 + cut.length * 12);
      const name = lead ? lead.name : "somebody";
      return {
        title: 'THEY ARE <em>DECIDING</em>',
        sub: "LOYALTY " + loyalty() + " — " + mood().label,
        body: 'There is a fire on the far side of the camp with ' + cut.length + ' men around it ' +
              'and ' + esc(name) + ' in the middle of them, and when you walk over the talking stops. ' +
              'This is the last night this is a conversation.',
        choices: [
          { key: "pay", label: "PAY A BONUS TO EVERY MAN", cls: "hot", enabled: S.gold >= bonus,
            hint: "-$" + bonus + " · LOYALTY UP HARD",
            run: function () {
              if (!W.pay(bonus)) return;
              W.log("paid $" + bonus + " out to the whole column in one night.", "good");
              loyMove(+26, "silver, in every hand, tonight");
              ev().unrest = 0;
            } },
          { key: "kill", label: "TAKE " + (lead ? lead.name.toUpperCase() : "HIM") + " OUT OF THE CAMP", cls: "bad",
            hint: "LOYALTY DOWN · IT MIGHT HOLD",
            run: function () {
              if (lead) { bury(lead, "executed by you"); W.removeSoldier(lead.id, true); }
              S.stats.executed += 1;
              W.log("walked " + esc(name) + " out of the camp. He did not walk back.", "bad");
              loyMove(-9, "you killed the man they were listening to");
              ev().unrest = Math.max(0, ev().unrest - 2);
              reconcile();
            } },
          { key: "let", label: "OPEN THE GATE", cls: "",
            hint: "-" + men(cut.length),
            run: function () {
              for (let i = 0; i < cut.length; i++) W.removeSoldier(cut[i].id, false);
              W.log(cut.length + " men walked out of camp at first light. Nobody stopped them.", "bad");
              loyMove(+22, "the ones who stayed, stayed on purpose");
              ev().unrest = 0;
              reconcile();
            } },
        ],
      };
    },
  });

  /* ---- 20. the contract payoff card, fired by the aftermath, not by weight. */
  add({
    id: "paid", tag: "A DEBT SETTLED", weight: function () { return 0; },
    build: function (arg) {
      const c = arg || {};
      const n = c.men || 4;
      return {
        title: 'THE WELL AT <em>' + esc(c.from || "ADH-DHIB") + '</em>',
        sub: "THEY HEARD BEFORE YOU ARRIVED",
        body: 'The headman is standing in the gate with ' + n + ' young men behind him who have ' +
              'already packed. Volunteers, every one.',
        choices: [
          { key: "take", label: "TAKE THEM", cls: "hot", hint: "+" + men(n) + " · volunteers",
            run: function () {
              for (let i = 0; i < n; i++) join("levy", gunFor(0.2), 0.78);
              S.fame += 6;
              if (FLAG_NOSHOW) W.toast("+" + men(n), "good");
              W.log("collected " + n + " volunteers from " + (c.from || "the village") + ".", "good");
              loyMove(+6, "you kept a promise where people could see");
              reconcile();
            } },
          { key: "gold", label: "TAKE COIN INSTEAD", cls: "",
            hint: "+$" + (n * 30),
            run: function () { W.earn(n * 30); S.fame += 3; W.log("took coin from " + (c.from || "the village") + " instead of sons.", ""); loyMove(+2, ""); } },
        ],
      };
    },
  });

  function libById(id) { for (let i = 0; i < LIB.length; i++) if (LIB[i].id === id) return LIB[i]; return null; }

  /* ============================================================ THE ROLL
     Weighted pick with a REPEAT PENALTY, because the single fastest way to
     make a library of eighteen cards feel like a library of three is to let
     the same one come up twice in a week. A card fired recently is divided
     down rather than banned outright — banning produces a rotation the player
     can feel, and this produces a memory. */
  function pickEvent() {
    const v = ev();
    let total = 0;
    const rows = [];
    for (let i = 0; i < LIB.length; i++) {
      const L = LIB[i];
      let w = 0;
      safe(function () { w = L.weight() || 0; });
      if (w <= 0) continue;
      const last = v.fired[L.id];
      if (last != null) {
        const age = S.day - last;
        if (age < 2) continue;
        w *= clamp(age / 14, 0.12, 1);
      }
      total += w;
      rows.push({ L: L, w: w });
    }
    if (!rows.length) return null;
    let t = W.rnd() * total;
    for (let i = 0; i < rows.length; i++) { t -= rows[i].w; if (t <= 0) return rows[i].L; }
    return rows[rows.length - 1].L;
  }

  function fire(id, arg) {
    const L = typeof id === "string" ? libById(id) : id;
    if (!L) return false;
    let card = null;
    safe(function () { card = L.build(arg); });
    if (!card) return false;
    card.id = L.id;
    card.tag = card.tag || L.tag;
    ev().fired[L.id] = S.day;
    ev().seen++;
    showCard(card);
    return true;
  }
  E.fire = function (id, arg) {
    // the debug door: it does not care about the phase gate, only about a
    // free screen, so a card can be photographed from anywhere. It DOES obey
    // ?events=off, because a revert flag that the screenshot tool can talk its
    // way past is a revert flag that proves nothing.
    if (FLAG_NOEVENTS) return false;
    if (CARD) closeCard();
    const L = typeof id === "string" ? libById(id) : id;
    /* THE DOOR CASTS TOO — inside reach, so the men are standing behind the
       rail on the frame it opens. A screenshot of a people-card without its
       people would be a picture of the bug this exists to remove. */
    if (L && L.cast && canStage()) {
      dropCast();
      if (castCard(L, { near: true, arg: arg })) return fireCast();
    }
    return fire(id, arg);
  };

  E.maybeFire = function () {
    if (FLAG_NOEVENTS || !canOpen() || CAST) return false;
    if (ev().over) return false;
    const L = pickEvent();
    if (!L) return false;
    // a people-card puts its people on the road and waits for you to reach them
    if (L.cast && canStage()) return !!castCard(L);
    return fire(L);
  };

  /* ============================================================ MUTINY
     THE END OF THE LOYALTY CURVE, AND IT IS A BATTLE.

     A mutiny that resolves in a dialog ("you lose 12 men") is a number telling
     you a story happened. So the faction LEAVES the roster, becomes a real
     W.makeBand carrying the exact guns and tiers those exact men were carrying
     five seconds ago, and battle.js puts them on the sand opposite the men who
     stayed. Nothing about that fight is special-cased: it is the same engine,
     the same combat_iq, the same corpses. That is the entire point.

     Losing it is the one death in this game that is not negotiable — the men
     who wanted you dead are standing over you and there is nobody left to
     drag you out. */
  function mutinyRisk() {
    const v = ev();
    if (FLAG_NOLOYALTY || S.army.length < 4) return 0;
    const l = v.loy;
    if (l >= 20) return 0;
    return clamp((20 - l) / 55 + v.unrest * 0.07, 0, 0.85);
  }

  /* THE PICTURE OF A MUTINY, and what was wrong with the old one.

     The old code took the men off the roster — so they vanished out of the
     drawn column between two frames — and built their band at
     {x: S.you.x, z: S.you.z}, which is INSIDE YOU, geometrically. It then
     never pushed that band onto S.bands at all, so it was not drawn, had no
     banner, cast no shadow and was not on the map. There was no frame of this
     game on which a mutiny existed. What existed was a card describing a fire
     and two sides, neither of which was anywhere.

     So: they walk out. Their side of the camp is measured off the two parties'
     own trampled road widths (sand.js's bandWidth, the number it would use to
     draw them) with one man's width of clear ground and a fire's radius
     between — the fire is BETWEEN THEM AND YOU because that is what the card
     always said and it was never true. Pushing the band onto S.bands is what
     raises their banner: campaign.js:2901 puts a pole and a flag over every
     party on the island, scaled by log2 of its head count. */
  function stageMutiny(b, n) {
    if (!canStage()) return 0;
    /* THE RIDE STOPS. showCard() halts the column when a card goes up, and the
       card is now three seconds behind the walk — so without this the player
       rides on through his own mutiny and the whole thing happens two hundred
       metres behind him. Measured on the first ba run: the mutineers were
       200 m away by the time their card appeared. Same one call showCard
       makes; campaign.js owns the destination and is asked, not reached into. */
    halt();
    const you = S.you;
    const yaw = you.yaw || 0;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const halfYou = widthOf(Math.max(1, S.army.length)) / 2;
    const halfThem = widthOf(n) / 2;
    const lane = widthOf(1);                 // one man's width of empty ground
    const gap = halfYou + lane + FIRE_R;     // the fire
    const sep = gap + FIRE_R + lane + halfThem;
    const D = W.desert;
    /* IN FRONT OF YOU IF THE GROUND ALLOWS IT, behind you if it does not. A
       camp splitting into the sea is worse than a camp splitting the wrong
       way, and on a 14 km island with a coast this happens. */
    let dir = 1;
    if (D.onLand && !D.onLand(you.x + fx * sep, you.z + fz * sep)) dir = -1;
    const tx = you.x + fx * sep * dir, tz = you.z + fz * sep * dir;
    if (D.onLand && !D.onLand(tx, tz)) return 0;
    b.x = you.x + fx * dir * halfYou;        // they start at your elbow, in camp
    b.z = you.z + fz * dir * halfYou;
    stampCampaignFields(b);
    holdBand(b);
    S.bands.push(b);
    fireAt(you.x + fx * dir * gap, you.z + fz * dir * gap, 60);
    const walk = sep / BAND_SPEED;
    march(b, { x: tx, z: tz, arrive: 0.6, budget: walk * 3,
               done: function () { churn(tx, tz, n, yaw); puff(tx, tz, 1); } });
    /* THE HOLD IS THE WALK AGAIN — as long standing across the fire as it took
       to walk out of the camp. Same rule territory.js's claim uses, for the
       same reason: a beat's pause should be derived from the beat. */
    return walk * 2;
  }

  function mutiny() {
    const v = ev();
    const cut = faction(clamp(0.35 + (20 - v.loy) / 60, 0.3, 0.72));
    if (cut.length < 2) return false;
    const lead = ringleader();
    // they take their own kit off the roster with them — keepKit:false, because
    // the rifle walks out of camp in the hands that were holding it
    for (let i = 0; i < cut.length; i++) W.removeSoldier(cut[i].id, false);
    const b = W.makeBand({ size: 1, faction: "warlord", x: S.you.x, z: S.you.z });
    b.men = cut;
    b.name = lead ? lead.name.toUpperCase() + "'S MEN" : "THE MUTINEERS";
    b.gold = 0;
    b.mood = "hunt";
    b.cooldown = 0;
    b.mutiny = true;
    v.unrest = 0;
    v.loy = clamp(v.loy + 24, 0, 100);   // the ones who stayed just declared themselves
    reconcile();
    W.log(cut.length + " men turned on you in the night. " + b.name + ".", "bad");
    W.emit("events:mutiny", { men: cut.length, band: b });
    closeCard();
    css();
    const card = {
      id: "mutiny", tag: "IT IS TONIGHT",
      title: '<em>MUTINY</em>',
      sub: cut.length + " AGAINST " + (S.army.length + 1),
      /* THE BODY IS ONE LINE NOW. It used to describe the fire, the rifles and
         which side of the fire each half of the army was standing on — all
         three of which are now on the screen behind the card, drawn, in the
         seconds before it goes up. What is left is the only thing the picture
         cannot say. */
      body: FLAG_NOSHOW
        ? ('They came for the trucks first and then for you. ' + cut.length + ' men are on the ' +
           'other side of the fire with the rifles you gave them, and ' + S.army.length +
           ' are on this one.')
        : 'Lose this one and there is nobody left to carry you off.',
      choices: [
        { key: "fight", label: "PUT IT DOWN", cls: "bad",
          hint: cut.length + " MEN · YOUR OWN",
          run: function () {
            /* the band goes to battle.js, so it stops being a party on the
               island the same frame — a mutineer band left on S.bands would be
               drawn standing in the camp for the whole fight and still be
               there afterwards. */
            releaseBand(b);
            const i = S.bands.indexOf(b);
            if (i >= 0) S.bands.splice(i, 1);
            darkenStage();
            if (W.battle && W.battle.start) safe(function () { W.battle.start({ band: b, defending: true, mutiny: true }); });
            else { endRun("mutiny", "Your own men killed you in the dark."); }
          } },
      ],
    };
    const wait = stageMutiny(b, cut.length);
    if (wait > 0) after(wait, function () { showCard(card); });
    else showCard(card);
    return true;
  }
  E.mutiny = mutiny;

  /* ============================================================ THE ISLAND
     THE WIN CONDITION, AND WHY IT IS NO LONGER THE ONE THIS FILE INVENTED.

     WHAT WAS HERE: THE FOUR. Four named warlords, picked once, and the run was
     won when all four were broken. It was written against a comment in core.js
     ("four armies of 120-320 exist on this island … they are the endgame") and
     as an ARC it was good: break three and the survivor absorbs the rest and
     comes for you. Two things killed it.

     ONE, IT COULD NOT COUNT. "Broken" was `men <= max(4, size0 * 0.15)`, and
     match.js could not put a single column on the island (see its
     COLUMN_CEILING tombstone), so every warlord had zero men and all four were
     already broken before the player had met anybody. First aftermath of the
     first skirmish: THE ISLAND IS YOURS, day one, two dead. That is the
     screenshot the owner sent.

     TWO, IT WAS A SCOREBOARD ABOUT FOUR PEOPLE ON AN ISLAND OF TWENTY-ONE.
     Fourteen rivals, five factions and you all hold ground on the same map,
     and a win condition that watches four of them is blind to the DESERT
     LEGION taking a third of the north.

     WHAT IS HERE NOW is openfront's rule and nothing invented: THE RUN IS WON
     WHEN YOU HOLD 80% OF THE PROVINCES. territory.js owns the arithmetic
     (T.winTarget, derived off however many holdings the island cut itself
     into), the fraction is on the strip from the first frame, and it cannot be
     satisfied by an accident because every one of those provinces had to be
     taken off somebody.

     THE FOUR'S GOOD PARTS SURVIVE, pointed at the live standing instead of a
     frozen list: the leaderboard screen (openWar), the summons card, and the
     LAST WAR — when every other rival is out, the survivor takes in what is
     left of them and comes for you. */
  function WL() { return (W.warlords && W.warlords.list) ? W.warlords : null; }

  function menOf(wid) {
    const M = WL();
    if (!M || !M.menOut) return 0;
    return M.menOut(wid);
  }

  /* THE STANDING, WITH THE THINGS THIS FILE CARES ABOUT WELDED ON. match.js's
     leaderboard answers "who holds what and who has how many men out"; a
     screen in here also needs his nearest column (that is the one the odds and
     the distance are about) and whether he is your ally or a man you betrayed.

     ONE row per contender, and every one of them is on it: you, fourteen named
     rivals, any human peers, and each of core's five factions still holding
     ground. THE FOUR was a list of four in a world of twenty-one. */
  function board() {
    const M = WL();
    if (!M || !M.leaderboard) return [];
    let rows = [];
    try { rows = M.leaderboard(); } catch (e) { return []; }
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      r.band = null; r.dist = null; r.power = 0;
      if (r.kind === "warlord" || r.kind === "peer") {
        const cols = M.columns ? M.columns(r.id) : [];
        let bd = 1e18;
        for (let j = 0; j < cols.length; j++) {
          const c = cols[j];
          r.power += W.bandPower(c);
          const d = Math.hypot(c.x - S.you.x, c.z - S.you.z);
          if (d < bd) { bd = d; r.band = c; r.dist = d; }
        }
        r.note = r.grudge ? "HE HUNTS YOU" : r.allied ? "ALLIED" : "";
      } else if (r.kind === "you") {
        r.power = W.yourPower();
      }
    }
    return rows;
  }
  E.board = board;
  /* the living rivals, best first — what the summons card picks from and what
     the last war counts down to. */
  function rivals() {
    return board().filter(function (r) { return r.kind === "warlord" && !r.out; });
  }

  /* HOW MUCH OF THE ISLAND IS YOURS, and how much of it wins the run. One
     call, because the chip, the leaderboard screen, the end screen and a
     headless probe all print it and none of them may type 32. */
  function land() {
    const T = W.territory;
    if (!T || !T.share) return { held: 0, of: 0, need: 0, won: false };
    try { return T.share("you"); } catch (e) { return { held: 0, of: 0, need: 0, won: false }; }
  }
  E.land = land;

  /* ============================================================ THE BOOK
     WHO WENT OUT, AND WHEN THE LAST WAR STARTS.

     This used to be checkFour(), and it is worth writing down exactly what it
     did wrong because it is the bug the owner photographed. It marked a
     warlord BROKEN when `men <= Math.max(4, size0 * 0.15)`, where size0 was
     the men he had when the list was raised. match.js could not raise a single
     column (see its COLUMN_CEILING tombstone), so every warlord had zero men,
     so size0 was 1, so `0 <= 4` was true for all four of them — and the first
     time anything called this, which is the first aftermath of the first
     skirmish, all four "broke" and the run was WON. Day one, two dead.

     There is no floor now and no size0. A warlord is out when match.js's
     retire() says he is out — he holds nothing and rides nothing — which is
     one system's answer to one question, and it cannot be true of a man who
     has never been given anything to lose. */
  function checkBoard() {
    if (FLAG_NOEND) return;
    const v = ev();
    const M = WL();
    if (!M) return;
    const seen = {};
    for (let i = 0; i < v.fell.length; i++) seen[v.fell[i].id] = 1;
    const rows = board();
    let live = 0, fellNow = null;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.kind !== "warlord") continue;
      if (!r.out) { live++; continue; }
      if (seen[r.id]) continue;
      seen[r.id] = 1;
      v.fell.push({ id: r.id, name: r.name, day: S.day });
      fellNow = r;
      W.emit("events:warlord", { name: r.name, fallen: true });
    }
    if (fellNow) {
      W.log(fellNow.name + " is finished. " + live + " rivals left.", "good");
      S.fame += 40;
      loyMove(+12, "they broke a warlord and they know it");
      W.toast(fellNow.name + " IS FINISHED", "good");
    }
    /* THE LAST WAR, POINTED AT THE LEADERBOARD'S TOP NAME. Everyone else is
       out and the survivor stops being a party on a map: he takes in what is
       left of the rest and comes for you. Kept exactly as it was — it is a
       good moment — and only its trigger changed, from "three of four are
       broken" to "he is the only rival left standing". */
    if (live === 1 && !v.last) {
      const f = rivals()[0];
      const b = f && f.band;
      if (b) {
        v.last = f.id;
        const take = Math.round(Math.max(1, f.men) * 0.45);
        for (let i = 0; i < take; i++) {
          const F = W.faction(b.faction);
          const tid = F.tiers[Math.floor(W.rnd() * F.tiers.length)];
          b.men.push(W.makeSoldier(tid, W.bandGunFor(b.wealth)));
        }
        b.name = f.name + " — THE LAST";
        b.mood = "hunt";
        b.goal = { x: S.you.x, z: S.you.z };
        b.cooldown = 0;
        W.log(b.name + " has taken in everything that is left. He is coming.", "bad");
        W.toast("THE LAST WAR", "bad");
        // only take the screen if nobody else has it — this can land inside an
        // aftermath, and stamping over army.js's casualty list is the exact
        // two-modules-drawing bug the contract exists to prevent
        if (canOpen()) openWar();
      }
    }
    checkVictory();
  }

  /* ============================================================ VICTORY IS LAND
     openfront's rule, and territory.js owns the arithmetic (T.winTarget is
     ceil(regions * 0.8), derived off however many holdings the island cut
     itself into). This is only the moment it is noticed. */
  function checkVictory() {
    if (FLAG_NOEND) return;
    if (ev().over) return;
    if (land().won) victory();
  }

  /* ============================================================ THE END
     LOSING HAS TO FEEL RECOVERABLE UNTIL IT ISN'T, so there are exactly three
     ways to die and every one of them gives you a look at it coming first.

       1. YOU GO DOWN AND NOBODY IS LEFT TO CARRY YOU. battle.js already ends
          a fight the moment the warlord falls; what it cannot decide is
          whether that is death, because that depends on whether anybody
          survived to drag you off the sand. So: lose with men still standing
          and you wake up at a quarter health having lost the field. Lose with
          nobody standing and you do not wake up. That single rule is what
          makes "how many men did I bring" the question at every encounter.
       2. YOUR OWN MEN. Losing the mutiny is death, always, and you got a
          warning card and a loyalty meter before it.
       3. NOTHING LEFT. No men, no gold, nothing in the cart, three dawns
          running. Two warnings, then the salt.

     WINNING IS LAND — 80% of the island's provinces, and see checkVictory. */
  function endRun(kind, why) {
    const v = ev();
    if (v.over) return;
    v.over = { kind: kind, why: why, day: S.day };
    W.emit("events:over", { kind: kind, why: why });
    W.setPhase("over");
    summary();
  }
  E.over = endRun;

  function victory() {
    const l = land();
    endRun("won", "You hold " + l.held + " of the island's " + l.of +
      " provinces. There is nobody left on it who can tell you no.");
  }

  function bankruptCheck() {
    if (FLAG_NOEND) return;
    const v = ev();
    let cart = 0;
    Object.keys(S.baggage || {}).forEach(function (k) { cart += W.gunSell(k) * S.baggage[k]; });
    Object.keys(S.armourBag || {}).forEach(function (k) { cart += W.armourSell(k) * S.armourBag[k]; });
    const broke = S.army.length === 0 && S.gold < W.tier("levy").hire && cart < W.tier("levy").hire;
    if (!broke) { v.broke = 0; return; }
    v.broke++;
    if (v.broke === 1) W.toast("NO MEN. NO MONEY. NOTHING IN THE CART.", "bad");
    if (v.broke === 2) W.log("second day alone with nothing. The wells are two days apart out here.", "bad");
    if (v.broke >= 3) endRun("broke", "You ran out of everything a man needs on this island, in this order: men, money, water.");
  }

  /* WHAT YOU BECAME — read off what you actually did, in priority order,
     because a title that is "warlord" every time is not a title. */
  function title() {
    const st = S.stats || {};
    const v = ev();
    if (v.over && v.over.kind === "won") return "THE DESERT WARLORD";
    if ((st.executed || 0) >= 14) return "THE BUTCHER OF THE PAN";
    if ((st.conscripted || 0) > (st.recruited || 0) * 2.5 && v.peak > 40) return "THE PRESS-GANG";
    if ((st.recruited || 0) > (st.conscripted || 0) * 2 && v.peak > 40) return "THE PAYMASTER";
    if (v.fell.length >= 2) return "BREAKER OF WARLORDS";
    if (v.peak >= 150) return "THE COLUMN THAT DID NOT STOP";
    if ((st.battles || 0) >= 15 && (st.won || 0) * 2 < (st.battles || 0)) return "THE MAN WHO KEPT TRYING";
    if (v.peak <= 6) return "A MAN WITH A PISTOL";
    return "A NAME PEOPLE KNEW FOR A WHILE";
  }

  /* ============================================================ SCREENS */
  function meter(frac, cls) {
    return '<div class="wl-meter ' + (cls || "") + '"><i style="width:' + Math.round(clamp(frac, 0, 1) * 100) + '%"></i></div>';
  }

  function summary() {
    css();
    const v = ev();
    const st = S.stats || {};
    const kind = v.over ? v.over.kind : "over";
    const won = kind === "won";
    const fallen = v.fallen;
    const shown = fallen.length > 90 ? fallen.slice(0, 45).concat(fallen.slice(-45)) : fallen;
    let names = "";
    for (let i = 0; i < shown.length; i++) {
      const f = shown[i];
      names += '<span class="wl-name">' + esc(f.name) + ' <b>' + esc(W.tier(f.tier).label) + ' · D' + f.day + '</b></span>';
    }
    if (!shown.length) names = '<span class="wl-dim">NOBODY</span>';

    /* THE FINAL STANDINGS, and they are the same picture as the leaderboard
       you have been reading all run rather than a second one written for the
       ending. Capped at ten rows: on a 393 pt phone twenty-one contenders is
       a scroll nobody reaches the bottom of, and the bottom of a leaderboard
       is where the people who lost are. */
    const rows = board();
    const l = land();
    let stand = "";
    for (let i = 0; i < rows.length && i < 10; i++) {
      const r = rows[i];
      stand += '<div class="w' + (r.out ? " dead" : "") + '"' +
        (r.kind === "you" ? ' style="border-color:#ff8a3d"' : '') + '><b>' + esc(r.name) + '</b>' +
        '<div class="wl-small wl-dim">' + (r.out ? "OUT" :
          r.held + (r.held === 1 ? " PROVINCE" : " PROVINCES") + " · " +
          (r.kind === "faction" ? (r.parties || 0) + " PARTIES" : r.men + " MEN")) +
        '</div></div>';
    }

    takeScreen(
      '<div class="wl-ch">' +
      '<h1 class="wl-h">' + (won ? 'THE ISLAND IS <em>YOURS</em>' : 'IT <em>ENDS</em> HERE') + '</h1>' +
      '<p class="wl-sub">DAY ' + S.day + ' · ' + esc(title()) + '</p>' +
      '<div class="wl-card"><div style="opacity:.9;line-height:1.5;font-weight:500">' +
        esc(v.over ? v.over.why : "") + '</div></div>' +
      '<div class="wl-lbl">THE RUN</div>' +
      /* THE RUN, AS THE GAME NOW MEASURES IT. PROVINCES HELD is first after
         the day count because it is the win condition — a summary whose top
         line is not the thing you were playing for is a summary of a
         different game. HIRED/PRESSED split into their own tiles because the
         aftermath's three verbs are exactly that decision, made over and over,
         and this is the only place the run adds them up. */
      '<div class="wl-stats">' +
        statCard("DAYS", S.day) +
        statCard("PROVINCES HELD", l.held + " OF " + l.of) +
        statCard("BIGGEST COLUMN", v.peak + " MEN") +
        statCard("BATTLES", (st.battles || 0) + " — " + (st.won || 0) + " WON") +
        statCard("THEY LOST", (st.killed || 0) + " DEAD") +
        statCard("YOU LOST", (st.lost || 0) + " DEAD") +
        statCard("PRESSED", st.conscripted || 0) +
        statCard("EXECUTED", st.executed || 0) +
        statCard("FAME", S.fame) +
      '</div>' +
      '<div class="wl-lbl">THE ISLAND</div><div class="wl-four">' + stand + '</div>' +
      '<div class="wl-lbl">YOUR DEAD — ' + fallen.length + '</div>' +
      '<div class="wl-card">' + names + '</div>' +
      '<div class="wl-btns">' +
        '<button class="wl-btn hot" id="ovNew">RIDE OUT AGAIN</button>' +
        '<button class="wl-btn" id="ovLog">THE CHRONICLE</button>' +
      '</div></div>'
    );
    const nb = ctx.el("ovNew");
    if (nb) nb.onclick = function () { W.wipe(); W.emit("mainmenu"); };
    const lb = ctx.el("ovLog");
    if (lb) lb.onclick = function () { openChronicle(summary); };
  }

  function statCard(label, val) {
    return '<div class="wl-stat"><div class="wl-small wl-dim">' + esc(label) + '</div>' +
           '<b>' + esc(String(val)) + '</b></div>';
  }

  /* ---- THE CHRONICLE ---- */
  function openChronicle(back) {
    css();
    const v = ev();
    const log = S.log || [];
    let body = "";
    let day = null;
    for (let i = log.length - 1; i >= 0; i--) {
      const r = log[i];
      if (r.day !== day) { day = r.day; body += '<div class="day">DAY ' + day + '</div>'; }
      body += '<div class="ln ' + esc(r.kind || "") + '">' + esc(r.text) + '</div>';
    }
    if (!body) body = '<div class="wl-dim">NOTHING YET</div>';
    const st = S.stats || {};
    takeScreen(
      '<div class="wl-ch">' +
      '<h1 class="wl-h">THE <em>CHRONICLE</em></h1>' +
      '<p class="wl-sub">DAY ' + S.day + ' · ' + W.armySize() + ' MEN · ' + esc(title()) + '</p>' +
      '<div class="wl-stats">' +
        statCard("BATTLES", (st.battles || 0) + " — " + (st.won || 0) + " WON") +
        statCard("YOUR DEAD", v.fallen.length) +
        statCard("LOYALTY", loyalty() + " " + mood().label) +
      '</div>' +
      '<div class="wl-lbl">WHAT HAPPENED</div>' +
      '<div class="wl-card">' + body + '</div>' +
      '<div class="wl-btns"><button class="wl-btn hot" id="chBack">BACK</button></div>' +
      '</div>'
    );
    const b = ctx.el("chBack");
    if (b) b.onclick = function () {
      if (back) back();
      else giveBackScreen();
    };
  }
  E.chronicle = function () { if (!FLAG_NOEVENTS) openChronicle(null); };

  /* ---- THE ARMY'S OPINION OF YOU ---- */
  function openLoyalty() {
    css();
    const v = ev();
    const m = mood();
    const list = S.army.slice().sort(function (a, b) { return bondOf(a) - bondOf(b); }).slice(0, 12);
    let rows = "";
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      const bd = bondOf(s);
      rows += '<div class="wl-man"><span class="who">' + esc(s.name) +
        '<i>' + esc(W.tier(s.tier).label) + ' · ' + (s.battles || 0) + ' FIGHTS</i></span>' +
        '<span class="st">' +
        (bd < 0.22 ? "WOULD LEAVE TONIGHT" : bd < 0.4 ? "LISTENING" : bd < 0.62 ? "STAYING FOR NOW" : "YOURS") +
        '</span></div>';
    }
    if (!rows) rows = '<div class="wl-dim">NOBODY</div>';
    const pressed = S.army.filter(function (s) { return (v.base[s.id] || BASE_UNKNOWN) <= BASE_PRESSED + 0.02; }).length;
    takeScreen(
      '<div class="wl-ev">' +
      '<h1 class="wl-h">THE ARMY\'S <em>OPINION</em></h1>' +
      '<p class="wl-sub">' + esc(m.label) + ' — ' + loyalty() + ' / 100</p>' +
      '<div class="wl-card">' + meter(loyalty() / 100, loyalty() < 30 ? "bad" : loyalty() > 70 ? "good" : "") +
        '<div class="wl-small wl-dim" style="margin-top:6px">' + esc(m.note) + '</div></div>' +
      '<div class="wl-stats">' +
        statCard("CEILING", Math.round(avgBond() * 100) + " / 100") +
        statCard("PRESSED MEN", pressed + " of " + S.army.length) +
        statCard("EXECUTIONS", (S.stats && S.stats.executed) || 0) +
      '</div>' +
      /* THE MANUAL PAGE IS DELETED — 372 characters explaining the loyalty
         formula to the player, in a card sitting directly underneath the
         three tiles that MEASURE it. "Loyalty drifts every dawn toward the
         CEILING" is the CEILING tile. "A man you took off a battlefield
         starts near 26" is the PRESSED MEN tile. "Every execution poisons the
         whole column" is the EXECUTIONS tile, and it is also the chip on the
         aftermath's EXECUTE button, which now prints the exact percentage.
         "Under 20 they start deciding, and they will tell you first" is the
         meter turning red and the mutiny card arriving. Every clause of it
         was already on the screen as a number or a colour; the paragraph was
         the game explaining its own systems to somebody reading a status
         screen, which is a wiki, not a world. */
      '<div class="wl-lbl">THINKING ABOUT IT</div>' +
      '<div class="wl-card">' + rows + '</div>' +
      '<div class="wl-btns">' +
        '<button class="wl-btn hot" id="loBack">BACK</button>' +
        '<button class="wl-btn" id="loCh">THE CHRONICLE</button>' +
        (board().length ? '<button class="wl-btn" id="loWar">THE ISLAND</button>' : '') +
      '</div></div>'
    );
    const b = ctx.el("loBack");
    if (b) b.onclick = function () { giveBackScreen(); };
    const c = ctx.el("loCh");
    if (c) c.onclick = function () { openChronicle(openLoyalty); };
    const w = ctx.el("loWar");
    if (w) w.onclick = function () { openWar(); };
  }
  E.loyaltyScreen = openLoyalty;

  /* ---- THE ISLAND: the leaderboard, and the progress bar for the whole run ----
     This screen was THE FOUR: four frozen names, a bar counting how many of
     them you had broken, and the odds against each. Two of those three were
     lies about the game. The four were picked once at boot out of twenty-one
     contenders and never re-picked, so the DESERT LEGION could take nine
     provinces and not appear on the screen that says who is winning; and the
     bar measured a win condition that no longer exists.

     What is here instead is the standing — everybody on the island, ranked the
     way the game itself ranks them, with your own row marked — under the one
     bar that IS the run: how much of the island you hold against how much of
     it wins. The odds are kept, on the rivals, because "can I take him" is
     still the question you open this screen with. */
  function openWar() {
    /* ?events=off ADDS NOTHING TO THE PAGE, and that promise covers the
       screens too. board() reads match.js and territory.js, both of which are
       alive under the flag, so without this guard the whole-wave revert
       photographed a fully populated leaderboard — a "before" side showing the
       feature it is the before side of. */
    if (FLAG_NOEVENTS) return;
    css();
    const rows = board();
    const v = ev();
    const l = land();
    const mine = W.yourPower();
    let cards = "";
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      let line;
      if (r.out) line = "OUT";
      else if (r.kind === "you") line = r.men + " MEN RIDING WITH YOU";
      /* A FACTION IS A POPULATION, NOT AN ARMY. Its "men" are two hundred
         unrelated caravans and looter crews sharing a colour, so printing that
         total beside a warlord's 185-man column claims a command that does not
         exist. Parties is the honest unit for it, and it is the one that says
         what the island actually looks like. */
      else if (r.kind === "faction") {
        line = (r.parties || 0) + (r.parties === 1 ? " PARTY" : " PARTIES") + " ON THE ISLAND";
      }
      else if (!r.men) line = "NOTHING IN THE FIELD";
      else if (r.dist != null) {
        const d = Math.round(r.dist);
        line = r.men + " MEN · " + (d > 999 ? (d / 1000).toFixed(1) + " km" : d + " m") +
          " · YOU WIN " + Math.round(W.odds(mine, r.power || 1) * 100) + "%";
      } else line = r.men + " MEN OUT";
      const odds = r.power > 0 ? W.odds(mine, r.power) : 0;
      cards += '<div class="w' + (r.out ? " dead" : "") + '"' +
        (r.kind === "you" ? ' style="border-color:#ff8a3d"' : '') + '>' +
        '<b>' + (r.rank) + '. ' + esc(r.name) + '</b>' +
        '<div class="wl-small wl-dim" style="margin-bottom:5px">' +
          r.held + (r.held === 1 ? " PROVINCE" : " PROVINCES") +
          (r.note ? " · " + esc(r.note) : "") + '</div>' +
        '<div class="wl-small">' + esc(line) + '</div>' +
        (!r.out && r.kind !== "you" && r.power > 0 ? meter(odds, odds > 0.5 ? "good" : "bad") : "") +
        '</div>';
    }
    takeScreen(
      '<div class="wl-ch">' +
      '<h1 class="wl-h">THE <em>ISLAND</em></h1>' +
      '<p class="wl-sub">' + l.held + " OF " + l.of + ' · YOURS AT ' + l.need +
        (v.last ? " · THE LAST WAR" : "") + '</p>' +
      /* THE BAR IS THE WIN CONDITION AND THE BAR IS THE SENTENCE. No line
         under it explaining that eighty percent of the island ends the run —
         the bar has a target on it and the sub-heading says the number. */
      '<div class="wl-card">' + meter(l.need ? l.held / l.need : 0, l.won ? "good" : "") +
        (v.last ? '<div class="wl-small wl-dim" style="margin-top:7px">Every other rival is out. ' +
          'The survivor has taken in what is left of them and he is coming.</div>' : '') +
        '</div>' +
      '<div class="wl-four">' + cards + '</div>' +
      '<div class="wl-btns">' +
        '<button class="wl-btn hot" id="waBack">BACK</button>' +
        '<button class="wl-btn" id="waCh">THE CHRONICLE</button>' +
      '</div></div>'
    );
    const b = ctx.el("waBack");
    if (b) b.onclick = function () { giveBackScreen(); };
    const c = ctx.el("waCh");
    if (c) c.onclick = function () { openChronicle(openWar); };
  }
  E.war = openWar;

  /* ============================================================ THE STRIP
     LOYALTY HAS TO BE VISIBLE BEFORE IT KILLS YOU, which means it belongs in
     the persistent HUD and not behind a menu. warlord.html's paintHud owns
     that strip and rewrites its innerHTML, so this file wraps ctx.paintHud
     (route the name — never fork the shell) and appends after it. The chips
     are the only clickable things in the strip, so they get pointer-events
     back; everything else in #hud stays click-through. */
  function paintChips() {
    if (FLAG_NOEVENTS) return;
    const h = ctx && ctx.el ? ctx.el("hud") : document.getElementById("hud");
    if (!h || !h.classList.contains("on")) return;
    const old = h.querySelectorAll(".wl-evchip");
    for (let i = 0; i < old.length; i++) old[i].parentNode.removeChild(old[i]);
    const v = ev();
    const m = mood();
    const l = loyalty();
    const c1 = document.createElement("span");
    /* THE PULSE IS SPENT ON THE FIRST REPAINT AFTER THE CROSSING and then
       cleared, so it fires once per crossing rather than on every one of the
       four repaints a dawn triggers. */
    const pulse = v.pulse; v.pulse = 0;
    c1.className = "chip act wl-evchip" + (pulse > 0 ? " wl-up" : pulse < 0 ? " wl-dn" : "");
    c1.style.color = l < 20 ? "#ff8f86" : l < 46 ? "#ffd166" : "";
    c1.textContent = "LOYAL " + l + (v.unrest ? " !" : "");
    /* the authored reason, on the thing that moved. Not printed into the
       strip: the strip is already the tightest screen in this game and a
       clause in it would be the fourth telling. */
    c1.title = (v.why && v.whyDay === S.day) ? v.why : m.note;
    c1.onclick = function () { if (canOpen() || W.phase() === "campaign") openLoyalty(); };
    h.appendChild(c1);

    if (!FLAG_NOWEATHER && (v.wea !== "clear" || isNight())) {
      const c2 = document.createElement("span");
      c2.className = "chip wl-evchip";
      c2.style.color = v.wea === "storm" ? "#e0b070" : "";
      c2.textContent = isNight() && v.wea === "clear" ? "NIGHT" : WEATHER[v.wea].label;
      h.appendChild(c2);
    }
    /* THE CHIP IS THE RUN'S PROGRESS AND IT IS LAND. It read "0/4 WARLORDS",
       which was a count of a win condition that has been deleted and which
       printed 0/4 for the whole of a run in which you took half the island.
       territory.js's own chip carries the fraction; this one is the rank —
       where you stand on the leaderboard the screen behind it opens. */
    const rows = board();
    if (rows.length) {
      let me = null;
      for (let i = 0; i < rows.length; i++) if (rows[i].kind === "you") { me = rows[i]; break; }
      const c3 = document.createElement("span");
      c3.className = "chip act wl-evchip";
      c3.textContent = me ? ("#" + me.rank + " OF " + rows.length) : "THE ISLAND";
      if (me && me.rank === 1) c3.style.color = "#8fe0a2";
      c3.onclick = function () { if (W.phase() === "campaign") openWar(); };
      h.appendChild(c3);
    }
  }

  /* ============================================================ THE DAWN
     Everything that happens once a day happens HERE, in one place, in a fixed
     order, for the same reason core.js put the wage and the desertion in one
     function: two things that both fire "at dawn" from two files drift apart
     the first time somebody changes one of them. */
  function onDawn() {
    const wasUnpaid = unpaidToday;
    unpaidToday = false;
    reconcile();
    rollWeather();

    const v = ev();
    if (!FLAG_NOLOYALTY) {
      /* the drift toward the ceiling, then the day's own news. The drift is
         0.3 rather than 1 so a single good day cannot launder a bad month. */
      const ceiling = avgBond() * 100;
      v.loy += (ceiling - v.loy) * 0.3;
      const paid = !wasUnpaid;
      loyMove(paid ? 1.4 : -15, paid ? "paid" : "not paid");
      if (v.wea === "heat") loyMove(-2.5, "marched in killing heat");
      if (S.prisoners.length > S.army.length * 0.5 && S.prisoners.length > 4) {
        loyMove(-2, "the wire is bigger than the column");
      }
    }

    /* ---- THE MEN WHO SAID NO ------------------------------------------
       PRESS EVERY MAN is army.js's second verb: the unwilling march too. This
       is what it costs, and it is the reason it is a decision rather than a
       free TAKE ALL.

       WHO: a man whose provenance row is BASE_PRESSED — this file's own
       existing record of "he did not choose you", which the aftermath stamps
       before he is added. No new field on core's soldier and no second list.

       HOW OFTEN: his own doubt (1 - bondOf) against the army's own opinion of
       you (1 - loyalty), at the same per-dawn rate the loyalty drift above
       runs at. Every term is a number this file already keeps. A pressed levy
       in a devoted column is under two in a hundred a night; the same man in a
       sullen one is nearly one in five. So pressing a whole company is
       survivable if the rest of the army likes you and it bleeds out over a
       fortnight if it does not — which is exactly the trade the verb is for.

       AND HE TAKES HIS RIFLE. removeSoldier's keepKit:false — he is not
       deserting into your cart, he is walking off into the desert with what
       you handed him. */
    if (!FLAG_NOLOYALTY && S.army.length) {
      const DRIFT = 0.3;                       // the same per-dawn rate as above
      const gone = [];
      for (let i = 0; i < S.army.length; i++) {
        const s = S.army[i];
        if ((v.base[s.id] == null ? BASE_UNKNOWN : v.base[s.id]) > BASE_PRESSED + 0.02) continue;
        if (W.chance((1 - bondOf(s)) * (1 - v.loy / 100) * DRIFT)) gone.push(s);
      }
      for (let i = 0; i < gone.length; i++) W.removeSoldier(gone[i].id, false);
      if (gone.length) {
        W.log(gone.length + (gone.length === 1 ? " pressed man was" : " pressed men were") +
          " gone before light, and their rifles with them.", "bad");
        loyMove(-gone.length * 0.5, "the men you pressed are walking");
      }
    }

    /* KILLING HEAT kills, and it kills the men who were already hurt — which
       is core's own `wounded` flag doing the work rather than a new stat. */
    if (!FLAG_NOWEATHER && v.wea === "heat" && S.army.length) {
      const hurt = S.army.filter(function (s) { return s.wounded; });
      let dead = 0;
      for (let i = 0; i < hurt.length; i++) {
        if (W.chance(0.18 * v.weaP)) { bury(hurt[i], "heat"); W.removeSoldier(hurt[i].id, true); dead++; }
      }
      if (dead) {
        S.stats.lost += dead;
        W.log("the heat took " + dead + (dead === 1 ? " wounded man." : " wounded men."), "bad");
        loyMove(-dead * 1.2, "the heat took the hurt");
      }
    }

    /* THE WARNING BEFORE THE MUTINY. It fires at the unrest line, once, and
       it fires as a CARD — a toast is not a warning, it is a notification. */
    if (!FLAG_NOLOYALTY && S.army.length >= 4) {
      if (v.loy < 20) v.unrest++;
      else if (v.loy > 34) v.unrest = 0;
      if (v.loy < 26 && v.unrest === 0 && S.day - (v.warned || 0) > 5 && canOpen() && !FLAG_NOEVENTS) {
        v.warned = S.day;
        fire("ringleader");
      } else if (v.unrest >= 1 && canOpen() && W.chance(mutinyRisk())) {
        /* canOpen() GATES THE ROLL, not just the card. W.dawn() is also called
           from outpost.js's rest and from this file's own caravan card, and a
           mutiny that resolved while the depot screen was up would stamp its
           card over somebody else's phase — the exact two-modules-drawing bug
           the contract exists to stop. Not rolling costs nothing: unrest keeps
           climbing and it happens on the road, which is where it belongs. */
        mutiny();
      } else if (v.unrest >= 1 && S.day - (v.warned || 0) > 3 && canOpen() && !FLAG_NOEVENTS) {
        v.warned = S.day;
        fire("ringleader");
      }
    }

    // a revenge column promised by an earlier card arrives on its own day
    for (let i = v.contracts.length - 1; i >= 0; i--) {
      const c = v.contracts[i];
      if (c.kind === "revenge" && S.day >= c.day) {
        v.contracts.splice(i, 1);
        const b = spawnBandNear({ size: c.size, faction: "warlord", name: "THE MAN YOU LET GO", hunt: true, r: 2200, cooldown: 20, hidden: true });
        W.log("the warlord you let live has a column again. " + W.bandSize(b) + " men, and he knows your banner.", "bad");
        /* the toast is the log line again, two seconds earlier. The column
           itself is coming, with its road in front of it. */
        if (FLAG_NOSHOW) W.toast("HE CAME BACK", "bad");
      }
    }

    checkBoard();
    bankruptCheck();
    paintChips();
  }

  /* ============================================================ AFTERMATH
     What a battle does to the army's opinion of you, and to the run. */
  function onAftermath(r) {
    if (!r) return;
    reconcile();
    const v = ev();
    for (let i = 0; i < (r.yourDead || []).length; i++) bury(r.yourDead[i], r.mutiny ? "killed by your own men" : "battle");

    if (!FLAG_NOLOYALTY) {
      const lost = (r.yourDead || []).length;
      const before = lost + (r.yourSurvivors || []).length + (r.yourFled || []).length;
      const severity = before ? lost / before : 0;
      if (r.outcome === "won") loyMove(6 + 8 * (1 - severity), "a win, and cheap");
      else if (r.outcome === "retreat") loyMove(-7 - 10 * severity, "you broke off");
      else loyMove(-12 - 16 * severity, "you lost, and they buried their own");
    }

    /* THE CONTRACT PAYOFF. A promise you rode to collect — the village card's
       whole reason for existing is that its reward arrives later, somewhere
       else, after a fight you chose. It is QUEUED rather than shown: we are
       inside the aftermath, army.js is about to draw the casualty list, and a
       card that opens here gets painted over half a frame later. It fires on
       the next return to the island instead, which is also where it belongs
       narratively — you rode back to the village. */
    if (r.outcome === "won" && r.band) {
      for (let i = v.contracts.length - 1; i >= 0; i--) {
        const c = v.contracts[i];
        if (c.bandId && c.bandId === r.band.id) {
          v.contracts.splice(i, 1);
          v.payout = c;
        }
      }
    }

    /* THE ONE DEATH RULE. See THE END above: you go down in every lost battle,
       but whether that is death depends on whether anyone was left standing to
       carry you off. A mutiny lost is always death — the men standing over you
       are the ones who wanted you dead.

       DEFERRED BY ONE TICK for the same reason as the payout: W.emit fires
       "phase:aftermath" from inside setPhase, and army.js calls paintAftermath
       on the line AFTER that. Ending the run synchronously here puts the run
       summary up and then lets the casualty list paint straight over it — which
       is exactly what the first draft did, and it read as the game ignoring
       your death. */
    let end = null;
    if (!FLAG_NOEND && r.outcome === "lost") {
      const left = (r.yourSurvivors || []).length;
      if (r.band && r.band.mutiny) {
        end = ["mutiny", "Your own men put you in the sand beside the trucks you bought them."];
      } else if (left === 0) {
        end = ["killed", "You went down at " + place() + " and there was nobody left standing to pick you up."];
      } else {
        W.toast(left + " MEN CARRIED YOU OFF", "bad");
        W.log("you went down. " + left + " men carried you out of it.", "bad");
      }
    }

    reconcile();
    paintChips();
    setTimeout(function () {
      safe(function () {
        if (end) { endRun(end[0], end[1]); return; }
        checkBoard();
      });
    }, 0);
  }

  /* ============================================================ THE DRIVER
     WHEN DOES A ROAD EVENT FIRE. campaign.js is the file that knows the player
     has been riding, so W.events.maybeFire() is published for it to call — but
     this file will not sit inert waiting for a sibling to be wired. The ticker
     below measures the distance ridden off S.you itself and calls the same
     function, so events work with campaign.js untouched and campaign.js can
     take the wheel later by calling maybeFire and setting E.driven = true.

     The cadence is in METRES, not seconds, for campaign.js's own reason: the
     clock in this game is driven by travel (HOUR_PER_M = 1/820), so an event
     every ~1100-2600 m is an event every hour and a half of riding no matter
     how fast the frame rate is. A wall-clock timer would fire four times as
     often on a desktop as on a phone. */
  let lastX = 0, lastZ = 0, since = 0, next = 1400, slow = 0, hadPos = false;
  E.driven = false;

  let lastWall = 0;
  function tick(dt) {
    if (!ctx) return;
    /* THE ENGINE'S dt IS NOT WALL TIME HERE. Under SwiftShader this page runs
       at one or two frames a second, and every ramp in this file is written in
       seconds — so the real elapsed wall clock drives them, and the engine's
       dt only drives the things that are genuinely per-frame.
       …and "wall" means W.clock.now(), the game clock in core.js: identical to
       performance.now() at 1x, warped by the speed setting above it. Weather
       GATES TRAVEL (E.travelBlocked), so a sandstorm that did not accelerate
       with the rest of the island would be an eight-minute wall at 8x. */
    const now = (W.clock && W.clock.now) ? W.clock.now()
      : (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    const rawDt = lastWall ? Math.min(1, (now - lastWall) / 1000) : 0.016;
    lastWall = now;
    dt = Math.min(0.1, dt || rawDt || 0.016);
    driveWeather(dt, rawDt);

    if (W.phase() !== "campaign") { hadPos = false; return; }
    /* ON rawDt, NOT dt, AND THIS ONE COST A PROBE TO FIND. The engine's dt
       here is a FRAME, and under a software rasteriser this page runs at one
       or two frames a second — with `dt` clamped to 0.1 the mutineers walked
       0.4 m in four and a half seconds and the card behind them never came up.
       Every ramp in this section is written in SECONDS OF A MOMENT, which is
       the same thing driveWeather above needs and gets the same answer:
       W.clock.now(), i.e. game time, warped by the speed slider so a beat
       accelerates with the island instead of becoming an eight-minute wall.
       Campaign frames only — a walk-out does not continue inside a battle. */
    stepHeld();
    stepBeats(rawDt);
    stepProps(rawDt);
    stepMarch(rawDt);
    stepTrails(rawDt);
    stepCast(rawDt);
    stepLeaving(rawDt);
    slow -= dt;
    if (slow <= 0) { slow = 0.25; hideMe(0.25); paintChipsThrottled(); }
    /* A RAIL CLOSED BY SOMEBODY ELSE. warlord.html tears the verb rail down on
       a phase change and army.js can replace it; if that happens with one of
       our cards on it, CARD would otherwise stay set forever and the road
       would go quiet for the rest of the run. Half a second of grace covers
       the frame the rail is still being built on. */
    if (CARD && CARD.rail) {
      railT += rawDt;
      if (railT > 0.5 && !(ctx.verbsOpen && ctx.verbsOpen())) closeCard();
    }

    const x = S.you.x, z = S.you.z;
    if (!hadPos) { lastX = x; lastZ = z; hadPos = true; return; }
    const d = Math.hypot(x - lastX, z - lastZ);
    lastX = x; lastZ = z;
    if (d > 400) return;              // a teleport (battle exit, load) is not travel
    since += d;
    if (E.driven || FLAG_NOEVENTS || CARD || CAST) return;
    if (since < next) return;
    since = 0;
    next = W.range(1100, 2600);
    if (!E.maybeFire()) next *= 0.55;  // nothing was eligible — try again sooner
  }

  /* anything a battle promised gets paid the moment you are back on the island
     with a free screen. Falls back to paying it silently if a card cannot open
     (an outpost is up, the phase moved on) — a promise this file made and then
     quietly dropped would be worse than a missing card. */
  function pending() {
    const v = ev();
    if (!v.payout) return;
    const c = v.payout;
    if (canOpen()) { v.payout = null; fire("paid", c); return; }
    if (W.phase() !== "campaign") return;
    v.payout = null;
    for (let k = 0; k < (c.men || 0); k++) join("levy", gunFor(0.2), 0.78);
    reconcile();
    W.log("collected " + c.men + " volunteers from " + (c.from || "the village") + ".", "good");
  }

  let chipT = 0;
  function paintChipsThrottled() {
    chipT++;
    if (chipT % 4 === 0) paintChips();
  }

  E.travel = function (metres) {
    // campaign.js may drive the cadence itself; calling this marks it as the
    // driver so the internal ticker stops double-counting.
    E.driven = true;
    since += Math.max(0, metres || 0);
    if (since >= next && !CARD && !CAST) { since = 0; next = W.range(1100, 2600); E.maybeFire(); }
  };
  E.travelBlocked = function () {
    const v = ev();
    return !FLAG_NOWEATHER && v.wea === "storm" && v.weaP > 0.75 && v.camped !== S.day;
  };

  /* ============================================================ API */
  E.loyalty = loyalty;
  E.mood = function () { return mood().label; };
  E.bondOf = bondOf;
  E.weather = function () {
    const v = ev();
    return { kind: v.wea, p: v.weaP, night: isNight(), vis: visibility(),
             wind: { x: v.wx, z: v.wz }, label: WEATHER[v.wea].label };
  };
  E.visibility = visibility;
  E.list = function () { return LIB.map(function (L) { return L.id; }); };
  /* WHAT IS ACTUALLY ON THE SAND RIGHT NOW. Every number here is read off the
     world rather than off this file's intentions: the mutineers' distance is
     measured between two positions, the joiners are counted out of S.bands,
     and the roads are sand.js's own tile count. `mutinyDist` is the headline —
     it was structurally ZERO before this pass, because the band was built at
     the player's own coordinates and never put on the map at all. */
  E.shown = function () {
    let mut = null, joining = 0, joiners = 0;
    for (let i = 0; i < S.bands.length; i++) {
      const b = S.bands[i];
      if (b.mutiny) mut = b;
      if (b.joining) { joining++; joiners += b.men.length; }
    }
    let churnTiles = 0, dust = 0;
    if (W.sand && W.sand.audit) safe(function () { const a = W.sand.audit(); churnTiles = a.churn || 0; dust = a.dust || 0; });
    return {
      mutinyOnMap: mut ? 1 : 0,
      mutinyDist: mut ? Math.round(Math.hypot(mut.x - S.you.x, mut.z - S.you.z) * 10) / 10 : 0,
      mutinyMen: mut ? mut.men.length : 0,
      fires: lit.length, marching: marches.length, trails: trails.length,
      joiningParties: joining, joiningMen: joiners,
      spawnDist: lastSpawn ? Math.round(lastSpawn.d) : 0,
      spawnHidden: lastSpawn && lastSpawn.blocked ? 1 : 0,
      churnTiles: churnTiles, dust: dust,
      beats: beats.length, army: S.army.length,
    };
  };
  E.audit = function () {
    const v = ev();
    return {
      loyalty: loyalty(), mood: mood().label, ceiling: Math.round(avgBond() * 100),
      unrest: v.unrest, weather: v.wea, vis: Math.round(visibility()),
      night: isNight(), events: LIB.length, fired: v.seen,
      /* THE STANDING, top five, as strings — what a probe and a ba preset
         read. `four` is gone with the mechanic it named. */
      land: land(),
      board: board().slice(0, 5).map(function (r) {
        return r.rank + ". " + r.name + " " + r.held + "p/" + r.men + "m" + (r.out ? " (out)" : "");
      }),
      rivalsLeft: rivals().length, fell: ev().fell.length,
      fallen: v.fallen.length, over: v.over ? v.over.kind : null, peak: v.peak,
    };
  };

  /* ============================================================ BOOT */
  E.needs = [];
  E.boot = function (c) {
    if (E._booted) return;      // see LATE INJECTION at the bottom
    E._booted = true;
    ctx = c;
    css();

    /* the strip. Wrapping ctx.paintHud rather than only listening to events,
       because campaign.js and outpost.js both call ctx.paintHud() directly and
       a chip that only repaints on the bus disappears the moment they do. */
    const orig = c.paintHud;
    if (typeof orig === "function") {
      c.paintHud = function () { orig(); safe(paintChips); };
    }
    W.on("phase", function (t) {
      /* warlord.html closes the stage itself on the way into campaign and
         battle. It knows nothing about our modal class, so it would leave it
         on the body and quietly lift the NEXT module's screen over the strip. */
      if (t && (t.to === "campaign" || t.to === "battle")) {
        try { document.body.classList.remove("wl-card-up"); } catch (e) {}
      }
      if (t && t.from === "campaign" && t.to !== "campaign") safe(strikeSet);
      safe(paintChips);
    });
    W.on("army", function () { reconcile(); safe(paintChips); });
    W.on("gold", function () { safe(paintChips); });

    W.on("dawn", function () { safe(onDawn); });
    W.on("phase:aftermath", function (r) { safe(function () { onAftermath(r); }); });
    /* THE DUEL'S OUTCOME. battle.js says how the solo fight ended; the line
       that was watching pays up or rides off the moment the island is back. */
    W.on("battle:end", function (r) {
      const d = ev().duel;
      if (!d || !r || !r.band || r.band.id !== d.champ) return;
      d.outcome = r.outcome;
    });
    W.on("phase:campaign", function () { setTimeout(function () { safe(resolveDuel); }, 700); });
    W.on("newgame", function () {
      if (S.flags) delete S.flags.ev;
      ev();
      hadPos = false; since = 0; next = 1400;
      fogSaved = null;
      /* a new island keeps none of the old one's staging — and the pending
         batch is DROPPED rather than added, because those men belonged to a
         run that no longer exists. */
      if (batchT) { clearTimeout(batchT); batchT = 0; }
      batch.length = 0; beats.length = 0; marches.length = 0; trails.length = 0; held.length = 0;
      CAST = null; leaving.length = 0;
      safe(darkenStage);
    });
    /* A SAVE CAN LAND MID-WALK. S.bands is serialised, so a joining party is
       still there when the game comes back and its men are still not on the
       roster. They fall in on load. */
    W.on("loaded", function () { safe(sweepJoiners); });
    W.on("campaign:ready", function () { safe(rollWeather); safe(paintChips); });
    W.on("phase:campaign", function () { setTimeout(function () { safe(pending); }, 600); });
    /* THE WIN IS CHECKED WHEREVER A PROVINCE CHANGES HANDS, not only at dawn.
       Taking your thirty-second province in a battle at noon has to end the
       run at noon; waiting for the next dawn is a game that says nothing
       happened for six hours after you won it. */
    W.on("territory:claim", function (c) {
      if (!c || (c.to !== "you" && c.from !== "you")) return;
      setTimeout(function () { safe(checkVictory); safe(paintChips); }, 0);
    });

    if (CBZ.onAlways) CBZ.onAlways(96, function (dt) { safe(function () { tick(dt); }); });
    /* order 20, i.e. AFTER campaign.js's day tint at -20. See tintStorm. */
    if (CBZ.micro && CBZ.micro.onFrame) {
      CBZ.micro.onFrame(function () { safe(tintStorm); }, { order: 20, id: "warlord-sandfog" });
    }

    /* THE DEBUG DOOR. ?event=<id> fires any card the moment the island is up,
       which is what the screenshot tool drives and what makes writing a new
       card a five-second loop instead of a fifty-ride one.

       IT STAGES A COLUMN FIRST, and that is not decoration. Half this library
       reads the roster to write its own prose — the schism asks for a third of
       your men, the ringleader names the man they are listening to, the duel
       prices itself off your kit — so firing one on a day-one page where the
       army is EMPTY produces a card offering to take zero men, which is both a
       useless screenshot and a lie about what the card does. ?stage=0 turns it
       off for anyone who wants the raw day-one state. */
    const want = FLAG_NOEVENTS ? null : (c.Q && c.Q.get("event"));
    if (want) {
      if (want === "list") { try { console.log("[warlord/events]", E.list().join(", ")); } catch (e) {} }
      const stageN = c.Q.get("stage") == null ? 34 : (parseInt(c.Q.get("stage"), 10) || 0);
      const stage = function () {
        if (!stageN || S.army.length >= stageN) return;
        /* THIRTY-FOUR MEN DO NOT WALK IN. This is the screenshot door filling
           a roster so the state-reading cards have something to read; staging
           it as an arrival would put a 34-man party in front of the camera on
           every preset frame. `staging` makes join() take the plain path. */
        staging = true;
        for (let i = S.army.length; i < stageN; i++) {
          // half hired, half pressed — an army with a real mix of provenance,
          // which is the only kind the loyalty screen has anything to say about
          const pressed = i % 2 === 0;
          const tid = i % 7 === 0 ? "veteran" : i % 3 === 0 ? "soldier" : i % 2 ? "raider" : "levy";
          const s = join(tid, gunFor(0.45), pressed ? BASE_PRESSED : BASE_HIRED,
                         { battles: i % 5 });
          if (i % 9 === 0) s.wounded = true;
        }
        S.gold = 1240; S.fame = 58;
        S.prisoners = [W.makeSoldier("levy", gunFor(0.2)), W.makeSoldier("raider", gunFor(0.3)),
                       W.makeSoldier("levy", gunFor(0.2)), W.makeSoldier("soldier", gunFor(0.4)),
                       W.makeSoldier("levy", gunFor(0.2))];
        S.stats.battles = 6; S.stats.won = 4; S.stats.killed = 91; S.stats.lost = 12;
        S.stats.recruited = 17; S.stats.conscripted = 17; S.stats.executed = 3;
        ev().loy = want === "mutiny" || want === "ringleader" ? 11 : 48;
        for (let i = 0; i < 9; i++) bury(W.makeSoldier(i % 3 ? "levy" : "raider", "sidearm"), "battle");
        W.log("rode out of the last outpost with " + W.armySize() + " men.", "");
        W.log("broke a company on the salt pan. 31 dead, 9 taken.", "good");
        W.log("could not pay. 4 men walked away in the night.", "bad");
        reconcile();
        staging = false;
        if (ctx.paintHud) ctx.paintHud();
      };
      /* ONCE. Both hooks below can land — campaign:ready AND the first
         phase:campaign — and the second one re-fired the same card 300 ms
         after the first, which REPLACED the card the player (or a screenshot
         tool) had just answered. Measured: a click that took twelve deserters
         was followed by the deserters card standing back up with the men
         already taken. E.fire's own `if (CARD) closeCard()` made it silent. */
      let opened = false;
      const open = function () {
        if (opened) return;
        opened = true;
        setTimeout(function () {
          safe(stage);
          if (want === "chronicle") return openChronicle(null);
          if (want === "loyalty") return openLoyalty();
          if (want === "war") return openWar();
          if (want === "over") { endRun("killed", "You went down at the salt pan and there was nobody left standing to pick you up."); return; }
          if (want === "win") { endRun("won", "There is nobody left on this island who can tell you no."); return; }
          if (want === "mutiny") { ev().loy = 8; return mutiny(); }
          if (want === "storm") { ev().wea = "storm"; ev().weaP = 1; paintChips(); return fire("storm"); }
          if (want === "list") return;
          E.fire(want);
        }, 600);
      };
      W.on("campaign:ready", open);
      // and if the campaign never signals, still open on the first phase change
      let once = false;
      W.on("phase:campaign", function () { if (once) return; once = true; setTimeout(open, 900); });
    }

    if (c.Q && c.Q.get("audit") === "1") {
      W.on("campaign:ready", function () { try { console.log("[warlord/events]", E.audit()); } catch (e) {} });
    }
  };

  W.module("events", E);

  /* LATE INJECTION. bootModules() runs once, at page start; a file appended
     after that would register and never boot. Every module in this game has
     that hole and this one closes it for itself, because being able to paste
     this file into a live page is how it was developed. */
  if (CBZ.warlordCtx && !E._booted) {
    setTimeout(function () { safe(function () { E.boot(CBZ.warlordCtx); }); }, 0);
  }
})();
