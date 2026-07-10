/* ============================================================
   city/playeraircraft.js — THE AIRPOWER YOU FLY YOURSELF.

   The apex of the empire: money → penthouse (home) → its HELICOPTER → the
   HANGAR → the F-22 RAPTOR. The home literally houses your force; missiles
   let you dominate or escape the city.

   This module owns the PLAYER-FLOWN aircraft (distinct from city/aircraft.js,
   which is the POLICE air threat, and city/playerair.js, which is the call-an-
   airstrike-from-the-phone system). Here you physically BOARD and FLY:

     • MISSILE HELICOPTER — yours the moment you own the penthouse
       (g.cityOwnsHeli). Parked on the rooftop helipad. Hovers, climbs, yaws,
       strafes; fires missiles from its nose.
     • F-22 RAPTOR — a buyable jet, based in the deck hangar once you own the
       hangar (g.cityOwnsHangar) AND buy the jet ($3M) at the hangar
       (g.cityOwnsJet). Always-forward arcade flight; wide fast turns.

   Built on the vehicles.js pattern: the player BOARDS on [F], we set
   P.driving=true so physics.js yields the transform, hide the player rig, and
   own the aircraft + player transform in an onUpdate AFTER physics. The
   existing GTA chase-cam (systems/camera.js, gated on player.driving) follows
   for free off player.pos + cam.yaw, which we steer behind the craft.

   Missiles fire through CBZ.cityFireMissile (Agent HOOKS owns it) so they reuse
   the real military missile pool + cityExplosion FX. EVERY cross-module global
   is feature-detected, so a missing sibling degrades gracefully and NOTHING
   here throws at load or worldgen.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;
  const cmat = CBZ.cmat || CBZ.mat || function (c) { return new THREE.MeshLambertMaterial({ color: c }); };
  const boxGeo = CBZ.boxGeom || function (w, h, d) { return new THREE.BoxGeometry(w, h, d); };

  // ---- NEW MATERIAL API (carfx.js) — fake-reflection env-mapped vehicle mats
  // for instant shine. Falls back to the flat cached cmat() if carfx hasn't
  // loaded, so nothing here breaks at worldgen and it auto-upgrades at runtime.
  // Roles: paint / glass / chrome / metal / rim / tire / lightFront / lightTail
  // / plastic / interior.
  function vmat(role, color, opts) {
    if (CBZ.vehicleMat) { try { return CBZ.vehicleMat(role, color, opts); } catch (e) {} }
    return cmat(color != null ? color : 0x808890, opts);
  }

  // ---- SHAPE HELPER: r128 has NO geometry.vertices[] — sculpt the
  // position attribute directly, then recompute normals so lighting is right.
  // taperBox builds a BoxGeometry then scales each vertex's X/Y by a factor that
  // depends on its Z (z=+halfDepth → nose factor `nz`, z=-halfDepth → tail
  // factor `tz`), optionally squashing the underside (`belly`<1 narrows the
  // bottom, rounding the keel). One geometry, one draw call. NOT cached/shared —
  // each sculpted body is unique, so the disposer (which skips _shared) frees it.
  function taperBox(w, h, d, opt) {
    opt = opt || {};
    const nz = opt.nz != null ? opt.nz : 1;   // X/Y scale at the nose (+Z)
    const tz = opt.tz != null ? opt.tz : 1;   // X/Y scale at the tail (-Z)
    const topNarrow = opt.top != null ? opt.top : 1;   // <1 → narrower roofline (rounded canopy/spine)
    const botNarrow = opt.bot != null ? opt.bot : 1;   // <1 → narrower keel (rounded belly)
    const segW = opt.segW || 2, segH = opt.segH || 2, segD = opt.segD || 6;
    const g = new THREE.BoxGeometry(w, h, d, segW, segH, segD);
    const pos = g.attributes.position;
    const hd = d / 2, hh = h / 2;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      // longitudinal taper: lerp nose↔tail factor by normalized z (-1..1)
      const f = z / hd;                                   // -1 (tail) .. +1 (nose)
      const zt = f >= 0 ? (1 + (nz - 1) * f) : (1 + (tz - 1) * -f);
      let sx = zt, sy = zt;
      // vertical profile narrowing toward the top / bottom
      const vy = hh > 0 ? y / hh : 0;                     // -1 (bottom) .. +1 (top)
      if (vy > 0) sx *= (1 + (topNarrow - 1) * vy);
      if (vy < 0) sx *= (1 + (botNarrow - 1) * -vy);
      pos.setX(i, x * sx);
      pos.setY(i, y * sy);
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
    return g;
  }

  // a single thin tapered rotor blade with a slight droop, rooted at the hub
  // (origin) and reaching out +X. Reused by both player rotors. Returns a Mesh.
  function makeBlade(len, mat, droop) {
    const g = new THREE.BoxGeometry(len, 0.06, 0.34, 6, 1, 1);
    const pos = g.attributes.position; const hl = len / 2;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const t = (x + hl) / len;                 // 0 at inboard, 1 at tip
      // taper the chord toward the tip + a gentle downward droop
      pos.setZ(i, pos.getZ(i) * (1 - 0.45 * t));
      pos.setY(i, pos.getY(i) - (droop || 0) * t * t);
    }
    pos.needsUpdate = true; g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.position.x = hl;                            // root at origin, blade extends +X
    return m;
  }

  // ---- tunables --------------------------------------------------------
  // NOTE: this used to be flagged "arcade flight — NOT realistic aero". It now
  // runs through the SAME shared lift/drag/stall/ETL/ground-effect core as the
  // AI gunship/jets (city/aircraftphysics.js, CBZ.aeroPhysics) — see flyHeli/
  // flyJet/integrate below. The tunables here are the per-craft knobs that
  // feed that core (thrust, six-axis drag coefficients, ETL band, etc).
  const JET_PRICE   = 3000000;     // $3M for the F-22
  const CEILING     = 220;         // hard altitude clamp (m)
  const GROUND_PAD  = 1.2;         // never sink the belly below this over the floor

  // HELI feel
  const HELI_THRUST = 26;          // forward accel (collective tilt → cyclic thrust)
  const HELI_TOP    = 34;          // top forward speed
  const HELI_VLIFT  = 16;          // ascend/descend speed (collective authority)
  const HELI_YAW    = 1.7;         // rad/s yaw from A/D (pedal authority)
  const HELI_DRAG   = 1.6;         // legacy hover drag scalar (kept as a floor under the 6-axis model)
  const HELI_SPAN   = 9.6;         // main-rotor diameter — feeds ground-effect threshold
  const HELI_ETL_LO = 8.2;         // m/s (~16kt) — ETL ramp start
  const HELI_ETL_HI = 12.3;        // m/s (~24kt) — ETL ramp end (full lift efficiency)
  // TORQUE/TAIL-ROTOR COUPLING: applying collective (climb/descend power) spins
  // up main-rotor torque reaction — the airframe wants to yaw opposite rotor
  // spin unless the pilot holds in opposing pedal (A/D). Modelled as a small
  // reactive yaw RATE proportional to how hard you're pulling power, decaying
  // when you let off — so climbing "fights the pedals" exactly like a real
  // heli, and trimming it out is a skill, not a hard fail.
  const HELI_TORQUE_GAIN = 0.62;   // rad/s reactive yaw per unit of collective input
  const HELI_TORQUE_DAMP = 3.2;    // how fast the reactive yaw eases when power is released

  // JET feel
  const JET_MIN     = 38;          // min cruise the THROTTLE can be set to (engine idle floor —
                                    // airSPEED can still fall below this in a stall; see flyJet)
  const JET_MAX     = 120;         // top throttle
  const JET_ACCEL   = 26;          // throttle response
  const JET_TURN    = 1.15;        // bank/turn rate (wide)
  const JET_SPAN    = 10.8;        // wingspan — feeds ground-effect threshold

  // weapons
  const FIRE_CD     = 0.6;         // seconds between missiles
  const MISSILE_SPD = 60;          // muzzle ejection speed for the dir hint
  const HELI_AMMO   = 38;          // missiles before resupply
  const JET_AMMO    = 24;
  const RESUPPLY_AT_BASE = true;   // landing on the pad/hangar tops you back up

  // ---- DAMAGE / HP MODEL (new — previously the player aircraft had NO hp at
  // all; only the player's own body could be hurt). Hostile fire that hits the
  // CRAFT (gunship door-gun raking you while flying, a missile splash near you,
  // a hard collision) now damages the airframe. Control authority degrades as
  // damage rises (sloppier response, not an instant hard-lock), and the heli
  // gets a survivable AUTOROTATION fallback instead of an unrecoverable death
  // spiral once it's critically hurt or "out of engine". ----
  const CRAFT_MAX_HP   = 220;      // both craft share one scale for simplicity
  const CTRL_DEGRADE_AT = 0.45;    // below this hp fraction, authority starts degrading
  const CTRL_FLOOR     = 0.35;     // worst-case authority multiplier at 0 hp (never fully dead controls)
  const AUTOROTATE_AT  = 0.18;     // hp fraction at/below which the heli's engine is treated as out
  const AUTOROTATE_SINK = 6.5;     // m/s capped sink rate while autorotating (survivable on a flare)
  const FLARE_HEIGHT   = 9;        // metres above ground where a flare starts cushioning the touchdown
  const FLARE_SINK     = 2.2;      // m/s sink rate the flare bleeds you down to right at the ground

  // ---- module state --------------------------------------------------------
  let heli = null;                 // the helicopter craft object (or null)
  let jet = null;                  // the F-22 craft object (or null)
  // stolenAir: a HOT flyable spawned from a base/airport prop (militaryvehicles.js
  // CBZ.citySpawnFlyableFromProp). KEPT SEPARATE from the owned heli/jet singletons
  // so commandeering a base chopper/airliner never clobbers (or launders into) the
  // penthouse heli or the Raptor — it's a throwaway hot bird that despawns on bail,
  // exactly like a stolen Raptor that never reached a hangar.
  let stolenAir = null;
  let G = null;                    // lazy shared geometry/material cache
  let _lastHeliFlag = false, _lastJetFlag = false;   // for ownership-flip detection
  let _hudEl = null;

  function arenaRoot() {
    const a = CBZ.city && CBZ.city.arena;
    return a ? a.root : null;
  }
  function tower() {
    if (!CBZ.cityMegaTower) return null;
    try { return CBZ.cityMegaTower(); } catch (e) { return null; }
  }
  function floorY(x, z) {
    if (CBZ.floorAt) { try { return CBZ.floorAt(x, z) || 0; } catch (e) { return 0; } }
    return 0;
  }
  function campaignActive() {
    try { return !!(CBZ.cityCampaignActive && CBZ.cityCampaignActive()); } catch (e) { return false; }
  }
  // Story mode owns the physical phone. Aircraft status/control prose goes there
  // instead of becoming another floating toast; if the campaign phone has not
  // loaded yet, silence is preferable to putting words back over the world.
  function aircraftNote(body, seconds, from) {
    if (campaignActive()) {
      if (CBZ.campaignUI && typeof CBZ.campaignUI.notify === "function") {
        try { CBZ.campaignUI.notify("personal", from || "Flight Ops", body); } catch (e) {}
      }
      return;
    }
    if (CBZ.city && CBZ.city.note) { try { CBZ.city.note(body, seconds); } catch (e) {} }
  }

  // ============================================================
  //  MODELS — both reuse cached shared mats/geoms (cmat/boxGeom) so a fleet of
  //  rotors/pods costs almost no extra draw setup. A clear nose "muzzle" empty
  //  is tagged on each so missiles spawn from the gun, not the centroid.
  // ============================================================
  function assets() {
    if (G) return G;
    const shared = (o) => { if (o) o._shared = true; return o; };
    // every body material is a MODULE-LEVEL SINGLETON reused by every craft, so
    // flag them _shared — the disposer must NEVER free them (a carfx vehicleMat
    // may be cache-shared with the cars; freeing it would break them).
    G = {
      // BODY PANELS routed through the new env-mapped vehicle roles → instant
      // shine (auto-fall back to flat cmat). Player birds get sleek hero colours:
      // a deep gunmetal-navy chopper, a charcoal stealth-grey jet.
      mBody:   shared(vmat('paint', 0x2b3340, { emissive: 0x0c0e12, ei: 0.2 })),   // heli fuselage
      mDark:   shared(vmat('metal', 0x1b1f26, { emissive: 0x060708, ei: 0.15 })),  // skids / booms / dark trim
      mGrey:   shared(vmat('metal', 0x707884, { emissive: 0x202329, ei: 0.25 })),  // mast / pods / wings
      mGlass:  shared(vmat('glass', 0x16242e, { emissive: 0x0a151c, ei: 0.4 })),   // canopy glass (reflective)
      mJet:    shared(vmat('paint', 0x3a414c, { emissive: 0x10131a, ei: 0.1 })),   // jet skin
      mJetDk:  shared(vmat('metal', 0x262b33, { emissive: 0x0a0d12, ei: 0.12 })),  // chines / nozzles / dark structure
      mMissile:shared(vmat('chrome', 0xd8dde4, { emissive: 0x3a3e44, ei: 0.2 })),  // missile bodies
      mWarn:   shared(cmat(0xff5a3a, { emissive: 0xff3018, ei: 0.7 })),            // muzzle / afterburner core (kept hot/flat)
      // emissive NAV lights — wingtip red (port) / green (stbd), white tail beacon
      navR:    shared(vmat('lightTail',  0xff2a22, { emissive: 0xff1810, ei: 0.95 })),
      navG:    shared(cmat(0x18ff3a, { emissive: 0x10ff30, ei: 0.95 })),
      navW:    shared(vmat('lightFront', 0xffffff, { emissive: 0xeaf4ff, ei: 0.9 })),
      // shared rotor disc (semi-transparent blur) — its own non-cached mat so we
      // can keep it translucent without poisoning cmat's opaque cache
      rotorMat: shared(new THREE.MeshBasicMaterial({ color: 0x10131a, transparent: true, opacity: 0.42, depthWrite: false })),
      // solid blade material (the real spinning blades read as metal, not blur)
      bladeMat: shared(vmat('metal', 0x202833, { emissive: 0x080a0e, ei: 0.2 })),
    };
    return G;
  }

  // tiny emissive nav-light bead
  function navLight(grp, mat, x, y, z) {
    const m = new THREE.Mesh(boxGeo(0.16, 0.16, 0.16), mat);
    m.position.set(x, y, z); grp.add(m); return m;
  }

  // a small bright marker at the muzzle so the firing point reads
  function addMuzzle(grp, x, y, z) {
    const a = assets();
    const m = new THREE.Mesh(boxGeo(0.18, 0.18, 0.18), a.mWarn);
    m.position.set(x, y, z);
    grp.add(m);
    grp.userData.muzzle = m;                 // local-space muzzle node
    grp.userData.muzzleLocal = new THREE.Vector3(x, y, z);
  }

  // ---- HELICOPTER: fuselage + main rotor + tail rotor + skids + wing pods ---
  function buildHeli() {
    const a = assets();
    const grp = new THREE.Group();
    // ROUNDED FUSELAGE (+Z forward): a single sculpted body — the box's nose pinches
    // in (nz<1), the tail necks down into the boom (tz small), the roofline narrows
    // (top<1) and the keel rounds (bot<1). One draw call, real curvature.
    const body = new THREE.Mesh(taperBox(2.25, 1.5, 5.0, { nz: 0.62, tz: 0.34, top: 0.7, bot: 0.62, segD: 8 }), a.mBody);
    body.position.y = 0.18; grp.add(body);
    // soft chin/nose cap blending the front (rounded, slightly dropped)
    const nose = new THREE.Mesh(taperBox(1.5, 1.0, 1.5, { nz: 0.35, tz: 1.0, top: 0.7, bot: 0.6 }), a.mBody);
    nose.position.set(0, 0.02, 2.5); grp.add(nose);
    // BUBBLE CANOPY — reflective glass, domed (narrows top & nose) wrapping the cockpit
    const canopy = new THREE.Mesh(taperBox(1.55, 1.0, 2.1, { nz: 0.55, tz: 0.85, top: 0.4, bot: 1.0 }), a.mGlass);
    canopy.position.set(0, 0.52, 1.55); grp.add(canopy);
    // SLEEKER TAIL BOOM — long, tapering thinner toward the tail rotor
    const boom = new THREE.Mesh(taperBox(0.5, 0.5, 4.2, { nz: 1.0, tz: 0.5, top: 0.85, bot: 0.85 }), a.mBody);
    boom.position.set(0, 0.5, -3.5); grp.add(boom);
    // swept vertical fin at the tail + a small horizontal stabiliser
    const fin = new THREE.Mesh(taperBox(0.18, 1.25, 0.95, { tz: 0.5, top: 0.55 }), a.mDark); fin.position.set(0, 0.95, -5.05); fin.rotation.x = 0.12; grp.add(fin);
    const stab = new THREE.Mesh(boxGeo(1.5, 0.1, 0.55), a.mDark); stab.position.set(0, 0.55, -4.7); grp.add(stab);
    // ROUNDED SKIDS: a tapered tube with up-swept ends + a faired cross-tube to the belly
    [-0.92, 0.92].forEach((sx) => {
      const skid = new THREE.Mesh(taperBox(0.18, 0.18, 3.6, { nz: 0.5, tz: 0.5, top: 0.8, bot: 0.8 }), a.mDark);
      skid.position.set(sx, -1.0, 0.05); grp.add(skid);
      [1.0, -1.0].forEach((sz) => {
        const strut = new THREE.Mesh(taperBox(0.16, 0.72, 0.16, { top: 0.7 }), a.mGrey);
        strut.position.set(sx * 0.85, -0.56, sz); strut.rotation.z = sx > 0 ? -0.18 : 0.18; grp.add(strut);
      });
    });
    // stub weapon wings (roots buried in the body) + faired missile pods under them
    const wing = new THREE.Mesh(taperBox(3.7, 0.2, 0.95, { nz: 0.85, tz: 0.7 }), a.mGrey); wing.position.set(0, 0.02, 0.4); grp.add(wing);
    [-1.58, 1.58].forEach((px) => {
      const pod = new THREE.Mesh(taperBox(0.52, 0.52, 1.9, { nz: 0.35, tz: 0.6, top: 0.8, bot: 0.8 }), a.mDark);
      pod.position.set(px, -0.2, 0.4); grp.add(pod);
    });
    // MAIN ROTOR (spins about Y) — visible hub + a translucent blur disc + TWO bars
    // of real tapered/drooped blades. rotor & rotor2 are Groups (each a 2-blade bar
    // crossing the hub) so a .rotation.y still spins them exactly as before.
    const mast = new THREE.Mesh(taperBox(0.26, 0.55, 0.26, { top: 0.6 }), a.mDark); mast.position.y = 1.12; grp.add(mast);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.32, 0.26, 8), a.mGrey); hub.position.y = 1.42; grp.add(hub);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(4.7, 20), a.rotorMat); disc.rotation.x = -Math.PI / 2; disc.position.y = 1.45; grp.add(disc);
    function bladeBar() {
      const bar = new THREE.Group(); bar.position.y = 1.44;
      bar.add(makeBlade(4.6, a.bladeMat, 0.16));        // blade extends +X from hub
      // opposite blade: wrap a +X blade in a group rotated PI about the HUB origin
      // (rotating the blade mesh itself wouldn't flip it — its pivot is offset)
      const opp = new THREE.Group(); opp.rotation.y = Math.PI; opp.add(makeBlade(4.6, a.bladeMat, 0.16)); bar.add(opp);
      return bar;
    }
    const rotor = bladeBar(); grp.add(rotor);
    const rotor2 = bladeBar(); rotor2.rotation.y = Math.PI / 2; grp.add(rotor2);   // crossed → 4-blade look
    // TAIL ROTOR (spins about X) — hub + two crossed bars of small blades on the fin
    const thub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.12, 6), a.mGrey); thub.rotation.z = Math.PI / 2; thub.position.set(0.24, 0.9, -5.45); grp.add(thub);
    function tailBar() {
      const bar = new THREE.Group(); bar.position.set(0.24, 0.9, -5.45);
      [-1, 1].forEach((s) => {
        const bg = new THREE.BoxGeometry(0.05, 0.92, 0.22, 1, 4, 1);
        const pos = bg.attributes.position;
        for (let i = 0; i < pos.count; i++) { const ty = pos.getY(i); pos.setZ(i, pos.getZ(i) * (1 - 0.4 * Math.abs(ty) / 0.46)); }
        pos.needsUpdate = true; bg.computeVertexNormals();
        const bl = new THREE.Mesh(bg, a.bladeMat); bl.position.y = s * 0.46; bar.add(bl);
      });
      return bar;
    }
    const trotor = tailBar(); grp.add(trotor);
    const trotor2 = tailBar(); trotor2.rotation.x = Math.PI / 2; grp.add(trotor2);
    grp.userData.rotor = rotor; grp.userData.rotor2 = rotor2;
    grp.userData.trotor = trotor; grp.userData.trotor2 = trotor2;
    // NAV LIGHTS: port wingtip red, stbd wingtip green, white tail beacon
    navLight(grp, a.navR, -1.85, 0.05, 0.4);
    navLight(grp, a.navG,  1.85, 0.05, 0.4);
    navLight(grp, a.navW,  0, 1.55, -5.15);
    // nose muzzle (unchanged firing point + marker)
    addMuzzle(grp, 0, -0.1, 3.4);
    grp.userData.belly = 1.2;                // how far the skids hang below the origin
    return grp;
  }

  // ---- F-22 RAPTOR: angular delta-wing fuselage, twin tails, canopy, missiles
  function buildJet() {
    const a = assets();
    const grp = new THREE.Group();
    // SLEEK SCULPTED FUSELAGE (+Z forward): the spine everything plugs into. The
    // box pinches to a sharp nose (nz small), necks down at the tail, narrows the
    // spine (top) and rounds the belly (bot) — one curved draw call, no seams.
    const body = new THREE.Mesh(taperBox(1.55, 1.05, 8.8, { nz: 0.22, tz: 0.62, top: 0.72, bot: 0.62, segD: 10 }), a.mJet);
    grp.add(body);
    // a fine needle nose tip extending the taper to a point (radar boom feel)
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.2, 1.3, 8), a.mJetDk);
    tip.rotation.x = -Math.PI / 2; tip.position.set(0, -0.02, 4.85); grp.add(tip);
    // REFLECTIVE BUBBLE CANOPY — domed, raked, narrows toward the nose & top
    const canopy = new THREE.Mesh(taperBox(0.9, 0.62, 2.4, { nz: 0.45, tz: 0.95, top: 0.45, bot: 1.0 }), a.mGlass);
    canopy.position.set(0, 0.5, 1.85); grp.add(canopy);
    // chined forebody shoulders (LERX) — angular blends overlapping the body sides
    [-1, 1].forEach((s) => {
      const chine = new THREE.Mesh(taperBox(1.1, 0.4, 4.4, { nz: 0.25, tz: 0.85, top: 0.7 }), a.mJetDk);
      chine.position.set(s * 0.78, -0.12, 1.9); chine.rotation.y = s * 0.12; grp.add(chine);
    });
    // side air intakes hugging the lower fuselage
    [-1, 1].forEach((s) => {
      const intake = new THREE.Mesh(taperBox(0.5, 0.62, 2.0, { nz: 0.7, tz: 1.0, top: 0.7 }), a.mJetDk);
      intake.position.set(s * 0.82, -0.18, 0.7); grp.add(intake);
    });
    // CLEAN DELTA WINGS (swept, tapered) with a touch of DIHEDRAL (tips raised).
    // Roots driven through the fuselage; each wing tapers toward the tip + carries
    // a pylon + a real-looking missile (nose cone + body + tail fins) underneath.
    [-1, 1].forEach((s) => {
      const wing = new THREE.Mesh(taperBox(4.7, 0.16, 3.5, { nz: 0.35, tz: 0.78, top: 1, bot: 1, segW: 4 }), a.mJet);
      wing.position.set(s * 2.45, -0.16, -0.6); wing.rotation.y = s * 0.34; wing.rotation.z = s * -0.07; grp.add(wing);
      // pylon
      const pylon = new THREE.Mesh(boxGeo(0.14, 0.26, 1.1), a.mJetDk); pylon.position.set(s * 2.25, -0.34, 0.1); grp.add(pylon);
      // under-wing missile (cone tip + chrome body + 4 tail fins) — reads as ordnance
      const msl = new THREE.Group(); msl.position.set(s * 2.25, -0.52, 0.1);
      const mb = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 1.7, 8), a.mMissile); mb.rotation.x = Math.PI / 2; msl.add(mb);
      const mc = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.5, 8), a.mMissile); mc.rotation.x = -Math.PI / 2; mc.position.z = 1.1; msl.add(mc);
      [0, 1].forEach((f) => {
        const fin = new THREE.Mesh(boxGeo(0.62, 0.04, 0.34), a.mJetDk);   // a fin plate across the tail
        fin.position.z = -0.72; fin.rotation.z = f * Math.PI / 2; msl.add(fin);   // f=0 horiz pair, f=1 vert → cruciform
      });
      grp.add(msl);
    });
    // twin canted vertical tails — tapered, bases sunk into the aft deck
    [-1, 1].forEach((s) => {
      const tail = new THREE.Mesh(taperBox(0.16, 1.6, 1.8, { nz: 0.7, tz: 0.45, top: 0.5 }), a.mJet);
      tail.position.set(s * 0.78, 0.68, -3.4); tail.rotation.z = s * 0.32; grp.add(tail);
    });
    // horizontal stabilators — tapered, inboard ends buried in the rear fuselage
    [-1, 1].forEach((s) => {
      const stab = new THREE.Mesh(taperBox(2.6, 0.12, 1.5, { nz: 0.4, tz: 0.7 }), a.mJet);
      stab.position.set(s * 1.45, -0.1, -3.8); stab.rotation.y = s * 0.12; grp.add(stab);
    });
    // AFTERBURNER CANS: twin nozzles flaring out of the tail + the hot glow plume
    [-0.5, 0.5].forEach((s) => {
      const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 1.1, 12), a.mJetDk);
      noz.rotation.x = Math.PI / 2; noz.position.set(s, -0.05, -4.35); grp.add(noz);
      // dark inner can mouth
      const mouth = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.2, 12), a.mDark);
      mouth.rotation.x = Math.PI / 2; mouth.position.set(s, -0.05, -4.85); grp.add(mouth);
    });
    const burn = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), a.mWarn);
    burn.scale.set(0.7, 0.7, 1.6); burn.position.set(0, -0.05, -5.0); grp.add(burn);
    grp.userData.burn = burn;
    // NAV LIGHTS: port wingtip red, stbd wingtip green, white tailfin beacon
    navLight(grp, a.navR, -2.7, 0.0, -1.4);
    navLight(grp, a.navG,  2.7, 0.0, -1.4);
    navLight(grp, a.navW,  0, 1.4, -3.9);
    // nose muzzle (unchanged firing point + marker)
    addMuzzle(grp, 0, 0, 5.6);
    grp.userData.belly = 0.6;
    return grp;
  }

  // ============================================================
  //  SPAWN / PLACEMENT
  // ============================================================
  function disposeGroup(obj) {
    if (!obj) return;
    if (obj.parent) obj.parent.remove(obj);
    obj.traverse(function (o) {
      if (o.geometry && !o.geometry._shared && o.geometry.dispose) { try { o.geometry.dispose(); } catch (e) {} }
      const m = o.material;
      if (m && !m._shared && m.dispose) { try { m.dispose(); } catch (e) {} }
    });
  }

  function makeCraft(kind, opts) {
    opts = opts || {};
    const root = arenaRoot(); if (!root) return null;
    // Civilian airport theft reuses the exact parked airliner/private-jet group.
    // Owned/military craft keep using the purpose-built flight models.
    const grp = opts.group || (kind === "jet" ? buildJet() : buildHeli());
    if (!grp.parent) root.add(grp);
    const armed = opts.armed !== false;
    const craft = {
      kind, group: grp, muzzle: grp.userData.muzzleLocal || new THREE.Vector3(0, 0, 3),
      pos: grp.position, heading: 0, pitch: 0, roll: 0,
      vx: 0, vy: 0, vz: 0, speed: opts.speed != null ? opts.speed : (kind === "jet" ? JET_MIN : 0),
      throttle: opts.throttle != null ? opts.throttle : (kind === "jet" ? JET_MIN : 0),   // ENGINE power setting (jet only) — has an idle floor,
                                                 // unlike craft.speed (true airspeed), which can now sag
                                                 // below it in a stall (see flyJet).
      fireCD: 0,
      ammo: armed ? (kind === "jet" ? JET_AMMO : HELI_AMMO) : 0,
      maxAmmo: armed ? (kind === "jet" ? JET_AMMO : HELI_AMMO) : 0,
      rotorSpin: 0,
      belly: opts.belly != null ? opts.belly : (grp.userData.belly || 1.0),
      groundOffset: opts.groundOffset,
      modelYawOffset: opts.modelYawOffset || 0,
      externalGroup: !!opts.group,
      sourceRec: opts.sourceRec || null,
      civilian: !!opts.civilian,
      armed,
      displayName: opts.name || (kind === "jet" ? "F-22 RAPTOR" : "MISSILE CHOPPER"),
      cameraBack: opts.cameraBack,
      cameraUp: opts.cameraUp,
      cameraAhead: opts.cameraAhead,
      // ---- damage / aero state (new) ----
      hp: CRAFT_MAX_HP, maxHp: CRAFT_MAX_HP,
      torqueYaw: 0,            // reactive yaw rate from the tail-rotor coupling model (heli only)
      autorotating: false,     // heli engine-out fallback state
      stalled: false,          // jet (or heli rotor) currently past the stall AoA
      aoa: 0,                  // last computed angle-of-attack, deg (HUD/diagnostic)
      destroyed: false,
    };
    grp.userData.craft = craft;
    return craft;
  }

  const _craftEuler = new THREE.Euler();
  const _craftYawQ = new THREE.Quaternion();
  const _craftUp = new THREE.Vector3(0, 1, 0);
  function setCraftRotation(craft, pitch, heading, roll) {
    if (!craft || !craft.group) return;
    const off = craft.modelYawOffset || 0;
    if (!off) {
      craft.group.rotation.set(pitch || 0, heading, roll || 0);
      return;
    }
    // The airport meshes point down local +X, while the shared flight rig points
    // down +Z. Compose the model correction AFTER the complete flight attitude;
    // merely adding -90deg to Euler yaw makes pitch act like roll once airborne.
    craft.group.quaternion
      .setFromEuler(_craftEuler.set(pitch || 0, heading, roll || 0, "XYZ"))
      .multiply(_craftYawQ.setFromAxisAngle(_craftUp, off));
  }

  // ---- CRAFT DAMAGE: hostile fire/blast hitting the player's OWN flown
  // aircraft. Distinct from CBZ.cityHurtPlayer (the player's body HP, used
  // on foot / out of the cockpit) — this is the airframe's health. Control
  // authority degrades smoothly as hp drops (see controlAuthority below);
  // hitting 0 hp doesn't insta-kill the pilot, it forces the craft into its
  // damage fallback (autorotation for the heli; a stall/dive bias for the
  // jet) so a skilled player can still fight it down instead of a guaranteed
  // death the instant the bar empties.
  function damageCraft(craft, dmg) {
    if (!craft || craft.destroyed || dmg <= 0) return;
    craft.hp = Math.max(0, craft.hp - dmg);
    if (CBZ.shake) { try { CBZ.shake(Math.min(0.5, 0.08 + dmg * 0.01)); } catch (e) {} }
    if (CBZ.hitFlash) { try { CBZ.hitFlash(); } catch (e) {} }
  }
  // 0..1 multiplier applied to the pilot's control inputs (thrust/yaw/climb/
  // bank) — degrades gently from CTRL_DEGRADE_AT down to CTRL_FLOOR, never to
  // zero (a hurt bird is sloppy, not unflyable — keeps a damaged craft fun to
  // limp home in rather than a guaranteed loss).
  function controlAuthority(craft) {
    const frac = craft.maxHp > 0 ? craft.hp / craft.maxHp : 1;
    if (frac >= CTRL_DEGRADE_AT) return 1;
    const t = frac / CTRL_DEGRADE_AT;             // 0 (dead) .. 1 (at the degrade threshold)
    return CTRL_FLOOR + (1 - CTRL_FLOOR) * t;
  }
  // exposed so aircraft.js (gunfire/missile-splash near the player) can damage
  // the craft the player is actually flying without a hard dependency either
  // way — feature-detected from both sides.
  CBZ.cityPlayerAircraftDamage = function (dmg, fromX, fromZ) {
    const craft = _aircraftFlying();
    if (!craft) return false;
    damageCraft(craft, dmg);
    return true;
  };
  CBZ.cityPlayerAircraftHp = function () {
    const craft = _aircraftFlying();
    return craft ? { hp: craft.hp, maxHp: craft.maxHp, kind: craft.kind } : null;
  };

  // park the helicopter on the rooftop helipad
  function placeHeli() {
    if (!g.cityOwnsHeli) { if (heli) { disposeGroup(heli.group); heli = null; } return; }
    const t = tower(); const pad = t && t.helipad;
    if (!pad) { return; }                   // no pad yet — try again on the next heal pass
    if (!heli) { heli = makeCraft("heli"); if (!heli) return; }
    if (_aircraftFlying() === heli) return; // don't yank it out from under the pilot
    const px = pad.x, pz = pad.z;
    const py = (pad.y != null ? pad.y : floorY(px, pz)) + heli.belly;
    heli.pos.set(px, py, pz);
    heli.heading = 0; heli.pitch = 0; heli.roll = 0;
    heli.vx = heli.vy = heli.vz = 0; heli.speed = 0; heli.torqueYaw = 0; heli.autorotating = false;
    setCraftRotation(heli, 0, 0, 0);
    if (RESUPPLY_AT_BASE) { heli.ammo = heli.maxAmmo; heli.hp = heli.maxHp; }
  }

  // base the F-22 on the deck hangar
  function placeJet() {
    if (!g.cityOwnsJet) { if (jet) { disposeGroup(jet.group); jet = null; } return; }
    const t = tower(); const h = t && t.hangar;
    if (!h) { return; }
    if (!jet) { jet = makeCraft("jet"); if (!jet) return; }
    if (_aircraftFlying() === jet) return;
    const px = h.x, pz = h.z;
    const py = (h.y != null ? h.y : floorY(px, pz)) + jet.belly + 0.4;
    jet.pos.set(px, py, pz);
    jet.heading = 0; jet.pitch = 0; jet.roll = 0;
    jet.vx = jet.vy = jet.vz = 0; jet.speed = JET_MIN; jet.throttle = JET_MIN;
    setCraftRotation(jet, 0, 0, 0);
    if (RESUPPLY_AT_BASE) { jet.ammo = jet.maxAmmo; jet.hp = jet.maxHp; }
  }

  function refreshFleet() {
    placeHeli();
    placeJet();
    _lastHeliFlag = !!g.cityOwnsHeli;
    _lastJetFlag = !!g.cityOwnsJet;
  }
  // expose for realestate / worldgen to nudge a re-place on ownership change
  CBZ.cityPlayerAircraftRefresh = refreshFleet;

  // ---- STEAL-TO-KEEP: spawn a HOT F-22 at (x,z) and board it immediately.
  // This is the trophy you risk your life for at the military base. It's marked
  // craft.hot=true: a hot jet is NOT yours yet — eject/die/leave and it despawns
  // (see the keep-gate + hot cleanup in onUpdate(12)). Land it inside an OWNED
  // hangar to launder it into a permanent g.cityOwnsJet. Storage.js calls this
  // both for the base steal AND when retrieving an already-kept jet from storage
  // (pass {owned:true} so it spawns already-yours, not hot).
  function spawnStolenJet(x, z, heading, opts) {
    opts = opts || {};
    const root = arenaRoot(); if (!root) return null;
    // if a hot/parked jet object already exists and isn't being flown, recycle it
    if (jet && _aircraftFlying() !== jet) { disposeGroup(jet.group); jet = null; }
    const craft = makeCraft("jet"); if (!craft) return null;
    jet = craft;
    const gy = floorY(x, z);
    craft.pos.set(x, gy + craft.belly + GROUND_PAD, z);
    craft.heading = (heading || 0); craft.pitch = 0; craft.roll = 0;
    craft.vx = craft.vy = craft.vz = 0; craft.speed = JET_MIN; craft.throttle = JET_MIN;
    craft.group.position.copy(craft.pos);
    setCraftRotation(craft, 0, craft.heading, 0);
    craft.hot = !opts.owned;          // owned retrieval spawns already-yours
    enterAircraft(craft);
    return craft;
  }
  CBZ.citySpawnStolenJet = spawnStolenJet;

  function detachPropCollider(rec) {
    const col = rec && rec.collider;
    if (!col || rec._colliderDetached) return;
    if (rec._colliderHeight == null && col.y0 != null && col.y1 != null) {
      rec._colliderHeight = col.y1 - col.y0;
      rec._colliderY0Offset = col.y0 - (rec.pos.y || 0);
    }
    const i = CBZ.colliders ? CBZ.colliders.indexOf(col) : -1;
    if (i >= 0) CBZ.colliders.splice(i, 1);
    rec._colliderDetached = true;
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }

  function restorePropCollider(rec) {
    const col = rec && rec.collider;
    if (!col || !rec.group) return;
    // Rebuild an AABB around the now-parked oriented footprint. It can be left
    // anywhere after a hijack, so the original gate bounds are no longer valid.
    const a = rec.group.rotation.y || 0;
    const ca = Math.abs(Math.cos(a)), sa = Math.abs(Math.sin(a));
    const hw = Math.max(0.5, rec.footW || 3) * 0.5;
    const hl = Math.max(0.5, rec.footL || 5) * 0.5;
    const ex = ca * hw + sa * hl, ez = sa * hw + ca * hl;
    col.minX = rec.pos.x - ex; col.maxX = rec.pos.x + ex;
    col.minZ = rec.pos.z - ez; col.maxZ = rec.pos.z + ez;
    if (rec._colliderHeight != null) {
      col.y0 = rec.pos.y + (rec._colliderY0Offset || 0);
      col.y1 = col.y0 + rec._colliderHeight;
    }
    col._city = true;   // aircraft are city-world objects; never solid in the prison space
    if (CBZ.colliders && CBZ.colliders.indexOf(col) < 0) CBZ.colliders.push(col);
    rec._colliderDetached = false;
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }

  function parkExternalCraft(craft) {
    if (!craft || !craft.externalGroup || !craft.sourceRec) return false;
    const rec = craft.sourceRec;
    const gy = floorY(craft.pos.x, craft.pos.z);
    craft.pitch = craft.roll = 0;
    craft.vx = craft.vy = craft.vz = 0;
    craft.speed = 0;
    craft.pos.y = gy + (craft.groundOffset != null ? craft.groundOffset : 0);
    setCraftRotation(craft, 0, craft.heading, 0);
    rec.heading = craft.heading + (craft.modelYawOffset || 0);
    rec.taken = false;
    rec.group.visible = true;
    rec.group.userData.craft = null;
    restorePropCollider(rec);
    if (stolenAir === craft) stolenAir = null;
    return true;
  }

  // ---- STEAL A FLYABLE FROM A PARKED PROP — the entry militaryvehicles.js calls
  // when you commandeer a base helicopter or an airport/airliner/private jet.
  // Military props still get the proven weaponised stand-in. Civil airport planes
  // instead attach the flight state to their EXACT parked group: no F-22 swap, no
  // duplicate left at the gate, no missiles on a commercial airframe. Both live in
  // the separate `stolenAir` slot so owned heli/Raptor singletons are untouched.
  function spawnFlyableFromProp(rec) {
    if (!rec || !rec.pos) return null;
    const root = arenaRoot(); if (!root) return null;
    if (CBZ.player && CBZ.player._aircraft) return null;       // already airborne
    const kind = rec.kind === "heli" ? "heli" : "jet";
    const civil = !!(rec.civilian && rec.kind === "plane");
    // recycle a prior stolen bird if it's lying around un-flown
    if (stolenAir && _aircraftFlying() !== stolenAir) {
      if (!parkExternalCraft(stolenAir)) disposeGroup(stolenAir.group);
      stolenAir = null;
    }
    const craft = makeCraft(kind, civil ? {
      group: rec.group,
      sourceRec: rec,
      civilian: true,
      armed: false,
      name: (rec.model && rec.model.name) || "Airliner",
      modelYawOffset: rec.modelYawOffset != null ? rec.modelYawOffset : -Math.PI / 2,
      groundOffset: rec.groundOffset != null ? rec.groundOffset : 0,
      speed: 0,
      throttle: 0,
      cameraBack: rec.flightKind === "airliner" ? 30 : 16,
      cameraUp: rec.flightKind === "airliner" ? 14 : 10,
      cameraAhead: rec.flightKind === "airliner" ? 18 : 10,
    } : null); if (!craft) return null;
    stolenAir = craft;
    // rec.heading is the parked MODEL yaw; convert back to the shared flight
    // heading before the per-model visual offset is reapplied.
    const heading = (rec.heading != null ? rec.heading : 0) - (craft.modelYawOffset || 0);
    const gy = floorY(rec.pos.x, rec.pos.z);
    const groundOffset = craft.groundOffset != null ? craft.groundOffset : craft.belly + GROUND_PAD;
    craft.pos.set(rec.pos.x, gy + groundOffset, rec.pos.z);
    craft.heading = heading; craft.pitch = 0; craft.roll = 0;
    craft.vx = craft.vy = craft.vz = 0;
    craft.speed = civil ? 0 : (kind === "jet" ? JET_MIN : 0);
    craft.group.position.copy(craft.pos);
    setCraftRotation(craft, 0, craft.heading, 0);
    if (civil) detachPropCollider(rec);
    craft.hot = true;                                          // never keepable: a base bird, not yours
    craft.fromProp = true;                                    // so the keep-gate ignores it (only the Raptor launders)
    enterAircraft(craft);
    return craft;
  }
  CBZ.citySpawnFlyableFromProp = spawnFlyableFromProp;

  // ============================================================
  //  ENTER / EXIT (the vehicles.js board pattern)
  // ============================================================
  function _aircraftFlying() {
    const P = CBZ.player;
    return P && P._aircraft ? P._aircraft : null;
  }
  function craftLabel(c) { return (c && c.displayName) || (c && c.kind === "jet" ? "F-22" : "Heli"); }

  function enterAircraft(craft) {
    if (!craft || !craft.group) return false;
    const P = CBZ.player; if (!P) return false;
    if (P._vehicle && CBZ.cityExitVehicle) CBZ.cityExitVehicle();   // can't fly from a car
    P.driving = true;                       // physics.js yields the transform
    P._aircraft = craft;
    P.vy = 0; P.grounded = false;
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = false;
    // snap the player marker into the cockpit
    P.pos.set(craft.pos.x, craft.pos.y, craft.pos.z);
    // point the chase-cam down the craft's nose
    if (CBZ.cam) CBZ.cam.yaw = craft.heading + Math.PI;
    if (CBZ.sfx) { try { CBZ.sfx("door"); } catch (e) {} }
    const ctrl = craft.civilian
      ? "W/S throttle · A/D bank · SPACE/CTRL climb/dive · [F] land"
      : craft.kind === "jet"
        ? "W/S throttle · A/D bank · SPACE/CTRL climb/dive · L-click missiles · [F] eject"
        : "W/S thrust · A/D yaw · SPACE/CTRL up/down · mouse look · L-click missiles · [F] land";
    aircraftNote("Flying the " + craftLabel(craft) + " — " + ctrl, 3.2, "Flight Ops");
    return true;
  }

  // ---- HOT-JET CLEANUP: military stand-ins vanish when abandoned; a civilian
  // external group is parked where it landed and returned to the hijack registry.
  // Never dispose an airport-owned model or a kept craft.
  function despawnHotJet(craft) {
    if (!craft || !craft.hot) return false;
    if (craft.externalGroup && craft.sourceRec) {
      const name = craftLabel(craft);
      parkExternalCraft(craft);
      aircraftNote(name + " left where you landed. It remains hot and can be taken again.", 2.6, "Flight Ops");
      return true;
    }
    // null whichever module slot held it so we never dispose a kept craft. A
    // prop-sourced bird lives in `stolenAir`; the base Raptor lives in `jet`.
    if (stolenAir === craft) { disposeGroup(stolenAir.group); stolenAir = null; }
    else if (jet === craft) { disposeGroup(jet.group); jet = null; }
    else disposeGroup(craft.group);
    // a commandeered base machine is impounded; only the Raptor talks hangars.
    aircraftNote(craft.fromProp
      ? "The commandeered aircraft was impounded — military hardware doesn't stay yours."
      : "The stolen F-22 was impounded — you never got it to a hangar.", 2.6, "Flight Ops");
    return true;
  }

  function exitAircraft() {
    const P = CBZ.player; if (!P) return;
    const craft = P._aircraft;
    P.driving = false; P._aircraft = null;
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = true;
    // ejecting from a still-HOT stolen jet loses it (you didn't keep it)
    if (craft && craft.hot) {
      if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = !P.dead;
      let px = craft.pos.x, pz = craft.pos.z;
      if (craft.externalGroup && craft.sourceRec) {
        // Leave the pilot beside the persistent airframe, not inside the solid
        // collider we restore when the commercial aircraft is parked.
        const r = Math.min(craft.sourceRec.footW || 6, craft.sourceRec.footL || 6) * 0.5 + 1.5;
        px += Math.cos(craft.heading) * r;
        pz -= Math.sin(craft.heading) * r;
      }
      const gy = floorY(px, pz);
      P.pos.set(px, gy, pz);
      P.vy = 0; P.grounded = true;
      if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(P.pos);
      despawnHotJet(craft);
      if (CBZ.sfx) { try { CBZ.sfx("door"); } catch (e) {} }
      return;
    }
    if (craft) {
      // settle the craft flat where it is, then drop the player onto the surface
      // beside it, never through the ground
      setCraftRotation(craft, 0, craft.heading, 0);
      craft.pitch = craft.roll = 0; craft.vx = craft.vy = craft.vz = 0; craft.speed = craft.kind === "jet" ? JET_MIN : 0;
      if (craft.kind === "jet") craft.throttle = JET_MIN;
      const gy = floorY(craft.pos.x, craft.pos.z);
      const ox = Math.sin(craft.heading) * 2.2, oz = Math.cos(craft.heading) * 2.2;
      P.pos.set(craft.pos.x + ox, Math.max(gy, craft.pos.y - craft.belly), craft.pos.z + oz);
      P.vy = 0; P.grounded = true;
      if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(P.pos);
    }
    if (CBZ.sfx) { try { CBZ.sfx("door"); } catch (e) {} }
  }
  CBZ.cityPlayerAircraftExit = exitAircraft;

  // nearest owned, on-ground aircraft to the player (on foot)
  function nearestBoardable(x, z, maxd) {
    let best = null, bd = (maxd || 6) * (maxd || 6);
    [heli, jet].forEach((c) => {
      if (!c || !c.group) return;
      const dx = c.pos.x - x, dz = c.pos.z - z, dd = dx * dx + dz * dz;
      if (dd < bd) { bd = dd; best = c; }
    });
    return best;
  }

  // ============================================================
  //  BUY THE F-22 (at the hangar)
  // ============================================================
  function atHangar(x, z) {
    const t = tower(); const h = t && t.hangar; if (!h) return false;
    const hw = (h.w || 10) / 2 + 4, hd = (h.d || 10) / 2 + 4;
    return Math.abs(x - h.x) <= hw && Math.abs(z - h.z) <= hd;
  }
  // Is (x,z) inside an OWNED hangar's keep-zone? Two sources: the penthouse deck
  // hangar (g.cityOwnsHangar) and any hangar bought through storage.js (which
  // exposes CBZ.cityStorageHangarHit — feature-detected). Either one keeps a
  // stolen jet. A roomier radius than atHangar so a fast jet doesn't skip past it.
  function hangarKeepHit(x, z) {
    if (g.cityOwnsHangar) {
      const t = tower(); const h = t && t.hangar;
      if (h) {
        const hw = (h.w || 10) / 2 + 7, hd = (h.d || 10) / 2 + 7;
        if (Math.abs(x - h.x) <= hw && Math.abs(z - h.z) <= hd) return true;
      }
    }
    if (CBZ.cityStorageHangarHit) { try { if (CBZ.cityStorageHangarHit(x, z)) return true; } catch (e) {} }
    return false;
  }
  // Do you OWN a hangar anywhere? Either the penthouse deck hangar, or the
  // airport Private Hangar bought through the [G] storage menu. Feature-detected.
  function ownsAnyHangar() {
    if (g.cityOwnsHangar) return true;
    try { if (CBZ.cityStorage && CBZ.cityStorage.owns && CBZ.cityStorage.owns("hangar")) return true; } catch (e) {}
    return false;
  }
  // THE F-22 CANNOT BE BOUGHT. It's a trophy you STEAL from the military base
  // (storage.js boards the parked base jet → CBZ.citySpawnStolenJet) and KEEP by
  // landing it in a hangar you own (the keep-gate in onUpdate(12) sets
  // g.cityOwnsJet). This stub stays as the old name so any caller degrades into
  // the steal-it notice instead of a money buy. WHY: a $3M button made the apex
  // jet just another purchase; risking your life to lift it off a 4★ base and
  // sweating it back to your hangar is the felt earn.
  function jetNotBuyable() {
    if (g.cityOwnsJet) { aircraftNote("The F-22 is already yours — it's in your hangar.", 2.4, "Flight Ops"); return false; }
    aircraftNote("The F-22 can't be bought — steal it from the military base and land it in a hangar you own.", 3.4, "Flight Ops");
    return false;
  }
  CBZ.cityBuyJet = jetNotBuyable;

  // ============================================================
  //  INPUT — [F] board/eject + buy, [B] also buys at the hangar
  // ============================================================
  function activeCtx() {
    return g.mode === "city" && g.state === "playing" && document.pointerLockElement;
  }
  addEventListener("keydown", function (e) {
    if (!activeCtx() || e.repeat) return;
    const k = (e.key || "").toLowerCase();
    const P = CBZ.player; if (!P) return;
    if (k === "f") {
      // flying → eject; on foot → board nearest owned aircraft if close
      if (P._aircraft) { e.preventDefault(); exitAircraft(); return; }
      if (P.driving) return;                // in a car — vehicles.js owns [F]
      const c = nearestBoardable(P.pos.x, P.pos.z, 6.5);
      if (c) { e.preventDefault(); enterAircraft(c); }
    } else if (k === "b") {
      // the F-22 is no longer buyable here — at the hangar without one, point the
      // player at the steal-it path (storage.js owns the actual theft).
      if (!P._aircraft && !P.driving && !g.cityOwnsJet && atHangar(P.pos.x, P.pos.z)) {
        e.preventDefault(); jetNotBuyable();
      }
    }
  });

  // ============================================================
  //  FIRE MISSILES (left-click while flying)
  // ============================================================
  function fireMissile(craft) {
    if (!craft || craft.fireCD > 0) return;
    if (craft.armed === false) return;          // commercial aircraft do not grow F-22 weapons when hijacked
    if (craft.ammo <= 0) {
      aircraftNote("Out of missiles — land on the pad/hangar to resupply.", 1.6, "Flight Ops");
      return;
    }
    // world-space muzzle position + forward direction
    const m = craft.group.userData.muzzle;
    let mx, my, mz;
    if (m) { const wp = m.getWorldPosition(new THREE.Vector3()); mx = wp.x; my = wp.y; mz = wp.z; }
    else { mx = craft.pos.x; my = craft.pos.y; mz = craft.pos.z; }
    // forward dir from heading + pitch (the craft's nose vector)
    const cp = Math.cos(craft.pitch);
    let dx = Math.sin(craft.heading) * cp;
    let dy = Math.sin(craft.pitch);
    let dz = Math.cos(craft.heading) * cp;
    const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;

    let fired = false;
    if (CBZ.cityFireMissile) {
      try { CBZ.cityFireMissile(mx, my, mz, dx, dy, dz, { byPlayer: true }); fired = true; } catch (e) { fired = false; }
    }
    if (!fired) {
      // graceful fallback: throw a forward-leading explosion so the weapon still
      // "works" if the missile hook isn't wired. Lands ahead along the aim.
      const reach = 26;
      const tx = mx + dx * reach, tz = mz + dz * reach;
      if (CBZ.cityExplosion) { try { CBZ.cityExplosion(tx, tz, { power: 1.4, radius: 8, byPlayer: true }); } catch (e) {} }
    }
    craft.ammo--;
    craft.fireCD = FIRE_CD;
    if (CBZ.shake) { try { CBZ.shake(0.35); } catch (e) {} }
    if (CBZ.sfx) { try { CBZ.sfx("whoosh"); } catch (e) {} }
    // firing in the city is a crime → raises heat (guarded)
    if (CBZ.cityCrime) { try { CBZ.cityCrime(120, { x: craft.pos.x, z: craft.pos.z, type: "shots-fired" }); } catch (e) {} }
  }

  // left-click fires while flying (pointer-locked)
  addEventListener("mousedown", function (e) {
    if (e.button !== 0) return;
    if (!activeCtx()) return;
    const craft = _aircraftFlying(); if (!craft) return;
    e.preventDefault();
    fireMissile(craft);
  });

  // ============================================================
  //  FLIGHT UPDATE — runs AFTER physics (order 12, just past vehicles' 11) and
  //  OWNS the aircraft + player transform while flying.
  // ============================================================
  function clampToCity(pos, r) {
    const A = CBZ.city && CBZ.city.arena;
    if (A && A.clampToCity) { try { A.clampToCity(pos, r); } catch (e) {} }
  }

  function flyHeli(craft, dt) {
    const k = CBZ.keys || {};
    const A = CBZ.aeroPhysics;
    const authority = controlAuthority(craft);     // damage-degraded control (1 = full)

    // ---- AUTOROTATION FALLBACK: heavy damage (or any future "engine out"
    // trigger) takes the engine away — collective can no longer ADD lift, but
    // the freewheeling rotor still gives the pilot a controlled descent: sink
    // rate is capped (not a death plummet), and a FLARE near the ground
    // (pulling collective right at touchdown) cushions the landing. This is
    // ADDITIONAL to the existing scripted death-spiral elsewhere in the game
    // (that's for the AI gunship being shot down — a wholly different code
    // path in aircraft.js, untouched) — this is what happens to the PLAYER'S
    // OWN heli when it's critically hurt, and it's survivable for a skilled
    // pilot instead of a guaranteed loss.
    craft.autorotating = craft.maxHp > 0 && (craft.hp / craft.maxHp) <= AUTOROTATE_AT;

    // heading from mouse yaw (look = heading), plus A/D yaw trim (PEDAL input)
    if (CBZ.cam) {
      // craft faces away from the camera yaw (chase cam sits behind)
      craft.heading = CBZ.cam.yaw + Math.PI;
    }
    let yaw = 0;
    if (k["a"]) yaw += 1;
    if (k["d"]) yaw -= 1;
    // forward/back thrust along heading (collective tilt)
    let thr = 0;
    if (k["w"]) thr += 1;
    if (k["s"]) thr -= 1;
    // vertical: SPACE ascend, SHIFT/CTRL descend (collective input)
    let liftIn = 0;
    if (k[" "]) liftIn += 1;
    if (k["shift"] || k["control"]) liftIn -= 1;

    // ---- TORQUE / TAIL-ROTOR COUPLING: pulling collective (climbing, or
    // gaining forward thrust) spins the main rotor harder, and Newton's third
    // law wants to yaw the fuselage the opposite way — the pilot has to hold
    // opposing pedal (A/D) to counter it, exactly like a real heli. Modelled
    // as a reactive yaw rate that builds toward a target proportional to the
    // POSITIVE collective/thrust input (climbing or accelerating forward both
    // load the disc) and eases back down when power is released. Pedal input
    // (yaw) both steers AND is how the player fights this reaction.
    const powerLoad = Math.max(0, liftIn) * 0.7 + Math.max(0, thr) * 0.3;
    const targetTorqueYaw = -powerLoad * HELI_TORQUE_GAIN;   // reacts opposite rotor spin
    craft.torqueYaw = (craft.torqueYaw || 0) + (targetTorqueYaw - (craft.torqueYaw || 0)) * Math.min(1, dt * HELI_TORQUE_DAMP);
    if (CBZ.cam) CBZ.cam.yaw -= (yaw * HELI_YAW * authority + craft.torqueYaw) * dt;   // pedal trim + reactive yaw, both via cam.yaw

    const fx = Math.sin(craft.heading), fz = Math.cos(craft.heading);
    craft.vx += fx * thr * HELI_THRUST * authority * dt;
    craft.vz += fz * thr * HELI_THRUST * authority * dt;

    // ---- LIFT/DRAG AERO STEP (shared core) --------------------------------
    // Resolve the CURRENT world velocity into the body frame, run it through
    // the Cl(alpha) stall curve for a genuine AoA-driven lift reading, apply
    // six-axis drag (sideways/backward motion bleeds off harder than clean
    // forward flight — a pirouette decelerates fast), and feed ETL + ground
    // effect into the vertical authority instead of a flat HELI_VLIFT.
    let etl = 1, groundMul = 1, aoaDeg = 0, stalled = false;
    if (A) {
      const local = A.localVelocity(craft.vx, craft.vy, craft.vz, craft.heading, craft.pitch || 0, craft.roll || 0);
      const groundY = floorY(craft.pos.x, craft.pos.z);
      const agl = Math.max(0, craft.pos.y - craft.belly - groundY);
      groundMul = A.groundEffectMul(agl, HELI_SPAN);
      etl = A.etlMul(Math.max(0, local.z), HELI_ETL_LO, HELI_ETL_HI);
      const aero = A.aeroForces(local, {
        liftScale: 0.0065, etl, groundMul,
        dragCoef: { px: 0.085, nx: 0.085, py: 0.06, ny: 0.06, pz: 0.018, nz: 0.11 },
      });
      aoaDeg = aero.aoaDeg; stalled = aero.stalled;
      // six-axis drag re-expressed back into world space via the verified
      // inverse transform (worldVelocity — the exact mathematical inverse of
      // localVelocity, see aircraftphysics.js). (vy is a direct collective
      // COMMAND below, not force-integrated, so only the horizontal drag
      // components feed back into vx/vz here.)
      const dragWorld = A.worldVelocity(aero.dragLocal.x, 0, aero.dragLocal.z, craft.heading, craft.pitch || 0, craft.roll || 0);
      craft.vx += dragWorld.x * dt;
      craft.vz += dragWorld.z * dt;
    }
    // legacy hover-bleed kept as a gentle FLOOR under the new 6-axis drag so a
    // motionless hover still settles cleanly even before the aero term above
    // has much velocity to act on (it scales with v^2 — near-zero speed needs
    // a linear term to actually stop drifting).
    craft.vx *= Math.max(0, 1 - HELI_DRAG * dt * (thr ? 0.3 : 1));
    craft.vz *= Math.max(0, 1 - HELI_DRAG * dt * (thr ? 0.3 : 1));
    // clamp horizontal speed
    const hsp = Math.hypot(craft.vx, craft.vz);
    if (hsp > HELI_TOP) { const s = HELI_TOP / hsp; craft.vx *= s; craft.vz *= s; }

    // vertical authority: ETL (mushy near hover, solid in forward flight) +
    // ground effect (a cushioning bonus low to the deck), both damage-scaled.
    const vlift = HELI_VLIFT * authority * (0.85 + (etl - 0.85) + (groundMul - 1) * 0.6);
    if (craft.autorotating) {
      // ENGINE OUT: collective can no longer ADD net lift — sink is capped,
      // not stopped, and a FLARE (holding UP near the ground) bleeds the
      // final sink rate down to something a skilled pilot walks away from.
      const groundY = floorY(craft.pos.x, craft.pos.z);
      const agl = Math.max(0, craft.pos.y - craft.belly - groundY);
      const flareT = agl < FLARE_HEIGHT ? 1 - agl / FLARE_HEIGHT : 0;
      const targetSink = -AUTOROTATE_SINK + flareT * (AUTOROTATE_SINK - FLARE_SINK) * Math.max(0, liftIn);
      craft.vy += (targetSink - craft.vy) * Math.min(1, dt * 3);
    } else {
      craft.vy = liftIn * vlift;
    }
    // body tilt: nose down on forward thrust, bank into yaw — a stalled disc
    // (deep negative AoA from a hard vertical drop) noses over further, which
    // reads as the "nose drops, lift collapses" stall behaviour from a heli's
    // rotor losing efficiency, and recovers the instant airspeed/AoA come back.
    const stallPitch = stalled ? -0.22 : 0;
    craft.pitch = (craft.pitch || 0) + ((-thr * 0.18 + stallPitch) - craft.pitch) * Math.min(1, dt * 4);
    craft.roll = (craft.roll || 0) + ((yaw * 0.22) - craft.roll) * Math.min(1, dt * 4);
    // spin the rotors (autorotation keeps them windmilling, just slower/no power feel)
    craft.rotorSpin += dt * (craft.autorotating ? 18 : 30);
    const ud = craft.group.userData;
    if (ud.rotor) ud.rotor.rotation.y = craft.rotorSpin;
    if (ud.rotor2) ud.rotor2.rotation.y = craft.rotorSpin + Math.PI / 4;
    if (ud.trotor) ud.trotor.rotation.x = craft.rotorSpin * 1.6;
    if (ud.trotor2) ud.trotor2.rotation.x = craft.rotorSpin * 1.6 + Math.PI / 4;
    craft.speed = hsp;
    craft.aoa = aoaDeg; craft.stalled = stalled;
  }

  function flyJet(craft, dt) {
    const k = CBZ.keys || {};
    const A = CBZ.aeroPhysics;
    const authority = controlAuthority(craft);     // damage-degraded control (1 = full)

    // ---- THROTTLE: the engine power setting (still has an idle floor — a
    // jet doesn't flame out from the stick alone). NOTE this is no longer
    // the same thing as airSPEED: throttle is what the engine is COMMANDED
    // to deliver; craft.speed (below) is what the airframe is ACTUALLY
    // doing, and the two can now diverge — that gap is the stall.
    let thr = 0;
    if (k["w"]) thr += 1;
    if (k["s"]) thr -= 1;
    craft.throttle = (craft.throttle == null ? JET_MIN : craft.throttle) + thr * JET_ACCEL * dt;
    craft.throttle = Math.max(JET_MIN, Math.min(JET_MAX, craft.throttle));

    // bank/turn: A/D plus mouse yaw both steer the heading (wide turns)
    let bank = 0;
    if (k["a"]) bank += 1;
    if (k["d"]) bank -= 1;
    // mouse yaw feeds the heading too (camera sits behind)
    if (CBZ.cam) {
      const camHeading = CBZ.cam.yaw + Math.PI;
      let dh = camHeading - craft.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      craft.heading += dh * Math.min(1, dt * 2.2) * authority;          // ease toward look dir
    }
    craft.heading += bank * JET_TURN * authority * dt;
    // climb/dive — NOSE attitude command (the pilot's stick input)
    let climb = 0;
    if (k[" "]) climb += 1;
    if (k["control"] || k["shift"]) climb -= 1;
    craft.pitch = (craft.pitch || 0) + ((climb * 0.4 * authority) - craft.pitch) * Math.min(1, dt * 3);
    craft.roll = (craft.roll || 0) + ((bank * 0.5 * authority) - craft.roll) * Math.min(1, dt * 3);

    // ---- STALL MODEL (hybrid: kinematic baseline + aero override) ---------
    // The ORIGINAL jet was pure kinematics: velocity was rebuilt from the
    // nose vector every single frame, which is exactly why it could never
    // stall (there's no "actual flightpath" for the nose to diverge from).
    // A full from-scratch force integration is the "correct" way to fix that
    // but is notoriously easy to leave subtly unstable (sign/order mistakes
    // compound every frame and diverge — verified the hard way while tuning
    // this). So: keep the proven kinematic "nose defines intended velocity"
    // baseline for normal flight (same feel as always), but let the ACTUAL
    // velocity LAG behind that intended velocity at a rate driven by the Cl
    // curve — strong blending (snaps to the nose, old behaviour) when AoA is
    // small, weak-to-none (gravity/momentum take over, nose and flightpath
    // genuinely separate) once AoA crosses into the stall. That divergence
    // IS the angle-of-attack feeding the curve, so it's self-consistent, and
    // because the baseline IS the old proven model, normal flight is exactly
    // as stable/fun as before — only deep, sustained high-AoA maneuvers (slow
    // + nose hauled up) ever expose the stall.
    craft.speed = (craft.speed == null ? craft.throttle : craft.speed) + thr * JET_ACCEL * authority * dt;
    craft.speed = Math.max(0, Math.min(JET_MAX, craft.speed));
    const cp = Math.cos(craft.pitch);
    const nx = Math.sin(craft.heading) * cp, nz = Math.cos(craft.heading) * cp, ny = Math.sin(craft.pitch);
    const intendedVx = nx * craft.speed, intendedVy = ny * craft.speed, intendedVz = nz * craft.speed;

    // measure AoA from how far the CURRENT velocity has already drifted from
    // the nose (last frame's state) before blending this frame's correction.
    // NOTE: only aoaDeg/stalled are consumed below (they drive the blend
    // rate that determines how much the kinematic model "wins" each frame) —
    // liftLocal/dragLocal aren't applied as raw forces here the way the heli
    // uses them, so liftScale/dragCoef are left at neutral defaults.
    let aoaDeg = 0, stalled = false, groundMul = 1;
    if (A) {
      const curVx = craft.vx || intendedVx, curVy = craft.vy || intendedVy, curVz = craft.vz || intendedVz;
      const local = A.localVelocity(curVx, curVy, curVz, craft.heading, craft.pitch || 0, craft.roll || 0);
      const groundY = floorY(craft.pos.x, craft.pos.z);
      const agl = Math.max(0, craft.pos.y - craft.belly - groundY);
      groundMul = A.groundEffectMul(agl, JET_SPAN);
      const aero = A.aeroForces(local, { groundMul, incidenceDeg: 6 });
      aoaDeg = aero.aoaDeg; stalled = aero.stalled;

      // blend rate: 1 (instant snap, old behaviour) when comfortably inside
      // the stall margin, collapsing toward a slow drift as AoA approaches
      // and crosses STALL_AOA — gravity (added below) does the rest.
      const margin = Math.max(0, A.STALL_AOA - Math.abs(aoaDeg)) / A.STALL_AOA;     // 1 far from stall, 0 AT the limit
      const snap = stalled ? 0.06 : Math.min(1, 0.18 + margin * margin * 12);
      const k2 = 1 - Math.pow(1 - Math.min(1, snap), dt * 30);
      craft.vx = curVx + (intendedVx - curVx) * k2;
      craft.vy = curVy + (intendedVy - curVy) * k2;
      craft.vz = curVz + (intendedVz - curVz) * k2;
      // gravity always applies — what actually produces the sink/stall sag
      // (when the kinematic blend is strong this is masked by the snap; once
      // stalled the blend is weak and gravity visibly wins, exactly as
      // intended: lift has collapsed, so weight takes over).
      craft.vy -= 9.8 * dt;
      // ground effect gives a gentle floaty cushion right at the deck
      if (groundMul > 1) craft.vy += (groundMul - 1) * 6 * dt;
    } else {
      craft.vx = intendedVx; craft.vy = intendedVy; craft.vz = intendedVz;
    }
    // a STALLED wing: the nose drops on its own (you lose the ability to
    // HOLD it up, exactly like a real departure) — recoverable the instant
    // AoA/airspeed come back under the limit, never a hard fail. Capped rate
    // so it reads as "the jet fighting you", not an instant snap to vertical.
    if (stalled) craft.pitch += (-0.45 - craft.pitch) * Math.min(1, dt * 1.2);

    // craft.speed re-syncs to the ACTUAL velocity magnitude every frame, so it
    // genuinely reads low in a stall (the "let speed drop below the old
    // floor" the brief asks for) and recovers on its own the instant the
    // blend above snaps speed back toward the kinematic/throttle target.
    craft.speed = Math.hypot(craft.vx, craft.vy, craft.vz);

    craft.aoa = aoaDeg; craft.stalled = stalled;
    // afterburner pulse
    const ud = craft.group.userData;
    if (ud.burn) ud.burn.scale.z = 1.2 + Math.sin(craft.rotorSpin += dt * 24) * 0.5 + (thr > 0 ? 0.6 : 0);
  }

  function integrate(craft, dt) {
    craft.pos.x += craft.vx * dt;
    craft.pos.y += craft.vy * dt;
    craft.pos.z += craft.vz * dt;
    // altitude ceiling + ground floor (never sink the belly through terrain)
    const gy = floorY(craft.pos.x, craft.pos.z);
    const minY = gy + (craft.groundOffset != null ? craft.groundOffset : craft.belly + GROUND_PAD);
    if (craft.pos.y < minY) {
      // HARD-LANDING CHECK (autorotation payoff): if the heli touches down
      // sinking faster than the flare can bleed off, that's a hard landing —
      // a little extra airframe damage proportional to the excess sink, so
      // FLARING (timing the collective pull near the ground) is a real skill
      // with a real reward, not cosmetic. A normal/jet landing (small vy) is
      // unaffected — this only fires on a genuinely hard touchdown.
      if (craft.kind === "heli" && craft.vy < -FLARE_SINK * 1.6) {
        damageCraft(craft, Math.min(60, (-craft.vy - FLARE_SINK) * 4));
      }
      craft.pos.y = minY;
      if (craft.vy < 0) craft.vy = 0;
      // a jet that bottoms out keeps cruising level (no stall-crash); a heli rests
      if (craft.kind === "jet" && craft.pitch < 0) craft.pitch = 0;
    }
    if (craft.pos.y > CEILING) { craft.pos.y = CEILING; if (craft.vy > 0) craft.vy = 0; }
    // keep inside the world bounds
    clampToCity(craft.pos, 2.0);
    // apply transform
    craft.group.position.set(craft.pos.x, craft.pos.y, craft.pos.z);
    setCraftRotation(craft, craft.pitch || 0, craft.heading, craft.roll || 0);
  }

  CBZ.onUpdate(12, function (dt) {
    if (g.mode !== "city") return;
    // idle rotor spin for a parked-but-owned heli (it reads as "ready")
    if (heli && _aircraftFlying() !== heli && heli.group) {
      heli.rotorSpin += dt * 6;
      const ud = heli.group.userData;
      if (ud.rotor) ud.rotor.rotation.y = heli.rotorSpin;
      if (ud.rotor2) ud.rotor2.rotation.y = heli.rotorSpin + Math.PI / 4;
    }
    const P = CBZ.player;
    const craft = P && P._aircraft;
    if (!craft || P.dead) {
      // dead while flying → eject so death.js takes over on the ground. A hot
      // stolen jet is lost on death (exitAircraft despawns it).
      if (craft && P && P.dead) exitAircraft();
      return;
    }
    if (craft.fireCD > 0) craft.fireCD = Math.max(0, craft.fireCD - dt);
    if (craft.kind === "jet") flyJet(craft, dt); else flyHeli(craft, dt);
    integrate(craft, dt);
    // ---- KEEP-GATE: land a HOT stolen F-22 inside a hangar you OWN, slow, and
    // it becomes permanently yours. This is the only way to keep the trophy.
    if (craft.hot && !craft.fromProp && craft.kind === "jet" && craft.speed < 16 && hangarKeepHit(craft.pos.x, craft.pos.z)) {
      craft.hot = false;
      g.cityOwnsJet = true;
      _lastJetFlag = true;
      if (CBZ.cityClearWanted) CBZ.cityClearWanted();
      else if (CBZ.city && CBZ.city.clearWanted) CBZ.city.clearWanted();
      if (campaignActive()) aircraftNote("The Raptor is yours.", 2.8, "Flight Ops");
      else if (CBZ.city && CBZ.city.big) CBZ.city.big("🛩 THE RAPTOR IS YOURS");
      if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(60);
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
      if (CBZ.cityWorldCommit) CBZ.cityWorldCommit();
    }
    // own the player transform so physics.js (which bails on P.driving) and the
    // chase-cam (which follows player.pos) both track the aircraft
    P.pos.set(craft.pos.x, craft.pos.y, craft.pos.z);
    P.speed = craft.speed;
    P.vy = 0; P.grounded = false;
    if (CBZ.playerChar && CBZ.playerChar.group) {
      CBZ.playerChar.group.position.copy(P.pos);
      CBZ.playerChar.group.visible = false;
    }
    // The chase-cam (systems/camera.js, gated on player.driving) follows for
    // free off player.pos + cam.yaw. The HELI steers BY the mouse (look=heading)
    // so we leave cam.yaw to the mouse. The JET turns via A/D too, so gently ease
    // the cam back behind its nose so a long A/D turn doesn't lose the craft.
    if (CBZ.cam && craft.kind === "jet" && CBZ.lerpAngle) {
      CBZ.cam.yaw = CBZ.lerpAngle(CBZ.cam.yaw, craft.heading + Math.PI, 1 - Math.pow(0.15, dt));
    }
    // resupply if you settle back onto the base
    if (RESUPPLY_AT_BASE && craft.ammo < craft.maxAmmo) {
      const t = tower();
      const base = craft.kind === "jet" ? (t && t.hangar) : (t && t.helipad);
      if (base) {
        const bx = base.x, bz = base.z;
        if (Math.hypot(craft.pos.x - bx, craft.pos.z - bz) < 8 && craft.speed < 6) {
          craft.ammo = craft.maxAmmo;
        }
      }
    }
    drawHud(craft);
  });

  // ============================================================
  //  HUD — tiny optional flight readout (altitude / missiles / craft)
  // ============================================================
  function hudEl() {
    if (_hudEl) return _hudEl;
    if (typeof document === "undefined" || !document.body) return null;
    const d = document.createElement("div");
    d.id = "cityFlightHud";
    d.style.cssText = "position:fixed;left:50%;bottom:96px;transform:translateX(-50%);" +
      "font:600 13px/1.4 ui-monospace,Menlo,monospace;color:#cfe6ff;text-align:center;" +
      "background:rgba(8,12,18,0.55);padding:6px 14px;border-radius:8px;border:1px solid rgba(120,180,255,0.25);" +
      "pointer-events:none;z-index:60;display:none;text-shadow:0 1px 2px #000";
    document.body.appendChild(d);
    _hudEl = d;
    return d;
  }
  function drawHud(craft) {
    const el = hudEl(); if (!el) return;
    if (!craft || campaignActive()) { el.style.display = "none"; return; }
    const alt = Math.max(0, craft.pos.y - floorY(craft.pos.x, craft.pos.z));
    el.style.display = "block";
    const hpPct = craft.maxHp > 0 ? Math.round(100 * craft.hp / craft.maxHp) : 100;
    const hpTag = craft.autorotating ? "AUTOROTATING" : (craft.stalled ? "STALL" : (hpPct + "%"));
    el.innerHTML = "✈ " + craftLabel(craft).toUpperCase() +
      "  ·  ALT " + alt.toFixed(0) + "m" +
      "  ·  SPD " + (craft.speed || 0).toFixed(0) +
      (craft.armed === false ? "" : "  ·  MISSILES " + craft.ammo + "/" + craft.maxAmmo) +
      "  ·  HP " + hpTag;
  }
  function hideHud() { if (_hudEl) _hudEl.style.display = "none"; }

  // a separate on-foot proximity prompt ("[F] Fly the Heli" / buy the F-22)
  let _promptEl = null;
  function promptEl() {
    if (_promptEl) return _promptEl;
    if (typeof document === "undefined" || !document.body) return null;
    const d = document.createElement("div");
    d.id = "cityAircraftPrompt";
    d.style.cssText = "position:fixed;left:50%;bottom:140px;transform:translateX(-50%);" +
      "font:700 15px/1.4 ui-sans-serif,system-ui,sans-serif;color:#ffe7a0;text-align:center;" +
      "background:rgba(8,12,18,0.6);padding:7px 16px;border-radius:9px;border:1px solid rgba(255,210,120,0.35);" +
      "pointer-events:none;z-index:60;display:none;text-shadow:0 1px 3px #000";
    document.body.appendChild(d);
    _promptEl = d;
    return d;
  }
  function showPrompt(msg) {
    const el = promptEl(); if (!el) return;
    el.style.display = "block";
    el.innerHTML = msg;
  }
  function hidePrompt() { if (_promptEl) _promptEl.style.display = "none"; }
  // on-foot context: a board prompt near an owned craft, or a buy prompt at the
  // hangar. Cheap distance checks; only runs when not flying / not driving.
  function updatePrompt(P) {
    if (campaignActive() || !P || P.dead || P._aircraft || P.driving || g.state !== "playing") { hidePrompt(); return; }
    const x = P.pos.x, z = P.pos.z;
    const c = nearestBoardable(x, z, 6.5);
    if (c) { showPrompt("[F] Fly the " + (c.kind === "jet" ? "F-22 RAPTOR" : "Missile Heli")); return; }
    // A correct, in-place note ONLY when you're standing AT a hangar you OWN
    // (penthouse deck OR the airport Private Hangar) but haven't bagged the jet
    // yet — it tells you the next step. No persistent nag for the unowned case:
    // the way to GET a hangar lives in the [P] phone / [G] storage menu, not a
    // sticky on-screen prompt.
    if (!g.cityOwnsJet && atHangar(x, z) && ownsAnyHangar()) {
      showPrompt("Empty hangar — STEAL an F-22 from the military base & land it here to keep it");
      return;
    }
    hidePrompt();
  }

  // ============================================================
  //  SELF-HEAL + RESET
  // ============================================================
  // a light watchdog: re-place/refresh when a city is (re)built or ownership
  // flips, and tear down the jet meshes if a flag drops. Runs cheap.
  CBZ.onUpdate(13, function () {
    if (g.mode !== "city") { hideHud(); hidePrompt(); return; }
    if (!arenaRoot()) return;
    const heliFlag = !!g.cityOwnsHeli, jetFlag = !!g.cityOwnsJet;
    // ownership flip (bought penthouse / jet, or a flag was cleared)
    if (heliFlag !== _lastHeliFlag) { placeHeli(); _lastHeliFlag = heliFlag; }
    if (jetFlag !== _lastJetFlag) { placeJet(); _lastJetFlag = jetFlag; }
    // self-heal: an owned craft that lost its mesh (city rebuilt → new arena root)
    if (heliFlag && (!heli || !heli.group || heli.group.parent !== arenaRoot())) {
      if (heli && _aircraftFlying() !== heli) { disposeGroup(heli.group); heli = null; }
      if (!heli) placeHeli();
    }
    if (jetFlag && (!jet || !jet.group || jet.group.parent !== arenaRoot())) {
      if (jet && _aircraftFlying() !== jet) { disposeGroup(jet.group); jet = null; }
      if (!jet) placeJet();
    }
    if (!_aircraftFlying()) hideHud();
    updatePrompt(CBZ.player);
  });

  function teardown() {
    const P = CBZ.player;
    if (P && P._aircraft) { P.driving = false; P._aircraft = null; }
    if (P && CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = !P.dead;
    disposeGroup(heli && heli.group); heli = null;
    disposeGroup(jet && jet.group); jet = null;
    if (stolenAir) {
      // A civilian prop group belongs to the airport landmass. World teardown
      // removes that root; disposing it here would free shared airport material /
      // geometry out from under the rebuild. Only module-built stand-ins are ours.
      if (stolenAir.externalGroup) {
        // A city/prison reset keeps the airport root alive. Park the exact flown
        // airframe and restore its detached collider before returning its registry
        // record; simply clearing `taken` left a boardable jet hanging in mid-air
        // with no physical hull after the handoff.
        if (stolenAir.group && stolenAir.group.parent && stolenAir.sourceRec) {
          parkExternalCraft(stolenAir);
        } else {
          if (stolenAir.sourceRec) stolenAir.sourceRec.taken = false;
          if (stolenAir.group && stolenAir.group.userData) stolenAir.group.userData.craft = null;
        }
      } else disposeGroup(stolenAir.group);
      stolenAir = null;
    }
    g.cityOwnsJet = false;          // heli/hangar flags belong to realestate's reset
    _lastHeliFlag = false; _lastJetFlag = false;
    hideHud(); hidePrompt();
  }
  CBZ.cityPlayerAircraftReset = teardown;

  // chain onto the vehicles reset so a new run clears our flight state too
  // (mode.js calls CBZ.cityVehiclesReset on every fresh run). Wrapping a sibling
  // global is the same hook aircraft.js uses for cityWantedReset.
  function bindResetChain() {
    if (CBZ.cityVehiclesReset && !CBZ.cityVehiclesReset._airWrapped) {
      const orig = CBZ.cityVehiclesReset;
      CBZ.cityVehiclesReset = function () { teardown(); return orig.apply(this, arguments); };
      CBZ.cityVehiclesReset._airWrapped = true;
      return true;
    }
    return false;
  }
  // vehicles.js may load before or after us; try now, else on the first tick.
  if (!bindResetChain()) {
    let _bound = false;
    CBZ.onUpdate(14, function () {
      if (_bound) return;
      if (bindResetChain()) _bound = true;
    });
  }

  // ---- WRAP cityHurtPlayer: while the player is flying their OWN aircraft,
  // most of an incoming hit should land on the AIRFRAME (new hp model above),
  // not bare flesh — you're sat inside an armoured cockpit, not standing in
  // the open. We intercept the body-damage call, redirect the bulk of it to
  // damageCraft(), and let a SMALL fraction still reach the pilot (so a
  // sustained beating is still a real threat, and a finishing blast that
  // blows the airframe apart can still kill you). combat.js/death.js define
  // the REAL cityHurtPlayer after we load (index.html order), so this binds
  // lazily on the same onUpdate(14) retry as the reset chain above — never
  // assume load order. Environmental/self-inflicted hits (no attacker info
  // we can attribute to "being shot at while flying", e.g. fall damage) are
  // passed through unchanged; we only intercept while P._aircraft is set.
  const CRAFT_ABSORB = 0.82;     // fraction of incoming damage the airframe eats while flying
  function bindHurtWrap() {
    if (CBZ.cityHurtPlayer && !CBZ.cityHurtPlayer._airWrapped) {
      const orig = CBZ.cityHurtPlayer;
      const wrapped = function (dmg, fromX, fromZ, reason, headshot, attacker, nonlethal) {
        const P = CBZ.player;
        const craft = P && P._aircraft;
        if (craft && !craft.destroyed && dmg > 0) {
          const toCraft = dmg * CRAFT_ABSORB;
          const toPilot = dmg - toCraft;
          damageCraft(craft, toCraft);
          if (toPilot > 0.05) return orig.call(this, toPilot, fromX, fromZ, reason, headshot, attacker, nonlethal);
          return; // fully absorbed by the airframe this hit
        }
        return orig.apply(this, arguments);
      };
      wrapped._airWrapped = true;
      CBZ.cityHurtPlayer = wrapped;
      return true;
    }
    return false;
  }
  if (!bindHurtWrap()) {
    let _hurtBound = false;
    CBZ.onUpdate(14, function () {
      if (_hurtBound) return;
      if (bindHurtWrap()) _hurtBound = true;
    });
  }
})();
