/* ============================================================
   city/vips.js — THE PROTECTED CLASS: really-high-level NPCs w/ entourages.

   WHY (money + show-off, like everything else)
   --------------------------------------------
   The street already reads levels (level.js) and folds to them (sizeup.js),
   but the ladder TOPS OUT at gang brass guarding their own corners. This file
   puts 3-5 walking summits ON THE SIDEWALK — people whose LEVEL you read from
   a block away and whose wallets justify it:

     • the MAGNATE  — tons of cash + luxe ice, 2-3 suited private security
                      with SMGs. The QUIET-MONEY option: his suits are not the
                      law — drop the whole detail with no civilian witnesses
                      and there is NO heat, just the hardest fight on the block.
     • the DON      — a boss-of-bosses strolling with 3-4 made-men shields in
                      set colors. Touch him and you don't fight four men, you
                      fight the SET (sizeup's rally + gangs.js provoke/hostility
                      /reprisal machinery all fire through his .gang).
     • the SENATOR / JUDGE — modest jewellery, a briefcase that isn't modest,
                      and TWO real uniformed officers walking formation. The
                      cops ARE the protection: they witness everything, so the
                      payday is small and the stars are instant.
     • the STAR     — one bodyguard and a crowd problem: civilians drift over
                      and gawk, which is exactly what makes pickpocket-range
                      chaos possible — and what makes shooting her a spectacle.

   Everything is DERIVED through existing systems, not re-implemented:
   valuables/cash (economy.js top tiers → corpse loot via peds.js deadLoot),
   combat (peds.js move() fight branch + npcAttack), gang war machinery
   (cityGangProvoke / cityRallyGang / cityGangShapeUp / memberDown via .gang),
   police response (REAL ambient cops drafted onto the detail — copWitness,
   stars, chases are all police.js's own), the velvet rope (club.js lot data:
   the bouncer waves the party straight past the line the player queues for),
   and the LEVEL tag (level.js material-swap pattern; see stampTag).

   PERF: principals and guards are DRAFTED from bodies that already exist
   (club.js draftLineGoer / cityRecastForHour pattern) and RELEASED back with
   their stashed identity when the shift ends — the citywide rig count stays
   FLAT. Drafts/recasts only ever touch peds >80u from the camera so nobody
   morphs in view. Fresh spawns are a capped fallback only.

   Driving model: party members are `controlled` (the house pattern — club.js
   bouncer/line, social.js hostages). peds.js think() leaves them alone but
   move() still walks them to .target and, in state "fight" with a .rage,
   chases + fires via npcAttack — so a guard is a full combatant without a
   single new combat line. Police escorts stay UNCONTROLLED real cops; we only
   feed their own patrol fields (patrolGoal/_pauseT) so every police behavior
   (gun stops, chases, arrests) outranks the escort and falls back in after.
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  let _s = 70707;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }
  const hyp = Math.hypot;

  // ============================================================
  //  THE CAST — deterministic-ish rotation. 4 live slots cycle through 5
  //  archetypes ((idx+4) mod 5 keeps the street's mix distinct). Wallets are
  //  priced by PROTECTION: police detail = small bag + instant stars; private
  //  SMGs = the biggest bag, zero heat if nobody living saw it.
  // ============================================================
  const CAST = [
    { kind: "magnate", title: "Magnate", tagColor: "#ffd76a", lvl: [88, 95],
      archetype: "billionaire", job: "owns half the skyline", wealth: 0.99, hp: 120,
      cash: [18000, 42000], valuables: ["Richard Mille", "Briefcase of Cash"],
      guards: 3, guardKind: "suit", suit: 0x171a21,
      stops: ["bank", "jewelry"], club: true,
      form: [{ f: 2.3, s: 0 }, { f: -1.9, s: -1.7 }, { f: -1.9, s: 1.7 }] },
    { kind: "don", title: "Don", tagColor: null /* set color */, lvl: [84, 92],
      archetype: "made", job: "runs the commission", wealth: 0.99, hp: 170, fights: true,
      cash: [9000, 22000], valuables: ["Patek Philippe", "Gold Chain"], weapon: "Pistol",
      guards: 4, guardKind: "made",
      stops: ["casino"], club: true,
      form: [{ f: 2.2, s: -1.5 }, { f: 2.2, s: 1.5 }, { f: -2.2, s: -1.5 }, { f: -2.2, s: 1.5 }] },
    { kind: "senator", title: "Senator", tagColor: "#8fc1ff", lvl: [78, 86],
      archetype: null, job: "the senator", wealth: 0.93, hp: 110,
      cash: [4000, 9000], valuables: ["Briefcase of Cash"],
      guards: 0, cops: 2, suit: 0x2a3146,
      stops: ["cityhall", "bank"], club: false, form: [] },
    { kind: "star", title: "Star", tagColor: "#ff9ad5", lvl: [72, 80],
      archetype: "socialite", job: "famous for being famous", wealth: 0.96, hp: 100,
      cash: [3000, 7000], valuables: ["Diamond Necklace", "Designer Bag"],
      guards: 1, guardKind: "suit", suit: 0xe9e3d6, gawk: true,
      stops: ["clothing", "jewelry"], club: true,
      form: [{ f: 1.8, s: 1.1 }] },
    { kind: "judge", title: "Judge", tagColor: "#cfd8ff", lvl: [76, 84],
      archetype: null, job: "holds the bench", wealth: 0.9, hp: 110,
      cash: [6000, 14000], valuables: ["Omega", "Cash Stack"],
      guards: 0, cops: 2, suit: 0x1f2430,
      stops: ["cityhall"], club: false, form: [] },
  ];
  // escort formation: one officer walks point, one trails (real protective order)
  const COP_FORM = [{ f: 2.6, s: 0.4 }, { f: -2.6, s: -0.4 }];
  const SLOTS = 4;

  const S = { inited: false, slots: [], fresh: 0 };
  CBZ.cityVips = S;   // read-only peek for siblings (phone tips / leaderboard flavor)

  // ---------- tiny shared helpers ----------------------------------------
  function arena() { return CBZ.city && CBZ.city.arena; }
  function camD2(x, z) {
    const c = CBZ.camera; if (!c) return 1e9;
    const dx = x - c.position.x, dz = z - c.position.z;
    return dx * dx + dz * dz;
  }
  const OFFSCREEN2 = 80 * 80;   // beyond peds.js VIS range w/ margin — never morph in view

  // 2-hop routing, same shape as peds.js scheduledGoal (cross at an intersection
  // first so the lap follows streets instead of cutting through blocks).
  function legTo(p, A, x, z) {
    p.state = "walk"; p.pause = 0;
    const d = hyp(x - p.pos.x, z - p.pos.z);
    if (A && A.nearestIntersection && A.step && d > A.step * 0.9) {
      const it = A.nearestIntersection((p.pos.x + x) / 2, (p.pos.z + z) / 2);
      p.path = [{ x: it.x + (rng() - 0.5) * 3, z: it.z + (rng() - 0.5) * 3 }, { x, z }];
    } else p.path = [{ x, z }];
    p.target.set(p.path[0].x, 0, p.path[0].z);
  }

  function corePoint(A) {
    for (let t = 0; t < 10; t++) {
      const p = A.weightedSidewalkPoint ? A.weightedSidewalkPoint(rng) : A.randomSidewalkPoint();
      const d = A.districtAt ? A.districtAt(p.x, p.z) : null;
      if (!d || d.kind === "core" || d.kind === "commercial") return p;
    }
    return A.randomSidewalkPoint();
  }
  function lotDoor(A, kind) {
    for (const l of A.shopLots || []) if (l.kind === kind && l.building && l.building.door) return l.building.door;
    return null;
  }
  function clubSpot(A) {
    for (const l of A.shopLots || []) {
      const c = l.building && l.building.club;
      if (c && c.bouncerSpot) return { x: c.bouncerSpot.x + (c.normal ? c.normal.x * 1.6 : 0), z: c.bouncerSpot.z + (c.normal ? c.normal.z * 1.6 : 0), clubRef: c };
    }
    return null;
  }

  // the lap the player can CASE: a couple of core strolls, the def's shop
  // stops (walks in the door — detail posts outside), the rope if they club.
  function buildRoute(def, A, gang) {
    const r = [];
    const add = (x, z, o) => { r.push(Object.assign({ x, z, dwell: 3 + rng() * 5 }, o || {})); };
    for (let i = 0; i < 2; i++) { const pt = corePoint(A); add(pt.x, pt.z); }
    for (const k of def.stops || []) {
      const d = lotDoor(A, k);
      // door normal points INWARD (buildings.js) — stand just outside, then enter
      if (d) add(d.x - d.nx * 2.0, d.z - d.nz * 2.0, { enter: true, t: 9 + rng() * 7, dwell: 1.5 });
    }
    if (gang && gang.hq) add(gang.hq.x + 2, gang.hq.z + 2, { dwell: 8 });   // the don checks in on the block
    if (def.club) { const c = clubSpot(A); if (c) add(c.x, c.z, { club: true, clubRef: c.clubRef, dwell: 1.2 }); }
    const off = r.length ? (rng() * r.length) | 0 : 0;
    return r.slice(off).concat(r.slice(0, off));
  }

  function spawnPointFor(def, A, gang) {
    if (gang && gang.center) {
      return { x: gang.center.x + (rng() - 0.5) * 8, z: gang.center.z + (rng() - 0.5) * 8 };
    }
    for (let t = 0; t < 12; t++) {
      const p = corePoint(A);
      if (camD2(p.x, p.z) > 70 * 70) return p;
    }
    return corePoint(A);
  }

  // ---------- identity stash / restore (the headcount-flat trick) --------
  function stashPed(p) {
    if (p._vipStash) return;
    p._vipStash = {
      archetype: p.archetype, job: p.job, wealth: p.wealth, aggr: p.aggr,
      armed: p.armed, weapon: p.weapon, ammo: p.ammo, kind: p.kind, cash: p.cash,
      hp: p.hp, maxHp: p.maxHp, baseSpeed: p.baseSpeed, valuables: p.valuables,
      snitch: p.snitch, gang: p.gang || null, faction: p.faction || null,
      rank: p.rank || null, guard: p.guard || null, homeGuard: p.homeGuard || null,
      gstat: p.gstat || null,
    };
  }
  function restorePed(p) {
    const st = p._vipStash; if (!st) return;
    p.archetype = st.archetype; p.job = st.job; p.wealth = st.wealth; p.aggr = st.aggr;
    p.armed = st.armed; p.weapon = st.weapon; p.ammo = st.ammo; p.kind = st.kind;
    p.cash = st.cash; p.hp = Math.min(p.hp, st.maxHp); p.maxHp = st.maxHp;
    p.baseSpeed = st.baseSpeed; p.valuables = st.valuables; p.snitch = st.snitch;
    p.gang = st.gang; p.faction = st.faction; p.rank = st.rank;
    p.guard = st.guard; p.homeGuard = st.homeGuard; p.gstat = st.gstat;
    p._vipStash = null;
    p.controlled = false; p.vip = null; p.vipLvl = 0; p.vipTitle = null;
    p._drip = null; p._dripKey = null;
    p.rage = null; p.state = "walk"; p.path = null; p.pause = 0.5 + rng();
    p._lvlShown = -1; p._lvlMat = null;          // level.js re-tags the honest read next sweep
    p._vipTagText = null; p._vipTagMat = null;
    restoreFit(p);
    if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(p);
  }

  // ---------- the FIT: paint a drafted body into the role ----------------
  // crowd.js setLook pattern: clone the slot materials once (so the shared
  // base material never repaints every rig), then recolor. Original colors
  // are remembered so release() walks the same body off in its own clothes.
  function paintFit(p, hex) {
    const ss = p.char && p.char.skinSlots; if (!ss || hex == null) return;
    const first = (arr) => (arr && arr[0] && arr[0].material && arr[0].material.color) ? arr[0].material.color.getHex() : null;
    if (!p._vipFit0) p._vipFit0 = { torso: first(ss.torso), collar: first(ss.collar), legs: first(ss.legs) };
    if (!p._vipFitIso) {
      const iso = (arr) => (arr || []).forEach((m) => { if (m && m.material) m.material = m.material.clone(); });
      iso(ss.torso); iso(ss.collar); iso(ss.legs); iso(ss.legsLower);
      p._vipFitIso = true;
    }
    const paint = (arr, h) => { if (h == null) return; (arr || []).forEach((m) => { if (m && m.material && m.material.color) m.material.color.setHex(h); }); };
    paint(ss.torso, hex); paint(ss.collar, hex); paint(ss.legs, hex); paint(ss.legsLower, hex);
  }
  function restoreFit(p) {
    const f = p._vipFit0; if (!f) return;
    const ss = p.char && p.char.skinSlots; if (!ss) return;
    const paint = (arr, h) => { if (h == null) return; (arr || []).forEach((m) => { if (m && m.material && m.material.color) m.material.color.setHex(h); }); };
    paint(ss.torso, f.torso); paint(ss.collar, f.collar); paint(ss.legs, f.legs); paint(ss.legsLower, f.legs);
    p._vipFit0 = null;
  }

  // ---------- drafting (zero new rigs) ------------------------------------
  function draftableCiv(p) {
    if (!p || p.dead || p.isPlayer || p.vendor || p.gang || p.kind !== "civilian") return false;
    if (p.controlled || p.companion || p.recruited || p.vagrant || p._crowd || p._parked || p.inCar || p.enterT > 0) return false;
    if ((p.npcWanted | 0) || p.bounty || p.rage || p.surrender || p.reportState || p.approach || p.ko > 0) return false;
    if (p.isFamily || p.protectGang || p._clubLine || p._clubGoingIn || p.hostage || p.kidnapped) return false;
    if (camD2(p.pos.x, p.pos.z) < OFFSCREEN2) return false;   // never morph anyone in view
    return true;
  }
  function draftPrincipal() {
    const peds = CBZ.cityPeds || [];
    let best = null, bw = -1;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!draftableCiv(p)) continue;
      const w = (p.wealth || 0) + rng() * 0.1;   // the well-dressed make believable principals
      if (w > bw) { bw = w; best = p; }
    }
    return best;
  }
  function draftSuitBody() {
    const peds = CBZ.cityPeds || [];
    for (let i = 0; i < peds.length; i++) { const p = peds[i]; if (draftableCiv(p)) return p; }
    return null;
  }
  // the don pulls SOLDIERS off the corner — already set-colored, already armed
  function draftMade(gangId) {
    const peds = CBZ.cityPeds || [];
    let best = null, bestTier = -1;
    for (let i = 0; i < peds.length; i++) {
      const q = peds[i];
      if (!q || q.dead || q.gang !== gangId || q.isBoss || q.rank === "boss" || q.rank === "lt") continue;
      if (q.controlled || q.companion || q.ko > 0 || q.rage || q.surrender || (q.npcWanted | 0)) continue;
      if (q.state === "fight" || q.state === "flee" || q._parked || q.inCar) continue;
      const tier = q.rank === "enforcer" ? 3 : q.rank === "soldier" ? 2 : 1;
      if (tier > bestTier) { bestTier = tier; best = q; }
    }
    return best;
  }
  function draftCop(slot) {
    const cops = CBZ.cityCops || [];
    let pick = null;
    for (let i = 0; i < cops.length; i++) {
      const c = cops[i];
      if (!c || c.dead || c.swat || !c.ambient || c.gunstop || c.giveUp || c._vipDetail) continue;
      if (c.curTarget || c.npcTarget || c.chaseCar || c.searchT > 0 || (c._radioT || 0) > 0 || c._duty || c._post) continue;
      if (!c._mate) { pick = c; break; }            // prefer a mate-less single
      if (!pick) pick = c;
    }
    if (pick) {
      // pulled off an existing beat pair? unlink it cleanly so the old partner
      // doesn't shadow the detail (he re-pairs on his own via pairUp).
      if (pick._mate && pick._mate._mate === pick) { pick._mate._mate = null; pick._mate._lead = false; }
      pick._mate = null;
      return pick;
    }
    // no free beat cop yet → one fresh unit, capped, never in view
    const pr = slot.principal;
    if (S.fresh < 6 && CBZ.citySpawnCop && pr && camD2(pr.pos.x, pr.pos.z) > OFFSCREEN2) {
      const c = CBZ.citySpawnCop(pr.pos.x + 2, pr.pos.z + 2, false);
      if (c) { c.ambient = true; S.fresh++; return c; }
    }
    return null;
  }

  // ---------- PERMANENT IDENTITY (city/identity.js, feature-detected) --------
  // def._identityId names the CURRENT living holder of this archetype's title
  // ("the Magnate" etc. — the def object itself is a stable, long-lived
  // singleton, never recreated, so it's the natural home for "who currently
  // holds this title"). Minted ONCE per incumbent: if a previous identity is
  // already alive on the def we just reuse it (e.g. ensureDetail/recast paths
  // never mint twice for the same body); a dead/cleared def mints a fresh one,
  // which is exactly the "new individual" promotion onDeath produces below.
  function identityFor(def, p) {
    const R = CBZ.cityIdentities; if (!R || !R.register) return null;
    let rec = def._identityId ? R.get(def._identityId) : null;
    if (!rec || rec.status === "dead") {
      rec = R.register("vip", p.name || def.title, { vipKind: def.kind, title: def.title });
      def._identityId = rec.id;
    }
    return rec;
  }

  // ---------- casting ------------------------------------------------------
  function castPrincipal(p, slot, def, gang, A) {
    stashPed(p);
    const sp = spawnPointFor(def, A, gang);
    p.pos.set(sp.x, 0, sp.z);
    if (A.clampToCity) A.clampToCity(p.pos, 0.6);
    p.controlled = true; p.vip = def.kind;
    p.vipLvl = def.lvl[0] + ((rng() * (def.lvl[1] - def.lvl[0] + 1)) | 0);
    p.vipTitle = def.title;
    if (def.archetype) p.archetype = def.archetype;
    p.job = def.job; p.wealth = def.wealth;
    p.aggr = def.fights ? 0.86 : 0.2;
    p.cash = def.cash[0] + ((rng() * (def.cash[1] - def.cash[0])) | 0);
    p.valuables = def.valuables.slice();          // economy.js top tiers → corpse loot
    p._drip = null; p._dripKey = null;            // bling.js re-mirrors the new ice on its sweep
    p.hp = p.maxHp = def.hp;
    p.baseSpeed = 1.45;                            // money never hurries
    p.armed = !!def.weapon; p.weapon = def.weapon || null; p.ammo = def.weapon ? 30 : 0;
    p.rage = null; p.fear = 0; p.alarmed = 0; p.surrender = false; p.surrenderT = 0; p.poseHandsUp = false;
    p.state = "walk"; p.path = null; p.pause = 0; p.enterT = 0; p.chatT = 0;
    p.snitch = 0; p._role = null; p._work = null;
    if (gang) {
      // boss-of-bosses rides .gang so EVERY existing consequence fires (provoke,
      // rally, memberDown standing/hostility/reprisal). rank stays "lt" on the
      // record — rank "boss" would trip gangs.js succession (gang.bossDead) for
      // a boss who isn't theirs; the street still reads "Don" via the tag.
      p.gang = gang.id; p.faction = gang.id; p.rank = "lt";
      p.gstat = { bodies: 8 + ((rng() * 6) | 0), loyalty: 1 };
      paintFit(p, gang.color);
    } else if (def.suit != null) paintFit(p, def.suit);
    if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(p);
    const idRec = identityFor(def, p);
    p._identityId = idRec ? idRec.id : null;       // peds.js death hook (separate task) reads this
    slot.principal = p;
  }

  function castSuit(q, slot, def) {
    stashPed(q);
    q.controlled = true; q._vipGuard = true;
    q.kind = "security"; q.archetype = "security"; q.job = "close protection";
    q.aggr = 0.92;                                 // sizeup: the trained fear nothing
    q.armed = true; q.weapon = "SMG"; q.ammo = 90;
    q.hp = q.maxHp = 170; q.baseSpeed = 2.3;
    q.snitch = 0; q.fear = 0; q.alarmed = 0; q.rage = null; q.guard = null;
    q.state = "walk"; q.path = null; q.pause = 0;
    paintFit(q, def.suit != null ? def.suit : 0x171a21);
    if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(q);
  }
  function castMade(q) {
    stashPed(q);
    q.controlled = true; q._vipGuard = true;
    q.aggr = Math.max(q.aggr || 0, 0.9);
    if (!q.armed) { q.armed = true; q.weapon = "SMG"; q.ammo = 60; if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(q); }
    q.hp = Math.max(q.hp, 150); q.maxHp = Math.max(q.maxHp || 0, 150);
    q.baseSpeed = 2.3; q.guard = null; q.rage = null; q.fear = 0; q.alarmed = 0;
    q.state = "walk"; q.path = null; q.pause = 0;
  }

  // ---------- PERMANENT DEATH: retire the incumbent, announce, history -------
  // Snapshots final stats onto the identity record (extra fields survive
  // serialize/apply per identity.js's contract) so leaderboard.js's Hall of
  // Fame can show what they had when they went down. Idempotent: identity.js's
  // markDead() no-ops a second call on an already-dead id, and we guard the
  // snapshot/announce on that same first-call transition.
  function retireIdentity(p, slot, killedBy) {
    const R = CBZ.cityIdentities;
    if (!R || !R.markDead || !p || !p._identityId) return;
    const before = R.get(p._identityId);
    if (!before || before.status === "dead") return;     // already processed (e.g. peds.js hook beat us to it)
    const rec = R.markDead(p._identityId, { killedBy: killedBy || null });
    if (!rec) return;
    // final stats for leaderboard.js's Hall of Fame row (extra fields survive
    // serialize/apply per identity.js's contract — see its `apply` loop).
    rec.finalLevel = p.vipLvl || 0;
    rec.finalLoot = (p.cash || 0) + valuablesValue(p.valuables);
    if (!rec._vipAnnounced) {
      rec._vipAnnounced = true;
      const title = (slot && slot.def && slot.def.title) || rec.title || "VIP";
      const msg = "" + title + " " + (rec.name || "") + " has been killed — the title passes to someone new.";
      if (CBZ.city && CBZ.city.big) { try { CBZ.city.big(msg); } catch (e) {} }
      else if (CBZ.city && CBZ.city.note) CBZ.city.note(msg, 3.6);
    }
  }
  // economy.js item value lookup (same shape leaderboard.js uses) — local copy
  // since vips.js doesn't otherwise need cityEcon, kept tiny + guarded.
  function valuablesValue(vals) {
    const e = CBZ.cityEcon; if (!e || !e.ITEMS || !vals) return 0;
    let s = 0;
    for (const v of vals) { const it = e.ITEMS[v]; if (it && it.value) s += it.value; }
    return s;
  }
  // death callback for kind 'vip' — registered so that IF peds.js's
  // cityKillPed hook (a separate task this wave) calls markDead directly via
  // p._identityId before our own per-frame scan below observes pr.dead, the
  // identity still flips to dead/announced exactly once (markDead is
  // idempotent; retireIdentity's own status check keeps OUR call a no-op in
  // that race). The "promote a new individual" half needs no extra code here:
  // identityFor() mints a fresh id the next time castPrincipal() runs for
  // this def, because def._identityId then points at a dead record.
  if (CBZ.cityIdentities && CBZ.cityIdentities.onDeathRegister) {
    CBZ.cityIdentities.onDeathRegister("vip", function (rec) {
      if (rec._vipAnnounced) return;          // our own scan already announced this one
      rec._vipAnnounced = true;
      const msg = "" + (rec.title || "VIP") + " " + (rec.name || "") + " has been killed — the title passes to someone new.";
      if (CBZ.city && CBZ.city.big) { try { CBZ.city.big(msg); } catch (e) {} }
      else if (CBZ.city && CBZ.city.note) CBZ.city.note(msg, 3.6);
    });
  }

  // ---------- the LEVEL tag: "Lv.91 Magnate" over the head -----------------
  // Same material-swap level.js itself uses. We mirror its retag cache fields
  // (_lvlShown/_lvlTitle/_lvlCol/_lvlMat = the DERIVED values) so its 0.33s
  // sweep SKIPS this sprite; if any live term shifts it stomps once and we
  // restore within 0.45s. p.vipLvl/p.vipTitle are left on the record so
  // level.js can one-line adopt them and make the read fully derived.
  function derivedCol(a) {
    if (a.kind === "cop") return "#8fc1ff";
    if (a.bounty > 0) return "#ff6a5e";
    if (a.gang && CBZ.CITY && CBZ.CITY.gangs) {
      const defs = CBZ.CITY.gangs;
      for (let i = 0; i < defs.length; i++) if (defs[i].id === a.gang) return "#" + ("000000" + ((defs[i].color >>> 0).toString(16))).slice(-6);
    }
    if (a.companion || a.recruited) return "#7ed957";
    return "#eef4ff";
  }
  function stampTag(p, slot) {
    if (!p || !p.tag || p.dead || !CBZ.makeLabelSprite) return;
    const def = slot.def;
    const lv = Math.max(CBZ.cityLevel ? CBZ.cityLevel(p) : 1, p.vipLvl || 0);
    const want = "Lv." + lv + " " + def.title;
    if (p._vipTagText !== want || p.tag.material !== p._vipTagMat) {
      const s = CBZ.makeLabelSprite(want, { color: def.tagColor || derivedCol(p) });
      if (!s) return;
      p.tag.material = s.material;
      p._vipTagMat = s.material; p._vipTagText = want;
    }
    // mirror level.js's cache so its sweep agrees this tag is current
    if (CBZ.cityLevel) p._lvlShown = CBZ.cityLevel(p);
    if (CBZ.cityTitle) p._lvlTitle = CBZ.cityTitle(p);
    p._lvlCol = derivedCol(p);
    p._lvlMat = p.tag.material;
  }

  // ---------- slot lifecycle ------------------------------------------------
  function newSlot(i) {
    return {
      castIdx: i, def: null, gangId: null, state: "cool", cd: 2 + i * 7,
      principal: null, guards: [], cops: [],
      route: [], wi: 0, phase: "go", dwell: 0, goT: 0, shiftT: 0,
      threat: null, threatT: 0, hpMemo: 0, fleeT: 0, resume: false,
      fillT: 0, scanT: rng(), stampT: rng() * 0.4, gawkT: 0, mournT: 8,
      validT: 1, clubNoted: false,
    };
  }

  CBZ.spawnCityVips = function () {
    _s = 70707;
    S.inited = true; S.fresh = 0;
    S.slots.length = 0;
    for (let i = 0; i < SLOTS; i++) S.slots.push(newSlot(i));
  };

  function pickGang() {
    const gangs = CBZ.cityGangs || [];
    const live = [];
    for (const gn of gangs) {
      if (!gn || gn.isPlayer || gn.absorbed || !gn.turf || !gn.turf.length) continue;
      live.push(gn);
    }
    if (!live.length) return null;
    // a commission head walks for the HEAVY outfits first (syndicate/cartel)
    const heavy = live.filter((gn) => gn.type === "syndicate" || gn.type === "cartel");
    const pool = heavy.length ? heavy : live;
    return pool[(rng() * pool.length) | 0];
  }

  function form(slot) {
    const A = arena(); if (!A) { slot.cd = 5; return; }
    const def = CAST[slot.castIdx % CAST.length];
    let gang = null;
    if (def.kind === "don") {
      gang = pickGang();
      if (!gang) { slot.castIdx = (slot.castIdx + 1) % CAST.length; slot.cd = 4; return; }   // no living set → next archetype
    }
    let p = draftPrincipal();
    if (!p && S.fresh < 6 && CBZ.cityMakePed && A.root) {
      const sp = spawnPointFor(def, A, gang);
      try {
        // the "Star" (def.archetype "socialite") is female-flavored (see the
        // header doc's "shooting HER a spectacle") — a fresh body built for
        // that slot should read as a woman. Every other principal keeps the
        // default 48/52 split. Only matters on this fallback path: the usual
        // case (draftPrincipal above) reuses an EXISTING body whose gender/
        // build was already fixed at its original spawn.
        p = CBZ.cityMakePed(sp.x, sp.z, rng, { wealth: 0.9, gender: def.archetype === "socialite" ? "f" : undefined });
        A.root.add(p.group); CBZ.cityPeds.push(p); S.fresh++;
      } catch (e) { p = null; }
    }
    if (!p) { slot.cd = 6; return; }
    castPrincipal(p, slot, def, gang, A);
    slot.def = def; slot.gangId = gang ? gang.id : null;
    slot.route = buildRoute(def, A, gang);
    if (!slot.route.length) { const c = corePoint(A); slot.route = [{ x: c.x, z: c.z, dwell: 5 }]; }
    slot.wi = 0; slot.phase = "go"; slot.dwell = 0; slot.goT = 0;
    slot.threat = null; slot.threatT = 0; slot.resume = false; slot.mournT = 8;
    slot.shiftT = 300 + rng() * 150;
    slot.fillT = 0.5; slot.clubNoted = false;
    slot.hpMemo = p.hp;
    slot.state = "live";
    legTo(p, A, slot.route[0].x, slot.route[0].z);
  }

  function releaseParty(slot) {
    for (const gd of slot.guards) if (gd && !gd.dead) restorePed(gd);
    slot.guards.length = 0;
    for (let i = 0; i < slot.cops.length; i++) {
      const c = slot.cops[i];
      if (c) { c._vipDetail = null; if (i > 0 && !c.dead) c._lead = false; }   // back to a normal beat pair
    }
    slot.cops.length = 0;
    const pr = slot.principal;
    if (pr && !pr.dead) {
      restorePed(pr);
      // the shift ends INSIDE a doorway whenever possible — the body re-emerges
      // as its old civilian self, never morphing where anyone can see it
      if (pr.enterT <= 0 && camD2(pr.pos.x, pr.pos.z) < OFFSCREEN2) pr.enterT = 1.5 + rng() * 2;
    }
    slot.principal = null; slot.threat = null;
    slot.state = "cool"; slot.cd = 80 + rng() * 70;
    slot.castIdx = (slot.castIdx + SLOTS) % CAST.length;   // rotate the cast
  }

  function hardDrop(slot) {
    // world was cleared under us (reset path) — refs are gone, just re-form later
    for (const c of slot.cops) if (c) c._vipDetail = null;
    slot.principal = null; slot.guards.length = 0; slot.cops.length = 0;
    slot.threat = null; slot.state = "cool"; slot.cd = 20;
  }

  // ---------- the detail fills + replenishes (between fights, not during) --
  function ensureDetail(slot, dt) {
    slot.fillT -= dt;
    if (slot.fillT > 0 || slot.threat) return;
    const def = slot.def, pr = slot.principal;
    if ((def.guards || 0) > slot.guards.length) {
      slot.fillT = 3;
      const q = def.guardKind === "made" ? draftMade(slot.gangId) : draftSuitBody();
      if (q) {
        if (def.guardKind === "made") castMade(q); else castSuit(q, slot, def);
        // fall in: teleport only when BOTH ends are out of view, else they walk over
        if (camD2(q.pos.x, q.pos.z) > OFFSCREEN2 && camD2(pr.pos.x, pr.pos.z) > OFFSCREEN2) {
          q.pos.set(pr.pos.x + (rng() - 0.5) * 4, 0, pr.pos.z + (rng() - 0.5) * 4);
        }
        slot.guards.push(q);
      }
      return;
    }
    if ((def.cops || 0) > slot.cops.length) {
      slot.fillT = 4;
      const c = draftCop(slot);
      if (c) {
        c._vipDetail = slot;
        slot.cops.push(c);
        if (slot.cops.length === 2) {   // a proper two-officer unit, both self-led
          slot.cops[0]._mate = slot.cops[1]; slot.cops[1]._mate = slot.cops[0];
          slot.cops[0]._lead = true; slot.cops[1]._lead = true;
        }
      }
    }
  }

  // ---------- threat: who is the detail fighting? ---------------------------
  function engage(slot, th) {
    slot.threat = th; slot.threatT = 10;
    for (const gd of slot.guards) if (gd && !gd.dead) {
      gd.rage = th; gd.state = "fight";
      gd.attackCD = Math.min(gd.attackCD || 0, 0.2 + rng() * 0.3);
    }
    // the DON's real protection is the SET: provoke + rally + fighting shape —
    // all existing gangs.js/sizeup machinery, fired through the gang id.
    if (slot.def.kind === "don" && slot.gangId) {
      if (CBZ.cityGangProvoke) CBZ.cityGangProvoke(slot.gangId, th.isPlayer ? 0.6 : 0.35);
      const sh = slot.guards.find((q) => q && !q.dead) || slot.principal;
      if (sh && CBZ.cityRallyGang) { try { CBZ.cityRallyGang(sh, th); } catch (e) {} }
      if (CBZ.cityGangShapeUp) { try { CBZ.cityGangShapeUp(slot.gangId); } catch (e) {} }
    }
    // police details need nothing here: the officers are REAL cops standing
    // right there — copWitness/stars/chase are police.js's own consequences.
  }

  function scanThreat(slot, dt) {
    slot.scanT -= dt; if (slot.scanT > 0) return;
    slot.scanT = 0.33;
    const pr = slot.principal;
    if (slot.threat) {
      slot.threatT -= 0.33;
      if (slot.threat.dead || slot.threatT <= 0) slot.threat = null;
    }
    // fresh damage on the protected knot?
    let sum = pr.dead ? 0 : pr.hp;
    for (const gd of slot.guards) if (gd && !gd.dead) sum += gd.hp;
    const hurt = sum < slot.hpMemo - 0.25;
    slot.hpMemo = sum;
    if (hurt && slot.threat) slot.threatT = 10;          // still taking fire — stay on it
    if (slot.threat && !hurt) return;
    // 1) anyone actively raging at the principal or the detail
    const peds = CBZ.cityPeds || [];
    let best = null, bd = 45 * 45;
    for (let i = 0; i < peds.length; i++) {
      const q = peds[i];
      if (!q || q.dead || q === pr || !q.rage) continue;
      if (q.rage !== pr && slot.guards.indexOf(q.rage) < 0) continue;
      if (slot.guards.indexOf(q) >= 0) continue;
      const dx = q.pos.x - pr.pos.x, dz = q.pos.z - pr.pos.z, d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = q; }
    }
    let th = best;
    // 2) damage with no NPC suspect → the armed player right there is the read
    if (!th && hurt) {
      const P = CBZ.player, PA = CBZ.city && CBZ.city.playerActor;
      if (P && !P.dead && PA && hyp(P.pos.x - pr.pos.x, P.pos.z - pr.pos.z) < 60 &&
          ((CBZ.cityHasGun && CBZ.cityHasGun()) || (P._fighting || 0) > 0)) th = PA;
    }
    if (th && th !== slot.threat) engage(slot, th);
  }

  // ---------- driving: the principal walks the lap ---------------------------
  function drivePrincipal(slot, dt) {
    const p = slot.principal, A = arena();
    p.controlled = true;
    if (slot.threat && !slot.threat.dead) {
      if (slot.def.fights) {
        // the don shoots back from behind his shields
        p.rage = slot.threat; p.state = "fight";
        p.target.set(slot.threat.pos.x, 0, slot.threat.pos.z); p.path = null;
      } else {
        slot.fleeT -= dt;
        if (slot.fleeT <= 0) {
          slot.fleeT = 0.7; p.rage = null; p.state = "flee";
          if (CBZ.cityFleeFrom && slot.threat.pos) CBZ.cityFleeFrom(p, slot.threat.pos.x, slot.threat.pos.z);
        }
      }
      slot.resume = true;
      return;
    }
    if (slot.resume) {        // the shooting stopped — collect themselves, resume the lap
      slot.resume = false;
      p.rage = null; p.fear = 0; p.alarmed = 0; p.state = "walk";
      const wp0 = slot.route[slot.wi % slot.route.length];
      slot.phase = "go"; slot.goT = 0;
      legTo(p, A, wp0.x, wp0.z);
    }
    if (p.enterT > 0) {
      // inside (bank/jeweler/club). Shift over while out of sight → this is
      // where the VIP "goes home" and the body returns to its own life.
      if (slot.shiftT <= 0) releaseParty(slot);
      return;
    }
    const wp = slot.route[slot.wi % slot.route.length];
    if (slot.phase === "go") {
      slot.goT += dt;
      if (p.state !== "walk") p.state = "walk";       // we own this body — undo stray fold/flee writes
      const d = hyp(wp.x - p.pos.x, wp.z - p.pos.z);
      if (d < 2.4) {
        if (wp.club && wp.clubRef && wp.clubRef.insideSpot) {
          // THE ROPE MOMENT: the line waits, the party doesn't. The bouncer
          // (a person) says the only words on screen.
          slot.phase = "clubin"; slot.goT = 0;
          p.path = null; p.state = "walk";
          p.target.set(wp.clubRef.insideSpot.x, 0, wp.clubRef.insideSpot.z);
          if (!slot.clubNoted && camD2(p.pos.x, p.pos.z) < 45 * 45 && CBZ.city && CBZ.city.note) {
            slot.clubNoted = true;
            CBZ.city.note("Bouncer: \"Evening.\" — the rope unclips; the party walks straight past the line.", 2.2);
          }
        } else if (wp.enter) {
          p.enterT = wp.t || 9;                       // through the door — detail posts outside
          slot.phase = "dwell"; slot.dwell = wp.dwell || 1.5;
        } else { slot.phase = "dwell"; slot.dwell = wp.dwell || 4; }
      } else {
        if ((!p.path || !p.path.length) && p.pause <= 0) legTo(p, A, wp.x, wp.z);
        if (slot.goT > 55) {                          // blocked lap → skip the stop
          slot.goT = 0; slot.wi = (slot.wi + 1) % slot.route.length;
          const nw = slot.route[slot.wi];
          legTo(p, A, nw.x, nw.z);
        }
      }
    } else if (slot.phase === "clubin") {
      slot.goT += dt;
      const c = wp.clubRef;
      if (!c || hyp(c.insideSpot.x - p.pos.x, c.insideSpot.z - p.pos.z) < 2.4 || slot.goT > 10) {
        p.enterT = 14 + rng() * 10;                   // in the booth; the detail holds the rope
        slot.phase = "dwell"; slot.dwell = 1.5; slot.goT = 0;
      }
    } else {                                          // dwell — stand, be seen
      p.state = "idle"; p.speed = 0;
      slot.dwell -= dt;
      if (slot.dwell <= 0) {
        slot.wi = (slot.wi + 1) % slot.route.length;
        const nw = slot.route[slot.wi];
        slot.phase = "go"; slot.goT = 0; p.state = "walk";
        legTo(p, A, nw.x, nw.z);
      }
    }
  }

  // ---------- driving: guards hold formation / fight -------------------------
  function driveGuards(slot, dt) {
    const pr = slot.principal;
    const h = pr.group.rotation.y;
    const dx = Math.sin(h), dz = Math.cos(h), lx = Math.cos(h), lz = -Math.sin(h);
    const offs = slot.def.form || [];
    for (let i = slot.guards.length - 1; i >= 0; i--) {
      const gd = slot.guards[i];
      if (!gd || gd.dead) { slot.guards.splice(i, 1); slot.fillT = Math.max(slot.fillT, 16); continue; }
      gd.controlled = true;
      gd.fear = 0; gd.alarmed = 0; gd.surrender = false; gd.surrenderT = 0; gd.poseHandsUp = false;
      if (gd.armed && gd.ammo < 8) gd.ammo = 60;     // on the payroll — mags stay topped between fights
      const th = slot.threat;
      if (th && !th.dead) {
        // move() does the rest: closes to range and fires via npcAttack
        gd.rage = th; gd.state = "fight";
        gd.target.set(th.pos.x, 0, th.pos.z); gd.path = null;
        continue;
      }
      if (gd.rage) gd.rage = null;
      if (pr.enterT > 0) {                           // principal inside → post at the door
        gd.state = "idle"; gd.speed = 0;
        gd.target.set(gd.pos.x, 0, gd.pos.z);
        continue;
      }
      const o = offs.length ? offs[i % offs.length] : { f: -2, s: 0 };
      const fx = pr.pos.x + dx * o.f + lx * o.s, fz = pr.pos.z + dz * o.f + lz * o.s;
      const d = hyp(fx - gd.pos.x, fz - gd.pos.z);
      if (d > 45 && camD2(gd.pos.x, gd.pos.z) > OFFSCREEN2 && camD2(fx, fz) > OFFSCREEN2) {
        gd.pos.set(fx, 0, fz); gd.path = null;       // hopelessly dropped → fall back in (off-screen only)
      } else if (d > 1.2) {
        gd.state = "walk"; gd.path = null; gd.pause = 0;
        gd.target.set(fx, 0, fz);
      } else {
        gd.state = "idle"; gd.speed = 0;
        gd.target.set(gd.pos.x, 0, gd.pos.z);
        gd.group.rotation.y = h;                     // stand the principal's way — eyes out
      }
    }
  }

  // ---------- driving: the police escort (REAL cops, fed via their own fields)
  function driveCops(slot, dt) {
    const pr = slot.principal;
    for (let i = slot.cops.length - 1; i >= 0; i--) {
      const c = slot.cops[i];
      if (!c || c.dead || c.culled || c.giveUp) {
        if (c) c._vipDetail = null;
        slot.cops.splice(i, 1); slot.fillT = Math.max(slot.fillT, 12);
        continue;
      }
      // police WORK outranks the escort (gun stops, chases, scenes) — the
      // officer peels off and falls back in when it's done. Real procedure.
      if (c.gunstop || c.curTarget || c.npcTarget || c.chaseCar || c.searchT > 0 ||
          (c._radioT || 0) > 0 || c._duty || c._post) continue;
      c._beatT = 25;                                  // no stop-and-chat on a protection detail
      c._pairT = 8;                                   // and no re-pairing away from it
      const o = COP_FORM[i % COP_FORM.length];
      const h = pr.group.rotation.y;
      const dx = Math.sin(h), dz = Math.cos(h), lx = Math.cos(h), lz = -Math.sin(h);
      const fx = pr.pos.x + dx * o.f + lx * o.s, fz = pr.pos.z + dz * o.f + lz * o.s;
      const d = hyp(fx - c.pos.x, fz - c.pos.z);
      if (d > 60 && camD2(c.pos.x, c.pos.z) > 100 * 100 && camD2(fx, fz) > 100 * 100) {
        c.pos.set(fx, 0, fz);                         // lost the principal entirely → reposted off-screen
      }
      if (d > 4.4) { c._pauseT = 0; c.patrolGoal = { x: fx, z: fz }; }
      else { c._pauseT = 0.4; if ((pr.speed || 0) < 0.1) c.group.rotation.y = h; }
    }
  }

  // ---------- the STAR effect: civilians drift over and gawk ----------------
  function gawk(slot, dt) {
    slot.gawkT -= dt; if (slot.gawkT > 0) return;
    slot.gawkT = 2.8;
    const pr = slot.principal;
    if (slot.threat || camD2(pr.pos.x, pr.pos.z) > 70 * 70) return;   // a show needs an audience (and no gunfire)
    const peds = CBZ.cityPeds || [];
    let n = 0;
    for (let i = 0; i < peds.length && n < 2; i++) {
      const q = peds[i];
      if (!q || q.dead || q.kind !== "civilian" || q.vendor || q.gang) continue;
      if (q.controlled || q.companion || q.recruited || q._parked || q.inCar) continue;
      if (q.rage || q.surrender || q.reportState || q.approach || (q.npcWanted | 0) || q.fear > 1) continue;
      const d = hyp(q.pos.x - pr.pos.x, q.pos.z - pr.pos.z);
      if (d > 16 || d < 2.2) continue;
      if (rng() < 0.45) continue;
      if (d > 8) {                                   // drift closer for a look
        q.target.set(pr.pos.x + (rng() - 0.5) * 5, 0, pr.pos.z + (rng() - 0.5) * 5);
        q.state = "walk"; q.path = null;
      } else {                                       // stop and stare (chatT = the stand-still the brain already owns)
        q.chatT = Math.max(q.chatT || 0, 1.8 + rng() * 2.2);
        q.group.rotation.y = Math.atan2(pr.pos.x - q.pos.x, pr.pos.z - q.pos.z);
      }
      q.reactCD = Math.max(q.reactCD || 0, 8);
      n++;
    }
  }

  // ---------- per-frame ------------------------------------------------------
  // order 35.7: after peds (34) / police (35) / level.js (35.5) so the tag
  // stamp lands the same frame level.js sweeps, and cop fields are read next.
  CBZ.onUpdate(35.7, function (dt) {
    if (g.mode !== "city") return;
    if (!S.inited) {
      // belt-and-braces if the spawn hook is absent: self-start once the city is up
      // …but NOT while the named-ped spawn slice is still draining: finishSpawn
      // will call spawnCityVips against the COMPLETE roster, so self-starting
      // here against the partial list would orphan VIPs when that re-seed runs.
      if (CBZ.cityPeds && CBZ.cityPeds.length && arena() && !CBZ.citySpawnDraining) CBZ.spawnCityVips();
      else return;
    }
    for (let si = 0; si < S.slots.length; si++) {
      const slot = S.slots[si];
      if (slot.state === "cool") {
        slot.cd -= dt;
        if (slot.cd <= 0) form(slot);
        continue;
      }
      if (slot.state !== "live") continue;
      const pr = slot.principal;
      slot.validT -= dt;
      if (slot.validT <= 0) {
        slot.validT = 1;
        if (!pr || (CBZ.cityPeds || []).indexOf(pr) < 0 || pr._parked) { hardDrop(slot); continue; }
      }
      if (!pr) { hardDrop(slot); continue; }
      slot.shiftT -= dt;
      if (pr.dead) {
        // the body is the payday (deadLoot carries the ice). The detail finishes
        // the fight over it, holds a beat, then stands down and the slot rotates.
        // PERMANENCE: retire the identity the moment we observe the body is
        // gone — idempotent against peds.js's cityKillPed hook (separate task)
        // also calling markDead via p._identityId, whichever fires first wins.
        // No killer reference survives on the ped itself (cityKillPed's `imp`
        // is transient), so we record the cause as "killed" with no attacker —
        // the identity record's `killedAt` timestamp is still real and useful.
        retireIdentity(pr, slot, null);
        scanThreat(slot, dt);
        driveGuards(slot, dt);
        driveCops(slot, dt);
        slot.mournT -= dt;
        if (slot.mournT <= 0 && !slot.threat) releaseParty(slot);
        continue;
      }
      scanThreat(slot, dt);
      drivePrincipal(slot, dt);
      driveGuards(slot, dt);
      driveCops(slot, dt);
      ensureDetail(slot, dt);
      if (slot.def.gawk) gawk(slot, dt);
      slot.stampT -= dt;
      if (slot.stampT <= 0) { slot.stampT = 0.45; stampTag(pr, slot); }
      // long shift on the street with no doorway in the lap → wrap it anyway
      if (slot.shiftT < -120) releaseParty(slot);
    }
  });
})();
