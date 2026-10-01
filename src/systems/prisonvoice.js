/* ============================================================
   systems/prisonvoice.js - THE BLOCK NOTICES YOU.

   Owner, 2026-09-28: "Find all that dialogue slop... Add more actual
   valuable shit." The prison talked AT the player (a third of idle talks
   pointed him at the gun room) and never talked ABOUT him. This file is the
   second half: people react to what he is and what he just did.

     CBZ.prisonVoice.react(actor)  -> a line or null. economy.js talk() asks
                                      this first, so a man you walk up to
                                      answers the thing in front of him
                                      (the gun in your hand, the blood on
                                      your shirt, the man you dropped).
     the tick                      -> a few unprompted lines: an inmate who
                                      sees a piece in your hand, the yard
                                      after you put somebody down, a CO
                                      doing real procedure, inmates to a
                                      player in uniform.

   Rules: a few words, a real voice, no mechanics, no directions, never the
   gun room, a key, a route or a way out. Rates are low on purpose; the
   speech system caps three lines on screen and the nearest win.
============================================================ */
(function () {
  "use strict";
  const CBZ = (window.CBZ = window.CBZ || {});

  const V = {
    // an inmate talking to a player in a CO's uniform
    toCop: ["I ain't done nothing, CO.", "Search me. I'm clean.", "When's my phone call, CO?",
      "You new? You look new.", "Sink's been leaking three weeks, boss.", "Morning, boss."],
    seesGun: ["Where'd you get that?", "Put that away.",
      "You're gonna get the whole block tossed.", "Don't point that at me.", "You crazy? Put it away."],
    seesBlade: ["Put that away. Not here.", "Carrying in the open? Stupid.", "Easy with that."],
    // the moment a man hits the floor, from somebody who saw it
    witnessKo: ["Damn.", "He's out.", "Oh, he's DONE.", "Somebody get him up.", "Ohhh."],
    // later, face to face
    sawFight: ["Saw what you did to him.", "His people saw that.", "He had it coming.",
      "Watch your back now.", "Heard him hit the floor from here."],
    hurt: ["You're bleeding on my floor.", "Who got you?", "You look like hell.", "Keep pressure on that."],
    freshFish: ["Fresh fish.", "What you in for?", "Don't sit there. Not yet.",
      "First night's the worst.", "Keep your eyes down a week."],
    code: ["Don't sit there.", "Don't touch another man's tray.", "Eyes down in the shower.",
      "Nobody jumps the phone line.", "Pay what you owe."],
    // a CO doing the job, to an inmate who is doing nothing wrong
    coProcedure: ["Tuck your shirt in.", "Hands out of your pockets.", "Keep it moving.",
      "ID on your chest.", "Single file.", "Where you supposed to be?", "Walk, don't run."],
    coToCop: ["Quiet one so far.", "Radio's been dead all morning.", "Two hours to relief.",
      "Warden's in a mood.", "Coffee's burnt again."],
  };
  function pick(a) {
    const r = CBZ.econ && CBZ.econ.rng ? CBZ.econ.rng() : Math.random();
    return a[Math.floor(r * a.length) % a.length];
  }
  function rnd() { return CBZ.econ && CBZ.econ.rng ? CBZ.econ.rng() : Math.random(); }
  function escape() { const g = CBZ.game; return !!(g && g.mode === "escape" && g.state === "playing"); }
  function guardish(a) { return !!(a && (a.kind === "guard" || a.kind === "warden")); }
  function up(a) { return !!(a && a.group && !a.dead && !(a.ko > 0) && !a.escaped && !a.asleep && !a.tied); }
  function held() {
    const w = CBZ.equippedWeapon ? CBZ.equippedWeapon() : null;
    if (!w) return null;
    return w.melee ? "blade" : "gun";
  }
  function hurt() { const P = CBZ.player; return !!(P && P.hp != null && P.hp < 45 && !P.dead); }

  // the last time the player put somebody down, stamped by the tick below
  let kos = 0, koAt = -1e9, koSpot = null;
  function now() { return (CBZ.game && CBZ.game.elapsed) || 0; }
  function recentKo() { return now() - koAt < 90; }

  /* Face to face. Order is what a person would lead with: the gun beats the
     blood, the blood beats the fight, the fight beats "you're new". Guards
     answer only in their own lane (a CO does not comment on your fight to
     your face; he cuffs you for it, elsewhere). Null means "be yourself". */
  function react(actor) {
    if (!actor || !escape()) return null;
    const g = CBZ.game;
    if (guardish(actor)) {
      if (g.role === "cop") return rnd() < 0.5 ? pick(V.coToCop) : null;
      return rnd() < 0.35 ? pick(V.coProcedure) : null;
    }
    if (g.role === "cop") return pick(V.toCop);
    const h = held();
    if (h) return pick(h === "gun" ? V.seesGun : V.seesBlade);
    if (hurt()) return pick(V.hurt);
    if (recentKo() && rnd() < 0.7) return pick(V.sawFight);
    if (now() < 150 && rnd() < 0.55) return pick(V.freshFish);
    if (rnd() < 0.12) return pick(V.code);
    return null;
  }

  // ---- unprompted ---------------------------------------------------------
  let tickT = 0, globalCD = 0;
  function nearest(list, x, z, r, ok) {
    let best = null, bd = r * r;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!up(a) || !ok(a)) continue;
      const p = a.group.position, dx = p.x - x, dz = p.z - z, d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }
  function ready(a) { return !(a._voiceCD > now()) && !(a.approach && (a.approach.t || 0) > 0) && a.aiState !== "fight"; }
  function speak(a, line, cd) {
    if (!CBZ.prisonSay || !line) return false;
    const ok = !!CBZ.prisonSay(a, line, { secs: 2.2 });
    if (ok) { a._voiceCD = now() + (cd || 60); globalCD = 5 + rnd() * 5; }
    return ok;
  }
  function tick(dt) {
    if (!escape()) { kos = (CBZ.game && CBZ.game.kos) || 0; return; }
    const g = CBZ.game, P = CBZ.player;
    // a put-down happened: somebody who saw it says so, right now
    const k = g.kos || 0;
    if (k > kos) {
      kos = k; koAt = now(); koSpot = P && P.pos ? { x: P.pos.x, z: P.pos.z } : null;
      if (koSpot) {
        const w = nearest(CBZ.npcs || [], koSpot.x, koSpot.z, 11, (a) => !guardish(a) && ready(a));
        if (w && rnd() < 0.8) speak(w, pick(V.witnessKo), 30);
      }
    }
    if (k < kos) kos = k;                         // a new run reset the count
    if (globalCD > 0) { globalCD -= dt; return; }
    tickT -= dt;
    if (tickT > 0) return;
    tickT = 0.6;
    if (!P || !P.pos || P.dead) return;
    const x = P.pos.x, z = P.pos.z;
    if (g.role === "cop") {
      const a = nearest(CBZ.npcs || [], x, z, 4, (n) => !guardish(n) && ready(n));
      if (a && rnd() < 0.18) speak(a, pick(V.toCop), 90);
      return;
    }
    const h = held();
    if (h) {
      const a = nearest(CBZ.npcs || [], x, z, 6, (n) => !guardish(n) && ready(n));
      if (a && rnd() < 0.35) speak(a, pick(h === "gun" ? V.seesGun : V.seesBlade), 45);
      return;
    }
    if (hurt()) {
      const a = nearest(CBZ.npcs || [], x, z, 4, (n) => !guardish(n) && ready(n));
      if (a && rnd() < 0.12) speak(a, pick(V.hurt), 90);
      return;
    }
    // a CO on his round, to an inmate minding his business; never while hot
    if ((g.heat || 0) < 20 && !(g.lastKnown && g.lastKnown.t > 0)) {
      const c = nearest(CBZ.guards || [], x, z, 5, (n) => ready(n) && !(n.alert > 0.3));
      if (c && rnd() < 0.05) speak(c, pick(V.coProcedure), 120);
    }
  }
  if (CBZ.onUpdate) CBZ.onUpdate(40.7, tick);

  CBZ.prisonVoice = { react: react, lines: V };
})();
