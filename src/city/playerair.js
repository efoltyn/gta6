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
  // seeded LCG (project convention — NEVER Math.random). Was aliased straight
  // to Math.random; fixed while this module is open for the flight-physics pass.
  let _s = 47711;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }

  // SHAPE HELPERS (r128) — local copies of aircraft.js's sculptors (builders
  // stay self-contained per file by project convention). taperBox scales each
  // vertex's X/Y by a factor that depends on its Z (nose=+Z → nz, tail=-Z →
  // tz), with optional roofline (top) / keel (bot) narrowing.
  function taperBox(w, h, d, opt) {
    opt = opt || {};
    const nz = opt.nz != null ? opt.nz : 1, tz = opt.tz != null ? opt.tz : 1;
    const top = opt.top != null ? opt.top : 1, bot = opt.bot != null ? opt.bot : 1;
    const geo = new THREE.BoxGeometry(w, h, d, opt.segW || 2, opt.segH || 2, opt.segD || 6);
    const pos = geo.attributes.position, hd = d / 2, hh = h / 2;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const f = z / hd, zt = f >= 0 ? (1 + (nz - 1) * f) : (1 + (tz - 1) * -f);
      let sx = zt, sy = zt;
      const vy = hh > 0 ? y / hh : 0;
      if (vy > 0) sx *= (1 + (top - 1) * vy);
      if (vy < 0) sx *= (1 + (bot - 1) * -vy);
      pos.setX(i, x * sx); pos.setY(i, y * sy);
    }
    pos.needsUpdate = true; geo.computeVertexNormals();
    return geo;
  }
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
      // ---- YOUR CHOPPER: a warm yellow/white executive taxi — instantly reads
      // as "the friendly one" against the black-and-white police airframes.
      matCab:  shared(vmat('paint', 0xe8b23c)),           // warm taxi yellow
      matRoof: shared(vmat('paint', 0xf2f3f5)),           // white roof / boom / accents
      matTrim: shared(vmat('metal', 0x3c434c)),           // skids / struts / rotor head
      matSeat: shared(vmat('interior', 0x14171c)),        // seats + dark insets
      matBlade:shared(vmat('metal', 0x1e242b)),           // solid rotor blades
      matGlow: M(0xffd98a, { emissive: 0xffd98a, ei: 0.7 }),   // warm landing-light bar
      matJet:  shared(vmat('paint', 0x39424f)),           // strike jet slate
      matJetMetal: shared(vmat('metal', 0x565e68)),       // burner cans / rails
      matGlass:shared(vmat('glass', 0x10161c)),           // jet canopy (reflective)
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
      // airstrike jet — sculpted fuselage, LERX chines, cans, pylons (mirrors
      // the 5★ police jet's kit, in your own slate paint)
      jetBody:  shared(taperBox(1.3, 1.05, 7.6, { nz: 0.26, tz: 0.6, top: 0.72, bot: 0.62, segD: 10 })),
      jetNose:  shared(new THREE.ConeGeometry(0.26, 1.3, 8)),    // fine radar-boom tip
      jetCanopy:shared(taperBox(0.8, 0.55, 1.9, { nz: 0.5, tz: 0.95, top: 0.45 })),
      jetChine: shared(taperBox(0.46, 0.08, 2.4, { nz: 0.3 })),  // LERX strake (one side)
      jetWing:  shared(taperBox(3.4, 0.16, 3.0, { nz: 0.35, tz: 0.78, segW: 4 })),   // one swept delta half
      jetTail:  shared(taperBox(0.14, 1.3, 1.1, { nz: 0.7, tz: 0.45, top: 0.5 })),   // one canted vertical tail
      jetStab:  shared(taperBox(1.5, 0.12, 0.9, { nz: 0.4, tz: 0.7 })),
      jetIntake:shared(taperBox(0.42, 0.6, 1.6, { nz: 0.7, top: 0.7 })),
      jetCan:   shared(new THREE.CylinderGeometry(0.26, 0.22, 0.7, 8)),   // afterburner can
      jetCanIn: shared(new THREE.CylinderGeometry(0.15, 0.15, 0.1, 8)),   // dark nozzle throat
      pylon:    shared(new THREE.BoxGeometry(0.1, 0.3, 0.8)),             // underwing bomb pylon
      bombTip:  shared(new THREE.ConeGeometry(0.18, 0.35, 7)),            // nose of the slung store
      bomb:     shared(new THREE.CylinderGeometry(0.18, 0.18, 1.2, 7)),
      burn:     shared(new THREE.SphereGeometry(0.5, 7, 6)),
      rotorMat: shared(new THREE.MeshBasicMaterial({ color: 0x0e1015, transparent: true, opacity: 0.5, depthWrite: false })),
      flameMat: shared(new THREE.MeshBasicMaterial({ color: 0xffb14a, transparent: true, opacity: 0.9, depthWrite: false })),
      bombMat:  shared(new THREE.MeshBasicMaterial({ color: 0x20242b })),
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

  // Mesh-only builder (no scene/target dependency) — used by makeStrikeJet and
  // exposed for tools/studio.mjs asset photography (CBZ.debugBuildPlayerAir).
  function buildStrikeJetGroup() {
    const a = assets();
    const grp = new THREE.Group();
    const body = new THREE.Mesh(a.jetBody, a.matJet); grp.add(body);
    // fine needle nose tip capping the sculpted fuselage taper (apex forward)
    const nose = new THREE.Mesh(a.jetNose, a.matJet); nose.rotation.x = Math.PI / 2; nose.position.z = 4.15; grp.add(nose);
    // REFLECTIVE GLASS canopy (was painted hull before — it never read as a cockpit)
    const canopy = new THREE.Mesh(a.jetCanopy, a.matGlass); canopy.position.set(0, 0.56, 1.7); grp.add(canopy);
    // LERX chines blending the wing roots up the forward fuselage
    const chL = new THREE.Mesh(a.jetChine, a.matJet); chL.position.set(-0.42, 0.1, 1.85); chL.rotation.y = 0.12; grp.add(chL);
    const chR = new THREE.Mesh(a.jetChine, a.matJet); chR.position.set(0.42, 0.1, 1.85); chR.rotation.y = -0.12; grp.add(chR);
    const inL = new THREE.Mesh(a.jetIntake, a.matJet); inL.position.set(-0.7, -0.12, 0.6); grp.add(inL);
    const inR = new THREE.Mesh(a.jetIntake, a.matJet); inR.position.set(0.7, -0.12, 0.6); grp.add(inR);
    // swept TAPERED delta halves — roots sink into the fuselage sides, slight dihedral
    const wingL = new THREE.Mesh(a.jetWing, a.matJet); wingL.position.set(-1.9, -0.18, -0.7); wingL.rotation.y = 0.32; wingL.rotation.z = 0.06; grp.add(wingL);
    const wingR = new THREE.Mesh(a.jetWing, a.matJet); wingR.position.set(1.9, -0.18, -0.7); wingR.rotation.y = -0.32; wingR.rotation.z = -0.06; grp.add(wingR);
    const stabL = new THREE.Mesh(a.jetStab, a.matJet); stabL.position.set(-0.85, 0, -3.3); stabL.rotation.y = 0.2; grp.add(stabL);
    const stabR = new THREE.Mesh(a.jetStab, a.matJet); stabR.position.set(0.85, 0, -3.3); stabR.rotation.y = -0.2; grp.add(stabR);
    // canted twin tails, roots overlapping the rear fuselage top
    const tailL = new THREE.Mesh(a.jetTail, a.matJet); tailL.position.set(-0.42, 0.75, -2.95); tailL.rotation.z = 0.22; grp.add(tailL);
    const tailR = new THREE.Mesh(a.jetTail, a.matJet); tailR.position.set(0.42, 0.75, -2.95); tailR.rotation.z = -0.22; grp.add(tailR);
    // UNDERWING PYLONS with visible slung bombs — these are the stores the drop
    // "releases": dropBomb hides the pair the moment the live bomb spawns, so
    // the ordnance you see on the run-in is the ordnance that falls.
    const stores = [];
    for (const sx of [-1, 1]) {
      const py = new THREE.Mesh(a.pylon, a.matJetMetal); py.position.set(sx * 1.15, -0.4, -0.55); grp.add(py);
      const bm = new THREE.Mesh(a.bomb, a.bombMat); bm.rotation.x = Math.PI / 2; bm.position.set(sx * 1.15, -0.66, -0.55); grp.add(bm);
      const bt = new THREE.Mesh(a.bombTip, a.bombMat); bt.rotation.x = Math.PI / 2; bt.position.set(sx * 1.15, -0.66, 0.2); grp.add(bt);
      stores.push(bm, bt);
    }
    // twin afterburner cans with dark throats; the glow pulses behind them
    for (const sx of [-1, 1]) {
      const can = new THREE.Mesh(a.jetCan, a.matJetMetal); can.rotation.x = Math.PI / 2; can.position.set(sx * 0.24, -0.05, -4.05); grp.add(can);
      const thr = new THREE.Mesh(a.jetCanIn, a.matSeat); thr.rotation.x = Math.PI / 2; thr.position.set(sx * 0.24, -0.05, -4.42); grp.add(thr);
    }
    const burn = new THREE.Mesh(a.burn, a.flameMat); burn.scale.set(0.7, 0.7, 1.4); burn.position.set(0, -0.05, -4.6); grp.add(burn);
    // nav lights: port red / stbd green at the wingtips, white on the spine
    const nL = (m, x, y, z) => { const b = new THREE.Mesh(a.navBead, m); b.position.set(x, y, z); grp.add(b); };
    nL(a.navR, -3.4, -0.2, -0.9); nL(a.navG, 3.4, -0.2, -0.9); nL(a.navW, 0, 0.35, -3.6);
    return { grp, burn, stores };
  }

  function makeStrikeJet(tgt) {
    const r = arenaRoot(); if (!r) return null;
    const built = buildStrikeJetGroup();
    const grp = built.grp, burn = built.burn, stores = built.stores;
    r.add(grp);
    const sp = edgePoint(tgt.x, tgt.z, STRIKE_Y);
    grp.position.set(sp.x, STRIKE_Y, sp.z);
    const dir = new THREE.Vector3(tgt.x - sp.x, 0, tgt.z - sp.z); dir.y = 0; dir.normalize();
    grp.rotation.y = Math.atan2(dir.x, dir.z);
    return { group: grp, burn, dir, pos: grp.position, target: tgt, life: 0, dropped: false, _stores: stores };
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
    // the wing stores visibly release: hide the slung pair, spawn the live bomb
    if (j._stores) for (let i = 0; i < j._stores.length; i++) j._stores[i].visible = false;
    const b = new THREE.Mesh(a.bomb, a.bombMat);
    b.position.copy(j.pos); b.position.y -= 0.7; b.rotation.x = Math.PI / 2;
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
      note("🎯 No F-22 yet. Buy a hangar (penthouse deck [H] or the airport Private Hangar [P]→Services), STEAL the F-22 from the military base, then land it in your hangar to keep it.", 4.2);
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

  // ---- studio hook: pure mesh builders for tools/studio.mjs expr shots ----
  CBZ.debugBuildPlayerAir = {
    chopper: function () { return buildChopperGroup().grp; },
    strikeJet: function () { return buildStrikeJetGroup().grp; },
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
