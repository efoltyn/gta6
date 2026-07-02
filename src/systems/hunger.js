/* ============================================================
   systems/hunger.js — Stage X, step X2: HUNGER, everywhere.

   MASTER-PLAN V.1b: "every character eats like Minecraft; hungry NPCs
   steal; famine becomes a political force." Two halves:

   1) PLAYER (Minecraft-style, cross-mode). City mode ALREADY shipped a
      complete player hunger loop before this wave — city/hunger.js's
      g.hunger: drains, sprint-costs more, food (shops.js/cityEat) fills
      it, hunger===0 starves you. That system is untouched here except
      two guarded one-line additions (this file's header documents both):
        - city/hunger.js's starvation branch now floors at 5 hp (a mercy
          floor — hunger alone can no longer finish you off in the city;
          combat/falls/etc. still can). Comment lives at that call site.
        - city/death.js's out-of-combat regen now skips while hungry
          (CBZ.player._hungryNoRegen, set below) — "grep regen" turned up
          exactly one passive-regen call site and this guards it.
      SURVIVAL + ESCAPE modes had NO hunger mechanic before this file —
      this file adds the whole Minecraft loop for them (start 80, drains
      1.2/in-game-hour idle x2 sprinting, eating restores it, hunger<30
      blocks sprint, hunger===0 starves — fully lethal, no mercy floor,
      per the plan's "survival mode: full lethal"). CBZ.player.hunger is
      kept in sync every frame for ANY mode (city mirrors g.hunger;
      survival/escape read this file's own g._oocHunger) — one field any
      consumer can read regardless of which mode is live.
      EATING (escape mode): systems/inventory.js's effect() calls
      CBZ.hunger.onConsume(name) (one guarded line added there) — the
      snack items (Ramen/Energy Bar/Energy Drink) aren't tagged "food" in
      systems/economy.js's ITEMS (no heal field over there), so FOOD_FILL
      below is the "hungerFill field default" the plan calls for.
      Survival mode has no inventory (css/inventory.css hides #hotbar
      there) — no eating outlet in that mode is intentional, matching a
      short battle-royale round; hunger there is a slow, mostly one-way
      pressure.

   2) NPC COHORT HUNGER + FAMINE (the new ground). sim/npcecon.js's 20
      cohort rows (5 districts x 4 income classes) already track pop/
      wallet/food-propensity spend (CBZ.npcEcon.lastSpend[district].food,
      $ actually spent last hour) — this file layers a PARALLEL hungerAvg
      per row on top, in ITS OWN blob (g.hungerWorld), not npcecon's rows/
      serialize schema (per the plan: "rides npcecon? NO").

      EQUATION (hourly, order 29.65 — right after npcecon's own 29.6 pass
      has settled this hour's lastSpend):
        needed(row)   = row.pop * MEAL_BASE[class] * CBZ.market.price("food")
          MEAL_BASE[c] = CLASS_WAGE[c] * EMPLOYED_FRAC[c] * FOOD_PROP — the
          row's OWN baseline per-head food dollar need at parity (price
          1.0, activity 1.0) — duplicated constants from npcecon.js
          (documented, same "no hard load-order dependency" precedent
          that file already sets for DISTRICT_KEYS).
        achieved(row) = district's ACTUAL lastSpend.food dollars, split
          across that district's 4 classes proportional to their
          baseline income share (pop*wage*employedFrac) — so a district
          the player has robbed into a depression (npcecon's own
          documented "rob a district into a depression" chain) shows up
          here as LESS achieved, MORE hunger, same $ figures throughout.
        ratio  = clamp(achieved/needed, 0, 1.5)
        hungerAvg = clamp(hungerAvg - DRAIN + RECOVERY*ratio, 0, 100)
          DRAIN = RECOVERY = 4 — chosen so ratio===1 (achieved exactly
          covers needed) nets EXACTLY zero BY CONSTRUCTION — the formula
          itself is neutral at parity, same spirit as market.js/econstate.js/
          npcecon.js's own "day one changes nothing observable" contract.
          IN PRACTICE this file's harness (x2harness.js) found that
          sim/npcecon.js's OWN hourly pass (pre-existing E4 code, untouched
          here) calls CBZ.market.recordBuy("food", ...) once per COHORT ROW
          (20x/hour) — each call nudges the price up, and 20 stacked nudges
          clear the 0.85..1.15-clamped priceAdj band and push the raw food
          price to its own 1.8 ceiling within the first hour or two of a
          fresh city, entirely from cohort demand, with zero player action.
          That is arguably the game already handing famine a head start —
          left as-is (out of scope for X2 to rebalance E4's demand-signal
          magnitude) — and it's exactly why this ratio reads the LIVE
          market price every hour instead of assuming day-one parity holds:
          THE FAMINE LEVER (expensive food = less eaten = hunger rises)
          fires for real, fast, per the plan.

      THEFT (order 34.55, next to city/aigoals.js's SOCIAL band): any
      district with a row under HUNGRY_T (35) rolls a continuous, dt-scaled
      chance (rate scales with desperation = how far under 35) to have a
      live ped in that district visibly steal a bite — a feed line, a
      minor CBZ.cityNpcOffense report (city/police.js's existing NPC-
      offender registry), and a small hungerAvg bump for that row (they
      ate; cohort wallet is untouched, per the plan's "+0").

      FOOD RIOT: 2+ districts with any row under RIOT_T (15) -> riotActive
      — periodic CBZ.cityPostEvent panic bursts, a "🔥 FOOD RIOTS" feed
      line, and a guarded CBZ.polity approval nudge (-5/day) for as long
      as it holds.

      MISERY INDEX: CBZ.hunger.miseryIndex() — a 0..1 weighted blend of
      cohort hunger and cohort wallet health. Exported now, UNCONSUMED
      until X6b's civil-war trigger (comment only — no call sites yet).

      LEDGER (city/schedule.js): individual offline identities (the
      ≤900-entry stash/deal-in ledger) carry a compact e.hunger (0..100)
      alongside e.cash; fastForward() drains it hour-by-hour right beside
      the existing cash accrual and auto-eats from e.cash the moment it
      can afford CBZ.hunger.mealCost() — a broke ledger NPC goes hungry
      exactly like a broke live one. e.hungry (0/1) is a cheap flag a
      future aigoals read could use (not consumed here, per the plan).

   PERSISTENCE: same two-rider pattern as npcecon.js/market.js —
     - MULTIPLAYER: src/net/netpersist.js worldBlob()/applyWorld() picks
       up serialize()/apply() beside blob.npce/blob.mkt (blob.hng).
     - SINGLE-PLAYER: wraps CBZ.cityWorldCommit/cityWorldCollect (own
       guard flag _hngWrap) so g.cityWorld.hng rides the localStorage
       ledger, slotted right after npcecon.js's 45.97 install tick.
   Fresh-run reset: city/peds.js's spawnCityPeds() resets market/econState/
   npcEcon in a row; this file's CBZ.hunger.reset() sits right beside them.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  const HOUR = 150 / 24;   // seconds per in-game hour — matches market.js/npcecon.js/daynight.js's CYCLE exactly

  function clampNum(lo, hi, v) { return Math.max(lo, Math.min(hi, v)); }

  // own seeded LCG (never Math.random — repo convention for world state):
  // theft rolls + which ped gets picked both consume this stream.
  let _seed = 55440011 & 0x7fffffff;
  function rng() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }

  // ============================================================
  //  PART 1 — PLAYER (Minecraft-style, cross-mode)
  // ============================================================
  const PLAYER_START = 80;
  const DRAIN_PER_HR = 1.2;      // hunger points/in-game-hour, idle
  const SPRINT_MULT = 2;         // sprinting burns through food twice as fast
  const HUNGRY_SPRINT_GATE = 30; // below this, sprint is gated off entirely
  const STARVE_DMG_PER_SEC = 0.25; // 1 hp per 4s at hunger===0 (non-city; city keeps its own C.starveDmg rate)

  // FOOD_FILL: the "hungerFill field default" the plan calls for — systems/
  // economy.js's ITEMS carry no `heal` field (that's city/economy.js's
  // catalog), so the escape-mode snack items get their fill values named
  // here instead of a heal*1.5 read. Consumed by onConsume() below, which
  // systems/inventory.js's effect() calls (one guarded line added there).
  const FOOD_FILL = { Ramen: 40, "Energy Bar": 22, "Energy Drink": 15 };

  function tickPlayer(dt) {
    const P = CBZ.player;
    if (!P || P.dead) return;
    if (g.mode === "city") {
      // city/hunger.js already owns the full drain/eat/starve loop on
      // g.hunger — just mirror it so CBZ.player.hunger reads correctly
      // in every mode without touching that file's own state machine.
      CBZ.player.hunger = g.hunger == null ? 100 : g.hunger;
    } else if (g.mode === "survival" || g.mode === "escape") {
      if (g._oocHunger == null) g._oocHunger = PLAYER_START;
      const drain = (DRAIN_PER_HR / HOUR) * (P.sprint ? SPRINT_MULT : 1);
      g._oocHunger = clampNum(0, 100, g._oocHunger - drain * dt);
      CBZ.player.hunger = g._oocHunger;
      if (g._oocHunger <= 0 && !((g.invuln || 0) > 0)) {
        const dmg = STARVE_DMG_PER_SEC * dt;
        // FULL LETHAL outside the city, per the plan — no mercy floor here.
        if (g.mode === "survival" && CBZ.surv && CBZ.surv.hurt) {
          CBZ.surv.hurt({ isPlayer: true }, dmg, { cause: "starved" });
        } else if (g.mode === "escape") {
          P.hp = (P.hp == null ? 100 : P.hp) - dmg;
          if (P.hp <= 0) {
            P.hp = 100;
            if (CBZ.haulToCell) CBZ.haulToCell("🍞 STARVED — DRAGGED TO YOUR CELL");
          }
        }
      }
    }
    // ---- cross-mode effects, driven by the just-synced CBZ.player.hunger ----
    const h = CBZ.player.hunger;
    if (h != null && h < HUNGRY_SPRINT_GATE) {
      // physics.js:491 gates sprint on `player.stamina > 0` — draining it to 0
      // is the cleanest read-only seam into that gate from outside physics.js.
      P.stamina = 0;
    }
    // city/death.js's out-of-combat regen reads this flag (one guarded line
    // added there) — "no passive HP regen while hungry" without duplicating
    // city/hunger.js's own starvation-damage branch.
    P._hungryNoRegen = h != null && h < HUNGRY_SPRINT_GATE;
  }
  CBZ.onUpdate(32.05, tickPlayer);   // right after city/hunger.js's own order-32 tick

  // onConsume(name) — systems/inventory.js's effect() calls this before its
  // own switch (one guarded line). City mode's food loop is cityEat(), not
  // this file's — no-op there so the two never double-feed the same meter.
  function onConsume(name) {
    const fill = FOOD_FILL[name];
    if (!fill || g.mode === "city") return;
    if (g._oocHunger == null) g._oocHunger = PLAYER_START;
    g._oocHunger = clampNum(0, 100, g._oocHunger + fill);
    CBZ.player.hunger = g._oocHunger;
  }

  // ============================================================
  //  PART 2 — NPC COHORT HUNGER + FAMINE
  // ============================================================
  // duplicated from sim/npcecon.js (see that file's own DISTRICT_KEYS
  // precedent for why: no hard load-order dependency between sim files).
  const DISTRICT_KEYS = ["downtown", "projects", "waterfront", "uptown", "island"];
  const CLASSES = ["poor", "mid", "comf", "rich"];
  const CLASS_WAGE = { poor: 6, mid: 14, comf: 32, rich: 90 };
  const EMPLOYED_FRAC = { poor: 0.75, mid: 0.90, comf: 0.90, rich: 0.60 };
  const FOOD_PROP = 0.4;   // npcecon.js's PROPENSITIES.food

  const START_HUNGER = 75;
  const DRAIN = 4, RECOVERY = 4;         // net 0 at ratio===1 — day-one neutral, see file header
  const RATIO_CAP = 1.5;
  const HUNGRY_T = 35;                   // below this: shoplift pressure
  const RIOT_T = 15;                     // below this in 2+ districts: food riot
  const RIOT_MIN_DISTRICTS = 2;
  const MEAL_DOLLAR = 3;                 // flat per-head/per-identity meal price at parity (ledger + itemPrice both read this)
  const APPROVAL_PER_DAY = 5;            // riot ongoing: polity approval bleed
  const DAY_SECS = HOUR * 24;

  function districtKeys() { return (CBZ.npcEcon && CBZ.npcEcon.DISTRICT_KEYS) || DISTRICT_KEYS; }
  function classes() { return (CBZ.npcEcon && CBZ.npcEcon.CLASSES) || CLASSES; }

  function ensureInit() {
    if (!g.hungerWorld || !g.hungerWorld.rows) reset();
  }
  function reset() {
    const rows = [];
    for (const dk of districtKeys()) for (const c of classes()) rows.push({ d: dk, c: c, hungerAvg: START_HUNGER });
    g.hungerWorld = { rows: rows, hrAcc: 0, riotActive: false, riotFeedShown: false, feedT: 0 };
  }
  function rowFor(dk, cls) {
    ensureInit();
    const rows = g.hungerWorld.rows;
    for (let i = 0; i < rows.length; i++) if (rows[i].d === dk && rows[i].c === cls) return rows[i];
    return null;
  }
  // mealCost() — CBZ.hunger's public "what does one meal cost right now"
  // read: a flat per-head dollar figure scaled by the SAME live market food
  // price every shop register already reads (sim/market.js). Consumed by
  // city/schedule.js's ledger fastForward() (one guarded call) and internally
  // as the parity baseline for the cohort ratio below.
  function mealCost() {
    const p = (CBZ.market && CBZ.market.price) ? CBZ.market.price("food") : 1.0;
    return MEAL_DOLLAR * p;
  }
  function classMealBase(c) { return CLASS_WAGE[c] * EMPLOYED_FRAC[c] * FOOD_PROP; }

  // ---- the hourly pass: hungerAvg -= DRAIN, += RECOVERY*ratio ------------
  function hourTick() {
    ensureInit();
    const M = g.hungerWorld;
    const foodPrice = (CBZ.market && CBZ.market.price) ? CBZ.market.price("food") : 1.0;
    const lastSpend = (CBZ.npcEcon && CBZ.npcEcon.lastSpend) || null;
    for (const dk of districtKeys()) {
      // this district's ACTUAL food dollars spent last hour (npcecon.js's
      // real, robbery/price-aware figure), split across its 4 classes by
      // their baseline income share (wage x employedFrac x pop).
      const districtFood = (lastSpend && lastSpend[dk]) ? (lastSpend[dk].food || 0) : 0;
      let shareTotal = 0;
      const shares = {};
      for (const c of classes()) {
        const row = rowFor(dk, c);
        const pop = row ? (rowPop(dk, c) || 1) : 1;
        const w = pop * CLASS_WAGE[c] * EMPLOYED_FRAC[c];
        shares[c] = w; shareTotal += w;
      }
      for (const c of classes()) {
        const row = rowFor(dk, c);
        if (!row) continue;
        const pop = rowPop(dk, c) || 1;
        const achieved = shareTotal > 0 ? districtFood * (shares[c] / shareTotal) : 0;
        const needed = pop * classMealBase(c) * foodPrice;
        const ratio = needed > 0 ? clampNum(0, RATIO_CAP, achieved / needed) : 1;
        row.hungerAvg = clampNum(0, 100, row.hungerAvg - DRAIN + RECOVERY * ratio);
      }
    }
    checkRiot();
  }
  // pop lookup (cohort headcount) — falls back to 1 if npcecon isn't reachable.
  function rowPop(dk, cls) {
    const rows = (CBZ.npcEcon && CBZ.npcEcon.summary) ? CBZ.npcEcon.summary() : null;
    if (!rows) return 1;
    for (const r of rows) if (r.d === dk && r.c === cls) return r.pop;
    return 1;
  }

  function districtName(dk) {
    return (CBZ.cityEcon && CBZ.cityEcon.districtName) ? CBZ.cityEcon.districtName(dk) : dk;
  }
  function districtMinHunger(dk) {
    let m = 100;
    for (const c of classes()) { const row = rowFor(dk, c); if (row && row.hungerAvg < m) m = row.hungerAvg; }
    return m;
  }
  function checkRiot() {
    ensureInit();
    const M = g.hungerWorld;
    let count = 0;
    for (const dk of districtKeys()) if (districtMinHunger(dk) < RIOT_T) count++;
    const was = M.riotActive;
    M.riotActive = count >= RIOT_MIN_DISTRICTS;
    if (M.riotActive && !was) {
      M.riotFeedShown = false;   // fire the "FOOD RIOTS" line once on the rising edge
    }
  }

  CBZ.onUpdate(29.65, function (dt) {     // right after npcecon.js's 29.6 hourly pass
    if (g.mode !== "city") return;
    ensureInit();
    const M = g.hungerWorld;
    M.hrAcc = (M.hrAcc || 0) + dt;
    while (M.hrAcc >= HOUR) { M.hrAcc -= HOUR; hourTick(); }
  });

  // ---- THEFT: hungry+broke cohorts steal, visibly ------------------------
  const THEFT_BASE_RATE = 0.03;   // events/sec per district at full desperation (hungerAvg -> 0)
  function districtDesperation(dk) {
    const h = districtMinHunger(dk);
    if (h >= HUNGRY_T) return 0;
    return clampNum(0, 1, (HUNGRY_T - h) / HUNGRY_T);
  }
  function pickPedIn(dk) {
    const peds = CBZ.cityPeds;
    if (!peds || !peds.length) return null;
    const cands = [];
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p || p.dead || p.isPlayer || p.vendor || p.companion) continue;
      if (!p.pos) continue;
      const d = CBZ.cityEcon && CBZ.cityEcon.districtAt ? CBZ.cityEcon.districtAt(p.pos.x, p.pos.z) : null;
      if (d === dk) cands.push(p);
    }
    if (!cands.length) return null;
    return cands[Math.floor(rng() * cands.length) % cands.length];
  }
  function theftEvent(dk) {
    const ped = pickPedIn(dk);
    const name = (ped && ped.name) || "someone hungry";
    if (CBZ.cityFeed) CBZ.cityFeed("🍞 " + name + " stole bread in " + districtName(dk), "#ffb27a");
    if (ped && CBZ.cityNpcOffense) CBZ.cityNpcOffense(ped, 6, "shoplift");
    // "cohort wallet +0" per the plan — only hungerAvg ticks up (they ate).
    const cls = ped ? (CBZ.npcEcon && CBZ.npcEcon.classFor ? CBZ.npcEcon.classFor(ped.wealth) : "poor") : "poor";
    const row = rowFor(dk, cls);
    if (row) row.hungerAvg = clampNum(0, 100, row.hungerAvg + 5);
  }
  CBZ.onUpdate(34.55, function (dt) {    // next to city/aigoals.js's SOCIAL band (34.5)
    if (g.mode !== "city") return;
    ensureInit();
    for (const dk of districtKeys()) {
      const desp = districtDesperation(dk);
      if (desp <= 0) continue;
      if (rng() < THEFT_BASE_RATE * desp * dt) theftEvent(dk);
    }
    // ---- FOOD RIOT: feed line (once per rising edge) + panic bursts + approval bleed ----
    const M = g.hungerWorld;
    if (M.riotActive) {
      if (!M.riotFeedShown) {
        M.riotFeedShown = true;
        if (CBZ.cityFeed) CBZ.cityFeed("🔥 FOOD RIOTS breaking out across the city", "#ff4d4d");
      }
      M.feedT = (M.feedT || 0) + dt;
      if (M.feedT >= 3) {
        M.feedT = 0;
        for (const dk of districtKeys()) {
          if (districtMinHunger(dk) >= RIOT_T) continue;
          const ped = pickPedIn(dk);
          if (ped && CBZ.cityPostEvent) CBZ.cityPostEvent({ type: "riot", pos: ped.pos, radius: 22, intensity: 0.7 });
        }
      }
      const P = CBZ.player;
      const rec = (P && P.pos && CBZ.polity && CBZ.polity.of) ? CBZ.polity.of(P.pos.x, P.pos.z) : null;
      if (rec) rec.approval = Math.max(0, (rec.approval || 0) - (APPROVAL_PER_DAY / DAY_SECS) * dt);
    }
  });

  // ---- MISERY INDEX: the X6b civil-war fuse (exported now, unconsumed) --
  function miseryIndex() {
    ensureInit();
    const rows = g.hungerWorld.rows;
    let wsum = 0, hmisery = 0;
    for (const row of rows) {
      const w = rowPop(row.d, row.c) || 1;
      wsum += w;
      hmisery += w * ((100 - row.hungerAvg) / 100);
    }
    const hungerTerm = wsum > 0 ? hmisery / wsum : 0;
    const wh = (CBZ.npcEcon && CBZ.npcEcon.walletHealth) ? CBZ.npcEcon.walletHealth() : 1.0;
    const walletTerm = clampNum(0, 1, 1 - wh);
    return clampNum(0, 1, hungerTerm * 0.6 + walletTerm * 0.4);
  }

  function summary() {
    ensureInit();
    return g.hungerWorld.rows.map(function (r) { return { d: r.d, c: r.c, hungerAvg: Math.round(r.hungerAvg * 10) / 10 }; });
  }

  // ---- persistence --------------------------------------------------------
  function serialize() {
    ensureInit();
    const M = g.hungerWorld;
    return {
      v: 1,
      rows: M.rows.map(function (r) { return { d: r.d, c: r.c, h: Math.round(r.hungerAvg * 10) / 10 }; }),
      hrAcc: M.hrAcc || 0,
      riotActive: !!M.riotActive,
      oocHunger: g._oocHunger == null ? null : g._oocHunger,
    };
  }
  function apply(obj) {
    if (!obj || obj.v !== 1) return;
    reset();
    const M = g.hungerWorld;
    if (Array.isArray(obj.rows)) for (const src of obj.rows) {
      if (!src) continue;
      const row = rowFor(src.d, src.c);
      if (row && isFinite(src.h)) row.hungerAvg = clampNum(0, 100, +src.h);
    }
    M.hrAcc = obj.hrAcc || 0;
    M.riotActive = !!obj.riotActive;
    M.riotFeedShown = M.riotActive;    // don't re-fire the feed line on a load that resumes an ongoing riot
    if (isFinite(obj.oocHunger)) g._oocHunger = clampNum(0, 100, +obj.oocHunger);
  }

  CBZ.hunger = {
    onConsume: onConsume,
    mealCost: mealCost,
    miseryIndex: miseryIndex,
    summary: summary,
    serialize: serialize,
    apply: apply,
    reset: reset,
  };

  // ============================================================
  //  SINGLE-PLAYER PERSIST — npcecon.js's g.cityWorld pattern, verbatim:
  //  stamp the live rows onto g.cityWorld right before the existing commit/
  //  collect save hooks run, hydrate back out whenever that ledger object's
  //  REFERENCE changes. Own idempotence flag (_hngWrap).
  // ------------------------------------------------------------
  function stampHunger() {
    const led = g.cityWorld;
    if (led && typeof led === "object") led.hng = serialize();
  }
  let _ensureHungerSaveWraps_done = false;
  function ensureHungerSaveWraps() {
    // ONE-SHOT INSTALL (chain-growth fix): the old guard checked the
    // module flag on the CURRENT top-of-chain function, so once any
    // later module wrapped above us the flag vanished from the top and
    // we re-wrapped EVERY tick - ~20 such modules made the commit chain
    // grow unboundedly (stack overflow on save; found by the P5 full-
    // stack harness). A module-local boolean wraps exactly once, ever.
    if (_ensureHungerSaveWraps_done) return;
    _ensureHungerSaveWraps_done = true;
    const commit = CBZ.cityWorldCommit;
    if (typeof commit === "function" && !commit._hngWrap) {
      const w = function () { stampHunger(); return commit.apply(this, arguments); };
      w._hngWrap = true; CBZ.cityWorldCommit = w;
    }
    if (CBZ.cityWorldCollect && !CBZ.cityWorldCollect._hngWrap) {
      const col = CBZ.cityWorldCollect;
      const wc = function () { stampHunger(); return col.apply(this, arguments); };
      wc._hngWrap = true; CBZ.cityWorldCollect = wc;
    }
  }
  let _hydratedLedger = null;
  function hydrateFromLedger() {
    const led = g.cityWorld;
    if (!led || led === _hydratedLedger) return;
    _hydratedLedger = led;
    if (led.hng) apply(led.hng);
  }
  if (CBZ.onUpdate) {
    // next free slot after npcecon.js's 45.97 — same install-tick family.
    CBZ.onUpdate(45.98, function () {
      if (!g) return;
      ensureHungerSaveWraps();
      hydrateFromLedger();
    });
  }
})();
