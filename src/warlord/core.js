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

  /* WHAT A GUN IS WORTH. dps × reach, bent so the curve is money-shaped:
     a pistol is pocket change, a rifle is a real decision, a launcher is a
     week of raiding. Explosives carry a hard premium because one of them
     changes a battle and no amount of dps says that. */
  W.gunPrice = function (id) {
    const w = W.gun(id);
    if (!w) return 40;
    const rate = 1 / Math.max(0.03, w.fireDelay || w.interval || 0.5);
    const dmg = (w.damage || 20) * (w.pellets || 1);
    const dps = dmg * Math.min(rate, 14);
    const reach = Math.min(1.9, 0.55 + (w.range || 60) / 130);
    let p = Math.pow(dps * reach, 0.86) * 1.35;
    if (w.explosive) p *= 3.4;
    if (w.id === "taser") p = 70;
    return Math.max(18, Math.round(p / 5) * 5);
  };
  // a depot pays a third of list for your surplus — the spread IS the sink
  W.gunSell = function (id) { return Math.max(5, Math.round(W.gunPrice(id) * 0.34 / 5) * 5); };
  W.armourPrice = function (id) { return W.armour(id).price; };
  W.armourSell = function (id) { return Math.max(0, Math.round(W.armour(id).price * 0.34 / 5) * 5); };

  /* RARITY drives what a depot has in the crates. Cheap guns are everywhere;
     a launcher shows up at one outpost in six. Derived from price so it, too,
     never needs an edit. */
  W.gunRarity = function (id) {
    const p = W.gunPrice(id);
    return clamp(1 - Math.pow(p / 900, 0.7), 0.04, 0.96);
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
         somewhere to be and a levy has a farm. Losing the cheap men first
         is also the merciful failure mode — the army shrinks, it does not
         evaporate. */
      const short = due - S.gold;
      S.gold = 0;
      let walked = 0;
      const order = S.army.slice().sort(function (a, b) { return W.tierIndex(a.tier) - W.tierIndex(b.tier); });
      let owed = short;
      while (owed > 0 && order.length) {
        const s = order.shift();
        owed -= W.tier(s.tier).wage * 3;
        W.removeSoldier(s.id);
        walked++;
      }
      if (walked) W.log("could not pay. " + walked + " men walked away in the night.", "bad");
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
    const gp = w ? Math.min(3.2, 0.5 + W.gunPrice(s.wid) / 210) : 0.35;
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
    const gp = w ? Math.min(3.2, 0.5 + W.gunPrice(you.wid) / 210) : 0.35;
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
  W.bandGunFor = function (wealth, r) {
    const guns = W.gunList().slice().sort(function (a, b) { return W.gunPrice(a.id) - W.gunPrice(b.id); });
    if (!guns.length) return "sidearm";
    const top = clamp(Math.floor(guns.length * wealth), 1, guns.length);
    const i = Math.floor(Math.pow(r == null ? RND() : r, 1.4) * top);
    return guns[clamp(i, 0, top - 1)].id;
  };

  W.makeBand = function (opts) {
    opts = opts || {};
    const F = W.faction(opts.faction || W.pick(FACTIONS).id);
    const n = Math.max(1, opts.size == null ? W.irange(3, 40) : opts.size);
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
