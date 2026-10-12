/* ============================================================
   units/vehicles/shahed_136.js — HESA Shahed-136 (Russian service: Geran-2),
   the one-way attack drone (Iran; fielded here by any nation's army).

   WHAT IT IS. A cheap delta-wing cruise munition: a round fuselage with the
   warhead in its nose (up to ~50 kg of HE-fragmentation and a contact fuze),
   a cropped delta wing blended into it, a fin at each wingtip (rudders up
   and a little down), and at the very back a four-cylinder two-stroke MD-550
   (~50 hp) turning a two-blade pusher prop. 3.5 m long, 2.5 m span, ~200 kg
   at launch, ~185 km/h (51 m/s). It is fired off an inclined rail by a
   solid rocket booster under its tail (dropped after ~2 s), then flies a
   pre-programmed route on satellite navigation to coordinates; there is no
   operator in the loop and no link to jam (a later Geran-2 carries an
   8-element Kometa anti-jam antenna on its back, drawn here). Over the
   target it pitches over into a steep dive.

   IT IS SLOW AND LOUD: the moped drone of the MD-550 is heard kilometres
   off, and anything with a machine gun, an autocannon or a rifle can bring
   it down (it takes several hits; the engine is the place). A Patriot can
   engage it but its radar cross-section (stats.rcs) is small.

   WHERE IT COMES FROM (src/battle/drones.js): a rack truck of five
   (units/vehicles/shahed_launcher.js) on its own side, launched one after
   another; with no rack on the side it comes in from beyond the edge of the
   map, already flying.

   THE RIG (animate on the battle clock): the prop at the commanded rpm (the
   blades at a crawl, a disc at speed), the booster's flame and smoke while it
   burns and the casing gone once it drops, a thin exhaust from the engine,
   black smoke trailing from a hit, flame when it burns. The paint (rig.mark)
   is the Geran-2's matte black for an army in Russian kit (Kesh, Solara),
   the Shahed's light grey for anyone else.

   Units: metres, m/s, kg, mm RHA. Nose +Z, +X port, y up from the bottom.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.unitKit) return;
  const PI = Math.PI;

  const L = 3.5, SPAN = 2.5, FR = 0.24, FY = 0.34;           // fuselage radius and axis height
  const WING = { y: 0.30, rootLE: 0.70, rootTE: -1.52, tipLE: -0.98, tipTE: -1.52, t: 0.085, root: 0.18 };
  const PROP_R = 0.38;

  function bodyGeo() {
    const G = CBZ.hullKit.geo();
    // ---- the fuselage, turned: the warhead's ogive nose to the engine's cowl
    const prof = [[0.0, 1.75], [0.05, 1.70], [0.11, 1.58], [0.17, 1.40], [0.215, 1.15], [0.235, 0.85], [FR, 0.55],
      [FR, -1.10], [0.225, -1.40], [0.19, -1.58], [0.14, -1.70], [0.10, -1.76]];
    G.m("paint").c(1);
    G.save().tf(0, FY, 0, 0, -PI / 2, 0).lathe(prof, 20).restore();
    // the warhead's joint, the access panels, the seam lines
    G.c(0.78);
    [1.12, 0.62, -0.20, -1.10].forEach(function (z) { G.cyl(0, FY, z, FR * 1.006, FR * 1.006, 0.012, "z", 20, 0, 0, 0, { open: true }); });
    G.c(0.9).box(0, FY + FR * 0.98, 0.10, 0.20, 0.012, 0.50);
    // the contact fuze in the nose and the pitot under it
    G.m("body").c(0x2a2a2a).cyl(0, FY, 1.77, 0.018, 0.03, 0.05, "z", 10);
    G.c(0x8a8a8a).tube([0, FY - 0.10, 1.45], [0, FY - 0.13, 1.70], 0.006, 0.005, 5);
    // ---- the cropped delta, both halves, blended into the fuselage sides
    G.m("paint").c(0.97);
    [-1, 1].forEach(function (s) {
      const sec = function (x, le, te, t) {
        const c = le - te;
        return { a: x, pts: [[le, WING.y], [le - c * 0.08, WING.y + t * 0.45], [le - c * 0.42, WING.y + t * 0.55], [te + 0.01, WING.y + t * 0.12],
          [te, WING.y - t * 0.05], [le - c * 0.42, WING.y - t * 0.35], [le - c * 0.08, WING.y - t * 0.3]] };
      };
      const xr = s * 0.12, xt = s * SPAN / 2;
      const leAt = function (x) { const k = (Math.abs(x) - 0.12) / (SPAN / 2 - 0.12); return WING.rootLE + (WING.tipLE - WING.rootLE) * k; };
      G.loft("x", [sec(xr, WING.rootLE, WING.rootTE, WING.root), sec(s * 0.7, leAt(0.7), WING.rootTE, WING.root * 0.7), sec(xt, WING.tipLE, WING.tipTE, WING.t * 0.6)]);
      // the elevons along the trailing edge, their hinge line
      G.c(0.84).box(s * 0.72, WING.y + 0.004, WING.rootTE + 0.10, 0.98, 0.014, 0.012);
      G.c(0.97);
      // THE WINGTIP FIN: up 0.5 m and a little down, swept, the rudder's hinge
      G.save().tf(xt, WING.y, -1.25, 0, 0, s * -0.05);
      G.prof(-0.012, 0.012, [[0.30, 0.0], [-0.30, 0.0], [-0.36, 0.52], [-0.10, 0.52]]);
      G.prof(-0.012, 0.012, [[0.30, 0.0], [-0.30, 0.0], [-0.26, -0.15], [0.05, -0.15]]);
      G.c(0.82).box(0, 0.25, -0.24, 0.026, 0.48, 0.008);
      G.restore();
      G.c(0.97);
    });
    // ---- the engine bay: the cowl's cooling inlets, the exhaust stubs
    G.m("body").c(0x1b1b1b);
    [-1, 1].forEach(function (s) {
      G.box(s * (FR * 0.95), FY + 0.05, -1.30, 0.03, 0.08, 0.22);                  // inlet grille
      G.c(0x4a4038).tube([s * 0.17, FY - 0.08, -1.55], [s * 0.22, FY - 0.12, -1.80], 0.025, 0.022, 7);   // exhaust pipes
      G.c(0x1b1b1b);
    });
    // the prop's spinner shaft
    G.c(0x2a2a2a).cyl(0, FY, -1.80, 0.06, 0.08, 0.10, "z", 12);
    // the Kometa CRPA antenna on the back: an eight-element ring under a dome
    G.c(0x2f3133).cyl(0, FY + FR + 0.015, -0.35, 0.10, 0.11, 0.03, "y", 16);
    G.c(0x575a5d).sphere(0, FY + FR + 0.03, -0.35, 0.095, 10, 1, 0.25, 1, 0, PI / 2);
    // the serial in white on both sides of the nose
    G.c(0xe6e6e0);
    [-1, 1].forEach(function (s) { G.box(s * (FR * 0.97 + 0.002), FY + 0.04, 0.85, 0.002, 0.06, 0.30); });
    return G.build({ uv: 1, mud: 0 });
  }
  function propGeo() {
    const G = CBZ.hullKit.geo();
    // two wide wooden blades on the hub, about Z (the pusher's axis)
    G.m("body").c(0x5a4630);
    for (let b = 0; b < 2; b++) {
      G.save().tf(0, 0, 0, 0, 0, b * PI);
      const st = 6;
      for (let i = 0; i < st; i++) {
        const r0 = 0.06 + (PROP_R - 0.06) * i / st, r1 = 0.06 + (PROP_R - 0.06) * (i + 1) / st;
        const c0 = 0.085 * (1 - 0.4 * i / st), c1 = 0.085 * (1 - 0.4 * (i + 1) / st);
        const p0 = 0.5 - 0.3 * i / st, p1 = 0.5 - 0.3 * (i + 1) / st;
        const q = function (y, c, p, s) { return [Math.cos(p) * c * 0.5 * s, y, Math.sin(p) * c * 0.5 * s]; };
        const A = q(r0, c0, p0, 1), B = q(r1, c1, p1, 1), C = q(r1, c1, p1, -1), D = q(r0, c0, p0, -1);
        G.tri(null, A, B, C, [0, 0, -1]); G.tri(null, A, C, D, [0, 0, -1]);
        G.tri(null, A, C, B, [0, 0, 1]); G.tri(null, A, D, C, [0, 0, 1]);
      }
      G.restore();
    }
    G.c(0x202020).sphere(0, 0, 0, 0.07, 9, 1, 1, 1.3, 0, PI / 2, -PI / 2, 0, 0);
    return G.build({ uv: 1, mud: 0 });
  }
  // the solid booster under the tail: casing, nozzle, the two straps
  function boostGeo() {
    const G = CBZ.hullKit.geo();
    G.m("body").c(0x3c3f37).cyl(0, 0, 0, 0.10, 0.10, 1.05, "z", 14);
    G.c(0x272727).cyl(0, 0, -0.58, 0.06, 0.09, 0.12, "z", 12);
    G.c(0x51544b);
    [-0.3, 0.3].forEach(function (z) { G.cyl(0, 0, z, 0.104, 0.104, 0.04, "z", 14, 0, 0, 0, { open: true }); });
    G.tube([0, 0.10, -0.3], [0, 0.17, -0.3], 0.012, 0.012, 5).tube([0, 0.10, 0.3], [0, 0.17, 0.3], 0.012, 0.012, 5);
    return G.build({ uv: 1, mud: 0 });
  }

  function build(ctx) {
    const THREE = window.THREE, K = CBZ.droneKit;
    if (!THREE || !K || !CBZ.hullKit) return null;
    const B = K.cache("shahed_136", function () { return { body: bodyGeo(), prop: propGeo(), boost: boostGeo() }; });
    const paint = K.paintMat(paintFor(ctx && ctx.nation));
    const root = new THREE.Group(); root.name = "shahed_136";
    const air = new THREE.Group(); air.name = "airframe"; root.add(air);
    K.meshes(air, B.body, paint, "body");
    const prop = new THREE.Group(); prop.name = "prop"; prop.position.set(0, FY, -1.88); air.add(prop);
    const blades = new THREE.Group(); prop.add(blades); K.meshes(blades, B.prop, paint, "prop");
    const disc = new THREE.Mesh(K.discGeo(PROP_R), K.mats().blur); disc.rotation.x = PI / 2; disc.visible = false; prop.add(disc);
    const boost = new THREE.Group(); boost.name = "booster"; boost.position.set(0, FY - FR - 0.12, -1.0); boost.rotation.x = 0.12; air.add(boost);
    K.meshes(boost, B.boost, paint, "booster");
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.9, 10, 1, true), K.mats().flame);
    flame.rotation.x = -PI / 2; flame.position.set(0, 0, -1.1); flame.visible = false; boost.add(flame);
    const R = { root: root, air: air, prop: prop, blades: blades, disc: disc, boost: boost, flame: flame, rpm: 0, spin: 0, t: 0, hit: false, fire: false, smokeT: 0, exT: 0 };
    const rig = {
      state: R,
      mark: function (nation) { K.repaint(root, K.paintMat(paintFor(nation))); },
      damage: function (vs, res) { if (res && (res.pen || res.dmg > 0)) R.hit = true; if (res && res.burning) R.fire = true; },
      tick: function (dt, dr) { tick(R, dt, dr); },
    };
    tick(R, 0, null);
    return { group: root, rig: rig, footW: SPAN, footL: L + 0.2, height: 0.9 };
  }
  // the Geran-2's matte black for an army in Russian kit, light grey otherwise
  function paintFor(nation) { return nation === "kesh" || nation === "solara" ? 0x232425 : 0xa3a6a2; }
  function tick(R, dt, dr) {
    dt = dt > 0 ? Math.min(0.1, dt) : 0;
    R.t += dt;
    const want = dr ? (dr.prop || 0) : 0;
    R.rpm += (want - R.rpm) * Math.min(1, dt * 2.5);
    R.spin = (R.spin + R.rpm * 90 * dt) % (2 * PI);
    R.prop.rotation.z = R.spin;
    const fast = R.rpm > 0.4 && dt > 0;
    R.disc.visible = fast; R.blades.visible = !fast || R.rpm < 0.7;
    // the booster: burning, then gone
    const b = dr ? dr.boost || 0 : 0;
    R.boost.visible = !(dr && dr.dropped);
    R.flame.visible = b > 0 && R.boost.visible;
    if (R.flame.visible) R.flame.scale.set(1, 0.8 + Math.sin(R.t * 90) * 0.2, 1);
    if (dt <= 0 || !R.root.parent || !CBZ.cityCrashSmoke) return;
    const p = R.root.position;
    if (b > 0) {
      R.exT -= dt;
      if (R.exT <= 0) { R.exT = 0.05; try { CBZ.cityCrashSmoke(p.x, p.y + 0.2, p.z, { count: 1, scale: 0.9, shade: 0.85 }); } catch (e) {} }
    }
    if ((R.hit || R.fire) && !(dr && dr.ph === "spent")) {
      R.smokeT -= dt;
      if (R.smokeT <= 0) { R.smokeT = 0.15; try { CBZ.cityCrashSmoke(p.x, p.y + 0.35, p.z, { count: 1, scale: 0.6, shade: 0.25, flame: R.fire }); } catch (e) {} }
    }
  }

  CBZ.unitKit.register("shahed_136", {
    kind: "vehicle",
    domain: "air",
    drive: "drone",
    stats: {
      hp: 45, mass: 200, speed: 51, length: L, width: SPAN, height: 0.9,
      // glass fibre and a thin alloy frame: nothing stops a round, but it takes
      // several before the engine or a spar goes
      armour: { front: 1, side: 1, rear: 1, top: 1 },
      remote: true,
      rcs: 0.1,
      detect: 2500,                                  // the MD-550's drone carries for kilometres
    },
    crew: [],
    passengers: 0,
    weapons: [],
    /* THE DOCTRINE'S NUMBERS (src/battle/drones.js): GNSS to coordinates
       (no link to lose, nobody to kill), 51 m/s, bank-limited turns, cruise
       ~300 m over the fight, the dive at ~45 deg onto the point. heard: how
       far off the engine is heard and men look up for it. */
    drone: {
      cls: "owa", frame: "wing", launch: "rail", link: "gnss",
      range: 2000000, endurance: 36000, cruise: 51, dash: 58, turn: 0.22, climb: 5,
      agl: 300, terminal: 1200, dive: 0.8, heard: 2500,
      warheads: ["shahed136_he"],
      carriers: ["shahed_launcher"],
    },
    tactics: {
      role: "one-way-attack",
      // what a route is planned to: the things that sit still and matter
      priorities: ["sam", "artillery", "parked", "vehicle", "group"],
      attack: "dive",
      noisy: true,
    },
    build: build,
    animate: function (veh, dt, ctx) {
      const r = veh && veh.rig;
      if (r && r.tick) r.tick(dt, veh.dr || null, ctx);
    },
  });
})();
