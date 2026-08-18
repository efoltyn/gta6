/* ============================================================
   systems/craters.js — ORDNANCE LEAVES THE GROUND CHANGED.

   A bomb from the B-2 used to scorch a decal and move on. The ground is a solid
   now (systems/solidground.js), so a blast can take material out of it, and the
   hole it leaves is a carving like any other: the same record a sinkhole is, the
   same floor query, the same mask. There is no crater subsystem here — there is
   a rule about when ordnance is big enough to dig, and a call.

   WHAT COUNTS AS BIG ENOUGH. Nothing under `CRATER_MIN_POWER` digs; a grenade
   scorches, an RPG scars, and only ordnance the size of an airstrike or an
   aerial bomb takes ground away. That threshold is the whole tuning surface,
   because the failure this guards against is a city slowly turning into gravel:
   craters are PERMANENT, so every one is a change to the map the player did not
   ask to keep.

   THE PLACEMENT LAW IS THE SHAFT'S LAW, DELIBERATELY. world/groundshaft.js
   already refuses a hole on a mountainside, in water, under a building footprint
   and inside a government complex, and a crater has to refuse for exactly the
   same reasons — a tower whose footing is inside a bomb hole is a floating
   tower, and this engine has no concept of "undermined". Reusing that law is
   also why craters cannot appear in the one place they would be most annoying:
   through the floor of an interior.

   MERGING, NOT STACKING. Two bombs on one junction make one bigger hole, not
   two rims fighting over the same metre of ground. A hit inside an existing
   crater's rim WIDENS it (re-cut at the larger radius) instead of adding a
   record — which is also what keeps a strafing run from spending every mask
   slot on one street.

   Flags:
     GROUND_CRATERS      master; false = ordnance scorches and nothing more
     CRATER_MIN_POWER    blast power below which nothing is dug
     CRATER_MAX          how many may exist at once before the oldest retires
   Ratchet: CBZ.craterAudit(), tools/crater-check.mjs.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.GROUND_CRATERS == null) CBZ.CONFIG.GROUND_CRATERS = true;
  if (CBZ.CONFIG.CRATER_MIN_POWER == null) CBZ.CONFIG.CRATER_MIN_POWER = 2.0;
  if (CBZ.CONFIG.CRATER_MAX == null) CBZ.CONFIG.CRATER_MAX = 12;

  const craters = [];
  const stats = { dug: 0, widened: 0, refused: 0, retired: 0, byWhy: {} };

  function on() { return CBZ.CONFIG.GROUND_CRATERS !== false && !!CBZ.groundShaft; }
  function refuse(why) { stats.refused++; stats.byWhy[why] = (stats.byWhy[why] || 0) + 1; return null; }

  /* Power in, radius out. An airstrike is power 3.0 / radius 16 and should leave
     something you can see from the air but still drive around; a bunker buster
     is bigger and says so explicitly. Depth is a fraction of the radius — a
     bomb makes a BOWL, and the shaft primitive's `bowl` flag is that shape. */
  function radiusFor(power, radius) {
    const r = radius != null ? radius * 0.55 : power * 3.2;
    return Math.max(3.0, Math.min(18, r));
  }

  CBZ.groundCrater = function (x, z, o) {
    o = o || {};
    if (!on()) return null;
    const power = o.power != null ? +o.power : 0;
    if (!o.force && !(power >= CBZ.CONFIG.CRATER_MIN_POWER)) return refuse("tooSmall");

    const r = o.r != null ? o.r : radiusFor(power, o.radius);

    // ---- merge into a crater we already made, rather than stacking rims ----
    for (let i = 0; i < craters.length; i++) {
      const c = craters[i];
      if (!c.shaft || c.shaft._closed) continue;
      const d = Math.hypot(x - c.shaft.x, z - c.shaft.z);
      if (d > c.shaft.r + r * 0.6) continue;
      const want = Math.min(18, Math.max(c.shaft.r, d * 0.5 + r));
      if (want > c.shaft.r + 0.75) {
        const keep = { x: c.shaft.x, z: c.shaft.z, gy: c.shaft.gy, seed: c.shaft.seed, surface: c.surface };
        const born = c.shaft.born;
        c.shaft.dispose();
        c.shaft = CBZ.groundShaft(keep.x, keep.z, {
          r: want, gy: keep.gy, seed: keep.seed, surface: keep.surface, bowl: true,
        });
        if (c.shaft) { c.shaft.born = born; c.shaft.crater = true; }
        stats.widened++;
      }
      return c.shaft;
    }

    // ---- a new one, under the shaft's own placement law ----
    if (CBZ.groundShaftCanOpen) {
      const can = CBZ.groundShaftCanOpen(x, z, r);
      if (!can.ok) return refuse(can.why || "law");
    }
    const surface = o.surface || (CBZ.game && CBZ.game.mode === "survival" ? "soil" : "asphalt");
    const shaft = CBZ.groundShaft(x, z, { r: r, surface: surface, bowl: true, depth: o.depth });
    if (!shaft) return refuse("cutFailed");
    shaft.crater = true;
    craters.push({ shaft: shaft, surface: surface, at: CBZ.now || 0 });
    stats.dug++;

    /* PERMANENT, BUT BOUNDED. The hole staying is the point; an unbounded number
       of them is a slow leak of mask slots, draw calls and floor-query work. The
       OLDEST retires — the one furthest from whatever the player is doing now. */
    while (craters.length > CBZ.CONFIG.CRATER_MAX) {
      const old = craters.shift();
      if (old && old.shaft && !old.shaft._closed) { old.shaft.dispose(); stats.retired++; }
    }
    return shaft;
  };

  /* THE PENETRATOR. Ordnance over the bunker threshold that lands on a lid does
     not just dig the surface — it goes THROUGH. The room below and the crater
     above become one column, because a breach is a second carving and spans
     merge. Anything weaker cracks the street and stops, which is the whole point
     of a hardened roof: the bunker buster is the only counter, and it has to
     actually be one. */
  CBZ.craterPenetrate = function (x, z, power, r) {
    if (!CBZ.bunkerUnder || !CBZ.breachBunker) return null;
    const b = CBZ.bunkerUnder(x, z);
    if (!b || b.breached) return null;
    // concrete-equivalent metres the round can defeat, against the lid it meets
    const penCE = power * 2.4;
    if (!(penCE >= (b.lidCE != null ? b.lidCE : 4))) { stats.byWhy.heldByLid = (stats.byWhy.heldByLid || 0) + 1; return null; }
    const R = Math.max(3, r || 5);

    /* THE CRATER MUST STOP HAVING A FLOOR. It was dug as a bowl, and a bowl's
       dish is a solid earth surface — which, over a room, hangs INSIDE the room
       it has just been punched into. So on a successful penetration the crater
       is re-cut as a `through` hole of the same radius: same rim, same torn
       lip, no floor, wall stopping at the roof line. One hole, one radius, and
       the room below is what you see at the bottom of it. */
    for (let i = 0; i < craters.length; i++) {
      const c = craters[i];
      if (!c.shaft || c.shaft._closed) continue;
      if (Math.hypot(x - c.shaft.x, z - c.shaft.z) > c.shaft.r) continue;
      const keep = { x: c.shaft.x, z: c.shaft.z, r: c.shaft.r, gy: c.shaft.gy, seed: c.shaft.seed };
      c.shaft.dispose();
      c.shaft = CBZ.groundShaft(keep.x, keep.z, {
        r: keep.r, depth: Math.max(1.0, keep.gy - b.y1), gy: keep.gy,
        seed: keep.seed, surface: c.surface, through: true,
      });
      if (c.shaft) { c.shaft.crater = true; c.shaft.penetrated = true; }
      break;
    }
    return CBZ.breachBunker(b, x, z, R);
  };

  CBZ.craterAudit = function () {
    let live = 0, widest = 0;
    for (let i = 0; i < craters.length; i++) {
      const c = craters[i];
      if (c.shaft && !c.shaft._closed) { live++; if (c.shaft.r > widest) widest = c.shaft.r; }
    }
    return {
      craters: live, tracked: craters.length, widest: +widest.toFixed(1),
      dug: stats.dug, widened: stats.widened, refused: stats.refused, retired: stats.retired,
      refusedWhy: stats.byWhy, minPower: CBZ.CONFIG.CRATER_MIN_POWER, max: CBZ.CONFIG.CRATER_MAX,
      enabled: on(),
    };
  };
  CBZ.craterClear = function () {
    for (let i = 0; i < craters.length; i++) if (craters[i].shaft && !craters[i].shaft._closed) craters[i].shaft.dispose();
    craters.length = 0;
  };

  /* ---- THE HOOK. Wrap the blast entry points the same way city/buildings.js
     wraps them for structural damage: idempotent, additive, and covering BOTH
     the ground blast and the air blast, because it was the air blast (planes,
     the B-2, airstrikes) that this exists for. ---- */
  function wrap(name) {
    const orig = CBZ[name];
    if (typeof orig !== "function" || orig._craterWrapped) return false;
    const wrapped = function (x, z, opts) {
      const r = orig.apply(this, arguments);
      try {
        const o = opts || {};
        if (!o.noDamage) {
          // an air burst 30 m up does not dig — the ground has to be what was hit
          const gy = CBZ.groundBaseAt ? CBZ.groundBaseAt(x, z) : 0;
          if (o.y == null || o.y <= gy + 6) {
            const dug = CBZ.groundCrater(x, z, { power: o.power, radius: o.radius });
            CBZ.craterPenetrate(x, z, +o.power || 0, dug ? dug.r : null);
          }
        }
      } catch (e) {}
      return r;
    };
    wrapped._craterWrapped = true;
    CBZ[name] = wrapped;
    return true;
  }
  let wrapped = false;
  function install() {
    if (wrapped) return;
    const a = wrap("cityAirstrikeExplosion"), b = wrap("cityExplosion");
    if (a || b) wrapped = true;
  }
  // the blast functions are defined by files that load later, and city/mode.js
  // can re-install them on a reset, so try again on the update bus until it takes
  if (CBZ.onUpdate) CBZ.onUpdate(28.4, function () { if (!wrapped) install(); });
  install();
})();
