/* ============================================================
   sim/billionaires.js — Stage E, step E8: BILLIONAIRES AS PERSISTENT
   SHAREHOLDER NPCs.

   MASTER-PLAN VI.6 (verbatim, the piece this file lands): "Billionaires are
   shareholders, not cash piles. The transient billionaire archetype
   (peds.js:258-264) becomes a persistent ledger identity: netWorth = shares
   x price + properties + cash, marked to market with the same compositional
   pattern as the player's own net worth. They ARE the existing MAGNATE VIPs
   (vips.js:11-14 already gives them suited SMG security) wired to a
   companyId, with executive schedules... Killing or kidnapping one is an
   economic act — stock shock, succession..."

   THE 8 FOUNDERS — one per sim/corporations.js COMPANIES row (never the
   player's own IPO'd businesses — those already have a founder: the
   player). Each founder is a PERSISTENT LEDGER IDENTITY, not a live rig:
   minted the same way familytree.js/social.js mint any ledger-only kin (see
   mintIdentity() below) — a synthetic, NEVER-SPAWNED "ped" object stashed
   straight into schedule.js's offline ledger (CBZ.cityPedStash). Passing
   `_parked:true` is the trick: cityPedStash's position-anchor block is
   entirely skipped for a parked identity (schedule.js:250 `if
   (!ped._parked) {...}`), so a synthetic object with no `.pos`/`.group`
   stashes cleanly and comes back with a real `_sid`. `nameKnown:true`
   guarantees schedule.js's worth() gate passes regardless of cash (worth()
   OR's in `ped.nameKnown` — schedule.js:179).

   HOLDINGS: g.corpHoldings = { sid: { SYM: qty } } — the NPC-shareholder
   analogue of sim/stocks.js's g.cityPortfolio (which is player-only,
   unchanged). Each founder is minted with 55% of their company's
   sharesOutstanding; netWorthOf(sid) = Σ qty×livePrice + ledger cash,
   exactly the compositional pattern the plan asks for (stock value +
   cash; no "properties" term yet — no listing anywhere mints a sid-owned
   zillow record for a founder this wave, so that term is always 0 today,
   same as inheritance.js's own future-proofed, currently-no-op property
   loop).

   FOUNDER FAMILIES: at mint, each founder gets a spouse + 1-2 kids —
   ledger-only identities wired into the real family tree (marry/bearChild,
   familytree.js/W6) exactly like social.js's weaveFamilies gives a
   boss/tycoon head a household. This is what makes succession possible
   (heirOf) AND makes the dynasty visible for free in the FAMILY panel
   (familypanel.js derives everything from cityLedgerEntry + the tree's
   edges — nothing there needs editing; NOTABLE already maps archetype
   "billionaire" -> "Billionaire").

   ASSASSINATION + SUCCESSION: a SECOND cityKillPed wrap, installed at this
   file's own load time — AFTER inheritance.js's wrap (E8 loads after W9 in
   index.html), so `orig` here already includes inheritance.js's estate
   transfer. We capture the founder record (by ped._sid, looked up in OUR
   OWN founders array — untouched by schedule.js's dropSid, which only
   deletes ITS OWN ledger page) before calling orig(), then after a real
   death:
     - CBZ.stocks.shock(sym, -0.25 - rng()*0.3)              (always)
     - FT.markDeath(sid) — nobody else will ever call this for a founder's
       body: peds.js only auto-calls citySocialDeath (which calls
       markDeath) when ped.partner was set, and a VIP-drafted/fresh-spawned
       body never has that live-partner link (the spouse is a ledger-only
       identity, not a live ped) — so this file is the SOLE caller for a
       founder's own death stamp. Read BEFORE this: FT.heirOf(sid).
     - heir found  → shares (g.corpHoldings[sid]) move to the heir, who
       becomes company.founderSid (founder-of-record); this founder
       RECORD's own .sid is repointed at the heir so a THIRD death still
       has somewhere to go.
     - no heir     → company.founderSid = null (shares sit unreachable on
       the dead sid's page — "the estate"), a bigger shock (-0.4), and the
       founder record is dropped from the roster.
   Both branches post a killfeed/city.big line + a market-chaos/succession
   feed line (city/hud.js's CBZ.cityFeed, same as corporations.js's own
   bankrupt() line).

   MAGNATE SPAWN TIE-IN: vips.js's MAGNATE principal is drafted/spawned with
   NO reference to any company — it's flavor. This file peeks at the
   read-only CBZ.cityVips state (S.slots, exported by vips.js) every tick;
   the instant a magnate principal is freshly cast (state==="live", not yet
   `_bilChecked`), a 50% roll decides whether this body IS one of the 8
   founders. There is no "deal this identity onto a CONTROLLED ped" API in
   schedule.js — cityPedDeal explicitly refuses any `ped.controlled` body
   (schedule.js:313), and a VIP principal is always controlled — so we
   assign the identity fields (._sid/name/gender) onto the ped BY HAND, a
   documented simplification: this body's schedule.js ledger bookkeeping
   (the liveBy map) is never updated (that map is private to schedule.js
   and only cityPedDeal/vendorSweep ever write it), so the founder's ledger
   entry keeps quietly fastForward-ing offline in parallel with this very
   body walking the block. Cosmetic-only: the body's `.cash` is vips.js's
   own random magnate roll, never the founder's real ledger cash — but
   `.sid` is what matters, because THAT is what the assassination wrap
   above reads. Killing this body routes the kill through the founder's
   real identity exactly as if you'd caught them at the office.

   VISIBILITY: city/phone.js's MARKETS stock detail gains a "Founder: Name
   · $net worth" line (2-line edit, guarded/optional-chained). The FAMILY
   panel needs no edit — it already derives dynasties from
   cityFamilyTree.serialize() + cityLedgerEntry/cityLedgerLive names/archs
   (familypanel.js's own header says so), and this file's marry()/bearChild()
   calls are the only wiring it was missing.

   PERSISTENCE: v1 blob.bil rides the same two-rider pattern as every other
   sim/* file this wave (g.cityWorld.bil; own guard _bilSaveWrap — distinct
   from the kill-wrap's own _bilWrap flag). Serializes founders[] (sid,
   companyId, sym, spouseSid, kidSids) + corpHoldings; on apply(), also
   restores co.founderSid onto the (already-reset) corporations.js company
   objects, because corporations.js's OWN serialize() never carries that
   field (it's a placeholder this file owns — see corporations.js:172's
   comment "E8: billionaire-shareholder persistence wires an owner NPC
   here"). Fresh-run reset: a guarded 2-line hook beside corp/stocks' own
   reset() calls in city/peds.js's spawnCityPeds().
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  const FOUNDER_SHARE_FRAC = 0.55;
  const DEATH_SHOCK_MIN = 0.25, DEATH_SHOCK_SPAN = 0.30;   // heir case: -0.25..-0.55
  const NO_HEIR_SHOCK = 0.4;                                // no-heir case: flat, harsher

  // own seeded LCG (never Math.random — repo convention for world state).
  const INITIAL_SEED = 918273645 & 0x7fffffff;
  let _seed = INITIAL_SEED;
  function rng() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }

  // sid -> the VIP ped currently embodying that founder (runtime-only, never
  // persisted — a reload simply lets founders re-roll new bodies later; the
  // only thing that must survive a save is the founders/holdings DATA below).
  let _embodied = Object.create(null);

  // ---- state lives on g.billionaires + g.corpHoldings ----------------------
  function reset() {
    g.billionaires = { inited: false, founders: [] };
    g.corpHoldings = {};
    _embodied = Object.create(null);
  }
  function ensureState() {
    if (!g.billionaires) g.billionaires = { inited: false, founders: [] };
    if (!g.corpHoldings) g.corpHoldings = {};
    return g.billionaires;
  }

  // ---- identity minting: a synthetic, NEVER-SPAWNED "ped" stashed straight
  // into schedule.js's offline ledger — see header for why `_parked:true`
  // makes this safe with no .pos/.group at all. Returns the object (with a
  // real ._sid) or null if the ledger isn't available (e.g. multiplayer guest).
  function mintIdentity(fields) {
    if (!CBZ.cityPedStash) return null;
    const obj = Object.assign({ _parked: true, nameKnown: true, kind: "civilian" }, fields);
    CBZ.cityPedStash(obj);
    return obj._sid ? obj : null;
  }
  function surnameOf(name) {
    if (!name) return null;
    const parts = String(name).trim().split(/\s+/);
    return parts.length > 1 ? parts[parts.length - 1] : null;
  }
  function firstOf(name) {
    return name ? String(name).trim().split(/\s+/)[0] : null;
  }
  function mintName(gender) {
    if (CBZ.cityMintName) return CBZ.cityMintName(rng, gender);
    return gender === "f" ? "Vivian Ashworth" : "Weston Ashworth";   // no-name fallback (should never hit in practice)
  }
  function nameOf(sid) {
    if (!sid) return "Someone";
    const live = CBZ.cityLedgerLive && CBZ.cityLedgerLive(sid);
    if (live && live.name) return live.name;
    const e = CBZ.cityLedgerEntry && CBZ.cityLedgerEntry(sid);
    return (e && e.name) || "Someone";
  }

  // ---- HOLDINGS + NET WORTH --------------------------------------------
  function holdingsOf(sid) {
    ensureState();
    return (sid && g.corpHoldings[sid]) || null;
  }
  function setHolding(sid, sym, qty) {
    ensureState();
    if (!g.corpHoldings[sid]) g.corpHoldings[sid] = {};
    if (qty > 0) g.corpHoldings[sid][sym] = qty; else delete g.corpHoldings[sid][sym];
  }
  function addHolding(sid, sym, qty) {
    const h = holdingsOf(sid);
    setHolding(sid, sym, ((h && h[sym]) || 0) + qty);
  }
  function cashOf(sid) {
    if (!sid) return 0;
    const live = CBZ.cityLedgerLive && CBZ.cityLedgerLive(sid);
    if (live) return live.cash || 0;
    const e = CBZ.cityLedgerEntry && CBZ.cityLedgerEntry(sid);
    return (e && e.cash) || 0;
  }
  // netWorthOf(sid) -> Σ qty×livePrice + ledger cash (the plan's compositional
  // net-worth pattern — economy.js:876-877's own player readout, one term short:
  // no zillow "properties" term contributes yet, see header).
  function netWorthOf(sid) {
    if (!sid) return 0;
    let nw = cashOf(sid);
    const h = holdingsOf(sid);
    if (h) {
      for (const sym in h) {
        const qty = h[sym] || 0;
        if (!qty) continue;
        const st = CBZ.stocks && CBZ.stocks.get ? CBZ.stocks.get(sym) : null;
        if (st) nw += qty * st.price;
      }
    }
    return nw;
  }
  function founderRecBySid(sid) {
    if (!sid) return null;
    ensureState();
    const list = g.billionaires.founders;
    for (let i = 0; i < list.length; i++) if (list[i].sid === sid) return list[i];
    return null;
  }

  // ---- FOUNDER MINT (one-shot, lazy — the first tick a live city exists) ---
  function mintFounderFor(co) {
    if (!co || co.founderSid) return;   // already minted (or restored from a save's apply())
    const gender = rng() < 0.5 ? "f" : "m";
    const fname = mintName(gender);
    const founder = mintIdentity({
      name: fname, gender: gender, archetype: "billionaire", job: "founder of " + co.name,
      wealth: 0.99, aggr: 0.15, cash: 15000 + Math.round(rng() * 45000),
    });
    if (!founder) return;
    const sid = founder._sid;
    co.founderSid = sid;
    const shares = Math.round((co.sharesOutstanding || 0) * FOUNDER_SHARE_FRAC);
    setHolding(sid, co.tickerSym, shares);

    // FOUNDER FAMILY: spouse + 1-2 kids, ledger-only, wired into the real
    // family tree (same shape as social.js's weaveFamilies for a boss/tycoon
    // head — marry()/bearChild() accept raw sid strings per familytree.js's
    // sidOf(), which passes a string straight through untouched).
    const surname = surnameOf(fname);
    const spGender = gender === "f" ? "m" : "f";
    const spNameRaw = mintName(spGender);
    const spName = surname ? (firstOf(spNameRaw) + " " + surname) : spNameRaw;
    const spouse = mintIdentity({
      name: spName, gender: spGender, archetype: "socialite", job: "spouse of " + co.name,
      wealth: 0.9, aggr: 0.1, cash: 3000 + Math.round(rng() * 7000),
    });
    let spouseSid = null;
    if (spouse && CBZ.cityFamilyTree) {
      spouseSid = spouse._sid;
      CBZ.cityFamilyTree.marry(sid, spouseSid);
    }
    const kidSids = [];
    const nKids = 1 + (rng() < 0.5 ? 1 : 0);   // 1-2 kids
    for (let i = 0; i < nKids; i++) {
      const kg = rng() < 0.5 ? "f" : "m";
      const knRaw = mintName(kg);
      const kn = surname ? (firstOf(knRaw) + " " + surname) : knRaw;
      const kid = mintIdentity({
        name: kn, gender: kg, archetype: "heiress", job: "heir to " + co.name,
        wealth: 0.7, aggr: 0.1, cash: 500 + Math.round(rng() * 2000),
      });
      if (kid && CBZ.cityFamilyTree) {
        CBZ.cityFamilyTree.bearChild(sid, spouseSid, kid._sid);
        kidSids.push(kid._sid);
      }
    }
    ensureState().founders.push({ sid: sid, companyId: co.id, sym: co.tickerSym, spouseSid: spouseSid, kidSids: kidSids });
  }
  function mintAllFounders() {
    if (!CBZ.corps || !Array.isArray(CBZ.corps.COMPANIES) || typeof CBZ.corps.get !== "function") return false;
    for (const spec of CBZ.corps.COMPANIES) {
      const co = CBZ.corps.get(spec.id);
      try { mintFounderFor(co); } catch (e) {}
    }
    ensureState().inited = true;
    return true;
  }
  // order 46.0 — after this file's OWN hydrate tick (45.995, below) within the
  // same frame, so a loaded save's founders/holdings/founderSid are restored
  // BEFORE this checks `inited` (avoids double-minting on top of a hydrate).
  CBZ.onUpdate(46.0, function () {
    const gm = CBZ.game; if (!gm || gm.mode !== "city") return;
    ensureState();
    if (g.billionaires.inited) return;
    try { mintAllFounders(); } catch (e) {}
  });

  // ---- MAGNATE SPAWN TIE-IN: 50% of a freshly-cast magnate principal IS
  // one of the 8 founders (see header for why the identity is hand-assigned
  // rather than dealt through schedule.js's normal cityPedDeal). ------------
  function cleanupEmbodied() {
    for (const sid in _embodied) {
      const p = _embodied[sid];
      if (!p || p.dead || !p.controlled) delete _embodied[sid];
    }
  }
  function pickFreeFounder() {
    const list = (g.billionaires && g.billionaires.founders) || [];
    if (!list.length) return null;
    const start = (rng() * list.length) | 0;
    for (let i = 0; i < list.length; i++) {
      const rec = list[(start + i) % list.length];
      if (rec && !_embodied[rec.sid]) return rec;
    }
    return null;
  }
  // order 35.72 — right after vips.js's own 35.7 tick, so a slot's principal
  // for THIS frame has already been cast (form()) before we look at it.
  CBZ.onUpdate(35.72, function () {
    const gm = CBZ.game; if (!gm || gm.mode !== "city") return;
    const S = CBZ.cityVips; if (!S || !S.slots) return;
    cleanupEmbodied();
    for (let i = 0; i < S.slots.length; i++) {
      const slot = S.slots[i];
      if (slot.state !== "live" || !slot.def || slot.def.kind !== "magnate" || !slot.principal) continue;
      const p = slot.principal;
      if (p._bilChecked) continue;
      p._bilChecked = true;
      if (rng() >= 0.5) continue;                 // 50% chance this magnate IS a founder
      const rec = pickFreeFounder();
      if (!rec) continue;
      const e = CBZ.cityLedgerEntry && CBZ.cityLedgerEntry(rec.sid);
      if (!e) continue;                            // hydration edge case — no page to read identity off
      p._sid = rec.sid; p._bilFounder = rec.sid;
      if (e.name) p.name = e.name;
      if (e.sex != null) p.gender = e.sex ? "f" : "m";
      _embodied[rec.sid] = p;
      if (CBZ.city && CBZ.city.note) CBZ.city.note("💼 " + (e.name || "Someone") + " is working the block in person tonight.", 2.2);
    }
  });

  // ---- ASSASSINATION + SUCCESSION: a second cityKillPed wrap, installed
  // AFTER inheritance.js's (E8 loads after W9) — see header for the exact
  // capture-order argument. ------------------------------------------------
  function handleFounderDeath(rec, ped) {
    const FT = CBZ.cityFamilyTree;
    const co = CBZ.corps && CBZ.corps.get ? CBZ.corps.get(rec.companyId) : null;
    const sym = rec.sym;
    const deadSid = rec.sid;
    delete _embodied[deadSid];
    const victimName = ped.name || nameOf(deadSid);
    const coName = co ? co.name : sym;
    // nobody else ever calls this for a founder's own body (see header) —
    // read heirOf() BEFORE the call, matching inheritance.js's own discipline
    // (markDeath ends the live spouse edge; heirOf needs it live to resolve).
    const heir = FT ? FT.heirOf(deadSid) : null;
    if (FT) FT.markDeath(deadSid);
    if (CBZ.stocks && typeof CBZ.stocks.shock === "function") {
      CBZ.stocks.shock(sym, -(DEATH_SHOCK_MIN + rng() * DEATH_SHOCK_SPAN));
    }
    if (CBZ.city && CBZ.city.big) {
      CBZ.city.big("💀 " + victimName + ", founder of " + coName + ", assassinated — " + sym + " plunges");
    }
    if (heir) {
      // SUCCESSION: shares move to the heir, who becomes founder-of-record.
      const h = holdingsOf(deadSid);
      const qty = (h && h[sym]) || 0;
      if (qty > 0) { addHolding(heir, sym, qty); setHolding(deadSid, sym, 0); }
      if (co) co.founderSid = heir;
      rec.sid = heir;                       // this RECORD now tracks the heir going forward
      rec.spouseSid = FT ? FT.spouseOf(heir) : null;
      rec.kidSids = FT ? FT.kidsOf(heir) : [];
      if (CBZ.cityFeed) CBZ.cityFeed("👑 " + nameOf(heir) + " inherits control of " + coName, "#ffd76a");
    } else {
      // NO HEIR: shares dissolve into "the estate" (left unreachable on the
      // dead sid's page — nobody left to claim founder-of-record) + a bigger
      // shock than the succession case.
      if (co) co.founderSid = null;
      if (CBZ.stocks && typeof CBZ.stocks.shock === "function") CBZ.stocks.shock(sym, -NO_HEIR_SHOCK);
      if (CBZ.cityFeed) CBZ.cityFeed("⚠️ " + sym + " in chaos — founder dies without heir", "#ff6a5e");
      const list = ensureState().founders;
      const idx = list.indexOf(rec);
      if (idx >= 0) list.splice(idx, 1);
    }
  }
  if (typeof CBZ.cityKillPed === "function" && !CBZ.cityKillPed._bilWrap) {
    const orig = CBZ.cityKillPed;
    const wrapped = function (ped, imp, cause) {
      const sid = ped && ped._sid;
      const rec = sid ? founderRecBySid(sid) : null;
      const wasDead = !ped || ped.dead;
      const ret = orig.apply(this, arguments);
      if (rec && !wasDead && ped && ped.dead) {
        try { handleFounderDeath(rec, ped); } catch (e) {}
      }
      return ret;
    };
    wrapped._bilWrap = true;
    CBZ.cityKillPed = wrapped;
  }

  CBZ.billionaires = {
    netWorthOf: netWorthOf,
    holdingsOf: holdingsOf,
    founders: function () { ensureState(); return g.billionaires.founders.slice(); },
    founderOf: function (companyId) {
      ensureState();
      for (const r of g.billionaires.founders) if (r.companyId === companyId) return r;
      return null;
    },
    serialize: function () {
      ensureState();
      const founders = g.billionaires.founders.map(function (r) {
        return { sid: r.sid, companyId: r.companyId, sym: r.sym, spouseSid: r.spouseSid || null, kidSids: (r.kidSids || []).slice() };
      });
      const holdings = {};
      for (const sid in g.corpHoldings) holdings[sid] = Object.assign({}, g.corpHoldings[sid]);
      return { v: 1, inited: !!g.billionaires.inited, founders: founders, holdings: holdings };
    },
    apply: function (obj) {
      reset();
      if (!obj || obj.v !== 1) return;
      g.billionaires.inited = !!obj.inited;
      if (Array.isArray(obj.founders)) {
        for (const r of obj.founders) {
          if (!r || !r.sid || !r.companyId) continue;
          g.billionaires.founders.push({
            sid: r.sid, companyId: r.companyId, sym: r.sym || null,
            spouseSid: r.spouseSid || null, kidSids: Array.isArray(r.kidSids) ? r.kidSids.slice() : [],
          });
          // corporations.js's own serialize()/apply() never carries founderSid
          // (it's this file's field to own — see corporations.js:172) — restore
          // it here, onto the (already corp-reset) company object.
          const co = CBZ.corps && CBZ.corps.get ? CBZ.corps.get(r.companyId) : null;
          if (co) co.founderSid = r.sid;
        }
      }
      if (obj.holdings) {
        for (const sid in obj.holdings) {
          const row = obj.holdings[sid];
          if (row) g.corpHoldings[sid] = Object.assign({}, row);
        }
      }
    },
    reset: reset,
  };

  // ============================================================
  //  SINGLE-PLAYER PERSIST — sim/stocks.js's g.cityWorld pattern, verbatim:
  //  stamp the live state onto g.cityWorld right before the existing
  //  commit/collect save hooks run, hydrate back out whenever that ledger
  //  object's REFERENCE changes. Own idempotence flag (_bilSaveWrap, distinct
  //  from the kill-wrap's own _bilWrap above).
  // ------------------------------------------------------------
  function stampBil() {
    const led = g.cityWorld;
    if (led && typeof led === "object") led.bil = CBZ.billionaires.serialize();
  }
  function ensureBilSaveWraps() {
    const commit = CBZ.cityWorldCommit;
    if (typeof commit === "function" && !commit._bilSaveWrap) {
      const w = function () { stampBil(); return commit.apply(this, arguments); };
      w._bilSaveWrap = true; CBZ.cityWorldCommit = w;
    }
    if (CBZ.cityWorldCollect && !CBZ.cityWorldCollect._bilSaveWrap) {
      const col = CBZ.cityWorldCollect;
      const wc = function () { stampBil(); return col.apply(this, arguments); };
      wc._bilSaveWrap = true; CBZ.cityWorldCollect = wc;
    }
  }
  let _hydratedLedger = null;
  function hydrateFromLedger() {
    const led = g.cityWorld;
    if (!led || led === _hydratedLedger) return;
    _hydratedLedger = led;
    if (led.bil) CBZ.billionaires.apply(led.bil);
  }
  if (CBZ.onUpdate) {
    // next free slot after sim/stocks.js's 45.99 — same install-tick family,
    // and BEFORE this file's own 46.0 mint-check (see that tick's comment).
    CBZ.onUpdate(45.995, function () {
      if (!g) return;
      ensureBilSaveWraps();
      hydrateFromLedger();
    });
  }
})();
