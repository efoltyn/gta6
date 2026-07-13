/* ============================================================
   city/officejobs.js — the OFFICE-JOBS spine + the WHY that makes a working
   office matter.

   An "AI working a job" should look like an AI on the STREET: it's the SAME
   schedule/goal/nav brain (schedule.js → aigoals.js), just routed to a
   destination that ends in SITTING at a desk for the shift, then walking home.
   This file owns three small, interoperable pieces of that:

     • THE DESK REGISTRY (C2 define side): the building furnishing code
       (buildings.js furnishOfficeFloor) reports each seat as a WORLD-coord
       anchor and registers it here via CBZ.cityRegisterOfficeDesks(lot, anchors).
       We keep them in CBZ.cityOfficeDesks = [{lot,x,y,z,face,occupant}].

     • THE CLAIM API (C4): CBZ.cityClaimDesk(ped) hands a worker a free seat
       (preferring one inside their own work lot, else the nearest free desk),
       marks it occupied, and stamps ped._deskAnchor. CBZ.cityReleaseDesk(ped)
       frees it. peds.js move() drives the walk-in + the seat-on-arrival; this
       file only owns who-owns-what.

     • THE WHY (C6): an office full of people working is only worth anything if
       BARGING IT has a consequence. A throttled sweep watches for the player
       standing on an office FLOOR with seated workers (or gunfire landing on
       one): the workers BOLT — they drop their desk, fear spikes, they flee for
       the exit, and a fraction phone it in through the EXISTING witness/heat
       path (CBZ.cityCrime). One small grabbable cash stack rides a manager desk
       so the intrusion has a carrot as well as a stick. Pure in-world — no popup.

   City-mode only; MP-safe (the host simulates, guests puppet — we bail under
   the net noSim guard so two machines never double-drive the same desks).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;
  const cmat = CBZ.cmat || CBZ.mat || function (c) { return new THREE.MeshLambertMaterial({ color: c }); };

  // ---- C2 (define side): the world-coord desk registry --------------------
  // Every entry: { lot, x, y, z, face, occupant }. occupant is the seated ped
  // (or null). Other files READ this array (peds.js seat-on-arrival reads
  // ped._deskAnchor which we point at one of these records).
  CBZ.cityOfficeDesks = CBZ.cityOfficeDesks || [];

  // buildings.js furnishOfficeFloor calls this once per furnished floor with an
  // array of {x,y,z,face} anchors (already in WORLD coords). We tag each with
  // its lot + a null occupant and append. Defensive: skip junk, dedupe exact
  // repeats so a furnish-retry on the same floor can't stack ghost seats.
  CBZ.cityRegisterOfficeDesks = function (lot, anchors) {
    if (!anchors || !anchors.length) return;
    const list = CBZ.cityOfficeDesks;
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      if (!a || typeof a.x !== "number" || typeof a.z !== "number") continue;
      let dup = false;
      for (let j = 0; j < list.length; j++) {
        const d = list[j];
        if (d.lot === lot && Math.abs(d.x - a.x) < 0.05 && Math.abs(d.z - a.z) < 0.05 && Math.abs((d.y || 0) - (a.y || 0)) < 0.05) { dup = true; break; }
      }
      if (dup) continue;
      list.push({ lot: lot, x: a.x, y: a.y || 0, z: a.z, face: a.face || 0, occupant: null });
    }
  };

  // wipe the registry for a fresh city (world.js/mode.js rebuilds furnishing).
  // Drop the cash pickup too so a new run starts clean.
  CBZ.cityOfficeDesksReset = function () {
    CBZ.cityOfficeDesks.length = 0;
    dropCash();
  };

  // ---- C4: claim / release ------------------------------------------------
  // A worker takes a desk. Prefer a free seat INSIDE the ped's own work lot
  // (ped._work), so a firm's people fill that firm's floors; otherwise the
  // nearest free desk to where they are. Returns the anchor record or null.
  CBZ.cityClaimDesk = function (ped) {
    if (!ped) return null;
    if (ped._deskAnchor && ped._deskAnchor.occupant === ped) return ped._deskAnchor;  // already holds one
    const list = CBZ.cityOfficeDesks;
    if (!list.length) return null;
    const px = ped.pos ? ped.pos.x : 0, pz = ped.pos ? ped.pos.z : 0;
    const wantLot = ped._work || null;
    let best = null, bestD = Infinity, bestInLot = false;
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      if (d.lot && d.lot.demolished) continue;                 // no desk in a rubble pile
      if (d.occupant && d.occupant !== ped) continue;          // taken by someone else
      if (d.occupant === ped) return (ped._deskAnchor = d);    // re-grab our own
      const inLot = wantLot && d.lot === wantLot;
      const dd = (d.x - px) * (d.x - px) + (d.z - pz) * (d.z - pz);
      // prefer a same-lot desk over any out-of-lot one; within that, nearest.
      if (inLot && !bestInLot) { best = d; bestD = dd; bestInLot = true; continue; }
      if (inLot === bestInLot && dd < bestD) { best = d; bestD = dd; }
    }
    if (!best) return null;
    best.occupant = ped;
    best._since = CBZ.now || 0;   // SENIORITY stamp: companies.js's owner-succession bench
                                   // (and our own succeedManager below) rank candidates by
                                   // how long they've actually held this desk.
    ped._deskAnchor = best;
    return best;
  };

  // free whatever desk a ped holds (called when they leave their seat — on
  // shift-end, on panic, on death/recycle). Idempotent.
  CBZ.cityReleaseDesk = function (ped) {
    if (!ped) return;
    const d = ped._deskAnchor;
    if (d) { if (d.occupant === ped) { d.occupant = null; d._since = null; } ped._deskAnchor = null; }
    // a held desk can also be found by back-scan if the ref was dropped elsewhere
    else {
      const list = CBZ.cityOfficeDesks;
      for (let i = 0; i < list.length; i++) if (list[i].occupant === ped) { list[i].occupant = null; list[i]._since = null; }
    }
    if (ped.char) ped.char.sitting = false;   // keep the pose flag honest
  };

  // ============================================================
  //  THE LEGIT RANK LADDER — a minimal, two-tier mirror of gangs.js's full
  //  Prospect→Boss pyramid for ordinary office jobs: WORKER and MANAGER. You
  //  don't need six tiers for a cubicle floor; you DO need the same shape the
  //  owner's vision asks for everywhere else — "killing/firing the person in
  //  charge triggers a REAL promotion among the people under them", not a
  //  silent respawn. One manager per staffed HQ lot (CBZ.cityOfficeDesks'
  //  .lot key), tracked here; companies.js's succeedCompanyOwner() also reads
  //  CBZ.cityIsOfficeManager() so a standing manager always outranks a
  //  rank-and-file desk worker when the OWNER himself goes down and the bench
  //  gets ranked.
  // ============================================================
  const officeManagers = new Map();   // lot -> manager ped (the lot's CURRENT desk-floor lead)

  // who runs lot's floor right now? null if nobody's been promoted there yet
  // (or the manager has since died/left — back-scan keeps this honest).
  CBZ.cityOfficeManagerOf = function (lot) {
    const m = officeManagers.get(lot);
    if (m && m.dead) { officeManagers.delete(lot); return null; }
    return m || null;
  };
  CBZ.cityIsOfficeManager = function (ped) { return !!(ped && ped._mgr); };

  // crown a desk worker the manager of their own floor. Pure data + a tag, the
  // same "rank lives on the ped, gear/label follow" shape gangs.js's
  // promoteMember uses — there's no gear here, just the floating-tag pip and
  // a small pay/seniority bump so a manager genuinely reads as senior.
  function tagManager(ped) {
    if (!ped || !ped.tag || !ped.char || !ped.char.group || !CBZ.makeLabelSprite) return;
    const txt = (ped.name || "Manager") + " · Manager";
    const lbl = CBZ.makeLabelSprite(txt, { color: "#ffd166" });
    lbl.position.y = ped.tag.position.y || (CBZ.charHeadY ? CBZ.charHeadY(ped.char) : 1.97); lbl.scale.copy(ped.tag.scale);
    if (ped.tag.parent) ped.tag.parent.remove(ped.tag);
    ped.char.group.add(lbl); ped.tag = lbl; ped.tag.visible = false;
  }
  function untagManager(ped) {
    // best-effort: drop back to the plain name tag peds.js cast at spawn.
    // We don't cache the original sprite (rare path — death/promotion only),
    // so just rebuild a plain one the same way tagWithRank's callers do.
    if (!ped || !ped.tag || !ped.char || !ped.char.group || !CBZ.makeLabelSprite) return;
    const lbl = CBZ.makeLabelSprite(ped.name || "Worker");
    lbl.position.y = ped.tag.position.y || (CBZ.charHeadY ? CBZ.charHeadY(ped.char) : 1.97); lbl.scale.copy(ped.tag.scale);
    if (ped.tag.parent) ped.tag.parent.remove(ped.tag);
    ped.char.group.add(lbl); ped.tag = lbl; ped.tag.visible = false;
  }
  function promoteManager(lot, ped) {
    if (!lot || !ped || ped.dead) return false;
    ped._mgr = true; ped._mgrLot = lot;
    ped.wealth = Math.min(0.95, (ped.wealth || 0.4) + 0.1);    // a manager's wage shows
    tagManager(ped);
    officeManagers.set(lot, ped);
    return true;
  }
  CBZ.cityPromoteOfficeManager = promoteManager;

  // demote/clear whoever runs lot's floor (their post is being vacated for a
  // bigger promotion — e.g. companies.js's succeedCompanyOwner just made them
  // the OWNER, so the manager seat is open again — or they died/quit).
  CBZ.cityOfficeClearManager = function (lot) {
    const m = officeManagers.get(lot);
    if (m) { m._mgr = false; m._mgrLot = null; untagManager(m); }
    officeManagers.delete(lot);
  };

  // SUCCESSION — modeled on gangs.js's succeedBoss(): rank the live desk
  // occupants at this lot (by seniority — time spent AT a desk here, the only
  // currency we track for ordinary office workers) and promote the senior
  // one. Fired when a manager dies (peds.js's central death chain calling
  // CBZ.cityOfficeManagerDown, mirroring cityGangMemberDown's contract) or is
  // otherwise removed from the floor (fired, transferred — any caller may
  // invoke this directly).
  function deskTenure(p) { return (p && p._deskAnchor && p._deskAnchor._since != null) ? (CBZ.now || 0) - p._deskAnchor._since : 0; }
  function succeedManager(lot) {
    const list = CBZ.cityOfficeDesks;
    let best = null, bestT = -1;
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      if (d.lot !== lot || !d.occupant || d.occupant.dead) continue;
      const t = deskTenure(d.occupant);
      if (t > bestT) { bestT = t; best = d.occupant; }
    }
    officeManagers.delete(lot);
    if (best) {
      promoteManager(lot, best);
      try { if (CBZ.cityFeed) CBZ.cityFeed("📈 " + (best.name || "A worker") + " is promoted to floor manager.", "#ffd166"); } catch (e) {}
    }
    return best;
  }
  CBZ.citySucceedOfficeManager = succeedManager;

  // a manager went down (killed, or simply removed from the floor) — fire the
  // same shape gangs.js's cityGangMemberDown uses for a boss kill: clear the
  // post, then promote the bench. Safe to call for a ped who was never a
  // manager (no-op). Feature-detected callers: peds.js's central death chain
  // (a separate task) is free to call this for any office-worker kill; we
  // don't require it — officejobs.js's own staffing sweep below also catches
  // a manager whose body has gone .dead, as a permanence safety net.
  CBZ.cityOfficeManagerDown = function (ped) {
    if (!ped || !ped._mgr || !ped._mgrLot) return;
    const lot = ped._mgrLot;
    ped._mgr = false; ped._mgrLot = null;
    succeedManager(lot);
  };

  // ---- BIOME WORK-ANCHORS: claim / release (the desk pattern, ported) -----
  // A biome worker (farmer/rancher/ranger/soldier/ski instructor/ground crew/
  // shopkeeper) routes to a WORK-ANCHOR instead of a shopLot. cityClaimWorkAnchor
  // finds the NEAREST matching-kind anchor with a free slot for the ped's job and
  // claims a seat in it; cityReleaseWorkAnchor frees it. Mirrors cityClaimDesk:
  // we own who-holds-which-anchor; aigoals.js owns the routing + the fieldwork
  // resolver; worldmap.js owns the data (CBZ.cityWorkAnchors).
  //
  // The anchor KIND comes from the ped's job table entry (CBZ.cityJobs[job].anchor).
  // Returns the anchor record (so goEarn can read .spots) or null.
  CBZ.cityClaimWorkAnchor = function (ped) {
    if (!ped) return null;
    const list = CBZ.cityWorkAnchors;
    if (!list || !list.length) return null;
    // already holds one that's still valid → re-grab (idempotent, free)
    if (ped._workAnchor && list.indexOf(ped._workAnchor) >= 0 &&
        ped._workAnchor.occupants.indexOf(ped) >= 0) return ped._workAnchor;
    const J = CBZ.cityJobs && CBZ.cityJobs[ped.job];
    const kind = J && J.anchor;
    if (!kind) return null;
    const px = ped.pos ? ped.pos.x : 0, pz = ped.pos ? ped.pos.z : 0;
    let best = null, bestD = Infinity;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.kind !== kind) continue;
      if (a.occupants.indexOf(ped) >= 0) { best = a; bestD = 0; break; }  // ours already
      if (a.occupants.length >= (a.cap | 0)) continue;                    // full
      const dd = (a.x - px) * (a.x - px) + (a.z - pz) * (a.z - pz);
      if (dd < bestD) { bestD = dd; best = a; }
    }
    if (!best) return null;
    if (best.occupants.indexOf(ped) < 0) best.occupants.push(ped);
    ped._workAnchor = best;
    return best;
  };

  // free whatever work-anchor a ped holds (shift-end / panic / death / recycle).
  // Idempotent; also clears the working pose flag so a freed worker stands up.
  CBZ.cityReleaseWorkAnchor = function (ped) {
    if (!ped) return;
    const a = ped._workAnchor;
    if (a && a.occupants) {
      const i = a.occupants.indexOf(ped);
      if (i >= 0) a.occupants.splice(i, 1);
    } else {
      // ref dropped elsewhere — back-scan so a stale slot can't leak
      const list = CBZ.cityWorkAnchors;
      if (list) for (let k = 0; k < list.length; k++) {
        const occ = list[k].occupants, j = occ ? occ.indexOf(ped) : -1;
        if (j >= 0) occ.splice(j, 1);
      }
    }
    ped._workAnchor = null;
    ped._anchorSpot = 0;
    if (ped.char) ped.char.working = false;
  };

  // ---- optional grabbable cash on a manager desk --------------------------
  // ONE loose cash stack, parented to the scene at a manager desk's anchor, that
  // the player grabs by walking over it (no key — diegetic). Reuses CBZ.city.addCash.
  let cashMesh = null, cashAnchor = null, cashAmt = 0, cashArena = null;
  function root() { return (CBZ.city && CBZ.city.arena && CBZ.city.arena.root) || CBZ.scene; }
  function dropCash() {
    if (cashMesh) { if (cashMesh.parent) cashMesh.parent.remove(cashMesh); cashMesh = null; }
    cashAnchor = null; cashAmt = 0; cashArena = null;
  }
  function placeCash() {
    const list = CBZ.cityOfficeDesks;
    if (!list.length) return;
    // a deterministic "manager" desk: the registry order is furnish order, so the
    // first desk of a floor reads as the head's. Pick one at random among lots.
    const a = list[(Math.random() * list.length) | 0];
    if (!a) return;
    cashAnchor = a; cashArena = CBZ.city && CBZ.city.arena;
    cashAmt = 60 + ((Math.random() * 140) | 0);
    const grp = new THREE.Group();
    // a short banded stack of bills on the desktop
    const bill = new THREE.Mesh(CBZ.boxGeom ? CBZ.boxGeom(0.26, 0.07, 0.14) : new THREE.BoxGeometry(0.26, 0.07, 0.14), cmat(0x3f7d4f));
    bill.castShadow = false; bill.receiveShadow = false;
    const band = new THREE.Mesh(CBZ.boxGeom ? CBZ.boxGeom(0.27, 0.075, 0.04) : new THREE.BoxGeometry(0.27, 0.075, 0.04), cmat(0xd9c25a));
    band.position.y = 0.001;
    grp.add(bill, band);
    grp.position.set(a.x, (a.y || 0) + 0.78, a.z);     // sit it on the desktop
    grp.rotation.y = a.face || 0;
    root().add(grp);
    cashMesh = grp;
  }

  // ---- helpers ------------------------------------------------------------
  function inCity() { return g && g.mode === "city"; }
  function noSim() { return CBZ.net && CBZ.net.noSim && CBZ.net.noSim(); }
  function workHour() {
    const h = CBZ.citySunHour ? CBZ.citySunHour() : 9;
    return h >= 8 && h < 19;                 // ordinary office shift band
  }

  // a worker is "seated" for our purposes if they hold a desk AND are posed
  // sitting (peds.js sets char.sitting once they actually arrive + sit).
  function isSeated(ped) {
    return ped && !ped.dead && ped._deskAnchor && ped.char && ped.char.sitting === true;
  }

  // boot a seated worker out of the chair: free the desk, spike fear, and let
  // the EXISTING panic broadcast route them to the exit (peds.js leaves "sit"
  // on a flee/threat per the contract). Returns true if it actually evicted.
  function evict(ped, px, pz, offender) {
    if (!isSeated(ped)) return false;
    CBZ.cityReleaseDesk(ped);
    ped.fear = Math.min(10, (ped.fear || 0) + 6);
    ped.alarmed = Math.max(ped.alarmed || 0, 6);
    if (offender && offender.pos) ped.mem = ped.mem || offender;   // they can ID you
    // hand the actual flee/path to the owning systems: cityPanic forces a FLEE
    // away-heading (vetted, won't bolt through a wall) and ripples to neighbours.
    if (CBZ.cityPanic) CBZ.cityPanic(ped.pos.x, ped.pos.z, 1.0, offender);
    else { ped.state = "flee"; ped.char && (ped.char.sitting = false); }
    return true;
  }

  // ---- the sweep ----------------------------------------------------------
  // (a) STAFFING safety-net: during work hours, an office worker (ped._officeJob)
  //     who is on/near an office floor but hasn't been handed a desk gets one,
  //     so floors stay populated even if a schedule tick missed them. Schedule.js
  //     (C5) does the routing; this just guarantees a claim exists to route to.
  // (b) THE WHY: the player standing on a floor with seated workers — or gunfire
  //     that already spiked a seated worker's fear (cityAlarm/cityPanic bump it) —
  //     empties the chairs and, for a fraction, calls it in.
  let acc = 0;
  let cashT = 0;
  let seenArena = null;
  let mgrScanT = 4;   // first auto-crown pass fires a few seconds into a fresh city
  CBZ.onUpdate(41.9, function (dt) {
    if (!inCity()) return;
    if (noSim()) return;                     // host simulates; guests puppet
    const list = CBZ.cityOfficeDesks;

    // SELF-HEAL on a new city: buildings.js re-registers fresh desks for the new
    // arena, but the old run's records would otherwise linger (mode.js MAY call
    // cityOfficeDesksReset, but we don't depend on it). When the live arena
    // changes, drop any desk whose lot isn't in the new arena's lot set + the
    // cash pickup, so nothing points at a disposed building.
    const arena = CBZ.city && CBZ.city.arena;
    if (arena !== seenArena) {
      seenArena = arena;
      if (list.length && arena && arena.lots) {
        const live = arena.lots;
        for (let i = list.length - 1; i >= 0; i--) {
          if (live.indexOf(list[i].lot) === -1) list.splice(i, 1);
        }
      } else if (!arena) {
        list.length = 0;
      }
      dropCash();
    }

    if (!list.length) { if (cashMesh) dropCash(); return; }

    // a NEW city invalidates the cash pickup's home (arena swapped under it).
    if (cashMesh && cashArena && arena !== cashArena) dropCash();

    acc += dt;
    if (acc < 0.4) return;                    // ~2.5Hz — plenty for an intrusion
    const tick = acc; acc = 0;

    // BIOME WORK-ANCHOR hygiene: drop dead / parked / departed peds from anchor
    // occupant lists so a slot is never stranded by a body that left without a
    // clean release (death, cull, recycle). Tiny: ≤ a handful of anchors, each a
    // 2-3-slot list. Mirrors the desk back-scan but runs on the same cheap tick.
    const anchors = CBZ.cityWorkAnchors;
    if (anchors && anchors.length) {
      for (let i = 0; i < anchors.length; i++) {
        const occ = anchors[i].occupants;
        if (!occ || !occ.length) continue;
        for (let k = occ.length - 1; k >= 0; k--) {
          const p = occ[k];
          if (!p || p.dead || p._parked || p._workAnchor !== anchors[i]) {
            if (p && p._workAnchor === anchors[i]) p._workAnchor = null;
            occ.splice(k, 1);
          }
        }
      }
    }

    // DEMOLITION hygiene: a desk whose lot just came down mid-shift still has an
    // occupant seated in it — release them so they walk away instead of sitting
    // in a rubble pile (demolition.js only toggles lot.demolished, it doesn't
    // know about desks).
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      if (d.occupant && d.lot && d.lot.demolished) CBZ.cityReleaseDesk(d.occupant);
    }

    // MANAGER PERMANENCE SAFETY NET: a killed/recycled manager's body going
    // .dead doesn't automatically run succession (peds.js's central death
    // chain calling CBZ.cityOfficeManagerDown is the fast path, but it's a
    // separate task this wave and may not be wired). Cheap — bounded to the
    // handful of lots that currently HAVE a crowned manager, mirrors gangs.js's
    // own "boss.dead && !bossDead → succeed" upkeep check.
    if (officeManagers.size) {
      for (const [lot, mgr] of officeManagers) {
        if (mgr && mgr.dead) CBZ.cityOfficeManagerDown(mgr);
      }
    }

    const peds = CBZ.cityPeds;
    const PA = CBZ.city && CBZ.city.playerActor;
    const ppos = CBZ.player && CBZ.player.pos;
    const px = ppos ? ppos.x : 0, py = ppos ? ppos.y || 0 : 0, pz = ppos ? ppos.z : 0;
    const playerDead = !CBZ.player || CBZ.player.dead;
    const isWork = workHour();

    // ---- (a) staffing safety-net ----
    // C5 (schedule/aigoals) does the routing; we only GUARANTEE a claim exists to
    // route to. Claim only for an office worker who is NEAR/INSIDE a desk (≤ ~28u
    // of one — i.e. on the block, not still asleep at home across town), so we
    // never lock a seat for someone who won't reach it this tick. Cheap: stop at
    // the first in-range desk.
    if (isWork && peds && peds.length && list.length) {
      for (let i = 0; i < peds.length; i++) {
        const p = peds[i];
        if (!p || p.dead || !p._officeJob || p._deskAnchor) continue;
        if (p.state === "flee" || p.state === "fight" || p.rage || p.surrender) continue;
        const wx = p.pos ? p.pos.x : 0, wz = p.pos ? p.pos.z : 0;
        let near = false;
        for (let k = 0; k < list.length; k++) {
          const d = list[k];
          if (d.occupant && d.occupant !== p) continue;
          if ((d.x - wx) * (d.x - wx) + (d.z - wz) * (d.z - wz) < 28 * 28) { near = true; break; }
        }
        if (near) CBZ.cityClaimDesk(p);
      }
    }

    // ---- (a2) AUTO-CROWN a manager for any staffed floor that doesn't have
    // one yet. A floor only needs a manager once it actually has desk
    // occupants to lead (no point crowning an empty office); this keeps the
    // ladder honest without a scripted "day one" promotion event. Slow
    // cadence + bounded to distinct lots actually present in the desk list
    // (≤ a few dozen office floors citywide).
    mgrScanT -= tick;
    if (mgrScanT <= 0 && list.length) {
      mgrScanT = 8;
      const seenLots = new Set();
      for (let i = 0; i < list.length; i++) {
        const lot = list[i].lot;
        if (seenLots.has(lot)) continue;
        seenLots.add(lot);
        if (officeManagers.has(lot)) continue;
        succeedManager(lot);   // no-op (no live occupant) until someone's actually staffing the floor
      }
    }

    // ---- (b) THE WHY: intrusion + gunfire eviction ----
    // Decide if the player is "on an office floor": within a tight horizontal
    // radius of a SEATED worker's desk AND within the same vertical floor band
    // (so standing on the street under a tower doesn't count). We also evict any
    // seated worker whose fear was already spiked by gunfire (cityAlarm/Panic).
    if (!peds || !peds.length) return;
    let evicted = 0, reports = 0;
    const FLOOR_BAND = 2.4;            // a storey is ~3.2u; this keeps it to one floor
    const INTRUDE_R2 = 7.0 * 7.0;     // "in the room with them" horizontal reach
    const FEAR_BOLT = 7.5;            // gunfire-level fear that empties a chair on its own
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!isSeated(p)) continue;
      const a = p._deskAnchor;
      const onFloor = !playerDead &&
        Math.abs(py - (a.y || 0)) < FLOOR_BAND &&
        ((px - a.x) * (px - a.x) + (pz - a.z) * (pz - a.z)) < INTRUDE_R2;
      const spooked = (p.fear || 0) >= FEAR_BOLT;       // gunfire/explosion already hit them
      if (!onFloor && !spooked) continue;
      const offender = onFloor ? PA : (p.mem || null);
      if (evict(p, px, pz, offender)) {
        evicted++;
        // a FRACTION phone it in through the existing witness/heat path. Barging a
        // working office and scaring the staff IS a reportable disturbance. Keep it
        // a minority + a soft severity (this isn't a murder) and route ONLY when the
        // PLAYER caused it (onFloor) — a stray gunfight already has its own reporters.
        // "burglary" is a CHARGEABLE type (unknown types resolve to a 0-star
        // "Disturbance" that wanted.js drops with no heat — so a made-up "trespass"
        // would scare people but never raise a star). Storming a private office
        // floor reads as burglary; a witness phoning it in raises real heat.
        if (onFloor && reports < 2 && Math.random() < 0.34 && CBZ.cityCrime) {
          CBZ.cityCrime(26, { x: p.pos.x, z: p.pos.z, type: "burglary" });
          reports++;
        }
      }
    }
    // a single ambient feed line so the disturbance reads in the ticker (no popup).
    if (evicted >= 2 && CBZ.cityFeed && Math.random() < 0.5) {
      try { CBZ.cityFlavor && CBZ.cityFlavor("🏢 Workers scatter as the floor is stormed", "#ffce8f"); } catch (e) {}
    }

    // ---- optional cash carrot: lazily place ONE stack, grab on walk-over ----
    cashT += tick;
    if (!cashMesh && cashT > 3 && list.length) { cashT = 0; placeCash(); }
    if (cashMesh && cashAnchor && !playerDead) {
      const dx = px - cashAnchor.x, dz = pz - cashAnchor.z, dy = py - (cashAnchor.y || 0);
      if (dx * dx + dz * dz < 1.6 * 1.6 && Math.abs(dy) < FLOOR_BAND) {
        if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(cashAmt);
        if (CBZ.city && CBZ.city.note) { try { CBZ.city.note("Grabbed $" + cashAmt + " off the desk", 1.6); } catch (e) {} }
        dropCash();                       // taken — it won't respawn until next placement window
      }
    }
  });
})();
