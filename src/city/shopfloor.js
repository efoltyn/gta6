/* ============================================================
   city/shopfloor.js — WHAT EVERY COUNTER SHOP SHARES: the man behind the
   counter, the goods in your hands you have not paid for yet, the goods you
   carry that were stolen, and (on the islands) the room itself.

   Owner (2026-10-22): "In a gun store, the products are the physical guns
   that you can pick up... every gun, or piece of jewelry. It's actual
   jewelry." And pawn shops: "buy things or sell things you've stolen."

   The gun store, the pawn shop and the jeweller (city/gunstore.js,
   pawnshop.js, jewelry.js) each run one instance per shop: Gang City's one,
   and one per island building of that use (CBZ.islandVenue). What they have
   in common lives here, once:

   CBZ.shopFloor.till(o)      THE LEDGER. What you took off a shelf and are
       holding: hold(item) / release(item) / pay() / total() / tick(dt).
       Walk out the door with any of it and it is stolen: the clerk shouts,
       the crime is reported (CBZ.cityCrime, an eyewitness when he saw it),
       the goods are marked hot, and an armed shopkeeper goes for the gun
       under the counter.
         item: { name, price, slot?, onPay(), onSteal(), onReturn() }
         o:    { clerk, inStore(x, z), nearDoor?(x, z), behind?(x, z),
                 where (an island key, or "city"), sev? }
       Heading for the door with it, the clerk says so once and (an island
       clerk) comes out to block the doorway; settled, he goes back.
       pay(force): force rings it up with nobody at the counter to take it.
   CBZ.shopFloor.cityClerk(lot)   the posted Gang City vendor (peds.js)
   CBZ.shopFloor.postedClerk(o)   an island shopkeeper: one of the island's
       own people posted behind the counter (CBZ.islandVenue.staff), a gun
       under it when o.armed. o: { b, lot, lx, lz, face (local), armed, job }.
       o.post wraps a post the venue already stood; o.via / o.door his way
       out round the counter and the doorway he blocks (clerkRoute).
       alive() / sees(x, z) / say(topic, ctx) / look(x, z) / defend() /
       confront() / standDown() / out() / tick(dt) / dispose().
   CBZ.shopFloor.clerkRoute(x0, x1, z0, xA, xB, zC, hd, postX, postZ)
       -> { via, door }: the clerk's way round a counter to the door.
   HOT GOODS (g.cityHot): CBZ.cityMarkHot(name, n, where),
       CBZ.cityHotCount(name), CBZ.cityHotNewest(name),
       CBZ.cityHotDrop(name, n). Every theft through a till marks what it
       took; a pawnbroker pays less for hot goods he knows about.
   ISLAND GLASS: CBZ.islandGlass.add(rec) / remove(rec) / burst(rec, hit),
       CBZ.islandGlassRay(ox, oy, oz, dx, dy, dz, maxDist, force, opts) —
       the islands' showcase glass, shot through by the same rounds
       (systems/fpsmode.js calls it where Gang City calls cityShatterRay).
   ISLAND ROOMS: CBZ.shopFloor.plan(b, o) -> the shop's frame in an island
       building (the stair behind its stairwell wall, a back room behind a
       partition, the counter line), CBZ.shopFloor.shell(plan, lot, o)
       -> the partition, the back room and its safe, and
       CBZ.shopFloor.dressShop(plan, lot, kind, desc, o) -> the rest of a
       real shop of that kind round the counter (world/island_fitkit.js
       dress: its walls lined, its gondolas, its lights, its name).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.onUpdate) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  function econ() { return CBZ.cityEcon || null; }
  function fmt$(n) { n = Math.round(n || 0); return "$" + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function now() { return (CBZ.now || 0) / 1000; }
  function P() { return CBZ.player; }

  /* ==================================================================
     HOT GOODS. g.cityHot[name] = [{ t, where }], one record per stolen
     unit you carry. The records are trimmed to what you still hold (an item
     eaten, fenced, dropped elsewhere takes its record with it).
     ================================================================== */
  function hotMap() { return g.cityHot || (g.cityHot = {}); }
  function trimHot(name) {
    const H = hotMap(), L = H[name];
    if (!L) return null;
    const e = econ(), have = e && e.count ? e.count(name) : L.length;
    if (L.length > have) L.splice(0, L.length - have);
    if (!L.length) { delete H[name]; return null; }
    return L;
  }
  CBZ.cityMarkHot = function (name, n, where) {
    if (!name) return;
    const H = hotMap(), L = H[name] || (H[name] = []);
    for (let i = 0; i < (n || 1); i++) L.push({ t: now(), where: where == null ? null : where });
  };
  CBZ.cityHotCount = function (name) { const L = trimHot(name); return L ? L.length : 0; };
  CBZ.cityHotNewest = function (name) { const L = trimHot(name); return L ? L[L.length - 1] : null; };
  // one unit's record lifted off (a hot piece set down on a broker's counter)
  // and put back as it was (he would not buy it)
  CBZ.cityHotTake = function (name) { const L = trimHot(name); return L ? L.pop() : null; };
  CBZ.cityHotPut = function (name, rec) { if (!name || !rec) return; const H = hotMap(); (H[name] || (H[name] = [])).push(rec); };
  CBZ.cityHotDrop = function (name, n) {
    const L = hotMap()[name];
    if (!L) return;
    L.splice(Math.max(0, L.length - (n || 1)));
    if (!L.length) delete hotMap()[name];
  };
  // where a theft happened: the island it happened on, or Gang City
  function whereKey(I) { return I ? (I.id != null ? I.id : (I.name || "isle")) : "city"; }

  /* ==================================================================
     THE CLERK
     ================================================================== */
  function speak(body, topic, ctx) {
    if (!body) return false;
    if (CBZ.voice && CBZ.voice.say) { try { return CBZ.voice.say(body, topic, Object.assign({ force: true }, ctx || {})); } catch (e) { return false; } }
    return false;
  }
  function faceSees(body, x, z, range) {
    if (!body || body.dead || !body.pos) return false;
    const dx = x - body.pos.x, dz = z - body.pos.z, d = Math.hypot(dx, dz);
    if (d > (range || 18)) return false;
    if (d > 0.5) {
      const ry = body.group ? body.group.rotation.y : 0;
      if ((dx / d) * Math.sin(ry) + (dz / d) * Math.cos(ry) < 0.2) return false;   // behind his back
    }
    if (CBZ.clearLineOfFire && !CBZ.clearLineOfFire(body.pos.x, (body.pos.y || 0) + 1.6, body.pos.z, x, (P() ? P().pos.y : 0) + 1.2, z)) return false;
    return true;
  }

  // GANG CITY: the vendor peds.js posts at the shop's counter (lazily, by day)
  function cityClerk(lot) {
    const C = {
      kind: "city",
      body: function () { const b = lot && lot.building; return (b && b.vendor) || null; },
      alive: function () { const v = C.body(); return !!(v && !v.dead && !((v.ko || 0) > 0)); },
      sees: function (x, z) { return C.alive() && faceSees(C.body(), x, z, 16); },
      say: function (topic, ctx) { return speak(C.body(), topic, ctx); },
      look: function () {},
      // the city's gun vendor carries his own piece (peds.js postVendor):
      // turning him on you is his own fight brain
      defend: function () {
        const v = C.body(), pa = CBZ.city && CBZ.city.playerActor;
        if (v && !v.dead && v.armed && pa) { v.rage = pa; v.state = "fight"; }
      },
      busy: function () { return false; },
      tick: function () {},
      dispose: function () {},
    };
    return C;
  }

  /* THE ISLANDS: one of the island's own people at his post behind the
     counter (CBZ.islandVenue.staff: stood where nobody is looking, swept and
     put back with the island's crowd, gone with the island). Published as
     lot.building.vendor too, the way Gang City's posted vendor is, so every
     shop system asks the same field. o: { b, lot, lx, lz, face (local),
     armed (a gun under the counter, or null), job } — or o.post, a post the
     venue already stood (world/island_shops.js's counter clerk), to wrap.
       o.via    [{lx, lz}] building-local: his way out from behind the
                counter (round its end), walked in order
       o.door   {lx, lz} building-local: where he stands to block the door
     confront() — somebody is heading for the door with goods he has not
     paid for: he comes out from behind the counter and plants himself in the
     doorway, facing him, his gun drawn when he keeps one; standDown() — it
     is settled (paid, put back, gone): he puts it away and walks back to his
     post. */
  const SHOT_R = 24;
  function postedClerk(o) {
    const IV = CBZ.islandVenue;
    let aggro = 0, fireCD = 0.6, drawn = false, lookAt = null, out = false;
    let post = o.post || null;
    if (post) {
      const own = post.look;
      post.look = function (Pp, p, dt) { if (lookAt) return lookAt; return own ? own(Pp, p, dt) : null; };
    } else if (IV && IV.staff) {
      post = IV.staff(o.b, o.lx, o.lz, o.face, { job: o.job || "clerk", look: function () { return lookAt; } });
    }
    function live() { const p = post ? post.body() : null; return p && !p.dead ? p : null; }
    if (o.lot && o.lot.building) {
      try { Object.defineProperty(o.lot.building, "vendor", { configurable: true, get: live }); } catch (e) {}
    }
    // his way out and back, in the world
    const F = IV && IV.floor && o.b ? IV.floor(o.b, 0) : null;
    const via = F && o.via ? o.via.map(function (q) { return F.toWorld(q.lx, q.lz); }) : [];
    const doorW = F && o.door ? F.toWorld(o.door.lx, o.door.lz) : null;
    const C = {
      kind: "island", post: post,
      body: live,
      alive: function () { const b = live(); return !!(b && !((b.ko || 0) > 0) && !(CBZ.body && CBZ.body.busy && CBZ.body.busy(b))); },
      sees: function (x, z) { return C.alive() && faceSees(live(), x, z, 18); },
      say: function (topic, ctx) { return C.alive() && speak(live(), topic, ctx); },
      look: function (x, z) { if (!aggro && !out) lookAt = x == null ? null : { x: x, z: z }; },
      defend: function () { if (o.armed && C.alive()) { aggro = 14; fireCD = Math.max(fireCD, 0.9); } },
      busy: function () { return aggro > 0; },
      out: function () { return out; },
      confront: function () {
        const b = live(), Pl = P();
        if (!b || !doorW || !post || !Pl || C.cowed()) return false;
        out = true;
        lookAt = { x: Pl.pos.x, z: Pl.pos.z };
        post.goTo(doorW.x, doorW.z, Math.atan2(Pl.pos.x - doorW.x, Pl.pos.z - doorW.z), via);
        if (o.armed && !drawn) draw(b);
        return true;
      },
      standDown: function () {
        if (!out) return;
        out = false;
        if (!aggro) { lookAt = null; const b = live(); if (b && drawn) holster(b); }
        if (post) post.back(via.slice().reverse());
      },
      // hands up with a gun on him (city/islandmoney.js's hold-up): he rings
      // nothing up and reaches for nothing while it lasts
      cowed: function () { const b = live(); return !!(b && b._upT > 0); },
      tick: function (dt) {
        const b = live();
        if (!b) { aggro = 0; drawn = false; out = false; return; }
        if (aggro > 0 && C.alive() && !C.cowed()) fight(b, dt);
        else if (aggro > 0 && C.alive()) aggro = Math.max(aggro, 2);   // the moment the gun leaves him
        else {
          aggro = 0;
          // out in the doorway: he keeps his eyes on you
          if (out) { const Pl = P(); if (Pl) lookAt = { x: Pl.pos.x, z: Pl.pos.z }; }
          else if (drawn) holster(b);
        }
      },
      dispose: function () {},        // the island takes him (island_venue.js unstaff)
    };
    function draw(b) { drawn = true; b.armed = true; b.weapon = o.armed; }
    function holster(b) {
      drawn = false;
      b.armed = false;
      if (b._weaponProp) b._weaponProp.visible = false;
    }
    // THE GUN UNDER THE COUNTER. He brings it up, turns onto you and fires
    // while he can see you; a pump gun's rhythm, hits by range.
    function fight(b, dt) {
      const Pl = P();
      aggro -= dt;
      if (!Pl || Pl.dead) { aggro = 0; return; }
      if (!drawn) draw(b);
      lookAt = { x: Pl.pos.x, z: Pl.pos.z };
      if (b.post) b.post.look = lookAt;
      if (CBZ.actorAimAt) { try { CBZ.actorAimAt(b, Pl, dt); } catch (e) {} }
      fireCD -= dt;
      const d = Math.hypot(Pl.pos.x - b.pos.x, Pl.pos.z - b.pos.z);
      const see = faceSees(b, Pl.pos.x, Pl.pos.z, SHOT_R);
      if (see) aggro = Math.max(aggro, 3);       // he keeps on you while you are in his sights
      // the fight over (you are gone): back behind his counter
      if (aggro <= 0 && out) C.standDown();
      if (fireCD > 0 || !see || d > SHOT_R) return;
      fireCD = 1.05 + Math.random() * 0.5;
      let from = null;
      try { from = CBZ.actorMuzzle ? CBZ.actorMuzzle(b) : null; } catch (e) { from = null; }
      if (!from) from = { x: b.pos.x, y: b.pos.y + 1.4, z: b.pos.z };
      const hit = Math.random() < (d < 6 ? 0.8 : d < 12 ? 0.55 : 0.3);
      const to = hit ? { x: Pl.pos.x, y: (Pl.pos.y || 0) + 1.2, z: Pl.pos.z }
                     : { x: Pl.pos.x + (Math.random() - 0.5) * 2.2, y: (Pl.pos.y || 0) + 0.6 + Math.random() * 1.6, z: Pl.pos.z + (Math.random() - 0.5) * 2.2 };
      const wpn = /shotgun/i.test(String(o.armed || "")) ? "shotgun" : "pistol";
      if (CBZ.tracer) { try { CBZ.tracer(from, to, { hit: hit, shooter: b, weapon: wpn, targetActor: Pl, muzzleScale: 1.3 }); } catch (e) {} }
      if (CBZ.gunVoice) { try { CBZ.gunVoice(wpn, d); } catch (e) {} } else if (CBZ.sfx) CBZ.sfx("report");
      if (hit) hurtYou(Math.max(12, 42 - d * 2.2), b);
    }
    return C;
  }
  // the clerk's way out from behind a counter (building-local): round the
  // counter's end nearer his post that has room, then to just inside the
  // door. The room runs x0..x1 from the door at z0; the counter from xA to xB
  // at depth zC (half depth hd); his post at (postX, postZ). -> { via, door }
  function clerkRoute(x0, x1, z0, xA, xB, zC, hd, postX, postZ) {
    const right = x1 - (xB + 0.55), left = (xA - 0.55) - x0;
    const goRight = right >= 0.35 && (left < 0.35 || Math.abs(xB - postX) <= Math.abs(postX - xA));
    if (!goRight && left < 0.35) return { via: [], door: null };
    const ex = goRight ? Math.min(x1 - 0.35, xB + 0.55) : Math.max(x0 + 0.35, xA - 0.55);
    return {
      via: [{ lx: ex, lz: postZ }, { lx: ex, lz: zC - hd - 0.6 }],
      door: { lx: 0, lz: z0 + 1.15 },
    };
  }
  function hurtYou(dmg, by) {
    const x = by.pos.x, z = by.pos.z;
    if (g.mode === "city" && CBZ.cityHurtPlayer) { try { CBZ.cityHurtPlayer(dmg, x, z, "shot by a shopkeeper", false, by); } catch (e) {} return; }
    if (CBZ.hurtWorldPlayer) { try { CBZ.hurtWorldPlayer(dmg, x, z, "shopkeeper"); } catch (e) {} }
  }

  /* ==================================================================
     THE TILL: what you are holding that is not paid for
     ================================================================== */
  function till(o) {
    const T = {
      held: [], warned: 0, behindSaid: false,
      clerk: o.clerk,
      hold: function (item) { if (item && T.held.indexOf(item) < 0) T.held.push(item); T.warned = 0; return item; },
      release: function (item) { const i = T.held.indexOf(item); if (i >= 0) T.held.splice(i, 1); return i >= 0; },
      holding: function (slot) { for (const it of T.held) if (it.slot === slot) return it; return null; },
      total: function () { let n = 0; for (const it of T.held) n += it.price | 0; return n; },
      open: function () { return !!(T.clerk && T.clerk.alive() && !T.clerk.busy() && !(T.clerk.cowed && T.clerk.cowed())); },
      // the clerk rings it all up
      pay: function (force) {
        if (!T.held.length || (!force && !T.open())) return false;
        const tot = T.total();
        if (!(CBZ.city && CBZ.city.spend && CBZ.city.spend(tot))) {
          if (CBZ.city && CBZ.city.note) CBZ.city.note(fmt$(tot), 1.4);
          return false;
        }
        const items = T.held.slice();
        T.held.length = 0; T.warned = 0;
        for (const it of items) { try { if (it.onPay) it.onPay(); } catch (e) { console.error("[shop pay]", e); } }
        if (CBZ.sfx) CBZ.sfx("coin");
        if (CBZ.cityHudDirty) CBZ.cityHudDirty();
        return true;
      },
      // everything back on the shelf without a word (you died with it)
      dropAll: function () {
        const items = T.held.slice(); T.held.length = 0; T.warned = 0;
        for (const it of items) { try { if (it.onReturn) it.onReturn(true); } catch (e) {} }
      },
      steal: function () {
        const Pl = P();
        const items = T.held.slice();
        T.held.length = 0; T.warned = 0;
        if (!items.length) return;
        let worth = 0;
        for (const it of items) {
          worth += it.price | 0;
          try { if (it.onSteal) it.onSteal(); } catch (e) { console.error("[shop steal]", e); }
          if (it.name && it.hot !== false) CBZ.cityMarkHot(it.name, 1, o.where);
        }
        const x = Pl ? Pl.pos.x : 0, z = Pl ? Pl.pos.z : 0;
        const saw = !!(T.clerk && T.clerk.sees(x, z));
        if (saw) T.clerk.say("thief");
        T.report(Math.min(160, 60 + worth / 40), saw);
        if (saw && T.clerk.defend) T.clerk.defend();
      },
      // a theft charged to you: an eyewitness behind the counter calls it in
      // on the spot; nobody watching leaves it to whoever else saw
      report: function (sev, eyewitness) {
        const Pl = P();
        if (CBZ.cityCrime) { try { CBZ.cityCrime(sev, { type: o.crime || "theft", x: Pl ? Pl.pos.x : 0, z: Pl ? Pl.pos.z : 0, instant: !!eyewitness }); } catch (e) {} }
      },
      tick: function (dt) {
        const Pl = P();
        if (!Pl) return;
        // settled (paid, put back, gone with it): the clerk goes back to his post
        if (!T.held.length && T.clerk && T.clerk.out && T.clerk.out() && !T.clerk.busy()) T.clerk.standDown();
        if (T.clerk && o.behind) {
          const back = o.behind(Pl.pos.x, Pl.pos.z);
          if (back && !T.behindSaid && T.clerk.sees(Pl.pos.x, Pl.pos.z)) { T.behindSaid = true; T.clerk.say("behindCounter"); }
          else if (!back) T.behindSaid = false;
        }
        if (!T.held.length) return;
        if (Pl.dead) { T.dropAll(); return; }
        if (!o.inStore(Pl.pos.x, Pl.pos.z)) { T.steal(); return; }
        // heading for the door with it: the warning, once
        if (!T.warned && o.nearDoor && o.nearDoor(Pl.pos.x, Pl.pos.z) && T.clerk && T.clerk.sees(Pl.pos.x, Pl.pos.z)) {
          T.warned = 1;
          T.clerk.say("shoplift", { ladder: { kind: "shoplift", step: 0 } });
          // and he comes out from behind the counter to stand in the doorway
          if (T.clerk.confront) T.clerk.confront();
        }
      },
    };
    return T;
  }

  /* ==================================================================
     ISLAND GLASS
     ================================================================== */
  const IG = [];
  function burstGlass(rec, hit) {
    if (!rec || rec.shattered) return;
    rec.shattered = true;
    if (rec.mesh) rec.mesh.visible = false;
    if (rec.col) {
      if (CBZ.colliderRemove) CBZ.colliderRemove(rec.col);
      else { const i = CBZ.colliders.indexOf(rec.col); if (i >= 0) CBZ.colliders.splice(i, 1); }
    }
    if (CBZ.debris && CBZ.debris.shatterBox && rec.mesh) {
      try {
        CBZ.debris.shatterBox({ minX: rec.x - rec.hw, maxX: rec.x + rec.hw, minY: rec.y - rec.hh, maxY: rec.y + rec.hh, minZ: rec.z - rec.hd, maxZ: rec.z + rec.hd },
          rec.mesh.material, { kind: "glass", at: hit ? { x: hit.x, y: hit.y, z: hit.z } : { x: rec.x, y: rec.y, z: rec.z },
            dir: { x: hit ? hit.dx || 0 : 0, y: 0.2, z: hit ? hit.dz || 0 : 0 }, power: 0.8, maxPieces: 10, speed: 2.0 });
      } catch (e) {}
    }
    const Pl = P();
    if (CBZ.sfx && Pl && Math.hypot(Pl.pos.x - rec.x, Pl.pos.z - rec.z) < 50) CBZ.sfx("glass");
    if (rec.onBreak) { try { rec.onBreak(rec); } catch (e) { console.error("[island glass]", e); } }
  }
  CBZ.islandGlass = {
    add: function (rec) { rec.shattered = !!rec.shattered; IG.push(rec); return rec; },
    remove: function (rec) { const i = IG.indexOf(rec); if (i >= 0) IG.splice(i, 1); },
    burst: burstGlass,
    mend: function (rec) {
      if (!rec || !rec.shattered) return;
      rec.shattered = false;
      if (rec.mesh) rec.mesh.visible = true;
      if (rec.col) CBZ.colliders.push(rec.col);
    },
    count: function () { return IG.length; },
  };
  // the same slab test as city/buildings.js's cityShatterRay, over the
  // islands' panes only; publishes the distance through the same field
  CBZ.islandGlassRay = function (ox, oy, oz, dx, dy, dz, maxDist) {
    CBZ.cityLastShatterDist = -1;
    if (!IG.length) return null;
    const nl = Math.hypot(dx, dy, dz) || 1; dx /= nl; dy /= nl; dz /= nl;
    const lim = maxDist != null ? maxDist : 1e9;
    let best = null, bestT = lim;
    for (let i = 0; i < IG.length; i++) {
      const r = IG[i];
      if (r.shattered) continue;
      let t0 = -1e9, t1 = 1e9, ok = true;
      const ax = [[r.x, r.hw, ox, dx], [r.y, r.hh, oy, dy], [r.z, r.hd, oz, dz]];
      for (let k = 0; k < 3 && ok; k++) {
        const c = ax[k][0], h = ax[k][1], o = ax[k][2], d = ax[k][3];
        if (Math.abs(d) < 1e-8) { if (Math.abs(c - o) > h) ok = false; continue; }
        let a = (c - h - o) / d, b = (c + h - o) / d;
        if (a > b) { const s = a; a = b; b = s; }
        if (a > t0) t0 = a;
        if (b < t1) t1 = b;
      }
      if (!ok || t1 < t0 || t1 <= 0) continue;
      const te = Math.max(0, t0);
      if (te < bestT) { bestT = te; best = r; }
    }
    if (best) {
      CBZ.cityLastShatterDist = bestT;
      burstGlass(best, { x: ox + dx * bestT, y: oy + dy * bestT, z: oz + dz * bestT, dx: dx, dz: dz });
      if (best.byPlayer) { try { best.byPlayer(best); } catch (e) {} }
    }
    return best;
  };

  /* ==================================================================
     THE ISLAND ROOM
     An island building's frame (world/island_venue.js): door on local -z,
     the stair strip (when there is one) down the local -x side, the front
     band kept walkable. A counter shop takes the rest: customers at the
     front, the counter across the room, the clerk behind it, and (deep
     enough) a back room behind a partition with the safe in it.
     ================================================================== */
  function plan(b, o) {
    o = o || {};
    const IV = CBZ.islandVenue;
    if (!IV || !b || !b.group) return null;
    const F = IV.floor(b, 0), L = F.local;
    // the stair goes behind its wall first: the shop starts at the wall's face
    const sw = IV.stairwell ? IV.stairwell(b) : null;
    let xs = L.x0;
    for (const r of F.keepOut) {
      if (r.why === "stairs") { if (r.x0 <= L.x0 + 0.05) xs = Math.max(xs, sw ? sw.face + 0.02 : r.x1 + 0.08); else return null; }
      else if (r.why === "lift" || r.why === "door to lift") return null;   // a tower lobby: not a counter room
    }
    const x0 = xs, x1 = L.x1, z0 = L.z0, z1 = L.z1;
    const W = x1 - x0, D = z1 - z0;
    if (W < 4.6 || D < 7) return null;
    const back = o.backRoom && D >= 9.4 ? Math.min(2.6, Math.max(2.1, D * 0.22)) : 0;
    const zP = z1 - back;                                   // the partition's centre line
    const wallFace = back ? zP - 0.07 : z1;                 // the face the shop's back wall shows
    const yaw = F.yaw, co = Math.cos(yaw), si = Math.sin(yaw);
    const w = function (lx, lz) { return { x: b.ox + lx * co + lz * si, z: b.oz - lx * si + lz * co }; };
    const v = function (lx, lz) { return { x: lx * co + lz * si, z: -lx * si + lz * co }; };
    const loc = function (x, z) { const dx = x - b.ox, dz = z - b.oz; return { x: dx * co - dz * si, z: dx * si + dz * co }; };
    const aabb = function (ax, az, bx, bz) {
      const p = w(ax, az), q = w(bx, bz);
      return { minX: Math.min(p.x, q.x), maxX: Math.max(p.x, q.x), minZ: Math.min(p.z, q.z), maxZ: Math.max(p.z, q.z) };
    };
    const P0 = {
      b: b, F: F, x0: x0, x1: x1, z0: z0, z1: z1, W: W, D: D, back: back, zP: zP, wallFace: wallFace,
      fy: F.y, fyL: F.yLocal, yaw: yaw, w: w, v: v, loc: loc,
      room: aabb(x0, z0, x1, z1),                  // the whole floor, back room included
      shop: aabb(x0, z0, x1, wallFace),            // the shop floor
      xc: (x0 + x1) / 2,
      // the customer side (toward the door) as a world unit vector
      cust: v(0, -1),
      inside: function (x, z, pad) { const p = loc(x, z); pad = pad || 0; return p.x > x0 - pad && p.x < x1 + pad && p.z > z0 - pad && p.z < z1 + pad; },
      nearDoor: function (x, z) { const p = loc(x, z); return p.z < z0 + 2.3 && Math.abs(p.x) < 2.6; },
    };
    return P0;
  }

  // a merged fixture kit, world frame (gunstore.js's store fixture kit)
  function kit() { return CBZ.storeFixtureKit ? CBZ.storeFixtureKit.create() : null; }
  // the frame whose +Z points along the plan's local direction (ldx, ldz)
  function yawToward(P0, ldx, ldz) { const d = P0.v(ldx, ldz); return Math.atan2(d.x, d.z); }

  // the back room: the partition (a doorway at the + end), the side wall
  // that closes it off from the stair strip, steel shelving along the back
  // wall, and the shop's safe in the corner opposite the door (the real one:
  // city/islandmoney.js's CBZ.islandVenue.safe, the safe every island
  // building keeps, set where this room wants it). Returns { group, dispose }.
  function shell(P0, lot, o) {
    const it = shellSteps(P0, lot, o);
    let r = it.next();
    while (!r.done) r = it.next();
    return r.value;
  }
  // the same as a generator on the island build's slice clock (a venue
  // fit-out that is a generator takes it with yield*)
  function shellLate() { return !!(CBZ.sliceLate && CBZ.sliceLate()); }
  function* shellSteps(P0, lot, o) {
    o = o || {};
    const B = lot.building, lb = B.lbox;
    const out = { group: new THREE.Group(), cols: [], dispose: null, safe: null };
    out.group.name = "island-shop-backroom";
    const fyL = P0.fyL, H = 2.85, T = 0.12;
    const PLASTER = o.wall || 0xd9d3c6, TRIM = o.trim || 0x6b6258;
    if (P0.back && lb) {
      // the staff door, at the + end (o.door "x0": the stair end, where a
      // clothes shop keeps its cash wrap and its fitting room is at the +)
      const left = o.door === "x0";
      const dw = 0.95, dx = left ? P0.x0 + 0.85 : P0.x1 - 0.85;
      // the way to it stays clear of whatever the shop floor is dressed with
      if (CBZ.islandVenue && CBZ.islandVenue.claim) CBZ.islandVenue.claim(P0.b, 0, { x0: dx - 0.65, x1: dx + 0.65, z0: P0.wallFace - 1.3, z1: P0.wallFace });
      const a0 = P0.x0, a1 = dx - dw / 2, c0 = dx + dw / 2, c1 = P0.x1;
      if (a1 - a0 > 0.1) lb((a0 + a1) / 2, fyL + H / 2, P0.zP, a1 - a0, H, T, PLASTER, { solid: true, los: true });
      if (c1 - c0 > 0.05) lb((c0 + c1) / 2, fyL + H / 2, P0.zP, c1 - c0, H, T, PLASTER, { solid: true, los: true });
      lb(dx, fyL + 2.1 + (H - 2.1) / 2, P0.zP, dw, H - 2.1, T, PLASTER, { los: true });          // over the doorway
      for (const s of [-1, 1]) lb(dx + s * (dw / 2 + 0.03), fyL + 1.05, P0.zP, 0.06, 2.1, T + 0.04, TRIM);   // the frame
      lb(dx, fyL + 2.13, P0.zP, dw + 0.12, 0.06, T + 0.04, TRIM);
      lb((a0 + c1) / 2, fyL + 0.05, P0.zP - T / 2 - 0.006, c1 - a0, 0.1, 0.012, TRIM);           // skirting
      // (the stair strip beside the back room: closed off here unless the
      // stairwell wall already runs the building's depth)
      if (P0.x0 > P0.F.local.x0 + 0.2 && !P0.b._stairwell) lb(P0.x0 + 0.06, fyL + H / 2, (P0.zP + P0.z1) / 2, T, H, P0.z1 - P0.zP, PLASTER, { solid: true, los: true });
      // the safe, in the back corner opposite the door, its door to the partition
      const IV = CBZ.islandVenue;
      if (IV && IV.safe) {
        try { out.safe = IV.safe(P0.b, { k: 0, lx: left ? P0.x1 - 0.62 : P0.x0 + 0.62, lz: P0.z1 - 0.5, yaw: Math.PI, grade: o.safeGrade || "floor", of: o.safeOf, name: o.safeName || "safe" }); }
        catch (e) { console.error("[shop safe]", e); }
      }
      // steel shelving along the back wall, loaded with what a back room holds
      if (shellLate()) yield 0;
      const k = kit();
      const shx = P0.x0 + 1.4 + 0.6, shw = Math.min(2.4, P0.W - 3.4);
      if (k && shw > 0.9) {
        const Y = P0.fy;
        const sp2 = P0.w(shx + shw / 2 - 0.6, P0.z1 - 0.26);
        k.frame(sp2.x, 0, sp2.z, yawToward(P0, 0, -1));
        for (const s of [-1, 1]) for (const zz of [-0.18, 0.18]) k.box(s * (shw / 2 - 0.02), Y + 0.95, zz, 0.035, 1.9, 0.035, 0x6a7078, "metal");
        for (const sy of [0.12, 0.62, 1.12, 1.62]) {
          if (shellLate()) yield 0;
          k.box(0, Y + sy, 0, shw, 0.02, 0.4, 0x8a9096, "metal");
          const items = Math.floor(shw / 0.34);
          for (let i = 0; i < items; i++) {
            const x = -shw / 2 + 0.2 + i * 0.34;
            if (o.goods === "ammo") {
              k.box(x, Y + sy + 0.1, 0, 0.28, 0.18, 0.15, 0x4b5234, "metal");
              k.box(x, Y + sy + 0.2, 0, 0.29, 0.025, 0.16, 0x444b2f, "metal");
            } else {
              const hgt = 0.14 + ((i * 7 + sy * 10) % 3) * 0.05;
              k.box(x, Y + sy + 0.01 + hgt / 2, 0, 0.28, hgt, 0.3, 0xb08a55);
              k.box(x, Y + sy + 0.01 + hgt * 0.6, 0.151, 0.18, hgt * 0.3, 0.002, 0xf2f0ea);
            }
          }
        }
        if (shellLate()) yield 0;
        k.build(out.group);
        CBZ.scene.add(out.group);
        // it sleeps and wakes with the building's own rooms (disaster_arena.js)
        const ud = P0.b.group.userData;
        (ud.rooms || (ud.rooms = [])).push(out.group);
        if (ud.roomsOn === false) out.group.visible = false;
        const c0w = P0.w(shx - 0.6, P0.z1 - 0.46), c1w = P0.w(shx - 0.6 + shw, P0.z1 - 0.04);
        const cs = { minX: Math.min(c0w.x, c1w.x), maxX: Math.max(c0w.x, c1w.x), minZ: Math.min(c0w.z, c1w.z), maxZ: Math.max(c0w.z, c1w.z), y0: P0.fy, y1: P0.fy + 1.9 };
        // (colliderAddMany files it in the grid in step: no full rebuild)
        if (CBZ.colliderAddMany) CBZ.colliderAddMany([cs]); else { CBZ.colliders.push(cs); if (CBZ.markCollidersDirty) CBZ.markCollidersDirty(); }
        out.cols.push(cs);
      }
    }
    out.dispose = function () {
      const rooms = P0.b.group && P0.b.group.userData.rooms;
      if (rooms) { const i = rooms.indexOf(out.group); if (i >= 0) rooms.splice(i, 1); }
      if (out.group.parent) out.group.parent.remove(out.group);
      disposeTree(out.group);
      dropCols(out.cols);
    };
    return out;
  }

  function disposeTree(root) {
    if (!root) return;
    root.traverse(function (o) {
      if (o.geometry && !o.geometry._shared && o.geometry.dispose) { try { o.geometry.dispose(); } catch (e) {} }
      if (o.material) { const m = o.material; if (Array.isArray(m)) m.forEach(function (x) { if (x && !x._shared && x.dispose) x.dispose(); }); else if (!m._shared && m.dispose) m.dispose(); }
    });
  }
  function dropCols(cols) {
    if (!cols || !cols.length) return;
    if (CBZ.colliderRemoveMany) CBZ.colliderRemoveMany(cols);
    else for (const c of cols) { const i = CBZ.colliders.indexOf(c); if (i >= 0) CBZ.colliders.splice(i, 1); }
    cols.length = 0;
    if (!CBZ.colliderRemoveMany && CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }

  // the gun store's descriptor (city/buildings.js's lot.building.gunstore
  // shape) for an island plan: the rack on the partition (or back wall),
  // the counter across the room in front of it
  function gunDescriptor(P0) {
    const c = P0.cust;                                         // into the room = toward the door
    const tx = c.z, tz = -c.x;                                 // the kit frame's +Z is then c
    const rp = P0.w(P0.xc, P0.wallFace - 0.18);
    const L = Math.min(4.6, Math.max(2.4, P0.W - 3.6)), DD = 0.66;
    const zC = P0.wallFace - 1.7 - DD / 2;
    const cp = P0.w(P0.xc, zC);
    return {
      name: P0.b.name || null,
      bounds: P0.room,
      rack: { x: rp.x, z: rp.z, nx: c.x, nz: c.z, tx: tx, tz: tz, span: Math.min(7, Math.max(2.4, P0.W - 1.6)) },
      counter: { x: cp.x, z: cp.z, w: L, d: DD, top: P0.fy + 0.98, tx: tx, tz: tz, inx: c.x, inz: c.z, zL: zC, L: L, D: DD },
    };
  }
  // the counter's frame in the plan: behind-the-counter test (the strip
  // between the counter and the back wall), and the clerk's post
  function counterZone(P0, desc) {
    const zC = desc.counter.zL, half = desc.counter.D / 2;
    const L = desc.counter.L, postX = P0.xc + 0.4, postZ = zC + half + 0.55;
    return {
      // his way round the counter's end to the door (postedClerk o.via / o.door)
      route: clerkRoute(P0.x0, P0.x1, P0.z0, P0.xc - L / 2, P0.xc + L / 2, zC, half, postX, postZ),
      behind: function (x, z) { const p = P0.loc(x, z); return p.z > zC + half + 0.05 && p.z < P0.wallFace && p.x > P0.x0 && p.x < P0.x1; },
      // the clerk's spot, building-local (CBZ.islandVenue.staff), facing the door
      post: { lx: postX, lz: postZ, face: Math.PI },
    };
  }

  // the counter's register is real cash (city/islandmoney.js
  // CBZ.islandVenue.till): declared where the kit drew the till, at counter-
  // frame x `u` (gunstore/jewelry: -L/2 + 0.55, the pawn shop's cage: +0.27 L)
  function register(P0, desc, clerk, u, name) {
    const IV = CBZ.islandVenue, c = desc.counter;
    if (!IV || !IV.till) return null;
    // counter-frame +X is plan-local -x; its clerk side is plan-local +z
    try { return IV.till(P0.b, { k: 0, lx: P0.xc - u, lz: c.zL + c.D / 2 - 0.24, ly: P0.fyL + 1.02, draw: false,
      clerk: clerk && clerk.post ? clerk.post : null, name: name }); }
    catch (e) { console.error("[shop register]", e); return null; }
  }

  /* THE REST OF THE SHOP. A counter shop's plan is the counter across the
     room, the clerk and the stock wall behind it: this dresses everything
     in front of that band like the real shop of its kind, through the
     islands' one room dresser (world/island_fitkit.js CBZ.islandFit.dress).
     o: { keep: [building-local rects the venue's own pieces stand on] } */
  function dressShop(P0, lot, kind, desc, o) {
    const it = dressShopSteps(P0, lot, kind, desc, o);
    let r = it.next();
    while (!r.done) r = it.next();
    return r.value;
  }
  // the same as a generator, on the island build's slice clock (a venue
  // fit-out that is a generator takes it with yield*)
  function* dressShopSteps(P0, lot, kind, desc, o) {
    o = o || {};
    const FIT = CBZ.islandFit;
    if (!FIT || !FIT.dress || !P0) return null;
    const C = desc && desc.counter;
    const R = { x0: P0.x0, x1: P0.x1, z0: P0.z0, z1: P0.wallFace };
    const band = C ? C.zL - C.D / 2 - 0.95 : P0.wallFace - 2.6;
    const keep = [{ x0: R.x0, x1: R.x1, z0: band, z1: R.z1 }].concat(o.keep || []);
    const name = (lot && lot.name) || (P0.b && P0.b.name) || null;
    const P = FIT.PAL;
    const spec = { kind: kind, room: R, keep: keep, sign: name, signAt: { ly: FIT.ceil(P0.b, 0) - 0.36, w: Math.min(2.4, P0.W * 0.4) } };
    if (kind === "guns") {
      // the armoury's forms stand down the +x wall in front of the counter
      keep.push({ x0: R.x1 - 1.05, x1: R.x1, z0: band - 3.2, z1: band });
      spec.walls = [
        { edge: "x0", mods: ["safes"], w: 1.6, d: 0.62, front: 0.9, max: 1, from: R.z0 + 1.4 },
        { edge: "x0", mods: ["slat", "slat"], w: 1.2, d: 0.42, style: "bags", pal: P.tactical, rows: [0.8, 1.35, 1.9] },
        { edge: "x1", mods: ["slat"], w: 1.2, d: 0.42, style: "holsters", pal: P.tactical },
        { edge: "x1", mods: ["slat"], w: 1.2, d: 0.42, style: "cards", pal: P.ammo },
      ];
      spec.centre = { mod: "gondola", len: [3.0, 2.4, 1.8], d: 0.9, h: 1.5, style: "ammo", pal: P.ammo, max: 2 };
      spec.lights = "track";
      spec.window = { style: "cases", pal: P.tactical };
      spec.signBg = "#20251f"; spec.signFg = "#e2c98a";
      const posters = [];
      for (const edge of ["x0", "x1"]) for (let i = 0; i < 3; i++) {
        posters.push({ edge: edge, a: R.z0 + (R.z1 - R.z0) * (0.22 + i * 0.25), y: 2.78, w: 0.28, h: 0.42, tex: FIT.targetTex(i + (edge === "x1" ? 1 : 0)) });
      }
      spec.posters = posters;
    } else if (kind === "pawn") {
      spec.walls = [
        { edge: "x0", mods: ["guitars", "tvs", "shelf"], w: 1.3, d: 0.45, style: "tech", pal: P.pawn },
        { edge: "x1", mods: ["shelf", "shelf"], w: 1.2, d: 0.45, style: "tools", pal: P.pawn, accent: 0x5a4632 },
      ];
      spec.centre = [
        { mod: "showcase", len: [2.0, 1.4], d: 0.7, aisle: 1.0, endAisle: 0.8, style: "tech", pal: P.pawn, max: 3, base: 0x5a4632 },
      ];
      spec.lights = "tube";
      spec.window = { style: "tech", pal: P.pawn };
      spec.signBg = "#141414"; spec.signFg = "#f2c230";
    } else if (kind === "jewelry") {
      spec.walls = [
        { edge: "x0", mods: ["panel"], w: 1.2, d: 0.06, front: 0, back: 0x2a1a10, upper: 0x4a2e1c },
        { edge: "x1", mods: ["panel"], w: 1.2, d: 0.06, front: 0, back: 0x2a1a10, upper: 0x4a2e1c },
      ];
      spec.floor = { col: 0x3a2228, border: 0xb8963e };
      spec.lights = "pin";
      spec.signBg = "#1a120c"; spec.signFg = "#e2c98a"; spec.signBack = 0x2a1a10;
      // a seat for the man buying the ring: two armchairs and a low table by the window
      spec.extra = function (D) {
        const x1 = R.x1 - 0.7, z = R.z0 + 1.9;
        for (const t of [0, 1.6]) {
          const r = { x0: x1 - 0.75, x1: R.x1, z0: z + t - 0.6, z1: z + t + 0.75 };
          if (!D.place(r)) continue;
          D.furnish("armchair", x1 - 0.1, z + t, -Math.PI / 2, { tone: { cloth: 0x4a1f28, wood: 0x2a1a10, frame: 0x2a1a10 } });
        }
        const c = { x0: R.x1 - 2.0, x1: R.x1 - 1.1, z0: z + 0.3, z1: z + 1.3 };
        if (D.place(c)) D.furnish("coffee", R.x1 - 1.55, z + 0.8, Math.PI / 2, { len: 0.8, deep: 0.5, tone: { wood: 0x2a1a10 } });
      };
    }
    if (o.walls) spec.walls = o.walls;
    return FIT.dressSteps ? yield* FIT.dressSteps(P0.b, spec) : FIT.dress(P0.b, spec);
  }

  CBZ.shopFloor = {
    till: till, cityClerk: cityClerk, postedClerk: postedClerk, clerkRoute: clerkRoute,
    plan: plan, shell: shell, shellSteps: shellSteps, gunDescriptor: gunDescriptor, counterZone: counterZone, register: register, dressShop: dressShop, dressShopSteps: dressShopSteps,
    whereKey: whereKey, disposeTree: disposeTree, dropCols: dropCols, yawToward: yawToward, fmt$: fmt$,
    audit: function () { return { glass: IG.length, hot: Object.keys(hotMap()).length }; },
  };
})();
