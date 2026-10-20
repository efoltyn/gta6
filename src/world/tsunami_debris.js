/* ============================================================
   world/tsunami_debris.js - THE DEBRIS FIELD, SHARED BY BOTH TSUNAMIS.

   Moved out of city/tsunami.js (2026-09-27) so the island tsunami in
   systems/disasters.js gets the real entrained-object debris on every page
   that runs it: disaster.html never loaded the city file and quietly fell
   back to the plank path (deleted 2026-09-28). Pure kit: no per-frame hook
   of its own.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  /* ============================================================
     THE DEBRIS FIELD — WHAT ACTUALLY KILLS PEOPLE IN A TSUNAMI.

     Owner's science, and the whole reason this exists: "tsunami deaths are
     rarely just drowning. The wave is a churning high-speed soup of cars,
     trees, steel, building fragments. Primary death: blunt force trauma —
     battered and crushed by debris acting as battering rams."

     So the water does not kill you here. The things IN it do, and they are
     real things: the car that was parked on the seafront, the tree that was
     growing behind it, the house that went past you thirty seconds ago. They
     are picked up at the front, they TUMBLE inside the flow (a car in a bore
     does not drive, it rolls), they hit people at closing speed, and when the
     water leaves they are simply left where they stopped — which is the image
     everybody who has seen the aftermath footage remembers.

     NOTHING IN THE WATER IS INVENTED (2026-08-15). The kit used to be able to
     manufacture its own flotsam — a pooled cylinder that stood for "a log", a
     flat brown box that stood for "a panel" — and the owner's verdict on that
     was final: no fake debris. Spawned scenery in a soup of real objects reads
     as exactly what it is, and it broke the only promise the field makes, that
     everything battering you WAS STANDING IN THE WORLD A SECOND AGO. So the
     manufacture path (`shed`) is gone. The kit now only ever TAKES: the
     caller hands it a real object it has already pulled out of its own system
     — a car group, the actual trunk-and-canopy meshes of an uprooted tree, a
     wall torn off the swept house's own group with its own material — and the
     field takes over where it is drawn, nothing more.

     ONE EXCEPTION, 2026-09-28: the churn at the foot of the front (below,
     churn()) carries a small pooled load the bore scoured off the coast
     before it came into shot — the arena's own car meshes plus lumber,
     pallets and roof sections — because a front that arrives from open sea
     otherwise has an empty toe, and the toe is where every reference frame
     is thickest with wreckage.

     ONE FIELD, TWO CONSUMERS. This file drives the city's;
     systems/disasters.js drives the island's with the same object and the same
     motion, because a tsunami that looks different in two modes is two
     tsunamis. Neither of them owns a physics bus: the kit reports a STRIKE
     with a cause string and the caller routes it through its own kill bus
     (CBZ.surv.hurt on the island, CBZ.cityKillPed / cityHurtPlayer here).

     cfg: {
       root          Object3D to parent spawned fragments to
       seaY(x,z)     water surface height  (the ONE shared surface, always)
       groundY(x,z)  terrain height
       forEachActor(fn)  fn(actor) — actor.pos{x,y,z}, actor.isPlayer, actor.dead
       strike(actor, info)  info {kind, speed, dirX, dirZ, force, damage, cause}
       againstWall(x,z)     optional; true if a body here has a wall behind it
       flowAt(x,z,out)      optional: the LOCAL water {depth, u, v} (the run-up
                            field). With it every piece is carried by the
                            current where it actually is, floats only where
                            the water is deeper than its draft, grounds where
                            it is not, and refloats when the water comes back.
       blockedAt(x,z)       optional: true inside a standing building. A piece
                            the current drives into a wall stops against it
                            and the next one stops against that: wrack piles.
     }
     ============================================================ */
  const DEB_RAND = () => Math.random();     // runtime FX only — never a build path

  /* ============================================================
     THE CHURN AT THE FOOT (2026-09-28).

     Taking only what the water has already reached left the one place every
     reference frame is thickest with wreckage — the boiling foot of the
     advancing front — empty: the island bore arrives from open sea, so until
     it has chewed through the seafront it carries nothing. A real bore has
     already scoured the harbour and the coast road before it is in shot, and
     it arrives with that load rolling in its toe: cars on their roofs,
     lumber, pallets, a torn roof section. So the field can carry a small
     pooled LOAD in the churn: ~30 pieces, riding the skirt mound just ahead
     of the wall, surging fore and aft and tumbling, battering whatever the
     foot runs over; each one falls out of the churn at its own point of the
     crossing and from then on is an ordinary item of this field (drifts with
     the flood, is stranded where the drain leaves it).

     The cars are the ARENA'S OWN car geometry and material (the caller hands
     over template meshes; nothing is re-modelled). Lumber, pallets and roof
     sections are three shared merged geometries drawn as three InstancedMesh
     batches: 3 draw calls plus one per car, no lights, no per-frame
     allocation.
     ============================================================ */
  const CHURN_FOOT = 4.3;    // m at H=34: where the wall's foot meets the skirt
  const CHURN_SKIRT0 = 4.9, CHURN_SKIRT = 8.1;   // the face's skirt start / span at H=34

  /* THE POSE OF ONE PIECE IN THE TOE — pure, so it can be checked without a
     renderer. front: {x, z, dx, dz, H, seaY, turbid, t}; p: {f, l, ph, fw}.
     f = forward offset in skirt units (0 foot .. 1 end of the skirt), l =
     lateral metres along the front. Returns {x, y, z, depthK}. The height is
     the face's own skirt mound (water_spec.js shape(): seaLocal + 0.28 +
     (0.05 + 0.07 turbid) H (1 - sdn)^1.6), so a piece rides the water the
     face draws instead of floating through it. */
  function churnPose(front, p, out) {
    out = out || {};
    const zs = Math.max(0.1, front.H) / 34;
    const tb = Math.max(0, Math.min(1, front.turbid || 0));
    const skirtSpan = CHURN_SKIRT * (0.75 + 0.45 * tb) * zs;
    // fore and aft on the surge: the toe keeps swallowing and spitting it
    const surge = Math.sin(front.t * (0.9 + 0.5 * p.fw) + p.ph) * 0.14 + Math.sin(front.t * 2.3 + p.ph * 1.7) * 0.05;
    const f = Math.max(-0.08, Math.min(0.92, p.f + surge));
    const fwd = CHURN_FOOT * zs + f * (skirtSpan + (CHURN_SKIRT0 - CHURN_FOOT) * zs);
    const sdn = Math.max(0, Math.min(1, (fwd - CHURN_SKIRT0 * zs) / skirtSpan));
    const mound = 0.28 + (0.05 + 0.07 * tb) * front.H * Math.pow(1 - sdn, 1.6);
    out.x = front.x + front.dx * fwd - front.dz * p.l;
    out.z = front.z + front.dz * fwd + front.dx * p.l;
    out.y = front.seaY + mound;
    out.depthK = 1 - sdn;
    return out;
  }

  // ---- shared churn geometry (built once per page, reused by every event) --
  let churnKit = null;
  function lin(hex) { return new THREE.Color(hex).convertSRGBToLinear(); }
  function vcBox(w, h, d, x, y, z, hex, ry) {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    const c = lin(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute("color", new THREE.BufferAttribute(a, 3));
    g.deleteAttribute("uv");
    return g;
  }
  function mergeKit(parts) {
    const U = THREE.BufferGeometryUtils;
    const g = U.mergeBufferGeometries(parts, false);
    parts.forEach(function (p) { p.dispose(); });
    g.computeBoundingSphere();
    return g;
  }
  function buildChurnKit() {
    if (churnKit) return churnKit;
    if (!THREE.BufferGeometryUtils || !THREE.BufferGeometryUtils.mergeBufferGeometries) return null;
    // LUMBER: one sawn board, 3.6 m x 200 x 45 mm; the tint is per instance
    const board = mergeKit([vcBox(0.2, 0.045, 3.6, 0, 0, 0, 0xffffff)]);
    // PALLET: three stringers, seven top slats, three bottom boards
    const pal = [];
    for (let i = -1; i <= 1; i++) pal.push(vcBox(0.09, 0.09, 1.2, i * 0.46, 0, 0, i ? 0xb39a74 : 0xa88f68));
    for (let i = 0; i < 7; i++) pal.push(vcBox(1.0, 0.022, 0.1, 0, 0.056, -0.54 + i * 0.18, (i % 3) ? 0xc4ab82 : 0xb59c74));
    for (let i = -1; i <= 1; i++) pal.push(vcBox(1.0, 0.022, 0.14, 0, -0.056, i * 0.52, 0xa28a64));
    const pallet = mergeKit(pal);
    // ROOF SECTION: sheathing torn off with its shingle courses, a fascia
    // board along the eave and the stubs of three rafters underneath
    const rf = [];
    rf.push(vcBox(3.4, 0.03, 2.5, 0, 0, 0, 0x9c8560));                         // OSB deck
    for (let i = 0; i < 6; i++) {
      const hex = [0x4b403c, 0x453a37, 0x514540][i % 3];
      rf.push(vcBox(3.45, 0.035, 0.46, 0, 0.03 + i * 0.012, -1.03 + i * 0.41, hex));
    }
    rf.push(vcBox(3.5, 0.16, 0.035, 0, -0.03, -1.27, 0xd2cabb));              // fascia
    for (let i = -1; i <= 1; i++) rf.push(vcBox(0.05, 0.14, 2.3, i * 1.3, -0.09, 0.05, 0x8d7652));
    const roof = mergeKit(rf);
    /* SHIPPING CONTAINER: a 20 ft ISO box (6.06 x 2.59 x 2.44 m) off the
       quay — corrugated side sheets (alternating proud/recessed bays), the
       corner posts and rails that carry it, and the door end's four locking
       bars. Every harbour tsunami frame has them floating in the soup. */
    const ct = [], L = 6.06, H = 2.59, Wd = 2.44;
    ct.push(vcBox(L - 0.2, H - 0.24, Wd - 0.12, 0, 0, 0, 0xffffff));
    for (let i = 0; i < 26; i++) {
      const x = -L / 2 + 0.2 + (i + 0.5) * ((L - 0.4) / 26);
      if (i % 2) continue;
      ct.push(vcBox((L - 0.4) / 26 * 0.9, H - 0.36, 0.05, x, 0, (Wd - 0.12) / 2 + 0.02, 0xf2f2f2));
      ct.push(vcBox((L - 0.4) / 26 * 0.9, H - 0.36, 0.05, x, 0, -(Wd - 0.12) / 2 - 0.02, 0xf2f2f2));
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) ct.push(vcBox(0.16, H, 0.16, sx * (L / 2 - 0.08), 0, sz * (Wd / 2 - 0.08), 0xd8d8d8));
    for (const sy of [-1, 1]) for (const sz of [-1, 1]) ct.push(vcBox(L, 0.14, 0.12, 0, sy * (H / 2 - 0.07), sz * (Wd / 2 - 0.06), 0xd8d8d8));
    for (let i = 0; i < 4; i++) ct.push(vcBox(0.05, H - 0.3, 0.05, L / 2 + 0.03, 0, -Wd / 2 + 0.35 + i * ((Wd - 0.7) / 3), 0x9a9a9a));
    const container = mergeKit(ct);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    mat.name = "tsunami churn debris";
    churnKit = { board: board, pallet: pallet, roof: roof, container: container, mat: mat };
    return churnKit;
  }
  const BOARD_TINTS = [0xc9a877, 0xb8966a, 0x8f8272, 0xd8d2c4, 0x7d9bb0, 0xa06b4a];
  const PALLET_TINTS = [0xffffff, 0xe6e0d6, 0xcfc4b0];
  const ROOF_TINTS = [0xffffff, 0xd9d2cc];
  const CONTAINER_TINTS = [0x9b2f22, 0x2b4f7a, 0x2f6b43, 0x8a5a2b, 0xb9b3a6, 0x6e3324];

  CBZ.tsuChurnPose = churnPose;     // pure; exported for checks
  /* THE DRAFTS, published: the water a thing needs under it to float. The
     island director lifts a parked car into the field at exactly this depth
     (and the lab kit `tsunami` does the same), so "when does a car float"
     is one number. Must match CLASS below. */
  CBZ.tsuDebrisDraft = { car: 0.55, log: 0.30, panel: 0.12, rubble: 0.90, boat: 0.35, container: 1.30 };

  /* THE LIVE FIELDS (2026-10-15). The island keeps ONE event's wreckage
     alive at a time (disasters.js disposes the last field when the next
     tsunami starts), and the match reset must be able to take all of it back
     without knowing where disasters.js keeps it: every field registers here,
     CBZ.tsuDebrisReset() disposes them all (taken world objects back where
     they stood, the churn's own meshes gone), and the debris audit reads them. */
  const liveFields = new Set();
  CBZ.tsuDebrisReset = function () {
    liveFields.forEach(function (f) { try { f.dispose(); } catch (e) {} });
    liveFields.clear();
    if (CBZ.debris && CBZ.debris.medium) CBZ.debris.medium("tsunami", null);
  };
  (CBZ.debrisAuditSources || (CBZ.debrisAuditSources = {})).tsunami = function (o) {
    const out = { floating: 0, fast: 0, high: 0, maxSpeed: 0, maxHeight: 0, items: 0, list: [] };
    liveFields.forEach(function (f) {
      if (!f.auditInto) return;
      try { f.auditInto(out, o || {}); } catch (e) {}
    });
    return out;
  };
  /* NOTHING IS LEFT HANGING WHEN THE WATER STOPS BEING STEPPED (2026-10-19,
     owner: "after a tsunami, trees and other things stay FLOATING in the
     air"). A field's pieces were only ever moved by its own step(), which the
     tsunami calls through the backwash and stops calling the moment the
     run-up field detaches (drained, the 14 s cut, the calm's forceQuiet).
     Whatever was afloat or still coming down at that instant froze there: a
     pine a metre over the street, tumbled to whatever angle the last frame
     gave it. Now a field that has not been stepped for a moment lays every
     piece of its own down under gravity (CBZ.tsuDebrisSettle snaps them). */
  const IDLE_MS = 300;
  if (CBZ.onUpdate) CBZ.onUpdate(28.4, function (dt) {
    if (!liveFields.size) return;
    const now = performance.now();
    liveFields.forEach(function (f) { if (f.idle && now - f.lastStep() > IDLE_MS) { try { f.idle(Math.min(0.1, dt || 0)); } catch (e) {} } });
  });
  CBZ.tsuDebrisSettle = function () {
    let n = 0;
    liveFields.forEach(function (f) { if (f.settleAll) { try { n += f.settleAll(); } catch (e) {} } });
    return n;
  };
  const MAX_SP = 12;          // m/s: the fastest a kinematic piece of the field moves

  CBZ.tsuDebrisField = function (cfg) {
    cfg = cfg || {};
    const root = cfg.root || null;
    const seaY = cfg.seaY || function () { return 0; };
    const groundY = cfg.groundY || function () { return 0; };
    const items = [];
    let entrained = 0, strikes = 0, kills = 0, checkPhase = 0;

    /* MASS IS THE WHOLE POINT. A plank rides on top and stings; a car is two
       tonnes moving at the speed of the water and it kills whatever it meets.
       These numbers are the only difference between the classes — the classes
       are BEHAVIOUR, never geometry: `log` is a real uprooted tree, `panel` a
       wall off a real building, `rubble` a chunk of one. What each looks like
       is whatever the world object the caller handed over looks like.        */
    /* draft: metres of water it needs to float (a car lifts at ~0.6 m, an
       empty steel box at ~1.3, a dinghy at a hand's depth over its keel).
       relax: how fast it takes up the water's velocity (1/s; a log is
       carried at once, two tonnes of car lag the current). size: its half
       length, for piling against walls and against each other. upright:
       hulls float the right way up and weathercock; everything else tumbles. */
    const D = CBZ.tsuDebrisDraft;
    const CLASS = {
      car:       { drift: 0.85, hitR: 2.5, dmg: 92,  force: 17, sink: 0.55, spin: 1.5, draft: D.car, relax: 1.5, size: 2.2 },
      log:       { drift: 0.95, hitR: 1.9, dmg: 44,  force: 11, sink: 0.18, spin: 3.0, draft: D.log, relax: 2.6, size: 2.6 },
      panel:     { drift: 1.00, hitR: 1.5, dmg: 26,  force: 8,  sink: 0.10, spin: 3.6, draft: D.panel, relax: 3.2, size: 1.4 },
      rubble:    { drift: 0.70, hitR: 1.1, dmg: 34,  force: 9,  sink: 0.35, spin: 4.2, draft: D.rubble, relax: 1.0, size: 0.9 },
      boat:      { drift: 0.95, hitR: 2.3, dmg: 60,  force: 14, sink: 0.12, spin: 0.7, draft: D.boat, relax: 1.9, size: 2.0, upright: true },
      container: { drift: 0.80, hitR: 3.3, dmg: 120, force: 24, sink: 1.00, spin: 0.45, draft: D.container, relax: 0.8, size: 3.2 },
    };
    const flowAt = typeof cfg.flowAt === "function" ? cfg.flowAt : null;
    const blockedAt = typeof cfg.blockedAt === "function" ? cfg.blockedAt : null;
    const _fl = {};
    let carried = 0, piled = 0;

    function add(obj, x, z, kind, opts) {
      opts = opts || {};
      const k = CLASS[kind] ? kind : "panel";
      const it = {
        obj: obj, x: x, z: z, kind: k, cls: CLASS[k],
        ph: DEB_RAND() * 6.28,
        sx: (DEB_RAND() - 0.5) * 2, sy: (DEB_RAND() - 0.5) * 2, sz: (DEB_RAND() - 0.5) * 2,
        yaw: DEB_RAND() * 6.28, roll: 0, pitch: 0,
        lat: (DEB_RAND() - 0.5) * 0.9,
        stranded: false, hitCd: 0, onStrand: opts.onStrand || null, dispose: !!opts.dispose,
        inst: opts.inst || null, churn: opts.churn || null,
        vx: 0, vz: 0, x0: x, z0: z, travel: 0, floated: false, piled: false, carried: false, stackY: 0,
        half: 0.3, stackT: 0, body: opts.body || null, home: opts.home || null,
      };
      // its own half-height: what it stands on the ground by (a proxy of an
      // instanced batch has no geometry: the class's draft stands in)
      if (it.inst) it.half = Math.max(0.05, it.cls.sink);
      else if (!it.body && obj && obj.isObject3D) {
        try {
          _hb.setFromObject(obj);
          if (!_hb.isEmpty()) it.half = Math.max(0.05, (_hb.max.y - _hb.min.y) / 2);
        } catch (e) {}
      }
      // a tree turns about the vertical first, so lying down is one pitch
      // whatever heading it has (see restTarget)
      if (k === "log" && obj && obj.rotation && !it.inst) obj.rotation.order = "YXZ";
      items.push(it); entrained++;
      return it;
    }
    const _hb = new THREE.Box3();
    // an instanced piece's obj is a detached proxy: copy its pose into the batch
    function sync(it) {
      const I = it.inst; if (!I) return;
      it.obj.updateMatrix();
      I.mesh.setMatrixAt(I.i, it.obj.matrix);
      I.mesh.instanceMatrix.needsUpdate = true;
    }
    /* ---- AT REST: what the water leaves lies ON the ground ---------------
       A stranded piece used to be put at ground + 0.22 m whatever its pose
       (the tumble's last angles, its origin wherever its builder put it), so
       a tree pivoted at its trunk's middle stood on end half in the street or
       hung with its root plate in the air. Its rest pose now: a TREE lies
       down along the ground (one pitch about its own heading, its trunk on
       the ground, the crown flattened under it); a hull on its bilge;
       anything else on its nearest face (a quarter turn of pitch and roll).
       Its height is measured off its own geometry in that pose, and it gets
       there by falling (gravity), never by a snap, except at strandAll. */
    const HALF_PI = Math.PI / 2;
    const snapQ = function (a) { return Math.round(a / HALF_PI) * HALF_PI; };
    const _rb = new THREE.Box3(), _rm = new THREE.Matrix4(), _rq = new THREE.Quaternion(), _re = new THREE.Euler(), _r0 = new THREE.Vector3();
    // the part a piece stands on: a tree's trunk (the crown gives under it)
    function supportOf(it) {
      const o = it.obj;
      if (it.kind === "log" && o.children && o.children.length) return o.children[0];
      return o;
    }
    // the lowest point of the piece with its origin at y = 0 and rotation q
    function lowAt(it, q) {
      const o = it.obj;
      if (it.inst) {
        const g = it.inst.mesh.geometry;
        if (!g.boundingBox) g.computeBoundingBox();
        _rm.compose(_r0.set(0, 0, 0), q, o.scale);
        _rb.copy(g.boundingBox).applyMatrix4(_rm);
        return _rb.isEmpty() ? -it.half : _rb.min.y;
      }
      const px = o.position.x, py = o.position.y, pz = o.position.z;
      _rq.copy(o.quaternion);
      o.position.set(0, 0, 0); o.quaternion.copy(q); o.updateMatrixWorld(true);
      _rb.setFromObject(supportOf(it));
      let off = 0;
      if (o.parent) { o.parent.updateWorldMatrix(true, false); off = o.parent.matrixWorld.elements[13]; }
      o.position.set(px, py, pz); o.quaternion.copy(_rq); o.updateMatrixWorld(true);
      return _rb.isEmpty() ? -it.half : _rb.min.y - off;
    }
    function restTarget(it) {
      const c = it.cls;
      let px = it.pitch, pz = it.roll;
      const py = it.yaw;
      if (it.kind === "log") { px = (it.sx >= 0 ? 1 : -1) * HALF_PI; pz = 0; }
      else if (c.upright) px = 0;
      else { px = snapQ(px); pz = snapQ(pz); }
      _re.set(px, py, pz, it.obj.rotation.order || "XYZ");
      const q = new THREE.Quaternion().setFromEuler(_re);
      return { q: q, px: px, py: py, pz: pz, base: -lowAt(it, q) };
    }
    // the height its origin rests at here: on the ground (plus whatever it is
    // piled on), or afloat where the sea still stands over the ground
    function restY(it, R) {
      const gnd = groundY(it.x, it.z);
      let ty = gnd + it.stackY + R.base - 0.03;
      const sea = seaY(it.x, it.z);
      if (Number.isFinite(sea) && sea - gnd > it.cls.draft) ty = Math.max(ty, sea - it.cls.sink);
      return ty;
    }
    // one step toward the rest pose; true once it is there
    function settleStep(it, dt, snap) {
      const o = it.obj;
      const R = it.rest || (it.rest = restTarget(it));
      const ty = restY(it, R), y = o.position.y;
      let ny;
      if (snap || y <= ty) { ny = ty; it.fallV = 0; }
      else { it.fallV = Math.min(14, (it.fallV || 0) + 9.8 * dt); ny = Math.max(ty, y - it.fallV * dt); }
      o.position.set(it.x, ny, it.z);
      if (snap) o.quaternion.copy(R.q); else o.quaternion.slerp(R.q, Math.min(1, dt * 4));
      const done = ny <= ty + 1e-3 && (snap || o.quaternion.angleTo(R.q) < 0.02);
      if (done) { o.quaternion.copy(R.q); it.pitch = R.px; it.yaw = R.py; it.roll = R.pz; it.atRest = true; }
      sync(it);
      return done;
    }
    function unrest(it) { it.rest = null; it.atRest = false; it.fallV = 0; }
    let lastStep = performance.now(), idleDone = false;
    const churnMeshes = [];     // the batches + car clones this field made
    const _pose = {};
    let churnLive = 0;

    // ---- THE BATTERING RAM: one piece against the actors in reach ----
    function ram(it, i, speed, dx, dz, sgn) {
      const c = it.cls;
      if (speed < 1.3 || !cfg.forEachActor || !cfg.strike) return;
      const r2 = c.hitR * c.hitR;
      const ix = it.x, iz = it.z, iy = it.obj.position.y;
      cfg.forEachActor(function (a) {
        if (!a || a.dead || !a.pos || it.hitCd > 0) return;
        const ax = a.pos.x - ix, az = a.pos.z - iz;
        if (ax * ax + az * az > r2) return;
        if (Math.abs((a.pos.y || 0) - iy) > 3.2) return;    // a roof is a roof
        it.hitCd = 0.9;
        strikes++;
        const wall = cfg.againstWall ? !!cfg.againstWall(a.pos.x, a.pos.z) : false;
        const cause = it.kind === "car"
          ? (wall ? "crushed against a wall by a drifting car" : "struck by a car inside the tsunami")
          : (wall ? "crushed against a wall by tsunami debris" : "battered by tsunami debris");
        const mul = wall ? 1.85 : 1;      // nowhere to give: the load goes into you
        try {
          cfg.strike(a, {
            kind: it.kind, speed: speed, dirX: dx * sgn, dirZ: dz * sgn,
            force: c.force * (0.6 + Math.min(1.4, speed / 3.4)) * mul,
            damage: c.dmg * (0.5 + Math.min(1.3, speed / 3.2)) * mul,
            cause: cause, wall: wall,
          });
        } catch (e) {}
        kills++;
      });
    }

    /* ---- CARRIED BY THE WATER WHERE IT IS (cfg.flowAt) ------------------
       The run-up field's local current, not one heading for the island:
       a car in a street goes where that street's water goes, swings round
       the corner with it, and comes back down it on the backwash. */
    function stackAt(it) {
      // a grounded piece lands ON whatever already grounded under it
      let top = 0;
      for (let k = 0; k < items.length; k++) {
        const o = items[k];
        if (o === it || !o.obj || !o.stranded || o.churn) continue;
        const r = (o.cls.size + it.cls.size) * 0.45;
        const dx = o.x - it.x, dz = o.z - it.z;
        if (dx * dx + dz * dz > r * r) continue;
        const t = o.stackY + (o.cls.sink * 2 + 0.35);
        if (t > top) top = t;
      }
      return Math.min(3.2, top);
    }
    function flowStep(it, i, dt) {
      const c = it.cls;
      const w = flowAt(it.x, it.z, _fl);
      const depth = w && Number.isFinite(w.depth) ? w.depth : 0;
      if (it.hitCd > 0) it.hitCd -= dt;
      const floats = depth >= c.draft;
      if (floats) {
        // it takes up the current at its own rate (inertia), and keeps a
        // little of its own sideways drift so a raft of wreckage spreads
        const k = Math.min(1, dt * c.relax);
        it.vx += ((w.u || 0) * c.drift - it.vx) * k;
        it.vz += ((w.v || 0) * c.drift - it.vz) * k;
        if (!it.floated) { it.floated = true; it.stranded = false; }
        it.stranded = false;
        if (it.rest || it.atRest) unrest(it);
      } else {
        // GROUNDED: the bottom takes its speed off in a second; a strong
        // enough current still shoves it along the street (a car dragged on
        // its wheels), anything less and it stays where the water left it
        const push = depth > c.draft * 0.5 ? depth * ((w.u || 0) * (w.u || 0) + (w.v || 0) * (w.v || 0)) : 0;
        const k = Math.min(1, dt * 3.5);
        if (push > 6 * c.draft) {
          it.vx += ((w.u || 0) * 0.35 - it.vx) * k; it.vz += ((w.v || 0) * 0.35 - it.vz) * k;
        } else { it.vx -= it.vx * k; it.vz -= it.vz * k; }
      }
      let sp = Math.hypot(it.vx, it.vz);
      // a piece goes with the water, never faster than a bore runs inland
      if (sp > MAX_SP) { it.vx *= MAX_SP / sp; it.vz *= MAX_SP / sp; sp = MAX_SP; }
      if (sp > 0.02) {
        let nx = it.x + it.vx * dt, nz = it.z + it.vz * dt;
        // THE PILE: a wall stops it, and a piece already stopped at the wall
        // stops the next one (their footprints, not a grid)
        if (blockedAt) {
          const lead = c.size * 0.55 / sp;
          const hx = blockedAt(it.x + it.vx * (dt + lead), it.z);
          const hz = blockedAt(it.x, it.z + it.vz * (dt + lead));
          if (hx) { nx = it.x; it.vx *= -0.08; }
          if (hz) { nz = it.z; it.vz *= -0.08; }
          if ((hx || hz) && !it.piled) { it.piled = true; piled++; }
        }
        const moved = Math.hypot(nx - it.x, nz - it.z);
        it.x = nx; it.z = nz;
        it.travel += moved;
        if (moved > 1e-3 && !floats) it.atRest = false;      // dragged on: the ground under it changed
        if (!it.carried && floats && Math.hypot(it.x - it.x0, it.z - it.z0) > 3) { it.carried = true; carried++; }
      }
      const gnd = groundY(it.x, it.z);
      if (!floats) {
        if (!it.stranded) {
          it.stranded = true;
          it.stackY = stackAt(it);
          // a hull comes to rest on its bilge, a car on whatever side it was
          if (c.upright) it.roll = (it.ph > 3.14 ? 1 : -1) * (0.35 + 0.25 * (it.ph % 1));
          if (it.onStrand) { try { it.onStrand(it); } catch (e) {} }
        }
        /* WHAT IT LIES ON CAN LEAVE. stackY used to be read once, when it
           grounded: the piece under it refloated or was hauled off and this
           one stayed up on nothing. Twice a second the pile is read again
           and it may only come DOWN (eased below). */
        it.stackT += dt;
        if (it.stackT > 0.5) {
          it.stackT = 0;
          if (it.stackY > 0) { const ns = Math.min(it.stackY, stackAt(it)); if (ns < it.stackY - 0.01) it.atRest = false; it.stackY = ns; }
        }
        /* Never lifted yet (a boat lying where the drawdown left it): where it
           lies, but only if that is ON the ground. It used to be held at the
           height it was taken at forever, and a wall taken off an upper
           storey of a house that then went down hung in the air there. */
        if (!it.floated && it.y0 != null) {
          const y = it.obj.position.y;
          const hold = it.y0 - it.half - gnd > 0.5 ? Math.max(gnd + it.half, y - dt * 6) : it.y0;
          it.obj.position.set(it.x, hold, it.z);
          it.obj.rotation.set(it.pitch, it.yaw, it.roll);
          sync(it);
          return;
        }
        if (!it.atRest) settleStep(it, dt, false);
        return;
      }
      it.stackY = 0;
      /* THE WATER IT IS IN, not the sea's. floats was decided on the LOCAL
         depth (the run-up field) but the piece was drawn at seaY - its draft:
         the shared sea surface, which at the tsunami's peak stands metres
         over a street the run-up field has only ankle-deep. The surface it
         rides is the ground under it plus the depth that floated it. */
      const surf = Math.min(seaY(it.x, it.z), gnd + depth);
      const bob = Math.sin((CBZ.now || 0) * 0.005 + it.ph) * (c.upright ? 0.12 : 0.22);
      it.obj.position.set(it.x, Math.max(gnd + 0.1, surf - c.sink + bob), it.z);
      if (c.upright) {
        // a hull rights itself and weathercocks into the current
        const k = Math.min(1, dt * 1.6);
        it.pitch += (Math.sin((CBZ.now || 0) * 0.0021 + it.ph) * 0.06 - it.pitch) * k;
        it.roll += (Math.sin((CBZ.now || 0) * 0.0017 + it.ph * 2) * 0.09 - it.roll) * k;
        if (sp > 0.3) {
          let dy = Math.atan2(it.vx, it.vz) - it.yaw;
          dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          it.yaw += dy * Math.min(1, dt * 0.9);
        }
      } else {
        // TUMBLING, not floating: the rate follows the water's speed
        const tumble = Math.min(2.4, sp * 0.34) * c.spin * dt;
        it.yaw += it.sy * tumble;
        it.pitch += it.sx * tumble * 0.55;
        it.roll += it.sz * tumble * 0.7;
      }
      it.obj.rotation.set(it.pitch, it.yaw, it.roll);
      sync(it);
      if (checkPhase !== (i % 3) || it.hitCd > 0 || sp < 1.3) return;
      ram(it, i, sp, it.vx / sp, it.vz / sp, 1);
    }

    /* A PIECE OF A BUILDING IS A BODY (2026-10-15). It falls, collides,
       piles and is carried by the water medium below in systems/debris.js;
       this field only asks where it is and how fast, for the battering ram. */
    function bodyStep(it, i) {
      const b = it.body, m = b.mesh;
      if (!m || !m.parent) { it.obj = null; it.body = null; return; }
      const p = m.position;
      it.travel += Math.hypot(p.x - it.x, p.z - it.z);
      it.x = p.x; it.z = p.z;
      if (!it.carried && Math.hypot(it.x - it.x0, it.z - it.z0) > 3) { it.carried = true; carried++; }
      it.stranded = !!b.asleep;
      const sp = Math.hypot(b.v.x, b.v.z);
      if (checkPhase !== (i % 3) || it.hitCd > 0 || sp < 1.3) return;
      ram(it, i, sp, b.v.x / sp, b.v.z / sp, 1);
    }

    /* THE WATER, as a fluid for every loose body (CBZ.debris.medium): the
       run-up field's local depth and current where it has one, else the sea
       over the ground and the event's flow. Registered while this field has
       a flood to carry things in. */
    const _mw = {};
    let envDx = 1, envDz = 0, envFlow = 0, mediumOn = false;
    function waterAt(x, y, z, out) {
      const g = groundY(x, z);
      if (flowAt) {
        const w = flowAt(x, z, _mw);
        const d = w && Number.isFinite(w.depth) ? w.depth : 0;
        if (d < 0.05) return false;
        out.surf = g + d; out.vx = w.u || 0; out.vz = w.v || 0; out.vy = 0; out.rho = 1000;
        return true;
      }
      const sy = seaY(x, z);
      if (!(sy - g > 0.05)) return false;
      out.surf = sy; out.vx = envDx * envFlow; out.vz = envDz * envFlow; out.vy = 0; out.rho = 1000;
      return true;
    }
    function medium(on) {
      if (on === mediumOn || !CBZ.debris || !CBZ.debris.medium) return;
      mediumOn = on;
      CBZ.debris.medium("tsunami", on ? waterAt : null);
    }
    medium(true);

    const api = {
      /* A REAL PIECE OF A BUILDING into the water: the shared body sim takes
         it whole (its own triangles, its own material; the merged shell it
         was drawn in lets it go), and the water carries it as a force. */
      takePiece(obj, kind) {
        if (!obj) return null;
        if (!CBZ.debris || !CBZ.debris.adopt) return api.takeWorld(obj, kind);
        let v;
        if (flowAt) {
          const wp = obj.getWorldPosition(new THREE.Vector3());
          const w = flowAt(wp.x, wp.z, _mw);
          if (w && w.depth > 0.05) v = { x: (w.u || 0) * 0.5, y: 0.4, z: (w.v || 0) * 0.5 };
        }
        let r = null;
        try { r = CBZ.debris.adopt(obj, { whole: "all", owner: "tsunami", maxLife: 120, velocity: v }); } catch (e) { r = null; }
        const body = r && r.live && r.live[0];
        if (!body) return null;
        const p = body.mesh.position;
        return add(body.mesh, p.x, p.z, kind, { body: body });
      },
      /* ENTRAIN A REAL WORLD OBJECT. The caller has already taken it out of
         whatever system owned it (pulled its collider, marked the record dead)
         — this only takes over where it is drawn. */
      take(obj, x, z, kind, opts) { return obj ? add(obj, x, z, kind, opts) : null; },

      /* ENTRAIN A REAL OBJECT WHERE IT STANDS. Re-parents it to the field's
         root with its world transform preserved (Object3D.attach), starts the
         tumble from the pose it actually had, and drives it from there. This
         is how a wall still bolted to its house or a trunk still planted in
         the ground steps out of its builder's group and into the water. */
      takeWorld(obj, kind, opts) {
        if (!obj || !root) return null;
        const wp = obj.getWorldPosition(new THREE.Vector3());
        // where it stood, so the reset puts it back
        const home = { parent: obj.parent, p: obj.position.clone(), q: obj.quaternion.clone(), s: obj.scale.clone(), vis: obj.visible };
        if (obj.parent !== root) root.attach(obj);
        const it = add(obj, wp.x, wp.z, kind, Object.assign({ home: home }, opts || {}));
        it.yaw = obj.rotation.y; it.pitch = obj.rotation.x; it.roll = obj.rotation.z;
        it.y0 = obj.position.y;
        return it;
      },

      /* ONE FRAME OF THE FLOW. env: {dx, dz, flow (m/s, signed — negative is
         the undertow), sediment}. Everything reads the SHARED surface, so an
         object stops being carried the instant the water under it is gone. */
      step(dt, env) {
        env = env || {};
        const dx = Number.isFinite(env.dx) ? env.dx : 1, dz = Number.isFinite(env.dz) ? env.dz : 0;
        const flow = Number.isFinite(env.flow) ? env.flow : 0;
        envDx = dx; envDz = dz; envFlow = flow;
        lastStep = performance.now(); idleDone = false;
        checkPhase = (checkPhase + 1) % 3;
        for (let i = 0; i < items.length; i++) {
          const it = items[i], c = it.cls;
          if (!it.obj) continue;
          if (it.body) { if (it.hitCd > 0) it.hitCd -= dt; bodyStep(it, i); continue; }
          if (it.churn) {
            const F = env.front;
            if (F && !(Number.isFinite(F.land) && F.land >= it.churn.rel)) {
              // RIDING THE TOE: pinned to the foot, surging, rolling hard
              churnPose(F, it.churn, _pose);
              it.x = _pose.x; it.z = _pose.z; it.churn.posed = true;
              const heave = Math.sin((CBZ.now || 0) * 0.007 + it.ph) * 0.35 * _pose.depthK;
              it.obj.position.set(it.x, Math.max(groundY(it.x, it.z) + 0.2, _pose.y - c.sink * 0.6 + heave), it.z);
              const roll = (1.2 + 1.6 * _pose.depthK) * c.spin * 0.45 * dt;
              it.yaw += it.sy * roll * 0.6; it.pitch += (0.6 + Math.abs(it.sx)) * roll; it.roll += it.sz * roll * 0.8;
              it.obj.rotation.set(it.pitch, it.yaw, it.roll);
              sync(it);
              it.stranded = false;
              if (it.hitCd > 0) it.hitCd -= dt;
              if (checkPhase === (i % 3) && it.hitCd <= 0) ram(it, i, Math.max(2, Math.abs(F.v || 0)), F.dx, F.dz, 1);
              continue;
            }
            // it falls out of the churn here and becomes flood-borne wreckage
            // (a piece the front never carried has no place in the world: drop it)
            const posed = it.churn.posed;
            it.churn = null; churnLive--;
            if (!posed) { if (!it.inst) it.obj.visible = false; it.obj = null; continue; }
            // from here it is ordinary wreckage, moving at the toe's speed
            it.x0 = it.x; it.z0 = it.z; it.floated = true;
            if (F) { const fv = Math.min(7, Math.abs(F.v || 0) * 0.5); it.vx = F.dx * fv; it.vz = F.dz * fv; }
          }
          if (flowAt) { flowStep(it, i, dt); continue; }
          const surf = seaY(it.x, it.z), gnd = groundY(it.x, it.z);
          const depth = surf - gnd;
          if (it.hitCd > 0) it.hitCd -= dt;
          if (depth < 0.4) {
            // STRANDED. The water that carried it here has gone; it stays
            // exactly where it stopped, which is the aftermath photograph.
            if (!it.stranded) {
              it.stranded = true;
              it.obj.rotation.set(it.pitch, it.yaw, it.roll);
              if (it.onStrand) { try { it.onStrand(it); } catch (e) {} }
            }
            if (!it.atRest) settleStep(it, dt, false);
            continue;
          }
          it.stranded = false;
          if (it.rest || it.atRest) unrest(it);
          const v = Math.max(-MAX_SP, Math.min(MAX_SP, flow * c.drift));
          const step2 = v * dt;
          it.x += dx * step2 - dz * it.lat * dt * Math.abs(v) * 0.25;
          it.z += dz * step2 + dx * it.lat * dt * Math.abs(v) * 0.25;
          // ride the surface, sunk by its own mass, heaving on the churn
          const bob = Math.sin((CBZ.now || 0) * 0.005 + it.ph) * 0.22;
          it.obj.position.set(it.x, surf - c.sink + bob, it.z);
          // TUMBLING, not floating: rotation rate follows the water's speed,
          // so a bore rolls a car over and a slack pool merely turns it.
          const tumble = Math.min(2.4, Math.abs(v) * 0.34) * c.spin * dt;
          it.yaw += it.sy * tumble;
          it.pitch += it.sx * tumble * 0.55;
          it.roll += it.sz * tumble * 0.7;
          it.obj.rotation.set(it.pitch, it.yaw, it.roll);
          sync(it);

          // ---- THE BATTERING RAM ----
          if (checkPhase !== (i % 3) || it.hitCd > 0) continue;
          ram(it, i, Math.abs(v), dx, dz, Math.sign(v || 1));
        }
      },
      /* LOAD THE TOE. opts: {cars: [Mesh templates — the world's own car
         meshes, geometry + material shared, never cloned], nCars, nBoards,
         nPallets, nRoofs, halfW (m of front the load spreads over)}. Once per
         field; the pieces ride env.front in step() until env.front.land
         passes each piece's own release point (or env.front is gone). */
      churn(opts) {
        opts = opts || {};
        if (churnMeshes.length || !root) return 0;
        const K = buildChurnKit(); if (!K) return 0;
        const halfW = Math.max(10, opts.halfW || 120);
        const made = [];
        const place = function (obj, kind, inst) {
          const lane = (made.length * 0.618034) % 1;           // spread evenly, not clumped
          const it = add(obj, 0, 0, kind, {
            dispose: !inst, inst: inst,
            churn: {
              f: DEB_RAND() * 0.75, l: (lane * 2 - 1) * halfW + (DEB_RAND() - 0.5) * 6,
              ph: DEB_RAND() * 6.28, fw: DEB_RAND(),
              rel: 0.12 + 0.8 * DEB_RAND(),
            },
          });
          it.pitch = DEB_RAND() * 6.28; it.roll = (DEB_RAND() - 0.5) * 2;
          it.obj.visible = false;                    // until its first pose
          made.push(it); churnLive++;
          return it;
        };
        const batch = function (geo, n, tints) {
          if (n <= 0) return null;
          const m = new THREE.InstancedMesh(geo, K.mat, n);
          m.name = "tsunami churn";
          m.frustumCulled = false;                   // instances roam far past the geometry's bounds
          m.castShadow = false; m.receiveShadow = true;
          const col = new THREE.Color();
          for (let i = 0; i < n; i++) {
            col.copy(lin(tints[(DEB_RAND() * tints.length) | 0]));
            m.setColorAt(i, col);
            const proxy = new THREE.Object3D();
            proxy.position.set(0, -1e4, 0); proxy.updateMatrix();
            m.setMatrixAt(i, proxy.matrix);
          }
          if (m.instanceColor) m.instanceColor.needsUpdate = true;
          root.add(m); churnMeshes.push(m);
          return m;
        };
        const nB = opts.nBoards != null ? opts.nBoards : 14;
        const nP = opts.nPallets != null ? opts.nPallets : 7;
        const nR = opts.nRoofs != null ? opts.nRoofs : 3;
        const nK = opts.nContainers != null ? opts.nContainers : 3;
        const mB = batch(K.board, nB, BOARD_TINTS), mP = batch(K.pallet, nP, PALLET_TINTS), mR = batch(K.roof, nR, ROOF_TINTS);
        const mK = batch(K.container, nK, CONTAINER_TINTS);
        for (let i = 0; i < nB; i++) place(new THREE.Object3D(), "panel", { mesh: mB, i: i });
        for (let i = 0; i < nP; i++) place(new THREE.Object3D(), "panel", { mesh: mP, i: i });
        for (let i = 0; i < nR; i++) place(new THREE.Object3D(), "panel", { mesh: mR, i: i });
        for (let i = 0; i < nK; i++) place(new THREE.Object3D(), "container", { mesh: mK, i: i });
        const tpl = (opts.cars || []).filter(function (t) { return t && t.geometry && t.material; });
        const nC = tpl.length ? (opts.nCars != null ? opts.nCars : 6) : 0;
        for (let i = 0; i < nC; i++) {
          const t = tpl[i % tpl.length];
          const m = new THREE.Mesh(t.geometry, t.material);   // shared, never copied
          m.castShadow = false; m.receiveShadow = true;
          m.rotation.order = "YXZ";
          root.add(m); churnMeshes.push(m);
          place(m, "car", null);
        }
        // the proxies' first pose is written by step(); show the real meshes then
        for (let i = 0; i < made.length; i++) if (!made[i].inst) made[i].obj.visible = true;
        return made.length;
      },

      strandAll() {
        medium(false);                       // the water has gone: nothing carries a body now
        for (let i = 0; i < items.length; i++) {
          const it = items[i]; if (!it.obj || it.body) continue;
          if (it.churn) {
            const posed = it.churn.posed;
            it.churn = null; churnLive--;
            if (!posed) { if (!it.inst) it.obj.visible = false; it.obj = null; continue; }
          }
          it.stackY = 0;
          unrest(it);
          settleStep(it, 0, true);
          it.stranded = true; it.floated = true;
        }
      },
      // when nothing steps the field any more: every piece comes down
      lastStep: function () { return lastStep; },
      idle(dt) {
        if (idleDone) return;
        let all = true;
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (!it.obj || it.body) continue;
          if (it.churn) {
            const posed = it.churn.posed;
            it.churn = null; churnLive--;
            if (!posed) { if (!it.inst) it.obj.visible = false; it.obj = null; continue; }
          }
          if (!it.floated && it.y0 != null && !it.stranded) continue;   // never lifted: where it was
          if (!it.stranded) { it.stranded = true; it.stackY = stackAt(it); unrest(it); }
          it.vx = it.vz = 0;
          if (!it.atRest && !settleStep(it, dt, false)) all = false;
        }
        if (all) idleDone = true;
      },
      // at once (tools, a reset that keeps the wreckage): every piece at rest
      settleAll() {
        let n = 0;
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (!it.obj || it.body || it.churn || it.atRest) continue;
          if (!it.floated && it.y0 != null && !it.stranded) continue;
          it.stranded = true; it.vx = it.vz = 0;
          unrest(it); settleStep(it, 0, true); n++;
        }
        return n;
      },
      /* THE AUDIT (CBZ.debrisAuditSources.tsunami): a stranded piece of this
         field's own (bodies are debris.js's to count) whose bottom is more
         than half a metre over the ground plus whatever it is piled on. */
      /* Measured off the piece's own geometry where it is now (the old test
         took the half-height it had when it was picked up, so a tree that had
         turned over read as resting whatever it hung on). A piece still
         afloat while its water is being stepped is `afloat`, not floating;
         once the field is idle, everything counts. */
      auditInto(out, o) {
        const high = o.high || 120, fast = o.fast || 30;
        const idle = performance.now() - lastStep > IDLE_MS;
        if (out.afloat == null) out.afloat = 0;
        if (out.trees == null) out.trees = 0;
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (!it.obj || it.body || it.churn) continue;
          if (!it.inst && !it.obj.parent) continue;
          out.items++;
          const y = it.obj.position.y, gnd = groundY(it.x, it.z);
          const sp = Math.hypot(it.vx, it.vz);
          if (sp > out.maxSpeed) out.maxSpeed = +sp.toFixed(1);
          if (sp > fast) out.fast++;
          const h = y - gnd;
          if (h > out.maxHeight) out.maxHeight = +h.toFixed(1);
          if (h > high) out.high++;
          if (!it.stranded && !idle) { out.afloat++; continue; }
          if (!it.floated && it.y0 != null && !it.stranded) continue;      // never lifted
          const sea = seaY(it.x, it.z);
          if (Number.isFinite(sea) && sea - gnd > it.cls.draft) continue;  // afloat on standing water
          let low;
          if (it.inst) low = y + lowAt(it, it.obj.quaternion);
          else {
            it.obj.updateMatrixWorld(true);
            _rb.setFromObject(supportOf(it));
            low = _rb.isEmpty() ? y - it.half : _rb.min.y;
          }
          const gap = low - (gnd + stackAt(it));
          if (gap > 0.5) {
            out.floating++;
            if (it.kind === "log") out.trees++;
            if (out.list.length < 6) out.list.push({ kind: it.kind, x: +it.x.toFixed(1), y: +y.toFixed(1), z: +it.z.toFixed(1), gap: +gap.toFixed(2), atRest: !!it.atRest });
          }
        }
      },
      count() { return items.length; },
      stats() {
        let maxTravel = 0, floating = 0, grounded = 0, cars = 0, boats = 0, moved = 0;
        const byKind = {};
        for (let i = 0; i < items.length; i++) {
          const it = items[i]; if (!it.obj || it.churn) continue;
          const d = Math.hypot(it.x - it.x0, it.z - it.z0);
          if (d > 1) moved++;
          if (it.travel > maxTravel) maxTravel = it.travel;
          if (it.stranded) grounded++; else floating++;
          if (it.carried && it.kind === "car") cars++;
          if (it.carried && it.kind === "boat") boats++;
          byKind[it.kind] = (byKind[it.kind] || 0) + 1;
        }
        return { entrained: entrained, strikes: strikes, kills: kills, live: items.length, churn: churnLive, churnMeshes: churnMeshes.length,
          moved: moved, carried: carried, carsCarried: cars, boatsCarried: boats, piled: piled, floating: floating, grounded: grounded,
          maxTravelM: Math.round(maxTravel * 10) / 10, byKind: byKind };
      },
      items: function () { return items; },
      /* Drops the field's TRACKING, not the world. Everything entrained was a
         real object, and a real object stranded by the drain is aftermath —
         it stays exactly where the water left it, owned again by the scene it
         came from. Only items explicitly flagged `dispose` (none, today) are
         removed; there are no pooled fakes left to destroy. */
      dispose() {
        medium(false);
        liveFields.delete(api);
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (it.body) continue;                     // debris.js owns it (owner 'tsunami')
          if (it.dispose && it.obj && it.obj.parent) { it.obj.parent.remove(it.obj); continue; }
          /* A WORLD OBJECT GOES HOME. A hull or a container the field lifted
             off the harbour used to stay wherever the last flood left it, in
             the field's root, untracked, for every match after. */
          const H = it.home;
          if (H && it.obj) {
            const o = it.obj;
            if (H.parent && o.parent !== H.parent) H.parent.add(o);
            o.position.copy(H.p); o.quaternion.copy(H.q); o.scale.copy(H.s); o.visible = H.vis;
            o.updateMatrixWorld(true);
          }
        }
        // the churn's own batches (geometry + material stay in the page kit)
        for (let i = 0; i < churnMeshes.length; i++) {
          const m = churnMeshes[i];
          if (m.parent) m.parent.remove(m);
          if (m.isInstancedMesh && m.dispose) m.dispose();
        }
        churnMeshes.length = 0; churnLive = 0;
        items.length = 0;
      },
    };
    liveFields.add(api);
    return api;
  };

})();
