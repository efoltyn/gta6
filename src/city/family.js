/* ============================================================
   city/family.js — HOUSES THAT MATTER: pools + the people in them.
   WHY (the whole loop in one file): homes show wealth (a real backyard
   pool sized to the address — a modest plunge pool on a tier-2 lot, a
   resort-style L-pool with a spa and a diving board on a mansion),
   wealth houses FAMILY (a wife, kids, a boss's mistress at a second
   address nobody is supposed to know about), and family is LEVERAGE.
   A boss's people can be robbed, taken at gunpoint (the hostage flow
   works on them) or killed — which the set takes PERSONALLY (they carry
   the gang colors, so the vendetta/witness system in gangs.js fires).
   And once YOU own a real home, you get people too — they keep a real
   DAILY ROUTINE around the house (mornings indoors, kids in the yard,
   meals on the clock, evenings in, sleep at night), they greet you when
   you come home and worry when you're hurt or hunted — and crews you've
   bled will snatch them and ring you with a number. Pay, or come take
   them back. That's why the houses exist.

   READ-ONLY SOURCE OF TRUTH (other modules consume these):
     CBZ.cityFamilies : Array<Family>
       Family = {
         gangId   : number   // 0 == the PLAYER's own family; else owning gang id
         mine     : bool     // convenience: gangId === 0
         homeX,homeZ : number  // backyard anchor (where they live their day)
         houseX,houseZ : number// house centre (doorstep / "indoors" target)
         poolX,poolZ   : number|null  // this lot's backyard pool, if any
         members  : Array<Ped> // wife / kids / mistress
         label    : string   // "Your family" / "<boss>'s family" / "<boss>'s girl"
       }
     Each KIDNAPPED member also exposes (for an external captives panel):
       ped.kidnapped : bool          // true while held
       ped.captiveOf : number        // captor gang id
       ped.ransom    : number        // dollars to free them
       ped.captiveX, ped.captiveZ    // where they're held (the fullmap waypoint)
       ped.captiveT  : number        // seconds left on the clock
     CBZ.cityFamilyReset() : re-casts on a fresh run.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ, THREE = window.THREE;
  if (!CBZ || !THREE) return;
  const g = CBZ.game;

  let rs = 31337;
  function rng() { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; }
  function hourNow() { return CBZ.cityHour ? CBZ.cityHour() : 12; }

  // ---- POOLS (DISABLED — moved indoors) ------------------------------------
  // WHY THIS IS GONE: pools used to be built as OUTDOOR backyard amenities, one
  // per tier-2+ home lot, anchored at the lot's "rear yard". But the city is
  // wall-to-wall towers with no real backyards, so the computed rear yard landed
  // on sidewalks/streets — pools scattered loose across the map. A pool is a
  // MANSION amenity, not street furniture, so it now lives as an INDOOR pool
  // FLOOR built in buildings.js. family.js no longer builds any pool geometry.
  //
  // These three symbols are kept ALIVE (read by castFamilies / dayGoalFor /
  // CBZ.cityFamilyReset) but stay empty/null: no pool ever populates them, so
  // families fall back to yard lounging (every pool read is null-guarded).
  let poolsBuilt = null; // arena ref buildPools() last ran for
  const pools = [];      // always empty now — formerly family relax magnets
  const lotPool = new Map(); // lot -> pool record; always empty now

  // Backyard anchor for a lot: the rear yard, opposite the front door. Door
  // normal (nx,nz) points OUT the front; the yard is the far side of the house
  // footprint. Returns {bx,bz,faceX,faceZ} where face points house→yard.
  function backyardOf(lot) {
    const b = lot.building, door = (b && b.door) || {};
    let nx = door.nx, nz = door.nz;
    if (nx == null || nz == null || (nx === 0 && nz === 0)) {
      // fall back to the side-of-lot the door faces (buildings.js door codes)
      nx = 1; nz = 0;
    }
    // house footprint ≈ lot inset by 2 (buildings.js uses w=lot.w-2,d=lot.d-2)
    const halfW = (lot.w - 2) / 2, halfD = (lot.d - 2) / 2;
    // distance from house centre to the rear yard, along the door axis
    const reach = (Math.abs(nx) > Math.abs(nz) ? halfW : halfD) + 0.6;
    return { bx: lot.cx - nx * reach, bz: lot.cz - nz * reach, faceX: -nx, faceZ: -nz };
  }

  // No outdoor pools are built anymore (see the POOLS note above). We keep the
  // function shell so the daily routine / castFamilies still have their once-per-
  // arena hook: it just marks the arena done and leaves pools/lotPool empty so
  // every downstream pool lookup resolves to null. The indoor pool FLOOR is
  // owned by buildings.js.
  function buildPools() {
    const A = CBZ.city && CBZ.city.arena;
    if (!A || !A.homeLots || poolsBuilt === A) return;
    poolsBuilt = A;
    pools.length = 0; lotPool.clear();
  }

  // ---- FAMILIES ---------------------------------------------------------------
  // Consistent cast so names/relationships read coherently. A family draws ONE
  // wife + 1-2 kids; the first boss also keeps a mistress at a second address.
  const WIVES = ["Maria", "Tasha", "Elena", "Kim", "Rosa", "Dee"];
  const KIDS = ["Marco", "Nia", "Tito", "Zoe", "Junior", "Keke", "Andre", "Lena"];
  const SIDE = ["Candy", "Desirée", "Lola", "Bambi"];
  const families = []; // see header doc for shape
  let spawned = null;  // arena the families were cast for
  let kidnap = null;   // {ped, gangId, captors:[], ransom, t, x, z}
  let kidnapCD = 90;   // first window opens a minute and a half in

  // `gender` is REQUIRED from the caller (never left to makePed's internal
  // 48/52 fallback): famPed hands makePed `Math.random` as its rng, so an
  // un-set gender would roll off Math.random instead of this module's
  // seeded `rng()` — breaking the "deterministic from the seed" contract.
  // W12 DYNASTY NAMING: "Mrs <Surname>" — graft the head's own surname onto a
  // spawned first name (wife pool is given-names-only) so she reads as part
  // of his family, not an unrelated woman. No-op (returns firstName as-is)
  // if the head's name has no surname token to borrow.
  function withSurname(firstName, headName) {
    if (!headName) return firstName;
    const parts = String(headName).trim().split(/\s+/);
    return parts.length > 1 ? firstName + " " + parts[parts.length - 1] : firstName;
  }

  function famPed(x, z, name, role, gangId, kid, gender) {
    if (!CBZ.cityMakePed) return null;
    const p = CBZ.cityMakePed(x, z, Math.random, {
      name, aggr: 0, armed: false, archetype: "resident", gender,
      job: role, behavior: "timid", cash: 20 + ((rng() * 60) | 0),
    });
    if (!p) return null;
    if (gangId) p.gang = gangId;        // wears the colors in the books — kill her
    // W7: renamed from p.family (a STRING role label) to p.famRole — social.js's
    // ped.family is an ARRAY of kin refs; the two collided under one name. See
    // schedule.js's worth() for the matching read-side migration.
    p.famRole = role;                   // and the SET takes it personally (gangs.js)
    if (kid && p.char && p.char.group) { p.char.group.scale.setScalar(0.62); p.hp = 40; p.maxHp = 40; }
    return p;
  }

  // ---- W8: HOUSING BRIDGE --------------------------------------------------
  // castFamilies anchors a family straight to lot GEOMETRY (backyardOf) —
  // it never touches housing.js at all, so the household's rent/occupancy/
  // persistence layers never see them. This is a DATA-level bridge only: the
  // visual/routine anchor above (fam.homeX/houseX etc., read by dayGoalFor)
  // is untouched — members still wander the yard exactly as before. We just
  // ALSO register them as occupants of a real unit on that same lot, so
  // economy.js's rent tick and schedule.js's ledger know this household
  // exists. Best-effort: if the lot has no rentable floor (deriveUnitsForLot
  // returns []) or the unit is already full (MICRO tier caps at 1 seat), a
  // member simply keeps no housing tie — harmless, matches how ungated NPCs
  // already behave with housing absent/disabled.
  function bridgeHousehold(fam) {
    if (!CBZ.cityFloorUnits || !fam || !fam._lot || !fam.members.length) return;
    let units;
    try { units = CBZ.cityFloorUnits(fam._lot); } catch (e) { return; }
    if (!units || !units.length) return;               // no rentable floor on this lot
    const lead = fam.members[0];                        // wife (or the mistress, solo) leases first
    // hint homeOf() to lease ON this exact lot (the same "adopt a cached _digs"
    // path aigoals' own fallback already relies on) rather than the citywide
    // affordability pick — the family's housing tie must match their actual home.
    lead._digs = fam._lot;
    if (CBZ.cityHomeOf) CBZ.cityHomeOf(lead);
    if (!CBZ.cityHouseholdJoin) return;
    for (let i = 1; i < fam.members.length; i++) CBZ.cityHouseholdJoin(fam.members[i], lead);
  }

  function castFamilies() {
    const A = CBZ.city && CBZ.city.arena;
    if (!A || !A.homeLots || !CBZ.cityPeds || !CBZ.cityPeds.length) return;
    if (spawned === A && families.some((f) => f.members.some((m) => !m.dead))) return;
    spawned = A;
    families.length = 0;
    const gangs = (CBZ.cityGangs || []).filter((x) => x && !x.isPlayer);
    // candidate home lots, richest first; the PLAYER's owned home jumps the queue
    // so his people are guaranteed to spawn at his actual address.
    const lots = A.homeLots
      .filter((l) => l.building && l.building.home && (l.building.home.tier || 0) >= 2)
      .sort((a, b) => {
        const ao = a.building.home.owned ? 1 : 0, bo = b.building.home.owned ? 1 : 0;
        if (ao !== bo) return bo - ao;                 // owned home first
        return (b.building.home.tier || 0) - (a.building.home.tier || 0);
      });
    let gi = 0;
    let sideLot = null;
    for (const lot of lots.slice(0, 4)) {
      const home = lot.building.home;
      const mine = !!home.owned;        // the player's address: HIS people live here
      const gang = mine ? null : gangs[gi++ % Math.max(1, gangs.length)];
      const by = backyardOf(lot);
      const pool = lotPool.get(lot) || null;
      const boss = gang && gang.boss && gang.boss.name ? gang.boss.name : "the boss";
      const fam = {
        gangId: gang ? gang.id : 0,
        mine,
        homeX: by.bx, homeZ: by.bz,                    // they live in the yard
        houseX: lot.cx, houseZ: lot.cz,                // indoors target / doorstep
        poolX: pool ? pool.x : null, poolZ: pool ? pool.z : null,
        _pool: pool, _lot: lot, _tier: home.tier || 0,
        label: mine ? "Your family" : (boss + "'s family"),
        members: [],
      };
      const wifeFirst = WIVES[(rng() * WIVES.length) | 0];
      const wifeName = gang && gang.boss ? withSurname(wifeFirst, gang.boss.name) : wifeFirst;
      const wife = famPed(fam.homeX, fam.homeZ, wifeName,
        mine ? "your wife" : (boss + "'s wife"), fam.gangId, false, "f");
      if (wife) { wife._fam = fam; wife._role = "wife"; fam.members.push(wife); }
      // W7: link a BOSS family into the persistent family tree — gang.boss is
      // a real ped ref (gangs.js), reachable right here, so marry() has an
      // actual head to hang the edge off. The PLAYER's own family (mine, gang
      // is null) has no ped-with-a-sid to be the "head" — the player isn't a
      // ped yet — so it's skipped for now; full player-in-tree wiring is a
      // later step (see also cityPropose's citySpouseSid hook in social.js).
      if (wife && gang && gang.boss && !gang.boss.dead && CBZ.cityFamilyTree) {
        CBZ.cityFamilyTree.marry(gang.boss, wife);
      }
      const nKids = 1 + ((rng() * 2) | 0);
      for (let k = 0; k < nKids; k++) {
        const kid = famPed(fam.homeX + 1.5 + k, fam.homeZ + 1.2,
          KIDS[(rng() * KIDS.length) | 0], "the kid", fam.gangId, true, rng() < 0.5 ? "f" : "m");
        if (kid) { kid._fam = fam; kid._role = "kid"; fam.members.push(kid); }
        if (kid && gang && gang.boss && !gang.boss.dead && CBZ.cityFamilyTree) {
          CBZ.cityFamilyTree.bearChild(gang.boss, wife, kid);
        }
      }
      if (fam.members.length) { families.push(fam); bridgeHousehold(fam); }
      if (gang && gi === 1) sideLot = sideLot || lots.find((l) => l !== lot && (l.building.home.tier || 0) >= 2);
      // the FIRST boss also keeps a mistress at a second address — the secret
      // the street can sell: she wears no colors herself, but he pays to keep
      // her safe, so she's still HIS leverage (carries the gang id).
      if (gang && gi === 1 && sideLot) {
        const sby = backyardOf(sideLot), spool = lotPool.get(sideLot) || null;
        const her = famPed(sby.bx, sby.bz, SIDE[(rng() * SIDE.length) | 0],
          "a friend of " + boss, fam.gangId, false, "f");
        if (her) {
          const sf = {
            gangId: fam.gangId, mine: false,
            homeX: sby.bx, homeZ: sby.bz, houseX: sideLot.cx, houseZ: sideLot.cz,
            poolX: spool ? spool.x : null, poolZ: spool ? spool.z : null,
            _pool: spool, _lot: sideLot, _tier: (sideLot.building.home.tier || 0),
            label: boss + "'s girl", members: [her],
          };
          her._fam = sf; her._role = "mistress";
          families.push(sf);
          bridgeHousehold(sf);
        }
      }
    }
    if (families.length && CBZ.cityFlavor) CBZ.cityFlavor("🏠 The big houses are lived in now. Families, pools — leverage.", "#9fd0ff");
  }

  // ---- DAILY ROUTINE -------------------------------------------------------
  // A believable home day driven off CBZ.cityHour() (0..24). Each member picks a
  // place to BE for the current block; we only re-issue a target when they've
  // drifted off it, so the legs stay calm and the world reads lived-in.
  //   ~07-09  morning: loosely around the house (waking up, breakfast prep)
  //   ~09-12  kids out in the yard; wife tidies near the house
  //   12-13   MEAL: everyone gathers at the back door (lunch)
  //   13-17   afternoon: pool / yard lounging (summer city)
  //   17-19   evening: kids in, wife near the door, then MEAL again ~18
  //   19-07   night: indoors / sleep — hold at the house, don't wander
  // The relax blocks pull members to a pool lounger when the lot has a pool.

  function dayGoalFor(m, fam) {
    const h = hourNow();
    const role = m._role;
    // NIGHT / very early — indoors, no wandering
    if (h < 7 || h >= 21) return { x: fam.houseX, z: fam.houseZ, hold: true };
    // MEALS: gather at the back door (house side of the yard)
    if ((h >= 12 && h < 13) || (h >= 18 && h < 19)) {
      const mx = (fam.houseX + fam.homeX) / 2, mz = (fam.houseZ + fam.homeZ) / 2;
      return { x: mx + (role === "kid" ? 0.8 : -0.8), z: mz, hold: true };
    }
    // AFTERNOON relax (13-17): a MANSION (tier>=4) has the pool INDOORS now
    // (the indoor pool FLOOR in buildings.js), so its family heads to the door
    // to go inside instead of lounging in the open yard.
    if (h >= 13 && h < 17 && (fam._tier || 0) >= 4) {
      return { x: fam.houseX, z: fam.houseZ, hold: true };
    }
    // AFTERNOON relax (13-17): everyone gravitates to the pool deck if there is
    // one, otherwise lounges in the yard. Kids stay closest to the water.
    // (Outdoor pools are gone — fam._pool is always null — so this falls through
    // to the yard/kids branches below.)
    if (h >= 13 && h < 17 && fam._pool) {
      const p = fam._pool;
      if (p.lounge && p.lounge.length) {
        const idx = (role === "wife") ? 0 : (role === "mistress" ? (p.lounge.length - 1) : 1 % p.lounge.length);
        const seat = p.lounge[Math.min(idx, p.lounge.length - 1)];
        return { x: seat.x, z: seat.z, sit: true, face: seat.face };
      }
      return { x: p.x + (rng() - 0.5) * (p.w + 1), z: p.z + p.d / 2 + 1.0 };
    }
    // KIDS PLAY OUT (09-17 when not eating): roam the yard, not the street
    if (role === "kid") return { x: fam.homeX + (rng() - 0.5) * 7, z: fam.homeZ + (rng() - 0.5) * 7 };
    // WIFE / MISTRESS daytime: pootle near the house
    return { x: (fam.houseX + fam.homeX) / 2 + (rng() - 0.5) * 4, z: (fam.houseZ + fam.homeZ) / 2 + (rng() - 0.5) * 4 };
  }

  // ---- HOME LIFE TICK ------------------------------------------------------
  let tick = 0, reactCD = 0;
  CBZ.onUpdate(36.2, function (dt) {
    if (g.mode !== "city") return;
    buildPools();
    castFamilies();
    tick += dt;
    reactCD -= dt;
    // home-life cadence rides the perf/quality slider — tier0 ticks every 3s
    // instead of 1.2s (the family sweep is sim-correctness tolerant; goals just
    // refresh slower), Best (tier 4) keeps today's 1.2s exactly.
    if (tick < (CBZ.qScale ? CBZ.qScale(3, 1.2) : 1.2)) return;
    tick = 0;
    const P = CBZ.player;
    const playerHurt = !!(P && !P.dead && P.maxHp && P.hp < P.maxHp * 0.45);
    const playerHot = (g.wanted | 0) >= 3;
    for (const fam of families) {
      // is the player HOME? (only meaningful for his own family)
      let playerHome = false;
      if (fam.mine && P && !P.dead && P.pos) {
        const ddx = P.pos.x - fam.houseX, ddz = P.pos.z - fam.houseZ;
        playerHome = (ddx * ddx + ddz * ddz) < 14 * 14;
      }
      for (const m of fam.members) {
        if (!m || m.dead) continue;
        if (m.kidnapped) continue;
        if (m.state === "flee" || m.alarmed > 0) continue;   // panic owns the legs
        // routine target for this hour
        const goal = dayGoalFor(m, fam);
        // RELAX: hand a calm member to the lounger sit-rig (reuses peds.js seat)
        if (goal.sit && !m.rage) {
          m.finalGoal = { sitDesk: true, anchor: { x: goal.x, z: goal.z, face: goal.face, y: 0 } };
        } else if (m.finalGoal && m.finalGoal.sitDesk) {
          m.finalGoal = null;
          if (m.char) m.char.sitting = false;
          if (m.state === "sit") m.state = "walk";
        }
        // PLAYER REACTIONS (own family only) override the wander this tick
        if (fam.mine && P && !P.dead && P.pos) {
          if (playerHome && !goal.sit) {
            // gather toward him to greet — then drift back next tick
            if (m.target && m.target.set) { m.target.set(P.pos.x + (rng() - 0.5) * 2, 0, P.pos.z - 1.5); }
            if (reactCD <= 0 && (playerHurt || playerHot)) {
              reactCD = 12;
              if (CBZ.cityFlavor) CBZ.cityFlavor(playerHurt
                ? "🏠 " + (m.name || "Family") + ": “You're bleeding — get inside.”"
                : "🏠 " + (m.name || "Family") + ": “The whole block's watching you. Be careful.”", "#9fd0ff");
            }
            continue;
          }
        }
        if (goal.sit) continue;   // the sit-rig drives them; don't fight it
        const dx = m.pos.x - goal.x, dz = m.pos.z - goal.z;
        const off = dx * dx + dz * dz;
        // re-issue only when they've drifted off the block's spot (calm legs);
        // "hold" blocks (meals/night) keep them tightly on the mark.
        if (off > (goal.hold ? 2.2 * 2.2 : 4.5 * 4.5)) {
          if (m.target && m.target.set) m.target.set(goal.x, 0, goal.z);
        }
      }
      // a death in the family: the player's people get a feed eulogy + a "this
      // can't stand" note; a BOSS family death already fires the gang machinery
      // via .gang. Marked once.
      for (const m of fam.members) {
        if (m && m.dead && !m._mourned) {
          m._mourned = true;
          if (m.kidnapped) { m.kidnapped = false; m.captiveOf = 0; }
          // W7/W9 WIRING: a boss-family wife/kid was minted into the persistent
          // family tree at cast time (marry()/bearChild() above, castFamilies())
          // — that mint calls sidOf() which force-stamps m._sid via schedule.js's
          // cityPedStash, so m._sid is reliably present here for anyone who went
          // through that path. peds.js's own death funnel (cityKillPed) only
          // reaches CBZ.cityFamilyTree.markDeath via social.js's citySocialDeath,
          // which fires ONLY when ped.partner was set (peds.js:1613) — family.js's
          // members never set .partner (that's social.js's own couple field, a
          // different mechanism than fam/_role/famRole here), so a family.js
          // death would otherwise never reach the tree and heirOf()/isLiving()
          // would keep treating a dead wife/kid as alive forever. One guarded
          // call closes that gap without touching familytree.js's own contract
          // (mine's members never get a _sid — marry/bearChild are skipped for
          // the player's own family per the W7 note above — so this is a no-op
          // there, exactly matching "mine" families having no tree presence).
          if (m._sid && CBZ.cityFamilyTree) CBZ.cityFamilyTree.markDeath(m._sid);
          if (fam.mine) {
            if (CBZ.cityFeed) CBZ.cityFeed("🕯 They got " + (m.name || "your people") + " at the house. This can't stand.", "#ff7a7a");
            if (CBZ.city && CBZ.city.note) CBZ.city.note("They hit your HOME. " + (m.name || "Family") + " is gone.", 4);
          } else if (CBZ.cityFlavor) {
            CBZ.cityFlavor("🕯 " + (m.name || "Someone") + " — somebody's whole world — is gone. The set won't forget.", "#ffce7a");
          }
        }
      }
    }

    // ---- KIDNAP DIRECTOR: a crew you've bled snatches one of YOURS ----------
    if (!kidnap) {
      kidnapCD -= 1.2;
      if (kidnapCD <= 0) {
        kidnapCD = 120 + rng() * 120;
        const mine = families.find((f) => f.mine && f.members.some((m) => !m.dead));
        const angry = (CBZ.cityGangs || []).find((x) => x && !x.isPlayer && !x.playerFriendly && (x.hostility || 0) >= 2 && x.hq);
        if (mine && angry && P && !P.dead) {
          const ped = mine.members.find((m) => !m.dead && !m.kidnapped);
          if (ped) startKidnap(ped, angry);
        }
      }
    } else {
      tickKidnap();
    }
  });

  function startKidnap(ped, gang) {
    const hx = gang.hq.x + 4, hz = gang.hq.z + 4;
    ped.kidnapped = true;          // PUBLIC state for an external captives panel
    ped.captiveOf = gang.id;
    ped.captiveX = hx; ped.captiveZ = hz;
    ped.pos.set(hx, 0, hz);
    if (ped.char) { ped.char.handsUp = true; ped.char.sitting = false; }
    ped.finalGoal = null;
    ped.state = "idle"; ped.speed = 0;
    if (ped.target && ped.target.set) ped.target.set(hx, 0, hz);
    const captors = [];
    for (let i = 0; i < 3; i++) {
      const c = CBZ.cityMakePed && CBZ.cityMakePed(hx + Math.cos(i * 2.1) * 2.2, hz + Math.sin(i * 2.1) * 2.2, Math.random, {
        armed: true, aggr: 0.95, gang: gang.id, job: "holding your people",
      });
      if (c) captors.push(c);
    }
    const ransom = Math.max(2000, Math.round((g.cash || 0) * 0.12 / 100) * 100);
    ped.ransom = ransom; ped.captiveT = 180;
    kidnap = { ped, gangId: gang.id, captors, ransom, t: 180, x: hx, z: hz };
    if (CBZ.cityFeed) CBZ.cityFeed("📞 The " + gang.name + " took " + (ped.name || "your girl") + ". They want $" + ransom.toLocaleString() + ".", "#ff7a7a");
    if (CBZ.city && CBZ.city.note) CBZ.city.note("📞 They have " + (ped.name || "your family") + ". $" + ransom.toLocaleString() + " — or come take them back.", 5);
    if (CBZ.fullMap && CBZ.fullMap.setWaypoint) CBZ.fullMap.setWaypoint(hx, hz, "THEY HAVE " + (ped.name || "FAMILY").toUpperCase());
  }

  function endKidnap(freed, line, color) {
    const k = kidnap; kidnap = null;
    if (!k) return;
    k.ped.kidnapped = false; k.ped.captiveOf = 0; k.ped.captiveT = 0; k.ped.ransom = 0;
    if (k.ped.char) k.ped.char.handsUp = false;
    if (freed && !k.ped.dead) {
      const fam = families.find((f) => f.members.indexOf(k.ped) >= 0);
      if (fam && k.ped.target && k.ped.target.set) k.ped.target.set(fam.homeX, 0, fam.homeZ);
      k.ped.state = "walk"; k.ped.speed = k.ped.baseSpeed || 2;
    }
    if (CBZ.fullMap && CBZ.fullMap.clearWaypoint) CBZ.fullMap.clearWaypoint("city");
    if (line && CBZ.cityFeed) CBZ.cityFeed(line, color || "#9aa6bd");
  }

  function tickKidnap() {
    const k = kidnap, P = CBZ.player;
    if (!k) return;
    if (k.ped.dead) { endKidnap(false, "🕯 They didn't wait. " + (k.ped.name || "Family") + " is gone.", "#ff7a7a"); return; }
    k.t -= 1.2;
    k.ped.captiveT = Math.max(0, k.t);     // keep the public clock in sync
    let live = 0;
    for (const c of k.captors) if (c && !c.dead && !(c.ko > 0)) live++;
    if (!live) {
      if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(5);
      endKidnap(true, "🏠 You took " + (k.ped.name || "them") + " back the hard way. The street saw it.", "#7fe0a0");
      return;
    }
    // standing close with the money: pay the number
    if (P && !P.dead) {
      const d = Math.hypot(P.pos.x - k.x, P.pos.z - k.z);
      if (d < 5) {
        if ((g.cash || 0) >= k.ransom) {
          if (CBZ.city && CBZ.city.note) CBZ.city.note("[E] Pay $" + k.ransom.toLocaleString() + " — or kill the three holding " + (k.ped.name || "them"), 1.4);
          if (CBZ.keys && (CBZ.keys["e"] || CBZ.keys["E"])) {
            g.cash -= k.ransom;
            if (CBZ.cityHudDirty) CBZ.cityHudDirty();
            for (const c of k.captors) if (c && !c.dead) { c.rage = null; c.state = "walk"; }
            endKidnap(true, "💸 You paid. " + (k.ped.name || "They") + " walks home. The number is a memory now.", "#ffce7a");
            return;
          }
        } else if (CBZ.city && CBZ.city.note) {
          CBZ.city.note("You're short of $" + k.ransom.toLocaleString() + " — guns will have to do it", 1.4);
        }
      }
    }
    if (k.t <= 0) {
      if (CBZ.cityKillPed) CBZ.cityKillPed(k.ped, { fromX: k.x + 1, fromZ: k.z, force: 4, fling: 1 }, "executed");
      endKidnap(false, "🕯 The clock ran out. They put " + (k.ped.name || "your family") + " down.", "#ff7a7a");
    }
  }

  // a fresh run re-casts everything (peds were wiped by spawnCityPeds anyway)
  CBZ.cityFamilyReset = function () {
    families.length = 0;
    spawned = null;
    if (kidnap) { kidnap = null; }
    kidnapCD = 90;
    // pools are arena-bound meshes: they persist with the arena (buildPools
    // re-runs only when a NEW arena is built, so no duplicates on reset)
  };
  CBZ.cityFamilies = families;   // read-only source of truth (see header doc)
})();
