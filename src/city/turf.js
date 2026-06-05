/* ============================================================
   city/turf.js — the GANG TAKEOVER meta (the POINT of Gang City).

   Jail's game is ESCAPE. Gang City's game is TAKEOVER: every gang is trying
   to own the whole map, zone by zone. A zone flips to a gang when that gang
   controls it — by WIPING the holders (clear/out-number them on the ground),
   BUYING OUT a weakly-held zone, or OUT-RECRUITING (poaching the holders'
   members by paying more than their current crew). Members DEFECT to whoever
   pays / wins. Gangs hold shifting ALLIANCES (it's NOT constant war) that
   drift over time and react to attacks — allies don't fight and gang up on the
   leader. The population is FINITE (no respawns); a live HEADCOUNT is shown
   like a survival countdown, with a real KILL FEED. Owning every zone = WIN.

   This file owns:
     - ZONES derived from the lot grid (CBZ.cityZones / cityZoneOwner / cityZoneControl)
     - the takeover DIRECTOR (a cheap, time-sliced CBZ.onUpdate loop)
     - the ALLIANCE / relations graph (CBZ.cityAlliances)
     - the one-screen takeover HUD: zone bar, headcount, alliances, kill feed
     - CBZ.cityTakeoverLeader() + the WIN check

   It reads gangs.js (rival crews, members, turf, captureLot) and playergang.js
   (the player's gang) and steers them — it never spawns peds itself.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  // deterministic-ish rng, distinct stream from gangs.js
  let _s = 0x51ed7;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }
  function pick(a) { return a[(rng() * a.length) | 0]; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // ============================================================
  //  ZONES — group the lot grid into ~6-9 named neighbourhoods.
  //  The map is a 6×6 block grid (config: blocks). We carve it into a 3×3
  //  super-grid → up to 9 districts, each owning the lots whose (i,j) fall in
  //  its quadrant. A zone is OWNED by the gang holding the most turf-lots
  //  inside it; STRENGTH is how dominant that hold is (live bodies + lots).
  // ============================================================
  const ZONE_NAMES = [
    "Northpoint", "Crownhill", "Eastgate",
    "Westend", "Midtown", "Harborside",
    "Southside", "Ironworks", "Dockyard",
  ];
  let zones = [];            // [{id,name,cx,cz,lots:[],owner,strength,heldStr,t}]
  let zonesBuilt = false;
  let mapN = 6;              // grid size (config.blocks), read at build

  function buildZones() {
    zones = []; zonesBuilt = false;
    const A = CBZ.city && CBZ.city.arena;
    if (!A || !A.lots || !A.lots.length) return;
    mapN = (CBZ.CITY && CBZ.CITY.blocks) || 6;
    // 3×3 districts over the i/j grid
    const span = Math.ceil(mapN / 3);
    const grid = {};
    for (let q = 0; q < 9; q++) {
      const di = q % 3, dj = (q / 3) | 0;
      grid[q] = {
        id: "z" + q, name: ZONE_NAMES[q] || ("Zone " + q),
        di, dj, lots: [], cx: 0, cz: 0,
        owner: null, strength: 0, heldStr: 0, t: 0, contestedBy: null,
      };
    }
    for (const lot of A.lots) {
      if (lot.i == null || lot.j == null) continue;
      const di = clamp((lot.i / span) | 0, 0, 2);
      const dj = clamp((lot.j / span) | 0, 0, 2);
      const q = dj * 3 + di;
      grid[q].lots.push(lot);
    }
    for (let q = 0; q < 9; q++) {
      const z = grid[q];
      if (!z.lots.length) continue;
      let sx = 0, sz = 0;
      for (const l of z.lots) { sx += l.cx; sz += l.cz; }
      z.cx = sx / z.lots.length; z.cz = sz / z.lots.length;
      zones.push(z);
    }
    zonesBuilt = zones.length > 0;
    recomputeZones(true);
  }

  // which gang controls the most turf inside a zone → that's the owner.
  // "control" = a gang's claimed turf-lots that lie inside the zone, weighted
  // by the gang's live bodies near the zone. Neutral if nobody holds turf there.
  function lotInZone(lot, z) { return z.lots.indexOf(lot) >= 0; }

  function recomputeZones(silent) {
    if (!zonesBuilt) return;
    const gangs = CBZ.cityGangs || [];
    for (const z of zones) {
      const tally = {};      // gangId -> {lots, bodies, gang}
      for (const gang of gangs) {
        if (gang.absorbed) continue;
        let lots = 0;
        for (const lot of gang.turf) if (lotInZone(lot, z)) lots++;
        if (!lots) continue;
        let bodies = 0;
        for (const m of gang.members) {
          if (m.dead || m.ko) continue;
          const dx = m.pos.x - z.cx, dz = m.pos.z - z.cz;
          if (dx * dx + dz * dz < (z._r2 || (z._r2 = zoneR2(z)))) bodies++;
        }
        tally[gang.id] = { lots, bodies, gang };
      }
      // owner = most turf-lots in the zone (ties broken by bodies)
      let bestId = null, best = -1, bestBodies = -1, total = 0;
      for (const id in tally) {
        const t = tally[id]; total += t.lots;
        const score = t.lots * 10 + t.bodies;
        if (score > best || (score === best && t.bodies > bestBodies)) { best = score; bestId = id; bestBodies = t.bodies; }
      }
      const prevOwner = z.owner;
      z.owner = bestId;
      // strength 0..1: how dominant the owner is (share of held lots + body weight)
      if (bestId && tally[bestId]) {
        const t = tally[bestId];
        const share = total > 0 ? t.lots / total : 0;
        z.heldStr = t.lots;
        z.strength = clamp(0.25 + share * 0.55 + Math.min(0.2, t.bodies * 0.04), 0, 1);
      } else { z.heldStr = 0; z.strength = 0; }
      // announce a flip (NPC-driven flips; player flips are announced by the orders)
      if (!silent && z.owner !== prevOwner) onZoneFlip(z, prevOwner, z.owner);
    }
  }

  function zoneR2(z) {
    // half-diagonal of the zone's lot cluster, padded
    let r = 0;
    for (const l of z.lots) { const d = Math.hypot(l.cx - z.cx, l.cz - z.cz); if (d > r) r = d; }
    r = (r || 30) + 22;
    return r * r;
  }

  function gangName(id) { const x = (CBZ.cityGangs || []).find((y) => y.id === id); return x ? x.name : null; }
  function gangColorOf(id) { const x = (CBZ.cityGangs || []).find((y) => y.id === id); return x ? x.color : 0x8a93a3; }

  function onZoneFlip(z, prevId, newId) {
    if (!newId) return;
    const nm = gangName(newId) || "A crew";
    const near = nearPlayer(z.cx, z.cz, 160);
    const playerInvolved = newId === "player" || prevId === "player";
    if (near || playerInvolved) {
      CBZ.city && CBZ.city.note("🏴 " + nm + " took " + z.name + ".", 2.4);
    }
    if (newId === "player") { CBZ.city && CBZ.city.addRespect(12); if (CBZ.sfx) CBZ.sfx("win"); }
    hudDirty = true;
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }

  // gangs.js calls this after an NPC↔NPC lot capture / playergang on claim —
  // re-derive zone ownership and flag the HUD so colours follow turf instantly.
  CBZ.cityRefreshTurfHud = function () { recomputeZones(false); hudDirty = true; };

  // ---- public zone API ----
  CBZ.cityZones = function () {
    return zones.map((z) => ({ id: z.id, name: z.name, owner: z.owner, strength: z.strength, cx: z.cx, cz: z.cz, lots: z.heldStr }));
  };
  CBZ.cityZoneOwner = function (x, z) {
    if (!zonesBuilt) return null;
    let best = null, bd = Infinity;
    for (const zn of zones) {
      const dx = zn.cx - x, dz = zn.cz - z, dd = dx * dx + dz * dz;
      if (dd < bd) { bd = dd; best = zn; }
    }
    return best ? best.owner : null;
  };
  CBZ.cityZoneAt = function (x, z) {
    if (!zonesBuilt) return null;
    let best = null, bd = Infinity;
    for (const zn of zones) {
      const dx = zn.cx - x, dz = zn.cz - z, dd = dx * dx + dz * dz;
      if (dd < bd) { bd = dd; best = zn; }
    }
    return best;
  };
  // zone-control summary: per-gang count of owned zones + neutral count
  CBZ.cityZoneControl = function () {
    const out = { neutral: 0, total: zones.length, byGang: {} };
    for (const z of zones) {
      if (!z.owner) { out.neutral++; continue; }
      out.byGang[z.owner] = (out.byGang[z.owner] || 0) + 1;
    }
    return out;
  };

  // ============================================================
  //  ALLIANCES — a shifting relations graph. Each unordered gang pair has a
  //  relation r in [-1..1]: r<=-0.34 = AT WAR, r>=0.34 = ALLY, else NEUTRAL.
  //  Relations DRIFT toward neutral over time, swing on attacks (gangs.js
  //  wars push toward war), and the field tends to GANG UP on the leader
  //  (the takeover front-runner). Allies never fight; allies may co-raid.
  // ============================================================
  const rel = {};            // "a|b" (sorted) -> number
  function relKey(a, b) { return a < b ? a + "|" + b : b + "|" + a; }
  function getRel(a, b) { if (a === b) return 1; const k = relKey(a, b); return k in rel ? rel[k] : 0; }
  function setRel(a, b, v) { if (a === b) return; rel[relKey(a, b)] = clamp(v, -1, 1); }
  function nudgeRel(a, b, d) { setRel(a, b, getRel(a, b) + d); }
  function relWord(v) { return v <= -0.34 ? "war" : v >= 0.34 ? "ally" : "neutral"; }

  CBZ.cityAreAllied = function (a, b) { return a && b && a !== b && getRel(a, b) >= 0.34; };
  CBZ.cityAtWar = function (a, b) { return a && b && a !== b && getRel(a, b) <= -0.34; };
  CBZ.cityAlliances = function () {
    const ids = (CBZ.cityGangs || []).filter((x) => !x.absorbed).map((x) => x.id);
    const pairs = [];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i], b = ids[j], v = getRel(a, b);
      pairs.push({ a, b, rel: v, status: relWord(v) });
    }
    return pairs;
  };
  // let other systems (and the player) force a relation
  CBZ.citySetRelation = function (a, b, status) {
    const v = status === "ally" ? 0.6 : status === "war" ? -0.6 : 0;
    setRel(a, b, v);
    hudDirty = true;
  };
  CBZ.cityForgeAlliance = function (a, b) { setRel(a, b, Math.max(getRel(a, b), 0.55)); hudDirty = true; };
  CBZ.cityDeclareWar = function (a, b) { setRel(a, b, Math.min(getRel(a, b), -0.6)); hudDirty = true; };

  function seedAlliances() {
    for (const k in rel) delete rel[k];
    const gangs = (CBZ.cityGangs || []).filter((x) => !x.isPlayer);
    for (let i = 0; i < gangs.length; i++)
      for (let j = i + 1; j < gangs.length; j++) {
        // start mildly cool but mostly neutral; a couple of pairings lean ally/war
        const r = (rng() - 0.5) * 0.9;
        setRel(gangs[i].id, gangs[j].id, r);
      }
  }

  // ============================================================
  //  TAKEOVER LEADER + WIN CHECK
  // ============================================================
  CBZ.cityTakeoverLeader = function () {
    const ctrl = CBZ.cityZoneControl();
    let bestId = null, best = 0;
    for (const id in ctrl.byGang) if (ctrl.byGang[id] > best) { best = ctrl.byGang[id]; bestId = id; }
    return bestId ? { id: bestId, name: gangName(bestId), zones: best, total: ctrl.total } : null;
  };

  let won = false;
  function checkWin() {
    if (won || !zonesBuilt) return;
    const ctrl = CBZ.cityZoneControl();
    const owned = ctrl.byGang["player"] || 0;
    // owning EVERY zone wins the city for the player
    if (owned >= zones.length && zones.length > 0) {
      won = true;
      if (CBZ.city) { CBZ.city.big("👑 YOU OWN THE CITY"); CBZ.city.note("Every district flies your colours. The city is yours.", 5); }
      if (CBZ.sfx) CBZ.sfx("win");
      if (CBZ.cityWin) CBZ.cityWin("takeover");
    }
  }

  // ============================================================
  //  FINITE POPULATION — a live HEADCOUNT shown like a survival countdown.
  //  Counts every living combatant-capable body still in the city. Never
  //  regenerates: when it falls, the last gang standing is winning.
  // ============================================================
  function liveHeadcount() {
    let n = 0;
    const peds = CBZ.cityPeds || [];
    for (let i = 0; i < peds.length; i++) { const p = peds[i]; if (p && !p.dead && !p.collected) n++; }
    if (CBZ.cityCops) for (const c of CBZ.cityCops) if (c && !c.dead) n++;
    return n;
  }
  CBZ.cityHeadcount = liveHeadcount;
  let startPop = 0;

  // ============================================================
  //  HELPERS shared with the director
  // ============================================================
  function nearPlayer(x, z, r) {
    const P = CBZ.player; if (!P || !P.pos) return false;
    const dx = P.pos.x - x, dz = P.pos.z - z; return dx * dx + dz * dz < r * r;
  }
  function liveStrength(gang) {
    if (CBZ.cityGangStrength) return CBZ.cityGangStrength(gang);
    let n = 0; for (const m of gang.members) if (!m.dead && !m.ko) n++; return n;
  }

  // ============================================================
  //  WIPE TRACKING — GTA-SA style: clear/out-number the holders in a zone and
  //  it flips. We watch combat-density per zone: if an attacker has live bodies
  //  in a zone and the owner has none, recompute hands it over (recomputeZones
  //  already does the ownership math from turf-lots + bodies). The DIRECTOR's
  //  job is to MOVE crews so wipes actually happen, and to flip turf-lots when a
  //  zone has been emptied of its owner.
  // ============================================================
  function defendersInZone(gang, z) {
    let n = 0;
    for (const m of gang.members) {
      if (m.dead || m.ko) continue;
      const dx = m.pos.x - z.cx, dz = m.pos.z - z.cz;
      if (dx * dx + dz * dz < (z._r2 || (z._r2 = zoneR2(z)))) n++;
    }
    return n;
  }

  // flip every owner-lot in a zone to the attacker (used when a WIPE clears the
  // zone of its previous owner). Uses gangs.js captureLot for NPC↔NPC so turf
  // colour/stash repaint stays consistent; player flips go through playergang.
  function flipZoneLots(attacker, defender, z) {
    if (!attacker || !defender || attacker === defender) return 0;
    let flipped = 0;
    const lots = defender.turf.filter((l) => lotInZone(l, z));
    for (const lot of lots) {
      if (attacker.isPlayer) {
        // player seizes this exact lot — move it from the rival into the player
        // gang's turf + repaint, mirroring playergang.claimTurfAt for one lot.
        const di = defender.turf.indexOf(lot); if (di >= 0) defender.turf.splice(di, 1);
        if (attacker.turf.indexOf(lot) < 0) attacker.turf.push(lot);
        lot.building = lot.building || {};
        lot.building.gang = attacker.id; lot.building.gangColor = attacker.color; lot.building.playerTurf = true;
        if (lot.building.stash) lot.building.stash.gang = attacker.id;
        flipped++;
      } else if (defender.isPlayer) {
        // player LOSES a lot to an NPC — handled defensively, only if truly empty
        const i = defender.turf.indexOf(lot);
        if (i >= 0) {
          defender.turf.splice(i, 1);
          attacker.turf.push(lot);
          if (lot.building) { lot.building.gang = attacker.id; lot.building.gangColor = attacker.color; lot.building.playerTurf = false; }
          flipped++;
        }
      } else if (CBZ.cityGangCaptureLot) {
        if (CBZ.cityGangCaptureLot(attacker, defender, lot)) flipped++;
      }
    }
    return flipped;
  }

  // ============================================================
  //  AI DIRECTOR — each gang pursues TAKEOVER: expand into weak/adjacent
  //  zones, defend its turf, war on rivals it isn't allied with, and gang up
  //  on the leader. Cheap + time-sliced (one decision per director tick).
  // ============================================================
  function adjacentEnemyZone(gang) {
    // the most attractive zone for `gang` to attack: a neutral or weakly-held
    // enemy zone close to a zone it already owns (or to its centre).
    let from = null;
    for (const z of zones) if (z.owner === gang.id) { from = z; break; }
    const ref = from ? { x: from.cx, z: from.cz } : (gang.center || { x: 0, z: 0 });
    let best = null, bestScore = -Infinity;
    for (const z of zones) {
      if (z.owner === gang.id) continue;
      // don't attack an ally's zone
      if (z.owner && CBZ.cityAreAllied(gang.id, z.owner)) continue;
      const d = Math.hypot(z.cx - ref.x, z.cz - ref.z) || 1;
      // weaker + closer = better; neutral zones are easy pickings
      let score = (1 - z.strength) * 100 - d * 0.04;
      if (!z.owner) score += 30;                       // neutral land grab
      // gang up on the leader: bonus for hitting the front-runner's zones
      const ldr = CBZ.cityTakeoverLeader();
      if (ldr && z.owner === ldr.id && ldr.id !== gang.id) score += 40;
      if (score > bestScore) { bestScore = score; best = z; }
    }
    return best;
  }

  function directExpand(gang) {
    if (gang.isPlayer || !gang.turf.length) return;
    if (liveStrength(gang) < 3) return;                 // too thin to push
    const z = adjacentEnemyZone(gang);
    if (!z) return;
    // pick a target lot: an enemy turf-lot in the zone, else the zone centre
    let targetLot = null;
    const owner = z.owner ? CBZ.cityGangById(z.owner) : null;
    if (owner && !owner.isPlayer) {
      const inZone = owner.turf.filter((l) => lotInZone(l, z));
      if (inZone.length) targetLot = pick(inZone);
    }
    if (!targetLot) {
      // neutral zone — march on the nearest lot in it as a beachhead
      let bd = Infinity;
      for (const l of z.lots) { const d = Math.hypot(l.cx - gang.center.x, l.cz - gang.center.z); if (d < bd) { bd = d; targetLot = l; } }
    }
    if (!targetLot) return;
    z.contestedBy = gang.id;
    if (owner && !owner.isPlayer && CBZ.cityStartGangWar) {
      CBZ.cityStartGangWar(gang, owner, { lot: targetLot, assault: true });
    } else if (!owner) {
      // unopposed land grab — send a small squad to plant the flag
      sendSquad(gang, targetLot, 3 + ((rng() * 2) | 0));
      if (nearPlayer(targetLot.cx, targetLot.cz, 150))
        CBZ.city && CBZ.city.note(gang.name + " is moving into " + z.name + ".", 2);
    }
  }

  // move a few free members onto a lot (claim/hold a neutral beachhead)
  function sendSquad(gang, lot, count) {
    let sent = 0;
    for (const m of gang.members) {
      if (sent >= count) break;
      if (m.dead || m.inCar || m.raidT > 0 || m.companion) continue;
      m.homeGuard = m.homeGuard || m.guard;
      m.guard = { x: lot.cx, z: lot.cz };
      if (m.target && m.target.set) m.target.set(lot.cx + (rng() - 0.5) * 5, 0, lot.cz + (rng() - 0.5) * 5);
      m.pause = 0; m.path = null; m.raidT = 20 + rng() * 12; m.raidLot = lot; m.raidGang = null;
      sent++;
    }
    return sent;
  }

  // a neutral lot a gang's squad is sitting on (no rival nearby) joins its turf
  function resolveNeutralGrabs() {
    const gangs = CBZ.cityGangs || [];
    for (const z of zones) {
      if (z.owner) continue;                            // only neutral zones get grabbed
      if (!z.contestedBy) continue;
      const gang = CBZ.cityGangById(z.contestedBy);
      if (!gang || gang.absorbed) { z.contestedBy = null; continue; }
      // need bodies present and no rival contesting
      if (defendersInZone(gang, z) < 2) continue;
      let rivalNear = false;
      for (const other of gangs) {
        if (other === gang || other.absorbed) continue;
        if (defendersInZone(other, z) >= 1) { rivalNear = true; break; }
      }
      if (rivalNear) continue;
      // plant the flag: the nearest unclaimed lot in the zone becomes turf
      let lot = null, bd = Infinity;
      for (const l of z.lots) {
        if (l.building && l.building.gang) continue;     // already someone's
        const d = Math.hypot(l.cx - gang.center.x, l.cz - gang.center.z);
        if (d < bd) { bd = d; lot = l; }
      }
      if (!lot) { z.contestedBy = null; continue; }
      if (gang.isPlayer) { if (CBZ.cityPlayerGangClaimTurf) CBZ.cityPlayerGangClaimTurf(lot.cx, lot.cz); }
      else {
        if (gang.turf.indexOf(lot) < 0) gang.turf.push(lot);
        lot.building = lot.building || {};
        lot.building.gang = gang.id; lot.building.gangColor = gang.color;
        if (gang.center) { let sx = 0, sz = 0; for (const l of gang.turf) { sx += l.cx; sz += l.cz; } gang.center.x = sx / gang.turf.length; gang.center.z = sz / gang.turf.length; }
      }
      z.contestedBy = null;
    }
  }

  // WIPE resolution: if a zone's prior owner has been cleared out of it but an
  // aggressor holds bodies there, hand the owner's in-zone lots to the aggressor.
  function resolveWipes() {
    const gangs = CBZ.cityGangs || [];
    for (const z of zones) {
      if (!z.owner) continue;
      const owner = CBZ.cityGangById(z.owner);
      if (!owner) continue;
      // never silently strip the PLAYER's turf — losing player land must go
      // through an actual raid (gangs.js launchWar + playergang defence).
      if (owner.isPlayer) continue;
      const def = defendersInZone(owner, z);
      if (def > 0) continue;                            // owner still holds the ground
      // owner wiped from the zone — who's standing on it?
      let bestG = null, bestN = 0;
      for (const a of gangs) {
        if (a === owner || a.absorbed) continue;
        if (CBZ.cityAreAllied(a.id, owner.id)) continue;
        const n = defendersInZone(a, z);
        if (n > bestN) { bestN = n; bestG = a; }
      }
      if (bestG && bestN >= 2) {
        const f = flipZoneLots(bestG, owner, z);
        if (f && !bestG.isPlayer) bestG.treasury = (bestG.treasury || 0) + 180 * f;
      }
    }
  }

  // ============================================================
  //  ALLIANCE DRIFT — relations relax toward neutral, then the field ganging
  //  up on the leader pulls leader-vs-others toward war and others toward ally.
  // ============================================================
  function driftAlliances(dt) {
    for (const k in rel) {
      const v = rel[k];
      rel[k] = v + (0 - v) * Math.min(1, dt * 0.012);   // slow relax to neutral
    }
    const ldr = CBZ.cityTakeoverLeader();
    if (!ldr) return;
    const others = (CBZ.cityGangs || []).filter((x) => !x.absorbed && x.id !== ldr.id);
    // the runaway leader makes enemies; the underdogs draw together
    if (ldr.zones >= 3) {
      for (const o of others) nudgeRel(o.id, ldr.id, -dt * 0.02);
      for (let i = 0; i < others.length; i++)
        for (let j = i + 1; j < others.length; j++)
          nudgeRel(others[i].id, others[j].id, dt * 0.012);
    }
  }

  // occasionally make a deliberate diplomatic MOVE (forge/break a pact) so the
  // map of alliances visibly shifts, with a readable note when near the player.
  function diploMove() {
    const gangs = (CBZ.cityGangs || []).filter((x) => !x.absorbed && !x.isPlayer);
    if (gangs.length < 2) return;
    const a = pick(gangs);
    const others = gangs.filter((x) => x !== a);
    if (!others.length) return;
    const b = pick(others);
    const cur = getRel(a.id, b.id);
    // weakest two tend to ally; a strong gang bullies a weak neutral into war
    const sa = liveStrength(a), sb = liveStrength(b);
    let toward, word;
    if (sa + sb < 8 && cur < 0.34) { toward = 0.6; word = "alliance"; }
    else if (cur > -0.34 && rng() < 0.5) { toward = -0.6; word = "war"; }
    else { toward = 0; word = "truce"; }
    setRel(a.id, b.id, toward);
    if (word === "war" && CBZ.cityStartGangWar && rng() < 0.6) {
      // a fresh war comes with an opening raid
      const tgt = b.turf.length ? pick(b.turf) : null;
      if (tgt) CBZ.cityStartGangWar(a, b, { lot: tgt });
    }
    if (nearPlayer(a.center.x, a.center.z, 220) || nearPlayer(b.center.x, b.center.z, 220)) {
      const icon = word === "alliance" ? "🤝" : word === "war" ? "⚔" : "🕊";
      CBZ.city && CBZ.city.note(icon + " " + a.name + " & " + b.name + ": " + word + ".", 2.4);
    }
    hudDirty = true;
  }

  // ============================================================
  //  DEFECTION + OUT-RECRUIT + BUY-OUT economics (NPC↔NPC).
  //  Members defect to a stronger / better-paying neighbour gang. A flush gang
  //  can BUY OUT a weakly-held neutral-ish zone outright. These give the
  //  takeover meta non-violent paths, mirroring the player's options.
  // ============================================================
  function gangPay(gang) {
    // "crew pay" a gang can offer = treasury spread over its members, scaled by
    // how much turf it holds (richer, bigger gangs pay better)
    const n = Math.max(1, liveStrength(gang));
    return (gang.treasury || 0) / n + gang.turf.length * 12 + (gang.isPlayer ? 40 : 0);
  }

  function tryDefection() {
    const gangs = (CBZ.cityGangs || []).filter((x) => !x.absorbed);
    if (gangs.length < 2) return;
    // pick a struggling gang and see if a soldier defects to a richer neighbour
    const weak = gangs.slice().sort((a, b) => liveStrength(a) - liveStrength(b))[0];
    if (!weak || liveStrength(weak) <= 1) return;       // never poach a gang to extinction here
    const myPay = gangPay(weak);
    // find the best-paying NON-ally suitor near the weak gang's centre
    let suitor = null, bestPay = myPay * 1.35;          // needs a clearly better offer
    for (const o of gangs) {
      if (o === weak) continue;
      if (CBZ.cityAreAllied(o.id, weak.id)) continue;   // don't poach allies
      const d = Math.hypot((o.center.x - weak.center.x), (o.center.z - weak.center.z));
      if (d > 220) continue;
      const pay = gangPay(o) - d * 0.05;
      if (pay > bestPay) { bestPay = pay; suitor = o; }
    }
    if (!suitor) return;
    // a soldier (never the boss) flips
    const soldier = weak.members.find((m) => !m.dead && !m.ko && m.rank !== "boss" && !m.companion);
    if (!soldier) return;
    defect(soldier, weak, suitor);
  }

  function defect(ped, from, to) {
    // remove from old crew
    const i = from.members.indexOf(ped); if (i >= 0) from.members.splice(i, 1);
    if (to.isPlayer && CBZ.cityPlayerGangEnlist) {
      CBZ.cityPlayerGangEnlist(ped, ped.rank === "lt" ? "lt" : "soldier");
    } else {
      if (to.members.indexOf(ped) < 0) to.members.push(ped);
      ped.gang = to.id; ped.faction = to.id;
      ped.outfit = to.color;
      ped.homeGuard = to.center ? { x: to.center.x, z: to.center.z } : ped.homeGuard;
      ped.guard = ped.homeGuard; ped.rage = null; ped.raidT = 0; ped.companion = false;
      // recolour the tag if the gangs.js styler is reachable via a label sprite
      if (ped.tag && ped.char && ped.char.group && CBZ.makeLabelSprite) {
        const col = "#" + ("000000" + ((to.color >>> 0).toString(16))).slice(-6);
        const lbl = CBZ.makeLabelSprite((ped.name || "Crew") + (ped.rank === "lt" ? " · Lt." : ""), { color: col });
        lbl.position.y = ped.tag.position.y || 3.0; lbl.scale.copy(ped.tag.scale);
        if (ped.tag.parent) ped.tag.parent.remove(ped.tag);
        ped.char.group.add(lbl); ped.tag = lbl; ped.tag.visible = false; ped.tagColor = col;
      }
    }
    to.treasury = Math.max(0, (to.treasury || 0) - 80);  // signing cost
    if (nearPlayer(from.center.x, from.center.z, 180) || (to.isPlayer))
      CBZ.city && CBZ.city.note("↩ " + (ped.name || "A soldier") + " defected: " + from.name + " → " + to.name + ".", 2.4);
    hudDirty = true;
  }
  CBZ.cityGangDefect = defect;

  // NPC BUY-OUT: a rich gang buys a neutral-ish zone with a weak/neutral owner.
  function tryBuyout() {
    const gangs = (CBZ.cityGangs || []).filter((x) => !x.absorbed && !x.isPlayer);
    const rich = gangs.slice().sort((a, b) => (b.treasury || 0) - (a.treasury || 0))[0];
    if (!rich || (rich.treasury || 0) < 1400) return;
    // a weakly-held enemy/neutral zone within reach
    let target = null, bestStr = 0.62;
    for (const z of zones) {
      if (z.owner === rich.id) continue;
      if (z.owner && CBZ.cityAreAllied(rich.id, z.owner)) continue;
      if (z.strength >= bestStr) continue;
      const d = Math.hypot(z.cx - rich.center.x, z.cz - rich.center.z);
      if (d > 260) continue;
      target = z; bestStr = z.strength;
    }
    if (!target) return;
    const owner = target.owner ? CBZ.cityGangById(target.owner) : null;
    if (owner && owner.isPlayer) return;                // can't buy the player's land out from under them
    const cost = 1200 + target.heldStr * 300;
    if ((rich.treasury || 0) < cost) return;
    rich.treasury -= cost;
    if (owner) { owner.treasury = (owner.treasury || 0) + cost * 0.5; flipZoneLots(rich, owner, target); }
    else {
      // neutral — annex its unclaimed lots
      for (const l of target.lots) {
        if (l.building && l.building.gang) continue;
        if (rich.turf.indexOf(l) < 0) rich.turf.push(l);
        l.building = l.building || {}; l.building.gang = rich.id; l.building.gangColor = rich.color;
      }
    }
    if (nearPlayer(target.cx, target.cz, 200))
      CBZ.city && CBZ.city.note("💰 " + rich.name + " bought out " + target.name + ".", 2.4);
    hudDirty = true;
  }

  // ============================================================
  //  PLAYER takeover helpers (called from playergang.js / interact)
  // ============================================================
  // BUY OUT the zone the player is standing in (if weakly held by a rival/neutral)
  CBZ.cityPlayerBuyZone = function () {
    const P = CBZ.player; if (!P) return false;
    const z = CBZ.cityZoneAt(P.pos.x, P.pos.z);
    if (!z) { CBZ.city && CBZ.city.note("No district here.", 1.6); return false; }
    if (z.owner === "player") { CBZ.city && CBZ.city.note("You already hold " + z.name + ".", 1.8); return false; }
    if (z.owner && CBZ.cityGangById(z.owner) && CBZ.cityGangById(z.owner).isPlayer) return false;
    if (z.strength > 0.7) { CBZ.city && CBZ.city.note(z.name + " is too strongly held to buy — take it by force.", 2.4); return false; }
    const owner = z.owner ? CBZ.cityGangById(z.owner) : null;
    const cost = 1500 + z.heldStr * 400;
    if (!CBZ.cityPlayerGangExists || !CBZ.cityPlayerGangExists()) { CBZ.city && CBZ.city.note("Found a gang first ([O]).", 2); return false; }
    if ((g.cash || 0) < cost) { CBZ.city && CBZ.city.note("Need $" + cost + " to buy out " + z.name + ".", 2.4); return false; }
    g.cash -= cost; if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    const pg = CBZ.cityGangById("player");
    if (owner) { owner.treasury = (owner.treasury || 0) + cost * 0.4; if (pg) flipZoneLots(pg, owner, z); }
    else if (CBZ.cityPlayerGangClaimTurf) {
      let lot = null, bd = Infinity;
      for (const l of z.lots) { const d = Math.hypot(l.cx - P.pos.x, l.cz - P.pos.z); if (d < bd) { bd = d; lot = l; } }
      if (lot) CBZ.cityPlayerGangClaimTurf(lot.cx, lot.cz);
    }
    CBZ.city && CBZ.city.big("💰 BOUGHT " + z.name);
    CBZ.city && CBZ.city.addRespect(10);
    recomputeZones(false);
    hudDirty = true;
    return true;
  };

  // SWITCH the player's gang allegiance: ally with / declare war on a rival
  CBZ.cityPlayerSetRelation = function (gangId, status) {
    if (!CBZ.cityPlayerGangExists || !CBZ.cityPlayerGangExists()) return false;
    CBZ.citySetRelation("player", gangId, status);
    const nm = gangName(gangId) || "them";
    CBZ.city && CBZ.city.note(status === "ally" ? "🤝 Allied with " + nm + "." : status === "war" ? "⚔ At war with " + nm + "." : "🕊 Neutral with " + nm + ".", 2.4);
    return true;
  };

  // DEFECT / switch the player to a rival gang (joins as a member, abandons own)
  CBZ.cityPlayerDefectTo = function (gangId) {
    const rec = CBZ.cityGangById(gangId);
    if (!rec || rec.isPlayer) return false;
    CBZ.city && CBZ.city.big("↩ JOINED " + rec.name);
    CBZ.city && CBZ.city.note("You ride with the " + rec.name + " now.", 2.6);
    g.playerGangAffiliation = gangId;
    CBZ.citySetRelation("player", gangId, "ally");
    hudDirty = true;
    return true;
  };

  // ============================================================
  //  THE ONE-SCREEN TAKEOVER HUD — fits on screen, never scrolls.
  //  Top-centre: a zone-control bar (owned-by colour) + the live HEADCOUNT.
  //  Below it: a compact alliance strip. Bottom-left-ish: the KILL FEED.
  //  All cheap DOM, re-rendered only when dirty or on a slow cadence.
  // ============================================================
  let hudRoot = null, zoneBarEl = null, headEl = null, allyEl = null, leadEl = null, feedEl = null;
  let hudDirty = true, feedSig = "";
  function buildHud() {
    if (hudRoot) return;
    if (!document.getElementById("cTurfMetaCss")) {
      const st = document.createElement("style");
      st.id = "cTurfMetaCss";
      st.textContent =
        "#cTurfMeta{position:fixed;left:0;right:0;top:6px;z-index:21;pointer-events:none;font-family:Fredoka,system-ui,sans-serif;display:none}" +
        "#cTurfMeta .wrap{width:min(560px,72vw);margin:0 auto;text-align:center}" +
        "#cTurfMeta .zbar{display:flex;height:13px;border-radius:7px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.5),inset 0 0 0 1px rgba(255,255,255,.08)}" +
        "#cTurfMeta .zseg{flex:1 1 0;min-width:2px;transition:background .3s}" +
        "#cTurfMeta .head{margin-top:3px;font-size:13px;font-weight:700;color:#e8eef7;text-shadow:0 1px 3px rgba(0,0,0,.8);letter-spacing:.3px}" +
        "#cTurfMeta .head b{color:#ff8b6b}" +
        "#cTurfMeta .lead{font-size:12px;margin-top:1px;text-shadow:0 1px 3px rgba(0,0,0,.85)}" +
        "#cTurfMeta .ally{margin-top:3px;font-size:11px;color:#aeb6c2;text-shadow:0 1px 2px rgba(0,0,0,.85);line-height:1.5}" +
        "#cTurfMeta .ally span{padding:0 4px}" +
        "#cKillFeed{position:fixed;right:14px;top:120px;z-index:21;pointer-events:none;font-family:Fredoka,system-ui,sans-serif;width:230px;display:none}" +
        "#cKillFeed .kfrow{background:rgba(8,11,17,.62);border-right:3px solid #c33;border-radius:4px;padding:2px 8px;margin-top:4px;color:#dfe6f0;font-size:12px;line-height:1.3;text-align:right;box-shadow:0 2px 6px rgba(0,0,0,.4);animation:kfIn .2s ease-out}" +
        "#cKillFeed .kfrow b{color:#fff}" +
        "#cKillFeed .kfrow.you{border-right-color:#ffd166;background:rgba(40,30,8,.7)}" +
        "@keyframes kfIn{0%{opacity:0;transform:translateX(14px)}100%{opacity:1;transform:translateX(0)}}";
      document.head.appendChild(st);
    }
    hudRoot = document.createElement("div");
    hudRoot.id = "cTurfMeta";
    hudRoot.innerHTML =
      "<div class='wrap'>" +
      "<div class='zbar' id='cZBar'></div>" +
      "<div class='head' id='cHead'></div>" +
      "<div class='lead' id='cLead'></div>" +
      "<div class='ally' id='cAlly'></div>" +
      "</div>";
    document.body.appendChild(hudRoot);
    zoneBarEl = hudRoot.querySelector("#cZBar");
    headEl = hudRoot.querySelector("#cHead");
    leadEl = hudRoot.querySelector("#cLead");
    allyEl = hudRoot.querySelector("#cAlly");

    feedEl = document.createElement("div");
    feedEl.id = "cKillFeed";
    document.body.appendChild(feedEl);
  }

  function hex6(n) { return "#" + ("000000" + ((n >>> 0).toString(16))).slice(-6); }

  function renderZoneBar() {
    if (!zoneBarEl) return;
    let html = "";
    for (const z of zones) {
      const col = z.owner ? hex6(gangColorOf(z.owner)) : "#3a4151";
      // strength → opacity (darker shade = stronger hold, GTA-SA style)
      const op = z.owner ? (0.5 + z.strength * 0.5).toFixed(2) : "0.6";
      html += "<div class='zseg' title='" + z.name + "' style='background:" + col + ";opacity:" + op + "'></div>";
    }
    zoneBarEl.innerHTML = html;
  }

  function renderHeadAndAllies() {
    if (!headEl) return;
    const pop = liveHeadcount();
    const ctrl = CBZ.cityZoneControl();
    headEl.innerHTML = "ALIVE <b>" + pop + "</b> · " + (ctrl.total - ctrl.neutral) + "/" + ctrl.total + " districts held";
    // leader line
    const ldr = CBZ.cityTakeoverLeader();
    if (leadEl) {
      if (ldr) {
        const isYou = ldr.id === "player";
        leadEl.innerHTML = "Leading: <b style='color:" + hex6(gangColorOf(ldr.id)) + "'>" + (isYou ? "YOU" : ldr.name) + "</b> (" + ldr.zones + "/" + ldr.total + ")";
      } else leadEl.textContent = "City up for grabs — no one holds a district.";
    }
    // alliance strip: list each gang with its zone count + a couple of relations
    if (allyEl) {
      const gangs = (CBZ.cityGangs || []).filter((x) => !x.absorbed);
      let html = "";
      for (const gn of gangs) {
        const zc = ctrl.byGang[gn.id] || 0;
        html += "<span style='color:" + hex6(gn.color) + "'>" + (gn.isPlayer ? "You" : shortName(gn.name)) + " " + zc + "</span>";
      }
      // one shifting-pact highlight (most-allied + most-warring pair)
      const pacts = CBZ.cityAlliances();
      let ally = null, war = null;
      for (const p of pacts) { if (p.status === "ally" && (!ally || p.rel > ally.rel)) ally = p; if (p.status === "war" && (!war || p.rel < war.rel)) war = p; }
      let line2 = "";
      if (ally) line2 += "🤝 " + shortName(gangName(ally.a)) + "+" + shortName(gangName(ally.b)) + " ";
      if (war) line2 += "⚔ " + shortName(gangName(war.a)) + "v" + shortName(gangName(war.b));
      allyEl.innerHTML = html + (line2 ? "<br><span style='color:#8a93a3'>" + line2 + "</span>" : "");
    }
  }
  function shortName(n) { if (!n) return "?"; const w = n.split(" "); return w.length > 1 ? w[w.length - 1] : n; }

  // KILL FEED — reads CBZ.cityRecentDeaths (populated by killfeed.js). Shows the
  // last few "<Name> — <cause>" entries; the player's own death glows gold.
  function renderKillFeed() {
    if (!feedEl) return;
    const deaths = CBZ.cityRecentDeaths || [];
    if (!deaths.length) { if (feedEl.style.display !== "none") feedEl.style.display = "none"; return; }
    const recent = deaths.slice(-5);
    const sig = recent.map((d) => (d.name || "") + (d.cause || "") + (d.t || "")).join("|");
    if (sig === feedSig) return;                         // nothing new
    feedSig = sig;
    let html = "";
    for (const d of recent) {
      const cls = d.you ? "kfrow you" : "kfrow";
      const nm = d.name || "Someone";
      const cause = d.cause || "killed";
      html += "<div class='" + cls + "'><b>" + esc(nm) + "</b> — " + esc(cause) + "</div>";
    }
    feedEl.innerHTML = html;
    feedEl.style.display = "block";
  }
  function esc(s) { return String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])); }

  function showHud(on) {
    buildHud();
    hudRoot.style.display = on ? "block" : "none";
    if (!on && feedEl) feedEl.style.display = "none";
  }

  // ============================================================
  //  RESET (mode.js / careers reset path) — clear meta state for a fresh run
  // ============================================================
  CBZ.cityTurfReset = function () {
    zones = []; zonesBuilt = false; won = false; startPop = 0;
    for (const k in rel) delete rel[k];
    feedSig = "";
    if (hudRoot) hudRoot.style.display = "none";
    if (feedEl) { feedEl.style.display = "none"; feedEl.innerHTML = ""; }
    hudDirty = true;
  };

  // ============================================================
  //  THE DIRECTOR LOOP — time-sliced. One subsystem per few seconds so phones
  //  never feel a hitch. Order 34.6 sits between gangs.js (34.5) and the
  //  player-gang driver (34.7) so it reads fresh gang state each frame.
  // ============================================================
  let buildT = 0;            // retry building zones until the city exists
  let recomputeT = 0;        // ownership recompute cadence
  let directorT = 0;         // AI expansion decisions
  let diploT = 0;            // alliance moves
  let econT = 0;             // defection / buyout cadence
  let hudT = 0;              // HUD refresh cadence
  let slice = 0;             // round-robin so only one heavy job runs per tick

  CBZ.onUpdate(34.6, function (dt) {
    if (g.mode !== "city") { if (hudRoot && hudRoot.style.display !== "none") showHud(false); return; }

    // (re)build zones once the city + gangs are spawned
    if (!zonesBuilt) {
      buildT -= dt;
      if (buildT <= 0) {
        buildT = 0.5;
        if (CBZ.cityGangs && CBZ.cityGangs.length) {
          buildZones();
          if (zonesBuilt) { seedAlliances(); startPop = liveHeadcount(); showHud(true); }
        }
      }
      return;
    }
    showHud(true);

    // --- ownership recompute (cheap-ish; every ~1.2s) ---
    recomputeT -= dt;
    if (recomputeT <= 0) {
      recomputeT = 1.2;
      recomputeZones(false);
      checkWin();
      hudDirty = true;
    }

    // --- round-robin the heavier directors so only ONE fires per tick ---
    directorT -= dt; diploT -= dt; econT -= dt;
    slice = (slice + 1) % 3;
    if (slice === 0 && directorT <= 0) {
      directorT = 6 + rng() * 4;
      // one aggressive gang makes a takeover move this tick
      const live = (CBZ.cityGangs || []).filter((x) => !x.isPlayer && !x.absorbed && x.turf.length && liveStrength(x) >= 3);
      if (live.length) {
        // bias to the gang with the most treasury/intensity (it can afford to push)
        live.sort((a, b) => ((b.treasury || 0) + (b.warIntensity || 0) * 300) - ((a.treasury || 0) + (a.warIntensity || 0) * 300));
        directExpand(live[0]);
      }
      resolveNeutralGrabs();
      resolveWipes();
    } else if (slice === 1 && diploT <= 0) {
      diploT = 14 + rng() * 10;
      driftAlliances(diploT);   // catch-up drift since last diplo tick
      if (rng() < 0.7) diploMove();
    } else if (slice === 2 && econT <= 0) {
      econT = 10 + rng() * 6;
      if (rng() < 0.6) tryDefection();
      if (rng() < 0.4) tryBuyout();
      resolveNeutralGrabs();
    }

    // continuous slow alliance drift (very cheap)
    driftAlliances(dt);

    // --- HUD refresh: zone bar + leader/allies only when dirty; headcount +
    //     kill feed on a steady cadence (they change constantly). ---
    hudT -= dt;
    if (hudDirty) { renderZoneBar(); renderHeadAndAllies(); hudDirty = false; hudT = 0.4; }
    if (hudT <= 0) { hudT = 0.5; renderHeadAndAllies(); }
    renderKillFeed();
  });
})();
