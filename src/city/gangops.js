/* ============================================================
   city/gangops.js — GANGS DO THINGS (C8: the WHY behind held turf).

   The complaint: a crew just HANGS in its building — the members idle at
   their guard point and only ever move when a rival or the player crosses
   the block. Owned turf should read as CONTROLLED and DANGEROUS: money
   moving, people pressured, a beat being walked — not a static hangout.

   So this module hands calm members on turf VISIBLE OPS, driven the exact
   same way gangs.js raids/war-shape drive a body: by writing the fields the
   universal ped brain (peds.js) already honors — ped.guard (the brain leashes
   a gangster to it and re-targets within ~7m), ped.target / ped.state /
   ped.pause, and a transient ped._op tag that THIS file owns. Nothing here
   touches peds.js, and every op SUSPENDS itself the instant the member has a
   real reason to fight/flee (rage, raid, war-shape role, KO, in a car), then
   restores the member's homeGuard — so ops never override combat, and the
   existing raidT / homeGuard return infra cleans up after us for free.

     • PATROL — a couple of members walk a slow beat around the turf (their
       guard point orbits the block) instead of standing on one spot.
     • DEAL — one member is designated DEALER and posts at a corner of the
       turf. Periodically an ambient passer-by (a reused nearby civilian, no
       spawn) walks up for a brief hand-to-hand exchange: the crew banks a
       little money + standing, and a deal in the open draws a little heat
       (the existing witness/cityCrime path). One grabbable cash stack sits at
       the dealer's feet during the exchange — the player can walk up and ROB
       it (which spooks the dealer + buyer and provokes the crew).
     • EXTORT — a member occasionally walks up to a civilian/shopkeeper ON the
       turf and leans on them. The mark shows fear / hands-up and PAYS (the
       crew banks the shakedown). Civilian fear at large is A3's job (peds.js
       gang-fear scan) — here we just stage the face-to-face shake so the
       tension is visible and the money is real.

   City-mode only; MP-safe (host simulates, guests puppet — bail under the net
   noSim guard so two machines never double-drive the same ops). Cadenced over
   the gang rosters (a few hundred cheap reads), never per-frame-per-actor; the
   visible theatre (barks, cash mesh, buyer walk-ups) only fires near the player.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;
  const cmat = CBZ.cmat || CBZ.mat || function (c) { return new THREE.MeshLambertMaterial({ color: c }); };

  // own RNG stream so we never perturb gangs.js's deterministic spawn rng
  let _s = 0x5c0ef1;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }
  function pick(a) { return a[(rng() * a.length) | 0]; }

  // ---- guards / small helpers --------------------------------------------
  function inCity() { return g && g.mode === "city"; }
  function noSim() { return CBZ.net && CBZ.net.noSim && CBZ.net.noSim(); }
  function arena() { return CBZ.city && CBZ.city.arena; }
  function clampSpot(p) { const A = arena(); if (A && A.clampToCity) A.clampToCity(p, 1.5); return p; }
  function nearPlayer(x, z, r) {
    const P = CBZ.player; if (!P || !P.pos || P.dead) return false;
    const dx = P.pos.x - x, dz = P.pos.z - z; return dx * dx + dz * dz < r * r;
  }
  // a member is FREE for an op only when nothing more urgent owns it. War / raids /
  // reprisals / war-shape roles / a live rage mark / KO / a car all out-rank an op,
  // and we never pull the boss off his post (he anchors the HQ + succession).
  function opFree(m) {
    if (!m || m.dead || m.ko > 0 || m.inCar || m.companion || m.controlled) return false;
    if (m.isBoss || m.rank === "boss" || m.surrender) return false;
    if (m.rage || m.hunting) return false;
    if (m.state === "fight" || m.state === "flee" || m.state === "confront") return false;
    if (m._wRole) return false;            // gangs.js war-shape owns this body
    if ((m.raidT || 0) > 0 || m.raidGang) return false;  // out on a raid / heading home from one
    return true;
  }
  // tag a body as on an op + remember the post we'll loiter at (the brain leashes
  // to ped.guard, so the op IS a guard point we move). homeGuard is already set at
  // spawn (gangs.js); fall back to the current guard so endOp always has a home.
  function startOp(m, role, secs) {
    if (!m.homeGuard && m.guard) m.homeGuard = { x: m.guard.x, z: m.guard.z };
    m._op = { role: role, until: secs };
  }
  // release an op: walk the member back to its home post and let the brain take
  // over. Mirrors the raidT return in gangs.js (guard ← homeGuard, fresh target).
  function endOp(m) {
    if (!m || !m._op) return;
    m._op = null;
    if (m.dead) return;
    if (m.homeGuard) {
      m.guard = { x: m.homeGuard.x, z: m.homeGuard.z };
      if (m.target && m.target.set) m.target.set(m.guard.x, 0, m.guard.z);
    }
    m.pause = 0; m.path = null;
    if (m.state === "walk" || m.state === "idle") { /* let the brain re-pick from home */ }
  }

  // a short human bark over a member, per-gang throttled, near-player only (no
  // off-screen theatre). Mirrors gangs.js wbark cadence so the two never spam.
  function opBark(gang, m, lines) {
    if (!m || m.dead || !CBZ.citySay) return;
    if (gang && (gang._opBarkT || 0) > 0) return;
    if (!nearPlayer(m.pos.x, m.pos.z, 60)) return;
    if (gang) gang._opBarkT = 5 + rng() * 3;
    CBZ.citySay(m, "“" + pick(lines) + "”", m.tagColor || "#ffb37b", 2.2);
  }

  // ---- turf POSTS: where a dealer stands / a beat is walked --------------
  // Prefer the gangs.js-exported op-spot helper (corner posts derived from the
  // crew's held lots); fall back to deriving them here from gang.turf so this
  // module still works if loaded against an older gangs.js. Cached per gang.
  function opSpots(gang) {
    if (gang._opSpots && gang._opSpotsTurf === gang.turf.length) return gang._opSpots;
    let spots = null;
    if (CBZ.cityGangOpSpots) spots = CBZ.cityGangOpSpots(gang.id);
    if (!spots || !spots.length) {
      spots = [];
      for (const lot of gang.turf) {
        // the four lot corners pulled a touch inward = believable "post on the
        // corner" spots that sit on the sidewalk, not mid-facade.
        const hw = (lot.w || 16) / 2 - 1.5, hd = (lot.d || 16) / 2 - 1.5;
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          spots.push(clampSpot({ x: lot.cx + sx * hw, z: lot.cz + sz * hd }));
        }
      }
    }
    gang._opSpots = spots; gang._opSpotsTurf = gang.turf.length;
    return spots;
  }

  // ============================================================
  //  DEAL — a corner dealer + ambient buyers + a robbable cash stack
  // ============================================================
  const DEAL_BARK = ["What you need?", "I got that, fam.", "Twenties, fifties — say it.", "Step up, don't loiter."];
  const BUYER_BARK = ["You holding?", "Let me get a twenty.", "Hook me up, man.", "Same as last time."];

  // the grabbable cash stack that appears on the desk/ground during an exchange.
  // ONE at a time city-wide (cheap), placed at the live dealer's feet, grabbed on
  // walk-over by the player. Mirrors officejobs.js's cash carrot exactly.
  let cashMesh = null, cashX = 0, cashZ = 0, cashY = 0, cashAmt = 0, cashGang = null;
  function root() { return (arena() && arena().root) || CBZ.scene; }
  function dropCash() {
    if (cashMesh) { if (cashMesh.parent) cashMesh.parent.remove(cashMesh); cashMesh = null; }
    cashGang = null; cashAmt = 0;
  }
  function placeCash(x, y, z, amt, gang) {
    dropCash();
    const grp = new THREE.Group();
    const bill = new THREE.Mesh(CBZ.boxGeom ? CBZ.boxGeom(0.24, 0.06, 0.13) : new THREE.BoxGeometry(0.24, 0.06, 0.13), cmat(0x3f7d4f));
    bill.castShadow = false; bill.receiveShadow = false;
    const band = new THREE.Mesh(CBZ.boxGeom ? CBZ.boxGeom(0.25, 0.065, 0.04) : new THREE.BoxGeometry(0.25, 0.065, 0.04), cmat(0xd9c25a));
    band.position.y = 0.001;
    grp.add(bill, band);
    grp.position.set(x, (y || 0) + 0.12, z);
    root().add(grp);
    cashMesh = grp; cashX = x; cashZ = z; cashY = y || 0; cashAmt = amt; cashGang = gang;
  }

  // a live dealer is a member tagged role==="deal" who's still posted + alive.
  function liveDealer(gang) {
    const m = gang._dealer;
    if (!m || m.dead || m.ko > 0 || !m._op || m._op.role !== "deal") { gang._dealer = null; return null; }
    return m;
  }

  // designate a dealer + post him at a turf corner. He just stands the corner
  // (guard point = the post); the brain holds him there. WHY: a posted dealer is
  // a fixed, robbable money node the player learns to recognise on a block.
  function ensureDealer(gang) {
    if (liveDealer(gang)) return gang._dealer;
    // pick a calm, low/mid-rank member to run the corner (not a leader/boss)
    let best = null;
    for (const m of gang.members) {
      if (!opFree(m)) continue;
      const t = m.rank === "lt" || m.rank === "enforcer";
      if (t) continue;
      best = m; if (rng() < 0.5) break;   // a little spread in who gets picked
    }
    if (!best) return null;
    const spots = opSpots(gang);
    if (!spots.length) return null;
    const post = spots[(rng() * spots.length) | 0];
    startOp(best, "deal", 40 + rng() * 30);
    best._dealPost = { x: post.x, z: post.z };
    best.guard = { x: post.x, z: post.z };
    best.pause = 0; best.path = null; best.state = "walk";
    if (best.target && best.target.set) best.target.set(post.x, 0, post.z);
    gang._dealer = best;
    return best;
  }

  // send a nearby ordinary civilian to the dealer for a quick buy. Reuses an
  // EXISTING passer-by (no spawn, no pool growth) — a real person walking up,
  // then peeling off. Returns true if a buyer was dispatched.
  function dispatchBuyer(gang, dealer) {
    if (gang._buyer && !gang._buyer.dead && gang._buyer._op && gang._buyer._op.role === "buy") return false; // one at a time
    const peds = CBZ.cityPeds; if (!peds) return false;
    let best = null, bd = 26 * 26;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p || p.dead || p.ko > 0) continue;
      if (p.kind !== "civilian" || p.vendor || p.gang) continue;
      if (p.recruited || p.companion || p.controlled || p.vagrant) continue;
      if (p.rage || p.surrender || p.reportState) continue;
      if (p.state === "flee" || p.state === "fight" || p.state === "sit") continue;
      if ((p.fear || 0) > 2) continue;                  // a scared person isn't shopping
      if (p._officeJob || (p.finalGoal && p.finalGoal.sitDesk)) continue;  // don't yank a worker off the job
      const dx = p.pos.x - dealer.pos.x, dz = p.pos.z - dealer.pos.z, d2 = dx * dx + dz * dz;
      if (d2 < 4 * 4) continue;                          // already on top of him
      if (d2 < bd) { bd = d2; best = p; }
    }
    if (!best) return false;
    best._op = { role: "buy", until: 12, dealerGang: gang.id, _ret: { x: best.target ? best.target.x : best.pos.x, z: best.target ? best.target.z : best.pos.z } };
    best._buyT = 0;
    best.state = "walk"; best.pause = 0; best.path = null;
    if (best.target && best.target.set) best.target.set(dealer.pos.x, 0, dealer.pos.z);
    gang._buyer = best;
    return true;
  }

  // advance a buyer: walk in, do the hand-to-hand, peel off. Settling the deal
  // banks the crew + draws a little heat + drops the robbable cash stack.
  function tickBuyer(buyer, dt) {
    const op = buyer._op; if (!op || op.role !== "buy") return;
    const gang = CBZ.cityGangById ? CBZ.cityGangById(op.dealerGang) : null;
    const dealer = gang ? liveDealer(gang) : null;
    op.until -= dt;
    // dealer gone / busy / buyer scared off → abort, send the buyer on their way
    if (!dealer || op.until <= 0 || buyer.rage || (buyer.fear || 0) > 3 || buyer.state === "flee") {
      buyer._op = null;
      if (op._ret && buyer.target && buyer.target.set && !buyer.dead && buyer.state !== "flee") {
        buyer.state = "walk"; buyer.pause = 0; buyer.target.set(op._ret.x, 0, op._ret.z);
      }
      return;
    }
    const dd = Math.hypot(buyer.pos.x - dealer.pos.x, buyer.pos.z - dealer.pos.z);
    if (dd > 2.4) {
      // still walking in — keep the mark fresh (dealer may drift on his corner)
      buyer.state = "walk"; buyer.pause = 0;
      if (buyer.target && buyer.target.set) buyer.target.set(dealer.pos.x, 0, dealer.pos.z);
      return;
    }
    // in range → the brief exchange: both pause + face each other
    buyer._buyT = (buyer._buyT || 0) + dt;
    buyer.speed = 0; buyer.pause = Math.max(buyer.pause || 0, 0.5);
    buyer.state = "idle";
    if (buyer.group) buyer.group.rotation.y = Math.atan2(dealer.pos.x - buyer.pos.x, dealer.pos.z - buyer.pos.z);
    if (dealer.group) dealer.group.rotation.y = Math.atan2(buyer.pos.x - dealer.pos.x, buyer.pos.z - dealer.pos.z);
    if (!op.greeted) { op.greeted = true; opBark(gang, buyer, BUYER_BARK); }
    if (buyer._buyT >= 1.4 && !op.done) {
      op.done = true;
      settleDeal(gang, dealer, buyer);
      // peel off and go about their day
      buyer._op = null;
      if (op._ret && buyer.target && buyer.target.set) { buyer.state = "walk"; buyer.pause = 0; buyer.target.set(op._ret.x, 0, op._ret.z); }
    }
  }

  // the money changes hands: the crew banks it (treasury + standing nudge), the
  // dealer keeps a corner take, and a deal in the open draws a little heat
  // through the EXISTING witness path. Drops a robbable cash stack at his feet.
  function settleDeal(gang, dealer, buyer) {
    const take = 30 + ((rng() * 70) | 0);
    if (gang) {
      gang.treasury = Math.min(8000, (gang.treasury || 0) + take);
      if (CBZ.cityMemberStats) { const s = CBZ.cityMemberStats(dealer); s.contrib = (s.contrib || 0) + take * 0.5; s.loyalty = Math.min(1, (s.loyalty || 0.5) + 0.01); }
    }
    opBark(gang, dealer, DEAL_BARK);
    // the cash carrot: a grabbable stack the player can rob (one city-wide)
    if (nearPlayer(dealer.pos.x, dealer.pos.z, 55)) {
      placeCash(dealer.pos.x, dealer.pos.y || 0, dealer.pos.z, take + 20 + ((rng() * 60) | 0), gang);
    }
    // a hand-to-hand in the street is a crime witnesses can phone in (low heat).
    if (CBZ.cityCrime) CBZ.cityCrime(18, { x: dealer.pos.x, z: dealer.pos.z, type: "dealing" });
  }

  // ============================================================
  //  EXTORT — a member leans on a civilian/shopkeeper on the turf
  // ============================================================
  const EXTORT_BARK = ["This block's ours — pay up.", "Protection ain't free.", "You owe rent on this corner.", "Hand it over, we'll keep you safe."];

  // find a civilian standing on the gang's turf to shake down.
  function extortMark(gang) {
    const peds = CBZ.cityPeds; if (!peds) return null;
    let best = null, bd = 16 * 16;
    const cx = gang.center.x, cz = gang.center.z;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p || p.dead || p.ko > 0 || p.gang) continue;
      if (p.kind !== "civilian" && p.kind !== "vendor") continue;
      if (p.recruited || p.companion || p.controlled) continue;
      if (p.rage || p.surrender || p.reportState) continue;
      if (p.armed) continue;                              // don't pick on someone strapped
      // must be ON the turf (near a held lot), not just near the centroid
      let onTurf = false;
      for (const lot of gang.turf) { const dx = p.pos.x - lot.cx, dz = p.pos.z - lot.cz; if (dx * dx + dz * dz < 11 * 11) { onTurf = true; break; } }
      if (!onTurf) continue;
      const dx = p.pos.x - cx, dz = p.pos.z - cz, d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = p; }
    }
    return best;
  }

  // pick a member to run the shake + send them at the mark.
  function ensureExtort(gang) {
    if (gang._extorter && !gang._extorter.dead && gang._extorter._op && gang._extorter._op.role === "extort") return false;
    const mark = extortMark(gang);
    if (!mark) return false;
    let runner = null, bd = 22 * 22;
    for (const m of gang.members) {
      if (!opFree(m)) continue;
      if (m.rank === "lt") continue;                      // a runner/soldier/enforcer does collections
      const dx = m.pos.x - mark.pos.x, dz = m.pos.z - mark.pos.z, d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; runner = m; }
    }
    if (!runner) return false;
    startOp(runner, "extort", 16 + rng() * 8);
    runner._exMark = mark; runner._exT = 0; runner._exDone = false;
    runner.guard = { x: mark.pos.x, z: mark.pos.z };
    runner.state = "walk"; runner.pause = 0; runner.path = null;
    if (runner.target && runner.target.set) runner.target.set(mark.pos.x, 0, mark.pos.z);
    gang._extorter = runner;
    return true;
  }

  // advance one extortion: close on the mark, then stage the shake (the mark
  // shows fear / hands-up and PAYS). Aborts cleanly if the mark dies / flees far.
  function tickExtort(gang, m, dt) {
    const op = m._op; if (!op || op.role !== "extort") return;
    const mark = m._exMark;
    op.until -= dt;
    if (!mark || mark.dead || mark.ko > 0 || op.until <= 0) { m._exMark = null; endOp(m); gang._extorter = null; return; }
    const dd = Math.hypot(m.pos.x - mark.pos.x, m.pos.z - mark.pos.z);
    if (dd > 6) { m._exMark = null; endOp(m); gang._extorter = null; return; }   // mark walked off — give it up
    if (dd > 2.0) {
      m.guard = { x: mark.pos.x, z: mark.pos.z };
      m.state = "walk"; m.pause = 0;
      if (m.target && m.target.set) m.target.set(mark.pos.x, 0, mark.pos.z);
      return;
    }
    // in his face → the shake. Hold both, face off, spike the mark's fear and put
    // his hands up (the same transient pose fields the gunpoint path uses), then
    // the crew banks the shakedown. Civilian fear at large is A3's; this is just
    // the staged face-to-face so the tension + money are visible/real.
    m.speed = 0; m.pause = Math.max(m.pause || 0, 0.5); m.state = "idle";
    if (m.group) m.group.rotation.y = Math.atan2(mark.pos.x - m.pos.x, mark.pos.z - m.pos.z);
    mark.fear = Math.min(10, (mark.fear || 0) + 5);
    mark.alarmed = Math.max(mark.alarmed || 0, 4);
    mark.surrenderT = Math.max(mark.surrenderT || 0, 1.0);
    mark.surrender = true; mark.state = "surrender"; mark.speed = 0;
    mark.pause = Math.max(mark.pause || 0, 0.5);
    mark.poseHandsUp = true; mark.poseAimBack = false;
    mark.rage = null;
    if (mark.group) mark.group.rotation.y = Math.atan2(m.pos.x - mark.pos.x, m.pos.z - mark.pos.z);
    m._exT = (m._exT || 0) + dt;
    if (!op.barked) { op.barked = true; opBark(gang, m, EXTORT_BARK); }
    if (m._exT >= 1.4 && !m._exDone) {
      m._exDone = true;
      const take = 20 + ((rng() * 60) | 0);
      if (gang) {
        gang.treasury = Math.min(8000, (gang.treasury || 0) + take);
        if (CBZ.cityMemberStats) { const s = CBZ.cityMemberStats(m); s.contrib = (s.contrib || 0) + take * 0.6; }
      }
      // it's still extortion — a witness can phone it in (low heat, existing path)
      if (CBZ.cityCrime) CBZ.cityCrime(16, { x: mark.pos.x, z: mark.pos.z, type: "extortion" });
      if (CBZ.cityFeed && nearPlayer(mark.pos.x, mark.pos.z, 55) && rng() < 0.5) {
        try { CBZ.cityFeed("💰 " + gang.name + " is shaking down the block", "#ffce8f"); } catch (e) {}
      }
      // mark paid — let them off, they hurry away once the pose relaxes
      m._exMark = null; endOp(m); gang._extorter = null;
    }
  }

  // ============================================================
  //  PATROL — a couple of members walk a beat around the turf
  // ============================================================
  // assign / refresh a patroller's beat: orbit the turf by stepping the guard
  // point around the crew centre. The brain walks them toward guard, so a slowly
  // rotating guard point = a member pacing the block.
  function stepPatrol(gang, m, dt) {
    const op = m._op;
    op.until -= dt;
    if (op.until <= 0) { endOp(m); return; }
    op.ang = (op.ang || rng() * 6.28) + dt * (op.dir || 1) * 0.5;   // slow orbit
    const R = op.radius || (gang._patrolR || 12);
    const gx = gang.center.x + Math.cos(op.ang) * R;
    const gz = gang.center.z + Math.sin(op.ang) * R;
    const p = clampSpot({ x: gx, z: gz });
    m.guard = { x: p.x, z: p.z };
    // only nudge the target when they've drifted (let the brain's own loiter run)
    if (Math.hypot(m.pos.x - p.x, m.pos.z - p.z) > 6) {
      m.state = "walk"; m.pause = 0; m.path = null;
      if (m.target && m.target.set) m.target.set(p.x, 0, p.z);
    }
  }

  // how big a beat this crew walks — radius spanning its held block(s)
  function patrolRadius(gang) {
    let r = 9;
    for (const lot of gang.turf) {
      const dx = lot.cx - gang.center.x, dz = lot.cz - gang.center.z;
      r = Math.max(r, Math.hypot(dx, dz) + Math.max(lot.w || 16, lot.d || 16) * 0.4);
    }
    return Math.min(26, r);
  }

  // ============================================================
  //  THE DIRECTOR — one cadenced pass per crew
  // ============================================================
  function runGangOps(gang, dt) {
    if (!gang || gang.isPlayer || gang.absorbed || !gang.turf.length) return;
    if ((gang._opBarkT || 0) > 0) gang._opBarkT -= dt;
    // a crew that's at war / hot / being raided drops ALL ops and fights — peace-
    // time activity has no place mid-gunfight (and war-shape needs the bodies).
    const atWar = (gang.warRemain || 0) > 0 || (gang.provoke || 0) > 0.4 || (gang.hostility || 0) >= 1.5;
    gang._patrolR = patrolRadius(gang);

    // first sweep: tend members already ON an op, and count live patrollers.
    let patrolling = 0, dealing = false;
    for (const m of gang.members) {
      if (!m || !m._op) continue;
      // an op-tagged member who got pulled into a fight / raid / war role, or whose
      // crew just went to war: drop the op. If combat now OWNS him (opFree false),
      // leave his guard/target where they are (the fight/raid set them). If he's
      // still free (the crew merely went hot), walk him HOME so he doesn't linger
      // on a deal corner / orbit point.
      if (!opFree(m) || atWar) {
        const role = m._op.role, free = opFree(m);
        if (role === "deal") gang._dealer = null;
        if (role === "extort") { m._exMark = null; gang._extorter = null; }
        if (free) endOp(m); else m._op = null;
        continue;
      }
      const role = m._op.role;
      if (role === "patrol") { stepPatrol(gang, m, dt); patrolling++; }
      else if (role === "deal") { dealing = true; tendDealer(gang, m, dt); }
      else if (role === "extort") tickExtort(gang, m, dt);
    }
    if (atWar) { gang._dealer = null; gang._extorter = null; return; }

    // PATROL: keep ~2 members pacing the block (cheap; just moves guard points)
    if (patrolling < Math.min(2, Math.max(1, (gangStrengthSafe(gang) / 4) | 0))) {
      for (const m of gang.members) {
        if (!opFree(m)) continue;
        if (m.rank === "lt") continue;                     // an Lt holds the HQ, doesn't pace
        startOp(m, "patrol", 18 + rng() * 14);
        m._op.ang = rng() * 6.28; m._op.dir = rng() < 0.5 ? 1 : -1; m._op.radius = gang._patrolR;
        patrolling++;
        if (patrolling >= 2) break;
      }
    }

    // DEAL: keep one dealer posted, and periodically run a buyer up to him
    gang._dealT = (gang._dealT || 0) - dt;
    if (!dealing && gang._dealT <= 0) {
      gang._dealT = 6 + rng() * 8;
      if (ensureDealer(gang)) dealing = true;
    }
    const dealer = liveDealer(gang);
    if (dealer) {
      gang._buyT = (gang._buyT || (5 + rng() * 6)) - dt;
      if (gang._buyT <= 0) {
        gang._buyT = 10 + rng() * 12;
        // only stage a buyer when someone can see it (keeps off-screen crews cheap)
        if (nearPlayer(dealer.pos.x, dealer.pos.z, 70)) dispatchBuyer(gang, dealer);
      }
    }

    // EXTORT: occasionally send a collector at a civilian on the block
    gang._extortT = (gang._extortT || (12 + rng() * 12)) - dt;
    if (gang._extortT <= 0) {
      gang._extortT = 20 + rng() * 18;
      // stage shakedowns mainly where the player can witness the tension
      if (nearPlayer(gang.center.x, gang.center.z, 80)) ensureExtort(gang);
    }
  }

  // a posted dealer just holds his corner; refresh the post if he's wandered off
  // it (the brain's ±7m loiter can drift him), and re-face the block.
  function tendDealer(gang, m, dt) {
    const op = m._op; op.until -= dt;
    if (op.until <= 0) { gang._dealer = null; endOp(m); return; }
    const post = m._dealPost;
    if (post && Math.hypot(m.pos.x - post.x, m.pos.z - post.z) > 8) {
      m.guard = { x: post.x, z: post.z };
      m.state = "walk"; m.pause = 0;
      if (m.target && m.target.set) m.target.set(post.x, 0, post.z);
    }
  }

  // crew live-body count without leaning on a gangs.js internal (uses the export)
  function gangStrengthSafe(gang) {
    if (CBZ.cityGangStrength) return CBZ.cityGangStrength(gang);
    let n = 0; for (const m of gang.members) if (m && !m.dead && !m.ko) n++;
    return n;
  }

  // ---- buyer upkeep + cash pickup run every frame (cheap, bounded) --------
  function tickBuyers(dt) {
    const gangs = CBZ.cityGangs || [];
    for (const gang of gangs) {
      const b = gang._buyer;
      if (b && b._op && b._op.role === "buy") tickBuyer(b, dt);
      else if (b) gang._buyer = null;
    }
    // the robbable deal-cash stack: player walks over it → grab it (and the theft
    // spooks the dealer + provokes the crew, the existing turf-crime reaction).
    if (cashMesh && !((CBZ.player && CBZ.player.dead))) {
      const P = CBZ.player;
      if (P && P.pos) {
        const dx = P.pos.x - cashX, dz = P.pos.z - cashZ, dy = (P.pos.y || 0) - cashY;
        if (dx * dx + dz * dz < 1.7 * 1.7 && Math.abs(dy) < 3.5) {
          const amt = cashAmt, gang = cashGang;
          if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(amt);
          if (CBZ.city && CBZ.city.note) { try { CBZ.city.note("Snatched $" + amt + " off the corner", 1.6); } catch (e) {} }
          if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(2);
          // robbing a dealer in the open: the crew knows + a little heat
          if (gang && CBZ.cityGangProvoke) CBZ.cityGangProvoke(gang.id, 0.6);
          if (gang && CBZ.cityGangAddStanding) CBZ.cityGangAddStanding(gang.id, -6);
          if (CBZ.cityAlarm) CBZ.cityAlarm(cashX, cashZ, 18, 1.1, CBZ.city && CBZ.city.playerActor);
          if (CBZ.cityCrime) CBZ.cityCrime(45, { x: cashX, z: cashZ, type: "robbery" });
          dropCash();
        }
      }
    }
  }

  // ---- reset: drop all op state so a fresh run / mode swap starts clean ----
  function resetOps() {
    dropCash();
    const gangs = CBZ.cityGangs || [];
    for (const gang of gangs) {
      if (!gang) continue;
      gang._dealer = null; gang._buyer = null; gang._extorter = null;
      gang._opSpots = null; gang._opSpotsTurf = -1;
      gang._dealT = 0; gang._buyT = 0; gang._extortT = 0; gang._opBarkT = 0;
      for (const m of gang.members) { if (m) { m._op = null; m._dealPost = null; m._exMark = null; } }
    }
  }
  CBZ.cityGangOpsReset = resetOps;

  // ============================================================
  //  HOOKS — the director (cadenced over crews) + the per-frame buyer/cash tick.
  //  Ordered just AFTER the gangs.js directors (34.5 / 34.6) so a crew's war /
  //  raid / reprisal state is already settled this frame before we decide ops.
  // ============================================================
  let opT = 0;
  CBZ.onUpdate(34.7, function (dt) {
    if (!inCity()) return;
    if (noSim()) return;                       // host simulates; guests puppet
    if (!CBZ.cityGangs || !CBZ.cityGangs.length) return;
    // per-frame: advance in-flight buyers + the cash-grab test (both cheap/bounded)
    tickBuyers(dt);
    // cadenced: the op DIRECTOR over the rosters (a few hundred reads, ~0.5s)
    opT -= dt;
    if (opT <= 0) {
      const step = 0.5;
      opT = step;
      for (const gang of CBZ.cityGangs) runGangOps(gang, step);
    }
  });
})();
