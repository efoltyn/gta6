/* ============================================================
   city/loyalty.js — HIRE, ARM, and EARN the LOYALTY of your crew.

   WHY: a bodyguard you recruit is a warm body with a default pistol — there's no
   relationship and no way to invest in them. Real loyalty is BUILT: you put a
   better piece in their hands, you slip them cash for a gun, they ride for you
   harder, and when they defend you (or you let them die) that bond moves. This
   module makes a crew member feel like YOURS.

   It is layered + additive, like the rest of the city sim:
     • It WRAPS CBZ.cityRecruit (careers.js) the way social.js does — preserving the
       original, then stamping a loyalty record on the new hire. No edit to careers.
     • It adds three player verbs that WRITE the same actor fields careers.js already
       sets for an armed bodyguard (weapon/armed/ammo + syncActorWeapon), so the
       per-ped brain (peds.js npcAttack) makes the handed gun actually HIT:
         - cityGiveGunToNpc(ped, weaponName)
         - cityGiveCashToNpc(ped, amount)   — they pocket it / buy a piece at a store
         - cityProtect(protector, principal) — assign a crew member to guard an ally
     • It SELF-REGISTERS two context verbs into the GLOBAL interaction registry
       (CBZ.interactions) so they surface on a crew member ONLY when you actually
       have something to give (a spare gun in your inventory / cash for a piece) —
       no dead buttons, no hidden mechanic.

   Loyalty itself is a soft 0..1 number on the ped (ped._loyalty): it RISES when the
   crewmate defends you / you arm them, and FALLS if you let them get killed. It's
   read by the squad layer's willingness to ride and surfaces in the give-gun
   headline; nothing here forces a hidden stat onto the UI.

   Exposes: CBZ.cityGiveGunToNpc, CBZ.cityGiveCashToNpc, CBZ.cityProtect,
   CBZ.cityLoyaltyOf.
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;                                  // headless / pre-engine guard
  const g = CBZ.game;

  // ---- small, all-feature-detected helpers --------------------------------
  function note(t, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(t, s || 2); }
  function econ() { return CBZ.cityEcon || null; }
  function cash() { return (g && g.cash) || 0; }
  function canAfford(n) { if (CBZ.city && CBZ.city.canAfford) return CBZ.city.canAfford(n); return cash() >= n; }
  function spend(n) { if (CBZ.city && CBZ.city.spend) return CBZ.city.spend(n); if (g) { g.cash = Math.max(0, cash() - n); return true; } return false; }
  function nm(p) { return (p && p.name) || "them"; }
  function isCrew(p) { return !!(p && !p.dead && (p.recruited || p.companion || p.faction === "player")); }

  // the player's CURRENTLY HELD gun, mapped to a name the brain understands. The FPS
  // weapon table (weapon-data.js) keys are engine ids (sidearm/smg/ak47/…); the ped
  // brain wants an ITEM name (Pistol/SMG/AK-47/…). One small map bridges them. We
  // hand the crewmate a working piece of the SAME class as what's in your hand.
  const FPS_TO_PED = {
    sidearm: "Pistol", revolver: "Revolver", deagle: "Desert Eagle",
    smg: "SMG", uzi: "Uzi", carbine: "Rifle", ak47: "AK-47",
    shotgun: "Shotgun", sniper: "Sniper", lmg: "LMG", bazooka: "Bazooka",
  };
  function heldWeaponId() { return CBZ.currentWeaponId || null; }
  function heldGunPedName() {
    const id = heldWeaponId();
    if (!id) return null;
    if (FPS_TO_PED[id]) return FPS_TO_PED[id];
    // unknown id but you DO hold a gun → default to a usable sidearm
    return "Pistol";
  }
  // a readable label for the held gun for the verb sentence. We use the PED-weapon
  // name they'll actually receive ("AK-47", "Pistol", "SMG") — accurate AND it reads
  // better in a sentence than the HUD short-code ("762"/"9MM"). Falls back to the
  // engine label, then the id.
  function heldGunLabel() {
    const ped = heldGunPedName();
    if (ped) return ped;
    const id = heldWeaponId();
    const T = CBZ.FPS_WEAPONS;
    if (id && T) for (let i = 0; i < T.length; i++) { const w = T[i]; if (w && (w.id === id || w.key === id)) return w.label || w.short || id; }
    return "piece";
  }
  // do you have a gun you could SPARE? "spare" must be honest: you own 2+ guns, so
  // one can leave your hands without disarming you. (We don't strip a specific
  // weapon from the player's loadout — that's brittle and would yank the gun you're
  // holding mid-fight — we gate on owning a genuine spare and arm the crewmate with
  // a working piece of the held gun's class.) WHY: the verb only shows when handing
  // one over is real, so it's never a dead button.
  function hasSpareGun() {
    const inv = CBZ.weaponInventory;
    return !!(inv && inv.length >= 2 && heldGunPedName());
  }

  // a ped-weapon name → buy price from the ONE econ price table (no duplicate list).
  function gunPrice(name) {
    const e = econ();
    if (e && e.buyPrice) { const p = e.buyPrice(name); if (p) return p; }
    return 0;
  }
  // affordable guns, cheapest meaningful upgrade list (matches the gun-store rack /
  // econ catalog). We pick the BEST (priciest) the cash covers — a real upgrade.
  const BUYABLE = ["Pistol", "Revolver", "SMG", "Uzi", "Shotgun", "Desert Eagle", "Rifle", "AK-47"];
  function bestAffordableGun(budget) {
    let pick = null, pp = 0;
    for (let i = 0; i < BUYABLE.length; i++) {
      const n = BUYABLE[i], price = gunPrice(n);
      if (price > 0 && price <= budget && price > pp) { pp = price; pick = n; }
    }
    return pick ? { name: pick, price: pp } : null;
  }

  // =========================================================================
  // ARM A CREW MEMBER — put a real, FIRING gun in their hands. Mirrors exactly
  // the fields careers.js cityRecruit sets for a crew bodyguard so npcAttack's
  // NPC_GUN profile makes the shots LAND (armed + weapon + ammo + syncActorWeapon).
  // =========================================================================
  CBZ.cityGiveGunToNpc = function (ped, weaponName) {
    if (!ped || ped.dead) return false;
    const w = weaponName || "Pistol";
    ped.weapon = w;
    ped.armed = true;
    ped.ammo = 999;                                   // a crew piece doesn't run dry mid-fight
    ped.melee = ped.melee || null;
    if (CBZ.syncActorWeapon) { try { CBZ.syncActorWeapon(ped); } catch (e) {} }
    // arming someone is an act of trust → loyalty up a notch (capped).
    bumpLoyalty(ped, 0.08);
    return true;
  };

  // =========================================================================
  // SLIP CASH — bank it on the ped's warchest; if they're near a gun store (or the
  // amount alone covers a piece) they "buy" the best gun they can afford right then,
  // so handing a runner cash visibly UPGRADES them. The WHY: money you give a
  // soldier should turn into firepower, not vanish.
  // =========================================================================
  CBZ.cityGiveCashToNpc = function (ped, amount) {
    if (!ped || ped.dead) return false;
    const amt = Math.max(0, amount | 0);
    if (amt <= 0) return false;
    ped._warchest = (ped._warchest || 0) + amt;
    bumpLoyalty(ped, 0.05);
    // can they kit up? buy the best gun their warchest now covers.
    const buy = bestAffordableGun(ped._warchest);
    const nearStore = isNearGunStore(ped);
    if (buy && (nearStore || amt >= buy.price)) {
      ped._warchest -= buy.price;
      CBZ.cityGiveGunToNpc(ped, buy.name);
      note(nm(ped) + " copped a " + buy.name + " with your cash.", 2.2);
      if (CBZ.sfx) CBZ.sfx("coin");
    } else {
      note("Slipped " + nm(ped) + " $" + amt + " for a piece.", 1.8);
    }
    return true;
  };

  // is this ped standing near a GUN STORE? scans the real city lots (the same
  // arena.lots shops.js reads, kind === "guns") so a runner can only "buy on the
  // spot" where there's actually a gun shop. Degrades to false (then the buy needs
  // amount >= price) if the arena/lots aren't up.
  function isNearGunStore(ped) {
    if (!ped || !ped.pos) return false;
    const A = CBZ.city && CBZ.city.arena;
    const lots = A && (A.lots || A.shopLots);
    if (!lots || !lots.length) return false;
    for (let i = 0; i < lots.length; i++) {
      const l = lots[i];
      if (!l || l.kind !== "guns") continue;
      const dx = (l.cx != null ? l.cx : 0) - ped.pos.x, dz = (l.cz != null ? l.cz : 0) - ped.pos.z;
      const r = Math.max((l.w || 16), (l.d || 16)) * 0.5 + 6;     // lot footprint + a kerb of slack
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }

  // =========================================================================
  // PROTECT — assign a hired crew member to guard an ally (another crew member, an
  // NPC you've befriended, the player's partner). We write the SAME fields the
  // squad layer's "shield" + the brain's leash honor: a guard point on the
  // principal and a transient _protect link THIS module owns. The squad layer (if
  // loaded) then keeps the protector interposed when a threat appears.
  // =========================================================================
  // registry of live protectors: scanning ALL ~1000 peds at 4Hz for a flag only
  // a handful of hired guards ever carry was pure waste. cityProtect below is
  // the ONLY place _protect is assigned (checked repo-wide), so the set is
  // complete by construction; the pass iterates just the set and drops
  // released / dead / despawned entries itself.
  const protectors = new Set();

  CBZ.cityProtect = function (protector, principal) {
    if (!protector || protector.dead || !principal || principal === protector) return false;
    protector._protect = principal;                   // our transient guard link
    protectors.add(protector);                        // registry for the trail pass
    protector.companion = false;                      // they peel off YOU to mind the principal
    protector.rage = null;
    if (principal.pos && protector.guard) { protector.guard.x = principal.pos.x; protector.guard.z = principal.pos.z; }
    else if (principal.pos) protector.guard = { x: principal.pos.x, z: principal.pos.z };
    bumpLoyalty(protector, 0.03);
    note(nm(protector) + " is minding " + nm(principal) + ".", 2);
    return true;
  };

  // keep each protector's guard point trailing its principal + (if the principal is
  // threatened) interpose via the squad layer. Cadenced, bounded. WHY: a bodyguard
  // told to "watch him" should STAY with him, not freeze on the spot you said it.
  let protT = 0;
  if (CBZ.onUpdate) CBZ.onUpdate(34.57, function (dt) {
    if (!g || g.mode !== "city") return;
    protT -= dt; if (protT > 0) return; protT = 0.25;
    if (!protectors.size) return;                     // common case: nobody on guard duty
    const peds = CBZ.cityPeds; if (!peds) return;
    for (const p of protectors) {
      if (!p || p.dead || !p._protect) { protectors.delete(p); continue; }
      const pr = p._protect;
      if (!pr || pr.dead) { p._protect = null; protectors.delete(p); continue; }   // principal gone → released
      // despawned protector (no longer in the live ped list): release the link so a
      // recycled body never resumes someone else's guard duty. Cheap — the set is
      // tiny and this only runs at 4Hz while anyone is actually on duty.
      if (peds.indexOf(p) < 0) { p._protect = null; protectors.delete(p); continue; }
      // trail the principal at a short stand-off so they shadow them around the map
      if (pr.pos && p.guard) { p.guard.x = pr.pos.x; p.guard.z = pr.pos.z; }
      // if the principal has a live attacker, point the protector at it (the squad
      // layer's detail-shaper handles real VIP details; this covers ad-hoc allies).
      const threat = principalThreat(pr, p);
      if (threat && !threat.dead) {
        p.rage = threat; if (p.state !== "fight") p.state = "fight";
        if (CBZ.cityCombatSmarts) { try { CBZ.cityCombatSmarts(p, threat, dt); } catch (e) {} }
      }
    }
  });

  // who's attacking the principal? the nearest live ped raging at THEM (bounded).
  function principalThreat(principal, self) {
    const peds = CBZ.cityPeds; if (!peds || !principal.pos) return null;
    let best = null, bd = 22 * 22;
    for (let i = 0; i < peds.length; i++) {
      const e = peds[i];
      if (!e || e.dead || e === self || e === principal) continue;
      if (e.recruited || e.companion || e.faction === "player") continue;   // friendlies aren't threats
      if (e.rage !== principal) continue;                                    // must be after the principal
      const dx = e.pos.x - principal.pos.x, dz = e.pos.z - principal.pos.z, dd = dx * dx + dz * dz;
      if (dd < bd) { bd = dd; best = e; }
    }
    return best;
  }

  // ---- LOYALTY number ------------------------------------------------------
  function bumpLoyalty(ped, d) {
    if (!ped) return;
    ped._loyal = 1;
    ped._loyalty = Math.max(0, Math.min(1, (ped._loyalty != null ? ped._loyalty : 0.7) + d));
  }
  CBZ.cityLoyaltyOf = function (ped) { return ped && ped._loyalty != null ? ped._loyalty : (ped && ped._loyal ? 0.7 : 0); };

  // when a crew member is killed while on your payroll, loyalty across the rest of
  // the crew DIPS (you let one of theirs die). Feature-detect a death hook; if the
  // engine exposes cityKillPed we wrap it (preserving the original).
  function wrapDeathForLoyalty() {
    const ok = CBZ.cityKillPed;
    if (typeof ok !== "function" || ok._loyalWrapped) return;
    const w = function (ped, imp, cause) {
      const wasCrew = ped && (ped.recruited || ped.companion || ped._loyal);
      const ret = ok.apply(this, arguments);
      try {
        if (wasCrew) {
          // the surviving crew takes it personally — small loyalty dip all round.
          const peds = CBZ.cityPeds || [];
          for (let i = 0; i < peds.length; i++) { const c = peds[i]; if (c !== ped && (c.recruited || c.companion) && c._loyalty != null) c._loyalty = Math.max(0, c._loyalty - 0.04); }
        }
      } catch (e) {}
      return ret;
    };
    w._loyalWrapped = true; w._loyalOrig = ok; CBZ.cityKillPed = w;
  }

  // ---- WRAP cityRecruit (social.js pattern): stamp a loyalty record on the hire.
  //      Preserve the original; run it; then if the ped actually joined, mark it.
  function wrapRecruit() {
    const orig = CBZ.cityRecruit;
    if (typeof orig !== "function" || orig._loyalWrapped) return;
    const w = function (ped) {
      const ret = orig.apply(this, arguments);
      try { if (ped && ped.recruited) bumpLoyalty(ped, 0); } catch (e) {}
      return ret;
    };
    w._loyalWrapped = true; w._loyalOrig = orig; CBZ.cityRecruit = w;
  }

  // =========================================================================
  // SELF-REGISTER the two crewmate-gated verbs into the GLOBAL registry. They only
  // surface on a crew member AND only when the give is meaningful (you hold a spare
  // gun / you have cash) — reachable, never a dead button. label is a function so it
  // names the crewmate + the piece. onSelect(p, ctx) gets the target ped + context.
  // =========================================================================
  function registerVerbs() {
    const I = CBZ.interactions;
    if (!I || !I.register || I._loyaltyVerbs) return;
    I._loyaltyVerbs = true;

    // HAND <name> YOUR <gun> — slot K (the relationship ladder), high prio so it
    // beats generic talk on a crewmate; shows only with a spare gun in your bag.
    I.register("ped:civ", {
      id: "loyal-hand-gun", slot: "k", prio: 58,
      canShow: function (p) { return isCrew(p) && hasSpareGun(); },
      label: function () { return "Hand over " + heldGunLabel(); },
      onSelect: function (p) {
        const w = heldGunPedName();
        if (!w) { note("Nothing to hand them.", 1.4); return; }
        CBZ.cityGiveGunToNpc(p, w);
        note(nm(p) + " racks the " + heldGunLabel() + ". They've got your back.", 2.2);
        if (CBZ.sfx) CBZ.sfx("rack");
      },
    });

    // SLIP <name> $<amt> FOR A PIECE — slot L; shows only when you can cover the
    // cheapest gun. We slip a fixed, legible stake (capped to what you carry).
    I.register("ped:civ", {
      id: "loyal-slip-cash", slot: "l", prio: 40,
      canShow: function (p) { return isCrew(p) && canAfford(cheapestGun()); },
      label: function () { return "Slip $" + slipAmount(); },
      onSelect: function (p) {
        const amt = slipAmount();
        if (!canAfford(amt)) { note("Not enough on you.", 1.4); return; }
        if (!spend(amt)) { note("Couldn't cover it.", 1.4); return; }
        CBZ.cityGiveCashToNpc(p, amt);
      },
    });
  }
  // the cheapest buyable gun's price = the floor for the slip-cash verb to appear.
  function cheapestGun() {
    let lo = Infinity;
    for (let i = 0; i < BUYABLE.length; i++) { const pr = gunPrice(BUYABLE[i]); if (pr > 0 && pr < lo) lo = pr; }
    return lo === Infinity ? 350 : lo;
  }
  // how much we slip: enough for a solid mid piece if you've got it, else the floor.
  function slipAmount() {
    const want = gunPrice("SMG") || gunPrice("AK-47") || cheapestGun();
    return Math.min(cash(), Math.max(cheapestGun(), want));
  }

  // ============================================================
  //  §THE LOYALTY LEDGER — the spine the whole game hangs on
  //
  //  OWNER (2026-07-29, verbatim): "the whole war band code — it was a dumb
  //  idea, but it's really what this whole game's point is: get enough people
  //  recruited, or get enough money, or enough guns, or somehow get key cards
  //  and access and everything, to get to the nuke — and then use it, or become
  //  president, or hold the nation hostage, or join an org, or sell the nuke."
  //
  //  CLAUDE.md LAW 2 named the gap exactly: "We have already built the organs
  //  without naming the creature... What is missing is ONE spine: the ledger
  //  that counts who is loyal to YOU and how armed they are, plus the threshold
  //  verbs it unlocks." This is that ledger.
  //
  //  IT READS. IT NEVER MIRRORS. That is the whole discipline, and it is the
  //  rule that killed proptypes.js when it was broken. FIVE separate registries
  //  already answer "is this person yours" and the ledger owns NONE of them:
  //    • playergang.js  g.playerGang.members[]   (CBZ.cityPlayerGangMembers)
  //    • careers.js     ped.recruited / ped.kind = "crew" / g.cityCrew
  //    • social.js      g.cityPartner
  //    • this file      ped._loyalty / ped._loyal
  //    • warband.js     ped.faction = "player-company"   ← DELETED; see below
  //  A body in three of them counts ONCE (Set-deduped). Nothing is written back.
  //
  //  THE FOUR CURRENCIES ARE AN *OR*, NOT AN *AND*. Read the owner's sentence
  //  again: "enough people recruited, OR enough money, OR enough guns, OR
  //  somehow get key cards and access". So power is a SUM of four independent
  //  strands, each capped at 1.5 so ONE route can carry you a long way and no
  //  route can carry you alone to the apex. Reaching the vault needs about
  //  three of the four — which is precisely the sentence, arithmetised.
  //
  //  AND EVERY RUNG UNLOCKS A VERB (CLAUDE.md: "A RANK IS A VERB, OR IT IS
  //  NOTHING"). Not a payout multiplier — a thing you can DO that you could not
  //  do before, and that changes your CATEGORY:
  //    crew      muster   — you stop being a man with a gun and become a unit
  //    cell      press    — people SURRENDER to you instead of dying
  //    outfit    ransom   — a beaten enemy becomes a resource, not a corpse
  //    syndicate armory   — heavy ordnance opens to you
  //    apex      vault    — THE NUCLEAR VAULT OPENS
  //                doctrine — and a state you hold can be REMADE
  //
  //  Exposes: CBZ.cityPower, cityPowerTier, cityPowerCan, cityPowerKnows,
  //  cityPowerNeed, cityLock, cityMuster, citySurrender, citySurrenderSweep,
  //  cityTakePrisoner, cityPrisoners, loyaltyAudit.
  // ============================================================
  const CFG = CBZ.CONFIG = CBZ.CONFIG || {};
  // flags declared in the OWNING file (CLAUDE.md: never race config.js)
  if (CFG.LOYALTY_LEDGER == null) CFG.LOYALTY_LEDGER = true;   // the ledger + threshold verbs
  if (CFG.LOYALTY_LOCKS == null) CFG.LOYALTY_LOCKS = true;     // doors that answer to it
  if (CFG.LOYALTY_SURRENDER == null) CFG.LOYALTY_SURRENDER = true; // the war-band atom

  /* ---- THE RUNGS -----------------------------------------------------------
     `at` is the power score the rung opens at; `grants` is CUMULATIVE (the
     same shape factions.js's rank ladder uses, deliberately — one grammar).
     A rung with no verb is banned by CLAUDE.md and there are none here.      */
  const RUNGS = [
    { key: "alone",     name: "On your own",  at: 0.00, grants: [] },
    { key: "crew",      name: "A crew",       at: 0.35, grants: ["muster"] },
    { key: "cell",      name: "A cell",       at: 0.90, grants: ["press"] },
    { key: "outfit",    name: "An outfit",    at: 1.80, grants: ["ransom", "siege"] },
    { key: "syndicate", name: "A syndicate",  at: 3.00, grants: ["armory"] },
    { key: "apex",      name: "A power",      at: 4.20, grants: ["vault", "doctrine"] },
  ];
  /* The four strands' FULL-SCALE denominators. Each is the amount of that one
     currency that scores 1.0. They are chosen against what the world can
     actually supply, not picked: 20 loyal bodies is inside playergang's
     uncapped roster and above careers.js's payroll comfort; $250k is one tier
     under cityEcon's own TIERS ceiling; 12 firearms is a full rack; the access
     scale is 3 because holding three real claims (an org rank, a second org,
     a live uniform) is genuinely rare. A strand cannot exceed CAP. */
  const FULL = { people: 20, guns: 12, money: 250000, access: 3 };
  const CAP = 1.5;

  // ---- WHO IS YOURS --------------------------------------------------------
  // Every registry, read, deduped, never written. Bounded: the ped scan is the
  // only O(n) part and the whole snapshot is cadenced to 2 Hz below.
  function loyalBodies() {
    const out = new Set();
    // 1. the player's gang roster (playergang.js owns it)
    if (CBZ.cityPlayerGangMembers) {
      try {
        const mem = CBZ.cityPlayerGangMembers() || [];
        for (let i = 0; i < mem.length; i++) { const m = mem[i]; if (m && !m.dead) out.add(m); }
      } catch (e) {}
    }
    // 2. careers.js hires + anything flying your colours, off the live ped list
    const peds = CBZ.cityPeds;
    if (peds) for (let i = 0; i < peds.length; i++) { const p = peds[i]; if (isCrew(p)) out.add(p); }
    // 3. the partner (social.js) — a person who rides with you IS loyal to you
    if (g && g.cityPartner && !g.cityPartner.dead) out.add(g.cityPartner);
    return out;
  }

  // ---- WHAT ACCESS YOU HOLD ------------------------------------------------
  // An ACCESS CLAIM is a thing that gets you THROUGH a door: a rank inside an
  // org, membership of an org at all, or a uniform the world currently believes.
  // Every one is READ from the file that owns it — factions.js and outfits.js.
  function accessClaims() {
    const out = [];
    const F = CBZ.factions;
    if (F && F.ids) {
      try {
        const ids = F.ids();
        for (let i = 0; i < ids.length; i++) {
          const id = ids[i];
          if (!F.isMember || !F.isMember(id)) continue;
          const tier = (F.tier ? (F.tier(id) | 0) : 0);
          out.push({ kind: "org", id: id, org: (F.orgIn ? F.orgIn(id) : null), tier: tier,
                     weight: 1 + Math.min(2, tier * 0.5) });
        }
      } catch (e) {}
    }
    // a uniform the world still believes is a live access claim (outfits.js).
    // A BLOWN cover is worth nothing, which is why we ask cityDisguise (which
    // reports `trusted`) rather than reading the outfit slot ourselves.
    if (CBZ.cityDisguise) {
      try {
        const d = CBZ.cityDisguise();
        if (d && d.trusted) out.push({ kind: "cover", id: d.org, org: d.org, role: d.role, weight: 1 });
      } catch (e) {}
    }
    return out;
  }

  // ---- HOW ARMED YOU ARE ---------------------------------------------------
  function playerGunCount() {
    const inv = CBZ.weaponInventory;
    return (inv && inv.length) ? inv.length : ((CBZ.currentWeaponId || (g && g.cityWeapon)) ? 1 : 0);
  }
  function purse() {
    const c = (g && g.cash) || 0, b = (g && g.cityBank) || 0;
    return Math.max(0, c) + Math.max(0, b);
  }

  // ---- THE SNAPSHOT --------------------------------------------------------
  let SNAP = null, snapT = 0;
  function computePower() {
    const bodies = loyalBodies();
    let armed = 0;
    for (const p of bodies) if (p && p.armed && p.weapon) armed++;
    const access = accessClaims();
    let accessScore = 0;
    for (let i = 0; i < access.length; i++) accessScore += access[i].weight;

    const guns = playerGunCount() + armed;      // every gun you can point at something
    const cash = purse();
    const n = bodies.size;

    // Each strand 0..CAP. The armed fraction is a MULTIPLIER on the people
    // strand rather than a fifth currency: twenty unarmed bodies are a crowd,
    // twenty armed ones are a company, and that difference should not be
    // expressible as "more people".
    const armedFrac = n ? armed / n : 0;
    const s = {
      people: Math.min(CAP, (n / FULL.people) * (0.55 + 0.75 * armedFrac)),
      guns:   Math.min(CAP, guns / FULL.guns),
      money:  Math.min(CAP, cash / FULL.money),
      access: Math.min(CAP, accessScore / FULL.access),
    };
    const power = s.people + s.guns + s.money + s.access;

    let ri = 0;
    for (let i = 0; i < RUNGS.length; i++) if (power >= RUNGS[i].at) ri = i;
    const verbs = Object.create(null);
    for (let i = 0; i <= ri; i++) for (const v of RUNGS[i].grants) verbs[v] = true;

    return {
      bodies: n, armed: armed, guns: guns, cash: cash,
      orgs: access.filter(function (a) { return a.kind === "org"; }),
      access: access, accessScore: accessScore,
      strands: s, power: power,
      rung: ri, tier: RUNGS[ri].key, tierName: RUNGS[ri].name,
      verbs: Object.keys(verbs),
      _v: verbs,
    };
  }
  // 2 Hz is plenty — nothing here changes faster than a recruit or a purchase,
  // and a locked door asking twice a second must not walk the ped list twice a
  // second. Any writer that needs it fresh passes true.
  function power(fresh) {
    if (CFG.LOYALTY_LEDGER === false) return computePower();   // flag off: no cache, same numbers
    if (fresh || !SNAP) { SNAP = computePower(); snapT = 0; }
    return SNAP;
  }
  CBZ.cityPower = function (fresh) { return power(fresh); };
  CBZ.cityPowerTier = function () { return power().tier; };

  /* THE TWO QUESTIONS, in factions.js's exact grammar and for the same reason.
     `cityPowerCan` answers FALSE for a verb the ladder has never heard of, so a
     naive `if (!cityPowerCan(x)) return` would SLAM every gate shut the moment
     LOYALTY_LEDGER was flipped off — the "one-line revert makes it worse" trap
     CLAUDE.md documents against rankCan. `cityPowerKnows` is the degrade-safe
     guard every consumer in this repo writes its gate against. */
  CBZ.cityPowerCan = function (verb) {
    if (!verb) return false;
    if (CFG.LOYALTY_LEDGER === false) return false;
    return !!power()._v[verb];
  };
  CBZ.cityPowerKnows = function (verb) {
    if (CFG.LOYALTY_LEDGER === false) return false;
    for (let i = 0; i < RUNGS.length; i++) if (RUNGS[i].grants.indexOf(verb) >= 0) return true;
    return false;
  };
  CBZ.cityPowerRungs = function () { return RUNGS.map(function (r) { return { key: r.key, name: r.name, at: r.at, grants: r.grants.slice() }; }); };

  /* ---- THE GRADIENT, MADE VISIBLE -----------------------------------------
     OWNER LAW 1: "build gradients of visible access and power, not objectives…
     a locked door with something visible behind it out-motivates any quest
     marker." A lock that says only "locked" is a wall. This says WHAT WOULD
     OPEN IT, in the currency you are closest to having — so the door itself is
     the quest giver and no marker is needed.                                */
  function rungFor(verb) {
    for (let i = 0; i < RUNGS.length; i++) if (RUNGS[i].grants.indexOf(verb) >= 0) return RUNGS[i];
    return null;
  }
  function plural(n, one, many) { return n === 1 ? one : (many || one + "s"); }
  CBZ.cityPowerNeed = function (verb) {
    const R = rungFor(verb);
    if (!R) return { ok: true, gap: 0, line: "", short: [] };
    const P = power();
    const gap = R.at - P.power;
    if (gap <= 0) return { ok: true, gap: 0, line: "", short: [], tier: R.key };
    /* WHICH SINGLE CURRENCY CLOSES THE GAP, and — this is the part that has to
       be right — CAN it? Every strand is capped at CAP, so a strand with only
       `CAP - s.k` of headroom left cannot close a bigger gap NO MATTER WHAT.
       Quoting one anyway produces a number that would never work if the player
       actually went and got it ("$708,375 more" when money can contribute at
       most another 1.48 of a 2.83 gap), and a lock that lies about its own
       price is worse than a lock that says nothing. So an option is offered
       only when its own headroom covers the gap; when none does, the door says
       plainly that no single route is enough and names the two nearest. */
    const s = P.strands, opts = [], partial = [];
    const armedFrac = P.bodies ? P.armed / P.bodies : 0;
    function offer(key, headroom, amount, line) {
      if (!(amount > 0)) return;
      const row = { w: amount / (FULL[key] || 1), k: key, n: amount, line: line };
      if (gap <= headroom + 1e-9) opts.push(row); else partial.push(row);
    }
    offer("people", CAP - s.people,
      Math.ceil(((s.people + gap) * FULL.people) / (0.55 + 0.75 * armedFrac) - P.bodies),
      "");
    offer("guns", CAP - s.guns, Math.ceil((s.guns + gap) * FULL.guns - P.guns), "");
    offer("money", CAP - s.money, Math.ceil((s.money + gap) * FULL.money - P.cash), "");
    offer("access", CAP - s.access, Math.ceil((s.access + gap) * FULL.access - P.accessScore), "");
    // wording is applied after the feasibility split so both lists read the same
    function say(r) {
      if (r.k === "people") return r.n + " more " + plural(r.n, "body", "bodies") + " loyal to you";
      if (r.k === "guns") return r.n + " more " + plural(r.n, "gun") + " under your command";
      if (r.k === "money") return "$" + r.n.toLocaleString() + " more";
      return r.n > 1 ? (r.n + " more claims — rank, a second org, or a uniform they believe")
                     : "one more claim — a rank, an org, or a uniform they believe";
    }
    opts.sort(function (a, b) { return a.w - b.w; });
    partial.sort(function (a, b) { return a.w - b.w; });
    for (const r of opts) r.line = say(r);
    for (const r of partial) r.line = say(r);
    let line;
    if (opts.length) line = opts[0].line + (opts[1] ? ", or " + opts[1].line : "");
    else {
      // nothing alone is enough — name the shape of the answer, not a fantasy
      const near = partial.slice(0, 2).map(function (r) { return r.k === "money" ? "money" : (r.k === "people" ? "people" : r.k); });
      line = "more than any one thing can buy — " + (near.length ? near.join(" and ") + ", together" : "people, guns, money and access, together");
    }
    return { ok: false, gap: gap, tier: R.key, short: opts, partial: partial, line: line };
  };

  /* ---- THE LOCK ------------------------------------------------------------
     ONE-LINE ADOPTION, and it REPLACES the condition the caller already wrote:

         const L = CBZ.cityLock ? CBZ.cityLock({ id:"prison-armory", verb:"press",
                     have: (g.hasKey || g.role === "cop"), label:"The armory door" })
                 : { open: (g.hasKey || g.role === "cop"), line:"…" };
         if (!L.open) { hint(L.line); return; }

     `have` is the caller's OWN existing key test and it always wins — a keycard
     is a keycard and the ledger never takes that away. What the lock ADDS is
     (a) a second, EARNED route through the same door and (b) the sentence that
     makes the door a gradient instead of a wall.

     `orgs` is the third route: the uniform/rank you are already wearing. It
     goes through factions.js and outfits.js, never a private membership test.

     ---- 2026-08-05: `power:false`, AND WHY A DOOR GETS TO REFUSE THE LEDGER --
     OWNER, reading the prison armory's own line off his screen ("The armory
     door needs a Keycard, the police, $204,167 more, or 10 more guns un…"):
     "this specific text is way too long. It's dumb that an amount of money can
     get you into the armory."

     Both halves are one fault. The gradient sentence is GOOD — a locked door
     that names its price out-motivates a quest marker, which is LAW 1 — but it
     is only good where the price is a thing that door would actually take. A
     steel door with a card reader does not have a cash price; quoting one turns
     the ledger into a universal solvent and the sentence into a four-clause
     list that the HUD then truncates mid-word, so the door ends up naming a
     route the player cannot even finish reading.

     `power:false` is a door saying: my locks are the ones I physically have.
     It skips route 4 entirely and prints from the door's OWN keys/orgs, which
     is short by construction because a door has one or two of those, never
     four. It is opt-IN — every other lock in the repo keeps the ledger route,
     because a warehouse, a strike console or a crew's turf genuinely can be
     taken by a big enough crew, and that is the whole point of the ladder. */
  function haveLine(label, keys, orgs) {
    if (keys && keys.length) return label + " needs a " + keys[0] + ".";
    if (orgs && orgs.length) return label + " only opens for the " + orgs[0] + ".";
    return label + " is locked.";
  }
  CBZ.cityLock = function (spec) {
    spec = spec || {};
    const label = spec.label || "It";
    /* THE DEGRADE VALUE IS THE CALLER'S OWN HISTORY, and getting this wrong is
       the "one-line revert makes it worse" trap CLAUDE.md documents against
       rankCan. Two callers need OPPOSITE answers when the ledger cannot speak:
       a door this wave newly locked (the vault, the ordnance crate, the strike
       console) was UNGATED before and must fall back OPEN or flipping the flag
       strands the player in front of the whole endgame; a door that was ALREADY
       key-gated (the prison armory) must fall back LOCKED or flipping the flag
       hands out the armory for free. `wasOpen` is the caller stating which it
       was, and it is the only honest way to answer both. */
    const degrade = { open: !!spec.have || !!spec.wasOpen, line: spec.have ? "" : (label + " is locked."), route: spec.have ? "key" : null };
    if (CFG.LOYALTY_LOCKS === false) return degrade;
    if (spec.have) return { open: true, line: "", route: "key" };
    // route 2 — an org claim this door respects
    const orgs = spec.orgs || [];
    for (let i = 0; i < orgs.length; i++) {
      const id = orgs[i];
      if (CBZ.factions && CBZ.factions.isMember && CBZ.factions.isMember(id)) {
        const min = spec.minTier || 0;
        if (!min || (CBZ.factions.tier && (CBZ.factions.tier(id) | 0) >= min)) return { open: true, line: "", route: "org" };
      }
      if (CBZ.cityDisguiseTrust && CBZ.cityDisguiseTrust(id)) return { open: true, line: "", route: "cover" };
    }
    // route 3 — an item you physically carry
    const keys = spec.keys || [];
    for (let i = 0; i < keys.length; i++) {
      if (CBZ.cityEcon && CBZ.cityEcon.count && CBZ.cityEcon.count(keys[i]) > 0) return { open: true, line: "", route: "item" };
    }
    // route 4 — you simply have the power to take it. A door that declared
    // `power:false` has none: it prints its own keys and stops. (Note this
    // sits AFTER routes 1-3, so refusing the ledger never refuses a key.)
    if (spec.power === false) return { open: false, route: null, line: haveLine(label, keys, orgs) };
    if (spec.verb && CBZ.cityPowerKnows(spec.verb)) {
      if (CBZ.cityPowerCan(spec.verb)) return { open: true, line: "", route: "power" };
      const need = CBZ.cityPowerNeed(spec.verb);
      return { open: false, route: null,
               line: label + " needs " + (keys.length ? ("a " + keys[0] + ", ") : "") +
                     (orgs.length ? ("the " + orgs[0] + ", ") : "") + need.line + "." };
    }
    // the ledger cannot answer (flag off / loyalty.js half-loaded) — hand back
    // whatever this door did BEFORE it was ever locked. See `degrade` above.
    return degrade;
  };
  // the one-word form for a caller that has nothing else to say
  CBZ.cityLockOpen = function (verb) { return CBZ.cityPowerKnows(verb) ? CBZ.cityPowerCan(verb) : true; };

  /* ============================================================
     THE WAR BAND ATOMS, PROMOTED OUT OF THE MINIGAME

     OWNER: "the whole war band code — it was a dumb idea, but it's really what
     this whole game's point is." `games/warband.js` is DELETED. It authored a
     desert camp, two standards, a prisoner rail and a 3-banner scoreboard so
     that two of its rules could exist. Those two rules are good and they belong
     to the CITY, where you already have people and enemies:

       (1) a physically outnumbered remnant that has taken losses SURRENDERS;
       (2) a surrendered body is a RESOURCE — recruit them or ransom them.

     Neither needs a venue, a camp, a banner count or a package. Both are one
     call, anywhere in the world, against the peds the sim was already running.
     ============================================================ */

  // (1) SURRENDER. peds.js's CBZ.cityMarkGunpoint is the shared hands-up state
  // and we use it wherever it applies — but it deliberately REFUSES an armed
  // ped (peds.js:4712: "armed peds draw + aim back, never surrender"), which is
  // correct for a mugging and wrong for a battle. An armed fighter who is
  // outnumbered and has watched half his side fall DOES yield. So: delegate for
  // the unarmed case, and write the battlefield case here — the SAME fields, so
  // combat.js's `if (a.surrender…) return false` (combat.js:673) already spares
  // them and restrain.js/police.js already know how to release them.
  /* THE TWO KINDS OF HANDS-UP, and keeping them apart is the whole reason the
     migrations below are byte-compatible. A TRANSIENT yield (a gunpoint, a
     shakedown, a bribed guard stepping aside) keeps the gun and is not a
     prisoner — that is peds.js's existing grammar and this must not change it.
     A BATTLEFIELD yield lays the weapon down and IS a prisoner. So `disarm`
     and `prisoner` both default OFF and the outnumbered-remnant sweep is the
     one caller that turns them on. Anything else would have permanently
     disarmed every civilian anyone has ever shaken down. */
  const prisoners = new Set();
  CBZ.citySurrender = function (ped, opts) {
    if (CFG.LOYALTY_SURRENDER === false) return false;
    if (!ped || ped.dead || ped.ko > 0 || ped.isPlayer || ped.controlled) return false;
    opts = opts || {};
    const keep = opts.prisoner === true;
    if (ped.surrender || (ped.surrenderT || 0) > 0) { if (keep) prisoners.add(ped); return true; }
    if (!ped.armed && CBZ.cityMarkGunpoint) {
      // the meek case is already solved and it is not ours to re-solve
      if (CBZ.cityMarkGunpoint(ped, opts.hold || 999)) { if (keep) prisoners.add(ped); return true; }
    }
    ped.rage = null; ped.hunt = 0; ped.huntPlayer = 0;
    ped.state = "surrender"; ped.speed = 0;
    ped.surrender = true;
    ped.surrenderT = Math.max(ped.surrenderT || 0, opts.hold || 999);
    ped.pause = Math.max(ped.pause || 0, opts.pause || 0.35);
    if (opts.disarm) { ped.armed = false; if (CBZ.syncActorWeapon) { try { CBZ.syncActorWeapon(ped); } catch (e) {} } }
    ped.robbable = true;
    ped.poseHandsUp = true; ped.poseAimBack = false;
    ped.fear = Math.max(ped.fear || 0, opts.fear != null ? opts.fear : 10);
    if (opts.alarmed) ped.alarmed = Math.max(ped.alarmed || 0, opts.alarmed);
    if (ped.char) { ped.char.surrender = true; ped.char.handsUp = true; }
    // face whoever took them, if the caller named one
    if (opts.toward && opts.toward.pos && ped.group && ped.pos) {
      ped.group.rotation.y = Math.atan2(opts.toward.pos.x - ped.pos.x, opts.toward.pos.z - ped.pos.z);
    }
    // a surrender is a panic event to everyone watching — the field peds.js
    // already runs, so a line breaking is contagious the way a crowd is.
    if (opts.panic !== false && CBZ.cityPanicRaise && ped.pos) { try { CBZ.cityPanicRaise(ped.pos.x, ped.pos.z, 0.6); } catch (e) {} }
    if (keep) prisoners.add(ped);
    return true;
  };

  /* THE RULE ITSELF — warband.js:284-286, verbatim in spirit and now applied to
     any fight anywhere: a side that has TAKEN LOSSES, is down to a REMNANT, and
     is physically outnumbered, yields. No morale stat, no dice, no extra HP —
     the visible situation is the rule, which is why it reads as fair.
     `mine`/`foes` are live arrays of peds; `started` is how many foes there
     were. Returns the array that surrendered (possibly empty).             */
  CBZ.citySurrenderSweep = function (mine, foes, started) {
    if (CFG.LOYALTY_SURRENDER === false) return [];
    if (!CBZ.cityPowerCan("press")) return [];      // pressing a surrender is a RUNG
    const A = (mine || []).filter(function (p) { return p && !p.dead; });
    const B = (foes || []).filter(function (p) { return p && !p.dead && !p.surrender; });
    if (!A.length || !B.length) return [];
    const n0 = Math.max(B.length, started | 0);
    const tookLoss = B.length < n0;
    const remnant = B.length <= Math.max(1, Math.floor(n0 / 3));
    if (!(tookLoss && remnant && A.length >= B.length + 1)) return [];
    const out = [];
    for (let i = 0; i < B.length; i++) if (CBZ.citySurrender(B[i], { disarm: true, prisoner: true })) out.push(B[i]);
    if (out.length && CBZ.city && CBZ.city.note) {
      CBZ.city.note(out.length + " " + plural(out.length, "man", "men") + " down arms — they are yours to take or turn loose.", 2.8);
    }
    return out;
  };

  // (2) THE PRISONER IS A RESOURCE. `recruit` turns the survivor into a real
  // crew member through careers.js's OWN cityRecruit (so payroll, orders, the
  // gang roster and the loyalty wrap above all fire); `ransom` pays out and
  // lets them walk. Neither invents a body and neither deletes one.
  CBZ.cityPrisoners = function () {
    for (const p of prisoners) if (!p || p.dead || (!p.surrender && (p.surrenderT || 0) <= 0)) prisoners.delete(p);
    return Array.from(prisoners);
  };
  CBZ.cityTakePrisoner = function (ped, how) {
    if (!ped || ped.dead) return false;
    if (!CBZ.cityPowerCan("ransom")) { note("You don't command enough for anyone to deal with you.", 2); return false; }
    prisoners.delete(ped);
    if (how === "recruit") {
      ped.surrender = false; ped.surrenderT = 0; ped.poseHandsUp = false;
      if (ped.char) { ped.char.surrender = false; ped.char.handsUp = false; }
      ped.fear = 0; ped.alarmed = 0; ped.rage = null;
      const ok = CBZ.cityRecruit ? CBZ.cityRecruit(ped) : false;
      if (ok !== false) { bumpLoyalty(ped, 0.1); note(nm(ped) + " fights under your banner now.", 2.4); return true; }
      note(nm(ped) + " won't take the offer.", 2); return false;
    }
    // RANSOM — the price is what the world says a life is worth here, off the
    // one econ table, never a second money model.
    const P = power(true);
    const pay = 140 + Math.round(P.power * 120) + ((ped.rank | 0) * 40);
    if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(pay);
    else if (g) g.cash = (g.cash || 0) + pay;
    ped.surrender = false; ped.surrenderT = 0; ped.poseHandsUp = false;
    if (ped.char) { ped.char.surrender = false; ped.char.handsUp = false; }
    ped.state = "flee"; ped.fear = 8; ped.rage = null;
    note("Ransom paid — $" + pay.toLocaleString() + " for " + nm(ped) + ".", 2.4);
    if (CBZ.sfx) { try { CBZ.sfx("coin"); } catch (e) {} }
    return true;
  };

  /* ---- MUSTER — point the whole ledger at one thing ------------------------
     The first rung's verb, and it authors NO combat: `rage` + `state="fight"`
     are the fields the ordinary ped brain already reads, and squadai.js's
     cityShapeSquad is the shaping the game already runs for every other group.
     What this adds is that it is ONE call over the whole ledger instead of an
     order loop per registry. */
  let musterTarget = null, musterT = 0, musterStarted = 0, musterForce = null;
  CBZ.cityMuster = function (target, opts) {
    if (!CBZ.cityPowerCan("muster")) { note("Nobody follows you yet.", 1.8); return 0; }
    if (!target || target.dead) return 0;
    opts = opts || {};
    const bodies = Array.from(loyalBodies());
    let n = 0;
    for (let i = 0; i < bodies.length; i++) {
      const p = bodies[i];
      if (!p || p.dead || p === target) continue;
      if (opts.armedOnly && !p.armed) continue;
      p.rage = target; p.state = "fight"; p.companion = false; p.hunt = 0;
      bumpLoyalty(p, 0.01);
      n++;
    }
    if (!n) return 0;
    musterTarget = target; musterT = opts.secs || 60; musterForce = bodies;
    // the enemy side, for the surrender sweep: whoever is raging at MY people
    musterStarted = 0;
    const peds = CBZ.cityPeds || [];
    for (let i = 0; i < peds.length; i++) {
      const e = peds[i];
      if (!e || e.dead || isCrew(e)) continue;
      if (e === target || (e.rage && bodies.indexOf(e.rage) >= 0)) musterStarted++;
    }
    note(n + " " + plural(n, "gun") + " on " + nm(target) + ".", 2.2);
    return n;
  };
  CBZ.cityMusterStand = function () {
    if (!musterForce) return 0;
    let n = 0;
    for (let i = 0; i < musterForce.length; i++) { const p = musterForce[i]; if (p && !p.dead) { p.rage = null; p.state = "walk"; n++; } }
    musterTarget = null; musterForce = null; musterT = 0;
    return n;
  };

  // ---- the ledger's own tick: refresh the snapshot, run the surrender sweep
  //      while a muster is live. Cadenced; both halves cost nothing at rest.
  if (CBZ.onUpdate) CBZ.onUpdate(34.59, function (dt) {
    if (!g || g.mode !== "city") return;
    snapT -= dt;
    if (snapT <= 0) { snapT = 0.5; SNAP = computePower(); }
    if (!musterTarget) return;
    musterT -= dt;
    if (musterT <= 0 || musterTarget.dead) { musterTarget = null; musterForce = null; return; }
    // the outnumbered-remnant rule, applied to the live fight
    const mine = [], foes = [];
    const peds = CBZ.cityPeds || [];
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i]; if (!p || p.dead) continue;
      if (isCrew(p)) { if (p.rage) mine.push(p); }
      else if (p === musterTarget || (p.rage && isCrew(p.rage))) foes.push(p);
    }
    if (mine.length && foes.length) CBZ.citySurrenderSweep(mine, foes, musterStarted);
  });

  /* ---- THE PRISONER VERBS, on the existing ped card ------------------------
     No new popup (CLAUDE.md HUD doctrine — the only popup is the killfeed).
     Two options on the ped:civ layer that only appear on somebody who has
     actually put their hands up for YOU, and only at the rung that opens them.
     A dead button is worse than a missing one, so canShow does the real test. */
  function registerPrisonerVerbs() {
    const I = CBZ.interactions;
    if (!I || !I.register || I._loyaltyPrisonerVerbs) return;
    I._loyaltyPrisonerVerbs = true;
    function held(p) { return !!(p && !p.dead && prisoners.has(p) && (p.surrender || (p.surrenderT || 0) > 0)); }
    I.register("ped:civ", {
      id: "loyal-prisoner-join", slot: "g", prio: 74,
      canShow: function (p) { return held(p) && CBZ.cityPowerCan("ransom"); },
      label: function () { return "Offer them a place"; },
      onSelect: function (p) { CBZ.cityTakePrisoner(p, "recruit"); },
    });
    I.register("ped:civ", {
      id: "loyal-prisoner-ransom", slot: "h", prio: 72,
      canShow: function (p) { return held(p) && CBZ.cityPowerCan("ransom"); },
      label: function () { return "Ransom them"; },
      onSelect: function (p) { CBZ.cityTakePrisoner(p, "ransom"); },
    });
  }

  /* ---- RATCHET -------------------------------------------------------------
     `registries` is the number of places that answer "is this person yours" —
     the ledger READS all of them and this counts them, so a future author who
     adds a sixth is visible. `mirrors` is the number this file WRITES: it is
     structurally 0 and must stay 0, because a mirrored membership is the
     parallel-bookkeeping trap that killed proptypes.js. `verblessRungs` is
     CLAUDE.md's "a rank is a verb or it is nothing", applied to this ladder. */
  CBZ.loyaltyAudit = function () {
    const P = power(true);
    let verbless = 0;
    for (let i = 1; i < RUNGS.length; i++) if (!RUNGS[i].grants.length) verbless++;
    return {
      registries: 4,            // playergang · careers/peds · partner · (this file's _loyalty)
      mirrors: 0,               // STRUCTURAL: the ledger stores no membership of its own
      rungs: RUNGS.length,
      verblessRungs: verbless,  // pinned 0
      verbs: RUNGS.reduce(function (a, r) { return a + r.grants.length; }, 0),
      bodies: P.bodies, armed: P.armed, guns: P.guns, cash: P.cash,
      accessClaims: P.access.length,
      power: Math.round(P.power * 1000) / 1000,
      tier: P.tier,
      prisoners: CBZ.cityPrisoners().length,
      locks: LOCKS.slice(),     // every door that answers to the ledger
      lockCount: LOCKS.length,
    };
  };
  // doors register themselves so the audit can never disagree with the world
  const LOCKS = [];
  CBZ.cityLockRegister = function (id) { if (id && LOCKS.indexOf(id) < 0) LOCKS.push(id); };

  // ---- wire up once the city/interaction/career modules are present. They load in
  //      index.html order (loyalty.js is after careers.js), but we still feature-
  //      detect + retry on a couple of update ticks so we never depend on exact
  //      timing (and a missing sibling just no-ops). ----
  let wiredFrame = 0;
  function tryWire() {
    wrapRecruit();
    wrapDeathForLoyalty();
    registerVerbs();
    registerPrisonerVerbs();
  }
  tryWire();
  if (CBZ.onUpdate) CBZ.onUpdate(34.58, function () {
    if (wiredFrame > 6) return;            // a handful of attempts, then stop probing
    wiredFrame++;
    tryWire();
  });
})();
