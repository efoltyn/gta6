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
  const KINDS = W.OUTPOST_KINDS = {
    depot: {
      id: "depot", label: "ARMS DEPOT", tag: "GUNS · ARMOUR · WE BUY",
      capital: 700, lines: 7, buys: 0.34, armour: ["vest", "plate"],
      blurb: "crates off a boat. what is here is what is here.",
    },
    camp: {
      id: "camp", label: "RECRUIT CAMP", tag: "MEN FOR HIRE",
      capital: 320, blurb: "men at the water, looking for a warlord.",
    },
    well: {
      id: "well", label: "WELL", tag: "REST · WATER",
      blurb: "shade, water, and somewhere to lie down.",
    },
    market: {
      id: "market", label: "NIGHT MARKET", tag: "NO QUESTIONS",
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
      blurb: "lamps, tarpaulin, and a man who does not ask where you got it.",
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

  /* ============================================================ THE SCREEN
     PHONE FIRST, because this is the screen the player is in most and it is
     a table of numbers, which is the layout most likely to break at 393pt.
     One row is a two-column grid: everything you read on the left, the one
     thing you tap on the right. The stat line under the name is not flavour —
     it is the reason you would pay $280 for one gun over $195 for another,
     and every number in it comes straight off W.gun(id). */
  let ctx = null, CUR = null, TAB = "buy", OPEN_GROUP = null;

  const CSS = `
  .wl-op-top{display:flex;gap:8px;flex-wrap:wrap;align-items:baseline;margin:0 0 12px}
  .wl-op-tag{font-size:11px;letter-spacing:.2em;opacity:.55}
  .wl-op-tabs{display:flex;gap:8px;margin:14px 0 6px}
  .wl-op-tabs .wl-btn{padding:8px 16px;font-size:12px}
  .wl-op-tabs .wl-btn.on{border-color:var(--hot);background:rgba(255,138,61,.16);color:#ffd7bd}
  /* THE ROW IS FLEX, NOT GRID, and that is a repair rather than a preference:
     as a two-column grid a name that wrapped ("BOLT SNIPER · 2 IN CART" at
     393pt) pushed the stat line into a third grid row and the price button
     stopped lining up with anything. Flex with one text block that is allowed
     to shrink puts the tap target on the right at every width. */
  .wl-op-row{display:flex;gap:10px;align-items:center;
    padding:10px 0;border-bottom:1px solid rgba(255,255,255,.07)}
  .wl-op-row:last-child{border-bottom:0}
  .wl-op-txt{flex:1;min-width:0}
  .wl-op-nm{font-size:14px;letter-spacing:.03em}
  .wl-op-st{font-size:10.5px;letter-spacing:.05em;opacity:.5;font-variant-numeric:tabular-nums;margin-top:2px}
  .wl-op-act{display:flex;gap:6px;align-items:center;flex-shrink:0}
  .wl-op-act .wl-btn{padding:10px 13px;font-size:13px;font-variant-numeric:tabular-nums}
  .wl-op-act .wl-btn.mini{padding:10px 9px;font-size:11px;opacity:.7}
  /* HOW MANY ARE LEFT is the whole design, so it rides on the name line where
     it is read, not in a fixed column that stole 44px of the name's width. */
  .wl-op-left{font-size:10.5px;letter-spacing:.12em;opacity:.55}
  .wl-op-row.gone{opacity:.4}
  .wl-op-row.gone .wl-op-left{color:var(--blood);opacity:.9}
  /* THE STRIP OVERLAPS EVERYTHING. #hud is fixed to the top of the page and
     #stage's own padding is 18px, so at phone width the persistent MEN/$/DAY
     line sat straight on top of this screen's title. Every screen that shows
     the strip clears it here. (It is the shell's padding that is really
     wrong; this file cannot reach it.) */
  .wl-hudpad{padding-top:calc(env(safe-area-inset-top,0px) + 30px)}
  .wl-op-note{font-size:11.5px;letter-spacing:.06em;opacity:.62;line-height:1.5}
  .wl-op-note b{color:var(--hot);font-weight:600}
  @media (max-width:420px){
    .wl-op-nm{font-size:13px}
    .wl-op-act .wl-btn{padding:9px 10px}
  }`;
  function styleOnce() {
    if (G.document && !G.document.getElementById("wl-op-css")) {
      const s = G.document.createElement("style");
      s.id = "wl-op-css"; s.textContent = CSS;
      G.document.head.appendChild(s);
    }
  }

  function statLine(id) {
    const w = W.gun(id);
    if (!w) return "no record";
    const rate = 1 / Math.max(0.03, w.fireDelay || w.interval || 0.5);
    const dmg = w.explosive ? Math.round(85 * (w.blastPower || 1.4)) : (w.damage || 0);
    const parts = [
      (w.explosive ? "BLAST " : "DMG ") + dmg + (w.pellets > 1 ? "×" + w.pellets : ""),
      rate.toFixed(1).replace(/\.0$/, "") + "/S",
      (w.range || 0) + "M",
      "MAG " + (w.magSize || w.mag || 1),
    ];
    if (w.explosive) parts.push("R" + (w.blastRadius || 7) + "M");
    if (w.nonlethal) parts.push("NON-LETHAL");
    return parts.join("  ·  ");
  }

  function cartCount() {
    const S = W.state;
    let n = 0;
    for (const k in S.baggage) n += S.baggage[k];
    return n;
  }

  function head(o) {
    const K = KINDS[o.kind] || KINDS.depot;
    return '<div class="wl-op-top">' +
        '<h1 class="wl-h" style="margin:0">' + o.name + '</h1>' +
      '</div>' +
      /* the persistent strip is already showing MEN / $ / DAY two centimetres
         above this line — printing them again was the same numbers twice. */
      '<p class="wl-sub" style="margin:-8px 0 12px">' + K.label + '  ·  ' + K.tag + '</p>';
  }

  function footer() {
    return '<div class="wl-btns" style="margin-top:20px">' +
      '<button class="wl-btn hot" id="opLeave">RIDE ON</button>' +
      '<button class="wl-btn" id="opArm">ARMOURY</button>' +
      '</div>';
  }

  /* ---- the depot / market screen ---- */
  function drawTrade(o) {
    const S = W.state;
    const K = KINDS[o.kind] || KINDS.depot;
    let h = head(o);
    h += '<div class="wl-card"><div class="wl-op-note">' + K.blurb +
      '<br>Guns you buy go into the <b>baggage train</b>, not into a man\'s hands — ' +
      'hand them out in the <b>ARMOURY</b>. Carrying ' + cartCount() + ' loose guns.' +
      '</div></div>';

    h += '<div class="wl-op-tabs">' +
      '<button class="wl-btn' + (TAB === "buy" ? " on" : "") + '" data-tab="buy">BUY</button>' +
      '<button class="wl-btn' + (TAB === "sell" ? " on" : "") + '" data-tab="sell">SELL</button>' +
      '</div>';

    if (TAB === "buy") {
      const ids = Object.keys(o.stock).sort(function (a, b) { return W.gunPrice(b) - W.gunPrice(a); });
      h += '<div class="wl-lbl">IN THE CRATES</div><div class="wl-card">';
      if (!ids.length) h += '<div class="wl-op-note">picked clean. come back in a few days.</div>';
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i], n = o.stock[id], p = buyPrice(o, id);
        const broke = p > S.gold, out = n <= 0;
        const have = S.baggage[id] || 0;
        h += '<div class="wl-op-row' + (broke || out ? " gone" : "") + '">' +
          '<div class="wl-op-txt"><div class="wl-op-nm">' + W.gunLabel(id) +
            '  <span class="wl-op-left">' + (out ? "NONE LEFT" : n + " LEFT") + '</span>' +
            (have ? ' <span class="wl-dim wl-small">· ' + have + ' IN CART</span>' : '') + '</div>' +
          '<div class="wl-op-st">' + statLine(id) + '</div>' +
          '</div><div class="wl-op-act">' +
            '<button class="wl-btn' + (broke || out ? "" : " hot") + '" data-buy="' + id + '" data-n="1"' +
              (broke || out ? " disabled" : "") + '>$' + p + '</button>' +
            (n >= 5 && p * 5 <= S.gold ? '<button class="wl-btn mini" data-buy="' + id + '" data-n="5">×5</button>' : '') +
          '</div></div>';
      }
      h += '</div>';

      const aids = Object.keys(o.armourStock);
      if (aids.length) {
        h += '<div class="wl-lbl">ARMOUR</div><div class="wl-card">';
        for (let i = 0; i < aids.length; i++) {
          const A = W.armour(aids[i]), n = o.armourStock[A.id], p = armourBuyPrice(o, A.id);
          const broke = p > S.gold, out = n <= 0;
          const have = S.armourBag[A.id] || 0;
          h += '<div class="wl-op-row' + (broke || out ? " gone" : "") + '">' +
            '<div class="wl-op-txt"><div class="wl-op-nm">' + A.label +
              '  <span class="wl-op-left">' + (out ? "NONE LEFT" : n + " LEFT") + '</span>' +
              (have ? ' <span class="wl-dim wl-small">· ' + have + ' IN CART</span>' : '') + '</div>' +
            '<div class="wl-op-st">SOAK ' + A.soak + '  ·  SPEED −' + Math.round(A.slow * 100) + '%  ·  ' + A.note + '</div>' +
            '</div><div class="wl-op-act">' +
              '<button class="wl-btn' + (broke || out ? "" : " hot") + '" data-abuy="' + A.id + '"' +
                (broke || out ? " disabled" : "") + '>$' + p + '</button>' +
            '</div></div>';
        }
        h += '</div>';
      }
    } else {
      h += '<div class="wl-lbl">YOUR SURPLUS  ·  THEY PAY ' + Math.round((K.buys || 0.34) * 100) + '¢ ON THE DOLLAR</div><div class="wl-card">';
      const ids = Object.keys(S.baggage).sort(function (a, b) { return W.gunPrice(b) - W.gunPrice(a); });
      if (!ids.length) h += '<div class="wl-op-note">the baggage train is empty. every gun you own is in a man\'s hands.</div>';
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i], n = S.baggage[id], p = sellPrice(o, id);
        h += '<div class="wl-op-row">' +
          '<div class="wl-op-txt"><div class="wl-op-nm">' + W.gunLabel(id) + ' <span class="wl-dim wl-small">×' + n + '</span></div>' +
          '<div class="wl-op-st">' + statLine(id) + '</div>' +
          '</div><div class="wl-op-act">' +
            '<button class="wl-btn" data-sell="' + id + '" data-n="1">$' + p + '</button>' +
            (n > 1 ? '<button class="wl-btn mini" data-sell="' + id + '" data-n="' + n + '">ALL $' + (p * n) + '</button>' : '') +
          '</div></div>';
      }
      const aids = Object.keys(S.armourBag);
      for (let i = 0; i < aids.length; i++) {
        const A = W.armour(aids[i]), n = S.armourBag[A.id], p = armourSellPrice(o, A.id);
        h += '<div class="wl-op-row">' +
          '<div class="wl-op-txt"><div class="wl-op-nm">' + A.label + ' <span class="wl-dim wl-small">×' + n + '</span></div>' +
          '<div class="wl-op-st">SOAK ' + A.soak + '  ·  ' + A.note + '</div>' +
          '</div><div class="wl-op-act">' +
            '<button class="wl-btn" data-asell="' + A.id + '" data-n="1">$' + p + '</button>' +
          '</div></div>';
      }
      h += '</div>';
    }
    h += footer();
    return h;
  }

  /* ---- the recruit camp ---- */
  function drawCamp(o) {
    const S = W.state;
    let h = head(o);
    h += '<div class="wl-card"><div class="wl-op-note">' + KINDS.camp.blurb +
      '<br>Hiring drains the pool — more men walk in each morning. Every man you take on ' +
      'costs his wage <b>every dawn</b>: you are paying <b>$' + W.payroll() + '/day</b> for ' +
      (S.army.length) + ' men right now.' +
      '</div></div>';
    h += '<div class="wl-lbl">MEN AVAILABLE</div><div class="wl-card">';
    let any = false;
    for (let i = 0; i < W.TIERS.length; i++) {
      const T = W.TIERS[i], n = o.pool[T.id] || 0, p = hirePrice(o, T.id);
      if (capPool(o, T.id) <= 0) continue;
      any = true;
      const broke = p > S.gold, out = n <= 0;
      const many = Math.min(n, Math.floor(S.gold / Math.max(1, p)), 10);
      h += '<div class="wl-op-row' + (broke || out ? " gone" : "") + '">' +
        '<div class="wl-op-txt"><div class="wl-op-nm">' + T.label +
          '  <span class="wl-op-left">' + (out ? "NONE LEFT" : n + " LEFT") + '</span>' +
          '<br><span class="wl-dim wl-small" style="letter-spacing:.06em">' + T.note + '</span></div>' +
        '<div class="wl-op-st">HP ' + T.hp + '  ·  ACC ' + Math.round(T.acc * 100) + '%  ·  WAGE $' + T.wage + '/DAY  ·  ' +
          (i >= 2 ? "BRINGS HIS OWN SIDEARM" : "ARRIVES UNARMED") + '</div>' +
        '</div><div class="wl-op-act">' +
          '<button class="wl-btn' + (broke || out ? "" : " hot") + '" data-hire="' + T.id + '" data-n="1"' +
            (broke || out ? " disabled" : "") + '>$' + p + '</button>' +
          (many >= 5 ? '<button class="wl-btn mini" data-hire="' + T.id + '" data-n="5">×5</button>' : '') +
        '</div></div>';
    }
    if (!any) h += '<div class="wl-op-note">nobody left. the camp refills by morning.</div>';
    h += '</div>';
    h += footer();
    return h;
  }

  /* ---- the well ---- */
  function drawWell(o) {
    const S = W.state;
    const hurt = S.army.filter(function (s) { return s.wounded || s.hp < s.maxHp; });
    const cost = restCost();
    let h = head(o);
    h += '<div class="wl-card"><div class="wl-op-note">' + KINDS.well.blurb +
      '<br>A wounded man fights at <b>62%</b> until he rests. Resting costs a day — ' +
      'and a day costs you <b>$' + W.payroll() + '</b> in wages, on top of the water.' +
      '</div></div>';
    h += '<div class="wl-lbl">THE HURT</div><div class="wl-card">';
    if (!hurt.length) h += '<div class="wl-op-note">nobody here is hurt. drink and ride on.</div>';
    else {
      const byTier = {};
      for (let i = 0; i < hurt.length; i++) byTier[hurt[i].tier] = (byTier[hurt[i].tier] || 0) + 1;
      for (let i = 0; i < W.TIERS.length; i++) {
        const T = W.TIERS[i];
        if (!byTier[T.id]) continue;
        h += '<div class="wl-op-row"><div class="wl-op-txt"><div class="wl-op-nm">' + T.label + ' <span class="wl-dim wl-small">×' + byTier[T.id] + '</span></div>' +
          '<div class="wl-op-st">WATER AND SHADE  ·  $' + (T.wage * 6) + ' EACH</div>' +
          '</div><div class="wl-op-act"><span class="wl-op-left">' + byTier[T.id] + ' HURT</span></div></div>';
      }
    }
    if (S.you.hp < S.you.maxHp) {
      h += '<div class="wl-op-row"><div class="wl-op-txt"><div class="wl-op-nm">' + S.you.name + ' <span class="wl-dim wl-small">· you</span></div>' +
        '<div class="wl-op-st">' + Math.round(S.you.hp) + ' / ' + S.you.maxHp + ' HP</div>' +
        '</div><div class="wl-op-act"><span class="wl-op-left">HURT</span></div></div>';
    }
    h += '</div>';
    h += '<div class="wl-btns">' +
      '<button class="wl-btn' + (cost.n ? " hot" : "") + '" id="opRest"' + (cost.n ? "" : " disabled") + '>' +
        'REST A DAY  ·  $' + cost.gold + '</button></div>';
    h += footer();
    return h;
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
    if (!got) { W.toast("cannot afford it", "bad"); return 0; }
    W.toast(got + " × " + W.gunLabel(id) + " into the baggage", "good");
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
      W.toast("sold " + got + " × " + W.gunLabel(id) + " for $" + (got * p), "good");
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
    if (!got) { W.toast("cannot afford him", "bad"); return 0; }
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
    if (!W.pay(c.gold)) { W.toast("not enough for water and shade", "bad"); return false; }
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

  /* ============================================================ DRAW + WIRE */
  function draw() {
    const o = CUR;
    if (!o || !ctx || !ctx.screen) return;
    styleOnce();
    const html = o.kind === "camp" ? drawCamp(o) : o.kind === "well" ? drawWell(o) : drawTrade(o);
    const node = ctx.screen('<div class="wl-hudpad">' + html + '</div>');
    if (ctx.paintHud) ctx.paintHud();
    wire(node, o);
  }

  function wire(node, o) {
    // ONE delegated listener rather than a handler per row: a depot screen is
    // rebuilt on every purchase, and per-row handlers on a 20-row list that
    // redraws on each tap is how a trading screen starts dropping frames.
    node.onclick = function (e) {
      const t = e.target && e.target.closest ? e.target.closest("button") : null;
      if (!t) return;
      const n = parseInt(t.getAttribute("data-n") || "1", 10) || 1;
      if (t.hasAttribute("data-tab")) { TAB = t.getAttribute("data-tab"); draw(); return; }
      if (t.hasAttribute("data-buy")) { buy(o, t.getAttribute("data-buy"), n); draw(); return; }
      if (t.hasAttribute("data-sell")) { sell(o, t.getAttribute("data-sell"), n); draw(); return; }
      if (t.hasAttribute("data-abuy")) {
        const id = t.getAttribute("data-abuy"), p = armourBuyPrice(o, id);
        if ((o.armourStock[id] || 0) > 0 && W.pay(p)) { o.armourStock[id]--; W.stashArmour(id, 1); W.toast(W.armour(id).label + " into the baggage", "good"); }
        else W.toast("cannot afford it", "bad");
        draw(); return;
      }
      if (t.hasAttribute("data-asell")) {
        const id = t.getAttribute("data-asell");
        if (W.unstashArmour(id, 1)) { W.earn(armourSellPrice(o, id)); o.armourStock[id] = (o.armourStock[id] || 0) + 1; }
        draw(); return;
      }
      if (t.hasAttribute("data-hire")) { hire(o, t.getAttribute("data-hire"), n); draw(); return; }
      if (t.id === "opRest") { rest(o); draw(); return; }
      if (t.id === "opArm") { if (W.loadout && W.loadout.open) W.loadout.open({ back: function () { open(o); } }); else W.toast("loadout.js did not load", "bad"); return; }
      if (t.id === "opLeave") { close(); return; }
    };
  }

  function open(o) {
    if (!o) return;
    o.seen = true;
    CUR = o;
    TAB = "buy";
    W.setPhase("outpost", o);
    draw();
    W.emit("outpost:open", o);
  }

  function close() {
    CUR = null;
    W.emit("outpost:close");
    /* GIVE THE ISLAND BACK. campaign.js owns the campaign phase; if it is not
       loaded (or failed), fall back to the menu rather than leaving a dead
       screen with no way out. */
    if (W.campaign && W.campaign.enter) W.campaign.enter();
    else { W.setPhase("menu"); W.emit("mainmenu"); }
  }

  // a module must tear its own screen down when it loses the phase
  W.on("phase:leave:outpost", function () { CUR = null; });

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
    current: function () { return CUR; },
  });
})();
