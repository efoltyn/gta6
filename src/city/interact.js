/* ============================================================
   city/interact.js — every street verb, registered into the ONE
   interaction registry (city/interactions.js · CBZ.interactions).

   This file no longer owns a panel, a key handler or a priority chain —
   it OWNS THE VERBS: what you can do to a person, a cop, a clerk, a
   body, a car, the club rope, a gang stash, and your own pockets. Each
   is an option record with a live canShow gate; the registry decides
   what you're looking at and which keys do what (and always SHOWS you
   before you press).

   Rules the design follows:
     • There is ALWAYS a malicious option (Mug / Boost / Loot / Rob).
     • Point a drawn gun at someone and the panel becomes a HOSTAGE menu
       (needsGunDrawn options): rob, hostage, ransom, execute.
     • Keys: E = the primary verb (tap/hold split where natural — tap E
       gets in a car, HOLD E drags the driver out), I J K L = the rest.
     • The old dedicated keys are GONE: F-for-cars and X-for-drugs and
       bare-E-to-eat all surface as panel options now.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const g = CBZ.game;
  const I = CBZ.interactions;

  const REACH = I.REACH;   // 3.8 — the shared interaction reach

  // PROPS_WIRED_V1 (owner audit — "interactable or gone"): gates the "Check the
  // mail" mailbox verb below (props.js gates the propane/meter mechanics off the
  // same flag). Defaulted in both files — idempotent, whichever loads first wins.
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.PROPS_WIRED_V1 == null) CBZ.CONFIG.PROPS_WIRED_V1 = true;

  function dist(a, x, z) { return Math.hypot(a.pos.x - x, a.pos.z - z); }
  function nearest(list, x, z, test) { let best = null, bd = REACH; for (const p of list) { if (!test(p)) continue; const d = dist(p, x, z); if (d < bd) { bd = d; best = p; } } return best; }

  // NO-DECOY FIX: a nearest-finder over city.streetProps (city/props.js's flat
  // registry of every street prop: bins, meters, newsboxes, cones, lamps…),
  // filtered by TYPE — the exact idiom cityNearestCar/cityNearestStash/
  // cityNearestCorpse already use, just scanning a plain {x,z,type} array
  // instead of an entity list (these records have no .pos, so this can't
  // reuse dist()/nearest() above as-is). types is an array of type strings
  // ("bin","newsbox",…); pass null/omit to match ANY street prop.
  CBZ.cityNearestStreetProp = function (px, pz, maxd, types) {
    const list = CBZ.city && CBZ.city.streetProps;
    if (!list || !list.length) return null;
    let best = null, bd = (maxd || REACH) * (maxd || REACH);
    for (let i = 0; i < list.length; i++) {
      const sp = list[i];
      if (types && types.indexOf(sp.type) < 0) continue;
      const dx = sp.x - px, dz = sp.z - pz, d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = sp; }
    }
    return best;
  };

  // the ped you're "pointing your gun at": in the forward cone, close-ish
  function aimedPed(px, pz) {
    const y = CBZ.cam ? CBZ.cam.yaw : 0, fx = -Math.sin(y), fz = -Math.cos(y);
    let best = null, bd = 7, bestDot = 0.55;
    for (const p of CBZ.cityPeds) {
      if (p.dead || p.vendor) continue;
      const dx = p.pos.x - px, dz = p.pos.z - pz, d = Math.hypot(dx, dz);
      if (d > bd || d < 0.4) continue;
      const dot = (dx / d) * fx + (dz / d) * fz;
      if (dot > bestDot) { bestDot = dot; best = p; }
    }
    return best;
  }

  const TALK = ["You lost?", "Nice day, huh.", "Got a light?", "Move along.", "I know you?", "Crazy out here lately.", "Spare some change?"];
  function talk() { CBZ.city.note("“" + TALK[(Math.random() * TALK.length) | 0] + "”", 1.6); }

  // ---- valuables / pawn helpers ------------------------------------------
  // Everything reads from the shared econ catalog so the player can judge a
  // haul: a Patek (clean $350k) pawns FAT, a Wallet ($40) is scraps. All
  // feature-detected — if the econ helpers are absent we degrade.
  function econ() { return CBZ.cityEcon || null; }
  function itemDef(name) { const e = econ(); return e && e.ITEMS ? e.ITEMS[name] : null; }
  function itemVal(name) { const it = itemDef(name); return it ? (it.value | 0) : 0; }
  function isLuxe(name) { const it = itemDef(name); return !!(it && (it.luxe || (it.value | 0) >= 90000)); }
  // a short $-amount: $40 / $6.5k / $350k / $3.0M so the worth is instantly legible.
  function money(n) { n = Math.round(n || 0); return n >= 1e6 ? "$" + (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M" : n >= 1000 ? "$" + Math.round(n / 1000) + "k" : "$" + n; }
  // what a fence/pawn would actually PAY for it (sellPrice when present, else value).
  function pawnPay(name) { const e = econ(); const v = (e && e.sellPrice) ? e.sellPrice(name, "pawn") : 0; return v > 0 ? v : Math.round(itemVal(name) * 0.65); }
  // a worth hint the player reads as "go pawn this": "(~$227k at the pawn shop)".
  function pawnHint(name) { return "(~" + money(pawnPay(name)) + " at the pawn shop)"; }
  // route ONE valuable item NAME into inventory; fire a satisfying headline for a
  // jackpot, return a legible fragment ("a Patek Philippe (~$280k …)") for the haul line.
  function takeValuable(name, opts) {
    const e = econ(); if (!name || !e || !e.add) return "";
    e.add(name, 1);
    const luxe = isLuxe(name), v = itemVal(name);
    if (luxe || v >= 20000) {
      const head = (opts && opts.head) || "💎 You bagged a " + name;
      if (CBZ.city && CBZ.city.big) CBZ.city.big(head + " — " + money(pawnPay(name)) + "!");
      if (CBZ.sfx) CBZ.sfx("coin");
      if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(luxe ? 6 : 2);
    }
    return name + " " + pawnHint(name);
  }
  // the first edible / drug in a ctx's pockets (gates the self options)
  function foodIn(ctx) { const e = econ(); if (!e) return null; return Object.keys(ctx.items || {}).find((n) => ctx.items[n] > 0 && e.ITEMS[n] && e.ITEMS[n].heal) || null; }
  function drugIn(ctx) { const e = econ(); if (!e) return null; return Object.keys(ctx.items || {}).find((n) => ctx.items[n] > 0 && e.ITEMS[n] && e.ITEMS[n].tag === "drug") || null; }

  // ---- gang membership / relationship helpers (all feature-detected) ----
  // your CURRENT membership in an NPC crew (you as a member, not the boss), or null.
  function myMemb() { return (CBZ.cityMembership && CBZ.cityMembership()) || null; }
  // the human rank label for your membership (Prospect / Soldier / …).
  function myRankName() { const m = myMemb(); if (!m) return ""; return CBZ.cityRankName ? CBZ.cityRankName(m.rank) : m.rank; }
  // a gang record by id (feature-detected).
  function gangRec(id) { return (id && CBZ.cityGangById) ? CBZ.cityGangById(id) : null; }
  // are you a PROSPECT for any crew right now? returns its standing 0..1 (or -1).
  function myProspectStanding() { return CBZ.cityProspectStanding ? CBZ.cityProspectStanding() : -1; }
  // is this ped a soldier of YOUR founded gang?
  function inMyGang(p) { return !!(CBZ.cityPlayerGangIsMember && CBZ.cityPlayerGangIsMember(p)); }
  // are you and this ped patched into the SAME NPC crew?
  function crewmate(p) { const m = myMemb(); return !!(m && p.gang && p.gang === m.gangId); }
  function relOf(p) { return CBZ.cityRel ? CBZ.cityRel(p) : null; }
  function hatesYou(p) { const r = relOf(p); return !!(r && (r.grudge > 45 || (CBZ.cityBond && CBZ.cityBond(p) < -0.3))); }
  function fearsYou(p) { const r = relOf(p); return !!(r && r.fear > 55 && !(r.respect > r.fear)); }
  function tightWithYou(p) { const r = relOf(p); return !!(r && (r.loyalty > 55 || r.respect > 50 || (CBZ.cityBond && CBZ.cityBond(p) > 0.4))); }
  function canAfford100() { return (g.respect || 0) >= 5 || (CBZ.city.canAfford && CBZ.city.canAfford(100)); }

  // Can this ped's crew be PROSPECTED/JOINED by the player? You can court a crew
  // when you don't run your own gang, aren't already patched in, and the ped's
  // gang is a real living rival crew (has a boss) that you're NOT at war with.
  function joinableGangOf(p) {
    if (!p || !p.gang) return null;
    if (!CBZ.cityProspectGang) return null;                     // system absent → no-op
    if (CBZ.cityPlayerGangExists && CBZ.cityPlayerGangExists()) return null;  // you're a boss
    if (myMemb()) return null;                                  // already in a crew
    const rec = gangRec(p.gang);
    if (!rec || rec.isPlayer || rec.absorbed) return null;
    if (!rec.boss || rec.boss.dead) return null;               // leaderless crew can't patch you in
    if (CBZ.cityAtWar && CBZ.cityAtWar("player", rec.id)) return null;  // at war → no welcome
    return rec;
  }
  // You can't see the exact $ on someone until you ROB them — only a vibe that
  // hints whether they're worth it (a rare whale "looks loaded").
  function pedVibe(p) {
    if (p.robbed) return "robbed";
    const w = p.wealth || 0;
    return w >= 0.985 ? "looks loaded 💰" : w >= 0.85 ? "flashing money" : w >= 0.55 ? "well-dressed" : w < 0.18 ? "looks broke" : "";
  }
  function ped$(p) {
    const flavor = p.archetype === "tweaker" ? "tweaking"
      : p.archetype === "volatile" ? "on edge"
      : p.archetype === "dealer" ? "street dealer"
      : p.archetype === "hustler" ? "hustler"
      : "";
    // CONTEXTUAL standing line — only shown when it actually means something:
    //   • crew-mate (you're patched in together): "your crew · YOU: <rank>"
    //   • a crew you could prospect: "courting (NN%)" or "prospect this crew"
    //   • otherwise how THEY feel toward you (loves/respects/hates), if non-neutral
    let standing = "";
    const memb = myMemb();
    if (memb && p.gang && p.gang === memb.gangId) standing = "your crew · you're a " + myRankName();
    else if (joinableGangOf(p)) {
      const ps = myProspectStanding();   // 0 when not yet courting (public read can't say -1)
      standing = ps > 0 ? "they're warming to you" : "prospect this crew";
    } else if (CBZ.cityRelLabel) { const lbl = CBZ.cityRelLabel(p); if (lbl && lbl !== "neutral") standing = lbl; }
    const bits = [pedVibe(p), p.job || "", flavor, p.gang || "", p.recruited ? p.kind : "", p === g.cityPartner ? "💕 partner" : "", standing].filter(Boolean);
    return bits.length ? bits.join(" · ") : "—";
  }

  // ---- the raw VERBS (unchanged behavior) ---------------------------------
  function attack(p) {
    const fx = CBZ.player.pos.x, fz = CBZ.player.pos.z;
    CBZ.player._fighting = 1.5;
    if (p.kind === "cop") { CBZ.cityHurtCop && CBZ.cityHurtCop(p, 35, { fromX: fx, fromZ: fz }); return; }
    p.hp -= 35;
    if (CBZ.sfx) CBZ.sfx("punch");
    if (p.hp <= 0) CBZ.cityKillPed(p, { fromX: fx, fromZ: fz }, "beaten");
    else CBZ.cityKOPed(p, fx, fz);
  }
  function execute(p) {
    const fx = CBZ.player.pos.x, fz = CBZ.player.pos.z;
    const from = CBZ.playerMuzzleWorld ? CBZ.playerMuzzleWorld() : { x: fx, y: 1.4, z: fz };
    if (CBZ.muzzleFlash) CBZ.muzzleFlash(from, {});
    if (CBZ.sfx) CBZ.sfx(CBZ.gunVoiceName ? CBZ.gunVoiceName((CBZ.cityCurrentWeapon && CBZ.cityCurrentWeapon() || {}).key) : "report");
    if (p.kind === "cop") CBZ.cityHurtCop && CBZ.cityHurtCop(p, 200, { fromX: fx, fromZ: fz });
    else CBZ.cityKillPed(p, { fromX: fx, fromZ: fz, force: 6, fling: 3 }, "executed");
  }
  // SHAKEDOWN / EXTORTION — REALISTIC + BOUNDED (no infinite faucet).
  // A person carries a FINITE wallet (economy.js rollCashFor: a broke Lv.1 has
  // $5–40, a tycoon $10k–90k). A shakedown empties THAT wallet and DEPLETES it —
  // it does NOT mint fresh cash. Once tapped they have nothing left to give, so
  // spamming one mark yields a few crumpled bills at most, then zero. And every
  // shakedown is a CRIME that escalates: their fear/grudge climb, heat + witness
  // attention rise, and a brave/armed mark fights back, the timid bolt, a snitch
  // runs to the law. Pushing your luck gets you into trouble, not riches.
  function shakeBraveEnough(p) {
    // a made/armed/aggressive mark, or one whose respect outweighs their fear,
    // dares to refuse and swing back instead of paying.
    const r = relOf(p);
    const aggr = p.aggr || 0.3;
    if (p.armed) return true;
    if (r && r.respect > r.fear + 20) return true;
    return aggr >= 0.62;   // "crook"/"violent" bands stand their ground
  }
  function demandRansom(p) {
    if (p === g.cityHostage) { CBZ.cityReleaseHostage && CBZ.cityReleaseHostage(true); return; }
    if (!p || p.dead) return;
    const now = (typeof CBZ.now === "number") ? CBZ.now : (Date.now ? Date.now() : 0);

    // A wallet that's already been fully tapped (mugged/robbed/drained) is dry —
    // you cannot squeeze water from a stone.
    const wallet = Math.max(0, p.cash | 0);

    // RESISTANCE FIRST. A brave/armed mark refuses and turns on you; spamming a
    // shakedown is how you start a fight, not how you get paid. Resistance grows
    // every time you lean on the SAME person (they get fed up / desperate).
    const prior = p._shakeCount | 0;
    const sinceLast = now - (p._shakeT || 0);
    const fearNow = (relOf(p) && relOf(p).fear) || p.fear * 10 || 0;
    // base refusal chance climbs with each prior shakedown and with low fear.
    let refuse = 0.04 + prior * 0.12 + Math.max(0, (40 - fearNow)) * 0.004;
    if (shakeBraveEnough(p)) refuse += 0.35;
    if (refuse > 0.92) refuse = 0.92;
    if (Math.random() < refuse) {
      // they don't pay — and it costs YOU. Grudge/fear shift, heat, witnesses.
      if (CBZ.cityRelShift) CBZ.cityRelShift(p, "threatened");
      p.alarmed = Math.max(p.alarmed || 0, 8);
      const pa = CBZ.city && CBZ.city.playerActor;
      if (shakeBraveEnough(p) && pa) {
        // a hard mark squares up — now you've got a fight on your hands.
        p.rage = pa; p.state = "fight"; p.fear = 0;
        CBZ.city.note((p.name || "They") + " won't be shaken down — and squares up!", 2);
      } else {
        // the timid bolt; a snitch makes a beeline for the cops.
        p.state = "flee"; p.target && p.target.set(p.pos.x, 0, p.pos.z);
        CBZ.city.note((p.name || "They") + " refuses and backs away.", 1.8);
      }
      CBZ.cityAlarm(p.pos.x, p.pos.z, 18, 1.1, pa);
      CBZ.cityCrime && CBZ.cityCrime(45, { x: p.pos.x, z: p.pos.z, type: "extortion" });
      if (CBZ.sfx) CBZ.sfx("punch");
      p._shakeT = now; p._shakeCount = prior + 1;
      return;
    }

    // THEY PAY — but only what they actually have on them, and only the cut a
    // first squeeze can extract. The cut SHRINKS every time you re-lean on the
    // same person within a stretch (they've handed over their cash already).
    // A fully recovered wallet (long gap) lets the cut reset toward the top.
    let cutFrac;
    if (sinceLast > 90000 || prior === 0) cutFrac = 0.6 + Math.random() * 0.25;  // fresh mark: 60–85%
    else cutFrac = Math.max(0.05, 0.45 - prior * 0.15);                          // diminishing on repeats
    let pay = Math.round(wallet * cutFrac);
    // a floor so a fearful mark still coughs up pocket change the FIRST time, but
    // never out of an empty wallet — once dry, repeats give nothing.
    if (pay <= 0 && wallet > 0) pay = Math.min(wallet, 2 + ((Math.random() * 6) | 0));
    pay = Math.min(pay, wallet);

    if (pay <= 0) {
      // dry — leaning on a tapped mark just raises heat for no reward.
      p.alarmed = Math.max(p.alarmed || 0, 6);
      if (CBZ.cityRelShift) CBZ.cityRelShift(p, "threatened");
      CBZ.cityCrime && CBZ.cityCrime(30, { x: p.pos.x, z: p.pos.z, type: "extortion" });
      CBZ.city.note((p.name || "They") + " has nothing left to give.", 1.8);
      p._shakeT = now; p._shakeCount = prior + 1;
      return;
    }

    p.cash = wallet - pay;          // DEPLETE the finite wallet — no fresh money minted
    p.alarmed = 8; p.fear = Math.min(10, (p.fear || 0) + 2);
    CBZ.city.addCash(pay);
    CBZ.city.big("EXTORTED + " + money(pay));
    if (CBZ.cityRelShift) CBZ.cityRelShift(p, "extorted");
    CBZ.cityAlarm(p.pos.x, p.pos.z, 16, 1, CBZ.city.playerActor);
    // repeat extortion of the same block draws more heat, not less.
    CBZ.cityCrime && CBZ.cityCrime(50 + prior * 12, { x: p.pos.x, z: p.pos.z, type: "extortion" });
    if (CBZ.sfx) CBZ.sfx("coin");
    p._shakeT = now; p._shakeCount = prior + 1;
  }
  // MUG / ROBBERY — takes their cash + the loot item (cityRobPed's payout) AND
  // transfers EVERY valuable they're carrying into your inventory to pawn. A
  // rich victim = a big haul (a Patek + a ring); a broke one = scraps.
  function mug(p) {
    if (!p || p.dead) return;
    // snapshot the valuables BEFORE the rob (cityRobPed only handles cash + loot;
    // we own routing the watch/ring/etc into inventory). Clear so it can't re-drop.
    const vals = (Array.isArray(p.valuables) && p.valuables.length) ? p.valuables.slice() : [];
    if (vals.length) p.valuables = [];
    const wasRobbed = p.robbed;
    const res = CBZ.cityRobPed ? CBZ.cityRobPed(p) : null;
    // cityRobPed no-ops if already robbed/dead — don't claim a phantom haul then.
    if (wasRobbed || !res) {
      if (!wasRobbed && vals.length) p.valuables = vals;  // restore: nothing was taken
      return;
    }
    const got = [];                       // legible haul fragments for the headline
    const cash = res.cash | 0;
    if (res.item) got.push(res.item + " " + pawnHint(res.item));
    let topVal = 0, topName = "";
    for (const name of vals) {
      const frag = takeValuable(name, { head: "💎 You ripped off a " + name });
      if (frag) got.push(frag);
      if (itemVal(name) > topVal) { topVal = itemVal(name); topName = name; }
    }
    // surface the haul. A real score earns a headline; otherwise a small note.
    if (topVal >= 20000) {
      // takeValuable already fired the jackpot big() for the top piece; add a haul line.
      CBZ.city.note("Mugged " + (p.name || "them") + ": " + (cash > 0 ? "$" + cash + " + " : "") + got.join(", "), 3);
    } else if (got.length || cash > 0) {
      const line = "MUGGED" + (cash > 0 ? " + $" + cash : "") + (got.length ? " · " + got.join(", ") : "");
      if (CBZ.city.big) CBZ.city.big(line);
    } else {
      CBZ.city.note((p.name || "They") + " had nothing worth taking — scraps.", 1.8);
    }
  }
  // PICKPOCKET — lift a SLICE of their cash (scaled to WHO they are: a billionaire's
  // pocket slice dwarfs a junkie's), and on a lucky dip palm ONE of their valuables
  // (a watch/ring) into your inventory to fence. A pickpocketed billionaire = jackpot.
  function pickpocket(p) {
    if (p.robbed) { CBZ.city.note(p.name + " has nothing left.", 1.4); return; }
    if (Math.random() < 0.7) {
      // a slice of what they're actually carrying (15-40%), with a small floor so
      // even a near-broke mark yields a few bucks; capped so you don't clean them out.
      const have = p.cash | 0;
      let take = have > 0 ? Math.round(have * (0.15 + Math.random() * 0.25)) : 0;
      take = Math.max(take, Math.min(have, 3 + ((Math.random() * 10) | 0)));
      take = Math.min(take, have);
      p.cash = have - take; if (take > 0) CBZ.city.addCash(take);
      // LUCKY DIP: a chance (better on a flashier mark) to palm ONE valuable — the
      // watch/ring slips out with the wallet. A whale's pocket is where Pateks live.
      let lifted = "";
      const vals = Array.isArray(p.valuables) ? p.valuables : null;
      const dipChance = 0.18 + (p.wealth || 0) * 0.22;
      if (vals && vals.length && Math.random() < dipChance) {
        // grab the BEST piece on a generous dip, a random one otherwise.
        const idx = Math.random() < 0.5
          ? vals.reduce((bi, n, i) => (itemVal(n) > itemVal(vals[bi]) ? i : bi), 0)
          : (Math.random() * vals.length) | 0;
        const name = vals.splice(idx, 1)[0];
        lifted = takeValuable(name, { head: "👀 Lifted a " + name });
        if (!isLuxe(name) && itemVal(name) < 20000)
          CBZ.city.note("Lifted a " + name + " " + pawnHint(name) + " — fence it at the pawn shop.", 2.6);
      }
      if (!lifted) { CBZ.city.note("Lifted $" + take + " unseen.", 1.6); }
      else if (take > 0) CBZ.city.note("…and $" + take + " in cash, clean.", 1.8);
      if (CBZ.sfx) CBZ.sfx("coin");
      CBZ.city.addRespect(1);
    } else { p.alarmed = 6; CBZ.cityAlarm(p.pos.x, p.pos.z, 12, 0.6, CBZ.city.playerActor); CBZ.cityCrime && CBZ.cityCrime(30, { x: p.pos.x, z: p.pos.z, type: "theft" }); CBZ.city.note(p.name + " caught you!", 1.6); }
  }
  // ---- SEARCH A STREET PROP (bin / newsbox): a small, bounded chance the
  // player finds a few loose bucks or a scrap item inside. Modest by design —
  // this is a trash can, not a mark's wallet — and BOUNDED per-prop like
  // demandRansom's wallet: a prop that just paid out goes quiet for a real
  // stretch so it can't be spammed into a faucet. Uses CBZ.cityEcon.rng()
  // (the shared city RNG other new city files route through) with a
  // Math.random() fallback if econ isn't loaded — same idiom as gigfleet.js /
  // empire.js / wealth.js's own `rng()` helpers.
  function propRng() { return (CBZ.cityEcon && CBZ.cityEcon.rng) ? CBZ.cityEcon.rng() : Math.random(); }
  // CBZ.now is a requestAnimationFrame timestamp — MILLISECONDS (see
  // core/loop.js: CBZ.now = t), same unit demandRansom's _shakeT bookkeeping
  // above already assumes (sinceLast > 90000). Cooldown expressed to match.
  const SEARCH_COOLDOWN_MS = 90000;   // 90s before the same can/box is worth checking again
  function searchStreetProp(sp) {
    const now = (typeof CBZ.now === "number") ? CBZ.now : (Date.now ? Date.now() : 0);
    if ((sp._searchT || 0) > now) { CBZ.city.note("Already picked through — nothing new.", 1.6); return; }
    sp._searchT = now + SEARCH_COOLDOWN_MS;
    const r = propRng();
    if (r < 0.55) {
      CBZ.city.note("Nothing but trash.", 1.4);
      return;
    }
    if (r < 0.9) {
      const cash = 3 + ((propRng() * 12) | 0);
      CBZ.city.addCash(cash);
      if (CBZ.sfx) CBZ.sfx("coin");
      CBZ.city.note("Found $" + cash + " someone tossed.", 1.8);
      return;
    }
    // rare: a usable scrap item, if the econ catalog is loaded
    const econ = CBZ.cityEcon;
    if (econ && econ.add && econ.ITEMS && econ.ITEMS["Hotdog"]) {
      econ.add("Hotdog", 1);
      CBZ.city.note("Found a half-eaten Hotdog — still wrapped.", 1.8);
      return;
    }
    const cash = 15 + ((propRng() * 20) | 0);
    CBZ.city.addCash(cash);
    if (CBZ.sfx) CBZ.sfx("coin");
    CBZ.city.note("Jackpot — someone dumped $" + cash + " in there.", 2);
  }
  // ---- CHECK THE MAIL (mailbox street prop) — searchStreetProp's cousin, but
  // keyed to a LETTERBOX: mostly junk flavor, sometimes a cash envelope ($5–40),
  // and rarely a scrap of street intel naming a nearby shop/crew (flavor only —
  // a single feed line, no new system). Bounded ONCE PER MAILBOX PER DAY
  // (CBZ.dayCount) so a row of boxes isn't a faucet; falls back to once-per-
  // session when the day clock is absent. Reuses propRng() (the same city-RNG-
  // with-Math.random-fallback searchStreetProp uses). Flag: PROPS_WIRED_V1.
  const MAIL_JUNK = [
    "Bills, coupons, and a pizza flyer. The usual.",
    "A jury summons — addressed to someone who moved out.",
    "Somebody's tax refund check. Not yours, sadly.",
    "A postcard from nowhere: 'Wish you were here.'",
    "Nothing but takeout menus and debt collectors.",
  ];
  // nearest named shop / gang to a point, for the rare intel line (flavor only).
  function mailIntelLine(x, z) {
    let shop = null, sd = 130 * 130;
    const lots = (CBZ.city && CBZ.city.arena && CBZ.city.arena.lots) || [];
    for (let i = 0; i < lots.length; i++) {
      const l = lots[i];
      if (!l || !l.building || !l.building.shop) continue;
      const nm = l.building.name || (l.building.shop && l.building.shop.name);
      if (!nm) continue;
      const dx = l.cx - x, dz = l.cz - z, d = dx * dx + dz * dz;
      if (d < sd) { sd = d; shop = nm; }
    }
    let gang = null, gd = 170 * 170;
    for (const gg of (CBZ.cityGangs || [])) {
      if (!gg || !gg.center) continue;
      const dx = gg.center.x - x, dz = gg.center.z - z, d = dx * dx + dz * dz;
      if (d < gd) { gd = d; gang = gg.name; }
    }
    if (shop && (!gang || sd <= gd)) return "A misdelivered invoice — " + shop + " is sitting on a fat week. Worth a look.";
    if (gang) return "A threat note meant for a neighbor: the " + gang + " are collecting on this block.";
    return "A tip-off scrawled on a napkin — but the ink's too smeared to read.";
  }
  function checkMailbox(sp) {
    const day = (typeof CBZ.dayCount === "function") ? CBZ.dayCount() : -1;
    if (day >= 0) {
      if (sp._mailDay === day) { CBZ.city.note("Already cleared this box today.", 1.6); return; }
      sp._mailDay = day;
    } else {
      if (sp._mailChecked) { CBZ.city.note("Already cleared this box.", 1.6); return; }
      sp._mailChecked = true;
    }
    const r = propRng();
    if (r < 0.62) {                                  // mostly junk
      CBZ.city.note(MAIL_JUNK[(propRng() * MAIL_JUNK.length) | 0], 1.8);
      return;
    }
    if (r < 0.93) {                                  // a cash envelope
      const cash = 5 + ((propRng() * 36) | 0);       // $5–40
      CBZ.city.addCash(cash);
      if (CBZ.sfx) CBZ.sfx("coin");
      CBZ.city.note("A cash envelope in the mail — $" + cash + " inside.", 1.9);
      return;
    }
    // rare: a scrap of street intel (flavor feed line, no new system)
    CBZ.city.note(mailIntelLine(sp.x, sp.z), 2.4);
  }
  function robRegister(v) {
    const ped = v;
    const take = 150 + ((Math.random() * 400) | 0) + (ped.cash || 0);
    ped.cash = 0; ped.robbed = true; ped.alarmed = 10;
    CBZ.city.addCash(take); CBZ.city.addRespect(3);
    CBZ.cityAlarm(ped.pos.x, ped.pos.z, 26, 1.5, CBZ.city.playerActor);
    CBZ.cityCrime && CBZ.cityCrime(160, { x: ped.pos.x, z: ped.pos.z, type: "armed-robbery" });
    ped.vendor = null;
    CBZ.city.big("ROBBERY + $" + take);
    if (CBZ.sfx) CBZ.sfx("coin");
  }

  // Advance the prospect/initiation/put-in-work relationship FROM THE STREET.
  //   • Not yet courting this crew → start prospecting it (cityProspectGang).
  //   • Courting + this member is befriendable → do them a FAVOR, which raises
  //     their affinity AND your gang standing (cityDoFavor) — the EARN-TRUST task.
  //   • Standing maxed → point at the [O] menu for the initiation step.
  //   • Already patched in → putting in work is a body kicked up.
  function prospectOrWork(p) {
    const rec = gangRec(p && p.gang);
    if (myMemb()) {
      // already patched in: putting in work is a body kicked up — call out the path.
      CBZ.city.note("Drop a rival — kicked-up work moves you up the ladder. · O", 3);
      return;
    }
    // not courting anyone yet (or not this crew) → start prospecting THIS crew.
    const courting = myProspectStanding() > 0 || (CBZ.cityProspectTask && CBZ.cityProspectTask());
    if (!courting) {
      if (rec && CBZ.cityProspectGang) CBZ.cityProspectGang(rec);
      return;
    }
    // standing maxed → the initiation step lives on the [O] menu.
    if (myProspectStanding() >= 1) {
      CBZ.city.note("They're ready to make you — get jumped in or put in work. · O", 2.6);
      return;
    }
    // courting + this member is befriendable → do them a FAVOR to earn standing.
    if (CBZ.cityCanBefriend && CBZ.cityCanBefriend(p) && CBZ.cityDoFavor) {
      CBZ.cityDoFavor(p);
      return;
    }
    // can't befriend this one (grudge/dead) — nudge toward the task path.
    CBZ.city.note("Hang on their turf and do members favors to earn trust. · O", 2.6);
  }

  // ---- police helpers -----------------------------------------------------
  // Surrender only exists when you're actually wanted (you can't give up to
  // nothing); an alibi only shows while the heat is still low enough that a
  // story is believable. With a clean record a cop is just a person to talk to.
  function copHunting(c) { return c.curTarget === CBZ.city.playerActor || (c.sees && (g.wanted | 0) >= 1); }
  function copNote(c) {
    const stars = g.wanted | 0;
    if (copHunting(c)) return "👁 Onto you — give up, talk fast, or run";
    if (stars >= 1) return "On alert · " + "★".repeat(stars);
    return "Keeping the peace";
  }
  function copSurrender(c) {
    if (CBZ.sfx) CBZ.sfx("door");
    CBZ.city && CBZ.city.note("You raise your hands and give yourself up…", 1.4);
    if (c) { c.curTarget = CBZ.city.playerActor; c.sees = true; }
    CBZ.cityBust && CBZ.cityBust({ peaceful: true });   // cooperative → lighter than a violent bust
  }
  function copAlibi(c) {
    const stars = g.wanted | 0;
    if (stars < 1) { talk(); return; }
    // believability falls as the heat climbs; selling it buys you down a level
    const chance = stars === 1 ? 0.6 : 0.32;
    if (Math.random() < chance) {
      CBZ.cityReduceWanted && CBZ.cityReduceWanted(2);
      if (c) { c.curTarget = null; c.sees = false; c.retarget = 2.5; c.arrestT = 0; }
      // (no big — the cop's own line carries it)
      CBZ.city && CBZ.city.note("“…fine. Move along.” " + c.name + " buys it.", 2);
      CBZ.city && CBZ.city.addRespect(1);
    } else {
      CBZ.city && CBZ.city.note("“Save it.” " + c.name + " isn't buying it.", 2);
      CBZ.cityCrime && CBZ.cityCrime(40, { instant: true, x: c.pos.x, z: c.pos.z, type: "lying-to-police" });
      if (c) c.retarget = 0;        // lock straight onto you
    }
  }
  function copAssault(c) {
    CBZ.cityCrime && CBZ.cityCrime(70, { instant: true, x: c.pos.x, z: c.pos.z, type: "assault-officer" });
    attack(c);
  }

  // ---- CORPSE WARDROBE helpers (city/outfits.js) --------------------------
  // Loot is automatic (walk over it); the FIT is a choice — swap outfits with
  // the dead. WHY: a cop's uniform makes the law read you as one of theirs, a
  // crew's colors flip turf hostility, a tycoon's tuxedo is pure worn status.
  function nearestDressedBody(px, pz) {
    if (!CBZ.cityOutfitSwapWithCorpse) return null;
    let best = null, bd = REACH;
    const scan = (list) => {
      if (!list) return;
      for (const p of list) {
        if (!p || !p.dead || p._clothesTaken || p.culled) continue;
        if (!p.char || !p.char.skinSlots) continue;
        const d = dist(p, px, pz);
        if (d < bd) { bd = d; best = p; }
      }
    };
    scan(CBZ.cityPeds);
    scan(CBZ.cityCops);
    return best;
  }
  // the WHY line for a fit, read off what it buys you on the street
  function bodyFitNote(fit) {
    if (!fit) return "Their clothes could fit you";
    if (fit.cop) return "A uniform — the law reads its own colors";
    if (fit.gang) return "Their colors — that set would read you as kin";
    if (fit.id === "tuxedo") return "A tuxedo — ropes open for cloth like this";
    return "A clean change of clothes";
  }

  // ---- THE CLUB (the velvet rope) -----------------------------------------
  // buildings.js stamps lot.building.club = { bouncerSpot, ropePost, door, ... }
  // on exactly one lot (CBZ.city.clubLot). At the rope we offer a "step to the
  // bouncer" verb that hands off to club.js's gate check — the bouncer reads
  // CBZ.cityPlayerDrip() vs CBZ.CITY.CLUB_DRIP to admit/reject you.
  function clubInfo() {
    const lot = CBZ.city && CBZ.city.clubLot;
    const c = lot && lot.building && lot.building.club;
    // club is the structured object (not just the boolean flag); needs a spot.
    if (c && typeof c === "object" && (c.bouncerSpot || c.ropePost)) return c;
    return null;
  }
  function clubSpot(c) { return (c && (c.bouncerSpot || c.ropePost)) || null; }
  // a touch wider than REACH so the queue lane / rope reads as one approachable zone.
  const CLUB_REACH = 4.6;
  // hand off to club.js's entry/gate function — try the agreed global first, then
  // sensible aliases. If club.js isn't loaded yet, describe the gate instead.
  function clubTryEnter() {
    const fn = CBZ.cityClubTryEnter || CBZ.cityClubApproach || CBZ.cityClubEnter || CBZ.cityClubGate;
    if (typeof fn === "function") { fn(); return; }
    const drip = CBZ.cityPlayerDrip ? CBZ.cityPlayerDrip() : 0;
    const need = (CBZ.CITY && CBZ.CITY.CLUB_DRIP) || 30;
    if (drip >= need) CBZ.city.note("The bouncer sizes up your fit and unhooks the rope…", 2.2);
    else CBZ.city.note("“Not in those rags.” The bouncer waves you off — come back sharper.", 2.6);
  }
  function clubNote() {
    const drip = CBZ.cityPlayerDrip ? CBZ.cityPlayerDrip() : 0;
    const need = (CBZ.CITY && CBZ.CITY.CLUB_DRIP) || 30;
    return "Velvet rope · " + (drip >= need ? "your fit gets you in" : "not dressed for it yet");
  }

  // ---- GIG WORK (city/gigs.js · CBZ.cityGig) ------------------------------
  // The honest-money loop: accept (phone) → PICKUP → CARRY → DROP-OFF → paid.
  // gigs.js owns the state; interact.js owns the in-world VERBS that drive it.
  // EVERYTHING here is feature-detected — if CBZ.cityGig is absent, every gig
  // verb's canShow returns false and nothing surfaces (no breakage).
  function gig() { return CBZ.cityGig || null; }
  function gigActive() { const G = gig(); if (!G || typeof G.active !== "function") return null; try { return G.active() || null; } catch (e) { return null; } }
  function gigStageStr(a) { return a ? String(a.stage || a.phase || a.step || a.state || "").toLowerCase() : ""; }
  // call the FIRST available advance fn on CBZ.cityGig (the state machine's
  // "advance the loop one step" — pickup grabbed / fare aboard / dropped off).
  // We try several plausible names so we line up with gigs.js however it lands.
  function gigAdvance(arg) {
    const G = gig(); if (!G) return false;
    const fn = G.advance || G.step || G.interact || G.handoff || G.progress || G.action;
    if (typeof fn === "function") { try { fn.call(G, arg); return true; } catch (e) {} }
    return false;
  }
  // is the player at the gig's PICKUP spot right now? Prefer a gigs.js predicate;
  // else fall back to a distance check against an exposed pickup coordinate.
  function gigAtPickup() {
    const G = gig(), a = gigActive(); if (!G || !a) return false;
    if (typeof G.atPickup === "function") { try { return !!G.atPickup(); } catch (e) {} }
    const st = gigStageStr(a);
    if (st && st.indexOf("pickup") < 0 && st.indexOf("offered") < 0 && st.indexOf("hail") < 0) return false;
    const spot = a.pickup || a.from || a.origin || a.pickupSpot;
    if (!spot || a.hasCargo || a.carrying) return st.indexOf("pickup") >= 0 ? !!spot : false;
    return Math.hypot(CBZ.player.pos.x - num(spot.x), CBZ.player.pos.z - num(spot.z)) < REACH;
  }
  // is the player at the gig's DROP-OFF spot, with the cargo/fare in hand?
  function gigAtDropoff() {
    const G = gig(), a = gigActive(); if (!G || !a) return false;
    if (typeof G.atDropoff === "function") { try { return !!G.atDropoff(); } catch (e) {} }
    const st = gigStageStr(a);
    const carrying = a.hasCargo || a.carrying || st.indexOf("carry") >= 0 || st.indexOf("drop") >= 0 || st.indexOf("ride") >= 0;
    if (!carrying) return false;
    const spot = a.dropoff || a.to || a.dest || a.destination || a.dropSpot;
    if (!spot) return st.indexOf("drop") >= 0;
    return Math.hypot(CBZ.player.pos.x - num(spot.x), CBZ.player.pos.z - num(spot.z)) < REACH;
  }
  function num(n) { return (typeof n === "number" && isFinite(n)) ? n : 0; }
  // a kind-aware verb label for the pickup action.
  function gigPickupLabel(a) {
    const k = a ? String(a.kind || a.line || "") : "";
    if (k === "taxi" || k === "uber" || k === "rideshare") return "Pick up the fare 🚕";
    if (k === "smuggling" || k === "smuggle") return "Load the shipment 📦";
    return "Grab the bag 📦";
  }
  function gigDropLabel(a) {
    const k = a ? String(a.kind || a.line || "") : "";
    if (k === "taxi" || k === "uber" || k === "rideshare") return "Drop the fare off 🏁";
    if (k === "smuggling" || k === "smuggle") return "Hand over the shipment 🤝";
    return "Drop off the delivery 🤝";
  }
  // HAIL-A-CAB: while driving a taxi/empty car, a waiting fare nearby you can
  // pick up. gigs.js may auto-zone fares; this verb is the manual hand-off so a
  // player who pulls up to a flagged rider can stop and take them. We look for a
  // gigs.js-flagged waiting ped, else any nearby idle ped when a taxi gig wants one.
  function gigWaitingFare(px, pz) {
    const G = gig(); if (!G) return null;
    if (typeof G.waitingFare === "function") { try { return G.waitingFare(px, pz, REACH + 1.2) || null; } catch (e) {} }
    // fallback: a ped explicitly flagged as a fare by gigs.js
    let best = null, bd = REACH + 1.6;
    for (const p of (CBZ.cityPeds || [])) {
      if (p.dead || p.vendor) continue;
      if (!p._gigFare && !p.hailingCab) continue;
      const d = dist(p, px, pz);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
  function gigHailFare(p) {
    const G = gig(); if (!G) return;
    if (typeof G.pickupFare === "function") { try { G.pickupFare(p); return; } catch (e) {} }
    if (!gigAdvance(p)) {
      CBZ.city && CBZ.city.note && CBZ.city.note("They climb in.", 1.4);
    }
  }

  // ================== SOURCES: what can be targeted ==================
  // Base prios mirror the old strict chain (vendor > club > stash > cop > ped >
  // corpse > car) but the registry's facing weighting can pull the thing you're
  // actually LOOKING AT ahead of a near-tied neighbor — that's the point.
  I.registerSource({
    id: "src-gunpoint", kind: "ped:gunpoint", layers: ["ped:civ", "ped"], prio: 0, gunpoint: true, driving: false,
    find: function (px, pz, ctx, push) {
      if (!ctx.gunDrawn) return;
      const p = aimedPed(px, pz);
      if (p) push(p, dist(p, px, pz));
    },
  });
  I.registerSource({
    id: "src-vendor", kind: "vendor", layers: ["ped:vendor", "ped"], prio: 12, driving: false,
    find: function (px, pz, ctx, push) { const v = nearest(CBZ.cityPeds, px, pz, (p) => p.vendor && !p.dead); if (v) push(v, dist(v, px, pz)); },
  });
  I.registerSource({
    id: "src-cop", kind: "cop", layers: ["ped:cop", "ped"], prio: 8, driving: false,
    find: function (px, pz, ctx, push) { if (!CBZ.cityCops) return; const c = nearest(CBZ.cityCops, px, pz, (q) => !q.dead); if (c) push(c, dist(c, px, pz)); },
  });
  I.registerSource({
    id: "src-ped", kind: "ped", layers: ["ped:civ", "ped"], prio: 6, driving: false,
    find: function (px, pz, ctx, push) { const p = nearest(CBZ.cityPeds, px, pz, (q) => !q.vendor && !q.dead); if (p) push(p, dist(p, px, pz)); },
  });
  I.registerSource({
    id: "src-corpse", kind: "corpse", layers: ["corpse"], prio: 4, driving: false,
    find: function (px, pz, ctx, push) {
      if ((g.cityOutfitChanging || 0) > 0) return;
      const b = nearestDressedBody(px, pz);
      if (b) push(b, dist(b, px, pz));
    },
  });
  I.registerSource({
    id: "src-car", kind: "vehicle", layers: ["vehicle"], prio: 3, driving: false,
    find: function (px, pz, ctx, push) { if (!CBZ.cityNearestCar) return; const c = CBZ.cityNearestCar(px, pz, REACH); if (c) push(c, dist(c, px, pz)); },
  });
  // behind the wheel: the only target is the car you're IN (exit lives here now)
  I.registerSource({
    id: "src-mycar", kind: "vehicle:inside", layers: ["vehicle:inside"], prio: 50, driving: true,
    find: function (px, pz, ctx, push) { if (ctx.vehicle) push(ctx.vehicle, 0); },
  });
  // your own pockets — the no-target fallback (eat / do drugs surface here, so
  // the old bare-E and X keys are gone but nothing is hidden from the player)
  const POCKETS = { pockets: true };
  I.registerSource({
    id: "src-self", kind: "self", layers: ["self"], prio: -5, driving: false,
    // ONLY surface the pockets card when there's a real pocket action (food to
    // eat). It used to push unconditionally, so "Your pockets / Open the gig app"
    // sat on screen forever as its own dumb always-open panel. The gig app lives
    // in the phone now ([P] → Gig Work), so nothing is lost — the HUD just stays
    // clean when you've got nothing to do in your pockets.
    find: function (px, pz, ctx, push) { if (foodIn(ctx)) push(POCKETS, 0); },
  });

  // ---- ZONES: interaction spots with no entity ----
  I.registerZone({
    id: "zone-club", kind: "club", prio: 11, driving: false,
    find: function (px, pz) {
      const c = clubInfo(); if (!c) return null;
      const s = clubSpot(c); if (!s) return null;
      if (Math.hypot(px - s.x, pz - s.z) > CLUB_REACH) return null;
      // stable wrapper so hysteresis sees one identity (carries x,z for scoring)
      if (!c._izTarget) c._izTarget = { x: s.x, z: s.z, club: c };
      return c._izTarget;
    },
    options: [{ id: "club-enter", slot: "i", label: "Step to the bouncer 🪩", onSelect: function () { clubTryEnter(); } }],
  });
  I.registerZone({
    id: "zone-stash", kind: "stash", prio: 10, driving: false,
    find: function (px, pz) { return CBZ.cityNearestStash ? CBZ.cityNearestStash(px, pz, REACH) : null; },
    options: [{ id: "stash-rob", slot: "i", bad: true, label: "Rob stash", onSelect: function (lot) { CBZ.cityRobStash(lot); } }],
  });
  // NO-DECOY FIX: street furniture used to be pure decoration (or gunfire-only —
  // see props.js's shootables). Trash cans and news boxes are exactly the kind
  // of prop a street would let you rummage through — a low-prio, low-reward
  // "Check it" that occasionally pays a few bucks. One zone registration covers
  // BOTH prop types city-wide (cityNearestStreetProp filters by type), not a
  // per-instance option — the category-wide ask from the task.
  I.registerZone({
    id: "zone-streetprop", kind: "streetprop", prio: 2, driving: false,
    find: function (px, pz) { return CBZ.cityNearestStreetProp ? CBZ.cityNearestStreetProp(px, pz, REACH, ["bin", "newsbox"]) : null; },
    options: [{
      id: "streetprop-search", slot: "i",
      label: function (sp) { return sp.type === "newsbox" ? "Check the news box" : "Check the trash can"; },
      onSelect: function (sp) { searchStreetProp(sp); },
    }],
  });
  // PROPS_WIRED_V1: MAILBOXES get "[E] Check the mail" — searchStreetProp's
  // cousin (junk / cash envelope / rare intel), bounded once-per-box-per-day. Its
  // OWN zone (slot "e", distinct from the [I] bin/newsbox rummage) so a letterbox
  // reads as a deliberate check, not trash-picking. find() returns null when the
  // flag is off, so the card never surfaces (one-line revert).
  I.registerZone({
    id: "zone-mailbox", kind: "mailbox", prio: 3, driving: false,
    find: function (px, pz) {
      if (!CBZ.CONFIG.PROPS_WIRED_V1) return null;
      return CBZ.cityNearestStreetProp ? CBZ.cityNearestStreetProp(px, pz, REACH, ["mailbox"]) : null;
    },
    options: [{ id: "mailbox-check", slot: "e", label: "Check the mail", onSelect: function (sp) { checkMailbox(sp); } }],
  });

  // ---- PROPS WITH PURPOSE (city/propuse.js): every chair/bench/couch is a
  // SEAT, every bed SLEEPS, wanted posters READ. All feature-detected — when
  // propuse.js is absent or CBZ.CONFIG.PROPS_PURPOSE=false the registries stay
  // empty and these zones never surface.
  I.registerZone({
    id: "zone-seat", kind: "seat", prio: 6, driving: false,
    find: function (px, pz, ctx) { return CBZ.propNearestSeat ? CBZ.propNearestSeat(px, pz, REACH, ctx.pos.y) : null; },
    options: [{ id: "seat-sit", slot: "e", label: "Sit down", onSelect: function (seat) { CBZ.propSit(CBZ.player, seat); } }],
  });
  I.registerZone({
    id: "zone-bed", kind: "bed", prio: 6, driving: false,
    find: function (px, pz, ctx) { return CBZ.propNearestBed ? CBZ.propNearestBed(px, pz, REACH, ctx.pos.y) : null; },
    options: [{
      id: "bed-sleep", slot: "e",
      label: function (b) { return b.kind === "bedroll" ? "Crash on the bedroll" : "Sleep til morning"; },
      onSelect: function (bed) { CBZ.propSleep(CBZ.player, bed); },
    }],
  });
  I.registerZone({
    id: "zone-wanted-poster", kind: "wantedposter", prio: 5, driving: false,
    find: function (px, pz, ctx) {
      const p = CBZ.propNearestWantedPoster ? CBZ.propNearestWantedPoster(px, pz, REACH + 1.2) : null;
      if (!p) return null;
      if (Math.abs((p.y || 0) - ctx.pos.y) > 12) return null;   // a rooftop board isn't readable from its own roof only — big boards read from the street below
      return p;
    },
    options: [{
      id: "wanted-read", slot: "i",
      label: "Read the wanted poster",
      onSelect: function (poster) { if (CBZ.bountyFromPoster) CBZ.bountyFromPoster(poster); },
    }],
  });
  // seated/asleep: the "get up" verb rides its own zero-distance source so it
  // always wins the panel while the pose holds (physics stun hides nothing here).
  I.registerSource({
    id: "src-propself", kind: "propself", layers: ["propself"], prio: 40, driving: false,
    find: function (px, pz, ctx, push) {
      const s = CBZ.player._propSeat, b = CBZ.player._propBed;
      if (s || b) push(s || b, 0);
    },
  });
  I.register("propself", {
    id: "propself-stand", slot: "e", prio: 100,
    canShow: function () { return !!CBZ.player._propSeat; },
    label: "Stand up", onSelect: function () { CBZ.propStand(CBZ.player); },
  });
  I.register("propself", {
    id: "propself-wake", slot: "e", prio: 100,
    canShow: function () { return !!CBZ.player._propBed; },
    label: "Wake up", onSelect: function () { CBZ.propWake(CBZ.player); },
  });

  // ================== DESCRIBERS: the card header per kind ==================
  I.describe("ped", function (p) {
    return {
      label: ((p.nameKnown || p.recruited || p.companion || p === g.cityPartner) ? p.name : "A stranger") + (p.gang ? " (" + p.gang + ")" : ""),
      note: ped$(p),
    };
  });
  I.describe("ped:gunpoint", function (p) { return { label: "🔫 " + p.name, note: "Hands up · make your demand" }; });
  I.describe("vendor", function (v) {
    const name = (v.vendor && v.vendor.building && v.vendor.building.name) || "Counter";
    // the card subtitle = the contextual reason for THIS trade (VERB[kind].sub),
    // so the header itself tells you what the counter is for; fall back to the
    // old generic line for any kind without an entry. (VERB/vendorKind are
    // declared lower in this IIFE but always initialised by the time any
    // describer runs — describers fire per-frame, long after module load.)
    const d = VERB[vendorKind(v)];
    return { label: name, note: (d && d.sub) || "Vendor · cash register" };
  });
  I.describe("cop", function (c) { return { label: "👮 " + c.name, note: copNote(c) }; });
  I.describe("corpse", function (b) { const fit = CBZ.cityOutfitOf ? CBZ.cityOutfitOf(b) : null; return { label: "🧥 " + (b.name || "A body"), note: bodyFitNote(fit) }; });
  I.describe("vehicle", function (car) {
    const cond = CBZ.cityVehicleCondition ? CBZ.cityVehicleCondition(car) : null;
    const why = car.owned ? "Your ride" : car.npcDriver ? "Someone's at the wheel" : "Boost it · chop shop pays by condition";
    return { label: "🚗 " + (car.model ? car.model.name : "Car"), note: (cond ? cond.label + " · " : "") + why };
  });
  I.describe("vehicle:inside", function (car) {
    const cond = CBZ.cityVehicleCondition ? CBZ.cityVehicleCondition(car) : null;
    return { label: "🚗 " + (car.model ? car.model.name : "Car"), note: "Behind the wheel" + (cond ? " · " + cond.label : "") };
  });
  I.describe("club", function (t) { return { label: "🪩 " + ((t.club && t.club.name) || "The Velvet Club"), note: clubNote() }; });
  I.describe("stash", function (lot) { return { label: "🎒 Gang Stash", note: ((lot.building && lot.building.gang) || "gang") + " cache" }; });
  I.describe("streetprop", function (sp) {
    const isBox = sp.type === "newsbox";
    const now = (typeof CBZ.now === "number") ? CBZ.now : (Date.now ? Date.now() : 0);
    const picked = (sp._searchT || 0) > now;
    return { label: (isBox ? "📰 News box" : "🗑 Trash can"), note: picked ? "Picked through recently" : "Might be worth a look" };
  });
  I.describe("gig", function (t) {
    const a = (t && t.gig) || gigActive();
    const k = a ? String(a.kind || a.line || "gig") : "gig";
    const at = gigAtDropoff() ? "drop-off" : "pickup";
    const pay = a && a.pay ? " · " + money(a.pay) : "";
    return { label: "💼 " + (k.charAt(0).toUpperCase() + k.slice(1)) + " gig", note: "At the " + at + pay };
  });
  I.describe("modshop", function () { return { label: "🔧 Mod Garage", note: "Sell · respray · armor · booster · turret · rockets" }; });
  I.describe("self", function () { return { label: "Your pockets", note: "what you're carrying" }; });
  const SEAT_NAMES = { stool: "Bar stool", bench: "Bench", sofa: "Couch", couch: "Couch", booth: "Booth", patio: "Patio chair", waiting: "Waiting chair", chair: "Chair" };
  I.describe("seat", function (s) { return { label: "🪑 " + (SEAT_NAMES[s.kind] || "Chair"), note: "Take a seat" }; });
  I.describe("bed", function (b) { return { label: "🛏 " + (b.kind === "bedroll" ? "Bedroll" : "Bed"), note: b.kind === "bedroll" ? "A rough sleep — til morning" : "Sleep until morning" }; });
  I.describe("wantedposter", function (p) { return { label: "📋 Wanted poster", note: "Bounty $" + ((p && p.bounty) || 0).toLocaleString() }; });
  I.describe("propself", function () { return { label: CBZ.player._propBed ? "😴 Lying down" : "🪑 Seated", note: "take a load off" }; });

  // ================== OPTIONS ==================
  const nm = (p) => p.name || "them";

  // ---- GUNPOINT (needsGunDrawn): the HOSTAGE demands ----
  I.register("ped:civ", { id: "gp-rob", slot: "i", needsGunDrawn: true, bad: true, label: "Rob at gunpoint", onSelect: (p) => mug(p) });
  I.register("ped:civ", { id: "gp-hostage", slot: "j", needsGunDrawn: true, bad: true, label: "Take hostage", onSelect: (p) => CBZ.cityTakeHostage && CBZ.cityTakeHostage(p) });
  I.register("ped:civ", { id: "gp-ransom", slot: "k", needsGunDrawn: true, bad: true, label: "Demand ransom", onSelect: (p) => demandRansom(p) });
  I.register("ped:civ", { id: "gp-execute", slot: "l", needsGunDrawn: true, bad: true, label: "Execute", onSelect: (p) => execute(p) });

  // ---- LIVING PED, slot I: your soldier > NPC crew-mate > anyone (mug) ----
  // Slot exclusivity does the branch work: per key the highest-prio PASSING
  // option wins, so "Mug" can't surface on your own soldier.
  I.register("ped:civ", {
    id: "ped-promote", slot: "i", prio: 60, canShow: (p) => inMyGang(p),
    label: (p) => (p.rank === "lt" ? nm(p) + " (Lieutenant)" : "Promote " + nm(p) + " → Lt."),
    onSelect: (p) => (p.rank === "lt" ? talk() : CBZ.cityPlayerGangPromote(p)),
  });
  I.register("ped:civ", { id: "ped-swing-crew", slot: "i", prio: 50, bad: true, canShow: (p) => crewmate(p), label: (p) => "Swing on " + nm(p), onSelect: (p) => attack(p) });
  I.register("ped:civ", { id: "ped-mug", slot: "i", prio: 10, bad: true, label: (p) => "Mug " + nm(p), onSelect: (p) => mug(p) });

  // ---- LIVING PED, slot J ----
  I.register("ped:civ", {
    id: "ped-hold-corner", slot: "j", prio: 60, canShow: (p) => inMyGang(p),
    label: (p) => nm(p) + ", hold this corner",
    onSelect: (p, ctx) => { if (CBZ.cityPlayerGangOrder) { p.companion = false; p.guard = { x: ctx.pos.x, z: ctx.pos.z }; p.homeGuard = { x: ctx.pos.x, z: ctx.pos.z }; p.rage = null; p.target.set(p.pos.x, 0, p.pos.z); CBZ.city.note(nm(p) + " holds this spot.", 1.6); } },
  });
  I.register("ped:civ", { id: "ped-put-in-work", slot: "j", prio: 50, canShow: (p) => crewmate(p), label: (p) => "Put in work with " + nm(p), onSelect: (p) => prospectOrWork(p) });
  I.register("ped:civ", { id: "ped-swing", slot: "j", prio: 10, bad: true, label: (p) => "Swing on " + nm(p), onSelect: (p) => attack(p) });

  // ---- LIVING PED, slot K: the contextual relationship ladder. Prios encode
  //      the old else-chain order exactly (partner > claim-crew > prospect >
  //      shakedown > patch-in > runs-with > payroll > sell > hire > flirt > talk).
  I.register("ped:civ", { id: "ped-roll", slot: "k", prio: 60, canShow: (p) => inMyGang(p), label: (p) => nm(p) + ", roll with me", onSelect: (p) => { p.companion = true; p.guard = null; p.rage = null; CBZ.city.note(nm(p) + " falls in.", 1.4); } });
  I.register("ped:civ", {
    id: "ped-crew-favor", slot: "k", prio: 50, canShow: (p) => crewmate(p),
    label: (p) => (CBZ.cityCanBefriend && CBZ.cityCanBefriend(p) && CBZ.cityDoFavor) ? "Do " + nm(p) + " a favor 🤝" : "Talk to " + nm(p),
    onSelect: (p) => { if (CBZ.cityCanBefriend && CBZ.cityCanBefriend(p) && CBZ.cityDoFavor) CBZ.cityDoFavor(p); else { if (CBZ.cityMeet) CBZ.cityMeet(p); talk(); } },
  });
  I.register("ped:civ", {
    id: "ped-propose", slot: "k", prio: 45, canShow: (p) => p === g.cityPartner,
    label: (p) => (g.citySpouse ? "Sweet-talk " + nm(p) : "Propose to " + nm(p) + " 💍"),
    onSelect: (p) => (g.citySpouse ? talk() : CBZ.cityPropose(p)),
  });
  // a rival whose BOSS you dropped: claim the whole crew
  I.register("ped:civ", {
    id: "ped-claim-crew", slot: "k", prio: 44,
    canShow: (p) => !!(p.gang && CBZ.cityGangById && CBZ.cityGangById(p.gang) && CBZ.cityGangById(p.gang).bossDead && CBZ.cityPlayerGangBossKilled),
    label: (p) => "Claim the " + p.gang + " 👑",
    onSelect: (p) => { const rec = CBZ.cityGangById(p.gang); CBZ.cityPlayerGangBossKilled(rec); CBZ.city.note("Their boss is gone — the crew's yours to claim. · O", 2.2); },
  });
  // PROSPECT / JOIN this ped's crew — the PRIMARY progression path, ranked
  // above the generic recruit/flirt/talk verbs. The label walks the courtship:
  // Prospect → Do-a-favor → Get-initiated.
  I.register("ped:civ", {
    id: "ped-prospect", slot: "k", prio: 43, canShow: (p) => !!joinableGangOf(p),
    label: function (p) {
      const rec = joinableGangOf(p);
      const courting = myProspectStanding() > 0 || (CBZ.cityProspectTask && CBZ.cityProspectTask());
      if (myProspectStanding() >= 1) return "Get initiated with " + nm(p);
      if (courting && CBZ.cityCanBefriend && CBZ.cityCanBefriend(p)) return "Do " + nm(p) + " a favor 🤝";
      return "Prospect the " + ((rec && rec.name) || "crew") + " 🩸";
    },
    onSelect: function (p) {
      const rec = joinableGangOf(p);
      const courting = myProspectStanding() > 0 || (CBZ.cityProspectTask && CBZ.cityProspectTask());
      if (myProspectStanding() >= 1 || (courting && CBZ.cityCanBefriend && CBZ.cityCanBefriend(p))) { prospectOrWork(p); return; }
      if (rec && CBZ.cityProspectGang) CBZ.cityProspectGang(rec);
    },
  });
  // a feared ped hands over cash without a fight
  I.register("ped:civ", { id: "ped-shakedown", slot: "k", prio: 42, bad: true, canShow: (p) => fearsYou(p), label: (p) => "Shake " + nm(p) + " down 💵", onSelect: (p) => demandRansom(p) });
  I.register("ped:civ", {
    id: "ped-patch-in", slot: "k", prio: 41,
    canShow: (p) => tightWithYou(p) && !p.gang && CBZ.cityPlayerGangExists && CBZ.cityPlayerGangExists() && !p.recruited && !!CBZ.cityRecruit,
    label: (p) => "Patch " + nm(p) + " in 🤝",
    onSelect: (p) => { CBZ.cityRecruit(p); if (CBZ.cityPlayerGangEnlist && p.recruited) CBZ.cityPlayerGangEnlist(p, "soldier"); },
  });
  I.register("ped:civ", { id: "ped-runs-with", slot: "k", prio: 40, canShow: (p) => tightWithYou(p) && !p.recruited && !p.gang, label: (p) => nm(p) + " runs with you 🤝", onSelect: (p) => CBZ.cityRecruit && CBZ.cityRecruit(p) });
  // recruit straight into YOUR founded gang
  I.register("ped:civ", {
    id: "ped-payroll", slot: "k", prio: 39,
    canShow: (p) => !!(CBZ.cityPlayerGangExists && CBZ.cityPlayerGangExists() && !p.recruited && !p.gang && !hatesYou(p) && canAfford100()),
    label: (p) => "Put " + nm(p) + " on the payroll 🔫",
    onSelect: (p) => { CBZ.cityRecruit(p); if (CBZ.cityPlayerGangEnlist && p.recruited) CBZ.cityPlayerGangEnlist(p, "soldier"); },
  });
  I.register("ped:civ", { id: "ped-sell", slot: "k", prio: 38, bad: true, role: "dealer", needsItem: drugIn, label: (p) => "Sell " + nm(p) + " product", onSelect: (p) => CBZ.cityDealTo(p) });
  I.register("ped:civ", {
    id: "ped-hire", slot: "k", prio: 37,
    canShow: (p) => !p.recruited && !p.gang && !hatesYou(p) && canAfford100(),
    label: (p) => "Hire " + nm(p) + " 🔫", onSelect: (p) => CBZ.cityRecruit(p),
  });
  I.register("ped:civ", { id: "ped-flirt", slot: "k", prio: 36, canShow: (p) => !hatesYou(p) && CBZ.cityIsRomance && CBZ.cityIsRomance(p), label: (p) => "Chat " + nm(p) + " up 💕", onSelect: (p) => CBZ.cityFlirt(p) });
  I.register("ped:civ", { id: "ped-talk", slot: "k", prio: 5, label: (p) => "Talk to " + nm(p), onSelect: (p) => { if (CBZ.cityMeet) CBZ.cityMeet(p); talk(); } });

  // ---- LIVING PED, slot L ----
  I.register("ped:civ", { id: "ped-talk-gang", slot: "l", prio: 60, canShow: (p) => inMyGang(p), label: (p) => "Talk to " + nm(p), onSelect: (p) => { if (CBZ.cityMeet) CBZ.cityMeet(p); talk(); } });
  I.register("ped:civ", { id: "ped-leave-crew", slot: "l", prio: 50, bad: true, canShow: (p) => crewmate(p), label: "Leave the crew", onSelect: () => CBZ.cityLeaveGang && CBZ.cityLeaveGang() });
  I.register("ped:civ", { id: "ped-pickpocket", slot: "l", prio: 10, bad: true, label: (p) => "Pick " + nm(p) + "'s pocket", onSelect: (p) => pickpocket(p) });

  // ---- COPS: the menu is built from the SITUATION, not a fixed list ----
  // surrender is also live whenever a cop is mid-CHALLENGE (police.js
  // arrest-first stamps c._challenged) — the FREEZE hint points here.
  I.register("ped:cop", { id: "cop-surrender", slot: "i", canShow: (c, ctx) => ctx.wanted >= 1 || !!(c && c._challenged && !c.dead), label: "Put your hands up — surrender", onSelect: (c) => copSurrender(c) });
  I.register("ped:cop", { id: "cop-alibi", slot: "j", canShow: (c, ctx) => ctx.wanted >= 1 && ctx.wanted <= 2, label: "Give the officer an alibi", onSelect: (c) => copAlibi(c) });
  I.register("ped:cop", { id: "cop-directions", slot: "k", canShow: (c, ctx) => ctx.wanted < 1, label: (c) => "Ask " + c.name + " for directions", onSelect: () => talk() });
  // the design rule: there's ALWAYS a malicious option — here, assault
  I.register("ped:cop", { id: "cop-punch", slot: "l", bad: true, label: (c) => "Sucker-punch " + c.name, onSelect: (c) => copAssault(c) });

  // ---- VENDOR COUNTER ----
  // CONTEXTUAL VERBS: the old flat "Shop here" said nothing about WHY you'd
  // walk up to THIS counter. VERB[kind] answers it — the action's verb (E
  // primary) + a one-line reason the player reads under the cursor — for all
  // 26 storefront kinds. `rich:true` marks the six trades that get their own
  // in-world, self-prompting module (jewelry/pawn/bank/clothing/realtor/guns):
  // when that module is LIVE the counter verb hides (the module owns the
  // walk-up), but until it's wired the verb still shows and falls back to the
  // text menu — never a dead counter. Verbs are grounded in what each kind
  // actually sells (shops.js services()): a pawnbroker offers CASH for your
  // haul + loans on collateral; the jeweler is RETAIL bling; the gun counter
  // is the armoury; the bank is the vault; realty is the listings book.
  const VERB = {
    guns:        { verb: "Browse the gun counter",      sub: "pistols · rifles · ammo",                 rich: true },
    jewelry:     { verb: "Browse the jewelry cases",    sub: "chains · watches · ice — retail",          rich: true },
    pawn:        { verb: "Step up to the pawn window",  sub: "cash for your haul · loans on collateral", rich: true },
    bank:        { verb: "Step to the teller",          sub: "deposit · withdraw · wire",                rich: true },
    clothing:    { verb: "Browse the racks",            sub: "fits · drip · change in back",             rich: true },
    realtor:     { verb: "Talk to the realtor",         sub: "buy property · listings book",             rich: true },

    gas:         { verb: "Pay at the pump",             sub: "snacks · top off the tank",                rich: false },
    drugs:       { verb: "Cop from the trap",           sub: "product · turn dealer",                    rich: false },
    food:        { verb: "Order at the counter",        sub: "hot plate — fill up",                      rich: false },
    bar:         { verb: "Bar up",                       sub: "drinks · run the night crew",              rich: false },
    hardware:    { verb: "Hit the hardware counter",    sub: "tools · crowbar · picks · medkit",         rich: false },
    gym:         { verb: "Sign in at the gym",          sub: "train HP · fight card",                    rich: false },
    security:    { verb: "Ask about contracts",         sub: "gear · apply: security guard",             rich: false },
    hospital:    { verb: "Check in at the desk",        sub: "patch up · heal to full",                  rich: false },
    barber:      { verb: "Take the chair",              sub: "fresh cut · lineup",                       rich: false },
    electronics: { verb: "Browse electronics",          sub: "phone · upgrades · gadgets",               rich: false },
    carlot:      { verb: "Talk to the car salesman",    sub: "buy a ride · open a resale yard",          rich: false },
    chop:        { verb: "See the chop shop man",       sub: "drive a hot car into the bay",             rich: false },
    modshop:     { verb: "Pull into the mod garage",     sub: "respray · armor · booster · turret · rockets", rich: false },
    casino:      { verb: "Hit the cage",                sub: "tables · sportsbook · betting",            rich: false },
    raceway:     { verb: "Check the race board",        sub: "legal · street · drag",                    rich: false },
    arena:       { verb: "Sign the fight card",         sub: "boxing · MMA",                             rich: false },
    paintball:   { verb: "Book a paintball match",      sub: "team match board",                         rich: false },
    transit:     { verb: "Buy a ticket",                sub: "bus · train routes",                       rich: false },
    cityhall:    { verb: "See the clerk",               sub: "permits · politics · civic contracts",     rich: false },
    airfield:    { verb: "See the dispatcher",          sub: "air support · emergency contracts",        rich: false },
    racepark:    { verb: "Place a wager",               sub: "horse · greyhound betting",                rich: false },
  };
  // is this kind's dedicated self-prompting module live? (mirrors the gun-wall
  // feature-detect). When live, the counter verb steps aside for that module.
  function richModuleLive(lot) {
    if (!lot) return false;
    switch (lot.kind) {
      case "guns":     return !!(CBZ.cityGunWallLive  && CBZ.cityGunWallLive(lot));
      case "jewelry":  return !!(CBZ.cityJewelryLive  && CBZ.cityJewelryLive(lot));
      case "pawn":     return !!(CBZ.cityPawnLive     && CBZ.cityPawnLive(lot));
      case "bank":     return !!(CBZ.cityBankLive     && CBZ.cityBankLive(lot));
      case "clothing": return !!(CBZ.cityClothingLive && CBZ.cityClothingLive(lot));
      case "realtor":  return !!(CBZ.cityRealtyLive   && CBZ.cityRealtyLive(lot));
      default:         return false;
    }
  }
  // the kind of the lot a vendor is keeping (lot carries .kind; degrade safe).
  function vendorKind(v) { return (v && v.vendor && v.vendor.kind) || ""; }
  CBZ.cityShopVerb = function (kind) { return VERB[kind] || null; };   // shared lookup (HUD / other verbs may want it)

  I.register("ped:vendor", {
    id: "vendor-shop", slot: "e",
    // hide ONLY when a rich kind's own in-world module has taken over the
    // walk-up; otherwise this counter is always offered (text-menu fallback).
    canShow: (v) => !!v.vendor && !v.vendor.demolished && !richModuleLive(v.vendor),
    label: (v) => { const d = VERB[vendorKind(v)]; return d ? d.verb : "Shop here"; },
    sub:   (v) => { const d = VERB[vendorKind(v)]; return d ? d.sub : ""; },
    onSelect: (v) => CBZ.cityOpenShop(v.vendor),
  });
  I.register("ped:vendor", { id: "vendor-rob", slot: "i", bad: true, canShow: (v) => !!v.vendor && !v.vendor.demolished, label: "Rob the register", onSelect: (v) => robRegister(v) });
  I.register("ped:vendor", { id: "vendor-talk", slot: "j", canShow: (v) => !!v.vendor && !v.vendor.demolished, label: "Talk to the clerk", onSelect: () => CBZ.city.note("“Welcome in. Take a look around.”", 1.6) });

  // ---- CORPSE: take the fit (loot is automatic — see the walk-over loop) ----
  I.register("corpse", {
    id: "corpse-clothes", slot: "i", bad: true,
    label: function (b) { const fit = CBZ.cityOutfitOf ? CBZ.cityOutfitOf(b) : null; return "Take their clothes" + (fit ? " — " + fit.name : ""); },
    onSelect: function (b) { CBZ.cityOutfitSwapWithCorpse && CBZ.cityOutfitSwapWithCorpse(b); },
  });

  // ---- CORPSE: strip their ARMOR (cop/SWAT plate carrier, riot helmet). Mirrors
  //      the clothes-swap above but routes through the armor system (armor.js). It
  //      is DELIBERATE (its own slot, not the walk-over auto-loot) — you crouch and
  //      peel the vest off. canShow is fully feature-detected: the action vanishes
  //      whole if the armor module isn't loaded, the body never carried armor, or
  //      it's already been taken. ----
  function corpseArmorKitName(b) {
    const loot = b && b._armorLoot;
    if (!loot) return "";
    const KITS = CBZ.ARMOR_KITS || null;
    // _armorLoot may be a kit-id, a {chest,head} record, or already a name
    let id = loot;
    if (loot && typeof loot === "object") id = (loot.chest != null) ? loot.chest : (loot.id != null ? loot.id : loot.name);
    const k = (KITS && id != null) ? KITS[id] : null;
    return (k && (k.name || k.short)) || (typeof id === "string" ? id : "armor");
  }
  I.register("corpse", {
    id: "corpse-armor", slot: "k", bad: true,
    canShow: function (b) {
      return g.mode === "city" && !!b && !!b._armorLoot && !b._armorTaken && !!CBZ.cityLootArmorFromCorpse;
    },
    label: function (b) { const nm = corpseArmorKitName(b); return "Take their armor" + (nm ? " — " + nm : ""); },
    onSelect: function (b) {
      if (!b || b._armorTaken || !CBZ.cityLootArmorFromCorpse) return;
      const took = CBZ.cityLootArmorFromCorpse(b);   // equips it onto the player + returns what was taken
      b._armorTaken = true;
      const nm = corpseArmorKitName(b) || "their armor";
      if (CBZ.city && CBZ.city.note) CBZ.city.note(took === false ? "Nothing to strip." : "🛡 Stripped " + nm + " — armor equipped.", 1.8);
    },
  });

  // ---- CARS (the old F key, surfaced): tap E gets in, HOLD E jacks a driver ----
  // _cineLocked: an authored scene car (city/cinematics.js) — its seats are the
  // scene's own labeled choices, never a boost/get-in target.
  I.register("vehicle", {
    id: "car-get-in", slot: "e", canShow: (car) => !car.npcDriver && !car._cineLocked && (car.owned || car.stolen),
    label: (car) => "Get in" + (car.owned ? " your ride" : ""), onSelect: (car) => CBZ.cityEnterVehicle(car),
  });
  I.register("vehicle", {
    id: "car-boost", slot: "e", bad: true, canShow: (car) => !car.npcDriver && !car._cineLocked && !car.owned && !car.stolen,
    label: "Boost it", onSelect: (car) => CBZ.cityEnterVehicle(car),
  });
  // someone's behind the wheel: a HOLD — you rip the door open and drag them out
  I.register("vehicle", {
    id: "car-jack", slot: "e", hold: true, bad: true, canShow: (car) => !!car.npcDriver,
    label: "Drag the driver out", onSelect: (car) => CBZ.cityEnterVehicle(car),
  });
  I.register("vehicle:inside", { id: "car-out", slot: "e", canShow: (car, ctx) => ctx.driving && ctx.vehicle === car, label: "Step out", onSelect: () => CBZ.cityExitVehicle() });
  // HAIL-A-CAB: behind the wheel, a waiting fare in reach → pick them up. The WHY:
  // rideshare is a driving job — you pull over for a rider, not press a menu. Only
  // shows when a gig system is live AND a flagged fare is actually waiting nearby.
  I.register("vehicle:inside", {
    id: "car-pickup-fare", slot: "i",
    canShow: (car, ctx) => !!gig() && !!gigWaitingFare(ctx.pos.x, ctx.pos.z),
    label: "Pick up the fare 🚕",
    onSelect: (car, ctx) => { const p = gigWaitingFare(ctx.pos.x, ctx.pos.z); if (p) gigHailFare(p); },
  });

  // ---- YOUR POCKETS (the no-target fallback): old bare-E eat + X drugs ----
  I.register("self", {
    id: "self-eat", slot: "e", needsItem: foodIn,
    label: (t, ctx) => "Eat the " + foodIn(ctx),
    onSelect: function (t, ctx) { const food = foodIn(ctx); if (food && CBZ.cityEat) CBZ.cityEat(food); },
  });
  // THE GIG APP no longer rides the pockets card (it was the always-open
  // "Open the gig app" clutter, and grabbing slot "i" stole [I] from the
  // inventory). It lives in the phone — [P] → Gig Work — mixed in with the
  // other phone services, where a dispatcher app belongs.

  // ---- GIG PICKUP / DROP-OFF ZONE: the in-world hand-off spots that drive the
  //      loop. One zone target, slot E. canShow flips its label between "grab the
  //      bag / load the shipment" (at the pickup) and "drop off / hand over" (at
  //      the dropoff). Both call gigs.js's advance. Feature-detected end to end. ----
  I.registerZone({
    id: "zone-gig", kind: "gig", prio: 9, driving: false,
    find: function (px, pz) {
      if (!gig() || !gigActive()) return null;
      if (!gigAtPickup() && !gigAtDropoff()) return null;
      const a = gigActive();
      if (!a._izTarget) a._izTarget = { x: px, z: pz, gig: a };
      // keep the wrapper near the player so the registry scores it as in-reach
      a._izTarget.x = px; a._izTarget.z = pz; a._izTarget.gig = a;
      return a._izTarget;
    },
    options: [{
      id: "gig-handoff", slot: "e",
      label: function () { const a = gigActive(); return gigAtDropoff() ? gigDropLabel(a) : gigPickupLabel(a); },
      onSelect: function () { if (!gigAdvance() && CBZ.city && CBZ.city.note) CBZ.city.note("…", 0.8); },
    }],
  });

  // The "Do the COKE/WEED 🌀" pocket auto-button was REMOVED (owner: a real
  // drug-use would be opt-in roleplay, not a button that pops into your pockets
  // panel and breaks the fourth wall). Carried drugs are still sellable/loot;
  // there's just no auto-consume option surfaced here. Eating (self-eat above)
  // and pickpocketing stay.

  // ---- auto-loot: walk over (or drive over) a body and it's looted, no key.
  //      Runs on foot AND while driving, every frame, ignoring the menu state. ----
  const LOOT_R = 2.6;
  CBZ.onUpdate(38, function () {
    if (g.mode !== "city" || g.state !== "playing" || CBZ.player.dead) return;
    if (!CBZ.cityNearestCorpse || !CBZ.cityLootCorpse) return;
    const px = CBZ.player.pos.x, pz = CBZ.player.pos.z;
    let c;
    // loop in case several bodies are piled within reach (e.g. a car plough)
    while ((c = CBZ.cityNearestCorpse(px, pz, LOOT_R))) {
      const dl = CBZ.cityLootCorpse(c);    // routes cash + items (incl. valuables) into inv
      if (!dl) break;                       // looted() flips so the next call skips it
      // SURFACE THE JACKPOT: cityLootCorpse already added every item to inventory
      // (no double-add here). If the body was carrying a high-value valuable, fire a
      // satisfying headline so the score feels great. Bounty cash, if any, was already
      // paid in cityKillPed — we only surface the loot, never re-pay it.
      if (Array.isArray(dl.items) && dl.items.length) {
        let topName = "", topVal = 0;
        for (const it of dl.items) { const v = itemVal(it); if (v > topVal) { topVal = v; topName = it; } }
        if (topName && (isLuxe(topName) || topVal >= 20000) && CBZ.city && CBZ.city.big) {
          CBZ.city.big("💎 You looted a " + topName + " — " + money(pawnPay(topName)) + " at the pawn!");
          if (CBZ.city.addRespect) CBZ.city.addRespect(isLuxe(topName) ? 6 : 2);
        }
      }
    }
  });
})();
