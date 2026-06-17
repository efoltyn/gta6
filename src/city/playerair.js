/* ============================================================
   city/playerair.js — YOUR aviation: a personal helicopter and an attack jet,
   based out of the home you own. This is the payoff that makes the top of the
   property ladder MATTER.

   WHY this exists
   ---------------
   A house in a GTA-like is only as meaningful as what it UNLOCKS. Minecraft's
   bed gives you a spawn + a way to skip danger; GTA's high-end properties give
   you a garage, a heist room, and — at the top — an aircraft you can summon.
   Owning THE SPIRE flips its rooftop into a HELIPAD and its parking deck into a
   HANGAR, and those two flags unlock real verbs from the phone:

     • CALL A CHOPPER (helipad) — a personal helicopter flies in, you walk under
       it to board, and it flies you across the city to your map waypoint (or
       home). Aerial fast-travel AND a clean getaway when the streets are hot.
     • CALL AN AIRSTRIKE (hangar) — your attack jet screams in and levels your
       target (map waypoint, else where you're aiming). Costs cash, draws police
       heat, and is on a rearm cooldown — the ultimate "I own this city" verb.

   Everything reuses the existing explosion / crashfx machinery and is fully
   feature-detected. Wanted-air (police gunship/jets) lives in aircraft.js; this
   is strictly the PLAYER'S side.

   Exposes: CBZ.cityCallChopper, CBZ.cityCallAirstrike, CBZ.cityAirServices
            (status for the phone), CBZ.cityClearPlayerAir.
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;
  const rng = Math.random;

  // ---- tunables -------------------------------------------------------------
  const CRUISE_Y    = 48;     // ride cruise altitude (clears every core-tower parapet at FH=4.6)
  const HELI_SPEED  = 30;     // m/s lateral (a personal heli is quick)
  const HELI_CLIMB  = 14;     // m/s vertical
  const BOARD_DIST  = 3.2;    // walk this close to a landed chopper to board
  const LAND_WAIT   = 14;     // s a landed chopper waits before giving up
  const CHOPPER_CD  = 18;     // s between chopper calls (refuel)
  const STRIKE_COST = 5000;   // $ per airstrike
  const STRIKE_CD   = 40;     // s jet rearm
  const STRIKE_Y    = 54;     // jet pass altitude
  const STRIKE_SPD  = 90;     // m/s jet
  const STRIKE_DROP = 55;     // distance from target the bomb releases

  // ---- shared state ---------------------------------------------------------
  let G = null;               // lazy geom/mat cache
  let chopper = null;         // active personal heli or null
  let strike = null;          // active attack jet or null
  let chopperCD = 0, strikeCD = 0;

  function arenaRoot() { const a = CBZ.city && CBZ.city.arena; return a ? a.root : null; }
  function player() { const P = CBZ.player; return P && !P.dead ? P : null; }
  function floorAt(x, z) { return CBZ.floorAt ? CBZ.floorAt(x, z) : 0; }
  function note(m, t) { if (CBZ.city && CBZ.city.note) CBZ.city.note(m, t || 2.6); }
  function money(n) { return "$" + Math.round(n).toLocaleString(); }

  // home ownership → airbase capabilities. realestate.js is the single source of
  // truth for these flags: buying the penthouse arms the CHOPPER (g.cityOwnsHeli,
  // free with the home), and a separate paid HANGAR add-on arms the JET
  // (g.cityOwnsHangar). We gate purely on those globals so the realtor's economy
  // and this module's verbs can never disagree.
  function homeRec() {
    const h = g.cityHome;
    return (h && h.lot && h.lot.building && h.lot.building.home) ? h.lot.building.home : null;
  }
  function ownsPenthouse() { const h = homeRec(); return !!g.cityOwnsPenthouse || !!(h && h.flagship); }
  function canChopper() { return !!g.cityOwnsHeli; }      // comes with the penthouse
  function canStrike() { return !!g.cityOwnsHangar; }     // the bought hangar add-on

  function charge(amt) {
    amt = Math.max(0, Math.round(amt) || 0);
    if (((g.cash || 0) + (g.cityBank || 0)) < amt) return false;
    let owe = amt; const fromCash = Math.min(g.cash || 0, owe);
    g.cash = (g.cash || 0) - fromCash; owe -= fromCash; if (owe > 0) g.cityBank = (g.cityBank || 0) - owe;
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  }

  // ---- shared assets --------------------------------------------------------
  function assets() {
    if (G) return G;
    const shared = (o) => { if (o) o._shared = true; return o; };
    const M = (c, o) => { const m = CBZ.mat ? CBZ.mat(c, o) : new THREE.MeshLambertMaterial({ color: c }); return shared(m); };
    G = {
      // friendly heli: dark navy hull with a warm cabin glow strip
      matHull: M(0x1c2530, { ei: 0.05 }),
      matTrim: M(0x394656),
      matGlow: M(0x59c2ff, { emissive: 0x59c2ff, ei: 0.7 }),
      matJet:  M(0x2f3744, { ei: 0.05 }),
      heliBody: shared(new THREE.BoxGeometry(2.3, 1.3, 5.0)),
      heliTail: shared(new THREE.BoxGeometry(0.42, 0.42, 3.3)),
      heliFin:  shared(new THREE.BoxGeometry(0.18, 1.0, 0.7)),
      heliSkid: shared(new THREE.BoxGeometry(0.16, 0.16, 3.8)),
      heliStrut:shared(new THREE.BoxGeometry(0.12, 0.6, 0.12)),
      glowStrip:shared(new THREE.BoxGeometry(2.0, 0.5, 0.08)),
      rotorMain:shared(new THREE.BoxGeometry(9.0, 0.06, 0.6)),
      rotorTail:shared(new THREE.BoxGeometry(0.06, 1.7, 0.3)),
      jetBody:  shared(new THREE.BoxGeometry(1.4, 1.0, 8.6)),
      jetNose:  shared(new THREE.ConeGeometry(0.7, 2.4, 8)),
      jetWing:  shared(new THREE.BoxGeometry(7.2, 0.18, 2.2)),
      jetTail:  shared(new THREE.BoxGeometry(0.16, 1.6, 1.4)),
      bomb:     shared(new THREE.CylinderGeometry(0.18, 0.18, 1.2, 7)),
      burn:     shared(new THREE.SphereGeometry(0.5, 7, 6)),
      rotorMat: shared(new THREE.MeshBasicMaterial({ color: 0x0e1015, transparent: true, opacity: 0.5, depthWrite: false })),
      flameMat: shared(new THREE.MeshBasicMaterial({ color: 0xffb14a, transparent: true, opacity: 0.9, depthWrite: false })),
      bombMat:  shared(new THREE.MeshBasicMaterial({ color: 0x20242b })),
    };
    return G;
  }

  function disposeGroup(obj) {
    if (!obj) return;
    obj.traverse(function (o) {
      if (o.isSprite) return;
      if (o.geometry && !o.geometry._shared && o.geometry.dispose) { try { o.geometry.dispose(); } catch (e) {} }
      const m = o.material; if (m && !m._shared && m.dispose) { try { m.dispose(); } catch (e) {} }
    });
  }

  // an entry point far off an edge, heading toward (tx,tz)
  function edgePoint(tx, tz, y) {
    const a = CBZ.city && CBZ.city.arena;
    const cx = a && a.center ? a.center.x : 0, cz = a && a.center ? a.center.z : 0;
    let span = 130;
    if (a && a.minX != null) span = Math.max(a.maxX - a.minX, a.maxZ - a.minZ) * 0.6 + 40;
    const ang = Math.atan2((tx - cx) || 0.001, (tz - cz) || 0.001);
    return { x: cx + Math.sin(ang) * span, y: y, z: cz + Math.cos(ang) * span };
  }

  // ============================================================ CHOPPER ======
  function makeChopper(P) {
    const r = arenaRoot(); if (!r) return null;
    const a = assets();
    const grp = new THREE.Group();
    const body = new THREE.Mesh(a.heliBody, a.matHull); grp.add(body);
    const tail = new THREE.Mesh(a.heliTail, a.matHull); tail.position.set(0, 0.25, -3.8); grp.add(tail);
    const fin = new THREE.Mesh(a.heliFin, a.matTrim); fin.position.set(0, 0.7, -5.1); grp.add(fin);
    const glow = new THREE.Mesh(a.glowStrip, a.matGlow); glow.position.set(0, 0.1, 2.4); grp.add(glow);
    for (const sx of [-0.9, 0.9]) {
      const skid = new THREE.Mesh(a.heliSkid, a.matTrim); skid.position.set(sx, -0.82, 0); grp.add(skid);
      const s1 = new THREE.Mesh(a.heliStrut, a.matTrim); s1.position.set(sx, -0.5, 1.1); grp.add(s1);
      const s2 = new THREE.Mesh(a.heliStrut, a.matTrim); s2.position.set(sx, -0.5, -1.1); grp.add(s2);
    }
    const rotor = new THREE.Mesh(a.rotorMain, a.rotorMat); rotor.position.y = 1.05; grp.add(rotor);
    const trotor = new THREE.Mesh(a.rotorTail, a.rotorMat); trotor.position.set(0.18, 0.45, -5.2); grp.add(trotor);
    // No floating "YOUR CHOPPER" word over your helicopter — it's the only one
    // you summoned and the only one landing on you, so it reads as yours. A
    // hovering label broke the fourth wall and was removed.
    r.add(grp);

    // spawn high, offset from the player, and pick a clear landing pad nearby
    const px = P.pos.x, pz = P.pos.z;
    const ang = rng() * 6.28;
    const land = { x: px + Math.cos(ang) * 7, z: pz + Math.sin(ang) * 7 };
    land.y = floorAt(land.x, land.z) + 1.0;
    grp.position.set(land.x + Math.cos(ang) * 30, CRUISE_Y, land.z + Math.sin(ang) * 30);
    return {
      group: grp, rotor, trotor, pos: grp.position,
      phase: "incoming", land, waitT: LAND_WAIT, rideT: 0, dest: null, spin: 1,
    };
  }

  function despawnChopper() {
    if (!chopper) return;
    if (chopper.group && chopper.group.parent) chopper.group.parent.remove(chopper.group);
    disposeGroup(chopper.group);
    chopper = null;
    g.cityChopperRide = false;
  }

  function rideDest() {
    const wp = (CBZ.fullMap && CBZ.fullMap.waypoint) ? CBZ.fullMap.waypoint() : null;
    if (wp && wp.x != null) return { x: wp.x, z: wp.z, label: wp.label || "waypoint" };
    const h = g.cityHome;
    if (h && h.lot && h.lot.building && h.lot.building.door) {
      return { x: h.lot.building.door.x, z: h.lot.building.door.z, label: h.name || "home" };
    }
    const a = CBZ.city && CBZ.city.arena;
    return a && a.center ? { x: a.center.x, z: a.center.z, label: "downtown" } : { x: 0, z: 0, label: "downtown" };
  }

  function updateChopper(dt) {
    if (!chopper) return;
    const c = chopper, P = player();
    // spin rate eases between idle-on-pad and full flight
    const targetSpin = (c.phase === "landed") ? 0.45 : 1.0;
    c.spin += (targetSpin - c.spin) * Math.min(1, dt * 2);
    if (c.rotor) c.rotor.rotation.y += dt * 46 * c.spin;
    if (c.trotor) c.trotor.rotation.x += dt * 64 * c.spin;

    if (c.phase === "incoming") {
      const L = c.land;
      const dx = L.x - c.pos.x, dz = L.z - c.pos.z, dy = L.y - c.pos.y;
      const dl = Math.hypot(dx, dz);
      const step = HELI_SPEED * dt;
      if (dl > 0.4) { c.pos.x += (dx / dl) * Math.min(step, dl); c.pos.z += (dz / dl) * Math.min(step, dl); }
      // descend only once roughly over the pad
      const vstep = HELI_CLIMB * dt;
      if (dl < 6) c.pos.y += Math.max(-vstep, Math.min(vstep, dy));
      c.group.rotation.y = Math.atan2(dx, dz);
      if (dl < 0.8 && Math.abs(dy) < 0.6) { c.phase = "landed"; c.waitT = LAND_WAIT; note("🚁 Chopper down — walk under it to board.", 3); }
      return;
    }

    if (c.phase === "landed") {
      c.waitT -= dt;
      if (P) {
        const d = Math.hypot(P.pos.x - c.pos.x, P.pos.z - c.pos.z);
        if (d < BOARD_DIST) {
          c.phase = "ride"; c.dest = rideDest(); c.rideT = 0;
          g.cityChopperRide = true;
          // (CUT: the "🚁 BOARDED" centre flash — you can SEE you're in the
          // bird. The note keeps the one thing you can't see: where it's headed.)
          note("Flying to " + (c.dest.label || "destination") + "…", 3);
          if (CBZ.sfx) CBZ.sfx("whoosh");
          return;
        }
      }
      if (c.waitT <= 0) { c.phase = "leaving"; note("🚁 Chopper left without you.", 2.2); }
      return;
    }

    if (c.phase === "ride") {
      c.rideT += dt;
      // glue the player inside the cabin
      if (P) {
        P.pos.x = c.pos.x; P.pos.y = c.pos.y - 1.0; P.pos.z = c.pos.z;
        P.vy = 0; P.grounded = false;
        if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(P.pos);
      } else { c.phase = "leaving"; return; }    // player died mid-flight → bail
      const D = c.dest;
      const dx = D.x - c.pos.x, dz = D.z - c.pos.z, dl = Math.hypot(dx, dz);
      // climb to cruise first; once high, run for the destination, then settle
      const wantY = (dl > 14) ? CRUISE_Y : (floorAt(D.x, D.z) + 1.2);
      const dy = wantY - c.pos.y, vstep = HELI_CLIMB * dt;
      c.pos.y += Math.max(-vstep, Math.min(vstep, dy));
      if (c.pos.y > CRUISE_Y - 6 || dl < 14) {
        const step = HELI_SPEED * dt;
        if (dl > 0.5) { c.pos.x += (dx / dl) * Math.min(step, dl); c.pos.z += (dz / dl) * Math.min(step, dl); }
        c.group.rotation.y = Math.atan2(dx, dz);
        c.group.rotation.z = Math.max(-0.25, Math.min(0.25, -(dx) * 0.01));
      }
      // arrived: set the player down and let the bird leave
      if (dl < 1.6 && c.pos.y < floorAt(D.x, D.z) + 2.0) {
        const gy = floorAt(D.x, D.z);
        P.pos.set(D.x, gy, D.z); P.vy = 0; P.grounded = true;
        if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(P.pos);
        g.cityChopperRide = false;
        c.phase = "leaving";
        // (CUT: "🚁 Dropped at X." — your feet are on the ground and the bird
        // is climbing away over your head; the world already said it.)
      }
      return;
    }

    if (c.phase === "leaving") {
      g.cityChopperRide = false;
      c.pos.y += HELI_CLIMB * dt;
      const out = edgePoint(c.pos.x, c.pos.z, c.pos.y);
      const dx = out.x - c.pos.x, dz = out.z - c.pos.z, dl = Math.hypot(dx, dz) || 1;
      c.pos.x += (dx / dl) * HELI_SPEED * dt; c.pos.z += (dz / dl) * HELI_SPEED * dt;
      c.group.rotation.y = Math.atan2(dx, dz);
      if (c.pos.y > CRUISE_Y + 18) { despawnChopper(); chopperCD = CHOPPER_CD; }
      return;
    }
  }

  // ============================================================ AIRSTRIKE =====
  function strikeTarget() {
    const wp = (CBZ.fullMap && CBZ.fullMap.waypoint) ? CBZ.fullMap.waypoint() : null;
    if (wp && wp.x != null) return { x: wp.x, z: wp.z, label: wp.label || "waypoint" };
    const P = player(); if (!P) return null;
    const y = (CBZ.cam && CBZ.cam.yaw) || 0;
    return { x: P.pos.x - Math.sin(y) * 34, z: P.pos.z - Math.cos(y) * 34, label: "your sights" };
  }

  function makeStrikeJet(tgt) {
    const r = arenaRoot(); if (!r) return null;
    const a = assets();
    const grp = new THREE.Group();
    const body = new THREE.Mesh(a.jetBody, a.matJet); grp.add(body);
    const nose = new THREE.Mesh(a.jetNose, a.matJet); nose.rotation.x = -Math.PI / 2; nose.position.z = 5.3; grp.add(nose);
    const wing = new THREE.Mesh(a.jetWing, a.matJet); wing.position.z = -0.4; grp.add(wing);
    const tail = new THREE.Mesh(a.jetTail, a.matJet); tail.position.set(0, 0.8, -3.8); grp.add(tail);
    const burn = new THREE.Mesh(a.burn, a.flameMat); burn.scale.set(0.7, 0.7, 1.4); burn.position.z = -4.7; grp.add(burn);
    r.add(grp);
    const sp = edgePoint(tgt.x, tgt.z, STRIKE_Y);
    grp.position.set(sp.x, STRIKE_Y, sp.z);
    const dir = new THREE.Vector3(tgt.x - sp.x, 0, tgt.z - sp.z); dir.y = 0; dir.normalize();
    grp.rotation.y = Math.atan2(dir.x, dir.z);
    return { group: grp, burn, dir, pos: grp.position, target: tgt, life: 0, dropped: false };
  }

  function despawnStrike() {
    if (!strike) return;
    if (strike.group && strike.group.parent) strike.group.parent.remove(strike.group);
    disposeGroup(strike.group);
    strike = null;
  }

  function dropBomb(j) {
    const r = arenaRoot(); if (!r) { detonateStrike(j.target); return; }
    const a = assets();
    const b = new THREE.Mesh(a.bomb, a.bombMat);
    b.position.copy(j.pos); b.rotation.x = Math.PI / 2;
    r.add(b);
    j._bomb = { mesh: b, vx: j.dir.x * 28, vz: j.dir.z * 28, vy: -2, t: 0 };
    if (CBZ.sfx) CBZ.sfx("whoosh");
  }

  function detonateStrike(tgt) {
    if (CBZ.cityAirstrikeExplosion) {
      CBZ.cityAirstrikeExplosion(tgt.x, tgt.z, { power: 3.0, radius: 16, byPlayer: true, y: 0.4 });
    } else if (CBZ.cityExplosion) {
      CBZ.cityExplosion(tgt.x, tgt.z, { power: 2.6, radius: 13, byPlayer: true });
    }
    if (CBZ.shake) CBZ.shake(1.1);
  }

  function updateStrike(dt) {
    if (!strike) return;
    const j = strike;
    j.life += dt;
    const step = STRIKE_SPD * dt;
    j.pos.x += j.dir.x * step; j.pos.z += j.dir.z * step;
    if (j.burn) j.burn.scale.z = 1.4 + Math.sin(j.life * 30) * 0.4;
    // THE JET IS THE ALERT: a repeating engine roar keyed to its true distance
    // from the player — sfx's dist handling attenuates it and swaps to the
    // muffled far-field bus past 60u, so it starts as a far-off rumble at the
    // city edge and swells into a hard overhead roar on the pass. force+ghost
    // so the 0.55s cadence never starves (or is starved by) other rumbles.
    if (CBZ.sfx) {
      j._sndT = (j._sndT == null ? 0 : j._sndT) - dt;
      if (j._sndT <= 0) {
        j._sndT = 0.55;
        const P = CBZ.player;
        const d = P ? Math.hypot(j.pos.x - P.pos.x, j.pos.z - P.pos.z) : 999;
        CBZ.sfx("rumble", { dist: d, volume: 0.9, force: true, ghost: true });
        if (d < 55) CBZ.sfx("wind", { dist: d, volume: 1.0, force: true, ghost: true });  // close pass: the air itself tears
      }
    }
    // release the bomb near the run-in to the target
    if (!j.dropped) {
      const dx = j.pos.x - j.target.x, dz = j.pos.z - j.target.z;
      if (dx * dx + dz * dz < STRIKE_DROP * STRIKE_DROP) { j.dropped = true; dropBomb(j); }
    }
    // fly the dropped bomb down onto the mark
    if (j._bomb) {
      const bm = j._bomb; bm.t += dt; bm.vy -= 20 * dt;
      bm.mesh.position.x += bm.vx * dt; bm.mesh.position.z += bm.vz * dt; bm.mesh.position.y += bm.vy * dt;
      const gy = floorAt(j.target.x, j.target.z);
      const near = Math.hypot(bm.mesh.position.x - j.target.x, bm.mesh.position.z - j.target.z) < 4;
      if (bm.mesh.position.y <= gy + 0.6 || (near && bm.t > 0.4) || bm.t > 4) {
        detonateStrike(j.target);
        if (bm.mesh.parent) bm.mesh.parent.remove(bm.mesh);
        j._bomb = null;
      }
    }
    if (j.life > 7) despawnStrike();
  }

  // ============================================================ API ===========
  CBZ.cityCallChopper = function () {
    if (g.mode !== "city" || g.state !== "playing") return false;
    if (!canChopper()) { note("🚁 No chopper. Own THE APEX PENTHOUSE — a personal chopper comes parked on its rooftop pad.", 3.6); return false; }
    if (chopper) { note("🚁 Your chopper is already on the way.", 2); return false; }
    if (chopperCD > 0) { note("🚁 Chopper refueling — " + Math.ceil(chopperCD) + "s.", 2); return false; }
    const P = player(); if (!P) return false;
    chopper = makeChopper(P);
    if (!chopper) { note("🚁 Chopper unavailable right now.", 2); return false; }
    note("🚁 Personal chopper inbound — stand clear, then walk under it to board.", 3.6);
    if (CBZ.sfx) CBZ.sfx("whoosh");
    return true;
  };

  CBZ.cityCallAirstrike = function (tgt) {
    if (g.mode !== "city" || g.state !== "playing") return false;
    if (!canStrike()) {
      note(ownsPenthouse()
        ? "🎯 No jet yet. Buy the HANGAR add-on at your home [H] to base an F-22."
        : "🎯 No hangar. Own the Apex Penthouse, then buy its deck hangar to base an attack jet.", 3.8);
      return false;
    }
    if (strikeCD > 0) { note("🎯 Jet rearming — " + Math.ceil(strikeCD) + "s.", 2); return false; }
    tgt = tgt || strikeTarget();
    if (!tgt) { note("🎯 No target — set a waypoint [M] or aim at the ground.", 2.6); return false; }
    if (((g.cash || 0) + (g.cityBank || 0)) < STRIKE_COST) { note("🎯 An airstrike costs " + money(STRIKE_COST) + ".", 2.6); return false; }
    charge(STRIKE_COST);
    strikeCD = STRIKE_CD;
    strike = makeStrikeJet(tgt);
    // calling in military ordnance is a felony spectacle — the law notices.
    if (CBZ.city && CBZ.city.addHeat) CBZ.city.addHeat(260);
    // (CUT: the "🎯 AIRSTRIKE INBOUND" centre flash. In real life nothing pops
    // up to tell you a jet is coming — you HEAR it: updateStrike() drives a
    // swelling engine roar from the moment it crosses the city edge. The only
    // words are the read-back below — YOUR pilot confirming YOUR tasking, a
    // notification from a person, on the quiet feed.)
    note("📻 Pilot: \"Copy — running in on " + (tgt.label || "the mark") + ". Keep your head down.\"", 3);
    return true;
  };

  // status object the phone renders its aviation card from
  CBZ.cityAirServices = function () {
    return {
      helipad: canChopper(), hangar: canStrike(), penthouse: ownsPenthouse(),
      chopperReady: canChopper() && !chopper && chopperCD <= 0,
      chopperCD: Math.max(0, Math.ceil(chopperCD)), chopperActive: !!chopper,
      strikeReady: canStrike() && strikeCD <= 0,
      strikeCD: Math.max(0, Math.ceil(strikeCD)), strikeCost: STRIKE_COST,
      riding: !!g.cityChopperRide,
    };
  };

  function teardown() { despawnChopper(); despawnStrike(); chopperCD = 0; strikeCD = 0; g.cityChopperRide = false; }
  CBZ.cityClearPlayerAir = teardown;

  // ---- tick (after player physics @10 so the ride pos override wins) ---------
  CBZ.onUpdate(42.5, function (dt) {
    if (g.mode !== "city") { if (chopper || strike) teardown(); return; }
    if (chopperCD > 0) chopperCD = Math.max(0, chopperCD - dt);
    if (strikeCD > 0) strikeCD = Math.max(0, strikeCD - dt);
    if (g.state !== "playing") return;
    updateChopper(dt);
    updateStrike(dt);
  });
})();
