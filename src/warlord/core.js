/* ============================================================
   warlord/core.js — DESERT WARLORD: the spine.

   THE GAME. You start alone in a desert the size of a country with a
   pistol and forty dollars. You end it with an army. In between there is
   exactly one loop, and everything else in src/warlord/ is a face of it:

       ride the island  →  meet somebody  →  fight / hire / demand
       surrender  →  count the dead, take their guns, take their men  →
       spend what you took at an outpost  →  ride the island

   That is Bannerlord with the accounting removed. No fiefs, no marriage,
   no clan tree, no perks, no trade goods. One number that matters (how
   many men you have), one currency, one map.

   WHY THIS FILE EXISTS AT ALL. Four modules — the island, the battle, the
   outposts, the network — all have to agree about what a soldier IS, what
   a warband IS, and whose turn it is to own the screen. If each one keeps
   its own idea, the battle gets a roster the campaign cannot read back and
   the network serialises a shape nothing else recognises. So the STATE is
   declared once, here, and nothing else is allowed to invent a second copy.
   Modules attach themselves as CBZ.warlord.<name> and read/write this state.

   WHAT THIS FILE OWNS
     · STATE            the whole game as one plain object (savable, sendable)
     · the soldier      one man: tier, gun, armour, wounds, name, veterancy
     · the warband      a party on the map: yours, theirs, or another player's
     · PHASE            who owns the screen right now, and the transitions
     · the bus          on/emit, so nothing has to import anything
     · money, morale, wages, the day clock
     · the armoury bridge — gun ids, prices, and what a gun is worth as loot
     · save/load, the log, the toast

   WHAT IT DELIBERATELY DOES NOT OWN: any THREE object. Not one. This file
   must be loadable in Node for a determinism test, and the moment it holds
   a Mesh that stops being true.
============================================================ */
(function () {
  "use strict";
  const G = (typeof window !== "undefined" ? window : globalThis);
  const CBZ = (G.CBZ = G.CBZ || {});
  const W = (CBZ.warlord = CBZ.warlord || {});
  if (W._core) return;
  W._core = true;
  W.VERSION = 1;

  /* ============================================================ DICE
     ONE SEEDED STREAM, because a campaign that cannot be replayed cannot be
     bug-reported. Same doctrine as core/seed.js: a 32-bit integer state, an
     avalanche, and a pure hash for anything positional (an outpost's stock
     must not depend on the order the player visited things in). */
  function mulberry(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  W.rngFrom = mulberry;
  // the campaign's own stream — reseeded by newGame()
  let RND = mulberry(1);
  W.rnd = function () { return RND(); };
  W.range = function (a, b) { return a + RND() * (b - a); };
  W.irange = function (a, b) { return a + Math.floor(RND() * (b - a + 1)); };
  W.pick = function (arr) { return arr[Math.floor(RND() * arr.length) % arr.length]; };
  W.chance = function (p) { return RND() < p; };
  // positional hash: order-independent, for anything the world "always had"
  W.hash01 = function (x, y, salt) {
    let n = ((Math.round(x * 8) | 0) * 73856093) ^ ((Math.round(y * 8) | 0) * 19349663) ^ ((salt | 0) * 83492791);
    n = Math.imul(n ^ (n >>> 13), 0x85ebca6b) >>> 0;
    n ^= n >>> 16;
    return (n >>> 0) / 4294967296;
  };
  const clamp = W.clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  W.lerp = function (a, b, t) { return a + (b - a) * t; };

  /* ============================================================ THE BUS
     Four modules, no import graph. `on` returns its own unsubscribe so a
     screen that is torn down does not leave a listener holding its DOM. */
  const HANDLERS = {};
  W.on = function (ev, fn) {
    (HANDLERS[ev] = HANDLERS[ev] || []).push(fn);
    return function () {
      const L = HANDLERS[ev]; if (!L) return;
      const i = L.indexOf(fn); if (i >= 0) L.splice(i, 1);
    };
  };
  W.emit = function (ev, a, b) {
    const L = HANDLERS[ev];
    if (!L) return;
    for (let i = 0; i < L.length; i++) {
      try { L[i](a, b); } catch (e) { try { console.error("[warlord]", ev, e); } catch (e2) {} }
    }
  };

  /* ============================================================ THE MEN
     A SOLDIER IS FIVE FACTS. tier (how well he fights), wid (what he is
     holding), armour (what he is wearing), hp, and a name so that losing him
     costs something. Everything the battle needs beyond that — cover state,
     ammo, morale under fire — belongs to the battle and dies with it.

     TIERS, and why there are four and not twelve. Each tier is a different
     ANSWER to "what happens when this man is shot at", and past four the
     answers stop being distinguishable on screen, which makes the fifth one
     a number in a menu rather than a thing you can see. They map straight
     onto combat_iq's own role tiers (it reads .swat/.kind/.aggr off an actor),
     so a levy genuinely panics and a veteran genuinely uses cover. */
  const TIERS = W.TIERS = [
    { id: "levy",    label: "LEVY",     hp: 62,  acc: 0.42, wage: 1, hire: 22,  aggr: 0.55, cq: "civ",
      note: "farmhands with a gun. they break." },
    { id: "raider",  label: "RAIDER",   hp: 80,  acc: 0.58, wage: 2, hire: 48,  aggr: 0.92, cq: "thug",
      note: "brave, stupid, forward." },
    { id: "soldier", label: "SOLDIER",  hp: 100, acc: 0.74, wage: 4, hire: 95,  aggr: 0.7,  cq: "guard",
      note: "trained. holds a line." },
    { id: "veteran", label: "VETERAN",  hp: 125, acc: 0.88, wage: 8, hire: 210, aggr: 0.75, cq: "soldier",
      note: "uses cover like he means it." },
  ];
  W.tier = function (id) {
    for (let i = 0; i < TIERS.length; i++) if (TIERS[i].id === id) return TIERS[i];
    return TIERS[0];
  };
  W.tierIndex = function (id) {
    for (let i = 0; i < TIERS.length; i++) if (TIERS[i].id === id) return i;
    return 0;
  };

  /* ARMOUR is three rows for the same reason tiers are four: each row changes
     what a hit DOES, and the fourth row would only change a number.
     `soak` is flat damage removed per hit; `slow` is the speed it costs. */
  const ARMOUR = W.ARMOUR = [
    { id: "none",  label: "NO ARMOUR", soak: 0,  slow: 0,    price: 0,   note: "a shirt." },
    { id: "vest",  label: "FLAK VEST", soak: 9,  slow: 0.03, price: 60,  note: "stops a pistol, mostly." },
    { id: "plate", label: "PLATE RIG", soak: 20, slow: 0.09, price: 180, note: "stops a rifle. costs you a step." },
    { id: "heavy", label: "HEAVY KIT", soak: 32, slow: 0.19, price: 420, note: "you will not be running." },
  ];
  W.armour = function (id) {
    for (let i = 0; i < ARMOUR.length; i++) if (ARMOUR[i].id === id) return ARMOUR[i];
    return ARMOUR[0];
  };

  /* NAMES. A casualty list of "man 41, man 42" is a spreadsheet; a casualty
     list with names on it is the reason you do not charge. Two syllable
     tables and a hash is enough — the point is that the SAME man keeps the
     SAME name across a battle, a save and a network hop. */
  const NM_A = ["Kaseem", "Dov", "Rahm", "Isko", "Bly", "Tarek", "Osun", "Cael", "Nadir", "Vosk",
                "Halim", "Bren", "Jori", "Sadiq", "Emeka", "Toma", "Ruel", "Anwar", "Piet", "Yusuf",
                "Cato", "Mirza", "Dain", "Osei", "Lev", "Ferro", "Kito", "Ansel", "Baruk", "Sten"];
  const NM_B = ["Ash", "Vale", "Kord", "Reyes", "Mbeki", "Dune", "Halloran", "Sarr", "Kovic", "Oyelaran",
                "Strand", "Amari", "Basso", "Ndiaye", "Quill", "Fahey", "Roth", "Okonkwo", "Vantt", "Serra"];
  let UID = 1;
  W.nextId = function () { return UID++; };
  W.nameFor = function (id) {
    const a = NM_A[Math.floor(W.hash01(id, 7, 11) * NM_A.length) % NM_A.length];
    const b = NM_B[Math.floor(W.hash01(id, 13, 29) * NM_B.length) % NM_B.length];
    return a + " " + b;
  };

  /* makeSoldier — the ONLY constructor. Every man in the game comes through
     here: your hires, their levies, the prisoners you conscript, the puppets
     a network peer sends. One shape means one bug. */
  W.makeSoldier = function (tierId, wid, opts) {
    opts = opts || {};
    const T = W.tier(tierId);
    const id = opts.id == null ? W.nextId() : opts.id;
    return {
      id: id,
      name: opts.name || W.nameFor(id),
      tier: T.id,
      wid: wid || "sidearm",             // what he is holding — a weapon-data id
      armour: opts.armour || "none",
      hp: opts.hp == null ? T.hp : opts.hp,
      maxHp: T.hp,
      kills: opts.kills || 0,
      battles: opts.battles || 0,
      wounded: !!opts.wounded,           // survived at low hp: fights at 60% until he rests
    };
  };

  /* PROMOTION. A man who lives through fights gets better, and that is the
     whole progression system. No XP bar: three battles survived is the bar. */
  W.PROMOTE_AT = 3;
  W.promoteSurvivors = function (list) {
    const up = [];
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      s.battles = (s.battles || 0) + 1;
      const ti = W.tierIndex(s.tier);
      if (ti < TIERS.length - 1 && s.battles >= W.PROMOTE_AT * (ti + 1)) {
        s.tier = TIERS[ti + 1].id;
        s.maxHp = TIERS[ti + 1].hp;
        s.hp = s.maxHp;
        up.push(s);
      }
    }
    return up;
  };

  /* ============================================================ THE GUNS
     THE ARMOURY IS NOT REDECLARED HERE. weapons/weapon-data.js is the truth
     about every gun in this repo and it is already loaded by the page; this
     is the CAMPAIGN's opinion about those guns — what one costs, how rare it
     is at a depot, and what it is worth stripped off a corpse. Price is
     DERIVED from the gun's own numbers (damage, rate, range, explosive)
     rather than typed, so a weapon added to weapon-data.js tomorrow gets a
     sane price today and nothing here needs an edit. */
  W.gunList = function () {
    const list = (CBZ.FPS_WEAPONS || []).filter(function (w) {
      return w && w.id && w.id !== "shank" && w.id !== "grenade";
    });
    return list;
  };
  W.gun = function (id) { return (CBZ.weaponById && CBZ.weaponById(id)) || null; };
  W.gunLabel = function (id) { const w = W.gun(id); return (w && (w.label || w.id)) || String(id).toUpperCase(); };

  /* WHAT A GUN IS WORTH, and the first draft of this got it catastrophically
     wrong in a way worth writing down, because it is the exact trap this repo
     bans under the name STAT FICTION.

     The first version priced a gun off `damage × rate × range`. It produced a
     BAZOOKA FOR $18 — the cheapest thing in the armoury, cheaper than a
     revolver. The reason is that a rocket's `damage` field in weapon-data.js
     is literally 1. That 1 is the impact poke; every rocket's actual lethality
     is `blast: 13`, resolved by studio.boom through systems/ordnance.js and
     never touching the `damage` number at all. A price function that reads one
     field and calls the answer "derived" is a fiction with arithmetic on it.
     tools/warlord-check.mjs exists because of this bug.

     So the model is now what a gun ACTUALLY DELIVERS IN A FIGHT:

       per shot   conventional: damage × pellets.
                  explosive:    the men a blast of that radius catches. A
                                battle line here runs about one man per 28 m²
                                (measured off the spawn spacing battle.html
                                uses), capped at six, because past six the
                                catch is limited by where men actually stand
                                and not by how big the bang is.
       sustained  per-shot × magazine ÷ (time to empty it + reload). This is
                  the term that says an LMG is a different object from a
                  pistol, and no per-shot number ever will.
       reach      how far away it does that.
       lethality  the fraction of a man one trigger pull removes, capped at
                  one — you cannot kill him twice. A gun that drops a man per
                  pull earns a premium because its MISSES cost less: no
                  follow-up, no second exposure. That premium is the only
                  reason a sniper is not last on this list, and without it
                  the sustained-fire term alone rates a 9mm above a .357,
                  which no player will believe.

     Then price is a POWER curve over that value rather than a compression of
     it: the first draft's ^0.86 flattened a 62× spread into a 1.6× one, and
     an armoury where every gun costs about the same is an armoury with no
     decisions in it. */
  /* WHAT ONE ROCKET IS WORTH, AND THE SECOND TIME I READ A FIELD THAT DOES
     NOT EXIST.

     The commit that fixed the $18 bazooka said, at length, that a price model
     which reads one field and calls the answer derived is a fiction with
     arithmetic on it. That fix then read `w.blast`. There is no `w.blast`.
     The engine-wide names — used by city/aircraft.js, city/economy.js,
     city/explosives.js and systems/fpsmode.js alike — are `blastRadius` and
     `blastPower`, so every explosive in this game was silently valued at a
     10 m fallback. Caught by outpost.js's agent, not by me, and not by any
     screenshot.

     Two things are worth recording about it. First, the PRICE barely moved,
     because the six-man cap below swallows the difference between a 10 m and
     a 13 m blast — it was a latent bug, harmless today and waiting for the
     first weapon with a small blast. Second, and this is the part that did
     cost something: `blastPower` was being ignored outright. It is a real
     scalar the whole engine already agrees on, calibrated against a grenade
     at 1.0 — an RPG is 1.9, an aircraft bomb 3.0 — and dropping it meant a
     grenade launcher and a 500 lb bomb were priced as the same object.

     So the model reads BOTH real fields and nothing invented:

       men caught   a battle line runs about one man per 28 m² (measured off
                    the spawn spacing battle.html uses), capped at six —
                    past six the catch is limited by where men actually stand
                    rather than by how big the bang is
       per man      45 × blastPower, i.e. scaled off the engine's own
                    grenade-relative lethality instead of a number I picked

     AND IT COMPLAINS WHEN THE FIELD IS MISSING, which is the actual lesson.
     A silent `|| 10` is what let this survive two commits; a weapon flagged
     explosive with no blast radius is a data bug and should say so once. */
  const _blastWarned = {};
  function blastPerShot(w) {
    const r = w.blastRadius || w.blast || w.radius || 0;
    if (!r && !_blastWarned[w.id]) {
      _blastWarned[w.id] = 1;
      try { console.warn("[warlord] " + w.id + " is explosive but has no blastRadius"); } catch (e) {}
    }
    const men = Math.min(6, Math.PI * Math.pow(r || 10, 2) / 28);
    return men * 45 * (w.blastPower || 1);
  }

  function gunValue(id) {
    const w = W.gun(id);
    if (!w) return 120;
    const delay = w.fireDelay || w.interval || 0.5;
    const mag = w.magSize || w.mag || 10;
    const reload = w.reloadTime || w.reload || 2;
    const per = w.explosive ? blastPerShot(w) : (w.damage || 20) * (w.pellets || 1);
    const sustained = per * mag / Math.max(0.2, mag * delay + reload);
    const reach = Math.min(1.9, 0.55 + (w.range || 60) / 130);
    const lethal = Math.min(1, per / 100);
    return sustained * reach * (1 + 0.6 * lethal);
  }
  W.gunValue = gunValue;

  W.gunPrice = function (id) {
    const w = W.gun(id);
    if (!w) return 40;
    /* THE TASER IS NOT A WEAPON IN THIS GAME and the value model correctly
       says so (5, dead last). It is priced by hand at what it is actually
       for — taking a man alive — which is a CAMPAIGN fact the weapon record
       has no way to know. The one hand-typed price in the file, and it is
       labelled as such rather than hidden. */
    if (w.id === "taser") return 70;
    let p = Math.pow(gunValue(id) / 100, 1.25) * 22;
    if (w.explosive) p *= 3.4;    // one of these changes a battle; no dps says that
    return Math.max(15, Math.round(p / 5) * 5);
  };
  // a depot pays a third of list for your surplus — the spread IS the sink
  W.gunSell = function (id) { return Math.max(5, Math.round(W.gunPrice(id) * 0.34 / 5) * 5); };
  W.armourPrice = function (id) { return W.armour(id).price; };
  W.armourSell = function (id) { return Math.max(0, Math.round(W.armour(id).price * 0.34 / 5) * 5); };

  /* WHAT A GUN IS WORTH IN A FIGHT is not what it is worth in money, and
     conflating them was the second bug the checker found. Price is a money
     curve — deliberately steep, so buying up is a real decision — and running
     soldierPower off it made the gap between a pistol and an LMG read as 1.4×
     when the fight itself is nearer 1.8×. Power reads the combat value
     directly. Capped at 3, because a man with a rocket launcher is still one
     man and can still be shot. */
  W.gunCombat = function (id) { return clamp(gunValue(id) / 300, 0.25, 3.0); };

  /* RARITY drives what a depot has in the crates. Cheap guns are everywhere;
     a launcher shows up at one outpost in six. Derived from price so it, too,
     never needs an edit. The exponent is 0.45 rather than the first draft's
     0.7 for a measurable reason: at 0.7 the rarest thing in the armoury still
     scored 0.54 and every depot carried the same stock, which is a map not
     worth crossing twice. */
  W.gunRarity = function (id) {
    return clamp(1 - Math.pow(W.gunPrice(id) / 2400, 0.45), 0.04, 0.96);
  };

  /* ============================================================ THE STATE
     ONE OBJECT. If it is not in here it does not survive a save, a battle or
     a network hop, and that is the test for whether it belongs in here. */
  const S = W.state = {
    seed: 1,
    mode: "solo",             // "solo" | "net"
    phase: "boot",
    day: 1, hour: 7,          // the clock; a day is riding, an hour is ~2.5 min
    gold: 40,
    fame: 0,                  // total enemies beaten — drives band aggression
    // YOU
    you: {
      name: "WARLORD",
      x: 0, z: 0, yaw: 0,
      wid: "sidearm",
      armour: "none",
      hp: 140, maxHp: 140,
      kills: 0,
    },
    army: [],                 // your men — array of soldiers
    baggage: {},              // wid -> count of UNASSIGNED guns you are carrying
    armourBag: {},            // armour id -> count, unassigned
    prisoners: [],            // soldiers who surrendered, awaiting your decision
    bands: [],                // every other party on the island
    outposts: [],
    peers: {},                // net: id -> {id,name,x,z,size,colour}
    log: [],
    stats: { battles: 0, won: 0, killed: 0, lost: 0, recruited: 0, conscripted: 0, executed: 0 },
    flags: {},
  };

  /* ============================================================ MONEY
     WAGES ARE THE BRAKE. Without them "recruit everybody, always" is the
     only strategy and the game is over on day three. A man costs his tier's
     wage every dawn; a warlord who cannot pay watches his army walk. */
  W.payroll = function () {
    let n = 0;
    for (let i = 0; i < S.army.length; i++) n += W.tier(S.army[i].tier).wage;
    return n;
  };
  W.pay = function (n) {
    if (n > S.gold) return false;
    S.gold -= n; W.emit("gold", S.gold); return true;
  };
  W.earn = function (n) { S.gold += Math.max(0, Math.round(n)); W.emit("gold", S.gold); };

  /* DAWN. The only place the day advances, so the wage, the desertion and the
     outpost restock can never drift out of step with each other. */
  W.dawn = function () {
    S.day++;
    const due = W.payroll();
    if (S.gold >= due) {
      S.gold -= due;
      W.log("dawn — paid $" + due + " in wages.");
    } else {
      /* UNPAID MEN LEAVE, and they leave from the BOTTOM: a veteran has
         somewhere to be and a levy has a farm.

         AND THE FIRST DRAFT OF THIS ATE THE ARMY. It walked the roster
         subtracting three days' wage per departure until the shortfall was
         covered, and on a 40-man force with ten veterans that is 32 men gone
         in one night — every levy AND two veterans — from missing a single
         payday. Measured by tools/warlord-check.mjs, which is why it is a
         cap and not a vibe: ONE bad morning may cost at most 40% of the
         roster. Miss again tomorrow and it takes another 40% of what is
         left, so a warlord who cannot pay is still finished — it just takes
         three days instead of one, and three days is long enough to sell a
         rifle and fix it. Shed, do not evaporate.

         A departing man is credited five days of his own wage: he is walking
         off with his kit and a share of the cart, and that is what settles
         his account. */
      const short = due - S.gold;
      S.gold = 0;
      const cap = Math.max(1, Math.floor(S.army.length * 0.4));
      const order = S.army.slice().sort(function (a, b) { return W.tierIndex(a.tier) - W.tierIndex(b.tier); });
      let owed = short, walked = 0;
      while (owed > 0 && order.length && walked < cap) {
        const s = order.shift();
        owed -= W.tier(s.tier).wage * 5;
        W.removeSoldier(s.id);
        walked++;
      }
      if (walked) W.log("could not pay. " + walked + " men walked away in the night.", "bad");
      else W.log("could not pay, and every man stayed. they will not stay twice.", "bad");
    }
    W.emit("dawn", S.day);
    W.emit("gold", S.gold);
  };

  /* ============================================================ THE ARMY
     Adding and removing a man is a function, not an array splice at the call
     site, because six places do it and every one of them also has to keep the
     baggage honest: a man who leaves drops his gun into your cart, he does not
     take it with him. */
  W.addSoldier = function (s) {
    S.army.push(s);
    W.emit("army", S.army.length);
    return s;
  };
  W.removeSoldier = function (id, keepKit) {
    for (let i = 0; i < S.army.length; i++) {
      if (S.army[i].id !== id) continue;
      const s = S.army.splice(i, 1)[0];
      if (keepKit !== false) {
        if (s.wid && s.wid !== "fists") W.stash(s.wid, 1);
        if (s.armour && s.armour !== "none") W.stashArmour(s.armour, 1);
      }
      W.emit("army", S.army.length);
      return s;
    }
    return null;
  };
  W.armySize = function () { return S.army.length + 1; };   // you count

  /* STRENGTH is what the encounter screen shows instead of a unit list, and
     it is the one number the AI compares. It is NOT head count: forty levies
     with pistols must read as weaker than fifteen veterans with rifles, or
     "should I fight this" has no honest answer. */
  W.soldierPower = function (s) {
    const T = W.tier(s.tier);
    const w = W.gun(s.wid);
    const gp = w ? W.gunCombat(s.wid) : 0.3;   // bare hands, not a cheap gun
    const ar = 1 + W.armour(s.armour).soak / 46;
    const wound = s.wounded ? 0.62 : 1;
    return T.acc * (T.hp / 100) * gp * ar * wound * 10;
  };
  W.power = function (list) {
    let n = 0;
    for (let i = 0; i < list.length; i++) n += W.soldierPower(list[i]);
    return n;
  };
  W.yourPower = function () {
    const you = S.you;
    const w = W.gun(you.wid);
    const gp = w ? W.gunCombat(you.wid) : 0.3;
    /* YOU ARE WORTH ABOUT TWELVE MEN, and that is a design statement rather
       than a measurement: it has to be enough that a lone warlord can take a
       six-man bandit crew on day one (or there is no first step), and small
       enough that by fifty men you have stopped mattering personally and the
       game has become about the army. */
    return W.power(S.army) + 14 * gp * (1 + W.armour(you.armour).soak / 46);
  };

  /* ============================================================ BAGGAGE */
  W.stash = function (wid, n) {
    if (!wid || wid === "fists") return;
    S.baggage[wid] = (S.baggage[wid] || 0) + (n == null ? 1 : n);
    W.emit("baggage", S.baggage);
  };
  W.unstash = function (wid, n) {
    n = n == null ? 1 : n;
    if ((S.baggage[wid] || 0) < n) return false;
    S.baggage[wid] -= n;
    if (S.baggage[wid] <= 0) delete S.baggage[wid];
    W.emit("baggage", S.baggage);
    return true;
  };
  W.stashArmour = function (id, n) {
    if (!id || id === "none") return;
    S.armourBag[id] = (S.armourBag[id] || 0) + (n == null ? 1 : n);
    W.emit("baggage", S.armourBag);
  };
  W.unstashArmour = function (id, n) {
    n = n == null ? 1 : n;
    if ((S.armourBag[id] || 0) < n) return false;
    S.armourBag[id] -= n;
    if (S.armourBag[id] <= 0) delete S.armourBag[id];
    W.emit("baggage", S.armourBag);
    return true;
  };
  /* EQUIP is a swap, never a give: the gun he was holding goes back in the
     cart in the same call. Two of the three loadout bugs in the first draft
     were a give without the matching take. */
  W.equip = function (soldier, wid) {
    if (!soldier || !wid) return false;
    if (wid === soldier.wid) return true;
    if (wid !== "fists" && !W.unstash(wid, 1)) return false;
    if (soldier.wid && soldier.wid !== "fists") W.stash(soldier.wid, 1);
    soldier.wid = wid;
    W.emit("army", S.army.length);
    return true;
  };
  W.equipArmour = function (soldier, id) {
    if (!soldier || !id) return false;
    if (id === soldier.armour) return true;
    if (id !== "none" && !W.unstashArmour(id, 1)) return false;
    if (soldier.armour && soldier.armour !== "none") W.stashArmour(soldier.armour, 1);
    soldier.armour = id;
    W.emit("army", S.army.length);
    return true;
  };

  /* ============================================================ THE BANDS
     A WARBAND IS A PARTY ON THE MAP. Its roster is real — the same soldier
     objects, generated up front — because a battle has to put those exact men
     on the sand and the surrender screen has to hand you those exact men.
     "A number that becomes soldiers when you click it" is how you get a band
     of 40 that fields 37 and captures 44. */
  const FACTIONS = W.FACTIONS = [
    { id: "bandit",  label: "SAND BANDITS",   colour: 0xc4593a, hostile: 1.0,  tiers: ["levy", "levy", "raider"] },
    { id: "militia", label: "OASIS MILITIA",  colour: 0x4a8f5a, hostile: 0.55, tiers: ["levy", "raider", "soldier"] },
    { id: "company", label: "FREE COMPANY",   colour: 0x3f7fb8, hostile: 0.7,  tiers: ["raider", "soldier", "soldier"] },
    { id: "legion",  label: "DESERT LEGION",  colour: 0xb9a13f, hostile: 0.85, tiers: ["soldier", "soldier", "veteran"] },
    { id: "warlord", label: "RIVAL WARLORD",  colour: 0x8f4fb8, hostile: 0.95, tiers: ["raider", "soldier", "veteran"] },
  ];
  W.faction = function (id) {
    for (let i = 0; i < FACTIONS.length; i++) if (FACTIONS[i].id === id) return FACTIONS[i];
    return FACTIONS[0];
  };

  /* THE GUN A BAND CARRIES scales with the band, deliberately: a six-man
     bandit crew with rocket launchers is not a difficulty curve, it is a
     joke. Wealth = how far up the price list this band can reach. */
  /* AND THE FIRST DRAFT OF THIS HANDED OUT GRENADE LAUNCHERS. It took the
     price-sorted list, cut it at `wealth`, and rolled inside the cut — which
     was survivable while the armoury spanned 16× and became a disaster the
     moment the price model was fixed and it spanned 46×. A rich band's cut
     now reaches the top of the list, so hundred-man legions fielded launchers,
     nothing could beat them, and tools/warlord-check.mjs's headless campaigns
     collapsed 83% of the time. That is one number in one function deciding
     whether the whole game is winnable.

     RARITY IS NOT WEALTH. A launcher is rare because there are barely any on
     the island, not because nobody can afford one — that is exactly what
     gunRarity already says, and the depots already obey it. So a band rolls
     the same way a crate does: reachability sets the SHELF (what this band
     could plausibly own) and rarity sets the ODDS on that shelf. A rich band
     ends up with better rifles and, once in a long while, one rocket. */
  /* WHAT A BAND WOULD ACTUALLY CARRY INTO A FIGHT. The rarity roll put a
     TASER in one man in eight at every band size, because the taser is cheap
     and therefore common — and common is the right answer for a crate at a
     depot and the wrong one for a firing line. Nobody arms a warband with
     tasers; you buy one when you want somebody alive. It is a tool, and the
     campaign has to be able to say so. The filter is by role rather than by
     id list so a non-lethal added later drops out of armies for free. */
  W.battleGuns = function () {
    return W.gunList().filter(function (w) {
      return !(w.id === "taser" || w.nonlethal || w.slot === "utility");
    });
  };

  W.bandGunFor = function (wealth, r) {
    const guns = W.battleGuns().slice().sort(function (a, b) { return W.gunPrice(a.id) - W.gunPrice(b.id); });
    if (!guns.length) return "sidearm";
    const rr = r == null ? RND() : r;
    /* A BAND SHOPS AROUND A PRICE POINT, it does not shop below a ceiling.
       The ceiling version (draft two) made every rich band uniform across the
       whole armoury — a 300-man legion was as likely to be carrying a .357 as
       an AK, which reads as a costume department rather than an army. A
       Gaussian centred on what this band can afford gives the picture the
       player needs at a glance: bandits with pistols, legions with rifles,
       and a rocket somewhere in the line often enough to be frightening and
       rarely enough to be news.

       The centre stops at 0.72 of the list rather than 1.0 on purpose: the
       top of this armoury is launchers, and a band whose CENTRE is a launcher
       is not a difficulty curve. Rarity is applied at ^2.2 rather than raw
       because the raw curve left a rocket at a quarter the odds of a rifle,
       and one band in four carrying one is not rare. */
    const centre = clamp(wealth, 0, 1) * 0.72;
    const sigma = 0.3;
    let total = 0;
    const wts = guns.map(function (g, i) {
      const pos = guns.length > 1 ? i / (guns.length - 1) : 0;
      const d = pos - centre;
      const w = Math.pow(W.gunRarity(g.id), 2.2) * Math.exp(-(d * d) / (2 * sigma * sigma));
      total += w;
      return w;
    });
    if (total <= 0) return guns[0].id;
    let t = rr * total;
    for (let i = 0; i < guns.length; i++) { t -= wts[i]; if (t <= 0) return guns[i].id; }
    return guns[0].id;
  };

  /* HOW BIG IS A PARTY ON THIS ISLAND, and it is the single most important
     number in the campaign — more important than any weapon stat, because it
     decides whether a man alone on day one has anything at all he can fight.

     THE FIRST DRAFT WAS `irange(3, 40)`, a flat roll with a median of 21.
     Measured over two hundred headless campaigns in tools/warlord-check.mjs:
     the greedy warlord SKIPPED 77% OF DAYS because nothing on the island was
     his size, made nine gold a day, and 75% of runs collapsed. The island was
     not too hard — it was too UNIFORM. A game that starts you alone needs a
     floor of things a lone man beats, and a ceiling he can see and cannot
     touch for a month.

     So the roll is four named bands rather than one curve, because the four
     names are the actual design and a curve would hide it:

       CREW      2–9    looters, deserters, a family with rifles. Day one.
       BAND     10–40   the working population of the island.
       COMPANY  40–120  a real force. You need an army to take one.
       ARMY    120–320  three or four exist. They are the endgame.

     Published so campaign.js's spawner and this file's own default agree —
     two different party-size distributions in one game is how the encounter
     screen and the world map start disagreeing about how dangerous the map
     is. `?bands=flat` restores the old roll for a measured comparison. */
  W.BAND_CLASSES = [
    { id: "crew",    w: 0.56, lo: 2,   hi: 9 },
    { id: "band",    w: 0.27, lo: 10,  hi: 40 },
    { id: "company", w: 0.13, lo: 40,  hi: 120 },
    { id: "army",    w: 0.04, lo: 120, hi: 320 },
  ];
  W.rollBandSize = function (r) {
    const rr = r == null ? RND() : r;
    let t = rr;
    for (let i = 0; i < W.BAND_CLASSES.length; i++) {
      const c = W.BAND_CLASSES[i];
      if (t < c.w || i === W.BAND_CLASSES.length - 1) {
        return c.lo + Math.floor(RND() * (c.hi - c.lo + 1));
      }
      t -= c.w;
    }
    return 6;
  };
  W.bandClassOf = function (n) {
    for (let i = W.BAND_CLASSES.length - 1; i >= 0; i--) {
      if (n >= W.BAND_CLASSES[i].lo) return W.BAND_CLASSES[i].id;
    }
    return "crew";
  };

  W.makeBand = function (opts) {
    opts = opts || {};
    const F = W.faction(opts.faction || W.pick(FACTIONS).id);
    const n = Math.max(1, opts.size == null ? W.rollBandSize() : opts.size);
    /* WEALTH RIDES WITH SIZE, because a party that big got that big by
       winning, and a party that won has better guns. It is the only
       difficulty curve on the island and it needs no level number. */
    const wealth = clamp(0.16 + n / 130 + W.rnd() * 0.18, 0.12, 1);
    const men = [];
    for (let i = 0; i < n; i++) {
      const tid = F.tiers[Math.floor(Math.pow(W.rnd(), 1.5) * F.tiers.length) % F.tiers.length];
      const s = W.makeSoldier(tid, W.bandGunFor(wealth));
      if (W.chance(clamp(wealth - 0.3, 0, 0.55))) s.armour = W.chance(0.7) ? "vest" : "plate";
      men.push(s);
    }
    return {
      id: opts.id == null ? "b" + W.nextId() : opts.id,
      faction: F.id,
      name: opts.name || F.label,
      colour: F.colour,
      x: opts.x || 0, z: opts.z || 0,
      men: men,
      gold: Math.round(n * W.range(6, 26) * (0.5 + wealth)),
      goal: null,               // campaign.js writes this: {x,z} it is walking to
      mood: "roam",             // roam | hunt | flee | camp
      cooldown: 0,              // seconds before it will engage you again
      wealth: wealth,
    };
  };
  W.bandSize = function (b) { return b.men.length; };
  W.bandPower = function (b) { return W.power(b.men); };

  /* WHAT A BATTLEFIELD IS WORTH, and it is the answer to the question the
     headless campaigns kept failing: where does the money come from?

     The first economy model had loot = the band's purse, and measured over
     120 days that is NINE GOLD A DAY against a levy costing 22 — an economy
     with no economy in it. The purse was never the prize. THE GUNS ARE. A
     beaten company of forty leaves forty rifles on the sand, and at a depot's
     third-of-list buy price that is real money, or — better — it is forty
     rifles you hand to your own levies instead of selling.

     That is also why this returns the guns as an INVENTORY rather than a
     number. A warlord who sells his loot and a warlord who arms his men with
     it are playing differently, and the game only has that decision in it if
     the loot arrives as objects. `salvage` is the fraction that survives the
     fight: a rifle its owner was shot off is often a rifle with a hole in it,
     and a hundred-percent recovery rate makes the first big win end the game. */
  W.SALVAGE = 0.62;
  W.spoils = function (fallen, salvage) {
    const rate = salvage == null ? W.SALVAGE : salvage;
    const guns = {}, armour = {};
    let cash = 0;
    for (let i = 0; i < fallen.length; i++) {
      const m = fallen[i];
      if (m.wid && m.wid !== "fists" && W.rnd() < rate) guns[m.wid] = (guns[m.wid] || 0) + 1;
      if (m.armour && m.armour !== "none" && W.rnd() < rate * 0.8) armour[m.armour] = (armour[m.armour] || 0) + 1;
      cash += W.irange(0, 6);            // whatever was in his pockets
    }
    return { guns: guns, armour: armour, cash: cash };
  };
  W.spoilsValue = function (sp) {
    let v = sp.cash || 0;
    Object.keys(sp.guns || {}).forEach(function (k) { v += W.gunSell(k) * sp.guns[k]; });
    Object.keys(sp.armour || {}).forEach(function (k) { v += W.armourSell(k) * sp.armour[k]; });
    return v;
  };
  W.takeSpoils = function (sp) {
    Object.keys(sp.guns || {}).forEach(function (k) { W.stash(k, sp.guns[k]); });
    Object.keys(sp.armour || {}).forEach(function (k) { W.stashArmour(k, sp.armour[k]); });
    if (sp.cash) W.earn(sp.cash);
  };

  /* THE ODDS the encounter screen prints. Power ratio bent through a soft
     curve, because a 2:1 advantage is not a 100% win and printing 100% is a
     lie the player will catch exactly once. */
  W.odds = function (mine, theirs) {
    const r = mine / Math.max(0.001, mine + theirs);
    return clamp(Math.pow(r, 1.6) / (Math.pow(r, 1.6) + Math.pow(1 - r, 1.6)), 0.01, 0.99);
  };

  /* WILL THEY GIVE UP? The demand-surrender roll. Outnumbered badly, already
     bloodied, and cheap troops — all three push toward yes. A legion of
     veterans at full strength never surrenders to anybody, which is what
     makes taking one apart worth doing. */
  W.surrenderChance = function (b, myPower) {
    const theirs = W.bandPower(b);
    const ratio = myPower / Math.max(0.001, theirs);
    let p = clamp((ratio - 1.15) * 0.42, 0, 0.8);
    const F = W.faction(b.faction);
    p *= (1.25 - F.hostile * 0.55);
    let soft = 0;
    for (let i = 0; i < b.men.length; i++) soft += (3 - W.tierIndex(b.men[i].tier)) / 3;
    p *= 0.55 + 0.6 * (soft / Math.max(1, b.men.length));
    p += clamp(S.fame / 900, 0, 0.16);         // a reputation does work for you
    return clamp(p, 0, 0.93);
  };

  /* ============================================================ PHASE
     WHO OWNS THE SCREEN. Exactly one module at a time, and the transition is
     a function so that a module can never leave its own DOM up behind the
     next one — the single ugliest class of bug in a game made of screens. */
  const PHASES = ["boot", "menu", "campaign", "encounter", "battle", "aftermath", "outpost", "armoury", "over"];
  W.phase = function () { return S.phase; };
  W.setPhase = function (p, data) {
    if (PHASES.indexOf(p) < 0) { console.warn("[warlord] unknown phase", p); return; }
    if (p === S.phase) return;
    const from = S.phase;
    S.phase = p;
    W.emit("phase:leave:" + from, p);
    W.emit("phase", { from: from, to: p, data: data });
    W.emit("phase:" + p, data);
  };

  /* ============================================================ VOICE
     The log is the game's memory and the toast is its voice. Both are here
     rather than in a HUD file because the battle, the campaign and the
     network all need to say things and none of them should own the widget. */
  W.log = function (text, kind) {
    const row = { day: S.day, text: String(text), kind: kind || "" };
    S.log.push(row);
    if (S.log.length > 220) S.log.shift();
    W.emit("log", row);
    return row;
  };
  W.toast = function (text, kind) { W.emit("toast", { text: String(text), kind: kind || "" }); };

  /* ============================================================ NEW GAME */
  W.newGame = function (opts) {
    opts = opts || {};
    S.seed = opts.seed == null ? (Math.random() * 0x7fffffff) | 0 : (opts.seed | 0);
    RND = mulberry(S.seed);
    UID = 1;
    S.mode = opts.mode || "solo";
    S.day = 1; S.hour = 7;
    S.gold = opts.gold == null ? 40 : opts.gold;
    S.fame = 0;
    S.army.length = 0;
    S.prisoners.length = 0;
    S.bands.length = 0;
    S.outposts.length = 0;
    S.log.length = 0;
    S.baggage = {}; S.armourBag = {};
    S.peers = {};
    S.stats = { battles: 0, won: 0, killed: 0, lost: 0, recruited: 0, conscripted: 0, executed: 0 };
    S.flags = {};
    S.you = {
      name: opts.name || "WARLORD",
      x: 0, z: 0, yaw: 0,
      wid: opts.wid || "sidearm",
      armour: "none",
      hp: 140, maxHp: 140,
      kills: 0,
    };
    /* YOU START ALONE. That is the pitch and it is one line of code; every
       temptation to "just give them three men so the first fight is fun" is
       the thing that makes the first hire mean nothing. */
    W.log("you ride out alone with a pistol and $" + S.gold + ".");
    W.emit("newgame", S);
    return S;
  };

  /* ============================================================ SAVE
     The state is already one plain object, so the save is JSON and the load
     is an assign. Bands carry their rosters, which makes a save file a few
     hundred KB at a thousand men — cheap, and worth it: a save that loses
     the exact men on the map is a save that changes the game when you load. */
  const KEY = "cbz-warlord";
  W.save = function () {
    try {
      localStorage.setItem(KEY, JSON.stringify({ v: W.VERSION, uid: UID, s: S }));
      return true;
    } catch (e) { return false; }
  };
  W.load = function () {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return false;
      const j = JSON.parse(raw);
      if (!j || j.v !== W.VERSION || !j.s) return false;
      Object.keys(j.s).forEach(function (k) { S[k] = j.s[k]; });
      UID = j.uid || 1;
      RND = mulberry(S.seed || 1);
      W.emit("loaded", S);
      return true;
    } catch (e) { return false; }
  };
  W.hasSave = function () { try { return !!localStorage.getItem(KEY); } catch (e) { return false; } };
  W.wipe = function () { try { localStorage.removeItem(KEY); } catch (e) {} };

  /* ============================================================ MODULES
     Each face of the game registers itself and declares what it needs built
     before it can run. boot() walks them in dependency order once, so the
     page shell does not carry a hand-written call list that rots the moment
     a module is added. */
  const MODULES = {};
  W.module = function (name, api) { MODULES[name] = api; W[name] = api; return api; };
  W.modules = function () { return MODULES; };
  W.bootModules = function (ctx) {
    const done = {};
    const order = [];
    function visit(name, stack) {
      if (done[name]) return;
      const m = MODULES[name];
      if (!m) return;
      if (stack.indexOf(name) >= 0) { console.warn("[warlord] module cycle at", name); return; }
      const deps = m.needs || [];
      for (let i = 0; i < deps.length; i++) visit(deps[i], stack.concat(name));
      done[name] = true;
      order.push(name);
    }
    Object.keys(MODULES).forEach(function (n) { visit(n, []); });
    for (let i = 0; i < order.length; i++) {
      const m = MODULES[order[i]];
      if (m && typeof m.boot === "function") {
        try { m.boot(ctx); } catch (e) { console.error("[warlord] boot", order[i], e); }
      }
    }
    return order;
  };

  /* ============================================================ AUDIT
     One call that says whether the four faces actually arrived, because a
     missing module on this page fails SILENTLY — the phase changes and
     nothing draws. Printed by the page on ?audit=1 and read by the tools. */
  W.audit = function () {
    const want = ["desert", "campaign", "army", "battle", "outpost", "loadout"];
    const out = { ok: true, missing: [], present: [], army: S.army.length, bands: S.bands.length,
                  outposts: S.outposts.length, phase: S.phase, gold: S.gold, day: S.day };
    for (let i = 0; i < want.length; i++) {
      if (MODULES[want[i]]) out.present.push(want[i]);
      else { out.missing.push(want[i]); out.ok = false; }
    }
    return out;
  };

  if (typeof module !== "undefined" && module.exports) module.exports = W;
})();
