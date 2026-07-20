/* ============================================================
   city/club.js — THE VELVET CLUB: the city's status apex.

   The whole wealth loop pays off HERE: money → CLOTHES → DRIP → past the
   ROPE. There is exactly ONE exclusive nightclub (the "bar" lot, flagged by
   buildings.js as lot.building.club with a door / bouncerSpot / queue). This
   file runs the velvet-rope LINE and the BOUNCER who works the door:

     • THE LINE — a queue of NPCs waiting along the queue points. Most are
       under-dressed; the bouncer waves them up one at a time and TURNS THEM
       AWAY ("not tonight") — they peel off dejected. The rare well-dressed one
       gets let in. The line is the visible proof that the rope MEANS something.

     • THE GATE (the heart) — when YOU walk up to the rope the bouncer reads
       CBZ.cityPlayerDrip() vs CBZ.CITY.CLUB_DRIP:
         under  → REJECTED, with a note telling you your drip vs what's needed
                  (so you learn to go SHOPPING — clothes are the answer).
         over   → ADMITTED ("Welcome to the Velvet, VIP."), the rope opens.
         VIP_DRIP → the elite tier: an extra perk on top.

     • PERKS (why it MATTERS) — getting in is EARNED and pays real value:
         +respect on first entry (drip is a status signal),
         a SAFE HAVEN inside (cops lose interest / heat cools — a place to
           cool off after a job),
         BOTTLE SERVICE that flexes your drip into cash + respect (and, at VIP,
           a high-roller CONNECT — a recruitable big earner / a deal lead).

   IIFE, city-gated, registers via CBZ.onUpdate. Guards every cross-global
   (Agent A's drip API, Agent D's ped drip) so it works even if a sibling
   file hasn't landed yet. CBZ.cityClubReset() clears all state on a new run.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  // ---- tuning (Agent A owns CBZ.CITY.CLUB_DRIP / VIP_DRIP; fall back if absent
  //   so the gate still works before config lands). A full designer fit should
  //   clear CLUB_DRIP; only luxury reaches VIP. ----
  function clubDrip() { return (CBZ.CITY && CBZ.CITY.CLUB_DRIP) || 14; }
  function vipDrip() { return (CBZ.CITY && CBZ.CITY.VIP_DRIP) || 30; }

  // ---- FINITE bouncer: a killed bouncer is CONSUMED from the city headcount
  //   (peds.js cityKillPed already decrements _popTotal). It does NOT instantly
  //   respawn. The club may HIRE at most a small number of replacements per run,
  //   and only after a LONG delay — the player can stay ahead of it and even
  //   permanently clear the door. The club still runs its line with NO bouncer
  //   present (the door just stands unmanned). ----
  const BOUNCER_REHIRE = 135;   // seconds the post stands EMPTY before one replacement is hired
  const BOUNCER_MAX_HIRES = 2;  // total replacement bouncers the club will ever hire per run (after the original)

  // live club state (rebuilt per run by ensure()/reset)
  const S = {
    lot: null, club: null,       // the flagged lot + its .club data
    bouncer: null,               // the bouncer ped
    line: [],                    // { ped, slot } line-goers (front = index 0)
    spawnT: 0,                   // cadence to top the line back up
    judgeT: 0,                   // cadence for the bouncer to work the front of the line
    admitted: false,            // player is inside (past the rope) right now
    everIn: false,              // player has been admitted at least once (one-time bonus)
    rejectCD: 0,                 // so a rejected player isn't spammed every frame
    bottleCD: 0,                 // bottle-service payout cadence while inside
    bouncerDownT: 0,             // >0 while the door post is empty after a kill (counts down to a slow re-hire)
    bouncerHires: 0,             // replacement bouncers hired this run (finite — see BOUNCER_MAX_HIRES)
    unmannedNoted: false,        // one-time "door's unmanned" note per empty stretch
    note: "",
  };

  // ---------- helpers ----------------------------------------------------
  function dist2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }

  // player drip: prefer Agent A's equipped-outfit score; fall back to the
  // inventory-sum drip (econ.drip) so the gate is never dead.
  function playerDrip() {
    if (CBZ.cityPlayerDrip) { const v = CBZ.cityPlayerDrip(); if (typeof v === "number") return v; }
    const econ = CBZ.cityEcon;
    if (econ && econ.drip) { const v = econ.drip(); if (typeof v === "number") return v; }
    return 0;
  }

  // an NPC's drip: Agent D's cityPedDrip if present, else a cheap estimate from
  // wealth + how loaded they look (valuables). Most peds score LOW (the point).
  function pedDrip(p) {
    if (CBZ.cityPedDrip) { const v = CBZ.cityPedDrip(p); if (typeof v === "number") return v; }
    if (!p) return 0;
    let d = Math.round((p.wealth || 0) * 16);                 // 0..~16 from wealth
    if (p.valuables && p.valuables.length) d += p.valuables.length * 4;   // visible ice
    if (p.archetype === "tycoon" || p.archetype === "billionaire" || p.archetype === "socialite") d += 14;
    return d;
  }

  function note(msg, sec) { if (CBZ.city && CBZ.city.note) CBZ.city.note(msg, sec); }
  function big(msg) { if (CBZ.city && CBZ.city.big) CBZ.city.big(msg); }

  // ---------- the LINE: spawn / hold / dismiss --------------------------
  // hold a line-goer at its assigned slot, facing the door. We mark them
  // `controlled` so the main ped AI leaves them alone, and steer them to the
  // slot via the normal move() integrator (peds.js still runs move() on a
  // controlled ped). "idle" state = they stand once they arrive.
  function holdInLine(ped, slot) {
    if (!ped || ped.dead) return;
    ped.controlled = true;
    ped.companion = false; ped.guard = null; ped.rage = null; ped.fear = 0; ped.alarmed = 0;
    ped._clubLine = true;
    const d2 = dist2(ped.pos.x, ped.pos.z, slot.x, slot.z);
    if (d2 > 0.5 * 0.5) {
      // still walking up to the rope
      ped.state = "walk";
      if (ped.target) ped.target.set(slot.x, 0, slot.z);
      ped.path = null; ped.pause = 0;
    } else {
      // arrived — stand and face the door
      ped.state = "idle"; ped.speed = 0;
      if (ped.target) ped.target.set(ped.pos.x, 0, ped.pos.z);
      const fx = S.club.door.x - ped.pos.x, fz = S.club.door.z - ped.pos.z;
      if (fx * fx + fz * fz > 0.04) ped.group.rotation.y = Math.atan2(fx, fz);
    }
  }

  // release a ped from the line back into normal city life
  function release(ped, dejected) {
    if (!ped) return;
    ped.controlled = false; ped._clubLine = false;
    ped.state = "walk"; ped.path = null; ped.pause = 0;
    if (dejected && ped.group && S.club) {
      // peel away from the rope: head back out the way the line came in
      const n = S.club.normal;
      if (ped.target) ped.target.set(ped.pos.x + n.x * 24, 0, ped.pos.z + n.z * 24);
      ped._dejectedT = 5;     // a brief slumped walk-off (cosmetic; peds.js ignores unknown flags)
    }
  }

  // find a fresh civilian near the club to draft into the line (tag an existing
  // ped — cheap, no new rig). Falls back to CBZ.cityMakePed only if needed.
  function draftLineGoer() {
    const club = S.club; if (!club) return null;
    const anchor = club.queue[club.queue.length - 1] || club.bouncerSpot;
    let best = null, bd = 60 * 60;
    const peds = CBZ.cityPeds || [];
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p || p.dead || p.vendor || p.companion || p.controlled || p.recruited || p._parked || p.gang) continue;
      if (p.kind !== "civilian") continue;
      if (p.npcWanted | 0) continue;
      if (p === S.bouncer) continue;
      const d2 = dist2(p.pos.x, p.pos.z, anchor.x, anchor.z);
      if (d2 < bd) { bd = d2; best = p; }
    }
    if (best) return best;
    // nobody handy → spawn one at the back of the line (guarded)
    const root = arenaRoot();
    if (CBZ.cityMakePed && CBZ.cityPeds && root) {
      const s = club.queue[club.queue.length - 1];
      const ped = CBZ.cityMakePed(s.x, s.z, Math.random, {});
      root.add(ped.group);
      CBZ.cityPeds.push(ped);
      return ped;
    }
    return null;
  }

  // ---------- the BOUNCER -----------------------------------------------
  function arenaRoot() {
    const A = (CBZ.city && CBZ.city.arena) || (CBZ.buildCity ? CBZ.buildCity() : null);
    return A && A.root ? A.root : null;
  }

  function makeBouncer() {
    const club = S.club; if (!club || !CBZ.cityMakePed || !CBZ.cityPeds) return;
    const root = arenaRoot();
    if (!root) return;
    const bs = club.bouncerSpot;
    const ped = CBZ.cityMakePed(bs.x, bs.z, Math.random, {
      name: "Bouncer", kind: "civilian", wealth: 0.6,
      archetype: "merchant", job: "doorman", aggr: 0.5,
      // a big, intimidating doorman who packs heat but doesn't wander
      hp: 200, armed: true, weapon: "Pistol",
    });
    ped.controlled = true;          // never wanders — the door is the post
    ped._clubBouncer = true;
    ped.nerve = 0.95;
    ped.guard = null; ped.companion = false;
    ped.group.rotation.y = bs.face != null ? bs.face : 0;
    if (ped.target) ped.target.set(bs.x, 0, bs.z);
    ped.state = "idle"; ped.speed = 0;
    root.add(ped.group);
    CBZ.cityPeds.push(ped);
    S.bouncer = ped;
  }

  // keep the bouncer planted at the rope, facing the line
  function holdBouncer() {
    const b = S.bouncer, club = S.club;
    if (!b || b.dead || !club) return;
    const bs = club.bouncerSpot;
    b.controlled = true; b.state = "idle"; b.speed = 0;
    b.fear = 0; b.alarmed = 0;
    if (dist2(b.pos.x, b.pos.z, bs.x, bs.z) > 0.6 * 0.6) {
      b.state = "walk"; if (b.target) b.target.set(bs.x, 0, bs.z);
    } else if (bs.face != null) {
      b.group.rotation.y = bs.face;
    }
  }

  // the bouncer barks at whoever's at the FRONT of the line and judges them.
  function workTheLine(dt) {
    if (!S.line.length) return;
    S.judgeT -= dt;
    if (S.judgeT > 0) return;
    S.judgeT = 2.6 + Math.random() * 1.6;     // one judgement every few seconds
    const front = S.line[0];
    if (!front || !front.ped || front.ped.dead) { S.line.shift(); return; }
    const p = front.ped;
    const d = pedDrip(p);
    const ok = d >= clubDrip();
    if (ok) {
      // a rare well-dressed one gets waved in — they walk to the door & vanish
      // inside (we just release them toward the interior so it reads as "in").
      p.controlled = false; p._clubLine = false;
      p.state = "walk"; p.path = null; p.pause = 0;
      if (p.target) p.target.set(S.club.insideSpot.x, 0, S.club.insideSpot.z);
      p._clubGoingIn = 3.0;
      note("The bouncer waves a sharp-dressed guest past the rope.", 1.4);
    } else {
      // TURNED AWAY — the whole point. Dejected walk-off.
      release(p, true);
      note('Bouncer: "Not tonight." — turned away at the rope.', 1.3);
    }
    S.line.shift();
  }

  // top the line back up to a healthy length on a slow cadence
  function refillLine(dt) {
    const c = S.club; if (!c) return;
    // prune dead / escaped line-goers
    for (let i = S.line.length - 1; i >= 0; i--) {
      const e = S.line[i];
      if (!e.ped || e.ped.dead || !e.ped._clubLine || e.ped._clubGoingIn) S.line.splice(i, 1);
    }
    S.spawnT -= dt;
    // the rope is a NIGHT thing: a token couple of hopefuls by day, the full
    // line only forms after dark (peds.js cityNightShift rides the sun clock).
    const want = Math.min((CBZ.cityNightShift && CBZ.cityNightShift()) ? 6 : 2, c.queue.length - 1);
    if (S.line.length >= want) { reslot(); return; }
    if (S.spawnT > 0) return;
    S.spawnT = 1.4 + Math.random() * 1.2;
    const ped = draftLineGoer();
    if (ped) { S.line.push({ ped, slot: c.queue[Math.min(S.line.length + 1, c.queue.length - 1)] }); reslot(); }
  }

  // re-assign every line member to its slot by position (front → back) and hold.
  // The FRONT person steps up to the rope (queue[0]); the rest hold their slot.
  function reslot() {
    const c = S.club; if (!c) return;
    for (let i = 0; i < S.line.length; i++) {
      const slot = c.queue[Math.min(i + 1, c.queue.length - 1)];   // slot 0 is reserved for "at the rope"
      S.line[i].slot = slot;
      holdInLine(S.line[i].ped, i === 0 ? c.queue[0] : slot);
    }
  }

  // ---------- THE GATE for the PLAYER -----------------------------------
  function gatePlayer(dt) {
    const c = S.club; if (!c) return;
    if (S.rejectCD > 0) S.rejectCD -= dt;
    const P = CBZ.player; if (!P || P.dead || P.driving) { setAdmitted(false); return; }
    const door = c.door;
    // are we INSIDE the club footprint? (past the door, into the room)
    const insideD2 = dist2(P.pos.x, P.pos.z, c.insideSpot.x, c.insideSpot.z);
    const inside = insideD2 < 7 * 7;
    if (inside && S.admitted) { perksWhileInside(dt); return; }

    // are we at the ROPE? (just outside the door, where the bouncer stands)
    const ropeD2 = dist2(P.pos.x, P.pos.z, c.bouncerSpot.x, c.bouncerSpot.z);
    if (ropeD2 > 4.2 * 4.2) {
      // wandered off the rope without going in → we're not admitted anymore
      if (!inside) setAdmitted(false);
      return;
    }
    // at the rope and not yet admitted → the bouncer JUDGES YOU
    if (!S.admitted) {
      const drip = playerDrip();
      const need = clubDrip();
      if (drip >= need) admitPlayer(drip);
      else if (S.rejectCD <= 0) rejectPlayer(drip, need);
    } else {
      perksWhileInside(dt);
    }
  }

  function admitPlayer(drip) {
    setAdmitted(true);
    const vip = drip >= vipDrip();
    big(vip ? "WELCOME TO THE VELVET — VIP" : "WELCOME TO THE VELVET");
    if (vip) note("The bouncer unhooks the rope and nods you toward the elite lounge.", 2.2);
    else note('Bouncer: "Welcome to the Velvet, VIP." — the rope opens.', 2.0);
    // one-time entry bonus: drip is a STATUS signal → respect. VIP pays more.
    if (!S.everIn) {
      S.everIn = true;
      if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(vip ? 12 : 6);
      note("You're somebody now.", 1.8);
    }
    S.admitted_vip = vip;
    S.bottleCD = 6;
  }

  function rejectPlayer(drip, need) {
    S.rejectCD = 3.2;
    big("NOT TONIGHT");
    note('"Not in those rags." Come back sharper.', 3.2);
  }

  function setAdmitted(v) {
    if (S.admitted === v) return;
    S.admitted = v;
    if (!v) { S.admitted_vip = false; }
  }

  // ---------- PERKS while you're inside ---------------------------------
  function perksWhileInside(dt) {
    // SAFE HAVEN: cops won't hassle you in here — heat cools fast, and at low
    // stars the club is a hideout (you lose them). The rope is a wall to cops.
    if (CBZ.city && (g.wanted | 0) >= 1) {
      if (CBZ.city.addHeat) CBZ.city.addHeat(-18 * dt);       // bleed heat fast inside
      if ((g.wanted | 0) <= 1 && (g.heat || 0) <= 0 && CBZ.city.clearWanted) {
        CBZ.city.clearWanted();
        note("You melt into the crowd — the heat loses you inside the Velvet.", 2.0);
      }
    }
    // BOTTLE SERVICE: your drip flexes into cash + respect on a slow cadence —
    // the high-rollers inside tip the well-dressed. VIP unlocks a CONNECT lead.
    S.bottleCD -= dt;
    if (S.bottleCD <= 0) {
      S.bottleCD = 14 + Math.random() * 8;
      const drip = playerDrip();
      const flex = Math.round(40 + drip * 12);               // bigger fit → bigger flex
      if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(flex);
      if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(1);
      note("Bottle service — your drip pulls $" + flex + " in tips & a respect nod.", 2.0);
      if (S.admitted_vip) offerConnect();
    }
  }

  // VIP CONNECT: the club is where money MEETS money. Surface a high-roller in
  // the crowd as a recruiting/deal lead — a big earner you can bring on. Cheap:
  // tag the richest nearby civilian as a one-off lead via a note (and, if the
  // recruit hook exists, make them recruitable on contact).
  let _connectCD = 0;
  function offerConnect() {
    if (_connectCD > 0) return;
    _connectCD = 40;
    const peds = CBZ.cityPeds || [];
    let best = null, bw = 0.55;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p || p.dead || p.vendor || p.gang || p.recruited || p === S.bouncer) continue;
      if ((p.wealth || 0) > bw && dist2(p.pos.x, p.pos.z, CBZ.player.pos.x, CBZ.player.pos.z) < 30 * 30) { bw = p.wealth; best = p; }
    }
    if (best) {
      best._clubConnect = true;     // interact.js / your crew code can read this as "rich lead"
      best.tightWithYou = true;     // warmer to recruiting (guarded read elsewhere)
      note("A high-roller in the VIP lounge — " + (best.name || "a big earner") + " — is worth knowing.", 2.4);
    } else {
      note("The VIP lounge is full of money — work the room.", 2.0);
    }
  }

  // ---------- find / build the club for this run ------------------------
  function findClubLot() {
    // prefer the descriptor buildings.js stamps; fall back to scanning lots.
    const arena = (CBZ.city && CBZ.city.arena) || (CBZ.buildCity ? CBZ.buildCity() : null);
    if (!arena) return null;
    if (arena.clubLot && arena.clubLot.building && arena.clubLot.building.club) return arena.clubLot;
    const lots = arena.lots || [];
    for (let i = 0; i < lots.length; i++) {
      const L = lots[i];
      if (L && L.building && L.building.club) return L;
    }
    return null;
  }

  // (re)initialise the club for the current run if needed. Self-heals across
  // runs: when spawnCityPeds() clears the ped pool the old bouncer is gone, so
  // we detect a stale/missing bouncer and rebuild the whole line + doorman.
  function ensure() {
    if (g.mode !== "city") return false;
    const peds = CBZ.cityPeds;
    if (!peds) return false;

    // (A) Establish the club LOT once per run. This is independent of the
    //     bouncer — the line/door logic runs even with the post empty.
    if (!S.club) {
      const lot = findClubLot();
      if (!lot || !lot.building || !lot.building.club || !lot.building.club.queue) return false;
      if (lot !== S.lot) softReset();        // truly a new run / different lot → wipe state
      S.lot = lot; S.club = lot.building.club;
    } else {
      // detect a hard pool wipe (spawnCityPeds cleared everything) → full reset.
      // If the lot descriptor is gone the city was rebuilt under us.
      const lot = findClubLot();
      if (!lot || lot !== S.lot) { softReset(); S.lot = null; S.club = null; return ensure(); }
      S.lot = lot; S.club = lot.building.club;
    }

    // (B) FINITE bouncer. A live bouncer needs nothing.
    const inPool = S.bouncer && peds.indexOf(S.bouncer) !== -1;
    const bouncerLive = inPool && !S.bouncer.dead;
    if (bouncerLive) return true;

    if (S.bouncer) {
      const wasKilled = !!S.bouncer.dead;     // genuinely killed vs vanished from a pool wipe
      S.bouncer = null;
      if (wasKilled) {
        // KILLED — the bouncer is CONSUMED (peds.js cityKillPed already counts the
        // kill against the finite headcount). Leave the post EMPTY rather than
        // cloning instantly: arm the long re-hire clock. This is the fix.
        if (S.bouncerDownT <= 0) S.bouncerDownT = BOUNCER_REHIRE;
        if (!S.unmannedNoted) { S.unmannedNoted = true; note("The Velvet's door stands unmanned tonight.", 2.0); }
      } else if (!inPool) {
        // Bouncer ref went stale WITHOUT a death (the ped pool was wiped for a new
        // run / city rebuild). That's not a kill — restaff immediately, no penalty.
        softReset();
      }
    }

    // No replacement until the long re-hire delay elapses AND the club still has
    // a hire left in its budget. While empty, the club still runs (return true).
    if (S.bouncerDownT > 0) return true;          // post empty — door unguarded for now
    if (S.bouncerHires >= BOUNCER_MAX_HIRES) return true;  // club is out of replacements this run — door stays open forever

    // delay elapsed + budget remains → hire ONE slow replacement.
    makeBouncer();
    if (S.bouncer) { S.bouncerHires++; S.unmannedNoted = false; note("The Velvet hired a new doorman.", 2.0); }
    return true;
  }

  // ---------- reset -----------------------------------------------------
  function softReset() {
    // release line-goers (don't kill them — they're real city peds)
    for (let i = 0; i < S.line.length; i++) { try { release(S.line[i].ped, false); } catch (e) {} }
    S.line.length = 0;
    // the bouncer is owned by the ped pool; if it's still around, free it
    if (S.bouncer) { S.bouncer._clubBouncer = false; S.bouncer.controlled = false; }
    S.bouncer = null;
    S.admitted = false; S.admitted_vip = false; S.everIn = false;
    S.spawnT = 0; S.judgeT = 0; S.rejectCD = 0; S.bottleCD = 0; _connectCD = 0;
    // fresh run → the door is staffed immediately (downT starts at 0) and the
    // hire budget refills, but a KILLED bouncer mid-run still costs the delay.
    S.bouncerDownT = 0; S.bouncerHires = 0; S.unmannedNoted = false;
  }

  CBZ.cityClubReset = function () {
    softReset();
    S.lot = null; S.club = null;
  };

  // ---------- per-frame --------------------------------------------------
  CBZ.onUpdate(36, function (dt) {
    if (g.mode !== "city") return;
    if (g.state && g.state !== "playing") return;     // paused / menu

    // tick the empty-post re-hire clock (a killed bouncer leaves the door empty
    // for BOUNCER_REHIRE seconds — the player can stay ahead of the replacement).
    if (S.bouncerDownT > 0) S.bouncerDownT -= dt;

    if (!ensure()) return;

    holdBouncer();

    // age out "going in" guests (fold them into the club once they reach the door)
    const peds = CBZ.cityPeds || [];
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p || !p._clubGoingIn) continue;
      p._clubGoingIn -= dt;
      if (p._clubGoingIn <= 0 || dist2(p.pos.x, p.pos.z, S.club.insideSpot.x, S.club.insideSpot.z) < 2.5 * 2.5) {
        p._clubGoingIn = 0; p.controlled = false; p._clubLine = false; p.state = "walk";
      }
    }
    // age dejected slump
    for (let i = 0; i < peds.length; i++) { const p = peds[i]; if (p && p._dejectedT > 0) p._dejectedT -= dt; }

    refillLine(dt);
    reslot();
    workTheLine(dt);
    gatePlayer(dt);
  });
})();
