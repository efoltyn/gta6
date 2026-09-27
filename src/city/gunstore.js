/* ============================================================
   city/gunstore.js — the WALK-IN gun store: the wall IS the menu.

   WHY: a status gun deserves a counter, a wall, and a clerk. Walking into
   the store, SEEING the actual AK standing in the rack behind the register,
   and walking out holding it IS the purchase fantasy; menus are for
   groceries. The guns lot's shell (buildings.js stamps lot.building.gunstore)
   gets the city's real purchasable stock as the REAL appearance models
   (CBZ.buildActorWeapon, the same wood-and-steel AK every NPC carries).
   Walk up, look at the piece, [E]: cash leaves, the gun's in your hands with
   starter rounds, and the rack shows an empty yoke until the restock truck
   refills it. The clerk is the SAME vendor ped peds.js already posts.

   WHAT THE ROOM IS (de-slop pass, 2026-09-27). Everything here is built
   from parts at real dimensions and merged per material (one draw call per
   finish, see the STORE FIXTURE KIT below):
     • the back wall: a drawer base cabinet with a felt butt tray, a slatwall
       panel above it in trim, and a long-gun rack where every rifle stands
       muzzle-up, leaning 3 degrees into its own padded barrel yoke, with a
       card price tag tied to the yoke. An LED bar light over the rack.
     • the counter: clad in charcoal laminate with a kick plinth, a
       customer-face trim line and a stone worktop; a countertop showcase
       (aluminium frame, glass on five faces, sliding back doors, felt deck,
       LED strip under the lid) with the handguns lying on their sides;
       a POS terminal, receipt printer and card reader at the register end;
       an open hard case of C4 charges at the far end.
     • the ammo gondola at the counter's end: shelving with price-channel
       lips, printed boxes of rounds two deep, steel ammo cans below.
     • an open wooden grenade crate with a divider tray of real frags.
     • the armoury: character rigs in studio cream on round display bases,
       wearing armor.js's real kit.
     • the gunsmith bench: butcher-block top on a steel frame, pegboard with
       tools, a bench vise, a cleaning mat and an articulated lamp.
   Deleted as slop: the flat 12 cm-proud pegboard box, the glowing green
   "trade accent" strip, the glowing glass box and green under-glow slab,
   two olive boxes posing as ammo, the olive boxes under the frags and the
   C4, a four-box bench with a GLOWING vise, and every floating label sprite.
   Rifles, carbines, SMGs and the LMG used to be sorted into the COUNTER
   CASE (only weaponSlot "long" went on the wall), so an AK and an M249 lay
   in a 36 cm glass box: only pistol/utility pieces go under glass now.

   Prices/stock come from cityEcon (buyPrice/stockFor). Perf: built once per
   city on a single group; fixtures merge to a handful of meshes; the whole
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

  const RESTOCK = 150;       // seconds a SOLD slot stays a gap (the truck's coming)
  const VIS_R = 55;          // display group draws only when you're near the shop
  const RACK_REACH = 6.0;    // long guns are bought ACROSS the counter (real gun-store style)
  const CASE_REACH = 3.0;    // counter glass / ammo shelf: walk right up
  const RACK_DOT = 0.60;     // look-cone for the wall (farther away, more central)
  const CASE_DOT = 0.82;     // tighter cone up close so the clerk's E ("Shop here") isn't stolen
  const LEAN = 0.06;         // radians a racked long gun leans back into its yoke

  const S = { lot: null, gs: null, group: null, slots: [], built: false,
              cur: null, prompt: null, lastTxt: "", cx: 0, cz: 0,
              arena: null, noLotArena: null };

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

  // the floor a customer stands on (buildings.js: ground slab top 0.14)
  // the FINISHED floor: fitout_work.js lays the shop floor 6 cm over the slab top
  function floorY(b) { return ((b && Array.isArray(b.floorTops) && b.floorTops[0] != null) ? b.floorTops[0] : 0.14) + 0.06; }

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

  // ---- build the displays once per city ------------------------------------
  function buildDisplays() {
    const e = econ(), gs = S.gs;
    const group = new THREE.Group();
    S.group = group;
    const root = (CBZ.city && CBZ.city.arena && CBZ.city.arena.root) || CBZ.scene;
    root.add(group);
    S.cx = (gs.bounds.minX + gs.bounds.maxX) / 2;
    S.cz = (gs.bounds.minZ + gs.bounds.maxZ) / 2;
    const FY = floorY(S.lot.building);
    const R0 = CBZ.storeFixtureKit.rng(Math.round(S.cx * 13) ^ Math.round(S.cz * 7));

    // partition the shop's REAL stock: stocked guns → the back-wall rack,
    // handguns → the counter showcase.
    const stock = e.stockFor("guns");
    const longs = [], pistols = [];
    for (const n of stock) {
      const it = e.ITEMS[n];
      if (!it || !it.gun) continue;
      const model = buildModel(n);
      if (!model) continue;
      const slot = { name: n, model: null, raw: model, sold: false, restockT: 0, card: null, x: 0, y: 0, z: 0, reach: 3, dot: CASE_DOT };
      (isHandgun(model) ? pistols : longs).push(slot);
    }

    buildRack(group, longs, FY);
    const C = gs.counter;
    const L = Math.max(C.w, C.d), D = Math.min(C.w, C.d);
    const ck = KIT.create().frame(C.x, 0, C.z, KIT.yawOf(C.tx, C.tz));
    const top = KIT.dressCounter(ck, L, D, C.top, FY);
    KIT.till(ck, -L / 2 + 0.55, top, D);
    // the counter's + end holds the C4 hard case when there's room for it
    const c4Zone = L >= 3.0 ? 0.48 : 0;
    const z0 = Math.max(-L / 2 + 1.15, 0.05), z1 = L / 2 - c4Zone - 0.06;
    buildShowcase(group, ck, pistols, C, top, (z0 + z1) / 2, Math.max(0.8, Math.min(2.2, z1 - z0)), Math.min(0.62, D + 0.02));
    // the + end of the floor: the ammo gondola, then the grenade crate
    const ends = buildEnd(group, C, L, D, FY, R0);
    if (e.ITEMS["C4 Charge"]) {
      if (c4Zone) buildC4(group, ck, L / 2 - 0.25, top, 0.02, C);
      else buildC4(group, ends.kit, ends.ammoX, FY + 1.535, 0, C);   // tiny counter: the case sits on the gondola
    }
    ck.build(group);
    ends.kit.build(group);

    // ---- THE ARMOURY (the counter's - end) ----
    buildArmorRack(group, C, L, FY);

    // ---- THE GUNSMITH BENCH ----
    if (CBZ.gunModsOpenBench) buildBench(group, C, L, D, FY);
    if (CBZ.interiorTrackFixture) CBZ.interiorTrackFixture("gun-store", S.lot.building, group);
  }

  /* ---- THE BACK-WALL RACK ----------------------------------------------
     gs.rack is a point 0.18 m off the back wall's inner face, with the
     normal (nx, nz) pointing back into the room. Everything is laid out in
     a frame whose origin is ON the wall face at floor level. */
  function buildRack(group, longs, FY) {
    const R = S.gs.rack;
    const wx = R.x - R.nx * 0.18, wz = R.z - R.nz * 0.18;
    const yaw = KIT.yawOf(R.tx, R.tz);
    const k = KIT.create().frame(wx, 0, wz, yaw);
    const TRAY = FY + 0.92;                     // butt tray top (drawer cabinet height)
    const SLAT = 0.026;                         // slatwall face off the wall

    // stand every gun muzzle-up, side to the room, and measure it
    const racked = longs.map(function (s) {
      const holder = KIT.seat(s.raw, function (turn, m) { m.rotation.set(Math.PI / 2, -Math.PI / 2, 0, "YXZ"); }, "min");
      const sz = holder.userData.size;
      // the bore line: the muzzle point, in the holder frame
      let mu = null;
      if (s.raw.userData && s.raw.userData.muzzle && s.raw.userData.muzzle.isVector3) {
        holder.updateMatrixWorld(true);
        mu = s.raw.localToWorld(s.raw.userData.muzzle.clone());
      }
      return { s, holder, w: sz.x, h: sz.y, th: sz.z, mu: mu || new THREE.Vector3(0, sz.y, sz.z / 2) };
    });
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

    // ---- the slatwall ----
    const S0 = TRAY + 0.01, S1 = FY + 2.46, SH = S1 - S0;
    k.box(0, S0 + SH / 2, 0.006, len, SH, 0.012, 0x57534c);                           // groove backer
    const pitch = 0.0762, slats = Math.floor(SH / pitch);
    for (let i = 0; i < slats; i++) k.box(0, S0 + pitch * (i + 0.5), 0.019, len, pitch - 0.016, 0.014, 0xbab4a8);
    for (const sx of [-1, 1]) k.box(sx * (len / 2 + 0.012), S0 + SH / 2, 0.016, 0.024, SH + 0.02, 0.032, 0xa7abb0, "metal");
    k.box(0, S1 + 0.012, 0.018, len + 0.05, 0.024, 0.036, 0xa7abb0, "metal");
    // an LED bar light over the rack: housing on two arms, lens underneath
    for (const sx of [-1, 1]) k.box(sx * (len / 2 - 0.3), S1 + 0.07, 0.11, 0.02, 0.02, 0.2, 0x2a2d31, "metal");
    k.box(0, S1 + 0.07, 0.22, len - 0.2, 0.045, 0.09, 0x2a2d31, "metal");
    k.box(0, S1 + 0.046, 0.22, len - 0.26, 0.006, 0.06, 0xfff4e0, "glow");

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
      group.add(pivot);
      s.model = pivot;
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
      // its price tag, tied to the end of the yoke bar
      const card = KIT.tagCard(0.045);
      const cp = k.world(bx + 0.034, pz + 0.034);
      card.position.set(cp.x, py - 0.008, cp.z);
      card.rotation.y = yaw + (R0h(s.name) - 0.5) * 0.5;
      group.add(card);
      s.card = card;
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
  }
  function R0h(name) { let h = 7; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0; return (h % 1000) / 1000; }

  /* ---- THE COUNTER SHOWCASE (handguns under glass) ----------------------
     A countertop case on the worktop: black base, felt deck, aluminium
     posts and rails, glass on the top/front/ends, two sliding glass doors on
     the clerk side, an LED strip under the lid's front rail. Handguns lie on
     their right side, muzzle toward the + end, grip toward the customer,
     each with a tent card in front of it. */
  function buildShowcase(group, ck, pistols, C, top, xc, len, wid) {
    const yd = KIT.showcase(ck, xc, top, len, wid, { felt: 0x1f3327 });

    // the handguns, lying on the felt
    const n = pistols.length;
    const rows = n > 4 ? 2 : 1, per = Math.ceil(n / rows);
    pistols.forEach(function (s, i) {
      const row = (i / per) | 0, col = i - row * per;
      const inRow = Math.min(per, n - row * per);
      const lx = xc + (col - (inRow - 1) / 2) * (len - 0.1) / Math.max(inRow, 1);
      const lz = rows === 1 ? -0.07 : (row === 0 ? 0.06 : -0.16);
      const holder = KIT.seat(s.raw, function (turn, m) { m.rotation.set(0, 0, Math.PI / 2); turn.rotation.y = -Math.PI / 2 + 0.35; });
      const wp = ck.world(lx, lz);
      holder.position.set(wp.x, yd + 0.001, wp.z);
      holder.rotation.y = ck.yaw;
      group.add(holder);
      s.model = holder;
      const card = KIT.tentCard();
      const cp = ck.world(lx + (row ? 0.11 : 0), wid / 2 - 0.055);   // at the front edge, clear of the gun
      card.position.set(cp.x, yd, cp.z);
      card.rotation.y = ck.yaw;
      group.add(card);
      s.card = card;
      s.x = wp.x; s.y = yd + 0.05; s.z = wp.z; s.reach = CASE_REACH; s.dot = CASE_DOT;
      S.slots.push(s);
    });
  }

  /* ---- THE + END: ammo gondola + grenade crate --------------------------
     Built in the counter's frame, stepping out past its + end. The gondola
     is a real shelving unit (uprights, pegboard back, four boards with a
     price-channel lip, a top cap) stocked two deep with printed boxes of
     rounds, steel ammo cans on the bottom board. */
  function buildEnd(group, C, L, D, FY, R0) {
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
    // printed boxes of rounds (body, wrap band, end label), two deep
    const WAYS = [[0xb8322a, 0xf0ece0], [0x2f5d3a, 0xe8c547], [0x1f3f73, 0xdadde2], [0xd9d4c4, 0x9a2a22], [0x3a3a3a, 0xd4a43a], [0x7a2f5a, 0xeee6d8]];
    function ammoBox(x, y, z, w, h, d, way) {
      k.box(x, y + h / 2, z, w, h, d, way[0]);
      k.box(x, y + h * 0.55, z, w + 0.002, h * 0.34, d + 0.002, way[1]);
      k.box(x, y + h * 0.55, z + d / 2 + 0.0012, w * 0.55, h * 0.2, 0.0015, 0xf6f4ee);
    }
    [[SH[1], 0.1, 0.07, 0.065, 2], [SH[2], 0.1, 0.07, 0.065, 1], [SH[3], 0.105, 0.036, 0.065, 3]].forEach(function (sh, si) {
      const y0 = FY + sh[0] + 0.01, bw = sh[1], bh = sh[2], bd = sh[3], stack = sh[4];
      const facings = Math.floor((UW - 0.06) / (bw + 0.012));
      for (let f = 0; f < facings; f++) {
        const way = WAYS[(f + si * 2) % WAYS.length];
        const x = ax - (facings - 1) * (bw + 0.012) / 2 + f * (bw + 0.012);
        const hgt = 1 + ((R0() * stack) | 0);
        for (const z of [UD / 2 - 0.05, UD / 2 - 0.05 - bd - 0.012]) for (let st = 0; st < hgt; st++) ammoBox(x, y0 + st * (bh + 0.001), z, bw, bh, bd, way);
      }
    });
    // steel ammo cans on the bottom board: lid, folded handle, latch, stencil
    for (const sx of [-1, 1]) {
      const cx = ax + sx * 0.21, y0 = FY + SH[0] + 0.01;
      k.box(cx, y0 + 0.085, 0.02, 0.28, 0.17, 0.15, 0x4b5234, "metal");
      k.box(cx, y0 + 0.182, 0.02, 0.29, 0.028, 0.16, 0x444b2f, "metal");
      k.box(cx, y0 + 0.2, 0.02, 0.13, 0.01, 0.018, 0x2c3020, "metal");
      for (const hx of [-1, 1]) k.box(cx + hx * 0.06, y0 + 0.199, 0.02, 0.012, 0.012, 0.03, 0x2c3020, "metal");
      k.box(cx + 0.146, y0 + 0.14, 0.02, 0.012, 0.09, 0.05, 0x3a4028, "metal");
      k.box(cx, y0 + 0.1, 0.0955, 0.12, 0.018, 0.001, 0xd9b23a);
    }
    const ammo = { name: "Ammo Box", ammo: true, sold: false, x: 0, y: FY + 0.9, z: 0, reach: CASE_REACH, dot: CASE_DOT };
    const ap = k.world(ax, 0.1); ammo.x = ap.x; ammo.z = ap.z;
    S.slots.push(ammo);

    // ---- the grenade crate: an open OD-painted plank crate, rope handles,
    //      a kraft divider tray with the frags standing in it ----
    if (e.ITEMS["Grenade"]) {
      const CW = 0.56, CD = 0.4, CH = 0.32;
      let fx = ax + UW / 2 + 0.14 + CW / 2, fy = FY, onTop = false;
      if (fx + CW / 2 > room) { fx = ax; fy = TOPY + 0.03; onTop = true; }
      {
        const OD = 0x4d5634, ODD = 0x3f472b;
        k.box(fx, fy + 0.01, 0, CW, 0.02, CD, ODD);
        for (const sz of [-1, 1]) for (let p = 0; p < 2; p++) k.box(fx, fy + 0.02 + 0.075 + p * 0.152, sz * (CD / 2 - 0.01), CW, 0.146, 0.02, OD);
        for (const sx of [-1, 1]) for (let p = 0; p < 2; p++) k.box(fx + sx * (CW / 2 - 0.01), fy + 0.02 + 0.075 + p * 0.152, 0, 0.02, 0.146, CD - 0.04, OD);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(fx + sx * (CW / 2 - 0.035), fy + CH / 2 + 0.01, sz * (CD / 2 + 0.008), 0.05, CH - 0.02, 0.016, ODD);
        k.box(fx, fy + 0.2, CD / 2 + 0.0015, 0.26, 0.03, 0.002, 0xd9b23a);
        for (const sx of [-1, 1]) k.torus(fx + sx * (CW / 2 + 0.004), fy + 0.2, 0, 0.045, 0.007, 0xb89a62, "solid", 0, Math.PI / 2, Math.PI, Math.PI);
        const trayY = fy + CH - 0.1;
        k.box(fx, trayY, 0, CW - 0.05, 0.01, CD - 0.05, 0xb08a55);
        for (let i = 1; i < 4; i++) k.box(fx - (CW - 0.05) / 2 + (CW - 0.05) * i / 4, trayY + 0.03, 0, 0.003, 0.05, CD - 0.05, 0xa47e4a);
        k.box(fx, trayY + 0.03, 0, CW - 0.05, 0.05, 0.003, 0xa47e4a);
        if (CBZ.itemAsset) for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
          const gm = CBZ.itemAsset("Grenade", null, { kind: "grenade" });
          if (gm) k.absorb(gm, fx - (CW - 0.05) * 3 / 8 + i * (CW - 0.05) / 4, trayY + 0.005, (j ? 1 : -1) * (CD - 0.05) / 4, 0, R0() * 6.28, 0);
        }
      }
      const gp = k.world(fx, 0.05);
      const gren = { name: "Grenade", boom: true, sold: false, x: gp.x, y: fy + CH, z: gp.z, reach: CASE_REACH, dot: CASE_DOT };
      S.slots.push(gren);
    }
    return { kit: k, ammoX: ax };
  }

  /* ---- the C4: an open black hard case, egg-crate foam in the lid, two
     charges bedded in the base foam. `k` is a kit whose frame has +Z toward
     the customer; (x, y) is where the case's foot sits. */
  function buildC4(group, k, x, y, z, C) {
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
    S.slots.push({ name: "C4 Charge", boom: true, sold: false, x: wp.x, y: y + 0.1, z: wp.z, reach: CASE_REACH, dot: CASE_DOT });
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
        skin: FORM_SKIN, hair: FORM_SKIN, shoes: FORM_DARK, cap: 0,
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
  function buildArmorRack(group, C, L, FY) {
    if (!CBZ.ARMOR_KITS) return;
    const sells = ARMOR_FOR_SALE.filter((sp) => armorKit(sp.kit));
    if (!sells.length) return;
    let inx = S.cx - C.x, inz = S.cz - C.z;
    const il = Math.hypot(inx, inz) || 1; inx /= il; inz /= il;
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
      S.slots.push({ name: sp.label, armor: true, kit: sp.kit, price: sp.price, rig: rig,
                     sold: false, x: x, y: FY + (isHelmet ? 1.75 : 1.40), z: z, reach: CASE_REACH, dot: CASE_DOT });
    });
    k.build(group);
  }
  // headless / harness handle: what the armoury row is actually WEARING.
  CBZ.cityGunstoreArmoury = function () {
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
     Walk up, [E], and fit the gun in your hands (city/gunmods.js owns the
     catalog + menu). A freestanding bench on the customer side: butcher-block
     top on a steel frame with a lower shelf, a pegboard riser with wrenches
     hung on it, a bench vise, a cleaning mat with a rod, a screwdriver and
     an oil bottle, an articulated lamp. Kept off the room's centre line,
     which is the customer's walk from the door to the counter. */
  function buildBench(group, C, L, D, FY) {
    let inx = S.cx - C.x, inz = S.cz - C.z; const il = Math.hypot(inx, inz) || 1; inx /= il; inz /= il;
    let lat = L * 0.28;
    let wx = C.x + C.tx * lat + inx * 1.6, wz = C.z + C.tz * lat + inz * 1.6;
    const latC = (wx - S.cx) * C.tx + (wz - S.cz) * C.tz;
    if (Math.abs(latC) < 1.62) { const shift = (latC >= 0 ? 1 : -1) * 1.62 - latC; wx += C.tx * shift; wz += C.tz * shift; }
    const B = S.gs.bounds;
    wx = Math.max(B.minX + 0.75, Math.min(B.maxX - 0.75, wx));
    wz = Math.max(B.minZ + 0.75, Math.min(B.maxZ - 0.75, wz));
    const k = KIT.create().frame(wx, 0, wz, KIT.yawOf(C.tx, C.tz));
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
    for (const sx of [-1, 1]) k.box(sx * 0.58, PB + 0.3, -0.29, 0.03, 0.6, 0.03, STEEL, "metal");
    k.box(0, PB + 0.3, -0.29, 1.12, 0.56, 0.012, 0xc9b48a);
    for (let i = 0; i < 16; i++) for (let j = 0; j < 7; j++) k.box(-0.525 + i * 0.07, PB + 0.06 + j * 0.07, -0.2835, 0.007, 0.007, 0.002, 0x6f604a);
    if (CBZ.itemAsset) {
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
    S.slots.push({ name: "Gunsmith Bench", mod: true, sold: false, x: wx, y: T + 0.1, z: wz, reach: CASE_REACH + 0.6, dot: CASE_DOT - 0.08 });
  }

  // ---- SOLD gap / restock ----------------------------------------------------
  // the gun and its tag leave together; the empty yoke (or bare felt) stays
  function setSold(s, on) {
    s.sold = !!on;
    if (s.model) s.model.visible = !on;
    if (s.card) s.card.visible = !on;
    if (on) s.restockT = RESTOCK * (0.8 + Math.random() * 0.5);
  }

  // ---- buying ----------------------------------------------------------------
  function buySlot(s) {
    const e = econ();
    if (!s || !e || !CBZ.city) return;
    if (s.mod) { if (CBZ.gunModsOpenBench) CBZ.gunModsOpenBench(); return; }   // open the gunsmith menu
    if (s.ammo) {
      const meta = e.ITEMS["Ammo Box"] || {}, price = e.buyPrice("Ammo Box");
      if (!CBZ.city.spend(price)) { CBZ.city.note("Ammo runs " + fmt$(price) + " a box.", 1.6); return; }
      if (CBZ.cityAddAmmo) CBZ.cityAddAmmo(meta.rounds || 60);
      if (CBZ.sfx) CBZ.sfx("coin");
      CBZ.city.note("+" + (meta.rounds || 60) + " rounds over the counter.", 1.6);
      return;
    }
    // ARMOR: a kit off the rack. Charge, then route through armor.js's equip
    // (sets the player's armor bar + mesh). Never "sells out" — you can re-buy
    // to top your plate back up after it's been shot off. swatVest isn't here.
    if (s.armor) {
      if (!CBZ.cityEquipArmor) { CBZ.city.note("Body armor's not stocked right now.", 1.8); return; }
      const price = armorPrice({ kit: s.kit, label: s.name, price: s.price });
      if (!CBZ.city.spend(price)) { CBZ.city.note("The " + s.name + " runs " + fmt$(price) + ", come back with the money.", 2); return; }
      CBZ.cityEquipArmor(s.kit);
      if (CBZ.sfx) CBZ.sfx("coin");
      CBZ.city.note("Strapped on the " + s.name + " for " + fmt$(price) + ", you're plated up.", 2.2);
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
      return;
    }
    // explosive consumables: bought by COUNT, never sell out (crates restock
    // off-screen). Counts mirror to g.cityGrenades / g.cityC4 for HUD readers.
    if (s.boom) {
      const price = e.buyPrice(s.name);
      if (!CBZ.city.spend(price)) { CBZ.city.note("The " + s.name + " runs " + fmt$(price) + ", come back with the money.", 2); return; }
      e.add(s.name, 1);
      const n = e.count ? e.count(s.name) : 0;
      if (s.name === "Grenade") g.cityGrenades = n;
      if (s.name === "C4 Charge") g.cityC4 = n;
      if (CBZ.sfx) CBZ.sfx("coin");
      CBZ.city.note(s.name === "C4 Charge"
        ? "C4 in the bag (" + n + " carried). [B] plants it, hold [B] to send the signal."
        : "Frag in the bag (" + n + " carried). [G] throws it.", 2.4);
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
      return;
    }
    if (s.sold) { CBZ.city.note("That slot's sold out, restock truck's rolling.", 1.8); return; }
    const meta = e.ITEMS[s.name];
    if (!meta) return;
    const price = e.buyPrice(s.name);   // the SAME price the counter menu reads
    if (!CBZ.city.spend(price)) {
      CBZ.city.note("The " + s.name + " runs " + fmt$(price) + ", come back with the money.", 2);
      return;
    }
    e.add(s.name, 1);
    if (CBZ.cityGiveWeapon) CBZ.cityGiveWeapon(s.name);
    // starter ammo: two mags so the piece leaves the store LOADED (launchers
    // get a spare rocket) — small enough next to the sticker price to never
    // beat the $60 ammo box as an economy exploit.
    const rounds = Math.max(2, (meta.ammo | 0) * 2);
    if (CBZ.cityAddAmmo) CBZ.cityAddAmmo(rounds);
    setSold(s, true);
    if (CBZ.sfx) CBZ.sfx("coin");
    if (CBZ.city.addRespect) CBZ.city.addRespect(price >= 3000 ? 3 : 1);   // walking out heavy IS the flex
    if (price >= 3000 && CBZ.city.big) CBZ.city.big(s.name + ", straight off the wall!");
    CBZ.city.note("Bought the " + s.name + " for " + fmt$(price) + " (+" + rounds + " starter rounds).", 2.2);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }

  // ---- the look-pick + [E] prompt --------------------------------------------
  function pickSlot() {
    const P = CBZ.player, B = S.gs.bounds;
    const px = P.pos.x, pz = P.pos.z;
    // browse gate: only while you're actually IN the store (small apron at the door)
    if (px < B.minX - 1.5 || px > B.maxX + 1.5 || pz < B.minZ - 1.5 || pz > B.maxZ + 1.5) return null;
    const yaw = CBZ.cam ? CBZ.cam.yaw : 0, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    let best = null, bestScore = -1;
    for (const s of S.slots) {
      const dx = s.x - px, dz = s.z - pz, d = Math.hypot(dx, dz);
      if (d > (s.reach || 3) || d < 0.05) continue;
      const dot = (dx / d) * fx + (dz / d) * fz;
      if (dot < (s.dot || CASE_DOT)) continue;          // you buy the one you're LOOKING at
      const score = dot - d * 0.06;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return best;
  }

  function promptText(s) {
    const e = econ();
    if (s.mod) return "<b style='color:#ffd166'>[E]</b> Gunsmith Bench, <span style='color:#7ed957'>fit scopes, bigger mags, silencer, grips</span>";
    if (s.ammo) {
      const meta = e.ITEMS["Ammo Box"] || {};
      return "<b style='color:#ffd166'>[E]</b> Ammo Box, <span style='color:#7ed957'>" + fmt$(e.buyPrice("Ammo Box")) + "</span> <span style='color:#7f8794'>+" + (meta.rounds || 60) + " rounds</span>";
    }
    if (s.boom) {
      const use = s.name === "C4 Charge" ? "remote det, [B] plant, hold [B] boom" : "frag, [G] throws it";
      return "<b style='color:#ffd166'>[E]</b> Buy " + s.name + ", <span style='color:#7ed957'>" + fmt$(e.buyPrice(s.name)) + "</span> <span style='color:#7f8794'>" + use + "</span>";
    }
    if (s.armor) {
      const kit = armorKit(s.kit) || {};
      const price = armorPrice({ kit: s.kit, label: s.name, price: s.price });
      const stats = ((kit.pts | 0) > 0 ? "+" + kit.pts + " armor" : "body armor") + (kit.slot === "helmet" ? ", head" : "");
      return "<b style='color:#ffd166'>[E]</b> Equip " + s.name + ", <span style='color:#7ed957'>" + fmt$(price) + "</span> <span style='color:#7f8794'>" + stats + "</span>";
    }
    if (s.sold) return "<span style='color:#ff9e9e'>" + s.name + ", SOLD</span> <span style='color:#7f8794'>restock truck's rolling</span>";
    const meta = e.ITEMS[s.name] || {};
    const price = e.buyPrice(s.name);
    const stats = ((meta.dmg | 0) > 1 ? meta.dmg + " dmg" : "explosive") + (meta.ammo ? ", " + meta.ammo + "-rd mag" : "");
    return "<b style='color:#ffd166'>[E]</b> Buy " + s.name + ", <span style='color:#7ed957'>" + fmt$(price) + "</span> <span style='color:#7f8794'>" + stats + "</span>";
  }

  function promptEl() {
    if (S.prompt) return S.prompt;
    if (typeof document === "undefined" || !document.body) return null;
    const d = document.createElement("div");
    d.id = "gunstorePrompt";
    d.style.cssText = "position:fixed;left:50%;bottom:150px;transform:translateX(-50%);z-index:46;display:none;" +
      "background:rgba(13,16,21,.9);border:1px solid #3a4150;border-radius:12px;padding:7px 14px;color:#e8eef7;" +
      "font-family:Fredoka,system-ui,sans-serif;font-size:15px;pointer-events:auto;cursor:pointer;text-align:center;max-width:78vw";
    d.addEventListener("click", function () { if (S.cur) buySlot(S.cur); });   // tap-to-buy (mobile)
    document.body.appendChild(d);
    S.prompt = d;
    return d;
  }
  function showPrompt(txt) {
    const el = promptEl();
    if (!el) return;
    if (CBZ.touchPromptHTML) txt = CBZ.touchPromptHTML(txt);   // touch: [E] → tappable verb pill
    if (txt !== S.lastTxt) { el.innerHTML = txt; S.lastTxt = txt; }
    if (el.style.display !== "block") el.style.display = "block";
  }
  function hidePrompt() {
    if (S.prompt && S.prompt.style.display !== "none") S.prompt.style.display = "none";
    S.cur = null;
  }

  // ---- find the lot + build once (self-healing, clubLot pattern) -------------
  // PERF: the fallback lot scan is O(all lots) — fine ONCE, but this runs from a
  // per-frame updater, so a city with no gun-store lot must not rescan forever.
  // The gunstore stamp + arena.gunShopLot land synchronously at build
  // (buildings.js), so one failed scan per arena is a true answer — remember it.
  // An arena REBUILD (new run) also invalidates a previously-built wall: the old
  // display group died with the old root, so tear down and rebuild on the new one.
  function ensure() {
    const arena = CBZ.city && CBZ.city.arena;
    if (S.built) {
      if (S.arena === arena) return true;
      S.built = false; S.group = null; S.slots = []; S.cur = null; S.lot = null; S.gs = null;
    }
    if (!arena || !econ() || !CBZ.buildActorWeapon) return false;
    if (S.noLotArena === arena) return false;          // this city has no gun wall — answered once
    let lot = arena.gunShopLot || null;
    if (!(lot && lot.building && lot.building.gunstore)) {
      lot = null;
      const lots = arena.lots || [];
      for (let i = 0; i < lots.length; i++) { const L = lots[i]; if (L && L.building && L.building.gunstore) { lot = L; break; } }
      if (!lot && lots.length) { S.noLotArena = arena; return false; }
    }
    if (!lot) return false;
    S.lot = lot; S.gs = lot.building.gunstore; S.arena = arena;
    buildDisplays();
    S.built = true;
    return true;
  }

  // ---- per-frame --------------------------------------------------------------
  CBZ.onUpdate(37, function (dt) {
    if (!g || g.mode !== "city") { if (S.group && S.group.visible) S.group.visible = false; hidePrompt(); return; }
    if (!ensure()) return;
    // restock timers keep ticking — the street keeps moving while you're away
    for (const s of S.slots) {
      if (!s.sold) continue;
      s.restockT -= dt;
      if (s.restockT <= 0) {
        setSold(s, false);
        const P = CBZ.player;
        if (P && CBZ.city && Math.hypot(P.pos.x - s.x, P.pos.z - s.z) < 30)
          CBZ.city.note("Fresh steel on the rack, the " + s.name + " is back in stock.", 2.2);
      }
    }
    // distance VIS-GATE: the dozen display models draw only when you're near
    const P = CBZ.player;
    const dx = P.pos.x - S.cx, dz = P.pos.z - S.cz;
    const near = (dx * dx + dz * dz) < VIS_R * VIS_R;
    if (S.group && S.group.visible !== near) S.group.visible = near;
    if (!near || g.state !== "playing" || P.dead || P.driving || CBZ.cityMenuOpen) { hidePrompt(); return; }
    const s = pickSlot();
    if (!s) { hidePrompt(); return; }
    S.cur = s;
    showPrompt(promptText(s));
  });

  // [E] buys the piece you're looking at. CAPTURE phase so the wall wins the
  // key over interact.js's bubble listener; stopImmediatePropagation keeps a
  // single press from ALSO opening the clerk's counter menu.
  addEventListener("keydown", function (e) {
    if (!S.cur || !g || g.mode !== "city" || g.state !== "playing") return;
    if (CBZ.cityMenuOpen || (CBZ.player && (CBZ.player.driving || CBZ.player.dead))) return;
    if ((e.key || "").toLowerCase() !== "e") return;
    e.preventDefault();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    e.stopPropagation();
    buySlot(S.cur);
  }, true);

  // ---- public hooks -------------------------------------------------------------
  // is the wall live (for this lot)? shops.js trims firearms off the counter
  // menu when it is, so the wall is the ONE way to buy a gun here.
  CBZ.cityGunWallLive = function (lot) { return !!(S.built && S.lot && (!lot || lot === S.lot)); };
  // headless/harness handle: buy a named display off the wall ("AK-47", "Ammo Box")
  CBZ.cityGunstoreBuy = function (name) {
    if (!ensure()) return false;
    const s = S.slots.find((x) => x.name === name);
    if (!s) return false;
    buySlot(s);
    return true;
  };
  CBZ.cityGunstoreLot = function () { return (S.built && S.lot) || null; };
})();
