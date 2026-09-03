/* ============================================================
   city/headlights.js — THE PLAYER'S CAR CARRIES A REAL LIGHT.

   Every car in the fleet has headlights that are emissive bars: they glow,
   they light nothing. That was invisible while the night was a blue day
   (core/lights.js NIGHT_TRUE_DARK explains that night); once the sky stops
   lighting the ground after astronomical dusk, a road with no lamp is black
   and a car with no light is a car you cannot drive. Real life answers this
   with headlights, so this does too — ONE SpotLight, parented to whichever
   car the player is actually driving, aimed down its nose, gain tied to how
   dark the sky is (off in daylight, up through civil dusk, full at night).

   One light, not one per car: core/lightpin.js budgets spot lights (default
   8) and every distinct count recompiles every lit program, so the fleet's
   traffic keeps its emissive bars and only the car whose road you are
   looking down gets the beam. The light rides the car's group, so the
   vehicle code that moves the car moves the light; nothing here reads a
   heading. Flag CITY_HEADLIGHTS (?cfg_CITY_HEADLIGHTS=0 → no light exists).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || typeof CBZ.onAlways !== "function" || !window.THREE) return;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.CITY_HEADLIGHTS == null) CFG.CITY_HEADLIGHTS = true;

  let spot = null, target = null, attached = null;
  function ensure() {
    if (spot) return;
    // warm-white, 60 m throw, a 32° half-angle with a soft edge: a low beam.
    spot = new THREE.SpotLight(0xfff1d6, 0, 60, 0.56, 0.5, 1.0);
    spot.castShadow = false;
    target = new THREE.Object3D();
    spot.target = target;
  }
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  // the car's nose, in its own frame: the front axle's wheels are tagged by
  // the rig (userData.playerWheel), so the lamp sits just ahead of the
  // frontmost one. 2 m if a model carries no tagged wheels.
  function noseZ(car) {
    let z = -Infinity;
    car.group.traverse(function (o) {
      if (o && o.userData && o.userData.playerWheel && o.parent === car.group) z = Math.max(z, o.position.z);
    });
    return Number.isFinite(z) ? z + 0.7 : 2.0;
  }

  function attach(car) {
    if (attached === car) return;
    if (attached && attached.group) { attached.group.remove(spot); attached.group.remove(target); }
    attached = car;
    if (!car) return;
    ensure();
    const nz = noseZ(car);
    spot.position.set(0, 0.78, nz);
    target.position.set(0, -0.6, nz + 34);   // dips onto the road ~30 m out
    car.group.add(spot);
    car.group.add(target);
  }

  CBZ.onAlways(8.2, function () {
    const g = CBZ.game, P = CBZ.player;
    const car = CFG.CITY_HEADLIGHTS !== false && g && g.mode === "city" && P && P.driving &&
      P._vehicle && P._vehicle.group ? P._vehicle : null;
    attach(car);
    if (!attached) return;
    // the same "how bright is the sky" the fixture rigs use: full day → 0,
    // civil dusk → rising, astronomical night → 1
    const day = CBZ.dayness == null ? 1 : CBZ.dayness;
    const dusk = CBZ.duskness || 0;
    const dark = clamp01(1 - (day * 2.2 + dusk * 0.25));
    spot.intensity = dark * 3.2;
    spot.visible = dark > 0.02;
  });

  CBZ.cityHeadlights = function () {
    return { attached: !!attached, intensity: spot ? spot.intensity : 0, visible: !!(spot && spot.visible) };
  };
})();
