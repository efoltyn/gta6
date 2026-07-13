/* ============================================================
   city/social.js — relationships, family, and hostages. The "real
   NPC shit": people come in couples/families, you can date a civilian
   up to a partner and marry them, your partner walks with you and
   lives in your home — and can be taken hostage by a gang (a rescue
   mission), while you can grab a hostage of your own at gunpoint.

   Drives "controlled" peds (companion / hostage / kidnap victim) by
   setting their target each frame; city/peds.js skips its brain for
   them. Exposes: citySocialInit, cityFlirt, cityPropose, cityTakeHostage,
   cityReleaseHostage, citySocialDeath, cityIsRomance, reset.

   AMBIENT LIFE layer (new): civilians are woven into couples, families and
   friend cliques; a daily-routine director gathers crowds at a venue that
   fits the hour (a club queue/dancefloor at night, a busy shop by day);
   gossip + reactions spread through the social graph (witnessed kills turn
   the block against you, a date / proposal / breakup ripples out); and an
   ambient-event director plays little street vignettes (arguments, proposals,
   buskers, friends greeting) with cheap pooled speech bubbles. New exports:
   cityGossip(x,z,topic,weight), citySocialWitnessKill(victim,byPlayer).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;
  const S = () => (CBZ.CITY && CBZ.CITY.social) || {};

  let _s = 271828;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }

  let beacon = null, kidnapCD = 0;
  let relTickT = 1, relTickCur = 0, _wrapped = false;
  // spouses/kids we SPAWN for important NPCs (bosses, tycoons, socialites) so we
  // can dispose them cleanly on reset and keep the population bounded.
  const _familySpawns = [];
  // hard cap on extra bodies we add for families — keeps the crowd (~90 rigs)
  // sane no matter how many bosses/whales the city rolled.
  const FAMILY_CAP = 14;

  // ===========================================================================
  //  PERSONAL RELATIONSHIPS — a multi-axis CONTINUUM each NPC holds toward the
  //  player, the way Tyranny tracks Loyalty/Fear and RimWorld decays opinion
  //  from remembered events. Every axis 0..100; they push and pull each other
  //  (respect dampens fear, grudge corrodes loyalty) and they DRIVE real ped
  //  behaviour by writing the flags city/peds.js already reads — snitch nerve,
  //  fear/surrender, recruit-willingness, and a delayed grudge AMBUSH.
  //    ped.relPlayer = { respect, fear, loyalty, affection, grudge, seen, t }
  //  We never edit peds.js; we set its inputs (ped.snitch, ped.fear, ped.rage,
  //  ped.mem, ped.surrenderT, ped.state) and expose reads other systems pull.
  // ===========================================================================
  const REL_KEYS = ["respect", "fear", "loyalty", "affection", "grudge"];
  function clamp100(v) { return v < 0 ? 0 : v > 100 ? 100 : v; }

  // lazily attach + return a ped's relationship record toward the player. We
  // seed it once from the ped's existing disposition so a hardened gang-banger
  // doesn't start out neutral and a meek civilian isn't pre-loaded with fear.
  CBZ.cityRel = function (ped) {
    if (!ped) return null;
    let r = ped.relPlayer;
    if (!r) {
      r = ped.relPlayer = {
        respect: 0, fear: 0, loyalty: 0,
        affection: ped.affection || 0,
        grudge: 0, seen: 0, t: 0, ambushT: 0,
      };
      // gangs respect strength but resist loyalty; the timid carry latent fear.
      if (ped.gang) r.respect = 8 + (ped.aggr || 0.5) * 10;
      if ((ped.aggr || 0.3) < 0.32) r.fear = 6;
    }
    return r;
  };

  // a single SIGNED read of the bond: loved (+) ⟷ hated (−). Loyalty+respect+
  // affection pull positive; grudge+(unearned)fear pull negative. Other systems
  // (recruiting, shop prices, witness) ask for this one number.
  function bondOf(ped) {
    const r = CBZ.cityRel(ped); if (!r) return 0;
    const pos = r.loyalty * 1.1 + r.respect * 0.8 + r.affection * 0.7;
    const neg = r.grudge * 1.3 + Math.max(0, r.fear - r.respect * 0.5) * 0.6;
    return (pos - neg) / 100;   // roughly -1.5 .. +2 in practice
  }
  CBZ.cityBond = bondOf;

  // EVENT → axis deltas. The heart of the sim: an action means different things
  // on different axes at once (paying someone buys loyalty AND respect AND a
  // little affection; killing their friend is pure fear+grudge, zero loyalty).
  // Amounts are scaled by the caller's `amt` (default 1) so a big favour lands
  // harder than a small one. These mirror real reputation-sim event tables.
  const REL_EVENTS = {
    helped:    { respect: +6, loyalty: +9, affection: +3, fear: -3, grudge: -4 },
    paid:      { respect: +7, loyalty: +11, affection: +5, fear: -2, grudge: -6 },
    gift:      { respect: +5, loyalty: +8, affection: +9, grudge: -5 },
    defended:  { respect: +12, loyalty: +14, affection: +4, fear: -5, grudge: -8 },
    healed:    { respect: +8, loyalty: +10, affection: +6, fear: -6, grudge: -7 },
    flirted:   { affection: +10, loyalty: +3, respect: +2 },
    dated:     { affection: +16, loyalty: +6, respect: +3 },
    recruited: { loyalty: +18, respect: +8, fear: -4 },
    rescued:   { loyalty: +24, respect: +14, affection: +12, grudge: -20, fear: -10 },
    spared:    { fear: +6, respect: +5, grudge: -3, loyalty: +2 },   // hands-up, let live
    greeted:   { affection: +2, loyalty: +1 },

    intimidated: { fear: +14, respect: +4, grudge: +6, loyalty: -4 },
    robbed:    { fear: +16, grudge: +20, respect: +3, loyalty: -10, affection: -8 },
    pickpocket:{ fear: +4, grudge: +10, loyalty: -3 },
    extorted:  { fear: +22, grudge: +24, respect: +2, loyalty: -12 },
    beaten:    { fear: +24, grudge: +26, respect: +5, loyalty: -16, affection: -14 },
    threatened:{ fear: +12, grudge: +5, loyalty: -4 },
    friendHurt:{ fear: +8, grudge: +16, loyalty: -8, affection: -6 },   // someone they love
    friendKilled:{ fear: +12, grudge: +40, loyalty: -22, affection: -16, respect: +6 },
    snubbed:   { affection: -6, loyalty: -4, grudge: +3 },
    betrayed:  { grudge: +44, loyalty: -40, fear: +10, respect: -6 },   // attacked your own crew
    // word-of-mouth: a friend just dodged the player in the street and warned
    // you off — second-hand fear (plus the grim respect a predator's name buys).
    warned:    { fear: +8, respect: +1 },

    // GANG-FAVOR kinds — earning a faction's trust by running their work,
    // backing them in a fight, clipping a rival, or bringing a cut. Each lands
    // loyalty-first (you're proving you're useful), with respect riding along.
    ranWork:     { loyalty: +10, respect: +8, fear: -2 },
    defendedGang:{ loyalty: +14, respect: +12, affection: +4 },
    killedRival: { respect: +10, loyalty: +6 },
    broughtTribute:{ loyalty: +9, respect: +7 },
  };

  // apply a raw delta map to ONE ped's record (the atomic mutation). Cross-axis
  // coupling lives here: high respect makes fear curdle into respect not panic;
  // fresh grudge eats loyalty. Returns the new signed bond for convenience.
  function applyDelta(ped, d, scale) {
    const r = CBZ.cityRel(ped); if (!r) return 0;
    scale = scale == null ? 1 : scale;
    for (const k of REL_KEYS) if (d[k]) r[k] = clamp100(r[k] + d[k] * scale);
    // coupling
    if (r.grudge > 55) r.loyalty = clamp100(r.loyalty - 0.15 * (r.grudge - 55));
    if (r.respect > 50 && r.fear > r.respect) r.fear = clamp100(r.fear - (r.fear - r.respect) * 0.2);
    r.affection = Math.max(r.affection, ped.affection || 0);  // keep legacy field in sync
    ped.affection = r.affection;
    ped.knowsHero = Math.min(1, Math.max(ped.knowsHero || 0, (r.respect + r.grudge + r.fear) / 240));
    r.seen = 1; r.t = 0;
    return bondOf(ped);
  }

  // PUBLIC: shift a ped's relationship by a named event kind. This is the single
  // entry point every other system (and our own hooks) uses. It also ripples
  // through the LIVING WEB — partner/clique/gang feel a fraction of it — and
  // immediately re-derives the behaviour flags so the change takes effect now.
  CBZ.cityRelShift = function (ped, kind, amt) {
    if (!ped || ped.dead) return 0;
    const d = REL_EVENTS[kind]; if (!d) return 0;
    const bond = applyDelta(ped, d, amt == null ? 1 : amt);
    driveFlags(ped);
    // ripple to the social circle — hurting/helping one is felt by their people.
    if (RIPPLE[kind]) rippleToCircle(ped, kind, (amt == null ? 1 : amt) * RIPPLE[kind]);
    return bond;
  };

  // which events ripple to friends/partner/gang, and how strongly (0..1). Harm
  // ripples hardest (grudges are contagious); kindness spreads softer goodwill.
  const RIPPLE = {
    beaten: 0.45, robbed: 0.4, extorted: 0.45, friendKilled: 0.6, betrayed: 0.7,
    defended: 0.4, healed: 0.3, paid: 0.25, gift: 0.25, rescued: 0.5, recruited: 0.2,
    // favoring ONE gang member lifts nearby same-gang members — building a
    // relationship with the FACTION, not just the individual (rippleToCircle
    // pulls up to 4 same-gang within 30u and remaps the goodwill to them).
    ranWork: 0.5, defendedGang: 0.5, killedRival: 0.4, broughtTribute: 0.4,
  };
  // turn a direct event into the circle's POV (a witnessed harm becomes
  // "friendHurt"/"friendKilled"; a witnessed kindness becomes mild respect).
  function rippleToCircle(ped, kind, w) {
    const harm = REL_EVENTS[kind] && (REL_EVENTS[kind].grudge || 0) > 0;
    const circ = [];
    if (ped.partner && !ped.partner.dead) circ.push(ped.partner);
    if (ped.friends) for (const f of ped.friends) if (f && !f.dead) circ.push(f);
    // gang-mates share loyalty to the gang: a few same-gang peds nearby feel it
    if (ped.gang) {
      let n = 0;
      for (const q of CBZ.cityPeds) {
        if (n >= 4) break;
        if (q === ped || q.dead || q.gang !== ped.gang) continue;
        const dx = q.pos.x - ped.pos.x, dz = q.pos.z - ped.pos.z;
        if (dx * dx + dz * dz < 30 * 30) { circ.push(q); n++; }
      }
    }
    const evt = harm ? "friendHurt" : "spared";   // POV remap (friendHurt for harm, mild goodwill otherwise)
    for (const c of circ) {
      const d = REL_EVENTS[evt]; if (!d) continue;
      applyDelta(c, d, w);
      driveFlags(c);
    }
  }

  // ===========================================================================
  //  CONSEQUENCES — write the relationship back onto the ped's BRAIN inputs so
  //  city/peds.js (which we do NOT touch) acts on how this person feels. This is
  //  the whole point: feelings have teeth.
  //    • respect  → calmer around you, won't snitch, may greet/discount
  //    • loyalty  → recruitable, fights FOR you, ignores your crimes
  //    • fear     → flinches, surrenders, hands over cash, snitches faster
  //    • grudge   → snitches, refuses, and (delayed) AMBUSHES you
  // ===========================================================================
  function driveFlags(ped) {
    if (!ped || ped.dead) return;
    const r = ped.relPlayer; if (!r || !r.seen) return;
    const bond = bondOf(ped);
    // SNITCH nerve: peds.js reads ped.snitch (0..1). Respect/loyalty buys your
    // silence; grudge/fear makes them eager to rat. We nudge toward a target so
    // we never stomp the ped's hardwired baseline, just bend it.
    if (ped._snitch0 == null) ped._snitch0 = ped.snitch != null ? ped.snitch : 0.3;
    let target = ped._snitch0;
    target -= (r.respect + r.loyalty) / 100 * 0.5;     // earns silence
    target += (r.grudge / 100) * 0.6 + (r.fear / 100) * 0.15;
    if (r.loyalty > 60) target = Math.min(target, 0.05);   // your people never rat you
    ped.snitch = Math.max(0, Math.min(1, target));
    // LOYAL peds in your orbit won't flee/panic from you and treat you as kin
    if (r.loyalty > 55 && !ped.gang) { ped.fear = Math.min(ped.fear || 0, 1); }
    // FEAR floor: a frightened person stays jumpy even between shoves
    if (r.fear > 60 && (ped.fear || 0) < 4) ped.fear = 4;
    ped._bond = bond;
  }

  // RECRUITING gate — peds.js/careers read this to decide if someone will join.
  // High loyalty/respect = a willing patch-in; a grudge means "never". Returns
  // 0..1 willingness; the recruit cost/respect check still applies on top.
  CBZ.cityRelWillRecruit = function (ped) {
    if (!ped) return 0.5;
    const r = CBZ.cityRel(ped);
    if (r.grudge > 45) return 0;                       // they hate you — no chance
    let w = 0.35 + (r.loyalty + r.respect) / 200 + (r.affection / 300);
    w += (r.fear / 100) * 0.25;                        // intimidation works a little
    return Math.max(0, Math.min(1, w));
  };

  // SHOP PRICE modifier — a multiplier on buy price (lower = nicer). Vendors who
  // respect/like you cut you a deal; ones who fear you give "scared discounts";
  // a grudge-holding clerk gouges you. shops.js can fold this in if it likes.
  CBZ.cityRelPriceMod = function (ped) {
    if (!ped) return 1;
    const r = CBZ.cityRel(ped);
    let m = 1 - (r.respect + r.loyalty + r.affection) / 100 * 0.08 - (r.fear / 100) * 0.05;
    m += (r.grudge / 100) * 0.12;
    return Math.max(0.7, Math.min(1.25, m));
  };

  // WITNESS / snitch read for other systems: would this ped rat on you right
  // now, given the relationship? (peds.js owns the final call; this is a hint.)
  CBZ.cityRelWouldSnitch = function (ped) {
    if (!ped) return true;
    const r = CBZ.cityRel(ped);
    if (r.loyalty > 50 || r.respect > 60) return false;   // bought silence
    return (r.grudge > 30) || (r.fear > 60);
  };

  // a friendly text read for HUD/interact ("loves you", "wants you dead", …).
  CBZ.cityRelLabel = function (ped) {
    const r = CBZ.cityRel(ped); const b = bondOf(ped);
    if (r.grudge > 60) return "wants you dead";
    // for a gang member, fold the FACTION standing into the read so the player
    // sees they're building trust with the whole crew, not just this one face.
    if (ped && ped.gang && ped.gang !== "player" && CBZ.cityGangStanding) {
      const st = CBZ.cityGangStanding(ped.gang) || 0;
      if (st >= 60) return "crew respects you";
      if (st >= 25) return "in good with the crew";
      if (st <= -25) return "crew wants you gone";
    }
    if (b > 1.0) return "loves you";
    if (b > 0.4) return "likes you";
    if (r.fear > 55) return "terrified of you";
    if (r.respect > 45) return "respects you";
    if (b < -0.3) return "hates you";
    return "neutral";
  };

  // ===========================================================================
  //  AMBIENT SOCIAL LIFE — relationships, families, friend cliques, daily
  //  routines, crowds gathering (a club at night, a queue at a shop),
  //  reactions + gossip spreading, and ambient street events.
  //  Inspired by GTA's scenario points / ped popcycle and social-sim gossip
  //  propagation: cheap, time-sliced, distance-gated so the streets feel alive
  //  without the per-frame cost of a real crowd sim.
  // ===========================================================================

  // pooled speech-bubble sprites: a tiny set of labels reused for everyone so
  // ambient chatter / gossip / reactions cost ~nothing. We hang one on a ped's
  // group, swap its texture (via makeLabelSprite's cache), and retire it.
  const BUBBLES = [];                 // {sprite, ped, t} active bubbles
  const BUBBLE_MAX = 7;               // hard cap on simultaneous bubbles (cheap)
  function say(ped, text, color, secs) {
    if (!ped || ped.dead || !ped.group || !CBZ.makeLabelSprite) return;
    if (BUBBLES.length >= BUBBLE_MAX) return;        // budget hit; skip silently
    // only show near the camera so we don't pay for the whole map
    const P = CBZ.player; if (P && Math.hypot(ped.pos.x - P.pos.x, ped.pos.z - P.pos.z) > 34) return;
    const s = CBZ.makeLabelSprite(text, { color: color || "#dfe7ff" });
    // makeLabelSprite hands back a SHARED, cached material; clone it so our
    // per-bubble fade-out never touches every other sprite using that label.
    if (s.material && s.material._shared) { s.material = s.material.clone(); s.material._shared = false; }
    s.position.y = CBZ.charHeadY ? CBZ.charHeadY(ped) : 1.97; s.scale.set(Math.min(7, 2.6 + text.length * 0.16), 0.8, 1);
    s.userData.transient = true; ped.group.add(s);
    BUBBLES.push({ sprite: s, ped, t: secs || 2.4 });
  }
  function tickBubbles(dt) {
    for (let i = BUBBLES.length - 1; i >= 0; i--) {
      const b = BUBBLES[i]; b.t -= dt;
      if (b.t <= 0 || !b.ped || b.ped.dead || !b.sprite.parent) {
        retireBubble(b); BUBBLES.splice(i, 1);
      } else if (b.t < 0.4) { b.sprite.material.opacity = b.t / 0.4; }   // fade out
    }
  }
  function retireBubble(b) {
    if (!b || !b.sprite) return;
    if (b.sprite.parent) b.sprite.parent.remove(b.sprite);
    const m = b.sprite.material;
    if (m && !m._shared && m.dispose) m.dispose();    // free the per-bubble clone
  }
  // peds.js leans on the same pooled bubbles for its relationship barks (the
  // cross-street mutter, the by-name greeting, the snitch point-out) — same
  // budget, same near-camera gate, so it can never out-spend the pool.
  CBZ.citySay = say;

  // ---- relationship / reputation graph (lazy, lives on each ped) ----
  //   ped.friends[]  — clique members (mutual)
  //   ped.partner    — romantic partner (existing field, preserved)
  //   ped.family[]   — partner + (notional) kin (existing field, preserved)
  //   ped.mood       — -1 angry .. 0 neutral .. +1 happy (decays to 0)
  //   ped.knowsHero  — 0..1 how much this ped has "heard about" the player
  //   ped.opinion    — -1 hates .. +1 loves the player (gossip-driven)

  // ===========================================================================
  //  FAMILIES FOR IMPORTANT PEOPLE — a mob boss, a tycoon, a socialite doesn't
  //  walk the city alone: they have a SPOUSE (and sometimes a kid), and the
  //  family's WEALTH scales with the head. The headline: a mob boss's WIFE is a
  //  walking vault — she carries the $5M Engagement Ring + a necklace + a bracelet
  //  (often a tiara) = several million in ice, plus boss-tier cash. Robbing or
  //  clipping her is a JACKPOT — but she's PROTECTED: harming her enrages the whole
  //  crew (peds.js cityFamilyHarmed). We SPAWN her next to the head, on his turf,
  //  link them as partner/family, and stamp the protection. Bounded by FAMILY_CAP.
  // ===========================================================================
  const WIFE_FIRST = ["Carmela", "Gina", "Rosalind", "Vera", "Sofia", "Lucia", "Bianca",
    "Donatella", "Mona", "Adriana", "Camille", "Renata", "Vivienne", "Tatiana"];
  // a recognizable name+tag so the player can SPOT the target: "Carmela (Boss's wife)".
  function spouseName(head, kind) {
    const first = WIFE_FIRST[(rng() * WIFE_FIRST.length) | 0];
    const lbl = kind === "boss" ? "Boss's wife" : kind === "tycoon" ? "Tycoon's wife" : "Socialite";
    // W12 DYNASTY NAMING: graft the head's own surname onto her first name
    // ("Mrs <Surname>") so the couple reads as one family — only if his
    // ledger name actually carries a surname token to borrow.
    const parts = head && head.name ? String(head.name).trim().split(/\s+/) : [];
    const named = parts.length > 1 ? first + " " + parts[parts.length - 1] : first;
    return named + " (" + lbl + ")";
  }
  // spawn ONE extra ped (spouse/kid) near a head, on the same ground. Returns the
  // ped or null (cap hit / no arena). Fully guarded; uses social.js's own rng so
  // the peds.js deterministic stream stays untouched.
  function spawnFamilyMember(head, opts) {
    if (_familySpawns.length >= FAMILY_CAP) return null;
    const A = CBZ.city && CBZ.city.arena; if (!A || !A.root || !CBZ.cityMakePed) return null;
    // a point a few metres from the head, on their turf
    const ang = rng() * 6.28, rad = 1.8 + rng() * 2.4;
    const x = head.pos.x + Math.cos(ang) * rad, z = head.pos.z + Math.sin(ang) * rad;
    let ped = null;
    try { ped = CBZ.cityMakePed(x, z, rng, opts); } catch (e) { return null; }
    if (!ped) return null;
    // base personality/relationship fields (these spawn AFTER citySocialInit's
    // civ loop, so set them here so the social sim treats them like everyone else).
    ped.mood = 0; ped.knowsHero = 0; ped.opinion = 0; ped.relPlayer = null; ped._snitch0 = null;
    A.root.add(ped.group);
    CBZ.cityPeds.push(ped);
    _familySpawns.push(ped);
    return ped;
  }
  // give EACH gang boss + each tycoon/billionaire/socialite (without a partner) a
  // real family. Co-located, wealth scaled to the head, protected for bosses.
  function weaveFamilies() {
    if (!CBZ.cityMakePed) return;     // need the spawn primitive
    const peds = CBZ.cityPeds.slice();   // snapshot — we push spouses as we go
    for (const head of peds) {
      if (_familySpawns.length >= FAMILY_CAP) break;
      if (!head || head.dead || head.vendor || head.controlled) continue;
      if (head.partner) continue;        // already coupled — leave them
      const isBoss = !!(head.isBoss || head.rank === "boss");
      const a = ("" + (head.archetype || "")).toLowerCase();
      const isRich = (a === "tycoon" || a === "billionaire" || a === "socialite");
      if (!isBoss && !isRich) continue;
      // the spouse's WEALTH PROFILE is keyed to the head: a boss → a mob WIFE
      // (guaranteed $5M ring + necklace + bracelet + maybe tiara); a tycoon →
      // a tycoon's wife (usually the ring); a socialite head → a socialite spouse.
      const wifeArch = isBoss ? "mobwife" : (a === "tycoon" || a === "billionaire") ? "tycoonwife" : "socialite";
      const headKind = isBoss ? "boss" : (a === "tycoon" || a === "billionaire") ? "tycoon" : "socialite";
      const spouse = spawnFamilyMember(head, {
        kind: "civilian",
        archetype: wifeArch,
        // the wife archetypes above are always cast female by peds.js's
        // FEMALE_ARCH table anyway — stamped explicitly here too so the
        // couple reads as opposite-gender even if the head is a rare female
        // boss/tycoon (head.gender "f" → a husband, not another wife).
        gender: head.gender === "f" ? "m" : "f",
        wealth: Math.min(0.99, Math.max(0.9, head.wealth || 0.9)),
        aggr: 0.18 + rng() * 0.14,        // non-combatant — she flees, never fights her own crew
        armed: false,
        name: spouseName(head, headKind),
        // NOT a gang member: a wife has no .gang (so she won't war on her own crew),
        // but she IS protected by the head's gang via these stamps (peds.js reads them).
        protectGang: isBoss ? head.gang : null,
        protectedBy: head,
        isFamily: true,
      });
      if (!spouse) continue;
      // LINK them as a real couple/family so the partner-follow + groupReact logic
      // (peds.js) makes them move/react as a UNIT, not random strangers.
      head.partner = spouse; spouse.partner = head;
      head.family = head.family || []; if (head.family.indexOf(spouse) < 0) head.family.push(spouse);
      spouse.family = [head];
      head.together = spouse.together = 0.85 + rng() * 0.15;   // a tight, committed pair
      // bosses/tycoons/socialites are always ledger-worthy (isFamily, see
      // schedule.js worth()) — unlike the street-couple budget gate above,
      // ALWAYS record the marriage in the persistent family tree.
      if (CBZ.cityFamilyTree) CBZ.cityFamilyTree.marry(head, spouse);
      // W8: move the spouse INTO the head's own leased unit (or lease one for
      // the head first if he doesn't have one yet) — a couple shares one
      // address, one rent bill, not two strangers' leases. Guarded: housing.js
      // may be disabled/absent, same as every other optional layer here.
      if (CBZ.cityHouseholdJoin) CBZ.cityHouseholdJoin(spouse, head);
      // a BOSS sometimes also has a kid at his side (one more protected mouth). Kept
      // rare + capped so we don't bloat the crowd. Modest wealth (a kid, not a vault).
      if (isBoss && rng() < 0.4 && _familySpawns.length < FAMILY_CAP) {
        const kid = spawnFamilyMember(head, {
          kind: "civilian", archetype: "resident", wealth: 0.5,
          gender: rng() < 0.5 ? "f" : "m",   // 50/50, off this module's own seeded rng
          aggr: 0.12 + rng() * 0.1, armed: false,
          name: "Young " + (head.name || "one").split(" ")[0],
          protectGang: head.gang, protectedBy: head, isFamily: true,
        });
        if (kid) {
          kid.family = [head, spouse];
          head.family.push(kid); spouse.family.push(kid);
          if (CBZ.cityFamilyTree) CBZ.cityFamilyTree.bearChild(head, spouse, kid);
          // W8: the kid joins the same household unit as the head (falls back
          // to the spouse's seat if the head's is somehow full/gone).
          if (CBZ.cityHouseholdJoin) CBZ.cityHouseholdJoin(kid, head) || CBZ.cityHouseholdJoin(kid, spouse);
        }
      }
    }
  }

  // ---- setup: weave civilians into couples, families, and friend cliques ----
  CBZ.citySocialInit = function () {
    g.cityPartner = null; g.citySpouse = false; g.cityHostage = null;
    clearBeacon(); kidnapCD = 12;
    BUBBLES.length = 0; clubT = 0; queueT = 0; gossipT = 2; eventT = 6; routineT = 1.5;
    // fresh run: the prior spawn's family bodies were already disposed by
    // clearCityPeds (they live in CBZ.cityPeds); just drop our stale refs.
    _familySpawns.length = 0;
    const civ = CBZ.cityPeds.filter((p) => p.kind === "civilian" && !p.vendor && !p.gang);
    // shuffle-ish pairing into couples (45%)
    for (let i = 0; i + 1 < civ.length; i += 2) {
      const a = civ[i];
      if (a.partner) continue;   // already claimed by an earlier scan-ahead below
      if (rng() < 0.45) {
        // prefer an OPPOSITE-GENDER partner: scan a short deterministic window
        // ahead (this module's seeded rng) before falling back to the plain
        // next-slot pairing — O(n), and we don't force it: a same-gender
        // couple is fine when the scan misses.
        let bi = i + 1;
        for (let s = i + 1; s < Math.min(civ.length, i + 6); s++) {
          if (!civ[s].partner && civ[s].gender !== a.gender) { bi = s; break; }
        }
        const b = civ[bi];
        if (b.partner) continue;   // the fallback slot got claimed by a scan-ahead pick
        a.partner = b; b.partner = a;
        a.family = [b]; b.family = [a];
        a.together = b.together = 0.5 + rng() * 0.5;   // relationship strength
        // BUDGET GATE: force-minting a family-tree sid for every street couple
        // would mint ~150 sids nobody ever meets. Only record the couple in
        // the persistent tree when a side is already ledger-worthy (gang/
        // vendor/known) — an inline approximation of schedule.js's worth()
        // (kept local to avoid a load-order dependency on schedule.js).
        if (CBZ.cityFamilyTree && (a.gang || a.vendor || a.nameKnown || b.gang || b.vendor || b.nameKnown)) {
          CBZ.cityFamilyTree.marry(a, b);
        }
        // W8: move in together — every matched couple shares one leased unit
        // (not just the ledger-worthy subset above; the family tree entry is
        // gated for budget reasons, housing isn't). Guarded: housing.js may be
        // disabled/absent.
        if (CBZ.cityHouseholdJoin) CBZ.cityHouseholdJoin(b, a);
      }
    }
    // friend cliques: small groups (3-5) of nearby civilians who hang together,
    // share gossip fastest, and react when one of their own gets hurt.
    let g0 = 0;
    while (g0 < civ.length) {
      const size = 3 + ((rng() * 3) | 0);
      const clique = [];
      for (let k = 0; k < size && g0 < civ.length; k++, g0++) clique.push(civ[g0]);
      if (clique.length >= 2 && rng() < 0.7) {
        const cid = "clq" + g0;
        for (const p of clique) {
          p.friends = clique.filter((q) => q !== p);
          p.cliqueId = cid;
        }
      }
    }
    // base personality fields
    for (const p of civ) { p.mood = 0; p.knowsHero = 0; p.opinion = 0; }
    // clear any stale relationship records from a previous life + wrap the
    // action APIs so every meaningful deed feeds the relationship axes.
    for (const p of CBZ.cityPeds) { p.relPlayer = null; p._snitch0 = null; p._refuseUntil = 0; p.nameKnown = false; }
    relTickT = 1; relTickCur = 0; partsCD = 0;
    wrapActionHooks();
    // AFTER the civilian couples/cliques: give the IMPORTANT people (bosses,
    // tycoons, socialites) a real, wealthy, co-located family (spouse + maybe kid).
    weaveFamilies();
  };

  CBZ.cityIsRomance = function (ped) {
    if (!(ped && !ped.dead && ped.kind === "civilian" && !ped.vendor && !ped.gang && ped !== g.cityPartner && !ped.partner)) return false;
    // someone holding a real grudge won't be charmed — feelings gate romance.
    const r = ped.relPlayer; if (r && r.grudge > 40) return false;
    return true;
  };

  // ---- dating ----
  // Reactions are deeper now: your reputation (respect) and how RICH you look
  // sway someone, a jealous existing partner of theirs may step in, and a happy
  // date makes them love you faster. Affection bands give flirty banter.
  const FLIRT_LINES = ["“You're funny 😊”", "“I like you.”", "“Buy me dinner first 😏”",
    "“…maybe.”", "“Tell me more 💬”", "“You're sweet.”"];
  CBZ.cityFlirt = function (ped) {
    if (!ped || ped.dead) return;
    if (ped === g.cityPartner) { CBZ.city.note("“I love you too 💕”", 1.8); say(ped, "♥", "#ff8bd0", 1.6); ped.mood = 1; return; }
    // someone who already has a partner can be flirted with, but it stings them
    if (ped.partner && !ped.dead) {
      const jealous = ped.partner;
      if (!jealous.dead && Math.hypot(jealous.pos.x - ped.pos.x, jealous.pos.z - ped.pos.z) < 8) {
        say(jealous, "“HEY! Back off!”", "#ff7b6b", 2.2);
        jealous.mood = -1; jealous.alarmed = Math.max(jealous.alarmed || 0, 4);
        CBZ.city.note(ped.name + " is taken — " + jealous.name + " is not happy.", 2);
        return;
      }
    }
    if (!CBZ.cityIsRomance(ped)) { CBZ.city.note(ped.name + " isn't interested.", 1.6); say(ped, "“No thanks.”", "#cfd6e6", 1.6); return; }
    const cost = S().dateCost || 50;
    if (!CBZ.city.canAfford(cost)) { CBZ.city.note("A date costs $" + cost + " — you're broke.", 1.8); say(ped, "“You're broke? 🙄”", "#cfd6e6", 1.8); return; }
    CBZ.city.spend(cost);
    // charm = base + temperament fit + your street rep + how loaded you look
    const repBonus = Math.min(0.6, (g.respect || 0) / 300);
    const richBonus = Math.min(0.5, (g.cash || 0) / 40000);
    const gain = (S().affectionPerDate || 22) * (0.7 + (1 - Math.abs(ped.aggr - 0.3)) * 0.5 + repBonus + richBonus);
    ped.affection = (ped.affection || 0) + gain;
    ped.nameKnown = true;                     // a date is a conversation — you have their name now
    ped.mood = 1; ped.knowsHero = Math.min(1, (ped.knowsHero || 0) + 0.3); ped.opinion = Math.min(1, (ped.opinion || 0) + 0.25);
    // a successful date deepens the multi-axis bond, scaled by how well it went
    CBZ.cityRelShift(ped, "dated", 0.6 + gain / 30);
    if (CBZ.sfx) CBZ.sfx("coin");
    say(ped, FLIRT_LINES[(rng() * FLIRT_LINES.length) | 0], "#ff8bd0", 2);
    if (ped.affection >= (S().partnerAt || 60)) {
      g.cityPartner = ped; ped.companion = true; ped.controlled = true; ped.romance = true; ped.together = 1;
      CBZ.cityRelShift(ped, "dated", 2);   // committing locks in deep loyalty+affection
      CBZ.city.big("💕 " + ped.name + " is now your partner!");
      CBZ.city.addRespect(2);
      // word gets out — their friends now know (and like) you a little
      gossipFrom(ped, "datedHero", 0.5);
    } else {
      CBZ.city.note("You take " + ped.name + " out. (♥ " + Math.round(ped.affection) + "/" + (S().partnerAt || 60) + ")", 2);
    }
  };

  CBZ.cityPropose = function (ped) {
    ped = ped || g.cityPartner;
    if (!ped || ped !== g.cityPartner) { CBZ.city.note("You need a partner first.", 1.6); return; }
    const econ = CBZ.cityEcon, ring = (S().marryRing || "Diamond Ring");
    if (g.citySpouse) { CBZ.city.note("You're already married 💍", 1.6); return; }
    if (!econ.has(ring)) { CBZ.city.note("You need a " + ring + " to propose.", 2); return; }
    econ.take(ring, 1); g.citySpouse = true;
    // W7 minimal persistent hook: force-mint a sid so this marriage can be
    // found later (spouseOf/heirOf) even if the spouse despawns. NOTE:
    // cityPedStash (schedule.js) skips companion/controlled peds, and the
    // partner is BOTH by the time they're proposed to — so this only sticks
    // if a sid was already minted earlier (e.g. via worth()'s nameKnown gate
    // before commitment). Full player-in-tree wiring (a real player sid +
    // a marry() edge) is a later step; this just remembers the sid if we
    // have one.
    if (CBZ.cityPedStash) CBZ.cityPedStash(ped);
    g.citySpouseSid = ped._sid || null;
    CBZ.cityRelShift(ped, "gift", 4);     // a ring is the ultimate gift → max affection/loyalty
    CBZ.city.big("💍 You married " + ped.name + "!");
    CBZ.city.addRespect(10);
  };

  // ---- gang favors: earn a FACTION's trust ----
  // A gang member is "approachable for a favor" when they're a non-player gang
  // member, alive, and don't hold a real grudge against you. Befriending one
  // (running their work) ripples to nearby same-gang members and raises your
  // standing with the whole faction — the relationship-building primitive.
  CBZ.cityCanBefriend = function (ped) {
    if (!ped || ped.dead) return false;
    if (!ped.gang || ped.gang === "player") return false;
    const r = CBZ.cityRel(ped);
    return ((r && r.grudge) || 0) < 55;
  };

  // do a favor for a gang member: a small cash gesture buys goodwill that scales
  // with how much they already respect you (a respected face earns more per
  // favor). Lands a 'ranWork' shift on the ped (which ripples to their nearby
  // crew), nudges your faction STANDING up, and seeds a 'gangFavor' rumor so
  // your name spreads through their clique. Returns the new signed bond.
  const FAVOR_LINES = ["“You came through. 🤝”", "“Aight, you're solid.”",
    "“We see you out here.”", "“That's what I'm talking about.”", "“Respect.”"];
  CBZ.cityDoFavor = function (ped) {
    if (g.mode !== "city") return 0;
    if (!CBZ.cityCanBefriend(ped)) {
      if (CBZ.city) CBZ.city.note((ped && ped.name || "They") + " won't take a favor from you.", 1.6);
      if (ped) say(ped, "“Get out of here.”", "#ff9b8b", 1.6);
      return 0;
    }
    const r = CBZ.cityRel(ped);
    // optional small cash/item cost (a token gesture); skip if broke but still
    // let the favor happen smaller — the deed is what matters, not the spend.
    const cost = S().favorCost || 25;
    if (CBZ.city.canAfford(cost)) { CBZ.city.spend(cost); if (CBZ.sfx) CBZ.sfx("coin"); }
    // gain scales with existing respect (modeled on cityFlirt's repBonus)
    const repBonus = Math.min(0.6, r.respect / 300);
    const gain = 0.7 + repBonus;
    const bond = CBZ.cityRelShift(ped, "ranWork", gain);
    ped.nameKnown = true;                     // running work together — you know each other now
    ped.knowsHero = Math.min(1, (ped.knowsHero || 0) + 0.25);
    ped.opinion = Math.min(1, (ped.opinion || 0) + 0.2);
    ped.mood = Math.max(ped.mood || 0, 0.6);
    // raise faction standing — a fraction of the per-ped gain (owned by gangs.js)
    if (CBZ.cityGangAddStanding) CBZ.cityGangAddStanding(ped.gang, gain * 6);
    // your name spreads through the gang's clique via the 3-hop gossip web
    if (ped.pos) CBZ.cityGossip(ped.pos.x, ped.pos.z, "gangFavor", 0.5);
    say(ped, FAVOR_LINES[(rng() * FAVOR_LINES.length) | 0], "#7ed957", 2);
    if (CBZ.city) {
      const lbl = CBZ.cityRelLabel ? CBZ.cityRelLabel(ped) : "";
      CBZ.city.note("You did " + (ped.name || "them") + " a favor." + (lbl ? " (" + lbl + ")" : ""), 2);
    }
    return bond;
  };

  // ---- hostage: grab a ped at gunpoint as a shield / for ransom ----
  CBZ.cityTakeHostage = function (ped) {
    if (!ped || ped.dead || ped === g.cityPartner) return;
    const armed = !!(CBZ.cityHasGun && CBZ.cityHasGun());
    if (!armed) { CBZ.city.note("Need a gun to take a hostage.", 1.6); return; }
    if (g.cityHostage) { CBZ.city.note("You already have a hostage.", 1.4); return; }
    g.cityHostage = ped; ped.controlled = true; ped.hostage = true; ped.fear = 10; ped.rage = null;
    CBZ.cityRelShift(ped, "intimidated", 1.5);   // grabbed at gunpoint → terror + grudge
    CBZ.city.big("HOSTAGE TAKEN");
    CBZ.cityCrime && CBZ.cityCrime(40, { x: ped.pos.x, z: ped.pos.z, type: "kidnapping" });
  };
  CBZ.cityReleaseHostage = function (ransom) {
    const ped = g.cityHostage; if (!ped) return;
    ped.controlled = false; ped.hostage = false; ped.alarmed = 8; ped.fear = 10;
    g.cityHostage = null;
    if (ransom) {
      const pay = 200 + ((ped.wealth || 0.3) * 800) | 0;
      CBZ.city.addCash(pay); CBZ.city.big("RANSOM PAID + $" + pay);
      CBZ.cityRelShift(ped, "extorted", 1.5);          // bled for cash → lasting hatred
      CBZ.cityCrime && CBZ.cityCrime(30, { type: "extortion" });
    } else {
      // letting them walk unharmed earns a sliver of respect back (you spared them)
      CBZ.cityRelShift(ped, "spared", 1);
      CBZ.city.note("You let " + ped.name + " go.", 1.6);
      if (CBZ.city.addHeat) CBZ.city.addHeat(-30);     // letting them go cools things slightly
    }
    if (ped.pos) CBZ.cityAlarm && CBZ.cityAlarm(ped.pos.x, ped.pos.z, 14, 1);
  };

  // ---- when a controlled/partner ped dies, clean up + react ----
  //   Loved ones grieve / rage and the block turns on you (gossip), so killing
  //   in the street has a real social cost — GTA crowd reactions, but persistent.
  CBZ.citySocialDeath = function (ped, byPlayer) {
    if (!ped) return;
    // record the death in the persistent family tree (if this identity was
    // ever minted a sid there); W9 revisits SEVERING the tree's links for
    // inheritance — this step only records the fact of death.
    if (ped._sid && CBZ.cityFamilyTree) CBZ.cityFamilyTree.markDeath(ped._sid);
    // The legacy caller passes only (ped); without an explicit flag, infer the
    // player's involvement from proximity so an NPC gang war across town doesn't
    // wrongly turn the whole map against you. An explicit flag always wins.
    if (byPlayer == null) {
      const P = CBZ.player;
      byPlayer = !!(P && !P.dead && ped.pos && Math.hypot(ped.pos.x - P.pos.x, ped.pos.z - P.pos.z) < 26 && ((g.wanted | 0) >= 1 || (CBZ.cityHasGun && CBZ.cityHasGun())));
    }
    // anyone bonded to the victim reacts; the player gets the "killer" rumor
    if (CBZ.citySocialWitnessKill) CBZ.citySocialWitnessKill(ped, byPlayer);
    if (ped === g.cityPartner) {
      g.cityPartner = null; g.citySpouse = false; clearBeacon();
      CBZ.city && CBZ.city.big("💔 Your partner was killed");
    }
    if (ped === g.cityHostage) { g.cityHostage = null; }
    // sever LIVE refs so survivors don't reference a corpse (a live ped.partner
    // must never point at a dead rig — move(), flirt, etc. all deref it) — but
    // the family TREE above already kept the marriage on record (endMarriage
    // stamped end/why:"death" via markDeath), so this is cosmetic bookkeeping
    // on the live object graph only, not a loss of kinship (W9: heirOf/spouseOf
    // still resolve the dead spouse's edges for inheritance/grudges later).
    if (ped.partner) {
      ped.partner._widowed = true;                 // grief flag: still "was married", just alone now
      ped.partner.partner = null;
      if (ped.partner.family) ped.partner.family = ped.partner.family.filter((x) => x !== ped);
    }
    if (ped.friends) for (const f of ped.friends) if (f && f.friends) f.friends = f.friends.filter((x) => x !== ped);
  };

  CBZ.citySocialReset = function () {
    g.cityPartner = null; g.citySpouse = false; g.cityHostage = null;
    clearBeacon(); kidnapCD = 12;
    // retire any live speech bubbles + pending rumors
    for (const b of BUBBLES) retireBubble(b);
    BUBBLES.length = 0; RUMORS.length = 0;
    // drop refs to spawned family bodies — they're disposed with the rest of the
    // population by the clearCityPeds that follows on a fresh spawn.
    _familySpawns.length = 0;
    gossipT = 2; eventT = 6; routineT = 1.5; clubT = 0; queueT = 0;
    // wipe relationship records + restore each ped's hardwired snitch baseline
    for (const p of (CBZ.cityPeds || [])) {
      p.relPlayer = null;
      if (p._snitch0 != null) { p.snitch = p._snitch0; p._snitch0 = null; }
      p._bond = 0; p._refuseUntil = 0; p.nameKnown = false;
    }
    relTickT = 1; relTickCur = 0; partsCD = 0;
  };

  function clearBeacon() { if (beacon) { if (beacon.parent) beacon.parent.remove(beacon); if (beacon.geometry) beacon.geometry.dispose(); if (beacon.material) beacon.material.dispose(); beacon = null; } }
  function makeBeacon(x, z, color) {
    clearBeacon();
    if (!CBZ.city || !CBZ.city.arena) return;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 30, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: color || 0xff6bd0, transparent: true, opacity: 0.34, side: THREE.DoubleSide, depthWrite: false }));
    m.position.set(x, 15, z); m.userData.transient = true;
    CBZ.city.arena.root.add(m); beacon = m;
  }

  // ===========================================================================
  //  GOSSIP + REACTIONS — when something notable happens, word spreads through
  //  the social graph. A salience model (social-sim style): a ped's friends and
  //  partner hear first and strongest; strangers in earshot pick it up weaker.
  //  Topics shift OPINION of the player and MOOD of the ped, which feeds back
  //  into flirting, witness behaviour, and ambient banter.
  // ===========================================================================
  let gossipT = 2;
  const RUMORS = [];      // queued rumors: {ped, topic, weight, hops}
  const TOPIC = {
    datedHero:  { op: +0.30, mood: +0.4, say: ["“Did you hear about us? 😏”", "“They're seeing someone new.”"] },
    heroRich:   { op: +0.15, mood: +0.2, say: ["“That one's LOADED.”", "“New money walking around 💰”"] },
    heroKilled: { op: -0.55, mood: -0.8, say: ["“Someone got shot!”", "“They KILLED them!”", "“Stay away from that one.”"] },
    heroHero:   { op: +0.40, mood: +0.5, say: ["“They saved somebody.”", "“A real one out here.”"] },
    breakup:    { op: 0,     mood: -0.5, say: ["“They broke up 💔”", "“It's over between them.”"] },
    proposal:   { op: 0,     mood: +0.6, say: ["“They got engaged! 💍”", "“Did you see the ring?!”"] },
    sale:       { op: +0.05, mood: +0.2, say: ["“Big sale at the shop.”", "“Whole block's busy today.”"] },
    // a favor done for the crew — spreads your name (and goodwill) through the
    // gang's clique via the same 3-hop gossip the other topics ride.
    gangFavor:  { op: +0.35, mood: +0.4, say: ["“That one's putting in work.”", "“They're with us now.”", "“Solid people. 🤝”"] },
  };

  // seed a rumor at one ped; it will propagate to their friends/partner over time.
  function gossipFrom(ped, topic, weight) {
    if (!ped || !TOPIC[topic]) return;
    RUMORS.push({ ped, topic, weight: weight == null ? 0.6 : weight, hops: 0 });
    applyRumor(ped, topic, weight == null ? 0.6 : weight);
  }
  function applyRumor(ped, topic, w) {
    const T = TOPIC[topic]; if (!T) return;
    ped.knowsHero = Math.min(1, (ped.knowsHero || 0) + Math.abs(T.op) * w * 0.8);
    ped.opinion = Math.max(-1, Math.min(1, (ped.opinion || 0) + T.op * w));
    ped.mood = Math.max(-1, Math.min(1, (ped.mood || 0) + T.mood * w));
    ped._lastRumor = topic;
  }
  // PUBLIC: any module can broadcast a notable thing near a point; nearby peds
  // become the "source" of a rumor that then ripples through their cliques.
  CBZ.cityGossip = function (x, z, topic, weight) {
    if (!TOPIC[topic]) return;
    let seeds = 0;
    for (const p of CBZ.cityPeds) {
      if (p.dead || p.vendor || p.controlled) continue;
      const dx = p.pos.x - x, dz = p.pos.z - z;
      if (dx * dx + dz * dz < 26 * 26 && rng() < 0.6) { gossipFrom(p, topic, weight); if (++seeds >= 5) break; }
    }
    return seeds;
  };

  function tickGossip(dt) {
    gossipT -= dt; if (gossipT > 0) return;
    gossipT = 0.5;                                   // process the rumor queue ~2x/s
    let budget = 6;                                  // bounded work per tick
    for (let i = RUMORS.length - 1; i >= 0 && budget > 0; i--) {
      const r = RUMORS[i];
      if (!r.ped || r.ped.dead || r.hops >= 3) { RUMORS.splice(i, 1); continue; }
      r.hops++;
      const decay = r.weight * 0.6;
      // spread to partner + friends (strongest), then a random nearby stranger
      const targets = [];
      if (r.ped.partner && !r.ped.partner.dead) targets.push(r.ped.partner);
      if (r.ped.friends) for (const f of r.ped.friends) if (f && !f.dead) targets.push(f);
      for (const t of targets) {
        if (budget-- <= 0) break;
        if ((t._lastRumor === r.topic)) continue;     // already heard this one
        applyRumor(t, r.topic, decay);
        if (decay > 0.25) RUMORS.push({ ped: t, topic: r.topic, weight: decay, hops: r.hops });
        // visible chatter if on screen
        const T = TOPIC[r.topic];
        if (T.say && rng() < 0.5) say(t, T.say[(rng() * T.say.length) | 0], T.op < 0 ? "#ff9b8b" : "#bfe0ff", 2.4);
      }
      RUMORS.splice(i, 1);                            // consumed
    }
    if (RUMORS.length > 40) RUMORS.length = 40;       // safety cap
  }

  // REACTIONS: when a controlled/partner ped or a witnessed civilian dies, their
  // loved ones react — grief, anger, and a fast-spreading "they killed someone"
  // rumor that turns the block against the player. Hooked from citySocialDeath
  // and also pollable when any civilian dies.
  CBZ.citySocialWitnessKill = function (victim, byPlayer) {
    if (!victim) return;
    const mourners = [];
    if (victim.partner && !victim.partner.dead) mourners.push(victim.partner);
    if (victim.friends) for (const f of victim.friends) if (f && !f.dead) mourners.push(f);
    for (const m of mourners) {
      m.mood = -1;
      if (byPlayer) {
        m.opinion = Math.max(-1, (m.opinion || 0) - 0.9);
        m.knowsHero = 1;
        // you killed someone they love — a deep, durable grudge is born here,
        // and it will SEEK its revenge later (the ambush director below).
        CBZ.cityRelShift(m, "friendKilled", 1);
        const r = CBZ.cityRel(m);
        // grief turns to either rage (bold) or flight (meek); a big grudge will
        // also keep them hunting you long after they've calmed from this moment.
        if ((m.aggr || 0.3) > 0.55 && !m.gang) { m.rage = CBZ.city.playerActor; m.state = "confront"; r.ambushT = 0; say(m, "“YOU KILLED THEM!”", "#ff6b6b", 2.6); }
        else { m.fear = 10; m.alarmed = Math.max(m.alarmed || 0, 6); r.ambushT = 25 + rng() * 30; say(m, "💔", "#9bb0ff", 2.6); }
      } else {
        m.fear = Math.max(m.fear || 0, 6); say(m, "💔", "#9bb0ff", 2.2);
      }
    }
    if (byPlayer && victim.pos) CBZ.cityGossip(victim.pos.x, victim.pos.z, "heroKilled", 0.8);
  };

  // ===========================================================================
  //  THE STREET REMEMBERS — the relationship web made VISIBLE on the pavement.
  //   • cityStreetParts: when a marked ped dodges the player (peds.js calls this
  //     on the cross-street break), the people around them catch the warning —
  //     a small second-hand fear bump through the web, and ONE visibly steers
  //     their partner/friend off the same way. The street parts around a known
  //     predator; infamy you can SEE. Event-driven, globally rate-gated (no
  //     per-frame scan; it piggybacks peds.js's existing reaction pass).
  //   • vendor memory: a clerk you've stuck up refuses you service for a long
  //     window (shops.js asks cityVendorRefuses at the door — see hooksNeeded).
  //   • cityMeet: you learn an NPC's NAME only by talking to them.
  // ===========================================================================
  let partsCD = 0, _clock = 0;
  CBZ.cityStreetParts = function (ped) {
    if (!ped || ped.dead || partsCD > 0) return;
    partsCD = 4.5;                                   // one visible street-part show per ~5s
    let shown = false, n = 0;
    for (const q of CBZ.cityPeds) {
      if (n >= 4) break;                             // bounded: a couple of bystanders, not the block
      if (q === ped || q.dead || q.vendor || q.gang || q.controlled || q.companion || q.recruited) continue;
      if (q.state === "flee" || q.state === "fight" || q.rage || q.surrender) continue;
      const dx = q.pos.x - ped.pos.x, dz = q.pos.z - ped.pos.z;
      if (dx * dx + dz * dz > 12 * 12) continue;
      n++;
      applyDelta(q, REL_EVENTS.warned, 0.7); driveFlags(q);   // the warning lands as feeling
      // one of them grabs their partner's arm and steers off with the dodger
      if (!shown && rng() < 0.75) {
        shown = true;
        q.path = null; q.pause = 3; q._notedT = 6; q.state = "walk";
        q.target.set(ped.target.x + (rng() - 0.5) * 2.5, 0, ped.target.z + (rng() - 0.5) * 2.5);
        say(q, ["“Don't look. Walk.”", "“Come on. Other side.”", "“Eyes down — keep moving.”"][(rng() * 3) | 0], "#cfd6e6", 2.2);
        const arm = (q.partner && !q.partner.dead && q.partner !== ped) ? q.partner
          : (q.friends || []).find((f) => f && !f.dead && f !== ped && !f.controlled && !f.companion
              && Math.hypot(f.pos.x - q.pos.x, f.pos.z - q.pos.z) < 5);
        if (arm && !arm.controlled && !arm.companion && !arm.gang && arm.state !== "fight") {
          arm.path = null; arm.pause = 3; arm._notedT = 6; arm.state = "walk";
          arm.target.set(q.target.x + 0.9, 0, q.target.z + 0.9);
        }
      }
    }
  };

  // ---- SHOPKEEPER MEMORY: "We're closed. To YOU." -------------------------
  // A vendor you've robbed refuses you service for a long window. shops.js
  // gates its open() on cityVendorRefuses (one-line hook); we stamp the window
  // from BOTH robbery paths: cityRobPed on the clerk (wrap below) and the till
  // stick-up (robTill is a shops.js local, so we watch the one public signal it
  // always sends — cityCrime type "store robbery" at the till's coordinates).
  const REFUSE_SECS = 420;                           // most of an in-game day
  function markVendorRobbed(v) {
    if (!v || v.dead) return;
    v._refuseUntil = _clock + REFUSE_SECS;
    try { applyDelta(v, REL_EVENTS.robbed, 1); driveFlags(v); } catch (e) {}
    say(v, "“Get OUT. And don't come back.”", "#ff9b8b", 2.4);
  }
  CBZ.cityVendorRefuses = function (ped) {
    return !!(ped && !ped.dead && (ped._refuseUntil || 0) > _clock);
  };

  // ---- you learn THEIR name only by talking. interact.js calls this from its
  // Talk verb (see hooksNeeded); flirting with / doing a favor for someone
  // counts as talking too (wired in cityFlirt/cityDoFavor).
  CBZ.cityMeet = function (ped) {
    if (!ped || ped.dead) return;
    if (!ped.nameKnown) {
      ped.nameKnown = true;
      if (CBZ.city && ped.name) CBZ.city.note("They go by " + ped.name + ".", 1.6);
    }
    CBZ.cityRelShift(ped, "greeted", 0.5);
  };

  // ===========================================================================
  //  DAILY ROUTINES + CROWDS GATHERING — GTA "scenario point" style. We do NOT
  //  spawn extra peds; we gently PULL existing ambient civilians toward a venue
  //  that fits the hour (a club queue + dancefloor at night, a busy shop by day)
  //  so the streets cluster believably instead of wandering uniformly.
  // ===========================================================================
  let clubT = 0, queueT = 0, routineT = 1.5, _decayCur = 0;
  function lotsOfKind(kind) {
    const A = CBZ.city && CBZ.city.arena;
    if (!A || !A.shopLots) return [];
    return A.shopLots.filter((l) => l.kind === kind || (l.building && l.building.kind === kind));
  }
  function gatherAt(lot, radius, want, line) {
    if (!lot) return;
    const cx = lot.cx, cz = lot.cz;
    // count who's already there; pull a few stragglers in from nearby sidewalk
    let here = 0, pulled = 0;
    for (const p of CBZ.cityPeds) {
      if (p.dead || p.vendor || p.gang || p.controlled || p.companion || p.recruited) continue;
      if (p.state === "flee" || p.state === "fight" || p.rage) continue;
      const dx = p.pos.x - cx, dz = p.pos.z - cz, d2 = dx * dx + dz * dz;
      if (d2 < radius * radius) {
        here++;
        // mill around the venue rather than stand frozen
        if (!p._venue && p.pause <= 0 && rng() < 0.4) {
          p.target.set(cx + (rng() - 0.5) * radius, 0, cz + (rng() - 0.5) * radius);
          p._venue = 8 + rng() * 8;
        }
      } else if (here + pulled < want && d2 < (radius * 4.5) * (radius * 4.5) && !p._venue && rng() < 0.25) {
        // drift this nearby ped toward the venue (queue along the approach)
        p.target.set(cx + (rng() - 0.5) * radius * 1.3, 0, cz + (rng() - 0.5) * radius * 1.3);
        p.path = null; p._venue = 10 + rng() * 10; pulled++;
        if (line && rng() < 0.15) say(p, line, "#bfe0ff", 2.2);
      }
    }
  }
  function tickRoutines(dt) {
    routineT -= dt; if (routineT > 0) return;
    routineT = 1.2;                                  // run the director ~1x/s
    const hour = CBZ.cityHour ? CBZ.cityHour() : 12;
    const P = CBZ.player;
    // decay per-ped venue timer + mood/opinion so feelings cool over time.
    // Time-sliced: only a window of the array each call (cheap on big crowds).
    const peds = CBZ.cityPeds, n = peds.length;
    _decayCur = _decayCur % Math.max(1, n);
    const end = Math.min(n, _decayCur + 64);
    for (let i = _decayCur; i < end; i++) {
      const p = peds[i]; if (!p || p.dead) continue;
      if (p._venue) { p._venue -= routineT * 4; if (p._venue <= 0) p._venue = 0; }
      if (p.mood) p.mood *= 0.96;
      if (p.opinion) p.opinion *= 0.995;     // opinions fade slowly
      if (p._lastRumor && rng() < 0.05) p._lastRumor = null;  // can re-hear later
    }
    _decayCur = end >= n ? 0 : end;
    // NIGHTLIFE: a club (the bar lot) draws a crowd 20:00–04:00
    if (hour >= 20 || hour < 4) {
      const bars = lotsOfKind("bar");
      for (const lot of bars) {
        // only animate the venue the player can actually see (cheap LOD)
        if (P && Math.hypot(lot.cx - P.pos.x, lot.cz - P.pos.z) > 90) continue;
        gatherAt(lot, 7, 10, rng() < 0.3 ? "“Let's get in! 🎉”" : null);
        // an occasional bouncer-line shout / neon energy
        clubT -= routineT;
        if (clubT <= 0) { clubT = 3 + rng() * 4; const q = nearLot(lot, 9); if (q) say(q, ["“One in, one out.”", "“This place is packed.”", "🎶"][(rng() * 3) | 0], "#ff8bd0", 2.4); }
      }
    } else {
      // DAYTIME: a busy shop forms a small queue around lunch + shopping hours
      if (hour >= 11 && hour < 19) {
        const kinds = ["food", "clothing", "electronics", "bank"];
        const k = kinds[(Math.floor(hour) + (g.cityKills | 0)) % kinds.length];
        const shops = lotsOfKind(k);
        if (shops.length) {
          const lot = shops[(Math.floor(hour)) % shops.length];
          if (!(P && Math.hypot(lot.cx - P.pos.x, lot.cz - P.pos.z) > 90)) {
            gatherAt(lot, 5, 6, rng() < 0.2 ? "“Long line today.”" : null);
            queueT -= routineT;
            if (queueT <= 0) { queueT = 6 + rng() * 6; CBZ.cityGossip(lot.cx, lot.cz, "sale", 0.4); }
          }
        }
      }
    }
  }
  function nearLot(lot, r) {
    let best = null, bd = r * r;
    for (const p of CBZ.cityPeds) {
      if (p.dead || p.controlled) continue;
      const dx = p.pos.x - lot.cx, dz = p.pos.z - lot.cz, d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = p; }
    }
    return best;
  }

  // ===========================================================================
  //  AMBIENT SOCIAL EVENTS — small emergent vignettes so the world has STORIES:
  //  a street argument that may end a relationship, a public NPC proposal, a
  //  busker drawing a little crowd, friends greeting. All cheap, near-camera,
  //  throttled to one new event every several seconds.
  // ===========================================================================
  let eventT = 6;
  function tickEvents(dt) {
    eventT -= dt; if (eventT > 0) return;
    eventT = 5 + rng() * 6;                          // a vignette every ~5-11s
    const P = CBZ.player; if (!P) return;
    // pick a candidate civilian near the camera
    const near = CBZ.cityPeds.filter((p) => !p.dead && !p.vendor && !p.gang && !p.controlled && !p.companion
      && p.state !== "flee" && p.state !== "fight" && !p.rage
      && Math.hypot(p.pos.x - P.pos.x, p.pos.z - P.pos.z) < 30);
    if (!near.length) return;
    const a = near[(rng() * near.length) | 0];
    const roll = rng();
    if (a.partner && !a.partner.dead && Math.hypot(a.pos.x - a.partner.pos.x, a.pos.z - a.partner.pos.z) < 5) {
      // COUPLE vignette: argue → maybe break up, or a sweet moment / proposal
      const b = a.partner;
      a.speed = 0; b.speed = 0; a.pause = b.pause = 2.5;
      a.group.rotation.y = Math.atan2(b.pos.x - a.pos.x, b.pos.z - a.pos.z);
      b.group.rotation.y = Math.atan2(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
      if (roll < 0.32) {
        // ARGUMENT — a strong bond ("together") survives the spat; a weak one
        // (or an already-strained one) snaps into a breakup.
        say(a, "“I'm done with this!”", "#ff9b8b", 2.6);
        say(b, "“Fine. We're OVER.”", "#ff9b8b", 2.6);
        a.mood = b.mood = -1;
        a.together = b.together = Math.max(0, (a.together || 0.5) - 0.25);
        if (rng() < 0.6 - (a.together || 0.5) * 0.5) {
          a.partner = null; b.partner = null; a.together = b.together = 0; a.engaged = b.engaged = false;
          if (a.family) a.family = a.family.filter((x) => x !== b);
          if (b.family) b.family = b.family.filter((x) => x !== a);
          // if this pair was ever recorded in the persistent family tree
          // (both have sids — the budget gate/weaveFamilies only mints for
          // ledger-worthy couples), end that marriage too — divorce, not death.
          if (a._sid && b._sid && CBZ.cityFamilyTree) CBZ.cityFamilyTree.endMarriage(a._sid, b._sid, "divorce");
          gossipFrom(a, "breakup", 0.5);
        }
      } else if (roll < 0.45 && !a.engaged) {
        // NPC PROPOSAL
        say(a, "“Marry me? 💍”", "#ff8bd0", 2.8);
        say(b, "“YES! 😭💕”", "#ff8bd0", 2.8);
        a.engaged = b.engaged = true; a.mood = b.mood = 1; a.together = b.together = 1;
        gossipFrom(a, "proposal", 0.6);
      } else {
        // a sweet beat
        say(a, ["“I love you 💕”", "“You're the best.”", "❤️"][(rng() * 3) | 0], "#ff8bd0", 2.2);
        a.mood = b.mood = Math.min(1, (a.mood || 0) + 0.4);
      }
    } else if (a.friends && a.friends.length && roll < 0.6) {
      // FRIEND vignette: greet a clique-mate nearby, or share gossip
      const f = a.friends.find((q) => q && !q.dead && Math.hypot(q.pos.x - a.pos.x, q.pos.z - a.pos.z) < 6);
      if (f) {
        a.speed = 0; a.pause = 1.5;
        a.group.rotation.y = Math.atan2(f.pos.x - a.pos.x, f.pos.z - a.pos.z);
        say(a, ["“Ayy! 👋”", "“What's good?”", "“Long time!”", "😂"][(rng() * 4) | 0], "#cfe6ff", 2.2);
        a.mood = Math.min(1, (a.mood || 0) + 0.2);
      }
    } else if (roll < 0.78) {
      // SOLO AMBIENT: phone call, comment on the day, or a busker
      if (rng() < 0.4 && a.archetype !== "merchant") {
        // busker: stop and "perform"; nearby peds drift over
        a.speed = 0; a.pause = 4; a.state = "idle";
        say(a, "🎸", "#ffd27b", 2.6);
        gatherAt({ cx: a.pos.x, cz: a.pos.z }, 4, 4, null);
      } else {
        say(a, ["“…uh huh, yeah.”📱", "“Nice day out.”", "“Where's that bus 🚌”", "“So tired.”"][(rng() * 4) | 0], "#dfe7ff", 2.2);
        a.pause = Math.max(a.pause || 0, 1.2); a.speed = 0;
      }
    }
    // PERSONAL recognition: a ped who has a real relationship with the player
    // reacts to THEM specifically — a friend greets, an admirer fawns, a
    // grudge-holder mutters a threat, the frightened shrink away. This makes the
    // relationship visible on the street, not just a hidden number.
    for (const cand of near) {
      const r = cand.relPlayer; if (!r || !r.seen) continue;
      if (rng() > 0.35) continue;                       // don't have everyone pipe up at once
      const b = bondOf(cand);
      if (r.grudge > 55) { say(cand, ["“I see you…”", "“You'll get yours.”", "😠"][(rng() * 3) | 0], "#ff6b6b", 2.2); cand.mood = -1; }
      else if (b > 0.9) {
        // they know you by the name the street gave you
        const ttl = CBZ.cityPlayerTitle ? CBZ.cityPlayerTitle() : "friend";
        say(cand, ["“Yo, " + ttl + "! 😄”", "“My friend!”", "“Good to see you 🙌”"][(rng() * 3) | 0], "#7ed957", 2.2); cand.mood = 1;
      }
      else if (b > 0.35) { say(cand, ["“'Sup. 👋”", "“Respect.”", "“Lookin' good.”"][(rng() * 3) | 0], "#bfe0ff", 2); }
      else if (r.fear > 55) { say(cand, ["“…please, I don't want trouble.”", "“Just leave me be.”", "😰"][(rng() * 3) | 0], "#cfd6e6", 2.2); cand.fear = Math.max(cand.fear || 0, 4); }
      break;                                            // one reaction per vignette pass
    }
    // if the player is famous/rich and near, an onlooker may recognize them
    if (rng() < 0.25 && ((g.respect || 0) > 40 || (g.cash || 0) > 8000)) {
      const fan = near[(rng() * near.length) | 0];
      if (fan && fan !== a) {
        fan.knowsHero = Math.min(1, (fan.knowsHero || 0) + 0.3);
        say(fan, (g.cash || 0) > 20000 ? "“That's big money right there 💰”" : "“I know that name.”", "#bfe0ff", 2.4);
        CBZ.cityGossip(P.pos.x, P.pos.z, "heroRich", 0.4);
      }
    }
  }

  // ===========================================================================
  //  ACTION HOOKS — we WRAP (never replace) the public deed APIs so every crime
  //  or kindness the player commits on a ped feeds that ped's relationship axes.
  //  Each wrapped fn calls the ORIGINAL first (preserving every side effect),
  //  then records the relationship event. Wrapped once, idempotently, at init.
  // ===========================================================================
  function wrap(name, kind, amtFn) {
    const orig = CBZ[name];
    if (typeof orig !== "function" || orig._relWrapped) return;
    const w = function (ped) {
      const ret = orig.apply(this, arguments);
      try {
        if (ped && ped.pos && !ped.vendor) {
          const amt = amtFn ? amtFn(ped, ret) : 1;
          if (amt > 0) CBZ.cityRelShift(ped, kind, amt);
        } else if (ped && ped.vendor && kind === "robbed") {
          markVendorRobbed(ped);     // stuck up the clerk in person — they remember
        }
      } catch (e) { /* never let a relationship hiccup break a core action */ }
      return ret;
    };
    w._relWrapped = true; w._relOrig = orig;
    CBZ[name] = w;
  }
  function wrapActionHooks() {
    if (_wrapped) return; _wrapped = true;
    // crimes against a person → fear + grudge (scaled by how much was taken)
    wrap("cityRobPed", "robbed", (ped, ret) => 1 + (ret && ret.cash ? Math.min(1, ret.cash / 200) : 0));
    wrap("cityKOPed", "beaten", () => 0.8);
    wrap("cityDealTo", "paid", () => 0.6);   // a customer you serve warms up a touch
    // RECRUITING: someone who HATES you flat-out refuses; otherwise it's a bond
    // of trust → big loyalty. We gate BEFORE the original so a grudge holds.
    const orec = CBZ.cityRecruit;
    if (typeof orec === "function" && !orec._relWrapped) {
      const w = function (ped) {
        if (ped && !ped.dead && CBZ.cityRelWillRecruit(ped) <= 0.05) {
          CBZ.city && CBZ.city.note((ped.name || "They") + " won't run with you — too much bad blood.", 2);
          say(ped, "“After what you did? Never.”", "#ff9b8b", 2.2);
          return;
        }
        const ret = orec.apply(this, arguments);
        try { if (ped && ped.recruited) CBZ.cityRelShift(ped, "recruited", 1); } catch (e) {}
        return ret;
      };
      w._relWrapped = true; w._relOrig = orec; CBZ.cityRecruit = w;
    }
    // killing is special: the VICTIM is dead, so the shift goes to their circle
    // via citySocialWitnessKill (already wired). We additionally wrap cityKillPed
    // to make sure a player kill always seeds the witness/grudge web even when
    // the victim had no partner (peds.js only auto-calls citySocialDeath then).
    const ok = CBZ.cityKillPed;
    if (typeof ok === "function" && !ok._relWrapped) {
      const w = function (ped, imp, cause) {
        const wasNoPartner = ped && !ped.partner;
        // capture the victim's combat target BEFORE the kill clears it — if they
        // were attacking a gang member, the player just DEFENDED that member.
        const wasAttacking = ped && (ped.rage || ped.mem);
        const ret = ok.apply(this, arguments);
        try {
          const byPlayer = !imp || imp.byPlayer !== false;
          // peds.js calls citySocialDeath only when ped.partner existed; cover
          // the rest (friends/clique/gang) so a witnessed murder still lands.
          if (ped && byPlayer && wasNoPartner && CBZ.citySocialWitnessKill) {
            const P = CBZ.player;
            const near = P && !P.dead && ped.pos && Math.hypot(ped.pos.x - P.pos.x, ped.pos.z - P.pos.z) < 26;
            if (near) CBZ.citySocialWitnessKill(ped, true);
          }
          // DEFENDED A GANG MEMBER: you dropped someone who was fighting a non-
          // player gang ped → that member (and their nearby crew, via ripple)
          // warms to you. Gate to a real, live, befriendable gang victim's foe.
          if (byPlayer) {
            const foe = wasAttacking;
            if (foe && foe.gang && foe.gang !== "player" && !foe.dead && foe !== ped
                && CBZ.cityCanBefriend(foe)) {
              const P = CBZ.player;
              const seen = P && !P.dead && foe.pos && ped.pos
                && Math.hypot(foe.pos.x - ped.pos.x, foe.pos.z - ped.pos.z) < 30;
              if (seen) {
                CBZ.cityRelShift(foe, "defendedGang", 1);
                if (CBZ.cityGangAddStanding) CBZ.cityGangAddStanding(foe.gang, 4);
                say(foe, "“Good lookin' out! 🤝”", "#7ed957", 2);
              }
            }
          }
        } catch (e) { /* combat must never break on a relationship hiccup */ }
        return ret;
      };
      w._relWrapped = true; w._relOrig = ok; CBZ.cityKillPed = w;
    }
    // STORE ROBBERY → the CLERK remembers. robTill lives inside shops.js as a
    // local, so we watch the one public signal every till stick-up sends —
    // cityCrime with type "store robbery" at the till's coordinates — and stamp
    // the nearest live vendor's refusal window. Bounded shop-lot scan, only on
    // the (rare) event itself.
    const ocrime = CBZ.cityCrime;
    if (typeof ocrime === "function" && !ocrime._relWrapped) {
      const wc = function (amount, opts) {
        const ret = ocrime.apply(this, arguments);
        try {
          if (opts && opts.type === "store robbery" && opts.x != null) {
            const A = CBZ.city && CBZ.city.arena;
            let v = null, bd = 24 * 24;
            if (A && A.shopLots) for (const l of A.shopLots) {
              const b = l.building; if (!b || !b.vendor || b.vendor.dead) continue;
              const dx = l.cx - opts.x, dz = l.cz - opts.z, d2 = dx * dx + dz * dz;
              if (d2 < bd) { bd = d2; v = b.vendor; }
            }
            if (v) markVendorRobbed(v);
          }
        } catch (e) { /* the wanted system must never break on a memory hiccup */ }
        return ret;
      };
      wc._relWrapped = true; wc._relOrig = ocrime; CBZ.cityCrime = wc;
    }
    // pickpocket + ransom-demand live in interact.js as locals (no public fn),
    // so they aren't wrapped here; the dominant person-crimes (mug/beat/KO/kill)
    // and kindnesses (recruit/deal/date/rescue) ARE, which is where the bond
    // moves most. Other modules can call cityRelShift directly for the rest.
  }

  // ===========================================================================
  //  RELATIONSHIP DIRECTOR — per-second upkeep:
  //   • DECAY: hot feelings (fear, fresh grudge) cool over time; loyalty,
  //     respect and deep grudges fade much slower (RimWorld-style memory decay).
  //   • LOYALTY DEFENSE: a high-loyalty civilian nearby will JUMP IN to fight
  //     someone attacking YOU (they pick up your enemy as their rage target).
  //   • GRUDGE AMBUSH (delayed consequence): a ped nursing a big grudge, once
  //     its timer elapses and it spots you, turns hostile — a payback attack.
  //  Time-sliced across the ped array so it stays cheap on a phone.
  // ===========================================================================
  function tickRelationships(dt) {
    relTickT -= dt; if (relTickT > 0) return;
    const step = relTickT + 1; relTickT = 1;           // ~1Hz, dt-corrected decay
    const peds = CBZ.cityPeds, n = peds.length;
    if (!n) return;
    const P = CBZ.player, PA = CBZ.city && CBZ.city.playerActor;
    // who is currently attacking the player? (so loyal peds can defend)
    let aggressor = null;
    // process a window of the array per tick (256 covers a big crowd in a few s)
    relTickCur = relTickCur % n;
    const end = Math.min(n, relTickCur + 256);
    for (let i = relTickCur; i < end; i++) {
      const p = peds[i]; if (!p || p.dead) continue;
      const r = p.relPlayer; if (!r || !r.seen) continue;
      r.t += step;
      // ---- decay (different half-lives per axis) ----
      r.fear = clamp100(r.fear - step * 1.6);                 // fear fades fastest
      if (r.grudge < 30) r.grudge = clamp100(r.grudge - step * 0.8);   // petty grudges cool
      else r.grudge = clamp100(r.grudge - step * 0.12);                // deep ones linger
      r.respect = clamp100(r.respect - step * 0.15);
      r.loyalty = clamp100(r.loyalty - step * 0.05);          // loyalty is sticky
      r.affection = clamp100(r.affection - step * 0.03);
      p.affection = r.affection;
      // ---- the grudge AMBUSH timer ----
      if (r.ambushT > 0) r.ambushT -= step;
      // re-derive behaviour flags from the decayed values (cheap; this window)
      driveFlags(p);
      if (!P || P.dead) continue;
      const dx = p.pos.x - P.pos.x, dz = p.pos.z - P.pos.z, d2 = dx * dx + dz * dz;
      // ---- LOYALTY DEFENSE: a devoted civ near you fights your attacker ----
      if (r.loyalty > 60 && !p.gang && !p.recruited && !p.controlled && d2 < 22 * 22 && !p.rage) {
        if (!aggressor) aggressor = findPlayerAttacker(P, PA);
        if (aggressor && aggressor !== p && !aggressor.dead) {
          p.rage = aggressor; p.state = "fight"; r.t = 0;
          if (rng() < 0.5) say(p, ["“Leave them ALONE!”", "“I got your back!”", "“Back OFF!”"][(rng() * 3) | 0], "#7ed957", 2.2);
        }
      }
      // ---- GRUDGE AMBUSH: timer elapsed + they can see you → payback ----
      else if (r.grudge > 45 && r.ambushT <= 0 && !p.controlled && !p.recruited && !p.rage && d2 < 24 * 24) {
        // bold grudge-holders attack; meek ones snitch hard + flee toward a cop
        if ((p.aggr || 0.3) > 0.45 && (r.grudge > 60 || (p.aggr || 0.3) > 0.6)) {
          p.rage = PA || P; p.state = "fight"; p.mem = PA || P;
          p.alarmed = Math.max(p.alarmed || 0, 6);
          say(p, ["“Remember ME?!”", "“This is for them!”", "“You're DEAD.”"][(rng() * 3) | 0], "#ff6b6b", 2.4);
          r.ambushT = 45 + rng() * 40;   // if they survive, they'll try again later
        } else {
          // a coward's revenge: become a committed witness against you
          p.snitch = 1; p.mem = PA || P; p.alarmed = Math.max(p.alarmed || 0, 4);
          if ((p.witnessSev || 0) < 60) { p.witnessSev = 60; p.witnessType = p.witnessType || "the gunman"; }
          r.ambushT = 30 + rng() * 30;
        }
      }
    }
    relTickCur = end >= n ? 0 : end;
  }
  // find a live ped/cop currently targeting the player (their rage is the
  // player actor or the player object) — the one a loyalist will defend against.
  function findPlayerAttacker(P, PA) {
    let best = null, bd = 26 * 26;
    for (const q of CBZ.cityPeds) {
      if (q.dead || q.controlled || q.recruited) continue;
      if (q.rage === PA || q.rage === P) {
        const dx = q.pos.x - P.pos.x, dz = q.pos.z - P.pos.z, d2 = dx * dx + dz * dz;
        if (d2 < bd) { bd = d2; best = q; }
      }
    }
    return best;
  }

  // ===========================================================================
  //  the social tick: bubbles + gossip + routines + ambient events. Runs only
  //  in city mode, all internally throttled so it's cheap on phones.
  // ===========================================================================
  CBZ.onUpdate(34.5, function (dt) {
    if (g.mode !== "city") return;
    _clock += dt;                                    // city-time clock (vendor refusal windows)
    if (partsCD > 0) partsCD -= dt;                  // street-parts show rate gate
    tickBubbles(dt);
    tickGossip(dt);
    tickRoutines(dt);
    tickEvents(dt);
    tickRelationships(dt);
  });

  // ---- per-frame: companion/hostage/kidnap movement + the kidnap director ----
  CBZ.onUpdate(34.6, function (dt) {
    if (g.mode !== "city") return;
    const P = CBZ.player;

    // partner / hostage follow the player (a few steps behind)
    const follow = (ped, offset) => {
      if (!ped || ped.dead) return;
      const yaw = CBZ.cam ? CBZ.cam.yaw : 0;
      const bx = P.pos.x + Math.sin(yaw) * offset, bz = P.pos.z + Math.cos(yaw) * offset;
      ped.target.set(bx, 0, bz); ped.state = "walk";
      const d = Math.hypot(ped.pos.x - P.pos.x, ped.pos.z - P.pos.z);
      ped.speed = d > 1.6 ? ped.baseSpeed * 1.6 : 0;
      if (ped.speed > 0) {
        const dx = ped.target.x - ped.pos.x, dz = ped.target.z - ped.pos.z, dd = Math.hypot(dx, dz) || 1;
        ped.pos.x += (dx / dd) * ped.speed * dt; ped.pos.z += (dz / dd) * ped.speed * dt;
        ped.group.rotation.y = CBZ.lerpAngle(ped.group.rotation.y, Math.atan2(dx, dz), 1 - Math.pow(0.001, dt));
      }
      if (CBZ.collide) CBZ.collide(ped.pos, 0.5, ped.pos.y, ped.pos.y + 1.7);
      ped.pos.y = 0;
      if (CBZ.animChar) CBZ.animChar(ped.char, ped.speed, dt);
    };
    if (g.cityPartner && g.cityPartner.companion && !g.cityPartner.kidnapped) follow(g.cityPartner, 2.6);
    if (g.cityHostage) follow(g.cityHostage, 1.2);

    // kidnap director: when you're hot near a provoked gang, they may snatch
    // your partner and drag them back to a turf building (rescue mission).
    kidnapCD -= dt;
    if (kidnapCD <= 0) {
      kidnapCD = 5;
      const partner = g.cityPartner;
      if (partner && partner.companion && !partner.kidnapped && (g.wanted | 0) >= 2 && CBZ.cityGangs && CBZ.cityGangs.length) {
        // a provoked gang near you grabs them
        const gang = CBZ.cityGangs.find((x) => x.provoke > 0.5);
        if (gang && rng() < 0.5) kidnap(partner, gang);
      }
      // reaching the captor frees them
      if (partner && partner.kidnapped) {
        const d = Math.hypot(P.pos.x - partner.pos.x, P.pos.z - partner.pos.z);
        if (d < 3.5 && !P.dead) freePartner(partner);
      }
    }
    // a kidnapped partner is parked at the gang building (controlled, not following)
    if (g.cityPartner && g.cityPartner.kidnapped && beacon) {
      beacon.position.set(g.cityPartner.pos.x, 15, g.cityPartner.pos.z);
    }
  });

  function kidnap(ped, gang) {
    const lot = gang.turf[(rng() * gang.turf.length) | 0]; if (!lot) return;
    ped.kidnapped = true; ped.companion = false; ped.controlled = true;
    ped.pos.set(lot.cx, 0, lot.cz);
    ped.target.set(lot.cx, 0, lot.cz); ped.speed = 0;
    CBZ.cityGangProvoke && CBZ.cityGangProvoke(gang.id, 1);
    makeBeacon(lot.cx, lot.cz, 0xff6bd0);
    CBZ.city.big("💔 " + gang.name + " grabbed your partner!");
    CBZ.city.note("Rescue " + ped.name + " from the " + gang.name + " block (pink beacon).", 3);
  }
  function freePartner(ped) {
    ped.kidnapped = false; ped.companion = true; ped.controlled = true;
    ped.mood = 1; ped.opinion = 1;
    CBZ.cityRelShift(ped, "rescued", 1.5);   // saving them is the deepest loyalty there is
    clearBeacon();
    CBZ.city.big("💕 Rescued " + ped.name + "!");
    CBZ.city.addRespect(6);
    say(ped, "“You came for me! 💕”", "#ff8bd0", 2.6);
    // heroics travel: the block hears you saved someone
    if (ped.pos) CBZ.cityGossip(ped.pos.x, ped.pos.z, "heroHero", 0.6);
  }
})();
