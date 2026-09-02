/* ============================================================
   city/keys.js — A KEY IS A THING SOMEBODY IS CARRYING.

   OWNER: "i love the vault idea and the idea of someone at the bank who has a
   key that you can take hostage or kill and loot or pickpocket and then get in
   the vault".

   Every word of that is about a PERSON, not a lock. So this file owns exactly
   two facts and nothing else:

     1. the player's keys are ORDINARY INVENTORY ITEMS. There is no key ring,
        no second bag, no parallel ledger. A key is a row in `g.cityInv` like a
        Rolex or a grenade, which means city/inventory.js's grid shows it, the
        drop/pickup path moves it, and dying drops it — all for free, and all
        already tested by everything else in that bag.
     2. an NPC's keys live on the NPC (`ped._keys`), and every existing way to
        take something off a person moves them: pickpocket, corpse, gunpoint
        robbery, hostage. Those routes are wired ONCE, here, so a door that
        wants a key never has to know how a key changes hands.

   WHAT IT IS NOT. It is not a lock system: city/loyalty.js's CBZ.cityLock
   already is one, and its route 3 has always read "an item you physically
   carry" straight out of CBZ.cityEcon. A door asks `CBZ.cityKeys.has(id)` (or
   hands cityLock a `keys:[label]`) and that is the whole integration.

   THE ID/LABEL SPLIT. Callers key off a stable id ("vault:412,-88",
   "apt:A-14"); the player sees a LABEL ("Vault Key · Meridian Trust"). The
   item row is stored under the label — that is what makes it an ordinary item
   — and the id→label map rides the game object so a key in your pocket still
   answers `has()` after the arena rebuilds and the man who gave it to you is
   gone.

   Exposes: CBZ.cityKeys, CBZ.cityKeysAudit.
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  function econ() { return CBZ.cityEcon || null; }
  function note(m, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(m, s == null ? 2 : s); }

  const TALLY = { granted: 0, taken: 0, pickpocket: 0, corpse: 0, gunpoint: 0, hostage: 0, given: 0 };

  /* THE NAME MAP — NOT AN OWNERSHIP LEDGER. It answers "what is this key
     called", never "do you have it"; that question has exactly one answer and
     it is the inventory. */
  function LABELS() {
    if (!g.cityKeyLabels || typeof g.cityKeyLabels !== "object") g.cityKeyLabels = {};
    return g.cityKeyLabels;
  }
  function labelOf(id) { return (id && LABELS()[id]) || null; }
  function register(id, label) {
    if (!id) return null;
    const L = LABELS();
    if (label) L[id] = String(label);
    return L[id] || null;
  }

  // ---- the player's pocket, which is city/economy.js's item bag ------------
  function invCount(name) {
    const E = econ();
    if (E && E.count) { try { return E.count(name) | 0; } catch (e) {} }
    return ((g.cityInv && g.cityInv[name]) | 0);
  }
  function invAdd(name) {
    const E = econ();
    if (E && E.add) { try { E.add(name, 1); return true; } catch (e) {} }
    g.cityInv = g.cityInv || {};
    g.cityInv[name] = (g.cityInv[name] || 0) + 1;
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  }
  function invTake(name) {
    const E = econ();
    if (E && E.take) { try { return !!E.take(name, 1); } catch (e) {} }
    if (!g.cityInv || !(g.cityInv[name] > 0)) return false;
    g.cityInv[name]--;
    if (g.cityInv[name] <= 0) delete g.cityInv[name];
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  }

  function has(id) { const n = labelOf(id); return !!n && invCount(n) > 0; }
  function grant(id, label) {
    if (!id) return false;
    const n = register(id, label) || String(label || id);
    register(id, n);
    if (invCount(n) > 0) return false;      // one key per door; a second is clutter
    invAdd(n);
    TALLY.granted++;
    return true;
  }
  function take(id) {
    const n = labelOf(id);
    if (!n) return false;
    const ok = invTake(n);
    if (ok) TALLY.taken++;
    return ok;
  }
  function list() {
    const out = [], L = LABELS();
    for (const id in L) if (invCount(L[id]) > 0) out.push({ id: id, label: L[id] });
    return out;
  }

  // ---- the OTHER pocket: whoever is walking around with it ----------------
  function pedKeys(ped) { return (ped && Array.isArray(ped._keys)) ? ped._keys.slice() : []; }
  function pedHas(ped, id) {
    const k = ped && ped._keys;
    if (!Array.isArray(k)) return false;
    for (let i = 0; i < k.length; i++) if (k[i] && k[i].id === id) return true;
    return false;
  }
  function givePed(ped, id, label) {
    if (!ped || !id) return false;
    const n = register(id, label) || String(label || id);
    register(id, n);
    if (!Array.isArray(ped._keys)) ped._keys = [];
    if (pedHas(ped, id)) return false;
    ped._keys.push({ id: id, label: n });
    TALLY.given++;
    return true;
  }
  /* WHO HAS IT RIGHT NOW — the honest source for a door's "…has the key" line.
     It walks the live roster rather than remembering a spawn, so a manager who
     was killed, despawned or already robbed stops being the answer the frame
     it stops being true. */
  function holderOf(id) {
    const roster = CBZ.cityPeds;
    if (!roster) return null;
    for (let i = 0; i < roster.length; i++) {
      const p = roster[i];
      if (p && !p.dead && pedHas(p, id)) return p;
    }
    return null;
  }

  /* THE ONE TRANSFER. Every route below funnels here, so "a key changed hands"
     has one implementation and one sentence. Returns how many moved. */
  function lift(ped, how) {
    const ks = ped && ped._keys;
    if (!Array.isArray(ks) || !ks.length) return 0;
    const got = [];
    while (ks.length) {
      const k = ks.shift();
      if (!k || !k.id) continue;
      register(k.id, k.label);
      if (invCount(k.label) <= 0) invAdd(k.label);
      got.push(k.label);
    }
    if (!got.length) return 0;
    if (how && TALLY[how] != null) TALLY[how]++;
    const who = (ped && (ped.name || ped.job)) || "them";
    const VERB = {
      pickpocket: "Palmed",
      corpse: "Took",
      gunpoint: "They handed over",
      hostage: "They handed over",
    };
    note((VERB[how] || "Took") + " " + got.join(", ") + (how === "pickpocket" ? " off " + who + "." : "."), 2.4);
    if (CBZ.sfx) { try { CBZ.sfx("coin"); } catch (e) {} }
    return got.length;
  }

  CBZ.cityKeys = {
    has: has, grant: grant, take: take, list: list,
    givePed: givePed, pedHas: pedHas, pedKeys: pedKeys,
    // the two seams a door wants beyond has(): who is carrying it, and the
    // shakedown that moves it.
    holderOf: holderOf, lift: lift, labelOf: labelOf,
  };

  /* ============================================================
     THE ROUTES. Wired once, lazily, because peds.js / social.js /
     interactions.js all load after this file (this one has to be early enough
     for city/buildings.js and city/interact.js to see it at parse).
     ============================================================ */

  // 1) ROB AT GUNPOINT + MUG. Both verbs land in CBZ.cityRobPed, so one wrap
  //    covers gp-rob, ped-mug and anything else that ever robs a person.
  // 2) HOSTAGE. A man with your gun in his back does not keep the key.
  /* THE OUTCOME DECIDES, NOT THE ATTEMPT. Both wrapped functions REFUSE
     silently in ordinary cases — cityRobPed returns null on a body already
     robbed, cityTakeHostage bails when you have no gun drawn or already hold
     somebody — and lifting the key on the way IN would hand you a vault off a
     shakedown that never happened. So the original runs first and the key
     moves only if its own return value says the act landed. */
  function wrapOne(name, how, landed) {
    const orig = CBZ[name];
    if (typeof orig !== "function" || orig._cityKeysWrap) return false;
    const wrapped = function (ped) {
      const r = orig.apply(this, arguments);
      if (ped && !ped.isPlayer && landed(r, ped)) { try { lift(ped, how); } catch (e) {} }
      return r;
    };
    for (const k in orig) if (Object.prototype.hasOwnProperty.call(orig, k)) wrapped[k] = orig[k];
    wrapped._cityKeysWrap = true;
    CBZ[name] = wrapped;
    return true;
  }

  // 3) THE BODY. A deliberate verb on the corpse card — you crouch and go
  //    through his pockets — beside "Take clothes" and "Take armor", which is
  //    the shape city/interact.js already uses for a thing you peel off a body.
  let wiredVerb = false;
  function wireVerb() {
    const I = CBZ.interactions;
    if (wiredVerb || !I || !I.register) return false;
    I.register("corpse", {
      id: "corpse-keys", slot: "j", bad: true, prio: 90,
      canShow: function (b) { return !!(b && Array.isArray(b._keys) && b._keys.length); },
      label: function (b) {
        const k = b && b._keys;
        return (k && k.length > 1) ? "Take the keys" : "Take the key";
      },
      onSelect: function (b) { lift(b, "corpse"); },
    });
    wiredVerb = true;
    return true;
  }

  let wrapsDone = false;
  function wireAll() {
    // cityRobPed returns {cash,item} when it took; null when the body was
    // already robbed or dead. cityTakeHostage returns nothing, so the honest
    // test is the state it sets: this ped is now YOUR hostage.
    const a = wrapOne("cityRobPed", "gunpoint", function (r) { return !!r; });
    const b = wrapOne("cityTakeHostage", "hostage", function (r, ped) { return g.cityHostage === ped; });
    const c = wireVerb();
    wrapsDone = (typeof CBZ.cityRobPed === "function" && CBZ.cityRobPed._cityKeysWrap) &&
                (typeof CBZ.cityTakeHostage === "function" && CBZ.cityTakeHostage._cityKeysWrap) &&
                wiredVerb;
    return a || b || c;
  }
  wireAll();
  if (CBZ.onUpdate) {
    CBZ.onUpdate(14.61, function () {
      if (wrapsDone) return;
      wireAll();
    });
  }

  /* THE RATCHET. `orphanKeys` is the honest failure of a key system: a key id
     the player owns whose label map is gone, which would answer has()=false
     with the item sitting in the bag. It is structurally 0 (grant/lift both
     register before they add) — pin it there. */
  CBZ.cityKeysAudit = function () {
    const L = LABELS();
    let known = 0, held = 0, orphan = 0;
    for (const id in L) { known++; if (invCount(L[id]) > 0) held++; }
    const bag = g.cityInv || {};
    for (const name in bag) {
      if (!/(^|\s)Key(\s|$)|Keycard/i.test(name)) continue;
      let mapped = false;
      for (const id in L) if (L[id] === name) { mapped = true; break; }
      if (!mapped) orphan++;
    }
    let onPeds = 0, carriers = 0;
    const roster = CBZ.cityPeds || [];
    for (let i = 0; i < roster.length; i++) {
      const p = roster[i];
      if (!p || !Array.isArray(p._keys) || !p._keys.length) continue;
      carriers++; onPeds += p._keys.length;
    }
    return {
      knownDoors: known, heldByPlayer: held, orphanKeys: orphan,
      keysOnPeds: onPeds, carriers: carriers,
      granted: TALLY.granted, taken: TALLY.taken, givenToPeds: TALLY.given,
      byPickpocket: TALLY.pickpocket, byCorpse: TALLY.corpse,
      byGunpoint: TALLY.gunpoint, byHostage: TALLY.hostage,
      wired: !!wrapsDone,
    };
  };
})();
