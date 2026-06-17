/* ============================================================
   city/explosives.js — REMOTE C4: plant a charge on the ground, a wall,
   or A CAR (it sticks and rides!), then detonate everything at once.

   WHY: frags ([G], city/combat.js) are the impulse-buy boom — point and
   throw. C4 is the PLANNED boom: the show-off play is parking a charge
   on a mark's bumper, walking away clean, and sending the whole street
   up when the cops roll past. That's money + spectacle in one key.

   CONTROLS (one key family, [B]):
     • TAP  [B]  — plant a charge on whatever's in front of you:
                     a CAR within reach  → sticks to the hull and RIDES it,
                     a wall ahead        → slaps flat on the facade,
                     otherwise           → drops at your feet ahead.
     • HOLD [B] ~0.5s — detonate EVERY planted charge (works from a car,
                     so the drive-away bomb actually plays).
   Charges are bought at the gun store (counter crate, same buy path as
   the Ammo Box) and carried as a COUNT in g.cityInv["C4 Charge"]
   (mirrored to g.cityC4 for HUD readers). Hard cap 5 planted at once —
   the receiver only tracks five signals.

   The boom routes through the EXACT same city blast chain as the RPG /
   grenade: CBZ.cityExplosion (byPlayer:true so kills/heat route to you)
   + cityShatter + cityCrime + cityAlarm; a wall charge also fires
   cityBlastWall so the facade scars/avalanches/smokes, and a car charge
   kills the engine via cityDamageCar so the wreck burns through the
   vehicle system's own chain.

   PERF: one shared geo/material set for every charge mesh (flagged
   _shared), the blinking LED is a visibility toggle (no material churn),
   the per-frame updater early-outs when nothing is planted, and the
   plant probe only runs on a keypress. Mode-gated + headless-guarded.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.onAlways) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  const C4 = {
    item: "C4 Charge",
    price: 2500,        // a serious munition — ten frags' worth of bang on a timer YOU own
    power: 1.4,         // matches the RPG class (grenade is 1.0/5.5)
    radius: 6,          // cityExplosion multiplies by power → ~8.4u blast
    maxPlanted: 5,      // the remote only tracks five charges
    holdT: 0.5,         // seconds [B] must be held to send the signal
    carReach: 3.4,      // how close a car must be to take a sticky charge
    wallReach: 2.6,     // forward probe depth for facade plants
  };

  // ---- the C4 item exists in the city economy (registered here at load so
  // economy.js stays untouched; gunstore.js + the clerk counter both read it
  // through the normal ITEMS / SHOP_STOCK paths once it's in). ----
  function ensureItem() {
    const e = CBZ.cityEcon;
    if (!e || !e.ITEMS) return false;
    if (!e.ITEMS[C4.item]) e.ITEMS[C4.item] = { value: C4.price, tag: "throwable", c4: true, blastPower: C4.power, blastRadius: C4.radius };
    const guns = e.SHOP_STOCK && e.SHOP_STOCK.guns;
    if (guns && guns.indexOf(C4.item) < 0) {
      const gi = guns.indexOf("Grenade");
      if (gi >= 0) guns.splice(gi + 1, 0, C4.item); else guns.push(C4.item);
    }
    return true;
  }
  ensureItem();

  function econ() { return CBZ.cityEcon || null; }
  function count() { const e = econ(); return (e && e.count) ? e.count(C4.item) : ((g.cityInv && g.cityInv[C4.item]) || 0); }
  function syncHud() { g.cityC4 = count(); if (CBZ.cityHudDirty) CBZ.cityHudDirty(); }

  // ---- the charge mesh: olive-drab body, tan demo blocks, a blinking LED ----
  // ONE geo/material set shared by every charge (and the gun-store display).
  let GEO = null, MAT = null;
  function assets() {
    if (GEO) return;
    GEO = {
      body: new THREE.BoxGeometry(0.34, 0.1, 0.24),
      block: new THREE.BoxGeometry(0.085, 0.07, 0.2),
      led: new THREE.BoxGeometry(0.04, 0.04, 0.04),
    };
    MAT = {
      body: new THREE.MeshLambertMaterial({ color: 0x2e3328 }),
      block: new THREE.MeshLambertMaterial({ color: 0xc9b98a }),
      led: new THREE.MeshBasicMaterial({ color: 0xff3030 }),
    };
    Object.keys(GEO).forEach((k) => { GEO[k]._shared = true; });
    Object.keys(MAT).forEach((k) => { MAT[k]._shared = true; });
  }
  function buildMesh() {
    assets();
    const grp = new THREE.Group();
    const body = new THREE.Mesh(GEO.body, MAT.body);
    grp.add(body);
    for (let i = -1; i <= 1; i++) {   // three taped demo sticks across the top
      const b = new THREE.Mesh(GEO.block, MAT.block);
      b.position.set(i * 0.1, 0.08, 0);
      grp.add(b);
    }
    const led = new THREE.Mesh(GEO.led, MAT.led);
    led.position.set(0.13, 0.07, 0.1);
    grp.add(led);
    grp.userData.led = led;
    return grp;
  }
  // the gun store hangs one on its demolition crate as the display model
  CBZ.cityC4Mesh = buildMesh;

  // ---- planted charges --------------------------------------------------------
  // { mesh, car|null, wall:{x,y,z}-normal|null, x,y,z (world seat for statics),
  //   det (countdown once the signal's sent, null otherwise) }
  const planted = [];
  const _v = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _n = new THREE.Vector3();

  function chargeWorldPos(ch, out) {
    if (ch.car && ch.mesh && ch.mesh.parent) { ch.mesh.getWorldPosition(out); return out; }
    out.set(ch.x, ch.y, ch.z); return out;
  }

  function removeCharge(ch) {
    if (ch.mesh && ch.mesh.parent) ch.mesh.parent.remove(ch.mesh);
    const i = planted.indexOf(ch);
    if (i >= 0) planted.splice(i, 1);
  }
  function clearPlanted() { while (planted.length) removeCharge(planted[0]); }
  CBZ.cityClearC4 = clearPlanted;

  // ---- PLANT: car first (the sticky-bomb fantasy), then wall, then ground ----
  function aimFwd() {
    const yaw = (CBZ.cam && CBZ.cam.yaw) || 0;
    return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
  }

  // forward probe into the building colliders: first AABB the ray enters within
  // wallReach; the shallowest penetration axis names the face we slapped.
  function wallProbe(px, py, pz, fx, fz) {
    const cols = CBZ.colliders || [];
    for (let t = 0.5; t <= C4.wallReach; t += 0.3) {
      const x = px + fx * t, z = pz + fz * t;
      for (let i = 0; i < cols.length; i++) {
        const c = cols[i];
        if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
        if (c.y0 != null && (py < c.y0 || py > c.y1)) continue;
        const dl = x - c.minX, dr = c.maxX - x, dn = z - c.minZ, df = c.maxZ - z;
        const m = Math.min(dl, dr, dn, df);
        let nx = 0, nz = 0, wx = x, wz = z;
        if (m === dl) { nx = -1; wx = c.minX; }
        else if (m === dr) { nx = 1; wx = c.maxX; }
        else if (m === dn) { nz = -1; wz = c.minZ; }
        else { nz = 1; wz = c.maxZ; }
        return { x: wx + nx * 0.07, y: py, z: wz + nz * 0.07, nx, nz };
      }
    }
    return null;
  }

  function tryPlant() {
    const P = CBZ.player, e = econ();
    if (!P || !e || P.driving) return;
    if (count() <= 0) { if (CBZ.city) CBZ.city.note("No C4 — the gun store sells charges.", 1.6); return; }
    if (planted.length >= C4.maxPlanted) { if (CBZ.city) CBZ.city.note("The receiver only tracks " + C4.maxPlanted + " charges — send what's out there first.", 2); return; }
    const f = aimFwd();
    const px = P.pos.x, pz = P.pos.z, py = (P.pos.y || 0) + 1.2;
    const ch = { mesh: buildMesh(), car: null, wall: null, x: 0, y: 0, z: 0, det: null, blink: Math.random() };

    // 1) A CAR in front (or right beside you): stick it to the hull — it RIDES.
    let car = null, bd = C4.carReach;
    for (const c of (CBZ.cityCars || [])) {
      if (!c || c.dead || !c.pos || !c.group) continue;
      const dx = c.pos.x - px, dz = c.pos.z - pz, d = Math.hypot(dx, dz);
      if (d > C4.carReach) continue;
      const dot = d > 0.01 ? (dx / d) * f.x + (dz / d) * f.z : 1;
      if (dot < 0.25 && d > 1.7) continue;   // ahead-ish, unless you're touching it
      if (d < bd) { bd = d; car = c; }
    }
    if (car) {
      // seat the charge on the hull face nearest you, then hand it to the car's
      // group so it rides every frame for free (no per-frame tracking of ours)
      _n.set(px - car.pos.x, 0, pz - car.pos.z);
      if (_n.lengthSq() < 1e-4) _n.set(f.x, 0, f.z).negate();
      _n.normalize();
      _v.set(car.pos.x + _n.x * 1.05, (car.pos.y || 0) + 0.75, car.pos.z + _n.z * 1.05);
      car.group.updateMatrixWorld(true);
      car.group.worldToLocal(_v);
      ch.mesh.position.copy(_v);
      // world hull normal → car-local so the charge lies flat on the panel
      const q = car.group.getWorldQuaternion(new THREE.Quaternion()).invert();
      ch.mesh.quaternion.setFromUnitVectors(_up, _n.applyQuaternion(q).normalize());
      ch.car = car;
      car.group.add(ch.mesh);
    } else {
      // 2) a WALL ahead: slap it flat on the facade, LED facing the street
      const w = wallProbe(px, py, pz, f.x, f.z);
      if (w) {
        ch.x = w.x; ch.y = w.y; ch.z = w.z;
        ch.wall = { x: w.nx, y: 0, z: w.nz };
        ch.mesh.position.set(w.x, w.y, w.z);
        ch.mesh.quaternion.setFromUnitVectors(_up, _n.set(w.nx, 0, w.nz));
        if (CBZ.scene) CBZ.scene.add(ch.mesh);
      } else {
        // 3) the GROUND just ahead of your feet
        const gx = px + f.x * 1.5, gz = pz + f.z * 1.5;
        const gy = (CBZ.floorAt ? CBZ.floorAt(gx, gz) : 0) || 0;
        ch.x = gx; ch.y = gy + 0.06; ch.z = gz;
        ch.mesh.position.set(gx, gy + 0.06, gz);
        ch.mesh.rotation.y = Math.random() * 6.2832;
        if (CBZ.scene) CBZ.scene.add(ch.mesh);
      }
    }

    if (!(e.take && e.take(C4.item, 1))) { removeCharge(ch); return; }   // count raced to zero — eat the press
    planted.push(ch);
    syncHud();
    if (CBZ.sfx) CBZ.sfx("clank");
    if (CBZ.fpsPunchAnim) CBZ.fpsPunchAnim();   // the reach-and-press arm motion
    // kneeling on a bumper wiring a bomb is NOT subtle — witnesses report it
    const wp = chargeWorldPos(ch, _v);
    if (CBZ.cityCrime) CBZ.cityCrime(50, { x: wp.x, z: wp.z, type: "planting-explosives" });
    if (CBZ.city) CBZ.city.note(ch.car ? "Charge stuck to the car (" + planted.length + " out)." : "Charge set (" + planted.length + " out).", 1.6);
  }

  // ---- DETONATE: every planted charge, rippled 0.12s apart so a daisy-chain
  // reads as a rolling barrage instead of one merged flash ----
  function detonateAll() {
    if (!planted.length) return false;
    let i = 0;
    for (const ch of planted) if (ch.det == null) ch.det = 0.05 + (i++) * 0.12;
    if (CBZ.sfx) CBZ.sfx("clank");   // the receiver's send-click
    return true;
  }

  function boom(ch) {
    const p = chargeWorldPos(ch, _v);
    removeCharge(ch);
    if (g.mode !== "city") return;
    // SAME blast chain as the RPG/grenade — byPlayer routes kills + heat to you
    if (CBZ.cityExplosion) {
      const o = { power: C4.power, radius: C4.radius, byPlayer: true };
      if (p.y > 3) o.y = p.y;                 // a charge up a wall blooms THERE
      CBZ.cityExplosion(p.x, p.z, o);
    }
    if (ch.wall && CBZ.cityBlastWall) CBZ.cityBlastWall({ x: p.x, y: p.y, z: p.z }, ch.wall, { power: 1.8 });
    if (ch.car && !ch.car.dead && CBZ.cityDamageCar) CBZ.cityDamageCar(ch.car, 260, { byPlayer: true });
    if (CBZ.cityShatter) CBZ.cityShatter(p.x, p.z, C4.radius + 2);
    if (CBZ.cityCrime) CBZ.cityCrime(150, { x: p.x, z: p.z, type: "bombing" });
    if (CBZ.cityAlarm && CBZ.city) CBZ.cityAlarm(p.x, p.z, 45, 1.8, CBZ.city.playerActor);
    if (CBZ.cityPostEvent) CBZ.cityPostEvent({ type: "explosion", pos: p, radius: 80, intensity: 2.0 });   // crowd panic bus (cityevents.js): a blast is the loudest, widest scare
    if (CBZ.cityEvent) CBZ.cityEvent("explosion", { x: p.x, z: p.z, panic: 12, damage: 6 }, { silent: true, noWanted: true });
  }

  // ---- [B]: tap = plant, hold ~0.5s = detonate all. CAPTURE phase so the
  // bomb key wins over any bubble listeners while you're actually carrying;
  // when you have neither charges nor plants, [B] falls through untouched. ----
  let holding = false, armT = 0;
  addEventListener("keydown", function (e) {
    if (e.repeat || holding) return;
    if ((e.key || "").toLowerCase() !== "b") return;
    if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;   // Shift+B belongs to wealth.js
    if (g.mode !== "city" || g.state !== "playing") return;
    if (CBZ.cityMenuOpen || !CBZ.player || CBZ.player.dead) return;
    // only claim the key when it can DO something: plant (on foot, carrying)
    // or detonate (charges out — allowed from the driver's seat: the getaway boom)
    const canPlant = !CBZ.player.driving && count() > 0;
    if (!canPlant && !planted.length) return;
    e.preventDefault();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    holding = true; armT = 0;
  }, true);
  addEventListener("keyup", function (e) {
    if ((e.key || "").toLowerCase() !== "b") return;
    if (!holding) return;
    holding = false;
    if (armT < C4.holdT) tryPlant();   // short press = plant; the hold already detonated
  }, true);

  // headless / phone / harness handles
  CBZ.cityC4Count = count;
  CBZ.cityC4Planted = function () { return planted.length; };
  CBZ.cityC4Plant = tryPlant;
  CBZ.cityC4Detonate = detonateAll;

  // ---- per-frame: hold-to-detonate timer, LED blink, ripple countdown, and
  // the fresh-run reset (same g.elapsed-rewind trick the grenades use). ----
  let _lastElapsed = 0, _blink = 0;
  CBZ.onAlways(53.7, function (dt) {
    const el = g.elapsed || 0;
    if (el + 0.001 < _lastElapsed) { clearPlanted(); holding = false; g.cityC4 = count(); }
    _lastElapsed = el;
    ensureItem();   // economy may (re)build after us — keep the catalog stocked
    if (g.mode !== "city") { if (planted.length) clearPlanted(); holding = false; return; }
    if (holding) {
      armT += dt;
      if (armT >= C4.holdT) { holding = false; detonateAll(); }
    }
    if (!planted.length) return;
    // blink every LED in lockstep (armed charges strobe fast — last warning)
    _blink += dt;
    for (let i = planted.length - 1; i >= 0; i--) {
      const ch = planted[i];
      if (ch.det != null) {
        ch.det -= dt;
        const armed = ch.mesh.userData.led;
        if (armed) armed.visible = (_blink * 9 % 1) < 0.6;
        if (ch.det <= 0) boom(ch);
        continue;
      }
      // a charge stuck to a car that got fully torn down rides nothing — re-seat
      // it as a static at its last world position so the boom still lands
      if (ch.car && (!ch.mesh.parent || ch.car.dead && !ch.car.group.parent)) {
        chargeWorldPos(ch, _v);
        ch.x = _v.x; ch.y = _v.y; ch.z = _v.z;
        if (ch.mesh.parent) ch.mesh.parent.remove(ch.mesh);
        ch.mesh.position.set(_v.x, _v.y, _v.z);
        if (CBZ.scene) CBZ.scene.add(ch.mesh);
        ch.car = null;
      }
      const led = ch.mesh.userData.led;
      if (led) led.visible = (_blink * 1.6 % 1) < 0.25;   // slow idle blink
    }
  });
})();
