/* ============================================================
   city/protection.js — Stage P, step P5: THE ONE PROTECTOR SYSTEM.

   MASTER-PLAN V.2b (verbatim): "Everything that guards anything is the same
   system. The codebase already ships four disconnected prototypes:
   Senator/Judge VIPs walk with police escorts and MAGNATEs with 2-3 suited
   SMG guards (vips.js:11-14, 79-94); the squad coordinator already 'posts a
   shield on a protectee' (config.js:447-454); gang members already guard
   bosses with rank/loyalty stat sheets and avenge them (gangs.js); stationed
   guards already hold posts with drift-back logic (island_military.js gate
   guards). The plan converges all of them onto one ProtectionDetail record:

     ProtectionDetail { id, principal (person | base | outlet), memberIds
       [registry people], gearTier, formation, postings, fundingSource
       (treasury | wallet | gang treasury), wageRate, loyalty (per member,
       from the existing 5-axis relationship rows), legalStatus }

   Secret Service (officials, treasury-funded, grows after failed attempts),
   Hired security (anyone with money buys the same machinery, arms guards
   with real weapon items), Militia (P7, past-headcount hired security —
   NOT this wave), Gangs (already the working implementation) are
   PARAMETERIZATIONS, not four systems. 'Shared consequences, because
   protectors are registry people (V.0): every guard has a wallet, a family,
   relationship axes, and a price... the bribed bodyguard is the classic
   vector.'"

   THIS WAVE'S SCOPE (deliberate narrowing, next waves finish the rest):
   - Secret Service + Hired Security are REAL, owned ProtectionDetail records
     (this file's own registry, g.protection.details). Militia (P7 — hired
     security past a headcount threshold becoming a faction) is NOT built
     here; hire() capped at 4 for exactly that reason (a militia needs its own
     turf/treasury wiring the plan reserves for P7). [P7 UPDATE: that wiring
     now exists in city/militia.js — HIRE_CAP is raised to 8 there and this
     file's own onNewDay sweep is joined by militia.js's escalation check,
     which watches every detail (this one AND officials.js's off_* Secret
     Service records) and converts any that cross MILITIA_HEADCOUNT into a
     real gang-machinery faction, zeroing this record's memberCount back to 0
     so it never double-pays a roster it no longer drives.]
   - Gangs are NOT refactored (too risky — gangs.js's guard/loyalty/rank
     machinery is a large, load-bearing, independently-evolving system with
     its own succession/war/turf ties). Instead this file exposes a
     READ-ONLY adapter, detailOf(), that synthesizes a ProtectionDetail-
     shaped VIEW over a live gang record for any code that wants to treat
     "everything that guards anything" uniformly (P7's militia code and P8's
     war code are the intended future readers). Nothing here ever mutates a
     gang.
   - "Members" are not registry sids — they are live spawned ped bodies that
     carry CBZ.cityRel()'s relPlayer axes directly on the ped object (exactly
     how social.js already tracks companions/hostages/everyone else's bond to
     the player — see social.js:59, "we never edit peds.js; we set its
     inputs"). This is what the MASTER-PLAN calls "registry people" in
     practice for a non-Sid body: the axes ride the ped, not a ledger row.
     A detail's PRINCIPAL, when it's an officeholder, IS tracked by sid
     (polity.js's office.holder) — officials.js re-points principal.ref at
     the live holder on every succession (see that file).
   - MEMBER BODIES ARE RUNTIME-ONLY, never persisted — same convention every
     P-wave file uses (officials.js's own header: "physical presence is
     runtime-only... re-materializes on the next qualifying tick"). What
     rides a save is the STRUCTURAL bookkeeping (principal/gearTier/
     formation/fundingSource/wageRate/legalStatus/memberCount/escalation) —
     bodies re-spawn lazily next time a qualifying tick needs them.

   REFACTOR: officials.js used to hand-roll its own 2-guard mayor detail
   (moveToward/driveGuards, GUARD_OFFSETS, a hardcoded "security"/SMG spawn).
   That guard LIFECYCLE (spawn loadout, formation-follow, teardown) now lives
   HERE as spawnMembers()/driveEscort()/despawnMembers()/moveToward(), and
   officials.js calls THROUGH this module — it still owns everything about
   WHEN a body should exist (office hours, distance-to-player, succession
   swaps): see that file's header for the split.

   GEAR TIERS map straight onto the city ped weapon vocabulary combat.js's
   GUN_MAP already recognizes (combat.js:37): 0 = Pistol, 1 = SMG, 2 = Rifle
   (GUN_MAP's "Rifle"→"carbine", the same "Carbine"/CITY_NAME.carbine="Rifle"
   pair vips.js/gangs.js already spawn). There is no standalone per-ped
   "armor" stat anywhere in this codebase (peds.js's ped record has hp/maxHp
   only) — tier 2's "+armor" is modeled as bonus maxHp, the same flavor
   vips.js already uses for its suited guards (170 hp vs a civilian's 100).

   HIRE PRICING reuses wealth.js's existing "bodyguardDisc" wealth-tier perk
   (wealth.js:436, already documented there as "cheaper crew/bodyguards" —
   this file is the first real consumer) via CBZ.cityWealth.tierPerk().
   Wage numbers are a fresh, explicit per-tier table rather than reusing
   careers.js's flat crewSalary (that system is the OLDER, single-tier
   "recruit a companion" path — careers.js:718 cityRecruit — which this file
   deliberately leaves alone; a player can still recruit a free-agent
   companion there, or hire a REAL priced/armed/tiered detail here).

   SUBORNING (console/API-level this wave, per the plan — an interaction
   verb lands later): "if the player has fear+respect > 120 with a detail
   member... the member steps aside during your next attack window (30s),
   one-shot, costs cash scaled by loyalty." Implemented by setting the
   EXISTING ped.surrender/poseHandsUp fields (peds.js already treats a
   surrendering ped as a non-combatant everywhere — see peds.js:3488/3577)
   for a 30s window — no new ped-state machinery needed.

   ATTEMPT ESCALATION: "principals are peds: a damaged-but-not-killed
   officeholder ped" — rather than hook combat.js/peds.js (repo convention:
   don't edit files outside your own wave unless the plan says to), this
   file watches hp deltas frame to frame exactly like vips.js's own
   hpMemo/scanThreat pattern (vips.js:536-541) via notePrincipalHp(), which
   officials.js calls every presence tick with the live principal ped.

   ORDER: no onUpdate of its own for the Secret Service path (officials.js
   calls spawnMembers/driveEscort/despawnMembers/notePrincipalHp directly,
   inline in ITS OWN 35.73 tick — so ordering is whatever officials.js
   already uses). Hired security gets its own tick at 35.75 (right after
   officials.js's 35.73 and vips.js's 35.7 — the same "who's embodied right
   now" neighborhood) to follow the player and spawn/despawn its own bodies.
   Loyalty/wage/escalation bookkeeping rides CBZ.onNewDay (polity.js), same
   slot family officials.js's own term/caretaker sweep uses.

   PERSISTENCE: two riders, polity.js's own exact dual pattern — MULTIPLAYER
   (src/net/netpersist.js blob.prot, edited there beside blob.pol) +
   SINGLE-PLAYER (wraps CBZ.cityWorldCommit/cityWorldCollect, own guard flag
   _protWrap, g.cityWorld.prot). Only the structural fields ride either
   channel; memberPedRefs/suborn timers are runtime-only (see above).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  // own seeded LCG (never Math.random — repo convention for world state).
  let _seed = 550119731 & 0x7fffffff;
  function rng() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // ============================================================
  //  GEAR TIERS — 0 pistol / 1 smg / 2 rifle+armor (see header)
  // ============================================================
  const GEAR = [
    { weapon: "Pistol", ammo: 30, hp: 120, hireCost: 250, wage: 10 },
    { weapon: "SMG", ammo: 90, hp: 150, hireCost: 550, wage: 18 },
    { weapon: "Rifle", ammo: 60, hp: 190, hireCost: 1100, wage: 30 },
  ];
  // P7: raised from the original P5 cap of 4 ("past this is P7's militia,
  // not this wave" — this IS that wave now). Hired security can grow to 8;
  // city/militia.js watches every detail daily and, once a roster crosses
  // its own MILITIA_HEADCOUNT threshold (6 — comfortably inside this cap),
  // escalates it into a real gang-machinery faction and zeroes this record
  // out from under it (see that file's escalate()).
  const HIRE_CAP = 8;
  const SUBORN_BASE_COST = 400;       // scaled by the member's loyalty axis (see suborn())
  const SUBORN_WINDOW = 30;           // seconds the member steps aside for, per the plan

  // ============================================================
  //  STATE
  // ============================================================
  function reset() {
    g.protection = { details: {}, attempts: {}, nextId: 1 };
  }
  function state() {
    if (!g.protection) reset();
    return g.protection;
  }

  function arena() { return CBZ.city && CBZ.city.arena; }

  // ============================================================
  //  THE RECORD — create/dissolve/details()
  // ============================================================
  function create(opts) {
    opts = opts || {};
    const S = state();
    // caller-supplied ids are IDEMPOTENT — registerCity/registerState/
    // registerCountry's own "re-register the same id → hand back the
    // existing record" shape (polity.js). officials.js relies on this: it
    // calls create({id:"off_"+rec.id, ...}) every time it needs an office's
    // detail, on a fresh boot AND after a save restores one — the restored
    // record (with its escalated headcount) wins instead of being shadowed
    // by a duplicate.
    if (opts.id && S.details[opts.id]) return S.details[opts.id];
    const id = opts.id || ("prot" + (S.nextId++));
    const principal = opts.principal || { kind: "player", ref: null };
    const gearTier = clamp(opts.gearTier | 0, 0, 2);
    const fundingSource = opts.fundingSource || "treasury";
    const rec = {
      id,
      principal: { kind: principal.kind, ref: principal.ref != null ? principal.ref : null },
      memberPedRefs: [],                          // runtime only — never serialized
      memberCount: Math.max(0, opts.memberCount | 0),
      gearTier,
      formation: opts.formation || "escort",       // "escort" | "posted"
      postings: (opts.postings || []).map((p) => ({ x: p.x, z: p.z })),
      fundingSource,                                // "treasury" | "wallet" | "gang"
      wageRate: opts.wageRate != null ? opts.wageRate : GEAR[gearTier].wage,
      legalStatus: opts.legalStatus || (fundingSource === "treasury" ? "state" : fundingSource === "gang" ? "gang" : "licensed"),
      _escalated: 0,                                 // attempt-escalation members added so far (cap 3)
      _hpMemo: null,                                 // notePrincipalHp() watch
    };
    S.details[id] = rec;
    return rec;
  }
  function dissolve(id) {
    const S = state();
    const rec = S.details[id]; if (!rec) return;
    despawnMembers(rec);
    delete S.details[id];
  }
  function details() {
    const S = state();
    const out = [];
    for (const id in S.details) out.push(S.details[id]);
    return out;
  }
  function get(id) { return (id && state().details[id]) || null; }

  // ============================================================
  //  SHARED FOLLOW PRIMITIVE — officials.js's original moveToward(), verbatim
  //  (social.js's own companion-follow tick generalized off the player, per
  //  that file's header — this is the one copy now).
  // ============================================================
  function moveToward(ped, tx, tz, speed, dt) {
    const dx = tx - ped.pos.x, dz = tz - ped.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.6) { ped.state = "idle"; ped.speed = 0; return; }
    ped.state = "walk"; ped.speed = speed;
    ped.pos.x += (dx / d) * speed * dt; ped.pos.z += (dz / d) * speed * dt;
    const yaw = Math.atan2(dx, dz);
    ped.group.rotation.y = CBZ.lerpAngle ? CBZ.lerpAngle(ped.group.rotation.y, yaw, 1 - Math.pow(0.001, dt)) : yaw;
  }

  // fan N members into a shallow arc behind+beside the principal (generalizes
  // officials.js's old fixed 2-slot GUARD_OFFSETS to the president's 4-body
  // detail / a hired crew that grows over time).
  function offsetFor(i, n) {
    if (n <= 1) return { f: -1.8, s: -1.2 };
    const spread = 1.5 + Math.min(n, 6) * 0.55;
    const t = (i / (n - 1)) * 2 - 1;               // -1..1
    return { f: -1.8 - Math.abs(t) * 0.3, s: t * spread };
  }

  // ============================================================
  //  MEMBER LIFECYCLE — spawn/drive/despawn (the refactored officials.js code)
  // ============================================================
  function jobFor(detail) {
    if (detail.fundingSource === "treasury") return "secret service";
    if (detail.fundingSource === "gang") return "gang muscle";           // never actually spawned by this path (see detailOf)
    return "hired security";
  }
  const GUARD_SPEED = 2.1;

  // top up memberPedRefs to memberCount, spawning at (x,z) with the detail's
  // current gear loadout. Cheap no-op once the roster is full.
  function spawnMembers(detail, A, x, z, spawnRng) {
    if (!detail || !A || !A.root || !CBZ.cityMakePed) return;
    const r = spawnRng || rng;
    const gear = GEAR[clamp(detail.gearTier | 0, 0, 2)];
    let guard = 0;
    while (detail.memberPedRefs.length < detail.memberCount && guard++ < HIRE_CAP + 4) {
      const i = detail.memberPedRefs.length;
      const ang = (i / Math.max(1, detail.memberCount)) * Math.PI * 2;
      const px = x + Math.cos(ang) * 1.7, pz = z + Math.sin(ang) * 1.7;
      let q = null;
      try {
        q = CBZ.cityMakePed(px, pz, r, {
          archetype: "security", job: jobFor(detail), wealth: 0.4,
          armed: true, weapon: gear.weapon, aggr: 0.6, hp: gear.hp,
        });
      } catch (e) { q = null; }
      if (!q) break;
      q.controlled = true; q.ammo = gear.ammo; q.maxHp = gear.hp;
      A.root.add(q.group); CBZ.cityPeds.push(q);
      if (CBZ.cityRelShift) CBZ.cityRelShift(q, "recruited", 0.5);   // a fresh hire starts with SOME goodwill, not none
      detail.memberPedRefs.push(q);
    }
  }
  function removePed(p) {
    if (!p) return;
    try {
      if (p.group && p.group.parent) p.group.parent.remove(p.group);
      if (CBZ.cityPeds) { const i = CBZ.cityPeds.indexOf(p); if (i >= 0) CBZ.cityPeds.splice(i, 1); }
    } catch (e) {}
  }
  function despawnMembers(detail) {
    if (!detail) return;
    for (let i = 0; i < detail.memberPedRefs.length; i++) removePed(detail.memberPedRefs[i]);
    detail.memberPedRefs.length = 0;
  }
  // one member peels off permanently (quit/killed/reassigned) — shrinks the
  // target headcount too, so spawnMembers() doesn't immediately replace them.
  function dropMember(detail, ped) {
    const i = detail.memberPedRefs.indexOf(ped);
    if (i >= 0) detail.memberPedRefs.splice(i, 1);
    removePed(ped);
    detail.memberCount = Math.max(0, detail.memberCount - 1);
  }

  // escort formation: members fan out behind the principal and follow. A
  // suborned member (see suborn()) stands down for its 30s window instead.
  function driveEscort(detail, principal, dt) {
    if (!detail || !principal || principal.dead) return;
    const peds = detail.memberPedRefs;
    const h = principal.group.rotation.y;
    const dx = Math.sin(h), dz = Math.cos(h), lx = Math.cos(h), lz = -Math.sin(h);
    const n = peds.length;
    for (let i = 0; i < n; i++) {
      const gd = peds[i]; if (!gd || gd.dead) continue;
      if ((gd._subornT || 0) > 0) { gd.state = "idle"; gd.speed = 0; continue; }   // stepped aside
      const o = offsetFor(i, n);
      const fx = principal.pos.x + dx * o.f + lx * o.s, fz = principal.pos.z + dz * o.f + lz * o.s;
      moveToward(gd, fx, fz, GUARD_SPEED, dt);
    }
  }
  // "posted" formation (Part IV base/outlet protection — the postings[] array
  // is already carried by the record so a future base-defense wave is a
  // formation branch, not a schema change): members hold the nearest free
  // posting point instead of following a moving principal.
  function driveEscortPosted(detail, dt) {
    const peds = detail.memberPedRefs, posts = detail.postings || [];
    if (!posts.length) return;
    for (let i = 0; i < peds.length; i++) {
      const gd = peds[i]; if (!gd || gd.dead) continue;
      if ((gd._subornT || 0) > 0) { gd.state = "idle"; gd.speed = 0; continue; }
      const p = posts[i % posts.length];
      moveToward(gd, p.x, p.z, GUARD_SPEED, dt);
    }
  }
  function driveDetail(detail, principal, dt) {
    if (detail.formation === "posted") driveEscortPosted(detail, dt);
    else driveEscort(detail, principal, dt);
  }

  // suborn/quit timers + the escort/posted branch, shared by every detail
  // regardless of who owns it (officials.js drives ITS OWN sid-details
  // inline; this per-frame sweep only needs to decrement suborn windows for
  // ALL of them, and separately drives the "player" details end to end).
  function tickSuborn(dt) {
    const S = state();
    for (const id in S.details) {
      const det = S.details[id];
      for (let i = 0; i < det.memberPedRefs.length; i++) {
        const gd = det.memberPedRefs[i]; if (!gd) continue;
        if ((gd._subornT || 0) > 0) {
          gd._subornT -= dt;
          if (gd._subornT <= 0) { gd._subornT = 0; gd.surrender = false; gd.poseHandsUp = false; }
        }
      }
    }
  }

  // ============================================================
  //  HIRED SECURITY — the player buys the same machinery (own tick: spawn-
  //  gate, follow, drive). One singleton "player" detail; hire() grows it.
  // ============================================================
  function findPlayerDetail() {
    const S = state();
    for (const id in S.details) if (S.details[id].principal.kind === "player") return S.details[id];
    return null;
  }
  function hire(gearTier) {
    const S = state();
    let det = findPlayerDetail();
    if (det && det.memberCount >= HIRE_CAP) {
      if (CBZ.city) CBZ.city.note("Security detail already at full strength (" + HIRE_CAP + ").", 2.2);
      return null;
    }
    const tier = clamp(gearTier | 0, 0, 2);
    const effTier = det ? Math.max(det.gearTier, tier) : tier;
    const gear = GEAR[effTier];
    const disc = (CBZ.cityWealth && CBZ.cityWealth.tierPerk) ? CBZ.cityWealth.tierPerk("bodyguardDisc") : 0;
    const cost = Math.round(gear.hireCost * (1 - disc));
    if (!CBZ.city || !CBZ.city.canAfford(cost)) {
      if (CBZ.city) CBZ.city.note("Need $" + cost + " to hire security.", 2.2);
      return null;
    }
    CBZ.city.spend(cost);
    if (!det) {
      det = create({
        principal: { kind: "player", ref: null }, gearTier: tier, formation: "escort",
        fundingSource: "wallet", legalStatus: "licensed", wageRate: gear.wage, memberCount: 0,
      });
    }
    det.gearTier = effTier; det.wageRate = GEAR[effTier].wage;
    det.memberCount = Math.min(HIRE_CAP, det.memberCount + 1);
    const A = arena(), P = CBZ.player;
    if (A && P) spawnMembers(det, A, P.pos.x + (rng() - 0.5) * 3, P.pos.z + (rng() - 0.5) * 3, rng);
    if (CBZ.city) CBZ.city.note("🛡️ Hired security (" + gear.weapon + ") — " + det.memberCount + "/" + HIRE_CAP + " on your detail.", 2.6);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return det;
  }

  // order 35.75 — right after officials.js's 35.73 (both peek at "who's
  // embodied right now" the same frame) and vips.js's 35.7. Hired security is
  // the ONE flavor with no other module driving its spawn/follow, so it gets
  // a full standalone tick; the sid-kind Secret Service details are driven
  // inline by officials.js's own tick (see that file).
  CBZ.onUpdate(35.75, function (dt) {
    tickSuborn(dt);
    const gm = CBZ.game; if (!gm || gm.mode !== "city") return;
    const det = findPlayerDetail(); if (!det || det.memberCount <= 0) return;
    const A = arena(); const P = CBZ.player; if (!A || !P || P.dead) return;
    if (det.memberPedRefs.length < det.memberCount) spawnMembers(det, A, P.pos.x, P.pos.z, rng);
    // follow the PLAYER (a companion-follow, not a principal-ped follow —
    // there is no ped body standing in for "the player" the way officials.js
    // has one for an officeholder, so this mirrors social.js's own follow()
    // closure directly off CBZ.player/CBZ.cam instead of driveEscort()).
    const yaw = CBZ.cam ? CBZ.cam.yaw : 0;
    const h = yaw;
    const dx = Math.sin(h), dz = Math.cos(h), lx = Math.cos(h), lz = -Math.sin(h);
    const n = det.memberPedRefs.length;
    for (let i = 0; i < n; i++) {
      const gd = det.memberPedRefs[i]; if (!gd || gd.dead) continue;
      if ((gd._subornT || 0) > 0) { gd.state = "idle"; gd.speed = 0; continue; }
      const o = offsetFor(i, n);
      const fx = P.pos.x + dx * o.f + lx * o.s, fz = P.pos.z + dz * o.f + lz * o.s;
      moveToward(gd, fx, fz, GUARD_SPEED, dt);
    }
  });

  // ============================================================
  //  ATTEMPT ESCALATION — Secret Service grows after failed attempts (see
  //  header: no combat.js/peds.js hook, just an hp-delta watch officials.js
  //  feeds every presence tick with the live principal ped).
  // ============================================================
  function notePrincipalHp(detail, ped) {
    if (!detail || !ped) return;
    if (ped.dead) { detail._hpMemo = null; return; }        // death → officials.js's own succession path, not this
    if (detail._hpMemo == null) { detail._hpMemo = ped.hp; return; }
    if (ped.hp < detail._hpMemo - 0.25) {
      const sid = detail.principal.kind === "sid" ? detail.principal.ref : null;
      if (sid) {
        const S = state();
        S.attempts[sid] = (S.attempts[sid] || 0) + 1;
        if ((detail._escalated || 0) < 3) {
          detail._escalated = (detail._escalated || 0) + 1;
          detail.memberCount++;
          if (CBZ.cityFeed) CBZ.cityFeed("🛡️ Detail reinforced after an attempt on " + (ped.name || "the officeholder"), "#ffd76a");
        }
      }
    }
    detail._hpMemo = ped.hp;
  }
  function attemptsOn(sid) { return (state().attempts[sid]) || 0; }

  // ============================================================
  //  LOYALTY + WAGES — daily sweep (polity.js's CBZ.onNewDay, same slot
  //  family officials.js's term/caretaker check uses).
  // ============================================================
  if (CBZ.onNewDay) {
    CBZ.onNewDay(function () {
      const S = state();
      for (const id in S.details) {
        const det = S.details[id];
        // GRUDGE ABANDONMENT — any member (any funding source) whose grudge
        // against the player has crossed 50 walks off post permanently.
        for (let i = det.memberPedRefs.length - 1; i >= 0; i--) {
          const gd = det.memberPedRefs[i]; if (!gd || gd.dead) continue;
          const rel = CBZ.cityRel ? CBZ.cityRel(gd) : null;
          if (rel && rel.grudge > 50) {
            const nm = gd.name || "a guard";
            dropMember(det, gd);
            if (CBZ.cityFeed) CBZ.cityFeed("🚪 " + nm + " walks off the detail — the grudge finally won.", "#ff9e6b");
          }
        }
        // WAGES — only wallet-funded (hired security) details drain g.cash.
        // Treasury (Secret Service) and gang (gangs.js's own treasury) are
        // out of scope for this player-facing drain.
        if (det.fundingSource !== "wallet" || det.memberCount <= 0) continue;
        const cost = Math.round(det.memberCount * det.wageRate);
        if (cost <= 0) continue;
        if (CBZ.city && CBZ.city.canAfford(cost)) {
          CBZ.city.spend(cost);
        } else if (det.memberPedRefs.length) {
          const q = det.memberPedRefs[0];
          const nm = (q && q.name) || "one of your guards";
          dropMember(det, q);
          if (CBZ.cityFeed) CBZ.cityFeed("💸 Couldn't make payroll — " + nm + " walked off the job.", "#ff6a5e");
        } else {
          det.memberCount = 0;
        }
      }
    });
  }

  // ============================================================
  //  SUBORNING — console/API-level this wave (an interaction verb lands with
  //  a later interact.js pass); harness-tested. "if the player has
  //  fear+respect > 120 with a detail member... the member steps aside
  //  during your next attack window (30s), one-shot, costs cash scaled by
  //  loyalty."
  // ============================================================
  function detailContaining(ped) {
    const S = state();
    for (const id in S.details) if (S.details[id].memberPedRefs.indexOf(ped) >= 0) return S.details[id];
    return null;
  }
  function suborn(ped) {
    const det = detailContaining(ped);
    if (!det) return { ok: false, reason: "not on a protection detail" };
    const rel = CBZ.cityRel ? CBZ.cityRel(ped) : null;
    if (!rel) return { ok: false, reason: "no relationship to read" };
    if ((rel.fear || 0) + (rel.respect || 0) <= 120) return { ok: false, reason: "not swayed — needs fear+respect > 120" };
    const cost = Math.round(SUBORN_BASE_COST * (1 + Math.max(0, rel.loyalty || 0) / 100));
    if (!CBZ.city || !CBZ.city.canAfford(cost)) return { ok: false, reason: "can't afford", cost };
    CBZ.city.spend(cost);
    ped._subornT = SUBORN_WINDOW;
    ped.surrender = true; ped.poseHandsUp = true; ped.rage = null;
    if (CBZ.cityFeed) CBZ.cityFeed("🤝 " + (ped.name || "A guard") + " steps aside for " + SUBORN_WINDOW + "s.", "#7ed957");
    return { ok: true, cost, seconds: SUBORN_WINDOW };
  }

  // ============================================================
  //  GANGS — read-only adapter, NOT a create()d record (see header: gangs.js
  //  is never refactored). Accepts a gang id (preferred) or a ped whose
  //  .gang field names one. Synthesizes a ProtectionDetail-shaped view for
  //  any future reader (P7 militia comparisons, P8 war math) that wants to
  //  treat "everything that guards anything" uniformly.
  // ============================================================
  function detailOf(ref) {
    const gangId = typeof ref === "string" ? ref : (ref && ref.gang);
    if (!gangId) return null;
    const gangs = CBZ.cityGangs || [];
    let gang = null;
    for (let i = 0; i < gangs.length; i++) if (gangs[i].id === gangId) { gang = gangs[i]; break; }
    if (!gang) return null;
    return {
      id: "gang:" + gang.id,
      // NOTE: gang bosses are NEVER minted registry sids (gangs.js spawns them
      // straight via cityMakePed with no cityPedStash call) — "boss" is an
      // adapter-only principal kind, deliberately outside the sid|player|piece
      // enum create() uses, because this view is never round-tripped through
      // create()/apply().
      principal: { kind: "boss", ref: gang.id },
      memberPedRefs: (gang.members || []).filter((m) => m && !m.dead),
      gearTier: null,      // gangs.js rolls per-member loadouts off GANG_TYPES weights, not a flat tier (see spawnGangMember)
      formation: "escort",
      postings: (gang.turf || []).map((l) => ({ x: l.cx, z: l.cz })),
      fundingSource: "gang",
      wageRate: null,
      legalStatus: "gang",
      _readOnly: true,
    };
  }

  // ============================================================
  //  PUBLIC API
  // ============================================================
  CBZ.protection = {
    create, dissolve, details, get,
    spawnMembers, despawnMembers, dropMember, driveEscort: driveDetail, moveToward,
    notePrincipalHp, attemptsOn,
    hire, suborn, detailOf,
    reset, GEAR, HIRE_CAP,
    serialize: function () {
      const S = state();
      const out = {};
      for (const id in S.details) {
        const d = S.details[id];
        out[id] = {
          principal: { kind: d.principal.kind, ref: d.principal.ref },
          gearTier: d.gearTier, formation: d.formation, postings: (d.postings || []).slice(),
          fundingSource: d.fundingSource, wageRate: d.wageRate, legalStatus: d.legalStatus,
          memberCount: d.memberCount, escalated: d._escalated || 0,
        };
      }
      return { v: 1, nextId: S.nextId, details: out, attempts: Object.assign({}, S.attempts) };
    },
    apply: function (obj) {
      reset();
      if (!obj || obj.v !== 1) return;
      const S = state();
      S.nextId = obj.nextId || 1;
      S.attempts = Object.assign({}, obj.attempts || {});
      for (const id in (obj.details || {})) {
        const m = obj.details[id];
        S.details[id] = {
          id, principal: { kind: m.principal.kind, ref: m.principal.ref != null ? m.principal.ref : null },
          memberPedRefs: [],   // runtime-only — re-materializes lazily (see header)
          memberCount: m.memberCount | 0, gearTier: clamp(m.gearTier | 0, 0, 2),
          formation: m.formation || "escort", postings: (m.postings || []).map((p) => ({ x: p.x, z: p.z })),
          fundingSource: m.fundingSource || "treasury", wageRate: m.wageRate,
          legalStatus: m.legalStatus || "state", _escalated: m.escalated || 0, _hpMemo: null,
        };
      }
    },
  };
  CBZ.protectionReset = reset;

  // ============================================================
  //  SINGLE-PLAYER PERSIST — polity.js's own dual-rider pattern: stamp the
  //  live registry onto g.cityWorld right before the existing commit/collect
  //  save hooks run, hydrate back out whenever that ledger object's REFERENCE
  //  changes. Own idempotence flag (_protWrap).
  // ------------------------------------------------------------
  function stampProtection() {
    const led = g.cityWorld;
    if (led && typeof led === "object") led.prot = CBZ.protection.serialize();
  }
  let _ensureProtectionSaveWraps_done = false;
  function ensureProtectionSaveWraps() {
    // ONE-SHOT INSTALL (chain-growth fix): the old guard checked the
    // module flag on the CURRENT top-of-chain function, so once any
    // later module wrapped above us the flag vanished from the top and
    // we re-wrapped EVERY tick - ~20 such modules made the commit chain
    // grow unboundedly (stack overflow on save; found by the P5 full-
    // stack harness). A module-local boolean wraps exactly once, ever.
    if (_ensureProtectionSaveWraps_done) return;
    _ensureProtectionSaveWraps_done = true;
    const commit = CBZ.cityWorldCommit;
    if (typeof commit === "function" && !commit._protWrap) {
      const w = function () { stampProtection(); return commit.apply(this, arguments); };
      w._protWrap = true; CBZ.cityWorldCommit = w;
    }
    if (CBZ.cityWorldCollect && !CBZ.cityWorldCollect._protWrap) {
      const col = CBZ.cityWorldCollect;
      const wc = function () { stampProtection(); return col.apply(this, arguments); };
      wc._protWrap = true; CBZ.cityWorldCollect = wc;
    }
  }
  let _hydratedLedger = null;
  function hydrateFromLedger() {
    const led = g.cityWorld;
    if (!led || led === _hydratedLedger) return;
    _hydratedLedger = led;
    if (led.prot) CBZ.protection.apply(led.prot);
  }
  if (CBZ.onUpdate) {
    // 46.07 — between polity.js's 46.03 hydrate and officials.js's 46.08 mint
    // check, so a restored detail roster exists before officials.js decides
    // whether it needs to mint anything fresh this run.
    CBZ.onUpdate(46.07, function () {
      if (!g) return;
      ensureProtectionSaveWraps();
      hydrateFromLedger();
    });
  }
})();
