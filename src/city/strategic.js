/* ============================================================
   city/strategic.js — STRATEGIC WEAPONS (part 2): the B-2, the
   bunker-buster, and the nuke. Partner file to city/bunkers.js.

   WHY ONE LAYER, NOT THREE BOLT-ONS (owner mandate): the pieces chain —
   the military bunker's vault holds THE one nuclear device per world and
   its armory stocks the bunker-busters; the B-2 on the Fort Brandt apron
   is the delivery platform for both; the buster is the only weapon that
   kills THROUGH a bunker roof, which matters because an intact bunker is
   the only thing that shelters you from the nuke. Steal the bomber, raid
   the vault, and the end of the world is a payload switch away.

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
   guarantee, the lingering radiation zone, the one-device-per-world
   scarcity rule). NEW ORDNANCE IS A TABLE ROW — "buster" is defined via
   CBZ.impact.define() below, with a high `pen` so it punches through the
   roof and detonates INSIDE, which is exactly what `pen` models.

   THE B-2 IS A REAL BOMBER: tap [B] to release one, HOLD [B] to walk a
   CARPET of bombs along the flight path (stagger = release interval x
   ground speed). The run is a public seam — CBZ.strategicBombRun(opts) /
   CBZ.strategicBombRunState() / CBZ.strategicOnBombRun — so the mission
   layer can hang "bomb the city" off it without touching this file. With no
   B-2 in the air the SAME seam flies a CALLED sortie off-map
   (CBZ.strategicCallStrike), which is what the bunker's map table tasks.
   [X] cycles the payload: Mk-84 · JDAM · GBU bunker buster · THE DEVICE.

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
   new HUD — the killfeed carries the story; the flash/cloud are world FX.

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
  // HOLD-[B] carpet bombing. false => [B] is a single release exactly as
  // before (one-line revert of the whole run machinery).
  if (CBZ.CONFIG.STRAT_BOMB_RUN == null) CBZ.CONFIG.STRAT_BOMB_RUN = true;
  // The guided bomb payload. false => the payload cycle skips it and the
  // B-2 carries dumb iron only.
  if (CBZ.CONFIG.STRAT_JDAM == null) CBZ.CONFIG.STRAT_JDAM = true;

  function h01(x, z, s) { return CBZ.hash01 ? CBZ.hash01(x, z, s) : 0.5; }
  function cm(hex, opts) { return CBZ.cmat ? CBZ.cmat(hex, opts) : (CBZ.mat ? CBZ.mat(hex, opts) : new THREE.MeshLambertMaterial({ color: hex })); }
  function bg(w, h, d) { return CBZ.boxGeom ? CBZ.boxGeom(w, h, d) : new THREE.BoxGeometry(w, h, d); }
  function note(m, s) { if (CBZ.city && CBZ.city.note) { try { CBZ.city.note(m, s); } catch (e) {} } }
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

  const B2C = {
    skin: 0x2b2f35, skinD: 0x1b1e23, belly: 0x1f2227, panel: 0x373d45,
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
  const B2_BOMBS = 16, B2_MISSILES = 8, B2_JDAMS = 4;
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
      c.displayName = "B-2 SPIRIT";
      payload = "bomb";
      // one note, not two — city.note replaces rather than queues
      note("B-2 SPIRIT — [B] tap: release · HOLD [B]: carpet run · [X] payload · LMB missiles. Penetrators only bite fast and high.", 5.4);
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
    if (k === "nuke") return CBZ.CONFIG.STRAT_NUKE !== false && invCount("Nuclear Device") > 0;
    return false;
  }
  function payloadLabel(k, c) {
    if (k === "bomb") return "Payload: Mk-84 bombs (" + (c ? (c.bombAmmo | 0) : 0) + ")";
    if (k === "jdam") return "Payload: GBU-31 JDAM — guided (" + (c ? (c.jdamAmmo | 0) : 0) + ")";
    if (k === "buster") return "Payload: GBU-57 BUNKER BUSTER (" + invCount("Bunker Buster") + ")";
    return "Payload: THE DEVICE";
  }
  function cyclePayload() {
    const c = flyingB2();
    if (!c) return payload;
    const i = PAYLOADS.indexOf(payload);
    for (let k = 1; k <= PAYLOADS.length; k++) {
      const cand = PAYLOADS[(i + k) % PAYLOADS.length];
      if (payloadAvailable(cand, c)) { payload = cand; break; }
    }
    note(payloadLabel(payload, c), 1.6);
    sfx("switch", { pitch: 1.2, volume: 0.3 });
    return payload;
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
  function bombMesh(kind) {
    bombAssets();
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

  // where the round is at local time t on its parabola (pure evaluation)
  function bombAt(b, t, out) {
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

  function dropPayload(force) {
    const c = flyingB2();
    if (!c || !g || g.mode !== "city") return false;
    // bomber discipline: a release on the deck detonates under your own tail
    const agl = c.pos.y - (CBZ.floorAt ? CBZ.floorAt(c.pos.x, c.pos.z) : 0);
    if (agl < 14) { if (!force) note("Too low — climb before releasing.", 1.4); return false; }
    if (!payloadAvailable(payload, c)) { cyclePayload(); if (!payloadAvailable(payload, c)) { if (!force) note("Bay's empty.", 1.2); return false; } }
    if (c._dropCD > 0) return false;
    const kind = payload;
    if (kind === "bomb") c.bombAmmo--;
    else if (kind === "jdam") c.jdamAmmo--;
    else if (kind === "buster") { if (!invTake("Bunker Buster")) return false; }
    else if (kind === "nuke") { if (!invTake("Nuclear Device")) return false; }
    c._dropCD = kind === "bomb" ? 0.2 : kind === "jdam" ? 0.6 : 1.4;
    _bayT = 1.3;                                     // bay doors swing for the release

    // THE RELEASE VELOCITY IS NOT OURS TO INVENT — releaseVel() (below) is the
    // ONE answer, shared with predictWalk so the dust line and the craters can
    // never disagree, and owned by aircraft.js's ordnance law so "straight down"
    // is a single flag for every bomb bay this game will ever grow.
    const p = bayPoint(c);
    const rv = releaseVel(c, kind);
    const b = {
      mesh: null, kind: kind, t: 0, reaim: 0, seek: null,
      x0: p.x, y0: p.y, z0: p.z,
      vx: rv.vx, vy: rv.vy, vz: rv.vz,
    };
    b.sol = solveFall(b.x0, b.y0, b.z0, b.vx, b.vy, b.vz);

    // GUIDED: acquisition is lockon.js's — asked through the shared ordnance
    // law so this bay speaks the RPG's sentence — and the solve is ours (see
    // solveGuided). Undefined (lock-on disabled) or null (no red lock) leaves
    // the bomb dumb, which is the honest outcome: a JDAM with no aimpoint IS a
    // dumb bomb, and under BOMBS_DROP_STRAIGHT a dumb bomb now falls vertically.
    if (kind === "jdam") {
      b.seek = ordSeek("strategic:jdam") || null;
      reaimGuided(b);
    }

    sfx("whoosh", { pitch: 0.8, volume: 0.5 });
    // dropping ordnance on the city is a crime the moment it leaves the bay
    if (CBZ.cityCrime) { try { CBZ.cityCrime(kind === "bomb" ? 120 : 200, { x: c.pos.x, z: c.pos.z, type: "shots-fired" }); } catch (e) {} }

    // OVER THE CAP — DEGRADE, never queue. The solver already knows exactly
    // where and when this round lands, so the only thing a saturated sky loses
    // is a few seconds of a 0.3 m cylinder falling: the crater, the kills and
    // the ledger hit are identical. This snap-to-end-state is only possible
    // BECAUSE the ballistics are closed-form.
    if (bombs.length >= bombCap()) { resolveImpact(b); return true; }

    b.mesh = bombMesh(kind);
    b.mesh.rotation.order = "YXZ";                   // yaw then pitch — nose tracks the arc
    b.mesh.position.set(b.x0, b.y0, b.z0);
    b.mesh.rotation.y = Math.atan2(b.vx, b.vz);
    if (CBZ.scene) CBZ.scene.add(b.mesh);
    bombs.push(b);
    return true;
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
    // a roof hit blooms ON the roof; ground level gets a little standoff
    const iy = s.y > 2.5 ? s.y : Math.max(0.6, s.y) + 1.0;
    if (b.kind === "buster") { resolveBuster(s.x, s.z, s.y, b.vx, b.vz, s.speed); return; }
    if (b.kind === "nuke") { nukeDetonate(s.x, s.z); return; }
    detonate(s.x, iy, s.z, b.kind, {
      byPlayer: true, dirx: b.vx, dirz: b.vz,
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
    const stock = kind === "bomb" ? (c.bombAmmo | 0) : kind === "jdam" ? (c.jdamAmmo | 0) : invCount(kind === "buster" ? "Bunker Buster" : "Nuclear Device");
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
    sfx("siren", { volume: 0.35 });
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
    if (!bombs.length) return;
    if (g.mode !== "city") {                            // mode flip: sweep the sky
      for (const b of bombs) if (b.mesh && b.mesh.parent) b.mesh.parent.remove(b.mesh);
      bombs.length = 0;
      return;
    }
    // ---- THE FALL. Pure evaluation of each round's analytic arc; the impact
    // time was solved at release, so "have I landed" is a scalar compare, not
    // a terrain query per bomb per frame.
    for (let i = bombs.length - 1; i >= 0; i--) {
      const b = bombs[i];
      b.t += dt;
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
    }
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
    sfx("clank", { pitch: 0.6, volume: 0.8 });
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
  // now the "nuke" ROW in systems/impactbus.js — power 9, radius 120,
  // wave {speed:190, maxR:620}. Only the numbers the bus does not own survive.
  // VEHICLES ARE NOT HERE ANY MORE. `R_CAR: 130` plus a 3-wrecks-per-frame
  // queue used to live in this block; systems/impactbus.js's sweepRing now
  // damages cars inside the propagating ring for EVERY wave-carrying warhead
  // (nuke, MOAB, an airliner into a tower), capped per tick. Keeping ours
  // would have billed the nuke's cars twice. Deleted, not disabled.
  const NK = {
    R_KILL: 175,         // cop roster sweep (the bus does not walk cops)
    R_PLAYER: 160,       // instant unsheltered player death radius
    RAD_R: 70,           // lingering radiation zone radius
    RAD_DAYS: 1.2,       // in-game days the zone stays hot
    TIMER: 45,           // planted-device countdown (seconds, real)
  };
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
     The nuke's people-damage is the BUS's job now (its propagating wave owns
     the crowd/ped/player sweep, with the lethal-core rule the owner tuned).
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
     row + one call now: the bus's `wave: {speed:190, maxR:620}` rolls the
     damage outward over ~3.3 s (which is what the staged ring was faking),
     and city/structural.js's sweep() decides each building's fate through the
     real ledger, so towers CATCH FIRE, SAG and PANCAKE instead of blinking
     into rubble.

     What stays is what only this file knows: the bunker shelter guarantee,
     the wanted/panic consequence, the scorched ground, the lingering
     radiation zone, the wrecked cars, and one-apocalypse-at-a-time.        */
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

    // ---- the player's verdict, decided NOW and BEFORE the bus runs, so the
    // shelter window is already open when the wave sweeps over the berm.
    const P = CBZ.player;
    if (P && !P.dead) {
      const sheltered = !!(CBZ.strategicBunkerShelterAt && CBZ.strategicBunkerShelterAt(P.pos.x, P.pos.y, P.pos.z));
      const pd = Math.hypot(P.pos.x - x, P.pos.z - z);
      if (sheltered) {
        g.invuln = Math.max(g.invuln || 0, 12);       // the blast wave passes OVER
        if (pd < NK.R_KILL) note("The bunker holds. Outside, there is nothing left.", 4);
      } else if (pd <= NK.R_PLAYER) {
        try { CBZ.cityHurtPlayer(9999, x, z, "caught in a nuclear blast", false, null, false); } catch (e) {}
      }
      // beyond R_PLAYER the bus's wave hurts him as it arrives — on a timer,
      // which is the whole point of a propagating front.
    }

    // ---- consequence: the whole state turns on you. The star API grants the
    // owner-reserved 5th star only for a military-scale reason — this is one.
    if (CBZ.cityCrime) { try { CBZ.cityCrime(400, { x: x, z: z, type: "terrorism", instant: true }); } catch (e) {} }
    if (CBZ.cityAddStars) { try { CBZ.cityAddStars(5, "Nuclear detonation — military response"); } catch (e) {} }
    // panic buses (the loudest possible scare, C4's exact pattern)
    if (CBZ.cityPostEvent) { try { CBZ.cityPostEvent({ type: "explosion", pos: { x: x, y: 1, z: z }, radius: 400, intensity: 4 }); } catch (e) {} }
    if (CBZ.cityEvent) { try { CBZ.cityEvent("explosion", { x: x, z: z, panic: 40, damage: 30 }, { silent: true, noWanted: true }); } catch (e) {} }

    // ---- ground zero stays WRONG for days: scorch rings now, a radiation
    // zone that ticks damage until it decays (in-game clock).
    if (CBZ.cityScorch) {
      try {
        CBZ.cityScorch(x, z, 45);
        for (let i = 0; i < 4; i++) {
          const a = i * 1.57 + 0.6;
          CBZ.cityScorch(x + Math.cos(a) * 34, z + Math.sin(a) * 34, 18);
        }
      } catch (e) {}
    }
    radZones.push({ x: x, z: z, r: NK.RAD_R, until: (CBZ.dayTime ? CBZ.dayTime() : 0) + NK.RAD_DAYS });

    // nk is live BEFORE the bus fires so the shelter guard covers the very
    // first frame of the wave.
    nk = { t: 0, x: x, z: z, hold: 16 };

    // degrade path only — see whiteout()'s note. With nukefx.js loaded the
    // composer owns the flash, the fireball, the stem and the cap.
    if (!(CBZ.impact && CBZ.impact.hasFx && CBZ.impact.hasFx("nuke"))) {
      whiteout();
      if (CBZ.shake) { try { CBZ.shake(6); } catch (e) {} }
      if (CBZ.doHitstop) { try { CBZ.doHitstop(0.22); } catch (e) {} }
    }
    // "boom" is NOT in systems/audio.js's bank — it silently no-opped here for
    // this file's whole life. The bank's two honest cues are these.
    sfx("rumble", { delay: 1.1 });
    sfx("collapse", { delay: 2.6 });

    // ONE CALL. The row does the rest.
    detonate(x, y, z, "nuke", { byPlayer: opts.byPlayer !== false, by: opts.by });
  }
  CBZ.strategicNukeDetonate = nukeDetonate;           // probe/tooling handle

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

    // COPS: the wave's ped/crowd/player sweep is the bus's; cops are a
    // separate roster it does not walk, so they stay here — bunker-sheltered
    // spared, 12/frame, once.
    if (!nk.copsDone) {
      let killed = 0;
      const R2 = NK.R_KILL * NK.R_KILL;
      for (const cp of (CBZ.cityCops || [])) {
        if (killed >= 12) break;
        if (!cp || cp.dead || !cp.pos) continue;
        const dx = cp.pos.x - nk.x, dz = cp.pos.z - nk.z;
        if (dx * dx + dz * dz > R2) continue;
        if (CBZ.strategicBunkerShelterAt && CBZ.strategicBunkerShelterAt(cp.pos.x, cp.pos.y, cp.pos.z)) continue;
        if (CBZ.cityHurtCop) { try { CBZ.cityHurtCop(cp, 9999, { byPlayer: true, fromX: nk.x, fromZ: nk.z }); } catch (e) {} }
        killed++;
      }
      if (killed === 0 && nk.t > 3) nk.copsDone = true;
    }

    // (vehicles: see the note on NK — the bus's blast ring owns them now)

    // the shelter guard and `nukeActive` stay live until the wave has run out
    // (nuke row: 620 m at 190 m/s ≈ 3.3 s) and the fires it lit have settled.
    if (nk.t > nk.hold) nk = null;
  });

  /* ==========================================================================
     5) THE PLACED DEVICE — carry it in, set the timer, get out (or don't).
     Both verbs live in the ONE interaction registry (touch pills for free,
     HUD doctrine intact: no new chrome, the killfeed carries the deaths).
  ========================================================================== */
  const armed = [];                                   // {x,z,t,mesh,beep}
  function deviceMesh() {
    bombAssets();
    const gp = bombMesh("nuke");
    gp.rotation.x = 0;                                // lies flat on the ground
    gp.rotation.z = Math.PI / 2;
    const led = new THREE.Mesh(bg(0.12, 0.12, 0.12), new THREE.MeshBasicMaterial({ color: 0xff3030 }));
    led.position.set(0, 0.55, 0);
    gp.add(led);
    gp.userData.led = led;
    return gp;
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
        label: function () { return "Plant the nuclear device (" + NK.TIMER + "s)"; },
        onSelect: function (t) {
          if (!invTake("Nuclear Device")) return;
          const gy = CBZ.floorAt ? CBZ.floorAt(t.x, t.z) : 0;
          const m = deviceMesh();
          m.position.set(t.x, gy + 0.45, t.z);
          if (CBZ.scene) CBZ.scene.add(m);
          armed.push({ x: t.x, z: t.z, t: NK.TIMER, mesh: m, beep: 0 });
          note("DEVICE ARMED — " + NK.TIMER + " seconds. Run.", 3.2);
          sfx("alarm");
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
        label: function (a) { return "Abort the countdown (" + Math.ceil(a.t) + "s)"; },
        onSelect: function (a) {
          const i = armed.indexOf(a);
          if (i < 0) return;
          armed.splice(i, 1);
          if (a.mesh && a.mesh.parent) a.mesh.parent.remove(a.mesh);
          invAdd("Nuclear Device");
          note("Countdown aborted. Your hands are still shaking.", 2.4);
          sfx("clank");
        },
      }],
    });
    if (I.describe) I.describe("nukearmed", function (a) {
      return { label: "ARMED DEVICE", note: Math.ceil(a.t) + " seconds on the clock" };
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
      a.t -= dt;
      const led = a.mesh && a.mesh.userData.led;
      if (led) led.visible = ((a.t * (a.t < 10 ? 6 : 2)) % 1) < 0.5;
      if (a.t <= 10 && Math.ceil(a.t) !== a.beep) {
        a.beep = Math.ceil(a.t);
        sfx("key", { pitch: 1.2 + (10 - a.beep) * 0.06, volume: 0.5 });
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
  addEventListener("keydown", function (e) {
    if (e.defaultPrevented) return;                   // C4's capture handler may own B
    const k = (e.key || "").toLowerCase();
    if (k !== "b" && k !== "x") return;
    if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!g || g.mode !== "city" || g.state !== "playing" || CBZ.cityMenuOpen) return;
    if (!flyingB2()) return;                          // only the B-2 owns these keys
    e.preventDefault();
    if (k === "x") { if (!e.repeat) cyclePayload(); return; }
    if (e.repeat || _bHeld) return;
    _bHeld = true; _bT = 0; _bRan = false;
  });
  addEventListener("keyup", function (e) {
    if ((e.key || "").toLowerCase() !== "b" || !_bHeld) return;
    _bHeld = false; _bRan = false;
    if (run.active) { endRun("released"); return; }
    if (_bT < RUN_HOLD) dropPayload();                // a tap is one bomb
  });
  // a lost keyup (alt-tab mid-run) must not leave the trigger stuck down
  addEventListener("blur", function () { _bHeld = false; _bRan = false; if (run.active) endRun("released"); });
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
  CBZ.strategicState = function () {
    const c = flyingB2();
    return {
      b2: !!c, payload: payload,
      bombs: c ? (c.bombAmmo | 0) : 0,
      jdams: c ? (c.jdamAmmo | 0) : 0,
      busters: invCount("Bunker Buster"),
      nukes: invCount("Nuclear Device"),
      armed: armed.length,
      inAir: bombs.length, cap: bombCap(),
      run: run.active ? { kind: run.kind, sent: run.sent, want: run.want, called: run._called != null } : null,
      nukeActive: !!nk,
      rad: radZones.length,
      bus: !!CBZ.detonate, ledger: !!CBZ.structure,
    };
  };

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
