/* ============================================================
   units/kit/drone.js — CBZ.droneKit: WHAT EVERY DRONE SHARES.

   The drone unit files (src/units/vehicles/fpv_drone.js, switchblade_600.js,
   switchblade_300.js, shahed_136.js) and the doctrine that flies them
   (src/battle/drones.js) lean on this file instead of each growing its own
   warhead numbers, carrier table, weak-spot table or operator kit. It is the
   body-and-data half; the battle half is drones.js.

   1. WARHEAD    the drone munitions BY ID (the one place their numbers live
                 until the shared weapons table lands: move this object there
                 whole and point WARHEAD at it). A unit file names its
                 warheads by id (`def.drone.warheads`), never by number.
   2. CARRIERS   where a launcher sits on a carrier it does not own (the
                 Humvee, the JLTV, the Stryker carry Switchblade canisters);
                 a carrier that is a drone file's own (shahed_launcher) says
                 so itself in `def.launches`.
   3. WEAK       where a hull is weak to a diving drone, by vehicle id, in
                 hull space (x port, y up from the ground, z forward): the
                 engine deck, the rear, the roof. Unknown hulls get the rear-
                 engine default from their own footprint.
   4. BODY       the shared drawing kit: the drone palette (one vertex-coloured
                 material, a paint material per scheme, glass, the prop blur),
                 prop blades, the folding-wing Switchblade family
                 (switchblade(spec) -> { build, animate }) and its launch tube.
   5. OPERATOR   what the man flying it wears: FPV goggles and the radio for
                 an FPV pilot, the handheld ground control station for a
                 Switchblade gunner (dress(man, kind), show(man, flying)).

   Pure data and functions until build time: loads in node without THREE
   (tools/npcwar-check.mjs). Every load redefines the kit, which is what lets
   the shot service hot-swap it.

   Units: metres, m/s, kg, mm RHA. Nose +Z, +X is port, y up from the bottom.
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ || (W.CBZ = {});
  const PI = Math.PI;
  function T() { return W.THREE; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function sstep(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }

  /* ================================================================ 1. WARHEAD
     pen     mm RHA the charge defeats on contact (a shaped charge's jet, or
             what a big HE charge breaches when it goes off ON the plate)
     beh     what reaches the inside once it is through (the kit's resolve)
     cls     the threat class armour is read against: "heat" / "atgm" are
             read against a hull's armourCE (composite and ERA count), the
             rest against its kinetic table
     blast   the page's boom radius (m): studio.boom kills inside 0.55 x
     power   the boom's power
     blastPen  what the blast alone puts on a hull inside 0.55 x blast
     anti    what it is for: "armour" | "men" | "point"
     dud     the share that do not go off on a bad strike (shot down, a
             graze): the piezo fuze of an RPG head wants a nose-on blow */
  /* THE WARHEADS ARE THE MUNITION TABLE'S (weapons/munitiontable.js): each
     drone warhead names its row (`mun`) and keeps only what is the drone's
     own business (what it is for, how often it duds, how the armour reads
     the jet). pen / beh / blast / power / blastPen are filled from the
     table the first time a warhead is asked for. */
  const WARHEAD = {
    // PG-7VL: the RPG-7's 93 mm single shaped charge, taped under most strike FPVs, motor removed
    pg7vl_fpv: { mun: "fpv_pg7vl", cls: "heat", anti: "armour", dud: 0.25 },
    // OG-7V: the 40 mm fragmentation round of the same launcher, for men in trenches and dugouts
    og7v_fpv: { mun: "fpv_og7v", cls: "blast", anti: "men", dud: 0.2 },
    // Switchblade 600: the Javelin's tandem shaped charge, top attack in the dive
    sb600_tandem: { mun: "switchblade600", cls: "atgm", anti: "armour", dud: 0.1 },
    // Switchblade 300 Block 20: a forward-firing fragmentation charge
    sb300_frag: { mun: "switchblade300", cls: "blast", anti: "men", dud: 0.1 },
    // Shahed-136 / Geran-2: HE-fragmentation in the nose
    shahed136_he: { mun: "shahed136", cls: "bomb", anti: "point", dud: 0.3 },
  };
  function armWarhead(w) {
    if (!w || w._armed || !CBZ.munitionTable) return w;
    const f = CBZ.munitionTable.fx(w.mun);
    if (!f) return w;
    w._armed = true;
    w.name = f.name; w.pen = f.pen; w.beh = f.beh; w.blast = f.R; w.power = f.power; w.blastPen = Math.round(f.contact); w.W = f.W;
    return w;
  }

  /* ================================================================ 2. CARRIERS
     Switchblade canisters on hulls whose files are not the drones'. Slots
     are [x, y, z] in the carrier's hull space at the canister's REAR end,
     on a cradle `pitch` rad nose-up, pointing over the nose (yaw 0). The
     numbers are read off each hull file's own constants: the Humvee's trunk
     deck behind the cab (ROOF 1.92, deck ~1.25, z -1.1 .. -2.45), the JLTV's
     short cargo bed behind the cab (bed floor ~1.15), the Stryker's rear
     roof (roof 2.10, the hull 6.95 m long). */
  const CARRIERS = {
    hmmwv: { pitch: 0.55, slots: [[0.32, 1.30, -2.25], [-0.32, 1.30, -2.25]] },
    jltv: { pitch: 0.55, slots: [[0.42, 1.22, -2.75], [-0.42, 1.22, -2.75]] },
    stryker_apc: { pitch: 0.55, slots: [[0.82, 2.14, -3.05], [0.52, 2.14, -3.05], [-0.52, 2.14, -3.05], [-0.82, 2.14, -3.05]] },
  };
  function carrierOf(veh, droneId) {
    if (!veh || !veh.def) return null;
    const own = veh.def.launches;
    if (own && (!own.ids || own.ids.indexOf(droneId) >= 0)) return own;
    const C = CARRIERS[veh.unitId];
    if (C && /^switchblade/.test(droneId)) return C;
    return null;
  }

  /* ================================================================ 3. WEAK
     Where a hull is weak to a diving drone (hull space, metres). `deck` is the
     engine deck (louvres and grilles: thin plate over the engine and its fuel),
     `rear` the rear face (the ramp, the door, the bustle), `top` the roof
     over the crew. Each is [x, y, z, facing] with facing "top" | "rear".
       M1 Abrams    the AGT1500's grille deck behind the turret bustle, 40 mm
                    kinetic / 60 mm CE on top; the bustle and the rear grille
       M2 Bradley   FRONT-ENGINE: the engine deck is the right front of the
                    hull roof beside the driver; the rear ramp
       Stryker      front-engine (right front); the rear ramp
       MaxxPro, JLTV, Humvee, trucks   the bonnet over the engine; the roof
   Anything not listed is read off its own footprint as a rear-engined hull. */
  const WEAK = {
    m1_abrams: { deck: [0, 1.85, -2.85, "top"], rear: [0, 1.25, -3.95, "rear"], top: [0.15, 2.40, -0.10, "top"] },
    bradley_ifv: { deck: [-0.55, 2.00, 1.70, "top"], rear: [0, 1.15, -3.15, "rear"], top: [0.30, 2.95, -0.20, "top"] },
    stryker_apc: { deck: [-0.65, 2.05, 2.30, "top"], rear: [0, 1.30, -3.40, "rear"], top: [0, 2.12, -1.20, "top"] },
    maxxpro_mrap: { deck: [0, 1.95, 2.30, "top"], rear: [0, 1.60, -3.30, "rear"], top: [0, 3.05, -0.60, "top"] },
    jltv: { deck: [0, 1.62, 2.20, "top"], rear: [0, 1.20, -3.05, "rear"], top: [0, 2.22, -0.10, "top"] },
    hmmwv: { deck: [0, 1.30, 1.70, "top"], rear: [0, 1.10, -2.40, "rear"], top: [0, 1.95, -0.30, "top"] },
  };
  // the three spots for any hull: listed, else off its footprint (rear engine)
  function weakOf(veh) {
    const w = veh && WEAK[veh.unitId];
    if (w) return w;
    const L = (veh && veh.vlen) || 3, H = (veh && veh.vheight) || 2.4;
    return { deck: [0, H * 0.74, -L * 0.70, "top"], rear: [0, H * 0.48, -L * 0.98, "rear"], top: [0, H * 0.97, 0, "top"] };
  }

  /* ================================================================ 4. BODY */
  const MAT = {};
  // one vertex-coloured material for every opaque part, its paint per hex,
  // the optics, the prop blur and the lamps
  function mats() {
    const THREE = T();
    if (MAT.body) return MAT;
    MAT.body = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
    MAT.glass = new THREE.MeshPhongMaterial({ color: 0x0d1418, specular: 0x7a8a96, shininess: 110 });
    MAT.blur = new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
    MAT.flame = new THREE.MeshBasicMaterial({ color: 0xffb048, transparent: true, opacity: 0.85, depthWrite: false });
    MAT.ledG = new THREE.MeshBasicMaterial({ color: 0x41ff6a });
    MAT.ledR = new THREE.MeshBasicMaterial({ color: 0xff3b2a });
    MAT.screen = new THREE.MeshBasicMaterial({ color: 0x6fa0b8 });
    return MAT;
  }
  const PAINT = {};
  function paintMat(hex) {
    const THREE = T();
    if (PAINT[hex]) return PAINT[hex];
    const H = CBZ.hullKit, c = new THREE.Color();
    if (H && H.lin) { const l = H.lin(hex); c.setRGB(l[0], l[1], l[2]); } else c.setHex(hex);
    return (PAINT[hex] = new THREE.MeshLambertMaterial({ color: c, vertexColors: true }));
  }
  // a flat colour that sits on a lit material, from an sRGB hex
  function lin(hex) { return CBZ.hullKit && CBZ.hullKit.lin ? CBZ.hullKit.lin(hex) : [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]; }
  function geo() { return CBZ.hullKit.geo(); }
  // meshes from a bucket set: "paint" takes the given paint material, the
  // others the shared ones; each mesh is tagged so mark() can repaint it
  function meshes(parent, geos, paint, name) {
    const THREE = T(), M = mats(), out = [];
    Object.keys(geos).forEach(function (k) {
      const mat = k === "paint" ? paint : M[k];
      if (!mat) return;
      const m = new THREE.Mesh(geos[k], mat);
      m.name = (name || "part") + ":" + k;
      m.userData.dkKey = k;
      m.castShadow = k !== "blur" && k !== "flame"; m.receiveShadow = false;
      parent.add(m); out.push(m);
    });
    return out;
  }
  function repaint(root, paint) {
    root.traverse(function (o) { if (o.isMesh && o.userData && o.userData.dkKey === "paint") o.material = paint; });
  }
  /* PROP BLADES about +Y (a lifting prop) in the XZ plane: n blades of radius
     r, chord c at the root tapering to the tip, twisted (pitch at the root,
     flatter at the tip), the hub. `G` is a hull-kit geometry; `cw` spins the
     twist the other way for a counter-rotating prop. */
  function blades(G, r, n, c, hubR, cw) {
    const tw = cw ? -1 : 1;
    for (let b = 0; b < n; b++) {
      const a = b * 2 * PI / n;
      G.save().tf(0, 0, 0, 0, a, 0);
      const st = 5;
      for (let i = 0; i < st; i++) {
        const r0 = hubR + (r - hubR) * i / st, r1 = hubR + (r - hubR) * (i + 1) / st;
        const k0 = 1 - 0.55 * i / st, k1 = 1 - 0.55 * (i + 1) / st;
        const p0 = tw * (0.42 - 0.3 * i / st), p1 = tw * (0.42 - 0.3 * (i + 1) / st);
        // one twisted strip: leading and trailing edges at two radii
        const q = function (rr, k, p, s) { return [rr, Math.sin(p) * c * k * 0.5 * s, Math.cos(p) * c * k * 0.5 * s]; };
        const A = q(r0, k0, p0, 1), B = q(r1, k1, p1, 1), C = q(r1, k1, p1, -1), D = q(r0, k0, p0, -1);
        G.tri(null, A, B, C, [0, 1, 0]); G.tri(null, A, C, D, [0, 1, 0]);
        G.tri(null, A, C, B, [0, -1, 0]); G.tri(null, A, D, C, [0, -1, 0]);
      }
      G.restore();
    }
    G.cyl(0, 0, 0, hubR, hubR * 1.1, hubR * 1.4, "y", 10);
    G.sphere(0, hubR * 0.7, 0, hubR * 0.85, 8, 1, 0.8, 1, 0, PI / 2);
    return G;
  }
  // the spinning prop's disc (one shared circle per radius)
  const DISC = {};
  function discGeo(r) {
    const THREE = T(), k = r.toFixed(3);
    if (DISC[k]) return DISC[k];
    const g = new THREE.CircleGeometry(r, 28);
    g.rotateX(-PI / 2);
    return (DISC[k] = g);
  }
  const CACHE = {};
  function cache(key, fn) { return CACHE[key] || (CACHE[key] = fn()); }

  /* ---------------------------------------------------------------- SWITCHBLADE
     The AeroVironment Switchblade family: a tube-launched loitering munition.
     A round fuselage (EO/IR sensor in the nose, the warhead behind it, the
     battery and electronics, the electric motor in the tail cone), two pairs
     of folding wings in tandem (the forward pair on top, swinging out from
     lying back along the body; the aft pair underneath, swinging out from
     lying forward), two tail fins that spring up, and a two-blade pusher prop
     whose blades lie folded along the tail cone until the motor spins them
     out. It lives folded in a sealed launch tube; a gas generator throws it
     out, the wings snap open in the first few tenths of a second and the
     motor starts.
       spec = { id, len, R, fwSpan, fwChord, fwZ, awSpan, awChord, awZ,
                finH, propR, tubeL, tubeR, paint, legs }
     build(ctx) -> { group, rig, footW, footL, height }; the rig carries the
     launch tube (rig.tube, a separate group the doctrine places), mark,
     damage and tick (wings 0..1, prop rpm, sensor, the lost tube cap). */
  function switchblade(spec) {
    const S = spec, y0 = S.R + 0.012;                 // the body's axis over the bottom of the aft wing
    function bodyGeo() {
      const G = geo();
      // ---- the fuselage, turned about Z: [radius, z] nose to tail
      const nz = S.len / 2, tz = -S.len / 2;
      const prof = [[0.0, nz], [S.R * 0.55, nz - S.R * 0.18], [S.R * 0.86, nz - S.R * 0.55], [S.R, nz - S.R * 1.3], [S.R, tz + S.len * 0.18],
        [S.R * 0.82, tz + S.len * 0.08], [S.R * 0.55, tz + S.len * 0.02], [S.R * 0.42, tz]];
      G.m("paint").c(1);
      G.save().tf(0, y0, 0, 0, -PI / 2, 0).lathe(prof, 18).restore();          // the lathe's axis (X) turned onto Z
      // seams between the sections: sensor, warhead, battery, motor
      G.c(0.72);
      [nz - S.R * 1.6, nz - S.len * 0.34, -S.len * 0.05, tz + S.len * 0.2].forEach(function (z) { G.cyl(0, y0, z, S.R * 1.008, S.R * 1.008, S.len * 0.006, "z", 18, 0, 0, 0, { open: true }); });
      G.c(1);
      // the warhead band: the arming and safety label stripe, the fuze port
      G.save().m("body").c(0x8a6d2a).cyl(0, y0, nz - S.len * 0.28, S.R * 1.01, S.R * 1.01, S.len * 0.03, "z", 18, 0, 0, 0, { open: true }).restore();
      // the wing root fairing on the back (the forward pair's pivot), the aft pivot pad under the tail
      G.c(0.86).box(0, y0 + S.R * 0.96, S.fwZ, S.R * 0.9, S.R * 0.16, S.fwChord * 1.3);
      G.box(0, y0 - S.R * 0.96, S.awZ, S.R * 0.9, S.R * 0.14, S.awChord * 1.2);
      // blade antennas and the GPS patch on the back
      G.m("body").c(0x1d1f21);
      G.box(0, y0 + S.R * 1.05, -S.len * 0.12, S.R * 0.04, S.R * 0.45, S.R * 0.6, -0.2, 0, 0);
      G.box(S.R * 0.62, y0 + S.R * 0.78, -S.len * 0.22, S.R * 0.03, S.R * 0.32, S.R * 0.5, 0, 0, -0.9);
      G.c(0x4a4d50).cyl(0, y0 + S.R * 0.995, S.fwZ - S.fwChord * 1.1, S.R * 0.28, S.R * 0.3, S.R * 0.05, "y", 12);
      // the motor's cooling slots round the tail cone
      G.c(0x202224);
      for (let i = 0; i < 8; i++) { const a = i * PI / 4; G.box(Math.sin(a) * S.R * 0.66, y0 + Math.cos(a) * S.R * 0.66, tz + S.len * 0.06, S.R * 0.05, S.R * 0.05, S.len * 0.06, 0, 0, a); }
      // the sensor: a dark collar and the glass dome in the nose
      G.c(0x141618).cyl(0, y0, nz - S.R * 0.62, S.R * 0.9, S.R * 0.96, S.R * 0.22, "z", 18);
      G.m("glass").c(1).sphere(0, y0 - S.R * 0.08, nz - S.R * 0.45, S.R * 0.62, 10, 1, 1, 1.05, 0, PI / 2, PI / 2, 0, 0);
      // the motor shaft stub behind the tail (the prop hub is its own node)
      G.m("body").c(0x2a2b2d).cyl(0, y0, tz - S.R * 0.15, S.R * 0.18, S.R * 0.22, S.R * 0.3, "z", 10);
      return G.build({ uv: 1, mud: 0 });
    }
    // a half wing on its pivot: span along -Z (stowed: lying along the body),
    // chord along X with its leading edge on +X (port) or -X (starboard)
    function wingGeo(span, chord, s, thick) {
      const G = geo();
      const t = thick || chord * 0.09;
      const sec = function (k, z) {
        const c = chord * k, le = s * c * 0.5, te = -s * c * 0.5;
        return [z, [[le, 0], [le - s * c * 0.08, t * 0.5], [le - s * c * 0.4, t * 0.62], [te, t * 0.12], [te, -t * 0.08], [le - s * c * 0.4, -t * 0.3], [le - s * c * 0.08, -t * 0.25]]];
      };
      G.m("paint").c(1).sect([sec(1, -0.004), sec(1, -span * 0.86), sec(0.86, -span * 0.97), sec(0.55, -span)]);
      // the hinge boss at the root
      G.c(0.7).cyl(0, 0, -chord * 0.05, chord * 0.14, chord * 0.14, t * 1.6, "y", 10);
      return G.build({ uv: 1, mud: 0 });
    }
    function finGeo(h, c) {
      const G = geo();
      G.m("paint").c(0.96).prof(-0.003, 0.003, [[0, 0], [-c, 0], [-c * 0.92, h], [-c * 0.35, h * 0.92]]);
      return G.build({ uv: 1, mud: 0 });
    }
    function propGeo() {
      const G = geo();
      G.m("body").c(0x1b1c1e);
      // one folding blade along +Y from the hinge (the other is its turn)
      const r = S.propR, c = r * 0.18;
      for (let i = 0; i < 5; i++) {
        const a = r * 0.12 + (r * 0.88) * i / 5, b = r * 0.12 + (r * 0.88) * (i + 1) / 5;
        const ka = 1 - 0.5 * i / 5, kb = 1 - 0.5 * (i + 1) / 5, pa = 0.5 - 0.3 * i / 5, pb = 0.5 - 0.3 * (i + 1) / 5;
        const q = function (y, k, p, s) { return [Math.cos(p) * c * k * 0.5 * s, y, Math.sin(p) * c * k * 0.5 * s]; };
        const A = q(a, ka, pa, 1), B = q(b, kb, pb, 1), C = q(b, kb, pb, -1), D = q(a, ka, pa, -1);
        G.tri(null, A, B, C, [0, 0, 1]); G.tri(null, A, C, D, [0, 0, 1]);
        G.tri(null, A, C, B, [0, 0, -1]); G.tri(null, A, D, C, [0, 0, -1]);
      }
      G.cyl(0, r * 0.06, 0, c * 0.32, c * 0.32, r * 0.12, "y", 6);
      return G.build({ uv: 1, mud: 0 });
    }
    function hubGeo() {
      const G = geo();
      G.m("body").c(0x2c2d2f).sphere(0, 0, 0, S.R * 0.42, 9, 1, 1, 1.4, 0, PI / 2, -PI / 2, 0, 0);
      G.cyl(0, 0, S.R * 0.05, S.R * 0.42, S.R * 0.42, S.R * 0.1, "z", 12);
      return G.build({ uv: 1, mud: 0 });
    }
    // THE LAUNCH TUBE: the sealed canister (rear end at the origin, along +Z),
    // its frangible front cap, the rear closure with the gas generator, the
    // carry handle and strap lugs, the legs it stands on (`legs`: a bipod at
    // the front, a spade at the rear) or a cradle on a vehicle
    function tubeGeo() {
      const G = geo();
      const L = S.tubeL, R = S.tubeR;
      G.m("tube").c(1);
      G.cyl(0, 0, L / 2, R, R, L, "z", 18, 0, 0, 0, { open: true });
      G.c(0.82);
      [0.04, L * 0.33, L * 0.66, L - 0.04].forEach(function (z) { G.cyl(0, 0, z, R * 1.06, R * 1.06, 0.035, "z", 18); });  // stiffening bands
      G.c(0.6).cyl(0, 0, -0.02, R * 1.02, R * 0.9, 0.05, "z", 16);                                          // the rear closure
      G.m("body").c(0x2d2f30).cyl(0, 0, -0.06, R * 0.45, R * 0.45, 0.06, "z", 12);                          // gas generator plug
      G.cyl(R * 0.62, R * 0.62, -0.05, R * 0.12, R * 0.12, 0.05, "z", 8);                                   // the umbilical connector
      // the carry handle and two sling lugs on top
      G.m("tube").c(0.7);
      G.tube([0, R, L * 0.42], [0, R + 0.05, L * 0.45], 0.01, 0.01, 5).tube([0, R + 0.05, L * 0.45], [0, R + 0.05, L * 0.58], 0.01, 0.01, 5).tube([0, R + 0.05, L * 0.58], [0, R, L * 0.61], 0.01, 0.01, 5);
      [0.12, L - 0.12].forEach(function (z) { G.box(R * 0.8, R * 0.55, z, 0.012, 0.03, 0.04); });
      // the stencil band: a pale label down the side
      G.m("body").c(0xd8d2b8).box(R * 1.005, 0, L * 0.5, 0.002, R * 0.5, L * 0.32);
      if (S.legs) {
        G.m("tube").c(0.55);
        // the front bipod folded down, the rear spade
        [-1, 1].forEach(function (s) { G.tube([s * R * 0.6, -R * 0.7, L * 0.78], [s * R * 2.2, -R * 4.0, L * 0.86], 0.012, 0.012, 5); });
        G.box(0, -R * 1.1, 0.06, R * 1.4, 0.02, 0.10);
      }
      return G.build({ uv: 1, mud: 0 });
    }
    function capGeo() {
      const G = geo();
      G.m("tube").c(0.9).cyl(0, 0, 0, S.tubeR * 1.04, S.tubeR * 1.04, 0.025, "z", 18);
      G.c(0.7).cyl(0, 0, 0.014, S.tubeR * 0.6, S.tubeR * 0.6, 0.006, "z", 14);
      return G.build({ uv: 1, mud: 0 });
    }

    function build(ctx) {
      const THREE = T();
      if (!THREE || !CBZ.hullKit) return null;
      const B = cache(S.id, function () {
        return { body: bodyGeo(), wFP: wingGeo(S.fwSpan, S.fwChord, 1), wFS: wingGeo(S.fwSpan, S.fwChord, -1),
          wAP: wingGeo(S.awSpan, S.awChord, 1), wAS: wingGeo(S.awSpan, S.awChord, -1), fin: finGeo(S.finH, S.awChord * 0.9),
          blade: propGeo(), hub: hubGeo(), tube: tubeGeo(), cap: capGeo() };
      });
      const paint = paintMat(S.paint), tubeMat = paintMat(S.tubePaint || 0x5c5f4c);
      const root = new THREE.Group(); root.name = S.id;
      const air = new THREE.Group(); air.name = "airframe"; root.add(air);
      meshes(air, B.body, paint, "body");
      // the forward wings on top: stowed lying back along the body (scissor
      // stacked, one a few mm over the other), swung out at the pivot
      const nodes = {};
      const pivot = function (name, geos, x, y, z) { const n = new THREE.Group(); n.name = name; n.position.set(x, y, z); air.add(n); meshes(n, geos, paint, name); nodes[name] = n; return n; };
      const yt = y0 + S.R * 1.06, yb = y0 - S.R * 1.06;
      pivot("wingFP", B.wFP, 0, yt, S.fwZ);
      pivot("wingFS", B.wFS, 0, yt + S.fwChord * 0.1, S.fwZ);
      // the aft wings underneath: stowed lying FORWARD (turned half round)
      pivot("wingAP", B.wAP, 0, yb, S.awZ);
      pivot("wingAS", B.wAS, 0, yb - S.awChord * 0.1, S.awZ);
      // two tail fins on the tail cone, folded flat until they spring up
      const fins = [];
      [-1, 1].forEach(function (s) {
        const f = new THREE.Group(); f.name = "fin" + (s > 0 ? "P" : "S");
        f.position.set(s * S.R * 0.5, y0 + S.R * 0.62, -S.len * 0.36);
        air.add(f); meshes(f, B.fin, paint, f.name); fins.push(f); f.userData.s = s;
      });
      // the pusher prop: a hub and two blades on hinges that fold them back
      const prop = new THREE.Group(); prop.name = "prop"; prop.position.set(0, y0, -S.len / 2 - S.R * 0.28); air.add(prop);
      meshes(prop, B.hub, paint, "hub");
      const bl = [];
      [0, PI].forEach(function (a) {
        const h = new THREE.Group(); h.rotation.z = a; prop.add(h);
        const hinge = new THREE.Group(); hinge.position.set(0, S.R * 0.3, 0); h.add(hinge);
        meshes(hinge, B.blade, paint, "blade"); bl.push(hinge);
      });
      const disc = new THREE.Mesh(discGeo(S.propR), mats().blur); disc.rotation.x = PI / 2; disc.visible = false; prop.add(disc);
      // the launch tube: its own group, placed by the doctrine (on the ground
      // by the gunner, on a vehicle's cradle); it stays behind when the round leaves
      const tube = new THREE.Group(); tube.name = S.id + "-tube";
      meshes(tube, B.tube, tubeMat, "tube");
      const cap = new THREE.Group(); cap.position.set(0, 0, S.tubeL + 0.012); tube.add(cap);
      meshes(cap, B.cap, tubeMat, "cap");
      tube.userData.dynamic = true;
      const R = {
        id: S.id, root: root, air: air, nodes: nodes, fins: fins, prop: prop, blades: bl, disc: disc, tube: tube, cap: cap,
        wings: -1, spin: 0, rpm: 0, smokeT: 0, hit: false, dead: false, paint: paint, tubeMat: tubeMat, y0: y0,
      };
      const rig = {
        state: R, tube: tube, tubeL: S.tubeL,
        // the side's paint: the airframe's own (AeroVironment ships them in one
        // colour); the canister is olive on green ground, tan on sand
        mark: function (nation, ground) {
          const sand = /sand|dune|desert|erg/.test(String(ground || ""));
          const snow = /snow/.test(String(ground || ""));
          R.tubeMat = paintMat(snow ? 0xc9ccc7 : sand ? 0x9c8a66 : (S.tubePaint || 0x5c5f4c));
          repaint(tube, R.tubeMat);
        },
        damage: function (vs, res) { if (res && res.pen) R.hit = true; },
        tick: function (dt, dr, ctx) { tickSwitchblade(R, S, dt, dr, ctx); },
        // the round's cap leaves when the gas generator fires
        launched: function () { R.cap.visible = false; },
      };
      tickSwitchblade(R, S, 0, null, null);
      return { group: root, rig: rig, footW: S.fwSpan * 2, footL: S.len, height: S.R * 2.2 + 0.02 };
    }
    return { build: build, spec: S };
  }
  // wings 0 folded .. 1 out; the doctrine's dr (null in the stage) says how far
  function tickSwitchblade(R, S, dt, dr, ctx) {
    const N = R.nodes;
    const w = dr ? clamp(dr.wings || 0, 0, 1) : 1;
    if (w !== R.wings) {
      R.wings = w;
      // the forward pair swings out first and fast (spring loaded), the aft
      // pair a beat behind, the fins last
      const f = sstep(w / 0.7), a = sstep((w - 0.15) / 0.7), fin = sstep((w - 0.45) / 0.55);
      N.wingFP.rotation.y = -PI / 2 * f;            // local -Z (back along the body) swings to +X
      N.wingFS.rotation.y = PI / 2 * f;
      N.wingAP.rotation.y = PI + PI / 2 * a;         // lying forward (+Z), out through +X
      N.wingAS.rotation.y = PI - PI / 2 * a;
      // a fin lies folded across the top of the cone, then springs up canted out
      for (let i = 0; i < R.fins.length; i++) { const s = R.fins[i].userData.s; R.fins[i].rotation.z = s * (PI / 2 - 0.12) * (1 - fin) - s * 0.35 * fin; }
    }
    // the prop: blades fold back along the cone at rest, fly out with the rpm
    const rpmT = dr ? (dr.prop || 0) : 0;
    R.rpm += (rpmT - R.rpm) * Math.min(1, (dt || 0) * 4);
    if (dt === 0 && dr) R.rpm = rpmT;
    const out = sstep(R.rpm / 0.35);
    for (let i = 0; i < R.blades.length; i++) R.blades[i].rotation.x = -(PI / 2 - 0.08) * (1 - out);
    R.spin = (R.spin + R.rpm * 520 * (dt || 0)) % (2 * PI);
    R.prop.rotation.z = R.spin;
    const blur = R.rpm > 0.4 && (dt || 0) > 0;
    R.disc.visible = blur;
    for (let i = 0; i < R.blades.length; i++) R.blades[i].visible = !blur || R.rpm < 0.85;
  }

  /* ================================================================ 5. OPERATOR
     What the man flying it wears, fitted to the one human body
     (entities/character.js): the head mesh is in face units scaled by hk on
     the neck; the torso (`body`) is in authored units under the model's
     0.70 metre scale.
       fpv   FPV goggles (a box headset: two displays, a foam face, a strap
             round the head, the receiver module and its patch antennas on
             top) worn up on the helmet brim, pulled down over the eyes to
             fly; the radio held in front of the chest (two gimbals, switches,
             the folding antenna), slung from his neck.
       gcs   the Switchblade's handheld ground control station: a rugged
             tablet with grips and the whip antenna, held in front of him. */
  const OPG = {};
  function opGeo(kind) {
    if (OPG[kind]) return OPG[kind];
    const G = geo();
    if (kind === "goggles") {
      // the face frame (character.js: the neck's frame scaled by hk, eyes at
      // y 0.34, the face's front at z 0.302); the origin is the foam face's
      // back, ~0.19 m wide headset (0.27 face units)
      G.m("body").c(0x1c1d1f);
      G.box(0, 0, 0.06, 0.27, 0.115, 0.13);                                   // the shell
      G.c(0x2a2b2e).box(0, 0.062, 0.06, 0.24, 0.012, 0.11);
      G.c(0x3c3d40).box(0, -0.004, 0.128, 0.22, 0.06, 0.008);                 // the front plate
      G.c(0x55606a).box(0, 0.075, 0.04, 0.09, 0.03, 0.07);                    // the receiver module
      G.c(0xd6d6d6).cyl(0.035, 0.105, 0.04, 0.012, 0.012, 0.03, "y", 8).cyl(-0.035, 0.105, 0.04, 0.012, 0.012, 0.03, "y", 8);   // patch antennas
      G.c(0x2b2b2b).box(0, -0.03, -0.005, 0.26, 0.07, 0.02);                  // the foam face
      // the strap: from each side of the shell back round the skull (a
      // half ellipse of short straps, 0.165 out, 0.26 behind its centre)
      G.c(0x161616);
      [-1, 1].forEach(function (s) { G.tube([s * 0.136, -0.01, 0.02], [s * 0.165, -0.01, -0.25], 0.012, 0.012, 5); });
      let px = 0.165, pz = -0.25;
      for (let i = 1; i <= 12; i++) {
        const t = i * PI / 12, x = Math.cos(t) * 0.165, z = -0.25 - Math.sin(t) * 0.26;
        G.tube([px, -0.01, pz], [x, -0.01, z], 0.012, 0.012, 5);
        px = x; pz = z;
      }
    } else if (kind === "radio") {
      // authored units (x 0.70 = metres): ~0.19 x 0.11 m radio
      G.m("body").c(0x202224);
      G.box(0, 0, 0, 0.27, 0.06, 0.15);
      [-1, 1].forEach(function (s) {
        G.c(0x2c2e31).box(s * 0.12, -0.02, -0.03, 0.06, 0.07, 0.12);         // the grips
        G.c(0x0e0e0f).cyl(s * 0.065, 0.035, 0.015, 0.022, 0.022, 0.012, "y", 10);   // gimbal pots
        G.c(0x8a8d90).cyl(s * 0.065, 0.065, 0.015, 0.005, 0.005, 0.05, "y", 5);     // sticks
        G.c(0x161617).cyl(s * 0.065, 0.092, 0.015, 0.009, 0.009, 0.01, "y", 8);
        G.c(0x9a9da0).cyl(s * 0.115, 0.05, 0.06, 0.004, 0.004, 0.03, "y", 4);       // switches
      });
      G.c(0x1a1a1a).tube([0, 0.03, 0.075], [0, 0.20, 0.10], 0.007, 0.006, 5);  // the antenna
      G.m("screen").c(1).box(0, 0.032, -0.035, 0.07, 0.004, 0.045);
    } else {
      // the Switchblade GCS: a ~0.25 x 0.18 m rugged tablet with grips
      G.m("body").c(0x2c2f2b);
      G.box(0, 0, 0, 0.36, 0.035, 0.25);
      [-1, 1].forEach(function (s) { G.c(0x1f2120).box(s * 0.2, -0.01, 0, 0.06, 0.06, 0.2); });
      G.c(0x161616).tube([0.15, 0.02, 0.11], [0.17, 0.26, 0.14], 0.007, 0.005, 5);
      G.m("screen").c(1).box(0, 0.019, 0, 0.27, 0.004, 0.19);
    }
    return (OPG[kind] = G.build({ uv: 1, mud: 0 }));
  }
  function dress(man, kind) {
    const THREE = T(), ch = man && man.char;
    if (!THREE || !ch || !CBZ.hullKit || man._droneKit) return null;
    const M = mats();
    const kit = { kind: kind, goggles: null, radio: null };
    try {
      if (kind === "fpv" && ch.neck) {
        const g = new THREE.Group(); g.name = "fpvGoggles";
        meshes(g, opGeo("goggles"), M.body, "goggles");
        const hk = ((ch.profile && ch.profile.headSize) || 0.6) / 0.6;
        g.scale.setScalar(hk);
        // down: on the eye line, the foam on the face's front; up: pushed up
        // onto the helmet's brim, tipped back
        g.userData.down = { y: 0.345 * hk, z: 0.31 * hk };
        g.userData.up = { y: 0.55 * hk, z: 0.27 * hk, rx: -0.55 };
        ch.neck.add(g); kit.goggles = g;
      }
      const host = ch.body || ch.group;
      const r = new THREE.Group(); r.name = kind === "fpv" ? "fpvRadio" : "gcs";
      meshes(r, opGeo(kind === "fpv" ? "radio" : "gcs"), M.body, r.name);
      // in front of the chest at the hands' height (the "fpv" carry puts them there)
      const P = ch.profile || {}, hipY = ch.hipY || 1.25;
      const y = hipY + (P.torsoH || 0.95) * 0.32;
      let z = 0.36;
      try { if (ch.torsoFrontZ) z = ch.torsoFrontZ(0, y) + 0.24; } catch (e) {}
      r.position.set(0, y, z); r.rotation.x = -0.75;
      host.add(r); kit.radio = r;
    } catch (e) { return null; }
    man._droneKit = kit;
    show(man, false);
    return kit;
  }
  function show(man, flying) {
    const K = man && man._droneKit;
    if (!K) return;
    if (K.goggles) {
      const p = flying ? K.goggles.userData.down : K.goggles.userData.up;
      K.goggles.position.set(0, p.y, p.z);
      K.goggles.rotation.x = flying ? 0 : p.rx;
    }
    if (K.radio) K.radio.visible = !!flying;
  }
  function undress(man) {
    const K = man && man._droneKit;
    if (!K) return;
    if (K.goggles && K.goggles.parent) K.goggles.parent.remove(K.goggles);
    if (K.radio && K.radio.parent) K.radio.parent.remove(K.radio);
    man._droneKit = null;
  }

  CBZ.droneKit = {
    WARHEAD: WARHEAD, CARRIERS: CARRIERS, WEAK: WEAK,
    warhead: function (id) { return armWarhead(WARHEAD[id]) || null; },
    carrierOf: carrierOf, weakOf: weakOf,
    mats: mats, paintMat: paintMat, meshes: meshes, repaint: repaint, lin: lin, cache: cache,
    blades: blades, discGeo: discGeo, switchblade: switchblade,
    dress: dress, show: show, undress: undress,
    clamp: clamp, sstep: sstep,
  };
})();
