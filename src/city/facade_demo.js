/* ============================================================
   city/facade_demo.js — the FACADE KIT's viewing stand.

   Two entry points, both used by tooling only. Neither one runs during
   ordinary play, neither registers anything with the city, and neither is
   reachable without being called by name — so this file cannot move a shop, a
   lot, a collider budget or a math-gate number.

     CBZ.facadeStudio(style, opts)  → an Object3D holding ONE dressed building,
       for tools/studio.mjs's `expr:` hatch and for the before/after preset.
       With ?cfg_FACADE_KIT=0 the identical call returns the bare base
       building, which is exactly the "before" the owner asked to see.

     CBZ.facadeDemoRaise(opts)      → a ROW of every registered facade on flat
       ground in the live world, for walking around inside the game.

   WHY A SEPARATE STAGE. A facade has to be judged as a silhouette from the
   street, at a fixed distance, against a neutral ground — the same building,
   the same camera, the same light, one variable. Photographing ten of them on
   real city lots would vary the lot size, the neighbours, the sun and the
   district palette all at once, and none of the differences you saw would be
   the facade.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  // The STANDARD SUBJECT. One building, used for every style, so the contact
  // sheet compares facades and nothing else. Deliberately an ordinary
  // mid-block office: the exact shell the owner called "already great".
  const SUBJECT = { w: 22, d: 16, storeys: 4, color: 0xb9b3a6, doorSide: 1 };

  CBZ.FACADE_SUBJECT = SUBJECT;

  CBZ.facadeStudio = function (style, opts) {
    opts = opts || {};
    const g = new THREE.Group();
    if (!CBZ.cityMakeBuilding) return g;
    const S = Object.assign({}, SUBJECT, opts.subject || {});
    // Ground: a plain pad so the building is not floating in the void and the
    // podium/steps of a facade have something to meet.
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(S.w + 26, 0.2, S.d + 26),
      new THREE.MeshLambertMaterial({ color: 0x6d6f6a }));
    pad.position.set(0, -0.1, 0);
    pad.receiveShadow = true;
    g.add(pad);

    // Snapshot the world registries: a studio building must not leave
    // colliders, platforms or LOS blockers behind in whatever scene the
    // harness is also running. We restore the lengths afterwards.
    const marks = {};
    for (const k of ["colliders", "platforms", "losBlockers"]) {
      marks[k] = (CBZ[k] && CBZ[k].length) || 0;
    }
    try {
      CBZ.cityMakeBuilding(g, 0, 0, S.w, S.d, S.storeys, S.color, S.doorSide,
        Object.assign({ facade: "office", district: "core" },
          style ? { dress: Object.assign({ style: style }, opts.spec || {}) } : {}));
    } catch (e) {
      if (window.console) console.warn("facadeStudio(" + style + "): " + e.message);
    }
    for (const k of ["colliders", "platforms", "losBlockers"]) {
      if (CBZ[k] && CBZ[k].length > marks[k]) CBZ[k].length = marks[k];
    }
    return g;
  };

  // Every registered style, in registry order, as one labelled row. Used by
  // the in-game walkthrough and by the aerial "all ten" plate.
  CBZ.facadeDemoRaise = function (opts) {
    opts = opts || {};
    const root = opts.root || (CBZ.scene || null);
    if (!root || !CBZ.cityMakeBuilding || !CBZ.facadeList) return [];
    const list = CBZ.facadeList();
    const S = Object.assign({}, SUBJECT, opts.subject || {});
    const pitch = opts.pitch || (S.w + 22);
    const x0 = opts.x != null ? opts.x : 0;
    const z0 = opts.z != null ? opts.z : 0;
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const x = x0 + i * pitch;
      try {
        CBZ.cityMakeBuilding(root, x, z0, S.w, S.d, S.storeys, S.color, S.doorSide,
          { facade: "office", district: "core", dress: { style: list[i].id } });
        out.push({ id: list[i].id, label: list[i].label, x: x, z: z0 });
      } catch (e) { /* one bad facade must not stop the row */ }
    }
    return out;
  };
})();
