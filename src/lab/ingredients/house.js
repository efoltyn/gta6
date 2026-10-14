/* lab ingredient "house": a one-storey wood-frame home built from its REAL
   PARTS, the way a house actually comes apart in wind: a concrete slab, four
   separate wall panels (with their windows and a door), two roof planes on a
   gable, the two gable ends, a brick chimney. Every part is its own mesh in
   one group, so anything that damages a house (systems/tornado.js reads the
   parts off the geometry; it is NOT handed a parts list) can lift the roof,
   fell a wall, or sweep the slab clean.

   The record is the island building record's shape (world/disaster_arena.js
   `fragile`): {group, x, z, ox, oz, w, d, h, storeys, gy, colliders,
   platforms, fallen, color}, and its four walls are real colliders on
   CBZ.colliders.

   opts: at [x, z]   the plan centre (default 0, 0)
         w, d        plan size, m (default 8 x 10; the ridge runs along x)
         yaw         0 | 90 (deg) — 90 turns the plan (w <-> d)
         wall, roof  colours (default white siding, dark asphalt shingle)
   handle: rec (the building record), obj, state() */
CBZ.lab.ingredient("house", {
  files: [],
  make: function (W, o) {
    const THREE = window.THREE;
    const at = o.at || [0, 0];
    const turn = (+o.yaw || 0) === 90;
    const w = turn ? (+o.d || 10) : (+o.w || 8), d = turn ? (+o.w || 8) : (+o.d || 10);
    const host = W.root || (W.root = (function () { const g = new THREE.Group(); g.name = "labHost"; W.scene.add(g); return g; })());
    const mats = W._houseMats || (W._houseMats = {});
    const M = function (hex) {
      if (!mats[hex]) mats[hex] = CBZ.cmat ? CBZ.cmat(hex) : new THREE.MeshLambertMaterial({ color: hex });
      return mats[hex];
    };
    const wallHex = o.wall != null ? +o.wall : 0xd9d4c7, roofHex = o.roof != null ? +o.roof : 0x3c3a3a;
    const g = new THREE.Group();
    g.name = "labHouse:" + o.name;
    g.position.set(at[0], 0, at[1]);
    host.add(g);
    const box = function (sx, sy, sz, x, y, z, hex, name) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), M(hex));
      m.position.set(x, y, z); m.name = name; m.castShadow = true; m.receiveShadow = true;
      g.add(m); return m;
    };
    const SLAB = 0.25, WH = 2.9, TH = 0.18;
    box(w + 0.6, SLAB, d + 0.6, 0, SLAB / 2, 0, 0x9c9a94, "slab");
    // the four walls: the long ones run along x
    const yW = SLAB + WH / 2;
    const longX = w >= d;
    const L = longX ? w : d, S = longX ? d : w;
    const walls = [];
    if (longX) {
      walls.push(box(w, WH, TH, 0, yW, -d / 2 + TH / 2, wallHex, "wall-front"));
      walls.push(box(w, WH, TH, 0, yW, d / 2 - TH / 2, wallHex, "wall-back"));
      walls.push(box(TH, WH, d - 2 * TH, -w / 2 + TH / 2, yW, 0, wallHex, "wall-west"));
      walls.push(box(TH, WH, d - 2 * TH, w / 2 - TH / 2, yW, 0, wallHex, "wall-east"));
    } else {
      walls.push(box(TH, WH, d, -w / 2 + TH / 2, yW, 0, wallHex, "wall-west"));
      walls.push(box(TH, WH, d, w / 2 - TH / 2, yW, 0, wallHex, "wall-east"));
      walls.push(box(w - 2 * TH, WH, TH, 0, yW, -d / 2 + TH / 2, wallHex, "wall-front"));
      walls.push(box(w - 2 * TH, WH, TH, 0, yW, d / 2 - TH / 2, wallHex, "wall-back"));
    }
    // windows and the door, proud of the front and back walls
    const glass = 0x2b3640, trim = 0x6b4a32;
    for (const sgn of [-1, 1]) for (let i = -1; i <= 1; i += 2) {
      if (longX) box(1.2, 1.1, 0.06, i * L * 0.25, SLAB + 1.6, sgn * (d / 2 + 0.02), glass, "window");
      else box(0.06, 1.1, 1.2, sgn * (w / 2 + 0.02), SLAB + 1.6, i * L * 0.25, glass, "window");
    }
    if (longX) box(1.0, 2.1, 0.06, 0, SLAB + 1.05, -d / 2 - 0.02, trim, "door");
    else box(0.06, 2.1, 1.0, -w / 2 - 0.02, SLAB + 1.05, 0, trim, "door");
    // the gable roof: two planes on a ridge along the long axis, 30 degrees
    const top = SLAB + WH;
    const half = S / 2 + 0.4, rise = Math.tan(Math.PI / 6) * (S / 2);
    const slope = Math.hypot(half, rise + 0.2);
    const pitch = Math.atan2(rise, S / 2);
    for (const sgn of [-1, 1]) {
      const m = new THREE.Mesh(longX ? new THREE.BoxGeometry(L + 0.6, 0.16, slope) : new THREE.BoxGeometry(slope, 0.16, L + 0.6), M(roofHex));
      if (longX) { m.position.set(0, top + rise / 2, sgn * (S / 4 + 0.05)); m.rotation.x = sgn * pitch; }
      else { m.position.set(sgn * (S / 4 + 0.05), top + rise / 2, 0); m.rotation.z = -sgn * pitch; }
      m.name = "roof-plane"; m.castShadow = true; m.receiveShadow = true;
      g.add(m);
    }
    // the gable ends: wall-coloured triangles closing the roof
    const tri = new THREE.Shape();
    tri.moveTo(-S / 2, 0); tri.lineTo(S / 2, 0); tri.lineTo(0, rise); tri.lineTo(-S / 2, 0);
    for (const sgn of [-1, 1]) {
      const ge = new THREE.ExtrudeGeometry(tri, { depth: TH, bevelEnabled: false });
      const m = new THREE.Mesh(ge, M(wallHex));
      if (longX) { m.rotation.y = Math.PI / 2; m.position.set(sgn * (L / 2) - (sgn > 0 ? TH : 0), top, 0); }
      else { m.position.set(0, top, sgn * (L / 2) - (sgn > 0 ? TH : 0)); }
      m.name = "gable"; m.castShadow = true;
      g.add(m);
    }
    // the chimney: brick, from inside the house up through the roof
    box(0.7, 3.6, 0.7, longX ? L * 0.28 : 0, SLAB + WH - 0.9 + 1.8, longX ? 0 : L * 0.28, 0x7a3b2c, "chimney");
    g.updateMatrixWorld(true);
    // the walls are solid
    const cols = [];
    const _b = new THREE.Box3();
    for (const m of walls) {
      _b.setFromObject(m);
      const c = { minX: _b.min.x, maxX: _b.max.x, minZ: _b.min.z, maxZ: _b.max.z, ref: m };
      if (CBZ.colliders) CBZ.colliders.push(c);
      cols.push(c);
    }
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    const rec = { group: g, x: at[0], z: at[1], ox: at[0], oz: at[1], w: w, d: d, h: WH, storeys: 1, gy: SLAB,
      colliders: cols, platforms: [], fallen: false, color: wallHex, lab: o.name };
    return {
      rec: rec, obj: g,
      state: function () {
        const st = rec._tw;
        let roofLeft = 0, wallsUp = 0;
        g.traverse(function (m) { if (m.isMesh && m.parent === g) { if (m.name === "roof-plane") roofLeft++; if (/^wall-/.test(m.name)) wallsUp++; } });
        return { at: at, dod: st ? st.dod : 0, peakGust: st ? Math.round(st.peak) : 0, roofPlanesLeft: roofLeft, wallsStanding: wallsUp,
          swept: !!rec._twSwept, fallen: !!rec.fallen };
      },
    };
  },
});
