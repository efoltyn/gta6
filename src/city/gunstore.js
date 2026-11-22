/* ============================================================
   city/gunstore.js — THE GUN STORE: the guns are the goods.

   Owner (2026-10-22): "In a gun store, the products are the physical guns
   that you can pick up... like the armory in the jail game: real stuff in
   there." Every gun on the wall and under the glass is the REAL appearance
   model (CBZ.buildActorWeapon, the same wood-and-steel AK every NPC
   carries). [Take] lifts it off its yoke with your hand (CBZ.verbs.pickup)
   and it is in your hands; the register rings up what you are holding
   ([Buy] at the counter, the clerk alive behind it); [Put back] hangs it up
   again; walking out of the door with it is stealing it — the clerk shouts,
   it is reported, it is hot, and the shopkeeper brings up the shotgun from
   under the counter (city/shopfloor.js). Rounds, frags, charges and plates
   are sold over the counter.

   ONE STORE PER SHOP: Gang City's (its lot stamped lot.building.gunstore by
   city/buildings.js) and one per island gun shop (CBZ.islandVenue "guns":
   the ground floor cleared, a back room with the safe behind a partition,
   the rack on the partition, the counter in front of it with the handguns
   in a countertop showcase, the ammo gondola and the grenade crate past its
   end, a shopkeeper at his post). Both are the same code below.

   GANG CITY'S SHOP IS A ROOM, NOT A HALL (2026-11-22). It was its whole
   26 m shell with a counter and one rack at the far end. It is now a sales
   floor ten metres square partitioned out of that shell (CBZ.gunShopPlan,
   below), fitted like a real one:
     - the gun wall behind the clerk: a drawer cabinet with a felt butt tray,
       slatwall, every long gun the shop sells standing in its own padded
       yoke, an LED bar over it;
     - long guns lying on hooks three rows high down both side walls, over
       ammunition shelving (printed boxes two deep, steel cans);
     - a glass display counter across the room: the till, the transfer form
       on its clipboard, then bays of handguns on a glass shelf and the felt
       under it, knives in the first; two more glass cases of handguns on the
       floor. The glass is city glass: a round or a swing breaks it, and
       under it you ask the clerk for the piece or you smash the case;
     - the accessory wall by the door: every optic, can, grip and magazine a
       gunsmith fits (city/gunmods.js), the real part on its printed card;
     - the armoury's forms, a tub of bats, the grenade crate, the C4 case;
     - at the staff end of the gun wall the barred steel door into the back
       room (the clerk carries its key): stock shelving, a crate of rifles,
       the gunsmith's bench and the shop's safe (city/bank.js CBZ.citySafe);
     - cameras in the corners (feeds on the city's CCTV monitors), a chime
       box over the door that sounds as you walk in, the dealer's licence,
       the house rules, and a printed price tag on every piece.
   Everything on a wall that looks like a gun is a gun you can take.
   The sixty-odd display guns are the real models baked into three merged
   meshes (the Bank, below); the tags, signs and cards are one printed sheet.

   Prices/stock come from cityEcon (buyPrice/stockFor). Perf: built when you
   come down the street; fixtures merge to a handful of meshes; the whole
   display is visibility-gated by distance.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.onUpdate) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  /* ==========================================================================
     THE STORE FIXTURE KIT — shared by gunstore.js, jewelry.js, pawnshop.js
     (gunstore.js loads first; the other two build lazily at runtime, so the
     kit is always there by the time they ask for it).

     A Kit collects primitives (box / cyl / torus / sphere, or a whole model
     "absorbed" from CBZ.itemAsset) in a local FRAME (origin + yaw), bakes each
     one's transform and a flat vertex colour into its geometry, and build()
     merges everything per FINISH into one mesh:
        solid  Lambert, vertex colour     (wood, laminate, card, felt, paint)
        metal  Phong, vertex colour       (steel, chrome, aluminium, brass)
        gloss  Phong, low specular        (stone worktops, lacquer)
        glass  Phong, clear, no depth write
        glow   Basic, vertex colour       (ONLY lamps, LED strips, screens)
     So a whole store's fixtures cost ~5 draw calls. Frame convention used by
     every caller: local +X runs along the wall/counter TANGENT, local +Z
     points toward the CUSTOMER (into the room), y is absolute world height.
     ========================================================================== */
  if (!CBZ.storeFixtureKit) (function () {
    const MAT = {};
    function kitMat(kind) {
      let m = MAT[kind];
      if (m) return m;
      if (kind === "metal") m = new THREE.MeshPhongMaterial({ vertexColors: true, specular: 0x8a9098, shininess: 60 });
      else if (kind === "gloss") m = new THREE.MeshPhongMaterial({ vertexColors: true, specular: 0x404040, shininess: 38 });
      else if (kind === "glass") m = new THREE.MeshPhongMaterial({ color: 0xdcecf2, specular: 0xffffff, shininess: 140, transparent: true, opacity: 0.14, depthWrite: false });
      else if (kind === "glow") m = new THREE.MeshBasicMaterial({ vertexColors: true });
      else m = new THREE.MeshLambertMaterial({ vertexColors: true });
      m._shared = true;
      MAT[kind] = m;
      return m;
    }
    const _m = new THREE.Matrix4(), _w = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
    const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
    const KEEP = { position: 1, normal: 1, uv: 1 };

    function Kit() { this.F = new THREE.Matrix4(); this.parts = {}; this.yaw = 0; this.ox = 0; this.oz = 0; }
    // local frame: origin (x, y, z) and a yaw about +Y
    Kit.prototype.frame = function (x, y, z, yaw) {
      this.F.makeRotationY(yaw || 0);
      this.F.setPosition(x || 0, y || 0, z || 0);
      this.yaw = yaw || 0; this.ox = x || 0; this.oz = z || 0;
      return this;
    };
    // frame-local (x, z) → world {x, z}
    Kit.prototype.world = function (x, z) {
      const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
      return { x: this.ox + x * c + z * s, z: this.oz - x * s + z * c };
    };
    Kit.prototype.put = function (geo, matrix, color, kind, own) {
      const gg = geo.index ? geo.toNonIndexed() : geo.clone();   // non-indexed: ANY primitive merges with any other
      if (own) geo.dispose();
      gg.applyMatrix4(matrix);
      const names = Object.keys(gg.attributes);
      for (let i = 0; i < names.length; i++) if (!KEEP[names[i]]) gg.deleteAttribute(names[i]);
      const n = gg.attributes.position.count;
      if (!gg.attributes.normal) gg.computeVertexNormals();
      if (!gg.attributes.uv) gg.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
      _c.setHex(color == null ? 0xffffff : color);
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
      gg.setAttribute("color", new THREE.BufferAttribute(col, 3));
      gg.morphAttributes = {};
      const k = kind || "solid";
      (this.parts[k] || (this.parts[k] = [])).push(gg);
      return this;
    };
    Kit.prototype.push = function (geo, color, kind, x, y, z, rx, ry, rz, sx, sy, sz) {
      _e.set(rx || 0, ry || 0, rz || 0); _q.setFromEuler(_e);
      _p.set(x || 0, y || 0, z || 0); _s.set(sx || 1, sy || 1, sz || 1);
      _m.compose(_p, _q, _s); _m.premultiply(this.F);
      return this.put(geo, _m, color, kind, true);
    };
    Kit.prototype.box = function (x, y, z, w, h, d, color, kind, rx, ry, rz) {
      return this.push(new THREE.BoxGeometry(w, h, d), color, kind, x, y, z, rx, ry, rz);
    };
    Kit.prototype.cyl = function (x, y, z, rt, rb, h, color, kind, rx, ry, rz, seg) {
      return this.push(new THREE.CylinderGeometry(rt, rb, h, seg || 12), color, kind, x, y, z, rx, ry, rz);
    };
    Kit.prototype.torus = function (x, y, z, r, tube, color, kind, rx, ry, rz, arc, seg) {
      return this.push(new THREE.TorusGeometry(r, tube, 6, seg || 18, arc == null ? Math.PI * 2 : arc), color, kind, x, y, z, rx, ry, rz);
    };
    Kit.prototype.sphere = function (x, y, z, r, color, kind, sx, sy, sz) {
      return this.push(new THREE.SphereGeometry(r, 12, 9), color, kind, x, y, z, 0, 0, 0, sx, sy, sz);
    };
    // Bake a whole model (CBZ.itemAsset / buildActorWeapon) into the kit:
    // for static decor that is never bought off its spot one at a time.
    Kit.prototype.absorb = function (obj, x, y, z, rx, ry, rz, sc) {
      if (!obj) return this;
      obj.updateMatrixWorld(true);
      _e.set(rx || 0, ry || 0, rz || 0); _q.setFromEuler(_e);
      _p.set(x || 0, y || 0, z || 0); _s.set(sc || 1, sc || 1, sc || 1);
      _w.compose(_p, _q, _s); _w.premultiply(this.F);
      const self = this;
      obj.traverse(function (o) {
        if (!o.isMesh || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
        const mt = Array.isArray(o.material) ? o.material[0] : o.material;
        const col = mt && mt.color ? mt.color.getHex() : 0x888888;
        const kind = mt && mt.transparent ? "glass" : (mt && mt.isMeshPhongMaterial ? "metal" : "solid");
        _m.multiplyMatrices(_w, o.matrixWorld);
        self.put(o.geometry, _m, col, kind, false);
      });
      return this;
    };
    Kit.prototype.build = function (parent) {
      const BGU = THREE.BufferGeometryUtils, out = [];
      for (const k in this.parts) {
        const list = this.parts[k];
        if (!list || !list.length) continue;
        let geos = list;
        if (BGU && BGU.mergeBufferGeometries && list.length > 1) {
          let merged = null;
          try { merged = BGU.mergeBufferGeometries(list, false); } catch (e) { merged = null; }
          if (merged) { for (let i = 0; i < list.length; i++) list[i].dispose(); geos = [merged]; }
        }
        for (let i = 0; i < geos.length; i++) {
          const gg = geos[i];
          gg.computeBoundingSphere(); gg.computeBoundingBox();
          const mesh = new THREE.Mesh(gg, kitMat(k));
          mesh.castShadow = false;
          mesh.receiveShadow = k !== "glass" && k !== "glow";
          if (k === "glass") mesh.renderOrder = 1;
          mesh.matrixAutoUpdate = false; mesh.updateMatrix();
          parent.add(mesh);
          out.push(mesh);
        }
      }
      this.parts = {};
      return out;
    };

    // the yaw whose local +X is the tangent (tx, tz); local +Z is then
    // (-tz, tx), which for every store in this city is the side facing the door.
    function yawOf(tx, tz) { return Math.atan2(-tz, tx); }

    // A model re-seated on its own bounds: returns a holder Group whose origin
    // is the model's bottom centre (alignZ "min": its back face instead of
    // its z centre), after `orient(turn, model)` has rotated it. Size in
    // holder.userData.size (x = along the frame, y = height, z = depth).
    function seat(model, orient, alignZ) {
      const turn = new THREE.Group();
      turn.add(model);
      if (orient) orient(turn, model);
      turn.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(turn);
      const holder = new THREE.Group();
      holder.add(turn);
      if (isFinite(bb.min.x) && isFinite(bb.max.x)) {
        turn.position.set(-(bb.min.x + bb.max.x) / 2, -bb.min.y,
          alignZ === "min" ? -bb.min.z : -(bb.min.z + bb.max.z) / 2);
        holder.userData.size = { x: bb.max.x - bb.min.x, y: bb.max.y - bb.min.y, z: bb.max.z - bb.min.z };
      } else holder.userData.size = { x: 0.2, y: 0.1, z: 0.1 };
      holder.userData.turn = turn;
      return holder;
    }

    // WHERE A STORE'S COUNTER IS, in world terms: the fit-out record the
    // shop build declared (city/fitout.js), else the posted clerk's spot
    // (who stands 1.2 m behind the counter centre). `top` is the counter
    // box's top (buildings.js stands a 1.2-tall box from y 0).
    function counterOf(lot) {
      const b = lot && lot.building;
      if (!b) return null;
      const ox = b.ox != null ? b.ox : lot.cx, oz = b.oz != null ? b.oz : lot.cz;
      const dr = b.localDoor || b.door;
      if (!dr || dr.nx == null) return null;
      const inx = dr.nx, inz = dr.nz, tx = -inz, tz = inx;
      let K = null;
      const site = CBZ.fitoutSiteOf ? CBZ.fitoutSiteOf(b) : null;
      const f0 = site && site.floors && site.floors[0];
      if (f0) {
        const recs = [f0].concat(f0.extra || []);
        for (let i = 0; i < recs.length && !K; i++) if (recs[i] && recs[i].info && recs[i].info.counter) K = recs[i].info.counter;
      }
      if (K) return { x: ox + K.x, z: oz + K.z, w: K.w, d: K.d, top: 1.2, tx, tz, inx, inz };
      const v = b.vendorSpot;
      if (!v) return null;
      const along = Math.abs(inx) > 0.5;
      return { x: v.x - inx * 1.2, z: v.z - inz * 1.2,
               w: along ? 0.8 : Math.min((b.w || 10) - 2, 4.5), d: along ? Math.min((b.d || 10) - 2, 4.5) : 0.8,
               top: 1.2, tx, tz, inx, inz };
    }

    // DRESS A COUNTER. buildings.js stands a bare 1.2 m box and fitout.js
    // leaves the flagship trades' counters to their own files: this wraps it
    // in cladding over a kick plinth, runs a trim line and panel reveals on
    // the customer face, and lays an overhanging worktop. The kit's frame
    // must already be the counter frame (origin = counter centre, y = 0).
    // Returns the worktop's top height.
    function dressCounter(kit, L, D, top, FY, o) {
      o = o || {};
      const clad = o.clad || 0x2a2d32, trim = o.trim || 0xa3a7ac, work = o.work || 0x1d1e21, kick = o.kick || 0x111214;
      const workKind = o.workKind || "gloss";
      const h = top - FY;
      kit.box(0, FY + h / 2, 0, L + 0.04, h, D + 0.04, clad, o.cladKind || "solid");
      kit.box(0, FY + 0.05, 0, L + 0.05, 0.1, D + 0.05, kick);
      const zf = D / 2 + 0.022;
      kit.box(0, FY + 0.101, zf + 0.002, L + 0.045, 0.012, 0.004, trim, "metal");     // plinth cap
      kit.box(0, top - 0.09, zf + 0.002, L + 0.045, 0.022, 0.004, trim, "metal");     // top trim line
      const panels = Math.max(1, Math.round(L / 0.9));
      for (let i = 1; i < panels; i++) {                                             // panel reveals
        const x = -L / 2 + (L * i) / panels;
        kit.box(x, FY + 0.1 + (h - 0.2) / 2, zf + 0.001, 0.008, h - 0.2, 0.003, 0x151618);
      }
      kit.box(0, top + 0.02, 0.02, L + 0.08, 0.04, D + 0.12, work, workKind);         // worktop, customer overhang
      return top + 0.04;
    }

    // A POS till on the clerk side of a counter top (screen on a pole facing
    // the clerk, receipt printer), a cash drawer under the worktop on the
    // clerk face, and a card reader on the customer edge. Counter frame.
    function till(kit, x, top, D) {
      const zc = -D / 2 + 0.24;
      kit.box(x, top + 0.01, zc, 0.2, 0.02, 0.18, 0x1c1e22, "metal");
      kit.cyl(x, top + 0.11, zc + 0.02, 0.014, 0.014, 0.18, 0x2a2d31, "metal");
      const a = 0.3, sy = top + 0.3, sz = zc + 0.03;
      kit.box(x, sy, sz, 0.34, 0.24, 0.035, 0x1a1b1e, "gloss", a);
      kit.box(x, sy + 0.019 * Math.sin(a), sz - 0.019 * Math.cos(a), 0.3, 0.2, 0.004, 0x2e4a66, "glow", a);
      kit.box(x + 0.27, top + 0.055, zc, 0.14, 0.11, 0.18, 0xd6d6d2);                  // receipt printer
      kit.box(x + 0.27, top + 0.111, zc + 0.03, 0.1, 0.003, 0.012, 0x222222);           // paper slot
      kit.box(x + 0.27, top + 0.114, zc + 0.03, 0.08, 0.002, 0.03, 0xf4f2ea, "solid", -0.6);
      kit.box(x + 0.1, top - 0.1, -D / 2 - 0.033, 0.44, 0.11, 0.02, 0x2a2c30);           // cash drawer
      kit.box(x + 0.1, top - 0.1, -D / 2 - 0.045, 0.12, 0.012, 0.012, 0xb4b8bd, "metal");
      const cx = x - 0.34, cz = D / 2 - 0.1;                                            // card reader
      kit.box(cx, top + 0.01, cz, 0.09, 0.02, 0.1, 0x1c1e22);
      kit.box(cx, top + 0.045, cz + 0.01, 0.075, 0.03, 0.15, 0x24262a, "gloss", -0.35);
      kit.box(cx, top + 0.063, cz - 0.02, 0.055, 0.003, 0.04, 0x3f7fa6, "glow", -0.35);
      kit.box(cx, top + 0.071, cz + 0.035, 0.055, 0.003, 0.05, 0x8b9096, "solid", -0.35);
    }

    // A countertop showcase in a counter frame, centred at local (xc, 0):
    // black base, felt deck, aluminium corner posts and rails, glass lid,
    // customer front and ends, two sliding glass doors on the clerk side
    // with a lock, an LED strip under the lid's front rail (inside only).
    // Returns the deck's top height.
    function showcase(k, xc, top, len, wid, o) {
      o = o || {};
      const H = o.h || 0.3, BASE = 0.045, AL = o.frame || 0xb2b6bb, AK = o.frameKind || "metal";
      k.box(xc, top + BASE / 2, 0, len, BASE, wid, o.base || 0x16181b);
      k.box(xc, top + BASE + 0.004, 0, len - 0.03, 0.008, wid - 0.03, o.felt || 0x1f3327);
      const y0 = top + BASE, yTop = y0 + H;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(xc + sx * (len / 2 - 0.01), y0 + H / 2, sz * (wid / 2 - 0.01), 0.02, H, 0.02, AL, AK);
      for (const sz of [-1, 1]) {
        k.box(xc, yTop - 0.01, sz * (wid / 2 - 0.01), len, 0.02, 0.02, AL, AK);
        k.box(xc, y0 + 0.01, sz * (wid / 2 - 0.01), len, 0.02, 0.02, AL, AK);
      }
      for (const sx of [-1, 1]) k.box(xc + sx * (len / 2 - 0.01), yTop - 0.01, 0, 0.02, 0.02, wid, AL, AK);
      k.box(xc, yTop - 0.003, 0, len - 0.03, 0.006, wid - 0.03, 0, "glass");
      k.box(xc, y0 + H / 2, wid / 2 - 0.01, len - 0.03, H - 0.03, 0.006, 0, "glass");
      for (const sx of [-1, 1]) k.box(xc + sx * (len / 2 - 0.01), y0 + H / 2, 0, 0.006, H - 0.03, wid - 0.03, 0, "glass");
      for (const sx of [-1, 1]) k.box(xc + sx * len / 4, y0 + H / 2, -(wid / 2 - 0.01) + (sx > 0 ? 0.012 : 0), len / 2 + 0.02, H - 0.03, 0.006, 0, "glass");
      k.cyl(xc, y0 + H - 0.05, -(wid / 2 - 0.004), 0.008, 0.008, 0.012, 0xd8dade, "metal", Math.PI / 2);
      k.box(xc, yTop - 0.023, wid / 2 - 0.01, len - 0.1, 0.006, 0.014, 0xfff6e6, "glow");
      return y0 + 0.008;
    }

    // a small white card price tag on a string, as its own tiny group (it
    // leaves with the piece it prices). Shared geometry + material.
    let TAG = null;
    function tagCard(len) {
      if (!TAG) {
        TAG = { card: new THREE.BoxGeometry(0.04, 0.062, 0.002), str: new THREE.BoxGeometry(0.0016, 1, 0.0016),
                stripe: new THREE.BoxGeometry(0.03, 0.004, 0.0024),
                white: new THREE.MeshLambertMaterial({ color: 0xf3f0e6 }), line: new THREE.MeshLambertMaterial({ color: 0x9a2a22 }),
                twine: new THREE.MeshLambertMaterial({ color: 0xcbb68a }) };
        for (const k in TAG) TAG[k]._shared = true;
      }
      len = len || 0.05;
      const grp = new THREE.Group();
      const s = new THREE.Mesh(TAG.str, TAG.twine); s.scale.y = len; s.position.y = -len / 2; grp.add(s);
      const c = new THREE.Mesh(TAG.card, TAG.white); c.position.y = -len - 0.031; grp.add(c);
      const l = new THREE.Mesh(TAG.stripe, TAG.line); l.position.set(0, -len - 0.012, 0); grp.add(l);
      grp.traverse(function (o) { o.castShadow = false; o.receiveShadow = false; });
      return grp;
    }
    // a folded tent card standing on a surface (origin = its foot), facing +Z.
    function tentCard() {
      tagCard();
      const grp = new THREE.Group();
      for (const sgn of [-1, 1]) {
        const c = new THREE.Mesh(TAG.card, TAG.white);
        c.rotation.x = sgn * 0.32; c.position.set(0, 0.03, -sgn * 0.0095);
        c.castShadow = false; grp.add(c);
      }
      const l = new THREE.Mesh(TAG.stripe, TAG.line); l.rotation.x = -0.32; l.position.set(0, 0.04, 0.0063); grp.add(l);
      return grp;
    }

    // a deterministic stream (layout variety without Math.random churn)
    function rng(seed) { let s = (seed >>> 0) || 1; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

    CBZ.storeFixtureKit = { create: function () { return new Kit(); }, yawOf, seat, counterOf, dressCounter, till, showcase, tagCard, tentCard, rng };
  })();
  const KIT = CBZ.storeFixtureKit;
  const SF = function () { return CBZ.shopFloor || null; };

  /* ==========================================================================
     THE SHOP PLAN — a gun shop is a shop-sized room, not a hall.

     Gang City's gun shop was its whole 26 x 26 m shell with a counter and one
     rack against the far wall. A real one is a sales floor some ten metres
     square: racks of long guns down both side walls, glass cases of handguns
     on the floor, a glass display counter across the room with the gun wall
     behind the clerk, and a barred door at the staff end of that wall into
     the back room where the safe, the bench and the stock are. The rest of a
     big shell is the building's own hall (its stair and lift), through a
     staff door behind the counter.

     CBZ.gunShopPlan(b) is that room, a pure function of the shell record
     (its door, its size, its wall thickness, its reserved stair and lift
     rects), in the door's own frame: u along the door wall, v into the room
     from the door wall's OUTER face (the frame city/fitout_work.js plans a
     shop in). Three files read it and none of them types a coordinate:
     city/buildings.js stands the counter and the clerk on it, fitout_work.js
     stands the partitions and the floor, and this file hangs the shop.
     A shell too small to partition (or one whose stair core stands where the
     shop would) returns null and stays one room.
     ========================================================================== */
  function shopPlan(b) {
    const dr = b && b.localDoor;
    if (!dr || dr.nx == null || !(b.w > 0) || !(b.d > 0)) return null;
    const inx = dr.nx, inz = dr.nz, tx = -inz, tz = inx;
    const along = Math.abs(inx) > 0.5;
    const halfIn = (along ? b.w : b.d) / 2, halfTan = (along ? b.d : b.w) / 2;
    const wt = b.wt != null ? b.wt : 0.4;
    const Ti = halfTan - wt, Bi = 2 * halfIn - wt;          // inner side faces at u = +-Ti, inner back face at v = Bi
    if (2 * Ti < 7.6 || Bi - wt < 11) return null;
    const T = 0.14;                                          // partition thickness
    const lx = function (u, v) { return inx * (v - halfIn) + tx * u; };
    const lz = function (u, v) { return inz * (v - halfIn) + tz * u; };
    const doorU = dr.x * tx + dr.z * tz;
    const SW = Math.min(2 * Ti, 10.4);
    let ua = Math.max(-Ti, Math.min(Ti - SW, doorU - SW / 2)), ub = ua + SW;
    if (ua + Ti < 2.6) ua = -Ti;                             // a strip too thin to be a hall goes to the shop
    if (Ti - ub < 2.6) ub = Ti;
    const SD = wt + Math.min(10.0, Bi - wt - 4.6);           // the back partition's shop face
    let BD = Math.min(4.4, Bi - SD - T);                     // the back room's depth
    const backWall = Bi - (SD + T + BD) >= 2.2;              // a hall behind it, or it runs to the shell
    if (!backWall) BD = Bi - SD - T;
    const wallA = ua > -Ti + 0.01, wallB = ub < Ti - 0.01;   // side partitions (a hall beyond)
    const vEnd = SD + T + BD + (backWall ? T : 0);
    // the stair core, the lift chase and their landings may not stand in the shop
    const R = { u0: ua - (wallA ? T : 0), u1: ub + (wallB ? T : 0), v0: wt, v1: vEnd };
    const res = (b.shaftRects || []).concat(b.keepRects || []);
    for (let i = 0; i < res.length; i++) {
      const r = res[i];
      const us = [r.x0 * tx + r.z0 * tz, r.x1 * tx + r.z1 * tz], vs = [r.x0 * inx + r.z0 * inz + halfIn, r.x1 * inx + r.z1 * inz + halfIn];
      if (Math.max(us[0], us[1]) > R.u0 - 0.3 && Math.min(us[0], us[1]) < R.u1 + 0.3 && Math.max(vs[0], vs[1]) > R.v0 && Math.min(vs[0], vs[1]) < R.v1 + 0.3) return null;
    }
    // the counter: across the room, the clerk's aisle and the gun wall's cabinet behind it,
    // a gap at the +u end for the staff (in line with the barred door)
    const CD = 0.72, GAP = 1.25, cv = SD - 1.75 - CD / 2;
    const cu0 = ua + 0.02, cu1 = ub - GAP;
    const gateU = ub - 0.9;                                  // the back room's barred door (1.0 wide)
    const rackU0 = ua + 0.25, rackU1 = gateU - 0.5 - 0.3;    // the gun wall's run on the partition
    const ox = b.ox || 0, oz = b.oz || 0;
    const P = {
      inx: inx, inz: inz, tx: tx, tz: tz, halfIn: halfIn, halfTan: halfTan, wt: wt, T: T, Ti: Ti, Bi: Bi,
      ua: ua, ub: ub, SD: SD, BD: BD, backWall: backWall, wallA: wallA, wallB: wallB, vEnd: vEnd, doorU: doorU,
      CD: CD, cv: cv, cu0: cu0, cu1: cu1, gateU: gateU, gateW: 1.0, rackU0: rackU0, rackU1: rackU1,
      // the staff door into the hall, behind the counter line (only where there is a hall)
      staffDoor: wallB ? { v: SD - 0.9, w: 0.9 } : null,
      lx: lx, lz: lz,
      w: function (u, v) { return { x: ox + lx(u, v), z: oz + lz(u, v) }; },     // plan -> world
      plan: function (x, z) { const dx = x - ox, dz = z - oz; return { u: dx * tx + dz * tz, v: dx * inx + dz * inz + halfIn }; },
      // the yaw of a fixture whose front faces the plan direction (du, dv)
      yaw: function (du, dv) { return Math.atan2(tx * du + inx * dv, tz * du + inz * dv); },
      counterBox: { ccx: lx((cu0 + cu1) / 2, cv), ccz: lz((cu0 + cu1) / 2, cv), cw: along ? CD : cu1 - cu0, cd: along ? cu1 - cu0 : CD },
    };
    // what city/buildings.js stamps on the lot (lot.building.gunstore), in the world
    P.descriptor = function (cx, cz, name) {
      const a = { x: cx + lx(R.u0, R.v0), z: cz + lz(R.u0, R.v0) }, c = { x: cx + lx(R.u1, R.v1), z: cz + lz(R.u1, R.v1) };
      const ru = (rackU0 + rackU1) / 2;
      return {
        name: name, plan: P,
        bounds: { minX: Math.min(a.x, c.x), maxX: Math.max(a.x, c.x), minZ: Math.min(a.z, c.z), maxZ: Math.max(a.z, c.z) },
        rack: { x: cx + lx(ru, SD - 0.18), z: cz + lz(ru, SD - 0.18), nx: -inx, nz: -inz, tx: tx, tz: tz, span: rackU1 - rackU0 },
        counter: { x: cx + P.counterBox.ccx, z: cz + P.counterBox.ccz, w: P.counterBox.cw, d: P.counterBox.cd, top: 1.0, tx: tx, tz: tz },
      };
    };
    return P;
  }
  CBZ.gunShopPlan = shopPlan;

  /* ---- PRINT: every price tag, sign and poster in a shop is one sheet ------
     A canvas atlas and one merged mesh of quads on it, so a wall of sixty
     tagged guns costs one draw call for its tags, and a tag can leave with
     its gun (its four corners collapse). cell(key, w, h, draw) lays a piece
     of artwork on the sheet once; quad(...) stands a rectangle of it in the
     room, in a fixture kit's frame. */
  function Sheet(px) {
    this.px = px || 2048;
    this.cv = document.createElement("canvas"); this.cv.width = this.cv.height = this.px;
    this.ctx = this.cv.getContext("2d");
    this.cells = new Map(); this.cx = 2; this.cy = 2; this.rowH = 0;
    this.pos = []; this.uv = []; this.nor = []; this.mesh = null;
  }
  Sheet.prototype.cell = function (key, w, h, draw) {
    let c = this.cells.get(key);
    if (c) return c;
    if (this.cx + w + 2 > this.px) { this.cx = 2; this.cy += this.rowH + 2; this.rowH = 0; }
    if (this.cy + h + 2 > this.px) return this.cells.values().next().value || { u0: 0, v0: 0, u1: 0, v1: 0 };   // full: reuse one
    const x = this.cx, y = this.cy, g2 = this.ctx;
    g2.save(); g2.beginPath(); g2.rect(x, y, w, h); g2.clip(); g2.translate(x, y);
    try { draw(g2, w, h); } catch (e) { console.error("[gun shop print]", e); }
    g2.restore();
    this.cx += w + 2; this.rowH = Math.max(this.rowH, h);
    c = { u0: x / this.px, u1: (x + w) / this.px, v0: 1 - (y + h) / this.px, v1: 1 - y / this.px };
    this.cells.set(key, c);
    return c;
  };
  const _sm = new THREE.Matrix4(), _sq = new THREE.Quaternion(), _se = new THREE.Euler(), _sp = new THREE.Vector3(), _ss = new THREE.Vector3(1, 1, 1), _sv = new THREE.Vector3();
  // a w x h rectangle of cell c, centred at (x, y, z) in kit k's frame, facing its +Z
  // (turned by rx/ry/rz). slot: the thing it leaves with (hide(slot)).
  Sheet.prototype.quad = function (k, c, x, y, z, w, h, rx, ry, rz, slot) {
    _se.set(rx || 0, ry || 0, rz || 0); _sq.setFromEuler(_se); _sp.set(x, y, z);
    _sm.compose(_sp, _sq, _ss); _sm.premultiply(k.F);
    const start = this.pos.length / 3;
    const C = [[-w / 2, -h / 2, c.u0, c.v0], [w / 2, -h / 2, c.u1, c.v0], [w / 2, h / 2, c.u1, c.v1], [-w / 2, h / 2, c.u0, c.v1]];
    _sv.set(0, 0, 1).transformDirection(_sm);
    const nx = _sv.x, ny = _sv.y, nz = _sv.z;
    for (const i of [0, 1, 2, 0, 2, 3]) {
      _sv.set(C[i][0], C[i][1], 0).applyMatrix4(_sm);
      this.pos.push(_sv.x, _sv.y, _sv.z); this.uv.push(C[i][2], C[i][3]); this.nor.push(nx, ny, nz);
    }
    if (slot) (slot.print || (slot.print = [])).push(start);
    return this;
  };
  Sheet.prototype.build = function (group) {
    if (!this.pos.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.pos), 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(this.nor), 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(this.uv), 2));
    geo.computeBoundingSphere();
    const tex = new THREE.CanvasTexture(this.cv);
    const R = CBZ.renderer;
    if (R && THREE.SRGBColorSpace && R.outputColorSpace === THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    try { tex.anisotropy = R && R.capabilities ? Math.min(8, R.capabilities.getMaxAnisotropy()) : 4; } catch (e) {}
    const mat = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = false; this.mesh.receiveShadow = false;
    this.mesh.matrixAutoUpdate = false; this.mesh.updateMatrix();
    this.keep = new Float32Array(geo.attributes.position.array);
    group.add(this.mesh);
    return this.mesh;
  };
  Sheet.prototype.show = function (slot, on) {
    if (!this.mesh || !slot || !slot.print) return;
    const a = this.mesh.geometry.attributes.position;
    for (const st of slot.print) {
      if (on) a.array.set(this.keep.subarray(st * 3, st * 3 + 18), st * 3); else a.array.fill(0, st * 3, st * 3 + 18);
    }
    a.needsUpdate = true;
  };
  // the artwork
  function fitText(g2, text, maxW, size, font) {
    let px = size;
    do { g2.font = (font || "700 ") + px + "px 'Helvetica Neue', Helvetica, Arial, sans-serif"; px -= 2; } while (px > 8 && g2.measureText(text).width > maxW);
  }
  function artTag(name, price) {
    return function (g2, w, h) {
      g2.fillStyle = "#f4f0e2"; g2.fillRect(0, 0, w, h);
      g2.fillStyle = "#a3261f"; g2.fillRect(0, 0, w, 10);
      g2.fillStyle = "#2a2622"; g2.textAlign = "center"; g2.textBaseline = "middle";
      fitText(g2, name.toUpperCase(), w - 12, 20, "600 "); g2.fillText(name.toUpperCase(), w / 2, 28);
      g2.fillStyle = "#111"; fitText(g2, price, w - 10, 44); g2.fillText(price, w / 2, h - 30);
    };
  }
  function artSign(lines, bg, fg, o) {
    o = o || {};
    return function (g2, w, h) {
      g2.fillStyle = bg; g2.fillRect(0, 0, w, h);
      if (o.border) { g2.strokeStyle = o.border; g2.lineWidth = Math.max(4, h * 0.04); g2.strokeRect(g2.lineWidth, g2.lineWidth, w - 2 * g2.lineWidth, h - 2 * g2.lineWidth); }
      g2.fillStyle = fg; g2.textAlign = "center"; g2.textBaseline = "middle";
      const n = lines.length, lh = (h * 0.8) / n;
      for (let i = 0; i < n; i++) {
        const big = i === 0 || o.even;
        fitText(g2, lines[i], w * 0.88, Math.round(lh * (big ? 0.82 : 0.6)), big ? "800 " : "600 ");
        if (i > 0 && o.fg2) g2.fillStyle = o.fg2;
        g2.fillText(lines[i], w / 2, h * 0.1 + lh * (i + 0.5));
      }
    };
  }
  // a paper range target: the black silhouette, its rings, the score box
  function artTarget(tone) {
    return function (g2, w, h) {
      g2.fillStyle = "#efe9d8"; g2.fillRect(0, 0, w, h);
      g2.fillStyle = tone || "#16181a";
      g2.beginPath(); g2.ellipse(w / 2, h * 0.2, w * 0.13, h * 0.1, 0, 0, Math.PI * 2); g2.fill();
      g2.beginPath(); g2.moveTo(w * 0.16, h * 0.9); g2.lineTo(w * 0.2, h * 0.4); g2.quadraticCurveTo(w / 2, h * 0.26, w * 0.8, h * 0.4); g2.lineTo(w * 0.84, h * 0.9); g2.closePath(); g2.fill();
      g2.strokeStyle = "#efe9d8"; g2.lineWidth = 3;
      for (let i = 1; i <= 4; i++) { g2.beginPath(); g2.ellipse(w / 2, h * 0.56, w * 0.07 * i, h * 0.06 * i, 0, 0, Math.PI * 2); g2.stroke(); }
      g2.fillStyle = "#efe9d8"; g2.textAlign = "center"; g2.textBaseline = "middle"; g2.font = "700 " + Math.round(h * 0.06) + "px Helvetica, Arial, sans-serif"; g2.fillText("X", w / 2, h * 0.56);
    };
  }

  /* ---- THE GUN BANK: every gun on show, in three draw calls ----------------
     A shop with sixty guns on its walls cannot afford sixty models (a rifle
     is twenty meshes). Each display gun is the REAL appearance model, posed
     where it hangs and then baked into one merged mesh per finish, with the
     run of vertices it owns remembered: taking it off the wall collapses that
     run, hanging it back restores it. What comes away in your hands is the
     real gun (CBZ.cityGiveWeapon). */
  function Bank() { this.k = KIT.create().frame(0, 0, 0, 0); this.n = {}; this.mesh = {}; this.keep = {}; }
  Bank.prototype.add = function (slot, root) {
    root.updateMatrixWorld(true);
    const self = this;
    slot.rng = slot.rng || [];
    root.traverse(function (o) {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
      const mt = Array.isArray(o.material) ? o.material[0] : o.material;
      const col = mt && mt.color ? mt.color.getHex() : 0x888888;
      const kind = mt && mt.transparent ? "glass" : (mt && mt.isMeshPhongMaterial ? "metal" : "solid");
      const cnt = o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count;
      const start = self.n[kind] || 0;
      self.k.put(o.geometry, o.matrixWorld, col, kind, false);
      self.n[kind] = start + cnt;
      slot.rng.push([kind, start, cnt]);
    });
    slot.bank = this;
  };
  Bank.prototype.build = function (group) {
    const kinds = Object.keys(this.k.parts).filter((kk) => this.k.parts[kk] && this.k.parts[kk].length);
    const out = this.k.build(group);
    if (out.length !== kinds.length) return;                 // a merge failed: the guns draw, they just cannot be lifted off singly
    for (let i = 0; i < kinds.length; i++) {
      this.mesh[kinds[i]] = out[i];
      this.keep[kinds[i]] = new Float32Array(out[i].geometry.attributes.position.array);
    }
  };
  Bank.prototype.show = function (slot, on) {
    if (!slot || !slot.rng) return;
    for (const r of slot.rng) {
      const m = this.mesh[r[0]];
      if (!m) continue;
      const a = m.geometry.attributes.position;
      if (on) a.array.set(this.keep[r[0]].subarray(r[1] * 3, (r[1] + r[2]) * 3), r[1] * 3);
      else a.array.fill(0, r[1] * 3, (r[1] + r[2]) * 3);
      a.needsUpdate = true;
    }
  };

  const RESTOCK = 150;       // seconds a SOLD slot stays a gap (the truck's coming)
  const VIS_R = 55;          // display group draws only when you're near the shop
  const DRESS_R = 110;       // past the draw gate, with room to build it unseen
  const RACK_REACH = 6.0;    // long guns come ACROSS the counter (real gun-store style)
  const CASE_REACH = 3.0;    // counter glass / ammo shelf: walk right up
  const RACK_DOT = 0.60;     // look-cone for the wall (farther away, more central)
  const CASE_DOT = 0.82;     // tighter cone up close
  const LEAN = 0.06;         // radians a racked long gun leans back into its yoke

  /* ONE STORE PER SHOP. Gang City's (its lot from city/buildings.js) and one
     per island gun shop (CBZ.islandVenue "guns"). Every function below takes
     the store it works on; the fixtures ask whichever store you are in. */
  const STORES = [];
  let cityStore = null;
  const CITY = { noLotArena: null, arena: null };

  function econ() { return CBZ.cityEcon || null; }
  function fmt$(n) { n = Math.round(n || 0); return "$" + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

  // the REAL gun model — the exact appearance factory NPCs carry (actorweapons).
  function buildModel(name) {
    if (!CBZ.buildActorWeapon) return null;
    const e = econ(), it = e && e.ITEMS[name];
    const m = CBZ.buildActorWeapon((it && it.gun) || name);
    if (!m) return null;
    m.rotation.set(0, 0, 0);
    m.position.set(0, 0, 0);
    const sc = (CBZ.weaponWorldScale && CBZ.weaponWorldScale(m.userData.weaponId || name)) || 0.95;
    m.scale.setScalar(sc);
    return m;
  }
  // handguns go under the glass; everything with a stock goes in the rack
  function isHandgun(model) {
    const sl = model && model.userData && model.userData.weaponSlot;
    return sl === "pistol" || sl === "utility";
  }

  // the floor a customer stands on: the fit-out's finished floor (city/fitout.js:
  // the eager covering over the slab top, and 4 mm)
  function floorY(b) { return ((b && Array.isArray(b.floorTops) && b.floorTops[0] != null) ? b.floorTops[0] : 0.14) + (CBZ.INTERIOR_FINISH != null ? CBZ.INTERIOR_FINISH : 0.008) + 0.004; }

  // how far along +-tangent from (x, z) the room's walkable bounds reach
  function latRoom(B, x, z, tx, tz, sgn) {
    let best = 1e9;
    const dx = tx * sgn, dz = tz * sgn;
    if (dx > 1e-6) best = Math.min(best, (B.maxX - x) / dx);
    if (dx < -1e-6) best = Math.min(best, (B.minX - x) / dx);
    if (dz > 1e-6) best = Math.min(best, (B.maxZ - z) / dz);
    if (dz < -1e-6) best = Math.min(best, (B.minZ - z) / dz);
    return best;
  }

  /* ---- A STORE ---------------------------------------------------------
     o: { kind: "city"|"island", lot, gs (the buildings.js gunstore shape),
          fy (finished floor, world y), root (parent for the displays),
          clerk (city/shopfloor.js adapter), where, bench, arena,
          inStore(x, z), nearDoor?(x, z), behind?(x, z) } */
  function makeStore(o) {
    const gs = o.gs;
    const S = {
      kind: o.kind, lot: o.lot, gs: gs, FY: o.fy, root: o.root, where: o.where, arena: o.arena || null,
      plan: o.plan || null, bank: null, sheet: null, cases: null, gate: null, gateCand: null, safe: null, cams: null,
      bench: o.bench !== false, benchAt: o.benchAt || null, armorSpots: o.armorSpots || null, group: null, slots: [], dressed: false, near: false, dead: false,
      cx: (gs.bounds.minX + gs.bounds.maxX) / 2, cz: (gs.bounds.minZ + gs.bounds.maxZ) / 2,
      clerk: o.clerk, inStore: o.inStore, cols: [], tillCand: null, till: null,
    };
    const SFx = SF();
    // walking out with a gun off the wall is a robbery, not a candy bar
    S.till = SFx ? SFx.till({ clerk: o.clerk, inStore: o.inStore, nearDoor: o.nearDoor, behind: o.behind, where: o.where, crime: "robbery" }) : null;
    // the register: where you pay for what you are holding (the counter's
    // customer edge, in front of the till)
    const C = gs.counter;
    const cust = { x: -C.tz, z: C.tx };                 // the kit frame's +Z (toward the customer)
    const L = Math.max(C.w, C.d), D = Math.min(C.w, C.d);
    S.tillCand = { till: true, store: S, name: "", x: C.x + C.tx * (-L / 2 + 0.55) + cust.x * (D / 2 + 0.35), y: (C.top || 1.2) + 0.1,
                   z: C.z + C.tz * (-L / 2 + 0.55) + cust.z * (D / 2 + 0.35), reach: CASE_REACH + 0.6, dot: 0.4 };
    STORES.push(S);
    return S;
  }
  function disposeStore(S) {
    if (!S || S.dead) return;
    S.dead = true;
    if (S.till) S.till.dropAll();
    const i = STORES.indexOf(S); if (i >= 0) STORES.splice(i, 1);
    if (S.group) {
      if (S.group.parent) S.group.parent.remove(S.group);
      if (SF()) SF().disposeTree(S.group);
    }
    if (SF()) SF().dropCols(S.cols);
    if (S.clerk && S.clerk.dispose) S.clerk.dispose();
    if (S.cams && CBZ.cctvCameras) for (const c of S.cams) { const k = CBZ.cctvCameras.indexOf(c); if (k >= 0) CBZ.cctvCameras.splice(k, 1); }
    if (S.gate && S.gate.breach && CBZ.unregisterBreachTarget) CBZ.unregisterBreachTarget(S.gate.breach);
    if (S.safe) { if (CBZ.citySafeDrop) CBZ.citySafeDrop(S.safe); if (S.lot && S.lot._realSafe === S.safe) S.lot._realSafe = null; }
    S.group = null; S.slots = []; S.bank = null; S.sheet = null; S.cases = null; S.gate = null; S.safe = null; S.cams = null;
  }

  // ---- build the displays once per store (when you come down the street) ----
  function gunSlot(S, name) {
    return { name: name, gun: true, store: S, sold: false, held: false, restockT: 0, x: 0, y: 0, z: 0, reach: 3, dot: CASE_DOT };
  }
  function buildDisplays(S) {
    const e = econ();
    const group = new THREE.Group();
    group.name = "gun-store";
    S.group = group;
    (S.root || CBZ.scene).add(group);
    const FY = S.FY;
    const R0 = CBZ.storeFixtureKit.rng(Math.round(S.cx * 13) ^ Math.round(S.cz * 7));
    S.bank = new Bank();
    S.sheet = new Sheet(2048);
    // the shop's REAL stock, by where it is shown: anything with a stock stands
    // in a rack, a handgun lies under glass
    S.longNames = []; S.pistolNames = [];
    for (const n of e.stockFor("guns")) {
      const it = e.ITEMS[n];
      if (!it || !it.gun) continue;
      const model = buildModel(n);
      if (!model) continue;
      (isHandgun(model) ? S.pistolNames : S.longNames).push(n);
    }
    if (S.plan) cityRoom(S, group, FY, R0);
    else oneRoom(S, group, FY, R0);
    S.bank.build(group);
    S.sheet.build(group);
    if (S.kind === "city" && CBZ.interiorTrackFixture) CBZ.interiorTrackFixture("gun-store", S.lot.building, group);
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }
  // an axis-aligned solid the store owns (removed with it)
  function solidBox(S, x, z, w, d, y0, y1) {
    const c = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, y0: y0, y1: y1 };
    CBZ.colliders.push(c);
    S.cols.push(c);
    return c;
  }
  // a printed tag (the piece's name and its price) hung at (x, y, z) in k's
  // frame, its top edge at y. It leaves with the piece.
  function hangTag(S, k, s, x, y, z, ry, w) {
    const c = S.sheet.cell("tag:" + s.name, 128, 96, artTag(s.name, fmt$(priceOf(s))));
    w = w || 0.072;
    S.sheet.quad(k, c, x, y - w * 0.375, z, w, w * 0.75, 0, ry || 0, 0, s);
  }
  // the same card stood on a deck, leaning back
  function standTag(S, k, s, x, y, z, ry) {
    const c = S.sheet.cell("tag:" + s.name, 128, 96, artTag(s.name, fmt$(priceOf(s))));
    S.sheet.quad(k, c, x, y + 0.024, z, 0.066, 0.05, -0.42, ry || 0, 0, s);
  }
  // a gun posed in k's frame at (x, y, z): the real model, seated by `orient`,
  // baked into the store's bank. Returns its size (x along the frame, y up, z out).
  function poseGun(S, k, s, orient, alignZ, x, y, z, tiltX, raw0) {
    const raw = raw0 || buildModel(s.name);
    if (!raw) return null;
    const holder = KIT.seat(raw, orient, alignZ);
    const wp = k.world(x, z);
    const pivot = new THREE.Group();
    pivot.position.set(wp.x, y, wp.z);
    pivot.rotation.y = k.yaw;
    if (tiltX) { const tilt = new THREE.Group(); tilt.rotation.x = tiltX; tilt.add(holder); pivot.add(tilt); }
    else pivot.add(holder);
    S.bank.add(s, pivot);
    return holder.userData.size;
  }

  /* ---- A SHELL THAT IS ONE ROOM (an island gun shop, or a city shell too
     small to partition): the rack on the back wall, the counter in front of
     it with the handguns under glass, the ammo gondola and the grenade crate
     past its end, the armoury forms past the other, the bench. */
  function oneRoom(S, group, FY, R0) {
    const e = econ(), C = S.gs.counter;
    buildRack(S, group, S.longNames.map((n) => gunSlot(S, n)), FY);
    const L = Math.max(C.w, C.d), D = Math.min(C.w, C.d);
    const ck = KIT.create().frame(C.x, 0, C.z, KIT.yawOf(C.tx, C.tz));
    const top = KIT.dressCounter(ck, L, D, C.top, FY);
    KIT.till(ck, -L / 2 + 0.55, top, D);
    // the counter's + end holds the C4 hard case when there's room for it
    const c4Zone = L >= 3.0 ? 0.48 : 0;
    const z0 = Math.max(-L / 2 + 1.15, 0.05), z1 = L / 2 - c4Zone - 0.06;
    buildShowcase(S, ck, S.pistolNames.map((n) => gunSlot(S, n)), top, (z0 + z1) / 2, Math.max(0.8, Math.min(2.2, z1 - z0)), Math.min(0.62, D + 0.02));
    // the + end of the floor: the ammo gondola, then the grenade crate
    const ends = buildEnd(S, C, L, D, FY, R0);
    if (e.ITEMS["C4 Charge"]) {
      if (c4Zone) buildC4(S, ck, L / 2 - 0.25, top, 0.02);
      else buildC4(S, ends.kit, ends.ammoX, FY + 1.535, 0);   // tiny counter: the case sits on the gondola
    }
    ck.build(group);
    ends.kit.build(group);
    // the counter is solid where the shell has no counter box of its own
    if (S.kind === "island") solidBox(S, C.x, C.z, (Math.abs(C.tx) > 0.5 ? L : D) + 0.08, (Math.abs(C.tx) > 0.5 ? D : L) + 0.1, FY, C.top + 0.05);
    buildArmorRack(S, group, C, L, FY);
    if (S.bench) buildBench(S, group, C, L, D, FY);
  }

  /* ---- THE GUN WALL -----------------------------------------------------
     gs.rack is a point 0.18 m off the wall's inner face, with the normal
     (nx, nz) pointing back into the room. Everything is laid out in a frame
     whose origin is ON the wall face at floor level: a drawer base cabinet
     with a felt butt tray, a slatwall panel above it, and every long gun
     standing muzzle-up, leaning 3 degrees into its own padded barrel yoke,
     its price tag tied to the yoke. An LED bar light over the rack. */
  function slatwall(k, len, y0, y1, backer, slat) {
    const SH = y1 - y0;
    k.box(0, y0 + SH / 2, 0.006, len, SH, 0.012, backer == null ? 0x57534c : backer);       // groove backer
    const pitch = 0.0762, n = Math.floor(SH / pitch);
    for (let i = 0; i < n; i++) k.box(0, y0 + pitch * (i + 0.5), 0.019, len, pitch - 0.016, 0.014, slat == null ? 0xbab4a8 : slat);
    for (const sx of [-1, 1]) k.box(sx * (len / 2 + 0.012), y0 + SH / 2, 0.016, 0.024, SH + 0.02, 0.032, 0xa7abb0, "metal");
    k.box(0, y1 + 0.012, 0.018, len + 0.05, 0.024, 0.036, 0xa7abb0, "metal");
  }
  // an LED bar on two arms over a wall display
  function ledBar(k, len, y, out) {
    for (const sx of [-1, 1]) k.box(sx * (len / 2 - 0.3), y, out / 2, 0.02, 0.02, out, 0x2a2d31, "metal");
    k.box(0, y, out, len - 0.2, 0.045, 0.09, 0x2a2d31, "metal");
    k.box(0, y - 0.024, out, len - 0.26, 0.006, 0.06, 0xfff4e0, "glow");
  }
  function buildRack(S, group, longs, FY) {
    const R = S.gs.rack;
    const wx = R.x - R.nx * 0.18, wz = R.z - R.nz * 0.18;
    const yaw = KIT.yawOf(R.tx, R.tz);
    const k = KIT.create().frame(wx, 0, wz, yaw);
    const TRAY = FY + 0.92;                     // butt tray top (drawer cabinet height)
    const SLAT = 0.026;                         // slatwall face off the wall

    // stand every gun muzzle-up, side to the room, and measure it
    const racked = [];
    for (const s of longs) {
      const raw = buildModel(s.name);
      if (!raw) continue;
      const holder = KIT.seat(raw, function (turn, m) { m.rotation.set(Math.PI / 2, -Math.PI / 2, 0, "YXZ"); }, "min");
      const sz = holder.userData.size;
      // the bore line: the muzzle point, in the holder frame
      let mu = null;
      if (raw.userData && raw.userData.muzzle && raw.userData.muzzle.isVector3) {
        holder.updateMatrixWorld(true);
        mu = raw.localToWorld(raw.userData.muzzle.clone());
      }
      racked.push({ s, holder, w: sz.x, h: sz.y, th: sz.z, mu: mu || new THREE.Vector3(0, sz.y, sz.z / 2) });
    }
    // tallest in the middle, falling away to both ends: a rack reads as a display
    racked.sort(function (a, b) { return b.h - a.h; });
    const order = [];
    racked.forEach(function (r, i) { if (i % 2) order.push(r); else order.unshift(r); });
    const gap0 = 0.14;
    let used = 0; for (const r of order) used += r.w;
    const maxLen = Math.max(2.4, R.span);
    const gap = order.length > 1 ? Math.max(0.03, Math.min(gap0, (maxLen - 0.5 - used) / (order.length - 1))) : 0;
    const len = Math.min(maxLen, Math.max(2.4, used + gap * Math.max(0, order.length - 1) + 0.5));

    // ---- the drawer base cabinet + felt butt tray ----
    k.box(0, FY + 0.05, 0.22, len - 0.02, 0.1, 0.44, 0x111214);                       // recessed kick
    k.box(0, FY + 0.495, 0.25, len, 0.79, 0.5, 0x2d3035);                        // carcass
    const drawers = Math.max(2, Math.round(len / 0.62));
    const dw = len / drawers;
    for (let i = 0; i < drawers; i++) {
      const x = -len / 2 + dw * (i + 0.5);
      for (let r = 0; r < 2; r++) {
        const y = FY + 0.12 + 0.19 + r * 0.38;
        k.box(x, y, 0.51, dw - 0.012, 0.36, 0.02, 0x3a3e44);
        k.box(x, y + 0.13, 0.528, 0.16, 0.018, 0.018, 0xb4b8bd, "metal");
      }
    }
    k.box(0, TRAY - 0.015, 0.27, len + 0.02, 0.03, 0.54, 0x5c4129);                   // walnut tray top
    k.box(0, TRAY + 0.004, 0.2, len - 0.04, 0.008, 0.3, 0x3b4238);                    // felt butt pad
    const S0 = TRAY + 0.01, S1 = FY + 2.46;
    slatwall(k, len, S0, S1);
    ledBar(k, len, S1 + 0.07, 0.22);

    // ---- the guns, each in its yoke ----
    const sinL = Math.sin(LEAN), cosL = Math.cos(LEAN);
    let x = -len / 2 + 0.25;
    let frontMax = 0;
    order.forEach(function (r) {
      const s = r.s;
      const cxg = x + r.w / 2; x += r.w + gap;
      const zb = (SLAT + 0.02 + r.h * sinL) / cosL;         // the leaning top still clears the slats
      const pivot = new THREE.Group();
      const wp = k.world(cxg, 0);
      pivot.position.set(wp.x, TRAY + 0.008, wp.z);
      pivot.rotation.y = yaw;
      const tilt = new THREE.Group();
      tilt.rotation.x = -LEAN;
      tilt.position.y = -zb * sinL;
      r.holder.position.set(0, 0, zb);
      tilt.add(r.holder); pivot.add(tilt);
      S.bank.add(s, pivot);
      frontMax = Math.max(frontMax, zb * cosL + r.th);
      // the barrel yoke: two arms off the slats either side of the bore at
      // 72% height, joined by a padded bar in front of it
      const yk = r.mu.y * 0.72, bz = r.mu.z + zb;
      const py = TRAY + 0.008 - zb * sinL + yk * cosL + bz * sinL;
      const pz = -yk * sinL + bz * cosL;
      const bx = cxg + r.mu.x;
      const armLen = pz + 0.032 - SLAT;
      for (const sx of [-1, 1]) k.box(bx + sx * 0.03, py, SLAT + armLen / 2, 0.01, 0.014, armLen, 0xb9bdc2, "metal");
      k.box(bx, py, pz + 0.032, 0.074, 0.018, 0.016, 0x1a1a1c);
      k.box(bx, py, SLAT + 0.006, 0.09, 0.05, 0.012, 0xb9bdc2, "metal");               // slat clip plate
      // its price tag, tied to the yoke bar
      hangTag(S, k, s, bx, py - 0.012, pz + 0.045, (R0h(s.name + cxg.toFixed(1)) - 0.5) * 0.4);
      const gp = k.world(cxg, zb + r.th / 2);
      s.x = gp.x; s.y = TRAY + r.h * 0.5; s.z = gp.z; s.reach = RACK_REACH; s.dot = RACK_DOT;
      S.slots.push(s);
    });
    // a chrome stop rail along the front of the tray keeps the butts on it
    if (order.length) {
      const zr = Math.min(0.46, frontMax + 0.05);
      k.box(0, TRAY + 0.045, zr, len - 0.1, 0.012, 0.012, 0xb9bdc2, "metal");
      const posts = Math.max(2, Math.round(len / 0.9));
      for (let i = 0; i <= posts; i++) k.box(-len / 2 + 0.05 + (len - 0.1) * i / posts, TRAY + 0.022, zr, 0.012, 0.045, 0.012, 0xb9bdc2, "metal");
    }
    k.build(group);
    return { len: len, top: S1 };
  }
  function R0h(name) { let h = 7; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0; return (h % 1000) / 1000; }

  // a handgun lying on its right side, muzzle toward +X, grip toward the customer
  function layFlat(turn, m) { m.rotation.set(0, 0, Math.PI / 2); turn.rotation.y = -Math.PI / 2 + 0.35; }
  /* ---- THE COUNTERTOP SHOWCASE (a one-room shop's handguns under glass) ----
     A case on the worktop: black base, felt deck, aluminium posts and rails,
     glass on the top/front/ends, two sliding glass doors on the clerk side,
     an LED strip under the lid's front rail. Each handgun lies on the felt
     with its card in front of it. */
  function buildShowcase(S, ck, pistols, top, xc, len, wid) {
    const yd = KIT.showcase(ck, xc, top, len, wid, { felt: 0x1f3327 });
    const n = pistols.length;
    const rows = n > 4 ? 2 : 1, per = Math.ceil(n / rows);
    pistols.forEach(function (s, i) {
      const row = (i / per) | 0, col = i - row * per;
      const inRow = Math.min(per, n - row * per);
      const lx = xc + (col - (inRow - 1) / 2) * (len - 0.1) / Math.max(inRow, 1);
      const lz = rows === 1 ? -0.07 : (row === 0 ? 0.06 : -0.16);
      if (!poseGun(S, ck, s, layFlat, null, lx, yd + 0.001, lz)) return;
      standTag(S, ck, s, lx + (row ? 0.11 : 0), yd, wid / 2 - 0.055);
      const wp = ck.world(lx, lz);
      s.x = wp.x; s.y = yd + 0.05; s.z = wp.z; s.reach = CASE_REACH; s.dot = CASE_DOT;
      S.slots.push(s);
    });
  }

  // printed boxes of rounds (body, wrap band, end label) along a board, two deep
  const AMMO_WAYS = [[0xb8322a, 0xf0ece0], [0x2f5d3a, 0xe8c547], [0x1f3f73, 0xdadde2], [0xd9d4c4, 0x9a2a22], [0x3a3a3a, 0xd4a43a], [0x7a2f5a, 0xeee6d8]];
  function ammoBoxes(k, R0, x0, x1, y0, zFront, bw, bh, bd, stack, seed) {
    const facings = Math.floor((x1 - x0) / (bw + 0.012));
    const span = (facings - 1) * (bw + 0.012);
    for (let f = 0; f < facings; f++) {
      const way = AMMO_WAYS[(f + seed * 2) % AMMO_WAYS.length];
      const x = (x0 + x1) / 2 - span / 2 + f * (bw + 0.012);
      const hgt = 1 + ((R0() * stack) | 0);
      for (const z of [zFront - bd / 2, zFront - bd / 2 - bd - 0.012]) for (let st = 0; st < hgt; st++) {
        const y = y0 + st * (bh + 0.001);
        k.box(x, y + bh / 2, z, bw, bh, bd, way[0]);
        k.box(x, y + bh * 0.55, z, bw + 0.002, bh * 0.34, bd + 0.002, way[1]);
        k.box(x, y + bh * 0.55, z + bd / 2 + 0.0012, bw * 0.55, bh * 0.2, 0.0015, 0xf6f4ee);
      }
    }
  }
  // a steel ammo can: lid, folded handle, latch, stencil
  function ammoCan(k, cx, y0, z) {
    k.box(cx, y0 + 0.085, z, 0.28, 0.17, 0.15, 0x4b5234, "metal");
    k.box(cx, y0 + 0.182, z, 0.29, 0.028, 0.16, 0x444b2f, "metal");
    k.box(cx, y0 + 0.2, z, 0.13, 0.01, 0.018, 0x2c3020, "metal");
    for (const hx of [-1, 1]) k.box(cx + hx * 0.06, y0 + 0.199, z, 0.012, 0.012, 0.03, 0x2c3020, "metal");
    k.box(cx + 0.146, y0 + 0.14, z, 0.012, 0.09, 0.05, 0x3a4028, "metal");
    k.box(cx, y0 + 0.1, z + 0.0755, 0.12, 0.018, 0.001, 0xd9b23a);
  }
  // the grenade crate: an open OD-painted plank crate, rope handles, a kraft
  // divider tray with the frags standing in it. (fx, fz) in k's frame.
  function grenadeCrate(S, k, R0, fx, fy, fz) {
    const CW = 0.56, CD = 0.4, CH = 0.32;
    const OD = 0x4d5634, ODD = 0x3f472b;
    k.box(fx, fy + 0.01, fz, CW, 0.02, CD, ODD);
    for (const sz of [-1, 1]) for (let p = 0; p < 2; p++) k.box(fx, fy + 0.02 + 0.075 + p * 0.152, fz + sz * (CD / 2 - 0.01), CW, 0.146, 0.02, OD);
    for (const sx of [-1, 1]) for (let p = 0; p < 2; p++) k.box(fx + sx * (CW / 2 - 0.01), fy + 0.02 + 0.075 + p * 0.152, fz, 0.02, 0.146, CD - 0.04, OD);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(fx + sx * (CW / 2 - 0.035), fy + CH / 2 + 0.01, fz + sz * (CD / 2 + 0.008), 0.05, CH - 0.02, 0.016, ODD);
    k.box(fx, fy + 0.2, fz + CD / 2 + 0.0015, 0.26, 0.03, 0.002, 0xd9b23a);
    for (const sx of [-1, 1]) k.torus(fx + sx * (CW / 2 + 0.004), fy + 0.2, fz, 0.045, 0.007, 0xb89a62, "solid", 0, Math.PI / 2, Math.PI, Math.PI);
    const trayY = fy + CH - 0.1;
    k.box(fx, trayY, fz, CW - 0.05, 0.01, CD - 0.05, 0xb08a55);
    for (let i = 1; i < 4; i++) k.box(fx - (CW - 0.05) / 2 + (CW - 0.05) * i / 4, trayY + 0.03, fz, 0.003, 0.05, CD - 0.05, 0xa47e4a);
    k.box(fx, trayY + 0.03, fz, CW - 0.05, 0.05, 0.003, 0xa47e4a);
    if (CBZ.itemAsset) for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
      const gm = CBZ.itemAsset("Grenade", null, { kind: "grenade" });
      if (gm) k.absorb(gm, fx - (CW - 0.05) * 3 / 8 + i * (CW - 0.05) / 4, trayY + 0.005, fz + (j ? 1 : -1) * (CD - 0.05) / 4, 0, R0() * 6.28, 0);
    }
    const gp = k.world(fx, fz + 0.05);
    S.slots.push({ name: "Grenade", boom: true, store: S, sold: false, x: gp.x, y: fy + CH, z: gp.z, reach: CASE_REACH, dot: CASE_DOT });
  }

  /* ---- A ONE-ROOM SHOP'S + END: ammo gondola + grenade crate ---------------
     Built in the counter's frame, stepping out past its + end. The gondola
     is a real shelving unit (uprights, pegboard back, four boards with a
     price-channel lip, a top cap) stocked two deep with printed boxes of
     rounds, steel ammo cans on the bottom board. */
  function buildEnd(S, C, L, D, FY, R0) {
    const e = econ();
    const yaw = KIT.yawOf(C.tx, C.tz);
    const k = KIT.create().frame(C.x, 0, C.z, yaw);
    const room = latRoom(S.gs.bounds, C.x, C.z, C.tx, C.tz, 1) - 0.12;
    const UW = 0.9, UD = 0.4;
    const ax = Math.min(L / 2 + 0.14 + UW / 2, room - UW / 2);
    const SH = [0.12, 0.47, 0.82, 1.17], TOPY = FY + 1.5;
    const GREY = 0x8c9197;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(ax + sx * (UW / 2 - 0.015), FY + 0.75, sz * (UD / 2 - 0.015), 0.03, 1.5, 0.03, GREY, "metal");
    k.box(ax, FY + 0.77, -UD / 2 + 0.006, UW - 0.03, 1.42, 0.012, 0xd4cfc3);                  // pegboard back
    for (let i = 0; i < 12; i++) for (let j = 0; j < 4; j++)
      k.box(ax - UW / 2 + 0.09 + i * 0.066, FY + 1.3 + j * 0.05, -UD / 2 + 0.0125, 0.008, 0.008, 0.002, 0x6f6a60);
    k.box(ax, TOPY + 0.015, 0, UW + 0.02, 0.03, UD + 0.02, 0x2c2f34, "metal");
    k.box(ax, FY + 0.04, 0, UW - 0.03, 0.08, UD - 0.03, 0x1c1e21);                          // kick
    for (const y of SH) {
      k.box(ax, FY + y, 0, UW - 0.03, 0.02, UD - 0.03, 0xd6d8da, "metal");
      k.box(ax, FY + y + 0.004, UD / 2 - 0.008, UW - 0.03, 0.036, 0.008, 0xefefe9);          // price channel
      k.box(ax, FY + y - 0.004, UD / 2 - 0.0035, UW - 0.03, 0.004, 0.002, 0x3a3d42);
    }
    [[SH[1], 0.1, 0.07, 0.065, 2], [SH[2], 0.1, 0.07, 0.065, 1], [SH[3], 0.105, 0.036, 0.065, 3]].forEach(function (sh, si) {
      ammoBoxes(k, R0, ax - UW / 2 + 0.03, ax + UW / 2 - 0.03, FY + sh[0] + 0.01, UD / 2 - 0.018, sh[1], sh[2], sh[3], sh[4], si);
    });
    for (const sx of [-1, 1]) ammoCan(k, ax + sx * 0.21, FY + SH[0] + 0.01, 0.02);
    const ammo = { name: "Ammo Box", ammo: true, store: S, sold: false, x: 0, y: FY + 0.9, z: 0, reach: CASE_REACH, dot: CASE_DOT };
    const ap = k.world(ax, 0.1); ammo.x = ap.x; ammo.z = ap.z;
    S.slots.push(ammo);
    if (S.kind === "island") { const gc = k.world(ax, 0); solidBox(S, gc.x, gc.z, Math.abs(C.tx) > 0.5 ? UW : UD, Math.abs(C.tx) > 0.5 ? UD : UW, FY, TOPY); }
    if (e.ITEMS["Grenade"]) {
      let fx = ax + UW / 2 + 0.14 + 0.28, fy = FY;
      if (fx + 0.28 > room) { fx = ax; fy = TOPY + 0.03; }
      grenadeCrate(S, k, R0, fx, fy, 0);
    }
    return { kit: k, ammoX: ax };
  }

  /* ---- the C4: an open black hard case, egg-crate foam in the lid, two
     charges bedded in the base foam. `k` is a kit whose frame has +Z toward
     the customer; (x, y) is where the case's foot sits. */
  function buildC4(S, k, x, y, z) {
    const W = 0.36, D = 0.27, BH = 0.075;
    k.box(x, y + BH / 2, z, W, BH, D, 0x1b1c1e, "gloss");
    for (let i = -1; i <= 1; i += 2) k.box(x + i * 0.12, y + BH / 2, z + D / 2 + 0.004, 0.05, BH - 0.02, 0.008, 0x151618, "gloss");
    for (const sx of [-1, 1]) k.box(x + sx * 0.1, y + BH - 0.012, z + D / 2 + 0.008, 0.035, 0.02, 0.01, 0x9aa0a6, "metal");
    k.box(x, y + BH - 0.005, z, W - 0.02, 0.01, D - 0.02, 0x2a2b2e);
    const a = -0.28, hz = z - D / 2, hy = y + BH;
    const LH = D;
    k.box(x, hy + (LH / 2) * Math.cos(a), hz + (LH / 2) * Math.sin(a) - 0.02, W, LH, 0.045, 0x1b1c1e, "gloss", a);
    for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) {
      const ly = 0.035 + j * 0.055, lx = -W / 2 + 0.045 + i * 0.068;
      k.box(x + lx, hy + ly * Math.cos(a) + 0.004, hz + ly * Math.sin(a) + 0.006, 0.05, 0.04, 0.012, 0x2a2b2e, "solid", a);
    }
    if (CBZ.itemAsset) for (let i = 0; i < 2; i++) {
      const cm = CBZ.itemAsset("C4 Charge", null, { kind: "bomb" });
      if (cm) k.absorb(cm, x - 0.075 + i * 0.15, y + BH - 0.012, z + 0.02, 0, Math.PI / 2, 0);
    }
    const wp = k.world(x, z);
    S.slots.push({ name: "C4 Charge", boom: true, store: S, sold: false, x: wp.x, y: y + 0.1, z: wp.z, reach: CASE_REACH, dot: CASE_DOT });
  }

  /* ==========================================================================
     THE CITY SHOP — the room CBZ.gunShopPlan draws, fitted out.

     Everything below stands where the plan says (S.plan: u along the door
     wall, v into the room), in fixture-kit frames, merged per finish with the
     rest of the shop. Walking in: armour forms and the accessory wall either
     side of the door, long guns lying on hooks three rows high down both side
     walls over the ammunition shelving, two glass cases of handguns on the
     floor, the glass display counter across the room with the till at one
     end, the gun wall behind the clerk, and at the staff end of that wall the
     barred door into the back room: the safe, the bench, the stock.
     Every gun you can see is a gun you can take.
     ========================================================================== */
  function lieSide(turn, m) { m.rotation.set(0, 0, 0); turn.rotation.y = Math.PI / 2; }
  function layFlatB(turn, m) { m.rotation.set(0, 0, Math.PI / 2); turn.rotation.y = Math.PI / 2 + 0.35; }
  // a breakable pane over a case: city glass, so the same rounds and the same
  // swing break it as break a shop window
  let CASE_GLASS = null;
  function addPane(S, group, x, y, z, w, h, d) {
    if (S.kind !== "city" || !CBZ.cityRegisterGlass) return null;
    let rec = null;
    try { rec = CBZ.cityRegisterGlass(group, x, y, z, w, h, d, 0, 0, null); } catch (e) { rec = null; }
    // showcase glass is water-clear (the city's window glass is tinted to read from the street)
    if (rec && rec.mesh) {
      if (!CASE_GLASS) { CASE_GLASS = new THREE.MeshPhongMaterial({ color: 0xe6f1f4, specular: 0xffffff, shininess: 150, transparent: true, opacity: 0.1, depthWrite: false }); CASE_GLASS._shared = true; }
      rec.mesh.material = CASE_GLASS;
    }
    return rec;
  }
  // the lowest point of a posed model within hw of x (its own frame): where a hook holds it
  const _uv = new THREE.Vector3();
  function undersideAt(holder, xs, hw) {
    holder.updateMatrixWorld(true);
    const out = xs.map(function () { return 1e9; });
    holder.traverse(function (o) {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
      const p = o.geometry.attributes.position, step = Math.max(1, (p.count / 600) | 0);
      for (let i = 0; i < p.count; i += step) {
        _uv.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
        for (let j = 0; j < xs.length; j++) if (Math.abs(_uv.x - xs[j]) < hw && _uv.y < out[j]) out[j] = _uv.y;
      }
    });
    return out;
  }
  function artCard(name, price, kind) {
    return function (g2, w, h) {
      g2.fillStyle = "#e9e4d4"; g2.fillRect(0, 0, w, h);
      g2.fillStyle = "#a3261f"; g2.fillRect(0, 0, w, 14);
      g2.fillStyle = "#6a6458"; g2.textAlign = "center"; g2.textBaseline = "middle";
      fitText(g2, kind.toUpperCase(), w - 16, 18, "600 "); g2.fillText(kind.toUpperCase(), w / 2, 34);
      g2.fillStyle = "#1f2226"; fitText(g2, name.toUpperCase(), w - 14, 24, "700 "); g2.fillText(name.toUpperCase(), w / 2, h - 62);
      g2.fillStyle = "#111"; fitText(g2, price, w - 14, 40); g2.fillText(price, w / 2, h - 26);
    };
  }
  function artLicense(g2, w, h) {
    g2.fillStyle = "#f3efe2"; g2.fillRect(0, 0, w, h);
    g2.strokeStyle = "#1d3a5c"; g2.lineWidth = 6; g2.strokeRect(10, 10, w - 20, h - 20);
    g2.fillStyle = "#1d3a5c"; g2.textAlign = "center"; g2.textBaseline = "middle";
    fitText(g2, "FIREARMS DEALER LICENSE", w - 50, 30); g2.fillText("FIREARMS DEALER LICENSE", w / 2, 50);
    g2.fillStyle = "#3a3630";
    for (let i = 0; i < 6; i++) g2.fillRect(34, 92 + i * 22, (w - 68) * (i % 3 === 2 ? 0.6 : 1), 5);
    g2.beginPath(); g2.arc(w - 64, h - 60, 26, 0, Math.PI * 2); g2.fillStyle = "#b8963e"; g2.fill();
  }
  function artForm(g2, w, h) {
    g2.fillStyle = "#fbfaf4"; g2.fillRect(0, 0, w, h);
    g2.fillStyle = "#22262b"; g2.textAlign = "left"; g2.textBaseline = "middle";
    g2.font = "700 15px Helvetica, Arial, sans-serif"; g2.fillText("FIREARMS TRANSFER RECORD", 12, 20);
    g2.fillStyle = "#555b62";
    for (let i = 0; i < 9; i++) { g2.fillRect(12, 44 + i * 18, w - 24, 2); g2.strokeStyle = "#555b62"; g2.lineWidth = 1.5; if (i > 4) g2.strokeRect(12, 34 + i * 18, 9, 9); }
  }

  function cityRoom(S, group, FY, R0) {
    const e = econ(), P = S.plan, sh = S.sheet;
    const k = KIT.create();
    const at = function (u, v, du, dv) { const w = P.w(u, v); return k.frame(w.x, 0, w.z, P.yaw(du, dv)); };
    const cyc = function (list) { let i = 0; return function () { return list[(i++) % list.length]; }; };
    const nextLong = cyc(S.longNames), nextPistol = cyc(S.pistolNames);
    const V0 = P.wt, uc = (P.ua + P.ub) / 2;
    const alongX = Math.abs(P.tx) > 0.5;                 // the door wall runs along world X
    const uvBox = function (u, v, lu, lv, y0, y1) { const w = P.w(u, v); return solidBox(S, w.x, w.z, alongX ? lu : lv, alongX ? lv : lu, y0, y1); };
    const name = (S.lot.building && S.lot.building.name) || S.gs.name || "Firearms";
    S.cases = [];

    // ---- 0. THE ROOM'S WALLS: the partitions that make the shop a room in its shell ----
    cityWalls(S, k, at, FY, uvBox);

    // ---- 1. THE GUN WALL behind the clerk: every long gun the shop sells, twice over ----
    const nStand = Math.max(S.longNames.length, Math.floor((S.gs.rack.span - 0.5) / 0.4));
    const stand = [];
    for (let i = 0; i < nStand; i++) stand.push(gunSlot(S, nextLong()));
    const wall = buildRack(S, group, stand, FY);
    at((P.rackU0 + P.rackU1) / 2, P.SD, 0, -1);
    sh.quad(k, sh.cell("brand", 1024, 128, artSign([name.toUpperCase()], "#20251f", "#e2c98a", { border: "#8a7a4a" })), 0, FY + 2.7, 0.02, Math.min(3.6, wall.len - 0.4), 0.2);

    // ---- 2. THE DISPLAY COUNTER: the till section, then glass bays of handguns ----
    const L = P.cu1 - P.cu0, D = P.CD, TOP = FY + 1.0, BASE = 0x2a2d32, AL = 0xb2b6bb;
    at((P.cu0 + P.cu1) / 2, P.cv, 0, -1);                // +X = +u, +Z to the customer
    const TW = 1.6, xT = -L / 2 + TW / 2;
    k.box(0, FY + 0.05, 0, L - 0.04, 0.1, D - 0.08, 0x111214);                            // recessed kick
    k.box(xT, FY + 0.54, 0, TW, 0.88, D, BASE);
    k.box(xT, TOP, 0.02, TW + 0.02, 0.04, D + 0.1, 0x1d1e21, "gloss");
    k.box(xT, TOP - 0.09, D / 2 + 0.002, TW, 0.022, 0.004, 0xa3a7ac, "metal");
    for (let i = 1; i < 2; i++) k.box(-L / 2 + TW * i / 2, FY + 0.54, D / 2 + 0.001, 0.008, 0.72, 0.003, 0x151618);
    KIT.till(k, -L / 2 + 0.55, TOP + 0.02, D);
    if (e.ITEMS["C4 Charge"]) buildC4(S, k, -L / 2 + TW - 0.26, TOP + 0.02, 0.02);
    // the transfer form on its clipboard, a pen across it
    k.box(-L / 2 + 1.05, TOP + 0.024, 0.2, 0.23, 0.008, 0.31, 0x6b4a2a);
    k.box(-L / 2 + 1.05, TOP + 0.034, 0.07, 0.1, 0.012, 0.03, 0xb4b8bd, "metal");
    sh.quad(k, sh.cell("form", 160, 220, artForm), -L / 2 + 1.05, TOP + 0.0295, 0.215, 0.2, 0.275, -Math.PI / 2, 0, 0);
    k.cyl(-L / 2 + 1.1, TOP + 0.036, 0.22, 0.004, 0.004, 0.14, 0x1a2a55, "solid", 0, 0, Math.PI / 2 - 0.5);
    const GL = L - TW, nb = Math.max(1, Math.round(GL / 1.9)), bl = GL / nb;
    for (let b = 0; b < nb; b++) {
      const xb = -L / 2 + TW + bl * (b + 0.5);
      k.box(xb, FY + 0.29, 0, bl, 0.38, D, BASE);                                         // the cabinet under the glass
      k.box(xb, FY + 0.3, D / 2 + 0.002, bl - 0.02, 0.012, 0.004, 0xa3a7ac, "metal");
      k.box(xb, FY + 0.486, 0, bl - 0.03, 0.012, D - 0.03, 0x1f3327);                     // felt deck
      k.box(xb, FY + 0.742, 0.03, bl - 0.06, 0.008, D - 0.16, 0, "glass");                // glass shelf
      for (const sx of [-1, 1]) for (const sz of [-0.2, 0.26]) k.box(xb + sx * (bl / 2 - 0.05), FY + 0.61, sz, 0.012, 0.25, 0.012, AL, "metal");
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(xb + sx * (bl / 2 - 0.012), FY + 0.74, sz * (D / 2 - 0.012), 0.024, 0.52, 0.024, AL, "metal");
      for (const sz of [-1, 1]) k.box(xb, TOP - 0.012, sz * (D / 2 - 0.012), bl, 0.024, 0.024, AL, "metal");
      for (const sx of [-1, 1]) k.box(xb + sx * (bl / 2 - 0.012), TOP - 0.012, 0, 0.024, 0.024, D, AL, "metal");
      k.box(xb, FY + 0.74, -D / 2 + 0.02, bl - 0.05, 0.5, 0.012, 0x16181b);              // the clerk's sliding doors
      k.box(xb, FY + 0.74, -D / 2 + 0.01, 0.02, 0.1, 0.012, 0xd8dade, "metal");
      k.box(xb, TOP - 0.03, D / 2 - 0.03, bl - 0.1, 0.006, 0.014, 0xfff6e6, "glow");     // LED under the front rail
      const wc = k.world(xb, 0);
      const cs = { pane: addPane(S, group, wc.x, FY + 0.745, wc.z, alongX ? bl - 0.05 : D - 0.05, 0.5, alongX ? D - 0.05 : bl - 0.05), x: wc.x, z: wc.z, smashed: false };
      S.cases.push(cs);
      // three handguns on the glass shelf; on the felt under it, between them, two more
      // (the first bay's are the knives)
      const put = function (s, lx, y, lz, tagZ, orient, raw) {
        if (!poseGun(S, k, s, orient, null, lx, y, lz, 0, raw)) return;
        standTag(S, k, s, lx, y, tagZ);
        const wp = k.world(lx, lz);
        s.x = wp.x; s.y = y + 0.04; s.z = wp.z; s.reach = CASE_REACH; s.dot = CASE_DOT; s.cs = cs;
        S.slots.push(s);
      };
      if (S.pistolNames.length) for (let i = 0; i < 3; i++) put(gunSlot(S, nextPistol()), xb + (i - 1) * bl / 3.2, FY + 0.747, 0.0, 0.22, layFlat);
      for (let j = 0; j < 2; j++) {
        const lx = xb + (j - 0.5) * bl / 3.2;
        if (b === 0 && e.ITEMS["Knife"] && CBZ.itemAsset) {
          const s = { name: "Knife", melee: true, store: S, sold: false, held: false, restockT: 0 };
          put(s, lx, FY + 0.493, 0.12, 0.3, function (turn) { turn.rotation.y = Math.PI / 2 - 0.3; }, CBZ.itemAsset("Knife"));
        } else if (S.pistolNames.length) put(gunSlot(S, nextPistol()), lx, FY + 0.493, 0.1, 0.3, layFlat);
      }
    }
    { const w = P.w((P.cu0 + P.cu1) / 2, P.cv); solidBox(S, w.x, w.z, alongX ? L : D + 0.1, alongX ? D + 0.1 : L, FY, TOP + 0.03); }
    // a rubber runner from the door to the counter
    at(P.doorU, (V0 + P.cv) / 2, 0, -1);
    k.box(0, FY + 0.006, 0.1, 1.5, 0.012, P.cv - V0 - 1.5, 0x08090a);
    k.box(0, FY + 0.013, 0.1, 1.38, 0.002, P.cv - V0 - 1.62, 0x101113);

    // ---- 3. TWO GLASS CASES OF HANDGUNS on the floor, either side of the aisle ----
    if (S.pistolNames.length) for (const side of [-1, 1]) {
      const cu = P.doorU + side * 2.3, cvv = V0 + 4.5, LEN = 2.3, WID = 0.8, H0 = 0.86, GH = 0.3;
      if (cu - WID / 2 < P.ua + 1.9 || cu + WID / 2 > P.ub - 1.9) continue;      // no room beside the wall racks
      at(cu, cvv, -side, 0);                                // +Z to the centre aisle, +X along the room
      k.box(0, FY + 0.05, 0, LEN - 0.06, 0.1, WID - 0.06, 0x111214);
      k.box(0, FY + 0.1 + (H0 - 0.1) / 2, 0, LEN, H0 - 0.1, WID, 0x21160d);
      for (let i = 1; i < 3; i++) for (const sz of [-1, 1]) k.box(-LEN / 2 + LEN * i / 3, FY + 0.47, sz * (WID / 2 + 0.001), 0.008, H0 - 0.3, 0.003, 0x120b06);
      k.box(0, FY + H0 - 0.04, 0, LEN + 0.012, 0.016, WID + 0.012, 0xb8963e, "metal");     // brass inlay
      k.box(0, FY + H0 + 0.006, 0, LEN - 0.03, 0.012, WID - 0.03, 0x1f3327);               // felt deck
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(sx * (LEN / 2 - 0.012), FY + H0 + GH / 2, sz * (WID / 2 - 0.012), 0.024, GH, 0.024, AL, "metal");
      for (const sz of [-1, 1]) { k.box(0, FY + H0 + GH - 0.012, sz * (WID / 2 - 0.012), LEN, 0.024, 0.024, AL, "metal"); k.box(0, FY + H0 + GH - 0.03, sz * (WID / 2 - 0.03), LEN - 0.1, 0.006, 0.014, 0xfff6e6, "glow"); }
      for (const sx of [-1, 1]) k.box(sx * (LEN / 2 - 0.012), FY + H0 + GH - 0.012, 0, 0.024, 0.024, WID, AL, "metal");
      const wc = P.w(cu, cvv);
      const cs = { pane: addPane(S, group, wc.x, FY + H0 + GH / 2 + 0.006, wc.z, alongX ? WID - 0.05 : LEN - 0.05, GH - 0.012, alongX ? LEN - 0.05 : WID - 0.05), x: wc.x, z: wc.z, smashed: false };
      S.cases.push(cs);
      for (let i = 0; i < 5; i++) {
        const s = gunSlot(S, nextPistol()), lx = (i - 2) * 0.44, far = i % 2 === 1, lz = far ? -0.12 : 0.12;
        if (!poseGun(S, k, s, far ? layFlatB : layFlat, null, lx, FY + H0 + 0.013, lz)) continue;
        const c = sh.cell("tag:" + s.name, 128, 96, artTag(s.name, fmt$(priceOf(s))));
        sh.quad(k, c, lx, FY + H0 + 0.037, far ? -0.31 : 0.31, 0.066, 0.05, far ? 0.42 : -0.42, far ? Math.PI : 0, 0, s);
        const wp = k.world(lx, lz);
        s.x = wp.x; s.y = FY + H0 + 0.05; s.z = wp.z; s.reach = 2.6; s.dot = CASE_DOT; s.cs = cs;
        S.slots.push(s);
      }
      uvBox(cu, cvv, WID, LEN, FY, FY + H0 + GH);
    }

    // ---- 4. THE SIDE WALLS: long guns on hooks, three rows, over the ammunition shelving ----
    const wallRack = function (side, vA, vB, seed) {
      const uW = side < 0 ? P.ua : P.ub, len = vB - vA;
      if (len < 1.6) return;
      at(uW, (vA + vB) / 2, -side, 0);
      const BDp = 0.42, BH = 0.95, nSec = Math.max(1, Math.round(len / 1.3)), sw = len / nSec;
      k.box(0, FY + 0.04, BDp / 2, len - 0.04, 0.08, BDp - 0.04, 0x1c1e21);
      k.box(0, FY + BH / 2, 0.008, len, BH, 0.016, 0xd4cfc3);
      for (let i = 0; i <= nSec; i++) k.box(-len / 2 + sw * i, FY + BH / 2, BDp / 2, 0.024, BH, BDp, 0x2c2f34, "metal");
      const boards = [0.1, 0.4, 0.68];
      for (const y of boards) {
        k.box(0, FY + y, BDp / 2, len - 0.03, 0.02, BDp - 0.02, 0xd6d8da, "metal");
        k.box(0, FY + y + 0.004, BDp - 0.006, len - 0.03, 0.036, 0.008, 0xefefe9);          // price channel
      }
      k.box(0, FY + BH, BDp / 2 + 0.01, len + 0.02, 0.03, BDp + 0.04, 0x2e1f12);            // walnut top
      for (let i = 0; i < nSec; i++) {
        const x0 = -len / 2 + sw * i + 0.03, x1 = x0 + sw - 0.06, xc = (x0 + x1) / 2;
        ammoBoxes(k, R0, x0, x1, FY + 0.41, BDp - 0.03, 0.1, 0.07, 0.065, 2, i + seed);
        ammoBoxes(k, R0, x0, x1, FY + 0.69, BDp - 0.03, 0.105, 0.036, 0.065, 3, i + seed + 1);
        for (const sx of [-1, 1]) ammoCan(k, xc + sx * 0.22, FY + 0.11, BDp / 2);
        const wp = k.world(xc, BDp + 0.12);
        S.slots.push({ name: "Ammo Box", ammo: true, store: S, sold: false, x: wp.x, y: FY + 0.6, z: wp.z, reach: 2.5, dot: 0.74, low: true });
      }
      sh.quad(k, sh.cell("price:ammo", 256, 64, artSign(["AMMUNITION  " + fmt$(e.buyPrice("Ammo Box")) + " A BOX"], "#efefe9", "#1b1d20")), 0, FY + BH - 0.07, BDp + 0.032, Math.min(0.9, len - 0.2), 0.06);
      { const w = P.w(uW - side * (BDp / 2 + 0.02), (vA + vB) / 2); solidBox(S, w.x, w.z, alongX ? BDp + 0.04 : len, alongX ? len : BDp + 0.04, FY, FY + BH + 0.03); }
      slatwall(k, len, FY + 1.02, FY + 2.5);
      ledBar(k, len, FY + 2.57, 0.3);
      const rowsY = [FY + 1.14, FY + 1.58, FY + 2.02];
      for (let r = 0; r < 3; r++) {
        let x = -len / 2 + 0.14 + (r === 1 ? 0.2 : 0);
        for (let guard = 0; guard < 14; guard++) {
          const s = gunSlot(S, nextLong()), raw = buildModel(s.name);
          if (!raw) continue;
          const holder = KIT.seat(raw, lieSide, "min"), sz = holder.userData.size;
          if (sz.y > 0.4) continue;                           // too tall to lie in a row (a mounted launcher)
          if (x + sz.x > len / 2 - 0.1) { if (len / 2 - 0.1 - x < 0.45) break; continue; }   // a shorter one may still fit
          const cx = x + sz.x / 2, hx = [-sz.x * 0.24, sz.x * 0.22];
          const lows = undersideAt(holder, hx, 0.03);
          const wp0 = k.world(cx, 0.034);
          holder.position.set(wp0.x, rowsY[r], wp0.z);
          holder.rotation.y = k.yaw;
          S.bank.add(s, holder);
          for (let j = 0; j < 2; j++) {
            const py = rowsY[r] + (lows[j] < 1e8 ? lows[j] : sz.y * 0.4) - 0.008, pl = sz.z + 0.05;
            k.cyl(cx + hx[j], py, 0.026 + pl / 2, 0.006, 0.006, pl, 0xb9bdc2, "metal", Math.PI / 2, 0, 0, 6);
            k.box(cx + hx[j], py + 0.012, 0.026 + pl, 0.014, 0.034, 0.012, 0x1a1a1c);
            k.box(cx + hx[j], py, 0.03, 0.03, 0.05, 0.008, 0xb9bdc2, "metal");
          }
          hangTag(S, k, s, cx + hx[0], rowsY[r] + (lows[0] < 1e8 ? lows[0] : 0) - 0.012, sz.z + 0.09, (R0() - 0.5) * 0.3);
          const gp = k.world(cx, sz.z / 2 + 0.12);
          s.x = gp.x; s.y = rowsY[r] + sz.y / 2; s.z = gp.z; s.reach = 3.2; s.dot = 0.8; s.row = true;
          S.slots.push(s);
          x += sz.x + 0.13;
        }
      }
    };
    wallRack(-1, V0 + 3.3, P.cv - P.CD / 2 - 0.25, 0);
    wallRack(1, V0 + 2.9, P.cv - P.CD / 2 - 0.9, 3);

    // ---- 5. THE ACCESSORY WALL: optics, cans, grips and magazines, each a part on its card ----
    const cat = CBZ.gunModsCatalog && CBZ.gunModsPartModel ? CBZ.gunModsCatalog() : [];
    if (cat.length) {
      const len = 1.9, vc = V0 + 1.75;
      at(P.ub, vc, -1, 0);
      k.box(0, FY + 0.05, 0.22, len - 0.02, 0.1, 0.44, 0x111214);
      k.box(0, FY + 0.5, 0.24, len, 0.8, 0.48, 0x2d3035);
      const dn = 3, dww = len / dn;
      for (let i = 0; i < dn; i++) for (let r = 0; r < 2; r++) {
        k.box(-len / 2 + dww * (i + 0.5), FY + 0.31 + r * 0.38, 0.49, dww - 0.012, 0.36, 0.02, 0x3a3e44);
        k.box(-len / 2 + dww * (i + 0.5), FY + 0.44 + r * 0.38, 0.508, 0.16, 0.018, 0.018, 0xb4b8bd, "metal");
      }
      k.box(0, FY + 0.915, 0.26, len + 0.02, 0.03, 0.52, 0x2e1f12);
      slatwall(k, len, FY + 1.02, FY + 2.5, 0x202225, 0x3b3e42);
      ledBar(k, len, FY + 2.57, 0.3);
      sh.quad(k, sh.cell("hdr:acc", 512, 64, artSign(["OPTICS  SUPPRESSORS  GRIPS  MAGAZINES"], "#20251f", "#e2c98a")), 0, FY + 2.42, 0.034, len - 0.16, 0.1);
      const per = Math.ceil(cat.length / 2), pitch = (len - 0.2) / per;
      cat.forEach(function (m, i) {
        const row = (i / per) | 0, col = i - row * per;
        const lx = -len / 2 + 0.1 + pitch * (col + 0.5), ly = FY + (row ? 1.4 : 1.98);
        const s = { name: m.name, acc: true, modId: m.id, price: m.price, store: S, sold: false, held: false, restockT: 0 };
        sh.quad(k, sh.cell("acc:" + m.id, 192, 256, artCard(m.name, fmt$(m.price), m.slotLabel || "")), lx, ly, 0.036, pitch - 0.04, (pitch - 0.04) * 1.3, 0, 0, 0);
        let part = null;
        try { part = CBZ.gunModsPartModel(m.id); } catch (er) { part = null; }
        if (part) {
          const holder = KIT.seat(part, function (turn) { turn.rotation.y = Math.PI / 2; }, "min");
          const sc = Math.min(1.5, (pitch - 0.08) / Math.max(0.05, holder.userData.size.x), 0.17 / Math.max(0.03, holder.userData.size.y));
          const wp0 = k.world(lx, 0.05);
          holder.scale.setScalar(sc);
          holder.position.set(wp0.x, ly + 0.02, wp0.z);
          holder.rotation.y = k.yaw;
          S.bank.add(s, holder);
          k.cyl(lx, ly + 0.012, 0.045, 0.004, 0.004, 0.05, 0xb9bdc2, "metal", Math.PI / 2, 0, 0, 6);
        }
        const gp = k.world(lx, 0.2);
        s.x = gp.x; s.y = ly; s.z = gp.z; s.reach = 2.8; s.dot = 0.84; s.row = true;
        S.slots.push(s);
      });
      uvBox(P.ub - 0.26, vc, 0.52, len, FY, FY + 0.93);
    }

    // ---- 6. THE ARMOURY: the forms just inside the door, down the other wall ----
    S.armorSpots = [];
    for (let i = 0; i < 3; i++) { const w = P.w(P.ua + 0.55, V0 + 0.85 + i * 0.85); S.armorSpots.push({ x: w.x, z: w.z, face: P.yaw(1, 0) }); }
    buildArmorRack(S, group, S.gs.counter, L, FY);
    at(P.ua, V0 + 1.7, 1, 0);
    k.box(0, FY + 0.03, 0.55, 2.7, 0.06, 1.1, 0x23262b, "gloss");                           // the forms' plinth
    sh.quad(k, sh.cell("hdr:armor", 384, 64, artSign(["BODY ARMOR"], "#20251f", "#e2c98a")), 0, FY + 2.3, 0.02, 1.5, 0.22);

    // ---- 7. BATS in a tub by the staff end, grenades in their crate at the till ----
    if (e.ITEMS["Bat"] && CBZ.itemAsset) {
      at(P.ub - 0.4, P.cv - P.CD / 2 - 0.45, -1, 0);
      k.cyl(0, FY + 0.22, 0, 0.2, 0.17, 0.44, 0x6b4a2a, "solid", 0, 0, 0, 14);
      for (const y of [0.1, 0.34]) k.torus(0, FY + y, 0, 0.195, 0.008, 0x2a2d31, "metal", Math.PI / 2);
      for (let i = 0; i < 3; i++) {
        const s = { name: "Bat", melee: true, store: S, sold: false, held: false, restockT: 0 };
        const a = i * 2.1, bx = Math.sin(a) * 0.08, bz = Math.cos(a) * 0.08;
        if (!poseGun(S, k, s, function (turn, m) { m.rotation.set(-Math.PI / 2, 0, 0); }, null, bx, FY + 0.03, bz, 0, CBZ.itemAsset("Bat"))) continue;
        const wp = k.world(bx, bz);
        s.x = wp.x; s.y = FY + 0.7; s.z = wp.z; s.reach = 2.4; s.dot = 0.74; s.low = true;
        S.slots.push(s);
      }
      sh.quad(k, sh.cell("tag:Bat", 128, 96, artTag("Bat", fmt$(e.buyPrice("Bat")))), 0, FY + 0.3, 0.205, 0.1, 0.075);
    }
    if (e.ITEMS["Grenade"]) { at(P.cu0 + 1.35, P.cv - P.CD / 2 - 0.32, 0, -1); grenadeCrate(S, k, R0, 0, FY, 0); }

    // ---- 8. THE BACK ROOM behind the barred door: the stock, the bench, the safe ----
    cityBackRoom(S, group, k, at, FY, R0, uvBox);

    // ---- 9. WHAT WATCHES THE ROOM: cameras, the door chime, the house rules ----
    cityWatch(S, group, k, at, FY);
    at(P.ua, P.SD - 0.85, 1, 0);                              // the wall behind the till
    sh.quad(k, sh.cell("license", 320, 240, artLicense), -0.25, FY + 1.75, 0.02, 0.4, 0.3);
    k.box(-0.25, FY + 1.75, 0.012, 0.44, 0.34, 0.016, 0x1b1c1e);
    sh.quad(k, sh.cell("rules", 384, 320, artSign(["ALL SALES FINAL", "NO LOADED FIREARMS", "ID FOR EVERY TRANSFER"], "#f3efe2", "#a3261f", { fg2: "#22262b", border: "#22262b" })), 0.3, FY + 1.72, 0.02, 0.42, 0.35);
    sh.quad(k, sh.cell("target1", 256, 384, artTarget()), -0.22, FY + 2.32, 0.02, 0.3, 0.45);
    sh.quad(k, sh.cell("target2", 256, 384, artTarget("#7a1f1a")), 0.22, FY + 2.32, 0.02, 0.3, 0.45);
    k.build(group);
  }

  /* THE ROOM'S WALLS. The partitions round the sales floor and the back room
     (the gun wall's partition with the barred door's opening in it, the back
     room's rear wall, the side walls where there is hall beyond them with the
     staff door in one). They are this file's, built with the displays and
     drawn with them: the lazy fit-out stood them only within 9 m of the
     building, so from across the street the racks and cases stood in the
     open hall with no walls round them. Solid, floor to the slab above. */
  function cityWalls(S, k, at, FY, uvBox) {
    const P = S.plan, T = P.T, b = S.lot.building;
    const top = (b && Array.isArray(b.floorTops) && b.floorTops[1] != null && b.floorTops[1] > FY + 2.4) ? b.floorTops[1] - 0.03 : FY + 3.0;
    const PAINT = 0xcfc9bb, SKIRT = 0x3a3d40, CASING = 0x2a2d31;
    const H = top - FY;
    // one run of partition: along u at depth v (du=1) or along v at lateral u (du=0)
    const run = function (alongU, at0, s0, s1, gaps) {
      const seg = function (a, c, y0, y1) {
        if (c - a < 0.02 || y1 - y0 < 0.02) return;
        const m = (a + c) / 2;
        if (alongU) { at(m, at0, 0, 1); uvBox(m, at0, c - a, T, FY + y0, FY + y1); }
        else { at(at0, m, 1, 0); uvBox(at0, m, T, c - a, FY + y0, FY + y1); }
        k.box(0, FY + (y0 + y1) / 2, 0, c - a, y1 - y0, T, PAINT);
        if (y0 < 0.01) for (const sd of [-1, 1]) k.box(0, FY + 0.05, sd * (T / 2 + 0.006), c - a, 0.1, 0.012, SKIRT);
      };
      let cur = s0;
      for (const g of (gaps || [])) {
        const g0 = g.c - g.w / 2, g1 = g.c + g.w / 2;
        seg(cur, g0, 0, H);
        seg(g0, g1, g.h, H);                                   // over the doorway
        if (g.casing) {
          const gm = (g0 + g1) / 2;
          if (alongU) at(gm, at0, 0, 1); else at(at0, gm, 1, 0);
          for (const sx of [-1, 1]) k.box(sx * (g.w / 2 + 0.03), FY + g.h / 2, 0, 0.06, g.h, T + 0.04, CASING);
          k.box(0, FY + g.h + 0.03, 0, g.w + 0.12, 0.06, T + 0.04, CASING);
        }
        cur = g1;
      }
      seg(cur, s1, 0, H);
    };
    const u0 = P.ua - (P.wallA ? T : 0), u1 = P.ub + (P.wallB ? T : 0);
    run(true, P.SD + T / 2, u0, u1, [{ c: P.gateU, w: P.gateW, h: 2.12 }]);       // the gun wall's partition (cityGate frames the opening)
    if (P.backWall) run(true, P.SD + T + P.BD + T / 2, u0, u1, null);
    if (P.wallA) run(false, P.ua - T / 2, P.wt, P.vEnd, null);
    if (P.wallB) run(false, P.ub + T / 2, P.wt, P.vEnd, P.staffDoor ? [{ c: P.staffDoor.v, w: P.staffDoor.w, h: 2.1, casing: true }] : null);
    // the staff door's leaf, swung open flat against the hall side of the wall
    // (a doorway with no door in it reads as a building site)
    if (P.staffDoor) {
      const sd = P.staffDoor;
      at(P.ub + T + 0.025, sd.v + sd.w, 1, 0);
      k.box(0, FY + 1.05, 0, sd.w - 0.04, 2.08, 0.04, 0x55595e);
      k.box(0.3, FY + 1.0, 0.04, 0.12, 0.03, 0.03, 0xb4b8bd, "metal");
    }
  }

  /* THE BACK ROOM. Steel shelving of cased rounds down the rear wall, a pine
     crate of rifles standing open, the gunsmith's bench against the partition
     and the shop's safe in the far corner: the real one (city/bank.js
     CBZ.citySafe), holding the shop's own drop-safe balance on the one ledger
     (CBZ.cityTill point "safe"), opened by a charge, its key or the clerk
     with his hands up. The way in is the barred door (cityGate). */
  function cityBackRoom(S, group, k, at, FY, R0, uvBox) {
    const P = S.plan, sh = S.sheet;
    const v0 = P.SD + P.T, v1 = v0 + P.BD, uc = (P.ua + P.ub) / 2;
    const alongX = Math.abs(P.tx) > 0.5;
    // shelving down the rear wall
    const slen = Math.min(5.4, P.ub - P.ua - 2.6), su = P.ua + 1.5 + slen / 2;
    if (slen > 1.2) {
      at(su, v1, 0, -1);
      for (const sx of [-1, 0, 1]) for (const zz of [0.06, 0.42]) k.box(sx * (slen / 2 - 0.02), FY + 0.98, zz, 0.035, 1.96, 0.035, 0x6a7078, "metal");
      const levels = [0.14, 0.64, 1.14, 1.64];
      levels.forEach(function (sy, li) {
        k.box(0, FY + sy, 0.24, slen, 0.02, 0.42, 0x8a9096, "metal");
        const n = Math.floor(slen / 0.36);
        for (let i = 0; i < n; i++) {
          const x = -slen / 2 + 0.2 + i * 0.36;
          if (li % 2 === 0) ammoCan(k, x, FY + sy + 0.012, 0.24);
          else { k.box(x, FY + sy + 0.075, 0.24, 0.3, 0.13, 0.36, 0xb08a55); k.box(x, FY + sy + 0.09, 0.421, 0.2, 0.05, 0.002, 0xf2f0ea); }   // cartons
        }
      });
      for (const sx of [-0.5, 0.5]) {
        const wp = k.world(sx * slen / 2, 0.6);
        S.slots.push({ name: "Ammo Box", ammo: true, store: S, sold: false, x: wp.x, y: FY + 0.9, z: wp.z, reach: 2.4, dot: 0.7, back: true });
      }
      uvBox(su, v1 - 0.25, slen, 0.5, FY, FY + 1.96);
    }
    // a pine crate of rifles, lid off, on the floor by the door side
    if (S.longNames.length) {
      const cu = P.ub - 2.3, cv = v1 - 0.55;
      at(cu, cv, 0, -1);
      const CW = 1.15, CDp = 0.5, CH = 0.42, PINE = 0xb9925a, PINED = 0x9c7847;
      k.box(0, FY + 0.012, 0, CW, 0.024, CDp, PINED);
      for (const sz of [-1, 1]) for (let p = 0; p < 3; p++) k.box(0, FY + 0.09 + p * 0.135, sz * (CDp / 2 - 0.011), CW, 0.128, 0.022, PINE);
      for (const sx of [-1, 1]) for (let p = 0; p < 3; p++) k.box(sx * (CW / 2 - 0.011), FY + 0.09 + p * 0.135, 0, 0.022, 0.128, CDp - 0.044, PINE);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(sx * (CW / 2 - 0.05), FY + CH / 2, sz * (CDp / 2 + 0.008), 0.07, CH, 0.016, PINED);
      k.box(0.2, FY + 0.05, -CDp / 2 - 0.12, CW, 0.022, 0.5, PINE, "solid", 1.1, 0, 0);     // the lid, leaning on it
      sh.quad(k, sh.cell("stencil", 256, 64, artSign(["RIFLES  10 EA"], "#b9925a", "#3a2a16")), 0, FY + 0.24, CDp / 2 + 0.002, 0.5, 0.11);
      const pick = S.longNames.indexOf("AK-47") >= 0 ? "AK-47" : S.longNames[0];
      for (let i = 0; i < 4; i++) {
        const s = gunSlot(S, pick), lx = -CW / 2 + 0.2 + i * 0.25;
        const sz = poseGun(S, k, s, function (turn, m) { m.rotation.set(Math.PI / 2, -Math.PI / 2, 0, "YXZ"); }, null, lx, FY + 0.03, (i % 2 ? 0.06 : -0.06), (i % 2 ? 0.1 : -0.1));
        if (!sz) continue;
        const wp = k.world(lx, 0.1);
        s.x = wp.x; s.y = FY + 0.6; s.z = wp.z; s.reach = 2.6; s.dot = 0.8; s.back = true;
        S.slots.push(s);
      }
      uvBox(cu, cv, CW + 0.04, CDp + 0.04, FY, FY + CH);
    }
    // the bench, its pegboard to the partition
    if (S.bench) {
      const w = P.w(uc - 1.6, v0 + 0.36);
      S.benchAt = { x: w.x, z: w.z, yaw: P.yaw(0, 1) };
      buildBench(S, group, S.gs.counter, 0, 0, FY);
      uvBox(uc - 1.6, v0 + 0.36, 1.24, 0.66, FY, FY + 0.95);
    }
    // stacked cartons and a hand truck's worth of cases by the door
    at(P.ub - 0.5, v0 + 2.0, -1, 0);
    for (let i = 0; i < 3; i++) k.box((i % 2) * 0.03, FY + 0.16 + i * 0.32, 0, 0.52, 0.31, 0.4, i === 1 ? 0xa98250 : 0xb08a55);
    for (let i = 0; i < 3; i++) k.box(0, FY + 0.24 + i * 0.32, 0.201, 0.3, 0.05, 0.002, 0xf2f0ea);
    // the safe, in the far rear corner, its door to the room
    if (CBZ.citySafe && S.kind === "city") {
      const sp = P.w(P.ua + 0.55, v1 - 0.75);
      try {
        S.safe = CBZ.citySafe({ parent: group, lx: sp.x, ly: FY, lz: sp.z, yaw: P.yaw(1, 0), gy: 0, grade: "office",
          of: 6000, refillDays: 3, name: ((S.lot.building && S.lot.building.name) || "Gun shop") + " safe", venue: "gunshop",
          id: "gunsafe:" + Math.round(S.cx) + "," + Math.round(S.cz) });
      } catch (er) { console.error("[gun shop safe]", er); S.safe = null; }
      // where the shop keeps a drop-safe balance on the ledger, the safe IS that
      // balance (not a second pot); a trade with none keeps what a gun shop's
      // safe holds (the islands' figure) and earns it back over three days
      const TL = CBZ.cityTill, lot = S.lot;
      if (S.safe && TL && TL.declare && TL.holds && TL.take && TL.points && TL.points(lot).indexOf("safe") >= 0) {
        TL.declare(S.safe, { name: S.safe.name, kind: "safe", point: "safe",
          amount: function () { return TL.holds(lot, { point: "safe" }).amount || 0; },
          drain: function (n) { TL.take(lot, { point: "safe", max: n, by: "player", rob: true }); } });
        lot._realSafe = S.safe;                            // (city/shops.js: no "crack the safe" verb at the counter)
      }
    }
    cityGate(S, group, k, at, FY);
  }

  /* THE BARRED DOOR. A welded steel gate in a steel frame, shut on a keyed
     lock: the clerk carries the key (city/keys.js: his pocket, his body, a
     gun in his back all move it), he opens it himself with a gun on him, and
     a charge on the lock takes it off its latch. It swings; it is solid shut. */
  function cityGate(S, group, k, at, FY) {
    const P = S.plan, T = P.T, sh = S.sheet, STEEL = 0x2a2d31;
    at(P.gateU, P.SD + T / 2, 0, -1);
    const hw = P.gateW / 2;
    for (const sx of [-1, 1]) k.box(sx * (hw + 0.03), FY + 1.08, 0, 0.06, 2.16, T + 0.07, STEEL, "metal");
    k.box(0, FY + 2.16, 0, P.gateW + 0.12, 0.09, T + 0.07, STEEL, "metal");
    sh.quad(k, sh.cell("staff", 320, 80, artSign(["STAFF ONLY"], "#a3261f", "#f6f2e6")), 0, FY + 2.36, T / 2 + 0.012, 0.56, 0.14);
    const hinge = k.world(hw - 0.005, 0);
    const leaf = new THREE.Group();
    leaf.name = "gun-cage-door";
    leaf.position.set(hinge.x, 0, hinge.z);
    leaf.rotation.y = k.yaw;
    leaf.userData.dynamic = true;
    const lk = KIT.create().frame(0, 0, 0, 0), W = P.gateW - 0.02;
    for (const y of [0.07, 1.05, 2.07]) lk.box(-W / 2, FY + y, 0, W, 0.05, 0.04, STEEL, "metal");
    for (const x of [-0.025, -W + 0.025]) lk.box(x, FY + 1.07, 0, 0.05, 2.05, 0.04, STEEL, "metal");
    for (let x = -0.13; x > -W + 0.08; x -= 0.105) lk.cyl(x, FY + 1.07, 0, 0.011, 0.011, 1.98, 0x3a3e44, "metal", 0, 0, 0, 8);
    lk.box(-W + 0.1, FY + 1.05, 0, 0.14, 0.22, 0.075, 0x1c1e22, "metal");                 // the lock case
    lk.cyl(-W + 0.1, FY + 1.09, 0.04, 0.018, 0.018, 0.012, 0xb8963e, "metal", Math.PI / 2, 0, 0, 10);
    lk.box(-W + 0.1, FY + 1.0, 0.04, 0.012, 0.1, 0.02, 0xb4b8bd, "metal");
    lk.build(leaf);
    group.add(leaf);
    const c = P.w(P.gateU, P.SD + T / 2), alongX = Math.abs(P.tx) > 0.5;
    const col = { minX: c.x - (alongX ? hw : 0.07), maxX: c.x + (alongX ? hw : 0.07), minZ: c.z - (alongX ? 0.07 : hw), maxZ: c.z + (alongX ? 0.07 : hw), y0: FY, y1: FY + 2.12 };
    CBZ.colliders.push(col); S.cols.push(col);
    const front = P.w(P.gateU, P.SD - 0.35);
    const G = S.gate = { leaf: leaf, yaw: k.yaw, col: col, open: false, swing: 0, x: c.x, z: c.z, y: FY,
      id: "guncage:" + Math.round(S.cx) + "," + Math.round(S.cz), label: "Back Room Key, " + ((S.lot.building && S.lot.building.name) || "gun shop") };
    S.gateCand = { gate: true, store: S, name: "", x: front.x, y: FY + 1.1, z: front.z, reach: 2.4, dot: 0.5, sold: false };
    S.slots.push(S.gateCand);
    if (CBZ.registerBreachTarget) {
      G.breach = CBZ.registerBreachTarget({ id: "gun-cage", lb: 1.2, reach: 2.2,
        at: function () { return { x: G.x, y: FY + 1.05, z: G.z }; },
        done: function () { return G.open; },
        defeat: function () { openGate(S, "blast"); } });
    }
  }
  function openGate(S, how) {
    const G = S.gate;
    if (!G || G.open) return;
    G.open = true;
    const i = CBZ.colliders.indexOf(G.col);
    if (i >= 0) { CBZ.colliders.splice(i, 1); if (CBZ.markCollidersDirty) CBZ.markCollidersDirty(); }
    if (CBZ.sfx) CBZ.sfx(how === "key" ? "key" : "door_open");
    if (how === "blast" || how === "force") {
      const saw = !!(S.clerk && S.clerk.alive());
      if (S.till) S.till.report(140, saw);
      if (CBZ.cityAlarm && CBZ.city) { try { CBZ.cityAlarm(G.x, G.z, 26, 1.2, CBZ.city.playerActor); } catch (e) {} }
    }
  }
  function gateKey(S) { return !!(S.gate && CBZ.cityKeys && CBZ.cityKeys.has && CBZ.cityKeys.has(S.gate.id)); }
  // the clerk, held up within sight of the door: he opens it for you
  function gateInsider(S) {
    const v = S.clerk && S.clerk.body ? S.clerk.body() : null, G = S.gate;
    if (!v || v.dead || !G) return null;
    if (!(v.surrender || v.poseHandsUp || (v.char && v.char.handsUp))) return null;
    return Math.hypot(v.pos.x - G.x, v.pos.z - G.z) < 12 ? v : null;
  }

  /* CAMERAS, THE DOOR CHIME, THE NOTICE. The city's own bullet camera
     (city/cctv.js's head) in three corners of the sales floor and one in the
     back room, each a feed on the desk monitors (CBZ.cctvCameras); a chime
     box over the door that sounds when you walk in (tickStore). */
  function cityWatch(S, group, k, at, FY) {
    const P = S.plan, sh = S.sheet, V0 = P.wt, CY = FY + 2.62;
    const uc = (P.ua + P.ub) / 2;
    const spots = [
      [P.ua + 0.3, V0 + 0.3, uc, P.cv - 1.5], [P.ub - 0.3, V0 + 0.3, uc, P.cv - 1.5],
      [P.rackU1 + 0.25, P.SD - 0.25, P.doorU, V0 + 1.2], [P.ua + 0.3, P.SD + P.T + P.BD - 0.3, P.gateU, P.SD + P.T + 0.6],
    ];
    S.cams = [];
    const geos = [];
    let head = null;
    try { head = CBZ.cctvGeo && CBZ.cctvGeo.wall ? CBZ.cctvGeo.wall() : null; } catch (e) { head = null; }
    const o = new THREE.Object3D();
    for (const sp of spots) {
      const a = P.w(sp[0], sp[1]), b = P.w(sp[2], sp[3]);
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz) || 1;
      const cam = { id: "gunshop:" + Math.round(a.x * 10) + "," + Math.round(a.z * 10), kind: "guns", pos: { x: a.x, y: CY, z: a.z },
        aimYaw: Math.atan2(dx, dz), aimPitch: -Math.atan2(CY - (FY + 1.0), d) };
      S.cams.push(cam);
      if (CBZ.cctvCameras) CBZ.cctvCameras.push(cam);
      if (head) {
        o.position.set(a.x, CY, a.z); o.lookAt(b.x, FY + 1.0, b.z); o.updateMatrix();
        geos.push(head.clone().applyMatrix4(o.matrix));
      }
    }
    if (geos.length) {
      const BGU = THREE.BufferGeometryUtils;
      let merged = null;
      try { merged = BGU && BGU.mergeBufferGeometries ? BGU.mergeBufferGeometries(geos, false) : null; } catch (e) { merged = null; }
      for (const gg of (merged ? [merged] : geos)) {
        const m = new THREE.Mesh(gg, new THREE.MeshLambertMaterial({ vertexColors: !!gg.attributes.color }));
        m.castShadow = false; m.matrixAutoUpdate = false; m.updateMatrix();
        group.add(m);
      }
      if (merged) for (const gg of geos) gg.dispose();
      head.dispose();
    }
    // the chime box over the door, its contact on the frame
    at(P.doorU, V0, 0, 1);
    k.box(0.55, FY + 2.42, 0.03, 0.16, 0.1, 0.05, 0xe8e6e0);
    for (let i = 0; i < 4; i++) k.box(0.55, FY + 2.4 + i * 0.012, 0.056, 0.1, 0.004, 0.002, 0x8a8c8e);
    k.box(0.61, FY + 2.455, 0.056, 0.012, 0.012, 0.004, 0x58e07a, "glow");
    k.box(0.3, FY + 2.3, 0.02, 0.05, 0.02, 0.025, 0xd8d6d0);
    // the notice a camera earns, on the gun wall beside the barred door
    at(P.gateU - 1.0, P.SD, 0, -1);
    sh.quad(k, sh.cell("cctv", 320, 200, artSign(["CCTV IN OPERATION", "THESE PREMISES ARE RECORDED"], "#f2c230", "#141414", { border: "#141414" })), 0.02, FY + 1.95, 0.02, 0.46, 0.29);
  }

  // which kits the store SELLS, in display order. swatVest is intentionally NOT
  // here — it's police issue, taken off a dead SWAT (the loot-only why). Prices
  // come from cityEcon if the kit name is registered there; else a sane default.
  const ARMOR_FOR_SALE = [
    { kit: "softVest",     label: "Kevlar Vest",    price: 450 },
    { kit: "plateCarrier", label: "Plate Carrier",  price: 2400 },
    { kit: "helmet",       label: "Combat Helmet",  price: 600 },
  ];
  function armorKit(id) { return (CBZ.ARMOR_KITS && CBZ.ARMOR_KITS[id]) || null; }
  function armorPrice(spec) {
    const e = econ();
    const kit = armorKit(spec.kit);
    if (kit && (kit.price | 0) > 0) return kit.price | 0;                 // kit may carry its own price
    if (e && e.ITEMS && e.ITEMS[spec.label] && e.buyPrice) { const p = e.buyPrice(spec.label); if (p) return p; }
    return spec.price;
  }

  /* ---- THE ARMOURY -------------------------------------------------------
     A real character rig (CBZ.makeCharacter) in matte studio cream, standing
     on a round display base, wearing the ACTUAL kit armor.js mounts on every
     SWAT officer (CBZ.cityArmorDressPed), so the vest on the form cannot
     drift from the vest you walk out wearing. Missing armor.js or rig builder
     → the row is skipped rather than faked. */
  const FORM_SKIN = 0xd8d2c6, FORM_DARK = 0x2c2f36;
  function armorMannequin(group, x, z, faceY, kitId, y) {
    if (!CBZ.makeCharacter || !CBZ.cityArmorDressPed) return null;
    let rig = null;
    try {
      rig = CBZ.makeCharacter({
        legs: FORM_SKIN, torso: FORM_SKIN, collar: FORM_SKIN, arms: FORM_SKIN,
        skin: FORM_SKIN, hair: FORM_SKIN, shoes: FORM_DARK,
      });
    } catch (e) { rig = null; }
    if (!rig || !rig.group) return null;
    rig.group.position.set(x, y, z);
    rig.group.rotation.y = faceY;
    // a display form is a RIG under the city root: tag it so the static passes
    // (batch merge / matrix freeze) never fold a body into the shell.
    rig.group.userData.dynamic = true;
    group.add(rig.group);
    try { CBZ.cityArmorDressPed({ char: rig }, [kitId]); } catch (e) { /* undressed form still stands */ }
    return rig;
  }

  // the armoury row past the counter's - end, facing the customer side. The
  // pitch tightens to fit the room; forms that still don't fit step into a
  // second row in front.
  function buildArmorRack(S, group, C, L, FY) {
    if (!CBZ.ARMOR_KITS) return;
    const sells = ARMOR_FOR_SALE.filter((sp) => armorKit(sp.kit));
    if (!sells.length) return;
    // a store that named its spots (an island shop: down the side wall, so
    // the way round the counter to the back room stays open) stands them there
    if (S.armorSpots) {
      const k0 = KIT.create().frame(0, 0, 0, 0);
      sells.forEach((sp, i) => {
        const at = S.armorSpots[i];
        if (!at) return;
        k0.cyl(at.x, FY + 0.012, at.z, 0.3, 0.31, 0.024, 0x111214);
        k0.cyl(at.x, FY + 0.04, at.z, 0.28, 0.28, 0.032, 0x23262b, "gloss", 0, 0, 0, 32);
        k0.torus(at.x, FY + 0.056, at.z, 0.28, 0.006, 0xa7abb0, "metal", Math.PI / 2, 0, 0, null, 32);
        const rig = armorMannequin(group, at.x, at.z, at.face, sp.kit, FY + 0.056);
        const isHelmet = (armorKit(sp.kit) || {}).slot === "head" || sp.kit === "helmet";
        solidBox(S, at.x, at.z, 0.6, 0.6, FY, FY + 1.8);
        S.slots.push({ name: sp.label, armor: true, store: S, kit: sp.kit, price: sp.price, rig: rig,
                       sold: false, x: at.x, y: FY + (isHelmet ? 1.75 : 1.40), z: at.z, reach: CASE_REACH, dot: CASE_DOT });
      });
      k0.build(group);
      return;
    }
    // toward the customers: the counter frame's +Z
    let inx = -C.tz, inz = C.tx;
    const faceY = Math.atan2(inx, inz);
    const room = latRoom(S.gs.bounds, C.x, C.z, C.tx, C.tz, -1) - 0.4;
    const first = L / 2 + 0.72;
    const avail = Math.max(0, room - first);
    const pitch = sells.length > 1 ? Math.max(0.72, Math.min(0.95, avail / (sells.length - 1))) : 0;
    const perRow = Math.max(1, Math.floor(avail / Math.max(pitch, 0.72)) + 1);
    const k = KIT.create().frame(0, 0, 0, 0);
    sells.forEach((sp, i) => {
      const row = (i / perRow) | 0, col = i - row * perRow;
      const off = -(first + col * pitch);
      const fwd = 0.35 + row * 0.85;
      const x = C.x + C.tx * off + inx * fwd, z = C.z + C.tz * off + inz * fwd;
      // round display base: a dark disc, a brushed ring, a rubber foot
      k.cyl(x, FY + 0.012, z, 0.3, 0.31, 0.024, 0x111214);
      k.cyl(x, FY + 0.04, z, 0.28, 0.28, 0.032, 0x23262b, "gloss", 0, 0, 0, 32);
      k.torus(x, FY + 0.056, z, 0.28, 0.006, 0xa7abb0, "metal", Math.PI / 2, 0, 0, null, 32);
      const rig = armorMannequin(group, x, z, faceY, sp.kit, FY + 0.056);
      const isHelmet = (armorKit(sp.kit) || {}).slot === "head" || sp.kit === "helmet";
      if (S.kind === "island") solidBox(S, x, z, 0.6, 0.6, FY, FY + 1.8);
      S.slots.push({ name: sp.label, armor: true, store: S, kit: sp.kit, price: sp.price, rig: rig,
                     sold: false, x: x, y: FY + (isHelmet ? 1.75 : 1.40), z: z, reach: CASE_REACH, dot: CASE_DOT });
    });
    k.build(group);
  }
  // headless / harness handle: what the armoury row is actually WEARING.
  CBZ.cityGunstoreArmoury = function () {
    const S = ensureCity();
    if (!S) return [];
    dress(S);
    const out = [];
    for (const s of S.slots) {
      if (!s.armor) continue;
      let worn = 0;
      if (s.rig && s.rig.body) s.rig.body.traverse(function (o) { if (o.userData && o.userData.armorKind) worn++; });
      if (s.rig && s.rig.neck) s.rig.neck.traverse(function (o) { if (o.userData && o.userData.armorKind) worn++; });
      out.push({ name: s.name, kit: s.kit, rig: !!s.rig, armorParts: worn, x: s.x, y: s.y, z: s.z });
    }
    return out;
  };

  /* ---- THE GUNSMITH BENCH ------------------------------------------------
     A bench: butcher-block top on a steel frame with a lower shelf, a
     pegboard riser, a bench vise, a cleaning mat with a rod, a screwdriver
     and an oil bottle, an articulated lamp. There is no bench menu. What a
     gunsmith fits is a part, and the parts are things: in Gang City they hang
     on the accessory wall by the door; in a one-room shop (an island's) they
     hang on this bench's own pegboard, each on its card with its price.
     Take one with the gun it goes on in your hands and it is on the gun;
     the clerk rings it up; put it back and it comes off. */
  function buildBench(S, group, C, L, D, FY) {
    let wx, wz, yaw;
    if (S.benchAt) {
      // the bench stands in the back room, its pegboard against the partition
      // (S.benchAt: world spot + the frame's yaw)
      wx = S.benchAt.x; wz = S.benchAt.z; yaw = S.benchAt.yaw;
    } else {
      let inx = S.cx - C.x, inz = S.cz - C.z; const il = Math.hypot(inx, inz) || 1; inx /= il; inz /= il;
      const lat = L * 0.28;
      wx = C.x + C.tx * lat + inx * 1.6; wz = C.z + C.tz * lat + inz * 1.6;
      const latC = (wx - S.cx) * C.tx + (wz - S.cz) * C.tz;
      if (Math.abs(latC) < 1.62) { const shift = (latC >= 0 ? 1 : -1) * 1.62 - latC; wx += C.tx * shift; wz += C.tz * shift; }
      const B = S.gs.bounds;
      wx = Math.max(B.minX + 0.75, Math.min(B.maxX - 0.75, wx));
      wz = Math.max(B.minZ + 0.75, Math.min(B.maxZ - 0.75, wz));
      yaw = KIT.yawOf(C.tx, C.tz);
    }
    const k = KIT.create().frame(wx, 0, wz, yaw);
    const T = FY + 0.9, STEEL = 0x3c4148;
    k.box(0, T + 0.025, 0, 1.2, 0.05, 0.62, 0x9c7447);                                  // butcher block
    for (let i = 1; i < 12; i++) k.box(-0.6 + i * 0.1, T + 0.0505, 0, 0.003, 0.001, 0.62, 0x7d5a35);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(sx * 0.55, FY + 0.45, sz * 0.26, 0.045, 0.9, 0.045, STEEL, "metal");
    for (const sz of [-1, 1]) k.box(0, T - 0.04, sz * 0.26, 1.06, 0.06, 0.03, STEEL, "metal");
    k.box(0, FY + 0.2, 0, 1.1, 0.02, 0.5, 0x6d5234);                                    // lower shelf
    for (const sz of [-1, 1]) k.box(0, FY + 0.19, sz * 0.26, 1.06, 0.03, 0.03, STEEL, "metal");
    k.box(0.1, FY + 0.27, 0.02, 0.5, 0.12, 0.3, 0xb3322b, "metal");                     // a red tool chest on the shelf
    k.box(0.1, FY + 0.336, 0.02, 0.51, 0.012, 0.31, 0x8a2621, "metal");
    k.box(0.1, FY + 0.35, 0.02, 0.18, 0.015, 0.02, 0xb4b8bd, "metal");
    // pegboard riser at the back, and what hangs on it
    const PB = T + 0.05;
    const parts = !S.plan && CBZ.gunModsCatalog && CBZ.gunModsPartModel ? CBZ.gunModsCatalog() : [];
    const PH = parts.length ? 0.84 : 0.56;
    for (const sx of [-1, 1]) k.box(sx * 0.58, PB + PH / 2 + 0.02, -0.29, 0.03, PH + 0.04, 0.03, STEEL, "metal");
    k.box(0, PB + PH / 2 + 0.02, -0.29, 1.12, PH, 0.012, 0xc9b48a);
    for (let i = 0; i < 16; i++) for (let j = 0; j < Math.round(PH / 0.08); j++) k.box(-0.525 + i * 0.07, PB + 0.06 + j * 0.08, -0.2835, 0.007, 0.007, 0.002, 0x6f604a);
    if (parts.length) {
      const per = Math.ceil(parts.length / 2), pitch = 1.08 / per;
      parts.forEach(function (m, i) {
        const row = (i / per) | 0, col = i - row * per;
        const lx = -0.54 + pitch * (col + 0.5), ly = PB + (row ? 0.2 : 0.6);
        const s = { name: m.name, acc: true, modId: m.id, price: m.price, store: S, sold: false, held: false, restockT: 0 };
        S.sheet.quad(k, S.sheet.cell("acc:" + m.id, 192, 256, artCard(m.name, fmt$(m.price), m.slotLabel || "")), lx, ly + 0.02, -0.281, pitch - 0.02, (pitch - 0.02) * 1.3, 0, 0, 0);
        let part = null;
        try { part = CBZ.gunModsPartModel(m.id); } catch (er) { part = null; }
        if (part) {
          const holder = KIT.seat(part, function (turn) { turn.rotation.y = Math.PI / 2; }, "min");
          const wp0 = k.world(lx, -0.27);
          holder.scale.setScalar(Math.min(1.1, (pitch - 0.04) / Math.max(0.05, holder.userData.size.x), 0.13 / Math.max(0.03, holder.userData.size.y)));
          holder.position.set(wp0.x, ly + 0.03, wp0.z);
          holder.rotation.y = k.yaw;
          S.bank.add(s, holder);
        }
        const gp = k.world(lx, 0.1);
        s.x = gp.x; s.y = ly; s.z = gp.z; s.reach = 2.6; s.dot = 0.86; s.row = true;
        S.slots.push(s);
      });
    } else if (CBZ.itemAsset) {
      for (let i = 0; i < 3; i++) {
        const wr = CBZ.itemAsset("Wrench", null, { kind: "tool" });
        if (wr) k.absorb(wr, -0.4 + i * 0.09, PB + 0.3, -0.276, -Math.PI / 2, 0, 0, 0.9 + i * 0.12);
      }
      const cb = CBZ.itemAsset("Crowbar");
      if (cb) k.absorb(cb, 0.35, PB + 0.3, -0.27, -Math.PI / 2, 0, 0.12);
    }
    // bench vise at the + front corner
    const vx = 0.42, vz = 0.2, VB = 0x3f5a7a;
    k.box(vx, T + 0.065, vz, 0.14, 0.03, 0.14, VB, "metal");
    k.box(vx, T + 0.12, vz, 0.16, 0.08, 0.1, VB, "metal");
    k.box(vx, T + 0.19, vz - 0.03, 0.15, 0.06, 0.035, VB, "metal");
    k.box(vx, T + 0.19, vz + 0.05, 0.15, 0.06, 0.035, VB, "metal");
    for (const zz of [vz - 0.012, vz + 0.032]) k.box(vx, T + 0.215, zz, 0.15, 0.012, 0.004, 0x9aa0a6, "metal");
    k.cyl(vx, T + 0.13, vz + 0.14, 0.012, 0.012, 0.16, 0xb4b8bd, "metal", Math.PI / 2);
    k.cyl(vx, T + 0.13, vz + 0.215, 0.008, 0.008, 0.2, 0xb4b8bd, "metal", 0, 0, Math.PI / 2);
    // cleaning mat and what's on it
    k.box(-0.12, T + 0.052, 0.05, 0.72, 0.004, 0.36, 0x2c4a3a);
    k.cyl(-0.12, T + 0.06, 0.12, 0.004, 0.004, 0.6, 0x8e959c, "metal", 0, 0, Math.PI / 2);
    k.cyl(-0.3, T + 0.066, -0.03, 0.012, 0.012, 0.1, 0xd4a43a, "solid", 0, 0, Math.PI / 2);   // screwdriver handle
    k.cyl(-0.215, T + 0.066, -0.03, 0.003, 0.003, 0.08, 0x9aa0a6, "metal", 0, 0, Math.PI / 2);
    k.cyl(0.12, T + 0.105, -0.05, 0.024, 0.024, 0.1, 0x2a3f6a);                            // oil bottle
    k.cyl(0.12, T + 0.17, -0.05, 0.004, 0.012, 0.03, 0xe8e2d0);
    // articulated lamp at the - back corner
    const lx = -0.5, lz = -0.2;
    k.cyl(lx, T + 0.06, lz, 0.065, 0.07, 0.02, 0x22252a, "metal");
    k.cyl(lx + 0.06, T + 0.22, lz, 0.008, 0.008, 0.34, 0x22252a, "metal", 0, 0, -0.38);
    k.cyl(lx + 0.2, T + 0.4, lz + 0.05, 0.008, 0.008, 0.3, 0x22252a, "metal", 0.3, 0, -1.1);
    k.cyl(lx + 0.32, T + 0.42, lz + 0.1, 0.03, 0.065, 0.08, 0x22252a, "metal", 0.35, 0, -0.5);
    k.cyl(lx + 0.34, T + 0.385, lz + 0.115, 0.055, 0.055, 0.004, 0xfff1d8, "glow", 0.35, 0, -0.5);
    k.build(group);
    // THE BENCH IS A PLACE TO WORK: stand at it with a gun in your hands and
    // its parts come off and go on (city/gunmods.js CBZ.gunModsBench)
    const bp = k.world(0, 0.05);
    S.benchCand = { bench: true, store: S, name: "Workbench", x: bp.x, y: T + 0.15, z: bp.z, reach: 2.3, dot: 0.45, sold: false };
    S.slots.push(S.benchCand);
    // the island's back-room bench is a solid thing to walk round
    if (S.kind === "island") {
      const q = Math.abs(Math.sin(yaw)) > 0.5;
      solidBox(S, wx, wz, q ? 0.66 : 1.24, q ? 1.24 : 0.66, FY, FY + 0.95);
    }
  }

  // ---- SOLD gap / restock ----------------------------------------------------
  // the piece and its tag leave together; the empty yoke (or bare felt) stays
  function showSlot(s, on) {
    if (s.bank) s.bank.show(s, on);
    if (s.model) s.model.visible = on;
    if (s.card) s.card.visible = on;
    if (s.print && s.store && s.store.sheet) s.store.sheet.show(s, on);
  }
  function setSold(s, on) {
    s.sold = !!on;
    showSlot(s, !on);
    if (on) s.restockT = RESTOCK * (0.8 + Math.random() * 0.5);
  }
  function tillOpen(s) { return !!(s.store && s.store.till && s.store.till.open()); }
  // UNDER GLASS you ask for it: the clerk slides the door on his side and
  // hands it over. With nobody at the counter the glass is between you and
  // it, until the glass is gone.
  function glassUp(s) { return !!(s.cs && s.cs.pane && !s.cs.pane.shattered); }
  function canReach(s) { return !glassUp(s) || tillOpen(s); }
  function clerkSays(S, text) {
    const v = S && S.clerk && S.clerk.body ? S.clerk.body() : null;
    if (v && !v.dead && S.clerk.alive() && CBZ.citySay) { try { CBZ.citySay(v, text, null, { secs: 2.6, force: true }); return; } catch (e) {} }
    if (CBZ.city && CBZ.city.note) CBZ.city.note(text, 2.2);
  }

  /* ---- A PIECE IN YOUR HANDS, NOT YET YOURS --------------------------------
     [Take] lifts the piece off the rack (CBZ.verbs.pickup: the hand goes to
     it, it comes away in the hand). A gun is in your hands to look at, the
     same gun you will carry; a part is on the gun you are holding; a knife
     or a bat is under your arm. The clerk rings up what you hold ([Pay] on
     him, [Buy] at the register); [Put back] returns it; walking out of the
     door with it is stealing it (city/shopfloor.js's till). */
  function gunIdOf(name) { return (CBZ.cityGunIdOf && CBZ.cityGunIdOf(name)) || null; }
  // what the hand reaches for: the piece's own object, or the place it hangs
  function handleOf(s) { return s.model || { x: s.x, y: s.y, z: s.z, kind: "gun" }; }
  function takeSlot(s) {
    const S = s.store;
    if (!S || !S.till || s.sold || s.held || s._taking || !CBZ.player || !canReach(s)) return;
    const e = econ(); if (!e) return;
    if (s.acc) {
      const c = CBZ.gunModsCanFit ? CBZ.gunModsCanFit(s.modId) : { ok: false, why: "" };
      if (!c.ok) { if (c.why) clerkSays(S, c.why); return; }
    }
    s._taking = true;
    const done = function () {
      s._taking = false;
      if (S.dead || s.sold) return;
      const item = { name: s.name, price: priceOf(s), slot: s,
        onPay: function () { paid(S, s); },
        onSteal: function () { stolen(S, s); },
        onReturn: function (silent) { putBack(S, s, silent); } };
      if (s.acc) {
        s.fit = CBZ.gunModsFit ? CBZ.gunModsFit(s.modId) : null;
        if (!s.fit) return;
        item.hot = false;                                   // a part on a gun is not a thing a broker is offered
      } else if (s.gun) {
        const id = gunIdOf(s.name);
        s.had = !!(id && CBZ.hasWeapon && CBZ.hasWeapon(id));
        if (CBZ.cityGiveWeapon) CBZ.cityGiveWeapon(s.name);
      }
      s.held = true;
      showSlot(s, false);
      S.till.hold(item);
    };
    if (CBZ.verbs && CBZ.verbs.pickup) CBZ.verbs.pickup(CBZ.player, handleOf(s), { pose: "grip", keep: !!s.gun, key: s, onTaken: done });
    else done();
  }
  // out of your hands (unless you owned one like it already) and back where it hung
  function putBack(S, s, silent) {
    s.held = false;
    if (s.acc) { if (s.fit && CBZ.gunModsSet) CBZ.gunModsSet(s.fit.id, s.fit.slot, s.fit.prev); s.fit = null; }
    else if (s.gun) { const id = gunIdOf(s.name); if (id && !s.had && CBZ.lockWeapon) CBZ.lockWeapon(id); }
    const show = function () { if (!s.sold) showSlot(s, true); };
    if (!silent && s.model && CBZ.verbs && CBZ.verbs.putDown && CBZ.player) CBZ.verbs.putDown(CBZ.player, s.model, null, { pose: "grip", onPlaced: show });
    else show();
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }
  function returnSlot(s) {
    const S = s.store;
    if (!S || !S.till) return;
    const it = S.till.holding(s);
    if (!it) return;
    S.till.release(it);
    putBack(S, s, false);
  }
  // rung up: yours. A gun comes with two magazines (a launcher gets a spare round).
  function paid(S, s) {
    const e = econ(); if (!e) return;
    s.held = false;
    if (s.acc) { s.fit = null; setSold(s, true); return; }
    e.add(s.name, 1);
    if (s.melee) { if (CBZ.cityGiveWeapon) CBZ.cityGiveWeapon(s.name); }
    else { const meta = e.ITEMS[s.name] || {}; if (CBZ.cityAddAmmo) CBZ.cityAddAmmo(Math.max(2, (meta.ammo | 0) * 2)); }
    setSold(s, true);
    const price = e.buyPrice(s.name);
    if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(price >= 3000 ? 3 : 1);
  }
  // out of the door with it: it is yours the way stolen things are
  function stolen(S, s) {
    const e = econ();
    s.held = false;
    if (s.acc) { s.fit = null; setSold(s, true); return; }
    if (e) e.add(s.name, 1);
    if (s.melee && CBZ.cityGiveWeapon) CBZ.cityGiveWeapon(s.name);
    setSold(s, true);
  }
  // the glass over a case goes: by your hand here, by a round or a swing anywhere
  function smash(s) {
    const cs = s.cs;
    if (!cs || !cs.pane || cs.pane.shattered || !CBZ.cityShatter) return;
    CBZ.cityShatter(cs.pane.x, cs.pane.z, 0.35, { directPlayer: true });
  }
  // (tickStore) a case's glass just went with you in the shop: that is a break-in
  function caseBroken(S, cs) {
    const P = CBZ.player;
    const there = !!(S.clerk && S.clerk.alive());
    const saw = there && S.clerk.sees(P.pos.x, P.pos.z);
    if (saw) S.clerk.say("thief");
    if (S.till) S.till.report(150, there);
    if (CBZ.cityAlarm && CBZ.city) { try { CBZ.cityAlarm(cs.x, cs.z, 28, 1.4, CBZ.city.playerActor); } catch (e) {} }
    if (CBZ.cityPanicRaise) CBZ.cityPanicRaise(cs.x, cs.z, 0.9);
    if (CBZ.sfx) { try { CBZ.sfx("alarm"); } catch (e) {} }
    if (saw && S.clerk.defend) S.clerk.defend();
  }
  // the door chime: two notes off the box over the door
  function chime() {
    const ac = CBZ.getAudioCtx ? CBZ.getAudioCtx() : null, bus = CBZ.audioSfxBus ? CBZ.audioSfxBus() : null;
    if (!ac || !bus) return;
    try {
      const t0 = ac.currentTime;
      [[659.3, 0], [523.3, 0.34]].forEach(function (n) {
        const o = ac.createOscillator(), a = ac.createGain();
        o.type = "sine"; o.frequency.value = n[0];
        a.gain.setValueAtTime(0.0001, t0 + n[1]);
        a.gain.exponentialRampToValueAtTime(0.1, t0 + n[1] + 0.015);
        a.gain.exponentialRampToValueAtTime(0.0001, t0 + n[1] + 0.9);
        o.connect(a); a.connect(bus);
        o.start(t0 + n[1]); o.stop(t0 + n[1] + 0.95);
      });
    } catch (e) {}
  }

  // ---- over the counter: rounds, frags, charges, plates ----------------------
  function buySlot(s) {
    const e = econ(), S = s && s.store;
    if (!s || !e || !CBZ.city) return;
    const open = !!(S && S.till && S.till.open());
    if (s.ammo) {
      const meta = e.ITEMS["Ammo Box"] || {}, price = e.buyPrice("Ammo Box");
      if (open && !CBZ.city.spend(price)) { CBZ.city.note(fmt$(price), 1.4); return; }
      if (CBZ.cityAddAmmo) CBZ.cityAddAmmo(meta.rounds || 60);
      if (!open) grabbed(S, "Ammo Box", price);
      if (CBZ.sfx) CBZ.sfx(open ? "coin" : "pickup");
      return;
    }
    // ARMOR: a kit off the form, strapped on (armor.js's equip: the armor bar
    // and the mesh). Re-buyable to top your plate back up after it's been shot.
    if (s.armor) {
      if (!CBZ.cityEquipArmor || !open) return;
      const price = armorPrice({ kit: s.kit, label: s.name, price: s.price });
      if (!CBZ.city.spend(price)) { CBZ.city.note(fmt$(price), 1.4); return; }
      CBZ.cityEquipArmor(s.kit);
      if (CBZ.sfx) CBZ.sfx("coin");
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
      return;
    }
    // explosives: by COUNT, never sell out (the crates restock off-screen).
    // Counts mirror to g.cityGrenades / g.cityC4 for HUD readers.
    if (s.boom) {
      const price = e.buyPrice(s.name);
      if (open && !CBZ.city.spend(price)) { CBZ.city.note(fmt$(price), 1.4); return; }
      e.add(s.name, 1);
      const n = e.count ? e.count(s.name) : 0;
      if (s.name === "Grenade") g.cityGrenades = n;
      if (s.name === "C4 Charge") g.cityC4 = n;
      if (!open) grabbed(S, s.name, price);
      if (CBZ.sfx) CBZ.sfx(open ? "coin" : "pickup");
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
      return;
    }
    // a gun or a blade: straight to the register (the harness handle; the
    // floor goes through takeSlot + the till)
    if (s.sold || s.held || !(s.gun || s.melee)) return;
    if (!e.ITEMS[s.name]) return;
    const price = e.buyPrice(s.name);
    if (!CBZ.city.spend(price)) { CBZ.city.note(fmt$(price), 1.4); return; }
    if (s.gun && CBZ.cityGiveWeapon) CBZ.cityGiveWeapon(s.name);
    paid(S, s);
    if (CBZ.sfx) CBZ.sfx("coin");
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }
  // off the shelf with nobody at the till: stolen, charged to whoever saw it
  function grabbed(S, name, price) {
    CBZ.cityMarkHot && CBZ.cityMarkHot(name, 1, S ? S.where : null);
    if (S && S.till) S.till.report(Math.min(120, 50 + (price | 0) / 40), false);
  }

  // ---- THE SHOP IS A SET OF CANDIDATES (city/interactions.js registerFixtures)
  // Every gun, part, box, vest, the barred door and the register are things in
  // the registry: E does the obvious verb on the one you are looking at, Q / a
  // tap shows its verbs, a finger can pick it off the wall from across the shop.
  function priceOf(s) {
    const e = econ();
    if (!e) return 0;
    if (s.acc) return s.price | 0;
    if (s.ammo) return e.buyPrice("Ammo Box");
    if (s.armor) return armorPrice({ kit: s.kit, label: s.name, price: s.price });
    return e.buyPrice(s.name);
  }
  function inBounds(S, px, pz) {
    const B = S.gs && S.gs.bounds;
    return !!B && px >= B.minX - 1.5 && px <= B.maxX + 1.5 && pz >= B.minZ - 1.5 && pz <= B.maxZ + 1.5;
  }
  // the store you are standing in (its displays dressed and drawn)
  function storeAt(px, pz) {
    for (const S of STORES) if (!S.dead && S.dressed && S.near && inBounds(S, px, pz)) return S;
    return null;
  }
  // THE WORKBENCH'S VERBS: per slot of the gun in your hands, take off what
  // is on it, or fit what your parts box holds for it (city/gunmods.js)
  function benchVerbs() {
    const GB = function () { return CBZ.gunModsBench || null; };
    const out = [];
    const slots = ["scope", "mag", "muzzle", "under"];
    slots.forEach(function (sl, i) {
      out.push({ id: "gunwall-bench-off-" + sl, slot: "e", prio: 7 - i * 0.1,
        label: function () { const f = GB() && GB().fitted(sl); return f ? "Take off the " + f.mod.name : "Take off"; },
        canShow: function (s) { return !!s.bench && !!GB() && !!GB().fitted(sl); },
        onSelect: function () { GB().off(sl); } });
      out.push({ id: "gunwall-bench-on-" + sl, prio: 6.5 - i * 0.1,
        label: function () { const f = GB() && GB().loose(sl); return f ? "Fit the " + f.mod.name : "Fit"; },
        canShow: function (s) { return !!s.bench && !!GB() && !!GB().loose(sl); },
        onSelect: function () { GB().on(sl); } });
    });
    // nothing in your hands to work on: the bench says what it is for
    out.push({ id: "gunwall-bench-idle", slot: "e", prio: 1, label: "Work on a gun",
      canShow: function (s) { return !!s.bench && !!GB() && !GB().gun(); },
      onSelect: function () { if (CBZ.city && CBZ.city.note) CBZ.city.note("Have the gun you want to work on in your hands.", 2.2); } });
    // a gun in your hands with nothing on it and nothing in the box for it
    out.push({ id: "gunwall-bench-bare", prio: 1, label: "Nothing to fit",
      canShow: function (s) {
        const B2 = GB();
        if (!s.bench || !B2 || !B2.gun()) return false;
        for (const sl of slots) if (B2.fitted(sl) || B2.loose(sl)) return false;
        return true;
      },
      onSelect: function () { if (CBZ.city && CBZ.city.note) CBZ.city.note("Parts go on from the accessory wall out front, or from your parts box.", 2.4); } });
    return out;
  }
  const _list = [];
  let fixturesWired = false;
  function wireFixtures() {
    if (fixturesWired || !CBZ.interactions || !CBZ.interactions.registerFixtures) return;
    fixturesWired = true;
    const piece = (s) => !!(s.gun || s.melee || s.acc);
    CBZ.interactions.registerFixtures({
      id: "gunwall", kind: "gunwall", prio: 9, islands: true,
      list: function (ctx, px, pz) {
        const S = storeAt(px, pz);
        if (!S) return null;
        _list.length = 0;
        /* A WALL THREE ROWS HIGH. The card's look test is a compass bearing,
           which cannot tell a rifle from the one hung above it. So a rowed
           piece is a candidate only while your eye line crosses its row (the
           orbit camera's pitch, 0.10 at rest and positive down). A finger
           picks the piece it touches, so on touch every row answers. */
        const Pl = CBZ.player, byEye = !(ctx && ctx.tap) && !CBZ.touchMode && !!Pl;
        const eye = byEye ? Pl.pos.y + 1.62 : 0, tilt = byEye ? Math.tan(((CBZ.cam && CBZ.cam.pitch) || 0) - 0.10) : 0;
        for (const s of S.slots) {
          if (byEye && (s.row || s.low)) {
            const line = eye - tilt * Math.hypot(s.x - px, s.z - pz);
            // (the shelving under a rack is nearer than the guns over it: it answers when you look down at it)
            if (s.row ? Math.abs(s.y - line) > 0.25 : line > S.FY + 1.2) continue;
          }
          _list.push(s);
        }
        if (S.tillCand) _list.push(S.tillCand);
        return _list;
      },
      reach: function (s) { return s.reach || 3; },
      dot: function (s) { return s.dot || CASE_DOT; },
      name: function (s) { return s.till ? "" : s.gate ? (s.store.gate && !s.store.gate.open ? "Locked" : "") : s.name; },
      verbs: [
        // the register: everything you are holding, rung up
        { id: "gunwall-pay", slot: "e", prio: 8, label: (s) => "Buy " + fmt$(s.store.till.total()),
          canShow: (s) => !!s.till && !!s.store.till && s.store.till.held.length > 0 && tillOpen(s), onSelect: (s) => s.store.till.pay() },
        { id: "gunwall-take", slot: "e", prio: 6, label: "Take",
          canShow: (s) => piece(s) && !s.sold && !s.held && !s._taking && canReach(s), onSelect: takeSlot },
        { id: "gunwall-return", slot: "e", prio: 6, label: "Put back",
          canShow: (s) => piece(s) && s.held && !!(s.store.till && s.store.till.holding(s)), onSelect: returnSlot },
        // nobody to hand it over: the glass is in the way
        { id: "gunwall-smash", slot: "e", prio: 5, bad: true, label: "Smash",
          canShow: (s) => piece(s) && !s.sold && !s.held && glassUp(s) && !tillOpen(s), onSelect: smash },
        { id: "gunwall-smash-held", prio: 2, bad: true, label: "Smash the glass",
          canShow: (s) => piece(s) && !s.sold && glassUp(s) && tillOpen(s), onSelect: smash },
        { id: "gunwall-armor", slot: "e", prio: 5, label: (s) => "Put on " + fmt$(priceOf(s)), canShow: (s) => !!s.armor && tillOpen(s), onSelect: buySlot },
        { id: "gunwall-buy", slot: "e", prio: 5, label: (s) => "Buy " + fmt$(priceOf(s)),
          canShow: (s) => (!!s.ammo || !!s.boom) && tillOpen(s), onSelect: buySlot },
        { id: "gunwall-grab", slot: "e", prio: 5, bad: true, label: "Take",
          canShow: (s) => (!!s.ammo || !!s.boom) && !tillOpen(s), onSelect: buySlot },
        // the barred door: its key, or the man who carries it with a gun on him
        { id: "gunwall-gate-key", slot: "e", prio: 7, label: "Unlock",
          canShow: (s) => !!s.gate && !s.store.gate.open && gateKey(s.store), onSelect: (s) => openGate(s.store, "key") },
        { id: "gunwall-gate-make", slot: "e", prio: 6, bad: true, label: (function () { const VW = CBZ.cityVerbWord; if (VW && VW.keep) VW.keep("Make him open it"); return "Make him open it"; })(),
          canShow: (s) => !!s.gate && !s.store.gate.open && !gateKey(s.store) && !!gateInsider(s.store),
          onSelect: (s) => {
            const v = gateInsider(s.store);
            if (v && CBZ.citySay) { try { CBZ.citySay(v, "Okay. Okay. It's open.", null, { secs: 2.2, force: true }); } catch (e) {} }
            openGate(s.store, "insider");
            if (s.store.till) s.store.till.report(120, true);
            // and he goes in ahead of you, to stand by the safe he knows the combination of
            const sf = s.store.safe, P = s.store.plan;
            if (v && sf && P && CBZ.cityKeeper && CBZ.cityKeeper.walkTo) {
              // round the counter's end, through the barred door, to the safe's side
              const way = [P.w(P.gateU, P.SD - 0.6), P.w(P.gateU, P.SD + P.T + 0.8), P.w(P.ua + 1.5, P.SD + P.T + P.BD - 0.8)];
              if (P.plan(v.pos.x, v.pos.z).v < P.cv) way.unshift(P.w(P.gateU, P.cv - P.CD / 2 - 0.5));   // out front: through the staff gap first
              // at the safe he works the dial himself (city/bank.js: an insider's open, a robbery somebody saw)
              CBZ.cityKeeper.walkTo(v, way, function (who) {
                if (sf.open || !CBZ.citySafeOpen) return;
                clerkSays(s.store, "Okay. Okay. It's open. Take it.");
                CBZ.citySafeOpen(sf, "insider");
              });
            }
          } },
        // a customer with a gun to work on: the clerk lets him through to the bench
        { id: "gunwall-gate-ask", slot: "e", prio: 6.5, label: "Ask to use the bench",
          canShow: (s) => !!s.gate && !s.store.gate.open && !gateKey(s.store) && !gateInsider(s.store) && !!s.store.bench && tillOpen(s) &&
            !!(s.store.clerk && !(s.store.clerk.cowed && s.store.clerk.cowed())) && !!(CBZ.gunModsBench && CBZ.gunModsBench.gun()),
          onSelect: (s) => { clerkSays(s.store, "Bench is in the back. Hands off the safe."); openGate(s.store, "clerk"); s.store.gate.lent = true; s.store.gate.lentOut = 0; } },
      ].concat(benchVerbs()),
    });
  }

  // ---- GANG CITY's store: its lot (self-healing, clubLot pattern) ----------
  // PERF: the fallback lot scan is O(all lots) — fine ONCE, but this runs from a
  // per-frame updater, so a city with no gun-store lot must not rescan forever.
  // An arena REBUILD (new run) also invalidates a previously-built wall: the old
  // display group died with the old root, so tear down and rebuild on the new one.
  function ensureCity() {
    const arena = CBZ.city && CBZ.city.arena;
    if (cityStore) {
      if (CITY.arena === arena) return cityStore;
      disposeStore(cityStore); cityStore = null;
    }
    if (!arena || !econ() || !CBZ.buildActorWeapon) return null;
    if (CITY.noLotArena === arena) return null;          // this city has no gun wall — answered once
    let lot = arena.gunShopLot || null;
    if (!(lot && lot.building && lot.building.gunstore)) {
      lot = null;
      const lots = arena.lots || [];
      for (let i = 0; i < lots.length; i++) { const L = lots[i]; if (L && L.building && L.building.gunstore) { lot = L; break; } }
      if (!lot && lots.length) { CITY.noLotArena = arena; return null; }
    }
    if (!lot) return null;
    CITY.arena = arena;
    const gs = lot.building.gunstore, B = gs.bounds;
    // THE CLERK STANDS AT HIS REGISTER, not in front of the wall: posted at
    // the counter's middle (buildings.js vendorSpot) he stood between you and
    // every rifle on the rack, and the wall could not be looked at past him.
    // The register is at the counter's -L/2 end (makeStore's tillCand).
    const C0 = gs.counter, vs = lot.building.vendorSpot;
    if (C0 && vs && !vs._atTill) {
      const L0 = Math.max(C0.w, C0.d);
      const u = -L0 / 2 + 0.55;
      vs.x += C0.tx * u; vs.z += C0.tz * u; vs._atTill = true;
      const v0 = lot.building.vendor;
      if (v0 && !v0.dead && !v0._keepFree) { v0.pos.x = vs.x; v0.pos.z = vs.z; if (v0.group) v0.group.position.set(vs.x, v0.group.position.y, vs.z); }
    }
    const clerk = SF() ? SF().cityClerk(lot) : null;
    const P = gs.plan || null;
    cityStore = makeStore({
      kind: "city", lot: lot, gs: gs, plan: P, fy: floorY(lot.building), root: arena.root || CBZ.scene, clerk: clerk, where: "city",
      // in the shop: the sales floor and the back room (the hall past the staff door is out of it)
      inStore: function (x, z) { return x >= B.minX - 0.6 && x <= B.maxX + 0.6 && z >= B.minZ - 0.6 && z <= B.maxZ + 0.6; },
      nearDoor: P ? function (x, z) { const q = P.plan(x, z); return q.v < P.wt + 2.4 && Math.abs(q.u - P.doorU) < 2.4; } : null,
      behind: P ? function (x, z) { const q = P.plan(x, z); return q.v > P.cv + P.CD / 2 + 0.05 && q.v < P.vEnd && q.u > P.ua && q.u < P.ub; } : null,
    });
    return cityStore;
  }
  function dress(S) {
    if (!S || S.dressed || S.dead) return;
    S.dressed = true;
    buildDisplays(S);
  }

  /* ---- THE ISLANDS: one store per gun shop (CBZ.islandVenue "guns") --------
     The ground floor is cleared of the house furniture, a partition stands a
     back room behind the counter with the safe in it, the rack goes on the
     partition, the counter across the room in front of it, and a shopkeeper
     takes his post behind the counter with a shotgun under it. */
  // (the island fit-out is a generator on the island build's slice clock, CBZ.sliceLate)
  function lateFit() { return !!(CBZ.sliceLate && CBZ.sliceLate()); }
  function* islandFit(b, lot, job) {
    const F = SF(), IV = CBZ.islandVenue;
    if (!F || !IV || !econ()) return null;
    const P0 = F.plan(b, { backRoom: true });
    if (!P0) return null;
    IV.clear(b, 0);
    const shell = F.shellSteps ? yield* F.shellSteps(P0, lot, { goods: "ammo", wall: 0xcfc8ba, trim: 0x4a4440, safeGrade: "floor", safeOf: 6000 }) : F.shell(P0, lot, { goods: "ammo", wall: 0xcfc8ba, trim: 0x4a4440, safeGrade: "floor", safeOf: 6000 });
    if (lateFit()) yield 0;
    const desc = F.gunDescriptor(P0);
    const zone = F.counterZone(P0, desc);
    const where = F.whereKey(lot.island);
    const clerk = F.postedClerk({ b: b, lot: lot, lx: zone.post.lx, lz: zone.post.lz, face: zone.post.face,
      armed: "Shotgun", job: "gunsmith", via: zone.route.via, door: zone.route.door });
    F.register(P0, desc, clerk, -desc.counter.L / 2 + 0.55, (lot.name || "gun store") + " register");
    // the armoury's forms down the +x side wall, facing into the shop
    const armorSpots = [], inward = P0.v(-1, 0);
    for (let lz = desc.counter.zL - desc.counter.D / 2 - 0.9; lz > P0.z0 + 2.7 && armorSpots.length < 3; lz -= 0.9) {
      const p = P0.w(P0.x1 - 0.5, lz);
      armorSpots.push({ x: p.x, z: p.z, face: Math.atan2(inward.x, inward.z) });
    }
    // THE GUNSMITH BENCH, in the back room: against the partition, beside the
    // staff door (city/shopfloor.js shell: the doorway at the + end), the
    // aisle between it and the shelving on the back wall
    let benchAt = null;
    if (P0.back) {
      const dx = P0.x1 - 0.85, bx = dx - 0.475 - 0.2 - 0.62;
      if (bx - 0.62 > P0.x0 + 0.1) {
        const p = P0.w(bx, P0.zP + 0.07 + 0.33);
        benchAt = { x: p.x, z: p.z, yaw: F.yawToward(P0, 0, 1) };
        if (IV.claim) IV.claim(b, 0, { x0: bx - 0.65, x1: bx + 0.65, z0: P0.zP, z1: P0.zP + 0.75 });
      }
    }
    const S = makeStore({
      kind: "island", lot: lot, gs: desc, fy: P0.fy, root: CBZ.scene, clerk: clerk, where: where,
      bench: !!benchAt, benchAt: benchAt, armorSpots: armorSpots,
      arena: job && job.arena, inStore: function (x, z) { return P0.inside(x, z, 0.4); },
      nearDoor: P0.nearDoor, behind: zone.behind,
    });
    // the rest of a real gun shop round the counter (city/shopfloor.js)
    if (lateFit()) yield 0;
    if (F.dressShop) { try { if (F.dressShopSteps) yield* F.dressShopSteps(P0, lot, "guns", desc); else F.dressShop(P0, lot, "guns", desc); } catch (e) { console.error("[gun store dress]", e); } }
    return function () { disposeStore(S); shell.dispose(); };
  }
  if (CBZ.islandVenue && CBZ.islandVenue.on) CBZ.islandVenue.on("guns", islandFit);

  // ---- per-frame --------------------------------------------------------------
  function tickStore(S, dt, live) {
    const P = CBZ.player;
    if (!live || !P) {
      if (S.group && S.group.visible) S.group.visible = false;
      S.near = false;
      return;
    }
    // restock timers keep ticking — the street keeps moving while you're away
    for (const s of S.slots) {
      if (!s.sold) continue;
      s.restockT -= dt;
      if (s.restockT <= 0) setSold(s, false);
    }
    const dx = P.pos.x - S.cx, dz = P.pos.z - S.cz, d2 = dx * dx + dz * dz;
    if (!S.dressed && d2 < DRESS_R * DRESS_R) dress(S);
    const near = d2 < VIS_R * VIS_R;
    if (S.group && S.group.visible !== near) S.group.visible = near;
    S.near = near;
    const inside = S.inStore(P.pos.x, P.pos.z);
    // a case whose glass just went, with you in the shop
    if (S.cases) for (const cs of S.cases) {
      if (!cs.pane) continue;
      if (cs.pane.shattered && !cs.smashed) { cs.smashed = true; if (inside) caseBroken(S, cs); }
      else if (cs.smashed && !cs.pane.shattered) cs.smashed = false;       // the city re-glazed it
    }
    // the barred door on its hinge
    if (S.gate) {
      const G = S.gate, to = G.open ? 1.5 : 0;
      if (G.swing !== to) { G.swing += Math.sign(to - G.swing) * Math.min(Math.abs(to - G.swing), dt * 2.4); G.leaf.rotation.y = G.yaw - G.swing; }
      // let through to the bench: once you are back out front (or gone) he shuts it behind you
      if (G.open && G.lent && S.plan) {
        const q = S.plan.plan(P.pos.x, P.pos.z), back = q.v > S.plan.SD - 0.2 && q.v < S.plan.vEnd + 0.5 && q.u > S.plan.ua - 0.5 && q.u < S.plan.ub + 0.5;
        G.lentOut = back ? 0 : (G.lentOut || 0) + dt;
        const cv = S.clerk && S.clerk.body ? S.clerk.body() : null;
        if (!cv || cv.dead) G.lent = false;
        else if (G.lentOut > 3) {
          G.open = false; G.lent = false;
          if (CBZ.colliders.indexOf(G.col) < 0) { CBZ.colliders.push(G.col); if (CBZ.markCollidersDirty) CBZ.markCollidersDirty(); }
          if (CBZ.sfx && inside) CBZ.sfx("door_close");
        }
      }
      // its key rides on the clerk, and the safe behind it is his to open
      const v = S.clerk && S.clerk.body ? S.clerk.body() : null;
      if (v && !v.dead && v._gunKeyOf !== G.id && CBZ.cityKeys && CBZ.cityKeys.givePed) {
        v._gunKeyOf = G.id;
        CBZ.cityKeys.givePed(v, G.id, G.label);
        if (!v._venueStaff) v._venueStaff = "gunshop";
      }
    }
    // the door chime, and the man behind the counter looking up at it
    if (S.plan) {
      if (inside && S._in === false) {
        chime();
        const t = (CBZ.now || 0) / 1000;
        if (S.clerk && S.clerk.alive() && !(S.clerk.cowed && S.clerk.cowed()) && !S.clerk.busy() && t - (S._hiT || -99) > 90) {
          S._hiT = t;
          clerkSays(S, ["Afternoon. Anything under the glass, just ask.", "Look around. It's all for sale.", "Help you find something?"][(t | 0) % 3]);
        }
      }
      S._in = inside;
    }
    // the man behind the counter watches whoever is in his shop
    if (S.clerk && S.clerk.look) { if (inside) S.clerk.look(P.pos.x, P.pos.z); else S.clerk.look(null); }
    if (S.clerk) S.clerk.tick(dt, d2 < DRESS_R * DRESS_R);
    if (S.till) S.till.tick(dt);
  }
  CBZ.onUpdate(37, function (dt) {
    const econMode = !!g && (CBZ.economyMode ? CBZ.economyMode(g.mode) : g.mode === "city");
    const cityLive = econMode && !!(CBZ.cityArenaLive ? CBZ.cityArenaLive() : (g.mode === "city"));
    if (cityLive) ensureCity();
    if (econMode) wireFixtures();
    for (let i = STORES.length - 1; i >= 0; i--) {
      const S = STORES[i];
      tickStore(S, dt, S.kind === "city" ? cityLive : (econMode && g.mode !== "city"));
    }
  });

  // ---- public hooks -------------------------------------------------------------
  // is the wall live (for this lot)? shops.js trims firearms off the counter
  // menu when it is, so the wall is the ONE way to buy a gun here.
  CBZ.cityGunWallLive = function (lot) { return !!(cityStore && !cityStore.dead && (!lot || lot === cityStore.lot)); };
  // headless/harness handle: buy a named display off the wall ("AK-47", "Ammo Box")
  CBZ.cityGunstoreBuy = function (name) {
    const S = ensureCity();
    if (!S) return false;
    dress(S);
    const s = S.slots.find((x) => x.name === name);
    if (!s) return false;
    buySlot(s);
    return true;
  };
  CBZ.cityGunstoreLot = function () { return (cityStore && cityStore.lot) || null; };
  // every live gun store (Gang City's and the islands'), as numbers
  CBZ.gunStores = function () {
    return STORES.map(function (S) {
      return { kind: S.kind, name: (S.lot && S.lot.name) || (S.gs && S.gs.name) || null, dressed: S.dressed, near: S.near,
        guns: S.slots.filter(function (s) { return s.gun; }).length, holding: S.till ? S.till.held.length : 0,
        clerk: !!(S.clerk && S.clerk.alive()), x: Math.round(S.cx), z: Math.round(S.cz) };
    });
  };
})();
