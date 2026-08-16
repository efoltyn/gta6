/* ============================================================
   city/racket.js — THE STORE RACKET: rob it or run it.

   OWNER'S ASK (2026-08-16, condensed): "Interaction with stores when you
   got a gun pulled should be rob or extort. Rob steals their money in the
   register … robbing means whatever gang is protecting the store comes
   after you. If you extort a store your gang has revenue, and it's a
   conquerable color thing for the map in each city … gang fights won't be
   random and dumb but will be real … if I robbed a store yesterday and I
   walk into it, the owner pulls a gun instead of saying hi … if the gang
   doesn't pursue after a robbery, the owner becomes more likely to accept
   another extortion … you either rob and bring the stolen money to gang
   HQ, or you go around extorting places, or you go fight a gang who robbed
   a store you protect … store owners tell you what they want and it's all
   based on real things that happened in the world."

   WHAT THIS FILE OWNS — the one racket ledger and everything that reads it:
     · per-store PROTECTION state (who runs it, fear, trust, tribute owed)
     · the gunpoint ROB / EXTORT verbs at every counter (CBZ.interactions)
     · store-owner MEMORY: a keeper you robbed remembers it BY DAY and
       greets your return with a drawn pistol (brave) or raised hands (meek)
     · protector RETALIATION: rob a protected store and the crew that runs
       it sends hunters — the pursuit is what keeps the owner loyal, and a
       crew that DOESN'T pursue loses the owner's trust (grip slips)
     · the NPC RACKET DIRECTOR: rival crews sign stores of their own,
       collect tribute into their treasuries, rob stores an ENEMY protects
       (a walking, killable robber carrying the cash — recover it), and
       march a collector back to RECLAIM a store you flipped
     · owner REQUESTS at the counter, generated from the ledger's real
       events (contracts.js doctrine: the verb is authored, the world
       supplies the specifics — nothing here invents a target)
     · map truth: CBZ.cityRacketOwnerFill (radar wash), cityRacketStores
       (fullmap layer), cityRacketZoneTally (turf.js district control)
     · persistence under led.racket (worldstate _xWrap idiom, lot indices)

   WHAT IT DELIBERATELY DOES NOT OWN:
     · money creation. Every dollar moves through CBZ.cityTill.take() out
       of a real balance (shops.js's ledger; its minted-counter stays 0).
     · the ped brain. Hostility/pursuit is the canonical field grammar
       (rage/state/target/raidT/hunting) that gangs.js's sendReprisal uses;
       bodies claimed by other directors (_wRole/_op/_occupyGarrison/
       companion/controlled/restraint) are never touched.
     · turf lots. Store protection is a PARALLEL claim to gangs.js's
       abandoned-block turf — it feeds zone control through its own tally
       hook rather than pushing shop lots into gang.turf.

   Flag: RACKET_V1 (one-line revert — find() gates, ticks bail, verbs hide).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;
  const CFG = CBZ.CONFIG = CBZ.CONFIG || {};
  if (CFG.RACKET_V1 == null) CFG.RACKET_V1 = true;
  function on() { return CFG.RACKET_V1 !== false; }

  // deterministic stream, own name (gangs.js doctrine: never draw on another
  // module's stream — order is load-bearing there). LCG fallback off-seed.
  let _s = 0x9ac4e;
  let _sStream = null;
  function rng() {
    if (!_sStream && CBZ.seedStream) { try { _sStream = CBZ.seedStream("racket"); } catch (e) {} }
    if (_sStream) return _sStream();
    _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff;
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function money(n) { n = Math.round(n || 0); return n >= 1e6 ? "$" + (n / 1e6).toFixed(1) + "M" : n >= 1000 ? "$" + Math.round(n / 1000) + "k" : "$" + n; }

  // the day clock: worldDay (polity) when up, else daynight's dayCount — both
  // integer days; stamps from either compare fine within one run+save lane.
  function dayNow() {
    if (typeof CBZ.worldDay === "function") { try { return CBZ.worldDay() | 0; } catch (e) {} }
    if (typeof CBZ.dayCount === "function") { try { return CBZ.dayCount() | 0; } catch (e) {} }
    return 0;
  }

  function arena() { return (CBZ.city && CBZ.city.arena) || null; }
  function shopLots() { const A = arena(); return (A && A.shopLots) || []; }
  function playerActor() { return CBZ.city && CBZ.city.playerActor; }

  // WHICH SIDE THE PLAYER RIDES WITH — the canonical read (playergang.js):
  // membership crew → founded crew → null. Store claims by the player are
  // filed under this id, so a member's extortions build THEIR crew's map.
  function playerSideId() {
    if (CBZ.cityPlayerGangId) { try { return CBZ.cityPlayerGangId() || null; } catch (e) {} }
    return null;
  }
  // is `gid` a side the PLAYER personally collects for / defends?
  function isPlayerSide(gid) {
    if (!gid) return false;
    if (gid === "player") return true;
    const m = g.cityMembership;
    return !!(m && m.gangId === gid);
  }
  function gangRec(id) { return (id && id !== "player" && CBZ.cityGangById) ? CBZ.cityGangById(id) : null; }
  function sideName(gid) {
    if (gid === "player") return (g.playerGang && g.playerGang.name) || "your crew";
    const r = gangRec(gid); return r ? r.name : "a crew";
  }
  function sideColor(gid) {
    if (gid === "player") return 0xffd451;      // the map-wide "yours" gold
    const r = gangRec(gid); return r ? r.color : 0x8a93a3;
  }
  function note(msg, secs, opts) { if (CBZ.city && CBZ.city.note) CBZ.city.note(msg, secs || 2, opts); }
  function big(msg) { if (CBZ.city && CBZ.city.big) CBZ.city.big(msg); }
  function news(text) {
    const n = { app: "news", from: "Street Desk", text: text };
    if (typeof CBZ.cityPhoneNotify === "function") CBZ.cityPhoneNotify(n);
    else if (typeof CBZ.phoneNotify === "function") CBZ.phoneNotify(n);
  }

  // ============================================================
  //  THE LEDGER — one record per racketable store, keyed by the LOT object
  //  (vendor peds are recycled at 80m; the lot is the thing that persists).
  // ============================================================
  const state = new Map();      // lot -> rec
  let stateArena = null;        // the arena these lots belong to

  // A store is racketable when real money flows through it — cityTill.flow
  // answers $/trading-hour for every TRADE kind (broader than "has a till":
  // a gun counter or a car lot can be leaned on even without a stick-up
  // drawer). No cityTill in the build → the whole system idles.
  function racketable(lot) {
    if (!lot || lot.demolished || !lot.building || !lot.building.shop) return false;
    if (!CBZ.cityTill || !CBZ.cityTill.flow) return false;
    if (lot._rkFlow == null) { try { lot._rkFlow = CBZ.cityTill.flow(lot) || 0; } catch (e) { lot._rkFlow = 0; } }
    return lot._rkFlow > 0;
  }

  // a stable 0..1 per-store hash (owner personality: brave vs meek) off the
  // lot's coordinates — survives vendor recycling AND reloads, no state.
  function ownerNerve(lot) {
    if (CBZ.hash01) { try { return CBZ.hash01(Math.round(lot.cx * 10), Math.round(lot.cz * 10), 77); } catch (e) {} }
    let h = (Math.round(lot.cx * 10) * 73856093) ^ (Math.round(lot.cz * 10) * 19349663);
    h = (h ^ (h >> 13)) >>> 0; return (h % 1000) / 1000;
  }
  // gun/security counters keep iron under the counter (peds.js packsHeat) —
  // they are BRAVE by trade, whatever the hash says.
  function packsHeat(lot) { return lot.kind === "guns" || lot.kind === "security"; }
  function ownerBrave(lot) { return packsHeat(lot) || ownerNerve(lot) > 0.62; }

  function recFor(lot) {
    let r = state.get(lot);
    if (!r) {
      r = {
        gang: null,        // protector side id ("player" | gangId | null)
        by: null,          // who SIGNED it ("player" when the player did the leaning, even for an NPC crew they ride with)
        fear: 0.12,        // 0..1 how cowed this owner is (raises acceptance)
        trust: 0,          // 0..1 owner's faith in the CURRENT protector
        owed: 0,           // player-side tribute waiting to be collected ($)
        paidDay: -1,       // last day tribute moved
        sinceDay: -1,      // day protection started
        robs: [],          // [{b: who, d: day, c: cash, a: 0|1 avenged/pursued}] capped
        reclaim: 0,        // NPC reclaim attempts remaining after a hostile flip
      };
      state.set(lot, r);
    }
    return r;
  }
  function lastRobBy(rec, who) {
    for (let i = rec.robs.length - 1; i >= 0; i--) if (rec.robs[i].b === who) return rec.robs[i];
    return null;
  }
  function unavengedCount(rec) {
    let n = 0;
    for (const rb of rec.robs) if (!rb.a) n++;
    return n;
  }

  // the daily tribute a store can actually bear: ~1.3 trading-hours of its
  // real cash flow, floored/capped so a corner trap and the casino both read
  // sensibly. NEVER a constant — a fat store pays fat (and is worth taking).
  function tributeOf(lot) {
    const flow = lot._rkFlow || (racketable(lot) ? lot._rkFlow : 0) || 0;
    return clamp(Math.round(flow * 1.3), 15, 600);
  }

  function storeName(lot) { return (lot.building && lot.building.name) || "the store"; }
  function lotDoor(lot) { return (lot.building && (lot.building.door || lot.building.vendorSpot)) || { x: lot.cx, z: lot.cz }; }
  function vendorOf(lot) { const v = lot.building && lot.building.vendor; return (v && !v.dead) ? v : null; }

  // ============================================================
  //  PUBLIC READS — the map, the zones bar and other modules consume these.
  // ============================================================
  function ownerOf(lot) { const r = state.get(lot); return r ? r.gang : null; }

  // fill a Map<lot, colorInt> (hud.js radar builds one from gang.turf; this
  // merges the protected storefronts so the wash shows the racket map too).
  CBZ.cityRacketOwnerFill = function (map) {
    if (!on() || !map) return;
    for (const [lot, r] of state) {
      if (!r.gang || lot.demolished) continue;
      map.set(lot, isPlayerSide(r.gang) ? 0xffd451 : sideColor(r.gang));
    }
  };

  // the fullmap layer's feed: every protected store, cheap plain records.
  CBZ.cityRacketStores = function () {
    if (!on()) return [];
    const out = [];
    for (const [lot, r] of state) {
      if (!r.gang || lot.demolished) continue;
      out.push({ lot: lot, gang: r.gang, mine: isPlayerSide(r.gang), color: sideColor(r.gang), name: storeName(lot), owed: r.owed | 0, trust: r.trust });
    }
    return out;
  };

  // turf.js's zone recompute calls this (feature-detected there): protected
  // stores inside the zone count toward district control like turf lots do —
  // extorting a block's stores IS taking the block, which is the owner's
  // "conquerable color thing for the map" stated literally.
  CBZ.cityRacketZoneTally = function (zone) {
    if (!on() || !zone || !zone.lots) return null;
    let out = null;
    for (const lot of zone.lots) {
      const r = state.get(lot);
      if (!r || !r.gang || lot.demolished) continue;
      const id = r.gang === "player" ? "player" : r.gang;
      out = out || {};
      out[id] = (out[id] || 0) + 1;
    }
    return out;
  };

  function countFor(gid) {
    let n = 0;
    for (const [lot, r] of state) if (r.gang === gid && !lot.demolished) n++;
    return n;
  }

  // ============================================================
  //  HUNTERS — the retaliation squad. The reprisal grammar from gangs.js's
  //  sendReprisal, re-aimed: save the post, rage at the mark, raidT walks
  //  them home. Claimed bodies are never touched (the four-flags rule).
  // ============================================================
  function freeBody(m) {
    if (!m || m.dead || m.ko > 0 || m.inCar || m.companion || m.restraint || m.controlled) return false;
    if (m._occupyGarrison || m._wRole || m._op || m._sqRole) return false;
    if (m.rage || m.hunting || (m.raidT || 0) > 0) return false;
    return true;
  }
  // send up to `count` of `gang`'s members after `mark` (an actor), staging
  // through (sx,sz) — the store — so the pursuit visibly starts at the scene.
  function sendHunters(gang, mark, sx, sz, count) {
    if (!gang || !mark || mark.dead) return 0;
    let sent = 0;
    for (const m of gang.members || []) {
      if (sent >= count) break;
      if (!freeBody(m)) continue;
      const d = Math.hypot(m.pos.x - sx, m.pos.z - sz);
      if (d > 320) continue;                      // nobody teleports across the city
      m.homeGuard = m.homeGuard || m.guard;
      m.rage = mark; m.state = "fight";
      if (m.target && m.target.set) m.target.set(sx + (rng() - 0.5) * 4, 0, sz + (rng() - 0.5) * 4);
      m.pause = 0; m.path = null;
      m.raidT = 20 + rng() * 12; m.raidGang = null;
      m.hunting = true;
      sent++;
    }
    return sent;
  }

  // ============================================================
  //  MEMORY BOOKKEEPING — a robbery is a fact with a day on it.
  // ============================================================
  const GRUDGE_DAYS = 3;        // "robbed yesterday" stays hot this long
  const MEM_CAP = 6;

  function recordRob(lot, by, cash) {
    const r = recFor(lot);
    r.robs.push({ b: by, d: dayNow(), c: Math.max(0, cash | 0), a: 0 });
    while (r.robs.length > MEM_CAP) r.robs.shift();
    r.fear = clamp(r.fear + 0.15, 0, 1);
    // the protector FAILED to prevent it — grip slips now, pursuit can win
    // part of it back (that pursuit-or-lose-the-store rule is the owner's).
    if (r.gang && by !== r.gang) r.trust = clamp(r.trust - 0.22, 0, 1);
    return r.robs[r.robs.length - 1];
  }

  function grudgeVsPlayer(lot) {
    const r = state.get(lot);
    if (!r) return null;
    const rb = lastRobBy(r, "player");
    if (!rb) return null;
    return (dayNow() - rb.d) <= GRUDGE_DAYS ? rb : null;
  }

  // ============================================================
  //  RESPONSE — what the world does when a store on the ledger gets hit.
  //  `robber` is an actor for street pursuit ("player" → playerActor), or a
  //  gang id string for abstract attribution.
  // ============================================================
  function respondToRob(lot, rec, robEntry, byId, robberPed) {
    const prot = rec.gang;
    const door = lotDoor(lot);
    if (!prot || prot === byId) return;

    // ---- the PLAYER's protected store got hit ------------------------------
    if (isPlayerSide(prot)) {
      if (byId === "player") return;              // you robbed your own racket; the trust hit already landed
      const who = robberPed ? (robberPed.name || "somebody") : sideName(byId);
      note("" + storeName(lot) + " got hit by " + who + " — get the money back.", 4, { from: storeName(lot), app: "biz", urgent: true });
      if (robberPed && CBZ.cityMarkTarget) CBZ.cityMarkTarget(robberPed);
      // your own soldiers give chase if any are posted near (founded crew)
      const pg = gangRec("player") || (CBZ.cityGangs || []).find((x) => x && x.isPlayer);
      if (pg && robberPed) {
        const n = sendHunters(pg, robberPed, door.x, door.z, 2);
        if (n) robEntry.a = 1;                    // the crew moved — the owner saw it
      }
      return;
    }

    // ---- an NPC crew's protected store got hit -----------------------------
    const gang = gangRec(prot);
    if (!gang || gang.absorbed) return;

    if (byId === "player") {
      // your own crew lets family slide with a standing hit; anyone else HUNTS.
      if (gang.playerFriendly) {
        if (CBZ.cityGangAddStanding) CBZ.cityGangAddStanding(gang.id, -14);
        note("Word gets back to the " + gang.name + ". That store kicks up to THEM.", 3, { from: "Crew" });
        robEntry.a = 1;                            // the family "handled it" internally
        return;
      }
      if (CBZ.cityGangProvoke) CBZ.cityGangProvoke(gang.id, 0.6);
      if (CBZ.cityGangAddStanding) CBZ.cityGangAddStanding(gang.id, -10);
      const pa = playerActor();
      const n = pa ? sendHunters(gang, pa, door.x, door.z, 2 + ((rng() * 2) | 0)) : 0;
      if (n) {
        robEntry.a = 1;                            // they PURSUED — the owner stays convinced
        rec.trust = clamp(rec.trust + 0.12, 0, 1);
        note("The " + gang.name + " protect " + storeName(lot) + " — and they're coming.", 3.2);
      } else {
        // nobody free, nobody near: the crew visibly let it slide. The owner's
        // faith drops hard — this is the opening a rival extortion walks into.
        rec.trust = clamp(rec.trust - 0.2, 0, 1);
        gang.hostility = Math.min(5, (gang.hostility || 0) + 1);   // they still want you later
        news("The " + gang.name + " let the " + storeName(lot) + " stick-up slide. The block noticed.");
      }
      return;
    }

    // NPC robbed an NPC-protected store: the beef is REAL now — the protector
    // hunts the robber to take the cash back, and the crews' relation sours.
    const rGang = gangRec(byId);
    if (robberPed) {
      const n = sendHunters(gang, robberPed, door.x, door.z, 2);
      if (n) robEntry.a = 1;
    }
    if (rGang && CBZ.cityDeclareWar) CBZ.cityDeclareWar(gang.id, rGang.id);
    if (rGang && CBZ.cityStartGangWar && rng() < 0.5 && rGang.turf && rGang.turf.length) {
      // a raid on the robbers' block answers the insult where it lives
      CBZ.cityStartGangWar(gang, rGang, { lot: rGang.turf[(rng() * rGang.turf.length) | 0] });
    }
  }

  // ============================================================
  //  ROB — the counter verb. Every dollar out of cityTill; consequences are
  //  robTill's (shops.js) plus the ledger's memory + protector response.
  // ============================================================
  const ARMED_KINDS = { jewelry: 1, casino: 1, security: 1, drugs: 1, guns: 1 };

  function playerDrip() { return CBZ.cityPlayerDrip ? (CBZ.cityPlayerDrip() || 0) : 0; }

  function robCounter(lot, opts) {
    if (!on() || !lot || g.mode !== "city") return false;
    opts = opts || {};
    const armed = opts.armed !== false;           // gunpoint by default
    const v = vendorOf(lot);
    const door = lotDoor(lot);
    const pa = playerActor();

    // BANKS: the drawer is caged and the money is a vault problem — the card
    // says so instead of pretending a register exists (bank.js owns the teller
    // drawers and the strongroom; both already have their own verbs).
    if (lot.kind === "bank") {
      const dr = CBZ.cityBankDrawerAt && CBZ.cityBankDrawerAt(CBZ.player.pos.x, CBZ.player.pos.z, 6, CBZ.player.pos.y || 0);
      if (dr && CBZ.cityBankDrawerTake) {
        CBZ.cityBankDrawerTake(dr);               // its own heat/alarm/payout
        recordRob(lot, "player", 0);
        const r = recFor(lot);
        respondToRob(lot, r, r.robs[r.robs.length - 1], "player", null);
      } else {
        note("The teller float is caged — the real money is behind the vault door.", 2.6);
      }
      return true;
    }

    // A GUN-COUNTER KEEPER GOES FOR HIS IRON. The armed trades resist: how
    // often is your intimidation (respect + drip + the drawn gun), same curve
    // as shops.js's robTill so the two stick-up paths read as one rule.
    const intimidation = Math.min(0.9, 0.45 + (g.respect || 0) / 600 + playerDrip() / 150 + (armed ? 0.2 : 0));
    const resisted = ARMED_KINDS[lot.kind] && Math.random() > intimidation;
    if (resisted && v && v.armed) {
      // the counterman draws instead of paying — now it's a gunfight.
      v.rage = pa || null; v.state = "fight"; v.fear = 0; v.surrender = false; v.poseHandsUp = false;
      note("" + (v.name || "The keeper") + " goes for the iron under the counter!", 2.4);
      if (CBZ.cityAlarm) CBZ.cityAlarm(door.x, door.z, 22, 1.4, pa);
      if (CBZ.cityCrime) CBZ.cityCrime(200, { instant: true, x: door.x, z: door.z, type: "store robbery" });
      recordRob(lot, "player", 0);
      const rr = recFor(lot);
      respondToRob(lot, rr, rr.robs[rr.robs.length - 1], "player", null);
      return true;
    }

    const r = CBZ.cityTill.take(lot, { point: "register", frac: resisted ? (0.3 + Math.random() * 0.3) : 1, by: "player", rob: true });
    const take = (r && r.taken) | 0;
    if (take > 0) {
      CBZ.city.addCash(take);
      big((armed ? "REGISTER EMPTIED" : "TILL GRABBED") + " +$" + take);
      if (CBZ.sfx) CBZ.sfx("coin");
    } else {
      note("The drawer is empty — this place was already bled.", 2.2);
    }
    // the clerk's hands go up (citySurrender writes vendor fields directly —
    // markGunpoint refuses vendors, which is why this call, not that one)
    if (v && armed && CBZ.citySurrender) CBZ.citySurrender(v, { hold: 6, pause: 1.2, alarmed: 6, fear: 9, toward: pa, panic: false });
    if (v && CBZ.cityRelShift) CBZ.cityRelShift(v, "robbed");
    if (v && CBZ.citySay) CBZ.citySay(v, take > 0 ? "“Take it — take it and GO.”" : "“There's nothing IN it, man!”", "#ffb09b", 2.2);

    // heat + panic: the exact robTill consequence block (shops.js) — one rule.
    if (CBZ.cityCrime) CBZ.cityCrime(resisted ? 220 : (armed ? 170 : 90), { instant: armed, x: door.x, z: door.z, type: armed ? "store robbery" : "till grab" });
    if (CBZ.cityAlarm) CBZ.cityAlarm(door.x, door.z, 22, resisted ? 1.4 : 1, pa);
    if (CBZ.cityPanic && armed) CBZ.cityPanic(door.x, door.z, 1.2, pa);
    if (CBZ.cityTagWitnesses) CBZ.cityTagWitnesses(door.x, door.z, armed ? 60 : 35, "robbery");
    CBZ.city.addRespect(resisted ? 4 : 2);
    if (CBZ.citySpawnCop && armed && (resisted || Math.random() < 0.5)) {
      const ang = Math.random() * Math.PI * 2, dd = 26 + Math.random() * 10;
      CBZ.citySpawnCop(door.x + Math.cos(ang) * dd, door.z + Math.sin(ang) * dd, false);
    }

    // THE LEDGER: the fact, the day, the money — then the world answers it.
    const rec = recFor(lot);
    const entry = recordRob(lot, "player", take);
    respondToRob(lot, rec, entry, "player", null);

    // BRING IT TO THE HQ: riding with a crew, a cut of every score is owed up
    // the chain — the kick-up happens when you physically walk it in (below).
    if (take > 0 && playerSideId() && !isPlayerSide(rec.gang)) {
      hotCash += Math.round(take * 0.2);
      note("Crew rule: kick up a cut at the HQ — $" + Math.round(take * 0.2) + " of that is theirs.", 2.6, { from: "Crew" });
    }
    return true;
  }

  // force the drop safe at gunpoint — the second rung when the drawer's thin.
  function robSafe(lot) {
    if (!on() || !lot) return false;
    const door = lotDoor(lot);
    const r = CBZ.cityTill.take(lot, { point: "safe", by: "player", rob: true });
    const take = (r && r.taken) | 0;
    if (take > 0) { CBZ.city.addCash(take); big("DROP SAFE CRACKED +$" + take); if (CBZ.sfx) CBZ.sfx("coin"); }
    else note("The drop safe is empty.", 1.8);
    if (CBZ.cityCrime) CBZ.cityCrime(180, { instant: true, x: door.x, z: door.z, type: "store robbery" });
    if (CBZ.cityAlarm) CBZ.cityAlarm(door.x, door.z, 20, 1.2, playerActor());
    CBZ.city.addRespect(3);
    const rec = recFor(lot);
    const entry = recordRob(lot, "player", take);
    respondToRob(lot, rec, entry, "player", null);
    return true;
  }

  // ============================================================
  //  EXTORT — the conquest verb. Acceptance is the owner's arithmetic:
  //  fear of you vs faith in whoever already runs the block.
  // ============================================================
  function acceptChance(lot, rec) {
    let c = 0.3;
    c += rec.fear * 0.4;                                   // a terrified owner signs
    c += Math.min(0.45, unavengedCount(rec) * 0.15);       // robberies nobody answered — the grip already slipped
    c += Math.min(0.2, (g.respect || 0) / 400);            // your name carries
    const rb = grudgeVsPlayer(lot);
    if (rb) c += 0.15;                                     // "yesterday YOU proved nobody stops you"
    if (rec.gang) c -= rec.trust * 0.55;                   // faith in the current crew resists you
    if (ownerBrave(lot)) c -= 0.22;                        // brave owners hold out
    if (lot.kind === "bank" || lot.kind === "casino") c -= 0.15;  // real security to lean on
    return clamp(c, 0.05, 0.95);
  }

  function extortCounter(lot) {
    if (!on() || !lot || g.mode !== "city") return false;
    const mySide = playerSideId() || "player";   // solo extortion runs under your own name — founding a crew is where it leads
    const rec = recFor(lot);
    const v = vendorOf(lot);
    const door = lotDoor(lot);
    const pa = playerActor();
    const prevGang = rec.gang;

    if (isPlayerSide(rec.gang)) { note(storeName(lot) + " already pays " + (rec.gang === "player" ? "you" : "your crew") + ".", 2); return true; }

    // the crime is the DEMAND, not the outcome — heat files either way
    if (CBZ.cityCrime) CBZ.cityCrime(50, { x: door.x, z: door.z, type: "extortion" });
    if (v && CBZ.cityRelShift) CBZ.cityRelShift(v, "extorted");
    rec.fear = clamp(rec.fear + 0.08, 0, 1);

    const chance = acceptChance(lot, rec);
    if (Math.random() >= chance) {
      // REFUSED. A brave keeper squares up; a loyal one names his crew; word
      // reaches the protector either way — leaning on their store is a slight.
      if (v && ownerBrave(lot) && v.armed) {
        v.rage = pa || null; v.state = "fight"; v.fear = 0;
        note("" + (v.name || "The owner") + " won't be leaned on — and draws!", 2.6);
      } else if (rec.gang) {
        const nm = sideName(rec.gang);
        if (v && CBZ.citySay) CBZ.citySay(v, "“The " + nm + " keep us safe. Walk away.”", "#cfe6ff", 2.6);
        else note("“The " + nm + " keep us safe. Walk away.”", 2.4);
        const gp = gangRec(rec.gang);
        if (gp && !gp.playerFriendly && CBZ.cityGangProvoke) CBZ.cityGangProvoke(gp.id, 0.3);
        rec.trust = clamp(rec.trust + 0.05, 0, 1);         // saying no and surviving PROVES the crew
      } else {
        if (v && CBZ.citySay) CBZ.citySay(v, "“We don't pay. Get out.”", "#cfe6ff", 2.2);
        else note("“We don't pay. Get out.”", 2);
      }
      return true;
    }

    // ACCEPTED — the store signs. If a crew already ran it, this is a TAKING.
    if (prevGang && !isPlayerSide(prevGang)) rec._prevGang = prevGang;   // the reclaim director knows who was wronged
    rec.gang = mySide; rec.by = "player";
    rec.trust = clamp(0.3 + rec.fear * 0.3, 0, 1);         // fear-bought loyalty starts thin
    rec.sinceDay = dayNow(); rec.paidDay = dayNow();
    rec.owed = 0; rec.reclaim = 0;
    const trib = tributeOf(lot);
    if (v && CBZ.citySay) CBZ.citySay(v, "“…okay. Okay. " + money(trib) + " a day. Just keep the wolves off us.”", "#ffd9a8", 3);
    big(prevGang ? ("TERRITORY TAKEN — " + storeName(lot)) : ("PROTECTION SIGNED — " + storeName(lot)));
    note(storeName(lot) + " kicks up " + money(trib) + "/day" + (mySide === "player" ? " to you" : " to the " + sideName(mySide)) + ". Collect at the counter.", 3.4);
    CBZ.city.addRespect(prevGang ? 8 : 4);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    if (CBZ.cityRefreshTurfHud) CBZ.cityRefreshTurfHud();  // zones re-derive with the new store

    // the crew you took it FROM answers — that's the war the owner asked for
    if (prevGang && !isPlayerSide(prevGang)) {
      const gp = gangRec(prevGang);
      if (gp && !gp.absorbed && !gp.playerFriendly) {
        if (CBZ.cityGangProvoke) CBZ.cityGangProvoke(gp.id, 0.8);
        if (CBZ.cityGangAddStanding) CBZ.cityGangAddStanding(gp.id, -15);
        if (CBZ.citySetRelation) CBZ.citySetRelation(mySide === "player" ? "player" : mySide, gp.id, "war");
        gp.hostility = Math.min(5, (gp.hostility || 0) + 1.5);
        rec.reclaim = 2;                                    // they WILL come back for it
        if (pa) sendHunters(gp, pa, door.x, door.z, 2);
        news("The " + gp.name + " just lost " + storeName(lot) + " — " + (mySide === "player" ? "a new player is" : "the " + sideName(mySide) + " are") + " collecting on that block.");
      }
    }
    return true;
  }

  // ============================================================
  //  COLLECT — walk your rounds. Tribute accrues daily as a PROMISE (owed);
  //  the cash only moves when you stand at the counter and the drawer can
  //  actually pay (cityTill.take, non-hostile → conservation holds).
  // ============================================================
  function collectCounter(lot) {
    if (!on() || !lot) return false;
    const rec = state.get(lot);
    if (!rec || !isPlayerSide(rec.gang) || rec.owed <= 0) return false;
    const r = CBZ.cityTill.take(lot, { point: "register", max: rec.owed, by: "racket" });
    const paid = (r && r.taken) | 0;
    const v = vendorOf(lot);
    if (paid <= 0) {
      if (v && CBZ.citySay) CBZ.citySay(v, "“Drawer's light today — come back after we trade.”", "#cfe6ff", 2.4);
      else note("The drawer can't cover it today.", 2);
      return true;
    }
    rec.owed -= paid;
    rec.paidDay = dayNow();
    rec.trust = clamp(rec.trust + 0.04, 0, 1);             // a protector who SHOWS UP is believed
    const m = g.cityMembership;
    if (m && rec.gang === m.gangId) {
      // riding with a crew: the collector keeps a cut, the rest kicks up —
      // and the books remember who brought it in (rank progress).
      const cut = Math.round(paid * 0.3);
      CBZ.city.addCash(cut);
      const gp = gangRec(m.gangId);
      if (gp) gp.treasury = Math.min(8000, (gp.treasury || 0) + (paid - cut));
      if (CBZ.cityMemberPutInWork) CBZ.cityMemberPutInWork("cash", paid - cut);
      big("COLLECTED +$" + cut + " (crew cut $" + (paid - cut) + ")");
    } else {
      CBZ.city.addCash(paid);
      big("PROTECTION COLLECTED +$" + paid);
    }
    if (CBZ.sfx) CBZ.sfx("coin");
    if (v && CBZ.citySay) CBZ.citySay(v, "“We're square. Keep the wolves off, yeah?”", "#cfe6ff", 2.2);
    return true;
  }

  // ============================================================
  //  KICK-UP — "rob and bring the stolen money to gang HQ." A member's hot
  //  cut walks in on foot: stand at your crew's HQ and the books settle.
  // ============================================================
  let hotCash = 0;              // the cut you owe the crew from freelance scores
  function hqPoint() {
    const gid = playerSideId();
    if (!gid) return null;
    if (CBZ.cityGangHQ) { try { const h = CBZ.cityGangHQ(gid === "player" ? "player" : gid); if (h) return h; } catch (e) {} }
    const rec2 = gangRec(gid); return rec2 && rec2.center ? rec2.center : null;
  }
  function tickKickup() {
    if (hotCash <= 0) return;
    const gid = playerSideId();
    if (!gid) { hotCash = 0; return; }            // left the life — nobody to owe
    const hq = hqPoint();
    if (!hq) return;
    const P = CBZ.player;
    if (!P || Math.hypot(P.pos.x - hq.x, P.pos.z - hq.z) > 16) return;
    const pay = Math.min(hotCash, g.cash | 0);
    if (pay <= 0) return;
    g.cash -= pay; hotCash = 0;
    const gp = gangRec(gid);
    if (gp && !gp.isPlayer) gp.treasury = Math.min(8000, (gp.treasury || 0) + pay);
    if (CBZ.cityMemberPutInWork) CBZ.cityMemberPutInWork("cash", pay);
    if (CBZ.cityGangAddStanding && gid !== "player") CBZ.cityGangAddStanding(gid, 6);
    note("You kick up $" + pay + " at the HQ. The books remember.", 2.8, { from: "Crew" });
    if (CBZ.sfx) CBZ.sfx("coin");
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }

  // ============================================================
  //  OWNER MEMORY, WORN ON THE BODY — every posted vendor gets the ledger
  //  applied: a keeper you robbed inside GRUDGE_DAYS meets your return with
  //  a drawn pistol (brave) or raised, shaking hands (meek). The ped is
  //  recycled at 80m; the LOT record is what remembers, so this tick
  //  re-applies to whatever body is currently behind the counter.
  // ============================================================
  function applyOwnerMemory() {
    const P = CBZ.player;
    if (!P || P.dead) return;
    const px = P.pos.x, pz = P.pos.z;
    for (const [lot, rec] of state) {
      if (lot.demolished) continue;
      const v = lot.building && lot.building.vendor;
      if (!v || v.dead) continue;
      const rb = grudgeVsPlayer(lot);
      if (!rb) continue;
      const d = Math.hypot(v.pos.x - px, v.pos.z - pz);
      if (d > 26) { if (v._rkDrewOn) v._rkDrewOn = false; continue; }
      // seed the shared relationship axes so every OTHER system (avoidance,
      // pricing, snitching) reads the grudge too — not just this beat.
      if (!v._rkGrudged) {
        v._rkGrudged = true;
        const rel = CBZ.cityRel && CBZ.cityRel(v);
        if (rel) { rel.grudge = Math.max(rel.grudge || 0, 62); rel.fear = Math.max(rel.fear || 0, ownerBrave(lot) ? 10 : 55); rel.seen = true; }
      }
      if (d > 11 || v._rkDrewOn) continue;
      v._rkDrewOn = true;                          // once per approach
      const days = dayNow() - rb.d;
      const when = days <= 0 ? "today" : days === 1 ? "yesterday" : days + " days ago";
      if (ownerBrave(lot)) {
        // THE OWNER PULLS A GUN INSTEAD OF SAYING HI — armed off the ledger,
        // not the spawn table: the pistol came out of the back room after
        // you cleaned the drawer out.
        if (!v.armed) { v.armed = true; v.weapon = v.weapon || "Pistol"; v.ammo = Math.max(v.ammo | 0, 12); if (CBZ.syncActorWeapon) { try { CBZ.syncActorWeapon(v); } catch (e) {} } }
        v.nerve = Math.max(v.nerve || 0, 0.85);
        v.surrender = false; v.poseHandsUp = false; v.fear = 0;
        v.rage = playerActor() || null; v.state = "fight"; v.mem = playerActor() || null;
        if (CBZ.citySay) CBZ.citySay(v, "“YOU. You robbed us " + when + " — I kept something under the counter since.”", "#ff9b8b", 3);
        else note((v.name || "The owner") + " pulls a gun the second you walk in.", 2.6);
      } else {
        if (CBZ.citySurrender) CBZ.citySurrender(v, { hold: 4, pause: 1, fear: 10, toward: playerActor(), panic: false });
        if (CBZ.citySay) CBZ.citySay(v, "“P-please. You cleaned us out " + when + ". Just… take what you want.”", "#ffd9a8", 3);
        rec.fear = clamp(rec.fear + 0.05, 0, 1);   // terror compounds — extortion gets easier
      }
    }
  }

  // service refusal rides the same ledger: shops.js asks cityVendorRefuses
  // before opening the panel — a keeper you robbed this window won't trade.
  let _refuseWrapDone = false;
  function ensureRefuseWrap() {
    if (_refuseWrapDone) return;
    const prev = CBZ.cityVendorRefuses;
    if (typeof prev !== "function") return;        // social.js not up yet — retry next tick
    _refuseWrapDone = true;
    if (prev._racketWrap) return;
    const w = function (ped) {
      if (prev(ped)) return true;
      if (!on() || !ped || !ped.vendor) return false;
      return !!grudgeVsPlayer(ped.vendor);
    };
    w._racketWrap = true;
    CBZ.cityVendorRefuses = w;
  }

  // ============================================================
  //  OWNER REQUESTS — "store owners tell you what they want," read straight
  //  off the ledger. The verb is authored; the specifics are world facts.
  // ============================================================
  function requestLine(lot) {
    const rec = recFor(lot);
    const v = vendorOf(lot);
    const day = dayNow();

    // 1) an unavenged robbery — the owner wants his money back (names the
    //    actual robber when that body still walks the city)
    let openRob = null;
    for (let i = rec.robs.length - 1; i >= 0; i--) {
      const rb = rec.robs[i];
      if (!rb.a && rb.b !== "player" && (day - rb.d) <= 5) { openRob = rb; break; }
    }
    if (openRob) {
      const who = openRob.b && openRob.b !== "npc" ? "the " + sideName(openRob.b) : "some crook";
      const when = (day - openRob.d) <= 0 ? "today" : (day - openRob.d) === 1 ? "yesterday" : (day - openRob.d) + " days back";
      const ped = openRob._ped && !openRob._ped.dead ? openRob._ped : null;
      if (ped && CBZ.cityMarkTarget) CBZ.cityMarkTarget(ped);
      return { say: "“" + (who.charAt(0).toUpperCase() + who.slice(1)) + " emptied my register " + when + " — " + money(openRob.c) + " — and NOBODY did a thing. Get it back and I won't forget it.”",
               hint: ped ? "The robber is marked on your map — the cash walks with them." : "The money's gone with them — but the block remembers who let it happen." };
    }
    // 2) squeezed by a crew they don't believe in
    if (rec.gang && !isPlayerSide(rec.gang) && rec.trust < 0.35) {
      return { say: "“The " + sideName(rec.gang) + " bleed us " + money(tributeOf(lot)) + " a day and were NOWHERE when it mattered. Someone who actually kept us safe… we'd pay them instead.”",
               hint: "They'd sign with you — lean on them while the grip is loose." };
    }
    // 3) unprotected and scared
    if (!rec.gang && (rec.fear > 0.3 || unavengedCount(rec) > 0)) {
      return { say: "“Every week somebody walks in with a piece. We'd pay for REAL protection — someone the street actually fears.”",
               hint: "An open invitation — pull your gun and make the offer." };
    }
    // 4) yours — the state of the arrangement
    if (isPlayerSide(rec.gang)) {
      if (rec.owed > 0) return { say: "“We're good. Your cut's waiting — " + money(rec.owed) + " in the drawer.”", hint: "Collect at the counter." };
      return { say: "“Quiet week. That's what we pay for.”", hint: "" };
    }
    // 5) protected and content
    if (rec.gang) return { say: "“The " + sideName(rec.gang) + " look after us. We don't want trouble.”", hint: "Their trust in that crew is " + (rec.trust > 0.6 ? "solid — break it first" : "shakier than they let on") + "." };
    return { say: "“Business is business. You buying?”", hint: "" };
  }

  // ============================================================
  //  THE NPC RACKET DIRECTOR — rival crews play the same game: sign stores
  //  near their turf, collect daily, rob stores an ENEMY protects (a real
  //  walking robber carrying real cash), and reclaim what was taken.
  //  Time-sliced like turf.js's director; nothing here spawns a body.
  // ============================================================
  const ops = [];               // live walking ops: {kind:"rob"|"reclaim", ped, lot, gang, targetGangId, t, phase}

  function liveGangs() {
    return (CBZ.cityGangs || []).filter((x) => x && !x.isPlayer && !x.absorbed && !x.kind && x.turf && x.turf.length);
  }
  function nearPlayer(x, z, r) {
    const P = CBZ.player; if (!P || !P.pos) return false;
    const dx = P.pos.x - x, dz = P.pos.z - z; return dx * dx + dz * dz < r * r;
  }

  // a store worth SIGNING for `gang`: unprotected (or barely-held), near its
  // turf, real flow. Extortion-minded crews (cosa's extortsBiz) reach further.
  function pickSignTarget(gang) {
    const reach = gang.extortsBiz ? 340 : 240;
    let best = null, bs = -1;
    for (const lot of shopLots()) {
      if (!racketable(lot)) continue;
      const rec = state.get(lot);
      if (rec && rec.gang) continue;               // signed already — taking is a different op
      const d = Math.hypot(lot.cx - gang.center.x, lot.cz - gang.center.z);
      if (d > reach) continue;
      const s = (lot._rkFlow || 0) - d * 0.2 + rng() * 30;
      if (s > bs) { bs = s; best = lot; }
    }
    return best;
  }
  function npcSign(gang, lot) {
    const rec = recFor(lot);
    // the owner's arithmetic again — a crew's fear factor is its local muscle
    const chance = clamp(0.35 + rec.fear * 0.3 + Math.min(0.3, (gang.hostility || 0) * 0.06) + (gang.extortsBiz ? 0.15 : 0), 0.1, 0.9);
    if (rng() >= chance) { rec.fear = clamp(rec.fear + 0.04, 0, 1); return false; }
    rec.gang = gang.id; rec.by = gang.id;
    rec.trust = 0.35 + rng() * 0.2;
    rec.sinceDay = dayNow(); rec.paidDay = dayNow(); rec.owed = 0;
    if (nearPlayer(lot.cx, lot.cz, 160)) note("The " + gang.name + " just put " + storeName(lot) + " under protection.", 2.6);
    if (CBZ.cityRefreshTurfHud) CBZ.cityRefreshTurfHud();
    return true;
  }

  // a store worth ROBBING for `gang`: protected by an ENEMY — a crew it's at
  // war with, or the player's side once that crew has real heat on you. This
  // is where "gang fights won't be random" is enforced: the robbery has a
  // motive (an enemy's income), and the response has one too (keep the owner).
  function pickRobTarget(gang) {
    let best = null, bs = -1;
    for (const [lot, rec] of state) {
      if (!rec.gang || rec.gang === gang.id || lot.demolished) continue;
      if (isPlayerSide(rec.gang) && gang.playerFriendly) continue;   // family doesn't eat family
      if (rec.reclaim > 0 && rec._prevGang === gang.id) continue;    // a store you mean to TAKE BACK isn't one you stick up — the owner has to want you again
      const protId = rec.gang === "player" ? "player" : rec.gang;
      let enemy = !!(CBZ.cityAtWar && CBZ.cityAtWar(gang.id, protId));
      if (isPlayerSide(rec.gang) && !gang.playerFriendly && (gang.hostility || 0) >= 1) enemy = true;
      if (!enemy && rng() > 0.15) continue;         // mostly wars drive it; a little opportunism
      const d = Math.hypot(lot.cx - gang.center.x, lot.cz - gang.center.z);
      if (d > 320) continue;
      if (!nearPlayer(lot.cx, lot.cz, 220)) continue;   // beats are staged where they can be SEEN
      const s = (lot._rkFlow || 0) - d * 0.15 + (isPlayerSide(rec.gang) ? 40 : 0) + rng() * 20;
      if (s > bs) { bs = s; best = lot; }
    }
    return best;
  }

  // an op runner is OURS start to finish: when the errand ends (done, expired,
  // or aborted with the body still breathing and unclaimed) we hand the ped
  // back to the pool ourselves — raidT cleared, post restored — rather than
  // leaving gangs.js's raid-decay to find him. A dead or raging runner is
  // left alone: the brain (or the morgue) owns that body now.
  function releaseRunner(m) {
    if (!m || m.dead || m.rage) return;
    m.raidT = 0; m.raidLot = null;
    if (m.homeGuard) {
      m.guard = m.homeGuard;
      if (m.target && m.target.set) m.target.set(m.homeGuard.x, 0, m.homeGuard.z);
    }
    m.path = null; m.pause = 0;
  }

  function startOpWalk(gang, lot, kind, targetGangId) {
    let runner = null, bd = Infinity;
    for (const m of gang.members || []) {
      if (!freeBody(m) || m.rank === "boss") continue;
      const d = Math.hypot(m.pos.x - lot.cx, m.pos.z - lot.cz);
      if (d < bd) { bd = d; runner = m; }
    }
    if (!runner || bd > 300) return false;
    const door = lotDoor(lot);
    runner.homeGuard = runner.homeGuard || runner.guard;
    runner.guard = { x: door.x, z: door.z };
    if (runner.target && runner.target.set) runner.target.set(door.x, 0, door.z);
    runner.pause = 0; runner.path = null;
    runner.raidT = 40; runner.raidLot = lot; runner.raidGang = null;
    ops.push({ kind: kind, ped: runner, lot: lot, gang: gang, targetGangId: targetGangId || null, t: 40, phase: "walk" });
    return true;
  }

  function tickOps(dt) {
    for (let i = ops.length - 1; i >= 0; i--) {
      const op = ops[i];
      const m = op.ped, lot = op.lot;
      op.t -= dt;
      const gone = !m || m.dead || m.ko > 0 || lot.demolished || op.t <= 0 || m._wRole || m.rage;
      if (gone) {
        // a robber DIED carrying the take: the cash is on the body (ped.cash
        // rides the walk-over loot) — recovery is literal, go pick it up.
        if (op.kind === "rob" && m && m.dead && m._rkLoot > 0) {
          const rec = state.get(lot);
          if (rec) {
            const rb = lastRobBy(rec, op.gang.id);
            if (rb) { rb.a = 1; }
            rec.trust = clamp(rec.trust + 0.15, 0, 1);
            if (nearPlayer(m.pos.x, m.pos.z, 120)) note("The " + storeName(lot) + " robber is down — the take is on the body.", 3);
          }
        }
        if (op.kind === "reclaim" && m && m.dead) {
          const rec = state.get(lot);
          if (rec && isPlayerSide(rec.gang)) {
            rec.trust = clamp(rec.trust + 0.15, 0, 1);
            note("You held " + storeName(lot) + " — the " + op.gang.name + " collector won't be back today.", 3);
            if (CBZ.cityGangProvoke && !op.gang.playerFriendly) CBZ.cityGangProvoke(op.gang.id, 0.4);
          }
        }
        releaseRunner(m);
        ops.splice(i, 1);
        continue;
      }
      const door = lotDoor(lot);
      const d = Math.hypot(m.pos.x - door.x, m.pos.z - door.z);
      if (op.phase === "walk" && d < 3.2) {
        op.phase = "at"; op.hold = op.kind === "reclaim" ? 4 : 1.6;
      } else if (op.phase === "at") {
        op.hold -= dt;
        const v = vendorOf(lot);
        if (v && !v.surrender && op.kind === "rob" && CBZ.citySurrender) CBZ.citySurrender(v, { hold: 3, fear: 9, toward: m, panic: false });
        if (op.hold > 0) continue;
        if (op.kind === "rob") {
          const r = CBZ.cityTill.take(lot, { point: "register", frac: 0.5 + rng() * 0.4, by: op.gang.name, rob: true });
          const take = (r && r.taken) | 0;
          m.cash = (m.cash | 0) + take;            // ON THE BODY — killable, lootable, recoverable
          m._rkLoot = take;
          const rec = recFor(lot);
          const entry = recordRob(lot, op.gang.id, take);
          entry._ped = m;
          if (CBZ.cityAlarm) CBZ.cityAlarm(door.x, door.z, 18, 0.9, m);
          if (nearPlayer(door.x, door.z, 140)) note("The " + op.gang.name + " are hitting " + storeName(lot) + "!", 2.8);
          respondToRob(lot, rec, entry, op.gang.id, m);
          // walk it home: treasury banks only when the body makes it back
          op.phase = "home"; op.t = Math.min(op.t, 30);
          m.guard = m.homeGuard || (op.gang.center ? { x: op.gang.center.x, z: op.gang.center.z } : m.guard);
          if (m.target && m.target.set && m.guard) m.target.set(m.guard.x, 0, m.guard.z);
          m.path = null; m.pause = 0;
        } else {
          // RECLAIM: the collector stood at the counter unopposed — the owner
          // folds back to the crew that showed up. Stopping this beat (kill
          // or scare the collector) is how a protector KEEPS a taken store.
          const rec = state.get(lot);
          if (rec && !isPlayerSide(op.gang.id) && rec.gang && isPlayerSide(rec.gang)) {
            rec.gang = op.gang.id; rec.by = op.gang.id;
            rec.trust = 0.3; rec.owed = 0; rec.sinceDay = dayNow();
            news("The " + op.gang.name + " took " + storeName(lot) + " back — their collector walked in and nobody stopped him.");
            if (CBZ.cityRefreshTurfHud) CBZ.cityRefreshTurfHud();
          }
          releaseRunner(m);
          ops.splice(i, 1);
        }
      } else if (op.phase === "home") {
        const home = m.guard || m.homeGuard;
        if (home && Math.hypot(m.pos.x - home.x, m.pos.z - home.z) < 6) {
          op.gang.treasury = Math.min(8000, (op.gang.treasury || 0) + (m._rkLoot | 0));
          m._rkLoot = 0;
          releaseRunner(m);
          ops.splice(i, 1);
        }
      }
    }
  }

  // schedule a reclaim attempt on player-held stores taken from NPC crews
  function tickReclaims() {
    for (const [lot, rec] of state) {
      if (!rec.reclaim || !isPlayerSide(rec.gang) || lot.demolished) continue;
      if (!nearPlayer(lot.cx, lot.cz, 260)) continue;      // staged where the defense can happen
      if (ops.some((o) => o.lot === lot)) continue;
      const wronged = rec._prevGang && gangRec(rec._prevGang);
      // whoever we flipped it FROM (tracked at flip time via provoke wiring);
      // fall back to the most provoked hostile crew near the store.
      let gp = wronged;
      if (!gp) {
        let bs = 0;
        for (const cand of liveGangs()) {
          const h = (cand.hostility || 0) + (cand.provoke || 0);
          const d = Math.hypot(cand.center.x - lot.cx, cand.center.z - lot.cz);
          if (d < 320 && h > bs) { bs = h; gp = cand; }
        }
      }
      if (!gp || gp.playerFriendly) continue;
      if (rng() > 0.25) continue;                           // not every tick — a looming threat, not a metronome
      if (startOpWalk(gp, lot, "reclaim", null)) {
        rec.reclaim--;
        note("The " + gp.name + " are moving on " + storeName(lot) + " — hold it or lose it.", 3.4, { from: storeName(lot), app: "biz", urgent: true });
      }
    }
  }

  // ============================================================
  //  THE DAILY BOOKS — tribute accrues by calendar day (onNewDay when
  //  polity's clock is up, else a dayCount watcher). NPC crews run their
  //  rounds off-screen: the till pays what it can bear, the treasury banks
  //  it. Player-side stores accrue OWED for the in-person collect.
  // ============================================================
  let _lastBookDay = -1;
  function runDailyBooks(day) {
    if (!on() || g.mode !== "city") return;
    for (const [lot, rec] of state) {
      if (!rec.gang || lot.demolished) { continue; }
      const trib = tributeOf(lot);
      if (isPlayerSide(rec.gang)) {
        rec.owed = Math.min(trib * 4, rec.owed + trib);     // uncollected rounds pile up (and cap — drawers aren't bottomless)
      } else {
        const gp = gangRec(rec.gang);
        if (!gp || gp.absorbed) { rec.gang = null; continue; }
        const r = CBZ.cityTill.take(lot, { point: "register", max: trib, by: gp.name });
        const paid = (r && r.taken) | 0;
        gp.treasury = Math.min(8000, (gp.treasury || 0) + paid);
        // a store that can't pay drifts loose; one that pays full stays held
        if (paid >= trib * 0.7) rec.trust = clamp(rec.trust + 0.02, 0, 1);
        else rec.fear = clamp(rec.fear - 0.03, 0, 1);
      }
      // old wounds close: robbery memory ages out of the acceptance math
      while (rec.robs.length && (day - rec.robs[0].d) > 7) rec.robs.shift();
    }
  }
  let _newDayHooked = false;
  function ensureDayHook() {
    if (_newDayHooked) return;
    if (typeof CBZ.onNewDay === "function") {
      _newDayHooked = true;
      CBZ.onNewDay(function (day) { try { runDailyBooks(day | 0); } catch (e) {} });
    }
  }

  // ============================================================
  //  PERSISTENCE — led.racket, the worldstate _xWrap idiom exactly (module-
  //  local one-shot boolean; stamp before delegating; wrap BOTH commit and
  //  collect; hydrate on ledger REFERENCE change; seed-guard the apply).
  //  Lots are stored as INDICES into arena.lots (seed-deterministic worlds).
  // ============================================================
  let _wrapsDone = false, _hydrated = null, _blob = null, _needApply = false;

  function serialize() {
    const A = arena();
    if (!A || !A.lots) return null;
    const lots = A.lots;
    const stores = [];
    for (const [lot, r] of state) {
      if (!r.gang && !r.robs.length && r.fear <= 0.13) continue;   // empty records don't ride
      const idx = lots.indexOf(lot);
      if (idx < 0) continue;
      stores.push([idx, r.gang || "", Math.round(r.fear * 100), Math.round(r.trust * 100),
        r.owed | 0, r.paidDay | 0, r.sinceDay | 0, r.reclaim | 0,
        r.robs.map((rb) => [rb.b || "", rb.d | 0, rb.c | 0, rb.a ? 1 : 0])]);
    }
    return { v: 1, seed: CBZ.WORLD_SEED >>> 0, hot: hotCash | 0, stores: stores };
  }
  function stamp() {
    if (!on()) return;
    const led = g.cityWorld;
    if (!led || typeof led !== "object") return;
    if (_needApply) return;                        // never clobber a not-yet-applied save
    if (g.mode !== "city") return;
    const b = serialize();
    if (b) { led.racket = b; _blob = b; }
  }
  function ensureSaveWraps() {
    if (_wrapsDone) return;
    const commit = CBZ.cityWorldCommit;
    if (typeof commit !== "function") return;      // worldstate.js not up yet — retry next tick
    _wrapsDone = true;
    if (!commit._racketWrap) {
      const w = function () { stamp(); return commit.apply(this, arguments); };
      w._racketWrap = true; CBZ.cityWorldCommit = w;
    }
    if (CBZ.cityWorldCollect && !CBZ.cityWorldCollect._racketWrap) {
      const col = CBZ.cityWorldCollect;
      const wc = function () { stamp(); return col.apply(this, arguments); };
      wc._racketWrap = true; CBZ.cityWorldCollect = wc;
    }
  }
  function hydrateLedger() {
    const led = g.cityWorld;
    if (!led || led === _hydrated) return;
    _hydrated = led;
    const b = led.racket;
    if (b && b.v === 1) { _blob = b; _needApply = true; }
    else _blob = null;
  }
  function maybeApply() {
    if (!_needApply) return;
    const A = arena();
    if (!A || !A.lots || !A.lots.length) return;   // wait for the world
    _needApply = false;
    const b = _blob;
    if (!b || b.v !== 1 || (b.seed >>> 0) !== (CBZ.WORLD_SEED >>> 0)) return;
    state.clear(); stateArena = A;
    hotCash = b.hot | 0;
    for (const row of b.stores || []) {
      const lot = A.lots[row[0]];
      if (!lot || !lot.building || !lot.building.shop) continue;
      const r = recFor(lot);
      r.gang = row[1] || null;
      // a saved protector that no longer exists (absorbed between sessions)
      // releases the store rather than haunting it
      if (r.gang && r.gang !== "player" && !gangRec(r.gang) && !isPlayerSide(r.gang)) r.gang = null;
      r.fear = clamp((row[2] | 0) / 100, 0, 1);
      r.trust = clamp((row[3] | 0) / 100, 0, 1);
      r.owed = row[4] | 0; r.paidDay = row[5] | 0; r.sinceDay = row[6] | 0; r.reclaim = row[7] | 0;
      r.robs = (row[8] || []).map((p) => ({ b: p[0] || "npc", d: p[1] | 0, c: p[2] | 0, a: !!p[3] }));
    }
    if (CBZ.cityRefreshTurfHud) CBZ.cityRefreshTurfHud();
  }

  // ============================================================
  //  RESET — a rebuilt arena orphans every lot key; drop and re-derive.
  // ============================================================
  CBZ.cityRacketReset = function () {
    state.clear(); ops.length = 0; hotCash = 0;
    stateArena = null; _needApply = !!_blob;       // a fresh spawn re-applies the save
  };

  // ============================================================
  //  INTERACTIONS — the verbs. Gunpoint card: hold a drawn gun on a keeper
  //  and the counter's menu IS the demand (rob / extort / the safe). The
  //  registry's gunpoint grammar shows ONLY these rows there — buying and
  //  small talk come back the moment the gun is holstered.
  // ============================================================
  const I = CBZ.interactions;
  if (I && I.registerSource) {
    const REACH = I.REACH || 5.2;
    I.registerSource({
      id: "src-vendor-gunpoint", kind: "vendor:gunpoint", layers: ["ped:vendor:gp"], prio: 30, gunpoint: true, driving: false,
      find: function (px, pz, ctx, push) {
        if (!on() || !ctx.gunDrawn) return;
        let best = null, bd = REACH + 0.8;
        for (const p of CBZ.cityPeds || []) {
          if (!p.vendor || p.dead) continue;
          const d = Math.hypot(p.pos.x - px, p.pos.z - pz);
          if (d < bd) { bd = d; best = p; }
        }
        if (!best || !racketable(best.vendor)) return;
        // an unarmed keeper's hands go up under the muzzle (citySurrender is
        // the vendor-safe writer; armed gun-counter keepers keep their cool)
        if (!best.armed && CBZ.citySurrender && (best._rkGpT || 0) <= (CBZ.now || 0)) {
          best._rkGpT = (CBZ.now || 0) + 900;
          CBZ.citySurrender(best, { hold: 1.2, pause: 0.4, fear: 8, toward: ctx.actor, panic: false });
        }
        push(best, bd);
      },
    });
    I.describe("vendor:gunpoint", function (v) {
      const lot = v.vendor;
      const reg = (CBZ.cityTill && CBZ.cityTill.holds) ? CBZ.cityTill.holds(lot, { point: "register" }).amount | 0 : 0;
      const rec = state.get(lot);
      const prot = rec && rec.gang ? (isPlayerSide(rec.gang) ? "yours" : "the " + sideName(rec.gang) + "'s") : "nobody's";
      return { label: storeName(lot), note: (lot.kind === "bank" ? "The float is caged" : "Register ~" + money(reg)) + " · this block is " + prot };
    });
    // E — ROB. The register empties through the till ledger; the protector answers.
    I.register("ped:vendor:gp", {
      id: "rk-gp-rob", slot: "e", needsGunDrawn: true, bad: true,
      label: function (v) { return v.vendor && v.vendor.kind === "bank" ? "Make the teller pay out" : "Empty the register"; },
      onSelect: function (v) { if (v.vendor) robCounter(v.vendor, { armed: true }); },
    });
    // I — EXTORT. The conquest verb: the store signs, or names its crew.
    I.register("ped:vendor:gp", {
      id: "rk-gp-extort", slot: "i", needsGunDrawn: true, bad: true,
      label: function (v) {
        const rec = v.vendor && state.get(v.vendor);
        if (rec && rec.gang && !isPlayerSide(rec.gang)) return "Take over the protection";
        if (rec && isPlayerSide(rec.gang)) return "Remind them who runs this";
        return "Demand protection money";
      },
      onSelect: function (v) { if (v.vendor) extortCounter(v.vendor); },
    });
    // J — the DROP SAFE, when this trade keeps one and it holds anything.
    I.register("ped:vendor:gp", {
      id: "rk-gp-safe", slot: "j", needsGunDrawn: true, bad: true,
      canShow: function (v) {
        if (!v.vendor || !CBZ.cityTill || !CBZ.cityTill.holds) return false;
        try { return (CBZ.cityTill.holds(v.vendor, { point: "safe" }).amount | 0) > 0; } catch (e) { return false; }
      },
      label: "Force the drop safe",
      onSelect: function (v) { if (v.vendor) robSafe(v.vendor); },
    });

    // ---- calm-counter verbs (no gun): the ledger speaks through the owner --
    // J — ASK. The request line reads the world's actual events back to you.
    I.register("ped:vendor", {
      id: "rk-ask", slot: "j", prio: 20,
      canShow: function (v) { return on() && !!v.vendor && !v.vendor.demolished && racketable(v.vendor); },
      label: "Ask what's going on",
      onSelect: function (v) {
        const q = requestLine(v.vendor);
        if (CBZ.citySay) CBZ.citySay(v, q.say, "#cfe6ff", 3.4); else note(q.say, 3);
        if (q.hint) note(q.hint, 3, { from: storeName(v.vendor) });
      },
    });
    // L — COLLECT, on your own stores with money waiting.
    I.register("ped:vendor", {
      id: "rk-collect", slot: "l", prio: 20,
      canShow: function (v) {
        if (!on() || !v.vendor) return false;
        const rec = state.get(v.vendor);
        return !!(rec && isPlayerSide(rec.gang) && rec.owed > 0);
      },
      label: function (v) { const rec = state.get(v.vendor); return "Collect protection — " + money(rec ? rec.owed : 0); },
      onSelect: function (v) { collectCounter(v.vendor); },
    });
  }

  // ============================================================
  //  THE TICK — one ordered loop drives everything, time-sliced so no
  //  frame pays for the whole racket. 34.75: after gangs (34.5/34.6) and
  //  gangops (34.7/34.72), so wars and reprisals are settled state.
  // ============================================================
  let signT = 6, robT = 14, memT = 0, reclaimT = 8, dayT = 2, slice = 0;

  CBZ.onUpdate(34.75, function (dt) {
    if (g.mode !== "city" || !on()) return;

    ensureSaveWraps();
    hydrateLedger();
    ensureRefuseWrap();
    ensureDayHook();

    // arena flip (rebuild/regen) — old lot keys are garbage; reset + reapply
    const A = arena();
    if (A && stateArena && A !== stateArena) CBZ.cityRacketReset();
    if (A && !stateArena) stateArena = A;
    maybeApply();

    // walking ops + the kick-up watcher run every tick (cheap, few bodies)
    tickOps(dt);
    tickKickup();

    // fallback day watcher when polity's onNewDay isn't in the build
    if (!_newDayHooked) {
      dayT -= dt;
      if (dayT <= 0) {
        dayT = 5;
        const d = dayNow();
        if (_lastBookDay < 0) _lastBookDay = d;
        else if (d !== _lastBookDay) { _lastBookDay = d; runDailyBooks(d); }
      }
    }

    // owner memory: re-applied to whatever body is behind the counter
    memT -= dt;
    if (memT <= 0) { memT = 0.8; applyOwnerMemory(); }

    // the directors, round-robined — one heavy job per tick at most
    signT -= dt; robT -= dt; reclaimT -= dt;
    slice = (slice + 1) % 3;
    if (slice === 0 && signT <= 0) {
      signT = 18 + rng() * 14;
      const gangs = liveGangs();
      if (gangs.length) {
        // the crew hungriest for paper moves first (cosa's whole archetype)
        const gp = gangs[(rng() * gangs.length) | 0];
        const lot = pickSignTarget(gp);
        if (lot) npcSign(gp, lot);
      }
    } else if (slice === 1 && robT <= 0) {
      robT = 30 + rng() * 24;
      const gangs = liveGangs();
      if (gangs.length) {
        const gp = gangs[(rng() * gangs.length) | 0];
        const lot = pickRobTarget(gp);
        if (lot) startOpWalk(gp, lot, "rob", state.get(lot) && state.get(lot).gang);
      }
    } else if (slice === 2 && reclaimT <= 0) {
      reclaimT = 16 + rng() * 10;
      tickReclaims();
      // demolished stores fall off the ledger (and out of every crew's books)
      for (const [lot, rec] of state) {
        if (lot.demolished && rec.gang) {
          if (nearPlayer(lot.cx, lot.cz, 200)) news(storeName(lot) + " is rubble — the " + sideName(rec.gang) + " protection racket there died with it.");
          rec.gang = null; rec.owed = 0;
        }
      }
    }
  });

  // ============================================================
  //  PUBLIC SURFACE
  // ============================================================
  CBZ.cityRacket = {
    of: function (lot) { return state.get(lot) || null; },
    ownerOf: ownerOf,
    rob: function (lot, opts) { return robCounter(lot, opts); },
    extort: function (lot) { return extortCounter(lot); },
    collect: collectCounter,
    stores: function () { return CBZ.cityRacketStores(); },
    count: countFor,
    tribute: tributeOf,
    hot: function () { return hotCash; },
    serialize: serialize,
    reset: CBZ.cityRacketReset,
    // the audit: counts a check harness can pin (mirrors cityTillAudit's shape)
    audit: function () {
      let prot = 0, mine = 0, robsOpen = 0;
      for (const [lot, r] of state) {
        if (r.gang) prot++;
        if (isPlayerSide(r.gang)) mine++;
        robsOpen += unavengedCount(r);
      }
      return { tracked: state.size, protected: prot, mine: mine, unavenged: robsOpen, ops: ops.length, hot: hotCash };
    },
  };
})();
