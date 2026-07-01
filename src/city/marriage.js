/* ============================================================
   city/marriage.js — W13: MARRIAGE STRAIN & DIVORCE.

   THE OWNER'S HEADLINE: "your wife should be able to leave you when you are
   poor." Every other family-stack step (familytree.js, family.js, births.js)
   models marriage as something that just SITS there once you propose
   (social.js's cityPropose). This module is the pressure gauge: a single
   0-100 `g.cityMarriageStrain` number fed by four real inputs — poverty,
   neglect, danger, and betrayal — that, past 100, actually ENDS the player's
   marriage: she leaves, takes a cut of your cash, and goes back to being an
   ordinary civilian. Below 100 there's a reconciliation window (a warning
   note past 70; a real gesture — affection jumping since the last sample —
   buys real relief), so the system reads as a relationship, not a meter.

   WHY THIS IS ITS OWN FILE (not stuffed into social.js): social.js already
   owns the COUPLE MODEL (partner/together/REL_EVENTS/gossip) for every NPC
   in the city, including a working argument→breakup vignette. This module
   does NOT reinvent that — it (a) reads the player's own marriage state
   social.js already exposes (g.citySpouse/g.citySpouseSid/g.cityPartner,
   W7) and drives IT toward a divorce, and (b) for NPC couples, only nudges
   the EXISTING `together` number poverty erodes it, letting social.js's own
   argument vignette (tickEvents, ~social.js:1026) do the actual breaking up.
   One new idempotent wrap onto CBZ.cityFlirt is the only place this file
   reaches into social.js's internals (see BETRAYAL below).

   PLAYER STRAIN TICK (ordered 34.85 — right after births.js's 34.8, before
   squadai.js's 34.55... no: after social.js's 34.5/34.6 and gangops.js's
   34.7/34.72, sharing the "family stack" neighborhood):
     POVERTY  — (cash+bank) < POOR_LINE (200)  → strain += 0.8/min
                (cash+bank) > RICH_LINE (20000) → strain -= 0.4/min
     NEGLECT  — read the spouse's relPlayer.affection axis (NOT ped.affection,
                which is the raw "close enough to date" gate social.js's
                cityFlirt writes — relPlayer.affection is the multi-axis bond
                cityRelShift maintains, closer to "how she actually feels").
                affection > 60 → strain -= 0.3/min; < 25 → strain += 0.5/min.
                A real gesture (affection jumped >5 since last sample — a
                gift/date landed) also knocks off a flat 10.
     DANGER   — g.wanted >= 3 → strain += 0.6/min; spouse currently kidnapped
                (social.js's OWN companion-kidnap flow, ped.kidnapped — see
                social.js:1349-1375, not family.js's separate "mine"-family
                kidnap system, a different ped entirely) → += 2/min.
     BETRAYAL — an idempotent wrap on CBZ.cityFlirt (guard `_marWrap`):
                flirting with ANYONE who isn't your own spouse while married
                is cheating, so it lands a hard +15 the instant you try it —
                whether or not the flirt itself succeeds. No TOPIC entry in
                social.js's gossip table fits "the player got caught
                cheating" (datedHero is a celebratory new-couple line, wrong
                valence), so we deliberately do NOT seed gossip for it.
     DECAY    — when none of the above pushed strain up this tick, it cools
                by -0.2/min on its own (a quiet marriage heals slowly).

   THRESHOLD: strain >= 100 → sheLeaves() runs the whole divorce: ends the
   family-tree sp edge if one is actually on record, splits 30% of on-hand
   cash off with a big visible note, drops the grudge/kills the affection on
   her relPlayer record, and undoes everything cityFlirt set when she became
   your partner (companion/controlled/romance/together) so peds.js's normal
   brain drives her again. See sheLeaves() for what's explicitly deferred
   (home/property split, custody) and why.

   NPC-COUPLE STRAIN (cheap, aggregate, reuses social.js's OWN machinery):
   every tick we sample ~4 random live peds; if one has a partner and BOTH
   wallets are thin (ped.cash < 30), their `together` bond erodes by 0.05.
   We never break them up ourselves — social.js's existing argument vignette
   (tickEvents) already reads `together` to decide whether a street fight
   snaps into "OVER"; eroding the number it already checks is enough to turn
   a citywide depression into a visible divorce wave through code that
   already exists.

   PERSISTENCE: worldstate.js's cityWorldCommit()/cityWorldCollect() only
   copy an explicit whitelist of g.* fields (checked — g.cityMarriageStrain
   is NOT one of them), so this file rides the exact bank.js/familytree.js
   pattern: stamp {strain, warned, lastAffection} onto g.cityWorld.marriage
   right before the existing save hooks run (own guard flag `_marWrap` on
   the wrapped functions), and hydrate back out whenever g.cityWorld's own
   REFERENCE changes (fresh load / respawn / MP adopt).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  // self-defaulted tuning — never edit config.js; CBZ.CITY.marriage* lets a
  // later config pass override these without touching this file.
  const CFG = (CBZ.CITY && CBZ.CITY.marriage) || {};
  const POOR_LINE = typeof CFG.poorLine === "number" ? CFG.poorLine : 200;
  const RICH_LINE = typeof CFG.richLine === "number" ? CFG.richLine : 20000;

  // own seeded LCG (never Math.random in a sim decision — matches births.js/
  // family.js's per-module rng idiom).
  let _s = 0xc0ffee ^ 0x1357;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }

  const noSim = () => !!(CBZ.net && CBZ.net.noSim && CBZ.net.noSim());

  // ---- name lookup (live ped first, else the offline ledger page — the same
  // fallback order births.js/familypanel.js use) ----
  function nameOf(sid) {
    const live = CBZ.cityLedgerLive && CBZ.cityLedgerLive(sid);
    if (live && live.name) return live.name;
    const e = CBZ.cityLedgerEntry && CBZ.cityLedgerEntry(sid);
    return (e && e.name) || "She";
  }

  // ============================================================
  //  PLAYER MARRIAGE STRAIN
  // ============================================================
  let _lastAffection = null;   // last-sampled relPlayer.affection (gesture detector)
  let _warnedUnhappy = false;  // one warning note per crossing into the >70 zone

  function sheLeaves(spouseLive) {
    const spouseSid = g.citySpouseSid;
    const name = (spouseLive && spouseLive.name) || nameOf(spouseSid);
    const FT = CBZ.cityFamilyTree;

    // 1) FAMILY TREE — the player has no sid of their own (cityPropose's W7
    //    note: only the spouse's sid ever gets minted; there is no player-side
    //    marry() edge to look up by playerSid+spouseSid). Ask the tree who IT
    //    thinks this sid is currently married to instead; if that resolves
    //    (the spouse was independently paired via weaveFamilies/the couples
    //    system), end THAT edge as a divorce. Otherwise there is no edge to
    //    end — g.citySpouse/g.citySpouseSid are themselves the entire record
    //    of a player marriage, and clearing them below IS the divorce.
    if (FT && spouseSid) {
      const otherSid = FT.spouseOf(spouseSid);
      if (otherSid) FT.endMarriage(spouseSid, otherSid, "divorce");
    }

    // 2) ASSET SPLIT — she takes 30% of cash ON HAND (bank balance untouched;
    //    a clean, felt number rather than a full accounting split).
    const cut = Math.round((g.cash || 0) * 0.3);
    if (cut > 0 && CBZ.city && CBZ.city.addCash) CBZ.city.addCash(-cut);
    if (CBZ.city && CBZ.city.big) CBZ.city.big("💔 " + name + " left you — she took $" + cut.toLocaleString());

    // 3) HOME — if the player owns a place, the plan calls for her moving out
    //    (no property transfer this wave; a later refinement, per the build
    //    plan's own "moves household" phrase). Left as a comment: there is no
    //    ownership record to split here yet.
    // 4) KIDS — "custody by bond" per the plan; but births.js's bearChild()
    //    is never actually reachable for the player (eligibleCouples requires
    //    BOTH sides to be ledger sids sharing a housing.js unit seat, and the
    //    player has neither a sid nor a unit), so there are no player-tree
    //    kids to place yet. Left as a comment for whenever that's wired.

    // 5) she becomes a normal citizen again — undo exactly what cityFlirt set
    //    when she became your partner (companion/controlled/romance/together),
    //    grudge the breakup, and zero the affection on both the raw ped field
    //    and the relPlayer axis.
    if (spouseLive && !spouseLive.dead) {
      const r = CBZ.cityRel ? CBZ.cityRel(spouseLive) : spouseLive.relPlayer;
      if (r) { r.grudge = Math.min(100, (r.grudge || 0) + 30); r.affection = 0; }
      spouseLive.affection = 0;
      spouseLive.companion = false; spouseLive.controlled = false; spouseLive.romance = false;
      spouseLive.together = 0; spouseLive.partner = null; spouseLive.engaged = false;
      // NOTE: if she happened to be mid-kidnap (social.js:1349-1375) at the
      // exact moment strain crossed 100, clear that flag too so peds.js's
      // ordinary brain actually takes over rather than leaving her parked at
      // a gang building; the pink rescue BEACON mesh itself is a module-
      // private var inside social.js (only clearBeacon() disposes it) that
      // this file has no handle to — a rare, cosmetic leak, not a gameplay one.
      spouseLive.kidnapped = false;
    }

    g.cityPartner = null;
    g.citySpouse = false;
    g.citySpouseSid = null;
    g.cityMarriageStrain = 0;
    _lastAffection = null;
    _warnedUnhappy = false;
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }

  function tickPlayerStrain(dt) {
    if (!g.citySpouse) {
      // not married (or just divorced this frame) — nothing accrues.
      if (g.cityMarriageStrain) g.cityMarriageStrain = 0;
      return;
    }
    const spouse = g.cityPartner; // may be null if she despawned; ledger sid still holds the record
    if (!spouse && !g.citySpouseSid) return; // defensive: citySpouse true with nothing to reference

    let s = g.cityMarriageStrain || 0;
    const perMin = dt / 60;
    let rose = false;

    // POVERTY
    const wallet = (g.cash || 0) + (g.cityBank || 0);
    if (wallet < POOR_LINE) { s += 0.8 * perMin; rose = true; }
    else if (wallet > RICH_LINE) { s -= 0.4 * perMin; }

    // NEGLECT (only measurable while she's a live, feeling ped)
    if (spouse && !spouse.dead) {
      const r = spouse.relPlayer;
      const aff = r ? (r.affection || 0) : 0;
      if (aff > 60) s -= 0.3 * perMin;
      else if (aff < 25) { s += 0.5 * perMin; rose = true; }
      // "a real gesture landed" — affection jumped noticeably since the last
      // sample (a date/gift via cityFlirt/cityRelShift), buys real relief.
      if (_lastAffection != null && aff - _lastAffection > 5) s -= 10;
      _lastAffection = aff;
    }

    // DANGER
    if ((g.wanted | 0) >= 3) { s += 0.6 * perMin; rose = true; }
    if (spouse && spouse.kidnapped) { s += 2 * perMin; rose = true; }

    // DECAY — only when nothing above pushed it up this tick (a quiet
    // marriage heals slowly on its own).
    if (!rose) s -= 0.2 * perMin;

    g.cityMarriageStrain = Math.max(0, Math.min(100, s));

    if (g.cityMarriageStrain >= 100) { sheLeaves(spouse); return; }

    // RECONCILIATION WARNING — once per crossing into the unhappy zone, not
    // every frame; resets so a later re-crossing warns again.
    if (g.cityMarriageStrain > 70) {
      if (!_warnedUnhappy) {
        _warnedUnhappy = true;
        if (CBZ.city && CBZ.city.note) {
          CBZ.city.note("💍 " + ((spouse && spouse.name) || nameOf(g.citySpouseSid)) + " is unhappy — come home, bring a gift", 3.2);
        }
      }
    } else {
      _warnedUnhappy = false;
    }
  }

  // ============================================================
  //  BETRAYAL — idempotent wrap on CBZ.cityFlirt. social.js loads (city3)
  //  long before this file (the W-wave block, near the end of index.html),
  //  so CBZ.cityFlirt already exists by the time this IIFE runs — no need to
  //  defer the wrap into an onUpdate tick the way familytree.js must for
  //  schedule.js's cityPedStash.
  // ============================================================
  function wrapCityFlirt() {
    const orig = CBZ.cityFlirt;
    if (typeof orig !== "function" || orig._marWrap) return;
    const wrapped = function (ped) {
      // the ATTEMPT is the betrayal — checked BEFORE delegating so a jealous-
      // partner bounce or a flat "not interested" inside cityFlirt doesn't
      // erase the fact that you tried, while your own spouse (cityFlirt's own
      // early-out for ped === g.cityPartner) never counts against you.
      if (g.citySpouse && g.cityPartner && ped && !ped.dead && ped !== g.cityPartner) {
        g.cityMarriageStrain = Math.min(100, (g.cityMarriageStrain || 0) + 15);
      }
      return orig.apply(this, arguments);
    };
    wrapped._marWrap = true;
    CBZ.cityFlirt = wrapped;
  }
  wrapCityFlirt();

  // ============================================================
  //  NPC-COUPLE STRAIN — cheap, aggregate, reuses social.js's OWN `together`/
  //  argument-vignette machinery (see header doc). No new breakup path here.
  // ============================================================
  function tickNpcErosion() {
    const peds = CBZ.cityPeds;
    if (!peds || !peds.length) return;
    const n = Math.min(4, peds.length);
    for (let i = 0; i < n; i++) {
      const a = peds[(rng() * peds.length) | 0];
      if (!a || a.dead || !a.partner || a.partner.dead) continue;
      const b = a.partner;
      if ((a.cash || 0) < 30 && (b.cash || 0) < 30) {
        // poverty erodes the SAME `together` number social.js's tickEvents
        // argument vignette already reads (roll < 0.6 - together*0.5 snaps a
        // spat into "OVER") — a depression turns into a real divorce wave
        // through code that already exists, for free.
        a.together = Math.max(0, (a.together || 0.5) - 0.05);
        b.together = a.together;
      }
    }
  }

  // ============================================================
  //  SINGLE-PLAYER PERSIST — the bank.js/familytree.js pattern, verbatim:
  //  stamp strain onto g.cityWorld right before the existing commit/collect
  //  hooks run (own guard flag `_marWrap` so this only wraps each fn once),
  //  and hydrate back out whenever g.cityWorld's own REFERENCE changes.
  // ------------------------------------------------------------
  function stampMarriage() {
    const led = g.cityWorld;
    if (led && typeof led === "object") {
      led.marriage = { strain: g.cityMarriageStrain || 0, warned: !!_warnedUnhappy, lastAffection: _lastAffection };
    }
  }
  function ensureMarriageSaveWraps() {
    const commit = CBZ.cityWorldCommit;
    if (typeof commit === "function" && !commit._marWrap) {
      const w = function () { stampMarriage(); return commit.apply(this, arguments); };
      w._marWrap = true; CBZ.cityWorldCommit = w;
      // cityWorldCollect (the MP/persistence collector) shares the same inner
      // commit in worldstate.js — re-point it too so the server-bound blob
      // carries the strain number as well (mirrors familytree.js exactly).
      if (CBZ.cityWorldCollect && !CBZ.cityWorldCollect._marWrap) {
        const col = CBZ.cityWorldCollect;
        const wc = function () { stampMarriage(); return col.apply(this, arguments); };
        wc._marWrap = true; CBZ.cityWorldCollect = wc;
      }
    }
  }
  let _hydratedLedger = null;
  function hydrateFromLedger() {
    const led = g.cityWorld;
    if (!led || led === _hydratedLedger) return;
    _hydratedLedger = led;
    if (led.marriage) {
      g.cityMarriageStrain = led.marriage.strain || 0;
      _warnedUnhappy = !!led.marriage.warned;
      _lastAffection = led.marriage.lastAffection != null ? led.marriage.lastAffection : null;
    }
  }

  // ---- persistence plumbing: unconditional, regardless of play-state/mode
  // (matches familytree.js's 45.92 exactly) ----
  if (CBZ.onUpdate) {
    CBZ.onUpdate(45.93, function () {
      if (!g) return;
      ensureMarriageSaveWraps();
      hydrateFromLedger();
    });
  }

  // ---- the actual strain sim: ordered 34.85, next to births.js's 34.8 ----
  if (CBZ.onUpdate) {
    CBZ.onUpdate(34.85, function (dt) {
      if (!g || g.mode !== "city") return;
      if (noSim()) return; // host simulates; guests puppet, never drive divorce locally
      try { tickPlayerStrain(dt); } catch (err) {}
      try { tickNpcErosion(); } catch (err) {}
    });
  }

  // ---- reset (mode.js guard-call convention, mirrors cityBirthsReset) ----
  function reset() {
    g.cityMarriageStrain = 0;
    _lastAffection = null;
    _warnedUnhappy = false;
  }
  CBZ.cityMarriageReset = reset;
})();
