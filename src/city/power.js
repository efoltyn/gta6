/* ============================================================
   city/power.js — THE PROTECTION LAYER. Who is IMPORTANT, and what that
   costs you when you walk up to them.

   OWNER (verbatim, 2026-07-27): "just like how we built it where terrorist
   heads or mob heads or gang leaders or cartel heads will be on top floor of
   a penthouse with every floor below security like they own the buildings,
   and their family at the top... see the ideas here, how NPCs animate and
   interact based on role and how a character's role changes how the NPCs
   interact with them — like walking up to a level 1 they will interact,
   walking up to a level [high] their security will interact with you lol.
   gives NPCs more purpose." And: "not just gov complex — could be a mansion
   with a rich person and security, or a mob boss and soldiers protecting, or
   gov and police protecting, etc."

   ONE DECLARATION, AND EVERYTHING ELSE FOLLOWS:

       CBZ.powerPrincipal(boss, { tier: 5, org: "cartel", role: "Cartel Head",
                                  seat: { lot: hqLot } });

   That single line buys: a ring of guards whose weapons, armour, hp, count,
   standoff and tolerance are DERIVED from the tier; the `Lv.N Cartel Head`
   pill over his head; a reaction rule that reads the GAP between your
   standing and his and routes the conversation to his DETAIL instead of to
   him; a floor-by-floor security ladder in his tower with his family at the
   top; and a police/reprisal response to his death scaled to how big he was.
   No rank array, no guard AI, no interior, no popup, no HUD card.

   ------------------------------------------------------------------
   WHY THIS FILE EXISTS (the census, grep-verified against HEAD 4a16699)
   ------------------------------------------------------------------
   NINE independent implementations of "a body protects an important person"
   already ship, none of them sharing a line:

     vips.js:725  driveGuards        — suited/made walking detail + formation
     vips.js:766  driveCops          — a second, different escort formation
     protection.js:299 driveEscort   — ProtectionDetail follow (+ :317 posted)
     millionaires.js:445 driveGuard  — a magnate's single trailing bodyguard
     security.js:32 spawnCitySecurity— shop-front private guards
     island_military.js:1078         — gate guards on a FOURTH post field
                                       shape (`_stationed`)
     campaign.js:1560                — the DIRECTOR'S LIST "bodyguard ring"
     loyalty.js:196                  — companion interpose / shield
     gangs.js:504                    — the boss and the crew that protects him

   Four different field shapes for "stand here and hold it" are live right
   now: police.js's `_post`, peds.js's `guard`/`homeGuard` leash, peds.js's
   `staffPost` pin, and island_military.js's `_stationed`. Nothing in the repo
   could answer "how does this person's security treat me" — the closest thing,
   sizeup.js, reads LEVELS and does not know a detail exists.

   ------------------------------------------------------------------
   BLOCK LAW COMPLIANCE (CLAUDE.md §THE BLOCK LAW) — all five
   ------------------------------------------------------------------
   1. ONE-LINE ADOPTION, ZERO CEREMONY. `powerPrincipal(actor, {tier})` is the
      whole contract; everything else is optional. There is NO config bundle
      to hand-write — `CBZ.powerKit(tier)` WRITES it, exactly the way
      predatorKit writes a predator's. CLAUDE.md is explicit that a block whose
      entry cost is authoring 20 tuning numbers sits at one consumer forever.
   2. DEGRADE-SAFE. Every cross-module read is `CBZ.x ? CBZ.x() : <fallback>`.
      With factions.js, occupy.js, protection.js, police.js and interactions.js
      ALL absent this file still declares principals, still answers
      powerReactionTo(), and never throws. The handle is never null, so a
      caller never has to guard the return value either.
   3. CONSUMERS. Three are migrated IN THIS CHANGE, and they are migrated the
      way contracts.js's law requires — "the generator picks the verb, the
      WORLD supplies the specifics": power.js never spawns a principal. The
      bootstrap sweep BINDS to bodies the simulation was already running:
        (a) every living gang BOSS (gangs.js `gang.boss`)
        (b) every occupied building's VIP (occupy.js `cityOccupyBossOf(lot)`)
        (c) every live vips.js principal — declared `ring:false`, so vips.js
            keeps its own detail and gains only the ROLE + INTERCEPT layer.
            That is deliberate: adding a second ring to a body that already
            has one would be the exact duplication this file exists to end.
   4. NAMED IN CLAUDE.md — the entry to add is quoted at the foot of this file.
   5. RATCHET. `CBZ.powerAudit().legacyGuardSites`, baseline 9 (the list
      above, counted file-by-file, not guessed). It may only ever go DOWN. A
      file that migrates calls `CBZ.powerMigrated("<tag>")` once — one line.

   ------------------------------------------------------------------
   WHAT IT REUSES — it invents no AI, no interior, no pill, no popup
   ------------------------------------------------------------------
   · police.js `c._post` — THE posted-officer brain (walk back to the slot,
     hold it, throttled LOS, aim, arrest-first, `relaxed` = holstered until you
     actually have stars). power.js is its THIRD consumer (roadblock →
     checkpoints.js → here). A LAWFUL principal's ring is real cops from
     `CBZ.citySpawnCop`, and the ring "follows" him by MOVING THE SLOT: the
     shipped brain already walks an officer back to `_post.x/_post.z`, so a
     moving principal costs literally zero lines of locomotion.
     HONEST LIMIT, and the one edit this file cannot make: that branch lives
     inside police.js's own loop over `CBZ.cityCops`, so a non-cop body
     stamped with `_post` is inert. Private details therefore write the SAME
     `_post` record (one field shape citywide, so the future shared tick finds
     them) and are stepped by `CBZ.protection.moveToward` — protection.js's
     own exported follow primitive, which its header already calls "the one
     copy now" of officials.js's moveToward and social.js's companion follow.
     See §THE ONE EDIT OWED at the foot of this file.
   · occupy.js — THE floor ladder, whole. `cityOccupyBuilding` already builds
     the staircase (cityStairCore), carves the floors, runs the interior
     programs, posts rooted guards on `staffPost`, seats the family, owns the
     per-floor access model and propagates an alarm UP the building ahead of
     you. power.js authors NONE of that. It reads occupy.js's OWN preset table
     (`cityOccupyPreset`) and re-stamps only the two things the tier decides:
     WHICH floors are his, and how many bodies are on them.
   · factions.js — allegiance. `CBZ.factions.tier(org)` is your rank inside
     HIS outfit and is what lets a made man walk straight in;
     `reactionTo(a,b)` is the one cross-faction query. Never re-derived.
   · interactions.js — the ONE conversation seam. The intercept is three
     `I.register` calls on the existing `ped:civ` layer, at a priority that
     wins slot exclusivity, so the detail's verb REPLACES the principal's
     without a parallel prompt. HUD doctrine: the only popup is the killfeed,
     and this file never toasts one.
   · level.js / aim_dossier.js — the `Lv.N Title` pill. power.js writes
     `actor.vipTitle` and `actor.vipLvl`, the two fields `cityTitle()` and
     `cityLevel()` ALREADY read first. The pill therefore shows
     "Lv.100 Cartel Head" with not one line changed in either file.
   · protection.js GEAR — the weapon/ammo/hp ladder (Pistol → SMG → Rifle) is
     read LIVE off `CBZ.protection.GEAR`, never copied. Tier indexes into it.
   · armor.js `cityArmorDressPed`, wanted.js `cityAddStars`, gangs.js
     `cityGangProvoke`, peds.js `cityRallyGang` / `cityMarkGunpoint` /
     `cityFleeFrom`, social.js `citySay` / `cityRelShift`, occupy.js
     `cityPostNpc` / `cityOccupyAlarm` / `cityOccupyGrant`.

   ------------------------------------------------------------------
   THE ARCHETYPE TABLE — power laws over `tier`, solved against vips.js
   ------------------------------------------------------------------
   There is ONE table (`kit()`), it is keyed on NOTHING but the tier number,
   and NO ROLE NAME APPEARS IN IT. Adding a Cartel Head, a Mayor, a CEO or a
   Don must never mean adding a row — that is the predatorKit rule, and it is
   the only reason a shared block ever gets adopted.

   The curve is not invented. It was solved against vips.js's five
   hand-authored CAST rows, which are the repo's only existing authored
   answer to "how big is this person":

     level(t) = 30 + 14t  ->  44 / 58 / 72 / 86 / 100
       vips.js STAR 72-80 (t3 = 72), SENATOR 78-86 and JUDGE 76-84 (t3-t4 =
       72-86), DON 84-92 (t4 = 86), MAGNATE 88-95 (t4-t5 = 86-100). Every
       authored band is reproduced by one line.
     detail(t) = round(0.9 * t^1.15)  ->  1 / 2 / 3 / 4 / 6
       DON 4 guards (t4 = 4, exact). MAGNATE 3 (t4 = 4, +1). SENATOR/JUDGE 2
       officers (t3 = 3, +1). The STAR is the deliberate outlier the curve
       does NOT model: one guard at Lv.72-80 is fame without muscle, and
       fitting it would have broken every other row. Declare her `tier:3,
       detail:1` if you want her exactly — `overrides` exists for the one
       number you genuinely disagree with, and for nothing else.
     guardHp(t) = 100 + 20t  ->  120 / 140 / 160 / 180 / 200
       spans protection.js's GEAR ladder (120/150/190) and occupy.js's ROLES
       (security 140, agent 150, muscle 150, soldier 170, lieutenant 190).
     reach(t) = 1.8 + 0.5t  ->  2.3 / 2.8 / 3.3 / 3.8 / 4.3
       vips.js's own formation radii are 2.3, 2.2, 1.9, 1.8 — the ring stands
       where its hand-authored details already stood.

   Everything else (challenge/warn/shove/draw radii, escalation rate, gear
   index, armour kit, stars-on-death, reprisal weight, floors owned, family
   size, the rank needed to walk straight in) falls out of the same number.

   DETERMINISM: every placement decision is CBZ.hash01 / CBZ.seedStream.
   No Math.random anywhere in this file, including the FX.

   Revert: CBZ.CONFIG.POWER_PROTECTION = false (or ?cfg_POWER_PROTECTION=0).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;
  if (!g) return;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});

  /* ---------------- flags (self-defaulted; each a one-line revert) --------
     POWER_PROTECTION — the whole layer. Off → powerPrincipal() returns an
       inert handle, no ring is ever staffed, no verb is registered, and
       powerReactionTo() answers "welcome" for everyone, which is byte-for-byte
       the prior behaviour of every caller.
     POWER_RING       — staff the ring. Off → principals are still declared
       (pill, reaction, floors) but nobody stands around them. This is the
       flag to flip if bodies misbehave; the social layer keeps working.
     POWER_FLOORS     — the seat's floor ladder (occupy.js). Off → a `seat` is
       remembered and ignored.
     POWER_ADOPT      — the bootstrap sweep that binds the world's existing
       principals (gang bosses / occupancy VIPs / vips.js). Off → this file
       does nothing until somebody calls powerPrincipal() explicitly.
     POWER_MAX_GUARDS — citywide ceiling on bodies THIS file owns. One entry
       point means one honest headcount (occupy.js's OCCUPY_MAX_PEDS rule). */
  if (CFG.POWER_PROTECTION == null) CFG.POWER_PROTECTION = true;
  if (CFG.POWER_RING == null) CFG.POWER_RING = true;
  if (CFG.POWER_FLOORS == null) CFG.POWER_FLOORS = true;
  if (CFG.POWER_ADOPT == null) CFG.POWER_ADOPT = true;
  if (CFG.POWER_MAX_GUARDS == null) CFG.POWER_MAX_GUARDS = 24;
  // metres from the player at which a detail materialises / is released. The
  // ring is a PRESENCE, not a persistent payroll: bodies exist while you can
  // see them and go back to the world when you leave, so the citywide rig
  // count stays flat (vips.js's draft/release doctrine, one number).
  if (CFG.POWER_GUARD_NEAR == null) CFG.POWER_GUARD_NEAR = 150;
  if (CFG.POWER_GUARD_FAR == null) CFG.POWER_GUARD_FAR = 250;

  function on() { return CFG.POWER_PROTECTION !== false; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function num(v, d) { return (v == null || !isFinite(v)) ? d : +v; }
  function hyp(a, b) { return Math.hypot(a, b); }
  function nowS() { return (CBZ.now != null ? CBZ.now : 0) / 1000; }

  /* ======================================================================
     §1  THE ARCHETYPE TABLE — CBZ.powerKit(tier, opts)

     THE THING THAT WRITES THE BUNDLE. A caller never authors a radius, a
     weapon, an hp value or an escalation rate; it authors a NUMBER between
     1 and 5 and a role STRING, and gets the whole detail.

     `lawful` is not a role test either — it is read off the faction's own
     declared `heat` multiplier (factions.js: "multiplier on REPORTED crime
     severity while a member" — a badge makes witnesses quieter, gang colours
     make them louder). heat <= 1 therefore means the law is on this org's
     side, which is exactly the question "do police respond to his death".
     ====================================================================== */

  // protection.js already owns the gear ladder every armed NPC in this game is
  // issued from. Read it LIVE; the literal below is only the degrade-safe
  // mirror for a build where protection.js is absent.
  const GEAR_FALLBACK = [
    { weapon: "Pistol", ammo: 30, hp: 120 },
    { weapon: "SMG", ammo: 90, hp: 150 },
    { weapon: "Rifle", ammo: 60, hp: 190 },
  ];
  function gearLadder() {
    const G = CBZ.protection && CBZ.protection.GEAR;
    return (G && G.length) ? G : GEAR_FALLBACK;
  }
  function guardCap() {
    const c = CBZ.protection ? CBZ.protection.HIRE_CAP : 0;
    return (c > 0) ? c : 8;
  }

  // Is this org's violence the law's business? See the note above — derived
  // from factions.js's own declared field, never from a name.
  function orgIsLawful(orgId) {
    const f = (CBZ.factions && CBZ.factions.def) ? CBZ.factions.def(orgId) : null;
    if (!f) return false;                       // an undeclared outfit is nobody's law
    if (f.heat != null && isFinite(f.heat)) return f.heat <= 1;
    return false;
  }

  // Which of occupy.js's OWN presets dresses this org's building. Kind comes
  // from the faction record the org already declared; we never invent one.
  function presetFor(orgId, lawful) {
    const f = (CBZ.factions && CBZ.factions.def) ? CBZ.factions.def(orgId) : null;
    const kind = String((f && f.kind) || "").toLowerCase();
    if (/milit|army|garrison|troop/.test(kind)) return "military";
    if (/gov|state|civic|office|agency|law|police/.test(kind)) return "government";
    if (/corp|company|business|firm/.test(kind)) return "corporate";
    if (lawful) return "government";
    return "gang";
  }

  CBZ.powerKit = function (tier, opts) {
    opts = opts || {};
    const t = clamp(Math.round(num(tier, 1)), 1, 5);
    const G = gearLadder();
    // tier -> gear index: 1,2 = sidearm · 3,4 = SMG · 5 = rifle. One divide,
    // clamped to whatever ladder protection.js actually shipped.
    const gi = clamp(Math.floor((t - 1) / 1.6), 0, G.length - 1);
    const gear = G[gi] || G[G.length - 1];
    const lawful = (opts.lawful != null) ? !!opts.lawful : orgIsLawful(opts.org);

    const reach = 1.8 + 0.5 * t;            // where a guard physically stands
    const challenge = 4 + 4 * t;            // the ring his detail scans at all
    const k = {
      tier: t,
      lawful: lawful,
      // ---- the bodies -------------------------------------------------
      detail: clamp(Math.round(0.9 * Math.pow(t, 1.15)), 1, guardCap()),
      weapon: gear.weapon,
      ammo: num(gear.ammo, 30),
      guardHp: Math.round(100 + 20 * t),
      // armour is the same kit ladder police.js issues its own officers from
      armor: t >= 5 ? ["swatVest", "helmet"] : t >= 3 ? ["softVest"] : null,
      guardAggr: clamp(0.62 + 0.06 * t, 0, 0.95),
      // ---- the geometry -----------------------------------------------
      reach: reach,
      challenge: challenge,
      warn: challenge * 0.5,               // "that's close enough"
      shove: challenge * 0.28,             // hands on you
      draw: Math.max(reach + 0.6, challenge * 0.16),   // leather clears
      // ---- the temperament --------------------------------------------
      // stages per second toward the distance-implied stage. A tier-5 detail
      // escalates two and a half times faster than a tier-1 one; that IS the
      // difference between a shop owner's guy and a cartel head's people.
      climb: 0.5 + 0.3 * t,
      cool: 0.55,
      patience: 6 - t,                     // seconds of grace before stage 1
      // ---- what he reads as --------------------------------------------
      level: clamp(Math.round(30 + 14 * t), 1, 100),
      // ---- consequences -------------------------------------------------
      deathStars: lawful ? clamp(t - 1, 0, 4) : 0,
      reprisal: lawful ? 0 : clamp(0.18 * t, 0, 0.9),
      // ---- the floor ladder ---------------------------------------------
      floors: clamp(t - 1, 0, 6),          // storeys BELOW him that are his
      family: clamp(t - 2, 0, 3),          // dependants in the top-floor suite
      // rank tier inside HIS OWN org that walks straight past the detail
      admit: clamp(t - 2, 0, 4),
    };
    // `overrides` is for your move/onHit-style seams and the ONE number you
    // genuinely disagree with. Anything more and you are re-authoring the
    // table, which is the failure mode this whole function exists to prevent.
    if (opts.overrides) for (const key in opts.overrides) k[key] = opts.overrides[key];
    return k;
  };

  /* ======================================================================
     §2  THE REGISTRY

     The record lives ON THE ACTOR (`actor._power`). No parallel bookkeeping:
     it dies with the ped, a corpse cannot be a principal, and nothing has to
     be swept. REG is only an iteration list and is pruned every tick.
     ====================================================================== */
  const REG = [];
  let guardBudget = 0;                       // live bodies THIS file owns

  function recOf(a) { return (a && a._power && a._power.live) ? a._power : null; }
  function playerActor() { return (CBZ.city && CBZ.city.playerActor) || CBZ.player || null; }
  function arenaRoot() {
    const A = CBZ.city && CBZ.city.arena;
    return (A && A.root) || CBZ.scene || null;
  }
  function distToPlayer(a) {
    const P = CBZ.player;
    if (!P || !P.pos || !a || !a.pos) return 1e9;
    return hyp(a.pos.x - P.pos.x, a.pos.z - P.pos.z);
  }

  // an inert handle, so a caller never has to null-check the return value
  const DEAD_HANDLE = {
    id: null, tier: 0, kit: null, live: false, actor: null,
    reaction: function () { return "welcome"; },
    guards: function () { return []; },
    seat: function () { return null; },
    admit: function () {}, mark: function () {}, dissolve: function () {},
  };

  function handleFor(rec) {
    return {
      id: rec.id,
      tier: rec.kit.tier,
      kit: rec.kit,
      live: true,
      actor: rec.actor,
      reaction: function () { return reactionTo(rec.actor); },
      guards: function () { return rec.guards.slice(); },
      seat: function () { return rec.seat; },
      // let somebody through by hand (a mission, a bribe, a phone call)
      admit: function (secs) { rec.audienceT = Math.max(rec.audienceT, num(secs, 30)); },
      // and the opposite: you are now a problem
      mark: function (secs) { rec.hostileT = Math.max(rec.hostileT, num(secs, 45)); },
      dissolve: function () { dissolve(rec); },
    };
  }

  /* ======================================================================
     §3  THE DECLARATION — CBZ.powerPrincipal(actor, spec)
     ====================================================================== */
  CBZ.powerPrincipal = function (actor, spec) {
    spec = spec || {};
    if (!on() || !actor || actor.dead) return DEAD_HANDLE;
    // re-declaring an existing principal UPDATES it (a promotion, a seat
    // change, a succession handing the chair to the heir) rather than
    // stacking a second detail on the same body.
    const prev = recOf(actor);
    const kit = CBZ.powerKit(spec.tier, { org: spec.org, lawful: spec.lawful, overrides: spec.overrides });
    const id = spec.id || ("power:" + (spec.org || "ind") + ":" +
      Math.round(num(actor.pos && actor.pos.x, 0)) + ":" + Math.round(num(actor.pos && actor.pos.z, 0)));

    const rec = prev || {
      id: id, live: true, actor: actor,
      guards: [], stage: 0, sinceT: 0, lineT: 0, audienceT: 0, hostileT: 0,
      fillT: 0, scanT: 0, mourned: false, seated: false, seat: null,
      // deterministic ring phase — a hash of where he stands, never a draw
      phase: (CBZ.hash01
        ? CBZ.hash01(Math.round(num(actor.pos && actor.pos.x, 0)),
          Math.round(num(actor.pos && actor.pos.z, 0)), 0x9051)
        : 0.37) * Math.PI * 2,
    };
    rec.kit = kit;
    rec.org = spec.org || null;
    rec.role = String(spec.role || spec.title || "Principal");
    rec.ring = spec.ring !== false;           // false = declare the standing only
    rec.family = Array.isArray(spec.family) ? spec.family.slice() : [];
    rec.seat = spec.seat || rec.seat || null;
    // DETERMINISM: this stream feeds cityMakePed's APPEARANCE roll only. Guard
    // PLACEMENT is derived from the principal's own position and the slot index
    // (slotFor / CBZ.hash01), so a detail stands in the same place on every
    // client. A body that materialises on player proximity is not a world-build
    // path, which is the thing CLAUDE.md's determinism law actually governs —
    // but there is still no Math.random anywhere in this file, including FX.
    rec.rng = (CBZ.seedStream ? CBZ.seedStream("power:" + id) : null);

    // ---- THE PILL, for free. level.js's cityTitle() reads `vipTitle` FIRST
    // and cityLevel() takes max() with `vipLvl`; aim_dossier.js's overhead
    // pill reads both through those two functions. Writing these two fields
    // is the WHOLE of "the role feeds the Lv.N pill" — no new sprite, no new
    // HUD element, and vips.js has been proving the idiom works for months.
    actor.vipTitle = rec.role;
    actor.vipLvl = Math.max(num(actor.vipLvl, 0), kit.level);
    // sizeup.js already treats a `vipLvl` body's nearby `_vipGuard`s as backup
    // (sizeup.js:54) — so the moment a ring exists, the whole street reads him
    // as untouchable through the EXISTING fight-or-fold maths. Free.

    // his family are not combatants, and hurting them is the fastest way to
    // make his detail hostile — the two fields peds.js/occupy.js already use.
    for (let i = 0; i < rec.family.length; i++) {
      const fm = rec.family[i];
      if (!fm) continue;
      fm.isFamily = true;
      fm._powerOf = rec;
      fm._occupyNoFight = true;
    }

    actor._power = rec;
    if (REG.indexOf(rec) < 0) REG.push(rec);
    // a seat that arrives with a LIVE occupancy is a BIND, never a build:
    // marking it seated is what stops seatHim() from re-occupying a lot and
    // tearing down the cast occupy.js is already running on it.
    if (rec.seat && rec.seat.occupancy) { rec.seated = true; bindOccupancy(rec, rec.seat.occupancy); }
    if (rec.seat && !rec.seated && CFG.POWER_FLOORS !== false) seatHim(rec);
    return handleFor(rec);
  }

  // every body occupy.js posted in his building answers to him. One stamp,
  // and the intercept / draw / audit all agree about who his people are.
  function bindOccupancy(rec, occ) {
    if (!occ || !occ.peds) return;
    for (let i = 0; i < occ.peds.length; i++) {
      const p = occ.peds[i];
      if (!p || p === rec.actor) continue;
      p._powerOf = rec;
      if (p.isFamily && rec.family.indexOf(p) < 0) rec.family.push(p);
    }
  }

  function dissolve(rec) {
    if (!rec) return;
    releaseGuards(rec, true);
    rec.live = false;
    if (rec.actor && rec.actor._power === rec) rec.actor._power = null;
    const i = REG.indexOf(rec);
    if (i >= 0) REG.splice(i, 1);
  }

  /* ======================================================================
     §4  THE RING — guards hold posts around the principal.

     police.js's posted-officer brain is the model and, for a lawful detail,
     it is LITERALLY the brain: real cops out of CBZ.citySpawnCop wearing
     `c._post = {x, z, fx, fz, mount, mountT, relaxed}`. That branch
     (police.js:2498) already walks an officer back to his slot, holds him
     there, runs a throttled LOS probe, aims, honours arrest-first and — with
     `relaxed` — stays holstered until you actually have stars. We are its
     THIRD consumer (roadblock → checkpoints.js → power.js).

     THE FOLLOW IS FREE. We do not move a guard: we move his SLOT. The shipped
     brain does `if (dist(post) > 0.8) stepTo(...)`, so re-writing post.x/post.z
     as the principal walks makes the whole detail travel with him with zero
     locomotion code. That is the entire reason to reuse this brain instead of
     writing a tenth escort follow.
     ====================================================================== */

  // The ring geometry. Guards stand on a circle of radius kit.reach, evenly
  // spread, phased off the principal's heading — so for n=4 it is a diamond
  // (point, two flanks, tail), which is what close protection actually is —
  // and they face OUTWARD, away from the man they are covering.
  function slotFor(rec, i, n) {
    const a = rec.actor;
    const h = (a.group ? a.group.rotation.y : 0);
    const bear = h + rec.phase + (i / Math.max(1, n)) * Math.PI * 2;
    const sx = Math.sin(bear), sz = Math.cos(bear);
    return {
      x: a.pos.x + sx * rec.kit.reach,
      z: a.pos.z + sz * rec.kit.reach,
      fx: sx, fz: sz,
    };
  }

  // ---- LAWFUL detail: a real officer wearing police.js's own post record ---
  function spawnCopGuard(rec, slot) {
    if (!CBZ.citySpawnCop) return null;
    let c = null;
    try { c = CBZ.citySpawnCop(slot.x, slot.z, rec.kit.tier >= 5); } catch (e) { c = null; }
    if (!c) return null;
    // citySpawnCop jitters the spot (it was written for raids); a detail
    // officer belongs on his slot, and the post brain walks him back anyway.
    if (c.pos && c.pos.set) c.pos.set(slot.x, 0, slot.z);
    if (c.group) c.group.position.set(slot.x, 0, slot.z);
    c._post = { x: slot.x, z: slot.z, fx: slot.fx, fz: slot.fz, mount: null, mountT: 0, relaxed: true };
    c._powerOf = rec;
    c._powerCop = true;
    if (rec.kit.armor && CBZ.cityArmorDressPed) {
      try { CBZ.cityArmorDressPed(c, rec.kit.armor.slice()); } catch (e) {}
    }
    return c;
  }

  // ---- PRIVATE detail: a real ped on the SAME `_post` record shape --------
  // Same field, so a future shared post tick (see §THE ONE EDIT OWED) finds
  // both kinds; stepped meanwhile by protection.js's exported follow.
  function spawnPedGuard(rec, slot) {
    const root = arenaRoot();
    if (!root) return null;
    const k = rec.kit;
    const opts = {
      src: "power:detail",
      rng: rec.rng || undefined,
      parent: root,
      kind: "security", archetype: "security",
      job: "close protection",
      faction: rec.org || null,
      aggr: k.guardAggr, wealth: 0.5,
      armed: true, weapon: k.weapon, hp: k.guardHp,
      face: Math.atan2(slot.fx, slot.fz),
      // `controlled` is the house pattern for a body another system drives
      // (vips.js header, social.js hostages): peds.js's think() leaves it
      // alone, but move() still walks it to .target and, in state "fight"
      // with a .rage, chases and fires through npcAttack. So a guard is a
      // full combatant without one new line of combat code.
      controlled: true,
    };
    let q = null;
    if (CBZ.cityPostNpc) { try { q = CBZ.cityPostNpc(slot.x, slot.z, opts); } catch (e) { q = null; } }
    if (!q && CBZ.cityMakePed && CBZ.cityPeds) {
      // degrade-safe: occupy.js absent → the four lines it replaced
      try {
        q = CBZ.cityMakePed(slot.x, slot.z, rec.rng || function () { return 0.5; }, opts);
        if (q) { root.add(q.group); CBZ.cityPeds.push(q); }
      } catch (e) { q = null; }
    }
    if (!q) return null;
    q.ammo = k.ammo;
    q.maxHp = k.guardHp;
    q._post = { x: slot.x, z: slot.z, fx: slot.fx, fz: slot.fz, mount: null, mountT: 0, relaxed: true };
    q._powerOf = rec;
    q._vipGuard = true;             // sizeup.js already reads this as the principal's backup
    if (k.armor && CBZ.cityArmorDressPed) { try { CBZ.cityArmorDressPed(q, k.armor.slice()); } catch (e) {} }
    if (CBZ.syncActorWeapon) { try { CBZ.syncActorWeapon(q); } catch (e) {} }
    if (CBZ.cityRelShift) { try { CBZ.cityRelShift(q, "recruited", 0.4); } catch (e) {} }
    return q;
  }

  function dropGuard(rec, q, hard) {
    if (!q) return;
    q._powerOf = null;
    q._post = null;
    if (q._powerCop) {
      q.sees = false; q.curTarget = null; q._powerCop = false;
      if (q.dead) return;                           // a corpse belongs to the world
      // …and he LEAVES. citySpawnCop pushes straight into CBZ.cityCops without
      // consulting police.js's force pool (police.js:740), so handing a
      // released detail officer back to patrol would grow the citywide force
      // by six every time a principal walked off screen. He came from us; he
      // goes with us. police.js's own dispatch already ignored him while he
      // carried a `_post` (liveCops(), :773), so nothing is starved by this.
      try {
        if (q.group && q.group.parent) q.group.parent.remove(q.group);
        if (CBZ.cityCops) { const i = CBZ.cityCops.indexOf(q); if (i >= 0) CBZ.cityCops.splice(i, 1); }
      } catch (e) {}
      return;
    }
    q._vipGuard = false;
    if (q.dead) return;                             // a corpse belongs to the world
    if (CBZ.cityUnpostNpc) { try { CBZ.cityUnpostNpc(q); return; } catch (e) {} }
    try {
      if (q.group && q.group.parent) q.group.parent.remove(q.group);
      if (CBZ.cityPeds) { const i = CBZ.cityPeds.indexOf(q); if (i >= 0) CBZ.cityPeds.splice(i, 1); }
    } catch (e) {}
  }

  function releaseGuards(rec, hard) {
    for (let i = 0; i < rec.guards.length; i++) dropGuard(rec, rec.guards[i], hard);
    rec.guards.length = 0;
  }

  // ONE honest headcount, recomputed from the live rosters at the top of every
  // tick rather than incremented and decremented at six call sites. A counter
  // that drifts is exactly the parallel bookkeeping this repo's own block law
  // warns about; a recount over ~5 principals x ~6 bodies costs nothing.
  function recountBudget() {
    let n = 0;
    for (let i = 0; i < REG.length; i++) {
      const rec = REG[i];
      if (!rec.live) continue;
      for (let q = 0; q < rec.guards.length; q++) if (rec.guards[q] && !rec.guards[q].dead) n++;
    }
    guardBudget = n;
  }

  // ---- the per-frame ring pass -------------------------------------------
  function driveRing(rec, dt) {
    const k = rec.kit, a = rec.actor;
    const d = distToPlayer(a);

    // A PRINCIPAL WHO IS UP A BUILDING ALREADY HAS HIS RING: it is the floor
    // ladder. occupy.js posted his top-floor detail on the actual floor plate,
    // and a street-level ring around a man standing on storey nine would spawn
    // guards in mid-air under him. `_occupyY` is occupy.js's own "this body is
    // above the ground" field, so this is a read, not a new flag.
    const lifted = num(a._occupyY, 0) > 0.2;
    const want = (rec.ring && !lifted) ? k.detail : 0;

    // presence gate: a detail exists while the player is anywhere near, and
    // is released back to the world when they are not. One number, honest
    // headcount — never a persistent citywide payroll of idle rigs.
    if (d > CFG.POWER_GUARD_FAR) { if (rec.guards.length) releaseGuards(rec, false); return; }

    // ---- prune -----------------------------------------------------------
    for (let i = rec.guards.length - 1; i >= 0; i--) {
      const q = rec.guards[i];
      const lost = !q || q.dead ||
        (q._powerCop && CBZ.cityCops && CBZ.cityCops.indexOf(q) < 0) ||
        (!q._powerCop && CBZ.cityPeds && CBZ.cityPeds.indexOf(q) < 0);
      if (!lost) continue;
      // NOTE on the cop path: police.js's roadblock teardown branch runs for
      // ANY officer carrying a `_post` and can splice him out of cityCops
      // (rbDetachCop). We therefore never assume a detail officer survives —
      // we notice he is gone and re-staff. See §THE ONE EDIT OWED.
      if (q) dropGuard(rec, q, false);
      rec.guards.splice(i, 1);
      rec.fillT = Math.max(rec.fillT, 6);      // a dead guard is not replaced instantly
    }

    // ---- top up ----------------------------------------------------------
    rec.fillT -= dt;
    if (rec.guards.length < want && rec.fillT <= 0 && d < CFG.POWER_GUARD_NEAR &&
        guardBudget < (CFG.POWER_MAX_GUARDS | 0)) {
      rec.fillT = 1.5;
      const slot = slotFor(rec, rec.guards.length, Math.max(1, want));
      const q = k.lawful ? spawnCopGuard(rec, slot) : spawnPedGuard(rec, slot);
      if (q) { rec.guards.push(q); guardBudget++; }
    }
    if (rec.guards.length > want) dropGuard(rec, rec.guards.pop(), false);
    if (!rec.guards.length) return;

    // ---- MOVE THE SLOT, NOT THE GUARD -----------------------------------
    const n = rec.guards.length;
    const me = playerActor();
    const stage = Math.floor(rec.stage);
    const threat = (stage >= STAGE_FIRE) ? me : null;
    for (let i = 0; i < n; i++) {
      const q = rec.guards[i];
      if (!q || q.dead) continue;
      const slot = slotFor(rec, i, n);
      if (q._post) {
        q._post.x = slot.x; q._post.z = slot.z;
        q._post.fx = slot.fx; q._post.fz = slot.fz;
        // police.js's teardown branch counts up mountT to 2.2s before it
        // detaches a posted officer. Ours never accumulates, so a roadblock
        // ending elsewhere in the city cannot yank a protection detail.
        q._post.mountT = 0; q._post.mount = null;
      }
      if (q._powerCop) continue;   // police.js's own brain owns him from here

      // ---- private detail ------------------------------------------------
      // a guard on the payroll never runs out of ammo between fights
      if (q.armed && q.ammo != null && q.ammo < 6) q.ammo = k.ammo;
      q.fear = 0; q.alarmed = Math.max(q.alarmed || 0, stage >= STAGE_DRAW ? 4 : 0);
      q.surrender = false; q.surrenderT = 0; q.poseHandsUp = false;

      if (threat && !threat.dead) {
        // OPEN FIRE — the exact field quartet rallyGang and occupy.js's wake()
        // write. peds.js's move() does the chasing and the shooting; not one
        // line of combat lives in this file.
        q.rage = threat; q.state = "fight";
        q.guard = { x: slot.x, z: slot.z }; q.homeGuard = q.guard;
        if (q.target) q.target.set(threat.pos.x, 0, threat.pos.z);
        q.path = null; q.pause = 0;
        continue;
      }
      if (q.rage) q.rage = null;

      if (stage >= STAGE_DRAW && me) {
        // DRAWN, NOT FIRING — peds.js's own "confront" state, which that file
        // documents verbatim as "close in, threaten". Hold ground, square up.
        q.state = "confront"; q.speed = 0; q.path = null;
        if (q.target) q.target.set(me.pos.x, 0, me.pos.z);
        if (q.group) q.group.rotation.y = Math.atan2(me.pos.x - q.pos.x, me.pos.z - q.pos.z);
        continue;
      }

      const dd = hyp(slot.x - q.pos.x, slot.z - q.pos.z);
      if (dd > 40) {
        // hopelessly dropped (a lift ride, a teardown) — fall back in, but
        // never where the player can watch it happen.
        if (d > CFG.POWER_GUARD_NEAR * 0.6) { q.pos.set(slot.x, 0, slot.z); q.path = null; }
      } else if (dd > 0.7) {
        // THE SLOT IS THE DESTINATION, and it is written into BOTH the field
        // peds.js's own move() walks toward (`target`) and the shared follow
        // primitive — so the two agree instead of fighting. protection.js's
        // moveToward is officials.js's original follow, which its own header
        // calls "the one copy now"; we add no locomotion of our own.
        q.state = "walk"; q.path = null; q.pause = 0;
        if (q.target) q.target.set(slot.x, 0, slot.z);
        if (CBZ.protection && CBZ.protection.moveToward) {
          CBZ.protection.moveToward(q, slot.x, slot.z, 2.2, dt);
        } else if (q.pos) {
          // degrade-safe inline (protection.js absent): the same two lines
          q.speed = 2.2;
          q.pos.x += ((slot.x - q.pos.x) / dd) * 2.2 * dt;
          q.pos.z += ((slot.z - q.pos.z) / dd) * 2.2 * dt;
          if (q.group) q.group.rotation.y = Math.atan2(slot.x - q.pos.x, slot.z - q.pos.z);
        }
      } else {
        q.state = "idle"; q.speed = 0;
        if (q.target) q.target.set(q.pos.x, 0, q.pos.z);
        // eyes OUT, away from the man they are covering — the read that says
        // "these people are working" rather than "these people are chatting".
        if (q.group) q.group.rotation.y = Math.atan2(slot.fx, slot.fz);
      }
    }
  }

  /* ======================================================================
     §5  THE INTERCEPT — the owner's headline.

     "walking up to a level 1 they will interact, walking up to a level [high]
     their security will interact with you."

     The reaction is COMPUTED FROM THE GAP, never from a list of names:
       · your rank inside HIS OWN org      (factions.js tier())
       · how his factions see yours        (factions.js reactionTo())
       · the level gap                     (interactions.js's own standing read
                                            — the same number the prompt and
                                            the dossier already use)
       · whether you are armed             (combat.js cityHasGun())
       · whether you are wanted            (g.wanted)
       · how far up HIS building you are   (occupy.js cityAccessAt())
     A tier-0 nobody is not a principal at all, so `powerReactionTo` answers
     "welcome" and the ordinary interaction is byte-for-byte unchanged.
     ====================================================================== */
  function reactionTo(a) {
    const rec = recOf(a);
    if (!on() || !rec) return "welcome";        // not a principal: nothing changes
    if (rec.audienceT > 0) return "welcome";    // you were let through
    if (rec.hostileT > 0) return "hostile";     // you already did something
    const k = rec.kit;
    const me = playerActor();

    let score = 0;

    // 1. ONE OF OURS. factions.js's tier() is your rank inside his outfit —
    //    -1 when you are not in it at all. A made man walks straight in.
    const myTier = (CBZ.factions && CBZ.factions.tier && rec.org) ? CBZ.factions.tier(rec.org) : -1;
    const inOrg = myTier >= 0;
    if (inOrg) {
      score += 2 + Math.min(3, myTier);
      if (myTier >= k.admit) score += 3;         // and senior enough to matter
    }
    // BEING INSIDE THE OUTFIT IS THE CREDENTIAL THE DOOR READS. A Sicario does
    // not have to out-LEVEL his own Cartel Head to be let past his people, so
    // for a member the two "he is bigger than you" terms below are damped to a
    // third. Without this, rank could never beat the level gap and the owner's
    // headline case — "a made man of the same cartel walks straight in" —
    // could not happen at the top of the ladder, which is the only place it
    // is interesting. (Measured: myTier 3 vs a tier-5 head reads `welcome`
    // with this line and `watch` without it.)
    const inside = inOrg ? 0.35 : 1;

    // 2. ALLEGIANCE — the ONE cross-faction query (-1 .. +1). It already
    //    consults turf.js's org graph and social.js's per-individual bond, so
    //    a personal history with THIS man is in here too.
    if (CBZ.factions && CBZ.factions.reactionTo && me) {
      let rel = 0;
      try { rel = +CBZ.factions.reactionTo(me, a) || 0; } catch (e) { rel = 0; }
      score += rel * 3;
    }

    // 3. THE LEVEL GAP — interactions.js's own read, so the detail, the prompt
    //    and the dossier can never disagree about who matters.
    if (CBZ.cityInteractionStanding) {
      let st = null;
      try { st = CBZ.cityInteractionStanding(a); } catch (e) { st = null; }
      if (st) score -= (clamp(num(st.gap, 0), -30, 60) / 20) * inside;
    }

    // 4. HOW BIG HE IS. The whole point: the same stranger is waved past a
    //    shop owner's man and stopped by a cartel head's people.
    score -= k.tier * 0.9 * inside;

    // 5. WHAT YOU ARE CARRYING AND WHAT YOU HAVE DONE.
    if (CBZ.cityHasGun && CBZ.cityHasGun()) score -= 2.2;
    score -= (g.wanted | 0) * 1.4;

    // 6. WHERE YOU ARE STANDING. Inside his tower, every floor of HIS that
    //    you have climbed costs you a notch — the floor ladder made social.
    score -= floorPenalty(rec);

    if (score >= 2.5) return "welcome";
    if (score >= -3.5) return "watch";
    if (score >= -9) return "challenge";
    return "hostile";
  }

  // how deep into his own floors are you? occupy.js already owns the spatial
  // answer; we only turn it into a number.
  function floorPenalty(rec) {
    if (!rec.seat || !rec.seat.lot || !CBZ.cityAccessAt) return 0;
    const P = CBZ.player;
    if (!P || !P.pos) return 0;
    let hit = null;
    try { hit = CBZ.cityAccessAt(P.pos.x, P.pos.y || 0, P.pos.z); } catch (e) { hit = null; }
    if (!hit || hit.lot !== rec.seat.lot) return 0;
    const first = num(rec.seat.firstFloor, 1);
    return Math.max(0, (num(hit.floor, 0) - first + 1)) * 2.2;
  }

  // EVERY body that answers to this principal, nearest first: his own ring,
  // plus — when he is seated in his tower and the ring IS the floor ladder —
  // the occupancy bodies occupy.js posted, which our `configure` hook stamped
  // with `_powerOf`. One list, so the intercept, the draw and the audit all
  // agree about who his people are whether he is on the pavement or on nine.
  const _near = [];
  function detailNear(rec, radius) {
    _near.length = 0;
    const P = CBZ.player;
    if (!P || !P.pos) return _near;
    const r2 = (radius || 1e9) * (radius || 1e9);
    const push = function (q) {
      if (!q || q.dead || !q.pos) return;
      const dx = q.pos.x - P.pos.x, dz = q.pos.z - P.pos.z;
      if (dx * dx + dz * dz > r2) return;
      q._powerD2 = dx * dx + dz * dz;
      _near.push(q);
    };
    for (let i = 0; i < rec.guards.length; i++) push(rec.guards[i]);
    const occ = rec.seat && rec.seat.occupancy;
    if (occ && occ.peds) {
      for (let i = 0; i < occ.peds.length; i++) {
        const q = occ.peds[i];
        if (!q || q === rec.actor || q.isFamily || q._occupyNoFight) continue;
        push(q);
      }
    }
    _near.sort(function (a, b) { return a._powerD2 - b._powerD2; });
    return _near;
  }

  // Who steps in? The nearest live body on his detail — that is the man who
  // does the talking, and the one the label names.
  function frontman(rec) {
    const list = detailNear(rec, rec.kit.challenge + 6);
    return list.length ? list[0] : null;
  }

  /* ---- THE ESCALATION LADDER: warn -> shove -> draw -> open fire ---------
     One scalar, `rec.stage`, 0..4. Distance and reaction set the TARGET
     stage; kit.climb decides how fast you get there and kit.cool how fast it
     bleeds off once you back away. Nothing here is a state machine of its own
     — each stage writes fields the shipped ped/cop brains already read. */
  const STAGE_WARN = 1, STAGE_SHOVE = 2, STAGE_DRAW = 3, STAGE_FIRE = 4;

  function targetStage(rec, react, d) {
    const k = rec.kit;
    if (react === "welcome") return 0;
    let s = 0;
    if (react === "watch") { s = d <= k.warn ? 1 : 0; }
    else if (react === "challenge") {
      s = d <= k.shove ? 3 : d <= k.warn ? 2 : d <= k.challenge ? 1 : 0;
    } else {                                  // hostile
      s = d <= k.warn ? 4 : d <= k.challenge ? 3 : 0;
    }
    // a drawn gun inside the ring is its own argument
    if (s > 0 && CBZ.cityHasGun && CBZ.cityHasGun() && d <= k.challenge) s += 1;
    if (s > 0 && (g.wanted | 0) >= 3) s += 1;
    return clamp(s, 0, 4);
  }

  const LINES = {
    1: ["That's close enough.", "Keep walking.", "Not today, friend.", "Back it up."],
    2: ["I said BACK UP.", "Hands where I can see them.", "You don't listen."],
    3: ["Last warning.", "Walk away. Now.", "Don't make me."],
  };
  function line(rec, q, stage) {
    if (!CBZ.citySay || !q) return;
    const t = nowS();
    if (t - rec.lineT < 2.6) return;
    rec.lineT = t;
    const pool = LINES[stage];
    if (!pool) return;
    // deterministic pick — never Math.random, even for a bark
    const h = CBZ.hash01 ? CBZ.hash01(Math.round(q.pos.x), Math.round(q.pos.z), 0x1cef) : 0.5;
    const say = pool[Math.min(pool.length - 1, Math.floor(h * pool.length))];
    try { CBZ.citySay(q, "“" + say + "”", stage >= 3 ? "#ff9aa2" : "#e8dcc0", 2.2); } catch (e) {}
  }

  function applyStage(rec, prev) {
    const s = Math.floor(rec.stage);
    if (s === Math.floor(prev)) return;
    const q = frontman(rec);
    const me = playerActor();
    if (s >= STAGE_WARN && s < STAGE_SHOVE) {
      // WARN — he turns, steps into your lane, says one line. Nothing else.
      if (q) { q._faceT = 1.2; line(rec, q, 1); }
    } else if (s >= STAGE_SHOVE && s < STAGE_DRAW) {
      // SHOVE — hands on you. Routed through the ONE player-damage bus
      // (combat.js cityHurtPlayer, `nonlethal`), never a raw hp write.
      if (q) {
        line(rec, q, 2);
        if (CBZ.cityHurtPlayer) {
          try { CBZ.cityHurtPlayer(2, q.pos.x, q.pos.z, "shoved by the detail", false, q, true); } catch (e) {}
        }
        if (CBZ.cityRelShift && me) { try { CBZ.cityRelShift(q, "intimidated", 0.5); } catch (e) {} }
      }
    } else if (s >= STAGE_DRAW && s < STAGE_FIRE) {
      // DRAW — leather clears across the whole detail, but nobody fires. The
      // cops do this through their own `relaxed` post branch the moment they
      // can see you; the private bodies use peds.js's own "confront" state,
      // which is literally documented there as "close in, threaten".
      // A body rooted on `staffPost` (an occupancy floor guard) has to be
      // stood UP off the post first — the same two-state grammar occupy.js's
      // own wake() uses, stashing the post so stand-down can restore it.
      const list = detailNear(rec, rec.kit.challenge + 6);
      for (let i = 0; i < list.length; i++) {
        const gd = list[i];
        if (gd._powerCop) continue;
        gd.armed = true;
        if (CBZ.syncActorWeapon) { try { CBZ.syncActorWeapon(gd); } catch (e) {} }
        if (gd.staffPost) {
          gd._occupyPost = gd._occupyPost || { x: gd.staffPost.x, z: gd.staffPost.z, face: gd.staffPost.face };
          gd.staffPost = null;
          gd.guard = { x: gd._occupyPost.x, z: gd._occupyPost.z }; gd.homeGuard = gd.guard;
          gd._occupyAwake = true;
        }
        gd.state = "confront";
        if (me && gd.target) gd.target.set(me.pos.x, 0, me.pos.z);
      }
      line(rec, q, 3);
    } else if (s >= STAGE_FIRE) {
      // OPEN FIRE — one call per consequence, all of them existing.
      openFire(rec, me);
    }
  }

  function openFire(rec, me) {
    if (!me) return;
    rec.hostileT = Math.max(rec.hostileT, 45);
    for (let i = 0; i < rec.guards.length; i++) {
      const q = rec.guards[i];
      if (!q || q.dead || q._powerCop) continue;
      q.rage = me; q.state = "fight"; q.alarmed = Math.max(q.alarmed || 0, 6);
      q.guard = { x: q.pos.x, z: q.pos.z }; q.homeGuard = q.guard;
    }
    // the SET is the real protection for an outlaw principal — gangs.js's own
    // provoke/rally/shape machinery, fired through the org id. Not one line
    // of gang war logic lives here.
    if (!rec.kit.lawful && rec.org) {
      if (CBZ.cityGangProvoke) { try { CBZ.cityGangProvoke(rec.org, rec.kit.reprisal); } catch (e) {} }
      const sh = frontman(rec) || rec.actor;
      if (CBZ.cityRallyGang && sh) { try { CBZ.cityRallyGang(sh, me); } catch (e) {} }
      if (CBZ.cityGangShapeUp) { try { CBZ.cityGangShapeUp(rec.org); } catch (e) {} }
    }
    // inside his tower, the building itself learns you are in it — occupy.js's
    // alarm, which climbs the floors ahead of you. We author no alarm.
    if (rec.seat && rec.seat.lot && CBZ.cityOccupyAlarm) {
      try { CBZ.cityOccupyAlarm(rec.seat.lot, me, null, { secs: 20 }); } catch (e) {}
    }
    // and the principal himself gets out of the way, through peds.js's own
    // flee primitive — unless he is the sort who shoots back.
    const a = rec.actor;
    if (a && !a.dead && rec.kit.tier < 4 && CBZ.cityFleeFrom && CBZ.player) {
      try { CBZ.cityFleeFrom(a, CBZ.player.pos.x, CBZ.player.pos.z); } catch (e) {}
    }
  }

  function driveStage(rec, dt) {
    const k = rec.kit;
    if (rec.audienceT > 0) rec.audienceT -= dt;
    if (rec.hostileT > 0) rec.hostileT -= dt;
    const d = distToPlayer(rec.actor);
    if (d > k.challenge * 1.5 && rec.stage <= 0) return;
    const react = reactionTo(rec.actor);
    let tgt = targetStage(rec, react, d);
    // grace: a detail does not bark the instant you enter the ring. kit.patience
    // is the beat of silence a small man's guy gives you and a kingpin's does not.
    if (tgt >= 1 && rec.stage < 1) {
      rec.sinceT += dt;
      if (rec.sinceT < k.patience * 0.25) tgt = 0;
    } else if (tgt <= 0) rec.sinceT = 0;

    const prev = rec.stage;
    if (tgt > rec.stage) rec.stage = Math.min(tgt, rec.stage + k.climb * dt);
    else if (tgt < rec.stage) rec.stage = Math.max(tgt, rec.stage - k.cool * dt);
    if (Math.floor(rec.stage) !== Math.floor(prev)) applyStage(rec, prev);
  }

  /* ======================================================================
     §6  THE FLOOR LADDER — his tower is HIS.

     occupy.js already ships the whole capability: a real switchback stair
     core, per-floor rooms with authored programs, rooted guards, family in
     the top suite, a per-floor access model and an alarm that climbs the
     building ahead of you. power.js authors NONE of it. It reads occupy.js's
     OWN preset table and re-stamps exactly two things the tier decides:
     WHICH floors are his, and how many bodies stand on them.
     ====================================================================== */
  function seatHim(rec) {
    if (rec.seated || !rec.seat || !rec.seat.lot) return;
    const lot = rec.seat.lot;
    if (!CBZ.cityOccupyBuilding || !CBZ.cityFloorCount) return;   // occupy.js absent: seat is remembered, ignored
    const n = Math.max(1, CBZ.cityFloorCount(lot) | 0);
    if (n < 1) return;
    rec.seated = true;                                            // one attempt, ever

    const k = rec.kit;
    const top = Math.max(0, n - 1);
    const askFloor = (rec.seat.floor != null) ? clamp(rec.seat.floor | 0, 0, top) : top;
    // his floors: the one he sits on, plus kit.floors below it.
    const first = Math.max(1, askFloor - k.floors);
    rec.seat.firstFloor = first;
    rec.seat.topFloor = askFloor;

    const presetName = presetFor(rec.org, k.lawful);
    const pre = CBZ.cityOccupyPreset ? CBZ.cityOccupyPreset(presetName, n) : null;
    let floors = (pre && pre.floors) ? pre.floors.slice() : null;

    if (floors) {
      // ---- the ONE thing the tier decides that occupy.js cannot know ------
      floors = floors.map(function (fs) {
        const f = {};
        for (const key in fs) f[key] = fs[key];
        const lv = f.level;
        if (typeof lv === "number") {
          // below his floors a tower is an ordinary business you may walk into;
          // at and above `first` it is his, and you may not.
          if (lv < first) { f.access = lv === 0 ? "public" : "staff"; }
          else { f.access = "faction"; f.faction = rec.org || f.faction; }
          f.count = clamp(Math.round(num(f.count, 1) * (0.6 + 0.18 * k.tier)), 1, 5);
        } else if (lv === "top") {
          f.access = "vip";
          f.faction = rec.org || f.faction;
          f.family = k.family;
          f.count = clamp(k.detail, 1, 6);
          // WE are the boss on that floor — the declared principal, a body the
          // world already runs. Suppressing occupy.js's own vip spawn is what
          // stops this file from minting a second important person and is the
          // literal application of contracts.js's law (the world supplies the
          // specifics, the generator never spawns the target).
          f.vip = false;
          // …but occupy.js only honours `guardRole` when `vip` is truthy
          // (spawnPost's postRole line), so with vip:false the top-floor POSTS
          // would have been cast in the BOSS role — six men with the boss's job
          // title, hp and wardrobe standing in his own suite. Promote the
          // guardRole to be the floor's role instead: same table, right bodies.
          if (f.guardRole) { f.role = f.guardRole; f.guardRole = null; }
        } else if (lv === "door" || lv === "outside") {
          f.count = k.tier >= 2 ? clamp(num(f.count, 2), 1, 4) : 0;
        }
        return f;
      }).filter(function (f) { return f.count !== 0; });
    }

    let occ = null;
    try {
      occ = CBZ.cityOccupyBuilding(lot, {
        id: "power:" + rec.id,
        preset: floors ? null : presetName,
        floors: floors || undefined,
        faction: rec.org || null,
        label: rec.role + "'s floor",
        crime: (pre && pre.crime) || "trespass",
        src: "power:seat",
        configure: function (ped, info) {
          // every body in his building is HIS, which is the only reason the
          // detail and the floors can share one reaction rule.
          ped._powerOf = rec;
          if (info && info.family) ped._occupyNoFight = true;
        },
      });
    } catch (e) { occ = null; }
    if (!occ) return;

    // ---- put the declared principal in the chair -------------------------
    // occupy.js's program authored a `boss` anchor on that floor and, because
    // we passed vip:false, nobody consumed it. Take it. A caller-supplied
    // floor that no spec opened falls back to the top storey, which is the one
    // the preset's "bosssuite" program actually dressed.
    let fr = findFloorRec(occ, askFloor);
    if (!fr) { fr = findFloorRec(occ, top); if (fr) { rec.seat.topFloor = top; } }
    const seatFloor = fr ? fr.k : askFloor;
    const b = lot.building;
    if (fr && b && b.ox != null) {
      const anc = takeAnchor(fr, "boss");
      const wx = anc ? b.ox + num(anc.lx, 0) : b.ox;
      const wz = anc ? b.oz + num(anc.lz, 0) : b.oz;
      const y = num(fr.y, 0);
      const a = rec.actor;
      if (a && a.pos && a.pos.set) {
        a.pos.set(wx, y, wz);
        if (a.group) { a.group.position.set(wx, y, wz); a.group.rotation.y = num(anc && anc.face, 0); }
        // occupy.js's floor lift is the ONLY thing in this engine that holds a
        // body above y=0 against peds.js's own gravity clamp. One call.
        if (CBZ.cityFloorPed) { try { CBZ.cityFloorPed(a, y); } catch (e) {} }
        // rooted on peds.js's posted-staff brain: no wander, no crowd recast,
        // still gunpoint-aware, still dies through the kill bus.
        a.staffPost = { x: wx, z: wz, face: num(anc && anc.face, 0) };
        a.state = "idle"; a.speed = 0;
        a._occupyOf = occ.id; a._occupyFloor = seatFloor; a._occupyAccess = "vip";
        a._occupyPost = { x: wx, z: wz, face: num(anc && anc.face, 0) };
        a._occupyPinned = true;
        a.protectLot = lot;
        a.isVip = true;
      }
    }
    // ONE answer to "who is the boss of this building": occupy.js's own
    // query now returns the real declared principal, not a second body.
    occ.vip = rec.actor;
    if (rec.actor) rec.actor.protectLot = lot;
    if (CBZ.cityOccupyGrant) { try { CBZ.cityOccupyGrant(lot, "vip", rec.actor); } catch (e) {} }
    // his people are the people in HIS building — one stamp, same helper the
    // bind path uses, so a built ladder and a bound one are indistinguishable.
    bindOccupancy(rec, occ);
    rec.seat.occupancy = occ;
  }

  function findFloorRec(occ, k) {
    if (!occ || !occ.floors) return null;
    for (let i = 0; i < occ.floors.length; i++) if (occ.floors[i].k === k) return occ.floors[i];
    return null;
  }
  function takeAnchor(fr, kind) {
    if (!fr || !fr.anchors) return null;
    for (let i = 0; i < fr.anchors.length; i++) {
      const a = fr.anchors[i];
      if (a && !a._used && (a.kind || "seat") === kind) { a._used = true; return a; }
    }
    return null;
  }

  /* ======================================================================
     §7  DEATH — who answers for him, and at how many stars.

     We never toast anything (HUD doctrine: the killfeed is the only popup,
     and killfeed.js has ALREADY logged this death because it wraps
     cityKillPed). What we add is the RESPONSE, and every piece of it is an
     existing call.
     ====================================================================== */
  function noteDeath(rec) {
    if (rec.mourned) return;
    rec.mourned = true;
    rec.scanT = 10;              // the detail fights over the body before it stands down
    const k = rec.kit, a = rec.actor;
    const by = a && (a.killedBy || a.lastAttacker || a.mem || null);
    const me = playerActor();
    let byPlayer = !!(by && (by === me || by === CBZ.player || by.isPlayer));
    if (!by && me && distToPlayer(a) < k.challenge * 2 && CBZ.cityHasGun && CBZ.cityHasGun()) {
      byPlayer = true;                       // no attacker recorded, but you were stood there with a gun
    }
    if (byPlayer && k.deathStars > 0 && CBZ.cityAddStars) {
      try { CBZ.cityAddStars(k.deathStars, "killed the " + rec.role); } catch (e) {}
    }
    if (byPlayer && !k.lawful && rec.org) {
      if (CBZ.cityGangProvoke) { try { CBZ.cityGangProvoke(rec.org, Math.min(1, k.reprisal + 0.3)); } catch (e) {} }
      if (CBZ.cityGangShapeUp) { try { CBZ.cityGangShapeUp(rec.org); } catch (e) {} }
    }
    // the detail finishes the fight over the body, then stands down.
    openFire(rec, byPlayer ? me : (by || null));
    if (CBZ.cityFeed) {
      try {
        CBZ.cityFeed("The " + rec.role + " is dead." +
          (k.lawful ? " Every unit in the district just heard it." : " His people will want a name."),
          k.lawful ? "#8fc1ff" : "#ff9e6b");
      } catch (e) {}
    }
  }

  /* ======================================================================
     §8  THE VERBS — routed through interactions.js, never a parallel prompt.

     Three registrations on the layers that already exist. Slot exclusivity
     does the rest: the highest-priority passing option OWNS its key, so
     "the detail steps in" REPLACES "Talk" on a principal without either
     option having to know the other exists.
     ====================================================================== */
  let verbsDone = false;
  function registerVerbs() {
    if (verbsDone || !on()) return;
    const I = CBZ.interactions;
    if (!I || !I.register) return;
    verbsDone = true;

    // ---- 1. THE INTERCEPT. His detail talks to you; he does not. ---------
    I.register("ped:civ", {
      id: "power-detail-stop", slot: "e", prio: 74,
      canShow: function (p) {
        const rec = recOf(p);
        // NO DETAIL, NO INTERCEPT. A principal standing alone is just a person
        // you talk to — the ordinary card, unchanged. This is the line that
        // keeps "walk up to a nobody and he interacts with you" true.
        if (!rec || p.dead || !frontman(rec)) return false;
        const r = reactionTo(p);
        return r === "challenge" || r === "hostile" || r === "watch";
      },
      label: function (p) {
        const rec = recOf(p);
        const q = rec ? frontman(rec) : null;
        const who = (q && q.name) ? q.name : "The detail";
        const r = reactionTo(p);
        return r === "hostile" ? who + " blocks you" : who + " steps in";
      },
      onSelect: function (p) {
        const rec = recOf(p);
        if (!rec) return;
        const q = frontman(rec);
        // pressing into a detail IS the escalation — one push up the ladder,
        // through the same scalar distance drives.
        const prev = rec.stage;
        rec.stage = Math.min(4, Math.max(rec.stage, 1) + 1);
        if (q) q._faceT = 1.4;
        applyStage(rec, prev);
        // and the honest read of why: the phone, not a floating card.
        if (CBZ.city && CBZ.city.note) {
          const r = reactionTo(p);
          CBZ.city.note(r === "hostile"
            ? "They know your face. There is no version of this that ends well."
            : "You are not somebody they have to let through.",
            2.2, { from: (rec.role || "SECURITY").toUpperCase(), app: "missions" });
        }
      },
    });

    // ---- 2. THE WELCOME. A made man of the same outfit walks straight in. -
    I.register("ped:civ", {
      id: "power-pay-respects", slot: "e", prio: 73,
      canShow: function (p) {
        const rec = recOf(p);
        return !!rec && !p.dead && reactionTo(p) === "welcome";
      },
      label: function (p) {
        const rec = recOf(p);
        return "Pay respects to the " + (rec ? rec.role : "boss");
      },
      onSelect: function (p) {
        const rec = recOf(p);
        if (!rec) return;
        rec.audienceT = Math.max(rec.audienceT, 90);
        rec.stage = 0;
        // being received by somebody who matters IS standing — factions.js
        // owns that number, so we move THEIRS rather than inventing one.
        if (rec.org && CBZ.factions && CBZ.factions.addStanding) {
          try { CBZ.factions.addStanding(rec.org, 0.05); } catch (e) {}
        }
        if (CBZ.cityRelShift) { try { CBZ.cityRelShift(p, "greeted", 0.6); } catch (e) {} }
        // an audience is a PASS: his floors open to you for as long as it lasts.
        if (rec.seat && rec.seat.lot && CBZ.cityOccupyGrant) {
          try { CBZ.cityOccupyGrant(rec.seat.lot, "faction", playerActor()); } catch (e) {}
        }
        if (CBZ.citySay) {
          try { CBZ.citySay(p, "“You're expected. Sit down.”", "#8fe08a", 2.4); } catch (e) {}
        }
      },
    });

    // ---- 3. THE WAY IN. Ask the man on the door for a word. --------------
    I.register("ped:civ", {
      id: "power-detail-word", slot: "k", prio: 47,
      canShow: function (q) {
        // `_powerOf` is the ONE membership stamp — it is on ring guards AND on
        // every body occupy.js posted in his building, so the same verb works
        // on the man at the rope and the man on the ninth-floor landing.
        const rec = q && q._powerOf;
        return !!(rec && rec.live && !q.dead && q !== rec.actor && !q.isFamily &&
          rec.actor && !rec.actor.dead && rec.audienceT <= 0 && rec.hostileT <= 0);
      },
      label: function (q) { return "Ask for a word with the " + (q._powerOf.role || "boss"); },
      onSelect: function (q) {
        const rec = q._powerOf;
        if (!rec) return;
        // scored off the SAME gap the reaction uses, one notch more forgiving —
        // a guard can be talked round where a closed door cannot.
        const r = reactionTo(rec.actor);
        const armed = !!(CBZ.cityHasGun && CBZ.cityHasGun());
        if (armed) {
          if (CBZ.citySay) { try { CBZ.citySay(q, "“Not with that in your hand.”", "#ff9aa2", 2.2); } catch (e) {} }
          const prev = rec.stage; rec.stage = Math.max(rec.stage, 2); applyStage(rec, prev);
          return;
        }
        if (r === "hostile" || (g.wanted | 0) > 0) {
          if (CBZ.citySay) { try { CBZ.citySay(q, "“You're joking.”", "#ff9aa2", 2.2); } catch (e) {} }
          return;
        }
        if (r === "watch") {
          rec.audienceT = Math.max(rec.audienceT, 45);
          if (CBZ.citySay) { try { CBZ.citySay(q, "“Two minutes. Don't waste them.”", "#8fe08a", 2.4); } catch (e) {} }
          if (CBZ.cityRelShift) { try { CBZ.cityRelShift(q, "greeted", 0.4); } catch (e) {} }
          return;
        }
        if (CBZ.citySay) { try { CBZ.citySay(q, "“He doesn't know you. Come back when he does.”", "#e8dcc0", 2.4); } catch (e) {} }
      },
    });
  }

  /* ======================================================================
     §9  THE BOOTSTRAP — bind to the principals the world was ALREADY running.

     contracts.js's binding law, applied: the generator picks the verb, the
     WORLD supplies the specifics. This file never spawns a principal. It
     looks for bodies the simulation already made important and declares them.
     ====================================================================== */
  let adoptT = 0;

  // A gang boss's tier is read off the outfit he actually runs — how much
  // ground it holds and how heavy it is — never off his name.
  function gangTier(gn) {
    const turf = (gn.turf && gn.turf.length) | 0;
    const heavy = (gn.type === "cartel" || gn.type === "syndicate") ? 1 : 0;
    return clamp(2 + Math.round(turf / 4) + heavy, 2, 5);
  }

  function adoptSweep() {
    if (CFG.POWER_ADOPT === false) return;

    // (a) GANG BOSSES — gangs.js has always made one; nothing has ever
    //     protected him as a person.
    const gangs = CBZ.cityGangs || [];
    for (let i = 0; i < gangs.length; i++) {
      const gn = gangs[i];
      if (!gn || gn.absorbed || !gn.boss || gn.boss.dead) continue;
      if (recOf(gn.boss)) continue;
      const t = gangTier(gn);
      CBZ.powerPrincipal(gn.boss, {
        id: "power:gang:" + gn.id,
        tier: t,
        org: gn.id,
        role: (CBZ.cityRankName ? CBZ.cityRankName("boss") : "Boss") + " of the " + (gn.name || gn.id),
        lawful: false,
      });
      CBZ.powerMigrated("gangs:boss");
    }

    // (b) OCCUPIED BUILDINGS — occupy.js already put a VIP in a top-floor
    //     suite with security below and family beside him. He had no standing,
    //     no reaction rule and no ring outside the building.
    const occs = CBZ.cityOccupancies || [];
    for (let i = 0; i < occs.length; i++) {
      const occ = occs[i];
      if (!occ || !occ.vip || occ.vip.dead || recOf(occ.vip)) continue;
      if (String(occ.id || "").indexOf("power:") === 0) continue;   // ours already
      const floors = occ.floors ? occ.floors.length : 1;
      const t = clamp(2 + Math.round(floors / 3), 2, 5);
      CBZ.powerPrincipal(occ.vip, {
        id: "power:occ:" + occ.id,
        tier: t,
        org: occ.faction || null,
        role: occ.label ? String(occ.label).replace(/'s floor$/, "") : (occ.vip.job || "Boss"),
        // THE LADDER ALREADY EXISTS. Passing a live `occupancy` on the seat is
        // how you BIND to a building instead of rebuilding it — seatHim() is
        // skipped entirely, so re-occupying the lot (which would tear down
        // occupy.js's own cast mid-run) can never happen.
        seat: { lot: occ.lot, occupancy: occ, firstFloor: 1 },
        // and his ring IS those floors. A second, street-level ring around a
        // man who already has a building full of security is the exact
        // duplication this file exists to end.
        ring: false,
      });
      CBZ.powerMigrated("occupy:vip");
    }

    // (c) vips.js PRINCIPALS — declared ring:false ON PURPOSE. vips.js keeps
    //     its own detail (migrating it is an edit to a file this wave does not
    //     own); what it gains here is the ROLE + INTERCEPT + reaction layer,
    //     which it never had. A second ring would be the exact duplication
    //     this file exists to end.
    const V = CBZ.cityVips;
    if (V && V.slots) {
      for (let i = 0; i < V.slots.length; i++) {
        const sl = V.slots[i];
        if (!sl || sl.state !== "live" || !sl.principal || sl.principal.dead) continue;
        if (recOf(sl.principal)) continue;
        const def = sl.def || {};
        // his tier is read back off the level vips.js already authored, through
        // the SAME curve — level(t) = 30 + 14t, inverted.
        const lv = num(sl.principal.vipLvl, 60);
        CBZ.powerPrincipal(sl.principal, {
          id: "power:vip:" + i,
          tier: clamp(Math.round((lv - 30) / 14), 1, 5),
          org: sl.gangId || null,
          role: def.title || "VIP",
          ring: false,
          lawful: !!(def.cops && def.cops > 0),
        });
        CBZ.powerMigrated("vips:principal");
      }
    }
  }

  /* ======================================================================
     §10 THE TICK — one pass, after every system whose fields we read.
     35.79: peds.js (34) · gangs.js (34.6) · police.js (35) · occupy.js
     (35.07) · vips.js (35.7) · officials.js (35.73) · protection.js (35.75).
     We are the last word in the "who is embodied right now" neighbourhood, so
     a slot we write this frame is read by the shipped brains on the next one.
     ====================================================================== */
  const TICK = (CBZ.PRIO && CBZ.PRIO.after) ? CBZ.PRIO.after(CBZ.PRIO.POLICE, 79) : 35.79;
  if (CBZ.onUpdate) CBZ.onUpdate(TICK, function (dt) {
    if (!on()) return;
    if (!g || g.mode !== "city") return;
    registerVerbs();
    recountBudget();

    adoptT -= dt;
    if (adoptT <= 0) { adoptT = 3; try { adoptSweep(); } catch (e) {} }

    for (let i = REG.length - 1; i >= 0; i--) {
      const rec = REG[i];
      const a = rec.actor;
      // the record dies with the body it rode on — no sweep, no orphan.
      if (!a || (CBZ.cityPeds && CBZ.cityPeds.indexOf(a) < 0 && !a.isPlayer)) { dissolve(rec); continue; }
      if (a.dead) {
        noteDeath(rec);
        rec.scanT -= dt;
        if (rec.scanT <= 0) { releaseGuards(rec, false); dissolve(rec); }
        continue;
      }
      // keep the pill honest if some other system re-tagged him
      if (a.vipTitle !== rec.role) a.vipTitle = rec.role;
      if (CFG.POWER_RING !== false) driveRing(rec, dt);
      driveStage(rec, dt);
    }
  });

  /* ======================================================================
     §11 THE PUBLIC SURFACE — the one-line reads that make this adoptable.
     ====================================================================== */
  CBZ.powerIs = function (a) { return !!recOf(a); };
  CBZ.powerTierOf = function (a) { const r = recOf(a); return r ? r.kit.tier : 0; };
  CBZ.powerRoleOf = function (a) { const r = recOf(a); return r ? r.role : ""; };
  CBZ.powerReactionTo = reactionTo;
  CBZ.powerOrgOf = function (a) { const r = recOf(a); return r ? r.org : null; };
  CBZ.powerKitOf = function (a) { const r = recOf(a); return r ? r.kit : null; };
  CBZ.powerGuardsOf = function (a) { const r = recOf(a); return r ? r.guards.slice() : []; };
  // "is this body somebody's security?" — the ONE answer, so nothing ever
  // re-derives a detail-membership test again.
  CBZ.powerGuardOf = function (q) {
    const rec = q && q._powerOf;
    return (rec && rec.live) ? rec.actor : null;
  };
  CBZ.powerPrincipals = function () {
    const out = [];
    for (let i = 0; i < REG.length; i++) if (REG[i].live) out.push(REG[i].actor);
    return out;
  };
  CBZ.powerDissolve = function (a) { const r = recOf(a); if (r) dissolve(r); return !!r; };
  // world teardown. The interaction REGISTRATIONS deliberately survive: the
  // registry is not rebuilt with the arena, and re-registering the same ids
  // on every city rebuild would stack duplicate options forever.
  CBZ.powerReset = function () {
    for (let i = REG.length - 1; i >= 0; i--) dissolve(REG[i]);
    REG.length = 0; guardBudget = 0; adoptT = 0;
  };

  /* ======================================================================
     §12 THE RATCHET — CBZ.powerAudit()

     `legacyGuardSites` is the pin. Baseline 9, counted FILE BY FILE against
     HEAD 4a16699 (the list is in this file's header, every entry with a line
     number you can open). It may only ever go DOWN, and a file that migrates
     calls CBZ.powerMigrated("<tag>") ONCE — one line, no ceremony, exactly
     like CBZ.factionMigrated.

     `principals` / `guarded` / `unguarded` are EVIDENCE, not pins: they say
     how many important people the live world actually has and how many of
     them have a body standing next to them. `unguarded` being large is not a
     failure — a `ring:false` declaration (vips.js) is deliberate, and a
     principal 300m away has released his detail on purpose.
     ====================================================================== */
  const SITES = [
    { tag: "vips:guards", file: "src/city/vips.js:725 driveGuards", what: "suited/made walking detail + its own formation table" },
    { tag: "vips:cops", file: "src/city/vips.js:766 driveCops", what: "a SECOND, different escort formation for the police details" },
    { tag: "protection:escort", file: "src/city/protection.js:299 driveEscort / :317 driveEscortPosted", what: "ProtectionDetail follow (officials.js Secret Service + player-hired security)" },
    { tag: "millionaires:guard", file: "src/city/millionaires.js:445 driveGuard", what: "a magnate's single trailing bodyguard" },
    { tag: "security:shop", file: "src/city/security.js:32 spawnCitySecurity", what: "shop-front private guards on their own post fields" },
    { tag: "island_military:gate", file: "src/city/island_military.js:1078", what: "stationed gate guards on a FOURTH post field shape (`_stationed`)" },
    { tag: "campaign:ring", file: "src/city/campaign.js:1560", what: "the DIRECTOR'S LIST contract target's bodyguard ring" },
    { tag: "loyalty:interpose", file: "src/city/loyalty.js:196", what: "companion interpose / shield" },
    { tag: "gangs:boss", file: "src/city/gangs.js:504", what: "the boss and the crew that protects him" },
  ];
  const migrated = Object.create(null);
  CBZ.powerMigrated = function (tag) { if (tag) migrated[String(tag)] = true; };

  CBZ.powerAudit = function () {
    let principals = 0, guarded = 0, unguarded = 0, bodies = 0, seats = 0;
    for (let i = 0; i < REG.length; i++) {
      const rec = REG[i];
      if (!rec.live || !rec.actor || rec.actor.dead) continue;
      principals++;
      let live = 0;
      for (let q = 0; q < rec.guards.length; q++) if (rec.guards[q] && !rec.guards[q].dead) live++;
      bodies += live;
      if (live > 0) guarded++; else unguarded++;
      if (rec.seat && rec.seat.occupancy) seats++;
    }
    let legacy = 0;
    for (let i = 0; i < SITES.length; i++) if (!migrated[SITES[i].tag]) legacy++;
    return {
      // ---- THE PIN. Baseline 9. Only ever down. ----
      legacyGuardSites: legacy,
      baseline: SITES.length,
      // ---- evidence ----
      principals: principals,
      guarded: guarded,
      unguarded: unguarded,
      bodies: bodies,
      seats: seats,
      budget: guardBudget,
      migrated: Object.keys(migrated),
      sites: SITES.filter(function (s) { return !migrated[s.tag]; })
        .map(function (s) { return s.tag + " (" + s.file + ")"; }),
    };
  };

  /* ======================================================================
     §THE ONE EDIT OWED — the thing this file cannot do to itself.

     police.js:2498's posted-officer branch is the correct brain for EVERY
     standing guard in this game, and it is trapped inside a loop over
     CBZ.cityCops. Lifting it out is the migration that would let this file
     delete its own follow code and would collapse four post field shapes
     (`_post`, `guard`/`homeGuard`, `staffPost`, `_stationed`) into one:

       police.js — extract the body of `if (c._post) { ... }` into
         `CBZ.cityPostTick(actor, post, dt, opts)` and call it from that
         branch. Then power.js's private detail, security.js's shop guards
         and island_military.js's gate guards all run the identical brain.

     And one live bug that a second `_post` consumer surfaces: that branch's
     roadblock-teardown arm (`if (RB.state === 2) { ...mount up... }`) fires
     for ANY officer carrying a `_post`, not just the roadblock's own — so a
     citywide roadblock ending can march a checkpoint or detail officer to a
     cruiser and splice him out of CBZ.cityCops. checkpoints.js has the same
     latent exposure today. The fix is one predicate:
         if (RB.state === 2 && RB.cops.indexOf(c) >= 0) { ... }
     This file defends against it (mountT is zeroed every tick and a lost
     officer is re-staffed), but the defence belongs in police.js.

     §CLAUDE.md ENTRY TO ADD, under "Engine systems — REUSE these":

       - **Power / protection** — `src/city/power.js`. ONE declaration,
         `CBZ.powerPrincipal(actor, {tier, org, role, seat, family})`, turns any
         actor the world already runs into a PRINCIPAL: a ring of guards, the
         `Lv.N Role` pill, a reaction rule, a floor ladder and a death response.
         **`CBZ.powerKit(tier)` IS HOW YOU ADOPT IT** — it writes the whole
         bundle (detail size, weapons off protection.js's GEAR, armour, standoff,
         challenge/warn/shove/draw radii, escalation rate, stars-on-death, floors
         owned, family size) from ONE number, through power laws solved against
         vips.js's five authored CAST rows. **No role name appears in the table,
         and adding a Mayor/Don/CEO must never mean adding a row.**
         `CBZ.powerReactionTo(actor)` -> `welcome|watch|challenge|hostile` is the
         ONE answer to "how does this person's security treat me", computed from
         the GAP (your rank in HIS org via `factions.tier`, allegiance via
         `factions.reactionTo`, the level gap via `cityInteractionStanding`,
         armed, wanted, how far up his building you are) — never a hardcoded
         list. The intercept is three `I.register` calls on the existing
         `ped:civ` layer, so the detail's verb REPLACES the principal's by slot
         exclusivity and no new popup exists. The floor ladder is
         `cityOccupyBuilding` with occupy.js's OWN preset re-stamped by tier —
         power.js authors no interior, no stairs, no alarm. Ratchet:
         `CBZ.powerAudit().legacyGuardSites`, baseline **9**.
     ====================================================================== */
})();
