/* ============================================================
   weapons/ballistics.js — CBZ.ballistics: WHAT A ROUND DOES, AS PHYSICS.

   One file owns the numbers every gun in the game fires by, and the maths
   that turns them into a trajectory, a hole and a wound. It needs no THREE
   and no DOM, so node tools load it as is (tools/ballistics-check.mjs prints
   the table below and holds the physics to published figures).

   WHAT IS HERE
     CART       the cartridges: bullet mass, bore, the reference muzzle
                velocity, the drag constant, and how far the bullet goes into
                each material at that velocity (metres). Sourced per row.
     GUN        per weapon id (weapons/weapon-data.js ids, plus the vehicle
                guns): its cartridge, mechanical accuracy (MOA), zero, sight
                height, recoil per shot (mil), effective ranges, tracer mix,
                malfunction rate, the basic load a man carries.
     MAT        the materials a round meets: what debris it throws, what it
                looks like when struck, when it ricochets.
     ANATOMY    zone boxes for a man (standing / kneeling / prone), a
                four-legged animal and a fish, in fractions of the measured
                body, plus a species table (mass, hide, skull).

   THE MODEL
     flight     v(t) = v0 e^(-k t), the same law fpsmode.js flies the player's
                rounds on (it reads dragK off the weapon row). Distance has a
                closed form and so does its inverse, so time of flight and
                retained velocity at any range cost one log and one exp.
     drop       gravity on the time of flight: 0.5 g t^2 below the bore line.
     zero       the sights cross the bore line at the zero range: point of
                impact relative to the line of sight is
                  poi(s) = s * (drop(z) + h) / z - drop(s) - h
                (h = sight height over the bore).
     pen        a bullet's penetration depth in a material scales as
                (v / v0)^1.5 between the energy law (hard targets) and the
                momentum law (soft ones). Crossing a layer of thickness t out
                of a depth D leaves v_out = v sqrt(1 - t/D); t >= D stops it.
     wound      energy deposited = E_in - E_out along the path through the
                body. WHERE it went decides the outcome (brain, heart/lungs,
                spine, gut, limb), not a hit-point number on the gun.

   OWNERS. Weapons (this file, src/battle/fire.js). Species agents may add
   `mass`, `hide` (mm), `skull` (mm) and `plan` to their unit stats: they win
   over the table here. Armour agents: CBZ.battleArmour.layer(unit, zone) ->
   {mat, mm} is asked before the flesh (see src/battle/fire.js).
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ = W.CBZ || {};
  if (CBZ.ballistics) return;

  const G = 9.81;
  const SOUND = 343;                      // m/s at 20 C, sea level

  /* ---- THE CARTRIDGES ----------------------------------------------------
     v0/dragK are the REFERENCE barrel; a gun row's own v0 wins (the weapon
     table's v0 is the barrel that gun actually has). pen = depth in metres
     of each material at v0, for ball/FMJ:
       flesh     10% ordnance gelatin (FBI protocol). Rifle ball yaws and
                 fragments inside it: that is the energy the depth leaves.
       wood      stacked softwood (pine) boards
       sand      a filled sandbag / packed sand (sand is the best cheap stop)
       dirt      packed earth
       cinder    a hollow concrete block wall (CMU), thickness as built
       brick     solid clay brick
       concrete  precast / poured concrete
       steel     mild steel sheet (car body, container wall)
       rha       rolled homogeneous armour (what vehicle armour is rated in)
     References: Box o' Truth penetration series; US Army FM 3-06.11 (7-1
     penetration of 5.56/7.62/.50 into sand, concrete, CMU, pine); FBI
     gelatin protocol figures; TM 9-1005-201-10 (M2 ball/AP). Rounded,
     because a wall in a game is not a lab sample. */
  const CART = {
    "9x19": { name: "9x19mm 124gr FMJ", g: 8.0, mm: 9.0, v0: 360, dragK: 0.60,
      pen: { flesh: 0.60, wood: 0.20, sand: 0.15, dirt: 0.12, cinder: 0.05, brick: 0.035, concrete: 0.02, steel: 0.0035, rha: 0.0025 },
      color: 0xffd28a },
    "357mag": { name: ".357 Magnum 158gr JSP", g: 10.2, mm: 9.1, v0: 442, dragK: 0.55,
      pen: { flesh: 0.55, wood: 0.30, sand: 0.18, dirt: 0.14, cinder: 0.07, brick: 0.05, concrete: 0.03, steel: 0.006, rha: 0.004 } },
    "50ae": { name: ".50 AE 300gr", g: 19.4, mm: 12.7, v0: 472, dragK: 0.55,
      pen: { flesh: 0.55, wood: 0.35, sand: 0.20, dirt: 0.16, cinder: 0.08, brick: 0.06, concrete: 0.04, steel: 0.007, rha: 0.005 } },
    "556": { name: "5.56x45mm M855", g: 4.0, mm: 5.7, v0: 905, dragK: 0.57,
      pen: { flesh: 0.45, wood: 0.60, sand: 0.30, dirt: 0.25, cinder: 0.30, brick: 0.14, concrete: 0.08, steel: 0.010, rha: 0.006 },
      tracer: 0xff5a2a },                                   // M856: red
    "762x39": { name: "7.62x39mm M43", g: 7.9, mm: 7.8, v0: 715, dragK: 0.62,
      pen: { flesh: 0.65, wood: 0.70, sand: 0.30, dirt: 0.25, cinder: 0.30, brick: 0.15, concrete: 0.08, steel: 0.008, rha: 0.006 },
      tracer: 0x8dff5a },                                   // T-45: green
    "762x51": { name: "7.62x51mm M80 ball", g: 9.5, mm: 7.8, v0: 853, dragK: 0.50,
      pen: { flesh: 0.75, wood: 0.95, sand: 0.38, dirt: 0.33, cinder: 0.45, brick: 0.24, concrete: 0.12, steel: 0.013, rha: 0.008 },
      tracer: 0xff5a2a },
    "762lr": { name: "7.62x51mm M118LR 175gr", g: 11.3, mm: 7.8, v0: 786, dragK: 0.44,
      pen: { flesh: 0.80, wood: 1.00, sand: 0.40, dirt: 0.35, cinder: 0.45, brick: 0.25, concrete: 0.12, steel: 0.013, rha: 0.008 } },
    "762x54r": { name: "7.62x54mmR LPS", g: 9.6, mm: 7.9, v0: 825, dragK: 0.50,
      pen: { flesh: 0.75, wood: 0.95, sand: 0.38, dirt: 0.33, cinder: 0.45, brick: 0.24, concrete: 0.12, steel: 0.013, rha: 0.008 },
      tracer: 0x8dff5a },
    "50bmg": { name: ".50 BMG M33 ball", g: 42.0, mm: 12.9, v0: 887, dragK: 0.40,
      pen: { flesh: 1.60, wood: 2.50, sand: 1.00, dirt: 0.90, cinder: 1.20, brick: 0.70, concrete: 0.35, steel: 0.040, rha: 0.020 },
      tracer: 0xff5a2a },
    "12ga00": { name: "12 gauge 00 buck (one of 9 pellets)", g: 3.5, mm: 8.4, v0: 400, dragK: 2.40, pellets: 9,
      pen: { flesh: 0.35, wood: 0.10, sand: 0.08, dirt: 0.06, cinder: 0.015, brick: 0.012, concrete: 0.008, steel: 0.002, rha: 0.001 } },
    // one steel fragment of an M67's notched wire: light, very fast, and
    // slowed hard by the air (it is a jagged sliver, not a bullet)
    "frag": { name: "M67 fragment", g: 0.25, mm: 4, v0: 1350, dragK: 60,
      pen: { flesh: 0.16, wood: 0.03, sand: 0.02, dirt: 0.02, cinder: 0.005, brick: 0.004, concrete: 0.003, steel: 0.0012, rha: 0.0006 } },
    "taser": { name: "TASER probe", g: 1.0, mm: 3, v0: 55, dragK: 1.0,
      pen: { flesh: 0.012, wood: 0.002, sand: 0.002, dirt: 0.002, cinder: 0.001, brick: 0.001, concrete: 0.001, steel: 0.0002, rha: 0.0001 }, stun: true },
  };

  /* ---- THE GUNS ----------------------------------------------------------
     moa      mechanical group (5-shot extreme spread, MOA) with issue ammo
     zero     metres where the sights cross the bore; sightH metres above it
     recoil   mil of muzzle rise a shot puts on a trained shooter's hold, in a
              standing hold (the stance multiplies it). It recovers with the
              shooter's own recovery time constant (the training row)
     eff      effective range against a point target (a man), metres;
              area: against an area target (a squad, a treeline); max: the
              round's useful end
     cls      how it is fought: pistol | smg | rifle | lmg | sniper | shotgun
              | rocket | grenade | stun
     tracer   every Nth round is a tracer (belts); tracerLast: the last N of
              a magazine (US rifle practice: the tracer says "change mags")
     malf     stoppages per round (field MRBS figures, issue ammunition)
     carry    rounds carried besides the one in the gun (the basic load)
     bipod    fires off its bipod when prone
     reload   seconds for a trained man to change the magazine / belt (the
              shotgun's is per shell: it is loaded one at a time)
     sources: TM 9-1005-319-10 (M4), TM 9-1005-201-10 (M249), FM 3-22.9,
     FM 3-22.68 (M249 belts 4:1), M24 SWS TM, Soviet AK manual (sight "P"). */
  const GUN = {
    sidearm:  { reload: 2.0, cart: "9x19", moa: 6, zero: 25, sightH: 0.025, recoil: 7, eff: 50, area: 50, max: 100, cls: "pistol", malf: 1 / 3000, carry: 34 },
    revolver: { reload: 4.5, cart: "357mag", moa: 5, zero: 25, sightH: 0.025, recoil: 10, eff: 50, area: 50, max: 120, cls: "pistol", malf: 1 / 8000, carry: 18 },
    deagle:   { reload: 2.2, cart: "50ae", moa: 6, zero: 25, sightH: 0.026, recoil: 16, eff: 50, area: 50, max: 120, cls: "pistol", malf: 1 / 1500, carry: 14 },
    uzi:      { reload: 2.5, cart: "9x19", moa: 10, zero: 25, sightH: 0.03, recoil: 4.0, eff: 50, area: 100, max: 120, cls: "smg", malf: 1 / 2000, carry: 75 },
    smg:      { reload: 2.6, cart: "9x19", moa: 5, zero: 50, sightH: 0.04, recoil: 2.6, eff: 100, area: 150, max: 200, cls: "smg", malf: 1 / 4000, carry: 128 },
    shotgun:  { reload: 0.55, cart: "12ga00", moa: 0, pattern: 26, zero: 25, sightH: 0.02, recoil: 14, eff: 40, area: 50, max: 80, cls: "shotgun", malf: 1 / 1500, carry: 24 },
    carbine:  { reload: 2.4, cart: "556", moa: 4, zero: 300, sightH: 0.066, recoil: 3.0, eff: 500, area: 600, max: 900, cls: "rifle", malf: 1 / 3600, carry: 180, tracerLast: 3 },
    ak47:     { reload: 2.6, cart: "762x39", moa: 5, zero: 300, sightH: 0.048, recoil: 4.2, eff: 350, area: 800, max: 900, cls: "rifle", malf: 1 / 6000, carry: 150, tracerLast: 3 },
    lmg:      { reload: 7.0, cart: "556", moa: 6, zero: 300, sightH: 0.07, recoil: 3.4, eff: 600, area: 800, max: 1000, cls: "lmg", malf: 1 / 1000, carry: 500, tracer: 4, bipod: true },
    sniper:   { reload: 4.0, cart: "762lr", moa: 0.75, zero: 100, sightH: 0.05, recoil: 9, eff: 800, area: 1000, max: 1200, cls: "sniper", malf: 1 / 10000, carry: 75, dial: true, bipod: true },
    bazooka:  { reload: 4.5, cart: null, rocket: "pg7v", zero: 200, eff: 200, area: 300, max: 920, cls: "rocket", malf: 1 / 300, carry: 2 },
    glauncher:{ reload: 6.0, cart: null, grenade40: true, v0: 76, zero: 150, eff: 150, area: 350, max: 400, cls: "grenade", malf: 1 / 2000, carry: 18, arm: 18 },
    taser:    { reload: 2.5, cart: "taser", moa: 60, zero: 7, sightH: 0.02, recoil: 2, eff: 7, area: 7, max: 10, cls: "stun", malf: 1 / 300, carry: 2 },
    // ---- vehicle guns (src/units/vehicles/*.js weapon ids) ----
    m240_coax:     { cart: "762x51", moa: 3.5, zero: 800, sightH: 0, recoil: 0.6, eff: 900, area: 1100, max: 1800, cls: "lmg", malf: 1 / 5000, tracer: 5, mount: true },
    m134_door:     { cart: "762x51", moa: 6, zero: 500, sightH: 0, recoil: 1.2, eff: 900, area: 1000, max: 1500, cls: "lmg", malf: 1 / 20000, tracer: 5, mount: true },
    pkm:           { cart: "762x54r", moa: 4.5, zero: 400, sightH: 0, recoil: 1.6, eff: 800, area: 1000, max: 1500, cls: "lmg", malf: 1 / 3000, tracer: 4, mount: true },
    m2_50cal:      { cart: "50bmg", moa: 3, zero: 800, sightH: 0, recoil: 1.2, eff: 1800, area: 1800, max: 2500, cls: "lmg", malf: 1 / 6000, tracer: 5, mount: true },
    m2_50cal_ring: { cart: "50bmg", moa: 3.5, zero: 800, sightH: 0, recoil: 1.6, eff: 1800, area: 1800, max: 2500, cls: "lmg", malf: 1 / 6000, tracer: 5, mount: true },
    m2_50cal_rws:  { cart: "50bmg", moa: 2.5, zero: 800, sightH: 0, recoil: 0.8, eff: 1800, area: 1800, max: 2500, cls: "lmg", malf: 1 / 6000, tracer: 5, mount: true },
  };

  /* ---- THE ROCKET AND THE GRENADES ---------------------------------------
     PG-7V (RPG-7): kicked out at 115 m/s, the sustainer lights ~11 m out and
     burns to 295 m/s; the round self-destructs at ~920 m (about 4.5 s).
     M67 hand grenade: 4-5.5 s fuse, 180 g of Comp B, 5 m kill / 15 m wound.
     40 mm M433 HEDP: 76 m/s, arms 14-27 m from the muzzle. */
  const ROCKET = {
    pg7v: { v0: 115, vMax: 295, ignite: 0.1, burn: 0.45, life: 4.5, blast: 9, power: 1.6, backblast: 30, backKill: 5, sigmaMil: 1.2 },
  };
  const GRENADE = {
    m67: { fuse: 4.5, fuseJit: 0.5, throwV: 19, kill: 5, wound: 15, blast: 10, power: 0.9, mass: 0.4 },
    m433: { v0: 76, arm: 18, blast: 6, power: 0.9 },
  };

  /* ---- THE MATERIALS -----------------------------------------------------
     fx: what CBZ.bulletImpact throws (gunfx: "dust" | "wood" | "spark"),
     surf: the debris kind (systems/debris.js), ric: critical grazing angle
     (deg) below which a round may skip off, ricP: the chance it does. */
  const MAT = {
    flesh:    { fx: "blood", ric: 0, ricP: 0 },
    wood:     { fx: "wood", surf: "wood", ric: 8, ricP: 0.15 },
    sand:     { fx: "dust", surf: "dirt", ric: 5, ricP: 0.25, color: 0xcdb48a },
    dirt:     { fx: "dust", surf: "dirt", ric: 6, ricP: 0.30, color: 0x8c7658 },
    snow:     { fx: "dust", surf: "dirt", ric: 3, ricP: 0.10, color: 0xf2f4f7, as: "sand" },
    cinder:   { fx: "dust", surf: "concrete", ric: 14, ricP: 0.35 },
    brick:    { fx: "dust", surf: "brick", ric: 14, ricP: 0.35 },
    concrete: { fx: "dust", surf: "concrete", ric: 18, ricP: 0.45 },
    steel:    { fx: "spark", surf: "metal", ric: 25, ricP: 0.55 },
    rha:      { fx: "spark", surf: "metal", ric: 30, ricP: 0.65 },
    water:    { fx: "splash", ric: 7, ricP: 0.5, as: "flesh" },
  };
  function matPen(cart, mat) {
    const m = MAT[mat];
    const k = (m && m.as) || mat;
    const p = cart.pen[k];
    return p != null ? p : cart.pen.concrete;
  }

  /* ---- FLIGHT ------------------------------------------------------------ */
  function reach(v0, k) { return k > 1e-4 ? v0 / k : Infinity; }
  // time to cover horizontal distance s
  function tof(v0, k, s) {
    if (!(v0 > 0)) return 0;
    if (k <= 1e-4) return s / v0;
    const r = v0 / k;
    if (s >= r * 0.999) return 99;
    return -Math.log(1 - s / r) / k;
  }
  // velocity remaining at distance s (exact on this drag law: v = v0 - k s)
  function vAt(v0, k, s) { return Math.max(0, v0 - k * s); }
  function drop(v0, k, s) { const t = tof(v0, k, s); return 0.5 * G * t * t; }
  // point of impact relative to the line of sight at s, for a gun zeroed at z
  function poi(v0, k, s, zero, sightH) {
    const h = sightH || 0, z = Math.max(1, zero || 100);
    return s * (drop(v0, k, z) + h) / z - drop(v0, k, s) - h;
  }
  function energy(cart, v) { return 0.5 * (cart.g / 1000) * v * v; }
  // depth (m) of material at velocity v
  function depth(cart, mat, v, v0) {
    const r = Math.max(0, v / (v0 || cart.v0));
    return matPen(cart, mat) * Math.pow(r, 1.5);
  }
  // cross a layer: returns the exit velocity (0 = stopped inside it)
  function pierce(cart, mat, thick, v, v0) {
    const D = depth(cart, mat, v, v0);
    if (thick >= D) return 0;
    return v * Math.sqrt(1 - thick / D);
  }
  // mm of RHA this round defeats at v (what CBZ.vehicleDrive.resolve reads)
  function penRHA(cart, v, v0) { return depth(cart, "rha", v, v0) * 1000; }
  /* RICOCHET. sinGraze = |d . n| (0 = skimming the surface, 1 = square on).
     A round only skips off below the material's critical angle, with the
     material's odds, and leaves with a fraction of its speed. */
  function ricochet(mat, sinGraze, rnd) {
    const m = MAT[mat];
    if (!m || !m.ric) return 0;
    const a = Math.asin(Math.min(1, Math.abs(sinGraze))) * 180 / Math.PI;
    if (a >= m.ric) return 0;
    const odds = m.ricP * (1 - a / m.ric * 0.6);
    return (rnd || Math.random)() < odds ? 0.35 + 0.3 * (1 - a / m.ric) : 0;
  }
  /* SUPPRESSION RADIUS: the crack of a supersonic bullet and the size of the
     round decide how far a near miss rattles a man. Subsonic pistol rounds
     only make you flinch inside arm's reach; a .50 cracks like a whip at 8. */
  function suppressR(cart, v) {
    const sup = v > SOUND * 1.05;
    const e = energy(cart, v);
    return (sup ? 1.6 : 0.9) + Math.sqrt(e) * (sup ? 0.045 : 0.025);
  }

  /* ---- THE SHOOTER -------------------------------------------------------
     hold (mil, 1-sigma, per axis) of a trained soldier in each stance; the
     training row multiplies it. Recovery is the time constant the muzzle
     takes to come back after a shot. Range estimation error is a fraction
     of range; lead is how well he leads a mover (mean, spread). */
  const HOLD = { stand: 2.2, crouch: 1.4, prone: 0.75, bipod: 0.45, mount: 0.35, pistolStand: 3.6, pistolCrouch: 2.8 };
  const TRAIN = {
    civ:   { hold: 2.4, recover: 0.42, rangeErr: 0.25, leadMean: 0.35, leadSd: 0.45, holdOver: false, malfK: 3.0, clear: 4.0, throwErr: 0.22, react: 0.85 },
    thug:  { hold: 1.8, recover: 0.32, rangeErr: 0.20, leadMean: 0.55, leadSd: 0.35, holdOver: false, malfK: 2.0, clear: 3.0, throwErr: 0.18, react: 0.55 },
    pro:   { hold: 1.3, recover: 0.24, rangeErr: 0.14, leadMean: 0.80, leadSd: 0.25, holdOver: true, malfK: 1.2, clear: 2.2, throwErr: 0.13, react: 0.38 },
    elite: { hold: 1.0, recover: 0.18, rangeErr: 0.10, leadMean: 0.95, leadSd: 0.15, holdOver: true, malfK: 1.0, clear: 1.6, throwErr: 0.09, react: 0.26 },
    swat:  { hold: 0.9, recover: 0.16, rangeErr: 0.08, leadMean: 1.00, leadSd: 0.12, holdOver: true, malfK: 0.9, clear: 1.4, throwErr: 0.08, react: 0.20 },
  };
  // MOA extreme spread -> 1-sigma mil per axis
  function moaSigma(moa) { return (moa || 0) * 0.2909 / 3; }
  /* the shooter's whole angular error, 1-sigma mil per axis. o:
       gun, tier, stance ("stand"|"crouch"|"prone"), bipod, mount,
       speed (m/s, his own), settle (0..1: how far his aim has settled),
       supp (0..1.2, his rattle), heat (mil of recoil not yet recovered) */
  function sigma(o) {
    const g = o.gun || GUN.carbine, T = TRAIN[o.tier] || TRAIN.pro;
    const pistol = g.cls === "pistol" || g.cls === "smg" && g === GUN.uzi;
    let hold;
    if (o.mount || g.mount) hold = HOLD.mount;
    else if (o.stance === "prone") hold = (o.bipod && g.bipod) ? HOLD.bipod : HOLD.prone;
    else if (o.stance === "crouch") hold = pistol ? HOLD.pistolCrouch : HOLD.crouch;
    else hold = pistol ? HOLD.pistolStand : HOLD.stand;
    hold *= T.hold;
    const sp = o.speed || 0;
    if (sp > 0.3) hold += (sp > 3.4 ? 14 : sp > 1.6 ? 7 : 3.5) * Math.sqrt(T.hold);
    hold *= 1 + 2.2 * (1 - Math.max(0, Math.min(1, o.settle == null ? 1 : o.settle)));
    hold *= 1 + 1.1 * Math.max(0, o.supp || 0);
    const mech = moaSigma(g.moa);
    const heat = o.heat || 0;
    return Math.sqrt(hold * hold + mech * mech + heat * heat * 0.25);
  }
  // one gaussian draw from a uniform stream (the caller's seeded rng)
  function gauss(rnd) {
    const u = Math.max(1e-9, rnd()), v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307 * v);
  }

  /* ---- THE BODY ----------------------------------------------------------
     A body is a set of zone boxes in its own frame: f forward, r right, y up
     (metres for a man; fractions of the measured length/height/width for an
     animal). `vital` boxes sit inside the outer ones and are what decides
     the outcome; `hit` names the outer zone for the wound pass (soldier.js's
     zone vocabulary: head torso gut armL armR legL legR). */
  function Z(name, f0, f1, r0, r1, y0, y1, kind) { return { name: name, f0: f0, f1: f1, r0: r0, r1: r1, y0: y0, y1: y1, kind: kind || "outer" }; }
  const MAN = {
    stand: [
      Z("head", -0.10, 0.11, -0.09, 0.09, 1.55, 1.78), Z("brain", -0.08, 0.08, -0.07, 0.07, 1.60, 1.75, "brain"),
      Z("neck", -0.06, 0.06, -0.06, 0.06, 1.45, 1.55, "outer"), Z("neckV", -0.04, 0.04, -0.04, 0.04, 1.46, 1.54, "spine"),
      Z("torso", -0.12, 0.12, -0.19, 0.19, 1.10, 1.45), Z("heart", -0.08, 0.09, -0.14, 0.14, 1.13, 1.42, "vital"),
      Z("spineT", -0.12, -0.07, -0.025, 0.025, 0.85, 1.45, "spine"),
      Z("gut", -0.11, 0.11, -0.17, 0.17, 0.76, 1.10), Z("gutV", -0.08, 0.09, -0.13, 0.13, 0.80, 1.08, "gut"),
      Z("armL", -0.05, 0.30, -0.30, -0.19, 1.00, 1.45), Z("armR", -0.05, 0.30, 0.19, 0.30, 1.00, 1.45),
      Z("legL", -0.08, 0.08, -0.18, -0.02, 0.0, 0.78), Z("legR", -0.08, 0.08, 0.02, 0.18, 0.0, 0.78),
    ],
    crouch: [
      Z("head", -0.08, 0.13, -0.09, 0.09, 0.98, 1.20), Z("brain", -0.06, 0.10, -0.07, 0.07, 1.02, 1.17, "brain"),
      Z("torso", -0.12, 0.14, -0.19, 0.19, 0.62, 0.98), Z("heart", -0.08, 0.10, -0.14, 0.14, 0.65, 0.95, "vital"),
      Z("spineT", -0.12, -0.07, -0.025, 0.025, 0.42, 0.98, "spine"),
      Z("gut", -0.12, 0.12, -0.17, 0.17, 0.40, 0.62), Z("gutV", -0.08, 0.10, -0.13, 0.13, 0.43, 0.60, "gut"),
      Z("armL", 0.00, 0.40, -0.30, -0.17, 0.60, 0.98), Z("armR", 0.00, 0.40, 0.17, 0.30, 0.60, 0.98),
      Z("legL", -0.25, 0.45, -0.20, -0.02, 0.0, 0.45), Z("legR", -0.25, 0.45, 0.02, 0.20, 0.0, 0.45),
    ],
    prone: [
      Z("head", 0.72, 0.95, -0.10, 0.10, 0.12, 0.38), Z("brain", 0.75, 0.92, -0.07, 0.07, 0.16, 0.34, "brain"),
      Z("torso", 0.25, 0.72, -0.22, 0.22, 0.0, 0.30), Z("heart", 0.30, 0.68, -0.16, 0.16, 0.03, 0.26, "vital"),
      Z("spineT", -0.05, 0.72, -0.025, 0.025, 0.20, 0.27, "spine"),
      Z("gut", -0.05, 0.25, -0.20, 0.20, 0.0, 0.26), Z("gutV", -0.03, 0.23, -0.15, 0.15, 0.03, 0.22, "gut"),
      Z("armL", 0.55, 1.15, -0.32, -0.20, 0.0, 0.25), Z("armR", 0.55, 1.15, 0.20, 0.32, 0.0, 0.25),
      Z("legL", -1.00, -0.05, -0.22, -0.02, 0.0, 0.20), Z("legR", -1.00, -0.05, 0.02, 0.22, 0.0, 0.20),
    ],
  };
  // four legs: f from tail (0) to nose (1), r across (+-0.5 = the flanks), y 0..1 of height
  const QUAD = [
    Z("head", 0.86, 1.00, -0.22, 0.22, 0.60, 0.98), Z("brain", 0.88, 0.95, -0.12, 0.12, 0.72, 0.90, "brain"),
    Z("neck", 0.72, 0.86, -0.25, 0.25, 0.56, 0.94),
    Z("torso", 0.47, 0.74, -0.45, 0.45, 0.42, 0.90), Z("heart", 0.52, 0.72, -0.32, 0.32, 0.46, 0.78, "vital"),
    Z("spineT", 0.20, 0.86, -0.08, 0.08, 0.80, 0.90, "spine"),
    Z("gut", 0.18, 0.47, -0.45, 0.45, 0.42, 0.84), Z("gutV", 0.20, 0.46, -0.36, 0.36, 0.46, 0.80, "gut"),
    Z("hind", 0.00, 0.18, -0.40, 0.40, 0.42, 0.90),
    Z("legF", 0.55, 0.72, -0.42, 0.42, 0.0, 0.45), Z("legH", 0.04, 0.24, -0.42, 0.42, 0.0, 0.45),
  ];
  const FISH = [
    Z("head", 0.80, 1.00, -0.40, 0.40, 0.15, 0.85), Z("brain", 0.84, 0.92, -0.15, 0.15, 0.45, 0.70, "brain"),
    Z("torso", 0.60, 0.80, -0.48, 0.48, 0.12, 0.88), Z("heart", 0.62, 0.78, -0.30, 0.30, 0.25, 0.65, "vital"),
    Z("spineT", 0.10, 0.84, -0.06, 0.06, 0.62, 0.74, "spine"),
    Z("gut", 0.35, 0.60, -0.48, 0.48, 0.12, 0.85), Z("gutV", 0.37, 0.58, -0.35, 0.35, 0.2, 0.7, "gut"),
    Z("tail", 0.00, 0.35, -0.35, 0.35, 0.15, 0.80),
  ];
  const HIT_ZONE = { head: "head", brain: "head", neck: "head", neckV: "head", torso: "torso", heart: "torso", spineT: "torso",
    gut: "gut", gutV: "gut", armL: "armL", armR: "armR", legL: "legL", legR: "legR", hind: "legs", legF: "legs", legH: "legs", tail: "gut" };

  /* ---- THE SPECIES -------------------------------------------------------
     mass kg, hide mm, skull mm (bone between the surface and the brain, in
     the direction a round usually comes from: an elephant's honeycomb skull
     is ~25 cm of honeycomb bone from the front), ribs mm (the chest wall's
     bone over the heart and lungs; derived from mass when omitted), plan. A species file's stats win. */
  const SPECIES = {
    men: { mass: 80, hide: 0, skull: 7, plan: "man" },
    african_elephant: { mass: 6000, hide: 25, skull: 250 }, white_rhino: { mass: 2300, hide: 20, skull: 120 },
    giraffe: { mass: 1000, hide: 15, skull: 40 }, bison: { mass: 800, hide: 10, skull: 45 }, cow: { mass: 600, hide: 6, skull: 30 },
    moose: { mass: 500, hide: 8, skull: 30 }, horse: { mass: 500, hide: 5, skull: 25 }, zebra: { mass: 320, hide: 6, skull: 25 },
    elk: { mass: 320, hide: 6, skull: 22 }, caribou: { mass: 150, hide: 5, skull: 18 }, whitetail_deer: { mass: 70, hide: 3, skull: 12 },
    white_stag: { mass: 90, hide: 3, skull: 12 }, wild_boar: { mass: 90, hide: 12, skull: 30 }, pig: { mass: 100, hide: 6, skull: 25 },
    goat: { mass: 50, hide: 3, skull: 12 }, sheep: { mass: 60, hide: 3, skull: 12 }, bighorn_sheep: { mass: 90, hide: 4, skull: 40 },
    mountain_goat: { mass: 80, hide: 4, skull: 20 },
    gorilla: { mass: 160, hide: 3, skull: 12 }, bengal_tiger: { mass: 220, hide: 5, skull: 12 }, lion: { mass: 190, hide: 5, skull: 12 },
    white_lion: { mass: 190, hide: 5, skull: 12 }, cheetah: { mass: 50, hide: 3, skull: 8 }, snow_leopard: { mass: 45, hide: 3, skull: 8 },
    brown_bear: { mass: 300, hide: 8, skull: 18 }, polar_bear: { mass: 450, hide: 8, skull: 18 }, black_bear: { mass: 120, hide: 6, skull: 15 },
    gray_wolf: { mass: 45, hide: 3, skull: 9 }, arctic_wolf: { mass: 40, hide: 3, skull: 9 }, coyote: { mass: 14, hide: 2, skull: 6 },
    red_fox: { mass: 6, hide: 1.5, skull: 4 }, dog: { mass: 30, hide: 2, skull: 7 }, raccoon: { mass: 7, hide: 2, skull: 4 },
    chicken: { mass: 2.5, hide: 0.5, skull: 1.5 }, cottontail_rabbit: { mass: 1.4, hide: 0.5, skull: 1.2 },
    jackrabbit: { mass: 3, hide: 0.6, skull: 1.5 }, snowshoe_hare: { mass: 1.5, hide: 0.5, skull: 1.2 },
    great_white_shark: { mass: 1100, hide: 8, skull: 30, plan: "fish" }, bull_shark: { mass: 200, hide: 6, skull: 18, plan: "fish" },
    hammerhead_shark: { mass: 300, hide: 6, skull: 20, plan: "fish" }, megalodon: { mass: 50000, hide: 25, skull: 200, plan: "fish" },
    orca: { mass: 5000, hide: 25, skull: 120, plan: "fish" }, dolphin: { mass: 200, hide: 15, skull: 20, plan: "fish" },
    humpback_whale: { mass: 30000, hide: 30, skull: 250, plan: "fish" }, manta_ray: { mass: 1500, hide: 6, skull: 40, plan: "fish" },
    sea_turtle: { mass: 150, hide: 15, skull: 20, plan: "fish" }, tuna: { mass: 250, hide: 3, skull: 15, plan: "fish" },
    marlin: { mass: 200, hide: 3, skull: 15, plan: "fish" }, barracuda: { mass: 10, hide: 1, skull: 4, plan: "fish" },
    fish: { mass: 2, hide: 0.5, skull: 2, plan: "fish" }, sardine: { mass: 0.1, hide: 0.2, skull: 0.5, plan: "fish" },
  };
  const HIDE_EQ = 6;      // 1 m of hide stops what 6 m of gelatin would
  const BONE_EQ = 4;      // skull bone, in gelatin metres (cortical + honeycomb mean)
  /* the anatomy row for a unit: the species file's own numbers first (via
     CBZ.unitKit.stat), then this table, then a size-derived guess. */
  function anatomyOf(id, unit) {
    const base = SPECIES[id] || null;
    const st = (k, d) => (CBZ.unitKit && CBZ.unitKit.stat) ? CBZ.unitKit.stat(id, k, d) : d;
    let mass = st("mass", base && base.mass);
    if (!(mass > 0)) {
      const hp = unit && unit.maxHp > 0 && unit.maxHp < 1e8 ? unit.maxHp : 100;
      mass = Math.max(1, Math.min(60000, 80 * Math.pow(hp / 100, 1.5)));
    }
    const sp = CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES[id];
    const aquatic = !!(sp && (sp.aquatic || sp.biome === "water"));
    return {
      mass: mass,
      hide: st("hide", base ? base.hide : Math.min(25, 1 + Math.cbrt(mass) * 0.9)),
      skull: st("skull", base ? base.skull : Math.min(300, 4 + Math.cbrt(mass) * 3)),
      ribs: st("ribs", base && base.ribs != null ? base.ribs : 2 + Math.cbrt(mass) * 2.2),
      plan: st("plan", (base && base.plan) || (aquatic ? "fish" : "quad")),
    };
  }

  /* trace a line through a body. The line is given in the body's frame:
     origin (of, or, oy) and unit direction (df, dr, dy), in the plan's units
     (scale with sf/sr/sy: metres per plan unit along each axis; a man's plan
     is already metres, an animal's is fractions of its measured box). Fills
     `out.z` with the zones crossed: {name, kind, a, b} (entry/exit in METRES
     along the line), sorted by entry. Returns the number crossed. */
  function traceZones(zones, of, or, oy, df, dr, dy, sf, sr, sy, out) {
    const list = out.z || (out.z = []);
    let n = 0;
    for (let i = 0; i < zones.length; i++) {
      const zz = zones[i];
      let t0 = -1e9, t1 = 1e9;
      // f
      let lo = zz.f0 * sf, hi = zz.f1 * sf;
      if (Math.abs(df) < 1e-9) { if (of < lo || of > hi) continue; }
      else { let a = (lo - of) / df, b = (hi - of) / df; if (a > b) { const s = a; a = b; b = s; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) continue; }
      lo = zz.r0 * sr; hi = zz.r1 * sr;
      if (Math.abs(dr) < 1e-9) { if (or < lo || or > hi) continue; }
      else { let a = (lo - or) / dr, b = (hi - or) / dr; if (a > b) { const s = a; a = b; b = s; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) continue; }
      lo = zz.y0 * sy; hi = zz.y1 * sy;
      if (Math.abs(dy) < 1e-9) { if (oy < lo || oy > hi) continue; }
      else { let a = (lo - oy) / dy, b = (hi - oy) / dy; if (a > b) { const s = a; a = b; b = s; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) continue; }
      if (t1 < 0) continue;
      let e = list[n];
      if (!e) e = list[n] = { name: "", kind: "", a: 0, b: 0 };
      e.name = zz.name; e.kind = zz.kind; e.a = t0; e.b = t1;
      n++;
    }
    // insertion sort by entry (n is small)
    for (let i = 1; i < n; i++) {
      const e = list[i];
      let j = i - 1;
      while (j >= 0 && list[j].a > e.a) { list[j + 1] = list[j]; j--; }
      list[j + 1] = e;
    }
    out.n = n;
    return n;
  }

  /* WHAT THE ROUND DID TO THE BODY. `tr` is a traceZones result, `an` the
     anatomy row, `cart` + v the round arriving, `layer` an optional armour
     plate in front of it ({mat, mm}). Returns into `res`:
       hit      false if the line missed every outer zone
       zone     the outer zone struck first (soldier.js vocabulary)
       organ    "brain" | "spine" | "vital" | "gut" | null — the deepest
                thing the bullet reached that decides the outcome
       dep      joules left in the body; vOut the exit velocity (0 = in it)
       path     metres of body crossed; entry/exit metres along the line */
  function wound(tr, an, cart, v, v0, layer, res) {
    res = res || {};
    res.hit = false; res.zone = null; res.organ = null; res.dep = 0; res.vOut = v; res.path = 0;
    res.entry = 0; res.exit = 0; res.stopped = false; res.plate = false;
    const list = tr.z, n = tr.n;
    let entry = Infinity, exit = -Infinity, path = 0, first = null;
    for (let i = 0; i < n; i++) {
      const e = list[i];
      if (e.kind !== "outer") continue;
      if (e.a < entry) { entry = e.a; first = e; }
      if (e.b > exit) exit = e.b;
      path += Math.max(0, e.b - Math.max(e.a, 0));
    }
    if (!first) return res;
    res.hit = true;
    res.zone = HIT_ZONE[first.name] || "torso";
    res.entry = entry; res.exit = exit;
    let D = depth(cart, "flesh", v, v0);           // gelatin metres this round has
    let used = 0;
    // an armour plate in front of the flesh (body armour, a helmet)
    if (layer && layer.mm > 0) {
      const pd = depth(cart, layer.mat || "steel", v, v0);
      const t = layer.mm / 1000;
      if (t >= pd) {
        res.plate = true; res.stopped = true; res.vOut = 0;
        res.dep = energy(cart, v) * 0.12;            // the blunt trauma behind the plate
        return res;
      }
      v = v * Math.sqrt(1 - t / pd);
      D = depth(cart, "flesh", v, v0);
    }
    used += (an.hide || 0) / 1000 * HIDE_EQ;
    // what the bullet reaches: walk the vital boxes in the order it meets them
    let organ = null, organRank = 0;
    for (let i = 0; i < n; i++) {
      const e = list[i];
      if (e.kind === "outer") continue;
      const into = Math.max(0, e.a - entry);
      let need = used + into;
      if (e.kind === "brain") need += (an.skull || 7) / 1000 * BONE_EQ;
      else if (e.kind === "vital" || e.kind === "spine") need += (an.ribs || 10) / 1000 * BONE_EQ;
      if (need >= D) continue;
      const rank = e.kind === "brain" ? 4 : e.kind === "spine" ? 3 : e.kind === "vital" ? 2 : 1;
      if (rank > organRank) { organRank = rank; organ = e.kind; }
    }
    res.organ = organ;
    const total = used + path + (organ === "brain" ? (an.skull || 7) / 1000 * BONE_EQ
      : organ === "vital" || organ === "spine" ? (an.ribs || 10) / 1000 * BONE_EQ : 0);
    const E = energy(cart, v);
    if (total >= D) { res.stopped = true; res.vOut = 0; res.dep = E; res.path = path; return res; }
    const vOut = v * Math.sqrt(1 - total / D);
    res.vOut = vOut;
    res.dep = E - energy(cart, vOut);
    res.path = path;
    return res;
  }

  /* HOW HURT. Turns a wound into the battle's two numbers: damage now (as a
     fraction of the unit's whole) and bleeding (fraction per second).
     brain        dead
     spine        down: most of it now, the rest bleeds
     vital        heart/lungs/great vessels. A man is very likely out of the
                  fight on the spot (the energy says how sure); an animal is
                  mortally hit and keeps going on its oxygen: the bleed time
                  grows with mass^0.25 (a deer runs 50 m, an elephant 200)
     gut          slow: minutes, fights on
     limb/other   tissue damage from the energy left in it */
  function harm(res, an, isMan) {
    const out = { now: 0, bleed: 0, kill: false };
    if (!res.hit) return out;
    const mass = an.mass || 80;
    const tBleed = 8 * Math.pow(mass / 80, 0.25);
    const dep = res.dep;
    const tissue = dep / (mass * (isMan ? 15 : 20));
    switch (res.organ) {
      case "brain": out.kill = true; out.now = 1; break;
      case "spine": out.now = Math.min(1, 0.55 + tissue); out.bleed = 1 / (tBleed * 1.6); break;
      case "vital":
        out.now = isMan ? Math.min(1, 0.55 + 0.45 * Math.min(1, dep / 600)) : Math.min(0.9, 0.1 + tissue * 0.5);
        out.bleed = 1 / tBleed;
        break;
      case "gut":
        out.now = Math.min(0.9, tissue * 0.9 + 0.05);
        out.bleed = 1 / (tBleed * 10);
        break;
      default: {
        const limb = res.zone && (res.zone.indexOf("arm") === 0 || res.zone.indexOf("leg") === 0);
        out.now = Math.min(0.8, tissue * (limb ? 0.65 : 1));
        out.bleed = dep > 150 ? 1 / (tBleed * (limb ? 18 : 14)) : 0;
      }
    }
    if (res.zone === "head" && !out.kill) out.now = Math.max(out.now, Math.min(0.9, 0.3 + tissue));
    if (res.plate) { out.now = Math.min(0.15, dep / (mass * 40)); out.bleed = 0; }
    return out;
  }

  /* lead: where to put the aim on a mover. Returns the factor of the true
     lead this shooter applies this shot (1 = perfect). */
  function leadFactor(tier, rnd) {
    const T = TRAIN[tier] || TRAIN.pro;
    return T.leadMean + gauss(rnd) * T.leadSd;
  }
  /* the low firing solution for a lob (grenade, 40 mm): elevation for a
     throw of speed v to a point dist away and dy up. null = out of reach. */
  function lob(v, dist, dy, high) {
    const v2 = v * v, disc = v2 * v2 - G * (G * dist * dist + 2 * dy * v2);
    if (disc < 0) return null;
    const r = Math.sqrt(disc);
    const el = Math.atan((v2 + (high ? r : -r)) / (G * dist));
    return { elev: el, t: dist / (v * Math.cos(el)) };
  }

  function cartOf(gunId) {
    const g = GUN[gunId];
    return g && g.cart ? CART[g.cart] : null;
  }
  // the gun row's muzzle velocity: the weapon table's barrel if it has one
  function muzzleV(gunId, wrow) {
    const c = cartOf(gunId);
    if (wrow && wrow.v0 > 0 && !(GUN[gunId] && GUN[gunId].mount)) return wrow.v0;
    return c ? c.v0 : 0;
  }
  function dragOf(gunId, wrow) {
    const c = cartOf(gunId);
    if (wrow && wrow.dragK > 0 && !(GUN[gunId] && GUN[gunId].mount)) return wrow.dragK;
    return c ? c.dragK : 0.5;
  }

  CBZ.ballistics = {
    G: G, SOUND: SOUND, CART: CART, GUN: GUN, MAT: MAT, ROCKET: ROCKET, GRENADE: GRENADE,
    HOLD: HOLD, TRAIN: TRAIN, MAN: MAN, QUAD: QUAD, FISH: FISH, SPECIES: SPECIES, HIT_ZONE: HIT_ZONE,
    HIDE_EQ: HIDE_EQ, BONE_EQ: BONE_EQ,
    tof: tof, vAt: vAt, drop: drop, poi: poi, reach: reach, energy: energy, depth: depth, pierce: pierce,
    penRHA: penRHA, ricochet: ricochet, suppressR: suppressR, sigma: sigma, moaSigma: moaSigma, gauss: gauss,
    traceZones: traceZones, wound: wound, harm: harm, anatomyOf: anatomyOf, leadFactor: leadFactor, lob: lob,
    cartOf: cartOf, muzzleV: muzzleV, dragOf: dragOf, matPen: matPen,
    gun: function (id) { return GUN[id] || null; },
  };
})();
