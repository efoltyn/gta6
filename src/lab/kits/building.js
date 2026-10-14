/* lab kit "building": one facade grammar on one real lot, inside a real
   footway and carriageway (city/streetkit.js), sized and built the way the
   city builds it (cityFitShell + cityMakeBuilding).

   lab.html?kit=building&style=queenanne&lot=24x30&storeys=3&door=1&retail=0
     style    a facade id (unknown: the error lists them); none = bare shell
     lot      WxD metres (default 30x30, the downtown parcel)
     storeys  default: 4 inside the grammar's own range
     door     0 -z | 1 +z (default) | 2 -x | 3 +x
     setback  the street's build line (default 1.5)
     retail   1 = a storefront ground storey
     fit      0 = size the shell from the parcel alone, no fence (the pre-43abc8af
              build): the spill probe must then FAIL a deep grammar

   probe(): the numbers a builder asks without looking.
     style worn vs asked, shell vs lot, the setback the shell needed for its
     facade's depth, and THE SPILL (commit 43abc8af, "facades spill onto
     streets"): every drawn vertex, instanced piece and walk platform of the
     building measured against the parcel line, the same test
     tools/facade-reach-check.mjs runs in node. over = how far the worst piece
     stands past the lot line (m), onWalk/onRoad = triangles on the footway /
     in the carriageway. Plus colliders, platforms, meshes, draw calls and
     triangles. ok = built + the asked style worn + nothing past the line. */
CBZ.lab.kit("building", {
  about: "a facade style on a real lot with footway and road; probe measures the spill past the lot line",
  uses: ["street", "building"],
  params: { style: "brick", lot: "30x30" },
  duration: 0.5,
  setup: function (W, P) {
    const m = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(String(P.lot || "30x30"));
    const lot = m ? [+m[1], +m[2]] : [30, 30];
    const street = W.add("street", { name: "street", lot: lot, road: P.road, footway: P.footway });
    W.add("building", {
      name: "building", street: street, style: P.style && P.style !== "none" ? P.style : null,
      storeys: P.storeys, doorSide: P.door != null ? +P.door : 1, setback: P.setback, retail: P.retail === "1", fit: P.fit !== "0",
    });
  },
  // frame the building and its lot, not the whole street ring
  frame: function (W) { return [W.get("building").root]; },
  probe: function (W, P) {
    const THREE = window.THREE;
    const B = W.get("building"), S = W.get("street");
    const lot = B.lot, FW = S.footway;
    const ox = (lot.x0 + lot.x1) / 2, oz = (lot.z0 + lot.z1) / 2, LX = (lot.x1 - lot.x0) / 2, LZ = (lot.z1 - lot.z0) / 2;
    const TOL = 0.02;
    const past = function (x, z) { return Math.max(Math.abs(x - ox) - LX, Math.abs(z - oz) - LZ); };
    let over = 0, overTris = 0, onWalk = 0, onRoad = 0, meshes = 0, draws = 0, tris = 0, worst = null;
    const v = new THREE.Vector3(), m4 = new THREE.Matrix4(), M = new THREE.Matrix4();
    B.root.updateMatrixWorld(true);
    B.root.traverse(function (o) {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
      meshes++;
      const inst = o.isInstancedMesh ? o.count : 1;
      if (o.visible !== false && inst > 0) draws++;
      const P2 = o.geometry.attributes.position.array, I = o.geometry.index ? o.geometry.index.array : null;
      const n = I ? I.length / 3 : P2.length / 9;
      tris += n * inst;
      for (let q = 0; q < inst; q++) {
        if (o.isInstancedMesh) { o.getMatrixAt(q, m4); M.multiplyMatrices(o.matrixWorld, m4); } else M.copy(o.matrixWorld);
        for (let t = 0; t < n; t++) {
          let w = -1e9;
          for (let c = 0; c < 3; c++) {
            const vi = I ? I[t * 3 + c] : t * 3 + c;
            v.set(P2[vi * 3], P2[vi * 3 + 1], P2[vi * 3 + 2]).applyMatrix4(M);
            w = Math.max(w, past(v.x, v.z));
          }
          if (o.isInstancedMesh && w > 40) continue;      // a parked (hidden) instance
          if (w > TOL) {
            overTris++;
            if (w > FW + TOL) onRoad++; else onWalk++;
            if (w > over) { over = w; worst = (o.name || o.geometry.type) + (o.material && o.material.color ? " #" + o.material.color.getHexString() : ""); }
          }
        }
      }
    });
    for (const p of B.platforms) {
      const o2 = Math.max(Math.max(Math.abs(p.minX - ox), Math.abs(p.maxX - ox)) - LX, Math.max(Math.abs(p.minZ - oz), Math.abs(p.maxZ - oz)) - LZ);
      if (o2 > TOL) { overTris += 2; if (o2 > FW + TOL) onRoad += 2; else onWalk += 2; if (o2 > over) { over = o2; worst = "walk platform"; } }
    }
    let colOver = 0;
    for (const c of B.colliders) colOver = Math.max(colOver, past(c.minX, c.minZ), past(c.maxX, c.maxZ));
    const st = B.state();
    const styleOk = !B.style || st.style === B.style;
    const data = Object.assign(st, {
      over: Math.round(over * 100) / 100, overTris: overTris, onWalk: onWalk, onRoad: onRoad, worst: worst,
      colliderOver: Math.round(Math.max(0, colOver) * 100) / 100,
      meshes: meshes, drawCalls: draws, triangles: tris,
      merged: !!(THREE.BufferGeometryUtils && THREE.BufferGeometryUtils.mergeBufferGeometries),
      styles: B.list.length,
    });
    const ok = !!B.b && styleOk && overTris === 0 && colOver <= TOL;
    return {
      ok: ok,
      summary: (B.style || "bare") + (styleOk ? "" : " (wore " + st.style + ")") + " " + st.storeys + "st on " + st.lot.join("x") +
        " lot: shell " + st.shell.join("x") + ", setback " + st.setback + " m (facade needs " + st.facadeNeeds + ")" +
        (overTris ? ", SPILLS " + data.over + " m past the lot line (" + onWalk + " tris on the footway, " + onRoad + " in the road; worst " + worst + ")" : ", nothing past the lot line") +
        "; " + st.colliders + " colliders, " + draws + " draws, " + tris + " tris",
      data: data,
    };
  },
});
