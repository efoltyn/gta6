/* ============================================================
   weapons/optics.js — one real procedural optic factory.

   The sniper's factory scope and every gunsmith attachment use this same
   geometry: a continuous tube, flared objective/ocular bells, actual glass,
   two clamped rings with rail feet, focus ring, elevation/windage turrets and
   a reticle seated behind the rear lens.  Keeping one factory prevents the
   default sniper from wearing a crude fake while bought scopes look different.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  const THREE = window.THREE;
  if (!THREE) return;

  const shared = {};
  function material(name, make) {
    if (!shared[name]) { shared[name] = make(); shared[name]._shared = true; }
    return shared[name];
  }
  const fallbackDark = () => material("optic-dark", () => new THREE.MeshStandardMaterial({ color: 0x11151a, roughness: 0.36, metalness: 0.72 }));
  const fallbackSteel = () => material("optic-steel", () => new THREE.MeshStandardMaterial({ color: 0x4c5661, roughness: 0.3, metalness: 0.84 }));
  function lensMat(hex) {
    const key = "lens-" + (hex >>> 0).toString(16);
    return material(key, () => new THREE.MeshPhysicalMaterial({
      color: hex, emissive: hex, emissiveIntensity: 0.18,
      roughness: 0.04, metalness: 0.08, transparent: true, opacity: 0.72,
      depthWrite: false, side: THREE.DoubleSide,
    }));
  }
  function reticleMat(hex) {
    const key = "reticle-" + (hex >>> 0).toString(16);
    return material(key, () => new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.86, depthWrite: false }));
  }
  function tintHex(v) {
    if (typeof v === "number") return v;
    if (typeof v === "string") { try { return new THREE.Color(v).getHex(); } catch (e) {} }
    return 0x9cdcff;
  }
  function add(g, geo, m, x, y, z, rx, ry, rz) {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x || 0, y || 0, z || 0);
    mesh.rotation.set(rx || 0, ry || 0, rz || 0);
    mesh.castShadow = false;
    g.add(mesh);
    return mesh;
  }
  function boreCylinder(g, r0, r1, len, m, z) {
    // CylinderGeometry's axis is Y; +PI/2 puts it on the gun's local Z bore.
    return add(g, new THREE.CylinderGeometry(r0, r1, len, 16, 1, false), m, 0, 0, z || 0, Math.PI / 2, 0, 0);
  }

  CBZ.createWeaponOptic = function (opts) {
    opts = opts || {};
    const high = opts.highMag !== false;
    const len = opts.length || (high ? 0.46 : 0.22);
    const tubeR = opts.radius || (high ? 0.043 : 0.033);
    const bellR = opts.objectiveRadius || tubeR * (high ? 1.58 : 1.28);
    const ocularR = opts.ocularRadius || tubeR * 1.28;
    const bellLen = Math.min(len * 0.25, high ? 0.115 : 0.065);
    const eyeLen = Math.min(len * 0.19, high ? 0.085 : 0.052);
    const mats = opts.materials || {};
    const dark = mats.dark || fallbackDark();
    const steel = mats.steel || fallbackSteel();
    const tint = tintHex(opts.tint);
    const glass = lensMat(tint);
    const reticle = reticleMat(tint);
    const g = new THREE.Group();
    g.name = opts.name || "weapon-optic";
    g.userData.isWeaponOptic = true;

    // Tube and tapered bells overlap slightly: no floating pieces or seams.
    boreCylinder(g, tubeR, tubeR, len - bellLen * 0.6 - eyeLen * 0.5, dark, 0);
    boreCylinder(g, tubeR * 1.03, bellR, bellLen, dark, -len / 2 + bellLen / 2);
    boreCylinder(g, ocularR, tubeR * 1.03, eyeLen, dark, len / 2 - eyeLen / 2);
    boreCylinder(g, bellR * 1.03, bellR * 1.03, 0.018, steel, -len / 2 + 0.006);
    boreCylinder(g, ocularR * 1.03, ocularR * 1.03, 0.018, steel, len / 2 - 0.006);

    // Focus/zoom knurl rings.
    for (const z of [len * 0.24, len * 0.34]) {
      const ring = add(g, new THREE.TorusGeometry(ocularR * 0.94, 0.006, 6, 18), steel, 0, 0, z);
      ring.rotation.z = 0;
    }

    // Two complete scope rings clamped into rail feet, not floating posts.
    const ringZ = [-len * 0.22, len * 0.20];
    for (const z of ringZ) {
      add(g, new THREE.TorusGeometry(tubeR * 1.12, 0.008, 7, 20), steel, 0, 0, z);
      add(g, new THREE.BoxGeometry(tubeR * 1.72, 0.035, 0.030), steel, 0, -tubeR - 0.010, z);
      add(g, new THREE.BoxGeometry(tubeR * 2.05, 0.025, 0.060), dark, 0, -tubeR - 0.040, z);
    }
    add(g, new THREE.BoxGeometry(tubeR * 2.35, 0.020, len * 0.60), dark, 0, -tubeR - 0.058, 0);

    // Elevation and windage turrets have shafts, caps and a central saddle.
    add(g, new THREE.BoxGeometry(tubeR * 1.65, tubeR * 1.10, 0.060), steel, 0, tubeR * 0.58, -0.015);
    add(g, new THREE.CylinderGeometry(0.019, 0.019, 0.050, 12), steel, 0, tubeR + 0.025, -0.015);
    add(g, new THREE.CylinderGeometry(0.023, 0.023, 0.014, 12), dark, 0, tubeR + 0.055, -0.015);
    add(g, new THREE.CylinderGeometry(0.017, 0.017, 0.050, 12), steel, tubeR + 0.024, 0, -0.015, 0, 0, Math.PI / 2);
    add(g, new THREE.CylinderGeometry(0.021, 0.021, 0.014, 12), dark, tubeR + 0.055, 0, -0.015, 0, 0, Math.PI / 2);

    // Real lens surfaces and a tiny crosshair visible through the ocular glass.
    add(g, new THREE.CircleGeometry(bellR * 0.82, 20), glass, 0, 0, -len / 2 - 0.004, 0, Math.PI, 0);
    add(g, new THREE.CircleGeometry(ocularR * 0.78, 20), glass, 0, 0, len / 2 + 0.004);
    const rz = len / 2 - 0.008;
    add(g, new THREE.BoxGeometry(ocularR * 1.15, 0.0035, 0.002), reticle, 0, 0, rz);
    add(g, new THREE.BoxGeometry(0.0035, ocularR * 1.15, 0.002), reticle, 0, 0, rz);

    g.position.set(opts.x || 0, opts.y || 0, opts.z || 0);
    const s = opts.scale == null ? 1 : opts.scale;
    g.scale.setScalar(s);
    return g;
  };
})();
