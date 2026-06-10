/* ============================================================
   city/interact.js — the contextual street interactions, shown in the
   shared #interact HUD panel (the same one the jail uses). Walk up to a
   person, body, gang stash, car or shop and a clear option list pops up.

   Rules the design follows:
     • There is ALWAYS a malicious option (Mug / Steal car / Loot / Rob).
     • Point a gun at someone (gun equipped + they're in your sights) and
       the panel becomes a HOSTAGE menu — different DEMANDS (rob, ransom,
       human shield, execute).
     • Keys: E = shop / eat / loot, I J K L = the contextual options,
       X = do drugs.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const g = CBZ.game;

  const REACH = 3.8;
  let panel, nameEl, noteEl, optsEl;
  let current = null, currentKey = "", currentOpts = [], detAcc = 0;

  function dom() {
    if (panel) return;
    panel = document.getElementById("interact");
    nameEl = document.getElementById("interactName");
    noteEl = document.getElementById("interactNote");
    optsEl = document.getElementById("interactOpts");
    // tap/click the rows (mobile + mouse), same as the jail panel
    if (optsEl) optsEl.addEventListener("click", function (e) {
      if (g.mode !== "city" || CBZ.player.driving) return;
      const row = e.target.closest && e.target.closest(".iopt");
      if (!row || row.dataset.i == null) return;
      const o = currentOpts[+row.dataset.i];
      if (o && o.fn) o.fn();
    });
  }
  // NOTE: #interact's base style is opacity:0 (the jail's fade-in); only the
  // `.show` class lifts it to opacity:1. The city must toggle that class too,
  // or the panel is display:block but fully TRANSPARENT — i.e. "no popup".
  function hide() { dom(); if (panel) { panel.style.display = "none"; panel.classList.remove("show"); } current = null; currentKey = ""; currentOpts = []; }
  function show() { dom(); if (panel) { panel.style.display = "block"; panel.classList.add("show"); } }
  function release() { dom(); if (panel) { panel.style.display = ""; panel.classList.remove("show"); } current = null; currentKey = ""; currentOpts = []; }

  function dist(a, x, z) { return Math.hypot(a.pos.x - x, a.pos.z - z); }
  function nearest(list, x, z, test) { let best = null, bd = REACH; for (const p of list) { if (!test(p)) continue; const d = dist(p, x, z); if (d < bd) { bd = d; best = p; } } return best; }

  function armedGun() { const it = CBZ.cityCurrentWeapon && CBZ.cityCurrentWeapon(); return it && it.gun ? it : null; }
  // the ped you're "pointing your gun at": in the forward cone, close-ish
  function aimedPed(px, pz) {
    if (!armedGun()) return null;
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

  // ---- CORPSE WARDROBE: a body whose CLOTHES you can take (city/outfits.js).
  // Loot is automatic (walk over it); the FIT is a choice — swap outfits with
  // the dead. WHY: a cop's uniform makes the law read you as one of theirs, a
  // crew's colors flip turf hostility, a tycoon's tuxedo is pure worn status.
  // Scans full-rig bodies only (peds + fallen officers — both keep skinSlots).
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
  function bodyOpts(b, fit) {
    return [{
      label: "Take their clothes" + (fit ? " — " + fit.name : ""), key: "i", bad: true,
      fn: () => { if (CBZ.cityOutfitSwapWithCorpse(b)) hide(); },
    }];
  }

  // ---- valuables / pawn helpers (Tasks 1-4) -------------------------------
  // Everything reads from the shared econ catalog so the player can judge a
  // haul: a Patek (clean $350k) pawns FAT, a Wallet ($40) is scraps. All
  // feature-detected — if Agent 1/2's econ helpers are absent we degrade.
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

  // ---- gang membership / relationship helpers (all feature-detected) ----
  // The I/J/K/L panel has a HARD cap of 4 slots; everything funnels through cap4
  // so no situation can ever overflow the row list.
  function cap4(opts) { return opts.length > 4 ? opts.slice(0, 4) : opts; }

  // ---- THE CLUB (the velvet rope): the end of the money→clothes→drip loop ----
  // buildings.js stamps lot.building.club = { bouncerSpot, ropePost, door, ... }
  // on exactly one lot (CBZ.city.clubLot). When you walk up to the rope we offer
  // a "step to the bouncer" verb that hands off to club.js's gate check — the
  // bouncer reads CBZ.cityPlayerDrip() vs CBZ.CITY.CLUB_DRIP to admit/reject you.
  // All feature-detected: no club lot (or no club.js yet) → the verb never shows.
  function clubInfo() {
    const lot = CBZ.city && CBZ.city.clubLot;
    const c = lot && lot.building && lot.building.club;
    // club is the structured object (not just the boolean flag); needs a spot.
    if (c && typeof c === "object" && (c.bouncerSpot || c.ropePost)) return c;
    return null;
  }
  // the world point you "step to" — the rope / bouncer's post.
  function clubSpot(c) { return (c && (c.bouncerSpot || c.ropePost)) || null; }
  // are you close enough to the rope to talk to the bouncer? (a touch wider than
  // REACH so the queue lane / rope reads as one approachable zone).
  const CLUB_REACH = 4.6;
  function nearClubSpot(px, pz) {
    const c = clubInfo(); if (!c) return null;
    const s = clubSpot(c); if (!s) return null;
    return Math.hypot(px - s.x, pz - s.z) <= CLUB_REACH ? c : null;
  }
  // hand off to club.js's entry/gate function — try the agreed global first, then
  // a couple of sensible aliases so we coordinate cleanly via whatever club.js
  // actually exposes. If club.js isn't loaded yet, say so rather than no-op.
  function clubTryEnter() {
    const fn = CBZ.cityClubTryEnter || CBZ.cityClubApproach || CBZ.cityClubEnter || CBZ.cityClubGate;
    if (typeof fn === "function") { fn(); return; }
    // graceful fallback: at least describe the gate so the loop reads even before
    // club.js lands (the drip number is the thing that matters at the rope).
    const drip = CBZ.cityPlayerDrip ? CBZ.cityPlayerDrip() : 0;
    const need = (CBZ.CITY && CBZ.CITY.CLUB_DRIP) || 30;
    if (drip >= need) CBZ.city.note("The bouncer sizes up your fit and unhooks the rope…", 2.2);
    else CBZ.city.note("“Not in those rags.” The bouncer waves you off — come back sharper.", 2.6);
  }
  // the one-verb panel at the rope (kept to a single slot — never overflows cap4).
  function clubOpts() {
    return [{ label: "Step to the bouncer 🪩", key: "i", fn: clubTryEnter }];
  }
  function clubNote() {
    const drip = CBZ.cityPlayerDrip ? CBZ.cityPlayerDrip() : 0;
    const need = (CBZ.CITY && CBZ.CITY.CLUB_DRIP) || 30;
    return "Velvet rope · " + (drip >= need ? "your fit gets you in" : "not dressed for it yet");
  }

  // your CURRENT membership in an NPC crew (you as a member, not the boss), or null.
  function myMemb() { return (CBZ.cityMembership && CBZ.cityMembership()) || null; }
  // the human rank label for your membership (Prospect / Soldier / …).
  function myRankName() { const m = myMemb(); if (!m) return ""; return CBZ.cityRankName ? CBZ.cityRankName(m.rank) : m.rank; }
  // a gang record by id (feature-detected).
  function gangRec(id) { return (id && CBZ.cityGangById) ? CBZ.cityGangById(id) : null; }
  // are you a PROSPECT for any crew right now? returns its standing 0..1 (or -1).
  function myProspectStanding() { return CBZ.cityProspectStanding ? CBZ.cityProspectStanding() : -1; }

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

  // ---- option builders (each option: {label, key, fn, bad}) ----
  function hostageOpts(p) {
    return [
      { label: "Rob at gunpoint", key: "i", bad: true, fn: () => { mug(p); } },
      { label: "Take hostage", key: "j", bad: true, fn: () => CBZ.cityTakeHostage && CBZ.cityTakeHostage(p) },
      { label: "Demand ransom", key: "k", bad: true, fn: () => demandRansom(p) },
      { label: "Execute", key: "l", bad: true, fn: () => execute(p) },
    ];
  }
  function pedOpts(p) {
    const nm = p.name || "them";
    const econ = CBZ.cityEcon, inv = g.cityInv || {};
    const hasDrugs = Object.keys(inv).some((k) => econ.ITEMS[k] && econ.ITEMS[k].tag === "drug");
    const inMyGang = CBZ.cityPlayerGangIsMember && CBZ.cityPlayerGangIsMember(p);

    // ---- YOUR gang member: command/promote them instead of robbing them ----
    if (inMyGang) {
      const opts = [];
      opts.push({ label: (p.rank === "lt" ? nm + " (Lieutenant)" : "Promote " + nm + " → Lt."), key: "i", fn: () => (p.rank === "lt" ? talk() : CBZ.cityPlayerGangPromote(p)) });
      opts.push({ label: nm + ", hold this corner", key: "j", fn: () => { if (CBZ.cityPlayerGangOrder) { p.companion = false; p.guard = { x: CBZ.player.pos.x, z: CBZ.player.pos.z }; p.homeGuard = { x: CBZ.player.pos.x, z: CBZ.player.pos.z }; p.rage = null; p.target.set(p.pos.x, 0, p.pos.z); CBZ.city.note(nm + " holds this spot.", 1.6); } } });
      opts.push({ label: nm + ", roll with me", key: "k", fn: () => { p.companion = true; p.guard = null; p.rage = null; CBZ.city.note(nm + " falls in.", 1.4); } });
      opts.push({ label: "Talk to " + nm, key: "l", fn: () => { if (CBZ.cityMeet) CBZ.cityMeet(p); talk(); } });
      return cap4(opts);
    }

    // ---- relationship read: bias the friendly slot by how this ped feels about
    //      you. A loyal/respectful ped opens up (a tip, runs with you); a feared
    //      one folds and hands over cash; a grudge-holder refuses anything warm.
    const rel = CBZ.cityRel ? CBZ.cityRel(p) : null;
    const hatesYou = rel && (rel.grudge > 45 || (CBZ.cityBond && CBZ.cityBond(p) < -0.3));
    const fearsYou = rel && rel.fear > 55 && !(rel.respect > rel.fear);
    const tightWithYou = rel && (rel.loyalty > 55 || rel.respect > 50 || (CBZ.cityBond && CBZ.cityBond(p) > 0.4));

    // ---- you're a PATCHED-IN member of an NPC crew, and so is this ped (your
    //      crew-mate): put in work to climb, or peel off and leave the crew. ----
    const memb = myMemb();
    if (memb && p.gang && p.gang === memb.gangId) {
      const opts = [];
      opts.push({ label: "Swing on " + nm, key: "i", bad: true, fn: () => attack(p) });   // a malicious option always exists
      opts.push({ label: "Put in work with " + nm, key: "j", fn: () => prospectOrWork(p) });
      // relationship verb over plain Talk: do a crew-mate a favor to build standing
      if (CBZ.cityCanBefriend && CBZ.cityCanBefriend(p) && CBZ.cityDoFavor)
        opts.push({ label: "Do " + nm + " a favor 🤝", key: "k", fn: () => CBZ.cityDoFavor(p) });
      else
        opts.push({ label: "Talk to " + nm, key: "k", fn: () => { if (CBZ.cityMeet) CBZ.cityMeet(p); talk(); } });
      opts.push({ label: "Leave the crew", key: "l", bad: true, fn: () => CBZ.cityLeaveGang && CBZ.cityLeaveGang() });
      return cap4(opts);
    }

    const opts = [{ label: "Mug " + nm, key: "i", bad: true, fn: () => mug(p) }];
    opts.push({ label: "Swing on " + nm, key: "j", bad: true, fn: () => attack(p) });
    if (p === g.cityPartner) opts.push({ label: g.citySpouse ? "Sweet-talk " + nm : "Propose to " + nm + " 💍", key: "k", fn: () => (g.citySpouse ? talk() : CBZ.cityPropose(p)) });
    // ---- a rival whose BOSS you dropped: claim the whole crew ----
    else if (p.gang && CBZ.cityGangById && CBZ.cityGangById(p.gang) && CBZ.cityGangById(p.gang).bossDead && CBZ.cityPlayerGangBossKilled)
      opts.push({ label: "Claim the " + p.gang + " 👑", key: "k", fn: () => { const rec = CBZ.cityGangById(p.gang); CBZ.cityPlayerGangBossKilled(rec); CBZ.city.note("Their boss is gone — the crew's yours to claim. · O", 2.2); } });
    // ---- PROSPECT / JOIN this ped's crew (you're a free agent on/near their
    //      turf). This is the PRIMARY progression path, so it's ranked above the
    //      generic recruit/flirt/talk verbs (and the i/j/l slots keep it from
    //      being sliced by cap4). ----
    else if (joinableGangOf(p)) {
      const rec = joinableGangOf(p);
      const courting = myProspectStanding() > 0 || (CBZ.cityProspectTask && CBZ.cityProspectTask());
      if (myProspectStanding() >= 1)
        opts.push({ label: "Get initiated with " + nm, key: "k", fn: () => prospectOrWork(p) });
      else if (courting && CBZ.cityCanBefriend && CBZ.cityCanBefriend(p))
        // already prospecting this crew: do a FAVOR for this member to EARN STANDING
        opts.push({ label: "Do " + nm + " a favor 🤝", key: "k", fn: () => prospectOrWork(p) });
      else
        opts.push({ label: "Prospect the " + (rec.name || "crew") + " 🩸", key: "k", fn: () => CBZ.cityProspectGang(rec) });
    }
    // ---- a feared ped hands over cash without a fight; a loyal/respectful one
    //      runs with you or shares a tip; a grudge-holder gets only plain talk. ----
    else if (fearsYou) opts.push({ label: "Shake " + nm + " down 💵", key: "k", bad: true, fn: () => demandRansom(p) });
    else if (tightWithYou && !p.gang && CBZ.cityPlayerGangExists && CBZ.cityPlayerGangExists() && !p.recruited && CBZ.cityRecruit)
      opts.push({ label: "Patch " + nm + " in 🤝", key: "k", fn: () => { CBZ.cityRecruit(p); if (CBZ.cityPlayerGangEnlist && p.recruited) CBZ.cityPlayerGangEnlist(p, "soldier"); } });
    else if (tightWithYou && !p.recruited && !p.gang) opts.push({ label: nm + " runs with you 🤝", key: "k", fn: () => CBZ.cityRecruit && CBZ.cityRecruit(p) });
    // ---- recruit straight into YOUR founded gang ----
    else if (CBZ.cityPlayerGangExists && CBZ.cityPlayerGangExists() && !p.recruited && !p.gang && !hatesYou && ((g.respect || 0) >= 5 || (CBZ.city.canAfford && CBZ.city.canAfford(100))))
      opts.push({ label: "Put " + nm + " on the payroll 🔫", key: "k", fn: () => { CBZ.cityRecruit(p); if (CBZ.cityPlayerGangEnlist && p.recruited) CBZ.cityPlayerGangEnlist(p, "soldier"); } });
    else if (g.career === "dealer" && hasDrugs) opts.push({ label: "Sell " + nm + " product", key: "k", bad: true, fn: () => CBZ.cityDealTo(p) });
    else if (!p.recruited && !p.gang && !hatesYou && ((g.respect || 0) >= 5 || (CBZ.city.canAfford && CBZ.city.canAfford(100)))) opts.push({ label: "Hire " + nm + " 🔫", key: "k", fn: () => CBZ.cityRecruit(p) });
    else if (!hatesYou && CBZ.cityIsRomance && CBZ.cityIsRomance(p)) opts.push({ label: "Chat " + nm + " up 💕", key: "k", fn: () => CBZ.cityFlirt(p) });
    else opts.push({ label: "Talk to " + nm, key: "k", fn: () => { if (CBZ.cityMeet) CBZ.cityMeet(p); talk(); } });
    opts.push({ label: "Pick " + nm + "'s pocket", key: "l", bad: true, fn: () => pickpocket(p) });
    return cap4(opts);
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
  function vendorOpts(v) {
    return [
      { label: "Shop here", key: "e", fn: () => CBZ.cityOpenShop(v.vendor) },
      { label: "Rob the register", key: "i", bad: true, fn: () => robRegister(v) },
      { label: "Talk to the clerk", key: "j", fn: () => CBZ.city.note("“Welcome in. Take a look around.”", 1.6) },
    ];
  }

  // ---- police: the menu is built from the SITUATION, not a fixed list. ----
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
  function copOpts(c) {
    const stars = g.wanted | 0;
    const opts = [];
    if (stars >= 1) {
      // give up: cuffed, but cooperating costs you less than getting gunned down
      opts.push({ label: "Put your hands up — surrender", key: "i", fn: () => copSurrender(c) });
      // an alibi is only plausible at low heat (you can't talk down a rampage)
      if (stars <= 2) opts.push({ label: "Give the officer an alibi", key: "j", fn: () => copAlibi(c) });
    } else {
      opts.push({ label: "Ask " + c.name + " for directions", key: "k", fn: talk });
    }
    // the design rule: there's ALWAYS a malicious option — here, assault
    opts.push({ label: "Sucker-punch " + c.name, key: "l", bad: true, fn: () => copAssault(c) });
    return opts;
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
  function demandRansom(p) {
    if (p === g.cityHostage) { CBZ.cityReleaseHostage && CBZ.cityReleaseHostage(true); return; }
    const pay = 150 + (((p.wealth || 0.3) * 900) | 0);
    p.cash = 0; p.alarmed = 8; p.fear = 10;
    CBZ.city.addCash(pay); CBZ.city.big("EXTORTED + $" + pay);
    CBZ.cityAlarm(p.pos.x, p.pos.z, 16, 1, CBZ.city.playerActor);
    CBZ.cityCrime && CBZ.cityCrime(50, { x: p.pos.x, z: p.pos.z, type: "extortion" });
    if (CBZ.sfx) CBZ.sfx("coin");
  }
  // MUG / ROBBERY — takes their cash + the loot item (via cityRobPed, Agent 2's
  // payout) AND transfers EVERY valuable they're carrying into your inventory to
  // pawn. A rich victim = a big haul (a Patek + a ring); a broke one = scraps.
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

  // ---- detection: choose what you're interacting with this frame ----
  CBZ.onUpdate(39, function (dt) {
    if (g.mode !== "city") { if (current || (panel && panel.style.display)) release(); return; }
    if (g.state !== "playing" || CBZ.player.driving || CBZ.cityMenuOpen || CBZ.player.dead) { if (current) hide(); return; }
    detAcc += dt; if (detAcc < 1 / 12) return; detAcc = 0;     // ~12 Hz is plenty for a prompt
    const px = CBZ.player.pos.x, pz = CBZ.player.pos.z;

    let target = null, opts = null, label = "", note = "", key = "";

    // 1) pointing a gun at someone → HOSTAGE demands
    const aimed = aimedPed(px, pz);
    if (aimed) {
      if (CBZ.cityMarkGunpoint) CBZ.cityMarkGunpoint(aimed, 0.55);
      target = aimed; key = "aim:" + tag(aimed); opts = hostageOpts(aimed); label = "🔫 " + aimed.name; note = "Hands up · make your demand";
    }

    // 2) a vendor counter
    if (!target) { const v = nearest(CBZ.cityPeds, px, pz, (p) => p.vendor && !p.dead); if (v) { target = v; key = "v:" + tag(v); opts = vendorOpts(v); label = v.vendor.building.name; note = "Vendor · cash register"; } }
    // 2b) THE CLUB ROPE — near the bouncer's post → a single "get in" verb that
    //    runs the drip-gated gate. Only ever shows at the club, and the key folds
    //    in your drip vs the threshold so the panel refreshes as you dress up.
    if (!target) {
      const club = nearClubSpot(px, pz);
      if (club) {
        const drip = CBZ.cityPlayerDrip ? (CBZ.cityPlayerDrip() | 0) : 0;
        const need = (CBZ.CITY && CBZ.CITY.CLUB_DRIP) || 30;
        target = club; key = "club:" + (drip >= need ? 1 : 0); opts = clubOpts();
        label = "🪩 " + ((club.name) || "The Velvet Club"); note = clubNote();
      }
    }
    // (bodies are looted AUTOMATICALLY by walking over them — see auto-loot below)
    // 4) a gang stash
    if (!target && CBZ.cityNearestStash) { const lot = CBZ.cityNearestStash(px, pz, REACH); if (lot) { target = lot; key = "s:" + lot.i + "," + lot.j; opts = [{ label: "Rob stash", key: "i", bad: true, fn: () => CBZ.cityRobStash(lot) }]; label = "🎒 Gang Stash"; note = (lot.building.gang || "gang") + " cache"; } }
    // 5) a police officer → contextual menu (surrender / alibi only when wanted)
    if (!target && CBZ.cityCops) { const cop = nearest(CBZ.cityCops, px, pz, (c) => !c.dead); if (cop) { target = cop; key = "cop:" + (g.wanted | 0) + ":" + (copHunting(cop) ? 1 : 0); opts = copOpts(cop); label = "👮 " + cop.name; note = copNote(cop); } }
    // 6) a living person — the key folds in gang/relationship CONTEXT so the
    //    option list rebuilds the moment membership, prospect standing, or this
    //    ped's standing toward you crosses a tier (otherwise it'd go stale).
    if (!target) { const p = nearest(CBZ.cityPeds, px, pz, (q) => !q.vendor && !q.dead); if (p) { target = p; key = "p:" + tag(p) + ":" + pedCtxTag(p); opts = pedOpts(p); label = ((p.nameKnown || p.recruited || p.companion || p === g.cityPartner) ? p.name : "A stranger") + (p.gang ? " (" + p.gang + ")" : ""); note = ped$(p); } }
    // 6b) a BODY whose clothes you can take (loot is automatic; the FIT is the
    //     choice — uniform/colors/tuxedo are disguise + status, see outfits.js)
    if (!target && !((g.cityOutfitChanging || 0) > 0)) {
      const b = nearestDressedBody(px, pz);
      if (b) {
        const fit = CBZ.cityOutfitOf ? CBZ.cityOutfitOf(b) : null;
        target = b; key = "body:" + tag(b); opts = bodyOpts(b, fit);
        label = "🧥 " + (b.name || "A body"); note = bodyFitNote(fit);
      }
    }
    // 6) a car you can jack
    if (!target && CBZ.cityNearestCar) { const car = CBZ.cityNearestCar(px, pz, REACH); if (car) { const cond = CBZ.cityVehicleCondition ? CBZ.cityVehicleCondition(car) : null; target = car; key = "car:" + (cond ? cond.label : ""); opts = [{ label: "Steal car [F]", key: "i", bad: true, fn: () => CBZ.cityEnterVehicle(car) }]; label = "🚗 " + (car.model ? car.model.name : "Car"); note = (cond ? cond.label + " · " : "") + "Boost it · chop shop pays by condition"; } }

    if (!target) { if (current) hide(); return; }
    // whoever the panel is offering interactions on at least turns to LOOK at
    // you while you're engaging them (city/peds.js move() honours _faceT).
    if (target.group && !target.dead && (target.kind || target.vendor)) target._faceT = 0.45;
    if (key !== currentKey) {
      current = target; currentKey = key; currentOpts = opts;
      dom();
      if (nameEl) nameEl.textContent = label;
      if (noteEl) noteEl.textContent = note;
      // same overhauled row style as the jail panel: a key chip + a clean line
      // (.iopt/.ikey/.ilab from css/hud.css). Malicious options tint red.
      if (optsEl) optsEl.innerHTML = opts.map((o, i) =>
        `<div class="iopt" data-i="${i}"><span class="ikey">${o.key.toUpperCase()}</span>` +
        `<span class="ilab"${o.bad ? " style=\"color:#ff9a9a\"" : ""}>${o.label}</span></div>`
      ).join("");
      show();
    } else if (noteEl && opts === currentOpts) { /* same target; refresh note cheaply */ if (target.pos) noteEl.textContent = note; }
  });

  function tag(p) { return (p.name || "?") + (p.gang || ""); }
  // a coarse CONTEXT fingerprint for a ped: membership state, prospect bucket,
  // and a relationship tier. Coarse on purpose so the menu rebuilds on a real
  // change, not every frame (the note still refreshes continuously below).
  function pedCtxTag(p) {
    const memb = myMemb();
    const m = memb ? (p.gang === memb.gangId ? "crew" : "mem") : "0";
    // PROSPECT state folds in the active TASK + initiation-ready flag, because all
    // three flip the OFFERED verb (Prospect → Do-a-favor → Get-initiated). The
    // task ID changes as the sequence advances, so the menu rebuilds on each step;
    // the note shows live progress continuously below.
    let pr = "P-";
    const task = CBZ.cityProspectTask && CBZ.cityProspectTask();
    if (myProspectStanding() >= 1) pr = "P9";
    else if (task) pr = "P" + (task.label ? task.label.charAt(0) : "1");   // coarse task fingerprint
    let rt = "";
    if (CBZ.cityRel) { const r = CBZ.cityRel(p); if (r) rt = (r.grudge > 45 ? "h" : r.fear > 55 ? "f" : (r.loyalty > 55 || r.respect > 50) ? "t" : "n"); }
    return m + pr + rt + (g.career || "") + (g.citySpouse ? "S" : "") + (p.recruited ? "R" : "");
  }

  addEventListener("keydown", function (e) {
    if (g.mode !== "city" || g.state !== "playing") return;
    if (CBZ.cityMenuOpen) return;
    const k = e.key.toLowerCase();
    if (k === "e" && !current) {
      const econ = CBZ.cityEcon, inv = g.cityInv || {};
      const food = Object.keys(inv).find((n) => econ.ITEMS[n] && econ.ITEMS[n].heal);
      if (food && CBZ.cityEat) { e.preventDefault(); CBZ.cityEat(food); }
      return;
    }
    if (k === "x") {
      const econ = CBZ.cityEcon, inv = g.cityInv || {};
      const drug = Object.keys(inv).find((n) => econ.ITEMS[n] && econ.ITEMS[n].tag === "drug");
      if (drug) {
        e.preventDefault();
        econ.take(drug, 1);
        const P = CBZ.player;
        P.hp = Math.min(P.maxHp || 200, P.hp + 18);
        P._boost = 16; g.hunger = Math.min(100, (g.hunger || 0) + 8);
        if (CBZ.shake) CBZ.shake(0.2);
        CBZ.city.note("You did the " + drug + "… everything feels faster. 🌀", 2.2);
        if (CBZ.cityHudDirty) CBZ.cityHudDirty();
      }
      return;
    }
    if (!current || CBZ.player.driving) return;
    const o = currentOpts.find((x) => x.key === k);
    if (o) { e.preventDefault(); o.fn(); }
  });
})();
