/* ============================================================
   systems/economy.js — cigarettes (the currency), an inventory of
   contraband items, and the four social actions every actor shares:
   TALK · TRADE · BRIBE · STEAL.

   Other modules call CBZ.econ.<action>(actor) from the interaction
   menu. Each returns a short result string for the toast/feedback.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const g = CBZ.game;

  /* ==========================================================================
     PRISON_PHONE_BRIDGE — WHAT CIGARETTES CANNOT BUY

     Cigarettes are this game's one currency and they stay that way. But a
     corrections officer does not end his career for tobacco. Every real staff
     corruption case runs the same way: the inmate's PEOPLE pay the officer's
     PEOPLE — a payment app, cash to a wife, a money order to a sister — and
     the yard currency only ever buys the bottom rung: a moment of blindness, a
     soft count, a look the other way. Those stay priced in smokes (bribe()).

     So the split this flag draws is not a second wallet. It is a CAPABILITY:
     the deep services — burying paperwork, buying a racket's protection,
     killing a statement, buying a name off the log — require that you can
     REACH THE STREET at all. That is the Burner Phone, an item the game
     already sells, already rolls onto dealers and bent officers, and never
     had a job. Now it has the only job worth having.

     The cigarettes still leave your pocket at the same magnitude. They stand
     for what your people sent his people; the officer says so out loud the
     first time, once, and then the game shuts up about it.

     ?cfg_PRISON_PHONE_BRIDGE=0 → exactly the behaviour that shipped: cigs buy
     everything, no rental, no gate, and the strings below revert to theirs.
     ========================================================================== */
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.PRISON_PHONE_BRIDGE == null) CBZ.CONFIG.PRISON_PHONE_BRIDGE = true;
  function phoneBridge() { return !CBZ.CONFIG || CBZ.CONFIG.PRISON_PHONE_BRIDGE !== false; }

  // contraband you can buy / sell / LOOT. value = cigarettes.
  // `tag` groups stock (goods/drugs are shop pools; valuables/tools are
  // loot-only). `rarity` drives loot odds + the pickup flourish.
  const ITEMS = {
    // --- goods (shop stock + common loot) ---
    Lighter:           { value: 4,  tag: "goods",     rarity: "common" },
    Soap:              { value: 3,  tag: "goods",     rarity: "common" },
    "Razor Blade":     { value: 6,  tag: "goods",     rarity: "common" },
    "Phone Charger":   { value: 4,  tag: "goods",     rarity: "common" },
    Shiv:              { value: 12, tag: "goods",     rarity: "uncommon" },
    "Brass Knuckles":  { value: 16, tag: "goods",     rarity: "uncommon" },
    "Energy Bar":      { value: 5,  tag: "goods",     rarity: "common" },
    "Energy Drink":    { value: 6,  tag: "goods",     rarity: "common" },
    "Burner Phone":    { value: 18, tag: "goods",     rarity: "uncommon" },
    "Burner SIM":      { value: 10, tag: "goods",     rarity: "common" },
    "Tattoo Gun":      { value: 14, tag: "goods",     rarity: "uncommon" },
    "Cigarette Carton":{ value: 22, tag: "goods",     rarity: "uncommon" },
    Ramen:             { value: 30, tag: "goods",     rarity: "rare" }, // top-shelf prison currency
    /* --- services (bought, never carried) ---------------------------------
       A REAL PHONE IS RENTED IN SHIFTS. Owning one outright is rare and worth
       18; ten minutes on somebody else's is what most men in a yard actually
       buy, which is why this row is a SERVICE and not an item: nothing lands
       in your bag, a WINDOW opens (g.phoneTimeT) and one deep transaction
       spends it. `tag:"service"` keeps it out of SELLABLE/DRUGS/VALUABLES, so
       no loot table, no gift roll and no drop can ever mint it — pickOffer()
       below is the only door it comes through. */
    "Phone Time":      { value: 8,  tag: "service",   rarity: "common", service: true },
    // --- drugs (dealer stock + loot) ---
    Pills:             { value: 14, tag: "drugs",     rarity: "uncommon" },
    Powder:            { value: 22, tag: "drugs",     rarity: "rare" },
    "Pruno Hooch":     { value: 9,  tag: "drugs",     rarity: "common" },
    Painkillers:       { value: 12, tag: "drugs",     rarity: "uncommon" },
    // --- tools (escape / utility loot) ---
    Lockpick:          { value: 15, tag: "tools",     rarity: "uncommon" },
    "Handcuff Key":    { value: 20, tag: "tools",     rarity: "uncommon" },
    "Bedsheet Rope":   { value: 8,  tag: "tools",     rarity: "common" },
    "Hacksaw Blade":   { value: 26, tag: "tools",     rarity: "rare" },
    "Contraband Map":  { value: 18, tag: "tools",     rarity: "uncommon" },
    // --- valuables (loot you fence for cigs) ---
    "Stolen Wallet":   { value: 12, tag: "valuables", rarity: "uncommon" },
    "Cash Roll":       { value: 35, tag: "valuables", rarity: "rare" },
    "Gold Tooth":      { value: 28, tag: "valuables", rarity: "rare" },
    "Gold Chain":      { value: 55, tag: "valuables", rarity: "epic" },
    "Luxury Watch":    { value: 70, tag: "valuables", rarity: "epic" },
    // --- duty kit: what a screw is ACTUALLY wearing ---
    // A guard's pockets used to be a lucky dip of handcuff keys and gold teeth.
    // These three are the things every one of them carries every shift, so a
    // lift takes something REAL off the man — and each has a consequence you
    // can see: the baton arms you, the torch goes dark on his side of the yard
    // (entities/guards.js reads `flashlightLost`), the card opens the door his
    // post is there to hold.
    Baton:             { value: 12, tag: "duty",      rarity: "uncommon" },
    "Guard Torch":     { value: 10, tag: "duty",      rarity: "common" },
    // --- keys / weapon ---
    // The KEYCARD is the yard door. entities/keycard.js lies one on a duty
    // desk; this row is the same card on the belt of the officer whose post
    // is that door — an answer you take off a person instead of a table.
    Keycard:           { value: 45, tag: "key",       rarity: "rare" },
    // THE CELL KEY EXISTS BECAUSE THE CELL LOCKS. systems/prisonschedule.js
    // racks the wing shut at 21:00 and kills the lights at 22:00; the brass on
    // a screw's belt is the only thing that opens your own door from the
    // inside during those hours (walk into the door holding one — no prompt).
    // Worth less than the gun-room key because it buys you a NIGHT, not a room.
    "Cell Key":        { value: 25, tag: "key",       rarity: "uncommon" },
    "Gun-Room Key":    { value: 40, tag: "key",       rarity: "rare" },
    Gun:               { value: 50, tag: "key",       rarity: "epic" },
    // --- B7: catalog parity with city/economy.js's harvest-node resources +
    // tools (systems/resources.js is CITY-only — no gather nodes in the
    // yard/disaster arena — so these entries exist just to keep the two item
    // stores in sync; no shop/loot table references them here). ---
    Wood:              { value: 2,  tag: "resource",  rarity: "common" },
    Stone:             { value: 3,  tag: "resource",  rarity: "common" },
    Scrap:             { value: 4,  tag: "resource",  rarity: "common" },
    Hatchet:           { value: 40, tag: "tools",     rarity: "uncommon" },
    Pickaxe:           { value: 45, tag: "tools",     rarity: "uncommon" },
  };
  const SELLABLE = Object.keys(ITEMS).filter((k) => ITEMS[k].tag === "goods");
  const DRUGS = Object.keys(ITEMS).filter((k) => ITEMS[k].tag === "drugs");
  const VALUABLES = Object.keys(ITEMS).filter((k) => ITEMS[k].tag === "valuables");
  const SERVICES = Object.keys(ITEMS).filter((k) => ITEMS[k].tag === "service");
  function isService(name) { return !!(ITEMS[name] && ITEMS[name].service); }

  // pick a fresh offer from a given stock pool ("goods" | "drugs" | "fenced")
  function pickOffer(pool) {
    let list = SELLABLE;
    if (pool === "drugs") list = DRUGS;
    /* THE TWO MEN WITH AN OUTSIDE LINE SELL MINUTES ON IT. A dealer's whole
       trade already runs through a phone and a fence's does too — they are the
       people a yard rents a handset from. The old-timer's goods stall does
       not: he sells things you can hold. Guarded by the flag FIRST so that
       with PRISON_PHONE_BRIDGE off this branch never even draws from rng()
       and the stock stream is bit-for-bit what it always was. */
    if (phoneBridge() && SERVICES.length && (pool === "drugs" || pool === "fenced") && rng() < 0.18) list = SERVICES;
    const item = list[Math.floor(rng() * list.length)];
    const base = ITEMS[item].value;
    const markup = pool === "fenced" ? -2 : Math.floor(rng() * 4); // thieves fence cheap
    const price = Math.max(2, base + markup);
    return { item, price, basePrice: price };
  }

  // seeded PRNG, but reseeded from Math.random each run so the prison
  // doesn't play out identically every load (no more same dead bodies).
  let _seed = (Math.floor(Math.random() * 2e9) | 1) & 0x7fffffff;
  function rng() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }
  function reseed() { _seed = (Math.floor(Math.random() * 2e9) | 1) & 0x7fffffff; }

  function addCigs(n) { g.cigs = Math.max(0, g.cigs + n); CBZ.el.cigText.textContent = g.cigs; }
  /* ---- THE BAG IS ALSO A WEAPON RACK, FOR EXACTLY ONE ITEM ----------------
     A Shiv is the only thing in this table that is both loot and a weapon the
     player can draw (weapons/weapon-data.js `id:"shank"`). addItem/takeItem are
     the ONE choke point every acquisition and every loss in the prison passes
     through — the floor pickup, the frisk, the trade, the reception
     confiscation, the shop — so hooking the weapon row here means there is no
     second place that has to remember. hasItem stays the truth; the weapon rail
     is just told about it.

     Deliberately NOT `select:true`: finding a shiv in a drawer should not rip
     the gun out of your hands mid-fight. It appears on the rail and you choose. */
  function syncShankWeapon() {
    if (CBZ.CONFIG && CBZ.CONFIG.PRISON_SHANK === false) return;
    if (!CBZ.unlockWeapon || !CBZ.lockWeapon) return;
    const owns = (g.inventory.Shiv || 0) > 0 || (g.inventory.Shank || 0) > 0;
    if (owns) { if (!(CBZ.hasWeapon && CBZ.hasWeapon("shank"))) CBZ.unlockWeapon("shank", { select: false }); }
    else if (CBZ.hasWeapon && CBZ.hasWeapon("shank")) CBZ.lockWeapon("shank");
  }

  function addItem(name, n) {
    n = n || 1;
    g.inventory[name] = (g.inventory[name] || 0) + n;
    if (name === "Shiv" || name === "Shank") syncShankWeapon();
    CBZ.refreshInventory && CBZ.refreshInventory();
  }
  function hasItem(name) { return (g.inventory[name] || 0) > 0; }
  function takeItem(name) {
    if (hasItem(name)) {
      g.inventory[name]--;
      if (name === "Shiv" || name === "Shank") syncShankWeapon();
      CBZ.refreshInventory && CBZ.refreshInventory();
      return true;
    }
    return false;
  }
  CBZ.prisonSyncShank = syncShankWeapon;
  function nm(a) {
    const name = a && a.data && a.data.name ? a.data.name : "someone";
    return name.replace(/^the |^a |^an /, "");
  }
  function clamp100(v) { return Math.max(0, Math.min(100, v)); }

  /* ==========================================================================
     ONE CEILING ON THE TAB (defect fix, 2026-08-25)

     `g.racketDebt` is what you owe the bent staff. It had NINE writers across
     three files and SIX different ceilings: a trade capped it at 60, a bribe
     at 65, a lifted pocket at 70, a beating at 80, every writer in
     entities/guards.js at 40, and entities/ai.js at 50 and 60. The number a
     player could reach therefore depended on which verb happened to push it
     there — beat a bent officer to 80 and no guard-side writer could ever
     touch it again, because every one of them clamps with Math.min(40, ...)
     and Math.min never lowers anything: the tab silently FROZE at whatever
     the loosest writer had left behind.

     One function, one ceiling, and it is the only thing that may write the
     field. Published as CBZ.addRacketDebt as well, because entities/ai.js
     still owns nine more writers of its own — the inmate side of the same tab
     (crewDues / stickUp / racketCover / alibiDeal and friends) — which want
     the same ceiling and live in somebody else's file. `grep -n "racketDebt =
     Math" src/entities/ai.js` finds every one; each is a one-line swap.
     ========================================================================== */
  const RACKET_DEBT_CEIL = 60;
  function addRacketDebt(n) {
    g.racketDebt = Math.max(0, Math.min(RACKET_DEBT_CEIL, (g.racketDebt || 0) + (n || 0)));
    return g.racketDebt;
  }
  CBZ.addRacketDebt = addRacketDebt;

  /* ==========================================================================
     WHY THEY ANSWER THE WAY THEY DO — RESPECT · LOYALTY · THE CLOCK

     Every negotiation in this file used to read exactly two things: how many
     cigarettes you were holding and what die came up. Three answers were
     missing, and all three already half-existed somewhere in the repo:

     RESPECT is `a.rep` — the number systems/quests.js has always paid +34 into
     for a finished favor and FRIEND=100 has always cashed for a way out. It is
     NOT a second field. What is new is that the rest of the block now feeds it
     (a gift, a trade honoured, a fight you win in front of them) and spends it
     (prices, whether a favor is even offered, what they will talk about). The
     drip is CAPPED at RESPECT_CEIL: side business earns you standing in here,
     but only doing somebody's dirty work makes you a friend — otherwise the
     befriend ending becomes a shopping trip.

     LOYALTY is what `a.bribed` could never be. `bribed` is a countdown in
     SECONDS of blindness; the owner's ask is a screw who STAYS BOUGHT. So
     loyalty is persistent for the run, bought by bribes and payoffs, and it
     buys exactly one thing worth having: a guard you have paid does not put a
     caught pickpocket on the radio. He tells you off instead. Pick his pocket
     anyway and it goes to zero — you cannot buy a man twice with the hand you
     just had in his belt.

     THE CLOCK is CBZ.prisonSchedule (systems/prisonschedule.js), never a
     second timetable. A screw standing a COUNT is doing arithmetic with his
     eyes on bodies: he will not trade, he will not take money, and he is a
     far worse mark. YARD is when business happens. NIGHT is when the block
     whispers — better lifts, softer prices, and the things nobody says in
     daylight. Every one of these is surfaced as a LINE or a PRICE, never as a
     meter; interact.js's chips read words off socialRead(), not numbers.
     ========================================================================== */
  const RESPECT_CEIL = 45;     // the most side business alone can ever earn
  function respectOf(a) { return a ? Math.max(-50, Math.min(100, a.rep || 0)) : 0; }
  function loyaltyOf(a) { return a ? Math.max(0, Math.min(100, a.loyalty || 0)) : 0; }
  // n>0 is a drip and obeys the ceiling; n<0 always lands (you can always
  // lose standing, and being disliked is not capped by anything).
  /* THE SECURITY LEVEL PRICES THE SOCIAL GAME TOO (systems/prisontiers.js).
     A county farm talks: word gets round, screws take a drink, and standing
     forms fast. A segregation unit is thirty-two strangers who rotate — the
     same favour buys a little over half as much, and a screw there stays
     bought for about a third as long. Only the GAIN is scaled: losing
     standing is never discounted by anybody's classification, which is the
     same asymmetry the ceiling below already states. */
  function tierGain(k) {
    const T = CBZ.prisonTier;
    return T && T.enabled() ? T.knob(k) : 1;
  }
  function addRespect(a, n) {
    if (!a || !n) return 0;
    if (n > 0) n *= tierGain("respectMul");
    const cur = a.rep || 0;
    if (n > 0 && cur >= RESPECT_CEIL) return cur;
    a.rep = n > 0 ? Math.min(RESPECT_CEIL, cur + n) : Math.max(-50, cur + n);
    return a.rep;
  }
  function addLoyalty(a, n) {
    if (!a || !n) return 0;
    if (n > 0) n *= tierGain("loyaltyMul");
    a.loyalty = Math.max(0, Math.min(100, (a.loyalty || 0) + n));
    return a.loyalty;
  }
  function bought(a) { return loyaltyOf(a) >= 35; }

  function sched() {
    const S = CBZ.prisonSchedule;
    return S && S.enabled && S.enabled() ? S : null;
  }
  function blockId() { const S = sched(); return S ? S.id() : ""; }
  // a body count is arithmetic done with the eyes — no business gets done
  function counting() { const b = blockId(); return b === "count" || b === "secure" || b === "wake"; }
  function yardTime() { const b = blockId(); return b === "yard" || b === "work"; }
  function chowTime() { const b = blockId(); return b === "mess" || b === "supper"; }
  function afterDark() { const b = blockId(); return b === "night"; }
  // one number the verbs share: how well business goes at this hour
  function hourMood() {
    if (counting()) return -1;
    if (yardTime()) return 1;
    if (afterDark()) return 1;
    if (chowTime()) return 0.5;
    return 0;
  }

  /* THE POST IS THE SENIORITY. A guard record carries no rank — but it carries
     a PATROL, and in a prison the patrol IS the rank: the man on the sally
     port holds the gate, the man inside the wing holds the wing, and the two
     dozen walking the wire hold nothing but a baton. Derived once from the
     waypoints the roster already authored (entities/guards.js), stamped on the
     actor as `post` + `rank`, and published — PHASE 5's security tiers want a
     seniority axis and this is it, already true of every guard in the game.
       3 warden  · 2 gate/wing/admin (carries a keycard) · 1 yard · 1 bent      */
  function guardPost(a) {
    if (!a) return { post: "none", rank: 0 };
    if (a.post) return { post: a.post, rank: a.rank || 0 };
    let post = "yard", rank = 1;
    if (a.kind === "warden") { post = "warden"; rank = 3; }
    else {
      const W = CBZ.WORLD;
      const wps = a.waypoints || [];
      let minZ = 1e9, maxZ = -1e9, minX = 1e9, maxX = -1e9, nearExit = 1e9;
      const ex = W && W.exit ? W.exit.x : 0, ez = W && W.exit ? W.exit.z : 128;
      for (let i = 0; i < wps.length; i++) {
        const p = wps[i];
        if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        nearExit = Math.min(nearExit, Math.hypot(p.x - ex, p.z - ez));
      }
      /* THESE TWO LINES READ FIELDS CBZ.WORLD DOES NOT HAVE (fixed phase 5).
         config.js:117 authors every rectangle as x0/x1/z0/z1 — there is no
         `maxZ` on cellBlock and no `minZ` on northYard, so both constants were
         `undefined`, both comparisons below were NaN, and the `wing` and
         `checkpoint` branches could never fire. Measured on the shipped
         roster: ONE rank-2 post in the whole prison (the sally-port gate,
         which is found by distance and was never affected) instead of three.
         The wing officer standing at the head of the tier and the checkpoint
         patrol — the two men this file's own comment calls out by name as the
         reason "the yard door has a second answer that is a PERSON" — both
         read as rank-1 yard screws carrying no card at all. */
      const wingZ = W && W.cellBlock ? W.cellBlock.z1 : -8;
      const yardZ = W && W.northYard ? W.northYard.z0 : -8;
      /* DISTANCE TO THE THING HE IS GUARDING, not a z band. A z band called
         four south-block wire patrols "the sally port" because they happened
         to walk as far down the map as the men who actually stand on it — the
         gate detail is the loop whose waypoints are ON the exit, so measure
         that. Same correction for the checkpoint: it is the SHORT inner loop
         between the wing and the yard, not everything with a low z. */
      if (nearExit <= 16) { post = "gate"; rank = 2; }               // the sally port itself
      else if (maxZ <= wingZ + 1) { post = "wing"; rank = 2; }       // inside the block
      else if (maxX - minX <= 26 && maxZ <= yardZ + 28 && minZ >= yardZ) { post = "checkpoint"; rank = 2; }
      else { post = "yard"; rank = 1; }
    }
    /* BEING BENT IS NOT A DEMOTION — IT IS THE OPPOSITE OF ONE HERE.
       The shipped roster's second bent officer (entities/guards.js marks
       CBZ.guards[3] and [5]) IS the checkpoint patrol: the short inner loop
       between the wing and the yard. He keeps the rank his post carries, so
       the cheapest man in the prison to bribe is also one of the few with a
       card on him — which is the whole game in one guard. `post` records the
       corruption; `rank` records the door he is trusted with. */
    if (a.corrupt) post = "bent";
    a.post = post; a.rank = rank;
    return { post, rank };
  }

  /* socialRead(actor) — the ONE accessor every surface reads instead of doing
     its own arithmetic on rep/love/trust. Words, never numbers: interact.js's
     status chips and the lines below both come from here, so "what the game
     thinks of you" can only ever be said one way. */
  function socialRead(a) {
    if (!a) return { respect: 0, loyalty: 0, standing: "stranger", mood: "", bought: false, busy: false };
    const r = respectOf(a), l = loyaltyOf(a);
    const grudge = a.playerGrudge || 0, trust = a.playerTrust || 0, fear = a.playerFear || 0;
    let standing = "stranger";
    if (r >= 100) standing = "friend";
    else if (r >= 62) standing = "solid";
    else if (r >= 28 || trust >= 6) standing = "known";
    else if (r <= -20 || grudge >= 9) standing = "enemy";
    else if (r < 0 || grudge >= 5) standing = "sour";
    let mood = "";
    if (fear >= 7) mood = "scared";
    else if (grudge >= 6) mood = "angry";
    else if (trust >= 8) mood = "open";
    const guardish = a.kind === "guard" || a.kind === "warden";
    return {
      respect: r, loyalty: l, standing, mood,
      bought: bought(a),
      busy: guardish && counting(),        // mid-count: he is not talking to you
      post: guardish ? guardPost(a).post : "",
      rank: guardish ? guardPost(a).rank : 0,
    };
  }

  function buzz(kind, amount, source) {
    if (!kind || !CBZ.blockRumor) return;
    const r = CBZ.blockRumor();
    r[kind] = clamp100((r[kind] || 0) + (amount || 0));
    if (source) r.last = source;
  }
  function nearbyRead(kind, strength, source, range) {
    if (!kind || strength <= 0 || !CBZ.rememberBlockRead || !CBZ.npcs || !CBZ.player) return;
    range = range || 12;
    const px = CBZ.player.pos.x, pz = CBZ.player.pos.z;
    for (const n of CBZ.npcs) {
      if (!n || !n.group || n.dead || (n.ko || 0) > 0 || n.escaped || n.role === "merchant") continue;
      const d = Math.hypot(n.group.position.x - px, n.group.position.z - pz);
      if (d <= range) {
        const readStrength = strength * (1 - d / (range * 1.7));
        CBZ.rememberBlockRead(n, kind, readStrength, source);
        reactToRead(n, kind, readStrength);
      }
    }
  }
  function hurryApproach(actor, seconds) {
    if (!actor || actor.approach || actor.dead || (actor.ko || 0) > 0 || actor.escaped) return;
    if (actor.aiState === "fight" || actor.aiState === "snitch" || actor.huntPlayer > 0) return;
    actor.approachCD = Math.min(actor.approachCD || seconds, seconds);
  }
  function reactToRead(actor, kind, strength) {
    const p = actor.personality || {};
    const sameCrew = playerSameGang(actor);
    const protectedHere = gangProtected(actor);
    const standing = gangStanding(actor);
    const rivalCrew = CBZ.player && CBZ.player.gang != null && actor.gang >= 0 && actor.gang !== CBZ.player.gang;
    const greedy = (p.greed || 0.5) > 0.48;
    const bold = (p.nerve || 0.5) > 0.36;
    const loyal = (p.loyalty || 0.5) > 0.38;

    if (kind === "wealth" && strength > 8 && (g.cigs || 0) >= 6 && (g.lowProfileT || 0) <= 0) {
      const predator = actor.role === "thief" || actor.role === "dealer" || rivalCrew || (actor.gang >= 0 && !sameCrew && !protectedHere && standing < 8);
      if ((predator || greedy) && bold) {
        actor.playerGrudge = Math.min(14, (actor.playerGrudge || 0) + Math.min(0.45, strength * 0.018));
        hurryApproach(actor, 0.8 + rng() * 2.8);
      } else if ((sameCrew || protectedHere || standing > 24) && loyal) {
        actor.playerTrust = Math.min(14, (actor.playerTrust || 0) + Math.min(0.35, strength * 0.014));
        hurryApproach(actor, 2.2 + rng() * 3.2);
      }
    } else if (kind === "badge" && strength > 9) {
      if (actor.gang >= 0) {
        actor.playerGrudge = Math.min(14, (actor.playerGrudge || 0) + Math.min(0.35, strength * 0.012));
        if (!sameCrew || standing < 18 || greedy) hurryApproach(actor, 1.4 + rng() * 3.2);
      } else if (actor.role === "dealer" || actor.role === "thief" || (p.snitch || 0.5) > 0.62) {
        hurryApproach(actor, 2.0 + rng() * 3.5);
      }
    } else if ((kind === "snitch" || kind === "heat") && strength > 9) {
      if (sameCrew || protectedHere || standing > 24 || (actor.playerTrust || 0) > 4) {
        actor.playerTrust = Math.min(14, (actor.playerTrust || 0) + Math.min(0.30, strength * 0.012));
        hurryApproach(actor, 1.2 + rng() * 3.0);
      } else if (rivalCrew || (p.snitch || 0.5) > 0.58 || (actor.playerGrudge || 0) > 5) {
        actor.playerGrudge = Math.min(14, (actor.playerGrudge || 0) + Math.min(0.40, strength * 0.015));
        hurryApproach(actor, 1.6 + rng() * 3.0);
      }
    } else if (kind === "debt" && strength > 8 && actor.gang >= 0) {
      if (!sameCrew && !protectedHere && (standing < 12 || greedy)) {
        actor.playerGrudge = Math.min(14, (actor.playerGrudge || 0) + Math.min(0.38, strength * 0.014));
        hurryApproach(actor, 1.1 + rng() * 2.7);
      } else if ((sameCrew || protectedHere) && loyal) {
        hurryApproach(actor, 2.4 + rng() * 3.0);
      }
    }
  }
  function noteRead(kind, amount, source, range) {
    buzz(kind, amount, source);
    if (amount > 0) nearbyRead(kind, amount * 2.2, source, range);
  }
  function nudgeGang(actor, standing, debt) {
    if (!actor || actor.gang == null || actor.gang < 0) return;
    if (standing && CBZ.addGangStanding) CBZ.addGangStanding(actor.gang, standing);
    if (debt && CBZ.addGangDebt) CBZ.addGangDebt(actor.gang, debt);
  }
  function gangStanding(actor) {
    return actor && actor.gang >= 0 && CBZ.gangStanding ? CBZ.gangStanding(actor.gang) : 0;
  }
  function gangDebt(actor) {
    return actor && actor.gang >= 0 && CBZ.gangDebt ? CBZ.gangDebt(actor.gang) : 0;
  }
  function gangProtected(actor) {
    return actor && actor.gang >= 0 && CBZ.gangProtection && CBZ.gangProtection(actor.gang) > 0;
  }
  function playerSameGang(actor) {
    return actor && actor.gang >= 0 && CBZ.player && CBZ.player.gang === actor.gang;
  }
  function priceTag(reasons) {
    if (!reasons || !reasons.length) return "";
    return reasons.slice(0, 2).join(", ");
  }
  function offerPrice(actor) {
    const offer = actor && actor.data && actor.data.offer;
    if (!offer) return { price: 0, base: 0, reasons: [] };
    const base = Math.max(1, offer.basePrice || offer.price || (ITEMS[offer.item] && ITEMS[offer.item].value) || 2);
    let mod = 0;
    const reasons = [];
    const heat = g.role === "cop" ? (g.complaints || 0) : (g.detection || 0);
    const risky = actor.role === "dealer" || (offer.item && ITEMS[offer.item] && ITEMS[offer.item].tag === "drugs") || offer.item === "Shiv" || offer.item === "Burner Phone";
    if (heat > 24 && risky) {
      const n = Math.min(6, Math.ceil(heat / 24));
      mod += n; reasons.push("heat tax");
    }
    if ((g.witnessReportT || 0) > 0 || (g.lastKnown && g.lastKnown.t > 0)) {
      mod += 1; reasons.push("search risk");
    }
    if ((g.lowProfileT || 0) <= 0 && (g.cigs || 0) >= 18 && actor.role !== "merchant") {
      mod += Math.min(4, Math.ceil((g.cigs || 0) / 18)); reasons.push("cash loud");
    }

    if (actor.gang >= 0) {
      const standing = gangStanding(actor);
      const debt = gangDebt(actor);
      if (playerSameGang(actor) || gangProtected(actor) || standing > 24) {
        const cut = Math.min(6, 1 + Math.floor(Math.max(standing, 0) / 18));
        mod -= cut; reasons.push(playerSameGang(actor) ? "crew price" : "respect cut");
      } else if (standing < -12) {
        mod += Math.min(6, 1 + Math.floor(Math.abs(standing) / 16)); reasons.push("bad blood");
      }
      if (debt > 4) {
        mod += Math.min(6, Math.ceil(debt / 5)); reasons.push("debt tax");
      }
    }

    const trust = actor.playerTrust || 0;
    const grudge = actor.playerGrudge || 0;
    const fear = actor.playerFear || 0;
    if (trust > 3) { mod -= Math.min(4, Math.floor(trust / 3)); reasons.push("trust"); }
    if (grudge > 3) { mod += Math.min(5, Math.floor(grudge / 3)); reasons.push("grudge"); }
    if (fear > 5 && !risky) { mod -= Math.min(3, Math.floor(fear / 4)); reasons.push("scared"); }

    if (actor.corrupt || actor.kind === "warden") {
      const ledger = g.racketStanding || 0;
      if ((g.racketDebt || 0) > 0) { mod += Math.min(7, Math.ceil((g.racketDebt || 0) / 6)); reasons.push("racket tab"); }
      if (ledger > 8) { mod -= Math.min(4, Math.floor(ledger / 12)); reasons.push("bent trust"); }
      if (ledger < -8) { mod += Math.min(6, Math.ceil(Math.abs(ledger) / 10)); reasons.push("bent heat"); }
    }

    const price = Math.max(1, base + mod);
    return { price, base, reasons };
  }
  function offerLine(actor) {
    const offer = actor && actor.data && actor.data.offer;
    if (!offer) return "";
    const p = offerPrice(actor);
    const tag = priceTag(p.reasons);
    return `${offer.item}·${p.price}${tag ? " " + tag : ""}`;
  }
  function payoffCost(actor) {
    // GUARDS ONLY — the warden refuses cigarettes (see payoff()), so his old
    // +14 premium priced a transaction that no longer exists.
    const heat = g.detection || 0;
    const complaints = g.complaints || 0;
    const jobCut = g.gangJob ? 4 : 0;
    let cost = Math.ceil(heat / 8) + Math.ceil(complaints / 12) + jobCut + 5;
    if (actor && actor.corrupt) {
      const ledger = g.racketStanding || 0;
      cost += Math.ceil((g.racketDebt || 0) / 8);
      if (ledger > 8) cost -= Math.min(5, Math.floor(ledger / 10));
      if (ledger < -8) cost += Math.min(7, Math.ceil(Math.abs(ledger) / 9));
      if ((g.racketProtectionT || 0) > 0) cost -= 1;
    }
    return Math.max(5, cost);
  }

  /* ==========================================================================
     WHAT COMES BACK IS A THING A PERSON SAID

     `.pi-subtitle` (systems/interact.js) is a SPEECH surface — hud.css's
     world-subtitle grammar, the speaker's name in an aria-only slot because
     you can see who is in front of you. Every verb below returned its `msg`
     into it, and most of those messages were the game talking about itself:
     "Lifted a Cell Key + 7 clean." · "Bought Shiv for 12  (heat tax)" ·
     "Bribe costs 10 ." · "blushes (34/100)". A number in a speech bubble is
     the fourth wall with a mouth drawn on it.

     THE CONVENTION, applied to every line this file emits:
       · the LINE is only ever words a character speaks. No name prefix (the
         speaker slot has it), no quotation marks (the surface IS the quote),
         no state read out as digits.
       · a RESULT that is not speech does not become a line at all. It becomes
         the thing that already happens: the pickup feed row, the sfx, the
         heat, the hand you can see move. A successful lift says NOTHING —
         that is the entire point of a successful lift.
       · prices stay numeric where a price belongs (the button label, the
         status chip), and a person may SAY a number the way people do
         ("Ten smokes, and I never saw you") — that is speech, not a readout.
     ========================================================================== */
  function pick(list) { return (list && list.length) ? list[Math.floor(rng() * list.length)] : ""; }
  const VOICE = {
    // a screw standing a count is doing arithmetic with his eyes
    guardBusy: ["Not during the count. Move.",
                "I'm counting bodies. Yours is one of them.",
                "Stand on your number and shut up."],
    wardenBusy: ["The count is running. Whatever it is, it waits.",
                 "Not while my officers are counting."],
    guardShort: ["That's not enough and you know it.",
                 "Come back when your hand's fuller.",
                 "You're short. I'm not."],
    guardClean: ["Try that again and you'll be doing it in the hole.",
                 "I don't take anything off inmates. Walk on.",
                 "Wrong officer, wrong day."],
    /* THE SECOND TIME HE TURNS YOU DOWN. PHONE_TEACH is the once-only version
       and it is a paragraph because it is teaching; these are what a man says
       when he has already explained himself and you came back anyway. */
    guardNoPhone: ["Bring a phone or bring nothing.",
                   "No line out, no business. Walk on.",
                   "Come back with a number I can call."],
    guardPaid: ["I'm looking at the wall for the next while.",
                "Never saw you. Keep it that way.",
                "Two minutes of blind. Use them."],
    /* THE WARDEN'S VOICE IS AUTHORITY, NOT COMMERCE (owner, 2026-08-19: "he
       should not accept cigs... he legit acted like an inmate"). Every warden
       line below exists because the generic guard/inmate line was wrong in
       his mouth. His one currency is NAMES — see snitch() below. */
    wardenNoCigs: ["Cigarettes? I sign for this whole prison. Walk.",
                   "Put them away. I'm not one of my officers.",
                   "You can't afford me, and it isn't counted in smokes."],
    wardenNoPaper: ["The sheet stays the sheet. Bring me something I can use.",
                    "You don't buy paperwork in here. You earn it. With names."],
    wardenNotBuying: ["You're not in enough trouble to need me. Keep it that way.",
                      "Your sheet's thin. Nothing to trade. Go on."],
    wardenHeardIt: ["I've heard enough out of you today.",
                    "One name a block. That's the arrangement."],
    wardenNoNames: ["Names. Real ones. Come back when you hold one.",
                    "Your yard's gone quiet on you? Then we're done."],
    wardenPaidName: ["That's worth some quiet. Your sheet just got thinner.",
                     "Noted. My officers will take it from here.",
                     "Good. Keep your ears open and your mouth this useful."],
    wardenInsulted: ["Segregation has a bed with your name on it.",
                     "Brave. My officers collect brave."],
    wardenIgnores: ["Noted. Everything in here gets noted.",
                    "Enjoy the yard while you still have yard."],
    // the trespass ladder — world/adminwing.js speaks these when an inmate
    // stands in his office or his quarters and stays there
    wardenOut1: ["This is my office. Out.",
                 "Wrong room, convict."],
    wardenOut2: ["I will not say it twice. OUT.",
                 "Last chance to walk."],
    wardenOut3: ["Officers! Inmate in the admin wing!",
                 "Control — my office, NOW."],
    guardCaught: ["Hand. Out. Of my belt.",
                  "You just bought yourself a shakedown.",
                  "Radio's already in my hand, boy."],
    // he is on your payroll — that changes what happens, not just what he says
    guardCaughtBought: ["I'm paid to look away, not to be robbed. Don't.",
                        "That belt is where our arrangement ends.",
                        "I'll forget the hand. Not twice."],
    inmateCaught: ["Get off me.", "Try that again, see what happens.",
                   "You're going in my pocket next, is that it?",
                   "Hands. Now."],
    inmateCaughtNight: ["Quiet. The man's on the tier. And get off me.",
                        "You want the whole wing awake? Off."],
    inmateSour: ["I've got nothing to say to you.",
                 "Walk. Before I make it a thing."],
    inmateWarm: ["Anything you need, you ask.",
                 "You've been straight with me. That counts.",
                 "You're alright. Most in here aren't."],
    // night in a cellblock is a whisper, and whispers are where the truth is
    nightTalk: ["Keep it down. Sound carries on the tier at night.",
                "Nights are the only hours in here that belong to us.",
                "Lights out is when you learn who's really awake.",
                "The man hates the dark as much as we do. Remember that."],
    yardTalk: ["Yard's the only market in here. Everything moves out here.",
               "You want business done, you do it in daylight, in the open.",
               "Nobody looks twice at two men talking in a yard."],
    noStock: ["Nothing on me worth your smokes.",
              "Sold out. Come back when the yard's open."],
    notNow: ["Not now. Wrong hour for it.",
             "Ask me at yard time like a normal person."],
  };

  /* SHOW THE HAND — the missing physical half of a pickpocket.
     entities/character.js now carries a `reach` layer on the SHARED rig
     (CBZ.charReach); this is the escape-gated call site the layer's comment
     asks for. The city has its own frisk verb (city/take.js) with its own
     staging, so it is not armed from here. Degrades to nothing if the rig or
     the layer is absent. */
  function showReach(ch, opts) {
    if (!ch || CBZ.game.mode !== "escape" || !CBZ.charReach) return 0;
    return CBZ.charReach(ch, opts || {});
  }
  function playerReach(actor, high) {
    const a = actor && (actor.group && actor.group.position);
    const P = CBZ.player;
    let side = -1;
    if (a && P && P.pos && CBZ.playerChar && CBZ.playerChar.group) {
      // reach across the body or out to the side, whichever the mark is on
      const yaw = CBZ.playerChar.group.rotation.y || 0;
      const dx = a.x - P.pos.x, dz = a.z - P.pos.z;
      side = (dx * Math.cos(yaw) - dz * -Math.sin(yaw)) >= 0 ? 1 : -1;
    }
    return showReach(CBZ.playerChar, { arm: side > 0 ? "r" : "l", side: side, high: high || 0, dur: 0.62 });
  }

  /* A KEY YOU TOOK OFF A MAN IS THE SAME KEY THAT WAS LYING ON THE DESK.
     entities/keycard.js's world card sets g.hasKey (the door/AI truth) beside
     the bag item; a card lifted off the officer whose POST is that door has to
     do exactly the same or the theft is a souvenir. Same three writes, same
     order, feature-detected so nothing here depends on the HUD existing. */
  function grantKeyItem(name) {
    if (name !== "Keycard") return;
    if (g.hasKey) return;
    g.hasKey = true;
    if (CBZ.el && CBZ.el.keycard) CBZ.el.keycard.classList.add("have");
    if (CBZ.setObjective) CBZ.setObjective("Keycard opens staff checkpoints. Cross the yard or scout tunnels for another way out.");
  }

  // ---------- TALK: free flavour / hints ----------
  // The hour picks the register. A block at night whispers about the night; a
  // yard at ten in the morning talks business; a screw mid-count talks about
  // the count. Same actor, same data.talk pool underneath — the schedule just
  // decides whether this is an hour for their own words at all.
  function talk(actor) {
    const guardish = actor.kind === "guard" || actor.kind === "warden";
    if (guardish && counting()) {
      return { ok: true, msg: pick(actor.kind === "warden" ? VOICE.wardenBusy : VOICE.guardBusy), sfx: null };
    }
    if (!guardish) {
      const S = socialRead(actor);
      if (S.standing === "enemy" || S.standing === "sour") return { ok: false, msg: pick(VOICE.inmateSour), sfx: null };
      if (S.respect >= 62 && rng() < 0.45) return { ok: true, msg: pick(VOICE.inmateWarm), sfx: null };
      if (afterDark() && rng() < 0.5) return { ok: true, msg: pick(VOICE.nightTalk), sfx: null };
      if (yardTime() && rng() < 0.28) return { ok: true, msg: pick(VOICE.yardTalk), sfx: null };
    }
    const lines = actor.data.talk || ["…"];
    const line = lines[Math.floor(rng() * lines.length)];
    return { ok: true, msg: line, sfx: null };
  }

  /* THE PRICE TAG WAS THE SELLER READING HIS OWN SPREADSHEET OUT.
     `priceTag()` still feeds the menu CHIP, which is where a price belongs.
     What comes out of the seller's MOUTH is the reason in his own words —
     same reasons, same order of importance, no parentheses. */
  const WHY = {
    "heat tax":   "Price goes up when you're this hot.",
    "search risk": "They're turning pockets out today. That's in the price.",
    "cash loud":  "You're rattling when you walk. Costs extra.",
    "crew price": "Crew price. Don't go telling people.",
    "respect cut": "You've been straight with me. So has the price.",
    "bad blood":  "That's what it costs you. Just you.",
    "debt tax":   "You owe. It's baked in.",
    trust:        "For you, cheap.",
    grudge:       "I haven't forgotten. Neither has the price.",
    scared:       "Just take it and go.",
    "racket tab": "You're behind with us. Price says so.",
    "bent trust": "You've been good for it. So am I.",
    "bent heat":  "You're bad for my health. Pay for it.",
  };
  function whyLine(reasons) { return (reasons && reasons.length && WHY[reasons[0]]) || ""; }

  /* ==========================================================================
     THE BRIDGE — CAN YOU REACH THE STREET?

     hasPhoneAccess() is the whole of it. A Burner Phone in the bag is a line
     out you own; PHONE TIME is a line out you rented, and it is a WINDOW
     rather than an item because that is what renting a handset in a prison
     actually is — ninety seconds of somebody standing over you while you make
     your call. One deep transaction spends it (consumePhoneTime), the same
     way one call spends the shift you paid for.

     phoneGate(actor) is the ONE gate. It returns a refusal or null, so no
     caller anywhere has to know the flag exists, re-derive the rule, or
     invent its own words for the no — entities/guards.js calls exactly this.
     The refusal TEACHES, once per officer: the first time a given man turns
     you down he explains WHY tobacco is not the instrument, and after that he
     is a man who has already said his piece and gives you the short version.
     ========================================================================== */
  const PHONE_TIME_SECS = 90;
  // He says the terms in his own mouth: what the money is, and where it goes.
  const PHONE_TERMS = "Not in smokes. Have your people put it on my sister's app. You got a phone or you don't.";
  // Once per officer. Long, because it is the only time the game explains it.
  const PHONE_TEACH = "What am I doing with cigarettes? You can't reach the street, we got nothing to talk about.";
  function hasPhoneAccess() { return hasItem("Burner Phone") || (g.phoneTimeT || 0) > 0; }
  function phoneTerms() { return phoneBridge() ? PHONE_TERMS : ""; }
  function grantPhoneTime(secs) {
    g.phoneTimeT = Math.max(g.phoneTimeT || 0, secs || PHONE_TIME_SECS);
    return g.phoneTimeT;
  }
  /* A RENTED SHIFT IS SPENT BY THE CALL, NOT BY THE CLOCK ALONE. A phone you
     OWN is not consumed — that is the entire difference between the 18-cig
     item and the 8-cig service, and it is what makes owning one worth it. */
  function consumePhoneTime() {
    if (hasItem("Burner Phone") || (g.phoneTimeT || 0) <= 0) return false;
    g.phoneTimeT = 0;
    return true;
  }
  function phoneGate(actor) {
    if (!phoneBridge() || hasPhoneAccess()) return null;
    const said = (actor && actor._saidNoPhone) || 0;
    if (actor) actor._saidNoPhone = said + 1;
    return { ok: false, phone: "none", msg: said ? pick(VOICE.guardNoPhone) : PHONE_TEACH };
  }
  /* THE HONEST LINE, ONCE A RUN. The cigarette counter dropped, because that
     is the magnitude of the favour — but tobacco is not what the officer was
     paid in, and the very first deep transaction of a run says so out of his
     own mouth before going on to its own business. A CLAUSE rather than a
     whole line so that whichever verb gets there first (a payoff at the till,
     a racket cut, a bought statement, a name off the log) can wear it in
     front of the words that carry the actual result. Empty every time after,
     and empty always with the flag off. */
  function outsidePaidLine() {
    if (!phoneBridge() || g._phoneBridgeSaid) return "";
    g._phoneBridgeSaid = 1;
    return "Money landed on my sister's app.";
  }
  function outsidePaidPrefix() { const s = outsidePaidLine(); return s ? s + " " : ""; }

  // ---------- TRADE: buy the actor's current offer for cigarettes ----------
  function trade(actor) {
    const guardish = actor.kind === "guard" || actor.kind === "warden";
    const offer = actor.data.offer; // { item, price }
    if (guardish && counting()) return { ok: false, msg: pick(actor.kind === "warden" ? VOICE.wardenBusy : VOICE.guardBusy) };
    if (!offer) return { ok: false, msg: pick(VOICE.noStock) };
    const priced = offerPrice(actor);
    const price = priced.price;
    if (g.cigs < price) {
      /* HE NAMES WHAT HE IS SELLING. This used to be `${price}. ${whyLine}` —
         a bare numeral followed by a DISCOUNT brag, used as a rejection:
         "4. Crew price. Don't go telling people." The player, holding zero
         cigs, was told the price was friendly and never told what was on
         offer. On iPad it is the only string in the whole transaction: the
         button is one word (TRADE) and the chip is the bare price, so the
         item name lived nowhere a sighted player could read it.
         A man refusing a sale says the thing, the number, and the no. */
      // "That's N for the X" rather than a possessive: the item pool has
      // plurals in it (Pills, Smokes) and "Pills's 4" is not a sentence.
      const short = Math.max(1, price - (g.cigs || 0));
      return { ok: false, msg: `That's ${price} for the ${offer.item}. You're ${short} short.` };
    }
    addCigs(-price);
    /* A SERVICE IS NOT A THING YOU CARRY. Phone Time buys a WINDOW, so it
       skips the bag, skips the pickup feed (nothing landed in it) and skips
       isRare's flourish — what you actually got is ninety seconds of being
       able to reach the street, and the only report on it is the man's own
       terms as he hands the handset over. */
    const service = isService(offer.item);
    if (service) grantPhoneTime(); else addItem(offer.item, 1);
    g.trades++;
    const seller = nm(actor);
    noteRead("wealth", Math.min(11, 2 + price * 0.18), seller, 12);
    if (actor.gang >= 0) nudgeGang(actor, 1, -1);
    if (actor.gang >= 0 && CBZ.noteGangIncident) CBZ.noteGangIncident(actor, "trade", Math.max(2, Math.ceil(price / 7)), { source: "trade" });
    if (actor.corrupt || actor.kind === "guard" || actor.kind === "warden") {
      addRacketDebt(Math.ceil(price * 0.10));
      if (actor.corrupt && CBZ.addRacketStanding) CBZ.addRacketStanding(1);
      noteRead("badge", Math.min(10, 2 + price * 0.16), seller, 13);
    }
    // refresh their offer to something else next time, from their own stock
    actor.data.offer = pickOffer(actor.data.pool);
    CBZ.sfx("coin");
    // A HONOURED TRADE IS STANDING. Small, capped, and the reason prices soften
    // for a regular — you become someone this person does business with.
    addRespect(actor, 1);
    if (actor.corrupt || guardish) addLoyalty(actor, 2);
    // The thing you bought lands where every other thing you pick up lands.
    // The seller SPEAKS; the transaction is shown, not narrated.
    if (!service && CBZ.pickupNote) CBZ.pickupNote(offer.item, { rare: isRare(offer.item) });
    // HE HANDS IT OVER WITH THE TERMS ON IT. A rented phone is the one thing
    // in this shop the seller does not let out of his sight, and saying so is
    // the whole difference between buying a handset and buying a shift on one.
    if (service) return { ok: true, msg: "Ten minutes, and it stays where I can see it." };
    // ...and he names it on the way out too, so the sale reads as a sale and
    // not as a number leaving your pocket. The discount/markup reason, when
    // he has one, is the second half — his voice, not a spreadsheet row.
    const why = whyLine(priced.reasons);
    return { ok: true, msg: why ? `${offer.item}, ${price}. ${why}` : `${offer.item}, ${price}. ${yardTime() ? "Come back if you need more." : "That's the last one I've got on me."}` };
  }

  /* A MAN YOU HAVE ALREADY PAID IS CHEAPER, AND HE STAYS CHEAPER.
     Published because systems/interact.js prints this number on the button
     ("Slip 10 to look away") — a price the menu computes separately from the
     till is a price that lies the moment loyalty moves it. One function. */
  function bribeCost(actor) {
    if (!actor) return 10;
    // Under the bridge doctrine no officer takes cigarettes AT ALL (see
    // bribe()), so there is no cig price to print — the chip shows 0 and the
    // transaction runs on loyalty or a name. Flag off restores the old till.
    if (phoneBridge()) return 0;
    // GUARDS ONLY — the warden refuses cigarettes outright (see bribe()), so
    // he has no bribe price to print anywhere.
    const base = actor.corrupt ? 5 : 10;                  // bent officers come cheap
    const l = loyaltyOf(actor);
    // up to 40% off a standing arrangement; a count makes everything dearer
    let cost = Math.round(base * (1 - Math.min(0.40, l / 250)));
    if (counting()) cost += 4;
    return Math.max(2, cost);
  }

  /* ---------- BRIBE: make a guard look away ----------
     NO OFFICER TAKES CIGARETTES. AT ALL. (Owner, 2026-08-26: "no officer in
     a prison accepts fuckin cigs" — and the research agrees once you read it
     straight: prison cigarettes are INMATE money, worth six dollars at any
     gas station on his drive home, and taking anything off an inmate is a
     fireable boundary violation that leaves evidence. The documented case of
     cigarettes touching an officer runs the OTHER way — officers as
     SUPPLIERS, cartons in at $16, packs out at 500% markup. The bent man is
     not a customer. He is the mint.)

     So under PRISON_PHONE_BRIDGE the bottom rung is SOCIAL, the way it
     really is. Three ways a moment of blindness happens, none of them a
     payment in goods:
       · a NAME — you hold a snitch's name (n.snitchKnown, the same knowledge
         ladder the yard uses) and hand it to a bent officer. Information is
         the one inmate asset with real value to a uniform.
       · a RELATIONSHIP — bought() (loyalty >= 35, built by shopping at his
         shelf and feeding him names) gets the favour free, and SPENDS a
         little goodwill each time, so the arrangement needs upkeep.
       · nothing else. A clean officer refuses, remembers, and the attempt
         itself is heat. Flag off = the old cigs-for-blindness till. */
  function bribe(actor) {
    /* THE WARDEN IS NOT FOR SALE IN CIGARETTES (owner, 2026-08-19: "he should
       not accept cigs... he legit acted like an inmate"). He used to take 25
       smokes for a look-away and cough up the Gun-Room Key half the time —
       the bent-screw transaction with a bigger number on it. Refused now, at
       the till, so every route (menu, campaign, scripts) hears the same no.
       His price is a NAME — snitch() below. The key still moves the ways a
       warden would actually lose it: lifted, beaten out of him, or looted. */
    if (actor.kind === "warden") {
      noteRead("heat", 3, nm(actor), 8);
      return { ok: false, msg: pick(VOICE.wardenNoCigs) };
    }
    if (actor.kind === "guard") {
      // THE COUNT OUTRANKS EVERYTHING. He is standing on a number with a
      // clipboard and a supervisor; nothing turns him round right now.
      if (counting() && !bought(actor)) return { ok: false, msg: pick(VOICE.guardBusy) };
      const who = nm(actor);
      if (phoneBridge()) {
        if (!actor.corrupt) {
          // A CLEAN OFFICER REFUSES AND REMEMBERS. The offer itself is the
          // mistake: he files your face, and the wing gets a little warmer.
          actor.alert = Math.max(actor.alert || 0, 0.6);
          addLoyalty(actor, -4);
          if (CBZ.addHeat) CBZ.addHeat(3);
          noteRead("heat", 5, who, 12);
          return { ok: false, msg: pick(VOICE.guardClean) };
        }
        // A NAME BUYS A MOMENT. The one thing an inmate holds that a uniform
        // can use — and handing it over is quiet business at the bars.
        let known = null;
        for (const n of CBZ.npcs || []) {
          if (n && !n.dead && !n.escaped && n.snitchKnown && !n._nameSold) { known = n; break; }
        }
        if (known) {
          known._nameSold = true;   // the racket has him now; the name spends once
          // the racket leans on its new asset: his reporting cools, and the
          // arrangement notices you fed it
          known.reportedPlayerT = Math.max(0, (known.reportedPlayerT || 0) * 0.4);
          addLoyalty(actor, 12);
          actor.bribed = Math.round(12 * (1 + loyaltyOf(actor) / 160));
          actor.alert = 0;
          if (CBZ.addRacketStanding) CBZ.addRacketStanding(2);
          noteRead("badge", 6, who, 13);
          CBZ.sfx("coin");
          return { ok: true, msg: `${nm(known)} talks to the office. — That, I can use. Go on, I'm watching the wall.` };
        }
        if (bought(actor)) {
          // A RELATIONSHIP FAVOUR. Free at the point of use, and it draws the
          // account down — the arrangement wants feeding (his shelf, a name).
          addLoyalty(actor, -4);
          actor.bribed = Math.round(14 * (1 + loyaltyOf(actor) / 160));
          actor.alert = 0;
          if (CBZ.addHeat) CBZ.addHeat(-6);
          g.racketProtectionT = Math.max(g.racketProtectionT || 0, 8);
          noteRead("badge", 6, who, 13);
          return { ok: true, msg: pick(VOICE.guardPaid) };
        }
        // he sells; he does not buy — teach it once, in his own voice
        if (!actor._saidNoCigs) {
          actor._saidNoCigs = true;
          return { ok: false, msg: "What am I going to do with prison smokes? I stop at a store like a person. Bring me a name, or buy off my shelf." };
        }
        return { ok: false, msg: "My shelf's for sale. My eyes aren't. Not for smokes." };
      }
      const cost = bribeCost(actor);
      if (g.cigs < cost) return { ok: false, msg: `It's ${cost} to look the other way. ${pick(VOICE.guardShort)}` };
      addCigs(-cost);
      // A BOUGHT MAN LOOKS AWAY LONGER. `bribed` stays what it always was —
      // seconds of blindness — and `loyalty` is the thing that persists, so a
      // second visit to the same officer buys more than the first did.
      actor.bribed = Math.round(14 * (1 + loyaltyOf(actor) / 160));
      addLoyalty(actor, 14);
      actor.alert = 0;
      if (actor.corrupt) {
        if (CBZ.addHeat) CBZ.addHeat(-10);
        addRacketDebt(Math.max(1, Math.ceil(cost * 0.45)));
        g.racketProtectionT = Math.max(g.racketProtectionT || 0, 8 + cost);
        if (CBZ.addRacketStanding) CBZ.addRacketStanding(2);
        noteRead("badge", 8 + cost * 0.55, who, 15);
        if (CBZ.addCasePressure) CBZ.addCasePressure(4 + cost * 0.55, { type: "bribe", heardOnly: true }, actor, { corruptHold: true });
      } else {
        noteRead("heat", 3, who, 11);
      }
      CBZ.sfx("coin");
      return { ok: true, msg: pick(VOICE.guardPaid) };
    }
    // inmates: a small gift earns goodwill + sometimes a free item/tip
    const cost = 3;
    if (g.cigs < cost) return { ok: false, msg: `Three smokes buys goodwill in here. ${pick(VOICE.guardShort)}` };
    addCigs(-cost);
    actor.playerTrust = (actor.playerTrust || 0) + 1.2;
    addRespect(actor, 2);            // standing, capped — a gift is not a favor
    nudgeGang(actor, 4, -2);
    if (actor.gang >= 0 && CBZ.noteGangIncident) CBZ.noteGangIncident(actor, "gift", 4, { source: "gift" });
    noteRead(actor.gang >= 0 ? "debt" : "wealth", actor.gang >= 0 ? -3 : -2, nm(actor), 10);
    if (rng() < 0.5) {
      const it = SELLABLE[Math.floor(rng() * 4)];
      addItem(it, 1);
      if (CBZ.pickupNote) CBZ.pickupNote(it, { rare: isRare(it) });
      return { ok: true, msg: "Here. Don't say I never gave you anything." };
    }
    return { ok: true, msg: actor.data.tip || "Thanks, friend." };
  }

  /* ---------- PAYOFF: corrupt authority can clean up heat ----------
     `opts.cost` — THE NUMBER HE QUOTED IS THE NUMBER HE TAKES. When this is
     reached through a bent officer's approach (entities/guards.js), the card
     has already advertised a frozen price and HAGGLE has already had its go
     at moving it. Recomputing payoffCost() at the till threw all of that away:
     the chip said one number, the pocket lost another, and haggling a payoff
     down was pure theatre because the discount never reached the money. The
     menu's own PAYOFF verb passes nothing and still gets the live price. */
  function payoff(actor, opts) {
    // The warden's sheet is not for sale either — his clean-up is bought with
    // a NAME (snitch() below), never with cigarettes.
    if (actor.kind === "warden") return { ok: false, msg: pick(VOICE.wardenNoPaper) };
    if (actor.kind !== "guard") return { ok: false, msg: "Do I look like I write the paperwork in here?" };
    if (counting() && !bought(actor)) return { ok: false, msg: pick(VOICE.guardBusy) };
    if (!actor.corrupt) {
      if (CBZ.addHeat) CBZ.addHeat(6);
      actor.alert = Math.max(actor.alert || 0, 1.2);
      addLoyalty(actor, -6);        // you just offered a clean screw money
      return { ok: false, msg: pick(VOICE.guardClean) };
    }

    /* THIS IS THE DEEP END, AND THE DEEP END NEEDS A LINE OUT.
       Losing a man's paperwork is the thing that ends the officer's career,
       not the inmate's day — so it is never bought with what an inmate is
       holding. The gate sits AFTER the clean-officer branch on purpose: a
       straight man refuses on principle, and that refusal outranks any
       question of how you were proposing to pay him. */
    const noPhone = phoneGate(actor);
    if (noPhone) return noPhone;

    const heat = g.detection || 0;
    const complaints = g.complaints || 0;
    const quoted = opts && opts.cost > 0 ? Math.max(1, Math.round(opts.cost)) : 0;
    const cost = quoted || payoffCost(actor);
    // A REFUSAL NAMES THE THING AND THE NUMBER — and, now, the instrument.
    if (g.cigs < cost) return { ok: false, msg: phoneBridge()
      ? `Paperwork runs ${cost}. ${PHONE_TERMS}`
      : `Making paper disappear runs ${cost}. ${pick(VOICE.guardShort)}` };

    addCigs(-cost);
    consumePhoneTime();          // one call, one shift — a rented line is spent
    actor.bribed = Math.max(actor.bribed || 0, 20);
    actor.alert = 0;
    actor.hunt = 0;
    if (CBZ.addHeat) CBZ.addHeat(-(26 + heat * 0.45));
    if (CBZ.addComplaint) CBZ.addComplaint(-(18 + complaints * 0.35));
    if (CBZ.reduceCasePressure) CBZ.reduceCasePressure(14 + cost * 0.9, actor.data && actor.data.name ? actor.data.name.replace(/^the |^a |^an /, "") : "");
    if (actor.corrupt) {
      g.racketProtectionT = Math.max(g.racketProtectionT || 0, 12 + cost);
      addRacketDebt(-Math.ceil(cost * 0.65));
      if (CBZ.addRacketStanding) CBZ.addRacketStanding(3);
      noteRead("badge", 10 + cost * 0.35, nm(actor), 15);
      if (CBZ.addCasePressure) CBZ.addCasePressure(5 + cost * 0.28, { type: "payoff", heardOnly: true }, actor, { corruptHold: true });
    } else {
      noteRead("heat", -8, nm(actor), 10);
    }
    g.witnessReportT = Math.max(0, (g.witnessReportT || 0) - 10);
    if ((g.detection || 0) < 32) g.lastKnown = null;
    for (const gd of CBZ.guards || []) {
      if (gd.corrupt || (g.detection || 0) < 28) {
        gd.hunt = 0;
        gd.alert = Math.min(gd.alert || 0, 0.2);
        gd.investigate = null;
      }
    }
    CBZ.sfx("coin");
    // PAYING A MAN OFF IS THE PUREST FORM OF BUYING HIM. It is the one act in
    // the game that makes a screw yours for the rest of the run.
    addLoyalty(actor, 22);
    // ONE HONEST LINE, THE FIRST TIME. The counter dropped by `cost` because
    // that is the magnitude of the favour — but the officer was not paid in
    // tobacco and says so, once, and then the game stops explaining itself.
    return { ok: true, msg: outsidePaidPrefix() + (g.role === "cop"
      ? "The complaint goes in the wrong drawer. Nobody reads that drawer."
      : "Your name comes off the sheet. It goes back on if you make me look stupid.") };
  }

  /* ---------- SNITCH: the warden's price is a NAME ----------
     OWNER (2026-08-19): "he should not accept cigs" — so what DOES the top of
     a prison trade in? Information. The game already runs a whole snitch
     economy pointed AT the player (inmates report you, credibility, "talks to
     the screws" reads); this is the same economy with the player on the
     selling side, and every consequence goes through machinery that already
     exists:
       · the heat relief is payoff()'s own sweep, paid in risk instead of cigs
       · the name is a REAL man — a rival crew's holder, found by what his
         rolled loadout actually carries — and the nearest free officer
         physically walks to him (guards.js's investigate beat)
       · the risk is the yard finding out: provokeGang turns the burned crew
         on you, and noteRead("snitch") drops you into the same block-gossip
         channel that brands any other man who talks to the screws
     One name a schedule block. A clean sheet has nothing to trade. */
  const SNITCH_HEAT_MIN = 14;
  // the gate, published so the menu chip and the act can never disagree:
  // "" = he is buying · "count" | "later" | "clean" = why not
  function snitchOffer(actor) {
    if (!actor || actor.kind !== "warden") return "clean";
    if (counting()) return "count";
    const b = blockId();
    if (b && g.wardenHeardBlock === b) return "later";
    if ((g.detection || 0) < SNITCH_HEAT_MIN && (g.complaints || 0) < 25) return "clean";
    return "";
  }
  function snitchMark() {
    // a name worth money: a live rival-crew man, weighted by what he holds
    let best = null, bs = -1;
    for (const n of CBZ.npcs || []) {
      if (!n || n.dead || n.escaped || (n.ko || 0) > 0 || !n.group) continue;
      if (n.gang == null || n.gang < 0 || n.gang === CBZ.player.gang) continue;
      const load = rollLoadout(n);
      const s = (load.items ? load.items.length * 4 : 0) + (load.cigs || 0) * 0.3 + (n.isLeader ? 3 : 0);
      if (s > bs) { bs = s; best = n; }
    }
    return best;
  }
  function snitch(actor) {
    const why = snitchOffer(actor);
    if (why === "count") return { ok: false, msg: pick(VOICE.wardenBusy) };
    if (why === "later") return { ok: false, msg: pick(VOICE.wardenHeardIt) };
    if (why === "clean") return { ok: false, msg: pick(VOICE.wardenNotBuying) };
    const mark = snitchMark();
    if (!mark) return { ok: false, msg: pick(VOICE.wardenNoNames) };
    const heat = g.detection || 0, complaints = g.complaints || 0;
    g.wardenHeardBlock = blockId() || "x";
    if (CBZ.addHeat) CBZ.addHeat(-(22 + heat * 0.45));
    if (CBZ.addComplaint) CBZ.addComplaint(-(12 + complaints * 0.3));
    if (CBZ.reduceCasePressure) CBZ.reduceCasePressure(16, nm(actor));
    g.witnessReportT = Math.max(0, (g.witnessReportT || 0) - 8);
    if ((g.detection || 0) < 32) g.lastKnown = null;
    // payoff()'s own stand-down sweep: the search cools because the office
    // suddenly has a better name than yours
    for (const gd of CBZ.guards || []) {
      if ((g.detection || 0) < 28) {
        gd.hunt = 0;
        gd.alert = Math.min(gd.alert || 0, 0.2);
        gd.investigate = null;
      }
    }
    addLoyalty(actor, 12);                    // an informant is an asset
    // THE NAME GETS ACTED ON: the nearest free officer walks to the man you
    // sold. guards.js's investigate beat does the walking and the looking.
    const mp = mark.group.position;
    let officer = null, od = Infinity;
    for (const gd of CBZ.guards || []) {
      if (!gd || gd.dead || gd.ko > 0 || gd.kind === "warden" || gd.hunt > 0 || gd.asleep) continue;
      const dx = gd.group.position.x - mp.x, dz = gd.group.position.z - mp.z, d2 = dx * dx + dz * dz;
      if (d2 < od) { od = d2; officer = gd; }
    }
    if (officer) officer.investigate = { x: mp.x, z: mp.z, t: 16 };
    // THE RISK. A yard is a small place: roughly one name in three comes back
    // on you. The burned crew turns (the same verb an insult or a beating
    // uses), and the block-gossip channel starts carrying "talks to the
    // screws" about YOU — the exact read the game already prints on any
    // other man who does this.
    if (rng() < 0.35) {
      if (CBZ.provokeGang) CBZ.provokeGang(mark, 11);
      noteRead("snitch", 14, nm(mark), 22);
      if (CBZ.prisonSay) CBZ.prisonSay(mark, "You went to the man. That's done now.", { rank: CBZ.PRISON_SAY ? CBZ.PRISON_SAY.act : 1 });
    }
    CBZ.sfx("coin");
    return { ok: true, msg: pick(VOICE.wardenPaidName) };
  }

  /* ---------- STEAL: a hand in somebody else's pocket ----------
     THE HALF THAT WAS A LIE. The old lift spliced the best item out of the
     mark's own loadout — a genuine transfer — and then MINTED 3-15 cigarettes
     out of nothing beside it. A guard carrying four smokes could be robbed of
     fifteen, twice, and still be carrying four. Both halves come off the man
     now: cigs leave `load.cigs`, the item leaves `load.items`, and when the
     pockets are empty your hand comes back empty. What you steal is what he
     HAD, and a mark you have already stripped is a mark you have stripped.

     Three things decide whether you get away with it, and every one is
     something the player can see for themselves without a number:
       THE HOUR — a screw standing a count is staring at bodies (harder);
                  after lights-out the tier is dark (easier). CBZ.prisonSchedule.
       THE MARK — a man who already dislikes you watches your hands; a man who
                  trusts you, or one you have paid, does not.
       THE KIT  — a torch that is LIT is in his fist, not in his pocket.
     SUCCESS SAYS NOTHING. The reach, the `loot` cue and one row in the pickup
     feed are the entire report; a line of prose about a lift you got away
     with is the game applauding itself. Failure is the half that speaks,
     because failure is the half where somebody talks to you. */
  function stealOdds(actor) {
    const guardish = actor.kind === "guard" || actor.kind === "warden";
    let chance = guardish ? 0.4 : 0.7;               // guards are harder marks
    if (counting()) chance *= guardish ? 0.55 : 0.82;  // eyes up, bodies counted
    else if (afterDark()) chance *= 1.22;              // the tier is dark
    else if (chowTime()) chance *= 1.08;               // a crowded hall is cover
    const S = socialRead(actor);
    if (S.standing === "friend" || S.standing === "solid") chance += 0.12;
    else if (S.standing === "known") chance += 0.06;
    else if (S.standing === "enemy") chance -= 0.16;
    else if (S.standing === "sour") chance -= 0.08;
    chance -= Math.min(0.18, (actor.playerGrudge || 0) * 0.02);
    if (S.bought) chance += 0.08;                    // he is relaxed around you
    if (actor.bribed > 0) chance += 0.12;            // already looking away
    if ((actor.alert || 0) > 0.6 || (actor.hunt || 0) > 0) chance -= 0.22;
    if ((actor.pocketGuardT || 0) > 0) chance -= 0.15;   // his hand is ON the pocket
    // THE CLASSIFICATION IS THE LAST TERM. A high-security screw is a harder
    // mark than a farm screw in exactly the way the tier table says, and it
    // multiplies rather than subtracts so every reason above (the hour, the
    // mark, his kit) still counts for what it is worth.
    chance *= tierGain("stealMul");
    return Math.max(0.05, Math.min(0.95, chance));
  }
  // he can only lose what is in a POCKET. A lit torch is in his hand and a
  // stripped man has nothing left — both are refusals the world can show.
  function liftBest(actor, load) {
    let bi = -1, bv = -1;
    for (let i = 0; i < load.items.length; i++) {
      const it = load.items[i];
      if (it === "Guard Torch" && actor.flashlightOn) continue;   // it's lit, it's in his fist
      const val = ((ITEMS[it] && ITEMS[it].value) || 1) + (/key|card/i.test(it) ? 1000 : 0); // keys are the prize
      if (val > bv) { bv = val; bi = i; }
    }
    if (bi < 0) return "";
    const lifted = load.items.splice(bi, 1)[0];
    // GONE MEANS GONE, and the world has to be able to tell. A screw without
    // his torch walks his side of the yard dark for the rest of the run —
    // entities/guards.js's shouldUseFlashlight reads this flag.
    if (lifted === "Guard Torch") { actor.flashlightLost = true; actor.flashlightOn = false; }
    return lifted;
  }
  function steal(actor) {
    const guardish = actor.kind === "guard" || actor.kind === "warden";
    const load = rollLoadout(actor);
    const chance = stealOdds(actor);
    playerReach(actor, guardish ? 0 : 0.15);     // the hand moves either way
    if (rng() < chance) {
      // the grab is bounded by the ROLL and by his actual pockets
      const grab = 3 + Math.floor(rng() * (guardish ? 12 : 6));
      const loot = Math.max(0, Math.min(load.cigs, grab));
      load.cigs -= loot;
      if (loot) addCigs(loot);
      g.stealsDone = (g.stealsDone || 0) + 1;   // feeds "pull off N heists" quests
      if (actor.gang >= 0) {
        nudgeGang(actor, -8, Math.max(1, Math.floor(loot / 4)));
        if (CBZ.noteGangIncident) CBZ.noteGangIncident(actor, "steal", 6 + Math.min(5, Math.ceil(loot / 3)), { source: "theft" });
        actor.playerGrudge = (actor.playerGrudge || 0) + 1.5;
        actor.grudgeWhy = "you going through my pockets";
      }
      if (guardish && actor.corrupt) {
        addRacketDebt(Math.max(2, Math.ceil(loot * 0.35)));
        if (CBZ.addRacketStanding) CBZ.addRacketStanding(-5);
      }
      noteRead(guardish ? "badge" : "wealth", guardish ? 8 + loot * 0.35 : 4 + loot * 0.7, nm(actor), guardish ? 15 : 12);
      // A POCKET IS NOT A TILL. `coin` is handleCoins — right for the payoff
      // above, wrong for a hand going into a guard's belt pouch and coming
      // back with his keys. `loot` IS that recording (beltHandle/drop, 45 dB),
      // and it is the only physical tell a successful lift has: there is no
      // pickpocket ARM ANIMATION on the rig — see the note in the failure leg.
      // A POCKET IS NOT A TILL. `coin` is handleCoins — right for the payoff
      // above, wrong for a hand going into a guard's belt pouch and coming
      // back with his keys. `loot` IS that recording (beltHandle/drop, 45 dB).
      // Beside it now: the REACH (character.js's shared layer, armed above)
      // and one row per thing in the corner feed. Three physical tells and no
      // sentence — because a lift you got away with is a thing nobody says.
      const lifted = liftBest(actor, load);
      if (lifted) { addItem(lifted, 1); grantKeyItem(lifted); }
      if (lifted || loot) {
        CBZ.sfx(lifted === "Keycard" || lifted === "Cell Key" || lifted === "Gun-Room Key" ? "key" : "loot");
        announceLoot(loot, lifted ? [lifted] : []);
      } else {
        // his pockets were already empty. The hand came back with nothing and
        // the feed stays blank — that IS the answer, and it is the truthful one.
        CBZ.sfx("whoosh");
      }
      return { ok: true, msg: "" };
    }
    /* THE FAILED LIFT IS THE HALF THAT TALKS. `whoosh` is the bank's
       cloth-and-sleeve cue (35 dB, the quietest thing in it): a hand that
       moved and came back empty. The reach above already played, so what the
       player sees is their own arm going in and a man turning round. */
    CBZ.sfx("whoosh");
    // caught in the act
    if (guardish) {
      // A SCREW YOU HAVE BOUGHT DOES NOT PUT YOU ON THE RADIO. This is the one
      // thing loyalty buys that is worth buying, and it is a decision he makes
      // out loud: he warns you, the arrangement takes the hit instead of your
      // heat, and doing it again is what spends it.
      if (bought(actor)) {
        addLoyalty(actor, -30);
        actor.alert = Math.max(actor.alert || 0, 0.5);
        addRespect(actor, -4);
        caughtBody(actor);
        return { ok: false, msg: pick(VOICE.guardCaughtBought) };
      }
      CBZ.reportCrime(55, { type: "steal", actorRole: g.role });
      if (actor.corrupt && CBZ.addRacketStanding) CBZ.addRacketStanding(-8);
      noteRead("heat", 14, nm(actor), 16);
      actor.bribed = 0;
      addLoyalty(actor, -40);
      addRespect(actor, -8);
      caughtBody(actor);
      return { ok: false, msg: pick(VOICE.guardCaught) };
    }
    CBZ.reportCrime(16, { type: "steal", actorRole: g.role });
    actor.playerGrudge = (actor.playerGrudge || 0) + 2;
    actor.grudgeWhy = "you going through my pockets";
    addRespect(actor, -6);
    if (actor.gang >= 0) nudgeGang(actor, -5, 1);
    if (actor.gang >= 0 && CBZ.noteGangIncident) CBZ.noteGangIncident(actor, "steal", 5, { source: "failed theft" });
    noteRead("snitch", 10, nm(actor), 14);
    caughtBody(actor);
    return { ok: false, msg: pick(afterDark() ? VOICE.inmateCaughtNight : VOICE.inmateCaught) };
  }
  /* A MAN WHO FEELS YOUR HAND IN HIS POCKET. This used to be an "!" over his
     head (CBZ.npcEmote, and systems/markers.js's disc once his grudge sent
     him to the screws). OWNER: "no emojis over heads, it should be bodily
     movement." So: one step off you, his hand clamped over the pocket, body
     turned that side away, eyes on your hands. systems/reactions.js owns all
     three, and systems/markers.js re-arms the clamp whenever you come back
     inside reach of a man whose grudgeWhy is his pockets. */
  function caughtBody(actor) {
    if (CBZ.npcStepBack) CBZ.npcStepBack(actor);
    /* THE SECOND CATCH IS A FIST. (OWNER: "what about punching in the face.")
       The first time he feels your hand he covers his pocket. Catch him going
       back in and a man whose temperament retaliates comes at you — the real
       assault (ai.js huntPlayer: squares up inside 3.4 m, throws the rig's
       own punch, lands it through CBZ.hurtPlayer). Guards have the radio,
       merchants and dealers have a till to stand behind; everyone else rolls
       his own `retaliate`. playerGrudge is +2 per catch, so >= 4 is the
       second one. */
    const guardish = actor.kind === "guard" || actor.kind === "warden";
    const B = CBZ.BEHAVIORS && CBZ.BEHAVIORS[actor.behavior];
    const retaliate = B ? (B.retaliate != null ? B.retaliate : 0.8) : 0.8;
    if (!guardish && actor.role !== "merchant" && actor.role !== "dealer" &&
        (actor.playerGrudge || 0) >= 4 && actor.huntPlayer != null &&
        rng() < 0.3 + retaliate * 0.65) {
      actor.huntPlayer = Math.max(actor.huntPlayer || 0, 3.5);
      actor.pocketGuardT = 0;                       // fists, not pockets
      if (CBZ.npcStare) CBZ.npcStare(actor, 1.2);
      return;
    }
    if (CBZ.npcGuardPockets) CBZ.npcGuardPockets(actor, 4);
    else if (CBZ.npcStare) CBZ.npcStare(actor, 1.7);
  }

  /* RESPECT IS EARNED IN FRONT OF PEOPLE. Winning a fight raises your standing
     with everyone who watched it — except the man on the floor and his crew,
     who now have a different opinion entirely. Nobody is told a number; what
     changes is what the yard says to you afterwards and what it charges you. */
  function witnessRespect(victim, amount, range) {
    if (!CBZ.npcs || !CBZ.player) return 0;
    const px = CBZ.player.pos.x, pz = CBZ.player.pos.z;
    range = range || 14;
    let n = 0;
    for (let i = 0; i < CBZ.npcs.length; i++) {
      const a = CBZ.npcs[i];
      if (!a || a === victim || a.dead || (a.ko || 0) > 0 || !a.group) continue;
      if (victim && a.gang >= 0 && a.gang === victim.gang) continue;   // his crew saw it too
      if (Math.hypot(a.group.position.x - px, a.group.position.z - pz) > range) continue;
      addRespect(a, amount);
      n++;
    }
    return n;
  }

  /* ROMANCE / FLIRT: DELETED. (OWNER, 2026-08-13: "remove all flirt shit from
     the game, its stupid.")

     This was a `love` scalar you raised by pressing a verb at somebody until it
     hit 100, at which point they broke you out of prison. It was the purest
     form of the thing this whole wave is against: a relationship expressed as a
     number that goes up when you press a button, with the person supplying
     dialogue lines at fixed rungs to prove the number moved.

     Nothing physical ever happened. No one ever walked over, waited for you,
     stood between you and anybody, or acted differently in a way you could see
     — the entire relationship was the counter and its captions. Escaping via
     `winGame("romance")` is gone with it; the gate, the vents, the tunnels,
     befriend and time served are all still there.

     `actor.love` is left readable where insult() still decrements it, because
     other reads are harmless and removing the field would touch save state.
  */

  // ---------- INSULT: lower rep, maybe start a fight / a hunt ----------
  const INSULT_BACK = ["Say it again. Slower.", "That's twice. There isn't a third.",
                       "You just made this personal.", "Alright. Alright."];
  const INSULT_TAKEN = ["Keep talking. See where it gets you.",
                        "I'll remember that one.",
                        "You're going to want a friend in here. It won't be me.",
                        "Big words from a man with no cell key."];
  function insult(actor) {
    actor.rep = Math.max(-50, (actor.rep || 0) - 15);
    actor.love = Math.max(0, (actor.love || 0) - 12);
    actor.playerGrudge = (actor.playerGrudge || 0) + 1.2;
    actor.grudgeWhy = "the trash you talked";
    addLoyalty(actor, -12);          // you do not insult a man you are paying
    if (actor.gang >= 0) nudgeGang(actor, -4, 1);
    if (actor.gang >= 0 && CBZ.noteGangIncident) CBZ.noteGangIncident(actor, "insult", 4, { source: "insult" });
    noteRead("fear", 3, nm(actor), 11);
    if (rng() < 0.5) {
      if (actor.kind === "guard" || actor.kind === "warden") { actor.hunt = 3; CBZ.addHeat(25); }
      else if (CBZ.provokeGang) CBZ.provokeGang(actor, 10);
      // trash talk answered in the speaker's OWN register — the warden does
      // not square up like an inmate, he files you somewhere cold
      return { ok: false, msg: pick(actor.kind === "warden" ? VOICE.wardenInsulted : INSULT_BACK) };
    }
    return { ok: true, msg: pick(actor.kind === "warden" ? VOICE.wardenIgnores : INSULT_TAKEN) };
  }

  // ---------- BEAT UP / FIGHT: knock an actor out (drives most quests) ----------
  // KO'd actors lie down, stop their AI, and (if a guard) go blind for a while.
  g.koLog = g.koLog || {};                     // { actorName: timestampish } recently downed
  function beat(actor) {
    const guardish = actor.kind === "guard" || actor.kind === "warden";
    // throwing hands has consequences either way: guards hunt, gangs retaliate
    if (guardish) actor.hunt = 3;
    else if (CBZ.provokeGang) CBZ.provokeGang(actor, 12);
    // a lifted BATON is a real weapon in a fist-fight — the point of taking
    // one off a screw is that you are now the one holding it.
    const armed = hasItem("Shiv") || hasItem("Baton");
    let chance = guardish ? 0.45 : 0.8;
    if (armed) chance += 0.2;                   // a shiv makes you scary
    if (actor.bribed > 0) chance += 0.15;       // already off-guard
    if (rng() < Math.min(chance, 0.95)) {
      actor.ko = guardish ? 16 : 10;            // seconds down
      actor.hp = Math.max(actor.hp || 0, guardish ? 55 : 45);
      actor.alert = 0;
      g.koLog[actor.data.name] = true;          // any "beat up X" quest can now complete
      g.kos = (g.kos || 0) + 1;
      if (CBZ.killstreakOnDown) CBZ.killstreakOnDown(actor, "beat");
      CBZ.reportCrime(guardish ? 26 : 16, { type: "melee", actorRole: g.role });       // a brawl only heats up if witnessed
      noteRead(guardish ? "badge" : "fear", guardish ? 18 : 14, nm(actor), guardish ? 18 : 15);
      if (actor.gang >= 0) nudgeGang(actor, -10, 2);
      if (actor.gang >= 0 && CBZ.noteGangIncident) CBZ.noteGangIncident(actor, "ko", 9, { source: "beatdown" });
      if (guardish && actor.corrupt) addRacketDebt(4);
      if (guardish && rng() < 0.5 && !hasItem("Gun-Room Key") && actor.kind === "warden") addItem("Gun-Room Key", 1);
      // A DOWNED MARK DROPS WHAT HE HAD, not what the die felt like minting.
      // Same odds, same magnitude, taken off HIS pile — so beating the same
      // man twice does not print money, and a poor man is a poor score.
      if (rng() < 0.6) {
        const load = rollLoadout(actor);
        const spill = Math.max(0, Math.min(load.cigs, 2 + Math.floor(rng() * 6)));
        if (spill) { load.cigs -= spill; addCigs(spill); announceLoot(spill, []); }
      }
      // the yard saw it. Standing goes up with everyone but his crew.
      addLoyalty(actor, -25);
      if (!guardish) {
        // the man you dropped wakes up REMEMBERING it — personally, not just
        // through his crew's ledger
        actor.playerGrudge = Math.min(14, (actor.playerGrudge || 0) + 2);
        actor.grudgeWhy = "the beating";
      }
      witnessRespect(actor, guardish ? 3 : 2, 14);
      if (CBZ.knockback) CBZ.knockback(actor, CBZ.player.pos.x, CBZ.player.pos.z, 0.9);
      return { ok: true, msg: "", beat: actor.data.name };
    }
    // whiffed it
    CBZ.reportCrime(guardish ? 40 : 14, { type: "melee", actorRole: g.role });
    noteRead(guardish ? "heat" : "fear", guardish ? 14 : 8, nm(actor), 14);
    if (actor.gang >= 0) nudgeGang(actor, -4, 1);
    if (actor.gang >= 0 && CBZ.noteGangIncident) CBZ.noteGangIncident(actor, "attack", 4, { source: "swing" });
    actor.alert = guardish ? 2.5 : 0;
    return { ok: false, msg: pick(INSULT_BACK) };
  }

  // ---------- ambient: thief inmates lift cigs off you when close ----------
  // called by entities/npc.js for role:"thief" actors.
  function thiefTick(actor, dt, distToPlayer) {
    if (actor.bribed > 0) return null;          // bribed thieves leave you be
    if (actor.gang >= 0) {
      const sameCrew = CBZ.player && CBZ.player.gang === actor.gang;
      const protectedHere = CBZ.gangProtection && CBZ.gangProtection(actor.gang) > 0;
      const standing = CBZ.gangStanding ? CBZ.gangStanding(actor.gang) : 0;
      if ((sameCrew || protectedHere) && standing > -15) return null;
    }
    if ((actor.playerTrust || 0) > 5 && (actor.playerGrudge || 0) < 4) return null;
    actor._cd = (actor._cd || 0) - dt;
    if (distToPlayer > 3.2 || actor._cd > 0) return null;
    const grudgeRush = Math.max(0, actor.playerGrudge || 0) * 0.18;
    const covered = (g.lowProfileT || 0) > 0;
    actor._cd = Math.max(2.2, (g.cigs >= 16 ? 3.5 : 6) + (covered ? 4.5 : 0) - grudgeRush) + rng() * 5; // money makes you a louder target
    if (g.cigs <= 0) return null;
    if (covered && rng() < 0.62) return null;
    const taken = Math.min(g.cigs, Math.max(1, (covered ? 1 : 2) + Math.floor(rng() * (covered ? 2 : 4))));
    addCigs(-taken);
    // WHAT HE TOOK IS NOW ON HIM. It used to become `_loot`, a flavour tally
    // nobody could ever get back; it is his pocket money now, so the man who
    // robbed you is worth robbing — which is the only satisfying answer to
    // being pickpocketed in a prison.
    const load = rollLoadout(actor);
    load.cigs += taken;
    actor._loot = (actor._loot || 0) + taken;
    actor.playerGrudge = (actor.playerGrudge || 0) + 0.7;
    noteRead("wealth", Math.min(8, 2 + taken * 1.4), nm(actor), 10);
    // SHOW THE HAND — the same reach layer the player's lift plays, on him.
    // You see an arm come out of your pocket; the counter drops; the sleeve
    // cue sells it. There is nothing left for a caption to add.
    showReach(actor.char, { arm: rng() < 0.5 ? "l" : "r", side: -1, high: 0.1, dur: 0.55 });
    CBZ.sfx("whoosh");
    return "";
  }

  /* ---------- LOADOUTS: what each actor is realistically carrying ----------
     Generated once per actor and remembered, so a dealer always has product, a
     fighter has a shank, the warden is loaded — and you loot exactly that.

     WHAT THIS PHASE ADDED, and why it is not a bigger loot table. A guard's
     pockets were a lucky dip: sixty percent of a handcuff key, a third of a
     cash roll, and nothing that had anything to do with being a prison
     officer. So the answer to "what did I just take off that man" was always
     a valuables list, never HIS KIT. Every screw now carries the three things
     every screw carries — a BATON, a TORCH and smokes — and the keys he
     carries are the keys HIS POST needs (guardPost above: the wing and the
     gate hold a KEYCARD; only the warden holds the gun room). That is the
     whole of it: the table did not get longer, it got true.

     PHASE 5 READS THIS. Security tiers want guard seniority and keycard tiers;
     `guardPost()` already answers both for every guard in the game, and the
     rank→key rows below are the one place a new tier adds a row.

     CITY SAFETY. city/take.js frisks city peds through econ.lootActor →
     rollDrops → here. City cops are kind "cop" and city peds have no `kind`,
     so the guard branch and the `inmate` gate below cannot fire on them: a
     city frisk rolls exactly what it rolled before this phase. */
  function jailInmate(a) { return !!a && a.kind === "inmate"; }
  function rollLoadout(actor) {
    if (actor.loadout) return actor.loadout;
    const items = [];
    const role = actor.role;
    const guardish = actor.kind === "guard" || actor.kind === "warden";
    const fight = (actor.ratings && actor.ratings.fighting) || 40;
    const P = actor.personality || {};
    let cigs = 1 + Math.floor(rng() * 5);
    const add = (n) => items.push(n);
    const maybe = (n, p) => { if (rng() < p) add(n); };

    if (guardish) {
      const rank = guardPost(actor).rank;
      cigs += 5 + Math.floor(rng() * 10);
      // THE KIT EVERY OFFICER WEARS. Not rolled — worn. The torch is why a
      // stolen torch leaves a dark patrol; the baton is why a stolen baton
      // arms you; the lighter and the smokes are why a screw is worth a lift
      // even when he is holding no keys at all.
      add("Baton"); add("Guard Torch"); maybe("Lighter", 0.7);
      maybe("Handcuff Key", 0.6); maybe("Cash Roll", 0.35); maybe("Burner Phone", 0.3); maybe("Painkillers", 0.3);
      /* KEYS BY POST, AND KEYS BY CLASSIFICATION (systems/prisontiers.js).
         The man whose whole job is the door is the man with the card for it,
         so the yard door has a second answer that is a PERSON. The tier's
         `keyMul` is the row a new level adds, exactly as this block's header
         promised: a higher wing runs MORE keys on MORE belts (every door is
         carded, so every officer is issued) while `stealOdds` above makes
         those belts far harder to reach. Richer marks, worse odds — that is
         what a security level is supposed to cost you. */
      const keyMul = CBZ.prisonTier && CBZ.prisonTier.enabled() ? CBZ.prisonTier.knob("keyMul") : 1;
      const key = (p) => Math.max(0, Math.min(0.95, p * keyMul));
      maybe("Cell Key", key(0.4));   // the wing keys ride on a screw's belt — steal the belt
      if (rank >= 2) maybe("Keycard", key(actor.post === "gate" || actor.post === "wing" ? 0.75 : 0.6));
      if (actor.corrupt) { maybe("Cash Roll", 0.6); maybe("Burner SIM", 0.4); maybe("Gold Tooth", 0.2); maybe("Cigarette Carton", 0.45); }
      // Guns are a CITY thing now — the jail is mostly shivs and fists. The
      // warden still rarely carries one, but firearms moved out to the streets.
      if (actor.kind === "warden") { cigs += 22; maybe("Gun-Room Key", 0.7); maybe("Luxury Watch", 0.5); maybe("Gold Chain", 0.35); maybe("Gun", 0.05); }
    } else if (role === "dealer") {
      cigs += 6 + Math.floor(rng() * 12);
      add(rng() < 0.5 ? "Powder" : "Pills"); maybe("Pruno Hooch", 0.5); maybe("Painkillers", 0.4);
      maybe("Burner Phone", 0.6); maybe("Cash Roll", 0.5); maybe("Gold Tooth", 0.22);
    } else if (role === "thief") {
      cigs += 3 + Math.floor(rng() * 8);
      maybe("Stolen Wallet", 0.7); maybe("Lockpick", 0.5); maybe("Burner SIM", 0.3);
      maybe("Luxury Watch", 0.12); maybe("Gold Chain", 0.12); maybe("Cash Roll", 0.2);
    } else if (role === "merchant") {
      cigs += 4 + Math.floor(rng() * 10);
      maybe("Ramen", 0.5); maybe("Cigarette Carton", 0.5); maybe("Energy Bar", 0.5); maybe("Lighter", 0.5); maybe("Cash Roll", 0.3);
    } else { // generic inmate — flavoured by how hard they are
      if (fight > 72) { maybe("Shiv", 0.6); maybe("Brass Knuckles", 0.4); }
      else if (fight > 50) maybe("Shiv", 0.3);
      maybe("Pruno Hooch", 0.3); maybe("Cigarette Carton", 0.2); maybe("Tattoo Gun", 0.15);
      maybe("Bedsheet Rope", 0.2); maybe("Lighter", 0.3); maybe("Soap", 0.2); maybe("Contraband Map", 0.1);
      /* CONTRABAND BY CHARACTER, not by coin flip. entities/npc.js has spent
         the whole game authoring personalities (greed / nerve / loyalty /
         snitch) and behaviors ("predator", "opportunist", "pacifist") that
         NOTHING in the economy ever read — so a pacifist chaplain and a yard
         predator carried statistically identical pockets. A man's pockets are
         a character sheet; these four lines make them one. Gated to prison
         inmates so a city frisk is untouched. */
      if (jailInmate(actor)) {
        const greed = P.greed == null ? 0.5 : P.greed;
        const nerve = P.nerve == null ? 0.5 : P.nerve;
        const loyal = P.loyalty == null ? 0.5 : P.loyalty;
        const rat = P.snitch == null ? 0.5 : P.snitch;
        const b = actor.behavior || "";
        cigs += Math.floor(greed * 6);                                   // a greedy man hoards
        if (nerve > 0.62 || b === "predator" || b === "bully") { maybe("Shiv", 0.55); maybe("Brass Knuckles", 0.3); }
        if (greed > 0.6 || b === "opportunist") { maybe("Stolen Wallet", 0.45); maybe("Cash Roll", 0.22); }
        if (rat > 0.6) maybe("Burner SIM", 0.35);                        // somebody he calls
        if (loyal > 0.7 || b === "protector") maybe("Cigarette Carton", 0.3); // he carries for the crew
        if (b === "pacifist") { maybe("Soap", 0.5); maybe("Energy Bar", 0.35); }
        if ((actor.ratings && actor.ratings.cunning) > 70) maybe("Lockpick", 0.3);
        if ((actor.ratings && actor.ratings.stealth) > 65) maybe("Contraband Map", 0.28);
      }
    }
    if (actor.gang >= 0) { cigs += 2 + Math.floor(rng() * 6); maybe("Shiv", 0.4); maybe("Cash Roll", 0.25); maybe("Burner SIM", 0.2); }
    // a rare jackpot on anyone
    if (rng() < 0.06) add(VALUABLES[Math.floor(rng() * VALUABLES.length)]);

    actor.loadout = { cigs, items };
    return actor.loadout;
  }

  /* A POCKET THAT ONLY EXISTS ONCE SOMEBODY REACHES INTO IT IS NOT A POCKET.
     rollLoadout has always been LAZY — minted on first frisk and cached — which
     is invisible to the player but wrong for everything that wants to ASK what
     a person is carrying without taking it: a guard who has lost his torch
     patrols dark (entities/guards.js reads `flashlightLost`), a phase that
     wants to know which officer holds a card, a probe that wants to count the
     prison's money. So every body in the jail gets its real pockets on the
     first tick after the cast is built, once, and the lazy path stays as the
     fallback for anyone spawned later (crowd rigs bring their own).
     Escape only: city peds are city/take.js's business and stay lazy. */
  let _minted = 0;
  function mintLoadouts() {
    const lists = [CBZ.guards, CBZ.npcs];
    let n = 0;
    for (let q = 0; q < lists.length; q++) {
      const arr = lists[q]; if (!arr) continue;
      for (let i = 0; i < arr.length; i++) {
        const a = arr[i];
        if (!a || a._crowd || a.loadout) continue;
        rollLoadout(a);
        if (a.kind === "guard" || a.kind === "warden") guardPost(a);   // stamp post+rank
        n++;
      }
    }
    _minted = n;
    return n;
  }
  let _mintPending = true;
  CBZ.onUpdate(44.5, function () {
    if (!_mintPending || g.mode !== "escape") return;
    if (!CBZ.guards || !CBZ.npcs || !CBZ.npcs.length) return;   // cast not built yet
    _mintPending = false;
    mintLoadouts();
  });

  /* THE RENTED SHIFT BURNS IN REAL SECONDS, like every other window in the
     prison (systems/detection.js runs racketProtectionT the same way and on
     the same clock). Ninety seconds is long enough to walk across a yard to
     the man you wanted and short enough that you cannot bank it. */
  CBZ.onUpdate(44.6, function (dt) {
    if (g.mode !== "escape" || !(g.phoneTimeT > 0)) return;
    g.phoneTimeT = Math.max(0, g.phoneTimeT - (dt || 0));
  });

  /* ------------------------------------------------------------------
     THE ONE DROP ROLL.

     rollLoadout() above is the ONE TABLE — the maybe() block that decides
     what a warden, a dealer, a thief or a gang inmate is actually carrying.
     This is the ONE ROLL against it: it TAKES what comes off the body and
     hands the set to whoever asked. Two consumers, and the split is exactly
     why it exists:

       · lootActor()      — the frisk. You take it straight into the bag.
       · CBZ.prisonDrop() — systems/prisondrops.js. The SAME set becomes
                            physical objects lying on the floor next to the
                            body. OWNER: "when someone dies things they drop
                            are the actual things".

     Because the roll CONSUMES, a corpse can never pay out twice: whichever
     consumer gets there first empties the pockets, and the other finds an
     already-looted body and returns nothing. That is the whole reason this
     is one function and not two tables.

       opts.pickpocket   partial + repeatable (leaves the body lootable)
       opts.peek         read WITHOUT taking (nothing is consumed)
     ------------------------------------------------------------------ */
  let _deathFrisks = 0, _koFrisks = 0, _pickpockets = 0, _rolls = 0;
  function rollDrops(actor, opts) {
    opts = opts || {};
    if (!actor) return { cigs: 0, items: [] };
    const load = rollLoadout(actor);
    if (opts.peek) return { cigs: load.cigs, items: load.items.slice() };
    _rolls++;
    if (opts.pickpocket) {
      _pickpockets++;
      const cigs = Math.min(load.cigs, 1 + Math.floor(rng() * 4));
      load.cigs -= cigs;
      const items = [];
      if (load.items.length && rng() < 0.5) items.push(load.items.splice(Math.floor(rng() * load.items.length), 1)[0]);
      return { cigs: cigs, items: items };
    }
    actor.looted = true;                       // the pockets are empty now
    const out = { cigs: load.cigs, items: load.items.slice() };
    load.items.length = 0; load.cigs = 0;
    return out;
  }

  /* ONE QUIET LINE PER THING YOU TOOK.
     OWNER, verbatim: "a popup on screen luxury watch in red huge in screen
     that's dumb af". The old announce was a flashHint list PLUS a full-screen
     flashToast shout for anything rare or epic. A toast is the world shouting
     at you; putting something in your pocket is not that. systems/hud.js owns
     CBZ.pickupNote (the corner ticker); until it is present we degrade to one
     compact hint line — never to a toast, and never one hint per item, which
     would just overwrite itself four times. */
  function isRare(n) { const it = ITEMS[n]; return !!(it && (it.rarity === "rare" || it.rarity === "epic")); }
  function announceLoot(cigs, items) {
    if (CBZ.pickupNote) {
      // one row per thing, and the feed COLLAPSES repeats into "×N" itself —
      // so the count goes in opts.count, never also into the name, or a
      // twelve-cigarette haul reads "12 cigarettes ×12".
      for (let i = 0; i < items.length; i++) CBZ.pickupNote(items[i], { rare: isRare(items[i]) });
      if (cigs > 0) CBZ.pickupNote("Cigarettes", { count: cigs });
      return;
    }
    const parts = [];
    if (cigs > 0) parts.push(cigs + " cigs");
    for (let i = 0; i < items.length; i++) parts.push(items[i]);
    if (parts.length) CBZ.flashHint && CBZ.flashHint(parts.join(", "), 1.8);
  }

  // Loot a downed/KO'd actor: grant everything they carry, once, quietly.
  // pickpocket=partial-and-repeatable; otherwise it's a full frisk. The roll
  // itself lives in rollDrops above — this is only the GRANT + the note.
  function lootActor(actor, opts) {
    opts = opts || {};
    if (!actor || actor.looted) return null;
    // THE RATCHET READS HERE, NOT IN THE ROLL. A frisk on a body that is
    // already DEAD is loot teleporting into the bag instead of landing on the
    // floor — the owner's complaint, counted. A frisk on a KO'd body is a
    // different thing entirely (you searched a man who gets up again) and is
    // counted separately. Escape only: city bodies are morgue.js's beat and
    // city/take.js's frisk there is an explicit walk-up verb, not a payout.
    if (!opts.pickpocket && CBZ.game && CBZ.game.mode === "escape") {
      if (actor.dead) _deathFrisks++; else _koFrisks++;
    }
    const got = rollDrops(actor, { pickpocket: !!opts.pickpocket });
    const cigs = got.cigs, items = got.items;
    if (cigs) addCigs(cigs);
    for (let i = 0; i < items.length; i++) addItem(items[i], 1);
    if (!opts.silent && (cigs > 0 || items.length)) {
      announceLoot(cigs, items);
      CBZ.sfx && CBZ.sfx("loot");
    }
    return { cigs: cigs, items: items };
  }

  // A NEW RUN puts everybody back on their feet, so it has to put their
  // pockets back too. rollLoadout CACHES on the actor and rollDrops empties
  // it, so without this a restarted prison run frisks nothing but hollow
  // bodies — and every physical death drop would be a body with nothing to
  // leave. Called by systems/prisondrops.js when it sees the clock restart.
  function resetLoadouts() {
    const lists = [CBZ.npcs, CBZ.guards];
    let n = 0;
    for (let q = 0; q < lists.length; q++) {
      const arr = lists[q]; if (!arr) continue;
      for (let i = 0; i < arr.length; i++) {
        const a = arr[i]; if (!a) continue;
        a._dropped = false;
        // entities/crowd.js's pooled inmates own their own pockets — assignRig
        // writes a fresh loadout out of the analytical store every time a rig
        // is handed to a new person, so nulling it here would only replace a
        // real one with a generic re-roll.
        if (a._crowd) { n++; continue; }
        a.loadout = null; a.looted = false; n++;
        // AND THE SOCIAL LEDGER GOES WITH THE POCKETS. Loyalty is the one
        // thing in this file that is deliberately permanent WITHIN a run — a
        // bought screw stays bought — so the new run is the only place it can
        // possibly be cleared. `flashlightLost` is the same shape: a stolen
        // torch is gone until the man is issued a new one, which is a restart.
        // ...and so is "this officer has already explained the phone to me
        // once": a new run is a man who has not had that conversation yet.
        a.loyalty = 0; a.flashlightLost = false; a._friendGift = 0; a._saidNoPhone = 0;
      }
    }
    _deathFrisks = 0; _koFrisks = 0; _pickpockets = 0; _rolls = 0;
    // A RENTED PHONE DOES NOT SURVIVE THE RUN THAT RENTED IT. systems/state.js
    // zeroes the racket fields on a new run but knows nothing about this one,
    // so the window and the once-a-run honest line are cleared here, beside
    // the loyalty ledger they belong with.
    g.phoneTimeT = 0; g._phoneBridgeSaid = 0;
    // re-arm the cast-time mint so the fresh run has real pockets from frame one
    _mintPending = true;
    return n;
  }

  /* RATCHET — CBZ.econ.lootAudit()
       deathFrisks  full frisks paid out on an ALREADY-DEAD body, i.e. loot
                    that teleported into your bag instead of landing on the
                    floor where the owner asked it to land. PIN AT 0: every
                    death should reach the player through CBZ.prisonDrop.
       itemToasts   structurally 0 — there is no flashToast path left in this
                    file, so a re-introduced item shout shows up here.        */
  function lootAudit() {
    return {
      rolls: _rolls, deathFrisks: _deathFrisks, koFrisks: _koFrisks,
      pickpockets: _pickpockets, itemToasts: 0,
    };
  }

  // itemStore() — the ONE mode-aware item-store accessor: city → CBZ.cityEcon,
  // escape/survival → g.inventory with an explicit COUNT (takeItem above only
  // ever removes one at a time). Consumers: buildmode.js placement costs,
  // baseclaim.js upkeep. Lived in systems/craft.js until crafting was deleted
  // (owner mandate "kill crafting", 2026-08-03); the accessor was the only
  // live organ in that file.
  function itemStore() {
    if (g.mode === "city") {
      const E = CBZ.cityEcon;
      return {
        count: function (n) { return E ? E.count(n) : 0; },
        take: function (n, c) { return E ? E.take(n, c) : false; },
        add: function (n, c) { if (E) E.add(n, c); },
      };
    }
    return {
      count: function (n) { return (g.inventory && g.inventory[n]) || 0; },
      take: function (n, c) {
        const have = (g.inventory && g.inventory[n]) || 0;
        if (have < c) return false;
        g.inventory[n] -= c;
        if (g.inventory[n] <= 0) delete g.inventory[n];
        if (CBZ.refreshInventory) CBZ.refreshInventory();
        return true;
      },
      add: function (n, c) {
        g.inventory = g.inventory || {};
        g.inventory[n] = (g.inventory[n] || 0) + c;
        if (CBZ.refreshInventory) CBZ.refreshInventory();
      },
    };
  }

  /* CBZ.socialAudit() — the phase's own diagnostics, and one number that is
     meant to stay at zero: `unminted` counts bodies in the jail whose pockets
     are still a promise instead of a fact. If it climbs, somebody is spawning
     actors after the cast-time mint without going through rollLoadout. */
  CBZ.socialAudit = function () {
    const lists = [CBZ.guards, CBZ.npcs];
    let unminted = 0, bodies = 0, cigsHeld = 0, keysHeld = 0, torches = 0, loyal = 0, bought_ = 0;
    for (let q = 0; q < lists.length; q++) {
      const arr = lists[q]; if (!arr) continue;
      for (let i = 0; i < arr.length; i++) {
        const a = arr[i]; if (!a) continue;
        bodies++;
        if (!a.loadout) { if (!a._crowd) unminted++; continue; }
        cigsHeld += a.loadout.cigs | 0;
        for (let k = 0; k < a.loadout.items.length; k++) {
          const it = a.loadout.items[k];
          if (/key|card/i.test(it)) keysHeld++;
          if (it === "Guard Torch") torches++;
        }
        if (loyaltyOf(a) > 0) loyal++;
        if (bought(a)) bought_++;
      }
    }
    return {
      bodies, unminted, minted: _minted, cigsHeld, keysHeld, torches,
      loyal, bought: bought_, respectCeil: RESPECT_CEIL,
      block: blockId(), counting: counting(), night: afterDark(),
      groundCigs: (CBZ.coins || []).length,
      // the bridge, so a probe can ask the game rather than infer it
      phoneBridge: phoneBridge(),
      phoneAccess: hasPhoneAccess(),
      phoneOwned: hasItem("Burner Phone"),
      phoneTimeT: Math.round((g.phoneTimeT || 0) * 10) / 10,
      racketDebt: Math.round(g.racketDebt || 0),
      racketDebtCeil: RACKET_DEBT_CEIL,
    };
  };

  CBZ.econ = { talk, trade, bribe, payoff, snitch, snitchOffer, steal, beat, insult, thiefTick, addCigs, addItem, hasItem, takeItem, itemStore, pickOffer, offerPrice, offerLine, payoffCost, bribeCost, rollLoadout, rollDrops, lootActor, resetLoadouts, mintLoadouts, lootAudit, announceLoot, isRare, ITEMS, SELLABLE, DRUGS, VALUABLES, SERVICES, isService, rng, reseed,
    // the phone bridge — ask these, never re-derive the rule or the words
    hasPhoneAccess, phoneGate, phoneTerms, grantPhoneTime, consumePhoneTime, phoneBridge, outsidePaidPrefix, PHONE_TIME_SECS,
    // the one writer on g.racketDebt (also CBZ.addRacketDebt)
    addRacketDebt, RACKET_DEBT_CEIL,
    // the social layer — read these, never re-derive them
    socialRead, respectOf, loyaltyOf, addRespect, addLoyalty, guardPost, stealOdds, witnessRespect, voice: VOICE, pickLine: pick };
  CBZ.socialRead = socialRead;     // the one accessor other systems adopt
})();
