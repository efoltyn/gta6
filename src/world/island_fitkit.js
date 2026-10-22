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
  function kit(b, opts) {
    opts = opts || {};
    const F = frameOf(b);
    const ox = b.ox, oy = b.gy || 0, oz = b.oz;
    const buckets = { solid: { p: [], n: [], c: [] }, glow: { p: [], n: [], c: [] }, glass: { p: [], n: [], c: [] } };
    const cols = [], plats = [];
    const meshes = [];
    function face(B, ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, nx, ny, nz, r, g2, bl) {
      // two triangles a-b-c, a-c-d
      B.p.push(ax, ay, az, bx, by, bz, cx, cy, cz, ax, ay, az, cx, cy, cz, dx, dy, dz);
      for (let i = 0; i < 6; i++) { B.n.push(nx, ny, nz); B.c.push(r, g2, bl); }
    }
    function addBox(B, x, y, z, w, h, d, col) {
      _c.setHex(col == null ? 0x8a8f95 : col);
      const r = _c.r, g2 = _c.g, bl = _c.b;
      const x0 = x - w / 2 - ox, x1 = x + w / 2 - ox, y0 = y - h / 2 - oy, y1 = y + h / 2 - oy, z0 = z - d / 2 - oz, z1 = z + d / 2 - oz;
      face(B, x0, y1, z0, x0, y1, z1, x1, y1, z1, x1, y1, z0, 0, 1, 0, r, g2, bl);      // top
      face(B, x0, y0, z1, x0, y0, z0, x1, y0, z0, x1, y0, z1, 0, -1, 0, r * 0.7, g2 * 0.7, bl * 0.7);
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
        if (!o.noVis) addBox(B, x, y, z, w, h, d, o.emissive != null && !o.glow ? (o.emissive | 0) : col);
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
      flush: function () {
        const MM = mats();
        const parent = opts.parent || (b.group && b.group.parent) || null;
        if (!parent) return meshes;
        for (const k of ["solid", "glow", "glass"]) {
          const B = buckets[k];
          if (!B.p.length) continue;
          const geo = new THREE.BufferGeometry();
          geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(B.p), 3));
          geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(B.n), 3));
          geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(B.c), 3));
          geo.computeBoundingSphere();
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
          B.p.length = 0; B.n.length = 0; B.c.length = 0;
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
  function flushMesh(b, K, name) {
    const out = K.flush(b.group, name || "island-exec");
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

  CBZ.islandFit = { kit: kit, frame: frameOf, text: text, panel: panel, fixtures: fixtures, hour: hour, onShift: onShift, hash: hash, live: live,
    meshKit: meshKit, flushMesh: flushMesh, solid: solid, seat: seat };

})();
