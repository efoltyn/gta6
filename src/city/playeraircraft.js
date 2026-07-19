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
  // one-line revert for the military-theft swap fix (commandeered base jets/
  // bombers/helis fly their REAL parked model instead of a generic stand-in)
  if (CBZ.CONFIG && CBZ.CONFIG.AIR_MILITARY_REUSE == null) CBZ.CONFIG.AIR_MILITARY_REUSE = true;

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

  // ---- FLIGHT MODEL V2 (CBZ.CONFIG.AIRCRAFT_FLIGHT_V2) --------------------
  // Per-class fixed-wing tuning. The V2 wing model is a SCALAR-AIRSPEED craft:
  // throttle drives airspeed along the nose, bank commands a coordinated turn
  // (turn rate ∝ sin(bank)), climb bleeds airspeed / dives regain it, and a
  // persistent gravity "sag" term accumulates whenever airspeed drops under
  // the lift band — that sag IS the stall sink, and it decays the moment
  // flying speed returns. Velocity is rebuilt from (heading,pitch,airspeed)
  // each frame, which is unconditionally stable at this repo's spiky dt
  // (full force integration was tried for V1 and abandoned — see flyJet).
  //   vmax      — max level airspeed (m/s)      thrust — engine accel at full throttle
  //   dragK     — quadratic drag                vstall — below this, the wing stalls
  //   vminfly   — below this, no lift at all    vr     — rotate/takeoff speed (ground)
  //   gacc      — brake decel scale             rollMax/rollRate — bank limit / roll-in
  //   turnK     — yawRate = turnK·sin(roll)     pitchMax/pitchRate — attitude limits
  //   bleed     — airspeed lost per s per unit sin(pitch) climbing
  //   autoLevel — wings-level return rate with no input   span — feeds ground effect
  const WING_V2 = {
    prop:     { vmax: 58,  thrust: 22, dragK: 0.00055, vstall: 20, vminfly: 16, vr: 24, gacc: 9,  rollMax: 0.90, rollRate: 2.6, turnK: 0.55, pitchMax: 0.70, pitchRate: 1.8, bleed: 11, autoLevel: 1.4, span: 10 },
    jet:      { vmax: 120, thrust: 46, dragK: 0.00042, vstall: 42, vminfly: 34, vr: 55, gacc: 14, rollMax: 0.80, rollRate: 2.0, turnK: 0.42, pitchMax: 0.85, pitchRate: 1.5, bleed: 16, autoLevel: 1.1, span: 10.8 },
    airliner: { vmax: 105, thrust: 28, dragK: 0.00040, vstall: 46, vminfly: 38, vr: 62, gacc: 9,  rollMax: 0.55, rollRate: 1.3, turnK: 0.30, pitchMax: 0.40, pitchRate: 1.0, bleed: 13, autoLevel: 1.6, span: 34 },
  };
  // V2 helicopter hover feel: cyclic tilt is a VISUAL read of the body-frame
  // velocity (nose dips when accelerating forward, rolls into a lateral drift),
  // and vertical velocity EASES toward the collective command so the hover
  // breathes instead of snapping.
  const HELI_TILTMAX = 0.40;   // rad (~23°) max hover tilt
  const HELI_TILT_K  = 0.012;  // tilt per m/s of body-frame velocity
  const HELI_VDAMP   = 3.0;    // vertical-velocity ease rate /s
  function flightV2() { return !CBZ.CONFIG || CBZ.CONFIG.AIRCRAFT_FLIGHT_V2 !== false; }

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

  // Fixed-wing touchdowns are graded, not a binary nose-angle tripwire. The
  // former `sink >= 10 || pitch < -0.35` made ordinary approaches explode on
  // contact because a mild descent naturally holds some negative pitch. Only
  // catastrophic slams are certain; hard landings carry a rising crash chance
  // and otherwise damage the airframe so a rough arrival still has consequence.
  function touchdownRisk(sink, pitch) {
    sink = Math.max(0, sink || 0); pitch = pitch || 0;
    const sinkSeverity = Math.max(0, Math.min(1, (sink - 6) / 16));
    const noseSeverity = Math.max(0, Math.min(1, (-pitch - 0.30) / 0.70));
    const severity = Math.max(sinkSeverity, noseSeverity);
    return {
      severity,
      chance: severity >= 1 ? 1 : severity * severity * 0.72,
      damage: severity > 0 ? 10 + severity * 65 : 0,
    };
  }
  let touchdownSeed = 0x6d2b79f5;
  function touchdownRoll() {
    touchdownSeed = (Math.imul(touchdownSeed ^ (touchdownSeed >>> 15), 1 | touchdownSeed) + 0x9e3779b9) | 0;
    return (touchdownSeed >>> 0) / 4294967296;
  }
  CBZ.aircraftTouchdownRisk = touchdownRisk;

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
    // `floorAt` intentionally returns the fallback city datum (0) outside land.
    // Aircraft need the physical surface instead: over open water that is the
    // rendered sea, otherwise a hidden y=0 landing plane appears beneath them.
    if (CBZ.cityWaterAt) {
      try { if (CBZ.cityWaterAt(x, z)) return CBZ.SEA_Y != null ? CBZ.SEA_Y : -0.48; } catch (e) {}
    }
    if (CBZ.floorAt) { try { return CBZ.floorAt(x, z) || 0; } catch (e) { return 0; } }
    return 0;
  }
  CBZ.aircraftSurfaceY = floorY;   // read-only gameplay oracle used by audits
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
      // (the rotor-blur disc material is PER-CRAFT now — spinRotors animates its
      // opacity with rotor rate, so it can't live in this shared cache)
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
    // BUBBLE CANOPY — REAL transparent glass (shared vehicle glass), domed
    // (narrows top & nose) wrapping the cockpit. Tagged so aircraft_doors.js
    // can pop it open for the boarding/exit arc.
    const canopy = new THREE.Mesh(taperBox(1.55, 1.0, 2.1, { nz: 0.55, tz: 0.85, top: 0.4, bot: 1.0 }), a.mGlass);
    canopy.position.set(0, 0.52, 1.55); grp.add(canopy);
    grp.userData.canopy = canopy;
    // visible COCKPIT through the clear canopy: seat back + a pilot silhouette
    // (helmet + torso + stick) that appears only while someone's flying her.
    const heliSeat = new THREE.Mesh(boxGeo(0.5, 0.5, 0.14), a.mDark);
    heliSeat.position.set(0, 0.42, 1.1); grp.add(heliSeat);
    const heliPilot = new THREE.Group();
    const hpTorso = new THREE.Mesh(boxGeo(0.42, 0.46, 0.26), a.mDark); hpTorso.position.set(0, 0.38, 1.32); heliPilot.add(hpTorso);
    const hpHead = new THREE.Mesh(boxGeo(0.22, 0.22, 0.22), a.mGrey); hpHead.position.set(0, 0.72, 1.32); heliPilot.add(hpHead);
    const hpStick = new THREE.Mesh(boxGeo(0.05, 0.34, 0.05), a.mGrey); hpStick.position.set(0, 0.2, 1.62); hpStick.rotation.x = 0.35; heliPilot.add(hpStick);
    heliPilot.visible = false;
    grp.add(heliPilot);
    grp.userData.pilot = heliPilot;
    // SLEEKER TAIL BOOM — long, tapering thinner toward the tail rotor
    const boom = new THREE.Mesh(taperBox(0.5, 0.5, 4.2, { nz: 1.0, tz: 0.5, top: 0.85, bot: 0.85 }), a.mBody);
    boom.position.set(0, 0.5, -3.5); grp.add(boom);
    // swept vertical fin at the tail + a small horizontal stabiliser
    const fin = new THREE.Mesh(taperBox(0.18, 1.25, 0.95, { tz: 0.5, top: 0.55 }), a.mDark); fin.position.set(0, 0.95, -5.05); fin.rotation.x = 0.12; grp.add(fin);
    const stab = new THREE.Mesh(boxGeo(1.5, 0.1, 0.55), a.mDark); stab.position.set(0, 0.55, -4.7); grp.add(stab);
    // tail bumper skid — the angled strut that saves the boom on a hard flare
    const tskid = new THREE.Mesh(boxGeo(0.12, 0.5, 0.12), a.mDark);
    tskid.position.set(0, 0.14, -5.0); tskid.rotation.x = 0.35; grp.add(tskid);
    // ROUNDED SKIDS: a tapered tube with up-swept ends + a faired cross-tube to the belly
    [-0.92, 0.92].forEach((sx) => {
      const skid = new THREE.Mesh(taperBox(0.18, 0.18, 3.6, { nz: 0.5, tz: 0.5, top: 0.8, bot: 0.8 }), a.mDark);
      skid.position.set(sx, -1.0, 0.05); grp.add(skid);
      [1.0, -1.0].forEach((sz) => {
        // chunky struts (≥0.2u) — thin members read as floating at distance
        const strut = new THREE.Mesh(taperBox(0.22, 0.72, 0.22, { top: 0.7 }), a.mGrey);
        strut.position.set(sx * 0.85, -0.56, sz); strut.rotation.z = sx > 0 ? -0.18 : 0.18; grp.add(strut);
      });
    });
    // lateral cross-tubes tying the two skids into one frame (under the struts)
    [1.0, -1.0].forEach((sz) => {
      const cross = new THREE.Mesh(boxGeo(2.0, 0.18, 0.18), a.mDark);
      cross.position.set(0, -0.92, sz); grp.add(cross);
    });
    // stub weapon wings (roots buried in the body) + faired missile pods under them
    const wing = new THREE.Mesh(taperBox(3.7, 0.2, 0.95, { nz: 0.85, tz: 0.7 }), a.mGrey); wing.position.set(0, 0.02, 0.4); grp.add(wing);
    [-1.58, 1.58].forEach((px) => {
      const pod = new THREE.Mesh(taperBox(0.52, 0.52, 1.9, { nz: 0.35, tz: 0.6, top: 0.8, bot: 0.8 }), a.mDark);
      pod.position.set(px, -0.2, 0.4); grp.add(pod);
    });
    // chin sensor/gun turret under the nose — ties the muzzle point to a weapon
    const chin = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.34, 10), a.mDark);
    chin.position.set(0, -0.58, 2.35); grp.add(chin);
    const barrel = new THREE.Mesh(boxGeo(0.09, 0.09, 0.9), a.mGrey);
    barrel.position.set(0, -0.6, 2.8); grp.add(barrel);
    // MAIN ROTOR (spins about Y) — visible hub + a translucent blur disc + TWO bars
    // of real tapered/drooped blades. rotor & rotor2 are Groups (each a 2-blade bar
    // crossing the hub) so a .rotation.y still spins them exactly as before.
    const mast = new THREE.Mesh(taperBox(0.26, 0.55, 0.26, { top: 0.6 }), a.mDark); mast.position.y = 1.12; grp.add(mast);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.32, 0.26, 8), a.mGrey); hub.position.y = 1.42; grp.add(hub);
    // swashplate ring + control rods under the hub — the mechanical heart reads
    const swash = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.07, 10), a.mDark);
    swash.position.y = 1.3; grp.add(swash);
    [1, -1].forEach((s) => {
      const rod = new THREE.Mesh(boxGeo(0.06, 0.3, 0.06), a.mDark);
      rod.position.set(s * 0.17, 1.16, s * 0.12); rod.rotation.z = s * 0.18; grp.add(rod);
    });
    // twin engine cowls flanking the mast + outward-angled exhaust stubs
    [1, -1].forEach((s) => {
      const cowl = new THREE.Mesh(taperBox(0.5, 0.36, 1.6, { tz: 0.65, top: 0.7 }), a.mGrey);
      cowl.position.set(s * 0.42, 0.92, -0.7); grp.add(cowl);
      const ex = new THREE.Mesh(boxGeo(0.16, 0.16, 0.32), a.mDark);
      ex.position.set(s * 0.52, 1.0, -1.44); ex.rotation.y = s * 0.35; grp.add(ex);
    });
    // ROTOR-BLUR DISC — per-craft material starting INVISIBLE; spinRotors fades
    // it in with rotor RATE (parked = clean blades, full power = translucent
    // blur), replacing the old always-on ghost ring over a cold heli.
    const disc = new THREE.Mesh(new THREE.CircleGeometry(4.7, 20),
      new THREE.MeshBasicMaterial({ color: 0x10131a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    disc.rotation.x = -Math.PI / 2; disc.position.y = 1.45; grp.add(disc);
    grp.userData.rotorDisc = disc;
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
    const thub = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.14, 6), a.mGrey); thub.rotation.z = Math.PI / 2; thub.position.set(0.24, 0.95, -5.45); grp.add(thub);
    function tailBar() {
      // tail-rotor disc at the reference ratio (~0.17x the main disc: main
      // dia 9.2 → tail dia ~1.6). Verified against the orbit sheet — bigger
      // scrapes the ground on a flare, smaller is the toy-helicopter tell.
      const bar = new THREE.Group(); bar.position.set(0.24, 0.95, -5.45);
      [-1, 1].forEach((s) => {
        const bg = new THREE.BoxGeometry(0.06, 0.8, 0.24, 1, 4, 1);
        const pos = bg.attributes.position;
        for (let i = 0; i < pos.count; i++) { const ty = pos.getY(i); pos.setZ(i, pos.getZ(i) * (1 - 0.4 * Math.abs(ty) / 0.4)); }
        pos.needsUpdate = true; bg.computeVertexNormals();
        const bl = new THREE.Mesh(bg, a.bladeMat); bl.position.y = s * 0.4; bar.add(bl);
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
    const body = new THREE.Mesh(taperBox(1.55, 1.05, 8.8, { nz: 0.18, tz: 0.62, top: 0.72, bot: 0.62, segD: 10 }), a.mJet);
    grp.add(body);
    // a fine needle nose tip extending the taper to a point (radar boom feel)
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.35, 8), a.mJetDk);
    tip.rotation.x = -Math.PI / 2; tip.position.set(0, -0.02, 4.85); grp.add(tip);
    // radome seam collar where the dark nosecone meets the skin — crisps the nose
    const seam = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.12, 10), a.mJetDk);
    seam.rotation.x = Math.PI / 2; seam.position.set(0, -0.01, 4.15); grp.add(seam);
    // BUBBLE CANOPY — REAL transparent glass now; tagged for the door arc.
    const canopy = new THREE.Mesh(taperBox(0.9, 0.62, 2.4, { nz: 0.45, tz: 0.95, top: 0.45, bot: 1.0 }), a.mGlass);
    canopy.position.set(0, 0.5, 1.85); grp.add(canopy);
    grp.userData.canopy = canopy;
    // cockpit tub + ejection-seat back + pilot silhouette under the clear bubble
    const jetSeat = new THREE.Mesh(boxGeo(0.4, 0.44, 0.12), a.mJetDk);
    jetSeat.position.set(0, 0.38, 1.35); grp.add(jetSeat);
    const jetPilot = new THREE.Group();
    const jpTorso = new THREE.Mesh(boxGeo(0.34, 0.38, 0.22), a.mJetDk); jpTorso.position.set(0, 0.42, 1.55); jetPilot.add(jpTorso);
    const jpHead = new THREE.Mesh(boxGeo(0.2, 0.2, 0.2), a.mGrey); jpHead.position.set(0, 0.7, 1.55); jetPilot.add(jpHead);
    jetPilot.visible = false;
    grp.add(jetPilot);
    grp.userData.pilot = jetPilot;
    // chined forebody shoulders (LERX) — angular blends overlapping the body sides
    [-1, 1].forEach((s) => {
      const chine = new THREE.Mesh(taperBox(1.1, 0.4, 4.4, { nz: 0.25, tz: 0.85, top: 0.7 }), a.mJetDk);
      chine.position.set(s * 0.78, -0.12, 1.9); chine.rotation.y = s * 0.12; grp.add(chine);
    });
    // side air intakes hugging the lower fuselage, with near-black inner mouths
    // proud of the front face so the duct reads as an opening, not a slab
    [-1, 1].forEach((s) => {
      const intake = new THREE.Mesh(taperBox(0.5, 0.62, 2.0, { nz: 0.7, tz: 1.0, top: 0.7 }), a.mJetDk);
      intake.position.set(s * 0.82, -0.18, 0.7); grp.add(intake);
      const mouth = new THREE.Mesh(boxGeo(0.3, 0.4, 0.16), a.mDark);
      mouth.position.set(s * 0.82, -0.2, 1.66); grp.add(mouth);
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
    // AFTERBURNER PLUMES — the same reusable hot-core / shock-diamond exhaust
    // used by the base fighters and chop-shop car boosters.  Keeping one power
    // contract matters: a better rocket effect now upgrades every propelled
    // machine instead of leaving three slightly different fake flame cones.
    let plumeMat = null;
    const plume = [];
    [-0.5, 0.5].forEach((s) => {
      let p;
      if (CBZ.createRocketPlume) {
        p = CBZ.createRocketPlume({ name: "player-jet-afterburner", lightRange: 12 });
        if (!plumeMat && p.userData) plumeMat = p.userData.outerMaterial;
        if (CBZ.setRocketPlume) CBZ.setRocketPlume(p, 0, 0);
      } else {
        plumeMat = plumeMat || new THREE.MeshBasicMaterial({ color: 0xff8c3a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
        const pg = new THREE.ConeGeometry(0.3, 1.5, 10);
        pg.translate(0, 0.75, 0);                     // base at the mesh origin
        p = new THREE.Mesh(pg, plumeMat);
        p.rotation.x = -Math.PI / 2;                  // apex points -Z (astern)
      }
      p.position.set(s, -0.05, -4.9); grp.add(p); plume.push(p);
    });
    grp.userData.plume = plume; grp.userData.plumeMat = plumeMat;
    // LANDING GEAR (nose leg + two mains): chunky struts + wheel drums. The
    // whole group is toggled by integrate() — down under ~9m AGL, tucked above.
    // A parked Raptor always shows it (built visible; exitAircraft re-lowers).
    const gear = new THREE.Group();
    function leg(x, z, wr, sh) {
      const strut = new THREE.Mesh(taperBox(0.16, sh, 0.16, { top: 0.75 }), a.mGrey);
      strut.position.set(x, -0.23 - sh / 2, z); gear.add(strut);
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(wr, wr, 0.16, 10), a.mDark);
      wheel.rotation.z = Math.PI / 2; wheel.position.set(x, -1.0 + wr, z); gear.add(wheel);
    }
    leg(0, 3.0, 0.18, 0.62);          // nose leg (under the forward fuselage)
    leg(-0.78, -0.4, 0.22, 0.58);     // port main (under the intake trunk)
    leg(0.78, -0.4, 0.22, 0.58);      // stbd main
    grp.add(gear);
    grp.userData.gear = gear;
    // NAV LIGHTS: port wingtip red, stbd wingtip green, white tailfin beacon
    navLight(grp, a.navR, -2.7, 0.0, -1.4);
    navLight(grp, a.navG,  2.7, 0.0, -1.4);
    navLight(grp, a.navW,  0, 1.4, -3.9);
    // nose muzzle (unchanged firing point + marker)
    addMuzzle(grp, 0, 0, 5.6);
    grp.userData.belly = 0.6;
    return grp;
  }

  // Shared runtime adapter for owned jets and adopted airport/base aircraft.
  // Modern exhausts use the reusable component; the tiny legacy branch keeps
  // third-party/older groups flyable without silently losing their effect.
  function powerJetPlumes(ud, power, time, lengthMul, radiusMul) {
    if (!ud || !ud.plume) return false;
    power = Math.max(0, Math.min(1, +power || 0));
    let modern = false;
    for (let i = 0; i < ud.plume.length; i++) {
      const p = ud.plume[i];
      if (CBZ.setRocketPlume && CBZ.setRocketPlume(p, power, time, lengthMul, radiusMul)) modern = true;
    }
    if (modern) return true;
    if (!ud.plumeMat) return false;
    const flick = 0.92 + Math.sin((+time || 0) * 1.7) * 0.08;
    const len = (0.35 + 1.5 * power) * flick * (lengthMul || 1);
    const rad = (0.55 + 0.45 * power) * (radiusMul || 1);
    for (let i = 0; i < ud.plume.length; i++) {
      ud.plume[i].visible = power > 0.01;
      ud.plume[i].scale.set(rad, len, rad);
    }
    ud.plumeMat.opacity = power > 0.01 ? 0.10 + 0.75 * power * power : 0;
    return true;
  }

  // ---- studio hook: pure mesh builders for tools/studio.mjs expr shots
  // (no arena/scene dependency — returns a fresh Object3D). Dev-only cost: nil.
  CBZ.debugBuildAircraft = { heli: buildHeli, jet: buildJet };

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

  // ---- SWAP-FIX contract with island_military.js: on a parked military craft
  // the live MAIN rotor mesh is tagged `userData.rotor` (spins about local Y)
  // and the tail rotor `userData.tailRotor` (spins about local X). Collect them
  // once at adoption so the per-frame spin is a flat array walk. Object3D-valued
  // tags are skipped here — that's our OWN builders' group.userData channel,
  // which spinRotors drives directly.
  function collectTaggedRotors(grp) {
    const mains = [], tails = [];
    if (grp && grp.traverse) {
      grp.traverse(function (o) {
        if (o === grp || !o.userData) return;
        if (o.userData.tailRotor) tails.push(o);
        else if (o.userData.rotor && !o.userData.rotor.isObject3D) mains.push(o);
      });
    }
    return { mains: mains, tails: tails };
  }
  // does a (possibly island-built) group expose a spinnable main rotor at all?
  function groupHasRotor(grp) {
    const ud = grp && grp.userData;
    if (ud && ud.rotor && ud.rotor.isObject3D) return true;    // builder-style pointer tag
    return collectTaggedRotors(grp).mains.length > 0;          // island-style mesh tags
  }

  function makeCraft(kind, opts) {
    opts = opts || {};
    const root = arenaRoot(); if (!root) return null;
    // Civilian airport theft reuses the exact parked airliner/private-jet group,
    // and (swap fix) so does a commandeered MILITARY jet/bomber/heli. Owned
    // craft keep using the purpose-built flight models.
    const grp = opts.group || (kind === "jet" ? buildJet() : buildHeli());
    if (opts.group) {
      // an adopted parked prop may have been matrix-frozen as static scenery by
      // the perf pass — the root moves every frame now, so wake its matrix.
      grp.matrixAutoUpdate = true;
    }
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
      // ---- flight model V2 state ----
      // airClass picks the per-class WING_V2 tuning row: hijacked airliners fly
      // heavy and stately, a hijacked private jet flies the light GA profile,
      // military fast movers fly "jet". Helis dispatch to flyHeliV2 instead.
      airClass: kind === "heli" ? "heli"
        : (opts.civilian ? (opts.flightKind === "airliner" ? "airliner" : "prop") : "jet"),
      airspeed: 0,             // V2: every craft starts from a genuine standstill
      thr: null,               // V2 throttle 0..1 (lazily seeded on first V2 frame)
      sag: 0,                  // accumulated stall/gravity sink (m/s)
      onGround: true,          // ground-roll vs airborne state
      rotorRate: null,         // eased rotor spin rate (spin-up/spin-down)
    };
    // island-tagged rotor meshes on an adopted group (military reuse) — collect
    // once, and un-freeze each so its local spin actually recomposes a matrix.
    craft.rotorParts = opts.group ? collectTaggedRotors(grp) : null;
    if (craft.rotorParts) {
      craft.rotorParts.mains.concat(craft.rotorParts.tails).forEach(function (o) { o.matrixAutoUpdate = true; });
    }
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
    jet.airspeed = 0; jet.thr = null; jet.sag = 0; jet.onGround = true;
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
    const hw = Math.max(0.5, rec.colliderW || rec.footW || 3) * 0.5;
    const hl = Math.max(0.5, rec.colliderL || rec.footL || 5) * 0.5;
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
    if (rec.destroyed || craft.destroyed) return false;
    const gy = floorY(craft.pos.x, craft.pos.z);
    craft.pitch = craft.roll = 0;
    craft.vx = craft.vy = craft.vz = 0;
    craft.speed = 0;
    craft.airspeed = 0; craft.thr = null; craft.sag = 0; craft.onGround = true;
    craft.pos.y = gy + (craft.groundOffset != null ? craft.groundOffset : 0);
    setCraftRotation(craft, 0, craft.heading, 0);
    // keep the registry anchor honest if this rec's pos is a snapshot rather
    // than an alias of the group's live position (registerVehicle only aliases
    // when the rec arrives without one) — the collider rebuild reads rec.pos.
    if (rec.pos && rec.pos !== craft.pos) { rec.pos.x = craft.pos.x; rec.pos.y = craft.pos.y; rec.pos.z = craft.pos.z; }
    rec.heading = craft.heading + (craft.modelYawOffset || 0);
    rec.taken = false;
    rec.group.visible = true;
    rec.group.userData.craft = null;
    restorePropCollider(rec);
    if (stolenAir === craft) stolenAir = null;
    return true;
  }

  // ---- STEAL A FLYABLE FROM A PARKED PROP — the entry militaryvehicles.js calls
  // when you commandeer a base jet/bomber/helicopter or an airport airliner/
  // private jet. BOTH paths now attach the flight state to the EXACT parked
  // group: the distinct bomber/gunship silhouette you walked up to is the one
  // that takes off — no more swapping in a generic F-22/chopper stand-in. A
  // military heli only reuses its group when island_military.js tagged a live
  // rotor on it (userData.rotor); otherwise, and whenever the group is missing,
  // it falls back to the proven weaponised stand-in so blades never freeze
  // mid-air. Everything lives in the separate `stolenAir` slot so the owned
  // heli/Raptor singletons are untouched.
  function spawnFlyableFromProp(rec) {
    if (!rec || !rec.pos || rec.destroyed) return null;
    const root = arenaRoot(); if (!root) return null;
    if (CBZ.player && CBZ.player._aircraft) return null;       // already airborne
    const kind = rec.kind === "heli" ? "heli" : "jet";
    const civil = !!(rec.civilian && rec.kind === "plane");
    // THE SWAP FIX — reuse the real military airframe (flag-gated for revert)
    let milGroup = null;
    if (!civil && rec.group && rec.group.isObject3D &&
        (!CBZ.CONFIG || CBZ.CONFIG.AIR_MILITARY_REUSE !== false)) {
      if (kind !== "heli" || groupHasRotor(rec.group)) milGroup = rec.group;
    }
    // recycle a prior stolen bird if it's lying around un-flown
    if (stolenAir && _aircraftFlying() !== stolenAir) {
      if (!parkExternalCraft(stolenAir)) disposeGroup(stolenAir.group);
      stolenAir = null;
    }
    // camera pull-back scales with the airframe footprint, so a bomber gets the
    // airliner-style frame while a fighter keeps the tight default chase cam.
    const foot = Math.max(rec.footW || 3, rec.footL || 5);
    const craft = makeCraft(kind, civil ? {
      group: rec.group,
      sourceRec: rec,
      civilian: true,
      armed: false,
      flightKind: rec.flightKind,     // airliner vs privatejet → V2 airClass
      name: (rec.model && rec.model.name) || "Airliner",
      modelYawOffset: rec.modelYawOffset != null ? rec.modelYawOffset : -Math.PI / 2,
      groundOffset: rec.groundOffset != null ? rec.groundOffset : 0,
      speed: 0,
      throttle: 0,
      cameraBack: rec.flightKind === "airliner" ? 30 : 16,
      cameraUp: rec.flightKind === "airliner" ? 14 : 10,
      cameraAhead: rec.flightKind === "airliner" ? 18 : 10,
    } : milGroup ? {
      group: milGroup,
      sourceRec: rec,
      armed: true,                    // military hardware keeps its missiles
      name: (rec.model && rec.model.name) || (kind === "heli" ? "Military Gunship" : "Military Jet"),
      // military island models are built +Z-forward at heading 0 (rec supplies
      // an offset if a model deviates — same channel the airport recs use)
      modelYawOffset: rec.modelYawOffset != null ? rec.modelYawOffset : 0,
      groundOffset: rec.groundOffset != null ? rec.groundOffset : 0,
      cameraBack: Math.max(9.5, Math.min(32, foot * 0.85)),
      cameraUp: Math.max(10, Math.min(15, foot * 0.42)),
      cameraAhead: Math.max(6, Math.min(18, foot * 0.5)),
    } : null); if (!craft) return null;
    stolenAir = craft;
    // a reused military group has no builder muzzle — pin one to the model's
    // visual nose (respecting its yaw offset) so missiles leave the airframe,
    // not its centroid. addMuzzle also drops the small hot marker bead.
    if (milGroup && !craft.group.userData.muzzle) {
      const yo = craft.modelYawOffset || 0, nose = (rec.footL || 5) * 0.55;
      addMuzzle(craft.group, Math.sin(-yo) * nose, 1.1, Math.cos(-yo) * nose);
      craft.muzzle = craft.group.userData.muzzleLocal;
    }
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
    if (craft.externalGroup) detachPropCollider(rec);   // the hull you fly can't stay solid on the apron
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
    // someone's at the controls now — show the cockpit pilot through the glass
    if (craft.group.userData && craft.group.userData.pilot) craft.group.userData.pilot.visible = true;
    P.vy = 0; P.grounded = false;
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = false;
    // snap the player marker into the cockpit
    P.pos.set(craft.pos.x, craft.pos.y, craft.pos.z);
    // point the chase-cam down the craft's nose
    if (CBZ.cam) CBZ.cam.yaw = craft.heading + Math.PI;
    if (CBZ.sfx) { try { CBZ.sfx("door"); } catch (e) {} }
    // Controls belong in pause/settings, not in a floating toast and definitely
    // not as a fake in-world phone message. Entry is self-evident from the live
    // instrument strip; the door cue confirms the action without prose.
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
    if (craft && craft.group && craft.group.userData && craft.group.userData.pilot) craft.group.userData.pilot.visible = false;
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
      craft.airspeed = 0; craft.thr = null; craft.sag = 0; craft.onGround = true;
      const udX = craft.group && craft.group.userData;
      if (udX && udX.gear) udX.gear.visible = true;         // parked = gear down
      powerJetPlumes(udX, 0, 0);                            // engines back to cold
      const gy = floorY(craft.pos.x, craft.pos.z);
      const ox = Math.sin(craft.heading) * 2.2, oz = Math.cos(craft.heading) * 2.2;
      P.pos.set(craft.pos.x + ox, Math.max(gy, craft.pos.y - craft.belly), craft.pos.z + oz);
      P.vy = 0; P.grounded = true;
      if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(P.pos);
    }
    if (CBZ.sfx) { try { CBZ.sfx("door"); } catch (e) {} }
  }
  // PUBLIC EXIT — same call, same end state; when the craft is settled on the
  // ground the door/canopy visibly opens FIRST (you see out through the
  // opening), the normal exit places you beside it, and the door closes once
  // you clear it (aircraft_doors.js). Crash/death/despawn callers use the
  // internal exitAircraft directly and stay instant.
  function exitAircraftWithDoors() {
    const P = CBZ.player;
    const craft = P && P._aircraft;
    if (!craft || !CBZ.aircraftDoorArc) { exitAircraft(); return; }
    CBZ.aircraftDoorArc.exitCraft(craft, exitAircraft);
  }
  CBZ.cityPlayerAircraftExit = exitAircraftWithDoors;
  // TOUCH hooks (touch.js verb pills + touch_vehicle.js buttons): the [F] and
  // left-click handlers below are pointer-lock-gated, which a tablet never
  // satisfies — these call the same private functions those handlers end in.
  // Boarding routes through the same door arc the keyboard path uses.
  CBZ.cityAircraftFireMissile = function () { const c = _aircraftFlying(); if (c) fireMissile(c); };
  CBZ.cityAircraftBoardNearest = function () {
    const P = CBZ.player;
    if (!P || P._aircraft || P.driving || g.mode !== "city" || g.state !== "playing") return false;
    const c = nearestBoardable(P.pos.x, P.pos.z, 6.5);
    if (!c) return false;
    const doors = CBZ.aircraftDoorArc;
    if (!(doors && !doors.active && doors.boardCraft(c, enterAircraft))) enterAircraft(c);
    return true;
  };

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
      // flying → eject; on foot → board nearest owned aircraft if close.
      // Both verbs run the elevator-grammar door arc when available: canopy
      // pops open, you climb in/out through the opening, it closes.
      if (P._aircraft) { e.preventDefault(); exitAircraftWithDoors(); return; }
      if (P.driving) return;                // in a car — vehicles.js owns [F]
      const c = nearestBoardable(P.pos.x, P.pos.z, 6.5);
      if (c) {
        e.preventDefault();
        const doors = CBZ.aircraftDoorArc;
        if (!(doors && !doors.active && doors.boardCraft(c, enterAircraft))) enterAircraft(c);
      }
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
  // Aircraft own AIRSPACE, not the walkable-land union. The old land clamp
  // snapped a plane back to the nearest island the instant it crossed a shore,
  // making the surrounding ocean unflyable. Bound flight to the rendered sea
  // instead (with a cached world AABB) so the whole archipelago and open water
  // are usable while still preventing an endless flight into unloaded space.
  let airspaceSea = null, airspaceBounds = null;
  function clampToAirspace(craft, r) {
    const pos = craft && craft.pos ? craft.pos : craft;
    if (!pos) return;
    r = r || 2;
    const sea = CBZ.citySea;
    if (sea && sea !== airspaceSea) {
      airspaceSea = sea;
      try {
        sea.updateMatrixWorld(true);
        airspaceBounds = new THREE.Box3().setFromObject(sea);
      } catch (e) { airspaceBounds = null; }
    }
    // The overhaul sea is 7km centred (310,-750). This fallback also safely
    // encloses the legacy 6.2km sea and every registered island.
    const b = airspaceBounds || { min: { x: -3190, z: -4250 }, max: { x: 3810, z: 2750 } };
    const minX = b.min.x + r, maxX = b.max.x - r, minZ = b.min.z + r, maxZ = b.max.z - r;
    if (pos.x < minX) { pos.x = minX; if (craft && craft.vx < 0) craft.vx = 0; }
    else if (pos.x > maxX) { pos.x = maxX; if (craft && craft.vx > 0) craft.vx = 0; }
    if (pos.z < minZ) { pos.z = minZ; if (craft && craft.vz < 0) craft.vz = 0; }
    else if (pos.z > maxZ) { pos.z = maxZ; if (craft && craft.vz > 0) craft.vz = 0; }
  }

  // ---- spin every rotor a craft owns: the builder bars on OUR heli (group
  // userData.rotor/rotor2/trotor/trotor2 — 90° phase keeps the crossed bars a
  // true 4-blade star) AND any island-tagged meshes on a commandeered military
  // airframe (craft.rotorParts; mains spin about local Y, tails about local X).
  // Also fades the blur disc with rotor RATE: parked idle shows clean blades,
  // full power shows the translucent disc.
  function spinRotors(craft, dt, rate) {
    craft.rotorSpin += dt * rate;
    const ud = craft.group.userData || {};
    if (ud.rotor && ud.rotor.rotation) ud.rotor.rotation.y = craft.rotorSpin;
    if (ud.rotor2 && ud.rotor2.rotation) ud.rotor2.rotation.y = craft.rotorSpin + Math.PI / 2;
    if (ud.trotor && ud.trotor.rotation) ud.trotor.rotation.x = craft.rotorSpin * 1.6;
    if (ud.trotor2 && ud.trotor2.rotation) ud.trotor2.rotation.x = craft.rotorSpin * 1.6 + Math.PI / 2;
    const rp = craft.rotorParts;
    if (rp) {
      for (let i = 0; i < rp.mains.length; i++) rp.mains[i].rotation.y = craft.rotorSpin + i * (Math.PI / 2);
      for (let i = 0; i < rp.tails.length; i++) rp.tails[i].rotation.x = craft.rotorSpin * 1.6;
    }
    if (ud.rotorDisc && ud.rotorDisc.material) {
      const target = Math.max(0, Math.min(1, (rate - 8) / 20)) * 0.34;
      const m = ud.rotorDisc.material;
      m.opacity += (target - m.opacity) * Math.min(1, dt * 4);
    }
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
    spinRotors(craft, dt, craft.autorotating ? 18 : 30);
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
    // Hot exhaust is faint at idle and becomes a long, shock-diamond burner at
    // full throttle. Both cans stay nozzle-anchored while their fire extends aft.
    const plumePower = Math.max(0, Math.min(1, (craft.throttle - JET_MIN) / (JET_MAX - JET_MIN)));
    powerJetPlumes(ud, 0.08 + plumePower * 0.92, craft.rotorSpin, 1.55, 0.92);
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
    // retractable landing gear (jet): legs drop when skimming low, tuck away
    // with altitude — driven off the same AGL this integrator already knows.
    const udI = craft.group.userData;
    if (udI && udI.gear) udI.gear.visible = (craft.pos.y - gy) < 9;
    // keep inside the world bounds
    clampToAirspace(craft, 2.0);
    // apply transform
    craft.group.position.set(craft.pos.x, craft.pos.y, craft.pos.z);
    setCraftRotation(craft, craft.pitch || 0, craft.heading, craft.roll || 0);
  }

  // ============================================================
  //  FLIGHT MODEL V2 — CBZ.CONFIG.AIRCRAFT_FLIGHT_V2 (one-line revert to the
  //  V1 flyHeli/flyJet/integrate path above). Adds: real ground-roll →
  //  rotate-at-Vr → climb takeoffs, coordinated bank-to-turn with auto-level,
  //  a stall that genuinely sinks (persistent gravity sag under the lift
  //  band), flare/touchdown judgement (slam in or nose-first = fireball),
  //  wall strikes, rooftop-aware ground clamp (no more flying THROUGH
  //  towers), rotor spin-up, and a hover model that visibly leans into its
  //  own velocity.
  // ============================================================

  // tallest collider top at/below the craft's belly — the surface it can land
  // on (terrain OR a rooftop). Same CBZ.colliders data aircraft.js's AI uses.
  function roofUnder(craft) {
    // null means "no roof". Zero is a legitimate authored deck height, so it
    // cannot also be the sentinel — especially with the sea at -0.48.
    let topY = null;
    const cols = CBZ.colliders || [];
    const x = craft.pos.x, z = craft.pos.z;
    const yRef = craft.pos.y - craft.belly + 0.6;    // only tops at/under the belly count
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (c.y1 == null || (topY != null && c.y1 <= topY) || c.y1 > yRef) continue;
      if (x < c.minX - 0.5 || x > c.maxX + 0.5 || z < c.minZ - 0.5 || z > c.maxZ + 0.5) continue;
      topY = c.y1;
    }
    return topY;
  }
  // is the craft's nose about to bury itself in a building FACE? (a collider
  // whose span covers the nose point at the nose's own altitude — a roof we
  // are safely above never triggers, because the y-range test fails there)
  function wallAhead(craft) {
    const cols = CBZ.colliders || [];
    const dims = (craft.sourceRec && craft.sourceRec.aircraftDims) || (craft.group && craft.group.userData && craft.group.userData.aircraftDims);
    const hullLength = dims && dims.length ? dims.length : Math.max(
      (craft.sourceRec && craft.sourceRec.footW) || 0,
      (craft.sourceRec && craft.sourceRec.footL) || 0,
      craft.kind === "jet" ? 8 : 5
    );
    // Probe the actual nose, not a fixed 2.5m point from the centre. The old
    // probe put an A320's sensor inside its own cabin, so its nose could pass
    // deep into a tower before the centre finally registered a collision.
    const reach = Math.max(2.5 + (craft.speed || 0) * 0.06, hullLength * 0.5 - 0.35);
    const cp = Math.cos(craft.pitch || 0);
    const nx = craft.pos.x + Math.sin(craft.heading) * cp * reach;
    const ny = craft.pos.y + Math.sin(craft.pitch || 0) * reach;
    const nz = craft.pos.z + Math.cos(craft.heading) * cp * reach;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (nx < c.minX || nx > c.maxX || nz < c.minZ || nz > c.maxZ) continue;
      const y0 = c.y0 != null ? c.y0 : 0, y1 = c.y1 != null ? c.y1 : 18;
      if (ny >= y0 && ny <= y1) return { x: nx, y: ny, z: nz, collider: c };
    }
    return null;
  }

  function aircraftColliderRef(c) {
    let o = c && c.ref;
    while (o) {
      if (o.userData && (o.userData.aircraftDims || o.userData.hijackable || o.userData.craft)) return true;
      o = o.parent;
    }
    return false;
  }

  function airframeDims(craft) {
    const rec = craft && craft.sourceRec;
    const d = (rec && rec.aircraftDims) || (craft && craft.group && craft.group.userData && craft.group.userData.aircraftDims);
    if (d) return {
      length: Math.max(4, d.length || rec.footL || rec.footW || 8),
      span: Math.max(3, d.span || rec.footW || rec.footL || 7),
      height: Math.max(2, d.height || 3),
      fuselage: Math.max(1.1, d.fuselage || Math.min(3.2, (d.span || 8) * 0.16)),
    };
    if (craft && craft.kind === "heli") return { length: 8.2, span: 8.4, height: 3.0, fuselage: 2.0 };
    return { length: 10.2, span: 8.0, height: 2.5, fuselage: 1.6 };
  }

  function recordAirframeDims(rec) {
    const d = rec && (rec.aircraftDims || (rec.group && rec.group.userData && rec.group.userData.aircraftDims));
    if (d) return {
      length: Math.max(4, d.length || rec.footL || rec.footW || 8),
      span: Math.max(3, d.span || rec.footW || rec.footL || 7),
      height: Math.max(2, d.height || 3),
      fuselage: Math.max(1.1, d.fuselage || Math.min(3.2, (d.span || 8) * 0.16)),
    };
    const fw = Math.max(3, rec.footW || 5), fl = Math.max(4, rec.footL || 8);
    return rec.kind === "heli"
      ? { length: fl, span: Math.max(fw, fl), height: 3, fuselage: Math.min(2.4, fw * 0.55) }
      : { length: fl, span: fw, height: 2.8, fuselage: Math.min(2.2, fw * 0.28) };
  }

  // Segment against an axis-aligned box. Bounds may already be expanded by a
  // sample radius. Only allocate when a hit exists; the normal is the entry
  // face and therefore the physically useful bounce/crash normal.
  function segmentBox(x0, y0, z0, x1, y1, z1, minX, maxX, minY, maxY, minZ, maxZ) {
    let enter = 0, exit = 1, nx = 0, ny = 0, nz = 0;
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    let a, b, n;
    if (Math.abs(dx) < 1e-8) { if (x0 < minX || x0 > maxX) return null; }
    else {
      a = (minX - x0) / dx; b = (maxX - x0) / dx; n = -1;
      if (a > b) { const q = a; a = b; b = q; n = 1; }
      if (a > enter) { enter = a; nx = n; ny = nz = 0; }
      if (b < exit) exit = b; if (enter > exit) return null;
    }
    if (Math.abs(dy) < 1e-8) { if (y0 < minY || y0 > maxY) return null; }
    else {
      a = (minY - y0) / dy; b = (maxY - y0) / dy; n = -1;
      if (a > b) { const q = a; a = b; b = q; n = 1; }
      if (a > enter) { enter = a; ny = n; nx = nz = 0; }
      if (b < exit) exit = b; if (enter > exit) return null;
    }
    if (Math.abs(dz) < 1e-8) { if (z0 < minZ || z0 > maxZ) return null; }
    else {
      a = (minZ - z0) / dz; b = (maxZ - z0) / dz; n = -1;
      if (a > b) { const q = a; a = b; b = q; n = 1; }
      if (a > enter) { enter = a; nz = n; nx = ny = 0; }
      if (b < exit) exit = b; if (enter > exit) return null;
    }
    if (enter < 0 || enter > 1 || exit < 0) return null;
    // A step that begins barely embedded still gets a usable outward normal.
    if (!nx && !ny && !nz) {
      if (Math.abs(dx) >= Math.abs(dy) && Math.abs(dx) >= Math.abs(dz)) nx = dx > 0 ? -1 : 1;
      else if (Math.abs(dy) >= Math.abs(dz)) ny = dy > 0 ? -1 : 1;
      else nz = dz > 0 ? -1 : 1;
    }
    return { t: Math.max(0, enter), nx: nx, ny: ny, nz: nz };
  }

  // Five real airframe seats: body mass, nose, tail and both wing tips. A
  // single post-step nose point let fast jets tunnel and let wings ghost right
  // through buildings; sweeping these seats turns the plane into an airframe.
  const AIRFRAME_SAMPLES = [
    { f: 0, r: 0, rad: 0.45, part: "fuselage" },
    { f: 0.46, r: 0, rad: 0.32, part: "nose" },
    { f: -0.42, r: 0, rad: 0.28, part: "tail" },
    { f: -0.04, r: -0.46, rad: 0.20, part: "left-wing" },
    { f: -0.04, r: 0.46, rad: 0.20, part: "right-wing" },
  ];

  function sampleSeat(pos, craft, dims, spec, out) {
    const pitch = craft.pitch || 0, roll = craft.roll || 0, h = craft.heading || 0;
    const f = spec.f * dims.length, r = spec.r * dims.span;
    const cp = Math.cos(pitch), sh = Math.sin(h), ch = Math.cos(h);
    out.x = pos.x + sh * cp * f + ch * r;
    out.z = pos.z + ch * cp * f - sh * r;
    out.y = pos.y + dims.height * 0.31 + Math.sin(pitch) * f + Math.sin(roll) * r;
    return out;
  }

  const _seat0 = { x: 0, y: 0, z: 0 }, _seat1 = { x: 0, y: 0, z: 0 };

  function sweepWorld(craft, from, to, dims, best) {
    const cols = CBZ.colliders || [];
    for (let s = 0; s < AIRFRAME_SAMPLES.length; s++) {
      const spec = AIRFRAME_SAMPLES[s];
      sampleSeat(from, craft, dims, spec, _seat0); sampleSeat(to, craft, dims, spec, _seat1);
      const radius = Math.max(0.35, dims.fuselage * spec.rad);
      for (let i = 0; i < cols.length; i++) {
        const c = cols[i];
        if (!c || c.noAircraft || aircraftColliderRef(c) || c === (craft.sourceRec && craft.sourceRec.collider)) continue;
        const y0 = c.y0 != null ? c.y0 : 0, y1 = c.y1 != null ? c.y1 : 18;
        // Tiny road/kerb slabs stay below an aircraft's body and are already
        // owned by touchdown/terrain; never turn painted infrastructure into a
        // mid-air crash wall.
        if (y1 - y0 < 0.7 && y1 < Math.min(_seat0.y, _seat1.y) - radius) continue;
        const q = segmentBox(_seat0.x, _seat0.y, _seat0.z, _seat1.x, _seat1.y, _seat1.z,
          c.minX - radius, c.maxX + radius, y0 - radius, y1 + radius, c.minZ - radius, c.maxZ + radius);
        if (!q || (best && q.t >= best.t)) continue;
        const px = _seat0.x + (_seat1.x - _seat0.x) * q.t;
        const py = _seat0.y + (_seat1.y - _seat0.y) * q.t;
        const pz = _seat0.z + (_seat1.z - _seat0.z) * q.t;
        best = { t: q.t, x: px, y: py, z: pz, nx: q.nx, ny: q.ny, nz: q.nz, collider: c, part: spec.part };
      }
    }
    return best;
  }

  function sweepAircraft(craft, from, to, dims, best) {
    const list = CBZ.cityMilitaryVehicles || [];
    for (let i = 0; i < list.length; i++) {
      const rec = list[i];
      if (!rec || rec === craft.sourceRec || rec.destroyed || !rec.group || !rec.group.parent ||
          (rec.kind !== "plane" && rec.kind !== "heli") || (rec.taken && !rec._aiActive)) continue;
      const od = recordAirframeDims(rec), op = rec.pos || rec.group.position;
      const opx = rec._airSweepX == null ? op.x : rec._airSweepX;
      const opy = rec._airSweepY == null ? op.y : rec._airSweepY;
      const opz = rec._airSweepZ == null ? op.z : rec._airSweepZ;
      rec._airSweepX = op.x; rec._airSweepY = op.y; rec._airSweepZ = op.z;
      const oh = (rec.group.rotation.y || 0) - (rec.modelYawOffset || 0);
      const osh = Math.sin(oh), och = Math.cos(oh);
      const ocy = od.height * 0.31;
      for (let s = 0; s < AIRFRAME_SAMPLES.length; s++) {
        const spec = AIRFRAME_SAMPLES[s];
        sampleSeat(from, craft, dims, spec, _seat0); sampleSeat(to, craft, dims, spec, _seat1);
        // Relative-motion sweep: subtract the other plane's previous/current
        // roots before transforming into its OBB. Two fast planes crossing in
        // one frame therefore cannot pass through each other.
        let dx0 = _seat0.x - opx, dz0 = _seat0.z - opz;
        let dx1 = _seat1.x - op.x, dz1 = _seat1.z - op.z;
        const lx0 = dx0 * och - dz0 * osh, lz0 = dx0 * osh + dz0 * och;
        const lx1 = dx1 * och - dz1 * osh, lz1 = dx1 * osh + dz1 * och;
        const ly0 = _seat0.y - (opy + ocy), ly1 = _seat1.y - (op.y + ocy);
        const radius = Math.max(0.3, dims.fuselage * spec.rad);
        const body = segmentBox(lx0, ly0, lz0, lx1, ly1, lz1,
          -od.fuselage * 0.5 - radius, od.fuselage * 0.5 + radius,
          -ocy - radius, od.height - ocy + radius,
          -od.length * 0.5 - radius, od.length * 0.5 + radius);
        const wing = segmentBox(lx0, ly0, lz0, lx1, ly1, lz1,
          -od.span * 0.5 - radius, od.span * 0.5 + radius,
          -0.65 - radius, 0.65 + radius,
          -od.length * 0.19 - radius, od.length * 0.19 + radius);
        let q = body;
        if (wing && (!q || wing.t < q.t)) q = wing;
        if (!q || (best && q.t >= best.t)) continue;
        const nx = q.nx * och + q.nz * osh;
        const nz = -q.nx * osh + q.nz * och;
        const px = _seat0.x + (_seat1.x - _seat0.x) * q.t;
        const py = _seat0.y + (_seat1.y - _seat0.y) * q.t;
        const pz = _seat0.z + (_seat1.z - _seat0.z) * q.t;
        best = { t: q.t, x: px, y: py, z: pz, nx: nx, ny: q.ny, nz: nz,
          otherRec: rec, part: spec.part, otherPart: q === wing ? "wing" : "fuselage" };
      }
    }
    return best;
  }

  function sweptAirframeImpact(craft, from, to) {
    if (!craft || !from || !to) return null;
    const travel = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    if (travel < 0.015) return null;
    const dims = airframeDims(craft);
    let best = sweepWorld(craft, from, to, dims, null);
    best = sweepAircraft(craft, from, to, dims, best);
    return best;
  }
  CBZ.cityAircraftSweepProbe = function (craft, from, to) {
    const h = sweptAirframeImpact(craft, from, to);
    return h ? { t: h.t, x: h.x, y: h.y, z: h.z, nx: h.nx, ny: h.ny, nz: h.nz,
      part: h.part, building: !!h.collider, aircraft: !!h.otherRec, otherRec: h.otherRec || null, collider: h.collider || null } : null;
  };

  function resolveAirframeImpact(craft, from, attempted, impact) {
    if (!impact) return false;
    const speed = Math.max(craft.speed || 0, Math.hypot(craft.vx || 0, craft.vy || 0, craft.vz || 0));
    const rootT = Math.max(0, impact.t - 0.008);
    craft.pos.set(from.x + (attempted.x - from.x) * rootT,
      from.y + (attempted.y - from.y) * rootT,
      from.z + (attempted.z - from.z) * rootT);

    const catastrophic = speed >= (craft.kind === "heli" ? 15 : (craft.airClass === "airliner" ? 17 : 20));
    if (impact.otherRec) {
      const damage = catastrophic ? 9999 : Math.max(18, speed * 3.2);
      if (impact.otherRec.civilian && CBZ.cityDamageCivilAircraft) {
        try { CBZ.cityDamageCivilAircraft(impact.otherRec, damage, impact, { byPlayer: true, collision: true }); } catch (e) {}
      } else if (CBZ.cityAircraftCollisionImpact) {
        try { CBZ.cityAircraftCollisionImpact(impact.otherRec, damage, impact); } catch (e) {}
      }
    }

    if (catastrophic) { crashCraft(craft, impact); return true; }

    // Taxi/slow contact: resolve to the time of impact, dent the airframe and
    // reflect the normal component instead of exploding for a parking bump.
    const vn = craft.vx * impact.nx + craft.vy * impact.ny + craft.vz * impact.nz;
    if (vn < 0) {
      craft.vx -= 1.35 * vn * impact.nx;
      craft.vy -= 1.15 * vn * impact.ny;
      craft.vz -= 1.35 * vn * impact.nz;
    }
    craft.vx *= 0.28; craft.vy *= 0.22; craft.vz *= 0.28;
    craft.airspeed = Math.hypot(craft.vx, craft.vz);
    craft.speed = craft.airspeed;
    craft.roll += impact.part === "left-wing" ? 0.18 : impact.part === "right-wing" ? -0.18 : 0;
    damageCraft(craft, Math.max(4, speed * 1.35));
    if (craft.hp <= 0) { crashCraft(craft, impact); return true; }
    return false;
  }

  function charAircraftWreck(group) {
    if (!group || (group.userData && group.userData.charred)) return;
    group.userData.charred = true;
    group.traverse(function (o) {
      if (!o.material) return;
      function charOne(src) {
        const m = src && src.clone ? src.clone() : src;
        if (m && m.color) m.color.multiplyScalar(0.22);
        if (m && m.emissive) m.emissive.multiplyScalar(0.08);
        if (m) { m.transparent = false; m.opacity = 1; m.needsUpdate = true; }
        return m;
      }
      o.material = Array.isArray(o.material) ? o.material.map(charOne) : charOne(o.material);
    });
  }

  // The fireball ending. An adopted external airframe becomes a persistent,
  // non-boardable wreck; it must never ride the normal F-exit path because that
  // path deliberately restores a pristine parked aircraft and its collider.
  function crashCraft(craft, impact) {
    if (!craft || craft.destroyed) return;
    const impactSpeed = Math.max(craft.speed || 0, Math.hypot(craft.vx || 0, craft.vy || 0, craft.vz || 0));
    craft.destroyed = true;
    const x = impact && impact.x != null ? impact.x : craft.pos.x;
    const y = impact && impact.y != null ? impact.y : craft.pos.y;
    const z = impact && impact.z != null ? impact.z : craft.pos.z;
    const heavy = craft.airClass === "airliner";
    const buildingHit = !!(impact && impact.collider && !aircraftColliderRef(impact.collider) &&
      ((impact.collider.y1 == null ? 18 : impact.collider.y1) - (impact.collider.y0 || 0)) > 2.5);
    const major = buildingHit && impactSpeed >= (heavy ? 24 : 30);
    const power = heavy ? 3.2 : 2.4, radius = heavy ? 18 : 13;
    if (CBZ.cityAirstrikeExplosion) { try { CBZ.cityAirstrikeExplosion(x, z, { power, radius, byPlayer: true, y }); } catch (e) {} }
    else if (CBZ.cityExplosion) { try { CBZ.cityExplosion(x, z, { power: heavy ? 2.7 : 2.0, radius: heavy ? 15 : 10, byPlayer: true, y }); } catch (e) {} }
    if (CBZ.cityShatter) { try { CBZ.cityShatter(x, z, radius + 5); } catch (e) {} }
    if (buildingHit && CBZ.cityDamageBuilding) {
      try {
        // One deep primary wound plus neighboring facade seats. A heavy
        // airliner does not leave a single bullet-sized scorch in a tower: its
        // nose/body/wing mass tears a broad, persistent structural scar.
        CBZ.cityDamageBuilding(x, y, z, heavy ? 4.4 : 3.0);
        if (major) {
          const rx = Math.cos(craft.heading || 0), rz = -Math.sin(craft.heading || 0);
          CBZ.cityDamageBuilding(x + rx * 2.4, y + 2.0, z + rz * 2.4, heavy ? 3.1 : 2.1);
          CBZ.cityDamageBuilding(x - rx * 2.4, Math.max(1, y - 1.8), z - rz * 2.4, heavy ? 2.8 : 1.9);
        }
      } catch (e) {}
    }
    if (CBZ.cityChunk) {
      try {
        const fx = Math.sin(craft.heading || 0), fz = Math.cos(craft.heading || 0);
        CBZ.cityChunk(x, y, z, { count: heavy ? 16 : 10, force: Math.min(16, 7 + impactSpeed * 0.08),
          dirx: fx, dirz: fz, color: 0x747b82 });
      } catch (e) {}
    }
    if (buildingHit && impactSpeed > 16 && CBZ.cityReportMajorIncident) {
      try { CBZ.cityReportMajorIncident(x, y, z, { kind: "aircraft-building-impact", severity: Math.min(2.5, (heavy ? 1.15 : 0.8) + impactSpeed / 70) }); } catch (e) {}
    }
    if (major && CBZ.cityCrime) {
      try { CBZ.cityCrime(260, { type: "catastrophic-aircraft-impact", x: x, z: z, instant: true }); } catch (e) {}
      if (CBZ.cityForceStars) { try { CBZ.cityForceStars(5); } catch (e) {} }
    }
    if (CBZ.cityCrashSmoke) {
      try {
        CBZ.cityCrashSmoke(x, y, z); CBZ.cityCrashSmoke(x - 1.2, y + 0.5, z + 0.8);
        if (heavy) CBZ.cityCrashSmoke(x + 2.4, y + 1.1, z - 1.6);
      } catch (e) {}
    }
    if (CBZ.shake) { try { CBZ.shake(heavy ? 1.8 : 1.2); } catch (e) {} }
    craft.hp = 0;
    craft.vx = craft.vy = craft.vz = 0;

    const P = CBZ.player;
    if (P && P._aircraft === craft) {
      P.driving = false; P._aircraft = null;
      // Put the pilot beside the impact on the real surface; the blast itself
      // decides whether they survive. Never bury them in the fuselage/wall.
      const side = heavy ? 7 : 3.5;
      const px = craft.pos.x + Math.cos(craft.heading) * side;
      const pz = craft.pos.z - Math.sin(craft.heading) * side;
      const gy = floorY(px, pz);
      P.pos.set(px, gy, pz); P.vy = 0; P.grounded = true;
      if (CBZ.playerChar && CBZ.playerChar.group) {
        CBZ.playerChar.group.visible = !P.dead;
        CBZ.playerChar.group.position.copy(P.pos);
      }
    }

    if (craft.externalGroup && craft.sourceRec) {
      const rec = craft.sourceRec;
      rec.destroyed = true; rec.taken = true; rec.hot = false;
      rec.hijackable = false; rec.hp = 0;
      detachPropCollider(rec);
      if (rec.group && rec.group.userData) {
        rec.group.userData.craft = null;
        rec.group.userData.destroyed = true;
        rec.group.userData.hijackable = false;
        rec.group.userData.milKind = null;
        const cabin = rec.group.userData.cabin && rec.group.userData.cabin.passengerCabin;
        if (cabin) { cabin.state = "destroyed"; cabin.active = false; }
      }
      charAircraftWreck(rec.group || craft.group);
      // A little final list/roll keeps a dead hull from reading as a pristine
      // airliner paused in mid-flight while the impact fire burns.
      const wingTorque = impact && impact.part === "left-wing" ? 0.34 : impact && impact.part === "right-wing" ? -0.34 : 0;
      craft.roll += (heavy ? 0.28 : 0.42) + wingTorque;
      craft.pitch -= (heavy ? 0.10 : 0.18) + Math.min(0.18, impactSpeed * 0.002);
      setCraftRotation(craft, craft.pitch, craft.heading, craft.roll);
      if (stolenAir === craft) stolenAir = null;
    } else if (heli === craft) { disposeGroup(heli.group); heli = null; placeHeli(); }
    else if (jet === craft) { disposeGroup(jet.group); jet = null; placeJet(); }
    else { disposeGroup(craft.group); if (stolenAir === craft) stolenAir = null; }
  }
  // Shared crash entry for disasters/tests and other city systems: it always
  // routes through the same persistent-wreck transition as a physical impact.
  CBZ.cityCrashPlayerAircraft = function (impact) {
    const craft = _aircraftFlying();
    if (!craft || craft.destroyed) return false;
    crashCraft(craft, impact || { x: craft.pos.x, y: craft.pos.y, z: craft.pos.z });
    return true;
  };

  // ---- V2 FIXED-WING (jet / private jet / airliner share the math, the
  // per-class WING_V2 row is the personality) --------------------------------
  function flyWingV2(craft, dt) {
    const k = CBZ.keys || {};
    const C = WING_V2[craft.airClass] || WING_V2.jet;
    const authority = controlAuthority(craft);
    if (craft.thr == null) craft.thr = (craft.kind === "jet" && !craft.civilian) ? 0.35 : 0;
    if (craft.airspeed == null) craft.airspeed = craft.speed || 0;

    // throttle 0..1, ~1.6s idle→firewall sweep
    let thr = 0;
    if (k["w"]) thr += 1;
    if (k["s"]) thr -= 1;
    craft.thr = Math.max(0, Math.min(1, craft.thr + thr * 0.6 * dt));

    // ground state off the cached landing surface (terrain or rooftop) —
    // measured against the craft's REST height (owned craft park GROUND_PAD
    // above the floor, so a raw belly-AGL test would never read "down")
    const gy = floorY(craft.pos.x, craft.pos.z);
    const surfY = craft._roof == null ? gy : Math.max(gy, craft._roof);
    const restY = surfY + (craft.groundOffset != null ? craft.groundOffset : craft.belly + GROUND_PAD);
    const agl = Math.max(0, craft.pos.y - restY);
    craft.onGround = agl < 0.3;

    // ---- airspeed: engine vs drag, climb bleeds / dive regains ----
    const engine = craft.thr * C.thrust;
    const drag = C.dragK * craft.airspeed * craft.airspeed;
    craft.airspeed += (engine - drag) * dt;
    craft.airspeed -= C.bleed * Math.sin(craft.pitch || 0) * dt;
    if (craft.onGround) {
      craft.airspeed -= 2.2 * dt;                          // rolling friction
      if (thr < 0) craft.airspeed -= C.gacc * 0.6 * dt;    // wheel brakes on S
      // PARKING DEADBAND: with no throttle a slow rollout snaps dead still —
      // a parked/idle plane must never creep or dither on its own
      if (thr <= 0 && craft.airspeed < 0.6) craft.airspeed = 0;
    }
    craft.airspeed = Math.max(0, Math.min(C.vmax * 1.05, craft.airspeed));

    // ---- bank → coordinated turn (A/D), auto-level hands-off ----
    let bank = 0;
    if (k["a"]) bank += 1;
    if (k["d"]) bank -= 1;
    if (bank !== 0 && !craft.onGround) {
      const targetRoll = bank * C.rollMax * authority;
      craft.roll = (craft.roll || 0) + (targetRoll - craft.roll) * Math.min(1, dt * C.rollRate);
    } else {
      craft.roll = (craft.roll || 0) * Math.max(0, 1 - C.autoLevel * dt);
    }
    craft.roll = Math.max(-C.rollMax, Math.min(C.rollMax, craft.roll));
    let pitchComp = 0;
    if (!craft.onGround && craft.airspeed > C.vminfly) {
      const vGate = Math.min(1, craft.airspeed / C.vmax);
      craft.heading += C.turnK * Math.sin(craft.roll) * (0.4 + 0.6 * vGate) * authority * dt;
      pitchComp = 0.10 * Math.abs(Math.sin(craft.roll));   // hold the nose through the bank
    } else if (craft.onGround && craft.airspeed > 0.5) {
      // nosewheel steering — sharper when slow, washing out toward Vr
      craft.heading += bank * 0.9 * Math.min(1, craft.airspeed / C.vr) * dt;
    }
    // mouse look still eases the nose toward where you're looking (airborne)
    if (CBZ.cam && !craft.onGround) {
      const camHeading = CBZ.cam.yaw + Math.PI;
      let dh = camHeading - craft.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      craft.heading += dh * Math.min(1, dt * 1.6) * authority;
    }

    // ---- pitch: SPACE/CTRL attitude command; can't rotate before Vr ----
    let climb = 0;
    if (k[" "]) climb += 1;
    if (k["control"] || k["shift"]) climb -= 1;
    const targetPitch = (craft.onGround && craft.airspeed < C.vr)
      ? 0
      : climb * C.pitchMax * authority + pitchComp;
    craft.pitch = (craft.pitch || 0) + (targetPitch - craft.pitch) * Math.min(1, dt * C.pitchRate);
    craft.pitch = Math.max(-C.pitchMax, Math.min(C.pitchMax, craft.pitch));

    // ---- stall: under Vstall the wing can't hold the nose — it drops and
    // the roll wallows; recovers the instant speed returns ----
    craft.stalled = !craft.onGround && craft.airspeed < C.vstall && agl > 2;
    if (craft.stalled) {
      craft.pitch += (-0.5 - craft.pitch) * Math.min(1, dt * 1.2);
      craft.roll *= Math.max(0, 1 - 0.5 * dt);
    }

    // ---- gravity sag: builds whenever airspeed is under the lift band,
    // decays once flying speed returns — this is the sink you feel ----
    const liftFrac = craft.onGround ? 1
      : Math.max(0, Math.min(1, (craft.airspeed - C.vminfly) / Math.max(1, C.vstall - C.vminfly)));
    craft.sag = Math.min(25, (craft.sag || 0) + (1 - liftFrac) * 9.8 * dt);
    craft.sag *= Math.max(0, 1 - (0.8 + 3.2 * liftFrac) * dt);

    // ---- derive world velocity for the integrator ----
    const cp = Math.cos(craft.pitch);
    craft.vx = Math.sin(craft.heading) * cp * craft.airspeed;
    craft.vz = Math.cos(craft.heading) * cp * craft.airspeed;
    craft.vy = Math.sin(craft.pitch) * craft.airspeed - craft.sag;
    // ground effect: a floaty cushion right at the deck (reused shared curve)
    if (CBZ.aeroPhysics && !craft.onGround && agl < C.span * 1.25) {
      const gm = CBZ.aeroPhysics.groundEffectMul(Math.max(0, agl), C.span);
      if (gm > 1) craft.vy += (gm - 1) * 6;
    }
    craft.speed = craft.airspeed;
    craft.aoa = craft.stalled ? 24 : Math.abs(craft.pitch) * 12;

    // engine visuals: burner glow + throttle-driven plume off the V2 throttle
    const ud = craft.group.userData;
    if (ud.burn) ud.burn.scale.z = 1.2 + Math.sin(craft.rotorSpin += dt * 24) * 0.5 + (thr > 0 ? 0.6 : 0);
    powerJetPlumes(ud, 0.08 + craft.thr * 0.92, craft.rotorSpin, 1.55, 0.92);
    // legacy throttle field kept in the old m/s scale for HUD/exit paths
    craft.throttle = JET_MIN + craft.thr * (JET_MAX - JET_MIN);
  }

  // ---- V2 HELICOPTER: V1's torque/ETL/autorotation core, plus an eased
  // vertical command (the hover breathes), skid grip on the ground, rotor
  // spin-up, and a fuselage that visibly leans into its own velocity ----
  function flyHeliV2(craft, dt) {
    const k = CBZ.keys || {};
    const A = CBZ.aeroPhysics;
    const authority = controlAuthority(craft);
    craft.autorotating = craft.maxHp > 0 && (craft.hp / craft.maxHp) <= AUTOROTATE_AT;

    if (CBZ.cam) craft.heading = CBZ.cam.yaw + Math.PI;
    let yaw = 0;
    if (k["a"]) yaw += 1;
    if (k["d"]) yaw -= 1;
    let thr = 0;
    if (k["w"]) thr += 1;
    if (k["s"]) thr -= 1;
    let liftIn = 0;
    if (k[" "]) liftIn += 1;
    if (k["shift"] || k["control"]) liftIn -= 1;

    // torque / tail-rotor coupling (same model as V1 — pulling power fights
    // the pedals until you trim it out)
    const powerLoad = Math.max(0, liftIn) * 0.7 + Math.max(0, thr) * 0.3;
    const targetTorqueYaw = -powerLoad * HELI_TORQUE_GAIN;
    craft.torqueYaw = (craft.torqueYaw || 0) + (targetTorqueYaw - (craft.torqueYaw || 0)) * Math.min(1, dt * HELI_TORQUE_DAMP);
    if (CBZ.cam) CBZ.cam.yaw -= (yaw * HELI_YAW * authority + craft.torqueYaw) * dt;

    const fx = Math.sin(craft.heading), fz = Math.cos(craft.heading);
    craft.vx += fx * thr * HELI_THRUST * authority * dt;
    craft.vz += fz * thr * HELI_THRUST * authority * dt;

    // shared aero core: six-axis drag + ETL + ground effect (rooftop-aware AGL,
    // measured against the skids' REST height — see flyWingV2's note)
    const baseY = floorY(craft.pos.x, craft.pos.z);
    const groundY = craft._roof == null ? baseY : Math.max(baseY, craft._roof);
    const restY = groundY + (craft.groundOffset != null ? craft.groundOffset : craft.belly + GROUND_PAD);
    const agl = Math.max(0, craft.pos.y - restY);
    let etl = 1, groundMul = 1, aoaDeg = 0, stalled = false;
    if (A) {
      const local = A.localVelocity(craft.vx, craft.vy, craft.vz, craft.heading, craft.pitch || 0, craft.roll || 0);
      groundMul = A.groundEffectMul(agl, HELI_SPAN);
      etl = A.etlMul(Math.max(0, local.z), HELI_ETL_LO, HELI_ETL_HI);
      const aero = A.aeroForces(local, {
        liftScale: 0.0065, etl, groundMul,
        dragCoef: { px: 0.085, nx: 0.085, py: 0.06, ny: 0.06, pz: 0.018, nz: 0.11 },
      });
      aoaDeg = aero.aoaDeg; stalled = aero.stalled;
      const dragWorld = A.worldVelocity(aero.dragLocal.x, 0, aero.dragLocal.z, craft.heading, craft.pitch || 0, craft.roll || 0);
      craft.vx += dragWorld.x * dt;
      craft.vz += dragWorld.z * dt;
    }
    craft.vx *= Math.max(0, 1 - HELI_DRAG * dt * (thr ? 0.3 : 1));
    craft.vz *= Math.max(0, 1 - HELI_DRAG * dt * (thr ? 0.3 : 1));
    const hsp = Math.hypot(craft.vx, craft.vz);
    if (hsp > HELI_TOP) { const s = HELI_TOP / hsp; craft.vx *= s; craft.vz *= s; }

    craft.onGround = agl < 0.3;
    const vlift = HELI_VLIFT * authority * (0.85 + (etl - 0.85) + (groundMul - 1) * 0.6);
    if (craft.autorotating) {
      // engine out: capped sink, flare near the deck (unchanged from V1)
      const flareT = agl < FLARE_HEIGHT ? 1 - agl / FLARE_HEIGHT : 0;
      const targetSink = -AUTOROTATE_SINK + flareT * (AUTOROTATE_SINK - FLARE_SINK) * Math.max(0, liftIn);
      craft.vy += (targetSink - craft.vy) * Math.min(1, dt * 3);
    } else {
      let targetVy = liftIn * vlift;
      // hover bob: the disc breathes when you're off the collective in the air
      if (!liftIn && !craft.onGround) targetVy += Math.sin(craft.rotorSpin * 0.22) * 0.35;
      craft.vy += (targetVy - craft.vy) * Math.min(1, dt * HELI_VDAMP);
    }
    // skids grip: a heli sitting on its skids doesn't ice-skate
    if (craft.onGround && liftIn <= 0) {
      const s = Math.max(0, 1 - 6 * dt);
      craft.vx *= s; craft.vz *= s;
    }

    // visual attitude: lean into the body-frame velocity (cyclic read), bank
    // with pedal input AND into mouse-steered turns, nose-over on a disc stall
    let tp = -thr * 0.10 + (stalled ? -0.22 : 0);
    let trl = yaw * 0.18;
    // bank into the turn: the mouse IS the heli's steering, so read the
    // heading RATE and roll into it (purely visual — roll drives nothing on
    // the heli, so there's no feedback loop), scaled by forward speed
    if (dt > 0.0001) {
      let dh = craft.heading - (craft._lastHeading != null ? craft._lastHeading : craft.heading);
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      const hRate = Math.max(-3, Math.min(3, dh / dt));
      // sign matches the pedal pairing: V1 rolls +0.22 with A (which yaws the
      // heading NEGATIVE-ward via cam.yaw), so a negative heading rate = the
      // same positive roll
      trl += Math.max(-0.3, Math.min(0.3, -hRate * 0.12)) * Math.min(1, hsp / 12);
    }
    craft._lastHeading = craft.heading;
    if (A) {
      const lv = A.localVelocity(craft.vx, 0, craft.vz, craft.heading, 0, 0);
      tp += Math.max(-HELI_TILTMAX, Math.min(HELI_TILTMAX, -lv.z * HELI_TILT_K));
      trl += Math.max(-HELI_TILTMAX, Math.min(HELI_TILTMAX, lv.x * HELI_TILT_K));
    }
    craft.pitch = (craft.pitch || 0) + (tp - craft.pitch) * Math.min(1, dt * 4);
    craft.roll = (craft.roll || 0) + (trl - craft.roll) * Math.min(1, dt * 4);

    // rotor spin-up/down: the commanded rate is eased, so lifting off from
    // cold visibly winds the disc up and settling down lets it sigh back
    const wantRate = craft.autorotating ? 18 : (craft.onGround && !liftIn && !thr ? 10 : 30);
    if (craft.rotorRate == null) craft.rotorRate = wantRate;
    craft.rotorRate += (wantRate - craft.rotorRate) * Math.min(1, dt * 0.9);
    spinRotors(craft, dt, craft.rotorRate);
    craft.speed = hsp;
    craft.aoa = aoaDeg; craft.stalled = stalled;
  }

  // ---- V2 integrator: rooftop-aware ground clamp, wall strikes, touchdown
  // judgement (slam/nose-first = crash), gear + prop-spin animation hooks ----
  function integrateV2(craft, dt) {
    const wasAir = !craft.onGround;
    const sweepFrom = craft._sweepFrom || (craft._sweepFrom = new THREE.Vector3());
    const attempted = craft._sweepAttempt || (craft._sweepAttempt = new THREE.Vector3());
    sweepFrom.copy(craft.pos);
    craft.pos.x += craft.vx * dt;
    craft.pos.y += craft.vy * dt;
    craft.pos.z += craft.vz * dt;
    attempted.copy(craft.pos);
    const airframeHit = sweptAirframeImpact(craft, sweepFrom, attempted);
    if (airframeHit && resolveAirframeImpact(craft, sweepFrom, attempted, airframeHit)) return;
    // landing surface: terrain OR the tallest rooftop under us (throttled scan)
    craft._surfT = (craft._surfT || 0) - dt;
    if (craft._surfT <= 0) { craft._surfT = 0.12; craft._roof = roofUnder(craft); }
    const gy = floorY(craft.pos.x, craft.pos.z);
    const surfY = craft._roof == null ? gy : Math.max(gy, craft._roof);
    const minY = surfY + (craft.groundOffset != null ? craft.groundOffset : craft.belly + GROUND_PAD);
    if (craft.pos.y < minY) {
      const sink = -(craft.vy || 0);
      if (craft.kind === "heli") {
        // hard landing: flaring the collective near the deck is a real skill
        if (sink > FLARE_SINK * 1.6) damageCraft(craft, Math.min(60, (sink - FLARE_SINK) * 4));
      } else if (wasAir) {
        const td = touchdownRisk(sink, craft.pitch || 0);
        craft.lastTouchdown = { sink, pitch: craft.pitch || 0, severity: td.severity, crashChance: td.chance };
        if (td.chance > 0 && touchdownRoll() < td.chance) { crashCraft(craft); return; }
        if (td.damage > 0) damageCraft(craft, td.damage);
        craft.pitch = Math.max(0, craft.pitch || 0) * 0.3;
        craft.sag = 0;
      }
      craft.pos.y = minY;
      if (craft.vy < 0) craft.vy = 0;
      craft.onGround = true;
    }
    if (craft.pos.y > CEILING) { craft.pos.y = CEILING; if (craft.vy > 0) craft.vy = 0; }
    const ud = craft.group.userData;
    if (ud && ud.gear) ud.gear.visible = (craft.pos.y - surfY) < 9;
    // prop-spin hook: any craft whose builder tags a spinner (userData.prop,
    // spins about local Z) gets throttle-proportional prop animation for free
    if (ud && ud.prop) ud.prop.rotation.z += dt * (6 + 55 * (craft.thr || 0));
    clampToAirspace(craft, 2.0);
    craft.group.position.set(craft.pos.x, craft.pos.y, craft.pos.z);
    setCraftRotation(craft, craft.pitch || 0, craft.heading, craft.roll || 0);
  }

  CBZ.onUpdate(12, function (dt) {
    if (g.mode !== "city") return;
    // idle rotor spin for a parked-but-owned heli (it reads as "ready" — slow
    // enough that spinRotors keeps the blur disc fully faded out)
    if (heli && _aircraftFlying() !== heli && heli.group) spinRotors(heli, dt, 6);
    const P = CBZ.player;
    const craft = P && P._aircraft;
    if (!craft || P.dead) {
      // dead while flying → eject so death.js takes over on the ground. A hot
      // stolen jet is lost on death (exitAircraft despawns it).
      if (craft && P && P.dead) exitAircraft();
      return;
    }
    if (craft.fireCD > 0) craft.fireCD = Math.max(0, craft.fireCD - dt);
    if (flightV2()) {
      if (craft.kind === "heli") flyHeliV2(craft, dt); else flyWingV2(craft, dt);
      integrateV2(craft, dt);
      // a wall strike / slammed touchdown crashed the craft this frame —
      // crashCraft already ran exitAircraft, so the pilot owns the transform
      if (craft.destroyed || !P._aircraft) return;
    } else {
      if (craft.kind === "jet") flyJet(craft, dt); else flyHeli(craft, dt);
      integrate(craft, dt);
    }
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
    if (CBZ.cam && craft.kind === "jet" && CBZ.lerpAngle && !(CBZ.camRecenterSuspended && CBZ.camRecenterSuspended())) {
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
      "background:rgba(8,12,18,0.48);padding:4px 9px;border-radius:7px;border:1px solid rgba(120,180,255,0.20);" +
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
    const warning = craft.autorotating ? "  ⚠↻" : (craft.stalled ? "  ⚠↘" : "");
    // Instrument grammar, not a sentence: altitude, speed, ordnance, integrity.
    // No craft-name/ALT/SPD/MISSILES/HP label wall across the playfield.
    el.textContent = "↥" + alt.toFixed(0) + "m  ›" + (craft.speed || 0).toFixed(0) +
      (craft.armed === false ? "" : "  ◉" + craft.ammo + "/" + craft.maxAmmo) +
      "  ♥" + hpPct + "%" + warning;
  }
  function hideHud() { if (_hudEl) _hudEl.style.display = "none"; }

  // A tiny icon-only proximity affordance. Boarding still uses the normal
  // interaction key, but no control legend or mission prose floats in-world.
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
    // touch: the glyph becomes a BOARD pill (desktop keeps the bare "✈")
    if (c) { showPrompt(CBZ.touchActionPrompt ? CBZ.touchActionPrompt("@cityAircraftBoardNearest", "BOARD ✈", "✈") : "✈"); return; }
    // A correct, in-place note ONLY when you're standing AT a hangar you OWN
    // (penthouse deck OR the airport Private Hangar) but haven't bagged the jet
    // yet — it tells you the next step. No persistent nag for the unowned case:
    // the way to GET a hangar lives in the [P] phone / [G] storage menu, not a
    // sticky on-screen prompt.
    if (!g.cityOwnsJet && atHangar(x, z) && ownsAnyHangar()) {
      showPrompt("◌");
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
        if (stolenAir.sourceRec && stolenAir.sourceRec.destroyed) {
          detachPropCollider(stolenAir.sourceRec);
          stolenAir.sourceRec.taken = true;
          if (stolenAir.group && stolenAir.group.userData) stolenAir.group.userData.craft = null;
        } else if (stolenAir.group && stolenAir.group.parent && stolenAir.sourceRec) {
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
