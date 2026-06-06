/* ============================================================
   city/gangs.js — the factions that own the ABANDONED blocks.

   Each gang claims a set of derelict buildings (city/buildings.js marks
   lots `abandoned`), tags them in its colour, and posts members to hold
   the turf. Members are full peds (city/peds.js) spawned with a high
   aggression so the universal brain makes them territorial: they guard
   the block, attack intruders + rival gangs, and freelance street crime.

   Provocation: rob a gang's STASH or drop one of its members and the
   whole crew turns hostile inside their turf until the heat cools. A low
   ambient war director sends bounded raid squads into a rival's block.

   Exposes: CBZ.cityGangs, spawnCityGangs, cityGangOf(x,z),
   cityGangProvoke/Provoked, cityGangMemberDown, cityRobStash, reset.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  let _s = 99173;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }

  CBZ.cityGangs = CBZ.cityGangs || [];
  let warT = 0;          // ambient rival-vs-rival war director cooldown
  let incomeT = 0;       // territory payday cooldown (GTA: turf = money)
  let reprisalT = 0;     // escalation tick for provoked gangs hunting the player
  let driveT = 0;        // global drive-by cadence limiter
  let activeDrivebys = 0;// hard cap so phones survive

  // GTA San Andreas turf logic: more held blocks = more income + a deeper bench.
  // We model a gang TREASURY that fills from held turf and funds bigger raids,
  // and a WAR has an INTENSITY the player can read + exploit.
  const TURF_PAYDAY = 30;          // seconds between paydays
  const TURF_INCOME_PER_LOT = 42;  // base $ per held block per payday
  const MAX_DRIVEBYS = 2;          // concurrent gang cars strafing

  function gangColor(id) { const def = (CBZ.CITY.gangs || []).find((x) => x.id === id); return def ? def.color : 0xb079ea; }

  // ---- shared real-name pool. Every gangster gets a proper First-Last name
  //      (same human style as the rest of the city's peds) — the RANK is DATA on
  //      the ped, never jammed into the surname. The boss alone wears a street
  //      nickname in quotes, the way a kingpin would. ----
  const FIRST = ["Marcus", "Vince", "Dmitri", "Tyrone", "Eddie", "Ray", "Omar", "Carlos", "Nico", "Sal", "Jax", "Trey", "Dee", "Boon", "Rex", "Marlo", "Dro", "Cyd", "Lola", "Rosa", "Mona", "Kira", "Nia", "Val", "Esi", "Otis", "Hank", "Pim"];
  const LAST = ["Romano", "Cruz", "Vega", "Petrov", "Banks", "Mensah", "Hollis", "Okoro", "Diaz", "Stone", "Castle", "Reyes", "Sava", "Doyle", "Marsh", "Quinn", "Vance", "Boyd", "Salas", "Tran", "Abara", "Costa", "Ngata", "Webb"];
  // boss handles riffing on famous gangsters — Lucky (Luciano), Scarface/Big (Capone),
  // Teflon (Gotti), Bugsy (Siegel), Dutch (Schultz), Whitey (Bulger), Sosa, Rico.
  const BOSS_NICK = ["Lucky", "Scarface", "Teflon", "Big", "Diamond", "Capo", "Sosa",
    "Rico", "Cash", "Bugsy", "Dutch", "Whitey", "Ghost", "Iron", "Slick", "Cold", "Reaper", "King", "Snake"];
  function pick(a) { return a[(rng() * a.length) | 0]; }
  // member names match each gang's ETHNICITY (config gangs carry `ethnicity`):
  // Latin Kings + Trinitarios = Hispanic; Bloods/Crips/GDs/Black P. Stones = Black.
  const FIRST_BLACK = ["Marcus", "DeShawn", "Tyrone", "Jamal", "Darnell", "Maurice", "Terrell", "Andre", "Rashad", "Jerome", "Malik", "Demetrius", "Cedric", "Reggie", "Dontae", "Trey", "Keon", "Marlo", "Dre", "Avon", "Lamar", "Tremaine", "Quan", "Deon"];
  const LAST_BLACK = ["Washington", "Banks", "Jefferson", "Booker", "Coleman", "Mosley", "Pruitt", "Carter", "Hollis", "Freeman", "Dawson", "Greer", "Mack", "Tate", "Childs", "Means", "Gaines", "Stroud", "Pickett", "Boyd"];
  const FIRST_LATINO = ["Carlos", "Miguel", "Jose", "Luis", "Jesus", "Angel", "Hector", "Rafael", "Diego", "Javier", "Ramon", "Emilio", "Nico", "Mateo", "Tito", "Beto", "Marco", "Cesar", "Rey", "Flaco", "Chuy", "Eddie", "Junior"];
  const LAST_LATINO = ["Reyes", "Cruz", "Vega", "Morales", "Rivera", "Castillo", "Guzman", "Herrera", "Ramirez", "Delgado", "Salazar", "Mendoza", "Ortiz", "Vargas", "Santos", "Pena", "Rosario", "Tavarez", "Nunez", "Batista"];
  function poolFor(eth) {
    if (eth === "latino") return [FIRST_LATINO, LAST_LATINO];
    if (eth === "black") return [FIRST_BLACK, LAST_BLACK];
    return [FIRST, LAST];   // mixed default (player crew / neutral / fallback)
  }
  function makeName(eth) { const p = poolFor(eth); return pick(p[0]) + " " + pick(p[1]); }
  function makeBossName(eth) { const p = poolFor(eth); return pick(p[0]) + " '" + pick(BOSS_NICK) + "' " + pick(p[1]); }

  // ============================================================
  //  REAL GANG RANK LADDER (researched: NY/Chicago "corporate pyramid")
  //  Prospect -> Lookout -> Runner -> Soldier -> Enforcer -> Lieutenant -> Boss.
  //  A rank is DATA on the ped (ped.rank). RANKS holds, per tier:
  //    key       internal id stored on ped.rank (legacy "lt"/"soldier"/"boss" kept)
  //    pip       label shown on the floating tag
  //    tier      0..6 ordering (chain of command + income share scale off this)
  //    needBody  bodies (kills for the gang) to be ELIGIBLE for the next rung
  //    needContrib  $ kicked up to the treasury to be ELIGIBLE
  //    cut       share-of-payday weight (skewed: leaders earn far more — Levitt/
  //              Venkatesh: foot soldiers below min wage, the dream of the top cut
  //              is what keeps them loyal)
  //    hp / weapon  gear that rank unlocks when a member climbs
  // ============================================================
  const RANKS = [
    { key: "prospect", pip: "Prospect", tier: 0, needBody: 0, needContrib: 0,   cut: 0.35, hp: 100, weapon: "Pistol" },
    { key: "lookout",  pip: "Lookout",  tier: 1, needBody: 0, needContrib: 60,  cut: 0.5,  hp: 110, weapon: "Pistol" },
    { key: "runner",   pip: "Runner",   tier: 2, needBody: 1, needContrib: 180, cut: 0.7,  hp: 120, weapon: "Pistol" },
    { key: "soldier",  pip: "Soldier",  tier: 3, needBody: 2, needContrib: 420, cut: 1.0,  hp: 140, weapon: "Pistol" },
    { key: "enforcer", pip: "Enforcer", tier: 4, needBody: 5, needContrib: 900, cut: 1.5,  hp: 175, weapon: "SMG" },
    { key: "lt",       pip: "Lt.",      tier: 5, needBody: 9, needContrib: 1700, cut: 2.4, hp: 210, weapon: "SMG" },
    { key: "boss",     pip: "Boss",     tier: 6, needBody: 0, needContrib: 0,   cut: 5.0,  hp: 260, weapon: "SMG" },
  ];
  const RANK_BY_KEY = {}; RANKS.forEach((r, i) => { RANK_BY_KEY[r.key] = r; r.idx = i; });
  function rankDef(key) { return RANK_BY_KEY[key] || RANK_BY_KEY.soldier; }
  function rankTier(ped) { return ped ? (rankDef(ped.rank).tier) : 0; }
  CBZ.cityRankLadder = function () { return RANKS.map((r) => ({ key: r.key, pip: r.pip, tier: r.tier })); }; // read-only view
  CBZ.cityRankName = function (key) { return (RANK_BY_KEY[key] || {}).pip || "Crew"; };

  // give a member their stat sheet the first time we touch them. This is the
  // LIFECYCLE record the whole hierarchy runs on — nothing here is hardcoded;
  // promotion, pay, loyalty + defection all read these tracked numbers.
  function memStats(m) {
    if (!m.gstat) {
      m.gstat = {
        bodies: 0,        // kills put in for the gang (promotion currency)
        contrib: 0,       // $ kicked up to the treasury (promotion currency)
        served: 0,        // seconds in the crew (seniority)
        orders: 0,        // orders completed (raids held / hits done)
        loyalty: 0.55 + rng() * 0.2,  // 0..1; pay/wins raise it, losses/disrespect drop it
        earned: 0,        // lifetime cut paid to them (their "wages")
        joined: "spawn",  // how they got in: spawn / jumped / work / poach / defect
      };
    }
    return m.gstat;
  }
  CBZ.cityMemberStats = memStats;
  // public loyalty read for HUD / other systems
  CBZ.cityMemberLoyalty = function (m) { return m && m.gstat ? m.gstat.loyalty : (m && m.loyalty != null ? m.loyalty : 0.5); };

  // rank ladder shown as a small PIP suffix on the name tag — the rank is read
  // from ped.rank (data), so the tag says e.g. "Marcus Vance · Lt." not a surname.
  const RANK_PIP = { boss: "Boss", lt: "Lt.", enforcer: "Enforcer", soldier: "Soldier", runner: "Runner", lookout: "Lookout", prospect: "Prospect" };
  // rebuild a member's floating name tag so it reads "<Name> · <Rank>" in the
  // gang colour. Mirrors playergang.js styleMember: swap the cached label sprite,
  // keep its transform, leave it hidden until the ped's LOD shows it.
  function tagWithRank(ped, color) {
    if (!ped || !ped.tag || !ped.char || !ped.char.group || !CBZ.makeLabelSprite) return;
    const pip = RANK_PIP[ped.rank] || "";
    const txt = (ped.name || "Crew") + (pip ? " · " + pip : "");
    const col = "#" + ("000000" + ((color >>> 0).toString(16))).slice(-6);
    const lbl = CBZ.makeLabelSprite(txt, { color: col });
    lbl.position.y = ped.tag.position.y || 3.0; lbl.scale.copy(ped.tag.scale);
    if (ped.tag.parent) ped.tag.parent.remove(ped.tag);
    ped.char.group.add(lbl); ped.tag = lbl; ped.tag.visible = false;
    ped.tagColor = col;
  }

  CBZ.spawnCityGangs = function () {
    const A = CBZ.city && CBZ.city.arena; if (!A) return;
    _s = 99173;
    CBZ.cityGangs.length = 0;
    const defs = CBZ.CITY.gangs || [];
    if (!defs.length) return;
    const aband = (A.abandonedLots || []).slice();
    if (!aband.length) return;

    // build the gang records. treasury funds raids; hostility/strikes track how
    // hard the crew is hunting the PLAYER after a provocation (escalation ladder).
    const gangs = defs.map((d) => ({
      ...d, turf: [], center: { x: 0, z: 0 }, provoke: 0, members: [],
      warWith: null, warRemain: 0, warIntensity: 0,
      treasury: 200 + ((rng() * 400) | 0),   // seed war chest
      hostility: 0, strikeT: 0, lostTurfT: 0, peakTurf: 0,
    }));
    // hand each derelict to a gang, clustering by nearest existing turf so a
    // faction tends to hold a contiguous block
    aband.forEach((lot, i) => {
      const gang = gangs[i % gangs.length];
      gang.turf.push(lot);
      lot.building.gang = gang.id;
      lot.building.gangColor = gang.color;
      if (lot.building.stash) lot.building.stash.gang = gang.id;
    });
    // turf centre + member spawn
    const [lo, hi] = CBZ.CITY.gangPerTurf || [3, 6];
    const armedFrac = CBZ.CITY.gangArmedFrac != null ? CBZ.CITY.gangArmedFrac : 0.55;
    const ag = CBZ.CITY.aggro || {};
    for (const gang of gangs) {
      if (!gang.turf.length) continue;
      let sx = 0, sz = 0;
      for (const l of gang.turf) { sx += l.cx; sz += l.cz; }
      gang.center.x = sx / gang.turf.length; gang.center.z = sz / gang.turf.length;
      gang.peakTurf = gang.turf.length;
      // ---- the gang BOSS: a named, tougher, always-armed lieutenant anchoring
      //      the crew's main turf. Defeating one is a real prize + heavy heat. ----
      {
        const blot = gang.turf[0];
        const boss = CBZ.cityMakePed(blot.cx + 1.5, blot.cz, rng, {
          kind: "gang", gang: gang.id, faction: gang.id, guard: { x: blot.cx, z: blot.cz },
          outfit: gang.color, wealth: 0.96,        // top of the ladder — rich, robbing him is a real score
          aggr: clamp(rollGang(ag) + 0.08, 0.8, 1),
          archetype: "gangster", job: "gang boss",
          armed: true, weapon: "SMG", hp: 240,     // the boss is always the most heavily strapped
          name: makeBossName(gang.ethnicity),
        });
        boss.homeGuard = { x: blot.cx, z: blot.cz };
        boss.isBoss = true; boss.rank = "boss"; boss.maxHp = 240; boss.ammo = 50;
        const bs = memStats(boss); bs.loyalty = 1; bs.bodies = 12 + ((rng() * 8) | 0); bs.joined = "founder";
        gang.boss = boss; gang.bossName = boss.name;
        tagWithRank(boss, gang.color);   // "<Name> '<Nick>' <Last> · Boss"
        A.root.add(boss.group);
        CBZ.cityPeds.push(boss);
        gang.members.push(boss);
      }
      // recolour this turf's graffiti hint (stash glow) toward the gang colour
      for (const lot of gang.turf) {
        if (lot.building.stash && lot.building.stash.mesh && lot.building.stash.mesh.material && lot.building.stash.mesh.material.emissive) {
          try { lot.building.stash.mesh.material.emissive.setHex(gang.color); } catch (e) {}
        }
        const n = lo + ((rng() * (hi - lo + 1)) | 0);
        for (let k = 0; k < n; k++) {
          const ang = rng() * 6.28, rad = 2.5 + rng() * 5;
          const x = lot.cx + Math.cos(ang) * rad, z = lot.cz + Math.sin(ang) * rad;
          // a REAL pyramid under the boss: the first holder of each lot is a
          // LIEUTENANT, then an Enforcer, then the bench fills Soldier/Runner/
          // Lookout — a believable spread of veterans + low men who'll climb on
          // merit over the run. EVERY member is strapped. Each gets a REAL
          // First-Last name; rank lives on ped.rank + shows as a tag pip.
          const rk = k === 0 ? "lt" : k === 1 ? "enforcer" : (k <= 3 ? "soldier" : (rng() < 0.5 ? "runner" : "lookout"));
          const rd = rankDef(rk);
          const ped = CBZ.cityMakePed(x, z, rng, {
            kind: "gang", gang: gang.id, faction: gang.id,
            guard: { x: lot.cx, z: lot.cz },
            outfit: gang.color, wealth: 0.3 + rd.tier * 0.08,
            aggr: clamp(rollGang(ag), 0.6, 1),
            archetype: "gangster", job: "gang " + rd.pip.toLowerCase().replace(".", ""),
            armed: true, weapon: rd.weapon === "SMG" ? (rng() < 0.5 ? "SMG" : "Pistol") : "Pistol",
            hp: rd.hp,
            name: makeName(gang.ethnicity),
          });
          ped.rank = rk;
          ped.ammo = rd.weapon === "SMG" ? 40 : 30;
          ped.homeGuard = { x: lot.cx, z: lot.cz };
          // seed a plausible career so they're partway up the merit track already
          const ms = memStats(ped); ms.bodies = (rd.tier) + ((rng() * 2) | 0); ms.contrib = rd.tier * 120 * rng(); ms.served = 30 + rng() * 120;
          tagWithRank(ped, gang.color);   // "<Name> · Lt." etc.
          A.root.add(ped.group);
          CBZ.cityPeds.push(ped);
          gang.members.push(ped);
        }
      }
      CBZ.cityGangs.push(gang);
    }
  };

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function rollGang(ag) { const r = (rng() + rng()) / 2; return (ag.meanGang != null ? ag.meanGang : 0.8) + (r - 0.5) * 2 * (ag.spreadGang || 0.14); }

  function gangById(id) { return CBZ.cityGangs.find((x) => x.id === id); }

  // ============================================================
  //  HIERARCHY ENGINE — promotion on merit, income split by rank,
  //  loyalty/discipline, defection + boss succession. All driven off the
  //  tracked memStats() record, never hardcoded outcomes.
  // ============================================================

  // apply a rank's gear when a member climbs (or is created at a tier)
  function applyRankGear(m, gang) {
    const rd = rankDef(m.rank);
    m.maxHp = Math.max(m.maxHp || 0, rd.hp);
    m.hp = Math.max(m.hp || 1, Math.min(m.maxHp, m.hp + 30));
    m.armed = true;
    // higher rank tends to upgrade the gun; never downgrade an existing better one
    const wantSmg = rd.weapon === "SMG";
    if (wantSmg && (!m.weapon || m.weapon === "Pistol" || m.weapon === "Bat") && rng() < 0.75) m.weapon = "SMG";
    if (!m.weapon || m.weapon === "Bat") m.weapon = rd.weapon;
    m.ammo = Math.max(m.ammo || 0, rd.weapon === "SMG" ? 50 : 30);
    if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(m);
  }

  // can this member climb one rung? eligibility is EARNED — bodies + cash kicked
  // up to the treasury must both clear the next tier's bar, plus a little time.
  function eligibleForPromotion(m) {
    const cur = rankDef(m.rank);
    const next = RANKS[cur.idx + 1];
    if (!next || next.key === "boss") return null;     // only succession makes a boss
    const s = memStats(m);
    if (s.bodies < next.needBody) return null;
    if (s.contrib < next.needContrib) return null;
    if (s.served < 18 + next.tier * 8) return null;     // minimum seniority per rung
    return next;
  }

  // promote one NPC member up the ladder (boss promotes from below — chain of
  // command). Pure data + gear; the brain reads ped.rank for everything else.
  function promoteMember(gang, m, toKey) {
    if (!m || m.dead) return false;
    const cur = rankDef(m.rank);
    const next = toKey ? rankDef(toKey) : RANKS[cur.idx + 1];
    if (!next || next.idx <= cur.idx) return false;
    m.rank = next.key;
    applyRankGear(m, gang);
    tagWithRank(m, gang.color);
    const s = memStats(m); s.loyalty = Math.min(1, s.loyalty + 0.12);   // promotion buys loyalty
    if (gang.isPlayer && CBZ.city && nearPlayer(m.pos.x, m.pos.z, 60)) {
      CBZ.city.note("⬆ " + (m.name || "Crew") + " earned " + next.pip + ".", 2.2);
    }
    return true;
  }
  CBZ.cityGangRankUp = function (m, toKey) {
    const gang = m && m.gang ? gangById(m.gang) : null;
    return promoteMember(gang || { color: 0x7ed957 }, m, toKey);
  };

  // record a body put in for the crew + the respect it earns toward the ladder.
  // gangs.js cityGangMemberDown already fires when a member dies; THIS is the
  // mirror for when a member KILLS for the gang (peds.js routes kills through
  // cityKillPed -> we hook the attacker here via cityGangMemberScored).
  CBZ.cityGangMemberScored = function (attacker, victim) {
    if (!attacker || !attacker.gang) return;
    const gang = gangById(attacker.gang); if (!gang) return;
    const s = memStats(attacker);
    s.bodies++; s.loyalty = Math.min(1, s.loyalty + 0.03);
    // a body against a RIVAL on contested ground is worth more standing
    const rivalKill = victim && victim.gang && victim.gang !== attacker.gang;
    if (rivalKill) gang.warIntensity = Math.min(3, (gang.warIntensity || 0) + 0.15);
  };

  // discipline: a member who fails / flees / loses badly takes a loyalty hit;
  // chronic low loyalty triggers a real consequence (defect or get clipped).
  function disciplineHit(gang, m, amt) {
    const s = memStats(m);
    s.loyalty = Math.max(0, s.loyalty - amt);
  }

  // ---- DEFECTION + DISCIPLINE sweep (called from the slow upkeep tick) ----
  // A disgruntled member (low loyalty) eyes a stronger / richer rival and walks.
  // A boss who can't pay (broke treasury during a war) bleeds loyalty crew-wide.
  function bestPoachTarget(forGang, m) {
    // the most attractive rival to defect to: more bodies + fuller war chest,
    // and NOT at war with where you'd be running from being clipped on the way.
    let best = null, bs = -1;
    for (const o of CBZ.cityGangs) {
      if (o === forGang || o.absorbed || !o.turf || !o.turf.length) continue;
      const str = gangStrength(o);
      const score = str * 8 + (o.treasury || 0) / 60 - (o.isPlayer ? 0 : 0);
      // must be meaningfully stronger/richer than home to be worth the risk
      const homeScore = gangStrength(forGang) * 8 + (forGang.treasury || 0) / 60;
      if (score > homeScore * 1.25 && score > bs) { bs = score; best = o; }
    }
    return best;
  }

  function defectMember(fromGang, m, toGang) {
    if (!m || m.dead || !toGang) return false;
    // pull from old roster
    const i = fromGang.members.indexOf(m); if (i >= 0) fromGang.members.splice(i, 1);
    if (toGang.isPlayer && CBZ.cityPlayerGangEnlist) {
      CBZ.cityPlayerGangEnlist(m, "prospect");   // join the player at the bottom
    } else {
      m.gang = toGang.id; m.faction = toGang.id; m.rank = "prospect";
      m.outfit = toGang.color; m.homeGuard = toGang.center ? { x: toGang.center.x, z: toGang.center.z } : m.homeGuard;
      m.guard = m.homeGuard; toGang.members.push(m);
      applyRankGear(m, toGang); tagWithRank(m, toGang.color);
    }
    const s = memStats(m); s.loyalty = 0.5; s.joined = "defect"; s.bodies = 0; s.contrib = 0;
    if (nearPlayer(m.pos.x, m.pos.z, 90)) {
      CBZ.city && CBZ.city.note("🏳 " + (m.name || "A soldier") + " defected from " + fromGang.name + " to " + toGang.name + ".", 2.4);
    }
    return true;
  }

  // BOSS SUCCESSION — kingpin down, the crew doesn't just evaporate. The top
  // surviving member by rank+merit rises; if the bench is thin the gang fractures
  // (loyalty crashes, defections spike) — researched attrition shaping the pyramid.
  function succeedBoss(gang) {
    if (!gang || gang.isPlayer) return;
    // if the PLAYER rides with this crew as a senior member, the succession is
    // theirs to seize — defer to playergang.js (don't crown an NPC out from under
    // them). g.cityMembership is the player's patch into an NPC gang.
    const pm = g.cityMembership;
    if (pm && pm.gangId === gang.id && (pm.rank === "lt" || pm.rank === "enforcer")) return;
    const live = gang.members.filter((m) => m && !m.dead && m !== gang.boss);
    if (!live.length) { gang.boss = null; gang.leaderless = true; return; }
    // rank the bench: tier, then bodies, then loyalty, then contribution
    live.sort((a, b) => {
      const ta = rankTier(a), tb = rankTier(b);
      if (tb !== ta) return tb - ta;
      const sa = memStats(a), sb = memStats(b);
      if (sb.bodies !== sa.bodies) return sb.bodies - sa.bodies;
      if (sb.loyalty !== sa.loyalty) return sb.loyalty - sa.loyalty;
      return sb.contrib - sa.contrib;
    });
    const heir = live[0];
    const wasStrong = rankTier(heir) >= 4;     // an Enforcer/Lt rising = clean handover
    heir.rank = "boss"; heir.isBoss = true; gang.boss = heir; gang.bossName = heir.name;
    heir.name = heir.name && heir.name.indexOf("'") < 0 ? makeBossName(gang.ethnicity) : heir.name;
    applyRankGear(heir, gang); tagWithRank(heir, gang.color);
    gang.bossDead = false; gang.leaderless = false;
    // a weak handover fractures morale — everyone wobbles, some will walk
    const moraleHit = wasStrong ? 0.05 : 0.22;
    for (const m of live) disciplineHit(gang, m, moraleHit);
    if (nearPlayer(gang.center.x, gang.center.z, 160)) {
      CBZ.city && CBZ.city.note("👑 " + heir.name + " seized control of " + gang.name + (wasStrong ? "." : " — the crew's shaky."), 3);
    }
  }
  CBZ.cityGangSucceed = succeedBoss;

  // periodic merit review + loyalty economy for one NPC crew. Promotes who's
  // earned it, kicks pay up the chain, defects the disloyal, clips dead weight.
  function reviewGang(gang, dt) {
    if (!gang || gang.isPlayer || gang.absorbed) return;
    let promotedThisPass = 0;
    // iterate a SNAPSHOT — defection/clipping mutate gang.members mid-pass
    const roster = gang.members.slice();
    for (const m of roster) {
      if (!m || m.dead || m === gang.boss) continue;
      const s = memStats(m);
      s.served += dt;
      // earn loyalty just by being paid + winning; lose it during a losing war
      if (gang.lostTurfT > 0) s.loyalty = Math.max(0, s.loyalty - dt * 0.02);
      // merit promotion (chain of command: capped per pass so it's gradual)
      if (promotedThisPass < 1) {
        const next = eligibleForPromotion(m);
        // only promote up to one tier below the boss for NPC crews (Lt is the ceiling)
        if (next && rankDef(m.rank).idx < rankDef("lt").idx) {
          if (promoteMember(gang, m)) { promotedThisPass++; s.bodies = Math.max(0, s.bodies - next.needBody); }
        }
      }
      // DEFECTION: chronically disloyal -> walk to a stronger crew, or get clipped
      if (s.loyalty < 0.18 && rng() < dt * 0.05) {
        const dest = bestPoachTarget(gang, m);
        if (dest) { defectMember(gang, m, dest); }
        else if (rng() < 0.3) {
          // nowhere to run + no loyalty: the crew clips the dead weight (discipline)
          m.hp = 0;
          if (CBZ.cityKillPed) CBZ.cityKillPed(m, { fromX: gang.center.x, fromZ: gang.center.z, byPlayer: false, force: 3 }, "discipline");
        }
      }
    }
  }

  function launchWar(a, b, opts) {
    if (!a || !b || a === b || !b.turf.length) return 0;
    if (a.isPlayer) return 0;   // your gang only raids on YOUR orders, never on its own
    opts = opts || {};
    const targetLot = opts.lot || b.turf[(rng() * b.turf.length) | 0];
    // BIGGER set-piece battles: a flush treasury / hot war buys a deeper push.
    // GTA SA scales wave size with how heavily a hood is defended; here the
    // attacker's WAR CHEST and current intensity decide how many it commits.
    const warMul = 1 + Math.min(1.4, (a.warIntensity || 0) * 0.5 + (a.treasury || 0) / 2200);
    const base = opts.assault ? 4 : 2;
    const count = Math.min(8, Math.round((base + ((rng() * 3) | 0)) * warMul));
    let sent = 0;
    // spend the chest to field the squad — a poor gang can't mount a big raid
    const cost = count * 40;
    if (!opts.free && (a.treasury || 0) < cost * 0.5) return 0;
    a.treasury = Math.max(0, (a.treasury || 0) - cost);
    for (const m of a.members) {
      if (sent >= count) break;
      if (m.dead || m.rage || m.inCar || m.raidT > 0) continue;
      m.homeGuard = m.homeGuard || m.guard;
      m.guard = { x: targetLot.cx, z: targetLot.cz };
      m.target.set(targetLot.cx + (rng() - 0.5) * 5, 0, targetLot.cz + (rng() - 0.5) * 5);
      m.pause = 0; m.path = null; m.raidT = 22 + rng() * 14; m.raidGang = b.id;
      m.raidLot = targetLot;
      sent++;
    }
    if (sent) {
      a.warWith = b.id; b.warWith = a.id;
      a.warRemain = b.warRemain = 26 + rng() * 14;
      a.warIntensity = Math.min(3, (a.warIntensity || 0) + 1);
      b.warIntensity = Math.min(3, (b.warIntensity || 0) + 0.6);
      a._raidTarget = targetLot;   // contested lot, used for capture resolution
      const big = sent >= 5;
      CBZ.city && CBZ.city.note((big ? "⚔ TURF WAR: " : "Gang war: ") + a.name + " hit " + b.name + " turf (" + sent + ").", big ? 3 : 2.4);
      // a heavy assault also rolls a drive-by car into the rival block
      if (big && rng() < 0.6) spawnDriveby(a, { x: targetLot.cx, z: targetLot.cz }, b);
      // raiding YOUR block? rally your gang to defend it
      if (b.isPlayer && CBZ.cityPlayerGangDefendTurf) {
        CBZ.cityPlayerGangDefendTurf(targetLot.cx, targetLot.cz);
        CBZ.city && CBZ.city.big("⚠ " + a.name + " RAIDING YOUR TURF");
        if (CBZ.sfx) CBZ.sfx("siren");
      }
    } else {
      a.treasury += cost;   // refund — nobody was free to go
    }
    return sent;
  }
  CBZ.cityStartGangWar = launchWar;

  // ---- TURF CAPTURE: resolve a contested rival block after a raid ----
  // GTA SA flips a hood when the attacker clears the defenders. We approximate:
  // if the attacker has bodies on the lot and the defender has none nearby, the
  // block changes hands (NPC vs NPC only — player turf is handled by playergang).
  function liveOnLot(gang, lot, r) {
    const r2 = (r || 11) * (r || 11); let n = 0;
    for (const m of gang.members) {
      if (m.dead || m.ko) continue;
      const dx = m.pos.x - lot.cx, dz = m.pos.z - lot.cz;
      if (dx * dx + dz * dz < r2) n++;
    }
    return n;
  }

  function captureLot(winner, loser, lot) {
    if (!winner || !loser || winner.isPlayer || loser.isPlayer) return false;  // player turf is sacred to this path
    const i = loser.turf.indexOf(lot); if (i < 0) return false;
    loser.turf.splice(i, 1);
    winner.turf.push(lot);
    lot.building.gang = winner.id;
    lot.building.gangColor = winner.color;
    if (lot.building.stash) lot.building.stash.gang = winner.id;
    if (lot.building.stash && lot.building.stash.mesh && lot.building.stash.mesh.material && lot.building.stash.mesh.material.emissive) {
      try { lot.building.stash.mesh.material.emissive.setHex(winner.color); } catch (e) {}
    }
    // re-home any winner members who raided here so they hold the new ground
    for (const m of winner.members) {
      if (m.raidLot === lot && !m.dead) { m.homeGuard = { x: lot.cx, z: lot.cz }; m.guard = { x: lot.cx, z: lot.cz }; m.raidT = 0; m.raidGang = null; m.raidLot = null; }
    }
    recenter(winner); recenter(loser);
    loser.lostTurfT = 8;
    if (nearPlayer(lot.cx, lot.cz, 90)) {
      CBZ.city && CBZ.city.note("🚩 " + winner.name + " seized a block from " + loser.name + ".", 2.6);
    }
    if (CBZ.cityRefreshTurfHud) CBZ.cityRefreshTurfHud();
    return true;
  }
  CBZ.cityGangCaptureLot = captureLot;

  function recenter(gang) {
    if (!gang.turf.length) { gang.center.x = 0; gang.center.z = 0; return; }
    let sx = 0, sz = 0; for (const l of gang.turf) { sx += l.cx; sz += l.cz; }
    gang.center.x = sx / gang.turf.length; gang.center.z = sz / gang.turf.length;
  }

  function nearPlayer(x, z, r) {
    const P = CBZ.player; if (!P || !P.pos) return false;
    const dx = P.pos.x - x, dz = P.pos.z - z; return dx * dx + dz * dz < r * r;
  }
  function playerActor() { return CBZ.city && CBZ.city.playerActor; }

  // ============================================================
  //  DRIVE-BY SHOOTINGS — a gang car rolls a target and the passenger
  //  hangs out the window strafing tracers (GTA III introduced this; we
  //  model the classic "any SMG → lean and spray" pass). Fully self-contained
  //  so it never touches the traffic AI in another file. Pooled + capped.
  // ============================================================
  const drivebys = [];
  let _dbGeo = null, _dbWheelGeo = null;
  function dbCarGeo() {
    if (!_dbGeo) {
      _dbGeo = new THREE.BoxGeometry(2.0, 0.9, 4.2); _dbGeo._shared = true;
      _dbWheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.34, 8); _dbWheelGeo._shared = true;
      _dbWheelGeo.rotateZ(Math.PI / 2);
    }
    return _dbGeo;
  }
  function buildDbCar(color) {
    const grp = new THREE.Group();
    const body = new THREE.Mesh(dbCarGeo(), new THREE.MeshLambertMaterial({ color: 0x16181d }));
    body.position.y = 0.75; grp.add(body);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.7, 2.0), new THREE.MeshLambertMaterial({ color: color, emissive: color, emissiveIntensity: 0.18 }));
    cabin.position.set(0, 1.45, -0.2); grp.add(cabin);
    const wm = new THREE.MeshLambertMaterial({ color: 0x0a0a0c });
    for (const wx of [-0.95, 0.95]) for (const wz of [1.35, -1.35]) {
      const w = new THREE.Mesh(_dbWheelGeo, wm); w.position.set(wx, 0.42, wz); grp.add(w);
    }
    grp._cabinMat = cabin.material;
    return grp;
  }

  function spawnDriveby(gang, aim, victimGang) {
    if (activeDrivebys >= MAX_DRIVEBYS || g.mode !== "city") return false;
    const A = CBZ.city && CBZ.city.arena; if (!A || !A.root) return false;
    // approach from a road edge a comfortable distance out, on the side the
    // player can see it coming (more readable / fairer than spawning on top).
    const tx = aim.x, tz = aim.z;
    const ang = rng() * 6.28, R = 34 + rng() * 10;
    let sx = tx + Math.cos(ang) * R, sz = tz + Math.sin(ang) * R;
    if (A.clampToCity) { const p = { x: sx, z: sz }; A.clampToCity(p, 2); sx = p.x; sz = p.z; }
    const grp = buildDbCar(gang.color || 0xb079ea);
    grp.position.set(sx, 0, sz); A.root.add(grp);
    const db = {
      grp, gang, victimGang: victimGang || null,
      x: sx, z: sz, heading: 0, v: 0,
      aimX: tx, aimZ: tz, passes: 0, maxPasses: 1 + ((rng() * 2) | 0),
      shootCD: 0, life: 16 + rng() * 6, state: "approach",
      crew: 1 + ((rng() * 2) | 0),   // bodies that bail if it's wrecked (flavour)
    };
    drivebys.push(db); activeDrivebys++;
    if (nearPlayer(sx, sz, 70)) {
      CBZ.city && CBZ.city.note("🚙 " + gang.name + " rolling up...", 1.6);
      // no engine sample in the bank; the first drive-by burst (shoot_smg) is the
      // real audio cue, so we don't fake a roll-up with an unrelated "whoosh".
    }
    return true;
  }
  CBZ.cityGangDriveby = spawnDriveby;

  function despawnDriveby(db, idx) {
    if (db.grp && db.grp.parent) db.grp.parent.remove(db.grp);
    if (db.grp) db.grp.traverse(function (o) {
      if (o.geometry && !o.geometry._shared && o.geometry.dispose) o.geometry.dispose();
      if (o.material && !o.material._shared && o.material.dispose) o.material.dispose();
    });
    drivebys.splice(idx, 1); activeDrivebys = Math.max(0, activeDrivebys - 1);
  }

  // pick who the gun in the car points at: the player if they're the cause,
  // else the nearest rival gangster near the aim point.
  function drivebyVictim(db) {
    const P = CBZ.player, PA = playerActor();
    // hunting the player (reprisal) — only if reasonably close to the route
    if (db.huntPlayer && PA && P && !P.dead) {
      const dx = P.pos.x - db.x, dz = P.pos.z - db.z;
      if (dx * dx + dz * dz < 24 * 24) return PA;
    }
    // otherwise spray a rival gangster
    let best = null, bd = 22 * 22;
    for (const p of CBZ.cityPeds) {
      if (p.dead || !p.gang || p.gang === db.gang.id) continue;
      if (db.victimGang && p.gang !== db.victimGang.id) continue;
      const dx = p.pos.x - db.x, dz = p.pos.z - db.z, dd = dx * dx + dz * dz;
      if (dd < bd) { bd = dd; best = p; }
    }
    return best;
  }

  function updateDrivebys(dt) {
    for (let i = drivebys.length - 1; i >= 0; i--) {
      const db = drivebys[i];
      db.life -= dt; db.shootCD -= dt;
      if (db.life <= 0 || db.passes > db.maxPasses) { despawnDriveby(db, i); continue; }
      // steer toward / past the aim point
      const ddx = db.aimX - db.x, ddz = db.aimZ - db.z;
      const dist = Math.hypot(ddx, ddz) || 0.001;
      const want = Math.atan2(ddx, ddz);
      // ease heading
      let dh = want - db.heading; while (dh > Math.PI) dh -= 6.283; while (dh < -Math.PI) dh += 6.283;
      db.heading += dh * Math.min(1, dt * 2.4);
      const target = db.state === "approach" ? 14 : 11;
      db.v += (target - db.v) * Math.min(1, dt * 1.5);
      const nx = db.x + Math.sin(db.heading) * db.v * dt;
      const nz = db.z + Math.cos(db.heading) * db.v * dt;
      db.x = nx; db.z = nz;
      const A = CBZ.city && CBZ.city.arena;
      if (A && A.clampToCity) { const p = { x: db.x, z: db.z }; A.clampToCity(p, 1.6); db.x = p.x; db.z = p.z; }
      db.grp.position.set(db.x, 0, db.z); db.grp.rotation.y = db.heading;
      // close pass → it's "alongside", start spraying; then it loops for another pass
      if (dist < 16) {
        db.state = "strafe";
        if (db.shootCD <= 0) {
          const v = drivebyVictim(db);
          if (v && !v.dead) {
            db.shootCD = 0.22 + rng() * 0.18;
            const from = { x: db.x + Math.cos(db.heading) * 1.0, y: 1.3, z: db.z - Math.sin(db.heading) * 1.0 };
            const to = { x: v.pos.x, y: v.isPlayer ? 1.55 : 1.3, z: v.pos.z };
            if (CBZ.tracer) CBZ.tracer(from, to, { muzzleScale: 0.9 });
            if (CBZ.sfx) CBZ.sfx("shoot_smg");
            const dd = Math.hypot(v.pos.x - db.x, v.pos.z - db.z);
            if (rng() < Math.max(0.18, 0.62 - dd * 0.02)) {
              const dmg = 10 + rng() * 9;
              if (v.isPlayer) { if (CBZ.cityHurtPlayer) CBZ.cityHurtPlayer(dmg, db.x, db.z, "killed in a drive-by", false, db.gang.name, false); }
              else {
                v.hp -= dmg; v.alarmed = Math.max(v.alarmed || 0, 6);
                if (v.hp <= 0) { if (CBZ.cityKillPed) CBZ.cityKillPed(v, { fromX: db.x, fromZ: db.z, byPlayer: false, force: 5, fling: 4 }, "drive-by"); }
                else if (CBZ.body && CBZ.body.hit) CBZ.body.hit(v, { fromX: db.x, fromZ: db.z, force: 1.5 });
              }
            }
          }
        }
      }
      // passed it: pick a fresh aim point on the far side for the next loop
      if (dist < 3.5 && db.state === "strafe") {
        db.passes++;
        if (db.passes <= db.maxPasses) {
          const a2 = rng() * 6.28, r2 = 26 + rng() * 8;
          db.aimX += Math.cos(a2) * r2; db.aimZ += Math.sin(a2) * r2;
          if (A && A.clampToCity) { const p = { x: db.aimX, z: db.aimZ }; A.clampToCity(p, 2); db.aimX = p.x; db.aimZ = p.z; }
          db.state = "approach";
        }
      }
    }
  }

  // which gang's turf is (x,z) inside? returns the gang record or null
  CBZ.cityGangOf = function (x, z) {
    let best = null, bd = 14 * 14;
    for (const gang of CBZ.cityGangs) for (const lot of gang.turf) {
      const dd = (lot.cx - x) * (lot.cx - x) + (lot.cz - z) * (lot.cz - z);
      if (dd < bd) { bd = dd; best = gang; }
    }
    return best;
  };

  CBZ.cityGangProvoke = function (id, amount) {
    const gang = gangById(id);
    // a crew the player rides with doesn't turn on them for ambient heat
    if (gang && gang.playerFriendly) return;
    if (gang) gang.provoke = Math.min(1, gang.provoke + (amount || 0.3));
  };
  CBZ.cityGangProvoked = function (id) { const gang = gangById(id); return gang ? gang.provoke : 0; };

  // mark a crew as FRIENDLY to the player (they joined it). Clears hostility and
  // tells the reprisal/turf systems to leave the player be while they ride.
  CBZ.cityGangSetPlayerFriendly = function (id, on) {
    const gang = gangById(id); if (!gang) return;
    gang.playerFriendly = !!on;
    if (on) { gang.provoke = 0; gang.hostility = 0; gang.strikeT = 9e9; }
    else gang.strikeT = 0;
  };

  // a member went down — the crew takes it personally. ESCALATION LADDER:
  // each kill the player racks up against a crew raises HOSTILITY, which the
  // reprisal director reads to send hunter squads + drive-bys after the player.
  CBZ.cityGangMemberDown = function (ped, imp) {
    const gang = gangById(ped.gang); if (!gang) return;
    const byPlayer = !imp || imp.byPlayer !== false;
    gang.provoke = Math.min(1, gang.provoke + (byPlayer ? 0.5 : 0.25));
    const wasBoss = (ped.isBoss || ped.rank === "boss" || ped === gang.boss);
    // losing a brother shakes the surviving crew — a real morale/loyalty hit,
    // sharper if it was the boss. This is what makes a hammered gang fracture.
    const moraleHit = wasBoss ? 0.18 : 0.05;
    for (const m of gang.members) { if (m !== ped && !m.dead) disciplineHit(gang, m, moraleHit); }
    if (byPlayer) {
      CBZ.city && CBZ.city.addRespect(3);
      gang.hostility = Math.min(5, (gang.hostility || 0) + 1);   // they remember
      gang.strikeT = Math.min(gang.strikeT || 0, 6);             // first reprisal comes soon
    } else {
      // a RIVAL did this on/near our turf → it counts toward an active war,
      // softening this crew so the killer's gang can move on the block.
      const killer = imp && imp.attacker;
      if (killer && killer.gang && killer.gang !== gang.id) {
        const ag = gangById(killer.gang);
        if (ag && !ag.isPlayer) ag.warIntensity = Math.min(3, (ag.warIntensity || 0) + 0.25);
        // the killer PUT IN WORK — credit a body toward their climb up the ladder
        CBZ.cityGangMemberScored(killer, ped);
      }
    }
    // remove the body from the live roster so strength/income/pyramid update
    const ri = gang.members.indexOf(ped); if (ri >= 0 && ped.dead) { /* keep ref for kill feed; reviewGang skips dead */ }
    // BOSS down → succession (NPC) or a player takeover prize. Flag it either way
    // so the upkeep tick promotes the heir for rival-on-rival kingpin kills too.
    if (wasBoss && !gang.isPlayer) {
      gang.bossDead = true;
      if (byPlayer) {
        if (CBZ.cityPlayerGangBossKilled) CBZ.cityPlayerGangBossKilled(gang);
        CBZ.city && CBZ.city.addRespect(20);
      }
    }
  };

  // crew "strength" = live bodies, used by the war director to find the weak
  // gang a rival (or the player) can exploit, and to gate big assaults.
  function gangStrength(gang) {
    let n = 0; for (const m of gang.members) if (!m.dead && !m.ko) n++;
    return n;
  }
  CBZ.cityGangStrength = gangStrength;

  // send a REPRISAL squad of a provoked crew to hunt the player on foot —
  // GTA gangs that you cross come looking for you, not just defend turf.
  function sendReprisal(gang) {
    const P = CBZ.player, PA = playerActor();
    if (!P || !PA || P.dead || gang.isPlayer) return 0;
    const count = Math.min(6, 1 + Math.round((gang.hostility || 1)));
    let sent = 0;
    for (const m of gang.members) {
      if (sent >= count) break;
      if (m.dead || m.inCar || m.companion) continue;
      // pull them off the post to hunt — they path to the player and engage
      m.homeGuard = m.homeGuard || m.guard;
      m.rage = PA; m.state = "fight";
      m.target.set(P.pos.x, 0, P.pos.z);
      m.raidT = 18 + rng() * 10; m.raidGang = null; m.pause = 0; m.path = null;
      m.hunting = true;
      sent++;
    }
    if (sent && nearPlayer(gang.center.x, gang.center.z, 220)) {
      CBZ.city && CBZ.city.big("⚠ " + gang.name + " sent a hit squad after you");
    }
    return sent;
  }

  // expose a lookup so the player-gang hub can find a rival by id/record
  CBZ.cityGangById = gangById;

  // ---- rob a gang's stash (interact.js [I] near the stash duffel) ----
  CBZ.cityRobStash = function (lot) {
    const st = lot && lot.building && lot.building.stash;
    if (!st || st.looted) { CBZ.city && CBZ.city.note("Nothing left here.", 1.4); return; }
    st.looted = true;
    const econ = CBZ.cityEcon;
    if (st.cash > 0) CBZ.city.addCash(st.cash);
    if (econ && st.drugs > 0) econ.add(rng() < 0.5 ? "Coke" : "Meth", st.drugs);
    if (st.weapon && econ) econ.add(st.weapon, 1);
    if (st.mesh && st.mesh.material && st.mesh.material.color) try { st.mesh.material.color.setHex(0x202020); } catch (e) {}
    CBZ.city.addRespect(8);
    CBZ.city.big("STASH ROBBED + $" + st.cash);
    if (CBZ.sfx) CBZ.sfx("coin");
    // the whole gang knows + the cops get a tip
    if (st.gang) CBZ.cityGangProvoke(st.gang, 1);
    CBZ.cityAlarm && CBZ.cityAlarm(lot.cx, lot.cz, 28, 1.6);
    CBZ.cityCrime && CBZ.cityCrime(70, { x: lot.cx, z: lot.cz, type: "burglary" });
  };

  CBZ.cityNearestStash = function (x, z, maxd) {
    let best = null, bd = (maxd || 4) * (maxd || 4);
    for (const gang of CBZ.cityGangs) for (const lot of gang.turf) {
      const st = lot.building.stash; if (!st || st.looted) continue;
      const dd = (st.x - x) * (st.x - x) + (st.z - z) * (st.z - z);
      if (dd < bd) { bd = dd; best = lot; }
    }
    return best;
  };

  // the takeover meta (turf.js) lazily provides this; default to a no-op so the
  // capture path here never errors before turf.js has wired its recompute in.
  CBZ.cityRefreshTurfHud = CBZ.cityRefreshTurfHud || function () {};

  CBZ.cityGangsReset = function () {
    CBZ.cityGangs.length = 0; warT = 0; incomeT = 0; reprisalT = 0; driveT = 0;
    if (CBZ.cityTurfReset) CBZ.cityTurfReset();   // clear the zone/alliance meta for a fresh run
    // clear any in-flight drive-by cars
    for (let i = drivebys.length - 1; i >= 0; i--) despawnDriveby(drivebys[i], i);
    activeDrivebys = 0;
    // stashes persist on the building metadata — un-loot them for a fresh run
    const A = CBZ.city && CBZ.city.arena;
    if (A && A.abandonedLots) for (const lot of A.abandonedLots) {
      const st = lot.building && lot.building.stash;
      if (st) { st.looted = false; if (st.mesh && st.mesh.material && st.mesh.material.color) try { st.mesh.material.color.setHex(0x2a2f26); } catch (e) {} }
    }
  };

  // ---- per-gang upkeep: provoke/hostility decay, war timers, raider return ----
  let reviewT = 0;   // merit-review / loyalty-economy cadence (cheap, time-sliced)
  CBZ.onUpdate(34.5, function (dt) {
    if (g.mode !== "city") return;
    updateDrivebys(dt);

    // ---- HIERARCHY upkeep: succession + a slow merit/loyalty review ----
    // A boss who died mid-frame leaves a power vacuum; the bench takes over.
    for (const gang of CBZ.cityGangs) {
      if (gang.isPlayer || gang.absorbed) continue;
      if (gang.boss && gang.boss.dead && !gang.bossDead) gang.bossDead = true;
      if ((gang.bossDead || !gang.boss || gang.boss.dead) && !gang.absorbed && gang.members.some((m) => !m.dead)) {
        succeedBoss(gang);
      }
    }
    reviewT -= dt;
    if (reviewT <= 0) {
      reviewT = 6;
      for (const gang of CBZ.cityGangs.slice()) reviewGang(gang, 6);   // snapshot: defection can add/remove gangs
    }

    for (const gang of CBZ.cityGangs) {
      if (gang.provoke > 0) gang.provoke = Math.max(0, gang.provoke - dt * 0.03);
      // hostility cools slowly — cross a crew and they stay sore for a while
      if (gang.hostility > 0) gang.hostility = Math.max(0, gang.hostility - dt * 0.012);
      if (gang.warIntensity > 0) gang.warIntensity = Math.max(0, gang.warIntensity - dt * 0.02);
      if (gang.lostTurfT > 0) gang.lostTurfT -= dt;
      if (gang.strikeT > 0) gang.strikeT -= dt;
      if (gang.warRemain > 0) {
        gang.warRemain -= dt;
        if (gang.warRemain <= 0) { gang.warWith = null; gang._raidTarget = null; }
      }
      for (const m of gang.members) {
        if (!(m.raidT > 0)) continue;
        m.raidT -= dt;
        if (m.raidT <= 0 && m.homeGuard && !m.dead) {
          m.guard = { x: m.homeGuard.x, z: m.homeGuard.z };
          m.target.set(m.guard.x, 0, m.guard.z); m.pause = 0; m.path = null; m.raidGang = null; m.raidLot = null; m.hunting = false;
        }
      }
    }

    // ---- TERRITORY INCOME (GTA SA: every held block prints money) ----
    // NPC crews bank a TREASURY that funds wars; the player's gang gets a real
    // payday into the city bank, so holding turf finally MATTERS.
    incomeT -= dt;
    if (incomeT <= 0) {
      incomeT = TURF_PAYDAY;
      for (const gang of CBZ.cityGangs) {
        const lots = gang.turf.length; if (!lots) continue;
        const take = lots * TURF_INCOME_PER_LOT;
        if (gang.isPlayer) {
          // player payday — scaled by crew (more soldiers = more collected)
          const crew = gangStrength(gang);
          const pay = Math.round(take * (0.6 + Math.min(1, crew / 8)));
          if (pay > 0) {
            g.cityBank = (g.cityBank || 0) + pay;
            if (CBZ.cityHudDirty) CBZ.cityHudDirty();
            CBZ.city && CBZ.city.note("💵 Turf payday: +$" + pay + " (" + lots + " blocks) → bank", 2.2);
          }
          // credit each soldier's "earned" by their rank cut so YOUR crew also
          // climbs on merit (autoPromotePlayerCrew reads gstat.earned). A bigger
          // payday = faster promotions, mirroring the NPC economy.
          let wsum = 0; for (const m of gang.members) { if (!m.dead) wsum += rankDef(m.rank).cut; }
          if (wsum > 0) for (const m of gang.members) {
            if (m.dead || m.isBoss) continue;
            const s = memStats(m); s.earned += pay * (rankDef(m.rank).cut / wsum) * 0.5; s.loyalty = Math.min(1, s.loyalty + 0.01);
          }
        } else {
          // GTA/Levitt economics: turf prints money, but it's split SKEWED. Half
          // banks to the war chest; the rest is paid DOWN THE CHAIN by rank cut,
          // and every member kicks a tax UP — fattening contrib (promotion fuel)
          // and loyalty. A WAR collapses the take (price war), souring the crew.
          const atWar = gang.warRemain > 0;
          const gross = take * (atWar ? 0.45 : 1);
          gang.treasury = Math.min(8000, (gang.treasury || 0) + gross * 0.5);
          const pool = gross * 0.5;
          let wsum = 0;
          for (const m of gang.members) { if (!m.dead) wsum += rankDef(m.rank).cut; }
          if (wsum > 0) {
            for (const m of gang.members) {
              if (m.dead) continue;
              const s = memStats(m);
              const share = pool * (rankDef(m.rank).cut / wsum);
              s.earned += share;
              // they kick a cut UP to the boss (counts as contribution = merit)
              const kickUp = share * (0.18 + rankDef(m.rank).tier * 0.02);
              s.contrib += kickUp; gang.treasury = Math.min(8000, gang.treasury + kickUp);
              // getting paid buys loyalty; a dry/war payday erodes it (the dream
              // of the top cut is all that keeps a foot soldier in — they earn
              // below the legit wage day to day, exactly per the research)
              if (atWar) s.loyalty = Math.max(0, s.loyalty - 0.04);
              else if (m === gang.boss) s.loyalty = 1;
              else s.loyalty = Math.min(1, s.loyalty + (share > 8 ? 0.03 : 0.01));
            }
          }
        }
      }
    }

    // ---- DYNAMIC RIVAL-vs-RIVAL WAR DIRECTOR ----
    // A flush, aggressive crew picks on the WEAKEST nearby rival (exploitable:
    // bait two gangs into each other, then walk into the thinned-out turf).
    warT -= dt;
    if (warT <= 0) {
      warT = 18 + rng() * 16;
      const live = CBZ.cityGangs.filter((x) => !x.isPlayer && x.turf.length && gangStrength(x) >= 2);
      if (live.length >= 2) {
        // attacker bias: richest / most aggrieved crew presses first
        live.sort((p, q) => ((q.treasury || 0) + (q.hostility || 0) * 300 + (q.warIntensity || 0) * 200) - ((p.treasury || 0) + (p.hostility || 0) * 300 + (p.warIntensity || 0) * 200));
        const a = live[0];
        const rivals = CBZ.cityGangs.filter((x) => x !== a && x.turf.length && !x.isPlayer);
        if (rivals.length) {
          // target the WEAKEST rival (fewest live bodies) — wars snowball
          rivals.sort((p, q) => gangStrength(p) - gangStrength(q));
          const b = rivals[0];
          const assault = (a.treasury || 0) > 900 || (a.warIntensity || 0) >= 1;
          launchWar(a, b, { assault });
        }
      }
    }

    // ---- TURF CAPTURE resolution: a raid that cleared the lot flips it ----
    for (const a of CBZ.cityGangs) {
      if (a.isPlayer || !a.warWith || !a._raidTarget) continue;
      const lot = a._raidTarget, b = gangById(a.warWith);
      if (!b || b.isPlayer) { a._raidTarget = null; continue; }
      if (b.turf.indexOf(lot) < 0) { a._raidTarget = null; continue; }
      const atk = liveOnLot(a, lot, 11), def = liveOnLot(b, lot, 13);
      if (atk >= 2 && def === 0) {
        captureLot(a, b, lot);
        a._raidTarget = null;
        a.treasury = (a.treasury || 0) + 250;   // spoils
      }
    }

    // ---- ESCALATING RETALIATION against the PLAYER ----
    // Provoked crews don't just wait on their turf: they send foot hit squads
    // and drive-by cars after the player, scaling with how hard you've hit them.
    reprisalT -= dt; driveT -= dt;
    if (reprisalT <= 0) {
      reprisalT = 5 + rng() * 4;
      const P = CBZ.player;
      if (P && !P.dead) {
        for (const gang of CBZ.cityGangs) {
          if (gang.isPlayer || gang.playerFriendly) continue;   // your own crew won't hunt you
          const heat = Math.max(gang.provoke * 1.4, (gang.hostility || 0) * 0.5);
          if (heat < 0.6 || gang.strikeT > 0) continue;
          gang.strikeT = 14 + rng() * 10 - Math.min(8, (gang.hostility || 0) * 1.5);  // sorer = faster
          // close enough to react on foot? send a hit squad.
          if (nearPlayer(gang.center.x, gang.center.z, 130) || (gang.hostility || 0) >= 2) {
            sendReprisal(gang);
          }
          // a hot crew also rolls a DRIVE-BY at the player (cadence-limited)
          if ((gang.hostility || 0) >= 2 && driveT <= 0 && activeDrivebys < MAX_DRIVEBYS && rng() < 0.7) {
            driveT = 9 + rng() * 6;
            if (spawnDriveby(gang, { x: P.pos.x, z: P.pos.z }, null)) {
              const db = drivebys[drivebys.length - 1]; if (db) db.huntPlayer = true;
            }
          }
        }
      }
    }
  });
})();
