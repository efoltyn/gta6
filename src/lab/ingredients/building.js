/* lab ingredient "building": ONE Gang City shell in one facade grammar, sized
   and built exactly the way the city builds a lot.

   The two calls are the city's own:
     CBZ.cityFitShell(cx, cz, lotW, lotD, minSetback, storeys, doorSide, opts)
       sizes the shell for its facade's depth (the 43abc8af fix: a grammar's
       stoop, porch or plaza stands proud of the wall, so the shell stands
       back by that much plus the street door's step)
     CBZ.cityMakeBuilding(root, cx, cz, w, d, storeys, color, doorSide,
       { dress: {style}, reach: setback, district, facade })
       the one mint every shell in Gang City comes from; `reach` is the
       parcel fence (anything past it is cut).
   Nothing here draws a wall.

   opts: street   a "street" handle (its lot is the parcel) or lot {x0,x1,z0,z1}
         style    a facade id (CBZ.facadeList()); unknown = an error naming them
         storeys  default: the grammar's own range (4 when it allows it)
         doorSide 0 -z | 1 +z (default, the "front" camera) | 2 -x | 3 +x
         setback  the street's minimum build line (default 1.5, the downtown's)
         retail   true = a storefront ground storey (the shop program)
         color    the shell's wall colour
   handle: b (the cityMakeBuilding record), fit (cityFitShell's answer),
           measure() the spill numbers (see kits/building.js) */
CBZ.lab.ingredient("building", {
  uses: ["street"],
  // BufferGeometryUtils merges a shell's trim per colour (buildings.js falls
  // back to one mesh per piece without it: same look, ~10x the draws); the
  // facades glob is every registered grammar, so a new style is in on its own
  files: ["src/vendor/BufferGeometryUtils.js", "src/city/facade_openings.js", "src/city/buildings.js", "src/city/facade_kit.js",
    "src/city/facades/*.js"],
  make: function (W, o) {
    const THREE = window.THREE;
    if (!CBZ.cityMakeBuilding) throw new Error("CBZ.cityMakeBuilding missing (city/buildings.js not loaded)");
    const S = o.street || null;
    const lot = S ? S.lot : (o.lot || { x0: -15, x1: 15, z0: -15, z1: 15 });
    const cx = (lot.x0 + lot.x1) / 2, cz = (lot.z0 + lot.z1) / 2;
    const lotW = lot.x1 - lot.x0, lotD = lot.z1 - lot.z0;
    const list = CBZ.facadeList ? CBZ.facadeList().map(function (f) { return f.id; }) : [];
    const style = o.style || null;
    const def = style && CBZ.facadeDef ? CBZ.facadeDef(style) : null;
    if (style && !def) throw new Error("no facade style '" + style + "'; known: " + list.join(", "));
    let storeys = +o.storeys || 0;
    if (!storeys) storeys = def ? Math.max(def.minStoreys || 1, Math.min(def.maxStoreys || 99, 4)) : 4;
    const side = o.doorSide != null ? +o.doorSide : 1;
    const opts = { district: o.district || (o.retail ? "commercial" : "core"), facade: "office" };
    if (o.retail) { opts.retail = true; opts.storefront = true; }
    if (style) opts.dress = { style: style };
    const minSb = o.setback != null ? +o.setback : 1.5;
    // fit:false = the shell sized from the parcel alone and no fence: how every
    // host built before 43abc8af, kept so the spill probe can be shown to bite
    const fit = o.fit !== false && CBZ.cityFitShell ? CBZ.cityFitShell(cx, cz, lotW, lotD, minSb, storeys, side, opts) : { w: lotW - 2 * minSb, d: lotD - 2 * minSb, setback: minSb, need: 0 };
    const reach = Math.min(lotW - fit.w, lotD - fit.d) / 2;
    if (reach > 0.05 && o.fit !== false) opts.reach = reach;
    const root = new THREE.Group();
    root.name = "labBuilding";
    W.scene.add(root);
    const col0 = (CBZ.colliders || []).length, plat0 = (CBZ.platforms || []).length;
    const b = CBZ.cityMakeBuilding(root, cx, cz, fit.w, fit.d, storeys, o.color || 0x8a8f96, side, opts);
    if (CBZ.cityFlushPools) CBZ.cityFlushPools();
    const cols = (CBZ.colliders || []).slice(col0), plats = (CBZ.platforms || []).slice(plat0);
    const h = {
      b: b, fit: fit, root: root, obj: root, style: style, storeys: storeys, side: side, lot: lot,
      colliders: cols, platforms: plats, setback: reach, list: list,
      state: function () {
        return {
          style: b.dressStyle || null, asked: style, storeys: b.storeys, h: Math.round(b.h * 100) / 100,
          shell: [Math.round(fit.w * 100) / 100, Math.round(fit.d * 100) / 100], lot: [lotW, lotD],
          setback: Math.round(reach * 100) / 100, facadeNeeds: Math.round((fit.need || 0) * 100) / 100,
          doorKind: b.doorKind || null, colliders: cols.length, platforms: plats.length,
        };
      },
    };
    return h;
  },
});
