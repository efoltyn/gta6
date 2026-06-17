/* ============================================================
   net/networld.js — the shared LIVING CITY. FiveM-style split:
   the elected sim-host's browser runs the real NPC/traffic/cop
   simulation (all 400 Math.randoms stay right where they are)
   and broadcasts:
     - meta  (reliable, on join + as entities appear): who each
       ped IS — name, outfit colors, cop-ness; which car model
     - world (10Hz): positions/heading/speed/hp/flags for every
       ped, cop and car — on servers with the targeted relay
       (feat "to") each guest gets only the world NEAR them
       (180u in / 210u out + grace), FiveM-style scoping
   Guests never simulate: they render interpolated PUPPETS that
   are still real hitscan targets — a guest's shot is routed to
   the host ("hit" event) and applied to the authoritative ped.
   Cars use ownership transfer: a guest who enters a car asks the
   host for it ("carReq"); the host removes it from its sim and
   grants it ("carGrant"); the guest then simulates that one car
   locally (full drive feel) and returns it on exit ("carRel").
============================================================ */
(function () {
  "use strict";
  if (typeof window === "undefined" || !window.CBZ || !window.CBZ.net) return;
  const CBZ = window.CBZ;
  const net = CBZ.net;
  const g = CBZ.game;

  const SNAP_HZ = 10;
  const INTERP_MS = 200;

  // ============================ HOST SIDE ==================================
  let nextNid = 1;
  let metaSentTo = new Set(); // player ids that have full meta
  let snapAcc = 0, metaAcc = 0;
  const knownGone = [];

  function tagNew(list, isCop, freshPeds, freshCars) {
    for (const e of list) {
      if (e.nid) continue;
      e.nid = nextNid++;
      if (freshCars && e.group && e.heading != null && e.v != null) freshCars.push(e);
      else if (freshPeds) freshPeds.push(e);
    }
  }

  function pedMeta(p, isCop) {
    return {
      i: p.nid, nm: isCop ? (p.swat ? "SWAT" : "OFFICER") : (p.name || "Someone"),
      o: p.outfit != null ? p.outfit : 0x555a66, s: p.skin != null ? p.skin : 0xc68642,
      c: isCop ? 1 : 0, sw: p.swat ? 1 : 0,
    };
  }
  function carMeta(c) { return { i: c.nid, m: c.model ? c.model.name : 0 }; }

  function fullMeta() {
    const m = { e: "meta", peds: [], cars: [], gone: [] };
    for (const p of CBZ.cityPeds || []) if (p.nid) m.peds.push(pedMeta(p, false));
    for (const c of CBZ.cityCops || []) if (c.nid) m.peds.push(pedMeta(c, true));
    for (const c of CBZ.cityCars || []) if (c.nid) m.cars.push(carMeta(c));
    return m;
  }

  // one packer fills nid->row Maps (rows are the unchanged wire format); the
  // legacy broadcast dumps every row, the scoped path picks per guest
  const _rowsPed = new Map(), _rowsCop = new Map(), _rowsCar = new Map();
  const _ents = new Map(); // nid -> live entity this tick (meta on scope-enter)

  function packInto(list, rows) {
    for (const p of list || []) {
      if (!p.nid || !p.group) continue;
      let fl = 0;
      if (p.dead) fl |= 1;
      if (p.char && p.char.handsUp) fl |= 2;
      if (p.ko > 0) fl |= 4;
      rows.set(p.nid, [
        p.nid,
        Math.round(p.pos.x * 10) / 10, Math.round(p.pos.z * 10) / 10,
        Math.round((p.group.rotation.y || 0) * 100) / 100,
        Math.round((p.speed || 0) * 10) / 10,
        fl, Math.round(p.hp || 0),
      ]);
      _ents.set(p.nid, p);
    }
  }

  function packCarsInto(rows) {
    for (const c of CBZ.cityCars || []) {
      if (!c.nid || c.dead) continue;
      if (c.player) continue; // the host's own driven car rides its state stream
      rows.set(c.nid, [
        c.nid,
        Math.round(c.pos.x * 10) / 10, Math.round(c.pos.z * 10) / 10,
        Math.round((c.heading || 0) * 100) / 100, Math.round((c.v || 0) * 10) / 10,
      ]);
      _ents.set(c.nid, c);
    }
  }

  function vals(m) { const a = []; for (const r of m.values()) a.push(r); return a; }

  // ---- interest management ------------------------------------------------
  // Each guest only receives the world NEAR them (FiveM-style scoping): enter
  // 180u / leave 210u hysteresis + 1.5s grace so bodies on the edge don't
  // flicker. The host still SIMULATES everything — this only trims the wire,
  // so 8 spread-out guests don't each pay for all ~160 synced entities.
  const SCOPE_ENTER2 = 180 * 180, SCOPE_LEAVE2 = 210 * 210, SCOPE_GRACE = 1500;
  const scope = new Map();   // guest id -> Map(nid -> 0 (in) | grace-start ms)
  const _forced = new Set(); // nids pinned in scope for the guest being served

  // ---- DELTA SNAPSHOTS (CBZ.netDelta, default ON; set false to revert) --------
  // On a RELIABLE transport the delta baseline is simply "the last row I sent this
  // guest" — no acks/ring-buffers. We send a per-guest in-scope row only when it
  // CHANGED, or every HEAL_MS as a refresh. HEAL_MS < the guest's 4000ms absence-
  // drop, so an omitted (unchanged) entity is ALWAYS re-sent before it would time
  // out — and the guest already tolerates omissions (that is exactly how scoping
  // works), so NO apply-side change is needed. A standing crowd — which dominates a
  // packed plaza — collapses from 10Hz to ~0.5Hz per body. OFF → full rows = today.
  const SENT = new Map();    // guest id -> Map(nid -> { k:rowKey, t:lastSentMs })
  const HEAL_MS = 2000;
  if (CBZ.netDelta === undefined) CBZ.netDelta = true;
  function rowKey(r) { return r.join(","); }   // rows are already quantized → a stable change key
  function deltaRows(rows, sm, now) {
    if (CBZ.netDelta === false) return rows;
    const out = [];
    for (const r of rows) {
      const nid = r[0], k = rowKey(r), s = sm.get(nid);
      if (!s || s.k !== k || now - s.t > HEAL_MS) { out.push(r); sm.set(nid, { k, t: now }); }
    }
    return out;
  }
  CBZ._netDeltaRows = deltaRows;   // test hook (tools/test-net-delta.js)

  function metaCiv(p) { return pedMeta(p, false); }
  function metaCop(p) { return pedMeta(p, true); }

  function scopePass(rows, ents, gx, gz, now, outRows, metaOut, metaFn, gone, forced) {
    for (const [nid, row] of rows) {
      const dx = row[1] - gx, dz = row[2] - gz;
      const d2 = dx * dx + dz * dz;
      const st = ents.get(nid);
      if (d2 <= SCOPE_ENTER2 || (forced && forced.has(nid))) {
        if (st === undefined) metaOut.push(metaFn(_ents.get(nid))); // entering: puppet needs its meta first
        if (st !== 0) ents.set(nid, 0);
        outRows.push(row);
      } else if (st !== undefined) {
        if (d2 <= SCOPE_LEAVE2) {                    // inside the keep band: (re)anchor
          if (st !== 0) ents.set(nid, 0);
          outRows.push(row);
        } else if (st === 0) { ents.set(nid, now); outRows.push(row); } // left the band: grace starts, still sent
        else if (now - st > SCOPE_GRACE) { ents.delete(nid); gone.push(nid); }
        else outRows.push(row);
      }
    }
  }

  function scopedSnapshots(now) {
    for (const [gid] of net.players) {
      const R = CBZ.netRemoteActor ? CBZ.netRemoteActor(gid) : null;
      if (!R) continue; // no state from them yet (loading/title) — nothing to scope around
      let gx, gz;
      if (R.driving && R.carBuf && R.carBuf.length) { const c = R.carBuf[R.carBuf.length - 1]; gx = c.x; gz = c.z; }
      else if (R.buf && R.buf.length) { const b = R.buf[R.buf.length - 1]; gx = b.x; gz = b.z; }
      else continue;
      let ents = scope.get(gid);
      if (!ents) { ents = new Map(); scope.set(gid, ents); }
      // cops actively hunting THIS guest stay in their world at any distance
      _forced.clear();
      for (const c of CBZ.cityCops || []) if (c.nid && (c.curTarget === R || c.npcTarget === R)) {
        _forced.add(c.nid);
        if (c.chaseCar && c.chaseCar.nid) _forced.add(c.chaseCar.nid); // the cruiser under him too
      }
      const mp = [], mc = [], gone = [];
      const pd = [], cp = [], cr = [];
      scopePass(_rowsPed, ents, gx, gz, now, pd, mp, metaCiv, gone, null);
      scopePass(_rowsCop, ents, gx, gz, now, cp, mp, metaCop, gone, _forced);
      scopePass(_rowsCar, ents, gx, gz, now, cr, mc, carMeta, gone, _forced); // pinned cruisers ride with their cops
      // scoped entities the sim deleted outright (granted car, culled body)
      for (const nid of ents.keys())
        if (!_rowsPed.has(nid) && !_rowsCop.has(nid) && !_rowsCar.has(nid)) { ents.delete(nid); gone.push(nid); }
      // DELTA: send only changed (or HEAL_MS-stale) rows; a gone/left entity drops
      // its baseline so a re-entry re-sends a full row. Per-guest baseline = SENT[gid].
      let sm = SENT.get(gid); if (!sm) { sm = new Map(); SENT.set(gid, sm); }
      for (const nid of gone) sm.delete(nid);
      const pdD = deltaRows(pd, sm, now), cpD = deltaRows(cp, sm, now), crD = deltaRows(cr, sm, now);
      // meta first so a fresh puppet spawns dressed, then the (delta'd) rows
      if (mp.length || mc.length || gone.length) net.sendTo(gid, { t: "ev", e: "meta", peds: mp, cars: mc, gone });
      net.sendTo(gid, { t: "world", pd: pdD, cp: cpD, cr: crD, w: g.wanted | 0 });
    }
  }

  if (CBZ.onAlways) CBZ.onAlways(61, function (dt) {
    if (!net.isHost() || g.mode !== "city" || g.state === "title") return;
    snapAcc += dt;
    if (snapAcc < 1 / SNAP_HZ) return;
    snapAcc = 0;
    hookFracture();

    const freshPeds = [], freshCars = [];
    tagNew(CBZ.cityPeds || [], false, freshPeds, null);
    tagNew(CBZ.cityCops || [], true, freshPeds, null);
    for (const c of CBZ.cityCars || []) if (!c.nid) { c.nid = nextNid++; freshCars.push(c); }

    _ents.clear(); _rowsPed.clear(); _rowsCop.clear(); _rowsCar.clear();
    packInto(CBZ.cityPeds, _rowsPed);
    packInto(CBZ.cityCops, _rowsCop);
    packCarsInto(_rowsCar);

    if (net.hasFeat("to")) {
      // per-guest scoped snapshots; scope-exit gone lists replace knownGone
      scopedSnapshots(performance.now());
      knownGone.length = 0;
    } else {
      // legacy server: full broadcast, incremental meta for fresh entities
      if (freshPeds.length || freshCars.length || knownGone.length) {
        net.sendEv({
          e: "meta",
          peds: freshPeds.map(function (p) { return pedMeta(p, (CBZ.cityCops || []).indexOf(p) >= 0); }),
          cars: freshCars.map(carMeta),
          gone: knownGone.splice(0),
        });
      }
      net.send({ t: "world", pd: vals(_rowsPed), cp: vals(_rowsCop), cr: vals(_rowsCar), w: g.wanted | 0 });
    }

    hostRemoteInteractions();
  });

  // The host makes remote players REAL to the NPC world beyond bullets:
  //  - a remote driver's car mows down peds in its path (their car isn't in
  //    our collision sim, so do the one check that matters: fast car vs body)
  //  - a remote player holding a gun out makes nearby unarmed peds surrender
  //    (the same hands-up read the local player gets)
  function hostRemoteInteractions() {
    if (!CBZ.netRemoteList) return;
    const remotes = CBZ.netRemoteList([]);
    for (const R of remotes) {
      if (R.dead) continue;
      // ---- mow-down ----
      if (R.driving && R.carBuf && R.carBuf.length) {
        const c = R.carBuf[R.carBuf.length - 1];
        const v = Math.abs(c.v || 0);
        if (v > 7) {
          const dirx = -Math.sin(c.h), dirz = -Math.cos(c.h);
          for (const p of CBZ.cityPeds || []) {
            if (p.dead || p.ko > 0) continue;
            const dx = p.pos.x - c.x, dz = p.pos.z - c.z;
            if (dx * dx + dz * dz > 6.5) continue;
            if (CBZ.cityKillPed) CBZ.cityKillPed(p, { fromX: c.x - dirx * 2, fromZ: c.z - dirz * 2, force: Math.min(11, v * 0.55), fling: 4 }, "run down");
            if (CBZ.cityCrime) CBZ.cityCrime(70, { x: c.x, z: c.z, type: "hit-and-run" });
          }
          for (const cop of CBZ.cityCops || []) {
            if (cop.dead) continue;
            const dx = cop.pos.x - c.x, dz = cop.pos.z - c.z;
            if (dx * dx + dz * dz > 6.5) continue;
            if (CBZ.cityHurtCop) CBZ.cityHurtCop(cop, Math.min(160, v * 7), { fromX: c.x, fromZ: c.z });
            if (CBZ.cityCrime) CBZ.cityCrime(110, { x: c.x, z: c.z, type: "hit-and-run" });
          }
        }
      }
      // ---- gunpoint: hands up for a remote's drawn gun ----
      if (!R.driving && R.aim && R.armed && R.group && CBZ.cityMarkGunpoint) {
        const h = R.group.rotation.y;
        const fx = -Math.sin(h), fz = -Math.cos(h);
        for (const p of CBZ.cityPeds || []) {
          if (p.dead || p.vendor) continue;
          const dx = p.pos.x - R.pos.x, dz = p.pos.z - R.pos.z;
          const d = Math.hypot(dx, dz);
          if (d > 7 || d < 0.4) continue;
          if ((dx / d) * fx + (dz / d) * fz > 0.6) CBZ.cityMarkGunpoint(p, 1.0);
        }
      }
    }
  }

  // full meta for late joiners (legacy servers only — with feat "to" the
  // scoped pass hands them meta entity-by-entity as things enter their world)
  net.on("join", function (m) {
    if (!net.isHost()) return;
    if (net.hasFeat("to")) return;
    const full = fullMeta();
    full.to = m.id;
    net.sendEv(full);
  });
  net.on("welcome", function () {
    // if WE join as host (first player), nothing to do — entities tag lazily
    metaSentTo.clear();
    scope.clear();
  });
  net.on("leave", function (m) { scope.delete(m.id); });
  net.on("host", function () { scope.clear(); });
  net.on("_offline", function () { scope.clear(); });

  // a guest's bullet arrives: apply it to the authoritative ped/cop
  net.onEv("hit", function (m) {
    if (!net.isHost()) return;
    const R = CBZ.netRemoteActor ? CBZ.netRemoteActor(m.id) : null;
    const fx = R ? R.pos.x : CBZ.player.pos.x, fz = R ? R.pos.z : CBZ.player.pos.z;
    const list = m.k === "cop" ? CBZ.cityCops : CBZ.cityPeds;
    let a = null;
    for (const e of list || []) if (e.nid === m.nid) { a = e; break; }
    if (!a || a.dead) return;
    if (m.k === "cop") {
      if (CBZ.cityHurtCop) CBZ.cityHurtCop(a, m.dmg, { fromX: fx, fromZ: fz });
    } else if (m.nl) {
      if (CBZ.cityKOPed) CBZ.cityKOPed(a, fx, fz);
    } else {
      if (a.gang && CBZ.cityGangProvoke) CBZ.cityGangProvoke(a.gang, 0.4);
      a.hp -= m.dmg;
      if (a.hp <= 0) {
        CBZ.cityKillPed && CBZ.cityKillPed(a, { fromX: fx, fromZ: fz, force: m.melee ? 7 : 6, fling: m.melee ? 4 : 3 }, m.melee ? "beaten to death" : (m.head ? "headshot" : "shot"));
      } else {
        CBZ.body && CBZ.body.hit && CBZ.body.hit(a, { fromX: fx, fromZ: fz, force: m.melee ? 5 : (m.head ? 6.5 : 4.5), knockdown: m.melee && Math.random() < 0.3 ? 1 : 0 });
        const B = (CBZ.CITY && CBZ.CITY.aggro) || {};
        if (!a.rage && R) {
          if (a.armed || a.aggr >= (B.bold || 0.5)) { a.rage = R; a.state = "fight"; a.alarmed = Math.max(a.alarmed || 0, 6); }
          else { a.state = "flee"; a.alarmed = Math.max(a.alarmed || 0, 6); }
        }
      }
    }
    // violence near witnesses raises the SHARED heat, attributed at the attacker's spot
    if (CBZ.cityCrime) CBZ.cityCrime(m.k === "cop" ? 110 : (m.melee ? 22 : 45), { x: fx, z: fz, type: m.melee ? "assault" : "shots-fired" });
    if (CBZ.cityAlarm && R && !m.melee) CBZ.cityAlarm(a.pos.x, a.pos.z, 16, 1, R);
  });

  // car ownership requests
  net.onEv("carReq", function (m) {
    if (!net.isHost()) return;
    const cars = CBZ.cityCars || [];
    let car = null;
    for (const c of cars) if (c.nid === m.nid) { car = c; break; }
    if (!car || car.player || car.npcDriver || car.dead) {
      net.sendEv({ e: "carDeny", to: m.id, nid: m.nid });
      return;
    }
    net.sendEv({
      e: "carGrant", to: m.id, nid: car.nid,
      m: car.model ? car.model.name : 0,
      x: car.pos.x, z: car.pos.z, h: car.heading || 0,
    });
    knownGone.push(car.nid);
    const idx = cars.indexOf(car);
    if (idx >= 0) cars.splice(idx, 1);
    if (car.group && car.group.parent) car.group.parent.remove(car.group);
  });

  net.onEv("carRel", function (m) {
    if (!net.isHost() || !CBZ.cityMakeCar) return;
    const model = (m.m && CBZ.cityEcon && CBZ.cityEcon.carByName) ? CBZ.cityEcon.carByName(m.m) : null;
    try {
      const car = CBZ.cityMakeCar(m.x, m.z, m.h || 0, false, model, 0.3);
      car.ai = false; car.v = 0; car.vx = car.vz = 0; car.stolen = true;
    } catch (e) { console.error("[net] carRel", e); }
  });

  // ---- physics events out to guests ----------------------------------------
  // A body going ragdoll on the host is broadcast so every screen sees the
  // same launch (ragdoll.js calls this); nid rides in BOTH id and nid — the
  // relay stamps the sender into id on broadcast evs.
  const _rp = [0, 0, 0], _rd = [0, 0, 0];
  function pack3(v, out) {
    if (!v) { out[0] = out[1] = out[2] = 0; return out; }
    if (v.x !== undefined) { out[0] = r2(v.x); out[1] = r2(v.y); out[2] = r2(v.z); }
    else { out[0] = r2(v[0]); out[1] = r2(v[1]); out[2] = r2(v[2]); }
    return out;
  }
  function r2(n) { return Math.round((n || 0) * 100) / 100; }
  CBZ.netRagEmit = function (a, p, d, imp) {
    if (!net.isHost() || !a || !a.nid) return;
    net.sendEv({ e: "rag", id: a.nid, nid: a.nid, p: pack3(p, _rp), d: pack3(d, _rd), imp: r2(imp) });
  };

  // every fresh wall hole on the host replicates (cityFracture lands in
  // parallel — poll-assign its onHole from the snapshot tick until it exists)
  let frxHooked = false;
  function hookFracture() {
    if (frxHooked || !CBZ.cityFracture) return;
    frxHooked = true;
    const prev = CBZ.cityFracture.onHole;
    CBZ.cityFracture.onHole = function (hole) {
      if (typeof prev === "function") try { prev(hole); } catch (e) {}
      if (net.isHost()) net.sendEv({ e: "frx", hole });
    };
  }

  // ============================ GUEST SIDE =================================
  const pup = { peds: new Map(), cars: new Map() }; // nid -> puppet
  const pedInfo = new Map(); // nid -> meta {nm,o,s,c,sw}
  const carInfo = new Map(); // nid -> model name

  function makePedPuppet(nid) {
    const info = pedInfo.get(nid) || { nm: "Someone", o: 0x555a66, s: 0xc68642, c: 0 };
    const cop = !!info.c;
    const torso = cop ? (info.sw ? 0x18181f : 0x1d2e55) : info.o;
    const legs = cop ? 0x16213d : 0x2a2e38;
    const ch = CBZ.makeCharacter({ legs, torso, collar: torso, arms: torso, skin: info.s, hair: 0x222222, shoes: 0x2b2b2b });
    const P = {
      nid, netKind: cop ? "cop" : "ped", kind: cop ? "cop" : "civilian",
      name: info.nm, char: ch, ch, group: ch.group, pos: ch.group.position,
      hp: 100, dead: false, ko: 0, buf: [], _deadPosed: false,
    };
    if (CBZ.makeLabelSprite) {
      P.tag = CBZ.makeLabelSprite(info.nm, { color: cop ? "#9fc3ff" : "#e7ecf6" });
      P.tag.position.y = 3.0; P.tag.scale.set(2.6, 0.65, 1); P.tag.visible = false;
      ch.group.add(P.tag);
    }
    const root = CBZ.city && CBZ.city.arena && CBZ.city.arena.root;
    if (root) root.add(ch.group);
    pup.peds.set(nid, P);
    return P;
  }

  function makeCarPuppet(nid) {
    let vis = null;
    try { vis = CBZ.cityBuildAmbientCarVisual ? CBZ.cityBuildAmbientCarVisual(carInfo.get(nid) || undefined) : null; } catch (e) {}
    if (!vis) return null;
    const root = CBZ.city && CBZ.city.arena && CBZ.city.arena.root;
    if (root) root.add(vis);
    const C = { nid, group: vis, buf: [], lastSeen: performance.now() };
    pup.cars.set(nid, C);
    return C;
  }

  function dropPedPuppet(nid) {
    const P = pup.peds.get(nid);
    if (P && P.group && P.group.parent) P.group.parent.remove(P.group);
    pup.peds.delete(nid);
  }
  function dropCarPuppet(nid) {
    const C = pup.cars.get(nid);
    if (C && C.group && C.group.parent) C.group.parent.remove(C.group);
    pup.cars.delete(nid);
  }
  function clearAllPuppets() {
    for (const nid of [...pup.peds.keys()]) dropPedPuppet(nid);
    for (const nid of [...pup.cars.keys()]) dropCarPuppet(nid);
    pedInfo.clear(); carInfo.clear();
  }
  net.on("_clearPuppets", clearAllPuppets);
  net.on("_offline", clearAllPuppets);

  net.onEv("meta", function (m) {
    if (!net.guest()) return;
    for (const p of m.peds || []) pedInfo.set(p.i, p);
    for (const c of m.cars || []) carInfo.set(c.i, c.m);
    for (const nid of m.gone || []) { dropPedPuppet(nid); dropCarPuppet(nid); }
  });

  // hitscan targets for the guest's gun (shootable puppets)
  CBZ.netPuppetTargets = function (out) {
    if (!net.guest()) return out;
    for (const P of pup.peds.values()) if (!P.dead && P.group) out.push(P);
    return out;
  };
  // puppet lookup for net-driven physics (ragdoll.js maps a rag event's id to
  // a rig: puppets expose the same ch/char/group/pos surface as a real ped)
  CBZ.netPuppetByNid = function (nid) { return pup.peds.get(nid) || null; };

  // host ragdolled a ped: launch the same puppet here instead of letting it
  // glide on interp — the kill should look as violent on every screen
  const _rv1 = new THREE.Vector3(), _rv2 = new THREE.Vector3();
  net.onEv("rag", function (m) {
    if (!net.guest() || g.mode !== "city") return;
    const nid = m.nid != null ? m.nid : m.id;
    const P = pup.peds.get(nid);
    if (!P) return;
    P.dead = true;      // the rag ev outruns the snapshot row that flips the flag
    P.netRag = true;    // physics owns the body now — interp lets go
    let ok = false;
    if (CBZ.cityRagdollNet) try { ok = !!CBZ.cityRagdollNet(P, m.p, m.d, m.imp || 0); } catch (e) {}
    if (!ok && P.ch && CBZ.cityRagdoll && m.p && m.d) {
      _rv1.set(m.p[0] || 0, m.p[1] || 0, m.p[2] || 0);
      _rv2.set(m.d[0] || 0, m.d[1] || 0, m.d[2] || 0);
      try { ok = !!CBZ.cityRagdoll(P, _rv1, _rv2, m.imp || 0); } catch (e) {}
    }
    if (!ok) P.netRag = false; // no ragdoll took the body — interp + deathPose keep it
  });

  // host blew a hole in a wall: stamp the same hole here
  net.onEv("frx", function (m) {
    if (!net.guest() || !m.hole) return;
    if (CBZ.cityFracture && CBZ.cityFracture.applyOne) try { CBZ.cityFracture.applyOne(m.hole); } catch (e) {}
  });

  net.on("world", function (m) {
    if (!net.guest() || g.mode !== "city") return;
    const now = performance.now();
    const seen = new Set();
    const eat = function (rows) {
      for (const r of rows || []) {
        const nid = r[0];
        seen.add(nid);
        let P = pup.peds.get(nid);
        if (!P) {
          if (!CBZ.makeCharacter) continue;
          P = makePedPuppet(nid);
          P.group.position.set(r[1], 0, r[2]); // born in place — no one-frame pop at origin
          P.group.rotation.y = r[3] || 0;
        }
        P.buf.push({ t: now, x: r[1], z: r[2], h: r[3], s: r[4] });
        if (P.buf.length > 8) P.buf.splice(0, P.buf.length - 8);
        const fl = r[5] | 0;
        P.hp = r[6];
        P.ko = (fl & 4) ? 1 : 0;
        if (P.ch) P.ch.handsUp = !!(fl & 2);
        if (!P.dead && (fl & 1)) {
          P.dead = true;
          if (!P._deadPosed && CBZ.deathPose) { CBZ.deathPose(P.ch, nid); P._deadPosed = true; }
          if (P.tag) P.tag.visible = false;
        }
      }
    };
    eat(m.pd); eat(m.cp);
    for (const r of m.cr || []) {
      const nid = r[0];
      seen.add(nid);
      let C = pup.cars.get(nid);
      if (!C) {
        C = makeCarPuppet(nid);
        if (!C) continue;
        C.group.position.set(r[1], 0, r[2]);
        C.group.rotation.y = r[3] || 0;
      }
      C.lastSeen = now;
      C.buf.push({ t: now, x: r[1], z: r[2], h: r[3], v: r[4] });
      if (C.buf.length > 8) C.buf.splice(0, C.buf.length - 8);
    }
    // anything the host stopped reporting for a while is gone (despawn/grant)
    for (const [nid, P] of pup.peds) if (!seen.has(nid) && now - (P._lastSeen || (P._lastSeen = now)) > 4000) dropPedPuppet(nid);
    for (const [nid] of pup.cars) if (!seen.has(nid)) { const C = pup.cars.get(nid); if (now - C.lastSeen > 4000) dropCarPuppet(nid); }
    for (const nid of seen) { const P = pup.peds.get(nid); if (P) P._lastSeen = now; }
    // shared heat: stars shown on the guest HUD mirror the host's world
    g.wanted = m.w | 0;
  });

  // puppet interpolation/animation (+ capped extrapolation past the newest
  // sample so a late snapshot reads as motion, not a stutter-freeze)
  function sample(buf, t) {
    if (!buf.length) return null;
    if (buf.length === 1 || t <= buf[0].t) return buf[0];
    const last = buf[buf.length - 1];
    if (t > last.t) {
      const prev = buf[buf.length - 2];
      const span = Math.max(1, last.t - prev.t);
      const k = Math.min(250, t - last.t) / span;
      let dh = (last.h - prev.h) % (Math.PI * 2);
      if (dh > Math.PI) dh -= Math.PI * 2;
      if (dh < -Math.PI) dh += Math.PI * 2;
      return { x: last.x + (last.x - prev.x) * k, z: last.z + (last.z - prev.z) * k, h: last.h + dh * Math.min(1, k), s: last.s, v: last.v };
    }
    for (let i = buf.length - 1; i >= 0; i--) {
      if (buf[i].t <= t) {
        const a = buf[i], b = buf[i + 1];
        if (!b) return a;
        const k = Math.min(1, (t - a.t) / Math.max(1, b.t - a.t));
        let dh = (b.h - a.h) % (Math.PI * 2);
        if (dh > Math.PI) dh -= Math.PI * 2;
        if (dh < -Math.PI) dh += Math.PI * 2;
        return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, h: a.h + dh * k, s: a.s, v: a.v };
      }
    }
    return buf[buf.length - 1];
  }

  if (CBZ.onAlways) CBZ.onAlways(46.3, function (dt) {
    if (!net.guest() || g.mode !== "city") return;
    const t = performance.now() - INTERP_MS;
    const P0 = CBZ.player;
    for (const P of pup.peds.values()) {
      if (P.netRag) continue; // ragdoll physics owns this body now
      const s = sample(P.buf, t);
      if (!s) continue;
      P.group.position.set(s.x, 0, s.z);
      if (!P.dead) {
        P.group.rotation.y = s.h;
        if (CBZ.animChar) CBZ.animChar(P.ch, s.s || 0, dt);
        if (P.tag) {
          const d = Math.hypot(s.x - P0.pos.x, s.z - P0.pos.z);
          P.tag.visible = d < 18;
        }
      }
    }
    for (const C of pup.cars.values()) {
      const s = sample(C.buf, t);
      if (!s) continue;
      C.group.position.set(s.x, 0, s.z);
      C.group.rotation.y = s.h;
    }
  });

  // ---- guest car entry: ownership request ---------------------------------
  let pendingCar = 0;
  function nearestPuppetCar(x, z, maxd) {
    let best = null, bd = maxd * maxd;
    for (const C of pup.cars.values()) {
      const dx = C.group.position.x - x, dz = C.group.position.z - z;
      const dd = dx * dx + dz * dz;
      if (dd < bd) { bd = dd; best = C; }
    }
    return best;
  }

  addEventListener("keydown", function (e) {
    if (!net.guest() || g.mode !== "city" || g.state !== "playing") return;
    if (e.key.toLowerCase() !== "f" || e.repeat || CBZ.player.driving || pendingCar) return;
    const C = nearestPuppetCar(CBZ.player.pos.x, CBZ.player.pos.z, 4.0);
    if (!C) return;
    pendingCar = C.nid;
    net.sendEv({ e: "carReq", to: net.hostId, nid: C.nid });
    setTimeout(function () { pendingCar = 0; }, 1500);
  });

  net.onEv("carGrant", function (m) {
    pendingCar = 0;
    if (!net.guest() || !CBZ.cityMakeCar) return;
    dropCarPuppet(m.nid);
    const model = (m.m && CBZ.cityEcon && CBZ.cityEcon.carByName) ? CBZ.cityEcon.carByName(m.m) : null;
    try {
      const car = CBZ.cityMakeCar(m.x, m.z, m.h || 0, false, model, 0);
      car.ai = false; car._netOwned = true; car.stolen = true;
      if (CBZ.cityEnterVehicle) CBZ.cityEnterVehicle(car);
    } catch (e) { console.error("[net] carGrant", e); }
  });
  net.onEv("carDeny", function () {
    pendingCar = 0;
    if (CBZ.city && CBZ.city.note) CBZ.city.note("Someone beat you to that car", 1.4);
  });

  // returning the car to the host sim on exit. The car you step out of stays
  // VISIBLE as a local "ghost" until the host's re-created car shows up in the
  // snapshot stream (or 2.5s passes) — no blink-out-of-existence.
  let ghost = null; // {group, x, z, until}
  function hookExit() {
    if (!CBZ.cityExitVehicle || CBZ.cityExitVehicle._netWrapped) return;
    const orig = CBZ.cityExitVehicle;
    const wrapped = function () {
      const car = CBZ.player._vehicle;
      orig();
      if (net.guest() && car && car._netOwned) {
        net.sendEv({ e: "carRel", to: net.hostId, m: car.model ? car.model.name : 0, x: car.pos.x, z: car.pos.z, h: car.heading || 0 });
        const idx = (CBZ.cityCars || []).indexOf(car);
        if (idx >= 0) CBZ.cityCars.splice(idx, 1);
        if (car.group) {
          if (ghost && ghost.group && ghost.group.parent) ghost.group.parent.remove(ghost.group);
          ghost = { group: car.group, x: car.pos.x, z: car.pos.z, until: performance.now() + 2500 };
        }
      }
    };
    wrapped._netWrapped = true;
    CBZ.cityExitVehicle = wrapped;
  }
  if (typeof addEventListener === "function") addEventListener("load", hookExit);
  setTimeout(hookExit, 0);

  function dropGhostIfCovered(now) {
    if (!ghost) return;
    let covered = now > ghost.until;
    if (!covered) {
      for (const C of pup.cars.values()) {
        const dx = C.group.position.x - ghost.x, dz = C.group.position.z - ghost.z;
        if (dx * dx + dz * dz < 16) { covered = true; break; }
      }
    }
    if (covered) {
      if (ghost.group && ghost.group.parent) ghost.group.parent.remove(ghost.group);
      ghost = null;
    }
  }

  // ---- COLLISIONS: networked bodies are SOLID -------------------------------
  // The local sim never sees puppet cars / remote players, so without this you
  // phase through your friend and through every host-synced car — the #1
  // "feels glitchy" read. Cheap push-outs after movement resolves:
  //   on foot: circle-vs-remote-player + circle-vs-oriented-car-box (puppet
  //   cars on guests, every remote driver's car everywhere) — and a FAST car
  //   that catches you runs you down for real.
  let runOverCD = 0;
  function pushOutOfCar(P, cx, cz, h, dims, v) {
    const hw = ((dims && dims.width) || 2.0) * 0.5 + 0.42;   // + player radius
    const hl = ((dims && dims.length) || 4.4) * 0.5 + 0.42;
    const s = Math.sin(h), c = Math.cos(h);
    const dx = P.pos.x - cx, dz = P.pos.z - cz;
    // world -> car-local frame (inverse of a Three.js rotation.y by h)
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    if (Math.abs(lx) >= hw || Math.abs(lz) >= hl) return false;
    // push along the axis of least penetration, rotated back to world
    const px = hw - Math.abs(lx), pz = hl - Math.abs(lz);
    if (px < pz) {
      const d = lx >= 0 ? px : -px;
      P.pos.x += d * c;
      P.pos.z += -d * s;
    } else {
      const d = lz >= 0 ? pz : -pz;
      P.pos.x += d * s;
      P.pos.z += d * c;
    }
    // a fast car that reaches you = run down
    if (Math.abs(v || 0) > 7 && runOverCD <= 0) {
      runOverCD = 0.9;
      const vmag = Math.abs(v);
      if (CBZ.cityHurtPlayer) CBZ.cityHurtPlayer(Math.min(150, 10 + vmag * 4.5), cx, cz, "run over", false, null, vmag < 16);
      if (CBZ.body && CBZ.body.knockdown && CBZ.city && CBZ.city.playerActor && !CBZ.body.busy(CBZ.city.playerActor)) {
        CBZ.body.knockdown(CBZ.city.playerActor, { fromX: cx, fromZ: cz, force: Math.min(10, vmag * 0.5), t: 1.1 });
      }
    }
    return true;
  }

  if (CBZ.onUpdate) CBZ.onUpdate(45.6, function (dt) {
    if (!net.active || g.mode !== "city") return;
    runOverCD -= dt;
    dropGhostIfCovered(performance.now());
    const P = CBZ.player;
    if (P.dead || P.driving) return;
    // remote players are solid
    if (CBZ.netRemoteList) {
      for (const R of CBZ.netRemoteList([])) {
        if (R.dead || R.driving || !R.group) continue;
        const dx = P.pos.x - R.group.position.x, dz = P.pos.z - R.group.position.z;
        const d2 = dx * dx + dz * dz;
        const min = 0.8;
        if (d2 > 0.0001 && d2 < min * min) {
          const d = Math.sqrt(d2), push = (min - d);
          P.pos.x += (dx / d) * push;
          P.pos.z += (dz / d) * push;
        }
      }
      // a remote driver's car is solid AND dangerous
      for (const R of CBZ.netRemoteList([])) {
        if (!R.driving || !R.carVis) continue;
        const dims = R.carVis.userData && R.carVis.userData.vehicleDims;
        const last = R.carBuf && R.carBuf.length ? R.carBuf[R.carBuf.length - 1] : null;
        pushOutOfCar(P, R.carVis.position.x, R.carVis.position.z, R.carVis.rotation.y, dims, last ? last.v : 0);
      }
    }
    // puppet traffic is solid (guests; the host's real cars already collide)
    if (net.guest()) {
      for (const C of pup.cars.values()) {
        const dims = C.group.userData && C.group.userData.vehicleDims;
        const last = C.buf.length ? C.buf[C.buf.length - 1] : null;
        pushOutOfCar(P, C.group.position.x, C.group.position.z, C.group.rotation.y, dims, last ? last.v : 0);
      }
    }
  });
})();
