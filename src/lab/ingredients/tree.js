/* lab ingredient "tree": a broadleaf street tree, trunk and crown as two
   meshes standing in the world root — the island's `flammable` tree record
   ({x, z, trunk, foliage, leafHex, barkHex}), which is what wind, fire and
   anything else that bends, snaps or strips a tree works on.

   opts: at [x, z], h (trunk height, default 3.4), crown (radius, default 2.3)
   handle: rec, obj, state() */
CBZ.lab.ingredient("tree", {
  files: [],
  make: function (W, o) {
    const THREE = window.THREE;
    const at = o.at || [0, 0];
    const host = W.root || (W.root = (function () { const g = new THREE.Group(); g.name = "labHost"; W.scene.add(g); return g; })());
    const th = +o.h || 3.4, cr = +o.crown || 2.3;
    const barkHex = 0x5a4130, leafHex = 0x3f6e34;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, th, 7), CBZ.cmat ? CBZ.cmat(barkHex) : new THREE.MeshLambertMaterial({ color: barkHex }));
    trunk.position.set(at[0], th / 2, at[1]);
    trunk.castShadow = true; trunk.name = "trunk";
    const foliage = new THREE.Mesh(new THREE.IcosahedronGeometry(cr, 1), CBZ.cmat ? CBZ.cmat(leafHex) : new THREE.MeshLambertMaterial({ color: leafHex }));
    foliage.position.set(at[0], th + cr * 0.7, at[1]);
    foliage.scale.set(1, 0.85, 1);
    foliage.castShadow = true; foliage.name = "crown";
    host.add(trunk); host.add(foliage);
    const rec = { x: at[0], z: at[1], trunk: trunk, foliage: foliage, leafHex: leafHex, barkHex: barkHex, burning: 0, burnt: false };
    return {
      rec: rec, obj: trunk, noFrame: true,
      state: function () {
        const s = rec._tw;
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(trunk.quaternion).y;
        return { stage: s ? s.stage : 0, leanDeg: Math.round(Math.acos(Math.max(-1, Math.min(1, up))) * 180 / Math.PI), crownOn: foliage.visible && !foliage.userData._twFly };
      },
    };
  },
});
