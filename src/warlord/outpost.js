/* ============================================================
   warlord/outpost.js — WHERE YOU SPEND WHAT YOU TOOK.

   An outpost is STOCK AND A PRICE LIST. That is deliberately all it is.
   There is no upgrade tree, no building to level, no garrison slider. The
   owner was specific about this: "you can purchase weapons at weapon sales
   outposts you find in the desert or increase army size at the outposts you
   aren't upgrading — they just have a number of each type of gun for sale."
   The moment an outpost becomes a thing you IMPROVE, the game stops being
   about the army and starts being about the menu.

   So there are four kinds and each one does exactly one thing:

     ARMS DEPOT    a crate list. N of this gun, at this price. Buys surplus.
     RECRUIT CAMP  a number of men, by tier, at a price. Finite.
     WELL / OASIS  rest. Clears `wounded`, costs gold and a day.
     NIGHT MARKET  the good guns at triple, and the only honest price for
                   the forty looted pistols nobody else wants.

   WHY FINITE STOCK IS THE WHOLE DESIGN. An infinite shop is a slider: you
   type in how much money you have and the game hands you the answer. A
   depot with six AKs in the crate is a DECISION — buy them now at this
   price, or ride four days to the coast where they are cheaper and hope
   nobody got there first. Emptying a depot and coming back on day nine to
   find it restocked is the only reason to re-cross a map this size.

   NOTHING HERE IS TYPED. Every price comes off W.gunPrice / W.tier().hire,
   every stock count comes off the depot's capital divided by what the gun
   costs, and what a depot carries at all comes off W.gunRarity. Add a gun
   to weapons/weapon-data.js tomorrow and it appears in the crates at a sane
   price and a sane rarity with no edit here.

   AND IT DOES NOT OWN A PHASE ANY MORE. CONTRACT.md's table used to give this
   file the "outpost" phase; taking it fired phase:leave:campaign, and
   campaign.js answers that by hiding the island, the men, the huts and its own
   HUD — so trading switched the world off behind the panel. A phase is a claim
   that one module owns the SCREEN, and a docked rail does not: it is a thing
   that happens OVER the campaign, exactly as events.js and territory.js
   already are. See THE PANEL and open() below. Nothing sets W.state.phase to
   "outpost" from here; the enum in core.js keeps the name for save files.

   2026-09-01 — THE RAIL STOPPED SAYING ITS OWN NAME THREE TIMES. Three of
   the four kinds carried a `tag` (the rail's subtitle) that repeated the
   title — "ARMS DEPOT / GUNS & ARMOUR" — and each panel then repeated it a
   third time in its own heading. All three are gone; the night market's tag
   stays because "NO QUESTIONS" is a fact its name does not carry. See KINDS
   and panelBuy.

   EVENTS: outpost:place outpost:open outpost:close outpost:buy
           outpost:sell outpost:hire outpost:rest outpost:restock

   FLAGS: ?stock=old   infinite flat-price stock (the first draft)
          ?outfit=old  the whole outfitting wave reverted (implies ?stock=old
                       and loadout.js's ?autoarm=old)
============================================================ */
(function () {
  "use strict";
  const G = (typeof window !== "undefined" ? window : globalThis);
  const CBZ = (G.CBZ = G.CBZ || {});
  const W = (CBZ.warlord = CBZ.warlord || {});
  if (!W.state) { console.error("[warlord] outpost.js loaded without core.js"); return; }

  const Q = new URLSearchParams(G.location ? G.location.search : "");
  const OLD_WAVE = Q.get("outfit") === "old";
  const OLD_STOCK = OLD_WAVE || Q.get("stock") === "old";
  const clamp = W.clamp;

  /* THE EXPLOSIVE-PRICING BUG THIS FILE USED TO PATCH IS GONE. An earlier
     core.js priced a rocket launcher at $18 off weapon-data's placeholder
     `damage: 1`, and W.gunRarity then made it the commonest thing in the
     desert; outpost.js carried a correction for it. core.js now prices
     explosives off the blast itself, so the correction was deleted rather
     than left in to rot into a second opinion about what a gun is worth. */

  /* ============================================================ THE KINDS
     `capital` is the money this outpost has tied up in stock — the ONE number
     that decides how many of a thing sits in the crate, because a depot
     holding $700 of guns can stack ten pistols or one launcher and not both.
     Retuned once, when core.js replaced its price curve: at the old flat
     curve $1600 filled every shelf to the cap and "finite stock" was a lie
     on the label. Measured against the current list, $700 gives a depot ten
     sidearms, six AKs, five LMGs and at most one launcher. */
  /* AND `accent` IS HOW A KIND FEELS DIFFERENT WITHOUT A SENTENCE ABOUT IT.
     Every row this file draws is tinted by the place it is standing in — the
     stock fill behind the name, the fight hairline under it, the ring around
     the price. A depot is the game's own orange, a camp is the veteran gold
     off army.js's composition bar, a well is water, and the night market is
     the one colour nothing else in this game uses. Four places you can tell
     apart with the words covered up, which is the test.

     `blurb` IS GONE, all four of them, and that deletion is the owner's
     second complaint. They read "crates off a boat", "men at the water,
     looking for a warlord", "lamps, tarpaulin, and a man who does not ask
     where you got it" — and the world at an outpost is five boxes and a flag
     on a mast. This file owns no meshes and cannot see the world, so every
     sentence it wrote about one was a claim it had no way to check. What it
     owns is stock and prices; those are true whatever is standing on the
     sand, and they are now all it says. */
  const KINDS = W.OUTPOST_KINDS = {
    /* `tag` IS THE RAIL'S SUBTITLE AND THREE OF THE FOUR WERE THE TITLE AGAIN.
       "ARMS DEPOT / GUNS & ARMOUR", "RECRUIT CAMP / MEN FOR HIRE", "WELL /
       WATER" — the header line said the same thing twice on a strip that has
       to fit a 375 px phone, and the panel under it then said it a third time
       in its own heading. Only the night market's tag carries a fact the name
       does not, so only the night market keeps one. Empty tag = no subtitle. */
    depot: {
      id: "depot", label: "ARMS DEPOT", tag: "", accent: "#ff8a3d",
      capital: 700, lines: 7, buys: 0.34, armour: ["vest", "plate"],
    },
    camp: {
      id: "camp", label: "RECRUIT CAMP", tag: "", accent: "#ffd166",
      capital: 320,
    },
    well: {
      id: "well", label: "WELL", tag: "", accent: "#6fb7d8",
    },
    market: {
      id: "market", label: "NIGHT MARKET", tag: "NO QUESTIONS", accent: "#c78bff",
      /* THE FOURTH KIND EARNS ITS PLACE by doing the two things a depot
         refuses to. (1) It carries the top of the price list on DEMAND —
         rarity does not gate it, so a launcher is buyable if you can pay
         three times list, which is the only way to plan around one. (2) It
         pays 0.55 on the dollar instead of 0.34, which is the difference
         between hauling forty looted pistols to a market and leaving them
         on the sand. Without it, loot below rifle grade has no exit and the
         aftermath screen is a list of things you throw away. */
      capital: 1400, lines: 6, buys: 0.55, markup: 3.0,
      armour: ["plate", "heavy"], top: true,
    },
  };

  /* ============================================================ NAMES
     Deterministic from the position, so a save, a reload and a network peer
     all call the same well by the same name. */
  const PRE = ["AL-", "BIR ", "WADI ", "SIDI ", "KHOR ", "RAS ", "DAR ", "AIN ", "TEL ", "QASR "];
  const ROOT = ["HARIQ", "SUMAYL", "TASSILI", "MARAH", "GHURD", "ZALLAF", "TEKNA", "ASHAB",
                "NEFUD", "SEBKHA", "DHALIA", "KUFRA", "AWBARI", "MISRAT", "SIRTE", "TAMANRA"];
  function nameFor(x, z, kind) {
    const a = PRE[Math.floor(W.hash01(x, z, 17) * PRE.length) % PRE.length];
    const b = ROOT[Math.floor(W.hash01(x, z, 31) * ROOT.length) % ROOT.length];
    const base = a + b;
    if (kind === "well") return base + " WELL";
    if (kind === "camp") return base + " CAMP";
    if (kind === "market") return "THE MARKET AT " + base;
    return base + " DEPOT";
  }

  /* ============================================================ PLACEMENT
     WHERE A THING IS IS AN ARGUMENT ABOUT WHAT IT IS. An arms depot is where
     the boats land, so it sits near the shore. A recruit camp and a well are
     where the water is, so they sit on the oases — men and water are the same
     problem. The night market is deep in the interior where nobody official
     goes. None of that is decoration: it means "I need rifles" and "I need
     men" send you to opposite ends of the island, which is the only thing
     making a 14 km map a map rather than a loading screen. */
  function radius() { return (W.desert && W.desert.RADIUS) || 7000; }

  function landAt(want) {
    /* desert.js may not be loaded (another agent owns it) or may not honour
       an option I invented, so every path here has to survive both. */
    if (W.desert && W.desert.landPoint) {
      try {
        const p = W.desert.landPoint(W.rnd, want);
        if (p && isFinite(p.x) && isFinite(p.z)) return { x: p.x, z: p.z };
      } catch (e) {}
    }
    // fallback: polar, inside the island, at the requested band from centre
    const R = radius();
    const ang = W.rnd() * Math.PI * 2;
    const f = clamp((want && want.frac != null ? want.frac : 0.5) + W.range(-0.09, 0.09), 0.05, 0.94);
    return { x: Math.cos(ang) * R * f, z: Math.sin(ang) * R * f };
  }

  function nearOasis(i) {
    const list = (W.desert && W.desert.oases) || null;
    if (!list || !list.length) return null;
    const o = list[i % list.length];
    if (!o || !isFinite(o.x) || !isFinite(o.z)) return null;
    const r = (o.r || 260) * W.range(0.5, 1.15);
    const a = W.rnd() * Math.PI * 2;
    return { x: o.x + Math.cos(a) * r, z: o.z + Math.sin(a) * r };
  }

  /* THE PATTERN, not a random draw. A campaign that rolls four wells and no
     depot is not "variety", it is a broken save the player cannot tell from
     bad luck. The cycle guarantees the mix; where each one lands is still
     random. */
  const PATTERN = ["depot", "camp", "well", "depot", "camp", "market", "depot", "well", "camp"];

  function place(count) {
    const S = W.state;
    const n = count == null ? 9 : Math.max(1, count | 0);
    S.outposts.length = 0;
    for (let i = 0; i < n; i++) {
      const kind = PATTERN[i % PATTERN.length];
      let p = null;
      if (kind === "camp" || kind === "well") p = nearOasis(i);
      if (!p) {
        p = landAt(kind === "depot" ? { shore: true, frac: 0.82 }
          : kind === "market" ? { frac: 0.3 }
          : { frac: 0.55 });
      }
      S.outposts.push(build(kind, p.x, p.z));
    }
    W.emit("outpost:place", S.outposts);
    return S.outposts;
  }

  function build(kind, x, z) {
    const K = KINDS[kind] || KINDS.depot;
    const R = radius();
    const d = Math.sqrt(x * x + z * z);
    /* MARKUP RIDES WITH HOW FAR INLAND THE CRATE HAD TO BE CARRIED. Guns
       arrive by boat; every kilometre from the water is a kilometre somebody
       was paid to walk. So the coast is cheap and well stocked and the
       interior is dear and thin, and "ride to the coast to re-arm" becomes a
       real plan rather than a flavour line. (The brief said "a depot on the
       far shore charges more" — same idea, but this way the reason is on the
       map instead of in my head.) */
    const inland = clamp(1 - d / Math.max(1, R), 0, 1);
    const jitter = W.hash01(x, z, 53) * 0.2 - 0.1;
    const o = {
      id: "o" + W.nextId(),
      kind: K.id, name: nameFor(x, z, K.id),
      /* THE WORDS COME OUT OF THE KINDS TABLE, HERE, ONCE. campaign.js was
         stamping label and note onto every outpost it made, with a comment
         explaining that build() "does not copy them onto the object it
         builds, so the campaign nameplate read MARA undefined undefined over
         every oasis on the island". That is a repair in the caller for a hole
         in this constructor, and it only covered the one caller — a market
         built through this function directly still hung "THE MARKET AT WADI
         NEFUD undefined undefined" over the sand, which is how it was found.
         The table that knows the words fills them in. */
      label: K.label, note: K.tag,
      x: x, z: z,
      markup: (K.markup || 1) * (0.86 + inland * 0.46 + jitter),
      stock: {}, armourStock: {}, pool: {},
      day: W.state.day, seen: false,
    };
    if (K.capital != null) o.capital = Math.round(K.capital * (0.75 + inland * 0.5));
    if (K.id === "depot" || K.id === "market") fillCrates(o);
    if (K.id === "camp") fillPool(o);
    return o;
  }

  /* ============================================================ THE CRATES
     Three derived numbers and no typed ones.

     WHICH GUNS. A hash roll against W.gunRarity^2.5, so a depot's character
     is a property of WHERE IT IS and never changes: the depot at Bir Kufra
     always deals in AKs, and the player learns that the way you learn a shop.
     The EXPONENT is not decoration. W.gunRarity says how common a gun is in
     the world; the chance that one particular seven-line crate list happens
     to carry it is a rarer event than that, and 2.5 is the power that puts
     the design's stated target on the board. Measured against the current
     price list: sidearm 0.57, AK 0.49, LMG 0.45, RPG 0.18 — a launcher at a
     depot one time in five and a half — grenade launcher 0.01, which is why
     the night market exists.

     HOW MANY LINES. Capped, because a crate list is not a supermarket — and
     because thirteen rows of gun at 393pt is a screen you scroll instead of
     read. The cap is doing UI work as much as fiction work.

     HOW MANY OF EACH. The depot's capital divided by what the gun costs.
     That single division is why a $70 sidearm comes ten to a crate and a
     $500 launcher comes alone, with nothing typed and nothing to retune when
     a weapon is added. */
  function fillCrates(o) {
    const K = KINDS[o.kind];
    const guns = W.gunList();
    if (OLD_STOCK) {
      // ?stock=old — the first draft: everything, always, at flat list price.
      for (let i = 0; i < guns.length; i++) o.stock[guns[i].id] = 99;
      for (let i = 0; i < W.ARMOUR.length; i++) {
        if (W.ARMOUR[i].id !== "none") o.armourStock[W.ARMOUR[i].id] = 99;
      }
      return;
    }
    // hash-ordered walk so the SAME depot always considers guns in the same
    // order — a restock must never be able to change what a depot deals in.
    const order = guns.slice().sort(function (a, b) {
      return W.hash01(o.x, o.z, hashOf(a.id)) - W.hash01(o.x, o.z, hashOf(b.id));
    });
    let lines = 0;
    for (let i = 0; i < order.length && lines < (K.lines || 7); i++) {
      const id = order[i].id;
      const roll = W.hash01(o.x, o.z, hashOf(id) + 7);
      /* The night market is the exception that defines the rule: above the
         top of the list it ignores rarity entirely, which is precisely what
         makes it the place you go for the thing you cannot find. The
         threshold is read off the price list itself (see topOf) rather than
         typed, so it still means "the expensive end" after the next retune. */
      const ok = K.top
        ? (W.gunPrice(id) >= topOf() || roll < Math.pow(W.gunRarity(id), 2.5) * 0.4)
        : roll < Math.pow(W.gunRarity(id), 2.5);
      if (!ok) continue;
      lines++;
      o.stock[id] = shelf(o, id);
    }
    const arm = K.armour || [];
    for (let i = 0; i < arm.length; i++) {
      const A = W.armour(arm[i]);
      if (!A || !A.price) continue;
      o.armourStock[A.id] = clamp(Math.round(o.capital / (A.price * 2.4)), 1, 12);
    }
  }
  function shelf(o, id) {
    return clamp(Math.round(o.capital / Math.max(20, W.gunPrice(id))
      * (0.7 + W.hash01(o.x, o.z, hashOf(id) + 11) * 0.6)), 1, 16);
  }
  /* "THE EXPENSIVE END", read off the armoury rather than typed: 1.8× the
     median list price. On the current list that is $126, which admits the
     LMG, the RPG and the grenade launcher and nothing below them. Cached
     because it is asked once per gun per depot at placement time. */
  let TOP = 0;
  function topOf() {
    if (TOP) return TOP;
    const ps = W.gunList().map(function (w) { return W.gunPrice(w.id); }).sort(function (a, b) { return a - b; });
    if (!ps.length) return (TOP = 1e9);
    return (TOP = ps[Math.floor(ps.length / 2)] * 1.8);
  }
  function hashOf(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h & 0x7fffffff;
  }

  /* ============================================================ THE POOL
     A CAMP IS A NUMBER OF MEN, and the number falls off with the tier for the
     same reason the price rises: the camp's capital buys fourteen farmhands
     or one veteran. Same division as the crates, same absence of typed
     numbers, and it means "where do I find veterans" has a real answer
     (nowhere, in quantity — you promote them). */
  function fillPool(o) {
    for (let i = 0; i < W.TIERS.length; i++) {
      const T = W.TIERS[i];
      o.pool[T.id] = clamp(Math.round(o.capital / T.hire
        * (0.7 + W.hash01(o.x, o.z, 71 + i) * 0.6)), i >= 3 ? 0 : 1, 30);
    }
  }
  function hirePrice(o, tierId) {
    const T = W.tier(tierId);
    // the premium for a better tier is on TOP of his wage-derived hire price:
    // a camp knows what a veteran is worth to you.
    return Math.max(5, Math.round(T.hire * o.markup * (1 + 0.14 * W.tierIndex(tierId)) / 5) * 5);
  }

  function buyPrice(o, id) { return Math.max(5, Math.round(W.gunPrice(id) * o.markup / 5) * 5); }
  function sellPrice(o, id) {
    const K = KINDS[o.kind] || KINDS.depot;
    /* A SCARCE MARKET BIDS UP BOTH SIDES — the interior charges more AND pays
       more, which is the only economically honest way to do it. It is not an
       arbitrage: the 0.34 spread is an order of magnitude wider than the 0.46
       of markup range, so hauling guns between depots always loses money. The
       spread IS the sink, exactly as core.js says. */
    return Math.max(5, Math.round(W.gunPrice(id) * (K.buys || 0.34) * o.markup / 5) * 5);
  }
  function armourBuyPrice(o, id) { return Math.max(5, Math.round(W.armour(id).price * o.markup / 5) * 5); }
  function armourSellPrice(o, id) {
    const K = KINDS[o.kind] || KINDS.depot;
    return Math.max(0, Math.round(W.armour(id).price * (K.buys || 0.34) * o.markup / 5) * 5);
  }

  /* ============================================================ RESTOCK
     THE REASON TO RE-CROSS THE MAP. A depot you emptied on day 3 has to be
     worth the ride back on day 9 or the island is a one-way street.

     Per line, per dawn, a roll against the gun's own rarity decides whether a
     resupply came in at all, and if it did it lands a quarter of the shelf.
     That makes pistols effectively continuous and a launcher a genuine event
     (rarity 0.05 → one delivery every ~20 days), with no restock table and
     nothing to keep in step with the price list. Men are not guns: they walk
     in every morning, so the camp pool has no roll. */
  function restock(o) {
    if (o.kind === "camp") {
      for (const t in o.pool) {
        const cap = capPool(o, t);
        if (o.pool[t] < cap) o.pool[t] = Math.min(cap, o.pool[t] + Math.max(1, Math.ceil(cap * 0.22)));
      }
      return;
    }
    if (o.kind === "well") return;
    for (const id in o.stock) {
      const cap = shelf(o, id);
      if (o.stock[id] >= cap) continue;
      if (!W.chance(clamp(W.gunRarity(id), 0.05, 0.9))) continue;
      o.stock[id] = Math.min(cap, o.stock[id] + Math.max(1, Math.ceil(cap * 0.25)));
    }
    const K = KINDS[o.kind] || KINDS.depot;
    const arm = K.armour || [];
    for (let i = 0; i < arm.length; i++) {
      const A = W.armour(arm[i]);
      const cap = clamp(Math.round(o.capital / (A.price * 2.4)), 1, 12);
      if ((o.armourStock[A.id] || 0) < cap) o.armourStock[A.id] = Math.min(cap, (o.armourStock[A.id] || 0) + 1);
    }
  }
  function capPool(o, tierId) {
    const i = W.tierIndex(tierId);
    return clamp(Math.round(o.capital / W.tier(tierId).hire
      * (0.7 + W.hash01(o.x, o.z, 71 + i) * 0.6)), i >= 3 ? 0 : 1, 30);
  }

  W.on("dawn", function () {
    const S = W.state;
    for (let i = 0; i < S.outposts.length; i++) restock(S.outposts[i]);
    W.emit("outpost:restock", S.outposts.length);
  });

  /* ============================================================ THE PANEL
     ARRIVING SOMEWHERE IS NOT A DOCUMENT.

     THE OWNER, mid-match, and this is the thing that made him stop playing:

       "I GET A MAN WITH A CRATE POPUP IN GAME WITHOUT A FUCKING MAN IN FRONT
        OF ME AND IT COVERS THE SCREEN, RUINING THE FUCKING GAME ... RN WE
        HAVE BARREN DESERT AND MAN WITH A CRATE POPUP WITH NO MAN THERE"

     Two failures in one sentence.

     ONE: IT COVERED THE SCREEN. Measured on origin/main, seed 1337, a depot
     open: 823 px of markup crammed into a strip capped at 464, 789 characters
     to read, 23.5% of a 1280×800 laptop and 52.8% of an iPhone 16. Half the
     phone, in a game whose clock never stops — CONTRACT.md's first law — so
     everything behind that panel is still happening and you cannot see any of
     it. And most of the panel was the SAME THING TWICE: the rail already
     carries a title, so the body printed the outpost's name again at 32 px
     and its kind line again under that; the rail already carries BUY / SELL /
     ARM MEN / RIDE ON as verbs, so the body printed BUY / SELL tabs at the
     top and RIDE ON / ARMOURY buttons at the bottom. Three of the four things
     in it were furniture, and the crates — the only reason to stop — were the
     one part you had to scroll to reach. Two rows of nine were visible.

     TWO: IT ANNOUNCED A MAN WHO WAS NOT THERE. Every kind opened with a
     sentence about the world: "crates off a boat", "men at the water, looking
     for a warlord", "lamps, tarpaulin, and a man who does not ask where you
     got it". The world at an outpost is five boxes and a flag on a mast. See
     the note on `blurb` in THE KINDS — this file owns no meshes, so it has no
     business describing any.

     WHAT REPLACED IT. One row is one BUTTON, and the button IS the readout:

       · its background fills from the left by HOW MUCH OF THE SHELF IS LEFT,
         so a depot you are buying out drains under your thumb as you tap it.
         Finite stock is the whole design of this file and it used to be a
         word ("6 LEFT") in a row of words; now it is the shape of the thing
         you press.
       · a 2 px hairline along the bottom is what that gun is worth IN A
         FIGHT — W.gunCombat, the exact term core's soldierPower multiplies a
         man by — scaled against the best weapon in the whole armoury, so a
         pistol-only depot cannot flatter its own stock. It replaces
         "×0.84 IN A FIGHT · DMG 21 · 72M", forty characters on every row of
         every list, and unlike that line you can compare two rows by eye.
       · the price is a chip inside the button. Pressing the button buys it.

     Nothing was thrown away to get there: the stock counts, the prices, the
     tier pool and the rest bill are all still on screen. They stopped being
     sentences.

     THE FULL-SCREEN PATH IS DELETED, not flagged off. `?outpostui=old` threw
     this same markup over the whole viewport; it was the thing being fixed,
     it had no caller left, and this repo's rule is that git is the undo. */
  let ctx = null, CUR = null, TAB = "buy";

  const CSS = `
  .wl-op{--acc:var(--hot)}
  .wl-op-lbl{font-size:10px;letter-spacing:.18em;opacity:.5;margin:0 0 5px}
  .wl-op-lbl+.wl-op-lbl,.wl-op-list+.wl-op-lbl{margin-top:9px}
  /* AND THE LIST BOUNDS ITSELF, lower than the rail would bound it.
     The shell caps .vbody at 34vh on a phone and this panel filled every
     pixel of it — nine crate rows is 333 px of markup and the cap is 290, so
     the rail was as tall as it is allowed to get and the world got what was
     left. A crate is not a document: six rows is a shop, the rest scrolls,
     and the 100 px that buys back is 100 px of island. The vh term is what
     protects an iPhone SE in landscape, where the whole screen is 375 px
     tall and a fixed 200 would be more than half of it. */
  .wl-op-list{display:flex;flex-direction:column;gap:3px;
    max-height:min(26vh,200px);overflow:auto;-webkit-overflow-scrolling:touch}
  .wl-op-line{display:flex;gap:3px}
  /* 32 px on the short side. tools/warlord-fits.mjs fails anything under 28,
     and it is right to: a 19 px sliver is present, visible, and not a button. */
  .wl-op-r{position:relative;overflow:hidden;flex:1 1 auto;min-width:0;
    display:flex;align-items:center;gap:8px;min-height:32px;padding:5px 9px;
    appearance:none;cursor:pointer;text-align:left;font:inherit;
    border:1px solid rgba(255,255,255,.14);border-radius:9px;
    background:rgba(255,255,255,.03);color:var(--ink)}
  /* HOW MUCH IS LEFT — the row's own fill, not a word at the end of a line. */
  .wl-op-r::before{content:"";position:absolute;left:0;top:0;bottom:0;
    width:var(--left,0%);background:var(--acc);opacity:.17;pointer-events:none}
  /* WHAT IT IS WORTH IN A FIGHT — a hairline, scaled across the armoury. */
  .wl-op-r::after{content:"";position:absolute;left:0;bottom:0;height:2px;
    width:var(--pow,0%);background:var(--acc);opacity:.8;pointer-events:none}
  .wl-op-r>*{position:relative}
  .wl-op-r:active{transform:translateY(1px)}
  .wl-op-nm{flex:1 1 auto;min-width:0;font-size:12.5px;letter-spacing:.04em;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .wl-op-n{font-size:12px;font-variant-numeric:tabular-nums;opacity:.8;
    min-width:16px;text-align:right}
  .wl-op-p{font-size:12px;font-variant-numeric:tabular-nums;color:#ffe6d3;
    border:1px solid var(--acc);border-radius:999px;padding:2px 8px}
  .wl-op-r[disabled]{opacity:.34;cursor:not-allowed}
  .wl-op-r[disabled] .wl-op-p{border-color:rgba(255,255,255,.22);color:var(--ink)}
  .wl-op-x{flex:0 0 auto;min-width:36px;justify-content:center;
    padding:5px 4px;font-size:11px;opacity:.7}
  .wl-op-none{font-size:11.5px;letter-spacing:.06em;opacity:.55;padding:3px 0}
  .wl-op-foot{max-height:none;overflow:visible;margin-top:8px;padding-top:8px;
    border-top:1px solid rgba(255,255,255,.1)}
  /* AND THE CAMPAIGN'S OWN CONTROLS STEP ASIDE WHILE THE RAIL IS DOCKED.

     Keeping the island lit brought campaign.js's overlay back with it, and the
     two overlays want the same pixels: the compass is bottom-centred at 14 px
     and the verb row docks in the same band ("SE · GHARIB 58m · SW" drawn
     through the buttons), while MAP and the zoom pair are top-right, which is
     where the rail's own right-hand column starts on anything wider than a
     phone in portrait. tools/warlord-fits.mjs measured the result and was
     right to fail it: on an iPhone 16 in LANDSCAPE — 852x393, the frame with
     no vertical room at all — MAP, + and − were all drawn under the rail and
     none of the three could be pressed.

     The first instinct was to keep MAP and shorten the panel instead, and the
     arithmetic says that is not available: at that frame the rail's own box
     starts 6 px ABOVE the map button, so even a rail clamped to nothing
     overlaps it. A control you can see and cannot press is worse than one that
     is not there — that is the gate's whole thesis — so while you are standing
     at an outpost the campaign's controls are not drawn. You are not riding;
     RIDE ON hands all of them back in one tap.

     The NAMEPLATES stay (they are pointer-events:none and they are how you see
     a band coming while you shop, which is the entire argument for not
     blocking). army.js's encounter rail will want these three lines the day it
     stops taking the phase too. */
  body.wl-trading #wlCompass,
  body.wl-trading #wlMapBtn,
  body.wl-trading #wlZoom{display:none}
  `;
  function styleOnce() {
    if (G.document && !G.document.getElementById("wl-op-css")) {
      const s = G.document.createElement("style");
      s.id = "wl-op-css"; s.textContent = CSS;
      G.document.head.appendChild(s);
    }
  }

  /* Published rather than private: loadout.js paints its armoury under the
     same fixed top strip and must not carry a second copy of this
     measurement. THE HEIGHT IS MEASURED, NOT TYPED — a fixed 30 px was right
     until the strip grew a LOYAL chip and wrapped to two lines at 320 pt. */
  function clearHud() {
    if (!G.document) return;
    const h = G.document.getElementById("hud");
    const px = (h && h.classList.contains("on")) ? Math.ceil(h.getBoundingClientRect().height) + 10 : 4;
    G.document.documentElement.style.setProperty("--wl-hud", px + "px");
  }
  if (G.addEventListener) G.addEventListener("resize", clearHud);

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function pc(a, b) {
    return Math.max(0, Math.min(100, b > 0 ? (a / b) * 100 : 0)).toFixed(1);
  }

  /* THE HAIRLINE'S SCALE IS THE WHOLE ARMOURY, never this crate. Normalising
     inside the list would make the best pistol in a pistol depot draw the same
     bar as a rocket launcher, which is the exact lie the number it replaced
     could not tell. Cached: asked once per row per repaint. */
  let COMBAT_TOP = 0;
  function combatTop() {
    if (COMBAT_TOP) return COMBAT_TOP;
    const l = W.gunList();
    let top = 0;
    for (let i = 0; i < l.length; i++) top = Math.max(top, W.gunCombat ? W.gunCombat(l[i].id) : 1);
    return (COMBAT_TOP = top || 1);
  }
  let SOAK_TOP = 0;
  function soakTop() {
    if (SOAK_TOP) return SOAK_TOP;
    let top = 0;
    for (let i = 0; i < W.ARMOUR.length; i++) top = Math.max(top, W.ARMOUR[i].soak || 0);
    return (SOAK_TOP = top || 1);
  }
  /* A MAN'S OWN WORTH, with no gun and no armour in it — soldierPower's man
     term, lifted out rather than retyped, so a camp's hairline and the battle
     agree about what a veteran is. */
  function tierTop() {
    let top = 0;
    for (let i = 0; i < W.TIERS.length; i++) {
      const T = W.TIERS[i];
      top = Math.max(top, T.acc * (T.hp / 100));
    }
    return top || 1;
  }

  /* EVERY ROW IN EVERY KIND IS THIS ONE CALL. Four facts, no sentence:
     what it is, how many are left, what it costs, and — as the fill and the
     hairline — how much of the shelf that is and how hard it hits. */
  function row(a) {
    return '<div class="wl-op-line">' +
      '<button class="wl-op-r"' + (a.dis ? " disabled" : "") +
        ' style="--left:' + a.left + '%;--pow:' + (a.pow || 0) + '%' +
        (a.acc ? ";--acc:" + a.acc : "") + '" ' + a.attr + '>' +
        '<span class="wl-op-nm">' + esc(a.nm) + '</span>' +
        '<span class="wl-op-n">' + (a.n == null ? "" : a.n) + '</span>' +
        '<span class="wl-op-p">' + (a.raw ? a.raw : "$" + a.p) + '</span>' +
      '</button>' +
      (a.more ? '<button class="wl-op-r wl-op-x" ' + a.more + '>' + a.moreLabel + '</button>' : '') +
      '</div>';
  }
  /* ARMOUR IS THE OTHER COLOUR ON THE SHELF. It used to need its own heading
     and its own two-line rows; a tint says "not a gun" in no characters at
     all, and it is the same blue .wl-chip.arm already uses on the encounter. */
  const ARM_ACC = "#7fa8c8";

  /* ---- the depot / market crates ---- */
  function panelBuy(o) {
    const S = W.state;
    const ids = Object.keys(o.stock).sort(function (a, b) { return W.gunPrice(b) - W.gunPrice(a); });
    const aids = Object.keys(o.armourStock).sort(function (a, b) { return W.armour(b).soak - W.armour(a).soak; });
    /* NO "IN THE CRATE" HEADING. It sat directly under a rail header reading
       ARMS DEPOT with a BUY verb lit beneath it, and it cost 26 px of the
       ~176 px this panel gets during a live match — which is most of the
       overflow tools/warlord-fits.mjs measured on this screen. The rows are
       the crate. */
    let h = '<div class="wl-op-list">';
    if (!ids.length && !aids.length) h += '<div class="wl-op-none">PICKED CLEAN</div>';
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i], n = o.stock[id], p = buyPrice(o, id);
      h += row({
        nm: W.gunLabel(id), n: n, p: p, dis: n <= 0 || p > S.gold,
        left: pc(n, shelf(o, id)),
        pow: pc(W.gunCombat ? W.gunCombat(id) : 1, combatTop()),
        attr: 'data-buy="' + id + '" data-n="1"',
        more: (n >= 5 && p * 5 <= S.gold) ? 'data-buy="' + id + '" data-n="5"' : null,
        moreLabel: "&times;5",
      });
    }
    for (let i = 0; i < aids.length; i++) {
      const A = W.armour(aids[i]), n = o.armourStock[A.id], p = armourBuyPrice(o, A.id);
      h += row({
        nm: A.label, n: n, p: p, dis: n <= 0 || p > S.gold, acc: ARM_ACC,
        left: pc(n, clamp(Math.round(o.capital / (A.price * 2.4)), 1, 12)),
        pow: pc(A.soak, soakTop()),
        attr: 'data-abuy="' + A.id + '"',
      });
    }
    return h + '</div>';
  }

  /* ---- your own cart, at what this place pays for it ---- */
  function panelSell(o) {
    const S = W.state, K = KINDS[o.kind] || KINDS.depot;
    const ids = Object.keys(S.baggage).sort(function (a, b) { return W.gunPrice(b) - W.gunPrice(a); });
    const aids = Object.keys(S.armourBag);
    let most = 1;
    for (let i = 0; i < ids.length; i++) most = Math.max(most, S.baggage[ids[i]]);
    for (let i = 0; i < aids.length; i++) most = Math.max(most, S.armourBag[aids[i]]);
    /* The rate is a fact about THIS place and the reason a market is worth
       riding to, so it rides on the heading where it costs nothing. */
    /* THE SELL HEADING KEEPS ITS RATE AND LOSES "YOUR CART". SELL is lit in
       the verb row above it and the rows are your own kit; the ¢ on the
       dollar is the only fact here that is about THIS place, and it is the
       reason to ride to a night market. */
    let h = '<div class="wl-op-lbl">THEY PAY ' +
      Math.round((K.buys || 0.34) * 100) + '&cent;</div><div class="wl-op-list">';
    if (!ids.length && !aids.length) h += '<div class="wl-op-none">EMPTY</div>';
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i], n = S.baggage[id], p = sellPrice(o, id);
      h += row({
        nm: W.gunLabel(id), n: n, p: p, left: pc(n, most),
        pow: pc(W.gunCombat ? W.gunCombat(id) : 1, combatTop()),
        attr: 'data-sell="' + id + '" data-n="1"',
        more: n > 1 ? 'data-sell="' + id + '" data-n="' + n + '"' : null,
        moreLabel: "ALL",
      });
    }
    for (let i = 0; i < aids.length; i++) {
      const A = W.armour(aids[i]), n = S.armourBag[A.id];
      h += row({
        nm: A.label, n: n, p: armourSellPrice(o, A.id), acc: ARM_ACC,
        left: pc(n, most), pow: pc(A.soak, soakTop()),
        attr: 'data-asell="' + A.id + '"',
      });
    }
    return h + '</div>';
  }

  /* ---- the recruit camp ---- */
  function panelCamp(o) {
    const S = W.state, top = tierTop();
    // heading dropped with the others: the rail header says RECRUIT CAMP
    let h = '<div class="wl-op-list">';
    let any = false;
    for (let i = 0; i < W.TIERS.length; i++) {
      const T = W.TIERS[i], cap = capPool(o, T.id);
      if (cap <= 0) continue;
      any = true;
      const n = o.pool[T.id] || 0, p = hirePrice(o, T.id);
      const many = Math.min(n, Math.floor(S.gold / Math.max(1, p)));
      h += row({
        nm: T.label, n: n, p: p, dis: n <= 0 || p > S.gold,
        left: pc(n, cap), pow: pc(T.acc * (T.hp / 100), top),
        attr: 'data-hire="' + T.id + '" data-n="1"',
        more: many >= 5 ? 'data-hire="' + T.id + '" data-n="5"' : null,
        moreLabel: "&times;5",
      });
    }
    if (!any) h += '<div class="wl-op-none">NOBODY LEFT</div>';
    return h + '</div>';
  }

  /* ---- the well ----
     A WELL IS NOT A LIST. It has exactly one thing to say — how much of your
     army is broken — and a bar says it in one glance and one line of legend
     where a per-tier table took eight. The price of fixing it is a chip on
     the REST verb, which is where the decision actually is. */
  function panelWell(o) {
    const S = W.state;
    let hurt = 0, wounded = 0;
    for (let i = 0; i < S.army.length; i++) {
      const s = S.army[i];
      if (s.wounded) wounded++;
      if (s.wounded || s.hp < s.maxHp) hurt++;
    }
    if (S.you.hp < S.you.maxHp) hurt++;
    const total = Math.max(1, S.army.length + 1);
    const fit = Math.max(0, total - hurt);
    // "drink and ride on." was the panel telling the player to press the
    // button next to it; REST is already chipped "nobody hurt" and disabled.
    if (!hurt) return '<div class="wl-op-none">NOBODY HURT</div>';
    return '<div class="wl-op-lbl">THE HURT</div>' +
      '<div class="wl-stack">' +
        '<i style="width:' + pc(fit, total) + '%;background:#6fb7d8">' + (fit / total > 0.11 ? fit : "") + '</i>' +
        '<i style="width:' + pc(hurt, total) + '%;background:var(--blood)">' + (hurt / total > 0.11 ? hurt : "") + '</i>' +
      '</div>' +
      '<div class="wl-legend"><span><em style="background:#6fb7d8"></em>' + fit + ' FIT</span>' +
      '<span><em style="background:var(--blood)"></em>' + hurt + ' HURT</span>' +
      /* THE ONE NUMBER THE BAR CANNOT CARRY: core.js multiplies a wounded
         man's power by 0.62, and that — not the sight of a red segment — is
         why you pay for a day here. Shown only when somebody actually carries
         the flag that costs it, because a percentage nobody is paying is the
         same fiction as a man who is not there. */
      (wounded ? '<span>' + wounded + ' AT 62%</span>' : '') + '</div>';
  }

  function restCost() {
    const S = W.state;
    let gold = 0, n = 0;
    for (let i = 0; i < S.army.length; i++) {
      const s = S.army[i];
      if (!s.wounded && s.hp >= s.maxHp) continue;
      gold += W.tier(s.tier).wage * 6;      // derived from his wage, not typed
      n++;
    }
    if (S.you.hp < S.you.maxHp) { gold += 40; n++; }
    return { gold: gold, n: n };
  }

  /* KEPT AND EXPORTED FOR loadout.js ONLY. The armoury is a screen you
     deliberately stop at with nothing chasing you, and reading a gun's
     numbers there is the point of being there; the trading rail is the
     opposite and no longer prints this on anything. */
  function statLine(id) {
    const w = W.gun(id);
    if (!w) return "bare hands";
    const fight = W.gunCombat ? W.gunCombat(id) : 1;
    const hit = w.explosive
      ? "BLAST R" + (w.blastRadius || w.blast || 10) + "M"
      : "DMG " + (w.damage || 0) + (w.pellets > 1 ? "×" + w.pellets : "");
    return "×" + fight.toFixed(2) + " IN A FIGHT  ·  " + hit + "  ·  " + (w.range || 0) + "M" +
      (w.nonlethal ? "  ·  NON-LETHAL" : "");
  }

  function cartCount() {
    const S = W.state;
    let n = 0;
    for (const k in S.baggage) n += S.baggage[k];
    return n;
  }


  /* ============================================================ ACTIONS */
  function buy(o, id, n) {
    const p = buyPrice(o, id);
    let got = 0;
    for (let i = 0; i < n; i++) {
      if ((o.stock[id] || 0) <= 0) break;
      if (!W.pay(p)) break;
      o.stock[id]--;
      W.stash(id, 1);
      got++;
    }
    if (!got) { W.toast("NOT ENOUGH GOLD", "bad"); return 0; }
    // "into the baggage" — the cart row under the crate list is what shows
    // where it went, and it updates in the same frame.
    W.toast(got + " × " + W.gunLabel(id), "good");
    W.emit("outpost:buy", { o: o, id: id, n: got, spent: got * p });
    return got;
  }
  function sell(o, id, n) {
    const p = sellPrice(o, id);
    let got = 0;
    for (let i = 0; i < n; i++) {
      if (!W.unstash(id, 1)) break;
      W.earn(p);
      if (o.stock[id] != null) o.stock[id]++;    // it goes back on their shelf
      got++;
    }
    if (got) {
      W.toast("+$" + (got * p), "good");
      W.emit("outpost:sell", { o: o, id: id, n: got, got: got * p });
    }
    return got;
  }
  function hire(o, tierId, n) {
    const p = hirePrice(o, tierId);
    const i = W.tierIndex(tierId);
    let got = 0;
    for (let k = 0; k < n; k++) {
      if ((o.pool[tierId] || 0) <= 0) break;
      if (!W.pay(p)) break;
      o.pool[tierId]--;
      /* WHAT HE WALKS IN CARRYING. A farmhand and a thug own nothing; a
         trained soldier owns his sidearm. That is the whole reason a recruit
         camp sends you back to a depot, and it is one line rather than a
         table. */
      W.addSoldier(W.makeSoldier(tierId, i >= 2 ? "sidearm" : "fists"));
      got++;
    }
    if (!got) { W.toast("NOT ENOUGH GOLD", "bad"); return 0; }
    W.state.stats.recruited += got;
    W.log("hired " + got + " " + W.tier(tierId).label.toLowerCase() + (got > 1 ? "s" : "") + " at " + o.name + " for $" + (got * p) + ".");
    W.toast(got + " " + W.tier(tierId).label + " joined", "good");
    W.emit("outpost:hire", { o: o, tier: tierId, n: got, spent: got * p });
    return got;
  }
  function rest(o) {
    const S = W.state;
    const c = restCost();
    if (!c.n) return false;
    if (!W.pay(c.gold)) { W.toast("NOT ENOUGH GOLD", "bad"); return false; }
    for (let i = 0; i < S.army.length; i++) {
      S.army[i].wounded = false;
      S.army[i].hp = S.army[i].maxHp;
    }
    S.you.hp = S.you.maxHp;
    W.log("rested at " + o.name + ". " + c.n + " men back on their feet for $" + c.gold + ".", "good");
    W.emit("outpost:rest", { o: o, n: c.n, gold: c.gold });
    W.dawn();                 // a rest costs a DAY: wages, desertion, restock
    return true;
  }

  /* ============================================================ DRAW + WIRE
     ONE delegated listener rather than a handler per row: the panel is rebuilt
     on every purchase, and per-row handlers on a list that redraws on each tap
     is how a trading screen starts dropping frames. */
  function wire(node, o) {
    if (!node) return;
    node.onclick = function (e) {
      const t = e.target && e.target.closest ? e.target.closest("button") : null;
      if (!t) return;
      const n = parseInt(t.getAttribute("data-n") || "1", 10) || 1;
      if (t.hasAttribute("data-buy")) { buy(o, t.getAttribute("data-buy"), n); repaint(o); return; }
      if (t.hasAttribute("data-sell")) { sell(o, t.getAttribute("data-sell"), n); repaint(o); return; }
      if (t.hasAttribute("data-hire")) { hire(o, t.getAttribute("data-hire"), n); repaint(o); return; }
      if (t.hasAttribute("data-abuy")) {
        const id = t.getAttribute("data-abuy"), p = armourBuyPrice(o, id);
        if ((o.armourStock[id] || 0) > 0 && W.pay(p)) {
          o.armourStock[id]--; W.stashArmour(id, 1);
          W.toast(W.armour(id).label + " into the baggage", "good");
        } else W.toast("NOT ENOUGH GOLD", "bad");
        repaint(o); return;
      }
      /* AND IT HAS TO COME BACK HERE. The old rail handed loadout.js no way
         home, so arming your men at a depot dropped you on the island with the
         depot closed behind you — you had to ride back into it to spend the
         rest of your money. */
      if (t.hasAttribute("data-arm")) {
        if (W.loadout && W.loadout.open) W.loadout.open({ back: function () { open(o); } });
        else W.toast("loadout.js did not load", "bad");
        return;
      }
      if (t.hasAttribute("data-asell")) {
        const id = t.getAttribute("data-asell");
        if (W.unstashArmour(id, 1)) {
          W.earn(armourSellPrice(o, id));
          o.armourStock[id] = (o.armourStock[id] || 0) + 1;
        }
        repaint(o); return;
      }
    };
  }

  /* ARRIVING SOMEWHERE IS NOT A MENU, AND THE RAIL DOES NOT TAKE THE PHASE.

     THIS IS THE OTHER HALF OF THE OWNER'S COMPLAINT AND IT IS THE LITERAL
     HALF: "RN WE HAVE BARREN DESERT AND MAN WITH A CRATE POPUP WITH NO MAN
     THERE." He was not being figurative. Riding up to an outpost DELETED THE
     WORLD.

     The chain, found by photographing the rail and getting a blank orange
     gradient behind it on every frame: open() called W.setPhase("outpost")
     (and campaign.js sets it too, one line before it calls open). core.js
     fires phase:leave:campaign. campaign.js answers that with
     `live = false; showAll(false)`, which hides its own root — you, your
     column, every band, the outpost's own huts and mast — hides the campaign
     HUD, hides the controls, and calls W.desert.hide(). The island is
     switched off. What is left behind the panel is the sky dome, which is a
     smooth sand-coloured gradient, which is exactly what "barren desert"
     describes. There was never a man there because there was never anything
     there.

     A PHASE IS A CLAIM THAT ONE MODULE OWNS THE SCREEN, and this one does not
     any more — it owns a strip at the bottom of a screen that still belongs to
     the campaign. CONTRACT.md already names the pattern: "events.js and
     territory.js take the screen without owning a phase — an event card and
     the strategic map are both things that happen OVER the campaign." A
     docked rail is more of that than either. So the trading rail stops
     claiming the phase and hands it straight back if campaign.js has already
     set it, and the island stays lit, running, and rideable behind the panel
     — which is what the whole no-popup argument was for. You can watch the
     party coming over the dune while you shop, and in a match that party is
     real and is not waiting for you to finish. */
  let openedAt = 0;
  function open(o) {
    if (!o) return;
    o.seen = true;
    CUR = o;
    TAB = "buy";
    styleOnce();
    /* Hand the phase back to the campaign whatever it currently is: "outpost"
       when campaign.js has just set it, "armoury" when loadout.js is returning
       here through its back(), "menu" on the ?outpost=1 debug entry — and that
       last one needs the island BUILT, not just labelled. */
    if (W.phase() !== "campaign") {
      if ((W.phase() === "menu" || W.phase() === "boot") && W.campaign && W.campaign.enter) W.campaign.enter();
      else W.setPhase("campaign");
    }
    if (!ctx || !ctx.verbs) {
      /* The shell owns the rail. Without it there is nothing to draw into —
         say so out loud rather than silently doing nothing. */
      console.error("[warlord] outpost: the page provides no ctx.verbs");
      W.toast(o.name, "bad");
      CUR = null;
      return;
    }
    /* HOW FAR AWAY "AT THE OUTPOST" IS, MEASURED RATHER THAN TYPED: campaign.js
       owns the arrival radius and does not export it, so read it off the
       distance at which it actually called this. Riding out of twice that
       closes the rail — a docked strip for a depot half a kilometre behind you
       is the stale-menu failure in a smaller box. */
    openedAt = Math.max(40, Math.hypot(W.state.you.x - o.x, W.state.you.z - o.z));
    dock(true);
    rail(o);
    watch();
    if (W.feel && W.feel.ui) W.feel.ui("open");   // the phase used to do this
    W.emit("outpost:open", o);
  }

  /* THE RAIL IS A WORLD OBJECT NOW, so it has to behave like one: you can ride
     off mid-trade, because nothing is stopping you any more, and the strip has
     to notice. One hypot every quarter second while a rail is open and nothing
     at all when it is not. */
  let watching = 0;
  function watch() {
    if (watching) return;
    watching = 1;
    const tick = function () {
      if (!CUR) { watching = 0; return; }
      const d = Math.hypot(W.state.you.x - CUR.x, W.state.you.z - CUR.z);
      if (d > openedAt * 2) { close(); watching = 0; return; }
      setTimeout(tick, 250);
    };
    setTimeout(tick, 250);
  }

  function panelBody(o) {
    return o.kind === "camp" ? panelCamp(o)
         : o.kind === "well" ? panelWell(o)
         : TAB === "sell" ? panelSell(o)
         : panelBuy(o);
  }

  /* A PURCHASE REPAINTS THE PANEL, NEVER THE DOCK. Redrawing the whole rail on
     every tap is what made the old screen flicker, and it also moves the
     button under the thumb that is still on it. Which is why no verb carries a
     number that a purchase changes: the counts live in the panel, where they
     are always the truth. */
  function repaint(o) {
    if (ctx.verbsBody) ctx.verbsBody(shell(o));
    wire(G.document.getElementById("vBody"), o);
    if (ctx.paintHud) ctx.paintHud();
  }
  function shell(o) {
    const K = KINDS[o.kind] || KINDS.depot;
    return '<div class="wl-op" style="--acc:' + K.accent + '">' +
      panelBody(o) + panelArm(o) + '</div>';
  }

  /* THE WAY TO THE ARMOURY IS A ROW, NOT A VERB, and that is a size decision
     as much as a placement one. Four verbs wrap to two rows on a 393 pt phone
     and cost 118 px of rail; three fit on one and cost 54. It also belongs
     here: a gun you just bought goes into the cart, not into a man's hands,
     and this row is the sentence that used to say so ("Guns go to the baggage
     train — hand them out in the ARMOURY. Carrying 9.") drawn as a bar. The
     fill is how much of your army is actually holding something, so a warlord
     with a cart full of rifles and a company of empty hands can see it.

     NOT AT A WELL. Nothing changes hands at a well, and a well's whole panel
     is one bar — hanging a cart row off it would double the only kind that
     currently costs the player almost no screen at all. */
  function panelArm(o) {
    if (o.kind === "well" || !(W.loadout && W.loadout.open)) return "";
    const S = W.state;
    let armed = 0;
    for (let i = 0; i < S.army.length; i++) {
      if (S.army[i].wid && S.army[i].wid !== "fists") armed++;
    }
    const cart = cartCount();
    /* THE RULE ABOVE IT IS LOAD-BEARING. Without it the row that the crate
       list clips at its scroll edge butts straight into this one and the half
       a row reads as a rendering fault rather than as "there is more". */
    return '<div class="wl-op-list wl-op-foot">' + row({
      nm: "ARM MEN", n: null, raw: cart ? cart + " IN CART" : "CART", acc: "#c9bfae",
      left: pc(armed, Math.max(1, S.army.length)), pow: 0,
      attr: 'data-arm="1"',
    }) + '</div>';
  }

  /* WHAT THIS PLACE OFFERS, AS VERBS. Each kind gets only the ones it can
     honour — a well has no crates and a depot has no beds — because a disabled
     button you can never press is just a smaller lie.

     TWO OF THEM USED TO DO NOTHING. RECRUIT set a tab name the camp panel does
     not read and redrew the identical rail; REST did the same and left the
     actual resting to a button buried in the body. A verb that does not do the
     thing it is named after is worse than no verb. RECRUIT is gone (the camp's
     rows ARE the hiring) and REST now rests, with the bill as its chip. */
  function rail(o) {
    const K = KINDS[o.kind] || KINDS.depot;
    const opts = [];
    if (o.kind === "well") {
      const c = restCost();
      opts.push({ label: "REST", kind: c.n ? "hot" : "", note: c.n ? "$" + c.gold : "nobody hurt",
                  disabled: !c.n, on: function () { rest(o); rail(o); } });
    } else if (o.kind !== "camp") {
      opts.push({ label: "BUY", kind: TAB === "buy" ? "hot" : "",
                  on: function () { TAB = "buy"; rail(o); } });
      opts.push({ label: "SELL", kind: TAB === "sell" ? "hot" : "", note: "your cart",
                  on: function () { TAB = "sell"; rail(o); } });
    }
    opts.push({ label: "RIDE ON", on: close });
    ctx.verbs({ title: o.name, sub: K.tag, body: shell(o), options: opts });
    wire(G.document.getElementById("vBody"), o);
    if (ctx.paintHud) ctx.paintHud();
  }

  function close() {
    if (!CUR) return;
    CUR = null;
    dock(false);
    if (ctx && ctx.closeVerbs) ctx.closeVerbs();
    if (W.feel && W.feel.ui) W.feel.ui("close");
    W.emit("outpost:close");
    /* THE ISLAND NEVER LEFT, so there is nothing to give back — this used to
       call campaign.enter() to undo the phase it should not have taken. The
       fallback stays for the case where something else DID take the phase and
       left the player with no screen at all. */
    if (W.phase() !== "campaign") {
      if (W.campaign && W.campaign.enter) W.campaign.enter();
      else { W.setPhase("menu"); W.emit("mainmenu"); }
    }
  }

  /* A module must tear its own screen down when it loses the screen — and the
     screen this one lives on is the CAMPAIGN's, not a phase of its own. A
     battle, an encounter, the armoury or the menu taking over is exactly when
     a docked trading rail has to go. */
  W.on("phase:leave:campaign", function () { CUR = null; dock(false); });

  function dock(on) {
    if (G.document && G.document.body) G.document.body.classList.toggle("wl-trading", !!on);
  }

  function nearest(x, z, r) {
    const S = W.state;
    let best = null, bd = r == null ? Infinity : r * r;
    for (let i = 0; i < S.outposts.length; i++) {
      const o = S.outposts[i];
      const dx = o.x - x, dz = o.z - z, d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = o; }
    }
    return best;
  }

  /* ============================================================ MODULE */
  W.module("outpost", {
    boot: function (c) {
      ctx = c;
      styleOnce();
      /* ?outpost=1 — open a depot directly. Every module here needs a way in
         that does not depend on four other agents' files existing yet, and
         the photography tool needs one that does not depend on riding there.
         &kind=camp|well|market picks which. */
      const want = Q.get("outpost");
      if (want) {
        setTimeout(function () {
          if (!W.state.outposts.length) {
            if (!W.state.army.length && W.state.day === 1) {
              W.newGame({ seed: parseInt(Q.get("seed") || "", 10) || 1337 });
            }
            place(9);
          }
          // enough to buy most of a crate list but not the top of it — the
          // screen has to show BOTH the affordable and the unaffordable row.
          if (W.state.gold < 1200) { W.state.gold = 1200; W.emit("gold", W.state.gold); }
          if (W.loadout && W.loadout.demo && !W.state.army.length) W.loadout.demo();
          const kind = want === "1" ? (Q.get("kind") || "depot") : want;
          let o = null;
          for (let i = 0; i < W.state.outposts.length; i++) {
            if (W.state.outposts[i].kind === kind) { o = W.state.outposts[i]; break; }
          }
          open(o || W.state.outposts[0]);
        }, 0);
      }
    },
    place: place,
    build: build,          // campaign.js picks the SPOT; this makes the PLACE
    open: open,
    close: close,
    restock: restock,
    nearest: nearest,
    list: function () { return W.state.outposts; },
    KINDS: KINDS,
    // prices, exported so loadout.js and the aftermath screen can print what a
    // looted gun is worth without inventing a second opinion about it
    buyPrice: buyPrice, sellPrice: sellPrice, hirePrice: hirePrice,
    statLine: statLine,
    clearHud: clearHud,
    current: function () { return CUR; },
  });
})();
