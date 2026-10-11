/* ============================================================
   units/kit/vehicle.js — THE SHARED VEHICLE MATHS. Every vehicle unit file
   (src/units/vehicles/<id>.js) leans on this instead of writing its own
   drive, its own turret laying or its own armour rules.

   NOT A REGISTRY. CBZ.vehicleKit (units/unitkit.js) stays the registry
   view; this file publishes CBZ.vehicleDrive, pure maths (no THREE) so
   node checks can load it.

   CONVENTIONS (the same as men and as city/mil_armor.js / mil_air.js):
     hull yaw h: forward in the world is (sin h, cos h); the model's nose is
     local +Z; turret yaw is RELATIVE to the hull; elevation up is positive.

   PUBLIC  CBZ.vehicleDrive = {
     tracked(s, spec, ctrl, dt)   pivot-steer tracked hull: ctrl {throttle -1..1,
                                  steer -1..1, brake 0..1} -> s.v, s.w (yaw rate),
                                  s.trackL / s.trackR (belt speeds for the rig)
     wheeled(s, spec, ctrl, dt)   Ackermann: yaw rate = v tan(steer) / wheelbase
     pose(s, groundAt, x, z, h, L, W)  ground follow + suspension: s.y, s.pitch,
                                  s.roll eased from four contact samples
     lay(cur, want, rate, dt)     rate-limited angle (wrapped)
     layClamp(cur, want, lo, hi, rate, dt)
     ballistic(dx, dy, dist, v0, g) -> {elev, t} low-angle firing solution
     zone(h, fromX, fromZ, x, z, top) -> "front"|"side"|"rear"|"top"
                                  ("belly" is the battle's: a blast under the hull,
                                  read off stats.armour.belly, else the roof's figure)
     threatOf(imp, weaponPen)     -> {pen (mm RHA), beh (damage behind armour),
                                  he (true for blast), cls}  what hit us
     resolve(vs, stats, zone, threat, rnd) -> {pen:bool, dmg, kill:{mobility,
                                  firepower, burning, wreck}} armour + damage states
                                  (stats.armourCE, optional: per-face armour vs
                                  shaped charges, used for heat/atgm/hedp)
                                  SLAT / BAR ARMOUR (optional): vs.slat (per hull)
                                  else stats.slat = the chance a cage catches an
                                  RPG-class warhead (cls "heat") on a side, front
                                  or rear face; caught -> {slat: true}, no pen
     seats(def) / seat(crew, man, seat) / unseat(crew, seat)   crew seat book;
                                  def.benches[i] (optional) = passenger i's seat
                                  position in hull space (else [0, 1.2, -1])
   }
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ || (W.CBZ = {});
  if (CBZ.vehicleDrive) return;
  const PI = Math.PI, TAU = PI * 2;
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function wrap(a) { while (a > PI) a -= TAU; while (a < -PI) a += TAU; return a; }

  /* TRACKED: two belts. Throttle sets the mean belt speed, steer splits it;
     at rest full steer counter-rotates the belts (a neutral pivot). Speed
     is approached at the hull's own acceleration, braking is harder. */
  function tracked(s, spec, ctrl, dt) {
    const top = spec.speed || 15, rev = spec.reverse || top * 0.35;
    const acc = spec.accel || 3, turn = spec.turn || 0.6;
    const thr = clamp(ctrl.throttle || 0, -1, 1), st = clamp(ctrl.steer || 0, -1, 1);
    const want = thr >= 0 ? thr * top : thr * rev;
    const a = (ctrl.brake > 0 || Math.sign(want) !== Math.sign(s.v || 0) && Math.abs(s.v || 0) > 0.3) ? acc * 2.2 : acc;
    s.v = (s.v || 0) + clamp(want - (s.v || 0), -a * dt, a * dt);
    if (spec.mobilityKill) s.v *= Math.max(0, 1 - dt * 3);
    // a tracked hull pivots even at rest, and turns slower at speed
    const k = 0.55 + 0.45 * Math.min(1, Math.abs(s.v) / 6);
    const wWant = -st * turn * (Math.abs(s.v) < 0.5 ? 1 : k);
    s.w = (s.w || 0) + clamp(wWant - (s.w || 0), -turn * 3 * dt, turn * 3 * dt);
    const half = (spec.width || 3.4) * 0.5;
    s.trackL = s.v - s.w * half; s.trackR = s.v + s.w * half;
    return s;
  }
  /* WHEELED: the front axle steers, the hull turns about the rear axle. */
  function wheeled(s, spec, ctrl, dt) {
    const top = spec.speed || 20, rev = spec.reverse || top * 0.3;
    const acc = spec.accel || 3.5, maxSteer = spec.maxSteer || 0.55;
    const thr = clamp(ctrl.throttle || 0, -1, 1);
    let want = thr >= 0 ? thr * top : thr * rev;
    const stCmd = clamp(ctrl.steer || 0, -1, 1);
    const wb = spec.wheelbase || 3.5;
    /* GRIP (opt-in: spec.grip, in g). Tyres hold about grip x 9.8 m/s2
       sideways: a driver lifts to make a corner (the speed at which the
       commanded lock is still inside the grip circle) and the lock itself is
       limited at speed, so a truck at 90 km/h cannot turn on a dime. */
    if (spec.grip > 0) {
      const ay = spec.grip * 9.8, tl = Math.tan(Math.max(1e-3, Math.abs(stCmd) * maxSteer));
      const vCorner = Math.sqrt(ay * wb / tl) * 1.15;
      if (want > vCorner) want = Math.max(vCorner, Math.min(want, 4));
    }
    // brakes are stronger than the engine (a grip-aware hull also brakes, not coasts, into a corner)
    const a = ctrl.brake > 0 || (spec.grip > 0 && Math.abs(want) < Math.abs(s.v || 0) - 0.5) ? acc * 2.5 : acc;
    s.v = (s.v || 0) + clamp(want - (s.v || 0), -a * dt, a * dt);
    if (spec.mobilityKill) s.v *= Math.max(0, 1 - dt * 3);
    let lock = stCmd * maxSteer;
    if (spec.grip > 0 && Math.abs(s.v) > 1) lock = clamp(lock, -Math.atan(spec.grip * 9.8 * wb / (s.v * s.v)), Math.atan(spec.grip * 9.8 * wb / (s.v * s.v)));
    s.steer = (s.steer || 0) + clamp(lock - (s.steer || 0), -2 * dt, 2 * dt);
    s.w = -s.v * Math.tan(s.steer) / (spec.wheelbase || 3.5);
    return s;
  }
  /* GROUND FOLLOW + SUSPENSION. Four contact points (nose/tail, left/right)
     give pitch and roll; the hull eases toward them like springs. */
  function pose(s, groundAt, x, z, h, L, Wd, dt) {
    const fx = Math.sin(h), fz = Math.cos(h), rx = Math.cos(h), rz = -Math.sin(h);
    const hl = L * 0.42, hw = Wd * 0.42;
    const yf = groundAt(x + fx * hl, z + fz * hl), yb = groundAt(x - fx * hl, z - fz * hl);
    const yr = groundAt(x + rx * hw, z + rz * hw), yl = groundAt(x - rx * hw, z - rz * hw);
    const y0 = groundAt(x, z);
    const pitch = Math.atan2(yf - yb, hl * 2), roll = Math.atan2(yl - yr, hw * 2);
    const k = dt > 0 ? Math.min(1, dt * 6) : 1;
    s.pitch = (s.pitch || 0) + (pitch - (s.pitch || 0)) * k;
    s.roll = (s.roll || 0) + (roll - (s.roll || 0)) * k;
    s.y = Math.max(y0, (yf + yb + yl + yr) * 0.25);
    return s;
  }
  function lay(cur, want, rate, dt) { const d = wrap(want - cur), s = rate * dt; return wrap(cur + clamp(d, -s, s)); }
  function layClamp(cur, want, lo, hi, rate, dt) { const w = clamp(want, lo, hi), s = rate * dt; return cur + clamp(w - cur, -s, s); }
  /* the LOW firing solution for a round leaving at v0 under gravity g, to a
     point dist away horizontally and dy above. Falls back to a flat shot. */
  function ballistic(dy, dist, v0, g) {
    if (!(g > 0)) return { elev: Math.atan2(dy, dist), t: dist / v0 };
    const v2 = v0 * v0, disc = v2 * v2 - g * (g * dist * dist + 2 * dy * v2);
    if (disc < 0) return { elev: PI / 4, t: dist / (v0 * Math.cos(PI / 4)), out: true };
    const elev = Math.atan((v2 - Math.sqrt(disc)) / (g * dist));
    return { elev: elev, t: dist / (v0 * Math.cos(elev)) };
  }
  // which face of the hull a hit coming FROM (fromX, fromZ) strikes
  function zone(h, fromX, fromZ, x, z, top) {
    if (top) return "top";
    const bx = fromX - x, bz = fromZ - z;
    if (Math.abs(bx) + Math.abs(bz) < 1e-6) return "top";
    const rel = Math.abs(wrap(Math.atan2(bx, bz) - h));
    return rel < PI / 4 ? "front" : rel > PI * 3 / 4 ? "rear" : "side";
  }
  /* WHAT HIT US, in the two numbers armour cares about: penetration (mm of
     rolled homogeneous armour it defeats) and what it does behind the plate.
     Rifle ball and teeth go nowhere through an MBT; a rocket's shaped charge
     goes through the side of anything; a 120 mm dart goes through almost
     anything from the front. */
  const SMALL = {
    // small arms by weapon id (mm RHA, ball/AP mix at combat range)
    fists: 0, taser: 0, sidearm: 3, revolver: 4, deagle: 5, uzi: 3, smg: 3, shotgun: 2,
    ak47: 8, carbine: 7, lmg: 9, sniper: 22,
  };
  const HEAVY = {
    bazooka: { pen: 420, beh: 420, he: true, cls: "heat" },        // RPG-7/AT4 class shaped charge
    glauncher: { pen: 60, beh: 160, he: true, cls: "hedp" },        // 40 mm HEDP
  };
  function threatOf(imp, by) {
    imp = imp || {};
    by = by || imp.by || null;
    if (imp.cause === "bomb") return { pen: 240, beh: 2400, he: true, cls: "bomb", top: true };
    // a buried charge (IED, mine) goes off UNDER the hull: it meets the belly.
    // ~10 kg TNT-equivalent against a floor: 160 mm RHA-equivalent of blast
    // loading; a flat-floored Humvee or a truck folds, a V-hull deflects it
    if (imp.cause === "ied" || imp.cause === "mine") return { pen: 160, beh: 900, he: true, cls: "ied", below: true };
    const blast = imp.fromX != null || imp.cause === "explosion";
    // a flown round says what it defeats where it arrived (weapons/ballistics.js:
    // the cartridge's RHA depth at its retained velocity), which beats a table
    // by weapon name that cannot know a 600 m shot from a 60 m one
    if (imp.pen != null && !blast) return { pen: imp.pen, beh: 1, he: false, cls: "small" };
    // a vehicle's own weapon says what it was: the round on the trigger
    // (_shot, set for the length of the call) or its last high-explosive
    // round in flight (_he, read when that round's blast arrives)
    if (by && by.vehicle) {
      if (blast && by._he) return by._he;
      if (!blast && by._shot) return by._shot;
    }
    if (by && by.wid && HEAVY[by.wid] && (blast || by.launcher)) return HEAVY[by.wid];
    if (blast) return { pen: 120, beh: 600, he: true, cls: "blast" };
    if (by && by.beast) return { pen: 0, beh: 1, he: false, cls: "teeth" };
    if (by && by.wid != null && SMALL[by.wid] != null) return { pen: SMALL[by.wid], beh: 1, he: false, cls: "small" };
    return { pen: 6, beh: 1, he: false, cls: "small" };
  }
  /* ARMOUR + DAMAGE STATES. `vs` is the vehicle's damage record
     {hp, maxHp, mobility, firepower, burning, wreck}. A hit that does not
     penetrate scratches paint (and a soft-skinned truck has ~0 mm, so ball
     ammunition does go through it). A penetration takes structure off and
     may cripple a system: low hits the running gear, high hits the turret
     and gun, and a big enough one cooks the ammunition (the wreck). */
  function resolve(vs, stats, zn, th, dmg, rnd) {
    rnd = rnd || Math.random;
    // a shaped charge (rocket, ATGM, HEAT) is stopped by composite/ERA far
    // better than a dart is: stats.armourCE, when a unit gives it, is the
    // face's chemical-energy figure (additive: units without it are unchanged)
    const ce = (th.cls === "heat" || th.cls === "atgm" || th.cls === "hedp") && stats.armourCE && stats.armourCE[zn] != null;
    const tab = ce ? stats.armourCE : stats.armour;
    // the belly (a blast from below): a unit that rates its floor gives
    // armour.belly (a V-hull's blast figure); else the floor is as thin as the roof
    let arm = (tab && tab[zn]) != null ? tab[zn] : 0;
    if (zn === "belly" && !(tab && tab.belly != null)) arm = (stats.armour && stats.armour.top) || 0;
    const out = { zone: zn, armour: arm, pen: false, dmg: 0, mobility: false, firepower: false, burning: false, wreck: false };
    // a slat cage shorts or crushes an RPG's fuze before its jet forms
    const slat = vs.slat != null ? vs.slat : stats.slat;
    if (slat > 0 && th.cls === "heat" && zn !== "top" && rnd() < slat) { out.slat = true; return out; }
    const p = th.pen * (0.85 + rnd() * 0.3);
    if (p <= arm && arm > 0) {
      // a blast against a hull it cannot get into still takes a track off
      if (th.he && th.pen >= arm * 0.25 && rnd() < 0.18) { vs.mobility = true; out.mobility = true; }
      return out;
    }
    out.pen = true;
    // behind the plate: soft vehicles feel small arms as plain damage
    let d = th.cls === "small" || th.cls === "teeth" ? dmg : th.beh * (0.75 + rnd() * 0.5);
    if (arm < 2 && (th.cls === "small" || th.cls === "teeth")) d = dmg * 0.6;
    out.dmg = d;
    vs.hp -= d;
    if (th.pen > arm * 1.3 && th.beh > 150) {
      const r = rnd();
      if (r < 0.22) { vs.mobility = true; out.mobility = true; }
      else if (r < 0.42) { vs.firepower = true; out.firepower = true; }
      if (rnd() < (th.beh > 500 ? 0.35 : 0.12)) { vs.burning = true; out.burning = true; }
    }
    if (vs.hp <= 0 || (vs.burning && th.beh > 500 && rnd() < 0.5)) { vs.wreck = true; out.wreck = true; vs.hp = Math.min(vs.hp, 0); }
    return out;
  }
  // ---- the crew seat book ---------------------------------------------------
  function seats(def) {
    const out = [];
    (def.crew || []).forEach(function (s) { out.push({ seat: s.seat, pos: s.pos || [0, 1.5, 0], man: null, implicit: false, crew: true }); });
    // def.passengerPos (optional): each bench seat's own place in hull space
    const pp = def.passengerPos || null;
    for (let i = 0; i < (def.passengers || 0); i++) out.push({ seat: "passenger", pos: (pp && pp[i]) || (def.benches && def.benches[i]) || [0, 1.2, -1], man: null, implicit: false, crew: false });
    return out;
  }
  function seat(book, man, which) {
    for (let i = 0; i < book.length; i++) {
      const s = book[i];
      if (s.man || s.implicit) continue;
      if (which && s.seat !== which) continue;
      s.man = man; return s;
    }
    return null;
  }
  function unseat(book, s) { const m = s.man; s.man = null; s.implicit = false; return m; }

  CBZ.vehicleDrive = { tracked: tracked, wheeled: wheeled, pose: pose, lay: lay, layClamp: layClamp,
    ballistic: ballistic, zone: zone, threatOf: threatOf, resolve: resolve, seats: seats, seat: seat, unseat: unseat,
    SMALL: SMALL, HEAVY: HEAVY, wrap: wrap, clamp: clamp };
  if (typeof module !== "undefined" && module.exports) module.exports = CBZ.vehicleDrive;
})();
