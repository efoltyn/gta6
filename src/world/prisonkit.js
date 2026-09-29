/* ============================================================
   world/prisonkit.js — THE COMPOUND'S OUTSIDE, BUILT OF REAL THINGS.

   OWNER (2026-09-04): "there's a shit ton of jail that's just not real at
   all like the guard towers, and half the jail is empty and dumb waste of
   space … rn it looks like cardboard at high def."

   ---- WHAT WAS MEASURED (tools/visual-presets/prison-exterior, HEAD) -----
   · Every wall, tower and room shell in the compound was ONE flat Lambert
     colour on a BoxGeometry: no joints, no stains, no coping, no bump. At
     1100 px a 250 m wall was a single grey rectangle. That is the cardboard.
   · The eight "guard towers" were a 2.2 m box with a 1.1 m slab on it,
     6.4 m tall, standing INSIDE an 11 m wall — from the exercise yard not
     one of them was visible at all (tower-yard shot: wall, sky, nothing).
     The four corner towers were a 12 m post with a lid.
   · The 2026-08-11 enlargement threw a 248 x 244 m wire around a 92 x 195 m
     prison and poured concrete over the difference. Six rooms sit in it;
     ~30,000 m² of the ring had no programme at all. A real compound's open
     ground is not empty: it is a sterile zone with a patrol road between an
     inner fence and the wall, fenced walkways between buildings, rec yards
     with courts and a track, a service yard with a vehicle sally port, a
     water tower and a transformer yard by the powerhouse.

   ---- WHAT THIS FILE IS ----------------------------------------------------
   The KIT the rest of the compound builds its outside from. Nothing here is
   placed; world/towers.js, world/prisonwings.js, world/yard.js,
   world/razorwire.js and world/prisongrounds.js call it.

     CBZ.prisonKit.skin(kind, tint)      a cached textured MeshStandardMaterial
                                          (wall panels, poured concrete, painted
                                          steel, galvanised, chain-link, glass,
                                          roller door, corrugated sheet)
     CBZ.prisonKit.skinBox(mesh, kind)   re-skin an addBox() mesh in place,
                                          UVs in WORLD metres so joints line up
                                          across segments — the collider, the
                                          LOS blocker and the ref all survive
     CBZ.prisonKit.stat(geo, mat, x,y,z) a static textured piece; merged per
                                          material + 112 m tile by
                                          core/batch.js batchTexturedUnder
                                          when the prison is first shown
     CBZ.guardTower(x, z, opts)          the tower. Hollow concrete shaft set
                                          back off the wall, a ladder up its
                                          inside to a floor hatch, a glazed
                                          octagonal cab on a railed catwalk
                                          over the wall, hipped roof, eave
                                          flood (see section 5)
     CBZ.prisonFence(run)                chain-link on galvanised posts with a
                                          top rail, concertina coil on top,
                                          gates (open or shut+solid), AABB
                                          colliders per run
     CBZ.floodMast(x, z, h)              an 18 m mast with a four-lamp head
                                          on systems/prisonnight's flood
                                          circuit
     CBZ.prisonGround(x,z,w,d,kind)      an asphalt / turf / concrete patch
                                          through CBZ.prisonGroundTex
     K.hoop / K.courtHalf / K.bleacher    the one outdoor court kit
     K.vehicle(kind,x,z,ry) / K.dumpster  the service yard's and the lower
                                          yard's bus, vans and bins (profile-
                                          extruded, colliders included)
     CBZ.prisonExteriorAudit()           fenceM, masts, programmedM2,
                                          ringOpenShare, texturedWalls

   TEXTURES ARE AUTHORED, NOT LOADED. Canvas + a seeded LCG, like
   world/textures_surface.js and the cell finishes: a byte-deterministic
   surface with no asset to ship. They are UNTAGGED (no sRGBEncoding) on
   purpose — the compound's palette (CBZ.mat / cmat / checkerTex) is
   untagged, and a tagged map beside an untagged wall reads a stop darker.

   THE HEIGHT LAW. CBZ.DIM.YH (11 m) is the wall. A tower that does not
   clear it by a storey is a tower nobody in the yard can see, which is what
   the old ones were. TOWER_DECK = YH + 1.5.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !THREE || !CBZ.addBox) return;
  const { addBox } = CBZ;
  const root = () => CBZ.prisonRoot || CBZ.scene;
  const YH = (CBZ.DIM && CBZ.DIM.YH) || 11;
  const TOWER_DECK = YH + 1.5;

  /* ==========================================================
     1. TEXTURES. A seeded LCG and a tileable value noise; each surface is
        a function of (x, y) in tile space drawn once into a canvas.
     ========================================================== */
  function lcg(seed) {
    let s = (seed >>> 0) || 1;
    return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }
  function hash2(x, y, seed) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ (seed | 0);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  // tileable value noise on a `freq` lattice over [0,1)²
  function vnoise(u, v, freq, seed) {
    const x = u * freq, y = v * freq;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = hash2(x0 % freq, y0 % freq, seed), b = hash2((x0 + 1) % freq, y0 % freq, seed);
    const c = hash2(x0 % freq, (y0 + 1) % freq, seed), d = hash2((x0 + 1) % freq, (y0 + 1) % freq, seed);
    return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  }
  function fbm(u, v, freq, oct, seed) {
    let s = 0, amp = 0.5, f = freq, tot = 0;
    for (let i = 0; i < oct; i++) { s += vnoise(u, v, f, seed + i * 7919) * amp; tot += amp; amp *= 0.5; f *= 2; }
    return s / tot;
  }
  function canvasOf(size, paint) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
    const img = g.createImageData(size, size);
    const d = img.data;
    const px = { r: 0, g: 0, b: 0, a: 255 };
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = x / size, v = 1 - y / size;            // v up, like the map
      px.r = px.g = px.b = 200; px.a = 255;
      paint(u, v, px, x, y);
      const i = (y * size + x) * 4;
      d[i] = px.r; d[i + 1] = px.g; d[i + 2] = px.b; d[i + 3] = px.a;
    }
    g.putImageData(img, 0, 0);
    return c;
  }
  function tex(canvas, aniso) {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso || 8;
    return t;
  }
  const grey = (px, l) => { px.r = px.g = px.b = Math.max(0, Math.min(255, l)); };

  const CANVAS = {};
  function surface(kind) {
    if (CANVAS[kind]) return CANVAS[kind];
    let c;
    if (kind === "panel") {
      /* precast concrete panels, 4 x 4 m tile: a vertical and a horizontal
         joint on the tile edge (so the wrap IS the joint), four form-tie
         holes per panel, water streaks off the top edge, a rust drip or two */
      const rnd = lcg(4101);
      const streaks = [];
      for (let i = 0; i < 9; i++) streaks.push({ u: rnd(), w: 0.006 + rnd() * 0.02, len: 0.3 + rnd() * 0.7, a: 0.10 + rnd() * 0.22 });
      const rust = [{ u: rnd(), a: 0.5 }, { u: rnd(), a: 0.35 }];
      c = canvasOf(512, function (u, v, px) {
        let l = 198 + (fbm(u, v, 3, 4, 11) - 0.5) * 34 + (fbm(u, v, 40, 2, 12) - 0.5) * 16;
        const eu = Math.min(u, 1 - u), ev = Math.min(v, 1 - v);
        // tie holes: 4 per panel, 22 mm dark discs
        for (const hx of [0.25, 0.75]) for (const hy of [0.3, 0.7]) {
          const dx = (u - hx) * 4, dy = (v - hy) * 4, r2 = dx * dx + dy * dy;
          if (r2 < 0.0005) l -= 70; else if (r2 < 0.0011) l -= 25;
        }
        for (const s of streaks) {
          const du = Math.abs(u - s.u);
          if (du < s.w && v > 1 - s.len) l -= 255 * s.a * (1 - du / s.w) * ((v - (1 - s.len)) / s.len);
        }
        let rr = 0;
        for (const r of rust) {
          const du = Math.abs(u - r.u);
          if (du < 0.004 && v > 0.35) rr = Math.max(rr, r.a * (1 - du / 0.004) * (v - 0.35) / 0.65);
        }
        // joints: 6 cm dark groove with a lit edge
        if (eu < 0.0075 || ev < 0.0075) l = 118 + fbm(u, v, 60, 1, 13) * 20;
        else if (eu < 0.012 || ev < 0.012) l -= 22;
        grey(px, l);
        if (rr > 0) { px.r = Math.min(255, px.r + 60 * rr); px.g -= 20 * rr; px.b -= 50 * rr; }
      });
    } else if (kind === "concrete") {
      c = canvasOf(256, function (u, v, px) {
        let l = 196 + (fbm(u, v, 4, 4, 21) - 0.5) * 34 + (fbm(u, v, 32, 2, 22) - 0.5) * 18;
        const pore = fbm(u, v, 90, 1, 23);
        if (pore > 0.82) l -= 40;
        grey(px, l);
      });
    } else if (kind === "steel") {
      // painted steel: flat with a faint brush grain and rust specks
      const rnd = lcg(777);
      const specks = [];
      for (let i = 0; i < 26; i++) specks.push({ u: rnd(), v: rnd(), r: 0.004 + rnd() * 0.012 });
      c = canvasOf(256, function (u, v, px) {
        let l = 226 + (fbm(u, v, 24, 2, 31) - 0.5) * 9 + (fbm(u, v, 2, 2, 32) - 0.5) * 8;
        let rr = 0;
        for (const s of specks) {
          const du = u - s.u, dv = v - s.v, d = Math.sqrt(du * du + dv * dv);
          if (d < s.r) rr = Math.max(rr, 1 - d / s.r);
        }
        grey(px, l);
        if (rr > 0) { px.r = Math.min(255, px.r - 40 * rr); px.g -= 100 * rr; px.b -= 140 * rr; }
      });
    } else if (kind === "galv") {
      c = canvasOf(256, function (u, v, px) {
        const cell = vnoise(u, v, 9, 41);
        let l = 218 + (Math.floor(cell * 6) / 6 - 0.5) * 22 + (fbm(u, v, 64, 1, 42) - 0.5) * 6;
        grey(px, l);
      });
    } else if (kind === "chainlink") {
      /* 2 m tile of 50 mm diamond mesh. Drawn as two families of diagonal
         lines; the wire is 2.4 px wide so it still reads at mid distance. */
      const N = 40;
      c = canvasOf(512, function (u, v, px) {
        const a = (u + v) * N, b = (u - v) * N;
        const da = Math.abs(a - Math.round(a)), db = Math.abs(b - Math.round(b));
        const w = 0.09;
        const hit = Math.min(da, db) < w;
        if (hit) { grey(px, 205 + (fbm(u, v, 30, 1, 51) - 0.5) * 30); px.a = 255; }
        else { grey(px, 200); px.a = 0; }
      });
    } else if (kind === "roller") {
      // a roller-shutter door: 0.3 m slats, dark groove between, one tile per leaf
      c = canvasOf(256, function (u, v, px) {
        const slat = (v * 14) % 1;
        let l = 222 + (fbm(u, v, 3, 2, 61) - 0.5) * 10 + Math.sin(slat * Math.PI) * 8;
        if (slat < 0.10 || slat > 0.95) l -= 60;
        grey(px, l);
      });
    } else if (kind === "corrugated") {
      c = canvasOf(128, function (u, v, px) {
        let l = 220 + Math.sin(u * Math.PI * 2 * 8) * 16 + (fbm(u, v, 6, 2, 71) - 0.5) * 8;
        grey(px, l);
      });
    } else if (kind === "block") {
      /* painted concrete block, 1.6 m tile = 4 blocks x 8 courses of
         400 x 200 mm in running bond; 10 mm mortar joints read dark through
         the paint, each block a hair different in tone, a soft roller texture */
      c = canvasOf(512, function (u, v, px) {
        const course = Math.floor(v * 8), yy = (v * 8) % 1;
        const xx = ((u * 4) + (course % 2) * 0.5) % 1;
        const bx = Math.floor((u * 4) + (course % 2) * 0.5);
        let l = 222 + (hash2(bx, course, 91) - 0.5) * 7 + (fbm(u, v, 48, 2, 92) - 0.5) * 10;
        const ej = Math.min(xx, 1 - xx) * 0.4, ev = Math.min(yy, 1 - yy) * 0.2;   // metres to the joint
        if (ej < 0.006 || ev < 0.006) l = 168 + fbm(u, v, 60, 1, 93) * 18;
        else if (ej < 0.011 || ev < 0.011) l -= 14;
        grey(px, l);
      });
    } else if (kind === "wood") {
      /* sawn hardwood, 1 m tile: grain streaks running along v (with the
         world-metre UVs that is along z on a top face and up a side face),
         wavy growth rings, a few darker figure flecks and one faint plank
         joint per metre. Grey, so the tint is the species (oak, walnut). */
      c = canvasOf(512, function (u, v, px) {
        const warp = (fbm(u, v, 3, 2, 101) - 0.5) * 0.08 + Math.sin(v * 6.283 * 2 + u * 9) * 0.004;
        const ring = (u + warp) * 46;
        const fr = ring - Math.floor(ring);
        let l = 206 + (fbm(u * 0.5, v, 8, 3, 102) - 0.5) * 22;
        l -= Math.pow(Math.max(0, Math.sin(fr * Math.PI)), 6) * 34;          // latewood lines
        l += (fbm(u, v * 0.2, 60, 1, 103) - 0.5) * 12;                         // pores
        if (fbm(u, v, 18, 2, 104) > 0.74) l -= 16;                             // figure
        const j = (u * 5) % 1;
        if (j < 0.006 || j > 0.994) l -= 40;                                   // plank joint
        grey(px, l);
      });
    } else if (kind === "grating") {
      // open steel grating for the deck: 30 x 100 mm bars, seen from above
      c = canvasOf(256, function (u, v, px) {
        const gx = (u * 33) % 1, gy = (v * 10) % 1;
        let l = 205 + (fbm(u, v, 20, 1, 81) - 0.5) * 10;
        if (gx < 0.3 || gy < 0.12) l -= 95;
        grey(px, l);
      });
    } else {
      c = canvasOf(64, function (u, v, px) { grey(px, 220); });
    }
    CANVAS[kind] = c;
    return c;
  }

  /* ==========================================================
     2. MATERIALS. One per (kind, tint); Standard, untagged, on the shared
        environment through core/gfx.js when a tier has one.
     ========================================================== */
  const MATS = new Map();
  const TILE = { panel: 4, concrete: 2, steel: 1, galv: 1, chainlink: 2, roller: 1, corrugated: 1, grating: 1, block: 1.6, polished: 2, wood: 1 };
  // `rough` overrides the kind's roughness (a polished floor is the concrete
  // map at 0.3); "polished" is that as a kind of its own
  function skin(kind, tint, rough) {
    if (kind === "polished") { rough = rough != null ? rough : 0.3; }
    const key = kind + ":" + (tint == null ? "" : tint) + (rough != null ? ":" + rough : "");
    if (MATS.has(key)) return MATS.get(key);
    let m;
    if (kind === "lit") {
      // a lit tube: emissive, merged; corridors and vestibules are lit 24 h
      m = new THREE.MeshStandardMaterial({ color: 0xfff6dc, emissive: 0xffe9a8, emissiveIntensity: 1.0, roughness: 0.5, metalness: 0.0 });
    } else if (kind === "glass") {
      m = new THREE.MeshStandardMaterial({
        color: tint != null ? tint : 0x4b6e86, transparent: true, opacity: 0.42,
        roughness: 0.08, metalness: 0.55, side: THREE.DoubleSide, depthWrite: false,
        envMap: CBZ.ENV || null, envMapIntensity: 0.9,
      });
    } else {
      const canvas = surface(kind === "polished" ? "concrete" : kind);
      const map = tex(canvas, kind === "chainlink" ? 16 : 8);
      const metal = kind === "galv" || kind === "chainlink" || kind === "grating";
      m = new THREE.MeshStandardMaterial({
        color: tint != null ? tint : 0xffffff, map: map,
        bumpMap: kind === "chainlink" ? null : map,
        bumpScale: kind === "wood" ? 0.003 : kind === "panel" ? 0.02 : kind === "concrete" ? 0.008 : kind === "block" ? 0.012 : kind === "roller" ? 0.01 : kind === "corrugated" ? 0.012 : kind === "polished" ? 0.003 : 0.002,
        roughness: rough != null ? rough : kind === "wood" ? 0.62 : metal ? 0.42 : kind === "steel" ? 0.55 : kind === "roller" ? 0.6 : kind === "block" ? 0.72 : 0.92,
        metalness: metal ? 0.72 : kind === "steel" || kind === "roller" || kind === "corrugated" ? 0.35 : kind === "polished" ? 0.06 : 0.0,
        envMap: CBZ.ENV || null, envMapIntensity: metal ? 0.8 : kind === "polished" ? 0.7 : 0.45,
      });
      if (kind === "chainlink") {
        m.transparent = true; m.alphaTest = 0.08; m.side = THREE.DoubleSide; m.depthWrite = true;
      }
      if (kind === "grating") m.side = THREE.DoubleSide;
    }
    m.name = "prison-" + key;
    m.userData.prisonKit = kind;
    if (typeof CBZ.gfxRegisterPbr === "function") { try { CBZ.gfxRegisterPbr(m); } catch (e) {} }
    MATS.set(key, m);
    return m;
  }

  /* ---- world-metre UVs. Triplanar by the vertex normal, so a box, a
       cylinder or a rotated plane all carry the same 4 m joint grid and two
       wall segments that meet at x=-30 share it. `off` shifts the geometry
       (an addBox mesh's geometry is local; its position is the offset). ---- */
  const _n = new THREE.Vector3(), _p = new THREE.Vector3();
  function worldUV(geo, tile, off) {
    const pos = geo.attributes.position, nrm = geo.attributes.normal, uv = geo.attributes.uv;
    if (!pos || !nrm || !uv) return geo;
    const ox = off ? off.x : 0, oy = off ? off.y : 0, oz = off ? off.z : 0;
    for (let i = 0; i < pos.count; i++) {
      _p.fromBufferAttribute(pos, i); _n.fromBufferAttribute(nrm, i);
      const x = (_p.x + ox) / tile, y = (_p.y + oy) / tile, z = (_p.z + oz) / tile;
      const ax = Math.abs(_n.x), ay = Math.abs(_n.y), az = Math.abs(_n.z);
      if (ay >= ax && ay >= az) uv.setXY(i, x, z);
      else if (ax >= az) uv.setXY(i, _n.x >= 0 ? z : -z, y);
      else uv.setXY(i, _n.z >= 0 ? x : -x, y);
    }
    uv.needsUpdate = true;
    return geo;
  }
  let texturedWalls = 0;
  // the maps average ~0.84 of white, so a flat colour re-skinned as-is
  // reads a stop darker than it did; lift the tint to keep the wall's tone
  function toneUp(tint) {
    if (tint == null) return tint;
    const c = new THREE.Color(tint); c.multiplyScalar(1.04);
    return c.getHex();
  }
  function skinBox(mesh, kind, tint, tile) {
    if (!mesh || !mesh.geometry) return mesh;
    mesh.material = skin(kind, toneUp(tint));
    worldUV(mesh.geometry, tile || TILE[kind] || 2, mesh.position);
    mesh.userData.prisonSkin = kind;          // batch.js leaves userData meshes alone
    texturedWalls++;
    return mesh;
  }

  /* ==========================================================
     3. STATIC TEXTURED PIECES. stat() used to keep its own merger here (per
        material per 40 m cell, flushed at window load) because core/batch.js
        refused anything with a map. batch.js now merges textured statics per
        material per tile itself (batchTexturedUnder, run by
        CBZ.ensurePrisonBatched when the prison is first shown), so a piece
        is simply a mesh: one merger for the city and the jail, not two.
     ========================================================== */
  let pieces = 0;
  function stat(geo, mat, x, y, z, o) {
    o = o || {};
    if (o.rz) geo.rotateZ(o.rz);
    if (o.rx) geo.rotateX(o.rx);
    if (o.ry) geo.rotateY(o.ry);
    geo.translate(x, y, z);
    if (o.uv) worldUV(geo, o.uv);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = o.cast !== false; mesh.receiveShadow = true;
    root().add(mesh);
    pieces++;
    return geo;
  }

  /* ==========================================================
     4. SMALL SHAPES the builders share.
     ========================================================== */
  // eight boxes on the edges of an octagon of circumradius R (flats on the axes)
  function octRing(R, y, h, t, mat, x, z, o) {
    const r = R * Math.cos(Math.PI / 8), len = 2 * R * Math.sin(Math.PI / 8) + t;
    for (let i = 0; i < 8; i++) {
      if (o && o.skip === i) continue;                 // a doorway through the ring
      const a = i * Math.PI / 4;                       // flats on the axes
      stat(new THREE.BoxGeometry(len, h, t), mat, x + Math.cos(a) * r, y, z + Math.sin(a) * r, Object.assign({ ry: -a + Math.PI / 2 }, o || {}));
    }
  }
  function post(x, y0, y1, r, mat, o) {
    return stat(new THREE.CylinderGeometry(r, r, y1 - y0, 6), mat, x[0], (y0 + y1) / 2, x[1], o);
  }
  // a helix (concertina coil) along a straight run
  class Helix extends THREE.Curve {
    constructor(len, r, pitch) {
      super();
      this.len = len; this.r = r; this.turns = Math.max(1, Math.round(len / pitch));
    }
    getPoint(t, target) {
      const a = t * this.turns * Math.PI * 2;
      return (target || new THREE.Vector3()).set(t * this.len, Math.cos(a) * this.r, Math.sin(a) * this.r);
    }
  }
  function coilRun(x0, z0, x1, z1, y, r, mat) {
    const dx = x1 - x0, dz = z1 - z0, len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.5) return 0;
    const curve = new Helix(len, r || 0.36, 0.42);
    const g = new THREE.TubeGeometry(curve, curve.turns * 7, 0.018, 3, false);
    stat(g, mat, x0, y, z0, { ry: -Math.atan2(dz, dx), cast: false });
    return len;
  }

  /* ==========================================================
     5. THE GUARD TOWER.

     WHAT A PRISON GUARD TOWER IS (US state and federal practice, the
     Folsom / Marion / ADX pattern): a poured-concrete shaft standing just
     INSIDE the wall with a steel door at its foot, a ladder (or a stair) up
     the INSIDE of the shaft to a hatch in the cab floor, and on top a glazed
     cab with a steel catwalk and a 42-inch guardrail round it, the cab and
     the catwalk cantilevered out OVER the wall so the post sees both faces
     of it. Inside the cab: the console with the base radio, a chair, the
     rifle rack. A searchlight on the roof.

     WHAT IT WAS (to 2026-09-29): the shaft straddled the wall line, solid,
     with a caged ladder up the outside. Its 3.7 m plinth was a FULL-HEIGHT
     collider, so at deck height an invisible 3.7 m box filled the middle of
     the cab and the walkway (you came off the ladder and could not take a
     step), the wall under the deck was a full-height collider too (a second
     invisible wall across the catwalk, from the wall's coping to the sky),
     the rail's collider stood 16 cm above its top rail, and the deck's floor
     was a 6.5 m SQUARE under an octagon (12 m2 of walkable air per tower).
     tools/prison-tower-check.mjs measured it: 149 m2 of ghost and 147 m2 of
     floating floor over the twelve towers. Everything below is built so
     that check reads zero: what is drawn is solid and nothing else is.

     CBZ.guardTower(x, z, opts)
       (x, z)       with opts.inward: the point ON THE WALL LINE the post
                    stands at (a corner, a junction, mid-wall); the tower
                    stands back off the wall by half its shaft plus the
                    wall's half-thickness on each inward axis.
                    Without inward: the tower's own centre.
       inward       {x, z}, components -1/0/1: which side is the compound
       face         {x, z} the way the post looks (cab door, eave flood,
                    the officer). Default: inward.
       perimeter    {x, z} the OUTSIDE normal when this wall is the outer
                    wire: over the rail on that side is out of the prison
       register     push CBZ.towers (capture.js / searchlight.js), default true
       manned       an officer on post (entities/towerwatch.js), default = register
       deck         deck height (default TOWER_DECK)
     ========================================================== */
  CBZ.towers = CBZ.towers || [];
  const towerRecs = [];
  const SHAFT = 2.8, SHAFT_T = 0.25, WALL_HALF = 0.5, WALL_SET = 0.1;
  const DECK_R = 3.6;                 // catwalk octagon circumradius: ~1.2 m of walkway round the cab
  const CAB_R = 2.15;
  const RAIL_H = 1.07;                // OSHA / IBC guardrail: 42 in over the walking surface
  // a wall as colliders: straight runs are one box, diagonal ones chopped
  // fine enough that the staircase of AABBs stands no more than ~9 cm off
  // the drawn line (the census tolerance is 10 cm)
  function segCol(ax, az, bx, bz, y0, y1, th) {
    const L = Math.hypot(bx - ax, bz - az);
    const axial = Math.abs(bx - ax) < 0.02 || Math.abs(bz - az) < 0.02;
    const k = axial ? 1 : Math.max(1, Math.ceil(L / 0.15));
    for (let i = 0; i < k; i++) {
      const x0 = ax + (bx - ax) * i / k, z0 = az + (bz - az) * i / k;
      const x1 = ax + (bx - ax) * (i + 1) / k, z1 = az + (bz - az) * (i + 1) / k;
      CBZ.colliders.push({ minX: Math.min(x0, x1) - th, maxX: Math.max(x0, x1) + th,
        minZ: Math.min(z0, z1) - th, maxZ: Math.max(z0, z1) + th, y0: y0, y1: y1, rail: true, noBreach: true });
    }
  }
  function guardTower(wx, wz, opts) {
    opts = opts || {};
    const H = opts.deck != null ? opts.deck : TOWER_DECK;
    const S = SHAFT, t = SHAFT_T, hs = S / 2;
    const inw = opts.inward || null;
    const ix = inw ? Math.sign(inw.x || 0) : 0, iz = inw ? Math.sign(inw.z || 0) : 0;
    const off = hs + WALL_HALF + WALL_SET;
    const x = wx + ix * off, z = wz + iz * off;
    let face = opts.face;
    if (!face) {
      const l = Math.hypot(ix, iz);
      face = l > 0 ? { x: ix / l, z: iz / l } : { x: 0, z: -1 };
    }
    const fa = Math.atan2(face.x, face.z);          // rotation.y that points +z at `face`
    // the shaft's own axes (it is square to the world): nd out through its
    // door, p across it (the ladder's wall and the hatch are on +p)
    let nd, p;
    if (ix || iz) {
      nd = ix ? { x: ix, z: 0 } : { x: 0, z: iz };
      p = ix && iz ? { x: 0, z: iz } : { x: -nd.z, z: nd.x };
    } else {
      nd = Math.abs(face.x) >= Math.abs(face.z) ? { x: Math.sign(face.x) || 1, z: 0 } : { x: 0, z: Math.sign(face.z) || 1 };
      p = { x: -nd.z, z: nd.x };
    }
    const at = (u, v) => ({ x: x + nd.x * u + p.x * v, z: z + nd.z * u + p.z * v });
    const sizeOf = (lu, lv) => ({ w: Math.abs(nd.x) * lu + Math.abs(p.x) * lv, d: Math.abs(nd.z) * lu + Math.abs(p.z) * lv });

    const steelDark = skin("steel", 0x3a4048), steelMid = skin("steel", 0x6c7580), steelRoof = skin("steel", 0x2c3138);
    const galv = skin("galv", 0xb4bcc4), grating = skin("grating", 0x8d949c), glass = skin("glass");
    const floorY = H + 0.25;

    const registered = opts.register !== false;
    const manned = opts.manned != null ? !!opts.manned : registered;
    if (registered) CBZ.towers.push({ x: x, z: z });
    const perim = opts.perimeter ? { x: opts.perimeter.x || 0, z: opts.perimeter.z || 0 } : null;
    const rec = {
      x: x, z: z, deck: H, floor: floorY, deckR: DECK_R, face: { x: face.x, z: face.z },
      registered: registered, manned: manned, perimeter: perim,
      wall: inw ? { x: wx, z: wz } : null,
      outward: (ix || iz) ? { x: -ix / Math.hypot(ix, iz), z: -iz / Math.hypot(ix, iz) } : null,
      ladder: null, hatch: null, rope: null,
    };
    towerRecs.push(rec);

    /* ---- THE SHAFT: four poured walls, hollow, a door at the foot ------- */
    // an apron slab round the foot (5 cm, drawn only: a step, not a wall)
    stat(new THREE.BoxGeometry(S + 0.8, 0.05, S + 0.8), skin("concrete", 0x9ea3a8), x, 0.025, z, { uv: 2, cast: false });
    function shaftWall(u, v, lu, lv, y0, y1) {
      const c = at(u, v), s = sizeOf(lu, lv);
      const m = addBox(c.x, (y0 + y1) / 2, c.z, s.w, y1 - y0, s.d, 0x9aa0a8, { solid: true, blockLOS: true, y0: y0, y1: y1 });
      skinBox(m, "concrete", 0xa9adb1);
      if (m.userData.collider) m.userData.collider.noBreach = true;
      return m;
    }
    shaftWall(-(hs - t / 2), 0, t, S, 0, H);                         // the back, against the wall
    shaftWall(0, hs - t / 2, S - 2 * t, t, 0, H);                    // +p: the ladder's wall
    shaftWall(0, -(hs - t / 2), S - 2 * t, t, 0, H);                 // -p
    // the door wall: a 1.1 m x 2.15 m opening, the leaf pinned back open
    const DV0 = -0.65, DV1 = 0.45, DH = 2.15;
    shaftWall(hs - t / 2, (-hs + DV0) / 2, t, DV0 + hs, 0, H);
    shaftWall(hs - t / 2, (DV1 + hs) / 2, t, hs - DV1, 0, H);
    {
      // the wall over the door: solid over its own band, from the door head
      // up (every walking body collides by band, so it clears the officer)
      const c = at(hs - t / 2, (DV0 + DV1) / 2), sz = sizeOf(t, DV1 - DV0);
      const m = addBox(c.x, (DH + H) / 2, c.z, sz.w, H - DH, sz.d, 0x9aa0a8, { blockLOS: true, solid: true, y0: DH, y1: H });
      if (m.userData.collider) m.userData.collider.noBreach = true;
      skinBox(m, "concrete", 0xa9adb1);
    }
    /* THE DOOR AT THE FOOT is the prison's one door kit (world/
       corridorkit.js): a detention-grade steel leaf in a steel frame,
       swinging OUT, locked on the Corridor Key (the post officer carries it
       up the ladder with him; a movement officer carries the other), a 5 lb
       charge blows it, staff open it. (corridorkit.js parses after this
       file and before any tower is built; without it the foot is an open
       doorway.) */
    {
      const CK = CBZ.corridorKit;
      const along = nd.x !== 0;                                  // the opening runs along z when the wall faces x
      const fixed = along ? x + nd.x * (hs - t / 2) : z + nd.z * (hs - t / 2);
      const e0 = along ? z + p.z * DV0 : x + p.x * DV0, e1 = along ? z + p.z * DV1 : x + p.x * DV1;
      const cfg = {
        id: "tower-" + towerRecs.length, label: "The tower door", axis: along ? "z" : "x",
        a0: Math.min(e0, e1), a1: Math.max(e0, e1), fixed: fixed, t: t, h: DH - 0.02,
        keys: ["Corridor Key"], lb: 5, hinge: 1, swing: along ? nd.x : -nd.z, autoShut: 5, staffR: 2.2,
      };
      if (CK && CK.door) {
        if (CK.detentionLeaf) cfg.build = CK.detentionLeaf({ color: 0x55606b });
        rec.shaftDoorRec = CK.door(cfg);
      }
      // a caged bulkhead lamp over the door, inside and out
      const lo = at(hs + 0.09, (DV0 + DV1) / 2), li = at(-(hs - t) + 0.08, 0), s5 = sizeOf(0.1, 0.2);
      stat(new THREE.BoxGeometry(s5.w, 0.14, s5.d), steelDark, lo.x, DH + 0.45, lo.z, { cast: false });
      stat(new THREE.BoxGeometry(s5.w, 0.14, s5.d), steelDark, li.x, 2.6, li.z, { cast: false });
    }
    rec.shaftDoor = at(hs + 0.9, (DV0 + DV1) / 2);

    /* ---- THE WAY UP: a rung ladder up the inside of the +p wall, through
       a hatch in the cab floor. Drawn and climbed off the same numbers
       (world/ladderkit.js -> systems/climb.js). */
    const LU = 0, LV = hs - t - 0.08;                               // the rung line, 8 cm off the wall
    const L0 = at(LU, LV);
    const hatchC = at(0, LV - 0.42);                                // the climber's column = the hatch's centre
    const topStand = at(0, LV - 0.42 - 0.95);                       // step off the hatch, into the cab
    const footStand = at(0.1, LV - 0.8);
    const spec = {
      x: L0.x, z: L0.z, nx: -p.x, nz: -p.z, y0: 0, y1: floorY, ext: 0, standoff: 0.08, cage: false,
      top: topStand, bottom: footStand, name: "tower", tag: "prison-tower", mode: "escape", meta: rec,
      onAdd: function (L) { rec.ladder = L; },
    };
    if (CBZ.ladderKit) {
      const built = CBZ.ladderKit.build(root(), spec);
      if (built.ladder) rec.ladder = built.ladder;
    } else if (CBZ.climb) spec.onAdd(CBZ.climb.add(spec));
    else (CBZ.ladderSpecs = CBZ.ladderSpecs || []).push(spec);
    rec.foot = footStand; rec.head = topStand;

    /* ---- THE DECK: an octagonal steel plate over the shaft and the wall,
       grating on top, knee braces under the overhang ---------------------- */
    const R = DECK_R;
    stat(new THREE.CylinderGeometry(R, R, 0.22, 8), steelDark, x, H + 0.11, z, { ry: Math.PI / 8 });
    stat(new THREE.CylinderGeometry(R - 0.05, R - 0.05, 0.03, 8), grating, x, H + 0.235, z, { ry: Math.PI / 8, uv: 1, cast: false });
    stat(new THREE.BoxGeometry(S + 0.3, 0.22, S + 0.3), steelDark, x, H - 0.4, z, { cast: false });   // the shaft's steel cap band
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4, ca = Math.cos(a), sa = Math.sin(a);
      if (rec.outward && ca * rec.outward.x + sa * rec.outward.z > 0.3) continue;   // that side is over the wall: the wall carries it
      const r0 = (Math.abs(ca) > 0.1 && Math.abs(sa) > 0.1 ? hs * Math.SQRT2 : hs) + 0.02;
      const r1 = R * Math.cos(Math.PI / 8) - 0.35;
      const len = Math.hypot(r1 - r0, 1.6), mid = (r0 + r1) / 2;
      const g = new THREE.BoxGeometry(0.12, len, 0.12);
      g.rotateZ(-Math.atan2(r1 - r0, 1.6));
      g.rotateY(-a);
      stat(g, steelDark, x + ca * mid, H - 0.85, z + sa * mid, { cast: false });
    }
    // THE FLOOR IS THE OCTAGON THAT IS DRAWN: four strips whose union is
    // exactly the plate (two on the axes, two on the diagonals as oriented
    // rectangles physics.js groundAt reads), not the 6.5 m square it was
    const a8 = R * Math.cos(Math.PI / 8), t8 = a8 * Math.tan(Math.PI / 8), u8 = Math.SQRT1_2;
    const plat = function (o) { o.top = floorY; o.tower = true; if (CBZ.platforms) CBZ.platforms.push(o); };
    plat({ minX: x - a8, maxX: x + a8, minZ: z - t8, maxZ: z + t8 });
    plat({ minX: x - t8, maxX: x + t8, minZ: z - a8, maxZ: z + a8 });
    for (const s of [1, -1]) {
      plat({ minX: x - a8, maxX: x + a8, minZ: z - a8, maxZ: z + a8, obb: { cx: x, cz: z, ux: u8, uz: s * u8, hl: a8, hw: t8 } });
    }
    if (CBZ.markPlatformsDirty) CBZ.markPlatformsDirty();

    // THE GUARDRAIL: posts at the eight corners, a top rail at 42 in, a mid
    // rail, a toe board. The collider IS that rail: from the plate to the top
    // of the top rail and not a centimetre more, so you walk up to it, lean
    // on it, and vault it (physics.js characterTraversal) — and on the other
    // side is twelve metres of air.
    const Rr = R - 0.12, railTop = floorY + RAIL_H;
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + i * Math.PI / 4;         // the vertices
      stat(new THREE.BoxGeometry(0.06, RAIL_H, 0.06), galv, x + Math.cos(a) * Rr, floorY + RAIL_H / 2, z + Math.sin(a) * Rr, { cast: false });
    }
    octRing(Rr, railTop - 0.025, 0.05, 0.05, galv, x, z, { cast: false });
    octRing(Rr, floorY + RAIL_H * 0.5, 0.04, 0.04, galv, x, z, { cast: false });
    octRing(Rr, floorY + 0.05, 0.1, 0.03, steelDark, x, z, { cast: false });
    for (let i = 0; i < 8; i++) {
      const a0 = Math.PI / 8 + i * Math.PI / 4, a1 = a0 + Math.PI / 4;
      segCol(x + Math.cos(a0) * Rr, z + Math.sin(a0) * Rr, x + Math.cos(a1) * Rr, z + Math.sin(a1) * Rr, H + 0.22, railTop, 0.04);
    }

    /* ---- THE CAB. Eight flat bays: a steel spandrel to the sill, glazing to
       the head, a mullion on every corner. The bay on `face` has the DOOR (a
       real opening, its leaf swung in against the next bay). The walls are
       colliders, so you go round on the catwalk and in through the door. */
    const Rc = CAB_R, fl = floorY, sill = fl + 1.0, head = sill + 1.35;
    const ra = Rc * Math.cos(Math.PI / 8), sl = 2 * Rc * Math.sin(Math.PI / 8);
    // the door is in the bay square to the shaft's door (+nd), never a
    // diagonal one: a doorway is a straight run of wall, not a staircase of
    // chopped colliders you cannot get your shoulders through
    const di = ((Math.round(Math.atan2(nd.z, nd.x) / (Math.PI / 4)) % 8) + 8) % 8;
    let doorAt = null;
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4, cx = Math.cos(a), cz = Math.sin(a), tx = -cz, tz = cx, ry = -a + Math.PI / 2;
      const mx = x + cx * ra, mz = z + cz * ra;
      if (i !== di) {
        stat(new THREE.BoxGeometry(sl, 1.0, 0.06), steelMid, mx, fl + 0.5, mz, { ry: ry });
        stat(new THREE.BoxGeometry(sl - 0.04, head - sill, 0.02), glass, mx, (sill + head) / 2, mz, { ry: ry, cast: false });
        segCol(mx - tx * sl / 2, mz - tz * sl / 2, mx + tx * sl / 2, mz + tz * sl / 2, fl - 0.05, head + 0.1, 0.04);
        continue;
      }
      // a 0.95 m door from the corner mullion (the hinge), a fixed glazed
      // panel in the rest of the bay (it was half a bay: 0.82 m less the
      // frame, narrower than a man's shoulders)
      const DW = 0.95, fw = sl - DW - 0.04, fc = sl / 2 - fw / 2;
      const hx = mx + tx * fc, hz = mz + tz * fc;
      stat(new THREE.BoxGeometry(fw, 1.0, 0.06), steelMid, hx, fl + 0.5, hz, { ry: ry });
      stat(new THREE.BoxGeometry(fw - 0.04, head - sill, 0.02), glass, hx, (sill + head) / 2, hz, { ry: ry, cast: false });
      segCol(mx + tx * (sl / 2 - fw), mz + tz * (sl / 2 - fw), mx + tx * sl / 2, mz + tz * sl / 2, fl - 0.05, head + 0.1, 0.04);
      const oc = -sl / 2 + DW / 2, ox = mx + tx * oc, oz = mz + tz * oc;
      stat(new THREE.BoxGeometry(DW, head + 0.05 - (fl + 2.08), 0.06), steelMid, ox, (fl + 2.08 + head + 0.05) / 2, oz, { ry: ry });
      const jx = mx + tx * (-sl / 2 + DW + 0.02), jz = mz + tz * (-sl / 2 + DW + 0.02);
      stat(new THREE.BoxGeometry(0.07, 2.08, 0.09), steelDark, jx, fl + 1.04, jz, { ry: ry, cast: false });   // the latch jamb
      // the leaf, swung in against the next bay, hung on the corner mullion:
      // drawn, so solid (it was a picture you walked through)
      const hgx = mx - tx * (sl / 2 - 0.05), hgz = mz - tz * (sl / 2 - 0.05);
      const lfx = hgx - cx * 0.45 + tx * 0.03, lfz = hgz - cz * 0.45 + tz * 0.03;
      stat(new THREE.BoxGeometry(0.9, 2.0, 0.045), steelMid, lfx, fl + 1.02, lfz, { ry: -a });
      stat(new THREE.BoxGeometry(0.5, 0.62, 0.05), glass, lfx, fl + 1.55, lfz, { ry: -a, cast: false });
      segCol(hgx + tx * 0.03, hgz + tz * 0.03, hgx - cx * 0.9 + tx * 0.03, hgz - cz * 0.9 + tz * 0.03, fl, fl + 2.02, 0.03);
      doorAt = { x: ox + cx * 0.55, z: oz + cz * 0.55, in: { x: ox - cx * 0.6, z: oz - cz * 0.6 } };
    }
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + i * Math.PI / 4;
      stat(new THREE.BoxGeometry(0.09, head - fl + 0.1, 0.09), steelDark, x + Math.cos(a) * Rc, (fl + head) / 2, z + Math.sin(a) * Rc, { ry: -a, cast: false });
    }
    stat(new THREE.CylinderGeometry(Rc, Rc, 0.03, 8), steelDark, x, fl - 0.01, z, { ry: Math.PI / 8, cast: false });   // the cab floor, flush with the catwalk
    octRing(Rc + 0.05, sill, 0.10, 0.14, steelDark, x, z, { cast: false, skip: di });
    octRing(Rc + 0.05, head + 0.05, 0.14, 0.14, steelDark, x, z, { cast: false });
    rec.door = doorAt;

    /* ---- THE HATCH: a steel lid in the cab floor over the ladder, hinged on
       the +p edge. entities/towerwatch.js swings it up while somebody is on
       the top of the ladder and drops it shut after them, so the floor you
       walk on is the lid that is drawn. */
    {
      const HS = 0.8;
      const hinge = at(0, LV - 0.42 + HS / 2);
      const pivot = new THREE.Group();
      pivot.position.set(hinge.x, fl + 0.02, hinge.z);
      pivot.userData.mover = true;
      const lid = new THREE.Mesh(new THREE.BoxGeometry(HS, 0.03, HS), skin("grating", 0x6b737c));
      lid.position.set(-p.x * HS / 2, 0, -p.z * HS / 2);
      lid.userData.mover = true; lid.castShadow = false; lid.receiveShadow = true;
      const grip = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(nd.x) * 0.22 + 0.03, 0.04, Math.abs(nd.z) * 0.22 + 0.03), steelDark);
      grip.position.set(-p.x * (HS - 0.08), 0.03, -p.z * (HS - 0.08));
      grip.userData.mover = true;
      pivot.add(lid); pivot.add(grip);
      root().add(pivot);
      const hole = new THREE.Mesh(new THREE.BoxGeometry(HS - 0.06, 0.004, HS - 0.06), new THREE.MeshBasicMaterial({ color: 0x050607 }));
      hole.position.set(hatchC.x, fl + 0.008, hatchC.z);
      hole.visible = false; hole.userData.mover = true;
      root().add(hole);
      const cs = sizeOf(0.05, HS + 0.1), cs2 = sizeOf(HS, 0.05);
      for (const s of [-1, 1]) {
        const e1 = at(s * (HS / 2 + 0.025), LV - 0.42), e2 = at(0, LV - 0.42 + s * (HS / 2 + 0.025));
        stat(new THREE.BoxGeometry(cs.w, 0.03, cs.d), steelDark, e1.x, fl + 0.015, e1.z, { cast: false });
        stat(new THREE.BoxGeometry(cs2.w, 0.03, cs2.d), steelDark, e2.x, fl + 0.015, e2.z, { cast: false });
      }
      // open about the hinge line (nd): +angle lifts the free edge if nd x p points down
      const sign = (nd.x * p.z - nd.z * p.x) >= 0 ? 1 : -1;
      rec.hatch = { pivot: pivot, hole: hole, axis: new THREE.Vector3(nd.x, 0, nd.z), sign: sign, open: 0, x: hatchC.x, z: hatchC.z };
    }

    /* ---- INSIDE THE CAB: the console on the back bay (base station and its
       whip, the handset, the log), the post chair, the rifle rack. Each is
       drawn and each is solid, at its own height. */
    {
      const kc = at(-(ra - 0.34), 0), ks = sizeOf(0.55, 1.3);
      stat(new THREE.BoxGeometry(ks.w + 0.02, 0.05, ks.d + 0.02), steelMid, kc.x, fl + 0.765, kc.z, {});
      stat(new THREE.BoxGeometry(ks.w - 0.04, 0.7, ks.d - 0.04), steelDark, kc.x, fl + 0.4, kc.z, {});
      CBZ.colliders.push({ minX: kc.x - ks.w / 2, maxX: kc.x + ks.w / 2, minZ: kc.z - ks.d / 2, maxZ: kc.z + ks.d / 2, y0: fl, y1: fl + 0.79, noBreach: true });
      const rb = at(-(ra - 0.3), 0.3), rs = sizeOf(0.2, 0.3);
      stat(new THREE.BoxGeometry(rs.w, 0.1, rs.d), steelDark, rb.x, fl + 0.84, rb.z, { cast: false });      // the base station
      stat(new THREE.CylinderGeometry(0.008, 0.012, 0.32, 5), steelDark, rb.x, fl + 1.05, rb.z, { cast: false });
      const hs2 = at(-(ra - 0.36), -0.1), hz = sizeOf(0.08, 0.2);
      stat(new THREE.BoxGeometry(hz.w, 0.05, hz.d), steelDark, hs2.x, fl + 0.815, hs2.z, { cast: false }); // the handset
      const lg = at(-(ra - 0.42), -0.4), lz = sizeOf(0.24, 0.34);
      stat(new THREE.BoxGeometry(lz.w, 0.012, lz.d), skin("steel", 0xd9d4c4, 0.9), lg.x, fl + 0.796, lg.z, { cast: false });   // the log
      // the chair: five-star base, gas column, seat, back
      const ch = at(-(ra - 1.05), -0.35);
      stat(new THREE.CylinderGeometry(0.25, 0.27, 0.04, 5), steelDark, ch.x, fl + 0.05, ch.z, { cast: false });
      stat(new THREE.CylinderGeometry(0.03, 0.03, 0.38, 6), galv, ch.x, fl + 0.26, ch.z, { cast: false });
      stat(new THREE.BoxGeometry(0.46, 0.08, 0.46), skin("steel", 0x23272c), ch.x, fl + 0.48, ch.z, { ry: fa, cast: false });
      const bk = at(-(ra - 1.05) + 0.22, -0.35);
      const bs = sizeOf(0.06, 0.44);
      stat(new THREE.BoxGeometry(bs.w, 0.5, bs.d), skin("steel", 0x23272c), bk.x, fl + 0.8, bk.z, { cast: false });
      CBZ.colliders.push({ minX: ch.x - 0.24, maxX: ch.x + 0.24, minZ: ch.z - 0.24, maxZ: ch.z + 0.24, y0: fl, y1: fl + 1.05, noBreach: true });
      // the rifle rack on the -p spandrel: a steel frame, two carbines stood in it
      const rk = at(0.1, -(ra - 0.16)), rks = sizeOf(0.7, 0.16);
      stat(new THREE.BoxGeometry(rks.w, 0.06, rks.d), steelDark, rk.x, fl + 0.04, rk.z, { cast: false });
      stat(new THREE.BoxGeometry(rks.w, 0.05, rks.d), steelDark, rk.x, fl + 0.95, rk.z, { cast: false });
      for (const s of [-1, 1]) {
        const up = at(0.1 + s * 0.33, -(ra - 0.16)), us = sizeOf(0.04, 0.16);
        stat(new THREE.BoxGeometry(us.w, 1.0, us.d), steelDark, up.x, fl + 0.5, up.z, { cast: false });
        const gun = at(0.1 + s * 0.14, -(ra - 0.14)), gs = sizeOf(0.06, 0.05);
        stat(new THREE.BoxGeometry(gs.w, 0.9, gs.d), skin("steel", 0x1c1f23), gun.x, fl + 0.5, gun.z, { cast: false });
      }
      CBZ.colliders.push({ minX: rk.x - rks.w / 2, maxX: rk.x + rks.w / 2, minZ: rk.z - rks.d / 2, maxZ: rk.z + rks.d / 2, y0: fl, y1: fl + 1.0, noBreach: true });
    }
    // where the officer stands his post: forward in the cab, on the yard glass
    rec.post = { x: x + face.x * 0.6, z: z + face.z * 0.6, yaw: Math.atan2(face.x, face.z) };

    /* ---- THE ROOF: an octagonal hip over the catwalk, a fascia, the apex
       pedestal the searchlight (entities/searchlight.js) stands on at
       CBZ.towerHeadY, a lightning rod clamped to a hip. */
    const Rf = R + 0.1, eave = head + 0.12;
    stat(new THREE.ConeGeometry(Rf, 1.15, 8), steelRoof, x, eave + 0.575, z, { ry: Math.PI / 8 });
    octRing(Rf, eave - 0.09, 0.2, 0.06, steelDark, x, z, { cast: false });
    stat(new THREE.CylinderGeometry(0.17, 0.24, 0.62, 12), steelDark, x, eave + 1.15 + 0.17, z, { cast: false });
    stat(new THREE.CylinderGeometry(0.27, 0.27, 0.04, 16), steelDark, x, eave + 1.15 + 0.48, z, { cast: false });
    // the roof is held up by the cab's corner mullions: carry four of them on
    // out to the eave as posts, so the overhang is not hanging off nothing
    for (let i = 0; i < 8; i += 2) {
      const a = Math.PI / 8 + i * Math.PI / 4;
      stat(new THREE.BoxGeometry(0.07, eave - railTop, 0.07), steelDark, x + Math.cos(a) * Rr, (railTop + eave) / 2, z + Math.sin(a) * Rr, { cast: false });
    }
    {
      const back = Math.round((Math.atan2(-face.x, -face.z) - Math.PI / 8) / (Math.PI / 4));
      const ha = Math.PI / 8 + back * Math.PI / 4;
      const tt = 0.8, hr = Rf * tt, hy = eave + 1.15 * (1 - tt);
      const rx = x + Math.sin(ha) * hr, rz = z + Math.cos(ha) * hr;
      stat(new THREE.CylinderGeometry(0.012, 0.016, 1.25, 6), galv, rx, hy + 0.6, rz, { cast: false });
      stat(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 8), steelDark, rx, hy + 0.04, rz, { cast: false });
    }
    // an under-eave floodlight aimed at the compound, its lens flush on the
    // pitched housing's face
    const hx0 = x + face.x * (Rf - 0.5), hz0 = z + face.z * (Rf - 0.5), hy0 = eave - 0.35;
    stat(new THREE.BoxGeometry(0.62, 0.30, 0.42), steelDark, hx0, hy0, hz0, { ry: fa, rx: 0.45, cast: false });
    stat(new THREE.BoxGeometry(0.08, 0.3, 0.08), steelDark, hx0, eave - 0.1, hz0, { cast: false });
    const lamp = addBox(hx0 + face.x * 0.225 * Math.cos(0.45), hy0 - 0.225 * Math.sin(0.45), hz0 + face.z * 0.225 * Math.cos(0.45), 0.54, 0.24, 0.02, 0x2b2b2b, { cast: false });
    lamp.rotation.order = "YXZ"; lamp.rotation.y = fa; lamp.rotation.x = 0.45;
    lamp.userData.mover = true;
    const fix = { x: x + face.x * 6, z: z + face.z * 6, r: 15, kind: "flood", mesh: lamp, color: 0xfff4d2, emissive: 0xffd88a, off: 0x2b2b2b };
    if (CBZ.prisonLights && CBZ.prisonLights.register) { try { CBZ.prisonLights.register(fix); } catch (e) {} }
    else (CBZ._prisonLateFixtures || (CBZ._prisonLateFixtures = [])).push(fix);

    return { x: x, z: z, deck: H, headY: eave + 1.15 + 0.5, rec: rec };
  }
  // where entities/searchlight.js mounts its lamp: on the finial, over the roof
  CBZ.towerHeadY = TOWER_DECK + 0.25 + 1.0 + 1.35 + 0.12 + 1.15 + 0.5;
  CBZ.TOWER_DECK = TOWER_DECK;
  CBZ.guardTower = guardTower;
  CBZ.prisonTowers = towerRecs;   // entities/towerwatch.js posts an officer on each manned one
  // the tower whose catwalk (x, z, y) is on, or null (towerwatch.js, capture.js)
  CBZ.prisonTowerAt = function (x, z, y, pad) {
    for (let i = 0; i < towerRecs.length; i++) {
      const T = towerRecs[i];
      if (y != null && (y < T.floor - 0.6 || y > T.floor + 3)) continue;
      if (Math.hypot(x - T.x, z - T.z) < T.deckR + (pad || 0)) return T;
    }
    return null;
  };

  /* ==========================================================
     6. CHAIN-LINK FENCE.
        run: { x0, z0, x1, z1, h, razor, gates: [{ at, w, open, solid }],
               solid (default true), noCollide }
        `at` is metres along the run from (x0,z0). An open gate is two
        swung leaves and a gap; a shut gate is a leaf and a collider.
     ========================================================== */
  let fenceM = 0;
  const fenceRuns = [];
  function fence(run) {
    const x0 = run.x0, z0 = run.z0, x1 = run.x1, z1 = run.z1;
    const dx = x1 - x0, dz = z1 - z0, len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.3) return null;
    const ux = dx / len, uz = dz / len, nx = -uz, nz = ux;
    const h = run.h || 3.6, ang = -Math.atan2(dz, dx);
    const mesh = skin("chainlink", 0xb9c0c7), galv = skin("galv", 0xb4bcc4), steel = skin("steel", 0x3a4048);
    const coil = skin("galv", 0xd8dde3);
    const gates = (run.gates || []).slice().sort((a, b) => a.at - b.at);
    const solid = run.solid !== false;
    fenceRuns.push({ x0, z0, x1, z1, len });

    // the pieces between gates
    const segs = [];
    let cur = 0;
    for (const g of gates) {
      const a = Math.max(0, g.at - g.w / 2), b = Math.min(len, g.at + g.w / 2);
      if (a > cur + 0.05) segs.push([cur, a]);
      cur = Math.max(cur, b);
    }
    if (cur < len - 0.05) segs.push([cur, len]);

    for (const s of segs) {
      const a = s[0], b = s[1], L = b - a;
      const cx = x0 + ux * (a + b) / 2, cz = z0 + uz * (a + b) / 2;
      // the mesh panel, world-metre UVs so the diamonds are 50 mm everywhere
      const panel = new THREE.PlaneGeometry(L, h - 0.05);
      panel.rotateY(ang + 0);
      panel.translate(cx, (h - 0.05) / 2 + 0.05, cz);
      // rotate then translate by hand so the UV pass sees world coordinates
      const uv = panel.attributes.uv, pos = panel.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const px = pos.getX(i), pz = pos.getZ(i);
        uv.setXY(i, ((px - x0) * ux + (pz - z0) * uz) / 2, pos.getY(i) / 2);
      }
      stat(panel, mesh, 0, 0, 0, { cast: false });
      // posts every 3 m, a top rail, a bottom tension wire
      const n = Math.max(1, Math.round(L / 3));
      for (let i = 0; i <= n; i++) {
        const t = a + (L * i) / n;
        stat(new THREE.CylinderGeometry(0.045, 0.045, h + 0.1, 6), galv, x0 + ux * t, (h + 0.1) / 2, z0 + uz * t, { cast: i % 2 === 0 });
      }
      stat(new THREE.CylinderGeometry(0.025, 0.025, L, 5), galv, cx, h - 0.02, cz, { rz: Math.PI / 2, ry: ang, cast: false });
      stat(new THREE.CylinderGeometry(0.012, 0.012, L, 4), galv, cx, 0.06, cz, { rz: Math.PI / 2, ry: ang, cast: false });
      if (run.razor !== false) {
        // three outriggers' worth of coil: one on top, canted arms every 3 m
        coilRun(x0 + ux * a, z0 + uz * a, x0 + ux * b, z0 + uz * b, h + 0.36, 0.36, coil);
        for (let i = 0; i <= n; i++) {
          const t = a + (L * i) / n;
          stat(new THREE.BoxGeometry(0.04, 0.7, 0.04), galv, x0 + ux * t, h + 0.3, z0 + uz * t, { cast: false });
        }
      }
      if (solid && !run.noCollide) {
        // axis-aligned AABBs 0.16 m thick; a diagonal run is chopped
        const pieces = Math.abs(ux) > 0.99 || Math.abs(uz) > 0.99 ? 1 : Math.max(1, Math.ceil(L / 2));
        for (let i = 0; i < pieces; i++) {
          const ta = a + (L * i) / pieces, tb = a + (L * (i + 1)) / pieces;
          const ax = x0 + ux * ta, az = z0 + uz * ta, bx = x0 + ux * tb, bz = z0 + uz * tb;
          CBZ.colliders.push({
            minX: Math.min(ax, bx) - 0.08, maxX: Math.max(ax, bx) + 0.08,
            minZ: Math.min(az, bz) - 0.08, maxZ: Math.max(az, bz) + 0.08,
            fence: true, noBreach: true,
          });
        }
      }
    }
    // gates
    for (const g of gates) {
      const a = Math.max(0, g.at - g.w / 2), b = Math.min(len, g.at + g.w / 2);
      const L = b - a;
      for (const t of [a, b]) stat(new THREE.CylinderGeometry(0.07, 0.07, h + 0.4, 8), steel, x0 + ux * t, (h + 0.4) / 2, z0 + uz * t, {});
      const leaf = function (t0, L2, swing) {
        // a framed leaf hinged at t0, swung `swing` radians off the run line
        const hx = x0 + ux * t0, hz = z0 + uz * t0;
        const ca = Math.cos(swing), sa = Math.sin(swing);
        const lx = ux * ca + nx * sa, lz = uz * ca + nz * sa;      // leaf direction
        const cx = hx + lx * L2 / 2, cz = hz + lz * L2 / 2, la = -Math.atan2(lz, lx);
        const lh = h - 0.2;
        stat(new THREE.BoxGeometry(L2, 0.07, 0.07), steel, cx, lh, cz, { ry: la, cast: false });
        stat(new THREE.BoxGeometry(L2, 0.07, 0.07), steel, cx, 0.12, cz, { ry: la, cast: false });
        stat(new THREE.BoxGeometry(0.07, lh, 0.07), steel, hx + lx * (L2 - 0.04), lh / 2 + 0.08, hz + lz * (L2 - 0.04), { cast: false });
        const p = new THREE.PlaneGeometry(L2 - 0.1, lh - 0.2);
        p.rotateY(la); p.translate(cx, lh / 2 + 0.1, cz);
        const uv = p.attributes.uv, pos = p.attributes.position;
        for (let i = 0; i < pos.count; i++) uv.setXY(i, ((pos.getX(i) - hx) * lx + (pos.getZ(i) - hz) * lz) / 2, pos.getY(i) / 2);
        stat(p, mesh, 0, 0, 0, { cast: false });
        return { x: cx, z: cz };
      };
      if (g.open) {
        leaf(a, L / 2 - 0.05, 1.75 * (g.side || 1));
        leaf(b, L / 2 - 0.05, Math.PI - 1.75 * (g.side || 1));
      } else {
        leaf(a, L - 0.05, 0);
        if (solid && !run.noCollide) {
          const ax = x0 + ux * a, az = z0 + uz * a, bx = x0 + ux * b, bz = z0 + uz * b;
          CBZ.colliders.push({
            minX: Math.min(ax, bx) - 0.08, maxX: Math.max(ax, bx) + 0.08,
            minZ: Math.min(az, bz) - 0.08, maxZ: Math.max(az, bz) + 0.08,
            fence: true, gate: true, noBreach: true,
          });
        }
        if (g.sign) signPlate(g.sign, x0 + ux * g.at + nx * 0.1, 1.55, z0 + uz * g.at + nz * 0.1, 1.2, 0.36, ang, "#f3f3ef", "#b3261e");
      }
    }
    fenceM += len;
    return run;
  }
  CBZ.prisonFence = fence;

  // a printed plate: text on a coloured board, facing +z before `ry`
  function signPlate(text, x, y, z, w, h, ry, fg, bg) {
    const c = document.createElement("canvas");
    c.width = 512; c.height = Math.max(64, Math.round(512 * h / w));
    const g = c.getContext("2d");
    g.fillStyle = bg || "#b3261e"; g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = "rgba(255,255,255,.7)"; g.lineWidth = 8; g.strokeRect(6, 6, c.width - 12, c.height - 12);
    g.fillStyle = fg || "#f3f3ef";
    g.textAlign = "center"; g.textBaseline = "middle";
    const lines = String(text).split("\n");
    let size = Math.round(c.height * (lines.length > 1 ? 0.36 : 0.44));
    for (;;) {
      g.font = "700 " + size + "px Arial, Helvetica, sans-serif";
      const widest = Math.max.apply(null, lines.map((ln) => g.measureText(ln).width));
      if (widest <= c.width * 0.9 || size <= 12) break;
      size -= 2;
    }
    lines.forEach((ln, i) => g.fillText(ln, c.width / 2, c.height / 2 + (i - (lines.length - 1) / 2) * c.height * 0.46));
    const t = new THREE.CanvasTexture(c);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: t, side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.rotation.y = ry || 0;
    m.userData.sign = true;
    root().add(m);
    return m;
  }
  CBZ.prisonSign = signPlate;

  /* ==========================================================
     7. FLOODLIGHT MAST. 18 m, four heads on a crossarm, on the flood
        circuit (strikes at dusk, systems/prisonnight.js).
     ========================================================== */
  let masts = 0;
  function floodMast(x, z, h, aim) {
    h = h || 18;
    const galv = skin("galv", 0xb4bcc4), concrete = skin("concrete", 0x9ea3a8), dark = skin("steel", 0x3a4048);
    aim = aim || { x: 0, z: 1 };
    const fa = Math.atan2(aim.x, aim.z);
    const ax = Math.sin(fa), az = Math.cos(fa);            // the unit aim (callers pass 0.7, 0.7)
    stat(new THREE.BoxGeometry(1.0, 0.5, 1.0), concrete, x, 0.25, z, {});
    stat(new THREE.CylinderGeometry(0.11, 0.22, h, 8), galv, x, h / 2 + 0.5, z, {});
    stat(new THREE.BoxGeometry(2.8, 0.14, 0.14), dark, x, h + 0.3, z, { ry: fa + Math.PI / 2, cast: false });
    /* THE HEADS. Each is a pitched housing on a knuckle bolted under the
       crossarm, with its lens FLUSH on the housing's pitched face. The lens
       used to be a separate box turned with the mesh's default XYZ Euler
       (world-X pitch after the yaw): on every mast aimed along x that rolled
       it sideways out of its housing, so at night each head was a lit block
       hanging in the air beside the fitting it belonged to. */
    const P = 0.55, D = 0.25 + 0.012;                      // pitch, centre-to-lens
    const heads = [];
    for (let i = 0; i < 4; i++) {
      const s = (i - 1.5) * 0.7;
      const hx = x + Math.cos(fa) * s, hz = z - Math.sin(fa) * s;
      stat(new THREE.BoxGeometry(0.1, 0.12, 0.1), dark, hx, h + 0.2, hz, { cast: false });                 // knuckle
      stat(new THREE.BoxGeometry(0.5, 0.34, 0.5), dark, hx, h + 0.0, hz, { ry: fa, rx: P, cast: false });
      const lamp = addBox(hx + ax * D * Math.cos(P), h - D * Math.sin(P), hz + az * D * Math.cos(P), 0.42, 0.28, 0.02, 0x2b2b2b, { cast: false });
      lamp.rotation.order = "YXZ"; lamp.rotation.y = fa; lamp.rotation.x = P;
      lamp.userData.mover = true;
      heads.push(lamp);
    }
    const rec = { x: x + aim.x * 8, z: z + aim.z * 8, r: 22, kind: "flood", mesh: heads[0], color: 0xfff4d2, emissive: 0xffd88a, off: 0x2b2b2b };
    if (CBZ.prisonLights && CBZ.prisonLights.register) { try { CBZ.prisonLights.register(rec); } catch (e) {} }
    else (CBZ._prisonLateFixtures || (CBZ._prisonLateFixtures = [])).push(rec);
    // the other three heads follow the first's material
    for (let i = 1; i < heads.length; i++) heads[i].material = heads[0].material;
    if (CBZ.colliders) CBZ.colliders.push({ minX: x - 0.3, maxX: x + 0.3, minZ: z - 0.3, maxZ: z + 0.3, mast: true, noBreach: true });
    masts++;
    return rec;
  }
  CBZ.floodMast = floodMast;

  /* ==========================================================
     8. GROUND. A patch of asphalt, turf or concrete through the shared
        institutional-ground author (world/materials.js prisonGroundTex).
        `program` names what the patch is for; the audit sums it.
     ========================================================== */
  const programs = [];
  // THE ONE GROUND-LAYER RULE, shared by every flat patch in the prison
  // (world/ground.js's base/yard/walkway, world/southblock.js's apron, path
  // and court, and ground() below). Lower patch => pushed further back, so
  // two patches that overlap never fight for a pixel at any distance, and
  // nothing ever gets pulled FORWARD over the paint and props standing on it.
  // y 0.03 -> 5, 0.02 -> 7, 0.012 -> 9, 0 -> 11, -0.02 -> 15.
  function groundLayer(mat, y) {
    const back = Math.max(1, 9 - Math.round((y - 0.011) / 0.005));
    mat.polygonOffset = true; mat.polygonOffsetFactor = back; mat.polygonOffsetUnits = 2 * back;
    return mat;
  }
  CBZ.groundLayer = groundLayer;
  function ground(x, z, w, d, kind, o) {
    o = o || {};
    let tex = null;
    // outdoor paving tones are sRGB (tagged below); turf keeps the untagged path
    const kinds = { asphalt: ["#4e5257", "#474b50"], turf: ["#6f8a4a", "#5d7a3e"], concrete: ["#8e908b", "#858782"], gravel: ["#8a857a", "#7d786e"], track: ["#8a4d3d", "#7a4335"] };
    const gk = kind === "turf" ? "yard-grass" : kind === "track" || kind === "gravel" ? "asphalt" : kind;
    const ab = kinds[kind] || kinds.concrete;
    // every outdoor paving tone is authored sRGB; only turf keeps the untagged path
    if (CBZ.prisonGroundTex) tex = CBZ.prisonGroundTex(gk, { a: o.a || ab[0], b: o.b || ab[1], srgb: kind !== "turf" });
    else if (CBZ.checkerTex) tex = CBZ.checkerTex(ab[0], ab[1], 2);
    if (!tex) return null;
    // A 6.3 m tile. A side SHORTER than one tile takes a fraction of it
    // (a 2.8 m path shows 0.44 of a tile across, not a whole tile squeezed
    // into it), so a narrow strip is never stretched along its length.
    const rep = (s) => (s < 6.3 ? s / 6.3 : Math.round(s / 6.3));
    tex.repeat.set(rep(w), rep(d));
    /* LAYERS. Patches lie on patches (a court on the turf, a pad on the
       yard, all on the wing slab) a centimetre apart, which the depth
       buffer cannot separate at 100 m: they shimmered through each other.
       The height still orders them up close; a polygon offset per
       centimetre of it orders them at every distance. The offset only ever
       pushes BACK (lower patches further), so paint and props standing on
       a patch are never overdrawn by it. */
    const y = o.y != null ? o.y : 0.02;
    const mat = groundLayer(new THREE.MeshLambertMaterial({ map: tex }), y);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    m.rotation.x = -Math.PI / 2; m.position.set(x, y, z);
    m.receiveShadow = true;
    m.userData.ground = kind;
    root().add(m);
    if (o.program) programs.push({ id: o.program, x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, m2: w * d });
    return m;
  }
  CBZ.prisonGround = ground;
  // a painted line on the ground: FLUSH paint, 4 mm thick with its top 5 mm
  // over a ground() patch (y 0.02). It was 12 mm thick with its top at 5 cm,
  // which from eye height is a raised curb. Colours are worn, never tin-fresh.
  function paint(x, z, w, d, color, y) {
    const c = new THREE.Color(color != null ? color : 0xe9e9e4);
    const g = (c.r + c.g + c.b) / 3;
    c.setRGB((c.r * 0.7 + g * 0.3) * 0.84, (c.g * 0.7 + g * 0.3) * 0.84, (c.b * 0.7 + g * 0.3) * 0.84);
    return addBox(x, y != null ? y : 0.023, z, w, 0.004, d, c.getHex(), { cast: false });
  }
  CBZ.prisonPaint = paint;
  function program(id, x0, x1, z0, z1) { programs.push({ id, x0, x1, z0, z1, m2: (x1 - x0) * (z1 - z0) }); }

  /* ==========================================================
     8b. YARD KIT. The real objects the compound's yards are furnished
        with, shared by world/prisongrounds.js, world/props.js and
        world/yardfurniture.js so there is ONE picnic table, ONE hoop and
        ONE canopy in the prison, not a box stand-in per file. Everything is
        stat()-merged; the caller owns the collider.
     ========================================================== */
  // a tube between two points (a leg, a brace, a rail)
  const _ya = new THREE.Vector3(), _yb = new THREE.Vector3(), _yd = new THREE.Vector3(), _yq = new THREE.Quaternion(), _ym = new THREE.Matrix4(), _yup = new THREE.Vector3(0, 1, 0);
  function tube(ax, ay, az, bx, by, bz, r, mat, o) {
    _ya.set(ax, ay, az); _yb.set(bx, by, bz); _yd.subVectors(_yb, _ya);
    const len = _yd.length();
    if (len < 1e-4) return null;
    const g = new THREE.CylinderGeometry(r, r, len, (o && o.seg) || 8, 1, !!(o && o.open));
    _yq.setFromUnitVectors(_yup, _yd.normalize());
    g.applyMatrix4(_ym.makeRotationFromQuaternion(_yq));      // r128 geometry has no applyQuaternion
    return stat(g, mat, (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, { cast: o ? o.cast : undefined });
  }
  // a box in a frame rotated `ry` about (x, z); local (lx, y, lz)
  function rbox(x, z, ry, lx, y, lz, w, h, d, mat, o) {
    const c = Math.cos(ry), s = Math.sin(ry);
    return stat(new THREE.BoxGeometry(w, h, d), mat, x + lx * c + lz * s, y, z - lx * s + lz * c, Object.assign({ ry: ry }, o || {}));
  }
  function rtube(x, z, ry, a, b, r, mat, o) {
    const c = Math.cos(ry), s = Math.sin(ry);
    return tube(x + a[0] * c + a[2] * s, a[1], z - a[0] * s + a[2] * c, x + b[0] * c + b[2] * s, b[1], z - b[0] * s + b[2] * c, r, mat, o);
  }

  /* THE PICNIC TABLE. A 1.8 m galvanised walk-through table: three top
     planks with a gap between them, two bench planks a side, and at each
     end the A-frame of round tube it all stands on, with the cross-bar the
     benches bolt to. Top 0.76 m, seats 0.45 m. `ry` turns it. */
  function picnicTable(x, z, ry, o) {
    o = o || {};
    ry = ry || 0;
    const top = skin("steel", o.tone != null ? o.tone : 0x55705f), frame = skin("galv", 0xb4bcc4);
    for (let i = -1; i <= 1; i++) rbox(x, z, ry, 0, 0.74, i * 0.25, 1.8, 0.04, 0.235, top, { cast: i === 0 });
    for (const s of [-1, 1]) for (const k of [0, 1]) rbox(x, z, ry, 0, 0.43, s * (0.56 + k * 0.15), 1.8, 0.04, 0.135, top, { cast: false });
    for (const e of [-0.68, 0.68]) {
      for (const s of [-1, 1]) rtube(x, z, ry, [e, 0.0, s * 0.72], [e, 0.72, s * 0.18], 0.024, frame, { cast: false });
      rtube(x, z, ry, [e, 0.40, -0.8], [e, 0.40, 0.8], 0.02, frame, { cast: false });      // the bench bar
      rtube(x, z, ry, [e, 0.71, -0.36], [e, 0.71, 0.36], 0.02, frame, { cast: false });    // the top bar
    }
    rtube(x, z, ry, [-0.68, 0.40, 0], [0.68, 0.40, 0], 0.018, frame, { cast: false });      // the stretcher
  }

  /* THE HOOP. An in-ground gooseneck, built the way the real ones are:
     a square steel post on a base plate with a wrap-around safety pad, a
     bent gooseneck arm over the top and a lower support strut, both landing
     on a mounting frame behind the board. A 1.83 x 1.07 board with an
     aluminium edge, its border and shooter's square painted on at the FIBA
     place (the square's bottom edge level with the rim), an orange 45 cm rim
     on a bracket, and a corded net: twelve strands each way hung from the
     rim's hooks and crossing into diamonds down to a tapered bottom ring.
     Pole at (px, pz); the board faces `f` (the unit direction into the
     court) with its face `reach` m out from the pole. */
  const NET_CORD = [];                              // twelve + twelve strand paths, built once
  function netStrands() {
    if (NET_CORD.length) return NET_CORD;
    const N = 12, R0 = 0.215, R1 = 0.13, H = 0.42, TW = Math.PI / N;
    for (const dir of [-1, 1]) for (let i = 0; i < N; i++) {
      const pts = [];
      for (let k = 0; k <= 4; k++) {
        const t = k / 4, a = (i / N) * Math.PI * 2 + dir * t * TW * 2;
        const r = R0 + (R1 - R0) * t - Math.sin(t * Math.PI) * 0.012;   // a slight belly
        pts.push(new THREE.Vector3(Math.cos(a) * r, -t * H, Math.sin(a) * r));
      }
      NET_CORD.push(pts);
    }
    return NET_CORD;
  }
  function hoop(px, pz, fx, fz, o) {
    o = o || {};
    const ry = Math.atan2(fx, fz);                // local +z = into the court
    const post = skin("steel", 0x2f3540), white = skin("steel", 0xeceeea, 0.35), line = skin("steel", 0x1f2f55, 0.45);
    const orange = skin("steel", 0xd9561c, 0.4), edge = skin("galv", 0xc9ced3), pad = skin("steel", 0x1d2a44, 0.85);
    const cord = skin("steel", 0xf1f0ea, 0.95), plate = skin("galv", 0x9aa1a8);
    const rimY = o.rimY || 3.05, boardZ = o.reach || 1.2;
    const bY = rimY - 0.15 + 0.535;               // board centre: its bottom edge 15 cm under the rim
    const topY = rimY + 0.2;                      // the post's cap
    // base plate, square post, cap, safety pad
    rbox(px, pz, ry, 0, 0.01, 0, 0.42, 0.02, 0.42, plate, { cast: false });
    rbox(px, pz, ry, 0, topY / 2, 0, 0.15, topY, 0.15, post, {});
    rbox(px, pz, ry, 0, topY + 0.01, 0, 0.17, 0.02, 0.17, post, { cast: false });
    rbox(px, pz, ry, 0, 0.1 + 0.9, 0, 0.27, 1.8, 0.27, pad, {});
    // the gooseneck: up off the post, over, and down onto the board frame
    const g = new THREE.CubicBezierCurve3(
      new THREE.Vector3(0, topY - 0.25, 0), new THREE.Vector3(0, topY + 0.45, 0.02),
      new THREE.Vector3(0, bY + 0.55, boardZ * 0.55), new THREE.Vector3(0, bY + 0.12, boardZ - 0.12));
    const gg = new THREE.TubeGeometry(g, 14, 0.06, 8, false);
    stat(gg, post, px, 0, pz, { ry: ry });
    rtube(px, pz, ry, [0, topY - 0.9, 0.07], [0, bY - 0.3, boardZ - 0.12], 0.035, post, { cast: false });   // support strut
    // the mounting frame behind the board
    rbox(px, pz, ry, 0, bY - 0.05, boardZ - 0.08, 0.62, 0.62, 0.06, post, { cast: false });
    for (const s of [-1, 1]) rbox(px, pz, ry, s * 0.3, bY - 0.05, boardZ - 0.1, 0.05, 0.9, 0.05, post, { cast: false });
    // the board: a painted panel in an aluminium edge
    rbox(px, pz, ry, 0, bY, boardZ, 1.8, 1.04, 0.035, white, {});
    for (const s of [-1, 1]) {
      rbox(px, pz, ry, s * 0.905, bY, boardZ, 0.03, 1.07, 0.06, edge, { cast: false });
      rbox(px, pz, ry, 0, bY + s * 0.52, boardZ, 1.84, 0.03, 0.06, edge, { cast: false });
    }
    // painted border and shooter's square, 5 cm lines 2 mm proud of the face
    const fz0 = boardZ + 0.0185, sqY = rimY + 0.225;
    for (const s of [-1, 1]) {
      rbox(px, pz, ry, s * 0.27, sqY, fz0, 0.05, 0.45, 0.003, line, { cast: false });
      rbox(px, pz, ry, 0, sqY + s * 0.2, fz0, 0.59, 0.05, 0.003, line, { cast: false });
      rbox(px, pz, ry, s * 0.845, bY, fz0, 0.05, 0.98, 0.003, line, { cast: false });
      rbox(px, pz, ry, 0, bY + s * 0.465, fz0, 1.74, 0.05, 0.003, line, { cast: false });
    }
    // the rim: a flange plate on the board, a braced bracket, the 45 cm ring
    const c = Math.cos(ry), sn = Math.sin(ry), rz = boardZ + 0.15 + 0.225;
    rbox(px, pz, ry, 0, rimY - 0.04, boardZ + 0.022, 0.26, 0.2, 0.012, orange, { cast: false });
    rbox(px, pz, ry, 0, rimY - 0.005, boardZ + 0.09, 0.14, 0.02, 0.15, orange, { cast: false });
    rtube(px, pz, ry, [0, rimY - 0.14, boardZ + 0.03], [0, rimY - 0.01, boardZ + 0.16], 0.012, orange, { cast: false });
    stat(new THREE.TorusGeometry(0.2335, 0.009, 6, 28), orange, px + rz * sn, rimY, pz + rz * c, { rx: Math.PI / 2, cast: false });
    // the net
    for (const pts of netStrands()) {
      const tg = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 6, 0.005, 3, false);
      stat(tg, cord, px + rz * sn, rimY - 0.01, pz + rz * c, { cast: false });
    }
    stat(new THREE.TorusGeometry(0.13, 0.006, 4, 16), cord, px + rz * sn, rimY - 0.43, pz + rz * c, { rx: Math.PI / 2, cast: false });
    return { x: px, z: pz };
  }

  /* THE CANOPY. A mono-pitch steel shed roof on square posts: eave beams
     on the post heads, a rafter over every post line, and a corrugated
     sheet with an overhang that is a real slab (a single-sided plane
     vanishes the moment you look up at it from under it). High at z0,
     low at z1. */
  function canopy(x0, x1, z0, z1, hHigh, hLow, o) {
    o = o || {};
    const steelDark = skin("steel", 0x3a4048), sheet = skin("corrugated", o.tone != null ? o.tone : 0x9aa1a8);
    const bays = Math.max(1, Math.round((x1 - x0) / 5));
    for (let i = 0; i <= bays; i++) {
      const x = x0 + (x1 - x0) * i / bays;
      stat(new THREE.BoxGeometry(0.15, hHigh, 0.15), steelDark, x, hHigh / 2, z0, {});
      stat(new THREE.BoxGeometry(0.15, hLow, 0.15), steelDark, x, hLow / 2, z1, {});
      tube(x, hHigh + 0.1, z0 - 0.35, x, hLow + 0.1, z1 + 0.35, 0.07, steelDark, { seg: 4, cast: false });   // rafter
    }
    stat(new THREE.BoxGeometry(x1 - x0 + 0.15, 0.2, 0.12), steelDark, (x0 + x1) / 2, hHigh, z0, { cast: false });
    stat(new THREE.BoxGeometry(x1 - x0 + 0.15, 0.2, 0.12), steelDark, (x0 + x1) / 2, hLow, z1, { cast: false });
    const run = z1 - z0 + 0.9, rise = hHigh - hLow, len = Math.sqrt(run * run + rise * rise);
    const roof = new THREE.BoxGeometry(x1 - x0 + 0.8, 0.035, len);
    roof.rotateX(Math.atan2(rise, run));
    stat(roof, sheet, (x0 + x1) / 2, (hHigh + hLow) / 2 + 0.2, (z0 + z1) / 2, { uv: 1 });
  }

  // a 55 gallon steel drum: body, three rolling hoops, the lid with its bung
  function drum(x, z, tone) {
    const body = skin("steel", tone != null ? tone : 0x2f5e8a), rim = skin("steel", 0x3a4048);
    stat(new THREE.CylinderGeometry(0.29, 0.29, 0.88, 18), body, x, 0.44, z, {});
    for (const y of [0.02, 0.3, 0.58, 0.86]) stat(new THREE.TorusGeometry(0.29, 0.012, 4, 18), y > 0.8 || y < 0.1 ? rim : body, x, y, z, { rx: Math.PI / 2, cast: false });
    stat(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 8), rim, x + 0.16, 0.885, z + 0.06, { cast: false });
  }
  // a hardwood pallet, 1.2 x 1.0 x 0.14: top boards, three stringer blocks rows
  function pallet(x, z, ry) {
    const wood = skin("concrete", 0x9c7a4e);
    for (let i = 0; i < 5; i++) rbox(x, z, ry || 0, -0.5 + i * 0.25, 0.125, 0, 0.1, 0.022, 1.0, wood, { cast: false });
    for (const lz of [-0.44, 0, 0.44]) rbox(x, z, ry || 0, 0, 0.06, lz, 1.2, 0.1, 0.1, wood, { cast: false });
  }

  /* ==========================================================
     8c. COURT MARKINGS AND BLEACHERS. One half of a FIBA court painted
        from its baseline: the lane (4.9 x 5.8, optionally filled), the
        free-throw circle (solid outside the lane, dashed inside), the
        no-charge arc, the three-point line (6.75 m arc from the basket,
        straight 0.9 m in from each sideline to where it meets the arc) and,
        if asked, the half-court line with its centre circle. Flush paint on
        a ground() court at y 0.03. `dir` is +1 when the court runs +z from
        the baseline at `bz`, -1 when it runs -z. The caller paints the
        boundary and stands the hoop.
     ========================================================== */
  let courtPaint = null, courtFill = new Map();
  function courtPaintMat() {
    if (courtPaint) return courtPaint;
    const c = new THREE.Color(0xe9e9e4), g = (c.r + c.g + c.b) / 3;
    c.setRGB((c.r * 0.7 + g * 0.3) * 0.84, (c.g * 0.7 + g * 0.3) * 0.84, (c.b * 0.7 + g * 0.3) * 0.84);
    courtPaint = new THREE.MeshLambertMaterial({ color: c });
    return courtPaint;
  }
  function arc(cx, cz, r, t0, tl, dir, y, segs) {
    const g = new THREE.RingGeometry(r - 0.025, r + 0.025, segs || 40, 1, t0, tl);
    g.rotateX(-Math.PI / 2);                          // ring +y -> world -z
    return stat(g, courtPaintMat(), cx, y, cz, { ry: dir > 0 ? 0 : Math.PI, cast: false });
  }
  function courtHalf(cx, bz, dir, o) {
    o = o || {};
    const W = o.w || 15, PY = o.y != null ? o.y : 0.034, AY = PY + 0.001;
    const line = (x, z, w, d) => paint(x, z, w, d, 0xe9e9e4, PY);
    const bk = bz + dir * 1.575;                                        // the basket's centre
    if (o.keyFill != null) {
      let m = courtFill.get(o.keyFill);
      if (!m) { m = new THREE.MeshLambertMaterial({ color: o.keyFill }); courtFill.set(o.keyFill, m); }
      const p = new THREE.PlaneGeometry(4.9, 5.8); p.rotateX(-Math.PI / 2);
      stat(p, m, cx, PY - 0.003, bz + dir * 2.9, { cast: false });
    }
    // the lane
    for (const s of [-1, 1]) line(cx + s * 2.425, bz + dir * 2.9, 0.05, 5.8);
    line(cx, bz + dir * 5.775, 4.9, 0.05);
    // free-throw circle: the half outside the lane solid, the half inside dashed
    const ftz = bz + dir * 5.8;
    arc(cx, ftz, 1.8, Math.PI, Math.PI, dir, AY, 28);
    for (let k = 0; k < 7; k++) arc(cx, ftz, 1.8, (k + 0.3) * Math.PI / 7, 0.4 * Math.PI / 7, dir, AY, 4);
    // no-charge semicircle under the basket
    arc(cx, bk, 1.25, Math.PI, Math.PI, dir, AY, 20);
    // three-point line
    const run = Math.sqrt(6.75 * 6.75 - 6.6 * 6.6);                      // basket-line to where the arc meets the straights
    const a3 = Math.asin(run / 6.75), straight = 1.575 + run;
    for (const s of [-1, 1]) line(cx + s * 6.6, bz + dir * straight / 2, 0.05, straight);
    arc(cx, bk, 6.75, Math.PI + a3, Math.PI - 2 * a3, dir, AY, 56);
    if (o.halfLine) {
      const hz = bz + dir * 14;
      line(cx, hz, W, 0.05);
      arc(cx, hz, 1.8, 0, Math.PI, dir, AY, 28);                         // the half of the centre circle on this side
    }
    return { basket: { x: cx, z: bk } };
  }

  /* BLEACHERS: rows of aluminium plank seating on sloped stringers, a post
     under every row, a rear guard rail. The front row's edge is at `x`, the
     rows rise toward -x, so the crowd faces +x. One collider over the unit;
     `o.seats` > 0 registers that many bench seats per row with city/
     propuse.js at the plank's real height. */
  function bleacher(x, z, len, o) {
    o = o || {};
    const galv = skin("galv", 0xb4bcc4), frame = skin("steel", 0x3a4048);
    const rows = o.rows || 4, RD = 0.75, RR = 0.4, ys0 = 0.46;
    const frames = Math.max(2, Math.round(len / 3.5) + 1);
    const back = x - (rows - 1) * RD - 0.45, topY = ys0 + (rows - 1) * RR;
    for (let t = 0; t < rows; t++) {
      const xs = x - t * RD - 0.2, ys = ys0 + t * RR;
      for (const k of [-0.09, 0.09]) stat(new THREE.BoxGeometry(0.16, 0.04, len), galv, xs + k, ys, z, { cast: k < 0 });
      stat(new THREE.BoxGeometry(0.24, 0.035, len), galv, xs + 0.4, ys - 0.42 + 0.02, z, { cast: false });   // foot plank
    }
    for (let i = 0; i < frames; i++) {
      const fz = z - len / 2 + 0.25 + (len - 0.5) * i / (frames - 1);
      tube(x + 0.35, 0.0, fz, back, topY - 0.05, fz, 0.045, frame, { seg: 6, cast: false });           // stringer
      for (let t = 0; t < rows; t++) {
        const xs = x - t * RD - 0.2, ys = ys0 + t * RR;
        tube(xs, 0, fz, xs, ys - 0.02, fz, 0.035, frame, { seg: 6, cast: false });                       // post under the row
        tube(xs + 0.4, ys - 0.42, fz, xs - 0.1, ys - 0.02, fz, 0.022, frame, { seg: 5, cast: false });   // seat bracket
      }
      tube(back, 0, fz, back, topY + 1.0, fz, 0.035, galv, { seg: 6, cast: false });                     // rear guard post
    }
    for (const y of [topY + 0.5, topY + 1.0]) stat(new THREE.CylinderGeometry(0.025, 0.025, len, 6), galv, back, y, z, { rx: Math.PI / 2, cast: false });
    /* WALKABLE, NOT A BLOCK. The whole unit used to be one full-height
       collider: a 2-3 m steel cube with seats drawn on it. A bleacher is
       climbed row to row (each row's foot plank is 0.40 over the last, the
       seats 0.02 under the next foot plank), so its walk surface is one
       CBZ.stairs flight from the front foot plank up to the back row, the
       soffit under it keeps bodies from walking into the frame from behind
       or the ends, and the rear guard rail is a rail. */
    if (CBZ.stairs) {
      const xb = x + 0.4, xt = x - (rows - 1) * RD - 0.2;
      CBZ.stairs.flight({
        bottom: { x: xb, y: 0, z: z }, top: { x: xt, y: topY, z: z },
        width: len, overlap: 0.12, underside: true, link: false,
      });
      // the AI link ends where a body can STAND at the top: just clear of the
      // rear rail (flight()'s own link would end 0.45 past the back row, i.e.
      // behind the rail)
      const xs = back + 0.1 + 0.45, ys = topY * Math.min(1, (xb - xs) / (xb - xt));
      CBZ.stairs.link({
        path: [{ x: xb + 0.45, y: 0, z: z }, { x: xb, y: 0, z: z }, { x: xs, y: ys, z: z }],
        width: len, kind: "bleacher", owner: "bleacher",
      });
      CBZ.colliders.push({ minX: back - 0.1, maxX: back + 0.1, minZ: z - len / 2, maxZ: z + len / 2, y0: 0, y1: topY + 1.05, rail: true, noBreach: true });
    } else {
      CBZ.colliders.push({ minX: back - 0.1, maxX: x + 0.4, minZ: z - len / 2, maxZ: z + len / 2, noBreach: true });
    }
    if (o.seats > 0 && CBZ.roomSeatAnchor) {
      for (let t = 0; t < rows; t++) for (let k = 0; k < o.seats; k++) {
        try {
          CBZ.roomSeatAnchor(x - t * RD - 0.2, 0, z - len / 2 + (k + 0.5) * len / o.seats, Math.PI / 2, "bench", null, { cushion: ys0 + t * RR + 0.02, floorBelow: 0 });
        } catch (e) {}
      }
    }
    return { back: back, front: x + 0.4, top: topY };
  }

  /* ==========================================================
     8d. VEHICLES AND DUMPSTERS. A box does not read as a bus or a
        dumpster: these are drawn from a SIDE PROFILE extruded across their
        width with rounded edges, which is how a body panel or a bin is
        actually shaped. Pieces are built about the object's own origin
        (front is local -z), turned by `ry` and merged through stat(). Each
        pushes its own collider (the rotated footprint's AABB, noBreach).
        Nothing on them glows: lamps are lenses in housings, lit or not by
        the sun like everything else parked in a yard.
     ========================================================== */
  // outline: [[lz, y], ...] around the side; arches: [{c, r}] cut out of the sill line at `sill`
  function profileGeo(outline, width, bevel, arches, sill) {
    const pts = outline.slice();
    if (arches && arches.length) {
      // the sill runs from the last outline point (rear, low) forward to the first (front, low)
      const sorted = arches.slice().sort((a, b) => b.c - a.c);
      for (const a of sorted) {
        pts.push([a.c + a.r, sill]);
        for (let k = 1; k < 10; k++) { const t = Math.PI * k / 10; pts.push([a.c + a.r * Math.cos(t), sill + a.r * Math.sin(t)]); }
        pts.push([a.c - a.r, sill]);
      }
    }
    const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p[0], p[1])));
    const depth = Math.max(0.02, width - 2 * bevel);
    const g = new THREE.ExtrudeGeometry(shape, { depth: depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6 });
    g.translate(0, 0, -depth / 2);
    g.rotateY(-Math.PI / 2);                      // shape x -> local z, extrusion -> local x
    return g;
  }
  function place(g, mat, x, z, ry, o) { return stat(g, mat, x, 0, z, Object.assign({ ry: ry }, o || {})); }
  function lbox(lx, y, lz, w, h, d, rx) { const g = new THREE.BoxGeometry(w, h, d); if (rx) g.rotateX(rx); g.translate(lx, y, lz); return g; }
  function lwheel(lx, lz, r, w) {
    const g = new THREE.CylinderGeometry(r, r, w, 18); g.rotateZ(Math.PI / 2); g.translate(lx, r, lz); return g;
  }
  function lwheelHub(lx, lz, r) {
    const g = new THREE.CylinderGeometry(r * 0.55, r * 0.6, 0.03, 14); g.rotateZ(Math.PI / 2); g.translate(lx, r, lz); return g;
  }
  // a round lamp lens facing local +z (f = 1) or -z (f = -1)
  function llens(lx, y, lz, r, f) {
    const g = new THREE.CylinderGeometry(r, r, 0.03, 16); g.rotateX(Math.PI / 2); g.translate(lx, y, lz + f * 0.015); return g;
  }
  function footprint(x, z, ry, hw, hd) {
    const c = Math.cos(ry), s = Math.sin(ry);
    const ex = Math.abs(hw * c) + Math.abs(hd * s), ez = Math.abs(hw * s) + Math.abs(hd * c);
    const col = { minX: x - ex, maxX: x + ex, minZ: z - ez, maxZ: z + ez, noBreach: true };
    CBZ.colliders.push(col);
    return col;
  }
  // the side runs of a band that has to skip the wheel arches (and, on the
  // door side, the door): [[z0, z1], ...] along the body
  function runsAround(z0, z1, holes) {
    const out = []; let cur = z0;
    for (const h of holes.slice().sort((a, b) => a[0] - b[0])) {
      if (h[0] > cur + 0.05) out.push([cur, Math.min(h[0], z1)]);
      cur = Math.max(cur, h[1]);
    }
    if (z1 > cur + 0.05) out.push([cur, z1]);
    return out;
  }

  /* THE TRANSPORT BUS. A white prison bus: one rounded shell from its side
     profile with the wheel arches cut out of the sill, a grey lower skirt and
     rub rail between the arches, a charcoal waist stripe, the window band of
     tinted glass behind an expanded-steel security screen on a frame of
     mullions, a two-leaf glazed door ahead of the front axle, a split
     windscreen on the rake with its wipers, a louvred engine grille and the
     emergency door's barred pane at the back, lamp clusters of round lenses
     in dark housings, bumpers, mirrors on arms, roof hatches and the A/C
     shroud, tyres with hubs. THE VAN is the same method at 5.6 m. */
  function vehicle(kind, x, z, ry, o) {
    o = o || {};
    ry = ry || 0;
    const body = skin("steel", o.tone != null ? o.tone : 0xe4e6e2), glassDark = skin("steel", 0x141b22, 0.12);
    const rubber = skin("steel", 0x1c1e22, 0.7), hub = skin("galv", 0xb4bcc4), steelDark = skin("steel", 0x3a4048);
    const lensClear = skin("steel", 0xe4e9ec, 0.12), lensRed = skin("steel", 0x9e2019, 0.2), lensAmber = skin("steel", 0xd48a2a, 0.2);
    const stripe = skin("steel", o.stripe != null ? o.stripe : 0x2b3748), skirt = skin("steel", 0x8b9299);
    const P = (g, m, oo) => place(g, m, x, z, ry, oo || { cast: false });
    if (kind === "bus") {
      const L = 5.5, W = 2.5, hw = W / 2, FA = -3.6, RA = 3.4, AR = 0.58;
      const DZ0 = -5.25, DZ1 = -4.3;                                     // the door, +x side ahead of the axle
      P(profileGeo([[-L, 0.45], [-L - 0.05, 1.4], [-L + 0.05, 2.75], [-L + 0.3, 3.02], [L - 0.2, 3.02], [L, 2.8], [L, 0.45]], W, 0.06,
        [{ c: FA, r: AR }, { c: RA, r: AR }], 0.45), body, {});
      const arches = [[FA - AR - 0.08, FA + AR + 0.08], [RA - AR - 0.08, RA + AR + 0.08]];
      for (const s of [-1, 1]) {
        const sx = s * (hw + 0.004);
        const door = s > 0 ? [[DZ0 - 0.05, DZ1 + 0.05]] : [];
        // skirt and rub rail between the arches, the waist stripe over them
        for (const r of runsAround(-L + 0.1, L - 0.1, arches.concat(door))) {
          const m = (r[0] + r[1]) / 2, len = r[1] - r[0];
          P(lbox(sx, 0.74, m, 0.012, 0.5, len), skirt);
          P(lbox(s * (hw + 0.02), 1.0, m, 0.04, 0.06, len), steelDark);
        }
        for (const r of runsAround(-L + 0.1, L - 0.1, door)) P(lbox(sx, 1.36, (r[0] + r[1]) / 2, 0.012, 0.16, r[1] - r[0]), stripe);
        // the window band: glass, the security screen over it, mullions and rails
        const w0 = s > 0 ? DZ1 + 0.15 : -L + 0.35, w1 = L - 0.35;
        const wm = (w0 + w1) / 2, wl = w1 - w0;
        P(lbox(sx, 2.15, wm, 0.012, 0.82, wl), glassDark);
        const scr = new THREE.PlaneGeometry(wl, 0.8); scr.rotateY(Math.PI / 2); scr.translate(s * (hw + 0.03), 2.15, wm);
        P(worldUV(scr, 1.2), skin("chainlink", 0x5a6068));
        for (const y of [1.73, 2.57]) P(lbox(s * (hw + 0.03), y, wm, 0.05, 0.05, wl + 0.06), steelDark);
        const bays = Math.max(2, Math.round(wl / 1.05));
        for (let k = 0; k <= bays; k++) P(lbox(s * (hw + 0.035), 2.15, w0 + wl * k / bays, 0.03, 0.86, 0.05), steelDark);
        P(lbox(s * (hw + 0.035), 2.15, wm, 0.025, 0.025, wl), steelDark);       // the screen's mid rail
        // mirrors on their arms
        P(lbox(s * 1.5, 2.25, -L + 0.05, 0.08, 0.42, 0.22), steelDark);
        P(lbox(s * 1.37, 2.5, -L + 0.07, 0.26, 0.035, 0.035), steelDark);
        P(lbox(s * 1.37, 2.0, -L + 0.07, 0.26, 0.035, 0.035), steelDark);
        // tyres, hubs, and a mud flap behind each wheel
        for (const c of [FA, RA]) {
          P(lwheel(s * 1.05, c, 0.5, 0.3), rubber, {});
          P(lwheelHub(s * 1.21, c, 0.5), hub);
          for (let n = 0; n < 6; n++) {
            const a = n * Math.PI / 3, g = new THREE.CylinderGeometry(0.022, 0.022, 0.02, 6);
            g.rotateZ(Math.PI / 2); g.translate(s * 1.225, 0.5 + Math.sin(a) * 0.17, c + Math.cos(a) * 0.17); P(g, steelDark);
          }
          P(lbox(s * 1.05, 0.33, c + AR + 0.1, 0.34, 0.42, 0.012), rubber);
        }
      }
      // the door: frame, two glazed leaves with the centre seal, a step light
      const dm = (DZ0 + DZ1) / 2, dx = hw + 0.012;
      P(lbox(dx, 1.62, dm, 0.012, 2.1, DZ1 - DZ0 - 0.06), glassDark);
      for (const zz of [DZ0, DZ1]) P(lbox(dx + 0.012, 1.55, zz, 0.035, 2.25, 0.06), steelDark);
      P(lbox(dx + 0.012, 2.67, dm, 0.035, 0.06, DZ1 - DZ0), steelDark);
      P(lbox(dx + 0.012, 1.62, dm, 0.03, 2.1, 0.04), steelDark);                 // the seal where the leaves meet
      for (const y of [0.9, 1.65]) P(lbox(dx + 0.012, y, dm, 0.025, 0.05, DZ1 - DZ0 - 0.08), steelDark);   // kick and mid rails
      // front: split windscreen on the rake, wipers, grille, lamp clusters, bumper
      const rk = Math.atan2(0.1, 1.35);
      for (const s of [-1, 1]) P(lbox(s * 0.56, 2.08, -L - 0.07, 1.06, 1.12, 0.02, rk), glassDark);
      P(lbox(0, 2.08, -L - 0.08, 0.07, 1.14, 0.03, rk), steelDark);
      for (const s of [-1, 1]) P(lbox(s * 0.5, 1.55, -L - 0.105, 0.62, 0.02, 0.02), steelDark);
      P(lbox(0, 0.98, -L - 0.1, 1.2, 0.38, 0.02), steelDark);
      for (let k = 0; k < 4; k++) P(lbox(0, 0.86 + k * 0.08, -L - 0.115, 1.14, 0.025, 0.02), steelDark);
      for (const s of [-1, 1]) {
        P(lbox(s * 0.88, 1.0, -L - 0.11, 0.5, 0.24, 0.04), steelDark);
        P(llens(s * 0.76, 1.0, -L - 0.125, 0.085, -1), lensClear);
        P(llens(s * 0.99, 1.0, -L - 0.125, 0.085, -1), lensClear);
        P(lbox(s * 1.17, 1.0, -L - 0.105, 0.1, 0.14, 0.03), lensAmber);
      }
      P(lbox(0, 0.6, -L - 0.2, 2.5, 0.26, 0.2), steelDark);
      // rear: engine louvres, tail clusters, the emergency door's barred pane, bumper
      P(lbox(0, 1.15, L + 0.075, 1.6, 0.62, 0.02), steelDark);
      for (let k = 0; k < 6; k++) P(lbox(0, 0.9 + k * 0.1, L + 0.09, 1.54, 0.03, 0.02), rubber);
      for (const s of [-1, 1]) {
        P(lbox(s * 1.0, 1.3, L + 0.075, 0.28, 0.82, 0.03), steelDark);
        P(llens(s * 1.0, 1.02, L + 0.09, 0.09, 1), lensRed);
        P(llens(s * 1.0, 1.27, L + 0.09, 0.09, 1), lensRed);
        P(llens(s * 1.0, 1.52, L + 0.09, 0.09, 1), lensAmber);
      }
      P(lbox(0, 2.25, L + 0.07, 1.3, 0.62, 0.02), glassDark);
      for (let k = -2; k <= 2; k++) P(lbox(k * 0.25, 2.25, L + 0.09, 0.03, 0.66, 0.025), steelDark);
      P(lbox(0, 0.6, L + 0.16, 2.5, 0.24, 0.18), steelDark);
      // roof: two escape hatches and the A/C shroud
      for (const hz of [-2.6, 0.2]) P(lbox(0, 3.1, hz, 0.85, 0.06, 0.85), skirt);
      P(lbox(0, 3.2, 2.7, 1.5, 0.26, 2.2), body, {});
      P(lbox(0, 3.335, 2.7, 1.2, 0.012, 1.9), steelDark);                 // the condenser grille
      footprint(x, z, ry, 1.4, 5.75);
    } else {
      const W = 2.0;
      P(profileGeo([[-2.75, 0.4], [-2.82, 0.78], [-2.72, 1.05], [-2.25, 1.2], [-1.6, 2.15], [-1.35, 2.4], [2.68, 2.44], [2.78, 2.34], [2.78, 0.45]], W, 0.06,
        [{ c: 1.85, r: 0.46 }, { c: -1.85, r: 0.46 }], 0.4), body, {});
      // windscreen on the rake, cab side windows, the rear door glass
      P(lbox(0, 1.715, -1.98, 1.8, 1.1, 0.02, Math.atan2(2.25 - 1.6, 2.15 - 1.2)), glassDark);
      for (const s of [-1, 1]) {
        const sx = s * (W / 2 + 0.004);
        P(lbox(sx, 1.72, -1.2, 0.01, 0.62, 0.8), glassDark);
        P(lbox(sx, 1.05, 0.2, 0.01, 0.18, 4.8), stripe);
        P(lbox(s * 0.45, 1.85, 2.85, 0.62, 0.5, 0.01), glassDark);
        for (let k = -2; k <= 2; k++) P(lbox(s * 0.45 + k * 0.11, 1.85, 2.86, 0.02, 0.52, 0.015), steelDark);   // the rear pane's bars
        P(lbox(s * 0.66, 0.95, -2.85, 0.3, 0.16, 0.04), steelDark);
        P(llens(s * 0.6, 0.95, -2.88, 0.06, -1), lensClear);
        P(llens(s * 0.74, 0.95, -2.88, 0.05, -1), lensAmber);
        P(lbox(s * 0.9, 1.1, 2.85, 0.14, 0.36, 0.03), steelDark);
        P(llens(s * 0.9, 1.0, 2.86, 0.05, 1), lensRed);
        P(llens(s * 0.9, 1.18, 2.86, 0.05, 1), lensRed);
        P(lbox(s * 1.12, 1.6, -1.72, 0.05, 0.26, 0.16), steelDark);       // mirrors
        for (const c of [-1.85, 1.85]) {
          P(lwheel(s * 0.84, c, 0.37, 0.24), rubber, {});
          P(lwheelHub(s * 0.97, c, 0.37), hub);
        }
      }
      P(lbox(0, 0.85, -2.86, 1.1, 0.26, 0.03), steelDark);                    // grille
      P(lbox(0, 0.5, -2.9, 2.0, 0.2, 0.14), steelDark);                       // bumpers
      P(lbox(0, 0.5, 2.88, 2.0, 0.2, 0.12), steelDark);
      P(lbox(0, 1.6, 2.855, 0.02, 1.9, 0.015), steelDark);                    // the rear door split
      footprint(x, z, ry, 1.2, 3.1);
    }
  }

  /* THE DUMPSTER. A front-load bin: the body wider at the top than the
     base (sloped front, near-vertical back) with a lip round the opening,
     two black plastic lids on a hinge bar sloping to the front, three
     pressed ribs up the front, a fork pocket along each flank, a skid frame
     and four swivel casters. 2.0 m across (local x), the front at local -z. */
  function dumpster(x, z, ry, o) {
    o = o || {};
    ry = ry || 0;
    const bin = skin("steel", o.tone != null ? o.tone : 0x2f6b3a), lid = skin("steel", 0x17191c, 0.75);
    const dark = skin("steel", 0x3a4048), rubber = skin("steel", 0x1c1e22, 0.7), hole = skin("steel", 0x0c0d0f, 0.9);
    const P = (g, m, oo) => place(g, m, x, z, ry, oo || { cast: false });
    P(profileGeo([[-0.62, 0.16], [-0.82, 1.3], [0.78, 1.36], [0.72, 0.16]], 2.0, 0.03), bin, {});
    // the lip round the opening
    P(lbox(0, 1.31, -0.84, 2.04, 0.07, 0.06), bin);
    P(lbox(0, 1.37, 0.8, 2.04, 0.07, 0.06), bin);
    for (const s of [-1, 1]) P(lbox(s * 1.0, 1.34, -0.02, 0.06, 0.07, 1.68), bin);
    // two lids, sloped with the top, rounded edges, a hinge bar at the back
    const slope = Math.atan2(0.06, 1.6);
    for (const s of [-1, 1]) {
      const g = profileGeo([[-0.9, 0], [-0.9, 0.03], [-0.84, 0.07], [0.8, 0.075], [0.84, 0.04], [0.84, 0]], 0.96, 0.012);
      g.rotateX(-slope); g.translate(s * 0.5, 1.365, 0);
      P(g, lid, {});
      P(lbox(s * 0.5, 1.425, -0.5, 0.5, 0.02, 0.05), lid);                 // the moulded grip
    }
    const hb = new THREE.CylinderGeometry(0.025, 0.025, 2.0, 8); hb.rotateZ(Math.PI / 2); hb.translate(0, 1.42, 0.83); P(hb, dark);
    // pressed ribs up the sloped front
    const lean = -Math.atan2(0.2, 1.14);
    for (const k of [-0.62, 0, 0.62]) P(lbox(k, 0.72, -0.76, 0.07, 1.12, 0.05, lean), bin);
    // fork pockets: a steel channel along each flank, dark mouths at the ends
    for (const s of [-1, 1]) {
      P(lbox(s * 1.06, 0.95, -0.02, 0.1, 0.2, 1.5), dark);
      for (const e of [-1, 1]) P(lbox(s * 1.06, 0.95, -0.02 + e * 0.752, 0.07, 0.13, 0.006), hole);
    }
    // skid frame and swivel casters
    P(lbox(0, 0.17, -0.02, 1.9, 0.05, 1.3), dark);
    for (const s of [-1, 1]) for (const t of [-1, 1]) {
      P(lbox(s * 0.8, 0.125, t * 0.5, 0.12, 0.04, 0.12), dark);
      for (const k of [-1, 1]) P(lbox(s * 0.8 + k * 0.035, 0.08, t * 0.5, 0.01, 0.1, 0.08), dark);
      P(lwheel(s * 0.8, t * 0.5, 0.06, 0.05), rubber);
    }
    return footprint(x, z, ry, 1.1, 0.9);
  }

  /* ==========================================================
     8e. SHOP AND CELL FITTINGS shared by the south block and the wings.
     ========================================================== */
  /* THE WORKBENCH: a hardwood top on a steel apron, square legs, a shelf low
     down, a bench vice bolted at the +x end (or the end `o.vice` says, ±1,
     0 = none), and what a shop leaves on a bench: an offcut in the jaws, a
     hammer, a file. `len` along x, `dep` along z. Pushes its own waist-high
     collider. */
  function workbench(x, z, len, dep, o) {
    o = o || {};
    const frame = skin("steel", 0x4a525c), wood = skin("concrete", 0x9c7a4e);
    const blue = skin("steel", 0x2f4f7a, 0.5), iron = skin("steel", 0x2a2f36, 0.6);
    const hl = len / 2, hd = dep / 2;
    stat(new THREE.BoxGeometry(len, 0.06, dep), wood, x, 0.87, z, { uv: 1 });
    stat(new THREE.BoxGeometry(len - 0.1, 0.1, dep - 0.06), frame, x, 0.79, z, { cast: false });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) stat(new THREE.BoxGeometry(0.06, 0.74, 0.06), frame, x + sx * (hl - 0.1), 0.37, z + sz * (hd - 0.08), { cast: false });
    const legs = len > 3.4 ? [0] : [];
    for (const lx of legs) for (const sz of [-1, 1]) stat(new THREE.BoxGeometry(0.06, 0.74, 0.06), frame, x + lx, 0.37, z + sz * (hd - 0.08), { cast: false });
    stat(new THREE.BoxGeometry(len - 0.2, 0.03, dep - 0.14), frame, x, 0.18, z, { cast: false });
    const vs = o.vice != null ? o.vice : 1;
    if (vs) {
      const vx = x + vs * (hl - 0.4), vz = z - hd + 0.04;
      stat(new THREE.BoxGeometry(0.2, 0.05, 0.22), blue, vx, 0.925, vz + 0.08, { cast: false });
      stat(new THREE.BoxGeometry(0.2, 0.14, 0.08), blue, vx, 1.02, vz + 0.1, { cast: false });
      stat(new THREE.BoxGeometry(0.2, 0.12, 0.07), blue, vx, 1.01, vz - 0.04, { cast: false });
      stat(new THREE.BoxGeometry(0.2, 0.012, 0.012), iron, vx, 1.085, vz + 0.055, { cast: false });   // jaw plates
      stat(new THREE.BoxGeometry(0.2, 0.012, 0.012), iron, vx, 1.065, vz, { cast: false });
      stat(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 8), iron, vx, 0.99, vz - 0.14, { rx: Math.PI / 2, cast: false });
      stat(new THREE.CylinderGeometry(0.007, 0.007, 0.24, 6), iron, vx, 0.99, vz - 0.25, { rz: Math.PI / 2, cast: false });
      stat(new THREE.BoxGeometry(0.16, 0.1, 0.01), iron, vx, 1.12, vz + 0.03, { cast: false });          // the offcut in the jaws
    }
    if (o.clutter !== false) {
      stat(new THREE.BoxGeometry(0.32, 0.03, 0.03), wood, x - 0.6, 0.915, z + 0.1, { ry: 0.3, cast: false });   // hammer
      stat(new THREE.BoxGeometry(0.05, 0.05, 0.12), iron, x - 0.46, 0.925, z + 0.05, { ry: 0.3, cast: false });
      stat(new THREE.BoxGeometry(0.3, 0.008, 0.025), iron, x - 0.1, 0.904, z - 0.2, { ry: -0.2, cast: false });  // file
    }
    const col = { minX: x - hl, maxX: x + hl, minZ: z - hd - 0.1, maxZ: z + hd, y0: 0, y1: 1.0 };
    CBZ.colliders.push(col);
    return col;
  }

  /* THE STAINLESS COMBI: the toilet/basin unit a jail bolts to a wall. A
     chase with the basin and push-button tap on top, the bowl with its
     rolled rim cantilevered off the front, no seat. (x, z) is the wall-face
     point it stands against; `face` is the unit direction into the room. */
  function combi(x, z, fx, fz) {
    const ss = skin("steel", 0xc9ced3, 0.28), dark = skin("steel", 0x6b7480, 0.4);
    const ry = Math.atan2(fx, fz);
    rbox(x, z, ry, 0, 0.56, 0.13, 0.62, 1.12, 0.26, ss, { uv: 1 });              // the chase
    rbox(x, z, ry, 0, 1.135, 0.15, 0.64, 0.03, 0.3, ss, { cast: false });
    rbox(x, z, ry, 0, 1.2, 0.04, 0.05, 0.1, 0.05, ss, { cast: false });           // tap
    const at = (d) => [x + fx * d, z + fz * d];
    let p = at(0.15); stat(new THREE.CylinderGeometry(0.16, 0.13, 0.06, 16), dark, p[0], 1.12, p[1], { cast: false });   // basin
    p = at(0.44);
    stat(new THREE.CylinderGeometry(0.19, 0.14, 0.3, 18), ss, p[0], 0.26, p[1], { uv: 1 });                 // bowl
    stat(new THREE.TorusGeometry(0.19, 0.03, 6, 20), ss, p[0], 0.41, p[1], { rx: Math.PI / 2, cast: false });
    stat(new THREE.CylinderGeometry(0.14, 0.14, 0.01, 16), dark, p[0], 0.395, p[1], { cast: false });        // the water
    rbox(x, z, ry, 0.18, 0.92, 0.265, 0.04, 0.04, 0.01, dark, { cast: false });                              // flush button
  }

  /* ==========================================================
     9. THE AUDIT. Numbers the exterior preset prints, and what the
        "empty and dumb" complaint is as a fraction.
     ========================================================== */
  CBZ.prisonExteriorAudit = function () {
    const W = CBZ.WORLD || {};
    const OUT = W.wings || { x0: -124, x1: 124, z0: -116, z1: 128 };
    const N = W.northYard || { x0: -30, x1: 30, z0: -8, z1: 52 };
    const S = W.southBlock || { x0: -44, x1: 44, z0: 52, z1: 128 };
    const CB = W.cellBlock || { x0: -16, x1: 16, z0: -44, z1: -8 };
    const AD = W.adminWing || { x0: -20, x1: 20, z0: -64, z1: -44 };
    const inner = (N.x1 - N.x0) * (N.z1 - N.z0) + (S.x1 - S.x0) * (S.z1 - S.z0)
      + (CB.x1 - CB.x0) * (CB.z1 - CB.z0) + (AD.x1 - AD.x0) * (AD.z1 - AD.z0);
    const ring = (OUT.x1 - OUT.x0) * (OUT.z1 - OUT.z0) - inner;
    // rooms in the ring take their own footprint out of "open"
    let rooms = 0;
    for (const s of (CBZ.prisonShells || [])) {
      if (!s || !isFinite(+s.x0)) continue;
      const cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2;
      const inOld = cx > N.x0 && cx < N.x1 && cz > CB.z0 && cz < N.z1 || cx > S.x0 && cx < S.x1 && cz > S.z0 && cz < S.z1 || cz > AD.z0 && cz < AD.z1 && cx > AD.x0 && cx < AD.x1;
      if (!inOld) rooms += Math.abs((s.x1 - s.x0) * (s.z1 - s.z0));
    }
    let programmed = 0;
    for (const p of programs) programmed += p.m2;
    const open = Math.max(0, ring - rooms);
    return {
      fenceM: fenceM, masts: masts, towers: towerRecs.length, statPieces: pieces,
      texturedWalls: texturedWalls, programmedM2: Math.round(programmed),
      ringM2: ring, ringRoomsM2: Math.round(rooms), ringOpenM2: Math.round(open),
      ringOpenShare: open > 0 ? Math.max(0, 1 - programmed / open) : 0,
      programs: programs.map((p) => p.id),
    };
  };

  CBZ.prisonKit = {
    skin, skinBox, worldUV, stat, octRing, post, coilRun, fence, floodMast, ground, paint, program, sign: signPlate, toneUp,
    tube, rbox, rtube, picnicTable, hoop, canopy, drum, pallet,
    courtHalf, bleacher, profileGeo, vehicle, dumpster, workbench, combi,
    TOWER_DECK, TILE,
    // roombuild.js's roomShell skins its walls with this when a caller does not
    // say; world/prisongrounds.js (the last prison builder) clears it so the
    // city's interiors, built later, keep their flat plaster
    defaultSkin: "panel",
  };
})();
