/* ============================================================
   entities/handcuffs.js — CBZ.handcuffs: THE ONE PAIR OF HANDCUFFS.

   Owner: "fix the appearance of handcuffs". What every cuffed wrist wore
   was a 4-sided torus on each forearm and a 3.5 cm BOX between them that
   stretched to whatever length the wrists were apart — it read as a stick
   through the man's back. This is a real pair of hinged chain cuffs, in
   METRES, at real size:

     each cuff   the SWING ARM (one strand, ~5 mm steel, the ratchet end that
                 goes into the lock) on a hinge rivet, the DOUBLE-STRAND FRAME
                 (two thin plates the swing arm passes between) ending in the
                 LOCK BOX, and the SWIVEL on the far end of the lock box
     the chain   three interlocked oval links between the two swivels,
                 CHAIN_LEN (5.5 cm) swivel eye to swivel eye, NEVER stretched
                 past 1.2x: the cuffs turn on the wrists (they do on a real
                 wrist) so the swivels sit a chain's length apart

   The ring is sized to the wrist it closes on (a ratchet cuff closes to the
   wrist, 5.2 .. 8.6 cm inside) and everything else is steel at real size.
   Frame of one cuff: ring axis +Y (a forearm's own axis), the lock box and
   swivel toward +X, ring centre at the origin.

     CBZ.handcuffs.build({ r, open })  -> THREE.Group, a pair: userData
          { cuffs: [A, B], chain, links, r }. A and B are separate children
          (so either can be re-parented onto a wrist) and so is the chain.
     CBZ.handcuffs.buildOpen(opts)     -> a pair with both swing arms open
          (in an officer's hand)
     CBZ.handcuffs.setOpen(cuff, k)    -> swing arm open k (0 closed .. 1 open)
     CBZ.handcuffs.swivel(cuff, out)   -> the swivel eye, world space
     CBZ.handcuffs.seatChain(pair, a, b, down, k)  re-seat the links between
          two points in the chain's parent frame (sagging when there is slack)
     CBZ.handcuffs.material()          -> the one shared nickel material

   Geometry is shared (one ring set per millimetre of radius, one link),
   materials are shared, nothing casts a shadow, no lights. (The closed cuff
   case on a duty belt is entities/dutykit.js's.)
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  if (CBZ.handcuffs && CBZ.handcuffs.version) return;

  // ---- real dimensions, metres ----------------------------------------------
  const DIM = {
    R_IN: 0.0325,        // inside radius of a closed cuff on an average wrist (6.5 cm)
    R_MIN: 0.026,        // the ratchet closes no further (5.2 cm inside)
    R_MAX: 0.043,        // nor opens wider than this and still lock (8.6 cm)
    SWING: 0.0026,       // swing arm: one strand, ~5 mm round
    FRAME: 0.0016,       // each of the two frame plates
    FRAME_GAP: 0.0034,   // the frame plates sit either side of the swing arm (+-y)
    LOCK_X: 0.024,       // lock box: radial length
    LOCK_Y: 0.012,       //           thickness (along the wrist)
    LOCK_Z: 0.020,       //           width
    HINGE_A: -2.55,      // where the swing arm pivots, radians round the ring from the lock box
    EYE_R: 0.0042,       // swivel eye (a small ring the first link goes through)
    EYE_T: 0.0014,
    LINK_R: 0.0052,      // chain link: torus radius, then stretched LINK_S along its length
    LINK_T: 0.0015,
    LINK_S: 1.45,
  };
  const CHAIN_LEN = 0.055;            // swivel eye to swivel eye, metres
  const LINKS = 3;
  const OPEN_ANGLE = 2.3;             // how far an open swing arm stands out (rad)
  const PI = Math.PI;

  // ---- materials -------------------------------------------------------------
  let _nickel = null;
  function material() {
    if (_nickel) return _nickel;
    // Phong, the way the wristwatch shades its steel: a bright nickel that
    // reads as metal under any light without an environment map
    _nickel = new THREE.MeshPhongMaterial({ color: 0xc6ccd3, specular: 0xf2f4f8, shininess: 90 });
    _nickel._shared = true;
    _nickel.name = "handcuff-nickel";
    return _nickel;
  }

  // ---- geometry (shared) -----------------------------------------------------
  const G = {};
  function shared(g) { g._shared = true; return g; }
  // an arc of round bar in the XZ plane, centre radius R, from angle a0 (from
  // +X toward +Z) through `arc` radians, bar radius t, lifted y
  function arcGeo(R, t, a0, arc, y, seg, rad) {
    const g = new THREE.TorusGeometry(R, t, rad || 6, seg || 12, arc);
    g.rotateX(PI / 2);                 // (cos a, sin a, 0) -> (cos a, 0, sin a)
    g.rotateY(-a0);                    // start at a0
    if (y) g.translate(0, y, 0);
    return g;
  }
  function mergeInto(list) {
    // three r128 has BufferGeometryUtils only as an example script: merge by hand
    let nv = 0, ni = 0;
    for (const g of list) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
    const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), I = new (nv > 65535 ? Uint32Array : Uint16Array)(ni);
    let vo = 0, io = 0;
    for (const g of list) {
      const p = g.attributes.position.array, n = g.attributes.normal.array, c = g.attributes.position.count;
      P.set(p, vo * 3); N.set(n, vo * 3);
      if (g.index) { const ix = g.index.array; for (let i = 0; i < ix.length; i++) I[io + i] = ix[i] + vo; io += ix.length; }
      else { for (let i = 0; i < c; i++) I[io + i] = vo + i; io += c; }
      vo += c;
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(P, 3));
    out.setAttribute("normal", new THREE.BufferAttribute(N, 3));
    out.setIndex(new THREE.BufferAttribute(I, 1));
    out.computeBoundingSphere(); out.computeBoundingBox();
    return shared(out);
  }
  // the centre radius the bars run on, for a cuff that closes to inside radius r
  function midR(r) { return r + DIM.SWING; }
  function ringKey(r) { return Math.round(r * 2000) / 2000; }            // half-millimetre steps
  /* one cuff, closed on inside radius r: { frame, swing } geometries. The
     frame (both plates, the lock box, the swivel boss and eye, the hinge
     rivet) is one mesh; the swing arm is another, built about its hinge so
     it can swing open. */
  function cuffGeo(r) {
    r = Math.max(DIM.R_MIN, Math.min(DIM.R_MAX, r || DIM.R_IN));
    const key = ringKey(r);
    if (G[key]) return G[key];
    const R = midR(r);
    const ha = DIM.HINGE_A;                             // hinge (negative: round through -Z)
    const parts = [];
    // the double-strand frame: from the hinge round (through -Z) into the lock box
    const farc = -0.18 - ha;
    parts.push(arcGeo(R, DIM.FRAME, ha, farc, DIM.FRAME_GAP, 10, 4));
    parts.push(arcGeo(R, DIM.FRAME, ha, farc, -DIM.FRAME_GAP, 10, 4));
    // the lock box: sits across the ring at angle 0, reaching out to the swivel
    const box = new THREE.BoxGeometry(DIM.LOCK_X, DIM.LOCK_Y, DIM.LOCK_Z);
    box.translate(R + DIM.LOCK_X / 2 - 0.004, 0, 0);
    parts.push(box);
    // keyhole boss on the lock box face (a short round stub on +Y)
    const key1 = new THREE.CylinderGeometry(0.0022, 0.0022, 0.0012, 8, 1, true);
    key1.translate(R + DIM.LOCK_X * 0.55, DIM.LOCK_Y / 2 + 0.0006, 0);
    parts.push(key1);
    // hinge rivet through the frame plates
    const riv = new THREE.CylinderGeometry(0.0024, 0.0024, DIM.FRAME_GAP * 2 + DIM.FRAME * 2.4, 8);
    riv.translate(Math.cos(ha) * R, 0, Math.sin(ha) * R);
    parts.push(riv);
    // the swivel: a boss on the end of the lock box and the eye the chain hangs from
    const sx = R + DIM.LOCK_X - 0.004;
    const boss = new THREE.CylinderGeometry(0.0034, 0.0034, 0.004, 8);
    boss.rotateZ(PI / 2); boss.translate(sx + 0.002, 0, 0);
    parts.push(boss);
    const eye = new THREE.TorusGeometry(DIM.EYE_R, DIM.EYE_T, 4, 8);  // in XY: the eye stands along the chain
    eye.translate(sx + 0.004 + DIM.EYE_R, 0, 0);
    parts.push(eye);
    const frame = mergeInto(parts);
    // the swing arm: its toothed end inside the lock box (just short of angle
    // 0), round the other side (through +Z) to the hinge; built about the
    // hinge so it swings open (setOpen)
    const s0 = -0.05, sarc = (2 * PI + ha) - s0;
    const sw = arcGeo(R, DIM.SWING, s0, sarc, 0, 16);
    sw.translate(-Math.cos(ha) * R, 0, -Math.sin(ha) * R);          // pivot at the hinge
    const swing = shared(sw);
    swing.computeBoundingSphere();
    const g = G[key] = { frame: frame, swing: swing, r: r, R: R, hinge: new THREE.Vector3(Math.cos(ha) * R, 0, Math.sin(ha) * R), eyeX: sx + 0.004 + DIM.EYE_R };
    return g;
  }
  let _linkGeo = null;
  function linkGeo() {
    if (_linkGeo) return _linkGeo;
    const g = new THREE.TorusGeometry(DIM.LINK_R, DIM.LINK_T, 5, 10);   // in XY, axis Z
    g.scale(1, DIM.LINK_S, 1);                                          // long along +Y
    _linkGeo = shared(g);
    return _linkGeo;
  }
  // where the swivel eye of a cuff of inside radius r sits (cuff frame, +X)
  function eyeX(r) { return cuffGeo(r).eyeX; }

  // ---- building --------------------------------------------------------------
  function buildCuff(r) {
    const cg = cuffGeo(r), m = material();
    const cuff = new THREE.Group();
    cuff.name = "handcuff";
    const frame = new THREE.Mesh(cg.frame, m);
    frame.name = "handcuff-frame"; frame.castShadow = false; frame.receiveShadow = false;
    cuff.add(frame);
    const pivot = new THREE.Group();
    pivot.name = "handcuff-hinge";
    pivot.position.copy(cg.hinge);
    const sw = new THREE.Mesh(cg.swing, m);
    sw.name = "handcuff-swing"; sw.castShadow = false; sw.receiveShadow = false;
    pivot.add(sw);
    cuff.add(pivot);
    cuff.userData.handcuff = { r: cg.r, eyeX: cg.eyeX, pivot: pivot, open: 0 };
    return cuff;
  }
  function setOpen(cuff, k) {
    const u = cuff && cuff.userData.handcuff;
    if (!u) return;
    k = k < 0 ? 0 : k > 1 ? 1 : k;
    u.open = k;
    // the swing arm swings out about the hinge, away from the ring centre
    u.pivot.rotation.y = OPEN_ANGLE * k;
  }
  function buildChain() {
    const chain = new THREE.Group();
    chain.name = "handcuff-chain";
    const g = linkGeo(), m = material(), links = [];
    for (let i = 0; i < LINKS; i++) {
      const l = new THREE.Mesh(g, m);
      l.name = "handcuff-link"; l.castShadow = false; l.receiveShadow = false;
      chain.add(l); links.push(l);
    }
    chain.userData.links = links;
    return chain;
  }
  /* A closed pair, laid out straight: cuff A at the origin, its swivel toward
     +X, the chain, then cuff B turned to face it. opts.r = inside radius (m). */
  function build(opts) {
    opts = opts || {};
    const r = Math.max(DIM.R_MIN, Math.min(DIM.R_MAX, opts.r || DIM.R_IN));
    const pair = new THREE.Group();
    pair.name = "handcuffs";
    const A = buildCuff(r), B = buildCuff(r);
    A.name = "handcuff-A"; B.name = "handcuff-B";
    const ex = eyeX(r);
    // B sits a chain's length past A's eye, turned round (its eye toward A)
    B.position.set(ex * 2 + CHAIN_LEN * 0.96, 0, 0);
    B.rotation.y = PI;
    pair.add(A); pair.add(B);
    const chain = buildChain();
    pair.add(chain);
    pair.userData.handcuffs = { cuffs: [A, B], chain: chain, links: chain.userData.links, r: r };
    _a.set(ex, 0, 0); _b.set(B.position.x - ex, 0, 0); _d.set(0, -1, 0);
    seatChain(pair, _a, _b, _d, 1);
    if (opts.open) { setOpen(A, opts.open); setOpen(B, opts.open); }
    return pair;
  }
  function buildOpen(opts) {
    const p = build(Object.assign({}, opts || {}, { open: 1 }));
    p.name = "handcuffs-open";
    return p;
  }

  /* ---- THE CHAIN, RE-SEATED. a, b: the two swivel eyes in the chain's
     parent frame; down: which way slack hangs (parent frame); k: metres of
     the parent frame per real metre (the chain's own scale). The links keep
     their length: with slack they hang in a shallow arc, pulled apart they
     space out, never more than 1.2x. Allocation-free. */
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();
  const _c = new THREE.Vector3(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _t = new THREE.Vector3();
  const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _Y = new THREE.Vector3(0, 1, 0);
  function seatChain(pair, a, b, down, k) {
    const hc = pair && pair.userData && pair.userData.handcuffs;
    const chain = hc ? hc.chain : pair;
    const links = chain && chain.userData && chain.userData.links;
    if (!links) return 0;
    k = k > 0 ? k : 1;
    const L = CHAIN_LEN * k;
    _c.subVectors(b, a);
    const d = _c.length();
    // sag: the slack hangs toward `down`, across the chord
    let h = 0;
    _s.set(0, 0, 0);
    if (d < L && d > 1e-6) {
      h = Math.min(L * 0.5, Math.sqrt(3 * d * (L - d) / 8));
      if (down) _s.copy(down); else _s.set(0, -1, 0);
      _s.addScaledVector(_c, -_s.dot(_c) / (d * d));
      const sl = _s.length();
      if (sl > 1e-6) _s.multiplyScalar(1 / sl); else _s.set(0, 0, 0);
    } else if (d <= 1e-6) { h = L * 0.5; if (down) _s.copy(down).normalize(); else _s.set(0, -1, 0); }
    const n = links.length;
    for (let i = 0; i < n; i++) {
      const t = (i + 1) / (n + 1);
      _p.copy(a).addScaledVector(_c, t).addScaledVector(_s, h * 4 * t * (1 - t));
      _t.copy(_c).addScaledVector(_s, h * 4 * (1 - 2 * t));
      const l = links[i];
      l.position.copy(_p);
      if (_t.lengthSq() > 1e-12) {
        _t.normalize();
        _q.setFromUnitVectors(_Y, _t);
        // every other link turned a quarter about its length: interlocked
        if (i & 1) { _q2.setFromAxisAngle(_Y, PI / 2); _q.multiply(_q2); }
        l.quaternion.copy(_q);
      }
      l.scale.setScalar(k);
    }
    return d / L;
  }
  // the swivel eye of a cuff, world space
  function swivel(cuff, out) {
    const u = cuff.userData.handcuff;
    out.set(u ? u.eyeX : 0.06, 0, 0);
    cuff.updateWorldMatrix(true, false);
    return cuff.localToWorld(out);
  }

  /* THE CUFF CASE on an officer's belt is not built here any more: it was a
     second, separate system (its own roster sweep hanging a case on every cop
     and CO beside the painted belt). It is part of entities/dutykit.js's one
     merged duty kit now, which goes on and comes off with the uniform. */

  CBZ.handcuffs = {
    version: 1,
    DIM: DIM, CHAIN_LEN: CHAIN_LEN, LINKS: LINKS, OPEN_ANGLE: OPEN_ANGLE,
    material: material,
    cuffGeo: cuffGeo,
    eyeX: eyeX,
    buildCuff: buildCuff,
    build: build,
    buildOpen: buildOpen,
    setOpen: setOpen,
    seatChain: seatChain,
    swivel: swivel,
  };
})();
