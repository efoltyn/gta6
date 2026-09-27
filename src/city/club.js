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
  // THE SHARED POST (city/occupy.js) — the four lines this file used to write
  // by hand (make ped, parent, roster, stamp the post). Degrade-safe: without
  // occupy.js the inline fallback is the byte-for-byte prior behaviour.
  function post(x, z, o) {
    if (CBZ.cityPostNpc) return CBZ.cityPostNpc(x, z, o);
    if (!CBZ.cityMakePed || !CBZ.cityPeds || !o.parent) return null;
    const p = CBZ.cityMakePed(x, z, o.rng || Math.random, o);
    if (!p) return null;
    if (o.face != null) p.group.rotation.y = o.face;
    o.parent.add(p.group); CBZ.cityPeds.push(p);
    if (o.pin) { p.staffPost = { x: x, z: z, face: o.face || 0 }; p.state = "idle"; p.speed = 0; }
    return p;
  }
  // the door/line cast used raw Math.random — the one determinism outlier the
  // census found in the nine spawners. A named stream costs nothing and makes
  // the same club produce the same doorman on every client.
  const lineRng = (CBZ.seedStream ? CBZ.seedStream("club:cast") : Math.random);

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

  // the bouncer's words go over the bouncer's head; no bouncer, no words
  function bouncerSay(words, secs, force) {
    const b = S.bouncer;
    if (b && !b.dead && CBZ.citySay) CBZ.citySay(b, words, null, { secs: secs || 2.2, force: !!force });
  }
  function note(msg, sec) { if (CBZ.city && CBZ.city.note) CBZ.city.note(msg, sec); }

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
    if (root) {
      const s = club.queue[club.queue.length - 1];
      return post(s.x, s.z, { src: "club:line", parent: root, rng: lineRng });
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
    // `pin` is occupy.js's word for peds.js's OWN staffPost brain: rooted at
    // the spot, facing the street, still gunpoint-aware, still dies through
    // the kill bus — which is exactly what the four hand-written lines below
    // were emulating with `controlled` + a zeroed target.
    // NOT `pin` — holdBouncer() re-plants him with state="walk" when a car or
    // a blast shoves him off the rope, and peds.js's staffPost branch returns
    // from move() before any movement integration, which would strand him
    // wherever he was knocked to. `controlled` already keeps him off the
    // wander path, which is all this post ever needed.
    const ped = post(bs.x, bs.z, {
      src: "club:bouncer", parent: root, rng: lineRng,
      face: bs.face != null ? bs.face : 0, pose: "foldarms",
      name: "Bouncer", kind: "civilian", wealth: 0.6,
      archetype: "merchant", job: "doorman", aggr: 0.5,
      // a big, intimidating doorman who packs heat but doesn't wander
      hp: 200, armed: true, weapon: "Pistol",
    });
    if (!ped) return;
    ped.controlled = true;          // never wanders — the door is the post
    ped._clubBouncer = true;
    ped.nerve = 0.95;
    ped.guard = null; ped.companion = false;
    if (ped.target) ped.target.set(bs.x, 0, bs.z);
    ped.state = "idle"; ped.speed = 0;
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
    } else {
      // TURNED AWAY — the whole point. Dejected walk-off.
      release(p, true);
      bouncerSay("Not tonight.", 1.4);
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
    bouncerSay(vip ? "Lounge is upstairs. Enjoy your night." : "Welcome to the Velvet.", 2.2, true);
    // one-time entry bonus: drip is a STATUS signal → respect. VIP pays more.
    if (!S.everIn) {
      S.everIn = true;
      if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(vip ? 12 : 6);
    }
    S.admitted_vip = vip;
    S.bottleCD = 6;
  }

  function rejectPlayer(drip, need) {
    S.rejectCD = 3.2;
    bouncerSay("Not tonight. Not in those rags.", 2.6, true);
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
        note("You melt into the crowd, the heat loses you inside the Velvet.", 2.0);
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
      note("Bottle service, your drip pulls $" + flex + " in tips & a respect nod.", 2.0);
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
      note("A high-roller in the VIP lounge, " + (best.name || "a big earner") + ", is worth knowing.", 2.4);
    } else {
      note("The VIP lounge is full of money, work the room.", 2.0);
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

  // the door's live bouncer (for other files that want him to speak)
  CBZ.cityClubBouncer = function () { return (S.bouncer && !S.bouncer.dead) ? S.bouncer : null; };
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

  /* ==========================================================================
     THE ROOM PAST THE ROPE (2026-09-27 de-slop). The club used to be glowing
     floor tiles, a lit cube for a mirror ball, blocks for booths and a DJ
     console with two cyan squares for decks, all drawn by buildings.js. The
     whole interior is built here now, lazily, only for the club you are at:
       • the back bar behind the (fit-out clad) counter: fridges with lit
         glass doors, a mirror, three shelves of real bottles, LED under-shelf
         strips; bar stools with a foot ring along the customer face;
       • a raised dance floor of dark glass tiles with dim LED panels in a
         pattern and an aluminium nosing;
       • a box truss over it on drop rods with moving heads and a faceted
         mirror ball;
       • a DJ riser against a side wall: fascia with an LED strip, two decks,
         a mixer, a laptop on a stand, monitor speakers, PA stacks either side;
       • VIP banquettes along the other wall (tufted back, cushion at 0.44,
         round pedestal tables with an ice bucket), high-top tables up front.
     Only screens, lamp lenses, LED strips and fridge interiors glow.
     Everything merges through CBZ.storeFixtureKit into a few meshes.
     ========================================================================== */
  const THREE = window.THREE;

  // ---- SHARED VENUE FIXTURES (casino.js reuses these) -----------------------
  // Both draw in the kit's CURRENT frame: local +X runs along the wall/counter,
  // local +Z faces the room, y is height above the finished floor (the caller
  // frames the kit at floor height).
  const BOTTLES = [0x5a3212, 0x7a4a18, 0x1f4a2a, 0xc9ccc4, 0x3a1a28, 0x8a6a2a, 0x24361e, 0xa8b0b4, 0x4a2410];
  function backBar(k, L, o) {
    o = o || {};
    const H = o.h || 2.4, wood = o.wood || 0x2a1d14, top = o.top || 0x141416, led = o.led || 0xffcf8a;
    const rr = (CBZ.storeFixtureKit && CBZ.storeFixtureKit.rng) ? CBZ.storeFixtureKit.rng(o.seed || 7) : Math.random;
    // under-counter fridges: steel carcass, glass doors lit from inside
    k.box(0, 0.45, 0.24, L, 0.9, 0.48, wood);
    k.box(0, 0.05, 0.49, L, 0.1, 0.02, 0x0e0e10);                                   // kick
    const doors = Math.max(1, Math.floor(L / 0.7));
    for (let i = 0; i < doors; i++) {
      const x = -L / 2 + (i + 0.5) * (L / doors);
      k.box(x, 0.5, 0.485, L / doors - 0.06, 0.66, 0.012, 0x9aa0a6, "metal");      // door frame
      k.box(x, 0.5, 0.49, L / doors - 0.12, 0.58, 0.004, 0xd8ecf2, "glow");          // lit fridge interior
      for (let r = 0; r < 2; r++) for (let j = 0; j < 4; j++)                        // cans/bottles in the fridge
        k.cyl(x - (L / doors) * 0.3 + j * (L / doors) * 0.2, 0.3 + r * 0.28, 0.45, 0.028, 0.028, 0.16, BOTTLES[(i + j + r) % BOTTLES.length], "gloss", 0, 0, 0, 8);
      k.box(x + (L / doors) * 0.38, 0.72, 0.5, 0.015, 0.2, 0.02, 0xc9ced4, "metal"); // handle
    }
    k.box(0, 0.92, 0.25, L + 0.04, 0.04, 0.52, top, "gloss");                        // worktop
    // the mirror and the shelving above it
    k.box(0, (0.95 + H) / 2 + 0.02, 0.012, L, H - 0.95, 0.012, 0x9fb0b8, "metal");
    for (const e of [-1, 1]) k.box(e * (L / 2 + 0.03), (0.95 + H) / 2, 0.14, 0.06, H - 0.9, 0.28, wood);
    k.box(0, H + 0.04, 0.14, L + 0.12, 0.08, 0.3, wood);                            // cornice
    for (let s = 0; s < 3; s++) {
      const y = 1.25 + s * 0.38;
      k.box(0, y, 0.13, L, 0.025, 0.24, 0xcfe4ec, "glass");                        // glass shelf
      k.box(0, y - 0.018, 0.23, L, 0.008, 0.012, led, "glow");                      // LED strip under the front lip
      const n = Math.floor((L - 0.1) / 0.1);
      for (let i = 0; i < n; i++) {
        if (rr() < 0.12) continue;                                                  // the gaps a working bar has
        const x = -L / 2 + 0.08 + i * 0.1 + (rr() - 0.5) * 0.02, tall = 0.18 + rr() * 0.1;
        const c = BOTTLES[Math.floor(rr() * BOTTLES.length)], z = 0.1 + rr() * 0.05;
        k.cyl(x, y + 0.012 + tall / 2, z, 0.032, 0.035, tall, c, "gloss", 0, 0, 0, 7);
        k.cyl(x, y + 0.012 + tall + 0.035, z, 0.011, 0.02, 0.07, c, "gloss", 0, 0, 0, 5);
        k.cyl(x, y + 0.012 + tall + 0.075, z, 0.012, 0.012, 0.014, rr() < 0.5 ? 0xc9a24a : 0x1c1c1e, "metal", 0, 0, 0, 5);
      }
    }
    // glassware stack and a till on the worktop
    for (let i = 0; i < 8; i++) k.cyl(-L / 2 + 0.25 + (i % 4) * 0.09, 0.99 + Math.floor(i / 4) * 0.13, 0.33, 0.035, 0.028, 0.12, 0xdcecf2, "glass", 0, 0, 0, 8);
    k.box(L / 2 - 0.35, 1.02, 0.3, 0.32, 0.16, 0.26, 0x1c1e22, "gloss");
    k.box(L / 2 - 0.35, 1.18, 0.33, 0.28, 0.18, 0.02, 0x2e4a66, "glow", -0.3);
  }
  // a bar stool: five-star base, gas column, foot ring, round cushion. seatY
  // is the cushion TOP (propuse's declared number).
  function barStool(k, x, z, seatY, o) {
    o = o || {};
    const metal = o.metal || 0x2a2c30, pad = o.pad || 0x3a1e1a;
    k.cyl(x, 0.015, z, 0.2, 0.22, 0.03, metal, "metal", 0, 0, 0, 10);
    k.cyl(x, (seatY - 0.08) / 2, z, 0.025, 0.03, seatY - 0.08, 0xc9ced4, "metal");
    k.torus(x, seatY * 0.4, z, 0.17, 0.011, 0xc9ced4, "metal", Math.PI / 2, 0, 0, null, 12);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      k.box(x + Math.cos(a) * 0.085, seatY * 0.4, z + Math.sin(a) * 0.085, 0.17, 0.012, 0.012, 0xc9ced4, "metal", 0, -a, 0);
    }
    k.cyl(x, seatY - 0.06, z, 0.12, 0.1, 0.04, metal, "metal", 0, 0, 0, 10);
    k.cyl(x, seatY - 0.03, z, 0.19, 0.19, 0.06, pad, "solid", 0, 0, 0, 12);
  }
  CBZ.cityVenueFixtures = { backBar: backBar, barStool: barStool, BOTTLES: BOTTLES };

  const ROOM = { built: null, group: null, cols: [], seats: 0, stats: null };
  function roomBounds(b, ox, oz) {
    const wt = b.wt != null ? b.wt : 0.4;
    return { minX: ox - b.w / 2 + wt - 1.2, maxX: ox + b.w / 2 - wt + 1.2, minZ: oz - b.d / 2 + wt - 1.2, maxZ: oz + b.d / 2 - wt + 1.2 };
  }
  function buildRoom(lot) {
    const KIT = CBZ.storeFixtureKit;
    const b = lot.building, c = b.club;
    if (!KIT || !THREE || !c || !c.door || !b.w || !b.d) return false;
    const ox = b.ox != null ? b.ox : lot.cx, oz = b.oz != null ? b.oz : lot.cz;
    const wt = b.wt != null ? b.wt : 0.4;
    const inx = c.door.nx, inz = c.door.nz, tx = -inz, tz = inx;         // INTO the club + the wall tangent
    const along = Math.abs(inx) > 0.5;
    const halfIn = (along ? b.w : b.d) / 2, halfTan = (along ? b.d : b.w) / 2;
    const slab = (Array.isArray(b.floorTops) && b.floorTops[0] != null) ? b.floorTops[0] : 0.14;
    const FF = slab + 0.06;
    const CEIL = ((Array.isArray(b.floorTops) && b.floorTops[1] != null) ? b.floorTops[1] : slab + (b.FH || 4.6)) - 0.212;
    const HROOM = CEIL - FF;
    // (lat, depth-from-door-wall) → world
    const W = function (lat, dep) { return { x: ox + tx * lat + inx * (dep - halfIn), z: oz + tz * lat + inz * (dep - halfIn) }; };
    const yawFace = function (dLat, dDep) { return Math.atan2(tx * dLat + inx * dDep, tz * dLat + inz * dDep); };
    const k = KIT.create();
    const at = function (lat, dep, dLat, dDep) { const p = W(lat, dep); k.frame(p.x, FF, p.z, yawFace(dLat, dDep)); return p; };
    const Tf = halfTan - wt, back = 2 * halfIn - wt;
    const occ = [];
    const take = function (l0, l1, d0, d1) { occ.push([Math.min(l0, l1), Math.max(l0, l1), Math.min(d0, d1), Math.max(d0, d1)]); };
    const free = function (l0, l1, d0, d1) {
      const a0 = Math.min(l0, l1), a1 = Math.max(l0, l1), b0 = Math.min(d0, d1), b1 = Math.max(d0, d1);
      if (a0 < -Tf || a1 > Tf || b0 < wt || b1 > back) return false;
      for (let i = 0; i < occ.length; i++) { const o = occ[i]; if (a1 > o[0] && a0 < o[1] && b1 > o[2] && b0 < o[3]) return false; }
      if (typeof b.clearFloorPoint === "function") {
        const pts = [[(a0 + a1) / 2, (b0 + b1) / 2], [a0, b0], [a1, b0], [a0, b1], [a1, b1]];
        for (let i = 0; i < pts.length; i++) { const p = W(pts[i][0], pts[i][1]); if (!b.clearFloorPoint(p.x - ox, p.z - oz, 0.1)) return false; }
      }
      return true;
    };
    const collide = function (l0, l1, d0, d1, y1) {
      const a = W(l0, d0), q = W(l1, d1);
      const r = { minX: Math.min(a.x, q.x), maxX: Math.max(a.x, q.x), minZ: Math.min(a.z, q.z), maxZ: Math.max(a.z, q.z), y0: 0, y1: FF + y1 };
      if (CBZ.colliders) { CBZ.colliders.push(r); ROOM.cols.push(r); }
    };
    const seat = function (lat, dep, dLat, dDep, kind, h) {
      if (!CBZ.propRegisterSeat) return;
      const p = W(lat, dep);
      if (CBZ.propRegisterSeat(p.x, FF, p.z, yawFace(dLat, dDep), kind, lot, { cushion: h, floorBelow: 0 })) ROOM.seats++;
    };
    // entry lane + fit-out plant/bin inside the door stay clear
    take(-1.3, 1.3, 0, 2.2);

    // ---- THE BAR: the fit-out clads the counter; the back bar and stools are ours
    const C = KIT.counterOf(lot);
    let cFront = back - 3.2;
    if (C) {
      const cLat = (C.x - ox) * tx + (C.z - oz) * tz, cDep = (C.x - ox) * inx + (C.z - oz) * inz + halfIn;
      const hL = (along ? C.d : C.w) / 2, hD = (along ? C.w : C.d) / 2;
      cFront = cDep - hD;
      take(cLat - hL - 0.3, cLat + hL + 0.3, cFront - 0.2, back);           // counter + staff side
      const bbL = Math.min(2 * Tf - 0.4, 2 * hL + 1.0);
      at(cLat, back, 0, -1);
      backBar(k, bbL, { seed: Math.round(ox * 3 + oz), h: Math.min(2.5, HROOM - 0.3), led: 0xffc48a });
      collide(cLat - bbL / 2, cLat + bbL / 2, back - 0.5, back, 2.4);
      const n = Math.max(2, Math.floor((2 * hL - 0.3) / 0.62));
      for (let i = 0; i < n; i++) {
        const la = cLat - hL + 0.3 + (i + 0.5) * ((2 * hL - 0.6) / n);
        const p = W(la, cFront - 0.42);
        k.frame(p.x, FF, p.z, 0);
        barStool(k, 0, 0, 0.78, { pad: 0x5a1422 });
        seat(la, cFront - 0.42, 0, 1, "stool", 0.78);
      }
      take(cLat - hL, cLat + hL, cFront - 0.9, cFront);
    }

    // ---- THE DANCE FLOOR ------------------------------------------------------
    const s = (CBZ.hash01 ? CBZ.hash01(lot.cx, lot.cz, "clubdj") : 0.3) < 0.5 ? -1 : 1;
    const dfH = Math.min(2.4, Tf - 2.3, (cFront - 1.2 - 2.6) / 2);
    let dfD = 0;
    if (dfH >= 1.2) {
      dfD = Math.max(2.6 + dfH, Math.min(halfIn, cFront - 1.4 - dfH));
      const dfL = -s * 0.4;                                                  // shifted off the DJ wall
      if (free(dfL - dfH, dfL + dfH, dfD - dfH, dfD + dfH)) {
        take(dfL - dfH, dfL + dfH, dfD - dfH, dfD + dfH);
        at(dfL, dfD, 0, -1);
        const S2 = dfH * 2, n = Math.max(3, Math.round(S2 / 0.6)), t = S2 / n;
        k.box(0, 0.04, 0, S2, 0.08, S2, 0x121216, "gloss");                 // riser
        const PAL = [0x3a1650, 0x14304a, 0x4a1030, 0x1a3a2a];
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
          const x = -dfH + (i + 0.5) * t, z = -dfH + (j + 0.5) * t;
          const lit = ((i + j) % 3) === 0;
          k.box(x, 0.082, z, t - 0.03, 0.006, t - 0.03, lit ? PAL[(i * 3 + j) % PAL.length] : 0x0c0c10, lit ? "glow" : "gloss");
        }
        for (const e of [-1, 1]) {                                          // aluminium nosing
          k.box(e * dfH, 0.045, 0, 0.03, 0.09, S2 + 0.03, 0xb4b8bd, "metal");
          k.box(0, 0.045, e * dfH, S2 + 0.03, 0.09, 0.03, 0xb4b8bd, "metal");
        }
        // THE TRUSS: a square box truss on four drop rods, moving heads on it,
        // a faceted mirror ball on a chain in the middle
        const tY = Math.min(HROOM - 0.45, 3.4), tH = dfH + 0.2, tw = 0.29;
        if (tY > 2.6) {
          for (const e of [-1, 1]) for (const side of [0, 1]) {
            for (const cy of [-tw / 2, tw / 2]) for (const cz of [-tw / 2, tw / 2]) {
              if (side === 0) k.cyl(e * tH + cz, tY + cy, 0, 0.018, 0.018, 2 * tH + tw, 0xc9ced4, "metal", Math.PI / 2, 0, 0, 6);
              else k.cyl(0, tY + cy, e * tH + cz, 0.018, 0.018, 2 * tH + tw, 0xc9ced4, "metal", 0, 0, Math.PI / 2, 6);
            }
            const segs = Math.round((2 * tH) / tw);
            for (let q = 0; q < segs; q++) {                                 // zig-zag lacing on the two sides
              const u = -tH + (q + 0.5) * (2 * tH / segs), a = (q % 2 ? 1 : -1) * 0.78;
              for (const cz of [-tw / 2, tw / 2]) {
                if (side === 0) k.cyl(e * tH + cz, tY, u, 0.007, 0.007, tw * 1.41, 0xc9ced4, "metal", a, 0, 0, 4);
                else k.cyl(u, tY, e * tH + cz, 0.007, 0.007, tw * 1.41, 0xc9ced4, "metal", 0, 0, a, 4);
              }
            }
          }
          for (const ex of [-1, 1]) for (const ez of [-1, 1]) k.cyl(ex * tH, (tY + HROOM) / 2, ez * tH, 0.012, 0.012, HROOM - tY, 0x6a6e74, "metal", 0, 0, 0, 6);
          const heads = [[-1, 0], [1, 0], [0, -1], [0, 1]];
          const lens = [0xff4fa8, 0x4fb8ff, 0xb07cff, 0xffd46a];
          heads.forEach(function (h, i) {
            const hx = h[0] * tH, hz = h[1] * tH, yb = tY - tw / 2;
            k.box(hx, yb - 0.04, hz, 0.24, 0.06, 0.2, 0x1a1b1e, "gloss");                 // base
            for (const e of [-1, 1]) k.box(hx + e * 0.11, yb - 0.17, hz, 0.03, 0.22, 0.08, 0x1a1b1e, "gloss");   // yoke
            const tilt = 0.6;
            k.cyl(hx, yb - 0.24, hz, 0.085, 0.1, 0.26, 0x1a1b1e, "gloss", -h[1] * tilt, 0, h[0] * tilt, 12);
            k.cyl(hx - h[0] * 0.08, yb - 0.35, hz - h[1] * 0.08, 0.07, 0.07, 0.01, lens[i], "glow", -h[1] * tilt, 0, h[0] * tilt, 12);
          });
          k.cyl(0, (tY - 0.25 + HROOM) / 2, 0, 0.004, 0.004, HROOM - tY + 0.25, 0x9aa0a6, "metal", 0, 0, 0, 4);   // ball chain
          const ball = new THREE.IcosahedronGeometry(0.2, 2);
          ball.computeVertexNormals();                                                 // flat facets, not a smooth blob
          k.push(ball, 0xd8dde4, "metal", 0, tY - 0.45, 0);
        }
      }
    }

    // ---- THE DJ RISER + PA -----------------------------------------------------
    const djLat = s * (Tf - 0.75), djDep = dfD || Math.max(3.5, cFront - 2.5);
    if (free(djLat - 0.75, djLat + 0.75, djDep - 1.6, djDep + 1.6)) {
      take(djLat - 0.75, djLat + 0.75, djDep - 1.6, djDep + 1.6);
      at(djLat, djDep, -s, 0);                                               // faces the floor
      k.box(0, 0.15, 0, 2.0, 0.3, 1.4, 0x141416, "gloss");                    // riser
      k.box(0, 0.62, 0.36, 1.9, 0.64, 0.08, 0x1c1c20, "gloss");              // fascia
      k.box(0, 0.36, 0.405, 1.86, 0.012, 0.008, 0x8a4fff, "glow");            // LED strip in the fascia reveal
      k.box(0, 0.96, 0.2, 1.9, 0.04, 0.46, 0x222226, "gloss");               // desk
      for (const e of [-0.52, 0.52]) {                                        // two decks
        k.box(e, 1.0, 0.18, 0.34, 0.05, 0.4, 0x151517, "gloss");
        k.cyl(e, 1.03, 0.22, 0.11, 0.11, 0.012, 0x3a3c40, "metal", 0, 0, 0, 20);
        k.torus(e, 1.037, 0.22, 0.11, 0.004, 0x39d0ff, "glow", Math.PI / 2, 0, 0, null, 20);
        k.box(e, 1.03, 0.04, 0.12, 0.004, 0.07, 0x2e4a66, "glow");           // deck screen
      }
      k.box(0, 1.01, 0.18, 0.3, 0.07, 0.38, 0x151517, "gloss");              // mixer
      for (let i = 0; i < 4; i++) k.box(-0.1 + i * 0.066, 1.05, 0.26, 0.01, 0.012, 0.07, 0xc9ced4, "metal");   // faders
      k.box(0, 1.1, -0.02, 0.26, 0.2, 0.03, 0x2a2c30, "metal", -0.3);        // laptop stand + lid
      k.box(0, 1.1, -0.005, 0.24, 0.16, 0.004, 0x3a5a7a, "glow", -0.3);
      for (const e of [-0.85, 0.85]) {                                        // monitor speakers on the desk ends
        k.box(e, 1.16, 0.1, 0.18, 0.28, 0.2, 0x151517, "gloss");
        k.cyl(e, 1.12, 0.205, 0.06, 0.06, 0.01, 0x2a2c30, "metal", Math.PI / 2, 0, 0, 12);
      }
      collide(djLat - 0.75, djLat + 0.75, djDep - 1.0, djDep + 1.0, 1.1);
      for (const e of [-1.35, 1.35]) {                                       // PA stacks either side of the riser
        const sub = W(djLat, djDep + e);
        k.frame(sub.x, FF, sub.z, yawFace(-s, 0));
        k.box(0, 0.3, 0, 0.6, 0.6, 0.6, 0x141416, "gloss");
        k.cyl(0, 0.3, 0.301, 0.22, 0.22, 0.01, 0x2a2c30, "metal", Math.PI / 2, 0, 0, 18);
        k.box(0, 1.05, 0, 0.44, 0.9, 0.44, 0x141416, "gloss");
        for (const y of [0.8, 1.2]) k.cyl(0, y, 0.221, 0.13, 0.13, 0.01, 0x2a2c30, "metal", Math.PI / 2, 0, 0, 16);
        k.box(0, 1.42, 0.221, 0.2, 0.08, 0.01, 0x2a2c30, "metal");
        collide(djLat - 0.3, djLat + 0.3, djDep + e - 0.3, djDep + e + 0.3, 1.5);
      }
    }

    // ---- VIP BANQUETTES along the other wall ------------------------------------
    const vs = -s, bLat = vs * (Tf - 0.36);
    for (let d = 2.8; d + 1.0 < cFront - 0.4; d += 2.5) {
      if (!free(vs * (Tf - 0.02), vs * (Tf - 1.9), d - 1.0, d + 1.0)) continue;
      take(vs * (Tf - 0.02), vs * (Tf - 1.9), d - 1.0, d + 1.0);
      at(bLat, d, -vs, 0);                                                  // faces the room
      k.box(0, 0.19, 0, 1.9, 0.38, 0.62, 0x1c1418);                          // plinth
      k.box(0, 0.41, 0.03, 1.86, 0.06, 0.58, 0x6a1622);                      // seat cushion (top 0.44)
      k.box(0, 0.72, -0.26, 1.9, 0.62, 0.14, 0x5a121c);                       // tall back
      for (let i = 0; i < 6; i++) for (let r = 0; r < 2; r++)                // buttoned tufting
        k.box(-0.8 + i * 0.32, 0.6 + r * 0.22, -0.188, 0.022, 0.022, 0.006, 0x3a0a12, "solid", 0, 0, 0.785);
      k.box(0, 1.05, -0.26, 1.96, 0.04, 0.18, 0xb08a4a, "metal");            // brass capping
      for (const e of [-1, 1]) k.box(e * 0.97, 0.34, 0, 0.06, 0.68, 0.62, 0x1c1418);   // end arms
      for (const e of [-0.45, 0.45]) seat(bLat - vs * 0.03, d + e, -vs, 0, "booth", 0.44);
      // the round table in front: pedestal, disc top, ice bucket + a bottle
      k.cyl(0, 0.02, 0.75, 0.22, 0.24, 0.04, 0x1a1a1c, "metal", 0, 0, 0, 16);
      k.cyl(0, 0.3, 0.75, 0.035, 0.035, 0.56, 0xb08a4a, "metal", 0, 0, 0, 10);
      k.cyl(0, 0.6, 0.75, 0.36, 0.36, 0.03, 0x121214, "gloss", 0, 0, 0, 22);
      k.cyl(0.08, 0.7, 0.72, 0.09, 0.07, 0.17, 0xc9ced4, "metal", 0, 0, 0, 14);
      k.cyl(0.08, 0.78, 0.72, 0.03, 0.035, 0.26, 0x1f4a2a, "gloss", 0.18, 0, 0, 8);
      for (const e of [-0.14, -0.22]) k.cyl(e, 0.66, 0.84, 0.03, 0.022, 0.1, 0xdcecf2, "glass", 0, 0, 0, 8);
      collide(bLat - vs * 0.5, bLat - vs * 1.0, d - 0.25, d + 0.25, 0.62);
    }

    // ---- HIGH-TOP TABLES by the front ------------------------------------------
    for (const e of [-1, 1]) {
      const hl = e * Math.min(Tf - 1.2, 2.6), hd = 3.0;
      if (!free(hl - 0.45, hl + 0.45, hd - 0.45, hd + 0.45)) continue;
      take(hl - 0.45, hl + 0.45, hd - 0.45, hd + 0.45);
      at(hl, hd, 0, -1);
      k.cyl(0, 0.015, 0, 0.24, 0.26, 0.03, 0x1a1a1c, "metal", 0, 0, 0, 16);
      k.cyl(0, 0.53, 0, 0.03, 0.03, 1.0, 0xc9ced4, "metal", 0, 0, 0, 10);
      k.cyl(0, 1.05, 0, 0.32, 0.32, 0.03, 0x121214, "gloss", 0, 0, 0, 20);
      k.cyl(0.08, 1.12, 0.05, 0.03, 0.022, 0.11, 0xdcecf2, "glass", 0, 0, 0, 8);
      collide(hl - 0.25, hl + 0.25, hd - 0.25, hd + 0.25, 1.07);
    }

    const group = new THREE.Group();
    const root = (CBZ.city && CBZ.city.arena && CBZ.city.arena.root) || CBZ.scene;
    if (!root) return false;
    k.build(group);
    root.add(group);
    ROOM.group = group;
    ROOM.bounds = roomBounds(b, ox, oz);
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    if (CBZ.interiorTrackFixture) CBZ.interiorTrackFixture("velvet-club", b, group);
    let meshes = 0, verts = 0;
    group.traverse(function (o) { if (o.isMesh) { meshes++; verts += o.geometry.attributes.position.count; } });
    ROOM.stats = { meshes: meshes, verts: verts, seats: ROOM.seats, danceFloor: dfD > 0 };
    return true;
  }
  CBZ.onUpdate(36.1, function () {
    if (!g || g.mode !== "city") { if (ROOM.group) ROOM.group.visible = false; return; }
    const arena = CBZ.city && CBZ.city.arena;
    if (!arena) return;
    if (ROOM.built && ROOM.built !== arena) { ROOM.built = null; ROOM.group = null; ROOM.cols = []; ROOM.seats = 0; }
    const P = CBZ.player; if (!P || !P.pos) return;
    const lot = arena.clubLot;
    if (!lot || !lot.building || !lot.building.club) return;
    if (!ROOM.built) {
      const dx = P.pos.x - lot.cx, dz = P.pos.z - lot.cz;
      if (dx * dx + dz * dz > 45 * 45) return;
      ROOM.built = arena;
      try { buildRoom(lot); } catch (e) { /* the rope still works without the room */ }
    }
    // only drawn with you in (or at the door of) the shell: r128 does not cull
    // a lit truss behind an opaque facade
    if (ROOM.group && ROOM.bounds) {
      const B = ROOM.bounds, x = P.pos.x, z = P.pos.z;
      const vis = x >= B.minX && x <= B.maxX && z >= B.minZ && z <= B.maxZ;
      if (ROOM.group.visible !== vis) ROOM.group.visible = vis;
    }
  });
  // EXPORT ONLY (probe/preset): what the room stands
  CBZ.cityClubRoomAudit = function () { return ROOM.stats ? Object.assign({ built: !!ROOM.group }, ROOM.stats) : null; };
})();
