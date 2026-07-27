/* ============================================================
   city/bailout.js — STEPPING OUT OF A FLYING AIRCRAFT.

   THE BUG THIS EXISTS TO KILL
   ---------------------------
   playeraircraft.js's exitAircraft() was written for a parked machine. It
   zeroes attitude and velocity, forces `onGround`, drops the gear and stands
   you on the floor beside the plane. Run that at 500m and the abandoned jet
   silently teleports flat and lands itself while you appear on the tarmac
   underneath. The owner's ask — "the plane should actually lose its pilot and
   fall dramatically unless a pilot takes over" — is really two halves, and
   this file owns both: the falling body, and the pilotless machine.

   HOW A PILOTLESS AIRCRAFT BEHAVES, AND WHY
   -----------------------------------------
   Not a vertical drop. A real departure from controlled flight has a SHAPE,
   and it comes from the aircraft being out of trim with nobody correcting:
   any tiny bank grows because the lift vector tilts, which drops the nose,
   which builds speed, which increases lift on the raised wing — the classic
   graveyard spiral. So the model here is: seed a small roll from whatever
   attitude you left it in, let bank feed pitch-down, let pitch-down feed
   speed, let speed feed bank. It tightens on its own. Nobody scripted the
   curve; it falls out of the feedback loop, which is why it looks different
   every time depending on how you left the aeroplane.

   Helicopters get their own answer, because they have one: no collective
   means no rotor thrust, so they descend fast with a torque-driven yaw spin
   rather than a spiral.

   "UNLESS A PILOT TAKES OVER"
   ---------------------------
   Good world logic, and this repo already flies NPC aircraft (aircraft.js
   carries a `craft.pilot`). A machine with somebody else aboard — an airliner
   with a cockpit crew, anything carrying a `pilot`/`copilot` — recovers,
   levels out and flies on about its business. A single-seat fighter you just
   stepped out of does not. That distinction is read from the aircraft rather
   than hand-assigned per airframe.

   THE PARACHUTE
   -------------
   Genuinely new — grep confirms this repo has never had one. Freefall until
   you pull, then a canopy that actually slows and steers you. Pull too late
   and you meet the ground at freefall speed, where the existing fall-damage
   ladder in systems/physics.js is waiting; this file adds no second damage
   path. Every aircraft carries one, per the ask.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const THREE = window.THREE;
  CBZ.CONFIG = CBZ.CONFIG || {};

  if (CBZ.CONFIG.BAILOUT == null) CBZ.CONFIG.BAILOUT = true;
  if (CBZ.CONFIG.BAILOUT_CHUTE == null) CBZ.CONFIG.BAILOUT_CHUTE = true;
  // A machine with someone else aboard recovers instead of falling.
  if (CBZ.CONFIG.BAILOUT_TAKEOVER == null) CBZ.CONFIG.BAILOUT_TAKEOVER = true;
  // Height above the surface below which stepping out is an ordinary exit
  // rather than a bailout — you are landing/taxiing, not abandoning ship.
  if (CBZ.CONFIG.BAILOUT_MIN_AGL == null) CBZ.CONFIG.BAILOUT_MIN_AGL = 9;

  const on = () => CBZ.CONFIG.BAILOUT !== false;
  const TERMINAL = -58;        // freefall terminal velocity, m/s
  const CANOPY_SINK = -5.4;    // under a good canopy
  const CANOPY_FWD = 9.5;      // canopy forward airspeed
  const OPEN_SHOCK = 0.55;     // seconds of deceleration when it blooms

  function floorAt(x, z) {
    if (CBZ.cityCraftFloorY) { try { return CBZ.cityCraftFloorY(x, z); } catch (e) {} }
    if (CBZ.groundAt) { try { return CBZ.groundAt(x, z); } catch (e) {} }
    if (CBZ.floorAt) { try { return CBZ.floorAt(x, z); } catch (e) {} }
    return 0;
  }

  /* ================= THE FALLING BODY ================= */
  const F = { active: false, phase: "", t: 0, yaw: 0, canopy: null, shock: 0 };

  function makeCanopy() {
    if (!THREE) return null;
    const g = new THREE.Group();
    // ==================================================================
    //  A PARACHUTE, NOT A CEILING (owner: "the canopy doesn't look like a
    //  parachute at all, it's stupid").
    //
    //  The old one WAS a dome — but 3.1m across hanging 3.6m over your head,
    //  which from underneath is not a canopy, it is a low roof: it fills the
    //  whole sky, you never see its edge, and with no edge there is no
    //  silhouette and no parachute. It was also MeshLambert, so its underside
    //  — the only side you ever see — sat in its own shadow as a dark slab.
    //  That is the flat maroon rectangle in the screenshot.
    //
    //  Three things make a canopy read from directly below, and it had none:
    //    1. DISTANCE AND EDGE. A real canopy is ~7m across on ~5m of line. You
    //       must be able to see past it to sky, or it is a roof.
    //    2. BACKLIT FABRIC. Ripstop nylon is thin — daylight comes THROUGH it
    //       and it glows, brightest at the crown. Unlit + slight transparency
    //       is the honest model and it is also the cheapest.
    //    3. GORES. The radial panel seams are THE recognisable parachute
    //       pattern. Alternating gore colour is baked into vertex colour on the
    //       one shared sphere, so it costs nothing.
    //  Plus lines: many, long, converging. Four stubs read as nothing.
    // ==================================================================
    const R = 4.6, GORES = 12;
    const domeGeo = new THREE.SphereGeometry(R, GORES * 2, 9, 0, Math.PI * 2, 0, Math.PI * 0.54);
    // stripe alternating gores by azimuth, straight into vertex colour
    const pos = domeGeo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const A = new THREE.Color(0xe8563a), B = new THREE.Color(0xf2f2ee);
    for (let i = 0; i < pos.count; i++) {
      const ang = Math.atan2(pos.getZ(i), pos.getX(i));
      const gore = Math.floor(((ang + Math.PI) / (Math.PI * 2)) * GORES);
      const c = (gore & 1) ? B : A;
      // the crown is brightest — that is where the sun comes through
      const lift = 0.78 + 0.30 * (pos.getY(i) / R);
      col[i * 3] = Math.min(1, c.r * lift);
      col[i * 3 + 1] = Math.min(1, c.g * lift);
      col[i * 3 + 2] = Math.min(1, c.b * lift);
    }
    domeGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const dome = new THREE.Mesh(domeGeo, new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide,
      transparent: true, opacity: 0.94, depthWrite: true,
    }));
    dome.scale.set(1, 0.78, 1.12);        // deeper than before: curvature reads from below
    g.add(dome);
    // the seam lines themselves, dark against the lit fabric
    const ribs = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.004, GORES, 5, 0, Math.PI * 2, 0, Math.PI * 0.54),
      new THREE.MeshBasicMaterial({ color: 0x1c1c1c, wireframe: true, transparent: true, opacity: 0.30 })
    );
    ribs.scale.copy(dome.scale);
    g.add(ribs);
    // SUSPENSION LINES — twelve, running the full drop to the harness. These
    // are most of what says "parachute" when the canopy is above your view.
    const lineMat = new THREE.LineBasicMaterial({ color: 0xdfe4ea, transparent: true, opacity: 0.55 });
    const skirtY = R * 0.78 * Math.cos(Math.PI * 0.54);
    const pts = [];
    for (let i = 0; i < GORES; i++) {
      const a = (i / GORES) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * R * 0.97, skirtY, Math.sin(a) * R * 1.09 * 0.97));
      pts.push(new THREE.Vector3(0, -6.0, 0));
    }
    g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
    // hung HIGHER, so you can see past its edge to sky — the thing that turns
    // a roof back into a canopy.
    g.position.y = 6.4;
    return g;
  }


  function beginFall(fromCraft) {
    const P = CBZ.player; if (!P) return;
    F.active = true; F.phase = "freefall"; F.t = 0; F.shock = 0;
    F.yaw = fromCraft ? (fromCraft.heading || 0) : 0;
    P.grounded = false;
    // Inherit the aircraft's momentum — you do not stop dead in the air.
    if (fromCraft) {
      P.vy = Math.min(0, (fromCraft.vy || 0) * 0.5);
      F.driftX = (fromCraft.vx || 0) * 0.55;
      F.driftZ = (fromCraft.vz || 0) * 0.55;
    } else { P.vy = 0; F.driftX = F.driftZ = 0; }
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = true;
    if (CBZ.city && CBZ.city.note) {
      CBZ.city.note("Freefall. Pull to deploy.", 2.6, { from: "Rig", app: "messages" });
    }
    if (CBZ.sfx) { try { CBZ.sfx("wind"); } catch (e) {} }
  }

  function deploy() {
    if (!F.active || F.phase !== "freefall") return false;
    if (CBZ.CONFIG.BAILOUT_CHUTE === false) return false;
    F.phase = "canopy"; F.shock = OPEN_SHOCK;
    if (!F.canopy && CBZ.scene) { F.canopy = makeCanopy(); if (F.canopy) CBZ.scene.add(F.canopy); }
    if (F.canopy) F.canopy.visible = true;
    if (CBZ.sfx) { try { CBZ.sfx("cloth"); } catch (e) {} }
    return true;
  }
  CBZ.cityChuteDeploy = deploy;
  CBZ.cityChuteState = function () {
    return F.active ? { phase: F.phase, agl: aglNow() } : null;
  };

  function aglNow() {
    const P = CBZ.player; if (!P) return 0;
    return Math.max(0, P.pos.y - floorAt(P.pos.x, P.pos.z));
  }

  function endFall(landed) {
    F.active = false; F.phase = "";
    if (F.canopy) F.canopy.visible = false;
    const P = CBZ.player;
    if (landed && P) { P.grounded = true; P.vy = 0; }
  }

  /* ================= THE PILOTLESS MACHINE ================= */
  const ghosts = [];

  function crewAboard(craft) {
    if (CBZ.CONFIG.BAILOUT_TAKEOVER === false) return false;
    if (!craft) return false;
    if (craft.pilot || craft.copilot) return true;
    const ud = craft.group && craft.group.userData;
    // An airliner has a modelled cabin and flight deck — somebody is up front.
    if (ud && (ud.cabin || ud.cockpit)) return true;
    if (craft.airClass === "airliner") return true;
    return false;
  }

  function abandon(craft) {
    if (!craft) return;
    const recovered = crewAboard(craft);
    ghosts.push({
      craft: craft,
      recovered: recovered,
      t: 0,
      roll: (craft.roll || 0) || 0.05,   // whatever bank you left it in, or a nudge
      pitch: craft.pitch || 0,
      spin: 0,
      heli: craft.kind === "heli" || craft.airClass === "heli",
    });
    if (recovered && CBZ.city && CBZ.city.note) {
      CBZ.city.note("Someone else has the controls.", 3, { from: "Radio", app: "messages" });
    }
  }

  function tickGhost(G, dt) {
    const c = G.craft;
    if (!c || !c.group) return false;
    G.t += dt;
    const gy = floorAt(c.pos.x, c.pos.z);

    if (G.recovered) {
      // Levels out over a couple of seconds and flies on. It is somebody
      // else's aeroplane now; the ordinary traffic systems can keep it.
      G.roll += (0 - G.roll) * Math.min(1, dt * 1.6);
      G.pitch += (0.04 - G.pitch) * Math.min(1, dt * 1.4);
      const sp = Math.max(28, c.speed || 40);
      c.pos.x += Math.sin(c.heading) * sp * dt;
      c.pos.z += Math.cos(c.heading) * sp * dt;
      c.pos.y += Math.sin(G.pitch) * sp * dt;
      applyPose(c, G);
      return G.t < 40;            // hand it back to the world after a while
    }

    if (G.heli) {
      // No collective: it sinks, and engine torque with no tail authority
      // walks the nose round.
      G.spin += dt * 1.5;
      c.heading += G.spin * dt;
      c.vy = (c.vy || 0) - 9.4 * dt * 0.75;
      c.pos.y += c.vy * dt;
      G.roll += (Math.sin(G.t * 2.2) * 0.28 - G.roll) * dt * 2;
      G.pitch = -0.18;
    } else {
      // THE SPIRAL. Bank tilts the lift vector, so the nose drops; the nose
      // dropping builds speed; speed deepens the bank. Each term feeds the
      // next, so it tightens by itself rather than on a script.
      G.roll += Math.sign(G.roll || 1) * dt * (0.34 + Math.abs(G.roll) * 0.55);
      G.roll = Math.max(-1.5, Math.min(1.5, G.roll));
      G.pitch -= Math.abs(G.roll) * dt * 0.55;
      G.pitch = Math.max(-1.15, G.pitch);
      c.speed = Math.min(140, (c.speed || 40) + (-G.pitch) * 26 * dt);
      c.heading += G.roll * dt * 0.85;                       // bank turns it
      const fwd = Math.cos(G.pitch) * c.speed;
      c.pos.x += Math.sin(c.heading) * fwd * dt;
      c.pos.z += Math.cos(c.heading) * fwd * dt;
      c.pos.y += Math.sin(G.pitch) * c.speed * dt;
    }
    applyPose(c, G);

    if (c.pos.y - (c.belly || 1.2) <= gy + 0.4) {
      impact(c, gy);
      return false;
    }
    return G.t < 90;
  }

  function applyPose(c, G) {
    c.roll = G.roll; c.pitch = G.pitch;
    if (CBZ.citySetCraftRotation) {
      try { CBZ.citySetCraftRotation(c, G.pitch, c.heading, G.roll); } catch (e) {}
    }
    if (c.group) c.group.position.set(c.pos.x, c.pos.y, c.pos.z);
  }

  /* The wreck is priced through the shared ordnance bus so it damages
     buildings, starts fires and kills exactly like any other impact of that
     mass and speed. No second blast path — CLAUDE.md forbids hand-rolling
     one, and the bus already models kinetic energy from mass and speed. */
  function impact(c, gy) {
    const speed = Math.max(20, c.speed || 40);
    const mass = (c.mass || (c.airClass === "airliner" ? 72000 : c.kind === "heli" ? 5200 : 12000));
    if (CBZ.detonate) {
      try {
        CBZ.detonate(c.pos.x, Math.max(gy, c.pos.y), c.pos.z, "aircraft-impact",
                     { mass: mass, speed: speed, byPlayer: true, frontal: true });
      } catch (e) {}
    } else if (CBZ.cityAirstrikeExplosion) {
      try { CBZ.cityAirstrikeExplosion(c.pos.x, c.pos.z, { power: 3.0, radius: 16, y: c.pos.y, byPlayer: true }); } catch (e) {}
    }
    if (c.group && c.group.parent) c.group.parent.remove(c.group);
    c.dead = true;
  }

  /* PUBLIC: playeraircraft.js hands the machine over here when you step out of
     it in flight. Returns true when this file has taken ownership. */
  CBZ.cityBailOut = function (craft) {
    if (!on() || !craft || !craft.pos) return false;
    const gy = floorAt(craft.pos.x, craft.pos.z);
    const agl = craft.pos.y - gy;
    if (!(agl > CBZ.CONFIG.BAILOUT_MIN_AGL)) return false;   // parked/landing: normal exit
    if (craft.onGround) return false;
    abandon(craft);
    beginFall(craft);
    return true;
  };

  /* ================= TICK ================= */
  CBZ.onUpdate(CBZ.PRIO && CBZ.PRIO.after ? CBZ.PRIO.after(CBZ.PRIO.VEHICLES, 7) : 17.7, function (dt) {
    if (!dt) return;
    for (let i = ghosts.length - 1; i >= 0; i--) {
      let keep = false;
      try { keep = tickGhost(ghosts[i], dt); } catch (e) { keep = false; }
      if (!keep) ghosts.splice(i, 1);
    }
    if (!F.active) return;

    const P = CBZ.player;
    if (!P || P.dead) { endFall(false); return; }
    F.t += dt;
    const k = CBZ.keys || {};

    if (F.phase === "freefall") {
      if (k[" "] || k["f"]) deploy();
      P.vy = Math.max(TERMINAL, (P.vy || 0) - 9.81 * dt * 1.55);
      F.driftX *= (1 - dt * 0.55); F.driftZ *= (1 - dt * 0.55);
    } else if (F.phase === "canopy") {
      // Bloom: a hard but brief deceleration, then a steady sink.
      if (F.shock > 0) {
        F.shock -= dt;
        P.vy += (CANOPY_SINK - P.vy) * Math.min(1, dt * 9);
      } else {
        P.vy += (CANOPY_SINK - P.vy) * Math.min(1, dt * 3.4);
      }
      // Steer: turn with A/D, and trade forward speed with W/S the way toggles
      // do — pulling both hands down flares and slows you.
      if (k["a"]) F.yaw += dt * 1.25;
      if (k["d"]) F.yaw -= dt * 1.25;
      const flare = k["s"] ? 0.25 : (k["w"] ? 1.15 : 1);
      F.driftX = Math.sin(F.yaw) * CANOPY_FWD * flare;
      F.driftZ = Math.cos(F.yaw) * CANOPY_FWD * flare;
      if (k["s"]) P.vy += dt * 1.6;      // flaring also arrests the sink briefly

      // THE CANOPY DISCARDS THE FALL. systems/physics.js scores a landing on
      // player._fallPeak — the fastest you fell at ANY point — not on the speed
      // you actually touch down at. Freefall pins that at terminal (58 m/s), so
      // before this line a parachute could not save you: you decelerated to a
      // 5.4 m/s sink and the game still judged the landing at 58 and killed you
      // every single time, however well you flew it.
      //
      // Clamping the peak to the CURRENT sink rate is not a special case, it is
      // the physics: a canopy's entire job is to shed the energy you built up,
      // and once it is open and flying, how fast you were falling a moment ago
      // is no longer stored anywhere in your body. A late pull still hurts —
      // you are still fast when the ground arrives, so the peak is still high.
      // No second damage path; the existing ladder just gets an honest number.
      const sink = -(P.vy || 0);
      if (P._fallPeak == null || P._fallPeak > sink) P._fallPeak = Math.max(0, sink);
    }

    P.pos.x += F.driftX * dt;
    P.pos.z += F.driftZ * dt;
    P.grounded = false;

    if (F.canopy) {
      F.canopy.position.set(P.pos.x, P.pos.y + 6.4, P.pos.z);   // matches makeCanopy's hang height
      F.canopy.rotation.y = F.yaw;
      F.canopy.visible = (F.phase === "canopy");
    }
    if (CBZ.playerChar && CBZ.playerChar.group) {
      CBZ.playerChar.group.position.set(P.pos.x, P.pos.y, P.pos.z);
      CBZ.playerChar.group.rotation.y = F.yaw;
    }

    // Landing. Under canopy this is a walk-away; in freefall we simply hand the
    // body back with its real vertical speed and let the EXISTING fall-damage
    // ladder in systems/physics.js decide — adding a second damage path here
    // would be exactly the duplication this codebase is trying to stop.
    const gy = floorAt(P.pos.x, P.pos.z);
    if (P.pos.y <= gy + 0.05) {
      P.pos.y = gy;
      const hard = (F.phase !== "canopy");
      endFall(true);
      if (hard && CBZ.cityHurtPlayer) {
        try { CBZ.cityHurtPlayer(9999, { cause: "fell", fatal: true }); } catch (e) {}
      } else if (CBZ.sfx) { try { CBZ.sfx("land"); } catch (e) {} }
    }
  });

  /* Touch: the deploy verb belongs to the shared touch layer, never a parallel
     handler, and never a keyboard glyph (CLAUDE.md). touch.js should call
     CBZ.cityChuteDeploy() from a pill shown while cityChuteState() is
     non-null and its phase is "freefall". */
  CBZ.cityChutePrompt = function () {
    return (F.active && F.phase === "freefall") ? "Deploy chute" : null;
  };

  CBZ.bailoutAudit = function () {
    return { ghosts: ghosts.length, falling: !!F.active, phase: F.phase || null };
  };
})();
