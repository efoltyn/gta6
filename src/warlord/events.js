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
                      in it meant anything. Four named warlords hold this
                      island. Break all four and you are the Desert Warlord.
                      Die, or get killed by your own men, or go broke alone in
                      the salt, and the run is over and you read what it was.
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
     events:warlord   {band, fallen}  one of the four fell
     events:over      {kind, why}

   WHAT THIS FILE NEEDS FROM campaign.js — all of it optional, all of it
   already has a fallback (see THE DRIVER at the bottom):
     · W.events.maybeFire()  called when the player has ridden a while.
       If campaign never calls it, an onAlways ticker in this file measures
       the distance itself and calls it. Wiring it is nicer, not required.
     · W.events.travelBlocked()  true while a sandstorm says stop. Campaign
       may read it to refuse a new destination; if it never does, the storm
       card's MAKE CAMP choice is still the whole decision.

   FLAGS (repo doctrine: every behaviour switch reverts in one param)
     ?events=off     no road events at all. The pre-wave loop, byte for byte.
     ?loyalty=off    loyalty never moves and nobody ever mutinies
     ?weather=off    no sandstorms, no heat, no night cover
     ?endgame=off    the run can never end — no four warlords, no death
     ?event=<id>     DEBUG: fire that card on demand. `?event=list` prints the
                     library to the console. Never be blocked on a random roll.
     ?four=N         how many warlords hold the island (default 4)
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
     four warlords, no way to win or lose. That is the pre-wave game byte for
     byte, and it is what tools/visual-presets/warlord-events.mjs photographs
     as its BEFORE side. The three narrower flags exist to isolate ONE system
     while the rest keeps running, which is a different job. */
  const FLAG_NOEVENTS = QP.get("events") === "off";
  const FLAG_NOLOYALTY = FLAG_NOEVENTS || QP.get("loyalty") === "off";
  const FLAG_NOWEATHER = FLAG_NOEVENTS || QP.get("weather") === "off";
  const FLAG_NOEND = FLAG_NOEVENTS || QP.get("endgame") === "off";
  const FOUR_N = Math.max(1, Math.min(8, parseInt(QP.get("four") || "", 10) || 4));

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
     the loyalty number, the memorial, the four warlords and the weather all
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
        four: null,         // [bandId] — the warlords who hold the island
        fell: [],           // {name,day,size} — the ones you broke
        last: null,         // the last warlord, once three are down
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
  function loyMove(delta, why) {
    if (FLAG_NOLOYALTY) return;
    const v = ev();
    const was = v.loy;
    v.loy = clamp(v.loy + delta, 0, 100);
    if (Math.abs(v.loy - was) >= 0.5) {
      W.emit("events:loyalty", { loy: v.loy, delta: v.loy - was, why: why || "" });
      paintChips();
    }
  }

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
  function hideMe(dt) {
    if (FLAG_NOWEATHER) return;
    const v = ev();
    const cover = (v.wea === "storm" ? v.weaP : 0) + (isNight() ? 0.55 : 0) + (v.wea === "haze" ? v.weaP * 0.3 : 0);
    if (cover < 0.35) return;
    const r = 340 * clamp(cover, 0, 1.4);
    for (let i = 0; i < S.bands.length; i++) {
      const b = S.bands[i];
      const d = Math.hypot(b.x - S.you.x, b.z - S.you.z);
      if (d > r) continue;
      if (b.cooldown < 2) b.cooldown = 2;
      if (b.mood === "hunt" && cover > 0.7) b.mood = "roam";
    }
  }

  /* ============================================================ THE CARD
     ULTRA-SIMPLE CONTROLS IS THE WHOLE GAME'S HARD REQUIREMENT, so an event is
     a headline, four lines of prose and two or three big buttons. Never a
     form, never a slider, never a number you type. The button carries its own
     price on a second line, because "what does this cost me" is the only
     question the player is actually asking. */
  let CARD = null;

  function css() {
    if (document.getElementById("wlEvCss")) return;
    const s = document.createElement("style");
    s.id = "wlEvCss";
    s.textContent = [
      ".wl-ev{max-width:640px;margin:0 auto}",
      ".wl-ev .tag{font-size:10px;letter-spacing:.28em;opacity:.45;margin-bottom:6px}",
      ".wl-ev .body{opacity:.9;line-height:1.5;font-weight:500;margin:6px 0 2px}",
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
    return true;
  }

  /* the ride stops when a card goes up. campaign.js owns the destination, so
     it is asked to stand still rather than reached into — one call, and the
     game does not argue with a player who is reading. */
  function halt() {
    if (W.campaign && W.campaign.dest) safe(function () { W.campaign.dest(S.you.x, S.you.z); });
  }

  function showCard(card) {
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
    CARD = null;
    giveBackScreen();
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

  /* a man built by this file stamps his own provenance before he joins, so
     reconcile() never has to guess about him. */
  function join(tierId, wid, base, opts) {
    const s = W.makeSoldier(tierId, wid, opts);
    ev().base[s.id] = base;
    W.addSoldier(s);
    return s;
  }

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

  function spawnBandNear(opts) {
    opts = opts || {};
    const D = W.desert;
    let p = { x: S.you.x + W.range(-900, 900), z: S.you.z + W.range(-900, 900) };
    if (D && D.landPoint) {
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
    build: function () {
      const n = W.irange(3, Math.max(4, Math.min(22, Math.round(size() * 0.35) + 3)));
      const wage = n * W.tier("levy").wage;
      const guns = [];
      for (let i = 0; i < n; i++) guns.push(gunFor(0.2));
      return {
        title: 'MEN WITH NO <em>FLAG</em>',
        sub: place().toUpperCase(),
        body: n + ' men are sitting in the shade of a wrecked truck with their boots off. ' +
              'They deserted from something — they will not say what — and they will march for you ' +
              'for nothing but food and a share. They are levies. They deserted once.',
        choices: [
          { key: "take", label: "TAKE THEM ALL", cls: "hot",
            hint: "+" + men(n) + " · +$" + wage + "/day in wages · they will not be loyal",
            run: function () {
              for (let i = 0; i < n; i++) join("levy", guns[i], 0.22);
              W.log("took in " + n + " deserters at " + place() + ".", "");
              W.toast("+" + men(n), "good");
              loyMove(-4, "the army does not trust deserters");
              reconcile();
            } },
          { key: "pick", label: "TAKE THE BEST THREE", show: n >= 6,
            hint: "+3 men · they cost the same as any levy · the rest remember you",
            run: function () {
              for (let i = 0; i < 3; i++) join("levy", guns[i], 0.45);
              W.log("took three of the deserters and left the rest.", "");
              loyMove(1, "you were choosy");
              reconcile();
            } },
          { key: "no", label: "RIDE ON", cls: "ghost", hint: "nothing changes",
            run: function () { W.log("rode past the deserters.", ""); } },
        ],
      };
    },
  });

  /* ---- 2. the caravan. Gold for days, and days are the real currency. */
  add({
    id: "caravan", tag: "A CONTRACT",
    weight: function () { return size() >= 5 ? 1.0 : 0; },
    build: function () {
      // the fee is priced off what it actually costs you: two days of wages
      // plus a margin that scales with how big an escort they are buying
      const days = W.irange(2, 3);
      const fee = Math.round(W.payroll() * days * 1.9 + size() * 6 + 60);
      return {
        title: 'A <em>CARAVAN</em> AT THE EDGE OF THE PAN',
        sub: "SALT CROSSING",
        body: 'Nine trucks and a man in a good coat. He wants your guns walking beside him across ' +
              'the pan — ' + days + ' days out of your way, and he pays on arrival. ' +
              'Wages do not stop because you are being useful.',
        choices: [
          { key: "escort", label: "TAKE THE CONTRACT", cls: "hot",
            hint: "+$" + fee + " on arrival · " + days + " days pass · -$" + (W.payroll() * days) + " in wages first",
            run: function () {
              for (let i = 0; i < days; i++) W.dawn();
              if (S.army.length || S.gold >= 0) { W.earn(fee); W.log("escorted a caravan across the pan. +$" + fee + ".", "good"); }
              S.fame += 2;
              loyMove(2, "paid work is still work");
            } },
          { key: "rob", label: "TAKE THE TRUCKS INSTEAD", cls: "bad",
            hint: "+$" + Math.round(fee * 1.7) + " now · fame down · the island hears about it",
            run: function () {
              W.earn(Math.round(fee * 1.7));
              S.fame = Math.max(0, S.fame - 6);
              S.stats.executed += 1;   // core's dread counter: this is that kind of act
              W.log("took a caravan on the salt pan. They will remember the colour of the banner.", "bad");
              loyMove(-6, "banditry");
            } },
          { key: "no", label: "WE ARE NOT GUARDS", cls: "ghost", hint: "nothing changes",
            run: function () {} },
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
        body: 'Mud walls, forty families, one well. A bandit crew has been taking a third of ' +
              'everything since the spring. The headman will give you ' + pay + ' of his young men — ' +
              'real volunteers, not pressed — if the crew stops coming. There are about ' + raiders + ' of them.',
        choices: [
          { key: "take", label: "TAKE THE JOB", cls: "hot",
            hint: "hunt " + raiders + " bandits · +" + men(pay) + " when it is done",
            run: function () {
              const b = spawnBandNear({ size: raiders, faction: "bandit", name: "ADH-DHIB RAIDERS", hunt: false, r: 1400 });
              ev().contracts.push({ bandId: b.id, kind: "village", men: pay, from: "ADH-DHIB", day: S.day });
              W.log("promised Adh-Dhib its well back. " + raiders + " raiders, somewhere west.", "");
              W.toast("CONTRACT: ADH-DHIB RAIDERS", "");
            } },
          { key: "tax", label: "TAX THEM INSTEAD", cls: "bad",
            hint: "+$" + (pay * 22) + " now · the village hates you · fame down",
            run: function () {
              W.earn(pay * 22);
              S.fame = Math.max(0, S.fame - 4);
              W.log("taxed Adh-Dhib. The bandits will be back on Tuesday.", "bad");
              loyMove(-3, "your men have villages too");
            } },
          { key: "no", label: "RIDE ON", cls: "ghost", hint: "nothing changes", run: function () {} },
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
        body: 'A tarp under two inches of sand, weighted with rocks that were carried here. ' +
              n + ' guns: ' + esc(list) + '. The tyre tracks beside it are three days old ' +
              'and they are pointed at us. Whoever buried this is coming back for it, and there are ' +
              'about ' + owners + ' of them.',
        choices: [
          { key: "take", label: "TAKE IT AND GO", cls: "hot",
            hint: "+" + n + " guns (worth ~$" + worth + ") · they will come looking",
            run: function () {
              for (let i = 0; i < guns.length; i++) W.stash(guns[i], 1);
              spawnBandNear({ size: owners, faction: "company", name: "THE OWNERS", hunt: true, r: 1100, cooldown: 30 });
              W.log("dug up a cache of " + n + " guns. Someone is coming for them.", "");
              W.toast("+" + n + " GUNS", "good");
            } },
          { key: "wait", label: "SIT ON IT AND WAIT FOR THEM", show: size() >= 8,
            hint: "they walk into you instead of the other way round",
            run: function () {
              for (let i = 0; i < guns.length; i++) W.stash(guns[i], 1);
              const b = spawnBandNear({ size: Math.round(owners * 0.8), faction: "company", name: "THE OWNERS", r: 90, cooldown: 0 });
              b.mood = "hunt"; b.goal = { x: S.you.x, z: S.you.z };
              W.log("took the cache and set up over it.", "");
              loyMove(2, "a warlord who picks the ground");
            } },
          { key: "no", label: "LEAVE IT BURIED", cls: "ghost", hint: "nothing changes",
            run: function () { W.log("covered the cache back up and rode on.", ""); } },
        ],
      };
    },
  });

  /* ---- 5. the wounded rival. The brief's own example, and the best card in
       the library because BOTH answers are wrong in a different way. */
  add({
    id: "rival", tag: "A MAN ON THE GROUND",
    weight: function () { return size() >= 25 && S.fame >= 12 ? 1.25 : 0; },
    build: function () {
      const n = Math.max(8, Math.round(size() * W.range(0.35, 0.75)));
      const tiers = ["raider", "soldier", "soldier", "veteran"];
      const wealth = clamp(0.4 + n / 160, 0.35, 0.95);
      return {
        title: 'A <em>WARLORD</em> WITH A HOLE IN HIM',
        sub: "WHAT IS LEFT OF HIS COLUMN",
        body: 'He is sitting against a wheel with his hand pressed into his side and ' + n +
              ' men standing around him who have not decided anything yet. He says: let me ride ' +
              'out of here alive and they are yours. He is not lying, and he is not going to forget.',
        choices: [
          { key: "let", label: "LET HIM GO. TAKE HIS MEN.", cls: "hot",
            hint: "+" + men(n) + " · they served him first · he will be back",
            run: function () {
              for (let i = 0; i < n; i++) {
                join(tiers[Math.floor(W.rnd() * tiers.length)], gunFor(wealth), 0.34);
              }
              S.fame += Math.round(n * 0.3);
              W.log("let a rival warlord ride out. His " + n + " men came with us.", "good");
              W.toast("+" + men(n), "good");
              loyMove(-5, "his men are not your men yet");
              reconcile();
              // he rebuilds. That is the price, and it is a real band on the map.
              ev().contracts.push({ kind: "revenge", day: S.day + W.irange(6, 14), size: Math.round(n * 1.4) });
            } },
          { key: "kill", label: "PUT HIM DOWN", cls: "bad",
            hint: "+fame · his men scatter · every band you meet fights harder",
            run: function () {
              S.fame += 9;
              S.stats.executed += 2;
              W.log("killed a wounded warlord in front of his own column.", "bad");
              loyMove(-8, "they watched you do it");
              W.toast("THE ISLAND HEARD THAT", "bad");
            } },
          { key: "ride", label: "RIDE ON AND LEAVE HIM TO IT", cls: "ghost",
            hint: "nothing changes, and he lives anyway",
            run: function () { W.log("left a wounded warlord where he sat.", ""); } },
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
        body: esc(name) + ' has been sitting with the same twenty men every night for a week. ' +
              'This morning he says it plainly: give him ' + n + ' men and he will go south and ' +
              'not trouble you. They are already packed.',
        choices: [
          { key: "let", label: "LET THEM WALK", cls: "",
            hint: "-" + men(n) + " · the rest stop worrying · they keep their guns",
            run: function () {
              for (let i = 0; i < cut.length; i++) W.removeSoldier(cut[i].id, false);
              W.log(esc(name) + " took " + n + " men south. Nobody stopped him.", "bad");
              loyMove(+10, "you let them go, and the rest saw it");
              ev().unrest = 0;
              reconcile();
            } },
          { key: "pay", label: "BUY HIM BACK", cls: "hot", enabled: S.gold >= bribe,
            hint: S.gold >= bribe ? "-$" + bribe + " · everybody stays · loyalty up"
                                  : "you do not have $" + bribe,
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
            hint: "he stays dead · they stay · loyalty falls hard",
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
              'A nomad with eleven camels is standing next to it with full skins and a price. ' +
              (hurt ? 'You are carrying ' + hurt + ' wounded. They go first.' : 'Nobody is hurt yet.'),
        choices: [
          { key: "buy", label: "PAY THE NOMAD", cls: "hot", enabled: S.gold >= price,
            hint: S.gold >= price ? "-$" + price + " · everybody drinks" : "you do not have $" + price,
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
            hint: "free · fame down · your men know what they just did",
            run: function () {
              S.fame = Math.max(0, S.fame - 3);
              W.log("took a nomad's water at gunpoint.", "bad");
              loyMove(-7, "you robbed a man with camels");
            } },
          { key: "push", label: "PUSH ON DRY", cls: "",
            hint: "free · about " + men(risk) + " will not make the next well",
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
        body: 'It is not weather, it is a landscape moving. Half an hour out, maybe less. ' +
              'You can put the men down behind the trucks and let it pass, which costs you the day, ' +
              'or you can ride into it and keep the day, and pay for it in other ways.',
        choices: [
          { key: "camp", label: "MAKE CAMP AND LET IT PASS", cls: "hot",
            hint: "one day gone · -$" + W.payroll() + " in wages · nobody is lost",
            run: function () {
              ev().camped = S.day;
              W.dawn();
              W.log("sat out a sandstorm behind the trucks.", "");
              loyMove(+3, "you did not march them into it");
            } },
          { key: "push", label: "RIDE INTO IT", cls: "bad",
            hint: "keep the day · lose about " + men(loss) + " and " + guns(gunsLost) + " · nobody can see you either",
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
    build: function () {
      const n = W.irange(6, Math.max(8, Math.min(30, Math.round(size() * 0.5))));
      const guards = Math.max(3, Math.round(n * 0.3));
      const price = n * 26;
      return {
        title: 'A COLUMN ON A <em>CHAIN</em>',
        sub: "SLAVERS, HEADING EAST",
        body: n + ' men walking in a line with their wrists wired together and ' + guards +
              ' men with rifles walking beside them. The chief wants to sell. He is aware ' +
              'that you outnumber him and he is being very polite about it.',
        choices: [
          { key: "free", label: "CUT THEM LOOSE", cls: "hot",
            hint: "fight " + guards + " guards · +" + men(n) + " who chose you · fame up",
            run: function () {
              for (let i = 0; i < n; i++) join(W.chance(0.75) ? "levy" : "raider", gunFor(0.18), 0.68);
              S.fame += Math.round(n * 0.5);
              W.log("cut a slave column loose. " + n + " men picked up rifles and stayed.", "good");
              W.toast("+" + men(n), "good");
              loyMove(+8, "the army liked that");
              spawnBandNear({ size: guards, faction: "bandit", name: "THE SLAVERS", hunt: true, r: 320, cooldown: 2 });
              reconcile();
            } },
          { key: "buy", label: "BUY THEM", cls: "", enabled: S.gold >= price,
            hint: S.gold >= price ? "-$" + price + " · +" + men(n) + " · they know what you are"
                                  : "you do not have $" + price,
            run: function () {
              if (!W.pay(price)) return;
              for (let i = 0; i < n; i++) join("levy", gunFor(0.15), 0.4);
              W.log("bought " + n + " men off a slaver for $" + price + ".", "");
              loyMove(-2, "you paid a slaver");
              reconcile();
            } },
          { key: "no", label: "RIDE ON", cls: "ghost", hint: "nothing changes",
            run: function () { loyMove(-3, "you rode past the chain"); } },
        ],
      };
    },
  });

  /* ---- 10. the gun runner. A real gun at a real price, out of the armoury. */
  add({
    id: "runner", tag: "A TRADER",
    weight: function () { return 1.0; },
    build: function () {
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
              ', still in grease. He wants $' + ask + ' for the lot, which is under list, ' +
              'because he would like to be somewhere else by dark.',
        choices: [
          { key: "buy", label: "BUY THE CRATE", cls: "hot", enabled: S.gold >= ask,
            hint: S.gold >= ask ? "-$" + ask + " · +" + n + "× " + W.gunLabel(id) + " (list $" + list + ")"
                                : "you do not have $" + ask,
            run: function () {
              if (!W.pay(ask)) return;
              W.stash(id, n);
              W.log("bought " + n + "× " + W.gunLabel(id) + " off a runner for $" + ask + ".", "good");
              W.toast("+" + n + "× " + W.gunLabel(id), "good");
            } },
          { key: "rob", label: "TAKE THE CRATE", cls: "bad", show: size() >= 5,
            hint: "free · +$" + Math.round(list * 0.2) + " out of his pockets · fame down",
            run: function () {
              W.stash(id, n);
              W.earn(Math.round(list * 0.2));
              S.fame = Math.max(0, S.fame - 5);
              W.log("robbed a gun runner on the " + biome() + ".", "bad");
              loyMove(-4, "you robbed a trader");
            } },
          { key: "no", label: "RIDE ON", cls: "ghost", hint: "nothing changes", run: function () {} },
        ],
      };
    },
  });

  /* ---- 11. the old soldier. */
  add({
    id: "oldman", tag: "A FIRE OFF THE ROAD",
    weight: function () { return size() >= 4 ? 0.8 : 0.4; },
    build: function () {
      const price = W.tier("veteran").hire * 2;
      const wid = gunFor(0.8);
      return {
        title: 'AN OLD <em>SOLDIER</em>',
        sub: "ALONE, WITH A GOOD RIFLE",
        body: 'He has a fire, a ' + esc(W.gunLabel(wid)) + ' cleaned to a shine, and thirty years ' +
              'of somebody else\'s wars behind him. He will come. He wants $' + price +
              ' up front, or a straight share and no money at all — and he says the second one ' +
              'is the better deal for you and he is right.',
        choices: [
          { key: "pay", label: "PAY HIM", cls: "hot", enabled: S.gold >= price,
            hint: S.gold >= price ? "-$" + price + " · +1 VETERAN with a " + W.gunLabel(wid)
                                  : "you do not have $" + price,
            run: function () {
              if (!W.pay(price)) return;
              const s = join("veteran", wid, BASE_HIRED, { battles: 8 });
              W.log("hired " + s.name + ", veteran, for $" + price + ".", "good");
              W.toast("+1 VETERAN", "good");
              reconcile();
            } },
          { key: "share", label: "OFFER HIM A SHARE", cls: "",
            hint: "free · +1 VETERAN · he is the most loyal man you have",
            run: function () {
              const s = join("veteran", wid, 0.95, { battles: 8 });
              W.log(s.name + " came for a share and nothing else.", "good");
              loyMove(+4, "a veteran chose you in front of everyone");
              reconcile();
            } },
          { key: "no", label: "LEAVE HIM HIS FIRE", cls: "ghost", hint: "nothing changes", run: function () {} },
        ],
      };
    },
  });

  /* ---- 12. somebody wants to buy your prisoners. */
  add({
    id: "buyer", tag: "A BUYER",
    weight: function () { return S.prisoners.length >= 4 ? 1.5 : 0; },
    build: function () {
      const n = S.prisoners.length;
      // he pays roughly what a camp charges to hire a man of that tier, halved
      let worth = 0;
      for (let i = 0; i < S.prisoners.length; i++) worth += W.tier(S.prisoners[i].tier).hire * 0.45;
      worth = Math.round(worth / 5) * 5;
      return {
        title: 'HE WANTS YOUR <em>PRISONERS</em>',
        sub: n + " MEN IN THE WIRE",
        body: 'A quiet man with four trucks and a ledger. He will take all ' + n +
              ' off your hands at $' + worth + ' and he does not want to discuss what for. ' +
              'They are eating your food and they are not fighting for you.',
        choices: [
          { key: "sell", label: "SELL THEM ALL", cls: "bad",
            hint: "+$" + worth + " · the wire is empty · your men watch them go",
            run: function () {
              W.earn(worth);
              S.stats.executed += Math.ceil(n / 3);   // core's dread counter: this is that kind of act
              S.prisoners.length = 0;
              W.log("sold " + n + " prisoners for $" + worth + ".", "bad");
              loyMove(-9, "you sold men");
              W.emit("army", S.army.length);
            } },
          { key: "free", label: "TURN THEM ALL LOOSE INSTEAD", cls: "hot",
            hint: "+fame · the island learns you let men walk · bands surrender more readily",
            run: function () {
              S.fame += Math.round(2 + n * 0.6);
              S.prisoners.length = 0;
              W.log("turned " + n + " prisoners loose in front of a slaver.", "good");
              loyMove(+7, "mercy in front of witnesses");
              W.emit("army", S.army.length);
            } },
          { key: "no", label: "THEY STAY IN THE WIRE", cls: "ghost", hint: "nothing changes", run: function () {} },
        ],
      };
    },
  });

  /* ---- 13. the toll. Small, mean, three real answers. */
  add({
    id: "toll", tag: "THE CROSSING",
    weight: function () { const b = biome(); return (b === "wadi" || b === "rock") ? 1.3 : 0.5; },
    build: function () {
      const n = Math.max(4, Math.round(size() * W.range(0.25, 0.6)));
      const toll = Math.round(size() * 5 + 40);
      return {
        title: 'A <em>TOLL</em> AT THE NARROWS',
        sub: place().toUpperCase(),
        body: 'The only way through the rock for six kilometres, and ' + n + ' men are sitting on ' +
              'both sides of it with a truck across the gap. The price is $' + toll +
              ' and the man saying it is not the one holding the machine gun.',
        choices: [
          { key: "pay", label: "PAY THE TOLL", cls: "", enabled: S.gold >= toll,
            hint: S.gold >= toll ? "-$" + toll + " · straight through" : "you do not have $" + toll,
            run: function () {
              if (!W.pay(toll)) return;
              W.log("paid $" + toll + " at the narrows.", "");
              loyMove(-2, "your men do not like paying bandits");
            } },
          { key: "fight", label: "GO THROUGH THEM", cls: "hot",
            hint: "fight " + n + " men now",
            run: function () {
              const b = spawnBandNear({ size: n, faction: "bandit", name: "THE TOLLMEN", r: 60, cooldown: 0 });
              b.mood = "hunt"; b.goal = { x: S.you.x, z: S.you.z };
              W.toast("THEY ARE COMING DOWN OFF THE ROCK", "bad");
            } },
          { key: "around", label: "GO AROUND", cls: "ghost",
            hint: "half a day · -$" + Math.round(W.payroll() / 2) + " in wages",
            run: function () {
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
            hint: "+" + n + " guns · an hour or two",
            run: function () {
              for (let i = 0; i < guns.length; i++) W.stash(guns[i], 1);
              S.hour += 2;
              if (S.hour >= 24) { S.hour -= 24; W.dawn(); }
              W.toast("+" + n + " GUNS", "good");
              W.log("dug " + n + " working rifles out of an old field.", "");
            } },
          { key: "bury", label: "BURY WHAT IS LEFT OF THEM", cls: "",
            hint: "no guns · half a day · your men will remember it",
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
    build: function () {
      const n = W.irange(8, Math.max(10, Math.round(size() * 0.8)));
      const wealth = clamp(0.3 + n / 150, 0.25, 0.8);
      // the odds are core's odds — you against one man, with your kit
      const mine = W.yourPower() - W.power(S.army);
      const his = W.soldierPower(W.makeSoldier("veteran", gunFor(wealth)));
      const p = W.odds(mine, his * 2.2);
      return {
        title: 'HE WANTS <em>YOU</em>, NOT YOUR ARMY',
        sub: n + " MEN WATCHING",
        body: 'Their biggest man walks out ahead of the line, puts his rifle in the sand and ' +
              'shouts across two hundred metres of nothing that if you beat him his ' + n +
              ' men are yours, and if he beats you they take what you are carrying. ' +
              'Your men are already forming a circle. You would win this about ' +
              Math.round(p * 100) + ' times in a hundred.',
        choices: [
          { key: "fight", label: "WALK OUT", cls: "hot",
            hint: Math.round(p * 100) + "% · win: +" + men(n) + " · lose: badly hurt, and they take a third of the cart",
            run: function () {
              if (W.chance(p)) {
                for (let i = 0; i < n; i++) join(W.chance(0.6) ? "raider" : "soldier", gunFor(wealth), 0.5);
                S.fame += Math.round(6 + n * 0.4);
                S.you.kills++;
                W.log("killed their champion in front of both armies. " + n + " men came over.", "good");
                W.toast("+" + men(n), "good");
                loyMove(+14, "they watched you do it yourself");
              } else {
                S.you.hp = Math.max(1, Math.round(S.you.maxHp * 0.25));
                const bag = Object.keys(S.baggage);
                for (let i = 0; i < Math.ceil(bag.length / 3); i++) W.unstash(bag[i], S.baggage[bag[i]]);
                S.fame = Math.max(0, S.fame - 8);
                W.log("lost a duel. They took a third of the cart and let you crawl back.", "bad");
                loyMove(-11, "they watched that too");
              }
              reconcile();
            } },
          { key: "line", label: "SEND THE LINE INSTEAD", cls: "",
            hint: "fight all " + n + " properly · fame down for refusing",
            run: function () {
              const b = spawnBandNear({ size: n, faction: "company", name: "THE CHALLENGERS", r: 70, cooldown: 0 });
              b.mood = "hunt"; b.goal = { x: S.you.x, z: S.you.z };
              S.fame = Math.max(0, S.fame - 3);
              loyMove(-4, "you would not walk out");
            } },
          { key: "no", label: "RIDE AWAY", cls: "ghost", hint: "fame down · loyalty down",
            run: function () { S.fame = Math.max(0, S.fame - 5); loyMove(-7, "you rode away from a challenge"); } },
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
            hint: S.gold >= price ? "-$" + price + " · " + hurt.length + " men back on their feet"
                                  : "you do not have $" + price,
            run: function () {
              if (!W.pay(price)) return;
              for (let i = 0; i < hurt.length; i++) { hurt[i].wounded = false; hurt[i].hp = hurt[i].maxHp; }
              W.log("paid $" + price + " for medicine. " + hurt.length + " men stood up.", "good");
              loyMove(+8, "you spent money on the hurt");
            } },
          { key: "leave", label: "LEAVE THEM AT THE NEXT WELL", cls: "",
            hint: "-" + men(hurt.length) + " · no wages for them · loyalty falls",
            run: function () {
              for (let i = 0; i < hurt.length; i++) { bury(hurt[i], "left behind sick"); W.removeSoldier(hurt[i].id, true); }
              W.log("left " + hurt.length + " sick men at a well.", "bad");
              loyMove(-12, "you left the hurt behind");
              reconcile();
            } },
          { key: "ride", label: "CARRY THEM AND RIDE", cls: "",
            hint: "free · about half of them die anyway",
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
    build: function () {
      const n = W.irange(4, Math.max(6, Math.round(size() * 0.3)));
      const price = Math.round(n * W.tier("raider").hire * 0.55);
      return {
        title: 'HE HAS BEEN <em>WATCHING</em> YOU',
        sub: "A SERGEANT FROM SOMEBODY ELSE'S COLUMN",
        body: 'He rode in alone with his hands up. He says his warlord has not paid anyone in ' +
              'nine days and he can bring ' + n + ' men across tonight if there is money in it. ' +
              'He knows your name, which is either flattering or a problem.',
        choices: [
          { key: "pay", label: "PAY HIM", cls: "hot", enabled: S.gold >= price,
            hint: S.gold >= price ? "-$" + price + " · +" + men(n) + " tonight" : "you do not have $" + price,
            run: function () {
              if (!W.pay(price)) return;
              for (let i = 0; i < n; i++) join(W.chance(0.5) ? "raider" : "soldier", gunFor(0.45), 0.5);
              W.log("bought " + n + " men out of another warlord's column for $" + price + ".", "good");
              W.toast("+" + men(n), "good");
              reconcile();
            } },
          { key: "trap", label: "IT IS A TRAP. TAKE HIM PRISONER.", cls: "bad",
            hint: "+1 prisoner · you will never know",
            run: function () {
              S.prisoners.push(W.makeSoldier("soldier", gunFor(0.5)));
              W.log("put the defector in the wire instead.", "");
              loyMove(-3, "a man came to you and you chained him");
              W.emit("army", S.army.length);
            } },
          { key: "no", label: "SEND HIM BACK", cls: "ghost", hint: "nothing changes", run: function () {} },
        ],
      };
    },
  });

  /* ---- 18. one of THE FOUR sends a rider. The endgame reaching into the
       road-event layer, which is how a player finds out the endgame exists. */
  add({
    id: "summons", tag: "A RIDER UNDER A WHITE RAG",
    weight: function () {
      if (FLAG_NOEND) return 0;
      const alive = fourAlive();
      return (alive.length && size() >= 30 && S.fame >= 30) ? 1.4 : 0;
    },
    build: function () {
      /* raised on demand, because ?event=summons has to work on a page where
         the player has not ridden far enough to meet anybody. The weight above
         already refuses to fire this naturally without a live warlord. */
      if (!ev().four) raiseTheFour();
      const alive = fourAlive();
      if (!alive.length) return null;
      const b = alive[Math.floor(W.rnd() * alive.length)];
      const tribute = Math.round(W.payroll() * 6 + size() * 9);
      return {
        title: esc(b.name) + ' SENDS A <em>RIDER</em>',
        sub: W.bandSize(b) + " MEN UNDER HIS BANNER",
        body: 'The rider does not dismount. He says his warlord has been counting your column and ' +
              'has decided you are worth talking to once. Pay $' + tribute + ' a season and ride ' +
              'where you like. Refuse and he comes with everything he has.',
        choices: [
          { key: "pay", label: "PAY THE TRIBUTE", cls: "", enabled: S.gold >= tribute,
            hint: S.gold >= tribute ? "-$" + tribute + " · he leaves you alone for a while"
                                    : "you do not have $" + tribute,
            run: function () {
              if (!W.pay(tribute)) return;
              b.cooldown = 600; b.mood = "roam";
              W.log("paid tribute to " + b.name + ".", "bad");
              loyMove(-10, "you paid another warlord");
              S.fame = Math.max(0, S.fame - 8);
            } },
          { key: "defy", label: "SEND HIM BACK ON FOOT", cls: "hot",
            hint: "+fame · " + esc(b.name) + " starts hunting you",
            run: function () {
              b.mood = "hunt"; b.goal = { x: S.you.x, z: S.you.z }; b.cooldown = 0;
              S.fame += 12;
              W.log("sent " + b.name + "'s rider back on foot.", "good");
              loyMove(+11, "they have been waiting for you to say that");
              W.toast(b.name.toUpperCase() + " IS COMING", "bad");
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
            hint: S.gold >= bonus ? "-$" + bonus + " · loyalty up hard" : "you do not have $" + bonus,
            run: function () {
              if (!W.pay(bonus)) return;
              W.log("paid $" + bonus + " out to the whole column in one night.", "good");
              loyMove(+26, "silver, in every hand, tonight");
              ev().unrest = 0;
            } },
          { key: "kill", label: "TAKE " + (lead ? lead.name.toUpperCase() : "HIM") + " OUT OF THE CAMP", cls: "bad",
            hint: "the faction loses its head · loyalty falls further · it might hold",
            run: function () {
              if (lead) { bury(lead, "executed by you"); W.removeSoldier(lead.id, true); }
              S.stats.executed += 1;
              W.log("walked " + esc(name) + " out of the camp. He did not walk back.", "bad");
              loyMove(-9, "you killed the man they were listening to");
              ev().unrest = Math.max(0, ev().unrest - 2);
              reconcile();
            } },
          { key: "let", label: "OPEN THE GATE", cls: "",
            hint: "-" + men(cut.length) + " · the ones who stay are yours",
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
              'already packed. They are volunteers, which in this country means they will still ' +
              'be behind you in a month.',
        choices: [
          { key: "take", label: "TAKE THEM", cls: "hot", hint: "+" + men(n) + " · volunteers",
            run: function () {
              for (let i = 0; i < n; i++) join("levy", gunFor(0.2), 0.78);
              S.fame += 6;
              W.toast("+" + men(n), "good");
              W.log("collected " + n + " volunteers from " + (c.from || "the village") + ".", "good");
              loyMove(+6, "you kept a promise where people could see");
              reconcile();
            } },
          { key: "gold", label: "TAKE COIN INSTEAD", cls: "",
            hint: "+$" + (n * 30) + " · they keep their sons",
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
    return fire(id, arg);
  };

  E.maybeFire = function () {
    if (FLAG_NOEVENTS || !canOpen()) return false;
    if (ev().over) return false;
    const L = pickEvent();
    if (!L) return false;
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
    showCard({
      id: "mutiny", tag: "IT IS TONIGHT",
      title: '<em>MUTINY</em>',
      sub: cut.length + " AGAINST " + (S.army.length + 1),
      body: 'They came for the trucks first and then for you. ' + cut.length + ' men are on the ' +
            'other side of the fire with the rifles you gave them, and ' + S.army.length +
            ' are on this one. There is no third option and there is nowhere to ride.',
      choices: [
        { key: "fight", label: "PUT IT DOWN", cls: "bad",
          hint: cut.length + " men · your own · lose this and it is over",
          run: function () {
            if (W.battle && W.battle.start) safe(function () { W.battle.start({ band: b, defending: true, mutiny: true }); });
            else { endRun("mutiny", "Your own men killed you in the dark."); }
          } },
      ],
    });
    return true;
  }
  E.mutiny = mutiny;

  /* ============================================================ THE FOUR
     THE WIN CONDITION, AND WHY IT IS THIS ONE.

     core.js already says four armies of 120-320 exist on this island and calls
     them "the endgame" in a comment. That comment was the whole design; all
     this does is give them names, put them on the map on purpose rather than
     by accident, and make breaking them mean something. Taking every outpost
     was the other candidate and it loses: outposts are where you SPEND, so a
     win condition made of outposts turns the economy into a checklist. An army
     you have to be able to beat is a win condition made of the thing the game
     is actually about.

     THE ARC has a shape rather than a count. Break three and the fourth stops
     roaming: he absorbs what is left of the others and comes for you with
     everything, and that fight is the end of the run either way. */
  const WARLORD_NAMES = [
    { name: "AZRAQ THE COLD", faction: "legion",  note: "keeps his men in ranks and his prisoners in wire." },
    { name: "MOTHER SALT", faction: "company",    note: "took the pan by outliving everyone who wanted it." },
    { name: "THE JACKAL OF THE WADI", faction: "bandit", note: "has never held ground and has never lost." },
    { name: "KHALIS IRON-HAND", faction: "warlord", note: "was a warlord's prisoner. Then he was not." },
    { name: "THE WIDOW OF SIX WELLS", faction: "militia", note: "sells water and buys men." },
    { name: "OBAN RED", faction: "warlord",       note: "burned his own camp rather than leave it." },
    { name: "THE COUNTER", faction: "legion",     note: "knows the size of every column on this island." },
    { name: "SAIF THE PATIENT", faction: "company", note: "has been waiting for you specifically." },
  ];

  function fourList() {
    const v = ev();
    if (!v.four) return [];
    const out = [];
    for (let i = 0; i < v.four.length; i++) {
      const rec = v.four[i];
      let band = null;
      for (let j = 0; j < S.bands.length; j++) if (S.bands[j].id === rec.id) { band = S.bands[j]; break; }
      out.push({ rec: rec, band: band });
    }
    return out;
  }
  function fourAlive() {
    const out = [];
    const L = fourList();
    for (let i = 0; i < L.length; i++) if (L[i].band && L[i].band.men.length) out.push(L[i].band);
    return out;
  }
  E.four = fourList;

  /* raise them once, the first time the player is actually on the island. A
     band promoted into a warlord is preferred over a fresh one so the map's
     own population is used rather than doubled. */
  function raiseTheFour() {
    if (FLAG_NOEND) return;
    const v = ev();
    if (v.four) return;
    v.four = [];
    const used = {};
    const big = S.bands.slice().sort(function (a, b) { return b.men.length - a.men.length; });
    for (let i = 0; i < FOUR_N; i++) {
      const spec = WARLORD_NAMES[i % WARLORD_NAMES.length];
      let band = null;
      for (let j = 0; j < big.length; j++) {
        const b = big[j];
        if (used[b.id] || b.men.length < W.BAND_CLASSES[3].lo) continue;
        used[b.id] = 1; band = b; break;
      }
      if (!band) {
        const D = W.desert;
        // put them far apart and far from you: the first one you meet should
        // be a thing you rode to, not a thing that walked into you on day two
        const ang = (i / FOUR_N) * Math.PI * 2 + W.rnd() * 0.6;
        const R = (D && D.RADIUS ? D.RADIUS : 6500) * 0.62;
        let p = { x: Math.cos(ang) * R, z: Math.sin(ang) * R };
        if (D && D.landPoint) {
          const q = D.landPoint(W.rnd, { minR: R * 0.7, maxR: R * 1.15 });
          if (q) p = q;
        }
        band = W.makeBand({ size: W.irange(W.BAND_CLASSES[3].lo, W.BAND_CLASSES[3].hi), faction: spec.faction, x: p.x, z: p.z });
        S.bands.push(band);
      }
      band.name = spec.name;
      band.warlord = true;
      band.note = spec.note;
      band.mood = "camp";
      v.four.push({ id: band.id, name: spec.name, note: spec.note, size0: band.men.length, dead: 0 });
    }
    W.log("four names hold this island. Nobody else matters.", "");
  }

  /* did one fall? Checked after every aftermath and every dawn, because a
     warlord can also be ground down by somebody else's war while you ride. */
  function checkFour() {
    if (FLAG_NOEND) return;
    const v = ev();
    if (!v.four) return;
    let alive = 0, fellNow = null;
    for (let i = 0; i < v.four.length; i++) {
      const rec = v.four[i];
      if (rec.dead) continue;
      let band = null;
      for (let j = 0; j < S.bands.length; j++) if (S.bands[j].id === rec.id) { band = S.bands[j]; break; }
      // "broken" is 15% of what he started with — an army that small is not a
      // warlord any more, and chasing the last nine men across a 14 km island
      // is not a boss fight, it is admin
      if (!band || band.men.length <= Math.max(4, rec.size0 * 0.15)) {
        rec.dead = S.day;
        if (band) { const bi = S.bands.indexOf(band); if (bi >= 0) S.bands.splice(bi, 1); }
        v.fell.push({ name: rec.name, day: S.day, size: rec.size0 });
        fellNow = rec;
        W.emit("events:warlord", { name: rec.name, fallen: true });
      } else alive++;
    }
    if (fellNow) {
      W.log(fellNow.name + " is finished. " + alive + " left.", "good");
      S.fame += 40;
      loyMove(+12, "they broke a warlord and they know it");
      W.toast(fellNow.name + " IS FINISHED", "good");
    }
    if (alive === 0 && v.four.length) { victory(); return; }
    /* THE LAST WAR. Three down and the survivor stops being a party on a map:
       he takes in what is left of everyone else's columns and comes for you.
       The absorption is real men built by core, at his own wealth, so the
       final fight is genuinely the biggest thing on the island. */
    if (alive === 1 && !v.last) {
      const b = fourAlive()[0];
      if (b) {
        v.last = b.id;
        const take = Math.round(b.men.length * 0.45);
        for (let i = 0; i < take; i++) {
          const F = W.faction(b.faction);
          const tid = F.tiers[Math.floor(W.rnd() * F.tiers.length)];
          b.men.push(W.makeSoldier(tid, W.bandGunFor(b.wealth)));
        }
        b.name = b.name + " — THE LAST";
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

     WINNING is the four. */
  function endRun(kind, why) {
    const v = ev();
    if (v.over) return;
    v.over = { kind: kind, why: why, day: S.day };
    W.emit("events:over", { kind: kind, why: why });
    W.setPhase("over");
    summary();
  }
  E.over = endRun;

  function victory() { endRun("won", "There is nobody left on this island who can tell you no."); }

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
    if (!shown.length) names = '<span class="wl-dim">Nobody who followed you died. That is its own kind of run.</span>';

    let four = "";
    const L = fourList();
    for (let i = 0; i < L.length; i++) {
      const rec = L[i].rec, band = L[i].band;
      four += '<div class="w' + (rec.dead ? " dead" : "") + '"><b>' + esc(rec.name) + '</b>' +
        '<div class="wl-small wl-dim">' + (rec.dead ? "BROKEN — DAY " + rec.dead
          : band ? W.bandSize(band) + " MEN, STILL OUT THERE" : "GONE") + '</div></div>';
    }

    takeScreen(
      '<div class="wl-ch">' +
      '<h1 class="wl-h">' + (won ? 'THE ISLAND IS <em>YOURS</em>' : 'IT <em>ENDS</em> HERE') + '</h1>' +
      '<p class="wl-sub">DAY ' + S.day + ' · ' + esc(title()) + '</p>' +
      '<div class="wl-card"><div style="opacity:.9;line-height:1.5;font-weight:500">' +
        esc(v.over ? v.over.why : "") + '</div></div>' +
      '<div class="wl-lbl">THE RUN</div>' +
      '<div class="wl-stats">' +
        statCard("DAYS", S.day) +
        statCard("BIGGEST COLUMN", v.peak + " MEN") +
        statCard("BATTLES", (st.battles || 0) + " — " + (st.won || 0) + " WON") +
        statCard("THEY LOST", (st.killed || 0) + " DEAD") +
        statCard("YOU LOST", (st.lost || 0) + " DEAD") +
        statCard("HIRED / PRESSED", (st.recruited || 0) + " / " + (st.conscripted || 0)) +
        statCard("EXECUTED", st.executed || 0) +
        statCard("FAME", S.fame) +
      '</div>' +
      '<div class="wl-lbl">THE FOUR</div><div class="wl-four">' + four + '</div>' +
      '<div class="wl-lbl">YOUR DEAD — ' + fallen.length + '</div>' +
      '<div class="wl-card">' + names + '</div>' +
      '<div class="wl-btns">' +
        '<button class="wl-btn hot" id="ovNew">RIDE OUT AGAIN</button>' +
        '<button class="wl-btn" id="ovLog">READ THE CHRONICLE</button>' +
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
    if (!body) body = '<div class="wl-dim">Nothing has happened yet.</div>';
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
    if (!rows) rows = '<div class="wl-dim">There is nobody behind you to have an opinion.</div>';
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
      '<div class="wl-card wl-small wl-dim" style="line-height:1.6">' +
        'Loyalty drifts every dawn toward the CEILING, and the ceiling is who these men are. ' +
        'A man you paid for starts near 82. A man you took off a battlefield starts near 26 and ' +
        'climbs about six a fight — a pressed levy who has survived six fights for you is yours. ' +
        'Every execution poisons the whole column and poisons the pressed men worst. ' +
        'Under 20 they start deciding, and they will tell you first.' +
      '</div>' +
      '<div class="wl-lbl">THE ONES WHO ARE THINKING ABOUT IT</div>' +
      '<div class="wl-card">' + rows + '</div>' +
      '<div class="wl-btns">' +
        '<button class="wl-btn hot" id="loBack">BACK</button>' +
        '<button class="wl-btn" id="loCh">THE CHRONICLE</button>' +
        (fourList().length ? '<button class="wl-btn" id="loWar">THE FOUR</button>' : '') +
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

  /* ---- THE FOUR: the progress bar for the whole run ---- */
  function openWar() {
    css();
    const L = fourList();
    const v = ev();
    let cards = "";
    const mine = W.yourPower();
    for (let i = 0; i < L.length; i++) {
      const rec = L[i].rec, band = L[i].band;
      let line;
      if (rec.dead) line = "BROKEN ON DAY " + rec.dead;
      else if (!band) line = "GONE — somebody else got there";
      else {
        const d = Math.round(Math.hypot(band.x - S.you.x, band.z - S.you.z));
        const o = Math.round(W.odds(mine, W.bandPower(band)) * 100);
        line = W.bandSize(band) + " MEN · " + (d > 999 ? (d / 1000).toFixed(1) + " km" : d + " m") + " · YOU WIN " + o + "%";
      }
      cards += '<div class="w' + (rec.dead ? " dead" : "") + '"><b>' + esc(rec.name) + '</b>' +
        '<div class="wl-small wl-dim" style="margin-bottom:5px">' + esc(rec.note || "") + '</div>' +
        '<div class="wl-small">' + esc(line) + '</div>' +
        (band && !rec.dead ? meter(W.odds(mine, W.bandPower(band)), W.odds(mine, W.bandPower(band)) > 0.5 ? "good" : "bad") : "") +
        '</div>';
    }
    const done = v.fell.length, total = L.length;
    takeScreen(
      '<div class="wl-ch">' +
      '<h1 class="wl-h">THE <em>FOUR</em></h1>' +
      '<p class="wl-sub">' + done + " OF " + total + ' BROKEN' + (v.last ? " · THE LAST WAR" : "") + '</p>' +
      '<div class="wl-card">' + meter(total ? done / total : 0, done === total ? "good" : "") +
        '<div class="wl-small wl-dim" style="margin-top:7px">' +
        (v.last ? 'Three are down. The survivor has taken in everything that is left of them and he is coming to you. There is one fight left in this run.'
                : 'Four names hold this island. Break all four and there is nobody left who can tell you no. Break three and the fourth stops waiting.') +
        '</div></div>' +
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
    c1.className = "chip act wl-evchip" + (l < 30 ? " " : "");
    c1.style.color = l < 20 ? "#ff8f86" : l < 46 ? "#ffd166" : "";
    c1.textContent = "LOYAL " + l + (v.unrest ? " !" : "");
    c1.title = m.note;
    c1.onclick = function () { if (canOpen() || W.phase() === "campaign") openLoyalty(); };
    h.appendChild(c1);

    if (!FLAG_NOWEATHER && (v.wea !== "clear" || isNight())) {
      const c2 = document.createElement("span");
      c2.className = "chip wl-evchip";
      c2.style.color = v.wea === "storm" ? "#e0b070" : "";
      c2.textContent = isNight() && v.wea === "clear" ? "NIGHT" : WEATHER[v.wea].label;
      h.appendChild(c2);
    }
    const L = fourList();
    if (L.length) {
      const c3 = document.createElement("span");
      c3.className = "chip act wl-evchip";
      c3.textContent = ev().fell.length + "/" + L.length + " WARLORDS";
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
        const b = spawnBandNear({ size: c.size, faction: "warlord", name: "THE MAN YOU LET GO", hunt: true, r: 2200, cooldown: 20 });
        W.log("the warlord you let live has a column again. " + W.bandSize(b) + " men, and he knows your banner.", "bad");
        W.toast("HE CAME BACK", "bad");
      }
    }

    checkFour();
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
        checkFour();
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
    slow -= dt;
    if (slow <= 0) { slow = 0.25; hideMe(0.25); paintChipsThrottled(); }

    const x = S.you.x, z = S.you.z;
    if (!hadPos) { lastX = x; lastZ = z; hadPos = true; return; }
    const d = Math.hypot(x - lastX, z - lastZ);
    lastX = x; lastZ = z;
    if (d > 400) return;              // a teleport (battle exit, load) is not travel
    since += d;
    if (E.driven || FLAG_NOEVENTS || CARD) return;
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
    if (since >= next && !CARD) { since = 0; next = W.range(1100, 2600); E.maybeFire(); }
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
  E.audit = function () {
    const v = ev();
    return {
      loyalty: loyalty(), mood: mood().label, ceiling: Math.round(avgBond() * 100),
      unrest: v.unrest, weather: v.wea, vis: Math.round(visibility()),
      night: isNight(), events: LIB.length, fired: v.seen,
      four: fourList().map(function (f) { return f.rec.name + (f.rec.dead ? " (dead)" : f.band ? " " + f.band.men.length : " ?"); }),
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
      safe(paintChips);
    });
    W.on("army", function () { reconcile(); safe(paintChips); });
    W.on("gold", function () { safe(paintChips); });

    W.on("dawn", function () { safe(onDawn); });
    W.on("phase:aftermath", function (r) { safe(function () { onAftermath(r); }); });
    W.on("newgame", function () {
      if (S.flags) delete S.flags.ev;
      ev();
      hadPos = false; since = 0; next = 1400;
      fogSaved = null;
    });
    W.on("campaign:ready", function () { safe(raiseTheFour); safe(rollWeather); safe(paintChips); });
    W.on("phase:campaign", function () { setTimeout(function () { safe(pending); }, 600); });
    // if campaign never emits its ready event, the first dawn still raises them
    W.on("dawn", function () { if (!ev().four) safe(raiseTheFour); });

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
        if (ctx.paintHud) ctx.paintHud();
      };
      const open = function () {
        setTimeout(function () {
          safe(raiseTheFour);
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
