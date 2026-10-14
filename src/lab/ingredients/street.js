/* lab ingredient "street": ONE city block, the way the city lays its streets.

   city/streetkit.js CBZ.streetKit.build(ctx) is the one street system in the
   game (city/world.js lays the downtown with it, city/towngen.js every town).
   Here it is handed a 1 x 1 grid: four street centrelines framing one block,
   so the block is a real lot pad inside a real footway (scored concrete,
   granite kerb, 13 cm kerb face, kerb ramps) inside a real carriageway
   (asphalt shader, lane paint, crosswalks at the corners). Nothing is drawn
   here; heightAt/regionAt are the kit's own analytic surface.

   opts: at [x, z]       the lot centre (default 0, 0)
         lot [w, d]      the parcel, metres (default 30 x 30, the downtown lot:
                         config.js CITY.block 34 less the 2 m footway each side)
         road (18)       carriageway width (config.js CITY.road)
         footway (2)     footway depth (the downtown's BLK/2 - lotHalf)
   handle: lot {x0,x1,z0,z1}, walk (the footway's outer edge), road (the
           carriageway's outer edge), heightAt(x,z), regionAt(x,z), kit

   STUB: the lot pad wears a flat concrete material, not city/cityground.js's
   splat (that one is painted from a whole district's lots and doors). */
CBZ.lab.ingredient("street", {
  files: ["src/city/streetkit.js"],
  make: function (W, o) {
    const THREE = window.THREE;
    const C = (CBZ.CITY || {});
    const at = o.at || [0, 0];
    const lot = o.lot || [30, 30];
    const ROAD = +o.road || C.road || 18;
    const FW = o.footway != null ? +o.footway : 2;
    const cx = at[0], cz = at[1];
    const hxL = lot[0] / 2, hzL = lot[1] / 2;
    const sx = hxL + FW + ROAD / 2, sz = hzL + FW + ROAD / 2;
    const root = new THREE.Group();
    root.name = "labStreet";
    W.scene.add(root);
    if (!CBZ.streetKit || !CBZ.streetKit.build) throw new Error("CBZ.streetKit missing (city/streetkit.js not loaded)");
    if (CBZ.streetKit.reset) CBZ.streetKit.reset();
    const kit = CBZ.streetKit.build({
      root: root, name: "lab", surfaceName: "lab-street-surface",
      xLines: [cx - sx, cx + sx], zLines: [cz - sz, cz + sz], ROAD: ROAD,
      laneW: 3.6, lanesPerDir: 2, footway: FW,
      cornerR: 4.8,                     // world.js's fallback when roadrules.js is absent
      apron: 0, sharedMaterial: true, driveways: [],
    });
    const pad = new THREE.MeshLambertMaterial({ color: 0x8a8984 });
    if (kit.lotMesh) kit.lotMesh("lab-lot-ground", [{ bi: 0, bj: 0 }], pad, 1 / 8);
    const h = {
      kit: kit, obj: root, noFrame: true,
      lot: { x0: cx - hxL, x1: cx + hxL, z0: cz - hzL, z1: cz + hzL, w: lot[0], d: lot[1], cx: cx, cz: cz },
      walk: { x0: cx - hxL - FW, x1: cx + hxL + FW, z0: cz - hzL - FW, z1: cz + hzL + FW },
      road: { x0: cx - sx - ROAD / 2, x1: cx + sx + ROAD / 2, z0: cz - sz - ROAD / 2, z1: cz + sz + ROAD / 2 },
      ROAD: ROAD, footway: FW,
      heightAt: function (x, z) { return kit.heightAt(x, z); },
      regionAt: function (x, z) { return kit.regionAt ? kit.regionAt(x, z) : null; },
      state: function () {
        return { lot: [lot[0], lot[1]], road: ROAD, footway: FW, drawCalls: kit.stats ? kit.stats.drawCalls : null,
          yRoad: kit.profile.yRoad, yWalk: kit.profile.yWalk, yLot: kit.profile.yLot };
      },
    };
    return h;
  },
});
