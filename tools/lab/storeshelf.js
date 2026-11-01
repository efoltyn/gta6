/* tools/lab/storeshelf.js — stand ONE shop floor up on the lab turntable.

   Loaded by the `asset` kit as a file= entry beside city/economy.js,
   city/itemicons.js, city/itemassets.js and city/storegoods.js:

     node tools/lab/run.mjs --kit asset \
       --params 'file=src/city/economy.js,src/city/itemicons.js,src/city/itemassets.js,src/city/storegoods.js,tools/lab/storeshelf.js&expr=__storeShelf("gas")' \
       --frames 0 --cam 'at:-3,1.6,3:-5,1,6' --out /home/claude/shots/stores/gas

   It builds a bare 16 x 20 m shell (floor, three walls, a counter block)
   around the origin, mounts it through CBZ.storeGoodsMount exactly as an
   island shop does, and builds the plan at once (no player, no tick). */
(function () {
  "use strict";
  window.__storeShelf = function (kind, opts) {
    opts = opts || {};
    const THREE = window.THREE, CBZ = window.CBZ;
    const W = opts.w || 16, D = opts.d || 20;
    const grp = new THREE.Group();
    const wallM = new THREE.MeshLambertMaterial({ color: 0xd8d4cc });
    const floorM = new THREE.MeshLambertMaterial({ color: 0x9a978f });
    const fl = new THREE.Mesh(new THREE.BoxGeometry(W, 0.2, D), floorM); fl.position.y = 0.1; grp.add(fl);
    const wall = function (w, d, x, z) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, 3.4, d), wallM); m.position.set(x, 1.9, z); grp.add(m); };
    wall(0.4, D, -W / 2 + 0.2, 0); wall(0.4, D, W / 2 - 0.2, 0); wall(W, 0.4, 0, D / 2 - 0.2);
    // the counter (building-local: door at -z, so the till is toward +z)
    const K = { x: 2.6, z: 4.2, w: 3.2, d: 0.8 };
    const ct = new THREE.Mesh(new THREE.BoxGeometry(K.w, 1.0, K.d), new THREE.MeshLambertMaterial({ color: 0x5a4636 }));
    ct.position.set(K.x, 0.7, K.z); grp.add(ct);
    CBZ.scene.add(grp);
    grp.updateMatrixWorld(true);
    const lot = {
      kind: kind, cx: 0, cz: 0,
      building: {
        shop: { kind: kind }, localDoor: { nx: 0, nz: 1 }, w: W, d: D, wt: 0.4, floorTops: [0.2],
        group: grp, clearFloorPoint: function () { return true; }, counterLocal: K, planHints: opts.hints || {},
      },
    };
    const m = CBZ.storeGoodsMount ? CBZ.storeGoodsMount(lot) : null;
    if (m && CBZ.storeGoodsBuildNow) CBZ.storeGoodsBuildNow(m.plan);
    window.__storeShelfPlan = m && m.plan;
    return function () { return [grp]; };
  };
})();
