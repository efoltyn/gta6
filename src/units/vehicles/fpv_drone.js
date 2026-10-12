/* ============================================================
   units/vehicles/fpv_drone.js — the FPV strike drone: a 7-inch racing-class
   quadcopter with an RPG warhead taped under it, flown by one soldier in
   video goggles (the war in Ukraine made it the most common anti-armour
   weapon on the battlefield; any nation's army fields it here).

   WHAT IT IS. A carbon-fibre X frame (~300 mm motor to motor), four 2806.5
   motors on 7-inch three-blade props, a flight controller and 4-in-1 ESC
   stack between the plates, a 6S lithium-ion pack strapped on top, an
   analogue FPV camera in the nose tilted up for fast forward flight, the
   video transmitter's antenna sticking out of the back, the control
   receiver's two whips on the rear arms. Under it, cable-tied to the bottom
   plate and pointing forward and a little down, the warhead:
     PG-7VL   the RPG-7's 93 mm shaped charge (~500 mm RHA): for armour. The
              pilot flies it into the weak spot: the engine deck, the rear,
              the turret roof, a hatch.
     OG-7V    the 40 mm fragmentation round: for men in trenches and dugouts.
   A team carries a mix (every third drone a frag round). ~2.5 kg all up,
   ~120 km/h flat out with the warhead (33 m/s), ~10 min on the pack, ~10 km
   of analogue link (here: the whole battle map).

   HOW IT FLIES (src/battle/drones.js): low and fast, nose first, banking
   hard, the pilot's view down the camera. It goes round to the target's rear
   or comes over the top for the engine deck, and puts the charge on the
   zone it chose; a shaped charge on the plate it hits is resolved against
   that plate (units/kit/vehicle.js, armourCE). A frag drone dives into the
   trench beside the men.

   COUNTER-DRONE. A 0.45 x 0.4 x 0.2 m box at 30 m/s: rifle fire at it is
   mostly a waste, a machine gun's burst sometimes brings it down; a
   Patriot never engages it (stats.rcs).

   THE RIG (animate on the battle clock): four props spinning at the rpm the
   doctrine commands (the blades show at a crawl, a blur disc at speed;
   diagonal pairs counter-rotate), the flight controller's LEDs, smoke from a
   hit pack. The side's mark is a strip of coloured tape round the rear arms
   (rig.mark), the way the front tells its own drones apart.

   Units: metres, m/s, kg, mm RHA. Nose +Z, +X port, y up from the bottom.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.unitKit) return;
  const PI = Math.PI;

  // ---- the numbers -----------------------------------------------------------
  const FY = 0.105;                       // the bottom plate's height over the warhead's belly
  const MX = 0.106, MZ = 0.106;           // motor centres (a 300 mm diagonal)
  const PROP_R = 0.089;                   // 7-inch props
  const WH = { z: 0.05, y: 0.058, tilt: 0.24 };   // the warhead's mount: centre, axis height, nose down

  function frameGeo() {
    const K = CBZ.droneKit, G = CBZ.hullKit.geo();
    const carbon = 0x1b1c1e, alu = 0xa8241f;
    G.m("body").c(carbon);
    // bottom plate: the centre body and the four arms (unibody X, 5 mm)
    G.box(0, FY, 0, 0.072, 0.005, 0.17);
    [[1, 1], [-1, 1], [1, -1], [-1, -1]].forEach(function (q) {
      const ax = q[0] * MX, az = q[1] * MZ, a = Math.atan2(ax, az), L = Math.hypot(ax, az);
      G.box(ax * 0.5, FY, az * 0.5, 0.024, 0.005, L, 0, a, 0);
      G.cyl(ax, FY, az, 0.017, 0.017, 0.005, "y", 14);                      // the motor pad
    });
    // top plate on four red anodised standoffs
    G.box(0, FY + 0.031, -0.005, 0.05, 0.002, 0.13);
    G.c(alu);
    [[0.019, 0.05], [-0.019, 0.05], [0.019, -0.055], [-0.019, -0.055]].forEach(function (p) { G.cyl(p[0], FY + 0.016, p[1], 0.0035, 0.0035, 0.028, "y", 6); });
    // the stack: ESC under, flight controller over, the capacitor
    G.c(0x253425).box(0, FY + 0.009, -0.01, 0.036, 0.005, 0.036);
    G.c(0x1a2a3a).box(0, FY + 0.021, -0.01, 0.032, 0.004, 0.032);
    G.c(0x252525).cyl(0.026, FY + 0.012, -0.045, 0.005, 0.005, 0.024, "z", 8);
    // the motors: stator bases, bells, shafts (the props are their own nodes)
    [[1, 1], [-1, 1], [1, -1], [-1, -1]].forEach(function (q) {
      const x = q[0] * MX, z = q[1] * MZ;
      G.c(0x2a2b2d).cyl(x, FY + 0.009, z, 0.0165, 0.0165, 0.012, "y", 14);
      G.c(0x5d4d26).cyl(x, FY + 0.021, z, 0.0175, 0.0175, 0.014, "y", 16);     // the bell
      G.c(0x141414).cyl(x, FY + 0.029, z, 0.012, 0.0175, 0.003, "y", 16);
      G.c(0x9a9a9a).cyl(x, FY + 0.035, z, 0.0025, 0.0025, 0.01, "y", 6);
      // the motor's three wires along the arm to the stack
      G.c(0x111111).tube([x * 0.8, FY + 0.006, z * 0.8], [x * 0.25, FY + 0.006, z * 0.25], 0.0025, 0.0025, 4);
    });
    // THE BATTERY: a 6S lithium-ion pack on the top plate, its wrap, the
    // strap, the XT60 lead looping down to the stack
    G.c(0x22324a).box(0, FY + 0.058, -0.012, 0.046, 0.048, 0.15);
    G.c(0xc9a227).box(0.0235, FY + 0.06, -0.012, 0.0015, 0.03, 0.09);
    G.c(0x0e0e0e);
    [0.03, -0.055].forEach(function (z) { G.box(0, FY + 0.058, z, 0.05, 0.052, 0.018); });
    G.c(0xd8b62a).tube([0.012, FY + 0.06, -0.088], [0.015, FY + 0.045, -0.10], 0.004, 0.004, 5).tube([0.015, FY + 0.045, -0.10], [0.008, FY + 0.022, -0.05], 0.004, 0.004, 5);
    G.c(0xe0b72c).box(0.01, FY + 0.022, -0.04, 0.016, 0.008, 0.012);
    // THE CAMERA in its TPU mount, tilted 35 deg up for fast flight
    G.c(0xd4651e);
    [-1, 1].forEach(function (s) { G.box(s * 0.016, FY + 0.016, 0.075, 0.004, 0.03, 0.022); });
    G.save().tf(0, FY + 0.016, 0.077, -0.6, 0, 0);
    G.c(0x161616).box(0, 0, 0, 0.026, 0.022, 0.02);
    G.c(0x0b0b0b).cyl(0, 0, 0.014, 0.008, 0.009, 0.01, "z", 12);
    G.m("glass").c(1).cyl(0, 0, 0.0195, 0.006, 0.006, 0.002, "z", 10);
    G.restore();
    // the VTX antenna out of the back: a stalk and a lollipop
    G.m("body").c(0x161616).tube([0, FY + 0.03, -0.07], [0, FY + 0.075, -0.115], 0.003, 0.003, 5);
    G.c(0x2b2b2b).sphere(0, FY + 0.08, -0.12, 0.011, 8, 1, 0.5, 1);
    // the receiver's two whips, taped along the rear arms and up
    [-1, 1].forEach(function (s) { G.c(0xdedede).tube([s * MX * 0.6, FY + 0.004, -MZ * 0.6], [s * MX * 0.75, FY + 0.05, -MZ * 0.85], 0.0012, 0.0012, 4); });
    // the side's tape on both rear arms (paint: rig.mark)
    G.m("paint").c(1);
    [-1, 1].forEach(function (s) {
      const a = Math.atan2(s * MX, -MZ);
      G.box(s * MX * 0.55, FY, -MZ * 0.55, 0.028, 0.009, 0.03, 0, a, 0);
    });
    return G.build({ uv: 1, mud: 0 });
  }
  // the warheads, each on its own node (only the drone's own is shown):
  // nose along +Z from the mount, the cable ties that hold it to the plate
  function pg7Geo() {
    const G = CBZ.hullKit.geo();
    // PG-7VL head: the piezo nose probe, the long ogive, the 93 mm body, the fuze base
    const prof = [[0.0035, 0.215], [0.007, 0.205], [0.0075, 0.17], [0.016, 0.14], [0.03, 0.095], [0.042, 0.05], [0.0465, 0.015],
      [0.0465, -0.035], [0.036, -0.06], [0.026, -0.075], [0.022, -0.105]];
    G.m("body").c(0x4f5a31);
    G.save().tf(0, 0, 0, 0, -PI / 2, 0).lathe(prof, 16).restore();
    G.c(0x1c1c1c).cyl(0, 0, 0.19, 0.0072, 0.0072, 0.03, "z", 8);              // the probe
    G.c(0x2e2e2a).cyl(0, 0, -0.035, 0.0468, 0.0468, 0.008, "z", 16, 0, 0, 0, { open: true });
    G.c(0xb8a35a).box(0.03, 0.03, 0.0, 0.003, 0.012, 0.035, 0, 0, -0.8);     // the stencil
    // three cable ties and the printed adapter it sits in
    G.c(0x101010);
    [-0.02, 0.0, 0.03].forEach(function (z) { G.cyl(0, 0, z, 0.0478, 0.0478, 0.005, "z", 16, 0, 0, 0, { open: true }); });
    G.c(0x2b2b2b).box(0, 0.045, -0.03, 0.05, 0.01, 0.1);
    return G.build({ uv: 1, mud: 0 });
  }
  function og7Geo() {
    const G = CBZ.hullKit.geo();
    // OG-7V: the 40 mm fragmentation body with its sleeve, the nose fuze
    const prof = [[0.006, 0.19], [0.012, 0.175], [0.019, 0.15], [0.02, 0.13], [0.023, 0.12], [0.023, 0.02], [0.02, 0.01], [0.02, -0.09], [0.017, -0.11]];
    G.m("body").c(0x48532c);
    G.save().tf(0, 0, 0, 0, -PI / 2, 0).lathe(prof, 14).restore();
    G.c(0x5f6340);
    for (let i = 0; i < 6; i++) G.cyl(0, 0, 0.03 + i * 0.016, 0.0236, 0.0236, 0.004, "z", 14, 0, 0, 0, { open: true });   // the notched sleeve
    G.c(0x101010);
    [-0.04, 0.05].forEach(function (z) { G.cyl(0, 0, z, 0.0245, 0.0245, 0.005, "z", 14, 0, 0, 0, { open: true }); });
    G.c(0x2b2b2b).box(0, 0.026, 0.0, 0.03, 0.008, 0.12);
    return G.build({ uv: 1, mud: 0 });
  }
  function propGeo(cw) { const G = CBZ.hullKit.geo(); G.m("body").c(0x2a2d31); CBZ.droneKit.blades(G, PROP_R, 3, 0.022, 0.006, cw); return G.build({ uv: 1, mud: 0 }); }

  function build(ctx) {
    const THREE = window.THREE, K = CBZ.droneKit;
    if (!THREE || !K || !CBZ.hullKit) return null;
    const B = K.cache("fpv_drone", function () { return { frame: frameGeo(), pg7: pg7Geo(), og7: og7Geo(), propA: propGeo(false), propB: propGeo(true) }; });
    const tape = K.paintMat(ctx && ctx.color != null ? ctx.color : 0xc8c83a);
    const root = new THREE.Group(); root.name = "fpv_drone";
    const frame = new THREE.Group(); frame.name = "frame"; root.add(frame);
    K.meshes(frame, B.frame, tape, "frame");
    // the warhead on its mount, nose forward and a little down
    const mount = new THREE.Group(); mount.name = "warhead"; mount.position.set(0, WH.y, WH.z); mount.rotation.x = WH.tilt; frame.add(mount);
    const pg7 = new THREE.Group(); pg7.name = "pg7vl"; mount.add(pg7); K.meshes(pg7, B.pg7, tape, "pg7vl");
    const og7 = new THREE.Group(); og7.name = "og7v"; og7.visible = false; mount.add(og7); K.meshes(og7, B.og7, tape, "og7v");
    // four props: front-left and rear-right turn one way, the others the other
    const props = [];
    [[1, 1, 1], [-1, 1, -1], [1, -1, -1], [-1, -1, 1]].forEach(function (q, i) {
      const p = new THREE.Group(); p.name = "prop" + i; p.position.set(q[0] * MX, FY + 0.032, q[1] * MZ); frame.add(p);
      const bl = new THREE.Group(); p.add(bl); K.meshes(bl, q[2] > 0 ? B.propA : B.propB, tape, "blades");
      const disc = new THREE.Mesh(K.discGeo(PROP_R), K.mats().blur); disc.visible = false; p.add(disc);
      props.push({ node: p, blades: bl, disc: disc, dir: q[2], a: i * 1.3 });
    });
    // the flight controller's LEDs, seen between the plates
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.003, 0.004), K.mats().ledG); led.position.set(0.012, FY + 0.025, -0.02); frame.add(led);
    const R = { root: root, frame: frame, props: props, pg7: pg7, og7: og7, led: led, rpm: 0, t: 0, hit: false, smokeT: 0, wid: "pg7vl_fpv" };
    const rig = {
      state: R,
      // the side's mark: the tape on the rear arms in the side's colour
      mark: function (nation, ground, side) {
        const c = side && side.color != null ? side.color : (ctx && ctx.color);
        if (c != null) K.repaint(root, K.paintMat(c));
      },
      // which warhead this one carries (drones.js, at spawn)
      setWarhead: function (id) { R.wid = id; pg7.visible = id !== "og7v_fpv"; og7.visible = id === "og7v_fpv"; },
      damage: function (vs, res) { if (res && (res.pen || res.dmg > 0)) R.hit = true; },
      tick: function (dt, dr) { tick(R, dt, dr); },
    };
    tick(R, 0, null);
    return { group: root, rig: rig, footW: 0.40, footL: 0.44, height: 0.2 };
  }
  // props at the commanded rpm (0..1), the LEDs, smoke from a hit pack
  function tick(R, dt, dr) {
    dt = dt > 0 ? Math.min(0.1, dt) : 0;
    R.t += dt;
    const want = dr ? (dr.prop || 0) : 0;
    R.rpm += (want - R.rpm) * Math.min(1, dt * 6);
    const fast = R.rpm > 0.35 && dt > 0;
    for (let i = 0; i < R.props.length; i++) {
      const P = R.props[i];
      // ~24,000 rpm flat out (2,500 rad/s); drawn at a rate the eye reads
      P.a = (P.a + P.dir * R.rpm * 140 * dt) % (2 * PI);
      P.blades.rotation.y = P.a;
      P.blades.visible = !fast || R.rpm < 0.6;
      P.disc.visible = fast;
    }
    R.led.visible = (R.t * 4 | 0) % 2 === 0 || R.rpm < 0.05;
    if (dt > 0 && R.hit && CBZ.cityCrashSmoke && R.root.parent && dr && dr.ph !== "spent") {
      R.smokeT -= dt;
      if (R.smokeT <= 0) {
        R.smokeT = 0.12;
        const p = R.root.position;
        try { CBZ.cityCrashSmoke(p.x, p.y + 0.15, p.z, { count: 1, scale: 0.25, shade: 0.3 }); } catch (e) {}
      }
    }
  }

  CBZ.unitKit.register("fpv_drone", {
    kind: "vehicle",
    domain: "air",
    drive: "drone",
    stats: {
      hp: 6, mass: 2.5, speed: 33, length: 0.44, width: 0.40, height: 0.2,
      armour: { front: 0, side: 0, rear: 0, top: 0 },
      remote: true,
      rcs: 0.01,
      detect: 300,                                   // its four props scream: heard, then seen, at ~300 m
    },
    crew: [],
    passengers: 0,
    weapons: [],
    /* THE DOCTRINE'S NUMBERS (src/battle/drones.js): four 2806.5s on 6S lift
       ~3x its weight, so it pulls ~2.4 g sideways and tops out at 33 m/s
       with the warhead, 42 in a dive; it
       transits ~15 m over the ground; a team of two carries four and flies
       them one at a time, ~20 s to arm and connect the next. */
    drone: {
      cls: "fpv", frame: "quad", launch: "hand", link: "analog",
      range: 10000, endurance: 600, cruise: 33, dash: 42, accel: 24, climb: 8,
      agl: 15, perOp: 4, prep: 20,
      warheads: ["pg7vl_fpv", "pg7vl_fpv", "og7v_fpv"],     // every third one a frag round
      terminal: 140,
    },
    tactics: {
      role: "fpv-strike",
      // a PG-7VL hunts armour, an OG-7V men in cover; both take what is near
      priorities: { pg7vl_fpv: ["tank", "ifv", "apc", "artillery", "sam", "vehicle", "launcher"], og7v_fpv: ["dugin", "launcher", "mg", "men", "soft"] },
      weakZones: ["deck", "rear", "top"],            // never the front of a tank
      operator: { cover: true, back: 380 },          // a dugout well behind the line
      lowLevel: true,
    },
    build: build,
    animate: function (veh, dt, ctx) {
      const r = veh && veh.rig;
      if (r && r.tick) r.tick(dt, veh.dr || null, ctx);
    },
  });
})();
