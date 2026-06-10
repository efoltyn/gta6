/* ============================================================
   net/networld.js — the shared LIVING CITY. FiveM-style split:
   the elected sim-host's browser runs the real NPC/traffic/cop
   simulation (all 400 Math.randoms stay right where they are)
   and broadcasts:
     - meta  (reliable, on join + as entities appear): who each
       ped IS — name, outfit colors, cop-ness; which car model
     - world (10Hz): positions/heading/speed/hp/flags for every
       ped, cop and car
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

  function packPeds(list) {
    const out = [];
    for (const p of list) {
      if (!p.nid || !p.group) continue;
      let fl = 0;
      if (p.dead) fl |= 1;
      if (p.char && p.char.handsUp) fl |= 2;
      if (p.ko > 0) fl |= 4;
      out.push([
        p.nid,
        Math.round(p.pos.x * 10) / 10, Math.round(p.pos.z * 10) / 10,
        Math.round((p.group.rotation.y || 0) * 100) / 100,
        Math.round((p.speed || 0) * 10) / 10,
        fl, Math.round(p.hp || 0),
      ]);
    }
    return out;
  }

  function packCars() {
    const out = [];
    for (const c of CBZ.cityCars || []) {
      if (!c.nid || c.dead) continue;
      if (c.player) continue; // the host's own driven car rides its state stream
      out.push([
        c.nid,
        Math.round(c.pos.x * 10) / 10, Math.round(c.pos.z * 10) / 10,
        Math.round((c.heading || 0) * 100) / 100, Math.round((c.v || 0) * 10) / 10,
      ]);
    }
    return out;
  }

  if (CBZ.onAlways) CBZ.onAlways(61, function (dt) {
    if (!net.isHost() || g.mode !== "city" || g.state === "title") return;
    snapAcc += dt;
    if (snapAcc < 1 / SNAP_HZ) return;
    snapAcc = 0;

    const freshPeds = [], freshCars = [];
    tagNew(CBZ.cityPeds || [], false, freshPeds, null);
    tagNew(CBZ.cityCops || [], true, freshPeds, null);
    for (const c of CBZ.cityCars || []) if (!c.nid) { c.nid = nextNid++; freshCars.push(c); }

    // incremental meta for entities born since the last tick
    if (freshPeds.length || freshCars.length || knownGone.length) {
      net.sendEv({
        e: "meta",
        peds: freshPeds.map(function (p) { return pedMeta(p, (CBZ.cityCops || []).indexOf(p) >= 0); }),
        cars: freshCars.map(carMeta),
        gone: knownGone.splice(0),
      });
    }

    net.send({ t: "world", pd: packPeds(CBZ.cityPeds || []), cp: packPeds(CBZ.cityCops || []), cr: packCars(), w: g.wanted | 0 });

    // remote drivers mow down host-simulated peds (their car isn't in our
    // collision sim, so do the one check that matters: fast car vs body)
    for (const R of (CBZ.netRemoteTargetsAll ? CBZ.netRemoteTargetsAll() : [])) { /* reserved */ }
  });

  // full meta for late joiners
  net.on("join", function (m) {
    if (!net.isHost()) return;
    const full = fullMeta();
    full.to = m.id;
    net.sendEv(full);
  });
  net.on("welcome", function () {
    // if WE join as host (first player), nothing to do — entities tag lazily
    metaSentTo.clear();
  });

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
        CBZ.cityKillPed && CBZ.cityKillPed(a, { fromX: fx, fromZ: fz, force: 6, fling: 3 }, m.head ? "headshot" : "shot");
      } else {
        CBZ.body && CBZ.body.hit && CBZ.body.hit(a, { fromX: fx, fromZ: fz, force: m.head ? 6.5 : 4.5 });
        const B = (CBZ.CITY && CBZ.CITY.aggro) || {};
        if (!a.rage && R) {
          if (a.armed || a.aggr >= (B.bold || 0.5)) { a.rage = R; a.state = "fight"; a.alarmed = Math.max(a.alarmed || 0, 6); }
          else { a.state = "flee"; a.alarmed = Math.max(a.alarmed || 0, 6); }
        }
      }
    }
    // gunfire near witnesses raises the SHARED heat, attributed at the shooter's spot
    if (CBZ.cityCrime) CBZ.cityCrime(m.k === "cop" ? 110 : 45, { x: fx, z: fz, type: "shots-fired" });
    if (CBZ.cityAlarm && R) CBZ.cityAlarm(a.pos.x, a.pos.z, 16, 1, R);
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

  net.on("world", function (m) {
    if (!net.guest() || g.mode !== "city") return;
    const now = performance.now();
    const seen = new Set();
    const eat = function (rows) {
      for (const r of rows || []) {
        const nid = r[0];
        seen.add(nid);
        let P = pup.peds.get(nid);
        if (!P) { if (!CBZ.makeCharacter) continue; P = makePedPuppet(nid); }
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
      let C = pup.cars.get(nid) || makeCarPuppet(nid);
      if (!C) continue;
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

  // puppet interpolation/animation
  function sample(buf, t) {
    if (!buf.length) return null;
    if (buf.length === 1 || t <= buf[0].t) return buf[0];
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

  // returning the car to the host sim on exit
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
        if (car.group && car.group.parent) car.group.parent.remove(car.group);
      }
    };
    wrapped._netWrapped = true;
    CBZ.cityExitVehicle = wrapped;
  }
  if (typeof addEventListener === "function") addEventListener("load", hookExit);
  setTimeout(hookExit, 0);
})();
