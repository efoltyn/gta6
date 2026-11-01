/* ============================================================
   games/ocean.js — DEAD WATER, as a GAME PACKAGE.

   The open water becomes a visible FOOD CHAIN game on the shared engine
   (core/packages.js). Two ROLES on ONE sim (GAMES-FIRST "roles, not
   one-shots"):
     A) SALVAGE DIVER — swim the wreck field for REAL city cash on a real
        oxygen clock; great whites hunt you (patrol→circle→bump→strike),
        dolphin pods escort and DRIVE THE SHARKS OFF, orcas clear the
        water, the megalodon guards the deep-trench gold. Dragged ashore
        (real health) when the water takes you.
     B) THE SHARK — you ARE the great white: eat the bait balls and seals
        for score, dodge the orca pod, flee the harpoon. Same sim, the
        player is the predator instead of the prey.

   WHY per object (owner's law — a prop is a mechanic or it's cut):
     · DOCK KIOSK ...... the economy + the CHARTER BOARD (role select,
                         O2 tank / bolts / chum). Win/lose is measured from
                         here. Sell salvage here for REAL city money.
     · PIER + CHUM ..... the dive launch point; the chum bucket is the
                         chum mechanic's supply (C to lure sharks away).
     · WRECK BUOYS ..... navigation: five amber floats mark five wrecks.
                         Swim to a buoy to work it. Deeper = richer.
     · WRECKS .......... the salvage sites; each is a payout. The 5th sits
                         over the trench (the gold) — the meg's water.
     · OXYGEN .......... the dive clock: drain scales with local depth,
                         refills at the dock; tank tiers buy trench time.
     · GREAT WHITES .... the fear. They hunt on the SHARED predator brain
                         (systems/predator.js), not on a private FSM — see
                         the GREAT WHITE block below. Blood/night escalate them.
     · DOLPHINS ........ the allies: pods arc-jump and CHARGE sharks off.
     · ORCAS ........... the apex event: they hunt the whites on screen.
     · MEGALODON ....... the legend: never leaves the trench; you don't
                         kill it, you beat it by getting the gold OUT.
     · BAIT BALLS ...... the base of the chain — prey for sharks AND for
                         the player in the SHARK role.

   PORTED from games/ocean.html (the standalone design draft): the PURE
   ecology (simChain, blood escalation, shark FSM, dolphin repulsion,
   orca predation, megalodon lurk→run arc, steering) and the oxygen /
   economy math. REBUILT for the engine: renderer/input/audio/HUD/UI are
   the engine's (ctx); creatures are ONE parametric voxel builder here;
   the water is the engine's real ocean (waterField / swim.js); cash is
   real city money; the diver is the engine's real player + real health.

   Determinism: build paths use ctx.rand/ctx.stream only (multiplayer
   law). Runtime creature wandering may use Math.random (FX only).
   Revert: CBZ.CONFIG.PKG_OCEAN = false (or the master GAME_PACKAGES).
   Shark brain revert: CBZ.CONFIG.OCEAN_PREDATOR = false.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.games) return;
  const THREE = window.THREE;

  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.PKG_OCEAN == null) CBZ.CONFIG.PKG_OCEAN = true;
  // THE GREAT WHITES HUNT ON THE SHARED BRAIN. Flag off (or load without
  // systems/predator.js at all) and the ecology is untouched — they still
  // patrol blood and bait balls, still flee orcas, still die to the pod — they
  // simply stop hunting the diver. One-line revert, no second FSM to fall back
  // to, because a second FSM is exactly what this migration deleted.
  if (CBZ.CONFIG.OCEAN_PREDATOR == null) CBZ.CONFIG.OCEAN_PREDATOR = true;
  const HUNT_ON = () => CBZ.CONFIG.OCEAN_PREDATOR !== false && typeof CBZ.predatorHunt === "function";

  // THE RATCHET (BLOCK LAW #5). Script-order-proof: ocean.js loads LAST, so the
  // first branch is what actually runs today — the buffer is there so a future
  // reorder can never silently un-declare an honest migration.
  if (typeof CBZ.predatorAdopt === "function") {
    try { CBZ.predatorAdopt("ocean:shark-fsm"); } catch (e) {}
  } else {
    try { (CBZ._predatorAdopted = CBZ._predatorAdopted || []).push("ocean:shark-fsm"); } catch (e) {}
  }

  /* ------------------------------------------------------------ helpers -- */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const d2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
  const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  function wrapA(a) { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; }

  /* ------------------------------------------------------------ config -- */
  const O2_TIERS = [60, 100, 150, 210], O2_COST = [0, 350, 700, 1200];
  const BOLT_COST = 30, CHUM_COST = 40;
  const GOLD_VALUE = 2600;
  // wreck ring, measured offshore along the resolved open-sea bearing
  const WRECK_DEFS = [
    { name: "Reef Runner", dist: 130, crates: 3, val: 120 },
    { name: "Pelican",     dist: 250, crates: 3, val: 220 },
    { name: "Trawler 7",   dist: 380, crates: 4, val: 320 },
    { name: "Boxship",     dist: 520, crates: 4, val: 450 },
    { name: "The Aurora",  dist: 660, crates: 2, val: 500, gold: true },
  ];
  // SwiftShader-sane caps (≤ ~40 active creatures, pooled)
  const CAP = { sharks: 6, pods: 2, orcas: 4, schools: 4, seals: 3 };
  const NEAR = 340;            // run the full sim only within this of the field
  const o2Rate = (depth) => 1 + Math.max(0, depth) * 0.025;   // ported dive clock

  /* ----------------------------------------------- prop geometry helpers -- */
  /* Every prop on this venue is ONE draw: its parts (any geometry, posed and
     coloured) are merged into one vertex-coloured mesh. Built once per venue
     build, so the temporaries are allocation at load, never per frame. */
  const propMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  propMat._shared = true;
  const _pm = new THREE.Matrix4(), _pe = new THREE.Euler(), _pq = new THREE.Quaternion();
  const _ps = new THREE.Vector3(), _pp = new THREE.Vector3(), _pc = new THREE.Color();
  // a posed, coloured copy of `geo` (geo itself is left alone)
  function part(geo, c, x, y, z, rx, ry, rz, sx, sy, sz) {
    _pe.set(rx || 0, ry || 0, rz || 0); _pq.setFromEuler(_pe);
    _pp.set(x || 0, y || 0, z || 0); _ps.set(sx || 1, sy || 1, sz || 1);
    _pm.compose(_pp, _pq, _ps);
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(_pm);
    g.userData.c = c;
    return g;
  }
  function mergeParts(list) {
    let n = 0;
    for (const g of list) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
    let o = 0;
    for (const g of list) {
      const P = g.attributes.position, N = g.attributes.normal, C = g.attributes.color;
      if (!C) _pc.setHex(g.userData.c == null ? 0x888888 : g.userData.c);
      for (let i = 0; i < P.count; i++, o++) {
        pos[o * 3] = P.getX(i); pos[o * 3 + 1] = P.getY(i); pos[o * 3 + 2] = P.getZ(i);
        nor[o * 3] = N.getX(i); nor[o * 3 + 1] = N.getY(i); nor[o * 3 + 2] = N.getZ(i);
        if (C) { col[o * 3] = C.getX(i); col[o * 3 + 1] = C.getY(i); col[o * 3 + 2] = C.getZ(i); }
        else { col[o * 3] = _pc.r; col[o * 3 + 1] = _pc.g; col[o * 3 + 2] = _pc.b; }
      }
      g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    return geo;
  }
  function propMesh(list) { return new THREE.Mesh(mergeParts(list), propMat); }
  const BOX = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const CYL = (rt, rb, h, n) => new THREE.CylinderGeometry(rt, rb, h, n || 10);
  function hashC(i, salt) { const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453; return x - Math.floor(x); }
  function shade(hex, k) { _pc.setHex(hex); _pc.multiplyScalar(k); return _pc.getHex(); }

  /* THE BAIT SHACK. Board-and-batten walls in weathered sea-blue paint on a
     plank platform, a corrugated tin shed roof, a service hatch on the sea
     face with its shutter propped open over a counter, a caged lantern, a
     bait cooler, fish crates, a rope coil and a life ring. Local frame: +Z is
     the sea face, origin on the ground at the shack's centre. W x D = 2.8 x 2.2. */
  function baitShack() {
    const L = [];
    const W = 2.8, D = 2.2, H = 2.25, wood = 0x6e5a44, paint = 0x55787f, batten = 0x6f949a;
    const trim = 0xd9d2c0, tin = 0x868c88;
    L.push(part(BOX(W + 0.3, 0.18, D + 0.5), wood, 0, 0.09, 0.1));               // platform
    for (let i = 0; i < 12; i++) {                                               // its deck boards
      L.push(part(BOX(W + 0.3, 0.02, 0.2), shade(wood, 0.86 + hashC(i, 1) * 0.22), 0, 0.19, -D / 2 - 0.12 + i * 0.22 + 0.11));
    }
    // a shed roof falls to the sea face: the back wall stands taller by the rise
    const pitch = 0.14, HB = H + D * Math.tan(pitch);
    const hAt = (z) => H + (HB - H) * (0.5 - z / D);           // wall height at depth z
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {                // corner posts
      const h = sz < 0 ? HB : H;
      L.push(part(BOX(0.12, h, 0.12), trim, sx * (W / 2 - 0.06), 0.2 + h / 2, sz * (D / 2 - 0.06)));
    });
    // walls: back, two raked sides, and the sea face around the hatch (0.8..1.85 m open, 1.8 wide)
    L.push(part(BOX(W - 0.12, HB, 0.06), paint, 0, 0.2 + HB / 2, -D / 2 + 0.03));
    {
      const sh = new THREE.Shape();
      sh.moveTo(-D / 2 + 0.06, 0); sh.lineTo(D / 2 - 0.06, 0);
      sh.lineTo(D / 2 - 0.06, hAt(D / 2 - 0.06)); sh.lineTo(-D / 2 + 0.06, hAt(-D / 2 + 0.06));
      const side = new THREE.ExtrudeGeometry(sh, { depth: 0.06, bevelEnabled: false });
      side.rotateY(-Math.PI / 2);                               // shape x -> +z, extrusion -> -x
      [-1, 1].forEach((sx) => L.push(part(side, paint, sx * (W / 2 - 0.03) + 0.03, 0.2, 0)));
      side.dispose();
    }
    L.push(part(BOX(W - 0.12, 0.8, 0.06), paint, 0, 0.2 + 0.4, D / 2 - 0.03));
    L.push(part(BOX(W - 0.12, H - 1.85, 0.06), paint, 0, 0.2 + 1.85 + (H - 1.85) / 2, D / 2 - 0.03));
    [-1, 1].forEach((sx) => L.push(part(BOX(0.44, 1.05, 0.06), paint, sx * 1.12, 0.2 + 1.325, D / 2 - 0.03)));
    // battens over every wall
    for (let i = 0; i < 9; i++) {
      const x = -W / 2 + 0.2 + i * 0.3;
      L.push(part(BOX(0.05, HB, 0.025), batten, x, 0.2 + HB / 2, -D / 2 - 0.012));
      if (Math.abs(x) > 0.92) L.push(part(BOX(0.05, H, 0.025), batten, x, 0.2 + H / 2, D / 2 + 0.012));
      else {
        L.push(part(BOX(0.05, 0.8, 0.025), batten, x, 0.6, D / 2 + 0.012));
        L.push(part(BOX(0.05, H - 1.85, 0.025), batten, x, 0.2 + 1.85 + (H - 1.85) / 2, D / 2 + 0.012));
      }
    }
    for (let i = 0; i < 7; i++) {
      const z = -D / 2 + 0.2 + i * 0.3;
      const h = hAt(z);
      [-1, 1].forEach((sx) => L.push(part(BOX(0.025, h, 0.05), batten, sx * (W / 2 + 0.012), 0.2 + h / 2, z)));
    }
    // hatch frame + sill
    L.push(part(BOX(1.9, 0.07, 0.1), trim, 0, 1.0, D / 2));
    L.push(part(BOX(1.9, 0.07, 0.1), trim, 0, 2.05, D / 2));
    [-1, 1].forEach((sx) => L.push(part(BOX(0.07, 1.05, 0.1), trim, sx * 0.93, 1.53, D / 2)));
    // counter shelf on two brackets
    L.push(part(BOX(2.1, 0.06, 0.48), wood, 0, 1.02, D / 2 + 0.22));
    [-0.8, 0.8].forEach((x) => L.push(part(BOX(0.05, 0.36, 0.05), wood, x, 0.86, D / 2 + 0.16, -0.75)));
    // the shutter, hinged at the head and propped out over the counter
    L.push(part(BOX(1.9, 0.9, 0.04), paint, 0, 2.05 + 0.32, D / 2 + 0.32, -1.05));
    [-0.85, 0.85].forEach((x) => L.push(part(CYL(0.015, 0.015, 0.75, 5), 0x3a3a38, x, 1.75, D / 2 + 0.38, 0.62)));
    // shed roof: corrugated tin falling to the sea face, a few rusty runs.
    // It rests ON the wall heads (their mid-depth height + the sheet), so no
    // wall pokes through it and none stops short of it.
    const roofY = 0.2 + (H + HB) / 2 + 0.05, RD = (D + 0.7) / Math.cos(pitch);
    L.push(part(BOX(W + 0.5, 0.04, RD), tin, 0, roofY, 0.05, pitch));
    for (let i = 0; i < 23; i++) {
      const x = -(W + 0.5) / 2 + 0.07 + i * 0.14;
      const rust = hashC(i, 7) > 0.78;
      L.push(part(CYL(0.035, 0.035, D + 0.7, 6), rust ? 0x8a5c3c : shade(tin, 0.95 + hashC(i, 3) * 0.12),
        x, roofY + 0.025, 0.05, Math.PI / 2 + pitch, 0, 0, 1, RD / (D + 0.7), 0.5));
    }
    // fascia board along the low (sea) eave, just under the sheet's front edge
    L.push(part(BOX(W + 0.5, 0.14, 0.04), trim, 0, roofY - Math.sin(pitch) * RD / 2 - 0.08, 0.05 + Math.cos(pitch) * RD / 2 - 0.01, pitch));
    // lantern: bracket, cap, warm glass, cage bars
    L.push(part(BOX(0.04, 0.04, 0.3), 0x2a2a28, 1.25, 2.12, D / 2 + 0.12));
    L.push(part(CYL(0.0, 0.11, 0.08, 8), 0x2a2a28, 1.25, 2.12, D / 2 + 0.27));
    L.push(part(CYL(0.08, 0.08, 0.2, 8), 0xffd36a, 1.25, 1.98, D / 2 + 0.27));
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + 0.4;
      L.push(part(BOX(0.012, 0.22, 0.012), 0x2a2a28, 1.25 + Math.cos(a) * 0.09, 1.98, D / 2 + 0.27 + Math.sin(a) * 0.09));
    }
    // life ring on the side wall: eight arcs, red and white
    for (let i = 0; i < 8; i++) {
      const g = new THREE.TorusGeometry(0.28, 0.06, 6, 6, Math.PI / 4);
      g.rotateZ(i * Math.PI / 4);
      L.push(part(g, i % 2 ? 0xf2f0ea : 0xd8442a, -W / 2 - 0.09, 1.45, 0.2, 0, Math.PI / 2, 0));
    }
    // bait cooler on the platform by the hatch: white tub, blue lid, latch
    L.push(part(BOX(0.72, 0.42, 0.44), 0xe8e6e0, -1.0, 0.41, D / 2 + 0.42));
    L.push(part(BOX(0.76, 0.07, 0.48), 0x2d5e8e, -1.0, 0.655, D / 2 + 0.42));
    L.push(part(BOX(0.1, 0.08, 0.03), 0x9a9a98, -1.0, 0.58, D / 2 + 0.655));
    // two stacked fish crates (slatted) and a coil of rope
    for (let k = 0; k < 2; k++) {
      const y = 0.2 + 0.14 + k * 0.28, x = 1.05, z = -D / 2 - 0.05 + 0.0;
      for (let j = 0; j < 3; j++) L.push(part(BOX(0.62, 0.07, 0.42), shade(0xa88a5c, 0.9 + 0.1 * k), x + 0.0, y - 0.09 + j * 0.09, z - 0.25, 0, 0.12 * k));
    }
    for (let k = 0; k < 3; k++) {
      const g = new THREE.TorusGeometry(0.24 - k * 0.03, 0.035, 5, 14);
      L.push(part(g, 0xb59b6a, -0.95, 0.24 + k * 0.06, -D / 2 - 0.08, Math.PI / 2));
    }
    return propMesh(L);
  }

  /* THE PIER. Local frame: +Z runs offshore from the waterline, origin at the
     coast crossing at deck level 0. Deck planks across two stringers on
     round pilings that run all the way down to the analytic seabed, X-braced,
     a bollard pair and a ladder at the end, and the red chum bucket. */
  function pierMesh(deckY, seabedLocal) {
    const L = [];
    const timber = 0x8a6d4b, pile = 0x4f3d2c;
    for (let i = 0; i < 45; i++) {
      const z = -1 + i * 0.222;
      L.push(part(BOX(3.2, 0.05, 0.2), shade(timber, 0.84 + hashC(i, 11) * 0.26), 0, deckY + 0.12, z, 0, (hashC(i, 5) - 0.5) * 0.02));
    }
    [-1.3, 0, 1.3].forEach((x) => L.push(part(BOX(0.14, 0.22, 10), shade(timber, 0.7), x, deckY - 0.03, 4)));
    [1.5, 4.5, 8.4].forEach((z, zi) => {
      [-1.45, 1.45].forEach((x) => {
        const sb = seabedLocal(x, z) - 0.4, top = deckY + 0.05, h = top - sb;
        L.push(part(CYL(0.16, 0.18, h, 9), pile, x, (top + sb) / 2, z));
        L.push(part(CYL(0.165, 0.165, 0.16, 9), 0x2f4a3a, x, deckY - 0.75, z));      // weed line
      });
      L.push(part(BOX(3.0, 0.2, 0.12), shade(timber, 0.7), 0, deckY - 0.18, z));   // cap beam
      const sb0 = Math.max(seabedLocal(0, z), deckY - 4);
      const bh = deckY - 0.3 - sb0, ang = Math.atan2(bh, 2.9);
      if (bh > 0.4) {
        const len = Math.hypot(bh, 2.9), cy = (deckY - 0.3 + sb0) / 2;
        L.push(part(BOX(len, 0.12, 0.06), pile, 0, cy, z + 0.1, 0, 0, ang));
        L.push(part(BOX(len, 0.12, 0.06), pile, 0, cy, z - 0.1, 0, 0, -ang));
      }
    });
    [-1.2, 1.2].forEach((x) => {                                                  // bollards
      L.push(part(CYL(0.13, 0.15, 0.4, 10), 0x2e3236, x, deckY + 0.34, 8.6));
      L.push(part(CYL(0.18, 0.18, 0.06, 10), 0x2e3236, x, deckY + 0.55, 8.6));
    });
    // ladder down the end face into the water
    const lb = Math.max(seabedLocal(0.4, 9.05), deckY - 3.2);
    [-0.25, 0.25].forEach((x) => L.push(part(BOX(0.06, deckY + 0.5 - lb, 0.06), 0x8a8f90, x + 0.4, (deckY + 0.5 + lb) / 2, 9.05)));
    for (let y = deckY - 0.1; y > lb + 0.2; y -= 0.32) L.push(part(CYL(0.02, 0.02, 0.5, 5), 0x8a8f90, 0.4, y, 9.05, 0, 0, Math.PI / 2));
    // CHUM bucket: tapered red pail, rim, wire bail, and the chum in it
    const bx = 1.2, bz = 6, by = deckY + 0.14;
    L.push(part(CYL(0.27, 0.22, 0.48, 14), 0x9a2a1e, bx, by + 0.24, bz));
    L.push(part(new THREE.TorusGeometry(0.27, 0.02, 5, 16), 0x7a1e16, bx, by + 0.48, bz, Math.PI / 2));
    L.push(part(CYL(0.25, 0.25, 0.02, 14), 0x5a0e0a, bx, by + 0.42, bz));
    const bail = new THREE.TorusGeometry(0.27, 0.01, 4, 12, Math.PI);
    L.push(part(bail, 0x9a9a98, bx, by + 0.48, bz, 0, 0.3, 0));
    return propMesh(L);
  }

  /* A WRECK. A lofted steel hull — round bilge, flat keel line, sheer that
     lifts to a raked bow, a transom stern — skinned in vertex colours that
     go from algae-green at the mud line through rust runs to the old paint
     above, with a deck, a gutted wheelhouse (dark window band, no glass), a
     snapped mast lying across the deck, a stub of bow rail, and for the
     container ship a slewed stack of boxes. Local frame: +Z bow, origin on
     the keel amidships. */
  function wreckMesh(L0, W, H, i) {
    const L = [];
    const NS = 16, NP = 7;
    const half = (t) => {                       // half-breadth at station t (0 stern .. 1 bow)
      const bow = t > 0.62 ? Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.62) / 0.38, 2))) : 1;
      const stern = t < 0.1 ? 0.82 + 1.8 * t : 1;
      return W / 2 * bow * stern;
    };
    const sheer = (t) => H * (1 + 0.28 * Math.pow(Math.max(0, (t - 0.65) / 0.35), 2) + 0.06 * Math.pow(Math.max(0, (0.12 - t) / 0.12), 2));
    const keelRise = (t) => H * 0.55 * Math.pow(Math.max(0, (t - 0.8) / 0.2), 2);   // forefoot sweeps up
    const paint = i === 4 ? 0xe6e2d6 : [0x3f5560, 0x6a2f28, 0x2f4a3c, 0x23384f][i % 4];
    const base = new THREE.Color(paint), rust = new THREE.Color(0x7a4a2a), algae = new THREE.Color(0x3c5a3e), tmp = new THREE.Color();
    const pos = [], col = [];
    const ring = [];
    for (let k = 0; k <= NS; k++) {
      const t = k / NS, z = -L0 / 2 + t * L0, b = half(t), top = sheer(t), kr = keelRise(t);
      const pts = [];
      for (let j = 0; j <= NP; j++) {           // keel (j=0) to deck edge (j=NP), starboard
        const s2 = j / NP;
        const y = kr + (top - kr) * s2;
        const x = Math.max(0.02, b * Math.pow(Math.sin(s2 * Math.PI / 2), 0.45));
        pts.push([x, y, z]);
      }
      ring.push(pts);
    }
    const colAt = (x, y, z) => {
      const k = Math.floor((z + L0) * 1.7), streak = hashC(k, 31 + i) > 0.6 ? 1 : 0;
      tmp.copy(base);
      const h01 = y / H;
      if (h01 < 0.35) tmp.lerp(algae, 0.85 * (1 - h01 / 0.35));
      tmp.lerp(rust, 0.25 + 0.45 * streak * Math.max(0, 1 - Math.abs(h01 - 0.7) * 2) + hashC(k * 3, 7) * 0.15);
      return tmp;
    };
    const tri = (a, b, c) => { for (const p of [a, b, c]) { pos.push(p[0], p[1], p[2]); const c2 = colAt(p[0], p[1], p[2]); col.push(c2.r, c2.g, c2.b); } };
    for (let k = 0; k < NS; k++) {
      for (let j = 0; j < NP; j++) {
        const a = ring[k][j], b = ring[k + 1][j], c = ring[k + 1][j + 1], d = ring[k][j + 1];
        const m = (p) => [-p[0], p[1], p[2]];
        tri(a, c, b); tri(a, d, c);                         // starboard (outward)
        tri(m(a), m(b), m(c)); tri(m(a), m(c), m(d));       // port
      }
      // deck
      const p0 = ring[k][NP], p1 = ring[k + 1][NP];
      const q0 = [-p0[0], p0[1], p0[2]], q1 = [-p1[0], p1[1], p1[2]];
      tri(q0, p1, p0); tri(q0, q1, p1);
    }
    // transom
    const st = ring[0];
    for (let j = 0; j < NP; j++) {
      const a = st[j], b = st[j + 1];
      tri([0, a[1], a[2]], a, b); tri([0, a[1], a[2]], b, [0, b[1], b[2]]);
      tri([0, a[1], a[2]], [-b[0], b[1], b[2]], [-a[0], a[1], a[2]]); tri([0, a[1], a[2]], [0, b[1], b[2]], [-b[0], b[1], b[2]]);
    }
    const hull = new THREE.BufferGeometry();
    hull.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    hull.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    hull.computeVertexNormals();
    L.push(hull);
    // the deck planking reads darker than the hull: a slab just under the sheer amidships
    L.push(part(BOX(W * 0.9, 0.06, L0 * 0.6), 0x4a3f33, 0, H + 0.01, -L0 * 0.05));
    // bulwark / rail stubs along the deck edge
    for (let k = 2; k < NS - 1; k += 2) {
      const t = k / NS, z = -L0 / 2 + t * L0, b = half(t) * 0.97, y = sheer(t);
      if (hashC(k, 40 + i) < 0.3) continue;            // gaps: torn away
      [-1, 1].forEach((sx) => L.push(part(BOX(0.06, 0.7, 0.06), 0x5a3a26, sx * b, y + 0.35, z)));
    }
    // wheelhouse: aft of amidships, a gutted box with a dark window band and roof lip
    const wz = -L0 * 0.24, ww = W * 0.62, wd = L0 * 0.2, wh = H * 0.85;
    L.push(part(BOX(ww, wh, wd), shade(paint === 0xe6e2d6 ? paint : 0xb8b2a2, 0.8), 0, H + wh / 2, wz));
    L.push(part(BOX(ww + 0.04, wh * 0.22, wd * 0.9), 0x0d1214, 0, H + wh * 0.72, wz + 0.02));
    L.push(part(BOX(ww + 0.3, 0.12, wd + 0.3), 0x5a4e44, 0, H + wh + 0.06, wz));
    // the mast, snapped at the step and lying across the foredeck
    L.push(part(CYL(0.1, 0.16, H * 2.2, 8), 0x3a3430, 0.4, H + 0.6, L0 * 0.12, 0.22, 0, 1.2));
    L.push(part(CYL(0.14, 0.16, 0.6, 8), 0x3a3430, 0, H + 0.3, L0 * 0.2));
    // anchor hawse + bitts on the foredeck
    [-0.4, 0.4].forEach((x) => L.push(part(CYL(0.09, 0.09, 0.45, 8), 0x2a2622, x, H + 0.22, L0 * 0.34)));
    if (i === 3) {                                       // the box ship's slewed cargo
      const cc = [0x8a3a28, 0x2a5a7a, 0x4a6a3a, 0xa87a2a];
      for (let k = 0; k < 4; k++) {
        L.push(part(BOX(2.4, 2.4, 6.0), cc[k], (k % 2 ? 0.5 : -0.4), H + 1.2 + (k > 1 ? 2.4 : 0), 1 + (k % 2) * 0.4, 0, 0.08 * (k - 1.5), (k > 1 ? 0.12 : 0)));
        for (let r = 0; r < 8; r++) L.push(part(BOX(2.44, 2.2, 0.06), shade(cc[k], 0.8), (k % 2 ? 0.5 : -0.4), H + 1.2 + (k > 1 ? 2.4 : 0), 1 + (k % 2) * 0.4 - 2.6 + r * 0.74, 0, 0.08 * (k - 1.5), (k > 1 ? 0.12 : 0)));
      }
    }
    if (i === 4) {                                       // the Aurora: a yacht's long saloon roof and rails
      L.push(part(BOX(W * 0.7, H * 0.55, L0 * 0.36), 0xe6e2d6, 0, H + H * 0.27, L0 * 0.02));
      L.push(part(BOX(W * 0.72, H * 0.16, L0 * 0.34), 0x10181c, 0, H + H * 0.36, L0 * 0.02));
    }
    return propMesh(L);
  }

  /* A WRECK BUOY: a conical-bottomed float with a white band, a four-leg
     lattice tower, a cylindrical topmark (a sphere for the gold wreck), a
     radar reflector and the lamp. Origin at the waterline. */
  function buoyMesh(gold) {
    const L = [], col = gold ? 0xd8a828 : 0xe06428, iron = 0x2a3238;
    L.push(part(CYL(0.62, 0.62, 0.55, 16), col, 0, 0.05, 0));
    L.push(part(CYL(0.62, 0.05, 0.5, 16), col, 0, -0.47, 0));
    L.push(part(CYL(0.635, 0.635, 0.14, 16), 0xf0ece2, 0, 0.18, 0));
    L.push(part(CYL(0.66, 0.66, 0.08, 16), 0x1a1c1e, 0, 0.33, 0));              // rubbing fender
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + Math.PI / 4;
      const x0 = Math.cos(a) * 0.42, z0 = Math.sin(a) * 0.42, x1 = Math.cos(a) * 0.14, z1 = Math.sin(a) * 0.14;
      const len = Math.hypot(x1 - x0, 1.5, z1 - z0);
      const g = BOX(0.06, len, 0.06);
      const dir = new THREE.Vector3(x1 - x0, 1.5, z1 - z0).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q)); g.translate((x0 + x1) / 2, 0.35 + 0.75, (z0 + z1) / 2);
      g.userData.c = col; L.push(g.toNonIndexed()); L[L.length - 1].userData.c = col; g.dispose();
    }
    [0.75, 1.3].forEach((y, k) => L.push(part(new THREE.TorusGeometry(0.33 - k * 0.12, 0.025, 4, 12), col, 0, y, 0, Math.PI / 2)));
    // radar reflector: two crossed plates
    L.push(part(BOX(0.36, 0.36, 0.02), 0xc8ccd0, 0, 1.55, 0, 0, Math.PI / 4));
    L.push(part(BOX(0.36, 0.36, 0.02), 0xc8ccd0, 0, 1.55, 0, 0, -Math.PI / 4));
    L.push(part(CYL(0.05, 0.05, 0.3, 6), iron, 0, 1.85, 0));
    if (gold) L.push(part(new THREE.SphereGeometry(0.2, 12, 8), col, 0, 2.1, 0));
    else L.push(part(CYL(0.16, 0.16, 0.32, 12), col, 0, 2.15, 0));
    L.push(part(CYL(0.07, 0.07, 0.14, 8), 0xfff0c8, 0, 2.4, 0));                // the lamp
    L.push(part(CYL(0.0, 0.08, 0.06, 8), iron, 0, 2.5, 0));
    return propMesh(L);
  }

  /* ------------------------------------------- THE ANIMALS ARE THE BESTIARY -- */
  /* Every creature in this sea used to be a stack of coloured voxel boxes
     (sharkParts/dolphinParts/orcaParts/sealParts) with a box tail on a pivot
     -- the same four shapes the city sea had already replaced with real
     anatomy. They are now the city's own animals: the great white, megalodon,
     dolphin and orca from city/wildlife/aquatic.js + wildlife_orca.js, and
     the harbour seal builder that lives beside them. Same hull, same fins,
     same split-body mouth, same tail rig (wildlife_rig.js) -- so the wreck-
     field shark and the open-coast shark are one animal on screen as well as
     in the brain.

     CONTRACT with the rest of this file (unchanged): a creature is one Group,
     nose along +Z, posed by syncFish(). The bestiary authors noses along +X,
     so the model sits under a fixed -90 degree turn. The tail beat and the
     jaw are driven through the shared rig (CBZ.animateSwim / CBZ.swimJaw)
     from swimBeat() and gape() instead of rotating box pivots. */
  const SPECIES_OF = { shark: "great_white_shark", meg: "megalodon", dolphin: "dolphin", orca: "orca" };
  // past this the body is not drawn: the sea's own fog has eaten it long
  // before, and a great white is ~36 draws. The meg is a set piece and
  // reads from much further.
  const DRAW_R = { shark: 150, meg: 420, dolphin: 130, orca: 170, seal: 110 };
  let frameDt = 1 / 60;
  function creatureMat(c) { return CBZ.cmat ? CBZ.cmat(c) : new THREE.MeshLambertMaterial({ color: c }); }
  function buildCreature(kind) {
    const g = new THREE.Group();
    g.name = "ocean:" + kind;
    const turn = new THREE.Group();
    turn.rotation.y = -Math.PI / 2;              // bestiary +X nose -> this file's +Z
    g.add(turn);
    const id = SPECIES_OF[kind];
    const sp = id && CBZ.WILDLIFE_SPECIES ? CBZ.WILDLIFE_SPECIES[id] : null;
    let model = null, spec = null;
    if (sp && sp.build) {
      model = sp.build({ THREE, mat: creatureMat, rng: () => 0.5 });
      spec = sp;
    } else if (kind === "seal" && CBZ.buildHarborSeal) {
      model = CBZ.buildHarborSeal({ mat: creatureMat });
      spec = { id: "harbor_seal", name: "harbour seal", aquatic: true, scale: 1 };
    }
    const ud = { kind, model: null, actor: null, jawLocal: null, odo: 0, last: null, drawR: DRAW_R[kind] || 150 };
    g.userData = ud;
    if (!model) return g;                         // bestiary not loaded: an empty, harmless group
    const sc = spec.scale || 1;
    model.scale.setScalar(sc);
    turn.add(model);
    const actor = { species: spec, group: model, heading: 0 };
    if (CBZ.buildSwimRig) { try { CBZ.buildSwimRig(actor); } catch (e) { /* static body */ } }
    ud.model = model; ud.actor = actor;
    // THE BITE POINT, in this group's frame: the species' authored mouth
    // contract (model-local, +X nose) through the scale and the turn.
    const mc = model.userData && model.userData.aquaticMouth;
    const bp = mc && mc.bite;
    if (bp) ud.jawLocal = { x: -(bp.z || 0) * sc, y: bp.y * sc, z: bp.x * sc };
    else {
      g.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(g);
      ud.jawLocal = { x: 0, y: (bb.min.y + bb.max.y) * 0.5, z: bb.max.z * 0.92 };
    }
    return g;
  }
  // the tail chain, pectorals and trunk swing, driven by how far the body
  // actually moved this frame (the rig reads speed off its group's position,
  // so the model is slid along its own nose axis by the odometer for the
  // call and put straight back)
  const _cam = new THREE.Vector3(), _wp = new THREE.Vector3();
  function swimBeat(mesh, dt) {
    const ud = mesh.userData, a = ud && ud.actor;
    if (!a || !a.swim || !CBZ.animateSwim) return;
    const p = mesh.position;
    if (ud.last) ud.odo += Math.min(5, Math.hypot(p.x - ud.last.x, p.y - ud.last.y, p.z - ud.last.z));
    else ud.last = new THREE.Vector3();
    ud.last.copy(p);
    if (ud.odo > 1e5) { ud.odo -= 1e5; if (a.swim.px != null) a.swim.px -= 1e5; }
    const cam = CBZ.camera;
    if (cam && cam.getWorldPosition) {
      cam.getWorldPosition(_cam);
      mesh.getWorldPosition(_wp);
      const far = _cam.distanceTo(_wp) > ud.drawR;
      ud.model.visible = !far;
      if (far) return;
    }
    a.heading = Math.PI * 0.5 - mesh.rotation.y;
    const m = ud.model;
    m.position.x = ud.odo;
    try { CBZ.animateSwim(a, dt); } catch (e) {}
    m.position.x = 0;
  }
  // 0 shut .. 1 full gape, through the species' own hinged mouth
  function gape(mesh, k) {
    const a = mesh.userData && mesh.userData.actor;
    if (a && a.swim && CBZ.swimJaw) { try { CBZ.swimJaw(a, k); } catch (e) {} }
  }
  // THE BAIT BALL: real mackerel, one baked vertex-coloured geometry shared by
  // every instance (was two boxes). Built on first use so the bestiary has
  // registered by then whatever the script order.
  let fishGeo = null, fishMat = null;
  function baitFish() {
    if (fishGeo) return;
    fishGeo = CBZ.aquaticBakedGeometry ? CBZ.aquaticBakedGeometry("fish", { nose: "z" }) : null;
    if (fishGeo) {
      fishMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    } else {
      fishGeo = new THREE.ConeGeometry(0.09, 0.5, 6); fishGeo.rotateX(Math.PI / 2);
      fishMat = new THREE.MeshLambertMaterial({ color: 0xb8d8e8 });
    }
    fishMat._shared = true;
  }

  /* --------------------------------------------------- module singletons -- */
  let C = null;          // ctx once mounted
  let V = null;          // venue refs: { venue, origin, bearing, deep, center, radius, bounds, wrecks[], creatureRoot }
  let state = null;      // persisted bag
  let simT = 0;
  const pool = { shark: [], dolphin: [], orca: [], meg: [], seal: [] };
  const chain = {
    sharks: [], pods: [], orcas: [], schools: [], seals: [], meg: null,
    blood: [],  // {x,z,amt,life}
    events: { orcaKills: 0, dolphinRepels: 0, sharkStrikes: 0, sharkBumps: 0, dolphinJumps: 0, orcaSpouts: 0, playerFed: 0 },
    orcaTimer: 70, sharkTimer: 14, orcaHere: false,
  };
  // runtime (not persisted)
  const RT = { role: "salvage", o2: 60, diving: false, warnCd: 0, drownT: 0, hurtCd: 0,
    playerShark: null, lastP: { x: 0, z: 0 }, sharkYaw: 0, score: 0, fedCd: 0, harpoonCd: 8,
    seeded: false, simDrive: false, simFocus: null, goldGrabbed: false };

  function bag() {
    if (state) return state;
    state = C.state(() => ({ role: "salvage", o2Tier: 0, bolts: 6, chum: 2, cargo: [],
      hiSalvage: 0, hiShark: 0, dives: 0 }));
    if (!state.cargo) state.cargo = [];
    RT.role = state.role || "salvage";
    return state;
  }
  const save = () => { try { C.saveState(); } catch (e) {} };
  const o2cap = () => O2_TIERS[bag().o2Tier] || 60;
  function cargoValue() { let v = 0; for (const c of bag().cargo) v += c.v; return v; }
  const isNight = () => (C ? C.time.isNight() : false);

  /* ---------------------------------------- world water sampling (engine) --
     ctx.water is the shared spelling of what these three used to derive by
     hand. WORLD coordinates (the coordinate law) — which is what this package
     always passed anyway; it just had to know the engine's function names.
     C is null until mount, and resolve() runs before that, so the pre-mount
     guard stays: it is the only path that can ask before there is a ctx. */
  const SEA_Y = () => (CBZ.SEA_Y != null ? CBZ.SEA_Y : -0.48);
  function surfaceY(x, z) { return C ? C.water.surfaceY(x, z, simT) : SEA_Y(); }
  function depthAt(x, z) { return C ? C.water.depth(x, z) : 30; }
  function floorY(x, z) { return SEA_Y() - depthAt(x, z); }

  /* ============================================================
     resolve() — find the REAL open water OUTSIDE the landmasses.
     Marches from the city centre along the bearing to the CLOSEST large
     open-sea expanse (past the whole continent, not the inner harbour
     ring), lands the dock on that outer coast, and returns the offshore
     bearing + a deep trench anchor for build() to lay the wreck line on.
     Returns null until the world (arena + waterField) exists — the engine
     retries every ~1.2s.
  ============================================================ */
  function resolve(CBZ) {
    try {
      const A = CBZ.city && CBZ.city.arena;
      if (!A || A.minX == null || !isFinite(A.minX) || !isFinite(A.maxX)) return null;
      const wf = CBZ.waterField;
      if (!wf || !wf.isNavigableWater) return null;
      const cx = (A.minX + A.maxX) / 2, cz = (A.minZ + A.maxZ) / 2;
      const R0 = Math.hypot(A.maxX - cx, A.maxZ - cz);
      // pick the bearing that reaches SUSTAINED open sea soonest (skips the
      // narrow harbour ring — that water can't hold a 660u wreck line)
      const step = 14, maxR = R0 + 6500, need = 460;
      function openSeaR(bear) {
        const c = Math.cos(bear), s = Math.sin(bear);
        let runStart = -1;
        for (let r = 0; r <= maxR; r += step) {
          const x = cx + c * r, z = cz + s * r;
          if (wf.isNavigableWater(x, z, 38)) { if (runStart < 0) runStart = r; if (r - runStart >= need) return runStart; }
          else runStart = -1;
        }
        return Infinity;
      }
      let bear = 0, best = Infinity;
      for (let i = 0; i < 32; i++) {
        const b = (i / 32) * Math.PI * 2;
        const r = openSeaR(b);
        if (r < best) { best = r; bear = b; }
      }
      if (!isFinite(best)) return null;
      const c = Math.cos(bear), s = Math.sin(bear);
      // waterline: last land point before the sustained open sea begins
      let landR = best;
      for (let r = best; r >= Math.max(0, best - 320); r -= 6) {
        if (!wf.isNavigableWater(cx + c * r, cz + s * r, 0)) { landR = r; break; }
      }
      const coast = { x: cx + c * landR, z: cz + s * landR };
      // deep trench anchor: far offshore, snapped to genuine open water
      let deep = wf.nearestWater ? wf.nearestWater(coast.x + c * 700, coast.z + s * 700, 40, 1600) : null;
      if (!deep) deep = { x: coast.x + c * 700, z: coast.z + s * 700 };
      // play bounds: AABB over the coast → far ring with lateral margin
      const far = { x: coast.x + c * 720, z: coast.z + s * 720 };
      const px = -s, pz = c, LAT = 420;
      const xs = [coast.x - c * 30, far.x, coast.x + px * LAT, coast.x - px * LAT, far.x + px * LAT, far.x - px * LAT];
      const zs = [coast.z - s * 30, far.z, coast.z + pz * LAT, coast.z - pz * LAT, far.z + pz * LAT, far.z - pz * LAT];
      let bounds = { minX: Math.min.apply(null, xs) - 40, maxX: Math.max.apply(null, xs) + 40,
        minZ: Math.min.apply(null, zs) - 40, maxZ: Math.max.apply(null, zs) + 40 };
      const sb = CBZ.SEA_WORLD_BOUNDS;
      if (sb && isFinite(sb.minX)) {
        bounds.minX = clamp(bounds.minX, sb.minX, sb.maxX); bounds.maxX = clamp(bounds.maxX, sb.minX, sb.maxX);
        bounds.minZ = clamp(bounds.minZ, sb.minZ, sb.maxZ); bounds.maxZ = clamp(bounds.maxZ, sb.minZ, sb.maxZ);
      }
      return { x: coast.x, z: coast.z, waterY: SEA_Y(), bounds, bearing: bear, deep };
    } catch (e) { return null; }
  }

  /* ================================ build ================================ */
  function build(ctx, venue) {
    C = ctx;
    const anchor = venue.anchor || {};
    const bear = anchor.bearing || 0;
    const ux = Math.cos(bear), uz = Math.sin(bear);   // offshore unit (local == world axes)
    const origin = venue.origin;
    const bounds = anchor.bounds || { minX: origin.x - 500, maxX: origin.x + 500, minZ: origin.z - 500, maxZ: origin.z + 500 };
    const center = { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 };
    const radius = Math.hypot(bounds.maxX - center.x, bounds.maxZ - center.z);
    V = { venue, origin, bearing: bear, ux, uz, deep: anchor.deep || { x: origin.x + ux * 700, z: origin.z + uz * 700 },
      bounds, center, radius, wrecks: [], creatureRoot: null };
    const g = venue.group;
    bag();

    // creatures live in WORLD coords under a counter-offset child of the
    // (batch-spared) venue group, so distance math needs no local↔world juggle
    const croot = new THREE.Group();
    croot.position.set(-origin.x, 0, -origin.z);
    croot.userData.gamePkg = "ocean";
    g.add(croot); V.creatureRoot = croot;

    // ground helpers keep every prop planted (no floating geometry): terrain
    // for the on-land kiosk, the analytic seafloor for the over-water posts.
    const terrainAt = (lx, lz) => (CBZ.floorAt ? (CBZ.floorAt(origin.x + lx, origin.z + lz) || 0) : 0);
    const seabedAt = (lx, lz) => floorY(origin.x + lx, origin.z + lz);
    const deckY = 0.7;

    // ---- DOCK KIOSK (on land, inland of the waterline): economy + charter ----
    const kx = -ux * 7, kz = -uz * 7;              // ~7u inland from the coast crossing
    const y0 = terrainAt(kx, kz);                  // seat the hut on real terrain
    const face = Math.atan2(ux, uz);               // the shack's hatch looks out to sea
    const shack = baitShack();
    shack.position.set(kx, y0, kz); shack.rotation.y = face;
    g.add(shack);
    // the shack is a wall: the AABB of its turned 2.8 x 2.2 footprint
    {
      const hx = Math.abs(Math.cos(face)) * 1.4 + Math.abs(Math.sin(face)) * 1.1;
      const hz = Math.abs(Math.sin(face)) * 1.4 + Math.abs(Math.cos(face)) * 1.1;
      ctx.solid(kx - hx, kz - hz, kx + hx, kz + hz);
    }
    // the lantern, hung beside the hatch (shack-local 1.25, 1.98, 1.37)
    ctx.light(kx + Math.cos(face) * 1.25 + Math.sin(face) * 1.37, y0 + 2.0,
      kz - Math.sin(face) * 1.25 + Math.cos(face) * 1.37, 0xffc868, 0.9, 24);
    // sign
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 0.7),
      new THREE.MeshBasicMaterial({ map: ctx.canvasTex(256, 64, (x2) => {
        x2.fillStyle = "#241610"; x2.fillRect(0, 0, 256, 64);
        x2.fillStyle = "#f0a028"; x2.font = "bold 26px Trebuchet MS";
        x2.textAlign = "center"; x2.fillText("DEAD WATER · SALVAGE", 128, 42);
      }) }));
    sign.position.set(kx + ux * 1.19, y0 + 2.47, kz + uz * 1.19);   // on the fascia, under the eave
    sign.rotation.y = Math.atan2(ux, uz);
    g.add(sign);
    // the dock vendor — a REAL city ped (brain + wardrobe + death funnel),
    // pinned behind the counter. [E] Talk gives wreck/price flavour; the
    // Charter zone below is the actual economy panel.
    if (ctx.npc) V.mona = ctx.npc({
      role: "vendor", name: "Mona", outfit: "vendor",
      at: [kx + ux * 1.1, kz + uz * 1.1], face: Math.atan2(-ux, -uz),
      post: "pinned", pose: "stand", sayColor: "#9adcb8",
      talkLabel: "Talk to Mona",
      dialogue: [
        "Lost my husband to that water. Still sell bait on it.",
        "They say the Aurora went down with gold. They say a lot.",
        "Night salvage pays double. So does a mistake after dark.",
        "Saw a fin bigger than my boat in '09. Nobody believed me.",
        "Bring my buckets back, hon.",
      ],
    });

    // ---- PIER + CHUM BUCKET: the dive launch + the chum supply ----
    // posts run from the analytic seabed up to the deck so the pier is
    // support-connected, not floating over the shallows.
    // pier-local (x across, z offshore) -> venue-local: x*uz + z*ux, -x*ux + z*uz
    const pier = pierMesh(deckY, (x, z) => seabedAt(x * uz + z * ux, -x * ux + z * uz));
    pier.rotation.y = Math.atan2(ux, uz);
    g.add(pier);

    // ---- WRECK LINE: five buoys + sunken hulls out along the bearing ----
    const rng = ctx.stream("wrecks");
    for (let i = 0; i < WRECK_DEFS.length; i++) {
      const def = WRECK_DEFS[i];
      let wx, wz;
      if (def.gold) { wx = V.deep.x; wz = V.deep.z; }
      else {
        // offshore along the bearing, jittered along its perpendicular (-uz, ux)
        const lat = (rng() - 0.5) * 90;
        wx = origin.x + ux * def.dist - uz * lat;
        wz = origin.z + uz * def.dist + ux * lat;
      }
      // snap to genuine water so a wreck never lands on a shoal/island
      const w = C.water.nearest(wx, wz, 12, 260);
      if (w) { wx = w.x; wz = w.z; }
      const lx = wx - origin.x, lz = wz - origin.z;
      const gy = floorY(wx, wz);
      const yaw = rng() * Math.PI * 2, tilt = 0.14 + rng() * 0.22;
      const L = 12 + i * 3, W = 3.6 + i * 0.5, H = 2.4 + i * 0.4;
      const hull = wreckMesh(L, W, H, i);
      hull.position.set(lx, gy - 0.4, lz);
      hull.rotation.set(0, yaw, tilt * (i % 2 ? 1 : -1));
      g.add(hull);
      const buoy = buoyMesh(!!def.gold);
      buoy.position.set(lx, SEA_Y(), lz);
      g.add(buoy);
      V.wrecks.push({ name: def.name, wx, wz, lx, lz, val: def.val, crates: def.crates + (def.gold ? 1 : 0),
        gold: !!def.gold, buoy, workT: 0 });
    }

    // ---- ZONES: the charter board + sell salvage (at the kiosk) ----
    ctx.zone({ id: "charter", label: "Charter board",
      pos: [kx, kz], r: 2.4, onUse: openCharter });
    ctx.zone({ id: "sell", label: "Sell salvage",
      pos: [kx + ux * 1.6, kz + uz * 1.6], r: 2.0,
      canShow: () => bag().cargo.length > 0, onUse: sellSalvage });
  }

  /* ============================ ecology sim ============================= */
  /* PORTED verbatim in behaviour from games/ocean.html: blood escalation,
     the great-white FSM (patrol→circle→bump→strike/flee), dolphin charge-
     repulsion, orca predation, and the megalodon lurk→run arc. Adapted to
     the engine's water sampling and the real player as the diver. */
  function addBlood(x, z, amt, life) {
    chain.blood.push({ x, z, amt, life: life || 40 });
    // ...and a REAL slick, not just a private number. predatorHunt scents
    // CBZ.goreChumList() — that is how a bleeding diver pulls a shark in from
    // outside its sense radius — so ocean's blood now feeds the same nose the
    // wildlife sharks use instead of being invisible to the shared brain.
    // Only the big spills (a strike, a kill, a thrown chum bucket) register:
    // gore.js caps the list at 12 and a bait-ball nick must not evict a corpse.
    if (amt >= 1.5 && CBZ.goreChum) {
      try { CBZ.goreChum(x, SEA_Y() - 1.2, z, Math.min(1, amt * 0.25), Math.min(60, life || 40)); } catch (e) {}
    }
  }
  function bloodAt(x, z) {
    let b = 0;
    for (const s of chain.blood) b += s.amt * clamp(1 - d2(x, z, s.x, s.z) / 120, 0, 1);
    return b;
  }
  function predatorsNear(x, z, r) {
    const out = [];
    for (const sh of chain.sharks) if (sh.alive && d2(sh.pos.x, sh.pos.z, x, z) < r) out.push(sh);
    for (const p of chain.pods) for (const m of p.members) if (d2(m.pos.x, m.pos.z, x, z) < r) out.push(m);
    for (const o of chain.orcas) if (o.alive && d2(o.pos.x, o.pos.z, x, z) < r) out.push(o);
    if (chain.meg && d2(chain.meg.pos.x, chain.meg.pos.z, x, z) < r) out.push(chain.meg);
    return out;
  }
  // the reference the sim orbits: the live diver (SALVAGE) drives everything;
  // headless simChain drives a virtual focus; otherwise the dock.
  function refPos() {
    if (RT.diving && RT.role === "salvage" && CBZ.player) return CBZ.player.pos;
    if (RT.simDrive && RT.simFocus) return RT.simFocus;
    return { x: V.origin.x + V.ux * 60, y: SEA_Y() - 2, z: V.origin.z + V.uz * 60 };
  }
  // the PREY the great whites hunt: only the SALVAGE diver, or the virtual
  // focus in a headless sim. In the SHARK role the player is a peer — the
  // whites don't hunt him (the orcas do).
  function preyPos() {
    if (RT.diving && RT.role === "salvage" && CBZ.player) return CBZ.player.pos;
    if (RT.simDrive && RT.simFocus) return RT.simFocus;
    return null;
  }
  // ...and the ACTOR the shared driver hunts. The live diver is CBZ.player
  // itself (so isPlayerActor() is true and the seize takes the real body, the
  // real camera and the real kill bus). The headless focus gets a decoy whose
  // .pos IS the focus — the same reusable-decoy trick wildlife.js uses, so the
  // probe path allocates nothing and never fabricates a person.
  const SIMTGT = { pos: null, group: { position: null }, dead: false, hp: 1e9,
    animal: true, name: "the focus" };
  function preyActor() {
    if (RT.diving && RT.role === "salvage" && CBZ.player) return CBZ.player;
    if (RT.simDrive && RT.simFocus) {
      SIMTGT.pos = RT.simFocus; SIMTGT.group.position = RT.simFocus;
      SIMTGT.dead = false; SIMTGT.hp = 1e9;
      return SIMTGT;
    }
    return null;
  }

  function acquire(kind) {
    const m = pool[kind].pop() || buildCreature(kind);
    m.visible = true;
    if (m.parent !== V.creatureRoot) V.creatureRoot.add(m);
    return m;
  }
  function release(kind, m) { if (!m) return; m.visible = false; pool[kind].push(m); }

  function steer(o, tx, ty, tz, spd, turn, dt) {
    const want = Math.atan2(tx - o.pos.x, tz - o.pos.z);
    o.yaw += clamp(wrapA(want - o.yaw), -turn * dt, turn * dt);
    o.pos.x += Math.sin(o.yaw) * spd * dt;
    o.pos.z += Math.cos(o.yaw) * spd * dt;
    const dy = ty - o.pos.y;
    o.pos.y += clamp(dy, -spd * 0.55 * dt, spd * 0.55 * dt);
    o.pitch = lerp(o.pitch || 0, clamp(dy * 0.22, -0.55, 0.55), Math.min(1, dt * 3));
  }
  function clampSwim(o) {
    const surf = surfaceY(o.pos.x, o.pos.z);
    if (o.pos.y > surf - 0.35) o.pos.y = surf - 0.35;
    const fl = floorY(o.pos.x, o.pos.z);
    if (o.pos.y < fl + 1.0) o.pos.y = fl + 1.0;
    const b = V.bounds;
    o.pos.x = clamp(o.pos.x, b.minX - 60, b.maxX + 60);
    o.pos.z = clamp(o.pos.z, b.minZ - 60, b.maxZ + 60);
  }
  function syncFish(o) {
    o.mesh.position.set(o.pos.x, o.pos.y, o.pos.z);
    o.mesh.rotation.set(0, o.yaw, 0);
    o.mesh.rotateX(-(o.pitch || 0));
    if (o.roll) o.mesh.rotateZ(o.roll);
    swimBeat(o.mesh, frameDt);
  }

  /* ---- bait balls (the base of the chain) ---- */
  const dummy = new THREE.Object3D();
  function spawnSchool(x, z) {
    if (chain.schools.length >= CAP.schools) return null;
    // a school is a size drawn per school, not a constant: every ball in this
    // sea used to be exactly 22 fish, which no two real schools ever are
    const n = 14 + ((Math.random() * 21) | 0);          // 14..34
    baitFish();
    const mesh = new THREE.InstancedMesh(fishGeo, fishMat, n);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false; V.creatureRoot.add(mesh);
    const fish = [];
    for (let i = 0; i < n; i++) fish.push({ ph: Math.random() * 6.28, r: 1.4 + Math.random() * 3, yo: (Math.random() - 0.5) * 2, sp: 0.7 + Math.random() * 0.9 });
    const s = { x, z, y: SEA_Y() - 2.2, wx: x, wz: z, scatter: 0, fish, mesh };
    chain.schools.push(s);
    return s;
  }
  function updateSchool(s, dt) {
    if (d2(s.x, s.z, s.wx, s.wz) < 8 || Math.random() < dt * 0.02) {
      const a = Math.random() * Math.PI * 2, dd = 60 + Math.random() * 120;
      s.wx = clamp(s.x + Math.sin(a) * dd, V.bounds.minX, V.bounds.maxX);
      s.wz = clamp(s.z + Math.cos(a) * dd, V.bounds.minZ, V.bounds.maxZ);
    }
    const spd = 1.1 + s.scatter * 2;
    const a = Math.atan2(s.wx - s.x, s.wz - s.z);
    s.x += Math.sin(a) * spd * dt; s.z += Math.cos(a) * spd * dt;
    s.scatter = Math.max(0, s.scatter - dt * 0.25);
    if (predatorsNear(s.x, s.z, 14).length) s.scatter = 1;
    for (let i = 0; i < s.fish.length; i++) {
      const f = s.fish[i];
      const ang = f.ph + simT * f.sp * (1 + s.scatter * 2.2);
      const r = f.r * (1 + s.scatter * 2.6);
      const fx = s.x + Math.sin(ang) * r, fz = s.z + Math.cos(ang) * r;
      const fy = s.y + f.yo * (1 + s.scatter) - s.scatter * 2.2;
      dummy.position.set(fx, Math.min(fy, surfaceY(fx, fz) - 0.4), fz);
      dummy.rotation.set(0, ang + Math.PI / 2, 0);
      const sh = 1 + 0.22 * Math.sin(simT * 7 + f.ph * 3);
      dummy.scale.set(sh, 1, 1); dummy.updateMatrix();
      s.mesh.setMatrixAt(i, dummy.matrix);
    }
    s.mesh.instanceMatrix.needsUpdate = true;
  }

  /* ---- GREAT WHITE ---------------------------------------------------------
     THIS FILE NO LONGER OWNS A SHARK BRAIN.

     It used to run a private FSM — patrol → circle → bump → strike → flee —
     which was the SECOND independent shark AI in the repo and the stated reason
     city/wildlife_shark.js refused to write a third ("18-25 update loops, only
     2 share code"). All of the stalking now comes from ONE call to
     CBZ.predatorHunt: the menace gauge (nothing may camp on you), the FAKE-OUTS
     (45% of all circling ends in nothing — the anti-habituation law that a
     hand-written circle→strike ladder can never have), line of sight, chum
     scenting, the drop-out before a committed rush, and a real SEIZE where the
     diver is held in the jaws, thrashed and eaten. The old FSM had no grab at
     all: its "strike" was a flat 16-damage proximity ping.

     What stays here is what is genuinely the ocean sim's, and nothing else:
       · THE LOCOMOTION SEAM (huntSwim) — this creature's yaw convention, its
         depth beat, the surface/seabed/bounds clamps.
       · AGGRESSION — blood and night escalation, the dolphin calm. It no longer
         gates a private FSM; it TUNES the shared one, every frame (huntKit).
       · FLEE — an orca, a dolphin charge, a harpoon bolt. Not a hunt state at
         all: it overrides the driver and tells it to let go.
       · the minigame's bookkeeping: sharkStrikes / sharkBumps, blood, claimed.
  ------------------------------------------------------------------------- */

  // Species FACADES, the same pattern city/dogs.js uses for its strays:
  // PHYSICAL NUMBERS ONLY. CBZ.predatorKit() derives the entire opts bundle
  // from scale/spd/bite/danger through the `lunge` archetype — which is itself
  // wildlife_shark.js's hand-tuned great white, solved for. That is why there
  // is no longer a single tuned radius, speed or hold left in this file.
  //
  // THE NUMBERS ARE THE AUTHORED ONES, COPIED EXACTLY from the bestiary
  // (src/city/wildlife/aquatic.js). Not "about right": `spd` in particular is a
  // species field the archetype MULTIPLIES, so a locally-invented 4.5 would
  // silently derive a 39 u/s rush. Copying the bestiary is also what makes the
  // wreck-field shark and the open-coast shark the same animal.
  // (species.hp is the creature's real hp; the minigame's own 3-bolt harpoon
  //  counter stays on the actor as s.hp and is a different thing entirely.)
  const WHITE_SP = { id: "great_white_shark", name: "great white", danger: 0.6,
    scale: 1.2, spd: 2.6, bite: 30, hp: 140, aquatic: true };
  const MEG_SP = { id: "megalodon", name: "megalodon", danger: 0.8,
    scale: 2.6, spd: 2.4, bite: 60, hp: 1200, aquatic: true };

  function spawnShark(x, z) {
    if (chain.sharks.length >= CAP.sharks) return null;
    const mesh = acquire("shark");
    // group === mesh IS THE ALIAS THE SHARED DRIVER NEEDS, and it is the one
    // real impedance mismatch in this migration. predatorHunt/predatorSeize read
    // hunter.group.position/.rotation/.matrixWorld (the jaw anchor is solved
    // through matrixWorld), while ocean creatures keep their authority in a
    // plain s.pos and only push it into the mesh in syncFish(). actorPos()
    // prefers a.pos, so the two can never disagree about WHERE it is: s.pos
    // says where it is, s.group says where it is DRAWN.
    const s = { kind: "shark", mesh: mesh, group: mesh, species: WHITE_SP, meg: false,
      pos: { x, y: SEA_Y() - 3, z }, yaw: Math.random() * 6.28, pitch: 0, heading: 0,
      state: "patrol", hunt: "cruise", aggr: 0, tailT: Math.random() * 6, hp: 3, alive: true,
      calmT: 0, fleeT: 0, fleeFrom: { x: 0, z: 0 },
      wx: x, wz: z, sinkT: 0, claimed: false, kit: null };
    chain.sharks.push(s); return s;
  }

  // The three things that are NOT a hunt: an orca in the water, a dolphin
  // charge, a harpoon bolt. Each overrides the driver — and TELLS it so through
  // predatorDisengage, which parks the hunt while leaving the menace gauge and
  // the commit count alone. (Wiping the hunt instead would hand the diver a
  // fresh, un-escalated shark every time a dolphin did its job, which is the
  // exact anti-habituation bug wildlife_shark.js documents.)
  function sharkFlee(s, from, secs) {
    if (secs <= s.fleeT) return;
    s.fleeT = secs; s.fleeFrom.x = from.x; s.fleeFrom.z = from.z;
    if (CBZ.predatorDisengage) { try { CBZ.predatorDisengage(s, secs); } catch (e) {} }
    // and if it had you in its jaws, it drops you: a dolphin arriving mid-grab
    // is the single best moment this sim can produce and it costs one line.
    if (s._seizing && CBZ.predatorRelease) { try { CBZ.predatorRelease(s, "released"); } catch (e) {} }
  }

  // ---- THE LOCOMOTION SEAM ------------------------------------------------
  // predatorHunt says WHERE (a heading in the repo-wide convention: the
  // direction is (cos h, sin h) over x/z). ocean.js says HOW, in its own yaw
  // convention (direction (sin y, cos y)) with its own turn rate, depth beat
  // and clamps. Converting ONCE, here, at the seam is the whole reason a shark
  // written for a wreck field and a shark written for the open coast can share
  // a brain without either of them knowing the other exists.
  //
  // Depth by state, as metres BELOW the surface. Anything not listed
  // (circle/bump/rush/seize) rides the PREY's own depth — a committed shark
  // comes from where you are, not from a fixed layer.
  const HUNT_DIVE = { cruise: 2.5, scent: 3.2, vanish: 14, disengage: 6 };
  function huntSwim(s, want, speed, dt) {
    if (!(dt > 0)) return false;
    const wantYaw = Math.PI * 0.5 - (want == null ? Math.PI * 0.5 - s.yaw : want);
    // a shark turns with its whole body, and a megalodon turns like a bus
    const turn = (s.meg ? 0.9 : 2.2) * dt;
    s.yaw += clamp(wrapA(wantYaw - s.yaw), -turn, turn);
    const spd = Math.max(0, speed || 0);
    s.pos.x += Math.sin(s.yaw) * spd * dt;
    s.pos.z += Math.cos(s.yaw) * spd * dt;
    const off = HUNT_DIVE[s.hunt];
    const pl = preyPos();
    let ty;
    if (off != null) ty = SEA_Y() - off;
    else if (pl) ty = pl.y + (s.hunt === "circle" ? Math.sin(simT + s.tailT) * 1.2 : 0);
    else ty = SEA_Y() - 2.5;
    if (s.hunt === "vanish") ty = Math.max(floorY(s.pos.x, s.pos.z) + 3, ty);
    const dy = ty - s.pos.y;
    s.pos.y += clamp(dy, -spd * 0.55 * dt, spd * 0.55 * dt);
    s.pitch = lerp(s.pitch || 0, clamp(dy * 0.22, -0.55, 0.55), Math.min(1, dt * 3));
    // the shared thrash reads attacker.heading for its judder direction and
    // falls back to -group.rotation.y, which in THIS creature's convention is
    // sideways. One line keeps the fallback honest.
    s.heading = Math.PI * 0.5 - s.yaw;
    clampSwim(s);
    return true;
  }

  // ---- the per-shark opts bundle, built ONCE and frozen (never per frame) --
  function huntKit(s) {
    if (s.kit) return s.kit;
    const sp = s.species;
    // the four seams the driver hands back to us: how it moves, whether it can
    // get at you at all, what happens when it lands a hit, and state changes.
    const over = {
      medium: "water",
      move: function (h, want, speed, dt) { return huntSwim(h, want, speed, dt); },
      // A SHARK CANNOT BITE SOMEONE ON THE PIER. Same law as wildlife_shark.js,
      // ocean-flavoured: swimming, inside the play bounds — or a headless probe.
      canReach: function () { return RT.simDrive || playerInWater(); },
      onState: function (ns, os) { onHuntState(s, ns, os); },
      onHit: function (dm) { onHuntHit(s, dm); },
    };
    let k = null;
    if (CBZ.predatorKit) { try { k = CBZ.predatorKit(s, over); } catch (e) { k = null; } }
    if (!k) {
      // DEGRADE: a predator.js old enough to have predatorHunt but not
      // predatorKit. We do NOT re-hand-author twenty radii here — that bundle is
      // precisely what this migration exists to delete, and predatorHunt's own
      // documented defaults cover every number we leave unset. Just the seams,
      // the archetype and the scale-derived reach/damage.
      k = Object.assign({ style: "lunge", reach: 2.2 + sp.scale * 1.6, dmg: sp.bite,
        cruiseSpeed: sp.spd * 2.4, rushSpeed: sp.spd * 8.7,
        seize: { dps: 10 + sp.bite * 0.4, thrash: 1, style: "shake" } }, over);
    }
    k.seize = k.seize || {};
    // THE ONE NUMBER predatorKit CANNOT DERIVE. creatureJawPoint discovers the
    // frontmost mesh along +X because that is the repo's model convention; this
    // file turns the bestiary model nose-toward +Z (see buildCreature/syncFish),
    // so the discovered jaw would sit in the shark's flank. jawLocal is the
    // species' own authored bite point carried through that turn and its scale.
    k.seize.jaw = s.mesh.userData.jawLocal || { x: 0, y: 0, z: 2.6 };
    k.seize.medium = "water";
    k.seize.cause = "eaten by a " + sp.name;
    k.seize.onEnd = function (res) { onHuntEnd(s, res); };
    // the two knobs aggression rides (see tuneKit). They MUST be finite: an
    // undefined senseR multiplied by anything is NaN, and predatorHunt's
    // `opts.senseR != null` test would happily accept it — a NaN sense radius
    // is a shark that can never notice you and never says why.
    s.escBase = k.seize.escape;   // undefined is fine: predatorSeize defaults it
    s.senseR0 = (k.senseR != null && isFinite(k.senseR)) ? k.senseR : 110;
    s.circleT0 = (k.circleT != null && isFinite(k.circleT)) ? k.circleT : 6.5;
    s.kit = k;
    return k;
  }

  // AGGRESSION, KEPT WHOLE — it just drives the shared knobs now instead of a
  // private state ladder. Blood and darkness widen the nose and shorten the
  // circle; a calmed shark barely notices you. Two writes, no allocation.
  function tuneKit(s, k) {
    k.senseR = s.senseR0 * (0.5 + s.aggr);
    k.circleT = s.circleT0 * (1.45 - 0.75 * s.aggr);
    // A HEADLESS FOCUS IS A MEASUREMENT, NOT A PERSON: it can be grabbed (that
    // is what simChain measures) but it always slips the jaws, so a probe can
    // never push a phantom death through the kill bus.
    k.seize.escape = RT.simDrive ? 1 : s.escBase;
  }

  function onHuntState(s, ns, os) {
    s.hunt = ns || "cruise";
    // THE BUMP counts and warns on the way OUT of the nudge — that transition
    // is the contact itself (or the timeout), and the driver owns the contact.
    if (os === "bump" && ns !== "bump") {
      const pl = preyPos();
      if (pl && d3(s.pos, pl) < 6) {
        chain.events.sharkBumps++;
      }
    }
  }
  // the strike sink: the driver landed teeth on the diver. Damage keeps going
  // through hurtDiver (the hurt cooldown + the drag-ashore rule are the
  // minigame's, not the block's), and the wound feeds the chain as fresh blood.
  function onHuntHit(s, dm) {
    chain.events.sharkStrikes++;
    if (RT.simDrive) return;
    const pl = preyPos();
    if (pl) addBlood(pl.x, pl.z, 1.6, 30);
    hurtDiver(dm, s.pos, "mauled by a " + s.species.name);
  }
  // the seize let go. A death is the kill bus's business and is never announced
  // here; surviving one is the minigame's, and it ends the dive.
  function onHuntEnd(s, res) {
    if (res === "killed" || RT.simDrive) return;
    chain.events.sharkStrikes++;
    addBlood(s.pos.x, s.pos.z, 2.4, 30);
    const P = CBZ.player;
    if (P && P.hp != null && P.hp < 34 && !P.dead) dragAshore("It let go. You were dragged ashore.");
  }

  // tail beat, jaw gape and the transform push — the trailer every branch ends
  // on, so no branch can forget one of them.
  function finishShark(s, dt, spd) {
    clampSwim(s);
    s.tailT += dt * (2.2 + spd * 0.9);
   
    gape(s.mesh, (s.hunt === "rush" || s.hunt === "seize") ? 1
      : (s.aggr > 0.7 || s.hunt === "bump") ? 0.3 : 0);
    // THE THRASH INTEGRATES ONTO THE MESH; READ IT BACK BEFORE WE OVERWRITE IT.
    // Game packages tick at PRIO 40.5 and the seize machine at 47.35, so the
    // thrash does win the frame it runs in — but `shake` and `drag` are `+=` on
    // position, and the whole point of an integrated push is that it
    // ACCUMULATES. syncFish writes s.pos back onto the mesh next frame, so
    // without this the drag was silently zeroed every tick and a great white
    // held the diver perfectly still while it ate him. Fold the thrash into the
    // authoritative s.pos first, then sync as usual.
    if (s._seizing) {
      const mp = s.mesh.position;
      if (isFinite(mp.x) && isFinite(mp.z)) { s.pos.x = mp.x; s.pos.z = mp.z; }
      if (isFinite(mp.y)) s.pos.y = mp.y;
    }
    syncFish(s);
  }
  function killShark(s, by) {
    if (!s.alive) return;
    // s.dead mirrors s.alive for the SHARED machinery: predator.js's seize
    // watchdog aborts on attacker.dead, and without it an orca could kill a
    // great white while it still had the diver in its jaws and the corpse would
    // sink to the seabed holding him. s.alive stays this file's own authority.
    s.alive = false; s.dead = true; s.sinkT = 0; s.state = "dead";
    if (s._seizing && CBZ.predatorRelease) { try { CBZ.predatorRelease(s, "released"); } catch (e) {} }
    addBlood(s.pos.x, s.pos.z, 5, 50);
    if (by === "orca") {
      chain.events.orcaKills++;
    }
  }
  function updateShark(s, dt) {
    if (!s.alive) {
      s.sinkT += dt; s.pos.y = Math.max(floorY(s.pos.x, s.pos.z) + 0.6, s.pos.y - dt * 0.8);
      s.roll = Math.min(2.6, s.sinkT * 0.5); syncFish(s);
      if (s.sinkT > 22) { release("shark", s.mesh); chain.sharks.splice(chain.sharks.indexOf(s), 1); }
      return;
    }
    const pl = preyPos();
    const bl = bloodAt(s.pos.x, s.pos.z);

    // ---- AGGRESSION (ocean's own escalation, unchanged) -------------------
    let orcaNear = null;
    for (const o of chain.orcas) if (o.alive && d3(o.pos, s.pos) < 75) { orcaNear = o; break; }
    if (orcaNear) sharkFlee(s, orcaNear.pos, 5);
    let rise = Math.min(0.3, 0.07 * bl);
    if (pl) { const dp = d3(s.pos, pl); if (dp < 60 + bl * 30) rise += 0.045; }
    if (isNight()) rise *= 1.6;
    if (s.calmT > 0) { s.calmT -= dt; rise = 0; s.aggr = Math.max(0, s.aggr - dt * 0.6); }
    s.aggr = clamp(s.aggr + rise * dt - 0.006 * dt, 0, 1);

    // ---- FLEE: overrides everything. Not a hunt state (sharkFlee already told
    //      the driver to let go), so it steers itself out and back to patrol.
    if (s.fleeT > 0) {
      s.fleeT -= dt;
      s.hunt = "cruise";
      const a = Math.atan2(s.pos.x - s.fleeFrom.x, s.pos.z - s.fleeFrom.z);
      steer(s, s.pos.x + Math.sin(a) * 60, SEA_Y() - 6, s.pos.z + Math.cos(a) * 60, 8.5, 2.2, dt);
      finishShark(s, dt, 8.5);
      return;
    }

    // ---- THE HUNT — one call, and everything the old ladder never had.
    let st = null;
    if (HUNT_ON() && pl) {
      const k = huntKit(s);
      tuneKit(s, k);
      try { st = CBZ.predatorHunt(s, preyActor(), dt, k); } catch (e) { st = null; }
    }
    s.hunt = st || "cruise";
    if (st && st !== "cruise") {
      // the driver owns the body: it already moved through huntSwim this frame.
      finishShark(s, dt, st === "rush" ? 13 : st === "bump" ? 9 : 6.5);
      return;
    }

    // ---- PATROL: what a shark does when it is not hunting you. Blood first
    //      (the chain's own escalation), then bait balls, then a long wander.
    let tx = s.wx, tz = s.wz;
    let best = null, bestW = 0.6;
    for (const b of chain.blood) { const w = b.amt * clamp(1 - d2(s.pos.x, s.pos.z, b.x, b.z) / 300, 0, 1); if (w > bestW) { bestW = w; best = b; } }
    if (best) { tx = best.x; tz = best.z; }
    else {
      let sc = null, sd = 200;
      for (const c of chain.schools) { const dd = d2(s.pos.x, s.pos.z, c.x, c.z); if (dd < sd) { sd = dd; sc = c; } }
      if (sc && Math.random() < 0.7) { tx = sc.x; tz = sc.z; }
      else if (d2(s.pos.x, s.pos.z, s.wx, s.wz) < 15) {
        const a = Math.random() * 6.28, dd = 70 + Math.random() * 150;
        s.wx = clamp(s.pos.x + Math.sin(a) * dd, V.bounds.minX, V.bounds.maxX);
        s.wz = clamp(s.pos.z + Math.cos(a) * dd, V.bounds.minZ, V.bounds.maxZ);
      }
    }
    steer(s, tx, SEA_Y() - 2.5 + Math.sin(simT * 0.3 + s.tailT) * 1.4, tz, 4, 1.4, dt);
    finishShark(s, dt, 4);
  }

  /* ---- DOLPHIN pods ---- */
  function spawnDolphins(x, z) {
    if (chain.pods.length >= CAP.pods) return null;
    const pod = { members: [], wx: x, wz: z, leaveT: 0, escorting: false };
    // coastal pods run 2-15 in the wild; 3..7 is the game-scaled band, and
    // drawing it per pod is what keeps two pods from ever being twins
    const podN = 3 + ((Math.random() * 5) | 0);          // 3..7
    for (let i = 0; i < podN; i++) {
      pod.members.push({ kind: "dolphin", mesh: acquire("dolphin"), pod,
        pos: { x: x + (Math.random() - 0.5) * 8, y: SEA_Y() - 1.6, z: z + (Math.random() - 0.5) * 8 },
        yaw: Math.random() * 6.28, pitch: 0, tailT: Math.random() * 6, slot: i,
        jumping: false, jy: 0, jumpCd: 2 + Math.random() * 8, chargeCd: 0, charging: null });
    }
    chain.pods.push(pod); return pod;
  }
  function updatePod(pod, dt) {
    const ref = refPos();
    const nearP = d2(pod.members[0].pos.x, pod.members[0].pos.z, ref.x, ref.z) < 85 && pod.leaveT <= 0;
    if (pod.leaveT > 0) pod.leaveT -= dt;
    if (nearP && !pod.escorting) { pod.escorting = true; }
    if (!nearP) pod.escorting = false;
    let cx, cz;
    if (pod.escorting) { cx = ref.x; cz = ref.z; }
    else {
      if (d2(pod.wx, pod.wz, pod.members[0].pos.x, pod.members[0].pos.z) < 20) {
        let sc = null, sd = 320;
        for (const c of chain.schools) { const dd = d2(pod.members[0].pos.x, pod.members[0].pos.z, c.x, c.z); if (dd < sd) { sd = dd; sc = c; } }
        if (sc && Math.random() < 0.6) { pod.wx = sc.x; pod.wz = sc.z; }
        else { const a = Math.random() * 6.28, dd = 120 + Math.random() * 200; pod.wx = clamp(pod.members[0].pos.x + Math.sin(a) * dd, V.bounds.minX, V.bounds.maxX); pod.wz = clamp(pod.members[0].pos.z + Math.cos(a) * dd, V.bounds.minZ, V.bounds.maxZ); }
      }
      cx = pod.wx; cz = pod.wz;
    }
    const protectee = pod.leaveT <= 0 ? ref : null;
    for (const m of pod.members) {
      m.jumpCd -= dt; m.chargeCd -= dt;
      if (protectee && !m.charging && m.chargeCd <= 0) {
        for (const s of chain.sharks) {
          if (s.alive && d2(s.pos.x, s.pos.z, protectee.x, protectee.z) < 46 && d3(m.pos, s.pos) < 90) { m.charging = s; break; }
        }
      }
      if (m.charging) {
        const s = m.charging;
        if (!s.alive || d2(s.pos.x, s.pos.z, protectee ? protectee.x : 0, protectee ? protectee.z : 0) > 90) { m.charging = null; }
        else {
          steer(m, s.pos.x, s.pos.y, s.pos.z, 11, 3.2, dt);
          if (d3(m.pos, s.pos) < 3.4) {
            // the dolphin wins the argument: calm it, break the hunt, and if it
            // had the diver in its jaws, make it let go (see sharkFlee).
            s.aggr = 0; s.calmT = 7; sharkFlee(s, m.pos, 6);
            chain.events.dolphinRepels++;
            m.charging = null; m.chargeCd = 3;
          }
          clampSwim(m); m.tailT += dt * 9;
         
          syncFish(m); continue;
        }
      }
      const surf = surfaceY(m.pos.x, m.pos.z);
      if (m.jumping) {
        m.jy -= 10.5 * dt; m.pos.y += m.jy * dt;
        m.pos.x += Math.sin(m.yaw) * 7.5 * dt; m.pos.z += Math.cos(m.yaw) * 7.5 * dt;
        m.pitch = clamp(Math.atan2(m.jy, 7.5), -1.1, 1.1);
        if (m.jy < 0 && m.pos.y < surf - 0.4) { m.jumping = false; m.jumpCd = 5 + Math.random() * 9; chain.events.dolphinJumps++; }
        m.tailT += dt * 10;
        syncFish(m); continue;
      }
      const slotA = m.slot * 1.256 + simT * 0.15;
      const tx = cx + Math.sin(slotA) * (pod.escorting ? 10 : 5);
      const tz = cz + Math.cos(slotA) * (pod.escorting ? 10 : 5);
      const ty = SEA_Y() - 1.3 - Math.abs(Math.sin(simT * 0.7 + m.slot)) * 2.2;
      steer(m, tx, ty, tz, pod.escorting ? 8 : 6.5, 2.6, dt); clampSwim(m);
      if (m.jumpCd <= 0 && m.pos.y > surf - 2.4 && Math.random() < 0.5) { m.jumping = true; m.jy = 6.4; }
      m.tailT += dt * 7;
      syncFish(m);
    }
  }

  /* ---- ORCAS (the apex event) ---- */
  function spawnOrcas(x, z) {
    const arr = [];
    // a transient hunting pod is 2-7 animals; 2..4 here (CAP allows 4)
    const podN = 2 + ((Math.random() * 3) | 0);          // 2..4
    for (let i = 0; i < podN && chain.orcas.length < CAP.orcas; i++) {
      const o = { kind: "orca", mesh: acquire("orca"), pos: { x: x + (Math.random() - 0.5) * 14, y: SEA_Y() - 2.5, z: z + (Math.random() - 0.5) * 14 },
        yaw: 0, pitch: 0, tailT: Math.random() * 6, alive: true, target: null, thrashT: 0, eatT: 0, spoutCd: 3 + Math.random() * 8, leaveT: 60 };
      chain.orcas.push(o); arr.push(o);
    }
    chain.orcaHere = true;
    return arr;
  }
  function updateOrca(o, dt) {
    o.spoutCd -= dt;
    const surf = surfaceY(o.pos.x, o.pos.z);
    if (o.thrashT > 0) {
      o.thrashT -= dt; const s = o.target;
      o.pos.y = Math.min(surf - 0.5, o.pos.y + dt * 2);
      o.roll = Math.sin(o.thrashT * 12) * 0.7;
      if (s) { s.pos.x = o.pos.x + Math.sin(o.yaw) * 2.4; s.pos.z = o.pos.z + Math.cos(o.yaw) * 2.4; s.pos.y = o.pos.y + 0.3; s.roll = Math.sin(o.thrashT * 14) * 1.2; syncFish(s); }
      if (o.thrashT <= 0) { if (s) killShark(s, "orca"); o.target = null; o.eatT = 4; }
      o.tailT += dt * 14; syncFish(o); return;
    }
    o.roll = 0;
    if (o.eatT > 0) { o.eatT -= dt; o.tailT += dt * 3; syncFish(o); return; }
    if (!o.target || !o.target.alive) {
      o.target = null; let bd = 1e9;
      for (const s of chain.sharks) { if (!s.alive || s.claimed) continue; const dd = d3(o.pos, s.pos); if (dd < bd) { bd = dd; o.target = s; } }
      if (o.target) o.target.claimed = true;
    }
    if (o.target) {
      o.leaveT = 45;
      steer(o, o.target.pos.x, o.target.pos.y, o.target.pos.z, 12, 2.6, dt);
      if (d3(o.pos, o.target.pos) < 3.4) o.thrashT = 2.6;
    } else {
      o.leaveT -= dt;
      const a = simT * 0.2 + chain.orcas.indexOf(o) * 2.1;
      const cx = (chain.orcas[0] || o).pos.x, cz = (chain.orcas[0] || o).pos.z;
      steer(o, cx + Math.sin(a) * 18, o.spoutCd < 1.5 ? SEA_Y() - 1.2 : SEA_Y() - 4, cz + Math.cos(a) * 18, 5, 1.8, dt);
      if (o.spoutCd <= 0 && o.pos.y > surf - 2.6) { o.spoutCd = 9 + Math.random() * 7; chain.events.orcaSpouts++; }
      if (o.leaveT <= 0) {
        steer(o, o.pos.x + V.ux * 200, SEA_Y() - 3, o.pos.z + V.uz * 200, 9, 1.5, dt);
        if (d2(o.pos.x, o.pos.z, V.center.x, V.center.z) > V.radius + 120) {
          release("orca", o.mesh); o.alive = false; chain.orcas.splice(chain.orcas.indexOf(o), 1);
          if (!chain.orcas.length) chain.orcaHere = false;
        }
      }
    }
    clampSwim(o); o.tailT += dt * 6; syncFish(o);
  }

  /* ---- MEGALODON (the legend — owns the trench) ---- */
  function forceMeg() {
    if (chain.meg) return chain.meg;
    const T = V.deep;
    const mesh = acquire("meg");
    // The meg keeps its authored lurk→run arc (it is a set-piece, not a stalk),
    // but it gets the same group alias + species facade as the whites so its
    // pass can hand you to CBZ.predatorSeize. See updateMeg's pass branch.
    chain.meg = { kind: "meg", mesh: mesh, group: mesh, species: MEG_SP, meg: true,
      pos: { x: T.x + 85, y: floorY(T.x + 85, T.z) + 9, z: T.z },
      yaw: 0, pitch: 0, heading: 0, tailT: 0, hunt: "rush",
      phase: "lurk", lurkT: 0, runCd: 4, enraged: false, running: false, passHit: false, alive: true };
    return chain.meg;
  }
  // the seize the meg offers on a pass. Built once; the jaw is this creature's
  // own +Z nose (creatureJawPoint discovers along +X — see huntKit) and the
  // numbers are the megalodon's own scale/bite through the documented laws.
  let megSeize = null;
  function megSeizeOpts() {
    if (megSeize) return megSeize;
    megSeize = { jaw: (chain.meg && chain.meg.mesh.userData.jawLocal) || { x: 0, y: 0, z: 9 }, medium: "water", style: "shake",
      dps: 10 + MEG_SP.bite * 0.4, hold: 2.23 * Math.pow(MEG_SP.scale, 0.9),
      escape: 0.41 / Math.pow(MEG_SP.scale, 0.9), thrash: 1,
      cause: "eaten by a megalodon" };
    return megSeize;
  }
  function updateMeg(m, dt) {
    const T = V.deep;
    const ref = refPos();
    // WHILE IT HAS YOU THE RUN IS OVER. The seize machine owns the body from
    // 47.35; letting the pass keep integrating would tow the anchored diver
    // across the trench and trip the seize's own 26u abort.
    if (m._seizing) { m.running = false; clampSwim(m); syncFish(m); return; }
    const inTrench = (RT.diving || RT.simDrive) && d2(ref.x, ref.z, T.x, T.z) < 190;
    if (m.phase === "lurk") {
      m.lurkT += dt;
      const a = simT * 0.11, r = 85;
      steer(m, T.x + Math.sin(a) * r, floorY(T.x, T.z) + 11, T.z + Math.cos(a) * r, 6, 0.8, dt);
      if (inTrench && (RT.goldGrabbed || m.lurkT > 16)) { m.phase = "run"; m.runCd = 2.5; }
    } else if (m.phase === "run") {
      m.runCd -= dt;
      if (!inTrench && d2(ref.x, ref.z, T.x, T.z) > 300) { m.phase = "lurk"; m.lurkT = 0; }
      else if (m.runCd <= 0 && !m.running) {
        const a = Math.random() * Math.PI * 2;
        m.pos.x = ref.x + Math.sin(a) * 70; m.pos.z = ref.z + Math.cos(a) * 70; m.pos.y = ref.y || SEA_Y() - 4;
        m.yaw = Math.atan2(ref.x - m.pos.x, ref.z - m.pos.z); m.running = true; m.passHit = false;
      }
      if (m.running) {
        const spd = 16;
        m.pos.x += Math.sin(m.yaw) * spd * dt; m.pos.z += Math.cos(m.yaw) * spd * dt;
        m.pos.y += clamp((ref.y || SEA_Y() - 2) - m.pos.y, -6 * dt, 6 * dt);
        m.heading = Math.PI * 0.5 - m.yaw;
        const dd = d3(m.pos, ref);
        if (!m.passHit && dd < 4.6) {
          m.passHit = true;
          // IT TAKES YOU. The pass used to be a flat 55-damage ping past a
          // creature the size of a bus. Now it offers the diver to the shared
          // grab — held, thrashed, one forgiving window — and only falls back
          // to the ping when the block refuses (flag off, already holding
          // someone, a headless focus). Never both: the seize owns the damage.
          let took = null;
          if (!RT.simDrive && CBZ.predatorSeize && CBZ.player) {
            try { took = CBZ.predatorSeize(m, CBZ.player, megSeizeOpts()); } catch (e) { took = null; }
          }
          if (!took && !RT.simDrive) hurtDiver(55, m.pos, "THE MEGALODON HIT YOU");
          addBlood(ref.x, ref.z, 3, 30);
        }
        if (d2(m.pos.x, m.pos.z, ref.x, ref.z) > 85) { m.running = false; m.runCd = (m.enraged ? 3.5 : 7) + Math.random() * (m.enraged ? 3 : 6); }
      }
    }
    clampSwim(m); m.tailT += dt * 3.2;
   
    gape(m.mesh, (m.running && d3(m.pos, ref) < 20) ? 1 : 0.12);
    syncFish(m);
  }

  /* ---- ambient population pressure + blood decay ---- */
  function updateChainSpawns(dt) {
    chain.sharkTimer -= dt;
    const alive = chain.sharks.filter((s) => s.alive).length;
    if (chain.sharkTimer <= 0 && alive < CAP.sharks && !chain.orcaHere) {
      chain.sharkTimer = 22 + Math.random() * 20;
      const a = Math.random() * 6.28, dd = 160 + Math.random() * 200;
      spawnShark(V.center.x + Math.sin(a) * dd, V.center.z + Math.cos(a) * dd);
    }
    chain.orcaTimer -= dt;
    if (chain.orcaTimer <= 0) {
      chain.orcaTimer = 140 + Math.random() * 90;
      if (!chain.orcaHere && alive >= 2) {
        const a = Math.random() * 6.28, ref = refPos();
        spawnOrcas(ref.x + Math.sin(a) * 200, ref.z + Math.cos(a) * 200);
      }
    }
    for (let i = chain.blood.length - 1; i >= 0; i--) { chain.blood[i].life -= dt; if (chain.blood[i].life <= 0) chain.blood.splice(i, 1); }
  }
  function tickChain(dt) {
    updateChainSpawns(dt);
    for (const s of chain.schools) updateSchool(s, dt);
    for (let i = chain.sharks.length - 1; i >= 0; i--) updateShark(chain.sharks[i], dt);
    for (const s of chain.sharks) s.claimed = false;
    for (const o of chain.orcas.slice()) { if (o.target && o.target.alive) o.target.claimed = true; }
    for (const o of chain.orcas.slice()) updateOrca(o, dt);
    for (const p of chain.pods) updatePod(p, dt);
    if (chain.meg) updateMeg(chain.meg, dt);
    // buoys ride the swell
    for (const w of V.wrecks) if (w.buoy) { w.buoy.position.y = surfaceY(w.wx, w.wz) + 0.1; w.buoy.rotation.x = Math.sin(simT * 1.1 + w.wx) * 0.08; w.buoy.rotation.z = Math.cos(simT * 0.9 + w.wz) * 0.08; }
  }
  function ensureSeeded() {
    if (RT.seeded) return; RT.seeded = true;
    for (let i = 0; i < CAP.schools; i++) { const a = i * 1.7, dd = 120 + i * 90; spawnSchool(V.center.x + Math.sin(a) * dd, V.center.z + Math.cos(a) * dd); }
    for (let i = 0; i < 4; i++) { const a = i * 1.9, dd = 150 + i * 60; spawnShark(V.center.x + Math.sin(a) * dd, V.center.z + Math.cos(a) * dd); }
    for (let i = 0; i < 2; i++) { const a = i * 3.1, dd = 120 + i * 90; spawnDolphins(V.center.x + Math.sin(a) * dd, V.center.z + Math.cos(a) * dd); }
    for (let i = 0; i < CAP.seals; i++) spawnSeal();
  }
  function despawnAll() {
    // NOTHING MAY BE DESPAWNED WITH THE DIVER IN ITS MOUTH. The seize machine
    // has its own watchdogs (mode change, attacker.dead), but a pooled mesh
    // handed back while a hold is live would leave the camera possessed by a
    // creature that no longer exists. One explicit release, before anything is
    // released to the pool.
    if (CBZ.predatorRelease) {
      for (const s of chain.sharks) if (s._seizing) { try { CBZ.predatorRelease(s, "released"); } catch (e) {} }
      if (chain.meg && chain.meg._seizing) { try { CBZ.predatorRelease(chain.meg, "released"); } catch (e) {} }
    }
    for (const s of chain.sharks) release("shark", s.mesh); chain.sharks.length = 0;
    for (const p of chain.pods) for (const m of p.members) release("dolphin", m.mesh); chain.pods.length = 0;
    for (const o of chain.orcas) release("orca", o.mesh); chain.orcas.length = 0;
    if (chain.meg) { release("meg", chain.meg.mesh); chain.meg = null; }
    for (const s of chain.seals) release("seal", s.mesh); chain.seals.length = 0;
    for (const s of chain.schools) if (s.mesh) { s.mesh.visible = false; V.creatureRoot.remove(s.mesh); s.mesh.geometry = null; }
    chain.schools.length = 0; chain.blood.length = 0; chain.orcaHere = false; RT.seeded = false;
  }

  /* ---- seals (SHARK-role prey worth more than a bait ball) ---- */
  function spawnSeal() {
    if (chain.seals.length >= CAP.seals) return null;
    const a = Math.random() * 6.28, dd = 90 + Math.random() * 130;
    const x = V.origin.x + V.ux * 40 + Math.sin(a) * dd, z = V.origin.z + V.uz * 40 + Math.cos(a) * dd;
    const s = { kind: "seal", mesh: acquire("seal"), pos: { x, y: SEA_Y() - 1.0, z }, yaw: Math.random() * 6.28, pitch: 0, tailT: 0, wx: x, wz: z, alive: true };
    chain.seals.push(s); return s;
  }
  function updateSeal(s, dt) {
    if (d2(s.pos.x, s.pos.z, s.wx, s.wz) < 6) { const a = Math.random() * 6.28, dd = 30 + Math.random() * 60; s.wx = clamp(s.pos.x + Math.sin(a) * dd, V.bounds.minX, V.bounds.maxX); s.wz = clamp(s.pos.z + Math.cos(a) * dd, V.bounds.minZ, V.bounds.maxZ); }
    const surf = surfaceY(s.pos.x, s.pos.z);
    steer(s, s.wx, surf - 0.8 - Math.abs(Math.sin(simT + s.tailT)) * 0.8, s.wz, 4.5, 2, dt); clampSwim(s);
    s.tailT += dt * 6; syncFish(s);
  }

  /* ============================ the two roles ============================ */
  function insideBounds(x, z) { const b = V.bounds; return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ; }
  function playerInWater() {
    const P = CBZ.player;
    if (!P) return false;
    const swimming = CBZ.citySwimming ? CBZ.citySwimming() : (P._swim === true);
    return swimming && insideBounds(P.pos.x, P.pos.z);
  }
  function hurtDiver(dmg, from, reason) {
    if (RT.hurtCd > 0) return; RT.hurtCd = 0.4;
    if (CBZ.cityHurtPlayer && CBZ.player) CBZ.cityHurtPlayer(dmg, from ? from.x : null, from ? from.z : null, reason, false, null, false);
    if (CBZ.player && CBZ.player.hp != null && CBZ.player.hp < 22 && !CBZ.player.dead) dragAshore("");
  }
  function dragAshore(reason) {
    const P = CBZ.player; if (!P) return;
    const wx = V.origin.x - V.ux * 9, wz = V.origin.z - V.uz * 9;
    const y = (CBZ.floorAt ? (CBZ.floorAt(wx, wz) || 0) : 0);
    P.pos.set(wx, y + 1.0, wz); P.vy = 1.6; P.grounded = false; P._swim = false;
    if (CBZ.playerChar) CBZ.playerChar.swimming = false;
    if (P.stamina != null) P.stamina = (P.maxStamina != null ? P.maxStamina : 100);
    RT.o2 = o2cap(); RT.diving = false;
    if (reason) C.hud.toast(reason);
  }

  function salvageTick(dt) {
    const P = CBZ.player;
    // oxygen: drain by LOCAL depth while diving; warn sparsely; drown at zero
    const depth = depthAt(P.pos.x, P.pos.z);
    RT.o2 -= o2Rate(depth) * dt;
    RT.warnCd -= dt;
    if (RT.o2 <= 0) {
      RT.o2 = 0; RT.drownT += dt;
      if (RT.drownT >= 1) { RT.drownT = 0; hurtDiver(6, null, "No air, you're drowning"); }
      if (RT.o2 <= 0 && RT.drownT === 0) {} // (hurtDiver may already drag ashore)
    } else {
      RT.drownT = 0;
      if (RT.o2 < 20 && RT.warnCd <= 0) { RT.warnCd = 4; C.hud.toast("AIR " + Math.ceil(RT.o2) + "s"); }
    }
    // salvage: work a buoy you're near that still has crates
    for (const w of V.wrecks) {
      if (w.crates <= 0) continue;
      if (d2(P.pos.x, P.pos.z, w.wx, w.wz) < 9) {
        w.workT += dt;
        if (w.workT >= 2.4) {
          w.workT = 0; w.crates--;
          const night = isNight();
          const gold = w.gold && w.crates === 0;
          const v = (gold ? GOLD_VALUE : w.val) * (night ? 2 : 1);
          bag().cargo.push({ v, gold, night }); save();
          if (gold) { RT.goldGrabbed = true; forceMeg(); C.hud.toast("THE AURORA GOLD"); }
          else C.hud.toast("+$" + v + (night ? " (night x2)" : ""));
        }
      } else w.workT = 0;
    }
    // defence: F fires a harpoon at the nearest threatening shark (hitscan)
    if (CBZ.keys && CBZ.keys["f"] && !RT._fLatch) { RT._fLatch = true; fireHarpoon(); }
    if (CBZ.keys && !CBZ.keys["f"]) RT._fLatch = false;
    // C drops chum ahead of you (lures sharks THERE, away from you)
    if (CBZ.keys && CBZ.keys["c"] && !RT._cLatch) { RT._cLatch = true; throwChum(); }
    if (CBZ.keys && !CBZ.keys["c"]) RT._cLatch = false;
  }
  function fireHarpoon() {
    if (bag().bolts <= 0) { C.hud.toast("NO BOLTS"); return; }
    const P = CBZ.player; let best = null, bd = 26;
    for (const s of chain.sharks) { if (!s.alive) continue; const dd = d3(s.pos, P.pos); if (dd < bd) { bd = dd; best = s; } }
    if (!best) return;
    bag().bolts--; save();
    best.hp--; sharkFlee(best, P.pos, 5);
    addBlood(best.pos.x, best.pos.z, 2, 35);
    if (best.hp <= 0) { killShark(best, "bolt"); chain.sharkTimer = Math.min(chain.sharkTimer, 8); C.hud.toast("SHARK KILLED"); }
  }
  function throwChum() {
    if (bag().chum <= 0) { C.hud.toast("NO CHUM"); return; }
    bag().chum--; save();
    const P = CBZ.player, hx = Math.sin(RT.sharkYaw || 0), hz = Math.cos(RT.sharkYaw || 0);
    addBlood(P.pos.x + hx * 16, P.pos.z + hz * 16, 4, 70);
  }

  function sharkRoleTick(dt) {
    const P = CBZ.player;
    // heading from movement (fall back to last yaw when stationary)
    const vx = P.pos.x - RT.lastP.x, vz = P.pos.z - RT.lastP.z;
    if (Math.hypot(vx, vz) > 0.02) RT.sharkYaw = Math.atan2(vx, vz);
    RT.lastP.x = P.pos.x; RT.lastP.z = P.pos.z;
    // the player IS a great white: attach the avatar, hide the human rig
    if (!RT.playerShark) { RT.playerShark = acquire("shark"); if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = false; }
    const ps = RT.playerShark;
    ps.position.set(P.pos.x, surfaceY(P.pos.x, P.pos.z) - 1.4, P.pos.z);
    ps.rotation.set(0, RT.sharkYaw, 0);
    swimBeat(ps, dt);
   
    // EAT: bait balls and seals within range → score
    RT.fedCd -= dt;
    for (const s of chain.schools) {
      if (d2(P.pos.x, P.pos.z, s.x, s.z) < 8 && RT.fedCd <= 0) { s.scatter = 1; RT.fedCd = 0.8; RT.score += 60; chain.events.playerFed++; C.hud.toast("+60"); }
    }
    for (let i = chain.seals.length - 1; i >= 0; i--) {
      const sl = chain.seals[i];
      if (d2(P.pos.x, P.pos.z, sl.pos.x, sl.pos.z) < 5) { release("seal", sl.mesh); chain.seals.splice(i, 1); RT.score += 220; addBlood(sl.pos.x, sl.pos.z, 2, 25); C.hud.toast("SEAL TAKEN  +220"); }
    }
    // ORCAS hunt YOU: caught → run ends, score banked
    for (const o of chain.orcas) { if (o.alive && d2(o.pos.x, o.pos.z, P.pos.x, P.pos.z) < 6) { endSharkRun("THE ORCA POD RAN YOU DOWN"); return; } }
    // HARPOON threat near the dock/surface: flee it
    RT.harpoonCd -= dt;
    if (d2(P.pos.x, P.pos.z, V.origin.x, V.origin.z) < 60 && RT.harpoonCd <= 0) {
      RT.harpoonCd = 6;
      if (CBZ.cityHurtPlayer && CBZ.player) CBZ.cityHurtPlayer(18, V.origin.x, V.origin.z, "the harpooner tagged you", false, null, false);
      if (CBZ.speech && CBZ.speech.say) CBZ.speech.say({ x: V.origin.x, y: (CBZ.floorAt ? (CBZ.floorAt(V.origin.x, V.origin.z) || 0) : 0) + 2, z: V.origin.z }, "Shark at the dock! Harpoon it!", { important: true });
    }
  }
  function endSharkRun(reason) {
    if (RT.score > bag().hiShark) { bag().hiShark = RT.score; save(); }
    C.hud.toast(reason + ", score " + RT.score + (RT.score >= bag().hiShark ? " (BEST)" : ""));
    RT.score = 0;
    dragAshore("");
  }
  function detachShark() { if (RT.playerShark) { release("shark", RT.playerShark); RT.playerShark = null; } if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = true; }

  /* ============================== economy =============================== */
  function sellSalvage(ctx) {
    const cargo = bag().cargo;
    if (!cargo.length) return;
    const v = cargoValue(); const hadGold = cargo.some((c) => c.gold);
    ctx.wallet.give(v, "Salvage sold"); bag().cargo = []; if (v > bag().hiSalvage) bag().hiSalvage = v; save();
    if (hadGold) ctx.hud.toast("THE AURORA GOLD IS CASHED OUT. $" + v.toLocaleString());
    else ctx.hud.toast("Sold the hold for $" + v.toLocaleString());
  }

  /* ============================== the panel ============================= */
  const BTN = "display:inline-block;margin:4px 8px 4px 0;padding:9px 15px;border-radius:11px;cursor:pointer;font-weight:800;font-size:14px;user-select:none;";
  const on = "background:#2a8a9a;color:#04170a;", off = "background:rgba(255,255,255,.08);color:#e8f2f5;";
  function openCharter() {
    const s = bag();
    const nextO2 = O2_TIERS[s.o2Tier + 1], costO2 = O2_COST[s.o2Tier + 1];
    const canO2 = s.o2Tier < 3 && C.wallet.canAfford(costO2 || 1e9);
    const canBolt = C.wallet.canAfford(BOLT_COST) && s.bolts < 12;
    const canChum = C.wallet.canAfford(CHUM_COST) && s.chum < 5;
    const html =
      "<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:8px'>" +
        "<b style='letter-spacing:2px;color:#f0a028;font-size:17px'>DEAD WATER. CHARTER</b>" +
        "<span style='font-size:13px'>cash <b style='color:#ffd451'>$" + C.wallet.cash().toLocaleString() + "</b></span></div>" +
      "<div>" +
        "<span data-act='roleSalvage' style='" + BTN + (RT.role === "salvage" ? on : off) + "'>SALVAGE DIVER</span>" +
        "<span data-act='roleShark' style='" + BTN + (RT.role === "shark" ? on : off) + "'>THE SHARK</span>" +
      "</div>" +
      (RT.role === "salvage"
        ? "<div style='font-size:12px;opacity:.85;margin:8px 0 4px'>F harpoon, C chum. Hold <b>$" + cargoValue().toLocaleString() + "</b>, best haul <b>$" + s.hiSalvage.toLocaleString() + "</b></div>" +
          "<div>" +
          "<span data-act='buyO2' style='" + BTN + (canO2 ? on : off) + "'>O2 tank → " + (nextO2 ? nextO2 + "s ($" + costO2 + ")" : "MAX") + "</span>" +
          "<span data-act='buyBolt' style='" + BTN + (canBolt ? on : off) + "'>Harpoon x4 ($" + BOLT_COST + "), have " + s.bolts + "</span>" +
          "<span data-act='buyChum' style='" + BTN + (canChum ? on : off) + "'>Chum x1 ($" + CHUM_COST + "), have " + s.chum + "</span>" +
          "</div>"
        : "<div style='font-size:12px;opacity:.85;margin:8px 0 4px'>Best score <b>" + s.hiShark + "</b></div>") +
      "<div style='margin-top:8px'><span data-act='sell' style='" + BTN + off + "'>Sell salvage</span>" +
        "<span data-act='close' style='" + BTN + off + "'>Close (Esc)</span></div>";
    C.hud.panel(html, {
      roleSalvage() { setRole("salvage"); openCharter(); },
      roleShark() { setRole("shark"); openCharter(); },
      buyO2() { if (canO2 && C.wallet.spend(costO2, "O2 tank upgraded")) { s.o2Tier++; RT.o2 = o2cap(); save(); } openCharter(); },
      buyBolt() { if (canBolt && C.wallet.spend(BOLT_COST, "Harpoon bolts")) { s.bolts = Math.min(12, s.bolts + 4); save(); } openCharter(); },
      buyChum() { if (canChum && C.wallet.spend(CHUM_COST, "Chum bucket")) { s.chum = Math.min(5, s.chum + 1); save(); } openCharter(); },
      sell() { sellSalvage(C); openCharter(); },
      close() { C.hud.closePanel(); },
    });
  }
  function setRole(r) {
    if (RT.role === r) return;
    if (RT.role === "shark") detachShark();
    RT.role = r; bag().role = r; save();
    RT.score = 0; RT.o2 = o2cap();
    C.hud.toast(r === "shark" ? "Role: THE SHARK" : "Role: SALVAGE DIVER");
  }

  /* ============================== update ================================ */
  function update(ctx, dt) {
    if (!V) return;
    C = C || ctx;
    if (CBZ.game && CBZ.game.mode && CBZ.game.mode !== "city") { if (chain.sharks.length || chain.schools.length) despawnAll(); if (RT.playerShark) detachShark(); return; }
    dt = Math.min(0.05, dt || 0);
    simT += dt;
    frameDt = dt;
    const P = CBZ.player;
    const near = P && d2(P.pos.x, P.pos.z, V.center.x, V.center.z) < V.radius + NEAR;
    const inWater = playerInWater();

    if (!near && !inWater) { if (RT.seeded) despawnAll(); if (RT.playerShark) detachShark(); RT.diving = false; return; }

    ensureSeeded();
    tickChain(dt);
    for (const s of chain.seals) updateSeal(s, dt);

    // role state transitions on entering/leaving the water
    const wasDiving = RT.diving;
    RT.diving = inWater;
    if (RT.diving && !wasDiving) { if (RT.role === "salvage") { RT.o2 = RT.o2 || o2cap(); bag().dives++; save(); } RT.lastP.x = P.pos.x; RT.lastP.z = P.pos.z; }
    if (!RT.diving && wasDiving) { if (RT.role === "shark" && RT.playerShark) endSharkRun("You left the water"); RT.hurtCd = 0; }
    RT.hurtCd = Math.max(0, RT.hurtCd - dt);

    if (RT.diving) {
      if (RT.role === "salvage") salvageTick(dt);
      else sharkRoleTick(dt);
    } else {
      // refill air topside; keep the human rig if a role was left mid-water
      RT.o2 = Math.min(o2cap(), RT.o2 + 22 * dt);
      if (RT.role !== "shark" && RT.playerShark) detachShark();
    }
  }

  /* ============================ probe / api ============================= */
  // Headless full-chain stepper — PROVES dolphins repel and orcas kill.
  // Stages a deterministic scenario around a virtual focus, then steps the
  // real ecology at a fixed 30Hz and returns the event deltas.
  function simChain(seconds) {
    if (!V) return { error: "not mounted" };
    const before = JSON.parse(JSON.stringify(chain.events));
    // stage: focus in the deep field, sharks aggroed on it, dolphins to repel
    // them, blood to pull the sharks in, and an orca pod to make the kills.
    RT.simDrive = true;
    RT.simFocus = { x: V.center.x, y: SEA_Y() - 6, z: V.center.z };
    const F = RT.simFocus;
    despawnAll(); RT.seeded = true;
    for (let i = 0; i < CAP.schools; i++) spawnSchool(F.x + Math.sin(i) * 120, F.z + Math.cos(i) * 120);
    // aggr is the ONLY stage knob now: it widens the nose and shortens the
    // circle, and the shared driver decides the rest (the point of the wave).
    for (let i = 0; i < 5; i++) { const a = (i / 5) * 6.28; const s = spawnShark(F.x + Math.sin(a) * 24, F.z + Math.cos(a) * 24); if (s) s.aggr = 0.85; }
    for (let i = 0; i < 2; i++) spawnDolphins(F.x + Math.sin(i * 2) * 16, F.z + Math.cos(i * 2) * 16);
    addBlood(F.x, F.z, 4, seconds + 5);
    // orcas start well out so the pod's first dolphin repels land before the
    // apex closes in and starts killing — the probe wants BOTH counters > 0.
    spawnOrcas(F.x + 150, F.z + 95);
    const o2Before = o2cap();
    const steps = Math.min(30000, Math.round((seconds || 0) * 30));
    for (let i = 0; i < steps; i++) { simT += 1 / 30; tickChain(1 / 30); }
    RT.simDrive = false; RT.simFocus = null;
    const depth = depthAt(V.deep.x, V.deep.z);
    const rate = o2Rate(depth);
    const o2After = Math.max(0, o2Before - rate * (seconds || 0));
    const delta = {}; for (const k in chain.events) delta[k] = chain.events[k] - before[k];
    let aggrMax = 0; for (const s of chain.sharks) if (s.alive) aggrMax = Math.max(aggrMax, s.aggr);
    return {
      seconds, events: delta,
      sharksAlive: chain.sharks.filter((s) => s.alive).length,
      aggrMax: +aggrMax.toFixed(3),
      o2: { before: o2Before, after: +o2After.toFixed(2), rate: +rate.toFixed(4), depth: +depth.toFixed(2) },
    };
  }

  /* ============================== register ============================= */
  CBZ.games.register({
    id: "ocean", title: "DEAD WATER",
    venue: { site: "ocean", resolve },
    build,
    update,
    api: {
      simChain,
      o2Rate,
      O2_TIERS,
      chain: () => ({
        sharks: chain.sharks.filter((s) => s.alive).length,
        pods: chain.pods.length, dolphins: chain.pods.reduce((n, p) => n + p.members.length, 0),
        orcas: chain.orcas.length, schools: chain.schools.length, seals: chain.seals.length,
        meg: !!chain.meg, blood: chain.blood.length, events: Object.assign({}, chain.events),
      }),
      role: () => RT.role,
      setRole,
      forceMeg: () => (V ? forceMeg() && true : false),
      spawnShark: (x, z) => (V ? !!spawnShark(x == null ? V.center.x : x, z == null ? V.center.z : z) : false),
      spawnDolphins: (x, z) => (V ? !!spawnDolphins(x == null ? V.center.x : x, z == null ? V.center.z : z) : false),
      spawnOrcas: (x, z) => (V ? !!spawnOrcas(x == null ? V.center.x : x, z == null ? V.center.z : z) : false),
      state: () => (state ? JSON.parse(JSON.stringify(state)) : null),
      mounted: () => !!V,
      bounds: () => (V ? Object.assign({}, V.bounds) : null),
      anchor: () => (V ? { x: V.origin.x, z: V.origin.z, bearing: V.bearing, deep: V.deep } : null),
      o2: () => RT.o2,
      score: () => RT.score,
      // the venue's builders, for turntable shots and probes (no mount needed)
      models: { creature: buildCreature, shack: baitShack, pier: pierMesh, wreck: wreckMesh, buoy: buoyMesh },
    },
  });
})();
