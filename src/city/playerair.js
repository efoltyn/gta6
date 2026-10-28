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
   is the player's and the state's side: CBZ.cityStrikeFlight is the ONE
   strike flight every bombing aeroplane flies (your phone's F-35, a
   President's strike package, an enemy air raid — city/warroom.js — and the
   bunker map table's B-52 cell, city/strategic.js CBZ.strategicCallStrike).
   The aeroplanes are the units (units/vehicles/f35.js, b52.js,
   b2_spirit.js, through city/unitmodels.js): the same airframes your hangar
   keeps and Fort Brandt parks, their bays opening for the release.

   Exposes: CBZ.cityCallChopper, CBZ.cityCallAirstrike, CBZ.cityAirServices
            (status for the phone), CBZ.cityClearPlayerAir, CBZ.cityStrikeFlight.
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;
  // seeded LCG (project convention — NEVER Math.random). Was aliased straight
  // to Math.random; fixed while this module is open for the flight-physics pass.
  let _s = 47711;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }

  // SHAPE HELPERS (r128) — local copies of aircraft.js's sculptors (builders
  // stay self-contained per file by project convention). taperBox scales each
  // vertex's X/Y by a factor that depends on its Z (nose=+Z → nz, tail=-Z →
  // tz), with optional roofline (top) / keel (bot) narrowing.
  // taperBox lives ONCE in world/carfx.js now (was copied into 6 builders).
  function taperBox(w, h, d, opt) { return CBZ.taperBox(w, h, d, opt); }
  // one thin tapered/drooped rotor blade geometry rooted at the hub (extends +X)
  function bladeGeo(len, droop) {
    const geo = new THREE.BoxGeometry(len, 0.06, 0.34, 6, 1, 1);
    const pos = geo.attributes.position, hl = len / 2;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), t = (x + hl) / len;
      pos.setX(i, x + hl);                                   // root at origin, +X
      pos.setZ(i, pos.getZ(i) * (1 - 0.45 * t));
      pos.setY(i, pos.getY(i) - (droop || 0) * t * t);
    }
    pos.needsUpdate = true; geo.computeVertexNormals();
    return geo;
  }
  // env-mapped vehicle materials (carfx.js roles: paint/glass/chrome/metal/
  // interior/…) with a flat-Lambert fallback. These craft spawn at RUNTIME
  // (phone calls), so carfx is loaded long before the first summon.
  function vmat(role, color, opts) {
    if (CBZ.vehicleMat) { try { return CBZ.vehicleMat(role, color, opts); } catch (e) {} }
    return CBZ.mat ? CBZ.mat(color, opts) : new THREE.MeshLambertMaterial({ color: color });
  }

  // ---- tunables -------------------------------------------------------------
  const CRUISE_Y    = 48;     // ride cruise altitude (clears every core-tower parapet at FH=4.6)
  const HELI_SPEED  = 30;     // m/s lateral (a personal heli is quick)
  const HELI_CLIMB  = 14;     // m/s vertical
  const BOARD_DIST  = 3.2;    // walk this close to a landed chopper to board
  const LAND_WAIT   = 14;     // s a landed chopper waits before giving up
  const CHOPPER_CD  = 18;     // s between chopper calls (refuel)
  const STRIKE_COST = 5000;   // $ per airstrike
  const STRIKE_CD   = 40;     // s jet rearm

  // ---- shared state ---------------------------------------------------------
  let G = null;               // lazy geom/mat cache
  let chopper = null;         // active personal heli or null
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
  // comes with the penthouse; a head of state has one too (his aide sends it, city/phone_apps.js)
  function canChopper() { return !!g.cityOwnsHeli || !!(CBZ.warroom && CBZ.warroom.nation && CBZ.warroom.nation()); }
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
      // ---- YOUR CHOPPER: a warm yellow/white executive taxi — instantly reads
      // as "the friendly one" against the black-and-white police airframes.
      matCab:  shared(vmat('paint', 0xe8b23c)),           // warm taxi yellow
      matRoof: shared(vmat('paint', 0xf2f3f5)),           // white roof / boom / accents
      matTrim: shared(vmat('metal', 0x3c434c)),           // skids / struts / rotor head
      matSeat: shared(vmat('interior', 0x14171c)),        // seats + dark insets
      matBlade:shared(vmat('metal', 0x1e242b)),           // solid rotor blades
      matGlow: M(0xffd98a, { emissive: 0xffd98a, ei: 0.7 }),   // warm landing-light bar
      // ONE-OFF transparent bubble glass: the shared carfx 'glass' is opaque on
      // purpose (sort cost at 100s of cars), but a single summoned chopper can
      // afford true see-through panes — you SEE the seats you're about to take.
      matBubble: shared(new THREE.MeshStandardMaterial({
        color: 0x9fc6d8, metalness: 0.55, roughness: 0.08,
        transparent: true, opacity: 0.42, depthWrite: false, envMap: (CBZ.ENV || null),
      })),
      // friendly heli — sculpted cab, glass bubble, tapered boom
      heliBody: shared(taperBox(2.0, 1.35, 4.4, { nz: 0.5, tz: 0.45, top: 0.72, bot: 0.62, segD: 8 })),
      heliBubble:shared(taperBox(1.65, 0.95, 2.0, { nz: 0.45, tz: 0.95, top: 0.55 })),   // glass bubble cabin
      heliRoof: shared(taperBox(1.7, 0.26, 2.6, { nz: 0.6, tz: 0.55, top: 0.7 })),       // white roof cap under the mast
      heliSeat: shared(new THREE.BoxGeometry(0.62, 0.16, 0.55)),  // seat cushion
      heliSeatBack: shared(new THREE.BoxGeometry(0.62, 0.6, 0.16)),
      heliBoom: shared(taperBox(0.55, 0.55, 3.0, { tz: 0.45, top: 0.8, bot: 0.8 })),     // tapered tail boom
      heliFin:  shared(taperBox(0.18, 1.05, 0.7, { tz: 0.5, top: 0.55 })),
      heliStab: shared(new THREE.BoxGeometry(1.6, 0.12, 0.6)),
      heliSkid: shared(taperBox(0.16, 0.16, 3.6, { nz: 0.5, tz: 0.5 })),
      heliStrut:shared(new THREE.BoxGeometry(0.18, 0.6, 0.18)),   // chunky — thin members float at distance
      heliHub:  shared(new THREE.CylinderGeometry(0.22, 0.28, 0.24, 8)),
      heliPlate:shared(new THREE.CylinderGeometry(0.3, 0.36, 0.1, 8)),   // swashplate under the hub
      glowStrip:shared(new THREE.BoxGeometry(0.55, 0.16, 0.14)),  // nose landing light
      rotorBlade:shared(bladeGeo(4.4, 0.12)),                    // one tapered blade (rooted at hub, +X)
      rotorDisc:shared(new THREE.CircleGeometry(4.5, 20)),       // spin blur disc
      rotorTail:shared(new THREE.BoxGeometry(0.05, 1.4, 0.26)),  // one tail blade
      navBead:  shared(new THREE.BoxGeometry(0.15, 0.15, 0.15)),
      rotorMat: shared(new THREE.MeshBasicMaterial({ color: 0x0e1015, transparent: true, opacity: 0.5, depthWrite: false })),
      navR:     shared(new THREE.MeshBasicMaterial({ color: 0xff2a22 })),
      navG:     shared(new THREE.MeshBasicMaterial({ color: 0x18ff3a })),
      navW:     shared(new THREE.MeshBasicMaterial({ color: 0xeaf4ff })),
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
  // Mesh-only builder (no scene/player dependency) — used by makeChopper below
  // and exposed for tools/studio.mjs asset photography (CBZ.debugBuildPlayerAir).
  function buildChopperGroup() {
    const a = assets();
    const grp = new THREE.Group();
    // warm yellow cab with a white roof cap — a flying taxi, not a warbird
    const body = new THREE.Mesh(a.heliBody, a.matCab); grp.add(body);
    const roof = new THREE.Mesh(a.heliRoof, a.matRoof); roof.position.set(0, 0.72, -0.4); grp.add(roof);
    // TRANSPARENT glass bubble over the nose — the two seats read through it
    const canopy = new THREE.Mesh(a.heliBubble, a.matBubble); canopy.position.set(0, 0.42, 1.2); grp.add(canopy);
    for (const sx of [-0.42, 0.42]) {
      const cush = new THREE.Mesh(a.heliSeat, a.matSeat); cush.position.set(sx, -0.12, 0.55); grp.add(cush);
      const back = new THREE.Mesh(a.heliSeatBack, a.matSeat); back.position.set(sx, 0.12, 0.22); grp.add(back);
    }
    // tapered tail boom (white) — front sunk into the rear of the cabin (no gap)
    const boom = new THREE.Mesh(a.heliBoom, a.matRoof);
    boom.position.set(0, 0.34, -3.3); grp.add(boom);
    const fin = new THREE.Mesh(a.heliFin, a.matCab); fin.position.set(0, 0.85, -4.45); grp.add(fin);
    const stab = new THREE.Mesh(a.heliStab, a.matRoof); stab.position.set(0, 0.34, -4.2); grp.add(stab);
    // nose landing light (warm glow) low on the chin
    const glow = new THREE.Mesh(a.glowStrip, a.matGlow); glow.position.set(0, -0.28, 2.1); grp.add(glow);
    // skids on angled struts that meet the tapered belly
    for (const sx of [-1, 1]) {
      const skid = new THREE.Mesh(a.heliSkid, a.matTrim); skid.position.set(sx * 0.85, -0.95, 0.1); grp.add(skid);
      for (const sz of [1.1, -0.9]) {
        const st = new THREE.Mesh(a.heliStrut, a.matTrim);
        st.position.set(sx * 0.72, -0.62, sz); st.rotation.z = sx * 0.42; grp.add(st);
      }
    }
    // rotor head: swashplate + mast hub + two REAL tapered blades + blur disc
    // (named `rotor` group spun by updateChopper — the contract is unchanged)
    const plate = new THREE.Mesh(a.heliPlate, a.matTrim); plate.position.set(0, 0.9, -0.2); grp.add(plate);
    const hub = new THREE.Mesh(a.heliHub, a.matTrim); hub.position.set(0, 1.04, -0.2); grp.add(hub);
    const rotor = new THREE.Group(); rotor.position.set(0, 1.1, -0.2);
    rotor.add(new THREE.Mesh(a.rotorBlade, a.matBlade));                  // +X blade
    const opp = new THREE.Group(); opp.rotation.y = Math.PI; opp.add(new THREE.Mesh(a.rotorBlade, a.matBlade)); rotor.add(opp);   // -X blade
    grp.add(rotor);
    const disc = new THREE.Mesh(a.rotorDisc, a.rotorMat); disc.rotation.x = -Math.PI / 2; disc.position.set(0, 1.08, -0.2); grp.add(disc);
    // tail rotor on the boom's starboard side (group spun about local X)
    const trotor = new THREE.Group(); trotor.position.set(0.17, 0.68, -4.55);
    const tb1 = new THREE.Mesh(a.rotorTail, a.matBlade); trotor.add(tb1);
    const tb2 = new THREE.Mesh(a.rotorTail, a.matBlade); tb2.rotation.x = Math.PI / 2; trotor.add(tb2);
    grp.add(trotor);
    // nav lights: port red / stbd green low on the cab, white beacon on the fin
    const nL = (m, x, y, z) => { const b = new THREE.Mesh(a.navBead, m); b.position.set(x, y, z); grp.add(b); };
    nL(a.navR, -0.74, -0.3, 0.5); nL(a.navG, 0.74, -0.3, 0.5); nL(a.navW, 0, 1.32, -4.45);
    // tag the spinnables on the group too, so external consumers (the campaign
    // prologue reuses this exact airframe via CBZ.debugBuildPlayerAir) can
    // spin the blades without holding our internal refs
    grp.userData.rotor = rotor;
    grp.userData.trotor = trotor;
    return { grp, rotor, trotor };
  }

  function makeChopper(P) {
    const r = arenaRoot(); if (!r) return null;
    const built = buildChopperGroup();
    const grp = built.grp, rotor = built.rotor, trotor = built.trotor;
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
      // descend only once roughly over the pad — GROUND EFFECT (shared aero
      // core, same curve the gunship/player heli use) gently slows the final
      // few metres of descent so the touchdown reads like a real rotor
      // cushioning on its own downwash, not a lift snapping to a stop.
      let vstep = HELI_CLIMB * dt;
      if (CBZ.aeroPhysics && dy < 0) {
        const gMul = CBZ.aeroPhysics.groundEffectMul(Math.max(0, c.pos.y - L.y), 9.4);
        vstep *= 1 / gMul;   // bigger ground-effect bonus → smaller allowed descent step
      }
      if (dl < 6) c.pos.y += Math.max(-vstep, Math.min(vstep, dy));
      c.group.rotation.y = Math.atan2(dx, dz);
      if (dl < 0.8 && Math.abs(dy) < 0.6) { c.phase = "landed"; c.waitT = LAND_WAIT; note("Chopper down, walk under it to board.", 3); }
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
      if (c.waitT <= 0) { c.phase = "leaving"; note("Chopper left without you.", 2.2); }
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

  /* ==========================================================================
     STRIKE FLIGHTS — ONE system for every aeroplane that bombs something.

     The phone's F-35, a President's strike package (city/warroom.js), an
     enemy air raid and the bunker map table's B-52 cell (city/strategic.js's
     CBZ.strategicCallStrike) are the same thing: N real aeroplanes that run
     in along a heading, release real stores over their aimpoints, and fly on
     out. Every store leaves its own station through city/strategic.js's
     CBZ.strategicRelease — the B-2's own release — so the fall is the solved
     arc (g = 9.81, light drag), the mesh is the real pooled round, and the
     impact is CBZ.detonate on the bus with the structural ledger behind it.
     There is no second bomb sim and no second flight sim here: a B-52 cell
     is this same loop flying a different AIRFRAME row.

       CBZ.cityStrikeFlight(opts) -> flight | null
         x, z         the aimpoint (required): the centre of the stick
         airframe     "f35" (default) | "b52" | "b2"      (the AIRFRAME rows)
         kind         the store: f35 "bomb" (default) | "jdam" | "nuke";
                      b52 "mk82" (the bay, default) | "jdam" (the wing HSABs);
                      b2 "bomb" (Mk-84 on the rotary launchers, default) | "jdam"
         jets         aeroplanes: f35 1..4 in echelon (default 1); heavies
                      1..3 in a loose trail, each stepped right/left and up
         bombs        stores per aeroplane, walked along the track (f35
                      default 2, max 6; b52 bay max 27; b2 max 16; heavies
                      default to the full load)
         stick        the stick's length along track, m (heavies: default
                      ~25-30 m between impacts); the ripple interval is
                      stick / ground speed / (bombs - 1)
         from {x,z}   where the flight comes from (sets the heading); else
         heading      radians; else from the arena centre outward
         alt, speed   pass altitude AGL (f35 95 m, 210 for a nuke; heavies
                      900 m) and m/s (f35 140, heavies 200)
         tot          s from now to the first impact, if there is room
         by/byPlayer  blame, forwarded to the release (byPlayer default true)
         stateAct     an act of state: no street crime billed for a nuke
         side         "ours" | "enemy" (bookkeeping for callers)
         onImpact(im, flight, n)  each store landing, n = 1 for the first
         onDone(flight)           every aeroplane is clear and every store has landed
     The aeroplanes spawn far enough back down the heading to be seen running
     in (an F-35 RUNIN 1.4 km; a heavy its release lead plus ~10 s), so a
     strike across the map still has its aeroplanes: they fly there.

     THE LEAD IS SOLVED, PER AIMPOINT, OFF THE SAME SOLVER THE BOMB FLIES
     (CBZ.strategicFall): the flight is straight and level at constant speed,
     so a store let go at a station with the airframe's velocity lands a fixed
     carry ahead — 13.6 s and ~2.5 km for a Mk-82 from 900 m at 200 m/s. Each
     store goes the instant ITS station crosses ITS release point, sub-frame
     (strategicRelease opts.age): a B-52's 27 Mk-82s ripple out in well under
     a second and every one still lands on its mark.

     THE BOMBS KEEP THE AEROPLANE'S VELOCITY ON A HEAVY. The F-35 path keeps
     aircraft.js's BOMBS_DROP_STRAIGHT law (8% residual) exactly as it was. A
     carpet from 900 m under that law would fall as a vertical curtain under
     the bay; real iron carries the bomber's 200 m/s, streams out behind and
     below it as drag bleeds it off, and lands 2.5 km downrange — which is
     what a heavy's lead is solved for, and what this owner asked to SEE.    */
  const FLIGHT = { RUNIN: 1400, RUNOUT: 900, SPD: 140, ALT: 95, STICK: 18, MAX: 6, LIFE: 60 };
  /* THE AIRFRAMES. A row is everything that differs between a fighter's two
     JDAMs and a cell of B-52s; the loop below reads only the row.
       model     how the aeroplane is built (unitmodels kind, or the B-2's adapter)
       jets/per  caps; per0 the default load; lat/back/step the formation
       spacing   default metres between impacts in a stick
       residual  the release law's keep-fraction (null = aircraft.js's default)
       eject     m/s the station pushes the store down (clip vs ejector)
       radius    lock-on radius                                          */
  const AIRFRAME = {
    f35: { model: "jet", jets: 4, per: 6, per0: 2, alt: FLIGHT.ALT, spd: FLIGHT.SPD, lat: 18, back: 32, step: 3,
      spacing: FLIGHT.STICK, residual: null, eject: null, radius: 3.2, heavy: false, kind: "bomb", label: "F-35A" },
    // B-52H: 27 Mk-82 on the bay's clips (gravity release), 12 GBU-31 on the
    // wing HSABs (ejector). A cell flies in trail; for the camera the trail is
    // ~480 m, not the 1-2 km a real cell keeps.
    b52: { model: "bomber", jets: 3, per: 27, perJdam: 12, per0: 27, alt: 900, spd: 200, lat: 55, back: 480, step: 45,
      spacing: 25, residual: 1, eject: 0.6, ejectJdam: 2.5, radius: 26, heavy: true, kind: "mk82", label: "B-52H" },
    // B-2A: two rotary launchers of eight 2,000 lb weapons each, ejected
    b2:  { model: "b2", jets: 3, per: 16, per0: 16, alt: 900, spd: 200, lat: 60, back: 520, step: 45,
      spacing: 30, residual: 1, eject: 2.0, radius: 24, heavy: true, kind: "bomb", label: "B-2A" },
  };
  const DOOR_LEAD = 5.5;             // s: a heavy's doors start to swing this long before its first release
  const DOOR_HOLD = 1.5;             // s: and start to close this long after its last
  /* THE BREAKAWAY. A heavy does not hold the bomb-run heading over its own
     stick: a few seconds after its last store it rolls into the post-target
     turn (b52.js tactics: "turns away on a 46 deg bank"; here a gentler 30
     deg the camera can follow) and turns off the line at the coordinated rate
     g·tan(bank)/v — 1.6 deg/s at 200 m/s — and rolls out on an egress
     heading 50 deg off the run. The whole cell turns the same way, in trail. */
  const BREAK = { DELAY: 3.0, BANK: 30 * Math.PI / 180, ROLL: 8 * Math.PI / 180, TURN: 50 * Math.PI / 180 };   // rolls out 50 deg off the run
  const G_TURN = 9.81;               // a coordinated turn's g (aerodynamics, not the bombs' fall)
  const flights = [];
  const _relP = { x: 0, y: 0, z: 0 };
  const _fall = { t: 0, x: 0, y: 0, z: 0, speed: 0 };
  if (CBZ.ordnanceSite) { try { CBZ.ordnanceSite("playerair:strike", "bomb"); } catch (e) {} }

  /* THE STRIKE AEROPLANES ARE THE UNITS (units/vehicles/f35.js, b52.js,
     b2_spirit.js, through city/unitmodels.js): one model per machine. null
     until the unit file is on the page (wantModel asks for it; a flight's
     aeroplanes are built the frame it lands, kilometres out, long before
     anyone can see them). The F-35's pilot is in it and its bays carry a
     2,000 lb JDAM each; the B-52's bay carries its Mk-82s; the B-2's two
     rotary launchers their Mk-84s. */
  function wantModel(af) {
    const M = CBZ.milModels;
    const kind = af && af.model === "bomber" ? "bomber" : af && af.model === "b2" ? "b2_spirit" : "jet";
    if (M && M.load && !(M.has && M.has(kind))) { try { M.load([kind]); } catch (e) {} }
  }
  function buildStrikeJet(af) {
    af = af || AIRFRAME.f35;
    const M = CBZ.milModels;
    if (af.model === "b2") {
      // the B-2 adapter (city/strategic.js makeB2): doors, gear and the
      // launcher spend are handles on its group; it asks for its own file
      const S = CBZ.strategicModels;
      const made = S && S.b2 ? S.b2() : null;
      if (!made || !made.group) return null;
      const ud = made.group.userData;
      if (ud.pilot) ud.pilot.visible = true;
      return { grp: made.group, rig: ud.rig || null, veh: ud.unitVeh || null };
    }
    const kind = af.model === "bomber" ? "bomber" : "jet";
    if (!(M && M.has && M.has(kind))) { wantModel(af); return null; }
    const made = M[kind]();
    if (!made || !made.group) return null;
    const grp = made.group, ud = grp.userData;
    if (ud.pilot) ud.pilot.visible = true;            // somebody is flying this one
    const R = made.rig && made.rig.state;
    if (R && af.model === "jet") R.load = "jdam";
    return { grp: grp, rig: made.rig, veh: made.veh || ud.unitVeh || null };
  }

  function flightHeading(tx, tz, opts) {
    let hx, hz;
    if (opts.from && isFinite(opts.from.x) && isFinite(opts.from.z)) { hx = tx - opts.from.x; hz = tz - opts.from.z; }
    else if (opts.heading != null && isFinite(opts.heading)) { hx = Math.sin(opts.heading); hz = Math.cos(opts.heading); }
    else {
      const a = CBZ.city && CBZ.city.arena;
      hx = tx - (a && a.center ? a.center.x : 0); hz = tz - (a && a.center ? a.center.z : 0);
    }
    const l = Math.hypot(hx, hz);
    return l > 1 ? { x: hx / l, z: hz / l } : { x: 0, z: 1 };
  }

  // where a store released from height y over the ground near (ax,az) with
  // velocity rv lands, as a carry (m along the heading) and a fall time — the
  // bomb's own solve (city/strategic.js), sampled so the landing is ON the
  // aimpoint (a roof there is a roof). Without strategic.js nothing falls:
  // the degrade blast lands on the mark the moment the jet is over it.
  function leadFor(kind, ax, az, y, rv, h) {
    const F = CBZ.strategicFall;
    if (!F) return { lead: 0, tf: 0 };
    let L = 0, t = 0;
    for (let i = 0; i < 2; i++) {
      const x0 = ax - h.x * L, z0 = az - h.z * L;
      F(kind, x0, y, z0, rv.vx, rv.vy, rv.vz, _fall);
      t = _fall.t;
      L = (_fall.x - x0) * h.x + (_fall.z - z0) * h.z;
    }
    return { lead: L, tf: t };
  }

  function strikeFlight(opts) {
    opts = opts || {};
    if (g.mode !== "city") return null;
    const r = arenaRoot(); if (!r) return null;
    const tx = +opts.x, tz = +opts.z;
    if (!isFinite(tx) || !isFinite(tz)) return null;
    if (flights.length >= FLIGHT.MAX) return null;
    const afId = AIRFRAME[opts.airframe] ? opts.airframe : "f35";
    const af = AIRFRAME[afId];
    let kind = opts.kind || af.kind;
    // a heavy carries what its bays carry
    if (afId === "b52" && kind !== "jdam") kind = "mk82";
    if (afId === "b2" && kind !== "jdam" && kind !== "nuke" && kind !== "buster") kind = "bomb";
    const hsab = afId === "b52" && kind === "jdam";
    const nJets = Math.max(1, Math.min(af.jets, (opts.jets | 0) || 1));
    const perMax = hsab ? af.perJdam : af.per;
    const per = Math.max(1, Math.min(perMax, (opts.bombs | 0) || (af.heavy ? perMax : af.per0)));
    const spd = opts.speed > 0 ? +opts.speed : af.spd;
    const h = flightHeading(tx, tz, opts);
    const agl = opts.alt > 0 ? +opts.alt : (kind === "nuke" && !af.heavy ? 210 : af.alt);
    const y = floorAt(tx, tz) + agl;
    const stick = per > 1 ? (opts.stick > 0 ? +opts.stick : af.spacing * (per - 1)) : 0;
    // THE RELEASE VELOCITY, once: the flight is straight and level, so every
    // store leaves with the same velocity. aircraft.js's release law says what
    // a store keeps of the airframe's speed (a heavy keeps all of it).
    const craft = { vx: h.x * spd, vy: 0, vz: h.z * spd };
    const lawOpts = {};
    if (af.residual != null) lawOpts.residual = af.residual;
    const ej = hsab ? af.ejectJdam : af.eject;
    if (ej != null) lawOpts.eject = ej;
    let rv = null;
    if (CBZ.ordnanceDropVel) { try { rv = CBZ.ordnanceDropVel("playerair:strike", craft, { vx: 0, vy: 0, vz: 0 }, lawOpts); } catch (e) { rv = null; } }
    if (!rv) rv = { vx: craft.vx * (af.residual != null ? af.residual : 1), vy: -(ej != null ? ej : 1.5), vz: craft.vz * (af.residual != null ? af.residual : 1) };
    const f = {
      kind: kind, airframe: afId, tx: tx, tz: tz, hx: h.x, hz: h.z, spd: spd, y: y, t: 0,
      rv: { vx: rv.vx, vy: rv.vy, vz: rv.vz }, tf: 0, lead: 0, stick: stick,
      interval: per > 1 ? stick / spd / (per - 1) : 0,
      jets: [], impacts: [], hits: 0, released: 0, total: nJets * per, sndT: 0,
      by: opts.by, byPlayer: opts.byPlayer !== false, stateAct: !!opts.stateAct,
      label: opts.label || "", side: opts.side || "ours", data: opts.data || null,
      onImpact: typeof opts.onImpact === "function" ? opts.onImpact : null,
      onDone: typeof opts.onDone === "function" ? opts.onDone : null,
      finished: false, gone: false,
    };
    f.yaw = Math.atan2(h.x, h.z); f.root = r; f.agl = agl; f.af = af; f.hsab = hsab; f.h = h;
    // the formation. F-35s: echelon, the lead on the line, wingmen alternating
    // right/left and back. Heavies: a loose trail — each one back down the
    // track, stepped out to alternate sides and up — each laying its own
    // stick under its own lane, so a cell lays a CARPET, not one line.
    const lane = [];
    for (let j = 0; j < nJets; j++) {
      const side = j === 0 ? 0 : (j % 2 ? 1 : -1);
      lane.push({ lat: side * Math.ceil(j / 2) * af.lat, back: (af.heavy ? j : Math.ceil(j / 2)) * af.back, up: j * af.step });
    }
    // the store's station sits a little below/above the airframe's origin
    const relDy = af.heavy ? 1.6 : 0.6;
    // the lead of the centre aimpoint at the lead aeroplane's height, solved
    // first, sets how far back the run-in starts
    const c0 = leadFor(kind, tx, tz, y + relDy, rv, h);
    f.lead = c0.lead; f.tf = c0.tf;
    let runin = FLIGHT.RUNIN;
    if (af.heavy) {
      // far enough back to see it run in: its doors swing ~DOOR_LEAD s before
      // the first store goes, and it is seen straight-and-level before that
      const minIn = c0.lead + stick / 2 + spd * (DOOR_LEAD + 4.5);
      runin = minIn;
      if (opts.tot > 0) runin = Math.max(minIn, (+opts.tot - c0.tf) * spd + c0.lead + stick / 2);
    }
    f.runin = runin;
    f.runout = af.heavy ? 3200 : FLIGHT.RUNOUT;
    let backMax = 0;
    for (let j = 0; j < nJets; j++) {
      const L = lane[j];
      backMax = Math.max(backMax, L.back);
      // (hz, -hx) is the unit to the right of the heading
      const jy = y + L.up;
      const pos = new THREE.Vector3(tx - h.x * (runin + L.back) + h.z * L.lat, jy, tz - h.z * (runin + L.back) - h.x * L.lat);
      // this aeroplane's stick: walked along the track through the aimpoint,
      // under its own lane, each with its OWN solved lead
      const aims = [];
      for (let k = 0; k < per; k++) {
        const d = per > 1 ? (k / (per - 1) - 0.5) * stick : 0;
        const ax = tx + h.x * d + h.z * L.lat, az = tz + h.z * d - h.x * L.lat;
        const ld = leadFor(kind, ax, az, jy + relDy, rv, h);
        aims.push({ x: ax, z: az, lead: ld.lead, tf: ld.tf });
      }
      const jt = { group: null, rig: null, veh: null, pos: pos, aims: aims, next: 0, flight: f, lat: L.lat,
        door: 0, lastRel: -1e9, doorTgt: { pos: { x: tx, y: floorAt(tx, tz), z: tz }, dead: false },
        yaw: f.yaw, hx: h.x, hz: h.z, bank: 0 };
      seatJet(jt);
      f.jets.push(jt);
    }
    // the first store lands this long from now (the lead aeroplane's first)
    const a0 = f.jets[0].aims[0];
    f.eta = (runin - (stick / 2) - a0.lead) / spd + a0.tf;
    f.life = af.heavy ? (runin + backMax + f.runout) / spd + c0.tf + 12 : FLIGHT.LIFE;
    flights.push(f);
    return f;
  }

  // the airframe on its track (now, or the frame its file lands)
  function seatJet(jt) {
    if (jt.group) return true;
    const f = jt.flight, af = f.af;
    const built = buildStrikeJet(af);
    if (!built) return false;
    built.grp.position.copy(jt.pos);
    built.grp.rotation.order = "YXZ";
    built.grp.rotation.set(0, jt.yaw != null ? jt.yaw : f.yaw, 0);
    built.grp.userData.dynamic = true;
    f.root.add(built.grp);
    jt.group = built.grp; jt.rig = built.rig; jt.veh = built.veh; jt.pos = built.grp.position;
    const R = jt.rig && jt.rig.state;
    if (f.airframe === "b52") {
      // the load: the bay's clips hold this stick (or nothing, if the stick
      // is the wing JDAMs), the HSABs hold the JDAMs or nothing — what is
      // drawn is exactly what is going to fall
      const W = jt.veh && jt.veh.wpn;
      const per = jt.aims.length - jt.next;
      if (W) for (let i = 0; i < W.length; i++) {
        if (W[i].w.id === "mk82_stick") W[i].ammo = f.hsab ? 0 : per;
        if (W[i].w.id === "gbu31_jdam") W[i].ammo = f.hsab ? per : 0;
      }
      // the crew are aboard and the radar navigator calls the doors
      // (b52.js: veh.you + a designated target opens the bay)
      if (CBZ.cityUnitCrew && jt.veh) { try { CBZ.cityUnitCrew(jt.veh, true); } catch (e) {} }
      if (jt.veh) jt.veh.tgt = null;
      // cruise pose: gear up, wings at their 1 g shape, doors shut
      if (jt.rig && jt.rig.settle) { try { jt.rig.settle({ agl: f.agl, speed: f.spd }); } catch (e) {} }
    } else if (f.airframe === "b2") {
      const ud = jt.group.userData;
      // a load of fewer than sixteen: the launchers carry only what will
      // fall, the port one the odd store (b2Spend starts on the port bay)
      if (R && R.bays && R.bays.length === 2) {
        const keep = jt.aims.length, nb = [Math.ceil(keep / 2), Math.floor(keep / 2)];
        for (let i = 0; i < 2; i++) {
          const B = R.bays[i], L = B.bombs.length, n = Math.min(L, nb[i]);
          for (let k = 0; k < L; k++) B.bombs[k].mesh.visible = k >= L - n;
          B.next = L - n; B.rot = -B.next * Math.PI / 4; B.rla.rotation.z = B.rot;
        }
      }
      if (ud.setGear) ud.setGear(0);
      if (ud.setBay) ud.setBay(0);
    }
    return true;
  }
  const _drive = { thr: 0.8, agl: 95, speed: 140, vy: 0, pilot: null };
  const _st = new THREE.Vector3(), _stM = new THREE.Matrix4();
  const _stShot = { wid: "mk82_stick", wi: 0, n: 0, w: null, kind: "bombs", mount: null, target: null };

  /* THE STATION a store leaves from, world space.
     B-52: its own clip in the bay (b52.js BAYSLOT: the bottom layer first,
       aft to fore, alternating sides) or its HSAB ejector — read off the
       rig's drawn stores (R.bay / R.jd instance k IS station k), because
       rig.muzzleWorld refreshes the whole scene graph's matrices per call
       and a stick asks 27 times a second.
     B-2: the bottom of the launcher the next store comes off (`bay`, or the
       port one when not given; the two sit side by side, so the along-track
       trigger is the same either way).
     F-35: under the belly (one JDAM a side). */
  function stationOf(jt, out, bay) {
    const f = jt.flight, rig = jt.rig, R = rig && rig.state;
    if (jt.group) jt.group.updateMatrixWorld(true);
    if (f.airframe === "b52" && R) {
      const im = f.hsab ? (R.jd && ((12 - R.ammo[1]) & 1 ? R.jd.R : R.jd.L)) : R.bay;
      if (im && im.count > 0) {
        // the stores drawn are the stores left, and the next one to go is the last instance drawn
        im.getMatrixAt(im.count - 1, _stM);
        out.setFromMatrixPosition(_stM);
        out.y -= 0.3;
        return im.parent ? im.parent.localToWorld(out) : out;
      }
      if (rig.muzzleWorld) {
        _stShot.wid = f.hsab ? "gbu31_jdam" : "mk82_stick";
        _stShot.n = f.hsab ? 12 - R.ammo[1] : 27 - R.ammo[0];
        try { const p = rig.muzzleWorld(out, _stShot); if (p && isFinite(p.x)) return out; } catch (e) {}
      }
    }
    if (f.airframe === "b2" && R && R.bays && R.bays.length) {
      const B = R.bays[bay != null && R.bays[bay] ? bay : 0];
      if (B.bombs[0] && B.rla.parent) {
        // the launcher's axle, then straight down its radius (in the bay's
        // frame, not the drum's: the drum turns, the release point does not)
        out.copy(B.rla.position); out.y -= B.bombs[0].home.length();
        return B.rla.parent.localToWorld(out);
      }
    }
    return out.set(jt.pos.x, jt.pos.y + (f.af.heavy ? 1.6 : 0.6), jt.pos.z);
  }

  // the store `a` leaves station `st`, `over` metres (along the track) after
  // its release point — so it actually left over/spd seconds ago, from back there
  function releaseFrom(jt, a, st, over) {
    const f = jt.flight;
    const ago = over > 0 ? over / f.spd : 0;
    // the store leaves its station: the drawn load is the load left
    const R = jt.rig && jt.rig.state;
    if (f.airframe === "b52") {
      const W = jt.veh && jt.veh.wpn;
      if (W) for (let i = 0; i < W.length; i++) if (W[i].w.id === (f.hsab ? "gbu31_jdam" : "mk82_stick")) W[i].ammo = Math.max(0, W[i].ammo - 1);
      if (jt.rig && jt.rig.fire) { _stShot.wid = f.hsab ? "gbu31_jdam" : "mk82_stick"; _stShot.target = null; try { jt.rig.fire(_stShot); } catch (e) {} }
    } else if (f.airframe === "b2") {
      // the launcher spends its bottom weapon (makeB2's b2Spend alternates the
      // bays); the store leaves from under THAT launcher
      const ud = jt.group && jt.group.userData;
      if (ud && ud.b2Spend && R && R.bays) {
        let bi = -1;
        const n0 = R.bays.map(function (B) { return B.next; });
        ud.b2Spend();
        for (let i = 0; i < R.bays.length; i++) if (R.bays[i].next !== n0[i]) bi = i;
        if (bi >= 0) st = stationOf(jt, _st, bi);
      }
    } else if (R && R.nJ < 2) R.nJ++;      // the F-35 carries one JDAM a side; a longer stick walks the rest off the same racks
    _relP.x = st.x - f.hx * over; _relP.y = st.y; _relP.z = st.z - f.hz * over;
    let b = null;
    if (CBZ.strategicRelease) {
      try { b = CBZ.strategicRelease(f.kind, _relP, f.rv, { by: f.by, byPlayer: f.byPlayer, stateAct: f.stateAct, age: ago }); } catch (e) { b = null; }
    }
    if (b && b.sol) f.impacts.push({ at: f.t - ago + (b.sol.t > 0 ? b.sol.t : a.tf), x: b.sol.x, z: b.sol.z, kind: f.kind });
    else f.impacts.push({ at: f.t - ago + a.tf, x: a.x, z: a.z, kind: f.kind, fallback: true });
    f.released++;
    jt.lastRel = f.t;
    // one release noise per beat: a B-52 rippling 27 in a second is a stick, not 27 whooshes
    if (CBZ.sfx && (jt.sfxT == null || f.t - jt.sfxT > 0.35)) { jt.sfxT = f.t; CBZ.sfx("whoosh"); }
  }

  // degrade path only: strategic.js absent, so nothing is falling — the bus
  // still prices the blast (or the plain explosion if even that is missing)
  function fallbackBlast(f, im) {
    const k = im.kind === "nuke" ? "bomb" : im.kind;
    if (CBZ.detonate) { try { CBZ.detonate(im.x, null, im.z, k, { byPlayer: f.byPlayer, by: f.by }); return; } catch (e) {} }
    if (CBZ.cityExplosion) { try { CBZ.cityExplosion(im.x, im.z, { power: 2.6, radius: 13, byPlayer: f.byPlayer }); } catch (e) {} }
  }

  function despawnFlight(f) {
    for (let i = 0; i < f.jets.length; i++) {
      const jt = f.jets[i];
      // a B-52's smoke trail is a world-space ribbon in the scene, not on the airframe
      const T = jt.rig && jt.rig.state && jt.rig.state.trails;
      if (T && T.mesh) {
        if (T.mesh.parent) T.mesh.parent.remove(T.mesh);
        if (T.g && T.g.dispose) { try { T.g.dispose(); } catch (e) {} }
        T.added = true;                                // never re-added by a stray tick
      }
      // a skinned airframe (the B-52's nine bones) owns its skeleton's texture
      if (jt.group) jt.group.traverse(function (o) { if (o.isSkinnedMesh && o.skeleton && o.skeleton.dispose) { try { o.skeleton.dispose(); } catch (e) {} } });
      if (jt.group && jt.group.parent) jt.group.parent.remove(jt.group);
      disposeGroup(jt.group);
      jt.group = null;
    }
    f.gone = true;
    const i = flights.indexOf(f);
    if (i >= 0) flights.splice(i, 1);
  }
  function despawnAllFlights() { while (flights.length) despawnFlight(flights[flights.length - 1]); }

  // a heavy's bay doors: open from DOOR_LEAD s before its first release until
  // DOOR_HOLD s after its last (the B-52 rig swings them itself, ~2.2 s)
  function doorsFor(jt, dt) {
    const f = jt.flight;
    let want = false;
    if (jt.next < jt.aims.length) {
      const a0 = jt.aims[jt.next];
      const toRel = ((a0.x - f.hx * a0.lead) - jt.pos.x) * f.hx + ((a0.z - f.hz * a0.lead) - jt.pos.z) * f.hz;
      want = toRel < f.spd * DOOR_LEAD;
    } else want = f.t - jt.lastRel < DOOR_HOLD;
    if (f.airframe === "b52") {
      // b52.js opens the bay for a designated mark while it has bombs in it
      if (jt.veh) jt.veh.tgt = want && !f.hsab ? jt.doorTgt : null;
    } else jt.door = Math.max(0, Math.min(1, jt.door + (want ? 1 : -1) * dt / 2.2));
  }

  // returns true when the flight is finished
  function tickFlight(f, dt) {
    f.t += dt;
    const step = f.spd * dt;
    let allOut = true;
    for (let j = 0; j < f.jets.length; j++) {
      const jt = f.jets[j];
      if (f.af.heavy) {
        // the breakaway: roll in once the stick is gone, then turn at the rate the bank holds
        const want = jt.next >= jt.aims.length && f.t - jt.lastRel > BREAK.DELAY && jt.yaw - f.yaw < BREAK.TURN ? BREAK.BANK : 0;
        jt.bank += Math.max(-BREAK.ROLL * dt, Math.min(BREAK.ROLL * dt, want - jt.bank));
        if (jt.bank !== 0) {
          jt.yaw += G_TURN * Math.tan(jt.bank) / f.spd * dt;      // a port turn: the yaw grows
          jt.hx = Math.sin(jt.yaw); jt.hz = Math.cos(jt.yaw);
        }
      }
      jt.pos.x += jt.hx * step; jt.pos.z += jt.hz * step;
      if (!jt.group) seatJet(jt);
      else if (f.af.heavy) {
        // the B-52 banks its own airframe (port wing down: -z roll on a +Z
        // nose); the B-2's rig leans into the coordinated angle off its yaw
        // rate by itself
        jt.group.rotation.set(0, jt.yaw, f.airframe === "b52" ? -jt.bank : 0);
      }
      if (jt.group) {
        const R = jt.rig && jt.rig.state;
        if (f.af.heavy) doorsFor(jt, dt);
        else if (R && jt.next < jt.aims.length) {
          // the F-35's bays open about two seconds before the first release
          // and stay open through the stick (the unit's own doors, ~1 s to swing)
          const a0 = jt.aims[jt.next];
          const toRel = ((a0.x - f.hx * a0.lead) - jt.pos.x) * f.hx + ((a0.z - f.hz * a0.lead) - jt.pos.z) * f.hz;
          if (toRel < f.spd * 2.2) R.bayHold = Math.max(R.bayHold, R.clock + 1.5);
        }
        if (CBZ.milAirDrive) { _drive.agl = jt.pos.y - floorAt(jt.pos.x, jt.pos.z); _drive.speed = f.spd; CBZ.milAirDrive(jt.group, _drive, dt); }
        // the unit's tick leans on its own door state; ours has the last word
        if (f.airframe === "b2" && jt.group.userData.setBay) jt.group.userData.setBay(jt.door);
      }
      // release each store the instant ITS station crosses ITS solved release point
      while (jt.next < jt.aims.length) {
        const a = jt.aims[jt.next];
        const trig = (a.x - f.hx * a.lead) * f.hx + (a.z - f.hz * a.lead) * f.hz;
        if (jt.pos.x * f.hx + jt.pos.z * f.hz + 15 < trig) break;     // nowhere near (a station is within 15 m of the origin)
        const st = stationOf(jt, _st);
        // the exact carry from THIS station's height (the B-52's three clip
        // layers span 0.8 m, worth a metre and a half on the ground)
        const ld = leadFor(f.kind, a.x, a.z, st.y, f.rv, f.h);
        const over = st.x * f.hx + st.z * f.hz - ((a.x - f.hx * ld.lead) * f.hx + (a.z - f.hz * ld.lead) * f.hz);
        if (over < 0) break;
        releaseFrom(jt, a, st, Math.min(over, step + 15));
        jt.next++;
      }
      if ((jt.pos.x - f.tx) * f.hx + (jt.pos.z - f.tz) * f.hz < f.runout) allOut = false;
    }
    for (let i = f.impacts.length - 1; i >= 0; i--) {
      const im = f.impacts[i];
      if (f.t < im.at) continue;
      f.impacts.splice(i, 1);
      f.hits++;
      if (im.fallback) fallbackBlast(f, im);
      if (f.onImpact) { try { f.onImpact(im, f, f.hits); } catch (e) {} }
    }
    // THE AEROPLANES ARE THE ALERT: a repeating engine roar keyed to the lead's
    // true distance from the player — sfx's dist handling attenuates it and
    // swaps to the muffled far-field bus, so it starts as a far-off rumble and
    // swells into a hard overhead roar on the pass. force+ghost so the cadence
    // never starves (or is starved by) other rumbles.
    f.sndT -= dt;
    if (f.sndT <= 0 && CBZ.sfx && f.jets[0]) {
      f.sndT = 0.55;
      const P = CBZ.player, lp = f.jets[0].pos;
      const d = P && P.pos ? Math.hypot(lp.x - P.pos.x, lp.z - P.pos.z, f.af.heavy ? lp.y - P.pos.y : 0) : 999;
      CBZ.sfx("rumble", { dist: d, volume: f.af.heavy ? 1.0 : 0.9, force: true, ghost: true });
      if (d < 55) CBZ.sfx("wind", { dist: d, volume: 1.0, force: true, ghost: true });  // close pass: the air itself tears
    }
    return (allOut && !f.impacts.length && f.released >= f.total) || f.t > f.life;
  }
  function updateFlights(dt) {
    for (let i = flights.length - 1; i >= 0; i--) {
      const f = flights[i];
      if (!tickFlight(f, dt)) continue;
      // anything still in the air when the clock runs out lands now, so no
      // caller is left waiting on an impact that never reports
      while (f.impacts.length) {
        const im = f.impacts.shift(); f.hits++;
        if (im.fallback) fallbackBlast(f, im);
        if (f.onImpact) { try { f.onImpact(im, f, f.hits); } catch (e) {} }
      }
      f.finished = true;
      despawnFlight(f);
      if (f.onDone) { try { f.onDone(f); } catch (e) {} }
    }
  }
  CBZ.cityStrikeFlight = strikeFlight;
  CBZ.cityStrikeFlights = function () { return flights.slice(); };
  CBZ.cityStrikeAirframes = function () { return Object.keys(AIRFRAME); };

  // systems/lockon.js UNIVERSAL-acquisition seam: the summoned taxi chopper
  // and the airstrike jet are real craft in the sky, so they're lockable like
  // every other vehicle (the player CAN waste a rocket on their own ride —
  // that's the every-vehicle-is-real rule). Seek getters are cached per
  // record (zero per-frame allocation) and go null on despawn, which breaks a
  // live lock the same frame. cb(...) === false stops the walk (pool full).
  function airLockSeek(rec) {
    if (!rec._lockSeek) {
      rec._lockSeek = function () {
        return rec.pos && rec.group && rec.group.parent
          ? { x: rec.pos.x, y: rec.pos.y, z: rec.pos.z }
          : null;
      };
    }
    return rec._lockSeek;
  }
  CBZ.cityPlayerAirEnumTargets = function (cb) {
    if (chopper && chopper.pos && chopper.group && chopper.group.parent) {
      if (cb(chopper, airLockSeek(chopper), chopper.pos.x, chopper.pos.y, chopper.pos.z, 3.0, "aircraft") === false) return;
    }
    // every jet of every strike flight — yours, the state's, the enemy's
    for (let i = 0; i < flights.length; i++) {
      const js = flights[i].jets;
      for (let j = 0; j < js.length; j++) {
        const jt = js[j];
        if (!jt.group || !jt.group.parent) continue;
        if (cb(jt, airLockSeek(jt), jt.pos.x, jt.pos.y, jt.pos.z, (flights[i].af && flights[i].af.radius) || 3.2, "aircraft") === false) return;
      }
    }
  };

  // ============================================================ API ===========
  CBZ.cityCallChopper = function () {
    if (g.mode !== "city" || g.state !== "playing") return false;
    if (!canChopper()) { note("No chopper. Own THE APEX PENTHOUSE, a personal chopper comes parked on its rooftop pad.", 3.6); return false; }
    if (chopper) { note("Your chopper is already on the way.", 2); return false; }
    if (chopperCD > 0) { note("Chopper refueling · " + Math.ceil(chopperCD) + "s.", 2); return false; }
    const P = player(); if (!P) return false;
    chopper = makeChopper(P);
    if (!chopper) { note("Chopper unavailable right now.", 2); return false; }
    note("Personal chopper inbound, stand clear, then walk under it to board.", 3.6);
    if (CBZ.sfx) CBZ.sfx("whoosh");
    return true;
  };

  CBZ.cityCallAirstrike = function (tgt) {
    if (g.mode !== "city" || g.state !== "playing") return false;
    if (!canStrike()) {
      note("No F-35 yet. Buy a hangar (penthouse deck [H] or the airport Private Hangar [P]→Services), STEAL an F-35 from the military base, then land it in your hangar to keep it.", 4.2);
      return false;
    }
    if (strikeCD > 0) { note("Jet rearming · " + Math.ceil(strikeCD) + "s.", 2); return false; }
    tgt = tgt || strikeTarget();
    if (!tgt) { note("No target, set a waypoint [M] or aim at the ground.", 2.6); return false; }
    if (((g.cash || 0) + (g.cityBank || 0)) < STRIKE_COST) { note("An airstrike costs " + money(STRIKE_COST) + ".", 2.6); return false; }
    // your F-35: one jet, its two 2,000 lb JDAMs walked across the mark
    const f = strikeFlight({ x: tgt.x, z: tgt.z, jets: 1, bombs: 2, alt: 70, byPlayer: true, label: tgt.label || "" });
    if (!f) { note("The jet can't get airborne right now.", 2); return false; }
    charge(STRIKE_COST);
    strikeCD = STRIKE_CD;
    // calling in military ordnance is a felony spectacle — the law notices.
    if (CBZ.city && CBZ.city.addHeat) CBZ.city.addHeat(260);
    // (CUT: the "🎯 AIRSTRIKE INBOUND" centre flash. In real life nothing pops
    // up to tell you a jet is coming — you HEAR it: tickFlight() drives a
    // swelling engine roar from the moment it crosses the city edge. The only
    // words are the read-back below — YOUR pilot confirming YOUR tasking, a
    // notification from a person, on the quiet feed.)
    // the pilot is on the radio, not in the world: his voice comes by your hand
    if (CBZ.speech && CBZ.speech.phone) CBZ.speech.phone("Copy, running in on " + (tgt.label || "the mark") + ". Keep your head down.", { secs: 3 });
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

  // ---- studio hook: pure mesh builders for tools/studio.mjs expr shots ----
  CBZ.debugBuildPlayerAir = {
    chopper: function () { return buildChopperGroup().grp; },
    strikeJet: function (airframe) { const b = buildStrikeJet(AIRFRAME[airframe] || AIRFRAME.f35); return b ? b.grp : null; },
  };

  function teardown() { despawnChopper(); despawnAllFlights(); chopperCD = 0; strikeCD = 0; g.cityChopperRide = false; }
  CBZ.cityClearPlayerAir = teardown;

  // ---- tick (after player physics @10 so the ride pos override wins) ---------
  CBZ.onUpdate(42.5, function (dt) {
    if (g.mode !== "city") { if (chopper || flights.length) teardown(); return; }
    if (chopperCD > 0) chopperCD = Math.max(0, chopperCD - dt);
    if (strikeCD > 0) strikeCD = Math.max(0, strikeCD - dt);
    if (g.state !== "playing") return;
    updateChopper(dt);
    updateFlights(dt);
  });
})();
