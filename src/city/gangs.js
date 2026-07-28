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
   cityGangProvoke/Provoked, cityGangMemberDown, cityRobStash, reset,
   cityGangShapeUp (sizeup.js: a rallied set takes fighting SHAPE now).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;
  const CFG = CBZ.CONFIG = CBZ.CONFIG || {};
  // ---- feature flags (self-defaulted here; each is a one-line revert) ----
  //   GANG_SEEDED     — the gang layout/personality rng derives from the WORLD
  //                     seed (CBZ.seedStream) instead of a hardcoded literal,
  //                     so ?seed=N finally varies the crews like the rest of
  //                     procgen. Off = the classic 99173 LCG, bit-for-bit.
  //   GANG_PERSIST    — the takeover war's truth (turf, treasuries, rosters,
  //                     relations, your crew) rides the g.cityWorld ledger and
  //                     survives a reload (same registration idiom as
  //                     civilwar's "cwar" / militia's "mil" blobs).
  //   GANG_WAR_EVENTS — the rival-war director stages visible set-pieces
  //                     (lieutenant defense, car reinforcements, second waves).
  if (CFG.GANG_SEEDED == null) CFG.GANG_SEEDED = true;
  if (CFG.GANG_PERSIST == null) CFG.GANG_PERSIST = true;
  if (CFG.GANG_WAR_EVENTS == null) CFG.GANG_WAR_EVENTS = true;
  // GANG_HQ_FORTRESS (owner: "gangs own a building and the boss is sitting in
  // an office in an apt on the top floor, with floors of the building filled
  // with security on each floor, then boss top floor with family"). On → each
  // crew's HQ lot is handed to city/occupy.js: a real staircase is cut through
  // the tower, every floor is programmed and garrisoned, and the boss sits in
  // his suite up top with his family. Flip false (or ?cfg_GANG_HQ_FORTRESS=0)
  // for a one-line revert to the single street-level boss ped.
  // The flag is declared here rather than config.js because this file owns the
  // behaviour; config.js only needs the pointer comment.
  if (CFG.GANG_HQ_FORTRESS == null) CFG.GANG_HQ_FORTRESS = true;

  // GANG_SEEDED: a named world-seed stream replaces the magic literal. The
  // draw ORDER is identical either way (every rng() call site is untouched —
  // only the source of bits changes), so the flag is a clean A/B.
  let _s = 99173;
  let _sStream = null;   // set at spawn from CBZ.seedStream("gangs") when GANG_SEEDED
  function rng() { if (_sStream) return _sStream(); _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }

  CBZ.cityGangs = CBZ.cityGangs || [];
  let warT = 0;          // ambient rival-vs-rival war director cooldown
  let incomeT = 0;       // territory payday cooldown (GTA: turf = money)
  let reprisalT = 0;     // escalation tick for provoked gangs hunting the player
  let driveT = 0;        // global drive-by cadence limiter
  let activeDrivebys = 0;// capped by the quality tier so low tiers survive

  // GTA San Andreas turf logic: more held blocks = more income + a deeper bench.
  // We model a gang TREASURY that fills from held turf and funds bigger raids,
  // and a WAR has an INTENSITY the player can read + exploit.
  const TURF_PAYDAY = 30;          // seconds between paydays
  const TURF_INCOME_PER_LOT = 42;  // base $ per held block per payday
  // concurrent gang cars strafing — rides the LIVE quality tier (lo 2 → hi 6;
  // read at every check so the pause-menu slider takes effect immediately).
  const MAX_DRIVEBYS = () => Math.round(CBZ.qScale ? CBZ.qScale(2, 6) : 3);

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
    // `grants` is the rank-VERB layer (factions.js §RANK IS A VERB). Every rung
    // on this ladder ALREADY unlocks something real — more hp and a better gun
    // — which is why only Enforcer carries named verbs: from that rung up you
    // KNOW THE CREW (so you are the one who clocks a stranger wearing our
    // colours) and you are IN LINE FOR THE CHAIR. Both of those were hardcoded
    // rank-string lists elsewhere in the codebase; they are ladder questions
    // now, answered by the ladder.
    { key: "enforcer", pip: "Enforcer", tier: 4, needBody: 5, needContrib: 900, cut: 1.5,  hp: 175, weapon: "SMG", grants: ["vouch", "succeed"] },
    { key: "lt",       pip: "Lt.",      tier: 5, needBody: 9, needContrib: 1700, cut: 2.4, hp: 210, weapon: "SMG" },
    // locked: only SUCCESSION makes a Boss — never merit (see succeedBoss).
    { key: "boss",     pip: "Boss",     tier: 6, needBody: 0, needContrib: 0,   cut: 5.0,  hp: 260, weapon: "SMG", locked: true },
  ];
  const RANK_BY_KEY = {}; RANKS.forEach((r, i) => { RANK_BY_KEY[r.key] = r; r.idx = i; });

  // ============================================================
  //  FACTIONS (city/factions.js) — THIS table is now the ONE gang ladder.
  //  Before: playergang.js hand-typed the same tier order as a literal string
  //  array THREE times (:631, :727, :744) and careers.js kept a fourth copy as
  //  GC_RANK_TIER. They all read CBZ.factions.ladderKeys("gang") now, so the
  //  order lives in exactly one place — here.
  //
  //  `bind` is why this is a migration and not a second bookkeeping system:
  //  the player's gang membership STAYS in g.cityMembership / g.playerGang,
  //  owned by playergang.js. factions.js reads and writes THAT record; it
  //  never mirrors it.
  // ============================================================
  if (CBZ.factions) {
    CBZ.factions.declare({
      id: "gang",
      name: "Street Set",
      short: "Set",
      kind: "gang",
      color: 0xff4d4d,
      ranks: RANKS,                       // verbatim — no retyping, that is the point
      needScale: { served: 8, orders: 0 },// mirrors eligibleForPromotion's 18+tier*8 seniority
      heat: 1.25,                         // wearing colours makes witnesses louder (police react)
      hostileTo: ["army", "agency"],
      npcTag: { field: "faction", value: "gang" },
      // NO PARALLEL BOOKKEEPING: a member's rank stays where it has always
      // lived, on `ped.rank`. Naming the field is the whole adoption cost of
      // the rank-verb layer (factions.js §RANK IS A VERB).
      rankField: "rank",
      lore: "Street sets own the abandoned blocks. Climb on merit: bodies and cash kicked up.",
      bind: {
        get: function () {
          const m = g.cityMembership;
          if (m && m.gangId) {
            return { org: m.gangId, rank: m.rank, standing: m.standing, how: m.how,
              bodies: m.bodies, contrib: m.contrib, served: m.served, orders: m.orders };
          }
          const pg = g.playerGang;
          if (pg && pg.founded) {
            return { org: pg.id, rank: "boss", owner: true, standing: 1, how: "founded",
              bodies: pg.bodies || 0, contrib: pg.treasury || 0, served: pg.served || 0, orders: pg.orders || 0 };
          }
          return null;
        },
        setRank: function (k) { if (g.cityMembership) g.cityMembership.rank = k; },
        addCredit: function (kind, n) {
          const m = g.cityMembership; if (!m) return;
          const f = kind === "bodies" ? "bodies" : kind === "contrib" ? "contrib" : kind === "served" ? "served" : "orders";
          m[f] = (m[f] || 0) + n;
        },
        addStanding: function (n) {
          const m = g.cityMembership; if (!m) return;
          m.standing = Math.max(-1, Math.min(2, (m.standing || 0) + n));
        },
        leave: function () { if (CBZ.cityLeaveGang) CBZ.cityLeaveGang(); },
      },
    });
    if (CBZ.factionMigrated) {
      CBZ.factionMigrated("ladder:gangs");
      // myGangId() (below) is the only membership QUERY in this file; the two
      // remaining g.playerGang reads (serializeGangs/applyGangsBlob) are this
      // file saving playergang.js's own record, not deriving membership.
      CBZ.factionMigrated("memb:gangs");
    }
  }
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
    lbl.position.y = ped.tag.position.y || (CBZ.charHeadY ? CBZ.charHeadY(ped.char) : 1.97); lbl.scale.copy(ped.tag.scale);
    if (ped.tag.parent) ped.tag.parent.remove(ped.tag);
    ped.char.group.add(lbl); ped.tag = lbl; ped.tag.visible = false;
    ped.tagColor = col;
  }

  // ============================================================
  //  GANG ARCHETYPES — the config gangs each carry a `type`; this table turns
  //  that type into how the faction SPAWNS + FIGHTS so the six crews actually
  //  play differently (instead of six identical pistol mobs). Every knob is
  //  read at spawn / in the director, never per-frame-scanned.
  //
  //    crewMul     multiplier on members-per-turf (config gangPerTurf) — bench size
  //    armedFrac   share of the bench that packs a FIREARM (rest brawl / melee)
  //    rifleFrac   of the ARMED, share that carry a long gun (Carbine) vs SMG/pistol
  //    smgFrac     of the ARMED, share that carry an SMG (the rest = Pistol)
  //    hpMul       member HP multiplier (tanky brawlers vs glass-cannon shooters)
  //    aggrAdd     additive nudge to the aggression roll (brawlers/cartel ride hot)
  //    wealthMul   member wealth multiplier (cartel/syndicate are richer to rob)
  //    melee       a melee weapon brawlers carry instead of a gun ("Machete"/"Bat")
  //    akFrac      of the MADE tiers (Enforcer/Lt), chance to carry the AK-47 — the
  //                crew's visible STATUS rifle. WHY: you SEE the banana mag and know
  //                the block is serious; and because its carrier DROPS it where he
  //                falls, the AK is a reason to pick a fight above your level.
  //    defend      turf-defence weight: how hard the crew retaliates / wars (>1 = harder)
  //    expand      expansion weight: how land-hungry the war/takeover director is
  //    roam        roam/brawl flavour: bikers freelance street crime more
  //    bossWeapon  what the boss is strapped with
  //    label       short archetype tag (HUD/debug + flavour notes)
  // ============================================================
  const GANG_TYPES = {
    street: {    // balanced corner crew — the baseline GTA gang
      label: "Street Gang", crewMul: 1.0, armedFrac: 0.7, rifleFrac: 0.0, smgFrac: 0.3,
      hpMul: 1.0, aggrAdd: 0.0, wealthMul: 1.0, melee: null, akFrac: 0.12,
      defend: 1.0, expand: 1.0, roam: 1.0, bossWeapon: "SMG",
    },
    cartel: {    // rich, rifle-heavy, drug money, land-hungry, hits hard
      label: "Cartel", crewMul: 1.1, armedFrac: 0.95, rifleFrac: 0.55, smgFrac: 0.35,
      hpMul: 1.15, aggrAdd: 0.05, wealthMul: 1.5, melee: null, akFrac: 0.4,
      defend: 1.35, expand: 1.4, roam: 0.85, bossWeapon: "Carbine",
    },
    syndicate: { // few but heavily-armed high earners — protection racket, retaliates hardest
      label: "Syndicate", crewMul: 0.7, armedFrac: 1.0, rifleFrac: 0.25, smgFrac: 0.6,
      hpMul: 1.2, aggrAdd: 0.04, wealthMul: 1.8, melee: null, akFrac: 0.3,
      defend: 1.6, expand: 0.8, roam: 0.7, bossWeapon: "Carbine",
    },
    set: {       // scrappy big bench, lighter weapons — more bodies than guns
      label: "Set", crewMul: 1.45, armedFrac: 0.5, rifleFrac: 0.0, smgFrac: 0.18,
      hpMul: 0.9, aggrAdd: 0.0, wealthMul: 0.8, melee: "Bat", akFrac: 0.08,
      defend: 0.9, expand: 1.05, roam: 1.1, bossWeapon: "SMG",
    },
    brawlers: {  // a melee mob — machetes over guns, tanky, roams + brawls
      label: "Brawlers", crewMul: 1.25, armedFrac: 0.22, rifleFrac: 0.0, smgFrac: 0.1,
      hpMul: 1.4, aggrAdd: 0.08, wealthMul: 0.9, melee: "Machete", akFrac: 0.05,
      defend: 1.1, expand: 1.0, roam: 1.5, bossWeapon: "SMG",
    },
  };
  function gangType(def) { return (def && GANG_TYPES[def.type]) || GANG_TYPES.street; }
  CBZ.cityGangArchetype = function (gangId) {
    const g0 = gangById(gangId); const t = g0 ? gangType(g0) : null;
    return t ? { type: g0.type || "street", label: t.label, defend: t.defend, expand: t.expand } : null;
  };

  // ---- ONE member spawn, shared by the initial roster build AND the slow
  //      recruit tick. rk = rank key ("lt"/"enforcer"/"soldier"/"runner"/
  //      "lookout"); lot = the turf block to post + guard. Loadout / HP /
  //      wealth / aggression / naming are IDENTICAL on both paths — a recruit
  //      is just another body, never a parallel cheaper unit. Returns the ped
  //      (already added to the scene + gang.members + cityPeds) or null.
  // THE SHARED POST (city/occupy.js) — exactly the four lines this file wrote
  // by hand twice (make the ped, parent it, roster it, stamp the post).
  // Degrade-safe: without occupy.js the inline branch is the prior behaviour.
  function gangPost(x, z, o) {
    if (CBZ.cityPostNpc) return CBZ.cityPostNpc(x, z, o);
    if (!CBZ.cityMakePed || !CBZ.cityPeds || !o.parent) return null;
    const p = CBZ.cityMakePed(x, z, o.rng, o);
    if (!p) return null;
    o.parent.add(p.group); CBZ.cityPeds.push(p);
    if (o.homeGuard) p.homeGuard = o.homeGuard;
    return p;
  }

  // WHICH lot is the HQ. It used to be turf[0] unconditionally, which put the
  // boss wherever the round-robin landed — often a single-storey shopfront.
  // A fortress needs FLOORS, so prefer the tallest enterable building on this
  // crew's turf and fall back to turf[0] exactly as before.
  function pickHqLot(gang) {
    const t = gang.turf || [];
    let best = t[0] || null, bestN = -1;
    for (let i = 0; i < t.length; i++) {
      const b = t[i] && t[i].building;
      if (!b || !b.group || b.park) continue;
      const n = (b.storeys | 0);
      if (n > bestN) { bestN = n; best = t[i]; }
    }
    return best;
  }

  function spawnGangMember(gang, lot, rk) {
    if (!gang || !lot) return null;
    const A = CBZ.city && CBZ.city.arena; if (!A) return null;
    const tt = gangType(gang);
    const ag = CBZ.CITY.aggro || {};
    const ang = rng() * 6.28, rad = 2.5 + rng() * 5;
    const x = lot.cx + Math.cos(ang) * rad, z = lot.cz + Math.sin(ang) * rad;
    const rd = rankDef(rk);
    const leader = rd.tier >= 4;   // Lt / Enforcer — the made men of the block
    // ---- ARCHETYPE LOADOUT: who's strapped, and with what (see GANG_TYPES) ----
    let armed, weapon, ammo;
    const packs = leader ? (rng() < 0.9) : (rng() < tt.armedFrac);
    if (packs) {
      const r = rng();
      // THE STATUS RIFLE: a made man has a real chance of the AK-47 — the
      // boss's home lot runs the heaviest detail.
      const akf = (tt.akFrac || 0) * (lot === gang.turf[0] ? 1.6 : 1);
      if (leader && rng() < akf) weapon = "AK-47";
      else if (r < tt.rifleFrac || (leader && rng() < tt.rifleFrac + 0.15)) weapon = "Carbine";
      else if (r < tt.rifleFrac + tt.smgFrac || (leader && rng() < 0.6)) weapon = "SMG";
      else weapon = "Pistol";
      armed = true;
      ammo = weapon === "AK-47" ? 60 + ((rng() * 31) | 0) : weapon === "Carbine" ? 60 : weapon === "SMG" ? 40 : 30;
    } else {
      armed = false; weapon = tt.melee || null; ammo = 0;
    }
    const ped = gangPost(x, z, {
      src: "gangs:crew", rng: rng, parent: A.root,
      kind: "gang", gang: gang.id, faction: gang.id,
      guard: { x: lot.cx, z: lot.cz }, homeGuard: { x: lot.cx, z: lot.cz },
      outfit: gang.color, wealth: Math.min(0.97, (0.3 + rd.tier * 0.08) * tt.wealthMul),
      aggr: clamp(rollGang(ag) + tt.aggrAdd, 0.6, 1),
      archetype: "gangster", job: "gang " + rd.pip.toLowerCase().replace(".", ""),
      armed, weapon,
      hp: Math.round(rd.hp * tt.hpMul),
      name: makeName(gang.ethnicity),
    });
    if (!ped) return null;
    ped.rank = rk;
    ped.ammo = ammo;
    ped.maxHp = Math.round(rd.hp * tt.hpMul);
    const ms = memStats(ped); ms.bodies = (rd.tier) + ((rng() * 2) | 0); ms.contrib = rd.tier * 120 * rng(); ms.served = 30 + rng() * 120;
    tagWithRank(ped, gang.color);   // "<Name> · Lt." etc.
    gang.members.push(ped);
    return ped;
  }

  CBZ.spawnCityGangs = function () {
    const A = CBZ.city && CBZ.city.arena; if (!A) return;
    // GANG_SEEDED: derive this build's stream from the world seed so gang
    // layout/personality varies with ?seed=N; off = the classic literal.
    if (CFG.GANG_SEEDED !== false && CBZ.seedStream) _sStream = CBZ.seedStream("gangs");
    else { _sStream = null; _s = 99173; }
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
      hq: null,        // {x,z,lot,name} — the crew's home block (set at boss spawn)
      standing: 0,     // per-faction PLAYER standing, seeded 0, clamp -100..100
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
    // BACKSTOP (13-gang roster): the round-robin only seats as many crews as
    // there are derelict lots. If a low abandonedFrac roll left fewer lots than
    // gangs, every short crew would hold 0 turf and be INVISIBLE (no center, no
    // spawn, never appears on the takeover map). So pull a lot off whichever crew
    // holds the most and hand it to each empty crew — guarantees every gang in
    // CBZ.CITY.gangs lands ≥1 lot regardless of the abandoned count.
    for (const empty of gangs) {
      if (empty.turf.length) continue;
      let donor = null;
      for (const o of gangs) { if (o !== empty && o.turf.length > 1 && (!donor || o.turf.length > donor.turf.length)) donor = o; }
      if (!donor) break;                          // not enough lots to go around
      const lot = donor.turf.pop();
      empty.turf.push(lot);
      lot.building.gang = empty.id;
      lot.building.gangColor = empty.color;
      if (lot.building.stash) lot.building.stash.gang = empty.id;
    }
    // turf centre + member spawn
    const [lo, hi] = CBZ.CITY.gangPerTurf || [3, 6];
    const ag = CBZ.CITY.aggro || {};
    for (const gang of gangs) {
      if (!gang.turf.length) continue;
      // ---- this crew's ARCHETYPE drives its whole roster (see GANG_TYPES) ----
      const tt = gangType(gang);
      gang.type = gang.type || "street"; gang.archLabel = tt.label;
      // expose the defend/expand weights on the record so the directors can read
      // them without re-looking-up the type table every tick.
      gang.defendW = tt.defend; gang.expandW = tt.expand; gang.roamW = tt.roam;
      let sx = 0, sz = 0;
      for (const l of gang.turf) { sx += l.cx; sz += l.cz; }
      gang.center.x = sx / gang.turf.length; gang.center.z = sz / gang.turf.length;
      gang.peakTurf = gang.turf.length;
      // a cartel/syndicate seeds a fatter war chest (drug money / rackets)
      gang.treasury = Math.round((gang.treasury || 200) * tt.wealthMul);
      // ---- the gang BOSS: a named, tougher, always-armed lieutenant anchoring
      //      the crew's main turf. Defeating one is a real prize + heavy heat. ----
      {
        // THE HQ IS A BUILDING NOW. The owner's ask, verbatim: "gangs own a
        // building and the boss is sitting in an office in an apt on the top
        // floor, with floors of the building filled with security on each
        // floor, then boss top floor with family."
        // city/occupy.js is that capability — one call cuts a real staircase
        // through the tower, programs every floor (checkpoint / quarters /
        // boss suite), posts the garrison up it, puts the boss behind his desk
        // facing the way in with his family around him, and stamps the
        // per-floor access model the trespass alarm reads. Everything below is
        // the GANG-SPECIFIC dressing that a generic occupier cannot know:
        // archetype loadout, the name, the succession identity, the rank pip.
        const blot = pickHqLot(gang);
        const bossHp = Math.round(240 * tt.hpMul);
        let boss = null, occ = null;
        if (CBZ.cityOccupyBuilding && CFG.GANG_HQ_FORTRESS !== false) {
          occ = CBZ.cityOccupyBuilding(blot, {
            id: "gang:" + gang.id, preset: "gang", src: "gangs:hq",
            faction: gang.id, gang: gang.id, outfit: gang.color,
            label: gang.name + " HQ", crime: "trespass",
            // NOTE deliberately NOT passing this file's `rng`: occupy.js
            // derives its own named stream per building, so the ~20 draws a
            // garrison costs can never reflow gang generation downstream of
            // here (the order-fragility rule, CLAUDE.md §Determinism).
            // every body the block casts is a real member of THIS crew
            configure: function (p, info) {
              p.kind = "gang"; p.gang = gang.id; p.faction = gang.id;
              // GARRISON, not street crew. The war director (launchWar) and
              // the roster review (reviewGang) both iterate gang.members and
              // would otherwise commit posted bodies to raids they physically
              // cannot walk to, and promote/defect/clip the boss's children.
              p._occupyGarrison = true;
              if (info.family) {
                p.isFamily = true; p.gangFamily = gang.id;
                p.rank = null;                      // a man's kids are not lieutenants
              } else {
                p.rank = info.vip ? "boss" : (info.floor >= 2 ? "lt" : "soldier");
                p.aggr = clamp((p.aggr || 0.7) + tt.aggrAdd, 0.6, 1);
                p.ammo = p.ammo || 40;
              }
              // family are residents of the HQ, never members of the crew
              if (!info.family) gang.members.push(p);
            },
          });
          if (occ) boss = occ.vip || null;
        }
        if (!boss) {
          // no tower on this turf (a single-storey shopfront, a park stub) —
          // the crew still has a boss, on the street, exactly as before.
          boss = gangPost(blot.cx + 1.5, blot.cz, {
            src: "gangs:hq", rng: rng, parent: A.root,
            kind: "gang", gang: gang.id, faction: gang.id,
            guard: { x: blot.cx, z: blot.cz }, homeGuard: { x: blot.cx, z: blot.cz },
            outfit: gang.color, wealth: Math.min(0.99, 0.96 * tt.wealthMul),
            aggr: clamp(rollGang(ag) + 0.08 + tt.aggrAdd, 0.8, 1),
            archetype: "gangster", job: "gang boss",
            armed: true, weapon: tt.bossWeapon, hp: bossHp,
            name: makeBossName(gang.ethnicity),
          });
          if (boss) gang.members.push(boss);
        }
        if (boss) {
          // the archetype loadout the occupier can't know (cartel boss = rifle)
          boss.name = boss.name || makeBossName(gang.ethnicity);
          boss.wealth = Math.min(0.99, 0.96 * tt.wealthMul);
          boss.aggr = clamp(rollGang(ag) + 0.08 + tt.aggrAdd, 0.8, 1);
          boss.armed = true; boss.weapon = tt.bossWeapon;
          boss.hp = bossHp; boss.maxHp = bossHp; boss.ammo = 50;
          boss.isBoss = true; boss.rank = "boss";
          boss.gang = gang.id; boss.faction = gang.id; boss.kind = "gang";
          const bs = memStats(boss); bs.loyalty = 1; bs.bodies = 12 + ((rng() * 8) | 0); bs.joined = "founder";
          gang.boss = boss; gang.bossName = boss.name;
          tagWithRank(boss, gang.color);   // "<Name> '<Nick>' <Last> · Boss"
          registerBossIdentity(gang, boss);   // cityIdentities plug-in (feature-detected; see above)
        }
        // the gang's HQ anchors on the boss's home lot — a real map target for
        // waypoints / rival-HQ hunts. boss.pos overrides this while he's alive.
        // floorY is new: the HQ finally knows which STOREY the boss is on, which
        // is what every "go get him" caller was missing (census §2).
        gang.hq = {
          x: blot.cx, z: blot.cz, lot: blot, name: gang.name + " HQ",
          floorY: (boss && boss._occupyY) || 0,
          floor: (boss && boss._occupyFloor) || 0,
          fortified: !!occ, stairs: !!(occ && occ.core),
        };
        // (rosterCap is computed from STREET members only, further down — the
        // garrison is deliberately excluded there rather than compensated for
        // here, which the later `gang.rosterCap = ...` would have overwritten.)
      }
      // recolour this turf's graffiti hint (stash glow) toward the gang colour
      for (const lot of gang.turf) {
        // the buildings cluster stamps lot.building.owner on every building — if
        // it's there, claim this derelict for the gang (guard: owner may not exist).
        if (lot.building && lot.building.owner) { lot.building.owner.id = gang.id; lot.building.owner.type = "gang"; }
        if (!lot.demolished && lot.building.stash && lot.building.stash.mesh && lot.building.stash.mesh.material && lot.building.stash.mesh.material.emissive) {
          try { lot.building.stash.mesh.material.emissive.setHex(gang.color); } catch (e) {}
        }
        // bench size scales with the archetype: a SET / BRAWLER mob is deeper,
        // a SYNDICATE holds the same block with a handful of heavy earners.
        const baseN = lo + ((rng() * (hi - lo + 1)) | 0);
        const n = Math.max(1, Math.round(baseN * tt.crewMul));
        for (let k = 0; k < n; k++) {
          // a REAL pyramid under the boss: the first holder of each lot is a
          // LIEUTENANT, then an Enforcer, then the bench fills Soldier/Runner/
          // Lookout — a believable spread of veterans + low men who'll climb on
          // merit over the run. Each gets a REAL First-Last name; rank lives on
          // ped.rank + shows as a tag pip. spawnGangMember owns the loadout.
          const rk = k === 0 ? "lt" : k === 1 ? "enforcer" : (k <= 3 ? "soldier" : (rng() < 0.5 ? "runner" : "lookout"));
          spawnGangMember(gang, lot, rk);
        }
      }
      // ---- FINITE + WIPEABLE roster model (owner's vision): the bodies we just
      //      fielded are this crew's natural STRENGTH CEILING (rosterCap). A small
      //      finite RESERVE (recruitPool) is the ONLY extra bodies it can EVER put
      //      on the street — slow trickle-back so a held block feels alive, but the
      //      total is bounded, so a determined push out-kills the recruiting and
      //      when recruitPool hits 0 the crew can NEVER grow again. Drain the pool
      //      AND clear the street and the gang is permanently WIPED. The recruit
      //      cadence rides a little faster for land-hungry (expandW) archetypes.
      // STREET roster only. The HQ garrison (city/occupy.js) is real bodies in
      // gang.members — they fight, they die, they count for headcount — but
      // they are POSTED, not the crew that walks the block, so folding them
      // into the finite ceiling would roughly double every gang's cap and its
      // recruiting pool, quietly gutting the "FINITE + WIPEABLE" doctrine.
      let street = 0;
      for (let m = 0; m < gang.members.length; m++) if (!gang.members[m]._occupyGarrison) street++;
      gang.rosterCap = street;
      gang.recruitPool = Math.round(gang.rosterCap * 0.6);
      gang.recruitInterval = 25 / (gang.expandW || 1);
      gang.recruitT = gang.recruitInterval;
      gang.lastDownT = 0;   // counts up since the player last dropped one of theirs
      CBZ.cityGangs.push(gang);
    }
    // GANG_PERSIST: a fresh spawn is the default per-seed layout — if the
    // ledger carries a saved takeover state for THIS world, the next upkeep
    // tick fast-forwards the board to it (see the PERSISTENCE block below).
    _pNeedApply = true;
  };

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function rollGang(ag) { const r = (rng() + rng()) / 2; return (ag.meanGang != null ? ag.meanGang : 0.8) + (r - 0.5) * 2 * (ag.spreadGang || 0.14); }

  function gangById(id) { return CBZ.cityGangs.find((x) => x.id === id); }

  // ============================================================
  //  PERMANENT-IDENTITY REGISTRY PLUG-IN (city/identity.js, feature-detected,
  //  load order NOT guaranteed). gangs.js already runs the real, working
  //  succession mechanic end-to-end (gang.bossDead / succeedBoss below) —
  //  this does NOT replace any of that. It only ALSO mints/retires a
  //  CBZ.cityIdentities record per crowned boss so racing/vips/companies and
  //  this file share ONE uniform history/leaderboard view ("every named boss
  //  this city has ever had, alive or dead, who succeeded whom"). Mirrors the
  //  exact stamp-id-on-the-individual pattern racing.js/vips.js/millionaires.js
  //  use: boss._identityId names the live record; peds.js's central death
  //  chain (a separate task) can call markDead via that id too — both paths
  //  are idempotent (identity.js no-ops a second markDead on the same id). ----
  // mint (or reuse, if this exact boss ped already holds one — e.g. a
  // re-tag pass that doesn't actually replace the body) an identity for the
  // CURRENT boss of a gang, and stamp it onto the ped.
  function registerBossIdentity(gang, boss) {
    const R = CBZ.cityIdentities;
    if (!R || !R.register || !boss) return;
    if (boss._identityId) { const ex = R.get(boss._identityId); if (ex && ex.status === "alive") return; }
    const rec = R.register("gangBoss", boss.name || gang.bossName || "Boss", { gangId: gang.id, gangName: gang.name, archetype: gang.type || "street" });
    boss._identityId = rec.id;
  }
  // retire the identity for a boss who just went down — idempotent against
  // both this direct call AND identity.js's own onDeathRegister dispatch (in
  // case peds.js's death hook also reaches markDead via the same _identityId).
  function retireBossIdentity(ped, killedBy) {
    const R = CBZ.cityIdentities;
    if (!R || !R.markDead || !ped || !ped._identityId) return null;
    const before = R.get(ped._identityId);
    if (!before || before.status === "dead") return before || null;     // already processed
    return R.markDead(ped._identityId, { killedBy: killedBy || null });
  }
  // identity.js's death-reaction hook for kind 'gangBoss': purely a uniform
  // history/leaderboard read — the REAL succession (heir pick, rename, gear,
  // morale hit) already happened in succeedBoss() below by the time this
  // fires (or is about to, on the same tick); this never drives policy, only
  // logs it. Feature-detected so an older identity.js (or none loaded) is fine.
  if (CBZ.cityIdentities && CBZ.cityIdentities.onDeathRegister) {
    CBZ.cityIdentities.onDeathRegister("gangBoss", function (rec) { /* leaderboard.js reads cityIdentities.byKind('gangBoss') directly; nothing else to do here */ });
  }

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
    // making rank into the MADE tiers (Enforcer+) can come with the crew's STATUS
    // rifle — the AK-47 is what a promotion looks like from across the street.
    if (rd.tier >= 4 && m.weapon !== "AK-47" && rng() < (gangType(gang).akFrac || 0.1)) m.weapon = "AK-47";
    m.ammo = Math.max(m.ammo || 0, m.weapon === "AK-47" ? 70 : rd.weapon === "SMG" ? 50 : 30);
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
      CBZ.city && CBZ.city.note("" + (m.name || "A soldier") + " defected from " + fromGang.name + " to " + toGang.name + ".", 2.4);
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
    // SUCCESSION IS A RUNG, not a two-name string list. RANKS grants "succeed"
    // at Enforcer, so this asks the ladder instead of restating it — and it
    // keeps working if the ladder ever changes shape. Degrade-safe fallback to
    // the exact pair it used to test.
    const pm = g.cityMembership;
    if (pm && pm.gangId === gang.id) {
      const heirApparent = (CBZ.rankKnows && CBZ.rankKnows("gang", "succeed"))
        ? CBZ.rankCan(null, "gang", "succeed")
        : (pm.rank === "lt" || pm.rank === "enforcer");
      if (heirApparent) return;
    }
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
    const prevIdentityId = gang.boss && gang.boss._identityId; // gang.boss may already be null (dead-and-spliced)
    heir.rank = "boss"; heir.isBoss = true; gang.boss = heir; gang.bossName = heir.name;
    heir.name = heir.name && heir.name.indexOf("'") < 0 ? makeBossName(gang.ethnicity) : heir.name;
    applyRankGear(heir, gang); tagWithRank(heir, gang.color);
    gang.bossDead = false; gang.leaderless = false;
    // cityIdentities plug-in: mint the heir's own identity + log the handover
    // onto the dead boss's record (lineage queryable via R.get(id).successorId).
    registerBossIdentity(gang, heir);
    if (prevIdentityId && CBZ.cityIdentities && CBZ.cityIdentities.setSuccessor) {
      CBZ.cityIdentities.setSuccessor(prevIdentityId, heir._identityId || null);
    }
    // a weak handover fractures morale — everyone wobbles, some will walk
    const moraleHit = wasStrong ? 0.05 : 0.22;
    for (const m of live) disciplineHit(gang, m, moraleHit);
    if (nearPlayer(gang.center.x, gang.center.z, 160)) {
      CBZ.city && CBZ.city.note("" + heir.name + " seized control of " + gang.name + (wasStrong ? "." : " — the crew's shaky."), 3);
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
      // the HQ garrison (city/occupy.js) is POSTED, not on the promotion
      // ladder — it must not be promoted out of its post, poached by a rival,
      // or clipped by the discipline pass while it holds a floor.
      if (m._occupyGarrison) continue;
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
    if (a.playerOwned) return 0;   // P7: a player-owned militia defends turf but never launches wars on its own
    opts = opts || {};
    const targetLot = opts.lot || b.turf[(rng() * b.turf.length) | 0];
    // BIGGER set-piece battles: a flush treasury / hot war buys a deeper push.
    // GTA SA scales wave size with how heavily a hood is defended; here the
    // attacker's WAR CHEST and current intensity decide how many it commits.
    const warMul = 1 + Math.min(1.6, (a.warIntensity || 0) * 0.5 + (a.treasury || 0) / 2000);
    // BIGGER pushes: more aggressive / expansionist crews commit a deeper squad.
    const base = (opts.assault ? 5 : 3) + ((a.expandW || 1) > 1.2 ? 1 : 0);
    const count = Math.min(10, Math.round((base + ((rng() * 3) | 0)) * warMul));
    let sent = 0;
    // spend the chest to field the squad — a poor gang can't mount a big raid.
    // Cheaper per body so wars erupt more readily without bankrupting the economy.
    const cost = count * 32;
    if (!opts.free && (a.treasury || 0) < cost * 0.5) return 0;
    a.treasury = Math.max(0, (a.treasury || 0) - cost);
    // the push AXIS: our block -> theirs. The squad arrives as a FRONT facing the
    // defenders down that street (shooters arced off the lot, melee straight in)
    // instead of a single converging dot that scrums on the stash.
    let axx = targetLot.cx - a.center.x, axz = targetLot.cz - a.center.z;
    const axl = Math.hypot(axx, axz) || 1; axx /= axl; axz /= axl;
    const tnx = -axz, tnz = axx;
    let lane = 0, callLead = null;
    for (const m of a.members) {
      if (sent >= count) break;
      if (m.dead || m.rage || m.inCar || m.raidT > 0) continue;
      // the HQ garrison HOLDS THE HOUSE — it never rolls out on a raid. It
      // physically can't (posted bodies don't walk), so committing one would
      // silently field half a squad and leave the raid short.
      if (m._occupyGarrison) continue;
      // WAR FOOTING: the chest the raid already spent cracks the heavy crates —
      // a made man (Enforcer/Lt) rolls on a rival block with the AK-47, so a war
      // VISIBLY escalates the hardware on the street, and every raider you drop
      // is a chance to walk away with the status rifle yourself.
      if (rankTier(m) >= 4 && m.weapon !== "AK-47" && rng() < (gangType(a).akFrac || 0.1) * 1.5) {
        m.armed = true; m.weapon = "AK-47"; m.ammo = Math.max(m.ammo || 0, 60 + ((rng() * 31) | 0));
        if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(m);
      }
      m.homeGuard = m.homeGuard || m.guard;
      // (1) ROLES AT FORMATION — who you are in the squad is what you carry.
      // The guard point IS the role: peds.js holds a gangster near his guard
      // and rages him at rivals around it, so an arc of guard points becomes
      // a real firing line with zero per-frame shepherding from this file.
      const hasGun = !!(m.armed && (m.ammo == null || m.ammo > 0));
      let gx, gz;
      if (hasGun) {
        // shooters fan to a LOOSE FIRING ARC 8-14u off the lot, spread sideways
        // along the front so the raid reads as a line, not a pile
        const back = 8 + rng() * 6, side = ((lane % 5) - 2) * 3.1 + (rng() - 0.5) * 1.4; lane++;
        gx = targetLot.cx - axx * back + tnx * side; gz = targetLot.cz - axz * back + tnz * side;
        m._wRole = "arc";
      } else {
        // melee presses straight in (the war-shape pass pairs them on a mark)
        gx = targetLot.cx + (rng() - 0.5) * 4; gz = targetLot.cz + (rng() - 0.5) * 4;
        m._wRole = "press";
      }
      m._wT = 20 + rng() * 6; m._wHadGun = hasGun;
      m.guard = { x: gx, z: gz };
      m.target.set(gx, 0, gz);
      m.pause = 0; m.path = null; m.raidT = 22 + rng() * 14; m.raidGang = b.id;
      m.raidLot = targetLot;
      if (!callLead || rankTier(m) > rankTier(callLead)) callLead = m;
      sent++;
    }
    if (sent) {
      // the highest rank on the push CALLS it — a bark, then he holds the
      // centre-back of his own arc instead of leading the charge.
      if (callLead) {
        callLead._wRole = "call";
        const cbx = targetLot.cx - axx * 17, cbz = targetLot.cz - axz * 17;
        callLead.guard = { x: cbx, z: cbz }; callLead.target.set(cbx, 0, cbz);
        wbark(a, callLead, BARK_CALL);
      }
      a.warWith = b.id; b.warWith = a.id;
      a.warRemain = b.warRemain = 26 + rng() * 14;
      a.warIntensity = Math.min(3, (a.warIntensity || 0) + 1);
      b.warIntensity = Math.min(3, (b.warIntensity || 0) + 0.6);
      a._raidTarget = targetLot;   // contested lot, used for capture resolution
      // GANG_WAR_EVENTS: arm this war's visible set-pieces (a second attacker
      // wave; the defender's lieutenant stand + car reinforcements). Never on
      // a free push (a second wave must not arm its own second wave), and the
      // player's crew never gets auto-defended — defense is the PLAYER's call.
      if (CFG.GANG_WAR_EVENTS !== false && !opts.free) {
        if (!a._wev) a._wev = { t: 6 + rng() * 6, lot: targetLot, foe: b.id };
        if (!b.isPlayer && !b._wevDef) b._wevDef = { t: 4 + rng() * 4, done: 0, lot: targetLot, foe: a.id };
      }
      const big = sent >= 5;
      CBZ.city && CBZ.city.note((big ? "TURF WAR: " : "Gang war: ") + a.name + " hit " + b.name + " turf (" + sent + ").", big ? 3 : 2.4);
      // a war push rolls a drive-by car into the rival block — common on a heavy
      // assault, a real chance on any raid (capped in spawnDriveby so it's safe).
      if ((big && rng() < 0.8) || (!big && rng() < 0.35)) spawnDriveby(a, { x: targetLot.cx, z: targetLot.cz }, b);
      // raiding YOUR block? rally your gang to defend it
      if (b.isPlayer && CBZ.cityPlayerGangDefendTurf) {
        CBZ.cityPlayerGangDefendTurf(targetLot.cx, targetLot.cz);
        CBZ.city && CBZ.city.big("" + a.name + " RAIDING YOUR TURF");
        if (CBZ.sfx) CBZ.sfx("siren");
      }
    } else {
      a.treasury += cost;   // refund — nobody was free to go
    }
    return sent;
  }
  CBZ.cityStartGangWar = launchWar;

  // ============================================================
  //  WAR ESCALATION EVENTS (flag GANG_WAR_EVENTS) — the rival-war director's
  //  visible SET-PIECES on contested turf, built ONLY from plumbing this file
  //  already runs: spawnDriveby cars ("arriving by car"), guard/raidT squad
  //  movement (the same fields launchWar/sendReprisal write), and the
  //  applyRankGear/tagWithRank named-ped mechanisms. Each war arms at most
  //  one attacker wave + one defender ladder (launchWar above), the timers
  //  live on the gang records, and everything clears with the war itself.
  // ============================================================
  const BARK_DEFEND = ["Hold the block!", "They ain't taking this corner!", "Stand your ground!", "Push 'em back off our street!"];
  const BARK_TAKEN = ["Block's ours now!", "New colours on this corner!", "That's how you take a street!"];

  // the defender's champion steps up: the top-ranked survivor is healed, hard
  // to drop, strapped with the status rifle (the same war-footing crate crack
  // launchWar uses) and re-tagged — a tougher NAMED ped anchoring the lot.
  function stageLtDefense(gang, lot) {
    let best = null;
    for (const m of gang.members) {
      if (!m || m.dead || m.ko > 0 || m.inCar || m === gang.boss || m.rank === "boss") continue;
      if (!best || rankTier(m) > rankTier(best)) best = m;
    }
    if (!best) return;
    // one-shot toughness latch — repeat wars re-heal the champion but never
    // compound the buff (no accidental 2000hp tank after ten skirmishes)
    if (!best._champion) { best._champion = true; best.maxHp = Math.round((best.maxHp || 140) * 1.3); }
    best.hp = best.maxHp;
    if (best.weapon !== "AK-47") {
      best.armed = true; best.weapon = "AK-47"; best.ammo = Math.max(best.ammo || 0, 90);
      if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(best);
    }
    tagWithRank(best, gang.color);
    best.homeGuard = best.homeGuard || best.guard;
    best.guard = { x: lot.cx + (rng() - 0.5) * 3, z: lot.cz + (rng() - 0.5) * 3 };
    if (best.target) best.target.set(best.guard.x, 0, best.guard.z);
    best.pause = 0; best.path = null;
    if (!(best.raidT > 0)) best.raidT = 24 + rng() * 8;
    wbark(gang, best, BARK_DEFEND);
    if (nearPlayer(lot.cx, lot.cz, 130)) {
      CBZ.city && CBZ.city.note("" + (best.name || "A veteran") + " is holding the " + gang.name + " block.", 2.4);
    }
  }

  // defender reinforcements ARRIVE BY CAR: a gang car rolls onto the contested
  // block spraying the attackers (the existing drive-by path is the arrival),
  // while up to three bodies posted on OTHER blocks converge to hold this one.
  function stageReinforcements(gang, lot, foe) {
    const rolled = spawnDriveby(gang, { x: lot.cx, z: lot.cz }, foe || null);
    let sent = 0;
    for (const m of gang.members) {
      if (sent >= 3) break;
      if (!m || m.dead || m.ko > 0 || m.inCar || m.companion || m.raidT > 0 || m.rage) continue;
      if (m === gang.boss || m.rank === "boss") continue;
      const dx = m.pos.x - lot.cx, dz = m.pos.z - lot.cz;
      if (dx * dx + dz * dz < 14 * 14) continue;          // already on the block
      m.homeGuard = m.homeGuard || m.guard;
      m.guard = { x: lot.cx + (rng() - 0.5) * 6, z: lot.cz + (rng() - 0.5) * 6 };
      m.target.set(m.guard.x, 0, m.guard.z);
      m.pause = 0; m.path = null; m.raidT = 18 + rng() * 8;
      sent++;
    }
    if ((rolled || sent) && nearPlayer(lot.cx, lot.cz, 150)) {
      CBZ.city && CBZ.city.note("" + gang.name + " reinforcements rolling in.", 2.2);
    }
  }

  // the attacker commits a SECOND WAVE — a free launchWar re-runs the whole
  // arc/press/call formation machinery against the same contested lot.
  function stageSecondWave(a, lot, b) {
    if (!a || !b || b.isPlayer || !(a.warRemain > 0)) return;
    if (b.turf.indexOf(lot) < 0) return;                  // already flipped / moved on
    const sent = launchWar(a, b, { lot, free: true });
    if (sent && nearPlayer(lot.cx, lot.cz, 160)) {
      CBZ.city && CBZ.city.note("" + a.name + " commits a second wave (" + sent + ").", 2.4);
    }
  }

  // advance one gang's armed set-pieces (called from the upkeep tick while its
  // war runs; both records are cleared when the war ends or the lot flips).
  function tickWarEvents(gang, dt) {
    const dv = gang._wevDef;
    if (dv) {
      if (!(gang.warRemain > 0) || gang.turf.indexOf(dv.lot) < 0) gang._wevDef = null;
      else {
        dv.t -= dt;
        if (dv.t <= 0) {
          if (dv.done === 0) { dv.done = 1; dv.t = 7 + rng() * 6; stageLtDefense(gang, dv.lot); }
          else { gang._wevDef = null; stageReinforcements(gang, dv.lot, gangById(dv.foe)); }
        }
      }
    }
    const av = gang._wev;
    if (av) {
      if (!(gang.warRemain > 0) || !gang.warWith) gang._wev = null;
      else {
        av.t -= dt;
        if (av.t <= 0) { gang._wev = null; stageSecondWave(gang, av.lot, gangById(av.foe)); }
      }
    }
  }

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
    if (!lot.demolished && lot.building.stash && lot.building.stash.mesh && lot.building.stash.mesh.material && lot.building.stash.mesh.material.emissive) {
      try { lot.building.stash.mesh.material.emissive.setHex(winner.color); } catch (e) {}
    }
    // re-home any winner members who raided here so they hold the new ground
    for (const m of winner.members) {
      if (m.raidLot === lot && !m.dead) { m.homeGuard = { x: lot.cx, z: lot.cz }; m.guard = { x: lot.cx, z: lot.cz }; m.raidT = 0; m.raidGang = null; m.raidLot = null; clearWarRole(m); }
    }
    recenter(winner); recenter(loser);
    loser.lostTurfT = 8;
    // the flip settles this war's set-pieces over the lot
    if (winner._wev && winner._wev.lot === lot) winner._wev = null;
    if (loser._wevDef && loser._wevDef.lot === lot) loser._wevDef = null;
    // GANG_WAR_EVENTS: post-battle AFTERMATH the street can read — the fight
    // scorches the pavement (existing buildings.js decal) and the takers talk.
    if (CFG.GANG_WAR_EVENTS !== false) {
      if (CBZ.cityScorch) { try { CBZ.cityScorch(lot.cx + (rng() - 0.5) * 4, lot.cz + (rng() - 0.5) * 4, 1.6 + rng() * 1.2); } catch (e) {} }
      let crier = null, cd = 20 * 20;
      for (const m of winner.members) {
        if (!m || m.dead || m.ko > 0) continue;
        const dx = m.pos.x - lot.cx, dz = m.pos.z - lot.cz, dd = dx * dx + dz * dz;
        if (dd < cd) { cd = dd; crier = m; }
      }
      if (crier) wbark(winner, crier, BARK_TAKEN);
    }
    if (nearPlayer(lot.cx, lot.cz, 90)) {
      CBZ.city && CBZ.city.note("" + winner.name + " seized a block from " + loser.name + ".", 2.6);
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

  // is the player riding with / courting a crew this victim's gang is hostile to?
  // A SANCTIONED kill = a body that satisfies an active player-gang task: the
  // victim belongs to a rival of the gang the player is patched into or runs.
  // Allies + your own crew never count. playergang.creditPlayerKill computes the
  // same signal for its task ladder; this mirror lets the kill REWARD gate on it.
  // ONE canonical read: CBZ.cityPlayerGangId() (playergang.js) — the old
  // g.playerGangAffiliation orphan is gone (turf.js's defect path now writes
  // the canonical membership fields instead).
  // MIGRATED to the ONE faction query (city/factions.js). The old three-field
  // re-derivation stays as the degrade-safe fallback per the BLOCK LAW.
  function myGangId() {
    if (CBZ.factions && CBZ.factions.orgIn) { const o = CBZ.factions.orgIn("gang"); if (o) return o; }
    if (CBZ.cityPlayerGangId) return CBZ.cityPlayerGangId();
    const m = g.cityMembership;
    return (m && m.gangId) || g.playerGangId || null;
  }
  function killSanctioned(victimGangId) {
    if (!victimGangId || victimGangId === "player") return false;
    const myGang = myGangId();
    if (!myGang) return false;
    if (victimGangId === myGang) return false;                          // never your own crew
    if (CBZ.cityAreAllied && CBZ.cityAreAllied(myGang, victimGangId)) return false;
    return true;   // a rival of the crew you ride with = a sanctioned body
  }

  // ============================================================
  //  DRIVE-BY SHOOTINGS — a gang car rolls a target and the crew hangs out
  //  the window strafing tracers (GTA III introduced this; we model the
  //  classic "any SMG → lean and spray" pass). Pooled + capped.
  //
  //  WHAT THIS USED TO BE, and exactly why the owner could not shoot it
  //  ("its a car that cant be shot by the player and doesnt follow physics"):
  //  the drive-by car was a PRIVATE record in `drivebys[]` carrying its own
  //  THREE.Group parented straight onto the arena root. It was never in
  //  CBZ.cityCars — so BY CONSTRUCTION, not by accident, fpsmode's findCarHit
  //  (which scans exactly that list) could not see it, CBZ.cityDamageCar could
  //  never be called on it, resolveCars never separated it from real traffic,
  //  cityNearestCar never offered "Get in", and no explosion in this game knew
  //  it existed. It moved by hand-integrating db.x/db.z and then writing
  //  `grp.position.set(db.x, 0, db.z)` — a LITERAL y = 0, which is precisely
  //  the "driving on green water" fault seatCar was written to end. And its
  //  `crew: 1 + rng()*2` was, in its own comment, "flavour": the man leaning
  //  out of the window did not exist, so nothing could kill him, and killing
  //  the car killed nobody.
  //
  //  IT IS A CAR NOW, and it authors almost none of that itself. cityMakeCar
  //  BUILDS AND REGISTERS it (makeCar's push into CBZ.cityCars IS the
  //  registration), so bullets, explosions, the CAR_COOKOFF_V2 smoke→fire→
  //  cook-off arc, car-vs-car separation, crumple and theft all pick it up
  //  with no code here. `road:null` + `ai:true` is the shipped carjack /
  //  gig-car contract: vehicles.js's traffic AI skips a car with no road AND
  //  still parkSeat()s it, so ride height, terrain pitch and terrain roll come
  //  free and we only STEER (giglife.js's proven npcDriver loop). The crew are
  //  REAL gang members posted through the same gangPost() the block soldiers
  //  use and seated through the shared npcLife.attach anchor grammar, so they
  //  live in CBZ.cityPeds: findActorHit sees them (CHAR_SEATED_HITTABLE), they
  //  die through cityKillPed → the killfeed, and EVERY SEAT HAS A CONSEQUENCE
  //  — kill the shooter and the gun stops, kill the driver and the car coasts
  //  to a halt and is yours to take. The BEHAVIOUR (approach → roll the target
  //  → spray → flee) is unchanged; only the thing carrying it is real.
  //
  //  DRIVEBY_REAL=false restores the rail car below — its mesh and its movement
  //  are kept verbatim; both paths now fire through the one shot helper.
  // ============================================================
  if (CFG.DRIVEBY_REAL == null) CFG.DRIVEBY_REAL = true;
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
    // THE FIX: a hit/drive-by car used to be a crude placeholder box (the user's
    // "fake-as-fuck car comes when a hit is sent"). Build the SAME real detailed
    // visual every other city car uses, painted in the gang's colour, via the
    // shared vehicles.js pipeline (parity, not new cost — all traffic uses it).
    if (CBZ.cityBuildGangCarVisual) {
      const real = CBZ.cityBuildGangCarVisual(color);
      if (real) return real;
    }
    // last-resort box rig — only reached when the visual system isn't loaded
    // (headless / gallery). A low-slung two-tone sedan silhouette (gang paint
    // over a near-black greenhouse) so drive-bys still read as gang iron there.
    const grp = new THREE.Group();
    const paint = new THREE.MeshLambertMaterial({ color: color, emissive: color, emissiveIntensity: 0.12 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x14171c });
    const body = new THREE.Mesh(dbCarGeo(), paint);
    body.position.y = 0.62; grp.add(body);                        // slammed: sills ride the wheels
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.64, 0.6, 2.0), dark);
    cabin.position.set(0, 1.3, -0.25); grp.add(cabin);            // greenhouse set back = sedan profile
    const bmpG = new THREE.BoxGeometry(2.06, 0.22, 0.3);
    const bf = new THREE.Mesh(bmpG, dark); bf.position.set(0, 0.4, 2.12); grp.add(bf);
    const br = new THREE.Mesh(bmpG, dark); br.position.set(0, 0.4, -2.12); grp.add(br);
    const sp = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 0.3), dark);
    sp.position.set(0, 1.14, -2.0); grp.add(sp);                  // trunk-lip spoiler
    const wm = new THREE.MeshLambertMaterial({ color: 0x0a0a0c });
    for (const wx of [-0.95, 0.95]) for (const wz of [1.35, -1.35]) {
      const w = new THREE.Mesh(_dbWheelGeo, wm); w.position.set(wx, 0.42, wz); grp.add(w);
    }
    grp._cabinMat = paint;   // same gang-tint handle as before (now the body paint)
    return grp;
  }

  // ---- THE REAL CAR PATH ---------------------------------------------------
  // Everything below authors only what is genuinely NEW about a drive-by: who
  // is in the car, where it goes, and when the gun speaks. The car itself, its
  // damage model, its terrain suspension, its collisions, its theft and its
  // people all come from systems this game already runs.
  function drivebyRealOk() {
    return CFG.DRIVEBY_REAL !== false && !!CBZ.cityMakeCar && !!CBZ.cityMakePed &&
      !!(CBZ.npcLife && CBZ.npcLife.attach);
  }

  // Seat anchors in the CAR GROUP'S LOCAL frame (+Z forward, +X right — the
  // convention every car in vehicles.js rides on). The numbers are giglife.js's
  // proven live-rig-in-a-live-car seat, not a fresh guess; the shooter is the
  // only one moved, pushed out to the door line and turned to the window so he
  // reads as LEANING OUT of it. npclife's syncAttached re-asserts pitch/yaw/roll
  // every frame, so the lean survives the 41 files that write group.rotation.y.
  const DB_SEATS = {
    driver:  { x: -0.42, y: 0.55, z: 0.38,  yaw: 0,    roll: 0,     pose: "sit", state: "sit" },
    shotgun: { x: 0.44,  y: 0.55, z: 0.36,  yaw: 0.75, roll: -0.13, pose: "sit", state: "sit" },
    rear:    { x: 0.52,  y: 0.56, z: -0.34, yaw: 1.0,  roll: -0.2,  pose: "sit", state: "sit" },
  };

  // vehicles.js draws PROXY occupant boxes in any car whose ai/npcDriver flags
  // say somebody is driving (addOccupants → syncOccupants @38). This car has
  // REAL people in those seats, so the proxies come out or the shooter sits
  // inside a cardboard passenger. The geometry is a shared per-variant cache
  // (OCC_GEOS): unparent it, never dispose it. Nulling _occDriver is also what
  // makes syncOccupants early-return, so it can never put them back.
  function dropProxyOccupants(car) {
    const keys = ["_occDriver", "_occPass"];
    for (let i = 0; i < keys.length; i++) {
      const m = car[keys[i]];
      if (m && m.parent) m.parent.remove(m);
      car[keys[i]] = null;
    }
  }

  // pull a car we own back out of the world (same shape as giglife's return and
  // the chop-shop sale): scene, geometry, and the cityCars ledger.
  function dbRemoveCar(car) {
    if (!car) return;
    if (car.group && car.group.parent) car.group.parent.remove(car.group);
    if (car.group) car.group.traverse(function (o) {
      if (o.isSprite) return;
      if (o.geometry && !o.geometry._shared && o.geometry.dispose) { try { o.geometry.dispose(); } catch (e) {} }
      if (o.material) {
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => { if (x && !x._shared && x.dispose) x.dispose(); });
        else if (!m._shared && m.dispose) { try { m.dispose(); } catch (e) {} }
      }
    });
    const cars = CBZ.cityCars; if (cars) { const k = cars.indexOf(car); if (k >= 0) cars.splice(k, 1); }
    car.dead = true; car.ai = false; car.npcDriver = null;
  }

  // ONE crew body. It is not a drive-by actor: it is a gang member, cast by the
  // same gangPost() the block soldiers use, rostered on the gang, tagged with a
  // rank, and then SEATED. Nothing here invents a person, a rig or a death path.
  function spawnDbCrew(gang, car, seatKey, role) {
    const A = CBZ.city && CBZ.city.arena; if (!A) return null;
    const tt = gangType(gang);
    const ag = CBZ.CITY.aggro || {};
    const rk = role === "driver" ? "runner" : "soldier";
    const rd = rankDef(rk);
    // A DRIVE-BY CREW IS STRAPPED — that is the whole point of the trip — but
    // WITH WHAT still comes off this crew's own archetype table, so a brawler
    // set does not roll up carrying the syndicate's rifles.
    const r = rng();
    const weapon = role === "driver" ? "Pistol"
      : (r < (tt.akFrac || 0) * 2.2) ? "AK-47"
      : (r < (tt.rifleFrac || 0) + (tt.smgFrac || 0) + 0.45) ? "SMG" : "Pistol";
    const ped = gangPost(car.pos.x, car.pos.z, {
      src: "gangs:driveby", rng: rng, parent: A.root,
      kind: "gang", gang: gang.id, faction: gang.id,
      outfit: gang.color, wealth: Math.min(0.9, 0.3 + rd.tier * 0.08),
      aggr: clamp(rollGang(ag) + tt.aggrAdd, 0.6, 1),
      archetype: "gangster", job: "gang " + rd.pip.toLowerCase().replace(".", ""),
      armed: true, weapon: weapon, controlled: true,
      hp: Math.round(rd.hp * tt.hpMul),
      name: makeName(gang.ethnicity),
      // The never-spawn-in-view gate is honoured at the CAR (spawnRealDriveby
      // searches six bearings for an off-screen approach), and this body is not
      // placed in the world at all — it goes straight into a seat inside that
      // car. Letting peds.js hide it independently would produce the worse lie:
      // an EMPTY gang car rolling up. npcLife.attach still honours _spawnHidden
      // for anything that does arrive hidden.
      allowVisibleSpawn: true,
    });
    if (!ped) return null;
    ped.rank = rk;
    ped.ammo = weapon === "AK-47" ? 90 : weapon === "SMG" ? 60 : 34;
    ped.maxHp = Math.round(rd.hp * tt.hpMul);
    const ms = memStats(ped); ms.bodies = rd.tier; ms.served = 20 + rng() * 60;
    tagWithRank(ped, gang.color);
    gang.members.push(ped);
    ped.inCar = car;            // findActorHit's seated-occupant path reads this
    ped.controlled = true;      // peds.js: we own the body while it rides
    ped._dbRole = role;
    if (!CBZ.npcLife.attach(ped, car.group, DB_SEATS[seatKey] || DB_SEATS.rear)) {
      if (ped.group) ped.group.visible = false;   // no seat: ride hidden, still hittable via inCar
    }
    return ped;
  }

  function spawnRealDriveby(gang, aim, victimGang) {
    const A = CBZ.city && CBZ.city.arena; if (!A || !A.root) return null;
    const tx = aim.x, tz = aim.z;
    // Approach from a road edge a comfortable distance out. ONE angle and ONE
    // radius are drawn — the same two draws the rail car made — and then six
    // FIXED rotations of that angle are tried, so we can honour the
    // never-let-the-player-see-a-spawn law without spending a single extra draw
    // on the shared seeded stream. A whole CAR arriving in frame is the loudest
    // version of that bug there is.
    const ang = rng() * 6.28, R = 34 + rng() * 10;
    let open = null, unseen = null;
    for (let k = 0; k < 6 && !unseen; k++) {
      const a2 = ang + k * 1.0472;
      const p = { x: tx + Math.cos(a2) * R, z: tz + Math.sin(a2) * R };
      if (A.clampToCity) A.clampToCity(p, 2);
      // roadPointOpen is roadrules.js's ONE "may a vehicle be here" query: it
      // refuses open water AND every declared keep-out (the airfield, the
      // military apron, a bunker shell) in a single call. The old rail car was
      // invisible to that law because it was never in cityCars; a REAL car is
      // counted by roadTrafficAudit's `trespassing` ratchet, which is pinned at
      // zero, so the law now binds us exactly as it binds ambient traffic.
      if (CBZ.roadPointOpen && !CBZ.roadPointOpen(p.x, p.z)) continue;
      if (!open) open = p;
      if (!CBZ.npcTransitionSafe || CBZ.npcTransitionSafe(p.x, p.z, { minDistance: 20, maxDistance: 220 })) unseen = p;
    }
    const spot = unseen || open;
    if (!spot) return null;      // no legal approach exists — then there is no drive-by
    const sx = spot.x, sz = spot.z;
    const heading = Math.atan2(tx - sx, tz - sz) || 0;
    // A real catalog car, painted this crew's colour (the shallow-clone trick
    // cityBuildGangCarVisual already uses, so the catalog entry is untouched).
    const econ = CBZ.cityEcon;
    let model = econ && econ.pickCar ? econ.pickCar(rng() < 0.12) : null;
    model = Object.assign({}, model || {}, { color: gang.color || 0xb079ea });
    const car = CBZ.cityMakeCar(sx, sz, heading, false, model, 0.9);
    if (!car) return null;
    car.road = null;              // vehicles.js's traffic AI skips a car with no road...
    car.ai = true;                // ...but still parkSeats it, so the terrain ride is free
    car.stolen = false; car.owned = false; car.reckless = true;
    car.baseV = 15; car.v = 6;
    car._driveby = true;
    dropProxyOccupants(car);
    const driver = spawnDbCrew(gang, car, "driver", "driver");
    if (!driver) { dbRemoveCar(car); return null; }
    car.npcDriver = driver;       // cook-off bail-out + run-over attribution, free
    const crew = [driver];
    const shooter = spawnDbCrew(gang, car, "rear", "shooter");
    if (shooter) crew.push(shooter);
    if (rng() < 0.45) { const s2 = spawnDbCrew(gang, car, "shotgun", "shooter"); if (s2) crew.push(s2); }
    return {
      real: true, car: car, crew: crew, driver: driver,
      gang: gang, victimGang: victimGang || null,
      aimX: tx, aimZ: tz, passes: 0, maxPasses: 1 + ((rng() * 2) | 0),
      shootCD: 0, life: 16 + rng() * 6, state: "approach",
    };
  }

  function spawnDriveby(gang, aim, victimGang) {
    if (activeDrivebys >= MAX_DRIVEBYS() || g.mode !== "city") return false;
    const A = CBZ.city && CBZ.city.arena; if (!A || !A.root) return false;
    let db = null;
    if (drivebyRealOk()) {
      // A real drive-by that CANNOT be staged — no legal approach, no car, no
      // crew — is simply a drive-by that does not happen. It must never quietly
      // fall through to the rail car: that path exists for the flag and for a
      // boot without the car/ped factories, not as a silent understudy.
      try { db = spawnRealDriveby(gang, aim, victimGang); } catch (e) { db = null; }
      if (!db) return false;
    }
    if (!db) {
      // ---- LEGACY RAIL CAR (DRIVEBY_REAL=false, or the car/ped factories are
      //      absent — headless gallery boots). Unchanged, byte-for-byte. ----
      const tx = aim.x, tz = aim.z;
      const ang = rng() * 6.28, R = 34 + rng() * 10;
      let sx = tx + Math.cos(ang) * R, sz = tz + Math.sin(ang) * R;
      if (A.clampToCity) { const p = { x: sx, z: sz }; A.clampToCity(p, 2); sx = p.x; sz = p.z; }
      const grp = buildDbCar(gang.color || 0xb079ea);
      grp.position.set(sx, 0, sz); A.root.add(grp);
      db = {
        grp, gang, victimGang: victimGang || null,
        x: sx, z: sz, heading: 0, v: 0,
        aimX: tx, aimZ: tz, passes: 0, maxPasses: 1 + ((rng() * 2) | 0),
        shootCD: 0, life: 16 + rng() * 6, state: "approach",
        crew: 1 + ((rng() * 2) | 0),   // bodies that bail if it's wrecked (flavour)
      };
    }
    drivebys.push(db); activeDrivebys++;
    if (nearPlayer(dbAtX(db), dbAtZ(db), 70)) {
      CBZ.city && CBZ.city.note("" + gang.name + " rolling up...", 1.6);
      // no engine sample in the bank; the first drive-by burst (shoot_smg) is the
      // real audio cue, so we don't fake a roll-up with an unrelated "whoosh".
    }
    return true;
  }
  CBZ.cityGangDriveby = spawnDriveby;

  // where the record IS, whichever kind it is (the real one lives on its car).
  function dbAtX(db) { return db.real ? db.car.pos.x : db.x; }
  function dbAtZ(db) { return db.real ? db.car.pos.z : db.z; }

  // A BODY LEAVES A SEAT ONLY BY DETACHING (island_airport.js CBZ.cityUnseat):
  // syncAttached re-asserts the seat transform every frame, so nudging a rider
  // out is not possible and never was. Alive → put them on the pavement beside
  // the car and hand them back to the gang brain; dead → the corpse detaches at
  // its true world pose and drops where it was sitting.
  function dbUnseatCrew(db, p) {
    if (!p) return;
    p.inCar = null;
    const car = db.car;
    let dx = null, dz = null;
    if (!p.dead && car && car.pos) {
      const h = car.heading || 0, side = (p._dbRole === "driver") ? -1 : 1;
      dx = car.pos.x + Math.cos(h) * 1.8 * side;
      dz = car.pos.z - Math.sin(h) * 1.8 * side;
    }
    if (p._npcAttached) {
      const o = { state: p.dead ? "dead" : "walk" };
      if (dx != null) { o.x = dx; o.z = dz; o.ground = true; }
      if (CBZ.cityUnseat) { try { CBZ.cityUnseat(p, o); } catch (e) {} }
      else if (CBZ.npcLife && CBZ.npcLife.detach) { try { CBZ.npcLife.detach(p, o); } catch (e) {} }
    } else if (dx != null && p.pos && p.pos.set) {
      // never got a seat (npcLife refused): they rode hidden at the pick-up
      // point, so put them down beside the car rather than leaving a body
      // standing where the car used to be.
      p.pos.set(dx, p.pos.y || 0, dz);
    }
    if (p.dead) return;
    p.controlled = false;
    if (p.group) p.group.visible = !p._spawnHidden;
    // hand them back to the crew brain: they walk home to the block they came
    // from instead of standing in the road where the car stopped.
    if (db.gang && db.gang.center) {
      p.guard = { x: db.gang.center.x, z: db.gang.center.z };
      p.homeGuard = p.homeGuard || p.guard;
      if (p.target && p.target.set) p.target.set(p.guard.x, 0, p.guard.z);
    }
  }

  // the crew leaves WITH the car when the whole thing is pulled out of the
  // world off-screen (the matching half of the shared post).
  function dbUnpostCrew(db, p) {
    if (!p) return;
    p.inCar = null; p.controlled = false;
    if (db.gang && db.gang.members) { const i = db.gang.members.indexOf(p); if (i >= 0) db.gang.members.splice(i, 1); }
    if (CBZ.cityUnpostNpc) { try { CBZ.cityUnpostNpc(p); return; } catch (e) {} }
    try {
      if (p._npcAttached && CBZ.npcLife && CBZ.npcLife.detach) CBZ.npcLife.detach(p, { state: "walk" });
      if (p.group && p.group.parent) p.group.parent.remove(p.group);
      if (CBZ.cityPeds) { const i = CBZ.cityPeds.indexOf(p); if (i >= 0) CBZ.cityPeds.splice(i, 1); }
    } catch (e) {}
  }

  function despawnDriveby(db, idx) {
    if (db.real) {
      const car = db.car;
      const cam = CBZ.camera && CBZ.camera.position;
      const far = !car || !cam ||
        ((car.pos.x - cam.x) * (car.pos.x - cam.x) + (car.pos.z - cam.z) * (car.pos.z - cam.z)) > 170 * 170;
      // THE EVENT ENDS; THE CAR IS A CAR. We only pull it out of the world when
      // nobody could watch that happen, nobody died in it and nobody stole it —
      // a car that pops out of existence in view is the same lie as one that
      // pops into it. Otherwise it stays exactly what it now is: an abandoned,
      // drivable, damageable, stealable gang car parked where it stopped.
      const anyDead = db.crew.some(function (p) { return p && p.dead; });
      const drop = far && !anyDead && car && !car.player && !car.dead && !car._onFire && !car._smoking;
      for (let k = 0; k < db.crew.length; k++) {
        if (drop) dbUnpostCrew(db, db.crew[k]); else dbUnseatCrew(db, db.crew[k]);
      }
      if (drop) dbRemoveCar(car);
      // NEVER YANK A CAR OUT FROM UNDER THE PLAYER — if they boosted it mid-pass
      // it is simply their car now, at their speed, and we touch nothing.
      else if (car && !car.dead && !car.player) { car.ai = false; car.npcDriver = null; car.abandoned = true; car.reckless = false; car.v = 0; }
      db.crew.length = 0; db.driver = null;
    } else {
      if (db.grp && db.grp.parent) db.grp.parent.remove(db.grp);
      if (db.grp) db.grp.traverse(function (o) {
        if (o.geometry && !o.geometry._shared && o.geometry.dispose) o.geometry.dispose();
        if (o.material && !o.material._shared && o.material.dispose) o.material.dispose();
      });
    }
    drivebys.splice(idx, 1); activeDrivebys = Math.max(0, activeDrivebys - 1);
  }

  // pick who the gun in the car points at: the player if they're the cause,
  // else the nearest rival gangster near the aim point.
  function drivebyVictim(db) {
    const P = CBZ.player, PA = playerActor();
    const cx = dbAtX(db), cz = dbAtZ(db);
    // hunting the player (reprisal) — only if reasonably close to the route
    if (db.huntPlayer && PA && P && !P.dead) {
      const dx = P.pos.x - cx, dz = P.pos.z - cz;
      if (dx * dx + dz * dz < 24 * 24) return PA;
    }
    // otherwise spray a rival gangster
    let best = null, bd = 22 * 22;
    for (const p of CBZ.cityPeds) {
      if (p.dead || !p.gang || p.gang === db.gang.id) continue;
      if (db.victimGang && p.gang !== db.victimGang.id) continue;
      if (db.real && db.crew.indexOf(p) >= 0) continue;    // never your own car
      const dx = p.pos.x - cx, dz = p.pos.z - cz, dd = dx * dx + dz * dz;
      if (dd < bd) { bd = dd; best = p; }
    }
    return best;
  }

  // a drive-by car USED TO move on rails — `clampToCity` kept it inside the
  // arena bounds but it phased straight THROUGH buildings (the owner-filmed
  // "fake car drives thru walls" on a hit). Route it through the SAME oriented
  // wall resolver every other city car uses (vehicles.js cityCollideVehicle —
  // box depenetration + a forward probe so the nose doesn't bury in a facade).
  // It mutates car.pos in place; we adapt the rail car's x/z onto a reused
  // Vector3 so there's zero per-frame alloc. vehicles.js is LOCKED — we only
  // CALL its exported resolver, never edit it.
  const _dbCarPos = new THREE.Vector3();
  const _dbCar = { pos: _dbCarPos, heading: 0, v: 0, _visualDims: { width: 2.0, length: 4.2 } };
  function collideDrivebyCar(db) {
    if (!CBZ.cityCollideVehicle) return;   // headless / vehicles.js absent → bounds-only (clampToCity still runs)
    _dbCarPos.set(db.x, db.y || 0, db.z);
    _dbCar.heading = db.heading; _dbCar.v = db.v;
    CBZ.cityCollideVehicle(_dbCar);        // pushes _dbCarPos out of any wall it overlaps
    // if a wall shoved it, bleed speed so it doesn't keep grinding the facade
    const moved = Math.hypot(_dbCarPos.x - db.x, _dbCarPos.z - db.z);
    db.x = _dbCarPos.x; db.z = _dbCarPos.z;
    if (moved > 0.05) db.v *= 0.6;
  }

  // ONE ROUND OUT OF THE CAR, shared by both paths so the drive-by can never
  // disagree with itself about damage. It is the SAME contract police.js fires
  // on — CBZ.tracer + clearLineOfFire + gunVoice + cityHurtPlayer/cityKillPed —
  // and never a bespoke bullet. `shooter` is the real gangster when there is
  // one, which is what puts HIS name in the killfeed instead of the crew's.
  function dbFire(db, v, from, shooter) {
    const ty = (v.pos.y || 0) + (v.isPlayer ? 1.55 : 1.3);   // victim's TRUE chest height
    // a drive-by round needs a real line of fire too: a car on the street
    // can't spray a target up on a roof or behind a building through the wall.
    if (CBZ.clearLineOfFire && !CBZ.clearLineOfFire(from.x, from.y, from.z, v.pos.x, ty, v.pos.z)) return false;
    const weapon = (shooter && shooter.weapon) || "SMG";
    if (CBZ.tracer) CBZ.tracer(from, { x: v.pos.x, y: ty, z: v.pos.z }, { muzzleScale: 0.9 });
    // a drive-by two blocks over reads as distant ambience, not in-ear
    if (CBZ.gunVoice) CBZ.gunVoice(weapon, CBZ.player ? Math.hypot(from.x - CBZ.player.pos.x, from.z - CBZ.player.pos.z) : 0);
    else if (CBZ.sfx) CBZ.sfx("shoot_smg");
    if (shooter && shooter.ammo > 0) shooter.ammo--;          // a magazine is finite; a long pass runs dry
    const dd = Math.hypot(v.pos.x - from.x, v.pos.z - from.z, ty - from.y);   // true 3D gap
    if (rng() >= Math.max(0.18, 0.62 - dd * 0.02)) return true;
    const dmg = (weapon === "AK-47" ? 14 : 10) + rng() * 9;
    if (v.isPlayer) {
      if (CBZ.cityHurtPlayer) CBZ.cityHurtPlayer(dmg, from.x, from.z, "killed in a drive-by", false, shooter || db.gang.name, false);
    } else {
      v.hp -= dmg; v.alarmed = Math.max(v.alarmed || 0, 6);
      if (v.hp <= 0) { if (CBZ.cityKillPed) CBZ.cityKillPed(v, { fromX: from.x, fromZ: from.z, byPlayer: false, force: 5, fling: 4 }, "drive-by"); }
      else if (CBZ.body && CBZ.body.hit) CBZ.body.hit(v, { fromX: from.x, fromZ: from.z, force: 1.5 });
    }
    return true;
  }

  // ---- THE REAL CAR'S DRIVE LOOP -------------------------------------------
  // Mirrors giglife.js's npcDriver steering (the proven road:null pattern):
  // lerp the heading toward the goal, throttle, run the SHARED wall resolver,
  // clamp to the arena. We deliberately do NOT write car.group.position —
  // vehicles.js's parkSeat() does that at order 37, and that one call is what
  // buys the ride height, terrain pitch and terrain roll every other car in the
  // game rides on. Writing y ourselves is how the old rail car ended up at 0.
  function dbAdvance(car, dt) {
    const ox = car.pos.x, oz = car.pos.z;
    car.pos.x += Math.sin(car.heading) * car.v * dt;
    car.pos.z += Math.cos(car.heading) * car.v * dt;
    if (CBZ.cityCollideVehicle) CBZ.cityCollideVehicle(car);   // the same oriented wall resolver
    const A = CBZ.city && CBZ.city.arena;
    if (A && A.clampToCity) A.clampToCity(car.pos, 1.4);
    // A KEEP-OUT IS REAL TO THIS CAR TOO. A drive-by beelines at a lot or at the
    // player, which is exactly the manoeuvre that would carry a car onto the
    // airfield — and now that it is a REAL car, roadTrafficAudit counts it. The
    // step is REFUSED, not clamped: we came from a legal point (the spawn search
    // guarantees the first one), so reverting always lands somewhere legal, and
    // the heading kick makes the driver nose off the fence instead of grinding it.
    if (CBZ.roadPointOpen && !CBZ.roadPointOpen(car.pos.x, car.pos.z)) {
      car.pos.x = ox; car.pos.z = oz;
      car.heading += 1.1; car.v *= 0.5;
    }
    // it is two tonnes doing 15 m/s: it hits what it hits. cityVehicleRunOver is
    // the exported half of the player drive loop (the same call a boat makes to
    // run down a swimmer) — never a second run-over rule.
    if (car.v > 6 && CBZ.cityVehicleRunOver) { try { CBZ.cityVehicleRunOver(car, car.v); } catch (e) {} }
    const cam = CBZ.camera && CBZ.camera.position;
    if (cam && car.group) {
      const vx = car.pos.x - cam.x, vz = car.pos.z - cam.z;
      car.group.visible = (vx * vx + vz * vz) < 150 * 150;     // vehicles.js's own 150 m budget
    }
  }
  function dbSteer(car, tx, tz, top, dt) {
    const dx = tx - car.pos.x, dz = tz - car.pos.z;
    const want = Math.atan2(dx, dz);
    if (CBZ.lerpAngle) car.heading = CBZ.lerpAngle(car.heading, want, 1 - Math.pow(0.0009, dt));
    else {
      let dh = want - car.heading;
      while (dh > Math.PI) dh -= 6.283185; while (dh < -Math.PI) dh += 6.283185;
      car.heading += dh * Math.min(1, dt * 2.4);
    }
    car.v += Math.max(-24 * dt, Math.min(14 * dt, top - car.v));
    if (car.v < 0) car.v = 0;
    dbAdvance(car, dt);
    return Math.hypot(dx, dz);
  }

  // KILL THE SHOOTER AND THE GUN STOPS. The driver keeps both hands on the
  // wheel — a car whose gunmen are down is a car leaving, not a car shooting.
  function dbShooter(db) {
    for (let i = 0; i < db.crew.length; i++) {
      const p = db.crew[i];
      if (p && !p.dead && !(p.ko > 0) && p._dbRole === "shooter" && p.ammo > 0) return p;
    }
    return null;
  }

  function stepRealDriveby(db, dt, idx) {
    const car = db.car;
    // the car left our hands — burnt out, reaped, or the player took the wheel.
    // The EVENT ends; the car (or its wreck) stays in the world as itself.
    if (!car || car.dead || car._reap || car.player || !car.group || !car.group.parent) { despawnDriveby(db, idx); return; }
    // vehicles.js bailed the driver out of a burning car (igniteCar's cook-off
    // eject → cityScare). A seat is only left by DETACHING, so finish that
    // properly through despawn and let the panic brain own him from here.
    if (db.driver && !db.driver.dead && car.npcDriver !== db.driver) { despawnDriveby(db, idx); return; }

    // ---- EVERY SEAT HAS A CONSEQUENCE ----
    if (db.driver && db.driver.dead) {
      // SHOT AT THE WHEEL: the car careens off the throttle and coasts to a
      // stop. What is left in the street is a real gang car with real bodies in
      // it — evidence, loot, and a ride.
      car.npcDriver = null; car.abandoned = true;
      car.v *= Math.pow(0.10, dt);
      dbAdvance(car, dt);
      if (car.v < 0.5) despawnDriveby(db, idx);
      return;
    }

    db.life -= dt; db.shootCD -= dt;
    if (db.life <= 0 && db.state !== "flee") { db.state = "flee"; db.fleeX = null; }

    if (db.state === "flee") {
      if (db.fleeX == null) {
        db.fleeX = car.pos.x + Math.sin(car.heading) * 180;
        db.fleeZ = car.pos.z + Math.cos(car.heading) * 180;
      }
      dbSteer(car, db.fleeX, db.fleeZ, 20, dt);
      const P = CBZ.player;
      const away = (!P || !P.pos) ? 999 : Math.hypot(car.pos.x - P.pos.x, car.pos.z - P.pos.z);
      if (away > 140 || db.life < -16) despawnDriveby(db, idx);
      return;
    }

    const dist = dbSteer(car, db.aimX, db.aimZ, db.state === "strafe" ? 12 : 15, dt);

    // close pass → it's "alongside", start spraying; then it loops for another pass
    if (dist < 16) {
      db.state = "strafe";
      if (db.shootCD <= 0) {
        const sh = dbShooter(db);
        const v = sh ? drivebyVictim(db) : null;
        if (v && !v.dead) {
          db.shootCD = (sh.weapon === "Pistol" ? 0.34 : 0.22) + rng() * 0.18;
          // THE ROUND LEAVES THE MAN, not the car. His rig's world position was
          // synced by npclife at order 33.8 — this frame, before us — so we push
          // out past the door line along the car's right and fire from there.
          const h = car.heading, rx = Math.cos(h), rz = -Math.sin(h);
          const sp = sh.pos || car.pos;
          const from = { x: sp.x + rx * 0.45, y: (sp.y || 0) + 0.5, z: sp.z + rz * 0.45 };
          dbFire(db, v, from, sh);
        }
      }
      // PASSED IT. The old rail car only counted a pass inside a 3.5 m ring,
      // which a car doing 12 m/s can step straight over on a slow frame and then
      // circle forever. Track the closest approach: once the gap is opening
      // again, the pass is made.
      db.minDist = db.minDist == null ? dist : Math.min(db.minDist, dist);
      if (dist < 3.5 || dist > db.minDist + 5) {
        db.passes++; db.minDist = null;
        if (db.passes > db.maxPasses) { db.state = "flee"; db.fleeX = null; return; }
        const a2 = rng() * 6.28, r2 = 26 + rng() * 8;
        db.aimX += Math.cos(a2) * r2; db.aimZ += Math.sin(a2) * r2;
        const A = CBZ.city && CBZ.city.arena;
        if (A && A.clampToCity) { const p = { x: db.aimX, z: db.aimZ }; A.clampToCity(p, 2); db.aimX = p.x; db.aimZ = p.z; }
        db.state = "approach";
      }
    }
  }

  function updateDrivebys(dt) {
    for (let i = drivebys.length - 1; i >= 0; i--) {
      const db = drivebys[i];
      if (db.real) { stepRealDriveby(db, dt, i); continue; }
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
      // BUILDING collision first (stop at walls), then the arena bounds clamp.
      collideDrivebyCar(db);
      if (A && A.clampToCity) { const p = { x: db.x, z: db.z }; A.clampToCity(p, 1.6); db.x = p.x; db.z = p.z; }
      db.grp.position.set(db.x, 0, db.z); db.grp.rotation.y = db.heading;
      // close pass → it's "alongside", start spraying; then it loops for another pass
      if (dist < 16) {
        db.state = "strafe";
        if (db.shootCD <= 0) {
          const v = drivebyVictim(db);
          if (v && !v.dead) {
            db.shootCD = 0.22 + rng() * 0.18;
            // the rail car has no man in it, so the muzzle is still a point off
            // the car's right flank. dbFire owns everything past that.
            const from = { x: db.x + Math.cos(db.heading) * 1.0, y: 1.3, z: db.z - Math.sin(db.heading) * 1.0 };
            dbFire(db, v, from, null);
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

  // ---- per-faction PLAYER STANDING (-100..100). Friendly acts raise it,
  //      clipping their crew (off the books) drops it. The HUD reads this. ----
  CBZ.cityGangStanding = function (gangId) { const gang = gangById(gangId); return gang ? (gang.standing || 0) : 0; };
  CBZ.cityGangAddStanding = function (gangId, amt) {
    const gang = gangById(gangId); if (!gang || !amt) return 0;
    gang.standing = clamp((gang.standing || 0) + amt, -100, 100);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return gang.standing;
  };

  // ---- MARK A HIT: drop a waypoint on a target ped (playergang's put-in-work
  //      contract calls this). No-op until the full map's waypoint API exists. ----
  CBZ.cityMarkTarget = function (ped) {
    if (ped && ped.pos && CBZ.fullMap && CBZ.fullMap.setWaypoint) {
      CBZ.fullMap.setWaypoint(ped.pos.x, ped.pos.z, "HIT: " + (ped.name || "target"));
    }
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
    if (on) {
      gang.provoke = 0; gang.hostility = 0; gang.strikeT = 9e9;
      // riding with a crew is a standing windfall (nudge toward allied)
      CBZ.cityGangAddStanding(id, 30);
    } else gang.strikeT = 0;
  };

  // ---- THE SET ONLY AVENGES WHAT IT KNOWS ----------------------------------
  // A body only comes back on you if the crew FINDS OUT. Drop a member with a
  // brother of his close enough to see it and that witness RUNS for the set's
  // block — when he gets there (or enough time passes that word travels), the
  // whole set goes hunting. Put the runner down before he reports and the hit
  // stays clean. Your OWN crew is different: no set-wide vendetta — the ones
  // who LOVED the dead man weigh their loyalty against your respect, and only
  // those who come up loyal ride on you. Bury them all and the set falls in line.
  const snitches = [];                       // gang witnesses running to report
  const avengers = { list: [], victim: null }; // own-crew loyalists out for you
  function nearestGangWitness(gang, victim) {
    let best = null, bd = 30 * 30;
    for (const m of gang.members) {
      if (m === victim || !m || m.dead || m.ko > 0) continue;
      const dx = m.pos.x - victim.pos.x, dz = m.pos.z - victim.pos.z, d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = m; }
    }
    return best;
  }
  function setVendetta(gang) {
    const dW = gang.defendW || 1;
    gang.hostility = Math.min(5, Math.max(gang.hostility || 0, 3 * dW)); // the WHOLE set hunts
    gang.provoke = 1;
    gang.strikeT = 0;                                                    // first squad rolls NOW
    if (CBZ.cityFlavor) CBZ.cityFlavor("Word reached the " + gang.name + ". The whole set is out for you.", "#ff7a7a");
  }
  function startSnitchRun(gang, w, victim) {
    w._snitchT = 20 + Math.random() * 18;    // word travels even if he hides
    w._snitchGangId = gang.id;
    w.rage = null; w.state = "flee";
    w.alarmed = Math.max(w.alarmed || 0, 9);
    if (gang.hq && w.target && w.target.set) { w.target.set(gang.hq.x, 0, gang.hq.z); w.finalGoal = null; }
    snitches.push(w);
    if (CBZ.cityFlavor) CBZ.cityFlavor("" + (w.name || "One of theirs") + " saw it — he's running to tell the " + gang.name + ".", "#ffce7a");
  }
  function loyaltyBattle(gang, victim) {
    const PA = playerActor(); if (!PA) return;
    // how much love the dead man had: rank carries weight, then each member's
    // own loyalty stat + a personal roll, stared down by YOUR respect.
    const rankW = (victim === gang.boss || victim.isBoss || victim.rank === "boss") ? 0.45
      : (victim.rank === "lt" || victim.rank === "enforcer") ? 0.25 : 0.05;
    const sway = Math.min(1, ((g.respect || 0) / 140));
    let turned = 0;
    for (const m of gang.members) {
      if (m === victim || !m || m.dead || m.ko > 0) continue;
      const love = (CBZ.cityMemberLoyalty ? CBZ.cityMemberLoyalty(m) : 0.5) + rankW + Math.random() * 0.25;
      if (love > 0.72 + sway * 0.45) {
        m.rage = PA; m.state = "fight"; m.alarmed = Math.max(m.alarmed || 0, 8);
        m._avenges = victim.name || "him";
        avengers.list.push(m); turned++;
      }
    }
    avengers.victim = victim.name || "him";
    if (CBZ.cityFlavor) {
      if (turned) CBZ.cityFlavor("" + turned + " of the crew ride for " + (victim.name || "him") + ". Loyalty against respect — settle it.", "#ffce7a");
      else CBZ.cityFlavor("The crew looks away. " + (victim.name || "He") + " didn't have the love.", "#9aa6bd");
    }
  }
  CBZ.cityVendettaReset = function () { snitches.length = 0; avengers.list.length = 0; avengers.victim = null; };
  CBZ.onUpdate(34.6, function (dt) {
    if (g.mode !== "city") return;
    for (let i = snitches.length - 1; i >= 0; i--) {
      const w = snitches[i];
      if (!w || w._snitchGangId == null) { snitches.splice(i, 1); continue; }
      if (w.dead || w.ko > 0) {
        snitches.splice(i, 1); w._snitchGangId = null;
        if (CBZ.cityFlavor) CBZ.cityFlavor("The witness never made it. The street stays quiet.", "#9aa6bd");
        continue;
      }
      const sg = gangById(w._snitchGangId);
      if (!sg) { snitches.splice(i, 1); continue; }
      w._snitchT -= dt;
      const nearHQ = sg.hq && Math.hypot(w.pos.x - sg.hq.x, w.pos.z - sg.hq.z) < 10;
      if (w._snitchT <= 0 || nearHQ) {
        snitches.splice(i, 1); w._snitchGangId = null;
        setVendetta(sg);
      }
    }
    // the loyalty battle settles when the last avenger drops
    if (avengers.list.length) {
      let live = 0;
      for (const m of avengers.list) if (m && !m.dead) live++;
      if (!live) {
        const who = avengers.victim || "him";
        avengers.list.length = 0; avengers.victim = null;
        if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(6);
        if (CBZ.cityFlavor) CBZ.cityFlavor("You buried everyone who rode for " + who + ". The set falls in line.", "#7fe0a0");
      }
    }
  });

  // a member went down — the crew takes it personally. ESCALATION LADDER:
  // each kill the player racks up against a crew raises HOSTILITY, which the
  // reprisal director reads to send hunter squads + drive-bys after the player.
  CBZ.cityGangMemberDown = function (ped, imp) {
    const gang = gangById(ped.gang); if (!gang) return;
    const byPlayer = !imp || imp.byPlayer !== false;
    gang.provoke = Math.min(1, gang.provoke + (byPlayer ? 0.5 : 0.25));
    // RECENT-DEATH timer: while the player is actively massacring this crew, the
    // recruit tick stays shut off — a sustained push out-kills the trickle-back.
    if (byPlayer) gang.lastDownT = 6;
    const wasBoss = (ped.isBoss || ped.rank === "boss" || ped === gang.boss);
    // losing a brother shakes the surviving crew — a real morale/loyalty hit,
    // sharper if it was the boss. This is what makes a hammered gang fracture.
    const moraleHit = wasBoss ? 0.18 : 0.05;
    for (const m of gang.members) { if (m !== ped && !m.dead) disciplineHit(gang, m, moraleHit); }
    if (byPlayer) {
      // WITNESS-GATED grudge: the set only hunts you if one of theirs saw it
      // (and lives long enough to report). Your OWN crew runs the loyalty
      // battle instead. STANDING always sinks — kin is kin, the books know.
      const own = gang.isPlayer || gang.playerFriendly || gang.id === myGangId();
      const w = nearestGangWitness(gang, ped);
      if (own) {
        if (wasBoss) { /* killing your own boss = the takeover path below owns it */ }
        else if (w) loyaltyBattle(gang, ped);
        else if (CBZ.cityFlavor) CBZ.cityFlavor("Nobody from the set saw " + (ped.name || "him") + " drop.", "#9aa6bd");
      } else if (w) {
        startSnitchRun(gang, w, ped);
      } else if (CBZ.cityFeed) {
        CBZ.cityFlavor && CBZ.cityFlavor("No one who'd talk saw it. Clean.", "#9aa6bd");
      }
      CBZ.cityGangAddStanding(ped.gang, -8);
      // REWARD only a SANCTIONED kill (a rival of the crew you ride with — the
      // same task signal playergang.creditPlayerKill scores). A random member
      // dropped off the books earns NO respect, just the grudge + standing hit.
      if (killSanctioned(ped.gang)) CBZ.city && CBZ.city.addRespect(3);
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
    const ri = gang.members.indexOf(ped); if (ri >= 0 && ped.dead) gang.members.splice(ri, 1);   // drop the corpse from the live roster (kill feed already captured it)
    // BOSS down → succession (NPC) or a player takeover prize. Flag it either way
    // so the upkeep tick promotes the heir for rival-on-rival kingpin kills too.
    if (wasBoss && !gang.isPlayer) {
      gang.bossDead = true;
      // cityIdentities plug-in: retire HIS record now (idempotent — succeedBoss's
      // own setSuccessor call later reads this same id off gang.boss, which is
      // still wired to the dead ped until the upkeep tick runs succession).
      retireBossIdentity(ped, (imp && imp.attacker && imp.attacker.name) || (byPlayer ? "player" : null));
      if (byPlayer) {
        // the takeover prize hook always fires (succession/player-takeover);
        // the big respect bump only lands on a SANCTIONED kingpin hit.
        if (CBZ.cityPlayerGangBossKilled) CBZ.cityPlayerGangBossKilled(gang);
        if (killSanctioned(ped.gang)) CBZ.city && CBZ.city.addRespect(20);
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
      CBZ.city && CBZ.city.big("" + gang.name + " sent a hit squad after you");
    }
    return sent;
  }

  // ============================================================
  //  DOOR-AWARE ATTACK ROUTING — the owner-filmed "gang walks/drives THRU a
  //  building when it comes for me" bug. A gang attacker's chase (peds.js fight
  //  state) BEELINES at the target's live position; building walls are real
  //  colliders so the body can't actually phase — but a raw beeline GRINDS the
  //  facade forever when the target ducks inside. Cops already solve this
  //  (police.js routes a blind chaser to the building's DOOR). Gangs route
  //  through peds.js's universal brain, which has no such detour — so we add it
  //  HERE, director-side, the same way war-shape already steers fields the brain
  //  honors (guard/state/target/path). When a raging attacker is walled out of a
  //  target inside a building, we WALK them to that building's door (a real,
  //  auto-opening opening — buildings.js drops the leaf collider on proximity)
  //  and resume the chase once they're at the door or can see the target again.
  //  cityNav.routeTo already threads the door as the final legs (citynav.js), so
  //  one routeTo lays "streets → door → step inside". Composes with the breach-
  //  glass path: an attacker standing on a shootable window keeps shooting
  //  through it (peds.js _breachedT), and only walks to the door when the
  //  obstruction is solid (no glass on the lane). Bounded: only ATTACKERS
  //  (rage + hunt/raid), each throttled by m._gDoorCD, never a full-roster scan.
  // ============================================================
  const _gDoorPath = [];   // reused out array for routeTo (per-call, one at a time)
  // the live position of whoever this attacker is hunting. While a door detour
  // is in flight we deliberately CLEAR m.rage (so peds.js walks the path instead
  // of beelining the wall), so fall back to the remembered victim during it.
  function attackerTargetPos(m) {
    let R = m.rage;
    if ((!R || R.dead) && m._gDoorGoal) {
      R = m._gWasPlayer ? playerActor() : m._gWasVictim;   // detour in flight: use the remembered mark
    }
    if (!R || R.dead) return null;
    return R.pos || null;
  }
  // true if a clear shot exists from the attacker's chest to the target's chest
  function attackerHasLOS(m, tx, ty, tz) {
    if (!CBZ.clearLineOfFire) return true;   // no LOS module → assume open (today's behaviour)
    return CBZ.clearLineOfFire(m.pos.x, (m.pos.y || 0) + 1.4, m.pos.z, tx, ty, tz);
  }
  // route ONE attacker to the door of the building its target stands in, if it's
  // walled out. Returns true if it took/holds the door detour this tick.
  function routeAttackerToDoor(m, dt) {
    const NAV = CBZ.cityNav;
    if (!NAV || !NAV.indoorLotAt || !NAV.doorFor) return false;
    const tp = attackerTargetPos(m);
    if (!tp) { m._gDoorGoal = null; return false; }
    // a member shooting THROUGH a freshly-broken window this beat prefers the
    // glass lane — don't fight the breach push with a door detour (combat.js
    // stamps _breachedT > 0 when it opens a pane on the firing lane).
    if ((m._breachedT || 0) > 0) { m._gDoorGoal = null; return false; }
    // is the hunted mark the player? (m.rage is cleared mid-detour → use the
    // remembered flag too) — only affects the chest height we LOS-test against.
    const huntPlayer = (m.rage && m.rage.isPlayer) || (!m.rage && m._gDoorGoal && m._gWasPlayer);
    const ty = (tp.y || 0) + (huntPlayer ? 1.55 : 1.3);
    // throttled lookup (matches police.js _doorCD cadence) — cheap, not per-frame
    m._gDoorCD = (m._gDoorCD || 0) - dt;
    if (m._gDoorCD <= 0) {
      m._gDoorCD = 0.45 + rng() * 0.3;
      const lot = NAV.indoorLotAt(tp.x, tp.z);
      // only detour when the target is INSIDE a lot we are NOT already in, and we
      // genuinely can't shoot them (blind). A clear shot → let the brain fight.
      if (lot && NAV.indoorLotAt(m.pos.x, m.pos.z) !== lot && !attackerHasLOS(m, tp.x, ty, tp.z)) {
        const door = NAV.doorFor(lot);
        // route only if the door sits between us and the target (closer than the
        // target itself) so we never run AWAY from a target already in the doorway.
        if (door && Math.hypot(door.x - m.pos.x, door.z - m.pos.z) > 2.4) {
          NAV.routeTo(m.pos.x, m.pos.z, tp.x, tp.z, _gDoorPath);   // threads streets → door → inside
          if (_gDoorPath.length) {
            // REMEMBER who we were hunting BEFORE we release rage, so we can
            // re-engage exactly the same target once we're at the door / can see.
            const victim = m.rage;
            m._gWasPlayer = !!(victim && victim.isPlayer);
            m._gWasVictim = (victim && !victim.isPlayer) ? victim : null;
            // copy out of the shared routeTo pool into the ped's OWN path array so
            // a later routeTo for another attacker can't clobber this one mid-walk.
            const own = [];
            for (let k = 0; k < _gDoorPath.length; k++) own.push({ x: _gDoorPath[k].x, z: _gDoorPath[k].z });
            m.path = own;
            m._gDoorGoal = { x: door.x, z: door.z };
            // one-shot rage release so peds.js WALKS the path instead of beelining
            // the rage target through the wall; we re-rage on arrival / sightline.
            m.rage = null; m.state = "walk"; m.pause = 0;
            m.target.set(m.path[0].x, 0, m.path[0].z);
          }
        } else m._gDoorGoal = null;
      } else m._gDoorGoal = null;
    }
    if (m._gDoorGoal) {
      const ddx = m._gDoorGoal.x - m.pos.x, ddz = m._gDoorGoal.z - m.pos.z;
      // reached the door OR a fresh sightline opened → drop the detour, resume the
      // hunt: re-rage the original target so peds.js fights again from here.
      const reached = Math.hypot(ddx, ddz) < 2.4;
      const seesNow = attackerHasLOS(m, tp.x, ty, tp.z);
      if (reached || seesNow) {
        m._gDoorGoal = null;
        // restore the chase: rage at whoever we were hunting (player or rival)
        const PA = playerActor();
        if (m._gWasPlayer && PA) { m.rage = PA; }
        else if (m._gWasVictim && !m._gWasVictim.dead) { m.rage = m._gWasVictim; }
        if (m.rage) { m.state = "fight"; m.target.set(m.rage.pos.x, 0, m.rage.pos.z); m.path = null; }
      }
      return true;
    }
    return false;
  }

  // run the door-router over only the live ATTACKERS each frame — a bounded set
  // (raid squads ≤10, reprisal squads ≤6, plus any rival-war fighters), each
  // self-throttled by m._gDoorCD so the indoor/LOS lookups stay cheap. We touch
  // a member only when it's actually hunting/raiding AND raging at a real mark
  // (or already mid-detour). Players-only matters: the bug is "a gang comes for
  // ME", but routing rival-vs-rival chasers through doors too is the same code
  // and keeps the city honest with zero extra cost on this bounded set.
  function routeAttackersThruDoors(dt) {
    if (!CBZ.cityNav || !CBZ.cityNav.indoorLotAt) return;
    for (const gang of CBZ.cityGangs) {
      if (gang.absorbed) continue;
      for (const m of gang.members) {
        if (!m || m.dead || m.ko > 0 || m.inCar || m.companion || m.controlled) continue;
        // a member holding a war-shape FIRING ROLE (arc/press/call/back/bag) is a
        // positioned fighter, not a pursuer — leave the front line to war-shape so
        // the two systems never fight over guard/rage. Door routing is for raw
        // chasers + reprisal HUNTERS who are walled out of a target inside.
        if (m._wRole) { if (m._gDoorGoal) m._gDoorGoal = null; continue; }
        // only attackers: a live rage mark, or a door detour still in flight that
        // belongs to a member who's STILL on the warpath (hunting / on a raid
        // clock). A member who's gone home (no rage, not hunting, raidT done)
        // drops any stale detour so it can't keep walking to an old door.
        const onWarpath = (m.rage && !m.rage.dead) || m.hunting || m.raidT > 0;
        const attacking = onWarpath && ((m.rage && !m.rage.dead) || m._gDoorGoal);
        if (!attacking) { if (m._gDoorGoal) { m._gDoorGoal = null; m._gWasVictim = null; } continue; }
        routeAttackerToDoor(m, dt);
      }
    }
  }

  // ============================================================
  //  WAR SHAPE — crews fight with ROLES, not as a blob. WHY: a war you can
  //  READ is a war you can beat — someone presses, someone hangs back on a
  //  firing line, the hurt fall back, a leader calls the push. Everything here
  //  drives ONLY fields peds.js already honors (guard/rage/state/target):
  //  the guard point is the brain's own anchor (it loiters a gangster there
  //  and rages him at rivals around it), so an arc of guard points becomes a
  //  front line with no per-frame shepherding. Cadenced at ~0.7s over the
  //  gang rosters (a few hundred cheap reads), never per-frame-per-actor.
  //  All fields are transient (_wRole/_wT/_wHadGun) and the existing
  //  raidT/homeGuard return infra restores every post we move.
  // ============================================================
  let shapeT = 0;
  const BARK_CALL = ["Spread out — keep 'em boxed in!", "Push! Hold this line!", "On me — don't bunch up!", "Squeeze 'em from both sides!"];
  const BARK_DRY = ["I'm dry!", "I'm out — cover me!", "Gun's empty!"];
  const BARK_HIT = ["I'm hit — pulling back!", "I'm bleeding, I'm out!", "Can't stay up — falling back!"];
  const BARK_BAG = ["Grab the iron before the law shows.", "Pick that piece up — it's ours now.", "Sweep the street, take it all."];
  function violentBar() { const ag = (CBZ.CITY && CBZ.CITY.aggro) || {}; return ag.violent || 0.88; }

  // a short, human line over a fighter's head — per-gang throttled, and only
  // when the player can actually see/hear it (nobody pays for off-screen theatre)
  function wbark(gang, m, lines) {
    if (!m || m.dead || !CBZ.citySay) return;
    if (gang && gang._barkT > 0) return;
    if (!nearPlayer(m.pos.x, m.pos.z, 70)) return;
    if (gang) gang._barkT = 4 + rng() * 3;
    CBZ.citySay(m, "“" + lines[(rng() * lines.length) | 0] + "”", m.tagColor || "#ffb37b", 2.2);
  }

  function clearWarRole(m) { m._wRole = null; m._wT = 0; m._wHadGun = false; }
  function saveHome(m) { if (!m.homeGuard && m.guard) m.homeGuard = { x: m.guard.x, z: m.guard.z }; }

  // put a fighter on a point via the brain's own anchor (guard) + a first step
  // (target). breakRage is a ONE-TIME release so they route to the slot — we
  // never clear rage twice for the same role, so there's no tug-of-war with
  // the brain re-engaging them (that's the brain's call from here on).
  function assignPoint(m, role, x, z, breakRage) {
    const A = CBZ.city && CBZ.city.arena;
    if (A && A.clampToCity) { const p = { x, z }; A.clampToCity(p, 1.5); x = p.x; z = p.z; }
    m._wRole = role; m._wT = 16 + rng() * 6;
    saveHome(m);
    m.guard = { x, z };
    if (!(m.raidT > 0)) m.raidT = 14 + rng() * 8;   // the existing return walks them home after
    if (breakRage) {
      m.rage = null; m.state = "walk"; m.path = null; m.pause = 0;
      if (m.target) m.target.set(x, 0, z);
    }
  }

  // (2)+(3) the hurt and the dry disengage BACKWARD — behind their own arc,
  // still facing the scene — instead of evaporating in a random sprint.
  function fallBack(m, E, dist) {
    let bx = m.pos.x - E.x, bz = m.pos.z - E.z; const bl = Math.hypot(bx, bz) || 1; bx /= bl; bz /= bl;
    let px = m.pos.x + bx * dist, pz = m.pos.z + bz * dist;
    const A = CBZ.city && CBZ.city.arena;
    if (A && A.clampToCity) { const p = { x: px, z: pz }; A.clampToCity(p, 1.5); px = p.x; pz = p.z; }
    m._wRole = "back"; m._wT = 12;
    saveHome(m);
    m.guard = { x: px, z: pz };
    if (!(m.raidT > 0)) m.raidT = 10 + rng() * 6;
    m.rage = null; m.state = "flee"; m.path = null; m.pause = 0;
    if (m.target) m.target.set(px, 0, pz);
    m.fear = Math.max(m.fear || 0, 5); m.alarmed = Math.max(m.alarmed || 0, 4);
    // one last look at the threat as they peel off (flee owns the legs after)
    if (m.group) m.group.rotation.y = Math.atan2(E.x - m.pos.x, E.z - m.pos.z);
  }

  // nearest live member of the engaged ENEMY gang (or the player) near a fighter
  function engageFoe(eng, m) {
    if (!eng.foe) return null;        // no known enemy side → never pick on randoms
    if (eng.foe === "player") {
      const P = CBZ.player, PA = playerActor();
      if (P && !P.dead && PA) {
        const dx = P.pos.x - m.pos.x, dz = P.pos.z - m.pos.z;
        if (dx * dx + dz * dz < 14 * 14) return PA;
      }
      return null;
    }
    let best = null, bd = 14 * 14;
    for (const p of CBZ.cityPeds) {
      if (!p || p.dead || p.ko > 0 || p.gang !== eng.foe) continue;
      const dx = p.pos.x - m.pos.x, dz = p.pos.z - m.pos.z, dd = dx * dx + dz * dz;
      if (dd < bd) { bd = dd; best = p; }
    }
    return best;
  }

  // (1)+(4) assign roles to a live squad: shooters fan to a firing arc spread
  // PERPENDICULAR to the squad→enemy axis — when two squads shape against each
  // other their arcs become OPPOSING LINES down the street (the axis between
  // the two centroids), not a scrum. Melee presses in pairs; top rank calls it.
  function shapeSquad(gang, eng, fighters, E, S) {
    let ax = E.x - S.x, az = E.z - S.z; const al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
    const tx = -az, tz = ax;
    // the highest rank present CALLS the push, then holds centre-back
    let lead = null;
    for (const m of fighters) if (!lead || rankTier(m) > rankTier(lead)) lead = m;
    if (lead && !eng.called) {
      if (lead._wRole === "call") eng.called = true;     // pre-assigned by launchWar
      else if (!lead._wRole && !lead.hunting && fighters.length >= 3) {
        eng.called = true;
        assignPoint(lead, "call", E.x - ax * 17 + tx * (rng() - 0.5) * 3, E.z - az * 17 + tz * (rng() - 0.5) * 3, true);
        wbark(gang, lead, BARK_CALL);
      }
    }
    for (const m of fighters) {
      if (m._wRole || m === lead) continue;     // already has a job in this fight
      if (m.hunting) continue;                  // reprisal hunters keep raw pursuit
      m._wHadGun = !!(m.armed && (m.ammo == null || m.ammo > 0));
      if (m._wHadGun) {
        // SHOOTERS: a loose arc 8-14u off the enemy, laned along the front.
        // Only break their charge while they're still far out; in the pocket
        // we just anchor the slot and let the brain own the gunfight.
        const back = 8 + rng() * 6;
        const side = ((eng.lane % 5) - 2) * 3.1 + (rng() - 0.5) * 1.4; eng.lane++;
        const far = Math.hypot(m.pos.x - E.x, m.pos.z - E.z) > 10;
        assignPoint(m, "arc", E.x - ax * back + tx * side, E.z - az * back + tz * side, far);
      } else {
        // MELEE: press in PAIRS — two bodies share one mark, straight in
        m._wRole = "press"; m._wT = 16 + rng() * 6;
        saveHome(m);
        m.guard = { x: E.x + (rng() - 0.5) * 4, z: E.z + (rng() - 0.5) * 4 };
        if (!(m.raidT > 0)) m.raidT = 14 + rng() * 8;
        if (eng.pairOpen && eng.mark && !eng.mark.dead) { m.rage = eng.mark; m.state = "fight"; eng.pairOpen = false; }
        else if (m.rage && !m.rage.dead) { eng.mark = m.rage; eng.pairOpen = true; }
      }
    }
  }

  // per-fighter upkeep each pass: the dry transition, the wounded fallback,
  // arc shooters opening up, the aftermath bagger staying on his pick-up.
  function tendFighter(gang, eng, m, E) {
    if (m.surrender || m.state === "surrender") { clearWarRole(m); return; }
    // re-armed (looted a piece off the street) → back on the ammo watch
    if (!m._wHadGun && m.armed && (m.ammo | 0) > 0) m._wHadGun = true;
    // (3) AMMO DISCIPLINE: peds.js already strips an empty gun (npcAttack);
    // here the MAN reacts — bark, then steel if he's violent, or the arc rear.
    if (m._wHadGun && (!m.armed || (m.ammo | 0) <= 0)) {
      m._wHadGun = false;
      wbark(gang, m, BARK_DRY);
      if ((m.aggr || 0) >= violentBar()) {
        // the violent draw steel and keep pressing (the brain melees them in)
        if (!m.weapon) { m.weapon = gangType(gang).melee || "Bat"; if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(m); }
        m._wRole = "press"; m._wT = Math.max(m._wT || 0, 10);
      } else fallBack(m, E, 8);   // the brain's own loot-a-drop instinct can re-arm them back there
      return;
    }
    // (2) WOUNDED FALL BACK: under 35% and not a maniac → backward, facing it
    if (m._wRole !== "back" && m._wRole !== "bag" && m.hp < (m.maxHp || 100) * 0.35 && (m.aggr || 0) < violentBar()) {
      fallBack(m, E, 9);
      wbark(gang, m, BARK_HIT);
      return;
    }
    // an arc shooter holding his slot opens up when an enemy is in reach —
    // from here the brain owns the duel (armed peds hold + shoot at 9u).
    if (m._wRole === "arc" && !m.rage) {
      const foe = engageFoe(eng, m);
      if (foe && !foe.dead) { m.rage = foe; m.state = "fight"; }
    }
    // (5) aftermath gun-bagger: think() demotes "loot" on calm passes — keep
    // him on the job until the piece is in hand or the street is clean.
    if (m._wRole === "bag") {
      let best = null, bd = 24 * 24;
      for (const d of CBZ.cityDrops || []) {
        const dx = d.x - m.pos.x, dz = d.z - m.pos.z, dd = dx * dx + dz * dz;
        if (dd < bd) { bd = dd; best = d; }
      }
      if (!best || m.armed) { clearWarRole(m); return; }   // got one / nothing left
      m.state = "loot"; m.pause = 0;
      if (m.target) m.target.set(best.x, 0, best.z);
    }
  }

  // one cadenced pass for one crew: find its live fighters, shape new ones,
  // tend the rest. Roster-bounded; engagement state lives on gang._eng.
  function shapeGangPass(gang, step) {
    let fighters = null, ex = 0, ez = 0, en = 0, sx = 0, sz = 0, foeKey = null, raidLot = null;
    for (const m of gang.members) {
      if (!m || m.dead) { if (m && m._wRole) clearWarRole(m); continue; }
      if (m.ko > 0 || m.inCar || m.companion || m.controlled) { if (m._wRole) clearWarRole(m); continue; }
      if (m._wT > 0) m._wT -= step;
      const R = m.rage;
      const raging = !!(R && !R.dead && (!R.gang || R.gang !== gang.id));
      if (!raging && !(m._wRole && m._wT > 0)) { if (m._wRole) clearWarRole(m); continue; }
      (fighters || (fighters = [])).push(m);
      sx += m.pos.x; sz += m.pos.z;
      if (!foeKey && m.raidGang) foeKey = m.raidGang;    // raiders know their mark en route
      if (!raidLot && m.raidLot) raidLot = m.raidLot;
      if (raging) {
        ex += R.pos.x; ez += R.pos.z; en++;
        const fk = R.isPlayer ? "player" : (R.gang || "street");
        if (!foeKey || fk === "player") foeKey = fk;   // stable: player headline, else first-seen
      }
    }
    if (!fighters) { gang._eng = null; return; }
    const n = fighters.length;
    const S = { x: sx / n, z: sz / n };
    // enemy locus: live rage marks, else the contested lot, else last-known, else home
    let E = en ? { x: ex / en, z: ez / en }
      : raidLot ? { x: raidLot.cx, z: raidLot.cz }
      : (gang._eng && gang._eng.E) || S;
    if (!gang._eng || (foeKey && gang._eng.foe !== foeKey)) {
      gang._eng = { foe: foeKey, lane: 0, called: false, pairOpen: false, mark: null, E };
    }
    const eng = gang._eng; eng.E = E;
    // only a real squad fight (3+ committed, vs a gang or the player) earns
    // SHAPE; lone scuffles and brawls with randoms stay raw.
    const shapeable = en >= 1 && n >= 3 && (foeKey === "player" || !!gangById(foeKey));
    if (shapeable) shapeSquad(gang, eng, fighters, E, S);
    for (const m of fighters) tendFighter(gang, eng, m, E);
  }

  function shapeAllGangs(step) {
    for (const gang of CBZ.cityGangs) {
      if (gang._barkT > 0) gang._barkT -= step;
      if (gang.isPlayer || gang.absorbed) continue;
      shapeGangPass(gang, step);
    }
  }

  // sizeup.js calls this the instant a set RALLIES, so the crew takes shape NOW
  // instead of on the next cadence tick (which would still catch it in ~0.7s).
  CBZ.cityGangShapeUp = function (gangId) {
    const gang = gangById(gangId);
    if (gang && !gang.isPlayer && !gang.absorbed && g.mode === "city") shapeGangPass(gang, 0);
  };

  // (5) WAR AFTERMATH — the war timer runs out and the street SHOWS it:
  // survivors regroup to their block (the existing raidT return walks them),
  // the badly hurt sink down for a beat before limping off, and one body
  // sweeps the dropped guns. Bounded, cosmetic, cleared by the same timers
  // that already govern raids.
  function warAftermath(gang) {
    if (!gang || gang.isPlayer) return;
    let bagger = null;
    for (const m of gang.members) {
      if (!m || m.dead || m.inCar || m.companion || m.controlled) continue;
      const fought = m.raidT > 0 || m._wRole || m.hunting;
      if (!fought) continue;
      clearWarRole(m);
      m.rage = null;
      if (m.raidT > 0) m.raidT = Math.min(m.raidT, 2 + rng() * 3);   // head home soon
      if (m.hp < (m.maxHp || 100) * 0.5 && !(m.ko > 0)) {
        // the wounded drop to the ground and catch their breath (ko-style pause)
        m.ko = 2 + rng() * 2.5;
        if (CBZ.body && CBZ.body.hit) CBZ.body.hit(m, { fromX: m.pos.x + 0.6, fromZ: m.pos.z, force: 2.5, knockdown: true });
      } else if (!bagger || rankTier(m) < rankTier(bagger)) bagger = m;   // lowest rank sweeps
    }
    // one survivor bags the iron lying in the street (drops age out on their own)
    if (bagger && CBZ.cityDrops && CBZ.cityDrops.length) {
      let best = null, bd = 30 * 30;
      for (const d of CBZ.cityDrops) {
        const dx = d.x - bagger.pos.x, dz = d.z - bagger.pos.z, dd = dx * dx + dz * dz;
        if (dd < bd) { bd = dd; best = d; }
      }
      if (best) {
        bagger._wRole = "bag"; bagger._wT = 9;
        saveHome(bagger);
        bagger.guard = { x: best.x, z: best.z };
        bagger.raidT = Math.max(bagger.raidT || 0, 8);   // then back to the block
        bagger.state = "loot"; bagger.path = null; bagger.pause = 0; bagger.attackCD = 0;
        if (bagger.target) bagger.target.set(best.x, 0, best.z);
        wbark(gang, bagger, BARK_BAG);
      }
    }
  }

  // expose a lookup so the player-gang hub can find a rival by id/record
  CBZ.cityGangById = gangById;

  // ---- OP POSTS (gangops.js C8): read-only corner/post spots derived from a
  //      crew's HELD LOTS, so the ops director (dealer corners, patrol anchors)
  //      can post members on believable sidewalk spots without re-deriving lot
  //      geometry itself. Each lot contributes its four corners pulled a touch
  //      inward (so a "corner dealer" stands on the kerb, not in a facade) +
  //      the lot centre. Clamped to walkable city ground. Additive — touches no
  //      turf/war/raid/payday state; gangops.js falls back to its own derivation
  //      if this isn't present (older gangs.js). ----
  CBZ.cityGangOpSpots = function (gangId) {
    const gang = gangById(gangId); if (!gang || !gang.turf || !gang.turf.length) return [];
    const A = CBZ.city && CBZ.city.arena;
    const out = [];
    for (const lot of gang.turf) {
      const hw = (lot.w || 16) / 2 - 1.5, hd = (lot.d || 16) / 2 - 1.5;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const p = { x: lot.cx + sx * hw, z: lot.cz + sz * hd };
        if (A && A.clampToCity) A.clampToCity(p, 1.5);
        out.push(p);
      }
      out.push({ x: lot.cx, z: lot.cz });
    }
    return out;
  };

  // ---- GANG HQ: the home block a crew anchors on. The live boss IS the HQ
  //      while he stands; if he's down it falls back to the seeded home lot,
  //      then the crew's shifting centre, then the first held lot. ----
  function gangHQ(gangId) {
    const gang = gangById(gangId); if (!gang) return null;
    const nm = (gang.name || "Gang") + " HQ";
    if (gang.boss && !gang.boss.dead && gang.boss.pos) return { x: gang.boss.pos.x, z: gang.boss.pos.z, name: nm };
    if (gang.hq) return { x: gang.hq.x, z: gang.hq.z, name: gang.hq.name || nm };
    if (gang.center && (gang.center.x || gang.center.z)) return { x: gang.center.x, z: gang.center.z, name: nm };
    if (gang.turf && gang.turf.length) return { x: gang.turf[0].cx, z: gang.turf[0].cz, name: nm };
    return null;
  }
  CBZ.cityGangHQ = gangHQ;

  // nearest RIVAL crew's HQ to (x,z) — skips the player's own crew + any
  // absorbed/leaderless gang that's been pushed to a {0,0} dead centre.
  CBZ.cityNearestRivalHQ = function (x, z, excludeId) {
    let best = null, bd = Infinity;
    for (const gang of CBZ.cityGangs) {
      if (!gang || gang.isPlayer) continue;
      if (excludeId != null && gang.id === excludeId) continue;
      if (gang.absorbed) continue;
      // a leaderless/absorbed crew whose centre collapsed to {0,0} has no real HQ
      if ((!gang.turf || !gang.turf.length) && gang.center && !gang.center.x && !gang.center.z) continue;
      const hq = gangHQ(gang.id); if (!hq) continue;
      const dx = hq.x - x, dz = hq.z - z, dd = dx * dx + dz * dz;
      if (dd < bd) { bd = dd; best = { id: gang.id, x: hq.x, z: hq.z, name: hq.name }; }
    }
    return best;
  };

  // ---- rob a gang's stash (interact.js [I] near the stash duffel) ----
  CBZ.cityRobStash = function (lot) {
    const st = lot && !lot.demolished && lot.building && lot.building.stash;
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
      if (lot.demolished) continue;
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
    // the occupancy registry (city/occupy.js) holds the HQ garrisons + the
    // floor-lift roster; without this it survives a city rebuild and keeps
    // writing Y to orphaned bodies from the previous run, forever.
    if (CBZ.cityOccupyReset) CBZ.cityOccupyReset();
    // wipe per-gang standing + HQ before the roster clears (spawn rebuilds hq).
    // archetype-derived fields (type/archLabel/defendW/expandW/roamW) are
    // re-stamped from config on the next spawn, but clear them here too so a
    // stale record can never leak its old weights into a fresh run.
    for (const gang of CBZ.cityGangs) {
      if (gang) {
        gang.standing = 0; gang.hq = null;
        gang.archLabel = null; gang.defendW = 1; gang.expandW = 1; gang.roamW = 1;
      }
    }
    // drop any HIT/HQ waypoint we dropped on the full map so it doesn't bleed runs.
    if (CBZ.fullMap && CBZ.fullMap.clearWaypoint) CBZ.fullMap.clearWaypoint("city");
    // clear the gang-OPS scratch (dealers/buyers/extorters + the cash carrot) while
    // the records still exist — gangops.js owns it (optional: it may not be loaded).
    if (CBZ.cityGangOpsReset) CBZ.cityGangOpsReset();
    CBZ.cityGangs.length = 0; warT = 0; incomeT = 0; reprisalT = 0; driveT = 0; shapeT = 0;
    if (CBZ.cityVendettaReset) CBZ.cityVendettaReset();   // no stale snitch runs / loyalty feuds
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

  // ============================================================
  //  PERSISTENCE (flag GANG_PERSIST) — the takeover war finally SURVIVES a
  //  reload. Registration follows the exact worldstate.js idiom the sibling
  //  systems use (civilwar "cwar", polwar "war", militia "mil"): wrap
  //  CBZ.cityWorldCommit/Collect to stamp a version-guarded blob under
  //  led.gangwar, hydrate whenever the g.cityWorld REFERENCE changes, and
  //  fast-forward the freshly-spawned per-seed board to the saved state.
  //
  //  THE BLOB (v1, guarded by the WORLD SEED — a save from another world is
  //  skipped, never misapplied): per street gang a SAFE SHELL only —
  //  {id, name, color, treasury, standing, hostility, recruitPool/rosterCap,
  //   playerFriendly, bossAlive/bossName, absorbed, turf as INDICES into
  //   city.arena.lots (stable per seed — worlds are seed-deterministic),
  //   roster as live COUNTS per rank}. Never live ped refs (worldstate.js's
  //  own warning: they are not JSON-safe). The player's crew rides the same
  //  blob ({founded,name,color,order,turf,roster}); militia gangs are
  //  excluded — militia.js already owns their "mil" shells.
  //
  //  RESTORE SEMANTICS: spawnCityGangs builds the default seed layout first,
  //  then (next upkeep tick) we reassign turf lot refs from the saved
  //  indices, trim/respawn each bench to the saved rank counts through the
  //  ONE shared spawnGangMember path, restore treasuries/standing, remove
  //  absorbed crews the way a live takeover does (spliced), and hand the
  //  player rec to playergang.js's cityPlayerGangRestore. Relations/won live
  //  in turf.js's own "turfrel" blob (same idiom).
  // ============================================================
  let _pNeedApply = false;   // a fresh spawn (or fresh ledger) wants the saved board applied
  let _pBlob = null;         // the authoritative saved state (updated on stamp + hydrate)
  let _pHydrated = null;     // last g.cityWorld reference we read
  let _pWrapsDone = false;

  function serializeGangs() {
    const A = CBZ.city && CBZ.city.arena;
    if (!A || !A.lots || !CBZ.cityGangs.length) return null;
    const lots = A.lots;
    const packTurf = (turfArr) => {
      const t = [];
      for (const lot of turfArr || []) { const i = lots.indexOf(lot); if (i >= 0) t.push(i); }
      return t;
    };
    const packRoster = (gang) => {
      const r = {};
      for (const m of gang.members || []) {
        if (!m || m.dead) continue;
        if (m === gang.boss || m.rank === "boss") continue;
        const rk = RANK_BY_KEY[m.rank] ? m.rank : "soldier";
        r[rk] = (r[rk] || 0) + 1;
      }
      return r;
    };
    const seen = {};
    const out = [];
    for (const gang of CBZ.cityGangs) {
      if (!gang || gang.kind === "militia") continue;   // militia.js owns its own blob
      seen[gang.id] = 1;
      if (gang.isPlayer) {
        const pg = g.playerGang;
        out.push({
          id: "player", isPlayer: true, founded: !!(pg && pg.founded),
          name: (pg && pg.name) || gang.name || null,
          color: (pg && pg.color != null) ? pg.color : gang.color,
          order: (pg && pg.order) || "follow",
          turf: packTurf(gang.turf), roster: packRoster(gang),
        });
        continue;
      }
      out.push({
        id: gang.id, name: gang.name, color: gang.color,
        absorbed: !!gang.absorbed,
        treasury: Math.round(gang.treasury || 0),
        standing: Math.round(gang.standing || 0),
        hostility: Math.round((gang.hostility || 0) * 100) / 100,
        recruitPool: gang.recruitPool | 0,
        rosterCap: gang.rosterCap | 0,
        peakTurf: gang.peakTurf | 0,
        playerFriendly: !!gang.playerFriendly,
        leaderless: !!gang.leaderless,
        bossAlive: !!(gang.boss && !gang.boss.dead),
        bossName: gang.bossName || null,
        turf: packTurf(gang.turf), roster: packRoster(gang),
      });
    }
    // a config crew ABSENT from the live roster was absorbed + spliced (player
    // takeover) — record that, or a reload would resurrect it at spawn.
    for (const d of (CBZ.CITY && CBZ.CITY.gangs) || []) {
      if (d && d.id && !seen[d.id]) out.push({ id: d.id, absorbed: true, turf: [], roster: {} });
    }
    // a founded crew that never registered in the list still saves (edge)
    if (!seen.player && g.playerGang && g.playerGang.founded) {
      const pg = g.playerGang;
      out.push({ id: "player", isPlayer: true, founded: true, name: pg.name, color: pg.color, order: pg.order || "follow", turf: packTurf(pg.turf), roster: {} });
    }
    return { v: 1, seed: CBZ.WORLD_SEED >>> 0, gangs: out };
  }
  CBZ.cityGangsSerialize = serializeGangs;   // probe/debug read

  function stampGangs() {
    if (CFG.GANG_PERSIST === false) return;
    const led = g.cityWorld;
    if (!led || typeof led !== "object") return;
    if (_pNeedApply) return;                  // never clobber a not-yet-applied save
    if (g.mode !== "city" || !CBZ.cityGangs.length) return;
    const blob = serializeGangs();
    if (blob) { led.gangwar = blob; _pBlob = blob; }
  }

  function ensureGangSaveWraps() {
    if (_pWrapsDone) return;
    const commit = CBZ.cityWorldCommit;
    if (typeof commit !== "function") return; // worldstate.js not up yet — retry next tick
    _pWrapsDone = true;
    if (!commit._gangWrap) {
      const w = function () { stampGangs(); return commit.apply(this, arguments); };
      w._gangWrap = true; CBZ.cityWorldCommit = w;
    }
    if (CBZ.cityWorldCollect && !CBZ.cityWorldCollect._gangWrap) {
      const col = CBZ.cityWorldCollect;
      const wc = function () { stampGangs(); return col.apply(this, arguments); };
      wc._gangWrap = true; CBZ.cityWorldCollect = wc;
    }
  }

  function hydrateGangLedger() {
    const led = g.cityWorld;
    if (!led || led === _pHydrated) return;
    _pHydrated = led;
    if (CFG.GANG_PERSIST === false) return;
    const b = led.gangwar;
    if (b && b.v === 1) { _pBlob = b; _pNeedApply = true; }
    else _pBlob = null;                        // fresh/wiped ledger → default board
  }

  // remove a restored-surplus body the way the corpse pipeline retires one
  // (dead + collected + culled, group off the scene) — never a splice of
  // CBZ.cityPeds, so no other system's iteration shifts under it.
  function despawnMember(m) {
    if (!m) return;
    m.dead = true; m.hp = 0; m.collected = true; m.culled = true;
    m.rage = null; m.raidT = 0; m.raidGang = null; m.raidLot = null; m.hunting = false;
    if (m.tag && m.tag.parent) m.tag.parent.remove(m.tag);
    if (m.group && m.group.parent) m.group.parent.remove(m.group);
  }

  function clearLotClaim(lot) {
    if (!lot || !lot.building) return;
    lot.building.gang = null; lot.building.gangColor = null; lot.building.playerTurf = false;
    if (lot.building.stash) lot.building.stash.gang = null;
  }
  function paintLotFor(lot, gang, playerTurf) {
    lot.building = lot.building || {};
    lot.building.gang = gang.id; lot.building.gangColor = gang.color;
    lot.building.playerTurf = !!playerTurf;
    if (lot.building.stash) lot.building.stash.gang = gang.id;
    if (!lot.demolished && lot.building.stash && lot.building.stash.mesh && lot.building.stash.mesh.material && lot.building.stash.mesh.material.emissive) {
      try { lot.building.stash.mesh.material.emissive.setHex(gang.color); } catch (e) {}
    }
  }

  // trim/respawn one crew's bench to the saved per-rank counts, through the
  // SAME spawnGangMember factory the build + recruit tick use.
  function adjustRoster(gang, rec) {
    const want = rec.roster || {};
    const have = {}, byRank = {};
    for (const m of gang.members) {
      if (!m || m.dead || m === gang.boss || m.rank === "boss") continue;
      const rk = RANK_BY_KEY[m.rank] ? m.rank : "soldier";
      have[rk] = (have[rk] || 0) + 1;
      (byRank[rk] || (byRank[rk] = [])).push(m);
    }
    for (const rk in have) {
      let extra = have[rk] - (want[rk] | 0);
      const list = byRank[rk];
      while (extra > 0 && list && list.length) {
        const m = list.pop(); extra--;
        const i = gang.members.indexOf(m); if (i >= 0) gang.members.splice(i, 1);
        despawnMember(m);
      }
    }
    for (const rk in want) {
      let need = (want[rk] | 0) - (have[rk] || 0);
      let k = 0;
      while (need > 0) {
        const lot = gang.turf.length ? gang.turf[k++ % gang.turf.length]
          : (gang.hq && gang.hq.lot) || { cx: gang.center.x, cz: gang.center.z };
        const ped = spawnGangMember(gang, lot, rk);
        if (!ped) break;
        need--;
      }
    }
  }

  function applyGangsBlob(blob) {
    const A = CBZ.city && CBZ.city.arena;
    if (!A || !A.lots || !A.lots.length) return false;
    if (!blob || blob.v !== 1) return false;
    if ((blob.seed >>> 0) !== (CBZ.WORLD_SEED >>> 0)) return false;  // another world's save
    // 0) release every street-gang lot claim we're about to reassign (militia
    //    turf is militia.js's blob — its claims stay untouched; the player's
    //    only when the playergang restore path exists to rebuild it).
    for (const gang of CBZ.cityGangs) {
      if (!gang || gang.kind === "militia") continue;
      if (gang.isPlayer && !CBZ.cityPlayerGangRestore) continue;
      for (const lot of gang.turf) clearLotClaim(lot);
      gang.turf.length = 0;
    }
    // 1) NPC crews
    for (const rec of blob.gangs || []) {
      if (!rec || rec.isPlayer) continue;
      const gang = gangById(rec.id);
      if (!gang) continue;
      if (rec.absorbed) {
        // mirror the live takeover path: bodies gone, record off the roster
        if (gang.boss) retireBossIdentity(gang.boss, null);   // don't leave a live gangBoss identity for a wiped crew
        for (const m of gang.members.slice()) despawnMember(m);
        gang.members.length = 0;
        gang.boss = null; gang.absorbed = true;
        const gi = CBZ.cityGangs.indexOf(gang);
        if (gi >= 0) CBZ.cityGangs.splice(gi, 1);
        continue;
      }
      for (const li of rec.turf || []) {
        const lot = A.lots[li];
        if (!lot) continue;
        gang.turf.push(lot);
        paintLotFor(lot, gang, false);
        if (lot.building && lot.building.owner) { lot.building.owner.id = gang.id; lot.building.owner.type = "gang"; }
      }
      recenter(gang);
      gang.treasury = rec.treasury || 0;
      gang.standing = rec.standing || 0;
      gang.hostility = rec.hostility || 0;
      gang.provoke = 0;
      gang.recruitPool = rec.recruitPool | 0;
      if (rec.rosterCap) gang.rosterCap = rec.rosterCap;
      if (rec.peakTurf) gang.peakTurf = Math.max(gang.peakTurf || 0, rec.peakTurf);
      gang.playerFriendly = !!rec.playerFriendly;
      if (gang.playerFriendly) { gang.hostility = 0; gang.strikeT = 9e9; }
      adjustRoster(gang, rec);
      // boss continuity: dead-at-save → drop the fresh spawn's boss and let the
      // existing succession tick crown the bench (or leave the crew leaderless);
      // alive → carry the saved (possibly succession-renamed) name forward.
      if (!rec.bossAlive) {
        const b = gang.boss;
        if (b && !b.dead) {
          retireBossIdentity(b, null);
          const bi = gang.members.indexOf(b); if (bi >= 0) gang.members.splice(bi, 1);
          despawnMember(b);
        }
        gang.boss = null;
        const bench = gang.members.some((m) => m && !m.dead);
        gang.bossDead = bench;
        gang.leaderless = !bench;
      } else if (rec.bossName && gang.boss && !gang.boss.dead && gang.boss.name !== rec.bossName) {
        gang.boss.name = rec.bossName; gang.bossName = rec.bossName;
        tagWithRank(gang.boss, gang.color);
      }
    }
    // 2) the player's crew (playergang.js owns that rebuild)
    const prec = (blob.gangs || []).find((r) => r && r.isPlayer);
    if (prec && prec.founded && CBZ.cityPlayerGangRestore) {
      try { CBZ.cityPlayerGangRestore(prec); } catch (e) {}
    }
    // 3) the crew the player is patched into stays friendly across the reload.
    // Set the flag DIRECTLY (not via cityGangSetPlayerFriendly — its +30
    // standing windfall would drift the restored standing on every reload).
    const mem = g.cityMembership;
    if (mem && mem.gangId) {
      const mg = gangById(mem.gangId);
      if (mg) { mg.playerFriendly = true; mg.provoke = 0; mg.hostility = 0; mg.strikeT = 9e9; }
    }
    // 4) settle the derived layers: mute the zone-flip toasts while ownership
    //    snaps to the saved board, drop op caches aimed at the pre-restore
    //    roster, re-derive zones/colours.
    if (CBZ.cityTurfMuteFlips) CBZ.cityTurfMuteFlips(5);
    if (CBZ.cityGangOpsReset) CBZ.cityGangOpsReset();
    if (CBZ.cityRefreshTurfHud) CBZ.cityRefreshTurfHud();
    return true;
  }
  CBZ.cityGangsApply = applyGangsBlob;       // probe/debug hook

  function maybeApplyPersist() {
    if (!_pNeedApply) return;
    if (CFG.GANG_PERSIST === false) { _pNeedApply = false; return; }
    const A = CBZ.city && CBZ.city.arena;
    if (!A || !A.lots || !A.lots.length || !CBZ.cityGangs.length) return;
    _pNeedApply = false;                      // one shot per spawn/ledger — stamps resume after
    if (!_pBlob) return;
    try { applyGangsBlob(_pBlob); }
    catch (e) { try { console.error("[gangs] persist restore failed", e); } catch (e2) {} }
  }

  // ---- per-gang upkeep: provoke/hostility decay, war timers, raider return ----
  let reviewT = 0;   // merit-review / loyalty-economy cadence (cheap, time-sliced)
  CBZ.onUpdate(34.5, function (dt) {
    if (g.mode !== "city") return;
    // GANG_PERSIST plumbing: install the ledger stamp wraps once, adopt a
    // changed ledger, then fast-forward a fresh spawn to the saved board.
    ensureGangSaveWraps();
    hydrateGangLedger();
    maybeApplyPersist();
    updateDrivebys(dt);
    // DOOR-AWARE ATTACK ROUTING: walk walled-out attackers to the building DOOR
    // instead of grinding/straight-lining the facade toward a target inside.
    routeAttackersThruDoors(dt);

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
      // a high-defendW archetype (cartel/syndicate) NURSES a grudge — its heat
      // cools slower, so it keeps retaliating long after a scrappy set has moved on.
      const coolMul = 1 / (gang.defendW || 1);
      if (gang.provoke > 0) gang.provoke = Math.max(0, gang.provoke - dt * 0.03 * coolMul);
      // hostility cools slowly — cross a crew and they stay sore for a while
      if (gang.hostility > 0) gang.hostility = Math.max(0, gang.hostility - dt * 0.012 * coolMul);
      if (gang.warIntensity > 0) gang.warIntensity = Math.max(0, gang.warIntensity - dt * 0.02 * coolMul);
      if (gang.lostTurfT > 0) gang.lostTurfT -= dt;
      if (gang.strikeT > 0) gang.strikeT -= dt;
      if (gang.lastDownT > 0) gang.lastDownT -= dt;

      // ---- SLOW, OUT-PACEABLE RECRUIT TICK (owner's vision: gangs trickle bodies
      //      back so a held block feels alive, but you can kill them off FASTER
      //      than they recruit, and a finite recruitPool means a determined push
      //      WIPES them for good). Fires ONE body, and only when the crew is calm,
      //      thinned, still has reserve, and the player isn't mid-massacre. ----
      if (gang.recruitT > 0) gang.recruitT -= dt;
      if (gang.recruitT <= 0) {
        gang.recruitT = gang.recruitInterval || 25;
        const canRecruit =
          !gang.isPlayer && !gang.absorbed &&
          gang.turf.length > 0 &&                       // wiped-off-the-map crews stay gone
          (gang.recruitPool || 0) > 0 &&                // FINITE reserve — empties → never grows again
          gangStrength(gang) < (gang.rosterCap || 0) && // only backfill toward the natural ceiling
          gang.warRemain <= 0 &&                         // not at war on this block — don't reinforce mid-fight
          (gang.provoke || 0) < 0.25 &&                  // not under active attack
          (gang.lastDownT || 0) <= 0;                    // player not actively massacring the crew
        if (canRecruit) {
          // post the new body on the HQ block if held, else any held lot. Low rank
          // — a fresh recruit starts at the bottom and climbs on merit like any spawn.
          const hqLot = gang.hq && gang.hq.lot && gang.turf.indexOf(gang.hq.lot) >= 0 ? gang.hq.lot : gang.turf[0];
          const rk = rng() < 0.6 ? "runner" : (rng() < 0.5 ? "lookout" : "soldier");
          const ped = spawnGangMember(gang, hqLot, rk);
          if (ped) {
            gang.recruitPool--;
            memStats(ped).joined = "recruit";
          }
        }
      }
      if (gang.warRemain > 0) {
        gang.warRemain -= dt;
        // GANG_WAR_EVENTS: advance this war's staged set-pieces while it runs
        if (gang._wev || gang._wevDef) tickWarEvents(gang, dt);
        // war's over → the AFTERMATH plays out: regroup, the hurt kneel, one
        // body bags the dropped iron (both sides run their own, on their own timer)
        if (gang.warRemain <= 0) { gang.warWith = null; gang._raidTarget = null; gang._wev = null; gang._wevDef = null; warAftermath(gang); }
      } else if (gang._wev || gang._wevDef) { gang._wev = null; gang._wevDef = null; }
      for (const m of gang.members) {
        if (!(m.raidT > 0)) continue;
        m.raidT -= dt;
        if (m.raidT <= 0 && m.homeGuard && !m.dead) {
          m.guard = { x: m.homeGuard.x, z: m.homeGuard.z };
          m.target.set(m.guard.x, 0, m.guard.z); m.pause = 0; m.path = null; m.raidGang = null; m.raidLot = null; m.hunting = false;
          if (m._wRole !== "bag") clearWarRole(m);   // a mid-sweep bagger finishes; tend clears him
        }
      }
    }

    // ---- WAR SHAPE: give live fights roles + front lines (cadenced pass) ----
    shapeT -= dt;
    if (shapeT <= 0) { shapeT = 0.7; shapeAllGangs(0.7); }

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
            // payday reads as takeover PROGRESS: blocks collected + districts held
            const zc = CBZ.cityZoneControl ? CBZ.cityZoneControl() : null;
            const zHeld = zc && zc.byGang ? (zc.byGang.player || 0) : 0;
            CBZ.city && CBZ.city.note("Turf payday: +$" + pay + " (" + lots + " blocks" +
              (zc && zc.total ? " · " + zHeld + "/" + zc.total + " districts" : "") + ") → bank", 2.2);
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
      // FAR more frequent turf wars so the player regularly stumbles onto two
      // crews shooting it out (was 18-34s). Still cadence-limited + treasury-gated
      // in launchWar so it never spawns unbounded squads or bankrupts the economy.
      warT = 8 + rng() * 9;
      const live = CBZ.cityGangs.filter((x) => !x.isPlayer && !x.playerOwned && x.turf.length && gangStrength(x) >= 2);
      if (live.length >= 2) {
        // attacker bias: richest / most aggrieved crew presses first — and an
        // EXPANSIONIST archetype (cartel: high expandW) weighs in heavier, so
        // the land-hungry crews start the most wars (visibly more aggressive map).
        // P6: anarchist collapse ×1.5's every gang's land-hunger (city/regimes.js).
        const press = (x) => ((x.treasury || 0) + (x.hostility || 0) * 300 + (x.warIntensity || 0) * 200) * (x.expandW || 1) * (CBZ.regimes && CBZ.regimes.gangBoostMul ? CBZ.regimes.gangBoostMul() : 1);
        live.sort((p, q) => press(q) - press(p));
        // pick from the top couple of pressers (not always the single richest) so
        // wars don't always involve the same crew — more varied flashpoints.
        const a = (live.length > 2 && rng() < 0.4) ? live[1] : live[0];
        const rivals = CBZ.cityGangs.filter((x) => x !== a && x.turf.length && !x.isPlayer);
        if (rivals.length) {
          // target the WEAKEST rival (fewest live bodies) — wars snowball
          rivals.sort((p, q) => gangStrength(p) - gangStrength(q));
          const b = rivals[0];
          // a cartel / expansionist crew mounts a full ASSAULT more readily (lower
          // treasury bar) so the land-hungry factions wage real, visible wars.
          const assault = (a.treasury || 0) > 650 || (a.warIntensity || 0) >= 1 || (a.expandW || 1) > 1.2;
          launchWar(a, b, { assault });
          // a flush, land-hungry aggressor can open a SECOND front the same tick —
          // two simultaneous wars across the map (guarded so it never cascades:
          // only when rich + expansionist, and only one extra).
          if ((a.expandW || 1) > 1.25 && (a.treasury || 0) > 1100 && rivals.length > 1 && rng() < 0.5) {
            const b2 = rivals[1];
            if (b2 && b2 !== b) launchWar(a, b2, { assault: false });
          }
        }
      }
    }

    // ---- TURF CAPTURE resolution: a raid that cleared the lot flips it ----
    for (const a of CBZ.cityGangs) {
      if (a.isPlayer || !a.warWith || !a._raidTarget) continue;
      const lot = a._raidTarget, b = gangById(a.warWith);
      if (!b || b.isPlayer) { a._raidTarget = null; continue; }
      if (b.turf.indexOf(lot) < 0) { a._raidTarget = null; continue; }
      // attackers count from arc range (the firing line stands 8-14u off the lot)
      const atk = liveOnLot(a, lot, 15), def = liveOnLot(b, lot, 13);
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
          if ((gang.hostility || 0) >= 2 && driveT <= 0 && activeDrivebys < MAX_DRIVEBYS() && rng() < 0.7) {
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
