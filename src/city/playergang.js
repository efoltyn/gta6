/* ============================================================
   city/playergang.js — YOUR gang: ownership, hierarchy, orders, turf.

   Two ways to run a crew of your own:
     1) FOUND one once you have >=3 recruited crew (cityRecruit). You name
        it, it takes your colour, and it claims the block you're standing on
        as turf.
     2) TAKE OVER a rival gang by killing its BOSS (gangs.js fires
        CBZ.cityPlayerGangBossKilled). Claim it and its surviving members
        defect to you — same colour, loyal, on your payroll.

   Hierarchy reuses ped.rank: Boss (you) > Lieutenant > Soldier. Promote a
   crew member to Lieutenant; lieutenants can be told to HOLD a block and
   anchor a squad there.

   ORDERS — press [O] to open the command wheel (or use the interact menu's
   gang options). Orders drive every member of g.playerGang:
       ATTACK   — everyone targets your aimed / nearest enemy (sets .rage)
       HOLD     — members post up at your spot and defend it (.guard)
       FOLLOW   — members ride with you and defend you (.companion brain)
       DISPERSE — members fall back to their home turf

   Player-gang members carry gang:g.playerGang.id + faction:"player", so the
   universal ped brain (peds.js) already treats rival gangs as enemies on
   turf (turfIntruder keys off p.gang !== ped.gang) and the companion brain
   defends you while FOLLOWing. We only steer state on top of that.

   Exposes: CBZ.cityPlayerGangEnsure / Found / Claim / Members / IsMember /
   Promote / Order / BossKilled / DefendTurf, and CBZ.cityPlayerGangReset.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  // ---- gang colours to offer when founding ----
  const FOUND_COLORS = [
    { name: "Gold", hex: 0xffd166 }, { name: "Crimson", hex: 0xff4d4d },
    { name: "Cyan", hex: 0x36e0d0 }, { name: "Violet", hex: 0xc77dff },
    { name: "Lime", hex: 0x9be564 }, { name: "Orange", hex: 0xff8c42 },
  ];
  const NAME_A = ["Iron", "Black", "Red", "Night", "Concrete", "Wolf", "Ghost", "Royal", "Savage", "Empire"];
  const NAME_B = ["Syndicate", "Mob", "Crew", "Kings", "Cartel", "Lords", "Wolves", "Dynasty", "Saints", "Mafia"];

  function rnd() { return Math.random(); }
  function pick(a) { return a[(rnd() * a.length) | 0]; }
  function hex6(n) { return "#" + ("000000" + (n >>> 0).toString(16)).slice(-6); }
  function shortGang(n) { if (!n) return "them"; const w = n.split(" "); return w.length > 1 ? w[w.length - 1] : n; }

  // nearest LIVE rival gang record (an actual faction, not the player's) — used
  // by the orders menu to offer alliance / war with whoever's closest.
  function nearestRival() {
    const P = CBZ.player; if (!P || !CBZ.cityGangs) return null;
    let best = null, bd = Infinity;
    for (const gn of CBZ.cityGangs) {
      if (!gn || gn.isPlayer || gn.absorbed || gn.id === "player" || !gn.turf || !gn.turf.length) continue;
      const c = gn.center || gn.turf[0];
      const d = Math.hypot((c.x != null ? c.x : c.cx) - P.pos.x, (c.z != null ? c.z : c.cz) - P.pos.z);
      if (d < bd) { bd = d; best = gn; }
    }
    return best;
  }

  // ---- lazy state ----
  function ensure() {
    if (!g.playerGang) {
      g.playerGang = {
        id: "player", name: null, color: 0x7ed957,
        members: [], turf: [], boss: null,
        founded: false, order: "follow", orderTarget: null,
        center: null,
      };
    }
    return g.playerGang;
  }
  CBZ.cityPlayerGangEnsure = ensure;

  function exists() { return !!(g.playerGang && g.playerGang.founded); }
  CBZ.cityPlayerGangExists = exists;

  function liveMembers() {
    const pg = g.playerGang; if (!pg) return [];
    // drop anyone dead, despawned, or who quit (careers.js walks a companion off
    // the job when you miss payroll — that clears recruited/faction)
    pg.members = pg.members.filter((m) => m && !m.dead && !m.collected && m.recruited && (m.gang === pg.id || m.faction === "player"));
    return pg.members;
  }
  CBZ.cityPlayerGangMembers = liveMembers;
  CBZ.cityPlayerGangIsMember = function (ped) { return !!(ped && g.playerGang && g.playerGang.members.indexOf(ped) >= 0); };

  // rank pip used on the floating tag — pulls from the shared ladder (gangs.js)
  // so the player's crew reads the same Prospect→Boss ladder as everyone else.
  function rankPip(key) { return (CBZ.cityRankName ? CBZ.cityRankName(key) : (key === "lt" ? "Lt." : "Crew")); }

  // tint a member's name tag to the gang colour + label their rank
  function styleMember(ped, color) {
    if (!ped) return;
    ped.tagColor = hex6(color);
    if (ped.tag && ped.char && ped.char.group && CBZ.makeLabelSprite) {
      const pip = rankPip(ped.rank);
      const txt = (ped.name || "Crew") + (pip && pip !== "Soldier" ? " · " + pip : (ped.rank === "soldier" ? " · Soldier" : ""));
      const lbl = CBZ.makeLabelSprite(txt, { color: hex6(color) });
      lbl.position.y = ped.tag.position.y || 3.0; lbl.scale.copy(ped.tag.scale);
      if (ped.tag.parent) ped.tag.parent.remove(ped.tag);
      ped.char.group.add(lbl); ped.tag = lbl; ped.tag.visible = false;
    }
  }

  // bring a ped into YOUR gang (defector or fresh recruit)
  function enlist(ped, rank) {
    const pg = ensure();
    if (!ped || ped.dead) return;
    if (pg.members.indexOf(ped) < 0) pg.members.push(ped);
    ped.gang = pg.id; ped.faction = "player";
    ped.recruited = true; ped.kind = "crew"; ped.companion = (pg.order === "follow");
    ped.rank = rank || ped.rank || "soldier";
    ped.aggr = Math.max(ped.aggr || 0, 0.92);
    ped.armed = true; if (!ped.weapon || ped.weapon === "Bat") ped.weapon = "Pistol"; ped.ammo = 999;
    ped.maxHp = Math.max(ped.maxHp || 120, ped.rank === "lt" ? 200 : 160);
    ped.hp = Math.max(ped.hp || 1, ped.maxHp * 0.85);
    ped.npcWanted = 0; ped.npcHeat = 0; ped.alarmed = 0; ped.surrender = false;
    ped.homeGuard = ped.homeGuard || (pg.center ? { x: pg.center.x, z: pg.center.z } : null);
    // give them the shared lifecycle stat sheet so they climb the ladder on
    // merit like any NPC: bodies they put in + cash they earn = promotions.
    if (CBZ.cityMemberStats) { const s = CBZ.cityMemberStats(ped); s.loyalty = Math.max(s.loyalty, 0.7); }
    if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(ped);
    styleMember(ped, pg.color);
  }
  CBZ.cityPlayerGangEnlist = enlist;

  // ---- FOUND your own gang on the block you're standing on ----
  CBZ.cityPlayerGangFound = function (name, color) {
    const pg = ensure();
    if (pg.founded) { CBZ.city.note("You already run the " + pg.name + ".", 1.8); return false; }
    const crew = CBZ.cityPeds.filter((p) => p.companion && p.recruited && !p.dead && p.kind === "crew");
    if (crew.length < 3) { CBZ.city.note("Need 3 crew to found a gang (you have " + crew.length + "). Recruit more 🔫.", 2.6); return false; }
    pg.name = name || (pick(NAME_A) + " " + pick(NAME_B));
    pg.color = color != null ? color : pick(FOUND_COLORS).hex;
    pg.founded = true;
    // claim the block under your feet as turf
    const P = CBZ.player;
    pg.center = { x: P.pos.x, z: P.pos.z };
    claimTurfAt(P.pos.x, P.pos.z);
    // first three crew enlisted; the senior one becomes your Lieutenant
    crew.forEach((c, i) => enlist(c, i === 0 ? "lt" : "soldier"));
    g.career = "gangster";
    pg.order = "follow"; applyOrder();
    g.cityCrew = liveMembers().length;
    CBZ.city.big("🩸 " + pg.name + " FOUNDED");
    CBZ.city.note("You run the " + pg.name + " now. [O] to give orders.", 3.2);
    CBZ.city.addRespect(15);
    if (CBZ.cityRankEvent) CBZ.cityRankEvent("gang-founded", { members: crew.length });
    if (CBZ.sfx) CBZ.sfx("win");
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    showOrdersHud();
    return true;
  };

  // claim the abandoned lot / nearest block as turf (paints it your colour)
  function claimTurfAt(x, z) {
    const pg = ensure();
    const A = CBZ.city && CBZ.city.arena; if (!A) return;
    let best = null, bd = 24 * 24;
    const pool = (A.abandonedLots && A.abandonedLots.length) ? A.abandonedLots : (A.lots || []);
    for (const lot of pool) {
      const dd = (lot.cx - x) * (lot.cx - x) + (lot.cz - z) * (lot.cz - z);
      if (dd < bd) { bd = dd; best = lot; }
    }
    if (!best) return;
    const fresh = pg.turf.indexOf(best) < 0 || !(best.building && best.building.playerTurf);
    if (pg.turf.indexOf(best) < 0) pg.turf.push(best);
    best.building = best.building || {};
    best.building.gang = pg.id; best.building.gangColor = pg.color; best.building.playerTurf = true;
    pg.center = pg.center || { x: best.cx, z: best.cz };
    // also register us in CBZ.cityGangs so cityGangOf()/turf HUD/the war
    // director see player turf like any other faction's
    registerInGangList();
    if (CBZ.cityRefreshTurfHud) CBZ.cityRefreshTurfHud();   // re-derive zone ownership/colour
    CBZ.city && CBZ.city.note("Claimed this block for the " + pg.name + ".", 2.2);
    if (fresh && CBZ.cityRankEvent) CBZ.cityRankEvent("turf", { lot: best });
    CBZ.cityHudDirty && CBZ.cityHudDirty();
  }
  CBZ.cityPlayerGangClaimTurf = claimTurfAt;

  // mirror g.playerGang into CBZ.cityGangs so shared systems treat it as a gang
  function registerInGangList() {
    const pg = g.playerGang; if (!pg || !pg.founded) return;
    if (!CBZ.cityGangs) return;
    let rec = CBZ.cityGangs.find((x) => x.id === pg.id);
    if (!rec) {
      rec = { id: pg.id, name: pg.name, color: pg.color, turf: pg.turf, center: pg.center || { x: 0, z: 0 }, provoke: 0, members: pg.members, warWith: null, warRemain: 0, isPlayer: true };
      CBZ.cityGangs.push(rec);
    } else {
      rec.name = pg.name; rec.color = pg.color; rec.turf = pg.turf; rec.members = pg.members; rec.center = pg.center || rec.center;
    }
  }

  // ---- TAKE OVER a rival gang (its boss just died to the player) ----
  // gangs.js calls this with the dead boss's gang record.
  let pendingClaim = null;
  CBZ.cityPlayerGangBossKilled = function (gangRec) {
    if (!gangRec || gangRec.isPlayer || gangRec.id === "player") return;
    pendingClaim = { rec: gangRec, t: 20 };
    CBZ.city.big("👑 " + (gangRec.name || "Gang") + " BOSS DOWN");
    CBZ.city.note("Press [O] → Claim the " + (gangRec.name || "gang") + " (defect its crew to you).", 4);
  };

  function claimRivalGang(rec) {
    if (!rec) return false;
    const pg = ensure();
    if (!pg.founded) { pg.founded = true; pg.name = rec.name; pg.color = rec.color; }
    pg.center = pg.center || (rec.center ? { x: rec.center.x, z: rec.center.z } : null);
    // their turf becomes yours
    for (const lot of (rec.turf || [])) {
      if (pg.turf.indexOf(lot) < 0) pg.turf.push(lot);
      if (lot.building) { lot.building.gang = pg.id; lot.building.gangColor = pg.color; lot.building.playerTurf = true; }
    }
    // surviving members defect
    let defected = 0;
    for (const m of (rec.members || []).slice()) {
      if (!m || m.dead || m === rec.boss) continue;
      enlist(m, m.rank === "lt" ? "lt" : "soldier");
      defected++;
    }
    // strip the old gang record (it's absorbed)
    rec.turf = []; rec.members = []; rec.absorbed = true; rec.provoke = 0;
    const i = CBZ.cityGangs ? CBZ.cityGangs.indexOf(rec) : -1;
    if (i >= 0) CBZ.cityGangs.splice(i, 1);
    registerInGangList();
    if (CBZ.cityRefreshTurfHud) CBZ.cityRefreshTurfHud();   // zones now fly your colour
    g.career = "gangster";
    g.cityCrew = liveMembers().length;
    pendingClaim = null;
    CBZ.city.big("🩸 " + pg.name + " TAKEOVER");
    CBZ.city.note("You took over the " + rec.name + ". " + defected + " soldiers ride with you now.", 3.4);
    CBZ.city.addRespect(25);
    if (CBZ.cityRankEvent) CBZ.cityRankEvent("takeover", { gang: rec, defected });
    if (CBZ.sfx) CBZ.sfx("win");
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    showOrdersHud();
    return true;
  }

  // ============================================================
  //  PROSPECTING + INITIATION — the player JOINS an existing crew (researched
  //  street path, distinct from founding/taking over). The lifecycle:
  //    1) PROSPECT a gang (pick a crew whose turf you're on / near a member).
  //    2) Build STANDING: hang on their turf, do favors, and PUT IN WORK
  //       (drop a rival for them). Standing unlocks the initiation offer.
  //    3) Get INITIATED two real ways:
  //         JUMPED IN  — survive a timed beating from 3+ members (take the
  //                      punishment without going down = heart).
  //         PUT IN WORK — accept a hit contract on a named rival; fulfil it.
  //    4) On success you're PATCHED IN at the bottom rank and climb on merit;
  //       the player's street XP + bodies feed your standing inside the crew,
  //       and you can later rise to lead it.
  // ============================================================
  // membership-in-an-NPC-gang state (the player as a MEMBER, not the boss)
  function memb() {
    if (!g.cityMembership) g.cityMembership = null;
    return g.cityMembership;   // { gangId, rank, standing, bodies, contrib, loyalty }
  }
  CBZ.cityMembership = memb;
  let prospecting = null;    // { gangId, standing, t } while courting a crew
  let jumpedIn = null;       // { gangId, t, hits, need } during a jump-in beating
  let workContract = null;   // { gangId, target, t } during a put-in-work hit

  function gangRecById(id) { return (CBZ.cityGangs || []).find((x) => x.id === id); }
  function gangShort(rec) { return rec ? shortGang(rec.name) : "them"; }

  // nearest rival crew the player could prospect (on/near their turf, has a boss)
  function prospectableGang() {
    const P = CBZ.player; if (!P) return null;
    // prefer the turf you're standing in
    const here = CBZ.cityGangOf && CBZ.cityGangOf(P.pos.x, P.pos.z);
    if (here && !here.isPlayer && !here.absorbed && here.boss && !here.boss.dead) return here;
    return nearestRival();
  }

  // begin prospecting a crew
  CBZ.cityProspectGang = function (rec) {
    rec = rec || prospectableGang();
    if (!rec) { CBZ.city.note("No crew nearby to prospect. Find a gang's turf.", 2.2); return false; }
    if (exists()) { CBZ.city.note("You already run your own gang.", 2); return false; }
    if (memb()) { CBZ.city.note("You're already patched into a crew.", 2); return false; }
    if (CBZ.cityAtWar && CBZ.cityAtWar("player", rec.id)) { CBZ.city.note(gangShort(rec) + " are at war with you. Make peace first.", 2.4); return false; }
    prospecting = { gangId: rec.id, standing: 0, t: 0 };
    CBZ.city.big("PROSPECTING: " + (rec.name || "gang"));
    CBZ.city.note("Hang on their turf + put in work. Drop a rival for them, then [O] → get initiated.", 4);
    if (CBZ.cityGangProvoke) { /* prospecting calms them toward you a touch */ }
    return true;
  };

  // current prospect standing 0..1 (HUD/menu reads this)
  CBZ.cityProspectStanding = function () { return prospecting ? Math.min(1, prospecting.standing) : 0; };

  // the gang accepts you for initiation once standing is high enough
  function initiationReady() { return !!(prospecting && prospecting.standing >= 1); }

  // ---- JUMP IN: survive a beating from the crew ----
  function startJumpIn(rec) {
    const live = rec.members.filter((m) => m && !m.dead && m !== rec.boss);
    const need = Math.min(4, Math.max(3, live.length));   // researched: fight 3+ members
    // turn the nearest members hostile-to-player but NON-LETHAL (fists): we set a
    // jumpIn flag the brain doesn't know about, and steer them to swarm + we cap
    // damage in our own tick so it can't actually kill you.
    let n = 0;
    for (const m of live) {
      if (n >= need) break;
      m._jumpIn = true; m._oldW = m.weapon; m.rage = CBZ.city.playerActor; m.state = "fight";
      m.weapon = "Bat"; if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(m);   // fists/bats only — a beating, not a shooting
      m.target.set(CBZ.player.pos.x, 0, CBZ.player.pos.z); m.pause = 0; m.path = null;
      n++;
    }
    jumpedIn = { gangId: rec.id, t: 12, need: n, startHp: CBZ.player.hp || 100 };
    CBZ.city.big("🥊 JUMPED IN — SURVIVE");
    CBZ.city.note("Take the beating. Stay on your feet for the count. Don't fight back to death.", 3.6);
    if (CBZ.sfx) CBZ.sfx("punch");
  }

  function endJumpIn(success, rec) {
    if (jumpedIn) {
      for (const m of (rec ? rec.members : [])) { if (m && m._jumpIn) { m._jumpIn = false; m.rage = null; m.state = "walk"; m.weapon = m._oldW || "Pistol"; m._oldW = null; if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(m); } }
    }
    jumpedIn = null;
    if (success) patchIn(rec, "jumped");
    else { CBZ.city.big("YOU FOLDED"); CBZ.city.note("You couldn't take it. " + gangShort(rec) + " sent you packing.", 3); prospecting = null; }
  }

  // ---- PUT IN WORK: accept a hit contract; fulfil it to be patched in ----
  function startWork(rec) {
    // pick a named rival member of a DIFFERENT gang as the mark
    let mark = null, bd = Infinity; const P = CBZ.player;
    for (const p of CBZ.cityPeds) {
      if (!p || p.dead || !p.gang || p.gang === rec.id || p.gang === "player") continue;
      if (CBZ.cityAreAllied && CBZ.cityAreAllied(rec.id, p.gang)) continue;
      const d = Math.hypot(p.pos.x - P.pos.x, p.pos.z - P.pos.z);
      if (d < bd) { bd = d; mark = p; }
    }
    if (!mark) { CBZ.city.note("No rival mark around. Find a rival gang member to hit.", 2.6); return false; }
    workContract = { gangId: rec.id, target: mark, t: 90 };
    if (CBZ.cityMarkTarget) CBZ.cityMarkTarget(mark);   // optional waypoint hook (no-op if absent)
    CBZ.city.big("🎯 PUT IN WORK");
    CBZ.city.note("Hit " + (mark.name || "the marked rival") + " (" + gangShort(gangRecById(mark.gang)) + ") to earn your patch.", 4);
    return true;
  }

  // patch the player into the crew as the lowest rank — now a real member
  function patchIn(rec, how) {
    if (!rec || rec.absorbed) return;
    g.cityMembership = { gangId: rec.id, rank: "prospect", standing: 0, bodies: 0, contrib: 0, loyalty: 0.6, how: how };
    prospecting = null; workContract = null; jumpedIn = null;
    g.playerGangId = rec.id;       // peds.js / turf can read which crew you ride with
    // your standing with this crew flips friendly: make them stop seeing you as prey
    if (CBZ.cityGangSetPlayerFriendly) CBZ.cityGangSetPlayerFriendly(rec.id, true);
    g.career = g.career || "gangster";
    CBZ.city.big("🩸 PATCHED IN — " + (rec.name || "gang"));
    CBZ.city.note("You're a Prospect in the " + (rec.name || "gang") + " (" + (how === "jumped" ? "jumped in" : "put in work") + "). Climb on merit. [O] for crew.", 4.5);
    CBZ.city.addRespect(12);
    if (CBZ.cityRankEvent) CBZ.cityRankEvent("gang-joined", { gang: rec, how });
    if (CBZ.sfx) CBZ.sfx("win");
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    showOrdersHud();
  }
  CBZ.cityJoinGang = function (rec, how) { patchIn(rec || prospectableGang(), how || "work"); };

  // leave a crew you joined (rage-quit / get out) — drops you to civilian
  CBZ.cityLeaveGang = function () {
    const m = memb(); if (!m) { CBZ.city.note("You're not in a crew.", 1.6); return; }
    const rec = gangRecById(m.gangId);
    if (CBZ.cityGangSetPlayerFriendly && rec) CBZ.cityGangSetPlayerFriendly(rec.id, false);
    if (rec && CBZ.cityGangProvoke) CBZ.cityGangProvoke(rec.id, 0.7);   // leaving sours them
    g.cityMembership = null; g.playerGangId = null;
    CBZ.city.big("LEFT THE " + (rec ? gangShort(rec).toUpperCase() : "GANG"));
    CBZ.city.note("You walked away from the crew. They won't forget it.", 3);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  };

  // promote the PLAYER inside the crew they're a member of, on earned merit.
  // rank ladder mirrors gangs.js: prospect->lookout->runner->soldier->enforcer->lt.
  const MEMBER_LADDER = ["prospect", "lookout", "runner", "soldier", "enforcer", "lt"];
  const MEMBER_NEED = { lookout: { body: 1, contrib: 80 }, runner: { body: 2, contrib: 220 }, soldier: { body: 4, contrib: 520 }, enforcer: { body: 8, contrib: 1100 }, lt: { body: 14, contrib: 2200 } };
  function tryMemberPromote() {
    const m = memb(); if (!m) return;
    const idx = MEMBER_LADDER.indexOf(m.rank);
    if (idx < 0 || idx >= MEMBER_LADDER.length - 1) return;
    const next = MEMBER_LADDER[idx + 1], need = MEMBER_NEED[next];
    if (!need) return;
    if (m.bodies >= need.body && m.contrib >= need.contrib) {
      m.rank = next;
      const rec = gangRecById(m.gangId);
      CBZ.city.big("⬆ YOU MADE " + (CBZ.cityRankName ? CBZ.cityRankName(next).toUpperCase() : next.toUpperCase()));
      CBZ.city.note((rec ? rec.name : "The crew") + " bumped you to " + (CBZ.cityRankName ? CBZ.cityRankName(next) : next) + ".", 3);
      CBZ.city.addRespect(6);
      if (CBZ.sfx) CBZ.sfx("win");
      if (CBZ.cityRankEvent) CBZ.cityRankEvent("member-rankup", { rank: next });
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    }
  }
  // other systems credit the player's in-crew work here (kills/cash kicked up)
  CBZ.cityMemberPutInWork = function (kind, amount) {
    const m = memb(); if (!m) return;
    if (kind === "body") { m.bodies += (amount || 1); m.loyalty = Math.min(1, m.loyalty + 0.04); }
    else if (kind === "cash") { m.contrib += (amount || 0); }
    else if (kind === "standing") { m.standing = Math.min(2, m.standing + (amount || 0.1)); }
    tryMemberPromote();
  };

  // ---- credit PLAYER kills toward prospecting/membership (non-invasively) ----
  // We wrap the public cityRankEvent (preserving the original): on a player
  // "kill" it carries the victim's gang id, which is exactly the signal we need
  // to score work for the crew you're courting / riding with.
  function isHostileTo(gangId, victimGangId) {
    if (!victimGangId || victimGangId === gangId) return false;       // never your own crew
    if (victimGangId === "player") return false;
    if (CBZ.cityAreAllied && CBZ.cityAreAllied(gangId, victimGangId)) return false;
    return true;   // a rival / unaligned crew = a real body for the gang
  }
  function creditPlayerKill(detail) {
    if (!detail) return;
    const vg = detail.gang || null;
    // a player kill that satisfies an open WORK CONTRACT → flag it so the tick
    // only patches you in on YOUR hit (not a rival happening to drop the mark)
    if (workContract && workContract.target && detail.ped === workContract.target) workContract._byPlayer = true;
    // PROSPECTING: dropping a rival is "putting in work" → big standing jump
    if (prospecting && !memb()) {
      if (isHostileTo(prospecting.gangId, vg) || (vg == null && detail.armed)) {
        prospecting.standing = Math.min(1.2, prospecting.standing + (detail.boss ? 0.7 : 0.45));
        const rec = gangRecById(prospecting.gangId);
        if (initiationReady()) CBZ.city.note((rec ? gangShort(rec) : "They") + " are impressed. [O] → get initiated.", 3);
        else CBZ.city.note("Work logged with " + (rec ? gangShort(rec) : "the crew") + " (" + Math.round(prospecting.standing * 100) + "%).", 2);
      }
    }
    // MEMBERSHIP: every rival you drop is a body that climbs you up the crew ranks
    const M = memb();
    if (M && isHostileTo(M.gangId, vg)) {
      CBZ.cityMemberPutInWork("body", detail.boss ? 3 : 1);
      CBZ.cityMemberPutInWork("cash", detail.boss ? 400 : (detail.armed ? 120 : 70));   // proceeds kicked up
    }
  }
  // wrap once, after the rest of the boot has defined cityRankEvent (promotion.js)
  function wrapRankEvent() {
    if (!CBZ.cityRankEvent || CBZ.cityRankEvent._pgWrapped) return true;
    const orig = CBZ.cityRankEvent;
    CBZ.cityRankEvent = function (type, data) {
      const r = orig.apply(this, arguments);
      if (type === "kill") { try { creditPlayerKill(data || {}); } catch (e) {} }
      return r;
    };
    CBZ.cityRankEvent._pgWrapped = true;
    return true;
  }
  if (!wrapRankEvent()) { let t = 0; const iv = setInterval(function () { if (wrapRankEvent() || ++t > 40) clearInterval(iv); }, 250); }

  // ---- promote a crew member one rung UP the shared ladder ----
  // Climbs prospect->lookout->runner->soldier->enforcer->lt (Boss is you). Uses
  // the gangs.js engine so gear + tag + loyalty all stay consistent with NPCs.
  CBZ.cityPlayerGangPromote = function (ped) {
    if (!CBZ.cityPlayerGangIsMember(ped)) { CBZ.city.note("They're not in your gang.", 1.6); return; }
    if (ped.rank === "lt") { CBZ.city.note(ped.name + " is already your Lieutenant — the top under you.", 2); return; }
    const ladder = ["prospect", "lookout", "runner", "soldier", "enforcer", "lt"];
    const i = ladder.indexOf(ped.rank); const next = ladder[Math.max(0, i) + 1] || "lt";
    if (CBZ.cityGangRankUp) CBZ.cityGangRankUp(ped, next);
    else { ped.rank = next; ped.maxHp = Math.max(ped.maxHp || 160, 200); ped.hp = ped.maxHp; }
    styleMember(ped, g.playerGang.color);
    const pip = rankPip(next);
    CBZ.city.big("⬆ " + (ped.name || "Crew") + " → " + pip.toUpperCase());
    CBZ.city.note((ped.name || "They") + " made " + pip + "." + (next === "lt" ? " Tell them to HOLD a block and lead a squad." : ""), 3);
    CBZ.city.addRespect(4);
    if (CBZ.cityRankEvent) CBZ.cityRankEvent("promote", { ped });
  };

  // auto-promote YOUR crew on merit too (their tracked bodies + earned cut),
  // so a long-running gang grows real veterans without micromanagement.
  function autoPromotePlayerCrew() {
    const pg = g.playerGang; if (!pg || !pg.founded || !CBZ.cityMemberStats) return;
    const ladder = ["prospect", "lookout", "runner", "soldier", "enforcer", "lt"];
    const need = { lookout: { b: 1, c: 60 }, runner: { b: 2, c: 180 }, soldier: { b: 3, c: 380 }, enforcer: { b: 6, c: 800 }, lt: { b: 10, c: 1600 } };
    for (const m of liveMembers()) {
      const i = ladder.indexOf(m.rank); if (i < 0 || i >= ladder.length - 1) continue;
      const nx = ladder[i + 1], rq = need[nx]; if (!rq) continue;
      const s = CBZ.cityMemberStats(m);
      if (s.bodies >= rq.b && s.earned >= rq.c) {
        if (CBZ.cityGangRankUp && CBZ.cityGangRankUp(m, nx)) { styleMember(m, pg.color); }
      }
    }
  }

  // ---- enemy targeting for the ATTACK order ----
  function aimedEnemy() {
    const P = CBZ.player, px = P.pos.x, pz = P.pos.z;
    const y = CBZ.cam ? CBZ.cam.yaw : 0, fx = -Math.sin(y), fz = -Math.cos(y);
    let best = null, bestDot = 0.35, bd = 60;
    const consider = (p) => {
      if (!p || p.dead || p === P) return;
      if (CBZ.cityPlayerGangIsMember(p)) return;
      if (p.faction === "player" || p.companion) return;
      const dx = p.pos.x - px, dz = p.pos.z - pz, d = Math.hypot(dx, dz);
      if (d < 0.5 || d > bd) return;
      const dot = (dx / d) * fx + (dz / d) * fz;
      if (dot > bestDot) { bestDot = dot; best = p; }
    };
    for (const p of CBZ.cityPeds) consider(p);
    if (CBZ.cityCops) for (const c of CBZ.cityCops) consider(c);
    // fall back to plain nearest hostile if nothing in the cone
    if (!best) {
      let nd = 28 * 28;
      const near = (p) => {
        if (!p || p.dead || CBZ.cityPlayerGangIsMember(p) || p.faction === "player" || p.companion) return;
        const dd = (p.pos.x - px) * (p.pos.x - px) + (p.pos.z - pz) * (p.pos.z - pz);
        if (dd < nd) { nd = dd; best = p; }
      };
      for (const p of CBZ.cityPeds) if (p.gang && p.gang !== "player") near(p);
      if (!best && (g.wanted | 0) >= 1 && CBZ.cityCops) for (const c of CBZ.cityCops) near(c);
    }
    return best;
  }

  // ---- the order system ----
  function issueOrder(kind) {
    const pg = ensure();
    if (!pg.founded) { CBZ.city.note("Found or take over a gang first.", 1.8); return; }
    const mem = liveMembers();
    if (!mem.length) { CBZ.city.note("No crew to command.", 1.6); return; }
    pg.order = kind; pg.orderTarget = null;
    if (kind === "attack") {
      const foe = aimedEnemy();
      if (!foe) { CBZ.city.note("No enemy in sight to attack.", 1.8); pg.order = "follow"; applyOrder(); return; }
      pg.orderTarget = foe;
      CBZ.city.big("⚔ ATTACK");
      CBZ.city.note("Crew attacks " + (foe.name || (foe.kind === "cop" ? "the cop" : "the target")) + "!", 2);
      // attacking the cops openly is a crime spree
      if (foe.kind === "cop") CBZ.cityCrime && CBZ.cityCrime(60, { x: foe.pos.x, z: foe.pos.z, type: "gang-assault" });
      if (foe.gang && CBZ.cityGangProvoke) CBZ.cityGangProvoke(foe.gang, 1);
    } else if (kind === "hold") {
      const P = CBZ.player; pg.holdPoint = { x: P.pos.x, z: P.pos.z };
      claimTurfAt(P.pos.x, P.pos.z);
      CBZ.city.big("🛡 HOLD HERE");
      CBZ.city.note("Crew posts up and holds this block.", 2);
    } else if (kind === "follow") {
      CBZ.city.big("🏃 FOLLOW");
      CBZ.city.note("Crew falls in with you.", 1.6);
    } else if (kind === "disperse") {
      CBZ.city.big("🚶 DISPERSE");
      CBZ.city.note("Crew melts back to the turf.", 1.6);
    }
    applyOrder();
    showOrdersHud();
  }
  CBZ.cityPlayerGangOrder = issueOrder;

  // push the current order onto every member's ped fields. The ped brain
  // (peds.js) does the heavy lifting from these inputs each frame.
  function applyOrder() {
    const pg = g.playerGang; if (!pg || !pg.founded) return;
    const mem = liveMembers();
    const P = CBZ.player;
    for (const m of mem) {
      if (pg.order === "follow") {
        m.companion = true; m.guard = null; m.rage = null;
      } else if (pg.order === "attack") {
        m.companion = false; m.guard = null;
        if (pg.orderTarget && !pg.orderTarget.dead) { m.rage = pg.orderTarget; m.state = "fight"; m.target.set(pg.orderTarget.pos.x, 0, pg.orderTarget.pos.z); m.pause = 0; m.path = null; }
      } else if (pg.order === "hold") {
        m.companion = false; m.rage = null;
        const gp = pg.holdPoint || pg.center || { x: P.pos.x, z: P.pos.z };
        m.guard = { x: gp.x, z: gp.z }; m.homeGuard = { x: gp.x, z: gp.z };
        m.target.set(gp.x + (Math.random() - 0.5) * 4, 0, gp.z + (Math.random() - 0.5) * 4); m.pause = 0; m.path = null;
      } else if (pg.order === "disperse") {
        m.companion = false; m.rage = null;
        const h = m.homeGuard || pg.center || { x: P.pos.x, z: P.pos.z };
        m.guard = { x: h.x, z: h.z };
        m.target.set(h.x + (Math.random() - 0.5) * 6, 0, h.z + (Math.random() - 0.5) * 6); m.pause = 0; m.path = null;
      }
    }
    g.cityCrew = mem.length;
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }
  CBZ.cityPlayerGangApply = applyOrder;

  // ---- turf defence: rivals can raid; your crew (and any LT holding it) fight ----
  // The ped brain already makes guards engage rival gangs on turf. We add the
  // war hook so a rival raiding YOUR block bumps everyone to defend it.
  CBZ.cityPlayerGangDefendTurf = function (x, z) {
    const pg = g.playerGang; if (!pg || !pg.founded) return;
    for (const m of liveMembers()) {
      if (m.companion) continue;       // following crew stays with you
      if (!m.guard) m.guard = pg.center ? { x: pg.center.x, z: pg.center.z } : { x, z };
    }
  };

  // ---- on-screen orders HUD ----
  let hudEl = null, hudHideT = 0;
  function buildHud() {
    if (hudEl) return hudEl;
    hudEl = document.createElement("div");
    hudEl.id = "cityOrders";
    hudEl.style.cssText = "position:fixed;left:14px;bottom:120px;z-index:40;display:none;background:rgba(14,16,22,.82);border:2px solid #3a3140;border-radius:12px;padding:8px 12px;color:#e8eef7;font-family:Fredoka,system-ui,sans-serif;font-size:13px;line-height:1.5;pointer-events:none;box-shadow:0 8px 28px rgba(0,0,0,.5)";
    document.body.appendChild(hudEl);
    return hudEl;
  }
  function showOrdersHud() { hudHideT = 6; renderHud(); }
  function renderHud() {
    const pg = g.playerGang;
    buildHud();
    if (g.mode !== "city") { hudEl.style.display = "none"; return; }
    // membership / prospect status (when you ride with someone else's crew)
    if (!pg || !pg.founded) {
      const M = memb();
      if (M) {
        const rec = gangRecById(M.gangId);
        const pip = CBZ.cityRankName ? CBZ.cityRankName(M.rank) : M.rank;
        hudEl.innerHTML =
          "<div style='font-weight:700;color:" + hex6(rec ? rec.color : 0x8a93a3) + "'>🩸 " + (rec ? rec.name : "Crew") + "</div>" +
          "<div style='color:#aeb6c2'>You: <b style='color:#e8eef7'>" + pip + "</b> · Bodies " + M.bodies + "</div>" +
          "<div style='color:#8a93a3;font-size:11px;margin-top:2px'>Put in work to climb · [O] crew</div>";
        hudEl.style.display = "block"; return;
      }
      if (prospecting) {
        const rec = gangRecById(prospecting.gangId);
        const pct = Math.round(Math.min(1, prospecting.standing) * 100);
        hudEl.innerHTML =
          "<div style='font-weight:700;color:#ffd166'>🤝 Prospecting " + (rec ? shortGang(rec.name) : "a crew") + "</div>" +
          "<div style='color:#aeb6c2'>Standing <b style='color:#e8eef7'>" + pct + "%</b>" + (initiationReady() ? " — ready!" : "") + "</div>" +
          "<div style='color:#8a93a3;font-size:11px;margin-top:2px'>Hang on turf + drop rivals · [O]</div>";
        hudEl.style.display = "block"; return;
      }
      hudEl.style.display = "none"; return;
    }
    const mem = liveMembers();
    const lts = mem.filter((m) => m.rank === "lt").length;
    const orderName = { follow: "FOLLOW", attack: "ATTACK", hold: "HOLD", disperse: "DISPERSE" }[pg.order] || "—";
    hudEl.innerHTML =
      "<div style='font-weight:700;color:" + hex6(pg.color) + "'>🩸 " + (pg.name || "Your Gang") + "</div>" +
      "<div style='color:#aeb6c2'>Crew <b style='color:#e8eef7'>" + mem.length + "</b> · Lts " + lts + " · Turf " + pg.turf.length + "</div>" +
      "<div style='color:#ffd166'>Order: <b>" + orderName + "</b></div>" +
      "<div style='color:#8a93a3;font-size:11px;margin-top:2px'>[O] orders menu</div>";
    hudEl.style.display = "block";
  }

  // ---- the [O] orders menu (radial-ish list, reuses the menu-open lock) ----
  let menuEl = null;
  function buildMenu() {
    if (menuEl) return menuEl;
    menuEl = document.createElement("div");
    menuEl.id = "cityOrderMenu";
    menuEl.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:49;display:none;min-width:300px;background:rgba(14,16,22,.96);border:2px solid #3a3140;border-radius:16px;padding:16px 18px;color:#e8eef7;font-family:Fredoka,system-ui,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.55);pointer-events:auto";
    document.body.appendChild(menuEl);
    menuEl.addEventListener("click", function (e) {
      const row = e.target.closest && e.target.closest(".oopt");
      if (row && row.dataset.act) doMenu(row.dataset.act);
    });
    return menuEl;
  }
  let menuActs = [];
  function openMenu() {
    if (g.mode !== "city" || g.state !== "playing" || CBZ.player.dead) return;
    if (CBZ.cityMenuOpen) return;
    buildMenu();
    const pg = ensure();
    menuActs = [];
    let html = "<div style='font-size:20px;font-weight:700;margin-bottom:8px'>🎖 Gang Orders</div>";
    const add = (act, label, color) => { menuActs.push(act); const i = menuActs.length; html += "<div class='oopt' data-act='" + act + "' style='padding:5px 0;cursor:pointer'><b style='color:#ffd166'>" + i + "</b> <span style='color:" + (color || "#e8eef7") + "'>" + label + "</span></div>"; };
    if (pendingClaim && pendingClaim.rec && !pendingClaim.rec.absorbed) {
      add("claim", "👑 CLAIM the " + pendingClaim.rec.name + " (take over)", "#ffd166");
    }
    const M = memb();
    if (M && !pg.founded) {
      // YOU are a patched member of someone else's crew — show your standing
      const rec = gangRecById(M.gangId);
      const pip = CBZ.cityRankName ? CBZ.cityRankName(M.rank) : M.rank;
      html += "<div style='color:" + hex6(rec ? rec.color : 0x8a93a3) + ";font-weight:700;margin:-2px 0 6px'>🩸 " + (rec ? rec.name : "Your crew") + " — you're a " + pip + "</div>";
      html += "<div style='color:#aeb6c2;font-size:12px;margin:-4px 0 8px'>Bodies " + M.bodies + " · Kicked up $" + Math.round(M.contrib) + "</div>";
      add("leavegang", "🚪 LEAVE the crew", "#ff9a9a");
    } else if (prospecting && !pg.founded) {
      const rec = gangRecById(prospecting.gangId);
      const pct = Math.round(Math.min(1, prospecting.standing) * 100);
      html += "<div style='color:#ffd166;margin:-2px 0 6px'>Prospecting " + (rec ? rec.name : "a crew") + " — standing " + pct + "%</div>";
      if (initiationReady()) {
        add("jumpin", "🥊 GET JUMPED IN (survive the beating)", "#ff9a9a");
        add("putwork", "🎯 PUT IN WORK (hit a rival mark)", "#ffd166");
      } else {
        html += "<div style='color:#8a93a3;font-size:12px;margin:-4px 0 8px'>Hang on their turf + drop a rival to earn the offer.</div>";
        add("putwork", "🎯 PUT IN WORK now (hit a rival mark)", "#ffd166");
        add("stopprospect", "✖ Stop prospecting", "#aeb6c2");
      }
    }
    if (!pg.founded && !M) {
      const crew = CBZ.cityPeds.filter((p) => p.companion && p.recruited && !p.dead && p.kind === "crew").length;
      add("found", "🩸 FOUND your own gang (" + crew + "/3 crew)", crew >= 3 ? "#7ed957" : "#ff9a9a");
      if (!prospecting) {
        const pr = prospectableGang();
        if (pr) add("prospect", "🤝 PROSPECT the " + shortGang(pr.name) + " (join them)", "#9be564");
      }
    }
    if (pg.founded) {
      add("attack", "⚔ ATTACK — target your aim", "#ff9a9a");
      add("hold", "🛡 HOLD HERE — claim + defend this block");
      add("follow", "🏃 FOLLOW me");
      add("disperse", "🚶 DISPERSE to turf");
      add("promote", "⬆ PROMOTE nearest crew → Lieutenant", "#7fd0ff");
      add("claimturf", "📍 CLAIM this block as turf");
      // ---- takeover meta (turf.js): buy a weakly-held district, broker pacts ----
      if (CBZ.cityPlayerBuyZone) {
        const z = CBZ.cityZoneAt && CBZ.cityZoneAt(CBZ.player.pos.x, CBZ.player.pos.z);
        if (z && z.owner !== "player") add("buyzone", "💰 BUY OUT this district (" + (z.name || "?") + ")", "#ffd166");
      }
      // ally with / declare war on the nearest rival gang
      const rivalNear = nearestRival();
      if (rivalNear && CBZ.cityAreAllied) {
        if (CBZ.cityAreAllied("player", rivalNear.id))
          add("warrival", "⚔ DECLARE WAR on " + shortGang(rivalNear.name), "#ff9a9a");
        else
          add("allyrival", "🤝 ALLY with " + shortGang(rivalNear.name), "#9be564");
      }
    }
    html += "<div style='font-size:12px;color:#8a93a3;margin-top:10px'>[1–" + menuActs.length + "] choose · [O]/[Esc] close</div>";
    menuEl.innerHTML = html;
    menuEl.style.display = "block";
    CBZ.cityMenuOpen = true;
    if (document.exitPointerLock) try { document.exitPointerLock(); } catch (e) {}
  }
  function closeMenu() { if (menuEl) menuEl.style.display = "none"; CBZ.cityMenuOpen = false; if (CBZ.requestLock && g.state === "playing") CBZ.requestLock(); }
  function doMenu(act) {
    closeMenu();
    if (act === "found") CBZ.cityPlayerGangFound();
    else if (act === "claim") { if (pendingClaim && pendingClaim.rec) claimRivalGang(pendingClaim.rec); }
    else if (act === "attack") issueOrder("attack");
    else if (act === "hold") issueOrder("hold");
    else if (act === "follow") issueOrder("follow");
    else if (act === "disperse") issueOrder("disperse");
    else if (act === "claimturf") claimTurfAt(CBZ.player.pos.x, CBZ.player.pos.z);
    else if (act === "promote") {
      const px = CBZ.player.pos.x, pz = CBZ.player.pos.z;
      let best = null, bd = 14 * 14;
      for (const m of liveMembers()) { if (m.rank === "lt") continue; const dd = (m.pos.x - px) * (m.pos.x - px) + (m.pos.z - pz) * (m.pos.z - pz); if (dd < bd) { bd = dd; best = m; } }
      if (best) CBZ.cityPlayerGangPromote(best);
      else CBZ.city.note("No soldier nearby to promote.", 1.8);
    }
    else if (act === "buyzone") { if (CBZ.cityPlayerBuyZone) CBZ.cityPlayerBuyZone(); }
    else if (act === "allyrival") { const r = nearestRival(); if (r && CBZ.cityPlayerSetRelation) CBZ.cityPlayerSetRelation(r.id, "ally"); }
    else if (act === "warrival") { const r = nearestRival(); if (r && CBZ.cityPlayerSetRelation) CBZ.cityPlayerSetRelation(r.id, "war"); }
    // ---- prospect / initiation / membership ----
    else if (act === "prospect") { CBZ.cityProspectGang(prospectableGang()); }
    else if (act === "stopprospect") { prospecting = null; CBZ.city.note("Walked away from prospecting.", 1.8); }
    else if (act === "jumpin") { const rec = gangRecById(prospecting && prospecting.gangId); if (rec) startJumpIn(rec); }
    else if (act === "putwork") { const rec = gangRecById(prospecting && prospecting.gangId); if (rec) startWork(rec); }
    else if (act === "leavegang") { CBZ.cityLeaveGang(); }
  }

  // ============================================================
  //  PROSPECT / INITIATION / MEMBERSHIP per-frame lifecycle. Runs even when you
  //  have no gang of your own — this is the path to JOINING someone else's crew.
  // ============================================================
  CBZ.onUpdate(34.6, function (dt) {
    if (g.mode !== "city" || g.state !== "playing") return;
    const P = CBZ.player; if (!P || P.dead) {
      // dying mid-jump-in fails the initiation cleanly
      if (jumpedIn) { const rec = gangRecById(jumpedIn.gangId); endJumpIn(false, rec); }
      return;
    }

    // ---- PROSPECTING: build standing by being present + putting in work ----
    if (prospecting && !memb()) {
      const rec = gangRecById(prospecting.gangId);
      if (!rec || rec.absorbed || !rec.boss || rec.boss.dead) { prospecting = null; }
      else {
        prospecting.t += dt;
        // standing trickles up while you HANG on their turf near a member
        const onTurf = CBZ.cityGangOf && CBZ.cityGangOf(P.pos.x, P.pos.z) === rec;
        let nearMember = false;
        for (const m of rec.members) { if (!m.dead && Math.hypot(m.pos.x - P.pos.x, m.pos.z - P.pos.z) < 14) { nearMember = true; break; } }
        if (onTurf && nearMember) prospecting.standing += dt * 0.018;     // slow burn — real prospects grind
        // a body you put in for them (tracked via cityMemberPutInWork from kills)
        // is the fast track; standing>=1 unlocks initiation.
      }
    }

    // ---- JUMP IN: cap incoming damage so it can't kill you; count survival ----
    if (jumpedIn) {
      const rec = gangRecById(jumpedIn.gangId);
      jumpedIn.t -= dt;
      // floor the player's HP at 12 during the ritual — it's a test of heart, not death
      if (P.hp != null && P.hp < 12) P.hp = 12;
      // keep the beaters swarming + non-lethal
      if (rec) for (const m of rec.members) {
        if (!m._jumpIn || m.dead) continue;
        m.rage = CBZ.city.playerActor; if (m.state !== "fight") m.state = "fight";
        m.target.set(P.pos.x, 0, P.pos.z);
      }
      if (jumpedIn.t <= 0) endJumpIn(true, rec);
    }

    // ---- PUT IN WORK contract: mark dies (by you) -> patched in ----
    if (workContract) {
      workContract.t -= dt;
      const rec = gangRecById(workContract.gangId);
      const mk = workContract.target;
      if (!rec || rec.absorbed) { workContract = null; }
      else if (mk && mk.dead && workContract._byPlayer) {
        // confirmed: the player dropped the mark → patched in
        CBZ.city.note("Mark's down. You put in work for " + gangShort(rec) + ".", 2.4);
        patchIn(rec, "work");
      } else if (mk && mk.dead && !workContract._byPlayer) {
        // someone else clipped your mark — contract's blown, pick a new one
        CBZ.city.note("Someone else got to your mark. Find another rival.", 2.4);
        workContract = null;
      } else if (workContract.t <= 0) {
        CBZ.city.big("CONTRACT EXPIRED");
        CBZ.city.note("You took too long. The mark walked.", 2.6);
        workContract = null;
      }
    }

    // ---- MEMBERSHIP upkeep: passive standing/loyalty + auto-promotion ----
    const M = memb();
    if (M) {
      const rec = gangRecById(M.gangId);
      if (!rec || rec.absorbed) {
        // your crew got wiped/absorbed while you rode with them
        g.cityMembership = null; g.playerGangId = null;
      } else {
        // your OWN crew never reads you as a turf intruder — scrub any rage the
        // guard brain pinned on the player (armed+wanted on home turf triggers it)
        const PA = CBZ.city.playerActor;
        for (const m of rec.members) { if (m && (m.rage === PA || (m.rage && m.rage.isPlayer))) { m.rage = null; if (m.state === "fight") m.state = "walk"; } }
        // your boss died → you can step into the SUCCESSION if you're senior
        if ((rec.bossDead || !rec.boss || rec.boss.dead) && (M.rank === "lt" || M.rank === "enforcer")) {
          if (!exists()) {
            // you take the throne: convert membership into OWNING the gang
            rec.bossDead = false;
            claimRivalGang(rec);
            g.cityMembership = null;
            CBZ.city.big("👑 YOU TOOK THE CROWN");
            CBZ.city.note("The boss is dead. You stepped up — the " + (rec.name || "gang") + " is YOURS.", 4);
          } else {
            // you already run your own crew → you PASS on the throne: clear your
            // patch and let the NPC succession crown the next in line (succeedBoss
            // deferred to you while you were senior, so trigger it now).
            g.cityMembership = null;
            if (CBZ.cityGangSucceed) CBZ.cityGangSucceed(rec);
          }
        }
      }
      tryMemberPromote();
    }

    // ---- auto-promote YOUR OWN crew on merit (founded path) ----
    if (g.playerGang && g.playerGang.founded) {
      _autoPromoT = (_autoPromoT || 0) - dt;
      if (_autoPromoT <= 0) { _autoPromoT = 5; autoPromotePlayerCrew(); }
    }

    // keep the status HUD live while prospecting / riding with a crew (the main
    // orders tick only renders once you run your OWN gang)
    if ((prospecting || memb()) && !(g.playerGang && g.playerGang.founded)) renderHud();
  });
  let _autoPromoT = 0;

  // ---- keys ----
  addEventListener("keydown", function (e) {
    if (g.mode !== "city") return;
    const k = e.key.toLowerCase();
    if (menuEl && menuEl.style.display === "block") {
      if (k === "o" || k === "escape") { e.preventDefault(); closeMenu(); return; }
      if (k >= "1" && k <= "9") { e.preventDefault(); const a = menuActs[parseInt(k, 10) - 1]; if (a) doMenu(a); return; }
      return;
    }
    if (g.state !== "playing" || CBZ.player.dead) return;
    if (CBZ.cityMenuOpen) return;
    if (k === "o") { e.preventDefault(); openMenu(); }
  });

  // ---- per-frame driver: keep orders honoured, prune dead, retreat finished ----
  CBZ.onUpdate(34.7, function (dt) {
    if (g.mode !== "city") { if (hudEl) hudEl.style.display = "none"; return; }
    const pg = g.playerGang;
    if (pendingClaim) { pendingClaim.t -= dt; if (pendingClaim.t <= 0) pendingClaim = null; }
    if (!pg || !pg.founded) { if (hudEl) hudEl.style.display = "none"; return; }

    const mem = liveMembers();
    g.cityCrew = mem.length;
    registerInGangList();

    // LOYALTY: your gang NEVER turns on you. The turf-guard brain can read an
    // armed+wanted boss standing on his own block as an "intruder" — scrub any
    // rage aimed at the player (or another member) every frame.
    const PA = CBZ.city.playerActor;
    for (const m of mem) {
      if (m.rage === PA || (m.rage && m.rage.isPlayer)) m.rage = null;
      if (m.rage && CBZ.cityPlayerGangIsMember(m.rage)) m.rage = null;
      m.npcWanted = 0;   // your soldiers don't rack up their own heat for riding with you
    }

    // ATTACK: chase the target; when it's down, sweep to the next nearby foe
    if (pg.order === "attack") {
      if (!pg.orderTarget || pg.orderTarget.dead) {
        const next = aimedEnemy();
        if (next) { pg.orderTarget = next; }
        else { pg.order = "follow"; applyOrder(); CBZ.city.note("Target down. Crew regroups on you.", 2); showOrdersHud(); }
      }
      if (pg.order === "attack" && pg.orderTarget && !pg.orderTarget.dead) {
        for (const m of mem) {
          if (m.companion) m.companion = false;
          if (m.rage !== pg.orderTarget) { m.rage = pg.orderTarget; m.state = "fight"; }
          m.target.set(pg.orderTarget.pos.x, 0, pg.orderTarget.pos.z);
        }
      }
    } else if (pg.order === "follow") {
      // make sure followers stay on the companion brain (a fight may have flipped one)
      for (const m of mem) if (!m.companion) { m.companion = true; m.rage = null; m.guard = null; }
    } else if (pg.order === "hold" || pg.order === "disperse") {
      // re-assert the guard post for any member that drifted off it (unless mid-fight)
      for (const m of mem) {
        if (m.companion) m.companion = false;
        if (!m.guard) { const gp = (pg.order === "hold" ? (pg.holdPoint || pg.center) : (m.homeGuard || pg.center)); if (gp) m.guard = { x: gp.x, z: gp.z }; }
      }
    }

    // HUD lifecycle
    if (hudHideT > 0) { hudHideT -= dt; if (hudHideT <= 0) { /* keep a quiet line while you have a gang */ } }
    renderHud();
  });

  // ---- reset (called from cityCareersReset, which we own) ----
  CBZ.cityPlayerGangReset = function () {
    g.playerGang = null;
    g.cityMembership = null; g.playerGangId = null;
    pendingClaim = null; prospecting = null; jumpedIn = null; workContract = null;
    if (hudEl) hudEl.style.display = "none";
    if (menuEl) menuEl.style.display = "none";
  };
})();
