/* ============================================================
   city/compoundcrew.js — THE PEOPLE WHO LIVE IN YOUR COMPOUND.

   OWNER: "you build a complex with walls around it ... and it has a ton of
   NPCs controlled by you." A compound is walls (city/compoundkit.js) on land
   you own (city/plots.js). This file is the CREW: guards on the wall, workers
   who make the money, a driver, and the rival gangs who come to take it.

   NOTHING HERE IS A SECOND NPC SYSTEM. Every body is an ordinary city ped:
     • minted by CBZ.cityPostNpc (occupy.js), removed by CBZ.cityUnpostNpc
     • held on a slot by CBZ.cityPostStand (garrison.js), whose shared brain
       walks him back, holds the bearing, fights without chasing and bolts
       like anyone else would. We hand it a `threat` read and nothing more.
     • raised onto a tower deck by CBZ.cityFloorPed
     • dealing through gangops.js's own buyer staging (CBZ.cityDealStageBuyer)
     • driving through boarding.js's chauffeur verb (CBZ.followerOrder "drive")
     • a raid squad is fresh gang bodies driven through the same ped fields
       gangs.js launchWar writes (guard / target / rage / state).

   MONEY IS PHYSICAL. A worker's sales sit in ped.cash (peds.js folds that
   into the corpse loot, so dropping him drops it), he carries it back through
   the gate and it lands in the stash (compoundKit.stashDeposit). A raider who
   empties the stash carries it on HIS body. Wages come out of the stash first,
   then the bank. There is no income counter anywhere in this file.

   PERSISTENCE: plot.data.crew (plain JSON) + CBZ.cityPlots.save(). Bodies
   exist only while you are within BODY_R of the plot; the roster remembers
   the rest. A crew member who dies is gone from the roster for real.

   MP: the host simulates, guests puppet (CBZ.net.noSim bails every tick).
   Budget: every tick is cadenced (0.25 s / 0.3 s / 0.5 s / 1 s); one ped
   scan per 0.3 s shared by every live compound, no per-frame allocation.

   PUBLISHES CBZ.compoundCrew = { hire, station, roster, raid, raidActive,
     pullBack, stationNearby, driveMe, capacity, menuEntries, menuDo, audit }
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const g = CBZ.game;

  // ---- tuning -----------------------------------------------------------
  const ROLES = {
    guard:  { price: 1500, wage: 120, hp: 170, job: "compound guard", label: "Guard" },
    worker: { price: 900,  wage: 80,  hp: 120, job: "street seller",  label: "Worker" },
    driver: { price: 1200, wage: 100, hp: 130, job: "driver",         label: "Driver" },
  };
  const BODY_R = 260, DROP_R = 290;         // bodies live inside BODY_R, go past DROP_R
  const RAID_NEAR_R = 300;                  // raids only launch while the fight is live
  const RAID_FIRST_AFTER = 180;             // s of being fortified before the first raid
  const RAID_COOLDOWN = 420;                // s between raids (real time)
  const RAID_MAX_T = 150;                   // s before survivors pull out
  const STASH_TAKE_FRAC = 0.4;
  const DEAL_SALES = 4, DEAL_MAX_T = 90;
  const WALK_R = 1.6;
  const BARK_CONTACT = ["Contact at the gate!", "Movement on the wall!", "We got company!", "Eyes up, hostiles out front!"];
  const BARK_C4 = ["Charge on the gate!", "They're blowing the gate!", "Get back from the gate!"];
  const BARK_RAID = ["Hit the stash!", "Blow it open!", "Go go go, take the money!"];
  const BARK_QUIT = ["No pay, no work. I'm out.", "Find somebody else, boss.", "I don't work for free."];

  // ---- tiny helpers -----------------------------------------------------
  function inCity() { return g && g.mode === "city"; }
  function playing() { return inCity() && g.state === "playing"; }
  function noSim() { return !!(CBZ.net && CBZ.net.noSim && CBZ.net.noSim()); }
  function P() { return CBZ.player; }
  function PA() { return CBZ.city && CBZ.city.playerActor; }
  function note(m, s) { if (CBZ.city && CBZ.city.note) { try { CBZ.city.note(m, s || 2.4); } catch (e) {} } }
  function big(m) { if (CBZ.city && CBZ.city.big) { try { CBZ.city.big(m); } catch (e) {} } }
  function sfx(n) { if (CBZ.sfx) { try { CBZ.sfx(n); } catch (e) {} } }
  function fmt(n) { return "$" + Math.round(n || 0).toLocaleString("en-US"); }
  function hex6(n) { return "#" + ("000000" + ((n >>> 0) & 0xffffff).toString(16)).slice(-6); }
  function d2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }
  function arena() { return CBZ.city && CBZ.city.arena; }
  function plotsApi() { return CBZ.cityPlots || null; }
  function kit() { return CBZ.compoundKit || null; }
  function kcall(name, a, b) {
    const K = kit(); if (!K || typeof K[name] !== "function") return null;
    try { return K[name](a, b); } catch (e) { return null; }
  }
  function nearPlayer(x, z, r) { const p = P(); return !!(p && p.pos && !p.dead && d2(p.pos.x, p.pos.z, x, z) < r * r); }
  function say(ped, lines, secs) {
    if (!ped || ped.dead || !CBZ.citySay) return;
    const line = typeof lines === "string" ? lines : lines[(Math.random() * lines.length) | 0];
    try { CBZ.citySay(ped, "“" + line + "”", ped.tagColor || "#9be564", secs || 2.2); } catch (e) {}
  }
  function seeded(seed) {           // mulberry32: a member's look is his own seed
    let a = (seed | 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function myGang() { const pg = g.playerGang; return (pg && pg.founded) ? pg : null; }
  function myColor() { const pg = myGang(); return pg ? pg.color : 0x7ed957; }
  function allied(gid) { return !!(CBZ.cityAreAllied && CBZ.cityAreAllied("player", gid)); }

  // money out: cash first, then the bank (zillow.js's rule)
  function charge(amt) {
    amt = Math.max(0, Math.round(+amt) || 0);
    if (((g.cash || 0) + (g.cityBank || 0)) < amt) return false;
    let owe = amt; const fromCash = Math.min(g.cash || 0, owe);
    g.cash = (g.cash || 0) - fromCash; owe -= fromCash; if (owe > 0) g.cityBank = (g.cityBank || 0) - owe;
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  }
  function canPay(amt) { return ((g.cash || 0) + (g.cityBank || 0)) >= amt; }

  // ---- the KIT's pieces, read defensively (its field names are its own) ----
  const _pp = { x: 0, y: 0, z: 0 };
  function piecePos(p, out) {
    out = out || _pp;
    if (!p) return null;
    if (p.x != null && p.z != null) { out.x = +p.x; out.y = +(p.y || 0); out.z = +p.z; return out; }
    const v = p.pos || p.position || (p.mesh && p.mesh.position) || (p.group && p.group.position) || (p.obj && p.obj.position);
    if (v && v.x != null) { out.x = v.x; out.y = v.y || 0; out.z = v.z; return out; }
    return null;
  }
  function gateAlive(p) { return !!(p && !p.dead && !p.destroyed && p.alive !== false && !(p.hp != null && p.hp <= 0)); }
  function isGateOpen(p) { return !!(p && (p.open || p.isOpen || (p.state && (p.state === "open" || p.state.open)) || (p.data && p.data.open))); }

  // ---- plot geometry ----------------------------------------------------
  function inRect(plot, x, z, pad) {
    const r = plot.rect; pad = pad || 0;
    return x >= r.minX - pad && x <= r.maxX + pad && z >= r.minZ - pad && z <= r.maxZ + pad;
  }
  function center(plot) {
    if (plot.center) return plot.center;
    const r = plot.rect; return { x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2 };
  }
  function front(plot) {
    if (plot.front && plot.front.nx != null) return plot.front;
    const c = center(plot), r = plot.rect;
    return { x: c.x, z: r.maxZ, nx: 0, nz: 1 };
  }

  // ---- per-plot runtime state (never persisted) --------------------------
  const RT = new Map();
  function rtOf(plot) {
    let rt = RT.get(plot.id);
    if (!rt) {
      rt = {
        plot: plot, bodies: new Map(), hostiles: [], nHost: 0,
        postsT: 0, posts: null, gatesT: 0, gate: null, gatePos: null,
        camT: 0, barkT: 0, patrolT: 0, patrolIdx: 0, spawnQ: 0,
        fortAge: 0, raidCool: RAID_COOLDOWN * 0.5, sinceRaid: 0, raid: null,
        gateOpened: false, gateHold: 0, lastHitAlert: 0,
      };
      RT.set(plot.id, rt);
    }
    rt.plot = plot;
    return rt;
  }

  // ---- persisted roster ---------------------------------------------------
  function dayNow() { return CBZ.dayCount ? (CBZ.dayCount() | 0) : 0; }
  function crewData(plot) {
    if (!plot.data) plot.data = {};
    let d = plot.data.crew;
    if (!d || typeof d !== "object") d = plot.data.crew = { v: 1, seq: 0, members: [], paidDay: dayNow(), lastRaid: null };
    if (!Array.isArray(d.members)) d.members = [];
    if (d.paidDay == null) d.paidDay = dayNow();
    return d;
  }
  let saveT = -1;
  function markDirty() { saveT = 1.2; }
  function flushSave() { const A = plotsApi(); if (A && A.save) { try { A.save(); } catch (e) {} } }

  function capacity(plot) {
    const K = kit();
    if (!K || typeof K.bunks !== "function") return 4;
    const b = kcall("bunks", plot);
    return 2 + 2 * Math.max(0, (b | 0));
  }
  function countRole(d, role) { let n = 0; for (const m of d.members) if (m.role === role) n++; return n; }

  // ---- posts ----------------------------------------------------------------
  const KIND_RANK = { gate: 0, tower: 1, corner: 2, wall: 3 };
  function fallbackPosts(plot) {
    const r = plot.rect, f = front(plot), c = center(plot), IN = 2.5;
    const out = [{ x: f.x - f.nx * IN, y: 0, z: f.z - f.nz * IN, face: Math.atan2(f.nx, f.nz), kind: "gate" }];
    const cs = [[r.minX + IN, r.minZ + IN], [r.maxX - IN, r.minZ + IN], [r.maxX - IN, r.maxZ - IN], [r.minX + IN, r.maxZ - IN]];
    for (const q of cs) out.push({ x: q[0], y: 0, z: q[1], face: Math.atan2(q[0] - c.x, q[1] - c.z), kind: "corner" });
    return out;
  }
  function postsOf(plot, rt) {
    if (rt.posts && rt.postsT > 0) return rt.posts;
    let ps = null;
    const raw = kcall("posts", plot);
    rt.postsKit = !!(raw && raw.length);
    if (raw && raw.length) {
      ps = raw.slice().sort((a, b) => (KIND_RANK[a.kind] != null ? KIND_RANK[a.kind] : 4) - (KIND_RANK[b.kind] != null ? KIND_RANK[b.kind] : 4));
    } else ps = fallbackPosts(plot);
    rt.posts = ps; rt.postsT = 2;
    return ps;
  }
  function refreshGate(plot, rt, force) {
    if (!force && rt.gatesT > 0) return rt.gate;
    rt.gatesT = 1;
    const gs = kcall("gates", plot);
    let gate = null;
    if (gs && gs.length) for (const p of gs) if (gateAlive(p)) { gate = p; break; }
    rt.gate = gate;
    const ps = postsOf(plot, rt);
    let gp = null;
    for (const p of ps) if (p.kind === "gate") { gp = p; break; }
    const f = front(plot);
    if (gate) { const q = piecePos(gate, {}); if (q) gp = { x: q.x, z: q.z }; }
    rt.gatePos = gp ? { x: gp.x, z: gp.z } : { x: f.x, z: f.z };
    return gate;
  }
  function hasWalls(plot, rt) {
    if (!kit()) return false;
    if (refreshGate(plot, rt)) return true;
    const ps = postsOf(plot, rt);
    if (!rt.postsKit) return false;               // the fallback ring is not a wall
    for (const p of ps) if (p.kind === "wall" || p.kind === "gate" || p.kind === "corner" || p.kind === "tower") return true;
    return false;
  }
  function gatePoints(plot, rt) {
    refreshGate(plot, rt);
    const f = front(plot), gp = rt.gatePos;
    return {
      out: { x: gp.x + f.nx * 3, z: gp.z + f.nz * 3 },
      inn: { x: gp.x - f.nx * 3, z: gp.z - f.nz * 3 },
    };
  }
  function stashPiece(plot) { return kcall("stash", plot); }
  function stashCash(plot) { const s = stashPiece(plot); return s ? (+kcall("stashCash", s) || 0) : 0; }
  function stashSpot(plot) {
    const s = stashPiece(plot);
    const q = s ? piecePos(s, {}) : null;
    if (q) return { x: q.x, z: q.z, piece: s };
    const c = center(plot); return { x: c.x, z: c.z, piece: null };
  }

  // where each roster member belongs
  function guardIndex(d, entry) { let i = 0; for (const m of d.members) { if (m === entry) return i; if (m.role === "guard") i++; } return i; }
  function roleIndex(d, entry) { let i = 0; for (const m of d.members) { if (m === entry) return i; if (m.role === entry.role) i++; } return i; }
  function slotFor(plot, rt, entry) {
    const d = crewData(plot), c = center(plot), f = front(plot);
    if (entry.role === "guard") {
      const ps = postsOf(plot, rt), i = guardIndex(d, entry);
      const p = ps[i % ps.length];
      const extra = Math.floor(i / ps.length);
      const side = extra ? ((extra % 2) ? 1.6 : -1.6) * Math.ceil(extra / 2) : 0;
      const fx = Math.sin(p.face || 0), fz = Math.cos(p.face || 0);
      const tower = p.kind === "tower" || (p.y || 0) > 0.8;
      return { x: p.x + fz * side, z: p.z - fx * side, y: tower && !extra ? (p.y || 0) : 0, face: p.face || 0, kind: p.kind, tower: tower && !extra };
    }
    if (entry.role === "worker") {
      const st = stashSpot(plot), i = roleIndex(d, entry);
      const a = i * 2.1 + 0.6;
      return { x: st.x + Math.cos(a) * 2.2, z: st.z + Math.sin(a) * 2.2, y: 0, face: Math.atan2(st.x - (st.x + Math.cos(a)), st.z - (st.z + Math.sin(a))), kind: "work" };
    }
    const i = roleIndex(d, entry);
    const lat = (i % 2 ? 1 : -1) * (3 + i);
    return { x: f.x - f.nx * 5 + f.nz * lat, z: f.z - f.nz * 5 - f.nx * lat, y: 0, face: Math.atan2(f.nx, f.nz), kind: "drive" };
  }
  // the sidewalk corner of the block a worker sells from
  function streetSpot(plot, i) {
    const r = plot.rect, f = front(plot), c = center(plot), OUT = 3.2;
    const cs = [[r.minX - OUT, r.minZ - OUT], [r.maxX + OUT, r.minZ - OUT], [r.maxX + OUT, r.maxZ + OUT], [r.minX - OUT, r.maxZ + OUT]];
    const fr = cs.filter((q) => (q[0] - c.x) * f.nx + (q[1] - c.z) * f.nz > 0);
    const q = (fr.length ? fr : cs)[i % (fr.length || cs.length)];
    const p = { x: q[0], z: q[1] };
    const A = arena(); if (A && A.clampToCity) { try { A.clampToCity(p, 1.5); } catch (e) {} }
    return p;
  }

  // ---- THE THREAT READ (garrison.js calls it every frame: keep it a lookup) --
  function threatFn(actor, rec) {
    const rt = actor && actor._compoundCrew ? RT.get(actor._compoundCrew) : null;
    if (!rt || !rt.nHost) return null;
    const reach = actor._ccRole === "guard" ? 55 : 14;
    let best = null, bd = reach * reach;
    for (let i = 0; i < rt.nHost; i++) {
      const h = rt.hostiles[i];
      if (!h || h.dead) continue;
      const dd = d2(h.pos.x, h.pos.z, actor.pos.x, actor.pos.z);
      if (dd < bd) { bd = dd; best = h; }
    }
    return best;
  }

  // who counts as hostile to THIS compound right now
  function hostileTo(p, plot, rt, isCop) {
    if (!p || p.dead || (p.ko || 0) > 0 || p.culled || !p.pos) return false;
    if (p.isPlayer || p._compoundCrew || p.faction === "player" || p.companion || p.recruited) return false;
    const x = p.pos.x, z = p.pos.z;
    if (p._ccRaid === plot.id) return inRect(plot, x, z, 60);
    if (isCop) return (g.wanted | 0) >= 1 && inRect(plot, x, z, 12);
    const r = p.rage;
    if (r && !r.dead && (r === PA() || r.isPlayer || r._compoundCrew === plot.id) && inRect(plot, x, z, 10)) return true;
    if (p.gang && p.gang !== "player" && !allied(p.gang)) {
      const pg = myGang();
      if (pg && p.gang === pg.id) return false;
      const m = g.cityMembership; if (m && m.gangId === p.gang) return false;
      return inRect(plot, x, z, 3);
    }
    return false;
  }
  // ONE scan per 0.3 s for every live compound
  function scanHostiles(live) {
    for (const rt of live) rt.nHost = 0;
    const peds = CBZ.cityPeds || [];
    const cops = CBZ.cityCops || [];
    for (let pass = 0; pass < 2; pass++) {
      const arr = pass ? cops : peds;
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i];
        if (!p || p.dead || !p.pos) continue;
        for (let k = 0; k < live.length; k++) {
          const rt = live[k], plot = rt.plot;
          if (!inRect(plot, p.pos.x, p.pos.z, 60)) continue;
          if (!hostileTo(p, plot, rt, pass === 1)) continue;
          if (rt.nHost < 48) rt.hostiles[rt.nHost++] = p;
        }
      }
    }
    for (const rt of live) for (let i = rt.nHost; i < rt.hostiles.length; i++) rt.hostiles[i] = null;
  }

  // ---- BODIES ---------------------------------------------------------------
  const WEAPON_TIER = ["AK-47", "Shotgun", "Pistol"];
  function weaponFor(role, idx) {
    if (role === "guard") return WEAPON_TIER[Math.min(WEAPON_TIER.length - 1, idx | 0)] || "Pistol";
    return "Pistol";
  }
  function nameFor(seed, gender) {
    if (CBZ.cityMintName) { try { return CBZ.cityMintName(seeded(seed), gender || "m"); } catch (e) {} }
    const A = ["Dre", "Marco", "Tee", "Vince", "Rico", "Luis", "Big Mike", "Jules", "Nico", "Sal"];
    return A[(seed >>> 3) % A.length];
  }
  function dressBody(ped, plot, entry) {
    const R = ROLES[entry.role] || ROLES.guard;
    const pg = myGang();
    ped.recruited = true; ped.kind = "crew"; ped.companion = false;
    ped.faction = "player"; ped.gang = pg ? pg.id : null;
    ped._compoundCrew = plot.id; ped._ccId = entry.id; ped._ccRole = entry.role;
    ped.rank = entry.rank || ped.rank || "soldier";
    ped.armed = true; if (!ped.weapon || ped.weapon === "Bat") ped.weapon = entry.weapon || "Pistol";
    ped.ammo = 999; ped.aggr = Math.max(ped.aggr || 0, entry.role === "guard" ? 0.93 : 0.8);
    ped.maxHp = Math.max(ped.maxHp || 0, R.hp);
    ped.npcWanted = 0; ped.npcHeat = 0; ped.snitch = 0; ped.surrender = false;
    ped.guard = null; ped.homeGuard = { x: center(plot).x, z: center(plot).z };
    ped.tagColor = hex6(myColor());
    ped._ccHp = ped.hp;
    if (ped.job !== R.job) ped.job = R.job;
    if (CBZ.syncActorWeapon) { try { CBZ.syncActorWeapon(ped); } catch (e) {} }
  }
  function spawnBody(plot, rt, entry, x, z, y, face) {
    const A = arena(); if (!A || !A.root || !CBZ.cityPostNpc) return null;
    const pg = myGang();
    const role = entry.role;
    const opts = {
      src: "compoundcrew:" + role, rng: seeded(entry.seed), parent: A.root,
      kind: "crew", faction: "player", gang: pg ? pg.id : undefined,
      outfit: pg ? pg.color : (role === "worker" ? 0x3a3f4a : 0x2f3a2f),
      archetype: role === "worker" ? "dealer" : "gangster", job: ROLES[role].job,
      armed: true, weapon: entry.weapon || weaponFor(role, 2), hp: ROLES[role].hp,
      aggr: role === "guard" ? 0.93 : 0.8, name: entry.name, cash: entry.cash || 15,
      face: face,
    };
    if (y > 0.2) opts.floorY = y;
    let ped = null;
    try { ped = CBZ.cityPostNpc(x, z, opts); } catch (e) { ped = null; }
    if (!ped) return null;
    dressBody(ped, plot, entry);
    if (entry.hp > 0) ped.hp = Math.min(ped.maxHp, entry.hp);
    ped._ccHp = ped.hp;
    rt.bodies.set(entry.id, ped);
    return ped;
  }
  function standAt(ped, plot, slot, kind) {
    if (!CBZ.cityPostStand) {        // degrade: a wander leash is all we can give him
      ped.guard = { x: slot.x, z: slot.z };
      if (ped.target && ped.target.set) ped.target.set(slot.x, 0, slot.z);
      return;
    }
    const guard = ped._ccRole === "guard";
    CBZ.cityPostStand(ped, {
      x: slot.x, z: slot.z, face: slot.face || 0,
      kind: kind || (guard ? (slot.tower ? "watch" : "sentry") : "guard"),
      tag: "compoundcrew:" + ped._ccRole, job: ROLES[ped._ccRole] ? ROLES[ped._ccRole].job : "crew",
      leash: guard ? (slot.tower ? 1.5 : 14) : 6, senses: guard ? 40 : 14,
      radius: slot.tower ? 0.6 : (guard ? 0.8 : 2.0),
      minStars: 99,                // your own crew never draws on YOU
      threat: threatFn,
    });
  }
  function unfloor(ped) { if (ped && ped._occupyY > 0.2 && CBZ.cityFloorPed) CBZ.cityFloorPed(ped, 0); }
  function releaseBody(ped) {
    if (!ped) return;
    if (CBZ.cityPostRelease) CBZ.cityPostRelease(ped, "compoundcrew");
    unfloor(ped);
    ped._ccWalk = null; ped._ccWork = null; ped._ccTask = null; ped._ccSlot = null;
  }
  function despawnBody(plot, rt, entry, ped) {
    if (ped && !ped.dead) { entry.hp = Math.round(ped.hp || 0); entry.cash = Math.round(ped.cash || 0); }
    releaseBody(ped);
    if (ped && CBZ.cityUnpostNpc) CBZ.cityUnpostNpc(ped);
    rt.bodies.delete(entry.id);
  }
  // walk a route through the post brain: the post itself moves waypoint to waypoint
  function walkRoute(ped, plot, route, slot) {
    ped._ccWalk = { pts: route, i: 0, slot: slot };
    const p0 = route[0];
    standAt(ped, plot, { x: p0.x, z: p0.z, face: Math.atan2(p0.x - ped.pos.x, p0.z - ped.pos.z) }, "detail");
  }
  /* AROUND THE WALL, NOT THROUGH IT. The post brain walks a straight line
     (garrison walkTo nulls ped.path), so a man coming from the side or the
     back of the lot used to aim at the gate THROUGH the perimeter wall and
     grind against it on the street for good. Walk the outside of the lot
     instead: back corner, front corner, then the gate. Frame: u along the
     frontage normal, v along the frontage. */
  function aroundTheWall(plot, x, z) {
    const r = plot.rect, c = center(plot), f = front(plot);
    const tx = -f.nz, tz = f.nx, O = 3.5;
    const hn = Math.abs(f.nx) > 0.5 ? (r.maxX - r.minX) / 2 : (r.maxZ - r.minZ) / 2;
    const ht = Math.abs(f.nx) > 0.5 ? (r.maxZ - r.minZ) / 2 : (r.maxX - r.minX) / 2;
    const u = (x - c.x) * f.nx + (z - c.z) * f.nz, v = (x - c.x) * tx + (z - c.z) * tz;
    const pt = (uu, vv) => ({ x: c.x + f.nx * uu + tx * vv, z: c.z + f.nz * uu + tz * vv });
    if (u >= hn + 1) return [];                       // already out front
    const side = v >= 0 ? 1 : -1;
    const out = [];
    if (Math.abs(v) < ht + 1) out.push(pt(-(hn + O), side * (ht + O)));   // behind: round the back corner first
    out.push(pt(hn + O, side * (ht + O)));                                // then the front corner
    return out;
  }
  function routeHome(plot, rt, ped, slot) {
    const gp = gatePoints(plot, rt);
    const outside = !inRect(plot, ped.pos.x, ped.pos.z, -0.5);
    const route = [];
    if (outside && kit()) { for (const w of aroundTheWall(plot, ped.pos.x, ped.pos.z)) route.push(w); route.push(gp.out); route.push(gp.inn); }
    route.push({ x: slot.x, z: slot.z });
    walkRoute(ped, plot, route, slot);
  }
  function settleOnSlot(ped, plot, slot) {
    ped._ccWalk = null; ped._ccSlot = slot;
    standAt(ped, plot, slot);
    if (slot.tower && slot.y > 0.2 && CBZ.cityFloorPed) CBZ.cityFloorPed(ped, slot.y);
  }

  // ---- HIRE / STATION / PULL BACK -----------------------------------------------
  /* WHERE A HIRE COMES FROM: down the street the gate faces, on the curb
     lane, 30 to 60 m along it, out of your sight. It used to be a random
     point 40-70 m from the lot centre in the frontage's general direction,
     which on a 52 m block grid is the MIDDLE OF THE BLOCK ACROSS THE STREET:
     the man spawned inside somebody else's building and walked a straight
     line at the gate that never left it (the guards seen standing in the road
     outside the wire were the ones who got half way). */
  function streetSpawnPoint(plot) {
    const f = front(plot), tx = -f.nz, tz = f.nx;
    const A = arena();
    let fallback = null, fd = -1;
    for (let k = 0; k < 12; k++) {
      const side = (k & 1) ? 1 : -1, along = 30 + (k >> 1) * 6;
      const p = { x: f.x + f.nx * 4 + tx * side * along, z: f.z + f.nz * 4 + tz * side * along };
      if (A && A.clampToCity) { try { A.clampToCity(p, 2); } catch (e) {} }
      const safe = !CBZ.npcTransitionSafe || CBZ.npcTransitionSafe(p.x, p.z, { minDistance: 25, maxDistance: 150 });
      if (safe) return p;
      const pl = P(); const dd = pl ? d2(p.x, p.z, pl.pos.x, pl.pos.z) : 0;
      if (dd > fd) { fd = dd; fallback = p; }
    }
    return fallback || { x: f.x + f.nx * 4 + tx * 40, z: f.z + f.nz * 4 + tz * 40 };
  }

  function hire(plot, role) {
    if (!plot || noSim()) return null;
    role = ROLES[role] ? role : "guard";
    const R = ROLES[role];
    const d = crewData(plot);
    if (d.members.length >= capacity(plot)) { note("No bunk free. Build more bunks to house more crew.", 2.6); return null; }
    if (!charge(R.price)) { note("Need " + fmt(R.price) + " to hire a " + R.label.toLowerCase() + ".", 2.2); return null; }
    const seed = (Math.random() * 0x7fffffff) | 0;
    const entry = {
      id: "c" + (++d.seq), name: nameFor(seed), role: role,
      weapon: weaponFor(role, countRole(d, "guard")), seed: seed, hp: R.hp, origin: "hire", cash: 15,
    };
    d.members.push(entry);
    if (d.members.length === 1) d.paidDay = dayNow();
    markDirty();
    const rt = rtOf(plot);
    let ped = null;
    const c = center(plot);
    if (nearPlayer(c.x, c.z, BODY_R) && playing()) {
      const sp = streetSpawnPoint(plot);
      ped = spawnBody(plot, rt, entry, sp.x, sp.z, 0, 0);
      if (ped) routeHome(plot, rt, ped, slotFor(plot, rt, entry));
    }
    note(entry.name + " hired as a " + R.label.toLowerCase() + ". " + fmt(R.wage) + " a day. On his way.", 2.8);
    sfx("coin");
    return ped;
  }

  function station(plot, ped, role) {
    if (!plot || !ped || ped.dead || noSim()) return false;
    role = ROLES[role] ? role : "guard";
    if (ped._compoundCrew) { note((ped.name || "He") + " is already posted.", 1.8); return false; }
    if (ped._cbzSeat || ped._cbzArc || ped.inCar || ped.restraint || ped.hostage) return false;
    const pg = g.playerGang;
    const inGang = !!(pg && pg.members && pg.members.indexOf(ped) >= 0);
    if (!inGang && !(ped.recruited && ped.faction === "player")) return false;
    const d = crewData(plot);
    if (d.members.length >= capacity(plot)) { note("No bunk free for " + (ped.name || "him") + ".", 2); return false; }
    if (inGang) pg.members.splice(pg.members.indexOf(ped), 1);
    else if (ped.companion) g.cityCrew = Math.max(0, (g.cityCrew || 0) - 1);
    ped.companion = false; ped._cbzWait = null; ped._cbzBag = null; ped.rage = null;
    const entry = {
      id: "c" + (++d.seq), name: ped.name || nameFor(1), role: role,
      weapon: ped.weapon && ped.weapon !== "Bat" ? ped.weapon : weaponFor(role, 2),
      seed: (Math.random() * 0x7fffffff) | 0, hp: Math.round(ped.hp || ROLES[role].hp),
      origin: inGang ? "gang" : "companion", rank: ped.rank || null, cash: 0,
    };
    d.members.push(entry);
    markDirty();
    const rt = rtOf(plot);
    dressBody(ped, plot, entry);
    rt.bodies.set(entry.id, ped);
    routeHome(plot, rt, ped, slotFor(plot, rt, entry));
    if (pg && pg.founded && CBZ.cityPlayerGangSync) { try { CBZ.cityPlayerGangSync(); } catch (e) {} }
    return true;
  }

  function followersNear(r) {
    const out = [], pl = P(); if (!pl) return out;
    const peds = CBZ.cityPeds || [], R2 = r * r;
    const pg = g.playerGang;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p || p.dead || p._compoundCrew || p === g.cityPartner || p.hostage || p.restraint) continue;
      const mine = (p.companion && p.recruited) || (pg && pg.founded && pg.members && pg.members.indexOf(p) >= 0);
      if (!mine || p.inCar || p._cbzSeat) continue;
      if (d2(p.pos.x, p.pos.z, pl.pos.x, pl.pos.z) > R2) continue;
      out.push(p);
    }
    return out;
  }
  function stationNearby(plot) {
    if (!plot) return 0;
    const list = followersNear(45);
    if (!list.length) { note("Nobody with you to post here.", 1.8); return 0; }
    let n = 0;
    for (const p of list) if (station(plot, p, "guard")) n++;
    if (n) note(n + (n === 1 ? " of your people takes" : " of your people take") + " a post at the compound.", 2.4);
    else note("No bunk free. Build more bunks to house more crew.", 2.4);
    return n;
  }
  function pullBack(plot) {
    if (!plot) return 0;
    const rt = RT.get(plot.id); if (!rt) { note("No posted crew close by.", 1.8); return 0; }
    const d = crewData(plot), pl = P();
    let n = 0;
    for (let i = d.members.length - 1; i >= 0; i--) {
      const e = d.members[i];
      if (e.origin !== "gang" && e.origin !== "companion") continue;
      const ped = rt.bodies.get(e.id);
      if (!ped || ped.dead || ped._ccTask) continue;
      if (pl && d2(ped.pos.x, ped.pos.z, pl.pos.x, pl.pos.z) > 70 * 70) continue;
      releaseBody(ped);
      rt.bodies.delete(e.id); d.members.splice(i, 1);
      ped._compoundCrew = null; ped._ccId = null; ped._ccRole = null;
      const pg = myGang();
      if (e.origin === "gang" && pg && CBZ.cityPlayerGangEnlist) CBZ.cityPlayerGangEnlist(ped, e.rank || "soldier");
      else { ped.companion = true; ped.kind = "crew"; g.cityCrew = (g.cityCrew || 0) + 1; }
      n++;
    }
    if (n) { markDirty(); if (myGang() && CBZ.cityPlayerGangApply) { try { CBZ.cityPlayerGangApply(); } catch (e) {} } note(n + " fall in with you.", 2); }
    else note("No posted crew of yours close by. Hired hands stay on the job.", 2.2);
    return n;
  }

  // ---- WALK OFF (unpaid) / DEATH -------------------------------------------------
  function walkOff(plot, rt, entry) {
    const d = crewData(plot);
    const i = d.members.indexOf(entry); if (i >= 0) d.members.splice(i, 1);
    const ped = rt ? rt.bodies.get(entry.id) : null;
    if (ped && !ped.dead) {
      releaseBody(ped);
      rt.bodies.delete(entry.id);
      ped._compoundCrew = null; ped._ccId = null; ped._ccRole = null;
      ped.recruited = false; ped.faction = null; ped.gang = null; ped.kind = "civilian";
      const c = center(plot), f = front(plot);
      if (ped.target && ped.target.set) ped.target.set(c.x + f.nx * 90, 0, c.z + f.nz * 90);
      ped.state = "walk"; ped.pause = 0; ped.path = null;
      say(ped, BARK_QUIT);
    }
    markDirty();
  }

  // ---- WAGES (once per in-game day) ----------------------------------------------
  function payWages(plot, rt) {
    const d = crewData(plot);
    const day = dayNow();
    if (day <= d.paidDay) return;
    const days = Math.min(3, day - d.paidDay);
    d.paidDay = day;
    if (!d.members.length) return;
    let fromStash = 0, fromBank = 0;
    const quit = [];
    for (const e of d.members.slice()) {
      let owe = (ROLES[e.role] || ROLES.guard).wage * days;
      const st = stashPiece(plot);
      if (st) { const took = +kcall("stashTake", st, owe) || 0; owe -= took; fromStash += took; }
      if (owe > 0) {
        if (canPay(owe)) {            // wages clear through the bank, pocket cash covers the rest
          const fb = Math.min(Math.max(0, g.cityBank || 0), owe);
          g.cityBank = (g.cityBank || 0) - fb; g.cash = (g.cash || 0) - (owe - fb);
          fromBank += owe; owe = 0;
          if (CBZ.cityHudDirty) CBZ.cityHudDirty();
        }
      }
      if (owe > 0) quit.push(e);
    }
    for (const e of quit) walkOff(plot, rt, e);
    const c = center(plot);
    if (fromStash + fromBank > 0 && nearPlayer(c.x, c.z, 400)) {
      note("Crew wages paid, " + fmt(fromStash + fromBank) + (fromStash ? " (" + fmt(fromStash) + " from the stash)" : "") + ".", 2.4);
    }
    if (quit.length) note(quit.length + (quit.length === 1 ? " of your crew walked off the job. Nobody paid him." : " of your crew walked off the job unpaid."), 3);
    markDirty();
  }

  // ---- GATE: it opens for your people ---------------------------------------------
  function tendGate(plot, rt, dt) {
    const K = kit(); if (!K || typeof K.gateOpen !== "function") return;
    const gate = refreshGate(plot, rt);
    if (!gate) { rt.gateOpened = false; return; }
    if (rt.raid) {                     // under attack the gate stays shut
      if (isGateOpen(gate) && rt.gateOpened) { try { K.gateOpen(gate, false); } catch (e) {} rt.gateOpened = false; }
      return;
    }
    const gp = rt.gatePos;
    let crewNear = false;
    for (const ped of rt.bodies.values()) {
      if (!ped || ped.dead) continue;
      if (!(ped._ccWalk || (ped._ccWork && ped._ccWork.st !== "deal" && ped._ccWork.st !== "in"))) continue;
      if (d2(ped.pos.x, ped.pos.z, gp.x, gp.z) < 7 * 7) { crewNear = true; break; }
    }
    if (crewNear) {
      rt.gateHold = 3;
      if (!isGateOpen(gate)) { try { K.gateOpen(gate, true); rt.gateOpened = true; } catch (e) {} }
    } else if (rt.gateOpened) {
      rt.gateHold -= dt;
      if (rt.gateHold <= 0) { try { K.gateOpen(gate, false); } catch (e) {} rt.gateOpened = false; }
    }
  }

  // ---- WORKERS: the real income -------------------------------------------------
  function workerSettle(plot) {
    return function (dealer, buyer) {
      const ws = dealer._ccWork; if (!ws) return;
      const want = 25 + ((Math.random() * 55) | 0);
      const pay = Math.min(want, Math.max(0, Math.floor(buyer.cash || 0)));
      if (pay < 5) return;                                  // broke buyer, no sale
      buyer.cash = (buyer.cash || 0) - pay;
      dealer.cash = (dealer.cash || 0) + pay;
      dealer._ccTake = (dealer._ccTake || 0) + pay;
      ws.sales++;
      if (nearPlayer(dealer.pos.x, dealer.pos.z, 40)) sfx("coin");
      if (Math.random() < 0.2 && CBZ.cityCrime) { try { CBZ.cityCrime(10, { x: dealer.pos.x, z: dealer.pos.z, type: "dealing" }); } catch (e) {} }
    };
  }
  function tickWorker(plot, rt, entry, ped, dt) {
    const K = kit();
    let ws = ped._ccWork;
    if (!ws) ws = ped._ccWork = { st: "in", t: 0, sales: 0, wait: 8 + Math.random() * 8, buyT: 4, settle: null };
    ws.t += dt;
    if (ped._ccWalk) return;                               // en route; the walker drives him
    if (ws.st === "in") {
      if (!K) return;                                      // no kit: he works the yard
      // money on him and you close by with no stash: hand it over
      const carried = Math.min(ped._ccTake || 0, ped.cash || 0);
      if (carried > 0 && !stashPiece(plot) && nearPlayer(ped.pos.x, ped.pos.z, 12)) {
        ped.cash -= carried; ped._ccTake = 0;
        if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(carried); else g.cash = (g.cash || 0) + carried;
        note(entry.name + " hands you " + fmt(carried) + " from the corner.", 2.4); sfx("coin");
      }
      if (ws.t < ws.wait || rt.raid) return;
      if (carried > 1500 && !stashPiece(plot)) return;    // carrying enough, waits for you
      const gp = gatePoints(plot, rt);
      const spot = streetSpot(plot, roleIndex(crewData(plot), entry));
      ws.st = "out"; ws.t = 0; ws.sales = 0; ws.spot = spot;
      walkRoute(ped, plot, [gp.inn, gp.out, spot], { x: spot.x, z: spot.z, face: Math.atan2(spot.x - center(plot).x, spot.z - center(plot).z), kind: "street" });
      return;
    }
    if (ws.st === "out") { ws.st = "deal"; ws.t = 0; return; }
    if (ws.st === "deal") {
      ws.buyT -= dt;
      if (ws.buyT <= 0) {
        ws.buyT = 7 + Math.random() * 6;
        if (CBZ.cityDealStageBuyer) {
          if (!ws.settle) ws.settle = workerSettle(plot);
          try { CBZ.cityDealStageBuyer(ped, { onSettle: ws.settle }); } catch (e) {}
        }
      }
      if (ws.sales >= DEAL_SALES || ws.t > DEAL_MAX_T || rt.raid) {
        const gp = gatePoints(plot, rt), home = slotFor(plot, rt, entry);
        ws.st = "back"; ws.t = 0;
        walkRoute(ped, plot, [gp.out, gp.inn, { x: home.x, z: home.z }], home);
      }
      return;
    }
    if (ws.st === "back") {
      const take = Math.min(ped._ccTake || 0, Math.floor(ped.cash || 0));
      const st = stashPiece(plot);
      if (take > 0 && st) {
        kcall("stashDeposit", st, take);
        ped.cash -= take; ped._ccTake = 0;
        if (nearPlayer(ped.pos.x, ped.pos.z, 60)) note(entry.name + " drops " + fmt(take) + " in the stash.", 2);
      }
      ws.st = "in"; ws.t = 0; ws.wait = 6 + Math.random() * 10;
    }
  }

  // ---- GUARDS: night patrol + hit alerts -------------------------------------------
  function isNight() { const h = CBZ.cityHour ? CBZ.cityHour() : 12; return h < 6 || h >= 21; }
  function patrolRing(plot, rt) {
    const ps = postsOf(plot, rt), c = center(plot), out = [];
    for (const p of ps) {
      if (p.kind === "tower" || (p.y || 0) > 0.8) continue;
      const dx = c.x - p.x, dz = c.z - p.z, l = Math.hypot(dx, dz) || 1;
      out.push({ x: p.x + dx / l * 3, z: p.z + dz / l * 3 });
    }
    if (out.length < 3) {
      const r = plot.rect, IN = 4;
      return [{ x: r.minX + IN, z: r.minZ + IN }, { x: r.maxX - IN, z: r.minZ + IN }, { x: r.maxX - IN, z: r.maxZ - IN }, { x: r.minX + IN, z: r.maxZ - IN }];
    }
    return out;
  }
  function tickPatrol(plot, rt, dt) {
    const d = crewData(plot);
    let walker = null, guards = 0;
    for (const e of d.members) {
      if (e.role !== "guard") continue;
      guards++;
      const ped = rt.bodies.get(e.id);
      if (ped && !ped.dead && !ped._ccWalk && ped._post && !(ped._ccSlot && ped._ccSlot.tower)) walker = { e, ped };
    }
    const night = isNight() && guards >= 2 && !rt.raid;
    if (!walker) return;
    const ped = walker.ped;
    if (!night) {
      if (ped._ccPatrol) { ped._ccPatrol = false; settleOnSlot(ped, plot, slotFor(plot, rt, walker.e)); }
      return;
    }
    rt.patrolT -= dt;
    if (rt.patrolT > 0 && ped._ccPatrol) return;
    rt.patrolT = 20;
    const ring = patrolRing(plot, rt);
    rt.patrolIdx = (rt.patrolIdx + 1) % ring.length;
    const q = ring[rt.patrolIdx];
    ped._ccPatrol = true;
    const post = ped._post;
    if (post) {
      const c = center(plot);
      post.x = q.x; post.z = q.z;
      const a = Math.atan2(q.x - c.x, q.z - c.z); post.fx = Math.sin(a); post.fz = Math.cos(a);
      post.radius = 1.2;
    }
  }

  // ---- DRIVER ---------------------------------------------------------------------
  function nearestDriver(x, z, r) {
    let best = null, bd = r * r;
    for (const rt of RT.values()) for (const ped of rt.bodies.values()) {
      if (!ped || ped.dead || ped._ccRole !== "driver" || ped._ccTask) continue;
      const dd = d2(ped.pos.x, ped.pos.z, x, z);
      if (dd < bd) { bd = dd; best = ped; }
    }
    return best;
  }
  function driveMe() {
    const pl = P();
    if (!pl || !pl.driving || !pl._vehicle) { note("Get in your car first, then call the driver.", 2); return false; }
    const car = pl._vehicle;
    const drv = nearestDriver(car.pos.x, car.pos.z, 45);
    if (!drv) { note("No driver of yours close by.", 1.8); return false; }
    const wp = CBZ.fullMap && CBZ.fullMap.waypoint ? CBZ.fullMap.waypoint("city") : null;
    if (!wp) { note("Set a waypoint on the map, then call the driver.", 2.2); return false; }
    if (!CBZ.followerOrder) return false;
    releaseBody(drv);
    drv._ccTask = "drive";
    const ok = CBZ.followerOrder(drv, "drive", { veh: car, to: { x: wp.x, z: wp.z, name: wp.label || "the waypoint" } });
    if (!ok) { drv._ccTask = null; note("He can't get to the wheel from here.", 1.8); return false; }
    return true;
  }
  function tickDriverTask(plot, rt, entry, ped) {
    if (ped._ccTask !== "drive") return false;
    if (ped._cbzDriving || ped._cbzArc) return true;
    if (ped._cbzSeat) {
      const pl = P();
      if (!pl || pl._vehicle !== ped._cbzSeat.veh) { if (CBZ.followerOrder) CBZ.followerOrder(ped, "alight"); }
      return true;
    }
    ped._ccTask = null;
    routeHome(plot, rt, ped, slotFor(plot, rt, entry));
    return true;
  }

  // ---- body upkeep (0.25 s) -----------------------------------------------------------
  function tickBodies(plot, rt, dt) {
    const d = crewData(plot);
    for (let i = d.members.length - 1; i >= 0; i--) {
      const e = d.members[i];
      const ped = rt.bodies.get(e.id);
      if (!ped) continue;
      if (ped.dead) {                                   // gone for real
        releaseBody(ped); rt.bodies.delete(e.id); d.members.splice(i, 1); markDirty();
        note("Your " + (ROLES[e.role] ? ROLES[e.role].label.toLowerCase() : "crew") + " " + e.name + " is down.", 2.6);
        continue;
      }
      if (ped.culled || !ped.group || !ped.group.parent) { rt.bodies.delete(e.id); continue; }   // the world reaped him
      // loyalty: never on you, never on each other; no heat of their own
      const r = ped.rage;
      if (r && (r === PA() || r.isPlayer || r._compoundCrew || r.faction === "player")) { ped.rage = null; if (ped.state === "fight") ped.state = "walk"; }
      ped.npcWanted = 0;
      if (ped.faction !== "player") ped.faction = "player";
      // took a hit: the whole wall wakes
      if (ped.hp < (ped._ccHp || 0) - 0.5) {
        const c = center(plot);
        if (CBZ.cityPostAlert && rt.lastHitAlert <= 0) { try { CBZ.cityPostAlert(c.x, c.z, 70); } catch (e2) {} rt.lastHitAlert = 3; }
      }
      ped._ccHp = ped.hp;
      if (tickDriverTask(plot, rt, e, ped)) continue;
      // walking a route
      const w = ped._ccWalk;
      if (w) {
        const q = w.pts[w.i];
        if (!ped._post) standAt(ped, plot, { x: q.x, z: q.z, face: 0 }, "detail");
        if (d2(ped.pos.x, ped.pos.z, q.x, q.z) < WALK_R * WALK_R) {
          w.i++;
          if (w.i >= w.pts.length) {
            const slot = w.slot;
            ped._ccWalk = null;
            if (e.role === "worker" && ped._ccWork && ped._ccWork.st === "out") { ped._ccSlot = slot; standAt(ped, plot, slot, "guard"); }
            else settleOnSlot(ped, plot, slot);
            if (e.origin === "hire" && !e.arrived) { e.arrived = true; markDirty(); }
          } else if (ped._post) {
            const n = w.pts[w.i];
            ped._post.x = n.x; ped._post.z = n.z;
          }
        }
        continue;
      }
      if (!ped._post && !ped._ccTask) { settleOnSlot(ped, plot, slotFor(plot, rt, e)); continue; }
      // tower guard pulled off his deck by a fight: bring him to ground, re-lift at the slot
      const sl = ped._ccSlot;
      if (sl && sl.tower) {
        const off = d2(ped.pos.x, ped.pos.z, sl.x, sl.z);
        if (off > 3.5 * 3.5 && ped._occupyY > 0.2) unfloor(ped);
        else if (off < 1.2 * 1.2 && !(ped._occupyY > 0.2) && CBZ.cityFloorPed) CBZ.cityFloorPed(ped, sl.y);
      }
      if (e.role === "worker") tickWorker(plot, rt, e, ped, dt);
    }
    if (rt.lastHitAlert > 0) rt.lastHitAlert -= dt;
  }

  // ---- CAMERAS (0.5 s) ------------------------------------------------------------------
  function tickCameras(plot, rt) {
    if (!rt.nHost) return;
    const cams = kcall("cameras", plot);
    if (!cams || !cams.length) return;
    const COS = Math.cos(0.8);
    for (const cam of cams) {
      const range = cam.range || 25, R2 = range * range;
      const fl = Math.hypot(cam.fx || 0, cam.fz || 0) || 1;
      for (let i = 0; i < rt.nHost; i++) {
        const h = rt.hostiles[i]; if (!h || h.dead) continue;
        const dx = h.pos.x - cam.x, dz = h.pos.z - cam.z, dd = dx * dx + dz * dz;
        if (dd > R2 || dd < 0.01) continue;
        const l = Math.sqrt(dd);
        if ((dx * (cam.fx || 0) + dz * (cam.fz || 0)) / (l * fl) < COS) continue;
        if (CBZ.cityPostAlert) { try { CBZ.cityPostAlert(cam.x, cam.z, 70); } catch (e) {} }
        for (const ped of rt.bodies.values()) if (ped && !ped.dead && ped._post && ped._ccRole === "guard" && ped._post.alertT < 14) ped._post.alertT = 14;
        if (rt.barkT <= 0) {
          rt.barkT = 9;
          let who = null, bd = Infinity;
          for (const ped of rt.bodies.values()) {
            if (!ped || ped.dead || ped._ccRole !== "guard") continue;
            const q = d2(ped.pos.x, ped.pos.z, h.pos.x, h.pos.z); if (q < bd) { bd = q; who = ped; }
          }
          if (who) say(who, BARK_CONTACT);
        }
        return;
      }
    }
  }

  // ============================================================
  //  RAIDS — a rival crew hits the compound for the stash
  // ============================================================
  function pickRival(plot) {
    const c = center(plot);
    let best = null, bd = Infinity;
    const pg = myGang(), mem = g.cityMembership;
    for (const gn of CBZ.cityGangs || []) {
      if (!gn || gn.isPlayer || gn.absorbed || gn.id === "player" || (pg && gn.id === pg.id)) continue;
      if (mem && mem.gangId === gn.id) continue;
      if (allied(gn.id)) continue;
      let live = 0; for (const m of gn.members || []) if (m && !m.dead) { live++; break; }
      if (!live) continue;
      const gc = gn.center || { x: c.x, z: c.z };
      const dd = d2(gc.x != null ? gc.x : gc.cx, gc.z != null ? gc.z : gc.cz, c.x, c.z);
      if (dd < bd) { bd = dd; best = gn; }
    }
    return best;
  }
  const RAIDER_GUNS = ["AK-47", "SMG", "SMG", "Pistol", "Shotgun", "Pistol"];
  function raidActive(plot) { const rt = plot && RT.get(plot.id); return !!(rt && rt.raid); }

  function startRaid(plot, gangId) {
    if (!plot || noSim() || !playing()) return false;
    const rt = rtOf(plot);
    if (rt.raid) return false;
    const gang = gangId ? (CBZ.cityGangById ? CBZ.cityGangById(gangId) : null) : pickRival(plot);
    if (!gang) return false;
    const A = arena(); if (!A || !A.root || !CBZ.cityPostNpc) return false;
    const c = center(plot), f = front(plot);
    const walls = hasWalls(plot, rt);
    const cash = stashCash(plot);
    const d = crewData(plot);
    const n = Math.max(4, Math.min(8, 4 + Math.floor(cash / 6000) + Math.floor(countRole(d, "guard") / 3)));
    const sp = streetSpawnPoint(plot);
    // fight from the street side: the axis runs spawn -> gate
    const gate0 = refreshGate(plot, rt, true);
    // the guards shut the gate the moment they see them coming
    if (gate0 && isGateOpen(gate0) && kit() && kit().gateOpen) { try { kit().gateOpen(gate0, false); } catch (e) {} rt.gateOpened = false; }
    const gp = rt.gatePos;
    let ax = gp.x - sp.x, az = gp.z - sp.z; const al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
    const tx = -az, tz = ax;
    const R = {
      gang: gang, raiders: [], phase: "approach", t: 0, breached: !walls, walls: walls,
      breacher: null, charge: null, blasts: 0, taken: 0, escaped: 0, recovered: 0, killed: 0,
      spawn: sp, ax: ax, az: az, alertT: 0, barked: false, hadStash: !!stashPiece(plot),
    };
    for (let i = 0; i < n; i++) {
      const jx = sp.x + tx * ((i % 4) - 1.5) * 1.6 + (Math.random() - 0.5), jz = sp.z + tz * ((i % 4) - 1.5) * 1.6 + (Math.random() - 0.5) - az * Math.floor(i / 4) * 1.8;
      const w = i === 0 ? "AK-47" : RAIDER_GUNS[(Math.random() * RAIDER_GUNS.length) | 0];
      let ped = null;
      try {
        ped = CBZ.cityPostNpc(jx, jz, {
          src: "compoundcrew:raid", parent: A.root, kind: "gang", gang: gang.id, faction: gang.id,
          outfit: gang.color, archetype: "gangster", job: i === 0 ? "gang lt" : "gang soldier",
          armed: true, weapon: w, hp: 130, aggr: 0.95,
        });
      } catch (e) { ped = null; }
      if (!ped) continue;
      ped._ccRaid = plot.id; ped.rank = i === 0 ? "lt" : "soldier";
      ped.ammo = 120; ped.cash = 40 + ((Math.random() * 80) | 0);
      ped.tagColor = hex6(gang.color);
      if (CBZ.syncActorWeapon) { try { CBZ.syncActorWeapon(ped); } catch (e) {} }
      // roles: the first calls it from the back, one breaches, the rest fan into an arc on the gate
      let gx, gz;
      if (i === 0) { ped._ccR = "call"; gx = gp.x - ax * 18; gz = gp.z - az * 18; }
      else {
        if (walls && !R.breacher) { ped._ccR = "breach"; R.breacher = ped; }
        else ped._ccR = "arc";
        const back = 10 + Math.random() * 4, side = (((i - 1) % 5) - 2) * 3.1 + (Math.random() - 0.5) * 1.2;
        gx = gp.x - ax * back + tx * side; gz = gp.z - az * back + tz * side;
      }
      ped._ccArc = { x: gx, z: gz };
      ped.guard = { x: gx, z: gz }; ped.homeGuard = { x: sp.x, z: sp.z };
      if (ped.target && ped.target.set) ped.target.set(gx, 0, gz);
      ped.state = "walk"; ped.pause = 0; ped.path = null;
      R.raiders.push(ped);
    }
    if (!R.raiders.length) return false;
    rt.raid = R;
    rt.raidCool = RAID_COOLDOWN; rt.sinceRaid = 0;
    big((gang.name || "A crew") + " are hitting your compound");
    note("They want the stash. Your guards are on it.", 3);
    if (CBZ.fullMap && CBZ.fullMap.setWaypoint) { try { CBZ.fullMap.setWaypoint(c.x, c.z, "Your compound"); } catch (e) {} }
    if (CBZ.cityPostAlert) { try { CBZ.cityPostAlert(c.x, c.z, 90); } catch (e) {} }
    if (CBZ.cityGangProvoke) { try { CBZ.cityGangProvoke(gang.id, 0.3); } catch (e) {} }
    return true;
  }

  function defenders(plot, rt, out) {
    out.length = 0;
    for (const ped of rt.bodies.values()) if (ped && !ped.dead && (ped.ko || 0) <= 0 && !ped.inCar) out.push(ped);
    const pa = PA(), pl = P();
    if (pa && pl && !pl.dead && !pl.driving) out.push(pa);
    return out;
  }
  const _defs = [];
  function nearestIn(list, x, z, r) {
    let best = null, bd = r * r;
    for (const p of list) { const dd = d2(p.pos.x, p.pos.z, x, z); if (dd < bd) { bd = dd; best = p; } }
    return best;
  }
  function plantCharge(plot, rt, R) {
    const gp = rt.gatePos, f = front(plot), A = arena();
    let mesh = null;
    if (CBZ.cityC4Mesh && A && A.root) {
      try { mesh = CBZ.cityC4Mesh(); mesh.position.set(gp.x + f.nx * 0.45, 1.0, gp.z + f.nz * 0.45); mesh.rotation.set(Math.PI / 2, Math.atan2(f.nx, f.nz), 0); A.root.add(mesh); } catch (e) { mesh = null; }
    }
    R.charge = { t: 6, beep: 0, x: gp.x + f.nx * 0.3, z: gp.z + f.nz * 0.3, mesh: mesh };
    let who = null, bd = Infinity;
    for (const ped of rt.bodies.values()) { if (!ped || ped.dead) continue; const q = d2(ped.pos.x, ped.pos.z, gp.x, gp.z); if (q < bd) { bd = q; who = ped; } }
    if (who) say(who, BARK_C4);
  }
  function tickCharge(plot, rt, R, dt) {
    const ch = R.charge; if (!ch) return;
    ch.t -= dt; ch.beep -= dt;
    if (ch.mesh && ch.mesh.userData && ch.mesh.userData.led) ch.mesh.userData.led.visible = ((ch.t * (ch.t < 2 ? 6 : 2)) | 0) % 2 === 0;
    if (ch.beep <= 0) { ch.beep = ch.t < 2 ? 0.3 : 1; if (nearPlayer(ch.x, ch.z, 45)) sfx("blip"); }
    if (ch.t > 0) return;
    if (ch.mesh && ch.mesh.parent) ch.mesh.parent.remove(ch.mesh);
    R.charge = null; R.blasts++;
    if (CBZ.cityExplosion) { try { CBZ.cityExplosion(ch.x, ch.z, { power: 1.5, radius: 6, byPlayer: false, y: 1.0 }); } catch (e) {} }
    R.checkBreach = 0.4;
  }

  function endRaid(plot, rt, why) {
    const R = rt.raid; if (!R) return;
    if (R.charge && R.charge.mesh && R.charge.mesh.parent) R.charge.mesh.parent.remove(R.charge.mesh);
    for (const r of R.raiders) { if (r && !r.dead && CBZ.cityUnpostNpc) CBZ.cityUnpostNpc(r); }
    let text;
    const who = R.gang.name || "They";
    if (R.escaped > 0) text = who + " got away with " + fmt(R.escaped) + " from the stash.";
    else if (R.taken > 0) text = who + " grabbed " + fmt(R.taken) + " but never made it out. The cash is on the bodies.";
    else if (why === "wiped") text = "Held. " + R.killed + " of " + who + " down, nothing taken.";
    else text = who + " pulled back. Nothing taken.";
    crewData(plot).lastRaid = { gang: R.gang.name || R.gang.id, text: text, day: dayNow(), killed: R.killed, took: R.escaped };
    markDirty();
    rt.raid = null;
    note("Raid over. " + text, 3.4);
    if (CBZ.fullMap && CBZ.fullMap.clearWaypoint) { try { CBZ.fullMap.clearWaypoint("city"); } catch (e) {} }
  }

  function tickRaid(plot, rt, dt) {
    const R = rt.raid; if (!R) return;
    R.t += dt;
    const c = center(plot), gp = rt.gatePos || front(plot), f = front(plot);
    const defs = defenders(plot, rt, _defs);
    tickCharge(plot, rt, R, dt);
    if (R.checkBreach != null) {
      R.checkBreach -= dt;
      if (R.checkBreach <= 0) {
        R.checkBreach = null;
        const gate = refreshGate(plot, rt, true);
        if (!gate || isGateOpen(gate) || R.blasts >= 3) { R.breached = true; R.phase = "push"; }
        else R.breacher = null;           // still standing: somebody else carries the next one
      }
    }
    R.alertT -= dt;
    if (R.alertT <= 0) { R.alertT = 3; if (CBZ.cityPostAlert) { try { CBZ.cityPostAlert(c.x, c.z, 80); } catch (e) {} } }
    if (R.phase === "approach" && R.t > 9) R.phase = R.breached ? "push" : "siege";
    const st = stashSpot(plot);
    const retreat = R.t > RAID_MAX_T;
    let alive = 0;
    for (let i = R.raiders.length - 1; i >= 0; i--) {
      const r = R.raiders[i];
      if (!r || r.culled || !r.group || (!r.dead && (!r.group.parent || (CBZ.cityPeds || []).indexOf(r) < 0))) { R.raiders.splice(i, 1); continue; }
      if (r.dead) {
        R.killed++;
        if (r._ccLoot > 0) { R.recovered += r._ccLoot; if (nearPlayer(r.pos.x, r.pos.z, 120)) note("He dropped with " + fmt(r._ccLoot) + " of your money on him. Loot the body.", 3); }
        if (r === R.breacher) R.breacher = null;
        R.raiders.splice(i, 1);
        continue;
      }
      alive++;
      // RUNNER: has the money, heads for the street
      if (r._ccR === "run" || retreat) {
        if (r._ccR !== "run") r._ccR = "out";
        r.rage = null; r.guard = null;
        if (!r._ccFled || (R.t - r._ccFled) > 4) { r._ccFled = R.t; if (CBZ.cityFleeFrom) { try { CBZ.cityFleeFrom(r, c.x, c.z); } catch (e) {} } else if (r.target && r.target.set) { r.target.set(R.spawn.x, 0, R.spawn.z); r.state = "walk"; } }
        const pl = P();
        const far = !pl || d2(r.pos.x, r.pos.z, pl.pos.x, pl.pos.z) > 85 * 85;
        const gone = far || d2(r.pos.x, r.pos.z, c.x, c.z) > 95 * 95 || (retreat && R.t > RAID_MAX_T + 45);
        if (gone && (far || !CBZ.npcTransitionSafe || CBZ.npcTransitionSafe(r.pos.x, r.pos.z, { minDistance: 30 }) || R.t > RAID_MAX_T + 45)) {
          if (r._ccLoot > 0) R.escaped += r._ccLoot;
          if (CBZ.cityUnpostNpc) CBZ.cityUnpostNpc(r);
          R.raiders.splice(i, 1); alive--;
        }
        continue;
      }
      // BREACHER: walk the charge to the gate
      if (!R.breached && R.phase !== "approach" && !R.charge && (!R.breacher || R.breacher.dead) && r._ccR === "arc" && R.blasts < 3) { R.breacher = r; r._ccR = "breach"; }
      if (r._ccR === "breach" && !R.breached && R.phase !== "approach") {
        const bx = gp.x + f.nx * 1.4, bz = gp.z + f.nz * 1.4;
        if (!R.charge) {
          r.rage = null; r.guard = { x: bx, z: bz };
          if (r.target && r.target.set) r.target.set(bx, 0, bz);
          r.state = "walk"; r.pause = 0;
          if (d2(r.pos.x, r.pos.z, bx, bz) < 2.2 * 2.2) {
            const gate = refreshGate(plot, rt, true);
            if (gate && !isGateOpen(gate)) { plantCharge(plot, rt, R); if (!R.barked) { R.barked = true; say(r, BARK_RAID); } }
            else { R.breached = true; R.phase = "push"; }
            r._ccR = "arc"; R.breacher = null;
            r.guard = { x: r._ccArc.x, z: r._ccArc.z };
          }
          continue;
        }
      }
      // PUSH: through the breach to the stash
      if (R.phase === "push" && r._ccR !== "call") {
        const insideNow = inRect(plot, r.pos.x, r.pos.z, -1);
        const goal = insideNow || !R.walls ? { x: st.x, z: st.z } : { x: gp.x - f.nx * 2, z: gp.z - f.nz * 2 };
        const close = nearestIn(defs, r.pos.x, r.pos.z, 11);
        if (close) { if (r.rage !== close) { r.rage = close; r.state = "fight"; } }
        else {
          r.rage = null; r.guard = { x: goal.x, z: goal.z };
          if (r.target && r.target.set) r.target.set(goal.x, 0, goal.z);
          if (r.state === "fight" || r.state === "idle") r.state = "walk";
          r.pause = 0;
        }
        if (R.hadStash && st.piece && d2(r.pos.x, r.pos.z, st.x, st.z) < 2.4 * 2.4) {
          r._ccStashT = (r._ccStashT || 0) + dt;
          if (r._ccStashT >= 4) {
            const have = stashCash(plot);
            const took = have > 0 ? (+kcall("stashTake", st.piece, Math.floor(have * STASH_TAKE_FRAC)) || 0) : 0;
            r._ccStashT = 0;
            if (took > 0) {
              r.cash = (r.cash || 0) + took; r._ccLoot = (r._ccLoot || 0) + took; R.taken += took;
              r._ccR = "run";
              big("They're taking the stash!");
              note(fmt(took) + " gone from the stash. Stop him before he makes the street.", 3);
              markDirty();
            } else if (have <= 0) r._ccR = "run";
          }
        }
        continue;
      }
      // SIEGE / APPROACH: hold the arc, shoot whatever shows
      if (!r.rage || r.rage.dead || d2(r.rage.pos.x, r.rage.pos.z, r.pos.x, r.pos.z) > 50 * 50) {
        const tgt = nearestIn(defs, r.pos.x, r.pos.z, 45);
        if (tgt) { r.rage = tgt; r.state = "fight"; }
        else if (r._ccArc) { r.guard = { x: r._ccArc.x, z: r._ccArc.z }; if (d2(r.pos.x, r.pos.z, r._ccArc.x, r._ccArc.z) > 4) { if (r.target && r.target.set) r.target.set(r._ccArc.x, 0, r._ccArc.z); r.state = "walk"; r.pause = 0; } }
      }
    }
    if (!R.raiders.length) endRaid(plot, rt, R.taken > 0 || retreat ? "done" : "wiped");
    void alive;
  }

  function raidDirector(plot, rt, dt) {
    if (rt.raid) return;
    const K = kit();
    const fortified = !!(K && (stashPiece(plot) || hasWalls(plot, rt)));
    if (!fortified) { rt.fortAge = 0; return; }
    rt.fortAge += dt; rt.sinceRaid += dt;
    if (rt.raidCool > 0) { rt.raidCool -= dt; return; }
    if (rt.fortAge < RAID_FIRST_AFTER) return;
    const c = center(plot);
    if (!nearPlayer(c.x, c.z, RAID_NEAR_R)) return;
    const pl = P(); if (pl && (pl.driving || pl._aircraft)) return;
    const cash = stashCash(plot);
    const p = 0.002 + Math.min(0.01, cash / 20000 * 0.01) + Math.min(1, rt.sinceRaid / 900) * 0.004;
    if (Math.random() < p * dt) startRaid(plot, null);
  }

  // ---- materialise / dematerialise from the roster (1 s) -----------------------------------
  function tendPresence(plot, rt) {
    const c = center(plot), pl = P();
    if (!pl || !pl.pos) return;
    const dd = d2(pl.pos.x, pl.pos.z, c.x, c.z);
    const d = crewData(plot);
    if (dd > DROP_R * DROP_R && !rt.raid) {
      for (const e of d.members) {
        const ped = rt.bodies.get(e.id);
        if (!ped || ped._ccTask || ped._cbzSeat || ped._cbzArc || ped.inCar) continue;
        despawnBody(plot, rt, e, ped);
      }
      return;
    }
    if (dd > BODY_R * BODY_R) return;
    let spawned = 0;
    const peds = CBZ.cityPeds || [];
    for (const e of d.members) {
      if (rt.bodies.has(e.id)) {
        const ped = rt.bodies.get(e.id);
        // a city rebuild reaps rosters without telling anyone: drop the stale ref
        if (ped && peds.indexOf(ped) < 0) { releaseBody(ped); rt.bodies.delete(e.id); continue; }
        if (ped && !ped.dead) e.hp = Math.round(ped.hp || e.hp);
        continue;
      }
      if (spawned >= 3) break;               // spread the mint over a few seconds
      const slot = slotFor(plot, rt, e);
      const ped = spawnBody(plot, rt, e, slot.x, slot.z, slot.tower ? slot.y : 0, slot.face);
      if (ped) { settleOnSlot(ped, plot, slot); spawned++; }
    }
  }

  // ---- the property panel section -------------------------------------------------------------
  let panelWired = false, changeWired = false;
  function panelSection(plot) {
    if (!plot) return null;
    const d = crewData(plot), cap = capacity(plot);
    const n = d.members.length, full = n >= cap;
    const gC = countRole(d, "guard"), wC = countRole(d, "worker"), dC = countRole(d, "driver");
    let wage = 0; for (const e of d.members) wage += (ROLES[e.role] || ROLES.guard).wage;
    const rows = [];
    rows.push({ text: "Crew " + n + " / " + cap, sub: gC + " guard" + (gC === 1 ? "" : "s") + ", " + wC + " worker" + (wC === 1 ? "" : "s") + ", " + dC + " driver" + (dC === 1 ? "" : "s") + (kit() ? "" : ". Build bunks to house more.") });
    const btn = (role) => ({
      label: ROLES[role].label + " " + fmt(ROLES[role].price),
      tone: "ok", disabled: full || !canPay(ROLES[role].price),
      onClick: function () { hire(plot, role); },
    });
    rows.push({ text: "Hire", sub: full ? "No bunk free." : "They walk in from the street.", buttons: [btn("guard"), btn("worker"), btn("driver")] });
    const withYou = followersNear(45).length;
    let posted = 0; for (const e of d.members) if (e.origin === "gang" || e.origin === "companion") posted++;
    rows.push({
      text: "Your people", sub: withYou ? withYou + " with you right now." : "Nobody with you right now.",
      buttons: [
        { label: "Post my crew here", disabled: !withYou || full, onClick: function () { stationNearby(plot); } },
        { label: "Crew, with me", disabled: !posted, onClick: function () { pullBack(plot); } },
      ],
    });
    if (n) rows.push({ text: "Wages " + fmt(wage) + " a day", sub: "Paid from the stash first, then your bank. Unpaid crew walk." });
    const R = RT.get(plot.id);
    if (R && R.raid) rows.push({ text: "Under attack", sub: (R.raid.gang.name || "A crew") + " are hitting the compound right now." });
    else if (d.lastRaid) rows.push({ text: "Last raid", sub: d.lastRaid.text });
    return { title: "Crew", rows: rows };
  }
  function wirePlots() {
    const A = plotsApi(); if (!A) return;
    if (!panelWired && typeof A.addPanelSection === "function") { try { A.addPanelSection(panelSection); panelWired = true; } catch (e) {} }
    if (!changeWired && typeof A.onChange === "function") {
      try {
        A.onChange(function (ev) {
          if (!ev || !ev.plot) return;
          const rt = RT.get(ev.plot.id);
          if (ev.type === "sell") {
            if (rt) {
              if (rt.raid) endRaid(ev.plot, rt, "done");
              const d = crewData(ev.plot);
              for (const e of d.members.slice()) walkOff(ev.plot, rt, e);
              RT.delete(ev.plot.id);
            }
            if (ev.plot.data) ev.plot.data.crew = null;
          } else if (ev.type === "load" && rt) {
            for (const [id, ped] of rt.bodies) { releaseBody(ped); if (CBZ.cityUnpostNpc) CBZ.cityUnpostNpc(ped); rt.bodies.delete(id); }
          } else if (rt) { rt.posts = null; rt.postsT = 0; rt.gatesT = 0; }
        });
        changeWired = true;
      } catch (e) {}
    }
  }

  // ---- [O] menu surface (city/playergang.js renders these) ---------------------------------
  function nearestPlot(r) {
    const A = plotsApi(), pl = P(); if (!A || !pl || typeof A.list !== "function") return null;
    let best = null, bd = r * r;
    let list = null; try { list = A.list(); } catch (e) { list = null; }
    for (const p of list || []) {
      if (!p || !p.rect) continue;
      const c = center(p);
      const inside = inRect(p, pl.pos.x, pl.pos.z, 0);
      const dd = inside ? 0 : d2(c.x, c.z, pl.pos.x, pl.pos.z);
      if (dd < bd) { bd = dd; best = p; }
    }
    return best;
  }
  function menuEntries() {
    const out = [];
    if (!inCity()) return out;
    const plot = nearestPlot(90);
    const pl = P();
    if (plot) {
      const d = crewData(plot), cap = capacity(plot);
      const withYou = followersNear(45).length;
      if (withYou && d.members.length < cap) out.push({ act: "cc-post", label: "POST crew at the compound (" + withYou + " with you)", color: "#7fd0ff" });
      const rt = RT.get(plot.id);
      let posted = 0;
      if (rt) for (const e of d.members) if ((e.origin === "gang" || e.origin === "companion") && rt.bodies.has(e.id)) posted++;
      if (posted) out.push({ act: "cc-back", label: "CREW, WITH ME (" + posted + " off the compound)", color: "#9be564" });
    }
    if (pl && pl.driving && pl._vehicle && nearestDriver(pl._vehicle.pos.x, pl._vehicle.pos.z, 45)) out.push({ act: "cc-drive", label: "DRIVER, take the wheel to the waypoint", color: "#ffd166" });
    return out;
  }
  function menuDo(act) {
    if (act === "cc-post") return stationNearby(nearestPlot(90));
    if (act === "cc-back") return pullBack(nearestPlot(90));
    if (act === "cc-drive") return driveMe();
    return false;
  }

  function roster(plot) {
    if (!plot) return [];
    const d = crewData(plot), rt = RT.get(plot.id);
    return d.members.map((e) => {
      const ped = rt ? rt.bodies.get(e.id) || null : null;
      const post = ped && ped._post ? { x: ped._post.x, z: ped._post.z, kind: ped._post.kind } : null;
      return { ped: ped, role: e.role, post: post, name: e.name, id: e.id, origin: e.origin };
    });
  }

  // ---- THE TICK --------------------------------------------------------------------------------
  let fastT = 0, scanT = 0, camT = 0, slowT = 0;
  const _live = [];
  function listPlots() {
    const A = plotsApi(); if (!A || typeof A.list !== "function") return null;
    try { return A.list(); } catch (e) { return null; }
  }
  if (CBZ.onUpdate) CBZ.onUpdate(41.96, function (dt) {
    if (!playing() || noSim()) return;
    dt = Math.min(dt || 0, 0.1);
    if (saveT > 0) { saveT -= dt; if (saveT <= 0) { saveT = -1; flushSave(); } }
    // cadenced, and each cadence is handed the REAL time since it last ran
    slowT += dt; const slow = slowT >= 1; const slowDt = slowT; if (slow) slowT = 0;
    fastT += dt; const fast = fastT >= 0.25; const fastDt = fastT; if (fast) fastT = 0;
    scanT += dt; const scan = scanT >= 0.3; if (scan) scanT = 0;
    camT += dt; const cams = camT >= 0.5; if (cams) camT = 0;
    if (!fast && !scan && !cams && !slow) return;
    if (slow) wirePlots();
    const plots = listPlots();
    if (!plots) return;
    if (slow) {
      // forget plots you no longer own
      for (const [id, rt] of RT) if (plots.indexOf(rt.plot) < 0) {
        if (rt.raid) endRaid(rt.plot, rt, "done");
        for (const ped of rt.bodies.values()) { releaseBody(ped); if (CBZ.cityUnpostNpc) CBZ.cityUnpostNpc(ped); }
        RT.delete(id);
      }
      for (const plot of plots) {
        if (!plot || !plot.rect) continue;
        const has = plot.data && plot.data.crew && plot.data.crew.members && plot.data.crew.members.length;
        const rt = (has || RT.has(plot.id) || kit()) ? rtOf(plot) : null;
        if (!rt) continue;
        rt.postsT -= slowDt; rt.gatesT -= slowDt; rt.barkT -= slowDt;
        if (has) { tendPresence(plot, rt); payWages(plot, rt); }
        raidDirector(plot, rt, slowDt);
      }
    }
    _live.length = 0;
    for (const rt of RT.values()) if (rt.bodies.size || rt.raid) _live.push(rt);
    if (!_live.length) return;
    if (scan) scanHostiles(_live);
    for (const rt of _live) {
      const plot = rt.plot;
      if (fast) {
        tickBodies(plot, rt, fastDt);
        tendGate(plot, rt, fastDt);
        tickPatrol(plot, rt, fastDt);
        if (rt.raid) tickRaid(plot, rt, fastDt);
      }
      if (cams) tickCameras(plot, rt);
    }
  });

  // ---- a fresh run drops every body and raid (the roster lives in the save) -----------------------
  CBZ.compoundCrewReset = function () {
    for (const rt of RT.values()) {
      if (rt.raid) { for (const r of rt.raid.raiders) if (r && CBZ.cityUnpostNpc) CBZ.cityUnpostNpc(r); if (rt.raid.charge && rt.raid.charge.mesh && rt.raid.charge.mesh.parent) rt.raid.charge.mesh.parent.remove(rt.raid.charge.mesh); }
      for (const ped of rt.bodies.values()) { releaseBody(ped); if (CBZ.cityUnpostNpc) CBZ.cityUnpostNpc(ped); }
    }
    RT.clear();
  };

  CBZ.compoundCrew = {
    ROLES: ROLES,
    hire: hire,
    station: station,
    roster: roster,
    raid: function (plot, gangId) { return startRaid(plot, gangId || null); },
    raidActive: raidActive,
    pullBack: pullBack,
    stationNearby: stationNearby,
    driveMe: driveMe,
    capacity: capacity,
    menuEntries: menuEntries,
    menuDo: menuDo,
    panelSection: panelSection,
    audit: function () {
      let bodies = 0, members = 0, raids = 0;
      for (const rt of RT.values()) { bodies += rt.bodies.size; if (rt.raid) raids++; members += crewData(rt.plot).members.length; }
      return { plots: RT.size, members: members, bodies: bodies, raids: raids, panelWired: panelWired };
    },
    // pure helpers, exported for node checks
    _t: { inRect: inRect, fallbackPosts: fallbackPosts, streetSpot: streetSpot, hostileTo: hostileTo, capacity: capacity, crewData: crewData, slotFor: slotFor, rtOf: rtOf, payWages: payWages, charge: charge },
  };
})();
