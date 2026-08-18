/* ============================================================
   city/factions.js — THE ROLE LAYER. Who the player IS, and who pays them.

   OWNER'S ASK (2026-07-26, verbatim): "the hard part of flying a plane and
   stealing it has been coded, the easy part now is the roles — so you can
   join the military or join the gang or terrorist group or start your own
   and then get paid to do the stuff. That's a game."

   THE PROBLEM THIS REPLACES (census, 2026-07-26):
     · 6 independent join->rank->rank-up ladders. The gang tier array
       `prospect,lookout,runner,soldier,enforcer,lt` is hand-typed as a
       literal THREE separate times (playergang.js:631, :727, :744) next to
       the canonical table it never reads (gangs.js RANKS).
     · 9 reputation scalars, no two sharing a getter, range or persistence.
     · 16 hardcoded `g.playerGang` / `cityMembership` reads across 15 files,
       with at least 4 independently reimplemented `myGangId()` helpers.
     · promotion.js: a whole 7-tier ladder, retired, still shipping, returns
       null.
     · NO enlist path anywhere in the repo (`grep join.*milit|enlist` = 0).

   THE BLOCK LAW SHAPE (CLAUDE.md) — this file obeys all five:
     1. ONE-LINE ADOPTION, zero ceremony. `ranks` accepts bare strings:
          CBZ.factions.declare({ id:"cartel", name:"Sinaloa Set",
            ranks:["Mule","Runner","Sicario","Capo"], wage:120 });
        …and you have a joinable, rankable, paying organisation. Rich rank
        objects are still accepted for anything that needs per-tier gear.
     2. DEGRADE-SAFE. Every entry point is null-guarded and every migrated
        caller reads `CBZ.factions ? CBZ.factions.x() : <old inline value>`,
        so a caller that has never heard of this file still works and this
        file failing to load never breaks a consumer.
     3. THE MIGRATION IS THE JOB. Shipped with SIX real consumers migrated
        (verified by grep, not claimed):
          gangs.js       — declares the canonical RANKS table; myGangId() reads
                           factions.orgIn()          [ladder:gangs, memb:gangs]
          playergang.js  — THREE hand-typed tier arrays + MEMBER_NEED deleted
                           [ladder:playergang-member, ladder:playergang-crew]
          careers.js     — SECURITY_RANKS declared; GC_RANK_TIER (the FOURTH
                           copy of the gang order) and myCrew() migrated
                           [ladder:careers-security, memb:careers]
          promotion.js   — its dead 7-tier ladder DELETED  [ladder:promotion]
          heists.js      — crew cut routed through credit()  [memb:heists]
          militia.js     — declares the ARMY (the repo's first enlist path)
        plus city/contracts.js, which declares two more outfits and is the
        proof that a NEW faction costs a declaration and nothing else.
     4. NAMED IN CLAUDE.md (see "Engine systems — REUSE these").
     5. RATCHET. `CBZ.factionAudit()` returns the count of legacy ladder /
        membership sites NOT yet migrated. It may only go DOWN. A file that
        migrates calls `CBZ.factionMigrated("<tag>")` once — one line.
        Baseline 27 (the census universe). At the close of this wave: 19.
        Pin 19 as a fixed ceiling in tools/math-gate.mjs and ratchet down.

   NO PARALLEL BOOKKEEPING (the thing that killed proptypes.js in 24h):
   a faction that is ALREADY stored somewhere hands us a `bind` and we read
   and write THAT storage — we never mirror it. gangs.js keeps
   g.cityMembership; careers.js keeps g.citySecurityShifts; factions.js owns
   storage ONLY for organisations that had none (army, cell, agency).

   ---- WHAT A FACTION IS ----
     declare({
       id, name, short, kind, color,
       ranks: ["Recruit","Private"] | [{key,pip,tier,need,pay,weapon,hp,cut}],
       admission: { fee, standing, respect, cleanRecord, needRank:{faction,rank},
                    test(F) -> true | "why not" },
       wage,            // $ per world day while a member (real cash, via CBZ.city.addCash)
       heat,            // multiplier on REPORTED crime severity while a member
       hostileTo: [ids], friendlyTo: [ids],
       bind: { get, setRank, addCredit, addStanding },   // OPTIONAL external storage
       onJoin(F), onLeave(F), onRankUp(F, rankDef), onPay(F, amount),
     })

   ---- THE ONE QUERIES (replacing 16 hand-rolled membership reads) ----
     CBZ.factions.of(actor)                -> ["gang","army",...]
     CBZ.factions.orgOf(actor)             -> the concrete org id ("bloods")
     CBZ.factions.reactionTo(a, b)         -> -1..1, how A's factions see B
     CBZ.factions.hostile(a, b)            -> boolean
     CBZ.factionOf / CBZ.factionReactionTo — top-level aliases.

   ---- STANDING: WHAT WE MERGED, AND WHAT WE DELIBERATELY DID NOT ----
   MERGED into `CBZ.factions.standing(id)` + the per-faction credit counters
   (bodies / contrib / served / orders):
     · g.cityMembership.loyalty  (playergang.js:600) — the PLAYER's standing
       inside a joined crew. Same subject, same range, no shared code. Gone.
     · g.citySecurityShifts      (careers.js) — a bare shift counter that was
       really "served". Now `credits.served` on the "secco" faction.
     · playergang's bodies/contrib and gangs.js memStats' bodies/contrib for
       the PLAYER: one counter set, read by one promotion rule.
   KEPT SEPARATE ON PURPOSE (they are NOT the same thing):
     · memStats().loyalty (gangs.js:129)  — an NPC's loyalty to THEIR OWN
       gang. Different subject (not the player), drives defection, not rank.
     · ped.relPlayer (social.js, 5 axes)  — a per-INDIVIDUAL relationship.
       reactionTo() CONSULTS it; merging it would destroy the axes.
     · ped._loyalty (loyalty.js)          — a per-COMPANION contract, not an
       organisation. A bodyguard is loyal to YOU, not to a faction.
     · turf.js rel[] (gang-vs-gang)       — org-vs-org, ephemeral. reactionTo()
       reads it; it is the ORG graph, not the PLAYER's standing.
     · relations.js (country-vs-country)  — nation scale, persisted, -100..100.
     · approval.js rec.approval           — PUBLIC opinion of a person holding
       an office. Not membership in anything.
     · g.respect                          — the global street-cred currency.
       Deliberately kept as the cross-faction ADMISSION currency (it is what
       every faction reads about you before it reads its own standing).
     · quests.js actor.rep                — prison minigame, separate tree,
       separate currency (cigs), separate win condition.

   ---- SEAM LEFT OPEN (deliberately not half-built) ----
   Political OFFICE does not fit the rank-ladder shape (a single elected slot,
   not tiers) and elections.js mints candidates as ledger `sid`s the player
   does not have. `CBZ.factions.office.stand()` names the exact edit required
   and refuses rather than faking it. See §OFFICE below.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;
  const CFG = CBZ.CONFIG = CBZ.CONFIG || {};

  // ---- feature flags (self-defaulted here; each is a one-line revert) ----
  //   FACTION_V1        — the whole role layer. Off → declare() becomes inert,
  //                       every migrated consumer falls back to its old inline
  //                       array/field (that is what the `? :` guards are for).
  //                       Flip false (or ?cfg_FACTION_V1=0) for the exact prior
  //                       behaviour.
  //   FACTION_WAGES     — a faction with a `wage` pays the player REAL cash on
  //                       CBZ.onNewDay through CBZ.city.addCash. Off → no
  //                       salary is ever paid (memberships still work).
  //   FACTION_POLICE_REACT — police finally read faction membership. A wrap on
  //                       CBZ.cityReport scales the reported severity by the
  //                       player's faction heat multiplier (gang colours make
  //                       witnesses louder; a badge makes them quieter). Off →
  //                       cityReport is untouched, byte-for-byte.
  if (CFG.FACTION_V1 == null) CFG.FACTION_V1 = true;
  if (CFG.FACTION_WAGES == null) CFG.FACTION_WAGES = true;
  if (CFG.FACTION_POLICE_REACT == null) CFG.FACTION_POLICE_REACT = true;

  // ============================================================
  //  REGISTRY
  // ============================================================
  const DEFS = Object.create(null);
  const ORDER = [];

  function slug(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "rank";
  }
  function num(v, d) { return (v == null || !isFinite(v)) ? d : +v; }

  // A rank may be a bare string ("Sicario") or a full record. Bare strings are
  // the whole point: the cheapest possible declaration must still produce a
  // working ladder, thresholds included, or nobody adopts this.
  function normRanks(list, scale) {
    const out = [];
    const S = scale || {};
    const kBody = num(S.bodies, 2), kCash = num(S.contrib, 260), kServ = num(S.served, 90), kOrd = num(S.orders, 2);
    (list || []).forEach(function (r, i) {
      const isStr = (typeof r === "string");
      const src = isStr ? { pip: r } : (r || {});
      const pip = src.pip || src.name || src.title || ("Tier " + i);
      const key = src.key || slug(pip);
      // gangs.js's canonical table spells these needBody/needContrib. Accept BOTH
      // spellings so that table can be handed to declare() VERBATIM — a declarer
      // must never have to retype a tier list to adopt this file (that retyping
      // is the exact duplication this block exists to kill).
      const need = src.need || {
        bodies: src.needBody, contrib: src.needContrib,
        served: src.needServed, orders: src.needOrders,
      };
      out.push({
        key: key,
        pip: String(pip),
        tier: (src.tier != null ? (src.tier | 0) : i),
        idx: i,
        // auto-scaled thresholds when the declarer gave none — a bare-string
        // ladder still has a real climb instead of instant top rank.
        need: {
          bodies: num(need.bodies, i * kBody),
          contrib: num(need.contrib, i * i * kCash),
          served: num(need.served, i * kServ),
          orders: num(need.orders, i * kOrd),
          standing: num(need.standing, 0),
        },
        pay: num(src.pay, 0),          // per-job bonus this rank earns
        cut: num(src.cut, 1 + i * 0.35), // share weight (gangs.js semantics)
        hp: src.hp != null ? +src.hp : null,
        weapon: src.weapon || null,     // REAL: issued via CBZ.cityGiveWeapon
        unlock: src.unlock || null,     // free-text, shown on rank-up
        // THE VERBS THIS RUNG OPENS (§RANK IS A VERB, below). Cumulative up the
        // ladder — a Chief can still make an arrest. A rung with an empty list
        // is a vanity rung and CBZ.rankAudit() names it.
        grants: Array.isArray(src.grants) ? src.grants.slice()
          : (src.grants ? [String(src.grants)] : []),
        // how heavy this rung reads on the street (level.js's 1-100 scale). It
        // lives HERE so a ladder cannot disagree with the number over the head
        // of the person holding it. 0 = "this org does not set the read".
        lvl: src.lvl != null ? (+src.lvl | 0) : 0,
        // a LOCKED rung is never granted by merit — only by an explicit
        // promote() from the owning system (gangs.js: only succession makes a
        // Boss). Without this a zero-threshold top tier would auto-grant.
        locked: !!src.locked,
      });
    });
    return out;
  }

  function declare(def) {
    if (!CFG.FACTION_V1 || !def || !def.id) return null;
    const id = String(def.id);
    const ranks = normRanks(def.ranks, def.needScale);
    const byKey = Object.create(null);
    ranks.forEach(function (r) { byKey[r.key] = r; });
    const f = {
      id: id,
      name: def.name || id,
      short: def.short || (def.name ? String(def.name).split(" ").pop() : id),
      kind: def.kind || "org",
      color: def.color != null ? def.color : 0xb079ea,
      ranks: ranks,
      byKey: byKey,
      admission: def.admission || {},
      wage: num(def.wage, 0),
      heat: num(def.heat, 1),
      hostileTo: def.hostileTo || [],
      friendlyTo: def.friendlyTo || [],
      bind: def.bind || null,
      npcTag: def.npcTag || null,      // a ped field that marks NPC members
      // WHERE AN NPC'S RANK ALREADY LIVES. police.js keeps it in `copRank`,
      // peds.js in `milRank`, gangs.js in `rank`. Naming the field is the whole
      // adoption cost of the rank-verb layer, and it is what keeps this a
      // migration instead of parallel bookkeeping: this file never stores an
      // NPC's rank, it reads the field the world was already writing.
      rankField: def.rankField || null,
      proto: def.proto || null,        // founded-from lineage ("start your own")
      onJoin: def.onJoin || null,
      onLeave: def.onLeave || null,
      onRankUp: def.onRankUp || null,
      onPay: def.onPay || null,
      canJoinNote: def.canJoinNote || null,
      lore: def.lore || "",
    };
    DEFS[id] = f;
    if (ORDER.indexOf(id) < 0) ORDER.push(id);
    return handle(f);
  }

  function def(id) { return DEFS[id] || null; }
  function all() { return ORDER.map(function (i) { return DEFS[i]; }); }

  // ============================================================
  //  STORAGE — factions.js owns a record ONLY for organisations that had no
  //  storage before. Anything with a `bind` reads/writes ITS OWN state; we
  //  never mirror it (the parallel-bookkeeping trap).
  //
  //  THE FIELD IS `g.cityOrgs`, NOT `g.cityFactions` — and that is a bug fix,
  //  not a preference. `g.cityFactions` was ALREADY TAKEN: city/worldstate.js
  //  seeds it in fresh() as a flat standing dict ({police:0, transit:0, casino:0,
  //  political:0, military:0, extremists:-20, security:0, public:0} plus a key
  //  per gang) and RESTORES it unconditionally on every load and every MP adopt
  //  — `g.cityFactions = w.factions;` (worldstate.js:278). Every membership in
  //  the game was therefore wiped and replaced by that dict the moment the
  //  ledger was re-applied, which city/mode.js's own reset() does at :533 on
  //  every new run. Two systems, one field name, one of them destructive.
  //
  //  NOTE ON PERSISTENCE (honest status, not a claim): worldstate.js's commit()
  //  is an explicit field WHITELIST, so `g.cityOrgs` is not saved yet either —
  //  it survives a reset but not a page reload. serialize()/apply() below are
  //  the exact shape worldstate.js/netpersist.js consume from every other
  //  system (officials.js:648-683 is the template); wiring them in is two
  //  lines in a file this wave does not own. See the report.
  // ============================================================
  function store() {
    if (!g.cityOrgs || !g.cityOrgs.orgs) g.cityOrgs = { orgs: Object.create(null) };
    return g.cityOrgs;
  }
  function own(id, make) {
    const s = store();
    let r = s.orgs[id];
    if (!r && make) {
      r = s.orgs[id] = {
        id: id, member: false, owner: false, org: id, rank: null, standing: 0,
        credits: { bodies: 0, contrib: 0, served: 0, orders: 0 },
        joinedDay: -1, how: null, paidDay: -1,
      };
    }
    return r || null;
  }
  function blank(id) {
    return { id: id, member: false, owner: false, org: null, rank: null, standing: 0,
      credits: { bodies: 0, contrib: 0, served: 0, orders: 0 }, joinedDay: -1, how: null };
  }

  // the player's live membership record for a faction (or null)
  function memb(id) {
    const f = DEFS[id]; if (!f) return null;
    if (f.bind && f.bind.get) {
      let m = null;
      try { m = f.bind.get(); } catch (e) { m = null; }
      if (!m) return null;
      // normalise a bound record so every reader sees ONE shape
      return {
        id: id, member: true, owner: !!m.owner, org: m.org || m.gangId || id,
        rank: m.rank || (f.ranks[0] && f.ranks[0].key) || null,
        standing: num(m.standing, 0),
        credits: {
          bodies: num(m.bodies != null ? m.bodies : (m.credits && m.credits.bodies), 0),
          contrib: num(m.contrib != null ? m.contrib : (m.credits && m.credits.contrib), 0),
          served: num(m.served != null ? m.served : (m.credits && m.credits.served), 0),
          orders: num(m.orders != null ? m.orders : (m.credits && m.credits.orders), 0),
        },
        joinedDay: num(m.joinedDay, -1), how: m.how || null, _bound: true,
      };
    }
    const r = own(id, false);
    return (r && r.member) ? r : null;
  }

  // ============================================================
  //  RANKS — THE single source of tier order. The three hand-typed literal
  //  arrays in playergang.js and the one in careers.js all read this.
  // ============================================================
  function ladder(id) { const f = DEFS[id]; return f ? f.ranks.slice() : []; }
  function ladderKeys(id) { const f = DEFS[id]; return f ? f.ranks.map(function (r) { return r.key; }) : []; }
  function rankDef(id, key) {
    const f = DEFS[id]; if (!f) return null;
    return f.byKey[key] || f.ranks[0] || null;
  }
  function rankName(id, key) { const r = rankDef(id, key); return r ? r.pip : "Crew"; }
  function rankTier(id, key) { const r = rankDef(id, key); return r ? r.tier : 0; }
  function nextRank(id, key) {
    const f = DEFS[id]; if (!f) return null;
    const cur = f.byKey[key];
    return f.ranks[(cur ? cur.idx : -1) + 1] || null;
  }
  function playerRank(id) { const m = memb(id); return m ? m.rank : null; }
  function playerTier(id) { const m = memb(id); return m ? rankTier(id, m.rank) : -1; }
  function rankLvl(id, key) { const r = rankDef(id, key); return r ? (r.lvl | 0) : 0; }

  // ============================================================
  //  §RANK IS A VERB
  //
  //  CLAUDE.md, verbatim: "Every rung must unlock a VERB, not just a bigger
  //  number — a rank that only raises a payout is a vanity XP bar."
  //
  //  That law shipped with no ANSWER FUNCTION. contracts.js enforces it for the
  //  PLAYER by gating job templates on `minRank`, but nothing could answer it
  //  for an NPC — which is exactly why `police.js` ran a whole force off ONE
  //  boolean (`swat`) and `level.js`'s eight military rungs were pure display.
  //  Two questions were missing, and they are the whole of this block:
  //
  //      CBZ.rankCan(actor, org, verb)    — may THIS person do this?
  //      CBZ.rankHolder(org, verb)        — is there ANYBODY who may?
  //
  //  The second is the one that gives an org a shape: a roadblock is an ORDER,
  //  and an order needs somebody alive to give it. Kill every sergeant and the
  //  walls stop going up — not because a counter fell, because nobody left can
  //  authorise one.
  //
  //  BLOCK LAW COMPLIANCE:
  //   1. ONE-LINE ADOPTION — a declaration writes `grants:["roadblock"]` on the
  //      rung that opens it and `rankField:"copRank"` once for the org. Every
  //      caller then REPLACES its own hardcoded test with one call.
  //   2. DEGRADE-SAFE — and the guard is `CBZ.rankKnows(org, verb)`, NOT a bare
  //      null check on rankCan. rankCan answers FALSE for an org that was never
  //      declared, which is correct as an answer and catastrophic as a gate: a
  //      caller written `if (!rankCan(…)) return` would CLOSE every order in the
  //      game the moment FACTION_V1 was flipped off. `rankKnows` asks "does the
  //      ladder even have this verb", so a revert removes the gate instead of
  //      slamming it.
  //   3. THREE REAL CONSUMERS, same change: police.js (six rungs, five gated
  //      orders), militia.js/peds.js (the army chain of command), careers.js
  //      (the guard ladder), plus level.js's cover reveal.
  //   5. RATCHET — CBZ.rankAudit(), below. `emptyRanks` and `verblessRungs`
  //      may only ever go DOWN.
  // ============================================================

  // an NPC's rank key, read out of the field the world already keeps it in
  function npcRankKey(actor, id) {
    const f = DEFS[id];
    if (!f || !actor || !f.rankField) return null;
    const k = actor[f.rankField];
    return (k && f.byKey[k]) ? k : null;
  }
  // is this NPC one of theirs AT ALL? Two independent proofs, either is enough:
  // the org's declared marker field, or a rank key from its own ladder.
  function npcInOrg(actor, id) {
    const f = DEFS[id];
    if (!f || !actor) return false;
    if (f.npcTag && actor[f.npcTag.field] === (f.npcTag.value != null ? f.npcTag.value : f.id)) return true;
    return !!npcRankKey(actor, id);
  }
  // THE tier read for ANY subject. Player -> the membership record (never
  // re-derive g.playerGang); NPC -> the field the world already wrote.
  // -1 means "not one of theirs" and is the only falsy answer callers need.
  function tierOf(actor, id) {
    if (!DEFS[id]) return -1;
    if (isPlayer(actor)) return playerTier(id);
    if (!npcInOrg(actor, id)) return -1;
    const k = npcRankKey(actor, id);
    // a marked member with no rank stamped is at the BOTTOM rung, not outside
    // the org — that is what lets police.js leave `copRank` unset on a plain
    // beat officer instead of stamping a word on every body.
    return k ? rankTier(id, k) : (DEFS[id].ranks[0] ? DEFS[id].ranks[0].tier : 0);
  }
  // every verb open at (or below) a rung — cumulative, because seniority never
  // takes a verb away.
  function grantsFor(id, key) {
    const f = DEFS[id]; if (!f) return [];
    const cur = f.byKey[key];
    const top = cur ? cur.idx : -1;
    const out = [];
    for (let i = 0; i <= top && i < f.ranks.length; i++) {
      const gs = f.ranks[i].grants;
      for (let k = 0; k < gs.length; k++) if (out.indexOf(gs[k]) < 0) out.push(gs[k]);
    }
    return out;
  }
  // the LOWEST rung that opens `verb`, or -1 if this outfit never opens it.
  // Everything else here is derived from this one lookup, so a verb and the
  // rung that grants it can never drift apart.
  function verbTier(id, verb) {
    const f = DEFS[id]; if (!f || !verb) return -1;
    for (let i = 0; i < f.ranks.length; i++) if (f.ranks[i].grants.indexOf(verb) >= 0) return f.ranks[i].tier;
    return -1;
  }
  function rankCan(actor, id, verb) {
    if (!CFG.FACTION_V1) return false;
    const need = verbTier(id, verb);
    if (need < 0) return false;                 // this outfit has no such verb
    return tierOf(actor, id) >= need;
  }

  // IS THERE ANYBODY WHO MAY? One throttled scan per (org, verb) — the answer
  // only has to be as fresh as a dispatch beat, and every caller in the repo
  // asks it on a >=1 s tick. `opts.pool` lets an org that knows where its
  // people live (police -> CBZ.cityCops) skip the crowd entirely.
  const _holderCache = Object.create(null);
  const HOLDER_TTL = 900;                        // ms
  function rankHolder(id, verb, opts) {
    if (!CFG.FACTION_V1 || !DEFS[id]) return null;
    const need = verbTier(id, verb);
    if (need < 0) return null;
    const now = (CBZ.now || 0);
    const ck = id + "|" + verb;
    const hit = _holderCache[ck];
    if (hit && !(opts && opts.fresh) && (now - hit.t) < HOLDER_TTL) {
      const a = hit.a;
      // a cached YES is only good while that person is still alive and still
      // holds the rung — a cached NO expires on the clock like everything else.
      if (a && !a.dead && tierOf(a, id) >= need) return a;
      if (!a) return null;
    }
    const pools = (opts && opts.pool) ? [opts.pool] : [CBZ.cityCops, CBZ.cityPeds];
    let found = null;
    for (let q = 0; q < pools.length && !found; q++) {
      const arr = pools[q]; if (!arr) continue;
      for (let i = 0; i < arr.length; i++) {
        const a = arr[i];
        if (!a || a.dead || a._parked || a.isPlayer) continue;
        if (tierOf(a, id) >= need) { found = a; break; }
      }
    }
    _holderCache[ck] = { a: found, t: now };
    return found;
  }

  // ============================================================
  //  CBZ.rankAudit() — THE RATCHET (BLOCK LAW #5)
  //
  //  Per org: rungs DECLARED, rungs HELD by somebody alive, rungs that open a
  //  VERB. The two lists are the ratchets and both may only ever go DOWN:
  //
  //    emptyRanks     — a declared rung nobody in the world holds. That is the
  //                     stat-fiction ban applied to ladders (a rank that names
  //                     a person who does not exist). Player-only ladders
  //                     (agency, cell, secco) are excluded by construction:
  //                     they declare neither `rankField` nor `npcTag`, so the
  //                     world was never supposed to cast them.
  //    verblessRungs  — a declared rung that opens nothing: no granted verb, no
  //                     issued weapon, no named unlock, and no contracts.js
  //                     template gated at its tier. That is the vanity XP bar,
  //                     counted.
  //
  //  Read entirely off LIVE data (the declared ladders, the ped fields the
  //  world writes, contracts.js's own live templates), so it can never claim a
  //  rung is covered when the gate is not actually there.
  // ============================================================
  CBZ.rankAudit = function () {
    const out = { orgs: Object.create(null), rungs: 0, held: 0, verbed: 0,
                  emptyRanks: [], verblessRungs: [] };
    // ONE pass over the world, bucketed by org — never one pass per org.
    const holders = Object.create(null);
    const pools = [CBZ.cityCops, CBZ.cityPeds];
    for (let q = 0; q < pools.length; q++) {
      const arr = pools[q]; if (!arr) continue;
      for (let i = 0; i < arr.length; i++) {
        const a = arr[i];
        if (!a || a.dead || a._parked || a.isPlayer) continue;
        for (let k = 0; k < ORDER.length; k++) {
          const id = ORDER[k], f = DEFS[id];
          if (!f.rankField && !f.npcTag) continue;
          if (!npcInOrg(a, id)) continue;
          const key = npcRankKey(a, id) || (f.ranks[0] ? f.ranks[0].key : null);
          if (!key) continue;
          const b = holders[id] || (holders[id] = Object.create(null));
          b[key] = (b[key] | 0) + 1;
        }
      }
    }
    for (let k = 0; k < ORDER.length; k++) {
      const id = ORDER[k], f = DEFS[id];
      const b = holders[id] || Object.create(null);
      const pr = playerRank(id);
      if (pr) b[pr] = (b[pr] | 0) + 1;           // you count as a holder too
      const street = !!(f.rankField || f.npcTag);
      const rec = { name: f.name, declared: f.ranks.length, held: 0, verbed: 0,
                    street: street, byRank: b, empty: [], verbless: [] };
      // contracts.js gates PLAYER jobs on `minRank`; a rung that opens one of
      // those is covered even though this file never saw the template. Read
      // live, guard-called — no second table.
      let ext = null;
      if (CBZ.cityOrders && CBZ.cityOrders.unlocks) {
        try { ext = CBZ.cityOrders.unlocks(id) || null; } catch (e) { ext = null; }
      }
      for (let i = 0; i < f.ranks.length; i++) {
        const r = f.ranks[i];
        out.rungs++;
        if (b[r.key]) { rec.held++; out.held++; }
        else if (street) { rec.empty.push(r.key); out.emptyRanks.push(id + ":" + r.key); }
        let verb = r.grants.length > 0 || !!r.weapon || !!r.unlock;
        if (!verb && ext) for (let e = 0; e < ext.length; e++) if ((ext[e].tier | 0) === r.tier) { verb = true; break; }
        if (verb) { rec.verbed++; out.verbed++; }
        else { rec.verbless.push(r.key); out.verblessRungs.push(id + ":" + r.key); }
      }
      out.orgs[id] = rec;
    }
    return out;
  };

  // ============================================================
  //  ADMISSION — reputation, a fee, a sponsor, a mission, a rank elsewhere.
  //  Returns { ok, why }. Never throws, never half-applies.
  // ============================================================
  function canJoin(id) {
    const f = DEFS[id];
    if (!f) return { ok: false, why: "No such outfit." };
    if (memb(id)) return { ok: false, why: "You already ride with them." };
    const A = f.admission || {};
    if (A.needRank && A.needRank.faction) {
      const t = playerTier(A.needRank.faction);
      const want = rankTier(A.needRank.faction, A.needRank.rank);
      if (t < 0) return { ok: false, why: "They only take " + (def(A.needRank.faction) || { name: A.needRank.faction }).name + " people." };
      if (t < want) return { ok: false, why: "You need " + rankName(A.needRank.faction, A.needRank.rank) + " first." };
    }
    if (A.respect != null && (g.respect || 0) < A.respect) {
      return { ok: false, why: "They've never heard of you. (" + Math.round(g.respect || 0) + "/" + A.respect + " respect)" };
    }
    if (A.notoriety != null) {
      const n = (CBZ.cityNotoriety ? (CBZ.cityNotoriety().xp || 0) : (g.cityNotoriety || 0));
      if (n < A.notoriety) return { ok: false, why: "Not enough on your record for them to trust you." };
    }
    if (A.standing != null && standing(id) < A.standing) return { ok: false, why: "You haven't earned their trust yet." };
    if (A.cleanRecord && (g.wanted | 0) > 0) return { ok: false, why: "Not while you're wanted." };
    if (A.sponsor && typeof A.sponsor === "function") {
      let s = true; try { s = A.sponsor(api); } catch (e) { s = true; }
      if (s !== true) return { ok: false, why: (typeof s === "string" ? s : "You need someone to vouch for you.") };
    }
    if (A.mission && !missionDone(A.mission)) return { ok: false, why: "Finish the job they set you first." };
    if (A.fee != null && A.fee > 0 && !(CBZ.city && CBZ.city.canAfford && CBZ.city.canAfford(A.fee))) {
      return { ok: false, why: "Costs $" + A.fee.toLocaleString() + " to get in." };
    }
    if (A.test && typeof A.test === "function") {
      let t = true; try { t = A.test(api); } catch (e) { t = true; }
      if (t !== true) return { ok: false, why: (typeof t === "string" ? t : "They turned you down.") };
    }
    return { ok: true, why: "" };
  }

  // a faction may gate admission on a completed job — "finish the tryout and
  // you're in". core/mission.js reports completions here through
  // onMissionComplete() below, so a contract really is an admission ticket.
  function missionDone(tag) {
    const done = g.cityFactionMissions || (g.cityFactionMissions = Object.create(null));
    return !!done[tag];
  }
  function markMissionDone(tag) {
    if (!tag) return;
    const done = g.cityFactionMissions || (g.cityFactionMissions = Object.create(null));
    done[tag] = true;
  }

  // ============================================================
  //  JOIN / LEAVE / EXPEL
  // ============================================================
  // ============================================================
  //  THE ALLEGIANCE FORK — "you cannot be Bureau and Cause"
  //
  //  Three things were wrong with doing this as a wrapper on join():
  //    (a) it was ONE-WAY. Enlisting expelled you from your gang, but joining
  //        a gang never fired anything, because playergang.js's patchIn()
  //        writes g.cityMembership DIRECTLY (:602) and never calls join().
  //    (b) found() calls the module-local join(), which a wrapper on the
  //        PUBLIC api.join can never see — starting your own outfit skipped
  //        the fork entirely.
  //    (c) it fired with NO WARNING. You pressed [E] at a recruiting desk and
  //        silently lost the crew you had spent an hour earning.
  //  So the fork lives HERE, as a state DIFF over membership rather than a hook
  //  on one code path: every way a membership can appear — join(), found(),
  //  a foreign write to a bound store — is caught by the same three lines. And
  //  the cost is quoted BEFORE it is charged: a join that would burn a bridge
  //  refuses once, says what it will cost, and commits on a second ask.
  // ============================================================
  const CONFIRM_MS = 9000;              // how long "ask again" stays open
  let pendingJoin = null;               // { id, t }
  const lastMemb = Object.create(null);
  let primed = false;

  // what joining `id` would COST you right now — the memberships it ends and
  // the outfits whose door it closes. Read off hostileTo, never a second table.
  function breaks(id) {
    const f = DEFS[id]; const out = [];
    if (!f) return out;
    for (let i = 0; i < f.hostileTo.length; i++) {
      const o = f.hostileTo[i], d = DEFS[o];
      if (!d) continue;
      out.push({ id: o, name: d.name, short: d.short, member: !!memb(o) });
    }
    return out;
  }
  function burns(id) { return breaks(id).filter(function (b) { return b.member; }); }

  // the consequence, applied once, whenever a membership first appears
  function applyFork(id) {
    const f = DEFS[id]; if (!f) return;
    for (let i = 0; i < f.hostileTo.length; i++) {
      const other = f.hostileTo[i];
      if (!DEFS[other] || other === id) continue;
      addStanding(other, -0.5);
      if (memb(other)) {
        expel(other, "You picked a side. " + (DEFS[other].short || DEFS[other].name) + " is done with you.");
        lastMemb[other] = !!memb(other);
      }
    }
  }

  // ONE state diff. Runs on the upkeep tick, so a membership written by ANY
  // file (playergang.js, careers.js, a save restore) forks exactly once.
  function allegianceScan() {
    if (!CFG.FACTION_V1) return;
    const quiet = !primed;              // first pass only records the world as-is
    primed = true;
    for (let i = 0; i < ORDER.length; i++) {
      const id = ORDER[i];
      const now = !!memb(id);
      const was = !!lastMemb[id];
      lastMemb[id] = now;
      if (now && !was && !quiet) applyFork(id);
    }
  }

  function join(id, how, opts) {
    const f = DEFS[id]; if (!f) return false;
    opts = opts || {};
    if (!opts.force) {
      const c = canJoin(id);
      if (!c.ok) { fnote(f, c.why, 2.4); return false; }
      // QUOTE THE COST FIRST. One refusal, one plain sentence, then it commits
      // if you ask again inside CONFIRM_MS. No modal, no new panel — the same
      // note line every other refusal uses (HUD doctrine).
      const cost = burns(id);
      if (cost.length && !opts.confirmed) {
        const nowT = Date.now();
        const held = pendingJoin && pendingJoin.id === id && (nowT - pendingJoin.t) < CONFIRM_MS;
        if (!held) {
          pendingJoin = { id: id, t: nowT };
          fnote(f, "Signing with the " + f.name + " ends you with "
            + cost.map(function (b) { return b.name; }).join(" and ")
            + ". Ask again to go through with it.", 4.2);
          return false;
        }
      }
    }
    pendingJoin = null;
    const A = f.admission || {};
    if (A.fee > 0 && !opts.force) {
      if (!(CBZ.city && CBZ.city.spend && CBZ.city.spend(A.fee))) { fnote(f, "You can't cover the buy-in.", 2); return false; }
    }
    if (f.bind && f.bind.join) { try { f.bind.join(how || "walk-in"); } catch (e) {} }
    else {
      const r = own(id, true);
      r.member = true; r.org = opts.org || id;
      r.rank = opts.rank || (f.ranks[0] ? f.ranks[0].key : "member");
      r.standing = num(opts.standing, 0.25);
      r.joinedDay = CBZ.dayCount ? CBZ.dayCount() : 0;
      r.how = how || "walk-in";
      r.owner = !!opts.owner;
      r.paidDay = r.joinedDay;
    }
    // DO NOT WRITE g.career HERE. It is careers.js's field, a single legacy
    // slot holding one of "security"|"dealer"|"pimp"|"entrepreneur"
    // (careers.js:679,715,849,1124) plus playergang.js's "gangster". This file
    // used to stamp its own `kind` into it ("military"/"agency"/"cell"), which
    // is (a) exactly the parallel bookkeeping this file's own header forbids
    // and (b) a live regression: careers.js starts the drug career with
    // `if (!g.career) g.career = "dealer"` (:715) and then refuses every deal
    // with "Start dealing first" (:849) — so enlisting in the army silently
    // made it impossible to ever start dealing. Membership lives in
    // g.cityOrgs (or the owning file's own record via `bind`); nothing
    // else needs to know.
    // the fork, applied on the spot rather than a frame later — and recorded,
    // so the scan does not fire it a second time.
    lastMemb[id] = !!memb(id);
    applyFork(id);
    if (f.onJoin) { try { f.onJoin(api, f); } catch (e) {} }
    big("JOINED · " + String(f.name).toUpperCase());
    fnote(f, "You're a " + rankName(id, playerRank(id)) + " in the " + f.name + ".", 3.2);
    if (CBZ.cityRankEvent) CBZ.cityRankEvent("faction-joined", { faction: id, how: how });
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  }

  function leave(id, why) {
    const f = DEFS[id]; if (!f) return false;
    if (!memb(id)) return false;
    if (f.bind && f.bind.leave) { try { f.bind.leave(why || "quit"); } catch (e) {} }
    else { const r = own(id, false); if (r) { r.member = false; r.rank = null; r.owner = false; } }
    if (f.onLeave) { try { f.onLeave(api, f, why || "quit"); } catch (e) {} }
    fnote(f, "You walked away from the " + f.name + ".", 2.6);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  }

  // thrown out — the faction's decision, not yours. Standing goes hard negative
  // so walking back in is not a free re-join.
  function expel(id, why) {
    const f = DEFS[id]; if (!f || !memb(id)) return false;
    leave(id, "expelled");
    const r = own(id, true); r.standing = -1;
    big("EXPELLED · " + String(f.name).toUpperCase());
    fnote(f, why || "They cut you loose.", 3);
    return true;
  }

  // ============================================================
  //  STANDING + CREDITS — the merged scalar (see the header for what we did
  //  NOT merge and why).
  // ============================================================
  function standing(id) {
    const m = memb(id);
    if (m) return m.standing;
    const r = own(id, false);
    return r ? r.standing : 0;
  }
  function addStanding(id, amt) {
    const f = DEFS[id]; if (!f) return 0;
    const v = num(amt, 0);
    if (f.bind && f.bind.addStanding) { try { f.bind.addStanding(v); } catch (e) {} return standing(id); }
    const r = own(id, true);
    r.standing = Math.max(-1, Math.min(2, r.standing + v));
    return r.standing;
  }

  // credit work toward the ladder. kind: "bodies" | "contrib" | "served" |
  // "orders". This is the ONE call every mission/contract/shift path makes.
  function credit(id, kind, amount) {
    const f = DEFS[id]; if (!f) return false;
    const m = memb(id); if (!m) return false;
    const amt = num(amount, 1);
    if (f.bind && f.bind.addCredit) { try { f.bind.addCredit(kind, amt); } catch (e) {} }
    else {
      const r = own(id, true);
      if (!r.credits) r.credits = { bodies: 0, contrib: 0, served: 0, orders: 0 };
      if (r.credits[kind] == null) r.credits[kind] = 0;
      r.credits[kind] += amt;
    }
    if (kind !== "served") addStanding(id, 0.02);
    return tryPromote(id);
  }

  function eligible(id) {
    const f = DEFS[id]; if (!f) return null;
    const m = memb(id); if (!m) return null;
    const nx = nextRank(id, m.rank); if (!nx || nx.locked) return null;
    const c = m.credits, n = nx.need;
    if (c.bodies < n.bodies) return null;
    if (c.contrib < n.contrib) return null;
    if (c.served < n.served) return null;
    if (c.orders < n.orders) return null;
    if (m.standing < n.standing) return null;
    return nx;
  }

  // CHAINS. Credits do not arrive one rung at a time — a contract can pay a
  // fortnight of seniority and four orders at once, and a player who has
  // earned three rungs must not sit two below their own record until the next
  // tick happens to nudge them. Bounded by the ladder length so a
  // zero-threshold table can never spin.
  function tryPromote(id) {
    const f = DEFS[id]; if (!f) return false;
    let moved = false;
    for (let guard = f.ranks.length; guard > 0; guard--) {
      const nx = eligible(id);
      if (!nx || !promote(id, nx.key)) break;
      moved = true;
    }
    return moved;
  }

  function promote(id, toKey) {
    const f = DEFS[id]; if (!f) return false;
    const m = memb(id); if (!m) return false;
    const cur = rankDef(id, m.rank), nx = rankDef(id, toKey);
    if (!nx || !cur || nx.idx <= cur.idx) return false;
    if (f.bind && f.bind.setRank) { try { f.bind.setRank(nx.key); } catch (e) {} }
    else { const r = own(id, true); r.rank = nx.key; }
    addStanding(id, 0.12);          // a promotion buys standing (gangs.js's rule)
    // REAL unlock, never a stat fiction: the issued weapon actually enters the
    // player's inventory through the same call the gun store uses.
    if (nx.weapon && CBZ.cityGiveWeapon) { try { CBZ.cityGiveWeapon(nx.weapon); } catch (e) {} }
    if (f.onRankUp) { try { f.onRankUp(api, nx, f); } catch (e) {} }
    big("⬆ " + String(nx.pip).toUpperCase() + " · " + f.short);
    fnote(f, f.name + " bumped you to " + nx.pip + "."
      + (nx.weapon ? " Issued: " + nx.weapon + "." : "")
      + (nx.unlock ? " " + nx.unlock : ""), 3.2);
    if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(6);
    if (CBZ.cityRankEvent) CBZ.cityRankEvent("faction-rankup", { faction: id, rank: nx.key });
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  }

  // ============================================================
  //  PAY — routed through the EXISTING wallet. There is no second economy
  //  here: CBZ.city.addCash is the same call packages.js's ctx.wallet.give
  //  and every shop/gig payout uses.
  // ============================================================
  function pay(id, amount, why) {
    const f = DEFS[id];
    let amt = Math.max(0, Math.round(num(amount, 0)));
    if (!amt) return 0;
    if (f) {
      const r = rankDef(id, playerRank(id));
      if (r) amt = Math.round(amt * (r.cut || 1));   // rank scales your cut
    }
    if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(amt);
    else g.cash = Math.max(0, (g.cash || 0) + amt);
    if (f && f.onPay) { try { f.onPay(api, amt); } catch (e) {} }
    if (CBZ.cityFeed) CBZ.cityFeed((why || (f ? f.short + " pay" : "Pay")) + " +$" + amt.toLocaleString(), "#ffd166");
    return amt;
  }

  // a faction takes its cut / dues out of you (the mirror of pay)
  function charge(id, amount, why) {
    const amt = Math.max(0, Math.round(num(amount, 0)));
    if (!amt) return false;
    const ok = !!(CBZ.city && CBZ.city.spend && CBZ.city.spend(amt));
    if (ok && why && CBZ.cityFeed) CBZ.cityFeed(why + " −$" + amt.toLocaleString(), "#e8dcc0");
    if (ok) credit(id, "contrib", amt);
    return ok;
  }

  // ============================================================
  //  THE MISSION SEAM — core/mission.js calls EXACTLY these three names on
  //  whatever CBZ.factions happens to be loaded (see its header, "FACTION
  //  SEAM"). This is the join between "who you are" and "what they pay you
  //  to do": a job finished for an outfit credits an ORDER on its ladder,
  //  moves standing, and is what actually promotes you. No mission system
  //  needs to know a ladder exists — it just finishes, and the role layer
  //  turns that into rank.
  //
  //  Nothing here is required for a mission to work: mission.js feature-
  //  detects every one, so the mission block ships standalone and this file
  //  ships standalone. Loading both is what makes rank mean something.
  // ============================================================

  // rank scales your take (gangs.js's `cut` semantics, one table).
  function payMul(id) {
    if (!CFG.FACTION_V1) return 1;
    const m = memb(id); if (!m) return 1;
    const r = rankDef(id, m.rank);
    return r ? Math.max(0.25, r.cut || 1) : 1;
  }

  // a finished job = one ORDER carried out. This is the promotion currency
  // for every faction whose ladder is `orders`-gated (army, cell, agency);
  // gangs additionally count bodies/contrib through cityMemberPutInWork.
  function onMissionComplete(id, info) {
    if (!CFG.FACTION_V1 || !DEFS[id] || !memb(id)) return;
    info = info || {};
    credit(id, "orders", 1);
    if (info.cash > 0) credit(id, "contrib", Math.round(info.cash * 0.15));
    addStanding(id, 0.06);
    if (info.id) markMissionDone(String(info.id));
  }

  // a botched job costs standing — and enough botched jobs get you cut loose.
  // EXPULSION_STANDING is the one number that makes allegiance have teeth:
  // an outfit you keep failing stops being your outfit.
  const EXPEL_AT = -0.55;
  function onMissionFail(id, info) {
    if (!CFG.FACTION_V1 || !DEFS[id] || !memb(id)) return;
    const why = (info && info.why) || "the job";
    // dying on the job is bad luck, not betrayal — half the sting.
    const bite = /went down|busted/.test(String(why)) ? -0.08 : -0.16;
    const s = addStanding(id, bite);
    const f = DEFS[id];
    if (s <= EXPEL_AT && !f.bind) expel(id, "You've cost them too much.");
    else fnote(f, (f.short || f.name) + " noted it. Standing down.", 2);
  }

  // ============================================================
  //  "START YOUR OWN" — generalised from playergang.js's found-a-gang, which
  //  is the only place in the repo that already did this. A founded outfit is
  //  a real declared faction cloning its proto's ladder, with you at the top.
  // ============================================================
  function found(opts) {
    opts = opts || {};
    const proto = DEFS[opts.from] || null;
    const id = opts.id || ("own-" + slug(opts.name || "outfit"));
    const h = declare({
      id: id,
      name: opts.name || "Your Outfit",
      short: opts.short || null,
      kind: opts.kind || (proto ? proto.kind : "org"),
      color: opts.color != null ? opts.color : (proto ? proto.color : 0xffd166),
      ranks: (opts.ranks || (proto ? proto.ranks : ["Member", "Lieutenant", "Boss"])),
      wage: 0,
      heat: opts.heat != null ? opts.heat : (proto ? proto.heat : 1),
      hostileTo: opts.hostileTo || (proto ? proto.hostileTo : []),
      proto: opts.from || null,
      admission: {},
    });
    if (!h) return null;
    const f = DEFS[id];
    const top = f.ranks[f.ranks.length - 1];
    join(id, "founded", { force: true, owner: true, rank: top ? top.key : null, org: opts.org || id, standing: 1 });
    return h;
  }

  // ============================================================
  //  CROSS-FACTION REACTION — THE ONE QUERY. Replaces `g.playerGang` reads,
  //  4 reimplemented myGangId() helpers, and gives police the membership check
  //  they have never once made.
  // ============================================================
  function isPlayer(a) { return !a || a === CBZ.player || a === g || a === "player"; }

  // every faction id `actor` belongs to
  function of(actor) {
    const out = [];
    if (isPlayer(actor)) {
      for (let i = 0; i < ORDER.length; i++) if (memb(ORDER[i])) out.push(ORDER[i]);
      return out;
    }
    // an NPC: a faction may declare the ped field that marks its members
    for (let i = 0; i < ORDER.length; i++) {
      const f = DEFS[ORDER[i]];
      if (f.npcTag && actor[f.npcTag.field] === (f.npcTag.value != null ? f.npcTag.value : f.id)) out.push(f.id);
    }
    if (actor.gang && out.indexOf("gang") < 0) out.push("gang");
    return out;
  }

  // the CONCRETE organisation (which gang, which militia), not the archetype
  function orgOf(actor) {
    if (isPlayer(actor)) {
      for (let i = 0; i < ORDER.length; i++) {
        const m = memb(ORDER[i]);
        if (m && m.org) return m.org;
      }
      return null;
    }
    return actor.gang || actor.organization || null;
  }

  // -1 (shoot on sight) .. +1 (family). Consults, never replaces, the finer
  // scalars: turf.js's org graph and social.js's per-individual bond.
  function reactionTo(a, b) {
    if (!a || !b) return 0;
    const fa = of(a), fb = of(b);
    if (!fa.length && !fb.length) return 0;
    let v = 0;
    // same concrete organisation = family, regardless of archetype
    const oa = orgOf(a), ob = orgOf(b);
    if (oa && ob) {
      if (oa === ob) return 1;
      if (CBZ.cityAreAllied && CBZ.cityAreAllied(oa, ob)) v += 0.5;
      if (CBZ.cityAtWar && CBZ.cityAtWar(oa, ob)) v -= 0.9;
    }
    for (let i = 0; i < fa.length; i++) {
      const f = DEFS[fa[i]]; if (!f) continue;
      for (let j = 0; j < fb.length; j++) {
        if (f.hostileTo.indexOf(fb[j]) >= 0) v -= 0.8;
        else if (f.friendlyTo.indexOf(fb[j]) >= 0) v += 0.5;
        else if (fa[i] === fb[j]) v += 0.6;
      }
    }
    // per-individual history still has the last word within +-0.35
    if (CBZ.cityBond && !isPlayer(b) && isPlayer(a)) {
      const bond = +CBZ.cityBond(b) || 0;
      v += Math.max(-0.35, Math.min(0.35, bond * 0.2));
    }
    return Math.max(-1, Math.min(1, v));
  }
  function hostile(a, b) { return reactionTo(a, b) <= -0.34; }

  // ============================================================
  //  POLICE REACT — the census found police check gang membership ZERO times.
  //  We do not edit police.js (frozen this wave): we wrap the ONE funnel every
  //  star in the game passes through, CBZ.cityReport, and scale the reported
  //  severity by the player's memberships. Wearing colours makes witnesses
  //  louder; carrying a badge makes them quieter. One wrap, ever (the
  //  module-local boolean pattern relations.js documents at :485).
  // ============================================================
  function heatMul() {
    if (!CFG.FACTION_V1) return 1;
    let m = 1;
    for (let i = 0; i < ORDER.length; i++) {
      const f = DEFS[ORDER[i]];
      if (f && f.heat !== 1 && memb(ORDER[i])) m *= f.heat;
    }
    return Math.max(0.25, Math.min(3, m));
  }
  let _reportWrapped = false;
  function wrapReport() {
    if (_reportWrapped || !CFG.FACTION_POLICE_REACT) return;
    const orig = CBZ.cityReport;
    if (typeof orig !== "function" || orig._fxWrapped) return;
    const w = function (sev, opts) {
      let s = sev;
      try { if (CFG.FACTION_V1) s = Math.max(1, (+sev || 1) * heatMul()); } catch (e) { s = sev; }
      return orig.call(this, s, opts);
    };
    w._fxWrapped = true;
    // preserve any marker a previous wrapper stamped (the explosion-wrapper law)
    for (const k in orig) { if (/Wrapped$/.test(k)) w[k] = orig[k]; }
    CBZ.cityReport = w;
    _reportWrapped = true;
  }

  // ============================================================
  //  OFFICE — THE SEAM, LEFT OPEN ON PURPOSE.
  //  elections.js simulates a full race (mintCandidate/scoreCandidate/tally)
  //  but every candidate is a ledger `sid` minted from mintIdentity — the
  //  player has no sid, and `officials.js` only ever writes office.holder from
  //  a candidate record. Standing for office is therefore NOT a rank ladder
  //  and NOT something this file can fake without inventing a parallel
  //  election. We name the exact edit and refuse.
  // ============================================================
  const office = {
    available: function () { return !!(CBZ.elections && CBZ.elections.playerCandidacy); },
    stand: function () {
      if (CBZ.elections && CBZ.elections.playerCandidacy) return CBZ.elections.playerCandidacy();
      return {
        ok: false,
        reason: "elections.js has no player candidacy path.",
        seam: "elections.js:callElection() builds candidates from mintCandidate() -> {sid,...}. "
          + "A player run needs (a) a candidate record flagged {player:true} with no sid, "
          + "(b) nameOf()/scoreCandidate()/tally() branches that read CBZ.player instead of the ledger, "
          + "and (c) officials.js:swearIn() accepting a player holder. "
          + "CBZ.factions.office.stand() will use CBZ.elections.playerCandidacy() the moment it exists.",
      };
    },
  };

  // ============================================================
  //  UPKEEP TICK — seniority accrues, promotions fire, wages land.
  // ============================================================
  let servedT = 0;
  // AFTER gangs.js, never ON it. PRIO.GANGS (34.6) is city/gangs.js's own
  // per-gang tick; registering at the bare constant put two unrelated systems
  // on one slot, so the order between them was insertion-order luck. We read
  // membership that gangs.js/playergang.js may have just written this frame,
  // so we must run strictly after it.
  if (typeof CBZ.onUpdate === "function") CBZ.onUpdate(CBZ.PRIO ? CBZ.PRIO.after(CBZ.PRIO.GANGS, 8) : 34.68, function (dt) {
    if (!CFG.FACTION_V1) return;
    if (g.mode !== "city" || !CBZ.player) return;
    wrapReport();
    wireDayTick();                      // polity.js parses long after us — retry
    servedT += dt;
    if (servedT < 1) return;
    const secs = servedT; servedT = 0;
    // ONCE A SECOND, not once a frame. memb() rebuilds a normalised record for
    // every BOUND faction on every call (gangs.js's bind.get() allocates), so
    // scanning every frame churned ~6 objects × 60fps for a diff that only has
    // to catch a membership some OTHER file wrote. join() applies the fork on
    // the spot; this is the safety net, and a net one second late is invisible.
    allegianceScan();
    for (let i = 0; i < ORDER.length; i++) {
      const id = ORDER[i];
      const m = memb(id); if (!m) continue;
      credit(id, "served", secs);       // seniority is time in the outfit
    }
  });

  // daily salary — REAL cash, on the world day tick every other economy
  // system already subscribes to.
  //
  // LOAD-ORDER TRAP (found in review): `CBZ.onNewDay` is DEFINED by
  // city/polity.js (:419), which loads at index.html:925 — 274 tags AFTER this
  // file (:651). A bare `if (CBZ.onNewDay)` at parse time is therefore always
  // false here, and every faction wage in the game silently never paid. The
  // sim/*.js family already hit this and solved it with a `_dayTickRegistered`
  // retry (sim/inflation.js:563, centralbank.js:533, bonds.js:713); we copy
  // that exact shape and retry from the upkeep tick until polity.js exists.
  function payday(day) {
    if (!CFG.FACTION_V1 || !CFG.FACTION_WAGES) return;
    for (let i = 0; i < ORDER.length; i++) {
      const id = ORDER[i], f = DEFS[id];
      if (!f || !f.wage) continue;
      const m = memb(id); if (!m) continue;
      const r = rankDef(id, m.rank);
      const amt = Math.round(f.wage * (r ? r.cut : 1));
      if (amt > 0) {
        if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(amt);
        if (CBZ.cityFeed) CBZ.cityFeed(f.short + " payroll +$" + amt.toLocaleString(), "#ffd166");
      }
      void day;
    }
  }
  let _dayTickRegistered = false;
  function wireDayTick() {
    if (_dayTickRegistered || typeof CBZ.onNewDay !== "function") return;
    CBZ.onNewDay(payday);
    _dayTickRegistered = true;
  }
  wireDayTick();

  // ============================================================
  //  THE RATCHET — CBZ.factionAudit()
  //
  //  Counts legacy rank-ladder + membership sites that have NOT been migrated
  //  onto this file. Pin the current value in tools/math-gate.mjs's PASS block
  //  as a fixed ceiling; it may only ever go DOWN. A file that migrates calls
  //  CBZ.factionMigrated("<tag>") ONCE, at parse time — one line, no ceremony,
  //  exactly like CBZ.treeRegisterTree.
  //
  //  Universe (2026-07-26 census, verified by grep against HEAD dc9329c):
  //    · 6 independent join->rank->rank-up ladders
  //    · 18 files reading g.playerGang directly (excl. playergang.js itself)
  //    ·  3 further files reading CBZ.cityMembership() directly
  //   = 27 sites at baseline.
  // ============================================================
  const LEGACY_SITES = [
    // --- rank ladders (census §1) ---
    { tag: "ladder:gangs", file: "src/city/gangs.js:104", what: "RANKS tier table" },
    { tag: "ladder:playergang-member", file: "src/city/playergang.js:631", what: "MEMBER_LADDER literal" },
    { tag: "ladder:playergang-crew", file: "src/city/playergang.js:727,744", what: "two `ladder` literals" },
    { tag: "ladder:careers-security", file: "src/city/careers.js:78", what: "SECURITY_RANKS" },
    { tag: "ladder:officejobs", file: "src/city/officejobs.js:131", what: "worker/manager 2-tier" },
    { tag: "ladder:promotion", file: "src/city/promotion.js:14", what: "retired street-XP ladder" },
    // --- direct membership reads (census §6) ---
    { tag: "memb:adboard", file: "src/city/adboard.js:114" },
    { tag: "memb:aigoals", file: "src/city/aigoals.js:761,1096" },
    { tag: "memb:bling", file: "src/city/bling.js:422" },
    { tag: "memb:careers", file: "src/city/careers.js:162,668,726,790" },
    { tag: "memb:economy", file: "src/city/economy.js:588,1017" },
    { tag: "memb:empire", file: "src/city/empire.js:78" },
    { tag: "memb:gangs", file: "src/city/gangs.js:918,1939,1971" },
    { tag: "memb:heists", file: "src/city/heists.js:663" },
    { tag: "memb:level", file: "src/city/level.js:108" },
    { tag: "memb:peds", file: "src/city/peds.js:1533,2086" },
    { tag: "memb:phone", file: "src/city/phone.js:572" },
    { tag: "memb:props", file: "src/city/props.js:2144" },
    { tag: "memb:realestate", file: "src/city/realestate.js:43" },
    { tag: "memb:sizeup", file: "src/city/sizeup.js:44" },
    { tag: "memb:wanted", file: "src/city/wanted.js" },
    { tag: "memb:wealth", file: "src/city/wealth.js:247" },
    { tag: "memb:worldstate", file: "src/city/worldstate.js" },
    { tag: "memb:zillow", file: "src/city/zillow.js:148,158" },
    { tag: "memb:hud", file: "src/city/hud.js:491" },
    { tag: "memb:interact", file: "src/city/interact.js:116" },
    { tag: "memb:interactions_rich", file: "src/city/interactions_rich.js:84" },
  ];
  const migrated = Object.create(null);
  CBZ.factionMigrated = function (tag) { if (tag) migrated[String(tag)] = true; };

  // returns a NUMBER (the gate compares it against a fixed ceiling)
  CBZ.factionAudit = function () {
    let n = 0;
    for (let i = 0; i < LEGACY_SITES.length; i++) if (!migrated[LEGACY_SITES[i].tag]) n++;
    return n;
  };
  CBZ.factionAudit.baseline = LEGACY_SITES.length;
  CBZ.factionAudit.detail = function () {
    return LEGACY_SITES.filter(function (s) { return !migrated[s.tag]; })
      .map(function (s) { return s.tag + " (" + s.file + ")"; });
  };

  // ============================================================
  //  SMALL UI HELPERS (never a new popup — CLAUDE.md HUD doctrine)
  // ============================================================
  /* NAME THE SENDER OR THE MESSAGE IS DELETED.
     mode.js's note() runs every line through phoneWorthy() (mode.js:101-115),
     which drops anything that neither matches its "a real contact would send
     this" keyword list NOR carries an `opts.from` / `opts.app`. Every string in
     this file failed that test: "You're a Recruit in the Fort Brandt Garrison",
     "They've never heard of you", "Fort Brandt Garrison bumped you to Private"
     — and, worst of all, the allegiance fork's one warning ("Signing with the
     Bureau ends you with the Cause. Ask again to go through with it."). So the
     entire role layer was MUTE: you pressed [E] at a recruiting desk, were
     refused for a reason you could not see, and nothing appeared. Passing the
     outfit as `from` makes every line an authored in-world communication and it
     lands on the phone like the rest of the game's mail. */
  function note(msg, secs, from) {
    if (CBZ.city && CBZ.city.note) CBZ.city.note(msg, secs || 2.4, { from: from || "Contacts", app: "missions" });
  }
  function fnote(f, msg, secs) { note(msg, secs, f ? String(f.short || f.name).toUpperCase() : null); }
  function big(msg) { if (CBZ.city && CBZ.city.big) CBZ.city.big(msg); }

  // ============================================================
  //  PUBLIC SURFACE
  // ============================================================
  function handle(f) {
    return {
      id: f.id,
      def: function () { return f; },
      ladder: function () { return ladder(f.id); },
      join: function (how, opts) { return join(f.id, how, opts); },
      leave: function (why) { return leave(f.id, why); },
      isMember: function () { return !!memb(f.id); },
      rank: function () { return playerRank(f.id); },
      credit: function (k, n) { return credit(f.id, k, n); },
      pay: function (n, why) { return pay(f.id, n, why); },
      standing: function () { return standing(f.id); },
    };
  }

  const api = {
    declare: declare,
    found: found,
    def: def,
    all: all,
    ids: function () { return ORDER.slice(); },
    exists: function (id) { return !!DEFS[id]; },

    // ranks — the ONE tier table
    ladder: ladder,
    ladderKeys: ladderKeys,
    rankDef: rankDef,
    rankName: rankName,
    rankTier: rankTier,
    rankLvl: rankLvl,
    nextRank: nextRank,

    // --- §RANK IS A VERB (see the block above) ---
    npcRank: npcRankKey,          // an NPC's rank key, off the org's own field
    tierOf: tierOf,               // ANY subject -> tier, or -1
    grants: grantsFor,            // every verb open at a rung (cumulative)
    verbTier: verbTier,           // the lowest rung that opens a verb
    can: rankCan,                 // may THIS person do this?
    holder: rankHolder,           // is there ANYBODY who may?

    // membership
    membership: memb,
    isMember: function (id) { return !!memb(id); },
    rank: playerRank,
    tier: playerTier,
    isOwner: function (id) { const m = memb(id); return !!(m && m.owner); },
    canJoin: canJoin,
    join: join,
    leave: leave,
    expel: expel,
    // the ALLEGIANCE FORK, queryable so a recruiter's label can say what a
    // handshake costs before the player shakes.
    breaks: breaks,
    burns: burns,
    allegianceScan: allegianceScan,

    // progression + money
    credit: credit,
    eligible: eligible,
    promote: promote,
    tryPromote: tryPromote,
    pay: pay,
    charge: charge,
    standing: standing,
    addStanding: addStanding,
    markMissionDone: markMissionDone,
    missionDone: missionDone,

    // --- the core/mission.js seam (exact names mission.js feature-detects) ---
    payMul: payMul,
    onMissionComplete: onMissionComplete,
    onMissionFail: onMissionFail,

    // cross-faction
    of: of,
    orgOf: orgOf,
    // the concrete org the player holds INSIDE one faction archetype — this is
    // the read that replaces the 4 reimplemented myGangId() helpers.
    orgIn: function (id) { const m = memb(id); return m ? m.org : null; },
    reactionTo: reactionTo,
    hostile: hostile,
    heatMul: heatMul,

    // office seam (deliberately unimplemented — see §OFFICE)
    office: office,

    // ratchet + lifecycle
    audit: function () { return CBZ.factionAudit(); },
    reset: function () {
      g.cityOrgs = { orgs: Object.create(null) };
      g.cityFactionMissions = Object.create(null);
      for (const k in lastMemb) delete lastMemb[k];
      primed = false;                  // re-prime the fork diff against the new world
    },
    // ---- PERSISTENCE SEAM (the shape every other system in this repo hands
    // the ledger — see officials.js:648-683, polity.js, relations.js). Nothing
    // calls these yet: worldstate.js's commit() is an explicit field whitelist
    // and netpersist.js's worldBlob() an explicit `if (CBZ.X.serialize)` chain,
    // and neither file is this wave's to edit. They are here so wiring it is
    // one line each rather than a design problem. ----
    serialize: function () {
      const s = store(), out = { v: 1, orgs: {}, missions: {} };
      for (const k in s.orgs) {
        const r = s.orgs[k];
        out.orgs[k] = {
          id: r.id, member: !!r.member, owner: !!r.owner, org: r.org, rank: r.rank,
          standing: +r.standing || 0,
          credits: {
            bodies: +(r.credits && r.credits.bodies) || 0, contrib: +(r.credits && r.credits.contrib) || 0,
            served: +(r.credits && r.credits.served) || 0, orders: +(r.credits && r.credits.orders) || 0,
          },
          joinedDay: r.joinedDay, how: r.how,
        };
      }
      const done = g.cityFactionMissions || {};
      for (const t in done) if (done[t]) out.missions[t] = 1;
      return out;
    },
    apply: function (blob) {
      if (!blob || !blob.orgs) return false;
      const s = store();
      s.orgs = Object.create(null);
      for (const k in blob.orgs) s.orgs[k] = blob.orgs[k];
      g.cityFactionMissions = Object.create(null);
      for (const t in (blob.missions || {})) g.cityFactionMissions[t] = true;
      // a restored membership must not re-fire the allegiance fork (it already
      // happened, in the run that was saved) — re-prime the diff instead.
      for (const k in lastMemb) delete lastMemb[k];
      primed = false;
      allegianceScan();
      return true;
    },
    blank: blank,
  };

  CBZ.factions = api;
  // top-level aliases so a caller never has to remember the namespace depth
  CBZ.factionOf = of;
  CBZ.factionReactionTo = reactionTo;
  CBZ.factionHostile = hostile;
  CBZ.factionsReset = api.reset;
  // THE TWO RANK QUESTIONS, at the top level — every consumer in the repo calls
  // them in the degrade-safe form `CBZ.rankCan ? CBZ.rankCan(…) : <old value>`.
  CBZ.rankCan = rankCan;
  CBZ.rankHolder = rankHolder;
  CBZ.rankTierOf = tierOf;
  // DOES THE LADDER EVEN KNOW THIS VERB? The degrade-safe guard every gate in
  // the repo is written against: `CBZ.rankKnows(org, verb) ? <gate> : <old
  // ungated behaviour>`. Without it a caller that wrote `if (!rankCan(...))
  // return` would silently CLOSE its gate the moment FACTION_V1 was flipped off
  // — the exact "one-line revert makes it worse" trap. rankCan answering false
  // for an undeclared org is correct; treating that as a refusal is not.
  CBZ.rankKnows = function (id, verb) { return verbTier(id, verb) >= 0; };
})();
