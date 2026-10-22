/* ============================================================
   city/cartrunk.js — A MAN IN THE TRUNK.

   OWNER: "when I press [the vehicle key] but I'm holding a person over my
   shoulder, it should put them in the trunk or backseat, my character should
   physically open and throw them in."

   Every saloon, hatch, SUV and cruiser now has a lid that opens
   (playercars.js loftLid: the deck — and on a hatch or an SUV the backlight
   — cut out of the shell by carbody.js cutLid, hinged at the backlight base
   or at the roof) and a real black trunk under it. A pickup has its open bed.
   This file is what the trunk is FOR:

     WHERE     CBZ.carTrunk.of(car): the space a curled body fits in, in the
               car's own frame — the boot box, a tailgate car's cargo floor
               behind the last row (a seven-seater folds its third row), a
               pickup's bed — and where you stand to use it.
     THE LID   it stays where it is put: open, it is open (nobody's sweep
               shuts it); CBZ.carTrunk.lid(car, 1|0) swings it.
     IN        CBZ.carTrunk.put(ped, car): he is thrown in off your shoulder
               (a short arc into the box), curled on his side, held there by
               npclife as a seat is held — parented to the car, so he goes
               where it goes. city/restrain.js's stow walks you to the trunk,
               lifts the lid, puts him in and slams it.
     RIDING    he is hidden by the car itself, not by a flag: the lid is shut
               over him (his shadow is off: a box does not cast a man). Awake,
               he hammers on the lid and shouts through it (CBZ.voice
               "trunk"); the lid jumps with each blow.
     OUT       E at the trunk opens it; "Take out" lifts him out onto the
               road. Open it on a man who is awake and not tied and he climbs
               out and runs.
     THE CAR   what happens to the car happens to him: a hard crash hurts
               him (a worse one kills him), a car that goes under drowns him,
               a car that burns burns him.
     THE LAW   an officer standing by a stopped car with somebody hammering
               inside it hears it, walks round to the trunk, opens it and lets
               him out; the car's owner has a kidnapping on him.

   Works wherever the cars are (Gang City and the islands: CBZ.economyMode).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  function econ() { return !!(CBZ.economyMode && CBZ.economyMode()); }
  function frameOf(car) {
    const grp = car && car.group;
    return grp ? ((grp.userData && grp.userData.carVisual) || grp) : null;
  }
  function live(car) { return !!(car && !car._scrapped && car.group && car.group.parent); }
  function VT() { const v = CBZ.vitals; return v && v.kill ? v : null; }
  function awake(p) {
    if (!p || p.dead) return false;
    if ((p.ko || 0) > 0) return false;
    const v = CBZ.vitals;
    if (v && v.conscious) { try { return !!v.conscious(p); } catch (e) {} }
    return true;
  }
  function tied(p) { return !!(p && p.char && p.char.cuffed); }
  function sfxAt(n, x, z, o) { if (CBZ.sfxAt) { try { CBZ.sfxAt(n, x, z, o); } catch (e) {} } }

  const _v = new THREE.Vector3(), _m = new THREE.Matrix4();
  function toWorld(car, lx, ly, lz, out) {
    const f = frameOf(car); if (!f) return null;
    f.updateWorldMatrix(true, false);
    return (out || _v).set(lx, ly, lz).applyMatrix4(f.matrixWorld);
  }
  function toLocal(car, wx, wy, wz, out) {
    const f = frameOf(car); if (!f) return null;
    f.updateWorldMatrix(true, false);
    _m.copy(f.matrixWorld).invert();
    return (out || _v).set(wx, wy, wz).applyMatrix4(_m);
  }

  /* ============================================================
     WHERE A BODY GOES — per body style, in the car visual's frame
     (+Z the nose, +X the car's left, y up from the ground)
     ============================================================ */
  // a curled body lying across the car is ~1.2 m long (knees up) and
  // ~0.45 m front to back; anything smaller fits him scaled to it
  const CURL_LEN = 1.2, CURL_DEPTH = 0.42;
  function specOf(car) {
    const f = frameOf(car);
    if (!f || !f.userData) return null;
    if (car._trunkSpec && car._trunkSpec.f === f) return car._trunkSpec.s;
    const s = buildSpec(car, f);
    car._trunkSpec = { f: f, s: s };
    return s;
  }
  function buildSpec(car, f) {
    const L = CBZ.carLid ? CBZ.carLid(car) : null;
    const ctx = f.userData.partCtx || {};
    const zTail = ctx.rearZ != null ? ctx.rearZ : (L ? L.cavity.z0 - 0.03 : null);
    if (L && zTail != null) {
      const C = L.cavity;
      if (L.kind === "boot") {
        const z0 = C.z0, z1 = C.z1;
        let zc = (z0 + z1) / 2, half = C.halfX;
        // the wheel tubs narrow the box where they reach in: lie him clear of them
        if (C.tub && zc > C.tub.z0 - 0.15) {
          const clear = C.tub.z0 - 0.04 - z0;
          if (clear >= CURL_DEPTH) zc = z0 + clear / 2;
          else half = Math.min(half, C.tub.x - 0.02);
        }
        return { kind: "boot", lid: true, cap: 1, floorY: C.floorY, zc: zc, depth: z1 - z0, halfX: half,
          stand: { x: 0, z: zTail - 0.62 }, top: { x: 0, y: L.hy, z: zTail + 0.1 }, fold: null };
      }
      // A TAILGATE opens onto the cargo floor behind the last row of seats
      const S = CBZ.carSeats && CBZ.carSeats.of(car);
      const ci = S && S.ci;
      if (ci) {
        let lastRow = 0;
        for (let i = 0; i < S.seats.length; i++) lastRow = Math.max(lastRow, S.seats[i].row | 0);
        const row = S.seats.filter(function (st) { return (st.row | 0) === lastRow; });
        const rowZ = Math.min.apply(null, row.map(function (st) { return st.z; }));
        const back = rowZ - 0.34, front = C.z0 + 0.02;
        const half = Math.max(0.45, (ci.w || 1.7) / 2 - 0.14);
        if (back - front >= CURL_DEPTH || lastRow < 2) {
          return { kind: "gate", lid: true, cap: 1, floorY: ci.floorY != null ? ci.floorY : C.floorY,
            zc: (front + Math.max(front + CURL_DEPTH, back)) / 2, depth: back - front, halfX: half,
            stand: { x: 0, z: zTail - 0.62 }, top: { x: 0, y: L.cutY + 0.2, z: zTail + 0.1 }, fold: null };
        }
        // a seven-seater: the third row folds flat and he lies across it
        const cush = Math.max.apply(null, row.map(function (st) { return st.cushionY || 0; }));
        return { kind: "gate", lid: true, cap: 1, floorY: Math.max(ci.floorY || 0, cush - 0.06),
          zc: rowZ - 0.05, depth: CURL_DEPTH + 0.1, halfX: half,
          stand: { x: 0, z: zTail - 0.62 }, top: { x: 0, y: L.cutY + 0.2, z: zTail + 0.1 },
          fold: row.map(function (st) { return st.id; }) };
      }
      return null;
    }
    // A PICKUP'S BED: open to the sky, so anybody can see what is in it
    const bed = ctx.bed;
    if (bed && zTail != null) {
      return { kind: "bed", lid: false, cap: 2, floorY: bed.floorY, zc: (bed.z0 + bed.z1) / 2,
        depth: bed.z1 - bed.z0, halfX: bed.halfX, stand: { x: 0, z: zTail - 0.62 },
        top: { x: 0, y: bed.floorY + 0.4, z: zTail + 0.3 }, fold: null };
    }
    return null;
  }
  // the pose a body holds in it: on his side across the car, head to the
  // driver's side, face to the lid, knees up (character.js lying.tight)
  function anchorFor(T, i, ch) {
    const hs = (ch && ch.group && ch.group.userData && ch.group.userData.humanScale) || 1;
    const room = T.halfX * 2 - 0.1;
    const scale = Math.max(0.72, Math.min(1, room / (CURL_LEN * hs), T.depth > 0 ? Math.max(0.8, T.depth / CURL_DEPTH) : 1));
    const span = CURL_LEN * hs * scale;
    // two in a bed lie one behind the other
    const dz = T.cap > 1 ? (i === 0 ? 0.32 : -0.32) : 0;
    return {
      x: -span / 2, y: T.floorY + 0.15 * scale * hs, z: T.zc + 0.08 + dz,
      yaw: Math.PI, roll: Math.PI / 2, pitch: 0,
      pose: "lie", state: "sit", scale: scale,
    };
  }

  /* ============================================================
     THE STATE — one record per car that has somebody (or an open lid)
     ============================================================ */
  const cars = [];
  function stateOf(car, make) {
    if (car._trunk) return car._trunk;
    if (!make) return null;
    car._trunk = { peds: [], openT: CBZ.carLidOpenT ? CBZ.carLidOpenT(car) : 0, want: 0, lastV: 0,
      thumpT: 2 + Math.random() * 2, jolt: 0, copCD: 0, cop: null, seenT: 0 };
    if (cars.indexOf(car) < 0) cars.push(car);
    return car._trunk;
  }
  function room(car) {
    const T = specOf(car); if (!T) return false;
    const st = car._trunk;
    return !st || st.peds.length < T.cap;
  }
  function lid(car, want) {
    const T = specOf(car);
    if (!T || !T.lid) return false;
    const st = stateOf(car, true);
    st.want = want ? 1 : 0;
    return true;
  }
  function lidOpen(car) { const st = car && car._trunk; return st ? st.openT : (CBZ.carLidOpenT ? CBZ.carLidOpenT(car) : 0); }
  function shadows(p, on) {
    if (!p || !p.group) return;
    p.group.traverse(function (o) {
      if (!o.isMesh) return;
      if (on) { if (o.userData._trunkCast != null) { o.castShadow = o.userData._trunkCast; delete o.userData._trunkCast; } }
      else if (o.userData._trunkCast == null) { o.userData._trunkCast = !!o.castShadow; o.castShadow = false; }
    });
  }

  /* ---- IN ---------------------------------------------------------------- */
  function put(p, car, opts) {
    opts = opts || {};
    const NL = CBZ.npcLife;
    const T = specOf(car), f = frameOf(car);
    if (!T || !f || !NL || !NL.attach || !p || !p.group || !p.char) return false;
    if (p._inTrunk || !room(car)) return false;
    const st = stateOf(car, true);
    // where he is now, in the car's frame: the throw starts there
    p.group.updateWorldMatrix(true, false);
    const gw = new THREE.Vector3().setFromMatrixPosition(p.group.matrixWorld);
    const from = toLocal(car, gw.x, gw.y, gw.z, new THREE.Vector3());
    const V = CBZ.verbs, S = V && V.sessionOf ? V.sessionOf(p) : null;
    if (S && S.cancel) { try { S.cancel(); } catch (e) {} }
    if (CBZ.bodyFall && CBZ.bodyFall.active && CBZ.bodyFall.active(p) && CBZ.bodyFall.clear) CBZ.bodyFall.clear(p);
    const a = anchorFor(T, st.peds.length, p.char);
    p._seatHold = true;
    let ok = false;
    try { ok = !!NL.attach(p, f, Object.assign({}, a, { x: from.x, y: from.y, z: from.z })); } catch (e) { ok = false; }
    if (!ok) return false;
    p.inCar = car;
    p._inTrunk = car;
    p.controlled = true;
    p._spawnHidden = false;
    p.group.visible = true;
    p.state = "sit"; p.speed = 0; p.path = null; p.rage = null;
    p.char.lying = { back: false, fold: true, vary: 0.7, phase: Math.random() * 6.28, tight: true };
    p.char.handsUp = false;
    p._trunkTw = { t: 0, from: { x: from.x, y: from.y, z: from.z }, to: a };
    p._trunkWater = 0; p._trunkBang = 0; p._trunkEsc = 0;
    shadows(p, false);
    st.peds.push(p);
    st.thumpT = 2.5 + Math.random() * 2;
    if (T.fold && CBZ.carSeats && CBZ.carSeats.claim) {
      for (let i = 0; i < T.fold.length; i++) {
        if (!CBZ.carSeats.occupant(car, T.fold[i])) CBZ.carSeats.claim(car, T.fold[i], { kind: "npc", ref: p });
      }
    }
    if (CBZ.sfxAt && p.pos) sfxAt("hit", p.pos.x, p.pos.z, { volume: 0.5 });
    return true;
  }

  /* ---- OUT --------------------------------------------------------------- */
  // opts.flee: he climbs out himself and runs; opts.at {x,z}: put down there
  function out(p, opts) {
    opts = opts || {};
    const car = p && p._inTrunk;
    if (!car) return false;
    const st = car._trunk;
    if (st) { const i = st.peds.indexOf(p); if (i >= 0) st.peds.splice(i, 1); }
    const T = live(car) ? specOf(car) : null;
    if (T && T.fold && CBZ.carSeats && CBZ.carSeats.occupant) {
      for (let i = 0; i < T.fold.length; i++) {
        const o = CBZ.carSeats.occupant(car, T.fold[i]);
        if (o && o.ref === p) CBZ.carSeats.release(car, T.fold[i]);
      }
    }
    let at = opts.at || null;
    if (!at && T) { const w = toWorld(car, T.stand.x + (Math.random() - 0.5) * 0.6, 0, T.stand.z - 0.2); if (w) at = { x: w.x, z: w.z }; }
    if (!at) at = { x: (car.pos && car.pos.x) || p.pos.x, z: (car.pos && car.pos.z) || p.pos.z };
    if (p.char) { p.char.lying = null; p.char.sitting = false; }
    p._trunkTw = null; p._trunkOutTw = null;
    if (CBZ.cityUnseat) { try { CBZ.cityUnseat(p, { x: at.x, z: at.z, ground: true, state: p.dead ? "dead" : "walk" }); } catch (e) {} }
    else if (CBZ.npcLife && CBZ.npcLife.detach) CBZ.npcLife.detach(p, { state: p.dead ? "dead" : "walk" });
    if (p.group) {
      const yaw = car.heading != null ? car.heading + Math.PI : p.group.rotation.y;
      // a body comes out lying on its side; a living man on his feet
      p.group.rotation.set(0, yaw, p.dead ? Math.PI / 2 : 0);
      if (p.dead && p.pos) { p.pos.y += 0.15; p.group.position.copy(p.pos); }
      p.group.scale.setScalar(1);
      p.group.visible = true;
    }
    shadows(p, true);
    p.inCar = false;
    p._inTrunk = null;
    p._seatHold = undefined;
    // the restraint record that put him there ends with the trunk
    const r = p.restraint;
    if (r && r.trunk) {
      if (CBZ.cityRestrain && CBZ.cityRestrain.release) { r.state = "cuffed"; r.vehicle = null; r.trunk = false; if (r.loose) CBZ.cityRestrain.release(p, { silent: true }); }
      else p.restraint = null;
    }
    if (p.dead) return true;
    if (!awake(p)) {
      // out cold: he is laid on the road where he was lifted out
      if (CBZ.body && CBZ.body.hit) { try { CBZ.body.hit(p, { dir: { x: 0, z: 0 }, force: 0.5, knockdown: Math.max(1.5, p.ko || 0) }); } catch (e) {} }
      return true;
    }
    p.controlled = false;
    if (opts.flee) {
      p.fear = Math.max(p.fear || 0, 10); p.alarmed = 8; p.state = "flee";
      if (CBZ.voice && CBZ.voice.react) { try { CBZ.voice.react(p, "dropped", { by: CBZ.city && CBZ.city.playerActor }); } catch (e) {} }
    } else { p.fear = Math.max(p.fear || 0, 6); p.state = "flee"; }
    return true;
  }
  /* OUT OVER THE SILL, not out of thin air: the throw in, backwards. He
     rises out of the box and lands on the road behind the car (on his feet
     if he can stand, laid down if he cannot), then the car lets him go. */
  function lift(p, opts) {
    const car = p && p._inTrunk, rec = p && p._npcAttached;
    if (!car || p._trunkOutTw) return false;
    const T = live(car) ? specOf(car) : null;
    if (!rec || !rec.anchor || !T) return out(p, opts);
    const a = rec.anchor;
    p._trunkTw = null;
    const up = !p.dead && awake(p);
    if (up && p.char) p.char.lying = null;
    p._trunkOutTw = { t: 0, up: up, opts: opts || {},
      from: { x: a.x, y: a.y, z: a.z, roll: a.roll || 0 },
      to: { x: T.stand.x + 0.45, y: 0, z: T.stand.z + 0.1, roll: up ? 0 : Math.PI / 2 } };
    return true;
  }
  function spill(car) {
    const st = car && car._trunk;
    if (!st) return;
    for (let i = st.peds.length - 1; i >= 0; i--) out(st.peds[i], { at: car.pos ? { x: car.pos.x + 1.2, z: car.pos.z } : null });
  }

  /* ============================================================
     THE CAR HAPPENS TO HIM
     ============================================================ */
  function hurt(p, amount, cause) {
    if (!p || p.dead) return;
    p.hp = (p.hp != null ? p.hp : 100) - amount;
    if (p.hp <= 0) {
      const V = VT();
      if (V) { try { V.kill(p, cause); } catch (e) {} }
      if (!p.dead) { p.dead = true; p.hp = 0; }
      return;
    }
    // knocked senseless against the lid
    if (amount > 12) p.ko = Math.max(p.ko || 0, 3 + amount * 0.15);
  }
  function speedOf(car) {
    const s = Math.hypot(car.vx || 0, car.vz || 0);
    return s > 0.01 ? s : Math.abs(car.v || 0);
  }

  /* ============================================================
     THE TICK — lids, the body, the hammering, the law
     ============================================================ */
  const OPEN_S = 1 / 0.55, SHUT_S = 1 / 0.22;
  CBZ.onUpdate(38.7, function (dt) {
    if (!cars.length) return;
    if (!econ()) {
      for (let i = cars.length - 1; i >= 0; i--) { const c = cars[i]; if (c._trunk) spill(c); c._trunk = null; }
      cars.length = 0;
      return;
    }
    const P = CBZ.player;
    for (let ci = cars.length - 1; ci >= 0; ci--) {
      const car = cars[ci], st = car._trunk;
      if (!st) { cars.splice(ci, 1); continue; }
      if (!live(car)) { spill(car); car._trunk = null; cars.splice(ci, 1); continue; }
      const T = specOf(car);
      // ---- the lid ----
      if (T && T.lid) {
        const was = st.openT;
        if (st.openT < st.want) st.openT = Math.min(st.want, st.openT + OPEN_S * dt);
        else if (st.openT > st.want) st.openT = Math.max(st.want, st.openT - SHUT_S * dt);
        if (was <= 0.001 && st.openT > 0.001 && car.pos) sfxAt("door_open", car.pos.x, car.pos.z, { volume: 0.8 });
        if (was > 0.001 && st.openT <= 0.001 && car.pos) sfxAt("door_close", car.pos.x, car.pos.z, { volume: 1 });
        st.jolt = Math.max(0, st.jolt - dt);
        const e = st.openT * st.openT * (3 - 2 * st.openT);
        const k = st.openT <= 0.001 && st.jolt > 0 ? 0.012 * Math.sin(st.jolt * 60) : 0;
        const pose = Math.max(0, e + Math.abs(k));
        if (CBZ.carLidPose && pose !== st.posed) { st.posed = pose; CBZ.carLidPose(car, pose); }
      }
      // ---- the car's motion: a crash is felt in the box ----
      const sp = speedOf(car);
      // a hard stop, or a hard shove from a car that hit it standing
      const dv = Math.abs(st.lastV - sp);
      st.lastV = sp;
      const crash = dv > 6.5 && dt > 0 ? dv : 0;
      for (let i = st.peds.length - 1; i >= 0; i--) {
        const p = st.peds[i];
        if (!p || p.culled || !p.group || !p._inTrunk) { st.peds.splice(i, 1); continue; }
        const rec = p._npcAttached;
        // on his way out over the sill
        const ow = p._trunkOutTw;
        if (ow && rec && rec.anchor) {
          ow.t = Math.min(1, ow.t + dt / 0.5);
          const u = ow.t, e = u * u * (3 - 2 * u);
          rec.anchor.x = ow.from.x + (ow.to.x - ow.from.x) * e;
          rec.anchor.z = ow.from.z + (ow.to.z - ow.from.z) * e;
          rec.anchor.y = ow.from.y + (ow.to.y - ow.from.y) * e + Math.sin(Math.PI * u) * 0.35;
          rec.anchor.roll = ow.from.roll + (ow.to.roll - ow.from.roll) * e;
          if (u >= 1) {
            p._trunkOutTw = null;
            const w = toWorld(car, ow.to.x, 0, ow.to.z, new THREE.Vector3());
            out(p, Object.assign({}, ow.opts, { at: w ? { x: w.x, z: w.z } : null }));
          }
          continue;
        }
        // the throw: off the shoulder, over the sill, down into the box
        const tw = p._trunkTw;
        if (tw && rec && rec.anchor) {
          tw.t = Math.min(1, tw.t + dt / 0.42);
          const u = tw.t, e = u * u * (3 - 2 * u);
          rec.anchor.x = tw.from.x + (tw.to.x - tw.from.x) * e;
          rec.anchor.z = tw.from.z + (tw.to.z - tw.from.z) * e;
          rec.anchor.y = tw.from.y + (tw.to.y - tw.from.y) * e + Math.sin(Math.PI * u) * 0.28;
          if (u >= 1) { rec.anchor.x = tw.to.x; rec.anchor.y = tw.to.y; rec.anchor.z = tw.to.z; p._trunkTw = null; }
        }
        if (p.char && !p.dead && !p.char.lying) p.char.lying = { back: false, fold: true, vary: 0.7, phase: 0, tight: true };
        // peds.js skips a body in a car: his own count runs here
        if ((p.ko || 0) > 0) p.ko = Math.max(0, p.ko - dt);
        if (p.dead) continue;
        // a car that burned: nobody comes out of a trunk on fire
        if (car.dead && !car._flooded && !car._waterT) { hurt(p, 999, "burned"); continue; }
        if (crash) hurt(p, (crash - 6.5) * 5, "crushed");
        if (p.dead) continue;
        // a car that went under
        if (car._flooded || (car._waterT || 0) > 0.35) {
          p._trunkWater = (p._trunkWater || 0) + dt;
          if (p._trunkWater > 9 && awake(p)) p.ko = Math.max(p.ko || 0, 2);
          if (p._trunkWater > 22) { hurt(p, 999, "drowned"); continue; }
        }
        if (!awake(p)) continue;
        // AWAKE: he hammers on the lid and shouts through it
        st.thumpT -= dt;
        if (st.thumpT <= 0) {
          st.thumpT = 3.2 + Math.random() * 4.5;
          st.jolt = 0.16; st.seenT = 3.5;
          if (car.pos) sfxAt("punch", car.pos.x, car.pos.z, { volume: 0.45 });
          // (to you: the driver hears the man in his own trunk)
          if (CBZ.voice && CBZ.voice.say && Math.random() < 0.7) {
            try { CBZ.voice.say(p, "trunk", { ear: 10, secs: 1.8, by: CBZ.city && CBZ.city.playerActor }); } catch (e) {}
          }
        }
        // the lid is up and nothing is holding him: he is out and gone
        if (st.openT > 0.6 && !tied(p)) {
          p._trunkEsc = (p._trunkEsc || 0) + dt;
          if (p._trunkEsc > 1.1) { lift(p, { flee: true }); continue; }
        } else p._trunkEsc = 0;
      }
      st.seenT = Math.max(0, st.seenT - dt);
      // ---- the law at a stopped car ----
      if (st.cop) copJob(car, st, T, dt);
      else if (st.peds.length && st.seenT > 0 && sp < 0.6 && T && T.lid) {
        st.copCD -= dt;
        if (st.copCD <= 0) { st.copCD = 1.0; hearIt(car, st, T); }
      }
      // nothing in it and the lid is down: forget the car
      if (!st.peds.length && st.openT <= 0.001 && st.want === 0 && !st.cop) { car._trunk = null; cars.splice(ci, 1); }
    }
  });

  /* ---- THE OFFICER WHO HEARS IT ---------------------------------------- */
  function freeCop(c) {
    return !!(c && !c.dead && !(c.ko > 0) && c.group && c.pos && !c._arrestingPlayer && !c._arresting &&
      !c._custodyJob && !c._pulling && !c._seizing && !c.curTarget && !c.npcTarget && !c.chaseCar &&
      !c._airPilot && !c._swatPassenger && !(c.searchT > 0));
  }
  function hearIt(car, st, T) {
    const cops = CBZ.cityCops || [];
    let best = null, bd = 9;
    for (let i = 0; i < cops.length; i++) {
      const c = cops[i];
      if (!freeCop(c)) continue;
      const d = Math.hypot(c.pos.x - car.pos.x, c.pos.z - car.pos.z);
      if (d < bd) { bd = d; best = c; }
    }
    if (!best || Math.random() > 0.45) return;
    best._pulling = true;          // police.js: "at a car" — his beat stands down while he works it
    st.cop = { c: best, phase: "walk", t: 0 };
  }
  const _copMv = { speed: 1.9, stop: 0.25, face: null, lod: 1 };
  function copJob(car, st, T, dt) {
    const J = st.cop, c = J.c;
    J.t += dt;
    const done = function () { c._pulling = false; st.cop = null; st.copCD = 25; };
    if (!c || c.dead || (c.ko > 0) || !T) { if (c) c._pulling = false; st.cop = null; st.copCD = 10; return; }
    const w = toWorld(car, T.stand.x, 0, T.stand.z, new THREE.Vector3());
    const look = toWorld(car, 0, 0, T.zc, new THREE.Vector3());
    if (J.phase === "walk") {
      const d = Math.hypot(w.x - c.pos.x, w.z - c.pos.z);
      if (d < 0.5 || J.t > 12) { J.phase = "open"; J.t = 0; return; }
      if (CBZ.moves && CBZ.moves.motor && CBZ.moves.step) {
        const m = CBZ.moves.motor(c);
        _copMv.face = Math.atan2(w.x - c.pos.x, w.z - c.pos.z);
        CBZ.moves.step(m, c.pos, c.group.rotation.y, w.x, w.z, _copMv, dt);
        c.group.rotation.y = m.yaw;
        c.group.position.set(c.pos.x, c.pos.y || 0, c.pos.z);
        if (c.target && c.target.set) c.target.set(c.pos.x, 0, c.pos.z);
        if (CBZ.animChar && c.char) CBZ.animChar(c.char, m.gs, dt);
      } else { J.phase = "open"; J.t = 0; }
      return;
    }
    if (c.group) c.group.rotation.y = Math.atan2(look.x - c.pos.x, look.z - c.pos.z);
    if (CBZ.animChar && c.char) CBZ.animChar(c.char, 0, dt);
    if (J.phase === "open") {
      st.want = 1;
      if (st.openT >= 0.95) {
        J.phase = "found"; J.t = 0;
        const any = st.peds.slice();
        if (CBZ.citySay) { try { CBZ.citySay(c, any.some(function (p) { return !p.dead; }) ? "Easy. You're out." : "Oh, God.", "#9fc3ff", { secs: 2.4, force: true }); } catch (e) {} }
        // whoever has this car has a body in the trunk on the record
        const mine = car.owned || car.stolen || car.player || (CBZ.player && CBZ.player._vehicle === car) || car._lastPlayerCar;
        if (mine && CBZ.cityCrime) { try { CBZ.cityCrime(130, { instant: true, x: car.pos.x, z: car.pos.z, type: "kidnapping" }); } catch (e) {} }
        for (let i = 0; i < any.length; i++) if (!any[i].dead && awake(any[i])) lift(any[i], { flee: true });
      }
      return;
    }
    if (J.phase === "found" && J.t > 2.2) done();
  }

  /* ============================================================
     THE VERBS AT THE TRUNK (a pill pinned on the lid: E)
     ============================================================ */
  let pinCar = null, pinCarry = false;
  function playerFree() {
    const P = CBZ.player;
    return !!(P && !P.dead && !P.driving && !P._aircraft && !P._doorArc && !P._swim && g.state === "playing");
  }
  function carrying() {
    const H = CBZ.handVerbs, h = H && H.held ? H.held() : null;
    return !!(h && h.t && !h.t.dead);
  }
  function nearestTrunk(px, pz, r) {
    const list = CBZ.cityCars || [];
    let best = null, bd = r * r;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c || c.player || !c.pos || c._cineLocked || !c.group || c.group.visible === false) continue;
      const dx = c.pos.x - px, dz = c.pos.z - pz;
      if (dx * dx + dz * dz > 64) continue;
      if (speedOf(c) > 1.0) continue;
      // somebody's at the wheel of it: not your trunk to open
      if (!(c.owned || c.stolen) && ((c.npcDriver && !c.npcDriver.dead) || (CBZ.carNpcDriven && CBZ.carNpcDriven(c)))) continue;
      const T = specOf(c); if (!T) continue;
      const w = toWorld(c, T.stand.x, 0, T.stand.z, _v);
      if (!w) continue;
      const d2 = (w.x - px) * (w.x - px) + (w.z - pz) * (w.z - pz);
      if (d2 < bd) { bd = d2; best = { car: c, T: T, d2: d2 }; }
    }
    return best;
  }
  const _pin = { x: 0, y: 0, z: 0 };
  CBZ.onUpdate(33.35, function () {
    pinCar = null; pinCarry = false;
    if (!econ() || !CBZ.prisonPrompt || !playerFree()) return;
    const P = CBZ.player;
    const hit = nearestTrunk(P.pos.x, P.pos.z, 1.7);
    if (!hit) return;
    const car = hit.car, T = hit.T, st = car._trunk;
    const w = toWorld(car, T.top.x, T.top.y, T.top.z, _v);
    _pin.x = w.x; _pin.y = w.y; _pin.z = w.z;
    const n = st ? st.peds.length : 0;
    if (carrying()) {
      // a man on your shoulder: F puts him in (city/restrain.js stow)
      if (!room(car) || !(CBZ.cityRestrain && CBZ.cityRestrain.stowTrunk)) return;
      if (CBZ.cityRestrain.stowBusy && CBZ.cityRestrain.stowBusy()) return;
      pinCar = car; pinCarry = true;
      CBZ.prisonPrompt("car-trunk", "@cityTrunkStow", "Trunk", { at: _pin, d2: hit.d2 * 0.5, key: "F", bind: true, city: true });
      return;
    }
    const open = !T.lid || lidOpen(car) > 0.5;
    let verb;
    if (open && n > 0) verb = "Take out";
    else if (!T.lid) return;
    else verb = open ? "Shut" : "Open";
    pinCar = car;
    CBZ.prisonPrompt("car-trunk", "@cityTrunkUse", verb, { at: _pin, d2: hit.d2 * 0.5, key: "e", bind: true, city: true });
  });
  CBZ.cityTrunkUse = function () {
    const car = pinCar;
    if (!car || !playerFree()) return false;
    const T = specOf(car); if (!T) return false;
    const st = car._trunk;
    const open = !T.lid || lidOpen(car) > 0.5;
    if (open && st && st.peds.length) {
      // the first one out is the one nearest the sill
      const p = st.peds[st.peds.length - 1];
      if (p._trunkOutTw) return false;
      lift(p, {});
      if (CBZ.interactions && CBZ.interactions.refresh) CBZ.interactions.refresh();
      return true;
    }
    if (!T.lid) return false;
    lid(car, !open);
    // lifting a lid on a man in front of people is the moment they see him
    if (!open && st && st.peds.length && CBZ.cityCrime && car.pos) {
      try { CBZ.cityCrime(40, { x: car.pos.x, z: car.pos.z, type: "kidnapping" }); } catch (e) {}
    }
    return true;
  };
  CBZ.cityTrunkStow = function () {
    const car = pinCar;
    if (!car || !pinCarry || !CBZ.cityRestrain || !CBZ.cityRestrain.stowTrunk) return false;
    return CBZ.cityRestrain.stowTrunk(car, { enter: false });
  };
  (CBZ._prisonPromptSites || (CBZ._prisonPromptSites = [])).push(
    { id: "car-trunk", act: "@cityTrunkUse", was: "no car had a trunk that opened", now: "Open / Shut / Take out, pinned on the lid" }
  );

  CBZ.carTrunk = {
    of: specOf,
    room: room,
    // world point where the carrier stands to use it (and the yaw to face it)
    standAt: function (car) {
      const T = specOf(car); if (!T) return null;
      const w = toWorld(car, T.stand.x, 0, T.stand.z, new THREE.Vector3());
      const c = toWorld(car, 0, 0, T.zc, new THREE.Vector3());
      return w && c ? { x: w.x, z: w.z, faceX: c.x, faceZ: c.z } : null;
    },
    lid: lid,
    openT: lidOpen,
    put: put,
    out: out,
    lift: lift,
    spill: spill,
    holds: function (car) { const st = car && car._trunk; return st ? st.peds.slice() : []; },
    inTrunk: function (p) { return (p && p._inTrunk) || null; },
    audit: function () {
      let n = 0, open = 0;
      for (let i = 0; i < cars.length; i++) { const st = cars[i]._trunk; if (st) { n += st.peds.length; if (st.openT > 0.01) open++; } }
      return { cars: cars.length, inTrunks: n, open: open };
    },
  };
})();
