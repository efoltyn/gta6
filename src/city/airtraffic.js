/* ============================================================
   city/airtraffic.js — AMBIENT CIVILIAN AIR TRAFFIC.

   A handful of deterministic civilian aircraft — high-wing GA prop planes
   (Cessna-172 silhouette: wing ON TOP of the cabin spanning ~1.3x the
   fuselage length, wing struts, blunt engine cowl, long tapering tailcone,
   fixed tricycle gear, spinning prop) and a light civilian helicopter
   (Bell-206 silhouette: fat rounded cabin pod on a whip-thin tail boom,
   main rotor disc BIGGER than the whole airframe, small vertical tail
   rotor, wide skids) — orbiting the city on stacked altitude bands,
   banking into their turns at the physically-correct constant-radius bank
   angle (tan(bank) = v^2 / (R*g)), and — since AIR_TRAFFIC_CLEARANCE — flying
   ABOVE the tallest roof their own circuit crosses instead of through it.

   Pure atmosphere: no colliders, no weapons, no wanted interaction, no
   boarding — though a heavy-weapon blast CAN down one (the shoot-down arc
   at the bottom of the file; gated by CBZ.CONFIG.AIRTRAFFIC_DAMAGE).
   Everything about WHERE they fly and WHAT they look like is
   position-hash deterministic (CBZ.hash01 — never Math.random), so every
   client sees the same fleet in the same sky. The only per-frame state is
   one accumulated clock. Gated by CBZ.CONFIG.AIR_TRAFFIC_AMBIENT (one-line
   revert to an empty sky).

   The police/wanted air threat lives in aircraft.js; the player's own
   flyable birds in playeraircraft.js — this module touches neither.
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  // OWNER: "LITTLE PROPELLOR PLANES FLY THRU BUILDINGS." One-line revert to
  // the old four-authored-numbers sky. See ROOF CLEARANCE below.
  if (CFG.AIR_TRAFFIC_CLEARANCE == null) CFG.AIR_TRAFFIC_CLEARANCE = true;

  const cmat = CBZ.cmat || CBZ.mat || function (c, o) { return new THREE.MeshLambertMaterial({ color: c }); };
  function vmat(role, color, opts) {
    if (CBZ.vehicleMat) { try { return CBZ.vehicleMat(role, color, opts); } catch (e) {} }
    return cmat(color != null ? color : 0xd8dde2, opts);
  }
  function h01(i, salt) { return CBZ.hash01 ? CBZ.hash01(i * 17 + 3, i * 5 - 11, salt) : 0.5; }

  // SHAPE HELPER (project-standard taperBox — sculpt a BoxGeometry's position
  // attribute, +Z nose / -Z tail, optional roofline/keel narrowing; r128 has
  // no geometry.vertices[]). Local copy per the builders-stay-self-contained
  // convention (aircraft.js / playeraircraft.js carry their own).
  // taperBox lives ONCE in world/carfx.js now (was copied into 6 builders).
  function taperBox(w, h, d, opt) { return CBZ.taperBox(w, h, d, opt); }
  // one thin tapered rotor blade rooted at the hub, extending +X
  function bladeGeo(len, droop) {
    const geo = new THREE.BoxGeometry(len, 0.07, 0.34, 6, 1, 1);
    const pos = geo.attributes.position, hl = len / 2;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), t = (x + hl) / len;
      pos.setX(i, x + hl);
      pos.setZ(i, pos.getZ(i) * (1 - 0.45 * t));
      pos.setY(i, pos.getY(i) - (droop || 0) * t * t);
    }
    pos.needsUpdate = true; geo.computeVertexNormals();
    return geo;
  }

  // ---- tunables -------------------------------------------------------------
  const N_TRAFFIC   = 4;                       // a handful — atmosphere, not an airshow
  // Stacked VFR bands. (The old comment here claimed these sat "all above the
  // police air (44/52)"; that stopped being true when Air-1 moved onto
  // CBZ.heliSpec's 150 m search / 85 m engaged postures. These bands are
  // deliberately UNCHANGED — this fleet is TRANSITING traffic, not air support
  // orbiting a point, so a low-level GA circuit crossing under and over a
  // police orbit is correct and is also what keeps these craft shootable.)
  // THEY ARE NOW A FLOOR, NOT AN ANSWER: a band is what a craft flies when its
  // own track is CLEAR, and the ROOF CLEARANCE block below raises the ones
  // whose circuit crosses something tall. See there for why that is the whole
  // fix and why the bands themselves did not move.
  const ALT_BANDS   = [72, 96, 122, 148];
  const VIS_RING    = 520;                     // cull update+draw beyond this from the player
  // GA accent stripes / heli bold bodies — classic civilian schemes
  const GA_ACCENTS  = [0x2d5fb0, 0xc0392b, 0xd8821f, 0x1f7a4d];
  const HELI_BODIES = [0xb33636, 0x1f5fa8, 0xd8a11f, 0x1f7a4d];

  // ---- shared, never-disposed assets ----------------------------------------
  let G = null;
  function assets() {
    if (G) return G;
    const shared = (o) => { if (o) o._shared = true; return o; };
    G = {
      white: shared(vmat("paint", 0xf2f4f6)),
      trim:  shared(vmat("metal", 0x3c434c)),
      dark:  shared(vmat("plastic", 0x171b20)),
      glass: shared(vmat("glass", 0x121a22)),
      tire:  shared(vmat("tire", 0x1a1d21)),
      blade: shared(vmat("metal", 0x20262d)),
      navR:  shared(cmat(0xff2a22, { emissive: 0xff2a22, ei: 0.95 })),
      navG:  shared(cmat(0x18ff3a, { emissive: 0x18ff3a, ei: 0.95 })),
      navW:  shared(cmat(0xeaf4ff, { emissive: 0xeaf4ff, ei: 0.9 })),
      accents: {},
    };
    return G;
  }
  function accent(c) {
    const a = assets();
    const k = "a" + c;
    if (!a.accents[k]) { a.accents[k] = vmat("paint", c); a.accents[k]._shared = true; }
    return a.accents[k];
  }
  function navBead(grp, m, x, y, z) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), m);
    b.position.set(x, y, z); grp.add(b);
  }

  // ============================================================
  //  GA HIGH-WING PROP PLANE (Cessna-172 silhouette, +Z forward)
  //  Reference ratios: span 1.33x length; wing ON TOP of the cabin; tailplane
  //  0.29x span; prop disc ~1.7x cowl width; long gradual tailcone; strut per
  //  side; fixed tricycle gear. Length ~7.9u → span 10.6, prop dia 2.2.
  // ============================================================
  function buildGAPlane(acc) {
    const a = assets();
    const grp = new THREE.Group();
    // cabin (widest through the seats) + blunt engine cowl + long tailcone
    const cabin = new THREE.Mesh(taperBox(1.35, 1.4, 3.2, { nz: 0.92, tz: 0.8, top: 0.78, bot: 0.72 }), a.white);
    cabin.position.set(0, 0.1, 0.7); grp.add(cabin);
    const cowl = new THREE.Mesh(taperBox(1.15, 1.1, 1.4, { nz: 0.62, top: 0.8, bot: 0.75 }), acc);
    cowl.position.set(0, -0.02, 2.85); grp.add(cowl);
    const tail = new THREE.Mesh(taperBox(1.1, 1.15, 4.2, { tz: 0.22, top: 0.72, bot: 0.8 }), a.white);
    tail.position.set(0, 0.14, -2.2); grp.add(tail);
    // windshield + side glass wrapping the cabin front
    const glass = new THREE.Mesh(taperBox(1.25, 0.62, 1.5, { nz: 0.7, top: 0.62 }), a.glass);
    glass.position.set(0, 0.62, 1.35); grp.add(glass);
    // HIGH WING sitting ON the cabin roof — a C172 wing is near-straight, so a
    // plain slab reads right; span 10.6 (~1.33x the 7.9 length), chord 1.55
    const wing = new THREE.Mesh(new THREE.BoxGeometry(10.6, 0.24, 1.55, 6, 1, 1), a.white);
    wing.position.set(0, 0.98, 0.75); grp.add(wing);
    // accent wingtips
    [-1, 1].forEach((s) => {
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.26, 1.3), acc);
      tip.position.set(s * 4.9, 0.98, 0.75); grp.add(tip);
    });
    // wing STRUTS — the diagonal line that reads "GA high-wing" from any angle
    [-1, 1].forEach((s) => {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.4, 0.3), a.trim);
      strut.position.set(s * 1.55, 0.32, 0.95);
      strut.rotation.z = s * 0.9;
      grp.add(strut);
    });
    // accent fuselage stripe through the window line, both flanks
    [-1, 1].forEach((s) => {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 5.4), acc);
      stripe.position.set(s * 0.62, 0.18, -0.3); stripe.rotation.x = 0; grp.add(stripe);
    });
    // tail: fin (swept) + tailplane at 0.29x span
    const fin = new THREE.Mesh(taperBox(0.2, 1.6, 1.15, { tz: 0.5, top: 0.5 }), acc);
    fin.position.set(0, 0.95, -3.95); fin.rotation.x = 0.1; grp.add(fin);
    const stab = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.16, 0.95), a.white);
    stab.position.set(0, 0.3, -4.0); grp.add(stab);
    // PROP: spinner cone + two blades on a group that spins about local Z
    const prop = new THREE.Group(); prop.position.set(0, -0.02, 3.62);
    const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.42, 8), a.trim);
    spinner.rotation.x = Math.PI / 2; spinner.position.z = 0.15; prop.add(spinner);
    [0, 1].forEach((f) => {
      const bl = new THREE.Mesh(new THREE.BoxGeometry(0.24, 2.25, 0.1), a.blade);
      bl.rotation.z = f * Math.PI / 2; prop.add(bl);
    });
    grp.add(prop);
    grp.userData.prop = prop;                    // the shared throttle-spin hook
    // fixed tricycle gear: nose leg under the cowl, mains under the cabin
    function leg(x, z, wr) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.7, 0.16), a.trim);
      strut.position.set(x, -0.95, z); grp.add(strut);
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(wr, wr, 0.2, 10), a.tire);
      wheel.rotation.z = Math.PI / 2; wheel.position.set(x, -1.3, z); grp.add(wheel);
    }
    leg(0, 2.5, 0.24);
    leg(-1.15, 0.2, 0.28);
    leg(1.15, 0.2, 0.28);
    // nav lights: port red / stbd green wingtips, white tail
    navBead(grp, a.navR, -5.2, 0.98, 0.75);
    navBead(grp, a.navG, 5.2, 0.98, 0.75);
    navBead(grp, a.navW, 0, 0.5, -4.5);
    return grp;
  }

  // ============================================================
  //  LIGHT CIVILIAN HELICOPTER (Bell-206 silhouette, +Z forward)
  //  Reference ratios: rotor disc ≥ the whole airframe (dia 9.2 vs ~8.6 total);
  //  fat rounded cabin pod on a whip-thin boom; tail rotor ~0.16x main dia;
  //  short mast; wide low skids. Bold single body colour + white belly.
  // ============================================================
  function buildLightHeli(body) {
    const a = assets();
    const grp = new THREE.Group();
    // rounded cabin pod — abrupt taper into the boom (pod-on-a-stick read)
    const pod = new THREE.Mesh(taperBox(1.55, 1.55, 3.4, { nz: 0.48, tz: 0.42, top: 0.66, bot: 0.6, segD: 8 }), body);
    pod.position.set(0, 0.1, 0.5); grp.add(pod);
    // white belly pan
    const belly = new THREE.Mesh(taperBox(1.4, 0.5, 3.0, { nz: 0.5, tz: 0.5, bot: 0.55 }), a.white);
    belly.position.set(0, -0.5, 0.5); grp.add(belly);
    // bug-eye canopy wrapping the pod nose
    const canopy = new THREE.Mesh(taperBox(1.35, 0.95, 1.9, { nz: 0.5, tz: 0.9, top: 0.45 }), a.glass);
    canopy.position.set(0, 0.42, 1.35); grp.add(canopy);
    // whip-thin tail boom + small fin + tailplane stubs
    const boom = new THREE.Mesh(taperBox(0.44, 0.44, 4.4, { tz: 0.5, top: 0.85, bot: 0.85 }), a.white);
    boom.position.set(0, 0.32, -3.3); grp.add(boom);
    const fin = new THREE.Mesh(taperBox(0.16, 1.15, 0.8, { tz: 0.5, top: 0.55 }), body);
    fin.position.set(0, 0.7, -5.15); grp.add(fin);
    const stab = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 0.5), body);
    stab.position.set(0, 0.42, -4.4); grp.add(stab);
    // skids: wide, low, up-swept tips, angled struts
    [-0.85, 0.85].forEach((sx) => {
      const skid = new THREE.Mesh(taperBox(0.18, 0.18, 3.3, { nz: 0.5, tz: 0.5 }), a.trim);
      skid.position.set(sx, -1.05, 0.3); grp.add(skid);
      [1.1, -0.7].forEach((sz) => {
        const st = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.62, 0.14), a.trim);
        st.position.set(sx * 0.8, -0.68, sz); st.rotation.z = sx > 0 ? -0.3 : 0.3; grp.add(st);
      });
    });
    // short mast + hub + TWO-blade main rotor (disc dia 9.2 > airframe ~8.6)
    const mast = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.5, 0.24), a.trim);
    mast.position.set(0, 1.0, 0.1); grp.add(mast);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.22, 8), a.trim);
    hub.position.set(0, 1.28, 0.1); grp.add(hub);
    const rotor = new THREE.Group(); rotor.position.set(0, 1.34, 0.1);
    rotor.add(new THREE.Mesh(bladeGeo(4.6, 0.14), a.blade));
    const opp = new THREE.Group(); opp.rotation.y = Math.PI;
    opp.add(new THREE.Mesh(bladeGeo(4.6, 0.14), a.blade));
    rotor.add(opp);
    grp.add(rotor);
    grp.userData.rotorGroup = rotor;
    // tail rotor on the fin (dia ~1.5 ≈ 0.16x main), spun about local X
    const trotor = new THREE.Group(); trotor.position.set(0.2, 0.75, -5.35);
    [0, 1].forEach((f) => {
      const bl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.5, 0.24), a.blade);
      bl.rotation.x = f * Math.PI / 2; trotor.add(bl);
    });
    grp.add(trotor);
    grp.userData.tailRotorGroup = trotor;
    // nav lights
    navBead(grp, a.navR, -0.8, -0.2, 0.6);
    navBead(grp, a.navG, 0.8, -0.2, 0.6);
    navBead(grp, a.navW, 0, 1.3, -5.0);
    return grp;
  }

  // ---- fleet state -----------------------------------------------------------
  let fleet = null;        // [{ grp, kind, cx, cz, radius, alt, dir, speed, phase }]
  let fleetRoot = null;    // the arena root the fleet was built into
  let clock = 0;

  /* ============================================================
     ROOF CLEARANCE  (CBZ.CONFIG.AIR_TRAFFIC_CLEARANCE)

     OWNER: "LITTLE PROPELLOR PLANES FLY THRU BUILDINGS."

     The fleet's altitude was FOUR AUTHORED NUMBERS and the city was never
     consulted. ALT_BANDS tops out at 148 while buildings.js's makeMegaTower
     puts a 52-storey flagship at 52 * FH(3.2) = 166.4 m — so EVERY band flew
     through the tallest thing in the world, and the lowest (72) flew through
     anything over 22 storeys. Nothing here was wrong about the circuit; the
     circuit simply had no idea what was underneath it.

     city/aircraft.js has answered this correctly for its whole life — the
     gunship holds `roofTopAt(x,z) + roofClear + 2` and the strike jet
     `roofTopAt + 10` — and this file's own `trafficRoofTop` already scans
     exactly the same collider tops so a WRECK lands on the roof it hit.
     Ambient traffic just never asked the question while it was still flying.

     IT ASKS ONCE PER CIRCUIT, NOT PER FRAME. These craft fly a FIXED CIRCLE,
     so "what is the tallest thing under my track" has ONE answer per craft,
     and a pilot picks one cruise altitude for a circuit rather than
     porpoising block by block. One pass over CBZ.colliders per craft
     (allocation-free AABB-vs-annulus, no trig, no sqrt) yields the ring's
     tallest roof; cruise = max(authored band, roof + clearance). A ring that
     crosses nothing tall KEEPS its authored band — which is exactly what
     preserves the low, shootable traffic the ALT_BANDS note above is
     protecting. Altitude is the whole fix: no route is planned, no waypoint
     is invented, no craft is moved.

     Degrade-safe by construction: no colliders, no CBZ.colliders, or the flag
     off ⇒ ringRoof 0 ⇒ cruise === the old band, byte-identical.
  ============================================================ */
  const CLEARANCE = () => CFG.AIR_TRAFFIC_CLEARANCE !== false;
  // HULL DROP — how far the airframe's lowest point hangs below its own
  // origin, worst case, WHILE BANKED (the orbit is flown at a bank clamped to
  // 0.5 rad in the update loop):
  //   plane — mains at y=-1.30 with a 0.28 wheel radius = -1.58; the outboard
  //           tip of the 10.6 span dips 5.3*sin(0.5) = 2.54 → 2.54 dominates.
  //   heli  — skids at -1.05 (0.18 box ⇒ -1.14); rotor tip 4.6*sin(0.5) = 2.20.
  const HULL_DROP = 2.6;
  // ROOFTOP HARDWARE THE COLLIDER SET DOES NOT CARRY. Roof gear is drawn as
  // decoration far more often than it is registered solid: expansion.js hangs
  // a beacon 1.0 above b.h with no collider, buildings.js's helipad mast is
  // 2.4 tall and unsolid, plant/aerials sit on top of that. 7 covers the
  // tallest of them and then some.
  const ROOF_GEAR = 7;
  // READ GAP — the daylight that makes it read as flying OVER rather than
  // skimming: ~5 storeys at buildings.js's FH of 3.2.
  const READ_GAP = 16;
  const ROOF_CLEAR = HULL_DROP + ROOF_GEAR + READ_GAP;      // 25.6
  // FAIRNESS CEILING. aircraft.js states the law this obeys: a range is a
  // FAIRNESS invariant, not a gun stat. This fleet is shootable
  // (AIRTRAFFIC_DAMAGE, above), the sanctioned anti-air answer is the RPG at
  // 200 m and the longest gun in the game is the sniper at 240 m — so a
  // clearance clamp may push a craft up to 198 (still inside the RPG's reach
  // from the street) and never past it. The shipped skyline fits with room:
  // the 166.4 m mega tower asks for 192.0. A ring that asks for more than
  // this is a SKYLINE change, not an air-traffic change, and it surfaces as
  // `overCeil` in the audit rather than silently making a craft unreachable.
  const CRUISE_CEIL = 198;
  const ROOF_CAP = 310;             // ignore absurd colliders (trafficRoofTop's own cap)
  const CLEAR_REFRESH = 4.0;        // seconds between one craft's re-scan (round-robin)
  let clearNext = 0, clearWho = 0;

  // A HELICOPTER IS NOT A PLANE, AND aircraft.js ALREADY SAID SO. HELI_SPECS
  // carries a `traffic` role (agl 122 — literally ALT_BANDS[2] — v 22, R 105,
  // roofClear 10) that was authored FOR this fleet and that this file has
  // never read; roofClear is the one number of it this change needs, so it is
  // asked for rather than re-typed. Rotorcraft are legitimately allowed to
  // cross a roof closer than a fixed-wing does, which is why the two differ.
  function roofClearFor(t) {
    if (t.kind === "heli" && CBZ.heliSpec) {
      try {
        const s = CBZ.heliSpec("traffic");
        if (s && s.roofClear > 0) return s.roofClear;
      } catch (e) {}
    }
    return ROOF_CLEAR;
  }

  // Tallest collider top anywhere under this craft's orbit RING. The set of
  // distances from the orbit centre to the points of an AABB is exactly the
  // interval [near, far], so the padded circle touches the box iff
  // near <= R+pad AND far >= R-pad. Squared throughout — no sqrt, no trig,
  // one early-out on `y1 <= top` that rejects almost every collider after the
  // first tall one is found.
  function ringRoof(t) {
    const cols = CBZ.colliders;
    if (!cols || !cols.length || !CLEARANCE()) return 0;
    const cx = t.cx, cz = t.cz, R = t.radius;
    // half-span plus a wingtip of slop, so a tower the wing would clip counts
    const pad = (t.kind === "heli" ? 4.6 : 5.3) + 3;
    const rp = R + pad, rm = R - pad;
    const rp2 = rp * rp, rm2 = rm > 0 ? rm * rm : 0;
    let top = 0;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (!c || c.y1 == null || c.y1 <= top || c.y1 > ROOF_CAP) continue;
      const dx = Math.max(c.minX - cx, 0, cx - c.maxX);
      const dz = Math.max(c.minZ - cz, 0, cz - c.maxZ);
      if (dx * dx + dz * dz > rp2) continue;               // whole box outside the ring
      const fx = Math.max(Math.abs(c.minX - cx), Math.abs(c.maxX - cx));
      const fz = Math.max(Math.abs(c.minZ - cz), Math.abs(c.maxZ - cz));
      if (fx * fx + fz * fz < rm2) continue;               // whole box inside the ring
      top = c.y1;
    }
    return top;
  }

  // Re-measure one craft's circuit and publish its cruise altitude.
  // `snap` (fleet build) places it there outright; afterwards a REQUIRED CLIMB
  // is taken immediately and only a descent is flown at rate — you never
  // descend into a building, but you may take your time coming back down.
  // That asymmetry is what lets airTrafficAudit().clipping pin at 0.
  function refreshClear(t, snap) {
    if (!t || t.downed) return;
    t.ringRoof = CLEARANCE() ? ringRoof(t) : 0;
    const want = t.ringRoof > 0 ? t.ringRoof + roofClearFor(t) : 0;
    // THE CEILING IS A PREFERENCE, NOT A LICENCE TO CLIP. Staying inside the
    // RPG's reach is polish; not being inside a building is the fix, and the
    // fix outranks the polish. `noClip` is the lowest altitude at which no
    // part of the airframe is inside the roof — if the ceiling would sit
    // under it, the roof wins and `overCeil` records the trade instead of the
    // craft quietly going back through the tower.
    const noClip = t.ringRoof > 0 ? t.ringRoof + HULL_DROP + 1 : 0;
    t.overCeil = want > CRUISE_CEIL;
    t.cruise = Math.max(t.band, noClip, Math.min(CRUISE_CEIL, want));
    if (snap || t.alt == null || t.cruise > t.alt) t.alt = t.cruise;
  }
  const CLIMB_DOWN = 4.5;           // m/s — a light single's honest rate of descent
  function easeClear(t, dt) {
    if (t.alt > t.cruise) t.alt = Math.max(t.cruise, t.alt - CLIMB_DOWN * dt);
  }

  /* CBZ.airTrafficAudit() — DOES THE AMBIENT FLEET FLY THROUGH THE CITY?
     `clipping` is the ratchet and must be 0: a craft whose lowest point
     (alt - HULL_DROP) sits below the tallest roof on its own circuit is, at
     some point in every lap, INSIDE a building. `overCeil` names any craft the
     fairness ceiling had to hold down, and `minGap` is the thinnest daylight
     any craft has over its own track — printed beside `clipping` so a "fix"
     that just raised everything into the stratosphere cannot pass unnoticed. */
  CBZ.airTrafficAudit = function () {
    const out = {
      craft: 0, planes: 0, helis: 0, clipping: 0, overCeil: 0, raised: 0,
      minGap: null, maxAlt: 0, bands: ALT_BANDS.slice(),
      roofClear: ROOF_CLEAR, ceiling: CRUISE_CEIL,
      enabled: CLEARANCE(), colliders: (CBZ.colliders || []).length, list: [],
    };
    if (!fleet) return out;
    for (let i = 0; i < fleet.length; i++) {
      const t = fleet[i];
      if (!t || t.downed) continue;
      out.craft++;
      if (t.kind === "heli") out.helis++; else out.planes++;
      const roof = t.ringRoof || 0;
      const gap = (t.alt || 0) - HULL_DROP - roof;
      if (roof > 0 && gap < 0) out.clipping++;
      if (t.overCeil) out.overCeil++;
      if ((t.alt || 0) > t.band + 0.01) out.raised++;
      if (out.minGap == null || gap < out.minGap) out.minGap = +gap.toFixed(2);
      if ((t.alt || 0) > out.maxAlt) out.maxAlt = Math.round(t.alt || 0);
      out.list.push({ kind: t.kind, band: t.band, alt: Math.round(t.alt || 0),
                      roof: Math.round(roof), gap: +gap.toFixed(1), r: Math.round(t.radius) });
    }
    return out;
  };

  // ---- studio hook: pure mesh builders for tools/studio.mjs expr shots ----
  CBZ.debugBuildAirTraffic = {
    plane: function (c) { return buildGAPlane(accent(c != null ? c : GA_ACCENTS[0])); },
    heli: function (c) { return buildLightHeli(accent(c != null ? c : HELI_BODIES[0])); },
  };

  function arenaRoot() {
    const a = CBZ.city && CBZ.city.arena;
    return a ? a.root : null;
  }

  function buildFleet(root) {
    const arena = CBZ.city && CBZ.city.arena;
    const cx0 = arena && arena.center ? arena.center.x : 0;
    const cz0 = arena && arena.center ? arena.center.z : 0;
    const list = [];
    for (let i = 0; i < N_TRAFFIC; i++) {
      const isHeli = h01(i, 80) < 0.3;
      const acc = GA_ACCENTS[(h01(i, 81) * GA_ACCENTS.length) | 0];
      const bodyC = HELI_BODIES[(h01(i, 82) * HELI_BODIES.length) | 0];
      const grp = isHeli ? buildLightHeli(accent(bodyC)) : buildGAPlane(accent(acc));
      const t = {
        grp,
        kind: isHeli ? "heli" : "plane",
        cx: cx0 + (h01(i, 71) * 2 - 1) * 180,
        cz: cz0 + (h01(i, 72) * 2 - 1) * 180,
        radius: (isHeli ? 70 : 95) + h01(i, 73) * 70,
        // `band` is the authored VFR level; `alt` is what the craft actually
        // flies, which is the band unless its own circuit crosses something
        // tall (see ROOF CLEARANCE). refreshClear() below fills cruise/alt.
        band: ALT_BANDS[i % ALT_BANDS.length],
        alt: ALT_BANDS[i % ALT_BANDS.length],
        cruise: ALT_BANDS[i % ALT_BANDS.length],
        ringRoof: 0,
        dir: h01(i, 76) < 0.5 ? 1 : -1,
        speed: (isHeli ? 18 : 27) + h01(i, 74) * (isHeli ? 8 : 16),
        phase: h01(i, 75) * Math.PI * 2,
      };
      // measure the circuit before the craft is ever drawn — a plane must not
      // appear inside a tower for one frame and then climb out of it. Reads
      // only CBZ.colliders (a pure function of the seeded world build) and
      // draws no rng, so the fleet stays byte-identical per seed.
      refreshClear(t, true);
      root.add(grp);
      list.push(t);
    }
    return list;
  }

  function teardown() {
    if (!fleet) return;
    for (let i = 0; i < fleet.length; i++) {
      const grp = fleet[i].grp;
      if (grp.parent) grp.parent.remove(grp);
      grp.traverse(function (o) {
        if (o.geometry && !o.geometry._shared && o.geometry.dispose) { try { o.geometry.dispose(); } catch (e) {} }
        const m = o.material;
        if (m && !m._shared && m.dispose) { try { m.dispose(); } catch (e) {} }
      });
    }
    fleet = null;
    fleetRoot = null;
  }
  CBZ.cityClearAirTraffic = teardown;
  CBZ.cityAirTrafficList = function () { return fleet ? fleet.slice() : []; };
  // CBZ.heliAudit() census provider (aircraft.js owns the audit; each fleet
  // pushes ONE of these). Ambient civil helis are deliberately reported as
  // crewed:1 — a light single flown by its owner IS a crewed aircraft, and
  // counting it as `uncrewed` would poison the number that must trend to 0.
  // Fixed-wing traffic is not a rotorcraft and is not reported here.
  CBZ.heliFleet = CBZ.heliFleet || [];
  CBZ.heliFleet.push(function () {
    if (!fleet) return null;
    const out = [];
    for (let i = 0; i < fleet.length; i++) {
      const t = fleet[i];
      if (!t || t.kind !== "heli" || !t.grp || !t.grp.parent) continue;
      const p = t.grp.position;
      const gy = CBZ.floorAt ? (+CBZ.floorAt(p.x, p.z) || 0) : 0;
      out.push({
        role: "traffic", x: p.x, y: p.y, z: p.z, agl: p.y - gy,
        speed: t.speed, orbitR: t.radius, crew: 1,
        roofTop: trafficRoofTop(p.x, p.z), downed: !!t.downed,
      });
    }
    return out;
  });

  // systems/lockon.js UNIVERSAL-acquisition seam (owner: "homing doesn't work
  // for small planes"): every ambient GA plane / light heli is a lockable
  // craft like any street car. Identity is the fleet record; the cached seek
  // getter goes null once the craft is ring-culled or the fleet tears down,
  // which breaks a live lock the same frame. cb(...) === false stops the walk
  // (candidate pool full). A homing hit now lands on a REAL damage model —
  // the AIRTRAFFIC_DAMAGE shoot-down arc below (cityAirTrafficSplash).
  function trafficLockSeek(t) {
    if (!t._lockSeek) {
      t._lockSeek = function () {
        return t.grp && t.grp.parent && t.grp.visible !== false
          ? { x: t.grp.position.x, y: t.grp.position.y, z: t.grp.position.z }
          : null;
      };
    }
    return t._lockSeek;
  }
  CBZ.cityAirTrafficEnumTargets = function (cb) {
    if (!fleet) return;
    for (let i = 0; i < fleet.length; i++) {
      const t = fleet[i];
      if (!t || !t.grp || !t.grp.parent || t.grp.visible === false) continue;
      const p = t.grp.position;
      if (cb(t, trafficLockSeek(t), p.x, p.y, p.z, t.kind === "heli" ? 2.6 : 3.2, "air-traffic") === false) return;
    }
  };

  // ============================================================
  //  SHOOT-DOWN (AIRTRAFFIC_DAMAGE): the lock seam above made these craft
  //  ACQUIRABLE, so a homing missile could ride all the way in and
  //  proximity-detonate — on a prop with no HP, for nothing. This closes
  //  that gap. Splash from the fpsmode detonation fan-out is the ONLY
  //  damage source (same call shape as cityAircraftSplash); ambient flight
  //  is untouched until a craft is actually wounded or downed. The fleet
  //  has no replenish cycle, so a destroyed craft simply leaves the sky one
  //  lighter until the next city rebuild re-seeds the full deterministic
  //  set. Death FX are runtime-only → Math.random is sanctioned here (the
  //  build path stays pure CBZ.hash01).
  // ============================================================
  const CRAFT_HP = { plane: 60, heli: 50 };    // light civilian airframes: one rocket kills
  function trafficHP(t) { return CRAFT_HP[t.kind] || 55; }

  CBZ.cityAirTrafficSplash = function (x, y, z, radius, dmg) {
    if (!fleet || (CBZ.CONFIG && CBZ.CONFIG.AIRTRAFFIC_DAMAGE === false)) return 0;
    let hit = 0;
    for (let i = 0; i < fleet.length; i++) {
      const t = fleet[i];
      // a ring-culled craft holds a STALE mesh position (the orbit math skips
      // it), so a blast can't meaningfully reach one — same visibility gate
      // the lock seam uses.
      if (!t || t.downed || !t.grp || !t.grp.parent || t.grp.visible === false) continue;
      const p = t.grp.position;
      // blast reaches the hull surface (island_airport grammar; hull radii
      // match the lock seam), and damage FALLS OFF with distance: a direct
      // hit wrecks the airframe, a near miss WOUNDS it into tier smoke.
      const hullD = Math.max(0, Math.hypot(p.x - x, p.y - y, p.z - z) - (t.kind === "heli" ? 2.6 : 3.2));
      if (hullD > radius) continue;
      let d = dmg * Math.max(0.3, 1 - hullD / radius);
      // NO SINGLE BLAST DOWNS A HELICOPTER (owner: "helicopters need two rpg
      // hits to come down"): rotorcraft cap any ONE explosive splash at 62%
      // of max hp — the first rocket wounds the bird into tier smoke (50hp
      // vs the 140 splash used to vaporise it), the second kills. Planes are
      // unchanged, and bullets (damageTraffic via the ray path) untouched.
      if (t.kind === "heli" && (!CBZ.CONFIG || CBZ.CONFIG.AIR_HELI_TWO_BLAST !== false)) d = Math.min(d, trafficHP(t) * 0.62);
      damageTraffic(t, d);
      hit++;
    }
    return hit;
  };

  function damageTraffic(t, dmg, quiet) {
    if (!t || t.downed || !(dmg > 0)) return;
    if (t.hp == null) t.hp = trafficHP(t);     // lazy — untouched craft carry no combat state
    t.hp -= dmg;
    // quiet = fpsmode already stamped the impact at the exact hull point (bullets);
    // skip this center spark so a sustained burst doesn't double every hit.
    if (!quiet && CBZ.bulletImpact) { try { CBZ.bulletImpact({ x: t.grp.position.x, y: t.grp.position.y, z: t.grp.position.z }, { x: 0, y: 1, z: 0 }, { kind: "spark", power: 1.1 }); } catch (e) {} }
    if (t.hp <= 0) downTraffic(t);
  }

  // ---- PLAIN-GUNFIRE HULL HIT (owner: "they also can't be shot") -------------
  // Like Air-1, the ambient fleet had a splash seam but no bullet ray-test, so
  // ordinary rounds passed through. Mirror the police-air / gunship ray-vs-sphere
  // idiom and route hits into the SAME damageTraffic pool → shared wounded-tier
  // smoke + shoot-down arc, idempotent behind `downed`. Flimsy civilian airframes
  // (hp 50/60) drop in a shorter burst than the police bird; a sniper takes one in
  // a couple. Ring-culled craft (520u+ away, stale mesh) are skipped, same gate as
  // the lock/splash seams. FX only → runtime Math.random elsewhere stays sanctioned.
  const TRAFFIC_BULLET_MULT = 0.28;   // w.damage × this per bullet (see POLICE_AIR_BULLET_MULT rationale)
  CBZ.cityAirTrafficRayTest = function (ox, oy, oz, dx, dy, dz, range) {
    if (!fleet || (CBZ.CONFIG && CBZ.CONFIG.AIRTRAFFIC_DAMAGE === false)) return null;
    let best = null, bestT = range, bestRec = null;
    for (let i = 0; i < fleet.length; i++) {
      const t = fleet[i];
      if (!t || t.downed || !t.grp || !t.grp.parent || t.grp.visible === false) continue;
      const p = t.grp.position;
      const rad = t.kind === "heli" ? 2.6 : 3.2;         // same hull radii the lock/splash seams use
      const cx = p.x - ox, cy = p.y - oy, cz = p.z - oz;
      const tt = cx * dx + cy * dy + cz * dz;            // projection of the hull onto the ray
      if (tt < 0 || tt >= bestT) continue;
      const ex = ox + dx * tt - p.x, ey = oy + dy * tt - p.y, ez = oz + dz * tt - p.z;
      if (ex * ex + ey * ey + ez * ez > rad * rad) continue;
      bestT = tt; bestRec = t; best = { x: ox + dx * tt, y: oy + dy * tt, z: oz + dz * tt, dist: tt };
    }
    if (!best) return null;
    best.rec = bestRec; best.hitBullet = trafficBullet;
    return best;
  };
  // per-bullet chip into the shared pool for the craft the ray struck (rec is
  // threaded from the hit record; quiet: fpsmode stamped the hull impact).
  function trafficBullet(dmg, fromX, fromZ, rec) {
    if (!rec || (CBZ.CONFIG && CBZ.CONFIG.AIRTRAFFIC_DAMAGE === false)) return;
    damageTraffic(rec, Math.max(1.5, (dmg || 0) * TRAFFIC_BULLET_MULT), true);
  }

  function downTraffic(t) {
    if (!t || t.downed) return;                // idempotent — one death per airframe
    t.downed = true;
    // freeze the orbit tangent as the crash heading: the wreck flies ON where
    // it was pointed, it doesn't keep steering the circuit.
    const ang = t.phase + t.dir * (t.speed / t.radius) * clock;
    t.crashDir = { x: -Math.sin(ang) * t.dir, z: Math.cos(ang) * t.dir };
    t.crashHeading = Math.atan2(t.crashDir.x, t.crashDir.z);
    // a plane carries its speed into the dive (fallJet grammar); a heli mostly
    // drops where it was hit (fallHeli grammar). Both get the lurch-up beat.
    t.crashSpd = t.kind === "plane" ? t.speed + 6 : t.speed * 0.4;
    t.vy = t.kind === "plane" ? 1.2 : 2.2;
    t.rollRate = t.kind === "plane" ? (Math.random() < 0.5 ? -1 : 1) * (2.0 + Math.random() * 2) : 0;   // wing-loss death roll
    t.yawRate = t.kind === "heli" ? (Math.random() < 0.5 ? -1 : 1) * (3.5 + Math.random() * 3) : 0;     // tail-rotor-loss flat spin
    t.spinT = 0; t.smokeCD = 0;
    if (CBZ.sfx) CBZ.sfx("explosion");
    if (CBZ.shake) CBZ.shake(0.3);
    if (CBZ.cityFlavor) CBZ.cityFlavor(t.kind === "heli" ? "You shot down a civilian helicopter!" : "You shot down a civilian plane!", "#ff8b6b");
    // occupants die with the airframe — route through the KILL BUS so the
    // corner feed attributes it ("You killed <citizen> · plane crash"; the
    // bus generates the citizen name for a null victim). GA planes sometimes
    // carry a passenger, so a second line can follow the pilot's.
    if (CBZ.cityKillFeed) {
      const n = t.kind === "plane" && Math.random() < 0.4 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        try { CBZ.cityKillFeed("You", null, t.kind === "heli" ? "helicopter crash" : "plane crash"); } catch (e) {}
      }
    }
  }

  // local collider-top scan (aircraft.js roofTopAt, per the builders-stay-
  // self-contained convention): a falling craft detonates ON the roof it
  // lands on, never the street six storeys below it.
  function trafficRoofTop(x, z) {
    let topY = 0;
    const cols = CBZ.colliders || [];
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (!c || c.y1 == null || c.y1 <= topY || c.y1 > 310) continue;
      if (x < c.minX - 1 || x > c.maxX + 1 || z < c.minZ - 1 || z > c.maxZ + 1) continue;
      topY = c.y1;
    }
    return topY;
  }

  // ballistic wreck ride-down — one function, both silhouettes (the plane
  // flies fallJet's carried-momentum roll, the heli fallHeli's flat spin).
  // Returns true once the wreck has impacted (caller removes the craft).
  function fallTraffic(t, dt) {
    t.vy -= 17 * dt;                                        // gravity owns it now
    const p = t.grp.position;
    if (t.kind === "plane") {
      t.crashSpd = Math.max(14, t.crashSpd - 22 * dt);      // momentum bleeds off
      p.x += t.crashDir.x * t.crashSpd * dt;
      p.z += t.crashDir.z * t.crashSpd * dt;
      t.grp.rotation.y = t.crashHeading;
      t.grp.rotation.x += dt * 0.5;                         // nose falls through the horizon
      t.grp.rotation.z += t.rollRate * dt;                  // death roll
    } else {
      p.x += t.crashDir.x * t.crashSpd * dt;
      p.z += t.crashDir.z * t.crashSpd * dt;
      t.grp.rotation.y += t.yawRate * dt;                   // flat spin
      t.grp.rotation.z += dt * 1.7;                         // roll belly-up as it dies
      t.grp.rotation.x = Math.sin((t.spinT += dt * 4) * 0.6) * 0.45;   // pitch lurch
    }
    p.y += t.vy * dt;
    const ud = t.grp.userData;                              // engine dead — everything windmills
    if (ud.prop) ud.prop.rotation.z += dt * 9;
    if (ud.rotorGroup) ud.rotorGroup.rotation.y += dt * 13;
    if (ud.tailRotorGroup) ud.tailRotorGroup.rotation.x += dt * 10;
    t.smokeCD -= dt;
    if (t.smokeCD <= 0) {
      t.smokeCD = 0.05;                                     // black smoke trail down the arc
      if (CBZ.cityCrashSmoke) { try { CBZ.cityCrashSmoke(p.x, p.y, p.z); } catch (e) {} }
    }
    const groundRaw = CBZ.floorAt ? +CBZ.floorAt(p.x, p.z) : 0;
    const ground = isFinite(groundRaw) ? groundRaw : 0;
    const surf = Math.max(ground, trafficRoofTop(p.x, p.z));
    if (p.y > surf + 1.2) return false;
    // CONTAINED crash fireball (aircraft.js wreckImpact grammar at light-
    // airframe scale) + a scorch where it couples to true ground — never the
    // block-leveling airstrike blast.
    const onRoof = surf > ground + 0.5;
    if (CBZ.cityExplosion) { try { CBZ.cityExplosion(p.x, p.z, { power: onRoof ? 1.5 : 1.2, radius: onRoof ? 7 : 6, byPlayer: false, y: surf + 1.0 }); } catch (e) {} }
    if (onRoof && CBZ.cityDamageBuilding) { try { CBZ.cityDamageBuilding(p.x, surf + 1.0, p.z, 1.6); } catch (e) {} }
    if (CBZ.cityShatter) { try { CBZ.cityShatter(p.x, p.z, onRoof ? 9 : 7); } catch (e) {} }
    if (!onRoof && CBZ.cityScorch) { try { CBZ.cityScorch(p.x, p.z, 4); } catch (e) {} }
    if (CBZ.cityCrashSmoke) { try { CBZ.cityCrashSmoke(p.x, surf + 1.0, p.z); } catch (e) {} }
    if (CBZ.shake) CBZ.shake(0.5);
    return true;
  }

  // single-craft teardown (same dispose rules as teardown()); the parent
  // removal also nulls the cached lock seek, breaking any live lock.
  function removeTraffic(t) {
    const gi = fleet ? fleet.indexOf(t) : -1;
    if (gi >= 0) fleet.splice(gi, 1);
    if (!t.grp) return;
    if (t.grp.parent) t.grp.parent.remove(t.grp);
    t.grp.traverse(function (o) {
      if (o.geometry && !o.geometry._shared && o.geometry.dispose) { try { o.geometry.dispose(); } catch (e) {} }
      const m = o.material;
      if (m && !m._shared && m.dispose) { try { m.dispose(); } catch (e) {} }
    });
  }

  CBZ.onUpdate(42.7, function (dt) {
    if (g.mode !== "city" || (CBZ.CONFIG && CBZ.CONFIG.AIR_TRAFFIC_AMBIENT === false)) {
      if (fleet) teardown();
      return;
    }
    if (CBZ.net && CBZ.net.noSim && CBZ.net.noSim()) { if (fleet) teardown(); return; }
    const root = arenaRoot();
    if (!root) { if (fleet) teardown(); return; }
    if (fleet && fleetRoot !== root) teardown();     // city rebuilt → fresh fleet
    if (!fleet) { fleet = buildFleet(root); fleetRoot = root; clearNext = 0; clearWho = 0; }
    clock += Math.min(dt, 0.05);
    // ROUND-ROBIN CIRCUIT RE-MEASURE: one craft every CLEAR_REFRESH seconds, so
    // a tower demolished (demolition.js) or raised (construction.js) under an
    // existing track is picked up within one fleet-length of refreshes for the
    // cost of a single collider walk. The whole fleet is never scanned in one
    // frame after the build.
    if (fleet.length && clock >= clearNext) {
      clearNext = clock + CLEAR_REFRESH;
      refreshClear(fleet[clearWho % fleet.length], false);
      clearWho++;
    }
    const P = CBZ.player;
    for (let i = 0; i < fleet.length; i++) {
      const t = fleet[i];
      // a downed craft is a ballistic wreck: no orbit math, and NO ring cull —
      // the fall must finish (and detonate) even if the player drives away.
      if (t.downed) {
        t.grp.visible = true;
        if (fallTraffic(t, dt)) { removeTraffic(t); i--; }
        continue;
      }
      const ang = t.phase + t.dir * (t.speed / t.radius) * clock;
      const x = t.cx + Math.cos(ang) * t.radius;
      const z = t.cz + Math.sin(ang) * t.radius;
      // altitude converges BEFORE the cull, so a craft that spends a lap out
      // of sight still arrives back holding the right level (and a required
      // CLIMB was already taken outright by refreshClear — only the descent
      // is flown at rate).
      easeClear(t, dt);
      // ring cull: far traffic neither draws nor animates
      if (P) {
        const dx = x - P.pos.x, dz = z - P.pos.z;
        if (dx * dx + dz * dz > VIS_RING * VIS_RING) { t.grp.visible = false; continue; }
      }
      t.grp.visible = true;
      t.grp.position.set(x, t.alt, z);
      // heading = the orbit tangent; bank = the constant-radius turn angle
      // (tan(bank) = v^2 / (R*g)), signed to lean INTO the turn (matches the
      // player model's roll→turn sign convention). THIS FILE'S OWN FORMULA is
      // now the shared one — CBZ.heliOrbitBank (city/aircraft.js) is exactly
      // this expression, and the police chopper and the military gunship fly
      // their orbits on it too instead of a decorative sin() wobble. Local
      // fallback kept so this module never depends on load order.
      const vx = -Math.sin(ang) * t.dir, vz = Math.cos(ang) * t.dir;
      const heading = Math.atan2(vx, vz);
      const bank = -t.dir * (CBZ.heliOrbitBank ? CBZ.heliOrbitBank(t.speed, t.radius)
                                               : Math.atan((t.speed * t.speed) / (t.radius * 9.8))) * 0.85;
      t.grp.rotation.set(0, heading, Math.max(-0.5, Math.min(0.5, bank)));
      const ud = t.grp.userData;
      if (ud.prop) ud.prop.rotation.z += dt * 42;
      if (ud.rotorGroup) ud.rotorGroup.rotation.y += dt * 30;
      if (ud.tailRotorGroup) ud.tailRotorGroup.rotation.x += dt * 48;
      // damage-tier smoke: a wounded engine streams smoke while the craft
      // still flies its circuit — a glancing blast visibly COUNTS.
      if (t.hp != null && t.hp <= trafficHP(t) * 0.5) {
        t.hurtSmokeCD = (t.hurtSmokeCD || 0) - dt;
        if (t.hurtSmokeCD <= 0) {
          t.hurtSmokeCD = 0.4 + Math.random() * 0.35;
          if (CBZ.cityCrashSmoke) { try { CBZ.cityCrashSmoke(x + (Math.random() - 0.5), t.alt - 0.2, z + (Math.random() - 0.5)); } catch (e) {} }
        }
      }
    }
  });
})();
