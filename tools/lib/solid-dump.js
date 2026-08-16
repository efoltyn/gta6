/* tools/lib/solid-dump.js — THE IN-PAGE HALF OF THE SOLID CENSUS.

   Evaluated inside the live world by tools/solid-census.mjs. It answers ONE
   question and answers it in numbers: inside this rectangle of the world,
   what is DRAWN as a wall, and what is registered as SOLID?

   Those are two independent ledgers that nothing in this engine cross-checks:

     DRAWN   every triangle in CBZ.scene whose normal is near-horizontal. A
             vertical triangle is a wall face, and its projection onto the
             ground plane is a SEGMENT. That is true of a chain-link panel, a
             jersey barrier, a grandstand flank and a house — the geometry
             does not have to know what it is called.

     SOLID   CBZ.colliders — AABBs, plus the oriented (cx,cz,hw,hd,yaw) form
             CBZ.orientedCollider stamps on anything diagonal.

   Everything downstream (coverage, slack, overlap) is set arithmetic on those
   two, done offline in node. Nothing here renders, samples pixels, or looks.

   Injected globals: __CENSUS_BOX = {x0,z0,x1,z1}, __CENSUS_OPTS = {...}. */
(function () {
  var CBZ = window.CBZ || {};
  var BOX = window.__CENSUS_BOX || { x0: -1e5, z0: -1e5, x1: 1e5, z1: 1e5 };
  var OPT = window.__CENSUS_OPTS || {};
  // |ny| above this stops being a wall. 0.15 is ~8.6 deg off plumb: it keeps
  // chain-link, jersey barrier, building flank and banked-track wall, and it
  // drops the two things that would otherwise flood the census — roofs/ramps
  // (|ny| near 1) and CONE SIDES. A conifer's skirt is a vertical-ISH surface
  // that no sane build gives a collider, and at the loose 0.35 the first run
  // of this tool reported 28 m of "ghost fence" that was a stand of trees.
  var FLAT = OPT.flatCos == null ? 0.15 : OPT.flatCos;
  // WHAT COUNTS AS A BARRIER, low end. 1.0 m: below that you step over it, and
  // the world is full of sub-metre vertical detail — kerbs, trim, seat backs,
  // 3 cm washers on a cylinder — that nobody expects to be solid. At the old
  // 0.45 that detail was 18 km of "ghost barrier" in one sweep and buried
  // every real hole in the report.
  var MINH = OPT.minWallH == null ? 1.0 : OPT.minWallH;
  // …and taller than this stops being architecture. One authored face 30 m
  // high is a cliff face, a backdrop silhouette or a sky shell — the speedway
  // run turned up 111 m runs standing 249 m tall, all of them two-triangle
  // billboards, and they outranked every real fence in the report.
  var MAXH = OPT.maxWallH == null ? 30 : OPT.maxWallH;
  var TRI_CAP = OPT.triCap || 4000000;
  var tall = 0, tallM = 0;

  if (!CBZ.scene) return { error: "no CBZ.scene" };

  // ---------------------------------------------------------------- helpers
  function inBox(x, z) { return x >= BOX.x0 && x <= BOX.x1 && z >= BOX.z0 && z <= BOX.z1; }
  // nearest ancestor carrying a name — the census reports per STRUCTURE, and
  // the only structure label this engine keeps is the group name. When
  // NOTHING in the chain is named, fall back to the scene-root branch it
  // hangs off plus its material: "(unnamed)" alone was the top ghost line on
  // the first speedway run and told nobody anything.
  function ownerName(o) {
    var n = o, hops = 0, last = o;
    while (n && hops < 48) {
      if (n.name) return n.name;
      if (n.parent && n.parent !== CBZ.scene) { last = n; n = n.parent; hops++; }
      else return "(unnamed:" + (n.parent === CBZ.scene ? "root" : "?") + ":" +
        ((o.material && o.material.type) || "?").replace("Mesh", "").replace("Material", "") + ")";
    }
    return "(unnamed)";
  }

  // ------------------------------------------------------- 1. SOLID ledger
  var cols = CBZ.colliders || [];
  var solids = [], solidsSkipped = 0;
  for (var i = 0; i < cols.length; i++) {
    var c = cols[i];
    if (!c || c.minX == null) { solidsSkipped++; continue; }
    if (c.maxX < BOX.x0 || c.minX > BOX.x1 || c.maxZ < BOX.z0 || c.minZ > BOX.z1) continue;
    var rec = { i: i, minX: +c.minX, maxX: +c.maxX, minZ: +c.minZ, maxZ: +c.maxZ };
    if (c.y0 != null) { rec.y0 = +c.y0; rec.y1 = +c.y1; }
    // the oriented body, when there is one. Without it the record IS its AABB.
    if (c.yaw != null) { rec.cx = +c.cx; rec.cz = +c.cz; rec.hw = +c.hw; rec.hd = +c.hd; rec.yaw = +c.yaw; }
    // provenance, when addBox happened to keep the mesh (materials.js does)
    if (c.ref && c.ref.isObject3D) rec.ref = ownerName(c.ref);
    // a piece is a PROP (systems/pieces.js): props legitimately sit inside
    // each other and inside architecture, so the clash test scores them apart.
    if (c.pieceId != null) rec.prop = 1;
    if (c.roadBarrier) rec.roadBarrier = 1;   // a declared road-gap exemption
    if (c._city) rec.city = 1;
    solids.push(rec);
  }

  // ------------------------------------------------------- 2. DRAWN ledger
  // One pass over the scene graph. For each mesh we walk its triangles in
  // world space, keep the vertical ones, and collapse each to the segment it
  // occupies on the ground. Two triangles of one quad collapse to the same
  // segment, so we key-dedupe at 5 cm as we go — that alone halves the wire.
  var segMap = Object.create(null);
  var tris = 0, meshes = 0, capped = false;
  var vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
  var e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nrm = new THREE.Vector3();
  var mtmp = new THREE.Matrix4();

  function emit(owner, ax, ay, az, bx, by, bz, cx3, cy, cz3) {
    // normal
    e1.set(bx - ax, by - ay, bz - az);
    e2.set(cx3 - ax, cy - ay, cz3 - az);
    nrm.crossVectors(e1, e2);
    var L = nrm.length();
    if (L < 1e-9) return;                       // degenerate
    if (Math.abs(nrm.y) / L > FLAT) return;     // floor / roof / ramp: not a wall
    var y0 = Math.min(ay, by, cy), y1 = Math.max(ay, by, cy);
    if (y1 - y0 < MINH) return;                 // a kerb is not a barrier
    if (y1 - y0 > MAXH) {                       // …nor is a cliff or a backdrop
      tall++; tallM += Math.hypot(bx - ax, bz - az); return;
    }
    // project to the ground: pick the longest XZ edge as the line direction,
    // then take the extent of all three verts along it.
    var pxs = [ax, bx, cx3], pzs = [az, bz, cz3];
    var dx = 0, dz = 0, best = -1;
    for (var p = 0; p < 3; p++) {
      var q = (p + 1) % 3;
      var ex = pxs[q] - pxs[p], ez = pzs[q] - pzs[p];
      var d2 = ex * ex + ez * ez;
      if (d2 > best) { best = d2; dx = ex; dz = ez; }
    }
    if (best < 1e-6) return;                    // edge-on sliver, no footprint
    var dl = Math.sqrt(best); dx /= dl; dz /= dl;
    var tmin = Infinity, tmax = -Infinity;
    for (var p2 = 0; p2 < 3; p2++) {
      var t = (pxs[p2] - pxs[0]) * dx + (pzs[p2] - pzs[0]) * dz;
      if (t < tmin) tmin = t; if (t > tmax) tmax = t;
    }
    var sx = pxs[0] + dx * tmin, sz = pzs[0] + dz * tmin;
    var tx = pxs[0] + dx * tmax, tz = pzs[0] + dz * tmax;
    if (!inBox(sx, sz) && !inBox(tx, tz)) return;
    // canonical order so the two triangles of a quad hash together
    if (tx < sx || (tx === sx && tz < sz)) { var q1 = sx; sx = tx; tx = q1; q1 = sz; sz = tz; tz = q1; }
    var k = owner + "|" + (sx * 20 | 0) + "," + (sz * 20 | 0) + "," + (tx * 20 | 0) + "," + (tz * 20 | 0) +
            "," + (y0 * 10 | 0) + "," + (y1 * 10 | 0);
    if (segMap[k]) return;
    // GROUND AT THE MIDPOINT, so the report can tell a fence you walk through
    // from a fascia panel eight metres up that nobody can reach. Without it
    // every un-collided soffit and sign face ranks alongside a real hole.
    var gy = 0;
    if (CBZ.groundAt) { try { gy = CBZ.groundAt((sx + tx) / 2, (sz + tz) / 2) || 0; } catch (e) { gy = 0; } }
    segMap[k] = [owner, +sx.toFixed(3), +sz.toFixed(3), +tx.toFixed(3), +tz.toFixed(3),
                 +y0.toFixed(2), +y1.toFixed(2), +gy.toFixed(2)];
  }

  function walkGeometry(geo, mat4, owner) {
    var pos = geo.attributes && geo.attributes.position;
    if (!pos) return;
    var idx = geo.index;
    var n = idx ? idx.count : pos.count;
    for (var t = 0; t + 2 < n; t += 3) {
      if (tris++ > TRI_CAP) { capped = true; return; }
      var i0 = idx ? idx.getX(t) : t, i1 = idx ? idx.getX(t + 1) : t + 1, i2 = idx ? idx.getX(t + 2) : t + 2;
      vA.fromBufferAttribute(pos, i0).applyMatrix4(mat4);
      vB.fromBufferAttribute(pos, i1).applyMatrix4(mat4);
      vC.fromBufferAttribute(pos, i2).applyMatrix4(mat4);
      emit(owner, vA.x, vA.y, vA.z, vB.x, vB.y, vB.z, vC.x, vC.y, vC.z);
    }
  }

  CBZ.scene.updateMatrixWorld(true);
  var stack = [CBZ.scene];
  while (stack.length) {
    var o = stack.pop();
    if (!o) continue;
    if (o.visible === false) continue;
    for (var ci = 0; ci < o.children.length; ci++) stack.push(o.children[ci]);
    if (!o.isMesh || !o.geometry) continue;
    var g = o.geometry;
    // cheap reject on the world-space bounding sphere before touching indices
    if (!g.boundingSphere) { try { g.computeBoundingSphere(); } catch (e) { continue; } }
    var bs = g.boundingSphere;
    if (!bs) continue;
    var owner = ownerName(o);
    if (o.isInstancedMesh) {
      var cnt = o.count;
      for (var k2 = 0; k2 < cnt; k2++) {
        o.getMatrixAt(k2, mtmp);
        mtmp.premultiply(o.matrixWorld);
        // sphere test in world space for this instance
        var cc = bs.center.clone().applyMatrix4(mtmp);
        var sc = Math.max(
          Math.hypot(mtmp.elements[0], mtmp.elements[1], mtmp.elements[2]),
          Math.hypot(mtmp.elements[4], mtmp.elements[5], mtmp.elements[6]),
          Math.hypot(mtmp.elements[8], mtmp.elements[9], mtmp.elements[10]));
        var r = bs.radius * sc;
        if (cc.x + r < BOX.x0 || cc.x - r > BOX.x1 || cc.z + r < BOX.z0 || cc.z - r > BOX.z1) continue;
        walkGeometry(g, mtmp, owner);
        if (capped) break;
      }
      meshes++;
    } else {
      var c2 = bs.center.clone().applyMatrix4(o.matrixWorld);
      var el = o.matrixWorld.elements;
      var s2 = Math.max(
        Math.hypot(el[0], el[1], el[2]), Math.hypot(el[4], el[5], el[6]), Math.hypot(el[8], el[9], el[10]));
      var r2 = bs.radius * s2;
      if (c2.x + r2 < BOX.x0 || c2.x - r2 > BOX.x1 || c2.z + r2 < BOX.z0 || c2.z - r2 > BOX.z1) continue;
      walkGeometry(g, o.matrixWorld, owner);
      meshes++;
    }
    if (capped) break;
  }

  var walls = [];
  for (var kk in segMap) walls.push(segMap[kk]);

  // ------------------------------------------------------------- 3. ROADS
  // A carriageway is where movement is SUPPOSED to happen, so a solid sitting
  // in one is the loudest bug this census can report.
  var roads = [];
  // NOT CBZ.city — that is the mode object. The built city rect is
  // CBZ.city.arena, and city.roads is the ledger every road builder in the
  // game pushes to (city/roadrules.js is built on the same list).
  var arena = (CBZ.city && CBZ.city.arena) || null;
  var rl = (arena && arena.roads) || (CBZ.city && CBZ.city.roads) || [];
  for (var ri = 0; ri < rl.length; ri++) {
    var R = rl[ri];
    if (!R) continue;
    var hw = (R.w || 8) / 2, hl = (R.len || 0) / 2;
    var rminX = R.vertical ? R.x - hw : R.x - hl;
    var rmaxX = R.vertical ? R.x + hw : R.x + hl;
    var rminZ = R.vertical ? R.z - hl : R.z - hw;
    var rmaxZ = R.vertical ? R.z + hl : R.z + hw;
    if (rmaxX < BOX.x0 || rminX > BOX.x1 || rmaxZ < BOX.z0 || rminZ > BOX.z1) continue;
    roads.push({ minX: rminX, maxX: rmaxX, minZ: rminZ, maxZ: rmaxZ,
                 w: R.w || 8, district: R.district || "", venueSite: R.venueSite || "" });
  }

  return {
    box: BOX,
    stats: { meshes: meshes, tris: tris, capped: capped, colliders: cols.length,
             solidsInBox: solids.length, wallSegs: walls.length, roadsInBox: roads.length,
             solidsSkipped: solidsSkipped, tallFaces: tall, tallM: +tallM.toFixed(0),
             maxWallH: MAXH, minWallH: MINH, flatCos: FLAT },
    solids: solids,
    walls: walls,       // [owner, x0,z0, x1,z1, y0,y1]
    roads: roads,
  };
})()
