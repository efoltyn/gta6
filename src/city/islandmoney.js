/* ============================================================
   city/islandmoney.js — THE ISLANDS' MONEY: banks, vaults everywhere,
   loans, and the loan shark.

   OWNER (2026-10-22): "Banks, which are like a loan shark at a better rate.
   And also they are where the vaults are. There's vaults everywhere. Every
   place should have some sort of vault, but banks have the big vaults with
   tons of fucking money in them." And the loan shark is a place you walk
   into.

   Nothing here is a second bank. Every piece is Gang City's, standing in an
   island building through world/island_venue.js:
     • THE BANK (b.use "bank"; the downtown tower is the Island Bank HQ): the
       ground floor cleared and fitted as a banking hall: a teller line with
       glass and a staff gap, a teller behind every window with a real drawer
       (city/bank.js cityBankDrawerDeclare), the manager's glass office with
       the loan desk (city/bank.js's lending panel and loan engine), an ATM on
       the street wall with its own cassette, armed guards, and at the back
       the strongroom (city/bank.js cityVaultRoom: "reserve" at the HQ,
       "count" at a branch) full of money that comes out as duffels.
       Robbing it is the strongroom's own two ways in: a charge on the door,
       or one of the staff with his hands up beside it.
     • A VAULT IN EVERY PLACE (islandVenue.on("*")): after a building's own
       fit-out, it gets the safe that kind of place has (city/bank.js
       citySafe): a cash box in a house's bedroom, a wall safe in a villa,
       a floor safe in a shop's back corner, an office safe at the pawn shop,
       the jeweller, the dealer, the town hall, the evidence safe at the
       police station. A trade with no fit-out of its own gets a till on a
       counter. Other venues can ask for theirs exactly where they want it:
         CBZ.islandVenue.safe(b, { k, lx, lz, ly, yaw, grade, of, name })
         CBZ.islandVenue.till(b, { k, lx, lz, ly, of, name })
       and the automatic pass then leaves that building alone.
     • THE LOAN SHARK (b.use "loans"): a cheque casher's counter behind
       glass, and in the back office the man himself with his muscle and his
       strongbox. He lends with no questions at twenty a week, three days to
       pay (CBZ.loanShark). Miss it and his collectors find you, through the
       ONE demand ladder (CBZ.brain.demand, mood "debt"): they ask, they warn,
       they beat it out of you and take what you carry. Kill him and the
       debt dies with him. The bank (city/bank.js creditRefusal) will not
       lend to a man who is behind with him.
     • THE PEOPLE: tellers, managers, guards, the shark and his muscle are
       the island's own people posted through CBZ.islandVenue.staff (one
       poster for every island venue); the collectors are the island's own
       people sent out. Aim a gun at any posted, unarmed worker (a teller, a
       shop clerk) and his hands go up and he walks where you walk him; a
       guard answers a drawn gun in his building through the demand ladder's
       "security" kind, draws, and shoots once it is a robbery. A man shot at
       his post stays vacant.

   Everything a fit-out builds is under the building's group and leaves with
   its island (the fit-out's dispose).
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.onUpdate) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  function econOn() { return CBZ.economyMode ? CBZ.economyMode(g && g.mode) : false; }
  function isles() { return !!(g && g.mode === "archipelago"); }
  function fmt$(n) { n = Math.round(n || 0); return "$" + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function note(t, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(t, s || 2); }
  function say(p, text) { if (p && text && CBZ.speech && CBZ.speech.say) { try { CBZ.speech.say(p, text, { force: true }); } catch (e) {} } }
  function h01(b, salt) { return CBZ.hash01 ? CBZ.hash01(b.ox || b.x || 0, b.oz || b.z || 0, salt) : 0.5; }
  function pace() { return CBZ.paceTime ? CBZ.paceTime() : ((CBZ.now || 0) / 150); }
  function P() { return CBZ.player; }
  function gunOut() { return !!(CBZ.cityHasGun && CBZ.cityHasGun()); }
  function aiming() { return gunOut() && !!(CBZ.isAimingWeapon && CBZ.isAimingWeapon()); }
  function addCol(rec) {
    if (CBZ.colliderAddMany) CBZ.colliderAddMany([rec]); else (CBZ.colliders || (CBZ.colliders = [])).push(rec);
  }

  /* ---- shared materials (one each for the session) ----------------------- */
  let GLASS = null;
  function glassMat() {
    if (GLASS) return GLASS;
    GLASS = new THREE.MeshLambertMaterial({ color: 0xbfd6e2, transparent: true, opacity: 0.22, depthWrite: false });
    GLASS._shared = true; GLASS.name = "island-money-glass";
    return GLASS;
  }
  const BOX = { g: null };
  function unitBox() { if (!BOX.g) { BOX.g = new THREE.BoxGeometry(1, 1, 1); BOX.g._shared = true; } return BOX.g; }
  // a pane of glass in the building's frame, solid to the floor-to-head band
  function pane(b, F, lx, ly, lz, w, h, d, solid) {
    const m = new THREE.Mesh(unitBox(), glassMat());
    m.scale.set(w, h, d); m.position.set(lx, ly, lz);
    m.castShadow = false; m.renderOrder = 2;
    b.group.add(m);
    const ud = b.group.userData;
    (ud.rooms || (ud.rooms = [])).push(m);
    if (ud.roomsOn === false) m.visible = false;
    if (solid) {
      const a = F.toWorld(lx - w / 2, lz - d / 2), c = F.toWorld(lx + w / 2, lz + d / 2);
      addCol({ minX: Math.min(a.x, c.x), maxX: Math.max(a.x, c.x), minZ: Math.min(a.z, c.z), maxZ: Math.max(a.z, c.z),
        y0: b.gy + ly - h / 2, y1: b.gy + ly + h / 2 });
    }
    return m;
  }

  /* ---- free space: keep-outs and the furniture already standing ---------- */
  function rectHits(a, r) { return a.x0 < r.x1 && a.x1 > r.x0 && a.z0 < r.z1 && a.z1 > r.z0; }
  function furnCols(b, k) {
    const out = [], I = b.interior;
    if (I && I.furn) for (const r of I.furn) if (r.L === k && !r.cleared && r.cols) for (const c of r.cols) out.push(c);
    return out;
  }
  // is the local rect free on storey k (inside the walls, off the keep-outs,
  // clear of the furniture standing there)?
  function free(b, F, k, r) {
    const L = F.local;
    if (r.x0 < L.x0 + 0.02 || r.x1 > L.x1 - 0.02 || r.z0 < L.z0 + 0.02 || r.z1 > L.z1 - 0.02) return false;
    for (const q of F.keepOut) if (rectHits(r, q)) return false;
    const cols = furnCols(b, k);
    if (cols.length) {
      const a = F.toWorld(r.x0, r.z0), c = F.toWorld(r.x1, r.z1);
      const wr = { x0: Math.min(a.x, c.x), x1: Math.max(a.x, c.x), z0: Math.min(a.z, c.z), z1: Math.max(a.z, c.z) };
      for (const col of cols) if (rectHits(wr, { x0: col.minX, x1: col.maxX, z0: col.minZ, z1: col.maxZ })) return false;
    }
    for (const t of (b._moneyRects || [])) if (t.k === k && rectHits(r, t)) return false;
    // what the building's other fit-outs stood there (a counter, a rack, a
    // cell): its colliders on this storey that are not its walls
    const bc = b.colliders;
    if (bc && bc.length) {
      const a = F.toWorld(r.x0, r.z0), c = F.toWorld(r.x1, r.z1), B = F.bounds;
      const wr = { x0: Math.min(a.x, c.x), x1: Math.max(a.x, c.x), z0: Math.min(a.z, c.z), z1: Math.max(a.z, c.z) };
      for (const col of bc) {
        if (!col || col.minX == null) continue;
        if (col.y1 != null && col.y1 < F.y + 0.1) continue;
        if (col.y0 != null && col.y0 > F.y + 1.6) continue;
        if (col.minX < B.x0 - 0.02 || col.maxX > B.x1 + 0.02 || col.minZ < B.z0 - 0.02 || col.maxZ > B.z1 + 0.02) continue;   // a wall
        if (rectHits(wr, { x0: col.minX, x1: col.maxX, z0: col.minZ, z1: col.maxZ })) return false;
      }
    }
    return true;
  }
  function claim(b, k, r) { (b._moneyRects || (b._moneyRects = [])).push({ k: k, x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1 }); }

  /* ======================================================================
     THE PEOPLE AT THEIR POSTS. The body is world/island_venue.js's
     (CBZ.islandVenue.staff: one of the island's own people holding his spot,
     stood where nobody is looking, gone with the island, a dead one stays
     dead). This file only adds what a bank's and a shark's people DO:
       • any posted, unarmed island worker (a teller, a shop clerk, the
         shark) with a gun on him puts his hands up, and walks where the
         gun walks him;
       • an armed one (a guard, the muscle) answers a drawn gun in his
         building through the demand ladder's "security" kind, and once it
         is a robbery he shoots.
     ====================================================================== */
  const POSTS = [];
  const VENUES = [];
  const _v3 = new THREE.Vector3();
  function unseen(x, y, z) {
    if (CBZ.leave && CBZ.leave.unseen) { try { return !!CBZ.leave.unseen({ x: x, y: y, z: z }); } catch (e) {} }
    const cam = CBZ.camera;
    if (!cam) return true;
    const d = Math.hypot(cam.position.x - x, cam.position.z - z);
    if (d < 22) return false;
    _v3.set(x, y + 1, z).project(cam);
    const on = _v3.z > -1 && _v3.z < 1 && Math.abs(_v3.x) < 1.2 && Math.abs(_v3.y) < 1.2;
    return !on || d > 160;
  }
  function removeBot(bot) {
    if (!bot) return;
    if (CBZ.removeSurvivorBot) { try { if (CBZ.removeSurvivorBot(bot)) return; } catch (e) {} }
    const L = CBZ.bots;
    if (L) { const i = L.indexOf(bot); if (i >= 0) L.splice(i, 1); }
    if (CBZ.brain && CBZ.brain.unregister && bot._survBrain) { try { CBZ.brain.unregister(bot); } catch (e) {} bot._survBrain = false; }
    if (bot.group && bot.group.parent) bot.group.parent.remove(bot.group);
  }
  // post(b, lx, lz, face, spec): face is building-local (0 = into the room,
  // PI = toward the street door); spec { venue, job, armed, hp, name }
  function post(b, lx, lz, face, spec) {
    const IV = CBZ.islandVenue;
    if (!IV || !IV.staff) return null;
    const rec = {
      venue: spec.venue || null, job: spec.job || "staff", name: spec.name || null,
      armed: !!spec.armed, hp: spec.hp || 0, ps: null, setFor: null, lostSeen: false,
      hostile: false, case: null, fireT: 0, calmT: 0, cdT: 0, lookAt: null,
    };
    rec.ps = IV.staff(b, lx, lz, face, { job: rec.job, look: function () { return rec.lookAt; } });
    if (!rec.ps) return null;
    claim(b, 0, { x0: lx - 0.3, x1: lx + 0.3, z0: lz - 0.3, z1: lz + 0.3 });
    POSTS.push(rec);
    if (rec.venue) rec.venue.staff.push(rec);
    return rec;
  }
  function body(rec) { return rec && rec.ps ? rec.ps.body() : null; }
  // walk a posted man somewhere else (his post moves with him), or home
  function steer(bot, x, z) {
    const p = bot.post;
    if (!p) { bot.target.set(x, 0, z); bot.pause = Math.max(bot.pause, 1); return; }
    if (!bot._postHome) bot._postHome = { x: p.x, z: p.z };
    p.x = x; p.z = z;
    bot.target.set(x, 0, z);
  }
  function sendHome(bot) {
    const h = bot._postHome;
    if (!h || !bot.post) return;
    bot.post.x = h.x; bot.post.z = h.z;
    bot._postHome = null;
  }
  function sameFloor(bot, py) { return Math.abs((bot.pos.y || 0) - py) < 2.4; }
  function aimedAt(bot, maxD) {
    const p = P(); if (!p || !aiming()) return false;
    const dx = bot.pos.x - p.pos.x, dz = bot.pos.z - p.pos.z, d = Math.hypot(dx, dz);
    if (d > maxD || d < 0.05 || !sameFloor(bot, p.pos.y)) return false;
    const yaw = CBZ.cam ? CBZ.cam.yaw : 0;
    return (dx / d) * -Math.sin(yaw) + (dz / d) * -Math.cos(yaw) > 0.9;
  }

  // ---- THE GUARD: the demand ladder's "security" kind, then the gun -------
  function D() { return CBZ.brain && CBZ.brain.demand; }
  const _s = { dist: 99, speed: 0, armed: false, aiming: false, attacking: false, paid: false, inside: true, fled: false };
  // the gun on his hip, or in his hand (systems/actorweapons.js: the real model)
  function holster(bot, on) {
    if (!bot || !bot.armed || !!bot._holstered === !!on) return;
    bot._holstered = !!on;
    if (CBZ.syncActorWeapon) { try { CBZ.syncActorWeapon(bot); } catch (e) {} }
    if (on && bot.char) bot.char.aimingPose = false;
  }
  const _mz = new THREE.Vector3();
  function guardShoot(st, bot, dt) {
    const p = P();
    if (!p || p.dead) return;
    const dx = p.pos.x - bot.pos.x, dz = p.pos.z - bot.pos.z, d = Math.hypot(dx, dz);
    bot.group.rotation.y = Math.atan2(dx, dz);
    holster(bot, false);
    if (bot.char) bot.char.aimingPose = true;
    st.fireT -= dt;
    if (st.fireT > 0 || d > 38) return;
    st.fireT = 0.85 + Math.random() * 0.6;
    let mx = bot.pos.x + (dx / (d || 1)) * 0.5, my = (bot.pos.y || 0) + 1.45, mz = bot.pos.z + (dz / (d || 1)) * 0.5;
    if (CBZ.actorMuzzle) { try { const m = CBZ.actorMuzzle(bot, _mz); if (m) { mx = m.x; my = m.y; mz = m.z; } } catch (e) {} }
    const ty = (p.pos.y || 0) + 1.2;
    // a wall between them stops the round
    if (CBZ.rayColliders) {
      try { const hit = { hit: false }; if (CBZ.rayColliders(mx, my, mz, p.pos.x - mx, ty - my, p.pos.z - mz, 1, hit, { any: true })) return; } catch (e) {}
    }
    const hitP = Math.max(0.12, 0.6 - d * 0.014);
    const hit = Math.random() < hitP;
    const tx = p.pos.x + (hit ? 0 : (Math.random() - 0.5) * 1.6), tz = p.pos.z + (hit ? 0 : (Math.random() - 0.5) * 1.6);
    if (CBZ.tracer) { try { CBZ.tracer({ x: mx, y: my, z: mz }, { x: tx, y: ty, z: tz }, {}); } catch (e) {} }
    if (CBZ.gunVoice) { try { CBZ.gunVoice("sidearm", d); } catch (e) {} } else if (CBZ.sfx) CBZ.sfx("report");
    if (CBZ.survivorsHearShot) { try { CBZ.survivorsHearShot(mx, mz, bot); } catch (e) {} }
    if (hit && CBZ.surv && CBZ.surv.hurt && CBZ.surv.playerActor) {
      try { CBZ.surv.hurt(CBZ.surv.playerActor, 14 + Math.random() * 8, { fromX: bot.pos.x, fromZ: bot.pos.z, cause: "shot" }); } catch (e) {}
    }
  }
  // his nerve does not run him off his job
  function steady(bot) { bot._scare = null; bot.panicT = 0; }
  function guardTick(rec, bot, dt) {
    const p = P(); if (!p) return false;
    const V = rec.venue;
    const dx = p.pos.x - bot.pos.x, dz = p.pos.z - bot.pos.z, d = Math.hypot(dx, dz);
    if (rec.hostile) {
      if (p.dead || d > 90) {
        rec.calmT += dt;
        if (rec.calmT > 12) { rec.hostile = false; rec.calmT = 0; rec.lookAt = null; holster(bot, true); sendHome(bot); }
        return true;
      }
      rec.calmT = 0;
      steady(bot);
      rec.lookAt = { x: p.pos.x, z: p.pos.z };
      // close to pistol range, then stand and shoot
      if (d > 12) steer(bot, p.pos.x, p.pos.z); else steer(bot, bot.pos.x, bot.pos.z);
      guardShoot(rec, bot, dt);
      return true;
    }
    const DM = D();
    rec.cdT = Math.max(0, rec.cdT - dt);
    // a drawn gun inside his building: he steps up (the security ladder)
    if (!rec.case && DM && V && V.inside(p) && gunOut() && d < 14 && rec.cdT <= 0) {
      try { rec.case = DM.begin(bot, p, "security", { armed: true }); } catch (e) { rec.case = null; }
    }
    if (!rec.case || !DM) return false;
    _s.dist = d; _s.speed = +p.speed || 0; _s.armed = gunOut(); _s.aiming = aimedAt(bot, 30);
    _s.attacking = ((p._fighting || 0) > 0 && d < 2.6); _s.paid = false;
    _s.inside = V ? (V.inside(p) && gunOut()) : undefined; _s.fled = false;
    let r = null;
    try { r = DM.step(bot, dt, _s); } catch (e) { r = null; }
    if (!r) { rec.case = null; rec.lookAt = null; sendHome(bot); return false; }
    steady(bot);
    rec.lookAt = { x: p.pos.x, z: p.pos.z };
    const act = r.act;
    if (act === "shoot" || act === "aim") { rec.case = null; if (V) V.alarm("guard"); return true; }
    // SHOW is the gun coming out of the leather; below it, it stays there
    holster(bot, !(act === "draw" || r.step === "show" || r.step === "standoff"));
    if (act === "shove" || act === "beat") {
      if (d < 1.7 && CBZ.verbs && CBZ.verbs.strike) { try { CBZ.verbs.strike(bot, p, { kind: "shove" }); } catch (e) {} }
      else steer(bot, p.pos.x, p.pos.z);
    } else if (act === "approach" || act === "close") steer(bot, p.pos.x, p.pos.z);
    else steer(bot, bot.pos.x, bot.pos.z);
    if (r.step === "done") { rec.case = null; rec.cdT = 6; rec.lookAt = null; holster(bot, true); sendHome(bot); return false; }
    return true;
  }

  // HANDS UP: any posted, unarmed island worker with a gun on him
  function handsUpTick(bot, dt) {
    const p = P();
    if (aimedAt(bot, 11)) {
      if (!(bot._upT > 0)) {
        let line = null;
        if (CBZ.voice && CBZ.voice.line) { try { line = CBZ.voice.line(bot, "comply", {}); } catch (e) { line = null; } }
        say(bot, line || "Okay! Okay!");
        const rec = bot._moneyRec;
        if (rec && rec.venue) rec.venue.alarm("holdup", rec);
      }
      bot._upT = 2.5;
    }
    if (!(bot._upT > 0)) return false;
    bot._upT -= dt;
    if (bot.char) bot.char.handsUp = true;
    bot.surrender = true;
    steady(bot);
    // he goes where the gun walks him: a step ahead of you, never away
    const dx = bot.pos.x - p.pos.x, dz = bot.pos.z - p.pos.z, d = Math.hypot(dx, dz);
    if (d > 2.4 && d < 9 && sameFloor(bot, p.pos.y)) steer(bot, p.pos.x + (dx / d) * 1.6, p.pos.z + (dz / d) * 1.6);
    else steer(bot, bot.pos.x, bot.pos.z);
    if (bot._upT <= 0) { if (bot.char) bot.char.handsUp = false; bot.surrender = false; sendHome(bot); }
    return true;
  }

  CBZ.onUpdate(23.2, function (dt) {
    if (!isles()) return;
    dt = Math.min(0.1, dt || 0);
    const p = P();
    if (!p) return;
    // the bank's and the shark's people: who they are, and the guards' work
    for (let i = 0; i < POSTS.length; i++) {
      const rec = POSTS[i];
      const bot = body(rec);
      if (!bot) {
        // SHOT STAYS VACANT (island_venue.js keeps him dead): the room knows
        if (rec.ps && rec.ps.lost && !rec.lostSeen) { rec.lostSeen = true; if (rec.venue) rec.venue.alarm("killed", rec); }
        continue;
      }
      if (rec.setFor !== bot) {
        rec.setFor = bot;
        bot._moneyRec = rec;
        if (rec.name) bot.name = rec.name;
        if (rec.armed) { bot.armed = true; bot.weapon = "Pistol"; bot._holstered = false; holster(bot, true); }
        if (rec.hp) { bot.hp = rec.hp; bot.maxHp = rec.hp; }
        if (rec.venue) bot._venueStaff = rec.venue.kind;
      }
      if (rec.armed) guardTick(rec, bot, dt);
    }
    // every posted worker on the island, the shops' clerks too
    const L = CBZ.bots || [];
    for (let i = 0; i < L.length; i++) {
      const bot = L[i];
      if (!bot || bot.dead || !bot.post || bot.armed) continue;
      handsUpTick(bot, dt);
    }
  });

  CBZ.islandStaff = { post: post, posts: function () { return POSTS.slice(); }, unseen: unseen };

  /* ---- A VENUE: whose staff these are, where its floor is, its alarm ------ */
  function venue(kind, b, F) {
    const V = {
      kind: kind, b: b, bounds: F.bounds, y: F.y, staff: [], alarmed: 0,
      inside: function (p) {
        const B = V.bounds;
        return !!p && p.pos.x >= B.x0 - 0.3 && p.pos.x <= B.x1 + 0.3 && p.pos.z >= B.z0 - 0.3 && p.pos.z <= B.z1 + 0.3 && Math.abs((p.pos.y || 0) - V.y) < 2.6;
      },
      // a robbery in progress: every armed man here takes it up, the street hears
      alarm: function (why, who) {
        const t = CBZ.now || 0;
        for (const r of V.staff) { const bb = body(r); if (r.armed && bb) { r.hostile = true; r.case = null; if (D()) { try { D().cancel(bb); } catch (e) {} } } }
        if (t - V.alarmed < 8) return;
        V.alarmed = t;
        const c = F.toWorld(0, 0);
        if (CBZ.cityPanicRaise) { try { CBZ.cityPanicRaise(c.x, c.z, 1.2); } catch (e) {} }
        if (CBZ.cityCrime) { try { CBZ.cityCrime(why === "killed" ? 220 : 170, { instant: true, x: c.x, z: c.z, type: "armed-robbery" }); } catch (e) {} }
      },
    };
    VENUES.push(V);
    return V;
  }
  function dropVenue(V) {
    for (const r of V.staff) { const i = POSTS.indexOf(r); if (i >= 0) POSTS.splice(i, 1); if (r.case && r.ps && r.ps.body() && D()) { try { D().cancel(r.ps.body()); } catch (e) {} } }
    V.staff.length = 0;
    const i = VENUES.indexOf(V);
    if (i >= 0) VENUES.splice(i, 1);
  }
  // a clerk is one of ours (a record with .ps) or anybody's island_venue post
  function clerkBody(c) { return !c ? null : c.ps ? c.ps.body() : c.body ? c.body() : null; }
  function present(c) { return !!clerkBody(c); }
  function cowed(c) { const b = clerkBody(c); return !b || (b._upT > 0); }

  /* ======================================================================
     TILLS — a register on a counter, a real balance (CBZ.cityTill.declare)
     ====================================================================== */
  const TILLS = CBZ.islandTills = CBZ.islandTills || [];
  function tillBalance(t) {
    const now = pace();
    if (t._t == null) t._t = now;
    const dt = Math.max(0, now - t._t);
    // a register fills over a trading day
    if (dt > 0) { t._bal = Math.min(t.of, t._bal + t.of * dt); t._t = now; }
    return Math.floor(t._bal);
  }
  function makeTill(b, F, lx, ly, lz, of, name, clerk, draw) {
    if (draw !== false) {
      const lb = CBZ.islandVenue.lotFor(b).building.lbox;
      // the machine: a body, a keypad slope, a cash drawer
      lb(lx, ly + 0.11, lz, 0.38, 0.22, 0.34, 0x2a2d31);
      lb(lx, ly + 0.27, lz - 0.04, 0.3, 0.1, 0.18, 0x3a3f46);
      lb(lx, ly + 0.05, lz - 0.18, 0.32, 0.08, 0.04, 0x55595f);
    }
    const w = F.toWorld(lx, lz);
    const t = { x: w.x, z: w.z, y: b.gy + ly, of: Math.max(40, Math.round(of)), _bal: Math.round(of), _t: null, name: name || "register", clerk: clerk || null, b: b };
    if (CBZ.cityTill && CBZ.cityTill.declare) {
      CBZ.cityTill.declare(t, { name: t.name, kind: "register", point: "register",
        amount: function () { return tillBalance(t); },
        drain: function (n) { tillBalance(t); t._bal = Math.max(0, t._bal - n); } });
    }
    TILLS.push(t);
    (b._tills || (b._tills = [])).push(t);
    return t;
  }
  function tillHolds(t) { return CBZ.cityTill && CBZ.cityTill.holds ? (CBZ.cityTill.holds(t, {}).amount || 0) : tillBalance(t); }
  function robTill(t) {
    const r = CBZ.cityTill && CBZ.cityTill.take ? CBZ.cityTill.take(t, { by: "player", rob: true }) : { taken: 0 };
    if (!(r.taken > 0)) return;
    if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(r.taken);
    if (CBZ.sfx) CBZ.sfx("coin");
    // witnessed or not, that is the world's call (cityCrime without instant)
    if (CBZ.cityCrime) { try { CBZ.cityCrime(present(t.clerk) ? 120 : 45, { x: t.x, z: t.z, type: present(t.clerk) ? "armed-robbery" : "theft" }); } catch (e) {} }
    if (t.clerk && t.clerk.venue) t.clerk.venue.alarm("till", t.clerk);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }

  /* ======================================================================
     SAFES — city/bank.js citySafe in every building with a use
     ====================================================================== */
  // what each kind of place keeps, and where: [grade, $ lo, $ hi, floor, name]
  const SAFE_OF = {
    house: ["box", 300, 1500, "top", "cash box"],
    villa: ["wall", 6000, 25000, "top", "wall safe"],
    apartments: ["floor", 1500, 5000, 0, "safe"],
    office: ["office", 4000, 15000, "mid", "office safe"],
    hotel: ["office", 6000, 15000, 0, "office safe"],
    motel: ["floor", 1500, 4000, 0, "safe"],
    police: ["office", 8000, 30000, 0, "evidence safe"],
    cityhall: ["office", 10000, 40000, 0, "office safe"],
    guns: ["floor", 3000, 9000, 0, "safe"],
    pawn: ["office", 6000, 18000, 0, "safe"],
    jewelry: ["office", 8000, 25000, 0, "safe"],
    cardealer: ["office", 8000, 20000, 0, "office safe"],
    usedcars: ["floor", 3000, 9000, 0, "safe"],
    recruit: ["wall", 300, 1200, 0, "wall safe"],
    fuel: ["floor", 1000, 3500, 0, "drop safe"],
    market: ["floor", 1500, 4500, 0, "drop safe"],
    warehouse: ["floor", 1000, 5000, 0, "safe"],
    works: ["floor", 1000, 5000, 0, "safe"],
    church: ["box", 100, 600, 0, "poor box"],
    mosque: ["box", 100, 600, 0, "donation box"],
    school: ["wall", 200, 900, 0, "wall safe"],
    civic: ["wall", 500, 2000, 0, "wall safe"],
  };
  const SAFE_DEFAULT = ["floor", 800, 3500, 0, "drop safe"];
  const GRADE_DIM = { box: [0.36, 0.16, 0.28], wall: [0.48, 0.48, 0.34], floor: [0.62, 0.8, 0.62], office: [0.84, 1.3, 0.74], strong: [1.3, 1.95, 1.0] };
  function storeyOf(b, which) {
    const n = Math.max(1, b.storeys | 0);
    if (which === "top") return n - 1;
    if (which === "mid") return Math.min(n - 1, 2);
    return Math.max(0, Math.min(n - 1, which | 0));
  }
  // the safe goes against the +x wall (the stairs run up -x), at the back first
  function safeSpot(b, F, k, grade, zMin) {
    const dim = GRADE_DIM[grade] || GRADE_DIM.floor;
    const w = dim[0], d = dim[2];
    const L = F.local;
    const tries = [];
    for (const zf of [0.85, 0.55, 0.3]) { const z = L.z0 + (L.z1 - L.z0) * zf; if (zMin == null || z >= zMin) tries.push({ side: "x1", z: z }); }
    for (const xf of [0.75, 0.5]) tries.push({ side: "z1", x: L.x0 + (L.x1 - L.x0) * xf });
    for (const t of tries) {
      let r, lx, lz, yaw;
      if (t.side === "x1") {
        lx = L.x1 - d / 2 - 0.04; lz = Math.min(L.z1 - w / 2 - 0.3, t.z);
        yaw = -Math.PI / 2;                        // its door faces -x, into the room
        r = { x0: lx - d / 2 - 0.6, x1: lx + d / 2, z0: lz - w / 2 - 0.1, z1: lz + w / 2 + 0.1 };
      } else {
        lz = L.z1 - d / 2 - 0.04; lx = t.x;
        yaw = Math.PI;                             // its door faces -z
        r = { x0: lx - w / 2 - 0.1, x1: lx + w / 2 + 0.1, z0: lz - d / 2 - 0.6, z1: lz + d / 2 };
      }
      if (free(b, F, k, r)) return { lx: lx, lz: lz, yaw: yaw, r: r };
    }
    return null;
  }
  function placeSafe(b, o) {
    const IV = CBZ.islandVenue;
    if (!CBZ.citySafe || !IV || !b || !b.group) return null;
    const grade = o.grade || "floor";
    const k = o.k != null ? o.k : 0;
    const F = IV.floor(b, k);
    let spot = null;
    if (o.lx != null && o.lz != null) spot = { lx: o.lx, lz: o.lz, yaw: o.yaw != null ? o.yaw : -Math.PI / 2, r: null };
    else spot = safeSpot(b, F, k, grade, o.zMin);
    if (!spot) return null;
    const ly = o.ly != null ? o.ly : (F.yLocal + (grade === "wall" ? 1.05 : 0));
    const sf = CBZ.citySafe({
      parent: b.group, lx: spot.lx, ly: ly, lz: spot.lz, yaw: spot.yaw,
      toWorld: F.toWorld, gy: b.gy, floorY: F.y, grade: grade, of: o.of || 2000, refillDays: o.refillDays || (grade === "box" ? 4 : 3),
      name: o.name || "safe", venue: o.venue || b.use || null,
    });
    if (!sf) return null;
    if (spot.r) claim(b, k, spot.r);
    (b._safes || (b._safes = [])).push(sf);
    b._safeDone = true;
    return sf;
  }
  // an ordinary trade with nobody fitting it out: a counter and its register
  function placeTillCounter(b) {
    const IV = CBZ.islandVenue;
    const F = IV.floor(b, 0), L = F.local, fy = F.yLocal;
    const lb = IV.lotFor(b).building.lbox;
    for (const zo of [3.0, 3.8, 4.6]) {
      const cw = 0.6, cl = 1.8;
      const lx = L.x1 - cw / 2 - 0.5, lz = L.z0 + zo;
      const r = { x0: lx - cw / 2 - 0.9, x1: L.x1 - 0.05, z0: lz - cl / 2, z1: lz + cl / 2 };
      if (!free(b, F, 0, r)) continue;
      lb(lx, fy + 0.5, lz, cw, 1.0, cl, 0x6b5440, { solid: true });
      lb(lx, fy + 1.02, lz, cw + 0.06, 0.04, cl + 0.06, 0x3d3229);
      claim(b, 0, r);
      return makeTill(b, F, lx - 0.05, fy + 1.04, lz - 0.35, 120 + h01(b, "till") * 480, (b.name || "shop") + " register", null);
    }
    return null;
  }
  const TRADE_USES = { bakery: 1, chemist: 1, hardware: 1, cafe: 1, grocer: 1, barber: 1, books: 1, diner: 1, deli: 1,
    florist: 1, butcher: 1, icecream: 1, laundry: 1, newsagent: 1, surfshop: 1, diveshop: 1, shop: 1, chandlery: 1 };

  /* ======================================================================
     THE BANK — the banking hall, the strongroom, the staff
     ====================================================================== */
  const BANK_NAMES = ["Island Savings", "Harbour Trust", "Coral Bank"];
  function vaultTill(of, days) {
    const t = { of: Math.round(of), _bal: Math.round(of), _t: null };
    const bal = function () {
      const now = pace();
      if (t._t == null) t._t = now;
      const dt = Math.max(0, now - t._t);
      if (dt > 0) { t._bal = Math.min(t.of, t._bal + t.of * dt / days); t._t = now; }
      return Math.floor(t._bal);
    };
    if (CBZ.cityTill && CBZ.cityTill.declare) {
      CBZ.cityTill.declare(t, { name: "vault", kind: "bank", point: "vault", amount: bal,
        drain: function (n) { bal(); t._bal = Math.max(0, t._bal - n); } });
    }
    return t;
  }
  // a window is open while its teller is behind it, not with his hands up,
  // and nobody is waving a gun at the bank
  function open(rec) {
    return function () { const bb = body(rec); return !!bb && !(bb._upT > 0) && !gunOut() && !(rec.venue && rec.venue.alarmed && (CBZ.now || 0) - rec.venue.alarmed < 60); };
  }
  function fitBank(b, lot) {
    const IV = CBZ.islandVenue;
    IV.clear(b, 0);
    const F = IV.floor(b, 0), L = F.local, fy = F.yLocal;
    const lb = lot.building.lbox;
    const hq = (b.storeys | 0) >= 8;
    const name = b.name || BANK_NAMES[(h01(b, "bankname") * BANK_NAMES.length) | 0];
    const V = venue("bank", b, F);
    const made = { vault: null, safes: [], drawers: [] };

    // ---- THE STRONGROOM at the back, pushed to the +x side (the stairs are -x)
    const money = hq ? 12e6 + h01(b, "vault$") * 18e6 : 4e5 + h01(b, "vault$") * 8e5;
    const till = vaultTill(money, hq ? 30 : 7);
    const shim = { cx: b.ox, cz: b.oz, x: b.x, z: b.z, kind: "bank",
      building: { lbox: lb, w: lot.building.w, d: lot.building.d, wt: lot.building.wt, floorTops: lot.building.floorTops,
        ox: 0, oz: 0, door: { x: 0, z: -lot.building.d / 2, nx: 0, nz: 1 }, frame: { toWorld: F.toWorld },
        gy: b.gy, group: b.group, name: name } };
    let v = null;
    if (CBZ.cityVaultRoom) {
      try { v = CBZ.cityVaultRoom(shim, { tier: hq ? "reserve" : "count", kind: "bank", name: name, lat: -99, till: { src: till, point: "vault" } }); }
      catch (e) { v = null; console.error("[island bank vault]", e); }
    }
    made.vault = v;
    let zPart, doorX, doorW;
    if (v) { zPart = v.plz; doorX = v.plx; doorW = v.dw; claim(b, 0, { x0: v.plx - v.rw / 2 - 0.3, x1: v.plx + v.rw / 2 + 0.3, z0: v.plz - 0.3, z1: L.z1 }); }
    else {
      // a floorplate too small for a room still has the bank's strongbox
      const sf = placeSafe(b, { grade: "strong", of: Math.round(money * 0.25), name: name + " strongbox", venue: V.kind });
      if (sf) made.safes.push(sf);
      zPart = L.z1 - 1.6; doorX = L.x1 - 1.2; doorW = 1.4;
    }

    // ---- THE TELLER LINE: across the hall 1.9 m in front of the strongroom with
    // a staff gap at its door, or (a tower, whose lift stands mid-lobby) along
    // the back beside the strongroom, past the lift's apron
    const runsAt = function (zc) {
      let runs = [[L.x0 + 0.25, L.x1 - 0.25]];
      const cut = function (a, z) { const out = []; for (const r of runs) { if (z <= r[0] || a >= r[1]) { out.push(r); continue; } if (a > r[0]) out.push([r[0], a]); if (z < r[1]) out.push([z, r[1]]); } runs = out; };
      for (const q of F.keepOut) if (q.z0 < zc + 0.5 && q.z1 > zc - 0.5) cut(q.x0 - 0.1, q.x1 + 0.1);
      for (const q of (b._moneyRects || [])) if (q.k === 0 && q.z0 < zc + 0.5 && q.z1 > zc - 0.5) cut(q.x0, q.x1);
      if (zc < zPart) cut(doorX - doorW / 2 - 0.45, doorX + doorW / 2 + 0.45);
      return runs.filter(function (r) { return r[1] - r[0] >= 1.3; });
    };
    const cands = [Math.max(L.z0 + 3.4, zPart - 1.9)];
    for (const q of F.keepOut) if (q.why === "lift" && q.z1 + 0.7 < L.z1 - 1.3) cands.push(q.z1 + 0.7);
    let zc = cands[0], runs = [], best = -1;
    for (const c of cands) {
      if (c + 0.75 > L.z1 - 0.3 || (c < zPart && c > zPart - 0.9)) continue;
      const rs = runsAt(c);
      let tot = 0; for (const r of rs) tot += r[1] - r[0];
      if (tot > best) { best = tot; zc = c; runs = rs; }
    }
    {
      let n = 0;
      for (const r of runs) {
        const len = r[1] - r[0];
        if (len < 1.3) continue;
        const cx = (r[0] + r[1]) / 2;
        lb(cx, fy + 0.55, zc, len, 1.1, 0.7, 0x5a4634, { solid: true });
        lb(cx, fy + 1.13, zc, len + 0.06, 0.06, 0.78, 0xb8963e);
        // glass to head height: the public side and the money side
        pane(b, F, cx, fy + 1.75, zc + 0.12, len - 0.06, 1.1, 0.04, true);
        claim(b, 0, { x0: r[0], x1: r[1], z0: zc - 0.4, z1: zc + 0.4 });
        const windows = Math.max(1, Math.min(hq ? 3 : 2, Math.floor(len / 1.6)));
        for (let i = 0; i < windows && n < (hq ? 4 : 3); i++, n++) {
          const wx = r[0] + len * (i + 0.5) / windows;
          lb(wx, fy + 1.3, zc + 0.18, 0.36, 0.26, 0.05, 0x1b2a3c);       // the teller's screen
          lb(wx, fy + 1.17, zc + 0.05, 0.3, 0.02, 0.22, 0x23262b);        // the keyboard
          const tp = F.toWorld(wx, zc + 0.75), sp = F.toWorld(wx, zc - 0.75);
          const rec = post(b, wx, zc + 0.75, Math.PI, { venue: V, job: "bank teller" });
          let dr = null;
          if (CBZ.cityBankDrawerDeclare) {
            dr = CBZ.cityBankDrawerDeclare(null, n, tp.x, tp.z, hq ? 8000 + h01(b, "drw" + n) * 12000 : 2500 + h01(b, "drw" + n) * 6500);
            if (dr) { dr.y = F.y; dr.teller = rec; dr.venue = V; dr.x = sp.x; dr.z = sp.z; DRAWERS.push(dr); made.drawers.push(dr); }
          }
          CBZ.bankStations.push({ kind: "teller", x: sp.x, y: F.y, z: sp.z, reach: 2.4, name: name, teller: rec, ok: open(rec) });
        }
      }
    }

    // ---- THE MANAGER'S OFFICE: glass walls in the front +x corner, the loan desk
    const ox0 = Math.max(1.7, L.x1 - 3.4), ox1 = L.x1, oz0 = L.z0 + 2.6, oz1 = Math.min(oz0 + 3.2, zc - 1.0);
    let manager = null;
    if (ox1 - ox0 >= 2.2 && oz1 - oz0 >= 2.2 && free(b, F, 0, { x0: ox0, x1: ox1, z0: oz0, z1: oz1 })) {
      const wallH = 2.5, midZ = (oz0 + oz1) / 2;
      // the front glass (toward the street) and the back glass, low solid band under both
      for (const z of [oz0, oz1]) {
        lb((ox0 + ox1) / 2, fy + 0.45, z, ox1 - ox0, 0.9, 0.1, 0xd9d4c7, { solid: true, los: false });
        pane(b, F, (ox0 + ox1) / 2, fy + 0.9 + (wallH - 0.9) / 2, z, ox1 - ox0, wallH - 0.9, 0.04, true);
      }
      // the side glass with the office door in it (the gap at its front end)
      const dz0 = oz0 + 1.1, sideLen = oz1 - dz0;
      lb(ox0, fy + 0.45, dz0 + sideLen / 2, 0.1, 0.9, sideLen, 0xd9d4c7, { solid: true });
      pane(b, F, ox0, fy + 0.9 + (wallH - 0.9) / 2, dz0 + sideLen / 2, 0.04, wallH - 0.9, sideLen, true);
      lb(ox0, fy + wallH + 0.05, (oz0 + oz1) / 2, 0.12, 0.1, oz1 - oz0, 0xd9d4c7);
      // the desk across the office, the manager behind it facing the door
      const dx = ox1 - 1.1;
      lb(dx, fy + 0.38, midZ, 0.8, 0.76, 1.6, 0x4a3426, { solid: true });
      lb(dx + 0.12, fy + 0.95, midZ, 0.05, 0.32, 0.5, 0x1b2a3c);
      lb(dx - 0.9, fy + 0.25, midZ + 0.4, 0.5, 0.5, 0.5, 0x2f3640);        // the chair you sit in
      lb(dx - 0.9, fy + 0.25, midZ - 0.4, 0.5, 0.5, 0.5, 0x2f3640);
      claim(b, 0, { x0: ox0, x1: ox1, z0: oz0, z1: oz1 });
      manager = post(b, ox1 - 0.4, midZ, -Math.PI / 2, { venue: V, job: "bank manager" });
      const lp = F.toWorld(dx - 1.25, midZ);
      CBZ.bankStations.push({ kind: "loan", x: lp.x, y: F.y, z: lp.z, reach: 2.6, name: name, manager: manager, ok: open(manager) });
    } else {
      // no room for an office: the loan desk stands in the hall
      const dx = L.x1 - 1.2, dz = L.z0 + 3.2;
      if (free(b, F, 0, { x0: dx - 0.5, x1: dx + 0.5, z0: dz - 0.9, z1: dz + 0.9 })) {
        lb(dx, fy + 0.38, dz, 0.8, 0.76, 1.5, 0x4a3426, { solid: true });
        claim(b, 0, { x0: dx - 0.5, x1: dx + 0.5, z0: dz - 0.9, z1: dz + 0.9 });
        manager = post(b, dx + 0.55, dz, -Math.PI / 2, { venue: V, job: "bank manager" });
        const lp = F.toWorld(dx - 0.95, dz);
        CBZ.bankStations.push({ kind: "loan", x: lp.x, y: F.y, z: lp.z, reach: 2.6, name: name, manager: manager, ok: open(manager) });
      }
    }

    // ---- THE ATM on the street wall, right of the door, with its own cassette
    const ldh = lot.building.d / 2;
    const ax = Math.min(L.x1 - 0.5, 2.0);
    lb(ax, fy + 0.8, -ldh - 0.24, 0.72, 1.6, 0.44, 0x2b3644, { solid: true, outside: true });
    lb(ax, fy + 1.18, -ldh - 0.47, 0.5, 0.48, 0.04, 0x3a4658, { outside: true });
    lb(ax, fy + 1.24, -ldh - 0.5, 0.32, 0.24, 0.02, 0x1d3a5c, { outside: true });
    lb(ax, fy + 0.95, -ldh - 0.5, 0.26, 0.03, 0.02, 0x0c0d0f, { outside: true });     // the slot
    const cas = { _of: hq ? 120000 : 40000, _bal: 0, _day: -1 };
    cas._bal = cas._of;
    if (CBZ.cityTill && CBZ.cityTill.declare) {
      CBZ.cityTill.declare(cas, { name: name + " ATM", kind: "atm", point: "vault",
        amount: function () { const d = (CBZ.paceDay ? CBZ.paceDay() : 0) | 0; if (cas._day !== d) { cas._day = d; cas._bal = cas._of; } return cas._bal; },
        drain: function (n) { cas._bal = Math.max(0, cas._bal - n); } });
    }
    const ap = F.toWorld(ax, -ldh - 1.0);
    CBZ.bankStations.push({ kind: "atm", x: ap.x, y: b.gy + fy, z: ap.z, reach: 2.2, name: name, box: cas });

    // ---- THE GUARDS: one at the strongroom door (two at the HQ), one on the hall at the HQ
    let guards = 0;
    for (const gz of [zPart - 0.95, zPart - 1.5]) for (const s of [-1, 1]) {
      if (guards >= (hq ? 2 : 1)) break;
      const gx = Math.max(L.x0 + 0.5, Math.min(L.x1 - 0.5, doorX + s * (doorW / 2 + 0.7)));
      const r = { x0: gx - 0.3, x1: gx + 0.3, z0: gz - 0.3, z1: gz + 0.3 };
      if (!free(b, F, 0, r)) continue;
      claim(b, 0, r);
      post(b, gx, gz, Math.PI, { venue: V, job: "vault guard", armed: true, hp: 150 });
      guards++;
    }
    if (hq) {
      const hx = Math.max(L.x0 + 0.6, Math.min(L.x1 - 0.6, -2.4));
      if (free(b, F, 0, { x0: hx - 0.3, x1: hx + 0.3, z0: L.z0 + 2.6, z1: L.z0 + 3.2 })) {
        post(b, hx, L.z0 + 2.9, 0, { venue: V, job: "security guard", armed: true, hp: 150 });
      }
    }
    // a strongroom blown or opened: the building's alarm
    if (v) v._venue = V;
    b._safeDone = true;
    return function () {
      dropVenue(V);
      if (made.vault && CBZ.cityVaultDrop) CBZ.cityVaultDrop(made.vault);
      for (const sf of made.safes) if (CBZ.citySafeDrop) CBZ.citySafeDrop(sf);
      for (const dr of made.drawers) { const i = DRAWERS.indexOf(dr); if (i >= 0) DRAWERS.splice(i, 1); }
    };
  }
  // the island branches' drawers (the city's are city/bank.js's own list)
  const DRAWERS = [];
  function drawerHolds(dr) { return CBZ.cityTill && CBZ.cityTill.holds ? (CBZ.cityTill.holds(dr, {}).amount || 0) : 0; }

  /* ======================================================================
     THE LOAN SHARK — CBZ.loanShark
     ====================================================================== */
  const SHARK_NAMES = ["Sal", "Vinnie", "Benny", "Ray", "Lou", "Dino", "Frankie", "Marco"];
  const VIG_WEEK = 0.20;            // twenty a week, compounding
  const TERM_DAYS = 3;              // three days to pay (pace days)
  const REVISIT_DAYS = 0.7;         // a missed visit: they come back sooner than you'd like
  const SHARKS = {};                // key -> { name, dead, rec }
  function loans() { return (g.sharkLoans = g.sharkLoans || []); }
  function sharkKey(b) { return Math.round(b.ox) + "," + Math.round(b.oz); }
  function loanOf(key) { const L = loans(); for (const l of L) if (l.key === key && l.owed > 1) return l; return null; }
  function owedNow(l) { return Math.ceil(l.owed); }
  function creditCap() { return Math.min(25000, 2000 + Math.round((g.sharkRepaid || 0) * 0.5)); }
  function overdue(l) { return l.owed > 1 && pace() > l.due; }
  function sharkTick(dtPace) {
    const L = loans();
    for (let i = L.length - 1; i >= 0; i--) {
      const l = L[i];
      const S = SHARKS[l.key];
      // the man you owe is dead: so is the debt
      if (S && S.dead) { L.splice(i, 1); continue; }
      if (l.owed <= 1) { L.splice(i, 1); continue; }
      if (dtPace > 0) l.owed *= Math.pow(1 + VIG_WEEK, dtPace / 7);
    }
  }
  function borrow(key, name, amt, shark) {
    if (loanOf(key)) return false;
    amt = Math.max(100, Math.round(amt));
    const now = pace();
    loans().push({ key: key, shark: name, principal: amt, owed: amt, t0: now, due: now + TERM_DAYS, next: now + TERM_DAYS, stage: 0, visits: 0 });
    if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(amt); else g.cash = (g.cash | 0) + amt;
    if (CBZ.sfx) CBZ.sfx("coin");
    say(shark, "Twenty a week. Three days.");
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  }
  function payLoan(l, amt, who) {
    if (!l) return 0;
    amt = Math.min(Math.max(0, Math.floor(amt)), g.cash | 0, owedNow(l));
    if (amt <= 0) return 0;
    if (CBZ.city && CBZ.city.spend) { if (!CBZ.city.spend(amt)) return 0; } else g.cash = (g.cash | 0) - amt;
    l.owed -= amt;
    g.sharkRepaid = (g.sharkRepaid || 0) + amt;
    if (CBZ.sfx) CBZ.sfx("coin");
    if (l.owed <= 1) {
      l.owed = 0;
      const L = loans(), i = L.indexOf(l); if (i >= 0) L.splice(i, 1);
      if (who) say(who, l.stage > 0 ? "We're square." : "Pleasure.");
    } else {
      // part of it buys a day
      l.next = Math.max(l.next, pace() + REVISIT_DAYS);
      if (who) say(who, "That's a start.");
    }
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return amt;
  }
  CBZ.loanShark = {
    loans: function () { return loans().map(function (l) { return { shark: l.shark, owed: owedNow(l), principal: l.principal, due: l.due, overdue: overdue(l), stage: l.stage }; }); },
    owed: function () { let s = 0; for (const l of loans()) s += owedNow(l); return s; },
    inDefault: function () { for (const l of loans()) if (overdue(l)) return true; return false; },
    creditCap: creditCap,
    VIG_WEEK: VIG_WEEK, TERM_DAYS: TERM_DAYS,
  };

  function fitLoans(b, lot) {
    const IV = CBZ.islandVenue;
    IV.clear(b, 0);
    const F = IV.floor(b, 0), L = F.local, fy = F.yLocal;
    const lb = lot.building.lbox;
    const V = venue("loans", b, F);
    const key = sharkKey(b);
    const name = SHARK_NAMES[(h01(b, "shark") * SHARK_NAMES.length) | 0];
    const S = SHARKS[key] = SHARKS[key] && !SHARKS[key].dead ? SHARKS[key] : { name: name, dead: false };
    S.name = name;
    // where the stair strip ends (the room starts there)
    let xs = L.x0;
    for (const q of F.keepOut) if (q.why === "stairs" || q.why === "lift") xs = Math.max(xs, Math.min(q.x1, 0));
    const made = { safes: [] };

    // ---- THE COUNTER: cheques cashed behind glass to the ceiling, a pass at its +x end
    const zc = L.z0 + 3.0;
    const cx0 = Math.max(xs + 0.15, L.x0 + 0.2), cx1 = L.x1 - 1.3;
    let clerk = null;
    if (cx1 - cx0 > 1.4) {
      const cxm = (cx0 + cx1) / 2, len = cx1 - cx0;
      lb(cxm, fy + 0.55, zc, len, 1.1, 0.6, 0x6e6a60, { solid: true });
      lb(cxm, fy + 1.12, zc, len + 0.04, 0.05, 0.66, 0x9a9488);
      pane(b, F, cxm, fy + 1.15 + 0.85, zc + 0.05, len, 1.7, 0.05, true);
      lb(cxm, fy + 1.16, zc - 0.31, 0.5, 0.03, 0.12, 0x2a2d31);          // the pass tray
      claim(b, 0, { x0: cx0, x1: cx1, z0: zc - 0.35, z1: zc + 0.35 });
      clerk = post(b, cxm, zc + 0.7, Math.PI, { venue: V, job: "cashier" });
      makeTill(b, F, cxm + 0.6, fy + 1.15, zc + 0.12, 800 + h01(b, "loanstill") * 2400, "cash drawer", clerk);
    }

    // ---- THE BACK OFFICE: a wall across the shop with a doorway, his desk, his muscle
    const zp = L.z0 + (L.z1 - L.z0) * 0.55;
    const wallH = Math.min(3.0, (CBZ.islandBuilding && CBZ.islandBuilding.FH ? CBZ.islandBuilding.FH : 3.2) - 0.15);
    const dw = 1.1, dX = L.x1 - 0.9;            // the office door, at the +x end
    const wx0 = Math.max(xs + 0.05, L.x0), wx1 = dX - dw / 2;
    if (wx1 - wx0 > 0.4) lb((wx0 + wx1) / 2, fy + wallH / 2, zp, wx1 - wx0, wallH, 0.14, 0x8a8273, { solid: true, los: true });
    if (L.x1 - (dX + dw / 2) > 0.05) lb((dX + dw / 2 + L.x1) / 2, fy + wallH / 2, zp, L.x1 - (dX + dw / 2), wallH, 0.14, 0x8a8273, { solid: true, los: true });
    lb(dX, fy + 2.15 + (wallH - 2.15) / 2, zp, dw, wallH - 2.15, 0.14, 0x8a8273);
    claim(b, 0, { x0: wx0, x1: L.x1, z0: zp - 0.15, z1: zp + 0.15 });
    // the desk across the office, facing the door wall
    const ofz0 = zp + 0.15, ofz1 = L.z1;
    const deskX = Math.max(wx0 + 1.2, (Math.max(wx0, xs) + L.x1) / 2 - 0.3), deskZ = ofz0 + (ofz1 - ofz0) * 0.62;
    lb(deskX, fy + 0.38, deskZ, 1.7, 0.76, 0.8, 0x3b2a1f, { solid: true });
    lb(deskX - 0.5, fy + 0.8, deskZ, 0.28, 0.06, 0.2, 0x1e7a44);          // a stack on the desk
    lb(deskX + 0.4, fy + 0.85, deskZ + 0.1, 0.3, 0.16, 0.22, 0x23262b);   // the phone, the ledger
    lb(deskX, fy + 0.3, deskZ - 1.05, 0.5, 0.6, 0.5, 0x5b2c2a);           // the chair you sit in
    claim(b, 0, { x0: deskX - 0.9, x1: deskX + 0.9, z0: deskZ - 1.35, z1: deskZ + 0.45 });
    const shark = post(b, deskX, deskZ + 0.75, Math.PI, { venue: V, job: "loan shark", name: name });
    S.rec = shark;
    post(b, dX - 0.2, zp + 0.8, -Math.PI / 2, { venue: V, job: "muscle", armed: true, hp: 160 });
    post(b, Math.min(L.x1 - 0.5, deskX + 1.5), deskZ + 0.2, Math.PI, { venue: V, job: "muscle", armed: true, hp: 160 });
    // his strongbox, in the office corner
    const sf = placeSafe(b, { grade: "office", k: 0, of: 20000 + h01(b, "sharkbox") * 40000, name: name + "'s safe", venue: V.kind, zMin: zp + 0.6 });
    if (sf) made.safes.push(sf);
    const st = F.toWorld(deskX, deskZ - 1.0);
    SHARK_DESKS.push({ x: st.x, y: F.y, z: st.z, key: key, name: name, rec: shark, V: V });
    b._safeDone = true;
    return function () {
      dropVenue(V);
      for (const s2 of made.safes) if (CBZ.citySafeDrop) CBZ.citySafeDrop(s2);
      for (let i = SHARK_DESKS.length - 1; i >= 0; i--) if (SHARK_DESKS[i].key === key) SHARK_DESKS.splice(i, 1);
      if (S.rec === shark) S.rec = null;
    };
  }
  const SHARK_DESKS = [];
  // his death is the end of the debt (the post layer marks a shot man lost)
  function sharkWatch() {
    for (const k in SHARKS) {
      const S = SHARKS[k];
      if (S.rec && S.rec.ps && S.rec.ps.lost && !S.dead) S.dead = true;
    }
  }

  /* ---- THE COLLECTORS: the demand ladder, mood "debt" ------------------- */
  const CREW = [];          // { bot, loan, phase, t, beatT, hitT, armed, case }
  function collectorsOut(l) { for (const c of CREW) if (c.loan === l) return true; return false; }
  function pickSpawn(minD, maxD) {
    const A = CBZ.surv && CBZ.surv.arena, p = P();
    if (!A || !A.randomPoint || !p) return null;
    let best = null, bd = 1e9;
    for (let i = 0; i < 40; i++) {
      let q = null;
      try { q = A.randomPoint(0, A.radius * 0.85); } catch (e) { q = null; }
      if (!q) continue;
      const d = Math.hypot(q.x - p.pos.x, q.z - p.pos.z);
      if (d < minD || d > maxD) continue;
      const y = A.groundHeightAt ? A.groundHeightAt(q.x, q.z) : 0;
      if (y < 0.4) continue;                       // not in the sea
      if (!unseen(q.x, y, q.z)) continue;
      if (Math.abs(d - (minD + maxD) / 2) < bd) { bd = Math.abs(d - (minD + maxD) / 2); best = q; }
    }
    return best;
  }
  function sendCrew(l) {
    const p = P(); if (!p || p.dead || p.driving || !CBZ.spawnSurvivorBotAt) return false;
    const n = l.stage >= 2 ? 3 : 2;
    let sent = 0;
    for (let i = 0; i < n; i++) {
      const q = pickSpawn(28, 75);
      if (!q) break;
      let bot = null;
      try { bot = CBZ.spawnSurvivorBotAt(q.x, q.z); } catch (e) { bot = null; }
      if (!bot) break;
      bot._venueStaff = "collector"; bot.job = "collector";
      const armed = l.stage >= 2 && i === 0;
      if (armed) { bot.armed = true; bot.weapon = "Pistol"; holster(bot, true); }
      bot.hp = 140; bot.maxHp = 140;
      CREW.push({ bot: bot, loan: l, phase: "walk", t: 0, beatT: 0, hitT: 0, armed: armed, lead: i === 0, rec: { fireT: 0.6 } });
      sent++;
    }
    if (sent) { l.visits++; l.next = pace() + REVISIT_DAYS; }
    return sent > 0;
  }
  function crewLeave(c) {
    c.phase = "leave"; c.t = 0;
    if (CBZ.brain && CBZ.brain.demand) { try { CBZ.brain.demand.cancel(c.bot); } catch (e) {} }
    const p = P(), bot = c.bot;
    const dx = bot.pos.x - (p ? p.pos.x : 0), dz = bot.pos.z - (p ? p.pos.z : 0), d = Math.hypot(dx, dz) || 1;
    c.away = { x: bot.pos.x + (dx / d) * 70, z: bot.pos.z + (dz / d) * 70 };
  }
  // the most a man carries that they can sell: his best item
  function seizeItem() {
    const inv = g.cityInv, E = CBZ.cityEcon;
    if (!inv || !E || !E.ITEMS) return null;
    let best = null, bv = 0;
    for (const n in inv) {
      if ((inv[n] | 0) <= 0) continue;
      const it = E.ITEMS[n];
      const v = it ? (+it.price || +it.value || 0) : 0;
      if (v > bv) { bv = v; best = n; }
    }
    if (!best || bv < 50) return null;
    let gone = false;
    if (E.take) { try { gone = E.take(best, 1) !== false; } catch (e) { gone = false; } }
    if (!gone) inv[best] = Math.max(0, (inv[best] | 0) - 1);
    return { name: best, value: bv };
  }
  function crewTake(c) {
    const l = c.loan;
    let took = 0;
    const cash = g.cash | 0;
    if (cash > 0 && l.owed > 1) {
      took = Math.min(cash, owedNow(l));
      g.cash = cash - took; l.owed -= took;
      g.sharkRepaid = (g.sharkRepaid || 0) + took * 0.5;
    }
    let item = null;
    if (l.owed > 1 && l.stage >= 1) {
      item = seizeItem();
      if (item) l.owed -= item.value * 0.5;
    }
    if (took > 0 || item) note("They took " + (took > 0 ? fmt$(took) : "") + (took > 0 && item ? " and " : "") + (item ? "your " + item.name : "") + ".", 2.6);
    if (l.owed <= 1) { const L = loans(), i = L.indexOf(l); if (i >= 0) L.splice(i, 1); }
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }
  const _cs = { dist: 99, speed: 0, armed: false, aiming: false, attacking: false, paid: false, inside: undefined, fled: false };
  function crewTick(dt) {
    const p = P();
    for (let i = CREW.length - 1; i >= 0; i--) {
      const c = CREW[i], bot = c.bot;
      const gone = !bot || (CBZ.bots && CBZ.bots.indexOf(bot) < 0);
      if (gone) { CREW.splice(i, 1); continue; }
      if (bot.dead) {
        // you fought them off: the rest finish it, and the next crew comes harder
        CREW.splice(i, 1);
        c.loan.stage = Math.max(c.loan.stage, 2);
        for (const o of CREW) if (o.loan === c.loan && o.phase !== "leave" && !o.bot.dead) { o.phase = "beat"; o.beatT = 0; o.fight = true; }
        continue;
      }
      if (!p) continue;
      const dx = p.pos.x - bot.pos.x, dz = p.pos.z - bot.pos.z, d = Math.hypot(dx, dz);
      bot.panicT = 0; bot.pause = 1;
      c.t += dt;
      if (c.phase === "leave") {
        bot.state = "wander";
        bot.target.set(c.away.x, 0, c.away.z);
        if ((d > 45 && unseen(bot.pos.x, bot.pos.y, bot.pos.z)) || c.t > 60) { removeBot(bot); CREW.splice(i, 1); }
        continue;
      }
      const l = c.loan;
      if (p.dead) { crewLeave(c); continue; }
      if (!(l.owed > 1) || loans().indexOf(l) < 0) {
        if (c.phase !== "leave") { if (c.lead) say(bot, "We're done here."); crewLeave(c); }
        continue;
      }
      if (c.phase === "walk") {
        bot.state = "move";
        bot.target.set(p.pos.x, 0, p.pos.z);
        if (c.t > 90) { crewLeave(c); continue; }
        if (d < 4.5) {
          c.phase = "ask";
          if (c.lead && D()) {
            try {
              c.case = D().begin(bot, p, "rob", { mood: "debt", armed: c.armed, hard: l.stage >= 2, leaveR: 30, patience: [4.5, 4, 3],
                lines: { demand: ["You owe " + l.shark + ".", l.shark + " wants his money."] } });
            } catch (e) { c.case = null; }
          }
        }
        continue;
      }
      if (c.phase === "ask") {
        bot.state = "move";
        if (!c.lead) {
          // the second man squares up behind the first and waits
          bot.target.set(p.pos.x + (bot.pos.x - p.pos.x) / (d || 1) * 1.8, 0, p.pos.z + (bot.pos.z - p.pos.z) / (d || 1) * 1.8);
          bot.group.rotation.y = Math.atan2(dx, dz);
          continue;
        }
        const DM = D();
        if (!DM || !c.case) { c.phase = "beat"; c.beatT = 0; continue; }
        _cs.dist = d; _cs.speed = p.driving ? 12 : (+p.speed || 0); _cs.armed = gunOut(); _cs.aiming = aimedAt(bot, 25);
        _cs.attacking = ((p._fighting || 0) > 0 && d < 2.6); _cs.paid = !!c.paid; _cs.fled = !!p.driving && d > 12;
        let r = null;
        try { r = DM.step(bot, dt, _cs); } catch (e) { r = null; }
        if (!r) { c.phase = "beat"; c.beatT = 0; continue; }
        if (r.act === "approach" || r.act === "close" || r.act === "chase") bot.target.set(p.pos.x, 0, p.pos.z);
        else { bot.target.set(bot.pos.x, 0, bot.pos.z); bot.group.rotation.y = Math.atan2(dx, dz); }
        if (r.step === "done" || r.step === "act") {
          const out = r.outcome;
          if (out === "complied") { for (const o of CREW) if (o.loan === l) crewLeave(o); continue; }
          if (out === "acted") { for (const o of CREW) if (o.loan === l && o.phase !== "leave") { o.phase = "beat"; o.beatT = 0; } continue; }
          // he walked, he ran, they backed off: they will be back, harder
          l.stage++; l.next = pace() + REVISIT_DAYS * 0.6;
          for (const o of CREW) if (o.loan === l) crewLeave(o);
        }
        continue;
      }
      if (c.phase === "beat") {
        c.beatT += dt;
        bot.state = "move";
        if (c.armed && (l.stage >= 3 || c.fight)) {
          bot.target.set(d > 10 ? p.pos.x : bot.pos.x, 0, d > 10 ? p.pos.z : bot.pos.z);
          guardShoot(c.rec, bot, dt);
        } else if (d > 1.3) bot.target.set(p.pos.x, 0, p.pos.z);
        else {
          bot.target.set(bot.pos.x, 0, bot.pos.z);
          bot.group.rotation.y = Math.atan2(dx, dz);
          c.hitT -= dt;
          if (c.hitT <= 0) {
            c.hitT = 0.7 + Math.random() * 0.5;
            let s = null;
            const kinds = ["jab", "cross", "hook", "uppercut"];
            if (CBZ.verbs && CBZ.verbs.strike) { try { s = CBZ.verbs.strike(bot, p, { kind: kinds[(Math.random() * kinds.length) | 0], heavy: Math.random() < 0.4 }); } catch (e) { s = null; } }
            if (!s && CBZ.surv && CBZ.surv.hurt && CBZ.surv.playerActor) { try { CBZ.surv.hurt(CBZ.surv.playerActor, 9, { fromX: bot.pos.x, fromZ: bot.pos.z, cause: "beaten" }); } catch (e) {} }
          }
        }
        const done = c.fight ? c.beatT > 14 : c.beatT > 5.5;
        if (done) {
          if (c.lead) { crewTake(c); say(bot, "Same time next week."); }
          l.stage++;
          l.next = pace() + REVISIT_DAYS;
          crewLeave(c);
        }
      }
    }
  }
  let _lastPace = null;
  CBZ.onUpdate(41.7, function (dt) {
    if (!econOn() || g.state !== "playing") return;
    const now = pace();
    const dp = _lastPace == null ? 0 : Math.max(0, Math.min(1, now - _lastPace));
    _lastPace = now;
    sharkWatch();
    sharkTick(dp);
    if (!isles()) return;
    crewTick(Math.min(0.1, dt || 0));
    // a loan past its day, and nobody has come yet: they come
    const p = P();
    if (!p || p.dead) return;
    for (const l of loans()) {
      if (!overdue(l) || collectorsOut(l) || now < l.next) continue;
      if (!sendCrew(l)) l.next = now + 0.1;
      break;
    }
  });

  /* ======================================================================
     THE FIT-OUTS, registered with world/island_venue.js
     ====================================================================== */
  function wireFits() {
    const IV = CBZ.islandVenue;
    if (!IV || !IV.on || wireFits.done) return !!wireFits.done;
    wireFits.done = true;
    IV.on("bank", function (b, lot) { return fitBank(b, lot); });
    IV.on("loans", function (b, lot) { return fitLoans(b, lot); });
    // the vault every other place keeps, after its own fit-out
    IV.on("*", function (b) {
      const out = [];
      if (!b._safeDone && b.group && b.interior) {
        const spec = SAFE_OF[b.use] || SAFE_DEFAULT;
        const k = storeyOf(b, spec[3]);
        const of = spec[1] + h01(b, "safe$") * (spec[2] - spec[1]);
        const sf = placeSafe(b, { grade: spec[0], k: k, of: of, name: spec[4] });
        if (!sf && k !== 0) placeSafe(b, { grade: spec[0], k: 0, of: of, name: spec[4] });
      }
      if (!(b._tills && b._tills.length) && TRADE_USES[b.use] && !IV.has(b.use) && b.interior) placeTillCounter(b);
      return function () {
        for (const sf of (b._safes || [])) if (CBZ.citySafeDrop) CBZ.citySafeDrop(sf);
        b._safes = null; b._safeDone = false; b._tills = null; b._moneyRects = null;
        for (let i = TILLS.length - 1; i >= 0; i--) if (TILLS[i].b === b) TILLS.splice(i, 1);
        void out;
      };
    });
    // the hooks other venues call to put theirs exactly where they want them
    IV.safe = function (b, o) { return placeSafe(b, o || {}); };
    IV.till = function (b, o) {
      o = o || {};
      const F = IV.floor(b, o.k | 0);
      // a shop's register holds what it takes in a day: a few hundred dollars
      const of = o.of || (150 + h01(b, "till$") * 550);
      return makeTill(b, F, o.lx || 0, o.ly != null ? o.ly : F.yLocal + 1.05, o.lz || 0, of, o.name || (b.name ? b.name + " register" : "register"), o.clerk || null, o.draw);
    };
    return true;
  }
  if (!wireFits()) CBZ.onUpdate(0.5, function () { wireFits(); });

  /* ======================================================================
     THE VERBS (city/interactions.js fixtures, islands only): decisions
     ====================================================================== */
  const _out = [];
  function nearList(arr, ctx, px, pz, r) {
    if (g.mode === "city" || !arr.length) return null;
    const py = ctx && ctx.pos ? ctx.pos.y : (P() ? P().pos.y : 0);
    _out.length = 0;
    for (let i = 0; i < arr.length; i++) {
      const f = arr[i];
      if (f.y != null && Math.abs(f.y - py) > 2.2) continue;
      if (Math.abs(f.x - px) > r || Math.abs(f.z - pz) > r) continue;
      _out.push(f);
    }
    return _out.length ? _out.slice() : null;
  }
  let verbsWired = false;
  function wireVerbs() {
    const I = CBZ.interactions;
    if (verbsWired || !I || !I.registerFixtures) return;
    verbsWired = true;
    // ---- the loan shark's desk
    I.registerFixtures({
      id: "loan-shark", kind: "loan-shark", prio: 9, islands: true,
      list: function (ctx, px, pz) { return nearList(SHARK_DESKS, ctx, px, pz, 4); },
      reach: function () { return 2.6; }, dot: function () { return 0.4; },
      name: function (d) { return d.name; },
      verbs: [
        { id: "shark-borrow-s", slot: "e", prio: 6, campaignSafe: true,
          label: function () { return "Borrow " + fmt$(500); },
          canShow: function (d) { return sharkHere(d) && !loanOf(d.key); },
          onSelect: function (d) { borrow(d.key, d.name, 500, body(d.rec)); } },
        { id: "shark-borrow-m", slot: "i", prio: 5,
          label: function () { return "Borrow " + fmt$(2000); },
          canShow: function (d) { return sharkHere(d) && !loanOf(d.key) && creditCap() >= 2000; },
          onSelect: function (d) { borrow(d.key, d.name, 2000, body(d.rec)); } },
        { id: "shark-borrow-l", slot: "j", prio: 4,
          label: function () { return "Borrow " + fmt$(creditCap()); },
          canShow: function (d) { return sharkHere(d) && !loanOf(d.key) && creditCap() > 2000; },
          onSelect: function (d) { borrow(d.key, d.name, creditCap(), body(d.rec)); } },
        { id: "shark-pay", slot: "e", prio: 8,
          label: function (d) { const l = loanOf(d.key); return "Pay " + fmt$(l ? owedNow(l) : 0); },
          canShow: function (d) { const l = loanOf(d.key); return sharkHere(d) && !!l && (g.cash | 0) >= owedNow(l); },
          onSelect: function (d) { payLoan(loanOf(d.key), 1e12, body(d.rec)); } },
        { id: "shark-pay-part", slot: "i", prio: 7,
          label: function () { return "Pay " + fmt$(g.cash | 0); },
          canShow: function (d) { const l = loanOf(d.key); return sharkHere(d) && !!l && (g.cash | 0) > 0 && (g.cash | 0) < owedNow(l); },
          onSelect: function (d) { payLoan(loanOf(d.key), g.cash | 0, body(d.rec)); } },
      ],
    });
    // ---- a collector in your face: pay him
    I.registerFixtures({
      id: "debt-collector", kind: "debt-collector", prio: 10, islands: true,
      list: function (ctx, px, pz) {
        if (g.mode === "city" || !CREW.length) return null;
        _out.length = 0;
        for (const c of CREW) if (c.lead && c.phase === "ask" && c.bot && !c.bot.dead) { c.x = c.bot.pos.x; c.z = c.bot.pos.z; c.y = c.bot.pos.y; if (Math.hypot(c.x - px, c.z - pz) < 5) _out.push(c); }
        return _out.length ? _out.slice() : null;
      },
      reach: function () { return 4.5; }, dot: function () { return 0.3; },
      name: function (c) { return c.loan.shark + "'s man"; },
      verbs: [
        { id: "debt-pay", slot: "e", prio: 8,
          label: function (c) { return "Pay " + fmt$(owedNow(c.loan)); },
          canShow: function (c) { return (g.cash | 0) >= owedNow(c.loan); },
          onSelect: function (c) { payLoan(c.loan, 1e12, c.bot); c.paid = true; } },
        { id: "debt-pay-part", slot: "i", prio: 7,
          label: function () { return "Pay " + fmt$(g.cash | 0); },
          canShow: function (c) { return (g.cash | 0) > 0 && (g.cash | 0) < owedNow(c.loan); },
          onSelect: function (c) { payLoan(c.loan, g.cash | 0, c.bot); c.paid = true; } },
      ],
    });
    // ---- a register
    I.registerFixtures({
      id: "island-till", kind: "island-till", prio: 7, islands: true,
      list: function (ctx, px, pz) { return nearList(TILLS, ctx, px, pz, 3.5); },
      reach: function () { return 2.4; }, dot: function () { return 0.45; },
      name: function (t) { return t.name; },
      verbs: [
        { id: "island-till-rob", slot: "e", prio: 6, bad: true,
          label: function (t) { return "Rob " + fmt$(tillHolds(t)); },
          canShow: function (t) { return tillHolds(t) > 0 && cowed(t.clerk); },
          onSelect: robTill },
      ],
    });
    // ---- a teller's window, once she is not stopping you
    I.registerFixtures({
      id: "island-drawer", kind: "island-drawer", prio: 8, islands: true,
      list: function (ctx, px, pz) { return nearList(DRAWERS, ctx, px, pz, 3.5); },
      reach: function () { return 2.4; }, dot: function () { return 0.45; },
      name: function () { return "Teller's drawer"; },
      verbs: [
        { id: "island-drawer-take", slot: "f", prio: 6, bad: true,
          label: function (dr) { return "Clear the drawer " + fmt$(drawerHolds(dr)); },
          canShow: function (dr) { return drawerHolds(dr) > 0 && cowed(dr.teller); },
          onSelect: function (dr) {
            if (CBZ.cityBankDrawerTake && CBZ.cityBankDrawerTake(dr) && dr.venue) dr.venue.alarm("drawer", dr.teller);
          } },
      ],
    });
    // ---- the strongroom door (Gang City's card lives in city/interact.js)
    I.registerFixtures({
      id: "island-vault", kind: "island-vault", prio: 9, islands: true,
      list: function (ctx, px, pz) {
        if (g.mode === "city" || !CBZ.cityVaultAt) return null;
        const py = ctx && ctx.pos ? ctx.pos.y : (P() ? P().pos.y : 0);
        const v = CBZ.cityVaultAt(px, pz, 3.6, py);
        return v ? [v] : null;
      },
      reach: function () { return 3.6; }, dot: function () { return 0.35; },
      name: function (v) { return v.tier === "reserve" ? "The vault" : "Vault"; },
      verbs: [
        { id: "island-vault-try", slot: "e", prio: 7, bad: true,
          label: function (v) { return CBZ.cityVaultLabel ? CBZ.cityVaultLabel(v) : "Try"; },
          canShow: function (v) { return !v.open; },
          onSelect: function (v) {
            const opened = CBZ.cityVaultTry && CBZ.cityVaultTry(v);
            if (opened && v._venue) v._venue.alarm("vault");
          } },
      ],
    });
    // ---- a duffel on the floor (Gang City's pickup is city/interact.js's)
    I.registerFixtures({
      id: "island-cashbag", kind: "island-cashbag", prio: 9, islands: true,
      list: function (ctx, px, pz) {
        if (g.mode === "city" || !CBZ.cashBags || !CBZ.cashBags.nearest) return null;
        const b = CBZ.cashBags.nearest(px, pz, 2.6, ctx && ctx.pos ? ctx.pos.y : null);
        return b ? [b] : null;
      },
      reach: function () { return 2.6; }, dot: function () { return 0.3; },
      name: function () { return "Duffel"; },
      verbs: [
        { id: "island-cashbag-pick", slot: "e", prio: 7,
          label: function (b) { return "Pick up " + fmt$(b.amount); },
          canShow: function (b) { return !b.carried && !(CBZ.cashBags.carried && CBZ.cashBags.carried()); },
          onSelect: function (b) { CBZ.cashBags.pickup(b); } },
      ],
    });
  }
  function sharkHere(d) {
    const r = d && d.rec;
    const bot = body(r);
    if (!bot || bot._upT > 0) return false;
    const p = P();
    return !!p && !gunOut() && Math.abs((bot.pos.y || 0) - (p.pos.y || 0)) < 2.4;
  }
  wireVerbs();
  if (!verbsWired) CBZ.onUpdate(38.6, function () { wireVerbs(); });

  // a vault blown or opened in an island bank: its guards answer it
  CBZ.onUpdate(38.47, function () {
    if (!isles() || !VENUES.length || !CBZ.cityVaults) return;
    for (const V of VENUES) {
      if (V.kind !== "bank" || V._vaultAlarmed) continue;
      const vs = CBZ.cityVaults();
      for (const v of vs) if (v._venue === V && v.open) { V._vaultAlarmed = true; V.alarm("vault"); break; }
    }
  });

  CBZ.islandMoneyAudit = function () {
    let staff = 0, manned = 0, lost = 0;
    for (const r of POSTS) { staff++; if (body(r)) manned++; if (r.ps && r.ps.lost) lost++; }
    return { venues: VENUES.length, staff: staff, manned: manned, lost: lost, tills: TILLS.length,
      drawers: DRAWERS.length, sharkDesks: SHARK_DESKS.length, safes: CBZ.citySafes ? CBZ.citySafes().length : 0,
      loans: loans().length, crew: CREW.length, owed: CBZ.loanShark.owed() };
  };
})();
