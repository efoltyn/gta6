/* ============================================================
   world/desertcity.js — THE BASIN: one metropolis alone in a desert.

   WHY A SECOND WORLD GENERATOR AT ALL. `city/continent.js` + the biome
   files build the SHIPPED archipelago: many towns, roads between them,
   an economy, a hundred thousand lines of simulation hanging off every
   lot. That world is not a thing you can hand to a match — it is the
   game. What the engine had NO answer for was the other shape entirely:
   ONE dense city, standing alone, with nothing around it for kilometres,
   read from the air. Every mode that wants altitude (bombing, dogfights,
   recon, a parachute drop, a flyover cinematic) needs exactly that shape
   and until now nobody could ask for it.

   THE SHAPE (concentric, by design — the rings ARE the readability):

     r 0 ‥ 1050   CITY PLAIN, dead flat. Flat is not laziness: a street
                  grid on a hillside needs terracing, and terracing is a
                  month. The basin floor is the reason the grid can be
                  laid in one pass and the reason a runner's sprint line
                  and a bomber's aiming line agree.
     1050 ‥ 2700  DUNE DESERT. Fbm dunes rising with distance, so the
                  city sits in a bowl and the horizon closes behind you.
     2700 ‥ 3750  THE INLAND SEA. The terrain floor drops under the water
                  plane. It is a RING, not a lake: from the air the city
                  reads as an island in sand inside an island in water.
     3750 ‥ 5000  WHITE SALT. Blinding, flat, featureless — the map's
                  "you have gone too far" surface. It says it without a
                  wall, which is the only kind of boundary worth having.
     5000 ‥ 7200  MOUNTAIN RIM. Ridged noise to ~560 m with snow above
                  330. The visual lid on the basin.

   HEIGHT IS ANALYTIC, NOT SAMPLED. `heightAt(x,z)` is a pure function of
   position (order-independent hash noise, per core/seed.js's hash01
   doctrine) and the terrain MESH is built by evaluating that same
   function. Nothing reads the mesh back. That is what lets an aircraft
   2 km up, a bomb mid-fall and an AI pathing on foot all agree about the
   ground without a raycast, and it is why a page can query the ground at
   a spot the mesh does not even have a vertex for.

   ONE TEXTURE, TWO HUNDRED FACADES. Buildings share a SINGLE wrapping
   window texture; per-building repeat comes from scaling the box's own
   UV attribute (the geometry is per-building anyway, because the sizes
   differ). The obvious alternative — clone the texture per building and
   set `repeat` — costs 200 GPU textures for zero visual difference.

   EMPTY BY CONTRACT. These towers have no interiors and that is stated,
   not apologised for: this generator makes a SKYLINE and a street maze.
   A caller that wants interiors composes `city/buildings.js` on top; the
   lot list is published (`world.lots` / `world.buildings`) precisely so
   it can.

   THE COVER LAW. A city read from the air needs somewhere to hide that
   is not "inside a building we did not model". So the generator places
   CIVIL-DEFENCE SHELTERS — roofed concrete stands on open ground — and
   publishes them as `world.shelters`. Anything that traces cover
   (systems/ordnance.js's blast attenuation, an AI's flee target) reads
   that list. Shelters are the reason open ground is a decision.

   PUBLISHED SURFACE (what a caller may rely on):
     world.root · world.terrain · world.water
     world.heightAt(x,z)          ground height anywhere in the basin
     world.buildings[]            {x,z,w,d,h,mesh}
     world.buildingAt(x,z,pad)    the tower covering a point, or null
     world.shelters[]             {x,z,r,mesh}
     world.nearestShelter(x,z)
     world.park                   {x,z,r}
     world.streetPoint(rnd)       a walkable spot on the grid
     world.desertPoint(rnd,min,max)
     world.inCity/inPark/onStreet(x,z)
     world.skylineHeightAt(x,z)   tallest thing over a point (bomb clearance)

   THE GROUND IS A DECAL LADDER, NOT A STACK OF PLANES. The basin floor is
   dead flat at y = 0 and five things are drawn on it — the road disc, the
   lane paint, the park, its pond, its path. They used to be a y-ladder
   (0.04 / 0.08 / 0.12 / 0.16 / 0.17), which is invisible on foot and worth
   nothing from a bomber: measured, 100% of ground samples from 1200 m sat
   inside ONE depth-buffer LSB. They now go down through
   `CBZ.depthGround(mesh, rank, lift)` (world/materials.js) — coplanar, with
   polygonOffset doing the separating, which is what city/world.js's road
   paint has done all along. Anything else printed on this floor joins the
   ladder at the next rank; it does not pick a new number.

   Flags: DESERTCITY_V1 (master), DESERTCITY_TOWERS, DESERTCITY_SEG,
   DESERTCITY_SHELTERS, DESERTCITY_PROPS.
   Audit: CBZ.desertCityAudit().
============================================================ */
(function () {
  "use strict";
  const CBZ = (window.CBZ = window.CBZ || {});
  const THREE = window.THREE;
  if (!THREE) return;

  CBZ.CONFIG = CBZ.CONFIG || {};
  const C = CBZ.CONFIG;
  if (C.DESERTCITY_V1 == null) C.DESERTCITY_V1 = true;
  if (C.DESERTCITY_TOWERS == null) C.DESERTCITY_TOWERS = 200;
  if (C.DESERTCITY_SEG == null) C.DESERTCITY_SEG = 240;
  if (C.DESERTCITY_SHELTERS == null) C.DESERTCITY_SHELTERS = 30;
  if (C.DESERTCITY_PROPS == null) C.DESERTCITY_PROPS = true;
  if (C.DESERTCITY_V1 === false) return;

  // ---- the rings (module constants: the shape IS the contract) ------------
  const R_CITY = 1050;    // flat basin floor
  const R_DUNE = 2700;    // dunes crest
  const R_WIN = 3050;     // waterline in
  const R_WOUT = 3750;    // waterline out
  const R_SALT = 5000;    // salt flats end
  const R_MTN = 7200;     // mountain crest
  const HALF = 7600;      // terrain half-extent
  const WATER_Y = -6;
  const SEA_FLOOR = -46;

  // ---- deterministic, order-independent noise ----------------------------
  // hash01 comes from core/seed.js when present; the fallback keeps the same
  // avalanche shape so a slice page without seed.js still gets one world.
  const h01 = CBZ.hash01 || function (x, z, salt) {
    let n = ((Math.round(x * 10) | 0) * 73856093) ^ ((Math.round(z * 10) | 0) * 19349663) ^ ((salt | 0) * 83492791);
    n = Math.imul(n ^ (n >>> 13), 0x85ebca6b) >>> 0;
    n ^= n >>> 16;
    return (n >>> 0) / 4294967296;
  };
  function sm(t) { return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // value noise on a lattice of size `cell`, smooth-interpolated
  function vnoise(x, z, cell, salt) {
    const gx = x / cell, gz = z / cell;
    const ix = Math.floor(gx), iz = Math.floor(gz);
    const fx = sm(gx - ix), fz = sm(gz - iz);
    const a = h01(ix, iz, salt), b = h01(ix + 1, iz, salt);
    const c = h01(ix, iz + 1, salt), d = h01(ix + 1, iz + 1, salt);
    return lerp(lerp(a, b, fx), lerp(c, d, fx), fz);
  }
  function fbm(x, z, cell, oct, salt) {
    let v = 0, amp = 1, tot = 0, cl = cell;
    for (let i = 0; i < oct; i++) {
      v += vnoise(x, z, cl, salt + i * 17) * amp;
      tot += amp; amp *= 0.5; cl *= 0.5;
    }
    return v / tot;
  }
  // ridged noise — the sharp crests a mountain has and fbm does not
  function ridged(x, z, cell, oct, salt) {
    let v = 0, amp = 1, tot = 0, cl = cell;
    for (let i = 0; i < oct; i++) {
      const n = 1 - Math.abs(vnoise(x, z, cl, salt + i * 31) * 2 - 1);
      v += n * n * amp;
      tot += amp; amp *= 0.5; cl *= 0.52;
    }
    return v / tot;
  }

  // ---- THE height function (see header: analytic, nothing samples the mesh)
  function heightAt(x, z) {
    const r = Math.hypot(x, z);
    if (r <= R_CITY) return 0;

    const dune = (fbm(x, z, 420, 3, 811) - 0.42) * 62;
    if (r < R_DUNE) {
      const t = sm((r - R_CITY) / (R_DUNE - R_CITY));
      return dune * t;
    }
    if (r < R_WIN) {                                   // shore into the sea
      const t = sm((r - R_DUNE) / (R_WIN - R_DUNE));
      return lerp(dune, SEA_FLOOR, t);
    }
    if (r < R_WOUT) {                                  // the channel floor
      const t = (r - R_WIN) / (R_WOUT - R_WIN);
      return SEA_FLOOR - Math.sin(t * Math.PI) * 16;
    }
    if (r < R_WOUT + 280) {                            // far shore climbing out
      const t = sm((r - R_WOUT) / 280);
      return lerp(SEA_FLOOR, 3, t);
    }
    if (r < R_SALT) {                                  // white salt, near level
      return 3 + (vnoise(x, z, 180, 907) - 0.5) * 1.8;
    }
    const t = sm((r - R_SALT) / (R_MTN - R_SALT));     // mountain rim
    const spine = ridged(x, z, 900, 4, 1301);
    const detail = fbm(x, z, 210, 3, 1409) * 44;
    return 3 + (spine * 580 + detail) * t;
  }

  // ---- vertex colouring: one palette, keyed off height AND radius ---------
  const CC = {
    hardpan: new THREE.Color(0xb4a382),
    sand: new THREE.Color(0xd9bd8b),
    seabed: new THREE.Color(0x6e7a63),
    shore: new THREE.Color(0xa89268),
    salt: new THREE.Color(0xefece3),
    saltDk: new THREE.Color(0xd6d0c2),
    rockLo: new THREE.Color(0x7d7266),
    rockHi: new THREE.Color(0x9d9384),
    snow: new THREE.Color(0xf4f5f8),
  };
  function colorAt(x, z, y, out) {
    const r = Math.hypot(x, z);
    if (r <= R_CITY) {
      out.copy(CC.hardpan);
    } else if (r < R_DUNE) {
      out.copy(CC.hardpan).lerp(CC.sand, sm((r - R_CITY) / (R_DUNE - R_CITY)));
    } else if (r < R_WOUT + 220) {
      out.copy(y < WATER_Y - 2 ? CC.seabed : CC.shore);
    } else if (r < R_SALT) {
      out.copy(CC.salt).lerp(CC.saltDk, vnoise(x, z, 26, 2203) * 0.5);
    } else {
      out.copy(CC.rockLo).lerp(CC.rockHi, fbm(x, z, 130, 2, 2311));
      out.lerp(CC.snow, sm((y - 300) / 160));
    }
    // one cheap per-vertex break-up so a 60 m cell does not read as a tile
    out.multiplyScalar(0.94 + h01(x, z, 3301) * 0.12);
    return out;
  }

  // ---- window texture: ONE, wrapping, shared by every facade -------------
  let winTex = null;
  function windowTexture() {
    if (winTex) return winTex;
    const S = 128;
    const cv = document.createElement("canvas");
    cv.width = cv.height = S;
    const g = cv.getContext("2d");
    g.fillStyle = "#2b2f36"; g.fillRect(0, 0, S, S);
    const cell = S / 4, pad = cell * 0.18;
    for (let iy = 0; iy < 4; iy++) for (let ix = 0; ix < 4; ix++) {
      const lit = h01(ix, iy, 5501);
      const v = lit < 0.34 ? 0 : lit;
      g.fillStyle = v === 0 ? "#1a1e24"
        : "rgb(" + Math.round(90 + v * 130) + "," + Math.round(104 + v * 132) + "," + Math.round(122 + v * 128) + ")";
      g.fillRect(ix * cell + pad, iy * cell + pad, cell - pad * 2, cell - pad * 2);
    }
    g.strokeStyle = "rgba(0,0,0,0.45)"; g.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      g.beginPath(); g.moveTo(i * cell, 0); g.lineTo(i * cell, S); g.stroke();
      g.beginPath(); g.moveTo(0, i * cell); g.lineTo(S, i * cell); g.stroke();
    }
    winTex = new THREE.CanvasTexture(cv);
    winTex.wrapS = winTex.wrapT = THREE.RepeatWrapping;
    return winTex;
  }

  function cm(hex, o) { return CBZ.cmat ? CBZ.cmat(hex, o) : new THREE.MeshLambertMaterial({ color: hex }); }
  function bg(w, h, d) { return CBZ.boxGeom ? CBZ.boxGeom(w, h, d) : new THREE.BoxGeometry(w, h, d); }
  function collide(b) { return (CBZ.micro && CBZ.micro.addCollider) ? CBZ.micro.addCollider(b) : b; }

  // =========================================================== BUILD
  CBZ.desertCity = CBZ.desertCity || {};
  CBZ.desertCity.heightAt = heightAt;
  CBZ.desertCity.rings = {
    city: R_CITY, dune: R_DUNE, waterIn: R_WIN, waterOut: R_WOUT,
    salt: R_SALT, mountain: R_MTN, half: HALF, waterY: WATER_Y,
  };

  CBZ.desertCity.build = function (opts) {
    opts = opts || {};
    if (CBZ.desertCity.world && !opts.rebuild) return CBZ.desertCity.world;

    const rng = CBZ.seedStream ? CBZ.seedStream(opts.seed || "desertcity") : Math.random;
    const rr = function (a, b) { return a + rng() * (b - a); };
    const root = new THREE.Group();
    root.name = "desertCity";
    (opts.parent || CBZ.scene).add(root);

    const world = {
      root: root,
      heightAt: heightAt,
      groundAt: heightAt,
      buildings: [],
      lots: [],
      shelters: [],
      props: [],
      rings: CBZ.desertCity.rings,
      park: null,
      stats: {},
    };

    // ---------------------------------------------------------- 1. TERRAIN
    (function terrain() {
      const SEG = C.DESERTCITY_SEG | 0;
      const geo = new THREE.PlaneGeometry(HALF * 2, HALF * 2, SEG, SEG);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      const col = new Float32Array(pos.count * 3);
      const tmp = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        const y = heightAt(x, z);
        pos.setY(i, y);
        colorAt(x, z, y, tmp);
        col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
      }
      geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
      m.receiveShadow = true;
      m.name = "terrain";
      root.add(m);
      world.terrain = m;
      world.stats.terrainVerts = pos.count;
    })();

    // ------------------------------------------------------------ 2. WATER
    (function water() {
      const geo = new THREE.RingGeometry(R_DUNE + 120, R_WOUT + 420, 96, 1);
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
        color: 0x2f6f86, transparent: true, opacity: 0.86,
        emissive: 0x0d2733, emissiveIntensity: 0.6,
      }));
      m.position.y = WATER_Y;
      m.name = "sea";
      root.add(m);
      world.water = { mesh: m, y: WATER_Y, inner: R_DUNE + 120, outer: R_WOUT + 420 };
      let t = 0;
      if (CBZ.micro && CBZ.micro.onFrame) CBZ.micro.onFrame(function (dt) {
        t += dt;
        m.position.y = WATER_Y + Math.sin(t * 0.5) * 0.35;
      }, { id: "desertcity-sea", order: 40 });
    })();

    // ------------------------------------------------- 3. STREET GRID + LOTS
    // The grid is the city's skeleton and every later system reads it: lots
    // become towers, the gaps become streets, and both are published so an AI
    // can path a street and a bomb can ask which lot it hit.
    // PITCH is sized so the circular cull still leaves more lots than
    // DESERTCITY_TOWERS asks for — a grid that cannot fill the request would
    // quietly ship a smaller skyline than the caller configured, which is the
    // kind of shortfall nobody notices until they count. At 114 m pitch the
    // basin holds ~205 lots against a 200-tower default.
    const BLOCK = 88, ROAD = 26, PITCH = BLOCK + ROAD;
    const GRID_N = Math.floor((R_CITY * 0.96 * 2) / PITCH);
    const ORIGIN = -(GRID_N * PITCH) / 2 + PITCH / 2;
    world.grid = { block: BLOCK, road: ROAD, pitch: PITCH, n: GRID_N, origin: ORIGIN };

    // the park: one big green disc, off-centre so downtown is not symmetric
    const park = { x: rr(-340, -190), z: rr(230, 400), r: 300 };
    world.park = park;

    const lots = world.lots;
    for (let gz = 0; gz < GRID_N; gz++) for (let gx = 0; gx < GRID_N; gx++) {
      const cx = ORIGIN + gx * PITCH, cz = ORIGIN + gz * PITCH;
      if (Math.hypot(cx, cz) > R_CITY * 0.94) continue;
      if (Math.hypot(cx - park.x, cz - park.z) < park.r + BLOCK * 0.6) continue;
      lots.push({ x: cx, z: cz, gx: gx, gz: gz, d: Math.hypot(cx, cz), building: null });
    }
    // downtown first: the tallest towers belong at the centre, so sort by
    // distance and let the height curve follow the index
    lots.sort(function (a, b) { return a.d - b.d; });

    // road surface: ONE dark disc under the whole grid; the sidewalk pads
    // that sit on it are what make the streets read as streets
    (function roads() {
      const R = R_CITY * 0.95;
      const geo = new THREE.CircleGeometry(R, 72);
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, cm(0x35383d));
      // THE GROUND IS A LADDER OF DECALS, NOT A STACK OF PLANES. This disc is
      // a kilometre across and the terrain plate under it is dead flat at
      // y = 0 inside R_CITY, so the two are one 4 cm gap apart over the whole
      // city. On foot that is invisible — a grazing ray separates the two hits
      // by 4cm x D / eye-height, twenty-three metres at a kilometre. From a
      // bomber it is nothing: measured 100% of ground samples under one depth
      // LSB from 1200 m. CBZ.depthGround (world/materials.js) lays the disc
      // COPLANAR and lets polygonOffset do the separating, which is exactly
      // what city/world.js's road paint has always done.
      m.position.y = CBZ.depthGround ? CBZ.depthGround(m, 1, 0.04) : 0.04;
      m.receiveShadow = true;
      root.add(m);
      world.roadPlane = m;

      // lane paint: one instanced strip per avenue, both axes, 1 draw call
      const nx = GRID_N + 1;
      const im = new THREE.InstancedMesh(
        bg(1.4, 0.04, PITCH * GRID_N),
        cm(0xd8cfa8, { emissive: 0x2a2413, ei: 0.4 }),
        nx * 2);
      const mtx = new THREE.Matrix4();
      const qI = new THREE.Quaternion();
      const qR = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
      const one = new THREE.Vector3(1, 1, 1);
      const v = new THREE.Vector3();
      const s = new THREE.Vector3();
      const away = new THREE.Vector3(0, -9999, 0);
      const FULL = PITCH * GRID_N;
      // rank 2: paint ON the road disc, which is rank 1. The returned y puts
      // the strip's UNDERSIDE on the road rather than its middle, so the
      // 4 cm bar is not half-buried in the surface it marks.
      // `hairline: 1.4` is the STRIPE WIDTH, and it is what actually stops
      // the shimmer: measured, 49 of 484 fixed ground points changed which
      // surface they showed under sub-metre camera steps at 1200 m, and every
      // one of them was this paint — a 1.4 m stripe is 0.87 of a pixel at
      // that height, so its coverage flips as you fly. The engine now fades
      // it out before it gets thinner than a pixel.
      const PAINT_Y = CBZ.depthGround ? CBZ.depthGround(im, 2, 0.08, { hairline: 1.4 }) : 0.08;
      let k = 0;
      for (let i = 0; i < nx; i++) {
        const p = ORIGIN - PITCH / 2 + i * PITCH;
        const off = Math.abs(p) >= R * 0.98;
        // Each avenue is a CHORD of the road disc, not a full-length bar.
        // Left at full length the paint runs a kilometre out past the last
        // building and prints a grid on open sand — the city's street plan,
        // drawn on the desert, visible from the air.
        const half = off ? 0 : Math.sqrt(Math.max(0, R * R - p * p));
        s.set(1, 1, (half * 2) / FULL);
        mtx.compose(off ? away : v.set(p, PAINT_Y, 0), qI, s); im.setMatrixAt(k++, mtx);
        mtx.compose(off ? away : v.set(0, PAINT_Y, p), qR, s); im.setMatrixAt(k++, mtx);
      }
      im.instanceMatrix.needsUpdate = true;
      im.frustumCulled = false;
      root.add(im);
    })();

    // ---------------------------------------------------------- 4. TOWERS
    (function towers() {
      const tex = windowTexture();
      const TINTS = [0x8d99a6, 0x9a8f80, 0x7f8a92, 0xa39684, 0x6f7a86, 0x94a08d];
      const facades = TINTS.map(function (t) {
        return new THREE.MeshLambertMaterial({
          color: t, map: tex, emissive: 0x161d26, emissiveIntensity: 0.5,
        });
      });
      const roofMat = cm(0x4a4f55);
      const trimMat = cm(0x2b2f35);
      const padMat = cm(0x8f8974);
      const bulbGeo = new THREE.SphereGeometry(1.6, 6, 5);
      const bulbMat = new THREE.MeshBasicMaterial({ color: 0xff3322 });

      const want = Math.min(C.DESERTCITY_TOWERS | 0, lots.length);
      for (let i = 0; i < want; i++) {
        const lot = lots[i];
        const t = i / Math.max(1, want - 1);          // 0 = downtown core
        const peak = Math.pow(1 - t, 2.2);            // a skyline is a spike
        const h = Math.round(26 + peak * 172 + rng() * (24 + peak * 60));
        // footprints stay clear of the 114 m pitch: a 66 m lot at the peak
        // multiplier is 78 m wide, and its sidewalk pad 94 m — 20 m of street
        // survives between neighbours, which is what keeps the grid walkable.
        const w = Math.round(lerp(32, 66, rng()) * (0.82 + peak * 0.36));
        const d = Math.round(lerp(32, 66, rng()) * (0.82 + peak * 0.36));
        const geo = new THREE.BoxGeometry(w, h, d);

        // per-building UV scale: ONE shared texture, correct pane size on
        // every facade (see header). BoxGeometry face order is
        // +X,-X,+Y,-Y,+Z,-Z with 4 verts each.
        const uv = geo.attributes.uv;
        const PANE = 8;
        const su = [d / PANE, d / PANE, w / PANE, w / PANE, w / PANE, w / PANE];
        const sv = [h / PANE, h / PANE, d / PANE, d / PANE, h / PANE, h / PANE];
        for (let f = 0; f < 6; f++) for (let vi = 0; vi < 4; vi++) {
          const idx = f * 4 + vi;
          uv.setXY(idx, uv.getX(idx) * su[f], uv.getY(idx) * sv[f]);
        }
        uv.needsUpdate = true;

        const mesh = new THREE.Mesh(geo, facades[(i + lot.gx) % facades.length]);
        mesh.position.set(lot.x, h / 2, lot.z);
        mesh.castShadow = true; mesh.receiveShadow = true;
        root.add(mesh);

        // roof slab + parapet: the silhouette a bare box does not have
        const cap = new THREE.Mesh(bg(w + 2, 1.6, d + 2), roofMat);
        cap.position.set(lot.x, h + 0.8, lot.z);
        cap.castShadow = true;
        root.add(cap);

        if (h > 95) {
          const mastH = 8 + rng() * 24;
          const mast = new THREE.Mesh(bg(1.4, mastH, 1.4), trimMat);
          mast.position.set(lot.x, h + mastH / 2, lot.z);
          root.add(mast);
          // aviation beacon — a 200 m tower in a bomber's airspace is lit
          const bulb = new THREE.Mesh(bulbGeo, bulbMat);
          bulb.position.set(lot.x, h + mastH, lot.z);
          root.add(bulb);
          world.props.push({ kind: "beacon", mesh: bulb });
        }

        // sidewalk pad — the lot's footprint printed on the road plane
        const pad = new THREE.Mesh(bg(w + 16, 0.5, d + 16), padMat);
        pad.position.set(lot.x, 0.25, lot.z);
        pad.receiveShadow = true;
        root.add(pad);

        const rec = { x: lot.x, z: lot.z, w: w, d: d, h: h, mesh: mesh, cap: cap, lot: lot, alive: true };
        world.buildings.push(rec);
        lot.building = rec;
        collide({
          minX: lot.x - w / 2, maxX: lot.x + w / 2,
          minZ: lot.z - d / 2, maxZ: lot.z + d / 2,
          tag: "building", ref: rec,
        });
      }
      world.stats.towers = world.buildings.length;
    })();

    // ------------------------------------------------------------ 5. PARK
    // The one soft place in a hard grid. It is big because the brief for a
    // basin city is READABILITY FROM ALTITUDE: a green disc is the landmark
    // a pilot navigates by and the only cover a runner gets in the open.
    (function buildPark() {
      const g = new THREE.CircleGeometry(park.r, 56);
      g.rotateX(-Math.PI / 2);
      const disc = new THREE.Mesh(g, cm(0x4e6b38));
      // the park is a 600 m disc printed on the road plane — same ladder, rank 2
      disc.position.set(park.x, CBZ.depthGround ? CBZ.depthGround(disc, 2, 0.12) : 0.12, park.z);
      disc.receiveShadow = true;
      root.add(disc);

      // pond
      const pg = new THREE.CircleGeometry(park.r * 0.28, 32);
      pg.rotateX(-Math.PI / 2);
      const pond = new THREE.Mesh(pg, new THREE.MeshLambertMaterial({
        color: 0x2f6f86, transparent: true, opacity: 0.9, emissive: 0x102a33, emissiveIntensity: 0.5,
      }));
      pond.position.set(park.x + park.r * 0.22,
        CBZ.depthGround ? CBZ.depthGround(pond, 3, 0.16) : 0.16,
        park.z - park.r * 0.18);
      root.add(pond);
      park.pond = { x: pond.position.x, z: pond.position.z, r: park.r * 0.28 };

      // path ring
      const ring = new THREE.RingGeometry(park.r * 0.62, park.r * 0.68, 48, 1);
      ring.rotateX(-Math.PI / 2);
      const path = new THREE.Mesh(ring, cm(0xa8977a));
      // rank 4 keeps the path above the pond, the order the old y-ladder had
      path.position.set(park.x, CBZ.depthGround ? CBZ.depthGround(path, 4, 0.17) : 0.17, park.z);
      root.add(path);

      /* ---- TREES. The engine's own, when the engine's own are loaded.
         `world/vegetation.js` publishes CBZ.vegetationKit — the archetype
         geometry, the shared vertex-coloured materials and the InstancedMesh
         assembly seam every biome in the game builds its forests through.
         A cylinder-and-sphere pair is what a page falls back to when that
         file is absent, not the plan. Placement is identical either way, so
         the park is the same park and only the foliage improves. */
      const N = 170;
      const spots = [];
      for (let i = 0; i < N * 4 && spots.length < N; i++) {
        const a = rng() * Math.PI * 2, rad = Math.sqrt(rng()) * park.r * 0.94;
        const x = park.x + Math.cos(a) * rad, z = park.z + Math.sin(a) * rad;
        if (park.pond && Math.hypot(x - park.pond.x, z - park.pond.z) < park.pond.r + 6) continue;
        const sc = 0.8 + rng() * 0.9;
        spots.push({ x: x, z: z, s: sc, rot: rng() * Math.PI * 2 });
        // a tree is cover from a blast but not a wall you bump into: the
        // collider is height-gated to the CANOPY, so you run under it.
        collide({
          minX: x - 4.4 * sc, maxX: x + 4.4 * sc, minZ: z - 4.4 * sc, maxZ: z + 4.4 * sc,
          y0: 4 * sc, y1: 11 * sc, tag: "tree",
        });
      }

      const kit = CBZ.vegetationKit;
      if (kit && kit.instanceLayer) {
        const wood = kit.instanceLayer(root, {
          kind: "mature-wood", name: "park-wood", castShadow: true,
          transform: function (d, it) {
            d.position.set(it.x, 0, it.z);
            d.rotation.set(0, it.rot, 0);
            d.scale.setScalar(it.s * 0.55);
            d.updateMatrix();
          },
        }, spots);
        const crown = kit.instanceLayer(root, {
          kind: "canopy-patch", name: "park-canopy", castShadow: true,
          transform: function (d, it) {
            d.position.set(it.x, 0, it.z);
            d.rotation.set(0, it.rot * 1.7, 0);
            d.scale.setScalar(it.s * 0.6);
            d.updateMatrix();
          },
        }, spots);
        world.stats.parkTrees = spots.length;
        world.stats.treeSource = (wood || crown) ? "vegetationKit" : "none";
      } else {
        const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.55, 0.8, 6, 5), cm(0x5a4630), spots.length);
        const leaves = new THREE.InstancedMesh(new THREE.SphereGeometry(4.4, 7, 6), cm(0x3f7a34), spots.length);
        leaves.castShadow = true;
        const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
        for (let i = 0; i < spots.length; i++) {
          const it = spots[i];
          s.set(it.s, it.s, it.s);
          mtx.compose(v.set(it.x, 3 * it.s, it.z), q, s); trunks.setMatrixAt(i, mtx);
          mtx.compose(v.set(it.x, 6 * it.s + 3, it.z), q, s); leaves.setMatrixAt(i, mtx);
        }
        trunks.instanceMatrix.needsUpdate = true;
        leaves.instanceMatrix.needsUpdate = true;
        trunks.frustumCulled = false; leaves.frustumCulled = false;
        root.add(trunks); root.add(leaves);
        world.stats.parkTrees = spots.length;
        world.stats.treeSource = "primitive";
      }

      // bandstand at the centre — the park's one built thing, and a roof
      const stage = new THREE.Mesh(new THREE.CylinderGeometry(16, 17, 1.2, 16), cm(0xb0a68c));
      stage.position.set(park.x, 0.7, park.z);
      root.add(stage);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(19, 7, 16), cm(0x6d4f38));
      roof.position.set(park.x, 9.5, park.z);
      roof.castShadow = true;
      root.add(roof);
      const pillars = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.5, 6, 6), cm(0xcfc6ad), 8);
      const pm = new THREE.Matrix4(), pq = new THREE.Quaternion();
      const pv = new THREE.Vector3(), ps = new THREE.Vector3(1, 1, 1);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        pm.compose(pv.set(park.x + Math.cos(a) * 15, 4, park.z + Math.sin(a) * 15), pq, ps);
        pillars.setMatrixAt(i, pm);
      }
      pillars.instanceMatrix.needsUpdate = true;
      root.add(pillars);
      // the bandstand roof is real cover
      world.shelters.push({ x: park.x, z: park.z, r: 17, kind: "bandstand" });
    })();

    // -------------------------------------------------------- 6. SHELTERS
    // See THE COVER LAW in the header. A shelter is a concrete slab on
    // pillars: open on all sides (you can run through it) with a ROOF (it
    // stops what falls). Placed on street corners across the grid.
    (function shelters() {
      const want = C.DESERTCITY_SHELTERS | 0;
      const slabMat = cm(0x8f8d86);
      const postMat = cm(0x6f6d67);
      let tries = 0;
      while (world.shelters.length < want + 1 && tries++ < want * 30) {
        const a = rng() * Math.PI * 2;
        const rad = 60 + Math.sqrt(rng()) * (R_CITY * 0.86);
        const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
        // snap to the nearest street intersection so it never clips a tower
        const sx = Math.round((x - ORIGIN + PITCH / 2) / PITCH) * PITCH + ORIGIN - PITCH / 2;
        const sz = Math.round((z - ORIGIN + PITCH / 2) / PITCH) * PITCH + ORIGIN - PITCH / 2;
        if (Math.hypot(sx, sz) > R_CITY * 0.88) continue;
        let clash = false;
        for (let i = 0; i < world.shelters.length; i++) {
          if (Math.hypot(sx - world.shelters[i].x, sz - world.shelters[i].z) < PITCH * 1.4) { clash = true; break; }
        }
        if (clash) continue;

        const R = 11;
        const slab = new THREE.Mesh(bg(R * 2, 1.1, R * 2), slabMat);
        slab.position.set(sx, 5.4, sz);
        slab.castShadow = true; slab.receiveShadow = true;
        root.add(slab);
        const floor = new THREE.Mesh(bg(R * 2, 0.5, R * 2), postMat);
        floor.position.set(sx, 0.35, sz);
        root.add(floor);
        for (let c = 0; c < 4; c++) {
          const px = sx + (c & 1 ? R - 1.4 : -(R - 1.4));
          const pz = sz + (c & 2 ? R - 1.4 : -(R - 1.4));
          const post = new THREE.Mesh(bg(1.6, 5, 1.6), postMat);
          post.position.set(px, 2.9, pz);
          root.add(post);
          collide({ minX: px - 0.8, maxX: px + 0.8, minZ: pz - 0.8, maxZ: pz + 0.8, tag: "post" });
        }
        // the ROOF is a collider (it is what stops the blast) but height-gated
        // above head height, so a runner passes underneath freely.
        collide({ minX: sx - R, maxX: sx + R, minZ: sz - R, maxZ: sz + R, y0: 4.8, y1: 6.1, tag: "shelter" });
        world.shelters.push({ x: sx, z: sz, r: R, kind: "shelter", mesh: slab });
      }
      world.stats.shelters = world.shelters.length;
    })();

    // ----------------------------------------------------- 7. DESERT DRESS
    // The desert is not empty ground with a fog wall — it has rock, scrub and
    // the wrecks of everything that tried to cross it. All instanced.
    if (C.DESERTCITY_PROPS) (function desert() {
      const N_ROCK = 260, N_SCRUB = 420;
      const rockG = new THREE.DodecahedronGeometry(1, 0);
      const rocks = new THREE.InstancedMesh(rockG, cm(0x8b7f6c), N_ROCK);
      rocks.castShadow = true;
      const scrubG = new THREE.ConeGeometry(1, 2, 5);
      const scrub = new THREE.InstancedMesh(scrubG, cm(0x6d7346), N_SCRUB);
      const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
      const up = new THREE.Vector3(0, 1, 0);

      for (let i = 0; i < N_ROCK; i++) {
        const a = rng() * Math.PI * 2;
        const rad = lerp(R_CITY + 90, R_DUNE - 60, Math.sqrt(rng()));
        const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
        const sc = 3 + rng() * 16;
        q.setFromAxisAngle(up, rng() * Math.PI * 2);
        mtx.compose(v.set(x, heightAt(x, z) + sc * 0.35, z), q, s.set(sc, sc * (0.5 + rng() * 0.6), sc));
        rocks.setMatrixAt(i, mtx);
        if (sc > 9) collide({ minX: x - sc * 0.7, maxX: x + sc * 0.7, minZ: z - sc * 0.7, maxZ: z + sc * 0.7, tag: "rock" });
      }
      for (let i = 0; i < N_SCRUB; i++) {
        const a = rng() * Math.PI * 2;
        const rad = lerp(R_CITY + 40, R_DUNE, Math.sqrt(rng()));
        const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
        const sc = 1 + rng() * 2.4;
        q.setFromAxisAngle(up, rng() * Math.PI * 2);
        mtx.compose(v.set(x, heightAt(x, z) + sc, z), q, s.set(sc, sc, sc));
        scrub.setMatrixAt(i, mtx);
      }
      rocks.instanceMatrix.needsUpdate = true;
      scrub.instanceMatrix.needsUpdate = true;
      rocks.frustumCulled = false; scrub.frustumCulled = false;
      root.add(rocks); root.add(scrub);
      world.stats.desertProps = N_ROCK + N_SCRUB;

      // mesa buttes out on the salt — the horizon needs punctuation
      const buttes = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1.25, 1, 7), cm(0x9c8266), 40);
      for (let i = 0; i < 40; i++) {
        const a = rng() * Math.PI * 2;
        const rad = lerp(R_WOUT + 400, R_SALT - 120, rng());
        const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
        const w = 40 + rng() * 90, h = 30 + rng() * 70;
        q.setFromAxisAngle(up, rng() * Math.PI * 2);
        mtx.compose(v.set(x, heightAt(x, z) + h / 2, z), q, s.set(w, h, w));
        buttes.setMatrixAt(i, mtx);
      }
      buttes.instanceMatrix.needsUpdate = true;
      buttes.frustumCulled = false;
      root.add(buttes);
    })();

    // ------------------------------------------------------- 8. THE QUERIES
    // Everything above is geometry. THIS is the part other systems consume.
    world.inCity = function (x, z) { return Math.hypot(x, z) <= R_CITY; };
    world.inPark = function (x, z) { return Math.hypot(x - park.x, z - park.z) <= park.r; };

    /* ---- LOT INDEX. `buildingAt` was a linear scan over all 200 towers, and
       that was fine while it answered a handful of gameplay questions a
       frame. It stopped being fine when systems/ordnance.js taught bomb
       PREDICTION to respect rooftops: predict() walks its trajectory through
       `strikeSeg`, which asks buildingAt tens of times per call — measured
       mean 36 / worst 58 over five bombing runs here, mean 59.7 / worst 86
       where ordnance measured it — and predict() runs every frame for the
       player's pipper AND once per AI bomber. MEASURED, headless, same page,
       both implementations interleaved: the scan costs 150 box tests per
       buildingAt (it early-exits on a hit) and 5409 per predict, 0.48 µs and
       21.5 µs; the index costs 3.8 and 136, 0.08 µs and 9.5 µs.

       The city does not need a search. It is a GRID and section 3 publishes
       it: every lot centre is exactly ORIGIN + g * PITCH, at most one
       building per lot, and the building sits ON the lot centre
       (rec.x === lot.x). So the map from a world point back to candidate lots
       is arithmetic.

       THE NEIGHBOURHOOD ARGUMENT (the part a future reader needs). A building
       on lot gx can satisfy the X half of the test only if
           |x - (ORIGIN + gx*PITCH)| <= w/2 + pad <= MAX_HW + pad
       so gx is confined to [(x-ORIGIN-MAX_HW-pad)/PITCH,
       (x-ORIGIN+MAX_HW+pad)/PITCH], and the same in Z. Widening that with
       floor/ceil costs at most one extra cell per side and is FREE: every
       candidate still gets the identical box test, so the bound only has to
       avoid MISSING a building, never avoid visiting a spare cell. That is
       also why no epsilon reasoning is needed at the boundaries.
       Concretely: footprints top out at 78 m (66 m lot x the 1.18 peak
       multiplier) so MAX_HW <= 39 against a 114 m pitch — the interval is
       0.684 cells wide at pad 0, i.e. 2x2 cells worst case, 4 box tests
       instead of 200. A large pad (strikeSeg passes a half-step radius)
       widens it linearly and degrades gracefully back toward the scan.

       ORDER MATTERS. The old loop returned the FIRST match in
       world.buildings order — lots sorted downtown-first. Two footprints can
       both cover a point once pad >= ~18 (39+39+2pad >= 114), which
       strikeSeg's radius reaches, so the index cannot return whichever cell
       it happened to visit first: it keeps the LOWEST building index found.
       That is the whole of the behavioural difference, and it is none.

       The index rebuilds if world.buildings ever changes length, and falls
       back to the scan if a record is not on a grid lot, so the contract
       survives a future caller that appends a building off-plan. */
    let _bIdx = null, _bIdxN = -1, _bMaxHW = 0, _bMaxHD = 0, _bLinear = false;
    function _buildIndex() {
      const B = world.buildings;
      _bIdxN = B.length;
      _bLinear = false;
      _bMaxHW = 0; _bMaxHD = 0;
      _bIdx = new Int32Array(GRID_N * GRID_N).fill(-1);
      for (let i = 0; i < B.length; i++) {
        const b = B[i], lot = b.lot;
        if (!lot || !(lot.gx >= 0) || lot.gx >= GRID_N || !(lot.gz >= 0) || lot.gz >= GRID_N ||
            b.x !== ORIGIN + lot.gx * PITCH || b.z !== ORIGIN + lot.gz * PITCH) { _bLinear = true; return; }
        if (b.w / 2 > _bMaxHW) _bMaxHW = b.w / 2;
        if (b.d / 2 > _bMaxHD) _bMaxHD = b.d / 2;
        // one building per lot by construction; first wins, matching the scan
        const c = lot.gz * GRID_N + lot.gx;
        if (_bIdx[c] < 0) _bIdx[c] = i;
      }
    }
    world.buildingAt = function (x, z, pad) {
      pad = pad || 0;
      const B = world.buildings;
      if (_bIdxN !== B.length) _buildIndex();
      if (_bLinear) {
        for (let i = 0; i < B.length; i++) {
          const b = B[i];
          if (Math.abs(x - b.x) <= b.w / 2 + pad && Math.abs(z - b.z) <= b.d / 2 + pad) return b;
        }
        return null;
      }
      const rx = _bMaxHW + pad, rz = _bMaxHD + pad;
      let gx0 = Math.floor((x - ORIGIN - rx) / PITCH), gx1 = Math.ceil((x - ORIGIN + rx) / PITCH);
      let gz0 = Math.floor((z - ORIGIN - rz) / PITCH), gz1 = Math.ceil((z - ORIGIN + rz) / PITCH);
      if (gx0 < 0) gx0 = 0; if (gx1 > GRID_N - 1) gx1 = GRID_N - 1;
      if (gz0 < 0) gz0 = 0; if (gz1 > GRID_N - 1) gz1 = GRID_N - 1;
      let best = -1;
      for (let gz = gz0; gz <= gz1; gz++) {
        const row = gz * GRID_N;
        for (let gx = gx0; gx <= gx1; gx++) {
          const i = _bIdx[row + gx];
          if (i < 0 || (best >= 0 && i > best)) continue;
          const b = B[i];
          if (Math.abs(x - b.x) <= b.w / 2 + pad && Math.abs(z - b.z) <= b.d / 2 + pad) best = i;
        }
      }
      return best >= 0 ? B[best] : null;
    };
    // tallest thing standing over a point — a bomber's clearance check
    world.skylineHeightAt = function (x, z) {
      const b = world.buildingAt(x, z, 0);
      return b ? b.h : heightAt(x, z);
    };
    world.onStreet = function (x, z) {
      if (!world.inCity(x, z)) return false;
      if (world.inPark(x, z)) return false;
      return !world.buildingAt(x, z, 3);
    };
    world.nearestShelter = function (x, z) {
      let best = null, bd = Infinity;
      for (let i = 0; i < world.shelters.length; i++) {
        const s = world.shelters[i];
        const d = Math.hypot(x - s.x, z - s.z);
        if (d < bd) { bd = d; best = s; }
      }
      return best ? { shelter: best, dist: bd } : null;
    };
    world.inShelter = function (x, z) {
      for (let i = 0; i < world.shelters.length; i++) {
        const s = world.shelters[i];
        if (Math.abs(x - s.x) <= s.r && Math.abs(z - s.z) <= s.r) return s;
      }
      return null;
    };
    // a walkable spot on the grid — used for spawns and for AI wander goals
    world.streetPoint = function (rnd, maxR) {
      const R = maxR || R_CITY * 0.86;
      const f = rnd || rng;
      for (let i = 0; i < 200; i++) {
        const a = f() * Math.PI * 2, rad = Math.sqrt(f()) * R;
        const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
        if (world.onStreet(x, z) || world.inPark(x, z)) return { x: x, z: z };
      }
      return { x: 0, z: 0 };
    };
    world.desertPoint = function (rnd, minR, maxR) {
      const f = rnd || rng;
      const a = f() * Math.PI * 2;
      const rad = lerp(minR || R_CITY + 200, maxR || R_DUNE - 200, Math.sqrt(f()));
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      return { x: x, z: z, y: heightAt(x, z) };
    };

    CBZ.desertCity.world = world;
    return world;
  };

  CBZ.desertCityAudit = function () {
    const w = CBZ.desertCity.world;
    if (!w) return { built: false };
    return {
      built: true,
      towers: w.buildings.length,
      lots: w.lots.length,
      shelters: w.shelters.length,
      parkTrees: w.stats.parkTrees || 0,
      terrainVerts: w.stats.terrainVerts || 0,
      tallest: w.buildings.reduce(function (m, b) { return Math.max(m, b.h); }, 0),
      rings: CBZ.desertCity.rings,
      // the basin's ground is five layers over one flat plate; this is the
      // engine's answer for whether they can hold their order (materials.js)
      depth: CBZ.depthAudit ? CBZ.depthAudit() : null,
    };
  };
})();
