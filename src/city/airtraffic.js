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
   angle (tan(bank) = v^2 / (R*g)).

   Pure atmosphere: no colliders, no weapons, no wanted interaction, no
   boarding. Everything about WHERE they fly and WHAT they look like is
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
  const ALT_BANDS   = [72, 96, 122, 148];      // stacked, all above the police air (44/52)
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
        alt: ALT_BANDS[i % ALT_BANDS.length],
        dir: h01(i, 76) < 0.5 ? 1 : -1,
        speed: (isHeli ? 18 : 27) + h01(i, 74) * (isHeli ? 8 : 16),
        phase: h01(i, 75) * Math.PI * 2,
      };
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

  CBZ.onUpdate(42.7, function (dt) {
    if (g.mode !== "city" || (CBZ.CONFIG && CBZ.CONFIG.AIR_TRAFFIC_AMBIENT === false)) {
      if (fleet) teardown();
      return;
    }
    if (CBZ.net && CBZ.net.noSim && CBZ.net.noSim()) { if (fleet) teardown(); return; }
    const root = arenaRoot();
    if (!root) { if (fleet) teardown(); return; }
    if (fleet && fleetRoot !== root) teardown();     // city rebuilt → fresh fleet
    if (!fleet) { fleet = buildFleet(root); fleetRoot = root; }
    clock += Math.min(dt, 0.05);
    const P = CBZ.player;
    for (let i = 0; i < fleet.length; i++) {
      const t = fleet[i];
      const ang = t.phase + t.dir * (t.speed / t.radius) * clock;
      const x = t.cx + Math.cos(ang) * t.radius;
      const z = t.cz + Math.sin(ang) * t.radius;
      // ring cull: far traffic neither draws nor animates
      if (P) {
        const dx = x - P.pos.x, dz = z - P.pos.z;
        if (dx * dx + dz * dz > VIS_RING * VIS_RING) { t.grp.visible = false; continue; }
      }
      t.grp.visible = true;
      t.grp.position.set(x, t.alt, z);
      // heading = the orbit tangent; bank = the constant-radius turn angle
      // (tan(bank) = v^2 / (R*g)), signed to lean INTO the turn (matches the
      // player model's roll→turn sign convention).
      const vx = -Math.sin(ang) * t.dir, vz = Math.cos(ang) * t.dir;
      const heading = Math.atan2(vx, vz);
      const bank = -t.dir * Math.atan((t.speed * t.speed) / (t.radius * 9.8)) * 0.85;
      t.grp.rotation.set(0, heading, Math.max(-0.5, Math.min(0.5, bank)));
      const ud = t.grp.userData;
      if (ud.prop) ud.prop.rotation.z += dt * 42;
      if (ud.rotorGroup) ud.rotorGroup.rotation.y += dt * 30;
      if (ud.tailRotorGroup) ud.tailRotorGroup.rotation.x += dt * 48;
    }
  });
})();
