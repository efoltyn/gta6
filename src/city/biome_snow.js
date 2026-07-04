/* ============================================================
   city/biome_snow.js — THE SNOWY MOUNTAIN RANGE biome.

   An archipelago landmass module (see worldmap.js CONTRACT). Builds a
   flat snowy VALLEY/PLATEAU (ground stays y=0, the world contract) ringed
   by a dramatic backdrop of TALL snow-capped PEAKS (cones with snow caps)
   that you walk AROUND — each peak base gets a collider so the range reads
   as a solid massif and the playable area is the valley between them. A
   frozen LAKE (icy plane), instanced snowy PINES, rocky outcrops and
   snowdrifts fill it; the WHY-justified landmarks are a cozy enterable SKI
   LODGE (fireplace), a moving CHAIRLIFT up a slope, a slalom SKI RUN, a
   mountain cabin and a frozen-over outpost. A winding causeway connects the
   south edge down toward the speedway island.

   DRAW-CALL DISCIPLINE: pines / rocks / drifts / lift-chairs / guardrail
   posts are InstancedMesh (one draw call each); peaks share one material;
   snowfall is a single THREE.Points cloud that is only VISIBLE while the
   player stands in this biome (CBZ.cityBiomeAt === 'snow'), so it costs
   nothing elsewhere. Everything is deterministic from a local seeded rng.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !THREE) return;

  // ---- footprint (per spec): rect center (350,-1450), half (420,330) ------
  const CX = 350, CZ = -1450, HX = 420, HZ = 330;
  const MINX = CX - HX, MAXX = CX + HX;     // -70 .. 770
  const MINZ = CZ - HZ, MAXZ = CZ + HZ;     // -1780 .. -1120

  // local seeded rng — never touch Math.random (determinism contract)
  function mulberry(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // shared palette — snow, ice, rock, pine, lodge timber
  const COL = {
    snow: 0xeef3f8, snowShade: 0xdde6ef, ice: 0xbfd9e6, iceDeep: 0x9cc2d6,
    rock: 0x6d7480, rockDark: 0x565c66, pine: 0x2f5d44, pineDk: 0x244a36,
    trunk: 0x5a4632, timber: 0x7a5638, timberDk: 0x5e4129, roofSnow: 0xe7eef5,
    steel: 0x8a8f97, cable: 0x3a3d42, chair: 0xc23a3a, ember: 0xff7a2a, flag: 0xd23b3b,
  };

  // ============================================================
  CBZ.addLandmass(function (city) {
    const root = city.root;
    if (!root) return;
    const mat = CBZ.mat, cmat = CBZ.cmat || CBZ.mat;
    const rng = mulberry((CBZ.WORLD_SEED != null ? CBZ.WORLD_SEED : 0x53170) ^ ((CX * 73856093) ^ (CZ * 19349663)));

    // shared materials (one instance each — draw-call friendly)
    const mSnow = cmat(COL.snow), mSnowShade = cmat(COL.snowShade);
    const mRock = cmat(COL.rock), mPine = cmat(COL.pine), mPineDk = cmat(COL.pineDk);
    const mTrunk = cmat(COL.trunk), mSteel = cmat(COL.steel);
    const mTimber = cmat(COL.timber), mTimberDk = cmat(COL.timberDk);

    function pushCol(minX, maxX, minZ, maxZ, y0, y1, ref) {
      const c = { minX, maxX, minZ, maxZ, ref: ref || null };
      if (y0 != null) c.y0 = y0;
      if (y1 != null) c.y1 = y1;
      CBZ.colliders.push(c);
      return c;
    }
    function box(x, y, z, w, h, d, m, solid) {
      const me = new THREE.Mesh(CBZ.boxGeom ? CBZ.boxGeom(w, h, d) : new THREE.BoxGeometry(w, h, d), m);
      me.position.set(x, y, z);
      me.castShadow = true; me.receiveShadow = true;
      root.add(me);
      if (solid) pushCol(x - w / 2, x + w / 2, z - d / 2, z + d / 2, y - h / 2, y + h / 2, me);
      return me;
    }
    function tag(group, text, y) {
      if (!CBZ.makeLabelSprite) return;
      const s = CBZ.makeLabelSprite(text);
      if (!s) return;
      s.position.set(0, y, 0); s.scale.set(7, 1.68, 1);
      group.add(s);
    }

    // ---- PINECREST resort town (T8) ---------------------------------------
    // A real alpine RESORT VILLAGE grown from the reusable generator using the
    // snow-tied recipe (citytemplates.js: lodge/outfitter/clinic/gear-pawn/spa).
    // Placed on FLAT base ground SE of the existing lodge + ski run (the snow
    // valley is dead-flat per terrain.js, so it sits level), clear of the lodge,
    // ski run, lake, cabin, outpost + lift. The pine/rock scatter SKIPS this rect
    // via inTown so trees don't grow in the village — gated on HAS_TOWN so the
    // biome is byte-identical if towngen is absent (zero regression).
    const HAS_TOWN = typeof CBZ.buildTown === "function" && !!(CBZ.CITY_TEMPLATES && CBZ.CITY_TEMPLATES.pinecrest);
    const TOWN_CX = 640, TOWN_CZ = -1230, TOWN_HX = 110, TOWN_HZ = 80;
    const TOWN = { minX: TOWN_CX - TOWN_HX, maxX: TOWN_CX + TOWN_HX, minZ: TOWN_CZ - TOWN_HZ, maxZ: TOWN_CZ + TOWN_HZ };
    function inTown(x, z) {
      return HAS_TOWN && x > TOWN.minX - 8 && x < TOWN.maxX + 8 && z > TOWN.minZ - 8 && z < TOWN.maxZ + 8;
    }

    // ---- snowy GROUND plane (flat valley, y just above 0) ----------------
    (function ground() {
      const g = new THREE.Mesh(new THREE.PlaneGeometry(HX * 2 + 40, HZ * 2 + 40),
        new THREE.MeshLambertMaterial({ color: COL.snow }));
      g.rotation.x = -Math.PI / 2;
      g.position.set(CX, 0.02, CZ);
      g.receiveShadow = true;
      root.add(g);
      // a faint shaded apron so the white plateau isn't a single flat slab
      const apron = new THREE.Mesh(new THREE.PlaneGeometry(HX * 2 + 220, HZ * 2 + 220),
        new THREE.MeshLambertMaterial({ color: COL.snowShade }));
      apron.rotation.x = -Math.PI / 2;
      apron.position.set(CX, -0.01, CZ);
      apron.receiveShadow = true;
      root.add(apron);
    })();

    // ---- THE RANGE: tall snow-capped PEAKS ringing the valley edges ------
    // Each peak = a rock cone + a snow-cap cone on top; base gets a collider
    // square so the player walks AROUND them. They sit on the rim, leaving a
    // traversable valley/plateau in the middle.
    (function peaks() {
      // ----------------------------------------------------------------
      //  REAL low-poly snow-mountain RANGE (replaces the flat cones).
      //  Each ridge = a displaced grid strip (cols along the ridge x rows
      //  deep) emitted as NON-INDEXED triangles so flat-shaded facets read
      //  crisp. Heights come from a seeded RIDGED-fbm noise → connected
      //  craggy ridgelines. Per-vertex COLOR by altitude+slope: rock base,
      //  ragged snowline, dark cliff faces, lit/shaded snow facets. A
      //  valleyGuard term forces the valley-facing edge to y=0 so the flat
      //  walkable floor is never lifted. All ridges merge to 2 meshes.
      // ----------------------------------------------------------------
      const BGU = THREE.BufferGeometryUtils;

      // -- seeded value-noise (hash + smoothstep-lerp), 2-D -------------
      function hash2(ix, iz) {
        let h = (ix * 374761393 + iz * 668265263) | 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        h = (h ^ (h >>> 16)) >>> 0;
        return h / 4294967296;                 // 0..1
      }
      function smooth(t) { return t * t * (3 - 2 * t); }
      function vnoise(x, z) {
        const ix = Math.floor(x), iz = Math.floor(z);
        const fx = x - ix, fz = z - iz;
        const a = hash2(ix, iz), b = hash2(ix + 1, iz);
        const c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
        const ux = smooth(fx), uz = smooth(fz);
        return (a * (1 - ux) + b * ux) * (1 - uz) + (c * (1 - ux) + d * ux) * uz;
      }
      // -- RIDGED fbm: sharp connected ridgelines (5 octaves) ----------
      function ridged(x, z) {
        let sum = 0, freq = 1, amp = 0.5, prev = 1;
        for (let o = 0; o < 5; o++) {
          let n = vnoise(x * freq, z * freq);
          n = 1 - Math.abs(2 * n - 1);         // ridge fold
          n = n * n;                            // sharpen
          sum += n * amp * prev;                // weight by previous octave
          prev = n;
          freq *= 2;                            // lacunarity
          amp *= 0.5;                           // gain
        }
        return sum;                             // ~0..1-ish
      }

      // -- altitude+slope vertex color -> rock / ragged snow / cliff ---
      const cRock = new THREE.Color(COL.rock);
      const cRockDk = new THREE.Color(COL.rockDark);
      const cSnow = new THREE.Color(COL.snow);
      const cSnowSh = new THREE.Color(COL.snowShade);
      const _cu = new THREE.Color();
      function shadeVert(y, peakH, upDot, snowWobble, out) {
        // ragged snowline ~42% of peak height, wobbled by low-freq noise
        const snowline = peakH * (0.42 + (snowWobble - 0.5) * 0.26);
        const above = y > snowline;
        const steep = upDot < 0.52;            // cliff: snow slides off
        if (!above || steep) {
          // rock: darker low + on steep faces
          const dk = steep ? 0.7 : (1 - Math.min(1, y / Math.max(1, snowline))) * 0.5;
          out.copy(cRock).lerp(cRockDk, dk);
        } else {
          // snow: lit (sun-facing / flat-ish facets) vs shaded
          const lit = Math.min(1, Math.max(0, (upDot - 0.55) / 0.45));
          out.copy(cSnowSh).lerp(cSnow, lit);
        }
        return out;
      }

      // -- build ONE ridge strip as non-indexed displaced grid ---------
      // p0->p1 = ridge spine on the valley rim; depthDir = unit vector
      // pointing AWAY from the valley (the range body extends that way).
      // Returns { geo, spine:[{x,z,h}] } (spine sampled for colliders).
      function buildRidge(p0, p1, depthDir, cfg) {
        const cols = cfg.cols, rows = cfg.rows;
        const peakAmp = cfg.peakAmp, depthLen = cfg.depthLen;
        const seedOff = cfg.seedOff, noiseScale = cfg.noiseScale;
        const dx = p1.x - p0.x, dz = p1.z - p0.z;
        // grid of world positions + crest heights
        const gx = [], gz = [], gy = [];
        const spine = [];
        for (let r = 0; r <= rows; r++) {
          const dv = r / rows;                       // 0 at valley edge .. 1 deep
          gx[r] = []; gz[r] = []; gy[r] = [];
          for (let c = 0; c <= cols; c++) {
            const t = c / cols;
            const bx = p0.x + dx * t + depthDir.x * (dv * depthLen);
            const bz = p0.z + dz * t + depthDir.z * (dv * depthLen);
            // noise sample coords (offset per ridge so none are identical)
            const nx = (bx + seedOff) * noiseScale;
            const nz = (bz - seedOff) * noiseScale;
            let h = ridged(nx, nz) * peakAmp;
            // low-freq envelope along the ridge: tall peaks + saddles
            const env = 0.45 + 0.55 * vnoise(t * 3.3 + seedOff * 0.01, seedOff * 0.02);
            h *= env;
            // depth TENT: crest near mid-depth, falls off front & back
            const tent = Math.sin(Math.min(1, dv * 1.15) * Math.PI);
            h *= 0.25 + 0.75 * tent;
            // valleyGuard: force y->0 at the valley-facing edge (flat floor)
            const guard = Math.min(1, dv / 0.28);      // 0 at edge, 1 by row ~28%
            h *= guard * guard;
            gx[r][c] = bx; gz[r][c] = bz; gy[r][c] = h;
          }
        }
        // record spine (crest) heights along the ridge for colliders:
        // take the max height across depth at each column.
        for (let c = 0; c <= cols; c++) {
          let mh = 0, mr = 1;
          for (let r = 1; r <= rows; r++) if (gy[r][c] > mh) { mh = gy[r][c]; mr = r; }
          spine.push({ x: gx[mr][c], z: gz[mr][c], h: mh });
        }
        // emit 2 triangles per cell as 6 independent verts (flat facets)
        const tris = cols * rows * 2;
        const pos = new Float32Array(tris * 3 * 3);
        const col = new Float32Array(tris * 3 * 3);
        let pi = 0, ci = 0;
        const up = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
        const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), D = new THREE.Vector3();
        function emitTri(a, b, cc) {
          // face normal up-ness (for slope-based color)
          e1.subVectors(b, a); e2.subVectors(cc, a);
          up.crossVectors(e1, e2);
          let up_y = up.y; if (up_y < 0) up_y = -up_y;
          const len = up.length() || 1;
          const upDot = up_y / len;
          const verts = [a, b, cc];
          for (let k = 0; k < 3; k++) {
            const vv = verts[k];
            pos[pi++] = vv.x; pos[pi++] = vv.y; pos[pi++] = vv.z;
            const wob = vnoise(vv.x * 0.02 + seedOff, vv.z * 0.02 - seedOff);
            shadeVert(vv.y, peakAmp, upDot, wob, _cu);
            col[ci++] = _cu.r; col[ci++] = _cu.g; col[ci++] = _cu.b;
          }
        }
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            A.set(gx[r][c], gy[r][c], gz[r][c]);
            B.set(gx[r][c + 1], gy[r][c + 1], gz[r][c + 1]);
            C.set(gx[r + 1][c], gy[r + 1][c], gz[r + 1][c]);
            D.set(gx[r + 1][c + 1], gy[r + 1][c + 1], gz[r + 1][c + 1]);
            emitTri(A, C, B);
            emitTri(B, C, D);
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
        geo.computeVertexNormals();              // crisp flat facets w/ flatShading
        return { geo, spine };
      }

      // -- RANGE LAYOUT: foreground ring (carries colliders) + distant -
      // foreground spines run along each rect edge, depthDir points OUT.
      const INSET = 10;                          // spine sits just outside rim
      const fgEdges = [
        { p0: { x: MINX, z: MINZ - INSET }, p1: { x: MAXX, z: MINZ - INSET }, dir: { x: 0, z: -1 }, name: "N" },
        { p0: { x: MINX, z: MAXZ + INSET }, p1: { x: MAXX, z: MAXZ + INSET }, dir: { x: 0, z: 1 }, name: "S" },
        { p0: { x: MINX - INSET, z: MINZ }, p1: { x: MINX - INSET, z: MAXZ }, dir: { x: -1, z: 0 }, name: "W" },
        { p0: { x: MAXX + INSET, z: MINZ }, p1: { x: MAXX + INSET, z: MAXZ }, dir: { x: 1, z: 0 }, name: "E" },
      ];
      const fgGeoms = [], spines = [];
      for (let ei = 0; ei < fgEdges.length; ei++) {
        const e = fgEdges[ei];
        const cfg = {
          cols: 56, rows: 6, depthLen: 150,
          peakAmp: 100 + rng() * 20,             // ~100-120
          seedOff: 1000 + ei * 137 + rng() * 50,
          noiseScale: 0.012,
        };
        const built = buildRidge(e.p0, e.p1, e.dir, cfg);
        fgGeoms.push(built.geo);
        spines.push({ edge: e, spine: built.spine, peakAmp: cfg.peakAmp });
      }

      // distant backdrop ring: 2-3 longer/taller ridges pushed further out
      const dEdges = [
        { p0: { x: MINX - 60, z: MINZ - 200 }, p1: { x: MAXX + 60, z: MINZ - 200 }, dir: { x: 0, z: -1 } },
        { p0: { x: MINX - 200, z: MINZ - 60 }, p1: { x: MINX - 200, z: MAXZ + 60 }, dir: { x: -1, z: 0 } },
        { p0: { x: MAXX + 200, z: MINZ - 60 }, p1: { x: MAXX + 200, z: MAXZ + 60 }, dir: { x: 1, z: 0 } },
      ];
      const distGeoms = [];
      for (let di = 0; di < dEdges.length; di++) {
        const e = dEdges[di];
        const cfg = {
          cols: 60, rows: 4, depthLen: 230,
          peakAmp: 190 + rng() * 30,             // ~190-220
          seedOff: 5000 + di * 211 + rng() * 80,
          noiseScale: 0.009,
        };
        distGeoms.push(buildRidge(e.p0, e.p1, e.dir, cfg).geo);
      }

      // -- MERGE: foreground -> 1 mesh, distant -> 1 mesh (2 draw calls)
      const rangeMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
      function mergeAddRange(geoms, cast) {
        let mesh;
        if (BGU && BGU.mergeBufferGeometries) {
          mesh = new THREE.Mesh(BGU.mergeBufferGeometries(geoms), rangeMat);
        } else {
          // manual Float32 concat fallback (position + color)
          let np = 0, nc = 0;
          for (const g of geoms) { np += g.attributes.position.array.length; nc += g.attributes.color.array.length; }
          const P = new Float32Array(np), Cc = new Float32Array(nc);
          let po = 0, co = 0;
          for (const g of geoms) {
            P.set(g.attributes.position.array, po); po += g.attributes.position.array.length;
            Cc.set(g.attributes.color.array, co); co += g.attributes.color.array.length;
          }
          const merged = new THREE.BufferGeometry();
          merged.setAttribute("position", new THREE.BufferAttribute(P, 3));
          merged.setAttribute("color", new THREE.BufferAttribute(Cc, 3));
          merged.computeVertexNormals();
          mesh = new THREE.Mesh(merged, rangeMat);
        }
        mesh.castShadow = !!cast; mesh.receiveShadow = true;
        mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
        root.add(mesh);
        return mesh;
      }
      mergeAddRange(distGeoms, false);             // distant backdrop (no shadow)
      mergeAddRange(fgGeoms, true);                // foreground craggy ring

      // -- COLLIDERS: crest boxes along each FOREGROUND spine every ~80u
      //    (full peak height), skipping the SOUTH causeway gap (~x=470).
      for (const sp of spines) {
        const s = sp.spine;
        const isSouth = sp.edge.name === "S";
        let lastX = -1e9, lastZ = -1e9;
        for (let i = 0; i < s.length; i++) {
          const pt = s[i];
          if (pt.h < 12) continue;                 // too low to bother
          // keep the causeway mouth clear of colliders
          if (isSouth && Math.abs(pt.x - 470) < 75) continue;
          // sample roughly every ~80u along the spine
          if (Math.hypot(pt.x - lastX, pt.z - lastZ) < 80) continue;
          lastX = pt.x; lastZ = pt.z;
          const hw = 42;                            // collider half-footprint
          pushCol(pt.x - hw, pt.x + hw, pt.z - hw, pt.z + hw, 0, pt.h, null);
        }
      }
    })();

    // ---- frozen LAKE (icy plane, slight blue tint) -----------------------
    (function lake() {
      const lx = 180, lz = -1380, lr = 92;
      const ice = new THREE.Mesh(new THREE.CircleGeometry(lr, 40),
        new THREE.MeshLambertMaterial({ color: COL.ice, emissive: COL.iceDeep, emissiveIntensity: 0.12 }));
      ice.rotation.x = -Math.PI / 2;
      ice.position.set(lx, 0.05, lz);
      ice.receiveShadow = true;
      root.add(ice);
      // a couple of cracked-ice rings for read
      for (let i = 0; i < 3; i++) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(lr * (0.3 + i * 0.22), lr * (0.32 + i * 0.22), 32),
          new THREE.MeshBasicMaterial({ color: COL.iceDeep, transparent: true, opacity: 0.25 }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(lx, 0.06, lz);
        root.add(ring);
      }
    })();

    // ---- instanced SNOWY PINES (one draw call: trunk + canopy each) ------
    (function pines() {
      const COUNT = 130;
      const trunkG = new THREE.CylinderGeometry(0.22, 0.32, 1.6, 5);
      const canopyG = new THREE.ConeGeometry(1.5, 4.2, 6);
      const capG = new THREE.ConeGeometry(0.75, 1.9, 6);       // snow capping the upper canopy (conformal)
      const trunkIM = new THREE.InstancedMesh(trunkG, mTrunk, COUNT);
      const canopyIM = new THREE.InstancedMesh(canopyG, mPine, COUNT);
      const capIM = new THREE.InstancedMesh(capG, mSnow, COUNT);
      trunkIM.castShadow = canopyIM.castShadow = true;
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
      const region = { kind: "rect", minX: MINX, maxX: MAXX, minZ: MINZ, maxZ: MAXZ };
      const pts = CBZ.cityScatterInRegion(region, COUNT, rng, 60);
      let n = 0;
      for (let i = 0; i < COUNT; i++) {
        const p = pts[i];
        // keep pines off the lake + the causeway mouth
        if (Math.hypot(p.x - 180, p.z - (-1380)) < 100) continue;
        if (Math.abs(p.x - 470) < 26 && p.z > MAXZ - 120) continue;
        if (inTown(p.x, p.z)) continue;          // T8 — no pines in the resort village
        const sc = 0.8 + rng() * 1.3;
        const ry = rng() * Math.PI * 2;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry);
        // trunk
        s.set(sc, sc, sc); v.set(p.x, 0.8 * sc, p.z);
        m4.compose(v, q, s); trunkIM.setMatrixAt(n, m4);
        // canopy
        v.set(p.x, (1.6 + 2.1) * sc, p.z); m4.compose(v, q, s); canopyIM.setMatrixAt(n, m4);
        // snow cap — hugs the top ~44% of the canopy, flush with its slope (same q so facets align)
        v.set(p.x, 4.9 * sc, p.z); m4.compose(v, q, s); capIM.setMatrixAt(n, m4);
        n++;
      }
      trunkIM.count = canopyIM.count = capIM.count = n;
      trunkIM.instanceMatrix.needsUpdate = canopyIM.instanceMatrix.needsUpdate = capIM.instanceMatrix.needsUpdate = true;
      root.add(trunkIM); root.add(canopyIM); root.add(capIM);
    })();

    // ---- instanced ROCKY OUTCROPS + SNOWDRIFTS ---------------------------
    (function rocksAndDrifts() {
      const RC = 40;
      const rockG = new THREE.DodecahedronGeometry(1.1, 0);
      const rockIM = new THREE.InstancedMesh(rockG, mRock, RC);
      rockIM.castShadow = true; rockIM.receiveShadow = true;
      const driftG = new THREE.SphereGeometry(1, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2);
      const driftIM = new THREE.InstancedMesh(driftG, mSnowShade, RC);
      driftIM.receiveShadow = true;
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
      const region = { kind: "rect", minX: MINX, maxX: MAXX, minZ: MINZ, maxZ: MAXZ };
      const pr = CBZ.cityScatterInRegion(region, RC, rng, 70);
      const pd = CBZ.cityScatterInRegion(region, RC, rng, 50);
      let rn = 0, dn = 0;
      for (let i = 0; i < RC; i++) {
        const a = pr[i], sc = 0.7 + rng() * 1.8;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2);
        // T8 — skip rocks/drifts that fall in the resort village (keep the rng
        // draws above so determinism + the drift below are unchanged).
        if (!inTown(a.x, a.z)) {
          s.set(sc, sc * (0.7 + rng() * 0.5), sc); v.set(a.x, sc * 0.35, a.z);
          m4.compose(v, q, s); rockIM.setMatrixAt(rn++, m4);
        } else { rng(); }                        // consume the height-jitter draw
        const b = pd[i], dc = 1.4 + rng() * 3.2;
        s.set(dc, dc * (0.32 + rng() * 0.2), dc * (0.7 + rng() * 0.6));
        if (!inTown(b.x, b.z)) {
          v.set(b.x, 0.02, b.z); m4.compose(v, q, s); driftIM.setMatrixAt(dn++, m4);
        }
      }
      rockIM.count = rn; driftIM.count = dn;
      rockIM.instanceMatrix.needsUpdate = driftIM.instanceMatrix.needsUpdate = true;
      root.add(rockIM); root.add(driftIM);
    })();

    // ---- SKI LODGE (enterable; fireplace + warm interior) ----------------
    (function lodge() {
      const lx = 360, lz = -1250, w = 22, d = 16, storeys = 2;
      let b = null;
      if (CBZ.cityMakeBuilding) {
        b = CBZ.cityMakeBuilding(root, lx, lz, w, d, storeys, COL.timber, 0, { stairs: true });
        if (b && CBZ.cityFurnishApartment) {
          const fh = b.FH || 4;
          for (let k = 0; k < storeys; k++) CBZ.cityFurnishApartment(b, k * fh, ((lx | 0) + (lz | 0) + k) >> 1);
        }
      } else {
        b = box(lx, 4, lz, w, 8, d, mTimber, true);
      }
      // snowy A-frame roof slab on top (visual)
      box(lx, storeys * 4 + 1.4, lz, w + 2, 2.6, d + 2, new THREE.MeshLambertMaterial({ color: COL.roofSnow }), false);
      // a warm fireplace glow box flush to the front wall (WHY: "cozy" = light + warmth)
      const fire = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.4, 0.6),
        new THREE.MeshLambertMaterial({ color: COL.timberDk, emissive: COL.ember, emissiveIntensity: 0.85 }));
      fire.position.set(lx - w / 2 + 1.5, 1.4, lz - d / 2 + 0.4);
      root.add(fire);
      const fl = new THREE.PointLight(COL.ember, 0.9, 22, 2);
      fl.position.set(lx - w / 2 + 2.2, 2, lz - d / 2 + 1.4);
      root.add(fl);
      // smoking chimney
      box(lx + w / 2 - 2, storeys * 4 + 2.6, lz, 1.6, 4, 1.6, mTimberDk, false);
      // register a lot so it reads as a real building on the map, if supported
      if (b && city.lots) {
        city.lots.push({ cx: lx, cz: lz, w, d, kind: "lodge", district: "snow",
          building: Object.assign({}, b, { name: "Alpine Ski Lodge",
            door: { x: lx, z: lz - d / 2 + 1.6, nx: 0, nz: 1 } }) });
      }
      const grp = new THREE.Group(); grp.position.set(lx, storeys * 4 + 4, lz); root.add(grp);
      tag(grp, "ALPINE LODGE", 0);
    })();

    // ---- mountain CABIN + frozen-over OUTPOST ----------------------------
    (function cabinAndOutpost() {
      // a small log cabin tucked near the trees
      const cx = 600, cz = -1600;
      box(cx, 2, cz, 9, 4, 7, mTimber, true);
      box(cx, 4.6, cz, 10.4, 1.6, 8.4, new THREE.MeshLambertMaterial({ color: COL.roofSnow }), false);
      box(cx + 3, 5.4, cz - 2, 1, 2, 1, mTimberDk, false);  // chimney
      const cabL = new THREE.PointLight(0xffd9a0, 0.4, 14, 2);
      cabL.position.set(cx, 2.4, cz - 3.2); root.add(cabL);
      const g1 = new THREE.Group(); g1.position.set(cx, 6.6, cz); root.add(g1);
      tag(g1, "HUNTER'S CABIN", 0);

      // a derelict frozen-over outpost: a low concrete shell crusted in ice
      const ox = 90, oz = -1640;
      box(ox, 2.4, oz, 14, 4.8, 10, new THREE.MeshLambertMaterial({ color: COL.rockDark }), true);
      // ice crust on the roof
      box(ox, 5.2, oz, 14.4, 0.6, 10.4, new THREE.MeshLambertMaterial({ color: COL.ice, transparent: true, opacity: 0.85 }), false);
      // a tilted broken radio mast
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 12, 5), mSteel);
      mast.position.set(ox + 4, 8, oz + 2); mast.rotation.z = 0.22; mast.castShadow = true; root.add(mast);
      const g2 = new THREE.Group(); g2.position.set(ox, 7.2, oz); root.add(g2);
      tag(g2, "FROZEN OUTPOST", 0);
    })();

    // ---- CHAIRLIFT line up a slope (towers + cable + moving chairs) ------
    // WHY: it carries skiers up to the ski run; chairs glide on the cable.
    const lift = { chairIM: null, baseX: 240, baseZ: -1180, topX: 470, topZ: -1720, towerTopY: 16, chairY: 10, n: 8, t: 0 };
    (function chairlift() {
      const dx = lift.topX - lift.baseX, dz = lift.topZ - lift.baseZ;
      const span = Math.hypot(dx, dz);
      const ux = dx / span, uz = dz / span;
      // towers
      const towers = 5;
      for (let i = 0; i <= towers; i++) {
        const t = i / towers;
        const x = lift.baseX + dx * t, z = lift.baseZ + dz * t;
        const h = 12 + 6 * t;          // climbs toward the top
        box(x, h / 2, z, 0.8, h, 0.8, mSteel, true);
        // cross-arm
        box(x, h, z, 4, 0.4, 0.4, mSteel, false);
      }
      lift.span = span; lift.ux = ux; lift.uz = uz;
      // CABLE: a thin tube from base-top to top-top (two strands = up/down)
      const cableMat = new THREE.MeshLambertMaterial({ color: COL.cable });
      for (const off of [-1.4, 1.4]) {
        const path = new THREE.LineCurve3(
          new THREE.Vector3(lift.baseX + uz * off, 12.6, lift.baseZ - ux * off),
          new THREE.Vector3(lift.topX + uz * off, 18.6, lift.topZ - ux * off));
        const tube = new THREE.Mesh(new THREE.TubeGeometry(path, 1, 0.08, 4, false), cableMat);
        root.add(tube);
      }
      // instanced CHAIRS (one draw call) — positions animated in onUpdate
      const chairG = new THREE.BoxGeometry(1.4, 0.9, 0.8);
      lift.chairIM = new THREE.InstancedMesh(chairG, cmat(COL.chair), lift.n);
      lift.chairIM.castShadow = true;
      root.add(lift.chairIM);
      // place once so it's correct even if onUpdate is throttled
      placeChairs(0);
    })();

    function placeChairs(t) {
      if (!lift.chairIM) return;
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(lift.ux, lift.uz));
      for (let i = 0; i < lift.n; i++) {
        // loop fraction 0..1 along the up strand (down strand offset by half)
        let f = ((i / lift.n) + t) % 1;
        const off = (i % 2 === 0) ? 1.4 : -1.4;        // alternate strands
        const x = lift.baseX + (lift.topX - lift.baseX) * f + lift.uz * off;
        const y = 12.4 + (18.4 - 12.4) * f - 1.2;       // hang below cable
        const z = lift.baseZ + (lift.topZ - lift.baseZ) * f - lift.ux * off;
        v.set(x, y, z); m4.compose(v, q, s); lift.chairIM.setMatrixAt(i, m4);
      }
      lift.chairIM.instanceMatrix.needsUpdate = true;
    }

    // ---- SKI RUN with slalom gates (red/blue poles down the slope) -------
    (function skiRun() {
      const sx = 470, sz0 = -1720, sz1 = -1300;     // top to bottom along z
      // groomed snow strip (slightly brighter)
      const run = new THREE.Mesh(new THREE.PlaneGeometry(26, sz1 - sz0),
        new THREE.MeshLambertMaterial({ color: 0xf6fbff }));
      run.rotation.x = -Math.PI / 2; run.position.set(sx, 0.04, (sz0 + sz1) / 2); run.receiveShadow = true;
      root.add(run);
      // slalom gate poles (instanced — alternating sides)
      const gates = 9;
      const poleG = new THREE.CylinderGeometry(0.14, 0.14, 2.4, 5);
      const poleIM = new THREE.InstancedMesh(poleG, new THREE.MeshLambertMaterial({ color: COL.flag }), gates);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
      for (let i = 0; i < gates; i++) {
        const t = (i + 0.5) / gates;
        const z = sz0 + (sz1 - sz0) * t;
        const x = sx + (i % 2 === 0 ? -7 : 7);
        v.set(x, 1.2, z); m4.compose(v, q, s); poleIM.setMatrixAt(i, m4);
      }
      poleIM.instanceMatrix.needsUpdate = true;
      root.add(poleIM);
    })();

    // ============================================================
    //  PINECREST — the alpine resort VILLAGE, grown from the reusable generator
    //  on the flat slope-base SE of the lodge (T8). Now that the keystone (T1)
    //  wired the arena, the lodge/outfitter/clinic/gear-pawn become REAL buyable,
    //  walk-in, staffed businesses for the mountain visitors regionlife streams
    //  (skiers/hikers). FALLBACK: if towngen / the recipe is absent this no-ops
    //  and the slopes above stand alone (the inTown skips were HAS_TOWN-gated →
    //  zero regression).
    // ============================================================
    if (HAS_TOWN) {
      if (CBZ.placement && CBZ.placement.seedFromColliders) { try { CBZ.placement.seedFromColliders(); } catch (e) {} }
      const town = CBZ.buildTown(root, Object.assign({}, CBZ.CITY_TEMPLATES.pinecrest, {
        cx: TOWN_CX, cz: TOWN_CZ, region: TOWN, rng: rng,
        name: "Pinecrest", district: "snow",
      }));
      // WORK-ANCHORS at the lodge + outfitter so the resort staffs up (same
      // schedule/goal brain the mainland uses). Feature-detected.
      if (town && CBZ.registerWorkAnchor) {
        const findLot = function (kw) {
          return (town.lots || []).find(function (l) {
            return l.building && l.building.shop && l.building.name &&
              l.building.name.toUpperCase().indexOf(kw) >= 0;
          });
        };
        const lodge = findLot("LODGE") || (town.lots || []).find(function (l) { return l.building && l.building.shop; });
        const outfitter = findLot("OUTFITTER") || findLot("OUTFIT") || findLot("GEAR");
        for (const a of [lodge, outfitter]) {
          if (!a || !a.building || !a.building.vendorSpot) continue;
          try {
            CBZ.registerWorkAnchor({
              biome: "snow", kind: "shop", role: "shopkeeper",
              x: a.cx, z: a.cz, cap: 1,
              spots: [{ x: a.building.vendorSpot.x, z: a.building.vendorSpot.z }],
              home: { x: a.cx, z: a.cz },
            });
          } catch (e) {}
        }
      }
    }

    // ============================================================
    //  CAUSEWAY: winding snowy road deck south toward the speedway,
    //  with instanced guardrail posts. rect minX=463..477 z -1120..-530.
    // ============================================================
    (function causeway() {
      const rMinX = 463, rMaxX = 477, rMinZ = -1120, rMaxZ = -530;
      const cxMid = (rMinX + rMaxX) / 2;
      if (CBZ.buildHighway) {
        // REAL wide plowed concrete highway over the water toward the speedway.
        CBZ.buildHighway(root, {
          path: [{ x: cxMid, z: rMinZ }, { x: cxMid, z: rMaxZ }],
          width: 24, lanesPerDir: 2, laneW: 3.6, theme: "concrete",
          guardrail: true, lights: true, elevated: false, rng: rng,
        });
        // snow berms flanking the wider deck (visual edge + read)
        for (const ex of [cxMid - 13.2, cxMid + 13.2]) {
          const berm = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.6, rMaxZ - rMinZ), mSnowShade);
          berm.position.set(ex, 0.3, (rMinZ + rMaxZ) / 2);
          berm.receiveShadow = true; root.add(berm);
        }
        return;
      }
      // ---- fallback: bespoke narrow deck (only if buildHighway absent) ----
      // dark plowed road deck (a touch above the snow plane)
      const deck = new THREE.Mesh(new THREE.PlaneGeometry(rMaxX - rMinX, rMaxZ - rMinZ),
        new THREE.MeshLambertMaterial({ color: 0x3b3f45 }));
      deck.rotation.x = -Math.PI / 2;
      deck.position.set(cxMid, 0.06, (rMinZ + rMaxZ) / 2);
      deck.receiveShadow = true;
      root.add(deck);
      // snow berms either side (visual edge + read)
      for (const ex of [rMinX - 1.2, rMaxX + 1.2]) {
        const berm = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.6, rMaxZ - rMinZ), mSnowShade);
        berm.position.set(ex, 0.3, (rMinZ + rMaxZ) / 2);
        berm.receiveShadow = true; root.add(berm);
      }
      // GUARDRAIL posts (instanced, both sides) — short, non-blocking visuals
      const POSTS = 2 * 24;
      const postG = new THREE.CylinderGeometry(0.1, 0.1, 1.0, 5);
      const postIM = new THREE.InstancedMesh(postG, mSteel, POSTS);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
      let k = 0;
      for (let i = 0; i < 24; i++) {
        const t = i / 23;
        const z = rMinZ + (rMaxZ - rMinZ) * t;
        for (const ex of [rMinX - 0.5, rMaxX + 0.5]) {
          v.set(ex, 0.5, z); m4.compose(v, q, s); postIM.setMatrixAt(k++, m4);
        }
      }
      postIM.count = k; postIM.instanceMatrix.needsUpdate = true;
      root.add(postIM);
    })();

    // ---- LIFE: a few skiers / hikers (low live count per spec) -----------
    (function life() {
      if (!CBZ.cityMakePed || !CBZ.cityPeds) return;
      const spots = [
        { x: 360, z: -1232 }, { x: 250, z: -1190 },      // near the lodge / lift base
        { x: 470, z: -1320 }, { x: 590, z: -1585 },      // ski run / cabin
        { x: 190, z: -1430 },                            // by the lake
      ];
      const lr = mulberry(0xA17 ^ (CX | 0));
      for (const sp of spots) {
        try {
          const ped = CBZ.cityMakePed(sp.x, sp.z, lr, {
            job: "hiker", archetype: "resident", behavior: "wander",
            wealth: 0.4 + lr() * 0.3, armed: false,
          });
          if (ped) CBZ.cityPeds.push(ped);
        } catch (e) { /* one bad ped can't sink the biome */ }
      }
    })();

    // ============================================================
    //  SNOWFALL: ONE THREE.Points cloud (a few hundred recycled flakes),
    //  VISIBLE only while the player stands in the snow biome — so it is
    //  free everywhere else (no per-frame work when hidden).
    // ============================================================
    (function snowfall() {
      const N = 420, SPAN = 120, TOP = 70;
      const pos = new Float32Array(N * 3);
      const vel = new Float32Array(N);       // fall speed per flake
      const sway = new Float32Array(N);      // sway phase
      // seed deterministically (local rng — no Math.random)
      const fr = mulberry(0xF1A4E5);
      for (let i = 0; i < N; i++) {
        pos[i * 3] = (fr() - 0.5) * SPAN;
        pos[i * 3 + 1] = fr() * TOP;
        pos[i * 3 + 2] = (fr() - 0.5) * SPAN;
        vel[i] = 6 + fr() * 8;
        sway[i] = fr() * Math.PI * 2;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const pmat = new THREE.PointsMaterial({
        color: 0xffffff, size: 0.55, sizeAttenuation: true,
        transparent: true, opacity: 0.9, depthWrite: false,
      });
      const points = new THREE.Points(geo, pmat);
      points.frustumCulled = false;
      points.visible = false;
      // parented to scene root; we recentre it on the player each frame
      root.add(points);

      CBZ.onUpdate(37.7, function (dt) {
        const P = CBZ.player;
        if (!P || !P.pos) { if (points.visible) points.visible = false; return; }
        const inSnow = CBZ.cityBiomeAt && CBZ.cityBiomeAt(P.pos.x, P.pos.z) === "snow";
        if (!inSnow) { if (points.visible) points.visible = false; return; }
        points.visible = true;
        // keep the flake box centred on the player so a small cloud feels global
        const cx = P.pos.x, cz = P.pos.z, cy = P.pos.y || 0;
        const arr = geo.attributes.position.array;
        for (let i = 0; i < N; i++) {
          const j = i * 3;
          let ly = arr[j + 1] - vel[i] * dt;           // fall (local y, recycled)
          if (ly < 0) ly += TOP;                       // recycle to the top
          arr[j + 1] = ly;
          sway[i] += dt * 1.4;
          arr[j] += Math.sin(sway[i]) * dt * 1.1;      // drift
          // wrap horizontally within the span around the player
          let lx = arr[j], lz = arr[j + 2];
          if (lx > SPAN / 2) lx -= SPAN; else if (lx < -SPAN / 2) lx += SPAN;
          if (lz > SPAN / 2) lz -= SPAN; else if (lz < -SPAN / 2) lz += SPAN;
          arr[j] = lx; arr[j + 2] = lz;
        }
        geo.attributes.position.needsUpdate = true;
        points.position.set(cx, cy, cz);
      });
    })();

    // ---- CHAIRLIFT animation (slow glide; cheap; only writes a matrix) ---
    CBZ.onUpdate(37.8, function (dt) {
      lift.t = (lift.t + dt * 0.012) % 1;     // very slow loop
      placeChairs(lift.t);
    });

    // ============================================================
    //  WORK-ANCHOR — the ski instructor's day: the lift base, the slope, the
    //  lodge. The aigoals brain routes ski instructors / skiers here on the
    //  schedule. WHY: the slope is WORKED — instructors run the run, skiers
    //  ride the lift and ski down. The lodge is home/base. Reuses the lift
    //  base / ski-run / lodge coords already built (no new geometry).
    //   ski run: top (470,-1720) .. bottom (470,-1300); lift base (240,-1180);
    //   lodge (360,-1250).
    // ============================================================
    if (CBZ.registerWorkAnchor) {
      CBZ.registerWorkAnchor({
        biome: "snow", kind: "slope", role: "ski instructor",
        x: 240, z: -1180, cap: 4,
        home: { x: 360, z: -1250 },                        // the ski lodge
        spots: [
          { x: 240, z: -1180 },                             // the chairlift base
          { x: 470, z: -1320 },                             // bottom of the ski run
          { x: 470, z: -1700 },                             // top of the ski run
          { x: 360, z: -1232 },                             // back by the lodge
        ],
      });
    }

    // ============================================================
    //  REGISTER the regions (the archipelago contract).
    // ============================================================
    CBZ.registerCityRegion(city, {
      name: "Mount Mercy", subtitle: "Alpine Range", biome: "snow", kind: "rect",
      minX: MINX, maxX: MAXX, minZ: MINZ, maxZ: MAXZ, pad: 8,
    });
    // causeway widened to the 24m highway deck (x∈[458,482], centre x=470)
    CBZ.registerCityRegion(city, {
      name: "Mercy Causeway", subtitle: "Alpine Range", kind: "rect",
      minX: 458, maxX: 482, minZ: -1120, maxZ: -530, pad: 1,
    });
    // give traffic a road down the causeway (runs along Z → vertical)
    if (city.roads) {
      city.roads.push({ x: 470, z: -825, vertical: true, len: 590, district: "highway" });
    }
  }, 30);
})();
