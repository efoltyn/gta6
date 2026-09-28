/* ============================================================
   city/protection.js — THE ONE PROTECTOR SYSTEM, and the President's
   Secret Service.

   ------------------------------------------------------------
   THE PRESIDENT'S SECURITY (2026-09-27 president-mode rework)
   ------------------------------------------------------------
   The owner wants killing the President to be HARD but possible with a
   plan. Walking up with a pistol in the open gets you shot. A long rifle
   shot from past the counter-snipers' reach, a bribed agent, a bomb on the
   motorcade route, or fighting your way through the gate are all real.

   WHAT THE PLAYER SEES
   · As President: a shift leader and four agents in dark suits walk a
     diamond around you (point, two flanks, tail, the leader at your
     shoulder), at your pace (they run when you run), looking OUTWARD. The
     diamond tightens to 2 m in a crowd and goes single file through a
     doorway. They never appear in front of you: a body that has fallen far
     behind is moved up only while neither end is on screen. Inside the
     Mansion or the West Wing they do not crowd you: two stand either side
     of the door of your office upstairs, the rest hold the building doors.
   · Anyone else near the Mansion (within 180 m of its grounds): uniformed
     officers at the gate, a counter-sniper and a spotter on each of two roof
     corners, and two agents walking the inside of the perimeter wall.
   · THE GATE: walk in through the magnetometer arch (the only way in on
     foot; the vehicle lane has a drop arm and steel bollards). Carry any
     weapon through it and the lamp goes red, an officer says "Sir, step
     back. Hands where I can see them.", and the gate officers draw on you.
     Walk back out and it is over. Walk on, pull a gun, or aim at them and
     they open fire, the gate calls it in, and the whole house goes to
     alert. The arm lifts and the bollards sink for the motorcade and the
     President's own car only.
   · THE COUNTER-SNIPERS cover 250 m. A man who raises a long gun in that
     circle gets three seconds; a man who aims at the President, fires, or
     is already a known hostile gets under one. Past 250 m, behind cover,
     or with the roof team dead or bribed, nobody up there can touch you.
   · THE PANIC PROTOCOL (posture per principal: normal -> alert -> evac).
     Triggers: gunfire within 60 m of him (CBZ.cityAlarm, which every shot
     and every hit already rings), a drawn weapon within 15 m, an explosion
     within 70 m (CBZ.cityExplosion), an armed attacker or anybody raging at
     him or his people, the presidency bus's "attack-armed"/"attack", an
     assassination, CBZ.protection.alarm(). ALERT: agents draw and face the
     threat, two step in between him and it, somebody shouts. EVAC: the
     detail closes into a wall of bodies. An NPC President RUNS inside the
     Mansion's front door with power.js's ring closed tight on him, stays
     hidden until it is calm, then walks back out to his post; a President
     at a public appearance goes through CBZ.presidentPublic.evacuate(), one
     in the motorcade through CBZ.motorcade.evacuate(). The player President
     gets "Sir, with me. Inside, now." The agents with a clear shot take the
     shooter. Every change goes out on the bus as
     CBZ.presidency.emit("security", {level, reason, at}). A posture stands
     down after 30 s of calm. While the capital is locked down after an
     assassination the gate is shut, two extra officers stand in the vehicle
     lane and everybody stays at alert.

   BODIES AND RANGES
   · the player President's detail: 5 standing (the record's runtime
     `standing`), plus one body per "bigger detail" order (memberCount, the
     only number militia.js counts). A fallen agent is replaced 20 s later.
   · Mansion posts: 3 gate officers (+2 in a lockdown), 4 on the roof,
     2 on the wall walk. Spawned within 180 m of the grounds, released past
     260 m, killed stays dead until the next day.
   · an NPC President keeps power.js's ring (tier 5: six officers); this
     file never adds a second ring, it only moves those officers' slots.
   · decisions run at 4-5 Hz; only walking runs per frame.

   THE SEAM FOR HITMAN (stable; other files code against exactly this)
     CBZ.protection.detail(personId) -> {
        principal: { kind: "player"|"npc"|"vacant", name, sid },
        posture:   "normal"|"alert"|"evac",
        reason:    string|null,
        units:     [{ ped, role: "agent"|"shift-leader"|"counter-sniper"|"gate"
                            |"patrol"|"ring", post:{x,y,z}, alive }],
        posts:     [{ role, x, y, z, r, manned, lost }],   r = coverage metres
        checkpoints: [{ x, z, kind: "magnetometer"|"barrier", open? }] }
       personId: "president", "player", a sid string, or a ped. Unknown -> null.
     CBZ.protection.alarm(x, z, reason) -> "president"|"player"|null
       raises the protocol around the nearest protected principal (a reason
       naming shots/guns/explosions/an attack is an evac when close).
     CBZ.protection.posture(personId) -> "normal"|"alert"|"evac"
     CBZ.protection.suborn(ped) — a bribed agent, gate officer or roof man
       steps aside for 30 s (see SUBORNING below). The classic vector.
     CBZ.protection._presidential() — harness only: gate/sniper/agent points.

   Geometry of the gate and the roof stands is govcomplex.js's (§2b,
   site.security); every body and every decision is here.

   ------------------------------------------------------------
   THE ORIGINAL RECORD (Stage P, step P5)
   ------------------------------------------------------------

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
  //  THE ONE MOVER — ped.moveOrder (the CBZ.moves seam in city/peds.js).
  //  This file decides WHERE a body goes and which way it looks; peds.js's
  //  move() steps it there through CBZ.moves (velocity, braking arrival,
  //  bounded turn, avoidance, the collider). Nothing in here writes a
  //  position or a yaw on a moving body any more: the old goTo() added its
  //  own catch-up step on top of the ped mover and flipped walk/idle at
  //  0.7 m, which is what made the President's detail surge and stop.
  //  An order is re-issued every frame by whoever owns it and carries the
  //  frame clock (`t`, CBZ.now ms), so an owner that stops driving a body
  //  leaves nothing behind once peds.js drops the stale order.
  // ============================================================
  const WALK_SPEED = 2.4, RUN_SPEED = 5.0;
  function order(ped, x, z, speed, face, strafe, vx, vz, stop) {
    let o = ped.moveOrder;
    if (!o) o = ped.moveOrder = { x: 0, z: 0, speed: 0, stop: 0.25, face: null, strafe: false, vffX: 0, vffZ: 0, leg: false, t: 0 };
    o.x = x; o.z = z; o.speed = speed; o.stop = stop != null ? stop : 0.25;
    o.face = face != null ? face : null; o.strafe = !!strafe;
    o.vffX = vx || 0; o.vffZ = vz || 0; o.leg = false;
    o.t = CBZ.now || 0;
    if (ped.target && ped.target.set) ped.target.set(x, 0, z);
    ped.path = null; ped.pause = 0; ped.finalGoal = null; ped._boardRun = false;
    const dx = x - ped.pos.x, dz = z - ped.pos.z;
    return Math.sqrt(dx * dx + dz * dz);
  }
  function release(ped) { if (ped && ped.moveOrder) ped.moveOrder = null; }
  function arrived(ped) { return !!(ped._mv && ped._mv.arrived); }
  // a body standing where it is (a post, a challenge) turns at the gait's own
  // rate instead of being snapped: for posted bodies peds.js does not step
  function turnTo(ped, yaw, dt) {
    if (!ped.group || yaw == null) return;
    if (CBZ.moves) ped.group.rotation.y = CBZ.moves.face(CBZ.moves.motor(ped), ped.group.rotation.y, yaw, dt);
    else ped.group.rotation.y = yaw;
  }
  function yawTo(ped, x, z) { return Math.atan2(x - ped.pos.x, z - ped.pos.z); }

  // THE SHARED FOLLOW (officials.js's officeholder, power.js's private ring,
  // childhood.js's toddlers): one call per frame, the body walks there.
  function moveToward(ped, tx, tz, speed, dt) {
    order(ped, tx, tz, speed, null, false, 0, 0, 0.5);
    ped.state = arrived(ped) ? "idle" : "walk";
  }

  // ONE FORMATION FRAME PER PRINCIPAL (CBZ.moves.formation): it follows his
  // SMOOTHED velocity, turns at a bounded rate, predicts the slots a beat
  // ahead and hands every member his velocity as feed-forward, so the detail
  // walks WITH him instead of chasing and stopping. Runtime only (never in
  // serialize()). Mode changes BLEND: each slot's local offset eases to the
  // new mode's over ~0.6 s instead of jumping.
  // a SHORT lead (0.2 s): the members already carry his velocity as
  // feed-forward, so a long prediction only parks every slot metres ahead of
  // him, and the moment he stops the whole detail has to walk back to him
  const FRAME_OPTS = { lead: 0.2 };
  function frameOf(owner) {
    if (!owner._F && CBZ.moves) { owner._F = CBZ.moves.formation(FRAME_OPTS); owner._Fb = []; owner._Fw = []; owner._Fo = []; owner._Fs = []; }
    return owner._F || null;
  }
  const _fs = { f: 0, s: 0, face: 0 };
  // lay out n slots in `mode` around the frame, blended; returns the world slots
  function frameSlots(owner, n, mode, dt) {
    const F = owner._F, B = owner._Fb, W = owner._Fw;
    const k = 1 - Math.exp(-dt * 5), cap = 5 * dt;       // ~95% in 0.6 s, never faster than 5 m/s
    for (let i = 0; i < n; i++) {
      formationSlot(i, n, mode, _fs);
      let b = B[i];
      if (!b) { b = B[i] = { f: _fs.f, s: _fs.s, face: _fs.face }; }
      let df = (_fs.f - b.f) * k, ds = (_fs.s - b.s) * k;
      const dl = Math.sqrt(df * df + ds * ds);
      if (dl > cap) { df *= cap / dl; ds *= cap / dl; }
      b.f += df; b.s += ds;
      let da = _fs.face - b.face; da = Math.atan2(Math.sin(da), Math.cos(da));
      b.face += da * k;
      const w = W[i] || (W[i] = { x: 0, z: 0, vx: 0, vz: 0, face: 0 });
      F.slot(b.f, b.s, w);
      w.face = (F.h || 0) + b.face;
    }
    W.length = Math.max(W.length, n);
    return W;
  }
  // stable member -> slot: `fixed0` (the shift leader) keeps slot 0, the rest
  // are solved by F.assign (re-solves only on a real gain, never a reshuffle)
  function frameAssign(owner, members, n, fixed0, out) {
    const F = owner._F, O = owner._Fo, S = owner._Fs, W = owner._Fw;
    O.length = 0; S.length = 0;
    for (let i = 0; i < n; i++) if (i !== fixed0) O.push(members[i]);
    for (let j = fixed0 >= 0 ? 1 : 0; j < n; j++) S.push(W[j]);
    const asg = F.assign(O, S);
    let o = 0;
    for (let i = 0; i < n; i++) {
      if (i === fixed0) { out[i] = 0; continue; }
      const a = asg[o++];
      out[i] = a < 0 ? -1 : a + (fixed0 >= 0 ? 1 : 0);
    }
    return out;
  }
  // drive one member to world slot `w` (index j): walk facing where he goes,
  // at rest hold the slot looking OUT with held glances
  function driveToSlot(ped, F, w, j, runFloor, dt) {
    const dx = w.x - ped.pos.x, dz = w.z - ped.pos.z, d = Math.sqrt(dx * dx + dz * dz);
    if (d > 4) ped._protRun = true; else if (d < 1.5) ped._protRun = false;   // catch-up gait, with hysteresis
    const speed = runFloor || ped._protRun ? RUN_SPEED : WALK_SPEED;
    let face = null, strafe = false;
    if (!F.moving && (arrived(ped) || d < 0.6)) { face = F.scan(j, w.face, dt); strafe = true; }
    order(ped, w.x, w.z, speed, face, strafe, w.vx, w.vz, 0.25);
    return d;
  }

  // ============================================================
  //  MEMBER LIFECYCLE — spawn/drive/despawn (the refactored officials.js code)
  // ============================================================
  function jobFor(detail) {
    if (detail.fundingSource === "treasury") return "secret service";
    if (detail.fundingSource === "gang") return "gang muscle";           // never actually spawned by this path (see detailOf)
    return "hired security";
  }

  // top up memberPedRefs to memberCount, spawning at (x,z) with the detail's
  // current gear loadout. Cheap no-op once the roster is full.
  // `standing` (runtime, never saved) is bodies the STATE owes a principal on
  // top of memberCount: the President's detail of five. militia.js's headcount
  // test reads memberCount only, so a standing detail never becomes a militia.
  function spawnMembers(detail, A, x, z, spawnRng) {
    if (!detail || !A || !A.root || !CBZ.cityMakePed) return;
    const r = spawnRng || rng;
    const gear = GEAR[clamp(detail.gearTier | 0, 0, 2)];
    const want = Math.max(0, (detail.memberCount | 0) + (detail.standing | 0));
    let guard = 0;
    while (detail.memberPedRefs.length < want && guard++ < HIRE_CAP + 8) {
      const i = detail.memberPedRefs.length;
      const ang = (i / Math.max(1, want)) * Math.PI * 2;
      const px = x + Math.cos(ang) * 1.7, pz = z + Math.sin(ang) * 1.7;
      let q = null;
      try {
        // THE SHARED POST (city/occupy.js) — same four lines, one call.
        // Degrade-safe: without occupy.js the inline branch is the prior code.
        const o = {
          src: "protection:detail", rng: r, parent: A.root, controlled: true,
          archetype: "security", job: jobFor(detail), wealth: 0.4,
          armed: true, weapon: gear.weapon, aggr: 0.6, hp: gear.hp,
        };
        if (CBZ.cityPostNpc) q = CBZ.cityPostNpc(px, pz, o);
        else {
          q = CBZ.cityMakePed(px, pz, r, o);
          if (q) { A.root.add(q.group); CBZ.cityPeds.push(q); }
        }
      } catch (e) { q = null; }
      if (!q) break;
      q.controlled = true; q.ammo = gear.ammo; q.maxHp = gear.hp;
      q._protUnit = detail.id;
      // the Secret Service wear dark suits (outfits.js's own two-piece suit)
      if (detail.fundingSource === "treasury") dressAs(q, "suit");
      if (CBZ.cityRelShift) CBZ.cityRelShift(q, "recruited", 0.5);   // a fresh hire starts with SOME goodwill, not none
      detail.memberPedRefs.push(q);
    }
  }
  function removePed(p) {
    if (!p) return;
    if (CBZ.cityUnpostNpc) { CBZ.cityUnpostNpc(p); return; }         // the matching half of the shared post
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

  // escort formation for a PED principal (officials.js's officeholders):
  // the same diamond the President's detail walks (formationSlot below),
  // through the same frame. A suborned member (see suborn()) stands down for
  // its 30s window instead.
  const _escAsg = [], _escM = [];
  function driveEscort(detail, principal, dt, mode) {
    if (!detail || !principal || principal.dead) return;
    const F = frameOf(detail); if (!F) return;
    F.update(principal.pos.x, principal.pos.z, principal.group ? principal.group.rotation.y : null, dt);
    const peds = detail.memberPedRefs;
    _escM.length = 0;
    for (let i = 0; i < peds.length; i++) {
      const gd = peds[i]; if (!gd || gd.dead) continue;
      if ((gd._subornT || 0) > 0) { release(gd); gd.state = "idle"; gd.speed = 0; continue; }   // stepped aside
      _escM.push(gd);
      CBZ.moves.motor(gd);                                // assignment keys on the motor id
    }
    const n = _escM.length; if (!n) return;
    const W = frameSlots(detail, n, mode || "open", dt);
    frameAssign(detail, _escM, n, -1, _escAsg);
    for (let i = 0; i < n; i++) {
      const gd = _escM[i], j = _escAsg[i]; if (j < 0) continue;
      gd.state = "walk";
      driveToSlot(gd, F, W[j], j, 0, dt);
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
      if ((gd._subornT || 0) > 0) { release(gd); gd.state = "idle"; gd.speed = 0; continue; }
      const p = posts[i % posts.length];
      gd.state = "walk";
      order(gd, p.x, p.z, WALK_SPEED, null, false, 0, 0, 0.4);
    }
  }
  function driveDetail(detail, principal, dt, mode) {
    if (detail.formation === "posted") driveEscortPosted(detail, dt);
    else driveEscort(detail, principal, dt, mode);
  }

  // suborn/quit timers + the escort/posted branch, shared by every detail
  // regardless of who owns it (officials.js drives ITS OWN sid-details
  // inline; this per-frame sweep only needs to decrement suborn windows for
  // ALL of them, and separately drives the "player" details end to end).
  const MANSION_DETAIL = { id: "mansion", memberPedRefs: [] };
  function tickSubornPed(gd, dt) {
    if (!gd || (gd._subornT || 0) <= 0) return;
    gd._subornT -= dt;
    if (gd._subornT <= 0) { gd._subornT = 0; gd.surrender = false; gd.poseHandsUp = false; }
  }
  function tickSuborn(dt) {
    for (let i = 0; i < MS.units.length; i++) tickSubornPed(MS.units[i].ped, dt);
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
    if (CBZ.city) CBZ.city.note("Hired security (" + gear.weapon + ") · " + det.memberCount + "/" + HIRE_CAP + " on your detail.", 2.6);
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
    // THE FOLLOW lives in the security tick (35.795, driveDetailAroundPlayer):
    // the same diamond, alert and shield logic as the President's detail.
    // city/boarding.js still seats these bodies in your car
    // (CBZ.boardingHolds is honoured there).
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
          if (CBZ.cityFeed) CBZ.cityFeed("Detail reinforced after an attempt on " + (ped.name || "the officeholder"), "#ffd76a");
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
            if (CBZ.cityFeed) CBZ.cityFeed("" + nm + " walks off the detail, the grudge finally won.", "#ff9e6b");
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
          if (CBZ.cityFeed) CBZ.cityFeed("Couldn't make payroll · " + nm + " walked off the job.", "#ff6a5e");
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
    // the Mansion's gate officers and roof teams answer to the same price
    const det = detailContaining(ped) || (ped && ped._protUnit === "mansion" ? MANSION_DETAIL : null);
    if (!det) return { ok: false, reason: "not on a protection detail" };
    const rel = CBZ.cityRel ? CBZ.cityRel(ped) : null;
    if (!rel) return { ok: false, reason: "no relationship to read" };
    if ((rel.fear || 0) + (rel.respect || 0) <= 120) return { ok: false, reason: "not swayed, needs fear+respect > 120" };
    const cost = Math.round(SUBORN_BASE_COST * (1 + Math.max(0, rel.loyalty || 0) / 100));
    if (!CBZ.city || !CBZ.city.canAfford(cost)) return { ok: false, reason: "can't afford", cost };
    CBZ.city.spend(cost);
    ped._subornT = SUBORN_WINDOW;
    // MIGRATED to city/loyalty.js's CBZ.citySurrender. A BRIBED guard steps
    // aside — he keeps his sidearm and he is nobody's prisoner, so this is the
    // transient form. The original three-field write is the degrade fallback.
    if (CBZ.citySurrender) CBZ.citySurrender(ped, { hold: SUBORN_WINDOW, fear: 0, panic: false });
    else { ped.surrender = true; ped.poseHandsUp = true; ped.rage = null; }
    if (CBZ.cityFeed) CBZ.cityFeed("" + (ped.name || "A guard") + " steps aside for " + SUBORN_WINDOW + "s.", "#7ed957");
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
  //  THE PRESIDENT'S SECURITY — see "THE PRESIDENT'S SECURITY" in the header.
  //  Everything below runs in ONE tick (35.795, right after power.js's ring
  //  pass at 35.79, so a ring slot we move this frame is the one police.js's
  //  posted brain walks to next frame). Decisions (threat scans, the gate,
  //  the counter-snipers) run at ~4-5 Hz; only the walking runs per frame.
  // ============================================================
  const PRES_BASE = 5;               // shift leader + 4 agents: the standing detail of a head of state
  const POSTS_NEAR = 180, POSTS_FAR = 260;
  const FORCE_SPAWN_T = 2.0;         // seconds a body may wait for the camera to look away
  const CALM_DECAY = 30;             // seconds of quiet before a posture stands down
  const SNIPER_RANGE = 250;
  const GUNFIRE_R = 60, DRAWN_R = 15, SHIELD_R = 1.15;
  const LINE_GAP = 3.2;              // seconds between two barked lines from one detail

  let clock = 0;                     // module seconds (sim time, from dt)

  function hyp(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return Math.sqrt(dx * dx + dz * dz); }
  function playerActor() { return (CBZ.city && CBZ.city.playerActor) || CBZ.player || null; }
  function isPlayerBody(a) { return !!a && (a === CBZ.player || a === playerActor() || a.isPlayer); }
  function safeSpot(x, z, y) {
    if (!CBZ.npcTransitionSafe) return true;
    try { return !!CBZ.npcTransitionSafe(x, z, { minDistance: 3, y: y != null ? y + 1.05 : undefined }); } catch (e) { return true; }
  }
  function say(ped, text, col) {
    if (!ped || ped.dead || !CBZ.citySay) return;
    try { CBZ.citySay(ped, text, col || "#dfe8f5", 2.6); } catch (e) {}
  }
  function pres() { return CBZ.presidency || null; }
  function presCurrent() {
    const Pz = pres();
    if (!Pz || typeof Pz.current !== "function") return null;
    try { return Pz.current(); } catch (e) { return null; }
  }
  function emitPres(evt, payload) {
    const Pz = pres();
    if (Pz && typeof Pz.emit === "function") { try { Pz.emit(evt, payload); } catch (e) {} }
  }
  function lockActive() {
    const Pz = pres();
    if (!Pz || typeof Pz.lockdown !== "function") return false;
    try { const L = Pz.lockdown(); return !!(L && L.active); } catch (e) { return false; }
  }
  function mansionSite() {
    const Pz = pres();
    if (Pz && typeof Pz.site === "function") { try { const s = Pz.site(); if (s) return s; } catch (e) {} }
    const L = CBZ.govComplexes;
    if (Array.isArray(L)) for (let i = 0; i < L.length; i++) if (L[i] && L[i].id === "execmansion" && L[i].rect) return L[i];
    return null;
  }
  // read at the 2 Hz spawn beat, not per frame (the export copies every room)
  let _officeRoom = null;
  function officeRoom() { return _officeRoom; }
  function readOfficeRoom() {
    if (!CBZ.presidentInteriorRooms) return null;
    let rooms = null;
    try { rooms = CBZ.presidentInteriorRooms(); } catch (e) { rooms = null; }
    if (!rooms) return null;
    for (let i = 0; i < rooms.length; i++) if (rooms[i] && rooms[i].key === "ovaloffice") return rooms[i];
    return null;
  }
  function motorcadeLive() {
    const M = CBZ.motorcade;
    if (!M || typeof M.active !== "function") return null;
    try { return M.active() || null; } catch (e) { return null; }
  }
  function publicNow() {
    const PP = CBZ.presidentPublic;
    if (!PP || typeof PP.now !== "function") return null;
    try { return PP.now() || null; } catch (e) { return null; }
  }
  // the detail's own rifles never count as a threat to the man they guard
  function friendly(p) {
    if (!p) return true;
    return !!(p._protUnit || p._powerOf || p._vipGuard || p.kind === "cop" || p.isFamily ||
      p.organization === "military" || p._venueStaff || p.companion);
  }
  function longGunName(w) { return /rifle|carbine|ak|sniper|lmg|shotgun|rocket|bazooka|launcher/i.test(String(w || "")); }
  function playerLongGunOut() {
    if (!(CBZ.cityHasGun && CBZ.cityHasGun())) return false;
    const w = CBZ.currentGun ? CBZ.currentGun() : (CBZ.equippedWeapon ? CBZ.equippedWeapon() : null);
    if (!w) return false;
    return w.slot === "rifle" || w.slot === "long" || w.id === "lmg";
  }
  function playerCarries() {
    // a magnetometer finds metal: any weapon in the inventory trips it
    const inv = CBZ.weaponInventory;
    return !!(inv && inv.length);
  }
  function playerAimsAt(body) {
    if (!body || !(CBZ.isAimingWeapon && CBZ.isAimingWeapon()) || typeof CBZ.aimedActor !== "function") return false;
    let a = null;
    try { a = CBZ.aimedActor(300); } catch (e) { a = null; }
    return !!(a && a.actor === body);
  }

  // ------------------------------------------------------------
  //  THE FORMATION — pure geometry, no engine reads (node-tested).
  //  Slot i in the PRINCIPAL'S frame: f = metres ahead of him, s = metres to
  //  his side, face = the yaw offset (from his heading) the agent looks along.
  //    0 shift leader  at his shoulder, half a step back
  //    1 point         ahead            2/3 flanks        4 tail
  //    5+ an outer ring, evenly spread
  //  mode: "open" (3 m diamond), "crowd" (2 m), "door" (single file through
  //  a doorway), "shield" (a 1.15 m wall of bodies around him).
  //  Every agent looks OUT along his own slot's bearing.
  // ------------------------------------------------------------
  function formationSlot(i, n, mode, out) {
    out = out || { f: 0, s: 0, face: 0 };
    let f = 0, s = 0;
    if (mode === "door") {
      if (i === 0) { f = -0.9; s = 0.55; }
      else if (i === 1) { f = 1.6; s = 0; }
      else { f = -1.0 - (i - 1) * 1.15; s = 0; }   // a stride and a half apart: close, never touching
      out.f = f; out.s = s;
      out.face = i === 1 ? 0 : Math.PI;
      if (i === 0) out.face = Math.atan2(s, f);
      return out;
    }
    const r = mode === "shield" ? SHIELD_R : mode === "crowd" ? 2.0 : 3.0;
    if (i === 0) { const k = Math.min(1.0, r * 0.4); f = -k; s = k; }
    else if (i === 1) { f = r; s = 0; }
    else if (i === 2) { f = 0.15 * r; s = -r; }
    else if (i === 3) { f = 0.15 * r; s = r; }
    else if (i === 4) { f = -r; s = 0; }
    else {
      const m = Math.max(1, n - 5), k = i - 5;
      const a = ((k + 0.5) / m) * Math.PI * 2, R2 = r * 1.45;
      f = Math.cos(a) * R2; s = Math.sin(a) * R2;
    }
    out.f = f; out.s = s; out.face = Math.atan2(s, f);
    return out;
  }
  // ------------------------------------------------------------
  //  LOCOMOTION — every body here moves by ped.moveOrder (order() above).
  //  goTo keeps its old call shape for the brain branches: walk to (x,z),
  //  and once there hold `face`. `faceAt` = a threat to square up to: the
  //  body faces it the whole way and side-steps (strafe) into position.
  // ------------------------------------------------------------
  function setTarget(ped, x, z) { if (ped.target && ped.target.set) ped.target.set(x, 0, z); }
  function goTo(ped, x, z, run, dt, face, confront, faceAt) {
    ped.state = confront ? "confront" : "walk";
    const dx = x - ped.pos.x, dz = z - ped.pos.z, d = Math.sqrt(dx * dx + dz * dz);
    if (d > 8 && !faceAt) {
      // a real walk (to a door, across the grounds): hand it to the routed
      // mover (target + pedNav round the walls); the order takes over for the
      // last few metres, where the arrival and the held facing matter
      release(ped);
      setTarget(ped, x, z);
      ped.path = null; ped.pause = 0; ped.finalGoal = null; ped._boardRun = !!run;
      return d;
    }
    if (faceAt) return order(ped, x, z, run ? RUN_SPEED : WALK_SPEED, yawTo(ped, faceAt.pos.x, faceAt.pos.z), true, 0, 0, 0.3);
    return order(ped, x, z, run ? RUN_SPEED : WALK_SPEED, arrived(ped) ? face : null, false, 0, 0, 0.3);
  }
  function teleport(ped, x, z, y) {
    ped.pos.x = x; ped.pos.z = z; ped.path = null; ped._boardRun = false;
    setTarget(ped, x, z);
    if (CBZ.cityFloorPed) { try { CBZ.cityFloorPed(ped, y || 0); } catch (e) {} }
    else ped.pos.y = y || 0;
    if (CBZ.moves) CBZ.moves.reset(CBZ.moves.motor(ped), ped.pos);   // a teleport is not a stride
  }
  // catch-up: a body far from where it belongs moves there only when neither
  // end is on screen, or after FORCE_SPAWN_T of trying (a harness cannot
  // look away, and a detail left 200 m behind is worse than a pop).
  function relocateIfFar(ped, x, z, y, far, dt) {
    const d = hyp(ped.pos.x, ped.pos.z, x, z) + Math.abs((ped.pos.y || 0) - (y || 0)) * 4;
    if (d < far) { ped._protLagT = 0; return false; }
    ped._protLagT = (ped._protLagT || 0) + dt;
    if (ped._protLagT > FORCE_SPAWN_T + 0.5 || (safeSpot(ped.pos.x, ped.pos.z, ped.pos.y) && safeSpot(x, z, y))) {
      teleport(ped, x, z, y); ped._protLagT = 0; return true;
    }
    return false;
  }
  function engage(ped, t) {
    if (!t || t.dead) return;
    release(ped);                     // the fight brain (peds.js + combat_iq) moves him now
    ped.rage = t; ped.state = "fight"; ped.path = null; ped.pause = 0; ped._boardRun = false;
    ped.fear = 0; ped.alarmed = Math.max(ped.alarmed || 0, 8);
    if (ped.armed && ped.ammo != null && ped.ammo < 8) ped.ammo = 60;
  }
  function disengage(ped) { if (ped.rage) { ped.rage = null; if (ped.state === "fight") ped.state = "walk"; } }

  // ------------------------------------------------------------
  //  NOISE — what the detail HEARS. Every alarm in the game funnels through
  //  CBZ.cityAlarm (peds.js; a player's shot, a body hit, a body dropping)
  //  and every blast through CBZ.cityExplosion. Both are wrapped once, the
  //  way wildlife.js and fortresponse.js wrap them (markers carried
  //  forward), into a fixed ring of recent events. No allocation per event.
  // ------------------------------------------------------------
  const NOISE = [];
  for (let i = 0; i < 16; i++) NOISE.push({ x: 0, z: 0, t: -99, off: null, loud: 0, blast: false });
  let noiseHead = 0;
  function noteNoise(x, z, off, loud, blast) {
    const n = NOISE[noiseHead]; noiseHead = (noiseHead + 1) % NOISE.length;
    n.x = +x || 0; n.z = +z || 0; n.t = clock; n.off = off || null; n.loud = loud || 0; n.blast = !!blast;
  }
  let wrappedAlarm = false, wrappedBoom = false;
  function installEars() {
    if (!wrappedAlarm && typeof CBZ.cityAlarm === "function") {
      const prev = CBZ.cityAlarm;
      if (!prev._protWrapped) {
        const w = function (x, z, radius, intensity, offender) {
          try { noteNoise(x, z, offender, intensity || 1, false); } catch (e) {}
          return prev.apply(this, arguments);
        };
        for (const k in prev) w[k] = prev[k];
        w._protWrapped = true;
        CBZ.cityAlarm = w;
      }
      wrappedAlarm = true;
    }
    if (!wrappedBoom && typeof CBZ.cityExplosion === "function") {
      const prevB = CBZ.cityExplosion;
      if (!prevB._protWrapped) {
        const wb = function (x, z, opts) {
          try { noteNoise(x, z, null, 3, true); } catch (e) {}
          return prevB.apply(this, arguments);
        };
        for (const k in prevB) wb[k] = prevB[k];
        wb._protWrapped = true;
        CBZ.cityExplosion = wb;
      }
      wrappedBoom = true;
    }
  }

  // ------------------------------------------------------------
  //  POSTURE — one record per protected principal. The President has one;
  //  the player's hired detail has one. normal -> alert -> evac.
  // ------------------------------------------------------------
  const RANK = { normal: 0, alert: 1, evac: 2 };
  const LEVEL = ["normal", "alert", "evac"];
  function newPosture(key) {
    return { key: key, posture: "normal", calmT: 0, reason: null, at: { x: 0, z: 0 }, threat: null, hostile: false,
      lineT: 0, hpMemo: null, pend: 0, pendReason: null, pendAt: { x: 0, z: 0 }, pendThreat: null, pendHostile: false, since: 0 };
  }
  const PRES = newPosture("president");
  const HIRED = newPosture("player");
  function raise(ps, level, reason, x, z, threat, hostile) {
    if (level > ps.pend) { ps.pend = level; ps.pendReason = reason; ps.pendAt.x = x; ps.pendAt.z = z; }
    if (threat && !threat.dead && (!ps.pendThreat || hostile)) ps.pendThreat = threat;
    if (hostile) ps.pendHostile = true;
  }
  // fold what the scan found into the posture; returns true on a change
  function settle(ps, dtScan, floorLevel) {
    const cur = RANK[ps.posture];
    let changed = false;
    if (ps.pend > 0) {
      ps.calmT = 0;
      if (ps.pendThreat && !ps.pendThreat.dead && ps.pendThreat !== ps.threat) {
        ps.threat = ps.pendThreat; ps.hostile = ps.pendHostile;
      } else if (ps.pendHostile) ps.hostile = true;
      if (!ps.threat || ps.threat.dead) ps.hostile = false;
      if (ps.pend > cur) {
        ps.posture = LEVEL[ps.pend]; ps.reason = ps.pendReason || ps.reason;
        ps.at.x = ps.pendAt.x; ps.at.z = ps.pendAt.z; ps.since = clock; changed = true;
      }
    } else {
      ps.calmT += dtScan;
      if (ps.threat && (ps.threat.dead || ps.calmT > 6)) { ps.threat = null; ps.hostile = false; }
      const floor = floorLevel | 0;
      if (cur > floor && ps.calmT >= CALM_DECAY) {
        ps.posture = LEVEL[floor]; ps.reason = floor ? "lockdown" : null; ps.since = clock; changed = true;
        ps.threat = null; ps.hostile = false;
      }
    }
    if (floorLevel && RANK[ps.posture] < floorLevel) { ps.posture = LEVEL[floorLevel]; ps.reason = "lockdown"; changed = true; }
    ps.pend = 0; ps.pendReason = null; ps.pendThreat = null; ps.pendHostile = false;
    return changed;
  }

  // ------------------------------------------------------------
  //  THE MANSION POSTS — real bodies while the player is within 180 m of the
  //  grounds, released past 260 m. Deterministic stations from the geometry
  //  govcomplex.js published (site.security). Killed stays dead until the
  //  next day (a replacement is on shift in the morning).
  // ------------------------------------------------------------
  const MS = {
    site: null, sec: null, units: [], live: false, hostiles: [], hostileT: 0,
    challenge: null, gateHostile: null, gateHostileT: 0, pSide: 1, lampT: 0, gateLineT: 0,
    lock: false, scanT: 0, gateT: 0, snipeT: 0,
  };
  function unitSpec(id, role, x, y, z, face, extra) {
    const u = { id: id, role: role, x: x, y: y || 0, z: z, face: face || 0, ped: null, lost: false, waitT: 0,
      lockdown: false, team: null, wp: 0, aimT: 0, fireT: 0, target: null, called: false };
    if (extra) for (const k in extra) u[k] = extra[k];
    return u;
  }
  function bindMansion() {
    const site = mansionSite();
    const sec = site && site.security;
    if (site === MS.site && sec === MS.sec) return !!sec;
    releasePosts();
    MS.site = site; MS.sec = sec || null; MS.units.length = 0; MS.challenge = null; MS.gateHostile = null;
    if (!sec) return false;
    const gp = sec.gatePosts || [];
    for (let i = 0; i < gp.length; i++) {
      MS.units.push(unitSpec("gate:" + gp[i].id, "gate", gp[i].x, 0, gp[i].z, gp[i].face, { lockdown: !!gp[i].lockdown }));
    }
    const rp = (sec.roof && sec.roof.posts) || [];
    for (let i = 0; i < rp.length; i++) {
      MS.units.push(unitSpec("roof:" + rp[i].team + ":" + rp[i].role, "counter-sniper", rp[i].x, rp[i].y, rp[i].z, rp[i].face,
        { team: rp[i].team, spotter: rp[i].role === "spotter" }));
    }
    const w = sec.walk || [];
    if (w.length >= 2) {
      MS.units.push(unitSpec("walk:0", "patrol", w[0].x, 0, w[0].z, 0, { wp: 1 }));
      const h = (w.length / 2) | 0;
      MS.units.push(unitSpec("walk:1", "patrol", w[h].x, 0, w[h].z, 0, { wp: (h + 1) % w.length }));
    }
    return true;
  }
  function releasePosts() {
    for (let i = 0; i < MS.units.length; i++) dropUnit(MS.units[i]);
    MS.live = false;
  }
  function dropUnit(u) {
    const p = u.ped; u.ped = null; u.target = null;
    if (!p) return;
    if (p._post && CBZ.cityPostRelease) { try { CBZ.cityPostRelease(p, "released"); } catch (e) {} }
    if (p.dead) return;
    removePed(p);
  }
  function dressAs(ped, catId) {
    if (!ped || !ped.char || !CBZ.cityOutfitCatalog || !CBZ.cityRecolorRig) return;
    try {
      const cat = CBZ.cityOutfitCatalog();
      const fit = cat && cat[catId];
      if (fit && fit.colors) CBZ.cityRecolorRig(ped.char, fit.colors, fit);
    } catch (e) {}
  }
  function spawnUnit(u, A) {
    if (!CBZ.cityPostNpc || !A || !A.root) return null;
    const o = { src: "protection:mansion", parent: A.root, face: u.face, controlled: true, wealth: 0.45 };
    if (u.role === "gate") {
      Object.assign(o, { kind: "security", archetype: "security", job: "uniformed division officer", armed: true, weapon: "SMG", aggr: 0.7, hp: 170 });
    } else if (u.role === "counter-sniper") {
      Object.assign(o, { kind: "security", archetype: "security", job: "counter-sniper", armed: true, weapon: u.spotter ? "Rifle" : "Sniper",
        aggr: 0.7, hp: 170, pin: true, floorY: u.y });
    } else {
      Object.assign(o, { kind: "security", archetype: "security", job: "secret service", armed: true, weapon: "SMG", aggr: 0.7, hp: 170 });
    }
    let q = null;
    try { q = CBZ.cityPostNpc(u.x, u.z, o); } catch (e) { q = null; }
    if (!q) return null;
    q.controlled = true; q.ammo = u.role === "counter-sniper" ? 40 : 120; q.maxHp = 170;
    q._protUnit = "mansion"; q._protRole = u.role; q.organization = "state"; q.organizationLoyalty = 100;
    q.nameKnown = false;
    if (CBZ.syncActorWeapon) { try { CBZ.syncActorWeapon(q); } catch (e) {} }
    if (u.role === "gate") dressAs(q, "police");
    else if (u.role === "patrol") dressAs(q, "suit");
    if (u.role === "gate" && CBZ.cityPostStand) {
      // THE SHARED POST RECORD (garrison.js) — its stationed brain (hold the
      // slot, leash, bolt and come back) runs this officer between challenges;
      // `driven` because this file decides when the brain gets the body.
      try {
        CBZ.cityPostStand(q, {
          x: u.x, z: u.z, face: u.face, kind: "checkpoint", relaxed: true, driven: true,
          tag: "protection:gate:" + u.id, job: "uniformed division officer", leash: 18, senses: 45,
          threat: function (actor) { return gateThreatFor(actor); },
        });
      } catch (e) {}
    }
    return q;
  }
  function gateThreatFor(actor) {
    if (!actor || (actor._subornT || 0) > 0) return null;
    if (MS.gateHostile && !MS.gateHostile.dead && hyp(MS.gateHostile.pos.x, MS.gateHostile.pos.z, actor.pos.x, actor.pos.z) < 50) return MS.gateHostile;
    if (PRES.hostile && PRES.threat && !PRES.threat.dead && hyp(PRES.threat.pos.x, PRES.threat.pos.z, actor.pos.x, actor.pos.z) < 50) return PRES.threat;
    let best = null, bd = 42;
    for (let i = 0; i < MS.hostiles.length; i++) {
      const h = MS.hostiles[i]; if (!h || h.dead) continue;
      const d = hyp(h.pos.x, h.pos.z, actor.pos.x, actor.pos.z);
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }
  function nearMansion(site, P, r) {
    const R = site.rect;
    const dx = Math.max(R.minX - P.pos.x, 0, P.pos.x - R.maxX);
    const dz = Math.max(R.minZ - P.pos.z, 0, P.pos.z - R.maxZ);
    return Math.sqrt(dx * dx + dz * dz) < r;
  }
  function tickPostSpawns(dt, A, P) {
    const site = MS.site;
    if (!site || !MS.sec) return;
    if (!MS.live) {
      if (!nearMansion(site, P, POSTS_NEAR)) return;
      MS.live = true;
    } else if (!nearMansion(site, P, POSTS_FAR)) { releasePosts(); return; }
    for (let i = 0; i < MS.units.length; i++) {
      const u = MS.units[i];
      if (u.ped) {
        if (u.ped.dead) { u.lost = true; if (u.ped._post && CBZ.cityPostRelease) { try { CBZ.cityPostRelease(u.ped, "dead"); } catch (e) {} } u.ped = null; continue; }
        if (CBZ.cityPeds && CBZ.cityPeds.indexOf(u.ped) < 0) { u.ped = null; continue; }   // swept, not shot: re-man
        if (u.lockdown && !MS.lock) { dropUnit(u); }
        continue;
      }
      if (u.lost) continue;
      if (u.lockdown && !MS.lock) continue;
      if (CBZ.citySpawnDraining) continue;
      u.waitT += dt;
      if (u.waitT < FORCE_SPAWN_T && !safeSpot(u.x, u.z, u.y)) continue;
      u.ped = spawnUnit(u, A);
      u.waitT = 0;
    }
  }

  // ---- per-frame: the gate officers, the wall walk, the roof ----
  function driveGateUnit(u, dt) {
    const q = u.ped;
    if ((q._subornT || 0) > 0) { release(q); q.state = "idle"; q.speed = 0; disengage(q); return; }
    const ch = MS.challenge;
    if (ch && ch.who && !ch.who.dead && !ch.hostile) {
      // THE CHALLENGE: weapons up, eyes on him, nobody walks toward him.
      disengage(q);
      goTo(q, u.x, u.z, false, dt, null, true, ch.who);
      return;
    }
    if (q._post && CBZ.cityPostTick) { release(q); try { CBZ.cityPostTick(q, dt); return; } catch (e) {} }
    const t = gateThreatFor(q);
    if (t) { engage(q, t); return; }
    disengage(q);
    goTo(q, u.x, u.z, false, dt, u.face, false);
  }
  function drivePatrolUnit(u, dt) {
    const q = u.ped, w = MS.sec.walk;
    if ((q._subornT || 0) > 0) { release(q); q.state = "idle"; q.speed = 0; disengage(q); return; }
    const t = gateThreatFor(q);
    if (t && hyp(t.pos.x, t.pos.z, q.pos.x, q.pos.z) < 35) { engage(q, t); return; }
    disengage(q);
    if (PRES.posture !== "normal" && PRES.threat && !PRES.threat.dead) {
      // on alert the walk stops where it is and looks where the trouble is
      if (u.holdX == null) { u.holdX = q.pos.x; u.holdZ = q.pos.z; }
      goTo(q, u.holdX, u.holdZ, false, dt, null, true, PRES.threat);
      return;
    }
    u.holdX = null;
    const wp = w[u.wp % w.length];
    if (hyp(q.pos.x, q.pos.z, wp.x, wp.z) < 2.0) u.wp = (u.wp + 1) % w.length;
    const nx = w[u.wp % w.length];
    // the wall walk is a waypoint chain: pass through each at pace (leg)
    q.state = "walk";
    order(q, nx.x, nx.z, q.baseSpeed || 1.6, null, false, 0, 0, 0.5);
    q.moveOrder.leg = true;
  }
  function driveRoofUnit(u, dt) {
    const q = u.ped;
    if (u.target && !u.target.dead && (q._subornT || 0) <= 0) turnTo(q, yawTo(q, u.target.pos.x, u.target.pos.z), dt);
  }

  // ---- THE COUNTER-SNIPERS (4 Hz) ----
  // A rifle on a roof sees 250 m. Peds.js's own fight brain tops out at a
  // sniper's 46 m band (combat_iq.js), so a long shot is taken here: aim,
  // a real line-of-fire test (los.js), the gun's own voice, a tracer, and
  // the same damage paths peds.js uses. Hard, not impossible: past 250 m,
  // behind cover, or with the team dead or bribed, nobody up there can
  // reach you.
  function snipeCandidate(sx, sz, body) {
    const pa = playerActor(), P = CBZ.player;
    const cur = presCurrent();
    const playerIsPres = !!(cur && cur.kind === "player");
    let best = null, bd = SNIPER_RANGE, fast = 0;
    if (P && !P.dead && !playerIsPres && pa) {
      const d = hyp(P.pos.x, P.pos.z, sx, sz);
      if (d < SNIPER_RANGE) {
        let why = 0;
        if (MS.gateHostile === pa || (PRES.hostile && PRES.threat === pa)) why = 2;
        else if (body && playerAimsAt(body)) why = 2;
        else if (playerLongGunOut() && CBZ.isAimingWeapon && CBZ.isAimingWeapon()) why = 1;
        if (why) { best = pa; bd = d; fast = why; }
      }
    }
    if (!best || fast < 2) {
      for (let i = 0; i < MS.hostiles.length; i++) {
        const h = MS.hostiles[i]; if (!h || h.dead) continue;
        const d = hyp(h.pos.x, h.pos.z, sx, sz);
        if (d < bd) { bd = d; best = h; fast = 2; }
      }
    }
    return best ? { t: best, d: bd, why: fast } : null;
  }
  const _from = { x: 0, y: 0, z: 0 }, _to = { x: 0, y: 0, z: 0 };
  function longShot(q, t, d) {
    _from.x = q.pos.x; _from.y = (q.pos.y || 0) + 1.45; _from.z = q.pos.z;
    const isP = isPlayerBody(t);
    _to.x = t.pos.x; _to.y = (t.pos.y || 0) + (isP ? 1.4 : 1.25); _to.z = t.pos.z;
    if (CBZ.clearLineOfFire && !CBZ.clearLineOfFire(_from.x, _from.y, _from.z, _to.x, _to.y, _to.z)) return false;
    if (CBZ.actorAimAt) { try { CBZ.actorAimAt(q, t); } catch (e) {} }
    if (CBZ.tracer) { try { CBZ.tracer(_from, _to, { muzzleScale: 1.2 }); } catch (e) {} }
    const P = CBZ.player;
    if (CBZ.gunVoice) { try { CBZ.gunVoice("Sniper", P ? hyp(_from.x, _from.z, P.pos.x, P.pos.z) : 0); } catch (e) {} }
    let pHit = 0.92 - d / 480;
    if (isP && P && P._protSpeed > 3.5) pHit -= 0.2;               // a running man is a hard shot
    if (Math.random() > Math.max(0.2, pHit)) return true;          // runtime feel: a miss
    if (isP) {
      if (CBZ.cityHurtPlayer) { try { CBZ.cityHurtPlayer(72, q.pos.x, q.pos.z, "shot by a counter-sniper", false, q); } catch (e) {} }
    } else {
      t.hp -= 95;
      if (CBZ.bodyWound) { try { CBZ.bodyWound(t, { x: t.pos.x, y: (t.pos.y || 0) + 1.3, z: t.pos.z }, { fromX: q.pos.x, fromZ: q.pos.z }); } catch (e) {} }
      if (t.hp <= 0 && CBZ.cityKillPed) { try { CBZ.cityKillPed(t, { fromX: q.pos.x, fromZ: q.pos.z, attacker: q, byPlayer: false, force: 6 }, "shot"); } catch (e) {} }
    }
    return true;
  }
  function tickSnipers(dtScan) {
    const cur = presCurrent();
    const body = cur && cur.ped && !cur.ped.dead ? cur.ped : null;
    for (let i = 0; i < MS.units.length; i++) {
      const u = MS.units[i];
      if (u.role !== "counter-sniper" || !u.ped || u.ped.dead) continue;
      const q = u.ped;
      if ((q._subornT || 0) > 0) { u.target = null; continue; }
      const c = snipeCandidate(q.pos.x, q.pos.z, body);
      if (!c) { u.target = null; u.aimT = 0; u.called = false; continue; }
      if (u.target !== c.t) { u.target = c.t; u.aimT = 0; u.called = false; }
      u.aimT += dtScan;
      if (u.spotter) {
        if (!u.called) { u.called = true; say(q, c.why >= 2 ? "Shooter. I have him." : "Long gun. Watching him.", "#ffd6a0"); }
        continue;
      }
      // the settle: an armed hostile gets under a second, a man merely
      // holding a rifle up gets three seconds to lower it
      const settleT = c.why >= 2 ? 0.9 : 3.0;
      if (c.why === 1 && u.aimT > 0.5) raise(PRES, 1, "long gun", c.t.pos.x, c.t.pos.z, c.t, false);
      if (u.aimT < settleT) continue;
      u.fireT -= dtScan;
      if (u.fireT > 0) continue;
      u.fireT = 1.7 + Math.random() * 0.6;
      if (longShot(q, c.t, c.d)) raise(PRES, 1, "counter-sniper fire", c.t.pos.x, c.t.pos.z, c.t, true);
    }
  }

  // ---- THE GATE (5 Hz): screening, the arm, the bollards, the lamp ----
  function gateOfficer(nearX, nearZ) {
    let best = null, bd = 1e9;
    for (let i = 0; i < MS.units.length; i++) {
      const u = MS.units[i];
      if (u.role !== "gate" || !u.ped || u.ped.dead) continue;
      const d = hyp(u.ped.pos.x, u.ped.pos.z, nearX, nearZ);
      if (d < bd) { bd = d; best = u.ped; }
    }
    return best;
  }
  function gateSay(G, text, force) {
    if (!force && clock - MS.gateLineT < 2.4) return;
    MS.gateLineT = clock;
    say(gateOfficer(G.arch.x, G.arch.z), text, "#ffe0a8");
  }
  function exemptAtGate(p, playerIsPres) {
    if (isPlayerBody(p)) return playerIsPres;
    return friendly(p) || p._govSite || p.organization === "state";
  }
  function carries(p) { return isPlayerBody(p) ? playerCarries() : !!p.armed; }
  function drawn(p) {
    if (isPlayerBody(p)) return !!(CBZ.cityHasGun && CBZ.cityHasGun());
    return !!(p.armed && (p.state === "fight" || p.rage || p.rampage));
  }
  function crossCheck(G, p, sideNow, sidePrev, playerIsPres) {
    if (!(sidePrev > 0 && sideNow < 0)) return;              // inbound across the screening line only
    if (p.pos.x < G.x - 12.6 || p.pos.x > G.x + 12.6) return;
    if (isPlayerBody(p) && CBZ.player && (CBZ.player.driving || CBZ.player._vehicle)) return;
    if (exemptAtGate(p, playerIsPres)) {
      if (isPlayerBody(p)) { G.setLamp("pass"); MS.lampT = 0.9; gateSay(G, "Mr. President.", true); }
      return;
    }
    const inLane = p.pos.x >= G.lane.minX - 0.3 && p.pos.x <= G.lane.maxX;
    const armed = carries(p);
    if (inLane && !armed) { G.setLamp("pass"); MS.lampT = 0.8; return; }
    if (armed) {
      G.setLamp("alarm"); MS.lampT = 0;
      if (CBZ.sfxAt) { try { CBZ.sfxAt("click", G.arch.x, G.arch.z, { vol: 0.9 }); } catch (e) {} }
      gateSay(G, "Sir, step back. Hands where I can see them.", true);
    } else {
      gateSay(G, "Sir! Through the arch, please.", true);
    }
    MS.challenge = { who: p, t: 0, armed: armed, warned: 0, hostile: false };
    raise(PRES, 1, armed ? "armed at the gate" : "gate breach", p.pos.x, p.pos.z, p, false);
  }
  function tickGate(dtScan, playerIsPres) {
    const G = MS.sec.gate;
    const P = CBZ.player;
    // -- the vehicle lane: open for the motorcade and the President's own car
    let wantOpen = false;
    const mc = motorcadeLive();
    if (mc && Array.isArray(mc.cars)) {
      for (let i = 0; i < mc.cars.length; i++) {
        const c = mc.cars[i] && (mc.cars[i].car || mc.cars[i]);
        if (c && c.pos && hyp(c.pos.x, c.pos.z, G.barrier.x, G.barrier.z) < 34) { wantOpen = true; break; }
      }
    }
    if (!wantOpen && playerIsPres && P && (P.driving || P._vehicle) && hyp(P.pos.x, P.pos.z, G.barrier.x, G.barrier.z) < 26) wantOpen = true;
    if (MS.lock && !mc) wantOpen = false;
    G.setArm(wantOpen); G.setBollards(!wantOpen);

    // -- the arch: everybody crossing the screening line inbound
    if (P && !P.dead) {
      const side = P.pos.z > G.lineZ ? 1 : -1;
      crossCheck(G, playerActor() || P, side, MS.pSide, playerIsPres);
      MS.pSide = side;
    }
    const peds = CBZ.cityPeds || [];
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p || p.dead || !p.pos) continue;
      if (Math.abs(p.pos.z - G.lineZ) > 6 || Math.abs(p.pos.x - G.x) > 14) { p._protGate = 0; continue; }
      const side = p.pos.z > G.lineZ ? 1 : -1;
      if (p._protGate) crossCheck(G, p, side, p._protGate, playerIsPres);
      p._protGate = side;
    }
    // -- the challenge resolves
    const ch = MS.challenge;
    if (ch) {
      ch.t += dtScan;
      const w = ch.who;
      const depth = w && w.pos ? G.lineZ - w.pos.z : 0;
      if (!w || w.dead || (w.pos && hyp(w.pos.x, w.pos.z, G.arch.x, G.arch.z) > 70)) { MS.challenge = null; G.setLamp("idle"); }
      else if (!ch.hostile && depth < -2.5) {
        MS.challenge = null; G.setLamp("idle");
        gateSay(G, "Thank you, sir. Move along.", true);
      } else if (!ch.hostile) {
        const aims = isPlayerBody(w) && playerAimsAt(gateOfficer(w.pos.x, w.pos.z));
        if ((ch.armed && ch.t > 1.2 && drawn(w)) || aims || depth > 6.5) {
          ch.hostile = true;
          gateSay(G, ch.armed ? "Gun! Drop it! Drop it!" : "Stop! On the ground!", true);
          MS.gateHostile = w; MS.gateHostileT = 0;
          G.setLamp("alarm");
          raise(PRES, 1, "gate breach", w.pos.x, w.pos.z, w, true);
          if (isPlayerBody(w) && CBZ.cityAddStars) { try { CBZ.cityAddStars(2); } catch (e) {} }
        } else if (depth > 2.5 && ch.warned < 1) { ch.warned = 1; gateSay(G, "Stop right there. Do not take another step.", true); }
        else if (ch.t > 7 && ch.warned < 2) { ch.warned = 2; gateSay(G, "Turn around and walk back out. Now.", true); }
      } else if (ch.hostile && ch.t > 45) { MS.challenge = null; G.setLamp("idle"); }
    }
    if (MS.gateHostile) {
      MS.gateHostileT += dtScan;
      const h = MS.gateHostile;
      if (h.dead || MS.gateHostileT > 60 || hyp(h.pos.x, h.pos.z, G.x, G.z) > 140) { MS.gateHostile = null; }
    }
    if (MS.lampT > 0) { MS.lampT -= dtScan; if (MS.lampT <= 0 && !MS.challenge) G.setLamp("idle"); }
    if (MS.lock && !MS.challenge && G.lamp === "idle") G.setLamp("alarm");
    if (!MS.lock && !MS.challenge && G.lamp === "alarm" && MS.lampT <= 0) G.setLamp("idle");
  }
  function refreshHostiles(site) {
    const H = MS.hostiles; H.length = 0;
    const peds = CBZ.cityPeds || [];
    const cx = site.cx, cz = site.cz;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p || p.dead || friendly(p)) continue;
      if (!(p.rampage || p.organization === "cell" || (p.armed && p.rage && (p.rage._protUnit || p.rage._powerOf || p.rage === PRESBODY.b)))) continue;
      if (hyp(p.pos.x, p.pos.z, cx, cz) > 420) continue;
      H.push(p);
      if (H.length >= 24) break;
    }
  }

  // ------------------------------------------------------------
  //  THE THREAT SCAN (4 Hz) around a principal body.
  // ------------------------------------------------------------
  const PRESBODY = { b: null };
  function scanThreats(ps, body, isPlayerPrincipal, det) {
    const bx = body.pos.x, bz = body.pos.z;
    // (a) what was heard
    for (let i = 0; i < NOISE.length; i++) {
      const n = NOISE[i];
      if (clock - n.t > 1.3) continue;
      const d = hyp(n.x, n.z, bx, bz);
      if (n.blast) { if (d < 70) raise(ps, 2, "explosion", n.x, n.z, null, false); continue; }
      if (d > GUNFIRE_R) continue;
      const off = n.off;
      if (off && (off === body || friendly(off))) { if (d < 40) raise(ps, 1, "gunfire", n.x, n.z, null, false); continue; }
      if (isPlayerPrincipal && off && isPlayerBody(off)) continue;   // his own shots
      if (n.loud < 1.15 && !off) continue;
      const hostile = !!(off && (!isPlayerBody(off) || n.loud >= 1.15));
      raise(ps, d < 25 ? 2 : 1, "gunfire", n.x, n.z, off, hostile);
    }
    // (b) who is standing near him with what
    const peds = CBZ.cityPeds || [];
    let crowd = 0;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p || p.dead || p === body) continue;
      const dx = p.pos.x - bx, dz = p.pos.z - bz;
      if (dx > GUNFIRE_R || dx < -GUNFIRE_R || dz > GUNFIRE_R || dz < -GUNFIRE_R) continue;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < 5 && !p._protUnit && !p._powerOf) crowd++;
      if (friendly(p)) continue;
      const atHim = p.rage === body || (p.rage && (p.rage._protUnit === det || p.rage._powerOf));
      if (p.rampage || p.organization === "cell" || atHim) {
        if (p.armed) raise(ps, d < 30 ? 2 : 1, "armed attacker", p.pos.x, p.pos.z, p, true);
        else if (d < 8) raise(ps, 1, "attacker", p.pos.x, p.pos.z, p, true);
      } else if (p.armed && d < DRAWN_R && (p.state === "fight" || p.state === "confront")) {
        raise(ps, 1, "drawn weapon", p.pos.x, p.pos.z, p, false);
      }
    }
    ps._crowd = crowd;
    // (c) the player, when he is not the man being protected
    if (!isPlayerPrincipal) {
      const P = CBZ.player, pa = playerActor();
      if (P && !P.dead && pa) {
        const d = hyp(P.pos.x, P.pos.z, bx, bz);
        if (d < 70) {
          if (playerAimsAt(body)) raise(ps, 2, "weapon aimed", P.pos.x, P.pos.z, pa, true);
          else if (d < DRAWN_R && CBZ.cityHasGun && CBZ.cityHasGun()) {
            raise(ps, 1, "drawn weapon", P.pos.x, P.pos.z, pa, ((CBZ.game && CBZ.game.wanted) | 0) >= 3);
          }
          if (MS.gateHostile === pa && d < 60) raise(ps, 1, "gate breach", P.pos.x, P.pos.z, pa, true);
        }
      }
    }
    // (d) he was hit
    if (!isPlayerPrincipal) {
      if (ps.hpMemo != null && body.hp < ps.hpMemo - 0.25) raise(ps, 2, "principal hit", bx, bz, ps.threat, !!ps.threat);
      ps.hpMemo = body.hp;
    } else {
      const P = CBZ.player;
      if (ps.hpMemo != null && P.hp < ps.hpMemo - 3 && ps.posture !== "normal") raise(ps, 2, "principal hit", bx, bz, ps.threat, !!ps.threat);
      ps.hpMemo = P.hp;
    }
  }

  // ------------------------------------------------------------
  //  THE PANIC PROTOCOL — what a posture change DOES.
  // ------------------------------------------------------------
  const EV = { ped: null, pin: null, phase: null, t: 0 };   // the NPC president's run inside
  function shoutFor(ps, posture, units, body, isPlayerPrincipal) {
    if (clock - ps.lineT < LINE_GAP) return;
    let speaker = null, bd = 1e9;
    for (let i = 0; i < units.length; i++) {
      const q = units[i]; if (!q || q.dead) continue;
      const d = hyp(q.pos.x, q.pos.z, body.pos.x, body.pos.z);
      const pri = q._protRole === "shift-leader" ? -100 : 0;
      if (d + pri < bd) { bd = d + pri; speaker = q; }
    }
    if (!speaker) return;
    ps.lineT = clock;
    if (posture === "evac") say(speaker, isPlayerPrincipal ? "Sir, with me. Inside, now." : "Move, move! Get him inside!", "#ffb0a0");
    else if (ps.threat && (ps.threat.armed || isPlayerBody(ps.threat))) say(speaker, ps.hostile ? "Gun! Gun! Get down!" : "Gun! Hands! Show me your hands!", "#ffb0a0");
    else say(speaker, "Heads up. Close in.", "#ffd6a0");
  }
  function onPosture(ps, body, isPlayerPrincipal, units) {
    emitPres("security", { level: ps.posture, reason: ps.reason || null, at: { x: ps.at.x, z: ps.at.z } });
    if (ps.posture === "normal") return;
    shoutFor(ps, ps.posture, units, body, isPlayerPrincipal);
    if (ps.posture !== "evac") return;
    // EVAC: whoever owns his body right now takes him out of here
    const now = publicNow();
    if (now && CBZ.presidentPublic && typeof CBZ.presidentPublic.evacuate === "function") {
      try { CBZ.presidentPublic.evacuate(ps.reason || "security"); return; } catch (e) {}
    }
    const mc = motorcadeLive();
    if (mc && CBZ.motorcade && typeof CBZ.motorcade.evacuate === "function") {
      const riding = isPlayerPrincipal ? (mc.principal === "player" || isPlayerBody(mc.principal)) : (mc.principal && mc.principal !== "player" && !isPlayerBody(mc.principal));
      if (riding) { try { CBZ.motorcade.evacuate(ps.reason || "security"); return; } catch (e) {} }
    }
    if (!isPlayerPrincipal) startNpcEvac(body);
  }
  function startNpcEvac(ped) {
    const site = MS.site, sec = MS.sec;
    if (!ped || !sec || !sec.safe || !sec.doors.mansion) return;
    if (EV.ped === ped && EV.phase) return;
    EV.ped = ped; EV.pin = ped.staffPost || EV.pin || (site && site.seatPoint ? { x: site.seatPoint.x, z: site.seatPoint.z, face: site.seatPoint.face } : null);
    ped.staffPost = null; ped.controlled = true; ped.state = "walk"; EV.phase = "door"; EV.t = 0;
  }
  function driveNpcEvac(dt, ps) {
    const p = EV.ped;
    if (!p || !EV.phase) return;
    if (p.dead || (CBZ.cityPeds && CBZ.cityPeds.indexOf(p) < 0)) { EV.ped = null; EV.phase = null; return; }
    const sec = MS.sec; if (!sec || !sec.doors.mansion) { EV.phase = null; return; }
    const door = sec.doors.mansion;
    EV.t += dt;
    if (EV.phase === "door") {
      const ox = door.x - door.nx * 0.6, oz = door.z - door.nz * 0.6;
      if (goTo(p, ox, oz, true, dt, null, false) < 1.4 || EV.t > 12) { EV.phase = "inside"; EV.t = 0; }
    } else if (EV.phase === "inside") {
      if (goTo(p, sec.safe.x, sec.safe.z, true, dt, Math.atan2(-door.nx, -door.nz), false) < 0.9 || EV.t > 10) {
        if (EV.t > 10) teleport(p, sec.safe.x, sec.safe.z, 0);
        EV.phase = "hold"; EV.t = 0;
      }
    } else if (EV.phase === "hold") {
      release(p); p.state = "idle"; p.speed = 0; setTarget(p, p.pos.x, p.pos.z);
      if (ps.posture === "normal") { EV.phase = "return"; EV.t = 0; }
    } else if (EV.phase === "return") {
      const pin = EV.pin;
      if (!pin) { EV.phase = null; EV.ped = null; return; }
      if (goTo(p, pin.x, pin.z, false, dt, pin.face, false) < 0.8 || EV.t > 40) {
        if (EV.t > 40) teleport(p, pin.x, pin.z, 0);
        release(p);
        p.staffPost = { x: pin.x, z: pin.z, face: pin.face };
        p.state = "idle"; p.speed = 0;
        EV.phase = null; EV.ped = null; EV.pin = null;
      }
    }
    if (EV.phase && EV.phase !== "hold" && EV.phase !== "return" && ps.posture !== "evac" && ps.posture !== "alert") EV.phase = "return";
  }
  // power.js's ring around an NPC president: in alert two officers step in
  // between him and the threat; in evac the whole ring closes to a shield.
  // We only move their SLOTS (police.js's posted brain walks them there).
  function shapeRing(ped, ps) {
    if (!CBZ.powerGuardsOf || ps.posture === "normal") return;
    let guards = null;
    try { guards = CBZ.powerGuardsOf(ped); } catch (e) { guards = null; }
    if (!guards || !guards.length) return;
    const t = ps.threat && !ps.threat.dead ? ps.threat : null;
    const tb = t ? Math.atan2(t.pos.x - ped.pos.x, t.pos.z - ped.pos.z) : (ped.group ? ped.group.rotation.y : 0);
    for (let i = 0; i < guards.length; i++) {
      const q = guards[i]; if (!q || q.dead || !q._post) continue;
      let r, a;
      if (ps.posture === "evac") { r = 1.3; a = tb + (i / guards.length) * Math.PI * 2; }
      else if (i < 2) { r = 1.1; a = tb + (i === 0 ? -0.35 : 0.35); }
      else continue;
      q._post.x = ped.pos.x + Math.sin(a) * r; q._post.z = ped.pos.z + Math.cos(a) * r;
      q._post.fx = Math.sin(tb); q._post.fz = Math.cos(tb);
    }
  }

  // ------------------------------------------------------------
  //  THE PLAYER'S DETAIL — follow, indoor posts, alert, shield, evac.
  //  Drives a protection record's own bodies (the President's off_<seat>,
  //  or the player's hired detail) around the PLAYER.
  // ------------------------------------------------------------
  // THE PLAYER'S FRAME: one CBZ.moves formation frame shared by whichever
  // detail is walking with him (the President's, or his hired one). It
  // replaces the old PSTATE heading, which lerped toward the raw per-frame
  // travel direction and snapped on a teleport.
  let PF = null;
  function playerYaw() {
    const pc = CBZ.playerChar;
    return pc && pc.group ? pc.group.rotation.y : null;
  }
  function trackPlayer(P, dt) {
    if (!CBZ.moves) return;
    if (!PF) PF = CBZ.moves.formation(FRAME_OPTS);
    PF.update(P.pos.x, P.pos.z, playerYaw(), dt);
  }
  function playerFrame(det) {
    if (!PF) return null;
    if (!det._Fb) { det._Fb = []; det._Fw = []; det._Fo = []; det._Fs = []; }
    det._F = PF;
    return PF;
  }
  function inRect(r, x, z, m) { return x > r.minX - m && x < r.maxX + m && z > r.minZ - m && z < r.maxZ + m; }
  function indoorBuilding(P) {
    const sec = MS.sec; if (!sec || !sec.footprints) return null;
    for (let i = 0; i < sec.footprints.length; i++) if (inRect(sec.footprints[i], P.pos.x, P.pos.z, -0.3)) return sec.footprints[i].name;
    return null;
  }
  function doorPost(name, k) {
    const d = MS.sec && MS.sec.doors[name]; if (!d) return null;
    const side = (k % 2) ? 1 : -1, lat = 1.4 * side;
    return { x: d.x - d.nx * 3.4 + (-d.nz) * lat, z: d.z - d.nz * 3.4 + d.nx * lat, face: Math.atan2(-d.nx, -d.nz) };
  }
  function nearDoor(x, z) {
    const sec = MS.sec; if (!sec) return false;
    for (const k in sec.doors) { const d = sec.doors[k]; if (hyp(d.x, d.z, x, z) < 4.0) return true; }
    return false;
  }
  function wantCount(det) { return Math.max(0, (det.memberCount | 0) + (det.standing | 0)); }
  function spawnNearPlayer(det, A, P, dt, isPres) {
    if (det.memberPedRefs.length >= wantCount(det) || CBZ.citySpawnDraining) { det._spawnWait = 0; return; }
    det._spawnWait = (det._spawnWait || 0) + dt;
    // candidates behind him first, then his flanks
    const h = PF ? (PF.h || 0) : 0, y = P.pos.y || 0;
    let bx = null, bz = null;
    const tries = [[-9, 0], [-7, 5], [-7, -5], [0, 9], [0, -9], [-14, 0]];
    for (let i = 0; i < tries.length; i++) {
      const f = tries[i][0], s = tries[i][1];
      const x = P.pos.x + Math.sin(h) * f + Math.cos(h) * s, z = P.pos.z + Math.cos(h) * f - Math.sin(h) * s;
      if (bx == null) { bx = x; bz = z; }
      if (safeSpot(x, z, y)) { bx = x; bz = z; if (det._spawnWait >= 0) det._spawnWait = FORCE_SPAWN_T + 1; break; }
    }
    // upstairs (the office): they come on shift at the building's door and
    // the indoor posting below sends two of them up to his floor
    if (y > 0.5) {
      const dp = doorPost((isPres && indoorBuilding(P)) || "mansion", 0);
      if (dp) { bx = dp.x; bz = dp.z; if (det._spawnWait >= 0) det._spawnWait = FORCE_SPAWN_T + 1; }
    }
    if (det._spawnWait < FORCE_SPAWN_T) return;
    spawnMembers(det, A, bx, bz);
    det._spawnWait = 0;
  }
  function assignRoles(det) {
    let lead = false;
    for (let i = 0; i < det.memberPedRefs.length; i++) {
      const q = det.memberPedRefs[i]; if (!q) continue;
      if (!lead && !q.dead) { q._protRole = "shift-leader"; lead = true; } else q._protRole = "agent";
    }
  }
  function unpostIndoor(q) {
    if (q._protIndoor) { q._protIndoor = null; q.staffPost = null; }
  }
  const _mem = [], _memAsg = [];
  function driveDetailAroundPlayer(det, ps, dt, isPres) {
    const P = CBZ.player, peds = det.memberPedRefs, n = peds.length;
    const F = playerFrame(det); if (!F) return;
    const inCar = !!(P.driving || P._vehicle);
    const bld = isPres ? indoorBuilding(P) : null;
    const room = bld ? officeRoom() : null;
    const threat = ps.threat && !ps.threat.dead ? ps.threat : null;
    // the man being protected is never the target of his own detail
    const hostile = !!(ps.hostile && threat && !isPlayerBody(threat));
    const evac = ps.posture === "evac";
    let mode = "open";
    if (evac) mode = "shield";
    else if (nearDoor(P.pos.x, P.pos.z)) mode = "door";
    else if ((ps._crowd | 0) >= 3) mode = "crowd";
    const tb = threat ? Math.atan2(threat.pos.x - P.pos.x, threat.pos.z - P.pos.z) : 0;
    // his velocity, handed to every body that holds a spot around him
    const fvx = F.moving ? F.vx : 0, fvz = F.moving ? F.vz : 0;

    // ---- who is in the formation, and which slot each one holds ----------
    // (stable: the shift leader keeps the shoulder slot, the rest are solved
    // once and re-solved only when a swap is a real gain, never per frame)
    _mem.length = 0;
    let lead = -1;
    for (let i = 0; i < n; i++) {
      const q = peds[i];
      if (!q || q.dead) continue;
      if (CBZ.boardingHolds && CBZ.boardingHolds(q)) { release(q); continue; }
      if ((q._subornT || 0) > 0) continue;
      if (q._protRole === "shift-leader" && lead < 0) lead = _mem.length;
      _mem.push(q);
      if (CBZ.moves) CBZ.moves.motor(q);                 // assignment keys on the motor id
    }
    const m = _mem.length;
    const W = frameSlots(det, m, mode, dt);
    frameAssign(det, _mem, m, lead, _memAsg);

    let shields = 0;
    for (let i = 0; i < n; i++) {
      const q = peds[i];
      if (!q || q.dead) continue;
      if (CBZ.boardingHolds && CBZ.boardingHolds(q)) continue;
      if ((q._subornT || 0) > 0) { release(q); unpostIndoor(q); disengage(q); q.state = "idle"; q.speed = 0; continue; }
      const leader = q._protRole === "shift-leader";
      const k = _mem.indexOf(q), j = k >= 0 ? _memAsg[k] : -1;
      // ---- a threat: shields, then shooters ----------------------------
      if (ps.posture !== "normal" && threat && !inCar) {
        unpostIndoor(q);
        if ((q.pos.y || 0) - (P.pos.y || 0) > 1.5 || (P.pos.y || 0) - (q.pos.y || 0) > 1.5) {
          // on another floor: come to him
          relocateIfFar(q, P.pos.x - Math.sin(tb) * 1.4, P.pos.z - Math.cos(tb) * 1.4, P.pos.y || 0, 0.5, dt);
          continue;
        }
        // alert: two agents step in between him and the gun. evac: everybody
        // closes to a wall of bodies, except (with a live shooter) the two
        // who go after him.
        const shooter = hostile && !leader && i >= 3;
        const shieldNow = evac ? !shooter : (!leader && shields < 2);
        if (shieldNow) {
          // BODY BETWEEN HIM AND THE GUN: squared up to it, side-stepping in
          let a, r;
          if (evac) { a = tb + (i / Math.max(1, n)) * Math.PI * 2; r = SHIELD_R; }
          else { a = tb + (shields === 0 ? -0.32 : 0.32); r = 1.05; shields++; }
          disengage(q);
          q.state = "confront";
          order(q, P.pos.x + Math.sin(a) * r, P.pos.z + Math.cos(a) * r, RUN_SPEED, yawTo(q, threat.pos.x, threat.pos.z), true, fvx, fvz, 0.25);
          continue;
        }
        if (hostile && !leader && hyp(threat.pos.x, threat.pos.z, P.pos.x, P.pos.z) < 45) { engage(q, threat); continue; }
        disengage(q);
        if (j < 0) continue;
        const w = W[j];
        q.state = "confront";
        order(q, w.x, w.z, RUN_SPEED, yawTo(q, threat.pos.x, threat.pos.z), true, w.vx, w.vz, 0.25);
        continue;
      }
      disengage(q);
      // ---- he is driving: hold, and catch up when he gets out -----------
      if (inCar) { if (!q._protIndoor) { release(q); q.state = "idle"; q.speed = 0; q._boardRun = false; setTarget(q, q.pos.x, q.pos.z); } continue; }
      // ---- indoors in the Mansion or the West Wing ----------------------
      if (bld && ps.posture === "normal") {
        if ((i === 1 || i === 2) && room && room.landmarks && room.landmarks.arrivalPortal && room.approach) {
          const ap = room.landmarks.arrivalPortal, A2 = room.approach;
          const side = i === 1 ? -1 : 1;
          const x = ap.x + A2.tx * 0.9 * side - A2.nx * 0.4, z = ap.z + A2.tz * 0.9 * side - A2.nz * 0.4;
          const face = Math.atan2(-A2.nx, -A2.nz);
          const dy = Math.abs((q.pos.y || 0) - room.floorY);
          const dd = hyp(q.pos.x, q.pos.z, x, z) + dy * 4;
          if (q._protIndoor === "portal" && dd < 1.2) { turnTo(q, face, dt); continue; }
          q._protIndoor = null; q.staffPost = null;
          if (dd < 0.5 || relocateIfFar(q, x, z, room.floorY, 0.8, dt)) {
            if (CBZ.cityFloorPed) { try { CBZ.cityFloorPed(q, room.floorY); } catch (e) {} }
            release(q);
            q._protIndoor = "portal"; q.staffPost = { x: x, z: z, face: face };
            q.state = "idle"; q.speed = 0; q._boardRun = false;
          } else if (dy < 1.0) goTo(q, x, z, false, dt, face, false);   // same floor: walk to the post
          else { release(q); q.state = "idle"; q.speed = 0; setTarget(q, q.pos.x, q.pos.z); }
          continue;
        }
        unpostIndoor(q);
        const other = bld === "mansion" ? "wing" : "mansion";
        const dp = leader ? doorPost(bld, 0) : doorPost(i === 3 ? other : bld, i);
        if (dp) {
          if ((q.pos.y || 0) > 1.0) { relocateIfFar(q, dp.x, dp.z, 0, 0.5, dt); continue; }
          if (!relocateIfFar(q, dp.x, dp.z, 0, 60, dt)) goTo(q, dp.x, dp.z, false, dt, dp.face, false);
          continue;
        }
      }
      unpostIndoor(q);
      // ---- THE FORMATION ------------------------------------------------
      if (j < 0) continue;
      const w = W[j], y = P.pos.y || 0;
      if (Math.abs((q.pos.y || 0) - y) > 1.5) { relocateIfFar(q, w.x, w.z, y, 0.5, dt); continue; }
      if (relocateIfFar(q, w.x, w.z, y, 28, dt)) continue;
      q.state = "walk";
      driveToSlot(q, F, w, j, evac, dt);
    }
  }

  // ------------------------------------------------------------
  //  THE TICK
  // ------------------------------------------------------------
  let scanAcc = 0, spawnAcc = 0, gateAcc = 0, busWired = false;
  function wireBus() {
    const Pz = pres();
    if (busWired || !Pz || typeof Pz.on !== "function") return;
    busWired = true;
    try {
      Pz.on("attack-armed", function (p) {
        if (!p || !p.gate || p.eta == null || !p.at) return;
        raise(PRES, 1, "vehicle on the access road", p.at.x, p.at.z, null, false);
      });
      Pz.on("attack", function (p) {
        if (!p || !p.where) return;
        raise(PRES, p.gate ? 2 : 1, p.gate ? "attack at the gate" : "attack", p.where.x, p.where.z, null, false);
      });
      Pz.on("lockdown", function (p) { MS.lock = !!(p && p.active); });
    } catch (e) {}
    if (typeof Pz.onAssassinated === "function") {
      try {
        Pz.onAssassinated(function (p) {
          MS.lock = true;
          const at = p && p.at;
          raise(PRES, 1, "assassination", at ? at.x : 0, at ? at.z : 0, null, false);
        });
      } catch (e) {}
    }
  }
  function presidentDetail(cur) {
    if (!cur || cur.kind !== "player" || !cur.seatId) return null;
    let det = get("off_" + cur.seatId);
    if (!det) {
      det = create({ id: "off_" + cur.seatId, principal: { kind: "sid", ref: cur.sid || "player" },
        gearTier: 2, formation: "escort", fundingSource: "treasury", legalStatus: "state", memberCount: 0 });
    }
    det.principal.ref = cur.sid || "player";
    det.standing = PRES_BASE;
    return det;
  }
  function unitsFor(det) { return det ? det.memberPedRefs : []; }

  CBZ.onUpdate(35.795, function (dt) {
    const gm = CBZ.game; if (!gm || gm.mode !== "city") return;
    dt = dt || 0.016;
    clock += dt;
    installEars();
    wireBus();
    const A = arena(), P = CBZ.player;
    if (!A || !P || !P.pos) return;
    trackPlayer(P, dt);
    bindMansion();
    const cur = presCurrent();
    const playerIsPres = !!(cur && cur.kind === "player");
    const npcBody = cur && cur.kind === "npc" && cur.ped && !cur.ped.dead ? cur.ped : null;
    PRESBODY.b = playerIsPres ? playerActor() : npcBody;
    const pdet = playerIsPres && !P.dead ? presidentDetail(cur) : null;
    // a president's standing detail stops standing the moment he stops being one
    const S = state();
    for (const id in S.details) {
      const d = S.details[id];
      if (d !== pdet && d.standing) { d.standing = 0; while (d.memberPedRefs.length > wantCount(d)) { removePed(d.memberPedRefs.pop()); } }
    }

    // ---- spawns (2 Hz) ----
    spawnAcc += dt;
    const doSpawn = spawnAcc >= 0.5;
    if (doSpawn) {
      if (!MS.lock && lockActive()) MS.lock = true;
      else if (MS.lock && !lockActive() && pres() && typeof pres().lockdown === "function") MS.lock = false;
      tickPostSpawns(spawnAcc, A, P);
      if (playerIsPres) _officeRoom = readOfficeRoom();
      spawnAcc = 0;
    }
    if (pdet) {
      // prune the dead and the swept, then top the detail back up near him
      for (let i = pdet.memberPedRefs.length - 1; i >= 0; i--) {
        const q = pdet.memberPedRefs[i];
        if (!q || (CBZ.cityPeds && CBZ.cityPeds.indexOf(q) < 0)) { pdet.memberPedRefs.splice(i, 1); continue; }
        // a fallen agent is replaced, but not in front of you: the next one
        // comes on shift twenty seconds later
        if (q.dead) { pdet.memberPedRefs.splice(i, 1); pdet._spawnWait = -20; }
      }
      spawnNearPlayer(pdet, A, P, dt, true);
      assignRoles(pdet);
    }

    // ---- the threat scans (4 Hz) ----
    scanAcc += dt;
    if (scanAcc >= 0.25) {
      const sd = scanAcc; scanAcc = 0;
      if (MS.site) refreshHostiles(MS.site);
      const floor = MS.lock ? 1 : 0;
      const body = playerIsPres ? (P.dead ? null : playerActor()) : npcBody;
      if (body && body.pos && hyp(body.pos.x, body.pos.z, P.pos.x, P.pos.z) < 320) {
        scanThreats(PRES, body, playerIsPres, pdet ? pdet.id : null);
      }
      if (MS.live) tickSnipers(sd);
      const changed = settle(PRES, sd, floor);
      if (changed && body) onPosture(PRES, body, playerIsPres, playerIsPres ? unitsFor(pdet) : (CBZ.powerGuardsOf ? CBZ.powerGuardsOf(body) : []));
      else if (PRES.posture !== "normal" && body && PRES.threat) shoutFor(PRES, PRES.posture, playerIsPres ? unitsFor(pdet) : (CBZ.powerGuardsOf ? CBZ.powerGuardsOf(body) : []), body, playerIsPres);
      // the hired detail (a player who is NOT the President)
      const hd = playerIsPres ? null : findPlayerDetail();
      if (hd && hd.memberPedRefs.length && !P.dead) {
        scanThreats(HIRED, playerActor(), true, hd.id);
        if (settle(HIRED, sd, 0)) {
          if (HIRED.posture !== "normal") shoutFor(HIRED, HIRED.posture, hd.memberPedRefs, playerActor(), true);
        }
      }
    }

    // ---- the gate (5 Hz) ----
    if (MS.sec && MS.sec.gate) {
      gateAcc += dt;
      if (gateAcc >= 0.2) { if (MS.live) tickGate(gateAcc, playerIsPres); gateAcc = 0; }
      try { MS.sec.gate.step(dt); } catch (e) {}
    }

    // ---- per frame: bodies ----
    if (MS.live) {
      for (let i = 0; i < MS.units.length; i++) {
        const u = MS.units[i];
        if (!u.ped || u.ped.dead) continue;
        if (u.role === "gate") driveGateUnit(u, dt);
        else if (u.role === "patrol") drivePatrolUnit(u, dt);
        else driveRoofUnit(u, dt);
      }
    }
    if (pdet && !P.dead) driveDetailAroundPlayer(pdet, PRES, dt, true);
    else if (!P.dead) {
      const hd = findPlayerDetail();
      if (hd && hd.memberPedRefs.length) driveDetailAroundPlayer(hd, HIRED, dt, false);
    }
    if (npcBody) { shapeRing(npcBody, PRES); }
    driveNpcEvac(dt, PRES);
  });

  // ------------------------------------------------------------
  //  THE SEAM — detail(personId), alarm(x, z, reason), posture(personId)
  // ------------------------------------------------------------
  function resolveKey(personId) {
    const cur = presCurrent();
    if (personId == null || personId === "president") return cur && cur.kind !== "vacant" ? "president" : (MS.sec ? "president" : null);
    if (personId === "player") return cur && cur.kind === "player" ? "president" : "player";
    if (typeof personId === "string") {
      if (cur && cur.sid && personId === cur.sid) return "president";
      return "sid:" + personId;
    }
    if (typeof personId === "object") {
      if (cur && cur.ped && personId === cur.ped) return "president";
      if (isPlayerBody(personId)) return cur && cur.kind === "player" ? "president" : "player";
      if (personId._sid) return resolveKey(personId._sid);
      if (personId._power) return "power";
    }
    return null;
  }
  function unitView(ped, role) {
    return { ped: ped, role: role, post: { x: ped.pos.x, y: ped.pos.y || 0, z: ped.pos.z }, alive: !ped.dead };
  }
  function mansionPosts(units, posts, checkpoints) {
    for (let i = 0; i < MS.units.length; i++) {
      const u = MS.units[i];
      const r = u.role === "counter-sniper" ? SNIPER_RANGE : u.role === "gate" ? 14 : 10;
      if (u.lockdown && !MS.lock) continue;
      posts.push({ role: u.role, x: u.x, y: u.y, z: u.z, r: r, manned: !!(u.ped && !u.ped.dead), lost: !!u.lost });
      if (u.ped) units.push({ ped: u.ped, role: u.role, post: { x: u.x, y: u.y, z: u.z }, alive: !u.ped.dead });
    }
    const G = MS.sec && MS.sec.gate;
    if (G) {
      checkpoints.push({ x: G.arch.x, z: G.arch.z, kind: "magnetometer" });
      checkpoints.push({ x: G.barrier.x, z: G.barrier.z, kind: "barrier", open: G.open() });
    }
  }
  function detailView(personId) {
    const key = resolveKey(personId);
    if (!key) return null;
    const units = [], posts = [], checkpoints = [];
    if (key === "president") {
      bindMansion();
      const cur = presCurrent() || { kind: "vacant" };
      if (cur.kind === "player") {
        const det = get("off_" + cur.seatId);
        if (det) for (let i = 0; i < det.memberPedRefs.length; i++) {
          const q = det.memberPedRefs[i]; if (q) units.push(unitView(q, q._protRole === "shift-leader" ? "shift-leader" : "agent"));
        }
      } else if (cur.kind === "npc" && cur.ped && CBZ.powerGuardsOf) {
        let gs = [];
        try { gs = CBZ.powerGuardsOf(cur.ped) || []; } catch (e) { gs = []; }
        for (let i = 0; i < gs.length; i++) units.push(unitView(gs[i], "ring"));
        const det = cur.seatId ? get("off_" + cur.seatId) : null;
        if (det) for (let i = 0; i < det.memberPedRefs.length; i++) if (det.memberPedRefs[i]) units.push(unitView(det.memberPedRefs[i], "agent"));
      }
      mansionPosts(units, posts, checkpoints);
      return {
        principal: { kind: cur.kind, name: cur.name || null, sid: cur.sid || null },
        posture: cur.kind === "vacant" ? (MS.lock ? "alert" : "normal") : PRES.posture,
        reason: PRES.reason || null, units: units, posts: posts, checkpoints: checkpoints,
      };
    }
    if (key === "player") {
      const det = findPlayerDetail();
      if (det) for (let i = 0; i < det.memberPedRefs.length; i++) if (det.memberPedRefs[i]) units.push(unitView(det.memberPedRefs[i], "agent"));
      return { principal: { kind: "player", name: null, sid: null }, posture: HIRED.posture, reason: HIRED.reason || null, units: units, posts: posts, checkpoints: checkpoints };
    }
    if (key === "power" && personId && CBZ.powerGuardsOf) {
      let gs = [];
      try { gs = CBZ.powerGuardsOf(personId) || []; } catch (e) { gs = []; }
      for (let i = 0; i < gs.length; i++) units.push(unitView(gs[i], "ring"));
      return { principal: { kind: "npc", name: personId.name || null, sid: personId._sid || null }, posture: "normal", reason: null, units: units, posts: posts, checkpoints: checkpoints };
    }
    // a sid: the officeholder detail whose principal it is
    const sid = key.slice(4);
    const S = state();
    for (const id in S.details) {
      const d = S.details[id];
      if (d.principal && d.principal.ref === sid) {
        for (let i = 0; i < d.memberPedRefs.length; i++) if (d.memberPedRefs[i]) units.push(unitView(d.memberPedRefs[i], "agent"));
      }
    }
    return { principal: { kind: "npc", name: null, sid: sid }, posture: "normal", reason: null, units: units, posts: posts, checkpoints: checkpoints };
  }
  function alarmAt(x, z, reason) {
    x = +x || 0; z = +z || 0;
    const r = String(reason || "alarm");
    const level = /shot|gun|fire|explos|bomb|attack|sniper/i.test(r) ? 2 : 1;
    const cur = presCurrent();
    const body = cur && cur.kind === "player" ? playerActor() : (cur && cur.ped) || null;
    const site = mansionSite();
    const nearPres = (body && body.pos && hyp(body.pos.x, body.pos.z, x, z) < 200) ||
      (site && site.rect && x > site.rect.minX - 60 && x < site.rect.maxX + 60 && z > site.rect.minZ - 60 && z < site.rect.maxZ + 60);
    if (nearPres) {
      const d = body && body.pos ? hyp(body.pos.x, body.pos.z, x, z) : 999;
      raise(PRES, d < 40 ? level : 1, r, x, z, null, false);
      return "president";
    }
    const P = CBZ.player;
    if (findPlayerDetail() && P && hyp(P.pos.x, P.pos.z, x, z) < 120) { raise(HIRED, level, r, x, z, null, false); return "player"; }
    return null;
  }
  function postureOf(personId) {
    const key = resolveKey(personId);
    if (key === "president") return PRES.posture;
    if (key === "player") return HIRED.posture;
    return "normal";
  }
  // harness-only: where to point a camera
  function presidentialProbe() {
    bindMansion();
    const G = MS.sec && MS.sec.gate;
    const snipers = [], agents = [];
    for (let i = 0; i < MS.units.length; i++) {
      const u = MS.units[i];
      if (u.role === "counter-sniper") snipers.push({ x: u.x, y: u.y, z: u.z, manned: !!u.ped });
    }
    const cur = presCurrent();
    const det = cur && cur.kind === "player" ? get("off_" + cur.seatId) : null;
    if (det) for (let i = 0; i < det.memberPedRefs.length; i++) if (det.memberPedRefs[i]) agents.push(det.memberPedRefs[i]);
    return {
      gate: G ? { arch: { x: G.arch.x, y: 0, z: G.arch.z }, barrier: { x: G.barrier.x, z: G.barrier.z }, open: G.open(), lamp: G.lamp } : null,
      snipers: snipers, agents: agents,
      posts: MS.units.map(function (u) { return { id: u.id, role: u.role, x: u.x, y: u.y, z: u.z, ped: u.ped || null, lost: u.lost }; }),
      posture: PRES.posture, lockdown: MS.lock,
    };
  }

  // ============================================================
  //  PUBLIC API
  // ============================================================
  CBZ.protection = {
    create, dissolve, details, get,
    spawnMembers, despawnMembers, dropMember, driveEscort: driveDetail, moveToward,
    // the one-mover seam for anybody walking a body beside a principal
    order: order, release: release, frameOf: frameOf,
    notePrincipalHp, attemptsOn,
    hire, suborn, detailOf,
    reset, GEAR, HIRE_CAP,
    // THE SEAM (see the header): Hitman and everybody else read these
    detail: detailView, alarm: alarmAt, posture: postureOf,
    formationSlot: formationSlot,
    _presidential: presidentialProbe,
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
