/* ============================================================
   world/sea_scene.js — THE SHARK SIM'S SEA IS A PLACE, NOT A DISC.

   The shark sim borrows Disaster Survival's island: grass, a beach, a shelf,
   kelp and rocks on the bed, islets past the fog. Between the sand and the
   horizon there was nothing a person had built and nothing standing out of
   the water, so the sea read as an empty plate with an island on it.

   This file stands up, in SHARKSIM ONLY (survival's island is never touched:
   the group hides itself in every other mode), the things a real swimming
   beach has around it:

     • a timber PIER running off the beach into ~13 m of water, with a T-head,
       lamp posts, benches, a life ring, and a floating landing pontoon. Its
       pilings carry a tide band of barnacles and weed below it, braced in X,
       so from under the surface it is a colonnade of dark trunks in the blue.
     • a SWIM ZONE: a line of yellow and white floats roping off the water in
       front of the lifeguard tower, red marker balls at the corners.
     • a LIFEGUARD TOWER at the waterline with the purple "dangerous marine
       life" flag and the red "no swimming" flag beside it.
     • a MOORING FIELD of white balls off the pier head, and red/green CHANNEL
       BUOYS with flashing lanterns leading in to it.
     • ROCK OUTCROPS breaking the surface around the island, and a SEA STACK
       with a skeletal beacon on it.
     • SEABIRDS: gulls circling the pier head and the stack, a flock that
       follows whichever boat is under way, and a few perched on posts and
       rocks.

   DRAW CALLS: 6 (pier+tower merged, rocks merged, floats, nav buoys, lanterns,
   gulls). Everything static is merged into two Lambert vertex-colour meshes;
   everything that moves is one InstancedMesh per shape.

   COLLISION. Pilings, rocks, the stack, the pontoon and the nav buoys are
   circles in one obstacle table. In sharksim the water field's two movement
   questions — isNavigableWater (the ridden shark's rideCanSwim) and
   moveInWater (every wild swimmer) — are wrapped once so a body cannot pass
   through them; moveInWater slides around instead of stopping. Boats are
   pushed out of the same circles after they move. Nothing here touches the
   shore oracle itself.

   SEAMS PUBLISHED
     CBZ.sharkSeaMoorings = [{x, z, heading, kind: "ball"|"pontoon", maxLoa}]
       feature-detect for a boat to tie up to. Filled on the first sharksim
       frame, [] before that.
     CBZ.sharkSeaScene = {built, group, pier, obstacles, blockedAt(x,z,pad),
       audit()} — read by tools/visual-presets/sea-scene.mjs.

   Layout is fixed and deterministic (CBZ.hash01, never Math.random): the pier
   sits a little north of the +X ray, where shark_sim.js drops the player, so
   it is the first thing in view.

   FLAG: none. Git is the undo.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  const PIER_BEARING = 0.30;       // rad from +X around the island centre
  const PIER_PAST_WL = 36;         // m past the waterline the T-head ends
  const SWIM_R = 22;               // swim-zone float line, m past the waterline

  function h01(a, b) {
    if (typeof CBZ.hash01 === "function") { try { return CBZ.hash01(a, b, 0x5ea5ce); } catch (e) {} }
    const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
    return s - Math.floor(s);
  }
  function seaY(x, z) {
    if (typeof CBZ.citySeaHeightAt === "function") { try { return CBZ.citySeaHeightAt(x, z); } catch (e) {} }
    return -0.8;
  }
  function arena() { return CBZ.surv && CBZ.surv.arena; }
  function live() { return S.built && CBZ.game && CBZ.game.mode === "sharksim" && S.group && S.group.visible; }

  const S = {
    built: false, group: null, pier: null, obstacles: [], groups: [],
    floats: null, navs: null, lamps: null, birds: null,
    floatPts: [], navPts: [], birdSt: [], t: 0, bobT: 0,
    blockedAt: blockedAt,
    audit: function () {
      let draws = 0;
      if (S.group) S.group.traverse(function (o) { if (o.isMesh) draws++; });
      return {
        built: S.built, drawCalls: draws, obstacles: S.obstacles.length,
        moorings: CBZ.sharkSeaMoorings.length, floats: S.floatPts.length,
        birds: S.birdSt.length, visible: !!(S.group && S.group.visible),
        pushes: S.pushes || 0, slides: S.slides || 0,
      };
    },
  };
  CBZ.sharkSeaScene = S;
  CBZ.sharkSeaMoorings = [];

  // ============================================================
  //  MERGED STATIC GEOMETRY — one position/normal/colour soup per material
  // ============================================================
  function Soup() { this.p = []; this.n = []; this.c = []; }
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
  const _v = new THREE.Vector3(), _s = new THREE.Vector3(), _col = new THREE.Color();
  const _X = new THREE.Vector3(1, 0, 0);
  // add `geo` under matrix m. col: hex, or fn(x,y,z,i) -> hex for per-vertex tone
  Soup.prototype.add = function (geo, m, col) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(m);
    const P = g.attributes.position.array, N = g.attributes.normal.array;
    const fn = typeof col === "function" ? col : null;
    if (!fn) _col.setHex(col);
    for (let i = 0; i < P.length; i += 3) {
      this.p.push(P[i], P[i + 1], P[i + 2]);
      this.n.push(N[i], N[i + 1], N[i + 2]);
      if (fn) _col.setHex(fn(P[i], P[i + 1], P[i + 2], i / 3));
      this.c.push(_col.r, _col.g, _col.b);
    }
    g.dispose();
  };
  Soup.prototype.mesh = function (mat, name) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.name = name;
    m.userData.terrain = true;         // batch.js / farcull.js keep their hands off
    m.matrixAutoUpdate = false; m.updateMatrix();
    return m;
  };

  const BOX = new THREE.BoxGeometry(1, 1, 1);
  // a box from a to b (world points), w wide and h tall
  function beam(soup, ax, ay, az, bx, by, bz, w, h, col) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return;
    _v.set(dx / len, dy / len, dz / len);
    _q.setFromUnitVectors(_X, _v);
    _s.set(len, h, w);
    _m4.compose(new THREE.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), _q, _s);
    soup.add(BOX, _m4, col);
  }
  // an axis-aligned-to-yaw box centred at (x,y,z)
  function block(soup, x, y, z, yaw, sx, sy, sz, col) {
    _e.set(0, yaw, 0); _q.setFromEuler(_e); _s.set(sx, sy, sz);
    _m4.compose(new THREE.Vector3(x, y, z), _q, _s);
    soup.add(BOX, _m4, col);
  }
  const CYL = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
  function post(soup, x, y0, z, y1, r, col) {
    _q.identity(); _s.set(r, y1 - y0, r);
    _m4.compose(new THREE.Vector3(x, (y0 + y1) / 2, z), _q, _s);
    soup.add(CYL, _m4, col);
  }

  // ============================================================
  //  COLOURS. Everything here is authored DARK: this renderer is linear with
  //  an ACES curve and an sRGB encode, which lifts a linear 0.34 to ~200/255
  //  on screen (disaster_arena.js measured it on the bed rocks).
  // ============================================================
  const WOOD = [0x3d3124, 0x352a1f, 0x46382a, 0x2f261c];
  const WOOD_DRY = 0x4b3f31;
  const BARN = 0x5e5a4e, BARN_DK = 0x1b1c18, WEED = 0x19170d, WEED2 = 0x10160b, WEED_DK = 0x0b0d08;
  const PAINT_W = 0xb9bdb8, STEEL = 0x2a2c2e, BLACK = 0x121212;
  const TOWER = 0x5f93ad, ORANGE = 0xcf4d17, PURPLE = 0x4c2078, RED = 0xa81c1c;

  // A piling is a stack of sections so the tide band has vertices to live on.
  function piling(soup, x, z, bedY, topY, r, sea, salt) {
    const cuts = [bedY - 0.6, sea - 3.2, sea - 0.75, sea - 0.15, sea + 0.45, sea + 0.95, topY];
    for (let i = 0; i < cuts.length - 1; i++) {
      const y0 = Math.max(cuts[i], bedY - 0.6), y1 = Math.min(cuts[i + 1], topY);
      if (y1 - y0 < 0.02) continue;
      let col, rr = r;
      // weed: a dark olive-brown mottle, never a lit green (the underwater
      // grade lifts anything green into a pastel pole)
      const weed = function (px, py, pz, k) {
        if (py < sea - 9) return WEED_DK;
        return h01(k * 0.53 + salt, py * 2.3) > 0.5 ? WEED : WEED2;
      };
      if (i === 0) col = weed;
      else if (i === 1) { col = weed; rr = r * 1.08; }
      else if (i === 2 || i === 3) {            // the tide band: barnacle crust, speckled
        rr = r * 1.14;
        col = function (px, py, pz, k) { return h01(k * 0.37 + salt, px * 3.1 + pz) > 0.55 ? BARN : BARN_DK; };
      } else if (i === 4) col = 0x241d15;       // wet wood above the crust
      else col = WOOD[(salt | 0) & 3];
      post(soup, x, y0, z, y1, rr, col);
    }
  }

  // ============================================================
  //  OBSTACLES
  // ============================================================
  function obstacleGroup(list) {
    let cx = 0, cz = 0;
    for (const o of list) { cx += o.x; cz += o.z; }
    cx /= list.length; cz /= list.length;
    let r = 0;
    for (const o of list) r = Math.max(r, Math.hypot(o.x - cx, o.z - cz) + o.r);
    S.groups.push({ x: cx, z: cz, r: r, list: list });
    for (const o of list) S.obstacles.push(o);
  }
  function blockedAt(x, z, pad) {
    const G = S.groups;
    pad = pad || 0;
    for (let i = 0; i < G.length; i++) {
      const g = G[i], gx = x - g.x, gz = z - g.z, gr = g.r + pad;
      if (gx * gx + gz * gz > gr * gr) continue;
      const L = g.list;
      for (let k = 0; k < L.length; k++) {
        const o = L[k], dx = x - o.x, dz = z - o.z, rr = o.r + pad;
        if (dx * dx + dz * dz < rr * rr) return o;
      }
    }
    return null;
  }

  // ============================================================
  //  BUILD
  // ============================================================
  function build() {
    const A = arena();
    if (!A || !A.root || !A.groundHeightAt) return false;
    const cx = A.center.x, cz = A.center.z, R = A.radius;
    const ground = function (x, z) { return A.groundHeightAt(x, z); };
    const SEA = CBZ.survSeaMeanY ? CBZ.survSeaMeanY() : -0.8;
    const depth = CBZ.survFloodDepthMeanAt || function (x, z) { return SEA - ground(x, z); };
    // where this island's sea meets its sand along a bearing (bisection on the
    // same depth oracle shark_sim.js's measureWaterline uses)
    function waterlineAt(a) {
      let lo = R * 0.9, hi = R + 44;
      for (let it = 0; it < 22; it++) {
        const mid = (lo + hi) / 2;
        if (depth(cx + Math.cos(a) * mid, cz + Math.sin(a) * mid) > 0.02) hi = mid; else lo = mid;
      }
      return (lo + hi) / 2;
    }

    const root = new THREE.Group();
    root.name = "shark-sea-scene";
    root.userData.terrain = true;
    const wood = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
    wood.name = "sea-scene-built";
    const stone = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
    stone.name = "sea-scene-rock";
    const built = new Soup(), rocks = new Soup();

    // ---- THE PIER ---------------------------------------------------------
    const th = PIER_BEARING, ux = Math.cos(th), uz = Math.sin(th), vx = -uz, vz = ux;
    const yaw = -th;                      // local +X of a box points down the pier
    const WLp = waterlineAt(th);
    const R0 = R - 5;                     // the pier starts on the grass
    const L = WLp + PIER_PAST_WL - R0;    // total length
    const HEAD = 7, HEADW = 7;            // T-head depth along the axis, half width
    const DY = SEA + 1.95;                // deck top
    const RAMP = 11;
    const px = function (s, l) { return cx + ux * (R0 + s) + vx * l; };
    const pz = function (s, l) { return cz + uz * (R0 + s) + vz * l; };
    const g0 = ground(px(0, 0), pz(0, 0));
    const deckY = function (s) {
      if (s >= RAMP) return DY;
      const t = Math.max(0, s / RAMP);
      return g0 + 0.1 + (DY - g0 - 0.1) * (t * t * (3 - 2 * t));
    };
    const pierObs = [];

    // pilings: a bent of two every 4.5 m down the walkway, a 3 x 5 grid under the head
    const bents = [];
    for (let s = 5; s < L - HEAD - 1; s += 4.5) bents.push({ s: s, ls: [-1.55, 1.55] });
    for (let k = 0; k < 3; k++) bents.push({ s: L - HEAD + k * 3.5, ls: [-HEADW, -3.5, 0, 3.5, HEADW], head: true });
    let pn = 0;
    for (const b of bents) {
      const top = deckY(b.s) - 0.32;
      const lss = [];
      for (const l of b.ls) {
        const x = px(b.s, l), z = pz(b.s, l);
        const gy = ground(x, z);
        if (top - gy < 0.35) continue;
        // the head's outer corners stand 0.9 m proud of the deck: bollards to tie to
        const proud = b.head && Math.abs(l) === HEADW && (b.s === L - HEAD || b.s >= L - 0.1);
        piling(built, x, z, gy, proud ? DY + 0.9 : top, 0.21, SEA, pn++);
        lss.push({ l: l, x: x, z: z, gy: gy });
        if (gy < SEA - 0.3) pierObs.push({ x: x, z: z, r: 0.3, kind: "piling" });
        if (proud) S._perches = (S._perches || []).concat([{ x: x, y: DY + 0.9, z: z }]);
      }
      if (lss.length < 2) continue;
      const lo = lss[0], hi = lss[lss.length - 1];
      // pile cap across the bent
      beam(built, px(b.s, lo.l - 0.25), top, pz(b.s, lo.l - 0.25), px(b.s, hi.l + 0.25), top, pz(b.s, hi.l + 0.25), 0.3, 0.3, WOOD[1]);
      // X bracing between neighbours, down to a metre and a half under the sea
      for (let i = 0; i + 1 < lss.length; i++) {
        const a = lss[i], c = lss[i + 1];
        const yb = Math.max(Math.max(a.gy, c.gy) + 0.4, SEA - 1.6);
        if (top - yb < 0.8) continue;
        beam(built, a.x, top - 0.25, a.z, c.x, yb, c.z, 0.08, 0.2, WOOD[3]);
        beam(built, c.x, top - 0.25, c.z, a.x, yb, a.z, 0.08, 0.2, WOOD[3]);
      }
    }
    // stringers under the walkway, then under the head
    for (const l of [-1.35, 0, 1.35]) {
      for (let s = 0; s < L - HEAD; s += 2) {
        const s1 = Math.min(L - HEAD, s + 2);
        beam(built, px(s, l), deckY(s) - 0.19, pz(s, l), px(s1, l), deckY(s1) - 0.19, pz(s1, l), 0.14, 0.24, WOOD[2]);
      }
    }
    for (let l = -HEADW; l <= HEADW + 0.01; l += 1.75) {
      beam(built, px(L - HEAD - 0.2, l), DY - 0.19, pz(L - HEAD - 0.2, l), px(L + 0.2, l), DY - 0.19, pz(L + 0.2, l), 0.14, 0.24, WOOD[2]);
    }
    // deck planks, 0.26 m boards with a 4 cm gap, three tones
    let pk = 0;
    for (let s = 0.15; s < L - HEAD; s += 0.3) {
      block(built, px(s, 0), deckY(s) - 0.04, pz(s, 0), yaw, 0.26, 0.08, 3.5, WOOD[(pk++ * 7 + (h01(pk, 3) * 3 | 0)) & 3]);
    }
    for (let s = L - HEAD - 0.15; s < L + 0.2; s += 0.3) {
      block(built, px(s, 0), DY - 0.04, pz(s, 0), yaw, 0.26, 0.08, HEADW * 2 + 0.5, WOOD[(pk++ * 7 + (h01(pk, 5) * 3 | 0)) & 3]);
    }
    // railings: posts every 2.25 m, a top and a mid rail
    function railRun(s0, l0, s1, l1, yA, yB, n) {
      for (let i = 0; i <= n; i++) {
        const f = i / n, s = s0 + (s1 - s0) * f, l = l0 + (l1 - l0) * f, y = yA + (yB - yA) * f;
        beam(built, px(s, l), y, pz(s, l), px(s, l), y + 1.1, pz(s, l), 0.11, 0.11, WOOD_DRY);
      }
      for (const hgt of [0.55, 1.08]) {
        beam(built, px(s0, l0), yA + hgt, pz(s0, l0), px(s1, l1), yB + hgt, pz(s1, l1), 0.07, 0.09, WOOD_DRY);
      }
    }
    for (const side of [-1, 1]) {
      for (let s = 2; s < L - HEAD - 0.1; s += 4.5) {
        const s1 = Math.min(L - HEAD, s + 4.5);
        railRun(s, 1.7 * side, s1, 1.7 * side, deckY(s), deckY(s1), 2);
      }
      railRun(L + 0.1, 0, L + 0.1, HEADW * side, DY, DY, 3);               // seaward edge
      railRun(L - HEAD, HEADW * side, L + 0.1, HEADW * side, DY, DY, 3);   // the ends
    }
    railRun(L - HEAD, 1.7, L - HEAD, HEADW, DY, DY, 2);                    // landward edge, north half
    // (the south half is open: that is where the gangway goes down)

    // lamp posts on the head, and on the walkway every 18 m
    function lamp(s, l) {
      const x = px(s, l), z = pz(s, l), y = deckY(s);
      post(built, x, y, z, y + 3.6, 0.07, STEEL);
      beam(built, x, y + 3.55, z, x + vx * -Math.sign(l || 1) * 0.5, y + 3.55, z + vz * -Math.sign(l || 1) * 0.5, 0.06, 0.06, STEEL);
      block(built, x + vx * -Math.sign(l || 1) * 0.55, y + 3.45, z + vz * -Math.sign(l || 1) * 0.55, yaw, 0.28, 0.22, 0.28, 0xd8d0b0);
    }
    for (let s = 14; s < L - HEAD; s += 18) lamp(s, 1.7);
    lamp(L - 0.2, HEADW - 0.1); lamp(L - 0.2, -HEADW + 0.1);
    // benches facing out to sea
    for (const l of [-3.8, 3.8]) {
      const s = L - 1.2, x = px(s, l), z = pz(s, l);
      block(built, x, DY + 0.45, z, yaw, 0.45, 0.06, 1.8, WOOD_DRY);
      block(built, x - ux * 0.22, DY + 0.75, z - uz * 0.22, yaw, 0.06, 0.4, 1.8, WOOD_DRY);
      for (const e of [-0.8, 0.8]) block(built, x + vx * e, DY + 0.22, z + vz * e, yaw, 0.4, 0.44, 0.07, STEEL);
    }
    // a life ring on the head's north rail, a fish-cleaning table
    {
      const s = L - HEAD + 3, l = HEADW + 0.08, x = px(s, l), z = pz(s, l);
      const ring = new THREE.TorusGeometry(0.36, 0.09, 6, 14);
      _e.set(0, yaw, 0); _q.setFromEuler(_e); _s.set(1, 1, 1);
      _m4.compose(new THREE.Vector3(x, DY + 0.8, z), _q, _s);
      built.add(ring, _m4, function (qx, qy, qz, k) { return ((Math.atan2(qy - DY - 0.8, (qx - x) * ux + (qz - z) * uz) + 3.2) * 2 | 0) & 1 ? ORANGE : PAINT_W; });
      ring.dispose();
      const tx = px(L - HEAD + 1.2, 4.6), tz = pz(L - HEAD + 1.2, 4.6);
      block(built, tx, DY + 0.9, tz, yaw, 0.7, 0.07, 1.6, PAINT_W);
      for (const e of [-0.65, 0.65]) block(built, tx + vx * e, DY + 0.45, tz + vz * e, yaw, 0.6, 0.9, 0.06, STEEL);
    }
    // steps down off the landward end onto the grass
    for (let i = 0; i < 3; i++) block(built, px(-0.35 - i * 0.35, 0), g0 + 0.05, pz(-0.35 - i * 0.35, 0), yaw, 0.35, 0.1 + 0.001 * i, 3.2, WOOD[i & 3]);

    // the landing pontoon on the head's south side, and the gangway down to it
    const PS0 = L - HEAD - 6, PS1 = L + 2, PL = -HEADW - 1.9, PTOP = SEA + 0.42;
    block(built, px((PS0 + PS1) / 2, PL), PTOP - 0.22, pz((PS0 + PS1) / 2, PL), yaw, PS1 - PS0, 0.44, 2.6, 0x4a4a46);
    for (let s = PS0 + 0.2; s < PS1; s += 0.34) block(built, px(s, PL), PTOP + 0.01, pz(s, PL), yaw, 0.28, 0.05, 2.5, WOOD[(s * 3 | 0) & 3]);
    for (let s = PS0 + 1; s < PS1; s += 3.2) {             // cleats on the outer edge
      block(built, px(s, PL - 1.15), PTOP + 0.09, pz(s, PL - 1.15), yaw, 0.34, 0.08, 0.08, STEEL);
    }
    // black fenders along the outer edge
    for (let s = PS0 + 0.8; s < PS1; s += 2.4) block(built, px(s, PL - 1.36), PTOP - 0.18, pz(s, PL - 1.36), yaw, 0.7, 0.26, 0.14, BLACK);
    {
      const gs0 = L - HEAD + 0.4, gl0 = -3.2, gs1 = PS0 + 3.2, gl1 = PL + 0.5;
      beam(built, px(gs0, gl0), DY, pz(gs0, gl0), px(gs1, gl1), PTOP + 0.05, pz(gs1, gl1), 1.1, 0.08, 0x6a6a64);
      for (const e of [-0.55, 0.55]) {
        beam(built, px(gs0, gl0 + e), DY + 0.95, pz(gs0, gl0 + e), px(gs1, gl1 + e), PTOP + 1.0, pz(gs1, gl1 + e), 0.05, 0.05, STEEL);
      }
    }
    for (let s = PS0; s <= PS1 + 0.01; s += 2) pierObs.push({ x: px(s, PL), z: pz(s, PL), r: 1.4, kind: "pontoon" });
    obstacleGroup(pierObs);
    const moorings = CBZ.sharkSeaMoorings = [];
    const pierHeading = th;            // boats lie along the pier axis
    moorings.push({ x: px(PS0 + 2.5, PL - 3.4), z: pz(PS0 + 2.5, PL - 3.4), heading: pierHeading, kind: "pontoon", maxLoa: 8 });
    moorings.push({ x: px(PS1 - 2.5, PL - 3.4), z: pz(PS1 - 2.5, PL - 3.4), heading: pierHeading, kind: "pontoon", maxLoa: 8 });
    S.pier = { bearing: th, root: R0, length: L, waterline: WLp, deckY: DY,
      head: { x: px(L - HEAD / 2, 0), z: pz(L - HEAD / 2, 0) },
      mid: { x: px((WLp - R0 + L) / 2, 0), z: pz((WLp - R0 + L) / 2, 0) } };

    // ---- THE LIFEGUARD TOWER AND THE FLAGS ---------------------------------
    {
      const a = th - 0.2, WLt = waterlineAt(a), r = WLt - 9;
      const tx = cx + Math.cos(a) * r, tz = cz + Math.sin(a) * r, gy = ground(tx, tz);
      const tyaw = -a;
      const ox = Math.cos(a), oz = Math.sin(a), sx = -oz, sz = ox;
      const P = gy + 2.2;                 // platform height
      for (const e of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        const lx = tx + ox * e[0] * 1.1 + sx * e[1] * 1.1, lz = tz + oz * e[0] * 1.1 + sz * e[1] * 1.1;
        beam(built, lx, gy - 0.3, lz, lx, P, lz, 0.16, 0.16, PAINT_W);
      }
      beam(built, tx + ox * 1.1 + sx * -1.1, gy + 0.3, tz + oz * 1.1 + sz * -1.1, tx + ox * 1.1 + sx * 1.1, P - 0.2, tz + oz * 1.1 + sz * 1.1, 0.08, 0.1, PAINT_W);
      beam(built, tx - ox * 1.1 + sx * -1.1, gy + 0.3, tz - oz * 1.1 + sz * -1.1, tx - ox * 1.1 + sx * 1.1, P - 0.2, tz - oz * 1.1 + sz * 1.1, 0.08, 0.1, PAINT_W);
      block(built, tx + ox * 0.6, P + 0.06, tz + oz * 0.6, tyaw, 3.8, 0.12, 2.8, PAINT_W);   // deck, overhanging seaward
      block(built, tx - ox * 0.2, P + 1.1, tz - oz * 0.2, tyaw, 2.2, 2.0, 2.4, TOWER);       // cabin
      block(built, tx + ox * 0.92, P + 1.35, tz + oz * 0.92, tyaw, 0.04, 0.8, 1.9, 0x1a2a33); // the window facing the sea
      beam(built, tx - ox * 1.6, P + 2.1, tz - oz * 1.6, tx + ox * 1.5, P + 2.45, tz + oz * 1.5, 3.0, 0.1, 0xd7d9d4); // roof
      beam(built, tx - ox * 1.3, P, tz - oz * 1.3, tx - ox * 4.4, gy + 0.05, tz - oz * 4.4, 1.0, 0.08, PAINT_W);        // ramp
      for (const e of [-1, 1]) {                                                            // deck rail
        const rx = tx + ox * 2.4 + sx * e * 1.35, rz = tz + oz * 2.4 + sz * e * 1.35;
        beam(built, rx, P + 1.0, rz, tx + ox * 1.1 + sx * e * 1.35, P + 1.0, tz + oz * 1.1 + sz * e * 1.35, 0.06, 0.06, PAINT_W);
        beam(built, rx, P, rz, rx, P + 1.0, rz, 0.07, 0.07, PAINT_W);
      }
      beam(built, tx + ox * 2.4 + sx * -1.35, P + 1.0, tz + oz * 2.4 + sz * -1.35, tx + ox * 2.4 + sx * 1.35, P + 1.0, tz + oz * 2.4 + sz * 1.35, 0.06, 0.06, PAINT_W);
      // a rescue board leaning on the legs
      beam(built, tx + sx * 1.3, gy + 0.1, tz + sz * 1.3, tx + sx * 1.35 + ox * 0.3, gy + 2.8, tz + sz * 1.35 + oz * 0.3, 0.55, 0.08, 0xc9a51f);
      // the flag pole: purple (dangerous marine life) over red (no swimming)
      const fx = tx + sx * 3.2 + ox * 1.5, fz = tz + sz * 3.2 + oz * 1.5;
      post(built, fx, gy - 0.4, fz, gy + 6.8, 0.045, PAINT_W);
      block(built, fx + sx * 0.62, gy + 6.35, fz + sz * 0.62, tyaw, 0.03, 0.75, 1.2, PURPLE);
      block(built, fx + sx * 0.62, gy + 5.45, fz + sz * 0.62, tyaw, 0.03, 0.75, 1.2, RED);
      S.tower = { x: tx, z: tz, y: P };
    }

    // ---- ROCK OUTCROPS + THE SEA STACK ------------------------------------
    // One jittered icosahedron per boulder. The jitter is hashed off the UNIT
    // vertex, so the copies of a vertex that three faces share all move the
    // same way and the rock stays watertight.
    const ICO = new THREE.IcosahedronGeometry(1, 2).toNonIndexed();
    function boulder(x, z, rw, top, salt, lean) {
      const bed = ground(x, z) - 1.2;
      const hgt = top - bed;
      // a rock standing in deep water gets a base to match, or it is a pencil
      rw = Math.max(rw, hgt * 0.26);
      const g = ICO.clone(), P = g.attributes.position.array;
      for (let i = 0; i < P.length; i += 3) {
        const k = Math.round(P[i] * 97) * 7 + Math.round(P[i + 1] * 97) * 131 + Math.round(P[i + 2] * 97) * 1009;
        // lumps, not crumples: low-frequency swell off the unit direction plus
        // a little per-vertex grit
        const ux0 = P[i], uy0 = P[i + 1], uz0 = P[i + 2], sp = salt * 0.37;
        const j = 0.86 + 0.13 * Math.sin(ux0 * 2.7 + sp) * Math.cos(uz0 * 2.3 - sp * 1.3) +
          0.09 * Math.sin(uy0 * 3.9 + ux0 * 1.7 + sp * 2.1) + (h01(k * 0.013 + salt, salt * 1.7) - 0.5) * 0.08;
        P[i] *= j; P[i + 2] *= j; P[i + 1] *= 0.9 + (j - 0.86) * 0.6;
        // a flatter top, a fuller foot
        if (P[i + 1] > 0.55) P[i + 1] = 0.55 + (P[i + 1] - 0.55) * 0.45;
        if (P[i + 1] < -0.3) { P[i] *= 1.15; P[i + 2] *= 1.15; }
      }
      g.computeVertexNormals();
      _e.set(lean || 0, h01(salt, 9) * 6.28, (lean || 0) * 0.6); _q.setFromEuler(_e);
      _s.set(rw, hgt / 1.55, rw * (0.75 + h01(salt, 4) * 0.4));
      // the scaled unit shape spans -1..0.55 in y after the flattening, so the
      // centre that puts its crown at `top` is top - 0.55 * sy
      const sy = hgt / 1.55;
      _m4.compose(new THREE.Vector3(x, top - 0.55 * sy, z), _q, _s);
      rocks.add(g, _m4, function (qx, qy, qz, k) {
        const d = qy - SEA;
        const n = h01(k * 0.71 + salt, qx * 0.3 + qz);
        if (d > 0.9) return d > 2.2 && n > 0.8 ? 0x55534b : (n > 0.5 ? 0x24211c : 0x1b1915);   // dry basalt, guano flecks up top
        if (d > -0.5) return n > 0.7 ? 0x3a3831 : 0x0e0f0d;                                   // the wet black band
        return d > -6 ? (n > 0.5 ? 0x16150d : 0x10120b) : 0x0b0d09;                           // weed, then dark
      });
      g.dispose();
      // its radius where it breaks the surface (the unit shape is ~a sphere
      // below the flattened crown), which is what a swimmer or a hull meets
      const yu = (SEA - (top - 0.55 * sy)) / sy;
      return rw * 0.92 * Math.sqrt(Math.max(0.04, 1 - yu * yu));
    }
    const OUTCROPS = [
      { a: th + 0.95, r: 18, n: 4, big: 3.4 },
      { a: th + 2.2, r: 26, n: 5, big: 4.2 },
      { a: th + 3.5, r: 14, n: 3, big: 3.0 },
      { a: th + 4.4, r: 30, n: 5, big: 4.6 },
      { a: th - 0.95, r: 22, n: 4, big: 3.6 },
    ];
    const perches = S._perches || [];
    OUTCROPS.forEach(function (O, oi) {
      const WLo = waterlineAt(O.a), obs = [];
      const bx = cx + Math.cos(O.a) * (WLo + O.r), bz = cz + Math.sin(O.a) * (WLo + O.r);
      for (let i = 0; i < O.n; i++) {
        const ang = h01(oi * 13 + i, 1) * 6.28, dist = i === 0 ? 0 : 2.5 + h01(oi * 13 + i, 2) * 5.5;
        const x = bx + Math.cos(ang) * dist, z = bz + Math.sin(ang) * dist;
        const rw = i === 0 ? O.big : 1.2 + h01(oi, i + 3) * 2.1;
        const top = SEA + (i === 0 ? 2.2 + h01(oi, 7) * 2.6 : -0.4 + h01(oi * 5 + i, 8) * 1.6);
        const rs = boulder(x, z, rw, top, oi * 17 + i * 3 + 1, (h01(oi, i + 11) - 0.5) * 0.4);
        obs.push({ x: x, z: z, r: Math.max(0.6, rs), kind: "rock", under: top < SEA - 0.2 });
        if (i === 0) perches.push({ x: x, y: top - 0.1, z: z });
      }
      obstacleGroup(obs);
    });
    // THE SEA STACK: a tall broken pillar with a skeletal beacon on top
    {
      const a = th + 0.62, WLs = waterlineAt(a), r = WLs + 44;
      const sx0 = cx + Math.cos(a) * r, sz0 = cz + Math.sin(a) * r;
      const top = SEA + 10;
      // a craggy column: a broad foot, a body, a crown, and two fallen blocks
      const r0 = boulder(sx0, sz0, 10, SEA + 2.2, 991, 0.05);
      boulder(sx0 + 0.8, sz0 - 0.6, 6.4, top - 2.5, 992, -0.06);
      boulder(sx0 - 0.4, sz0 + 0.3, 4.4, top + 1.2, 994, 0.08);
      const r1 = boulder(sx0 + 8, sz0 - 4, 4.2, SEA + 2.4, 993, -0.12);
      const r2 = boulder(sx0 - 7, sz0 + 6, 3.6, SEA + 0.8, 995, 0.2);
      obstacleGroup([
        { x: sx0, z: sz0, r: r0, kind: "stack" },
        { x: sx0 + 8, z: sz0 - 4, r: r1, kind: "rock" },
        { x: sx0 - 7, z: sz0 + 6, r: r2, kind: "rock" },
      ]);
      // beacon: a four-legged steel frame, a platform, a daymark and a lantern
      const by = top + 1.05, H = 5.5;
      for (const e of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        beam(built, sx0 + e[0] * 1.0, by - 0.4, sz0 + e[1] * 1.0, sx0 + e[0] * 0.35, by + H, sz0 + e[1] * 0.35, 0.12, 0.12, PAINT_W);
      }
      for (let k = 1; k < 4; k++) {
        const y = by + H * k / 4, w = 1.0 - 0.65 * k / 4;
        beam(built, sx0 - w, y, sz0 - w, sx0 + w, y, sz0 - w, 0.06, 0.06, PAINT_W);
        beam(built, sx0 - w, y, sz0 + w, sx0 + w, y, sz0 + w, 0.06, 0.06, PAINT_W);
        beam(built, sx0 - w, y, sz0 - w, sx0 - w, y, sz0 + w, 0.06, 0.06, PAINT_W);
        beam(built, sx0 + w, y, sz0 - w, sx0 + w, y, sz0 + w, 0.06, 0.06, PAINT_W);
      }
      block(built, sx0, by + H * 0.62, sz0, -a, 0.06, 1.4, 1.4, RED);                  // daymark
      block(built, sx0, by + H, sz0, 0, 1.1, 0.12, 1.1, STEEL);
      post(built, sx0, by + H, sz0, by + H + 0.9, 0.24, 0xd8d6c8);
      S.stack = { x: sx0, z: sz0, top: top, light: { x: sx0, y: by + H + 1.05, z: sz0 } };
      perches.push({ x: sx0 + 8, y: SEA + 2.3, z: sz0 - 4 });
      perches.push({ x: sx0 + 3.5, y: top - 2.6, z: sz0 - 3.5 });
    }
    // rubble and fallen boards around the pier's feet, under water
    for (let i = 0; i < 9; i++) {
      const s = WLp - R0 + 3 + h01(i, 21) * (L - (WLp - R0) - 2), l = (h01(i, 22) - 0.5) * 12;
      const x = px(s, l), z = pz(s, l), gy = ground(x, z);
      if (gy > SEA - 1.5) continue;
      boulder(x, z, 0.6 + h01(i, 23) * 0.9, gy + 0.5 + h01(i, 24) * 0.6, 501 + i * 7, 0.3);
    }
    ICO.dispose();

    const builtMesh = built.mesh(wood, "sea-scene-pier");
    builtMesh.castShadow = true; builtMesh.receiveShadow = true;
    root.add(builtMesh);
    const rockMesh = rocks.mesh(stone, "sea-scene-rocks");
    rockMesh.castShadow = true; rockMesh.receiveShadow = true;
    root.add(rockMesh);

    // ============================================================
    //  THINGS THAT FLOAT — instanced, bobbed on the live sea
    // ============================================================
    function whiteColors(geo) {
      const n = geo.attributes.position.count;
      geo.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
      return geo;
    }
    // ---- swim-zone floats + mooring balls: one sphere, many sizes -------------
    const fl = S.floatPts = [];
    {
      const a0 = th - 0.075, a1 = th - 0.42;
      const arcR = function (a) { return waterlineAt(a) + SWIM_R; };
      const corner = function (a) { return { x: cx + Math.cos(a) * arcR(a), z: cz + Math.sin(a) * arcR(a) }; };
      // one polyline: in from the shore, round the arc, back to the shore;
      // floats every 1.25 m along it, a red marker at each corner and every
      // tenth float
      const path = [];
      const inA = waterlineAt(a0) + 3, inB = waterlineAt(a1) + 3;
      path.push({ x: cx + Math.cos(a0) * inA, z: cz + Math.sin(a0) * inA, corner: true });
      const steps = 40;
      for (let i = 0; i <= steps; i++) { const p = corner(a0 + (a1 - a0) * i / steps); p.corner = i === 0 || i === steps; path.push(p); }
      path.push({ x: cx + Math.cos(a1) * inB, z: cz + Math.sin(a1) * inB, corner: true });
      let carry = 0, k = 0;
      for (let i = 0; i + 1 < path.length; i++) {
        const p0 = path[i], p1 = path[i + 1];
        const len = Math.hypot(p1.x - p0.x, p1.z - p0.z);
        for (let d = carry; d < len; d += 1.25) {
          const f = d / len, marker = (p0.corner && d === carry && d < 0.01) || (k % 10) === 0;
          fl.push({ x: p0.x + (p1.x - p0.x) * f, z: p0.z + (p1.z - p0.z) * f,
            s: marker ? 0.34 : 0.19, sy: marker ? 0.9 : 0.72, sink: marker ? 0.12 : 0.07,
            col: marker ? RED : ((k & 1) ? 0xe2b21a : 0xd9d9d0) });
          k++;
          carry = d + 1.25 - len;
        }
        if (carry < 0) carry = 0;
      }
      S.swimZone = { a0: a0, a1: a1, r: SWIM_R };
    }
    // the mooring field: two staggered rows off the pier head, to the north
    const balls = [];
    for (let i = 0; i < 8; i++) {
      const a = th + 0.07 + (i % 4) * 0.075 + (i >= 4 ? 0.035 : 0);
      const r = WLp + 58 + (i >= 4 ? 26 : 0) + h01(i, 31) * 6;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      balls.push({ x: x, z: z });
      fl.push({ x: x, z: z, s: 0.46, sy: 0.9, col: 0xe8e8e4, sink: 0.2 });
      moorings.push({ x: x, z: z, heading: a + Math.PI / 2, kind: "ball", maxLoa: 16 });
    }
    {
      const geo = whiteColors(new THREE.SphereGeometry(1, 10, 7));
      const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
      mat.name = "sea-scene-floats";
      const im = new THREE.InstancedMesh(geo, mat, fl.length);
      for (let i = 0; i < fl.length; i++) im.setColorAt(i, _col.setHex(fl[i].col));
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.name = "sea-scene-floats";
      im.frustumCulled = false;          // spread around the island; a static bound would be wrong
      root.add(im);
      S.floats = im;
    }
    // ---- channel buoys: red nuns to starboard coming in (IALA B), green cans ----
    const navs = S.navPts = [];
    {
      const aC = th + 0.035;              // the approach runs just north of the pier line
      const gates = [WLp + 62, WLp + 105, WLp + 150];
      gates.forEach(function (r, gi) {
        for (const side of [-1, 1]) {
          const a = aC + side * 14 / r;
          // coming IN (toward the island) starboard is the +bearing side
          navs.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r, col: side > 0 ? RED : 0x1f7a3a, lamp: side > 0 ? 0xff3a2a : 0x3aff6a, ph: gi * 0.9 + (side > 0 ? 0 : 0.45) });
        }
      });
      // a yellow special mark on the swim zone's outer corner
      const ay = th - 0.42, ry = waterlineAt(ay) + SWIM_R + 6;
      navs.push({ x: cx + Math.cos(ay) * ry, z: cz + Math.sin(ay) * ry, col: 0xd9a615, lamp: 0xffd23a, ph: 0.2 });
      // one buoy geometry: a flared float, a cage column, a lantern cap
      const parts = new Soup();
      _q.identity();
      _s.set(1, 1, 1);
      const addG = function (geo, y, col) { _m4.compose(new THREE.Vector3(0, y, 0), _q, _s); parts.add(geo, _m4, col); geo.dispose(); };
      addG(new THREE.CylinderGeometry(0.75, 0.62, 0.9, 12), 0.05, 0xffffff);
      addG(new THREE.CylinderGeometry(0.42, 0.75, 0.3, 12), 0.65, 0xffffff);
      addG(new THREE.CylinderGeometry(0.16, 0.36, 1.9, 8), 1.75, 0xffffff);
      addG(new THREE.CylinderGeometry(0.26, 0.26, 0.08, 8), 2.72, 0x444444);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(parts.p, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(parts.n, 3));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(parts.c, 3));
      const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
      mat.name = "sea-scene-navbuoys";
      const im = new THREE.InstancedMesh(geo, mat, navs.length);
      for (let i = 0; i < navs.length; i++) im.setColorAt(i, _col.setHex(navs[i].col));
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.name = "sea-scene-navbuoys"; im.frustumCulled = false;
      root.add(im); S.navs = im;
      // lanterns: unlit, so they read as lights at dusk; they flash
      const lg = whiteColors(new THREE.SphereGeometry(0.17, 8, 6));
      const lm = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, fog: true });
      lm.name = "sea-scene-lanterns";
      const li = new THREE.InstancedMesh(lg, lm, navs.length + 1);
      for (let i = 0; i < navs.length; i++) li.setColorAt(i, _col.setHex(navs[i].lamp));
      li.setColorAt(navs.length, _col.setHex(0xfff2c0));      // the stack's beacon
      if (li.instanceColor) li.instanceColor.needsUpdate = true;
      li.name = "sea-scene-lanterns"; li.frustumCulled = false;
      root.add(li); S.lamps = li;
      obstacleGroup(navs.map(function (n) { return { x: n.x, z: n.z, r: 0.8, kind: "buoy" }; }));
    }

    // ============================================================
    //  SEABIRDS — one gull geometry; the flap is the instance's Y scale
    //  (the wings are a shallow V, so scaling Y through negative is a
    //  downstroke). Perched birds fold: Z scale shrinks the span.
    // ============================================================
    {
      const P = [], C = [];
      const W = new THREE.Color(0xe6e6e0), Gr = new THREE.Color(0x8a939a), K = new THREE.Color(0x1a1a1a), Y = new THREE.Color(0xd8a020);
      function tri(a, b, c, ca, cb, cc) {
        P.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
        for (const q of [ca, cb || ca, cc || ca]) C.push(q.r, q.g, q.b);
      }
      const nose = [0.3, 0.01, 0], tail = [-0.26, 0.02, 0], top = [0.02, 0.07, 0], bot = [0.02, -0.06, 0];
      const lft = [0.02, 0, 0.065], rgt = [0.02, 0, -0.065];
      tri(nose, top, lft, Y, W, W); tri(nose, rgt, top, Y, W, W); tri(nose, lft, bot, Y, W, W); tri(nose, bot, rgt, Y, W, W);
      tri(tail, lft, top, W); tri(tail, top, rgt, W); tri(tail, bot, lft, W); tri(tail, rgt, bot, W);
      tri([-0.24, 0.02, 0.07], [-0.36, 0.02, 0], [-0.24, 0.02, -0.07], W);
      for (const sd of [1, -1]) {
        const rf = [0.08, 0.01, 0.05 * sd], rb = [-0.1, 0.01, 0.05 * sd];
        const ef = [0.06, 0.13, 0.36 * sd], eb = [-0.12, 0.12, 0.34 * sd];   // the elbow
        const tf = [-0.06, 0.06, 0.68 * sd], tb = [-0.2, 0.06, 0.64 * sd];    // the tip droops a little
        tri(rf, ef, rb, Gr); tri(rb, ef, eb, Gr);
        tri(ef, tf, eb, Gr, K, Gr); tri(eb, tf, tb, Gr, K, K);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(C, 3));
      geo.computeVertexNormals();
      const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide });
      mat.name = "sea-scene-gulls";
      const flocks = [
        { kind: "orbit", x: S.pier.head.x, z: S.pier.head.z, r: 13, h: 9, n: 7 },
        { kind: "orbit", x: S.stack.x, z: S.stack.z, r: 17, h: 14, n: 6 },
        { kind: "follow", r: 9, h: 7, n: 7, x: balls[2].x, z: balls[2].z },
      ];
      const st = S.birdSt = [];
      flocks.forEach(function (F, fi) {
        for (let i = 0; i < F.n; i++) {
          st.push({ f: F, ph: h01(fi * 31 + i, 41) * 6.28, rr: F.r * (0.55 + h01(fi * 31 + i, 42) * 0.8),
            w: (0.28 + h01(fi * 31 + i, 43) * 0.2) * (h01(fi, i + 44) > 0.2 ? 1 : -1),
            hh: F.h + (h01(fi * 31 + i, 45) - 0.5) * 6, fl: h01(fi * 31 + i, 46) * 6.28, sc: 1.35 + h01(i, fi + 47) * 0.35 });
        }
      });
      for (let i = 0; i < perches.length && i < 10; i++) {
        const p = perches[i];
        st.push({ perch: p, ph: h01(i, 51) * 6.28, sc: 1.35 });
      }
      const im = new THREE.InstancedMesh(geo, mat, st.length);
      im.name = "sea-scene-gulls"; im.frustumCulled = false;
      root.add(im); S.birds = im;
    }

    A.root.add(root);
    S.group = root;
    S.built = true;
    root.visible = true;               // build() only ever runs inside a playing sharksim match
    tickFloats(0, true);
    tickBirds(0);
    return true;
  }

  // ============================================================
  //  ANIMATION
  // ============================================================
  const _p = new THREE.Vector3();
  function tickFloats(dt, force) {
    S.bobT -= dt;
    if (!force && S.bobT > 0) return;
    S.bobT = 1 / 20;
    const t = S.t;
    const cam = CBZ.camera && CBZ.camera.position;
    const fl = S.floatPts, im = S.floats;
    if (im) {
      for (let i = 0; i < fl.length; i++) {
        const f = fl[i];
        if (!force && cam) {
          const dx = cam.x - f.x, dz = cam.z - f.z;
          if (dx * dx + dz * dz > 360 * 360) continue;
        }
        const y = seaY(f.x, f.z);
        _e.set(Math.sin(t * 1.3 + i) * 0.12, 0, Math.cos(t * 1.1 + i * 0.7) * 0.12); _q.setFromEuler(_e);
        _s.set(f.s, f.s * f.sy, f.s);
        _m4.compose(_p.set(f.x, y + f.s * f.sy * 0.55 - f.sink, f.z), _q, _s);
        im.setMatrixAt(i, _m4);
      }
      im.instanceMatrix.needsUpdate = true;
    }
    const nv = S.navPts, nm = S.navs, lm = S.lamps;
    if (nm) {
      for (let i = 0; i < nv.length; i++) {
        const n = nv[i], y = seaY(n.x, n.z) - 0.35;
        const rx = Math.sin(t * 0.9 + n.ph * 3) * 0.09, rz = Math.cos(t * 0.8 + n.ph * 2) * 0.09;
        _e.set(rx, n.ph, rz); _q.setFromEuler(_e); _s.set(1, 1, 1);
        _m4.compose(_p.set(n.x, y, n.z), _q, _s);
        nm.setMatrixAt(i, _m4);
        // the lantern rides the top of the column; a 4 s cycle, 0.8 s on
        const on = ((t * 0.25 + n.ph) % 1) < 0.2;
        _s.setScalar(on ? 1.25 : 0.001);
        _m4.compose(_p.set(n.x + rz * -2.9, y + 2.95, n.z + rx * 2.9), _q.identity(), _s);
        lm.setMatrixAt(i, _m4);
      }
      nm.instanceMatrix.needsUpdate = true;
      if (S.stack) {
        const on = (t % 6) < 1.0 || ((t % 6) > 1.6 && (t % 6) < 2.4);   // group flash (2)
        _s.setScalar(on ? 2.4 : 0.001);
        _m4.compose(_p.set(S.stack.light.x, S.stack.light.y, S.stack.light.z), _q.identity(), _s);
        lm.setMatrixAt(nv.length, _m4);
      }
      lm.instanceMatrix.needsUpdate = true;
    }
  }
  function followTarget(F) {
    // the flock goes to whatever boat is under way nearest its last spot
    const list = CBZ.seaCraft && CBZ.seaCraft.list ? CBZ.seaCraft.list() : null;
    let best = null, bd = 1e12;
    if (list) for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (!r || r.dead || !r.pos) continue;
      const sp = Math.hypot(r.vx || 0, r.vz || 0) + Math.abs(r.v || 0);
      if (sp < 1.2) continue;
      const d = (r.pos.x - F.x) * (r.pos.x - F.x) + (r.pos.z - F.z) * (r.pos.z - F.z);
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  }
  function tickBirds(dt) {
    const im = S.birds; if (!im) return;
    const t = S.t, st = S.birdSt;
    // the following flock eases its centre onto its boat
    for (let i = 0; i < st.length; i++) {
      const F = st[i].f;
      if (!F || F.kind !== "follow" || F._t === t) continue;
      F._t = t;
      const b = followTarget(F);
      if (b) {
        const k = Math.min(1, dt * 0.8);
        // trail a little astern of the boat, the way gulls work a wake
        const h = b.heading || 0;
        F.x += (b.pos.x - Math.sin(h) * 6 - F.x) * k;
        F.z += (b.pos.z - Math.cos(h) * 6 - F.z) * k;
      }
    }
    for (let i = 0; i < st.length; i++) {
      const b = st[i];
      if (b.perch) {
        const p = b.perch;
        const bob = Math.sin(t * 0.7 + b.ph) * 0.12;
        _e.set(0, b.ph + bob, 0, "YXZ"); _q.setFromEuler(_e);
        _s.set(b.sc * 0.85, b.sc * 0.5, b.sc * 0.18);
        _m4.compose(_p.set(p.x, p.y + 0.1, p.z), _q, _s);
        im.setMatrixAt(i, _m4);
        continue;
      }
      const F = b.f;
      const ang = b.ph + t * b.w;
      const wob = Math.sin(t * 0.37 + b.ph * 2) * 0.25;
      const rr = b.rr * (1 + wob * 0.5);
      const x = F.x + Math.cos(ang) * rr, z = F.z + Math.sin(ang) * rr;
      const y = seaY(x, z) + b.hh + Math.sin(t * 0.5 + b.ph) * 2.2;
      // direction of travel is the tangent of the orbit
      const dirx = -Math.sin(ang) * Math.sign(b.w), dirz = Math.cos(ang) * Math.sign(b.w);
      const head = Math.atan2(dirz, dirx);
      const bank = -Math.sign(b.w) * 0.42;
      // gulls glide more than they flap: bursts of beats, then a long soar
      const cyc = (t * 0.35 + b.fl) % 1;
      const flap = cyc < 0.35 ? Math.cos(t * 11 + b.fl * 5) : 0.85 + Math.sin(t * 1.3 + b.ph) * 0.1;
      _e.set(bank, -head, 0, "YXZ"); _q.setFromEuler(_e);
      _s.set(b.sc, b.sc * flap, b.sc);
      _m4.compose(_p.set(x, y, z), _q, _s);
      im.setMatrixAt(i, _m4);
    }
    im.instanceMatrix.needsUpdate = true;
  }

  // ============================================================
  //  COLLISION — wrap the water field once, sharksim only
  // ============================================================
  function installNav() {
    const wf = CBZ.waterField;
    if (!wf || wf._seaSceneWrapped) return;
    // wrap ON TOP of water_survival.js's island navigator, never under it
    if (!wf._survNavWrapped || typeof wf.moveInWater !== "function" || typeof wf.isNavigableWater !== "function") return;
    wf._seaSceneWrapped = true;
    const nav = wf.isNavigableWater;
    wf.isNavigableWater = function (x, z, clearance) {
      const ok = nav.call(this, x, z, clearance);
      if (!ok || !live()) return ok;
      return !blockedAt(x, z, Math.max(0, +clearance || 0) * 0.35);
    };
    const mv = wf.moveInWater;
    wf.moveInWater = function (x, z, heading, distance, clearance, t, out) {
      const r = mv.call(this, x, z, heading, distance, clearance, t, out);
      if (!live() || !r || r.blocked) return r;
      const pad = Math.max(0, +clearance || 0) * 0.35;
      if (!blockedAt(r.x, r.z, pad)) return r;
      // slide round it: the shallowest turn that is clear wins
      const h0 = r.heading, d = Math.max(0.01, Math.hypot(r.x - x, r.z - z));
      for (let i = 1; i <= 4; i++) {
        for (let sgn = -1; sgn <= 1; sgn += 2) {
          const h = h0 + sgn * i * 0.4;
          const nx = x + Math.cos(h) * d, nz = z + Math.sin(h) * d;
          if (!blockedAt(nx, nz, pad) && nav.call(wf, nx, nz, clearance)) {
            r.x = nx; r.z = nz; r.heading = h;
            S.slides = (S.slides || 0) + 1;
            return r;
          }
        }
      }
      r.x = x; r.z = z; r.blocked = true;
      return r;
    };
  }
  // boats: pushed out of the same circles after they move
  function pushCraft() {
    const list = CBZ.seaCraft && CBZ.seaCraft.list ? CBZ.seaCraft.list() : null;
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (!r || r.dead || !r.pos) continue;
      const spec = r._hullSpec || {};
      const pad = Math.max(0.6, (spec.beam || 2) * 0.5);
      const o = blockedAt(r.pos.x, r.pos.z, pad);
      if (!o || o.under) continue;
      const dx = r.pos.x - o.x, dz = r.pos.z - o.z, dl = Math.hypot(dx, dz) || 1;
      const nx = dx / dl, nz = dz / dl, want = o.r + pad;
      const push = Math.min(1.2, want - dl);
      r.pos.x += nx * push; r.pos.z += nz * push;
      if (r.group) { r.group.position.x = r.pos.x; r.group.position.z = r.pos.z; }
      const into = -((r.vx || 0) * nx + (r.vz || 0) * nz);
      if (into > 0) {
        r.vx = (r.vx || 0) + nx * into; r.vz = (r.vz || 0) + nz * into;
        if (typeof r.v === "number") r.v *= 0.7;
      }
      S.pushes = (S.pushes || 0) + 1;
    }
  }

  // Order 93: before shark_sim.js's setup/step (94), so the moorings exist the
  // frame the fleet is spawned.
  CBZ.onAlways(93, function (dt) {
    if (!dt || dt > 0.5) dt = 0.05;
    // Only inside a live sharksim match: never at boot or on the title card
    // (a ?mode=sharksim page sits in mode "sharksim" behind the title, and a
    // launch frame must not show anything from this file).
    const st = CBZ.game && CBZ.game.state;
    const on = CBZ.game && CBZ.game.mode === "sharksim" && (st === "playing" || st === "won" || st === "lost");
    if (!on) { if (S.group && S.group.visible) S.group.visible = false; return; }
    if (!S.built) { if (st !== "playing" || !build()) return; }
    if (S.group.parent !== (arena() && arena().root) && arena() && arena().root) arena().root.add(S.group);
    if (!S.group.visible) S.group.visible = true;
    installNav();
    S.t += dt;
    tickFloats(dt, false);
    tickBirds(dt);
    if (st === "playing") pushCraft();
  });
  if (CBZ.always && CBZ.always.sort) CBZ.always.sort(function (a, b) { return a.order - b.order; });
})();
