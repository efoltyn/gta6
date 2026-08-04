/* ============================================================
   city/strategic.js — STRATEGIC WEAPONS (part 2): the B-2, the
   bunker-buster, and the nuke. Partner file to city/bunkers.js.

   WHY ONE LAYER, NOT THREE BOLT-ONS (owner mandate): the pieces chain —
   the military bunker's vault holds the one PORTABLE nuclear stash (drawn
   as three warheads on a handling rack; taken, carried and used as ONE
   device) and its armory stocks the bunker-busters; every B-2 also carries
   three flight-only nuclear weapons. The B-2 on the Fort Brandt apron is
   the delivery platform; the buster is the only weapon that
   kills THROUGH a bunker roof, which matters because an intact bunker is
   the only thing that shelters you from the nuke. Steal the bomber, raid
   the vault, and the end of the world is a payload switch away.

   TWO ROUTES TO A DETONATION, and they converge on the same row:
     AIR    — load the bay, fly, release. The weapon is a real gravity bomb
              (CBZ.nukeWarhead) that tumbles off the ejector, settles
              nose-down, and — when the free fall would not already give the
              bomber its escape — STREAMS A RIBBON PARACHUTE, which is the
              actual B61 delivery rule. See the retardFor block for the
              arithmetic and the measured table.
     GROUND — plant it, run a three-beat ARMING sequence, then a 90 s clock
              solved against the distance a player can actually cover (see
              NK). The escape IS the mission and the answer is a vehicle.
   Both end in nukeDetonate() -> CBZ.detonate(.., "nuke") -> the bus, so the
   spectacle, the wave, the ledger and the consequences are one path.

   THE B-2: a chunky voxel flying wing (sawtooth trailing edge, no tail)
   parked on the military apron. It registers through the EXISTING
   military-hardware seam (CBZ.cityRegisterMilitaryVehicle) and therefore
   inherits, with zero new plumbing: the boarding interaction + heat
   (militaryvehicles.js), the aircraft_doors boarding arc (a real belly
   hatch eases open off rec._doorArcOpen — the same flag the airliner
   panels ride), lock-on targetability (lockon.js sweeps
   cityMilitaryVehicles), and the fly-the-ACTUAL-prop flight path
   (playeraircraft.js spawnFlyableFromProp). Its heavy/stable feel comes
   from stamping the spawned craft onto the existing "airliner" WING_V2
   row (fast, stately, hard-to-flick) — a deliberate reuse instead of
   editing the flight-model file mid-flight-feel-work by another agent.

   ORDNANCE PATHS — THE BUS (systems/impactbus.js). This file used to
   hand-roll four separate detonation fan-outs (a bomb's explosion+
   shatter, the buster's three-way verdict, the nuke's scheduled ring of
   blasts, the nuke's rolling demolition sweep). They are GONE. Every
   detonation here is now exactly one call:

       CBZ.detonate(x, y, z, "bomb" | "jdam" | "buster" | "nuke", opts)

   The bus owns the fan-out (FX composer, shake/rumble/whiteout, the
   propagating blast WAVE, and the structural ledger in city/structural.js
   which is what finally makes buildings genuinely suffer: penetration,
   fire, load-path failure, a real pancake collapse). What this file still
   owns is what only it knows: what was dropped, from where, by whom, and
   the consequences that are not blast (crime/stars, the bunker shelter
   guarantee, the lingering radiation zone, and portable-device planting).
   NEW ORDNANCE IS A TABLE ROW — "buster" is defined via
   CBZ.impact.define() below, with a high `pen` so it punches through the
   roof and detonates INSIDE, which is exactly what `pen` models.

   THE B-2 IS A REAL BOMBER: tap [B] to release one, HOLD [B] to walk a
   CARPET of bombs along the flight path (stagger = release interval x
   ground speed). The run is a public seam — CBZ.strategicBombRun(opts) /
   CBZ.strategicBombRunState() / CBZ.strategicOnBombRun — so the mission
   layer can hang "bomb the city" off it without touching this file. With no
   B-2 in the air the SAME seam flies a CALLED sortie off-map
   (CBZ.strategicCallStrike), which is what the bunker's map table tasks.
   [X] cycles the payload: Mk-84 · JDAM · GBU bunker buster · nuclear weapon.

   BALLISTICS ARE SOLVED, NOT INTEGRATED. y(t) = y0 + vy t - 1/2 g t^2 and the
   landing time is the positive root of the quadratic, so a round's impact
   POINT, TIME and SPEED are all known the instant it leaves the bay. That one
   change is what makes the carpet-walk dust land with the craters, lets an
   over-cap release snap straight to its end state instead of queueing, and
   gives the bunker-buster a real impact velocity to be priced by. Rounds are
   released with the AIRCRAFT'S OWN velocity (craft.vx/vy/vz), which is why
   they lead the target instead of dropping behind you. The JDAM's target
   acquisition is still lockon.js's CBZ.lockonMissileSeek — the ONE targeting
   system — but its flight is a bent parabola re-solved onto the aimpoint a
   few times a second, because a JDAM steers to a point; it does not chase.

   An INTACT bunker (bunkers.js) still shelters anyone inside a nuke; a
   breached one does not. Max wanted via the military-reason star API. NO
   new HUD element — the flight strip carries the bomb-camera tally, the killfeed
   carries individual deaths, and the flash/cloud are world FX.

   DETERMINISM: placement/build = hash01 only. Combat-time FX = runtime,
   Math.random allowed (same rule the C4/grenade paths follow). New FX
   materials are PARKED invisible in the scene at load so core/fxwarm's
   renderer.compile prewarms them (no first-nuke shader freeze).

   FLAGS: CBZ.CONFIG.STRAT_B2 / STRAT_BUNKER_BUSTER / STRAT_NUKE — each
   independently one-line revertible. Plain IIFE, THREE r128.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.STRAT_B2 == null) CBZ.CONFIG.STRAT_B2 = true;
  if (CBZ.CONFIG.STRAT_BUNKER_BUSTER == null) CBZ.CONFIG.STRAT_BUNKER_BUSTER = true;
  if (CBZ.CONFIG.STRAT_NUKE == null) CBZ.CONFIG.STRAT_NUKE = true;
  /* ---- THE NUCLEAR REDRAW (2026-07-28). Both are also declared in
     config.js; the `== null` idiom is idempotent, so whichever file the page
     loads first wins and this module still degrades on its own. ---------- */
  // NUKE_FX_V2 — the weapon AS SEEN. In this file: the real gravity-bomb
  // body (CBZ.nukeWarhead — ogive nose, boat-tail, cruciform fins, arming
  // band), the release tumble that settles nose-down, and the RETARDED FALL
  // with its streamed ribbon parachute (see the retardFor block). false =>
  // the generic 2.4 m drum on a plain parabola, exactly as before.
  if (CBZ.CONFIG.NUKE_FX_V2 == null) CBZ.CONFIG.NUKE_FX_V2 = true;
  // NUKE_GROUND_COUNTDOWN — the planted device runs a three-beat ARMING
  // sequence and then a clock derived from the escape distance (see NK).
  // false => the flat 45 s timer with no arming beat.
  if (CBZ.CONFIG.NUKE_GROUND_COUNTDOWN == null) CBZ.CONFIG.NUKE_GROUND_COUNTDOWN = true;
  // HOLD-[B] carpet bombing. false => [B] is a single release exactly as
  // before (one-line revert of the whole run machinery).
  if (CBZ.CONFIG.STRAT_BOMB_RUN == null) CBZ.CONFIG.STRAT_BOMB_RUN = true;
  // The guided bomb payload. false => the payload cycle skips it and the
  // B-2 carries dumb iron only.
  if (CBZ.CONFIG.STRAT_JDAM == null) CBZ.CONFIG.STRAT_JDAM = true;
  // Engine fire when the player is at the throttle (owner: "no fire comes out
  // the back"). false => cold trenches exactly as before.
  if (CBZ.CONFIG.STRAT_B2_PLUME == null) CBZ.CONFIG.STRAT_B2_PLUME = true;
  // THE ORDNANCE READOUT on the flight strip + the switch headline. false =>
  // the payload state is invisible again, exactly as it shipped. See the long
  // note above drawPayloadHud() for WHY a toast could never have worked.
  if (CBZ.CONFIG.STRAT_PAYLOAD_FEEDBACK == null) CBZ.CONFIG.STRAT_PAYLOAD_FEEDBACK = true;
  // HOLD-[C] B-2 bomb camera. The shared camera remains the sole transform
  // writer; this module only publishes the moving shot target.
  if (CBZ.CONFIG.STRAT_BOMB_CINEMATIC == null) CBZ.CONFIG.STRAT_BOMB_CINEMATIC = true;

  function h01(x, z, s) { return CBZ.hash01 ? CBZ.hash01(x, z, s) : 0.5; }
  function cm(hex, opts) { return CBZ.cmat ? CBZ.cmat(hex, opts) : (CBZ.mat ? CBZ.mat(hex, opts) : new THREE.MeshLambertMaterial({ color: hex })); }
  function bg(w, h, d) { return CBZ.boxGeom ? CBZ.boxGeom(w, h, d) : new THREE.BoxGeometry(w, h, d); }
  // `opts` is NOT optional decoration: city/mode.js's note() runs every string
  // through phoneWorthy(), which returns FALSE for anything without a named
  // in-world sender unless it happens to match its money/danger vocabulary. An
  // unsigned "Payload: Mk-84 bombs (16)" is deleted at that chokepoint and
  // never reaches any surface at all. {from, app} is what makes it a delivery.
  function note(m, s, opts) { if (CBZ.city && CBZ.city.note) { try { CBZ.city.note(m, s, opts); } catch (e) {} } }
  function sfx(n, o) { if (CBZ.sfx) { try { CBZ.sfx(n, o); } catch (e) {} } }

  /* ---- THE ORDNANCE BUS ---------------------------------------------------
     One verb for every detonation in this file. `ensureRows()` registers the
     ONE warhead the shared table did not already carry (the bunker buster);
     everything else — bomb, jdam, nuke — is already a row in
     systems/impactbus.js and needs no code here at all.

     DEGRADE-SAFE (BLOCK LAW rule 2): with no bus loaded, detonate() falls
     back to the exact inline cityExplosion call this file made before the
     migration, so a partial load can never leave a bomb silent.            */
  const LEGACY_BLAST = {                       // the pre-bus numbers, verbatim
    bomb:   { power: 2.3, radius: 11 },
    jdam:   { power: 2.6, radius: 12 },
    buster: { power: 3.0, radius: 13 },
    nuke:   { power: 3.0, radius: 14 },
  };
  /* ---- ORDNANCE MASS + THE KINETIC LAW ------------------------------------
     Real ordnance, real kilograms. Mk-84 2000 lb = 925 kg carrying ~429 kg of
     tritonal (~1.8e9 J of CHEMISTRY); a GBU-31 is that same Mk-84 plus a ~45 kg
     tail kit; a GBU-28-class penetrator is 2130 kg.

     WHERE MOTION MATTERS AND WHERE IT DOES NOT. A general-purpose bomb's
     damage is its FILLER, not its fall — 1.8e9 J of explosive against maybe
     2e7 J of impact energy, two orders apart — so the `bomb`/`jdam` rows in
     systems/impactbus.js correctly declare refE 0 and ignore mass/speed. We
     still pass {mass, speed} to them: with refE 0 that is INERT today (the
     multiplier is exactly 1, byte-identical behaviour) and becomes free the
     day the bus prices them. Handing a neighbour honest data it does not
     consume yet is the degrade-safe way to do this.

     THE BUNKER BUSTER IS THE EXCEPTION AND IT IS THE WHOLE POINT. A kinetic
     penetrator's terminal effect genuinely is its motion: its depth into
     concrete scales with impact VELOCITY (Young's), and E goes as v², so
     depth goes as sqrt(E). Release it low and slow and it dents the berm;
     release it fast and high and it opens a command shelter. That is a real
     skill the player can learn, expressed as one row field and one square
     root — not a code path.                                                */
  const MASS = { bomb: 925, jdam: 970, buster: 2130, nuke: 4400 };
  const BUSTER_REF_E = 3.4e7;      // 2130 kg arriving at ~180 m/s — a NOMINAL release
  const BUSTER_PEN_CE = 6.0;       // GBU-28's published ~6 m of reinforced concrete, at refE

  let _rowsDone = false;
  function ensureRows() {
    if (_rowsDone) return;
    const I = CBZ.impact;
    if (!I || !I.define || !I.row) return;      // bus not loaded yet — retry next tick
    _rowsDone = true;
    // GBU-57. What makes a bunker buster a bunker buster is not its blast —
    // it is PENETRATION: it does not stop at the roof or the berm, it carries
    // its energy to depth and detonates there. `pen` is precisely that model
    // (exponential energy decay, damage deposited across the floors it passes
    // through, the leftover blowing out the far side), so the weapon is a ROW,
    // not a code path. `refE` is the other half: the row's numbers are quoted
    // AT a nominal release and the bus scales FX by (E/refE)^1/3 and structure
    // by (E/refE)^2/3 from there. kmax 2.6 keeps a 600 m full-throttle release
    // meaningful without letting altitude alone turn it into a nuke.
    if (!I.row("buster")) I.define("buster", {
      power: 3.4, radius: 14, struct: 13, pen: 40, fire: 0.25,
      fx: "heavy", quake: 1.8, sfx: "rumble",
      refE: BUSTER_REF_E, kmin: 0.5, kmax: 2.6,
    });
  }
  ensureRows();
  // Impact kinetic energy in joules. Asks the BUS (CBZ.impact.kinetic) rather
  // than re-deriving 1/2mv^2 — one arithmetic, one place — and falls back to
  // the arithmetic only if the bus is absent.
  function energyOf(kind, speed) {
    const m = MASS[kind] || MASS.bomb;
    if (CBZ.impact && CBZ.impact.kinetic) {
      try { return CBZ.impact.kinetic(m, speed).E || 0; } catch (e) {}
    }
    return (speed > 0 ? 0.5 * m * speed * speed : 0);
  }
  // Concrete-equivalent penetration, metres, of a buster arriving at `speed`.
  // depth ∝ v ⇒ depth ∝ sqrt(E). Clamped so a degenerate speed can never hand
  // bunkers.js an absurd verdict.
  function busterPenCE(speed) {
    const E = energyOf("buster", speed);
    if (!(E > 0)) return BUSTER_PEN_CE;
    return BUSTER_PEN_CE * Math.sqrt(Math.max(0.09, Math.min(9, E / BUSTER_REF_E)));
  }
  // who gets the blame — the kill bus + city/structural.js's onCollapse seam
  // both key off this, which is how a mission can ask "did the PLAYER level
  // that block?" without any extra bookkeeping.
  function who() { return (CBZ.city && CBZ.city.playerActor) || CBZ.player || null; }
  function detonate(x, y, z, kind, o) {
    ensureRows();
    o = o || {};
    if (o.by === undefined) o.by = who();
    if (CBZ.detonate) { try { return CBZ.detonate(x, y, z, kind, o); } catch (e) { return null; } }
    const L = LEGACY_BLAST[kind] || LEGACY_BLAST.bomb;
    if (CBZ.cityExplosion) {
      try {
        const op = { power: L.power, radius: L.radius, byPlayer: !!o.byPlayer };
        if (y > 3) op.y = y;
        CBZ.cityExplosion(x, z, op);
      } catch (e) {}
    }
    return null;
  }

  // ---- payload items live in the one city economy (explosives.js idiom:
  // register here, retry if the economy rebuilds; NOT in any shop stock —
  // these are found in bunkers, never bought). ----
  function ensureItems() {
    const e = CBZ.cityEcon;
    if (!e || !e.ITEMS) return false;
    if (!e.ITEMS["Bunker Buster"]) e.ITEMS["Bunker Buster"] = { value: 12000, tag: "ordnance", ordnance: true };
    if (!e.ITEMS["Nuclear Device"]) e.ITEMS["Nuclear Device"] = { value: 250000, tag: "ordnance", ordnance: true };
    return true;
  }
  ensureItems();
  function invCount(n) { const e = CBZ.cityEcon; return e && e.count ? e.count(n) : 0; }
  function invTake(n) { const e = CBZ.cityEcon; return !!(e && e.take && e.take(n, 1)); }
  function invAdd(n) { const e = CBZ.cityEcon; if (e && e.add) e.add(n, 1); }

  /* ==========================================================================
     1) THE B-2 — model, placement, registration, hatch, feel stamp, bay.
  ========================================================================== */

  // Vehicle-material wrapper. The SECOND argument is the COLOUR and it must be
  // forwarded — island_military.js documents what happens when a vmat swallows
  // its hex: every canopy in the world wears whatever tint the first vehicle
  // built happened to ask for. Glass goes through the role so the cockpit reads
  // as the same see-through pane the rest of the fleet got.
  function vmat(role, hex, opts) {
    if (CBZ.vehicleMat) {
      try { const m = CBZ.vehicleMat(role, hex, opts); if (m && m.isMaterial) return m; } catch (e) {}
    }
    return cm(hex != null ? hex : 0x2b2f35, opts);
  }

  // Palette matched to the owner's two reference photos (2026-07-27): from
  // three-quarter the real ship is a LIGHT blue-grey with the intake fairings
  // in the SAME family as the skin (they read as swells, not fittings); from
  // below it is one near-black arrowhead. So: top up, belly down, panel only
  // one step above skin.
  const B2C = {
    skin: 0x3a434d, skinD: 0x22262c, belly: 0x17191d, panel: 0x434c57,
    glass: 0x2a3b4d, gear: 0x3a3f46, tire: 0x14161a,
    deck: 0x0e1216, instr: 0x0c1a1c,
  };

  /* ==========================================================================
     THE PLANFORM — read off b2code.html, which is the real aeroplane.

     OWNER: "look at the html exact of b2 that i put in your codebase look at
     that to improve our b2." The old build was a 8.4 m box body with two slab
     wings bolted to its flanks and two chunky teeth per side standing in for
     the sawtooth. Measured, that read as a fuselage with wings: span 44 on a
     21 m length, ratio 2.10, against the real B-2A's 52.4 / 21.0 = 2.50. A
     flying wing has NO fuselage — the body IS the wing, one continuous lofted
     surface from tip to tip, and that is what you cannot fake with boxes.

     So the airframe is now a real LOFT, and every number in it comes from the
     reference rather than from taste:
       • LE sweep 16.6/26.2 = 33 deg, the B-2's actual leading edge.
       • The trailing edge is the double-W: five breakpoints per side, which is
         where the sawtooth comes from. It is not drawn as teeth — it falls out
         of the planform, so it is crisp at every station and it is crisp from
         every angle. B2_TE stations are placed ON the breakpoints so a
         piecewise-linear edge is EXACT no matter how coarsely we subdivide.
       • Thickness is the reference's gaussian centrebody plus a chord term —
         4.1 m deep at the root, a 0.14 m knife edge at the tip.
       • TSHAPE is the aerofoil: a t^0.42 (1-t)^0.95 curve normalised so its
         peak is exactly 1.0, so `thick` really is the thickness. 80% of it
         above the chord plane, 22% below — a flying wing is nearly flat
         underneath, which is why the belly reads as one plate.
       • The cockpit blister is the reference's second gaussian, windowed so it
         reaches ZERO at the leading edge (the reference leaves a 0.26 m crack
         at the apex there; ours closes).

     WHAT WE DO NOT COPY: the reference is airborne and has no gear, and its
     thickness runs 4.97 m through the centre. We scale thickness by 0.78 (to
     the real 3.7 m body) and then stand the aircraft 2.55 m up on real gear,
     because the player has to WALK UNDER THIS WING to reach the crew hatch and
     1.9 m of clearance is what makes that possible. That is the one place
     playability is bought with a centimetre of realism, and it is bought here
     rather than smeared through the shape.

     ONE SURFACE, THREE DRAW CALLS: an upper skin, a darker belly, and — the
     flight deck's whole trick — the quads over the cockpit re-emitted in GLASS
     instead of skin. The windscreen is therefore not a pane laid ON the hull;
     it is the piece of hull that was taken OUT, so it fits the curvature
     exactly and there is genuine air behind it (the loft is a hollow pillow:
     top sheet and bottom sheet meeting at the LE, the TE and the tips).
  ========================================================================== */
  const B2_HALF = 26.2;                        // HALF span; the aircraft is 52.4 wide
  const B2_SWEEP = 16.6 / 26.2;                // leading edge: cz = |x| * SWEEP
  const B2_APEX = 10.5;                        // model z of the nose apex (length 21 → ±10.5)
  const B2_CY = 2.55;                          // chord plane above the tarmac (gear height)
  const B2_TMUL = 0.78;                        // thickness scale: reference 4.97 m → real 3.88 m
  // (x, chord-station of the trailing edge). Forward at 6 and 17, aft at 0 and
  // 11 and the tip: that alternation IS the double-W.
  const B2_TE = [[0, 21.0], [6.0, 16.8], [11.0, 20.6], [17.0, 15.8], [26.2, 18.1]];
  function b2TE(x) {
    x = Math.abs(x);
    for (let i = 1; i < B2_TE.length; i++) {
      if (x <= B2_TE[i][0]) {
        const a = B2_TE[i - 1], b = B2_TE[i];
        return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
      }
    }
    return B2_TE[B2_TE.length - 1][1];
  }
  function b2LE(x) { return Math.abs(x) * B2_SWEEP; }
  function b2Chord(x) { return Math.max(0.35, b2TE(x) - b2LE(x)); }
  function b2Thick(x) {
    return (2.15 * Math.exp(-Math.pow(Math.abs(x) / 8.2, 2)) + 0.095 * b2Chord(x)) * B2_TMUL;
  }
  // the aerofoil, peak normalised to 1 at t = 0.42/(0.42+0.95) = 0.3066
  function b2Foil(t) {
    if (!(t > 0) || t >= 1) return 0;
    return Math.pow(t, 0.42) * Math.pow(1 - t, 0.95) / 0.4298;
  }
  // cockpit bulge — windowed to zero at the leading edge so the two sheets
  // still MEET there and the nose apex has no crack in it.
  function b2Blister(x, t) {
    if (!(t > 0)) return 0;
    return Math.exp(-Math.pow(x / 3.4, 2)) *
           Math.exp(-Math.pow((t - 0.20) / 0.13, 2)) *
           Math.min(1, t / 0.09) * 0.95;
  }
  // chord fraction at a model-local (x, z) — so every bolt-on part below can be
  // placed ON the real surface instead of at a guessed height. This is the same
  // law utility_lines.js learned the hard way: a fitting hangs off the hardware,
  // not off a re-typed offset.
  function b2T(x, z) { return (B2_APEX - z - b2LE(x)) / b2Chord(x); }
  function b2TopY(x, z) {
    const t = b2T(x, z);
    if (!(t > 0) || t >= 1) return B2_CY;
    return B2_CY + b2Thick(x) * b2Foil(t) * 0.80 + b2Blister(x, t);
  }
  function b2BotY(x, z) {
    const t = b2T(x, z);
    if (!(t > 0) || t >= 1) return B2_CY;
    return B2_CY - b2Thick(x) * b2Foil(t) * 0.22;
  }
  // THE WINDSCREEN APERTURE, in the loft's own parameter space. Quads inside it
  // are emitted into the GLASS geometry instead of the skin.
  const B2_GLASS_X = 1.30, B2_GLASS_T0 = 0.070, B2_GLASS_T1 = 0.215;

  // SEAT A FORE-AND-AFT BOX ON THE SKIN. Both ends land EXACTLY on the lofted
  // surface and the rake is the surface's own slope between them, so a fitting
  // can never float above the hull at one end and bury itself at the other.
  // This is `utility_lines.js`'s law — a wire ends on the hardware it hangs
  // from — applied to a curved one: the alternative is re-typing a height and
  // a tilt as two independent numbers, which is exactly how the cobra arm ended
  // up pointing somewhere the luminaire was not. z0 is the AFT end, z1 the
  // FORWARD one; `lift` raises (proud fitting) or sinks (recessed trough) it
  // along the local normal-ish. Convexity means the middle sits slightly proud,
  // which is the correct error direction for a rail or an intake lip.
  function b2Seat(gp, m, x, z0, z1, w, h, lift) {
    const y0 = b2TopY(x, z0), y1 = b2TopY(x, z1);
    const len = Math.hypot(z1 - z0, y1 - y0);
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, len), m);
    b.position.set(x, (y0 + y1) / 2 + (lift || 0), (z0 + z1) / 2);
    // rotation.x = θ sends local +Z to (0, −sinθ, cosθ); the forward end must
    // land at y1, so sinθ = (y0 − y1)/len.
    b.rotation.x = Math.atan2(y0 - y1, z1 - z0);
    b.castShadow = true; b.receiveShadow = true;
    gp.add(b);
    return b;
  }

  // Span stations. The breakpoints are IN the list, so the sawtooth is exact;
  // the subdivisions in between only have to resolve the thickness curve and
  // the blister. 41 stations x 15 chord divisions = 1230 verts, 2240 triangles,
  // and it replaces fourteen boxes with two meshes.
  function b2Stations() {
    const seg = [[0, 6.0, 5], [6.0, 11.0, 4], [11.0, 17.0, 5], [17.0, 26.2, 6]];
    const half = [0];
    for (let i = 0; i < seg.length; i++) {
      const a = seg[i][0], b = seg[i][1], n = seg[i][2];
      for (let k = 1; k <= n; k++) half.push(a + (b - a) * k / n);
    }
    const out = [];
    for (let i = half.length - 1; i >= 1; i--) out.push(-half[i]);
    for (let i = 0; i < half.length; i++) out.push(half[i]);
    return out;
  }

  // Build the three lofted sheets in one pass. `pickGlass` decides, per quad,
  // whether it belongs to the windscreen; the vertices are shared arithmetic so
  // the pane can never drift off the hull it was cut from.
  function b2Loft() {
    const S = b2Stations(), NS = S.length, NC = 14;
    const vt = [], vb = [], iTop = [], iGlass = [], iBot = [];
    const topRow = [], botRow = [];
    for (let s = 0; s < NS; s++) {
      const x = S[s];
      const tip = Math.abs(Math.abs(x) - B2_HALF) < 1e-6;
      const c = b2Chord(x), le = b2LE(x), th = tip ? 0 : b2Thick(x);
      const rt = [], rb = [];
      for (let k = 0; k <= NC; k++) {
        const t = k / NC;
        const f = b2Foil(t);
        const cz = le + t * c;
        const z = B2_APEX - cz;
        vt.push(x, B2_CY + th * f * 0.80 + (tip ? 0 : b2Blister(x, t)), z);
        vb.push(x, B2_CY - th * f * 0.22, z);
        rt.push(vt.length / 3 - 1);
        rb.push(vb.length / 3 - 1);
      }
      topRow.push(rt); botRow.push(rb);
    }
    for (let s = 0; s < NS - 1; s++) {
      const xa = S[s], xb = S[s + 1];
      const glassSpan = Math.abs(xa) < B2_GLASS_X && Math.abs(xb) < B2_GLASS_X;
      for (let k = 0; k < NC; k++) {
        const t0 = k / NC, t1 = (k + 1) / NC;
        const a = topRow[s][k], b = topRow[s][k + 1], c2 = topRow[s + 1][k], d = topRow[s + 1][k + 1];
        const win = glassSpan && t0 >= B2_GLASS_T0 - 1e-6 && t1 <= B2_GLASS_T1 + 1e-6;
        (win ? iGlass : iTop).push(a, b, c2, b, d, c2);
        const e = botRow[s][k], f2 = botRow[s][k + 1], gg = botRow[s + 1][k], h = botRow[s + 1][k + 1];
        iBot.push(e, gg, f2, f2, gg, h);
      }
    }
    function mk(verts, idx, lift) {
      if (!idx.length) return null;
      const arr = lift ? verts.slice() : verts;
      if (lift) for (let i = 1; i < arr.length; i += 3) arr[i] += lift;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      return geo;
    }
    return {
      // the glass sheet is lifted 15 mm so it never z-fights the frame boxes
      // that sit on the same arithmetic
      top: mk(vt, iTop, 0), glass: mk(vt, iGlass, 0.015), bot: mk(vb, iBot, 0),
    };
  }

  /* ==========================================================================
     THE FLIGHT DECK — the airliner's technique, applied to a wing.

     OWNER: "improve our cockpits." island_airport.js's buildCabin taught the
     rule and it is arithmetic, not art: a windscreen is only a windscreen if
     there is ROOM behind it. Its barrel is split into roof/belly slabs and
     band caps around an OPEN window band with a lit cabin inside; a pane
     stuck on a solid hull is a decal.

     A loft cannot be split into slabs, so the same idea is expressed in the
     loft's own coordinates: the quads over the cockpit are re-emitted as glass
     (above), and the volume they now look into is furnished HERE. The loft is
     hollow by construction — an upper sheet and a lower sheet joined at the
     edges — so the room already existed; nothing had ever been put in it.

     The B-2 is a TWO-SEAT aeroplane (pilot left, mission commander right), so
     that is what is in here. Everything is an opaque interior-bucket box in the
     helicopter-tub idiom: no collider, no new material family, no rng.

     THE CONSTRAINT THAT SHAPES ALL OF IT: this room is inside a WING, and a
     wing's skin falls away laterally as fast as it falls away forward. At the
     coaming station (z 7.45) the crown is at y 5.66 on the centreline and 5.13
     at x 1.2 — a 0.53 m drop across the half-width. So the deck is deliberately
     narrow-and-low up front and wider aft, and every part is measured against
     b2TopY at ITS OWN station rather than against one typed ceiling. Measured
     clearances, worst case first: side wall 0.17 · overhead panel 0.16 ·
     coaming 0.15 · rear bulkhead 0.15 · seat headrest 0.34.
  ========================================================================== */
  function b2Deck(gp) {
    const D = 4.30;                            // cabin floor top, model-local
    const TRIM = vmat("interior", B2C.deck);
    const SKIN = cm(B2C.skinD);
    // instrument faces carry the reference's phosphor teal — the ONE colour
    // b2code.html speaks its flight symbology in (--phos #7fe9e1). Emissive so
    // the deck is legible through the glass at night without adding a light.
    const GLOW = cm(B2C.instr, { emissive: 0x2f6f6a, ei: 0.55 });
    function put(x, y, z, w, h, d, m, rx) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      b.position.set(x, y, z);
      if (rx) b.rotation.x = rx;
      b.castShadow = false; b.receiveShadow = false;
      gp.add(b);
      return b;
    }
    // THE TUB — floor, rear bulkhead, two side walls. This is what stops the
    // glass looking straight through the aeroplane and out the far side, and it
    // is the whole reason the windscreen is a windscreen and not a decal.
    put(0, D - 0.03, 6.25, 2.90, 0.12, 3.40, SKIN);                    // floor
    put(0, D + 0.575, 4.60, 2.90, 1.15, 0.14, SKIN);                   // rear bulkhead
    for (let i = 0; i < 2; i++) {
      put(i ? 1.44 : -1.44, D + 0.39, 5.85, 0.12, 0.78, 2.50, SKIN);   // side walls
    }
    // GLARESHIELD + MAIN PANEL. The coaming is the dark horizontal mass across
    // the top of the view that says "inside something" (cockpit_shapes.js's own
    // doctrine, and the reason the mesh budget goes on silhouette before
    // gauges); the panel under it is raked back toward the crew and its face is
    // the glow. Both follow the windscreen's own 0.42 rad rake.
    put(0, D + 0.82, 7.45, 1.80, 0.13, 0.46, SKIN, 0.42);              // glareshield
    put(0, D + 0.52, 7.30, 1.72, 0.50, 0.09, GLOW, 0.42);              // main panel face
    for (let i = 0; i < 2; i++) {
      put(i ? 0.52 : -0.52, D + 0.56, 7.18, 0.32, 0.26, 0.06, GLOW, 0.42);  // stores/MFD bezels
    }
    // CREW — two seats abreast, cushion + back + headrest, and the centre
    // console between them carrying the throttle quadrant.
    for (let i = 0; i < 2; i++) {
      const s = i ? 0.62 : -0.62;
      put(s, D + 0.20, 6.05, 0.62, 0.16, 0.66, TRIM);                  // cushion
      put(s, D + 0.66, 5.68, 0.60, 0.94, 0.14, TRIM, -0.14);           // back
      put(s, D + 1.16, 5.62, 0.34, 0.22, 0.16, TRIM);                  // headrest
    }
    put(0, D + 0.26, 6.30, 0.40, 0.30, 1.30, SKIN);                    // centre console
    put(0, D + 0.44, 6.72, 0.30, 0.10, 0.34, GLOW, 0.25);              // throttle quadrant
    put(0, D + 1.42, 5.85, 1.20, 0.10, 0.76, GLOW, -0.20);             // overhead panel
    // WINDSCREEN FRAME — a centre post and the two canopy rails on the
    // aperture's own outboard stations (x = ±1.2: the loft's quad test admits
    // |x| < 1.30 and the nearest stations are 0 and ±1.2, so THAT is where the
    // glass actually ends). All three run FORE-AND-AFT on purpose: the skin
    // drops 0.5 m across the aperture's half-width, so a lateral bow would have
    // to be a curve and a straight one floats off the hull at its ends. Seated
    // through b2Seat, so both ends land on the skin and only the middle stands
    // proud — which is what a canopy rail does.
    // Measured: 0.077-0.160 m proud over its whole length on the centreline and
    // 0.051-0.160 on the rails, so no part of a rail ever sinks out of sight.
    for (let i = 0; i < 3; i++) {
      const px = i === 0 ? 0 : (i === 1 ? -1.2 : 1.2);
      b2Seat(gp, SKIN, px, 6.70, 8.45, i ? 0.13 : 0.10, 0.10, 0.11);
    }
  }

  /* ==========================================================================
     THE AIRFRAME. Nose +Z, wheels on y=0, no group scale (so the
     aircraft_doors hatch walk-point lands exactly at the hatch).
  ========================================================================== */
  function makeB2() {
    const gp = new THREE.Group();
    const cy = B2_CY;
    const SKIN = cm(B2C.skin), SKIND = cm(B2C.skinD), PANEL = cm(B2C.panel);
    const BELLY = cm(B2C.belly), GEAR = cm(B2C.gear), TIRE = cm(B2C.tire);
    const GLASS = vmat("glass", B2C.glass);

    // ---- THE ONE SURFACE ---------------------------------------------------
    const L = b2Loft();
    const top = new THREE.Mesh(L.top, SKIN);
    top.castShadow = true; top.receiveShadow = true; gp.add(top);
    const bot = new THREE.Mesh(L.bot, BELLY);
    bot.castShadow = true; bot.receiveShadow = true; gp.add(bot);
    if (L.glass) {
      const gl = new THREE.Mesh(L.glass, GLASS);
      gl.castShadow = false; gl.receiveShadow = false; gp.add(gl);
      gp.userData.b2Glass = gl;
    }
    b2Deck(gp);

    // ---- ENGINES: buried inlets, shielded exhaust troughs ------------------
    // The B-2's engines are INSIDE the wing — the whole point of the airframe.
    // What you see from above is a pair of raised inlets at about 25% chord and
    // a pair of long shallow trenches running aft from them to the trailing
    // edge, which is what keeps the hot parts out of sight of anything
    // underneath. Both are SEATED on the loft (b2Seat), so the inlet does not
    // float at its forward lip and bury its aft end the way a flat box on a
    // curved skin always does. Measured at x=±5.0 the skin runs 4.06 at z 6.2,
    // crests at 4.38 around z 3.5 and falls to 2.72 by the trailing edge — a
    // 1.7 m fall no single tilt could have been guessed.
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1, ix = s * 5.0;
      // inlet duct: proud of the skin, toed inboard the way the real one is
      const hump = b2Seat(gp, PANEL, ix, 2.60, 6.20, 3.20, 0.72, 0.26);
      hump.rotation.y = -s * 0.10;
      // the serrated inlet lip — one dark band across the mouth, at the duct's
      // own forward station rather than at a re-typed offset
      const lip = b2Seat(gp, SKIND, ix, 5.90, 6.34, 3.02, 0.30, 0.30);
      lip.rotation.y = -s * 0.10;
      // Exhaust trough: a long shallow dark plate running from under the duct
      // all the way to the trailing edge — 8.7 m of it, in THREE segments,
      // because one straight box over that much curvature buries its own middle
      // 0.21 m inside the wing (measured; the three-piece version holds
      // 0.07-0.11 m proud end to end and reads as one continuous trench).
      const TR = [[-6.30, -3.20], [-3.20, -0.40], [-0.40, 2.30]];
      for (let k = 0; k < TR.length; k++) b2Seat(gp, SKIND, ix, TR[k][0], TR[k][1], 2.10, 0.09, 0.06);
      // the shielded nozzle at the aft end of the trench
      b2Seat(gp, cm(0x101215), ix, -5.90, -4.90, 1.66, 0.24, 0.05);
    }

    // ---- ENGINE FIRE (owner: "when active it should have rocket in back —
    // rn no fire comes out the back"). The real ship hides its heat on
    // purpose; a game engine that is ON needs to LOOK on. Two additive
    // sprites per trench, parked invisible at build (fxwarm's prewarm law),
    // lit by the 12.35 updater only while flyingB2() is truthy — parked and
    // NPC airframes stay cold, which keeps the stealth read when it is not
    // yours. Positions derive from the trench's own station (b2TopY), never
    // a typed height.
    if (CBZ.CONFIG.STRAT_B2_PLUME !== false) {
      const cv = document.createElement("canvas"); cv.width = cv.height = 32;
      const c2 = cv.getContext("2d");
      const grd = c2.createRadialGradient(16, 16, 1, 16, 16, 15);
      grd.addColorStop(0, "rgba(255,244,214,1)");
      grd.addColorStop(0.35, "rgba(255,170,64,0.85)");
      grd.addColorStop(1, "rgba(255,90,20,0)");
      c2.fillStyle = grd; c2.fillRect(0, 0, 32, 32);
      const ptex = new THREE.Texture(cv); ptex.needsUpdate = true;
      gp.userData.plumes = [];
      for (let i = 0; i < 2; i++) {
        const s = i ? 1 : -1, px = s * 5.0, py = b2TopY(5.0, -5.4) + 0.12;
        for (let k = 0; k < 2; k++) {
          const pm = new THREE.SpriteMaterial({ map: ptex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 });
          const sp = new THREE.Sprite(pm);
          sp.position.set(px, py, -6.5 - k * 1.05);
          sp.visible = false;
          gp.add(sp);
          gp.userData.plumes.push({ s: sp, core: k === 0, bx: 1.5 - k * 0.3, by: 0.9 + k * 0.9 });
        }
      }
    }

    // ---- BOMB BAY: a recessed cavity + TWO working doors -------------------
    // The doors are tagged (bayL / bayR) — the release arc in section 2 eases
    // them and CBZ.cockpitClassOf reads bombBay to pick the bomber costume.
    const bayZ = 0.70, bayY = b2BotY(0, bayZ);
    const cav = new THREE.Mesh(new THREE.BoxGeometry(3.90, 1.30, 7.00), cm(0x090a0c));
    cav.position.set(0, bayY + 0.62, bayZ); gp.add(cav);
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1;
      // NOT CBZ.boxGeom here: boxGeom hands back a CACHED, SHARED geometry and
      // translating it mutates every other consumer of that size in the world.
      const dgeo = new THREE.BoxGeometry(1.75, 0.14, 6.80);
      dgeo.translate(s * 0.875, 0, 0);              // origin = the INBOARD hinge line
      const dm = new THREE.Mesh(dgeo, PANEL);
      dm.position.set(s * 0.10, bayY - 0.04, bayZ);
      dm.castShadow = true; gp.add(dm);
      gp.userData[s < 0 ? "bayL" : "bayR"] = dm;
      dm.userData.bayDoor = true;                   // spare from any static pass
    }
    gp.userData.bombBay = true;
    // THE COSTUME OVERRIDE, and it is a real bug rather than a nicety. The feel
    // stamp below sets craft.airClass = "airliner" (the heavy/stable WING_V2
    // row), and cockpit.js's classOf tests airClass BEFORE it tests the name or
    // the bomb bay — so the B-2's [V] cockpit was the AIRLINER flight deck,
    // beige and wide, on a stealth bomber. `cockpitClass` is that file's own
    // documented one-line explicit override and it is checked first.
    gp.userData.cockpitClass = "bomber";

    // ---- CREW HATCH + drop ladder ------------------------------------------
    // Under the port wing at local (-5.2, 1.25), OUTSIDE the parked body
    // collider so the aircraft_doors walk-up beat can actually reach it, and
    // under 2.09 m of wing so the player can stand there. Tagged as a doorRig
    // so doorSpec picks the "stair" arc at OUR coordinates.
    const HATCH_Y = b2BotY(-5.2, 1.25) - 0.07;
    const hgeo = new THREE.BoxGeometry(1.05, 0.12, 1.55);
    hgeo.translate(0, 0, -0.775);                   // hinge on the forward edge
    const hatch = new THREE.Mesh(hgeo, PANEL);
    hatch.position.set(-5.2, HATCH_Y, 1.25);
    hatch.castShadow = true; gp.add(hatch);
    const ladder = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const rung = new THREE.Mesh(bg(0.7, 0.08, 0.1), GEAR);
      rung.position.set(0, -0.3 - i * 0.32, 0); ladder.add(rung);
    }
    for (let i = 0; i < 2; i++) {
      const rail = new THREE.Mesh(bg(0.08, 1.4, 0.08), GEAR);
      rail.position.set(i ? 0.35 : -0.35, -0.7, 0); ladder.add(rail);
    }
    ladder.position.set(-5.2, HATCH_Y, 0.85);
    ladder.visible = false;
    gp.add(ladder);
    gp.userData.b2Hatch = hatch; gp.userData.b2Ladder = ladder;
    gp.userData.b2HatchBase = { rx: hatch.rotation.x };
    gp.userData.doorRig = { panel: hatch, doorX: -5.2, doorZ: 0.5 };

    // ---- LANDING GEAR ------------------------------------------------------
    // A twin-wheel nose leg under the flight deck and two FOUR-WHEEL BOGIES on
    // an 11.2 m track (the real aeroplane's is 12.2). Every strut starts at the
    // belly height the loft actually has above it and ends on the tyre, so no
    // leg hangs in air and none is buried.
    function wheel(x, z, r) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.32, 10), TIRE);
      w.rotation.z = Math.PI / 2; w.position.set(x, r, z);
      w.castShadow = true; gp.add(w);
    }
    function strut(x, z, w, d) {
      const top0 = b2BotY(x, z);
      const st = new THREE.Mesh(new THREE.BoxGeometry(w, top0 - 0.42, d), GEAR);
      st.position.set(x, (top0 + 0.42) / 2, z); st.castShadow = true; gp.add(st);
    }
    strut(0, 6.30, 0.34, 0.34);
    wheel(-0.30, 6.30, 0.42); wheel(0.30, 6.30, 0.42);
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1;
      strut(s * 5.60, -0.30, 0.46, 0.46);
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.26, 2.60), GEAR);
      beam.position.set(s * 5.60, 0.62, -0.30); beam.castShadow = true; gp.add(beam);
      for (let a = 0; a < 2; a++) {
        const wz = -0.30 + (a ? 0.90 : -0.90);
        wheel(s * 5.60 - 0.38, wz, 0.55); wheel(s * 5.60 + 0.38, wz, 0.55);
      }
    }

    // ---- LIGHTS ------------------------------------------------------------
    // On the tips at their real mid-chord station, not at a typed offset.
    // (x 25.6 rather than the 26.2 tip: the wing is 0.12 m thick out there and a
    // lamp bigger than the aerofoil it sits on reads as a bead stuck in the air)
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1, tx = s * 25.6;
      const tz = B2_APEX - (b2LE(tx) + 0.5 * b2Chord(tx));
      const nl = new THREE.Mesh(bg(0.22, 0.16, 0.22), cm(s < 0 ? 0xff4a3d : 0x37d67a,
        { emissive: s < 0 ? 0xff4a3d : 0x37d67a, ei: 0.9 }));
      nl.position.set(tx, b2TopY(tx, tz) + 0.04, tz); gp.add(nl);
    }
    const wl = new THREE.Mesh(bg(0.26, 0.2, 0.26), cm(0xf2f4ff, { emissive: 0xf2f4ff, ei: 0.9 }));
    wl.position.set(0, b2TopY(0, -9.6) + 0.06, -9.6); gp.add(wl);

    // missile muzzle node on the beak (playeraircraft fires from userData.muzzle)
    const muzzle = new THREE.Object3D(); muzzle.position.set(0, cy + 0.15, 9.9); gp.add(muzzle);
    gp.userData.muzzle = muzzle; gp.userData.muzzleLocal = muzzle.position.clone();
    // span 52.4 (was 44) · length 21 (unchanged) · height 6.0 (was 4.6, and the
    // extra is the gear that buys the walk-under). Ratio 2.50 — the reference's.
    const dims = { family: "B-2-stealth", length: 21, span: 52.4, height: 6.0 };
    gp.userData.aircraftDims = dims;
    return { group: gp, dims };
  }

  // ---- PLACEMENT + REGISTRATION (landmass order 41 — right after the
  // bunkers so the whole strategic kit builds together; the apron slot is
  // clear of every authored Fort Brandt prop: jets end ~x -627, the heavy
  // bomber starts ~x -495, helipads sit at z -670).
  let b2rec = null, _b2Reg = false;
  CBZ.addLandmass(function (city) {
    b2rec = null; _b2Reg = false;
    if (CBZ.CONFIG.STRAT_B2 === false) return;
    const root = city.root || CBZ.scene;
    const made = makeB2();
    const wx = -560, wz = -566, rotY = Math.PI;        // nose toward the runway
    made.group.position.set(wx, 0, wz);
    made.group.rotation.y = rotY;
    made.group.userData.milKind = "plane";
    made.group.userData.milName = "B-2 SPIRIT";
    made.group.userData.dynamic = true;                // never frozen/merged: it flies
    root.add(made.group);
    // the parked SOLID is the centre BODY only (9.2×21): a full 52.4u-span box
    // would wall off half the apron and stand between the player and the crew
    // hatch under the wing — which is now literally true, because the hatch is
    // at local x -5.2 and a span-wide collider would swallow the walk-up point.
    // UNCHANGED at ±4.6 by the wider re-loft on purpose: the airframe grew, the
    // block you cannot walk through did not, so boarding behaves exactly as it
    // did. footW stays the TRUE span (boarding range + the footprint-scaled
    // chase cam read it); colliderW/L feed the re-park.
    const solid = { minX: wx - 4.6, maxX: wx + 4.6, minZ: wz - made.dims.length / 2, maxZ: wz + made.dims.length / 2, y0: 0, y1: made.dims.height, ref: made.group };
    CBZ.colliders.push(solid);
    b2rec = {
      group: made.group, pos: made.group.position, heading: rotY,
      kind: "plane", model: { name: "B-2 SPIRIT" }, collider: solid,
      colliderW: 9.2, colliderL: made.dims.length,
      modelYawOffset: 0, groundOffset: 0, aircraftDims: made.dims,
      footW: made.dims.span, footL: made.dims.length, taken: false, hot: true,
      b2: true,
    };
    // keep the apron under it clear of wandering spawns (runway idiom)
    if (CBZ.registerNoSpawnZone) CBZ.registerNoSpawnZone(city, { minX: solid.minX - 2, maxX: solid.maxX + 2, minZ: solid.minZ - 2, maxZ: solid.maxZ + 2, label: "b2-apron" });
  }, 41);
  // registry hand-off — deferred one tick exactly like the islands (55.1);
  // ours at 55.15 so the base fleet lists first.
  CBZ.onUpdate(55.15, function () {
    if (_b2Reg || !b2rec || CBZ.CONFIG.STRAT_B2 === false) return;
    if (!CBZ.cityRegisterMilitaryVehicle) return;
    CBZ.cityRegisterMilitaryVehicle(b2rec);
    _b2Reg = true;
  });

  // ---- HATCH EASING — rides rec._doorArcOpen, the same flag the airliner
  // panels ease off (aircraft_doors sets it during the walk/step beats).
  let _hatchT = 0;
  CBZ.onUpdate(55.35, function (dt) {
    if (!b2rec || !b2rec.group || !b2rec.group.parent) return;
    const ud = b2rec.group.userData;
    if (!ud.b2Hatch) return;
    const want = b2rec._doorArcOpen ? 1 : 0;
    if (_hatchT === want && want === 0 && !ud.b2Ladder.visible) return;
    _hatchT += Math.sign(want - _hatchT) * dt / 0.45;
    _hatchT = Math.max(0, Math.min(1, _hatchT));
    const e = _hatchT * _hatchT * (3 - 2 * _hatchT);
    // Same sign class as the bay leaves: the hatch geometry is translated AFT
    // of its origin (hinge on the forward edge), so its free end sits at
    // z = -0.775 and R_x(θ) sends (0,z) to (-z·sinθ, z·cosθ). A POSITIVE θ
    // therefore lifted the panel UP into the wing root; it wants a negative one
    // to swing DOWN and aft, which is what the comment always claimed.
    ud.b2Hatch.rotation.x = (ud.b2HatchBase.rx || 0) - e * 1.35;   // swings down+aft
    ud.b2Ladder.visible = e > 0.35;
    ud.b2Ladder.scale.y = Math.max(0.001, e);
  });

  // ---- FEEL STAMP — the moment the flight controller takes the B-2, shape
  // the craft ONCE: the heavy/stable "airliner" WING_V2 row (fast, stately —
  // vmax 105, low roll/pitch authority, strong auto-level: a strategic
  // bomber, not a knife-fighter), a small defensive missile load, and the
  // bomb magazine. Done from OUR file so the flight-model module (another
  // agent's active surface) stays untouched.
  // A B-2 carries 80x Mk-82 or 16x 2000 lb-class. We fly the 2000 lb loadout,
  // so 16 iron + 4 of them swapped for guidance kits.
  const B2_BOMBS = 16, B2_MISSILES = 8, B2_JDAMS = 4, B2_NUKES = 3;
  let _bayT = 0, _bayOpen = 0;
  function flyingB2() {
    const P = CBZ.player;
    const c = P && P._aircraft;
    return (c && b2rec && c.sourceRec === b2rec) ? c : null;
  }
  CBZ.onUpdate(12.35, function (dt) {
    const c = flyingB2();
    if (c && !c._b2Init) {
      c._b2Init = true;
      c._b2 = true;
      c.airClass = "airliner";                     // the heavy/stable row
      c.ammo = Math.min(c.ammo, B2_MISSILES);
      c.maxAmmo = B2_MISSILES;
      c.bombAmmo = B2_BOMBS;
      c.jdamAmmo = B2_JDAMS;
      c.nukeAmmo = B2_NUKES;
      c.maxNukeAmmo = B2_NUKES;
      c.displayName = "B-2 SPIRIT";
      payload = "bomb";
      _payFlash = 0; _payTag = "";
      _b2Legend = 14;                              // the on-strip legend, then silence
      // ONE note. It carries NO key glyph on purpose: mode.js:91's NOTE_KEYBIND
      // deletes any string containing one, from every channel, which is exactly
      // why the old version of this line ("[B] tap: release · … · LMB missiles")
      // was never delivered to anybody. The keys are taught on the flight strip
      // instead (payloadHudText); this is the loadout, for the phone's record.
      note("B-2 SPIRIT airborne — bay loaded with sixteen Mk-84, four JDAM, and three nuclear weapons. Penetrators only bite fast and high.",
        5.4, { from: "Flight Ops", app: "messages" });
    }
    // bay doors ease open around a drop window, then seal
    if (b2rec && b2rec.group && b2rec.group.userData.bayL) {
      const ud = b2rec.group.userData;
      const want = _bayT > 0 ? 1 : 0;
      if (_bayT > 0) _bayT -= dt;
      if (_bayOpen !== want || (_bayOpen > 0 && _bayOpen < 1)) {
        _bayOpen += Math.sign(want - _bayOpen) * dt / 0.5;
        _bayOpen = Math.max(0, Math.min(1, _bayOpen));
        const e = _bayOpen * _bayOpen * (3 - 2 * _bayOpen);
        // SIGN FIX (found by reading, not by looking): each leaf's geometry is
        // translated OUTBOARD of its own origin, so the origin is the inboard
        // hinge line and the leaf is a lever arm at x = ±0.875. R_z(θ) sends
        // (x,0) to (x·cosθ, x·sinθ) — so the PORT leaf (x negative) needs a
        // POSITIVE θ to swing down and the starboard leaf a negative one. The
        // old pair had it exactly backwards and both doors opened UP, into the
        // wing they are cut out of.
        ud.bayL.rotation.z = e * 1.15;
        ud.bayR.rotation.z = -e * 1.15;
      }
    }
    // engine fire — lit only under a player at the throttle; flicker is
    // runtime FX so Math.random is sanctioned here
    const pud = b2rec && b2rec.group && b2rec.group.userData;
    if (pud && pud.plumes) {
      const spd = c ? Math.hypot(c.vx || 0, c.vz || 0) : 0;
      const thr = c ? Math.min(1, 0.4 + spd / 46) : 0;
      for (let i = 0; i < pud.plumes.length; i++) {
        const p = pud.plumes[i];
        p.s.visible = thr > 0;
        if (thr <= 0) continue;
        const f = 0.72 + Math.random() * 0.56;
        p.s.material.opacity = (p.core ? 0.9 : 0.5) * thr * f;
        p.s.scale.set(p.bx * (0.85 + 0.3 * f), p.by * (0.8 + 0.5 * f) * (0.6 + 0.4 * thr), 1);
      }
    }
    // LAST in this updater, and this updater is 12.35 — playeraircraft.js's
    // drawHud() has already rewritten #cityFlightHud at order 12 this frame, so
    // the ordnance group appends cleanly onto the end of the instrument line.
    drawPayloadHud(c, dt);
  });

  /* ==========================================================================
     2) THE BOMB BAY — unguided gravity bombs + the two special payloads.
  ========================================================================== */
  let payload = "bomb";                    // "bomb" | "jdam" | "buster" | "nuke"
  const PAYLOADS = ["bomb", "jdam", "buster", "nuke"];
  function payloadAvailable(k, craft) {
    if (k === "bomb") return craft && (craft.bombAmmo | 0) > 0;
    if (k === "jdam") return CBZ.CONFIG.STRAT_JDAM !== false && craft && (craft.jdamAmmo | 0) > 0;
    if (k === "buster") return CBZ.CONFIG.STRAT_BUNKER_BUSTER !== false && invCount("Bunker Buster") > 0;
    if (k === "nuke") return CBZ.CONFIG.STRAT_NUKE !== false && craft && (craft.nukeAmmo | 0) > 0;
    return false;
  }
  // How many of `k` are actually aboard. ONE answer — the strip, the label and
  // the audit all read it, so a readout can never disagree with the rack.
  function payloadCount(k, c) {
    if (k === "bomb") return c ? (c.bombAmmo | 0) : 0;
    if (k === "jdam") return c ? (c.jdamAmmo | 0) : 0;
    if (k === "buster") return invCount("Bunker Buster");
    return c ? (c.nukeAmmo | 0) : 0;
  }
  // Instrument names — short enough to sit in the flight strip's one line
  // beside the altitude and the missile count.
  const PAY_SHORT = { bomb: "MK-84", jdam: "JDAM", buster: "GBU-57", nuke: "NUKE" };
  function payloadLabel(k, c) {
    if (k === "bomb") return "Payload: Mk-84 bombs (" + payloadCount("bomb", c) + ")";
    if (k === "jdam") return "Payload: GBU-31 JDAM — guided (" + payloadCount("jdam", c) + ")";
    if (k === "buster") return "Payload: GBU-57 BUNKER BUSTER (" + payloadCount("buster", c) + ")";
    return "Payload: NUCLEAR WEAPON (" + payloadCount("nuke", c) + ")";
  }
  function cyclePayload() {
    const c = flyingB2();
    if (!c) return payload;
    const before = payload;
    const i = PAYLOADS.indexOf(payload);
    for (let k = 1; k <= PAYLOADS.length; k++) {
      const cand = PAYLOADS[(i + k) % PAYLOADS.length];
      if (payloadAvailable(cand, c)) { payload = cand; break; }
    }
    _b2Legend = 0;                          // you found the key; stop teaching it
    if (payload === before) {
      // [X] with nothing to switch TO must say WHY, or it reads as a dead key
      // (owner: "theres no way to change payload"). Name where the other
      // stores come from instead of silently re-picking the same rack.
      // CORRECTED: neither special is BOUGHT and neither comes from the vault
      // alone — the GBU-57s are taken free from the ordnance crate in the Fort
      // Brandt Deep Shelter's armory (bunkers.js:607/331, restocks daily) and
      // the B-2's nuclear rack is flight-only. The single vault device remains
      // a portable planting item; it is not secretly a fourth aircraft round.
      payloadFlash("NO OTHER STORES", 2.4);
      note("No other stores aboard — JDAM rack " + (CBZ.CONFIG.STRAT_JDAM === false ? "is disabled" : "spent")
        + ". GBU-57 penetrators are in the Fort Brandt Deep Shelter's ordnance crate; the nuclear rack is spent.",
        3.2, { from: "Flight Ops", app: "messages" });
      return payload;
    }
    payloadFlash("SELECTED", 2.0);
    note(payloadLabel(payload, c), 1.6, { from: "Flight Ops", app: "messages" });
    // The two SPECIALS are genuine headlines and belong in the record; the two
    // ordinary racks are not, and a news push per keypress would be spam.
    if ((payload === "buster" || payload === "nuke") && CBZ.city && CBZ.city.big) {
      try { CBZ.city.big(payload === "nuke" ? "BAY ARMED — NUCLEAR WEAPON" : "BAY ARMED — GBU-57 PENETRATOR"); } catch (e) {}
    }
    sfx("switch", { pitch: 1.2, volume: 0.3 });
    return payload;
  }

  /* ---- THE ORDNANCE READOUT — the ONE surface a pilot can actually see -----
     OWNER: "it doesn't show when i switch payload." It never could. EVERY
     prose channel in this game funnels through city/mode.js, and every one of
     them is phone-only now:
       • city.note()  — mode.js:190 bails on phoneWorthy() (mode.js:116), which
         returns FALSE for anything that is not an authored communication, then
         routes what survives to cityPhoneNotify. Nothing is drawn on screen.
       • city.big()   — mode.js:240, same gate, straight to the phone's News app.
       • flashToast / flashHint / setObjective — systems/hud.js:33 routeCityText
         BLANKS the DOM element in city mode and forwards to the handset.
       • cityFeed     — city/hud.js:409 renderFeed() empties the element and
         sets display:none unconditionally.
     And mode.js's NOTE_KEYBIND (mode.js:91) drops any string carrying a key
     glyph outright — which is why this file's first-flight legend ("[B] tap:
     release · HOLD [B] … · [X] payload · LMB missiles") has never once been
     seen by anybody. Shouting louder cannot open a closed channel.

     What IS on screen while you fly is playeraircraft.js's #cityFlightHud
     instrument strip: altitude · speed · missiles · integrity. A bomb bay is
     ordnance state exactly like the missile count already sitting in it, so the
     payload belongs THERE — permanent, not a toast you have to catch.

     WHY THIS DOES NOT TOUCH playeraircraft.js: its drawHud() rewrites the
     element's textContent inside the order-12 updater; this file's B-2 updater
     is order 12.35, so appending here lands after it, every frame, forever. The
     HUD_MARK indexOf guard makes a frame where drawHud did NOT run a no-op
     instead of doubling the suffix. No element is created and no HUD doctrine
     is bent: this is the aircraft's own instrument line, in its own grammar. */
  const HUD_MARK = "  ✦";              // ✦ — this readout's own glyph
  let _payFlash = 0, _payTag = "", _b2Legend = 0;
  const bombCine = {
    active: false, snap: false, kills0: 0, kills: 0,
    released: 0, impacts: 0,
    hasImpact: false, lastX: 0, lastY: 0, lastZ: 0,
  };
  function bombCineDeaths() {
    if (bombCine.active) {
      bombCine.kills = Math.max(bombCine.kills, Math.max(0, ((g && g.kills) | 0) - bombCine.kills0));
    }
    return bombCine.kills | 0;
  }
  function payloadFlash(tag, secs) { _payTag = tag || ""; _payFlash = secs || 2; }
  function payloadHudText(c) {
    const n = payloadCount(payload, c);
    return HUD_MARK + PAY_SHORT[payload] + " ×" + n +
      (_payFlash > 0 && _payTag ? "  " + _payTag : "") +
      (bombCine.active ? "   BOMB CAM · IMPACTS " + bombCine.impacts + " · DEATHS " + bombCineDeaths() : "") +
      // A 14 s legend, then silence. The permanent tutorial this repo bans is a
      // legend that never leaves; the owner cannot discover [X] any other way,
      // because the note that used to teach it is deleted upstream. Never on
      // touch — CLAUDE.md forbids key glyphs there, and the touch layer's own
      // pills (CBZ.strategicPayloadCycle / strategicBombHold) say the words.
      (_b2Legend > 0 && !CBZ.touchMode ? "   X:payload  B:drop (hold: carpet)  C:bomb cam (hold)" : "");
  }
  // Append our group to the flight strip. Returns nothing; safe on every path.
  function drawPayloadHud(c, dt) {
    if (_payFlash > 0) _payFlash = Math.max(0, _payFlash - dt);
    if (_b2Legend > 0) _b2Legend = Math.max(0, _b2Legend - dt);
    if (CBZ.CONFIG.STRAT_PAYLOAD_FEEDBACK === false) return;
    if (typeof document === "undefined" || !document.getElementById) return;
    const el = document.getElementById("cityFlightHud");
    if (!el || el.style.display === "none") return;
    const t = el.textContent || "";
    if (t.indexOf(HUD_MARK) >= 0) return;   // drawHud did not run this frame
    if (c) { el.textContent = t + payloadHudText(c); return; }
    // NOT the B-2: the only thing worth saying here is why the bomb keys did
    // nothing, and only right after you pressed one (see the keydown handler).
    if (_payFlash > 0 && _payTag) el.textContent = t + HUD_MARK + _payTag;
  }

  // ---- the falling-ordnance pool (shared geo/mats — explosives.js idiom) ---
  let BGEO = null, BMAT = null;
  function bombAssets() {
    if (BGEO) return;
    BGEO = {
      body: new THREE.CylinderGeometry(0.24, 0.28, 1.9, 8),
      buster: new THREE.CylinderGeometry(0.26, 0.3, 3.4, 8),
      nuke: new THREE.CylinderGeometry(0.42, 0.42, 2.4, 10),
      fin: new THREE.BoxGeometry(0.7, 0.5, 0.08),
    };
    BMAT = {
      body: new THREE.MeshLambertMaterial({ color: 0x3a4030 }),
      buster: new THREE.MeshLambertMaterial({ color: 0x2b2e33 }),
      nuke: new THREE.MeshLambertMaterial({ color: 0xb8bec6 }),
      band: new THREE.MeshLambertMaterial({ color: 0xd4a017 }),
    };
    for (const k in BGEO) BGEO[k]._shared = true;
    for (const k in BMAT) BMAT[k]._shared = true;
  }

  /* ==========================================================================
     CBZ.nukeWarhead(opts) — WHAT A NUCLEAR GRAVITY BOMB LOOKS LIKE.

     ONE model, TWO consumers, and that is the whole reason it is exported:
     city/bunkers.js's vault rack and this file's falling round used to be two
     unrelated piles of cylinders that disagreed about the shape of the same
     object (the vault's was a 1.7 m sausage with a ball nose; the flight
     body was a bare 2.4 m drum with two flat plates for fins). A weapon you
     pick up and the weapon you drop must be the same weapon.

     PROPORTIONS ARE REAL, then scaled ONCE. The reference is the B61 family —
     the US air-delivered gravity bomb, and the one that actually has the
     parachute-retarded delivery this file models:

         B61      length 141.6 in = 3.58 m   diameter 13.3 in = 0.338 m
                  mass ~700 lb = 320 kg      four tail fins
                  fineness ratio L/D = 10.6
         B83      length 3.7 m  diameter 0.46 m  L/D = 8.0

     A 10.6:1 pencil is unreadable at this game's scale (it is 0.34 m across
     against a 0.55 m player capsule and the camera is usually 60 m up), so
     the casing is drawn at L/D = 6.0 — between the B83 and Fat Man's 3.3:1 —
     with the LENGTH honest at 2.52 m and the DIAMETER thickened. That is a
     deliberate, named liberty; every other proportion below is off the real
     article.

     THE NOSE IS A COMPUTED TANGENT OGIVE, not a taste. For nose length L and
     base radius R the ogive radius is rho = (R^2 + L^2) / 2R, and the profile
     measured from the tip is

         r(x) = sqrt(rho^2 - (L - x)^2) + R - rho,   x in [0, L]

     which is exactly 0 at the tip and exactly R at the shoulder. It is
     evaluated at NOSE_SEG stations and drawn as that many CylinderGeometry
     frusta. Frusta rather than a LatheGeometry on purpose: a lathe's face
     winding depends on the profile's point order, the fix for a mis-wound
     lathe is `side: DoubleSide`, and the only material this could take that
     from is CBZ.cmat's CACHED SHARED one — mutating `.side` on a cached
     material is the exact bug class CLAUDE.md records against boxGeom's
     shared geometry. Four frusta cost four tiny meshes and cannot be wrong.

     opts:
       mat(hex, opts)  material factory. bunkers.js passes its cmat() so the
                       static batcher can collapse the vault rack; this file
                       passes its own pooled MeshLambertMaterials.
       geo(w, h, d)    box-geometry factory (CBZ.boxGeom, or raw).
       len, rad        casing length / body radius (defaults below).
       chute           build the ribbon-parachute assembly as a hidden child
                       (`group.userData.chute`). Flight only.
       lugs            draw the two lifting lugs (a stowed weapon has them).
     Returns a Group with the NOSE ALONG +X and the origin at mid-length, so a
     caller only ever writes rotation.y (bearing) and rotation.x (dive).
  ========================================================================== */
  const WH = {
    LEN: 2.52,          // casing length, metres (B61's 3.58 m at game scale)
    RAD: 0.21,          // body radius — L/D 6.0, see the note above
    NOSE: 0.62,         // ogive length: 0.246 of overall, the B61's own share
    TAIL: 0.30,         // boat-tail
    NOSE_SEG: 4,        // frusta the ogive is drawn with
    FIN_N: 4,           // cruciform, like every B61 mod
    FIN_SWEEP: 0.22,    // rad of leading-edge sweep
  };
  const WH_COL = {
    skin: 0xb9c0c7,     // the unpainted light-grey a stockpile weapon wears
    skinD: 0x7c838c,    // shadowed hardware: fins, tail kit, lugs
    band: 0xd4a017,     // yellow: the stencil / handling band
    arm: 0xb43a32,      // red: the arming band and the safing plate
    stencil: 0x2c3138,  // black stencilling plate
    chute: 0xd8d2c2,    // ribbon-chute canopy, undyed nylon/Kevlar
    chuteD: 0x8a8478,   // the woven ribbon slots
  };
  function _defMat(hex) { return cm(hex); }
  function _defGeo(w, h, d) { return bg(w, h, d); }
  CBZ.nukeWarhead = function (opts) {
    opts = opts || {};
    const M = typeof opts.mat === "function" ? opts.mat : _defMat;
    const B = typeof opts.geo === "function" ? opts.geo : _defGeo;
    const L = +opts.len > 0 ? +opts.len : WH.LEN;
    const R = +opts.rad > 0 ? +opts.rad : WH.RAD;
    // The three casing sections must sum to L, so the nose/tail scale with it.
    const noseL = WH.NOSE * (L / WH.LEN), tailL = WH.TAIL * (L / WH.LEN);
    const bodyL = Math.max(0.1, L - noseL - tailL);
    const gp = new THREE.Group();
    const x0 = -L / 2;                                   // tail end, local +X forward

    function cyl(rTop, rBot, h, x, hex, seg) {
      // CylinderGeometry is Y-axis; -90 deg about Z takes +Y to +X, so the
      // frustum's "top" (rTop) ends up FORWARD. Nose-forward by construction.
      const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg || 12), M(hex));
      m.rotation.z = -Math.PI / 2;
      m.position.x = x;
      gp.add(m);
      return m;
    }

    // ---- NOSE: the computed tangent ogive, tip at x0 + L -------------------
    const rho = (R * R + noseL * noseL) / (2 * R);
    function ogive(x) {                                  // x measured from the TIP
      const s = noseL - Math.max(0, Math.min(noseL, x));
      return Math.max(0.004, Math.sqrt(Math.max(0, rho * rho - s * s)) + R - rho);
    }
    const noseX0 = x0 + tailL + bodyL;                   // the shoulder
    for (let i = 0; i < WH.NOSE_SEG; i++) {
      const seg = noseL / WH.NOSE_SEG;
      const xa = noseL - i * seg, xb = noseL - (i + 1) * seg;   // from shoulder forward
      cyl(ogive(xb), ogive(xa), seg, noseX0 + i * seg + seg / 2, WH_COL.skin);
    }

    // ---- PARALLEL BODY + BOAT-TAIL ----------------------------------------
    cyl(R, R, bodyL, x0 + tailL + bodyL / 2, WH_COL.skin, 14);
    // A real gravity bomb tapers into its tail kit; the drum this replaces did
    // not, which is most of why it read as a propane tank.
    cyl(R, R * 0.78, tailL, x0 + tailL / 2, WH_COL.skinD, 14);

    // ---- BANDS. Each is a hair proud of the skin so it reads as applied ----
    // the RED arming band sits over the physics package, forward of centre —
    // where the real stencil ring goes.
    cyl(R * 1.035, R * 1.035, 0.115, x0 + tailL + bodyL * 0.72, WH_COL.arm, 14);
    // the YELLOW handling/stencil band, aft
    cyl(R * 1.03, R * 1.03, 0.085, x0 + tailL + bodyL * 0.24, WH_COL.band, 14);
    // the joint ring between the physics package and the tail section
    cyl(R * 1.02, R * 1.02, 0.06, x0 + tailL + 0.02, WH_COL.skinD, 14);

    // Black stencil plate ON THE FLANK (markings, without a texture). The
    // box is thin in Y, so RotX(90 deg) swaps Y and Z and makes it thin in Z
    // — a plate lying against the side. It is seated at 0.975 R so its outer
    // face stands 0.6 cm proud of the 0.21 m casing surface and reads as
    // applied rather than sunk into it.
    const st = new THREE.Mesh(B(bodyL * 0.30, 0.012, R * 0.62), M(WH_COL.stencil));
    st.position.set(x0 + tailL + bodyL * 0.50, 0, R * 0.975);
    st.rotation.x = Math.PI / 2;
    gp.add(st);

    // ---- LIFTING LUGS. The real article's suspension lugs are on the NATO
    // 14-inch standard = 0.356 m, and this casing is drawn at 2.52 m against
    // the B61's 3.58 m, so the scaled spacing is 0.356 * (2.52/3.58) =
    // 0.2506 m — i.e. +/- 0.0497 of the overall length. Typed as the ratio
    // rather than the answer so it survives a change of `len`.
    if (opts.lugs !== false) {
      const LUG_HALF = 0.0497;
      for (const s of [-LUG_HALF, LUG_HALF]) {
        const lug = new THREE.Mesh(B(0.10, 0.13, 0.07), M(WH_COL.skinD));
        lug.position.set(x0 + tailL + bodyL * 0.5 + s * L, R + 0.055, 0);
        gp.add(lug);
      }
    }

    // ---- TAIL: four swept fins in a cruciform + the tail-kit ring ----------
    const finC = L * 0.155, finS = R * 1.30, finT = 0.028;   // chord / span / thickness
    const finX = x0 + tailL * 0.55;
    const finGeo = B(finC, finS, finT);
    for (let i = 0; i < WH.FIN_N; i++) {
      const a = i * (Math.PI * 2 / WH.FIN_N);
      const f = new THREE.Mesh(finGeo, M(WH_COL.skinD));
      // rotation order XYZ => matrix RotX * RotY * RotZ: the fin is FIRST
      // swept in its own plane (Z), THEN spun onto its cruciform arm (X).
      f.rotation.set(a, 0, -WH.FIN_SWEEP);
      const rMid = R * 0.86 + finS / 2;
      f.position.set(finX, Math.cos(a) * rMid, Math.sin(a) * rMid);
      gp.add(f);
    }
    // the tail-kit band that joins the fin roots (open-ended: it is a hoop,
    // and an open cylinder in r128 draws only its wall).
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(R * 1.08, R * 1.08, 0.07, 16, 1, true), M(WH_COL.skinD));
    ring.rotation.z = -Math.PI / 2;
    ring.position.x = x0 + 0.05;
    gp.add(ring);

    // ---- THE RIBBON PARACHUTE (flight only, stowed until it is streamed) ---
    /* THE B61 REALLY DOES HAVE ONE, which is why it is drawn. Retarded and
       laydown delivery stream a nylon/Kevlar RIBBON chute from the tail so
       the delivery aircraft can escape; the mod-11 canopy is 24 ft = 7.3 m
       across. Terminal velocity under it is the standard drag balance

           v = sqrt( 2 m g / (rho Cd A) )
             = sqrt( 2 * 320 * 9.81 / (1.225 * 0.52 * pi * 3.65^2) )
             = sqrt( 6278 / 26.7 ) = 15.3 m/s

       against a free-fall terminal near 340 m/s — a 22:1 retard. The canopy
       here is drawn at 1/3 of true scale (2.4 m) so it stays legible beside a
       2.5 m casing at the ranges this game views a bomb from; the RATE it
       actually falls at is solved in retardFor(), not from this mesh. */
    if (opts.chute) {
      const ch = new THREE.Group();
      const canR = 1.20, canH = 0.62;
      // canopy: an upper hemisphere. A parachute is seen from BELOW as often
      // as above, so this one material genuinely needs DoubleSide — and this
      // caller mints its own material rather than mutating a cached one.
      const canMat = new THREE.MeshLambertMaterial({
        color: WH_COL.chute, side: THREE.DoubleSide,
      });
      canMat._shared = true;
      /* The chute group hangs off the TAIL (local -X, since the nose is +X),
         so everything inside it has a NEGATIVE x. RotZ(+90 deg) maps the
         hemisphere's +Y pole onto -X, i.e. the dome's convex side points
         away from the weapon — which is the side the airstream is on. */
      const canX = -1.55;
      const can = new THREE.Mesh(
        new THREE.SphereGeometry(canR, 14, 7, 0, Math.PI * 2, 0, Math.PI * 0.5), canMat);
      can.scale.set(1, canH / canR, 1);
      can.rotation.z = Math.PI / 2;
      can.position.x = canX;
      ch.add(can);
      // the RIBBON SLOTS — a ribbon chute is a woven grid, not a sheet. Two
      // hoops of the darker weave read as that at any distance we see it from.
      const ribMat = new THREE.MeshLambertMaterial({
        color: WH_COL.chuteD, side: THREE.DoubleSide,
      });
      ribMat._shared = true;
      for (const k of [0.55, 0.85]) {
        const rr = canR * Math.sqrt(Math.max(0.02, 1 - k * k));
        const hoop = new THREE.Mesh(
          new THREE.CylinderGeometry(rr, rr, 0.05, 14, 1, true), ribMat);
        hoop.rotation.z = Math.PI / 2;
        hoop.position.x = canX - canH * k;
        ch.add(hoop);
      }
      // rigging: six suspension lines splayed from the tail bridle (local 0)
      // out to the canopy skirt. The splay angle is the geometry, not a guess:
      // atan(skirt radius / line run).
      const lineRun = -canX, skirtR = canR * 0.46;
      const splay = Math.atan2(skirtR, lineRun);
      const lineGeo = B(Math.hypot(lineRun, skirtR), 0.022, 0.022);
      for (let i = 0; i < 6; i++) {
        const a = i * (Math.PI * 2 / 6);
        const ln = new THREE.Mesh(lineGeo, M(WH_COL.chuteD));
        // XYZ order => RotX(a) * RotZ(splay): splay the line outward in its own
        // plane first, then spin it onto its bearing around the body axis.
        ln.rotation.set(a, 0, Math.PI - splay);
        ln.position.set(canX * 0.5, Math.cos(a) * skirtR * 0.5, Math.sin(a) * skirtR * 0.5);
        ch.add(ln);
      }
      ch.visible = false;
      ch.position.x = x0;                              // streams off the tail
      ch.scale.setScalar(0.01);                        // packed until the snatch
      gp.add(ch);
      gp.userData.chute = ch;
      // the stowed pack, which is what you see before it streams
      const pack = new THREE.Mesh(
        new THREE.CylinderGeometry(R * 0.74, R * 0.62, 0.24, 12), M(WH_COL.skinD));
      pack.rotation.z = -Math.PI / 2;
      pack.position.x = x0 - 0.10;
      gp.add(pack);
      gp.userData.chutePack = pack;
    }

    gp.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return gp;
  };

  function bombMesh(kind) {
    bombAssets();
    /* THE NUCLEAR ROUND IS NOT THE GENERIC CYLINDER ANY MORE. It gets the
       shared warhead above — ogive, boat-tail, cruciform fins, arming band
       and a stowed ribbon chute — while the Mk-84 and the GBU keep the cheap
       pooled bodies they always had. One flag, one line back. */
    if (kind === "nuke" && CBZ.CONFIG.NUKE_FX_V2 !== false) {
      const w = CBZ.nukeWarhead({
        mat: function (hex) { return nukeMat(hex); },
        geo: bg, chute: true,
      });
      /* THE NOSE CONVENTION IS NOT NEGOTIABLE HERE. Every other round in this
         file is built with its nose along +Z, and the flight loop's attitude
         (rotation.y = atan2(vx,vz), rotation.x = atan2(-vy,hsp)) is written
         for exactly that. CBZ.nukeWarhead builds nose-along-+X because that
         is the axis a laid-down CylinderGeometry naturally takes. One outer
         Group with a single yaw reconciles them — RotY(-90 deg) maps +X onto
         +Z — so NOT ONE LINE of the flight attitude changes and there is no
         second sign convention to get wrong later. */
      const outer = new THREE.Group();
      w.rotation.y = -Math.PI / 2;
      outer.add(w);
      outer.userData.warhead = true;
      outer.userData.chute = w.userData.chute || null;
      outer.userData.chutePack = w.userData.chutePack || null;
      return outer;
    }
    const gp = new THREE.Group();
    const body = new THREE.Mesh(kind === "buster" ? BGEO.buster : kind === "nuke" ? BGEO.nuke : BGEO.body,
      kind === "buster" ? BMAT.buster : kind === "nuke" ? BMAT.nuke : BMAT.body);
    body.rotation.x = Math.PI / 2;                   // nose down the flight path
    gp.add(body);
    if (kind !== "bomb") {
      const band = new THREE.Mesh(BGEO.fin, BMAT.band);
      band.scale.set(0.9, 0.4, 1); band.position.z = 0.3; gp.add(band);
    }
    for (let i = 0; i < 2; i++) {
      const f = new THREE.Mesh(BGEO.fin, BMAT.body);
      f.rotation.z = i * Math.PI / 2;
      f.position.z = -(kind === "buster" ? 1.6 : 1.0);
      gp.add(f);
    }
    gp.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    return gp;
  }
  /* The flight body's own material pool. NOT CBZ.cmat: a cached city material
     is shared with static geometry the batcher may merge, and a falling bomb
     must never be able to hand one of those a different `side` or a different
     emissive. Pooled per colour, minted at most once each per session. */
  const _nukeMats = Object.create(null);
  function nukeMat(hex) {
    let m = _nukeMats[hex];
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color: hex });
      m._shared = true;
      _nukeMats[hex] = m;
    }
    return m;
  }
  const bombs = [];                          // {mesh,kind,x0,y0,z0,vx,vy,vz,t,sol,seek}
  const GRAV = 14;                                   // gamey-fast fall — reads right at flight alt
  const GLIDE_AUTH = 55;                             // JDAM cross-range authority, m/s of correction
  const REAIM = 0.35;                                // seconds between guided aimpoint re-solves
  // Live ordnance in the air. Quality-scaled per the brief: a low tier flies
  // fewer bodies, and over the cap a release SNAPS to its end state (below)
  // rather than being dropped or queued.
  function bombCap() { return Math.max(4, Math.round(CBZ.qScale ? CBZ.qScale(6, 14) : 14)); }

  /* ---- BALLISTICS, SOLVED — not integrated -------------------------------
     The old sim stepped `vy -= GRAV*dt` every frame and asked "have I hit the
     ground yet"; predictWalk() then guessed the SAME fall with a DIFFERENT
     formula (sqrt(2h/g), which throws away the release vy entirely), so the
     carpet-walk dust and the actual craters disagreed by metres. Both are gone.

     y(t) = y0 + vy·t − ½g·t², so the landing time is the positive root of
     ½g·t² − vy·t + (y0 − ys) = 0. Solving it at RELEASE means the impact
     point, the impact TIME and the impact SPEED are all known the instant the
     bomb leaves the bay. That is what buys, for free:
       • the dust walk lining up with the craters (cityBombWalk takes a `delay`)
       • the over-cap degrade path (snap straight to the end state)
       • the kinetic law (the buster is priced by the speed it actually arrives at)
     Per-frame the bomb is then a pure evaluation — no integration, no drift.
     ---------------------------------------------------------------------- */

  // Highest SOLID surface under (x,z): terrain, a roof/platform, or a bunker
  // berm. One answer, used by the solver and by the run's predicted walk, so
  // the two can never disagree again.
  function surfaceAt(x, z, fromY) {
    let s = 0;
    try {
      s = CBZ.groundAt ? CBZ.groundAt(x, z, fromY == null ? 600 : fromY)
        : (CBZ.floorAt ? CBZ.floorAt(x, z) : 0);
    } catch (e) { s = 0; }
    if (!isFinite(s)) s = 0;
    if (CBZ.strategicBunkerHit) {
      const bk = CBZ.strategicBunkerHit(x, z);
      if (bk && bk.moundTop > s) s = bk.moundTop;      // burst ON the berm, not inside it
    }
    return s;
  }

  // The closed form. `ys` depends on where it lands, so the surface sample is
  // iterated 3x — it converges on the first pass over flat ground and still
  // lands honestly on a roof or a berm.
  function solveFall(x0, y0, z0, vx, vy, vz) {
    let ys = surfaceAt(x0, z0, y0), t = 0, hx = x0, hz = z0;
    for (let i = 0; i < 3; i++) {
      const disc = vy * vy + 2 * GRAV * Math.max(0, y0 - ys);
      t = disc <= 0 ? 0 : (vy + Math.sqrt(disc)) / GRAV;
      if (!(t > 0) || !isFinite(t)) t = 0;
      if (t > 40) t = 40;                              // never leave one in the sky
      hx = x0 + vx * t; hz = z0 + vz * t;
      const ns = surfaceAt(hx, hz, y0);
      if (Math.abs(ns - ys) < 0.05) { ys = ns; break; }
      ys = ns;
    }
    const vyImp = vy - GRAV * t;
    return { t: t, x: hx, y: ys, z: hz, speed: Math.hypot(vx, vyImp, vz) };
  }

  /* ==========================================================================
     THE RETARDED FALL — a parachute, solved, not integrated.

     RESEARCH. The B61 has three selectable delivery options and the choice is
     made by PROFILE, not by taste:
       • FREE-FALL / ballistic — a high release. The fall time alone is the
         aircraft's escape. Little Boy: released at 9,470 m, burst at 600 m,
         8,870 m of fall in a measured 44.4 s. The vacuum answer for that drop
         is sqrt(2h/g) = sqrt(2*8870/9.81) = 42.5 s, so a dense streamlined
         casing falls at 1.045x the vacuum time over kilometres — drag is
         almost irrelevant and the closed-form parabola above is honest.
         (Fat Man agrees: 8,800 m released, 503 m burst, 43 s.)
       • RETARDED — a ribbon chute is streamed so the delivery aircraft can
         out-run its own weapon from a LOW release, where the fall time alone
         would not clear it. Mod-11 canopy 24 ft = 7.3 m; terminal velocity
         under it is 15.3 m/s (the drag balance is worked in CBZ.nukeWarhead)
         against a ~340 m/s free-fall terminal — a 22:1 retard.
       • LAYDOWN — chute, ground contact, then a fuze delay of tens of seconds
         while the aircraft leaves. That is the GROUND route in section 5,
         not this one.

     SO THE CHUTE IS NOT ALWAYS DEPLOYED, AND THE RULE IS THE REAL RULE:
     stream it only when the ballistic fall does not already buy the escape.

     THE ESCAPE NUMBER targets the aircraft-threatening 5 psi contour, not the
     much wider 1 psi broken-glass contour:
         severe 5 psi radius  = the bus's nuclear field       = 1,109 m
         bomber speed         = the airliner/heavy row vmax   =   105 m/s
         => straight-line clear time                           = 10.56 s
     A modest roll-out margin makes the profile target 12.0 s. The blast then
     still needs about two seconds to propagate to the departing aircraft.
     Above the altitude where free-fall already takes 12 s the chute stays stowed and
     the round is a plain ballistic drop, exactly like the high-release
     profile above. At GRAV 14 that crossover is h = 0.5*14*12^2 = 1,008 m.

     THE CANOPY'S DESCENT RATE IS THEN SOLVED PER DROP, not typed:
         t0  = 2.8 s of clean fall before the canopy is streamed (the real
               sequence lets the weapon separate and stabilise first)
         h0  = 0.5*g*t0^2 + eject*t0 = 0.5*14*7.84 + 1.5*2.8 = 59.1 m
         v0  = g*t0 + eject = 40.7 m/s at the moment of the snatch
         vt  = (h - h0) / (T_ESCAPE - t0)
     At a 300 m release that is (300-59)/9.2 = 26 m/s, i.e. the canopy takes
     the weapon from 40.7 m/s down to 26 — a 36% bite, visible as a snatch.
     Clamped to [16, 70] m/s so it can never become a fiction in either
     direction, and REFUSED outright when the solved vt is not meaningfully
     below the speed the weapon already has (vt >= 0.92*v0): a "chute" that
     accelerates its own bomb is worse than no chute.

     The chute phase is still CLOSED FORM, which is this file's whole
     doctrine. Velocity approaches vt exponentially with time constant tau,
     so with d = t - t0:
         v(d) = vt + (v0 - vt) e^(-d/tau)
         y(d) = y0 - vt*d - tau*(v0 - vt)(1 - e^(-d/tau))
     y is strictly decreasing, so the impact time is one bracketed bisection
     — 28 halvings of a 60 s bracket is 2e-7 s, run ONCE at release. The
     horizontal leg decays on the same tau (a canopy kills cross-range too),
     which is what makes a retarded round land where the aircraft was rather
     than downrange of it.

     MEASURED, across the whole release band (agl / profile / fall s /
     canopy vt / how much it takes off the speed at the snatch / how far a
     105 m/s bomber is when it goes off):

        50 m  ballistic   2.78 s     —          —      (lands before deploy)
        80 m  chute       3.55 s   16 m/s     -61%      372 m
       150 m  chute       7.79 s   16 m/s     -61%      818 m
       200 m  chute      10.91 s   16 m/s     -61%    1,146 m
       300 m  chute      11.75 s   26 m/s     -36%    1,234 m
       400 m  chute      11.96 s   37 m/s      -9%    1,255 m
       600 m  ballistic   9.37 s     —          —        984 m
     1,008 m  ballistic  12.11 s     —          —      1,272 m   <- crossover
     2,000 m  ballistic  17.01 s     —          —      1,786 m

     TWO HONEST LIMITS, both left in on purpose. Near the crossover the
     canopy only trims (-9% at 400 m) — it does exactly as much as the
     profile demands and no more. Below ~200 m the delivery cannot reliably
     clear the severe-pressure contour before the delayed shock catches it:
     the canopy is already at its VT_MIN floor and there is not enough sky
     left. That is the real laydown problem, not a bug, and it is why the
     bay already refuses a release under 14 m AGL.
  ========================================================================== */
  const RET = {
    T_ESCAPE: 12.0,     // s — clear the 1,109 m / 5 psi contour at 105 m/s
    T0: 2.8,            // s — clean fall before the canopy is streamed
    TAU: 0.45,          // s — the snatch; the exponential's time constant
    VT_MIN: 16,         // m/s — a canopy this small cannot do better
    VT_MAX: 70,         // m/s — past this it is not retarding anything
    BITE: 0.92,         // refuse a "retard" that is not one
  };
  // null => this round falls ballistically (the high-release profile).
  function retardFor(kind, y0, vy, ys) {
    if (kind !== "nuke" || CBZ.CONFIG.NUKE_FX_V2 === false) return null;
    const h = y0 - ys;
    if (!(h > 0)) return null;
    const t0 = RET.T0;
    // the weapon must still BE in the air when the canopy is due
    const h0 = 0.5 * GRAV * t0 * t0 - vy * t0;
    if (h0 >= h) return null;                          // it lands before deploy
    const span = RET.T_ESCAPE - t0;
    if (!(span > 0.5)) return null;
    let vt = (h - h0) / span;
    const v0 = GRAV * t0 - vy;                         // downward speed at deploy
    if (!(v0 > 0)) return null;
    if (vt >= v0 * RET.BITE) return null;              // free-fall already clears it
    vt = Math.max(RET.VT_MIN, Math.min(RET.VT_MAX, vt));
    if (vt >= v0 * RET.BITE) return null;              // ...and again after the clamp
    return { t0: t0, vt: vt, tau: RET.TAU, v0: v0, y0: y0 - h0, x0: 0, z0: 0, hx: 0, hz: 0 };
  }
  // Fill in the deploy-point position/impact time for a solved retard. `bal`
  // is the round's own BALLISTIC solve, which already found the surface.
  function solveRetard(b, ret, bal) {
    ret.x0 = b.x0 + b.vx * ret.t0;
    ret.z0 = b.z0 + b.vz * ret.t0;
    const ys = bal.y;
    const dv = ret.v0 - ret.vt;
    function yAt(d) {
      const e = Math.exp(-d / ret.tau);
      return ret.y0 - ret.vt * d - ret.tau * dv * (1 - e);
    }
    // BISECTION on a strictly decreasing function. lo is above the surface by
    // construction (retardFor refused otherwise); grow hi until it is below.
    let lo = 0, hi = 4;
    while (yAt(hi) > ys && hi < 60) hi *= 2;
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) * 0.5;
      if (yAt(mid) > ys) lo = mid; else hi = mid;
    }
    const d = (lo + hi) * 0.5;
    const e = Math.exp(-d / ret.tau);
    const vyImp = -(ret.vt + dv * e);
    const hk = ret.tau * (1 - e);                      // horizontal decay integral
    ret.hx = ret.x0 + b.vx * hk;
    ret.hz = ret.z0 + b.vz * hk;
    return {
      t: ret.t0 + d, x: ret.hx, y: ys, z: ret.hz,
      speed: Math.hypot(b.vx * e, vyImp, b.vz * e),
    };
  }

  // GUIDED SOLVE. A JDAM is an INS/GPS bomb: it steers to an AIMPOINT, it does
  // not chase like a missile. So the guidance is one BENT PARABOLA, not a
  // per-frame homing integration — fall to the target's altitude, then set the
  // horizontal leg so the bomb ARRIVES there, clamped to a real cross-range
  // authority (a kit can correct a few hundred metres, not fly to the horizon).
  // Target acquisition is still lockon.js's CBZ.lockonMissileSeek — the ONE
  // targeting system in the game. Only the flight solver is ours.
  function solveGuided(x0, y0, z0, vx, vy, vz, tgt) {
    const disc = vy * vy + 2 * GRAV * Math.max(0, y0 - tgt.y);
    let t = disc <= 0 ? 0 : (vy + Math.sqrt(disc)) / GRAV;
    if (!(t > 0.2) || !isFinite(t)) return null;       // no time left to correct
    let nvx = (tgt.x - x0) / t, nvz = (tgt.z - z0) / t;
    const dx = nvx - vx, dz = nvz - vz, d = Math.hypot(dx, dz);
    if (d > GLIDE_AUTH) { nvx = vx + dx / d * GLIDE_AUTH; nvz = vz + dz / d * GLIDE_AUTH; }
    const vyImp = vy - GRAV * t;
    return {
      vx: nvx, vz: nvz,
      sol: { t: t, x: x0 + nvx * t, y: tgt.y, z: z0 + nvz * t, speed: Math.hypot(nvx, vyImp, nvz) },
    };
  }

  // where the round is at local time t on its parabola (pure evaluation).
  // With a streamed canopy the arc has TWO closed-form legs — see the block
  // above — and this is still one evaluation, never an integration.
  function bombAt(b, t, out) {
    const R = b.ret;
    if (R && t > R.t0) {
      const d = t - R.t0, e = Math.exp(-d / R.tau), dv = R.v0 - R.vt;
      const hk = R.tau * (1 - e);
      out.x = R.x0 + b.vx * hk;
      out.y = R.y0 - R.vt * d - R.tau * dv * (1 - e);
      out.z = R.z0 + b.vz * hk;
      out.vy = -(R.vt + dv * e);
      return out;
    }
    out.x = b.x0 + b.vx * t;
    out.y = b.y0 + b.vy * t - 0.5 * GRAV * t * t;
    out.z = b.z0 + b.vz * t;
    out.vy = b.vy - GRAV * t;
    return out;
  }
  const _bp = { x: 0, y: 0, z: 0, vy: 0 };

  // THE BAY, in world space. localToWorld off the actual model is exact and
  // banks with the aircraft. The old release spawned the bomb 1.6 m BELOW the
  // group origin — which is the WHEELS, so every round appeared a metre and a
  // half under the landing gear instead of dropping out of the bay doors. This
  // is DERIVED from the loft rather than typed: b2BotY(0, bayZ) is the belly
  // height the surface actually has over the bay, so re-lofting the airframe
  // can never leave the release point buried inside the wing again.
  const BAY_LOCAL = new THREE.Vector3(0, b2BotY(0, 0.70) - 0.20, 0.70);
  const _bayWorld = new THREE.Vector3();
  function bayPoint(c) {
    const grp = c && c.group;
    if (grp && grp.localToWorld) {
      try { return grp.localToWorld(_bayWorld.copy(BAY_LOCAL)); } catch (e) {}
    }
    return _bayWorld.set(c.pos.x, c.pos.y + 0.6, c.pos.z);
  }

  /* ---- THE HELD-C SHOT ----------------------------------------------------
     Strategic weapons publish a shot; systems/camera.js remains the only code
     that writes the camera transform. The lens sits ahead and off one wing,
     looking BACK through the B-2 toward the falling stick and then the latest
     impact. Its lifetime is literal input state: hold C and the shot exists;
     release C and the normal chase camera resumes on the next camera tick.

     Deaths are the canonical game.kills delta. We do not estimate victims from
     the blast radius and we do not wrap a kill function: if the shared death
     bus has not confirmed a kill, this number does not move.                 */
  const _bombCinePoint = { x: 0, y: 0, z: 0, vy: 0 };
  const _bombCineView = {
    active: false, snap: false,
    x: 0, y: 0, z: 0, lx: 0, ly: 0, lz: 0, fov: 52,
  };
  function startBombCine(c) {
    if (CBZ.CONFIG.STRAT_BOMB_CINEMATIC === false || !c) return false;
    if (bombCine.active) return true;                 // extend one continuous run/re-hold
    bombCine.active = true;
    bombCine.snap = true;
    bombCine.kills0 = (g && g.kills) | 0;
    bombCine.kills = 0;
    bombCine.released = 0;
    bombCine.impacts = 0;
    bombCine.hasImpact = false;
    bombCine.lastX = c.pos.x;
    bombCine.lastY = c.pos.y;
    bombCine.lastZ = c.pos.z;
    return true;
  }
  function stopBombCine() {
    if (!bombCine.active) return;
    bombCineDeaths();
    bombCine.active = false;
    bombCine.snap = false;
  }
  function bombCineRelease() {
    if (bombCine.active) bombCine.released++;
  }
  function bombCineImpact(b) {
    if (!bombCine.active || !b || !b.sol) return;
    bombCine.impacts++;
    bombCine.hasImpact = true;
    bombCine.lastX = b.sol.x;
    bombCine.lastY = b.sol.y;
    bombCine.lastZ = b.sol.z;
  }
  function tickBombCine(c) {
    if (!bombCine.active) return;
    bombCineDeaths();
    if (CBZ.CONFIG.STRAT_BOMB_CINEMATIC === false || !c || !g ||
        g.mode !== "city" || (CBZ.player && CBZ.player.dead) || !_bombCamHeld) {
      stopBombCine();
    }
  }
  CBZ.aircraftCinematicView = function () {
    const c = flyingB2();
    if (!bombCine.active || !c || CBZ.CONFIG.STRAT_BOMB_CINEMATIC === false) return null;
    const hd = c.heading || 0;
    const fx = Math.sin(hd), fz = Math.cos(hd);
    const rx = Math.cos(hd), rz = -Math.sin(hd);
    const span = Math.max(34, (c.sourceRec && c.sourceRec.footW) || 52);
    const ahead = Math.max(68, Math.min(96, span * 1.5));
    const side = Math.max(10, Math.min(18, span * 0.26));
    const up = Math.max(17, Math.min(25, span * 0.38));
    _bombCineView.x = c.pos.x + fx * ahead + rx * side;
    _bombCineView.y = c.pos.y + up;
    _bombCineView.z = c.pos.z + fz * ahead + rz * side;

    if (bombCine.hasImpact) {
      _bombCineView.lx = bombCine.lastX;
      _bombCineView.ly = bombCine.lastY + 6;
      _bombCineView.lz = bombCine.lastZ;
    } else {
      let next = null, remain = Infinity;
      for (let i = 0; i < bombs.length; i++) {
        const b = bombs[i], r = b.sol.t - b.t;
        if (r < remain) { remain = r; next = b; }
      }
      if (next) {
        bombAt(next, Math.min(next.t, next.sol.t), _bombCinePoint);
        _bombCineView.lx = _bombCinePoint.x;
        _bombCineView.ly = _bombCinePoint.y;
        _bombCineView.lz = _bombCinePoint.z;
      } else {
        _bombCineView.lx = c.pos.x - fx * 70;
        _bombCineView.ly = c.pos.y - 28;
        _bombCineView.lz = c.pos.z - fz * 70;
      }
    }
    _bombCineView.active = true;
    _bombCineView.snap = bombCine.snap;
    bombCine.snap = false;
    return _bombCineView;
  };

  /* ---- STRAIGHT DOWN — the release velocity, once ------------------------
     OWNER: "bombs should drop straight down."

     This file used to type the release triple TWICE — once in dropPayload and
     once in predictWalk — and its own header already tells the story of what
     happens when the round and the prediction of the round are written by two
     different lines: the walk FX and the craters landed metres apart and the
     beat read as two separate events. So both now ask ONE function, and that
     function is aircraft.js's CBZ.ordnanceDropVel, which owns the law for every
     bomb bay in the game (BOMBS_DROP_STRAIGHT).

     GUIDED KITS KEEP A LITTLE MORE. A JDAM's whole cross-range budget is
     measured FROM its release velocity (solveGuided clamps the correction to
     GLIDE_AUTH m/s away from it), so a kit released with literally nothing to
     work with can only steer within that one cone. RESIDUAL_GUIDED 0.22 leaves
     the tail kit real authority while still arriving near-vertically — you must
     be roughly OVER the target, which is the owner's point, instead of gliding
     in from a kilometre out.

     DEGRADE-SAFE (BLOCK LAW rule 2): with aircraft.js absent this falls back to
     the exact ballistic triple this file wrote before the migration.          */
  const EJECT_MS = 1.5;                    // the bay physically pushes it down
  const RESIDUAL_GUIDED = 0.22;            // a tail kit needs SOME energy to steer with
  const _rv = { vx: 0, vy: 0, vz: 0 };
  function releaseVel(c, kind) {
    if (CBZ.ordnanceDropVel) {
      try {
        return CBZ.ordnanceDropVel("strategic:bay-release", c, _rv, {
          eject: EJECT_MS,
          residual: kind === "jdam" ? RESIDUAL_GUIDED : undefined,
        });
      } catch (e) {}
    }
    _rv.vx = c.vx || 0; _rv.vy = (c.vy || 0) - EJECT_MS; _rv.vz = c.vz || 0;
    return _rv;
  }
  // Lock acquisition through the same law, so this bay and the missile rails
  // ask lockon.js the identical question. Reads CBZ.* live (childsafe.js wraps
  // these) and keeps the undefined/null/value contract: undefined ⇒ system off
  // ⇒ this weapon has no legacy acquire of its own ⇒ dumb, which is honest.
  function ordSeek(site) {
    if (CBZ.ordnanceSeek) {
      try { return CBZ.ordnanceSeek(site, {}) || null; } catch (e) { return null; }
    }
    if (CBZ.lockonMissileSeek) { try { return CBZ.lockonMissileSeek() || null; } catch (e) {} }
    return null;
  }
  // Declared at LOAD so the ordnance census counts what the world is WIRED with.
  if (CBZ.ordnanceSite) {
    try {
      CBZ.ordnanceSite("strategic:bay-release", "bomb");
      CBZ.ordnanceSite("strategic:called-strike", "bomb");
      CBZ.ordnanceSite("strategic:jdam", "missile");
    } catch (e) {}
  }

  function nuclearChannelBusy() {
    if (nk || (armed && armed.length)) return true;
    for (let i = 0; i < bombs.length; i++) if (bombs[i].kind === "nuke") return true;
    return false;
  }
  function dropPayload(force) {
    const c = flyingB2();
    if (!c || !g || g.mode !== "city") return false;
    // bomber discipline: a release on the deck detonates under your own tail
    const agl = c.pos.y - (CBZ.floorAt ? CBZ.floorAt(c.pos.x, c.pos.z) : 0);
    // A REFUSED RELEASE IS THE SAME BUG AS THE INVISIBLE PAYLOAD SWITCH: both
    // notes below are deleted upstream (mode.js phoneWorthy), so [B] simply did
    // nothing and read as a broken key. The strip is the surface that works.
    if (agl < 14) { if (!force) { payloadFlash("TOO LOW — CLIMB", 1.8); note("Too low — climb before releasing.", 1.4); } return false; }
    if (!payloadAvailable(payload, c)) { cyclePayload(); if (!payloadAvailable(payload, c)) { if (!force) { payloadFlash("BAY EMPTY", 1.8); note("Bay's empty.", 1.2); } return false; } }
    // The nuke resolver intentionally admits one propagating apocalypse at a
    // time. Refuse a second release BEFORE charging the rack so all three
    // onboard weapons remain usable instead of later rounds becoming silent
    // duds while the first wave is still resolving.
    if (payload === "nuke" && nuclearChannelBusy()) {
      if (!force) {
        payloadFlash("NUCLEAR CHANNEL BUSY", 2.0);
        note("Nuclear channel busy — wait for the current weapon to resolve.", 2.0, { from: "Flight Ops", app: "messages" });
      }
      return false;
    }
    if (c._dropCD > 0) return false;
    const kind = payload;
    if (kind === "bomb") c.bombAmmo--;
    else if (kind === "jdam") c.jdamAmmo--;
    else if (kind === "buster") { if (!invTake("Bunker Buster")) return false; }
    else if (kind === "nuke") c.nukeAmmo--;
    c._dropCD = kind === "bomb" ? 0.2 : kind === "jdam" ? 0.6 : 1.4;
    _bayT = 1.3;                                     // bay doors swing for the release

    // THE RELEASE VELOCITY IS NOT OURS TO INVENT — releaseVel() (below) is the
    // ONE answer, shared with predictWalk so the dust line and the craters can
    // never disagree, and owned by aircraft.js's ordnance law so "straight down"
    // is a single flag for every bomb bay this game will ever grow.
    releaseStore(kind, bayPoint(c), releaseVel(c, kind), { cine: true, crime: c.pos });
    return true;
  }

  /* ---- THE RELEASE, AND IT IS THE ONLY ONE --------------------------------
     Everything from "the store has left the bay" onward: the closed-form
     solve, the retard/parachute decision, the tumble, the guided re-solve, the
     over-cap snap and the mesh. It was the tail of dropPayload(), which is
     gated on flyingB2() — i.e. on the PLAYER being at the controls. That gate
     is correct for a keypress and wrong for everything else, and it is the
     reason this file could describe a called sortie but never fly one: the
     called path had to fake the whole delivery on the ground (calledStrike →
     cityBombWalk) because it had no way to put a real weapon in the air.

     Split out, the file's own stated law finally holds for a THIRD route.
     Whether the bomb leaves the bay because you pressed [B] or because a
     garrison bomber flew a strike you ordered, it is the same arc, the same
     parachute, the same impact solve and the same nukeDetonate — not a second
     implementation that will drift.

       releaseStore(kind, p, rv, opts) -> the bomb record, or null

     `p` is the world release point, `rv` the release velocity ({vx,vy,vz});
     both come from bayPoint()/releaseVel() so a caller never invents either.
     opts.cine  — publish the held-C shot (the player's camera; a called sortie
                  has no business seizing it)
     opts.crime — {x,z} to bill "shots fired" at, or falsy for none (an ordered
                  strike is billed once, by nukeDetonate, as terrorism)
     ---------------------------------------------------------------------- */
  CBZ.strategicRelease = function (kind, p, rv, opts) {   // probe/tooling handle
    return releaseStore(kind, p, rv, opts || {});
  };
  function releaseStore(kind, p, rv, opts) {
    opts = opts || {};
    const b = {
      mesh: null, kind: kind, t: 0, reaim: 0, seek: null,
      x0: p.x, y0: p.y, z0: p.z,
      vx: rv.vx, vy: rv.vy, vz: rv.vz,
      // carried to resolveImpact so the blame survives the fall (undefined on
      // the piloted path, which is what keeps that path byte-identical)
      by: opts.by, byPlayer: opts.byPlayer,
    };
    b.sol = solveFall(b.x0, b.y0, b.z0, b.vx, b.vy, b.vz);
    /* THE DELIVERY PROFILE, chosen the way a real one is: ballistic unless the
       free fall does not already buy the aircraft its escape (see retardFor).
       Solved HERE, at release, so the impact point/time/speed the whole file
       hangs off — the walk delay, the over-cap snap, the cinematic's aim —
       stay one number that nothing has to re-derive. */
    b.ret = retardFor(kind, b.y0, b.vy, b.sol.y);
    if (b.ret) b.sol = solveRetard(b, b.ret, b.sol);
    // Release tumble: a store leaves the bay with residual pitch/yaw and
    // settles nose-down within about a second. `spin` is the amplitude and
    // `phase` de-syncs successive rounds. Runtime-only, so a plain rng is
    // legal here (this is not a build path) — but it is derived from the
    // release position instead, which keeps a replay identical for free.
    b.tumble = 1.0;
    b.age = 0;
    b.phase = ((Math.abs(b.x0 * 12.9898 + b.z0 * 78.233) * 43758.5453) % 1) * 6.2832;

    // GUIDED: acquisition is lockon.js's — asked through the shared ordnance
    // law so this bay speaks the RPG's sentence — and the solve is ours (see
    // solveGuided). Undefined (lock-on disabled) or null (no red lock) leaves
    // the bomb dumb, which is the honest outcome: a JDAM with no aimpoint IS a
    // dumb bomb, and under BOMBS_DROP_STRAIGHT a dumb bomb now falls vertically.
    if (kind === "jdam") {
      b.seek = ordSeek("strategic:jdam") || null;
      reaimGuided(b);
    }
    if (opts.cine) bombCineRelease();

    sfx("whoosh", { pitch: 0.8, volume: 0.5 });
    // dropping ordnance on the city is a crime the moment it leaves the bay.
    // An ORDERED sortie passes no point and is billed once, as terrorism, by
    // nukeDetonate — the same charge sheet, not a second one.
    if (opts.crime && CBZ.cityCrime) {
      try { CBZ.cityCrime(kind === "bomb" ? 120 : 200, { x: opts.crime.x, z: opts.crime.z, type: "shots-fired" }); } catch (e) {}
    }

    // OVER THE CAP — DEGRADE, never queue. The solver already knows exactly
    // where and when this round lands, so the only thing a saturated sky loses
    // is a few seconds of a 0.3 m cylinder falling: the crater, the kills and
    // the ledger hit are identical. This snap-to-end-state is only possible
    // BECAUSE the ballistics are closed-form.
    if (bombs.length >= bombCap()) { resolveImpact(b); return b; }

    b.mesh = bombMesh(kind);
    b.mesh.rotation.order = "YXZ";                   // yaw then pitch — nose tracks the arc
    b.mesh.position.set(b.x0, b.y0, b.z0);
    b.mesh.rotation.y = Math.atan2(b.vx, b.vz);
    if (CBZ.scene) CBZ.scene.add(b.mesh);
    bombs.push(b);
    return b;
  }

  // Re-solve a guided round onto its (possibly moved) aimpoint from wherever
  // it is right now. Resetting the parabola's ORIGIN each time is what keeps
  // this closed-form: the bomb is always on exactly one analytic arc.
  function reaimGuided(b) {
    if (!b.seek) return;
    let t = null;
    try { t = b.seek(); } catch (e) { t = null; }
    if (!t) { b.seek = null; return; }                 // target died/left: go ballistic
    bombAt(b, b.t, _bp);
    const gd = solveGuided(_bp.x, _bp.y, _bp.z, b.vx, _bp.vy, b.vz, t);
    if (!gd) { b.seek = null; return; }
    b.x0 = _bp.x; b.y0 = _bp.y; b.z0 = _bp.z;
    b.vy = _bp.vy; b.vx = gd.vx; b.vz = gd.vz;
    b.t = 0; b.reaim = REAIM;
    b.sol = gd.sol;
  }

  // ONE impact resolution, shared by the flying path and the over-cap snap.
  // Every branch ends in CBZ.detonate — the bus owns the fan-out, the row owns
  // the numbers, and {mass, speed} hands it the motion so the kinetic law can
  // price the hit (inert on rows with refE 0, which is every chemical warhead).
  function resolveImpact(b) {
    if (!g || g.mode !== "city") return;
    const s = b.sol;
    bombCineImpact(b);
    // a roof hit blooms ON the roof; ground level gets a little standoff
    const iy = s.y > 2.5 ? s.y : Math.max(0.6, s.y) + 1.0;
    if (b.kind === "buster") { resolveBuster(s.x, s.z, s.y, b.vx, b.vz, s.speed); return; }
    // ATTRIBUTION RIDES WITH THE WEAPON. b.by/b.byPlayer are what the release
    // was told (releaseStore); undefined leaves both branches on exactly the
    // defaults that shipped — who() for `by`, true for `byPlayer` — so the
    // piloted drop is unchanged and an ordered sortie can still name its owner.
    if (b.kind === "nuke") { nukeDetonate(s.x, s.z, { by: b.by, byPlayer: b.byPlayer }); return; }
    detonate(s.x, iy, s.z, b.kind, {
      byPlayer: b.byPlayer !== false, by: b.by, dirx: b.vx, dirz: b.vz,
      mass: MASS[b.kind] || MASS.bomb, speed: s.speed,
    });
  }

  /* ==========================================================================
     2b) THE CARPET BOMB RUN — the "bomb a city" fantasy.
     Holding [B] walks a STICK of bombs along the flight path: one release
     every RUN_INTERVAL seconds, so the ground stagger is release interval x
     ground speed and falls out of the flight for free (no path authoring).
     Research: carpet bombing is a SEQUENCE, not a bigger explosion — one
     pooled prefab fired N times with the dust merging along the line. The
     merge FX belongs to city/nukefx.js's CBZ.cityBombWalk(points, opts) if
     that file is loaded; without it the run is still a run.

     MISSION SEAM: CBZ.strategicBombRun(opts) starts one headlessly (opts
     {count, interval, kind, onDone}); CBZ.strategicBombRunState() reports
     progress; CBZ.strategicOnBombRun is a global completion hook. The score
     handed back is the run's own tally — bombs away, buildings condemned —
     read off city/structural.js rather than counted a second time here.
  ========================================================================== */
  const RUN_INTERVAL = 0.28;                 // seconds between releases
  const RUN_MAX = 24;                        // hard cap on a single stick
  const run = { active: false, want: 0, sent: 0, acc: 0, t: 0, interval: RUN_INTERVAL, kind: "bomb", onDone: null, x0: 0, z0: 0, _called: null };
  let _runCollapses = 0, _tapInstalled = false;

  /* Where the stick WILL land, using the SAME closed-form solver the rounds
     themselves fly. This is the fix for the run's oldest lie: the walk FX used
     to guess the fall with sqrt(2h/g) — throwing away the release vy and the
     aircraft's climb/dive entirely — so the dust line and the craters were
     metres apart and the beat read as two separate events. Now both come from
     solveFall(), and the walk is handed the fall TIME as its `delay`, so the
     dust blooms exactly when the first crater does.

     Returns {pts, tf}: the ground track, and the first round's time of flight. */
  function predictWalk(c, count, interval) {
    const pts = [];
    const p = bayPoint(c);
    const ax = c.vx || 0, ay = c.vy || 0, az = c.vz || 0;   // the AIRCRAFT's travel
    // the ROUND's release velocity — the SAME function dropPayload calls, not a
    // second copy of the same triple. Copied out because releaseVel returns a
    // shared scratch object and the loop below re-enters nothing that touches it.
    const r0 = releaseVel(c, run.kind === "jdam" ? "jdam" : "bomb");
    const vx = r0.vx, vy = r0.vy, vz = r0.vz;
    // the aircraft keeps flying between releases, so round i leaves from
    // (release point + aircraft velocity x i x interval) — that offset IS the
    // stagger, and it is why a carpet WALKS instead of stacking.
    let tf = 0;
    for (let i = 0; i < count; i++) {
      const lead = i * interval;
      const sol = solveFall(p.x + ax * lead, p.y + ay * lead, p.z + az * lead, vx, vy, vz);
      if (i === 0) tf = sol.t;
      pts.push({ x: sol.x, y: sol.y, z: sol.z });
    }
    return { pts: pts, tf: tf };
  }

  function startRun(opts) {
    opts = opts || {};
    if (CBZ.CONFIG.STRAT_BOMB_RUN === false) return false;
    if (run.active) return false;
    const c = flyingB2();
    // NO B-2 IN THE AIR → this is a CALLED strike, not a flown one (see
    // calledStrike below). That is what the documented mission seam always
    // claimed to do and could never actually do: startRun used to bail here.
    if (!c || !g || g.mode !== "city") return calledStrike(opts);
    const kind = opts.kind || (payload === "nuke" ? "bomb" : payload);   // never carpet the device
    if (!payloadAvailable(kind, c)) return false;
    payload = kind;
    const stock = payloadCount(kind, c);
    run.active = true;
    run.kind = kind;
    run.want = Math.max(1, Math.min(RUN_MAX, opts.count || stock));
    run.interval = Math.max(0.08, opts.interval || RUN_INTERVAL);
    run.sent = 0; run.acc = run.interval; run.t = 0;
    run.onDone = typeof opts.onDone === "function" ? opts.onDone : null;
    run.x0 = c.pos.x; run.z0 = c.pos.z;
    _runCollapses = 0;
    // hand the predicted line to the walk composer if one exists. DRAW ONLY
    // (nukefx.js's default) — we simulate and detonate every round ourselves,
    // so a detonating walk would bill the whole stick twice.
    if (CBZ.cityBombWalk) {
      try {
        const w = predictWalk(c, run.want, run.interval);
        CBZ.cityBombWalk(w.pts, { kind: kind, interval: run.interval, delay: w.tf });
      } catch (e) {}
    }
    note("BOMB RUN — " + run.want + " away.", 1.8);
    return true;
  }

  /* ---- THE CALLED STRIKE — the same verb, flown off-map -------------------
     "Bomb that district" with no player in the cockpit. There is deliberately
     no second bomb sim here: nukefx.js's CBZ.cityBombWalk already owns the
     staggered prefab walk and, in `detonate:true` mode, fires each impact
     through CBZ.detonate exactly once — so the structural ledger, the kill bus
     and the crime system all see it once, capped at 24 points and 2 concurrent
     walks. All this function contributes is the track and the time-on-target.  */
  function calledStrike(opts) {
    if (CBZ.CONFIG.STRAT_BOMB_RUN === false || !CBZ.cityBombWalk) return false;
    if (!g || g.mode !== "city") return false;
    if (run.active) return false;
    const tx = +opts.x, tz = +opts.z;
    if (!isFinite(tx) || !isFinite(tz)) return false;
    const kind = opts.kind === "jdam" ? "jdam" : "bomb";   // called sorties fly iron
    const count = Math.max(1, Math.min(RUN_MAX, opts.count || 12));
    const interval = Math.max(0.08, opts.interval || RUN_INTERVAL);
    // a stick walks ALONG a heading through the aimpoint, centred on it, at
    // the same spacing a real run lays down: interval x a bomber's ground speed.
    const hd = opts.heading != null ? +opts.heading : 0;
    const step = interval * (opts.speed || 190);
    const hx = Math.sin(hd), hz = Math.cos(hd);
    const pts = [];
    for (let i = 0; i < count; i++) {
      const d = (i - (count - 1) / 2) * step;
      const px = tx + hx * d, pz = tz + hz * d;
      pts.push({ x: px, y: surfaceAt(px, pz) + 1.0, z: pz });
    }
    // A CALLED sortie authors its impact points ON THE GROUND — there is no
    // release velocity to inherit, so this track is vertical by construction.
    // Registering it keeps CBZ.ordnanceAudit() honest about how many bomb sites
    // the world actually has rather than only counting the flown one.
    if (CBZ.ordnanceSite) { try { CBZ.ordnanceSite("strategic:called-strike", "bomb"); } catch (e) {} }
    const tot = Math.max(4, +opts.tot || 7);          // time on target, seconds
    run.active = true; run.kind = kind; run.want = count; run.sent = count;
    run.acc = 0; run.t = 0; run.interval = interval;
    run.x0 = tx; run.z0 = tz;
    run.onDone = typeof opts.onDone === "function" ? opts.onDone : null;
    _runCollapses = 0;
    run._called = tot + count * interval + 1.2;       // when the sortie is over
    try {
      CBZ.cityBombWalk(pts, {
        kind: kind, interval: interval, delay: tot, detonate: true,
        by: opts.by !== undefined ? opts.by : who(), byPlayer: opts.byPlayer !== false,
        dirx: hx, dirz: hz,
      });
    } catch (e) { run.active = false; return false; }
    note("STRIKE INBOUND — " + count + " x 2000 lb, " + Math.round(tot) + "s out. Clear the grid.", 3.4);
    if (CBZ.sfxAt) CBZ.sfxAt("siren", tx, tz, { volume: 0.35 });
    return true;
  }
  CBZ.strategicCallStrike = calledStrike;
  function endRun(reason) {
    if (!run.active) return;
    run.active = false;
    run._called = null;
    let doomed = 0;
    const S = CBZ.structure;
    if (S && S.doomed) { try { doomed = (S.doomed() || []).length; } catch (e) { doomed = 0; } }
    const report = {
      kind: run.kind, dropped: run.sent, requested: run.want,
      collapses: _runCollapses,
      doomed: doomed,                 // condemned and still counting down
      reason: reason || "done",
      x: run.x0, z: run.z0,
    };
    const cb = run.onDone; run.onDone = null;
    if (cb) { try { cb(report); } catch (e) {} }
    if (typeof CBZ.strategicOnBombRun === "function") { try { CBZ.strategicOnBombRun(report); } catch (e) {} }
  }

  // Count the buildings THIS run felled, by listening to the structural
  // ledger's existing collapse seam. We CHAIN whatever hook is already there
  // (the mission layer owns that slot too) instead of clobbering it, and we
  // only ever read — no second damage ledger is created here.
  function wireCollapseTap() {
    if (_tapInstalled) return;
    const S = CBZ.structure;
    if (!S) return;                                   // ledger absent: no score, no crash
    _tapInstalled = true;
    const prev = typeof S.onCollapse === "function" ? S.onCollapse : null;
    const tap = function (ev) {
      if (run.active) _runCollapses++;
      if (prev) { try { prev(ev); } catch (e) {} }
    };
    tap._stratTap = true;
    S.onCollapse = tap;
  }

  // ballistic tick + impact resolution
  CBZ.onUpdate(12.45, function (dt) {
    ensureRows();
    wireCollapseTap();
    const c = flyingB2();
    if (c && c._dropCD > 0) c._dropCD -= dt;
    // ---- [B] hold-to-carpet: past RUN_HOLD the tap becomes a run.
    // `_bRan` latches the attempt: without it an empty/refused run re-fired
    // startRun() on EVERY frame the key stayed down.
    if (_bHeld) {
      if (!c || g.mode !== "city") { _bHeld = false; _bRan = false; }
      else {
        _bT += dt;
        if (_bT >= RUN_HOLD && !_bRan && !run.active && CBZ.CONFIG.STRAT_BOMB_RUN !== false) {
          _bRan = true;
          startRun({});
        }
      }
    }
    // ---- the carpet run: one release per interval while the trigger is held
    if (run.active) {
      run.t += dt;
      if (run._called != null) {                        // a CALLED sortie flies itself
        if (run.t >= run._called) { run._called = null; endRun("done"); }
      } else if (!c || g.mode !== "city") endRun("aborted");
      else {
        run.acc += dt;
        // A stalled cadence (release cooldown longer than the interval) must
        // not BANK time and then dump the backlog in one frame — cap the debt
        // at one extra beat so the stick resumes evenly instead of bunching.
        if (run.acc > run.interval * 2) run.acc = run.interval * 2;
        while (run.acc >= run.interval && run.sent < run.want) {
          if (!payloadAvailable(run.kind, c)) { endRun("empty"); break; }
          payload = run.kind;
          // too low / on cooldown: HOLD the cadence rather than burning the
          // beat. (Cap saturation no longer lands here — dropPayload snaps an
          // over-cap round straight to its impact, so the stagger is intact.)
          if (!dropPayload(true)) break;
          run.acc -= run.interval;
          run.sent++;
        }
        if (run.active && run.sent >= run.want) endRun("done");
      }
    }
    if (!g || g.mode !== "city") {                      // mode flip: sweep the sky
      for (const b of bombs) if (b.mesh && b.mesh.parent) b.mesh.parent.remove(b.mesh);
      bombs.length = 0;
      stopBombCine();
      return;
    }
    // ---- THE FALL. Pure evaluation of each round's analytic arc; the impact
    // time was solved at release, so "have I landed" is a scalar compare, not
    // a terrain query per bomb per frame.
    for (let i = bombs.length - 1; i >= 0; i--) {
      const b = bombs[i];
      b.t += dt;
      // time since RELEASE, which reaimGuided must not be able to rewind —
      // see the release-attitude block below for why that matters.
      b.age = (b.age || 0) + dt;
      // GUIDED: re-solve the aimpoint a few times a second so a moving target
      // is still hit, then keep flying ONE parabola between solves.
      if (b.seek) {
        b.reaim -= dt;
        if (b.reaim <= 0) reaimGuided(b);
      }
      if (b.t >= b.sol.t) {
        if (b.mesh && b.mesh.parent) b.mesh.parent.remove(b.mesh);
        bombs.splice(i, 1);
        resolveImpact(b);
        continue;
      }
      bombAt(b, b.t, _bp);
      b.mesh.position.set(_bp.x, _bp.y, _bp.z);
      // nose tracks the arc: yaw down the ground track, pitch down the descent
      // angle. (The old code pitched the nose UP as it fell — positive X
      // rotation is what points a +Z nose at the ground.)
      const hsp = Math.hypot(b.vx, b.vz);
      b.mesh.rotation.y = Math.atan2(b.vx, b.vz);
      b.mesh.rotation.x = Math.atan2(-_bp.vy, hsp > 0.001 ? hsp : 0.001);
      /* ---- RELEASE ATTITUDE. A store does not leave a bay already pointing
         where it is going: it pitches and yaws off the ejector, then the fins
         weathercock it nose-down within about a second. `tumble` is that
         settling, and it decays as e^(-3t) — 5% left by 1.0 s — so the beat
         is over before the round is small on screen. rotation.z is FREE on a
         +Z-nose body (it is roll), which is why the wobble can be added
         without disturbing the yaw/pitch solve above. */
      /* IT RIDES `age`, NOT `t`, AND THAT IS THE WHOLE POINT OF THE FIELD.
         `b.t` is time on the CURRENT parabola, and reaimGuided resets it to
         0 every REAIM (0.35 s) when it re-solves a JDAM onto a moved
         aimpoint. A settle keyed to b.t would therefore restart four times a
         second and a guided round would wobble the entire way down instead
         of for the first second. `age` is time since the store left the bay
         and nothing resets it. */
      if (b.tumble > 0) {
        b.tumble = Math.exp(-3.0 * b.age);
        if (b.tumble < 0.02) b.tumble = 0;
        const w = b.tumble, p = b.phase || 0, ta = b.age;
        b.mesh.rotation.x += Math.sin(ta * 7.4 + p) * 0.55 * w;
        b.mesh.rotation.y += Math.sin(ta * 5.1 + p * 1.7) * 0.40 * w;
        b.mesh.rotation.z = Math.sin(ta * 9.3 + p * 0.6) * 0.75 * w;
      } else if (!b.ret) {
        b.mesh.rotation.z = 0;
      }
      /* ---- THE CANOPY. It is streamed at ret.t0 and inflates over TAU, so
         the visible snatch and the arithmetic that actually slows the weapon
         are the SAME event — the bomb is seen to decelerate at the frame the
         solve says it does. Under the canopy the body hangs nose-down and
         swings gently on the risers, which is the one thing that makes a
         retarded weapon read differently from a falling one. */
      const CH = b.mesh.userData && b.mesh.userData.chute;
      if (b.ret && CH) {
        const d = b.t - b.ret.t0;
        if (d >= 0) {
          const inf = 1 - Math.exp(-d / (b.ret.tau * 0.8));   // canopy inflation
          CH.visible = true;
          CH.scale.setScalar(Math.max(0.01, inf));
          if (b.mesh.userData.chutePack) b.mesh.userData.chutePack.visible = d < 0.12;
          // riser swing: a decaying pendulum about the hang point
          const sw = Math.exp(-d * 0.35) * 0.16;
          b.mesh.rotation.x += Math.sin(d * 2.3 + (b.phase || 0)) * sw;
          b.mesh.rotation.z = Math.sin(d * 1.7 + (b.phase || 0) * 1.3) * sw * 1.4;
          if (!b.chuteSfx) { b.chuteSfx = true; sfx("whoosh", { pitch: 1.25, volume: 0.45 }); }
        } else if (CH.visible) {
          CH.visible = false;
        }
      }
    }
    tickBombCine(c);
  });

  /* ==========================================================================
     3) THE BUNKER-BUSTER — penetrate DOWN, detonate INSIDE.
     Impact grammar: a sharp surface spike (cosmetic — noDamage so the
     wrapped chain ignores it), a beat of silence while it burrows, then
     the REAL detonation under the surface:
       • over a BUNKER berm  → breach the structure (bunkers.js) + an
         interior blast + a kill-bus sweep of everyone inside. The ONLY
         weapon that ends a bunker.
       • over a BUILDING roof → the one-hit through-roof kill: demolition
         takes the whole building (its own batched teardown), plus a
         ground blast through the wrapped chain for the neighbours.
       • open ground → a deep crater blast, double scorch.
  ========================================================================== */
  const pendingBusters = [];                          // {x,z,surf,t,dx,dz,speed}
  function resolveBuster(x, z, surf, vx, vz, speed) {
    if (CBZ.CONFIG.STRAT_BUNKER_BUSTER === false) {
      detonate(x, surf > 2.5 ? surf : 1.2, z, "bomb", { byPlayer: true, mass: MASS.bomb, speed: speed });
      return;
    }
    // THE ENTRY SPIKE is DRAW ONLY — a penetrator going in is a spike of dust
    // and spall, not a fireball. It used to be a raw cityExplosion with
    // noDamage, which is a damage API being called for a cosmetic; the pooled
    // dust/chunk primitives are the honest tools, they are already capped, and
    // they add no pool. The REAL detonation happens below, underground.
    const sy = surf > 2.5 ? surf : Math.max(0, surf);
    if (CBZ.cityDustKick) { try { CBZ.cityDustKick(x, sy + 0.4, z, 1.5); } catch (e) {} }
    if (CBZ.cityChunk) {
      try {
        CBZ.cityChunk(x, sy + 0.5, z, {
          count: Math.max(2, Math.round(CBZ.qScale ? CBZ.qScale(2, 6) : 5)),
          force: 5, color: 0x6f7275,
        });
      } catch (e) {}
    }
    // the burrow beat — a GBU does not go off at the surface, and the pause is
    // what sells that it is still travelling
    pendingBusters.push({ x: x, z: z, surf: surf, t: 0.4, dx: vx || 0, dz: vz || 0, speed: speed || 0 });
  }
  CBZ.onUpdate(12.5, function (dt) {
    if (!pendingBusters.length) return;
    for (let i = pendingBusters.length - 1; i >= 0; i--) {
      const p = pendingBusters[i];
      p.t -= dt;
      if (p.t > 0) continue;
      pendingBusters.splice(i, 1);
      busterDetonate(p.x, p.z, p.surf, p.dx, p.dz, p.speed);
    }
  });
  // THE THREE-WAY VERDICT, unchanged in shape — but each branch is now ONE
  // detonate() with the "buster" row (pen 40) instead of a hand-rolled blast,
  // and the BUILDING branch asks city/structural.js for the outcome instead of
  // yanking the lot straight to rubble. That is the difference between a
  // building vanishing and a building COMING DOWN.
  function busterDetonate(x, z, surf, dx, dz, speed) {
    // How deep this round actually got, in metres of concrete-equivalent. This
    // is the number the whole weapon hangs on, and it is REAL: it comes from
    // the impact speed the ballistic solver handed back, which comes from the
    // altitude and airspeed the player chose. Fast and high opens a command
    // shelter; low and slow dents the berm.
    const penCE = busterPenCE(speed);
    const kin = { mass: MASS.buster, speed: speed || 0 };

    // 1) a bunker berm under the impact → does it get THROUGH the roof?
    //    bunkers.js owns how thick its own roofs are and returns the verdict;
    //    we own what a verdict MEANS. This is the one weapon that ends a bunker.
    const bunker = CBZ.strategicBunkerHit && CBZ.strategicBunkerHit(x, z);
    if (bunker && !bunker.breached) {
      let v = null;
      try {
        v = CBZ.strategicBunkerBreach(bunker, { penCE: penCE, by: who() });
      } catch (e) { v = null; }
      // pre-penetration bunkers.js (or none): treat any hit as a breach, so a
      // partial load can never make the weapon a dud (BLOCK LAW rule 2).
      const verdict = v && v.verdict ? v.verdict : (v ? "breach" : "breach");
      const I = bunker.interior;
      const iy = (I.floorY != null ? I.floorY : 0) + 1.4;
      if (verdict === "breach") {
        // the blast lives INSIDE the room. struct is irrelevant down here (a
        // bunker is not a lot), so this is the bus doing FX + people + rumble.
        detonate(I.cx, iy, I.cz, "buster", { byPlayer: true, mass: kin.mass, speed: kin.speed });
        // guarantee the interior kill through the KILL BUS with an honest cause
        sweepKill(I.minX - 1, I.maxX + 1, I.minZ - 1, I.maxZ + 1, "airstrike");
        note("Direct hit — " + (bunker.name || "the bunker") + " is breached.", 2.6);
      } else if (verdict === "crack") {
        // through most of the roof, not all of it: the room is survivable
        // hell, the shelter guarantee HOLDS, and the player is told why.
        detonate(I.cx, iy, I.cz, "buster", {
          byPlayer: true, noDamage: false, scale: 0.45, mass: kin.mass, speed: kin.speed,
        });
        sweepKill(x - 4, x + 4, I.minZ - 1, I.maxZ + 1, "airstrike");
        note("The roof cracked but held — come in faster and higher.", 3.2);
      } else {
        // spent on the berm. Still a 2-tonne warhead going off on a hillside.
        detonate(x, Math.max(1.2, surf) + 0.8, z, "buster", {
          byPlayer: true, dirx: dx, dirz: dz, scale: 0.6, mass: kin.mass, speed: kin.speed,
        });
        note("Spent on the berm — that roof needs a faster, higher release.", 3.2);
      }
      return;
    }

    // 2) a building under the impact (came down on its roof) → THROUGH-ROOF.
    //    `pen` already carries the warhead to depth and guts the floorplates;
    //    forceCollapse is the guarantee that a GBU through a roof is fatal —
    //    but only when the round GOT there. A shallow release is now a heavy
    //    hit the ledger has to adjudicate, not a free demolition.
    //    Lot lookup delegates to the ledger's own CBZ.structure.lotAt (the
    //    hand-rolled scan this used to carry was a third copy of it).
    let hit = null;
    if (surf > 3) {
      if (CBZ.structure && CBZ.structure.lotAt) {
        try { hit = CBZ.structure.lotAt(x, z, 1.5); } catch (e) { hit = null; }
      } else {
        const A = CBZ.city && (CBZ.city.arena || CBZ.city);
        if (A && A.lots) {
          for (const lot of A.lots) {
            const b = lot.building;
            if (!b || lot.demolished) continue;
            if (Math.abs(x - b.ox) <= b.w / 2 && Math.abs(z - b.oz) <= b.d / 2) { hit = lot; break; }
          }
        }
      }
    }
    if (hit) {
      detonate(x, Math.max(1.2, surf - 3), z, "buster", {
        byPlayer: true, dirx: dx, dirz: dz, lot: hit, mass: kin.mass, speed: kin.speed,
      });
      if (penCE >= BUSTER_PEN_CE * 0.6) {              // it genuinely reached the load path
        let fell = false;
        if (CBZ.structure && CBZ.structure.forceCollapse) {
          try { fell = !!CBZ.structure.forceCollapse(hit, { by: who() }); } catch (e) { fell = false; }
        }
        // landmark tier / no ledger loaded: the pre-migration teardown still
        // applies, so a well-flown buster is never a dud (BLOCK LAW rule 2).
        if (!fell && CBZ.cityDemolition && CBZ.cityDemolition.destroy) {
          try { CBZ.cityDemolition.destroy(hit); } catch (e) {}
        }
      }
      return;
    }
    // 3) open ground → the deep crater
    detonate(x, 1.2, z, "buster", {
      byPlayer: true, dirx: dx, dirz: dz, mass: kin.mass, speed: kin.speed,
    });
    if (CBZ.cityScorch) { try { CBZ.cityScorch(x, z, 11); } catch (e) {} }
  }
  // kill-bus sweep of a rect (the buster's interior guarantee): named peds +
  // cops through their own bus entries — accurate causes, corner-feed lines.
  function sweepKill(x0, x1, z0, z1, cause) {
    for (const p of (CBZ.cityPeds || [])) {
      if (!p || p.dead || !p.pos) continue;
      if (p.pos.x >= x0 && p.pos.x <= x1 && p.pos.z >= z0 && p.pos.z <= z1 && CBZ.cityKillPed) {
        try { CBZ.cityKillPed(p, { byPlayer: true, force: 8, fling: 5 }, cause); } catch (e) {}
      }
    }
    for (const cp of (CBZ.cityCops || [])) {
      if (!cp || cp.dead || !cp.pos) continue;
      if (cp.pos.x >= x0 && cp.pos.x <= x1 && cp.pos.z >= z0 && cp.pos.z <= z1 && CBZ.cityHurtCop) {
        try { CBZ.cityHurtCop(cp, 9999, { byPlayer: true }); } catch (e) {}
      }
    }
    const P = CBZ.player;
    if (P && !P.dead && P.pos.x >= x0 && P.pos.x <= x1 && P.pos.z >= z0 && P.pos.z <= z1 && CBZ.cityHurtPlayer) {
      try { CBZ.cityHurtPlayer(9999, (x0 + x1) / 2, (z0 + z1) / 2, "caught in an airstrike", false, null, false); } catch (e) {}
    }
  }

  /* ==========================================================================
     4) THE NUKE — multi-stage, staged-over-frames, kill-bus honest.
  ========================================================================== */
  // The blast radii that used to live here (R_DESTROY, the crowd pulses) are
  // now the "nuke" ROW in systems/impactbus.js — power 9, 126 m fireball and
  // an analytic pressure field out through the 3,276 m 1 psi contour. Only the
  // numbers the bus does not own survive.
  // VEHICLES ARE NOT HERE ANY MORE. `R_CAR: 130` plus a 3-wrecks-per-frame
  // queue used to live in this block; systems/impactbus.js now snapshots the
  // nuke's cars once and drains their arrival jobs through a shared budget.
  // Conventional wave-carrying warheads retain sweepRing. Keeping ours would
  // have billed the nuke's cars twice. Deleted, not disabled.
  /* ---- THE CONSEQUENCE RADII, TAKEN FROM THE RESEARCHED RINGS -----------
     OWNER: "the amount of DEATH in the radius should also be REAL."
     These three were framing numbers — 175 m of cops, a 160 m instant-death
     bubble and a 70 m hot zone — for an event whose 5 psi collapse contour
     is 1,109 m and whose 1 psi contour is 3,276 m. city/nukefx.js publishes
     CBZ.nukeRings() (the yield inverted out of the bus row, then Glasstone's
     1 kt reference radii cube-root scaled) and CBZ.nukeLethalAt() (the USSBS
     Hiroshima killed-by-distance survey). Both are read LIVE here, so this
     file carries no second copy of either and cannot drift from the bus.
     Degrade-safe: with nukefx.js absent every one falls back to the exact
     number it had before.                                               */
  function rings() {
    if (CBZ.nukeRings) { try { return CBZ.nukeRings(126); } catch (e) {} }
    return null;
  }
  function lethalAt(r) {
    if (CBZ.nukeLethalAt) { try { return CBZ.nukeLethalAt(r, 126); } catch (e) {} }
    return r < NK.R_KILL ? 1 : 0;                 // legacy: the flat cliff
  }
  const NK = {
    // Cop roster sweep. The bus does not own this roster, so this file compiles
    // it once through the same 1 psi/person consequence reach.
    R_KILL: 175,         // fallback only; nkKillR() below is the live answer
    R_PLAYER: 160,       // fallback only; nkPlayerR() below is the live answer
    RAD_R: 70,           // fallback only; nkRadR() below is the live answer
    RAD_DAYS: 1.2,       // in-game days the zone stays hot
    /* ---- THE PLANTED-DEVICE CLOCK, and why it is not 45 any more ---------
       RESEARCH. The real article is the SADM (Special Atomic Demolition
       Munition, W54) and its bigger brother the MADM (W45): hand-emplaced by
       a two-man team, armed by a deliberate multi-step sequence and fired by
       a MECHANICAL TIMER whose only job was to outlast the team's withdrawal.
       The doctrinal problem with the whole weapon class was exactly that
       arithmetic — the delay had to beat the distance a team on foot could
       cover, and for many assigned targets it did not. That tension is the
       mechanic; it is not something to design around.

       SO THE NUMBER IS CHECKED AGAINST THIS GAME'S OWN DISTANCES:
         5 psi severe-blast contour    = 1,109 m
         2 psi wall/thermal contour    = 2,016 m
         a sprinting player           = walk 7 * sprint 1.7        = 11.9 m/s
                                        (systems/physics.js's own numbers)
         a car in traffic             = ~22 m/s sustained
       => clear 5 psi on foot              1,109 / 11.9 =  93.2 s
       => clear 5 psi by car               1,109 / 22   =  50.4 s
       => reach 2 psi by car               2,016 / 22   =  91.6 s

       TIMER = 90 s. On foot, open-air escape is intentionally not guaranteed;
       that is what the bunker is for. A car reaches roughly the 2 psi contour
       by detonation and the analytic front needs about four more seconds to
       arrive, which supplies the last separation. The answer is a vehicle or
       shelter, not pretending the real 3,276 m glass reach is only 900 m.

       ARM = 6 s of arming BEFORE the clock starts, in three beats. Real
       weapons cannot be made live by putting them down: a PAL unlock, then
       arming, then the timer. It is fully abortable, which is what makes
       setting it a decision rather than a button. */
    TIMER: 90,           // planted-device countdown (seconds, real)
    ARM: 6,              // arming sequence before the clock starts
    ARM_BEATS: 3,        // safe -> armed -> hot
  };
  // Flag-off returns the pre-2026-07-28 arc verbatim: 45 s, no arming beat.
  function nkTimer() { return CBZ.CONFIG.NUKE_GROUND_COUNTDOWN === false ? 45 : NK.TIMER; }
  function nkArm() { return CBZ.CONFIG.NUKE_GROUND_COUNTDOWN === false ? 0 : NK.ARM; }
  /* The cop roster is compiled once, so there is no performance reason to
     truncate it at 2 psi. It follows the same 1 psi field/fatality reach as
     every other person and is drained only when the shock arrives. */
  function nkKillR() { const T = rings(); return T ? T.psi1 : NK.R_KILL; }
  /* INSTANT, UNCONDITIONAL DEATH IS THE FIREBALL AND NOTHING ELSE (126 m).
     Everything outside it is the bus's graded wave, which now hurts the
     player on the researched curve instead of a 160 m on/off bubble — so
     you can be badly mauled at 400 m and limp away, which is both truer and
     a better game than a hard kill line inside the collapse radius. */
  function nkPlayerR() { const T = rings(); return T ? T.fireball : NK.R_PLAYER; }
  /* The 500 rem prompt-dose contour — about a 50% lethal dose untreated.
     Prompt gamma and neutrons attenuate exponentially in air, so this does
     NOT ride the cube root (see nukeRings): ~1,052 m for this yield. That is
     15x the 70 m this file used to claim. */
  function nkRadR() { const T = rings(); return T ? T.rad500 : NK.RAD_R; }
  let nk = null;                                     // the one live resolution
  const radZones = [];                               // {x,z,r,until}

  /* ---- THE MUSHROOM CLOUD IS NOT HERE ANY MORE.
     It was ~70 lines of bespoke geometry, three module-shared materials and a
     per-frame animator that only the nuke could ever use. The spectacle now
     belongs to the ordnance bus's "nuke" FX composer (city/nukefx.js registers
     it with CBZ.impact.fx("nuke", fn)) — one registration, zero edits here,
     and any future warhead can name the same composer.

     The white flash below survives as the DEGRADE PATH only: if nukefx.js is
     not loaded the bus falls back to the generic heavy composer, and a nuke
     with no whiteout would read as a large car fire. It is deliberately NOT
     registered as a composer, so it can never clobber the real one whichever
     file loads first.                                                       */
  function whiteout() {
    if (typeof document === "undefined" || !document.body) return;
    let el = document.getElementById("nukeFlash");
    if (!el) {
      el = document.createElement("div");
      el.id = "nukeFlash";
      el.style.cssText = "position:fixed;inset:0;background:#fff;opacity:0;pointer-events:none;z-index:80;transition:opacity 2.8s ease-out";
      document.body.appendChild(el);
    }
    el.style.transition = "none"; el.style.opacity = "1";
    // double rAF so the snap-to-white paints before the long fade starts
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      el.style.transition = "opacity 2.8s ease-out"; el.style.opacity = "0";
    }); });
  }

  /* ---- BUNKER SHELTER GUARD ------------------------------------------------
     The nuke's people-damage is the bus's job now (its analytic field owns
     the crowd/ped/player arrivals and researched lethality curve).
     The bus knows nothing about bunkers, and "an intact berm holds" is THIS
     file's rule — so we assert it the way this repo asserts every other
     cross-module rule: a lazy, marker-copying wrapper on the kill bus. It is
     one boolean test (`nk` null) whenever a nuke is not resolving, and it is
     scoped to the resolution window, so it cannot change ordinary combat.  */
  let _guardWrapped = false;
  function wireShelterGuard() {
    if (_guardWrapped) return;
    const orig = CBZ.cityKillPed;
    if (typeof orig !== "function") return;
    if (orig._stratShelterWrapped) { _guardWrapped = true; return; }
    const wrapped = function (p) {
      if (nk && p && p.pos && CBZ.strategicBunkerShelterAt) {
        try { if (CBZ.strategicBunkerShelterAt(p.pos.x, p.pos.y, p.pos.z)) return undefined; } catch (e) {}
      }
      return orig.apply(this, arguments);
    };
    for (const k in orig) if (k.endsWith("Wrapped")) wrapped[k] = orig[k];
    wrapped._stratShelterWrapped = true;
    CBZ.cityKillPed = wrapped;
    _guardWrapped = true;
  }

  /* ---- THE DETONATION.
     Everything that used to live here as bespoke machinery — the scheduled
     ring of explosions, the rolling per-frame demolition of every lot inside
     150 m, the three expanding crowd-kill pulses, the 24-actors-per-frame
     sweep, the mushroom cloud and its point light — is GONE. All of it is one
     row + one call now: the bus compiles finite target queues and resolves
     each against one analytic shock-arrival/pressure model. The structural
     ledger decides each building's fate, so towers catch fire, sag and
     pancake instead of blinking into rubble or being rediscovered every tick.

     What stays is what only this file knows: the bunker shelter guarantee,
     the wanted/panic consequence, the lingering radiation zone, and
     one-apocalypse-at-a-time.                                               */
  function nukeDetonate(x, z, opts) {
    if (CBZ.CONFIG.STRAT_NUKE === false) {
      detonate(x, 1.2, z, "bomb", { byPlayer: true });
      return;
    }
    if (nk) return;                                   // one apocalypse at a time
    if (!g || g.mode !== "city") return;
    opts = opts || {};
    wireShelterGuard();
    const y = (CBZ.floorAt ? CBZ.floorAt(x, z) : 0) + 1.2;

    // Open the shelter/resolution window BEFORE any consequence is evaluated.
    // The analytic field reaches this 16 kt row's 1 psi contour in ~7.7 s; the
    // longer hold keeps the guard alive through queued collapses and fires.
    nk = {
      t: 0, x: x, z: z, hold: 24,
      copQueue: null, copI: 0, copExamined: 0, copsDone: false,
    };

    // ---- the player's shelter state is decided now; the verdict is not. The
    // pressure field applies damage and horizontal body drag when the same
    // shock that drives sound reaches the player.
    const P = CBZ.player;
    if (P && !P.dead) {
      const sheltered = !!(CBZ.strategicBunkerShelterAt && CBZ.strategicBunkerShelterAt(P.pos.x, P.pos.y, P.pos.z));
      const pd = Math.hypot(P.pos.x - x, P.pos.z - z);
      if (sheltered) {
        g.invuln = Math.max(g.invuln || 0, 12);       // the blast wave passes OVER
        if (pd < nkKillR()) note("The bunker holds. Outside, there is nothing left.", 4);
      }
    }

    // ---- consequence: the whole state turns on you. The star API grants the
    // owner-reserved 5th star only for a military-scale reason — this is one.
    if (CBZ.cityCrime) { try { CBZ.cityCrime(400, { x: x, z: z, type: "terrorism", instant: true }); } catch (e) {} }
    if (CBZ.cityAddStars) { try { CBZ.cityAddStars(5, "Nuclear detonation — military response"); } catch (e) {} }
    // panic buses (the loudest possible scare, C4's exact pattern)
    if (CBZ.cityPostEvent) { try { CBZ.cityPostEvent({ type: "explosion", pos: { x: x, y: 1, z: z }, radius: 400, intensity: 4 }); } catch (e) {} }
    if (CBZ.cityEvent) { try { CBZ.cityEvent("explosion", { x: x, z: z, panic: 40, damage: 30 }, { silent: true, noWanted: true }); } catch (e) {} }

    // The shared airstrike/RPG near-field already lays one central blast stain.
    // Do not add evenly spaced scorch decals here: from altitude they merge
    // into the exact fake ground ring a real pressure front does not leave.
    radZones.push({ x: x, z: z, r: nkRadR(), until: (CBZ.dayTime ? CBZ.dayTime() : 0) + NK.RAD_DAYS });

    // degrade path only — see whiteout()'s note. With nukefx.js loaded the
    // composer owns the flash, the fireball, the stem and the cap.
    if (!(CBZ.impact && CBZ.impact.hasFx && CBZ.impact.hasFx("nuke"))) {
      whiteout();
      if (CBZ.shake) { try { CBZ.shake(6); } catch (e) {} }
      if (CBZ.doHitstop) { try { CBZ.doHitstop(0.22); } catch (e) {} }
    }
    // ONE CALL. The row does the rest.
    detonate(x, y, z, "nuke", { byPlayer: opts.byPlayer !== false, by: opts.by });
  }
  CBZ.strategicNukeDetonate = nukeDetonate;           // probe/tooling handle

  /* ==========================================================================
     THE ORDERED SORTIE — you name a place; the bomber actually goes there.

     OWNER (2026-08-04): "they should be able to order a nuke on a place and
     literally in the game, a B-2 should fly to that place and drop a nuke. The
     same way that it works when you currently drop a nuke in pilot."

     The last four words are the whole specification, and they are why this is
     ~150 lines instead of a second weapon system. There is no delivery code
     here. The sortie flies an aeroplane to a point and calls releaseStore()
     with a bay position and a release velocity — the identical call the [B]
     key makes. From that instant the file cannot tell the two apart: the same
     closed-form solve, the same B61 laydown parachute, the same tumble, the
     same bombAt() evaluation, the same resolveImpact -> nukeDetonate -> the
     bus. A player watching the weapon come down is watching the exact arc his
     own release would have flown, because it IS that arc.

     WHAT THIS REPLACES. CBZ.strategicCallStrike (above) is the file's older
     answer to "bomb that district with nobody in the cockpit", and it is a
     ground effect: it authors impact points and hands them to cityBombWalk. No
     aircraft exists, which is exactly the complaint — you order a strike and
     the sky stays empty. That path stays as-is for IRON (it is 12 rounds of
     2000 lb and a bomb walk is the honest picture of one); a nuclear order is
     a single weapon on a single aeroplane and now gets the aeroplane.

     THE AEROPLANE IS THE ONE ON THE APRON. This does not build a B-2 — it
     CLAIMS the parked one through the same ownership protocol aircraft.js's
     fighter scramble uses (cityClaimMilitaryVehicle / cityReleaseMilitaryVehicle,
     militaryvehicles.js), flies b2rec.group itself, and re-parks it on return.
     Three things fall out for free and none of them are bookkeeping:
       · the apron is genuinely EMPTY while your strike is in the air, and the
         boarding verb is genuinely gone, because it is the same airframe;
       · steal the bomber, or blow it up, and nobody can order a strike — the
         order is backed by an object in the world, not by a flag;
       · a real garrison trooper flies it (CBZ.airSeatActor puts him in the
         seat aircraft.js solved), so the crew is a person, not a fiction.
     No aircrew on the base, no sortie. That is the honest refusal.
     ========================================================================== */
  if (CBZ.CONFIG.STRAT_NUKE_SORTIE == null) CBZ.CONFIG.STRAT_NUKE_SORTIE = true;
  const SORTIE = {
    ALT: 210,          // release altitude AGL over the aimpoint — see below
    SPD: 165,          // ingress ground speed, m/s
    EGRESS_SPD: 205,   // and what it runs home at once the bay is empty
    RTB: 26,           // s of egress before the airframe is back on its pad
    WARN: 0.9,         // s between inbound engine notes
  };
  // WHY 210 m. retardFor() streams the canopy only when the free fall does not
  // already buy the bomber its escape (RET.T_ESCAPE = 12 s). A 210 m release
  // falls in sqrt(2*210/14) = 5.5 s ballistic — comfortably short of 12 — so
  // this profile ALWAYS takes the retarded laydown, which is both the real B61
  // delivery rule and the reason you get to watch a parachute come down.
  let sortie = null;

  /* WHERE THE RUN-IN STARTS. playerair.js's called jet enters from a point on
     the ARENA's edge, which is right for a city-block strike and wrong here:
     the arena is the built-up blocks, and Fort Brandt (and half of what you
     would ever nuke) is outside it, so an arena-edge ingress can put the
     aeroplane between the base and the mark and have it fly outward.
     This aeroplane has a home, so the run-in is authored off the home: the
     line from the pad to the aimpoint, backed up INGRESS metres. That is
     always well-defined, always reads as a departure from the base the bomber
     actually left, and gives a fixed ~5.5 s of visible run-in whatever the
     world's scale — which no bounds-derived number can promise. */
  const SORTIE_INGRESS = 900;
  function sortieRunIn(tx, tz) {
    const h = (b2rec && (b2rec._aiHome || b2rec.pos)) || { x: 0, z: 0 };
    let dx = tx - h.x, dz = tz - h.z;
    let len = Math.hypot(dx, dz);
    if (!(len > 0.001)) { dx = 0; dz = 1; len = 1; }     // ordered onto the pad itself
    return { x: tx - (dx / len) * SORTIE_INGRESS, z: tz - (dz / len) * SORTIE_INGRESS };
  }

  // A free trooper to fly it, by the same test aircraft.js applies before it
  // scrambles anyone: alive, not already crewing something, not otherwise busy.
  function sortieCrew() {
    const troops = CBZ.cityMilitaryPersonnel || [];
    let best = null, bd = Infinity;
    for (let i = 0; i < troops.length; i++) {
      const p = troops[i];
      if (!p || p.dead || p._milPilot || p._airPilot) continue;
      if (CBZ.body && CBZ.body.busy) { try { if (CBZ.body.busy(p)) continue; } catch (e) {} }
      if (!p.pos || !b2rec) continue;
      const d = Math.hypot(p.pos.x - b2rec.pos.x, p.pos.z - b2rec.pos.z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  /* WHERE TO LET GO — solved, not tuned.
     Every other "the jet drops when it is N metres out" number in this repo is
     a guess (playerair.js releases at a flat 55 m). It does not have to be:
     the ballistics here are closed-form, so the honest way to find the release
     point is to run the SAME solve the release will run and subtract. This
     probes a release directly over the aimpoint at cruise, reads how far
     downrange the weapon actually travels — including the canopy's horizontal
     decay integral, which no hand-picked constant would have known about —
     and hands back that offset. Release point = aimpoint - throw.
     One consequence worth stating: `rv` is computed once and REUSED at the
     real release. The ingress leg is straight and level at constant speed, so
     the release velocity is identical at both moments by construction; caching
     it makes the prediction and the event the same numbers rather than two
     solves that could disagree, and keeps ordnanceAudit()'s call count honest
     at one release per sortie. */
  function sortieSolve(tx, tz, vx, vz) {
    const gy = surfaceAt(tx, tz);
    const y0 = gy + SORTIE.ALT + BAY_LOCAL.y;
    const rv = releaseVel({ vx: vx, vy: 0, vz: vz }, "nuke");
    const probe = { x0: tx, y0: y0, z0: tz, vx: rv.vx, vy: rv.vy, vz: rv.vz };
    let sol = solveFall(probe.x0, probe.y0, probe.z0, probe.vx, probe.vy, probe.vz);
    const ret = retardFor("nuke", probe.y0, probe.vy, sol.y);
    if (ret) sol = solveRetard(probe, ret, sol);
    return {
      y: y0 - BAY_LOCAL.y,                       // the aircraft's own altitude
      throwX: sol.x - tx, throwZ: sol.z - tz,    // how far downrange it lands
      fall: sol.t,
      rv: { vx: rv.vx, vy: rv.vy, vz: rv.vz },   // releaseVel returns SHARED scratch — copy it
    };
  }

  function sortieEnd(crashed) {
    if (!sortie) return;
    const s = sortie;
    sortie = null;
    const p = s.pilot;
    if (p) {
      if (CBZ.npcLife && CBZ.npcLife.detach) {
        p._seatHold = false;
        try { CBZ.npcLife.detach(p, { state: p.dead ? "dead" : "walk" }); } catch (e) {}
      }
      p._milPilot = null; p.inCar = false;
      if (!crashed && s.home) {
        p.pos.set(s.home.x + 3, 0, s.home.z + 2);
        if (p.group) { p.group.position.copy(p.pos); p.group.visible = true; }
      }
    }
    if (b2rec && CBZ.cityReleaseMilitaryVehicle) {
      try { CBZ.cityReleaseMilitaryVehicle(b2rec, !!crashed); } catch (e) {}
    }
    // A LOST AIRFRAME MUST NOT BE LEFT IN THE SKY. cityReleaseMilitaryVehicle
    // deliberately does NOT re-park a destroyed record (a shot-down machine
    // never silently reappears on its pad) — which for a flying one would have
    // parked a B-2 at 210 m forever. Destroyed here means destroyed: the mesh
    // goes with the record, so the world's answer to "where is the bomber" is
    // the same whether you ask the registry or your eyes. It stays `taken`, so
    // shooting down the aircrew costs the base its bomber permanently.
    if (crashed && b2rec && b2rec.group) {
      b2rec.group.visible = false;
      note("The bomber is down. There is no second one.", 3.2, { from: "Strategic Command", app: "messages" });
    }
  }

  /* THE ORDER. opts:
       x, z        the aimpoint (required, finite)
       by/byPlayer blame, forwarded verbatim to nukeDetonate through the store
       label       what to call the place in the warning line
     Returns { ok:true } or { ok:false, why } — a STRING the caller can put in
     front of the player, because every refusal here is a real world fact and
     deserves to be said out loud rather than swallowed as a silent false. */
  function nuclearSortie(opts) {
    opts = opts || {};
    if (CBZ.CONFIG.STRAT_NUKE_SORTIE === false || CBZ.CONFIG.STRAT_NUKE === false) {
      return { ok: false, why: "Strategic command is offline." };
    }
    if (!g || g.mode !== "city") return { ok: false, why: "Not here." };
    const tx = +opts.x, tz = +opts.z;
    if (!isFinite(tx) || !isFinite(tz)) return { ok: false, why: "Mark a target first." };
    if (sortie) return { ok: false, why: "A sortie is already airborne." };
    // The nuclear channel admits one apocalypse at a time and always has —
    // refuse BEFORE anything is claimed or debited, the way dropPayload does.
    if (nuclearChannelBusy()) return { ok: false, why: "Nuclear channel busy — one weapon at a time." };
    if (!b2rec || !b2rec.group || !b2rec.group.parent) return { ok: false, why: "There is no bomber." };
    if (b2rec.taken || b2rec._aiActive) return { ok: false, why: "The bomber is not on its pad." };
    const pilot = sortieCrew();
    if (!pilot) return { ok: false, why: "No aircrew left on the base." };
    if (!CBZ.cityClaimMilitaryVehicle || !CBZ.cityClaimMilitaryVehicle(b2rec, pilot)) {
      return { ok: false, why: "The bomber will not release from its pad." };
    }
    pilot._milPilot = true;

    const from = sortieRunIn(tx, tz);
    const dx = tx - from.x, dz = tz - from.z;
    const len = Math.hypot(dx, dz) || 1;
    const ax = dx / len, az = dz / len;
    const sol = sortieSolve(tx, tz, ax * SORTIE.SPD, az * SORTIE.SPD);

    const grp = b2rec.group;
    grp.visible = true;
    grp.position.set(from.x, sol.y, from.z);
    grp.rotation.set(0, Math.atan2(ax, az), 0);       // models here face +Z at yaw 0
    // PUT THE MAN IN THE SEAT BEFORE THE AEROPLANE MOVES. airSeatActor solves
    // the anchor with the same code the fighter scramble uses — including the
    // seated-eye correction — so no head comes through this canopy either. He
    // is a real body up there: shoot him down and the sortie dies with him.
    if (CBZ.airSeatActor) {
      try {
        CBZ.airSeatActor({ group: grp, airClass: "airliner", displayName: "B-2 SPIRIT", modelYawOffset: 0 }, pilot);
      } catch (e) {}
    }

    sortie = {
      group: grp, pos: grp.position, pilot: pilot,
      home: Object.assign({}, b2rec._aiHome || { x: b2rec.pos.x, z: b2rec.pos.z }),
      tx: tx, tz: tz, ax: ax, az: az,
      // the point on the run-in at which letting go puts the weapon on the mark
      rx: tx - sol.throwX, rz: tz - sol.throwZ,
      rv: sol.rv, alt: sol.y,
      by: opts.by, byPlayer: opts.byPlayer !== false,
      phase: "inbound", t: 0, sndT: 0,
    };
    // The city gets told, once, the way every other inbound is told.
    note("NUCLEAR SORTIE AIRBORNE — one weapon inbound on " +
      (opts.label || "your mark") + ". Get underground.", 4.2,
      { from: "Strategic Command", app: "messages" });
    if (CBZ.sfxAt) { try { CBZ.sfxAt("siren", tx, tz, { volume: 0.4 }); } catch (e) {} }
    return { ok: true };
  }
  CBZ.strategicNuclearSortie = nuclearSortie;

  // ---- the sortie tick. 42.55 sits between playerair.js's called jet (42.5)
  // and airtraffic.js's ambient fleet (42.7): all three move aircraft, and
  // keeping them adjacent is how the band stays readable.
  CBZ.onUpdate(42.55, function (dt) {
    if (!sortie) return;
    const s = sortie;
    if (!g || g.mode !== "city" || !s.group || !s.group.parent) { sortieEnd(false); return; }
    // Kill the man in the seat and the aeroplane is nobody's — it goes down
    // with him, exactly as a scrambled fighter does.
    if (s.pilot && s.pilot.dead) { sortieEnd(true); return; }
    const spd = s.phase === "inbound" ? SORTIE.SPD : SORTIE.EGRESS_SPD;
    s.t += dt;
    s.pos.x += s.ax * spd * dt;
    s.pos.z += s.az * spd * dt;

    // THE BOMBER IS THE WARNING. Same instrument playerair.js's strike jet
    // uses: a repeating engine note keyed to the player's TRUE distance, so a
    // nuclear sortie announces itself as a far-off rumble that swells into an
    // overhead roar. force+ghost so the cadence can neither starve nor be starved.
    s.sndT -= dt;
    if (s.sndT <= 0 && CBZ.sfx) {
      s.sndT = SORTIE.WARN;
      const P = CBZ.player;
      const d = P && P.pos ? Math.hypot(s.pos.x - P.pos.x, s.pos.z - P.pos.z) : 999;
      try { CBZ.sfx("rumble", { dist: d, volume: 0.85, force: true, ghost: true }); } catch (e) {}
    }

    if (s.phase === "inbound") {
      // released the instant the run-in reaches the solved release point
      if ((s.pos.x - s.rx) * s.ax + (s.pos.z - s.rz) * s.az >= 0) {
        s.phase = "egress";
        s.t = 0;
        // ONE call, and it is the player's own. bayPoint() reads the real
        // model, so the weapon leaves the real bay of the real aeroplane.
        releaseStore("nuke", bayPoint(s), s.rv, { by: s.by, byPlayer: s.byPlayer });
        note("WEAPON AWAY.", 2.4, { from: "Strategic Command", app: "messages" });
      }
    } else if (s.t > SORTIE.RTB) {
      sortieEnd(false);                               // feet dry, back on the pad
    }
  });

  // Read-only: what the strike console and any probe need to know.
  CBZ.strategicSortieState = function () {
    if (!sortie) {
      return {
        active: false,
        bomber: !!(b2rec && b2rec.group && b2rec.group.parent && !b2rec.taken && !b2rec._aiActive),
        crew: !!sortieCrew(), channelBusy: nuclearChannelBusy(),
      };
    }
    return {
      active: true, phase: sortie.phase, bomber: false, crew: true,
      channelBusy: nuclearChannelBusy(),
      x: sortie.pos.x, y: sortie.pos.y, z: sortie.pos.z,
      tx: sortie.tx, tz: sortie.tz,
      pilot: sortie.pilot ? (sortie.pilot.name || "aircrew") : null,
    };
  };

  // ---- the aftermath resolver (order 34.7 — after systems/impactbus.js's
  // wave (34.4), city/structural.js's ledger (34.45) and demolition's ticker
  // (34.5), so anything condemned this frame has already been handed on).
  let _lastEl = 0;
  CBZ.onUpdate(34.7, function (dt) {
    wireShelterGuard();
    // fresh-run detection (the C4 g.elapsed-rewind trick): a new run must not
    // inherit radiation zones, armed devices, falling bombs or a half-resolved
    // apocalypse from the previous life of the city.
    const el = g.elapsed || 0;
    if (el + 0.001 < _lastEl) {
      radZones.length = 0;
      pendingBusters.length = 0;
      for (const b of bombs) if (b.mesh && b.mesh.parent) b.mesh.parent.remove(b.mesh);
      bombs.length = 0;
      for (const a of armed) if (a.mesh && a.mesh.parent) a.mesh.parent.remove(a.mesh);
      armed.length = 0;
      run.active = false; run.onDone = null; run.sent = 0;
      nk = null;
      sortieEnd(false);                    // and the bomber goes back on its pad
      if (CBZ.impact && CBZ.impact.clearWaves) { try { CBZ.impact.clearWaves(); } catch (e) {} }
    }
    _lastEl = el;
    // radiation zones tick even after the resolution finishes
    if (radZones.length) {
      const now = CBZ.dayTime ? CBZ.dayTime() : 0;
      const P = CBZ.player;
      for (let i = radZones.length - 1; i >= 0; i--) {
        const zn = radZones[i];
        if (now - 0.0001 > zn.until) { radZones.splice(i, 1); continue; }
        if (!P || P.dead || g.mode !== "city") continue;
        const d = Math.hypot(P.pos.x - zn.x, P.pos.z - zn.z);
        if (d < zn.r && !(CBZ.strategicBunkerShelterAt && CBZ.strategicBunkerShelterAt(P.pos.x, P.pos.y, P.pos.z))) {
          zn._acc = (zn._acc || 0) + 4 * dt * (1 - d / zn.r + 0.25);
          if (zn._acc >= 2) {
            zn._acc = 0;
            try { CBZ.cityHurtPlayer(2, zn.x, zn.z, "radiation sickness", false, null, false); } catch (e) {}
          }
        }
      }
    }
    if (!nk) return;
    if (g.mode !== "city") { nk = null; return; }      // mode flip mid-apocalypse
    nk.t += dt;

    /* COPS are a separate roster, but use the field's same arrival, pressure,
       horizontal drag and deterministic lethality. Their roster is compiled
       once, sorted once, and consumed through a cursor — never rescanned. */
    if (!nk.copsDone) {
      if (!nk.copQueue) {
        nk.copQueue = [];
        const cops = CBZ.cityCops || [], RK = nkKillR(), R2 = RK * RK;
        for (let i = 0; i < cops.length; i++) {
          const cp = cops[i];
          if (!cp || cp.dead || !cp.pos) continue;
          const dx = cp.pos.x - nk.x, dz = cp.pos.z - nk.z, d2 = dx * dx + dz * dz;
          if (d2 > R2) continue;
          const d = Math.sqrt(d2);
          const at = CBZ.impact && CBZ.impact.shockArrival
            ? CBZ.impact.shockArrival(d, 126) : d / 343;
          nk.copQueue.push({ ref: cp, d: d, at: at });
        }
        nk.copQueue.sort(function (a, b) { return a.at - b.at; });
      }
      let killed = 0, examined = 0;
      const EXAMINE_CAP = 24;                       // roster work per frame
      while (nk.copI < nk.copQueue.length && examined < EXAMINE_CAP && killed < 12) {
        const job = nk.copQueue[nk.copI];
        if (job.at > nk.t) break;
        nk.copI++;
        const cp = job.ref;
        examined++;
        nk.copExamined++;
        if (!cp || cp.dead || !cp.pos) continue;
        if (CBZ.strategicBunkerShelterAt && CBZ.strategicBunkerShelterAt(cp.pos.x, cp.pos.y, cp.pos.z)) continue;
        const dx = cp.pos.x - nk.x, dz = cp.pos.z - nk.z;
        const dl = Math.hypot(dx, dz) || 1;
        const dir = { x: dx / dl, y: 0, z: dz / dl };
        const pk = lethalAt(job.d);
        const roll = CBZ.hash01 ? CBZ.hash01(cp.pos.x, cp.pos.z, 0x4e0c) : Math.random();
        const force = CBZ.impact && CBZ.impact.nuclearDragAt
          ? CBZ.impact.nuclearDragAt(job.d, 126) : 0;
        if (roll < pk) {
          if (CBZ.cityHurtCop) { try { CBZ.cityHurtCop(cp, 9999, {
            byPlayer: true, fromX: nk.x, fromZ: nk.z, dir: dir,
            // Keep cityRagdoll below its point-impact loft threshold: broad
            // nuclear wind topples and translates, it does not kick upward.
            force: Math.min(13.5, force), fling: 0, kind: "nuke" }); } catch (e) {} }
          killed++;
        } else if (force > 0.45 && CBZ.body && CBZ.body.hit) {
          const psi = CBZ.impact && CBZ.impact.nuclearPressureAt
            ? CBZ.impact.nuclearPressureAt(job.d, 126) : 0;
          try { CBZ.body.hit(cp, { dir: dir, force: force,
            knockdown: psi >= 2 ? 1.3 : 0 }); } catch (e) {}
        }
      }
      /* The old completion test was `seen === 0`. Any officer inside the radius
         who SURVIVED the probability roll made `seen` positive forever, so the
         entire cop roster was rescanned every frame for the full 24-second
         aftermath. A snapshot cursor gives the intended semantics directly:
         every officer present at detonation gets one deterministic verdict,
         then the work ends. */
      if (nk.copI >= nk.copQueue.length) {
        nk.copsDone = true;
        nk.copQueue = null;
      }
    }

    // (vehicles: see the note on NK — the bus's blast ring owns them now)

    // The shelter guard and `nukeActive` stay live through the analytic shock
    // field and the fires it lit; visual timing no longer determines physics.
    if (nk.t > nk.hold) nk = null;
  });

  /* ==========================================================================
     5) THE PLACED DEVICE — carry it in, set the timer, get out (or don't).
     Both verbs live in the ONE interaction registry (touch pills for free,
     HUD doctrine intact: no new chrome, the killfeed carries the deaths).
  ========================================================================== */
  const armed = [];                                   // {x,z,t,arm,mesh,beep,phase}
  /* THE PLANTED DEVICE. Same warhead the vault holds and the bay drops — it
     lies on its own transport skid with an arming panel bolted to the flank,
     because what you set down is a weapon, not a prop. The LED is the one
     thing on it that moves, and it says which PHASE the device is in: amber
     while it arms, red once the clock is running, and its strobe rate rides
     the clock down. Parked colours are minted once (module-lifetime, like
     every other pooled material here). */
  let _ledAmber = null, _ledRed = null, _ledDark = null;
  function ledMats() {
    if (_ledRed) return;
    _ledRed = new THREE.MeshBasicMaterial({ color: 0xff3030 });
    _ledAmber = new THREE.MeshBasicMaterial({ color: 0xffb020 });
    _ledDark = new THREE.MeshBasicMaterial({ color: 0x321208 });
    _ledRed._shared = _ledAmber._shared = _ledDark._shared = true;
  }
  function deviceMesh() {
    bombAssets();
    ledMats();
    if (CBZ.CONFIG.NUKE_FX_V2 === false || !CBZ.nukeWarhead) {
      const gp0 = bombMesh("nuke");
      gp0.rotation.x = 0;                             // lies flat on the ground
      gp0.rotation.z = Math.PI / 2;
      const led0 = new THREE.Mesh(bg(0.12, 0.12, 0.12), _ledRed);
      led0.position.set(0, 0.55, 0);
      gp0.add(led0);
      gp0.userData.led = led0;
      return gp0;
    }
    const gp = new THREE.Group();
    // the weapon itself, lying on its side, nose along +X (no rotation needed)
    const w = CBZ.nukeWarhead({ mat: nukeMat, geo: bg, chute: false });
    gp.add(w);
    // a low transport skid so it is not floating on its own curvature
    const skid = new THREE.Mesh(bg(1.9, 0.10, 0.72), nukeMat(0x4a5058));
    skid.position.set(0, -WH.RAD - 0.05, 0);
    gp.add(skid);
    for (const s of [-0.62, 0.62]) {
      const chock = new THREE.Mesh(bg(0.16, 0.20, 0.60), nukeMat(0x3a4046));
      chock.position.set(s, -WH.RAD + 0.08, 0);
      gp.add(chock);
    }
    // THE ARMING PANEL — the reason this reads as armed and not as dropped
    const panel = new THREE.Mesh(bg(0.42, 0.26, 0.06), nukeMat(0x24282d));
    panel.position.set(-0.18, WH.RAD * 0.42, WH.RAD * 0.94);
    gp.add(panel);
    const led = new THREE.Mesh(bg(0.09, 0.09, 0.09), _ledRed);
    led.position.set(-0.05, WH.RAD * 0.42, WH.RAD * 1.02);
    gp.add(led);
    gp.userData.led = led;
    // the safing pin's pigtail, pulled: a small red flag on the tail
    const flag = new THREE.Mesh(bg(0.02, 0.13, 0.16), nukeMat(WH_COL.arm));
    flag.position.set(-WH.LEN * 0.5 + 0.10, WH.RAD + 0.10, 0);
    gp.add(flag);
    gp.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    return gp;
  }
  // The device's LED, driven by phase. Swapping the MATERIAL rather than
  // toggling `visible` keeps the strobe readable from the far side of a
  // street, where a 9 cm cube blinking out reads as nothing at all.
  function ledPhase(a) {
    const led = a.mesh && a.mesh.userData && a.mesh.userData.led;
    if (!led) return;
    if (a.arm > 0) {
      // arming: a slow, deliberate amber pulse, one per beat
      const beat = NK.ARM / Math.max(1, NK.ARM_BEATS);
      led.material = ((a.arm % beat) / beat) < 0.55 ? _ledAmber : _ledDark;
      return;
    }
    // running: the strobe accelerates all the way down, so the device is
    // legible as "how long have I got" without a HUD element existing.
    const hz = a.t < 10 ? 8 : a.t < 30 ? 4 : 2;
    led.material = ((a.t * hz) % 1) < 0.5 ? _ledRed : _ledDark;
  }
  let _plantWired = false;
  function wirePlantZones() {
    if (_plantWired || !CBZ.interactions || !CBZ.interactions.registerZone) return;
    const I = CBZ.interactions;
    const _plantTok = { x: 0, z: 0 };            // stable identity → no panel churn
    I.registerZone({
      id: "nuke-plant", kind: "nukeplant", radius: 2,
      find: function (px, pz) {
        if (CBZ.CONFIG.STRAT_NUKE === false) return null;
        const P = CBZ.player;
        if (!P || P.dead || P.driving || P._aircraft) return null;
        if (invCount("Nuclear Device") <= 0) return null;
        _plantTok.x = px; _plantTok.z = pz;
        return _plantTok;
      },
      options: [{
        id: "nuke-plant-arm", slot: "e", bad: true,
        label: function () { return "Plant the nuclear device (" + nkTimer() + "s)"; },
        onSelect: function (t) {
          if (!invTake("Nuclear Device")) return;
          const gy = CBZ.floorAt ? CBZ.floorAt(t.x, t.z) : 0;
          const m = deviceMesh();
          m.position.set(t.x, gy + 0.45, t.z);
          if (CBZ.scene) CBZ.scene.add(m);
          armed.push({
            x: t.x, z: t.z, t: nkTimer(), arm: nkArm(), mesh: m, armBeep: -1,
            // seed the beep at the FIRST mark the clock will produce, so the
            // opening tone is not fired in the same frame as the arming alarm
            // (two cues 16 ms apart read as one doubled sample, which is the
            // exact note city/nukefx.js's own sfx block makes about `force`).
            beep: Math.ceil(nkTimer() / 10) * 10,
          });
          if (nkArm() > 0) {
            note("ARMING — hold the sequence. " + nkTimer() + " seconds once it goes hot.", 3.4,
              { from: "Device", app: "messages" });
          } else {
            note("DEVICE ARMED — " + nkTimer() + " seconds. Run.", 3.2);
          }
          if (CBZ.cityCrime) { try { CBZ.cityCrime(200, { x: t.x, z: t.z, type: "planting-explosives" }); } catch (e) {} }
        },
      }],
    });
    if (I.describe) I.describe("nukeplant", function () {
      return { label: "Nuclear Device", note: "Set it down, start the clock, be somewhere else" };
    });
    I.registerZone({
      id: "nuke-abort", kind: "nukearmed", radius: 3,
      find: function (px, pz) {
        let best = null, bd = 9;
        for (const a of armed) {
          const dx = a.x - px, dz = a.z - pz, d2 = dx * dx + dz * dz;
          if (d2 < bd) { bd = d2; best = a; }
        }
        return best;
      },
      options: [{
        id: "nuke-abort-do", slot: "e",
        // The verb changes with the phase: you SAFE a device that is still
        // arming and you ABORT one whose clock is already running. Same
        // action, and it is available in both — a sequence you cannot stop
        // is not a decision, it is a cutscene.
        label: function (a) {
          return a.arm > 0
            ? "Safe the device (" + Math.ceil(a.arm) + "s to hot)"
            : "Abort the countdown (" + Math.ceil(a.t) + "s)";
        },
        onSelect: function (a) {
          const i = armed.indexOf(a);
          if (i < 0) return;
          armed.splice(i, 1);
          if (a.mesh && a.mesh.parent) a.mesh.parent.remove(a.mesh);
          invAdd("Nuclear Device");
          note(a.arm > 0 ? "Safed. The pin goes back in."
                         : "Countdown aborted. Your hands are still shaking.", 2.4);
        },
      }],
    });
    if (I.describe) I.describe("nukearmed", function (a) {
      return a.arm > 0
        ? { label: "ARMING", note: Math.ceil(a.arm) + " seconds to hot" }
        : { label: "ARMED DEVICE", note: Math.ceil(a.t) + " seconds on the clock" };
    });
    _plantWired = true;
  }

  // countdown tick + LED strobe + the last-ten beeps
  CBZ.onUpdate(34.75, function (dt) {
    ensureItems();
    wirePlantZones();
    if (!armed.length) return;
    if (g.mode !== "city") {                          // a mode flip disarms cleanly
      for (const a of armed) if (a.mesh && a.mesh.parent) a.mesh.parent.remove(a.mesh);
      armed.length = 0;
      return;
    }
    for (let i = armed.length - 1; i >= 0; i--) {
      const a = armed[i];
      /* ---- PHASE 1: ARMING. Three beats, one tone each, amber LED. Nothing
         about the world is committed yet and the safe verb is live. */
      if (a.arm > 0) {
        a.arm -= dt;
        ledPhase(a);
        const beat = NK.ARM / Math.max(1, NK.ARM_BEATS);
        const b = Math.ceil(a.arm / beat);
        if (b !== a.armBeep) {
          a.armBeep = b;
          sfx("key", { pitch: 0.72 + (NK.ARM_BEATS - b) * 0.16, volume: 0.55 });
        }
        if (a.arm <= 0) {
          a.arm = 0;
          note("DEVICE HOT — " + Math.ceil(a.t) + " seconds. Get a vehicle.", 3.6);
          if (CBZ.city && CBZ.city.big) { try { CBZ.city.big("NUCLEAR DEVICE ARMED"); } catch (e) {} }
          if (CBZ.shake) { try { CBZ.shake(1.2); } catch (e) {} }
        }
        continue;
      }
      /* ---- PHASE 2: THE CLOCK. -------------------------------------------
         The cadence is CONTINUOUS, not a last-ten special case: one tone per
         10 s down to T-30, per 5 s to T-10, then per second. That is what
         makes the device audible as a rising pressure from across a block
         instead of silent until it is already too late to run. */
      a.t -= dt;
      ledPhase(a);
      const step = a.t > 30 ? 10 : a.t > 10 ? 5 : 1;
      const mark = Math.ceil(a.t / step) * step;
      if (mark !== a.beep) {
        a.beep = mark;
        const u = 1 - Math.max(0, Math.min(1, a.t / Math.max(1, nkTimer())));
        sfx("key", { pitch: 0.95 + u * 0.75, volume: 0.42 + u * 0.28 });
        // three spoken milestones, on the channel this file already uses
        if (mark === 60 || mark === 30) note(mark + " seconds.", 1.6, { from: "Device", app: "messages" });
        if (mark === 10 && CBZ.city && CBZ.city.big) { try { CBZ.city.big("10"); } catch (e) {} }
      }
      if (a.t <= 0) {
        armed.splice(i, 1);
        if (a.mesh && a.mesh.parent) a.mesh.parent.remove(a.mesh);
        nukeDetonate(a.x, a.z);
      }
    }
  });

  /* ==========================================================================
     6) INPUT + TOUCH SEAM + PREWARM
  ========================================================================== */
  // [B] — TAP releases one, HOLD walks a carpet. Same key family as the C4
  // charge on foot (explosives.js releases the key while you are flying), same
  // tap/hold grammar, so there is one bomb verb in the game and not two.
  const RUN_HOLD = 0.4;                              // seconds before a hold becomes a run
  let _bHeld = false, _bT = 0, _bRan = false;
  let _bombCamHeld = false;
  addEventListener("keydown", function (e) {
    if (e.defaultPrevented) return;                   // C4's capture handler may own B
    const k = (e.key || "").toLowerCase();
    if (k !== "b" && k !== "x" && k !== "c") return;
    if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!g || g.mode !== "city" || g.state !== "playing" || CBZ.cityMenuOpen) return;
    const craft = flyingB2();
    if (!craft) {
      // A DEAD KEY MUST SAY SO. Fort Brandt parks a "Heavy Bomber"
      // (island_military.js:1218) that looks exactly like the aircraft these
      // keys belong to and has no bay at all — same for the gunship, the
      // airliner and the Raptor. Pressing [B] in one of them was silent, which
      // reads as a broken control rather than the wrong airframe. We do NOT
      // preventDefault here: the key still belongs to whoever else wants it.
      if (k !== "c" && !e.repeat && CBZ.player && CBZ.player._aircraft) payloadFlash("NO BOMB BAY — TAKE THE B-2", 2.6);
      return;                                         // only the B-2 owns these keys
    }
    e.preventDefault();
    if (k === "c") {
      if (!e.repeat && !_bombCamHeld) {
        _bombCamHeld = true;
        startBombCine(craft);
        _b2Legend = 0;
      }
      return;
    }
    if (k === "x") { if (!e.repeat) cyclePayload(); return; }
    if (e.repeat || _bHeld) return;
    _bHeld = true; _bT = 0; _bRan = false;
    _b2Legend = 0;                                    // you found the key
  });
  addEventListener("keyup", function (e) {
    const k = (e.key || "").toLowerCase();
    if (k === "c" && _bombCamHeld) {
      _bombCamHeld = false;
      stopBombCine();
      return;
    }
    if (k !== "b" || !_bHeld) return;
    _bHeld = false; _bRan = false;
    if (run.active) { endRun("released"); return; }
    if (_bT < RUN_HOLD) dropPayload();                // a tap is one bomb
  });
  // a lost keyup (alt-tab mid-run) must not leave the trigger stuck down
  addEventListener("blur", function () {
    _bHeld = false; _bRan = false; _bombCamHeld = false;
    stopBombCine();
    if (run.active) endRun("released");
  });
  // (the hold timer itself is ticked inside the existing 12.45 updater — no
  // new updater order is claimed for a two-line state machine)

  // the touch layer (touch_vehicle.js agent) wires these to pills/buttons
  CBZ.strategicBombDrop = dropPayload;
  CBZ.strategicPayloadCycle = cyclePayload;
  // slide-hold seam for systems/touch_vehicle.js: press-and-hold the bomb pill
  // and you get the carpet run, exactly like holding [B] on a keyboard.
  CBZ.strategicBombHold = function (down) {
    if (down) { if (!_bHeld) { _bHeld = true; _bT = 0; _bRan = false; } return true; }
    if (!_bHeld) return false;
    _bHeld = false; _bRan = false;
    if (run.active) { endRun("released"); return true; }
    return dropPayload();
  };
  CBZ.strategicBombCameraHold = function (down) {
    const c = flyingB2();
    if (down) {
      if (!c) return false;
      _bombCamHeld = true;
      return startBombCine(c);
    }
    _bombCamHeld = false;
    stopBombCine();
    return true;
  };

  /* ---- MISSION SEAMS -------------------------------------------------------
     The roles/missions layer needs three questions answered and none of them
     should cost it a new bookkeeping system:
       "is a bomb run in progress"  -> strategicBombRunState()
       "start / stop one for me"    -> strategicBombRun(opts) / ...Abort()
       "how much have I levelled"   -> strategicDevastation()
     The devastation report is computed ON DEMAND from city/structural.js's
     ledger — this file keeps NO second tally of who wrecked what. `by` is set
     on every detonate() above, which is what makes the per-building
     attribution ("was this the player?") free.                              */
  CBZ.strategicBombRun = function (opts) { return startRun(opts || {}); };
  CBZ.strategicBombRunAbort = function () { endRun("aborted"); };
  CBZ.strategicBombRunState = function () {
    return {
      active: run.active, kind: run.kind,
      called: run._called != null,          // flown off-map vs. from the cockpit
      dropped: run.sent, requested: run.want,
      interval: run.interval, elapsed: +run.t.toFixed(2),
      inAir: bombs.length, cap: bombCap(), collapses: _runCollapses,
    };
  };
  CBZ.strategicBombCameraState = function () {
    return {
      active: bombCine.active,
      released: bombCine.released,
      impacts: bombCine.impacts,
      deaths: bombCineDeaths(),
      held: _bombCamHeld,
      hasImpact: bombCine.hasImpact,
      enabled: CBZ.CONFIG.STRAT_BOMB_CINEMATIC !== false,
    };
  };
  /* NUMERIC PROBE (CLAUDE.md's closed loop is math over live state, never
     frames). Answers, without dropping anything: where would a release from
     (x,y,z) at (vx,vy,vz) land, when, how fast, and how deep would a buster
     get. This is what a CDP probe asserts a bomb run against.               */
  CBZ.strategicBallistics = function (x, y, z, vx, vy, vz) {
    const s = solveFall(+x || 0, +y || 0, +z || 0, +vx || 0, +vy || 0, +vz || 0);
    return {
      t: +s.t.toFixed(3), x: +s.x.toFixed(2), y: +s.y.toFixed(2), z: +s.z.toFixed(2),
      speed: +s.speed.toFixed(2),
      lead: +Math.hypot(s.x - (+x || 0), s.z - (+z || 0)).toFixed(2),
      busterE: Math.round(energyOf("buster", s.speed)),
      busterPenCE: +busterPenCE(s.speed).toFixed(2),
      grav: GRAV,
    };
  };
  CBZ.strategicOnBombRun = CBZ.strategicOnBombRun || null;   // fn(report) — mission hook
  CBZ.strategicDevastation = function () {
    const A = CBZ.city && (CBZ.city.arena || CBZ.city);
    const out = { lots: 0, damaged: 0, burning: 0, collapsed: 0, doomed: 0, byPlayer: 0, frac: 0 };
    if (!A || !A.lots) return out;
    const S = CBZ.structure;
    // CONDEMNED-BUT-STILL-STANDING is the most interesting number a bomb run
    // produces — a district counting down. structural.js publishes it; we read
    // it, we do not keep a second tally (degrade-safe: absent ⇒ 0).
    if (S && S.doomed) { try { out.doomed = (S.doomed() || []).length; } catch (e) { out.doomed = 0; } }
    const PL = who();
    for (let i = 0; i < A.lots.length; i++) {
      const lot = A.lots[i];
      if (!lot.building) continue;
      out.lots++;
      if (lot.demolished) out.collapsed++;
      if (!S || !S.state) continue;
      let st = null;
      try { st = S.state(lot); } catch (e) { st = null; }
      if (!st || !st.stage) continue;
      out.damaged++;
      if (st.fires) out.burning++;
      if (st.stage >= 5 && !lot.demolished) out.collapsed++;
      if (st.by && (st.by === PL || st.by === CBZ.player)) out.byPlayer++;
    }
    out.frac = out.lots ? +(out.collapsed / out.lots).toFixed(4) : 0;
    return out;
  };
  /* The payload readout, as a NUMBER a probe can assert on (CLAUDE.md's closed
     loop is math over live state, never frames). `strip` is the exact string
     appended to #cityFlightHud, so a probe can prove the switch is VISIBLE
     without taking a screenshot: cycle, read strip, assert it changed. */
  CBZ.strategicPayloadReadout = function () {
    const c = flyingB2();
    return {
      b2: !!c, payload: payload, short: PAY_SHORT[payload],
      count: payloadCount(payload, c),
      strip: c ? payloadHudText(c) : "",
      flash: +_payFlash.toFixed(2), tag: _payTag, legend: +_b2Legend.toFixed(2),
      feedback: CBZ.CONFIG.STRAT_PAYLOAD_FEEDBACK !== false,
      el: (typeof document !== "undefined" && document.getElementById)
        ? !!document.getElementById("cityFlightHud") : false,
    };
  };
  CBZ.strategicState = function () {
    const c = flyingB2();
    return {
      b2: !!c, payload: payload,
      bombs: c ? (c.bombAmmo | 0) : 0,
      jdams: c ? (c.jdamAmmo | 0) : 0,
      busters: invCount("Bunker Buster"),
      nukes: c ? (c.nukeAmmo | 0) : 0,
      maxNukes: c ? (c.maxNukeAmmo | 0) : B2_NUKES,
      portableNukes: invCount("Nuclear Device"),
      armed: armed.length,
      inAir: bombs.length, cap: bombCap(),
      run: run.active ? { kind: run.kind, sent: run.sent, want: run.want, called: run._called != null } : null,
      bombCamera: CBZ.strategicBombCameraState(),
      nukeActive: !!nk,
      rad: radZones.length,
      bus: !!CBZ.detonate, ledger: !!CBZ.structure,
      /* ---- THE TWO ROUTES TO A DETONATION, AS NUMBERS ------------------
         Both are here so a probe can assert on them without dropping a
         weapon: the ground clock and its arming beat, and the air route's
         delivery profile at any release altitude. `deliveryAt(h)` is the
         one honest answer to "how long from when it leaves the bay". */
      plantTimer: nkTimer(), plantArm: nkArm(),
      plantLive: armed.map(function (a) {
        return { arm: +Math.max(0, a.arm).toFixed(2), t: +Math.max(0, a.t).toFixed(2) };
      }),
      escape: {
        // the derivation NK.TIMER is solved from — see its comment
        reach: 900, onFoot: +(900 / 11.9).toFixed(1), byCar: +(900 / 22).toFixed(1),
        bomberClear: +(900 / 105).toFixed(2), targetFall: RET.T_ESCAPE,
      },
      /* THE CONSEQUENCE MODEL, AS NUMBERS. Every one is read LIVE off
         city/nukefx.js's published rings, so this object proves that this
         file holds no second copy of the yield, the radii or the fatality
         curve — if the bus row moves, all of these move with it. */
      nuke: (function () {
        const T = rings();
        return {
          yieldKt: T ? T.W : null,
          fireball: T ? +T.fireball.toFixed(0) : null,
          psi20: T ? +T.psi20.toFixed(0) : null,
          psi5: T ? +T.psi5.toFixed(0) : null,
          psi2: T ? +T.psi2.toFixed(0) : null,
          psi1: T ? +T.psi1.toFixed(0) : null,
          copSweep: +nkKillR().toFixed(0),
          instantDeath: +nkPlayerR().toFixed(0),
          radZone: +nkRadR().toFixed(0),
          hold: 24,
          // the measured curve, sampled where this file actually uses it
          killed: [126, 504, 1109, 1533, 2016, 2554].map(function (r) {
            return { r: r, p: +lethalAt(r).toFixed(3) };
          }),
        };
      })(),
      /* THE DELIVERY PROFILE AT EVERY BAND, AS A TABLE. Deliberately an
         ARRAY OF PLAIN OBJECTS and not a function(agl): a CDP probe reads
         this through Runtime.evaluate with returnByValue, and JSON drops a
         function property SILENTLY — an audit surface that vanishes when
         serialised is worse than no audit surface. These are the same
         altitudes the retardFor block's measured table quotes, so the
         comment and the runtime can be diffed against each other. */
      delivery: [80, 150, 300, 600, 1200].map(deliveryProfile),
    };
  };
  // one row of the table above: what a nuclear round released at `agl` does.
  function deliveryProfile(agl) {
    const h = Math.max(1, +agl || 300);
    const bal = (EJECT_MS + Math.sqrt(EJECT_MS * EJECT_MS + 2 * GRAV * h)) / GRAV;
    const r = retardFor("nuke", h, -EJECT_MS, 0);
    if (!r) {
      return { agl: h, retarded: false, fall: +bal.toFixed(2), ballistic: +bal.toFixed(2),
               vt: 0, deploy: -1, snatch: 0, bomberClear: Math.round(bal * 105) };
    }
    // the same bracketed bisection solveRetard runs, on a zero-surface column
    const dv = r.v0 - r.vt;
    const yA = function (d) { return r.y0 - r.vt * d - r.tau * dv * (1 - Math.exp(-d / r.tau)); };
    let lo = 0, hi = 4;
    while (yA(hi) > 0 && hi < 60) hi *= 2;
    for (let i = 0; i < 28; i++) { const m = (lo + hi) * 0.5; if (yA(m) > 0) lo = m; else hi = m; }
    const fall = r.t0 + (lo + hi) * 0.5;
    return {
      agl: h, retarded: true, fall: +fall.toFixed(2), ballistic: +bal.toFixed(2),
      vt: +r.vt.toFixed(1), deploy: r.t0, snatch: +r.v0.toFixed(1),
      bomberClear: Math.round(fall * 105),
    };
  }

  // ---- PREWARM PARK: the lazy materials this file spawns mid-fight (bombs,
  // the device) sit invisible in the scene from load, so core/fxwarm's
  // renderer.compile(scene, camera) builds their programs on the play-start
  // beat instead of a mid-fight freeze (the fxwarm doctrine). The cloud
  // materials that used to be parked here left with the cloud — city/nukefx.js
  // owns that spectacle and its own prewarm now.
  let _warmed = false;
  CBZ.onAlways(1.1, function () {
    if (_warmed || !CBZ.scene) return;
    _warmed = true;
    try {
      const park = new THREE.Group();
      park.name = "strategic-fx-prewarm";
      park.visible = false;
      park.add(bombMesh("bomb")); park.add(bombMesh("buster")); park.add(deviceMesh());
      park.position.set(0, -400, 0);
      CBZ.scene.add(park);
    } catch (e) {}
  });
})();
