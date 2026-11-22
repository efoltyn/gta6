(() => {
  const A = CBZ.city.arena, ws = A.worldScale, B = ws.terrainBounds;
  const o = { bounds: B, playable: ws.playableBounds, authored: ws.authoredBounds };
  o.regions = A.regions.map(r => ({ n: r.name, b: r.biome, k: r.kind, cx: r.cx, cz: r.cz, r: r.r, x0: r.minX, x1: r.maxX, z0: r.minZ, z1: r.maxZ }));
  const rd = (r) => ({ x: +r.x.toFixed(1), z: +r.z.toFixed(1), v: !!r.vertical, len: +(+r.len).toFixed(1), w: r.w || r.width || 8 });
  o.roads = A.roads.map(rd);
  o.frontier = (A.frontierRoads || []).map(rd);
  const hw = (CBZ.cityHighways ? CBZ.cityHighways() : []) || [];
  o.hwKeys = hw[0] ? Object.keys(hw[0]) : [];
  o.highways = hw.map(h => { const pts = []; const L = h.length || 0; try { for (let d = 0; d <= L; d += 30) { const q = h.at(d); if (q) pts.push([Math.round(q.x), Math.round(q.z)]); } } catch (e) {} return { n: (h.spec && (h.spec.name || h.spec.id)) || '', w: h.width, L: Math.round(L), pts: pts, fp: h.footprint ? [Math.round(h.footprint.minX), Math.round(h.footprint.minZ), Math.round(h.footprint.maxX), Math.round(h.footprint.maxZ)] : null }; });
  const net = (CBZ.cityHighwayNet ? CBZ.cityHighwayNet() : []) || [];
  o.netKeys = net[0] ? Object.keys(net[0]) : [];
  o.net = net.map(h => { const p = h.pts || h.path || h.points || []; return { n: h.name || h.id, pts: p.filter((_, i) => i % 3 === 0 || i === p.length - 1).map(q => [Math.round(q.x), Math.round(q.z)]) }; });
  o.water = A.waterBodies;
  // terrain: height and water on a grid
  const STEP = 40, nx = Math.ceil((B.maxX - B.minX) / STEP), nz = Math.ceil((B.maxZ - B.minZ) / STEP);
  const H = new Array(nx * nz), W = new Array(nx * nz);
  const sea = CBZ.waterSeaY ? CBZ.waterSeaY() : 0;
  const wat = CBZ.cityWaterAt || CBZ.waterAt || null;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = B.minX + (i + 0.5) * STEP, z = B.minZ + (j + 0.5) * STEP;
    let h = 0; try { h = A.groundHeightAt(x, z); } catch (e) {}
    H[j * nx + i] = Math.round(h * 10) / 10;
    let w = 0; try { w = CBZ.cityWaterAt(x, z) ? 1 : 0; if (w && A.mapTerrain && A.mapTerrain.inlandWaterAt && A.mapTerrain.inlandWaterAt(x, z)) w = 2; } catch (e) {}
    W[j * nx + i] = w;
  }
  o.grid = { step: STEP, nx, nz, H, W, sea, waterFns: Object.keys(CBZ).filter(k => /waterAt|isWater|inWater|seaAt|landAt/i.test(k)).slice(0, 30) };
  // building footprints: tall solid colliders
  const C = CBZ.colliders || [], F = [];
  for (let i = 0; i < C.length; i++) { const c = C[i]; const w = c.maxX - c.minX, d = c.maxZ - c.minZ, h = (c.y1 != null && c.y0 != null) ? c.y1 - c.y0 : 9; if (Math.max(w, d) > 3.5 && h > 2.6 && w < 400 && d < 400) F.push([+c.minX.toFixed(1), +c.minZ.toFixed(1), +c.maxX.toFixed(1), +c.maxZ.toFixed(1), Math.round(h)]); }
  o.nColliders = C.length; o.foot = F;
  o.lots = A.lots.map(l => ({ x: l.cx, z: l.cz, w: l.w, d: l.d, k: l.kind, dist: l.district && l.district.name }));
  return JSON.stringify(o);
})()
