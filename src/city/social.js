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
    s.position.y = 3.7; s.scale.set(Math.min(7, 2.6 + text.length * 0.16), 0.8, 1);
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

  // ---- relationship / reputation graph (lazy, lives on each ped) ----
  //   ped.friends[]  — clique members (mutual)
  //   ped.partner    — romantic partner (existing field, preserved)
  //   ped.family[]   — partner + (notional) kin (existing field, preserved)
  //   ped.mood       — -1 angry .. 0 neutral .. +1 happy (decays to 0)
  //   ped.knowsHero  — 0..1 how much this ped has "heard about" the player
  //   ped.opinion    — -1 hates .. +1 loves the player (gossip-driven)

  // ---- setup: weave civilians into couples, families, and friend cliques ----
  CBZ.citySocialInit = function () {
    g.cityPartner = null; g.citySpouse = false; g.cityHostage = null;
    clearBeacon(); kidnapCD = 12;
    BUBBLES.length = 0; clubT = 0; queueT = 0; gossipT = 2; eventT = 6; routineT = 1.5;
    const civ = CBZ.cityPeds.filter((p) => p.kind === "civilian" && !p.vendor && !p.gang);
    // shuffle-ish pairing into couples (45%)
    for (let i = 0; i + 1 < civ.length; i += 2) {
      if (rng() < 0.45) {
        const a = civ[i], b = civ[i + 1];
        a.partner = b; b.partner = a;
        a.family = [b]; b.family = [a];
        a.together = b.together = 0.5 + rng() * 0.5;   // relationship strength
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
  };

  CBZ.cityIsRomance = function (ped) {
    return ped && !ped.dead && ped.kind === "civilian" && !ped.vendor && !ped.gang && ped !== g.cityPartner && !ped.partner;
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
    ped.mood = 1; ped.knowsHero = Math.min(1, (ped.knowsHero || 0) + 0.3); ped.opinion = Math.min(1, (ped.opinion || 0) + 0.25);
    if (CBZ.sfx) CBZ.sfx("coin");
    say(ped, FLIRT_LINES[(rng() * FLIRT_LINES.length) | 0], "#ff8bd0", 2);
    if (ped.affection >= (S().partnerAt || 60)) {
      g.cityPartner = ped; ped.companion = true; ped.controlled = true; ped.romance = true; ped.together = 1;
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
    CBZ.city.big("💍 You married " + ped.name + "!");
    CBZ.city.addRespect(10);
  };

  // ---- hostage: grab a ped at gunpoint as a shield / for ransom ----
  CBZ.cityTakeHostage = function (ped) {
    if (!ped || ped.dead || ped === g.cityPartner) return;
    const armed = g.cityWeapon && CBZ.cityEcon.ITEMS[g.cityWeapon] && CBZ.cityEcon.ITEMS[g.cityWeapon].gun;
    if (!armed) { CBZ.city.note("Need a gun to take a hostage.", 1.6); return; }
    if (g.cityHostage) { CBZ.city.note("You already have a hostage.", 1.4); return; }
    g.cityHostage = ped; ped.controlled = true; ped.hostage = true; ped.fear = 10; ped.rage = null;
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
      CBZ.cityCrime && CBZ.cityCrime(30, { type: "extortion" });
    } else {
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
    // The legacy caller passes only (ped); without an explicit flag, infer the
    // player's involvement from proximity so an NPC gang war across town doesn't
    // wrongly turn the whole map against you. An explicit flag always wins.
    if (byPlayer == null) {
      const P = CBZ.player;
      byPlayer = !!(P && !P.dead && ped.pos && Math.hypot(ped.pos.x - P.pos.x, ped.pos.z - P.pos.z) < 26 && ((g.wanted | 0) >= 1 || g.cityWeapon));
    }
    // anyone bonded to the victim reacts; the player gets the "killer" rumor
    if (CBZ.citySocialWitnessKill) CBZ.citySocialWitnessKill(ped, byPlayer);
    if (ped === g.cityPartner) {
      g.cityPartner = null; g.citySpouse = false; clearBeacon();
      CBZ.city && CBZ.city.big("💔 Your partner was killed");
    }
    if (ped === g.cityHostage) { g.cityHostage = null; }
    // sever relationship links so survivors don't reference a corpse
    if (ped.partner) { ped.partner.partner = null; if (ped.partner.family) ped.partner.family = ped.partner.family.filter((x) => x !== ped); }
    if (ped.friends) for (const f of ped.friends) if (f && f.friends) f.friends = f.friends.filter((x) => x !== ped);
  };

  CBZ.citySocialReset = function () {
    g.cityPartner = null; g.citySpouse = false; g.cityHostage = null;
    clearBeacon(); kidnapCD = 12;
    // retire any live speech bubbles + pending rumors
    for (const b of BUBBLES) retireBubble(b);
    BUBBLES.length = 0; RUMORS.length = 0;
    gossipT = 2; eventT = 6; routineT = 1.5; clubT = 0; queueT = 0;
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
        // grief turns to either rage (bold) or flight (meek)
        if ((m.aggr || 0.3) > 0.55 && !m.gang) { m.rage = CBZ.city.playerActor; m.state = "confront"; say(m, "“YOU KILLED THEM!”", "#ff6b6b", 2.6); }
        else { m.fear = 10; m.alarmed = Math.max(m.alarmed || 0, 6); say(m, "💔", "#9bb0ff", 2.6); }
      } else {
        m.fear = Math.max(m.fear || 0, 6); say(m, "💔", "#9bb0ff", 2.2);
      }
    }
    if (byPlayer && victim.pos) CBZ.cityGossip(victim.pos.x, victim.pos.z, "heroKilled", 0.8);
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
  //  the social tick: bubbles + gossip + routines + ambient events. Runs only
  //  in city mode, all internally throttled so it's cheap on phones.
  // ===========================================================================
  CBZ.onUpdate(34.5, function (dt) {
    if (g.mode !== "city") return;
    tickBubbles(dt);
    tickGossip(dt);
    tickRoutines(dt);
    tickEvents(dt);
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
    clearBeacon();
    CBZ.city.big("💕 Rescued " + ped.name + "!");
    CBZ.city.addRespect(6);
    say(ped, "“You came for me! 💕”", "#ff8bd0", 2.6);
    // heroics travel: the block hears you saved someone
    if (ped.pos) CBZ.cityGossip(ped.pos.x, ped.pos.z, "heroHero", 0.6);
  }
})();
