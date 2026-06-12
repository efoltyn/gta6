/* ============================================================
   city/outfits.js — THE WARDROBE: clothing stops being random color
   noise and becomes IDENTITY, STATUS and DISGUISE.

   WHY (make money + show off):
     • STATUS — the tuxedo is the apex drip purchase: thousands of
       dollars worn on your back, and the Velvet's rope opens for the
       cloth alone (drip clears CLUB_DRIP by itself).
     • IDENTITY — every named outfit says WHO wears it (vendor apron,
       dock hi-vis, gang colors, the badge), so the same casting truth
       can dress the whole street: CBZ.cityOutfitFor(spec) is the
       casting hook peds.js adopts with a one-liner.
     • DISGUISE — clothes are the AFFILIATION axis (the [T] mask is the
       ID axis; they compose): a police uniform makes beat cops read
       you as one of theirs at low heat (until one gets close enough to
       clock your face); a crew's colors make their corners read you as
       kin — and their rivals read you as THEM.

   THE LOOK API: a rig built by entities/character.js exposes
   skinSlots (lists of meshes per cloth region). We recolor with the
   clone-on-write paint pattern from entities/player.js — cmat-cached
   materials are cloned before the first tint so a recolor NEVER bleeds
   onto every NPC sharing that cached color.

   STATE (all on CBZ.game, owned here):
     g.cityWornOutfit  — the worn outfit RECORD {id,name,colors,drip,cop,gang}
     g.cityOutfitId    — its id (cheap read for other systems)
     g.cityOutfitsOwned— {id:true} fits you own (re-wear free at the boutique)
     g.cityOutfitBlownT— ms timestamp until which the cop uniform is BLOWN
     g.cityOutfitChanging — seconds left in the corpse-swap change (exposed beat)

   NOTE: g.cityOutfit (no suffix) is economy.js's SLOT→item map for
   wearable PIECES (chains/watches) — a different, composable axis.
   This module's whole-body color fit adds its drip into the same
   CBZ.cityPlayerDrip read via a lazy idempotent wrap (bling.js pattern).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  // ============================================================
  //  THE CATALOG — every named fit: a color set + drip + WHO wears it.
  //  price = sold at the boutique fitting room (a status purchase);
  //  cop/gang flags = what the street READS off the cloth.
  // ============================================================
  const CAT = {
    // ---- street basics (the floor — what a nobody wears) ----
    street:    { id: "street",    name: "Street Basics",    tier: "street", who: "everybody",        price: 60,   drip: 0,
                 colors: { legs: 0x39414f, torso: 0x8a939c, collar: 0x6d7682, arms: 0x8a939c, shoes: 0x2b2b2b } },
    hoodie:    { id: "hoodie",    name: "Goon Hoodie",      tier: "street", who: "corner kids",      price: 120,  drip: 2,
                 colors: { legs: 0x23262e, torso: 0x3a3f4a, collar: 0x2a2e36, arms: 0x3a3f4a, shoes: 0x191b20 } },
    tracksuit: { id: "tracksuit", name: "Corner Tracksuit", tier: "street", who: "hustlers",         price: 180,  drip: 3,
                 colors: { legs: 0x20242c, torso: 0x2bb673, collar: 0xeef3f7, arms: 0x2bb673, shoes: 0xf2f2f2 } },
    // ---- work uniforms (a JOB on your back — casting wears these) ----
    vendor:    { id: "vendor",    name: "Vendor Apron",     tier: "work",   who: "counter clerks",   price: 0,    drip: 0,
                 colors: { legs: 0x2e3138, torso: 0xc8553a, collar: 0xf0ead8, arms: 0xf0ead8, shoes: 0x2b2b2b } },
    hivis:     { id: "hivis",     name: "Dock Hi-Vis",      tier: "work",   who: "dock crews",       price: 0,    drip: 0,
                 colors: { legs: 0x2f4f8a, torso: 0xffb43a, collar: 0xfff06b, arms: 0xffb43a, shoes: 0x4a3a26 } },
    // ---- the LAW (never sold — taken off a body; the street reads the badge) ----
    police:    { id: "police",    name: "Police Uniform",   tier: "law",    who: "beat cops",        price: 0,    drip: 1, cop: true,
                 colors: { legs: 0x1b2a44, torso: 0x24407a, collar: 0x16264a, arms: 0x24407a, shoes: 0x101216, belt: 0x0d111c } },
    swat:      { id: "swat",      name: "SWAT Fatigues",    tier: "law",    who: "heavy units",      price: 0,    drip: 1, cop: true,
                 colors: { legs: 0x23262c, torso: 0x2b2f36, collar: 0x14161a, arms: 0x2b2f36, shoes: 0x101216, belt: 0x0d111c } },
    // ---- money fits (boutique racks → the apex tuxedo) ----
    leather:   { id: "leather",   name: "Leather Jacket",   tier: "fit",    who: "the night crowd",  price: 520,  drip: 6,
                 colors: { legs: 0x23262e, torso: 0x241c18, collar: 0x100c0a, arms: 0x241c18, shoes: 0x16110d } },
    tactical:  { id: "tactical",  name: "All Black Tactical", tier: "fit",  who: "professionals",    price: 700,  drip: 7,
                 colors: { legs: 0x121418, torso: 0x121418, collar: 0x0b0c0f, arms: 0x121418, shoes: 0x0b0c0f } },
    // formal: "suit"/"tux" — bling.js attaches the FORMAL KIT for the read:
    // suit = a modest white shirt-front sliver on a navy/charcoal body;
    // tux = the full black-tie set (white shirt-front panel + bow-tie +
    // pocket square). colors.gloss puts a patent-leather sheen on the shoes.
    suit:      { id: "suit",      name: "Two-Piece Suit",   tier: "money",  who: "made men",         price: 1200, drip: 9, formal: "suit",
                 colors: { legs: 0x14161c, torso: 0x1c2030, collar: 0x2a3047, arms: 0x1c2030, shoes: 0x0c0d10 } },
    designer:  { id: "designer",  name: "Designer Drip",    tier: "money",  who: "ballers",          price: 1600, drip: 12,
                 colors: { legs: 0xe9e4da, torso: 0x7a3df0, collar: 0xffd451, arms: 0x7a3df0, shoes: 0xffffff } },
    // THE APEX: priced like a car, and the rope opens for the cloth alone
    // (drip 28 + BASE_DRIP 4 = 32 ≥ CLUB_DRIP 30 — the tuxedo IS entry).
    // True-black jacket, CHARCOAL-SATIN collar (lapel read, not a priest's
    // band), gloss shoes; the white lives in the SHIRT-FRONT panel + square
    // (formal kit meshes), never the collar — that was the priest look.
    tuxedo:    { id: "tuxedo",    name: "Midnight Tuxedo",  tier: "apex",   who: "old money",        price: 7500, drip: 28, formal: "tux",
                 colors: { legs: 0x0a0b0e, torso: 0x0a0b0e, collar: 0x24262e, arms: 0x0a0b0e, shoes: 0x08090c, gloss: true } },
  };

  // per-gang colors, generated off the live config so every crew's flag exists
  // exactly once (id: "gang:<gangId>"). Built lazily — config may load later.
  let _gangBuilt = false;
  function buildGangOutfits() {
    if (_gangBuilt) return;
    const defs = (CBZ.CITY && CBZ.CITY.gangs) || [];
    if (!defs.length) return;
    for (const d of defs) {
      const id = "gang:" + d.id;
      if (CAT[id]) continue;
      CAT[id] = {
        id, name: (d.name || d.id) + " Colors", tier: "gang", who: d.name || d.id,
        price: 0, drip: 2, gang: d.id,
        colors: { legs: 0x23262c, torso: d.color != null ? d.color : 0xb079ea, collar: d.accent != null ? d.accent : 0x141820, arms: d.color != null ? d.color : 0xb079ea, shoes: 0x191b20 },
      };
    }
    _gangBuilt = true;
  }

  // ---- worn state ------------------------------------------------------------
  function ownedMap() { if (!g.cityOutfitsOwned) g.cityOutfitsOwned = { street: true }; return g.cityOutfitsOwned; }
  function worn() {
    if (!g.cityWornOutfit) {
      g.cityWornOutfit = CAT.street; g.cityOutfitId = "street"; ownedMap().street = true;
    }
    return g.cityWornOutfit;
  }
  function wornDrip() { const w = g.cityWornOutfit; return (w && w.drip) || 0; }

  // ============================================================
  //  THE LOOK API — recolor a built rig (player or NPC) in place.
  //  Clone-on-write: cmat materials are SHARED caches; clone before the
  //  first tint so recoloring one body never repaints the whole street.
  // ============================================================
  function paint(list, color, visible) {
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (!m) continue;
      if (color != null && m.material && m.material.color && m.material.color.setHex) {
        if (m.material._shared) m.material = m.material.clone();
        m.material.color.setHex(color);
      }
      if (visible != null) m.visible = visible;
    }
  }
  // GLOSS (the tux's patent-leather shoes): a faint cool sheen via the Lambert
  // emissive. Clone-on-write like paint(), and always RESET when the fit has no
  // gloss — a cloned material persists across re-wears, so a tux→hoodie change
  // must walk the shine back off.
  function sheen(list, on) {
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (!m || !m.material || !m.material.emissive || !m.material.emissive.setHex) continue;
      if (m.material._shared) {
        if (!on) continue;                     // shared cache mats are already matte
        m.material = m.material.clone();
      }
      m.material.emissive.setHex(on ? 0x3a3f4c : 0x000000);
      m.material.emissiveIntensity = on ? 0.4 : 1;
    }
  }
  // recolor any character rig's CLOTH to an outfit's colors (skin/face untouched).
  // SAME part mapping as sampleRigColors below — paint(legs/torso/collar/arms/
  // shoes) ↔ sample(legs/torso/collar/arms/shoes) — so a corpse swap is exact:
  // what you sample off them is precisely what painting puts on you.
  function recolorRig(ch, c) {
    if (!ch || !ch.skinSlots || !c) return false;
    const s = ch.skinSlots;
    paint(s.legs, c.legs);
    paint(s.torso, c.torso);
    paint(s.collar, c.collar != null ? c.collar : c.torso);
    paint(s.arms, c.arms != null ? c.arms : c.torso);
    paint(s.shoes, c.shoes != null ? c.shoes : 0x2b2b2b);
    sheen(s.shoes, !!c.gloss);
    return true;
  }
  CBZ.cityRecolorRig = recolorRig;

  // ---- VISUAL TRUTH: sample what a body is ACTUALLY rendering -------------
  // Peds are painted at spawn from district wardrobes / tourist brights /
  // vagrant rags, and repainted by crowd promotion + vips drafting — so a
  // derived catalog record often looks NOTHING like the body. Read the live
  // color off whatever material each part currently has (shared or cloned —
  // getHex is read-only, we NEVER mutate here).
  function readColor(list) {
    if (!list) return null;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (m && m.material && m.material.color && m.material.color.getHex) return m.material.color.getHex();
    }
    return null;
  }
  function sampleRigColors(ch) {
    if (!ch || !ch.skinSlots) return null;
    const s = ch.skinSlots;
    const torso = readColor(s.torso);
    if (torso == null) return null;            // harness stub rigs — no sample
    const legs = readColor(s.legs), collar = readColor(s.collar);
    const arms = readColor(s.arms), shoes = readColor(s.shoes);
    return {
      legs: legs != null ? legs : torso,
      torso,
      collar: collar != null ? collar : torso,
      arms: arms != null ? arms : torso,
      shoes: shoes != null ? shoes : 0x2b2b2b,
    };
  }

  // dress the PLAYER rig in the worn outfit (extends recolorRig with the
  // player-only kit: jail stripes hidden, the cop cap/badge ride the uniform —
  // mirrors entities/player.js applyPlayerRole so the two never fight: that
  // one owns jail roles, this one owns the city look, re-applied on re-entry).
  let _appliedId = null;
  function applyPlayer() {
    const ch = CBZ.playerChar, w = worn();
    if (!ch || !ch.skinSlots || !recolorRig(ch, w.colors)) return;
    const s = ch.skinSlots;
    paint(s.stripes, null, false);                                   // no city fit has jail stripes
    paint(s.belt, w.colors.belt != null ? w.colors.belt : 0x17191f, true);
    paint(s.badge, null, !!w.cop);                                   // the badge rides the uniform
    paint(s.cap, null, !!w.cop);
    paint(s.hair, null, !w.cop);
    _appliedId = w.id;
    if (CBZ.cityBlingPlayerDirty) CBZ.cityBlingPlayerDirty();        // chains re-seat over the new fit
  }

  // ---- wear: set the record, repaint, surface the status change --------------
  function wearRecord(rec, opts) {
    if (!rec || !rec.colors) return false;
    opts = opts || {};
    const before = CBZ.cityPlayerDrip ? (CBZ.cityPlayerDrip() | 0) : 0;
    g.cityWornOutfit = rec;
    g.cityOutfitId = rec.id;
    applyPlayer();
    const after = CBZ.cityPlayerDrip ? (CBZ.cityPlayerDrip() | 0) : 0;
    // respect lands ONCE per fit you first put on (re-wears aren't a flex)
    g.cityOutfitRespected = g.cityOutfitRespected || {};
    if (!g.cityOutfitRespected[rec.id] && rec.drip > 0 && CBZ.city && CBZ.city.addRespect) {
      g.cityOutfitRespected[rec.id] = true;
      CBZ.city.addRespect(Math.max(1, Math.round(rec.drip / 2)));
    }
    if (!opts.silent && CBZ.city) {
      const CLUB = (CBZ.CITY && CBZ.CITY.CLUB_DRIP) || 30, VIP = (CBZ.CITY && CBZ.CITY.VIP_DRIP) || 70;
      if (rec.cop) CBZ.city.note("👮 The uniform's on — at a distance, the city reads a cop.", 2.6);
      else if (rec.gang) CBZ.city.note("🩸 " + rec.name + " on your back — their corners read kin, their rivals read TARGET.", 3);
      else if (before < CLUB && after >= CLUB && CBZ.city.big) CBZ.city.big("🥂 " + rec.name + " — cloth like this opens velvet ropes.");
      else if (before < VIP && after >= VIP && CBZ.city.big) CBZ.city.big("✦ " + rec.name + " — dressed like money; the elite lounge waves you up.");
      else CBZ.city.note("🧥 Now wearing " + rec.name + ".", 1.8);
    }
    if (CBZ.cityLook) { CBZ.cityLook().outfit = rec.name; }          // legacy style read stays true
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  }

  // ---- boutique purchase: pay once, own it, wear it (re-wear free) -----------
  function buyOutfit(id) {
    buildGangOutfits();
    const rec = CAT[id];
    if (!rec || !rec.price) return false;
    if (g.cityOutfitId === id) { CBZ.city && CBZ.city.note("You're already rocking the " + rec.name + ".", 1.4); return false; }
    const owned = ownedMap();
    if (!owned[id]) {
      if (!CBZ.city || !CBZ.city.spend || !CBZ.city.spend(rec.price)) {
        CBZ.city && CBZ.city.note("The " + rec.name + " runs $" + rec.price + ".", 1.8);
        if (CBZ.sfx) CBZ.sfx("glass");
        return false;
      }
      owned[id] = true;
      if (CBZ.sfx) CBZ.sfx("coin");
    }
    return wearRecord(rec);
  }

  // ============================================================
  //  PERCEPTION READS — what the street makes of your cloth.
  //  (police.js / gangs.js / wanted.js call these as tiny guarded reads.)
  // ============================================================
  function isCopFit() { const w = g.cityWornOutfit; return !!(w && w.cop); }
  // does the uniform currently BUY trust? Only at minor heat (0-1★ — a manhunt
  // outranks a costume) and only until an officer has clocked your face.
  function copTrust() {
    if (!isCopFit()) return false;
    if ((g.wanted | 0) >= 2) return false;
    if (g.cityOutfitBlownT && CBZ.now < g.cityOutfitBlownT) return false;
    return true;
  }
  // an officer got close enough to see the face under the cap — the uniform
  // stops working for a while (they radio the description around).
  function blowCover(byCop) {
    if (!isCopFit()) return;
    const fresh = !(g.cityOutfitBlownT && CBZ.now < g.cityOutfitBlownT);
    g.cityOutfitBlownT = CBZ.now + 60000;
    if (fresh && CBZ.city) CBZ.city.note("“Wait — you're no cop!” " + ((byCop && byCop.name) || "An officer") + " clocks your face.", 2.6);
  }
  // the crew whose colors you're flying (gang id), or null
  function gangFit() { const w = g.cityWornOutfit; return (w && w.gang) || null; }
  // crimes committed IN UNIFORM burn hotter (impersonating an officer makes
  // every charge worse) — wanted.js multiplies its heat charge by this.
  function heatMult() { return isCopFit() ? 1.5 : 1; }

  CBZ.cityOutfitIsCop = isCopFit;
  CBZ.cityOutfitCopTrust = copTrust;
  CBZ.cityOutfitBlow = blowCover;
  CBZ.cityOutfitGangId = gangFit;
  CBZ.cityOutfitHeatMult = heatMult;
  CBZ.cityOutfitDrip = wornDrip;
  CBZ.cityOutfitGet = function () { return worn(); };
  CBZ.cityOutfitCatalog = function () { buildGangOutfits(); return CAT; };
  CBZ.cityWearOutfit = function (id, opts) { buildGangOutfits(); return CAT[id] ? wearRecord(CAT[id], opts) : false; };
  CBZ.cityBuyOutfit = buyOutfit;

  // ============================================================
  //  CASTING HOOK — what should THIS person be wearing? peds.js (and any
  //  spawner) can adopt the canonical wardrobe with one line:
  //    const fit = CBZ.cityOutfitFor(opts);            // in makePed
  //    if (fit && opts.outfit == null) opts.outfit = fit.colors.torso;
  //  (or pass fit.colors straight into makeCharacter for the full set).
  // ============================================================
  CBZ.cityOutfitFor = function (spec) {
    buildGangOutfits();
    spec = spec || {};
    if (spec.kind === "cop" || spec.cop) return spec.swat ? CAT.swat : CAT.police;
    if (spec.gang && CAT["gang:" + spec.gang]) return CAT["gang:" + spec.gang];
    if (spec.vendor || spec.job === "vendor" || /clerk|cashier|vendor/i.test(spec.job || "")) return CAT.vendor;
    if (/dock|construction|builder|laborer|worker/i.test(spec.job || "")) return CAT.hivis;
    const a = spec.archetype || "";
    if (a === "tycoon" || a === "billionaire") return CAT.tuxedo;    // the walking jackpot WEARS it
    if (a === "socialite" || a === "boss" || a === "mobster" || a === "made") return CAT.suit;
    if (a === "dealer" || a === "hustler") return CAT.tracksuit;
    return null;                                                     // ordinary folk keep street variety
  };

  // WHO is this body, wardrobe-wise? The named-identity ladder (kept for the
  // PERCEPTION flags: cop/gang/drip/formal have mechanical meaning). A corpse
  // that's been through a swap wears whatever was left on it — that stamped
  // record (p._wornOutfit, set in finishSwap) outranks identity.
  function baseRecordOf(p) {
    if (!p) return null;
    if (p._wornOutfit) return p._wornOutfit;
    if (p.kind === "cop") return p.swat ? CAT.swat : CAT.police;
    if (p.gang && CAT["gang:" + p.gang]) return CAT["gang:" + p.gang];
    if (p.vendor) return CAT.vendor;
    const a = p.archetype || "";
    if (a === "tycoon" || a === "billionaire") return CAT.tuxedo;
    if (a === "socialite" || a === "boss" || a === "mobster" || a === "made") return CAT.suit;
    return null;
  }

  // what is THIS body wearing? (corpse-swap + interact's "Take their X").
  // Identity decides the RECORD (name + cop/gang/drip/formal flags), but the
  // COLOR PAYLOAD is SAMPLED off the live rig — visual truth always wins, so
  // the fit you take is exactly the fit you saw (district wardrobe, tourist
  // brights, a vips repaint and all). Catalog records are never mutated: a
  // sampled result is a fresh copy.
  CBZ.cityOutfitOf = function (p) {
    buildGangOutfits();
    if (!p) return null;
    const rec = baseRecordOf(p);
    const sampled = sampleRigColors(p.char);
    if (rec) {
      if (!sampled) return rec;                // no rig to read — catalog truth
      const copy = Object.assign({}, rec);     // flags (cop/gang/drip/formal) ride along
      copy.colors = Object.assign({}, rec.colors, sampled);  // belt/gloss kept, cloth sampled
      return copy;
    }
    // plain civvies: their actual rendered set travels with the swap
    const torso = sampled ? sampled.torso : (p.outfit != null ? p.outfit : 0x8a939c);
    const colors = sampled || { legs: 0x363b46, torso, collar: torso, arms: torso, shoes: 0x2b2b2b };
    return { id: "civvies", name: "their street clothes", tier: "street", who: "them", price: 0, drip: 0, colors };
  };

  // FORMAL KIT reads (bling.js attaches the meshes off these — its pooled,
  // despawn-safe rig-attachment pipeline): "tux" = white shirt-front panel +
  // bow-tie + pocket square; "suit" = the modest shirt-front sliver.
  CBZ.cityOutfitFormal = function () { const w = g.cityWornOutfit; return (w && w.formal) || null; };
  CBZ.cityOutfitFormalOf = function (p) {
    buildGangOutfits();
    const rec = baseRecordOf(p);
    return (rec && rec.formal) || null;
  };

  // ============================================================
  //  CORPSE SWAP — "Take their clothes" (interact.js). Stripping a body and
  //  changing is a BEAT of vulnerability: ~2.4s where you can't shoot
  //  (CBZ.cityMenuOpen is the engine's existing fire-block chokepoint).
  //  The trade is literal: the corpse is left wearing YOUR old fit.
  // ============================================================
  let _pendingSwap = null, _heldMenu = false;
  CBZ.cityOutfitSwapWithCorpse = function (body) {
    if (!body || !body.dead || body._clothesTaken) return false;
    if (_pendingSwap || (g.cityOutfitChanging || 0) > 0) return false;
    if (CBZ.player && (CBZ.player.dead || CBZ.player.driving)) return false;
    const theirs = CBZ.cityOutfitOf(body);
    if (!theirs) return false;
    body._clothesTaken = true;
    _pendingSwap = { body, theirs, mine: worn() };
    g.cityOutfitChanging = 2.4;
    if (!CBZ.cityMenuOpen) { CBZ.cityMenuOpen = true; _heldMenu = true; }   // hands full — can't shoot
    if (CBZ.sfx) CBZ.sfx("door");
    CBZ.city && CBZ.city.note("Stripping the " + theirs.name + " off the body — you're exposed…", 2.2);
    return true;
  };
  function finishSwap() {
    const sw = _pendingSwap; _pendingSwap = null;
    if (!sw) return;
    // the corpse is left in YOUR old fit (colors literally trade bodies —
    // sw.mine is the worn record, and the player rig is always painted from
    // the worn record, so the corpse gets your exact previous visible set).
    if (sw.body) {
      sw.body._wornOutfit = sw.mine;             // identity reads now see the traded cloth
      if (sw.body.char) {
        recolorRig(sw.body.char, sw.mine.colors);
        sw.body.outfit = sw.mine.colors.torso;   // gore/cloth reads stay true
      }
      // re-mirror the corpse's attachments NOW: a magnate stripped of his tux
      // loses the shirt-front/bow on the spot (or gains yours, if you had one).
      if (CBZ.cityBlingResyncPed) CBZ.cityBlingResyncPed(sw.body);
    }
    wearRecord(sw.theirs);
  }
  function cancelSwap() {
    _pendingSwap = null;
    g.cityOutfitChanging = 0;
    if (_heldMenu) { CBZ.cityMenuOpen = false; _heldMenu = false; }
  }

  // ============================================================
  //  PER-FRAME (cheap): keep the player painted, run the change beat, and
  //  lazily wrap CBZ.cityPlayerDrip so the worn FIT counts at every rope/
  //  counter (idempotent, load-order-proof — the bling.js wrap pattern).
  // ============================================================
  function ensureDripWrap() {
    const cur = CBZ.cityPlayerDrip;
    if (typeof cur !== "function" || cur._outfitWrap) return;
    const wrapped = function () { return (cur() | 0) + wornDrip(); };
    wrapped._outfitWrap = true;
    CBZ.cityPlayerDrip = wrapped;
  }
  CBZ.onUpdate(34.8, function (dt) {
    if (g.mode !== "city") {
      _appliedId = null;                          // jail roles own the rig now; repaint on re-entry
      if (_pendingSwap) cancelSwap();
      return;
    }
    ensureDripWrap();
    buildGangOutfits();
    const w = worn();
    if (_appliedId !== w.id) applyPlayer();
    // the change beat: count it down, then the swap lands
    if ((g.cityOutfitChanging || 0) > 0) {
      if (CBZ.player && CBZ.player.dead) { cancelSwap(); return; }
      g.cityOutfitChanging -= dt;
      if (g.cityOutfitChanging <= 0) {
        g.cityOutfitChanging = 0;
        if (_heldMenu) { CBZ.cityMenuOpen = false; _heldMenu = false; }
        finishSwap();
      }
    }
  });
})();
