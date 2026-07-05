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
      label: function (p) { return "Hand " + nm(p) + " your " + heldGunLabel(); },
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
      label: function (p) { return "Slip " + nm(p) + " $" + slipAmount() + " for a piece"; },
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

  // ---- wire up once the city/interaction/career modules are present. They load in
  //      index.html order (loyalty.js is after careers.js), but we still feature-
  //      detect + retry on a couple of update ticks so we never depend on exact
  //      timing (and a missing sibling just no-ops). ----
  let wiredFrame = 0;
  function tryWire() {
    wrapRecruit();
    wrapDeathForLoyalty();
    registerVerbs();
  }
  tryWire();
  if (CBZ.onUpdate) CBZ.onUpdate(34.58, function () {
    if (wiredFrame > 6) return;            // a handful of attempts, then stop probing
    wiredFrame++;
    tryWire();
  });
})();
