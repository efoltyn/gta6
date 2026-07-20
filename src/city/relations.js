/* ============================================================
   city/relations.js — Stage X, step X6: THE AFFINITY MATRIX.

   MASTER-PLAN V.1a (verbatim): "countries (and states, and even rival
   cities) carry a standing affinity matrix (-100..100) seeded by history
   flavor and moved by events — trade deals, insults, wars, refugee waves,
   sports rivalries. Affinity feeds everything: tariffs and border friction
   (nationalism), migration destination choice, alliance/war pressure in
   the transition graph, even street-level NPC reactions to foreigners
   under hostile regimes." V.5/X6b: war pressure and civil-war fronts are
   THIS file's job to EXPORT (a pure function), not resolve — polwar.js
   (P8) and the civil-war trigger (X6b) are the actual consumers, both
   unbuilt yet, so `warPressure(a,b)` below is wired now and unconsumed,
   same "export before the consumer exists" precedent systems/hunger.js's
   own miseryIndex() already set for X6b.

   THE TEMPLATE: city/turf.js's ALLIANCE graph (~turf.js:192-249) is the
   precedent this file generalizes — a pair-keyed (sorted ids) relation
   number that drifts toward neutral, is nudged by events, and exposes a
   few named public setters. turf.js's `rel` is -1..1 and ephemeral
   (never persisted, reseeded every cityTurfReset()); THIS file's is
   -100..100 and IS persisted (political relations should survive a
   reload the way turf's minute-to-minute gang mood doesn't need to).

   SCOPE THIS WAVE: the 5 countries (republic/veridia/kesh/solara/mbeya,
   city/countries.js's roster + the original "republic") get a full
   pairwise seed (10 pairs). Two mainland CITY rivalries seed for flavor
   (goldspire-neonreef, capeharbor-foundry) — states are not seeded (no
   state-level rivalry flavor was asked for), but the SAME pair-keyed
   store works for any two polity ids a future caller wants to relate;
   nothing here is hardcoded to "country kind only" except the monthly
   aid/tariff/office-churn sweeps, which are explicitly country-scoped
   (see each function's own comment).

   EVENT FEEDS WIRED THIS WAVE (see CBZ.relations.event(a,b,kind,mag)):
     (a) player-crime-against-a-country's-citizens — SKIPPED, per the task
         brief: "too granular" (no per-citizen nationality tagging exists
         anywhere in the ped/ledger schema this wave — a real hook needs
         demographics.js's region-of-origin data wired through to individual
         peds first, which X4 did NOT do; flagged here, not invented).
     (b) ASSASSINATION: officials.js's cityKillPed wrap now fires a new,
         generic CBZ.onOfficialDeath(fn) subscriber list (4 lines added to
         that file, see its own header) whenever ANY officeholder (mayor,
         governor, president, king, village chief) dies. THIS file
         subscribes: if the dead officeholder's country != "republic" AND
         the killing happened on republic soil (CBZ.polity.of(ped.pos) →
         countryOf === "republic"), that country's rel with the republic
         takes an "insult"-kind hit (a foreign statesman murdered on your
         soil is a diplomatic incident). NARROWING (documented, not a
         silent gap): officials.js's OWN header says only the mayor
         (libertyville, i.e. a REPUBLIC office) is physically embodied this
         wave — so a foreign officeholder can never actually BE on republic
         soil yet, and this feed is naturally dormant in practice until
         P5 gives governors/presidents bodies that can travel. It is fully
         wired and unit-testable today by calling the subscriber directly
         with a synthetic {rec, sid, ped} (see x6harness).
     (c) AID DIPLOMACY (hunger → foreign policy): monthly (worldDay % 30),
         any country whose CAPITAL econstate activity < 0.75 gains a +5
         "aid"-kind bump with every country whose capital activity > 1.1 —
         a flavor auto-event ("X sends aid to Y"), not a real resource
         transfer (no treasury moves — that's M-stage forex/aid-budget
         depth). Capital ids resolved off city/countries.js's own
         CBZ.COUNTRIES table (each entry's one `capital:true` settlement)
         + econstate.js's own DEFAULT_ID for "republic" (libertyville).
     (d) ELECTIONS/SUCCESSION CLEAN SLATE: every worldDay, this file diffs
         each country record's CURRENT office.holder against the sid it
         saw last time. A change (a real election result OR an assassin's
         succession swap — both routes end with polity.js's office.holder
         field changing, and V.1a's "new leadership" flavor reads the same
         either way) relaxes that country's every relation 20% toward 0
         ("new leadership, clean slate") — implemented as a generic
         holder-diff instead of a dedicated elections.js hook so BOTH
         succession paths trigger it with one code path, per the task's own
         "wired NOW, cheap" spirit.

   CONSEQUENCES WIRED NOW (cheap — deeper versions are named future work):
     - TARIFF/PRICE: monthly, any non-republic country holding rel < -50
       with the republic drags city/worldstate.js's w.economy.confidence
       −2 (an "embargo" flavor line) — the same write-only field
       approval.js's econ term already reads, so a cold war with the
       republic shows up in libertyville's OWN approval equation for free.
       Deeper trade (real import friction/price surcharges through
       sim/market.js) is M-stage forex work — commented, not built.
     - STREET REACTIONS: peds physically walking between countries doesn't
       exist yet (no inter-country travel/ferries — SKIPPED, per the task
       brief). Instead: gossip/feed flavor lines fire on THRESHOLD CROSSING
       (edge-triggered, rearm in the neutral band — approval.js's own
       checkThresholdFeed() shape) at rel<=-50 ("recalls its ambassador")
       and rel>=+50 ("signs a trade pact") for ANY seeded/touched pair.
     - WAR PRESSURE: CBZ.relations.warPressure(a,b) — a pure function,
       0 until rel<-40, ramping to 1.0 at rel=-100. Exported for P8's war
       director / X6b's civil-war threshold; nothing calls it yet.
     - APPROVAL TIE: any pair whose rel first crosses below -70 fires a
       ONE-TIME +3 CBZ.approvalShock() "rally 'round the flag" for BOTH
       jurisdiction ids, then a −1/day grind (war-weariness preview) for as
       long as it stays below -70; easing back above -70 stops the grind
       (and re-arms the one-time rally for a future relapse). Only fires
       between two ids CBZ.polity.get() actually resolves (so a stray
       future city/city feud gets the same treatment automatically).

   DRIFT: once per worldDay (CBZ.onNewDay, polity.js's subscriber list —
   same list turf.js's own daily hooks use), every KNOWN pair (anything
   ever seeded or touched by event()) steps 1 toward 0 — UNLESS the pair
   is "held" by an active war modifier: event(...,"war",mag) floors the
   pair at -60 and marks it held; the hold lifts itself automatically the
   moment any later event nudges that same pair back above -60 (a peace
   deal, aid, trade — whatever raises it past the floor also ends the
   war-hold, no separate "end war" API needed this wave).

   PERSISTENCE: same two-rider pattern as polity.js/approval.js/hunger.js —
     - MULTIPLAYER: src/net/netpersist.js worldBlob()/applyWorld() carry
       serialize()/apply() beside blob.pol (blob.rel).
     - SINGLE-PLAYER: wraps CBZ.cityWorldCommit/cityWorldCollect (own guard
       flag _relWrap) so g.cityWorld.rel rides the localStorage ledger.
   feedFlags (the threshold-crossing edge state) is deliberately NOT
   persisted — ephemeral, cheap to rebuild, same call approval.js's own
   feedFlags makes.

   POLITICS PANEL: CBZ.relations.summaryFor(countryId) → {best, worst}
   (each {id,name,rel} or null) — city/approval.js's jurisdictionCard()
   gets one small addition (a "Best friend"/"Worst enemy" row for "country"
   kind records only), the exact elections.js precedent ("panel owns
   rendering, the data module owns the query — CBZ.elections.status()
   is read the same arm's-length way).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  function clampNum(lo, hi, v) { return Math.max(lo, Math.min(hi, v)); }

  // ============================================================
  //  PAIR KEY — turf.js's exact shape (sorted ids, "a|b")
  // ============================================================
  function relKey(a, b) { return a < b ? a + "|" + b : b + "|" + a; }
  function splitKey(k) { const i = k.indexOf("|"); return [k.slice(0, i), k.slice(i + 1)]; }

  // ============================================================
  //  SEED DATA — history flavor, read once by seedRelations(). Values are
  //  the FIRST id in the pair's own affinity toward the second (symmetric —
  //  there is one number per pair, not two).
  // ============================================================
  const COUNTRY_SEEDS = [
    // [a, b, value, flavor]
    ["republic", "veridia", 40, "Trade Partners Accord"],
    ["republic", "kesh", -10, "Cold correspondence"],
    ["veridia", "solara", 20, "Shared sea lanes"],
    ["kesh", "mbeya", 30, "The Southern Alliance"],
    ["solara", "kesh", -35, "The Old Maritime Dispute"],
    ["republic", "mbeya", 5, "Cordial, distant"],
    ["veridia", "mbeya", -20, "Border skepticism"],
    ["solara", "republic", 15, "Friendly commerce"],
    ["veridia", "kesh", -25, "Court intrigues"],
    ["solara", "mbeya", 0, "No history to speak of"],
  ];
  // city-level rivalries — the two mainland mini-cities the task named
  // (both already real city/countries.js/polity.js records; states are
  // not seeded — no rivalry flavor was asked for at that tier).
  const CITY_SEEDS = [
    ["goldspire", "neonreef", -15, "Finance vs. Casino rivalry"],
    ["capeharbor", "foundry", -10, "Port vs. Factory rivalry"],
  ];

  const T_LOW = -50, T_HIGH = 50;       // gossip/feed threshold-crossing
  const WAR_FLOOR = -60;                // event(...,"war",mag) floor while held
  const WAR_TIE_T = -70;                // approval rally/grind threshold
  const RALLY_SHOCK = 3, GRIND_SHOCK = 1;
  const MONTH_DAYS = 30;                 // "monthly" cadence, worldDay-based
  const TARIFF_T = -50;                  // embargo-flavor confidence drag threshold
  const TARIFF_CONFIDENCE_HIT = 2;
  const AID_NEEDY_T = 0.75, AID_DONOR_T = 1.1, AID_BUMP = 5;
  const KIND_SIGN = { trade: 1, aid: 1, insult: -1, border: -1, war: -1 };

  // ============================================================
  //  STATE — g.relWorld: {rel, warHeld, warTieActive, feedFlags, lastHolder}
  // ============================================================
  function freshState() { return { rel: {}, warHeld: {}, warTieActive: {}, feedFlags: {}, lastHolder: {} }; }
  function seedInto(relObj) {
    for (let i = 0; i < COUNTRY_SEEDS.length; i++) { const s = COUNTRY_SEEDS[i]; relObj[relKey(s[0], s[1])] = s[2]; }
    for (let i = 0; i < CITY_SEEDS.length; i++) { const s = CITY_SEEDS[i]; relObj[relKey(s[0], s[1])] = s[2]; }
  }
  function reset() {
    g.relWorld = freshState();
    seedInto(g.relWorld.rel);
  }
  function ensureInit() {
    if (!g.relWorld || !g.relWorld.rel) { reset(); return; }
    if (!g.relWorld.warHeld) g.relWorld.warHeld = {};
    if (!g.relWorld.warTieActive) g.relWorld.warTieActive = {};
    if (!g.relWorld.feedFlags) g.relWorld.feedFlags = {};
    if (!g.relWorld.lastHolder) g.relWorld.lastHolder = {};
  }

  // ============================================================
  //  CORE READ/WRITE
  // ============================================================
  function getRel(a, b) {
    ensureInit();
    if (!a || !b || a === b) return 0;
    const k = relKey(a, b);
    return k in g.relWorld.rel ? g.relWorld.rel[k] : 0;
  }
  // direct override — bypasses the event feed/thresholds entirely (harness +
  // future systems, e.g. a war director forcing a negotiated rel, want this).
  function setRel(a, b, v) {
    ensureInit();
    if (!a || !b || a === b) return 0;
    const nv = clampNum(-100, 100, v);
    g.relWorld.rel[relKey(a, b)] = nv;
    return nv;
  }
  function nameOf(id) {
    const r = CBZ.polity && CBZ.polity.get ? CBZ.polity.get(id) : null;
    return (r && r.name) || id;
  }

  // ---- threshold-crossing feed lines (approval.js's checkThresholdFeed shape)
  function checkThresholdFeed(a, b) {
    ensureInit();
    const k = relKey(a, b);
    const v = getRel(a, b);
    const flags = g.relWorld.feedFlags[k] || (g.relWorld.feedFlags[k] = { low: false, high: false });
    if (v <= T_LOW) {
      if (!flags.low) {
        flags.low = true; flags.high = false;
        if (CBZ.cityFeed) CBZ.cityFeed("" + nameOf(a) + " recalls its ambassador from " + nameOf(b), "#ff6a5e");
      }
    } else if (v >= T_HIGH) {
      if (!flags.high) {
        flags.high = true; flags.low = false;
        if (CBZ.cityFeed) CBZ.cityFeed("" + nameOf(a) + " signs a trade pact with " + nameOf(b), "#8fe08a");
      }
    } else {
      flags.low = false; flags.high = false;   // neutral band — rearm both edges
    }
  }

  // ============================================================
  //  EVENT FEED — CBZ.relations.event(a, b, kind, mag)
  // ============================================================
  function event(a, b, kind, mag) {
    ensureInit();
    if (!a || !b || a === b) return getRel(a, b);
    const sign = KIND_SIGN[kind];
    if (sign == null) return getRel(a, b);   // unknown kind — ignored, not thrown
    const m = Math.abs(isFinite(mag) ? mag : 10);
    let v = getRel(a, b) + sign * m;
    const k = relKey(a, b);
    if (kind === "war") {
      v = Math.min(v, WAR_FLOOR);
      g.relWorld.warHeld[k] = true;
    }
    setRel(a, b, v);
    // a later positive nudge that clears the floor lifts the war-hold —
    // no separate "end war" API needed this wave (see file header).
    if (g.relWorld.warHeld[k] && getRel(a, b) > WAR_FLOOR) g.relWorld.warHeld[k] = false;
    checkThresholdFeed(a, b);
    return getRel(a, b);
  }

  // ============================================================
  //  DRIFT — daily, toward 0 by 1, unless war-held
  // ============================================================
  function driftAll() {
    ensureInit();
    const rel = g.relWorld.rel, held = g.relWorld.warHeld;
    for (const k in rel) {
      if (held[k]) continue;
      const v = rel[k];
      if (v > 0) rel[k] = Math.max(0, v - 1);
      else if (v < 0) rel[k] = Math.min(0, v + 1);
    }
  }

  // ============================================================
  //  (c) AID DIPLOMACY — monthly, capital-activity gap
  // ============================================================
  function capitalEconIdFor(countryId) {
    if (countryId === "republic") return (CBZ.econState && CBZ.econState.DEFAULT_ID) || "libertyville";
    const cd = (CBZ.COUNTRIES || []).find(function (c) { return c.id === countryId; });
    if (!cd) return null;
    const cap = (cd.settlements || []).find(function (s) { return s.capital; });
    return cap ? cap.id : null;
  }
  function capitalActivity(countryId) {
    const id = capitalEconIdFor(countryId);
    if (!id || !CBZ.econState) return 1.0;
    const st = CBZ.econState.get(id);
    return st ? st.activity : 1.0;
  }
  function aidDiplomacy() {
    const countries = CBZ.polity ? CBZ.polity.list("country") : [];
    for (let i = 0; i < countries.length; i++) {
      const needy = countries[i];
      if (capitalActivity(needy.id) >= AID_NEEDY_T) continue;
      for (let j = 0; j < countries.length; j++) {
        const donor = countries[j];
        if (donor.id === needy.id) continue;
        if (capitalActivity(donor.id) <= AID_DONOR_T) continue;
        event(needy.id, donor.id, "aid", AID_BUMP);
        if (CBZ.cityFeed) CBZ.cityFeed("" + nameOf(donor.id) + " sends aid to " + nameOf(needy.id), "#8fc1ff");
      }
    }
  }

  // ============================================================
  //  TARIFF/EMBARGO DRAG — monthly, rel<-50 with the republic
  // ============================================================
  function tariffDrag() {
    const countries = CBZ.polity ? CBZ.polity.list("country") : [];
    for (let i = 0; i < countries.length; i++) {
      const c = countries[i];
      if (c.id === "republic") continue;
      if (getRel(c.id, "republic") >= TARIFF_T) continue;
      const w = CBZ.cityWorldEnsure ? CBZ.cityWorldEnsure() : null;
      if (!w || !w.economy) continue;
      w.economy.confidence = Math.max(0, (w.economy.confidence == null ? 100 : w.economy.confidence) - TARIFF_CONFIDENCE_HIT);
      if (CBZ.cityFeed) CBZ.cityFeed("Embargo flavor: " + nameOf(c.id) + "-Republic relations drag confidence", "#ff9a5e");
      // deeper trade/tariff pricing (real import friction through sim/market.js)
      // is M-stage forex depth — comment only, no call site.
    }
  }

  // ============================================================
  //  APPROVAL TIE — war-level hostility rally then grind
  // ============================================================
  function checkWarApprovalTie() {
    ensureInit();
    const rel = g.relWorld.rel, active = g.relWorld.warTieActive;
    for (const k in rel) {
      const parts = splitKey(k), a = parts[0], b = parts[1];
      if (!(CBZ.polity && CBZ.polity.get && CBZ.polity.get(a) && CBZ.polity.get(b))) continue;
      const v = rel[k];
      if (v < WAR_TIE_T) {
        if (!active[k]) {
          active[k] = true;
          if (CBZ.approvalShock) { CBZ.approvalShock(a, RALLY_SHOCK); CBZ.approvalShock(b, RALLY_SHOCK); }
          if (CBZ.cityFeed) CBZ.cityFeed("" + nameOf(a) + " and " + nameOf(b) + " rally 'round the flag", "#ffb27a");
        } else if (CBZ.approvalShock) {
          CBZ.approvalShock(a, -GRIND_SHOCK); CBZ.approvalShock(b, -GRIND_SHOCK);   // war-weariness grind
        }
      } else {
        active[k] = false;   // hostility eased — grind stops, rally re-arms for a future relapse
      }
    }
  }

  // ============================================================
  //  (d) ELECTIONS/SUCCESSION CLEAN SLATE — office.holder churn per country
  // ============================================================
  function cleanSlate(countryId) {
    const countries = CBZ.polity ? CBZ.polity.list("country") : [];
    for (let i = 0; i < countries.length; i++) {
      const other = countries[i];
      if (other.id === countryId) continue;
      const cur = getRel(countryId, other.id);
      if (cur === 0) continue;
      setRel(countryId, other.id, cur * 0.8);   // 20% toward 0
    }
  }
  function checkOfficeChurn() {
    ensureInit();
    const countries = CBZ.polity ? CBZ.polity.list("country") : [];
    for (let i = 0; i < countries.length; i++) {
      const c = countries[i];
      const cur = (c.office && c.office.holder) || null;
      const prev = g.relWorld.lastHolder[c.id] != null ? g.relWorld.lastHolder[c.id] : undefined;
      if (prev !== undefined && prev !== cur) cleanSlate(c.id);
      g.relWorld.lastHolder[c.id] = cur;
    }
  }

  // ============================================================
  //  (b) ASSASSINATION → officials.js's onOfficialDeath subscriber
  // ============================================================
  if (CBZ.onOfficialDeath) {
    CBZ.onOfficialDeath(function (rec, sid, ped) {
      try {
        if (!rec || !CBZ.polity || !CBZ.polity.countryOf) return;
        const victim = CBZ.polity.countryOf(rec.id);
        if (!victim || victim.id === "republic") return;
        const soilRec = (ped && ped.pos && CBZ.polity.of) ? CBZ.polity.of(ped.pos.x, ped.pos.z) : null;
        const soil = soilRec ? CBZ.polity.countryOf(soilRec.id) : null;
        if (!soil || soil.id !== "republic") return;   // "if it happened on republic soil"
        event(victim.id, "republic", "insult", 15);
        if (CBZ.cityFeed) CBZ.cityFeed("" + nameOf(victim.id) + "-Republic relations sour after the killing", "#ff9a5e");
      } catch (e) {}
    });
  }

  // ============================================================
  //  WAR PRESSURE — pure function, exported for P8/X6b (unconsumed here)
  // ============================================================
  function warPressure(a, b) {
    return Math.max(0, (-getRel(a, b) - 40) / 60);
  }

  // ============================================================
  //  POLITICS PANEL DATA — CBZ.relations.summaryFor(countryId)
  // ============================================================
  function summaryFor(countryId) {
    const countries = CBZ.polity ? CBZ.polity.list("country") : [];
    let best = null, worst = null;
    for (let i = 0; i < countries.length; i++) {
      const c = countries[i];
      if (c.id === countryId) continue;
      const v = Math.round(getRel(countryId, c.id));
      if (best == null || v > best.rel) best = { id: c.id, name: c.name, rel: v };
      if (worst == null || v < worst.rel) worst = { id: c.id, name: c.name, rel: v };
    }
    return { best: best, worst: worst };
  }

  // ============================================================
  //  DAILY TICK — CBZ.onNewDay (polity.js's own worldDay subscriber list)
  // ============================================================
  if (CBZ.onNewDay) {
    CBZ.onNewDay(function (day) {
      ensureInit();
      driftAll();
      checkWarApprovalTie();
      checkOfficeChurn();
      if (day % MONTH_DAYS === 0) { aidDiplomacy(); tariffDrag(); }
    });
  }

  // ============================================================
  //  PERSISTENCE
  // ============================================================
  function serialize() {
    ensureInit();
    const M = g.relWorld;
    return {
      v: 1,
      rel: Object.assign({}, M.rel),
      warHeld: Object.assign({}, M.warHeld),
      warTieActive: Object.assign({}, M.warTieActive),
      lastHolder: Object.assign({}, M.lastHolder),
    };
  }
  function apply(obj) {
    reset();
    if (!obj || obj.v !== 1) return;
    const M = g.relWorld;
    if (obj.rel) for (const k in obj.rel) if (isFinite(obj.rel[k])) M.rel[k] = clampNum(-100, 100, +obj.rel[k]);
    if (obj.warHeld) for (const k in obj.warHeld) M.warHeld[k] = !!obj.warHeld[k];
    if (obj.warTieActive) for (const k in obj.warTieActive) M.warTieActive[k] = !!obj.warTieActive[k];
    if (obj.lastHolder) for (const id in obj.lastHolder) M.lastHolder[id] = obj.lastHolder[id];
  }

  CBZ.relations = {
    get: getRel,
    set: setRel,
    event: event,
    warPressure: warPressure,
    summaryFor: summaryFor,
    serialize: serialize,
    apply: apply,
    reset: reset,
    // harness-only hooks — not part of the public contract.
    _drift: driftAll,
    _aidDiplomacy: aidDiplomacy,
    _tariffDrag: tariffDrag,
    _checkWarApprovalTie: checkWarApprovalTie,
    _checkOfficeChurn: checkOfficeChurn,
    _relKey: relKey,
  };
  CBZ.relationsReset = reset;

  // ============================================================
  //  SINGLE-PLAYER PERSIST — polity.js/approval.js's own g.cityWorld
  //  pattern, verbatim: stamp before the existing commit/collect hooks run,
  //  hydrate back out whenever that ledger object's REFERENCE changes.
  //  Own idempotence flag (_relWrap).
  // ------------------------------------------------------------
  function stampRelations() {
    const led = g.cityWorld;
    if (led && typeof led === "object") led.rel = serialize();
  }
  let _ensureRelationsSaveWraps_done = false;
  function ensureRelationsSaveWraps() {
    // ONE-SHOT INSTALL (chain-growth fix): the old guard checked the
    // module flag on the CURRENT top-of-chain function, so once any
    // later module wrapped above us the flag vanished from the top and
    // we re-wrapped EVERY tick - ~20 such modules made the commit chain
    // grow unboundedly (stack overflow on save; found by the P5 full-
    // stack harness). A module-local boolean wraps exactly once, ever.
    if (_ensureRelationsSaveWraps_done) return;
    _ensureRelationsSaveWraps_done = true;
    const commit = CBZ.cityWorldCommit;
    if (typeof commit === "function" && !commit._relWrap) {
      const w = function () { stampRelations(); return commit.apply(this, arguments); };
      w._relWrap = true; CBZ.cityWorldCommit = w;
    }
    if (CBZ.cityWorldCollect && !CBZ.cityWorldCollect._relWrap) {
      const col = CBZ.cityWorldCollect;
      const wc = function () { stampRelations(); return col.apply(this, arguments); };
      wc._relWrap = true; CBZ.cityWorldCollect = wc;
    }
  }
  let _hydratedLedger = null;
  function hydrateFromLedger() {
    const led = g.cityWorld;
    if (!led || led === _hydratedLedger) return;
    _hydratedLedger = led;
    if (led.rel) apply(led.rel);
  }
  if (CBZ.onUpdate) {
    // next free slot after city/elections.js's own 46.11 install-tick —
    // same install-tick family as every other P/E/X-wave save-wrap.
    CBZ.onUpdate(46.15, function () {
      if (!g) return;
      ensureRelationsSaveWraps();
      hydrateFromLedger();
    });
  }
})();
