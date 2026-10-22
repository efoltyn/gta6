/* ============================================================
   world/island_fitkit.js — THE FIT-OUT KIT for an island venue's rooms.

   CBZ.islandFit.kit(b, opts) -> K
     One merged mesh per building fit-out (vertex colours, one shared
     material; a glass bucket and a lit bucket beside it), so a furnished
     office floor, a council chamber or a flat costs a draw call or three,
     not a mesh per box. Every box is in WORLD axes (the island's buildings
     only ever turn a quarter at a time), which is exactly the host box
     CBZ.furnish (city/furniture.js) draws its pieces through: pass
     { box: K.box } and a sofa, a bed or a desk lands in the merge with its
     seat / bed anchor registered where it really is.
       K.box(x, y, z, w, h, d, col, o)    world box (o.solid / o.y0 o.y1 /
                                          o.noStep: a collider; o.glow lit;
                                          o.glass see-through; o.plat walk top)
       K.lbox(lx, ly, lz, w, h, d, col, o) the same in the building's frame
                                          (door on local -z, ly over b.gy)
       K.lw(lx, lz) -> {x, z}   K.yaw(localYaw) -> world yaw
       K.quad(a, b, c, d, col)            a flat world quad (bunting, signs)
       K.flush() -> [meshes]              into the island's root, inside
                                          the building's room LOD (opts.rooms)
       K.furnish(name, lx, lz, ly, lyaw, o) -> CBZ.furnish[name] in this frame
     The colliders and anchors a fit-out makes while islandVenue runs it
     leave with the island by themselves (island_venue.js's census).

   CBZ.islandFit.text(lines, opts) -> a canvas texture (signs, price cards)
   CBZ.islandFit.fixtures(kind, spec)  registerFixtures({islands: true}) for
     a venue's things, once the card is loaded; spec.list(ctx, px, pz).
   CBZ.islandFit.hour()       the hour on the sky clock (0..24)
   CBZ.islandFit.onShift(h)   true when [on, off) covers the hour (wraps)

   THE PEOPLE who work in these rooms are CBZ.islandVenue.staff's posts
   (world/island_venue.js): a shift, a floor, a way out at the end of it.
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  if (!window.THREE) return;
  const THREE = window.THREE;

  /* ---- MATERIALS: shared for the session -------------------------------- */
  let M = null;
  function mats() {
    if (M) return M;
    const solid = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
    const glow = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });
    const glass = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.28, depthWrite: false });
    solid.name = "island-fit"; glow.name = "island-fit-lit"; glass.name = "island-fit-glass";
    for (const m of [solid, glow, glass]) m._shared = true;
    // after dark the room is lit by its own fixtures (world/island_night.js)
    if (CBZ.islandRoomLight) { CBZ.islandRoomLight(solid, false); CBZ.islandRoomLight(glow, true); }
    M = { solid: solid, glow: glow, glass: glass };
    return M;
  }

  /* ---- THE BUILDING'S FRAME (quarter turns: world axes stay boxes) ------- */
  function frameOf(b) {
    const yaw = b.rotY || 0, co = Math.cos(yaw), si = Math.sin(yaw);
    const quarter = Math.abs(Math.round(si)) === 1;
    return {
      yaw: yaw, quarter: quarter,
      w: function (lx, lz) { return { x: b.ox + lx * co + lz * si, z: b.oz - lx * si + lz * co }; },
      l: function (x, z) { const dx = x - b.ox, dz = z - b.oz; return { x: dx * co - dz * si, z: dx * si + dz * co }; },
      // a local direction yaw (forward = (sin, cos) in the building's frame)
      wyaw: function (ly) { return (ly || 0) + yaw; },
    };
  }

  const _c = new THREE.Color();
  // the island build's slice clock (world/disaster_arena.js), and a run to the end
  function late() { return !!(CBZ.sliceLate && CBZ.sliceLate()); }
  function drain(it) { let r = it.next(); while (!r.done) r = it.next(); return r.value; }
  function kit(b, opts) {
    opts = opts || {};
    const F = frameOf(b);
    const ox = b.ox, oy = b.gy || 0, oz = b.oz;
    /* (the buckets are float32 from the start, in fixed chunks of 4,096
       faces: a tower's fit-out is millions of numbers, and as JS arrays they
       were a garbage storm and a ~300 ms Float32Array copy in one step; the
       values are the same, stored as float32 either way, and a full chunk
       is never copied until the flush lays them end to end) */
    // (a chunk is 128 faces at first, doubling to 4,096: most kits are a
    // stairwell's few boxes, a few towers' are millions of numbers)
    const CH = 18 * 4096, CH0 = 18 * 128;
    function Buf() { return { ch: [], P: null, N: null, C: null, o: 0, cap: 0, len: 0 }; }
    const buckets = { solid: Buf(), glow: Buf(), glass: Buf() };
    const cols = [], plats = [];
    const meshes = [];
    function face(B, ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, nx, ny, nz, r, g2, bl) {
      // two triangles a-b-c, a-c-d
      if (B.o >= B.cap) {
        const cap = B.cap ? Math.min(CH, B.cap * 2) : CH0;
        B.P = new Float32Array(cap); B.N = new Float32Array(cap); B.C = new Float32Array(cap);
        B.ch.push([B.P, B.N, B.C]); B.o = 0; B.cap = cap;
      }
      const P = B.P, N = B.N, C = B.C;
      let o = B.o;
      P[o] = ax; P[o + 1] = ay; P[o + 2] = az; P[o + 3] = bx; P[o + 4] = by; P[o + 5] = bz;
      P[o + 6] = cx; P[o + 7] = cy; P[o + 8] = cz; P[o + 9] = ax; P[o + 10] = ay; P[o + 11] = az;
      P[o + 12] = cx; P[o + 13] = cy; P[o + 14] = cz; P[o + 15] = dx; P[o + 16] = dy; P[o + 17] = dz;
      for (let i = 0; i < 6; i++, o += 3) { N[o] = nx; N[o + 1] = ny; N[o + 2] = nz; C[o] = r; C[o + 1] = g2; C[o + 2] = bl; }
      B.o = o; B.len += 18;
    }
    // the chunks end to end (attribute q: 0 position, 1 normal, 2 colour)
    function* joined(B, q) {
      const out = new Float32Array(B.len);
      let at = 0;
      for (let i = 0; i < B.ch.length; i++) {
        const a = B.ch[i][q], n = Math.min(a.length, B.len - at);
        out.set(n === a.length ? a : a.subarray(0, n), at);
        at += n;
        if (late()) yield 0;
      }
      return out;
    }
    function addBox(B, x, y, z, w, h, d, col, nb) {
      _c.setHex(col == null ? 0x8a8f95 : col);
      const r = _c.r, g2 = _c.g, bl = _c.b;
      const x0 = x - w / 2 - ox, x1 = x + w / 2 - ox, y0 = y - h / 2 - oy, y1 = y + h / 2 - oy, z0 = z - d / 2 - oz, z1 = z + d / 2 - oz;
      face(B, x0, y1, z0, x0, y1, z1, x1, y1, z1, x1, y1, z0, 0, 1, 0, r, g2, bl);      // top
      if (!nb) face(B, x0, y0, z1, x0, y0, z0, x1, y0, z0, x1, y0, z1, 0, -1, 0, r * 0.7, g2 * 0.7, bl * 0.7);   // (nb: stood on something, never seen from under)
      face(B, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, 0, 0, 1, r, g2, bl);      // +z
      face(B, x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0, 0, 0, -1, r, g2, bl);     // -z
      face(B, x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1, 1, 0, 0, r, g2, bl);      // +x
      face(B, x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0, -1, 0, 0, r, g2, bl);     // -x
    }
    const K = {
      b: b, F: F, cols: cols, plats: plats,
      lw: F.w, yaw: F.wyaw,
      // a world-axis box: the host box CBZ.furnish draws through
      box: function (x, y, z, w, h, d, col, o) {
        o = o || {};
        if (w <= 0 || h <= 0 || d <= 0) return null;
        const B = o.glow || o.emissive != null ? buckets.glow : o.glass ? buckets.glass : buckets.solid;
        if (!o.noVis) addBox(B, x, y, z, w, h, d, o.emissive != null && !o.glow ? (o.emissive | 0) : col, !!o.nb);
        let rec = true;
        if (o.solid) {
          const c = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, ref: null,
            y0: o.y0 != null ? o.y0 : y - h / 2, y1: o.y1 != null ? o.y1 : y + h / 2 };
          if (o.noStep) c.noStep = true;
          if (o.noBreach) c.noBreach = true;
          cols.push(c); rec = c;
          // (opts.raw: inside an island's own build, where CBZ.colliders is the
          // build's private list and the world's grid must not hear of it)
          if (CBZ.colliderAddMany && !opts.raw) CBZ.colliderAddMany([c]); else (CBZ.colliders || (CBZ.colliders = [])).push(c);
        }
        if (o.plat) {
          const p = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: y + h / 2 };
          plats.push(p);
          if (CBZ.platformAddMany && !opts.raw) CBZ.platformAddMany([p]); else (CBZ.platforms || (CBZ.platforms = [])).push(p);
        }
        return rec;        // the collider record when it is solid (a door that opens needs it)
      },
      // the same box, in the building's frame (y over the building's ground)
      lbox: function (lx, ly, lz, w, h, d, col, o) {
        const c = F.w(lx, lz);
        // a collider band given in the building's frame is over its ground too
        if (o && (o.y0 != null || o.y1 != null)) {
          o = Object.assign({}, o);
          if (o.y0 != null) o.y0 += oy;
          if (o.y1 != null) o.y1 += oy;
        }
        return K.box(c.x, oy + ly, c.z, F.quarter ? d : w, h, F.quarter ? w : d, col, o);
      },
      quad: function (a, bq, c, d, col, lit) {
        const B = lit ? buckets.glow : buckets.solid;
        _c.setHex(col);
        const ux = bq[0] - a[0], uy = bq[1] - a[1], uz = bq[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
        const P = function (q) { return [q[0] - ox, q[1] - oy, q[2] - oz]; };
        const A = P(a), Bq = P(bq), C = P(c), D = P(d);
        face(B, A[0], A[1], A[2], Bq[0], Bq[1], Bq[2], C[0], C[1], C[2], D[0], D[1], D[2], nx, ny, nz, _c.r, _c.g, _c.b);
        // the back face too (bunting, flags: seen from both sides)
        face(B, A[0], A[1], A[2], D[0], D[1], D[2], C[0], C[1], C[2], Bq[0], Bq[1], Bq[2], -nx, -ny, -nz, _c.r, _c.g, _c.b);
      },
      // CBZ.furnish in this building's frame: (lx, lz) local, ly the floor
      // over the building's ground, lyaw the way the piece faces (local)
      furnish: function (name, lx, lz, ly, lyaw, o) {
        const Fn = CBZ.furnish && CBZ.furnish[name];
        if (!Fn) return null;
        const c = F.w(lx, lz);
        return Fn(c.x, oy + ly, c.z, F.wyaw(lyaw), Object.assign({ box: K.box, ox: 0, oz: 0, tone: "auto" }, o || {}));
      },
      flush: function () { return drain(K.flushSteps()); },
      // the same, a bucket's copy and bounds a step (CBZ.sliceLate)
      flushSteps: function* () {
        const MM = mats();
        const parent = opts.parent || (b.group && b.group.parent) || null;
        if (!parent) return meshes;
        for (const k of ["solid", "glow", "glass"]) {
          const B = buckets[k];
          if (!B.len) continue;
          const geo = new THREE.BufferGeometry();
          geo.setAttribute("position", new THREE.BufferAttribute(yield* joined(B, 0), 3));
          geo.setAttribute("normal", new THREE.BufferAttribute(yield* joined(B, 1), 3));
          geo.setAttribute("color", new THREE.BufferAttribute(yield* joined(B, 2), 3));
          if (CBZ.sphereSteps) yield* CBZ.sphereSteps(geo); else geo.computeBoundingSphere();
          const m = new THREE.Mesh(geo, MM[k]);
          m.position.set(ox, oy, oz);
          m.name = "island-fit-" + (opts.name || b.use || "venue");
          m.castShadow = k === "solid" && !!opts.cast; m.receiveShadow = k !== "glow";
          if (k === "glass") m.renderOrder = 2;
          m.matrixAutoUpdate = false; m.updateMatrix();
          m.userData.fitKit = true;
          parent.add(m);
          meshes.push(m);
          // walls a fit-out stands (a motel's, a cabin's) block sight and the camera
          if (opts.los && k === "solid") (CBZ.losBlockers || (CBZ.losBlockers = [])).push(m);
          if (opts.rooms !== false && b.group) {
            const ud = b.group.userData;
            (ud.rooms || (ud.rooms = [])).push(m);
            if (ud.roomsOn === false) m.visible = false;
          }
          buckets[k] = Buf();
          if (late()) yield 0;
        }
        return meshes;
      },
      meshes: meshes,
    };
    return K;
  }

  /* ---- TEXT ON A CANVAS (signs, price cards, door numbers) -------------- */
  const texCache = new Map();
  function text(lines, o) {
    o = o || {};
    if (typeof document === "undefined") return null;
    if (typeof lines === "string") lines = [lines];
    const key = lines.join("|") + "|" + (o.bg || "") + "|" + (o.fg || "") + "|" + (o.w || 256) + "x" + (o.h || 64);
    if (texCache.has(key)) return texCache.get(key);
    const W = o.w || 256, H = o.h || 64;
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const g2 = cv.getContext("2d");
    if (!g2) return null;
    g2.fillStyle = o.bg || "#f4f1e8"; g2.fillRect(0, 0, W, H);
    if (o.border !== false) { g2.strokeStyle = o.fg || "#1b1f24"; g2.lineWidth = Math.max(2, H * 0.05); g2.strokeRect(H * 0.08, H * 0.08, W - H * 0.16, H - H * 0.16); }
    g2.fillStyle = o.fg || "#1b1f24";
    g2.textAlign = "center"; g2.textBaseline = "middle";
    const n = lines.length, lh = H / (n + 0.4);
    for (let i = 0; i < n; i++) {
      let fs = Math.floor(lh * (i === 0 ? 0.78 : 0.6));
      g2.font = "bold " + fs + "px Helvetica, Arial, sans-serif";
      while (g2.measureText(lines[i]).width > W * 0.88 && fs > 8) { fs -= 2; g2.font = "bold " + fs + "px Helvetica, Arial, sans-serif"; }
      g2.fillText(lines[i], W / 2, lh * (i + 0.7));
    }
    const t = new THREE.CanvasTexture(cv);
    if (THREE.sRGBEncoding != null) t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 4;
    texCache.set(key, t);
    return t;
  }
  // a flat textured panel (a sign) facing local yaw `lyaw` of building b
  function panel(b, parent, lx, ly, lz, w, h, lyaw, tex, lit) {
    const F = frameOf(b);
    const mat = lit ? new THREE.MeshBasicMaterial({ map: tex }) : new THREE.MeshLambertMaterial({ map: tex });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    const c = F.w(lx, lz);
    m.position.set(c.x, (b.gy || 0) + ly, c.z);
    m.rotation.y = F.wyaw(lyaw);
    m.name = "island-fit-sign";
    (parent || (b.group && b.group.parent)).add(m);
    return m;
  }

  /* ---- THE CARD: a venue's things, asked only on the islands ------------- */
  const pending = [];
  function fixtures(kind, spec) {
    spec.id = spec.id || kind; spec.kind = kind; spec.islands = true;
    pending.push(spec);
    wire();
  }
  function wire() {
    const I = CBZ.interactions;
    if (!I || !I.registerFixtures) return false;
    while (pending.length) { try { I.registerFixtures(pending.shift()); } catch (e) { console.error("[island fit fixtures]", e); } }
    return true;
  }
  if (CBZ.onUpdate) CBZ.onUpdate(9.13, function () { if (pending.length) wire(); });

  /* ---- THE CLOCK ---------------------------------------------------------- */
  function hour() {
    if (CBZ.cityHour) { const h = +CBZ.cityHour(); if (isFinite(h)) return h; }
    const t = CBZ.dayPhase ? CBZ.dayPhase() : 0.18;
    return ((t * 24 + 6) % 24 + 24) % 24;
  }
  function onShift(hrs) {
    if (!hrs) return true;
    const h = hour(), a = hrs[0], z = hrs[1];
    return a <= z ? (h >= a && h < z) : (h >= a || h < z);
  }
  function hash(s) {
    let h = 2166136261 >>> 0;
    s = String(s);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h / 4294967296;
  }
  function live() { const g = CBZ.game; return !!(g && g.mode === "archipelago"); }

  /* ---- THE EXECUTIVE FLOOR'S PIECES in an island room ---------------------
     city/exec_office.js's mesh kit (rounded leather, walnut, chrome, real
     monitors, plants), building-local: K.at(lx, lz, lyaw, ly) then a piece
     (CBZ.cityMeshKit.pieces), and flushMesh puts the merge in the building
     inside its room LOD. solid() / seat() are the colliders and the seat
     anchors that go with what the eye sees. */
  let lit = false;
  function meshKit() {
    const MK = CBZ.cityMeshKit;
    if (!MK || !MK.pieces) return null;
    const K = MK(0);
    if (!lit && CBZ.islandRoomLight && K.M) {
      lit = true;
      for (const k in K.M) { const m = K.M[k]; if (m && m.isMaterial && k !== "glass") CBZ.islandRoomLight(m, k === "emit" || k === "screen"); }
    }
    return K;
  }
  function flushMesh(b, K, name) { return drain(flushMeshSteps(b, K, name)); }
  function* flushMeshSteps(b, K, name) {
    const out = K.flushSteps ? yield* K.flushSteps(b.group, name || "island-exec") : K.flush(b.group, name || "island-exec");
    const ud = b.group.userData;
    for (const m of out) { (ud.rooms || (ud.rooms = [])).push(m); if (ud.roomsOn === false) m.visible = false; }
    return out;
  }
  // a collider over a building-local rect, y over the building's ground
  function solid(b, x0, x1, z0, z1, y0, y1, o) {
    const F = frameOf(b), a = F.w(x0, z0), c = F.w(x1, z1);
    const r = { minX: Math.min(a.x, c.x), maxX: Math.max(a.x, c.x), minZ: Math.min(a.z, c.z), maxZ: Math.max(a.z, c.z),
      y0: b.gy + y0, y1: b.gy + y1, ref: null, noBreach: true };
    if (o && o.noStep) r.noStep = true;
    if (CBZ.colliderAddMany) CBZ.colliderAddMany([r]); else (CBZ.colliders || (CBZ.colliders = [])).push(r);
    return r;
  }
  // a seat anchor (city/propuse.js) at a building-local spot
  function seat(b, lx, lz, ly, lyaw, kind, cushion) {
    if (!CBZ.propRegisterSeat) return null;
    const F = frameOf(b), w = F.w(lx, lz);
    return CBZ.propRegisterSeat(w.x, b.gy + ly, w.z, F.wyaw(lyaw), kind || "chair", null, { cushion: cushion != null ? cushion : 0.48, floorBelow: 0 });
  }


  /* ======================================================================
     THE SHOP FLOOR, DRESSED — CBZ.islandFit.dress(b, spec) -> D | null

     What a venue's own system stands (the gun rack, the counter, the real
     goods) is the stock; this is the rest of a real shop of that kind: the
     walls lined with its fixtures floor to ceiling, gondolas down the
     middle, its retail lighting, its name on the wall, the back-office
     door. One merge per building (the kit above: one draw call for the
     solid finish, one for the lit lenses, one for glass), no lights.

     The room is planned on a 10 cm grid. Off limits before anything goes
     in: the floor's keep-outs (the door band; the walk along the front
     wall to the stairwell door), what the caller reserves (spec.keep, its
     counter and its real goods' footprints, building-local rects), what
     the money pass claimed (b._moneyRects), what venues claimed through
     CBZ.islandVenue.claim (b._claims), the people at their posts, and
     every collider already standing on the floor that is not a wall.

     spec: {
       k            storey (0)
       room         {x0,x1,z0,z1} building-local (default: the ground floor
                    clear of the stair strip / stairwell wall)
       keep         [{x0,x1,z0,z1,pad?}] reserved
       walls        [{ edge: "x0"|"x1"|"z1"|"z0", mods: [name|fn...] (cycled),
                       w (module width 1.0), d (depth 0.45), front (0.9),
                       from, to (the span along the wall), h, style, pal, max }]
       centre       { mod, len: [max, min], d, aisle, dir: "z"|"x", max,
                      h, style, pal, zMax, zMin }
       lights       "track" | "panel" | "tube" | "pin" | false
       sign         text (the shop's own name), signAt { lx, ly, lz, lyaw, w }
       floor        { col, border } a finish laid over the room
       backDoor     true: a staff door in the back wall (no back room)
       window       { mod, style, pal }: low displays in the shop window
                    (the front band on the +x side of the door)
       posters      [{ edge, a, y, w, h, tex }]
       extra(D)     the venue's own pieces, with D's planner
     }
     D: { K, R, y, ceil, occ, box(Fr, a, n, yb, wa, wn, h, col, o),
          wall(edge), at(swap, ox, oz, sn), place(rect) -> bool,
          furnish(name, lx, lz, lyaw, o) }
     ====================================================================== */
  const PAL = {
    grocery: [0xc23b2c, 0xe8b23a, 0x2f6fb0, 0x3b8a4a, 0xf2efe6, 0x8a3b7a, 0xe07a2a, 0x6a3a22],
    hardware: [0xd2462a, 0xf2c230, 0x2a5aa8, 0x3a3d42, 0x8a9096, 0x2f7a3a, 0xe8e4da],
    marine: [0xd9532a, 0xf2d23a, 0x1f4f8a, 0xe8e4da, 0x2a2c30, 0xc23b2c, 0x3a7a8a],
    pharmacy: [0xf4f2ee, 0x3a8ac2, 0xd23a3a, 0x58b06a, 0xe8d8b0, 0x7a6ab0, 0xf2f6fa],
    ammo: [0xb8322a, 0x2f5d3a, 0x1f3f73, 0xd9d4c4, 0x3a3a3a, 0x7a2f5a, 0x4b5234, 0xd4a43a],
    tactical: [0x2a2c2a, 0x4b5234, 0x6b5a3a, 0x1d1f23, 0x3a4048, 0x5a4a32],
    pawn: [0x2a2c30, 0x8a9096, 0x5a4632, 0xb08a55, 0x1f3f73, 0xc23b2c, 0xe8e4da, 0x3a3d42],
    cloth: [0xe8e4da, 0x2b3a5a, 0x6e1f2b, 0x9aa3ad, 0x3f5a3a, 0xc8b28a, 0x1d1f23, 0xb04a3a, 0x7a8aa0],
    suit: [0x1c2433, 0x2a2c30, 0x3a3a40, 0x4a4f58, 0x5a4632, 0x22303a, 0x15171b, 0x6a6e76],
    fabric: [0x1c2433, 0x5a4632, 0x8a8f95, 0x6b2a2a, 0x2f4a3a, 0xc8b28a, 0x3a3a40, 0xd8d4c8, 0x4a3a5a],
    books: [0x7b2f2a, 0x2f4a6b, 0x3d5a3a, 0xc9b98f, 0x5b3a5e, 0x2a2a2e, 0xa8672f, 0xd9d2c0],
    bread: [0xc8955a, 0xa8743a, 0xe0c08a, 0x8a5a2a, 0xd8b078],
    flowers: [0xd23a5a, 0xf2c230, 0xf4f2ee, 0x8a3ab0, 0xe86a3a, 0xf28ab0],
    plants: [0x3a6a2a, 0x2f5a2a, 0x4a7a3a, 0x5a8a3a],
    tech: [0x15171b, 0x2a2c30, 0x8a9096, 0xe8e4da, 0x1f3f73, 0xc23b2c],
    paper: [0xe9e2cf, 0x1d2a44, 0x3e4a2f, 0xc9a24a, 0xf4f2ee, 0x8a2b20],
    surf: [0xe86a3a, 0x3ab0c8, 0xf2d23a, 0xf4f2ee, 0x2a8a5a, 0xd23a5a],
    meat: [0x9a2a2a, 0xb84a4a, 0xd88a7a, 0x7a1f1f, 0xe8d8c8],
    ice: [0xf2e6c8, 0xf28ab0, 0x8a5a2a, 0xb8e0c8, 0xf2d23a, 0xd8f0f8],
  };
  function h3(a, b2, c) {
    let h = (Math.imul((a * 73856093) | 0, 1) ^ Math.imul((b2 * 19349663) | 0, 1) ^ Math.imul((c * 83492791) | 0, 1)) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function pick(pal, r) { return pal[Math.min(pal.length - 1, (r * pal.length) | 0)]; }

  function ceilOf(b, k) {
    const IV = CBZ.islandVenue;
    const n = Math.max(1, b.storeys | 0);
    if (k + 1 < n) return IV.floor(b, k + 1).yLocal - 0.2;
    return IV.floor(b, k).yLocal + ((CBZ.islandBuilding && CBZ.islandBuilding.FH) || 3.4) - 0.28;
  }
  // the ground floor a shop has: inside the walls, clear of the stair strip
  // (its wall, when the stairwell is walled off)
  function roomOf(b, k) {
    const IV = CBZ.islandVenue, F = IV.floor(b, k | 0), L = F.local;
    let x0 = L.x0;
    const sw = b._stairwell;
    for (const r of F.keepOut) if (r.why === "stairs") x0 = Math.max(x0, sw ? sw.face + 0.02 : r.x1 + 0.08);
    return { x0: x0, x1: L.x1, z0: L.z0, z1: L.z1 };
  }

  /* ---- the planner's grid ------------------------------------------------- */
  function Occ(R, c) {
    const nx = Math.max(1, Math.ceil((R.x1 - R.x0) / c)), nz = Math.max(1, Math.ceil((R.z1 - R.z0) / c));
    const g = new Uint8Array(nx * nz);
    const sat = new Int32Array((nx + 1) * (nz + 1));
    let dirty = true;
    const span = function (a0, a1, lo, n) {
      return [Math.max(0, Math.floor((a0 - lo) / c + 1e-6)), Math.min(n - 1, Math.ceil((a1 - lo) / c - 1e-6) - 1)];
    };
    // a summed-area table: any rect's "anything here?" in four reads
    const build = function () {
      const W = nx + 1;
      for (let j = 0; j < nz; j++) {
        let run = 0;
        for (let i = 0; i < nx; i++) { run += g[j * nx + i]; sat[(j + 1) * W + i + 1] = sat[j * W + i + 1] + run; }
      }
      dirty = false;
    };
    return {
      // (a cell is taken when a rect covers more than a third of it: pieces
      // set edge to edge along a wall do not shut each other out)
      block: function (r, pad) {
        pad = pad || 0;
        const X = span(r.x0 - pad + 0.35 * c, r.x1 + pad - 0.35 * c, R.x0, nx), Z = span(r.z0 - pad + 0.35 * c, r.z1 + pad - 0.35 * c, R.z0, nz);
        for (let i = X[0]; i <= X[1]; i++) for (let j = Z[0]; j <= Z[1]; j++) g[j * nx + i] = 1;
        dirty = true;
      },
      free: function (r) {
        if (r.x0 < R.x0 - 1e-6 || r.x1 > R.x1 + 1e-6 || r.z0 < R.z0 - 1e-6 || r.z1 > R.z1 + 1e-6) return false;
        if (dirty) build();
        const X = span(r.x0, r.x1, R.x0, nx), Z = span(r.z0, r.z1, R.z0, nz);
        if (X[1] < X[0] || Z[1] < Z[0]) return true;
        const W = nx + 1, i0 = X[0], i1 = X[1] + 1, j0 = Z[0], j1 = Z[1] + 1;
        return sat[j1 * W + i1] - sat[j0 * W + i1] - sat[j1 * W + i0] + sat[j0 * W + i0] === 0;
      },
    };
  }
  // every collider already on this floor that is not a wall (a counter, a
  // case, a safe, a desk, a pane), as building-local rects
  const _near = [];
  function blockCols(occ, b, F, R) {
    let cols = CBZ.colliders;
    if (!cols || !cols.length) return;
    const FR = frameOf(b);
    const a = FR.w(R.x0, R.z0), c = FR.w(R.x1, R.z1);
    const W = { x0: Math.min(a.x, c.x), x1: Math.max(a.x, c.x), z0: Math.min(a.z, c.z), z1: Math.max(a.z, c.z) };
    const y0 = F.y + 0.15, y1 = F.y + 1.9;
    /* (the room's own few, from the physics grid, not every wall on the sea:
       the grid holds every box over this rect, and what is blocked is the
       same whatever order the boxes come in. Inside an island's build the
       lists are its own, not the grid's: those are walked.) */
    if (!CBZ.islandOwnLists && CBZ.queryCollidersNear && CBZ.colliderGridInSync && CBZ.colliderGridInSync()) {
      const hx = (W.x1 - W.x0) / 2 + 0.5, hz = (W.z1 - W.z0) / 2 + 0.5;
      cols = CBZ.queryCollidersNear((W.x0 + W.x1) / 2, (W.z0 + W.z1) / 2, Math.max(hx, hz), _near);
    }
    for (let i = 0; i < cols.length; i++) {
      const q = cols[i];
      if (!q || q.minX == null) continue;
      if (q.maxX <= W.x0 || q.minX >= W.x1 || q.maxZ <= W.z0 || q.minZ >= W.z1) continue;
      if ((q.y1 != null && q.y1 < y0) || (q.y0 != null && q.y0 > y1)) continue;
      // a wall runs past the room (the shell, a partition, the stairwell)
      if (q.minX < W.x0 - 0.3 || q.maxX > W.x1 + 0.3 || q.minZ < W.z0 - 0.3 || q.maxZ > W.z1 + 0.3) continue;
      const p = FR.l(q.minX, q.minZ), s = FR.l(q.maxX, q.maxZ);
      occ.block({ x0: Math.min(p.x, s.x), x1: Math.max(p.x, s.x), z0: Math.min(p.z, s.z), z1: Math.max(p.z, s.z) });
    }
  }

  /* ---- frames: a box by (a along, n out, from the floor) ------------------ */
  // swap: a runs along local z; P(a, n) = swap ? (ox + sn n, a) : (a, oz + sn n)
  function frameAt(swap, ox, oz, sn) {
    return { swap: swap, P: function (a, n) { return swap ? { x: ox + sn * n, z: a } : { x: a, z: oz + sn * n }; },
      rect: function (a0, a1, n0, n1) {
        const p = this.P(a0, n0), q = this.P(a1, n1);
        return { x0: Math.min(p.x, q.x), x1: Math.max(p.x, q.x), z0: Math.min(p.z, q.z), z1: Math.max(p.z, q.z) };
      },
      // the yaw that faces out of the wall (forward = (sin, cos))
      yaw: swap ? (sn > 0 ? Math.PI / 2 : -Math.PI / 2) : (sn > 0 ? 0 : Math.PI) };
  }
  function wallOf(R, edge) {
    let f;
    if (edge === "x0") f = frameAt(true, R.x0, 0, 1);
    else if (edge === "x1") f = frameAt(true, R.x1, 0, -1);
    else if (edge === "z1") f = frameAt(false, 0, R.z1, -1);
    else f = frameAt(false, 0, R.z0, 1);
    f.edge = edge; f.lo = f.swap ? R.z0 : R.x0; f.hi = f.swap ? R.z1 : R.x1;
    return f;
  }

  /* ---- THE GOODS ON A SHELF (filler: what the trade's shelves hold where
     the item itself is not for sale on its own) -------------------------- */
  const STYLE = {
    boxes:   function (r, r2) { return [0.1 + 0.18 * r, 0.12 + 0.2 * r2, 0.78]; },
    cans:    function (r, r2) { return [0.085, 0.115 + 0.02 * r2, 0.82]; },
    bottles: function (r, r2) { return [0.072, 0.21 + 0.09 * r2, 0.8]; },
    jars:    function (r, r2) { return [0.09, 0.12 + 0.04 * r2, 0.8]; },
    stacks:  function (r, r2) { return [0.3, 0.1 + 0.16 * r2, 0.85]; },
    ammo:    function (r, r2) { return [0.1, 0.07, 0.8]; },
    tools:   function (r, r2) { return [0.14 + 0.18 * r, 0.05 + 0.12 * r2, 0.7]; },
    cases:   function (r, r2) { return [0.5 + 0.4 * r, 0.11 + 0.04 * r2, 0.85]; },
    bolts:   function (r, r2) { return [0.15, 0.15, 0.95]; },
    loaves:  function (r, r2) { return [0.22 + 0.1 * r, 0.09 + 0.04 * r2, 0.6]; },
    pots:    function (r, r2) { return [0.2, 0.18 + 0.05 * r2, 0.7]; },
    books:   function (r, r2) { return [0.03 + 0.04 * r, 0.18 + 0.08 * r2, 0.8]; },
    shoes:   function (r, r2) { return [0.3, 0.11, 0.85]; },
    files:   function (r, r2) { return [0.08, 0.28, 0.85]; },
    tech:    function (r, r2) { return [0.16 + 0.2 * r, 0.06 + 0.16 * r2, 0.7]; },
    cards:   function (r, r2) { return [0.1, 0.05, 0.6]; },
  };
  function stock(D, Fr, a, len, n, d, yb, clr, style, pal, seed) {
    const S = STYLE[style] || STYLE.boxes;
    pal = pal || PAL.grocery;
    let t = a - len / 2 + 0.02, i = 0;
    while (t < a + len / 2 - 0.06 && i < 40) {
      const r = h3(seed, i, 1), r2 = h3(seed, i, 2), r3 = h3(seed, i, 3);
      const s = S(r, r2);
      const iw = Math.min(s[0], a + len / 2 - 0.02 - t);
      if (iw < 0.04) break;
      const ih = Math.min(s[1], clr - 0.03), id = d * s[2];
      if (r3 > 0.1 && ih > 0.02) {
        const col = pick(pal, h3(seed, style === "books" || style === "files" ? i : (i >> 1), 4));
        if (style === "books" || style === "files") D.box(Fr, t + iw / 2, n, yb, iw * 0.92, id, ih, col, { nb: true });
        else if (style === "ammo") { D.box(Fr, t + iw / 2, n, yb, iw * 0.94, id, ih, col, { nb: true }); if (clr > 0.17) D.box(Fr, t + iw / 2, n, yb + ih, iw * 0.94, id, ih, col, { nb: true }); }
        else if (style === "bolts") D.box(Fr, t + iw / 2, n, yb, iw * 0.92, id, ih, col, { nb: true });
        else D.box(Fr, t + iw / 2, n, yb, iw * 0.94, id, ih, col, { nb: true });
      }
      t += iw + (style === "books" ? 0.004 : 0.014);
      i++;
    }
  }

  /* ---- THE MODULES: one bay of wall (a its centre, w wide, d deep) ------- */
  const MODS = {
    // shelving to head height and over: back panel, uprights, five shelves
    // of the trade's goods, a header strip in the shop's colour
    shelf: function (D, Fr, a, w, d, o) {
      const h = o.h || 2.1, fr = o.frame || 0x9aa0a6, bk = o.back || 0xe8e4da;
      const lv = o.levels || [0.12, 0.52, 0.9, 1.28, 1.66];
      D.box(Fr, a, 0.012, 0, w, 0.024, h, bk);
      for (const s of [-1, 1]) D.box(Fr, a + s * (w / 2 - 0.02), d / 2, 0, 0.035, d, h, fr);
      D.box(Fr, a, d / 2 + 0.01, 0, w - 0.04, d - 0.02, lv[0], 0x2a2c30);
      for (let i = 0; i < lv.length; i++) {
        const y = lv[i], top = i + 1 < lv.length ? lv[i + 1] : h;
        const dd = i === 0 ? d - 0.02 : d - 0.06 - (i >= 3 ? 0.06 : 0);
        D.box(Fr, a, dd / 2 + 0.024, y - 0.02, w - 0.07, dd, 0.02, fr, { nb: true });
        stock(D, Fr, a, w - 0.08, dd / 2 + 0.024, dd - 0.04, y, top - y - 0.02, o.style || "boxes", o.pal, (o.seed | 0) + i * 101 + Math.round(a * 17));
      }
      D.box(Fr, a, 0.05, h - 0.02, w, 0.1, 0.16, o.accent != null ? o.accent : 0x2a2c30);
      D.box(Fr, a, d / 2, 0, w, d, h, 0, { solid: true, noVis: true });
    },
    // slatwall to 2.4 m with goods hung on peg arms in rows
    slat: function (D, Fr, a, w, d, o) {
      const h = o.h || 2.4, bk = o.back || 0xbab4a8;
      D.box(Fr, a, 0.015, 0.1, w, 0.03, h - 0.1, bk);
      for (let i = 0; i < 9; i++) D.box(Fr, a, 0.034, 0.25 + i * 0.24, w, 0.008, 0.012, 0x7a766e);
      D.box(Fr, a, 0.2, 0, w, 0.4, 0.1, 0x2a2c30);
      const rows = o.rows || [0.75, 1.2, 1.65, 2.05], st = o.style || "bags", pal = o.pal || PAL.tactical;
      for (let r = 0; r < rows.length; r++) {
        const y = rows[r];
        let iw = 0.3, ih = 0.3, idp = 0.16, gap = 0.08;
        if (st === "holsters") { iw = 0.12; ih = 0.2; idp = 0.07; gap = 0.06; }
        else if (st === "cards") { iw = 0.12; ih = 0.18; idp = 0.04; gap = 0.05; }
        else if (st === "tools") { iw = 0.06 + 0.1 * h3(o.seed | 0, r, 7); ih = 0.25; idp = 0.05; gap = 0.07; }
        else if (st === "ropes") { iw = 0.28; ih = 0.28; idp = 0.12; gap = 0.06; }
        else if (st === "wetsuits") { iw = 0.4; ih = 1.0; idp = 0.08; gap = 0.06; }
        if (st === "wetsuits" && r > 0) break;
        const n = Math.max(1, Math.floor((w - 0.1) / (iw + gap)));
        const step = (w - 0.1) / n;
        for (let i = 0; i < n; i++) {
          const x = a - (w - 0.1) / 2 + step * (i + 0.5);
          const col = pick(pal, h3((o.seed | 0) + r, i, 9));
          D.box(Fr, x, 0.06, y + 0.06, 0.012, 0.1, 0.012, 0x8a9096);       // the peg
          D.box(Fr, x, 0.06 + idp / 2 + 0.03, y - ih + 0.08, iw, idp, ih, col, { nb: true });
        }
      }
      D.box(Fr, a, 0.2, 0, w, 0.4, 1.5, 0, { solid: true, noVis: true });
    },
    // a glass wall case: a cabinet base, glass to two metres, glass shelves
    // lit along the front, the trade's pieces on them
    tallcase: function (D, Fr, a, w, d, o) {
      const base = o.base || 0x2a2622, rim = o.rim || 0xb8963e;
      D.box(Fr, a, d / 2, 0, w, d, 0.32, base);
      D.box(Fr, a, d / 2, 0.32, w - 0.02, d - 0.02, 1.68, 0xdcecf2, { glass: true });
      for (const s of [-1, 1]) D.box(Fr, a + s * (w / 2 - 0.015), d / 2, 0.32, 0.03, d, 1.7, rim);
      D.box(Fr, a, d / 2, 2.0, w, d, 0.06, rim);
      D.box(Fr, a, 0.01, 0.32, w - 0.04, 0.02, 1.68, o.back || 0x1a1412);
      for (const y of [0.75, 1.15, 1.55]) {
        D.box(Fr, a, d / 2, y, w - 0.06, d - 0.06, 0.012, 0xdcecf2, { glass: true });
        D.box(Fr, a, d - 0.04, y + 0.34, w - 0.1, 0.012, 0.012, 0xfff2d8, { glow: true });
        stock(D, Fr, a, w - 0.14, d / 2, d * 0.5, y + 0.012, 0.3, o.style || "tech", o.pal, (o.seed | 0) + Math.round(y * 100) + Math.round(a * 13));
      }
      stock(D, Fr, a, w - 0.14, d / 2, d * 0.5, 0.33, 0.38, o.style || "tech", o.pal, (o.seed | 0) + 7 + Math.round(a * 13));
      D.box(Fr, a, d / 2, 0, w, d, 2.06, 0, { solid: true, noVis: true });
    },
    // a counter-height glass showcase standing against the wall
    showcase: function (D, Fr, a, w, d, o) {
      const base = o.base || 0x3a2618, rim = o.rim || 0x9aa0a6;
      D.box(Fr, a, d / 2, 0, w, d, 0.08, 0x111214);
      D.box(Fr, a, d / 2, 0.08, w, d, 0.8, base);
      D.box(Fr, a, d / 2, 0.88, w - 0.04, d - 0.04, 0.012, o.deck || 0x1c1418);
      D.box(Fr, a, d / 2, 0.89, w - 0.02, d - 0.02, 0.34, 0xdcecf2, { glass: true });
      D.box(Fr, a, d / 2, 1.23, w, d, 0.02, rim);
      D.box(Fr, a, d - 0.05, 1.2, w - 0.1, 0.012, 0.012, 0xfff2d8, { glow: true });
      stock(D, Fr, a, w - 0.14, d / 2, d * 0.55, 0.892, 0.3, o.style || "tech", o.pal, (o.seed | 0) + Math.round(a * 11));
      D.box(Fr, a, d / 2, 0, w, d, 1.25, 0, { solid: true, noVis: true });
    },
    // gun safes for sale: tall steel boxes, dial, three-spoke handle
    safes: function (D, Fr, a, w, d, o) {
      const cols = [0x1d1f23, 0x3a3f46, 0x2f3a2c, 0x4a1f1f];
      const n = Math.max(1, Math.floor(w / 0.8)), sw = w / n;
      for (let i = 0; i < n; i++) {
        const x = a - w / 2 + sw * (i + 0.5), c = pick(cols, h3(o.seed | 0, i, 3)), hh = 1.45 + 0.15 * h3(o.seed | 0, i, 4);
        D.box(Fr, x, d / 2, 0, sw - 0.06, d, 0.06, 0x111214);
        D.box(Fr, x, d / 2, 0.06, sw - 0.08, d - 0.02, hh, c);
        D.box(Fr, x, d + 0.005, 0.12, sw - 0.2, 0.01, hh - 0.12, c);
        D.box(Fr, x + 0.12, d + 0.02, 0.06 + hh * 0.55, 0.1, 0.03, 0.1, 0xb8963e);
        for (let s = 0; s < 3; s++) D.box(Fr, x - 0.12, d + 0.03, 0.06 + hh * 0.5 + (s - 1) * 0.07, 0.11, 0.02, 0.018, 0xc8ccd2);
      }
      D.box(Fr, a, d / 2, 0, w, d, 1.6, 0, { solid: true, noVis: true });
    },
    // the pawnbroker's guitars, hung by the neck in a row
    guitars: function (D, Fr, a, w, d, o) {
      const bodies = [0x8a4a22, 0x15171b, 0xa82a2a, 0xd8b078, 0x2a4a8a, 0xe8e4da];
      D.box(Fr, a, 0.015, 0.4, w, 0.03, 2.0, 0x5a4632);
      const n = Math.max(1, Math.floor(w / 0.42)), st = w / n;
      for (let i = 0; i < n; i++) {
        const x = a - w / 2 + st * (i + 0.5), c = pick(bodies, h3(o.seed | 0, i, 5));
        const y = 0.75 + (i % 2) * 0.12;
        D.box(Fr, x, 0.09, y, 0.36, 0.1, 0.3, c);                 // lower bout
        D.box(Fr, x, 0.09, y + 0.3, 0.28, 0.1, 0.18, c);          // upper bout
        D.box(Fr, x, 0.145, y + 0.12, 0.08, 0.012, 0.08, 0x111214); // the hole / pickup
        D.box(Fr, x, 0.08, y + 0.48, 0.05, 0.04, 0.55, 0x3a2414);  // neck
        D.box(Fr, x, 0.08, y + 1.03, 0.08, 0.04, 0.16, 0x1d1f23);  // headstock
        D.box(Fr, x, 0.03, y + 1.15, 0.06, 0.06, 0.03, 0x8a9096);  // the hanger
      }
      D.box(Fr, a, 0.15, 0, w, 0.3, 1.0, 0, { solid: true, noVis: true });
    },
    // televisions and screens on brackets, a shelf of boxed electronics under
    tvs: function (D, Fr, a, w, d, o) {
      D.box(Fr, a, d / 2, 0, w, d, 0.8, 0x2a2c30);
      stock(D, Fr, a, w - 0.06, d / 2, d * 0.8, 0.8, 0.45, "tech", PAL.tech, (o.seed | 0) + 31);
      for (let r = 0; r < 2; r++) {
        const n = r ? 2 : 1, sw = (w - 0.1) / n;
        for (let i = 0; i < n; i++) {
          const x = a - (w - 0.1) / 2 + sw * (i + 0.5), tw = Math.min(sw - 0.08, r ? 0.62 : 0.95), th = tw * 0.58;
          const y = r ? 1.95 : 1.35;
          D.box(Fr, x, 0.05, y, tw, 0.05, th, 0x15171b);
          D.box(Fr, x, 0.077, y + 0.03, tw - 0.05, 0.004, th - 0.06, 0x1a2a3a);
        }
      }
      D.box(Fr, a, d / 2, 0, w, d, 0.85, 0, { solid: true, noVis: true });
    },
    // the optician's frame wall: rows of frames on a lit white panel
    frames: function (D, Fr, a, w, d, o) {
      D.box(Fr, a, 0.02, 0.85, w, 0.04, 1.6, 0xf2f0ea);
      D.box(Fr, a, 0.07, 2.45, w, 0.1, 0.06, 0xfff6e4, { glow: true });
      D.box(Fr, a, d / 2, 0, w, d, 0.85, o.base || 0x3a3a40);
      D.box(Fr, a, d / 2, 0.85, w + 0.02, d + 0.02, 0.03, 0xe8e4da);
      const tints = [0x15171b, 0x5a3a22, 0x8a6a3a, 0x2a3a5a, 0x7a2a2a, 0xb8963e, 0x9aa0a6];
      const cols = Math.max(1, Math.floor((w - 0.1) / 0.19));
      for (let r = 0; r < 7; r++) for (let i = 0; i < cols; i++) {
        const x = a - (w - 0.1) / 2 + (w - 0.1) * (i + 0.5) / cols, y = 1.0 + r * 0.2;
        const t = pick(tints, h3((o.seed | 0) + r, i, 11));
        D.box(Fr, x, 0.1, y - 0.035, 0.15, 0.012, 0.016, t, { nb: true }); // brow bar
        D.box(Fr, x, 0.098, y - 0.06, 0.14, 0.006, 0.035, 0x2a3036, { nb: true });   // the lenses
      }
      stock(D, Fr, a, w - 0.1, d / 2, d * 0.6, 0.88, 0.1, "cards", [0x15171b, 0x5a3a22, 0xe8e4da], (o.seed | 0) + 5);
      D.box(Fr, a, d / 2, 0, w, d, 0.9, 0, { solid: true, noVis: true });
    },
    // a wall of handsets on a dark panel, each with its screen lit
    phones: function (D, Fr, a, w, d, o) {
      D.box(Fr, a, 0.02, 0.85, w, 0.04, 1.55, 0x1d1f23);
      D.box(Fr, a, 0.07, 2.42, w, 0.1, 0.08, 0xeaf2ff, { glow: true });
      D.box(Fr, a, d / 2, 0, w, d, 0.85, 0xe8e4da);
      const cols = Math.max(1, Math.floor((w - 0.1) / 0.2));
      const scr = [0x2a4a7a, 0x3a6a8a, 0x5a3a7a, 0x2a6a5a];
      for (let r = 0; r < 4; r++) for (let i = 0; i < cols; i++) {
        const x = a - (w - 0.1) / 2 + (w - 0.1) * (i + 0.5) / cols, y = 1.05 + r * 0.33;
        D.box(Fr, x, 0.06, y, 0.1, 0.04, 0.03, 0x8a9096);                   // the cradle
        D.box(Fr, x, 0.075, y + 0.03, 0.08, 0.012, 0.16, 0x15171b, { nb: true });
        D.box(Fr, x, 0.082, y + 0.04, 0.068, 0.004, 0.14, pick(scr, h3(o.seed | 0, r * 31 + i, 2)), { glow: true, nb: true });
      }
      stock(D, Fr, a, w - 0.1, d / 2, d * 0.6, 0.85, 0.12, "tech", PAL.tech, (o.seed | 0) + 9);
      D.box(Fr, a, d / 2, 0, w, d, 0.9, 0, { solid: true, noVis: true });
    },
    // a suit bay: a walnut panel, jackets double-hung, shirts folded above
    suits: function (D, Fr, a, w, d, o) {
      const wood = o.back || 0x3a2414, pal = o.pal || PAL.suit;
      D.box(Fr, a, 0.015, 0, w, 0.03, 2.5, wood);
      D.box(Fr, a, 0.3, 2.0, w - 0.04, 0.55, 0.03, 0x2a1a10);
      stock(D, Fr, a, w - 0.1, 0.3, 0.4, 2.03, 0.3, "stacks", [0xf4f2ee, 0xd8e0ea, 0xe8d8c8, 0xc8d8e8], (o.seed | 0) + 3);
      for (const y of [1.78, 0.98]) {
        D.box(Fr, a, 0.3, y, w - 0.06, 0.018, 0.018, 0xc8ccd2);
        const n = Math.max(1, Math.floor((w - 0.12) / 0.1));
        for (let i = 0; i < n; i++) {
          const x = a - (w - 0.12) / 2 + (w - 0.12) * (i + 0.5) / n;
          const c = pick(pal, h3((o.seed | 0) + Math.round(y * 10), i, 6));
          const L = y > 1.5 ? 0.72 : 0.58;
          D.box(Fr, x, 0.3, y - L - 0.02, 0.06, 0.46, L, c, { nb: true });
          D.box(Fr, x, 0.3, y - 0.05, 0.012, 0.3, 0.05, 0xb08a55, { nb: true });    // the hanger
        }
      }
      D.box(Fr, a, d / 2, 0, w, d, 1.8, 0, { solid: true, noVis: true });
    },
    // fabric bolts lying ends-out on deep shelves
    bolts: function (D, Fr, a, w, d, o) {
      MODS.shelf(D, Fr, a, w, d, Object.assign({}, o, { style: "bolts", pal: o.pal || PAL.fabric, levels: [0.12, 0.42, 0.72, 1.02, 1.32, 1.62], back: o.back || 0x5a4632, frame: 0x3a2414, accent: 0x2a1a10 }));
    },
    // folded stacks in open cubbies
    cubbies: function (D, Fr, a, w, d, o) {
      const fr = o.frame || 0xe8e4da;
      D.box(Fr, a, 0.012, 0, w, 0.024, 2.2, fr);
      const cols = Math.max(1, Math.round(w / 0.4)), cw = w / cols;
      for (let i = 0; i <= cols; i++) D.box(Fr, a - w / 2 + i * cw, d / 2, 0, 0.025, d, 2.2, fr);
      for (let r = 0; r < 6; r++) {
        const y = 0.1 + r * 0.35;
        D.box(Fr, a, d / 2, y - 0.02, w, d, 0.02, fr, { nb: true });
        for (let i = 0; i < cols; i++) {
          const x = a - w / 2 + cw * (i + 0.5);
          const hh = 0.12 + 0.14 * h3(o.seed | 0, r * 17 + i, 1);
          D.box(Fr, x, d / 2, y, cw - 0.07, d * 0.8, hh, pick(o.pal || PAL.cloth, h3(o.seed | 0, r * 17 + i, 2)), { nb: true });
        }
      }
      D.box(Fr, a, d / 2, 0, w, d, 2.2, 0, { solid: true, noVis: true });
    },
    // wood panelling and a mirror between pieces (an upscale wall)
    panel: function (D, Fr, a, w, d, o) {
      const wood = o.back || 0x3a2414;
      D.box(Fr, a, 0.02, 0, w, 0.04, 1.0, wood);
      D.box(Fr, a, 0.03, 1.0, w, 0.06, 0.05, 0xb8963e);
      D.box(Fr, a, 0.015, 1.05, w, 0.03, 1.55, o.upper || 0x5a3a22);
      if (o.mirror !== false) {
        D.box(Fr, a, 0.04, 1.15, Math.min(0.8, w - 0.2), 0.03, 1.2, 0xb8963e);
        D.box(Fr, a, 0.058, 1.19, Math.min(0.72, w - 0.28), 0.006, 1.12, 0xbccbd2);
      }
    },
    // a tall mirror on its own
    mirror: function (D, Fr, a, w, d, o) {
      D.box(Fr, a, 0.03, 0.05, Math.min(0.9, w), 0.04, 2.0, o.frame || 0x1d1f23);
      D.box(Fr, a, 0.052, 0.1, Math.min(0.82, w - 0.08), 0.006, 1.9, 0xbccbd2);
    },
    // a lit menu board / price board high on the wall over a low counter
    board: function (D, Fr, a, w, d, o) {
      D.box(Fr, a, 0.025, 1.55, w - 0.1, 0.05, 0.9, 0x15171b);
      for (let i = 0; i < 5; i++) D.box(Fr, a, 0.052, 1.68 + i * 0.15, w * 0.6, 0.004, 0.03, 0xe8e4da, { glow: true });
    },
    // filing cabinets in a row
    cabinets: function (D, Fr, a, w, d, o) {
      const n = Math.max(1, Math.floor(w / 0.48)), cw = w / n;
      for (let i = 0; i < n; i++) {
        const x = a - w / 2 + cw * (i + 0.5);
        D.box(Fr, x, d / 2, 0, cw - 0.03, d, 1.32, o.col || 0x6a7078);
        for (let r = 0; r < 4; r++) {
          D.box(Fr, x, d + 0.004, 0.06 + r * 0.32, cw - 0.08, 0.008, 0.28, 0x7a8088);
          D.box(Fr, x, d + 0.014, 0.25 + r * 0.32, 0.12, 0.02, 0.025, 0xc8ccd2);
        }
      }
      D.box(Fr, a, d / 2, 0, w, d, 1.32, 0, { solid: true, noVis: true });
    },
    // a brochure rack: slanted pockets of leaflets
    brochures: function (D, Fr, a, w, d, o) {
      D.box(Fr, a, 0.1, 0, Math.min(w, 0.7), 0.2, 1.5, 0x2a2e33);
      for (let r = 0; r < 4; r++) for (let i = 0; i < 3; i++)
        D.box(Fr, a - 0.2 + i * 0.2, 0.22, 0.45 + r * 0.26, 0.16, 0.03, 0.2, pick(o.pal || PAL.paper, h3(o.seed | 0, r * 3 + i, 1)), { nb: true });
      D.box(Fr, a, 0.15, 0, Math.min(w, 0.7), 0.3, 1.5, 0, { solid: true, noVis: true });
    },
    // surfboards stood up against the wall
    boards: function (D, Fr, a, w, d, o) {
      const n = Math.max(1, Math.floor(w / 0.34)), sw = w / n;
      for (let i = 0; i < n; i++) {
        const x = a - w / 2 + sw * (i + 0.5), L = 1.8 + 0.5 * h3(o.seed | 0, i, 2);
        D.box(Fr, x, 0.12, 0.02, 0.28, 0.06, L, pick(PAL.surf, h3(o.seed | 0, i, 3)));
        D.box(Fr, x, 0.155, 0.1, 0.03, 0.01, L - 0.2, 0xf4f2ee);   // the stringer
      }
      D.box(Fr, a, 0.08, 0, w, 0.18, 0.08, 0x2a2c30);
      D.box(Fr, a, 0.15, 0, w, 0.3, 1.8, 0, { solid: true, noVis: true });
    },
    // washers in a row (the laundry), round doors to the room
    washers: function (D, Fr, a, w, d, o) {
      const n = Math.max(1, Math.floor(w / 0.7)), sw = w / n;
      for (let i = 0; i < n; i++) {
        const x = a - w / 2 + sw * (i + 0.5);
        D.box(Fr, x, d / 2, 0, sw - 0.04, d, 0.9, 0xeef0f2);
        D.box(Fr, x, d + 0.01, 0.25, 0.38, 0.02, 0.38, 0x5a6a7a);
        D.box(Fr, x, d + 0.02, 0.32, 0.26, 0.01, 0.26, 0x2a3a4a);
        D.box(Fr, x, d - 0.1, 0.78, sw - 0.12, 0.04, 0.06, 0x8a9096);
      }
      D.box(Fr, a, d / 2, 0, w, d, 0.9, 0, { solid: true, noVis: true });
    },
    // stepped flower stands with buckets
    flowers: function (D, Fr, a, w, d, o) {
      for (let r = 0; r < 3; r++) {
        D.box(Fr, a, 0.12 + r * 0.18, 0, w, 0.2, 0.3 + r * 0.3, 0x5a4632);
        const n = Math.max(1, Math.floor(w / 0.26));
        for (let i = 0; i < n; i++) {
          const x = a - w / 2 + w * (i + 0.5) / n, y = 0.3 + r * 0.3;
          D.box(Fr, x, 0.12 + r * 0.18, y, 0.18, 0.16, 0.2, 0x8a9096);
          D.box(Fr, x, 0.12 + r * 0.18, y + 0.2, 0.2, 0.18, 0.12, pick(PAL.plants, h3(o.seed | 0, r * 9 + i, 1)));
          D.box(Fr, x, 0.12 + r * 0.18, y + 0.32, 0.18, 0.16, 0.1, pick(PAL.flowers, h3(o.seed | 0, r * 9 + i, 2)));
        }
      }
      D.box(Fr, a, d / 2, 0, w, d, 1.0, 0, { solid: true, noVis: true });
    },
    // a chilled display counter (the butcher's, the ice cream parlour's)
    chiller: function (D, Fr, a, w, d, o) {
      D.box(Fr, a, d / 2, 0, w, d, 0.85, 0xe8e4da);
      D.box(Fr, a, d / 2, 0.85, w - 0.04, d - 0.04, 0.012, 0xc8ccd2);
      stock(D, Fr, a, w - 0.12, d / 2, d * 0.6, 0.862, 0.12, "jars", o.pal || PAL.meat, (o.seed | 0) + 2);
      D.box(Fr, a, d / 2, 0.87, w - 0.02, d - 0.02, 0.32, 0xdcecf2, { glass: true });
      D.box(Fr, a, d - 0.05, 1.17, w - 0.1, 0.012, 0.012, 0xf2f6ff, { glow: true });
      D.box(Fr, a, d / 2, 0, w, d, 1.2, 0, { solid: true, noVis: true });
    },
  };

  /* ---- THE CENTRE: free-standing pieces (Fr's a runs along the piece) ---- */
  const CENTRE = {
    // a double-sided gondola with end caps
    gondola: function (D, Fr, a, L, d, o) {
      const h = o.h || 1.5, fr = o.frame || 0x9aa0a6;
      const lv = o.levels || [0.12, 0.47, 0.82, 1.17];
      D.box(Fr, a, 0, 0, L, 0.05, h, o.back || 0xe8e4da);
      D.box(Fr, a, 0, 0, L, d, lv[0], 0x2a2c30);
      for (const s of [-1, 1]) {
        for (let i = 0; i < lv.length; i++) {
          const y = lv[i], top = i + 1 < lv.length ? lv[i + 1] : h + 0.25;
          const dd = d / 2 - 0.04;
          D.box(Fr, a, s * (dd / 2 + 0.025), y - 0.02, L - 0.04, dd, 0.02, fr, { nb: true });
          stock(D, Fr, a, L - 0.06, s * (dd / 2 + 0.03), dd - 0.03, y, top - y - 0.02, o.style || "boxes", o.pal, (o.seed | 0) + i * 37 + (s > 0 ? 500 : 0) + Math.round(a * 7));
        }
      }
      D.box(Fr, a, 0, h, L + 0.02, 0.06, 0.03, fr);
      for (const e of [-1, 1]) D.box(Fr, a + e * (L / 2 + 0.02), 0, 0, 0.04, d, h, o.cap != null ? o.cap : 0x2a2c30);
      D.box(Fr, a, 0, 0, L + 0.04, d, h, 0, { solid: true, noVis: true });
    },
    // a waist-high display table (folded stacks, demo handsets, books)
    table: function (D, Fr, a, L, d, o) {
      for (const e of [-1, 1]) for (const s of [-1, 1]) D.box(Fr, a + e * (L / 2 - 0.06), s * (d / 2 - 0.06), 0, 0.05, 0.05, 0.86, 0x2a2622);
      D.box(Fr, a, 0, 0.12, L - 0.1, d - 0.1, 0.02, 0x2a2622);
      D.box(Fr, a, 0, 0.86, L, d, 0.04, o.top || 0xd8cfbf);
      if (o.style === "demo") {
        const n = Math.max(1, Math.floor(L / 0.4));
        for (let i = 0; i < n; i++) for (const s of [-1, 1]) {
          const x = a - L / 2 + L * (i + 0.5) / n;
          D.box(Fr, x, s * 0.15, 0.9, 0.06, 0.06, 0.08, 0x8a9096);
          D.box(Fr, x, s * 0.17, 0.98, 0.08, 0.012, 0.15, 0x15171b);
          D.box(Fr, x, s * 0.177, 0.99, 0.068, 0.004, 0.13, 0x2a4a7a, { glow: true });
        }
      } else stock(D, Fr, a, L - 0.1, 0, d * 0.8, 0.9, 0.3, o.style || "stacks", o.pal, (o.seed | 0) + Math.round(a * 9));
      D.box(Fr, a, 0, 0, L, d, 0.9, 0, { solid: true, noVis: true });
    },
    // a free-standing glass showcase (counter height)
    showcase: function (D, Fr, a, L, d, o) {
      // drawn as a wall showcase whose back is d/2 behind the centre line
      MODS.showcase(D, { swap: Fr.swap, P: function (aa, n) { return Fr.P(aa, n - d / 2); } }, a, L, d, o);
    },
    // a chilled display standing free (the butcher's, the deli's, the ice
    // cream parlour's), its back to the clerk
    chiller: function (D, Fr, a, L, d, o) {
      MODS.chiller(D, { swap: Fr.swap, P: function (aa, n) { return Fr.P(aa, n - d / 2); } }, a, L, d, o);
    },
    // a garment rail (a round of clothes)
    rail: function (D, Fr, a, L, d, o) {
      for (const e of [-1, 1]) { D.box(Fr, a + e * (L / 2 - 0.03), 0, 0, 0.03, 0.03, 1.45, 0xc8ccd2); D.box(Fr, a + e * (L / 2 - 0.03), 0, 0, 0.03, 0.5, 0.03, 0xc8ccd2); }
      D.box(Fr, a, 0, 1.42, L, 0.025, 0.025, 0xc8ccd2);
      const n = Math.max(1, Math.floor((L - 0.1) / 0.09));
      for (let i = 0; i < n; i++) D.box(Fr, a - (L - 0.1) / 2 + (L - 0.1) * (i + 0.5) / n, 0, 0.62, 0.05, 0.42, 0.78, pick(o.pal || PAL.cloth, h3(o.seed | 0, i >> 1, 4)), { nb: true });
      D.box(Fr, a, 0, 0, L, d, 1.45, 0, { solid: true, noVis: true });
    },
    // a cafe table with its chairs (drawn by city/furniture.js)
    cafe: function (D, Fr, a, L, d, o) {
      const p = Fr.P(a, 0);
      D.furnish("table", p.x, p.z, Fr.swap ? 0 : Math.PI / 2, { seats: 2, len: 0.8, deep: 0.7, tone: o.tone || "auto" });
    },
  };

  /* ---- the lights: the trade's ceiling, lenses only (no light objects) --- */
  function* lights(D, kind) {
    const R = D.R, c = D.ceil, K = D.K;
    const W = R.x1 - R.x0, L = R.z1 - R.z0;
    if (kind === "panel" || kind === "tube") {
      const nx = Math.max(1, Math.round(W / 2.4)), nz = Math.max(1, Math.round(L / 2.4));
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        if (late()) yield 0;
        const x = R.x0 + W * (i + 0.5) / nx, z = R.z0 + L * (j + 0.5) / nz;
        if (kind === "tube") {
          K.lbox(x, c - 0.03, z, 0.14, 0.05, 1.25, 0xc8ccd2);
          K.lbox(x, c - 0.06, z, 0.06, 0.03, 1.18, 0xf2f6ff, { glow: true });
        } else {
          K.lbox(x, c - 0.012, z, 0.64, 0.024, 0.64, 0xdcdad4);
          K.lbox(x, c - 0.028, z, 0.58, 0.006, 0.58, 0xf7f4ea, { glow: true });
        }
      }
      return;
    }
    // track: rails down the room, spot heads every metre and a bit
    const pin = kind === "pin";
    const nx = Math.max(1, Math.round(W / (pin ? 1.8 : 2.4)));
    for (let i = 0; i < nx; i++) {
      if (late()) yield 0;
      const x = R.x0 + W * (i + 0.5) / nx;
      if (!pin) K.lbox(x, c - 0.018, (R.z0 + R.z1) / 2, 0.04, 0.03, L - 0.8, 0x1d1f23);
      const n = Math.max(1, Math.floor((L - 0.8) / 1.15));
      for (let j = 0; j < n; j++) {
        const z = R.z0 + 0.4 + (L - 0.8) * (j + 0.5) / n;
        if (pin) {
          K.lbox(x, c - 0.01, z, 0.12, 0.02, 0.12, 0xb8963e);
          K.lbox(x, c - 0.022, z, 0.07, 0.004, 0.07, 0xfff2d8, { glow: true });
        } else {
          K.lbox(x, c - 0.07, z, 0.018, 0.09, 0.018, 0x1d1f23);
          K.lbox(x, c - 0.16, z + (j % 2 ? 0.03 : -0.03), 0.08, 0.12, 0.08, 0x1d1f23);
          K.lbox(x, c - 0.223, z + (j % 2 ? 0.03 : -0.03), 0.06, 0.006, 0.06, 0xfff1d6, { glow: true });
        }
      }
    }
  }

  /* ---- packing a wall run ----------------------------------------------- */
  function* packWall(D, w) {
    const Fr = wallOf(D.R, w.edge);
    const BW = w.w || 1.0, BD = w.d || 0.45, FRONT = w.front != null ? w.front : 0.9, GAP = w.gap || 0;
    const lo = Math.max(Fr.lo, w.from != null ? w.from : -1e9), hi = Math.min(Fr.hi, w.to != null ? w.to : 1e9);
    const mods = w.mods || ["shelf"];
    let a = lo + 0.02, n = 0, max = w.max || 99;
    while (a + BW <= hi + 1e-6 && n < max) {
      const c = a + BW / 2;
      const use = Fr.rect(c - BW / 2, c + BW / 2, 0, BD + FRONT);
      if (D.occ.free(use)) {
        const m = mods[n % mods.length];
        const fn = typeof m === "function" ? m : MODS[m];
        if (fn) {
          try { fn(D, Fr, c, BW, BD, Object.assign({ seed: D.seed + n * 13 + (w.edge.charCodeAt(1) * 7) }, w)); } catch (e) { console.error("[island dress]", e); }
        }
        const ft = Fr.rect(c - BW / 2, c + BW / 2, 0, BD);
        D.occ.block(ft); D.claimed.push(ft);
        n++;
        a += BW + GAP;
        if (late()) yield 0;
      } else a += 0.1;
    }
    return n;
  }
  // free-standing pieces: the floor scanned from the back, an aisle round each
  function* packCentre(D, o) {
    const R = D.R, dirZ = o.dir !== "x";
    const lens = o.len || [3.6, 2.4, 1.2];
    const L0 = Array.isArray(lens) ? lens : [lens];
    const d = o.d || 0.9, ais = o.aisle != null ? o.aisle : 1.05, endA = o.endAisle != null ? o.endAisle : 0.9;
    const fn = typeof o.mod === "function" ? o.mod : CENTRE[o.mod || "gondola"];
    const max = o.max || 8;
    const zMin = o.zMin != null ? o.zMin : R.z0, zMax = o.zMax != null ? o.zMax : R.z1;
    let n = 0;
    for (const L of L0) {
      for (let z = zMax - 0.3; z >= zMin + 0.3 && n < max; z -= 0.2) {
        for (let x = R.x0 + 0.3; x <= R.x1 - 0.3 && n < max; x += 0.2) {
          const hx = dirZ ? d / 2 : L / 2, hz = dirZ ? L / 2 : d / 2;
          const ax = dirZ ? ais : endA, az = dirZ ? endA : ais;
          const foot = { x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz };
          if (foot.z0 < zMin || foot.z1 > zMax) continue;
          const use = { x0: foot.x0 - ax, x1: foot.x1 + ax, z0: foot.z0 - az, z1: foot.z1 + az };
          // (the room's own walls bound the aisle: a piece may stand an aisle off them)
          const clip = { x0: Math.max(use.x0, R.x0), x1: Math.min(use.x1, R.x1), z0: Math.max(use.z0, R.z0), z1: Math.min(use.z1, R.z1) };
          if (use.x0 < R.x0 - 0.01 || use.x1 > R.x1 + 0.01 || use.z0 < R.z0 - 0.01 || use.z1 > R.z1 + 0.01) continue;
          if (!D.occ.free(clip)) continue;
          const Fr = dirZ ? frameAt(true, x, 0, 1) : frameAt(false, 0, z, 1);
          try { fn(D, Fr, dirZ ? z : x, L, d, Object.assign({ seed: D.seed + 997 + n * 31 }, o)); } catch (e) { console.error("[island dress centre]", e); }
          D.occ.block(foot); D.claimed.push(foot);
          n++;
          if (late()) yield 0;
        }
      }
    }
    return n;
  }

  function dress(b, spec) { return drain(dressSteps(b, spec)); }
  // the planner as a generator: it yields on the slice clock between its
  // pieces (a fit-out that is a generator itself takes it with yield*)
  function* dressSteps(b, spec) {
    const IV = CBZ.islandVenue;
    if (!IV || !b || !b.interior || !b.group) return null;
    spec = spec || {};
    const k = spec.k | 0;
    const F = IV.floor(b, k);
    const R = spec.room ? { x0: spec.room.x0, x1: spec.room.x1, z0: spec.room.z0, z1: spec.room.z1 } : roomOf(b, k);
    if (R.x1 - R.x0 < 1.5 || R.z1 - R.z0 < 2) return null;
    const y = F.yLocal + 0.005;
    const K = spec.K || kit(b, { name: "dress-" + (spec.kind || b.use || "venue") });
    const occ = Occ(R, 0.1);
    const D = {
      b: b, K: K, R: R, F: F, y: y, ceil: spec.ceil != null ? spec.ceil : ceilOf(b, k), occ: occ,
      seed: ((hash((b.planId | 0) + ":" + Math.round(b.ox) + ":" + Math.round(b.oz) + ":" + (spec.kind || b.use)) * 1e6) | 0),
      box: function (Fr, a, n, yb, wa, wn, h, col, o) {
        const p = Fr.P(a, n);
        return K.lbox(p.x, y + yb + h / 2, p.z, Fr.swap ? wn : wa, h, Fr.swap ? wa : wn, col, o);
      },
      wall: function (edge) { return wallOf(R, edge); },
      at: frameAt,
      place: function (r) { if (!occ.free(r)) return false; occ.block(r); D.claimed.push(r); return true; },
      claimed: [],
      furnish: function (name, lx, lz, lyaw, o) { return K.furnish(name, lx, lz, y, lyaw, o); },
    };
    // ---- the reservations
    // the street door's band (the floor's own front, not the room's: a room
    // further in, the cashier's side of a counter, has no door to keep)
    if (k === 0) occ.block({ x0: -1.6, x1: 1.6, z0: F.local.z0 - 0.5, z1: F.local.z0 + 2.4 });
    for (const r of F.keepOut) {
      if (r.why === "stairs" || r.why === "door") continue;
      // the front walk: with the stairwell walled, only the stretch from the
      // street door to the stairwell door is a walk; the rest of the front
      // band is the shop window
      if (r.why === "front walk" && b._stairwell && k === 0) { occ.block({ x0: R.x0 - 0.5, x1: 1.6, z0: r.z0, z1: r.z1 }); continue; }
      occ.block(r);
    }
    for (const r of spec.keep || []) if (r) occ.block(r, r.pad || 0);
    for (const r of b._moneyRects || []) if ((r.k | 0) === k) occ.block(r);
    for (const r of b._claims || []) if ((r.k | 0) === k) occ.block(r);
    for (const p of b._posts || []) if ((p.k | 0) === k) occ.block({ x0: p.lx - 0.5, x1: p.lx + 0.5, z0: p.lz - 0.5, z1: p.lz + 0.5 });
    if (spec.cols !== false) blockCols(occ, b, F, R);
    if (late()) yield 0;
    // ---- the staff door at the back (a shop with no back room)
    if (spec.backDoor) {
      const Fr = wallOf(R, "z1");
      for (const t of [0.78, 0.22, 0.5]) {
        const a = R.x0 + (R.x1 - R.x0) * t;
        const use = Fr.rect(a - 0.65, a + 0.65, 0, 1.1);
        if (!occ.free(use)) continue;
        occ.block(use); D.claimed.push(use);
        D.box(Fr, a, 0.03, 0, 1.06, 0.06, 2.18, 0x5a5650);                        // frame
        D.box(Fr, a, 0.05, 0.02, 0.92, 0.04, 2.08, spec.doorCol || 0x8a8478);     // leaf
        D.box(Fr, a + 0.36, 0.09, 1.0, 0.12, 0.04, 0.03, 0xc8ccd2);               // lever
        D.box(Fr, a, 0.072, 1.5, 0.3, 0.004, 0.08, 0xe8e4da);                     // the push plate
        break;
      }
    }
    // ---- the venue's own pieces first (its test corner, its stations, its
    // seats), then the walls, the shop window, the centre round them
    if (typeof spec.extra === "function") {
      try { const x = spec.extra(D); if (x && typeof x.next === "function") yield* x; } catch (e) { console.error("[island dress extra]", e); }
      if (late()) yield 0;
    }
    for (const w of spec.walls || []) yield* packWall(D, w);
    if (spec.window && b._stairwell && k === 0) yield* packWall(D, Object.assign({ from: 1.7, w: 1.1, d: 0.6, front: 0.15, mods: ["window"] }, spec.window, { edge: "z0" }));
    if (spec.centre) for (const c of [].concat(spec.centre)) yield* packCentre(D, c);
    // ---- the floor, the ceiling, the name
    if (spec.floor) {
      const fl = spec.floor, R2 = spec.floor.rect || R;
      K.lbox((R2.x0 + R2.x1) / 2, F.yLocal + 0.004, (R2.z0 + R2.z1) / 2, R2.x1 - R2.x0, 0.008, R2.z1 - R2.z0, fl.col);
      if (fl.border != null) {
        const bw = 0.25, cx = (R2.x0 + R2.x1) / 2, cz = (R2.z0 + R2.z1) / 2, W = R2.x1 - R2.x0, L = R2.z1 - R2.z0;
        K.lbox(cx, F.yLocal + 0.0095, R2.z0 + 0.4, W - 0.8, 0.003, bw, fl.border);
        K.lbox(cx, F.yLocal + 0.0095, R2.z1 - 0.4, W - 0.8, 0.003, bw, fl.border);
        K.lbox(R2.x0 + 0.4, F.yLocal + 0.0095, cz, bw, 0.003, L - 0.8, fl.border);
        K.lbox(R2.x1 - 0.4, F.yLocal + 0.0095, cz, bw, 0.003, L - 0.8, fl.border);
      }
    }
    if (spec.lights !== false) yield* lights(D, spec.lights || "track");
    if (spec.sign) {
      const S = spec.signAt || {};
      const sw = S.w || Math.min(3.2, (R.x1 - R.x0) * 0.5);
      const lx = S.lx != null ? S.lx : (R.x0 + R.x1) / 2, ly = S.ly != null ? S.ly : D.ceil - 0.42, lz = S.lz != null ? S.lz : R.z1 - 0.06;
      const lyaw = S.lyaw != null ? S.lyaw : Math.PI;
      const tex = text([String(spec.sign)], { bg: spec.signBg || "#1d1f23", fg: spec.signFg || "#f2efe6", w: 512, h: 96, border: false });
      const fx = Math.sin(lyaw), fz = Math.cos(lyaw);
      const quarter = Math.abs(Math.round(fx)) === 1;
      K.lbox(lx - fx * 0.03, ly, lz - fz * 0.03, quarter ? 0.05 : sw + 0.12, 0.5, quarter ? sw + 0.12 : 0.05, spec.signBack != null ? spec.signBack : 0x15171b);
      if (tex) { const m = panel(b, null, lx + fx * 0.002, ly, lz + fz * 0.002, sw, sw * 96 / 512, lyaw, tex, true); if (m) D.signMesh = m; }
    }
    if (spec.posters) for (const p of spec.posters) {
      if (!p || !p.tex) continue;
      const Fr = wallOf(R, p.edge);
      const pp = Fr.P(p.a, 0.012);
      D.box(Fr, p.a, 0.008, p.y - p.h / 2 - 0.03, p.w + 0.06, 0.016, p.h + 0.06, p.frame != null ? p.frame : 0x1a1a1a);
      panel(b, null, pp.x, y + p.y, pp.z, p.w, p.h, Fr.yaw, p.tex, false);
    }
    if (!spec.K) yield* K.flushSteps();
    // what was stood here is the building's: the money pass (a safe) and a
    // later dressing keep off it
    if (IV.claim) for (const r of D.claimed) IV.claim(b, k, r);
    return D;
  }
  // the shop window's low display: a riser, the trade's goods on it
  MODS.window = function (D, Fr, a, w, d, o) {
    D.box(Fr, a, 0.04 + d / 2, 0, w, d, 0.32, o.riser || 0x2a2622);
    D.box(Fr, a, 0.04 + d / 2, 0.32, w + 0.02, d + 0.02, 0.02, o.top || 0xd8cfbf);
    stock(D, Fr, a, w - 0.12, 0.04 + d / 2, d * 0.6, 0.34, 0.4, o.style || "boxes", o.pal, (o.seed | 0) + 77);
    D.box(Fr, a, 0.04 + d / 2, 0, w, d, 0.36, 0, { solid: true, noVis: true });
  };

  /* ---- printed targets for the gun store wall (rings, a silhouette) ----- */
  function targetTex(i) {
    if (typeof document === "undefined") return null;
    const key = "target" + (i % 3);
    if (texCache.has(key)) return texCache.get(key);
    const cv = document.createElement("canvas"); cv.width = 128; cv.height = 192;
    const g2 = cv.getContext("2d");
    if (!g2) return null;
    g2.fillStyle = "#f2efe6"; g2.fillRect(0, 0, 128, 192);
    if (i % 3 === 1) {
      g2.fillStyle = "#1d1f23";
      g2.beginPath(); g2.arc(64, 46, 22, 0, Math.PI * 2); g2.fill();
      g2.fillRect(28, 72, 72, 108);
      g2.strokeStyle = "#f2efe6"; g2.lineWidth = 2;
      for (const r of [14, 28, 42]) { g2.beginPath(); g2.arc(64, 118, r, 0, Math.PI * 2); g2.stroke(); }
    } else {
      const C = i % 3 === 0 ? ["#1d1f23", "#f2efe6"] : ["#b8322a", "#f2efe6"];
      for (let r = 6; r >= 1; r--) { g2.fillStyle = C[r % 2]; g2.beginPath(); g2.arc(64, 96, r * 9, 0, Math.PI * 2); g2.fill(); }
      g2.fillStyle = "#1d1f23"; g2.fillRect(8, 8, 112, 4); g2.fillRect(8, 180, 112, 4);
    }
    const t = new THREE.CanvasTexture(cv);
    if (THREE.sRGBEncoding != null) t.encoding = THREE.sRGBEncoding;
    texCache.set(key, t);
    return t;
  }
  // an optician's test chart (rows of letters, smaller going down)
  function chartTex() {
    if (typeof document === "undefined") return null;
    if (texCache.has("eyechart")) return texCache.get("eyechart");
    const cv = document.createElement("canvas"); cv.width = 128; cv.height = 192;
    const g2 = cv.getContext("2d");
    if (!g2) return null;
    g2.fillStyle = "#f6f4ee"; g2.fillRect(0, 0, 128, 192);
    g2.fillStyle = "#15171b"; g2.textAlign = "center"; g2.textBaseline = "middle";
    const rows = ["E", "F P", "T O Z", "L P E D", "P E C F D", "E D F C Z P"];
    for (let i = 0; i < rows.length; i++) { g2.font = "bold " + Math.round(40 - i * 6) + "px Helvetica, Arial, sans-serif"; g2.fillText(rows[i], 64, 24 + i * 29); }
    const t = new THREE.CanvasTexture(cv);
    if (THREE.sRGBEncoding != null) t.encoding = THREE.sRGBEncoding;
    texCache.set("eyechart", t);
    return t;
  }

  CBZ.islandFit = { kit: kit, frame: frameOf, text: text, panel: panel, fixtures: fixtures, hour: hour, onShift: onShift, hash: hash, live: live,
    meshKit: meshKit, flushMesh: flushMesh, solid: solid, seat: seat,
    dress: dress, dressSteps: dressSteps, flushMeshSteps: flushMeshSteps, room: roomOf, ceil: ceilOf, MODS: MODS, CENTRE: CENTRE, PAL: PAL, stock: stock, wallOf: wallOf, frameAt: frameAt,
    targetTex: targetTex, chartTex: chartTex };

})();
