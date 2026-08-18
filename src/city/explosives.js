/* ============================================================
   city/explosives.js — REMOTE C4: plant a charge on the ground, a wall,
   or A CAR (it sticks and rides!), then detonate everything at once.

   WHY: frags ([G], city/combat.js) are the impulse-buy boom — point and
   throw. C4 is the PLANNED boom: the show-off play is parking a charge
   on a mark's bumper, walking away clean, and sending the whole street
   up when the cops roll past. That's money + spectacle in one key.

   CONTROLS (one key family, [B]):
     • TAP  [B]  — plant a charge on whatever's in front of you:
                     a PERSON within reach → rides them out of the room,
                     a CAR within reach    → sticks to the hull and RIDES it,
                     a wall ahead          → slaps flat on the facade,
                     nothing in reach      → THROWN along your look arc (look
                                             down and it lands at your feet,
                                             which is the old behaviour).
     • HOLD [B] ~0.5s — detonate EVERY planted charge (works from a car,
                     so the drive-away bomb actually plays).
     • THE PHONE [P] — the real detonator (owner, 2026-08-06: "detonator not
                     in hand, it should be on your phone — we already have a
                     phone code and it's good"). city/phone.js's DEMOLITION
                     card shows pounds out, bricks left, and what the nearest
                     breachable thing COSTS, with the DETONATE button. The
                     hold-[B] remote stays as the fast path — and it is the
                     ONLY one inside the wire, because a man in a prison yard
                     does not have a phone.
     • TOUCH — the same grammar, one thumb: systems/touch.js's #tbomb button
                     (tap = plant, hold = detonate) and the vehicle layer's
                     DETONATE pill both drive THIS file's own [B] handler by
                     synthesizing its key edges (touchKeyHold), so the tap/hold
                     timing, the gates and the refusals here are the single
                     source of truth on every input. Before 2026-08-16 no touch
                     control existed at all — a brick on an iPad was a stat
                     fiction in the prison AND the city.

   THE CHARGE HAS A MASS (systems/breach.js). One brick is 5 lb, which is the
   US Army row for a hole ONE MAN can move through; a charge STUCK to something
   opens it, a loose or thrown one only wrecks it, and charges within 2.5 m of
   each other fire together and their masses ADD (det cord). That is why a
   reserve vault can ask for 10 lb and mean it.
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

   DETERMINISM: the charge's spawn-time jitter (LED blink phase, ground-plant
   facing) runs off a local seeded LCG, NEVER Math.random() — replay/MP sync.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.onAlways) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  // ---- deterministic seeded LCG (NEVER Math.random() — replay/MP sync) ------
  let _rs = 51917;
  function rng() { _rs = (_rs * 1103515245 + 12345) & 0x7fffffff; return _rs / 0x7fffffff; }

  const C4 = {
    item: "C4 Charge",
    price: 2500,        // a serious munition — ten frags' worth of bang on a timer YOU own
    power: 1.4,         // matches the RPG class (grenade is 1.0/5.5)
    radius: 6,          // cityExplosion multiplies by power → ~8.4u blast
    // THE CHARGE HAS A MASS NOW (systems/breach.js). 5 lb is not a tuning
    // number — it is the doctrinal row: against non-reinforced concrete, 5 lb
    // of C4 is the charge that opens a hole ONE MAN can move through (2 lb is
    // a mousehole you cannot use, 7 lb takes two abreast). The blast it makes
    // is unchanged; what the mass buys is the SIZE OF THE HOLE, and the fact
    // that a prison door and a bank vault can now both state, in pounds, what
    // it costs to open them.
    lb: 5,
    maxPlanted: 5,      // the remote only tracks five charges
    holdT: 0.5,         // seconds [B] must be held to send the signal
    carReach: 3.4,      // how close a car must be to take a sticky charge
    wallReach: 2.6,     // forward probe depth for facade plants
    bodyReach: 2.2,     // how close a PERSON must be to take one on the back
    throwSpeed: 13,     // m/s off the hand when you throw instead of plant
  };

  // ONE ENGINE, EVERY GAME (systems/modecaps.js). C4 was written city-only —
  // three `mode !== "city"` gates — and every one of them guarded a shared
  // verb, not a city record: a brick that sticks to a wall and goes off means
  // the same thing in a prison corridor and on a burning island. The plant
  // probe reads CBZ.colliders and CBZ.worldActors(); the boom routes through
  // the shared blast. Degrade-safe: no modecaps loaded => city-only, as before.
  function c4Live() { return CBZ.modeHas ? CBZ.modeHas("blast") : g.mode === "city"; }

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

  // ONE LEDGER PER MODE. This file hardcoded CBZ.cityEcon/g.cityInv, which is
  // why prison C4 could never exist: escape mode's bag is g.inventory
  // (systems/inventory.js is explicit that it is "the count truth"), and
  // g.cityInv isn't even initialised outside a city life — so a stolen brick
  // COUNTED zero and [B] fell through to the stash. systems/economy.js's
  // itemStore() is the ONE mode-aware accessor (city → cityEcon, everything
  // else → g.inventory), the same switchboard buildmode.js and baseclaim.js
  // already buy through. Degrade-safe: no itemStore ⇒ the exact cityEcon
  // path this file shipped with.
  function econ() {
    if (CBZ.econ && CBZ.econ.itemStore) return CBZ.econ.itemStore();
    return CBZ.cityEcon || null;
  }
  function count() { const e = econ(); return (e && e.count) ? e.count(C4.item) : ((g.cityInv && g.cityInv[C4.item]) || 0); }
  function syncHud() { g.cityC4 = count(); if (CBZ.cityHudDirty) CBZ.cityHudDirty(); }
  // one voice per mode (same routing finishPlant always used, now shared)
  function note(line, s) {
    if (g.mode === "city" && CBZ.city) CBZ.city.note(line, s);
    else if (CBZ.jailTell) CBZ.jailTell.hint(line, s);
    else if (CBZ.flashHint) CBZ.flashHint(line, s);
  }

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
  const _actorScratch = [];                     // reused roster buffer (no per-plant alloc)
  const _probe = { x: 0, y: 0, z: 0 };           // reused flight depenetration probe

  function chargeWorldPos(ch, out) {
    if ((ch.car || ch.body) && ch.mesh && ch.mesh.parent) { ch.mesh.getWorldPosition(out); return out; }
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
    if (count() <= 0) { note(g.mode === "escape" ? "No C4 — the armory cage keeps the charges." : "No C4 — the gun store sells charges.", 1.6); return; }
    if (planted.length >= C4.maxPlanted) { note("The receiver only tracks " + C4.maxPlanted + " charges — send what's out there first.", 2); return; }
    const f = aimFwd();
    const px = P.pos.x, pz = P.pos.z, py = (P.pos.y || 0) + 1.2;
    const ch = { mesh: buildMesh(), car: null, body: null, wall: null, fly: null, x: 0, y: 0, z: 0, det: null, blink: rng() };

    // 0) A PERSON in front: it sticks to THEM and they walk away wearing it.
    //    Owner: "it sticks to… everything, essentially, people included."
    //    The roster comes from systems/modecaps.js, so this is the prison's
    //    guards and inmates, Gun Game's bots and the city's pedestrians
    //    through ONE call — the same switchboard the blast damage uses.
    if (CBZ.worldActors) {
      let vic = null, vd = C4.bodyReach;
      const list = CBZ.worldActors(_actorScratch);
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        const ap = CBZ.actorPos ? CBZ.actorPos(a) : (a.pos || (a.group && a.group.position));
        if (!ap || !a.group) continue;
        const dx = ap.x - px, dz = ap.z - pz, d = Math.hypot(dx, dz);
        if (d > C4.bodyReach || d >= vd) continue;
        if (d > 0.01 && ((dx / d) * f.x + (dz / d) * f.z) < 0.35) continue;   // must be AHEAD
        vd = d; vic = a;
      }
      _actorScratch.length = 0;
      if (vic) {
        // seat it on the back/side facing you and hand it to their group, so it
        // rides the walk cycle for free — same trick the car stick already uses
        const ap = CBZ.actorPos ? CBZ.actorPos(vic) : vic.pos;
        _n.set(px - ap.x, 0, pz - ap.z);
        if (_n.lengthSq() < 1e-4) _n.set(-f.x, 0, -f.z);
        _n.normalize();
        _v.set(ap.x + _n.x * 0.3, (ap.y || 0) + 1.05, ap.z + _n.z * 0.3);
        vic.group.updateMatrixWorld(true);
        vic.group.worldToLocal(_v);
        ch.mesh.position.copy(_v);
        ch.mesh.quaternion.setFromUnitVectors(_up, _n.clone());
        ch.body = vic;
        vic.group.add(ch.mesh);
        return finishPlant(ch, "Charge on the mark — walk away.");
      }
    }

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
        // 3) NOTHING IN REACH -> THROW IT. Owner: the charge should be
        //    "grabbable and throwable". This replaces the old "drop it at your
        //    feet", and it is a strict superset of that: look down and the arc
        //    puts the brick on the floor a step ahead exactly as before, look
        //    across the yard and it goes across the yard. No new button — the
        //    same tap, resolved by what is actually in front of you.
        const pitch = (CBZ.cam && CBZ.cam.pitch) || 0;
        ch.fly = { vx: f.x * C4.throwSpeed, vy: Math.sin(-pitch) * C4.throwSpeed + 2.2,
                   vz: f.z * C4.throwSpeed, t: 0 };
        ch.x = px + f.x * 0.6; ch.y = py + 0.25; ch.z = pz + f.z * 0.6;
        ch.mesh.position.set(ch.x, ch.y, ch.z);
        if (CBZ.scene) CBZ.scene.add(ch.mesh);
      }
    }

    return finishPlant(ch, null);
  }

  // shared tail for every plant/throw path: pay for the charge, register it,
  // and report. Pulled out so the person-stick branch above can return early
  // without duplicating the bookkeeping.
  function finishPlant(ch, msg) {
    const e = econ();
    if (!(e && e.take && e.take(C4.item, 1))) { removeCharge(ch); return; }   // count raced to zero — eat the press
    planted.push(ch);
    syncHud();
    if (CBZ.fpsPunchAnim) CBZ.fpsPunchAnim(true); // reach-and-press pose, not a punch sound
    // kneeling on a bumper wiring a bomb is NOT subtle — witnesses report it
    const wp = chargeWorldPos(ch, _v);
    if (CBZ.cityCrime && g.mode === "city") CBZ.cityCrime(50, { x: wp.x, z: wp.z, type: "planting-explosives" });
    const line = msg || (ch.car ? "Charge stuck to the car (" + planted.length + " out)."
      : ch.fly ? "Charge away (" + planted.length + " out)."
      : "Charge set (" + planted.length + " out).");
    if (g.mode === "city" && CBZ.city) CBZ.city.note(line, 1.6);
    else if (CBZ.jailTell) CBZ.jailTell.hint(line, 1.6);
    else if (CBZ.flashHint) CBZ.flashHint(line, 1.6);
  }

  // ---- THROW: the same brick, given to gravity. It arms on first contact and
  // becomes an ordinary stuck charge — so a charge you cannot reach (across a
  // yard, up a stairwell, onto a moving car) is still a charge you can place.
  // A THROWN charge that lands loose is deliberately NOT a contact breach:
  // systems/breach.js only opens what a charge is STUCK to, which is the real
  // distinction between a satchel charge and a bomb lying on the floor.
  function tryThrow() {
    const P = CBZ.player, e = econ();
    if (!P || !e || !c4Live()) return;
    if (count() <= 0 || planted.length >= C4.maxPlanted) return;
    const f = aimFwd();
    const pitch = (CBZ.cam && CBZ.cam.pitch) || 0;
    const ch = { mesh: buildMesh(), car: null, body: null, wall: null, x: 0, y: 0, z: 0, det: null, blink: rng(),
                 fly: { vx: f.x * C4.throwSpeed, vy: Math.sin(-pitch) * C4.throwSpeed + 2.2, vz: f.z * C4.throwSpeed, t: 0 } };
    ch.x = P.pos.x + f.x * 0.6; ch.y = (P.pos.y || 0) + 1.45; ch.z = P.pos.z + f.z * 0.6;
    ch.mesh.position.set(ch.x, ch.y, ch.z);
    if (CBZ.scene) CBZ.scene.add(ch.mesh);
    finishPlant(ch, null);
  }
  CBZ.cityC4Throw = tryThrow;

  // integrate a thrown brick until it touches something, then stick it there
  function stepFlight(ch, dt) {
    const fl = ch.fly;
    fl.t += dt;
    fl.vy -= 18 * dt;                                   // heavier arc than a frag: it is a brick
    const nx = ch.x + fl.vx * dt, ny = ch.y + fl.vy * dt, nz = ch.z + fl.vz * dt;
    // a body it brushes takes it (the sticky-bomb throw)
    if (CBZ.worldActors) {
      const list = CBZ.worldActors(_actorScratch);
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        const ap = CBZ.actorPos ? CBZ.actorPos(a) : (a.pos || (a.group && a.group.position));
        if (!ap || !a.group) continue;
        const dx = ap.x - nx, dz = ap.z - nz, dy = (ap.y || 0) + 1.0 - ny;
        if (dx * dx + dz * dz + dy * dy > 0.55 * 0.55) continue;
        _actorScratch.length = 0;
        _v.set(nx, ny, nz);
        a.group.updateMatrixWorld(true);
        a.group.worldToLocal(_v);
        ch.mesh.position.copy(_v);
        if (ch.mesh.parent) ch.mesh.parent.remove(ch.mesh);
        a.group.add(ch.mesh);
        ch.body = a; ch.fly = null;
        return;
      }
      _actorScratch.length = 0;
    }
    // a wall it hits takes it: run the same depenetration the player uses and
    // see whether the world pushed back
    _probe.x = nx; _probe.z = nz;
    if (CBZ.collide) CBZ.collide(_probe, 0.12, ny - 0.1, ny + 0.1);
    const pushed = Math.hypot(_probe.x - nx, _probe.z - nz) > 0.01;
    const floor = (CBZ.floorAt ? CBZ.floorAt(nx, nz) : 0) || 0;
    if (pushed || ny <= floor + 0.06 || fl.t > 6) {
      ch.x = pushed ? _probe.x : nx;
      ch.y = Math.max(floor + 0.06, ny);
      ch.z = pushed ? _probe.z : nz;
      ch.mesh.position.set(ch.x, ch.y, ch.z);
      ch.mesh.rotation.y = rng() * 6.2832;
      // A THROWN charge that stuck to a WALL is still a contact charge — that
      // is what "stuck to it" means. One that came to rest on the floor is not.
      if (pushed) ch.wall = { x: 0, y: 0, z: 0, thrown: true };
      ch.fly = null;
      return;
    }
    ch.x = nx; ch.y = ny; ch.z = nz;
    ch.mesh.position.set(nx, ny, nz);
    ch.mesh.rotation.x += dt * 6; ch.mesh.rotation.z += dt * 4;
  }

  // ---- DETONATE: every planted charge, rippled 0.12s apart so a daisy-chain
  // reads as a rolling barrage instead of one merged flash ----
  function detonateAll() {
    if (!planted.length) return false;
    /* DET CORD. FM 90-10-1 app.M is explicit: breaching charges are "primed
       with detonating cord or MDI to obtain SIMULTANEOUS detonation, which
       will blow a hole large enough for a man to fit through". Two bricks
       going off a tenth of a second apart are two small bangs; two bricks
       going off together are one big one. So charges stuck within CLUSTER_R
       of each other fire as ONE charge and their masses ADD.

       This is what makes a door priced in POUNDS mean something: a 5 lb brick
       opens a branch vault, a reserve vault wants 10 lb, and the answer is to
       go back for a second charge and set them side by side. The table stops
       being a lookup and becomes a decision. */
    const CLUSTER_R = 2.5, CR2 = CLUSTER_R * CLUSTER_R;
    const pos = [];
    for (let i = 0; i < planted.length; i++) pos.push(chargeWorldPos(planted[i], new THREE.Vector3()));
    const claimed = new Array(planted.length).fill(false);
    let wave = 0;
    for (let i = 0; i < planted.length; i++) {
      if (claimed[i] || planted[i].det != null) continue;
      claimed[i] = true;
      const lead = planted[i];
      let lb = C4.lb;
      for (let j = i + 1; j < planted.length; j++) {
        if (claimed[j] || planted[j].det != null) continue;
        if (pos[i].distanceToSquared(pos[j]) > CR2) continue;
        claimed[j] = true;
        lb += C4.lb;
        // the satellite's explosive went into the lead's bang — it vanishes
        // with it, on the same frame, and never fires a second blast
        planted[j].det = 0.05 + wave * 0.12;
        planted[j].silent = true;
      }
      lead.lb = lb;
      lead.det = 0.05 + wave * 0.12;
      wave++;
    }
    return true;
  }

  function boom(ch) {
    const p = chargeWorldPos(ch, _v);
    const stuck = !!(ch.wall || ch.car || ch.body);
    removeCharge(ch);
    if (!c4Live()) return;
    // a satellite consumed by a det-cord cluster already went off inside the
    // lead charge's bang — it must not fire a second one.
    if (ch.silent) return;

    /* THE CHARGE TABLE (systems/breach.js) OWNS WHAT A STUCK CHARGE OPENS.
       This is the owner's "real math, put into Gang City and then throughout
       my games": 5 lb of C4 against non-reinforced concrete is the doctrinal
       ONE-MAN hole, and a charge that is STUCK to something opens it while a
       standoff blast only wrecks it. contactBreach fires the SAME explosion
       the rocket already uses — "C4 can use the same explosion" — then either
       defeats a registered target (a prison door, a vault) or carves an
       opening sized by the charge. Outside city it is also the whole boom,
       because the city-only fan-out below is skipped there. */
    if (CBZ.contactBreach) {
      const res = CBZ.contactBreach(p.x, p.y, p.z, {
        lb: ch.lb || C4.lb, contact: stuck, byPlayer: true,
        normal: ch.wall || null, cause: "explosion",
      });
      if (res && res.kind === "undercharged") {
        note("The door held — that needs " + (res.needLb || 0) + " lb on it.", 2);
      }
      // contactBreach already detonated; the city couplings below still run.
      if (g.mode !== "city") {
        if (ch.body && CBZ.hurtWorldActor) { try { CBZ.hurtWorldActor(ch.body, 1e6, { fromX: p.x, fromZ: p.z, byPlayer: true, cause: "explosion" }); } catch (e2) {} }
        // A BOMB INSIDE THE WIRE IS THE LOUDEST THING A PRISONER CAN DO. The
        // city couples its blast to cityCrime/cityAlarm below; the pen's
        // equivalents are heat and the guards' heads turning — the same
        // coupling world/door.js's defeat() already applies, now applied to
        // EVERY prison detonation, not only the ones that pay a priced door.
        if (g.mode === "escape") {
          if (CBZ.addHeat) CBZ.addHeat(70);
          const gds = CBZ.guards || [];
          for (let i = 0; i < gds.length; i++) if (gds[i] && !gds[i].dead) gds[i].alert = Math.max(gds[i].alert || 0, 1);
        }
        return;
      }
      if (ch.wall && CBZ.cityBlastWall) CBZ.cityBlastWall({ x: p.x, y: p.y, z: p.z }, ch.wall, { power: 1.8 });
      if (ch.car && !ch.car.dead && CBZ.cityDamageCar) CBZ.cityDamageCar(ch.car, 260, { byPlayer: true });
      if (CBZ.cityShatter) CBZ.cityShatter(p.x, p.z, C4.radius + 2);
      if (CBZ.cityCrime) CBZ.cityCrime(150, { x: p.x, z: p.z, type: "bombing" });
      if (CBZ.cityAlarm && CBZ.city) CBZ.cityAlarm(p.x, p.z, 45, 1.8, CBZ.city.playerActor);
      if (CBZ.cityPostEvent) CBZ.cityPostEvent({ type: "explosion", pos: p, radius: 80, intensity: 2.0 });
      return;
    }
    if (g.mode !== "city") return;               // no breach block loaded: legacy city-only path
    // THE ORDNANCE BUS (systems/impactbus.js): one verb replaces the blast
    // fan-out this function used to spell out. The "c4" row carries the same
    // power/radius C4 always had (1.4 / 6) plus the two things the inline call
    // could not express — a structural multiplier into city/structural.js's
    // ledger and a small ignition — so a wall charge now genuinely WOUNDS the
    // building instead of scorching it. A charge up a wall still blooms THERE
    // (y), and a wall charge drives its damage INTO the facade (-normal), which
    // is what makes a breaching charge read like one.
    // DEGRADE-SAFE: no bus loaded => the exact pre-bus call, unchanged.
    const by = (CBZ.city && CBZ.city.playerActor) || CBZ.player || null;
    if (CBZ.detonate) {
      CBZ.detonate(p.x, p.y, p.z, "c4", {
        by: by, byPlayer: true,
        dirx: ch.wall ? -ch.wall.x : 0, dirz: ch.wall ? -ch.wall.z : 0,
      });
    } else if (CBZ.cityExplosion) {
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
  let holding = false, armT = 0, stashHinted = false;
  addEventListener("keydown", function (e) {
    if (e.repeat || holding) return;
    if ((e.key || "").toLowerCase() !== "b") return;
    if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;   // Shift+B: wealth.js in city, the stash's fallback in escape
    if (!c4Live() || g.state !== "playing") return;
    if (CBZ.cityMenuOpen || CBZ.invOpen || !CBZ.player || CBZ.player.dead) return;
    // FLYING THE BOMBER OWNS [B]. city/strategic.js's B-2 uses tap=release /
    // hold=carpet run on this same key; a charge in your pocket must not eat
    // the bomb-bay key while you are 200 m up (this capture handler would
    // stopImmediatePropagation it and the drop would silently never happen).
    if (CBZ.player._aircraft) return;
    // only claim the key when it can DO something: plant (on foot, carrying)
    // or detonate (charges out — allowed from the driver's seat: the getaway boom)
    const canPlant = !CBZ.player.driving && count() > 0;
    if (!canPlant && !planted.length) return;
    e.preventDefault();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    // IN THE PEN, [B] IS ALSO THE STASH KEY (systems/inventory.js). While you
    // carry charges this capture handler wins, which is correct — a man with
    // a bomb in his hand is not browsing his bag — but say ONCE where the bag
    // went: Shift+B reaches inventory.js untouched (wealth.js's chord is
    // city-gated), so nothing is lost, only moved while the charges last.
    // …but never on touch: a touchscreen is NEVER shown a keyboard key, and
    // there is no conflict to explain there — the bomb has its own button and
    // the stash keeps its own tap.
    if (g.mode === "escape" && !stashHinted && !CBZ.touchMode) {
      stashHinted = true;
      note("[B] is the bomb while you carry charges — the stash answers Shift+B.", 2.6);
    }
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
    if (!c4Live()) { if (planted.length) clearPlanted(); holding = false; return; }
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
      // a brick still in the air integrates until it touches something
      if (ch.fly) { stepFlight(ch, dt); continue; }
      // the man wearing it went down / got culled — re-seat it where he fell so
      // the charge is still a real object in the world (same rule as the car)
      if (ch.body && (!ch.mesh.parent || !ch.body.group || !ch.body.group.parent)) {
        chargeWorldPos(ch, _v);
        ch.x = _v.x; ch.y = _v.y; ch.z = _v.z;
        if (ch.mesh.parent) ch.mesh.parent.remove(ch.mesh);
        ch.mesh.position.set(_v.x, _v.y, _v.z);
        if (CBZ.scene) CBZ.scene.add(ch.mesh);
        ch.body = null;
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
